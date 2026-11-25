// Villar selection store — single source of truth for what is placed in the apartment.
// Owner: coordinator. Engine and UI subscribe; neither mutates state directly.
//
// Selection is kept per *key*. A slot's key is resolved as:
//   1. its slot id, if the style pack defines `slots[slotId]` (per-placement choice, e.g. each wall art)
//   2. its group, if the pack defines `slots[group]` (shared choice, e.g. both nightstands)
//   3. its slot type (shared by every slot of that type — the default)
// Every API below accepts a slot id, a group, a key or a slot type.

export function createStore({ catalog, stylepack, layout, persist = true }) {
  const byId = new Map(catalog.items.map((it) => [it.id, it]));
  const slotById = new Map(layout.slots.map((s) => [s.id, s]));
  const packSlots = stylepack.slots || {};
  const listeners = new Map();
  const selection = {};

  const keyOfSlot = (slot) =>
    (packSlots[slot.id] && slot.id) || (slot.group && packSlots[slot.group] && slot.group) || slot.type;

  /** Resolve a slot id / group / key / type to the selection key. */
  const keyOf = (x) => {
    if (x && typeof x === 'object') x = x.slotId || x.id || x.slotType;
    const slot = slotById.get(x);
    return slot ? keyOfSlot(slot) : x;
  };

  const slotsForKey = (key) => layout.slots.filter((s) => keyOfSlot(s) === key);

  const defaults = {};
  for (const [key, cfg] of Object.entries(packSlots)) {
    const def = byId.has(cfg.default) ? cfg.default : (cfg.options || []).find((id) => byId.has(id));
    if (def) { selection[key] = def; defaults[key] = def; }
  }

  // Persist the visitor's choices per style pack + layout (best effort: storage may be unavailable).
  const storageKey = persist ? `villar:selection:${stylepack.id || 'pack'}:${layout.id || 'layout'}` : null;
  if (storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      for (const [key, id] of Object.entries(saved?.selection || {})) {
        if (packSlots[key]?.options?.includes(id) && byId.has(id)) selection[key] = id;
      }
    } catch { /* ignore */ }
  }
  const save = () => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ v: 1, selection })); } catch { /* ignore */ }
  };

  // One failing listener must never stop the others (e.g. the 3D rebuild after a UI error).
  const emit = (evt, payload) => (listeners.get(evt) || []).forEach((fn) => {
    try { fn(payload); } catch (err) { console.error(`[store] '${evt}' listener failed`, err); }
  });

  const store = {
    state: { catalog, stylepack, layout, selection },

    item(id) { return byId.get(id) || null; },
    keyOf,
    slotsFor(x) { return slotsForKey(keyOf(x)).map((s) => s.id); },

    /** Item currently chosen for a slot (id), group, key or type; null if the pack leaves it empty. */
    selected(x) { return byId.get(selection[keyOf(x)]) || null; },

    /** Compatible alternatives (current one included), in style-pack order. */
    options(x) {
      const cfg = packSlots[keyOf(x)];
      return cfg ? cfg.options.map((id) => byId.get(id)).filter(Boolean) : [];
    },

    select(x, itemId) {
      const key = keyOf(x);
      const cfg = packSlots[key];
      if (!cfg || !cfg.options.includes(itemId) || !byId.has(itemId)) {
        console.warn(`[store] ${itemId} is not a compatible option for ${key}`);
        return false;
      }
      const prev = selection[key];
      if (prev === itemId) return true;
      selection[key] = itemId;
      save();
      const slots = slotsForKey(key);
      emit('change', { key, slotType: slots[0]?.type || key, slots: slots.map((s) => s.id), itemId, prev });
      return true;
    },

    /** True if the visitor changed anything from the style pack defaults. */
    isCustomized() { return Object.keys(defaults).some((k) => selection[k] !== defaults[k]); },

    /** Restore the style pack defaults (emits one change event per changed key). */
    reset() {
      for (const [key, def] of Object.entries(defaults)) if (selection[key] !== def) store.select(key, def);
    },

    /** Every concrete placement in the layout (grouped/attached slots included). */
    placed() {
      return layout.slots
        .map((slot) => {
          const key = keyOfSlot(slot);
          return { slotId: slot.id, slotType: slot.type, key, item: byId.get(selection[key]) || null };
        })
        .filter((p) => p.item);
    },

    /** How many placements share this slot's choice (e.g. 2 for nightstands). */
    qty(x) { return slotsForKey(keyOf(x)).length; },

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

    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
      return () => listeners.set(evt, listeners.get(evt).filter((f) => f !== fn));
    },
  };
  return store;
}
