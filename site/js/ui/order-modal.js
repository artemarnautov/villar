// "Заказать всё в один клик" — MVP summary modal (no form, no personal data). Owner: interface.
import { h, svg, plural } from './dom.js';
import { formatAED } from '../core/data.js';
import { icon } from './icons.js';
import { ITEM_FORMS, LINE_FORMS } from './labels.js';

export function createOrderModal({ el, store, packName, layoutName }) {
  el.classList.add('modal');
  el.setAttribute('aria-labelledby', 'order-title');
  el.setAttribute('aria-describedby', 'order-desc');

  const closeBtn = h('button', { type: 'button', class: 'icon-btn modal-close', 'aria-label': 'Закрыть', html: icon('close') });
  const total = h('b');
  const count = h('span');
  const lines = h('ul', { class: 'modal-lines', role: 'list' });
  const ok = h('button', { type: 'button', class: 'btn btn-primary' }, 'Понятно');

  el.replaceChildren(h('div', { class: 'modal-inner' },
    h('div', { class: 'modal-head' },
      h('p', { class: 't-eyebrow' }, 'Скоро'),
      h('h2', { id: 'order-title' }, 'Заказ в один клик'),
      h('p', { id: 'order-desc' }, `Совсем скоро весь комплект «${packName}» для квартиры «${layoutName}» можно будет заказать одной кнопкой — мы привезём всё и соберём за один день.`),
      closeBtn),
    h('div', { class: 'modal-body' },
      h('div', { class: 'modal-total' }, h('div', null, h('div', { class: 't-small', style: 'color:var(--text-2)' }, 'Ваш комплект'), count), total),
      h('ul', { class: 'modal-perks', role: 'list' },
        h('li', null, svg(icon('truck')), 'Доставка всего комплекта'),
        h('li', null, svg(icon('tools')), 'Сборка за один день'),
        h('li', null, svg(icon('key')), 'Готово к заселению')),
      lines),
    h('div', { class: 'modal-foot' },
      h('p', { class: 'note' }, 'Оформление заказа ещё не открыто. Ваш выбор сохранится, пока открыта страница.'),
      ok),
  ));

  let closing = 0;
  function render() {
    total.textContent = formatAED(store.total());
    const n = store.placed().length, l = store.lines().length;
    count.textContent = `${n} ${plural(n, ITEM_FORMS)} · ${l} ${plural(l, LINE_FORMS)}`;
    lines.replaceChildren(...store.lines().map(({ item, qty, sum }) =>
      h('li', null,
        h('span', null, item.name, qty > 1 ? h('span', { class: 'q' }, ` × ${qty}`) : null),
        h('span', { class: 's' }, formatAED(sum)))));
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

  return { open, close };
}
