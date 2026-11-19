import test from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_PROBE_URL,
	MODEL_DIRECT_HOSTS,
	clampNumber,
	normalizeHostEntry,
	normalizeHostList,
	normalizeProxyUrl,
	resolveSettings
} from '../lib/settings.js';

test('resolveSettings fills defaults', () => {
	const settings = resolveSettings({});
	assert.equal(settings.enabled, true);
	assert.equal(settings.mode, 'system');
	assert.equal(settings.proxy, '');
	assert.equal(settings.keepModelDirect, true);
	assert.deepEqual(settings.noProxy, []);
	assert.deepEqual(settings.emergencyDirectHosts, []);
	assert.equal(settings.fallbackToDirect, false);
	assert.equal(settings.probeUrl, DEFAULT_PROBE_URL);
	assert.equal(settings.probeIntervalMs, 5_000);
	assert.equal(settings.pollIntervalMs, 2_000);
	assert.equal(settings.probeTimeoutMs, 2_500);
});

test('resolveSettings rejects unknown modes and non-boolean flags', () => {
	const settings = resolveSettings({ mode: 'funky', enabled: 'yes', fallbackToDirect: 1, keepModelDirect: 0 });
	assert.equal(settings.mode, 'system');
	assert.equal(settings.enabled, true);
	assert.equal(settings.fallbackToDirect, false);
	assert.equal(settings.keepModelDirect, true);
});

test('resolveSettings clamps numbers into their ranges', () => {
	assert.equal(resolveSettings({ pollIntervalMs: -5 }).pollIntervalMs, 0);
	assert.equal(resolveSettings({ pollIntervalMs: 10 ** 9 }).pollIntervalMs, 3_600_000);
	assert.equal(resolveSettings({ probeIntervalMs: -1 }).probeIntervalMs, 0);
	assert.equal(resolveSettings({ probeTimeoutMs: 1 }).probeTimeoutMs, 100);
	assert.equal(resolveSettings({ probeTimeoutMs: 10 ** 9 }).probeTimeoutMs, 120_000);
	assert.equal(clampNumber('2500', 100, 5_000, 0), 2_500);
	assert.equal(clampNumber(undefined, 100, 5_000, 42), 42);
});

test('resolveSettings reads a live config handle', () => {
	const settings = resolveSettings({ get: () => ({ mode: 'manual', proxy: 'http://127.0.0.1:7897' }) });
	assert.equal(settings.mode, 'manual');
	assert.equal(settings.proxy, 'http://127.0.0.1:7897');
});

test('normalizeProxyUrl keeps plain http(s) proxies only', () => {
	assert.equal(normalizeProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890');
	assert.equal(normalizeProxyUrl('HTTPS://Proxy.Example:8443/'), 'https://proxy.example:8443');
	assert.equal(normalizeProxyUrl('socks5://127.0.0.1:7890'), '');
	assert.equal(normalizeProxyUrl('http://user:pass@127.0.0.1:7890'), '');
	assert.equal(normalizeProxyUrl('127.0.0.1:7890'), '');
	assert.equal(normalizeProxyUrl(''), '');
	assert.equal(normalizeProxyUrl(null), '');
});

test('normalizeHostEntry accepts hosts and drops unsafe patterns', () => {
	assert.equal(normalizeHostEntry('Example.COM'), 'example.com');
	assert.equal(normalizeHostEntry('*.example.com'), 'example.com');
	assert.equal(normalizeHostEntry('http://example.com/path?q=1'), 'example.com');
	assert.equal(normalizeHostEntry('localhost'), 'localhost');
	assert.equal(normalizeHostEntry('127.0.0.1'), '127.0.0.1');
	assert.equal(normalizeHostEntry('::1'), '::1');
	assert.equal(normalizeHostEntry('[::1]'), '[::1]');
	assert.equal(normalizeHostEntry('example.com:8080'), 'example.com:8080');
	assert.equal(normalizeHostEntry('*'), '');
	assert.equal(normalizeHostEntry('<local>'), '');
	assert.equal(normalizeHostEntry('10.*'), '');
	assert.equal(normalizeHostEntry('192.168.0.0/16'), '');
	assert.equal(normalizeHostEntry('bad host'), '');
	assert.equal(normalizeHostEntry(42), '');
});

test('normalizeHostList deduplicates case-insensitively', () => {
	assert.deepEqual(normalizeHostList(['Example.com', 'example.com', '*.example.com', '*', 'a.cn']), ['example.com', 'a.cn']);
	assert.deepEqual(normalizeHostList('not-an-array'), []);
});

test('model hosts are the DeepSeek apex domain', () => {
	assert.deepEqual(MODEL_DIRECT_HOSTS, ['deepseek.com']);
});
