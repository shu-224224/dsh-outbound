/**
 * Configuration normalization.
 *
 * Everything downstream reads the resolved shape produced here, so an invalid
 * or missing field can never reach the planner as a half-typed value. The
 * function is pure: it does not read the clock, the disk, or the network.
 */

/** Default URL fetched through the proxy to prove the tunnel works. */
export const DEFAULT_PROBE_URL = 'https://www.gstatic.com/generate_204';

/** Model traffic that keeps bypassing the proxy when `keepModelDirect` is on. */
export const MODEL_DIRECT_HOSTS = ['deepseek.com'];

/** Always bypassed: a proxy must never see the harness's own loopback traffic. */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** Modes the planner understands; anything else resolves to `system`. */
export const MODES = ['direct', 'system', 'manual'];

const MODE_SET = new Set(MODES);

/**
 * Clamp a numeric option, falling back when the value is not a usable number.
 *
 * @param value - raw config value.
 * @param min - smallest accepted value.
 * @param max - largest accepted value.
 * @param fallback - value used when `value` is not a finite number.
 * @returns the clamped value.
 */
export function clampNumber(value, min, max, fallback) {
	const number = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Normalize a proxy URL: only plain `http(s)://host[:port]` without credentials
 * is accepted, because a proxy URL containing credentials would end up in the
 * environment of every spawned child.
 *
 * @param value - raw config value.
 * @returns the normalized URL, or an empty string when it is unusable.
 */
export function normalizeProxyUrl(value) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) return '';
	let url;
	try {
		url = new URL(text);
	} catch {
		return '';
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
	if (!url.hostname) return '';
	if (url.username || url.password) return '';
	return url.href.replace(/\/$/, '');
}

/**
 * Turn an arbitrary list of host strings into a clean, ordered list.
 *
 * @param value - raw config value.
 * @returns unique hosts with schemes and paths stripped; invalid entries are dropped.
 */
export function normalizeHostList(value) {
	if (!Array.isArray(value)) return [];
	const seen = new Set();
	const hosts = [];
	for (const entry of value) {
		const host = normalizeHostEntry(entry);
		if (!host || seen.has(host)) continue;
		seen.add(host);
		hosts.push(host);
	}
	return hosts;
}

/**
 * Normalize one host entry.
 *
 * Accepts `host`, `host:port`, and `http://host/path`; rejects wildcards that a
 * bypass matcher could read as "bypass everything", CIDR ranges, and anything
 * containing whitespace or an unsupported scheme.
 *
 * @param value - one host entry.
 * @returns the normalized host, or an empty string when unusable.
 */
export function normalizeHostEntry(value) {
	let text = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if (!text) return '';
	if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
		try {
			text = new URL(text).host;
		} catch {
			return '';
		}
	}
	text = text.replace(/^\*\./, '');
	if (!text || text === '*' || text === '<local>') return '';
	if (/[\s/*]/.test(text)) return '';
	if (/^\d+\.\*/.test(text)) return '';
	if (/^\[.*\]$/.test(text)) return text;
	if (/^[0-9a-f:.]+$/i.test(text)) return text;
	if (text.includes(':')) {
		return /^[a-z0-9.-]+:\d{1,5}$/i.test(text) ? text : '';
	}
	if (!/^[a-z0-9.-]+$/i.test(text)) return '';
	return text;
}

/**
 * Resolve the raw config object into the shape the rest of the plugin uses.
 *
 * @param raw - config value supplied by the loader.
 * @returns the resolved settings.
 */
export function resolveSettings(raw) {
	let source = raw && typeof raw === 'object' ? raw : {};
	if (typeof source.get === 'function') {
		try {
			source = source.get() ?? {};
		} catch {
			source = {};
		}
	}
	if (!source || typeof source !== 'object') source = {};
	const enabled = source.enabled !== false;
	const mode = MODE_SET.has(source.mode) ? source.mode : 'system';
	return {
		enabled,
		mode,
		proxy: normalizeProxyUrl(source.proxy),
		keepModelDirect: source.keepModelDirect !== false,
		noProxy: normalizeHostList(source.noProxy),
		emergencyDirectHosts: normalizeHostList(source.emergencyDirectHosts),
		fallbackToDirect: source.fallbackToDirect === true,
		probeUrl: typeof source.probeUrl === 'string' && source.probeUrl.trim() ? source.probeUrl.trim() : DEFAULT_PROBE_URL,
		probeIntervalMs: clampNumber(source.probeIntervalMs, 0, 3_600_000, 5_000),
		pollIntervalMs: clampNumber(source.pollIntervalMs, 0, 3_600_000, 2_000),
		probeTimeoutMs: clampNumber(source.probeTimeoutMs, 100, 120_000, 2_500)
	};
}
