// Live → Photo: structural check — does the developed photo still line up with the 3D frame? Owner: photo.
//
// Both images are reduced to ~256 px wide, turned into luminance, lightly blurred and run through Sobel. The
// strongest 15 % of gradients of each image are its "edges" (silhouettes, window frame, furniture outlines —
// textures and grain mostly fall below). Then:
//   • F1 at zero offset: edges of A that have an edge of B within 1 px, and the reverse (precision/recall);
//   • the same F1 for every offset up to ±10 px (≈ 4 % of the width): if a shifted overlay matches clearly better, the photo drifted;
//   • per-tile recall on a 4 × 3 grid: an object the model removed or moved leaves a tile without its edges.
// ok = F1(0) ≥ minF1  &&  best − F1(0) < shiftMargin  &&  worst tile recall ≥ minTile.
// Thresholds are first guesses until real model outputs are measured (docs/PHOTOREAL.md); `?photoGuard=0.4`
// overrides minF1 for calibration.
export const GUARD = { width: 256, keep: 0.15, minF1: 0.42, shiftMargin: 0.05, minTile: 0.22, maxShift: 10 };

/** Edge map of a region of a drawable (canvas / image / bitmap). */
export function edgeMap(src, sx, sy, sw, sh, width = GUARD.width, height = 0) {
  // height: force the map's height (a photo a few pixels off the frame's aspect is compared at the frame's shape)
  const w = width, h = height > 0 ? height : Math.max(8, Math.round((width * sh) / sw));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
  // 3 × 3 box blur (grain and JPEG noise out)
  const B = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let j = -1; j <= 1; j++) { const yy = y + j; if (yy < 0 || yy >= h) continue; for (let i = -1; i <= 1; i++) { const xx = x + i; if (xx < 0 || xx >= w) continue; s += L[yy * w + xx]; n++; } }
    B[y * w + x] = s / n;
  }
  const M = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const a = (dy, dx) => B[(y + dy) * w + x + dx];
    const gx = -a(-1, -1) - 2 * a(0, -1) - a(1, -1) + a(-1, 1) + 2 * a(0, 1) + a(1, 1);
    const gy = -a(-1, -1) - 2 * a(-1, 0) - a(-1, 1) + a(1, -1) + 2 * a(1, 0) + a(1, 1);
    M[y * w + x] = Math.hypot(gx, gy);
  }
  // adaptive threshold: the top `keep` share of gradients, never below a small absolute floor
  const sorted = Float32Array.from(M).sort();
  const t = Math.max(sorted[Math.floor(sorted.length * (1 - GUARD.keep))] || 0, 12);
  const E = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) if (M[i] > t) { E[i] = 1; n++; }
  return { w, h, E, n };
}

function dilate({ w, h, E }) {
  const D = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!E[y * w + x]) continue;
    for (let j = -1; j <= 1; j++) { const yy = y + j; if (yy < 0 || yy >= h) continue; for (let i = -1; i <= 1; i++) { const xx = x + i; if (xx >= 0 && xx < w) D[yy * w + xx] = 1; } }
  }
  return D;
}

/** Share of A's edges (inside the margin) that land on B's dilated edges when B is offset by (dx, dy). */
function hitRate(A, DB, w, h, dx, dy, m, x0 = 0, y0 = 0, x1 = w, y1 = h) {
  let hit = 0, tot = 0;
  for (let y = Math.max(m, y0); y < Math.min(h - m, y1); y++) for (let x = Math.max(m, x0); x < Math.min(w - m, x1); x++) {
    if (!A[y * w + x]) continue;
    tot++;
    if (DB[(y + dy) * w + x + dx]) hit++;
  }
  return { hit, tot };
}

/** Compare two edge maps of the same size. */
export function compare(a, b, opts = {}) {
  const g = { ...GUARD, ...opts };
  if (a.w !== b.w || a.h !== b.h) return { ok: false, f1: 0, reason: 'size' };
  if (a.n < 40 || b.n < 40) return { ok: false, f1: 0, reason: 'flat' };
  const { w, h } = a;
  const DA = dilate(a), DB = dilate(b);
  const m = g.maxShift;
  const f1At = (dx, dy) => {
    const p = hitRate(a.E, DB, w, h, dx, dy, m), r = hitRate(b.E, DA, w, h, -dx, -dy, m);
    const P = p.tot ? p.hit / p.tot : 0, R = r.tot ? r.hit / r.tot : 0;
    return P + R ? (2 * P * R) / (P + R) : 0;
  };
  const f0 = f1At(0, 0);
  let best = f0, bx = 0, by = 0;
  for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) {
    if (!dx && !dy) continue;
    const f = f1At(dx, dy);
    if (f > best) { best = f; bx = dx; by = dy; }
  }
  // per-tile recall of the frame's edges in the photo (an object removed or moved empties its tile)
  let tileMin = 1;
  const TX = 4, TY = 3;
  for (let ty = 0; ty < TY; ty++) for (let tx = 0; tx < TX; tx++) {
    const x0 = Math.floor((tx * w) / TX), x1 = Math.floor(((tx + 1) * w) / TX), y0 = Math.floor((ty * h) / TY), y1 = Math.floor(((ty + 1) * h) / TY);
    const r = hitRate(a.E, DB, w, h, 0, 0, m, x0, y0, x1, y1);
    if (r.tot >= 30) tileMin = Math.min(tileMin, r.hit / r.tot);
  }
  const shifted = (bx || by) && best - f0 >= g.shiftMargin;
  const ok = f0 >= g.minF1 && !shifted && tileMin >= g.minTile;
  return {
    ok, f1: +f0.toFixed(3), best: +best.toFixed(3), shift: [bx, by], tileMin: +tileMin.toFixed(3),
    reason: ok ? null : f0 < g.minF1 ? 'low-f1' : shifted ? 'shifted' : 'tile',
  };
}

/**
 * Per-item check (docs/ART.md §2): for each of the top 5 items (by area) with a bbox from the engine's ID pass, the
 * frame's edges inside the bbox must line up with the photo's without a shift larger than 4 % of the bbox, and their
 * recall must stay ≥ minTile. A moved or resized item shows as a best offset > 4 % or a recall collapse.
 * items: [{ id, area, bbox: [x, y, w, h] normalised }]. Returns { ok, worst: { id, shift, recall } }.
 */
export function compareItems(a, b, items, { maxMove = 0.04, minRecall = GUARD.minTile } = {}) {
  const { w, h } = a;
  const DB = dilate(b);
  const top = items.filter((x) => Array.isArray(x.bbox)).sort((p, q) => q.area - p.area).slice(0, 5);
  let worst = null;
  for (const it of top) {
    const [bx, by, bw, bh] = it.bbox;
    const x0 = Math.floor(bx * w), y0 = Math.floor(by * h), x1 = Math.ceil((bx + bw) * w), y1 = Math.ceil((by + bh) * h);
    const lim = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0) * 0.12)); // search wider than the tolerance
    const tol = Math.max(1, Math.max(x1 - x0, y1 - y0) * maxMove);
    const at = (dx, dy) => { const r = hitRate(a.E, DB, w, h, dx, dy, lim, x0, y0, x1, y1); return r.tot ? r.hit / r.tot : 1; };
    const r0 = at(0, 0);
    let best = r0, sx = 0, sy = 0;
    for (let dy = -lim; dy <= lim; dy++) for (let dx = -lim; dx <= lim; dx++) { const r = at(dx, dy); if (r > best + 0.03) { best = r; sx = dx; sy = dy; } }
    const shift = Math.hypot(sx, sy);
    const bad = shift > tol || r0 < minRecall;
    if (bad && (!worst || r0 < worst.recall)) worst = { id: it.id, shift: +(shift / Math.max(x1 - x0, y1 - y0)).toFixed(3), recall: +r0.toFixed(3) };
  }
  return { ok: !worst, worst, checked: top.length };
}
