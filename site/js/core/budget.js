// Villar budget planner — the ladder behind the budget slider (docs/BUDGET.md, research/budget-tiers.md).
// Owner: coordinator. Pure and deterministic: used by the UI slider, the AI line (ai/core.js) and the server.
//
// A ladder is the ordered list of rooms from the cheapest sensible studio to the premium one for a style.
// Each step adds one thing (or a group: table + chairs) or upgrades one thing, so moving right only adds or
// upgrades and moving left only removes or downgrades — the room never reshuffles. It passes exactly through
// the designer's room. Rule: complete first, then better (furniture enters at its cheapest option, keeping
// furniture pairings; lights/textiles/art/accessories enter as the designer picked them; once everything is in,
// the main pieces are upgraded to the designer's picks, then to premium).
//
// Pins: keys the customer chose by hand. A pinned key keeps its item (or stays empty if pinned to null) in every
// step; the ladder plans around it. Keys that require a pinned-empty key stay empty too.

const re = (m) => new RegExp(m.pattern, 'i');

/**
 * @param {object} o
 * @param {object} o.pack      style pack ({ id, slots: { key: { default, options } }, pairings })
 * @param {Map|object[]} o.items  catalog items (Map id → item, or array)
 * @param {object} o.layout    layout ({ slots: [{ id, type, group }] })
 * @param {object} o.spec      site/data/budget.json
 * @param {object} [o.pinned]  { key: itemId | null }
 */
export function buildLadder({ pack, items, layout, spec, pinned = {} }) {
  const byId = items instanceof Map ? items : new Map(items.map((i) => [i.id, i]));
  const P = pack.slots || {};
  const has = (k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(P, k);
  const keyOf = (s) => (P[s.id] && s.id) || (s.group && P[s.group] && s.group) || s.type;
  const qty = {};
  for (const s of layout.slots) { const k = keyOf(s); qty[k] = (qty[k] || 0) + 1; }
  const keys = Object.keys(P).filter((k) => qty[k]);
  const FURN = new Set(spec.furniture || []);
  const FUNC = new Map((spec.functional || []).map((f) => [f.id, f]));
  const matches = (it, m) => re(m).test(String(it?.[m.field] || ''));
  const pins = Object.fromEntries(Object.entries(pinned || {}).filter(([k, v]) => has(k) && (v === null || P[k].options.includes(v))));

  const curated = (k) => byId.get(P[k].default) || opts(k)[0];
  const opts = (k) => P[k].options.map((id) => byId.get(id)).filter(Boolean)
    .sort((a, b) => a.price - b.price || (b.id === P[k].default) - (a.id === P[k].default));
  const cheapest = (k) => opts(k)[0];

  // Keys that can't appear because something they require is pinned empty (transitively).
  const blocked = new Set(Object.entries(pins).filter(([, v]) => v === null).map(([k]) => k));
  for (let changed = true; changed;) {
    changed = false;
    for (const [k, deps] of Object.entries(spec.requires || {})) if (!blocked.has(k) && deps.some((d) => blocked.has(d))) { blocked.add(k); changed = true; }
  }
  const pinnedItem = (k) => (k in pins && pins[k] !== null ? byId.get(pins[k]) : null);
  const fixed = (k) => k in pins || blocked.has(k);

  const sel = {}; const steps = []; let run = 0;
  const total = () => Object.entries(sel).reduce((a, [k, it]) => a + (it ? it.price * (qty[k] || 0) : 0), 0);
  const selection = () => Object.fromEntries(keys.map((k) => [k, sel[k] ? sel[k].id : null]));
  const commit = (label, kind, tier, changes) => {
    const delta = []; const before = {};
    for (const [k, it] of changes) {
      if (!it || (fixed(k) && !(kind === 'min' && pinnedItem(k) === it))) continue;
      if (sel[k]?.id !== it.id) { delta.push({ key: k, from: sel[k]?.id || null, to: it.id }); before[k] = sel[k]; }
      sel[k] = it;
    }
    if (!delta.length) return false;
    const t = total();
    // The contract: every step after the minimum makes the room strictly richer (moving right never takes away).
    if (kind !== 'min' && t <= run) { for (const [k, v] of Object.entries(before)) { if (v) sel[k] = v; else delete sel[k]; } return false; }
    steps.push({ label, kind, tier, add: t - run, total: t, delta, selection: selection() });
    run = t;
    return true;
  };
  /** Would putting `m` on furniture key `k` break a pairing demanded by a pinned furniture item? */
  // What the customer's pinned piece asks for wins; only when it asks nothing do we avoid partners that would
  // themselves ask for a different piece (pairings in the data are not always symmetric).
  const pinConflict = (k, m) => {
    if (!FURN.has(k)) return false;
    let back = false;
    for (const k2 of Object.keys(pins)) {
      const it2 = pinnedItem(k2); if (!it2 || !FURN.has(k2)) continue;
      const want = pack.pairings?.[it2.id]?.[k];
      if (want) return want !== m.id;
      const b = pack.pairings?.[m.id]?.[k2];
      if (b && b !== it2.id) back = true;
    }
    return back;
  };
  const pairFor = (k) => {
    if (!FURN.has(k)) return null;
    for (const [k2, it] of Object.entries(sel)) {
      const want = it && FURN.has(k2) && pack.pairings?.[it.id]?.[k];
      if (want && P[k].options.includes(want)) return byId.get(want);
    }
    return null;
  };
  // Options that don't fight a pinned furniture item's pairing (the customer's pick wins).
  const okOpts = (k) => { const o = opts(k); const f = o.filter((i) => !pinConflict(k, i)); return f.length ? f : o; };
  const entry = (k, tier) => {
    const paired = pairFor(k); if (paired && !pinConflict(k, paired)) return paired;
    if (tier === 0) return okOpts(k)[0];
    if (!FURN.has(k)) return curated(k);
    const o = okOpts(k);
    if (k === 'rug' && spec.entry?.rug) {
      const c = o[0]; const r = o.find((i) => (i.dims?.w || 0) >= spec.entry.rug.preferWidthCmAtLeast);
      return r && r.price <= spec.entry.rug.ifPriceAtMost * c.price ? r : c;
    }
    return o[0];
  };
  const withCompanions = (k, it) => {
    const ch = [[k, it]];
    for (const [k2, id] of Object.entries(pack.pairings?.[it.id] || {})) {
      if (sel[k2] && FURN.has(k) && FURN.has(k2) && P[k2]?.options.includes(id) && !fixed(k2)) ch.push([k2, byId.get(id)]);
    }
    return ch;
  };
  const grouped = new Map(); for (const g of spec.groups || []) for (const k of g) grouped.set(k, g);
  const keptByFunction = (k) => (spec.functional || []).some((f) => f.key === k && f.keepAboveCurated && sel[k] && matches(sel[k], f.match));

  // 1. Minimum: tier 0 at the cheapest options, plus every pinned item.
  // A pinned piece brings what it needs (lamps → nightstands, tableware → table + chairs, …), so the minimum is
  // always a coherent room: no priced item that can't be placed (PT4-01).
  const min = [];
  for (const k of spec.order?.['0'] || []) if (has(k) && !fixed(k)) min.push([k, entry(k, 0)]);
  for (const k of Object.keys(pins)) { const it = pinnedItem(k); if (it) min.push([k, it]); }
  const inMin = new Set(min.map(([k]) => k));
  for (const k of dependencyClosure([...inMin], spec, has)) {
    if (inMin.has(k) || fixed(k)) continue;
    sel[k] = entry(k, 1); inMin.add(k); min.push([k, sel[k]]); // later deps see earlier ones (pairings)
  }
  for (const [k] of min) if (!(k in pins)) delete sel[k];
  commit('minimum', 'min', 0, min);

  // 2. Adds, tier by tier (groups move together), plus functional upgrades (e.g. blackout curtains).
  for (const t of [1, 2, 3, 4]) {
    for (const k of spec.order?.[String(t)] || []) {
      if (k.startsWith('@')) {
        const f = FUNC.get(k.slice(1));
        if (f && P[f.key] && !fixed(f.key) && sel[f.key]) {
          const it = opts(f.key).find((i) => matches(i, f.match));
          if (it && it.price > sel[f.key].price) commit(`${f.key}: ${f.id}`, 'func', t, [[f.key, it]]);
        }
        continue;
      }
      if (!P[k] || sel[k] || fixed(k)) continue;
      const g = (grouped.get(k) || [k]).filter((gk) => P[gk] && !sel[gk] && !fixed(gk));
      const ch = [];
      for (const gk of g) { const it = entry(gk, t); ch.push([gk, it]); sel[gk] = it; } // later members see earlier ones
      for (const gk of g) delete sel[gk];
      commit('+ ' + g.join(' + '), 'add', t, ch);
    }
  }
  // Any key the spec doesn't mention still gets in (at its curated item) so the ladder reaches the designer room.
  for (const k of keys) if (!sel[k] && !fixed(k)) commit('+ ' + k, 'add', 4, [[k, curated(k)]]);
  const complete = run;

  // 3. Main pieces up to the designer's picks (furniture companions in the same step), then the rest.
  const upgradable = (k) => has(k) && sel[k] && !fixed(k) && !keptByFunction(k) && sel[k].id !== curated(k).id && !pinConflict(k, curated(k));
  for (const k of spec.heroes || []) if (upgradable(k)) commit(`${k} → designer`, 'upg', 5, withCompanions(k, curated(k)).filter(([k2, it]) => k2 === k || !pinConflict(k2, it)));
  for (const k of [...(spec.premiumOrder || []), ...keys]) if (upgradable(k)) commit(`${k} → designer`, 'upg', 5, [[k, curated(k)]]);
  const designer = run;

  // 4. Premium, pairing-safe.
  const conflicts = (k, m) => {
    if (!FURN.has(k)) return false;
    if (pinConflict(k, m)) return true;
    for (const [k2, it2] of Object.entries(sel)) { if (k2 === k || !it2) continue; const w = FURN.has(k2) && pack.pairings?.[it2.id]?.[k]; if (w && w !== m.id) return true; }
    for (const [k2, w] of Object.entries(pack.pairings?.[m.id] || {})) if (sel[k2] && FURN.has(k2) && sel[k2].id !== w && (fixed(k2) || byId.get(w).price < sel[k2].price)) return true;
    return false;
  };
  for (const k of spec.premiumOrder || []) {
    if (!has(k) || !sel[k] || fixed(k)) continue;
    const m = opts(k).filter((i) => i.price > sel[k].price).sort((a, b) => b.price - a.price).find((c) => !conflicts(k, c));
    if (m) commit(`${k} → premium`, 'prem', 6, withCompanions(k, m));
  }

  const lastIndexWhere = (pred) => { let i = -1; steps.forEach((s, j) => { if (pred(s)) i = j; }); return i; };
  const endOfTier = (t) => lastIndexWhere((s) => s.tier <= t && (s.kind === 'min' || s.kind === 'add' || s.kind === 'func'));
  const idx = {
    'tier:0': 0,
    'endOfTier:1': endOfTier(1), 'endOfTier:2': endOfTier(2), 'endOfTier:3': endOfTier(3),
    'endOfTier:4': lastIndexWhere((s) => s.total === complete),
    designer: lastIndexWhere((s) => s.total === designer),
    premium: steps.length - 1,
  };
  const levels = (spec.levels || []).map((l) => {
    const index = Math.max(0, idx[l.milestone] ?? 0);
    return { id: l.id, name: l.name, nameEn: l.nameEn, blurb: l.blurb, blurbEn: l.blurbEn, milestone: l.milestone, index, total: steps[index]?.total || 0 };
  });
  return {
    packId: pack.id, steps, levels,
    minIndex: 0, maxIndex: steps.length - 1, defaultIndex: Math.max(0, idx.designer),
    min: steps[0]?.total || 0, max: run, designerTotal: designer,
  };
}

/** Keys required (transitively, groups included) by `keys`: e.g. table_lamp → nightstand; tableware → table + chairs. */
export function dependencyClosure(keys, spec, has = () => true) {
  const out = new Set(keys); const queue = [...keys];
  const groupOf = new Map(); for (const g of spec.groups || []) for (const k of g) groupOf.set(k, g);
  while (queue.length) {
    const k = queue.pop();
    for (const d of [...(spec.requires?.[k] || []), ...(groupOf.get(k) || [])]) if (has(d) && !out.has(d)) { out.add(d); queue.push(d); }
  }
  return [...out];
}

/**
 * What adding `key` to the current room also needs (the "Add" button, a pick in an empty zone): every missing
 * dependency at the style's designer pick. Returns { [key]: itemId } (the key itself excluded).
 */
export function requiredFor({ pack, spec, selection, key }) {
  const P = pack.slots || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(P, k);
  const out = {};
  for (const k of dependencyClosure([key], spec, has)) if (k !== key && selection[k] == null && P[k]?.default) out[k] = P[k].default;
  return out;
}

/** Index of the richest step whose total ≤ budget (clamped to the minimum). */
export function ladderIndexFor(ladder, budget) {
  let lo = 0; let hi = ladder.steps.length - 1; let best = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ladder.steps[mid].total <= budget) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best;
}

/** The named level a step belongs to: the last level whose milestone is at or before it. */
export function levelAt(ladder, index) {
  let cur = null;
  for (const l of ladder.levels) if (l.index <= index) cur = l;
  return cur;
}

/** Ladder step whose selection equals `selection` (null if the room isn't on the ladder, e.g. after a manual swap). */
export function indexOfSelection(ladder, selection) {
  for (let i = ladder.steps.length - 1; i >= 0; i -= 1) {
    const s = ladder.steps[i].selection;
    if (Object.keys(s).every((k) => (selection[k] ?? null) === s[k])) return i;
  }
  return -1;
}

/** Memoised ladders per (pack, pins). */
export function createPlanner({ items, layout, spec }) {
  const cache = new Map();
  return {
    ladder(pack, pinned = {}) {
      const id = `${pack.id}|${JSON.stringify(Object.entries(pinned).sort())}`;
      if (!cache.has(id)) { if (cache.size > 32) cache.clear(); cache.set(id, buildLadder({ pack, items, layout, spec, pinned })); }
      return cache.get(id);
    },
    ladderIndexFor, levelAt, indexOfSelection,
  };
}
