/**
 * NO_PROXY construction.
 *
 * The bypass list handed to the host is a comma separated string. Entries are
 * validated one by one because a value such as `*` or `192.168.0.0/16` means
 * different things to different matchers; this plugin only publishes entries it
 * can reason about and lets the host's matcher treat them as host names.
 */

import {
	LOOPBACK_HOSTS,
	MODEL_DIRECT_HOSTS,
	normalizeHostEntry,
	normalizeHostList
} from './settings.js';

/**
 * Build a comma separated bypass list from already-unique host lists.
 *
 * @param hosts - lists of host entries, in priority order.
 * @returns the joined bypass string (may be empty).
 */
export function joinHosts(...hosts) {
	const seen = new Set();
	const out = [];
	for (const list of hosts) {
		for (const entry of list ?? []) {
			const host = normalizeHostEntry(entry);
			if (!host || seen.has(host)) continue;
			seen.add(host);
			out.push(host);
		}
	}
	return out.join(',');
}

/**
 * Build the bypass list for one plan.
 *
 * Emergency hosts are only included when the proxy is known to be unavailable:
 * while the tunnel works they must still use the proxy.
 *
 * @param settings - resolved settings.
 * @param options - `{ emergency: boolean }`.
 * @returns the bypass string.
 */
export function buildBypass(settings, options = {}) {
	const lists = [settings.noProxy ?? []];
	if (settings.keepModelDirect) lists.push(MODEL_DIRECT_HOSTS);
	if (options.emergency) lists.push(settings.emergencyDirectHosts ?? []);
	lists.push(LOOPBACK_HOSTS);
	return joinHosts(...lists);
}

/**
 * Normalize a host list the same way `buildBypass` does; re-exported so the
 * planner and tests share one definition.
 *
 * @param value - raw host list.
 * @returns normalized, unique hosts.
 */
export function sanitizeHosts(value) {
	return normalizeHostList(value);
}
