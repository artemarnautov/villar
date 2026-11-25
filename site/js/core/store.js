// Villar selection store — single source of truth for what is placed in the apartment.
// Owner: coordinator. Engine and UI subscribe; neither mutates state directly.

export function createStore({ catalog, stylepack, layout }) {
  const byId = new Map(catalog.items.map((it) => [it.id, it]));
  const listeners = new Map();
  const selection = {};

  for (const [type, cfg] of Object.entries(stylepack.slots || {})) {
    const def = byId.has(cfg.default) ? cfg.default : (cfg.options || []).find((id) => byId.has(id));
    if (def) selection[type] = def;
  }

  const emit = (evt, payload) => (listeners.get(evt) || []).forEach((fn) => fn(payload));

  const store = {
    state: { catalog, stylepack, layout, selection },

    item(id) { return byId.get(id) || null; },

    /** Item currently chosen for a slot type, or null if the pack leaves it empty. */
    selected(type) { return byId.get(selection[type]) || null; },

    /** Compatible alternatives for a slot type, in stylepack order (current one included). */
    options(type) {
      const cfg = stylepack.slots?.[type];
      return cfg ? cfg.options.map((id) => byId.get(id)).filter(Boolean) : [];
    },

    select(type, itemId) {
      const cfg = stylepack.slots?.[type];
      if (!cfg || !cfg.options.includes(itemId) || !byId.has(itemId)) {
        console.warn(`[store] ${itemId} is not a compatible option for ${type}`);
        return false;
      }
      const prev = selection[type];
      if (prev === itemId) return true;
      selection[type] = itemId;
      emit('change', { slotType: type, itemId, prev });
      return true;
    },

    /** Every concrete placement in the layout (grouped/attached slots included). */
    placed() {
      return layout.slots
        .map((slot) => ({ slotId: slot.id, slotType: slot.type, item: byId.get(selection[slot.type]) || null }))
        .filter((p) => p.item);
    },

    /** Live budget in AED. */
    total() { return store.placed().reduce((sum, p) => sum + (p.item.price || 0), 0); },

    /** Budget grouped by item (quantity × price), for the itemized list. */
    lines() {
      const map = new Map();
      for (const p of store.placed()) {
        const line = map.get(p.item.id) || { item: p.item, qty: 0, sum: 0 };
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
