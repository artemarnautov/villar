// Item details + "Заменить на" sheet. Right-side panel on desktop, bottom sheet on mobile. Owner: interface.
import { h, svg, plural, fmtDelta, isCompact } from './dom.js';
import { icon } from './icons.js';
import { typeLabel, OPTION_FORMS } from './labels.js';
import { specRows, dims, colorHex, price, nameOf } from './format.js';

export function createSheet({ el, scrim, shell, stage, store, packName, onOpen, onClose }) {
  let cur = null;          // { slotId, slotType }
  let opener = null;       // element to return focus to
  let suppressOutside = false;

  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'sheet-title');
  el.tabIndex = -1;

  const grip = h('button', { class: 'sheet-grip', type: 'button', 'aria-label': 'Закрыть панель', tabindex: '-1' });
  const tile = h('div', { class: 'sheet-tile', 'aria-hidden': 'true' });
  const type = h('div', { class: 'sheet-type' });
  const title = h('h3', { class: 'sheet-title', id: 'sheet-title' });
  const close = h('button', { class: 'icon-btn sheet-close', type: 'button', 'aria-label': 'Закрыть', html: icon('close') });
  const body = h('div', { class: 'sheet-body' });
  el.replaceChildren(grip, h('header', { class: 'sheet-head' }, tile, h('div', null, type, title), close), body);

  close.addEventListener('click', () => api.close());
  grip.addEventListener('click', () => api.close());
  scrim?.addEventListener('click', () => api.close());

  function qtyOf(c) { return store.qty(c.slotId || c.slotType) || 1; }

  function render({ keepScroll = false } = {}) {
    if (!cur) return;
    const item = store.selected(cur.slotId || cur.slotType) || cur.item;
    if (!item) return;
    const qty = qtyOf(cur);
    const options = store.options(cur.slotId || cur.slotType);

    tile.style.setProperty('--c', colorHex(item));
    type.textContent = qty > 1 ? `${typeLabel(cur.slotType)} · ${qty} шт. в квартире` : typeLabel(cur.slotType);
    title.textContent = nameOf(item);
    title.classList.toggle('is-long', nameOf(item).length > 44);

    const scroll = body.scrollTop;
    const kids = [
      h('div', { class: 'sheet-price' }, price(item), qty > 1 ? h('small', null, `за шт. · ${price(item, qty)} за ${qty}`) : null),
      h('dl', { class: 'sheet-specs' }, specRows(item)),
      h('div', { class: 'sheet-compat' }, svg(icon('check')), `Совместимо со стилем «${packName}»`),
    ];

    if (options.length > 1) {
      kids.push(h('div', { class: 'sheet-sub' },
        h('h4', { id: 'swap-title' }, 'Заменить на'),
        h('span', null, `${options.length} ${plural(options.length, OPTION_FORMS)}`)));
      const list = h('ul', { class: 'options', role: 'list', 'aria-labelledby': 'swap-title' });
      for (const opt of options) {
        const isCur = opt.id === item.id;
        const delta = ((Number(opt.price) || 0) - (Number(item.price) || 0)) * qty;
        const dm = dims(opt);
        const btn = h('button', {
          type: 'button', class: `opt${isCur ? ' is-current' : ''}`,
          'aria-pressed': isCur ? 'true' : 'false',
          'aria-label': `${nameOf(opt)}, ${price(opt)}${isCur ? ', выбрано сейчас' : `, ${delta === 0 ? 'та же цена' : fmtDelta(delta)} к итогу`}`,
        },
          h('span', { class: 'opt-tile', style: `--c:${colorHex(opt)}`, 'aria-hidden': 'true' }),
          h('span', { class: 'opt-mid' },
            h('span', { class: 'opt-name' }, nameOf(opt)),
            h('span', { class: 'opt-meta' }, h('span', { class: 'dot-c', style: `--c:${colorHex(opt)}` }), [opt.color, dm?.value].filter(Boolean).join(' · '))),
          h('span', { class: 'opt-right' },
            h('span', { class: 'opt-price' }, price(opt)),
            isCur
              ? h('span', { class: 'opt-delta is-cur', html: `${icon('check')}<span>Сейчас</span>` })
              : h('span', { class: `opt-delta${delta < 0 ? ' is-down' : ''}` }, delta === 0 ? 'Та же цена' : fmtDelta(delta))),
        );
        if (!isCur) btn.addEventListener('click', () => store.select(cur.slotId || cur.slotType, opt.id));
        list.append(h('li', null, btn));
      }
      kids.push(list);
      kids.push(h('p', { class: 'sheet-note' }, qty > 1
        ? `Замена применяется ко всем ${qty} предметам этого типа. Итог пересчитается сразу.`
        : 'Только проверенные сочетания: всё подходит по размеру, цвету и материалам.'));
    } else {
      kids.push(h('p', { class: 'sheet-note' }, `Это единственный вариант в стиле «${packName}» — он подобран под пропорции и палитру квартиры.`));
    }

    body.replaceChildren(...kids);
    if (keepScroll) {
      body.scrollTop = scroll;
      body.classList.remove('is-swapping'); void body.offsetWidth; body.classList.add('is-swapping');
    } else body.scrollTop = 0;
  }

  const api = {
    get isOpen() { return !!cur; },
    get current() { return cur; },
    open(p, { focus = false, from = null } = {}) {
      if (!p || !p.slotType) return api.close();
      const same = cur && cur.slotId === p.slotId;
      cur = { slotId: p.slotId, slotType: p.slotType, item: p.item };
      if (from) opener = from;
      else if (!same) opener = document.activeElement !== document.body ? document.activeElement : null;
      render({ keepScroll: same });
      el.style.removeProperty('--drag');
      el.classList.add('is-open');
      scrim?.classList.add('is-open');
      shell.classList.add('has-sheet');
      suppressOutside = true; setTimeout(() => (suppressOutside = false), 0);
      if (focus || isCompact()) (focus ? close : el).focus({ preventScroll: true });
      onOpen?.(cur);
    },
    close({ restoreFocus = true } = {}) {
      if (!cur) return;
      const was = cur;
      cur = null;
      el.classList.remove('is-open');
      scrim?.classList.remove('is-open');
      shell.classList.remove('has-sheet');
      if (restoreFocus && el.contains(document.activeElement) && opener?.isConnected) opener.focus({ preventScroll: true });
      opener = null;
      onClose?.(was);
    },
    refresh() { render({ keepScroll: true }); },
  };

  store.on('change', ({ slotType, slots }) => { if (cur && (slots ? slots.includes(cur.slotId) : cur.slotType === slotType)) render({ keepScroll: true }); });

  // Click outside (stage clicks are handled by the engine's select event).
  document.addEventListener('pointerdown', (e) => {
    if (!cur || suppressOutside) return;
    const t = e.target;
    if (el.contains(t) || stage.contains(t) || t.closest?.('[data-opens-sheet], .hovercard, dialog')) return;
    api.close({ restoreFocus: false });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cur && !document.querySelector('dialog[open]')) { e.preventDefault(); api.close(); }
  });

  // Swipe down to dismiss (bottom sheet).
  let drag = null;
  const onDown = (e) => {
    if (!isCompact() || !cur) return;
    if (e.target.closest('button:not(.sheet-grip)')) return;
    drag = { y: e.clientY, dy: 0, id: e.pointerId };
    el.classList.add('is-dragging');
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    el.style.setProperty('--drag', `${drag.dy}px`);
  };
  const onUp = () => {
    if (!drag) return;
    el.classList.remove('is-dragging');
    const dy = drag.dy; drag = null;
    if (dy > 90) api.close(); else el.style.removeProperty('--drag');
  };
  const head = el.querySelector('.sheet-head');
  for (const t of [grip, head]) {
    t.addEventListener('pointerdown', onDown);
    t.addEventListener('pointermove', onMove);
    t.addEventListener('pointerup', onUp);
    t.addEventListener('pointercancel', onUp);
  }

  return api;
}
