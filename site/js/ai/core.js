// Villar assistant core — pure, DOM-free logic shared by the browser (local fallback, apply) and the
// Vercel Function (api/assistant.js imports this file). Owner: assistant.
//
// The selection model mirrors site/js/core/store.js exactly: a slot's key in a pack is its slot id if the
// pack defines slots[slotId], else its group if the pack defines slots[group], else its slot type.
// Totals are the sum over every layout slot of the price of the item chosen for that slot's key.

export const VIEWS = ['eye', 'living', 'bed', 'dining', 'window', 'top'];
export const TIMES = ['morning', 'day', 'golden', 'evening'];
export const ACTION_TYPES = ['select', 'style', 'view', 'time', 'focus', 'reset'];

const VIEW_ALIASES = {
  entry: 'eye', entrance: 'eye', door: 'eye', hall: 'eye', default: 'eye', start: 'eye',
  lounge: 'living', 'living-room': 'living', livingroom: 'living', sofa: 'living',
  bedroom: 'bed', sleep: 'bed', dinner: 'dining', kitchen: 'dining', 'dining-room': 'dining',
  windows: 'window', view: 'window', balcony: 'window',
  plan: 'top', overhead: 'top', 'top-down': 'top', dollhouse: 'top', floorplan: 'top', above: 'top',
};
const TIME_ALIASES = {
  dawn: 'morning', sunrise: 'morning', am: 'morning', noon: 'day', midday: 'day', afternoon: 'day', daylight: 'day',
  sunset: 'golden', dusk: 'golden', 'golden-hour': 'golden', goldenhour: 'golden',
  night: 'evening', 'night-time': 'evening', pm: 'evening',
};

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
export function normalizeView(name) {
  const n = norm(name);
  if (VIEWS.includes(n)) return n;
  return VIEW_ALIASES[n] || null;
}
export function normalizeTime(name) {
  const n = norm(name);
  if (TIMES.includes(n)) return n;
  return TIME_ALIASES[n] || null;
}

/**
 * Selection simulator over the raw data (catalog, layout, packs). No events, no persistence.
 * `packs` = { [id]: stylepack }.
 */
export function createSim({ catalog, layout, packs }) {
  const items = new Map((catalog?.items || []).map((it) => [it.id, it]));
  const slots = layout?.slots || [];
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const packIds = Object.keys(packs || {});
  const pack = (id) => packs?.[id] || null;

  const keyOfSlotIn = (p, slot) => {
    const ps = p?.slots || {};
    return (ps[slot.id] && slot.id) || (slot.group && ps[slot.group] && slot.group) || slot.type;
  };
  /** Resolve a slot id / group / key / type to the pack's selection key (store.js keyIn). */
  const keyIn = (p, x) => {
    if (x && typeof x === 'object') x = x.slotId || x.id || x.slotType;
    const slot = slotById.get(x);
    return slot ? keyOfSlotIn(p, slot) : x;
  };
  const slotsForKey = (p, key) => slots.filter((s) => keyOfSlotIn(p, s) === key);

  const defaults = (packId) => {
    const p = pack(packId); const out = {};
    for (const [key, cfg] of Object.entries(p?.slots || {})) {
      const def = items.has(cfg.default) ? cfg.default : (cfg.options || []).find((o) => items.has(o));
      if (def) out[key] = def;
    }
    return out;
  };

  /** Fill defaults and drop anything that is not a valid option of the pack. */
  const normalizeSelection = (packId, sel) => {
    const p = pack(packId); const out = defaults(packId);
    for (const [key, id] of Object.entries(sel || {})) {
      if (p?.slots?.[key]?.options?.includes(id) && items.has(id)) out[key] = id;
    }
    return out;
  };

  /** Selection keys of the pack that are actually placed in the layout (qty > 0). */
  const placedKeys = (packId) => {
    const p = pack(packId); const seen = new Set(); const out = [];
    for (const s of slots) {
      const k = keyOfSlotIn(p, s);
      if (!seen.has(k) && p?.slots?.[k]) { seen.add(k); out.push(k); }
    }
    return out;
  };

  const qty = (packId, key) => slotsForKey(pack(packId), key).length;
  const typeOfKey = (packId, key) => slotsForKey(pack(packId), key)[0]?.type || key;
  const options = (packId, key) => (pack(packId)?.slots?.[key]?.options || []).map((id) => items.get(id)).filter(Boolean);

  const total = (packId, sel) => {
    const p = pack(packId);
    return slots.reduce((a, s) => a + (Number(items.get(sel?.[keyOfSlotIn(p, s)])?.price) || 0), 0);
  };

  /** Same landing rule as store.previewStyle: the pack's curated defaults + anchor + its pairings. */
  const styleSelection = (toId, anchor) => {
    const target = pack(toId);
    const next = defaults(toId);
    let anchorKey = null;
    if (target && anchor?.itemId) {
      anchorKey = keyIn(target, anchor.slotId || anchor.key || items.get(anchor.itemId)?.type);
      if (target.slots?.[anchorKey]?.options?.includes(anchor.itemId)) {
        next[anchorKey] = anchor.itemId;
        const pairs = target.pairings?.[anchor.itemId] || {};
        for (const [k, id] of Object.entries(pairs)) if (target.slots?.[k]?.options?.includes(id)) next[k] = id;
      } else anchorKey = null;
    }
    return { selection: next, anchorKey };
  };

  /** Resolve a style reference (id, Russian/English name, loose spelling) to a pack id. */
  const resolveStyle = (ref) => {
    if (!ref) return null;
    if (packs[ref]) return ref;
    const r = foldText(ref);
    for (const id of packIds) {
      const p = packs[id];
      if ([id, p.name, p.nameEn, p.shortName].filter(Boolean).some((n) => foldText(n) === r)) return id;
    }
    return null;
  };

  /**
   * Resolve a select request to a valid { key, itemId } in the pack, or null.
   * Accepts key | slotId | group | type; if none fits, infers the key from the packs' options.
   */
  const resolveSelect = (packId, { key, slotId, itemId } = {}) => {
    const p = pack(packId);
    if (!p || !items.has(itemId)) return null;
    // An explicit reference to a real key is strict: the item must be one of its options.
    let typeHint = null;
    for (const ref of [slotId, key]) {
      if (!ref) continue;
      const k = keyIn(p, ref);
      if (p.slots?.[k]) return p.slots[k].options.includes(itemId) && slotsForKey(p, k).length ? { key: k, itemId } : null;
      typeHint = typeHint || slotById.get(ref)?.type || ref; // e.g. 'wall_art' when keys are per placement
    }
    // Otherwise infer the key whose options contain the item (restricted to the hinted type, if any).
    let cands = placedKeys(packId).filter((k) => p.slots[k].options.includes(itemId));
    if (typeHint) cands = cands.filter((k) => typeOfKey(packId, k) === typeHint);
    return cands.length ? { key: cands[0], itemId } : null;
  };

  const resolveSlot = (packId, ref) => {
    if (!ref) return null;
    if (slotById.has(ref)) return ref;
    const p = pack(packId);
    const k = keyIn(p, ref);
    return slotsForKey(p, k)[0]?.id || slots.find((s) => s.type === ref || s.group === ref)?.id || null;
  };

  /**
   * Validate and apply an ordered list of raw actions to a state { style, selection }.
   * Canonical order: style → reset → select → time → view → focus. Invalid actions are dropped.
   * Returns { state, actions (normalized), dropped: [{ action, why }] }.
   */
  const applyActions = (state0, raw, { maxActions = 30 } = {}) => {
    let style = pack(state0?.style) ? state0.style : packIds[0];
    let selection = normalizeSelection(style, state0?.selection);
    const out = []; const dropped = [];
    const list = (Array.isArray(raw) ? raw : []).slice(0, maxActions).filter((a) => a && typeof a === 'object');
    const order = { style: 0, reset: 1, select: 2, time: 3, view: 4, focus: 5 };
    const sorted = list.map((a, i) => ({ a, i, t: String(a.type || a.action || '').toLowerCase() }))
      .sort((x, y) => (order[x.t] ?? 9) - (order[y.t] ?? 9) || x.i - y.i);

    let hadStyle = false, hadReset = false, view = null, time = null, focus = null;
    const selects = new Map();
    for (const { a, t } of sorted) {
      if (t === 'style') {
        if (hadStyle) { dropped.push({ action: a, why: 'duplicate style' }); continue; }
        const id = resolveStyle(a.styleId || a.style || a.id || a.name);
        if (!id) { dropped.push({ action: a, why: 'unknown style' }); continue; }
        const anchorItemId = a.anchorItemId || a.anchor?.itemId || null;
        const anchorRef = a.anchor?.slotId || a.anchor?.key || a.anchorKey || null;
        const { selection: next, anchorKey } = styleSelection(id, anchorItemId ? { itemId: anchorItemId, key: anchorRef } : null);
        if (id === style && !anchorKey) { dropped.push({ action: a, why: 'already active' }); continue; }
        hadStyle = true; style = id; selection = next;
        out.push({ type: 'style', styleId: id, anchor: anchorKey ? { key: anchorKey, itemId: anchorItemId } : null });
      } else if (t === 'reset') {
        if (hadReset) continue;
        hadReset = true; selection = defaults(style);
        out.push({ type: 'reset' });
      } else if (t === 'select') {
        const r = resolveSelect(style, { key: a.key, slotId: a.slotId, itemId: a.itemId || a.item || a.id });
        if (!r) { dropped.push({ action: a, why: 'not a compatible option' }); continue; }
        selects.set(r.key, r.itemId); // last one per key wins
      } else if (t === 'time') {
        const n = normalizeTime(a.name || a.time || a.value);
        if (n) time = n; else dropped.push({ action: a, why: 'unknown time' });
      } else if (t === 'view') {
        const n = normalizeView(a.name || a.view || a.value);
        if (n) view = n; else dropped.push({ action: a, why: 'unknown view' });
      } else if (t === 'focus') {
        const s = resolveSlot(style, a.slotId || a.key || a.slot || a.name);
        if (s) focus = s; else dropped.push({ action: a, why: 'unknown slot' });
      } else dropped.push({ action: a, why: 'unknown type' });
    }
    for (const [key, itemId] of selects) {
      if (selection[key] === itemId) continue; // no-op
      selection = { ...selection, [key]: itemId };
      out.push({ type: 'select', key, slotId: slotsForKey(pack(style), key)[0]?.id || key, itemId });
    }
    if (time) out.push({ type: 'time', name: time });
    if (view) out.push({ type: 'view', name: view });
    if (focus) out.push({ type: 'focus', slotId: focus });
    return { state: { style, selection }, actions: out, dropped };
  };

  const minTotal = (packId) => {
    const sel = {};
    for (const k of placedKeys(packId)) {
      const opts = options(packId, k);
      if (opts.length) sel[k] = opts.reduce((a, b) => ((+b.price || 0) < (+a.price || 0) ? b : a)).id;
    }
    return total(packId, normalizeSelection(packId, sel));
  };

  /**
   * Fit a selection under a budget with as few swaps as possible, landing as close under the target as
   * possible: whenever one swap is enough, take the one that saves the least (keeps the most); otherwise
   * take the swap that saves the most. Protected keys are touched only if nothing else can reach the target.
   * Returns { selection, swaps: [{ key, from, to, saving }], total, min, ok }.
   */
  const fitBudget = (packId, sel0, target, { protect = [] } = {}) => {
    let selection = normalizeSelection(packId, sel0);
    const swaps = [];
    const min = minTotal(packId);
    const keys = placedKeys(packId);
    const prot = new Set(protect);
    const step = (allowProtected) => {
      const cur = total(packId, selection);
      if (cur <= target) return false;
      const need = cur - target;
      let enough = null, best = null;
      for (const k of keys) {
        if (!allowProtected && prot.has(k)) continue;
        const q = qty(packId, k);
        const now = +items.get(selection[k])?.price || 0;
        for (const it of options(packId, k)) {
          const saving = (now - (+it.price || 0)) * q;
          if (saving <= 0) continue;
          const c = { key: k, to: it.id, saving };
          if (saving >= need) { if (!enough || saving < enough.saving) enough = c; }
          else if (!best || saving > best.saving) best = c;
        }
      }
      const pick = enough || best;
      if (!pick) return false;
      const prev = swaps.find((s) => s.key === pick.key);
      if (prev) { prev.to = pick.to; prev.saving += pick.saving; } else swaps.push({ key: pick.key, from: selection[pick.key], to: pick.to, saving: pick.saving });
      selection = { ...selection, [pick.key]: pick.to };
      return true;
    };
    for (let guard = 0; guard < 80 && step(false); guard++);
    for (let guard = 0; guard < 80 && step(true); guard++);
    const t = total(packId, selection);
    return { selection, swaps: swaps.filter((s) => s.from !== s.to), total: t, min, ok: t <= target };
  };

  return {
    items, slots, slotById, packIds, pack, keyIn, keyOfSlotIn, slotsForKey, defaults, normalizeSelection,
    placedKeys, qty, typeOfKey, options, total, styleSelection, resolveStyle, resolveSelect, resolveSlot,
    applyActions, minTotal, fitBudget,
  };
}

// ------------------------------------------------------------------ text helpers

/** Lowercase, ё→е, strip punctuation (keeps letters, digits, spaces). */
export function foldText(s) {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[«»"“”„'’`]/g, '')
    .replace(/[^\p{L}\p{N}\s.,-]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Parse a budget from free text: "уложись в 25 000", "до 30 тыс", "budget 25k", "under 20,000 AED".
 * Returns an integer AED amount, or null. Requires a budget cue or a currency/thousands marker.
 */
export function parseBudget(text) {
  const t = foldText(text).replace(/(\d)[\s .,](?=\d{3}\b)/g, '$1');
  const cue = /(уложи|уложить|влез|впиши|бюджет|не дороже|не больше|не более|максимум|в пределах|до\s+\d|за\s+\d|budget|under\s+\d|below\s+\d|within|max(imum)?|no more than|cap\b|keep it)/;
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(k(?![a-z])|к(?!\p{L})|тыс(?:яч[аи]?)?|thousand|т(?!\p{L}))?\s*(aed|дирхам\p{L}*|dhs?)?/gu);
  if (!m) return null;
  let best = null;
  for (const raw of m) {
    const mm = raw.match(/(\d+(?:[.,]\d+)?)\s*(k(?![a-z])|к(?!\p{L})|тыс(?:яч[аи]?)?|thousand|т(?!\p{L}))?\s*(aed|дирхам\p{L}*|dhs?)?/u);
    let n = parseFloat(mm[1].replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    if (mm[2]) n *= 1000;
    const marked = !!(mm[2] || mm[3]);
    if (n < 1000 || n > 5_000_000) continue;
    if (!marked && !cue.test(t)) continue;
    best = Math.round(n);
  }
  return best;
}

// Retailers / marketplaces we never name, plus URL and SKU-like patterns. A sentence that mentions any of
// them is dropped whole (cleaner than leaving a hole in it).
const SUPPLIERS = /\b(home\s*cent(?:re|er)s?|homecentre|landmark\s*group|dragon\s*mart|ikea|pan\s*emirates|danube\s*home|marina\s*home|home\s*box|homebox|2xl|west\s*elm|pottery\s*barn|zara\s*home|h\s*&\s*m\s*home|crate\s*(?:&|and)\s*barrel|amazon|noon\.com)\b/i;
const SUPPLIERS_RU = /(?<!\p{L})(хоум\s*центр\p{L}*|икеа|икея|драгон\s*март\p{L}*)(?!\p{L})/iu;
const URLS = /\b(?:https?:\/\/|www\.)[^\s)\]]*[^\s)\].,!?]|\b[\w-]+\.(?:com|ae|net|org|shop|store|ru)\b/i;
const SKUS = /(?<!\p{L})(?:sku|артикул\p{L}*|арт\.|item\s*(?:no|#)|код товара|product code)(?!\p{L})/iu;
const MARK = '\u2063';
const flag = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
const BAD_RES = [URLS, SKUS, SUPPLIERS, SUPPLIERS_RU].map(flag);

/** Drop sentences naming suppliers, links or SKUs; strip markdown/control chars; clamp length. */
export function sanitizeText(s, max = 420) {
  let clean = String(s ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2063]/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  for (const re of BAD_RES) clean = clean.replace(re, MARK);
  const sentences = clean.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [];
  let t = sentences.map((x) => x.trim()).filter((x) => x && !x.includes(MARK)).join(' ')
    .replace(/\s+([.,;:!?])/g, '$1').trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    t = (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
  }
  return t;
}

/** Chips: 0–4 short, unique, sanitized strings. */
export function sanitizeChips(list, { max = 4, len = 34 } = {}) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const s = sanitizeText(c, 60).replace(/[.。]+$/, '');
    if (!s || s.length > len) continue;
    if (out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// ------------------------------------------------------------------ server index

const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };

/**
 * Compact, public-safe index of everything the assistant needs (built by tools/build-ai-index.mjs into
 * api/_catalog.js): items referenced by any pack (display fields only — no model params), layout slots,
 * views, packs (options, defaults, pairings) and the default style. Same shape the simulator reads.
 */
export function buildAiIndex({ catalog, layout, packs, styles }) {
  const used = new Set();
  const packOut = {};
  for (const [id, p] of Object.entries(packs || {})) {
    const slots = {};
    for (const [k, cfg] of Object.entries(p.slots || {})) {
      const options = (cfg.options || []).filter(Boolean);
      options.forEach((o) => used.add(o));
      slots[k] = { default: cfg.default, options };
    }
    packOut[id] = {
      id, name: p.name, nameEn: p.nameEn || null, tagline: p.tagline || null, taglineEn: p.taglineEn || null,
      description: p.description ? String(p.description).slice(0, 280) : null,
      descriptionEn: p.descriptionEn ? String(p.descriptionEn).slice(0, 280) : null,
      slots, pairings: p.pairings || {},
    };
  }
  const pick = (it) => {
    const o = { id: it.id, type: it.type, name: it.name, price: Math.round(Number(it.price) || 0) };
    for (const k of ['nameEn', 'shortName', 'shortNameEn', 'color', 'colorEn', 'colorHex']) if (it[k]) o[k] = it[k];
    if (Array.isArray(it.materials)) o.materials = it.materials;
    if (Array.isArray(it.materialsEn)) o.materialsEn = it.materialsEn;
    if (it.dims) o.dims = { w: it.dims.w, d: it.dims.d, h: it.dims.h, ...(it.dims.round ? { round: true } : {}) };
    return o;
  };
  const items = (catalog?.items || []).filter((it) => used.has(it.id)).map(pick);
  const out = {
    v: 1,
    currency: catalog?.currency || 'AED',
    default: packOut[styles?.default] ? styles.default : Object.keys(packOut)[0],
    layout: {
      id: layout?.id, name: layout?.name || null, areaM2: layout?.areaM2 || null,
      slots: (layout?.slots || []).map((s) => ({ id: s.id, type: s.type, ...(s.group ? { group: s.group } : {}), ...(s.attach?.slot ? { on: s.attach.slot } : {}) })),
      views: Object.keys(layout?.views || {}),
    },
    packs: packOut,
    catalog: { items },
  };
  out.hash = fnv(JSON.stringify([out.layout, out.packs, out.catalog]));
  return out;
}
