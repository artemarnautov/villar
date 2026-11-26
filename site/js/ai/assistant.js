// Villar assistant bar — the AI input line under the 3D editor. Owner: assistant.
//
//   import { mountAssistant } from './ai/assistant.js';
//   const ai = mountAssistant({
//     container,                         // #assistant (the bar renders inside it)
//     store,                             // site/js/core/store.js instance (multi-style)
//     get villar() { return stage.engine; },   // engine: getter, function or object; read on every use
//     lang: 'ru',                        // 'ru' | 'en' | () => lang   (getView().lang wins if present)
//     getView: () => ({ view, time, lang }),   // optional: current camera preset, time of day, language
//     controls: { view(name), time(name), focus(slotId) },   // optional: route through the page UI
//     onFocus: (slotId) => {},           // optional: e.g. open the HUD for that slot
//   });
//   ai.setLang('en'); ai.ask('покажи вечер'); ai.focus(); ai.destroy();
//
// Never renders model text as HTML: everything goes in through textContent.
import { createSim } from './core.js';
import { parseLocal } from './local.js';
import { L, ui, keyLabel, itemName, delta as fmtDelta, aed, num, styleName, quoted, VIEW_LABELS, TIME_LABELS } from './i18n.js';

const ENDPOINT = '/api/assistant';
const CLIENT_TIMEOUT_MS = 11000;
const MAX_TURNS = 8;
const HISTORY_MAX = 12;
const ROTATE_MS = 3600;

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(name, cls = '') {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  if (cls) s.setAttribute('class', cls);
  const paths = {
    // four-point spark, the "designer" glyph
    spark: ['M12 2.6c.5 4.6 2.8 6.9 7.4 7.4-4.6.5-6.9 2.8-7.4 7.4-.5-4.6-2.8-6.9-7.4-7.4 4.6-.5 6.9-2.8 7.4-7.4Z', 'M18.6 15.4c.2 1.8 1.1 2.7 2.9 2.9-1.8.2-2.7 1.1-2.9 2.9-.2-1.8-1.1-2.7-2.9-2.9 1.8-.2 2.7-1.1 2.9-2.9Z'],
    up: ['M12 18.5V6', 'M6.5 11.2 12 5.7l5.5 5.5'],
    check: ['M5.5 12.5 10 17l8.5-9.5'],
    undo: ['M9 14 4.5 9.5 9 5', 'M5 9.5h9.5a5 5 0 0 1 0 10H11'],
    chevron: ['M7 10l5 5 5-5'],
  }[name] || [];
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    if (name === 'spark') { p.setAttribute('fill', 'currentColor'); }
    else { p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', name === 'check' ? '2.4' : '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); }
    s.append(p);
  }
  return s;
}
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
}
let uid = 0;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Slot type → the camera preset that shows its zone (fallback for engines without focus()). */
const ZONE_VIEW = {
  sofa: 'living', cushions: 'living', coffee_table: 'living', decor_set: 'living', rug: 'living', tv_unit: 'living',
  side_table: 'living', armchair: 'window', floor_lamp: 'window', throw: 'living', wall_art: 'living',
  bed: 'bed', mattress: 'bed', bedding: 'bed', nightstand: 'bed', table_lamp: 'bed', nightstand_decor: 'bed',
  dining_table: 'dining', dining_chair: 'dining', pendant_lamp: 'dining', tableware: 'dining', centerpiece: 'dining',
  kitchen_decor: 'dining', curtains: 'window', plant: 'window', mirror: 'eye', runner: 'eye',
};

function ensureStylesheet() {
  if (document.querySelector('link[href$="/css/assistant.css"], link[data-villar-ai]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/css/assistant.css'; link.dataset.villarAi = '';
  document.head.append(link);
}

export function mountAssistant(opts = {}) {
  // Options are read lazily: `villar` may be a getter (`get villar() { return stage.engine; }`) or a
  // function, and the language may change at runtime (getView().lang, opts.lang(), or ai.setLang()).
  const { container, store } = opts;
  if (!container || !store) { console.warn('[villar:ai] mountAssistant needs { container, store }'); return null; }
  if (opts.css !== false) ensureStylesheet();
  const endpoint = opts.endpoint || ENDPOINT;
  const data = opts.data || null;
  const getView = () => { try { return opts.getView?.() || null; } catch { return null; } };
  const id = `vai${++uid}`;
  let langOverride = null;
  const getLang = () => {
    if (langOverride) return L(langOverride);
    const l = getView()?.lang || (typeof opts.lang === 'function' ? opts.lang() : opts.lang) || document.documentElement.lang;
    return L(l);
  };
  const engine = () => { try { const v = opts.villar; return (typeof v === 'function' ? v() : v) || null; } catch { return null; } };
  const dataSet = () => {
    const s = store.state || {};
    return data || { catalog: s.catalog, layout: s.layout, packs: s.packs || (s.stylepack ? { [s.stylepack.id]: s.stylepack } : {}) };
  };
  let sim = createSim(dataSet());
  const styleNow = () => (typeof store.styleId === 'function' ? store.styleId() : store.state?.style || store.state?.stylepack?.id);
  const selectionNow = () => ({ ...(store.state?.selection || {}) });

  let lastView = null, lastTime = null;
  const sceneNow = () => {
    let v = null, t = null;
    const g = getView(); v = g?.view ?? null; t = g?.time ?? null;
    const e = engine();
    return { view: v || e?.view || lastView || null, time: t || e?.timeOfDay || lastTime || null };
  };
  const stateNow = () => ({ style: styleNow(), selection: selectionNow(), total: store.total?.() ?? 0, ...sceneNow() });

  // ---------------------------------------------------------------- DOM
  const S = () => ui(getLang());
  const live = el('div', { class: 'vai-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const histList = el('ol', { class: 'vai-history-list' });
  const history = el('div', { class: 'vai-history', id: `${id}-hist`, hidden: true }, el('div', { class: 'vai-history-inner' }, histList));
  const replyText = el('span', { class: 'vai-reply-text' });
  const modeTag = el('span', { class: 'vai-mode', hidden: true });
  const reply = el('p', { class: 'vai-reply', id: `${id}-reply` }, icon('spark', 'vai-reply-glyph'), replyText, modeTag);
  const histBtnLbl = el('span');
  const histBtn = el('button', { type: 'button', class: 'vai-hist-btn', 'aria-expanded': 'false', 'aria-controls': `${id}-hist`, hidden: true }, histBtnLbl, icon('chevron'));
  const applied = el('ul', { class: 'vai-applied', role: 'list' });
  const caption = el('div', { class: 'vai-caption', hidden: true }, el('div', { class: 'vai-reply-row' }, reply, histBtn), applied);

  const input = el('input', {
    id: `${id}-input`, class: 'vai-input', type: 'text', autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'true',
    enterkeyhint: 'send', maxlength: '500', 'aria-describedby': `${id}-hint`,
  });
  const inputLbl = el('label', { class: 'vai-sr', for: `${id}-input` });
  const ghostA = el('span', { class: 'vai-ghost-line is-in' });
  const ghostB = el('span', { class: 'vai-ghost-line' });
  const ghost = el('span', { class: 'vai-ghost', 'aria-hidden': 'true' }, ghostA, ghostB);
  const sendBtn = el('button', { type: 'submit', class: 'vai-send', disabled: true }, icon('up'));
  const glyph = el('span', { class: 'vai-glyph', 'aria-hidden': 'true' }, icon('spark'));
  const form = el('form', { class: 'vai-bar', novalidate: true }, glyph, inputLbl, el('span', { class: 'vai-field' }, input, ghost), sendBtn);
  const hint = el('p', { class: 'vai-sr', id: `${id}-hint` });
  const chipsEl = el('div', { class: 'vai-chips', role: 'group' });
  const root = el('section', { class: 'vai', 'data-state': 'idle' }, el('div', { class: 'vai-col' }, history, caption, form, chipsEl, hint, live));
  container.replaceChildren(root);

  let paintedLang = null;
  function paintStatic() {
    const s = S();
    paintedLang = getLang();
    root.setAttribute('aria-label', s.region);
    root.lang = getLang();
    inputLbl.textContent = s.inputLabel;
    hint.textContent = s.hint;
    sendBtn.setAttribute('aria-label', s.send);
    chipsEl.setAttribute('aria-label', s.chips);
    applied.setAttribute('aria-label', s.applied);
    syncHistBtn();
    rotateReset();
  }

  // ---------------------------------------------------------------- rotating placeholder
  let rot = 0, rotTimer = 0, ghostFront = ghostA;
  const ghostTexts = () => { const s = S(); return [(root.clientWidth || 999) < 520 ? s.placeholderShort : s.placeholder, ...s.examples]; };
  function rotateReset() {
    clearInterval(rotTimer);
    rot = 0;
    ghostA.textContent = ghostTexts()[0];
    ghostB.textContent = '';
    ghostA.classList.add('is-in'); ghostB.classList.remove('is-in');
    ghostFront = ghostA;
    rotTimer = setInterval(rotateStep, ROTATE_MS);
  }
  function rotateStep() {
    if (document.hidden || input.value || root.dataset.state === 'thinking') return;
    const list = ghostTexts();
    rot = (rot + 1) % list.length;
    const back = ghostFront === ghostA ? ghostB : ghostA;
    back.textContent = list[rot];
    if (reduced()) { ghostFront.textContent = list[rot]; return; }
    back.classList.add('is-in'); ghostFront.classList.remove('is-in');
    ghostFront = back;
  }
  const syncGhost = () => { ghost.hidden = !!input.value; sendBtn.disabled = !input.value.trim() || busy; };

  // ---------------------------------------------------------------- conversation state
  let busy = false;
  let turns = [];          // [{ role, content }] for the API
  const log = [];          // [{ who, text }] for the mini-history
  let lastBatch = null;    // { before, lines, undone }
  let aiDownUntil = 0;
  let inflight = null;
  let recall = [];         // previous user inputs (ArrowUp)

  function setBusy(on) {
    busy = on;
    root.dataset.state = on ? 'thinking' : 'idle';
    form.setAttribute('aria-busy', on ? 'true' : 'false');
    syncGhost();
    if (on) {
      caption.hidden = false;
      replyText.replaceChildren(el('span', { class: 'vai-thinking' }, S().thinking, el('span', { class: 'vai-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'))));
      modeTag.hidden = true;
      applied.replaceChildren();
    }
  }

  function syncHistBtn() {
    const older = log.length > 1;
    histBtn.hidden = !older;
    const open = !history.hidden;
    histBtn.setAttribute('aria-expanded', String(open));
    histBtnLbl.textContent = open ? S().hideHistory : S().history;
  }
  function renderHistory() {
    const items = log.slice(0, -1).slice(-HISTORY_MAX);
    histList.replaceChildren(...items.map((m) => el('li', { class: `vai-h vai-h-${m.who}` },
      el('span', { class: 'vai-h-who' }, m.who === 'user' ? S().you : S().who), el('span', { class: 'vai-h-text' }, m.text))));
  }
  function toggleHistory(force) {
    const open = typeof force === 'boolean' ? force : history.hidden;
    if (open) renderHistory();
    history.hidden = !open;
    root.classList.toggle('has-history', open);
    syncHistBtn();
    if (open) histList.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
  }
  histBtn.addEventListener('click', () => toggleHistory());

  // ---------------------------------------------------------------- applying actions
  const callView = (name) => {
    lastView = name;
    if (opts.controls?.view) return opts.controls.view(name);
    const e = engine(); if (typeof e?.setView === 'function') e.setView(name);
  };
  const callTime = (name) => {
    lastTime = name;
    if (opts.controls?.time) return opts.controls.time(name);
    const e = engine(); if (typeof e?.setTimeOfDay === 'function') e.setTimeOfDay(name);
  };
  const callFocus = (slotId) => {
    if (opts.onFocus) return opts.onFocus(slotId);
    if (opts.controls?.focus) return opts.controls.focus(slotId);
    const e = engine();
    if (typeof e?.focus === 'function') return e.focus(slotId);
    const slot = sim.slotById.get(slotId);
    const v = ZONE_VIEW[slot?.type];
    if (v && typeof e?.setView === 'function') { e.setView(v); lastView = v; }
    if (typeof e?.highlight === 'function') { e.highlight(slotId); setTimeout(() => { try { engine()?.highlight?.(null); } catch { /* ignore */ } }, 2600); }
  };

  function apply(actions) {
    const lng = getLang();
    const before = { ...stateNow() };
    const lines = [];
    const safe = (fn) => { try { return fn(); } catch (err) { console.warn('[villar:ai] action failed', err); return false; } };
    for (const a of actions) {
      if (a.type === 'style' && typeof store.setStyle === 'function') {
        const t0 = store.total();
        if (safe(() => store.setStyle(a.styleId, { anchor: a.anchor || undefined, fresh: true }))) {
          lines.push({ kind: 'style', text: `${lng === 'en' ? 'Style' : 'Стиль'} → ${quoted(lng, styleName(lng, sim.pack(a.styleId)))}`, delta: store.total() - t0 });
        }
      } else if (a.type === 'reset') {
        const t0 = store.total(); const was = JSON.stringify(store.state.selection);
        safe(() => store.reset());
        if (JSON.stringify(store.state.selection) !== was) lines.push({ kind: 'reset', text: lng === 'en' ? 'Original set' : 'Исходная подборка', delta: store.total() - t0 });
      } else if (a.type === 'select') {
        const prev = store.selected(a.key);
        const q = store.qty?.(a.key) || 1;
        if (prev?.id === a.itemId) continue;
        if (safe(() => store.select(a.key, a.itemId, { reason: 'assistant' }))) {
          const next = store.item(a.itemId);
          const type = sim.typeOfKey(styleNow(), store.keyOf ? store.keyOf(a.key) : a.key);
          lines.push({ kind: 'select', key: a.key, text: `${keyLabel(lng, a.key, type)} → ${itemName(lng, next).split(' — ')[0]}`, delta: ((+next?.price || 0) - (+prev?.price || 0)) * q });
        }
      } else if (a.type === 'time') {
        if (before.time !== a.name) { safe(() => callTime(a.name)); lines.push({ kind: 'time', text: TIME_LABELS[lng][a.name] || a.name }); }
      } else if (a.type === 'view') {
        safe(() => callView(a.name)); lines.push({ kind: 'view', text: VIEW_LABELS[lng][a.name] || a.name });
      } else if (a.type === 'focus') {
        safe(() => callFocus(a.slotId));
      }
    }
    // What the AI left behind: Undo reverts only picks that are still exactly as the AI set them.
    const after = { ...stateNow() };
    return { before, after, lines };
  }

  function undo() {
    const b = lastBatch;
    if (!b || b.undone) return false;
    try {
      const styleChanged = b.after?.style && b.before.style && b.after.style !== b.before.style;
      if (styleChanged && styleNow() === b.after.style && typeof store.restore === 'function') {
        // The AI switched style: go back to the previous style exactly as it was (picks made in the new style
        // since then stay remembered there — nothing is lost).
        store.restore({ style: b.before.style, selection: b.before.selection });
      } else if (!styleChanged || styleNow() === b.before.style) {
        // Same style: revert only the picks the AI made that the customer hasn't changed since.
        for (const [key, itemId] of Object.entries(b.before.selection || {})) {
          const aiSet = b.after?.selection?.[key];
          const now = store.state.selection[key];
          if (now !== itemId && (aiSet === undefined || now === aiSet)) store.select(key, itemId, { reason: 'undo' });
        }
      }
      if (b.lines.some((l) => l.kind === 'time') && b.before.time) callTime(b.before.time);
      if (b.lines.some((l) => l.kind === 'view') && b.before.view) callView(b.before.view);
    } catch (err) { console.warn('[villar:ai] undo failed', err); }
    b.undone = true;
    return true;
  }

  // ---------------------------------------------------------------- rendering a result
  function renderApplied(batch, budget) {
    const lng = getLang();
    const items = batch.lines.map((l) => {
      const d = l.delta ? fmtDelta(lng, l.delta) : '';
      return el('li', { class: `vai-chg vai-chg-${l.kind}` }, icon('check', 'vai-chg-ico'), el('span', { class: 'vai-chg-text' }, l.text),
        d ? el('span', { class: `vai-chg-delta${l.delta < 0 ? ' is-down' : ''}` }, d) : null);
    });
    if (budget) {
      const t = aed(lng, store.total());
      items.push(el('li', { class: `vai-chg vai-chg-budget${budget.ok ? ' is-ok' : ''}` },
        el('span', { class: 'vai-chg-text' }, budget.ok ? S().budgetOk(t, num(lng, budget.target)) : S().budgetMin(t))));
    }
    const undoable = batch.lines.some((l) => ['select', 'style', 'reset', 'time', 'view'].includes(l.kind));
    if (undoable && batch.lines.length) {
      const btn = el('button', { type: 'button', class: 'vai-undo' }, icon('undo'), S().undo);
      btn.addEventListener('click', () => {
        if (undo()) {
          applied.replaceChildren(el('li', { class: 'vai-chg vai-chg-undone' }, el('span', { class: 'vai-chg-text' }, S().undone)));
          announce(S().undone);
          if (turns.length) { const last = turns[turns.length - 1]; if (last.role === 'assistant') last.content += getLang() === 'en' ? ' [the visitor undid these changes]' : ' [посетитель отменил эти изменения]'; }
          input.focus({ preventScroll: true });
        }
      });
      items.push(el('li', { class: 'vai-undo-li' }, btn));
    }
    applied.replaceChildren(...items);
    applied.hidden = !items.length;
  }

  function renderChips(chips) {
    chipsEl.replaceChildren(...(chips || []).slice(0, 4).map((c) => {
      const b = el('button', { type: 'button', class: 'vai-chip' }, c);
      b.addEventListener('click', () => { input.value = c; syncGhost(); submit(); });
      return b;
    }));
  }

  function announce(msg) { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 40); }

  function show({ text, batch, chips, budget, mode }) {
    caption.hidden = false;
    replyText.replaceChildren(document.createTextNode(text || ''));
    modeTag.hidden = !mode;
    modeTag.textContent = mode || '';
    caption.classList.remove('is-new'); void caption.offsetWidth; caption.classList.add('is-new');
    if (batch) renderApplied(batch, budget); else { applied.replaceChildren(); applied.hidden = true; }
    if (chips) renderChips(chips);
    log.push({ who: 'ai', text: text || '' });
    if (!history.hidden) renderHistory();
    syncHistBtn();
    const summary = batch?.lines?.map((l) => `${l.text}${l.delta ? ` ${fmtDelta(getLang(), l.delta)}` : ''}`).join('; ');
    announce([text, summary].filter(Boolean).join('. '));
  }

  // ---------------------------------------------------------------- network
  class ApiError extends Error { constructor(code) { super(code); this.code = code; } }
  async function callApi(messages) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('offline');
    if (Date.now() < aiDownUntil) throw new ApiError('circuit');
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    const timer = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, state: stateNow(), lang: getLang() }),
      });
      if (!res.ok) { if (res.status === 404 || res.status === 405) aiDownUntil = Date.now() + 10 * 60_000; throw new ApiError(`http_${res.status}`); }
      const j = await res.json();
      if (j?.error) {
        const pause = { unauthorized: 10 * 60_000, forbidden: 10 * 60_000, rate_limited: 60_000, timeout: 15_000, gateway: 30_000 }[j.error];
        if (pause) aiDownUntil = Date.now() + pause;
        throw new ApiError(j.error);
      }
      return j;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(err?.name === 'AbortError' ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
      if (inflight === ctrl) inflight = null;
    }
  }

  const summarize = (batch) => batch?.lines?.length ? ` [${batch.lines.map((l) => l.text).join('; ')}]` : '';
  function remember(userText, aiText, batch) {
    turns.push({ role: 'user', content: userText.slice(0, 500) });
    turns.push({ role: 'assistant', content: `${aiText}${summarize(batch)}`.slice(0, 600) });
    turns = turns.slice(-MAX_TURNS * 2);
  }

  function runLocal(text, local, { mode } = {}) {
    const lng = getLang();
    if (local.undo) {
      const done = undo();
      const msg = done ? local.reply : (lng === 'en' ? 'Nothing to undo yet.' : 'Пока нечего отменять.');
      show({ text: msg, chips: local.chips });
      if (done) applied.replaceChildren(el('li', { class: 'vai-chg vai-chg-undone' }, el('span', { class: 'vai-chg-text' }, S().undone)));
      remember(text, msg, null);
      return;
    }
    const batch = apply(local.actions);
    if (batch.lines.length) lastBatch = { ...batch, undone: false };
    show({ text: local.reply, batch, chips: local.chips, budget: local.budget, mode });
    remember(text, local.reply, batch);
  }

  async function submit(textArg) {
    const text = String(textArg ?? input.value).trim().slice(0, 500);
    if (!text || busy) return;
    input.value = ''; syncGhost();
    recall = [text, ...recall.filter((r) => r !== text)].slice(0, 20);
    log.push({ who: 'user', text });
    engage(true);
    sim = createSim(dataSet()); // packs may have changed (styles loaded later)
    const st = stateNow();
    const local = parseLocal(text, { data: dataSet(), sim, style: st.style, selection: st.selection, view: st.view, time: st.time, lang: getLang() });

    // Instant path: undo, and pure camera/light commands the local parser fully understood.
    if (local.undo || local.confidence === 'high') return runLocal(text, local);

    setBusy(true);
    const t0 = performance.now();
    try {
      const r = await callApi([...turns.slice(-(MAX_TURNS - 1)), { role: 'user', content: text }]);
      // Defense in depth: re-validate against the live store state.
      const v = sim.applyActions(stateNow(), Array.isArray(r.actions) ? r.actions : []);
      const batch = apply(v.actions);
      if (batch.lines.length) lastBatch = { ...batch, undone: false };
      setBusy(false);
      show({ text: String(r.reply || ''), batch, chips: Array.isArray(r.chips) && r.chips.length ? r.chips.filter((c) => typeof c === 'string') : local.chips, budget: r.budget });
      remember(text, String(r.reply || ''), batch);
      if (window.villarDebug) console.info('[villar:ai]', Math.round(performance.now() - t0), 'ms', r);
    } catch (err) {
      setBusy(false);
      const offline = err?.code === 'offline';
      if (window.villarDebug) console.info('[villar:ai] local fallback:', err?.code || err);
      runLocal(text, local, { mode: offline ? S().offline : null });
    }
  }

  // ---------------------------------------------------------------- events
  // Chips stay out of the way until the bar is used: revealed on focus, kept after the first exchange.
  const engage = (on) => root.classList.toggle('is-engaged', on || log.length > 0);
  root.addEventListener('focusin', () => engage(true));
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) engage(false); });
  root.addEventListener('pointerenter', () => { if (window.matchMedia?.('(hover: hover)').matches) engage(true); });
  root.addEventListener('pointerleave', () => { if (!root.contains(document.activeElement)) engage(false); });
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  input.addEventListener('input', syncGhost);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!history.hidden) { toggleHistory(false); e.preventDefault(); }
      else if (input.value) { input.value = ''; syncGhost(); e.preventDefault(); }
      else input.blur();
    } else if (e.key === 'ArrowUp' && !input.value && recall.length) {
      input.value = recall[0]; syncGhost(); e.preventDefault();
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    }
    e.stopPropagation(); // typing never walks the 3D camera
  });
  const onEngineTime = (p) => { const t = p?.time || p; if (typeof t === 'string') lastTime = t; };
  let boundEngine = null;
  const bindTimer = setInterval(() => {
    const e = engine();
    if (paintedLang !== getLang()) { paintStatic(); if (!log.length) renderChips(defaultChipsFor()); }
    if (e && e !== boundEngine && typeof e.on === 'function') { boundEngine = e; try { e.on('time', onEngineTime); e.on('view', (p) => { const v = p?.view ?? p; if (typeof v === 'string') lastView = v; }); } catch { /* ignore */ } }
  }, 1000);

  function defaultChipsFor() {
    const lng = getLang();
    const t = store.total?.() || 0;
    const b = Math.max(5000, Math.floor((t * 0.8) / 1000) * 1000);
    return lng === 'en' ? ['Make it cosier', `Keep it under ${num(lng, b)}`, 'Show the evening'] : ['Сделай уютнее', `Уложись в ${num(lng, b)}`, 'Покажи вечер'];
  }
  paintStatic();
  renderChips(defaultChipsFor());

  return {
    el: root,
    ask: (text) => submit(text),
    setLang(next) { langOverride = next || null; paintStatic(); if (!log.length) renderChips(defaultChipsFor()); },
    focus: () => input.focus(),
    get busy() { return busy; },
    destroy() { clearInterval(rotTimer); clearInterval(bindTimer); inflight?.abort(); container.replaceChildren(); },
  };
}

export default mountAssistant;
