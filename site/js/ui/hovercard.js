// Floating item card that follows the cursor over the 3D stage. Owner: interface.
// Content: category eyebrow, short name, price (set price for pairs), dimensions. Clamped to the stage.
import { h, clamp } from './dom.js';
import { typeLabel } from './labels.js';
import { onLang } from './i18n.js';
import { shortNameOf, price, unitNote, dims } from './format.js';

export function createHoverCard({ el, store, bounds }) {
  el.setAttribute('role', 'tooltip');
  el.setAttribute('aria-hidden', 'true');
  let key = null;
  let size = { w: 0, h: 0 };
  let raf = 0;
  let pending = null;
  let visible = false;

  function render(p) {
    const ref = p.slotId || p.slotType;
    const item = store.selected(ref) || p.item;
    if (!item) return false;
    const qty = store.qty(ref) || 1;
    const dm = dims(item);
    const note = unitNote(item, qty);
    el.replaceChildren(...[
      h('div', { class: 'hc-type' }, typeLabel(p.slotType || item.type)),
      h('div', { class: 'hc-name' }, shortNameOf(item)),
      h('div', { class: 'hc-price' }, price(item, qty), note ? h('small', null, note) : null),
      dm ? h('div', { class: 'hc-dims' }, dm.value) : null,
    ].filter(Boolean));
    size = { w: el.offsetWidth, h: el.offsetHeight };
    return true;
  }

  function place(x, y) {
    const pad = 12, off = 18;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    // Keep the card inside the visible part of the stage (falls back to the viewport).
    const r = bounds?.()?.getBoundingClientRect?.();
    const L = Math.max(pad, r ? r.left + pad : pad);
    const T = Math.max(pad, r ? r.top + pad : pad);
    const R = Math.min(vw - pad, r ? r.right - pad : vw - pad);
    const B = Math.min(vh - pad, r ? r.bottom - pad : vh - pad);
    let left = x + off, top = y + off;
    if (left + size.w > R) left = x - off - size.w;
    if (top + size.h > B) top = y - off - size.h;
    left = clamp(left, L, Math.max(L, R - size.w));
    top = clamp(top, T, Math.max(T, B - size.h));
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function flush() {
    raf = 0;
    const p = pending;
    if (!p) return;
    const k = `${p.slotId}|${store.selected(p.slotId || p.slotType)?.id}`;
    if (k !== key) {
      if (!render(p)) return hide();
      key = k;
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return hide();
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
  onLang(() => { key = null; hide(); });

  return { show, hide, get visible() { return visible; } };
}
