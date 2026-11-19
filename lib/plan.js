/**
 * Route planning.
 *
 * A plan is a small immutable value: what kind of routing is in effect, which
 * environment values must be published to the host, and a stable key so the
 * engine can skip re-installing an unchanged plan.
 *
 * The planner is pure. It never reads the system proxy, probes the network, or
 * looks at the clock; the engine gathers those facts and passes them in.
 */

import { buildBypass } from './bypass.js';

/**
 * Build the environment overlay for a proxied plan.
 *
 * @param settings - resolved settings.
 * @param proxyUrl - proxy URL to publish.
 * @param emergency - whether the emergency-direct hosts should bypass now.
 * @returns the overlay (keys are the canonical lowercase names).
 */
function proxiedEnv(settings, proxyUrl, emergency) {
	const env = { http_proxy: proxyUrl, https_proxy: proxyUrl };
	const bypass = buildBypass(settings, { emergency });
	if (bypass) env.no_proxy = bypass;
	return env;
}

/**
 * Build a stable key for a plan.
 *
 * @param kind - plan kind.
 * @param env - environment overlay, or `null` for "restore the launch policy".
 * @returns a string that changes exactly when the installed policy must change.
 */
export function planKey(kind, env) {
	if (env === null) return 'off';
	const names = Object.keys(env).sort();
	return `${kind}:${names.map((name) => `${name}=${env[name] ?? ''}`).join(';')}`;
}

/**
 * Decide the routing plan for one moment in time.
 *
 * Rules, in order:
 * 1. `enabled:false` restores the launch policy (the plugin stops overriding).
 * 2. `mode:direct` installs the direct policy regardless of any proxy.
 * 3. No proxy target means direct.
 * 4. A known-unavailable target with `fallbackToDirect:true` means direct.
 * 5. A known-unavailable target otherwise stays fail-closed: the proxy stays
 *    configured so out-of-list requests fail instead of leaking direct, and
 *    only the emergency hosts bypass it.
 * 6. Otherwise the proxy is published with the normal bypass list.
 *
 * @param settings - resolved settings.
 * @param target - `{ proxyUrl: string|null }` from the target reader.
 * @param facts - `{ available?: boolean }`; omitted means "not known to be down".
 * @returns the plan.
 */
export function buildPlan(settings, target, facts = {}) {
	if (!settings.enabled) {
		return { kind: 'off', env: null, key: 'off', proxyUrl: null, reason: 'plugin disabled' };
	}
	if (settings.mode === 'direct') {
		const env = {};
		return { kind: 'direct', env, key: planKey('direct', env), proxyUrl: null, reason: 'direct mode' };
	}
	const proxyUrl = target?.proxyUrl ?? null;
	if (!proxyUrl) {
		const env = {};
		return {
			kind: 'direct',
			env,
			key: planKey('direct', env),
			proxyUrl: null,
			reason: target?.reason ?? 'no proxy target'
		};
	}
	const available = facts.available !== false;
	if (!available) {
		if (settings.fallbackToDirect) {
			const env = {};
			return {
				kind: 'fallback',
				env,
				key: planKey('fallback', env),
				proxyUrl,
				reason: 'proxy unavailable; fallbackToDirect is on'
			};
		}
		const env = proxiedEnv(settings, proxyUrl, true);
		return {
			kind: 'fail-closed',
			env,
			key: planKey('fail-closed', env),
			proxyUrl,
			reason: 'proxy unavailable; only emergency hosts bypass'
		};
	}
	const env = proxiedEnv(settings, proxyUrl, false);
	return {
		kind: 'proxy',
		env,
		key: planKey('proxy', env),
		proxyUrl,
		reason: 'proxy healthy'
	};
}
