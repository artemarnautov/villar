// Budget slider: the room follows the budget, live (docs/BUDGET.md). Owner: interface.
//
// One controller per page: the active style's ladder (core/budget.js), planned around the customer's pins.
// Any number of views (the budget bar under the stage, the phone dock) render it and drive it with a pointer,
// touch or the keyboard. While you drag, the thumb follows the finger (continuous); the room snaps to the richest
// ladder step at or under that budget, and the thumb settles on the room's total when you let go.
import { createPlanner, ladderIndexFor, levelAt, indexOfSelection } from '../core/budget.js';
import { h, aed, fmtNum, reducedMotion } from './dom.js';
import { t, L, getLang, onLang, itemsWord } from './i18n.js';
import { keyLabel } from '../ai/i18n.js';
import { animateNumber } from './motion.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const DETENT = 0.012;      // soft detent around a level tick, share of the track
const WHISPER_MS = 1500;   // how long "+ Торшер · + Плед" stays after the last change

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
    return { ladder: Lr, onLadder: exact >= 0, index, total, level: levelAt(Lr, index) };
  }
  /** The track's AED scale: the style's whole range (stable when pins change), widened to fit the room. */
  function scale() {
    const Lr = ladder(), B = base(), total = store.total();
    const lo = Math.min(B.min, Lr.min, total);
    const hi = Math.max(B.max, Lr.max, total);
    return { lo, hi, span: hi - lo || 1, floor: Lr.min, ceil: Lr.max };
  }
  /** Level ticks at their totals; two within 3 % of the track merge and keep the higher name (budget.json). */
  function ticks() {
    const { lo, span } = scale();
    const merge = spec.ticks?.mergeIfWithinShare ?? 0.03;
    const out = [];
    for (const l of ladder().levels) {
      const p = clamp01((l.total - lo) / span);
      if (out.length && p - out[out.length - 1].p < merge) out[out.length - 1] = { ...l, p };
      else out.push({ ...l, p });
    }
    return out;
  }
  const levelName = (lvl) => (lvl ? L(lvl.name, lvl.nameEn) : t('bs.min'));

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

  function applyIndex(i, { reason = 'budget' } = {}) {
    const Lr = ladder();
    if (!Lr.steps.length) return null;
    const index = Math.max(0, Math.min(Lr.steps.length - 1, i));
    const step = Lr.steps[index];
    const changes = store.applyPlan(step.selection, { reason }) || [];
    const level = levelAt(Lr, index);
    if (changes.length) emit('step', { index, total: step.total, level, changes: describe(changes) });
    return { index, total: step.total, level, changes };
  }
  /** The slider's answer for an amount (also the AI's «уложись в N»): the richest step ≤ amount, around the pins. */
  function planFor(amount) {
    const Lr = ladder();
    const index = ladderIndexFor(Lr, amount);
    const step = Lr.steps[index];
    return { index, total: step.total, level: levelAt(Lr, index), ok: step.total <= amount, min: Lr.min, max: Lr.max, selection: step.selection };
  }
  function setBudget(amount, { reason = 'budget' } = {}) {
    const p = planFor(amount);
    applyIndex(p.index, { reason });
    emit('moved', p);
    return p;
  }

  /** Next / previous step (keyboard). Off the ladder (after a manual pick): the nearest step on that side. */
  function neighbour(dir) {
    const pos = position(); const n = pos.ladder.steps.length;
    if (pos.onLadder) return Math.max(0, Math.min(n - 1, pos.index + dir));
    if (dir > 0) { const i = pos.ladder.steps.findIndex((s) => s.total > pos.total); return i < 0 ? n - 1 : i; }
    let i = 0; pos.ladder.steps.forEach((s, j) => { if (s.total < pos.total) i = j; }); return i;
  }
  /** Next / previous named level (PageUp / PageDown). */
  function levelNeighbour(dir) {
    const pos = position(); const Lr = pos.ladder;
    const idx = [...new Set(Lr.levels.map((l) => l.index))].sort((a, b) => a - b);
    const cmp = (i) => (pos.onLadder ? i - pos.index : Lr.steps[i].total - pos.total);
    if (dir > 0) return idx.find((i) => cmp(i) > 0) ?? Lr.steps.length - 1;
    const prev = idx.filter((i) => cmp(i) < 0);
    return prev.length ? prev[prev.length - 1] : 0;
  }

  // ---- gestures: one Undo per drag (or per burst of key presses) ----
  let gesture = null;
  function begin(source) {
    if (gesture) return gesture;
    frozen = planner.ladder(store.style(), pinnedMap());
    gesture = { source, snap: store.snapshot(), startTotal: store.total(), startSel: JSON.stringify(store.state.selection) };
    emit('grab', gesture);
    return gesture;
  }
  function end() {
    if (!gesture) return;
    const g = gesture; gesture = null; frozen = null;
    const pos = position();
    emit('release', { ...g, changed: JSON.stringify(store.state.selection) !== g.startSel, total: pos.total, level: pos.level });
  }

  function valueText() {
    const pos = position();
    const n = store.placed().length;
    return t('bs.valuetext', { total: aed(pos.total), level: levelName(pos.level), n, items: itemsWord(n) });
  }

  return {
    on, ladder, base, position, scale, ticks, levelName, applyIndex, planFor, setBudget, neighbour, levelNeighbour,
    begin, end, valueText, pinnedMap,
    get dragging() { return !!gesture; },
  };
}

/**
 * A view of the slider. Returns its parts so the caller can lay them out:
 *   level  — the current level name (crossfades)
 *   sub    — `meta` at rest, the "what changed" whisper while the room changes (crossfade)
 *   rail   — the track (44 px hit area, 28 px thumb)
 *   number — optional animated total (the phone dock)
 */
export function createSliderView(ctl, { store, variant = 'bar', meta = null, number = false }) {
  const lvA = h('span', { class: 'bs-lv is-on' });
  const lvB = h('span', { class: 'bs-lv' });
  const level = h('span', { class: 'bs-level', 'aria-hidden': 'true' }, lvA, lvB);
  const whisper = h('span', { class: 'bs-whisper', 'aria-hidden': 'true' });
  const sub = h('span', { class: 'bs-sub' }, meta || h('span', { class: 'bs-meta' }), whisper);
  const floor = h('span', { class: 'bs-floor' });
  const fill = h('span', { class: 'bs-fill' });
  const ticksEl = h('span', { class: 'bs-ticks', 'aria-hidden': 'true' });
  const thumb = h('span', { class: 'bs-thumb', role: 'slider', tabindex: '0', 'aria-orientation': 'horizontal' });
  const track = h('span', { class: 'bs-track' }, floor, fill, ticksEl, thumb);
  const rail = h('div', { class: `bs-rail bs-${variant}` }, track);
  const numVal = number ? h('span', { class: 'bs-num-val' }) : null;
  const num = number ? h('span', { class: 'bs-num', 'aria-hidden': 'true' }, numVal, h('span', { class: 'bs-num-cur' }, 'AED')) : null;

  let dragging = false, grabDX = 0, pendingV = null, raf = 0, lastIndex = -1, tap = null, jumpTimer = 0, keyTimer = 0;
  let shownLevel = null, whisperTimer = 0, shownNum = store.total(), stopNum = () => {};
  const P = (v, sc = ctl.scale()) => clamp01((v - sc.lo) / sc.span);

  function setP(p, { animate = false } = {}) {
    rail.classList.toggle('is-settling', animate && !reducedMotion());
    rail.style.setProperty('--p', p.toFixed(4));
    for (const tk of ticksEl.children) tk.classList.toggle('is-passed', Number(tk.dataset.p) <= p + 1e-4);
  }
  function setLevel(name) {
    if (name === shownLevel) return;
    const first = shownLevel == null;
    shownLevel = name;
    const [on, off] = lvA.classList.contains('is-on') ? [lvA, lvB] : [lvB, lvA];
    if (first || reducedMotion()) { on.textContent = name; return; }
    off.textContent = name;
    off.classList.add('is-on'); on.classList.remove('is-on');
    // The outgoing name keeps its width only while it fades, so the line after it doesn't keep a gap.
    setTimeout(() => { if (!on.classList.contains('is-on')) on.textContent = ''; }, 260);
  }
  function setNumber(v, { animate = true } = {}) {
    if (!numVal) return;
    stopNum();
    const from = shownNum; shownNum = v;
    stopNum = animate ? animateNumber(from, v, (x) => { numVal.textContent = fmtNum(x); }, { duration: ctl.dragging ? 260 : 600 }) : (numVal.textContent = fmtNum(v), () => {});
  }
  function renderTicks(sc) {
    const list = ctl.ticks();
    const sig = list.map((x) => `${x.id}:${x.p.toFixed(4)}`).join('|') + getLang();
    if (ticksEl.dataset.sig === sig) return;
    ticksEl.dataset.sig = sig;
    ticksEl.replaceChildren(...list.map((x) => h('span', {
      class: 'bs-tick', 'data-p': x.p.toFixed(4), 'data-level': x.id, style: `--x:${x.p.toFixed(4)}`, title: `${L(x.name, x.nameEn)} · ${aed(x.total)}`,
    })));
    void sc;
  }

  /** Render from the store (the room is the truth). While dragging, the finger owns the thumb. */
  function sync({ animate = false } = {}) {
    const pos = ctl.position();
    const sc = ctl.scale();
    renderTicks(sc);
    const f = P(sc.floor, sc);
    rail.style.setProperty('--f', f.toFixed(4));
    floor.hidden = f < 0.004;
    floor.title = t('bs.floor');
    if (!dragging) setP(P(pos.total, sc), { animate });
    setLevel(ctl.levelName(pos.level));
    setNumber(pos.total, { animate: shownNum !== pos.total });
    thumb.setAttribute('aria-label', t('bs.label'));
    thumb.setAttribute('aria-valuemin', String(Math.round(pos.ladder.min)));
    thumb.setAttribute('aria-valuemax', String(Math.round(Math.max(pos.ladder.max, pos.total))));
    thumb.setAttribute('aria-valuenow', String(Math.round(pos.total)));
    thumb.setAttribute('aria-valuetext', ctl.valueText());
  }

  function showWhisper(changes) {
    const lng = getLang();
    const words = changes.slice(0, 2).map((c) => {
      let name = keyLabel(lng, c.key, c.type);
      if (lng === 'en' && (c.kind === 'up' || c.kind === 'down') && /^[A-Z][a-z]/.test(name)) name = name[0].toLowerCase() + name.slice(1);
      return t(`bs.${c.kind}`, { name });
    });
    whisper.textContent = words.join(' · ');
    sub.classList.add('is-whispering');
    clearTimeout(whisperTimer);
    whisperTimer = setTimeout(() => { if (!dragging) sub.classList.remove('is-whispering'); }, WHISPER_MS);
  }

  // ---- pointer: the thumb follows the finger; the room snaps to ladder steps ----
  function valueAt(clientX) {
    const r = track.getBoundingClientRect();
    const sc = ctl.scale();
    const p = clamp01((clientX - grabDX - r.left) / (r.width || 1));
    let v = sc.lo + p * sc.span;
    for (const tk of ctl.ticks()) if (Math.abs(p - tk.p) < DETENT) { v = tk.total; break; }   // soft detents
    return Math.max(sc.floor, Math.min(sc.ceil, v));
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
    queue(v);
  }
  function start(e, onThumb) {
    dragging = true;
    lastIndex = ctl.position().onLadder ? ctl.position().index : -1;
    rail.classList.add('is-dragging');
    if (!onThumb && !reducedMotion()) { rail.classList.add('is-jump'); clearTimeout(jumpTimer); jumpTimer = setTimeout(() => rail.classList.remove('is-jump'), 180); }
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
    clearTimeout(whisperTimer);
    whisperTimer = setTimeout(() => sub.classList.remove('is-whispering'), WHISPER_MS);
  }

  rail.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !ctl.ladder().steps.length) return;
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
    if (dragging) moveTo(e.clientX);
  });
  rail.addEventListener('pointerup', (e) => {
    if (tap && e.pointerId === tap.id) { tap = null; start(e, false); stop(); return; }   // a tap on the track: jump there
    stop();
  });
  rail.addEventListener('pointercancel', () => { tap = null; stop(); });
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
    ctl.begin('key');
    ctl.applyIndex(pick());
    sync({ animate: true });
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => { keyTimer = 0; ctl.end(); }, 1000);
  });
  thumb.addEventListener('blur', () => { if (keyTimer) { clearTimeout(keyTimer); keyTimer = 0; ctl.end(); } });

  // ---- follow the store and the controller ----
  let srcRaf = 0;
  const later = () => { if (!srcRaf) srcRaf = requestAnimationFrame(() => { srcRaf = 0; sync({ animate: !dragging }); }); };
  store.on('change', later);
  store.on('pins', later);
  store.on('style', later);
  ctl.on('step', (s) => { showWhisper(s.changes); setLevel(ctl.levelName(s.level)); });
  onLang(() => { shownLevel = null; ticksEl.dataset.sig = ''; sync(); });
  sync();

  return { level, sub, whisper, rail, thumb, number: num, sync, get dragging() { return dragging; } };
}
