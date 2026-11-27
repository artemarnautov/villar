// Villar — kitchen fixtures the architecture can drop in (owner: modeler).
//
// sinkParts(): an inset brushed-steel sink (R4-13 "the sink reads as a flat black hole"): a 15–18 cm deep basin with
// drafted walls, a filleted floor falling to a drain, a 15 mm flat rim lying on the worktop, and a drain ring +
// slotted strainer. Returned as plain { geometry, key, opts } parts in LOCAL metres — origin at the centre of the
// worktop cut-out on the worktop's top surface, +y up, x across the counter (wall → front), z along the run — so the
// engine's architecture builder can translate them into place and resolve `key` with materials.get(key, opts).
import * as THREE from '../../../vendor/three/three.module.js';
import { roundedRectLoop } from './geom.js';

/** Loft between closed loops of equal length (Vector3 arrays) → indexed geometry with smooth normals. */
function loft(loops, { closeBottom = false } = {}) {
  const n = loops[0].length, pos = [], idx = [];
  for (const L of loops) for (const p of L) pos.push(p.x, p.y, p.z);
  for (let k = 0; k < loops.length - 1; k++) for (let i = 0; i < n; i++) {
    const a = k * n + i, b = k * n + ((i + 1) % n), c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  if (closeBottom) {
    const last = loops[loops.length - 1], cy = last.reduce((s, p) => s + p.y, 0) / n;
    const ci = pos.length / 3; pos.push(0, cy, 0);
    const base = (loops.length - 1) * n;
    for (let i = 0; i < n; i++) idx.push(base + i, ci, base + ((i + 1) % n));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Inset single-bowl sink. w = across the counter (x), l = along the run (z), depth = bowl depth (0.15–0.18),
 * r = top corner radius, rim = flat rim width on the worktop.
 * Returns [{ geometry, key, opts, cast }].
 */
export function sinkParts({ w = 0.42, l = 0.48, depth = 0.17, r = 0.035, rim = 0.015, steel = 'metal-nickel', steelOpts = { color: '#c4c3bf', roughness: 0.45 } } = {}) {
  const per = 8;
  const loopAt = (k, y, inset) => {
    const ww = w - 2 * inset, ll = l - 2 * inset;
    // loops are built with x = width, z = length
    return roundedRectLoop(ww, ll, Math.max(0.004, r - inset * 0.5), y, per);
  };
  // basin: top edge (y = 0) → drafted walls → floor fillet → floor falling 6 mm to the drain
  const draft = 0.012, fillet = 0.03;
  const rings = [];
  rings.push(loopAt(0, 0.0, 0));
  rings.push(loopAt(0, -0.004, 0.0005));
  const wallBottom = -depth + fillet;
  for (let k = 1; k <= 4; k++) { const t = k / 4; rings.push(loopAt(0, -0.004 + (wallBottom + 0.004) * t, draft * t)); }
  for (let k = 1; k <= 4; k++) {
    const a = (k / 4) * Math.PI / 2;
    rings.push(loopAt(0, wallBottom - Math.sin(a) * fillet, draft + (1 - Math.cos(a)) * fillet));
  }
  // floor rings falling toward the drain
  const inset0 = draft + fillet, floorY = -depth;
  for (const [t, drop] of [[0.35, 0.002], [0.7, 0.005]]) {
    const ww = (w - 2 * inset0) * (1 - t), ll = (l - 2 * inset0) * (1 - t);
    rings.push(roundedRectLoop(Math.max(0.09, ww), Math.max(0.09, ll), Math.max(0.004, (r - inset0 * 0.5) * (1 - t)), floorY - drop, per));
  }
  const basin = loft(rings, { closeBottom: true });
  // normals face into the bowl (it is seen from above / inside): flip if the first wall normal points outward
  const nx = basin.attributes.normal, px = basin.attributes.position;
  const i0 = 2 * rings[0].length; // a wall vertex
  if (nx.getX(i0) * px.getX(i0) + nx.getZ(i0) * px.getZ(i0) > 0) {
    const ix = basin.index.array; for (let k = 0; k < ix.length; k += 3) { const tmp = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = tmp; }
    basin.computeVertexNormals();
  }
  // flat rim on the worktop: 4 mm thick annulus with a rolled outer edge
  const rimLoops = [
    loopAt(0, 0.0, 0),
    loopAt(0, 0.004, -0.002),
    roundedRectLoop(w + 2 * rim - 0.004, l + 2 * rim - 0.004, r + rim * 0.8, 0.004, per),
    roundedRectLoop(w + 2 * rim, l + 2 * rim, r + rim, 0.0025, per),
    roundedRectLoop(w + 2 * rim + 0.0005, l + 2 * rim + 0.0005, r + rim, 0.0, per),
  ];
  const rimG = loft(rimLoops);
  // drain: chrome ring + dark slotted strainer
  const dy = floorY - 0.0065;
  const ring = new THREE.TorusGeometry(0.036, 0.004, 8, 40).rotateX(Math.PI / 2).translate(0, dy + 0.002, 0);
  const strainer = new THREE.CylinderGeometry(0.033, 0.033, 0.002, 40).translate(0, dy, 0);
  const slots = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.BoxGeometry(0.003, 0.0012, 0.018).translate(0, 0, 0.016).rotateY((i / 8) * Math.PI * 2).translate(0, dy + 0.0012, 0);
    slots.push(g);
  }
  return [
    { geometry: basin, key: steel, opts: steelOpts, cast: false },
    { geometry: rimG, key: steel, opts: steelOpts, cast: true },
    { geometry: ring, key: 'metal-chrome', opts: {}, cast: false },
    { geometry: strainer, key: 'metal-chrome', opts: { color: '#b9bbbd', roughness: 0.3 }, cast: false },
    ...slots.map((g) => ({ geometry: g, key: 'rubber', opts: { color: '#1e1e1f' }, cast: false })),
  ];
}
