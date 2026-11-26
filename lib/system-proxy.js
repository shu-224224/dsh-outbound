/**
 * Windows "system proxy" reader.
 *
 * Reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`
 * through `reg query` and turns the raw values into one optional proxy URL.
 * Parsing is a pure function so it can be tested without Windows.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Registry key that holds the WinINET proxy settings. */
export const INTERNET_SETTINGS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/** One `reg query` over the whole key; reading three values separately costs three processes. */
export const REG_QUERY_ARGS = ['query', INTERNET_SETTINGS_KEY];

/**
 * Parse `reg query ...` output into a name → raw value map.
 *
 * Output looks like:
 * ```
 * HKEY_CURRENT_USER\Software\...\Internet Settings
 *     ProxyEnable    REG_DWORD    0x1
 *     ProxyServer    REG_SZ       http=127.0.0.1:7890;https=127.0.0.1:7890
 * ```
 *
 * @param stdout - raw command output.
 * @returns value map; later duplicates win.
 */
export function parseRegistryValues(stdout) {
	const values = new Map();
	for (const line of String(stdout ?? '').split(/\r?\n/)) {
		const match = /^\s{2,}(\S+)\s+REG_[A-Z_]+\s+(.*)$/.exec(line);
		if (!match) continue;
		values.set(match[1], match[2].trim());
	}
	return values;
}

/**
 * Decide whether `ProxyEnable` means "on".
 *
 * @param raw - raw registry value, usually `0x1` or `0x0`.
 * @returns whether the system proxy is enabled.
 */
export function proxyIsEnabled(raw) {
	const text = String(raw ?? '').trim().toLowerCase();
	return text === '1' || text === '0x1' || text === '0x00000001';
}

/**
 * Pick one proxy URL out of a `ProxyServer` value.
 *
 * Accepts both the single form (`127.0.0.1:7890`) and the per-scheme form
 * (`http=...;https=...`). Only HTTP(S) legs are usable; anything else is
 * ignored because the host cannot route SOCKS through its dispatcher.
 *
 * @param raw - raw `ProxyServer` value.
 * @returns the normalized proxy URL, or an empty string.
 */
export function pickProxyUrl(raw) {
	const text = String(raw ?? '').trim();
	if (!text) return '';
	const legs = new Map();
	let single = '';
	for (const part of text.split(';')) {
		const piece = part.trim();
		if (!piece) continue;
		const eq = piece.indexOf('=');
		if (eq === -1) {
			single = piece;
			continue;
		}
		legs.set(piece.slice(0, eq).trim().toLowerCase(), piece.slice(eq + 1).trim());
	}
	const candidate = legs.get('http') ?? legs.get('https') ?? single ?? '';
	if (!candidate) return '';
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
		if (!url.hostname) return '';
		return url.href.replace(/\/$/, '');
	} catch {
		return '';
	}
}

/**
 * Turn raw `reg query` output into the system proxy snapshot.
 *
 * @param stdout - raw command output.
 * @returns `{ enabled, proxyUrl, override, pac }`.
 */
export function parseSystemProxyQuery(stdout) {
	const values = parseRegistryValues(stdout);
	const enabled = proxyIsEnabled(values.get('ProxyEnable'));
	return {
		enabled,
		proxyUrl: enabled ? pickProxyUrl(values.get('ProxyServer')) : '',
		override: values.get('ProxyOverride') ?? '',
		pac: values.get('AutoConfigURL') ?? ''
	};
}

/**
 * Read the current Windows system proxy.
 *
 * On non-Windows platforms this reports `supported: false`; the caller then
 * falls back to the launch environment, where "system" means "whatever proxy
 * the process was started with".
 *
 * @param options - `{ exec?: (cmd,args,opts) => Promise<{stdout}>, timeoutMs?: number, platform?: string }`.
 * @returns the snapshot, or `{ supported:false }` / `{ error }`.
 */
export async function readSystemProxy(options = {}) {
	const platform = options.platform ?? process.platform;
	if (platform !== 'win32') return { supported: false };
	const exec = options.exec ?? execFileAsync;
	const timeoutMs = options.timeoutMs ?? 2_000;
	try {
		const { stdout } = await exec('reg', REG_QUERY_ARGS, {
			windowsHide: true,
			timeout: timeoutMs,
			encoding: 'utf8'
		});
		return { supported: true, ...parseSystemProxyQuery(stdout) };
	} catch (error) {
		return { supported: true, error: String(error?.message ?? error) };
	}
}
