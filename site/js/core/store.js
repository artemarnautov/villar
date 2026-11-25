// Villar selection store — single source of truth for what is placed in the apartment.
// Owner: coordinator. Engine and UI subscribe; neither mutates state directly.
//
// Multi-style: the store holds every style pack. One pack is active at a time. Selection is kept per
// *key* within the active pack. A slot's key is resolved (against the active pack) as:
//   1. its slot id, if the pack defines `slots[slotId]` (per-placement choice, e.g. each wall art)
//   2. its group, if the pack defines `slots[group]` (shared choice, e.g. both nightstands)
//   3. its slot type (shared by every slot of that type — the default)
// Every API below accepts a slot id, a group, a key or a slot type.
//
// Events:
//   'change' { key, slotType, slots: [slotIds], itemId, prev, reason }   (one per changed key)
//   'style'  { styleId, prev, anchor, changes: [{ key, slots, itemId, prev }] }  (emitted BEFORE the
//            per-key 'change' events of a style switch, so the engine can stage a transition)

export function createStore({ catalog, layout, packs, styleId, stylepack, persist = true }) {
  if (!packs) packs = stylepack ? { [stylepack.id]: stylepack } : {};
  const packIds = Object.keys(packs);
  const byId = new Map(catalog.items.map((it) => [it.id, it]));
  const slotById = new Map(layout.slots.map((s) => [s.id, s]));
  const listeners = new Map();

  let active = packs[styleId] ? styleId : packIds[0];
  const selections = {}; // per pack id: { [key]: itemId }
  const defaultsOf = {}; // per pack id

  const keyOfSlotIn = (pack, slot) => {
    const ps = pack.slots || {};
    return (ps[slot.id] && slot.id) || (slot.group && ps[slot.group] && slot.group) || slot.type;
  };
  const slotByGroup = new Map();
  for (const s of layout.slots) if (s.group && !slotByGroup.has(s.group)) slotByGroup.set(s.group, s);
  const keyIn = (pack, x) => {
    if (x && typeof x === 'object') x = x.slotId || x.id || x.slotType;
    const slot = slotById.get(x) || slotByGroup.get(x);   // slot id or group name
    return slot ? keyOfSlotIn(pack, slot) : x;              // else: already a key / slot type
  };
  const slotsForKeyIn = (pack, key) => layout.slots.filter((s) => keyOfSlotIn(pack, s) === key);

  for (const id of packIds) {
    const sel = {}; const defs = {};
    for (const [key, cfg] of Object.entries(packs[id].slots || {})) {
      const def = byId.has(cfg.default) ? cfg.default : (cfg.options || []).find((o) => byId.has(o));
      if (def) { sel[key] = def; defs[key] = def; }
    }
    selections[id] = sel; defaultsOf[id] = defs;
  }

  // ---- persistence (best effort: storage may be unavailable) ----
  const storageKey = persist ? `villar:v2:${layout.id || 'layout'}` : null;
  if (storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.style && packs[saved.style]) active = saved.style;
      for (const [pid, s] of Object.entries(saved?.selections || {})) {
        const ps = packs[pid]?.slots; if (!ps) continue;
        for (const [key, itemId] of Object.entries(s)) if (ps[key]?.options?.includes(itemId) && byId.has(itemId)) selections[pid][key] = itemId;
      }
    } catch { /* ignore */ }
  }
  const save = () => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ v: 2, style: active, selections })); } catch { /* ignore */ }
  };

  // One failing listener must never stop the others (e.g. the 3D rebuild after a UI error).
  const emit = (evt, payload) => (listeners.get(evt) || []).forEach((fn) => {
    try { fn(payload); } catch (err) { console.error(`[store] '${evt}' listener failed`, err); }
  });

  const pack = () => packs[active];
  const sel = () => selections[active];
  const keyOf = (x) => keyIn(pack(), x);

  const store = {
    get state() { return { catalog, layout, packs, style: active, stylepack: pack(), selection: sel() }; },

    item(id) { return byId.get(id) || null; },
    keyOf,
    slotsFor(x) { return slotsForKeyIn(pack(), keyOf(x)).map((s) => s.id); },

    // ---------------- styles ----------------
    styleId() { return active; },
    style(id = active) { return packs[id] || null; },
    styles() { return packIds.map((id) => packs[id]); },

    /** Same-slot items offered by OTHER packs: [{ style, key, items[] }] (items already offered here excluded). */
    otherStyleOptions(x) {
      const slot = slotById.get(x && typeof x === 'object' ? x.slotId : x);
      const type = slot ? slot.type : x;
      const mine = new Set(store.options(x).map((i) => i.id));
      return packIds.filter((id) => id !== active).map((id) => {
        const p = packs[id];
        const key = slot ? keyOfSlotIn(p, slot) : type;
        const items = (p.slots?.[key]?.options || []).map((o) => byId.get(o)).filter((i) => i && !mine.has(i.id));
        return { style: p, key, items };
      }).filter((g) => g.items.length);
    },

    /** What switching to `styleId` (optionally keeping an anchor item) would select — without applying. */
    previewStyle(styleId, anchor) {
      const target = packs[styleId];
      if (!target) return null;
      // A style switch lands on the pack's curated set (designer-correct), plus the anchor and its pairings.
      const next = { ...defaultsOf[styleId] };
      let anchorKey = null;
      if (anchor?.itemId) {
        anchorKey = keyIn(target, anchor.slotId || anchor.key || store.item(anchor.itemId)?.type);
        if (target.slots?.[anchorKey]?.options?.includes(anchor.itemId)) {
          next[anchorKey] = anchor.itemId;
          const pairs = target.pairings?.[anchor.itemId] || {};
          for (const [k, id] of Object.entries(pairs)) if (target.slots?.[k]?.options?.includes(id)) next[k] = id;
        } else anchorKey = null;
      }
      const total = layout.slots.reduce((a, s) => a + (byId.get(next[keyOfSlotIn(target, s)])?.price || 0), 0);
      const changedSlots = layout.slots.filter((s) => sel()[keyOf(s.id)] !== next[keyOfSlotIn(target, s)]).map((s) => s.id);
      return { styleId, selection: next, total, delta: total - store.total(), changedSlots, anchorKey };
    },

    /** Switch the whole room to another style pack (keeping an optional anchor item). */
    setStyle(styleId, { anchor } = {}) {
      const pv = store.previewStyle(styleId, anchor);
      if (!pv) { console.warn(`[store] unknown style ${styleId}`); return false; }
      const prevStyle = active;
      const prevSel = { ...sel() };
      const prevKeyOfSlot = Object.fromEntries(layout.slots.map((s) => [s.id, keyOf(s.id)]));
      active = styleId;
      selections[styleId] = pv.selection;
      save();
      const changes = [];
      const seen = new Set();
      for (const s of layout.slots) {
        const key = keyOf(s.id);
        if (seen.has(key)) continue; seen.add(key);
        const slots = slotsForKeyIn(pack(), key);
        const prevItems = new Set(slots.map((x) => prevSel[prevKeyOfSlot[x.id]]));
        const itemId = pv.selection[key];
        if (prevItems.size !== 1 || !prevItems.has(itemId)) {
          changes.push({ key, slotType: s.type, slots: slots.map((x) => x.id), itemId, prev: [...prevItems][0] || null });
        }
      }
      emit('style', { styleId, prev: prevStyle, anchor: anchor || null, changes });
      for (const c of changes) emit('change', { ...c, reason: 'style' });
      return true;
    },

    // ---------------- selection within the active style ----------------
    /** Item currently chosen for a slot (id), group, key or type; null if the pack leaves it empty. */
    selected(x) { return byId.get(sel()[keyOf(x)]) || null; },

    /** Compatible alternatives in the active style (current one included), in pack order. */
    options(x) {
      const cfg = pack().slots?.[keyOf(x)];
      return cfg ? cfg.options.map((id) => byId.get(id)).filter(Boolean) : [];
    },

    select(x, itemId, { reason = 'user' } = {}) {
      const key = keyOf(x);
      const cfg = pack().slots?.[key];
      if (!cfg || !cfg.options.includes(itemId) || !byId.has(itemId)) {
        console.warn(`[store] ${itemId} is not a compatible option for ${key} in ${active}`);
        return false;
      }
      const prev = sel()[key];
      if (prev === itemId) return true;
      sel()[key] = itemId;
      save();
      const slots = slotsForKeyIn(pack(), key);
      emit('change', { key, slotType: slots[0]?.type || key, slots: slots.map((s) => s.id), itemId, prev, reason });
      return true;
    },

    /** True if the visitor changed anything from the active pack's defaults. */
    isCustomized() { const d = defaultsOf[active]; return Object.keys(d).some((k) => sel()[k] !== d[k]); },

    /** Restore the active pack's defaults (one change event per changed key). */
    reset() { for (const [key, def] of Object.entries(defaultsOf[active])) if (sel()[key] !== def) store.select(key, def, { reason: 'reset' }); },

    // ---------------- placements & budget ----------------
    /** Every concrete placement in the layout (grouped/attached slots included). */
    placed() {
      return layout.slots
        .map((slot) => { const key = keyOf(slot.id); return { slotId: slot.id, slotType: slot.type, key, item: byId.get(sel()[key]) || null }; })
        .filter((p) => p.item);
    },

    /** How many placements share this slot's choice (e.g. 2 for nightstands). */
    qty(x) { return slotsForKeyIn(pack(), keyOf(x)).length; },

    /** Live budget in AED. */
    total() { return store.placed().reduce((sum, p) => sum + (p.item.price || 0), 0); },

    /** Budget lines: one per selection key + item (qty × price); each line knows its slots. */
    lines() {
      const map = new Map();
      for (const p of store.placed()) {
        const id = `${p.key}|${p.item.id}`;
        const line = map.get(id) || { item: p.item, qty: 0, sum: 0, slotId: p.slotId, slotIds: [], key: p.key };
        line.qty += 1; line.sum += p.item.price; line.slotIds.push(p.slotId); map.set(id, line);
      }
      return [...map.values()];
    },

    /** Compact state for the AI assistant. */
    snapshot() { return { style: active, total: store.total(), selection: { ...sel() } }; },

    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
      return () => listeners.set(evt, listeners.get(evt).filter((f) => f !== fn));
    },
  };
  return store;
}
