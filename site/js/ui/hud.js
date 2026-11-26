// Focus HUD: what you get when you pick an object in the room. Owner: interface.
// Desktop: a compact glass card beside the framed object + a tray of alternatives along the bottom of
// the stage («В этом стиле» | «Из других стилей»). Phones: one bottom panel (card, then the two rows).
// Picking an item from another style previews the room-wide consequence and asks to confirm.
import { h, svg, fmtDelta, aed, isCompact, quoted, NBSP, typo } from './dom.js';
import { icon } from './icons.js';
import { t, L, itemsWord, optionsWord } from './i18n.js';
import { typeLabel } from './labels.js';
import { dims, dot, price, unitNote, shortNameOf, nameOf, colorHex, colorName, packName } from './format.js';

export function createHud({ el, shell, stage, store, palettes, thumbs, onOpen, onClose, onResize }) {
  let cur = null;          // { slotId, slotType }
  let opener = null;
  let pending = null;      // { styleId, itemId } awaiting confirmation
  let suppressOutside = false;
  let openedAt = -Infinity; // event-time of the last open (QA-01: ghost clicks after a tap)
  let openerSel = null;     // re-find a re-rendered opener (budget line / plan item) by slot id

  el.classList.add('hud');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'hud-title');
  el.tabIndex = -1;

  const grip = h('button', { class: 'hud-grip', type: 'button', tabindex: '-1' });
  const card = h('section', { class: 'hud-card glass-strong' });
  const tray = h('section', { class: 'hud-tray glass-strong' });
  const confirm = h('div', { class: 'hud-confirm', role: 'alertdialog', 'aria-live': 'polite', hidden: true });
  el.replaceChildren(grip, card, tray);
  tray.append(confirm);

  let skipClick = false;
  grip.addEventListener('click', () => { if (skipClick) { skipClick = false; return; } setExpanded(!el.classList.contains('is-expanded')); });

  const ref = () => cur.slotId || cur.slotType;

  // ---------- Pieces ----------
  function visual(item, cls) {
    const can = thumbs?.available?.();
    const swatch = () => h('span', { class: 'tile-swatch', style: `--c:${colorHex(item)}` });
    if (!can) return h('span', { class: `${cls} is-swatch`, 'aria-hidden': 'true' }, swatch());
    const box = h('span', { class: `${cls} is-thumb is-loading`, 'aria-hidden': 'true' }, swatch());
    Promise.resolve(thumbs.get(item.id)).then((url) => {
      if (!url || !box.isConnected) return;
      const img = h('img', { src: url, alt: '', decoding: 'async', draggable: 'false' });
      img.addEventListener('load', () => box.classList.remove('is-loading'), { once: true });
      box.replaceChildren(img);
    }).catch(() => {});
    return box;
  }

  function factFor(item, qty) {
    const own = L(item.fact, item.factEn);
    if (own) return own;
    const opts = store.options(ref()).filter((o) => Number.isFinite(Number(o.price)));
    if (opts.length > 1) {
      const min = Math.min(...opts.map((o) => Number(o.price)));
      if (Number(item.price) <= min) return t('fact.cheapest', { style: quoted(packName(store.style())) });
      return t('fact.save', { sum: aed((Number(item.price) - min) * qty) });
    }
    const total = store.total() || 1;
    return t('fact.share', { pct: Math.max(1, Math.round((Number(item.price) * qty / total) * 100)) });
  }

  function tile(item, { qty, current, delta, onPick, pendingOn }) {
    const b = h('button', {
      type: 'button', class: `tile${current ? ' is-current' : ''}${pendingOn ? ' is-pending' : ''}`, 'data-item': item.id,
      'aria-pressed': current ? 'true' : 'false',
      'aria-label': `${nameOf(item)}, ${price(item, qty)}${current ? `, ${t('hud.selected')}` : delta != null ? `, ${delta === 0 ? t('hud.same') : fmtDelta(delta)}` : ''}`,
    },
      visual(item, 'tile-vis'),
      h('span', { class: 'tile-name' }, shortNameOf(item)),
      h('span', { class: 'tile-foot' },
        h('span', { class: 'tile-price' }, price(item, qty)),
        current
          ? h('span', { class: 'tile-delta is-cur', html: `${icon('check')}<span>${t('hud.selected')}</span>` })
          : delta != null ? h('span', { class: `tile-delta${delta < 0 ? ' is-down' : ''}` }, delta === 0 ? t('hud.same') : fmtDelta(delta)) : null));
    if (!current) b.addEventListener('click', onPick);
    return h('li', null, b);
  }

  // ---------- Render ----------
  function renderCard(item, qty) {
    const dm = dims(item);
    const note = unitNote(item, qty);
    const mats = (L(item.materials, item.materialsEn) || []);
    card.replaceChildren(
      h('div', { class: 'hud-head' }, ...[
        h('div', { class: 'hud-type' }, qty > 1 ? `${typeLabel(cur.slotType)} · ${t('hud.pcs', { n: qty })}` : typeLabel(cur.slotType)),
        h('h3', { class: 'hud-name', id: 'hud-title', title: nameOf(item) }, shortNameOf(item)),
        h('div', { class: 'hud-price' }, h('span', { class: 'num' }, price(item, qty)), note ? h('small', null, note) : null),
      ]),
      h('div', { class: 'hud-details' },
        h('dl', { class: 'hud-specs' },
          dm ? h('div', null, h('dt', null, t('hud.size')), h('dd', null, dm.value)) : null,
          mats.length ? h('div', null, h('dt', null, t('hud.materials')), h('dd', null, typo(mats.slice(0, 3).join(', ')))) : null,
          (item.color || item.colorHex) ? h('div', null, h('dt', null, t('hud.color')), h('dd', null, dot(item), colorName(item) || '—')) : null),
        h('p', { class: 'hud-fact' }, svg(icon('sparkle')), h('span', null, typo(factFor(item, qty))))),
    );
  }

  function renderTray(item, qty) {
    const options = store.options(ref());
    const same = h('div', { class: 'hud-row hud-same' },
      h('div', { class: 'hud-row-head' }, h('h4', { id: 'hud-same-title' }, t('hud.inStyle')),
        h('span', null, `${options.length}${NBSP}${optionsWord(options.length)}`)));
    if (options.length > 1) {
      same.append(h('ul', { class: 'tiles', role: 'list', 'aria-labelledby': 'hud-same-title' }, options.map((opt) => tile(opt, {
        qty, current: opt.id === item.id,
        delta: ((Number(opt.price) || 0) - (Number(item.price) || 0)) * qty,
        onPick: () => { clearPending(); store.select(ref(), opt.id); },
      }))));
    } else {
      same.append(h('p', { class: 'hud-empty' }, t('hud.only')));
    }

    const groups = store.otherStyleOptions?.(cur.slotId) || [];
    const other = h('div', { class: 'hud-row hud-other' },
      h('div', { class: 'hud-row-head' }, h('h4', { id: 'hud-other-title' }, t('hud.otherStyles'))));
    if (groups.length) {
      other.append(h('div', { class: 'hud-groups' }, groups.map((g) => {
        const sw = (palettes?.[g.style.id]?.swatches || []).slice().sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 3);
        return h('div', { class: 'hud-group' },
          h('div', { class: 'hud-group-name' },
            h('span', { class: 'pdots', 'aria-hidden': 'true' }, sw.map((s) => h('i', { style: `--c:${s.hex}` }))),
            packName(g.style)),
          h('ul', { class: 'tiles', role: 'list', 'aria-label': packName(g.style) }, g.items.map((it) => tile(it, {
            qty, current: false, delta: null,
            pendingOn: pending && pending.styleId === g.style.id && pending.itemId === it.id,
            onPick: () => askStyle(g.style.id, it.id),
          }))));
      })));
    } else {
      other.append(h('p', { class: 'hud-empty' }, t('hud.otherSoon')));
    }
    tray.replaceChildren(same, h('div', { class: 'hud-sep', 'aria-hidden': 'true' }), other, confirm);
    if (qty > 1) same.querySelector('.hud-row-head span').textContent += ` · ${t('hud.setNote', { n: qty })}`;
  }

  function render({ keepScroll = false } = {}) {
    if (!cur) return;
    const item = store.selected(ref()) || cur.item;
    if (!item) return;
    const qty = store.qty(ref()) || 1;
    const scrolls = [...tray.querySelectorAll('.tiles')].map((u) => u.scrollLeft);
    const y = el.scrollTop;
    // QA-04: re-rendering must not drop keyboard focus. Remember where it was and put it back.
    const active = document.activeElement;
    const hadFocus = el.contains(active) && active !== el;
    const focusedRow = active?.closest?.('.hud-same') ? 'same' : active?.closest?.('.hud-other') ? 'other' : null;
    const focusedItem = active?.dataset?.item || null;
    renderCard(item, qty);
    renderTray(item, qty);
    if (hadFocus) {
      const target = (focusedRow === 'same' && tray.querySelector('.hud-same .tile.is-current'))
        || (focusedItem && tray.querySelector(`.tile[data-item="${CSS.escape(focusedItem)}"]`))
        || tray.querySelector('.tile.is-current') || el;
      target.focus({ preventScroll: true });
    }
    if (keepScroll) {
      [...tray.querySelectorAll('.tiles')].forEach((u, i) => { u.scrollLeft = scrolls[i] || 0; });
      el.scrollTop = y;
    } else {
      // Centre the chosen tile in its row (horizontal only: never scroll the panel itself).
      el.scrollTop = 0;
      requestAnimationFrame(() => {
        const tileEl = tray.querySelector('.tile.is-current');
        const row = tileEl?.closest('.tiles');
        if (!row) return;
        const tr = tileEl.getBoundingClientRect(), rr = row.getBoundingClientRect();
        row.scrollLeft = Math.max(0, row.scrollLeft + (tr.left - rr.left) - (rr.width - tr.width) / 2);
      });
    }
    renderConfirm();
    requestAnimationFrame(() => {
      const th = `${Math.round(tray.getBoundingClientRect().height)}px`;
      el.style.setProperty('--tray-h', th);
      shell.style.setProperty('--tray-h', th);
      onResize?.(api.insets());
    });
  }

  // ---------- Style consequence ----------
  function askStyle(styleId, itemId) {
    pending = { styleId, itemId };
    render({ keepScroll: true });
  }
  function clearPending() { if (pending) { pending = null; render({ keepScroll: true }); } }
  function renderConfirm() {
    if (!pending || !cur) { confirm.hidden = true; el.classList.remove('has-confirm'); return; }
    const pv = store.previewStyle(pending.styleId, { slotId: cur.slotId, itemId: pending.itemId });
    if (!pv) { pending = null; confirm.hidden = true; return; }
    const target = store.style(pending.styleId);
    const n = pv.changedSlots.length;
    const style = quoted(packName(target));
    const text = pv.delta === 0
      ? t('hud.consequenceSame', { style, n, items: itemsWord(n) })
      : t('hud.consequence', { style, n, items: itemsWord(n), delta: `${pv.delta > 0 ? '+' : '−'}${aed(Math.abs(pv.delta))}` });
    const go = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, t('hud.switch', { style }));
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, t('hud.cancel'));
    go.addEventListener('click', () => {
      const p = pending; pending = null;
      store.setStyle(p.styleId, { anchor: { slotId: cur.slotId, itemId: p.itemId } });
    });
    cancel.addEventListener('click', clearPending);
    confirm.replaceChildren(h('p', null, typo(text)), h('div', { class: 'hud-confirm-actions' }, cancel, go));
    confirm.hidden = false;
    el.classList.add('has-confirm');
    requestAnimationFrame(() => go.focus({ preventScroll: true }));
  }

  function setExpanded(on) {
    if (!isCompact()) return;
    el.classList.toggle('is-expanded', !!on);
    grip.setAttribute('aria-label', on ? t('close') : t('hud.inStyle'));
    setTimeout(() => onResize?.(api.insets()), 480);
  }

  // ---------- API ----------
  const api = {
    get isOpen() { return !!cur; },
    get current() { return cur; },
    /** Space the HUD covers over the stage, for the engine's framing. */
    insets() {
      if (!cur) return { right: 0, bottom: 0 };
      if (isCompact()) return { right: 0, bottom: Math.round(el.getBoundingClientRect().height) };
      return {
        right: Math.round(card.getBoundingClientRect().width + 32),
        bottom: Math.round(tray.getBoundingClientRect().height + 32),
      };
    },
    open(p, { focus = false, from = null } = {}) {
      if (!p || !(p.slotId || p.slotType)) return api.close();
      const same = cur && cur.slotId === p.slotId;
      const slotType = p.slotType || store.placed().find((x) => x.slotId === p.slotId)?.slotType;
      cur = { slotId: p.slotId, slotType, item: p.item };
      if (!same) pending = null;
      if (from) opener = from;
      else if (!same) opener = document.activeElement !== document.body ? document.activeElement : null;
      openerSel = opener?.dataset?.slot ? `.${opener.classList[0]}[data-slot="${CSS.escape(opener.dataset.slot)}"]` : null;
      openedAt = performance.now();
      render({ keepScroll: same });
      if (!same) el.classList.remove('is-expanded');
      el.classList.add('is-open');
      shell.classList.add('has-hud');
      document.documentElement.classList.add('hud-open');
      suppressOutside = true; setTimeout(() => (suppressOutside = false), 0);
      if (focus) requestAnimationFrame(() => (tray.querySelector('.tile.is-current') || tray.querySelector('.tile') || el).focus({ preventScroll: true }));
      onOpen?.(cur, { same });
    },
    close({ restoreFocus = true } = {}) {
      if (!cur) return;
      const was = cur;
      cur = null; pending = null;
      el.classList.remove('is-open', 'is-expanded', 'has-confirm');
      shell.classList.remove('has-hud');
      document.documentElement.classList.remove('hud-open');
      if (restoreFocus && (el.contains(document.activeElement) || document.activeElement === document.body)) {
        const back = opener?.isConnected ? opener : (openerSel && document.querySelector(openerSel));
        back?.focus({ preventScroll: true });
      }
      opener = null; openerSel = null;
      onClose?.(was);
    },
    refresh() { render({ keepScroll: true }); },
  };

  store.on('change', ({ slots, key }) => {
    if (!cur) return;
    const mine = slots ? slots.includes(cur.slotId) : store.keyOf?.(cur.slotId) === key;
    if (mine) render({ keepScroll: true });
  });
  store.on('style', () => { if (cur) { pending = null; render(); } });

  // QA-01: on touch, the browser's synthesized click lands ~after the tap that opened the HUD; if the
  // panel slid under the finger it would pick a tile. Swallow clicks within 400 ms of opening (event time).
  el.addEventListener('click', (e) => {
    if (e.timeStamp - openedAt < 400) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  // Click outside the stage and HUD closes it (stage clicks arrive as engine select events).
  document.addEventListener('pointerdown', (e) => {
    if (!cur || suppressOutside) return;
    const t0 = e.target;
    if (el.contains(t0) || stage.contains(t0) || t0.closest?.('[data-opens-sheet], .hovercard, .cartbar, .style-picker, .assistant-slot, dialog')) return;
    api.close({ restoreFocus: false });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !cur || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (pending) clearPending(); else api.close();
  });

  // Phones: drag the grip up for the large detent, down to collapse / dismiss.
  let drag = null;
  grip.addEventListener('pointerdown', (e) => { if (isCompact()) { drag = { y: e.clientY }; grip.setPointerCapture?.(e.pointerId); } });
  grip.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y; drag = null;
    if (Math.abs(dy) < 6) return;
    e.preventDefault();
    skipClick = true; setTimeout(() => (skipClick = false), 0);
    if (dy < -30) setExpanded(true);
    else if (el.classList.contains('is-expanded')) setExpanded(false);
    else if (dy > 60) api.close();
  });

  return api;
}
