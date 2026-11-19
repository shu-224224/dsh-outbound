/**
 * dsh-outbound — browser-side settings row.
 *
 * This module is evaluated in the harness web shell. The shell publishes a
 * minimal AMD-flavoured loader on `window.__ModuleLoader__`; the plugin hands it
 * a factory so React is resolved through the shell instead of being bundled
 * twice. Everything below the factory is ordinary React written with
 * `createElement` (the shell does not run a JSX transform).
 *
 * The row is intentionally small: a mode selector, an optional proxy address,
 * one bypass switch, and the emergency direct list. All validation happens in
 * the browser so an invalid draft never reaches the configuration store; the
 * host re-validates the same values when it builds the routing plan.
 */

const MODULE_ID = 'dsh-outbound';
const NAMESPACE = 'dsh-outbound';
const STYLE_ELEMENT_ID = 'obr-settings-row-style';
const MODE_VALUES = ['direct', 'system', 'manual'];

/** Shown in the proxy field; a loopback proxy is the common local setup. */
const PROXY_EXAMPLE = 'http://127.0.0.1:7890';

const COPY = {
	zh: {
		title: '出站代理',
		description: '模型流量直连 DeepSeek，其余流量按下面的策略走代理；代理不可用时保持 fail-closed，只放行应急直连名单。',
		modeLabel: '代理策略',
		modeDirect: '直连（从不使用代理）',
		modeSystem: '跟随系统代理',
		modeManual: '手动指定代理',
		proxyLabel: '代理地址',
		proxyPlaceholder: `例如 ${PROXY_EXAMPLE}`,
		proxyHint: '只接受 http:// 或 https:// 地址，必须包含主机名，且不能带用户名或密码。',
		keepModelDirect: '模型流量绕过代理',
		keepModelDirectHint: 'deepseek.com 始终直连，模型请求不依赖代理是否可用。',
		emergencyLabel: '应急直连名单',
		emergencyHint: '每行一个条目，也可以用逗号分隔。接受主机名、IPv4、IPv6（方括号可带端口）；不接受空白条目、通配符、CIDR 或 <local>。',
		save: '保存',
		saving: '保存中…',
		appliesHint: '保存后立即生效，无需重启。',
		saved: '已保存，立即生效，无需重启。',
		savedNothing: '没有改动，当前配置已保存。',
		readonly: '当前配置为只读，无法在这里修改。',
		loading: '正在读取配置…',
		unavailable: '配置暂不可用。',
		invalidProxy: '代理地址无效：必须以 http:// 或 https:// 开头，包含主机名，且不能带用户名或密码。',
		proxyRequired: '手动模式需要填写代理地址。',
		invalidHosts: '应急直连名单里有无效条目：',
		saveFailed: '保存失败：',
		hostWildcard: '不支持通配符',
		hostCidr: '不支持 CIDR 网段',
		hostLocal: '<local> 不受支持',
		hostBlank: '条目不能为空',
		hostWhitespace: '条目里不能有空白字符',
		hostPort: '端口无效',
		hostIpv6: 'IPv6 地址无效',
		hostName: '不是有效的主机名或 IP 地址'
	},
	en: {
		title: 'Outbound proxy',
		description: 'Model traffic reaches DeepSeek directly; everything else follows the policy below. When the proxy is unavailable the plugin fails closed and only the emergency direct list is allowed through.',
		modeLabel: 'Proxy policy',
		modeDirect: 'Direct (never use a proxy)',
		modeSystem: 'Follow the system proxy',
		modeManual: 'Manual proxy',
		proxyLabel: 'Proxy address',
		proxyPlaceholder: `e.g. ${PROXY_EXAMPLE}`,
		proxyHint: 'Only http:// or https:// URLs with a host name are accepted; credentials are not allowed.',
		keepModelDirect: 'Keep model traffic off the proxy',
		keepModelDirectHint: 'deepseek.com always goes direct, so model requests do not depend on proxy health.',
		emergencyLabel: 'Emergency direct list',
		emergencyHint: 'One entry per line, or separate with commas. Host names, IPv4, and IPv6 (bracketed, optionally with a port) are accepted; blank entries, wildcards, CIDR ranges, and <local> are rejected.',
		save: 'Save',
		saving: 'Saving…',
		appliesHint: 'Changes take effect immediately; no restart needed.',
		saved: 'Saved; changes take effect immediately, no restart needed.',
		savedNothing: 'Nothing changed — the configuration is already saved.',
		readonly: 'This configuration is read-only and cannot be edited here.',
		loading: 'Reading the configuration…',
		unavailable: 'The configuration is not available yet.',
		invalidProxy: 'Invalid proxy address: use http:// or https://, include a host name, and leave out credentials.',
		proxyRequired: 'Manual mode needs a proxy address.',
		invalidHosts: 'These emergency direct entries are invalid: ',
		saveFailed: 'Saving failed: ',
		hostWildcard: 'wildcards are not supported',
		hostCidr: 'CIDR ranges are not supported',
		hostLocal: '<local> is not supported',
		hostBlank: 'entries cannot be blank',
		hostWhitespace: 'entries cannot contain whitespace',
		hostPort: 'invalid port',
		hostIpv6: 'invalid IPv6 address',
		hostName: 'not a valid host name or IP address'
	}
};

/** Fallback translation used when the locale service is unavailable. */
function translate(t, key) {
	try {
		const value = typeof t === 'function' ? t(key) : undefined;
		if (typeof value === 'string' && value.trim()) return value;
	} catch {
		/* fall through to the built-in copy */
	}
	return COPY.zh[key] ?? key;
}

/** Render an unknown thrown value as a short sentence fragment. */
function describeError(error) {
	if (error instanceof Error && error.message) return error.message;
	const text = String(error ?? '').trim();
	return text || 'unknown error';
}

/** Read the configuration snapshot without letting a broken scope escape. */
function readSnapshot(scope) {
	if (!scope || typeof scope.getSnapshot !== 'function') return null;
	try {
		const snapshot = scope.getSnapshot();
		return snapshot && typeof snapshot === 'object' ? snapshot : null;
	} catch {
		return null;
	}
}

/** Resolve the plugin's configuration scope, tolerating a missing service. */
function findScope(ctx) {
	try {
		const forms = ctx?.configForms;
		if (!forms || typeof forms.get !== 'function') return undefined;
		return forms.get(MODULE_ID) ?? undefined;
	} catch {
		return undefined;
	}
}

/** Bind the locale namespace, or return a translator backed by the built-in copy. */
function bindTranslator(ctx) {
	try {
		const locale = ctx?.locale;
		if (locale && typeof locale.bind === 'function') {
			const bound = locale.bind(NAMESPACE);
			if (typeof bound === 'function') return bound;
		}
	} catch {
		/* the built-in copy is still usable */
	}
	return (key) => COPY.zh[key] ?? key;
}

/**
 * Styles for the row.
 *
 * Class names all start with `obr-` so they cannot collide with another
 * plugin's settings styles. Colours derive from `currentColor` to work in both
 * the light and dark shells.
 */
const ROW_STYLES = `
.obr-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
	gap: 6px 28px;
	padding: 16px 0;
	border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	align-items: start;
}
.obr-heading { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.obr-title { font-size: 14px; font-weight: 600; line-height: 1.4; }
.obr-description { font-size: 12px; line-height: 1.55; opacity: 0.68; }
.obr-controls { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.obr-field { display: flex; flex-direction: column; gap: 5px; }
.obr-label { font-size: 12px; font-weight: 500; line-height: 1.4; }
.obr-input, .obr-select, .obr-textarea {
	box-sizing: border-box;
	width: 100%;
	font: inherit;
	font-size: 13px;
	color: inherit;
	background: color-mix(in srgb, currentColor 5%, transparent);
	border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
	border-radius: 6px;
	padding: 7px 9px;
	outline: none;
	transition: border-color 120ms ease, box-shadow 120ms ease;
}
.obr-textarea { min-height: 72px; resize: vertical; line-height: 1.5; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.obr-input:focus, .obr-select:focus, .obr-textarea:focus {
	border-color: color-mix(in srgb, currentColor 46%, transparent);
	box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 10%, transparent);
}
.obr-input:disabled, .obr-select:disabled, .obr-textarea:disabled,
.obr-button:disabled { opacity: 0.55; cursor: not-allowed; }
.obr-check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 1.45; }
.obr-check input { margin: 2px 0 0; accent-color: currentColor; }
.obr-check-text { display: flex; flex-direction: column; gap: 2px; }
.obr-hint { font-size: 11px; line-height: 1.5; opacity: 0.58; }
.obr-message { margin: 0; font-size: 12px; line-height: 1.5; }
.obr-message--ok { opacity: 0.75; }
.obr-message--error { color: #d9534f; }
.obr-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 2px; }
.obr-button {
	font: inherit;
	font-size: 13px;
	font-weight: 500;
	color: inherit;
	background: color-mix(in srgb, currentColor 10%, transparent);
	border: 1px solid color-mix(in srgb, currentColor 26%, transparent);
	border-radius: 6px;
	padding: 6px 16px;
	cursor: pointer;
}
.obr-button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 16%, transparent); }
.obr-button:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 55%, transparent); outline-offset: 2px; }
.obr-row--locked .obr-controls { opacity: 0.72; }
@media (max-width: 720px) {
	.obr-row { grid-template-columns: minmax(0, 1fr); }
}
`;

/** Insert the row stylesheet once; returns a disposer for the injected node. */
function installStyles() {
	if (typeof document === 'undefined') return () => {};
	const head = document.head;
	if (!head) return () => {};
	if (document.getElementById(STYLE_ELEMENT_ID)) return () => {};
	const style = document.createElement('style');
	style.id = STYLE_ELEMENT_ID;
	style.textContent = ROW_STYLES;
	head.appendChild(style);
	return () => {
		try {
			style.remove();
		} catch {
			/* the shell may have replaced the head node already */
		}
	};
}

/* ------------------------------------------------------------------ */
/* Host list parsing                                                   */
/* ------------------------------------------------------------------ */

const PORT_PATTERN = /^\d{1,5}$/;
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidPort(text) {
	if (!PORT_PATTERN.test(text)) return false;
	const port = Number(text);
	return port >= 1 && port <= 65535;
}

function isValidIpv4(text) {
	const match = IPV4_PATTERN.exec(text);
	if (!match) return false;
	for (let index = 1; index < match.length; index += 1) {
		if (Number(match[index]) > 255) return false;
	}
	return true;
}

function isValidIpv6(input) {
	let text = String(input ?? '').toLowerCase();
	if (!text || !/^[0-9a-f:.]+$/.test(text)) return false;

	// Accept an embedded dotted-quad tail (`::ffff:192.0.2.1`) by turning it
	// into two ordinary hexadecimal groups before counting groups.
	if (text.includes('.')) {
		const cut = text.lastIndexOf(':');
		if (cut < 0) return false;
		const tail = text.slice(cut + 1);
		if (!isValidIpv4(tail)) return false;
		text = `${text.slice(0, cut)}:0:0`;
	}

	if (text === '::') return true;
	if ((text.match(/::/g) ?? []).length > 1) return false;

	const compressed = text.includes('::');
	const groups = [];
	for (const half of text.split('::')) {
		if (!half) continue;
		for (const group of half.split(':')) {
			if (!/^[0-9a-f]{1,4}$/.test(group)) return false;
			groups.push(group);
		}
	}
	return compressed ? groups.length < 8 : groups.length === 8;
}

function isValidHostname(input) {
	const text = String(input ?? '');
	if (!text || text.length > 253) return false;
	const labels = text.endsWith('.') ? text.slice(0, -1).split('.') : text.split('.');
	if (!labels.length) return false;
	return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function hostError(reason) {
	return { ok: false, reason };
}

/**
 * Validate one emergency direct entry.
 *
 * @returns `{ ok: true, value }`, `{ ok: true, skip: true }` for a blank line,
 * or `{ ok: false, reason }` with a copy key describing the rejection.
 */
function parseHostEntry(raw) {
	const text = String(raw ?? '').trim().toLowerCase();
	if (!text) return { ok: true, skip: true };
	if (text.includes('*')) return hostError('hostWildcard');
	if (text === '<local>') return hostError('hostLocal');
	if (text.includes('/')) return hostError('hostCidr');
	if (/\s/.test(text)) return hostError('hostWhitespace');

	if (text.startsWith('[')) {
		const match = /^\[([^\]]+)\](?::([^:]+))?$/.exec(text);
		if (!match) return hostError('hostIpv6');
		if (!isValidIpv6(match[1])) return hostError('hostIpv6');
		if (match[2] !== undefined && !isValidPort(match[2])) return hostError('hostPort');
		return { ok: true, value: match[2] === undefined ? `[${match[1]}]` : `[${match[1]}]:${match[2]}` };
	}

	const colons = (text.match(/:/g) ?? []).length;
	if (colons > 1) {
		return isValidIpv6(text) ? { ok: true, value: text } : hostError('hostIpv6');
	}

	let host = text;
	let port = '';
	if (colons === 1) {
		const cut = text.lastIndexOf(':');
		host = text.slice(0, cut);
		port = text.slice(cut + 1);
		if (!isValidPort(port)) return hostError('hostPort');
	}

	if (isValidIpv4(host)) return { ok: true, value: port ? `${host}:${port}` : host };
	// A dotted all-numeric string that is not a valid dotted quad is a typo, not
	// a host name; rejecting it prevents a "10.0.0.999" entry from slipping in.
	if (/^\d+(?:\.\d+)*$/.test(host)) return hostError('hostName');
	if (!isValidHostname(host)) return hostError('hostName');
	return { ok: true, value: port ? `${host}:${port}` : host };
}

/** Parse the textarea into validated, de-duplicated hosts plus per-entry errors. */
function parseHostText(text) {
	const hosts = [];
	const errors = [];
	const seen = new Set();
	const raw = String(text ?? '');
	if (!raw.trim()) return { hosts, errors };

	const pieces = raw.split(/[\n,]/);
	// Leading/trailing blank lines are an artefact of typing, not entries; a
	// blank gap between two entries is a real mistake and is reported.
	let start = 0;
	let end = pieces.length;
	while (start < end && !pieces[start].trim()) start += 1;
	while (end > start && !pieces[end - 1].trim()) end -= 1;

	for (let index = start; index < end; index += 1) {
		const piece = pieces[index];
		if (!piece.trim()) {
			errors.push({ text: '', reason: 'hostBlank' });
			continue;
		}
		const entry = parseHostEntry(piece);
		if (entry.skip) continue;
		if (!entry.ok) {
			errors.push({ text: piece.trim(), reason: entry.reason });
			continue;
		}
		if (seen.has(entry.value)) continue;
		seen.add(entry.value);
		hosts.push(entry.value);
	}
	return { hosts, errors };
}

/* ------------------------------------------------------------------ */
/* Proxy parsing                                                       */
/* ------------------------------------------------------------------ */

/**
 * Inspect a proxy address.
 *
 * @returns `{ ok: true, value }` with a normalized URL, or
 * `{ ok: false, empty?, reason? }`.
 */
function inspectProxy(raw) {
	const text = String(raw ?? '').trim();
	if (!text) return { ok: false, empty: true };
	let url;
	try {
		url = new URL(text);
	} catch {
		return { ok: false, reason: 'parse' };
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
	if (!url.hostname) return { ok: false, reason: 'host' };
	if (url.username || url.password) return { ok: false, reason: 'credentials' };
	return { ok: true, value: url.href.replace(/\/$/, '') };
}

/* ------------------------------------------------------------------ */
/* Draft helpers                                                       */
/* ------------------------------------------------------------------ */

function draftFromValue(value) {
	const source = value && typeof value === 'object' ? value : {};
	const hosts = Array.isArray(source.emergencyDirectHosts)
		? source.emergencyDirectHosts.filter((entry) => typeof entry === 'string')
		: [];
	return {
		mode: MODE_VALUES.includes(source.mode) ? source.mode : 'system',
		proxy: typeof source.proxy === 'string' ? source.proxy : '',
		keepModelDirect: source.keepModelDirect !== false,
		emergency: hosts.join('\n')
	};
}

function sameList(left, right) {
	if (left.length !== right.length) return false;
	return left.every((entry, index) => entry === right[index]);
}

/** Fields of the stored value the draft can change, in comparable form. */
function baselineFromValue(value) {
	const draft = draftFromValue(value);
	const proxy = inspectProxy(draft.proxy);
	return {
		mode: draft.mode,
		proxy: proxy.ok ? proxy.value : draft.proxy.trim(),
		keepModelDirect: draft.keepModelDirect,
		hosts: parseHostText(draft.emergency).hosts
	};
}

function isDirty(draft, baseline) {
	if (draft.mode !== baseline.mode) return true;
	if (draft.keepModelDirect !== baseline.keepModelDirect) return true;
	if (!sameList(parseHostText(draft.emergency).hosts, baseline.hosts)) return true;
	if (draft.mode === 'manual') {
		const proxy = inspectProxy(draft.proxy);
		const current = proxy.ok ? proxy.value : draft.proxy.trim();
		if (current !== baseline.proxy) return true;
	}
	return false;
}

/** Build the `set` operations for every field whose value actually changed. */
function buildOperations(draft, baseline) {
	const operations = [];
	if (draft.mode !== baseline.mode) {
		operations.push({ op: 'set', path: ['mode'], value: draft.mode });
	}
	if (draft.keepModelDirect !== baseline.keepModelDirect) {
		operations.push({ op: 'set', path: ['keepModelDirect'], value: draft.keepModelDirect });
	}
	const hosts = parseHostText(draft.emergency).hosts;
	if (!sameList(hosts, baseline.hosts)) {
		operations.push({ op: 'set', path: ['emergencyDirectHosts'], value: hosts });
	}
	if (draft.mode === 'manual') {
		const proxy = inspectProxy(draft.proxy);
		if (proxy.ok && proxy.value !== baseline.proxy) {
			operations.push({ op: 'set', path: ['proxy'], value: proxy.value });
		}
	}
	return operations;
}

/* ------------------------------------------------------------------ */
/* React row                                                           */
/* ------------------------------------------------------------------ */

function createRow(React) {
	const { useEffect, useMemo, useRef, useState } = React;

	return function OutboundSettingsRow(props) {
		const scope = props?.scope;
		const t = props?.t;
		const tr = (key) => translate(t, key);

		const [snapshot, setSnapshot] = useState(() => readSnapshot(scope));
		const [draft, setDraft] = useState(() => draftFromValue(snapshot?.value));
		const [message, setMessage] = useState(null);
		const [saving, setSaving] = useState(false);
		const revisionRef = useRef(snapshot?.revision);

		// Subscribe once per scope. A notification with a new revision means
		// somebody else changed the stored configuration, so the draft is reset;
		// notifications with the same revision (status updates, own mutations)
		// never clobber what the user is typing.
		useEffect(() => {
			if (!scope || typeof scope.subscribe !== 'function') return undefined;
			let active = true;

			const accept = (next) => {
				if (!active || !next) return;
				setSnapshot(next);
				const previousRevision = revisionRef.current;
				revisionRef.current = next.revision;
				if (next.revision !== previousRevision) {
					setDraft(draftFromValue(next.value));
				}
			};

			let unsubscribe;
			try {
				unsubscribe = scope.subscribe(accept);
			} catch {
				return undefined;
			}
			// Cover the window between the initial render and the subscription.
			accept(readSnapshot(scope));

			return () => {
				active = false;
				try {
					if (typeof unsubscribe === 'function') unsubscribe();
				} catch {
					/* the scope may already be disposed */
				}
			};
		}, [scope]);

		const baseline = useMemo(() => baselineFromValue(snapshot?.value), [snapshot]);
		const dirty = useMemo(() => isDirty(draft, baseline), [draft, baseline]);

		const ready = snapshot?.status === undefined || snapshot?.status === 'ready';
		const readonly = snapshot?.writable === false;
		const locked = readonly || !ready;
		const disabled = locked || saving;

		const patch = (fields) => {
			setDraft((current) => ({ ...current, ...fields }));
			setMessage(null);
		};

		const handleSave = async () => {
			if (!scope || locked || saving) return;

			const hosts = parseHostText(draft.emergency);
			const proxy = draft.mode === 'manual' ? inspectProxy(draft.proxy) : null;

			if (proxy && !proxy.ok) {
				setMessage({
					tone: 'error',
					text: tr(proxy.empty ? 'proxyRequired' : 'invalidProxy')
				});
				return;
			}
			if (hosts.errors.length) {
				const details = hosts.errors
					.map((entry) => (entry.text ? `${entry.text} (${tr(entry.reason)})` : tr(entry.reason)))
					.join('; ');
				setMessage({ tone: 'error', text: `${tr('invalidHosts')}${details}` });
				return;
			}

			const operations = buildOperations(draft, baseline);
			if (!operations.length) {
				setMessage({ tone: 'ok', text: tr('savedNothing') });
				return;
			}

			setSaving(true);
			setMessage(null);
			try {
				const current = readSnapshot(scope) ?? snapshot;
				await scope.mutate(operations, current?.revision);
				const after = readSnapshot(scope);
				if (after) {
					revisionRef.current = after.revision;
					setSnapshot(after);
					setDraft(draftFromValue(after.value));
				}
				setMessage({ tone: 'ok', text: tr('saved') });
			} catch (error) {
				setMessage({ tone: 'error', text: `${tr('saveFailed')}${describeError(error)}` });
			} finally {
				setSaving(false);
			}
		};

		if (!scope || !snapshot) return null;

		const h = React.createElement;
		const messageNode = message
			? h(
					'p',
					{
						className: `obr-message obr-message--${message.tone}`,
						role: message.tone === 'error' ? 'alert' : 'status'
					},
					message.text
				)
			: null;

		const notice = locked
			? h('p', { className: 'obr-hint', role: 'note' }, tr(readonly ? 'readonly' : 'loading'))
			: null;

		return h(
			'div',
			{ className: `obr-row${locked ? ' obr-row--locked' : ''}` },
			h(
				'div',
				{ className: 'obr-heading' },
				h('div', { className: 'obr-title' }, tr('title')),
				h('div', { className: 'obr-description' }, tr('description'))
			),
			h(
				'div',
				{ className: 'obr-controls' },
				h(
					'label',
					{ className: 'obr-field' },
					h('span', { className: 'obr-label' }, tr('modeLabel')),
					h(
						'select',
						{
							className: 'obr-select',
							value: draft.mode,
							disabled,
							onChange: (event) => patch({ mode: event.target.value })
						},
						h('option', { value: 'direct' }, tr('modeDirect')),
						h('option', { value: 'system' }, tr('modeSystem')),
						h('option', { value: 'manual' }, tr('modeManual'))
					)
				),
				draft.mode === 'manual'
					? h(
							'label',
							{ className: 'obr-field' },
							h('span', { className: 'obr-label' }, tr('proxyLabel')),
							h('input', {
								className: 'obr-input',
								type: 'text',
								inputMode: 'url',
								spellCheck: false,
								autoComplete: 'off',
								placeholder: tr('proxyPlaceholder'),
								value: draft.proxy,
								disabled,
								onChange: (event) => patch({ proxy: event.target.value })
							}),
							h('span', { className: 'obr-hint' }, tr('proxyHint'))
						)
					: null,
				h(
					'label',
					{ className: 'obr-check' },
					h('input', {
						type: 'checkbox',
						checked: draft.keepModelDirect,
						disabled,
						onChange: (event) => patch({ keepModelDirect: event.target.checked })
					}),
					h(
						'span',
						{ className: 'obr-check-text' },
						h('span', null, tr('keepModelDirect')),
						h('span', { className: 'obr-hint' }, tr('keepModelDirectHint'))
					)
				),
				h(
					'label',
					{ className: 'obr-field' },
					h('span', { className: 'obr-label' }, tr('emergencyLabel')),
					h('textarea', {
						className: 'obr-textarea',
						rows: 3,
						spellCheck: false,
						placeholder: 'api.example.com, 10.0.0.5',
						value: draft.emergency,
						disabled,
						onChange: (event) => patch({ emergency: event.target.value })
					}),
					h('span', { className: 'obr-hint' }, tr('emergencyHint'))
				),
				messageNode,
				h(
					'div',
					{ className: 'obr-actions' },
					h(
						'button',
						{
							type: 'button',
							className: 'obr-button',
							disabled,
							onClick: handleSave
						},
						saving ? tr('saving') : tr('save')
					),
					h('span', { className: 'obr-hint' }, tr('appliesHint')),
					!disabled && !dirty && !message ? h('span', { className: 'obr-hint' }, tr('savedNothing')) : null
				),
				notice
			)
		);
	};
}

/* ------------------------------------------------------------------ */
/* Module wiring                                                       */
/* ------------------------------------------------------------------ */

const inject = ['slots', 'locale', 'configForms'];

/** Build the plugin's `apply` around the React runtime supplied by the shell. */
function createApply(React) {
	const Row = createRow(React);

	return function apply(ctx) {
		if (!ctx) return;

		// Locale copy: registering through `effect` ties the disposer to the plugin
		// lifetime, so a hot reload does not leave duplicate dictionaries behind.
		try {
			ctx.effect(() => ctx.locale.register(NAMESPACE, COPY), 'dsh-outbound: settings copy');
		} catch {
			// The built-in Chinese copy keeps the row readable.
		}

		try {
			ctx.effect(installStyles, 'dsh-outbound: settings row styles');
		} catch {
			// Unstyled controls still work if the shell forbids head injection.
		}

		const t = bindTranslator(ctx);
		let scope = findScope(ctx);

		// The config scope may be created after the plugin starts; resolve lazily and
		// remember a successful lookup so every row mount sees the same object.
		const currentScope = () => {
			if (!scope) scope = findScope(ctx);
			return scope;
		};

		try {
			ctx.effect(
				() =>
					ctx.slots.inject('settings.general.item', () =>
						ctx.slots.register(
							{
								name: 'settings.general.item',
								id: MODULE_ID,
								order: 25,
								locale: NAMESPACE,
								inject: () => ({ scope: currentScope(), t })
							},
							Row
						)
					),
				'dsh-outbound: settings row'
			);
		} catch {
			// Without the settings slot there is nothing to render; the host-side
			// plugin is independent of this row.
		}
	};
}

function factory(require) {
	const React = require('react');
	return { apply: createApply(React), inject };
}

const loader = typeof window !== 'undefined' ? window.__ModuleLoader__ : undefined;
if (loader && typeof loader.load === 'function') {
	loader.load({ id: MODULE_ID, factory });
}
