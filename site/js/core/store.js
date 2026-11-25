// Villar selection store — single source of truth for what is placed in the apartment.
// Owner: coordinator. Engine and UI subscribe; neither mutates state directly.
//
// Selection is kept per *key*. A slot's key is resolved as:
//   1. its slot id, if the style pack defines `slots[slotId]` (per-placement choice, e.g. each wall art)
//   2. its group, if the pack defines `slots[group]` (shared choice, e.g. both nightstands)
//   3. its slot type (shared by every slot of that type — the default)
// Every API below accepts a slot id, a group, a key or a slot type.

export function createStore({ catalog, stylepack, layout }) {
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

  for (const [key, cfg] of Object.entries(packSlots)) {
    const def = byId.has(cfg.default) ? cfg.default : (cfg.options || []).find((id) => byId.has(id));
    if (def) selection[key] = def;
  }

  const emit = (evt, payload) => (listeners.get(evt) || []).forEach((fn) => fn(payload));

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
      const slots = slotsForKey(key);
      emit('change', { key, slotType: slots[0]?.type || key, slots: slots.map((s) => s.id), itemId, prev });
      return true;
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

    /** Budget grouped by item (quantity × price), for the itemized list. */
    lines() {
      const map = new Map();
      for (const p of store.placed()) {
        const line = map.get(p.item.id) || { item: p.item, qty: 0, sum: 0, slotId: p.slotId, key: p.key };
        line.qty += 1; line.sum += p.item.price; map.set(p.item.id, line);
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
