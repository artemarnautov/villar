// Focus card: what you get when you pick an object in the room (docs/FOCUS.md §3–§5). Owner: interface.
// One surface, three verbs: look (the engine turns the item), change (one tap), move on (‹ ›, [ ], a swipe).
//
// Desktop: a glass column at the right edge of the stage; the engine frames the item in the free part on the left.
// Phone: the same card as a bottom sheet with two detents, peek (header + one row) and full (every row); a detent
// change re-frames the camera in the same motion, and a swipe down leaves focus.
// Rows, in order, each hidden when it has nothing to show:
//   header (name, price, size, pin, ‹ ›) → «Цвет и материал» (real variants of this model) → «Другие модели» (this
//   style, by price) → «Из других стилей» (swaps only this item, then a «Подстроить комнату» chip) → details → foot
//   («Убрать из комнаты», «Вернуть» for 10 s, ✕). The room total animates on every change.
// Every change is one tap with Undo, never a confirmation. All motion is on the spring family in motion.js.
// Three-choice rule (docs/ART.md §4): a row shows the designer's pick first plus at most two alternates; the rest
// waits behind «Все варианты». Wall art gets the «Искусство» row: the artwork itself, large (ART §5).
import { h, svg, fmtDelta, aed, isCompact, quoted, NBSP, typo, reducedMotion } from './dom.js';
import { icon } from './icons.js';
import { t, L, itemsWord, isEn, onLang } from './i18n.js';
import { typeLabel, slotLabel } from './labels.js';
import { dims, dot, price, unitNote, shortNameOf, nameOf, colorHex, colorName, packName, materialsList, setNoteOf } from './format.js';
import { createSpring, CARD_DELAY_MS } from './motion.js';
import { createWalk } from './walk.js';
import { mediaUrl } from './config.js';

const UNDO_MS = 10000;        // «Вернуть» stays this long after the last change (FOCUS §3)
const UNDO_DEPTH = 12;
const PEEK_SHARE = [0.26, 0.42];   // phone peek detent: header + one row, clamped to this share of the viewport
const FULL_SHARE = 0.7;            // phone full detent
const SWIPE_PX = 44;               // header swipe that walks to the next item
const CLOSE_GAP = 24;              // px below the screen when the sheet is away

const editable = (n) => !!n?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
const cap = (s) => String(s || '').replace(/^\p{Ll}/u, (c) => c.toUpperCase());

export function createHud({ el, shell, stage, scene = null, store, palettes, thumbs, spec = null, announce = () => {}, editions = true, level = () => null, onOpen, onClose, onResize, onStyleSwitch }) {
  let cur = null;           // { slotId, slotType, item }
  let opener = null, openerSel = null;
  let openedAt = -Infinity; // event-time of the last open (QA-01: ghost clicks after a tap)
  let suppressOutside = false;
  let detailsOpen = false;
  let walk = null;          // walk order, fixed at focus entry (FOCUS §4)
  let suggest = null;       // { styleId, slotId, itemId, applied } after a pick from another style
  let undoStack = [];       // [{ snap, what }]
  let undoUntil = 0, undoTimer = 0;
  let mine = 0;             // >0 while the card itself writes to the store
  let expectStyle = null;   // a style switch the card asked for (it arrives a frame later)
  let removing = false;
  let adopting = false;     // the 'change' burst of a style switch the card asked for (or undid)
  let detent = 'peek';      // phone: 'peek' | 'full'
  let lastView = null;
  const expanded = new Set(); // rows opened with «Все варианты» (per item)

  el.classList.add('hud');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'hud-title');
  el.tabIndex = -1;
  el.inert = true;

  const grip = h('button', { class: 'hud-grip', type: 'button', 'aria-expanded': 'false' });
  const panel = h('div', { class: 'hud-panel glass-strong' });
  const content = h('div', { class: 'hud-content' });
  const foot = h('div', { class: 'hud-foot' });
  panel.append(content, foot);
  el.replaceChildren(grip, panel);

  const ref = () => cur.slotId || cur.slotType;
  const keyNow = () => store.keyOf(ref());
  const styleOf = (id) => store.style(id);
  const writing = (fn) => { mine++; try { return fn(); } finally { mine--; } };

  // ---------------------------------------------------------------- motion
  // Desktop: the card rides the camera's spring, CARD_DELAY_MS behind it. Phone: the sheet's y.
  const presence = createSpring({
    preset: 'card', precision: 0.002,
    onUpdate: (p) => {
      if (isCompact()) return;
      panel.style.opacity = String(Math.max(0, Math.min(1, p)));
      panel.style.transform = `translate3d(${((1 - p) * 28).toFixed(2)}px,0,0)`;
    },
    onRest: (p) => { if (p <= 0.001 && !cur) { panel.style.visibility = 'hidden'; } },
  });
  let sheetH = 0, peekH = 0;
  const sheetY = createSpring({
    preset: 'sheet', precision: 0.5,
    onUpdate: (y) => { if (isCompact()) el.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`; },
    onRest: () => { if (!cur && isCompact()) el.style.visibility = 'hidden'; },
  });
  let presenceTimer = 0;
  let sheetShown = false;   // the sheet is on its way up or up (renders may re-place it)

  function measureSheet() {
    sheetH = Math.round(Math.min(window.innerHeight * FULL_SHARE, 680));
    el.style.height = `${sheetH}px`;
    const head = content.querySelector('.hud-head');
    const row = content.querySelector('.hud-row');
    const gripH = grip.offsetHeight || 22;
    const want = gripH + (head?.offsetHeight || 120) + (row ? row.offsetHeight + 6 : 0) + 6;
    const vh = window.innerHeight;
    peekH = Math.round(Math.max(vh * PEEK_SHARE[0], Math.min(vh * PEEK_SHARE[1], want, sheetH)));
  }
  const yFor = (d) => (d === 'full' ? 0 : Math.max(0, sheetH - peekH));
  function setDetent(d, { velocity } = {}) {
    detent = d;
    el.classList.toggle('is-full', d === 'full');
    el.classList.toggle('is-peek', d !== 'full');
    grip.setAttribute('aria-expanded', d === 'full' ? 'true' : 'false');
    grip.setAttribute('aria-label', t(d === 'full' ? 'hud.collapse' : 'hud.expand'));
    if (d !== 'full') panel.scrollTop = 0;
    sheetY.set(yFor(d), { velocity });
    // the camera re-frames toward the target detent now, in the same motion as the sheet
    onResize?.(api.insets());
  }

  // ---------------------------------------------------------------- thumbnails (visible tiles first)
  const seen = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen.unobserve(e.target);
        thumbs?.bump?.(e.target.dataset.thumb);
      }
    }, { threshold: 0.01 })
    : null;
  function visual(item, cls) {
    const swatch = () => h('span', { class: 'tile-swatch', style: `--c:${colorHex(item)}` });
    if (!thumbs?.available?.()) return h('span', { class: `${cls} is-swatch`, 'aria-hidden': 'true' }, swatch());
    const box = h('span', { class: `${cls} is-thumb is-loading`, 'aria-hidden': 'true', 'data-thumb': item.id }, swatch());
    const fallback = () => { box.classList.remove('is-loading'); box.classList.add('is-swatch'); };
    Promise.resolve(thumbs.get(item.id)).then((url) => {
      if (!box.isConnected) return;
      if (!url) { fallback(); return; }
      const img = h('img', { src: url, alt: '', decoding: 'async', draggable: 'false' });
      img.addEventListener('load', () => box.classList.remove('is-loading'), { once: true });
      img.addEventListener('error', () => { box.replaceChildren(swatch()); fallback(); }, { once: true });
      box.replaceChildren(img);
    }).catch(fallback);
    seen?.observe(box);
    return box;
  }

  // ---------------------------------------------------------------- what the rows offer
  const layoutSlot = (id) => store.state.layout.slots.find((s) => s.id === id);
  /** This slot's selection key inside another pack (store.js keyOfSlotIn). */
  function keyInPack(p, slotId) {
    const s = layoutSlot(slotId); const ps = p?.slots || {};
    if (!s) return slotId;
    return (ps[s.id] && s.id) || (s.group && ps[s.group] && s.group) || s.type;
  }
  const modelWord = (it) => String(it?.family || '').split(':')[1]?.replace(/-(arch|round|oval|square)$/, '') || '';

  /** Real catalogue variants of the current item's model that this slot accepts (own options + guests). */
  function variants(item) {
    if (!item?.family) return [];
    const pool = new Map();
    for (const o of store.options(ref())) pool.set(o.id, o);
    for (const g of store.otherStyleOptions?.(cur.slotId) || []) for (const o of g.items) if (!pool.has(o.id)) pool.set(o.id, o);
    pool.set(item.id, item);
    const out = [...pool.values()].filter((o) => o.family === item.family);
    return out.length > 1 ? out.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0)) : [];
  }
  /** Short labels that say what differs: «Натуральная кожа» / «Ткань»; a colour name when the name can't. */
  function variantLabels(members) {
    const segs = members.map((it) => {
      let n = shortNameOf(it);
      const m = modelWord(it);
      const at = m ? n.toLowerCase().indexOf(m) : -1;
      if (at >= 0) n = n.slice(at + m.length);
      return n.split(/\s*[,:;·]\s*|\s+[—–]\s+/).map((s) => s.replace(/^[\s+–—-]+|[\s+–—-]+$/g, '').trim()).filter(Boolean);
    });
    const low = (s) => s.toLowerCase();
    const common = (segs[0] || []).filter((s) => segs.every((a) => a.some((b) => low(b) === low(s))));
    return members.map((it, i) => {
      const rest = segs[i].filter((s) => !common.some((c) => low(c) === low(s)));
      let label = rest.join(', ');
      if (!label || /(^|\s)\p{Lu}\p{Ll}/u.test(label)) label = colorName(it) || label; // «Bianca» says nothing; «Бежевый» does
      return cap(label);
    });
  }
  // ---- three-choice rule (ART §4): stylepack `picks: { key: [signature, alt1, alt2] }`, `avoid: [[a, b], …]` ----
  const isArt = () => cur?.slotType === 'wall_art';
  const editionsOn = (list) => (editions ? list : list.filter((o) => !o.edition));
  /** The designer's picks for this slot (signature first), when the pack has them. */
  function picksFor() {
    const p = store.style();
    const list = p?.picks?.[keyNow()];
    return Array.isArray(list) ? list.filter((id) => store.item(id)) : null;
  }
  /** Would this piece clash with something already in the room (a pack `avoid` pair)? Shown last, no warning. */
  function clashes(itemId) {
    const pairs = store.style()?.avoid;
    if (!Array.isArray(pairs) || !pairs.length) return false;
    const room = new Set(store.placed().filter((p) => store.keyOf(p.slotId) !== keyNow()).map((p) => p.item.id));
    return pairs.some((pr) => Array.isArray(pr) && ((pr[0] === itemId && room.has(pr[1])) || (pr[1] === itemId && room.has(pr[0]))));
  }
  /** Higher budget levels lead with Villar Editions; lower ones with the simpler pieces (ART §5). */
  const editionsFirst = () => {
    const id = level();
    if (id) return id === 'magazine' || id === 'no-compromise';
    const curated = store.previewStyle?.(store.styleId(), null, { fresh: true })?.total;
    return !!curated && store.total() >= curated * 0.98;
  };
  /**
   * Order a row's choices: the designer's pick, two alternates (the pack's picks, else by price), then the rest
   * (by price, clashing pairs last). The current piece always stays in view. → { head, rest, sig }
   */
  function curate(list, item) {
    const famOf = (id) => store.item(id)?.family;
    const find = (id) => list.find((x) => x.id === id) || (famOf(id) ? list.find((x) => x.family && x.family === famOf(id)) : null);
    const art = isArt(), edFirst = art && editionsFirst();
    const rank = (x) => (clashes(x.id) ? 2 : 0) + (art && !!x.edition !== edFirst ? 1 : 0);
    const sorted = list.slice().sort((a, b) => rank(a) - rank(b) || (Number(a.price) || 0) - (Number(b.price) || 0));
    const picks = picksFor();
    const sigItem = (picks?.length && find(picks[0])) || find(store.defaultOf?.(ref())?.id) || sorted[0];
    const head = [sigItem];
    const alts = picks?.length > 1 ? picks.slice(1).map(find).filter((x) => x && !clashes(x.id)) : [];
    for (const x of [...alts, ...sorted]) { if (head.length >= 3) break; if (x && !head.includes(x) && !clashes(x.id)) head.push(x); }
    if (item && !head.some((x) => x.id === item.id)) { const c = list.find((x) => x.id === item.id); if (c) head.push(c); }
    const rest = sorted.filter((x) => !head.includes(x));
    return { head: head.filter(Boolean), rest, sig: sigItem?.id || null };
  }
  /** «Все варианты · N»: opens the row in place. */
  function moreBtn(kind, n) {
    const b = h('button', { type: 'button', class: 'tile tile-more', tabindex: '-1', 'aria-expanded': 'false', 'aria-label': `${t('hud.all')}, ${n}` },
      h('span', { class: 'tile-more-n', 'aria-hidden': 'true' }, `+${n}`), h('span', { class: 'tile-name' }, t('hud.all')));
    b.addEventListener('click', () => {
      if (!cur || dragged()) return;
      expanded.add(kind);
      render({ keepScroll: true });
      const strip = content.querySelector(`.hud-row[data-row="${kind}"] .hud-strip`);
      const first = strip?.querySelector('.is-revealed');
      if (first) { syncRoving(first); first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
    });
    return b;
  }
  function curatedTiles(kind, list, item, make) {
    const { head, rest, sig } = curate(list, item);
    const open = expanded.has(kind) || rest.length <= 1;   // one more is shown, not hidden behind a button
    const kids = head.map((o) => make(o, { sig: o.id === sig }));
    if (open) kids.push(...rest.map((o) => { const b = make(o, { sig: false }); b.classList.add('is-revealed'); return b; }));
    else if (rest.length) kids.push(moreBtn(kind, rest.length));
    return kids;
  }

  /** «Другие модели»: this style's options, one tile per model (the current variant stands for its model). */
  function models(item) {
    const opts = store.options(ref());
    const byFam = new Map();
    const def = store.defaultOf?.(ref())?.id;
    for (const o of opts) {
      const k = o.family || o.id;
      const have = byFam.get(k);
      if (!have) { byFam.set(k, o); continue; }
      if (o.id === item.id || (have.id !== item.id && o.id === def)) byFam.set(k, o);
    }
    const out = editionsOn([...byFam.values()]);
    return out.length > 1 || (out.length === 1 && out[0].id !== item.id) ? out : [];
  }
  /** «Из других стилей»: what each other style puts here (its designer pick), plus pieces only it offers. */
  function fromStyles(item) {
    const own = new Set(store.options(ref()).map((o) => o.id));
    const isGuest = !own.has(item.id);
    const seenIds = new Set(isGuest ? [] : [item.id]);
    const out = [];
    const others = store.styles().filter((p) => p.id !== store.styleId());
    const cfgOf = (p) => p.slots?.[keyInPack(p, cur.slotId)];
    const usable = (id) => { const it = store.item(id); return !!it && !seenIds.has(id) && !(item.family && it.family === item.family && id !== item.id); };
    const add = (p, id) => {
      if (!usable(id)) return false;
      seenIds.add(id);
      out.push({ item: store.item(id), style: p });
      return true;
    };
    // first every style's own pick for this slot: its signature, or its next pick when the signature is already
    // here (the same rug in both styles); then what only it offers
    for (const p of others) {
      const c = cfgOf(p); if (!c) continue;
      const picks = p.picks?.[keyInPack(p, cur.slotId)];
      const order = [...(Array.isArray(picks) ? picks : []), c.default];
      order.find((id) => add(p, id));
    }
    for (const p of others) for (const id of cfgOf(p)?.options || []) if (!own.has(id)) add(p, id);
    return out.slice(0, 12);
  }

  // ---------------------------------------------------------------- removal (FOCUS §3 foot)
  /** Keys that leave with this one: its group partners and everything that requires them (BUDGET.md deps). */
  function removalSet(key) {
    const req = spec?.requires || {};
    const out = new Set([key]); const q = [key];
    while (q.length) {
      const k = q.pop();
      for (const g of spec?.groups || []) if (g.includes(k)) for (const g2 of g) if (!out.has(g2)) { out.add(g2); q.push(g2); }
      for (const [k2, deps] of Object.entries(req)) if (deps.includes(k) && !out.has(k2)) { out.add(k2); q.push(k2); }
    }
    return [...out].filter((k) => store.included(k) && (store.slotsFor?.(k) || []).length);
  }
  /** Only pieces a room can do without (tier ≥ 1 in the budget ladder, with everything that leaves with them). */
  function removable() {
    const tiers = spec?.tiers;
    if (!tiers) return null;
    const set = removalSet(keyNow());
    if (!set.length || set.some((k) => !(tiers[k] > 0))) return null;
    return set;
  }

  // ---------------------------------------------------------------- undo
  function pushUndo(what) {
    undoStack.push({ snap: store.snapshot(), what });
    if (undoStack.length > UNDO_DEPTH) undoStack.shift();
    armUndo();
  }
  function armUndo() {
    undoUntil = performance.now() + UNDO_MS;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { undoUntil = 0; paintFoot(); paintHeadUndo(); }, UNDO_MS + 20);
    paintFoot(); paintHeadUndo();
  }
  const canUndo = () => undoStack.length > 0 && performance.now() < undoUntil;
  function clearUndo() {
    if (!undoStack.length && !undoUntil) return;
    undoStack = []; undoUntil = 0; clearTimeout(undoTimer);
    paintFoot(); paintHeadUndo();
  }
  function undo() {
    const last = undoStack.pop();
    if (!last) return false;
    suggest = null;
    writing(() => store.restore(last.snap));
    if (undoStack.length) armUndo(); else { undoUntil = 0; clearTimeout(undoTimer); }
    render({ keepScroll: true });
    announce(t('hud.undone', { total: aed(store.total()) }));
    return true;
  }

  // ---------------------------------------------------------------- actions
  function pick(itemId, { from = null } = {}) {
    if (!cur) return;
    const before = store.selected(ref());
    if (before?.id === itemId) return;
    pushUndo(before ? nameOf(before) : '');
    suggest = from && from !== store.styleId() ? { styleId: from, slotId: cur.slotId, itemId, applied: false } : null;
    const ok = writing(() => store.select(ref(), itemId));
    if (!ok) { undoStack.pop(); suggest = null; return; }
    const it = store.item(itemId);
    announce(t('hud.swapped', { name: nameOf(it), price: price(it, store.qty(ref()) || 1), total: aed(store.total()) }));
  }
  function adaptRoom() {
    if (!cur || !suggest || suggest.applied) return;
    const s = suggest;
    pushUndo(packName(store.style()));
    expectStyle = s.styleId;
    const anchor = { slotId: s.slotId, itemId: s.itemId };
    if (onStyleSwitch) onStyleSwitch(s.styleId, { anchor, quiet: true });
    else writing(() => store.setStyle(s.styleId, { anchor }));
  }
  function remove() {
    if (!cur) return;
    const set = removable();
    if (!set) return;
    const item = store.selected(ref());
    const key = keyNow();
    pushUndo(item ? nameOf(item) : '');
    suggest = null;
    removing = true;
    try {
      writing(() => {
        const others = Object.fromEntries(set.filter((k) => k !== key).map((k) => [k, null]));
        if (Object.keys(others).length) store.applyPlan(others, { reason: 'user' });
        store.select(key, null, { reason: 'user' });   // pinned empty: the budget slider keeps it out
      });
    } finally { removing = false; }
    announce(t('hud.removed', { name: item ? shortNameOf(item) : typeLabel(cur.slotType), total: aed(store.total()) }));
    // the card moves on (past whatever left with it), so «Вернуть» stays in reach for its 10 s
    const next = walk?.step(cur.slotId, 1) || null;
    const p = next && store.placed().find((x) => x.slotId === next);
    if (p) api.open(p, { dir: 1, keepFocus: true }); else api.close();
  }
  function walkTo(dir) {
    if (!cur) return false;
    const eng = scene?.focusNext?.(dir);
    const nextId = typeof eng === 'string' ? eng : walk?.step(cur.slotId, dir);
    if (!nextId || nextId === cur.slotId) return false;
    const p = store.placed().find((x) => x.slotId === nextId);
    if (!p) return false;
    api.open(p, { dir, keepFocus: true, engineFlies: typeof eng === 'string' });
    const pos = walk?.position(nextId);
    announce(t('hud.walked', { type: slotLabel(p.slotId, p.slotType), name: shortNameOf(p.item), pos: pos?.n ? t('hud.pos', pos) : '' }));
    return true;
  }

  // ---------------------------------------------------------------- pieces
  /** Art is hung, so its size is width × height («120 × 80 см»), never the canvas depth. */
  function artSize(item) {
    const d = item?.dims; const w = Number(d?.w), hh = Number(d?.h);
    if (!(w > 0 && hh > 0)) return dims(item)?.value || '';
    return `${w}${NBSP}×${NBSP}${hh}${NBSP}${t('unit.cm')}`;
  }
  function tile(item, { qty, current, delta, onPick, style = null, sig = false, art = false }) {
    const sw = style ? (palettes?.[style.id]?.swatches || []).slice().sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 3) : [];
    const styleName = style ? packName(style) : '';
    const b = h('button', {
      type: 'button', class: `tile${current ? ' is-current' : ''}`, 'data-item': item.id, tabindex: '-1', title: nameOf(item),
      'aria-pressed': current ? 'true' : 'false',
      'aria-label': `${nameOf(item)}${sig ? `, ${t('hud.pick')}` : ''}${art ? `, ${artSize(item)}` : ''}${styleName ? `, ${t('guest.from', { style: quoted(styleName) })}` : ''}, ${price(item, qty)}${current ? `, ${t('hud.selected')}` : delta != null ? `, ${delta === 0 ? t('hud.same') : fmtDelta(delta)}` : ''}`,
    },
      style ? h('span', { class: 'tile-style', 'aria-hidden': 'true' },
        h('span', { class: 'pdots' }, sw.map((s) => h('i', { style: `--c:${s.hex}` }))), h('span', null, styleName)) : null,
      sig ? h('span', { class: 'tile-pick', 'aria-hidden': 'true' }, t('hud.pick')) : null,
      art ? artVisual(item) : visual(item, 'tile-vis'),
      art && item.edition ? h('span', { class: 'tile-edition', 'aria-hidden': 'true' }, t('hud.edition')) : null,
      current ? h('span', { class: 'tile-check', 'aria-hidden': 'true', html: icon('check') }) : null,
      h('span', { class: 'tile-name' }, shortNameOf(item)),
      art ? h('span', { class: 'tile-size' }, artSize(item)) : null,
      // the price difference is what a tile says (FOCUS §3); the current tile says its price
      h('span', { class: 'tile-foot' },
        current || delta == null
          ? h('span', { class: 'tile-price' }, price(item, qty))
          : h('span', { class: `tile-delta${delta < 0 ? ' is-down' : ''}` }, delta === 0 ? t('hud.same') : fmtDelta(delta))));
    b.addEventListener('click', () => { if (cur && !current && !dragged()) onPick(); });
    if (art) b.classList.add('is-art');
    return b;
  }
  /** The artwork itself (Villar Editions image from Storage); the engine's render when there is none or it fails. */
  function artVisual(item) {
    const url = mediaUrl(item.image);
    if (!url) return visual(item, 'tile-vis art-vis');
    const box = h('span', { class: 'tile-vis art-vis is-thumb is-loading', 'aria-hidden': 'true' });
    const img = h('img', { src: url, alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
    img.addEventListener('load', () => box.classList.remove('is-loading'), { once: true });
    img.addEventListener('error', () => { if (box.isConnected) box.replaceWith(visual(item, 'tile-vis art-vis')); }, { once: true });
    box.append(img);
    return box;
  }

  function row(kind, title, kids) {
    const id = `hud-row-${kind}`;
    const strip = h('div', { class: `hud-strip${kind === 'variants' ? ' is-chips' : ' tiles'}${kind === 'art' ? ' is-art' : ''}`, role: 'toolbar', 'aria-labelledby': id, 'aria-orientation': 'horizontal' }, kids);
    // one tab stop per row (roving): the current item, else the first
    const first = strip.querySelector('[aria-pressed="true"]') || strip.firstElementChild;
    if (first) first.tabIndex = 0;
    return h('section', { class: `hud-row hud-${kind}`, 'data-row': kind },
      h('div', { class: 'hud-row-head' }, h('h4', { id }, title)), strip);
  }

  function renderVariants(item, qty) {
    const vs = variants(item);
    if (!vs.length) return null;
    const labels = variantLabels(vs);
    const kids = vs.map((v, i) => {
      const current = v.id === item.id;
      const delta = ((Number(v.price) || 0) - (Number(item.price) || 0)) * qty;
      const gs = store.guestStyle?.(ref(), v.id);
      // a variant only another style offers says so (coordinator: every guest is marked)
      const from = gs ? t('guest.from', { style: quoted(packName(styleOf(gs))) }) : '';
      const sub = current ? price(v, qty) : delta ? fmtDelta(delta) : t('hud.same');
      const b = h('button', {
        type: 'button', class: `var${current ? ' is-current' : ''}`, 'data-item': v.id, tabindex: '-1', 'aria-pressed': current ? 'true' : 'false',
        'aria-label': `${labels[i]}, ${colorName(v)}${from ? `, ${from}` : ''}, ${price(v, qty)}${current ? `, ${t('hud.selected')}` : delta ? `, ${fmtDelta(delta)}` : ''}`,
        title: from ? `${nameOf(v)} · ${from}` : nameOf(v),
      },
        h('span', { class: 'var-sw', style: `--c:${colorHex(v)}`, 'aria-hidden': 'true' }, current ? h('span', { class: 'var-check', html: icon('check') }) : null),
        h('span', { class: 'var-txt', 'aria-hidden': 'true' },
          h('span', { class: 'var-name' }, labels[i]),
          h('span', { class: 'var-sub' }, from ? `${sub} · ${from}` : sub)));
      b.addEventListener('click', () => { if (cur && !current && !dragged()) pick(v.id, { from: gs }); });
      return b;
    });
    return row('variants', t('hud.variants'), kids);
  }
  function renderModels(item, qty) {
    const list = models(item);
    if (!list.length) return null;
    const art = isArt();
    const kind = art ? 'art' : 'models';
    return row(kind, t(art ? 'hud.art' : 'hud.models'), curatedTiles(kind, list, item, (o, { sig }) => tile(o, {
      qty, sig, art, current: o.id === item.id, delta: ((Number(o.price) || 0) - (Number(item.price) || 0)) * qty,
      onPick: () => pick(o.id),
    })));
  }
  function renderStyles(item, qty) {
    if (store.styles().length < 2) return null;
    const list = fromStyles(item).filter((x) => editions || !x.item.edition);
    if (!list.length) return null;
    // each other style's own pick leads (three styles = three choices); their other pieces wait behind «Все варианты»
    const make = ({ item: o, style }) => tile(o, {
      qty, style, art: isArt(), current: o.id === item.id, delta: ((Number(o.price) || 0) - (Number(item.price) || 0)) * qty,
      onPick: () => pick(o.id, { from: style.id }),
    });
    let head = list.slice(0, 3), rest = list.slice(3);
    const curAt = rest.findIndex((x) => x.item.id === item.id);
    if (curAt >= 0) { head = [...head, rest[curAt]]; rest = rest.filter((_, i) => i !== curAt); }
    const open = expanded.has('styles') || rest.length <= 1;
    const kids = head.map(make);
    if (open) kids.push(...rest.map((x) => { const b = make(x); b.classList.add('is-revealed'); return b; }));
    else if (rest.length) kids.push(moreBtn('styles', rest.length));
    return row('styles', t('hud.otherStyles'), kids);
  }
  function renderSuggest() {
    if (!suggest || suggest.slotId !== cur.slotId) return null;
    const target = styleOf(suggest.styleId);
    if (!target) return null;
    const style = quoted(packName(target));
    if (suggest.applied) {
      const back = h('button', { type: 'button', class: 'hud-suggest-undo' }, svg(icon('reset')), t('hud.undo'));
      back.addEventListener('click', () => undo());
      return h('div', { class: 'hud-suggest is-applied', role: 'status' },
        h('span', { class: 'hud-suggest-txt' }, h('span', { class: 'hud-suggest-main' }, t('hud.adapted', { style }))), canUndo() ? back : null);
    }
    if (store.selected(ref())?.id !== suggest.itemId || suggest.styleId === store.styleId()) return null;
    const pv = store.previewStyle?.(suggest.styleId, { slotId: suggest.slotId, itemId: suggest.itemId });
    if (!pv) return null;
    const n = pv.changedSlots.filter((id) => id !== suggest.slotId).length;
    const one = isEn() ? n === 1 : (n % 10 === 1 && n % 100 !== 11);
    const verb = t(one ? 'hud.verb1' : 'hud.verbN');
    const v = isEn() ? verb : cap(verb);   // RU leads with the verb («Поменяются 12 предметов»), EN ends with it
    const note = pv.delta === 0
      ? t('hud.adaptSame', { verb: v, n, items: itemsWord(n) })
      : t('hud.adaptNote', { verb: v, n, items: itemsWord(n), delta: fmtDelta(pv.delta) });
    const sw = (palettes?.[target.id]?.swatches || []).slice().sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 3);
    const b = h('button', { type: 'button', class: 'hud-suggest-btn' },
      h('span', { class: 'pdots', 'aria-hidden': 'true' }, sw.map((s) => h('i', { style: `--c:${s.hex}` }))),
      h('span', { class: 'hud-suggest-txt' },
        h('span', { class: 'hud-suggest-main' }, t('hud.adapt', { style })),
        h('span', { class: 'hud-suggest-note' }, note)),
      svg(icon('chevronRight')));
    b.addEventListener('click', adaptRoom);
    return h('div', { class: 'hud-suggest' }, b);
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
  function renderDetails(item, qty) {
    const isSet = !!setNoteOf(item);
    const mats = isSet ? materialsList(item) : materialsList(item).slice(0, 3);
    const d = h('details', { class: 'hud-details' },
      h('summary', null, h('span', null, t('hud.details')), svg(icon('chevronDown'))),
      mats.length ? h('dl', { class: 'hud-specs' },
        h('div', null, h('dt', null, t(isSet ? 'hud.contents' : 'hud.materials')), h('dd', null, mats.map((m, i) => [i ? h('br') : null, m])))) : null,
      h('p', { class: 'hud-fact' }, svg(icon('sparkle')), h('span', null, typo(factFor(item, qty)))));
    d.open = detailsOpen;
    d.addEventListener('toggle', () => { detailsOpen = d.open; if (isCompact()) requestAnimationFrame(() => onResize?.(api.insets())); });
    return d;
  }

  // ---- header ----
  const totalLbl = h('span', { class: 'hud-total-lbl' });
  const totalVal = h('span', { class: 'num' });
  const totalDelta = h('span', { class: 'hud-total-delta', 'aria-hidden': 'true' });
  const totalEl = h('span', { class: 'hud-total' }, totalLbl, totalVal, totalDelta);
  let shownTotal = null, deltaTimer = 0;
  const totalSpring = createSpring({ preset: 'number', precision: 0.5, onUpdate: (x) => { totalVal.textContent = aed(x); } });
  function paintTotal(animate) {
    const next = store.total();
    totalLbl.textContent = t('hud.total');
    if (!animate || shownTotal == null || reducedMotion()) { totalSpring.jump(next); }
    else if (next !== totalSpring.target) {
      totalSpring.tune({ precision: Math.max(0.5, Math.abs(next - totalSpring.value) * 0.002) });
      totalSpring.set(next);
      totalDelta.textContent = fmtDelta(next - shownTotal);
      totalDelta.classList.toggle('is-down', next < shownTotal);
      totalDelta.classList.add('is-visible');
      clearTimeout(deltaTimer);
      deltaTimer = setTimeout(() => totalDelta.classList.remove('is-visible'), 2600);
    }
    shownTotal = next;
  }
  const headUndo = h('button', { type: 'button', class: 'hud-undo-mini', hidden: true }, svg(icon('reset')), h('span', null));
  headUndo.addEventListener('click', () => undo());
  function paintHeadUndo() {
    const on = !!cur && canUndo();
    headUndo.hidden = !on;
    headUndo.lastChild.textContent = t('hud.undo');
    headUndo.setAttribute('aria-label', on ? t('hud.undoAria', { what: undoStack.at(-1)?.what || '' }) : t('hud.undo'));
  }

  const navBtn = (act) => {
    const b = h('button', { type: 'button', class: 'hud-navbtn', 'data-act': act, 'aria-label': t(act === 'prev' ? 'hud.prev' : 'hud.next'), 'aria-keyshortcuts': act === 'prev' ? '[' : ']' },
      svg(icon(act === 'prev' ? 'chevronLeft' : 'chevronRight')));
    b.addEventListener('click', () => { if (!headDragged) walkTo(act === 'prev' ? -1 : 1); });
    return b;
  };
  const xBtn = (cls) => {
    const b = h('button', { type: 'button', class: `hud-x ${cls}`, 'aria-label': t('hud.closeCard'), 'data-act': 'close' }, svg(icon('close')));
    b.addEventListener('click', () => api.close());
    return b;
  };

  function renderHead(item, qty) {
    const dm = dims(item);
    const note = unitNote(item, qty);
    const meta = [dm ? h('span', { class: 'nw' }, dm.value) : null,
      (item.color || item.colorHex) ? h('span', { class: 'nw' }, dot(item), colorName(item) || '') : null].filter(Boolean)
      .flatMap((x, i) => (i ? [' · ', x] : [x]));
    totalLbl.textContent = t('hud.total');
    const setNote = setNoteOf(item);
    const gs = store.guestStyle?.(ref());
    const pos = walk?.position(cur.slotId);
    return h('header', { class: 'hud-head' },
      h('div', { class: 'hud-topline' },
        h('div', { class: 'hud-type' }, qty > 1 ? `${typeLabel(cur.slotType)} · ${t('hud.pcs', { n: qty })}` : slotLabel(cur.slotId, cur.slotType)),
        h('div', { class: 'hud-nav' },
          navBtn('prev'),
          pos?.n > 1 ? h('span', { class: 'hud-pos', 'aria-hidden': 'true' }, t('hud.pos', pos)) : null,
          navBtn('next'),
          xBtn('is-head'))),
      h('h3', { class: 'hud-name', id: 'hud-title', title: nameOf(item) }, shortNameOf(item)),
      gs ? h('p', { class: 'hud-from' }, t('guest.from', { style: quoted(packName(styleOf(gs))) })) : null,
      h('div', { class: 'hud-price-row' },
        h('div', { class: 'hud-price' }, h('span', { class: 'num' }, price(item, qty)), note ? h('small', null, note) : null),
        h('div', { class: 'hud-price-side' }, totalEl, headUndo)),
      meta.length ? h('div', { class: 'hud-meta' }, meta) : null,
      setNote ? h('p', { class: 'hud-setnote' }, typo(setNote)) : null,
      renderPin());
  }
  function renderPin() {
    if (!store.isPinned?.(ref()) || store.guestStyle?.(ref())) return null; // a guest already says it is yours
    const un = h('button', { type: 'button', class: 'hud-unpin' }, t('hud.unpin'));
    un.addEventListener('click', () => { if (cur) store.unpin(ref()); });
    return h('div', { class: 'hud-pin' },
      h('span', { class: 'hud-pin-ico', 'aria-hidden': 'true', html: icon('pin') }),
      h('span', { class: 'hud-pin-text' }, t('hud.pinned')), un);
  }

  // ---- foot ----
  const removeBtn = h('button', { type: 'button', class: 'hud-remove' });
  removeBtn.addEventListener('click', remove);
  const footUndo = h('button', { type: 'button', class: 'hud-undo', hidden: true }, svg(icon('reset')), h('span', null));
  footUndo.addEventListener('click', () => undo());
  // the «Подстроить комнату» suggestion docks above the foot's actions: always in view, nothing jumps under the cursor
  const footChip = h('div', { class: 'hud-foot-chip' });
  foot.append(footChip, h('div', { class: 'hud-foot-row' }, removeBtn, h('span', { class: 'hud-foot-gap' }), footUndo, xBtn('is-foot')));
  function paintFoot() {
    if (!cur) return;
    const set = removable();
    removeBtn.hidden = !set;
    if (set) {
      const others = set.filter((k) => k !== keyNow());
      const withList = others.map((k) => {
        const sid = store.slotsFor?.(k)?.[0];
        return slotLabel(sid, layoutSlot(sid)?.type || k).toLowerCase();
      });
      removeBtn.replaceChildren(...[h('span', null, t('hud.remove')), withList.length ? h('small', null, t('hud.removeWith', { list: withList.join(', ') })) : null].filter(Boolean));
    }
    const on = canUndo();
    footUndo.hidden = !on;
    footUndo.lastChild.textContent = t('hud.undo');
    footUndo.setAttribute('aria-label', on ? t('hud.undoAria', { what: undoStack.at(-1)?.what || '' }) : t('hud.undo'));
    footUndo.setAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
  }

  // ---------------------------------------------------------------- render
  function render({ keepScroll = false } = {}) {
    if (!cur) return;
    seen?.disconnect();
    if (store.included?.(ref()) === false) { if (!removing) api.close(); return; }
    const item = store.selected(ref()) || cur.item;
    if (!item) return;
    cur.item = item;
    const qty = store.qty(ref()) || 1;
    const scrolls = Object.fromEntries([...content.querySelectorAll('.hud-strip')].map((u) => [u.closest('.hud-row')?.dataset.row, u.scrollLeft]));
    const y = panel.scrollTop;
    // QA-04: re-rendering must not drop keyboard focus. Remember where it was and put it back.
    const active = document.activeElement;
    const hadFocus = content.contains(active);
    const focusedRow = active?.closest?.('.hud-row')?.dataset.row || null;
    const focusedItem = active?.dataset?.item || null;
    const focusedAct = active?.dataset?.act || null;
    const focusedSummary = active?.tagName === 'SUMMARY';

    const curBefore = Object.fromEntries([...content.querySelectorAll('.hud-row')].map((r) => [r.dataset.row, r.querySelector('[aria-pressed="true"]')?.dataset.item || null]));
    content.replaceChildren(...[renderHead(item, qty), renderVariants(item, qty), renderModels(item, qty), renderStyles(item, qty),
      renderDetails(item, qty)].filter(Boolean));
    const chip = renderSuggest();
    if (chip?.textContent !== footChip.firstChild?.textContent || !chip !== !footChip.firstChild) footChip.replaceChildren(...(chip ? [chip] : []));
    paintFoot(); paintHeadUndo();

    if (keepScroll) {
      for (const u of content.querySelectorAll('.hud-strip')) {
        const rowName = u.closest('.hud-row')?.dataset.row;
        u.scrollLeft = scrolls[rowName] || 0;
        // a row whose current piece changed shows it (the pick may have come from another row)
        const c = u.querySelector('[aria-pressed="true"]');
        if (c && c.dataset.item !== curBefore[rowName]) {
          const l = c.offsetLeft - u.scrollLeft, r = l + c.offsetWidth;
          if (l < 0 || r > u.clientWidth) u.scrollTo({ left: Math.max(0, c.offsetLeft - (u.clientWidth - c.offsetWidth) / 2), behavior: reducedMotion() ? 'auto' : 'smooth' });
        }
      }
      panel.scrollTop = y;
    } else {
      panel.scrollTop = 0;
      // centre the chosen tile in its row
      requestAnimationFrame(() => {
        for (const strip of content.querySelectorAll('.hud-strip')) {
          const c = strip.querySelector('[aria-pressed="true"]');
          if (!c || strip.scrollWidth <= strip.clientWidth + 1) continue;
          strip.scrollLeft = Math.max(0, c.offsetLeft - (strip.clientWidth - c.offsetWidth) / 2);
        }
      });
    }
    if (hadFocus || focusedAct) {
      const inRow = focusedRow && content.querySelector(`.hud-row[data-row="${focusedRow}"]`);
      const target = (focusedAct && content.querySelector(`.hud-head [data-act="${focusedAct}"]`))
        || (focusedItem && inRow && inRow.querySelector(`[data-item="${CSS.escape(focusedItem)}"]`))
        || (inRow && (inRow.querySelector('[aria-pressed="true"]') || inRow.querySelector('button')))
        || (focusedSummary && content.querySelector('.hud-details summary'))
        || content.querySelector('.hud-row [tabindex="0"]') || null;
      if (target) { syncRoving(target); target.focus({ preventScroll: true }); }
    }
    if (isCompact()) {
      const before = peekH;
      measureSheet();
      if (sheetShown && Math.abs(before - peekH) > 1 && detent !== 'full') sheetY.set(yFor(detent));
    }
    requestAnimationFrame(() => onResize?.(api.insets()));
  }

  /** Cross-fade the card between two items (walk, tap another item): the old content fades out as the new comes in. */
  let ghost = null;
  function crossfade(dir) {
    if (reducedMotion()) return () => {};
    ghost?.remove();
    const g = content.cloneNode(true);
    g.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    g.classList.add('hud-ghost');
    g.setAttribute('aria-hidden', 'true');
    g.inert = true;
    g.style.top = `${content.offsetTop - panel.scrollTop}px`;
    g.style.width = `${content.offsetWidth}px`;
    panel.append(g);
    ghost = g;
    const dx = dir ? dir * 14 : 0;
    return () => {
      // the old card clears faster than the new one arrives, so text never overlaps at full strength
      const apply = (k) => {
        g.style.opacity = String(Math.max(0, 1 - k * 1.7));
        g.style.transform = `translate3d(${(-dx * k).toFixed(2)}px,0,0)`;
        content.style.opacity = String(Math.max(0, Math.min(1, (k - 0.15) / 0.85)));
        content.style.transform = `translate3d(${(dx * (1 - k)).toFixed(2)}px,0,0)`;
      };
      apply(0);
      const s = createSpring({
        preset: 'fade', precision: 0.003, onUpdate: apply,
        onRest: () => { g.remove(); if (ghost === g) ghost = null; content.style.opacity = ''; content.style.transform = ''; },
      });
      s.set(1);
    };
  }

  /** Roving tab stop: the focused tile becomes its row's single tab stop. */
  function syncRoving(btn) {
    const strip = btn?.closest?.('.hud-strip');
    if (!strip) return;
    for (const b of strip.children) b.tabIndex = b === btn ? 0 : -1;
  }

  // ---------------------------------------------------------------- API
  const api = {
    get isOpen() { return !!cur; },
    get current() { return cur; },
    /** Space the card covers over the stage (px from its right / bottom edge), at rest, for the engine's framing. */
    insets() {
      if (!cur) return { right: 0, bottom: 0 };
      const st = stage.getBoundingClientRect();
      if (isCompact()) {
        const visible = detent === 'full' ? sheetH : peekH;
        const top = window.innerHeight - visible;
        return { right: 0, bottom: Math.max(0, Math.min(st.height, Math.round(st.bottom - top))) };
      }
      // the column's resting left edge (its slide-in transform is not counted) plus a 16 px breathing gap
      const host = el.getBoundingClientRect();
      const restLeft = host.right - (parseFloat(getComputedStyle(panel).right) || 12) - panel.offsetWidth;
      return { right: Math.max(0, Math.round(st.right - restLeft + 16)), bottom: 0 };
    },
    /**
     * Open (or move) the card. `dir`: walk direction for the cross-fade. `engineFlies`: the engine's own walk
     * already flies there (villar.focusNext), so the UI doesn't ask for another flight.
     */
    open(p, { focus = false, from = null, dir = 0, keepFocus = false, engineFlies = false } = {}) {
      if (!p || !(p.slotId || p.slotType)) return api.close();
      const wasOpen = !!cur;
      const same = wasOpen && cur.slotId === p.slotId;
      const slotType = p.slotType || store.placed().find((x) => x.slotId === p.slotId)?.slotType;
      if (!wasOpen) {
        // the walk order is fixed now, from the view the customer was looking at (before the camera moves)
        try { walk = createWalk({ store, project: (ids) => scene?.project?.(ids), entry: p.slotId }); } catch { walk = null; }
        clearUndo();
        shownTotal = null; paintTotal(false);
      }
      const run = wasOpen && !same ? crossfade(dir) : null;
      cur = { slotId: p.slotId, slotType, item: p.item };
      if (!same) {
        expanded.clear();
        if (suggest && suggest.slotId !== p.slotId) suggest = null;
        thumbs?.hold?.(1100); // T7: no thumbnails during the flight ('rest' releases it early)
      }
      if (from) opener = from;
      else if (!wasOpen) opener = document.activeElement !== document.body ? document.activeElement : null;
      if (!wasOpen) openerSel = opener?.dataset?.slot ? `.${opener.classList[0]}[data-slot="${CSS.escape(opener.dataset.slot)}"]` : null;
      if (!wasOpen) openedAt = performance.now();
      el.inert = false;
      render({ keepScroll: same });
      run?.();
      el.classList.add('is-open');
      shell.classList.add('has-hud');
      document.documentElement.classList.add('hud-open');
      suppressOutside = true; setTimeout(() => (suppressOutside = false), 0);
      if (!wasOpen) {
        clearTimeout(presenceTimer);
        if (isCompact()) {
          el.style.visibility = 'visible';
          measureSheet();
          if (!(sheetY.moving && sheetY.target > sheetH)) sheetY.jump(sheetH + CLOSE_GAP); // else: rise from where it is
          sheetShown = true;
          detent = 'peek';
          el.classList.add('is-peek'); el.classList.remove('is-full');
          grip.setAttribute('aria-expanded', 'false'); grip.setAttribute('aria-label', t('hud.expand'));
          presenceTimer = setTimeout(() => sheetY.set(yFor('peek')), CARD_DELAY_MS);
        } else {
          panel.style.visibility = 'visible';
          presenceTimer = setTimeout(() => presence.set(1), CARD_DELAY_MS);
        }
      }
      if (focus) requestAnimationFrame(() => (content.querySelector('.hud-row [tabindex="0"]') || content.querySelector('.hud-navbtn') || el).focus({ preventScroll: true }));
      else if (keepFocus && !content.contains(document.activeElement) && el.contains(document.activeElement)) content.querySelector('.hud-navbtn[data-act="next"]')?.focus({ preventScroll: true });
      // prefetch what the visible tiles would swap in (the engine builds them in idle time)
      if (!same) {
        const ids = [...content.querySelectorAll('[data-item]')].map((b) => b.dataset.item);
        scene?.prefetch?.(cur.slotId, ids);
      }
      onOpen?.(cur, { same, wasOpen, engineFlies });
    },
    close({ restoreFocus = true } = {}) {
      if (!cur) return;
      const was = cur;
      cur = null; walk = null; suggest = null;
      clearUndo();
      ghost?.remove(); ghost = null; content.style.opacity = ''; content.style.transform = '';
      clearTimeout(presenceTimer);
      el.classList.remove('is-open', 'is-full', 'is-peek', 'is-inspecting');
      el.inert = true; // PT-17: nothing in the leaving card can be clicked
      shell.classList.remove('has-hud');
      document.documentElement.classList.remove('hud-open');
      sheetShown = false;
      if (isCompact()) sheetY.set(sheetH + CLOSE_GAP); else presence.set(0);
      if (restoreFocus && (el.contains(document.activeElement) || document.activeElement === document.body)) {
        const back = opener?.isConnected ? opener : (openerSel && document.querySelector(openerSel));
        back?.focus({ preventScroll: true });
      }
      opener = null; openerSel = null;
      onClose?.(was);
    },
    refresh() { render({ keepScroll: true }); },
    walk: walkTo,
    undo,
    get order() { return walk?.order || []; },
  };

  // ---------------------------------------------------------------- store
  store.on('change', (c) => {
    if (!mine && !adopting) clearUndo(); // someone else changed the room (slider, AI, list)
    if (!cur) return;
    paintTotal(true);
    if (removing) return;
    const mineSlot = c.slots ? c.slots.includes(cur.slotId) : store.keyOf?.(cur.slotId) === c.key;
    if (mineSlot) render({ keepScroll: true }); else { paintFoot(); }
  });
  store.on('style', ({ styleId }) => {
    const asked = !!expectStyle && styleId === expectStyle;
    expectStyle = null;
    if (asked || mine) { adopting = true; setTimeout(() => { adopting = false; }, 0); } // its 'change' burst follows now
    if (asked) { if (suggest) suggest = { ...suggest, applied: true }; }
    else if (!mine) { clearUndo(); suggest = null; }
    if (!cur) return;
    if (asked) announce(t('hud.styleAdapted', { style: quoted(packName(store.style(styleId))), total: aed(store.total()) }));
    requestAnimationFrame(() => render({ keepScroll: true }));
  });
  store.on('pins', () => { if (cur) render({ keepScroll: true }); });
  onLang(() => { if (cur) { totalSpring.jump(store.total()); render({ keepScroll: true }); } });

  // ---------------------------------------------------------------- engine (feature-detected)
  // 'inspect' { slotId, angle, atRest, home }: the turntable (engine, later). The card stays out of the way and
  // the rest angle is announced. 'rest': the camera has landed, so the tiles' thumbnails render now.
  const VIEW_STEPS = [0, 45, 90, 135, 180];
  scene?.onEngine?.('inspect', (p) => {
    if (!cur || !p || p.slotId !== cur.slotId) return;
    el.classList.toggle('is-inspecting', !p.atRest || !p.home);
    if (!p.atRest || !Number.isFinite(p.angle)) return;
    let a = ((Math.round(p.angle / 45) * 45) % 360 + 360) % 360;
    if (a > 180) a = 360 - a;
    if (a !== lastView && VIEW_STEPS.includes(a)) { lastView = a; announce(t(`hud.view.${a}`)); }
  });
  scene?.onEngine?.('rest', () => { if (cur) thumbs?.release?.(); });

  // ---------------------------------------------------------------- input
  // QA-01: on touch, the browser's synthesized click lands right after the tap that opened the card.
  el.addEventListener('click', (e) => {
    if (e.timeStamp - openedAt < 400 && !e.target.closest?.('.hud-navbtn')) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  // Click outside the stage and the card closes it (stage clicks arrive as engine select events).
  document.addEventListener('pointerdown', (e) => {
    if (!cur || suppressOutside) return;
    const t0 = e.target;
    if (el.contains(t0) || stage.contains(t0) || t0.closest?.('[data-opens-sheet], .hovercard, .cartbar, .style-picker, .assistant-slot, .toast, dialog')) return;
    api.close({ restoreFocus: false });
  }, true);

  // Keyboard: Esc leaves, [ ] walk, Ctrl/⌘+Z undoes; arrows move within a row (Tab moves between rows).
  document.addEventListener('keydown', (e) => {
    if (!cur || document.querySelector('dialog[open]')) return;
    if (e.target?.closest?.('.assistant-slot')) return; // the assistant handles its own keys
    if (e.key === 'Escape') { e.preventDefault(); api.close(); return; }
    if (editable(e.target)) return;
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); walkTo(e.code === 'BracketRight' ? 1 : -1); return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ') && canUndo()) { e.preventDefault(); undo(); }
  });
  content.addEventListener('keydown', (e) => {
    const btn = e.target?.closest?.('.hud-strip > button');
    if (!btn) return;
    const strip = btn.parentElement;
    const all = [...strip.children];
    const i = all.indexOf(btn);
    let j = -1;
    if (e.key === 'ArrowRight') j = Math.min(all.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = all.length - 1;
    else return;
    e.preventDefault(); e.stopPropagation();
    const next = all[j];
    syncRoving(next);
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  content.addEventListener('focusin', (e) => { const b = e.target?.closest?.('.hud-strip > button'); if (b) syncRoving(b); });

  // Rows scroll sideways: a mouse wheel over a row scrolls it when the card itself has nothing to scroll, and a
  // mouse drag pans it (a drag is never a pick).
  let rowDrag = null, dragMovedAt = 0;
  const dragged = () => performance.now() - dragMovedAt < 80;
  content.addEventListener('wheel', (e) => {
    const strip = e.target?.closest?.('.hud-strip');
    if (!strip || strip.scrollWidth <= strip.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (panel.scrollHeight > panel.clientHeight + 1) return;
    strip.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  content.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const strip = e.target?.closest?.('.hud-strip');
    if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;
    rowDrag = { strip, x: e.clientX, left: strip.scrollLeft, moved: false, id: e.pointerId };
  });
  window.addEventListener('pointermove', (e) => {
    if (!rowDrag || e.pointerId !== rowDrag.id) return;
    const dx = e.clientX - rowDrag.x;
    if (!rowDrag.moved && Math.abs(dx) < 5) return;
    rowDrag.moved = true;
    rowDrag.strip.scrollLeft = rowDrag.left - dx;
    dragMovedAt = performance.now();
  });
  window.addEventListener('pointerup', () => { if (rowDrag?.moved) dragMovedAt = performance.now(); rowDrag = null; });

  // ---------------------------------------------------------------- phone sheet gestures
  // Grip and header: drag up/down between detents (a flick carries its speed into the spring); down from peek
  // leaves focus. A horizontal swipe on the header walks to the next item. In peek, a vertical drag anywhere on
  // the sheet moves it (rows still pan sideways); in full, the content scrolls and the header drags.
  let g = null, headDragged = false;
  const samples = [];
  function sheetDown(e) {
    if (!cur || !isCompact() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const onHead = !!e.target.closest?.('.hud-head, .hud-grip');
    if (!onHead && detent === 'full') return;
    g = { x: e.clientX, y: e.clientY, y0: sheetY.value, axis: null, onHead, id: e.pointerId };
    samples.length = 0; samples.push([performance.now(), e.clientY]);
    headDragged = false;
  }
  function sheetMove(e) {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (g.axis === 'x' && (!g.onHead || e.target.closest?.('.hud-strip'))) { g = null; return; } // rows pan natively
      try { el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      sheetY.stop();
    }
    headDragged = true;
    if (g.axis === 'y') {
      let y = g.y0 + dy;
      if (y < 0) y = -Math.pow(-y, 0.8) * 0.35;   // rubber band above the full detent
      sheetY.jump(y);
      samples.push([performance.now(), e.clientY]);
      if (samples.length > 6) samples.shift();
    } else {
      content.style.transform = `translate3d(${(dx * 0.25).toFixed(1)}px,0,0)`;
    }
  }
  function sheetUp(e) {
    if (!g || e.pointerId !== g.id) return;
    const axis = g.axis, dx = e.clientX - g.x;
    g = null;
    setTimeout(() => (headDragged = false), 0);
    if (axis === 'x') {
      content.style.transform = '';
      if (Math.abs(dx) >= SWIPE_PX) walkTo(dx < 0 ? 1 : -1);
      return;
    }
    if (axis !== 'y') return;
    const [t0, y0] = samples[0] || [performance.now(), e.clientY];
    const [t1, y1] = samples.at(-1) || [performance.now(), e.clientY];
    const v = (y1 - y0) / Math.max(0.016, (t1 - t0) / 1000);   // px/s, + = down
    const y = sheetY.value, end = y + v * 0.18;
    const peekY = yFor('peek');
    if (end > peekY + peekH * 0.45) { sheetY.set(sheetH + CLOSE_GAP, { velocity: v }); api.close(); return; }
    setDetent(Math.abs(end - 0) < Math.abs(end - peekY) ? 'full' : 'peek', { velocity: v });
  }
  el.addEventListener('pointerdown', sheetDown);
  el.addEventListener('pointermove', sheetMove);
  el.addEventListener('pointerup', sheetUp);
  el.addEventListener('pointercancel', (e) => { if (g && e.pointerId === g.id) { const was = g.axis; g = null; content.style.transform = ''; if (was === 'y') setDetent(detent); } });
  grip.addEventListener('click', () => { if (headDragged || !isCompact()) return; setDetent(detent === 'full' ? 'peek' : 'full'); });

  // The page scrolls the stage under the nav when the sheet opens: re-frame once it has settled.
  let scrollT = 0;
  window.addEventListener('scroll', () => {
    if (!cur || !isCompact()) return;
    clearTimeout(scrollT);
    scrollT = setTimeout(() => { if (cur) onResize?.(api.insets()); }, 140);
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (!cur) return;
    if (isCompact()) { panel.style.opacity = ''; panel.style.transform = ''; panel.style.visibility = ''; measureSheet(); sheetY.jump(yFor(detent)); el.style.visibility = 'visible'; }
    else { el.style.transform = ''; el.style.height = ''; el.style.visibility = ''; presence.jump(1); panel.style.visibility = 'visible'; }
    onResize?.(api.insets());
  });

  return api;
}
