// Live budget bar under the editor. Owner: interface.
import { h, svg, plural, fmtNum, fmtDelta } from './dom.js';
import { formatAED } from '../core/data.js';
import { icon } from './icons.js';
import { typeLabel, ITEM_FORMS, LINE_FORMS } from './labels.js';
import { animateNumber } from './motion.js';
import { colorHex } from './format.js';

export function createBudget({ el, store, packName, onOrder, onLine, announce }) {
  const val = h('span', { class: 'val' }, '0');
  const cur = h('span', { class: 'cur' }, 'AED');
  const delta = h('span', { class: 'budget-delta', 'aria-hidden': 'true' });
  const meta = h('div', { class: 'budget-meta' });
  const toggle = h('button', {
    type: 'button', class: 'budget-toggle', 'aria-expanded': 'false', 'aria-controls': 'budget-list',
  }, h('span', null, 'Показать состав'), svg(icon('chevronDown')));
  const order = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, 'Заказать всё в один клик');
  const lines = h('ul', { class: 'budget-lines', role: 'list' });
  const foot = h('p', { class: 'budget-foot' }, 'Нажмите на позицию, чтобы посмотреть варианты замены.');
  const list = h('div', { class: 'budget-list', id: 'budget-list', inert: true },
    h('div', { class: 'budget-list-inner' }, lines, foot));

  el.replaceChildren(
    h('div', { class: 'budget-main' },
      h('div', { class: 'budget-sum' },
        h('div', { class: 'budget-label', id: 'budget-label' }, 'Итого за квартиру'),
        h('div', { class: 'budget-total', 'aria-labelledby': 'budget-label' }, val, cur, delta),
        meta),
      h('div', { class: 'budget-actions' }, toggle, order)),
    list,
  );

  let shown = store.total();
  let stopAnim = () => {};
  let deltaTimer = 0;
  val.textContent = fmtNum(shown);

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.firstElementChild.textContent = open ? 'Скрыть состав' : 'Показать состав';
    list.classList.toggle('is-open', open);
    list.inert = !open;
  });
  order.addEventListener('click', () => onOrder?.());

  function renderMeta() {
    const placed = store.placed().length;
    const ln = store.lines().length;
    meta.textContent = `${placed} ${plural(placed, ITEM_FORMS)} · ${ln} ${plural(ln, LINE_FORMS)} · стиль «${packName}»`;
  }

  function renderLines() {
    lines.replaceChildren(...store.lines().map(({ item, qty, sum }) => {
      const b = h('button', {
        type: 'button', class: 'line-btn', 'data-opens-sheet': '',
        'aria-label': `${item.name}${qty > 1 ? `, ${qty} шт.` : ''}, ${formatAED(sum)}. Открыть варианты`,
      },
        h('span', { class: 'dot-c', style: `--c:${colorHex(item)}`, 'aria-hidden': 'true' }),
        h('span', { class: 'line-name' }, item.name, h('small', null, typeLabel(item.type))),
        h('span', { class: 'line-qty' }, `× ${qty}`),
        h('span', { class: 'line-sum' }, formatAED(sum)));
      b.addEventListener('click', () => onLine?.(item.type, b));
      return h('li', null, b);
    }));
  }

  function update() {
    const next = store.total();
    const d = next - shown;
    stopAnim();
    const from = shown;
    shown = next;
    stopAnim = animateNumber(from, next, (v) => (val.textContent = fmtNum(v)));
    if (d !== 0) {
      delta.textContent = fmtDelta(d);
      delta.classList.toggle('is-down', d < 0);
      delta.classList.add('is-visible');
      clearTimeout(deltaTimer);
      deltaTimer = setTimeout(() => delta.classList.remove('is-visible'), 2200);
      announce?.(`Итого ${formatAED(next)}, ${d > 0 ? 'плюс' : 'минус'} ${formatAED(Math.abs(d))}`);
    }
    renderMeta();
    renderLines();
  }

  renderMeta();
  renderLines();
  store.on('change', update);
  return { update, el };
}
