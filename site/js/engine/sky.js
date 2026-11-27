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

// ----------------------------------------------------------------------------- photographic skies
// CC0 Poly Haven pure-sky HDRIs (sources + licence: assets/materials/LICENSES.md), prepared offline
// (tools: docs/requests/engine.md): the sun disc and its lens spikes are inpainted (the engine's sun is
// a light), the image is rotated so its sun glow sits at the engine's sun azimuth, the horizon band
// below a few degrees is rebuilt as haze (no foreign trees / buildings behind our skyline), and the
// level is matched to the procedural preset over the 5°–35° band seen through the window (so
// exposure, GI and the stand-in fits stay calibrated). 1024 × 512 RGBE, ~0.5–0.8 MB each.
export const SKY_HDR = {
  morning: '/assets/sky/morning.hdr',
  day: '/assets/sky/day.hdr',
  golden: '/assets/sky/golden.hdr',
  evening: '/assets/sky/evening.hdr',
};

let RGBE_HALF = null; // (exponent << 8 | mantissa) → half float bits: one table lookup per channel
function rgbeTable() {
  if (RGBE_HALF) return RGBE_HALF;
  RGBE_HALF = new Uint16Array(65536);
  const toH = THREE.DataUtils.toHalfFloat;
  for (let e = 1; e < 256; e++) {
    const s = Math.pow(2, e - 136);
    for (let m = 0; m < 256; m++) RGBE_HALF[(e << 8) | m] = toH(Math.min(65000, (m + 0.5) * s));
  }
  for (let m = 0; m < 256; m++) RGBE_HALF[m] = 0;
  return RGBE_HALF;
}

/** Decode a Radiance .hdr (RLE or flat) into RGBA half floats, rows bottom → top (DataTexture order). */
export function decodeRGBE(bytes) {
  let p = 0;
  const line = () => { let s = ''; while (p < bytes.length && bytes[p] !== 10) s += String.fromCharCode(bytes[p++]); p++; return s; };
  if (!line().startsWith('#?')) throw new Error('not a Radiance HDR');
  for (let l = line(); l !== ''; l = line()) if (p >= bytes.length) throw new Error('bad HDR header');
  const m = /-Y (\d+) \+X (\d+)/.exec(line());
  if (!m) throw new Error('unsupported HDR orientation');
  const H = +m[1], W = +m[2];
  const T = rgbeTable();
  const out = new Uint16Array(W * H * 4);
  const row = new Uint8Array(W * 4);
  for (let y = 0; y < H; y++) {
    if (W >= 8 && W < 32768 && bytes[p] === 2 && bytes[p + 1] === 2 && ((bytes[p + 2] << 8) | bytes[p + 3]) === W) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < W) {
          let n = bytes[p++];
          if (n > 128) { n -= 128; const v = bytes[p++]; for (let k = 0; k < n; k++) row[(x++) * 4 + c] = v; }
          else for (let k = 0; k < n; k++) row[(x++) * 4 + c] = bytes[p++];
        }
      }
    } else {
      row.set(bytes.subarray(p, p + W * 4)); p += W * 4;
    }
    const o = (H - 1 - y) * W * 4;
    for (let x = 0; x < W; x++) {
      const e = row[x * 4 + 3] << 8;
      out[o + x * 4] = T[e | row[x * 4]]; out[o + x * 4 + 1] = T[e | row[x * 4 + 1]]; out[o + x * 4 + 2] = T[e | row[x * 4 + 2]];
      out[o + x * 4 + 3] = 15360; // 1.0
    }
  }
  return { width: W, height: H, data: out };
}

/** Fetch + decode a sky HDR (same origin, no network beyond the site) → equirect DataTexture like makeSkyTexture. */
export async function loadSkyTexture(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`sky ${url}: HTTP ${res.status}`);
  const { width, height, data } = decodeRGBE(new Uint8Array(await res.arrayBuffer()));
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'villar-sky-hdr';
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
    const on = r() < 0.36;
    const t = r(), b = 0.3 + Math.pow(r(), 0.8) * 0.7;
    // muted interior colours: warm white most, some tungsten, a few cool screens / LEDs
    const col = t < 0.55 ? [246, 214, 172] : t < 0.85 ? [240, 226, 206] : t < 0.95 ? [255, 186, 120] : [196, 214, 236];
    const blind = r() < 0.35 ? 0.3 + r() * 0.55 : 1;  // drawn blinds: lit only partly
    const panes = r() < 0.5 ? 2 : 3;                    // mullions split the bay
    win.push(on ? { c: col.map((v) => v * b), blind, panes, dim: r() < 0.25 ? 0.35 : 1 } : null);
  }
  const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  for (let y = 0; y < Nn; y++) for (let x = 0; x < Nn; x++) {
    const cx = (x / cn) | 0, cy = (y / cn) | 0, fx = (x % cn) / cn, fy = (y % cn) / cn;
    const o = (y * Nn + x) * 4;
    const w = win[cy * cells + cx];
    let R = 2, G = 2, B = 3;
    if (w && fy > 0.18 && fx > 0.07) {
      const top = 0.18 + 0.82 * w.blind;
      // soft pane edges, dark mullions, a ceiling-lit falloff (bright top → dimmer sill) and a centre glow:
      // reads as a lit room behind glass instead of a flat coloured tile
      const edge = sm(0.18, 0.21, fy) * sm(0.07, 0.1, fx) * (1 - sm(top - 0.03, top, fy)) * (1 - sm(0.97, 1.0, fx));
      const pf = ((fx - 0.07) / 0.93) * w.panes, pr = pf - Math.floor(pf);
      const mull = 0.25 + 0.75 * sm(0.0, 0.06, pr) * (1 - sm(0.94, 1.0, pr));
      const fall = 0.55 + 0.45 * Math.pow(Math.min(1, Math.max(0, (fy - 0.18) / 0.82)), 0.7);
      const glow = 0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, Math.max(0, (fx - 0.07) / 0.93)));
      const v = edge * mull * fall * glow * w.dim;
      R = 2 + w.c[0] * v; G = 2 + w.c[1] * v; B = 3 + w.c[2] * v;
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
  /** `unit`: metres per uv unit for walls (photo facades; texture.repeat sets each one's real size). */
  constructor(unit = 0) { this.unit = unit; this.pos = []; this.nor = []; this.uv = []; this.uv1 = []; this.col = []; this.idx = []; }
  quad(p0, p1, p2, p3, n, uvs, haze, color) {
    const b = this.pos.length / 3;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) { this.nor.push(n[0], n[1], n[2]); this.uv1.push(haze, 0.5); this.col.push(color.r, color.g, color.b); }
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** Prism with a polygonal footprint (CCW in x/z, local), sides + roof. */
  prism(cx, cz, poly, y0, y1, rot, haze, color, uOff, vOff, roofColor, roofB = null) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, y, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    let u = uOff;
    const n = poly.length;
    for (let k = 0; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
      const nn = [nx * c + nz * s, 0, -nx * s + nz * c];
      const U = this.unit || TILE_W, V = this.unit || TILE_H;
      const u0 = u / U, u1 = (u + len) / U;
      const v0 = (y0 - GROUND_Y) / V + vOff, v1 = (y1 - GROUND_Y) / V + vOff;
      this.quad(P(a[0], y0, a[1]), P(a[0], y1, a[1]), P(b[0], y1, b[1]), P(b[0], y0, b[1]), nn, [[u0, v0], [u0, v1], [u1, v1], [u1, v0]], haze, color);
      u += len;
    }
    // roof as a fan: into the roof builder (world-space uv on a roof texture) or, legacy, a dark spandrel uv
    const rc = roofColor || color.clone().multiplyScalar(0.42); // roofs: parapets, plant, gravel — not white slabs
    const R = roofB || this;
    for (let k = 1; k < n - 1; k++) {
      const p0 = poly[0], p1 = poly[k], p2 = poly[k + 1];
      const b = R.pos.length / 3;
      for (const p of [p0, p2, p1]) {
        const w = P(p[0], y1, p[1]);
        R.pos.push(w[0], w[1], w[2]); R.nor.push(0, 1, 0);
        if (roofB) R.uv.push(w[0] / 24, w[2] / 24); else R.uv.push(0.001, 0.02);
        R.uv1.push(haze, 0.5); R.col.push(rc.r, rc.g, rc.b);
      }
      R.idx.push(b, b + 1, b + 2);
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
  // photo facades (CC0 ambientCG, assets/city): 3 glass and 3 stone variants, one merged mesh each, uv in metres
  const UNIT = 100;
  const glassBs = [0, 1, 2].map(() => new GeoBuilder(UNIT)), stoneBs = [0, 1, 2].map(() => new GeoBuilder(UNIT));
  const roofB = new GeoBuilder(), groundB = new GeoBuilder(), waterB = new GeoBuilder();
  const glassB = glassBs[0];
  // sun-facing roofs get the full noon sun: darker gravel / membrane albedo than the facades (R3-02: 'snow')
  const ROOF = ['#6b6357', '#60594e', '#72695c', '#5a544a'];
  const roofOf = (hz) => new THREE.Color(ROOF[(r() * ROOF.length) | 0]).multiplyScalar((0.85 + r() * 0.3) * (1 - hz * 0.8));
  const tintOf = (palette, hz, k = 0.35) => new THREE.Color(1, 1, 1).lerp(new THREE.Color(palette[(r() * palette.length) | 0]), k).multiplyScalar(1 - hz * 0.8);
  /** Rooftop plant: a few low boxes (AC units, stair cores) — flat white slabs read as snow (R3-02). */
  function clutter(cx, cz, w, d, y, rot, hz) {
    const n = 1 + ((r() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const bw = 3 + r() * Math.min(9, w * 0.3), bd = 3 + r() * Math.min(9, d * 0.3), bh = 1.5 + r() * 3.5;
      const ox = (r() - 0.5) * (w - bw) * 0.8, oz = (r() - 0.5) * (d - bd) * 0.8;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const c2 = new THREE.Color('#7a7266').multiplyScalar((0.8 + r() * 0.35) * (1 - hz * 0.8));
      roofB.prism(cx + ox * c + oz * sn, cz - ox * sn + oz * c, rect(bw, bd), y, y + bh, rot, hz, c2, 0, 0, c2.clone().multiplyScalar(0.9), roofB);
    }
  }
  const hazeOf = (dist) => 1 - Math.exp(-dist / 3400);
  const at = (ang, dist) => [center.x + Math.sin(ang) * dist, center.z + Math.cos(ang) * dist];

  function tower(ang, dist, h, opts = {}) {
    const [cx, cz] = at(ang, dist);
    const hz = hazeOf(dist);
    const glass = opts.glass ?? r() < 0.75;
    const v = (r() * 3) | 0;
    const B = glass ? glassBs[v] : stoneBs[v];
    const col = tintOf(glass ? GLASS : STONE, hz, glass ? 0.3 : 0.2);
    const kind = opts.kind || (r() < 0.55 ? 'box' : r() < 0.6 ? 'round' : 'chamfer');
    const w = opts.w || 22 + r() * 22, d = opts.d || 22 + r() * 22;
    const poly = kind === 'round' ? circle(w / 2, 16) : kind === 'chamfer' ? chamfer(w, d, Math.min(w, d) * 0.22) : rect(w, d);
    const y0 = GROUND_Y, y1 = GROUND_Y + h;
    const rot = r() * Math.PI;
    const vOff = r(), uOff = r() * UNIT;
    B.prism(cx, cz, poly, y0, y1, rot, hz, col, uOff, vOff, roofOf(hz), roofB);
    // crown / setback
    if (h > 160 && r() < 0.55) {
      const k = 0.55 + r() * 0.25, h2 = 12 + r() * 30;
      const poly2 = poly.map(([x, z]) => [x * k, z * k]);
      B.prism(cx, cz, poly2, y1, y1 + h2, rot, hz, col.clone().multiplyScalar(0.9), uOff, vOff, roofOf(hz), roofB);
    } else if (dist < 1800 && kind !== 'round') clutter(cx, cz, w, d, y1, rot, hz);
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
      const col = tintOf(STONE, hz, 0.25);
      const w = 30 + r() * 22, d = 30 + r() * 22, h = 18 + Math.pow(r(), 1.5) * 42;
      const v = r() < 0.5 ? 0 : 1; // dense small-window blocks (the 21 m variant reads too coarse on a mid-rise)
      stoneBs[v].prism(cx, cz, rect(w, d), GROUND_Y, GROUND_Y + h, rot, hz, col, r() * UNIT, r(), roofOf(hz), roofB);
      if (dist < 1500 && r() < 0.6) clutter(cx, cz, w, d, GROUND_Y + h, rot, hz);
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
      const c = isWater ? new THREE.Color(1, 1, 1).multiplyScalar(1 - hz * 0.6) : new THREE.Color(0.78, 0.76, 0.74).multiplyScalar(1 - hz * 0.8);
      B.quad(p0, p3, p2, p1, [0, 1, 0], [U(p0), U(p3), U(p2), U(p1)], hz, c);
    }
  }

  const tx = skylineTextures();
  // procedural stand-ins (until the photo facades have loaded) are laid out for the old 24 × 56 m tile
  for (const t of [tx.curtain, tx.stone, tx.night]) t.repeat.set(UNIT / TILE_W, UNIT / TILE_H);
  const haze = new THREE.Color('#d9cdb8');
  const mk = (P, opts) => { const m = new P(opts); m.userData.skyline = true; return m; };
  // day materials (envMap = sky PMREM, assigned in setTimeOfDay)
  const M = {
    glassDay: mk(THREE.MeshPhysicalMaterial, { vertexColors: true, map: tx.curtain, roughness: 0.04, metalness: 0, envMapIntensity: 1.2, ior: 2.0, specularIntensity: 1, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-glass' }),
    stoneDay: mk(THREE.MeshStandardMaterial, { vertexColors: true, map: tx.stone, roughness: 0.85, metalness: 0, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-stone' }),
    groundDay: mk(THREE.MeshPhysicalMaterial, { vertexColors: true, map: tx.ground, roughness: 1, metalness: 0, specularIntensity: 0.2, envMapIntensity: 0.6, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-ground' }),
    water: mk(THREE.MeshPhysicalMaterial, { vertexColors: true, color: new THREE.Color('#1c3b47'), roughness: 0.14, metalness: 0, ior: 1.33, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-water' }),
    glassNight: mk(THREE.MeshPhysicalMaterial, { vertexColors: true, map: tx.curtain, color: new THREE.Color(0.25, 0.27, 0.3), roughness: 0.12, metalness: 0, ior: 2.0, emissive: new THREE.Color(1, 1, 1), emissiveMap: tx.night, emissiveIntensity: 0.5, name: 'skyline-glass-night' }),
    stoneNight: mk(THREE.MeshStandardMaterial, { vertexColors: true, map: tx.stone, color: new THREE.Color(0.3, 0.3, 0.32), roughness: 0.85, emissive: new THREE.Color(1, 1, 1), emissiveMap: tx.night, emissiveIntensity: 0.35, name: 'skyline-stone-night' }),
    groundNight: mk(THREE.MeshStandardMaterial, { vertexColors: true, map: tx.ground, color: new THREE.Color(0.25, 0.25, 0.28), roughness: 0.95, emissive: new THREE.Color(1, 1, 1), emissiveMap: tx.groundNight, emissiveIntensity: 0.55, name: 'skyline-ground-night' }),
  };
  // per-variant facade materials (day / night); the base glassDay/stoneDay above stay the templates
  const V = [0, 1, 2];
  // roofs: gravel / membrane tones per roof (vertex colour) and plant boxes; no texture (no roads on roofs)
  // seen at a grazing angle from the 40th floor, a rough roof's Fresnel sheen of the bright sky outweighed its
  // albedo (roofs Y′ 230 whatever their colour): gravel and membranes barely reflect — keep the env mostly diffuse
  M.roofDay = mk(THREE.MeshPhysicalMaterial, { vertexColors: true, roughness: 1, metalness: 0, specularIntensity: 0.15, envMapIntensity: 0.6, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-roof' });
  M.roofNight = mk(THREE.MeshStandardMaterial, { vertexColors: true, color: new THREE.Color(0.22, 0.22, 0.25), roughness: 0.95, name: 'skyline-roof-night' });
  for (const v of V) {
    M['glassDay' + v] = mk(THREE.MeshPhysicalMaterial, { vertexColors: true, map: tx.curtain, roughness: 0.05, metalness: 0, envMapIntensity: 0.7, ior: 1.8, specularIntensity: 1, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-glass-' + v });
    M['stoneDay' + v] = mk(THREE.MeshStandardMaterial, { vertexColors: true, map: tx.stone, roughness: 0.85, metalness: 0, emissive: haze, emissiveMap: tx.ramp, emissiveIntensity: 1, name: 'skyline-stone-' + v });
    M['glassNight' + v] = mk(THREE.MeshPhysicalMaterial, { vertexColors: true, map: tx.curtain, color: new THREE.Color(0.22, 0.24, 0.27), roughness: 0.12, metalness: 0, ior: 1.8, emissive: new THREE.Color(1, 1, 1), emissiveMap: tx.night, emissiveIntensity: 0.5, name: 'skyline-glass-night-' + v });
    // variant c's night photo is the same block with nearly every window lit: much dimmer
    M['stoneNight' + v] = mk(THREE.MeshStandardMaterial, { vertexColors: true, map: tx.stone, color: new THREE.Color(0.28, 0.28, 0.3), roughness: 0.85, emissive: new THREE.Color(1, 1, 1), emissiveMap: tx.night, emissiveIntensity: v === 2 ? 0.12 : 0.4, name: 'skyline-stone-night-' + v });
  }
  // tinted high-rise glazing (visible transmission ≈ 60 %): the city is seen THROUGH it, so it reads a stop
  // darker than the room's exposure would make it — sunlit roofs stop reading as snow (R3-02)
  const VLT = 0.6;
  for (const m of [M.groundDay, M.water, M.roofDay, ...V.map((v) => M['glassDay' + v]), ...V.map((v) => M['stoneDay' + v])]) m.color.multiplyScalar(VLT);
  const group = new THREE.Group();
  group.name = 'skyline';
  const meshes = {};
  const parts = [['ground', groundB, M.groundDay], ['water', waterB, M.water], ['roof', roofB, M.roofDay]];
  for (const v of V) { parts.push(['glass' + v, glassBs[v], M['glassDay' + v]], ['stone' + v, stoneBs[v], M['stoneDay' + v]]); }
  for (const [key, B, mat] of parts) {
    if (!B.idx.length) continue;
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
  function setSet(on) {
    if (meshes.ground) meshes.ground.material = on ? M.groundNight : M.groundDay;
    if (meshes.roof) meshes.roof.material = on ? M.roofNight : M.roofDay;
    for (const v of V) {
      if (meshes['glass' + v]) meshes['glass' + v].material = on ? M['glassNight' + v] : M['glassDay' + v];
      if (meshes['stone' + v]) meshes['stone' + v].material = on ? M['stoneNight' + v] : M['stoneDay' + v];
    }
  }
  // photo facades: day albedo (also under the night emission) + lit-window night photos; real size via repeat
  const FACADES = [
    ['glass', 0, 'glass-a', 27.6, 'night-glass-a', 40], ['glass', 1, 'glass-b', 86, 'night-glass-b', 86], ['glass', 2, 'glass-c', 30, 'night-glass-c', 118],
    ['stone', 0, 'stone-a', 100, 'night-stone-a', 100], ['stone', 1, 'stone-b', 102, 'night-stone-b', 118], ['stone', 2, 'stone-c', 21, 'night-stone-c', 21],
  ];
  if (typeof document !== 'undefined') {
    const loader = new THREE.TextureLoader();
    const load = (name, size, srgb = true) => new Promise((res) => loader.load(`/assets/city/${name}.jpg`, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(UNIT / size, UNIT / size);
      t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.name = 'city:' + name; res(t);
    }, undefined, () => res(null)));
    for (const [kind, v, day, dSize, nightName, nSize] of FACADES) {
      const cap = kind[0].toUpperCase() + kind.slice(1);
      load(day, dSize).then((t) => { if (!t) return; for (const m of [M[kind + 'Day' + v], M[kind + 'Night' + v]]) { m.map = t; m.needsUpdate = true; } cityTex.push(t); onCity?.(); });
      load(nightName, nSize).then((t) => { if (!t) return; const m = M[kind + 'Night' + v]; m.emissiveMap = t; m.needsUpdate = true; cityTex.push(t); onCity?.(); });
      void cap;
    }
  }
  const cityTex = [];
  let onCity = null;
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
      setSet(night);
      const hz = new THREE.Color(preset.haze);
      if (preset.hazeTint) { const l = 0.2126 * hz.r + 0.7152 * hz.g + 0.0722 * hz.b; hz.copy(preset.hazeTint).multiplyScalar(l); }
      for (const m of [M.groundDay, M.water, M.roofDay, ...V.map((v) => M['glassDay' + v]), ...V.map((v) => M['stoneDay' + v])]) m.emissive.copy(hz).multiplyScalar(preset.hazeL * 0.38 * VLT);
      M.water.envMapIntensity = night ? 0.6 : 1;
    },
    /** Run fn with the night (or day) materials on — for pre-compiling the other set. */
    withMaterials(nightOn, fn) {
      const was = Object.values(meshes).map((m) => [m, m.material]);
      setSet(nightOn);
      try { return fn(); } finally { for (const [m, mat] of was) m.material = mat; }
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
    /** fn() whenever a facade photo has landed (the engine invalidates / refreshes the sky capture). */
    set onTextures(fn) { onCity = fn; },
    dispose() {
      for (const m of Object.values(meshes)) m.geometry.dispose();
      for (const m of Object.values(M)) m.dispose();
      for (const t of Object.values(tx)) t.dispose();
      for (const t of cityTex) t.dispose();
    },
  };
}

export { GROUND_Y };
