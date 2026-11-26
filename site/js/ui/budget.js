// Live budget: compact bar under the editor, zone-grouped itemized list, reset link,
// and a sticky total pill on phones while the stage is on screen. Owner: interface.
import { h, svg, fmtNum, fmtDelta, aed, quoted, NBSP } from './dom.js';
import { icon } from './icons.js';
import { zones, zoneOf } from './labels.js';
import { t, onLang, itemsWord } from './i18n.js';
import { animateNumber } from './motion.js';
import { dot, nameOf, packName as packNameOf } from './format.js';

export function createBudget({ el, store, stage, onOrder, onLine, announce }) {
  // ---- Bar ----
  const val = h('span', { class: 'val' }, '0');
  const delta = h('span', { class: 'budget-delta', 'aria-hidden': 'true' });
  const meta = h('div', { class: 'budget-meta' });
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

  el.replaceChildren(
    h('div', { class: 'budget-main' },
      h('div', { class: 'budget-sum' },
        label,
        h('div', { class: 'budget-total', 'aria-labelledby': 'budget-label' }, val, h('span', { class: 'cur' }, 'AED'), delta)),
      h('div', { class: 'budget-side' }, meta, h('div', { class: 'budget-links' }, toggle, reset)),
      h('div', { class: 'budget-actions' }, order)),
    list,
  );

  // ---- Mobile sticky total (CSS shows it only ≤ 734 px) ----
  const pillVal = h('span', { class: 'cartbar-val num' });
  const pillDelta = h('span', { class: 'cartbar-delta', 'aria-hidden': 'true' });
  const pillBtn = h('button', { type: 'button', class: 'btn btn-primary cartbar-btn' });
  const pillLabel = h('span', { class: 'cartbar-label' });
  const pill = h('div', { class: 'cartbar glass', role: 'region' },
    h('div', { class: 'cartbar-sum' }, pillLabel, pillVal, pillDelta), pillBtn);
  document.body.append(pill);
  pillBtn.addEventListener('click', () => onOrder?.());

  let stageOn = false, budgetOn = false, sheetOn = false;
  const syncPill = () => {
    // While the item sheet is open it covers the budget bar on phones, so the pill carries the total.
    const show = (stageOn && !budgetOn) || sheetOn;
    pill.classList.toggle('is-visible', show);
    document.documentElement.classList.toggle('cartbar-on', show);
    pill.inert = !show;
  };
  syncPill();
  if ('IntersectionObserver' in window && stage) {
    new IntersectionObserver(([e]) => { stageOn = e.intersectionRatio >= 0.5; syncPill(); }, { threshold: [0, 0.5, 1] }).observe(stage);
    new IntersectionObserver(([e]) => { budgetOn = e.isIntersecting; syncPill(); }, { threshold: 0.6 }).observe(el.querySelector('.budget-main'));
  }

  // ---- Behaviour ----
  let shown = store.total();
  let stopAnim = () => {};
  let deltaTimer = 0;
  const setVal = (v) => { val.textContent = fmtNum(v); pillVal.textContent = aed(v); };
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
    store.reset?.();
    announce?.(t('budget.resetDone'));
  });

  function renderMeta() {
    const placed = store.placed().length;
    meta.textContent = t('budget.meta', { n: placed, items: itemsWord(placed), style: quoted(packNameOf(store.style?.())) });
    reset.hidden = !store.isCustomized?.();
  }

  function renderLines() {
    const ZONES = zones();
    const byZone = new Map(ZONES.map((z) => [z.id, []]));
    for (const line of store.lines()) {
      const z = zoneOf(line.slotId, line.item.type);
      (byZone.get(z) || byZone.get('window')).push(line);
    }
    groups.replaceChildren(...ZONES.filter((z) => byZone.get(z.id).length).map((z) => {
      const ls = byZone.get(z.id);
      const sub = ls.reduce((a, l) => a + l.sum, 0);
      return h('section', { class: 'budget-group', 'aria-label': z.label },
        h('h4', { class: 'group-head' }, h('span', null, z.label), h('span', { class: 'num' }, aed(sub))),
        h('ul', { role: 'list' }, ls.map(({ item, qty, sum, slotId }) => {
          const b = h('button', {
            type: 'button', class: 'line-btn', 'data-opens-sheet': '', 'data-slot': slotId,
            'aria-label': t('budget.lineAria', { name: `${nameOf(item)}${qty > 1 ? ` ×${qty}` : ''}`, sum: aed(sum) }),
          },
            dot(item),
            h('span', { class: 'line-name' }, nameOf(item)),
            h('span', { class: 'line-qty' }, qty > 1 ? `×${NBSP}${qty}` : ''),
            h('span', { class: 'line-sum' }, aed(sum)));
          b.addEventListener('click', () => onLine?.(slotId, b));
          return h('li', null, b);
        })));
    }));
  }

  function flashDelta(d) {
    for (const n of [delta, pillDelta]) {
      n.textContent = fmtDelta(d);
      n.classList.toggle('is-down', d < 0);
      n.classList.add('is-visible');
    }
    clearTimeout(deltaTimer);
    deltaTimer = setTimeout(() => { delta.classList.remove('is-visible'); pillDelta.classList.remove('is-visible'); }, 2600);
  }

  let pendingAnnounce = 0;
  function update() {
    const next = store.total();
    const d = next - shown;
    stopAnim();
    const from = shown;
    shown = next;
    stopAnim = animateNumber(from, next, setVal);
    if (d !== 0) {
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
    pill.setAttribute('aria-label', t('budget.label'));
    setVal(shown);
  }

  renderStatic();
  renderMeta();
  renderLines();
  // A style switch fires one 'change' per key: batch the re-render into one frame.
  let raf = 0;
  store.on('change', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); });
  store.on('style', () => renderMeta());
  onLang(() => { renderStatic(); renderMeta(); renderLines(); });
  return {
    update, el,
    setSheetOpen(on) { sheetOn = !!on; syncPill(); },
  };
}
