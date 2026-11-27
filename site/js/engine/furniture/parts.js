// Villar furniture — shared parts & param helpers. Owner: modeler.
import * as THREE from '../../../vendor/three/three.module.js';
import { softBox, roundLeg, squareLeg, tube, V3, clamp, lerp } from './geom.js';

export const FABRICS = {
  boucle: 'fabric-boucle', 'bouclé': 'fabric-boucle', linen: 'fabric-linen', velvet: 'fabric-velvet', cotton: 'fabric-cotton',
  leather: 'leather-cognac', 'faux-leather': 'leather-cognac', chenille: 'fabric-velvet', wool: 'fabric-wool', felt: 'fabric-wool',
  polyester: 'fabric-linen', fabric: 'fabric-linen', 'cotton-linen': 'fabric-linen', weave: 'fabric-linen', jute: 'jute', rattan: 'rattan',
};

export function fabricKey(f, fallback = 'fabric-linen') {
  if (!f) return fallback;
  const k = String(f).toLowerCase();
  if (k.startsWith('fabric-') || k.startsWith('leather')) return k;
  for (const [n, v] of Object.entries(FABRICS)) if (k.includes(n)) return v;
  return fallback;
}

/** Fabric material from params (fabric + colour). */
export function fabricMat(c, fabric, color, extra = {}) {
  const key = fabricKey(fabric);
  const col = color || c.item?.colorHex || '#d9cdb8';
  return c.mat(key, { color: col, ...extra });
}

/** Any material param value → material (wood keys, metal keys, free text). */
export function anyMat(c, key, fallback = 'walnut-dark', opts) {
  return c.mat(key || fallback, opts);
}

/** Is this material key a metal (thin profiles) ? */
export const isMetal = (k) => /metal|brass|chrome|iron|steel|gold|nickel|black/.test(String(k || ''));

/**
 * Add 4 (or 6) legs under a rectangle footprint.
 * type: wood-taper | wood-short | wood-block | metal | metal-hairpin | metal-square | bun | splayed | none
 * legs hang from y = top down to 0.
 */
/**
 * Floor glide under a leg foot (round 5 close-up detail): a 3 mm felt / nylon pad on wood legs, a moulded end cap on
 * metal tube legs (slightly wider than the tube, 4 mm), a brass ferrule ring on brass legs. foot = floor point.
 */
export function legGlide(b, c, { x, z, r, kind = 'felt', mat = null, square = 0 }) {
  if (kind === 'ferrule') {
    b.add(new THREE.CylinderGeometry(r * 1.06, r * 1.08, 0.012, 14), mat, { pos: [x, 0.006, z], uv: 'cyl' });
    return;
  }
  const pad = kind === 'cap' ? c.mat('rubber', { color: '#1c1b1a' }) : c.mat('rubber', { color: '#3a3532' });
  const h = kind === 'cap' ? 0.004 : 0.003;
  if (square) b.add(softBox(square * 1.08, h, square * 1.08, { r: 0.0012, seg: 1 }), pad, { pos: [x, h / 2, z], uv: 'none' });
  else b.add(new THREE.CylinderGeometry(r * (kind === 'cap' ? 1.08 : 0.95), r * (kind === 'cap' ? 1.08 : 0.95), h, 12), pad, { pos: [x, h / 2, z], uv: 'none' });
}

export function addLegs(b, c, { type = 'wood-taper', w, d, top, inset = 0.05, mat, metalMat, middle = false, middleInset = null, splay = 0, cx = 0, cz = 0 }) {
  if (!type || type === 'none' || top <= 0.002) return;
  const t = String(type).toLowerCase();
  const brassy = (m) => /brass|gold/.test(String(m?.name || ''));
  const xs = [-(w / 2 - inset), w / 2 - inset];
  const zs = [-(d / 2 - inset), d / 2 - inset];
  const pts = [];
  for (const x of xs) for (const z of zs) pts.push([x, z]);
  if (middle) { const mz = middleInset != null ? d / 2 - middleInset : d / 2 - inset; pts.push([0, -mz], [0, mz]); }
  const h = top;
  for (const [x0, z0] of pts) {
    const sx = Math.sign(x0) || 0, sz = Math.sign(z0) || 0;
    const x = x0 + cx, z = z0 + cz;
    if (t.includes('hairpin')) {
      // classic 2-rod hairpin: a rod bent in a tight U at the floor, both ends welded to a top plate
      const r = 0.0055, s2 = 0.05;
      const dx = sx || 1;
      const path = [V3(x - s2 * dx, h - 0.004, z), V3(x - s2 * 0.55 * dx, h * 0.55, z), V3(x - 0.01 * dx, 0.03, z), V3(x, 0.007, z), V3(x + 0.01 * dx, 0.03, z), V3(x + s2 * 0.1 * dx, h * 0.55, z), V3(x + s2 * 0.6 * dx, h - 0.004, z)];
      b.add(tube(path, r, { tubular: 40, radial: 6, tension: 0.5 }), metalMat || mat, { uv: 'box', axis: 'y' });
      b.add(softBox(0.09, 0.004, 0.06, { r: 0.0015, seg: 1 }), metalMat || mat, { pos: [x, h - 0.002, z] });
      continue;
    }
    if (t.includes('slim') && (t.includes('metal') || t.includes('brass'))) {
      // thin tapered round metal leg
      const g = roundLeg(0.011, 0.0065, h, 12);
      const rm = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(sz * 0.06, 0, -sx * 0.06));
      g.applyMatrix4(rm);
      b.add(g, metalMat || mat, { pos: [x, h, z], axis: 'y' });
      const f = V3(0, -h, 0).applyMatrix4(rm);
      legGlide(b, c, { x: x + f.x, z: z + f.z, r: 0.0065, kind: brassy(metalMat || mat) ? 'ferrule' : 'cap', mat: metalMat || mat });
      continue;
    }
    if (t.includes('metal') || t.includes('square-metal') || t.includes('iron')) {
      b.add(squareLeg(0.022, 0.018, h, 0.002), metalMat || mat, { pos: [x, h, z], axis: 'y' });
      legGlide(b, c, { x, z, r: 0.009, kind: 'cap', square: 0.018 });
      continue;
    }
    if (t.includes('sled')) {
      // sled runner per side (only emit once per side, from the front leg)
      if (sz > 0) {
        const L = d + 0.02;
        b.add(softBox(0.028, 0.022, L, { r: 0.008, seg: 2 }), mat, { pos: [x, 0.011, cz], axis: 'z' });
        for (const zz of [z, cz - (z - cz)]) b.add(squareLeg(0.03, 0.03, h - 0.02, 0.006), mat, { pos: [x, h, zz], axis: 'y' });
      }
      continue;
    }
    if (t.includes('bun')) {
      const g = new THREE.SphereGeometry(Math.min(0.04, h * 0.7), 16, 10);
      g.scale(1, h / (2 * Math.min(0.04, h * 0.7)), 1);
      b.add(g, mat, { pos: [x, h / 2, z], axis: 'y' });
      continue;
    }
    if (t.includes('block') || t.includes('square')) {
      b.add(squareLeg(0.045, 0.04, h, 0.004), mat, { pos: [x, h, z], axis: 'y' });
      legGlide(b, c, { x, z, r: 0.017, square: 0.034 });
      continue;
    }
    // tapered round wood leg (default), optional splay
    const rt = clamp(h * 0.16, 0.016, 0.026), rb = rt * 0.6;
    const g = roundLeg(rt, rb, h, 16);
    const ang = splay || (t.includes('splay') || t.includes('taper') ? 0.07 : 0);
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(sz * ang, 0, -sx * ang));
    g.applyMatrix4(m);
    // keep foot on floor & top under frame
    b.add(g, mat, { pos: [x, h, z], axis: 'y' });
    if (h > 0.05) { const f = V3(0, -h, 0).applyMatrix4(m); legGlide(b, c, { x: x + f.x, z: z + f.z, r: rb }); }
  }
}

/** Drawer / door handle at (x, y, z) on a front plane facing +Z. */
export function addHandle(b, c, type, { x, y, z, w = 0.12, mat, vertical = false }) {
  const t = String(type || 'none').toLowerCase();
  if (t === 'none' || t === 'push' || t === 'cutout') return;
  const m = mat || c.mat('metal-brass');
  if (t.includes('knob')) {
    // turned knob (round 5 close-up): domed head with a soft edge, waisted stem, a thin rose against the front
    const prof = [[0.0005, 0.0], [0.0075, 0.0], [0.0078, 0.0012], [0.0045, 0.0035], [0.004, 0.009], [0.0105, 0.0125], [0.0142, 0.0165], [0.0145, 0.0185], [0.0128, 0.0215], [0.007, 0.0238], [0.0005, 0.0242]];
    const g = new THREE.LatheGeometry(prof.map(([r, yy]) => new THREE.Vector2(r, yy)), 24);
    g.rotateX(Math.PI / 2);
    b.add(g, m, { pos: [x, y, z], uv: 'box', axis: 'z' });
    return;
  }
  if (t.includes('leather') || t.includes('strap')) {
    // folded leather tab with stitched-down ends: two layers, rounded edges, two screw heads
    const lth = c.mat('leather-cognac');
    b.add(softBox(0.025, 0.07, 0.006, { r: 0.0022, seg: 2 }), lth, { pos: [x, y - 0.02, z + 0.004] });
    b.add(softBox(0.023, 0.03, 0.004, { r: 0.0018, seg: 2 }), lth, { pos: [x, y - 0.002, z + 0.0085] });
    for (const yy of [y + 0.006, y - 0.046]) b.add(new THREE.CylinderGeometry(0.0028, 0.0028, 0.0016, 10).rotateX(Math.PI / 2), c.mat('metal-brass'), { pos: [x, yy, z + 0.0075 + (yy > y ? 0.0035 : 0)], uv: 'none' });
    return;
  }
  // bar / pull / default: bar with rounded ends on two posts, each post on a small rose (round 5 close-up)
  const L = vertical ? Math.min(w, 0.2) : w;
  const bar = new THREE.CapsuleGeometry(0.005, Math.max(0.01, L - 0.01), 3, 12);
  if (!vertical) bar.rotateZ(Math.PI / 2);
  b.add(bar, m, { pos: [x, y, z + 0.026] });
  for (const s of [-1, 1]) {
    const px = vertical ? x : x + s * (L / 2 - 0.012), py = vertical ? y + s * (L / 2 - 0.012) : y;
    const post = new THREE.CylinderGeometry(0.0035, 0.0042, 0.024, 10); post.rotateX(Math.PI / 2);
    b.add(post, m, { pos: [px, py, z + 0.013] });
    b.add(new THREE.CylinderGeometry(0.0062, 0.0066, 0.0018, 14).rotateX(Math.PI / 2), m, { pos: [px, py, z + 0.0009] });
  }
}

/** Vertical flutes (half-round reeds) across a front panel of size w × h at plane z, centred at (cx, cy). */
export function addFlutes(b, mat, { cx, cy, z, w, h, pitch = 0.028, depth = 0.008, seg = 6 }) {
  const n = Math.max(2, Math.round(w / pitch));
  const p = w / n;
  for (let i = 0; i < n; i++) {
    // half-round reed with closed ends (round 5: from a 40° tilt the open ends showed into the hollow reeds)
    const g = new THREE.CylinderGeometry(p / 2, p / 2, h, seg, 1, false, -Math.PI / 2, Math.PI);
    g.scale(1, 1, (depth) / (p / 2));
    b.add(g, mat, { pos: [cx - w / 2 + p * (i + 0.5), cy, z], axis: 'y' });
  }
}

/** Vertical slats with gaps. */
export function addSlats(b, mat, { cx, cy, z, w, h, pitch = 0.04, slatW = 0.028, depth = 0.015 }) {
  const n = Math.max(2, Math.round(w / pitch));
  const p = w / n;
  for (let i = 0; i < n; i++) b.add(softBox(Math.min(slatW, p * 0.8), h, depth, { r: 0.002, seg: 1 }), mat, { pos: [cx - w / 2 + p * (i + 0.5), cy, z + depth / 2], axis: 'y' });
}

export { lerp, clamp };
