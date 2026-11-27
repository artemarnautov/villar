// Walk the room (docs/FOCUS.md §4): the order behind ‹ ›, [ ] and the header swipe. Owner: interface.
// Until the engine ships villar.focusNext(dir), the UI decides: the items that were on screen when focus was
// entered, left to right; then the rest zone by zone (the entry item's zone first), each swept left to right.
// One stop per choice: both nightstands share one pick, so they are one stop. It wraps within the room.
import { zones, zoneOf } from './labels.js';

/**
 * @param {object} o
 * @param {object} o.store
 * @param {(slotIds: string[]) => object|null} o.project  stage.project — { slotId: { x, angle, visible } } or null
 * @param {string} o.entry  the slot focus was entered on
 * @returns {{ order: string[], step(from: string, dir: 1|-1): string|null, position(slotId): { i: number, n: number } }}
 */
export function createWalk({ store, project, entry }) {
  const placed = store.placed();
  const proj = (() => { try { return project?.(placed.map((p) => p.slotId)) || null; } catch { return null; } })();
  const layoutIndex = new Map(store.state.layout.slots.map((s, i) => [s.id, i]));
  const ZONES = zones().map((z) => z.id);

  // one representative slot per selection key: the entry slot, else the leftmost on screen, else the first
  const reps = new Map();
  for (const p of placed) {
    const info = proj?.[p.slotId] || null;
    const cur = reps.get(p.key);
    const better = !cur
      || p.slotId === entry
      || (cur.slotId !== entry && info && (!cur.info || (info.visible && !cur.info.visible) || (info.visible === cur.info.visible && info.angle < cur.info.angle)));
    if (better) reps.set(p.key, { ...p, info, zone: zoneOf(p.slotId, p.slotType) });
  }
  const all = [...reps.values()];
  const sweep = (a, b) => (a.info && b.info ? a.info.angle - b.info.angle : (layoutIndex.get(a.slotId) ?? 0) - (layoutIndex.get(b.slotId) ?? 0));
  // the item the customer just tapped was on screen, even when its centre projects past the edge (a long sofa)
  const xOf = (r) => (r.info ? Math.max(-1, Math.min(1, r.info.x)) : -1);
  const onScreen = all.filter((r) => r.info?.visible || r.slotId === entry).sort((a, b) => xOf(a) - xOf(b));
  const seen = new Set(onScreen.map((r) => r.key));
  const entryZone = all.find((r) => r.slotId === entry)?.zone || ZONES[0];
  const z0 = Math.max(0, ZONES.indexOf(entryZone));
  const rest = [];
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[(z0 + i) % ZONES.length];
    rest.push(...all.filter((r) => r.zone === z && !seen.has(r.key)).sort(sweep));
  }
  for (const r of all) if (!seen.has(r.key) && !rest.includes(r)) rest.push(r); // zones the list doesn't know
  const order = [...onScreen, ...rest].map((r) => r.slotId);
  const keyOfSlot = new Map([...reps.values()].map((r) => [r.slotId, r.key]));

  const indexOf = (slotId) => {
    const i = order.indexOf(slotId);
    if (i >= 0) return i;
    const key = store.keyOf(slotId);
    return order.findIndex((id) => keyOfSlot.get(id) === key);
  };
  return {
    order,
    /** The next stop in `dir` that is still in the room (removed items are skipped). */
    step(from, dir) {
      if (!order.length) return null;
      let i = indexOf(from);
      if (i < 0) i = dir > 0 ? -1 : 0;
      for (let k = 0; k < order.length; k++) {
        i = (i + dir + order.length) % order.length;
        const id = order[i];
        if (id !== from && store.included(id)) return id;
      }
      return null;
    },
    position(slotId) {
      const live = order.filter((id) => store.included(id));
      const key = store.keyOf(slotId);
      const i = live.findIndex((id) => id === slotId || keyOfSlot.get(id) === key);
      return { i: i + 1, n: live.length };
    },
  };
}
