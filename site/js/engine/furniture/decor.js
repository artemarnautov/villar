// Villar furniture — wall art, plants, decor sets. Owner: modeler.
import * as THREE from 'three';
import { Builder, softBox, lathe, smoothProfile, slab, ellipseShape, roundedRectShape, tube, V3, clamp, lerp, cm } from './geom.js';
import { rng, hashStr } from '../textures.js';

// ---------------------------------------------------------------- wall art

export function wallArt(c) {
  const { W, H, D, params: p } = c;
  const b = new Builder(c.seed);
  const frameKey = String(p.frame || 'walnut-dark').toLowerCase();
  const depth = clamp(D, 0.015, 0.06);
  const isMirror = /mirror/.test(String(p.kind || p.motif || c.item?.type || ''));
  if (frameKey === 'none' || frameKey.includes('canvas') || frameKey.includes('wrap')) {
    // gallery-wrapped canvas on a stretcher
    const art = c.mat('canvas', { motif: p.motif, colors: p.colors, w: W, h: H, seed: c.seed });
    const g = new THREE.PlaneGeometry(W, H);
    b.add(g, art, { pos: [0, 0, depth], uv: 'keep' });
    const bgc = (p.colors || []).find((x) => new THREE.Color(x).getHSL({}).l > 0.75) || '#efe8dc';
    b.add(softBox(W, H, depth - 0.001, { r: 0.002, seg: 1 }), c.mat('paper', { color: bgc }), { pos: [0, 0, depth / 2 - 0.0005] });
    return { group: b.build('wall_art') };
  }
  const frameMat = frameKey.includes('white') ? c.mat('kitchen-front', { color: '#f2efe9' }) : frameKey.includes('black') ? c.mat('lacquer', { color: '#1c1b1a', roughness: 0.45 }) : frameKey.includes('brass') || frameKey.includes('gold') ? c.mat('metal-brass') : c.mat(frameKey);
  const fw = clamp(cm(p.frameWidth, Math.min(W, H) * 0.035), 0.012, 0.06);
  // frame bars (mitred look via overlapping soft boxes)
  const bar = (w, h, x, y, axis) => b.add(softBox(w, h, depth, { r: Math.min(0.003, fw / 4), seg: 2 }), frameMat, { pos: [x, y, depth / 2], axis });
  bar(W, fw, 0, H / 2 - fw / 2, 'x');
  bar(W, fw, 0, -H / 2 + fw / 2, 'x');
  bar(fw, H - 2 * fw + 0.0004, -W / 2 + fw / 2, 0, 'y');
  bar(fw, H - 2 * fw + 0.0004, W / 2 - fw / 2, 0, 'y');
  const iw = W - 2 * fw, ih = H - 2 * fw;
  // backing
  b.add(new THREE.BoxGeometry(iw, ih, 0.004), c.mat('paper', { color: '#3b342e' }), { pos: [0, 0, 0.004] });
  if (isMirror) {
    b.add(new THREE.PlaneGeometry(iw, ih), c.mat('mirror'), { pos: [0, 0, depth - 0.006], uv: 'keep' });
    return { group: b.build('wall_art') };
  }
  const matW = p.mat === false || p.passepartout === false ? 0 : clamp(cm(p.matWidth, Math.min(iw, ih) * 0.12), 0, Math.min(iw, ih) * 0.3);
  const aw = iw - 2 * matW, ah = ih - 2 * matW;
  const art = c.mat('canvas', { motif: p.motif, colors: p.colors, w: aw, h: ah, seed: c.seed });
  b.add(new THREE.PlaneGeometry(aw, ah), art, { pos: [0, 0, depth - 0.008], uv: 'keep' });
  if (matW > 0) {
    const mm = c.mat('paper', { color: p.matColor || '#f3efe7' });
    const mt = 0.002, z = depth - 0.006;
    b.add(new THREE.BoxGeometry(iw, matW, mt), mm, { pos: [0, ih / 2 - matW / 2, z] });
    b.add(new THREE.BoxGeometry(iw, matW, mt), mm, { pos: [0, -ih / 2 + matW / 2, z] });
    b.add(new THREE.BoxGeometry(matW, ah, mt), mm, { pos: [-iw / 2 + matW / 2, 0, z] });
    b.add(new THREE.BoxGeometry(matW, ah, mt), mm, { pos: [iw / 2 - matW / 2, 0, z] });
  }
  return { group: b.build('wall_art') };
}

// ---------------------------------------------------------------- plants

/** Tapered sweep along a CatmullRom path. radius(t) in metres. Adds per-vertex colour if given. */
function sweep(points, radius, { radial = 7, tubular = null } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const n = tubular || Math.max(4, points.length * 3);
  const frames = curve.computeFrenetFrames(n, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const t = i / n; curve.getPointAt(t, P);
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      N.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r); nor.push(N.x, N.y, N.z); uv.push(j / radial * 0.05, t * 0.5);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b2 = a + radial + 1;
    idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geom: g, curve };
}

/** Merge many leaf instances into one geometry with per-leaf vertex colours. */
class LeafBatch {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.v = 0; }
  add(tmpl, matrix, color) {
    const p = tmpl.attributes.position, n = tmpl.attributes.normal, u = tmpl.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), vn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix); vn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(vn.x, vn.y, vn.z); this.uv.push(u.getX(i), u.getY(i));
      const k = tmpl.userData.shade ? tmpl.userData.shade[i] : 1;
      this.col.push(color.r * k, color.g * k, color.b * k);
    }
    const ix = tmpl.index.array;
    for (let i = 0; i < ix.length; i++) this.idx.push(ix[i] + this.v);
    this.v += p.count;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Leaf template: grid in leaf space (u across 0..1, v along 0..1), length L along +Y, width from outline(v).
 * fold = V-fold along midrib, arch = curvature along length, holes = monstera fenestration.
 */
function leafTemplate({ L = 0.06, Wd = 0.012, outline = (v) => Math.sin(Math.PI * Math.min(1, v * 1.05)) ** 0.8, nu = 2, nv = 4, fold = 0.25, arch = 0.15, wave = 0, holes = null }) {
  const pos = [], uv = [], idx = [], shade = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const w = outline(v) * Wd / 2;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu; const s = u * 2 - 1;
      const x = s * w;
      const y = v * L;
      let z = Math.abs(s) * w * fold + Math.sin(v * Math.PI) * L * arch * 0.0 - (v * v) * L * arch;
      if (wave) z += Math.sin(v * 14 + s * 2) * wave * Math.abs(s);
      pos.push(x, y, z); uv.push(u, v); shade.push(0.9 + 0.1 * (1 - Math.abs(s)));
    }
  }
  const m = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (holes && holes((i + 0.5) / nu, (j + 0.5) / nv)) continue;
    const a = j * m + i, b2 = a + 1, c2 = a + m, d = c2 + 1;
    idx.push(a, b2, d, a, d, c2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.shade = shade;
  return g;
}

/**
 * Monstera deliciosa leaf: cordate blade split into lobes by slits that run from the margin toward
 * the midrib along the lateral veins (built as separate lobe strips → clean cuts), length along +Y.
 */
function monsteraLeaf({ L = 0.4, Wd = 0.38, lobes = 7, seed = 1, fold = 0.1, arch = 0.18 }) {
  const r = rng(seed);
  const pos = [], uv = [], idx = [], shade = [];
  const outline = (v) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + v * 0.9)), 0.4) * (1 - 0.15 * v);
  const tilt = 0.22; // lateral veins rise toward the margin
  const vert = (sgn, sa, v) => {
    const w = outline(v) * Wd / 2;
    const x = sgn * sa * w, y = v * L;
    const z = sa * w * fold - v * v * L * arch;
    pos.push(x, y, z); uv.push(0.5 + sgn * sa * 0.5, v); shade.push(0.9 + 0.1 * (1 - sa));
    return pos.length / 3 - 1;
  };
  const NS = 6, NV = 3;
  for (const sgn of [-1, 1]) {
    for (let k = 0; k < lobes; k++) {
      const gapK = 0.1 + r() * 0.1, reach = 0.35 + r() * 0.35; // slit width at margin, slit depth start
      const base = pos.length / 3;
      for (let i = 0; i <= NS; i++) {
        const sa = i / NS; // 0 = midrib, 1 = margin
        const g = sa < reach ? 0 : ((sa - reach) / (1 - reach)) * gapK;
        for (let j = 0; j <= NV; j++) {
          const ph = k + g / 2 + (1 - g) * (j / NV);
          let v = ph / lobes + sa * tilt * (1 - ph / lobes);
          v = Math.min(1, Math.max(0, v));
          vert(sgn, sa, v);
        }
      }
      const m = NV + 1;
      for (let i = 0; i < NS; i++) for (let j = 0; j < NV; j++) {
        const a = base + i * m + j, b2 = a + 1, c2 = a + m, d = c2 + 1;
        if (sgn > 0) idx.push(a, c2, d, a, d, b2); else idx.push(a, d, c2, a, b2, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.shade = shade;
  return g;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s3 = new THREE.Vector3();
/** Matrix placing a leaf at point p, pointing along dir, with roll around dir and scale. */
function leafMatrix(p, dir, roll, scale) {
  _q.setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize());
  _q2.setFromAxisAngle(V3(0, 1, 0), roll);
  _q.multiply(_q2);
  _s3.set(scale, scale, scale);
  return _m4.clone().compose(p, _q, _s3);
}

function addPot(b, c, { r, h, style, color }) {
  const s = String(style || 'ceramic-matte').toLowerCase();
  let mat;
  if (/rattan|basket|wicker|seagrass|jute/.test(s)) mat = c.mat(/jute|seagrass/.test(s) ? 'jute' : 'rattan');
  else if (/concrete|cement|stone/.test(s)) mat = c.mat('stone-worktop');
  else if (/terracotta|clay/.test(s)) mat = c.mat('ceramic-matte', { color: color || '#b5653f' });
  else if (/travert/.test(s)) mat = c.mat('travertine');
  else if (/glaze/.test(s)) mat = c.mat('ceramic-glazed', { color: color || '#e8e2d6' });
  else mat = c.mat('ceramic-matte', { color: color || '#CBB89A' });
  const shape = String(c.params.potShape || (/basket|rattan/.test(s) ? 'basket' : 'cylinder')).toLowerCase();
  let prof;
  if (shape.includes('bowl')) prof = [[0.001, 0], [r * 0.55, 0], [r * 0.62, 0.006], [r * 0.95, h * 0.55], [r, h * 0.96], [r * 0.96, h], [r * 0.9, h * 0.97], [r * 0.86, h * 0.75]];
  else if (shape.includes('taper')) prof = [[0.001, 0], [r * 0.72, 0], [r * 0.75, 0.008], [r * 0.98, h * 0.94], [r, h], [r * 0.93, h], [r * 0.9, h * 0.85]];
  else if (shape.includes('egg') || shape.includes('round')) prof = [[0.001, 0], [r * 0.5, 0], [r * 0.85, h * 0.25], [r, h * 0.6], [r * 0.85, h * 0.95], [r * 0.8, h], [r * 0.74, h * 0.97], [r * 0.7, h * 0.85]];
  else prof = [[0.001, 0], [r * 0.9, 0], [r * 0.94, 0.006], [r * 0.97, h * 0.5], [r, h * 0.985], [r * 0.985, h], [r * 0.93, h], [r * 0.91, h * 0.9]];
  b.add(lathe(smoothProfile(prof, 48), 48), mat, { uv: 'box' });
  const soilY = h * 0.9;
  const sr = (shape.includes('egg') ? r * 0.72 : r * 0.9);
  const soil = lathe([[sr * 1.01, soilY - 0.03], [sr, soilY - 0.004], [sr * 0.6, soilY + 0.008], [0.001, soilY + 0.012]], 32);
  b.add(soil, c.mat('soil'), { uv: 'box', cast: false });
  return soilY + 0.008;
}

function plantColors(base, n, r, spread = 0.12) {
  const out = []; const c0 = new THREE.Color(base);
  const hsl = {}; c0.getHSL(hsl);
  for (let i = 0; i < n; i++) out.push(new THREE.Color().setHSL(hsl.h + (r() - 0.5) * 0.04, clamp(hsl.s + (r() - 0.5) * spread, 0, 1), clamp(hsl.l + (r() - 0.5) * spread, 0, 1)));
  return out;
}

export function plant(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const r = rng(c.seed + 17);
  const species = String(p.species || 'olive-tree').toLowerCase();
  const potR = clamp(p.potDiameter ? cm(p.potDiameter) / 2 : Math.min(W * 0.3, H * 0.12, 0.24), 0.05, 0.3);
  const potH = clamp(p.potHeight ? cm(p.potHeight) : potR * 2 * (H > 1.0 ? 0.95 : 0.85), 0.08, 0.6);
  const soilY = addPot(b, c, { r: potR, h: potH, style: p.pot, color: p.potColor });
  const leaves = new LeafBatch();
  const stems = [];
  const leafMat = c.mat('plant-leaf', { vertexColors: true, roughness: species.includes('fiddle') || species.includes('rubber') ? 0.32 : 0.5 });
  const stemMat = c.mat('plant-stem', { color: '#6b6248' });
  const barkMat = c.mat('bark', { color: '#cfc4b4' });
  let kind = 'olive';
  if (/fiddle|lyrata|rubber|elastica|audrey|benghal|ficus/.test(species)) kind = 'fiddle';
  else if (/bird|strelitzia|banana|musa|heliconia/.test(species)) kind = 'bird';
  else if (/monstera|philo|calathea|alocasia/.test(species)) kind = 'monstera';
  else if (/snake|sansev|zz|aloe|yucca|dracaena|cactus/.test(species)) kind = 'snake';
  else if (/palm|areca|kentia|fern/.test(species)) kind = 'palm';

  if (kind === 'olive') {
    // multi-stem olive: short trunk splitting into 3 leaders, airy rounded canopy of ~1500 silver-green leaves
    const crownY = lerp(soilY, H, 0.42), top = H;
    const trunkPts = [V3(0, soilY - 0.03, 0)];
    let x = 0, z = 0;
    for (let i = 1; i <= 4; i++) { x += (r() - 0.5) * 0.035; z += (r() - 0.5) * 0.035; trunkPts.push(V3(x, lerp(soilY, crownY, i / 4), z)); }
    const tr = sweep(trunkPts, (t) => lerp(0.032, 0.02, t) * (1 + 0.12 * Math.sin(t * 17 + 1)), { radial: 10 });
    b.add(tr.geom, barkMat, { uv: 'keep' });
    const tmpl = leafTemplate({ L: 0.075, Wd: 0.015, nu: 2, nv: 2, fold: 0.3, arch: 0.18 });
    const cols = plantColors('#7f8f68', 32, r, 0.18);
    const canopy = { c: V3(0, lerp(crownY, top, 0.56), 0), rx: W / 2 * 0.92, ry: (top - crownY) * 0.52 };
    const leafAt = (lp, tan, k) => {
      const rel = lp.clone().sub(canopy.c);
      const e = Math.hypot(rel.x / canopy.rx, rel.y / canopy.ry, rel.z / canopy.rx);
      if (e > 1.08) return;
      const side = k % 2 ? 1 : -1;
      const perp = V3(-tan.z, 0, tan.x).normalize().multiplyScalar(side);
      const ld = tan.clone().multiplyScalar(0.55).add(perp).add(V3(0, -0.25 + r() * 0.5, 0)).normalize();
      leaves.add(tmpl, leafMatrix(lp, ld, r() * Math.PI, 0.75 + r() * 0.5), cols[(r() * cols.length) | 0]);
    };
    const branch = (start, dir, len, rad, depth) => {
      const pts = [start.clone()];
      const d = dir.clone().normalize();
      const n = depth === 0 ? 5 : 3;
      for (let i = 1; i <= n; i++) {
        d.x += (r() - 0.5) * 0.4; d.z += (r() - 0.5) * 0.4; d.y += depth === 0 ? 0.05 : -0.02; d.normalize();
        const np = pts[i - 1].clone().addScaledVector(d, len / n);
        // pull back inside the canopy envelope
        const rel = np.clone().sub(canopy.c);
        const e = Math.hypot(rel.x / canopy.rx, rel.y / canopy.ry, rel.z / canopy.rx);
        if (e > 0.95) np.sub(rel.multiplyScalar(0.25 * (e - 0.95) / e));
        pts.push(np);
      }
      const sw = sweep(pts, (t) => lerp(rad, rad * 0.5, t), { radial: depth === 0 ? 7 : depth === 1 ? 5 : 4, tubular: depth === 0 ? 14 : 6 });
      b.add(sw.geom, depth === 0 ? barkMat : stemMat, { uv: 'keep' });
      if (depth < 2) {
        const kids = depth === 0 ? 5 : 4;
        for (let k = 0; k < kids; k++) {
          const t = 0.35 + 0.65 * ((k + r() * 0.5) / kids);
          const sp = sw.curve.getPointAt(Math.min(1, t));
          const tan = sw.curve.getTangentAt(Math.min(1, t));
          const a = r() * Math.PI * 2;
          const out = V3(Math.cos(a), 0.25 + r() * 0.5, Math.sin(a)).normalize();
          branch(sp, tan.clone().multiplyScalar(0.6).add(out).normalize(), len * (0.5 + r() * 0.15), rad * 0.55, depth + 1);
        }
      }
      if (depth >= 1) {
        const count = depth === 2 ? 36 : 18;
        for (let k = 0; k < count; k++) {
          const t = 0.2 + 0.8 * (k / count);
          leafAt(sw.curve.getPointAt(t), sw.curve.getTangentAt(t), k);
        }
        // tip tuft
        const tip = sw.curve.getPointAt(1), tt = sw.curve.getTangentAt(1);
        for (let k = 0; k < 5; k++) leafAt(tip.clone().add(V3((r() - 0.5) * 0.02, (r() - 0.5) * 0.02, (r() - 0.5) * 0.02)), tt.clone().add(V3(r() - 0.5, r() - 0.3, r() - 0.5)).normalize(), k);
      }
    };
    const nMain = 3 + (r() < 0.5 ? 1 : 0);
    const tip = trunkPts[trunkPts.length - 1];
    for (let i = 0; i < nMain; i++) {
      const a = (i / nMain) * Math.PI * 2 + r() * 0.8;
      branch(tip.clone().add(V3(0, -0.02 * i, 0)), V3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5), (top - crownY) * 0.62, 0.016, 0);
    }
  } else if (kind === 'fiddle') {
    const stemsN = clamp(Math.round(p.stems || 1), 1, 3);
    const audrey = /audrey|benghal|elastica|rubber|ficus(?!.*lyrata)/.test(species) && !/fiddle|lyrata/.test(species);
    const tmpl = audrey ? leafTemplate({ L: 0.16, Wd: 0.1, outline: (v) => Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.02)), 0.7), nu: 4, nv: 7, fold: 0.15, arch: 0.15 }) : leafTemplate({ L: 0.28, Wd: 0.2, outline: (v) => { const a = Math.sin(Math.PI * Math.min(1, v * 1.02)) ** 0.6; return a * (0.62 + 0.38 * Math.sin(v * Math.PI * 0.9) ** 2) * (v > 0.85 ? 1 - (v - 0.85) * 2.2 : 1); }, nu: 6, nv: 10, fold: 0.18, arch: 0.22, wave: 0.004 });
    const cols = plantColors(audrey ? '#4d6b3a' : '#3f5f2e', 20, r, 0.1);
    for (let s = 0; s < stemsN; s++) {
      const ox = (s - (stemsN - 1) / 2) * 0.05;
      const pts = [V3(ox, soilY - 0.02, 0)];
      for (let i = 1; i <= 6; i++) pts.push(V3(ox + (r() - 0.5) * 0.03 + ox * i * 0.3, lerp(soilY, H - 0.12 - s * 0.12, i / 6), (r() - 0.5) * 0.03));
      const sw = sweep(pts, (t) => lerp(0.016, 0.008, t), { radial: 8 });
      b.add(sw.geom, barkMat, { uv: 'keep' });
      const n = audrey ? 34 : 22;
      for (let k = 0; k < n; k++) {
        const t = (audrey ? 0.45 : 0.35) + (audrey ? 0.55 : 0.65) * (k / (n - 1));
        const lp = sw.curve.getPointAt(t);
        const a = k * 2.4 + s;
        const out = V3(Math.cos(a), 0.55 + t * 0.5, Math.sin(a)).normalize();
        const sc = (0.8 + 0.3 * Math.sin(t * Math.PI)) * clamp(W / 0.55, 0.75, 1.35) * (t > 0.95 ? 0.7 : 1);
        leaves.add(tmpl, leafMatrix(lp.clone().addScaledVector(out, 0.02), out, a + Math.PI / 2 + (r() - 0.5) * 0.6, sc), cols[(r() * cols.length) | 0]);
      }
    }
  } else if (kind === 'bird') {
    // Strelitzia nicolai: long upright petioles, large paddle leaves with natural tears
    const n = 8;
    const cols = plantColors('#3e5c34', 12, r, 0.1);
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996 + r() * 0.5;
      const lean = 0.06 + r() * 0.3;
      const avail = H - soilY;
      const L = clamp(avail * (0.3 + r() * 0.08), 0.25, 0.65);
      const petL = Math.max(0.2, (avail - L * Math.cos(lean * 1.3)) * (0.7 + r() * 0.3));
      const out = V3(Math.cos(a), 0, Math.sin(a));
      const base = V3(Math.cos(a) * 0.03, soilY - 0.01, Math.sin(a) * 0.03);
      const top = base.clone().addScaledVector(out, Math.sin(lean) * petL).add(V3(0, Math.cos(lean) * petL, 0));
      const mid = base.clone().lerp(top, 0.5).addScaledVector(out, -0.01);
      const sw = sweep([base, mid, top], (t) => lerp(0.014, 0.008, t), { radial: 6, tubular: 10 });
      b.add(sw.geom, stemMat, { uv: 'keep' });
      const tears = Array.from({ length: 4 + ((r() * 4) | 0) }, () => [0.2 + r() * 0.7, r() < 0.5 ? -1 : 1, 0.25 + r() * 0.6]);
      const tmpl = leafTemplate({ L, Wd: L * 0.36, outline: (v) => Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.0)), 0.6), nu: 8, nv: 30, fold: 0.1, arch: 0.12, wave: 0.004,
        holes: (u, v) => tears.some(([tv, sd, dp]) => Math.abs(v - tv) < 0.018 && Math.sign(u - 0.5) === sd && Math.abs(u * 2 - 1) > 1 - dp) });
      const dir = top.clone().sub(base).normalize().addScaledVector(out, 0.35).normalize();
      leaves.add(tmpl, leafMatrix(top, dir, a + Math.PI / 2 + (r() - 0.5) * 0.8, 1), cols[(r() * cols.length) | 0]);
    }
  } else if (kind === 'monstera' || kind === 'palm') {
    const isPalm = kind === 'palm';
    const nLeaves = isPalm ? 9 : 11;
    const leafL = isPalm ? 0.12 : clamp(H * 0.3, 0.18, 0.42);
    // fenestration: slits from the margin toward the midrib following the lateral veins + small oval holes
    const holes = isPalm ? null : (u, v) => {
      const sgn = u < 0.5 ? 0 : 1, s = Math.abs(u * 2 - 1);
      if (v < 0.1 || v > 0.9) return false;
      const ph = (v - s * 0.22) * 6.5;
      const idx = Math.floor(ph), f = ph - idx;
      const hsh = Math.abs(Math.sin(idx * 12.9898 + sgn * 78.233) * 43758.5453) % 1;
      if (s > 0.42 + hsh * 0.25 && Math.abs(f - 0.5) < 0.07) return true;
      if (hsh > 0.35 && s > 0.17 && s < 0.32 && Math.abs(f - 0.5) < 0.12 && v > 0.2 && v < 0.78) return true;
      return false;
    };
    const monsteraOutline = (v) => { const a = Math.sin(Math.PI * Math.min(1, 0.06 + v * 0.94)); return Math.pow(a, 0.45) * (1 - 0.2 * v); };
    const tmpls = isPalm ? [leafTemplate({ L: 0.2, Wd: 0.025, nu: 2, nv: 4, fold: 0.3, arch: 0.25 })] : [0, 1, 2].map((q) => monsteraLeaf({ L: leafL, Wd: leafL * 1.0, lobes: 6, seed: c.seed + q * 31 }));
    const tmpl = tmpls[0];
    void holes; void monsteraOutline;
    const cols = plantColors(isPalm ? '#4f6d36' : '#2f5428', 20, r, 0.1);
    for (let k = 0; k < nLeaves; k++) {
      const a = (k / nLeaves) * Math.PI * 2 * 1.618 + r() * 0.4;
      const tilt = 0.25 + r() * 0.7;
      const sh = (H - soilY) * (0.55 + r() * 0.4) - (isPalm ? 0 : leafL * 0.6);
      const outv = V3(Math.cos(a), 0, Math.sin(a));
      const base = V3(Math.cos(a) * 0.02, soilY - 0.01, Math.sin(a) * 0.02);
      const tipStem = base.clone().addScaledVector(outv, Math.sin(tilt) * sh * 0.5).add(V3(0, Math.cos(tilt * 0.6) * sh, 0));
      const mid = base.clone().lerp(tipStem, 0.5).add(V3(0, sh * 0.08, 0)).addScaledVector(outv, -0.02);
      const sw = sweep([base, mid, tipStem], (t) => lerp(isPalm ? 0.006 : 0.009, 0.005, t), { radial: 6, tubular: 10 });
      b.add(sw.geom, stemMat, { uv: 'keep' });
      if (isPalm) {
        // frond: arching rachis with leaflets on both sides
        const fr = [tipStem.clone()];
        const d = outv.clone().multiplyScalar(0.6).add(V3(0, 0.7, 0)).normalize();
        for (let i = 1; i <= 5; i++) { d.y -= 0.22; d.normalize(); fr.push(fr[i - 1].clone().addScaledVector(d, W * 0.12)); }
        const rs = sweep(fr, (t) => lerp(0.004, 0.0015, t), { radial: 4, tubular: 12 });
        b.add(rs.geom, stemMat, { uv: 'keep' });
        for (let i = 0; i < 22; i++) {
          const t = 0.08 + 0.9 * (i / 22);
          const lp = rs.curve.getPointAt(t); const tan = rs.curve.getTangentAt(t);
          for (const sd of [-1, 1]) {
            const perp = V3(-tan.z, 0, tan.x).normalize().multiplyScalar(sd);
            const ld = perp.clone().add(tan.clone().multiplyScalar(0.8)).add(V3(0, -0.25, 0)).normalize();
            leaves.add(tmpl, leafMatrix(lp, ld, Math.PI / 2, (1 - t * 0.5) * clamp(W / 0.6, 0.6, 1.4)), cols[(r() * cols.length) | 0]);
          }
        }
      } else {
        const ld = outv.clone().multiplyScalar(Math.sin(tilt) + 0.3).add(V3(0, Math.cos(tilt) * 0.8, 0)).normalize();
        leaves.add(tmpls[k % tmpls.length], leafMatrix(tipStem, ld, Math.PI / 2 + (r() - 0.5) * 0.5, 0.75 + r() * 0.35), cols[(r() * cols.length) | 0]);
      }
    }
  } else {
    // snake plant: upright sword blades with banding
    const n = 12;
    const cols = plantColors('#2f4a2a', 10, r, 0.08);
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, rad = r() * potR * 0.55;
      const L = (H - soilY) * (0.6 + r() * 0.4);
      const Wd = 0.05 + r() * 0.025;
      const tmpl = leafTemplate({ L, Wd, outline: (v) => Math.min(1, Math.sin(Math.PI * Math.min(1, v * 0.98)) ** 0.25) * (1 - v * 0.35), nu: 4, nv: 12, fold: 0.35, arch: 0.02 });
      const shade = tmpl.userData.shade;
      const pa = tmpl.attributes.position;
      for (let i = 0; i < pa.count; i++) { const y = pa.getY(i) / L; const x = Math.abs(pa.getX(i)) / (Wd / 2 + 1e-6); shade[i] = (0.75 + 0.35 * (Math.sin(y * 38 + Math.sin(y * 9) * 2) > 0.3 ? 1 : 0)) * (x > 0.85 ? 1.5 : 1); }
      const dir = V3(Math.cos(a) * 0.15 * (0.5 + r()), 1, Math.sin(a) * 0.15 * (0.5 + r())).normalize();
      leaves.add(tmpl, leafMatrix(V3(Math.cos(a) * rad, soilY - 0.01, Math.sin(a) * rad), dir, a + r(), 1), cols[(r() * cols.length) | 0]);
    }
  }
  const lg = leaves.geometry();
  b.add(lg, leafMat, { uv: 'keep' });
  return { group: b.build('plant') };
}

// ---------------------------------------------------------------- decor set

function book(b, c, { w, d, t, color, x, y, z, rotY = 0 }) {
  const cover = c.mat('fabric-linen', { color });
  const pages = c.mat('pages');
  const g = new THREE.Group();
  const ct = 0.0022;
  const m = new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), rotY), V3(1, 1, 1));
  const add = (geom, mat, pos, opt = {}) => { geom.translate(...pos); geom.applyMatrix4(m); b.add(geom, mat, { uv: opt.uv || 'box', axis: opt.axis || 'x' }); };
  add(softBox(w, ct, d, { r: 0.001, seg: 1 }), cover, [0, ct / 2, 0]);
  add(softBox(w, ct, d, { r: 0.001, seg: 1 }), cover, [0, t - ct / 2, 0]);
  // spine (rounded) on -x side
  const sp = new THREE.CylinderGeometry(t / 2, t / 2, d, 10, 1, false, Math.PI, Math.PI); sp.rotateX(Math.PI / 2); sp.scale(0.35, 1, 1);
  add(sp, cover, [-w / 2 + 0.001, t / 2, 0]);
  // page block (inset), with page lines running along v
  const pb = new THREE.BoxGeometry(w - 0.006, t - 2 * ct, d - 0.006);
  add(pb, pages, [0.001, t / 2, 0], { axis: 'x' });
  void g;
}

function vaseProfile(kind, h, r) {
  switch (kind) {
    case 'vase-tall': case 'bottle': return [[0.001, 0], [r * 0.7, 0], [r * 0.76, 0.006], [r, h * 0.35], [r * 0.82, h * 0.62], [r * 0.32, h * 0.82], [r * 0.28, h * 0.97], [r * 0.34, h], [r * 0.26, h * 0.99], [r * 0.24, h * 0.9]];
    case 'vase-round': case 'vase': return [[0.001, 0], [r * 0.5, 0], [r * 0.9, h * 0.3], [r, h * 0.55], [r * 0.72, h * 0.85], [r * 0.4, h * 0.97], [r * 0.42, h], [r * 0.34, h * 0.98], [r * 0.3, h * 0.88]];
    case 'jar': return [[0.001, 0], [r * 0.8, 0], [r, h * 0.3], [r, h * 0.8], [r * 0.7, h * 0.95], [r * 0.7, h], [r * 0.62, h], [r * 0.6, h * 0.9]];
    case 'bowl': return [[0.001, 0], [r * 0.45, 0], [r * 0.5, 0.006], [r * 0.85, h * 0.45], [r, h], [r * 0.95, h], [r * 0.82, h * 0.5], [r * 0.4, h * 0.12], [0.001, h * 0.1]];
    case 'candle': return [[0.001, 0], [r, 0], [r, h], [r * 0.9, h], [0.001, h * 0.98]];
    default: return [[0.001, 0], [r, 0], [r, h], [0.001, h]];
  }
}

export function decorSet(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const r = rng(c.seed + 3);
  // items: 'vase-tall' | 'vase-tall:travertine' | { type, material, color }; params.materials[i] also accepted
  const raw = p.items && p.items.length ? p.items : ['vase-tall', 'books', 'bowl'];
  const hints = p.materialHints && p.materialHints.length >= raw.length ? p.materialHints : null;
  const itemMats = raw.map((s, i) => (typeof s === 'object' ? s.material : String(s).split(':')[1]) || (p.materials && p.materials[i]) || (hints && hints[i]) || null);
  const heights = (p.heights || []).map((h) => cm(h, null));
  const itemCols = raw.map((s) => (typeof s === 'object' ? s.color : null));
  const list = raw.map((s) => String(typeof s === 'object' ? s.type || s.kind || 'vase' : s).split(':')[0].toLowerCase());
  let curIdx = 0;
  const colors = p.colors && p.colors.length ? p.colors : ['#CBB89A', '#3B3B3B', '#B5653F'];
  const col = (i) => colors[i % colors.length];
  // footprint per item
  const fp = list.map((k) => (k.includes('book') ? 0.24 : k.includes('tray') ? Math.min(W, 0.36) : k.includes('bowl') ? Math.min(0.22, W * 0.45) : k.includes('tall') || k.includes('bottle') ? 0.12 : k.includes('candle') ? 0.08 : 0.13));
  const total = fp.reduce((a, v) => a + v, 0) + 0.03 * (list.length - 1);
  const k0 = Math.min(1, W / total);
  let x = -Math.min(W, total) / 2;
  let booksTop = null;
  let trayY = 0;
  const trayIdx = list.findIndex((k) => k.includes('tray'));
  if (trayIdx >= 0) {
    // the tray carries the other objects: draw it first, full width, then lay the rest out on it
    const tw = Math.min(W, Math.max(0.3, total * 0.8)), td = Math.min(D, 0.26);
    const tm = itemMats[trayIdx] ? c.mat(itemMats[trayIdx]) : c.mat(p.trayMaterial || 'walnut-dark');
    b.add(slab(roundedRectShape(tw, td, 0.03), 0.012, { bevel: 0.003 }), tm, {});
    b.add(tube([...Array(33)].map((_, j) => { const a = (j / 32) * Math.PI * 2; const ca = Math.cos(a), sa = Math.sin(a); return V3(Math.sign(ca) * Math.pow(Math.abs(ca), 0.4) * (tw / 2 - 0.004), 0.018, Math.sign(sa) * Math.pow(Math.abs(sa), 0.4) * (td / 2 - 0.004)); }), 0.0045, { tubular: 96, radial: 5, closed: true }), tm, {});
    trayY = 0.012;
    fp[trayIdx] = 0;
    const tot2 = fp.reduce((a, v) => a + v, 0) + 0.025 * (list.length - 2);
    x = -Math.min(tw - 0.04, tot2) / 2;
  }
  list.forEach((kind, i) => {
    curIdx = i;
    if (i === trayIdx) return;
    const w = fp[i] * k0;
    let cx = x + w / 2; let cz = (i % 2 ? 0.25 : -0.2) * D * 0.5; let baseY = 0;
    const color = itemCols[i] || col(i);
    if (kind.includes('book')) {
      const n = 2 + (r() < 0.5 ? 1 : 0);
      let y = 0;
      const bc = ['#3b3b3b', '#d9cdb8', '#7a7b55', '#b5653f', '#e6ddcf', '#5a4a3a'];
      for (let k = 0; k < n; k++) {
        const bw = Math.min(w, 0.24 - k * 0.02 - r() * 0.02), bd = Math.min(D * 0.9, 0.17 - k * 0.01), bt = 0.022 + r() * 0.014;
        book(b, c, { w: bw, d: bd, t: bt, color: k === 0 ? color : bc[(k * 2 + i) % bc.length], x: cx, y, z: cz * 0.3, rotY: (r() - 0.5) * 0.25 });
        y += bt;
      }
      booksTop = { x: cx, y, z: cz * 0.3 };
    } else if ((kind.includes('bowl') || kind.includes('sculpt') || kind.includes('object') || kind.includes('candle') || kind.includes('stone')) && booksTop && list.indexOf(kind) === list.findIndex((q) => q === kind) && i === list.findIndex((q) => q.includes('book')) + 1 && !kind.includes('bowl')) {
      cx = booksTop.x; cz = booksTop.z; baseY = booksTop.y; addSmall(kind, cx, baseY, cz, color);
    } else if (kind.includes('tray')) {
      const tw = w, td = Math.min(D, 0.24);
      b.add(slab(roundedRectShape(tw, td, 0.03), 0.012, { bevel: 0.003 }), c.mat(p.trayMaterial || 'walnut-dark'), { pos: [cx, 0, cz * 0.2] });
      b.add(tube([...Array(33)].map((_, j) => { const a = (j / 32) * Math.PI * 2; return V3(cx + Math.cos(a) * (tw / 2 - 0.004), 0.02, cz * 0.2 + Math.sin(a) * (td / 2 - 0.004)); }), 0.004, { tubular: 64, radial: 5, closed: true }), c.mat(p.trayMaterial || 'walnut-dark'), {});
    } else {
      addSmall(kind, cx, trayY, trayY ? cz * 0.3 : cz, color);
    }
    x += w + 0.03 * k0;
  });

  function addSmall(kind, cx, y0, cz, color) {
    let mk = itemMats[curIdx];
    if (mk && mk.includes(':')) { color = mk.split(':')[1]; mk = mk.split(':')[0]; }
    const HH = heights[curIdx];
    const ceramic = mk ? c.mat(mk, /ceram|glaze|paint|matte/.test(mk) ? { color } : {}) : c.mat(/glaze|gloss/.test(kind) ? 'ceramic-glazed' : /amber|glass/.test(kind) ? 'glass-amber' : /brass|candlestick/.test(kind) ? 'metal-brass' : /travert/.test(kind) ? 'travertine' : /marble/.test(kind) ? 'marble-white' : /wood|walnut/.test(kind) ? 'walnut-dark' : 'ceramic-matte', { color });
    if (kind.includes('tall') || kind.includes('bottle')) {
      const h = HH || Math.min(H * 0.92, 0.34), rr = Math.min(0.07, h * 0.18);
      b.add(lathe(smoothProfile(vaseProfile('vase-tall', h, rr), 40), 40), ceramic, { pos: [cx, y0, cz], uv: 'box' });
      // dried branches
      if (p.stems !== false) {
        const stem = c.mat('plant-stem', { color: '#8a7a5c' });
        const leaf = c.mat('plant-leaf', { color: '#b9a98a', roughness: 0.7 });
        const lt = leafTemplate({ L: 0.03, Wd: 0.012, nu: 2, nv: 3, fold: 0.2 });
        const lb = new LeafBatch();
        for (let k = 0; k < 3; k++) {
          const a = k * 2.1 + r();
          const pts = [V3(cx, y0 + h * 0.75, cz), V3(cx + Math.cos(a) * 0.03, y0 + h + 0.1, cz + Math.sin(a) * 0.03), V3(cx + Math.cos(a) * 0.09, y0 + h + 0.2 + r() * 0.08, cz + Math.sin(a) * 0.09)];
          const sw = sweep(pts, () => 0.0018, { radial: 4, tubular: 10 });
          b.add(sw.geom, stem, { uv: 'keep' });
          for (let j = 0; j < 9; j++) { const t = 0.4 + 0.6 * j / 9; const lp = sw.curve.getPointAt(t); const tn = sw.curve.getTangentAt(t); const dir = V3(Math.cos(a + j * 2.4), 0.4, Math.sin(a + j * 2.4)).add(tn).normalize(); lb.add(lt, leafMatrix(lp, dir, j, 1), new THREE.Color(1, 1, 1)); }
        }
        const g = lb.geometry(); g.deleteAttribute('color');
        b.add(g, leaf, { uv: 'keep' });
      }
    } else if (kind.includes('bowl')) {
      const h = HH || Math.min(0.07, H * 0.3), rr = Math.min(0.12, W * 0.24, Math.max(0.06, h * 1.6));
      b.add(lathe(smoothProfile(vaseProfile('bowl', h, rr), 30), 48), /wood|walnut/.test(kind) ? c.mat('walnut-dark') : ceramic, { pos: [cx, y0, cz], uv: 'box' });
    } else if (kind.includes('candlestick') || kind.includes('holder')) {
      const h = 0.16 + (curIdx % 2) * 0.06;
      b.add(lathe(smoothProfile([[0.001, 0], [0.04, 0], [0.04, 0.008], [0.012, 0.02], [0.008, h * 0.5], [0.012, h - 0.02], [0.016, h - 0.006], [0.016, h], [0.001, h]], 30), 32), ceramic, { pos: [cx, y0, cz], uv: 'box' });
      b.add(new THREE.CylinderGeometry(0.011, 0.011, 0.18, 16), c.mat('paper', { color: '#f2ece0' }), { pos: [cx, y0 + h + 0.09, cz] });
    } else if (kind.includes('candle')) {
      const h = 0.1 + r() * 0.05, rr = 0.035;
      b.add(lathe(vaseProfile('candle', h, rr), 28), c.mat('paper', { color: '#f2ece0' }), { pos: [cx, y0, cz], uv: 'box' });
      b.add(new THREE.CylinderGeometry(0.0012, 0.0012, 0.012, 4), c.mat('rubber'), { pos: [cx, y0 + h + 0.004, cz] });
    } else if (kind.includes('sculpt') || kind.includes('object') || kind.includes('ring')) {
      const h = HH || 0.13;
      if (h > 0.18) {
        // tall organic sculpture: stacked soft forms
        const prof = smoothProfile([[0.001, 0], [0.05, 0], [0.055, h * 0.12], [0.03, h * 0.3], [0.06, h * 0.5], [0.05, h * 0.68], [0.02, h * 0.82], [0.035, h * 0.94], [0.001, h]], 50);
        b.add(lathe(prof, 36), ceramic, { pos: [cx, y0, cz], uv: 'box' });
      } else {
        const rr = h * 0.38;
        b.add(new THREE.TorusGeometry(rr, rr * 0.32, 16, 40), ceramic, { pos: [cx, y0 + rr * 1.32 + 0.01, cz], rot: [0, 0.4, 0] });
        b.add(slab(ellipseShape(rr * 1.2, rr * 0.8), 0.012, { bevel: 0.003 }), ceramic, { pos: [cx, y0, cz] });
      }
    } else if (kind.includes('stone') || kind.includes('pebble')) {
      for (let k = 0; k < 3; k++) { const g = new THREE.SphereGeometry(0.03 - k * 0.006, 16, 10); g.scale(1, 0.45, 0.8); b.add(g, c.mat('stone-worktop'), { pos: [cx + (k - 1) * 0.045, y0 + 0.012, cz + (r() - 0.5) * 0.03] }); }
    } else if (kind.includes('box')) {
      b.add(softBox(0.14, 0.07, 0.1, { r: 0.004, seg: 2 }), c.mat('walnut-dark'), { pos: [cx, y0 + 0.035, cz] });
    } else if (kind.includes('jar')) {
      const h = HH || Math.min(0.16, H * 0.5), rr = 0.05;
      b.add(lathe(smoothProfile(vaseProfile('jar', h, rr), 30), 40), ceramic, { pos: [cx, y0, cz], uv: 'box' });
    } else {
      const h = HH || Math.min(0.2, H * 0.6), rr = Math.min(0.09, Math.max(0.05, h * 0.38));
      b.add(lathe(smoothProfile(vaseProfile('vase-round', h, rr), 40), 40), ceramic, { pos: [cx, y0, cz], uv: 'box' });
    }
  }
  return { group: b.build('decor_set') };
}

export { leafTemplate, sweep, LeafBatch, leafMatrix };
void hashStr;
