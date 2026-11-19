/**
 * dsh-outbound — host entry.
 *
 * The plugin owns one process-wide HTTP(S) proxy policy. At any moment it
 * decides where non-model traffic should go (direct, the operating system's
 * proxy, or a manually configured proxy), verifies that choice with a real
 * request, and installs the result through the harness proxy installer.
 *
 * The routing machine itself lives in `engine.js`; this file only adapts the
 * live cordis configuration, the host environment, and the network probe to the
 * ports that machine expects.
 */

import z from '@deepseek-ai/schemastery';
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';

import { createEngine } from './engine.js';
import { createProber } from './probe.js';
import { DEFAULT_PROBE_URL, normalizeProxyUrl, resolveSettings } from './settings.js';
import { readSystemProxy } from './system-proxy.js';

/** Prefix every diagnostic line so it can be filtered in a shared log. */
const LOG_PREFIX = '[dsh-outbound]';

/** `reg query` gets a short leash; a stuck registry read must not stall a tick. */
const SYSTEM_PROXY_TIMEOUT_MS = 1_500;

/** Startup variables that describe a proxy on platforms without WinINET. */
const LAUNCH_PROXY_KEYS = ['https_proxy', 'http_proxy'];

export const name = 'dsh-outbound';

/** No host service is mandatory: every collaborator is optional or injected. */
export const inject = [];

/** Setting this environment variable to `1` leaves the process policy alone. */
export const DISABLE_ENV = 'DSH_OUTBOUND_DISABLE';

export const Config = z
	.object({
		enabled: z.boolean().default(true).description('Master switch; turning it off restores the launch policy.'),
		mode: z
			.union([z.const('direct'), z.const('system'), z.const('manual')])
			.default('system')
			.description('How non-model traffic selects a proxy.'),
		proxy: z.string().default('').description('Proxy URL used by manual mode; http(s) only, no credentials.'),
		keepModelDirect: z.boolean().default(true).description('Keep deepseek.com direct so model traffic never depends on the proxy.'),
		noProxy: z.array(z.string()).default([]).description('Hosts that always bypass the proxy.'),
		emergencyDirectHosts: z
			.array(z.string())
			.default([])
			.description('Hosts allowed to go direct only while the proxy is unavailable; everything else fails closed.'),
		fallbackToDirect: z.boolean().default(false).description('Optional escape hatch: route everything direct while the proxy is down (may expose the real IP).'),
		probeUrl: z.string().default(DEFAULT_PROBE_URL).description('URL fetched through the proxy to prove it works.'),
		probeIntervalMs: z.number().default(5_000).description('Probe period in milliseconds; 0 trusts an existing target without probing.'),
		pollIntervalMs: z.number().default(2_000).description('How often the target is re-read; 0 disables background checks.'),
		probeTimeoutMs: z.number().default(2_500).description('Timeout for one probe request.')
	})
	.description('Independent outbound proxy policy with a fail-closed outage path.')
	.volatile();

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Turn any thrown value into a readable fragment. */
function describeError(error) {
	if (error instanceof Error && error.message) return error.message;
	const text = String(error ?? '').trim();
	return text || 'unknown error';
}

/**
 * Wrap `ctx.logger` so a broken logger can never break routing.
 *
 * @param logger - the host logger, or anything else.
 * @returns `(level, message) => void`.
 */
function createLogger(logger) {
	return (level, message) => {
		const line = `${LOG_PREFIX} ${message}`;
		try {
			const direct = logger?.[level];
			if (typeof direct === 'function') {
				direct.call(logger, line);
				return;
			}
			if (typeof logger?.log === 'function') {
				logger.log.call(logger, level, line);
			}
		} catch {
			/* diagnostics are best effort */
		}
	};
}

/** Read one proxy variable from a launch-environment snapshot. */
function launchValue(environment, name) {
	try {
		const entry = environment?.get?.(name);
		if (!entry) return '';
		return typeof entry.value === 'string' ? entry.value.trim() : '';
	} catch {
		return '';
	}
}

/** Pick the first usable proxy variable out of the launch environment. */
function launchProxyValue(environment) {
	for (const key of LAUNCH_PROXY_KEYS) {
		const value = launchValue(environment, key);
		if (value) return value;
	}
	return '';
}

/* ------------------------------------------------------------------ */
/* Configuration access                                                */
/* ------------------------------------------------------------------ */

/** Accept either a live cordis config handle or a plain object. */
function makeLiveConfig(config, log) {
	if (config && typeof config.get === 'function') return config;
	try {
		return Config(config ?? {});
	} catch (error) {
		log('warn', `configuration could not be normalized, using it as-is: ${describeError(error)}`);
		return config && typeof config === 'object' ? config : {};
	}
}

/**
 * Read the raw configuration object.
 *
 * @param live - live config handle or plain object.
 * @param log - diagnostics sink.
 * @returns a plain object, never `null`.
 */
function readRawConfig(live, log) {
	try {
		if (live && typeof live.get === 'function') return live.get() ?? {};
		return live ?? {};
	} catch (error) {
		log('warn', `reading the configuration failed, using defaults: ${describeError(error)}`);
		return {};
	}
}

/* ------------------------------------------------------------------ */
/* Target discovery                                                    */
/* ------------------------------------------------------------------ */

/**
 * Describe the current proxy target for the engine.
 *
 * A target is a small value: the URL to publish (or `null`), a stable key so
 * the engine can detect changes, and a reason for diagnostics.
 *
 * @param settings - resolved settings for this tick.
 * @param log - diagnostics sink.
 * @param environment - launch-environment snapshot.
 * @returns the target.
 */
async function readTarget(settings, log, environment) {
	if (settings.mode === 'direct') {
		return {
			proxyUrl: null,
			key: 'direct',
			reason: 'direct mode never installs a proxy'
		};
	}

	if (settings.mode === 'manual') {
		const proxyUrl = normalizeProxyUrl(settings.proxy);
		if (!proxyUrl) {
			return {
				proxyUrl: null,
				key: 'manual:invalid',
				reason: settings.proxy ? 'the manual proxy URL is not usable' : 'manual mode is selected but no proxy URL is set'
			};
		}
		return {
			proxyUrl,
			key: `manual:${proxyUrl}`,
			reason: `using the manually configured proxy ${proxyUrl}`
		};
	}

	return readSystemTarget(log, environment);
}

/**
 * Resolve the "follow the system" target.
 *
 * Windows is read from WinINET at runtime; elsewhere the launch environment is
 * the closest equivalent because the process cannot observe desktop settings.
 */
async function readSystemTarget(log, environment) {
	if (process.platform !== 'win32') {
		const raw = launchProxyValue(environment);
		const proxyUrl = normalizeProxyUrl(raw);
		if (!proxyUrl) {
			return {
				proxyUrl: null,
				key: 'system:none',
				reason: raw ? 'the launch environment proxy URL is not usable' : 'no https_proxy or http_proxy in the launch environment'
			};
		}
		return {
			proxyUrl,
			key: `system:${proxyUrl}`,
			reason: `using the launch environment proxy ${proxyUrl}`
		};
	}

	let detected;
	try {
		detected = await readSystemProxy({ timeoutMs: SYSTEM_PROXY_TIMEOUT_MS });
	} catch (error) {
		return {
			proxyUrl: null,
			key: 'system:error',
			reason: `reading the Windows system proxy failed: ${describeError(error)}`
		};
	}

	if (detected?.error) {
		return {
			proxyUrl: null,
			key: 'system:error',
			reason: `reading the Windows system proxy failed: ${detected.error}`
		};
	}
	if (!detected || detected.supported === false) {
		return {
			proxyUrl: null,
			key: 'system:invalid',
			reason: 'the Windows system proxy is not readable on this host'
		};
	}
	if (!detected.enabled) {
		return {
			proxyUrl: null,
			key: 'system:off',
			reason: 'the Windows system proxy is disabled'
		};
	}

	const proxyUrl = normalizeProxyUrl(detected.proxyUrl ?? '');
	if (!proxyUrl) {
		if (detected.pac) {
			log('warn', 'the Windows system proxy only provides a PAC script; PAC is not supported, so no proxy is used');
		} else {
			log('warn', 'the Windows system proxy has no usable HTTP or HTTPS leg');
		}
		return {
			proxyUrl: null,
			key: 'system:invalid',
			reason: detected.pac ? 'only a PAC script is configured, which is not supported' : 'no usable HTTP or HTTPS proxy leg is configured'
		};
	}

	return {
		proxyUrl,
		key: `system:${proxyUrl}`,
		reason: `using the Windows system proxy ${proxyUrl}`
	};
}

/* ------------------------------------------------------------------ */
/* Probe and install ports                                             */
/* ------------------------------------------------------------------ */

/** Probe the proxy, translating the detailed result into a boolean. */
async function probeTarget(prober, log, proxyUrl, settings) {
	try {
		const result = await prober.probe(proxyUrl, settings.probeUrl, settings.probeTimeoutMs);
		if (!result?.ok) {
			const status = Number.isInteger(result?.status) ? `HTTP ${result.status}` : '';
			const detail = result?.error ? String(result.error) : status;
			log('warn', `proxy health probe failed${detail ? `: ${detail}` : ''}`);
			return false;
		}
		return true;
	} catch (error) {
		log('warn', `proxy health probe threw: ${describeError(error)}`);
		return false;
	}
}

/**
 * Wrap a plain object as the `get(name)` environment snapshot expected by the
 * proxy installer.
 *
 * Keys are matched case-insensitively (they are stored lower-case) and values
 * are returned untouched so the installer decides how to stringify them. A
 * missing name yields `undefined` rather than an empty entry.
 *
 * @param values - environment overlay, typically `{ http_proxy, https_proxy }`.
 * @returns `{ get(name) }`.
 */
export function createEnvSnapshot(values) {
	const table = new Map();
	if (values && typeof values === 'object') {
		const entries = values instanceof Map ? values.entries() : Object.entries(values);
		for (const [key, value] of entries) {
			table.set(String(key).toLowerCase(), value);
		}
	}
	return {
		get(name) {
			const key = String(name ?? '').toLowerCase();
			if (!table.has(key)) return undefined;
			return { value: table.get(key), name: key };
		}
	};
}

/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */

/**
 * Apply the plugin.
 *
 * @param ctx - cordis context.
 * @param config - live config handle, plain object, or undefined.
 */
export function apply(ctx, config) {
	const log = createLogger(ctx?.logger);

	if (process.env[DISABLE_ENV] === '1') {
		log('info', `disabled through ${DISABLE_ENV}=1; the launch policy is left untouched`);
		return;
	}

	const live = makeLiveConfig(config, log);
	const readSettings = () => resolveSettings(readRawConfig(live, log));

	let environment;
	try {
		environment = launchEnvironmentOf(ctx);
	} catch (error) {
		log('warn', `the launch environment could not be read: ${describeError(error)}`);
		environment = undefined;
	}

	const prober = createProber();
	const engine = createEngine({
		settings: readSettings,
		readTarget: (settings) => readTarget(settings, log, environment),
		probe: (proxyUrl, settings) => probeTarget(prober, log, proxyUrl, settings),
		install: (values) => installProxyFromEnvironment(createEnvSnapshot(values), (message) => log('warn', message)),
		log
	});

	ctx.effect?.(
		() => () => {
			void engine
				.stop()
				.then(() => prober.close())
				.catch((error) => log('warn', `shutting down the routing engine failed: ${describeError(error)}`));
		},
		'dsh-outbound: stop routing and close probe agents'
	);

	try {
		ctx.on?.('loader/volatile-update', () => {
			try {
				engine.refresh();
			} catch (error) {
				log('warn', `refreshing the routing plan failed: ${describeError(error)}`);
			}
		});
	} catch (error) {
		log('warn', `the loader update hook could not be attached: ${describeError(error)}`);
	}

	// Mirror the host settings service if it exists. It is optional: the plugin
	// works from its own config when the service is absent.
	try {
		ctx.inject?.(['settings'], (settingsCtx) => {
			try {
				settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
			} catch {
				/* optional service */
			}
		});
	} catch {
		/* optional service */
	}

	try {
		engine.start();
	} catch (error) {
		log('error', `the routing engine could not start: ${describeError(error)}`);
	}
}
