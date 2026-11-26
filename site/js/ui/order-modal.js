// «Заказать комплект» — honest MVP stub: a summary of the set, what ordering will include,
// and that the selection is saved on this device. No form, no personal data. Owner: interface.
import { h, svg, aed, quoted, NBSP, typo } from './dom.js';
import { icon } from './icons.js';
import { t, onLang, itemsWord } from './i18n.js';
import { nameOf, packName } from './format.js';

export function createOrderModal({ el, store }) {
  el.classList.add('modal');
  el.setAttribute('aria-labelledby', 'order-title');
  el.setAttribute('aria-describedby', 'order-desc');

  const closeBtn = h('button', { type: 'button', class: 'icon-btn modal-close', 'aria-label': 'Закрыть', html: icon('close') });
  const total = h('b');
  const count = h('span', { class: 'modal-count' });
  const lines = h('ul', { class: 'modal-lines', role: 'list' });
  const saved = h('p', { class: 'note' });
  const ok = h('button', { type: 'button', class: 'btn btn-primary' });
  const eyebrow = h('p', { class: 't-eyebrow' });
  const title = h('h2', { id: 'order-title' });
  const desc = h('p', { id: 'order-desc' });
  const setLabel = h('div', { class: 'modal-total-label' });
  const perks = [h('span'), h('span'), h('span')];

  el.replaceChildren(h('div', { class: 'modal-inner' },
    h('div', { class: 'modal-head' }, eyebrow, title, desc, closeBtn),
    h('div', { class: 'modal-body' },
      h('div', { class: 'modal-total' }, h('div', null, setLabel, count), total),
      h('ul', { class: 'modal-perks', role: 'list' },
        h('li', null, svg(icon('truck')), perks[0]),
        h('li', null, svg(icon('tools')), perks[1]),
        h('li', null, svg(icon('key')), perks[2])),
      lines),
    h('div', { class: 'modal-foot' }, saved, ok),
  ));

  let closing = 0;
  function render() {
    eyebrow.textContent = t('order.eyebrow');
    title.textContent = t('order.title');
    desc.textContent = typo(t('order.desc', { style: quoted(packName(store.style?.())) }));
    setLabel.textContent = t('order.set');
    perks.forEach((p, i) => { p.textContent = t(`order.perk${i + 1}`); });
    ok.textContent = t('order.done');
    closeBtn.setAttribute('aria-label', t('close'));
    total.textContent = aed(store.total());
    const n = store.placed().length;
    count.textContent = `${n}${NBSP}${itemsWord(n)}`;
    lines.replaceChildren(...store.lines().map(({ item, qty, sum }) =>
      h('li', null,
        h('span', null, nameOf(item), qty > 1 ? h('span', { class: 'q' }, ` ×${NBSP}${qty}`) : null),
        h('span', { class: 's' }, aed(sum)))));
    saved.textContent = typo(t(store.isCustomized?.() ? 'order.saved' : 'order.savedDefault'));
  }

  function open() {
    clearTimeout(closing);
    render();
    if (typeof el.showModal === 'function') { if (!el.open) el.showModal(); }
    else el.setAttribute('open', '');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
    ok.focus({ preventScroll: true });
  }

  function close() {
    if (!el.open) return;
    el.classList.remove('is-open');
    clearTimeout(closing);
    closing = setTimeout(() => { if (typeof el.close === 'function') el.close(); else el.removeAttribute('open'); }, 300);
  }

  el.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  closeBtn.addEventListener('click', close);
  ok.addEventListener('click', close);
  store.on('change', () => { if (el.open) render(); });
  onLang(() => { if (el.open) render(); });

  return { open, close };
}
