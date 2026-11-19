import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../lib/engine.js';
import { resolveSettings } from '../lib/settings.js';

function flush() {
	return new Promise((resolve) => setImmediate(resolve));
}

async function settle(rounds = 6) {
	for (let i = 0; i < rounds; i += 1) await flush();
}

/**
 * Deterministic harness: fake clock, fake target, fake probe, recording installer.
 */
function createHarness(initial = {}) {
	let now = 1_000;
	let sequence = 0;
	const timers = new Map();
	const clock = {
		now: () => now,
		setTimeout(handler, delayMs) {
			const id = ++sequence;
			timers.set(id, { handler, at: now + Math.max(1, delayMs) });
			return id;
		},
		clearTimeout(id) {
			timers.delete(id);
		}
	};

	let settings = resolveSettings({ pollIntervalMs: 1_000, probeIntervalMs: 5_000, ...initial });
	const installs = [];
	const disposes = [];
	const probes = [];
	let target = { proxyUrl: null, key: 'none' };
	let probeResult = true;

	const engine = createEngine({
		settings: () => settings,
		readTarget: async () => target,
		probe: async (proxyUrl) => {
			probes.push(proxyUrl);
			return probeResult;
		},
		install: async (env) => {
			const installed = { ...env };
			installs.push(installed);
			return async () => {
				disposes.push(installed);
			};
		},
		log: () => {},
		clock
	});

	async function advance(ms) {
		const end = now + ms;
		for (;;) {
			let nextId = null;
			let nextAt = Number.POSITIVE_INFINITY;
			for (const [id, timer] of timers) {
				if (timer.at < nextAt) {
					nextAt = timer.at;
					nextId = id;
				}
			}
			if (nextId === null || nextAt > end) break;
			const timer = timers.get(nextId);
			timers.delete(nextId);
			now = nextAt;
			timer.handler();
			await settle();
		}
		now = end;
		await settle();
	}

	return {
		engine,
		advance,
		installs,
		disposes,
		probes,
		setSettings: (patch) => {
			settings = resolveSettings({ pollIntervalMs: 1_000, probeIntervalMs: 5_000, ...patch });
		},
		setTarget: (next) => {
			target = next;
		},
		setProbe: (value) => {
			probeResult = value;
		},
		timerCount: () => timers.size
	};
}

const PROXY = { proxyUrl: 'http://127.0.0.1:7890', key: 'manual:http://127.0.0.1:7890' };

test('starting without a proxy installs the direct policy once', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 5_000 });
	harness.engine.start();
	await settle();
	assert.equal(harness.installs.length, 1);
	assert.deepEqual(harness.installs[0], {});
	await harness.advance(1_000);
	assert.equal(harness.installs.length, 1);
	assert.equal(harness.probes.length, 0);
});

test('a proxy appearing on a later poll installs the proxied policy', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 5_000 });
	harness.engine.start();
	await settle();
	harness.setTarget(PROXY);
	await harness.advance(1_000);
	assert.equal(harness.installs.length, 2);
	assert.equal(harness.installs[1].http_proxy, 'http://127.0.0.1:7890');
	assert.deepEqual(harness.probes, ['http://127.0.0.1:7890']);
});

test('a proxy disappearing installs the direct policy again', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 5_000 });
	harness.engine.start();
	await settle();
	harness.setTarget(PROXY);
	await harness.advance(1_000);
	harness.setTarget({ proxyUrl: null, key: 'none' });
	await harness.advance(1_000);
	assert.deepEqual(harness.installs.at(-1), {});
});

test('a failed probe fails closed while keeping the emergency bypass list', async () => {
	const harness = createHarness({
		mode: 'system',
		pollIntervalMs: 1_000,
		probeIntervalMs: 5_000,
		emergencyDirectHosts: ['baidu.com'],
		fallbackToDirect: false
	});
	harness.setProbe(false);
	harness.setTarget(PROXY);
	harness.engine.start();
	await settle();
	const installed = harness.installs.at(-1);
	assert.equal(installed.http_proxy, 'http://127.0.0.1:7890');
	assert.ok(installed.no_proxy.split(',').includes('baidu.com'));
});

test('a recovering probe installs the normal proxied policy again', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 5_000 });
	harness.setProbe(false);
	harness.setTarget(PROXY);
	harness.engine.start();
	await settle();
	assert.ok(!harness.installs.at(-1).no_proxy.includes('baidu.com'));
	harness.setProbe(true);
	harness.setTarget({ proxyUrl: PROXY.proxyUrl, key: 'changed' });
	await harness.advance(1_000);
	assert.equal(harness.installs.at(-1).http_proxy, 'http://127.0.0.1:7890');
});

test('fallbackToDirect turns a failed probe into a direct policy', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 5_000, fallbackToDirect: true });
	harness.setProbe(false);
	harness.setTarget(PROXY);
	harness.engine.start();
	await settle();
	assert.deepEqual(harness.installs.at(-1), {});
});

test('probeIntervalMs = 0 treats a present target as healthy without probing', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 0 });
	harness.setTarget(PROXY);
	harness.engine.start();
	await settle();
	assert.equal(harness.probes.length, 0);
	assert.equal(harness.installs.at(-1).http_proxy, 'http://127.0.0.1:7890');
});

test('probeIntervalMs = 0 drops the stale "unavailable" result from earlier probes', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 5_000 });
	harness.setProbe(false);
	harness.setTarget(PROXY);
	harness.engine.start();
	await settle();
	assert.ok(harness.installs.at(-1).no_proxy.includes('localhost'));
	harness.setSettings({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 0 });
	harness.engine.refresh();
	await settle();
	assert.equal(harness.probes.length, 1);
	assert.equal(harness.installs.at(-1).http_proxy, 'http://127.0.0.1:7890');
	assert.ok(!harness.installs.at(-1).no_proxy.includes('baidu.com'));
});

test('pollIntervalMs = 0 stops background polling until refresh is called', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 0, probeIntervalMs: 5_000 });
	harness.engine.start();
	await settle();
	assert.equal(harness.timerCount(), 0);
	harness.setTarget(PROXY);
	await settle();
	assert.equal(harness.installs.length, 1);
	harness.engine.refresh();
	await settle();
	assert.equal(harness.installs.length, 2);
	assert.equal(harness.installs[1].http_proxy, 'http://127.0.0.1:7890');
});

test('stopping restores the launch policy and stops installing', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 5_000 });
	harness.setTarget(PROXY);
	harness.engine.start();
	await settle();
	const installed = harness.installs.at(-1);
	await harness.engine.stop();
	assert.equal(harness.disposes.length, 1);
	assert.deepEqual(harness.disposes[0], installed);
	const countAfterStop = harness.installs.length;
	await harness.advance(5_000);
	assert.equal(harness.installs.length, countAfterStop);
});

test('disabling the plugin restores the launch policy on the next poll', async () => {
	const harness = createHarness({ mode: 'system', pollIntervalMs: 1_000, probeIntervalMs: 5_000 });
	harness.setTarget(PROXY);
	harness.engine.start();
	await settle();
	harness.setSettings({ mode: 'system', enabled: false, pollIntervalMs: 1_000, probeIntervalMs: 5_000 });
	await harness.advance(1_000);
	assert.equal(harness.disposes.length, 1);
	assert.deepEqual(harness.installs.at(-1), harness.installs[0]);
	const status = harness.engine.status();
	assert.equal(status.kind, 'off');
});
