import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBypass, joinHosts, sanitizeHosts } from '../lib/bypass.js';
import { resolveSettings } from '../lib/settings.js';

test('joinHosts normalizes and deduplicates across lists', () => {
	assert.equal(joinHosts(['Example.com', '*.example.com'], ['other.cn']), 'example.com,other.cn');
	assert.equal(joinHosts(['*'], ['<local>'], ['10.*']), '');
});

test('buildBypass always keeps loopback and the model host', () => {
	const settings = resolveSettings({});
	const bypass = buildBypass(settings).split(',');
	assert.ok(bypass.includes('deepseek.com'));
	assert.ok(bypass.includes('localhost'));
	assert.ok(bypass.includes('127.0.0.1'));
});

test('buildBypass ignores the model host when keepModelDirect is off', () => {
	const settings = resolveSettings({ keepModelDirect: false });
	assert.ok(!buildBypass(settings).includes('deepseek.com'));
});

test('emergency hosts are only published while the proxy is down', () => {
	const settings = resolveSettings({ emergencyDirectHosts: ['baidu.com', 'bilibili.com'] });
	assert.ok(!buildBypass(settings).includes('baidu.com'));
	assert.ok(buildBypass(settings, { emergency: true }).includes('baidu.com'));
	assert.ok(buildBypass(settings, { emergency: true }).includes('bilibili.com'));
});

test('custom noProxy hosts are merged and sanitized', () => {
	const settings = resolveSettings({ noProxy: ['mirrors.example.cn', '*', '10.*', 'http://ok.example/path'] });
	const bypass = buildBypass(settings).split(',');
	assert.ok(bypass.includes('mirrors.example.cn'));
	assert.ok(bypass.includes('ok.example'));
	assert.ok(!bypass.includes('*'));
});

test('sanitizeHosts is the same normalization used by buildBypass', () => {
	assert.deepEqual(sanitizeHosts(['A.cn', 'a.cn', '*']), ['a.cn']);
});
