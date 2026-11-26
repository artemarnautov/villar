// Villar engine — procedural HDR sky (equirect) + procedural Dubai skyline seen from ~40th floor.
// Owner: engine.
//
// Sky: equirect HalfFloat DataTexture (raster background; path tracer background/environment).
// Skyline: a handful of merged meshes —
//   • glass curtain-wall towers (MeshPhysical, ior 2.0 coated glass, per-tower tint, mullion/spandrel
//     map) reflecting a PMREM of the *sky* (set explicitly; never the interior capture),
//   • stone/render mid-rises with punched windows, a Y-plan supertall tower,
//   • ground with a road grid and parks, a Gulf water band (glossy, reflects the sky).
// Aerial perspective: albedo attenuated by distance + emissive airlight toward warm sand haze (uv1
// ramp). Night: per-window lit/colour/brightness variation in a 1024² mipmapped, anisotropic emissive
// texture (distance averages via mips — no shimmer) and warm street-light dots on the ground.
import * as THREE from 'three';
import { rng, clamp, DEG } from './util.js';

// ----------------------------------------------------------------------------- sky presets
// Radiance units match lighting.js (sun ≈ 10 at noon). Sun:sky horizontal irradiance ≈ 4–5 : 1.
export const SKY_PRESETS = {
  morning: { zenith: '#6f98c8', horizon: '#d6dde3', ground: '#a49a8a', haze: '#d8d6d0', zenithL: 0.26, horizonL: 0.84, groundL: 0.18, glow: '#ffdcb4', glowL: 0.9, hazeL: 0.62 },
  day:     { zenith: '#5a8cc4', horizon: '#e3e6e3', ground: '#b0a48e', haze: '#d9cdb8', zenithL: 0.30, horizonL: 0.9, groundL: 0.22, glow: '#fff1dc', glowL: 0.7, hazeL: 0.68 },
  golden:  { zenith: '#6283b4', horizon: '#e9d2b8', ground: '#958068', haze: '#e2c9a8', zenithL: 0.22, horizonL: 0.60, groundL: 0.13, glow: '#ffb470', glowL: 1.6, hazeL: 0.52 },
  evening: { zenith: '#132a5e', horizon: '#3b4f7a', ground: '#191b24', haze: '#30395a', zenithL: 0.035, horizonL: 0.06, groundL: 0.008, glow: '#ff9a62', glowL: 0.03, hazeL: 0.035 },
};

const lin = (hex) => new THREE.Color(hex); // sRGB hex → linear working space

/** Equirect sky. sunDir = normalized vector pointing to the sun (may be below the horizon). */
export function makeSkyTexture(preset, sunDir, { width = 512, height = 256 } = {}) {
  const P = preset;
  const zen = lin(P.zenith).multiplyScalar(P.zenithL);
  const hor = lin(P.horizon).multiplyScalar(P.horizonL);
  const gnd = lin(P.ground).multiplyScalar(P.groundL);
  const glow = lin(P.glow).multiplyScalar(P.glowL);
  const data = new Uint16Array(width * height * 4);
  const toH = THREE.DataUtils.toHalfFloat;
  const s = sunDir.clone().normalize();
  const sh = new THREE.Vector3(s.x, 0, s.z); if (sh.lengthSq() < 1e-6) sh.set(0, 0, 1); sh.normalize();
  const sunOn = s.y > -0.12 ? 1 : 0;
  const cosPhi = new Float32Array(width), sinPhi = new Float32Array(width);
  for (let i = 0; i < width; i++) { const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI; cosPhi[i] = Math.cos(phi); sinPhi[i] = Math.sin(phi); }
  let r, g, b;
  for (let j = 0; j < height; j++) {
    const lat = ((j + 0.5) / height - 0.5) * Math.PI;
    const y = Math.sin(lat), cl = Math.cos(lat);
    // per-row base colour (depends on elevation only)
    if (y >= 0) {
      const t = Math.pow(y, 0.45), band = Math.exp(-y * 18) * 0.35;
      r = hor.r + (zen.r - hor.r) * t + hor.r * band; g = hor.g + (zen.g - hor.g) * t + hor.g * band; b = hor.b + (zen.b - hor.b) * t + hor.b * band;
    } else {
      const t = clamp(Math.pow(-y, 0.35) * 1.2, 0, 1);
      r = hor.r * 0.85 + (gnd.r - hor.r * 0.85) * t; g = hor.g * 0.85 + (gnd.g - hor.g * 0.85) * t; b = hor.b * 0.85 + (gnd.b - hor.b * 0.85) * t;
    }
    const hbRow = Math.exp(-Math.abs(y) * 9) * 0.6;
    for (let i = 0; i < width; i++) {
      const dx = cosPhi[i] * cl, dz = sinPhi[i] * cl;
      const cosA = clamp(dx * s.x + y * s.y + dz * s.z, -1, 1);
      const ang = Math.acos(cosA);
      const g1 = (Math.exp(-ang / 0.09) + Math.exp(-ang / 0.35) * 0.35) * sunOn;
      const cosH = dx * sh.x + dz * sh.z;
      const k = g1 + (cosH > 0 ? cosH * cosH * cosH : 0) * hbRow;
      const o = (j * width + i) * 4;
      data[o] = toH(r + glow.r * k); data[o + 1] = toH(g + glow.g * k); data[o + 2] = toH(b + glow.b * k); data[o + 3] = 15360; // 1.0
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'villar-sky';
  return tex;
}

// ----------------------------------------------------------------------------- textures
const GROUND_Y = -138;              // ~40th floor
const TILE_W = 24, TILE_H = 56;     // facade tile: 16 bays × 16 floors (1.5 m × 3.5 m)
const GROUND_TILE = 1200;           // road grid tile (10 blocks of 120 m)

function tex8(data, N, { srgb = true, repeat = true, aniso = 16, mips = true } = {}) {
  const t = new THREE.DataTexture(data, N, data.length / 4 / N, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips; t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}

function skylineTextures() {
  const r = rng(77);
  const cells = 16;
  // --- curtain wall (day): spandrel bands + mullions, slight per-panel tone variation (sRGB)
  const Nd = 256, cd = Nd / cells;
  const curtain = new Uint8Array(Nd * Nd * 4);
  const panelTone = Array.from({ length: cells * cells }, () => 0.9 + r() * 0.2);
  for (let y = 0; y < Nd; y++) for (let x = 0; x < Nd; x++) {
    const cx = (x / cd) | 0, cy = (y / cd) | 0, fx = (x % cd) / cd, fy = (y % cd) / cd;
    const o = (y * Nd + x) * 4;
    let v;
    if (fy < 0.16) v = 120; else if (fx < 0.06) v = 70; else v = 235 * panelTone[cy * cells + cx];
    curtain[o] = v; curtain[o + 1] = v; curtain[o + 2] = v; curtain[o + 3] = 255;
  }
  // --- punched-window render facade (day)
  const stone = new Uint8Array(Nd * Nd * 4);
  for (let y = 0; y < Nd; y++) for (let x = 0; x < Nd; x++) {
    const fx = (x % cd) / cd, fy = (y % cd) / cd;
    const win = fx > 0.18 && fx < 0.82 && fy > 0.28 && fy < 0.86;
    const o = (y * Nd + x) * 4, v = win ? 105 : 236;
    stone[o] = v; stone[o + 1] = v; stone[o + 2] = v; stone[o + 3] = 255;
  }
  // --- night windows: per-window lit/colour/brightness, curtains/blinds variation (1024², mipmapped)
  const Nn = 1024, cn = Nn / cells;
  const night = new Uint8Array(Nn * Nn * 4);
  const win = [];
  for (let k = 0; k < cells * cells; k++) {
    const on = r() < 0.38;
    const t = r(), b = 0.35 + Math.pow(r(), 0.6) * 0.65;
    const col = t < 0.62 ? [255, 190, 120] : t < 0.88 ? [250, 232, 205] : [205, 225, 255];
    const blind = r() < 0.3 ? 0.35 + r() * 0.5 : 1;  // drawn blinds: lit only partly
    win.push(on ? { c: col.map((v) => v * b), blind } : null);
  }
  for (let y = 0; y < Nn; y++) for (let x = 0; x < Nn; x++) {
    const cx = (x / cn) | 0, cy = (y / cn) | 0, fx = (x % cn) / cn, fy = (y % cn) / cn;
    const o = (y * Nn + x) * 4;
    const w = win[cy * cells + cx];
    let R = 2, G = 2, B = 3;
    if (w && fy > 0.18 && fx > 0.07 && fy < 0.18 + 0.82 * w.blind) {
      const v = 0.85 + 0.15 * Math.sin(fx * 9.0) * Math.sin(fy * 7.0);
      R = w.c[0] * v; G = w.c[1] * v; B = w.c[2] * v;
    }
    night[o] = R; night[o + 1] = G; night[o + 2] = B; night[o + 3] = 255;
  }
  // --- ground: sand blocks, asphalt roads, sparse parks (day) / street-light dots (night)
  const Ng = 1024, block = Ng / 10;
  const ground = new Uint8Array(Ng * Ng * 4), groundN = new Uint8Array(Ng * Ng * 4);
  const parks = new Set(); for (let k = 0; k < 9; k++) parks.add(((r() * 10) | 0) * 10 + ((r() * 10) | 0));
  for (let y = 0; y < Ng; y++) for (let x = 0; x < Ng; x++) {
    const bx = (x / block) | 0, by = (y / block) | 0, fx = (x % block) / block, fy = (y % block) / block;
    const road = fx < 0.13 || fy < 0.13;
    const major = (bx % 5 === 0 && fx < 0.2) || (by % 5 === 0 && fy < 0.2);
    const o = (y * Ng + x) * 4;
    let c;
    if (road || major) c = [92, 88, 82];
    else if (parks.has(by * 10 + bx)) c = [96, 112, 72];
    else { const n = 0.92 + ((x * 7 + y * 13) % 17) / 170; c = [206 * n, 194 * n, 170 * n]; }
    ground[o] = c[0]; ground[o + 1] = c[1]; ground[o + 2] = c[2]; ground[o + 3] = 255;
    // street lights: dots along road centre lines every ~25 m
    const lx = (fx > 0.05 && fx < 0.075) || (fy > 0.05 && fy < 0.075);
    const along = road ? ((fx < 0.13 ? y : x) % 22 < 3) : false;
    const L = lx && along ? 255 : major && ((x + y) % 9 < 2) ? 120 : 0;
    groundN[o] = L; groundN[o + 1] = L * 0.72; groundN[o + 2] = L * 0.42; groundN[o + 3] = 255;
  }
  // --- airlight ramp: u = haze amount 0..1 (emissive colour tints it); sampled through uv1
  const R = 64, ramp = new Uint8Array(R * 4);
  for (let i = 0; i < R; i++) { const v = Math.round((i / (R - 1)) * 255); ramp[i * 4] = v; ramp[i * 4 + 1] = v; ramp[i * 4 + 2] = v; ramp[i * 4 + 3] = 255; }
  const rampTex = tex8(ramp, R, { srgb: false, repeat: false, aniso: 1, mips: false });
  rampTex.channel = 1;
  return {
    curtain: tex8(curtain, Nd), stone: tex8(stone, Nd), night: tex8(night, Nn),
    ground: tex8(ground, Ng), groundNight: tex8(groundN, Ng), ramp: rampTex,
  };
}

// ----------------------------------------------------------------------------- geometry
class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.uv1 = []; this.col = []; this.idx = []; }
  quad(p0, p1, p2, p3, n, uvs, haze, color) {
    const b = this.pos.length / 3;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) { this.nor.push(n[0], n[1], n[2]); this.uv1.push(haze, 0.5); this.col.push(color.r, color.g, color.b); }
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** Prism with a polygonal footprint (CCW in x/z, local), sides + roof. */
  prism(cx, cz, poly, y0, y1, rot, haze, color, uOff, vOff, roofColor) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, y, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    let u = uOff;
    const n = poly.length;
    for (let k = 0; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
      const nn = [nx * c + nz * s, 0, -nx * s + nz * c];
      const u0 = u / TILE_W, u1 = (u + len) / TILE_W;
      const v0 = (y0 - GROUND_Y) / TILE_H + vOff, v1 = (y1 - GROUND_Y) / TILE_H + vOff;
      this.quad(P(a[0], y0, a[1]), P(a[0], y1, a[1]), P(b[0], y1, b[1]), P(b[0], y0, b[1]), nn, [[u0, v0], [u0, v1], [u1, v1], [u1, v0]], haze, color);
      u += len;
    }
    // roof as a fan (uv in a spandrel band: dark, no windows)
    const rc = roofColor || color.clone().multiplyScalar(0.42); // roofs: parapets, plant, gravel — not white slabs
    for (let k = 1; k < n - 1; k++) {
      const p0 = poly[0], p1 = poly[k], p2 = poly[k + 1];
      const b = this.pos.length / 3;
      for (const p of [p0, p2, p1]) { const w = P(p[0], y1, p[1]); this.pos.push(w[0], w[1], w[2]); this.nor.push(0, 1, 0); this.uv.push(0.001, 0.02); this.uv1.push(haze, 0.5); this.col.push(rc.r, rc.g, rc.b); }
      this.idx.push(b, b + 1, b + 2);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
const circle = (r, n = 14) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; });
const chamfer = (w, d, k) => [[-w / 2 + k, -d / 2], [w / 2 - k, -d / 2], [w / 2, -d / 2 + k], [w / 2, d / 2 - k], [w / 2 - k, d / 2], [-w / 2 + k, d / 2], [-w / 2, d / 2 - k], [-w / 2, -d / 2 + k]];
// glass tints (sRGB): blue-grey / green-grey glass, ~20 % bronze or silver
const GLASS = ['#22313a', '#2c3d47', '#3a4c56', '#4c5f6a', '#5f727c', '#2f4a4c', '#3b4a52', '#6a6052', '#7d8790', '#55606a'];
const STONE = ['#d9cfbf', '#cfc3ae', '#e3ddd2', '#bfb19a', '#d4c7b2'];

export function createSkyline({ center = new THREE.Vector3(2.3, 0, 9.0), seed = 11 } = {}) {
  const r = rng(seed);
  const glassB = new GeoBuilder(), stoneB = new GeoBuilder(), groundB = new GeoBuilder(), waterB = new GeoBuilder();
  const hazeOf = (dist) => 1 - Math.exp(-dist / 3400);
  const at = (ang, dist) => [center.x + Math.sin(ang) * dist, center.z + Math.cos(ang) * dist];

  function tower(ang, dist, h, opts = {}) {
    const [cx, cz] = at(ang, dist);
    const hz = hazeOf(dist);
    const glass = opts.glass ?? r() < 0.75;
    const B = glass ? glassB : stoneB;
    const base = new THREE.Color((glass ? GLASS : STONE)[(r() * (glass ? GLASS.length : STONE.length)) | 0]);
    const col = base.multiplyScalar(1 - hz * 0.8);
    const kind = opts.kind || (r() < 0.55 ? 'box' : r() < 0.6 ? 'round' : 'chamfer');
    const w = opts.w || 22 + r() * 22, d = opts.d || 22 + r() * 22;
    const poly = kind === 'round' ? circle(w / 2, 16) : kind === 'chamfer' ? chamfer(w, d, Math.min(w, d) * 0.22) : rect(w, d);
    const y0 = GROUND_Y, y1 = GROUND_Y + h;
    const rot = r() * Math.PI;
    const vOff = Math.floor(r() * 16) / 16, uOff = r() * TILE_W;
    B.prism(cx, cz, poly, y0, y1, rot, hz, col, uOff, vOff);
    // crown / setback
    if (h > 160 && r() < 0.55) {
      const k = 0.55 + r() * 0.25, h2 = 12 + r() * 30;
      const poly2 = poly.map(([x, z]) => [x * k, z * k]);
      B.prism(cx, cz, poly2, y1, y1 + h2, rot, hz, col.clone().multiplyScalar(0.9), uOff, vOff);
    }
  }

  // clusters: Marina (left), JLT behind it, Business Bay / Downtown (far left), new towers right
  const clusters = [
    { a0: -78, a1: -40, d0: 700, d1: 1700, n: 46, h0: 140, h1: 330 },
    { a0: -45, a1: -15, d0: 1500, d1: 2600, n: 34, h0: 120, h1: 260 },
    { a0: -15, a1: 25, d0: 1100, d1: 2400, n: 26, h0: 90, h1: 230 },
    { a0: 20, a1: 70, d0: 650, d1: 1400, n: 22, h0: 110, h1: 280 },
    { a0: -110, a1: 110, d0: 1800, d1: 3400, n: 60, h0: 60, h1: 220 },
    { a0: -100, a1: 100, d0: 420, d1: 700, n: 10, h0: 70, h1: 180 },
  ];
  for (const c of clusters) {
    for (let i = 0; i < c.n; i++) {
      const ang = (c.a0 + r() * (c.a1 - c.a0)) * DEG;
      const dist = c.d0 + Math.pow(r(), 0.8) * (c.d1 - c.d0);
      if (dist < 750 && Math.abs(ang) < 26 * DEG) continue; // keep the view corridor open
      tower(ang, dist, c.h0 + Math.pow(r(), 1.3) * (c.h1 - c.h0));
    }
  }
  // mid-rise stone fabric on a street grid near the ground
  for (const [rot, ox, oz] of [[0.18, 0, 0], [-0.42, 37, 11]]) {
    const c = Math.cos(rot), s2 = Math.sin(rot);
    for (let gx = -30; gx <= 30; gx++) for (let gz = 2; gz <= 30; gz++) {
      if (r() < 0.45) continue;
      const lx = gx * 70 + ox, lz = gz * 70 + oz;
      const wx = lx * c + lz * s2, wz = -lx * s2 + lz * c;
      const dist = Math.hypot(wx, wz);
      if (dist < 200 || dist > 2000) continue;
      const ang = Math.atan2(wx, wz);
      if (Math.abs(ang) > 120 * DEG) continue;
      const [cx, cz] = at(ang, dist);
      const hz = hazeOf(dist);
      const col = new THREE.Color(STONE[(r() * STONE.length) | 0]).multiplyScalar(1 - hz * 0.8);
      stoneB.prism(cx, cz, rect(30 + r() * 22, 30 + r() * 22), GROUND_Y, GROUND_Y + 18 + Math.pow(r(), 1.5) * 42, rot, hz, col, r() * TILE_W, Math.floor(r() * 16) / 16);
    }
  }
  // signature supertall (Y-plan, spiralling setbacks, spire) — 828 m
  {
    const ang = -32 * DEG, dist = 2600;
    const [cx, cz] = at(ang, dist);
    const hz = hazeOf(dist);
    const col = new THREE.Color('#9aa7b0').multiplyScalar(1 - hz * 0.8);
    const tiers = 14, tierH = 42;
    glassB.prism(cx, cz, circle(16, 12), GROUND_Y, GROUND_Y + 600, 0, hz, col, 0, 0);            // core
    for (let k = 0; k < 3; k++) {
      const wa = k * (2 * Math.PI / 3);
      for (let t = 0; t < tiers; t++) {
        const len = 62 * (1 - (t + k / 3) / tiers);
        if (len < 6) break;
        const wdt = 26 * (1 - t / (tiers * 1.4));
        const poly = [[0, -wdt / 2], [len + 14, -wdt / 2 * 0.8], [len + 14, wdt / 2 * 0.8], [0, wdt / 2]];
        glassB.prism(cx, cz, poly, GROUND_Y + t * tierH, GROUND_Y + (t + 1) * tierH + k * 8, wa, hz, col, 0, 0);
      }
    }
    glassB.prism(cx, cz, circle(9, 10), GROUND_Y + 600, GROUND_Y + 700, 0, hz, col, 0, 0);
    glassB.prism(cx, cz, circle(4, 8), GROUND_Y + 700, GROUND_Y + 828, 0, hz, col.clone().multiplyScalar(1.1), 0, 0);
  }
  // ground rings (aerial perspective varies with distance); road grid at block scale
  const ringR = [0, 160, 320, 600, 1000, 1600, 2500, 3800, 6000];
  const SEG = 64;
  const waterFrom = 28 * DEG, waterTo = 115 * DEG, waterDist = 1300;
  for (let k = 0; k < ringR.length - 1; k++) {
    const r0 = ringR[k], r1 = ringR[k + 1];
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2 - Math.PI, a1 = ((i + 1) / SEG) * Math.PI * 2 - Math.PI;
      const P = (rr, a) => [center.x + Math.sin(a) * rr, GROUND_Y, center.z + Math.cos(a) * rr];
      const U = (p) => [p[0] / GROUND_TILE, p[2] / GROUND_TILE];
      const p0 = P(r0, a0), p1 = P(r0, a1), p2 = P(r1, a1), p3 = P(r1, a0);
      const hz = hazeOf((r0 + r1) / 2);
      const isWater = r0 >= waterDist && a0 >= waterFrom && a1 <= waterTo;
      const B = isWater ? waterB : groundB;
      const c = isWater ? new THREE.Color(1, 1, 1).multiplyScalar(1 - hz * 0.6) : new THREE.Color(1, 1, 1).multiplyScalar(1 - hz * 0.8);
      B.quad(p0, p3, p2, p1, [0, 1, 0], [U(p0), U(p3), U(p2), U(p1)], hz, c);
    }
  }

  const tx = skylineTextures();
  const haze = new THREE.Color('#d9cdb8');
  const mk = (P, opts) => { const m = new P(opts); m.userData.skyline = true; return m; };
  // day materials (envMap = sky PMREM, assigned in setTimeOfDay)
  const M = {
    glassDay: mk(THREE.MeshPhysicalMaterial, { vertexColors: true, map: tx.curtain, roughness: 0.04, metalness: 0, envMapIntensity: 1.2, ior: 2.0, specularIntensity: 1, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-glass' }),
    stoneDay: mk(THREE.MeshStandardMaterial, { vertexColors: true, map: tx.stone, roughness: 0.85, metalness: 0, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-stone' }),
    groundDay: mk(THREE.MeshStandardMaterial, { vertexColors: true, map: tx.ground, roughness: 0.95, metalness: 0, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-ground' }),
    water: mk(THREE.MeshPhysicalMaterial, { vertexColors: true, color: new THREE.Color('#1c3b47'), roughness: 0.14, metalness: 0, ior: 1.33, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-water' }),
    glassNight: mk(THREE.MeshPhysicalMaterial, { vertexColors: true, map: tx.curtain, color: new THREE.Color(0.25, 0.27, 0.3), roughness: 0.12, metalness: 0, ior: 2.0, emissive: new THREE.Color(1, 1, 1), emissiveMap: tx.night, emissiveIntensity: 0.5, name: 'skyline-glass-night' }),
    stoneNight: mk(THREE.MeshStandardMaterial, { vertexColors: true, map: tx.stone, color: new THREE.Color(0.3, 0.3, 0.32), roughness: 0.85, emissive: new THREE.Color(1, 1, 1), emissiveMap: tx.night, emissiveIntensity: 0.35, name: 'skyline-stone-night' }),
    groundNight: mk(THREE.MeshStandardMaterial, { vertexColors: true, map: tx.ground, color: new THREE.Color(0.25, 0.25, 0.28), roughness: 0.95, emissive: new THREE.Color(1, 1, 1), emissiveMap: tx.groundNight, emissiveIntensity: 0.55, name: 'skyline-ground-night' }),
  };
  const group = new THREE.Group();
  group.name = 'skyline';
  const meshes = {};
  for (const [key, B, mat] of [['glass', glassB, M.glassDay], ['stone', stoneB, M.stoneDay], ['ground', groundB, M.groundDay], ['water', waterB, M.water]]) {
    const m = new THREE.Mesh(B.build(), mat);
    m.name = 'skyline-' + key;
    m.frustumCulled = false;
    m.castShadow = false; m.receiveShadow = false;
    m.userData.noAO = true; m.userData.exterior = true; m.userData.noPick = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    group.add(m);
    meshes[key] = m;
  }

  let night = false;
  let env = null;
  function applyEnv() {
    for (const m of Object.values(M)) { m.envMap = env; m.needsUpdate = true; }
  }

  return {
    mesh: group,
    group,
    /** preset = SKY_PRESETS[tod]; skyEnv = PMREM texture of the sky (reflections). */
    setTimeOfDay(tod, preset, skyEnv) {
      night = tod === 'evening';
      if (env !== skyEnv) { env = skyEnv || null; applyEnv(); }
      meshes.glass.material = night ? M.glassNight : M.glassDay;
      meshes.stone.material = night ? M.stoneNight : M.stoneDay;
      meshes.ground.material = night ? M.groundNight : M.groundDay;
      for (const m of [M.glassDay, M.stoneDay, M.groundDay, M.water]) m.emissive.set(preset.haze).multiplyScalar(preset.hazeL * 0.38);
      M.water.envMapIntensity = night ? 0.6 : 1;
    },
    /** Run fn with the night (or day) materials on — for pre-compiling the other set. */
    withMaterials(nightOn, fn) {
      const was = [meshes.glass.material, meshes.stone.material, meshes.ground.material];
      meshes.glass.material = nightOn ? M.glassNight : M.glassDay;
      meshes.stone.material = nightOn ? M.stoneNight : M.stoneDay;
      meshes.ground.material = nightOn ? M.groundNight : M.groundDay;
      try { return fn(); } finally { [meshes.glass.material, meshes.stone.material, meshes.ground.material] = was; }
    },
    /** Path tracer snapshot: no PMREM envMaps (it lights with its own sky) and no uv1 haze ramp. */
    preparePhoto() {
      const saved = Object.values(M).map((m) => [m, m.envMap, m.emissiveMap, m.emissiveIntensity]);
      for (const m of Object.values(M)) {
        m.envMap = null;
        if (m.emissiveMap === tx.ramp) { m.emissiveMap = null; m.emissiveIntensity = 0.35; }
      }
      return () => { for (const [m, e, em, ei] of saved) { m.envMap = e; m.emissiveMap = em; m.emissiveIntensity = ei; } };
    },
    dispose() {
      for (const m of Object.values(meshes)) m.geometry.dispose();
      for (const m of Object.values(M)) m.dispose();
      for (const t of Object.values(tx)) t.dispose();
    },
  };
}

export { GROUND_Y };
