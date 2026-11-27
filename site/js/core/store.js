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
// Empty slots: selection[key] === null means "not included" (budget slider / removed by the customer):
// nothing is rendered, priced or ordered there. The curated default room has no nulls.
// Pins: keys the customer chose by hand (reason 'user' | 'ai') are pinned per style; the budget planner
// (core/budget.js) plans around them and never changes them. See docs/BUDGET.md.
//
// Events:
//   'change' { key, slotType, slots: [slotIds], itemId|null, prev|null, reason }   (one per changed key)
//   'style'  { styleId, prev, anchor, changes: [{ key, slots, itemId, prev }] }  (emitted BEFORE the
//            per-key 'change' events of a style switch, so the engine can stage a transition)
//   'plan'   { reason, changes: [...] }  (emitted BEFORE the per-key 'change' events of applyPlan — a burst
//            from the budget slider; coalesce, stagger, re-bake once settled)
//   'pins'   { pins: [keys] }

export function createStore({ catalog, layout, packs, styleId, stylepack, persist = true }) {
  if (!packs) packs = stylepack ? { [stylepack.id]: stylepack } : {};
  const packIds = Object.keys(packs);
  const byId = new Map(catalog.items.map((it) => [it.id, it]));
  const slotById = new Map(layout.slots.map((s) => [s.id, s]));
  const listeners = new Map();

  let active = packs[styleId] ? styleId : packIds[0];
  const selections = {}; // per pack id: { [key]: itemId | null }
  const defaultsOf = {}; // per pack id
  const pinsOf = {};     // per pack id: Set of pinned keys

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
    selections[id] = sel; defaultsOf[id] = defs; pinsOf[id] = new Set();
  }

  // ---- persistence (best effort: storage may be unavailable). v3 adds nulls + pins; v2 still loads. ----
  const storageKey = persist ? `villar:v3:${layout.id || 'layout'}` : null;
  const legacyKey = persist ? `villar:v2:${layout.id || 'layout'}` : null;
  if (storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem(legacyKey) || 'null');
      if (saved?.style && packs[saved.style]) active = saved.style;
      for (const [pid, s] of Object.entries(saved?.selections || {})) {
        const ps = packs[pid]?.slots; if (!ps) continue;
        for (const [key, itemId] of Object.entries(s)) {
          if (itemId === null && saved.v >= 3 && ps[key]) selections[pid][key] = null;
          else if (ps[key]?.options?.includes(itemId) && byId.has(itemId)) selections[pid][key] = itemId;
        }
      }
      for (const [pid, keys] of Object.entries(saved?.pins || {})) {
        if (!pinsOf[pid] || !Array.isArray(keys)) continue;
        for (const k of keys) if (packs[pid].slots?.[k]) pinsOf[pid].add(k);
      }
    } catch { /* ignore */ }
  }
  const save = () => {
    if (!storageKey) return;
    const pins = Object.fromEntries(Object.entries(pinsOf).map(([pid, set]) => [pid, [...set]]));
    try { localStorage.setItem(storageKey, JSON.stringify({ v: 3, style: active, selections, pins })); } catch { /* ignore */ }
  };
  const validFor = (pid, key, itemId) => itemId === null ? !!packs[pid].slots?.[key] : !!(packs[pid].slots?.[key]?.options?.includes(itemId) && byId.has(itemId));

  // One failing listener must never stop the others (e.g. the 3D rebuild after a UI error).
  const emit = (evt, payload) => (listeners.get(evt) || []).forEach((fn) => {
    try { fn(payload); } catch (err) { console.error(`[store] '${evt}' listener failed`, err); }
  });

  const pack = () => packs[active];
  const sel = () => selections[active];
  const keyOf = (x) => keyIn(pack(), x);

  /** Apply a full selection for a pack (style switch or restore); emits 'style' then one 'change' per key. */
  function applyStyle(styleId, selection, { anchor = null, reason = 'style' } = {}) {
    const prevStyle = active;
    const prevSel = { ...sel() };
    const prevKeyOfSlot = Object.fromEntries(layout.slots.map((s) => [s.id, keyOf(s.id)]));
    active = styleId;
    selections[styleId] = selection;
    save();
    const changes = [];
    const seen = new Set();
    for (const s of layout.slots) {
      const key = keyOf(s.id);
      if (seen.has(key)) continue; seen.add(key);
      const slots = slotsForKeyIn(pack(), key);
      const prevItems = new Set(slots.map((x) => prevSel[prevKeyOfSlot[x.id]]));
      const itemId = selection[key];
      if (prevItems.size !== 1 || !prevItems.has(itemId)) {
        changes.push({ key, slotType: s.type, slots: slots.map((x) => x.id), itemId, prev: [...prevItems][0] || null });
      }
    }
    emit('style', { styleId, prev: prevStyle, anchor, changes, reason });
    for (const c of changes) emit('change', { ...c, reason });
    return true;
  }

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
    previewStyle(styleId, anchor, { fresh = false } = {}) {
      const target = packs[styleId];
      if (!target) return null;
      // A style switch lands on that pack's set as the customer last left it (its curated defaults if never
      // touched — designer-correct), plus the anchor and its pairings. Going away and back never loses picks.
      // `fresh` = the curated set only (the AI's predictions in ai/core.js assume it, so its totals stay exact).
      const next = fresh ? { ...defaultsOf[styleId] } : { ...defaultsOf[styleId], ...selections[styleId] };
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
    setStyle(styleId, { anchor, fresh = false, selection = null } = {}) {
      // `selection`: land on exactly this room (e.g. the target style's budget-ladder step at the customer's budget,
      // PT4-02) — validated per key (nulls allowed), the rest from that style's set. One 'style' transition.
      if (selection && packs[styleId]) {
        const next = { ...defaultsOf[styleId], ...selections[styleId] };
        for (const [k, id] of Object.entries(selection)) if (validFor(styleId, k, id)) next[k] = id;
        return applyStyle(styleId, next, { anchor: null });
      }
      const pv = store.previewStyle(styleId, anchor, { fresh });
      if (!pv) { console.warn(`[store] unknown style ${styleId}`); return false; }
      // A fresh (curated) landing also clears that style's pins — they belonged to picks that are gone (R4-11).
      // snapshot()/restore() carry pins, so Undo still brings them back.
      if (fresh && pinsOf[styleId]?.size) pinsOf[styleId].clear();
      return applyStyle(styleId, pv.selection, { anchor: anchor || null });
    },

    /**
     * Put back an exact earlier state from snapshot() — style and every pick — e.g. "Undo" after a style switch.
     * Emits the same 'style'/'change' events as setStyle/select (reason 'restore') so the 3D follows.
     */
    restore(snap) {
      if (!snap || !packs[snap.style]) return false;
      // Other styles' remembered picks (snapshot().memory), e.g. undoing an AI switch that reset a style to its set.
      if (snap.memory && typeof snap.memory === 'object') {
        for (const [pid, m] of Object.entries(snap.memory)) {
          if (pid === snap.style || !packs[pid] || !m || typeof m !== 'object') continue;
          const pslots = packs[pid].slots || {};
          const keep = { ...defaultsOf[pid] };
          for (const [k, id] of Object.entries(m)) if (pslots[k] && validFor(pid, k, id)) keep[k] = id;
          selections[pid] = keep;
        }
        save();
      }
      if (snap.pins && typeof snap.pins === 'object') {
        for (const [pid, keys] of Object.entries(snap.pins)) if (pinsOf[pid] && Array.isArray(keys)) pinsOf[pid] = new Set(keys.filter((k) => packs[pid].slots?.[k]));
        save(); emit('pins', { pins: [...pinsOf[active]] });
      }
      const next = { ...defaultsOf[snap.style], ...selections[snap.style] };
      for (const [k, id] of Object.entries(snap.selection || {})) if (validFor(snap.style, k, id)) next[k] = id;
      if (snap.style === active) {
        const diff = Object.fromEntries(Object.entries(next).filter(([k, id]) => sel()[k] !== id));
        if (Object.keys(diff).length) store.applyPlan(diff, { reason: 'restore' });
        return true;
      }
      return applyStyle(snap.style, next, { anchor: null, reason: 'restore' });
    },

    // ---------------- selection within the active style ----------------
    /** Item currently chosen for a slot (id), group, key or type; null if the pack leaves it empty. */
    selected(x) { return byId.get(sel()[keyOf(x)]) || null; },

    /** Compatible alternatives in the active style (current one included), in pack order. */
    options(x) {
      const cfg = pack().slots?.[keyOf(x)];
      return cfg ? cfg.options.map((id) => byId.get(id)).filter(Boolean) : [];
    },

    /** Choose an item for a key (itemId null = remove it from the room). 'user'/'ai' picks are pinned. */
    select(x, itemId, { reason = 'user' } = {}) {
      const key = keyOf(x);
      if (itemId === undefined || !validFor(active, key, itemId)) {
        console.warn(`[store] ${itemId} is not a compatible option for ${key} in ${active}`);
        return false;
      }
      if ((reason === 'user' || reason === 'ai') && !pinsOf[active].has(key)) { pinsOf[active].add(key); emit('pins', { pins: [...pinsOf[active]] }); }
      const prev = sel()[key] ?? null;
      if (prev === itemId) { save(); return true; }
      sel()[key] = itemId;
      save();
      const slots = slotsForKeyIn(pack(), key);
      emit('change', { key, slotType: slots[0]?.type || key, slots: slots.map((s) => s.id), itemId, prev, reason });
      return true;
    },

    /**
     * Set many keys at once (nulls allowed) — the budget slider. Emits 'plan' with every change, then one
     * 'change' per changed key (same reason). Invalid entries are ignored. Does not pin.
     */
    applyPlan(selection, { reason = 'budget' } = {}) {
      const changes = [];
      for (const [key, itemId] of Object.entries(selection || {})) {
        if (itemId === undefined || !validFor(active, key, itemId)) continue;
        const prev = sel()[key] ?? null;
        if (prev === itemId) continue;
        sel()[key] = itemId;
        const slots = slotsForKeyIn(pack(), key);
        changes.push({ key, slotType: slots[0]?.type || key, slots: slots.map((s) => s.id), itemId, prev });
      }
      if (!changes.length) return [];
      save();
      emit('plan', { reason, changes });
      for (const c of changes) emit('change', { ...c, reason });
      return changes;
    },

    /** Is anything placed for this slot / key? */
    included(x) { return sel()[keyOf(x)] != null; },

    // ---------------- pins (customer's own picks; the budget planner keeps them) ----------------
    pins() { return [...pinsOf[active]]; },
    isPinned(x) { return pinsOf[active].has(keyOf(x)); },
    pin(x) { const k = keyOf(x); if (!pack().slots?.[k] || pinsOf[active].has(k)) return; pinsOf[active].add(k); save(); emit('pins', { pins: store.pins() }); },
    unpin(x) { const k = keyOf(x); if (!pinsOf[active].delete(k)) return; save(); emit('pins', { pins: store.pins() }); },
    /** The curated (designer) default for a key in the active style. */
    defaultOf(x) { return byId.get(defaultsOf[active][keyOf(x)]) || null; },

    /** True if the visitor changed anything from the active pack's defaults. */
    isCustomized() { const d = defaultsOf[active]; return Object.keys(d).some((k) => sel()[k] !== d[k]); },

    /** Restore the active pack's defaults and clear its pins (one 'plan' + change events). */
    reset() {
      if (pinsOf[active].size) { pinsOf[active].clear(); emit('pins', { pins: [] }); }
      const diff = Object.fromEntries(Object.entries(defaultsOf[active]).filter(([k, d]) => sel()[k] !== d));
      if (Object.keys(diff).length) store.applyPlan(diff, { reason: 'reset' }); else save();
    },

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
    snapshot() {
      const memory = {};
      for (const [pid, m] of Object.entries(selections)) memory[pid] = { ...m };
      const pins = Object.fromEntries(Object.entries(pinsOf).map(([pid, set]) => [pid, [...set]]));
      return { style: active, total: store.total(), selection: { ...sel() }, memory, pins };
    },

    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
      return () => listeners.set(evt, listeners.get(evt).filter((f) => f !== fn));
    },
  };
  return store;
}
