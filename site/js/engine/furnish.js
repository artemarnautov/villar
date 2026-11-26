// Villar engine — places catalog items into layout slots and swaps them on store changes.
// Owner: engine.
//
// Placement contract (SPEC): generator origin = bottom-centre of footprint, front +Z.
//   floor items: origin at slot.pos, rotY around +Y;  attach: parent anchor + offset (parent frame);
//   pendant: origin = ceiling mount point; wall_art: origin = back-centre on the wall;
//   curtains: bottom-centre at the floor.
import * as THREE from 'three';
import { DEG, clamp, disposeObject } from './util.js';
import { ensureBVH } from './interaction.js';

const NO_COLLIDE = new Set(['rug', 'runner', 'curtains', 'wall_art', 'mirror', 'pendant_lamp', 'cushions', 'decor_set', 'mattress', 'bedding', 'table_lamp', 'throw', 'tableware', 'centerpiece', 'kitchen_decor', 'nightstand_decor']);
// Lamp light calibration: furniture `intensity: 1` → candela in scene units (see lighting.js).
export const LAMP_CANDELA = 2.2;

// point lights a decor slot always carries (candle flames; unused ones at intensity 0) → constant light count
const FLAME_PAD = { centerpiece: 3, nightstand_decor: 1, decor_set: 1 };
const FLAT = new Set(['rug', 'runner']);

export function createFurnisher({ layout, store, materials, buildItem, releaseItem = null, quality = 'high', maxLampShadows = 2 }) {
  const root = new THREE.Group();
  root.name = 'furniture';
  const slots = layout.slots;
  const byId = new Map(slots.map((s) => [s.id, s]));
  const placed = new Map(); // slotId → { slot, item, group, lights: [] }

  const children = (slotId) => slots.filter((s) => s.attach && s.attach.slot === slotId);
  function descendants(ids) {
    const out = []; const seen = new Set(ids);
    const queue = [...ids];
    while (queue.length) {
      const id = queue.shift();
      for (const c of children(id)) if (!seen.has(c.id)) { seen.add(c.id); out.push(c.id); queue.push(c.id); }
    }
    return out;
  }
  /** Slots sorted so parents come before attached children. */
  function ordered(ids) {
    const set = new Set(ids), out = [], done = new Set();
    const visit = (id) => {
      if (done.has(id)) return; done.add(id);
      const s = byId.get(id);
      if (s?.attach && set.has(s.attach.slot)) visit(s.attach.slot);
      if (s?.align && set.has(s.align.to)) visit(s.align.to);
      out.push(id);
    };
    ids.forEach(visit);
    return out;
  }

  /**
   * Lamp light model. The modeler exports `userData.lights` ({type, position, color, intensity,
   * angle [rad], penumbra, target, distance, shadow}); `intensity` is the share of a 1 ≈ 40 W bulb.
   * Shaded lamps arrive as down spot (70 %, shadow) + up spot (30 %) + glow point (10 %); a globe as
   * one point. Spot candela conserve the bulb's flux: cd = share · 2·I / (1 − cos θ).
   * Every lamp slot is normalised to the SAME light set — 2 spots (down, up) + 1 point — with unused
   * members at intensity 0 (globe → wide down + up spot), so swaps never change shader light counts.
   * Shadows: only the `shadow: true` down spot is a candidate; the engine enables at most N of them.
   */
  function makeLights(group, slot, item) {
    const list = [];
    const add = (light, { shadowPriority = 0 } = {}) => {
      light.castShadow = false;
      light.userData.lampLight = true;
      light.userData.baseIntensity = light.intensity;
      light.userData.shadowPriority = shadowPriority;
      light.name = 'lamp-light';
      group.add(light);
      if (light.target) group.add(light.target);
      list.push(light);
      return light;
    };
    const spot = (color, cd, pos, dir, angle, penumbra, distance) => {
      const a = clamp(angle, 5 * DEG, 89 * DEG);
      const l = new THREE.SpotLight(color, cd, distance, a, clamp(penumbra, 0, 1), 2);
      l.position.set(...pos);
      l.target.position.set(pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2]);
      l.shadow.camera.near = 0.12; // past the shade lining: no rim acne, the shade never shadows its own lamp
      l.shadow.focus = clamp(65 * DEG / a, 0.5, 1); // wide globes: keep shadow texels usable
      l.radius = 0.04; // soft source for the path tracer
      return l;
    };
    const spotCd = (share, bulb, angle) => share * 2 * bulb / Math.max(0.05, 1 - Math.cos(clamp(angle, 5 * DEG, 89 * DEG)));
    const type = slot.type;
    const Ls = group.userData.lights || [];
    if (!Ls.length) return list;
    const isLamp = type === 'table_lamp' || type === 'floor_lamp' || type === 'pendant_lamp';
    if (isLamp) {
      const prio = type === 'pendant_lamp' ? 3 : type === 'floor_lamp' ? 2 : 1;
      const first = Ls[0];
      const color = new THREE.Color(first.color || '#ffd2a1');
      const pos = first.position;
      const total = Ls.reduce((s, L) => s + (L.intensity ?? 1), 0);   // bulb in "40 W" units
      const bulb = total * LAMP_CANDELA;
      const dist = Math.max(0, ...Ls.map((L) => L.distance ?? 0));
      const dir = (L) => { const t = L.target || [L.position[0], L.position[1] - 1, L.position[2]]; return [t[0] - L.position[0], t[1] - L.position[1], t[2] - L.position[2]]; };
      const spots = Ls.filter((L) => L.type === 'spot');
      let down = spots.find((L) => dir(L)[1] < 0), up = spots.find((L) => dir(L)[1] > 0);
      const points = Ls.filter((L) => L.type !== 'spot');
      if (!spots.length) {
        // globe / bare bulb (or a legacy single point): wide down + up spots + glow, same flux
        const P = points[0];
        down = { position: P.position, angle: 85 * DEG, penumbra: 0.9, share: 0.55, shadow: P.shadow === true, dir: [0, -1, 0] };
        up = { position: P.position, angle: 80 * DEG, penumbra: 0.9, share: 0.3, dir: [0, 1, 0] };
        add(spot(color, spotCd(0.55, bulb, down.angle), P.position, down.dir, down.angle, down.penumbra, dist), { shadowPriority: down.shadow ? prio : 0 });
        add(spot(color, spotCd(0.3, bulb, up.angle), P.position, up.dir, up.angle, up.penumbra, dist));
        add(new THREE.PointLight(color, bulb * 0.15, dist, 2)).position.set(...P.position);
      } else {
        const share = (L) => (L.intensity ?? 1) / Math.max(1e-6, total);
        if (down) add(spot(color, spotCd(share(down), bulb, down.angle ?? 55 * DEG), down.position, dir(down), down.angle ?? 55 * DEG, down.penumbra ?? 0.35, down.distance ?? dist), { shadowPriority: down.shadow ? prio : 0 });
        else add(spot(color, 0, pos, [0, -1, 0], 55 * DEG, 0.35, dist));
        if (up) add(spot(color, spotCd(share(up), bulb, up.angle ?? 45 * DEG), up.position, dir(up), up.angle ?? 45 * DEG, up.penumbra ?? 0.4, up.distance ?? dist));
        else add(spot(color, 0, pos, [0, 1, 0], 45 * DEG, 0.4, dist));
        const P = points[0];
        add(new THREE.PointLight(color, P ? share(P) * bulb : 0, P?.distance ?? dist, 2)).position.set(...(P?.position || pos));
      }
    } else {
      const pad = quality === 'high' ? (FLAME_PAD[type] ?? null) : 0;
      const points = Ls.filter((L) => L.type !== 'spot');
      for (const L of Ls.filter((q) => q.type === 'spot')) {
        const color = new THREE.Color(L.color || '#ffd8a8');
        const I = (L.intensity ?? 1) * LAMP_CANDELA;
        const pos = L.position, dist = L.distance ?? 0;
        const t = L.target || [pos[0], pos[1] - 1, pos[2]];
        const a = L.angle ?? 60 * DEG;
        add(spot(color, spotCd(1, I, a), pos, [t[0] - pos[0], t[1] - pos[1], t[2] - pos[2]], a, L.penumbra ?? 0.6, dist), { shadowPriority: L.shadow === true ? 1 : 0 });
      }
      const n = pad === null ? points.length : pad;
      for (let i = 0; i < n; i++) {
        const L = points[i];
        let I = L ? (L.intensity ?? 1) * LAMP_CANDELA : 0;
        if (L && i === n - 1) for (let k = n; k < points.length; k++) I += (points[k].intensity ?? 1) * LAMP_CANDELA; // merge extras
        const pl = add(new THREE.PointLight(new THREE.Color(L?.color || '#ffb46b'), I, L?.distance ?? 2.5, 2));
        pl.position.set(...(L?.position || [0, 0.2, 0]));
        if (L?.flame) pl.userData.flame = true;
      }
    }
    // the lamp's own emitters (shade, bulb) must not shadow their own light
    group.traverse((o) => { if (o.isMesh && o.material && (o.material.userData?.glow || /shade|bulb/.test(o.material.name || ''))) o.userData.noCastShadow = true; });
    return list;
  }

  /** Pick the `max` highest-priority shadow candidates (constant count → no recompiles on swaps). */
  function assignLampShadows(max) {
    const lights = [...placed.values()].flatMap((r) => r.lights).filter((l) => l.userData.shadowPriority > 0);
    lights.sort((a, b) => b.userData.shadowPriority - a.userData.shadowPriority);
    lights.forEach((l, i) => {
      const on = i < max;
      l.castShadow = on;
      if (on) {
        l.shadow.mapSize.set(1024, 1024);
        l.shadow.bias = -0.0006; l.shadow.normalBias = 0.02; l.shadow.radius = 4;
      }
    });
  }

  // ---------------------------------------------------------------- build / cache
  // Built groups are cached per slot + item (LRU), so swapping back, pre-built alternatives and
  // style switches re-use geometry, BVHs and lights instead of regenerating them.
  const cache = new Map(); // `${slotId}|${itemId}` → rec (detached)
  const CACHE_MAX = 28;
  const hostOf = (slotId) => { const s = byId.get(slotId); return s?.attach ? (placed.get(s.attach.slot)?.item.id || '-') : ''; };
  const cacheKey = (slotId, itemId, host = hostOf(slotId)) => `${slotId}|${itemId}|${host}`;
  function cachePut(rec) {
    const k = cacheKey(rec.slot.id, rec.item.id, rec.host);
    if (cache.has(k)) { if (cache.get(k) !== rec) disposeRec(rec); return; }
    cache.set(k, rec);
    while (cache.size > CACHE_MAX) {
      const [oldK, oldRec] = cache.entries().next().value;
      cache.delete(oldK); disposeRec(oldRec);
    }
  }
  function cacheTake(slotId, itemId) {
    const k = cacheKey(slotId, itemId);
    const rec = cache.get(k);
    if (rec) cache.delete(k);
    return rec || null;
  }
  function disposeRec(rec) {
    // engine-made lights first (shadow maps), then hand the model back to the modeler's cache
    for (const l of rec.lights) { l.removeFromParent(); l.target?.removeFromParent(); l.dispose?.(); }
    if (releaseItem) { try { releaseItem(rec.group); return; } catch (e) { console.debug('[villar] releaseItem failed', e); } }
    disposeObject(rec.group, { isShared: (m) => !!m.userData?.materialKey });
  }

  /** Build (or take from the cache) the group for slot + item. Not placed, not in the scene. */
  function make(slot, item) {
    const hit = cacheTake(slot.id, item.id);
    if (hit) return hit;
    const parentRec = slot.attach ? placed.get(slot.attach.slot) : null;
    const ctx = { materials, quality };
    if (parentRec) ctx.host = parentRec.group.userData.anchorInfo?.[slot.attach.anchor] || null;
    if (slot.type === 'curtains') ctx.span = slot.max?.w || null;
    // items that lay themselves out inside their dims (kitchen decor) get the slot's free space
    let it = item;
    if (slot.type === 'kitchen_decor' && slot.max && item.dims) it = { ...item, dims: { ...item.dims, w: Math.min(item.dims.w, slot.max.w * 100), d: Math.min(item.dims.d, slot.max.d * 100) } };
    let group;
    try { group = buildItem(it, ctx); }
    catch (e) { console.error(`[villar] failed to build ${item.id} for slot ${slot.id}`, e); return null; }
    if (!group) return null;
    group.name = `slot:${slot.id}`;
    if (slot.max && item.dims) {
      const d = item.dims;
      const over = ['w', 'd', 'h'].filter((k) => slot.max[k] !== undefined && d[k] / 100 > slot.max[k] + 1e-6);
      if (over.length) console.debug(`[villar] ${item.id} exceeds slot ${slot.id} max on ${over.join(',')}`, d, slot.max);
    }
    group.userData.slotId = slot.id;
    group.userData.slotType = slot.type;
    group.traverse((o) => {
      o.userData.slotId = slot.id;
      o.userData.slotType = slot.type;
      if (o.isMesh) { o.castShadow = !o.userData.noCastShadow; o.receiveShadow = true; }
    });
    const lights = makeLights(group, slot, item);
    group.traverse((o) => { if (o.isMesh && o.userData.noCastShadow) o.castShadow = false; });
    ensureBVH(group);
    return { slot, item, group, lights, baseScaleY: group.scale.y, host: hostOf(slot.id) };
  }

  /** Position a rec in its slot (attach slots follow their parent's current anchors). */
  function place(rec) {
    const { slot, group } = rec;
    group.scale.y = rec.baseScaleY ?? 1;
    if (slot.attach) {
      const parentRec = placed.get(slot.attach.slot);
      if (!parentRec) return false;
      const pg = parentRec.group;
      pg.updateMatrixWorld(true);
      const anchors = pg.userData.anchors || {};
      let a = anchors[slot.attach.anchor];
      if (!a) {
        const bb = new THREE.Box3().setFromObject(pg);
        a = new THREE.Vector3(0, bb.max.y - pg.position.y, 0);
        console.debug(`[villar] slot ${slot.attach.slot} has no anchor "${slot.attach.anchor}", using bbox top`);
      }
      const local = (a.isVector3 ? a.clone() : new THREE.Vector3(...a)).add(new THREE.Vector3(...(slot.attach.offset || [0, 0, 0])));
      group.position.copy(pg.localToWorld(local));
      group.quaternion.copy(pg.quaternion);
      if (slot.rotY) group.rotateY(slot.rotY * DEG);
    } else {
      group.position.set(...slot.pos);
      group.rotation.set(0, (slot.rotY || 0) * DEG, 0);
      if (group.userData.mount === 'leaning') group.position.y = 0; // leaning mirror: stands on the floor
      align(rec);
      clampToRoom(rec);
    }
    // nothing may poke through the ceiling: curtains (and any too-tall floor item) are clamped
    // to the room height; ceiling-mounted items hang from the mount point and are left alone
    if (slot.mount !== 'ceiling' || slot.type === 'curtains') {
      group.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(group);
      const ceil = (layout.size?.ceiling || 2.85) - 0.012;
      if (bb.max.y > ceil && bb.max.y - bb.min.y > 0.05) {
        const base = group.position.y;
        const k = (ceil - base) / (bb.max.y - base);
        if (k > 0.5) { group.scale.y *= k; if (slot.type !== 'curtains') console.debug(`[villar] ${rec.item.id} clamped to ceiling (×${k.toFixed(2)})`); }
      }
    }
    group.updateMatrixWorld(true);
    return true;
  }

  // ---------------------------------------------------------------- clearances (QA-06 / QA-07)
  const curtainSlot = slots.find((q) => q.type === 'curtains');
  const curtainBox = curtainSlot ? { x0: curtainSlot.pos[0] - (curtainSlot.max?.w || 3.8) / 2, x1: curtainSlot.pos[0] + (curtainSlot.max?.w || 3.8) / 2, z0: curtainSlot.pos[2] - (curtainSlot.max?.d || 0.15) / 2 } : null;
  const boundsOf = (group) => {
    group.updateMatrixWorld(true);
    const rot = Math.abs(Math.sin(2 * group.rotation.y)) > 1e-3; // not axis-aligned → exact hull
    return new THREE.Box3().setFromObject(group, rot);
  };
  /** Keep a real gap to the item of another slot (e.g. coffee table ↔ sofa ≥ 45 cm). */
  function align(rec) {
    const a = rec.slot.align;
    const to = a && placed.get(a.to);
    if (!to) return;
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(to.group.quaternion);
    const bt = boundsOf(to.group), bs = boundsOf(rec.group);
    const gap = a.gap ?? 0.45;
    if (Math.abs(f.x) >= Math.abs(f.z)) rec.group.position.x += f.x < 0 ? (bt.min.x - gap) - bs.max.x : (bt.max.x + gap) - bs.min.x;
    else rec.group.position.z += f.z < 0 ? (bt.min.z - gap) - bs.max.z : (bt.max.z + gap) - bs.min.z;
  }
  /** Floor items never go through walls or into the curtain stack (real model bounds). */
  function clampToRoom(rec) {
    const { slot, group } = rec;
    if (slot.type === 'curtains' || slot.mount === 'ceiling' || slot.mount === 'worktop' || (slot.mount === 'wall' && group.userData.mount !== 'leaning')) return;
    const bb = boundsOf(group);
    const m = slot.clearance ?? 0.008;
    let dx = 0, dz = 0;
    if (bb.min.x < m) dx = m - bb.min.x; else if (bb.max.x > S.x - m) dx = S.x - m - bb.max.x;
    const underCurtain = curtainBox && !FLAT.has(slot.type) && bb.max.x > curtainBox.x0 && bb.min.x < curtainBox.x1;
    const north = (underCurtain ? curtainBox.z0 : S.z) - m;
    if (bb.min.z < m) dz = m - bb.min.z; else if (bb.max.z > north) dz = north - bb.max.z;
    if (Math.abs(dx) > 0.15 || Math.abs(dz) > 0.15) console.debug(`[villar] ${rec.item.id} pushed ${dx.toFixed(2)}, ${dz.toFixed(2)} m off walls in ${slot.id}`);
    group.position.x += dx; group.position.z += dz;
  }
  const S = layout.size;

  function build(slot) {
    const item = store.selected(slot.id);
    if (!item) return null;
    if (slot.attach && !placed.get(slot.attach.slot)) return null;
    const rec = make(slot, item);
    if (!rec) return null;
    if (!place(rec)) { cachePut(rec); return null; }
    root.add(rec.group);
    placed.set(slot.id, rec);
    return rec;
  }

  /** Detach a slot's current rec (kept in the cache unless `dispose`). Returns it. */
  function detach(slotId, { keep = true } = {}) {
    const rec = placed.get(slotId);
    if (!rec) return null;
    placed.delete(slotId);
    if (!keep) { root.remove(rec.group); disposeRec(rec); return null; }
    return rec;
  }
  function remove(slotId) {
    const rec = placed.get(slotId);
    if (!rec) return;
    root.remove(rec.group);
    placed.delete(slotId);
    cachePut(rec);
  }

  function placeAll() {
    for (const id of ordered(slots.map((s) => s.id))) build(byId.get(id));
  }

  /**
   * Rebuild the given slots and all slots attached (transitively) to them.
   * Returns { ids, outgoing: [rec] (still in the scene — caller fades them out, then calls retire),
   * incoming: [rec] }. Without `keepOld` the old groups leave the scene at once.
   */
  function rebuildSlots(ids, { keepOld = false } = {}) {
    ids = ids.filter((id) => byId.has(id));
    const all = ordered([...ids, ...descendants(ids)]);
    const outgoing = [];
    for (const id of [...all].reverse()) {
      const rec = placed.get(id);
      if (!rec) continue;
      placed.delete(id);
      if (keepOld) {
        // its lights leave at once (constant light count → no shader recompiles during the fade)
        for (const l of rec.lights) { l.removeFromParent(); l.target?.removeFromParent(); }
        outgoing.push(rec);
      } else { root.remove(rec.group); cachePut(rec); }
    }
    const incoming = [];
    for (const id of all) { const rec = build(byId.get(id)); if (rec) incoming.push(rec); }
    return { ids: all, outgoing, incoming };
  }
  /** Slots aligned to any of `ids` (not rebuilt, only moved) with their attached children. */
  function dependents(ids) {
    const set = new Set(ids);
    const dep = slots.filter((q) => q.align && set.has(q.align.to) && !set.has(q.id)).map((q) => q.id);
    return ordered([...dep, ...descendants(dep)]).filter((id) => !set.has(id));
  }
  /** Re-place slots in their (new) context; returns moves [{ group, from, to }] for tweening. */
  function relocate(ids) {
    const moves = [];
    for (const id of ordered(ids)) {
      const rec = placed.get(id);
      if (!rec) continue;
      const from = rec.group.position.clone();
      place(rec);
      if (from.distanceToSquared(rec.group.position) > 1e-8) moves.push({ group: rec.group, from, to: rec.group.position.clone() });
    }
    return moves;
  }
  /** Old recs whose fade-out finished: out of the scene, into the cache. */
  function retire(recs) {
    for (const rec of recs) {
      root.remove(rec.group); rec.group.visible = true;
      for (const l of rec.lights) { if (!l.parent) rec.group.add(l); if (l.target && !l.target.parent) rec.group.add(l.target); }
      cachePut(rec);
    }
  }
  /** Rebuild every slot of a type (legacy change events without `slots`). */
  function rebuildType(type, opts) { return rebuildSlots(slots.filter((s) => s.type === type).map((s) => s.id), opts); }

  /** Build alternatives ahead of time (idle): `list` = [{ slotId, itemId }]. One per call. */
  function prebuildOne(slotId, item) {
    const slot = byId.get(slotId);
    if (!slot || !item || cache.has(cacheKey(slotId, item.id)) || placed.get(slotId)?.item.id === item.id) return null;
    if (slot.attach && !placed.get(slot.attach.slot)) return null;
    const rec = make(slot, item);
    if (rec) cachePut(rec);
    return rec;
  }

  function colliders() {
    const out = [];
    for (const { slot, item, group } of placed.values()) {
      if (slot.attach || slot.mount || NO_COLLIDE.has(slot.type) || !item.dims) continue;
      const w = item.dims.w / 100, d = item.dims.d / 100;
      const pad = slot.type === 'plant' ? -0.08 : 0.0;
      out.push({ cx: group.position.x, cz: group.position.z, hw: w / 2 + pad, hd: d / 2 + pad, rot: (slot.rotY || 0) * DEG, kind: slot.id });
    }
    return out;
  }

  function lampLights() { return [...placed.values()].flatMap((r) => r.lights); }

  function meshesOf(slotId) {
    const rec = placed.get(slotId);
    if (!rec) return [];
    const out = [];
    rec.group.traverse((o) => { if (o.isMesh && o.userData.slotId === slotId) out.push(o); });
    return out;
  }

  function info(slotId) {
    const rec = placed.get(slotId);
    if (!rec) return null;
    return { slotId, slotType: rec.slot.type, item: rec.item };
  }

  return {
    root, placed, placeAll, rebuildType, rebuildSlots, retire, prebuildOne, colliders, dependents, relocate,
    cached: (slotId, itemId) => cache.has(cacheKey(slotId, itemId)),
    assignLampShadows: () => assignLampShadows(maxLampShadows),
    /** World bounding box of a slot's current item (null if empty). */
    boxOf: (id) => { const g = placed.get(id)?.group; return g ? new THREE.Box3().setFromObject(g) : null; }, lampLights, meshesOf, info,
    groupOf: (id) => placed.get(id)?.group || null,
    slotsOfType: (type) => slots.filter((s) => s.type === type),
    dispose() {
      for (const id of [...placed.keys()]) detach(id, { keep: false });
      for (const rec of cache.values()) disposeRec(rec);
      cache.clear();
    },
  };
}
