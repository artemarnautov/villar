// Villar — photoscanned material prep (PHOTOREAL lever 2). Owner: modeler.
//
// Turns CC0 photoscanned PBR sets (Poly Haven / ambientCG, taken from the zuujis-cc0 GitHub mirrors) into the
// small, tileable, runtime-ready maps under site/assets/materials/, plus index.json (what the engine loads) and
// LICENSES.md (source URL + licence of every file).
//
//   # 1. sparse-clone the sources (GitHub only; blobless so only the 2K maps are downloaded)
//   git clone --depth 1 --filter=blob:none --sparse --no-checkout https://github.com/zuujis-cc0/<repo> /tmp/assets/<repo>
//   (cd /tmp/assets/<repo> && git sparse-checkout add /<asset>/2k/<asset>_diff_2k.jpg … && git checkout HEAD)
//   # 2. build
//   NODE_PATH=$(npm root -g) node tools/materials-prep.mjs --src /tmp/assets [--only walnut,linen]
//
// Output conventions (read by site/js/engine/textures.js → scanTextures):
//  • files are stored VERTICALLY FLIPPED (first row = v 0), so they upload with flipY = false from an ImageBitmap
//    exactly like a DataTexture; the normal maps are OpenGL (+Y = +v);
//  • wood grain runs along U (image x), like the procedural wood (sets are rotated here when needed);
//  • mode 'color'  → sRGB albedo kept in colour (woods, stone, rattan, bark); runtime shifts its mean to the
//                    catalogue colour (matchColor);
//    mode 'detail' → grey luminance detail, linear mean = 0.5 (fabrics, plaster, leather, rugs, leaves); runtime
//                    multiplies it by catalogue colour / 0.5, so every item keeps the colour of its card;
//  • ambient occlusion is baked into the albedo (no aoMap → no shader variant change when a scan replaces a
//    procedural map); low-frequency luminance drift is flattened so a tile does not read as a repeat;
//  • sizes are power-of-two box reductions of the 2K source (exactly tileable); JPEG (mozjpeg), normal maps 4:4:4.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'assets', 'materials');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, c, i, arr) => (c.startsWith('--') && a.push([c.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]), a), []));
const SRC = args.src || '/tmp/assets';
const ONLY = args.only ? String(args.only).split(',') : null;

// ---------------------------------------------------------------- the library
// tile = metres covered by one texture tile [u, v] (estimated from thread / ring / plank pitch of the scan)
// sizes: first = largest written; 2048 only where the extra texels are visible (the floor)
const ph = (repo, asset) => ({ kind: 'ph', repo, asset });
const acg = (repo, asset) => ({ kind: 'acg', repo, asset });
const SETS = [
  // woods (grain along U)
  // walnut-dark: strongly figured (heartwood streaks, cathedrals) like oiled American walnut furniture;
  // walnut-medium: the quieter crown-cut veneer
  { id: 'walnut', title: 'figured walnut veneer', src: ph('polyhaven-textures-wood-3', 'smoked_walnut_veneer'), mode: 'color', tile: [1.1, 1.1], rotate: 0, flatten: { k: 0.35, cells: 4 }, ao: 0.3, sizes: [1024, 512] },
  { id: 'walnut-2', title: 'walnut veneer (crown cut)', src: ph('polyhaven-textures-wood-3', 'walnut_veneer_02'), mode: 'color', tile: [1.0, 1.0], rotate: 0, flatten: { k: 0.45, cells: 5 }, contrast: 1.2, ao: 0.3, sizes: [1024, 512] },
  { id: 'oak', title: 'oak veneer (crown cut)', src: ph('polyhaven-textures-wood-2', 'oak_veneer_01'), mode: 'color', tile: [0.8, 0.8], rotate: 90, flatten: { k: 0.55, cells: 6 }, ao: 0.3, sizes: [1024, 512] },
  { id: 'oak-white', title: 'white oak veneer (ash, white-oiled oak, black-stained ash)', src: ph('polyhaven-textures-wood-3', 'white_oak_veneer'), mode: 'color', tile: [0.8, 0.8], rotate: 90, flatten: { k: 0.55, cells: 6 }, ao: 0.3, sizes: [1024, 512] },
  { id: 'teak', title: 'teak veneer', src: ph('polyhaven-textures-wood-3', 'teak_veneer'), mode: 'color', tile: [0.9, 0.9], rotate: 0, flatten: { k: 0.5, cells: 6 }, ao: 0.3, sizes: [1024, 512] },
  // wide-plank engineered oak floor: 13 boards of ≈ 19 cm per tile; end joints + micro-bevels are added here
  { id: 'floor-oak', title: 'oak wide-plank floor', src: ph('polyhaven-textures-wood-2', 'oak_wood_planks'), mode: 'color', tile: [2.46, 2.46], rotate: 0, flatten: { k: 0.35, cells: 4 }, ao: 0.3, planks: { rows: 13, seed: 7 }, sizes: [2048, 1024, 512] },
  // textiles (detail luminance; colour comes from the catalogue)
  // linen: scanned at shirting scale → shown at upholstery scale (≈ 2× coarser yarn), slubs lifted
  { id: 'linen', title: 'rough linen', src: ph('polyhaven-textures-textiles-and-leather-2', 'rough_linen'), mode: 'detail', tile: [0.55, 0.55], flatten: { k: 1, cells: 8 }, contrast: 1.6, ao: 0.5, sizes: [1024, 512] },
  // bouclé: looped curly wool (teddy) — at sofa scale it is what bouclé upholstery looks like
  { id: 'boucle', title: 'curly looped wool (bouclé)', src: ph('polyhaven-textures-textiles-and-leather', 'curly_teddy_natural'), mode: 'detail', tile: [0.22, 0.22], flatten: { k: 1, cells: 8 }, contrast: 1.0, ao: 0.5, sizes: [1024, 512] },
  { id: 'velvet', title: 'velour velvet', src: ph('polyhaven-textures-textiles-and-leather-2', 'velour_velvet'), mode: 'detail', tile: [0.5, 0.5], flatten: { k: 0.6, cells: 6 }, contrast: 1.0, ao: 0.3, sizes: [1024, 512] },
  { id: 'percale', title: 'cotton poplin / percale', src: ph('polyhaven-textures-textiles-and-leather-2', 'stretch_poplin'), mode: 'detail', tile: [0.12, 0.12], flatten: { k: 1, cells: 8 }, contrast: 1.0, ao: 0.4, sizes: [1024, 512] },
  { id: 'leather', title: 'smooth leather', src: acg('ambientcg-materials-leather', 'Leather023'), mode: 'detail', tile: [0.6, 0.6], flatten: { k: 0.7, cells: 6 }, contrast: 0.5, ao: 0.4, sizes: [1024, 512] },
  // rugs
  { id: 'rug-pile', title: 'wool pile carpet', src: acg('ambientcg-materials-carpet', 'Carpet016'), mode: 'detail', tile: [0.6, 0.6], flatten: { k: 1, cells: 8 }, contrast: 1.1, ao: 0.6, sizes: [1024, 512] },
  { id: 'rug-flat', title: 'flat-weave (basket) carpet', src: acg('ambientcg-materials-carpet', 'Carpet014'), mode: 'detail', tile: [0.5, 0.5], flatten: { k: 1, cells: 8 }, contrast: 1.0, ao: 0.6, sizes: [1024, 512] },
  { id: 'jute', title: 'coarse woven carpet (jute / sisal)', src: acg('ambientcg-materials-carpet', 'Carpet015'), mode: 'detail', tile: [0.5, 0.5], flatten: { k: 1, cells: 8 }, contrast: 1.0, ao: 0.6, sizes: [1024, 512] },
  // stone
  { id: 'travertine', title: 'travertine (vein cut)', src: acg('ambientcg-materials-more-8', 'Travertine009'), mode: 'color', tile: [1.2, 1.2], flatten: { k: 0.3, cells: 4 }, ao: 0.2, sizes: [1024, 512] },
  { id: 'marble', title: 'white marble', src: acg('ambientcg-materials-marble', 'Marble001'), mode: 'color', tile: [1.4, 1.4], flatten: { k: 0.3, cells: 4 }, ao: 0, sizes: [1024, 512] },
  // walls
  // painted walls: a quiet tonal unevenness only (± 2 %)
  { id: 'plaster', title: 'painted plaster', src: ph('polyhaven-textures-concrete-2', 'painted_plaster_wall'), mode: 'detail', detailMean: 0.92, tile: [2.4, 2.4], flatten: { k: 0.25, cells: 4 }, contrast: 0.3, ao: 0.4, sizes: [1024, 512] },
  // limewash (R3-08): the same plaster with its 0.3–1.2 m brushed clouds kept and lifted (± 6–8 %), trowel relief
  { id: 'limewash', title: 'limewash plaster', src: ph('polyhaven-textures-concrete-2', 'painted_plaster_wall'), mode: 'detail', detailMean: 0.85, tile: [2.0, 2.0], flatten: { k: 1, cells: 2 }, contrast: 1.0, ao: 0.5, sizes: [1024, 512] },
  // rattan / wicker
  { id: 'wicker', title: 'woven rattan', src: acg('ambientcg-materials-wicker', 'Wicker010A'), mode: 'color', tile: [0.35, 0.35], flatten: { k: 0.6, cells: 6 }, ao: 0.6, alpha: true, sizes: [1024, 512] },
  // plants: olive bark, lanceolate leaf atlas (2 clean leaves of the set, grey detail + alpha)
  { id: 'bark', title: 'fissured grey bark (olive trunk)', src: acg('ambientcg-materials-bark', 'Bark001'), mode: 'color', tile: [0.5, 0.5], flatten: { k: 0.5, cells: 4 }, ao: 0.5, sizes: [1024, 512] },
  { id: 'leaf', title: 'lanceolate leaf atlas (olive / eucalyptus leaves)', src: acg('ambientcg-atlases', 'LeafSet013'), mode: 'detail', atlas: { pick: [3, 4], cellW: 256, cellH: 1024 }, contrast: 0.8, ao: 0, noRough: true, sizes: [512, 256] },
];

// ---------------------------------------------------------------- helpers
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const toSRGB = (x) => { x = x <= 0 ? 0 : x >= 1 ? 1 : x; return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const rng = (seed) => { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

function mapFiles(s) {
  const { kind, repo, asset } = s.src, d = join(SRC, repo, asset);
  if (kind === 'ph') {
    const f = (m) => `${asset}/2k/${asset}_${m}_2k.jpg`;
    return { dir: join(SRC, repo), albedo: f('diff'), normal: f('nor_gl'), rough: f('rough'), ao: f('ao'), alpha: null, d };
  }
  const f = (m) => `${asset}/2K-JPG/${asset}_2K-JPG_${m}.jpg`;
  return { dir: join(SRC, repo), albedo: f('Color'), normal: f('NormalGL'), rough: f('Roughness'), ao: f('AmbientOcclusion'), alpha: f('Opacity'), d };
}

async function load(file, channels) {
  const img = sharp(file).removeAlpha();
  const pipe = channels === 1 ? img.toColourspace('b-w') : img.toColourspace('srgb');
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== channels) throw new Error(`${file}: ${info.channels} channels, expected ${channels}`);
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height, c: channels };
}

/** Image as Float32 planes. */
const planes = (im) => { const n = im.w * im.h, P = []; for (let k = 0; k < im.c; k++) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = im.data[i * im.c + k]; P.push(a); } return { P, w: im.w, h: im.h }; };

function crop(img, x0, y0, w, h) {
  const P = img.P.map((a) => { const o = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = a[(y0 + y) * img.w + x0 + x] ?? 0; return o; });
  return { P, w, h };
}
/** Bilinear resample of planes to (w, h) (atlas cells only; tiles use box halving). */
function resample(img, w, h) {
  const P = img.P.map((a) => {
    const o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(img.h - 1.001, Math.max(0, ((y + 0.5) / h) * img.h - 0.5)), y0 = sy | 0, fy = sy - y0;
      for (let x = 0; x < w; x++) {
        const sx = Math.min(img.w - 1.001, Math.max(0, ((x + 0.5) / w) * img.w - 0.5)), x0 = sx | 0, fx = sx - x0;
        const i = y0 * img.w + x0;
        o[y * w + x] = (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + img.w] * (1 - fx) + a[i + img.w + 1] * fx) * fy;
      }
    }
    return o;
  });
  return { P, w, h };
}
/** Rotate 90° clockwise. Normal maps: the vector turns with the image (R' = G, G' = −R). */
function rot90(img, isNormal = false) {
  const { w, h } = img, W = h, H = w;
  const P = img.P.map((a) => { const o = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[y * W + x] = a[(h - 1 - x) * w + y]; return o; });
  if (isNormal) { const R = P[0], G = P[1]; for (let i = 0; i < R.length; i++) { const r = R[i], g = G[i]; R[i] = g; G[i] = 255 - r; } }
  return { P, w: W, h: H };
}
/** 2× box reduction (exactly periodic). */
function half(img) {
  const w = img.w >> 1, h = img.h >> 1;
  const P = img.P.map((a) => { const o = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 2 * y * img.w + 2 * x; o[y * w + x] = (a[i] + a[i + 1] + a[i + img.w] + a[i + img.w + 1]) * 0.25; } return o; });
  return { P, w, h };
}
/** Periodic low-pass field of a plane: cell-average on a g × g grid, 3 periodic box blurs, bilinear periodic upsample. */
function lowpass(a, w, h, g) {
  const gw = g, gh = Math.max(1, Math.round(g * h / w)), C = new Float64Array(gw * gh), N = new Float64Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = ((y * gh / h) | 0) * gw + ((x * gw / w) | 0); C[j] += a[y * w + x]; N[j]++; }
  let F = Float64Array.from(C, (v, i) => v / N[i]);
  for (let pass = 0; pass < 3; pass++) {
    const T = new Float64Array(F.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let s = 0; for (let d = -1; d <= 1; d++) s += F[y * gw + ((x + d + gw) % gw)]; T[y * gw + x] = s / 3; }
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let s = 0; for (let d = -1; d <= 1; d++) s += T[((y + d + gh) % gh) * gw + x]; F[y * gw + x] = s / 3; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / h * gh - 0.5, y0 = Math.floor(fy), ty = fy - y0, ya = ((y0 % gh) + gh) % gh, yb = (ya + 1) % gh;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w * gw - 0.5, x0 = Math.floor(fx), tx = fx - x0, xa = ((x0 % gw) + gw) % gw, xb = (xa + 1) % gw;
      out[y * w + x] = (F[ya * gw + xa] * (1 - tx) + F[ya * gw + xb] * tx) * (1 - ty) + (F[yb * gw + xa] * (1 - tx) + F[yb * gw + xb] * tx) * ty;
    }
  }
  return out;
}

/**
 * Engineered-floor joints on a plank scan: finds the long seams (rows), gives each row two boards per tile (the
 * second sampled from another row at another offset → a real grain break at both end joints, staggered), and
 * presses a 1 mm V micro-bevel into every seam (normal + slight darkening + rougher groove).
 */
function plankify(alb, nor, rou, w, h, { rows, seed }) {
  const r = rng(seed);
  // seam rows: strongest change of the row-mean albedo near k·h/rows
  const L = new Float32Array(h);
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { const i = y * w + x; s += alb.P[0][i] + alb.P[1][i] + alb.P[2][i]; } L[y] = s / w; }
  const seams = [];
  for (let k = 0; k < rows; k++) {
    const c = Math.round((k * h) / rows); let best = c, bv = -1;
    for (let d = -Math.round(h / rows / 4); d <= Math.round(h / rows / 4); d++) {
      const y = ((c + d) % h + h) % h, a = L[(y - 2 + h) % h] + L[(y - 1 + h) % h], b = L[(y + 1) % h] + L[(y + 2) % h];
      const v = Math.abs(a - b); if (v > bv) { bv = v; best = y; }
    }
    seams.push(best);
  }
  seams.sort((a, b) => a - b);
  const rowOf = new Int32Array(h), rel = new Float32Array(h);
  for (let k = 0; k < rows; k++) {
    const y0 = seams[k], y1 = k + 1 < rows ? seams[k + 1] : seams[0] + h;
    for (let y = y0; y < y1; y++) { rowOf[y % h] = k; rel[y % h] = (y - y0) / (y1 - y0); }
  }
  // two boards per row per tile; joints at least 22 % of the tile away from the neighbours' joints
  const J = [];
  for (let k = 0; k < rows; k++) {
    let a, tries = 0;
    do { a = r(); tries++; } while (tries < 50 && k > 0 && Math.min(...J[k - 1].map((j) => Math.min(Math.abs(j - a), 1 - Math.abs(j - a)))) < 0.22);
    const len = 0.42 + r() * 0.16;
    J.push([a, (a + len) % 1]);
  }
  const src = (k) => { let j; do { j = (r() * rows) | 0; } while (j === k); return j; };
  const B = J.map((_, k) => ({ row: src(k), off: r() }));
  const out = (img) => ({ P: img.P.map((a) => new Float32Array(a.length)), w, h });
  const A2 = out(alb), N2 = out(nor), R2 = out(rou);
  const pos = (k, t) => { const y0 = seams[k], y1 = k + 1 < rows ? seams[k + 1] : seams[0] + h; return (Math.round(y0 + t * (y1 - y0)) % h + h) % h; };
  const inB = (k, u) => { const [a, b] = J[k]; return a < b ? u >= a && u < b : u >= a || u < b; };
  for (let y = 0; y < h; y++) {
    const k = rowOf[y];
    for (let x = 0; x < w; x++) {
      const u = x / w; let sx = x, sy = y;
      if (inB(k, u)) { const b = B[k]; sx = Math.floor(((u + b.off) % 1) * w); sy = pos(b.row, rel[y]); }
      const i = y * w + x, j = sy * w + sx;
      for (let c = 0; c < 3; c++) { A2.P[c][i] = alb.P[c][j]; N2.P[c][i] = nor.P[c][j]; }
      R2.P[0][i] = rou.P[0][j];
    }
  }
  // micro-bevels: 2 px (≈ 2.4 mm) slope each side of every seam, 1 px dark groove
  const bevel = 2;
  const press = (i, nx, ny, depth) => {
    // tilt the normal toward the groove (OpenGL: +R = +x, +G = up = −y)
    N2.P[0][i] = Math.max(0, Math.min(255, N2.P[0][i] + nx * 70));
    N2.P[1][i] = Math.max(0, Math.min(255, N2.P[1][i] + ny * 70));
    for (let c = 0; c < 3; c++) A2.P[c][i] *= 1 - 0.22 * depth;
    R2.P[0][i] = Math.min(255, R2.P[0][i] + 40 * depth);
  };
  for (let k = 0; k < rows; k++) {
    const ys = seams[k];
    for (let x = 0; x < w; x++) for (let d = -bevel; d < bevel; d++) {
      const y = (ys + d + h) % h, t = d < 0 ? (d + bevel + 1) / (bevel + 1) : (bevel - d) / (bevel + 1);
      press(y * w + x, 0, d < 0 ? -t : t, d === -1 || d === 0 ? 1 : 0.35);
    }
    for (const ju of J[k]) {
      const xs = Math.round(ju * w);
      for (let y = 0; y < h; y++) {
        if (rowOf[y] !== k) continue;
        for (let d = -bevel; d < bevel; d++) {
          const x = (xs + d + w) % w, t = d < 0 ? (d + bevel + 1) / (bevel + 1) : (bevel - d) / (bevel + 1);
          press(y * w + x, d < 0 ? t : -t, 0, d === -1 || d === 0 ? 1 : 0.35);
        }
      }
    }
  }
  return { alb: A2, nor: N2, rou: R2, seams, joints: J };
}

async function writeJpeg(file, img, { quality = 84, grey = false, chroma = '4:2:0' } = {}) {
  const { w, h } = img, c = grey ? 1 : 3, buf = Buffer.alloc(w * h * c);
  // stored vertically flipped: first row = v 0 (see header)
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) for (let k = 0; k < c; k++) buf[(y * w + x) * c + k] = Math.max(0, Math.min(255, Math.round(img.P[k][sy * w + x])));
  }
  await mkdir(dirname(file), { recursive: true });
  let p = sharp(buf, { raw: { width: w, height: h, channels: c } });
  if (grey) p = p.toColourspace('b-w');
  await p.jpeg({ quality, mozjpeg: true, chromaSubsampling: grey ? '4:2:0' : chroma }).toFile(file);
  return (await stat(file)).size;
}

function manifestOf(dir) {
  try {
    const t = execFileSync('git', ['-C', dir, 'show', 'HEAD:MANIFEST.tsv'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const m = new Map();
    for (const line of t.split('\n').slice(1)) { const c = line.split('\t'); if (c[0]) m.set(c[0], { bytes: +c[1], sha256: c[2], source: c[4] }); }
    return m;
  } catch { return new Map(); }
}
function authorOf(dir, asset) {
  try {
    const t = execFileSync('git', ['-C', dir, 'show', 'HEAD:README.md'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const re = new RegExp(`<a href="${asset}">([^<]+)</a></b><br><sub>by ([^·<]+?) · <a href="([^"]+)">source</a>`);
    const m = t.match(re); return m ? { name: m[1].trim(), author: m[2].trim(), page: m[3] } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- build one set
async function buildSet(s) {
  const f = mapFiles(s);
  const p = (rel) => join(f.dir, rel);
  const has = (rel) => rel && existsSync(p(rel));
  if (!has(f.albedo) || !has(f.normal)) throw new Error(`${s.id}: missing source maps in ${f.dir}`);
  let alb = planes(await load(p(f.albedo), 3));
  let nor = planes(await load(p(f.normal), 3));
  let rou = has(f.rough) ? planes(await load(p(f.rough), 1)) : { P: [new Float32Array(alb.w * alb.h).fill(160)], w: alb.w, h: alb.h };
  let ao = has(f.ao) ? planes(await load(p(f.ao), 1)) : null;
  let alpha = (s.atlas || s.alpha) && has(f.alpha) ? planes(await load(p(f.alpha), 1)) : null;
  const used = [f.albedo, f.normal, has(f.rough) && f.rough, ao && f.ao, alpha && f.alpha].filter(Boolean);

  // atlas: crop the picked items (columns separated by transparent background), one per cell
  if (s.atlas) {
    const { w, h } = alpha;
    const colHas = new Uint8Array(w);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (alpha.P[0][y * w + x] > 128) { colHas[x] = 1; break; }
    const spans = []; let x0 = -1;
    for (let x = 0; x <= w; x++) { const on = x < w && colHas[x]; if (on && x0 < 0) x0 = x; if (!on && x0 >= 0) { if (x - x0 > 20) spans.push([x0, x]); x0 = -1; } }
    const cells = [];
    for (const idx of s.atlas.pick) {
      const [a, b] = spans[idx]; let y0 = h, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = a; x < b; x++) if (alpha.P[0][y * w + x] > 128) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const m = 6, cx = Math.max(0, a - m), cy = Math.max(0, y0 - m), cw = Math.min(w, b + m) - cx, chh = Math.min(h, y1 + m + 1) - cy;
      cells.push([cx, cy, cw, chh]);
    }
    const CW = s.atlas.cellW, CH = s.atlas.cellH, W = CW * cells.length;
    const pack = (img) => {
      const P = img.P.map(() => new Float32Array(W * CH));
      cells.forEach(([cx, cy, cw, chh], n) => {
        const c = resample(crop(img, cx, cy, cw, chh), CW, CH);
        c.P.forEach((a, k) => { for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) P[k][y * W + n * CW + x] = a[y * CW + x]; });
      });
      return { P, w: W, h: CH };
    };
    alb = pack(alb); nor = pack(nor); rou = pack(rou); alpha = pack(alpha); ao = null;
  }
  if (s.rotate) for (let k = 0; k < s.rotate / 90; k++) { alb = rot90(alb); nor = rot90(nor, true); rou = rot90(rou); if (ao) ao = rot90(ao); if (alpha) alpha = rot90(alpha); }
  const { w, h } = alb, n = w * h;
  // linear albedo
  const A = [0, 1, 2].map((k) => Float32Array.from(alb.P[k], (v) => LIN[Math.round(v)]));
  if (s.albedoFrom === 'ao' && ao) { const a = Float32Array.from(ao.P[0], (v) => LIN[Math.round(v)]); A[0] = a; A[1] = a.slice(); A[2] = a.slice(); }
  if (ao && s.ao) for (let i = 0; i < n; i++) { const k = 1 - s.ao + s.ao * (ao.P[0][i] / 255); A[0][i] *= k; A[1][i] *= k; A[2][i] *= k; }
  const lum = (i) => A[0][i] * 0.2126 + A[1][i] * 0.7152 + A[2][i] * 0.0722;
  const opaque = (i) => !alpha || alpha.P[0][i] > 128;
  // flatten low-frequency luminance drift (keeps the figure, removes the "lit from one side" scan cast)
  if (s.flatten && s.flatten.k > 0) {
    const Lp = new Float32Array(n); for (let i = 0; i < n; i++) Lp[i] = lum(i);
    const B = lowpass(Lp, w, h, s.flatten.cells);
    let mb = 0; for (let i = 0; i < n; i++) mb += B[i]; mb /= n;
    for (let i = 0; i < n; i++) { const k = Math.pow(mb / Math.max(1e-4, B[i]), s.flatten.k); A[0][i] *= k; A[1][i] *= k; A[2][i] *= k; }
  }
  // colour sets: log contrast around the mean luminance (figure strength), hue kept
  if (s.mode === 'color' && s.contrast && s.contrast !== 1) {
    let mL = 0; for (let i = 0; i < n; i++) mL += lum(i); mL /= n;
    for (let i = 0; i < n; i++) { const L = Math.max(1e-5, lum(i)), k = Math.pow(L / mL, s.contrast - 1); A[0][i] *= k; A[1][i] *= k; A[2][i] *= k; }
  }
  let meanRGB = [0, 0, 0], cnt = 0;
  for (let i = 0; i < n; i++) if (opaque(i)) { meanRGB[0] += A[0][i]; meanRGB[1] += A[1][i]; meanRGB[2] += A[2][i]; cnt++; }
  meanRGB = meanRGB.map((v) => v / cnt);
  let outAlb, mean;
  if (s.mode === 'detail') {
    // grey detail, linear mean 0.5: catalogue colour × (L / mean)
    let mL = 0; for (let i = 0; i < n; i++) if (opaque(i)) mL += lum(i); mL /= cnt;
    const g = new Float32Array(n), c = s.contrast ?? 1, dm = s.detailMean ?? 0.5;
    let clip = 0, mo = 0;
    for (let i = 0; i < n; i++) {
      const v = opaque(i) ? dm * (1 + (lum(i) / mL - 1) * c) : dm;
      if (v > 1) clip++;
      g[i] = toSRGB(v) * 255; mo += Math.min(1, v);
    }
    if (clip > n * 0.002) console.warn(`  ${s.id}: ${(100 * clip / n).toFixed(2)} % of the detail texels clip at 1`);
    outAlb = { P: [g], w, h, grey: true };
    mean = mo / n; meanRGB = [mean, mean, mean];
  } else {
    outAlb = { P: A.map((a) => Float32Array.from(a, (v) => toSRGB(v) * 255)), w, h };
    mean = meanRGB[0] * 0.2126 + meanRGB[1] * 0.7152 + meanRGB[2] * 0.0722;
  }
  // transparent texels: flat normal, mean roughness (no halos in the mips)
  if (alpha) for (let i = 0; i < n; i++) if (!opaque(i)) { nor.P[0][i] = 128; nor.P[1][i] = 128; nor.P[2][i] = 255; }
  let planksInfo = null;
  if (s.planks) {
    const q = plankify(outAlb, nor, rou, w, h, s.planks);
    outAlb = q.alb; nor = q.nor; rou = q.rou; planksInfo = { seams: q.seams.length, joints: q.joints.length * 2 };
  }
  let roughMean = 0; for (let i = 0; i < n; i++) roughMean += rou.P[0][i]; roughMean /= n * 255;

  // sizes: halve down from the source
  const files = {}, bytes = {};
  let cur = { alb: outAlb, nor, rou, alpha };
  const want = [...s.sizes].sort((a, b) => b - a);
  const top = want[0];
  // the source is 2K (cells for atlases): reduce to the largest size wanted first
  const longest = (im) => Math.max(im.w, im.h);
  while (longest(cur.alb) > top) cur = { alb: { ...half(cur.alb), grey: cur.alb.grey }, nor: half(cur.nor), rou: half(cur.rou), alpha: cur.alpha && half(cur.alpha) };
  for (const size of want) {
    while (longest(cur.alb) > size) cur = { alb: { ...half(cur.alb), grey: cur.alb.grey }, nor: half(cur.nor), rou: half(cur.rou), alpha: cur.alpha && half(cur.alpha) };
    const tag = size >= 1024 ? `${size / 1024}k` : String(size);
    const rel = (m) => `${s.id}/${m}_${tag}.jpg`;
    const fl = { albedo: rel('albedo'), normal: rel('normal'), ...(s.noRough ? {} : { rough: rel('rough') }) };
    let b = 0;
    b += await writeJpeg(join(OUT, fl.albedo), cur.alb, { quality: 84, grey: !!cur.alb.grey });
    b += await writeJpeg(join(OUT, fl.normal), cur.nor, { quality: 88, chroma: '4:4:4' });
    if (fl.rough) b += await writeJpeg(join(OUT, fl.rough), cur.rou, { quality: 85, grey: true });
    if (cur.alpha) { fl.alpha = rel('alpha'); b += await writeJpeg(join(OUT, fl.alpha), cur.alpha, { quality: 90, grey: true }); }
    files[size] = fl; bytes[size] = b;
  }
  const man = manifestOf(f.dir), who = authorOf(f.dir, s.src.asset);
  const sources = used.map((rel) => ({ path: rel, mirror: `https://github.com/zuujis-cc0/${s.src.repo}/blob/HEAD/${rel}`, source: (man.get(rel) || {}).source || null, sha256: (man.get(rel) || {}).sha256 || null }));
  return {
    id: s.id, entry: { title: s.title, mode: s.mode, tile: s.tile || [1, 1], sizes: want.slice().sort((a, b) => a - b), files, bytes, mean: +mean.toFixed(4), meanRGB: meanRGB.map((v) => +v.toFixed(4)), roughMean: +roughMean.toFixed(3), alpha: !!alpha, ...(s.atlas ? { cells: s.atlas.pick.length } : {}), ...(planksInfo ? { planks: planksInfo } : {}) },
    licence: { id: s.id, title: s.title, asset: s.src.asset, repo: s.src.repo, kind: s.src.kind, who, sources, files },
  };
}

// ---------------------------------------------------------------- main
const indexFile = join(OUT, 'index.json');
const prev = existsSync(indexFile) ? JSON.parse(await readFile(indexFile, 'utf8')) : { sets: {} };
const licFile = join(ROOT, 'tools', 'materials-licences.json'); // provenance cache (not served)
const prevLic = existsSync(licFile) ? JSON.parse(await readFile(licFile, 'utf8')) : {};
const sets = { ...(prev.sets || {}) }, lic = { ...prevLic };
for (const s of SETS) {
  if (ONLY && !ONLY.includes(s.id)) continue;
  const t0 = Date.now();
  const r = await buildSet(s);
  sets[r.id] = r.entry; lic[r.id] = r.licence;
  console.log(`${r.id.padEnd(11)} ${Object.entries(r.entry.bytes).map(([k, v]) => `${k}:${(v / 1024) | 0}K`).join(' ')}  mean ${r.entry.mean} rough ${r.entry.roughMean}  ${Date.now() - t0} ms`);
}
// keep only configured sets, in config order
const ordered = {}; for (const s of SETS) if (sets[s.id]) ordered[s.id] = sets[s.id];
await mkdir(OUT, { recursive: true });
await writeFile(indexFile, JSON.stringify({ version: 1, note: 'generated by tools/materials-prep.mjs — files are stored vertically flipped (row 0 = v 0); detail albedo has linear mean 0.5', sets: ordered }, null, 1) + '\n');
await writeFile(licFile, JSON.stringify(lic, null, 1) + '\n');

// LICENSES.md
const L = [];
L.push('# Photoscanned materials — sources and licences', '');
L.push('Every file in this folder is derived from a **CC0 1.0 Universal (public domain dedication)** asset by');
L.push('[Poly Haven](https://polyhaven.com/license) or [ambientCG](https://docs.ambientcg.com/license/), taken from the');
L.push('[zuujis-cc0](https://github.com/zuujis-cc0) GitHub mirrors and processed by `tools/materials-prep.mjs` (rotated,');
L.push('flattened, AO baked into the albedo, fabrics reduced to grey detail, box-downsampled, stored vertically flipped).');
L.push('No attribution is required by CC0; it is given here anyway. Licence text: https://creativecommons.org/publicdomain/zero/1.0/', '');
L.push('| Files | Asset (author) | Original source page | Licence |', '| --- | --- | --- | --- |');
for (const s of SETS) {
  const l = lic[s.id]; if (!l) continue;
  const page = l.who?.page || (l.kind === 'ph' ? `https://polyhaven.com/a/${l.asset}` : `https://ambientcg.com/a/${l.asset}`);
  const outs = Object.values(l.files).flatMap((f) => Object.values(f)).map((x) => '`' + x + '`').join(' ');
  L.push(`| ${outs} | ${l.who?.name || l.asset} (${l.who?.author || (l.kind === 'ph' ? 'Poly Haven' : 'ambientCG')}) | ${page} | CC0 1.0 |`);
}
L.push('', '## Original files used (download URL, GitHub mirror path, SHA-256)', '');
for (const s of SETS) {
  const l = lic[s.id]; if (!l) continue;
  L.push(`### ${s.id} — ${l.who?.name || l.asset}`, '');
  for (const src of l.sources) L.push(`- ${src.source || '(source URL not listed)'} — mirror: ${src.mirror}${src.sha256 ? ` — sha256 \`${src.sha256.slice(0, 16)}…\`` : ''}`);
  L.push('');
}
await writeFile(join(OUT, 'LICENSES.md'), L.join('\n'));
const tot = {}; for (const e of Object.values(ordered)) for (const [k, v] of Object.entries(e.bytes)) tot[k] = (tot[k] || 0) + v;
console.log('total bytes per size:', Object.entries(tot).map(([k, v]) => `${k}: ${(v / 1048576).toFixed(2)} MB`).join(', '));
