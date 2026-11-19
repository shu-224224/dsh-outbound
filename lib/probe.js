/**
 * Proxy health probe.
 *
 * The probe fetches a small URL through the proxy. Any HTTP answer proves the
 * tunnel reached the origin; authentication demands (407), server errors, and
 * transport errors mean it did not.
 *
 * `undici` is imported lazily so the plugin still loads (and can run in
 * `direct` mode) in a runtime where the transport is unavailable.
 */

/**
 * Classify one probe response status.
 *
 * @param status - HTTP status returned through the proxy.
 * @returns whether the tunnel is usable.
 */
export function classifyProbeStatus(status) {
	if (!Number.isInteger(status)) return false;
	if (status === 407) return false;
	return status >= 200 && status < 500;
}

/**
 * Create one reusable prober.
 *
 * A proxy agent is cached per proxy URL; recreating an agent on every probe
 * leaks sockets and turns a 5 second health check into a steady stream of
 * connections.
 *
 * @param options - `{ timeoutMs?: number }`.
 * @returns `{ probe(proxyUrl, probeUrl, timeoutMs?), close() }`.
 */
export function createProber(options = {}) {
	const defaultTimeout = options.timeoutMs ?? 2_500;
	let undiciPromise = null;
	const agents = new Map();

	function loadUndici() {
		if (!undiciPromise) {
			undiciPromise = import('undici').catch((error) => {
				undiciPromise = null;
				throw new Error(`undici is unavailable: ${String(error?.message ?? error)}`);
			});
		}
		return undiciPromise;
	}

	async function agentFor(undici, proxyUrl) {
		const cached = agents.get(proxyUrl);
		if (cached) return cached;
		const agent = new undici.ProxyAgent({ uri: proxyUrl });
		agents.set(proxyUrl, agent);
		return agent;
	}

	return {
		/**
		 * Fetch `probeUrl` through `proxyUrl`.
		 *
		 * @returns `{ ok, status?, error? }`; never throws.
		 */
		async probe(proxyUrl, probeUrl, timeoutMs = defaultTimeout) {
			if (!proxyUrl || !probeUrl) return { ok: false, error: 'missing proxy or probe URL' };
			try {
				const undici = await loadUndici();
				const dispatcher = await agentFor(undici, proxyUrl);
				const response = await undici.fetch(probeUrl, {
					dispatcher,
					method: 'GET',
					redirect: 'manual',
					signal: AbortSignal.timeout(timeoutMs)
				});
				try {
					await response.body?.cancel?.();
				} catch {
					/* the body is not needed */
				}
				return { ok: classifyProbeStatus(response.status), status: response.status };
			} catch (error) {
				return { ok: false, error: String(error?.message ?? error) };
			}
		},

		/** Close every cached agent; called when the plugin stops. */
		async close() {
			const pending = [...agents.values()];
			agents.clear();
			for (const agent of pending) {
				try {
					await agent.close?.();
				} catch {
					/* already closed */
				}
			}
		}
	};
}
