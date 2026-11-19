import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, planKey } from '../lib/plan.js';
import { resolveSettings } from '../lib/settings.js';

function settings(overrides = {}) {
	return resolveSettings({
		mode: 'manual',
		proxy: 'http://127.0.0.1:7890',
		emergencyDirectHosts: ['baidu.com', 'bilibili.com'],
		...overrides
	});
}

const PROXY_TARGET = { proxyUrl: 'http://127.0.0.1:7890', key: 'manual:http://127.0.0.1:7890' };

test('a disabled plugin restores the launch policy', () => {
	const plan = buildPlan(settings({ enabled: false }), PROXY_TARGET, { available: true });
	assert.equal(plan.kind, 'off');
	assert.equal(plan.env, null);
});

test('direct mode never proxies, even with a target', () => {
	const plan = buildPlan(settings({ mode: 'direct' }), PROXY_TARGET, { available: true });
	assert.equal(plan.kind, 'direct');
	assert.deepEqual(plan.env, {});
});

test('no target means direct', () => {
	const plan = buildPlan(settings(), { proxyUrl: null, key: 'none' }, { available: false });
	assert.equal(plan.kind, 'direct');
	assert.deepEqual(plan.env, {});
});

test('manual mode without a usable proxy URL means direct', () => {
	const plan = buildPlan(settings({ proxy: 'socks5://127.0.0.1:1080' }), { proxyUrl: null, key: 'manual:invalid' });
	assert.equal(plan.kind, 'direct');
});

test('a healthy proxy publishes both proxy variables and the normal bypass list', () => {
	const plan = buildPlan(settings(), PROXY_TARGET, { available: true });
	assert.equal(plan.kind, 'proxy');
	assert.equal(plan.env.http_proxy, 'http://127.0.0.1:7890');
	assert.equal(plan.env.https_proxy, 'http://127.0.0.1:7890');
	const bypass = plan.env.no_proxy.split(',');
	assert.ok(bypass.includes('deepseek.com'));
	assert.ok(bypass.includes('localhost'));
	assert.ok(!bypass.includes('baidu.com'));
});

test('an unavailable proxy fails closed but still lets the emergency list bypass', () => {
	const plan = buildPlan(settings(), PROXY_TARGET, { available: false });
	assert.equal(plan.kind, 'fail-closed');
	assert.equal(plan.env.http_proxy, 'http://127.0.0.1:7890');
	const bypass = plan.env.no_proxy.split(',');
	assert.ok(bypass.includes('baidu.com'));
	assert.ok(bypass.includes('bilibili.com'));
	assert.ok(bypass.includes('deepseek.com'));
});

test('fallbackToDirect sends everything direct while the proxy is down', () => {
	const plan = buildPlan(settings({ fallbackToDirect: true }), PROXY_TARGET, { available: false });
	assert.equal(plan.kind, 'fallback');
	assert.deepEqual(plan.env, {});
});

test('unknown availability is treated as healthy', () => {
	const plan = buildPlan(settings(), PROXY_TARGET, {});
	assert.equal(plan.kind, 'proxy');
});

test('the plan key changes only when the installed policy changes', () => {
	const a = buildPlan(settings(), PROXY_TARGET, { available: true });
	const b = buildPlan(settings(), PROXY_TARGET, { available: true });
	const down = buildPlan(settings(), PROXY_TARGET, { available: false });
	const direct = buildPlan(settings(), { proxyUrl: null }, {});
	assert.equal(a.key, b.key);
	assert.notEqual(a.key, down.key);
	assert.notEqual(a.key, direct.key);
	assert.equal(planKey('off', null), 'off');
});

test('the bypass list changes when model routing is turned off', () => {
	const withModel = buildPlan(settings(), PROXY_TARGET, { available: true });
	const withoutModel = buildPlan(settings({ keepModelDirect: false }), PROXY_TARGET, { available: true });
	assert.ok(withModel.env.no_proxy.includes('deepseek.com'));
	assert.ok(!withoutModel.env.no_proxy.includes('deepseek.com'));
	assert.notEqual(withModel.key, withoutModel.key);
});
