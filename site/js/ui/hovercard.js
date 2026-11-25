// Floating item card that follows the cursor over the 3D stage. Owner: interface.
import { h, clamp } from './dom.js';
import { typeLabel } from './labels.js';
import { specRows, price, nameOf } from './format.js';

export function createHoverCard({ el, store }) {
  el.setAttribute('role', 'tooltip');
  el.setAttribute('aria-hidden', 'true');
  let key = null;
  let size = { w: 0, h: 0 };
  let raf = 0;
  let pending = null;
  let visible = false;

  function render(p) {
    const item = p.item || store.selected(p.slotType);
    if (!item) return false;
    const qty = store.placed().filter((x) => x.slotType === p.slotType).length;
    const opts = store.options(p.slotType).length;
    el.replaceChildren(
      h('div', { class: 'hc-type' }, typeLabel(p.slotType || item.type)),
      h('div', { class: 'hc-name' }, nameOf(item)),
      h('div', { class: 'hc-price' }, price(item), qty > 1 ? h('small', null, `× ${qty} шт.`) : null),
      h('dl', { class: 'hc-specs' }, specRows(item)),
      h('div', { class: 'hc-foot' }, opts > 1 ? 'Кликните, чтобы заменить' : 'Кликните для подробностей'),
    );
    size = { w: el.offsetWidth, h: el.offsetHeight };
    return true;
  }

  function place(x, y) {
    const pad = 12, off = 18;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let left = x + off, top = y + off;
    if (left + size.w + pad > vw) left = x - off - size.w;
    if (top + size.h + pad > vh) top = y - off - size.h;
    left = clamp(left, pad, Math.max(pad, vw - size.w - pad));
    top = clamp(top, pad, Math.max(pad, vh - size.h - pad));
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function flush() {
    raf = 0;
    const p = pending;
    if (!p) return;
    const k = `${p.slotId}|${(p.item || store.selected(p.slotType))?.id}`;
    if (k !== key) {
      if (!render(p)) return hide();
      key = k;
    }
    place(p.x, p.y);
    if (!visible) { visible = true; el.classList.add('is-visible'); }
  }

  function show(p) {
    if (!p) return hide();
    pending = p;
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function hide() {
    pending = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!visible) return;
    visible = false;
    key = null;
    el.classList.remove('is-visible');
  }

  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('blur', hide);
  store.on('change', () => { key = null; if (pending) show(pending); });

  return { show, hide, get visible() { return visible; } };
}
