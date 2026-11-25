// Villar engine — places catalog items into layout slots and swaps them on store changes.
// Owner: engine.
//
// Placement contract (SPEC): generator origin = bottom-centre of footprint, front +Z.
//   floor items: origin at slot.pos, rotY around +Y;  attach: parent anchor + offset (parent frame);
//   pendant: origin = ceiling mount point; wall_art: origin = back-centre on the wall;
//   curtains: bottom-centre at the floor.
import * as THREE from 'three';
import { DEG, disposeObject } from './util.js';
import { ensureBVH } from './interaction.js';

const NO_COLLIDE = new Set(['rug', 'curtains', 'wall_art', 'pendant_lamp', 'cushions', 'decor_set', 'mattress', 'bedding', 'table_lamp']);
// Lamp light calibration: furniture `intensity: 1` → candela in scene units (see lighting.js).
export const LAMP_CANDELA = 2.2;

export function createFurnisher({ layout, store, materials, buildItem, quality = 'high' }) {
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
      out.push(id);
    };
    ids.forEach(visit);
    return out;
  }

  function makeLights(group) {
    const list = [];
    for (const L of group.userData.lights || []) {
      const color = new THREE.Color(L.color || '#ffd8a8');
      const cd = (L.intensity ?? 1) * LAMP_CANDELA;
      let light;
      if (L.type === 'spot') {
        light = new THREE.SpotLight(color, cd, L.distance ?? 0, (L.angle ?? 60) * DEG, L.penumbra ?? 0.6, 2);
        const t = L.target || [L.position[0], L.position[1] - 1, L.position[2]];
        light.target.position.set(...t);
        group.add(light.target);
      } else {
        light = new THREE.PointLight(color, cd, L.distance ?? 0, 2);
      }
      light.position.set(...L.position);
      light.castShadow = false;
      light.userData.lampLight = true;
      light.userData.baseIntensity = cd;
      light.name = 'lamp-light';
      group.add(light);
      list.push(light);
    }
    return list;
  }

  function build(slot) {
    const item = store.selected(slot.id);
    if (!item) return null;
    const parentRec = slot.attach ? placed.get(slot.attach.slot) : null;
    if (slot.attach && !parentRec) return null;
    const ctx = { materials, quality };
    if (parentRec) ctx.host = parentRec.group.userData.anchorInfo?.[slot.attach.anchor] || null;
    if (slot.type === 'curtains') ctx.span = slot.max?.w || null;
    let group;
    try { group = buildItem(item, ctx); }
    catch (e) { console.error(`[villar] failed to build ${item.id} for slot ${slot.id}`, e); return null; }
    if (!group) return null;
    group.name = `slot:${slot.id}`;
    // size sanity vs. slot.max
    if (slot.max && item.dims) {
      const d = item.dims;
      const over = ['w', 'd', 'h'].filter((k) => slot.max[k] !== undefined && d[k] / 100 > slot.max[k] + 1e-6);
      if (over.length) console.debug(`[villar] ${item.id} exceeds slot ${slot.id} max on ${over.join(',')}`, d, slot.max);
    }
    // placement
    if (slot.attach) {
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
    }
    group.userData.slotId = slot.id;
    group.userData.slotType = slot.type;
    group.traverse((o) => {
      o.userData.slotId = slot.id;
      o.userData.slotType = slot.type;
      if (o.isMesh) {
        o.castShadow = o.userData.noCastShadow ? false : true;
        o.receiveShadow = true;
      }
    });
    const lights = makeLights(group);
    group.updateMatrixWorld(true);
    ensureBVH(group);
    root.add(group);
    const rec = { slot, item, group, lights };
    placed.set(slot.id, rec);
    return rec;
  }

  function remove(slotId) {
    const rec = placed.get(slotId);
    if (!rec) return;
    root.remove(rec.group);
    disposeObject(rec.group, { isShared: (m) => !!m.userData?.materialKey });
    placed.delete(slotId);
  }

  function placeAll() {
    for (const id of ordered(slots.map((s) => s.id))) build(byId.get(id));
  }

  /** Rebuild every slot of a type and all slots attached (transitively) to them. */
  function rebuildType(type) {
    const ids = slots.filter((s) => s.type === type).map((s) => s.id);
    const all = ordered([...ids, ...descendants(ids)]);
    for (const id of [...all].reverse()) remove(id);
    for (const id of all) build(byId.get(id));
    return all;
  }

  function colliders() {
    const out = [];
    for (const { slot, item } of placed.values()) {
      if (slot.attach || slot.mount || NO_COLLIDE.has(slot.type) || !item.dims) continue;
      const w = item.dims.w / 100, d = item.dims.d / 100;
      const pad = slot.type === 'plant' ? -0.08 : 0.0;
      out.push({ cx: slot.pos[0], cz: slot.pos[2], hw: w / 2 + pad, hd: d / 2 + pad, rot: (slot.rotY || 0) * DEG, kind: slot.id });
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
    root, placed, placeAll, rebuildType, colliders, lampLights, meshesOf, info,
    groupOf: (id) => placed.get(id)?.group || null,
    slotsOfType: (type) => slots.filter((s) => s.type === type),
    dispose() { for (const id of [...placed.keys()]) remove(id); },
  };
}
