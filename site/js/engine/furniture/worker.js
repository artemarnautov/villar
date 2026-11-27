// Villar furniture — build worker (T8). Owner: modeler.
//
// Runs the parametric generators off the main thread. The generators are pure functions of (item, ctx, seed); here
// they get a stand-in material library that returns lightweight descriptors ({ key, opts }) instead of GPU
// materials, and the finished group is posted back as a plain tree with transferable vertex buffers. The main
// thread (furniture/index.js → prebuildItems / buildItemAsync) turns the tree back into meshes with the real
// materials.get(key, opts) — the same calls, in the same order, a main-thread build makes — so a worker prototype
// is identical to buildItem(item, ctx) (draw calls, triangles, anchors, lights).
import { buildItem } from './index.js';
import { resolveMaterialKey } from '../materials.js';
import { renderArtData } from '../textures.js';

// materials that the generators treat as emitters (lighting.js asks material.userData.glow)
const GLOW = new Set(['lamp-shade', 'paper-shade', 'opal-glass', 'bulb', 'flame']);

const plain = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v === undefined || typeof v === 'function') continue;
    if (v && typeof v === 'object' && (v.isTexture || v.isColor || v.isMaterial)) continue;
    out[k] = v;
  }
  return out;
};

let descs = new Map();
const materials = {
  resolve: resolveMaterialKey,
  get(key, opts) {
    const canon = resolveMaterialKey(key);
    const o = plain(opts);
    const id = canon + '|' + JSON.stringify(o, Object.keys(o).sort());
    let m = descs.get(id);
    if (!m) {
      m = { isMaterial: true, uuid: 'wm' + descs.size, name: canon, userData: { materialKey: canon, ...(GLOW.has(canon) ? { glow: 1 } : {}) }, desc: { key: String(key), opts: o } };
      descs.set(id, m);
    }
    return m;
  },
};

function udMesh(u) { return { ...(u.itemId != null ? { itemId: u.itemId } : {}), ...(u.noCastShadow ? { noCastShadow: true } : {}), ...(u.noFit ? { noFit: true } : {}), ...(u.cord ? { cord: true } : {}) }; }
function udRoot(u) {
  const anchors = {};
  for (const [k, v] of Object.entries(u.anchors || {})) anchors[k] = [v.x, v.y, v.z];
  return { anchors, anchorInfo: u.anchorInfo || {}, lights: u.lights || [], mount: u.mount, archetype: u.archetype, itemId: u.itemId, triangles: u.triangles, pivot: u.pivot, front: u.front, bounds: u.bounds, radial: u.radial };
}

function ser(o, transfer, root = false) {
  const n = { m: !!o.isMesh, name: o.name, p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), cs: o.castShadow, rs: o.receiveShadow, ud: root ? udRoot(o.userData) : udMesh(o.userData), c: [] };
  if (o.isMesh) {
    const g = o.geometry, a = {};
    for (const [k, at] of Object.entries(g.attributes)) { a[k] = [at.array, at.itemSize, at.normalized]; transfer.add(at.array.buffer); }
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    const bs = g.boundingSphere, bb = g.boundingBox;
    n.g = { a, i: g.index ? g.index.array : null, bs: [bs.center.x, bs.center.y, bs.center.z, bs.radius], bb: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z] };
    if (g.index) transfer.add(g.index.array.buffer);
    n.mat = o.material.desc || { key: o.material.name || 'paint', opts: {} };
  }
  for (const ch of o.children) n.c.push(ser(ch, transfer));
  return n;
}

self.onmessage = (e) => {
  const { id, item, ctx, art } = e.data || {};
  if (art) {
    // artwork pixels (OffscreenCanvas 2D in the worker); the main thread only putImageData()s the result
    try {
      if (typeof OffscreenCanvas === 'undefined') throw new Error('no OffscreenCanvas');
      const r = renderArtData(art);
      const transfer = [r.rgba.buffer]; if (r.normal) transfer.push(r.normal.data.buffer);
      self.postMessage({ id, art: r }, transfer);
    } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
    return;
  }
  try {
    if (descs.size > 4000) descs = new Map();
    const t0 = performance.now();
    const g = buildItem(item, { ...(ctx || {}), materials });
    const transfer = new Set();
    const tree = ser(g, transfer, true);
    let verts = 0; g.traverse((o) => { if (o.isMesh) verts += o.geometry.attributes.position.count; });
    self.postMessage({ id, tree, verts, ms: performance.now() - t0 }, [...transfer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
