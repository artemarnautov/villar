// Floating item card that follows the cursor over the 3D stage. Owner: interface.
// Content: category eyebrow, short name, price (set price for pairs), dimensions. Clamped to the stage.
import { h, clamp } from './dom.js';
import { slotLabel } from './labels.js';
import { onLang } from './i18n.js';
import { shortNameOf, price, unitNote, dims, setNoteOf } from './format.js';

export function createHoverCard({ el, store, bounds, avoid = () => [] }) {
  el.setAttribute('role', 'tooltip');
  el.setAttribute('aria-hidden', 'true');
  let key = null;
  let size = { w: 0, h: 0 };
  let raf = 0;
  let pending = null;
  let visible = false;
  let quietUntil = 0;   // D3-08: no card right after the panel closes (the pointer is usually still on an item)

  function render(p) {
    const ref = p.slotId || p.slotType;
    if (store.included?.(ref) === false) return false;   // empty slot (store v3): no card
    const item = store.selected(ref) || p.item;
    if (!item) return false;
    const qty = store.qty(ref) || 1;
    const dm = dims(item);
    const note = unitNote(item, qty);
    el.replaceChildren(...[
      h('div', { class: 'hc-type' }, slotLabel(p.slotId, p.slotType || item.type)),
      h('div', { class: 'hc-name' }, shortNameOf(item)),
      h('div', { class: 'hc-price' }, price(item, qty), note ? h('small', null, note) : null),
      dm ? h('div', { class: 'hc-dims' }, dm.value) : null,
      setNoteOf(item) ? h('div', { class: 'hc-note' }, setNoteOf(item)) : null,
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
    // D3-08: the dock and the stage's corner controls are no-go areas — try the four sides of the cursor.
    const keepOut = avoid().map((n) => n?.getBoundingClientRect?.()).filter((b) => b && b.width && b.height);
    const fit = (l, t) => [clamp(l, L, Math.max(L, R - size.w)), clamp(t, T, Math.max(T, B - size.h))];
    const hits = ([l, t]) => keepOut.some((b) => l < b.right && l + size.w > b.left && t < b.bottom && t + size.h > b.top);
    const right = x + off + size.w <= R, below = y + off + size.h <= B;
    const xs = right ? [x + off, x - off - size.w] : [x - off - size.w, x + off];
    const ys = below ? [y + off, y - off - size.h] : [y - off - size.h, y + off];
    const tries = [[xs[0], ys[0]], [xs[0], ys[1]], [xs[1], ys[0]], [xs[1], ys[1]]].map(([l, t]) => fit(l, t));
    const [left, top] = tries.find((c) => !hits(c)) || tries[0];
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
    if (!p || performance.now() < quietUntil) return hide();
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
  store.on('style', () => { key = null; hide(); });   // D3-08: never ride along through a style switch
  onLang(() => { key = null; hide(); });

  /** Hide and stay hidden for `ms` (e.g. after the item panel closes under a resting pointer). */
  function quiet(ms = 600) { quietUntil = performance.now() + ms; hide(); }

  return { show, hide, quiet, get visible() { return visible; } };
}
