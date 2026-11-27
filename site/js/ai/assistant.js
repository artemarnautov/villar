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
    arrow: ['M5 12h13', 'M13 6.5 18.5 12 13 17.5'],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3 2'],
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
    // budget: the slider's ladder spec, so «уложись в N» plans exactly like the slider (core/budget.js).
    return data || { catalog: s.catalog, layout: s.layout, packs: s.packs || (s.stylepack ? { [s.stylepack.id]: s.stylepack } : {}), budget: opts.budgetSpec || null };
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
  const pinsNow = () => (typeof store.pins === 'function' ? store.pins() : []);
  const stateNow = () => ({ style: styleNow(), selection: selectionNow(), pins: pinsNow(), total: store.total?.() ?? 0, ...sceneNow() });

  // ---------------------------------------------------------------- DOM
  const S = () => ui(getLang());
  const live = el('div', { class: 'vai-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const histList = el('ol', { class: 'vai-history-list' });
  const history = el('div', { class: 'vai-history', id: `${id}-hist`, hidden: true }, el('div', { class: 'vai-history-inner' }, histList));
  const replyText = el('span', { class: 'vai-reply-text' });
  const modeTag = el('span', { class: 'vai-mode', hidden: true });
  const reply = el('p', { class: 'vai-reply', id: `${id}-reply` }, icon('spark', 'vai-reply-glyph'), replyText, modeTag);
  const histBtnLbl = el('span', { class: 'lbl' });
  const histBtn = el('button', { type: 'button', class: 'vai-hist-btn', 'aria-expanded': 'false', 'aria-controls': `${id}-hist`, hidden: true }, icon('clock', 'vai-hist-clock'), histBtnLbl, icon('chevron', 'vai-hist-chev'));
  const applied = el('ul', { class: 'vai-applied', role: 'list', id: `${id}-applied` });
  // D2-07: one quiet line — the reply (ellipsised), a summary chip that expands the changes inline, Undo, History.
  const sumText = el('span', { class: 'vai-sum-text' });
  const sumMore = el('span', { class: 'vai-sum-more' });
  const sumBtn = el('button', { type: 'button', class: 'vai-sum', 'aria-expanded': 'false', 'aria-controls': `${id}-applied`, hidden: true }, sumText, sumMore);
  const undoSlot = el('span', { class: 'vai-undo-slot' });
  // PT-14: an offer from another style stays one tap away on the reply line (the dropdown hides after a reply).
  const offerSlot = el('span', { class: 'vai-offer-slot' });
  const caption = el('div', { class: 'vai-caption', hidden: true }, el('div', { class: 'vai-reply-row' }, reply, offerSlot, sumBtn, undoSlot, histBtn), applied);

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
  const barWrap = el('div', { class: 'vai-barwrap' }, form, chipsEl);
  const root = el('section', { class: 'vai', 'data-state': 'idle' }, el('div', { class: 'vai-col' }, history, caption, barWrap, hint, live));
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
  let rotations = 0;
  function rotateReset() {
    clearInterval(rotTimer);
    rot = 0; rotations = 0;
    ghostA.textContent = ghostTexts()[0];
    ghostB.textContent = '';
    ghostA.classList.add('is-in'); ghostB.classList.remove('is-in');
    ghostFront = ghostA;
    // D2-21: three examples, then back to the plain placeholder and stop; never under reduced motion.
    if (!reduced()) rotTimer = setInterval(rotateStep, ROTATE_MS);
  }
  function rotateStep() {
    if (document.hidden || input.value || root.dataset.state === 'thinking') return;
    const list = ghostTexts();
    rotations++;
    if (rotations > 3) { clearInterval(rotTimer); rot = 0; } else rot = (rot + 1) % list.length;
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
  let answered = false;    // a request was sent since the bar got focus → suggestions stay put away
  function syncChips() {
    const show = root.contains(document.activeElement) && !answered && !input.value && !busy && chipsEl.childElementCount > 0;
    root.classList.toggle('show-chips', show);
  }

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
      sumBtn.hidden = true; undoSlot.replaceChildren(); offerSlot.replaceChildren(); caption.classList.remove('is-two', 'has-offer'); setOpen(false);
    }
    syncChips();
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
    const before = { ...stateNow(), memory: store.snapshot?.().memory };
    let styled = false;
    const lines = [];
    const safe = (fn) => { try { return fn(); } catch (err) { console.warn('[villar:ai] action failed', err); return false; } };
    for (const a of actions) {
      if (a.type === 'style' && typeof store.setStyle === 'function') {
        const t0 = store.total();
        // PT3-02: the AI lands on the style's curated set. If the customer had their own picks there, say so —
        // Undo restores them (the snapshot carries every style's memory).
        const mem = before.memory?.[a.styleId] || {};
        const slots = store.style?.(a.styleId)?.slots || {};
        const hadPicks = a.styleId !== before.style && Object.entries(mem).some(([k, id]) => slots[k] && slots[k].default !== id && !(a.anchor && (a.anchor.key === k)));
        if (safe(() => store.setStyle(a.styleId, { anchor: a.anchor || undefined, fresh: true }))) {
          styled = true;
          lines.push({ kind: 'style', text: `${lng === 'en' ? 'Style' : 'Стиль'}: ${quoted(lng, styleName(lng, sim.pack(a.styleId)))}`, delta: store.total() - t0, freshNote: hadPicks });
        }
      } else if (a.type === 'reset') {
        const t0 = store.total(); const was = JSON.stringify(store.state.selection);
        safe(() => store.reset());
        if (JSON.stringify(store.state.selection) !== was) lines.push({ kind: 'reset', text: lng === 'en' ? 'Original set' : 'Исходная подборка', delta: store.total() - t0 });
      } else if (a.type === 'budget') {
        // Moves the budget slider: the same ladder and pins as dragging it to `amount` (after a style switch in
        // the same answer, the new style's ladder without pins — as the server planned it).
        const t0 = store.total();
        const amount = Number(a.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        let plan = null;
        if (!styled && typeof opts.budget?.setBudget === 'function') plan = safe(() => opts.budget.setBudget(amount));
        else if (typeof store.applyPlan === 'function') {
          plan = sim.planBudget?.(styleNow(), amount, { selection: selectionNow(), pins: styled ? [] : pinsNow() }) || null;
          if (plan) safe(() => store.applyPlan(plan.selection, { reason: 'budget' }));
        }
        if (plan) {
          const lvl = plan.level ? (lng === 'en' ? plan.level.nameEn || plan.level.name : plan.level.name) : (lng === 'en' ? 'Minimum' : 'Минимум');
          lines.push({ kind: 'budget', text: `${lng === 'en' ? 'Budget' : 'Бюджет'}: ${quoted(lng, lvl)}`, delta: store.total() - t0 });
        }
      } else if (a.type === 'select') {
        const prev = store.selected(a.key);
        const q = store.qty?.(a.key) || 1;
        if (prev?.id === a.itemId) continue;
        // 'ai' pins the pick: the budget slider plans around it (docs/BUDGET.md).
        if (safe(() => store.select(a.key, a.itemId, { reason: 'ai' }))) {
          const next = store.item(a.itemId);
          const type = sim.typeOfKey(styleNow(), store.keyOf ? store.keyOf(a.key) : a.key);
          lines.push({ kind: 'select', key: a.key, text: `${keyLabel(lng, a.key, type)}: ${itemName(lng, next, { afterLabel: true }).split(' — ')[0]}`, delta: ((+next?.price || 0) - (+prev?.price || 0)) * q });
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
        store.restore({ style: b.before.style, selection: b.before.selection, memory: b.before.memory });
      } else if (!styleChanged || styleNow() === b.before.style) {
        // Same style: revert only the picks the AI made that the customer hasn't changed since — in one burst.
        const diff = {};
        for (const [key, itemId] of Object.entries(b.before.selection || {})) {
          const aiSet = b.after?.selection?.[key];
          const now = store.state.selection[key] ?? null;
          if (now !== itemId && (aiSet === undefined || now === aiSet)) diff[key] = itemId;
        }
        if (typeof store.applyPlan === 'function') store.applyPlan(diff, { reason: 'undo' });
        else for (const [key, itemId] of Object.entries(diff)) store.select(key, itemId, { reason: 'undo' });
        // The pins the AI's picks made go with them.
        const was = new Set(b.before.pins || []);
        for (const k of b.after?.pins || []) if (!was.has(k) && k in diff) store.unpin?.(k);
      }
      if (b.lines.some((l) => l.kind === 'time') && b.before.time) callTime(b.before.time);
      if (b.lines.some((l) => l.kind === 'view') && b.before.view) callView(b.before.view);
    } catch (err) { console.warn('[villar:ai] undo failed', err); }
    b.undone = true;
    return true;
  }

  // ---------------------------------------------------------------- rendering a result
  function setOpen(on) {
    caption.classList.toggle('is-open', !!on);
    sumBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    sumMore.textContent = on ? S().hide : (sumBtn.dataset.mode === 'more' ? S().more : S().show);
  }
  sumBtn.addEventListener('click', () => setOpen(!caption.classList.contains('is-open')));

  function renderApplied(batch, budget) {
    const lng = getLang();
    const items = batch.lines.map((l) => {
      const d = l.delta ? fmtDelta(lng, l.delta) : '';
      return el('li', { class: `vai-chg vai-chg-${l.kind}` }, icon('check', 'vai-chg-ico'), el('span', { class: 'vai-chg-text' }, l.text),
        d ? el('span', { class: `vai-chg-delta${l.delta < 0 ? ' is-down' : ''}` }, d) : null);
    });
    if (budget && !batch.lines.some((l) => l.kind === 'budget')) {
      const t = aed(lng, store.total());
      items.push(el('li', { class: `vai-chg vai-chg-budget${budget.ok ? ' is-ok' : ''}` },
        el('span', { class: 'vai-chg-text' }, budget.ok ? S().budgetOk(t, num(lng, budget.target)) : S().budgetMin(t))));
    }
    applied.replaceChildren(...items);
    // Summary chip: «8 замен · −11 406 AED · Показать» (only when there is more than the reply already says).
    const selects = batch.lines.filter((l) => l.kind === 'select').length;
    const sum = batch.lines.reduce((a, l) => a + (l.delta || 0), 0);
    if (batch.lines.length >= 2) {
      sumText.textContent = selects >= 2 ? S().swaps(selects, fmtDelta(lng, sum)) : S().changes(batch.lines.length, fmtDelta(lng, sum));
      sumBtn.dataset.mode = 'list';
      sumBtn.hidden = false;
    } else sumBtn.hidden = true;
    const undoable = batch.lines.some((l) => ['select', 'style', 'reset', 'time', 'view', 'budget'].includes(l.kind));
    if (undoable && batch.lines.length) {
      const btn = el('button', { type: 'button', class: 'vai-undo' }, icon('undo'), el('span', { class: 'lbl' }, S().undo));
      btn.addEventListener('click', () => {
        if (undo()) {
          applied.replaceChildren(el('li', { class: 'vai-chg vai-chg-undone' }, el('span', { class: 'vai-chg-text' }, S().undone)));
          replyText.textContent = S().undone;
          sumBtn.hidden = true; undoSlot.replaceChildren(); setOpen(false);
          announce(S().undone);
          if (turns.length) { const last = turns[turns.length - 1]; if (last.role === 'assistant') last.content += getLang() === 'en' ? ' [the visitor undid these changes]' : ' [посетитель отменил эти изменения]'; }
          input.focus({ preventScroll: true });
        }
      });
      undoSlot.replaceChildren(btn);
    } else undoSlot.replaceChildren();
  }

  /** Chips: plain strings are sent as text; objects carry ready actions (e.g. an offer from another style). */
  function renderChips(chips) {
    chipsEl.replaceChildren(...(chips || []).slice(0, 4).map((c) => {
      const label = typeof c === 'string' ? c : c?.label;
      if (!label) return null;
      const b = el('button', { type: 'button', class: `vai-chip${typeof c === 'object' ? ' is-offer' : ''}` }, label);
      b.addEventListener('click', () => {
        if (typeof c === 'string') { input.value = c; syncGhost(); submit(); } else runChip(c);
      });
      return b;
    }).filter(Boolean));
    syncChips();
  }
  function runChip(c) {
    if (busy) return;
    log.push({ who: 'user', text: c.label });
    answered = true;
    if (c.undo) {
      const done = undo();
      const msg = done ? S().undone : (getLang() === 'en' ? 'Nothing to undo yet.' : 'Пока нечего отменять.');
      show({ text: msg, chips: defaultChipsFor() });
      remember(c.label, msg, null);
      return;
    }
    const batch = apply(Array.isArray(c.actions) ? c.actions : []);
    if (batch.lines.length) lastBatch = { ...batch, undone: false };
    show({ text: c.reply || '', batch, chips: defaultChipsFor() });
    remember(c.label, c.reply || '', batch);
    input.focus({ preventScroll: true });
  }

  function announce(msg) { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 40); }

  function show({ text, batch, chips, budget, mode }) {
    caption.hidden = false;
    const noted = !!batch?.lines?.some((l) => l.freshNote);
    if (noted) text = `${String(text || '').trim()} ${S().freshNote}`.trim();
    caption.classList.toggle('is-two', noted);
    replyText.replaceChildren(document.createTextNode(text || ''));
    modeTag.hidden = !mode;
    modeTag.textContent = mode || '';
    caption.classList.remove('is-new'); void caption.offsetWidth; caption.classList.add('is-new');
    setOpen(false);
    if (batch) renderApplied(batch, budget); else { applied.replaceChildren(); sumBtn.hidden = true; undoSlot.replaceChildren(); }
    // A long reply with nothing to list still gets a «Ещё» to read it in full.
    requestAnimationFrame(() => {
      if (sumBtn.hidden && (reply.scrollWidth > reply.clientWidth + 2 || reply.scrollHeight > reply.clientHeight + 2)) { sumText.textContent = ''; sumBtn.dataset.mode = 'more'; sumBtn.hidden = false; setOpen(false); }
    });
    if (chips) renderChips(chips);
    const offer = (chips || []).find((c) => c && typeof c === 'object' && (c.undo || (Array.isArray(c.actions) && c.actions.length)));
    if (offer) {
      // PT3-04: «Pebble · 1 799 AED · Перейти» — the item and price stay on the line even when the reply is cut.
      const b = offer.short
        ? el('button', { type: 'button', class: 'vai-undo vai-offer', 'aria-label': offer.label, title: offer.label },
          el('span', { class: 'vai-offer-what' }, offer.short), el('span', { class: 'vai-offer-go' }, S().go), icon('arrow'))
        : el('button', { type: 'button', class: 'vai-undo vai-offer', 'aria-label': offer.label, title: offer.label }, offer.undo ? S().back : S().go);
      b.addEventListener('click', () => runChip(offer));
      offerSlot.replaceChildren(b);
    } else offerSlot.replaceChildren();
    caption.classList.toggle('has-offer', !!offer);
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
    answered = true; syncChips();
    recall = [text, ...recall.filter((r) => r !== text)].slice(0, 20);
    log.push({ who: 'user', text });
    engage(true);
    sim = createSim(dataSet()); // packs may have changed (styles loaded later)
    const st = stateNow();
    const prevStyle = lastBatch && !lastBatch.undone && lastBatch.before?.style !== lastBatch.after?.style && styleNow() === lastBatch.after?.style ? lastBatch.before.style : null;
    const local = parseLocal(text, { data: dataSet(), sim, style: st.style, selection: st.selection, pins: st.pins, view: st.view, time: st.time, lang: getLang(), prevStyle });
    // «уложись в 25 000, диван оставь»: the kept pieces are pinned first, so the budget (here, on the server and
    // on the slider) plans around them.
    if (local.keep?.length && typeof store.pin === 'function') for (const k of local.keep) if (store.included?.(k) !== false) store.pin(k);

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
  // D2-07: suggestions are a dropdown under the bar (no layout shift), shown while the bar has focus and is empty,
  // and put away once a request is sent (so the answer lands in the total under it).
  const engage = (on) => root.classList.toggle('is-engaged', !!on);
  root.addEventListener('focusin', () => { engage(true); syncChips(); });
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) { engage(false); answered = false; syncChips(); } });
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  input.addEventListener('input', () => { syncGhost(); syncChips(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (root.classList.contains('show-chips')) { answered = true; syncChips(); e.preventDefault(); }
      else if (!history.hidden) { toggleHistory(false); e.preventDefault(); }
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
    if (paintedLang !== getLang()) { paintStatic(); renderChips(defaultChipsFor()); }
    if (e && e !== boundEngine && typeof e.on === 'function') { boundEngine = e; try { e.on('time', onEngineTime); e.on('view', (p) => { const v = p?.view ?? p; if (typeof v === 'string') lastView = v; }); } catch { /* ignore */ } }
  }, 1000);

  function defaultChipsFor() {
    const lng = getLang();
    const t = store.total?.() || 0;
    const b = Math.max(5000, Math.floor((t * 0.8) / 1000) * 1000);
    return lng === 'en' ? ['Make it cosier', `Keep it under ${num(lng, b)} AED`, 'Show the evening'] : ['Сделай уютнее', `Уложись в ${num(lng, b)} AED`, 'Покажи вечер'];
  }
  paintStatic();
  renderChips(defaultChipsFor());

  return {
    el: root,
    ask: (text) => submit(text),
    setLang(next) { langOverride = next || null; paintStatic(); renderChips(defaultChipsFor()); },
    focus: () => input.focus(),
    get busy() { return busy; },
    destroy() { clearInterval(rotTimer); clearInterval(bindTimer); inflight?.abort(); container.replaceChildren(); },
  };
}

export default mountAssistant;
