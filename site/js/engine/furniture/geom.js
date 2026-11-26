// Villar furniture — geometry toolkit. Owner: modeler.
// All sizes in metres. Parts are collected per material and merged (few draw calls,
// path-tracer friendly: no InstancedMesh, every geometry has position/normal/uv).

// three is imported by URL (the same module the import map's 'three' resolves to — one instance), so the
// generators also run inside a module Worker, where import maps do not apply (T8: furniture/worker.js)
import * as THREE from '../../../vendor/three/three.module.js';
import { boxProjectUVs, cylinderUVs } from '../materials.js';
import { rng } from '../textures.js';

/** Concatenate geometries with identical attribute sets (all indexed or all not). */
export function mergeGeometries(list) {
  const names = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const k of names) {
    const a0 = list[0].attributes[k];
    let n = 0; for (const g of list) n += g.attributes[k].array.length;
    const arr = new a0.array.constructor(n);
    let o = 0; for (const g of list) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  if (list[0].index) {
    let n = 0, verts = 0; for (const g of list) { n += g.index.count; verts += g.attributes.position.count; }
    const idx = verts > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    let o = 0, base = 0;
    for (const g of list) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[o + i] = ia[i] + base; o += ia.length; base += g.attributes.position.count; }
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return out;
}

/** Weld coincident vertices (position-only geometries, tolerance in metres). */
export function mergeVertices(g, tol = 1e-6) {
  const pos = g.attributes.position, map = new Map(), remap = new Uint32Array(pos.count), keep = [];
  const q = 1 / tol;
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * q) + '_' + Math.round(pos.getY(i) * q) + '_' + Math.round(pos.getZ(i) * q);
    let j = map.get(k);
    if (j === undefined) { j = keep.length; map.set(k, j); keep.push(i); }
    remap[i] = j;
  }
  const out = new THREE.BufferGeometry();
  const arr = new Float32Array(keep.length * 3);
  keep.forEach((i, j) => { arr[j * 3] = pos.getX(i); arr[j * 3 + 1] = pos.getY(i); arr[j * 3 + 2] = pos.getZ(i); });
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const src = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const idx = []; for (let i = 0; i < src.length; i += 3) { const a = remap[src[i]], b = remap[src[i + 1]], c = remap[src[i + 2]]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  out.setIndex(idx);
  return out;
}

export { boxProjectUVs };
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x === x ? x : a));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Length param → metres. Catalog lengths are metres (≤ 3); larger numbers are read as centimetres. */
export const cm = (v, d) => { if (v == null || v === '' || isNaN(v)) return d; const n = Number(v); return n > 3 ? n / 100 : n; };

// ---------------------------------------------------------------- level of detail
// 2 = high (default), 1 = medium, 0 = low. buildItem() sets it from ctx.quality for the duration of a build.
let LOD = 2;
export function setLOD(l) { LOD = l === 0 || l === 1 ? l : 2; }
export function getLOD() { return LOD; }
/** Scale a segment count for the current LOD. */
export const segs = (n, min = 3) => Math.max(min, Math.round(n * (LOD === 2 ? 1 : LOD === 1 ? 0.62 : 0.4)));

// ---------------------------------------------------------------- soft box

function axisCoords(a, r, cs, fs) {
  // a = half extent, r = corner radius, cs = corner segs, fs = flat segs
  const out = [];
  const inner = a - r;
  for (let k = cs; k >= 1; k--) out.push(-(inner + r * Math.tan((k / cs) * Math.PI / 4)));
  for (let k = 0; k <= fs; k++) out.push(-inner + (2 * inner) * (k / fs));
  for (let k = 1; k <= cs; k++) out.push(inner + r * Math.tan((k / cs) * Math.PI / 4));
  return out;
}

/**
 * Rounded box with optional crowned (bulging) faces — the workhorse for cushions, panels, tops.
 * bulge: { top, bottom, front, back, left, right } in metres (outward displacement at face centre).
 * radius can be a number or { x, y, z }? (single radius). seg = corner segments. cell = target flat cell size.
 */
export function softBox(w, h, d, { r = 0.02, seg = 3, cell = 0.08, bulge = null, wrinkle = 0, seed = 1, taper = 0, deform = null } = {}) {
  r = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  if (LOD < 2) { seg = Math.max(1, seg - (LOD === 1 ? 1 : 2)); cell *= LOD === 1 ? 1.6 : 2.6; }
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const fsx = bulge ? Math.max(1, Math.round((w - 2 * r) / cell)) : 1;
  const fsy = bulge ? Math.max(1, Math.round((h - 2 * r) / cell)) : 1;
  const fsz = bulge ? Math.max(1, Math.round((d - 2 * r) / cell)) : 1;
  const X = axisCoords(hx, r, seg, fsx), Y = axisCoords(hy, r, seg, fsy), Z = axisCoords(hz, r, seg, fsz);
  const pos = [];
  const idx = [];
  const fax = []; // dominant axis per vertex: 0 = x (sides), 1 = y (top/bottom), 2 = z (front/back)
  let base = 0, curAxis = 1;
  const face = (A, B, mk) => {
    for (let j = 0; j < B.length; j++) for (let i = 0; i < A.length; i++) { const p = mk(A[i], B[j]); pos.push(p[0], p[1], p[2]); fax.push(curAxis); }
    const n = A.length;
    for (let j = 0; j < B.length - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = base + j * n + i, b = a + 1, c = a + n, e = c + 1;
      idx.push(a, b, e, a, e, c);
    }
    base += A.length * B.length;
  };
  // winding chosen so normals point outward (fixed after via computeVertexNormals sign check)
  curAxis = 1; face(X, Z, (x, z) => [x, hy, -z]);   // top
  face(X, Z, (x, z) => [x, -hy, z]);   // bottom
  curAxis = 2; face(X, Y, (x, y) => [x, y, hz]);    // front
  face(X, Y, (x, y) => [-x, y, -hz]);  // back
  curAxis = 0; face(Z, Y, (z, y) => [hx, y, -z]);   // right
  face(Z, Y, (z, y) => [-hx, y, z]);   // left
  const ix = hx - r, iy = hy - r, iz = hz - r;
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  const noise = wrinkle ? rng(seed) : null;
  const wr = wrinkle ? Array.from({ length: 6 }, () => [noise() * 6.28, 4 + noise() * 6, 4 + noise() * 6, noise() * 6.28]) : null;
  for (let i = 0; i < pos.length; i += 3) {
    p.set(pos[i], pos[i + 1], pos[i + 2]);
    q.set(clamp(p.x, -ix, ix), clamp(p.y, -iy, iy), clamp(p.z, -iz, iz));
    const dir = p.clone().sub(q);
    const len = dir.length() || 1;
    dir.multiplyScalar(1 / len);
    p.copy(q).addScaledVector(dir, r);
    if (bulge) {
      const sx = clamp(p.x / hx, -1, 1), sy = clamp(p.y / hy, -1, 1), sz = clamp(p.z / hz, -1, 1);
      const fx = 1 - sx * sx, fy = 1 - sy * sy, fz = 1 - sz * sz;
      const wgt = (c, inner) => clamp((Math.abs(c) - (inner - r * 0.2)) / (r * 1.2), 0, 1);
      if (bulge.top && p.y > 0) p.y += bulge.top * fx * fz * wgt(p.y, iy);
      if (bulge.bottom && p.y < 0) p.y -= bulge.bottom * fx * fz * wgt(p.y, iy);
      if (bulge.front && p.z > 0) p.z += bulge.front * fx * fy * wgt(p.z, iz);
      if (bulge.back && p.z < 0) p.z -= bulge.back * fx * fy * wgt(p.z, iz);
      if (bulge.right && p.x > 0) p.x += bulge.right * fy * fz * wgt(p.x, ix);
      if (bulge.left && p.x < 0) p.x -= bulge.left * fy * fz * wgt(p.x, ix);
    }
    if (wrinkle) {
      let dz = 0;
      for (const [ph, fxk, fyk, ph2] of wr) dz += Math.sin(p.x / w * fxk * 3.1 + ph) * Math.sin(p.y / h * fyk * 3.1 + ph2) + Math.sin((p.x + p.z) / d * fxk + ph2);
      p.addScaledVector(dir, dz * wrinkle / 6);
    }
    if (taper) { const t = (p.y + hy) / h; p.x *= 1 - taper * t; p.z *= 1 - taper * t; }
    if (deform) deform(p, hx, hy, hz);
    pos[i] = p.x; pos[i + 1] = p.y; pos[i + 2] = p.z;
  }
  return faceGridGeometry(pos, idx, fax);
}

/** Recompute smooth normals on a softBox-style geometry after editing positions (welds face seams). */
export function weldNormals(g) {
  const pos = Array.from(g.attributes.position.array), idx = Array.from(g.index.array);
  const out = faceGridGeometry(pos, idx, g.userData.faceAxis || new Uint8Array(pos.length / 3));
  g.setAttribute('normal', out.attributes.normal);
  if (out.index.array.some((v, i) => v !== idx[i])) g.setIndex(Array.from(out.index.array));
  return g;
}

/**
 * Indexed geometry from per-face grids: normals are computed on a welded copy (smooth across face
 * seams) but the grids stay separate so each face keeps its own box-projection UVs (no de-indexing).
 */
function faceGridGeometry(pos, idx, fax) {
  const n = pos.length / 3;
  const weld = new Int32Array(n), keyMap = new Map();
  let wc = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos[i * 3] * 1e5) + '_' + Math.round(pos[i * 3 + 1] * 1e5) + '_' + Math.round(pos[i * 3 + 2] * 1e5);
    let w = keyMap.get(k);
    if (w === undefined) { w = wc++; keyMap.set(k, w); }
    weld[i] = w;
  }
  const wn = new Float32Array(wc * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cb = new THREE.Vector3(), ab = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
    cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab);
    for (const v of [weld[i0], weld[i1], weld[i2]]) { wn[v * 3] += cb.x; wn[v * 3 + 1] += cb.y; wn[v * 3 + 2] += cb.z; }
  }
  const nor = new Float32Array(n * 3);
  let dot = 0;
  for (let i = 0; i < n; i++) {
    const w = weld[i]; let x = wn[w * 3], y = wn[w * 3 + 1], z = wn[w * 3 + 2];
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    nor[i * 3] = x; nor[i * 3 + 1] = y; nor[i * 3 + 2] = z;
    if ((i & 7) === 0) dot += x * pos[i * 3] + y * pos[i * 3 + 1] + z * pos[i * 3 + 2];
  }
  if (dot < 0) { // inside-out: flip winding and normals
    for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    for (let i = 0; i < nor.length; i++) nor[i] = -nor[i];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.userData.faceAxis = Uint8Array.from(fax);
  return g;
}

/** Ensure outward normals for a closed convex-ish mesh centred at origin. */
function fixWinding(g) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  let s = 0;
  for (let i = 0; i < pos.count; i += 7) s += pos.getX(i) * nor.getX(i) + pos.getY(i) * nor.getY(i) + pos.getZ(i) * nor.getZ(i);
  if (s < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
}

// ---------------------------------------------------------------- pillows

/**
 * Throw pillow: footprint w (x) × h (y), thickness t (z), centred at origin.
 * pinch = concave edge amount, corner = corner pointiness.
 */
export function pillowGeometry(w, h, t, { n: n0 = 18, pinch = 0.08, plump = 0.6, sag = 0.0, seed = 3, squash = 0, dents = null, ears = 0 } = {}) {
  const n = segs(n0, 8);
  const pos = [], idx = [];
  const r = rng(seed);
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
  const side = (sgn) => {
    const b = pos.length / 3;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const s = -1 + 2 * i / n, u = -1 + 2 * j / n;
      const x = s * w / 2 * (1 - pinch * (1 - u * u));
      const y = u * h / 2 * (1 - pinch * (1 - s * s));
      const prof = Math.pow(Math.max(0, (1 - Math.pow(Math.abs(s), 2.4))), plump) * Math.pow(Math.max(0, (1 - Math.pow(Math.abs(u), 2.4))), plump);
      let z = sgn * t / 2 * prof;
      // soft wrinkles + gravity sag
      z += sgn * t * 0.04 * prof * Math.sin(s * 5 + ph[0]) * Math.sin(u * 4 + ph[1]);
      // shallow dents (someone leaned on it) — front face only
      if (dents && sgn > 0) for (const [dx, dy, dd, dr] of dents) z -= dd * prof * Math.exp(-(((x - dx) ** 2) + ((y - dy) ** 2)) / (dr * dr));
      let yy = y - sag * h * prof * (1 - u * u) * 0.5;
      let xx = x * (1 + squash * prof * 0.1);
      // corner "ears" slightly compressed (pulled in and flattened)
      if (ears) { const cq = (s * s) * (u * u); xx *= 1 - ears * 0.05 * cq; yy *= 1 - ears * 0.05 * cq; z *= 1 - ears * 0.25 * cq; }
      pos.push(xx, yy, z);
    }
    const m = n + 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = b + j * m + i, bb = a + 1, c = a + m, d = c + 1;
      if (sgn > 0) idx.push(a, bb, d, a, d, c); else idx.push(a, d, bb, a, c, d);
    }
  };
  side(1); side(-1);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g = mergeVertices(g, 1e-6);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- legs & lathe

/** Tapered round leg, origin at top centre, extends down by h. */
export function roundLeg(rTop, rBot, h, seg = 16) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
  g.translate(0, -h / 2, 0);
  return g;
}

/** Tapered square leg with slightly eased edges, origin at top centre. */
export function squareLeg(wTop, wBot, h, r = 0.003) {
  const g = softBox(wTop, h, wTop, { r: Math.min(r, wBot / 2.2), seg: 2 });
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i); const t = (h / 2 - y) / h; const k = lerp(1, wBot / wTop, t);
    pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); pos.setY(i, y - h / 2);
  }
  return weldNormals(g);
}

/** Lathe from [[r, y], ...] profile (y up). */
export function lathe(profile, seg = 32) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const g = new THREE.LatheGeometry(pts, segs(seg, 10));
  return g;
}

/** Smooth a polyline profile with Catmull-Rom and return [[r,y]...]. */
export function smoothProfile(points, samples = 40) {
  const curve = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return curve.getPoints(samples).map((p) => [p.x, p.y]);
}

/** Extruded rounded-rect / ellipse / circle slab (top surface at y = h, bottom at 0), with eased edge. */
export function slab(shape, h, { bevel = 0.004, bevelSeg = 3, curveSeg = 48 } = {}) {
  const b = Math.min(bevel, h / 2.5);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.0005, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: bevelSeg, curveSegments: curveSeg });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  return g;
}

export function roundedRectShape(w, d, r) {
  r = Math.min(r, w / 2, d / 2);
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + d - r); s.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + d); s.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

export function ellipseShape(w, d, seg = 64) {
  const s = new THREE.Shape();
  s.absellipse(0, 0, w / 2, d / 2, 0, Math.PI * 2, false, 0);
  return s;
}

/** Superellipse ("squircle") footprint, n = 2 ellipse … 4+ soft rectangle. */
export function superellipseShape(w, d, n = 3, seg = 96) {
  const s = new THREE.Shape();
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const c = Math.cos(t), si = Math.sin(t);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * w / 2;
    const y = Math.sign(si) * Math.pow(Math.abs(si), 2 / n) * d / 2;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  return s;
}

/** Tube along points (CatmullRom), for piping, cords, hairpin legs. */
export function tube(points, radius, { tubular = 64, radial = 8, closed = false, tension = 0.5 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : V3(...p))), closed, 'catmullrom', tension);
  return new THREE.TubeGeometry(curve, segs(tubular, 6), radius, segs(radial, 4), closed);
}

/** Rounded rectangle loop (in XZ at height y), as points for piping. */
export function roundedRectLoop(w, d, r, y = 0, perCorner = 6) {
  const pts = [];
  const cx = [w / 2 - r, -w / 2 + r, -w / 2 + r, w / 2 - r], cz = [d / 2 - r, d / 2 - r, -d / 2 + r, -d / 2 + r];
  const a0 = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  for (let c = 0; c < 4; c++) for (let k = 0; k <= perCorner; k++) {
    const a = a0[c] + (k / perCorner) * Math.PI / 2;
    pts.push(V3(cx[c] + Math.cos(a) * r, y, cz[c] + Math.sin(a) * r));
  }
  return pts;
}

// ---------------------------------------------------------------- builder

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Collects parts (geometry + material + transform), applies metre UVs, merges per material.
 *   const b = new Builder(seed);
 *   b.add(geom, mat, { pos:[x,y,z], rot:[rx,ry,rz], scale:[...], uv:'box'|'keep'|'none', axis:'x' });
 *   const group = b.build();
 */
export class Builder {
  constructor(seed = 1) {
    this.parts = new Map();
    this.rand = rng(seed);
    this.extra = [];
  }
  add(geom, mat, { pos = null, rot = null, scale = null, uv = 'box', axis = 'x', uvScale = 1, uvOffset = null, matrix = null, cast = true, receive = true } = {}) {
    let g = geom;
    if (uv === 'box') {
      const off = uvOffset || [this.rand() * 3, this.rand() * 3];
      g = boxProjectUVs(g, { axis, scale: uvScale, offset: off });
    } else if (uv === 'cyl') {
      g = cylinderUVs(g, { offset: uvOffset || [this.rand() * 3, this.rand() * 3], swap: axis === 'around' });
      if (!g.attributes.normal) g.computeVertexNormals();
    } else {
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      if (!g.attributes.normal) g.computeVertexNormals();
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (matrix) g.applyMatrix4(matrix);
    else if (pos || rot || scale) {
      _e.set(...(rot || [0, 0, 0]));
      _q.setFromEuler(_e);
      _s.set(...(scale || [1, 1, 1]));
      _p.set(...(pos || [0, 0, 0]));
      _m.compose(_p, _q, _s);
      g.applyMatrix4(_m);
    }
    const key = mat.uuid + (cast ? 'c' : '') + (receive ? 'r' : '') + (g.attributes.color ? 'v' : '');
    if (!this.parts.has(key)) this.parts.set(key, { mat, geoms: [], cast, receive });
    this.parts.get(key).geoms.push(g);
    return g;
  }
  /** Add a ready-made Object3D (e.g. custom mesh). */
  addObject(o) { this.extra.push(o); }
  build(name = 'item') {
    const group = new THREE.Group();
    group.name = name;
    for (const { mat, geoms, cast, receive } of this.parts.values()) {
      const hasColor = geoms.some((g) => g.attributes.color);
      if (hasColor) for (const g of geoms) if (!g.attributes.color) {
        const c = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      }
      // merge needs consistent indexing: give non-indexed soups a trivial index (keeps indexed parts compact)
      if (geoms.length > 1 && geoms.some((g) => g.index)) for (const g of geoms) if (!g.index) { const n = g.attributes.position.count; const ix = n > 65535 ? new Uint32Array(n) : new Uint16Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      if (!cast) mesh.userData.noCastShadow = true;
      mesh.name = mat.name || 'part';
      group.add(mesh);
      for (const g of geoms) if (g !== merged) g.dispose();
    }
    for (const o of this.extra) group.add(o);
    return group;
  }
}

/** Triangle count of an object tree. */
export function triCount(obj) {
  let n = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
}
