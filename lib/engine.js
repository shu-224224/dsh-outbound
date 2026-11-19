/**
 * Routing engine.
 *
 * Owns the lifecycle: poll the current proxy target, probe the tunnel when due,
 * build a plan, install it when it changed, and restore the launch policy when
 * the plugin stops.
 *
 * Every effect is injected (clock, target reader, probe, installer) so the same
 * machine can be driven by real Windows APIs in production and by fake ports in
 * tests.
 */

import { buildPlan } from './plan.js';

/** Poll period used when the config cannot be read. */
export const FALLBACK_POLL_MS = 2_000;

const defaultClock = {
	now: () => Date.now(),
	setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
	clearTimeout: (handle) => clearTimeout(handle)
};

function describe(error) {
	return String(error?.message ?? error);
}

/**
 * Create the engine.
 *
 * @param options - injected ports:
 *   - `settings()` returns the resolved settings (re-read on every tick);
 *   - `readTarget(settings)` returns `{ proxyUrl, key, reason }` (may be async);
 *   - `probe(proxyUrl, settings)` returns a boolean or a promise of one;
 *   - `install(envValues)` installs an environment overlay and returns a disposer;
 *   - `log(level, message)` records diagnostics;
 *   - `clock` provides `now`, `setTimeout`, `clearTimeout`.
 * @returns `{ start, refresh, stop, status }`.
 */
export function createEngine(options) {
	const { settings, readTarget, probe, install } = options;
	const log = options.log ?? (() => {});
	const clock = options.clock ?? defaultClock;

	let running = false;
	let timer = null;
	let appliedKey = null;
	let appliedKind = null;
	let dispose = null;
	let lastTargetKey = null;
	let lastProbeAt = 0;
	let lastAvailable = null;
	let busy = false;
	let queue = Promise.resolve();
	let status = { kind: 'idle', proxyUrl: null, available: null, reason: 'created', updatedAt: 0 };

	function record(plan, available) {
		status = {
			kind: plan.kind,
			proxyUrl: plan.proxyUrl ?? null,
			available,
			reason: plan.reason,
			updatedAt: clock.now()
		};
	}

	function enqueue(task) {
		const next = queue.then(task);
		queue = next.catch((error) => {
			log('error', `applying a routing plan failed: ${describe(error)}`);
		});
		return next;
	}

	function reportTransition(previousKind, plan) {
		if (previousKind === plan.kind) return;
		if (plan.kind === 'proxy') log('info', `proxy is healthy; routing through ${plan.proxyUrl}`);
		else if (plan.kind === 'fail-closed') {
			log('warn', `proxy is unavailable; only the emergency direct list bypasses it, every other request fails closed`);
		} else if (plan.kind === 'fallback') log('warn', 'proxy is unavailable and fallbackToDirect is on; every request goes direct');
		else if (plan.kind === 'direct') log('info', `routing direct (${plan.reason})`);
		else if (plan.kind === 'off') log('info', 'plugin disabled; the launch policy is in effect');
	}

	function installPlan(plan) {
		return enqueue(async () => {
			if (plan.key === appliedKey) return;
			const previousKind = appliedKind;
			const previous = dispose;
			dispose = null;
			if (previous) {
				try {
					await previous();
				} catch (error) {
					log('warn', `restoring the previous policy failed: ${describe(error)}`);
				}
			}
			if (plan.env === null) {
				appliedKey = plan.key;
				appliedKind = plan.kind;
				reportTransition(previousKind, plan);
				record(plan, null);
				return;
			}
			try {
				dispose = await install(plan.env);
				appliedKey = plan.key;
				appliedKind = plan.kind;
			} catch (error) {
				log('error', `installing the ${plan.kind} plan failed: ${describe(error)}`);
				try {
					dispose = await install({});
					appliedKey = 'fallback:direct';
					appliedKind = 'fallback';
				} catch (fallbackError) {
					log('error', `installing the direct fallback failed: ${describe(fallbackError)}`);
					appliedKey = null;
					appliedKind = null;
				}
			}
			reportTransition(previousKind, { ...plan, kind: appliedKind ?? plan.kind });
			record(plan, lastAvailable);
		});
	}

	async function evaluateTarget(settingsNow) {
		try {
			return (await readTarget(settingsNow)) ?? { proxyUrl: null, key: 'none', reason: 'no target' };
		} catch (error) {
			log('warn', `reading the proxy target failed: ${describe(error)}`);
			return { proxyUrl: null, key: 'error', reason: `target read failed: ${describe(error)}` };
		}
	}

	async function evaluateAvailability(settingsNow, target, targetChanged) {
		if (!target.proxyUrl) return null;
		// Probing is off: a present target is treated as usable. Stale probe
		// results from before the switch must not keep the plugin fail-closed.
		if (settingsNow.probeIntervalMs <= 0) return true;
		const now = clock.now();
		const due = targetChanged || lastProbeAt === 0 || now - lastProbeAt >= settingsNow.probeIntervalMs;
		if (!due) return lastAvailable;
		lastProbeAt = now;
		const result = await probe(target.proxyUrl, settingsNow);
		lastAvailable = result === true;
		return lastAvailable;
	}

	async function tick() {
		if (!running || busy) return;
		busy = true;
		try {
			const settingsNow = settings();
			const target = settingsNow.enabled ? await evaluateTarget(settingsNow) : { proxyUrl: null, key: 'none', reason: 'plugin disabled' };
			const targetChanged = target.key !== lastTargetKey;
			lastTargetKey = target.key;
			const available = settingsNow.enabled ? await evaluateAvailability(settingsNow, target, targetChanged) : null;
			const plan = buildPlanFor(settingsNow, target, available);
			await installPlan(plan);
		} finally {
			busy = false;
		}
	}

	function scheduleNext() {
		if (!running || timer !== null) return;
		let interval = FALLBACK_POLL_MS;
		try {
			interval = settings().pollIntervalMs;
		} catch {
			interval = FALLBACK_POLL_MS;
		}
		if (!(interval > 0)) return;
		timer = clock.setTimeout(() => {
			timer = null;
			runOnce();
		}, interval);
		timer?.unref?.();
	}

	function runOnce() {
		Promise.resolve()
			.then(tick)
			.catch((error) => log('error', `routing tick failed: ${describe(error)}`))
			.finally(scheduleNext);
	}

	function buildPlanFor(settingsNow, target, available) {
		const facts = available === null ? {} : { available };
		return buildPlan(settingsNow, target, facts);
	}

	return {
		/** Apply the plan now and start polling. */
		start() {
			if (running) return;
			running = true;
			lastTargetKey = null;
			lastProbeAt = 0;
			runOnce();
		},

		/** Re-read the target and replan without restarting the loop (config change). */
		refresh() {
			lastTargetKey = null;
			lastProbeAt = 0;
			if (!running) {
				this.start();
				return;
			}
			runOnce();
		},

		/** Restore the launch policy and stop polling. */
		async stop() {
			running = false;
			if (timer !== null) {
				clock.clearTimeout(timer);
				timer = null;
			}
			await queue.catch(() => {});
			const previous = dispose;
			dispose = null;
			if (previous) {
				try {
					await previous();
				} catch (error) {
					log('warn', `restoring the launch policy failed: ${describe(error)}`);
				}
			}
			appliedKey = null;
			appliedKind = null;
			status = { kind: 'stopped', proxyUrl: null, available: lastAvailable, reason: 'plugin stopped', updatedAt: clock.now() };
		},

		/** Current routing status; useful for diagnostics. */
		status() {
			return { ...status };
		}
	};
}
