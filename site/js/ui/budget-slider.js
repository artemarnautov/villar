// Budget slider: the room follows the budget, live (docs/BUDGET.md). Owner: interface.
//
// One controller per page: the active style's ladder (core/budget.js), planned around the customer's pins.
// Any number of views (the budget bar under the stage, the phone dock) render it and drive it with a pointer,
// touch or the keyboard. While you drag, the thumb follows the finger (continuous) and a bubble names the room
// under it; the room snaps to the richest ladder step at or under that budget, and the thumb settles on the
// room's total when you let go. Each gesture leaves one quiet «Вернуть» beside the slider.
import { createPlanner, ladderIndexFor, levelAt, indexOfSelection, requiredFor } from '../core/budget.js';
import { h, aed, fmtNum, reducedMotion } from './dom.js';
import { t, L, getLang, onLang, itemsWord } from './i18n.js';
import { icon } from './icons.js';
import { keyLabel } from '../ai/i18n.js';
import { animateNumber } from './motion.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const DETENT = 0.012;        // soft detent around a level tick, share of the track
const WHISPER_MS = 1600;     // how long "+ Торшер · + Плед" stays after the last change
const UNDO_MS = 10000;       // the gesture's «Вернуть» stays this long (or until the room changes otherwise)
const HINT_MS = 6000;
const HINT_KEY = 'villar:bs-hint';
const TICK_MERGE_SHARE = 0.015;  // two levels whose totals are this close read as one tick (the later name)
const TICK_MERGE_PX = 24;        // …and so do ticks this close on screen

export function createBudgetController({ store, spec }) {
  if (!spec || typeof store.applyPlan !== 'function' || typeof store.pins !== 'function') return null;
  const { catalog, layout } = store.state;
  const planner = createPlanner({ items: catalog.items, layout, spec });
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const ev = new Map();
  const emit = (n, p) => (ev.get(n) || []).forEach((fn) => { try { fn(p); } catch (e) { console.error('[budget-slider]', e); } });
  const on = (n, fn) => { if (!ev.has(n)) ev.set(n, new Set()); ev.get(n).add(fn); return () => ev.get(n).delete(fn); };

  /** { key: itemId | null } for the active style's pins — the same map the AI planner builds (ai/core.js). */
  const pinnedMap = () => { const s = store.state.selection; return Object.fromEntries(store.pins().map((k) => [k, s[k] ?? null])); };
  let frozen = null;  // the ladder stays fixed for the length of a gesture
  const ladder = () => frozen || planner.ladder(store.style(), pinnedMap());
  const base = () => planner.ladder(store.style(), {});

  /** Where the room sits: its ladder step if it is on the ladder, else the richest step at or under its total. */
  function position() {
    const Lr = ladder();
    const total = store.total();
    const exact = indexOfSelection(Lr, store.state.selection);
    const index = exact >= 0 ? exact : ladderIndexFor(Lr, total);
    return { ladder: Lr, onLadder: exact >= 0, index, total, level: levelAt(Lr, index), label: labelAt(index, Lr) };
  }
  /** The track's AED scale: the style's whole range (stable when pins change), widened to fit the room. */
  function scale() {
    const Lr = ladder(), B = base(), total = store.total();
    const lo = Math.min(B.min, Lr.min, total);
    const hi = Math.max(B.max, Lr.max, total);
    return { lo, hi, span: hi - lo || 1, floor: Lr.min, ceil: Lr.max, pinned: Lr.min > B.min };
  }
  /** Level ticks at their totals. Levels whose totals are within 1.5 % read as one tick with the later name. */
  function ticks() {
    const { lo, span } = scale();
    const out = [];
    for (const l of ladder().levels) {
      const p = clamp01((l.total - lo) / span);
      const prev = out[out.length - 1];
      if (prev && (l.total - prev.total) <= TICK_MERGE_SHARE * l.total) out[out.length - 1] = { ...l, p };
      else out.push({ ...l, p });
    }
    return out;
  }
  const levelName = (lvl) => (lvl ? L(lvl.name, lvl.nameEn) : t('bs.min'));
  /** The name of a step: «Минимум» at the left end, «Основа» until Essentials, then the ladder's own levels. */
  function labelAt(index, Lr = ladder()) {
    if (index <= 0) return t('bs.min');
    const l = levelAt(Lr, index);
    return l ? L(l.name, l.nameEn) : t('bs.basics');
  }

  /** "What changed", biggest first: adds and removals before upgrades, pricier before cheaper. */
  function describe(changes) {
    return changes.map((c) => {
      const a = byId.get(c.prev), b = byId.get(c.itemId);
      const q = c.slots?.length || 1;
      const kind = !a ? 'add' : !b ? 'remove' : ((b.price || 0) >= (a.price || 0) ? 'up' : 'down');
      const weight = (kind === 'add' || kind === 'remove' ? 1e7 : 0) + Math.abs(((b?.price || 0) - (a?.price || 0)) * q);
      return { key: c.key, type: c.slotType, kind, weight };
    }).sort((x, y) => y.weight - x.weight);
  }
  /** The net change between two selections (the gesture's summary). */
  function diff(fromSel, toSel) {
    const keys = new Set([...Object.keys(fromSel), ...Object.keys(toSel)]);
    const out = [];
    for (const key of keys) {
      const prev = fromSel[key] ?? null, itemId = toSel[key] ?? null;
      if (prev === itemId) continue;
      const slots = store.slotsFor?.(key) || [];
      const type = layout.slots.find((s) => s.id === slots[0])?.type || key;
      out.push({ key, prev, itemId, slots, slotType: type });
    }
    return describe(out);
  }

  // ---- the gesture's Undo, offered beside the slider (D4-05) ----
  let offer = null;        // { snap, changes }
  let offerTimer = 0;
  let applying = false;    // our own store writes don't retire the offer
  let gesture = null;
  function clearOffer(reason = 'clear') {
    if (!offer) return;
    offer = null; clearTimeout(offerTimer);
    emit('offer', { offer: null, reason });
  }
  function undo() {
    if (!offer) return false;
    const snap = offer.snap;
    clearOffer('undone');
    applying = true;
    try { store.restore(snap); } finally { applying = false; }
    return true;
  }
  // Anything else that changes the room retires the offer (a style switch's own events are handled below).
  store.on('change', ({ reason } = {}) => { if (!applying && !gesture && reason !== 'style') clearOffer(); });
  // R4-04: a style switch during a gesture ends it there — no plan of the old style's ladder may reach the new
  // style. The gesture's Undo (its snapshot has the old style) stays on offer; otherwise the switch retires it.
  store.on('style', () => {
    if (gesture) { emit('abort', {}); end({ aborted: true }); return; }
    clearOffer();
  });

  function applyIndex(i, { reason = 'budget' } = {}) {
    const Lr = ladder();
    if (!Lr.steps.length) return null;
    if (!gesture) clearOffer();           // the AI (or code) moved the budget: that change has its own Undo
    const index = Math.max(0, Math.min(Lr.steps.length - 1, i));
    const step = Lr.steps[index];
    applying = true;
    let changes = [];
    try { changes = store.applyPlan(step.selection, { reason }) || []; } finally { applying = false; }
    const level = levelAt(Lr, index);
    const label = labelAt(index, Lr);
    if (changes.length) emit('step', { index, total: step.total, level, label, changes: describe(changes) });
    return { index, total: step.total, level, label, changes };
  }
  /** The slider's answer for an amount (also the AI's «уложись в N»): the richest step ≤ amount, around the pins. */
  function planFor(amount) {
    const Lr = ladder();
    const index = ladderIndexFor(Lr, amount);
    const step = Lr.steps[index];
    return { index, total: step.total, level: levelAt(Lr, index), label: labelAt(index, Lr), ok: step.total <= amount, min: Lr.min, max: Lr.max, selection: step.selection };
  }
  /**
   * PT4-02: a manual style switch keeps the budget. If the room is a ladder step other than the designer room,
   * the target style lands on its richest step at or under the current total (planned around that style's own
   * pins), or its minimum if that is higher. Returns null when the switch should land as usual.
   */
  function planForStyle(targetId) {
    const target = store.style(targetId);
    if (!target || targetId === store.styleId()) return null;
    const Lr = ladder();
    const at = indexOfSelection(Lr, store.state.selection);
    if (at < 0 || at === Lr.defaultIndex) return null;
    const snap = store.snapshot();
    const mem = { ...(snap.memory?.[targetId] || {}) };
    const pinned = Object.fromEntries((snap.pins?.[targetId] || []).filter((k) => target.slots?.[k])
      .map((k) => [k, k in mem ? mem[k] : target.slots[k].default ?? null]));
    const T = planner.ladder(target, pinned);
    if (!T.steps.length) return null;
    const index = ladderIndexFor(T, store.total());
    const step = T.steps[index];
    return { index, total: step.total, level: levelAt(T, index), label: labelAt(index, T), selection: step.selection };
  }
  /** PT4-01: what adding `key` brings along (lamps need nightstands, tableware a table and chairs…). */
  function requires(key) {
    try { return requiredFor({ pack: store.style(), spec, selection: store.state.selection, key: store.keyOf?.(key) || key }); } catch { return {}; }
  }
  /** «Добавить»: the dependencies first (one burst), then the piece itself — pinned, so the slider keeps it. */
  function add(key, itemId) {
    const k = store.keyOf?.(key) || key;
    const before = { ...store.state.selection };
    const deps = requires(k);
    clearOffer();
    if (Object.keys(deps).length) store.applyPlan(deps, { reason: 'budget' });
    store.select(k, itemId || store.defaultOf(k)?.id, { reason: 'user' });
    const changes = diff(before, store.state.selection);
    const pos = position();
    if (changes.length) emit('step', { index: pos.index, total: pos.total, level: pos.level, label: pos.label, changes });
    return changes;
  }
  function setBudget(amount, { reason = 'budget' } = {}) {
    const p = planFor(amount);
    applyIndex(p.index, { reason });
    emit('moved', p);
    return p;
  }
  /** The richest step at or under `v` and its level: what the bubble shows under the finger. */
  function stepAt(v) {
    const Lr = ladder();
    const i = ladderIndexFor(Lr, v);
    return { index: i, total: Lr.steps[i]?.total ?? 0, level: levelAt(Lr, i), label: labelAt(i, Lr) };
  }

  /** Next / previous step (keyboard). Off the ladder (after a manual pick): the nearest step on that side. */
  function neighbour(dir) {
    const pos = position(); const n = pos.ladder.steps.length;
    if (pos.onLadder) return Math.max(0, Math.min(n - 1, pos.index + dir));
    if (dir > 0) { const i = pos.ladder.steps.findIndex((s) => s.total > pos.total); return i < 0 ? n - 1 : i; }
    let i = 0; pos.ladder.steps.forEach((s, j) => { if (s.total < pos.total) i = j; }); return i;
  }
  /** Next / previous named level (PageUp / PageDown), over the merged ticks. */
  function levelNeighbour(dir) {
    const pos = position(); const Lr = pos.ladder;
    const idx = [...new Set(ticks().map((l) => l.index))].sort((a, b) => a - b);
    const cmp = (i) => (pos.onLadder ? i - pos.index : Lr.steps[i].total - pos.total);
    if (dir > 0) return idx.find((i) => cmp(i) > 0) ?? Lr.steps.length - 1;
    const prev = idx.filter((i) => cmp(i) < 0);
    return prev.length ? prev[prev.length - 1] : 0;
  }
  /** The customer pressed against their pins (nothing cheaper is possible). */
  function hitFloor() { if (scale().pinned) emit('floor', {}); }

  // ---- gestures: one Undo per drag (or per burst of key presses) ----
  function begin(source) {
    if (gesture) return gesture;
    clearOffer('grab');
    frozen = planner.ladder(store.style(), pinnedMap());
    gesture = { source, snap: store.snapshot(), startTotal: store.total(), startSel: { ...store.state.selection } };
    emit('grab', gesture);
    return gesture;
  }
  function end({ aborted = false } = {}) {
    if (!gesture) return;
    const g = gesture; gesture = null; frozen = null;
    const pos = position();
    // Aborted by a style switch: the snapshot (old style, every pick) is still the way back; no per-item summary.
    const changes = aborted ? [] : diff(g.startSel, store.state.selection);
    if (changes.length || aborted) {
      offer = { snap: g.snap, changes };
      clearTimeout(offerTimer);
      offerTimer = setTimeout(() => clearOffer('timeout'), UNDO_MS);
      emit('offer', { offer });
    }
    emit('release', { ...g, changed: changes.length > 0 || aborted, aborted, changes, total: pos.total, level: pos.level, label: pos.label });
  }

  function valueText() {
    const pos = position();
    const n = store.placed().length;
    return t('bs.valuetext', { total: aed(pos.total), level: pos.label, n, items: itemsWord(n) });
  }

  // ---- the one-time hint («Двигайте — комната подстроится под бюджет»), once per visitor ----
  let hintDone = false;
  try { hintDone = localStorage.getItem(HINT_KEY) === '1'; } catch { /* storage blocked: once per page */ }
  const hint = {
    get done() { return hintDone; },
    finish() { if (hintDone) return; hintDone = true; try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ } emit('hint-done', {}); },
  };

  return {
    on, ladder, base, position, scale, ticks, levelName, labelAt, applyIndex, planFor, planForStyle, setBudget, stepAt,
    neighbour, levelNeighbour, requires, add, begin, end, undo, valueText, pinnedMap, hitFloor, hint,
    get offer() { return offer; },
    get dragging() { return !!gesture; },
  };
}

/** «Лучше: обеденный стол» / "Better dining table": the slot label, lower-cased after a lead word. */
function changeWords(changes, lng) {
  return changes.map((c) => {
    let name = keyLabel(lng, c.key, c.type);
    if ((c.kind === 'up' || c.kind === 'down') && /^\p{Lu}\p{Ll}/u.test(name)) name = name[0].toLowerCase() + name.slice(1);
    return t(`bs.${c.kind}`, { name });
  });
}
/** At most two changes, then «+25 ещё» / "+25 more". */
function summary(changes, lng) {
  const words = changeWords(changes.slice(0, 2), lng).join(' · ');
  return changes.length > 2 ? `${words} ${t('bs.more', { n: changes.length - 2 })}` : words;
}

/**
 * A view of the slider. Returns its parts so the caller can lay them out:
 *   name   — «Бюджет»
 *   level  — the current level name (crossfades)
 *   line   — the item count at rest; the "what changed" whisper while the room changes; then «Вернуть»
 *   rail   — the track (44 px hit area, 28 px thumb), the drag bubble and the one-time hint
 *   scale  — under the track: the ends (the customer's pinned floor on the left), tick names on wide screens
 *   number — optional animated total (the phone dock)
 */
export function createSliderView(ctl, { store, variant = 'bar', number = false, compact = false, isShown = () => true, onPins = null }) {
  const name = h('span', { class: 'bs-name' });
  const lvA = h('span', { class: 'bs-lv is-on' });
  const lvB = h('span', { class: 'bs-lv' });
  const level = h('span', { class: 'bs-level', 'aria-hidden': 'true' }, lvA, lvB);
  const meta = h('span', { class: 'bs-meta' });
  const whisper = h('span', { class: 'bs-whisper', 'aria-hidden': 'true' });
  const sub = h('span', { class: 'bs-sub' }, meta, whisper);
  const undoBtn = h('button', { type: 'button', class: 'bs-undo', hidden: true });
  const line = h('span', { class: 'bs-line' }, sub, undoBtn);

  const floor = h('span', { class: 'bs-floor' });
  const fill = h('span', { class: 'bs-fill' });
  const ticksEl = h('span', { class: 'bs-ticks', 'aria-hidden': 'true' });
  const thumb = h('span', { class: 'bs-thumb', role: 'slider', tabindex: '0', 'aria-orientation': 'horizontal' });
  const bubble = h('span', { class: 'bs-bubble', 'aria-hidden': 'true' });
  const hintText = h('span', { class: 'bs-hint-text' });
  const hintEl = h('span', { class: 'bs-hint', 'aria-hidden': 'true', hidden: true }, hintText, h('span', { class: 'bs-hint-caret' }));
  const track = h('span', { class: 'bs-track' }, floor, fill, ticksEl, thumb, bubble, hintEl);
  const rail = h('div', { class: `bs-rail bs-${variant}` }, track);

  const endL = h('span', { class: 'bs-end bs-end-l' });
  const floorLbl = h('span', { class: 'bs-floorlbl-t' });
  const floorBtn = h('button', { type: 'button', class: 'bs-end bs-end-l bs-floorlbl', hidden: true },
    h('span', { class: 'bs-pin', 'aria-hidden': 'true', html: icon('pin') }), floorLbl);
  const endR = h('span', { class: 'bs-end bs-end-r' });
  const labels = h('span', { class: 'bs-labels', 'aria-hidden': 'true' });
  const scaleEl = h('div', { class: `bs-scale bs-${variant}${compact ? ' is-compact' : ''}` }, endL, floorBtn, labels, endR);

  const numVal = number ? h('span', { class: 'bs-num-val' }) : null;
  const num = number ? h('span', { class: 'bs-num', 'aria-hidden': 'true' }, numVal, h('span', { class: 'bs-num-cur' }, 'AED')) : null;

  let dragging = false, grabDX = 0, pendingV = null, raf = 0, lastIndex = -1, tap = null, jumpTimer = 0, keyTimer = 0;
  let shownLevel = null, whisperTimer = 0, shownNum = store.total(), stopNum = () => {};
  let trackW = 0, bubbleW = 0, floorTimer = 0, aborted = false;
  const P = (v, sc = ctl.scale()) => clamp01((v - sc.lo) / sc.span);

  function setP(p, { animate = false } = {}) {
    rail.classList.toggle('is-settling', animate && !reducedMotion());
    rail.style.setProperty('--p', p.toFixed(4));
    for (const tk of ticksEl.children) tk.classList.toggle('is-passed', Number(tk.dataset.p) <= p + 1e-4);
  }
  function setLevel(text) {
    if (text === shownLevel) return;
    const first = shownLevel == null;
    shownLevel = text;
    const [cur, next] = lvA.classList.contains('is-on') ? [lvA, lvB] : [lvB, lvA];
    if (first || reducedMotion()) { cur.textContent = text; next.textContent = ''; return; }
    next.textContent = text;
    next.classList.add('is-on'); cur.classList.remove('is-on');
    setTimeout(() => { if (!cur.classList.contains('is-on')) cur.textContent = ''; }, 260);
  }
  function setNumber(v, { animate = true } = {}) {
    if (!numVal) return;
    stopNum();
    const from = shownNum; shownNum = v;
    stopNum = animate ? animateNumber(from, v, (x) => { numVal.textContent = fmtNum(x); }, { duration: ctl.dragging ? 260 : 600 }) : (numVal.textContent = fmtNum(v), () => {});
  }

  /** Ticks (merged when closer than 24 px, the later name wins) and their names under the track. */
  function renderTicks() {
    trackW = track.clientWidth || trackW;
    const list = [];
    for (const x of ctl.ticks()) {
      const prev = list[list.length - 1];
      if (prev && trackW && (x.p - prev.p) * trackW < TICK_MERGE_PX) list[list.length - 1] = x; else list.push(x);
    }
    const sig = list.map((x) => `${x.id}:${x.p.toFixed(4)}`).join('|') + getLang() + Math.round(trackW);
    if (ticksEl.dataset.sig === sig) return;
    ticksEl.dataset.sig = sig;
    ticksEl.replaceChildren(...list.map((x) => h('span', { class: 'bs-tick', 'data-p': x.p.toFixed(4), 'data-level': x.id, style: `--x:${x.p.toFixed(4)}` })));
    labels.replaceChildren(...list.map((x) => h('span', { class: 'bs-label', 'data-level': x.id, style: `--x:${x.p.toFixed(4)}` }, L(x.name, x.nameEn))));
    setP(Number(rail.style.getPropertyValue('--p')) || 0);
    requestAnimationFrame(layoutLabels);
  }
  /** Tick names that fit: Magazine-ready, Move-in ready, Essentials first; never over the end labels or each other. */
  const PRIORITY = ['magazine', 'move-in', 'essentials', 'complete', 'comfortable', 'no-compromise'];
  function layoutLabels() {
    if (compact || !labels.children.length || getComputedStyle(labels).display === 'none') return;
    const W = labels.clientWidth;
    if (!W) return;
    const leftEnd = floorBtn.hidden ? endL : floorBtn;
    const lo = (leftEnd.hidden ? 0 : leftEnd.offsetWidth) + 16;          // labels stay clear of the end amounts
    const hi = W - (endR.hidden ? 0 : endR.offsetWidth) - 16;
    const taken = [];
    const rank = (el) => { const i = PRIORITY.indexOf(el.dataset.level); return i < 0 ? 99 : i; };
    for (const el of [...labels.children].sort((a, b) => rank(a) - rank(b))) {
      el.classList.remove('is-off');
      const w = el.offsetWidth; const x = Number(el.style.getPropertyValue('--x')) * W;
      // Centred under its tick, nudged inward near the ends — but it must still sit under its own tick.
      const l = Math.max(lo, Math.min(hi - w, x - w / 2));
      el.style.left = `${l.toFixed(1)}px`;
      const span = [l - 6, l + w + 6];
      const covers = x >= l - 2 && x <= l + w + 2;
      if (!covers || l < lo - 0.5 || l + w > hi + 0.5 || taken.some(([a, b]) => span[0] < b && span[1] > a)) { el.classList.add('is-off'); continue; }
      taken.push(span);
    }
  }

  /** Render from the store (the room is the truth). While dragging, the finger owns the thumb. */
  function sync({ animate = false } = {}) {
    const pos = ctl.position();
    const sc = ctl.scale();
    const f = sc.pinned ? P(sc.floor, sc) : 0;
    rail.style.setProperty('--f', f.toFixed(4));
    floor.hidden = !sc.pinned;
    if (!dragging) setP(P(pos.total, sc), { animate });
    renderTicks();
    setLevel(pos.label);
    setNumber(pos.total, { animate: shownNum !== pos.total });
    const n = store.placed().length;
    meta.textContent = t('budget.count', { n, items: itemsWord(n) });
    name.textContent = t('bs.label');
    // The ends of the scale: the minimum (or the customer's pinned floor) and the premium end (D4-01, D4-04).
    const fmt = (v) => (compact ? fmtNum(v) : aed(v));
    endL.textContent = fmt(sc.lo);
    endR.textContent = fmt(sc.hi);
    endL.hidden = sc.pinned;
    floorBtn.hidden = !sc.pinned;
    floorLbl.textContent = compact ? fmtNum(sc.floor) : `${t('bs.floorLbl')} · ${aed(sc.floor)}`;
    floorBtn.setAttribute('aria-label', t('bs.floorAria', { min: aed(sc.floor) }));
    floorBtn.title = t('bs.floor');
    thumb.setAttribute('aria-label', t('bs.label'));
    thumb.setAttribute('aria-valuemin', String(Math.round(pos.ladder.min)));
    thumb.setAttribute('aria-valuemax', String(Math.round(Math.max(pos.ladder.max, pos.total))));
    thumb.setAttribute('aria-valuenow', String(Math.round(pos.total)));
    thumb.setAttribute('aria-valuetext', ctl.valueText());
    undoBtn.textContent = t('bs.undo');
    undoBtn.setAttribute('aria-label', t('bs.undoAria'));
    requestAnimationFrame(layoutLabels);
  }

  // ---- the line under the level: count → what changed → «Вернуть» (one at a time, D4-03) ----
  function showWhisper(text, { hold = false } = {}) {
    whisper.textContent = text;
    sub.classList.add('is-whispering');
    clearTimeout(whisperTimer);
    if (!hold) whisperTimer = setTimeout(() => { if (!dragging && !ctl.offer) sub.classList.remove('is-whispering'); }, WHISPER_MS);
  }
  function hideWhisper() { clearTimeout(whisperTimer); sub.classList.remove('is-whispering'); }
  function renderOffer({ offer, reason } = {}) {
    if (offer) {
      showWhisper(summary(offer.changes, getLang()), { hold: true });
      undoBtn.hidden = false;
      return;
    }
    const hadFocus = document.activeElement === undoBtn;
    undoBtn.hidden = true;
    if (hadFocus) thumb.focus({ preventScroll: true });
    if (reason === 'undone') showWhisper(t('bs.undone'));
    else if (!dragging) hideWhisper();
  }
  undoBtn.addEventListener('click', () => { ctl.undo(); });

  // ---- the drag bubble: the room under the finger (D4-02) ----
  function bubbleAt(v) {
    const s = ctl.stepAt(v);
    const text = t('bs.bubble', { level: s.label, total: aed(s.total) });
    if (bubble.textContent !== text) { bubble.textContent = text; bubbleW = bubble.offsetWidth; }
    const W = trackW || track.clientWidth;
    const x = P(v) * W;
    const left = Math.max(-12, Math.min(W - bubbleW + 12, x - bubbleW / 2));
    bubble.style.transform = `translate3d(${left.toFixed(1)}px, 0, 0)`;
  }

  // ---- the one-time hint, above the thumb (D4-01) ----
  let hintTimer = 0;
  function maybeHint() {
    if (ctl.hint.done || !hintEl.hidden || dragging || !isShown()) return;
    const r = rail.getBoundingClientRect();
    if (!r.width || r.top < 0 || r.bottom > innerHeight) return;
    hintText.textContent = t('bs.hint');
    hintEl.hidden = false;
    const W = track.clientWidth, w = hintEl.offsetWidth;
    const x = (Number(rail.style.getPropertyValue('--p')) || 0) * W;
    const left = Math.max(-8, Math.min(W - w + 8, x - w / 2));
    hintEl.style.left = `${left.toFixed(1)}px`;
    hintEl.style.setProperty('--caret', `${(x - left).toFixed(1)}px`);
    // Never resurrect it: the first interaction may land in the same frame (dropHint ran before this rAF).
    requestAnimationFrame(() => { if (!ctl.hint.done && !hintEl.hidden && !dragging) hintEl.classList.add('is-on'); });
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { if (isShown()) ctl.hint.finish(); else dropHint(); }, HINT_MS);
  }
  function dropHint() {
    clearTimeout(hintTimer);
    if (hintEl.hidden) return;
    hintEl.classList.remove('is-on');
    setTimeout(() => { if (!hintEl.classList.contains('is-on')) hintEl.hidden = true; }, 260);
  }
  ctl.on('hint-done', dropHint);
  if (!ctl.hint.done && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => {
      if (ctl.hint.done) { io.disconnect(); return; }
      if (e.intersectionRatio >= 0.9) setTimeout(maybeHint, 400); else dropHint();
    }, { threshold: [0, 0.9] });
    io.observe(rail);
  }

  // ---- pointer: the thumb follows the finger; the room snaps to ladder steps ----
  function valueAt(clientX) {
    const r = track.getBoundingClientRect();
    const sc = ctl.scale();
    const p = clamp01((clientX - grabDX - r.left) / (r.width || 1));
    let v = sc.lo + p * sc.span;
    for (const tk of ctl.ticks()) if (Math.abs(p - tk.p) < DETENT) { v = tk.total; break; }   // soft detents
    if (v < sc.floor) {
      if (sc.pinned && !floorTimer) { ctl.hitFloor(); floorTimer = setTimeout(() => { floorTimer = 0; }, 1500); }
      v = sc.floor;
    }
    return Math.min(sc.ceil, v);
  }
  function queue(v) { pendingV = v; if (!raf) raf = requestAnimationFrame(flush); }
  function flush() {
    raf = 0;
    if (pendingV == null) return;
    const v = pendingV; pendingV = null;
    const i = ladderIndexFor(ctl.ladder(), v);
    if (i !== lastIndex) { lastIndex = i; ctl.applyIndex(i); }
  }
  function moveTo(clientX) {
    const v = valueAt(clientX);
    setP(P(v));
    bubbleAt(v);
    queue(v);
  }
  function start(e, onThumb) {
    dragging = true;
    trackW = track.clientWidth;
    const pos = ctl.position();
    lastIndex = pos.onLadder ? pos.index : -1;
    rail.classList.add('is-dragging');
    if (!onThumb && !reducedMotion()) { rail.classList.add('is-jump'); clearTimeout(jumpTimer); jumpTimer = setTimeout(() => rail.classList.remove('is-jump'), 180); }
    ctl.hint.finish();
    ctl.begin('pointer');
    moveTo(e.clientX);
  }
  function stop() {
    if (!dragging) return;
    dragging = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; flush(); }
    rail.classList.remove('is-dragging', 'is-jump');
    lastIndex = -1;
    ctl.end();
    sync({ animate: true });
  }

  rail.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !ctl.ladder().steps.length) return;
    aborted = false;
    const onThumb = e.target === thumb;
    const tr = thumb.getBoundingClientRect();
    grabDX = onThumb ? e.clientX - (tr.left + tr.width / 2) : 0;
    try { rail.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (e.pointerType === 'mouse') e.preventDefault();   // no text selection; focus moves to the thumb below
    thumb.focus({ preventScroll: true, focusVisible: false });   // like a native slider: focus, no ring on click
    // Touch on the bare track: wait for intent — a vertical swipe still scrolls the page (touch-action: pan-y).
    if (e.pointerType !== 'mouse' && !onThumb) { tap = { x: e.clientX, y: e.clientY, id: e.pointerId }; return; }
    start(e, onThumb);
  });
  rail.addEventListener('pointermove', (e) => {
    if (tap && e.pointerId === tap.id) {
      if (Math.abs(e.clientX - tap.x) > 6 && Math.abs(e.clientX - tap.x) > Math.abs(e.clientY - tap.y)) { tap = null; start(e, false); }
      return;
    }
    if (dragging && !aborted) moveTo(e.clientX);
  });
  rail.addEventListener('pointerup', (e) => {
    if (aborted) { aborted = false; sync({ animate: true }); return; }
    if (tap && e.pointerId === tap.id) { tap = null; start(e, false); stop(); return; }   // a tap on the track: jump there
    stop();
  });
  rail.addEventListener('pointercancel', () => { tap = null; aborted = false; stop(); });
  rail.addEventListener('lostpointercapture', () => { if (dragging) stop(); });

  // ---- keyboard: ←/→ a step, PageUp/PageDown a level, Home/End the ends ----
  thumb.addEventListener('keydown', (e) => {
    const n = ctl.ladder().steps.length;
    const pick = {
      ArrowRight: () => ctl.neighbour(1), ArrowUp: () => ctl.neighbour(1),
      ArrowLeft: () => ctl.neighbour(-1), ArrowDown: () => ctl.neighbour(-1),
      PageUp: () => ctl.levelNeighbour(1), PageDown: () => ctl.levelNeighbour(-1),
      Home: () => 0, End: () => n - 1,
    }[e.key];
    if (!pick || !n) return;
    e.preventDefault();
    ctl.hint.finish();
    const down = ['ArrowLeft', 'ArrowDown', 'PageDown', 'Home'].includes(e.key);
    const pos = ctl.position();
    if (down && pos.onLadder && pos.index === 0) { ctl.hitFloor(); return; }
    ctl.begin('key');
    ctl.applyIndex(pick());
    sync({ animate: true });
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => { keyTimer = 0; ctl.end(); }, 1000);
  });
  thumb.addEventListener('blur', () => { if (keyTimer) { clearTimeout(keyTimer); keyTimer = 0; ctl.end(); } });
  floorBtn.addEventListener('click', () => onPins?.());

  // ---- follow the store and the controller ----
  let srcRaf = 0;
  const later = () => { if (!srcRaf) srcRaf = requestAnimationFrame(() => { srcRaf = 0; sync({ animate: !dragging }); }); };
  store.on('change', later);
  store.on('pins', later);
  store.on('style', later);
  ctl.on('step', (s) => { if (!ctl.offer) showWhisper(summary(s.changes, getLang())); setLevel(s.label); });
  // R4-04: the style changed under the finger — let go of the drag here (the next pointerdown starts afresh).
  ctl.on('abort', () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    pendingV = null; tap = null;
    if (keyTimer) { clearTimeout(keyTimer); keyTimer = 0; }
    if (dragging) { dragging = false; aborted = true; rail.classList.remove('is-dragging', 'is-jump'); lastIndex = -1; }
  });
  ctl.on('offer', renderOffer);
  ctl.on('floor', () => showWhisper(t('bs.floorHit')));
  if ('ResizeObserver' in window) new ResizeObserver(() => { ticksEl.dataset.sig = ''; renderTicks(); }).observe(track);
  onLang(() => {
    shownLevel = null; ticksEl.dataset.sig = ''; sync();
    if (ctl.offer) renderOffer({ offer: ctl.offer });
    if (!hintEl.hidden) hintText.textContent = t('bs.hint');
  });
  sync();

  return { name, level, line, sub, whisper, rail, scale: scaleEl, thumb, number: num, sync, maybeHint, dropHint, get dragging() { return dragging; } };
}
