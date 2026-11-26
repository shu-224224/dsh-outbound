import test from 'node:test';
import assert from 'node:assert/strict';
import {
	INTERNET_SETTINGS_KEY,
	REG_QUERY_ARGS,
	parseRegistryValues,
	parseSystemProxyQuery,
	pickProxyUrl,
	proxyIsEnabled,
	readSystemProxy
} from '../lib/system-proxy.js';

const HEADER = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

function sample({ enable = '0x1', server = '127.0.0.1:7890', override = '*.local;127.*', pac = '' } = {}) {
	const lines = [HEADER, `    ProxyEnable    REG_DWORD    ${enable}`];
	if (server !== null) lines.push(`    ProxyServer    REG_SZ    ${server}`);
	if (override !== null) lines.push(`    ProxyOverride    REG_SZ    ${override}`);
	if (pac) lines.push(`    AutoConfigURL    REG_SZ    ${pac}`);
	return lines.join('\r\n');
}

test('registry query targets the Internet Settings key once', () => {
	assert.equal(REG_QUERY_ARGS[0], 'query');
	assert.equal(REG_QUERY_ARGS[1], INTERNET_SETTINGS_KEY);
});

test('parseRegistryValues reads aligned rows', () => {
	const values = parseRegistryValues(sample());
	assert.equal(values.get('ProxyEnable'), '0x1');
	assert.equal(values.get('ProxyServer'), '127.0.0.1:7890');
	assert.equal(values.get('ProxyOverride'), '*.local;127.*');
});

test('proxyIsEnabled understands 1 and 0x1', () => {
	assert.equal(proxyIsEnabled('0x1'), true);
	assert.equal(proxyIsEnabled('1'), true);
	assert.equal(proxyIsEnabled('0x0'), false);
	assert.equal(proxyIsEnabled(''), false);
});

test('pickProxyUrl handles the single and per-scheme forms', () => {
	assert.equal(pickProxyUrl('127.0.0.1:7890'), 'http://127.0.0.1:7890');
	assert.equal(pickProxyUrl('http=127.0.0.1:7890;https=127.0.0.1:7891'), 'http://127.0.0.1:7890');
	assert.equal(pickProxyUrl('https=127.0.0.1:7891'), 'http://127.0.0.1:7891');
	assert.equal(pickProxyUrl('socks=127.0.0.1:1080'), '');
	assert.equal(pickProxyUrl(''), '');
});

test('parseSystemProxyQuery reports the disabled state verbatim', () => {
	const parsed = parseSystemProxyQuery(sample({ enable: '0x0' }));
	assert.equal(parsed.enabled, false);
	assert.equal(parsed.proxyUrl, '');
});

test('parseSystemProxyQuery keeps override and PAC values', () => {
	const parsed = parseSystemProxyQuery(sample({ pac: 'http://127.0.0.1:7890/proxy.pac' }));
	assert.equal(parsed.enabled, true);
	assert.equal(parsed.proxyUrl, 'http://127.0.0.1:7890');
	assert.equal(parsed.override, '*.local;127.*');
	assert.equal(parsed.pac, 'http://127.0.0.1:7890/proxy.pac');
});

test('parseSystemProxyQuery tolerates a missing ProxyServer', () => {
	const parsed = parseSystemProxyQuery(sample({ server: null }));
	assert.equal(parsed.enabled, true);
	assert.equal(parsed.proxyUrl, '');
});

test('readSystemProxy accepts an injected command runner', async () => {
	const calls = [];
	const result = await readSystemProxy({
		platform: 'win32',
		exec: async (command, args, options) => {
			calls.push({ command, args, options });
			return { stdout: sample({ server: '127.0.0.1:7897' }) };
		}
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0].command, 'reg');
	assert.deepEqual(calls[0].args, REG_QUERY_ARGS);
	assert.deepEqual(result, { supported: true, enabled: true, proxyUrl: 'http://127.0.0.1:7897', override: '*.local;127.*', pac: '' });
});

test('readSystemProxy turns a failed command into an error result', async () => {
	const result = await readSystemProxy({
		platform: 'win32',
		exec: async () => {
			throw new Error('reg.exe: access denied');
		}
	});
	assert.equal(result.supported, true);
	assert.match(result.error, /access denied/);
});
