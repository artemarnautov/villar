// Live budget: the bar under the editor (total + budget slider), the zone-grouped list (with the items the budget
// leaves out and the customer's pins), the reset link, and on phones a docked total + slider while the stage is
// on screen. Owner: interface.
import { h, svg, fmtNum, fmtDelta, aed, quoted, NBSP } from './dom.js';
import { icon } from './icons.js';
import { zones, zoneOf } from './labels.js';
import { t, onLang, itemsWord, getLang } from './i18n.js';
import { animateNumber } from './motion.js';
import { dot, nameOf, packName as packNameOf } from './format.js';
import { createSliderView } from './budget-slider.js';
import { keyLabel } from '../ai/i18n.js';

export function createBudget({ el, store, stage, onOrder, onLine, announce, slider = null }) {
  // ---- Bar ----
  const val = h('span', { class: 'val' }, '0');
  const delta = h('span', { class: 'budget-delta', 'aria-hidden': 'true' });
  const meta = h('span', { class: 'budget-meta' });
  const resetLbl = h('span');
  const reset = h('button', { type: 'button', class: 'budget-reset', hidden: true }, svg(icon('reset')), resetLbl);
  const toggleLbl = h('span');
  const toggle = h('button', {
    type: 'button', class: 'budget-toggle', 'aria-expanded': 'false', 'aria-controls': 'budget-list',
  }, toggleLbl, svg(icon('chevronDown')));
  const order = h('button', { type: 'button', class: 'btn btn-primary btn-lg budget-cta' });
  const groups = h('div', { class: 'budget-groups' });
  const foot = h('p', { class: 'budget-foot' });
  const label = h('div', { class: 'budget-label', id: 'budget-label' });
  const list = h('div', { class: 'budget-list', id: 'budget-list', inert: true },
    h('div', { class: 'budget-list-inner' }, groups, foot));
  const links = h('div', { class: 'budget-links' }, toggle, reset);

  // The slider (docs/BUDGET.md) sits beside the total; without a ladder spec the bar is the plain total.
  const view = slider ? createSliderView(slider, { store, variant: 'bar', meta }) : null;
  const side = view
    ? h('div', { class: 'budget-side has-slider' }, h('div', { class: 'bs-head' }, view.level, view.sub), links, view.rail)
    : h('div', { class: 'budget-side' }, meta, links);

  el.replaceChildren(
    h('div', { class: 'budget-main' },
      h('div', { class: 'budget-sum' },
        label,
        h('div', { class: 'budget-total', 'aria-labelledby': 'budget-label' }, val, h('span', { class: 'cur' }, 'AED'), delta)),
      side,
      h('div', { class: 'budget-actions' }, order)),
    list,
  );

  // ---- Phones: a docked total (+ the slider) while the stage is on screen and the bar is not ----
  const pillVal = h('span', { class: 'cartbar-val num' });
  const pillDelta = h('span', { class: 'cartbar-delta', 'aria-hidden': 'true' });
  const pillBtn = h('button', { type: 'button', class: 'btn btn-primary cartbar-btn' });
  const pillLabel = h('span', { class: 'cartbar-label' });
  const dockMeta = h('span', { class: 'bs-meta' });
  const dockView = slider ? createSliderView(slider, { store, variant: 'dock', meta: dockMeta, number: true }) : null;
  const pill = dockView
    ? h('div', { class: 'cartbar bdock', role: 'region' },
      h('div', { class: 'bdock-row' }, h('div', { class: 'bdock-l' }, dockView.level, dockView.sub), dockView.number),
      dockView.rail)
    : h('div', { class: 'cartbar glass', role: 'region' },
      h('div', { class: 'cartbar-sum' }, pillLabel, pillVal, pillDelta), pillBtn);
  document.body.append(pill);
  pillBtn.addEventListener('click', () => onOrder?.());

  let stageOn = false, budgetOn = false, hudOn = false;
  const syncPill = () => {
    // D2-06: never two totals on screen. The dock shows only while the stage is in view and the real bar is
    // not; while the item panel is open the panel's own header carries the total instead. A drag in progress
    // keeps it (the page doesn't scroll under a finger on the thumb, but the observers may still fire).
    const dragging = dockView?.dragging;
    const show = dragging || (stageOn && !budgetOn && !hudOn);
    pill.classList.toggle('is-visible', show);
    document.documentElement.classList.toggle('cartbar-on', show);
    pill.inert = !show;
  };
  syncPill();
  if ('IntersectionObserver' in window && stage) {
    new IntersectionObserver(([e]) => { stageOn = e.intersectionRatio >= 0.5; syncPill(); }, { threshold: [0, 0.5, 1] }).observe(stage);
    // The dock is ~100 px tall: the bar counts as "on screen" once it clears it, so the two never overlap.
    const margin = dockView ? '0px 0px -112px 0px' : '0px 0px -60px 0px';
    new IntersectionObserver(([e]) => { budgetOn = e.isIntersecting; syncPill(); }, { threshold: 0, rootMargin: margin }).observe(el.querySelector('.budget-main'));
  }

  // ---- Behaviour ----
  let shown = store.total();     // the target of the number animation
  let displayed = shown;         // what is on screen right now (animations start here, so a drag never jumps)
  let stopAnim = () => {};
  let deltaTimer = 0;
  let gestureBase = null;        // total at the start of a slider gesture: the delta shows the change since then
  const setVal = (v) => { displayed = v; val.textContent = fmtNum(v); pillVal.textContent = aed(v); };
  setVal(shown);

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggleLbl.textContent = t(open ? 'budget.hide' : 'budget.show');
    list.classList.toggle('is-open', open);
    list.inert = !open;
  });
  order.addEventListener('click', () => onOrder?.());
  reset.addEventListener('click', () => {
    // PT-15: the link hides itself after use, so hand focus to the next control first.
    if (document.activeElement === reset) toggle.focus({ preventScroll: true });
    store.reset?.();
    announce?.(t('budget.resetDone'));
  });

  function renderMeta() {
    const placed = store.placed().length;
    meta.textContent = t('budget.meta', { n: placed, items: itemsWord(placed), style: quoted(packNameOf(store.style?.())) });
    dockMeta.textContent = `${placed}${NBSP}${itemsWord(placed)}`;
    reset.hidden = !store.isCustomized?.() && !(store.pins?.().length);
  }

  /** Keys of the active style that are empty (left out by the budget): one muted row each, with «Добавить». */
  function excluded() {
    const sel = store.state.selection || {};
    return Object.keys(sel).filter((k) => sel[k] == null).map((key) => {
      const slots = store.slotsFor?.(key) || [];
      const slotId = slots[0] || key;
      const type = store.state.layout.slots.find((s) => s.id === slotId)?.type || key;
      return { key, slotId, type, def: store.defaultOf?.(key) || null };
    }).filter((x) => x.def && store.slotsFor?.(x.key)?.length);
  }

  function renderLines() {
    const ZONES = zones();
    const lng = getLang();
    const byZone = new Map(ZONES.map((z) => [z.id, { lines: [], out: [] }]));
    const zoneFor = (slotId, type) => byZone.get(zoneOf(slotId, type)) || byZone.get('window');
    for (const line of store.lines()) zoneFor(line.slotId, line.item.type).lines.push(line);
    for (const x of excluded()) zoneFor(x.slotId, x.type).out.push(x);
    const pinned = new Set(store.pins?.() || []);
    groups.replaceChildren(...ZONES.filter((z) => byZone.get(z.id).lines.length || byZone.get(z.id).out.length).map((z) => {
      const { lines: ls, out } = byZone.get(z.id);
      const sub = ls.reduce((a, l) => a + l.sum, 0);
      const rows = ls.map(({ item, qty, sum, slotId, key }) => {
        const isPinned = pinned.has(key);
        const b = h('button', {
          type: 'button', class: 'line-btn', 'data-opens-sheet': '', 'data-slot': slotId,
          'aria-label': t('budget.lineAria', { name: `${nameOf(item)}${qty > 1 ? ` ×${qty}` : ''}`, sum: aed(sum) }) + (isPinned ? `. ${t('budget.pinned')}` : ''),
        },
          dot(item),
          h('span', { class: 'line-name' }, nameOf(item),
            isPinned ? h('span', { class: 'line-pin', title: t('budget.pinned'), 'aria-hidden': 'true', html: icon('pin') }) : null),
          h('span', { class: 'line-qty' }, qty > 1 ? `×${NBSP}${qty}` : ''),
          h('span', { class: 'line-sum' }, aed(sum)));
        b.addEventListener('click', () => onLine?.(slotId, b));
        if (!isPinned) return h('li', { class: 'line' }, b);
        const name = nameOf(item);
        const un = h('button', { type: 'button', class: 'line-act', 'aria-label': t('budget.unpinAria', { name }) }, t('budget.unpin'));
        un.addEventListener('click', () => {
          focusAfter = `[data-slot="${CSS.escape(slotId)}"].line-btn`;
          store.unpin(key);
          announce?.(t('budget.unpinned', { name }));
        });
        return h('li', { class: 'line is-pinned' }, b, un);
      });
      const outRows = out.map(({ key, slotId, type, def }) => {
        const name = keyLabel(lng, key, type);
        const add = h('button', { type: 'button', class: 'line-act line-add', 'aria-label': t('budget.addAria', { name }) },
          svg(icon('plus')), t('budget.add'));
        add.addEventListener('click', () => {
          focusAfter = `[data-slot="${CSS.escape(slotId)}"].line-btn`;
          store.select(key, def.id, { reason: 'user' });   // pins it: the slider plans around it from now on
          announce?.(t('budget.added', { name }));
        });
        return h('li', { class: 'line is-out' },
          h('div', { class: 'line-out' },
            h('span', { class: 'dot-c is-empty', 'aria-hidden': 'true' }),
            h('span', { class: 'line-name' }, name),
            h('span', { class: 'line-note' }, t('budget.out'))),
          add);
      });
      return h('section', { class: 'budget-group', 'aria-label': z.label },
        h('h4', { class: 'group-head' }, h('span', null, z.label), h('span', { class: 'num' }, aed(sub))),
        h('ul', { role: 'list' }, ...rows, ...outRows));
    }));
    // Keep keyboard focus on the row the action changed (it may move between renders: wait until it exists).
    if (focusAfter) {
      const target = groups.querySelector(focusAfter);
      if (target) { focusAfter = null; if (list.classList.contains('is-open')) target.focus({ preventScroll: true }); }
    }
  }
  let focusAfter = null;

  function flashDelta(d, { hold = false } = {}) {
    for (const n of [delta, pillDelta]) {
      n.textContent = d === 0 ? '' : fmtDelta(d);
      n.classList.toggle('is-down', d < 0);
      n.classList.toggle('is-visible', d !== 0);
    }
    clearTimeout(deltaTimer);
    if (!hold) deltaTimer = setTimeout(() => { delta.classList.remove('is-visible'); pillDelta.classList.remove('is-visible'); }, 2600);
  }

  let pendingAnnounce = 0;
  function update() {
    const next = store.total();
    const d = next - shown;
    stopAnim();
    shown = next;
    // From what is on screen (not the last target): a quick drag reads as one smooth count.
    stopAnim = animateNumber(displayed, next, setVal, { duration: gestureBase != null ? 260 : 700 });
    if (gestureBase != null) flashDelta(next - gestureBase, { hold: true });
    else if (d !== 0) {
      flashDelta(d);
      clearTimeout(pendingAnnounce);
      pendingAnnounce = setTimeout(() => announce?.(t('budget.announce', { total: aed(next), sign: t(d > 0 ? 'budget.plus' : 'budget.minus'), delta: aed(Math.abs(d)) })), 150);
    }
    renderMeta();
    renderLines();
  }

  function renderStatic() {
    label.textContent = t('budget.label');
    el.setAttribute('aria-label', t('budget.aria'));
    resetLbl.textContent = t('budget.reset');
    toggleLbl.textContent = t(toggle.getAttribute('aria-expanded') === 'true' ? 'budget.hide' : 'budget.show');
    order.textContent = t('budget.order');
    foot.textContent = t('budget.foot');
    pillLabel.textContent = t('cart.total');
    pillBtn.textContent = t('cart.order');
    pill.setAttribute('aria-label', dockView ? t('bs.label') : t('budget.label'));
    setVal(shown);
  }

  renderStatic();
  renderMeta();
  renderLines();
  // A style switch or a slider step fires one 'change' per key: batch the re-render into one frame.
  let raf = 0;
  const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); };
  store.on('change', later);
  store.on('pins', () => { renderMeta(); renderLines(); });
  store.on('style', () => renderMeta());
  if (slider) {
    slider.on('grab', () => { gestureBase = store.total(); el.classList.add('is-gesture'); syncPill(); });
    slider.on('release', (g) => {
      gestureBase = null;
      el.classList.remove('is-gesture');
      flashDelta(store.total() - g.startTotal);
      if (g.changed) announce?.(t('bs.announce', { level: slider.levelName(g.level), total: aed(g.total) }));
      syncPill();
    });
  }
  onLang(() => { renderStatic(); renderMeta(); renderLines(); });
  return {
    update, el,
    setSheetOpen(on) { hudOn = !!on; syncPill(); },
  };
}
