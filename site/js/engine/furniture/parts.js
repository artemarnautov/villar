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
export function addLegs(b, c, { type = 'wood-taper', w, d, top, inset = 0.05, mat, metalMat, middle = false, middleInset = null, splay = 0, cx = 0, cz = 0 }) {
  if (!type || type === 'none' || top <= 0.002) return;
  const t = String(type).toLowerCase();
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
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(sz * 0.06, 0, -sx * 0.06)));
      b.add(g, metalMat || mat, { pos: [x, h, z], axis: 'y' });
      continue;
    }
    if (t.includes('metal') || t.includes('square-metal') || t.includes('iron')) {
      b.add(squareLeg(0.022, 0.018, h, 0.002), metalMat || mat, { pos: [x, h, z], axis: 'y' });
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
  }
}

/** Drawer / door handle at (x, y, z) on a front plane facing +Z. */
export function addHandle(b, c, type, { x, y, z, w = 0.12, mat, vertical = false }) {
  const t = String(type || 'none').toLowerCase();
  if (t === 'none' || t === 'push' || t === 'cutout') return;
  const m = mat || c.mat('metal-brass');
  if (t.includes('knob')) {
    const g = new THREE.SphereGeometry(0.014, 16, 10); g.scale(1, 1, 0.7);
    b.add(g, m, { pos: [x, y, z + 0.012] });
    b.add(new THREE.CylinderGeometry(0.005, 0.006, 0.012, 10), m, { pos: [x, y, z + 0.006], rot: [Math.PI / 2, 0, 0] });
    return;
  }
  if (t.includes('leather') || t.includes('strap')) {
    b.add(softBox(0.025, 0.07, 0.006, { r: 0.002, seg: 1 }), c.mat('leather-cognac'), { pos: [x, y - 0.02, z + 0.004] });
    return;
  }
  // bar / pull / default: slim bar on two posts
  const L = vertical ? Math.min(w, 0.2) : w;
  const bar = new THREE.CylinderGeometry(0.005, 0.005, L, 12);
  if (!vertical) bar.rotateZ(Math.PI / 2);
  b.add(bar, m, { pos: [x, y, z + 0.024] });
  for (const s of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.004, 0.004, 0.024, 8); post.rotateX(Math.PI / 2);
    b.add(post, m, { pos: vertical ? [x, y + s * (L / 2 - 0.01), z + 0.012] : [x + s * (L / 2 - 0.01), y, z + 0.012] });
  }
}

/** Vertical flutes (half-round reeds) across a front panel of size w × h at plane z, centred at (cx, cy). */
export function addFlutes(b, mat, { cx, cy, z, w, h, pitch = 0.028, depth = 0.008, seg = 6 }) {
  const n = Math.max(2, Math.round(w / pitch));
  const p = w / n;
  for (let i = 0; i < n; i++) {
    const g = new THREE.CylinderGeometry(p / 2, p / 2, h, seg, 1, true, -Math.PI / 2, Math.PI);
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
