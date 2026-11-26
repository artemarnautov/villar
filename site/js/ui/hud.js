// Focus HUD: what you get when you pick an object in the room. Owner: interface.
// One glass column. Desktop: pinned to the right edge of the stage (≤ ~28 % of its width), so the object the
// camera flew to stays in the free part on the left. Phones: the same column as a bottom sheet.
// Order: category / name / price / size · colour → «В этом стиле» → «Из других стилей» (grouped) → «Подробнее».
// Picking an item from another style previews the room-wide consequence and asks to confirm.
import { h, svg, fmtDelta, aed, isCompact, quoted, NBSP, typo } from './dom.js';
import { icon } from './icons.js';
import { t, L, itemsWord, optionsWord, isEn, onLang } from './i18n.js';
import { typeLabel, slotLabel } from './labels.js';
import { dims, dot, price, unitNote, shortNameOf, nameOf, colorHex, colorName, packName, materialsList, setNoteOf } from './format.js';

const OTHER_VISIBLE = 2; // desktop: tiles per other-style group before «Ещё N»

export function createHud({ el, shell, stage, store, palettes, thumbs, onOpen, onClose, onResize, onStyleSwitch }) {
  let cur = null;           // { slotId, slotType }
  let opener = null;
  let pending = null;       // { styleId, itemId } awaiting confirmation
  let suppressOutside = false;
  let openedAt = -Infinity; // event-time of the last open (QA-01: ghost clicks after a tap)
  let openerSel = null;     // re-find a re-rendered opener (budget line / plan item) by slot id
  let detailsOpen = false;  // «Подробнее» remembers its state between items
  const openGroups = new Set();
  let shownTotal = null, totalTimer = 0;

  el.classList.add('hud');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'hud-title');
  el.tabIndex = -1;
  el.inert = true;

  const grip = h('button', { class: 'hud-grip', type: 'button', tabindex: '-1' });
  const panel = h('div', { class: 'hud-panel glass-strong' });
  const confirm = h('div', { class: 'hud-confirm', role: 'alertdialog', 'aria-live': 'polite', hidden: true });
  el.replaceChildren(grip, panel);

  let skipClick = false;
  grip.addEventListener('click', () => { if (skipClick) { skipClick = false; return; } setExpanded(!el.classList.contains('is-expanded')); });

  const ref = () => cur.slotId || cur.slotType;

  // ---------- Pieces ----------
  function visual(item, cls) {
    const swatch = () => h('span', { class: 'tile-swatch', style: `--c:${colorHex(item)}` });
    if (!thumbs?.available?.()) return h('span', { class: `${cls} is-swatch`, 'aria-hidden': 'true' }, swatch());
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
      current ? h('span', { class: 'tile-check', 'aria-hidden': 'true', html: icon('check') }) : null,
      h('span', { class: 'tile-name' }, shortNameOf(item)),
      h('span', { class: 'tile-foot' },
        h('span', { class: 'tile-price' }, price(item, qty)),
        !current && delta != null ? h('span', { class: `tile-delta${delta < 0 ? ' is-down' : ''}` }, delta === 0 ? t('hud.same') : fmtDelta(delta)) : null));
    if (!current) b.addEventListener('click', () => { if (cur) onPick(); });
    return h('li', null, b);
  }

  /** Other packs' items for this slot, each item once (under the first style that offers it). */
  function otherGroups() {
    const seen = new Set(store.options(ref()).map((i) => i.id));
    return (store.otherStyleOptions?.(cur.slotId) || []).map((g) => {
      const items = g.items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
      return { ...g, items };
    }).filter((g) => g.items.length);
  }

  // ---------- Render ----------
  const totalLbl = h('span', { class: 'hud-total-lbl' });
  const totalVal = h('span', { class: 'num' });
  const totalDelta = h('span', { class: 'hud-total-delta', 'aria-hidden': 'true' });
  const totalEl = h('span', { class: 'hud-total' }, totalLbl, totalVal, totalDelta);

  function paintTotal(flash) {
    const next = store.total();
    totalLbl.textContent = t('hud.total');
    totalVal.textContent = aed(next);
    if (flash && shownTotal != null && next !== shownTotal) {
      totalDelta.textContent = fmtDelta(next - shownTotal);
      totalDelta.classList.toggle('is-down', next < shownTotal);
      totalDelta.classList.add('is-visible');
      clearTimeout(totalTimer);
      totalTimer = setTimeout(() => totalDelta.classList.remove('is-visible'), 2600);
    }
    shownTotal = next;
  }

  function renderHead(item, qty) {
    const dm = dims(item);
    const note = unitNote(item, qty);
    const meta = [dm ? h('span', { class: 'nw' }, dm.value) : null,
      (item.color || item.colorHex) ? h('span', { class: 'nw' }, dot(item), colorName(item) || '') : null].filter(Boolean)
      .flatMap((x, i) => (i ? [' · ', x] : [x]));
    paintTotal(false);
    const setNote = setNoteOf(item);
    return h('header', { class: 'hud-head' },
      h('div', { class: 'hud-type' }, qty > 1 ? `${typeLabel(cur.slotType)} · ${t('hud.pcs', { n: qty })}` : slotLabel(cur.slotId, cur.slotType)),
      h('h3', { class: 'hud-name', id: 'hud-title', title: nameOf(item) }, shortNameOf(item)),
      h('div', { class: 'hud-price-row' },
        h('div', { class: 'hud-price' }, h('span', { class: 'num' }, price(item, qty)), note ? h('small', null, note) : null),
        totalEl),
      meta.length ? h('div', { class: 'hud-meta' }, meta) : null,
      setNote ? h('p', { class: 'hud-setnote' }, typo(setNote)) : null);
  }

  function renderSame(item, qty) {
    const options = store.options(ref());
    const head = h('div', { class: 'hud-sec-head' },
      h('h4', { id: 'hud-same-title' }, t('hud.inStyle')),
      h('span', null, `${options.length}${NBSP}${optionsWord(options.length)}${qty > 1 ? ` · ${t('hud.setNote', { n: qty })}` : ''}`));
    if (options.length < 2) return h('section', { class: 'hud-sec hud-same' }, head, h('p', { class: 'hud-empty' }, typo(t('hud.only'))));
    return h('section', { class: 'hud-sec hud-same' }, head,
      h('ul', { class: 'tiles', role: 'list', 'aria-labelledby': 'hud-same-title' }, options.map((opt) => tile(opt, {
        qty, current: opt.id === item.id,
        delta: ((Number(opt.price) || 0) - (Number(item.price) || 0)) * qty,
        onPick: () => { pending = null; store.select(ref(), opt.id); },
      }))));
  }

  function renderOther(qty) {
    if (store.styles().length < 2) {
      return h('section', { class: 'hud-sec hud-other' },
        h('div', { class: 'hud-sec-head' }, h('h4', null, t('hud.otherStyles'))), h('p', { class: 'hud-empty' }, t('hud.otherSoon')));
    }
    const groups = otherGroups();
    if (!groups.length) return null; // every style offers the same things here — nothing to show
    return h('section', { class: 'hud-sec hud-other' },
      h('div', { class: 'hud-sec-head' }, h('h4', { id: 'hud-other-title' }, t('hud.otherStyles'))),
      groups.map((g) => {
        const sw = (palettes?.[g.style.id]?.swatches || []).slice().sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 3);
        const open = openGroups.has(g.style.id);
        const extra = g.items.length - OTHER_VISIBLE;
        const more = extra > 0 ? h('button', { type: 'button', class: 'hud-more-btn', 'aria-expanded': open ? 'true' : 'false' },
          open ? t('hud.less') : t('hud.more', { n: extra })) : null;
        const group = h('div', { class: `hud-group${open ? ' is-open' : ''}`, 'data-style': g.style.id },
          h('div', { class: 'hud-group-name' },
            h('span', { class: 'pdots', 'aria-hidden': 'true' }, sw.map((s) => h('i', { style: `--c:${s.hex}` }))),
            h('span', null, packName(g.style))),
          h('ul', { class: 'tiles', role: 'list', 'aria-label': packName(g.style) }, g.items.map((it) => tile(it, {
            qty, current: false, delta: null,
            pendingOn: pending && pending.styleId === g.style.id && pending.itemId === it.id,
            onPick: () => askStyle(g.style.id, it.id),
          }))),
          more);
        more?.addEventListener('click', () => {
          if (openGroups.has(g.style.id)) openGroups.delete(g.style.id); else openGroups.add(g.style.id);
          render({ keepScroll: true });
        });
        return group;
      }));
  }

  function renderDetails(item, qty) {
    // A set lists its full contents (the set note points here); other items keep the three main materials.
    const isSet = !!setNoteOf(item);
    const mats = isSet ? materialsList(item) : materialsList(item).slice(0, 3);
    const d = h('details', { class: 'hud-details' },
      h('summary', null, h('span', null, t('hud.details')), svg(icon('chevronDown'))),
      mats.length ? h('dl', { class: 'hud-specs' },
        h('div', null, h('dt', null, t(isSet ? 'hud.contents' : 'hud.materials')), h('dd', null, mats.map((m, i) => [i ? h('br') : null, m])))) : null,
      h('p', { class: 'hud-fact' }, svg(icon('sparkle')), h('span', null, typo(factFor(item, qty)))));
    d.open = detailsOpen;
    d.addEventListener('toggle', () => { detailsOpen = d.open; });
    return d;
  }

  function render({ keepScroll = false } = {}) {
    if (!cur) return;
    const item = store.selected(ref()) || cur.item;
    if (!item) return;
    const qty = store.qty(ref()) || 1;
    const scrolls = [...panel.querySelectorAll('.tiles')].map((u) => u.scrollLeft);
    const y = panel.scrollTop, yEl = el.scrollTop;
    // QA-04: re-rendering must not drop keyboard focus. Remember where it was and put it back.
    const active = document.activeElement;
    const hadFocus = el.contains(active) && active !== el;
    const focusedRow = active?.closest?.('.hud-same') ? 'same' : null;
    const focusedItem = active?.dataset?.item || null;
    const focusedGroup = active?.classList?.contains('hud-more-btn') ? active.closest('.hud-group')?.dataset.style : null;
    const focusedSummary = active?.tagName === 'SUMMARY';

    panel.replaceChildren(...[renderHead(item, qty), renderSame(item, qty), renderOther(qty), renderDetails(item, qty), confirm].filter(Boolean));
    renderConfirm();

    if (keepScroll) {
      [...panel.querySelectorAll('.tiles')].forEach((u, i) => { u.scrollLeft = scrolls[i] || 0; });
      panel.scrollTop = y; el.scrollTop = yEl;
    } else {
      panel.scrollTop = 0; el.scrollTop = 0;
      // Phones: centre the chosen tile in its horizontal row (never scroll the sheet itself).
      requestAnimationFrame(() => {
        const tileEl = panel.querySelector('.tile.is-current');
        const row = tileEl?.closest('.tiles');
        if (!row || row.scrollWidth <= row.clientWidth + 1) return;
        const tr = tileEl.getBoundingClientRect(), rr = row.getBoundingClientRect();
        row.scrollLeft = Math.max(0, row.scrollLeft + (tr.left - rr.left) - (rr.width - tr.width) / 2);
      });
    }
    if (hadFocus && !confirm.contains(active)) {
      const target = (focusedRow === 'same' && panel.querySelector('.hud-same .tile.is-current'))
        || (focusedItem && panel.querySelector(`.tile[data-item="${CSS.escape(focusedItem)}"]`))
        || (focusedGroup && panel.querySelector(`.hud-group[data-style="${CSS.escape(focusedGroup)}"] .hud-more-btn`))
        || (focusedSummary && panel.querySelector('.hud-details summary'))
        || panel.querySelector('.tile.is-current') || el;
      target.focus({ preventScroll: true });
    }
    requestAnimationFrame(() => onResize?.(api.insets()));
  }

  // ---------- Style consequence ----------
  function askStyle(styleId, itemId) {
    if (!cur) return;
    pending = { styleId, itemId };
    render({ keepScroll: true });
    requestAnimationFrame(() => {
      const go = confirm.querySelector('.btn-primary');
      go?.focus({ preventScroll: true });
    });
  }
  function clearPending() {
    if (!pending) return;
    const was = pending;
    pending = null;
    render({ keepScroll: true });
    panel.querySelector(`.hud-group[data-style="${CSS.escape(was.styleId)}"] .tile[data-item="${CSS.escape(was.itemId)}"]`)?.focus({ preventScroll: true });
  }
  function renderConfirm() {
    if (!pending || !cur) { confirm.hidden = true; el.classList.remove('has-confirm'); return; }
    const pv = store.previewStyle(pending.styleId, { slotId: cur.slotId, itemId: pending.itemId });
    if (!pv) { pending = null; confirm.hidden = true; return; }
    const target = store.style(pending.styleId);
    const n = pv.changedSlots.length;
    const style = quoted(packName(target));
    const one = isEn() ? n === 1 : (n % 10 === 1 && n % 100 !== 11);
    const verb = t(one ? 'hud.verb1' : 'hud.verbN');
    const total = aed(store.total() + pv.delta);
    const text = pv.delta === 0
      ? t('hud.consequenceSame', { style, n, verb, items: itemsWord(n), total })
      : t('hud.consequence', { style, n, verb, items: itemsWord(n), total, delta: fmtDelta(pv.delta) });
    const go = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, t('hud.switch', { style }));
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, t('hud.cancel'));
    go.addEventListener('click', () => {
      if (!cur || !pending) return;
      const p = pending; pending = null;
      const anchor = { slotId: cur.slotId, itemId: p.itemId };
      if (onStyleSwitch) onStyleSwitch(p.styleId, { anchor });
      else store.setStyle(p.styleId, { anchor });
    });
    cancel.addEventListener('click', clearPending);
    confirm.replaceChildren(h('p', null, typo(text)), h('div', { class: 'hud-confirm-actions' }, cancel, go));
    confirm.hidden = false;
    el.classList.add('has-confirm');
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
    /** Space the HUD covers over the stage (px from the stage's right / bottom edge), for the engine's framing. */
    insets() {
      if (!cur) return { right: 0, bottom: 0 };
      const st = stage.getBoundingClientRect();
      // Measure where the panel comes to rest, not where its slide-in animation is right now.
      const shift = (node) => { try { const m = new DOMMatrixReadOnly(getComputedStyle(node).transform); return { x: m.m41, y: m.m42 }; } catch { return { x: 0, y: 0 }; } };
      if (isCompact()) {
        const r = el.getBoundingClientRect();
        const top = r.top - shift(el).y;
        return { right: 0, bottom: Math.max(0, Math.min(st.height, Math.round(st.bottom - top))) };
      }
      const r = panel.getBoundingClientRect();
      const left = r.left - shift(panel).x;
      return { right: Math.max(0, Math.round(st.right - left + 16)), bottom: 0 };
    },
    open(p, { focus = false, from = null } = {}) {
      if (!p || !(p.slotId || p.slotType)) return api.close();
      const same = cur && cur.slotId === p.slotId;
      const slotType = p.slotType || store.placed().find((x) => x.slotId === p.slotId)?.slotType;
      cur = { slotId: p.slotId, slotType, item: p.item };
      if (!same) { pending = null; openGroups.clear(); thumbs?.hold?.(1100); } // T7: no thumbnails during the flight
      if (from) opener = from;
      else if (!same) opener = document.activeElement !== document.body ? document.activeElement : null;
      openerSel = opener?.dataset?.slot ? `.${opener.classList[0]}[data-slot="${CSS.escape(opener.dataset.slot)}"]` : null;
      openedAt = performance.now();
      el.inert = false;
      render({ keepScroll: same });
      if (!same) el.classList.remove('is-expanded');
      el.classList.add('is-open');
      shell.classList.add('has-hud');
      document.documentElement.classList.add('hud-open');
      suppressOutside = true; setTimeout(() => (suppressOutside = false), 0);
      if (focus) requestAnimationFrame(() => (panel.querySelector('.tile.is-current') || panel.querySelector('.tile') || el).focus({ preventScroll: true }));
      onOpen?.(cur, { same });
    },
    close({ restoreFocus = true } = {}) {
      if (!cur) return;
      const was = cur;
      cur = null; pending = null;
      el.classList.remove('is-open', 'is-expanded', 'has-confirm');
      el.inert = true; // PT-17: nothing in the fading panel can be clicked
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
    paintTotal(true);
    const mine = slots ? slots.includes(cur.slotId) : store.keyOf?.(cur.slotId) === key;
    if (mine) render({ keepScroll: true });
  });
  store.on('style', () => { if (cur) { pending = null; openGroups.clear(); render(); } });
  onLang(() => { if (cur) render({ keepScroll: true }); });

  // QA-01: on touch, the browser's synthesized click lands right after the tap that opened the HUD; if the
  // panel slid under the finger it would pick a tile. Swallow clicks within 400 ms of opening (event time).
  el.addEventListener('click', (e) => {
    if (e.timeStamp - openedAt < 400) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  // Click outside the stage and HUD closes it (stage clicks arrive as engine select events).
  document.addEventListener('pointerdown', (e) => {
    if (!cur || suppressOutside) return;
    const t0 = e.target;
    if (el.contains(t0) || stage.contains(t0) || t0.closest?.('[data-opens-sheet], .hovercard, .cartbar, .style-picker, .assistant-slot, .toast, dialog')) return;
    api.close({ restoreFocus: false });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !cur || document.querySelector('dialog[open]')) return;
    if (e.target?.closest?.('.assistant-slot')) return; // the assistant handles its own Esc
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
