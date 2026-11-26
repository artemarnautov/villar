// Villar — procedural PBR texture generators. Owner: modeler.
//
// Every generator is deterministic (seeded) and returns *tileable* textures.
// Convention: one texture tile covers `tile = [U, V]` metres of real surface;
// materials.js sets `texture.repeat = 1 / tile` so geometry UVs are expected in metres
// (see boxProjectUVs / cylinderUVs in materials.js).
//
// Albedo textures are sRGB, everything else (normal / roughness / height) is linear.
// "Detail" albedo maps for colour-option materials are near-white luminance maps
// that multiply material.color.

// by URL = the module the import map's 'three' resolves to (one instance); also loadable in a Worker (T8)
import * as THREE from '../../vendor/three/three.module.js';

// ---------------------------------------------------------------- random & noise

export function rng(seed = 1) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Periodic 2D gradient noise. n(x, y, px, py): integer lattice periods px, py (any size). Range ≈ [-1, 1]. */
export class Noise {
  constructor(seed = 1) {
    const r = rng(seed);
    this.s = (r() * 0x7fffffff) | 0;
    this.gx = new Float32Array(256); this.gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; this.gx[i] = Math.cos(a); this.gy[i] = Math.sin(a); }
  }
  n(x, y, px = 4096, py = 4096) {
    const fx = Math.floor(x), fy = Math.floor(y);
    const xf = x - fx, yf = y - fy;
    let xi = fx % px; if (xi < 0) xi += px;
    let yi = fy % py; if (yi < 0) yi += py;
    const xi1 = xi + 1 === px ? 0 : xi + 1;
    const yi1 = yi + 1 === py ? 0 : yi + 1;
    const s = this.s, gx = this.gx, gy = this.gy;
    const ax = Math.imul(xi, 0x27d4eb2d) ^ s, bx = Math.imul(xi1, 0x27d4eb2d) ^ s;
    const ay = Math.imul(yi, 0x165667b1), by = Math.imul(yi1, 0x165667b1);
    let h;
    h = ax + ay; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); const h00 = (h ^ (h >>> 12)) & 255;
    h = bx + ay; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); const h10 = (h ^ (h >>> 12)) & 255;
    h = ax + by; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); const h01 = (h ^ (h >>> 12)) & 255;
    h = bx + by; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); const h11 = (h ^ (h >>> 12)) & 255;
    const d00 = gx[h00] * xf + gy[h00] * yf;
    const d10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const d01 = gx[h01] * xf + gy[h01] * (yf - 1);
    const d11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const x0 = d00 + u * (d10 - d00), x1 = d01 + u * (d11 - d01);
    return (x0 + v * (x1 - x0)) * 1.41;
  }
  /** fbm over a unit tile: (u, v) in [0,1), base lattice fx, fy (integers). Periodic in u, v with period 1. */
  fbm(u, v, fx, fy, oct = 4, gain = 0.5) {
    let s = 0, a = 1, norm = 0, px = fx, py = fy;
    for (let o = 0; o < oct; o++) {
      s += a * this.n(u * px + o * 17, v * py + o * 31, px, py);
      norm += a; a *= gain; px *= 2; py *= 2;
    }
    return s / norm;
  }
}

/** Periodic Worley / cellular noise over a unit tile with nx × ny cells. Returns [f1, f2, cellId] (distances in cell units). */
export class Cells {
  constructor(seed, nx, ny = nx, jitter = 1) {
    const r = rng(seed);
    this.nx = nx; this.ny = ny;
    this.px = new Float32Array(nx * ny); this.py = new Float32Array(nx * ny); this.id = new Float32Array(nx * ny);
    for (let i = 0; i < nx * ny; i++) { this.px[i] = 0.5 + (r() - 0.5) * jitter; this.py[i] = 0.5 + (r() - 0.5) * jitter; this.id[i] = r(); }
    this.out = [0, 0, 0];
  }
  at(u, v) {
    const nx = this.nx, ny = this.ny;
    const x = u * nx, y = v * ny;
    const cx = Math.floor(x), cy = Math.floor(y);
    let f1 = 1e9, f2 = 1e9, id = 0;
    for (let j = -1; j <= 1; j++) {
      let yy = (cy + j) % ny; if (yy < 0) yy += ny;
      for (let i = -1; i <= 1; i++) {
        let xx = (cx + i) % nx; if (xx < 0) xx += nx;
        const k = yy * nx + xx;
        const dx = cx + i + this.px[k] - x, dy = cy + j + this.py[k] - y;
        const d = dx * dx + dy * dy;
        if (d < f1) { f2 = f1; f1 = d; id = this.id[k]; } else if (d < f2) f2 = d;
      }
    }
    const o = this.out; o[0] = Math.sqrt(f1); o[1] = Math.sqrt(f2); o[2] = id; return o;
  }
}

// ---------------------------------------------------------------- small math

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (x) => x - Math.floor(x);

export function hexToRgb(hex) {
  const c = new THREE.Color(hex);
  // sRGB components 0..1 (getRGB with SRGB colour space)
  const o = { r: 0, g: 0, b: 0 };
  c.getRGB(o, THREE.SRGBColorSpace);
  return [o.r, o.g, o.b];
}

// ---------------------------------------------------------------- texture plumbing

let MAX_ANISO = 8;
export function setMaxAnisotropy(n) { MAX_ANISO = Math.max(1, n | 0); }

let QUALITY = 1; // 1 = full, 0.5 = half-res textures
export function setTextureQuality(q) { QUALITY = q; }
const res = (n) => Math.max(64, Math.round((n * QUALITY) / 8) * 8);

export function dataTexture(data, w, h, { srgb = false, repeat = null, format = THREE.RGBAFormat } = {}) {
  const t = new THREE.DataTexture(data, w, h, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = MAX_ANISO;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (format === THREE.RGFormat) t.unpackAlignment = 2;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- CPU memory release + regeneration
//
// After the final GPU upload the CPU copy (DataTexture data / canvas pixels) is dropped. If the WebGL
// context is lost and restored, restoreTextures() regenerates every procedural texture in the
// background (materials.js calls it on 'webglcontextrestored').

// T4 — context loss / restore and self-healing:
//  • data textures keep { width, height } and drop only `data`; restoreTextures() puts a placeholder-filled buffer
//    back at once (so the first upload after a restore allocates full-size storage and is never `null`) and
//    re-runs the generator time-sliced;
//  • canvas textures (art, rug patterns) are shrunk to 1 × 1 after upload; restoreTextures() redraws them
//    SYNCHRONOUSLY and drops their GL storage (texture.dispose() without forgetting them), so a full-size canvas
//    is never sub-uploaded into a 1 × 1 immutable allocation;
//  • if a released texture is ever uploaded again without its pixels (a clone with a new GL cache key, an engine
//    needsUpdate), onUpdate heals it the same way (logged with console.debug, texture name).

const REGEN = new Set();
const HEAL = new WeakMap(); // texture Source → heal()
let KEEP_CPU = false;
let QUIET = 0; // >0 while restoring/healing: our own dispose() calls must not forget the regenerator
/** Keep CPU copies (tests / tools that read texture data). */
export function setKeepTextureData(v) { KEEP_CPU = !!v; }

function released(tex) {
  const img = tex && tex.image;
  if (!img) return false;
  if ('data' in img && !(typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement)) return img.data === null;
  return img.width === 1 && img.height === 1 && !!HEAL.get(tex.source);
}
/** onUpdate for any texture sharing a procedural Source (originals and clones): heal uploads without pixels. */
export function healOnUpdate(tex) {
  if (!released(tex)) return;
  const h = HEAL.get(tex.source);
  if (!h) return;
  console.debug('[textures] re-upload of a released texture — regenerating', tex.name || tex.uuid);
  h();
}

function releaseAfterUpload(t, kind = 'data') {
  if (KEEP_CPU) { t.onUpdate = healOnUpdate; return; }
  t.onUpdate = (tex) => {
    if (released(tex)) { healOnUpdate(tex); return; }
    if (kind === 'data') tex.image.data = null;
    else if (tex.image && 'width' in tex.image) { tex.image.width = 1; tex.image.height = 1; }
  };
}

/** Drop a texture's GL storage without forgetting how to regenerate it. */
function reallocate(t) { QUIET++; try { t.dispose(); } finally { QUIET--; } }

/**
 * Regenerate every live procedural texture (after a WebGL context restore). Call it BEFORE the first render after
 * 'webglcontextrestored' (materials.restore() does this); canvases are back immediately, data textures show their
 * placeholder tone until the returned Promise resolves. Idempotent within one restore.
 */
export function restoreTextures() {
  QUIET++;
  try {
    for (const r of REGEN) {
      // the lost context's renderer left 'dispose' listeners on our textures; they would try to delete objects of
      // the dead context (WebGL warnings) — keep only ours (call restore before the first render after a restore)
      for (const t of r.textures || []) { const L = t._listeners && t._listeners.dispose; if (L) t._listeners.dispose = L.filter((f) => f.__villar); }
      r();
    }
  } finally { QUIET--; }
  return whenTexturesReady();
}
export function forgetTextures() { REGEN.clear(); }

function canvasTexture(canvas, { srgb = true, redraw = null } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  if (redraw) {
    const r = () => { t.image = redraw(); reallocate(t); t.needsUpdate = true; releaseAfterUpload(t, 'canvas'); };
    r.textures = [t];
    HEAL.set(t.source, r);
    releaseAfterUpload(t, 'canvas');
    REGEN.add(r);
    const forget = () => { if (!QUIET) REGEN.delete(r); };
    forget.__villar = true;
    t.addEventListener('dispose', forget);
  }
  return t;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// ---------------------------------------------------------------- time-sliced generation
//
// Generators return their textures immediately (allocated at final size, filled with a neutral
// placeholder) and compute the real pixels in ~10 ms slices so the first frame is never blocked.
// bundle.ready → Promise; whenTexturesReady() → Promise for everything queued; flushTextures() → sync.

const QUEUE = [];
let RUNNING = false;
let SYNC = false;
let IDLE_WAITERS = [];
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
if (channel) channel.port1.onmessage = () => runQueue();
const post = () => (channel ? channel.port2.postMessage(0) : setTimeout(runQueue, 0));

export function setTextureSync(v) { SYNC = !!v; }
/** Textures still generating (procedural queue + artworks being painted). */
export function pendingTextures() { return QUEUE.length + ART_PENDING; }
export function whenTexturesReady() {
  if (!QUEUE.length && !ART_PENDING) return Promise.resolve();
  return new Promise((res) => IDLE_WAITERS.push(res));
}
function settle() {
  if (QUEUE.length || ART_PENDING || !IDLE_WAITERS.length) return;
  const w = IDLE_WAITERS; IDLE_WAITERS = []; w.forEach((f) => f());
}
export function flushTextures() {
  while (QUEUE.length) { const j = QUEUE[0]; while (!j.step(1e9)); QUEUE.shift(); j.finish(); }
  settle();
}
const QSTATS = { slices: 0, maxSlice: 0 };
/** Texture-queue slice durations (QA). */
export function textureQueueStats() { return { ...QSTATS, pending: QUEUE.length + ART_PENDING }; }
function runQueue() {
  const t0 = performance.now();
  while (QUEUE.length && performance.now() - t0 < 10) {
    const j = QUEUE[0];
    if (j.step(t0 + 10)) { QUEUE.shift(); j.finish(); }
  }
  const dt = performance.now() - t0;
  QSTATS.slices++; if (dt > QSTATS.maxSlice) QSTATS.maxSlice = dt;
  if (QUEUE.length) post();
  else { RUNNING = false; settle(); }
}
function enqueue(job) {
  if (SYNC) { while (!job.step(1e9)); job.finish(); return; }
  QUEUE.push(job);
  if (!RUNNING) { RUNNING = true; post(); }
}

/**
 * Bundle builder: allocate albedo / rough / height buffers, run per-pixel fn (time-sliced),
 * then derive the normal map. Returns { map, normalMap, roughnessMap, tile, mean, ready, onReady }.
 * `prep()` (optional) runs once before the first pixel (build coarse fields there).
 */
function build(w, h, tile, fn, { normalStrength = 1, albedo = true, rough = true, height = true, placeholder = [0.8, 0.8, 0.8], prep = null, meanOpaque = false } = {}) {
  const N = w * h;
  const repeat = [1 / tile[0], 1 / tile[1]];
  const strength = normalStrength * QUALITY; // keep the physical slope when the resolution is scaled
  // placeholder mean in LINEAR space (same space as the final mean) so pre-ready colours are already close
  const pl = placeholder.map((x) => srgbToLinear(clamp01(x)));
  const out = { tile, mean: pl[0] * 0.3 + pl[1] * 0.59 + pl[2] * 0.11, meanRGB: pl, done: false };
  // T8: creating a bundle (inside materials.get) must be cheap: full-size placeholder buffers are filled with native
  // typed-array fills (no per-pixel JS loop); the generator later overwrites every texel of the same buffers. The
  // size never changes (clones of these textures share one GL allocation — growing it is not possible safely).
  const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const pack4 = (a, b, c, d) => (LE ? ((d << 24) | (c << 16) | (b << 8) | a) >>> 0 : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0);
  const fresh = () => {
    const pr = placeholder.map((x) => Math.round(clamp01(x) * 255));
    const A = albedo ? new Uint8Array(N * 4) : null;
    const R = rough ? new Uint8Array(N * 2).fill(160) : null; // RG8: roughness lives in .g (three samples roughnessMap.g)
    const NM = height ? new Uint8Array(N * 4) : null;
    if (A) new Uint32Array(A.buffer).fill(pack4(pr[0], pr[1], pr[2], 255));
    if (NM) new Uint32Array(NM.buffer).fill(pack4(128, 128, 255, 255));
    return { A, R, NM };
  };
  const first = fresh();
  if (albedo) out.map = dataTexture(first.A, w, h, { srgb: true, repeat });
  if (rough) out.roughnessMap = dataTexture(first.R, w, h, { repeat, format: THREE.RGFormat });
  if (height) out.normalMap = dataTexture(first.NM, w, h, { repeat });
  // placeholder uploads are not released (the generator is still writing into these buffers); heal-only hook
  for (const t of [out.map, out.roughnessMap, out.normalMap]) if (t) t.onUpdate = healOnUpdate;
  const cbs = [];
  out.onReady = (cb) => { if (out.done) cb(out); else cbs.push(cb); };
  let resolve; out.ready = new Promise((r) => { resolve = r; });
  const preps = !prep ? [] : Array.isArray(prep) ? prep : [prep];

  const run = (bufs) => {
    const { A, R, NM } = bufs;
    let H = null;
    const px = { r: 1, g: 1, b: 1, a: 1, rough: 0.5, h: 0 };
    let y = 0, ny = 0, pi = 0;
    enqueue({
      step(deadline) {
        if (height && !H) { H = new Float32Array(N); if (performance.now() > deadline) return false; }
        while (pi < preps.length) { preps[pi++](); if (performance.now() > deadline) return false; }
        while (y < h) {
          const v = (y + 0.5) / h;
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w;
            px.r = px.g = px.b = 1; px.a = 1; px.rough = 0.5; px.h = 0;
            fn(u, v, px, x, y);
            const i = y * w + x;
            if (A) { const j = i * 4; A[j] = clamp01(px.r) * 255 + 0.5; A[j + 1] = clamp01(px.g) * 255 + 0.5; A[j + 2] = clamp01(px.b) * 255 + 0.5; A[j + 3] = clamp01(px.a) * 255 + 0.5; }
            if (R) { const r = clamp01(px.rough) * 255 + 0.5; R[i * 2] = r; R[i * 2 + 1] = r; }
            if (H) H[i] = px.h;
          }
          y++;
          if ((y & 7) === 0 && performance.now() > deadline) return false;
        }
        // normal map, row-sliced
        while (H && ny < h) {
          heightRowToNormal(H, w, h, strength, ny, NM);
          ny++;
          if ((ny & 15) === 0 && performance.now() > deadline) return false;
        }
        return true;
      },
      finish() {
        // meanOpaque: colour compensation over the visible texels only (alpha-cut cane, fringe)
        if (A) { out.mean = meanLinear(A, meanOpaque); out.meanRGB = meanRGB(A, meanOpaque); }
        for (const [t, d] of [[out.map, A], [out.roughnessMap, R], [out.normalMap, NM]]) {
          if (!t) continue;
          t.image.data = d; t.needsUpdate = true; releaseAfterUpload(t, 'data');
        }
        H = null;
        if (!out.done) {
          out.done = true;
          for (const cb of cbs) cb(out);
          resolve(out);
        }
      },
    });
  };
  run(first);
  // restore / heal: placeholder pixels go back immediately (never a null upload), the real ones follow time-sliced
  let healing = false;
  const regen = () => {
    if (healing) return;
    healing = true;
    const bufs = fresh();
    for (const [t, d] of [[out.map, bufs.A], [out.roughnessMap, bufs.R], [out.normalMap, bufs.NM]]) if (t) { t.image.data = d; t.needsUpdate = true; t.onUpdate = healOnUpdate; }
    run(bufs);
    whenTexturesReady().then(() => { healing = false; });
  };
  regen.textures = [out.map, out.roughnessMap, out.normalMap].filter(Boolean);
  for (const t of regen.textures) HEAL.set(t.source, regen);
  REGEN.add(regen);
  return out;
}

/** One row of the height → normal conversion (periodic). */
function heightRowToNormal(H, w, h, strength, y, out) {
  const y0 = ((y - 1 + h) % h) * w, y1 = ((y + 1) % h) * w, yc = y * w;
  for (let x = 0; x < w; x++) {
    const x0 = (x - 1 + w) % w, x1 = (x + 1) % w;
    const dx = (H[yc + x1] - H[yc + x0]) * 0.5 * strength;
    const dy = (H[y1 + x] - H[y0 + x]) * 0.5 * strength;
    const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const j = (yc + x) * 4;
    out[j] = (-dx * inv * 0.5 + 0.5) * 255 + 0.5;
    out[j + 1] = (-dy * inv * 0.5 + 0.5) * 255 + 0.5;
    out[j + 2] = (inv * 0.5 + 0.5) * 255 + 0.5;
    out[j + 3] = 255;
  }
}

/** Periodic coarse field: evaluates fn(u, v) on a gw × gh grid, returns bilinear periodic sampler s(u, v). */
export function field(gw, gh, fn) {
  // rows are evaluated lazily on first use (T8): building a field costs nothing up front, its work is spread over
  // the time-sliced pixel loop instead of one atomic 20–70 ms prep step
  const F = new Float32Array(gw * gh), done = new Uint8Array(gh);
  const row = (j) => { const o = j * gw, v = j / gh; for (let i = 0; i < gw; i++) F[o + i] = fn(i / gw, v); done[j] = 1; };
  return (u, v) => {
    let x = u * gw, yy = v * gh;
    x -= Math.floor(x / gw) * gw; yy -= Math.floor(yy / gh) * gh;
    const x0 = x | 0, y0 = yy | 0; const fx = x - x0, fy = yy - y0;
    const x1 = x0 + 1 === gw ? 0 : x0 + 1, y1 = y0 + 1 === gh ? 0 : y0 + 1;
    if (!done[y0]) row(y0);
    if (!done[y1]) row(y1);
    const a = F[y0 * gw + x0], b = F[y0 * gw + x1], c = F[y1 * gw + x0], d = F[y1 * gw + x1];
    return a + (b - a) * fx + (c - a + (d - c - b + a) * fx) * fy;
  };
}

/** Cheap per-pixel white noise in [-1, 1] (hash). */
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 32767.5 - 1;
}

/** Height (arbitrary units) → OpenGL tangent-space normal map. strength scales slopes (height units per pixel). */
export function heightToNormal(H, w, h, strength = 1) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = ((y - 1 + h) % h) * w, y1 = ((y + 1) % h) * w, yc = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = (x - 1 + w) % w, x1 = (x + 1) % w;
      const dx = (H[yc + x1] - H[yc + x0]) * 0.5 * strength;
      const dy = (H[y1 + x] - H[y0 + x]) * 0.5 * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const j = (yc + x) * 4;
      out[j] = (-dx * inv * 0.5 + 0.5) * 255 + 0.5;
      out[j + 1] = (-dy * inv * 0.5 + 0.5) * 255 + 0.5;
      out[j + 2] = (inv * 0.5 + 0.5) * 255 + 0.5;
      out[j + 3] = 255;
    }
  }
  return out;
}

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = srgbToLinear(i / 255);
function meanRGB(A, opaque = false) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < A.length; i += 16) { if (opaque && A[i + 3] < 128) continue; r += LIN[A[i]]; g += LIN[A[i + 1]]; b += LIN[A[i + 2]]; n++; }
  return n ? [r / n, g / n, b / n] : [0.5, 0.5, 0.5];
}
function meanLinear(A, opaque = false) {
  let s = 0, n = 0;
  for (let i = 0; i < A.length; i += 16) { if (opaque && A[i + 3] < 128) continue; s += LIN[A[i]] * 0.3 + LIN[A[i + 1]] * 0.59 + LIN[A[i + 2]] * 0.11; n++; }
  return n ? s / n : 0.5;
}

// ---------------------------------------------------------------- WOOD

// Optional figure controls (defaults in woodTextures): lateK = latewood darkening toward `dark`, broadK = broad
// (10 cm) tone bands, streakK = light streak strength, flame = heartwood colour streaks (1–4 cm, long along the grain).
export const WOOD_PALETTES = {
  // R2-04: oiled American black walnut — warm mid-brown, sRGB albedo mean ≈ #70503A (Y′ ≈ 86), clearly visible
  // cathedral figure and heartwood streaks (Y′ p5–p95 ≈ 55–115). Dark tones kept low-chroma so B never collapses.
  'walnut-dark':   { light: '#906c4d', mid: '#674530', dark: '#3c291c', streak: '#a98260', rough: 0.42, rings: 34, figure: 1.25, pores: 1.0, lateK: 0.8, broadK: 0.4, streakK: 1.1, flame: 0.55, ref: '#5A3F2E' },
  'walnut-medium': { light: '#8c6345', mid: '#6a4830', dark: '#3e2818', streak: '#98704f', rough: 0.48, rings: 40, figure: 1.0, pores: 0.9 },
  'oak-light':     { light: '#d9bb91', mid: '#c4a174', dark: '#9e7a52', streak: '#e0c49e', rough: 0.55, rings: 58, figure: 0.6, pores: 1.0 },
  'oak-natural':   { light: '#c9a274', mid: '#b08658', dark: '#866039', streak: '#d2ad80', rough: 0.55, rings: 58, figure: 0.6, pores: 1.0 },
  'ash-black':     { light: '#3a3532', mid: '#2a2624', dark: '#151312', streak: '#45403c', rough: 0.5, rings: 52, figure: 0.7, pores: 1.0 },
  'teak':          { light: '#a77a4c', mid: '#8a5f36', dark: '#5e3e22', streak: '#b48756', rough: 0.55, rings: 40, figure: 0.8, pores: 0.7 },
  // Japandi / Scandi furniture woods: pale ash with strong open grain; white-oiled (bleached) oak
  'ash-light':     { light: '#e4cfab', mid: '#d2b78f', dark: '#a98b64', streak: '#ecdcbf', rough: 0.58, rings: 46, figure: 0.9, pores: 1.2 },
  'oak-white':     { light: '#e8d8bc', mid: '#d8c3a1', dark: '#b39b78', streak: '#f0e4cf', rough: 0.6, rings: 58, figure: 0.6, pores: 0.9 },
};

/**
 * Flat-sawn wood field. (um, vm) in metres; along-grain = um. Periodic with period (1.6 m, 0.4 m).
 * Call init() (in a build prep) before sampling. Returns { late, streak, pore }.
 */
function woodSampler(seed, P) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 11), N3 = new Noise(seed + 23), N4 = new Noise(seed + 37);
  const LU = 1.6, LV = 0.4;
  let T = null, ST = null, BR = null;
  const init = () => {
    if (T) return;
    T = field(128, 512, (u, v) => {
      const w1 = N1.fbm(u, v, 3, 2, 3);
      const w2 = N2.fbm(u, v, 4, 16, 2);
      const c = 1 - Math.cos(2 * Math.PI * (v + 0.06 * w1));
      const depth = 0.4 + 0.1 * N3.fbm(u, 0.37, 2, 1, 3) * P.figure;
      const t = P.rings * Math.sqrt(c * 0.5 + depth * depth) + 1.6 * w2 + 1.2 * w1;
      // irregular growth: ring width varies year to year
      return t + 0.9 * N4.n(t * 0.45, 0.5, 4096, 4096);
    });
    ST = field(64, 512, (u, v) => N4.fbm(u, v, 2, 24, 3) * 0.6 + N1.n(u * 3, v * 7, 3, 7) * 0.4);
    BR = field(16, 64, (u, v) => N3.fbm(u, v, 1, 4, 2));
    // heartwood colour streaks: long along the grain (u), 1–4 cm across (v)
    if (P.flame) FL = field(32, 256, (u, v) => N2.fbm(u + 0.31, v, 2, 14, 3) * 0.75 + N3.n(u * 4 + 7, v * 34, 4, 34) * 0.35);
  };
  let FL = null;
  const o = { late: 0, streak: 0, pore: 0, broad: 0, flame: 0 };
  const sample = (um, vm) => {
    const u = fract(um / LU), v = fract(vm / LV);
    const t = T(u, v);
    const p = t - Math.floor(t);
    const k = smooth(0.55, 1.0, p);
    const late = k * k * 0.75 + smooth(0.93, 0.99, p) * (1 - smooth(0.99, 1.0, p)) * 0.25;
    const pn = N2.n(u * 220, v * 1100, 220, 1100);
    o.late = late; o.streak = ST(u, v); o.broad = BR(u, v); o.flame = FL ? FL(u, v) : 0;
    o.pore = smooth(0.42, 0.75, pn) * (0.5 + 0.5 * late) * P.pores;
    return o;
  };
  sample.init = init;
  return sample;
}

function mixRgb(a, b, t, out) { out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t); return out; }

export function woodTextures(species = 'walnut-dark', seed = 7) {
  const P = WOOD_PALETTES[species] || WOOD_PALETTES['walnut-dark'];
  const L = hexToRgb(P.light), M = hexToRgb(P.mid), D = hexToRgb(P.dark), S = hexToRgb(P.streak);
  const sample = woodSampler(seed, P);
  const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
  const lateK = P.lateK ?? 0.5, broadK = P.broadK ?? 0.25, streakK = P.streakK ?? 0.6, flame = P.flame || 0;
  return build(res(512), res(1024), [1.6, 0.4], (u, v, px) => {
    const s = sample(u * 1.6, v * 0.4);
    mixRgb(L, M, clamp01(0.5 + 0.6 * s.streak + 0.4 * s.broad + flame * s.flame * 0.6), tmp);
    mixRgb(tmp, D, clamp01(s.late * lateK + Math.max(0, s.broad) * broadK + Math.max(0, s.flame) * flame * 0.45), tmp2);
    if (s.streak > 0.3) mixRgb(tmp2, S, (s.streak - 0.3) * streakK, tmp2);
    const pd = 1 - s.pore * 0.38;
    px.r = tmp2[0] * pd; px.g = tmp2[1] * pd; px.b = tmp2[2] * pd;
    px.rough = P.rough + s.late * 0.04 + s.pore * 0.18;
    px.h = -s.pore * 1.0 + s.late * 0.06;
  }, { normalStrength: 1.2, placeholder: M, prep: sample.init });
}

/** Wide-plank engineered floor: planks 20 cm × random lengths, tile 2.4 m × 1.2 m. */
export function floorTextures(species = 'oak-light', seed = 3) {
  const P = WOOD_PALETTES[species] || WOOD_PALETTES['oak-light'];
  const L = hexToRgb(P.light), M = hexToRgb(P.mid), D = hexToRgb(P.dark), S = hexToRgb(P.streak);
  const sample = woodSampler(seed, P);
  const r = rng(seed * 13 + 5);
  // engineered wide plank: 20 cm × 1.9–2.5 m, two per row on a 4.4 m tile, staggered; tone ±6 %
  const TU = 4.4, TV = 1.2, ROWS = 6, PW = TV / ROWS;
  const rows = [];
  for (let k = 0; k < ROWS; k++) {
    const start = r() * TU;
    const L1 = 1.9 + r() * 0.6;
    const cuts = [start, (start + L1) % TU];
    const planks = cuts.map(() => ({ ou: r() * 1.6, ov: r() * 0.4, dir: r() < 0.5 ? -1 : 1, tone: 0.94 + r() * 0.12, warm: (r() - 0.5) * 0.03, rough: (r() - 0.5) * 0.05 }));
    rows.push({ cuts, planks });
  }
  const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
  const gap = 0.0011, bevel = 0.0022;
  return build(res(2048), res(1024), [TU, TV], (u, v, px) => {
    const um = u * TU, vm = v * TV;
    const ri = Math.min(ROWS - 1, Math.floor(vm / PW));
    const row = rows[ri];
    const vl = vm - ri * PW;
    const c0 = row.cuts[0], c1 = row.cuts[1];
    const s0 = (um - c0 + TU) % TU, len0 = (c1 - c0 + TU) % TU;
    let pi, sl, plen;
    if (s0 < len0) { pi = 0; sl = s0; plen = len0; } else { pi = 1; sl = s0 - len0; plen = TU - len0; }
    const pk = row.planks[pi];
    const s = sample(pk.ou + sl * pk.dir, pk.ov + vl * 0.95);
    mixRgb(L, M, clamp01(0.5 + 0.5 * s.streak + 0.3 * s.broad), tmp);
    mixRgb(tmp, D, clamp01(s.late * 0.45), tmp2);
    if (s.streak > 0.4) mixRgb(tmp2, S, (s.streak - 0.4) * 0.6, tmp2);
    const pd = (1 - s.pore * 0.22) * pk.tone;
    px.r = tmp2[0] * pd * (1 + pk.warm); px.g = tmp2[1] * pd; px.b = tmp2[2] * pd * (1 - pk.warm);
    const de = Math.min(vl, PW - vl, sl, plen - sl);
    let hgt = -s.pore * 0.5 + s.late * 0.04;
    let rough = P.rough + pk.rough + s.pore * 0.12 + s.late * 0.03;
    if (de < bevel) {
      const k = 1 - de / bevel;
      hgt -= k * k * 6;
      const g = de < gap ? 1 : 0;
      const dark = 1 - 0.22 * k - 0.45 * g;
      px.r *= dark; px.g *= dark; px.b *= dark;
      rough += 0.15 * k;
    }
    px.rough = rough; px.h = hgt;
  }, { normalStrength: 1.0, placeholder: M, prep: sample.init });
}

/** Chevron / herringbone veneer: 45° strips (≈2.8 cm) in alternating 6 cm columns, tile 24 cm. */
export function chevronTextures(species = 'walnut-dark', seed = 9) {
  const P = WOOD_PALETTES[species] || WOOD_PALETTES['walnut-dark'];
  const L = hexToRgb(P.light), M = hexToRgb(P.mid), D = hexToRgb(P.dark), S = hexToRgb(P.streak);
  const sample = woodSampler(seed, P);
  const r = rng(seed + 3);
  const TU = 0.24, TV = 0.24, CW = 0.06, PER = TV / 6, SQ = Math.SQRT1_2;
  const offs = Array.from({ length: 24 }, () => [r() * 1.6, r() * 0.4, 0.92 + r() * 0.14]);
  const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
  return build(res(512), res(512), [TU, TV], (u, v, px) => {
    const um = u * TU, vm = v * TV;
    const k = Math.min(3, Math.floor(um / CW)), xl = um - k * CW, d = k % 2 ? 1 : -1;
    const sv = vm + d * xl;
    const jf = sv / PER, j = Math.floor(jf), fj = jf - j;
    const o = offs[(((j % 6) + 6) % 6) * 4 + k];
    const along = (xl - d * vm) * SQ, across = fj * PER * SQ;
    const sm = sample(o[0] + along, o[1] + across);
    mixRgb(L, M, clamp01(0.5 + 0.6 * sm.streak), tmp);
    mixRgb(tmp, D, clamp01(sm.late * 0.45), tmp2);
    if (sm.streak > 0.3) mixRgb(tmp2, S, (sm.streak - 0.3) * 0.5, tmp2);
    let kk = o[2] * (1 - sm.pore * 0.3);
    const eS = Math.min(fj, 1 - fj) * PER * SQ, eC = Math.min(xl, CW - xl);
    const e = Math.min(eS, eC);
    let h = -sm.pore * 0.6;
    if (e < 0.0008) { kk *= 0.55; h -= 2; } else if (e < 0.0016) { kk *= 0.85; h -= 0.8; }
    px.r = tmp2[0] * kk; px.g = tmp2[1] * kk; px.b = tmp2[2] * kk;
    px.rough = P.rough + sm.pore * 0.15 + (e < 0.0016 ? 0.15 : 0);
    px.h = h;
  }, { normalStrength: 1.4, placeholder: M, prep: sample.init });
}

// ---------------------------------------------------------------- STONE & CERAMIC

export function porcelainTileTextures(seed = 5, color = '#d9d4cc') {
  const N1 = new Noise(seed);
  const base = hexToRgb(color);
  const TU = 1.2, TV = 1.2;
  const tiles = []; const r = rng(seed);
  for (let i = 0; i < 4; i++) tiles.push({ tone: 0.97 + r() * 0.05 });
  const grout = 0.0016, groutCol = [base[0] * 0.82, base[1] * 0.8, base[2] * 0.78];
  let CL;
  return build(res(1024), res(1024), [TU, TV], (u, v, px, x, y) => {
    const um = u * TU, vm = v * TV;
    const row = vm < 0.6 ? 0 : 1;
    const t = tiles[row];
    const vl = vm - row * 0.6;
    const de = Math.min(um, TU - um, vl, 0.6 - vl);
    const cloud = CL(u, v) * 0.5 + 0.5;
    const speck = hash2(x, y, seed);
    const k = t.tone * (0.97 + cloud * 0.05) * (1 - (speck > 0.94 ? 0.06 : 0));
    px.r = base[0] * k; px.g = base[1] * k; px.b = base[2] * k;
    px.rough = 0.34 + cloud * 0.08;
    px.h = cloud * 0.2;
    if (de < grout) { px.r = groutCol[0]; px.g = groutCol[1]; px.b = groutCol[2]; px.rough = 0.9; px.h = -2; }
    else if (de < grout * 2) { px.h -= (1 - (de - grout) / grout) * 1.0; }
  }, { normalStrength: 2.0, placeholder: base, prep: () => { CL = field(256, 256, (u, v) => N1.fbm(u, v, 3, 3, 5)); } });
}

/**
 * Polished white marble (tile 1.6 m): soft cloudy ground, 1–2 major ridged veins per metre along a
 * warped diagonal, thin branching secondaries. Flat (no relief) — polished stone has no vein height.
 */
export function marbleTextures(seed = 21, { base = '#eeebe6', vein = '#9a948c', warm = '#e2d9cc' } = {}) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 3), N3 = new Noise(seed + 5), N4 = new Noise(seed + 9);
  const B = hexToRgb(base), V = hexToRgb(vein), Wm = hexToRgb(warm);
  const tmp = [0, 0, 0];
  let W1, W2, FADE, CL;
  const prep = [
    () => { W1 = field(128, 128, (u, v) => N1.fbm(u, v, 2, 2, 5) * 1.6); },
    () => { W2 = field(128, 128, (u, v) => N2.fbm(u, v, 3, 3, 4) * 1.2); },
    () => { FADE = field(64, 64, (u, v) => N3.fbm(u, v, 2, 2, 3) * 0.5 + 0.5); },
    () => { CL = field(64, 64, (u, v) => N4.fbm(u, v, 2, 2, 4) * 0.5 + 0.5); },
  ];
  return build(res(1024), res(1024), [1.6, 1.6], (u, v, px) => {
    // major veins: meandering along a warped (u+v) diagonal, 2 per tile; long stretches fade out
    const f1 = Math.sin(2 * Math.PI * 2 * (u + v) + W1(u, v) * 3.2);
    const major = Math.pow(Math.max(0, 1 - Math.abs(f1)), 10) * smooth(0.3, 0.65, FADE(u, v));
    // secondaries: finer, branching across, faint
    const f2 = Math.sin(2 * Math.PI * 5 * (u - 1.5 * v) + W2(u, v) * 4.5);
    const minor = Math.pow(Math.max(0, 1 - Math.abs(f2)), 22) * 0.3 * smooth(0.45, 0.8, FADE(fract(u + 0.37), fract(v + 0.21)));
    const cloud = CL(u, v);
    mixRgb(B, Wm, cloud * 0.4, tmp);
    const vv = Math.min(0.55, major * 0.55 + minor);
    mixRgb(tmp, V, vv, tmp);
    px.r = tmp[0]; px.g = tmp[1]; px.b = tmp[2];
  }, { rough: false, height: false, placeholder: B, prep });
}

/** Honed travertine (tile 0.8 m): straight fine bands (±1° wobble), ivory-beige, visible 1–6 mm pits. */
export function travertineTextures(seed = 31, { base = '#e3d6c0', band = '#cdbb9c', light = '#ece2d0' } = {}) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 2), N3 = new Noise(seed + 4);
  const B = hexToRgb(base), Bd = hexToRgb(band), Lt = hexToRgb(light);
  const C = new Cells(seed + 6, 70, 140, 1); // pits ~5.7 × 11 mm cells along the bands
  const tmp = [0, 0, 0];
  let WB, BA, B2, PS;
  const prep = [
    () => { WB = field(64, 32, (u, v) => N1.fbm(u, v, 2, 1, 3) * 0.004); },
    () => { BA = field(16, 1024, (u, v) => N2.fbm(u * 0.01, v, 1, 64, 4)); },
    () => { B2 = field(16, 1024, (u, v) => N3.n(u * 2, v * 260, 2, 260)); },
    () => { PS = field(64, 64, (u, v) => N1.fbm(u, v, 4, 4, 2) * 0.5 + 0.5); },
  ];
  return build(res(1024), res(1024), [0.8, 0.8], (u, v, px, x, y) => {
    const vv = fract(v + WB(u, v));
    const bands = BA(u, vv), fine = B2(u, vv);
    mixRgb(B, Bd, clamp01(bands * 0.9 + 0.35), tmp);
    mixRgb(tmp, Lt, clamp01(fine * 0.35), tmp);
    // pits: darker voids, size varying 1–6 mm, more frequent in some bands
    const c = C.at(u, vv);
    const rad = 0.08 + c[2] * 0.28;
    const pit = (c[2] < 0.35 + 0.3 * PS(u, v)) ? 1 - smooth(rad * 0.6, rad, c[0]) : 0;
    const pd = 1 - pit * 0.42;
    px.r = tmp[0] * pd; px.g = tmp[1] * pd * 0.985; px.b = tmp[2] * pd * 0.96;
    px.rough = 0.45 + pit * 0.35 + hash2(x, y, seed) * 0.02;
    px.h = -pit * 1.5 + fine * 0.05;
  }, { normalStrength: 1.2, placeholder: B, prep });
}

export function quartzTextures(seed = 41, { base = '#e4e0da', dark = '#a8a39c', light = '#f6f4f0' } = {}) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 1);
  const C = new Cells(seed + 7, 160, 160, 0.9);
  const B = hexToRgb(base), Dk = hexToRgb(dark), Lt = hexToRgb(light);
  const tmp = [0, 0, 0];
  let CL, VN;
  return build(res(1024), res(1024), [0.6, 0.6], (u, v, px) => {
    const c = C.at(u, v);
    const cloud = CL(u, v);
    mixRgb(B, Lt, cloud * 0.5, tmp);
    if (c[0] < 0.22) { const k = c[2]; if (k < 0.18) mixRgb(tmp, Dk, 0.8, tmp); else if (k > 0.75) mixRgb(tmp, Lt, 0.9, tmp); }
    const vein = (1 - smooth(0, 0.015, Math.abs(VN(u, v)))) * 0.3;
    mixRgb(tmp, Dk, vein, tmp);
    px.r = tmp[0]; px.g = tmp[1]; px.b = tmp[2];
    px.rough = 0.22 + cloud * 0.05; px.h = 0;
  }, { normalStrength: 0.5, placeholder: B, prep: () => { CL = field(128, 128, (u, v) => N1.fbm(u, v, 2, 2, 4) * 0.5 + 0.5); VN = field(256, 256, (u, v) => N2.fbm(u, v, 2, 3, 4)); } });
}

/** Near-white detail map for coloured matte ceramic (speckles + glaze undulation). */
export function ceramicTextures(seed = 51) {
  const N1 = new Noise(seed);
  const C = new Cells(seed + 2, 90, 90, 1);
  let G;
  return build(res(512), res(512), [0.25, 0.25], (u, v, px, x, y) => {
    const g = G(u, v);
    const c = C.at(u, v);
    let k = 0.97 + g * 0.03;
    if (c[0] < 0.12 && c[2] < 0.3) k *= 0.55 + c[0] * 3;
    const s = hash2(x, y, seed);
    px.r = px.g = px.b = k;
    px.rough = 0.58 + g * 0.06 + s * 0.02;
    px.h = g * 0.8 + s * 0.05;
  }, { normalStrength: 1.4, placeholder: [0.95, 0.95, 0.95], prep: () => { G = field(128, 128, (u, v) => N1.fbm(u, v, 4, 4, 4)); } });
}

/** Speckled stoneware (reactive matte glaze over iron-speckled clay): near-white albedo, ×colour in the material. */
export function stonewareTextures(seed = 57) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 3);
  const C = new Cells(seed + 5, 160, 160, 1), C2 = new Cells(seed + 9, 50, 50, 1);
  let G, P;
  return build(res(512), res(512), [0.25, 0.25], (u, v, px, x, y) => {
    const g = G(u, v), pool = P(u, v);
    let k = 0.95 + g * 0.03 - pool * 0.05;
    const c = C.at(u, v), c2 = C2.at(u, v);
    if (c[0] < 0.09 && c[2] < 0.45) k *= 0.45 + c[0] * 4; // iron speckles 0.3–0.8 mm
    if (c2[0] < 0.07 && c2[2] < 0.25) k *= 0.6 + c2[0] * 5; // a few larger ones
    px.r = k * 0.995; px.g = k * 0.985; px.b = k * 0.965;
    px.rough = 0.5 + g * 0.08 + pool * -0.1 + hash2(x, y, seed) * 0.03;
    px.h = g * 0.6 + pool * 0.4;
  }, { normalStrength: 0.9, placeholder: [0.93, 0.92, 0.9], prep: () => { G = field(128, 128, (u, v) => N1.fbm(u, v, 5, 5, 4)); P = field(64, 64, (u, v) => Math.max(0, N2.fbm(u, v, 2, 2, 3))); } });
}

/** Unglazed terracotta: fine grit, firing blush, lime specks. Near-white albedo × colour in the material. */
export function terracottaTextures(seed = 59) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 2);
  const C = new Cells(seed + 4, 120, 120, 1);
  let G, B;
  return build(res(512), res(512), [0.3, 0.3], (u, v, px, x, y) => {
    const g = G(u, v), bl = B(u, v), s = hash2(x, y, seed);
    let r = 0.93 + bl * 0.06 + g * 0.03 + (s - 0.5) * 0.04, gg = r * (0.98 - bl * 0.03), bb = r * (0.97 - bl * 0.04);
    const c = C.at(u, v);
    if (c[0] < 0.08 && c[2] < 0.3) { r = gg = bb = 1.06; } // lime / grog specks
    px.r = r; px.g = gg; px.b = bb;
    px.rough = 0.88 + s * 0.06;
    px.h = g * 0.5 + s * 0.4 - (c[0] < 0.06 && c[2] > 0.8 ? 0.6 : 0);
  }, { normalStrength: 1.3, placeholder: [0.94, 0.92, 0.9], prep: () => { G = field(128, 128, (u, v) => N1.fbm(u, v, 6, 6, 4)); B = field(32, 32, (u, v) => N2.fbm(u, v, 2, 2, 3)); } });
}

/**
 * Terrazzo: cement matrix with marble/stone chips (mixed sizes, angular Worley cells), honed–polished.
 * base / chips = hex colours. Tile 0.6 m.
 */
export function terrazzoTextures(seed = 63, { base = '#ece6dc', chips = ['#b5674a', '#9a958c', '#d8cfc0', '#3c3a37', '#c9a77a'] } = {}) {
  const N1 = new Noise(seed);
  const Cb = new Cells(seed + 1, 18, 18, 1), Cs = new Cells(seed + 2, 60, 60, 1);
  const bc = hexToRgb(base), cc = chips.map(hexToRgb);
  let G;
  return build(res(1024), res(1024), [0.6, 0.6], (u, v, px, x, y) => {
    const g = G(u, v);
    let c = [bc[0] + g * 0.02, bc[1] + g * 0.02, bc[2] + g * 0.02];
    let chip = 0;
    const big = Cb.at(u, v), sm = Cs.at(u, v);
    // big chips: inside a cell's core (F1 small relative to F2) for ~35 % of cells
    if (big[2] < 0.38 && big[1] - big[0] > 0.12) { c = cc[Math.floor(big[2] * 13) % cc.length].slice(); chip = 1; }
    else if (sm[2] < 0.5 && sm[1] - sm[0] > 0.18) { c = cc[Math.floor(sm[2] * 29) % cc.length].slice(); chip = 1; }
    const s = hash2(x, y, seed) - 0.5;
    if (!chip) { c = c.map((q) => q + s * 0.03); if (hash2(x >> 1, y >> 1, seed + 3) > 0.985) c = c.map((q) => q * 0.8); }
    else c = c.map((q) => q * (0.94 + s * 0.08));
    px.r = c[0]; px.g = c[1]; px.b = c[2];
    px.rough = chip ? 0.16 : 0.24 + g * 0.04;
    px.h = chip ? 0.05 : -0.02 + s * 0.02;
  }, { normalStrength: 0.4, placeholder: [bc[0], bc[1], bc[2]], prep: () => { G = field(64, 64, (u, v) => N1.fbm(u, v, 4, 4, 3)); } });
}

// ---------------------------------------------------------------- WALLS & PAINT

export function plasterTextures(seed = 61) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 7);
  let M, T;
  return build(res(1024), res(1024), [2.0, 2.0], (u, v, px, x, y) => {
    const m = M(u, v), t = T(u, v);
    const f = hash2(x, y, seed);
    px.r = px.g = px.b = 0.985 + m * 0.015 + f * 0.003;
    px.rough = 0.88 + m * 0.04;
    px.h = t * 0.35 + f * 0.06 + m * 0.3;
  }, { normalStrength: 0.9, placeholder: [0.985, 0.985, 0.985], prep: () => { M = field(256, 256, (u, v) => N1.fbm(u, v, 3, 3, 5)); T = field(512, 512, (u, v) => N2.fbm(u, v, 12, 9, 3)); } });
}

/**
 * Eggshell wall paint. Albedo/roughness tile 3 m (large-scale mottling, ±2.5 % × amp, roughness 0.82–0.9);
 * the roller-stipple normal map is a separate fine tile (see paintStippleTextures).
 */
export function paintTextures(seed = 71, amp = 1) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 3);
  let M1, M2;
  const prep = [
    () => { M1 = field(64, 64, (u, v) => N1.fbm(u, v, 2, 2, 3)); },
    () => { M2 = field(128, 128, (u, v) => N2.fbm(u, v, 10, 10, 2)); },
  ];
  return build(res(512), res(512), [3.0, 3.0], (u, v, px, x, y) => {
    const m = M1(u, v) * 0.75 + M2(u, v) * 0.25;
    px.r = px.g = px.b = 0.975 + m * 0.025 * amp + hash2(x, y, seed) * 0.002;
    px.rough = 0.86 + m * 0.04;
  }, { height: false, placeholder: [0.975, 0.975, 0.975], prep });
}

/** Roller stipple: soft 2–3 mm bumps, tile 0.4 m. */
export function paintStippleTextures(seed = 73) {
  const N1 = new Noise(seed);
  return build(res(512), res(512), [0.4, 0.4], (u, v, px) => {
    px.h = N1.fbm(u, v, 160, 160, 2) * 0.6 + N1.n(u * 40, v * 40, 40, 40) * 0.2;
  }, { albedo: false, rough: false, normalStrength: 1.0 });
}

/** Lacquer / powder coat orange-peel. */
export function orangePeelTextures(seed = 81, tile = 0.15) {
  const N1 = new Noise(seed);
  return build(res(256), res(256), [tile, tile], (u, v, px) => {
    const f = N1.fbm(u, v, 24, 24, 3);
    px.rough = 0.5 + f * 0.04;
    px.h = f;
  }, { normalStrength: 0.9, albedo: false });
}

// ---------------------------------------------------------------- METALS

export function brushedTextures(seed = 91) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 1), N3 = new Noise(seed + 2);
  let PA;
  return build(res(512), res(512), [0.25, 0.25], (u, v, px) => {
    const s = N1.n(u * 3, v * 400, 3, 400) * 0.6 + N2.n(u * 8, v * 230, 8, 230) * 0.4;
    const patina = PA(u, v);
    px.r = px.g = px.b = 0.94 + s * 0.04 - patina * 0.08;
    px.rough = 0.3 + s * 0.07 + patina * 0.12;
    px.h = s * 0.5;
  }, { normalStrength: 0.6, placeholder: [0.92, 0.92, 0.92], prep: () => { PA = field(64, 64, (u, v) => N3.fbm(u, v, 2, 2, 4) * 0.5 + 0.5); } });
}

// ---------------------------------------------------------------- TEXTILES

/** Bouclé: dense irregular yarn loops. Near-white detail map. */
/**
 * Bouclé (R2-18): irregular yarn loops 3–4 mm across, gathered in 1–2 cm clumps with deep shadowed valleys
 * between them — the clumps are what reads as "nubby" at 1.5–3 m. Near-white detail map with baked AO,
 * roughness higher in the valleys, strong height for the normal map. Tile 12 cm.
 */
export function boucleTextures(seed = 101) {
  const C1 = new Cells(seed, 32, 32, 1), C2 = new Cells(seed + 1, 52, 52, 1), CL = new Cells(seed + 5, 9, 9, 1);
  const N2 = new Noise(seed + 3);
  return build(res(512), res(512), [0.12, 0.12], (u, v, px, x, y) => {
    const a = C1.at(u, v); const f1 = a[0], f2a = a[1], id1 = a[2];
    const b = C2.at(fract(u + 0.013), fract(v + 0.027)); const g1 = b[0], id2 = b[2];
    const cl = CL.at(u, v);
    // clump: domed tufts with crevices along the clump borders
    const clump = Math.max(0, 1 - cl[0] / 0.85), crev = smooth(0.0, 0.22, cl[1] - cl[0]);
    // loops: a ring of yarn round each cell centre, plus a second, smaller loop layer
    const r0 = 0.3 + id1 * 0.2;
    const ring = Math.exp(-Math.pow((f1 - r0) / 0.1, 2));
    const dome = Math.max(0, 1 - f1 / 0.7);
    const ring2 = Math.exp(-Math.pow((g1 - 0.28 - id2 * 0.1) / 0.1, 2)) * 0.7;
    const fib = hash2(x, y, seed) * 0.1;
    const edge = smooth(0, 0.22, f2a - f1);
    let h = Math.max(ring * 0.9 + dome * 0.35, ring2) * (0.55 + 0.45 * edge) + fib;
    h = h * (0.7 + 0.3 * crev) + clump * 0.45 + N2.n(u * 8, v * 8, 8, 8) * 0.06;
    // AO mostly per loop (fine), only a little per clump — the clumps must read as relief, not as a print
    const ao = (0.64 + 0.36 * clamp01(h * 0.8)) * (0.92 + 0.08 * crev);
    px.r = px.g = px.b = ao * (0.97 + id1 * 0.05);
    px.rough = 0.86 + (1 - crev) * 0.1 + (1 - clamp01(h)) * 0.04;
    px.h = h * 1.25;
  }, { normalStrength: 2.6, placeholder: [0.86, 0.86, 0.86] });
}

/** Linen: plain weave with slubs and thread colour variation. Near-white detail map. */
export function linenTextures(seed = 111, { tile = 0.2, threads = 220, washed = false } = {}) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 1), N3 = new Noise(seed + 2);
  const r = rng(seed); const tc = new Float32Array(threads * 2); for (let i = 0; i < tc.length; i++) tc[i] = r();
  let SW, SF, MO, SWd, SFd;
  // slub thickness per thread along its length (threads × 128 samples), evaluated per thread on first use
  const slubW = (t, k) => { if (!SWd[t]) { for (let q = 0; q < 128; q++) SW[t * 128 + q] = Math.max(0, N1.n(t * 0.37, (q / 128) * 40, 4096, 40)) * 0.9; SWd[t] = 1; } return SW[t * 128 + k]; };
  const slubF = (t, k) => { if (!SFd[t]) { for (let q = 0; q < 128; q++) SF[t * 128 + q] = Math.max(0, N2.n((q / 128) * 40, t * 0.37, 40, 4096)) * 0.9; SFd[t] = 1; } return SF[t * 128 + k]; };
  const prep = () => {
    SW = new Float32Array(threads * 128); SF = new Float32Array(threads * 128); SWd = new Uint8Array(threads); SFd = new Uint8Array(threads);
    MO = field(64, 64, (u, v) => N3.fbm(u, v, 3, 3, 3));
    // stone-washed linen: soft random crinkles a few cm long (ridged noise), periodic over the tile
    if (washed) CR = field(128, 128, (u, v) => { const n = N3.fbm(u, v, 5, 3, 4) + N1.fbm(v, u, 3, 7, 3) * 0.5; return 1 - Math.abs(n) * 2.2; });
  };
  let CR = null;
  return build(res(1024), res(1024), [tile, tile], (u, v, px) => {
    const tx = u * threads, ty = v * threads;
    const ix = Math.floor(tx), iy = Math.floor(ty);
    const fx = tx - ix, fy = ty - iy;
    const slubWarp = slubW(ix, (v * 128) | 0);
    const slubWeft = slubF(iy, (u * 128) | 0);
    const pw = Math.pow(Math.sin(Math.PI * fx), 0.6 - slubWarp * 0.35);
    const pf = Math.pow(Math.sin(Math.PI * fy), 0.6 - slubWeft * 0.35);
    const warpTop = ((ix + iy) & 1) === 0;
    const hw = pw * (0.75 + 0.25 * Math.sin(Math.PI * fy));
    const hf = pf * (0.75 + 0.25 * Math.sin(Math.PI * fx));
    const h = warpTop ? Math.max(hw, hf * 0.55) : Math.max(hf, hw * 0.55);
    const col = warpTop ? 0.9 + tc[ix] * 0.1 + slubWarp * 0.08 : 0.91 + tc[threads + iy] * 0.09 + slubWeft * 0.08;
    const k = col * (0.78 + 0.22 * h) + MO(u, v) * 0.02;
    const cr = CR ? CR(u, v) : 0;
    px.r = px.g = px.b = k * (CR ? 0.97 + cr * 0.03 : 1);
    px.rough = 0.9;
    px.h = h * 0.6 + (warpTop ? slubWarp : slubWeft) * 0.4 + cr * 6;
  }, { normalStrength: 1.6, placeholder: [0.9, 0.9, 0.9], prep });
}

/** Fine cotton percale / sateen for bedding (smooth, subtle). */
/** Cotton percale for bedding: plain weave at 0.6 mm pitch, faint slub/mottle, fully matte. */
export function cottonTextures(seed = 121) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 4);
  const threads = 84; // 5 cm tile → 0.6 mm pitch
  let MO;
  return build(res(512), res(512), [0.05, 0.05], (u, v, px, x, y) => {
    const tx = u * threads, ty = v * threads, ix = Math.floor(tx), iy = Math.floor(ty);
    const fx = tx - ix, fy = ty - iy;
    const warpTop = ((ix + iy) & 1) === 0;
    const hw = Math.sin(Math.PI * fx) * (0.8 + 0.2 * Math.sin(Math.PI * fy));
    const hf = Math.sin(Math.PI * fy) * (0.8 + 0.2 * Math.sin(Math.PI * fx));
    const h = warpTop ? Math.max(hw, hf * 0.6) : Math.max(hf, hw * 0.6);
    const m = MO(u, v) * 0.012 + hash2(x, y, seed) * 0.006;
    const k = 0.965 + 0.035 * h + m;
    px.r = px.g = px.b = k;
    px.rough = 0.95;
    px.h = h * 0.5 + N2.n(u * 12, v * 12, 12, 12) * 0.15;
  }, { normalStrength: 0.9, placeholder: [0.98, 0.98, 0.98], prep: () => { MO = field(32, 32, (u, v) => N1.fbm(u, v, 2, 2, 3)); } });
}

/** Chunky waffle / knit throw: 10 mm waffle cells with twisted yarn ridges. Near-white detail map. */
export function knitTextures(seed = 125) {
  const N1 = new Noise(seed);
  const cells = 12; // 12 cm tile → 10 mm cells
  return build(res(512), res(512), [0.12, 0.12], (u, v, px, x, y) => {
    const cx = fract(u * cells), cy = fract(v * cells);
    // raised ridges on the cell borders, recessed pockets in the centre
    const ex = Math.min(cx, 1 - cx), ey = Math.min(cy, 1 - cy);
    const ridge = Math.max(1 - smooth(0.0, 0.22, ex), 1 - smooth(0.0, 0.22, ey));
    const pocket = smooth(0.15, 0.45, Math.min(ex, ey));
    const twist = Math.sin((u * cells * 6 + v * cells * 6) * Math.PI) * 0.08 * ridge;
    const fib = hash2(x, y, seed) * 0.05 + N1.n(u * 40, v * 40, 40, 40) * 0.05;
    const h = ridge * 0.9 - pocket * 0.5 + twist + fib;
    const k = 0.8 + 0.2 * clamp01(h * 0.6 + 0.5);
    px.r = px.g = px.b = k;
    px.rough = 0.97;
    px.h = h;
  }, { normalStrength: 2.2, placeholder: [0.9, 0.9, 0.9] });
}

/** Voile / sheer: fine open weave with density variation; alpha in the map's alpha channel. */
export function voileTextures(seed = 127) {
  const N1 = new Noise(seed);
  const threads = 40; // 4 cm tile → 1 mm pitch
  let D;
  return build(res(512), res(512), [0.04, 0.04], (u, v, px, x, y) => {
    const fx = fract(u * threads), fy = fract(v * threads);
    const thread = Math.max(Math.pow(Math.sin(Math.PI * fx), 6), Math.pow(Math.sin(Math.PI * fy), 6));
    const dens = D(u, v);
    px.r = px.g = px.b = 0.97 + thread * 0.03;
    px.a = clamp01(0.32 + thread * 0.35 + dens * 0.08);
    px.rough = 0.95; px.h = thread * 0.4;
  }, { normalStrength: 0.6, placeholder: [0.97, 0.97, 0.97], prep: () => { D = field(32, 32, (u, v) => N1.fbm(u, v, 2, 2, 3)); } });
}

/** Paper-cord weave (Danish cord seats): diagonal-ish over/under of twisted cords. */
export function cordTextures(seed = 129, color = '#cdb58a') {
  const base = hexToRgb(color);
  const cords = 16; // 8 cm tile → 5 mm cords
  return build(res(512), res(512), [0.08, 0.08], (u, v, px, x, y) => {
    const tx = u * cords, ty = v * cords, ix = Math.floor(tx), iy = Math.floor(ty);
    const fx = tx - ix, fy = ty - iy;
    const top = ((ix + (iy >> 1)) & 1) === 0; // 2-over-2 pattern
    const across = top ? fy : fx, along = top ? fx : fy;
    const prof = Math.pow(Math.sin(Math.PI * across), 0.6);
    const tw = Math.sin((along * 3 + across * 1.2) * Math.PI * 2) * 0.12; // twist
    const gap = smooth(0.0, 0.1, across) * smooth(0.0, 0.1, 1 - across);
    const k = (0.78 + 0.22 * prof + tw * 0.4) * (0.6 + 0.4 * gap) + hash2(x, y, seed) * 0.02;
    px.r = base[0] * k; px.g = base[1] * k; px.b = base[2] * k;
    px.rough = 0.8; px.h = prof * 0.8 + tw;
  }, { normalStrength: 2.4, placeholder: base });
}

/** Lit lamp-shade emission: linen-like weave × vertical falloff (bright at bulb height, darker at rims). v∈[0,1] across the shade height. */
export function shadeGlowTextures(seed = 133) {
  const threads = 60; // u: 0.2 m tile
  return build(res(256), res(256), [0.2, 1], (u, v, px, x, y) => {
    const fx = fract(u * threads), fy = fract(v * 80);
    const weave = 0.85 + 0.15 * Math.max(Math.sin(Math.PI * fx), Math.sin(Math.PI * fy)) + hash2(x, y, seed) * 0.03;
    const g = 0.42 + 0.58 * Math.exp(-Math.pow((v - 0.5) / 0.32, 2));
    const rim = smooth(0.0, 0.05, v) * smooth(0.0, 0.05, 1 - v);
    const k = g * weave * (0.7 + 0.3 * rim);
    px.r = k; px.g = k * 0.97; px.b = k * 0.92;
  }, { rough: false, height: false, placeholder: [0.8, 0.78, 0.74] });
}

export function velvetTextures(seed = 131) {
  const N1 = new Noise(seed), N3 = new Noise(seed + 2);
  let CR, MM;
  return build(res(512), res(512), [0.4, 0.4], (u, v, px, x, y) => {
    const crush = CR(u, v);
    const fib = hash2(x, y, seed);
    px.r = px.g = px.b = 0.95 + crush * 0.05;
    px.rough = 0.72 + crush * 0.1;
    px.h = fib * 0.04 + MM(u, v) * 0.15 + crush * 0.25;
  }, { normalStrength: 1.0, placeholder: [0.95, 0.95, 0.95], prep: () => { CR = field(128, 128, (u, v) => N1.fbm(u, v, 3, 3, 4)); MM = field(256, 256, (u, v) => N3.fbm(u, v, 12, 12, 2)); } });
}

export function leatherTextures(seed = 141, color = '#8e4f27', size = 1024) {
  const C = new Cells(seed, 120, 120, 1);
  const N1 = new Noise(seed + 1), N2 = new Noise(seed + 2);
  const base = hexToRgb(color);
  let WR, PT;
  return build(res(size), res(size), [0.3, 0.3], (u, v, px) => {
    const c = C.at(u, v);
    const crease = 1 - smooth(0.0, 0.12, c[1] - c[0]);
    const wr = WR(u, v), pat = PT(u, v);
    const k = (0.86 + pat * 0.22) * (1 - crease * 0.12);
    px.r = base[0] * k * (1 + pat * 0.04); px.g = base[1] * k; px.b = base[2] * k * (1 - pat * 0.05);
    px.rough = 0.46 + crease * 0.15 - pat * 0.06;
    px.h = -crease * 0.8 + wr * 0.35 + (1 - c[0]) * 0.15;
  }, { normalStrength: 2.2 * size / 1024, placeholder: base, prep: () => { WR = field(256, 256, (u, v) => N1.fbm(u, v, 6, 6, 4)); PT = field(64, 64, (u, v) => N2.fbm(u, v, 2, 2, 4) * 0.5 + 0.5); } });
}

export function rattanTextures(seed = 151, color = '#c49a5e') {
  const N1 = new Noise(seed), N2 = new Noise(seed + 1);
  const base = hexToRgb(color);
  const strands = 12;
  return build(res(512), res(512), [0.08, 0.08], (u, v, px) => {
    const tx = u * strands, ty = v * strands;
    const ix = Math.floor(tx), iy = Math.floor(ty);
    const fx = tx - ix, fy = ty - iy;
    const top = (((ix >> 1) + (iy >> 1)) & 1) === 0;
    const across = top ? fy : fx; const along = top ? fx : fy;
    const prof = Math.pow(Math.sin(Math.PI * across), 0.5);
    const bendAlong = 0.8 + 0.2 * Math.sin(Math.PI * along);
    const fiber = (top ? N1.n(u * 30, v * 600, 30, 600) : N1.n(v * 30, u * 600, 30, 600)) * 0.08;
    const tone = 0.85 + 0.15 * N2.n(ix * 0.7 + (top ? 0 : 50), iy * 0.7, 4096, 4096);
    const gap = smooth(0.0, 0.12, across) * smooth(0.0, 0.12, 1 - across);
    const k = tone * (0.55 + 0.45 * gap) + fiber;
    px.r = base[0] * k; px.g = base[1] * k; px.b = base[2] * k;
    px.rough = 0.55 + (1 - gap) * 0.3;
    px.h = prof * bendAlong + fiber;
  }, { normalStrength: 3.0, placeholder: base });
}

/**
 * Seven-step Vienna (French) cane webbing — R2-13. Near-white detail map (× material colour), alpha = open
 * octagonal holes. Per 13.3 mm cell: a vertical and a horizontal PAIR of flat glossy strands on the cell borders,
 * and two diagonals forming a diamond that cuts the hole corners (→ octagons). Diagonals lie on top, horizontals
 * cross over verticals in a checker; strands go darker where they dive under another. Hole texels are dark
 * (not just transparent) so mip levels average to a darker woven tone instead of a flat tan sheet.
 * Tile 4 cm (3 × 3 cells).
 */
export function caneTextures(seed = 155) {
  const cells = 3;
  const r = rng(seed); const tones = Float32Array.from({ length: 64 }, () => 0.9 + r() * 0.12);
  const prof = (d, hw) => { const t = d / hw; return t >= 1 ? 0 : Math.sqrt(1 - t * t); }; // rounded flat strand
  return build(res(512), res(512), [0.04, 0.04], (u, v, px, x, y) => {
    const gx = u * cells, gy = v * cells;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const cx = gx - ix - 0.5, cy = gy - iy - 0.5;
    const ax = Math.abs(cx), ay = Math.abs(cy);
    const hw = 0.06, hd = 0.05;
    const sV = prof(Math.abs(ax - 0.43), hw), sH = prof(Math.abs(ay - 0.43), hw);
    const sD = prof(Math.abs(ax + ay - 0.5) / Math.SQRT2, hd);
    // which strand is on top here (crossings): diagonals > (checker) horizontal/vertical
    const hOver = ((ix + iy) & 1) === 0;
    let h = 0, tone = 1, cover = 0;
    const lay = (s, level, tn) => { if (s <= 0) return; const z = level + 0.35 * s; if (z > h) { h = z; tone = tn; cover = s; } };
    lay(sV, hOver ? 0.0 : 0.25, tones[(ix * 2 + (cx > 0 ? 1 : 0)) & 63]);
    lay(sH, hOver ? 0.25 : 0.0, tones[(iy * 2 + (cy > 0 ? 1 : 0) + 17) & 63]);
    lay(sD, 0.5, tones[((ix + iy) * 3 + (cx * cy > 0 ? 5 : 9)) & 63] * 1.02);
    // strands dip (and darken) where another strand passes over them
    const under = (sV > 0 ? 1 : 0) + (sH > 0 ? 1 : 0) + (sD > 0 ? 1 : 0) > 1 ? 1 : 0;
    const fib = hash2(x, y, seed) * 0.04 + Math.sin((cx + cy) * 90) * 0.015;
    if (h > 0) {
      const k = tone * (0.8 + 0.2 * cover) * (under ? 0.92 : 1) + fib;
      px.r = k; px.g = k * 0.985; px.b = k * 0.95; px.a = 1;
      px.rough = 0.34 + (1 - cover) * 0.2 + (under ? 0.06 : 0);
      px.h = h + fib * 0.5;
    } else {
      // open hole: dark (what you see through it at a distance) and transparent
      px.r = 0.12; px.g = 0.1; px.b = 0.08; px.a = 0;
      px.rough = 0.9; px.h = -0.2;
    }
  }, { normalStrength: 3.0, placeholder: [0.62, 0.58, 0.52], meanOpaque: true });
}

/**
 * Rattan wrap / binding cane: glossy peel strips wound round a pole or panel edge (u = along the part, metres),
 * 6 mm strips at a slight helix angle, dark gaps between turns, fibre streaks along each strip. Near-white detail
 * map. Tile 6 cm.
 */
export function rattanWrapTextures(seed = 157) {
  const N1 = new Noise(seed);
  const turns = 10; // 6 cm / 10 → 6 mm strips
  return build(res(256), res(256), [0.06, 0.06], (u, v, px, x, y) => {
    const t = u * turns + v * 0.35 * turns / 10;
    const i = Math.floor(t), f = t - i;
    const prof = Math.pow(Math.max(0, Math.sin(Math.PI * f)), 0.35);
    const fib = N1.n(u * 6, v * 220, 6, 220) * 0.06 + hash2(x, y, seed) * 0.025;
    const tone = 0.88 + 0.1 * Math.sin(i * 12.9898) * 0.5 + fib;
    const k = tone * (0.55 + 0.45 * prof);
    px.r = k; px.g = k * 0.98; px.b = k * 0.93;
    px.rough = 0.32 + (1 - prof) * 0.4;
    px.h = prof + fib * 0.5;
  }, { normalStrength: 2.2, placeholder: [0.85, 0.83, 0.79] });
}

/** Fringe / tassel card (alpha): twisted strands hanging from a knotted band, u across, v 0 (band) → 1 (tips). */
export function fringeTextures(seed = 159) {
  const r = rng(seed); const n = 26; // strands per 10 cm tile
  const len = Float32Array.from({ length: n }, () => 0.78 + r() * 0.2), off = Float32Array.from({ length: n }, () => (r() - 0.5) * 0.25);
  return build(res(256), res(128), [0.1, 1], (u, v, px, x, y) => {
    const s = u * n, i = Math.floor(s) % n, f = s - Math.floor(s);
    const knot = v < 0.14;
    const sway = off[i] * v * v;
    const d = Math.abs(f - 0.5 - sway);
    const w = 0.3 - v * 0.08;
    const on = knot ? (Math.abs(f - 0.5) < 0.48 ? 1 : 0) : (d < w && v < len[i] ? 1 : 0);
    const twist = Math.sin((v * 40 + f * 3) * Math.PI) * 0.06;
    const k = (knot ? 0.92 : 0.86 + twist) * (0.75 + 0.25 * Math.cos(Math.PI * d / Math.max(0.05, w)));
    px.r = px.g = px.b = k;
    px.a = on;
    px.rough = 0.95; px.h = on ? (knot ? 0.8 : 0.5 + twist) : 0;
  }, { normalStrength: 1.5, placeholder: [0.88, 0.88, 0.88], meanOpaque: true });
}

export function juteTextures(seed = 161, color = '#b89a6c') {
  const N2 = new Noise(seed + 1);
  const base = hexToRgb(color);
  const cords = 10;
  return build(res(512), res(512), [0.12, 0.12], (u, v, px, x, y) => {
    const ty = v * cords; const iy = Math.floor(ty); const fy = ty - iy;
    const dir = (iy & 1) ? 1 : -1;
    const twist = fract(u * cords * 3 + dir * fy * 0.9);
    const prof = Math.pow(Math.sin(Math.PI * fy), 0.5);
    const ridge = Math.pow(Math.sin(Math.PI * twist), 0.7);
    const fib = hash2(x, y, seed) * 0.12;
    const tone = 0.85 + 0.15 * N2.n(u * 6, iy * 0.9, 6, 4096);
    const h = prof * (0.6 + 0.4 * ridge) + fib;
    const k = tone * (0.6 + 0.4 * clamp01(h));
    px.r = base[0] * k; px.g = base[1] * k; px.b = base[2] * k;
    px.rough = 0.95; px.h = h;
  }, { normalStrength: 3.0, placeholder: base });
}

/** Wool pile (cut & loop). Near-white detail map. */
export function woolPileTextures(seed = 171) {
  const C = new Cells(seed, 64, 64, 1);
  const N2 = new Noise(seed + 2);
  return build(res(512), res(512), [0.12, 0.12], (u, v, px, x, y) => {
    const c = C.at(u, v);
    const tuft = Math.max(0, 1 - c[0] * 1.3);
    const fib = hash2(x, y, seed) * 0.18;
    const m = N2.n(u * 3, v * 3, 3, 3);
    const h = tuft * 0.8 + fib + m * 0.2;
    px.r = px.g = px.b = (0.8 + 0.2 * clamp01(h)) * (0.97 + c[2] * 0.03);
    px.rough = 0.95; px.h = h;
  }, { normalStrength: 3.0, placeholder: [0.88, 0.88, 0.88] });
}

/**
 * Olive bark (R2-17): grey-brown (#7f7566 ridges → #5e554a fissures), shallow 2–4 cm fissures running along the
 * trunk with flaky plates between them, matte (0.9–0.97). u = around (m), v = along (m). Tile 12 × 30 cm.
 */
export function barkTextures(seed = 143) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 1), N3 = new Noise(seed + 2);
  const hi = hexToRgb('#857a6a'), lo = hexToRgb('#4f473d'), lichen = hexToRgb('#8c8a74');
  const tmp = [0, 0, 0];
  let FI, PL;
  const prep = [
    () => { FI = field(128, 128, (u, v) => { const n = N1.fbm(u, v, 7, 2, 4) + 0.35 * N2.fbm(u, v, 14, 5, 3); return 1 - Math.min(1, Math.abs(n) * 2.4); }); },
    () => { PL = field(128, 128, (u, v) => N3.fbm(u, v, 10, 6, 3)); },
  ];
  return build(res(256), res(512), [0.12, 0.3], (u, v, px, x, y) => {
    const fis = FI(u, v), pl = PL(u, v);
    const ridge = smooth(0.15, 0.75, fis);
    mixRgb(lo, hi, ridge * (0.8 + 0.2 * pl), tmp);
    if (pl > 0.45) mixRgb(tmp, lichen, (pl - 0.45) * 0.5, tmp);
    const n = hash2(x, y, seed) * 0.03;
    px.r = tmp[0] + n; px.g = tmp[1] + n; px.b = tmp[2] + n;
    px.rough = 0.97 - ridge * 0.07;
    px.h = ridge * 1.2 + pl * 0.25 + n;
  }, { normalStrength: 2.2, placeholder: [0.42, 0.39, 0.34], prep });
}

/** Potting top dressing: dark-brown bark-mulch chips with a few pale pebbles. */
export function soilTextures(seed = 181) {
  const C = new Cells(seed, 26, 40, 1), P = new Cells(seed + 3, 14, 14, 1);
  const N1 = new Noise(seed + 1);
  const dark = hexToRgb('#2e2016'), bark = hexToRgb('#5a3d27'), peb = hexToRgb('#b9ad9c');
  const tmp = [0, 0, 0];
  return build(res(256), res(256), [0.2, 0.2], (u, v, px, x, y) => {
    const c = C.at(u, v); const n = N1.fbm(u, v, 8, 8, 3);
    const chip = smooth(0.0, 0.18, c[1] - c[0]);                 // chip plates, dark gaps between
    mixRgb(dark, bark, clamp01(chip * (0.55 + 0.45 * c[2]) + n * 0.15), tmp);
    const p = P.at(u, v);
    const pebble = p[2] < 0.12 ? 1 - smooth(0.18, 0.3, p[0]) : 0;
    if (pebble > 0) mixRgb(tmp, peb, pebble * (0.85 + 0.15 * p[2]), tmp);
    px.r = tmp[0]; px.g = tmp[1]; px.b = tmp[2];
    px.rough = 0.92 - pebble * 0.25;
    px.h = chip * 0.6 + pebble * 1.4 + n * 0.2 + hash2(x, y, seed) * 0.05;
  }, { normalStrength: 3, placeholder: dark });
}

/** Leaf albedo/normal in leaf UV space: u across (0..1, midrib at .5), v along (0 base → 1 tip). White-ish, tinted by vertex colours. */
export function leafTextures(seed = 191) {
  const N1 = new Noise(seed);
  return build(res(256), res(512), [1, 1], (u, v, px) => {
    const x = (u - 0.5) * 2;
    const mid = Math.exp(-Math.pow(x / 0.035, 2));
    const ph = fract(v * 9 - Math.abs(x) * 1.6);
    const lat = Math.exp(-Math.pow((ph - 0.5) / 0.06, 2)) * (1 - Math.abs(x)) * 0.7;
    const n = N1.fbm(u, v, 4, 8, 3);
    const edge = 1 - Math.abs(x);
    const k = 0.88 + n * 0.05 + mid * 0.22 + lat * 0.08 - (1 - edge) * 0.05 + v * 0.04;
    px.r = k * 0.98; px.g = k; px.b = k * 0.94;
    px.rough = 0.5 - mid * 0.05;
    px.h = -mid * 0.6 - lat * 0.4 + n * 0.1;
  }, { normalStrength: 2.0, placeholder: [0.9, 0.9, 0.88] });
}

/**
 * Sansevieria trifasciata 'Laurentii' blade in leaf space (u across 0..1, v base→tip 0..1):
 * dark green with wavy pale grey-green transverse bands (~40 per blade) and a yellow margin.
 * Used with vertex colour ≈ white (per-leaf ±5 % variation).
 */
export function snakeLeafTextures(seed = 233) {
  const N1 = new Noise(seed), N2 = new Noise(seed + 7);
  const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const dark = [0.15, 0.24, 0.13], pale = [0.36, 0.45, 0.31], yel = [0.78, 0.71, 0.33], mid = [0.2, 0.3, 0.16];
  return build(res(256), res(1024), [1, 1], (u, v, px) => {
    const x = Math.abs(u - 0.5) * 2;
    // transverse bands: wavy, broken, variable width (~42 per blade)
    const w = N1.fbm(u, v, 2, 8, 3);
    const ph = v * 34 + Math.sin(u * 5 + v * 11) * 0.4 + w * 2.2;
    const band = sm((Math.sin(ph * Math.PI * 2) * 0.5 + 0.5 - 0.6 + N2.fbm(u, v, 6, 40, 3) * 0.45) / 0.3);
    const blot = 0.85 + N2.fbm(u, v, 3, 12, 3) * 0.25;
    let c = [0, 1, 2].map((k) => (dark[k] + (pale[k] - dark[k]) * band * 0.75) * blot);
    // darker green zone just inside the margin, then the yellow edge
    const inner = sm((x - 0.7) / 0.12);
    c = c.map((ck, k) => ck + (mid[k] - ck) * inner * 0.6);
    const edge = sm((x - 0.84 - N1.fbm(u, v, 1, 4, 2) * 0.03) / 0.05);
    c = c.map((ck, k) => ck + (yel[k] - ck) * edge);
    const tip = sm((v - 0.93) / 0.07);
    c = c.map((ck) => ck * (1 - tip * 0.3));
    px.r = c[0]; px.g = c[1]; px.b = c[2];
    px.rough = 0.42 + band * 0.06;
    px.h = -Math.exp(-Math.pow((u - 0.5) / 0.02, 2)) * 0.3 + band * 0.1;
  }, { normalStrength: 1.0, placeholder: [0.25, 0.34, 0.2] });
}

export function canvasWeaveTextures(seed = 201) {
  const threads = 120;
  return build(res(512), res(512), [0.05, 0.05], (u, v, px, x, y) => {
    const fx = fract(u * threads), fy = fract(v * threads);
    const ix = Math.floor(u * threads), iy = Math.floor(v * threads);
    const top = ((ix + iy) & 1) === 0;
    px.rough = 0.85 + hash2(x >> 3, y >> 3, seed) * 0.04;
    px.h = top ? Math.sin(Math.PI * fx) : Math.sin(Math.PI * fy);
  }, { normalStrength: 1.0, albedo: false });
}

// ---------------------------------------------------------------- RUG PATTERN (canvas, rug UV 0..1)

export function rugPatternTexture(opts = {}) {
  const draw = () => drawRug(opts);
  return canvasTexture(draw(), { redraw: draw });
}

function drawRug({ w = 2.9, d = 2.0, color = '#e3dacb', patternColor = '#b9a88e', pattern = 'plain-border', seed = 1, shape = 'rect' } = {}) {
  const ppm = 200; // px per metre (≈5 mm)
  const W = Math.min(1024, Math.round(w * ppm)), H = Math.min(1024, Math.round(d * ppm));
  const cv = makeCanvas(W, H); const g = cv.getContext('2d');
  const sx = W / w, sy = H / d;
  g.fillStyle = color; g.fillRect(0, 0, W, H);
  const r = rng(seed);
  // subtle abrash (dye lot variation stripes along the length)
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.012 + r() * 0.02})`;
    const y = r() * H, hh = 4 + r() * 30; g.fillRect(0, y, W, hh);
  }
  g.strokeStyle = patternColor; g.fillStyle = patternColor;
  const m = (cm) => cm / 100;
  const rectInset = (inset, lw) => { g.lineWidth = lw * sx; g.strokeRect(inset * sx + g.lineWidth / 2, inset * sy + g.lineWidth / 2, W - 2 * inset * sx - g.lineWidth, H - 2 * inset * sy - g.lineWidth); };
  if (shape === 'round' || shape === 'oval') {
    const ell = (inset, lw) => { g.lineWidth = lw * sx; g.beginPath(); g.ellipse(W / 2, H / 2, W / 2 - inset * sx - g.lineWidth / 2, H / 2 - inset * sy - g.lineWidth / 2, 0, 0, Math.PI * 2); g.stroke(); };
    if (pattern !== 'solid' && pattern !== 'plain') { ell(m(6), m(5)); ell(m(14), m(1.2)); }
  } else if (/^(plain-border|border)$/.test(pattern)) {
    rectInset(m(7), m(6)); rectInset(m(17), m(1.2));
  } else if (pattern === 'double-border') {
    rectInset(m(4), m(2.5)); rectInset(m(10), m(6)); rectInset(m(20), m(1));
  } else if (/stripe|pinstripe/.test(pattern)) {
    const n = Math.round(w / 0.18); g.globalAlpha = 0.85;
    for (let i = 0; i < n; i++) if (i % 2) g.fillRect(i * W / n, 0, (W / n) * (0.35 + 0.3 * r()), H);
    g.globalAlpha = 1;
  } else if (/geometric|diamond|berber|beni|ourain|lattice/.test(pattern)) {
    // hand-drawn lozenge lattice (Beni Ourain style): wobbly, varying stroke
    const cw = 0.42 * sx, chh = 0.62 * sy; g.lineCap = 'round'; g.lineJoin = 'round';
    const wob = (x, y) => [x + (r() - 0.5) * 0.02 * sx, y + (r() - 0.5) * 0.02 * sy];
    const line = (x0, y0, x1, y1) => {
      g.lineWidth = (0.014 + r() * 0.01) * sx; g.beginPath(); let [px, py] = wob(x0, y0); g.moveTo(px, py);
      const n = 6; for (let i = 1; i <= n; i++) { [px, py] = wob(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); g.lineTo(px, py); } g.stroke();
    };
    g.globalAlpha = 0.85;
    for (let y = -chh; y < H + chh; y += chh) for (let x = -cw; x < W + cw; x += cw) {
      line(x + cw / 2, y, x + cw, y + chh / 2); line(x + cw, y + chh / 2, x + cw / 2, y + chh);
    }
    for (let y = -chh; y < H + chh; y += chh) for (let x = -cw; x < W + cw; x += cw) {
      line(x + cw / 2, y, x, y + chh / 2); line(x, y + chh / 2, x + cw / 2, y + chh);
    }
    g.globalAlpha = 1;
  } else if (/abstract|organic|wave|scribble/.test(pattern)) {
    // soft tone-on-tone abstract: sweeping hand-tufted curves + a few blots
    g.globalAlpha = 0.55; g.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      g.lineWidth = (0.03 + r() * 0.05) * sx; g.beginPath();
      let x = r() * W, y = r() * H; g.moveTo(x, y);
      for (let k = 0; k < 3; k++) { const x2 = r() * W, y2 = r() * H; g.bezierCurveTo(x + (r() - 0.5) * W, y + (r() - 0.5) * H, x2 + (r() - 0.5) * W * 0.5, y2, x2, y2); x = x2; y = y2; }
      g.stroke();
    }
    g.globalAlpha = 0.35;
    for (let i = 0; i < 5; i++) { g.beginPath(); const cx = r() * W, cy = r() * H, rr = (0.15 + r() * 0.3) * sx; g.ellipse(cx, cy, rr, rr * (0.4 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  } else if (pattern === 'distressed' || pattern === 'vintage') {
    rectInset(m(8), m(5));
    g.globalAlpha = 0.25; g.lineWidth = 2;
    for (let i = 0; i < 400; i++) { const x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + r() * 30, y + (r() - 0.5) * 4); g.stroke(); }
    g.globalAlpha = 1;
  }
  // 'solid' / 'plain' / unknown → plain
  return cv;
}

// ---------------------------------------------------------------- ART (canvas)

const MOTIFS = ['abstract-arches', 'sun', 'organic', 'line', 'landscape', 'botanical', 'stripes', 'grid', 'blocks', 'textured', 'wave', 'amphora', 'shapes', 'dune', 'vase', 'leaf'];

/** Returns a CanvasTexture; with relief: true returns { map, normalMap } (impasto / plaster relief). */
// Art is painted off the main thread when a renderer is registered (furniture/index.js → build worker, T8): the
// texture starts as a full-size canvas in the painting's ground colour (+ flat relief normals), the pixels land a
// few hundred ms later. Without a worker the paint runs in a separate task (never inside materials.get()).
let ART_RENDERER = null;
let ART_PENDING = 0;
/** fn(opts) → Promise<{ w, h, rgba: Uint8ClampedArray, normal: { data, w, h } | null }> | null */
export function setArtRenderer(fn) { ART_RENDERER = typeof fn === 'function' ? fn : null; }
/** Paint an artwork and return its pixels (used by the build worker). */
export function renderArtData(opts = {}) {
  const r = renderArt(opts);
  const img = r.canvas.getContext('2d').getImageData(0, 0, r.canvas.width, r.canvas.height);
  return { w: r.canvas.width, h: r.canvas.height, rgba: img.data, normal: r.normal };
}
const artSize = (opts) => { const H = 1024; return [Math.max(64, Math.round(H * (opts.aspect || 0.7))), H]; };
function artGround(opts) {
  const cols = opts.colors && opts.colors.length ? opts.colors : ['#B5653F', '#E6DDCF', '#7A7B55'];
  return cols.find((c) => lum(c) > 0.7) || '#efe8dc';
}

export function artTexture(opts = {}) {
  const [W, H] = artSize(opts);
  // full-size ground-colour placeholder (a native fill — cheap inside materials.get); the paint lands in the same size
  const ground = () => { const cv = makeCanvas(W, H); const g = cv.getContext('2d'); g.fillStyle = artGround(opts); g.fillRect(0, 0, W, H); return cv; };
  const t = canvasTexture(ground());
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.name = 'art:' + (opts.motif || '');
  t.onUpdate = healOnUpdate;
  let nt = null;
  const RW = Math.min(512, W), RH = Math.round(RW * H / W);
  const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const flat = () => { const d = new Uint8Array(RW * RH * 4); new Uint32Array(d.buffer).fill(LE ? 0xFFFF8080 : 0x8080FFFF); return d; };
  if (opts.relief) {
    nt = new THREE.DataTexture(flat(), RW, RH, THREE.RGBAFormat, THREE.UnsignedByteType);
    nt.flipY = false; nt.colorSpace = THREE.NoColorSpace; nt.generateMipmaps = true; nt.minFilter = THREE.LinearMipmapLinearFilter; nt.magFilter = THREE.LinearFilter; nt.anisotropy = MAX_ANISO;
    nt.wrapS = nt.wrapT = THREE.ClampToEdgeWrapping;
    nt.name = t.name + ':relief';
    // canvas rows run top→bottom while DataTexture rows run bottom→top: flip via the texture transform
    nt.repeat.set(1, -1); nt.offset.set(0, 1);
    nt.needsUpdate = true;
    nt.onUpdate = healOnUpdate;
  }
  let gen = 0;
  const apply = (r, my) => {
    if (my !== gen || !r || r.w !== W || r.h !== H) return;
    // the ground canvas may have been released (1 × 1) meanwhile: paint into a fresh one and reallocate
    let cv = t.image;
    if (!cv || cv.width !== W || cv.height !== H) { cv = makeCanvas(W, H); t.image = cv; reallocate(t); }
    cv.getContext('2d').putImageData(new ImageData(r.rgba, W, H), 0, 0);
    t.needsUpdate = true; releaseAfterUpload(t, 'canvas');
    if (nt && r.normal && r.normal.w === RW && r.normal.h === RH) { nt.image.data = r.normal.data; nt.needsUpdate = true; releaseAfterUpload(nt, 'data'); }
  };
  const paint = () => {
    const my = ++gen;
    ART_PENDING++;
    const local = () => new Promise((res) => setTimeout(() => res(renderArtData(opts)), 0));
    let job = null;
    try { job = ART_RENDERER ? ART_RENDERER(opts) : null; } catch { job = null; }
    (job || local()).catch(() => local()).then((r) => apply(r, my)).catch((e) => console.debug('[textures] art paint failed', e))
      .finally(() => { ART_PENDING--; settle(); });
  };
  // T4 restore / heal: full-size ground canvas with fresh GL storage at once (never black, never 1 × 1), then repaint
  const regen = () => {
    t.image = ground(); reallocate(t); t.needsUpdate = true; t.onUpdate = healOnUpdate;
    if (nt) { nt.image.data = flat(); nt.needsUpdate = true; nt.onUpdate = healOnUpdate; }
    paint();
  };
  regen.art = true;
  regen.textures = nt ? [t, nt] : [t];
  HEAL.set(t.source, regen);
  if (nt) HEAL.set(nt.source, regen);
  REGEN.add(regen);
  const forget = () => { if (!QUIET) REGEN.delete(regen); };
  forget.__villar = true;
  t.addEventListener('dispose', forget);
  paint();
  return nt ? { map: t, normalMap: nt } : t;
}

/** Re-upload every art canvas now (engine hook for context restore; restoreTextures() includes this). */
export function restoreArt() { QUIET++; try { for (const r of REGEN) if (r.art) r(); } finally { QUIET--; } }

function renderArt({ motif = 'abstract-arches', colors = ['#B5653F', '#E6DDCF', '#7A7B55'], aspect = 0.7, seed = 1, relief = false } = {}) {
  const H = 1024, W = Math.max(64, Math.round(H * aspect));
  const cv = makeCanvas(W, H); const g = cv.getContext('2d');
  const r = rng(seed + hashStr(motif));
  const cols = (colors && colors.length ? colors : ['#B5653F', '#E6DDCF', '#7A7B55']).slice();
  const paper = '#efe8dc';
  const pick = (i) => cols[i % cols.length];
  let m = String(motif || '').toLowerCase();
  if (!MOTIFS.some((k) => m.includes(k.split('-')[0]))) m = MOTIFS[hashStr(m) % MOTIFS.length];
  const strokes = []; // relief height strokes [x, y, w, h, angle, height]
  const bg = cols.find((c) => lum(c) > 0.7) || paper;
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const others = cols.filter((c) => c !== bg);
  const oc = (i) => (others.length ? others[i % others.length] : pick(i));
  // painterly fill (R2-22): base colour, then 18–40 translucent brush drags clipped to the shape (±7 % tone),
  // then a soft blurred edge — no flat vector fills
  const paint = (path, color, { strokes = 26, soft = 2.2, dir = 0 } = {}) => {
    g.save(); g.fillStyle = color; g.filter = `blur(${soft}px)`; g.fill(path); g.filter = 'none';
    g.clip(path);
    const bb = { w: W, h: H };
    for (let i = 0; i < strokes; i++) {
      g.globalAlpha = 0.08 + r() * 0.12; g.strokeStyle = shade(color, (r() - 0.5) * 0.14);
      g.lineWidth = W * (0.03 + r() * 0.06); g.lineCap = 'round';
      const x = r() * bb.w, y = r() * bb.h, a = dir + (r() - 0.5) * 0.6, L = W * (0.15 + r() * 0.35);
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + (r() - 0.5) * W * 0.05, y + Math.sin(a) * L * 0.5 + (r() - 0.5) * W * 0.05, x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
    }
    g.restore(); g.globalAlpha = 1;
  };
  const blob = (cx, cy, rx, ry, k, ph) => { const p2 = new Path2D(); for (let a = 0; a <= 48; a++) { const t = (a / 48) * Math.PI * 2; const rr = 1 + 0.12 * Math.sin(t * k + ph) + 0.05 * Math.sin(t * (k + 2) + ph * 2); const x = cx + Math.cos(t) * rx * rr, y = cy + Math.sin(t) * ry * rr; a ? p2.lineTo(x, y) : p2.moveTo(x, y); } p2.closePath(); return p2; };
  if (m.includes('wave') || m.includes('dune') || m.includes('sand')) {
    // sand-wave relief (Macaire): sinuous horizontal dune bands, each a step in tone and height
    const bands = 7;
    for (let i = 0; i < bands; i++) {
      const p2 = new Path2D(); const y0 = H * (0.12 + i * 0.13), amp = H * (0.035 + r() * 0.03), k = 1 + r() * 1.4, ph = r() * 6.28;
      p2.moveTo(0, H); for (let x = 0; x <= W; x += W / 48) p2.lineTo(x, y0 + Math.sin((x / W) * Math.PI * 2 * k + ph) * amp + Math.sin((x / W) * 17 + i) * amp * 0.12); p2.lineTo(W, H); p2.closePath();
      paint(p2, shade(i % 2 ? oc(0) : (cols[2] || oc(1)), (i - bands / 2) * 0.025), { strokes: 14, soft: 1.5, dir: 0 });
      strokes.push([W / 2, y0, W * 1.1, H * 0.02, 0, 0.35]);
    }
  } else if (m.includes('amphora') || m.includes('vase') || m.includes('urn')) {
    // amphora relief (Erato): a turned vessel silhouette standing proud of a plaster ground
    for (let i = 0; i < 40; i++) { g.globalAlpha = 0.06; g.fillStyle = shade(bg, (r() - 0.5) * 0.1); g.beginPath(); g.ellipse(r() * W, r() * H, W * (0.1 + r() * 0.2), H * (0.05 + r() * 0.1), r() * 3, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    const cx = W / 2, top = H * 0.16, bot = H * 0.86, Rm = W * 0.21;
    const prof = [[0.16, 0], [0.2, 0.04], [0.13, 0.1], [0.13, 0.17], [0.6, 0.32], [1, 0.5], [0.92, 0.68], [0.55, 0.86], [0.3, 0.96], [0.36, 1]];
    const p2 = new Path2D(); prof.forEach(([q, t], i) => { const x = cx + q * Rm, y = top + t * (bot - top); i ? p2.lineTo(x, y) : p2.moveTo(x, y); });
    for (let i = prof.length - 1; i >= 0; i--) { const [q, t] = prof[i]; p2.lineTo(cx - q * Rm, top + t * (bot - top)); } p2.closePath();
    paint(p2, oc(0), { strokes: 30, soft: 2, dir: Math.PI / 2 });
    // handles
    g.strokeStyle = oc(0); g.lineWidth = W * 0.022; g.lineCap = 'round';
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * Rm * 0.14, top + 0.12 * (bot - top)); g.bezierCurveTo(cx + s * Rm * 0.55, top + 0.05 * (bot - top), cx + s * Rm * 0.75, top + 0.2 * (bot - top), cx + s * Rm * 0.62, top + 0.32 * (bot - top)); g.stroke(); }
  } else if ((m.includes('abstract') && m.includes('shape')) || m.includes('aquarelle') || m.includes('composition')) {
    // composed abstract (soft-edged, painterly): a large arch / half-moon, a pebble, a thin brush line
    const big = new Path2D(); const ax = W * (0.36 + r() * 0.12), aw = W * (0.3 + r() * 0.06), ay = H * (0.42 + r() * 0.1);
    big.moveTo(ax - aw, H * 0.9); big.lineTo(ax - aw, ay); big.arc(ax, ay, aw, Math.PI, 0); big.lineTo(ax + aw, H * 0.9); big.closePath();
    paint(big, oc(0), { strokes: 34, soft: 2.5, dir: Math.PI / 2 });
    paint(blob(W * (0.66 + r() * 0.1), H * (0.62 + r() * 0.1), W * 0.16, H * 0.11, 3, r() * 6), oc(1), { strokes: 20, soft: 2.5 });
    paint(blob(W * 0.3, H * 0.24, W * 0.08, W * 0.08, 2, r() * 6), cols[2] || shade(oc(1), -0.15), { strokes: 10, soft: 2 });
    g.globalAlpha = 0.7; g.strokeStyle = shade(oc(0), -0.25); g.lineWidth = W * 0.006; g.lineCap = 'round';
    g.beginPath(); g.moveTo(W * 0.12, H * 0.8); g.bezierCurveTo(W * 0.4, H * 0.7, W * 0.6, H * 0.88, W * 0.88, H * 0.74); g.stroke(); g.globalAlpha = 1;
  } else if (m.includes('textur') || m.includes('impasto') || m.includes('plaster')) {
    // tone-on-tone plaster (Zuri): long sweeping palette-knife arcs close to the ground colour, a few faint accents
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = r() * W, y = r() * H, L = W * (0.25 + r() * 0.45), a = (r() - 0.5) * 0.9, bend = (r() - 0.5) * H * 0.25;
      g.globalAlpha = 0.18 + r() * 0.22; g.strokeStyle = i % 9 === 0 ? oc(1) : shade(bg, (r() - 0.45) * 0.12);
      g.lineWidth = H * (0.02 + r() * 0.05);
      g.beginPath(); g.moveTo(x - Math.cos(a) * L / 2, y - Math.sin(a) * L / 2); g.quadraticCurveTo(x, y + bend, x + Math.cos(a) * L / 2, y + Math.sin(a) * L / 2); g.stroke();
      strokes.push([x, y + bend * 0.5, L, g.lineWidth, a, 0.3 + r() * 0.5]);
    }
    g.globalAlpha = 1;
  } else if (m.includes('arch')) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const cx = W * (0.3 + 0.4 * (i / (n - 1))) + (r() - 0.5) * W * 0.1, w2 = W * (0.22 + r() * 0.1);
      const top = H * (0.25 + r() * 0.25), bot = H * (0.82 + r() * 0.06);
      g.fillStyle = oc(i); g.globalAlpha = 0.95;
      g.beginPath(); g.moveTo(cx - w2, bot); g.lineTo(cx - w2, top + w2); g.arc(cx, top + w2, w2, Math.PI, 0); g.lineTo(cx + w2, bot); g.closePath(); g.fill();
    }
    g.globalAlpha = 1; g.fillStyle = oc(1); g.beginPath(); g.arc(W * 0.68, H * 0.2, W * 0.09, 0, Math.PI * 2); g.fill();
    g.fillStyle = shade(bg, -0.12); g.fillRect(0, H * 0.86, W, H * 0.14);
  } else if (m.includes('sun') || m.includes('circle')) {
    g.fillStyle = oc(0); g.beginPath(); g.arc(W * 0.5, H * 0.45, W * 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = oc(1); g.fillRect(0, H * 0.62, W, H * 0.38);
    g.fillStyle = oc(2); g.fillRect(0, H * 0.8, W, H * 0.2);
  } else if (m.includes('organic') || m.includes('blob') || m.includes('abstract')) {
    // three overlapping soft organic forms in a balanced diagonal (was six random flat blobs → "camouflage")
    const spots = [[0.36, 0.38, 0.26], [0.64, 0.6, 0.22], [0.42, 0.74, 0.13]];
    spots.forEach(([fx, fy, fr], i) => paint(blob(W * (fx + (r() - 0.5) * 0.06), H * (fy + (r() - 0.5) * 0.05), W * fr, W * fr * (0.75 + r() * 0.2), 3, r() * 6), oc(i), { strokes: 22, soft: 2.5 }));
  } else if (m.includes('line')) {
    g.strokeStyle = oc(0); g.lineWidth = W * 0.006; g.lineCap = 'round';
    g.beginPath(); let x = W * 0.3, y = H * 0.2; g.moveTo(x, y);
    for (let i = 0; i < 7; i++) { const x2 = W * (0.2 + r() * 0.6), y2 = H * (0.2 + r() * 0.6); g.bezierCurveTo(x + (r() - 0.5) * W, y + (r() - 0.5) * H * 0.4, x2 + (r() - 0.5) * W * 0.5, y2, x2, y2); x = x2; y = y2; }
    g.stroke(); g.fillStyle = oc(1); g.beginPath(); g.arc(W * 0.62, H * 0.4, W * 0.12, 0, Math.PI * 2); g.globalAlpha = 0.8; g.fill(); g.globalAlpha = 1;
  } else if (m.includes('landscape')) {
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      g.fillStyle = shade(oc(i), i * 0.04); g.beginPath();
      const base = H * (0.45 + i * 0.12); g.moveTo(0, H);
      for (let x = 0; x <= W; x += W / 20) g.lineTo(x, base - Math.sin(x / W * Math.PI * (1 + i) + i) * H * 0.05 - r() * H * 0.01);
      g.lineTo(W, H); g.closePath(); g.fill();
    }
    g.fillStyle = oc(1); g.beginPath(); g.arc(W * 0.7, H * 0.28, W * 0.08, 0, Math.PI * 2); g.fill();
  } else if (m.includes('botan') || m.includes('leaf')) {
    g.strokeStyle = oc(0); g.fillStyle = oc(0); g.lineWidth = W * 0.008;
    g.beginPath(); g.moveTo(W * 0.5, H * 0.9); g.quadraticCurveTo(W * 0.45, H * 0.5, W * 0.55, H * 0.12); g.stroke();
    for (let i = 0; i < 9; i++) {
      const t = 0.15 + i * 0.085; const y = H * (0.9 - t * 0.85); const x = W * (0.5 + (0.03 * Math.sin(t * 6)));
      const side = i % 2 ? 1 : -1;
      g.save(); g.translate(x, y); g.rotate(side * (0.9 - t * 0.4)); g.beginPath(); g.ellipse(0, -W * 0.09, W * 0.04, W * 0.1, 0, 0, Math.PI * 2); g.globalAlpha = 0.9; g.fill(); g.restore();
    }
    g.globalAlpha = 1;
  } else if (m.includes('stripe')) {
    const n = 7; for (let i = 0; i < n; i++) { g.fillStyle = oc(i); g.fillRect(0, H * (0.12 + i * 0.11), W, H * 0.06); }
  } else if (m.includes('grid') || m.includes('block')) {
    const nx = 3, ny = 4, pad = W * 0.06;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      g.fillStyle = oc(i + j * 2 + Math.floor(r() * 2)); const cw = (W - pad * (nx + 1)) / nx, ch = (H - pad * (ny + 1)) / ny;
      g.fillRect(pad + i * (cw + pad), pad + j * (ch + pad), cw, ch);
    }
  }
  // paper grain
  const img = g.getImageData(0, 0, W, H); const d = img.data; const rr = rng(seed + 99);
  for (let i = 0; i < d.length; i += 4) { const n = (rr() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  if (!relief) return { canvas: cv, normal: null };
  // relief: height from blurred luminance edges (shapes stand proud) + knife strokes + fine grain
  const RW = Math.min(512, W), RH = Math.round(RW * H / W);
  const sc = makeCanvas(RW, RH); const sg = sc.getContext('2d');
  sg.filter = 'blur(2px)'; sg.drawImage(cv, 0, 0, RW, RH); sg.filter = 'none';
  const pix = sg.getImageData(0, 0, RW, RH).data;
  const bgc = hexToRgb(bg); const bgl = bgc[0] * 0.3 + bgc[1] * 0.59 + bgc[2] * 0.11;
  const Hh = new Float32Array(RW * RH);
  const rn = rng(seed + 7);
  for (let i = 0; i < RW * RH; i++) { const l = (pix[i * 4] * 0.3 + pix[i * 4 + 1] * 0.59 + pix[i * 4 + 2] * 0.11) / 255; Hh[i] = Math.min(1, Math.abs(l - bgl) * 3) * 1.5 + (rn() - 0.5) * 0.08; }
  for (const [x, y, w, h, a, hh] of strokes) {
    const cx = x * RW / W, cy = y * RH / H, rw = w * RW / W / 2, rh = h * RH / H / 2, ca = Math.cos(a), sa = Math.sin(a);
    const R = Math.ceil(Math.max(rw, rh)) + 1;
    for (let yy = Math.max(0, (cy - R) | 0); yy < Math.min(RH, cy + R); yy++) for (let xx = Math.max(0, (cx - R) | 0); xx < Math.min(RW, cx + R); xx++) {
      const dx = xx - cx, dy = yy - cy; const u2 = (dx * ca + dy * sa) / rw, v2 = (-dx * sa + dy * ca) / rh; const d = u2 * u2 + v2 * v2;
      if (d < 1) Hh[yy * RW + xx] += hh * (1 - d) * (0.6 + 0.4 * Math.sin(u2 * 9));
    }
  }
  return { canvas: cv, normal: { data: heightToNormal(Hh, RW, RH, 3.0), w: RW, h: RH } };
}

function lum(hex) { const [r, g, b] = hexToRgb(hex); return 0.3 * r + 0.59 * g + 0.11 * b; }
function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  const f = (x) => Math.round(clamp01(k >= 0 ? x + (1 - x) * k : x * (1 + k)) * 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
