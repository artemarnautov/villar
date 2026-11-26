// Villar furniture — bed frame, mattress, bedding (duvet drape, pillows, throw). Owner: modeler.
import * as THREE from '../../../vendor/three/three.module.js';
import { Builder, softBox, pillowGeometry, tube, roundedRectLoop, weldNormals, segs, V3, clamp, lerp, cm } from './geom.js';
import { fabricMat, addLegs, isMetal } from './parts.js';
import { rng } from '../textures.js';

const STD_W = [0.9, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0];
const STD_L = [1.9, 2.0, 2.1];
const pickStd = (list, max, fallback) => { let r = fallback; for (const v of list) if (v <= max + 1e-6) r = v; return r; };

/**
 * Japandi low platform bed: solid-wood deck that reveals 8–15 cm around the mattress, floating on a recessed
 * dark plinth, low headboard (oak panel, vertical slats, cane or upholstered) — style 'platform' | 'japandi'.
 */
function platformBed(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const woodKey = p.frame || p.wood || 'oak-light';
  const wood = c.mat(/fabric|uphol|bouc|linen/.test(String(woodKey)) ? 'oak-light' : woodKey);
  const mw = cm(p.mattressW, pickStd(STD_W, W - 0.16, W - 0.3));
  const md = cm(p.mattressD, pickStd(STD_L, D - 0.2, D - 0.3));
  const hbT = clamp(cm(p.headboardThickness, 0.05), 0.03, 0.12);
  const deckT = 0.045, plinthH = clamp(cm(p.legHeight, 0.12), 0.05, 0.2);
  const deckY = clamp(cm(p.deckHeight, plinthH + deckT), 0.12, 0.35);
  const inset = 0.1;
  // recessed plinth (shadow gap) + deck slab with eased edges
  b.add(softBox(W - 2 * inset, plinthH, D - 2 * inset - hbT, { r: 0.004, seg: 1 }), c.mat('ash-black', { tint: '#3a332c' }), { pos: [0, plinthH / 2, hbT / 2] });
  b.add(softBox(W, deckT, D - hbT + 0.005, { r: 0.012, seg: 3 }), wood, { pos: [0, deckY - deckT / 2, hbT / 2], axis: 'z' });
  // headboard
  const hbType = String(p.headboard || 'wood-panel').toLowerCase();
  const hbH = H - deckY + deckT;
  const zH = -D / 2 + hbT / 2;
  if (/slat/.test(hbType)) {
    b.add(softBox(W, 0.05, hbT, { r: 0.008, seg: 2 }), wood, { pos: [0, H - 0.025, zH] });
    const n = Math.round(W / 0.07);
    for (let i = 0; i < n; i++) b.add(softBox(0.045, hbH - 0.05, hbT * 0.6, { r: 0.006, seg: 2 }), wood, { pos: [-W / 2 + (i + 0.5) * W / n, deckY - deckT + (hbH - 0.05) / 2, zH], axis: 'y' });
  } else if (/cane|rattan/.test(hbType)) {
    const fw = 0.05;
    b.add(softBox(W, hbH, hbT, { r: 0.01, seg: 3 }), wood, { pos: [0, deckY - deckT + hbH / 2, zH - hbT * 0.1], axis: 'y' });
    b.add(new THREE.PlaneGeometry(W - 2 * fw, hbH - 2 * fw - 0.03), c.mat('cane', { color: p.caneColor }), { pos: [0, deckY - deckT + hbH / 2 + 0.015, zH + hbT / 2 + 0.002] });
  } else if (/uphol|bouc|linen|fabric/.test(hbType)) {
    const hbFab = fabricMat(c, p.fabric || 'linen', p.headboardColor || '#D9CDB8');
    b.add(softBox(W, hbH, hbT * 0.5, { r: 0.008, seg: 2 }), wood, { pos: [0, deckY - deckT + hbH / 2, zH - hbT * 0.25], axis: 'y' });
    b.add(softBox(W - 0.08, hbH - 0.14, 0.07, { r: 0.03, seg: 4, cell: 0.08, bulge: { front: 0.012 }, seed: c.seed }), hbFab, { pos: [0, deckY + (hbH - 0.14) / 2 + 0.03, zH + hbT / 2 + 0.03] });
  } else {
    // solid oak panel with a horizontal reveal line
    b.add(softBox(W, hbH, hbT, { r: 0.01, seg: 3 }), wood, { pos: [0, deckY - deckT + hbH / 2, zH], axis: 'x' });
    b.add(new THREE.BoxGeometry(W - 0.002, 0.006, 0.004), c.mat('ash-black', { tint: '#2b2622' }), { pos: [0, deckY + hbH * 0.45, zH + hbT / 2 + 0.0005], cast: false });
  }
  // integrated bedside shelves (optional)
  if (p.sideShelves) for (const s of [-1, 1]) b.add(softBox(0.42, deckT, 0.38, { r: 0.01, seg: 2 }), wood, { pos: [s * (W / 2 + 0.21), deckY - deckT / 2, -D / 2 + hbT + 0.2] });
  const zc = -D / 2 + hbT + (D - hbT) / 2;
  b.add(new THREE.BoxGeometry(mw, 0.004, md), c.mat('walnut-dark', { tint: '#6b5d52' }), { pos: [0, deckY + 0.002, zc], cast: false });
  return { group: b.build('bed'), anchors: { deck: V3(0, deckY + 0.004, zc), top: V3(0, deckY + 0.004, zc) }, anchorInfo: { deck: { w: mw, d: md } } };
}

export function bed(c) {
  if (/platform|japandi|low/.test(String(c.params.style || c.params.frameStyle || '')) || /platform/.test(String(c.params.legs || ''))) return platformBed(c);
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const woodKey = p.frame || p.wood || 'walnut-dark';
  const frameIsFabric = /fabric|bouc|linen|velvet|uphol/.test(String(woodKey));
  const wood = frameIsFabric ? fabricMat(c, /uphol/.test(woodKey) ? (p.fabric || 'linen') : woodKey, p.frameColor || p.headboardColor) : c.mat(woodKey);
  const hbType = String(p.headboard || 'upholstered-panel').toLowerCase();
  const hbFab = fabricMat(c, p.fabric || p.headboardFabric || 'boucle', p.headboardColor || '#E8E1D5');
  const legType = String(p.legs || 'wood-short').toLowerCase();
  const mw = cm(p.mattressW, pickStd(STD_W, W - 0.05, W - 0.1));
  const md = cm(p.mattressD, pickStd(STD_L, D - 0.08, D - 0.12));
  const hbT = clamp((D - md) * 0.62, 0.05, 0.14);
  const footT = clamp(D - md - hbT, 0.02, 0.08);
  const sideT = clamp((W - mw) / 2, 0.02, 0.12);
  const hidden = legType.includes('hidden');
  const legH = legType === 'none' || legType.includes('floor') ? 0 : hidden ? 0.035 : legType.includes('plinth') ? 0.07 : clamp(cm(p.legHeight, 0.1), 0.04, 0.25);
  let deckY = clamp(cm(p.deckHeight, legH + 0.2), 0.12, 0.5);
  let railTop = deckY + clamp(cm(p.railAbove, 0.06), 0, 0.15);
  if (p.railHeight) { railTop = clamp(cm(p.railHeight), legH + 0.12, 0.6); deckY = Math.min(deckY, railTop - 0.04); }
  const railH = railTop - legH;
  const zc = -D / 2 + hbT + md / 2;

  // side rails, foot rail (rounded panels), inner deck
  const rr = frameIsFabric ? 0.025 : 0.008;
  for (const s of [-1, 1]) b.add(softBox(sideT, railH, D - hbT + 0.01, { r: rr, seg: 3, cell: 0.1, bulge: frameIsFabric ? { left: 0.006, right: 0.006 } : null }), wood, { pos: [s * (W / 2 - sideT / 2), legH + railH / 2, -D / 2 + hbT + (D - hbT) / 2 - 0.005], axis: 'z' });
  b.add(softBox(W - 2 * sideT + 0.002, railH, footT, { r: rr, seg: 3 }), wood, { pos: [0, legH + railH / 2, D / 2 - footT / 2] });
  b.add(new THREE.BoxGeometry(mw, 0.02, md), c.mat('walnut-dark', { tint: '#6b5d52' }), { pos: [0, deckY - 0.01, zc] });

  // headboard
  const hbBottom = legH;
  const hbH = H - hbBottom;
  if (hbType.includes('wood') || hbType.includes('slat')) {
    b.add(softBox(W, hbH, hbT * 0.5, { r: 0.008, seg: 3 }), wood, { pos: [0, hbBottom + hbH / 2, -D / 2 + hbT * 0.25], axis: 'y' });
    if (hbType.includes('slat')) {
      const n = Math.round(W / 0.06);
      for (let i = 0; i < n; i++) b.add(softBox(0.035, hbH - 0.25, 0.02, { r: 0.004, seg: 1 }), wood, { pos: [-W / 2 + (i + 0.5) * W / n, railTop + (hbH - 0.25 - (railTop - hbBottom)) / 2 + 0.1, -D / 2 + hbT * 0.5 + 0.01], axis: 'y' });
    }
  } else if (hbType.includes('channel') || hbType.includes('rib')) {
    b.add(softBox(W, hbH, hbT * 0.4, { r: 0.006, seg: 2 }), wood, { pos: [0, hbBottom + hbH / 2, -D / 2 + hbT * 0.2], axis: 'y' });
    const n = Math.max(4, Math.round((W - 0.04) / 0.18));
    const cw = (W - 0.04) / n;
    const ch = H - railTop - 0.03;
    for (let i = 0; i < n; i++) b.add(softBox(cw + 0.004, ch, hbT * 0.6, { r: Math.min(0.04, cw / 2.3), seg: 4, cell: 0.08, bulge: { front: 0.02, top: 0.005 }, seed: c.seed + i }), hbFab, { pos: [-W / 2 + 0.02 + cw * (i + 0.5), railTop + ch / 2, -D / 2 + hbT * 0.4 + hbT * 0.3] });
  } else if (hbType.includes('tuft') || hbType.includes('button') || hbType.includes('capiton')) {
    // deep-buttoned upholstered panel: puffy cells + buttons on a diamond grid
    const backT = hbT * 0.35;
    b.add(softBox(W, hbH, backT, { r: 0.01, seg: 3 }), frameIsFabric ? wood : wood, { pos: [0, hbBottom + hbH / 2, -D / 2 + backT / 2], axis: 'y' });
    const pw = W - 0.03, ph = H - railTop - 0.02, pt = hbT - backT + 0.01;
    const z0 = -D / 2 + backT + pt / 2 - 0.004;
    const g = softBox(pw, ph, pt, { r: Math.min(0.05, pt / 2.1), seg: 4, cell: 0.03, bulge: { front: 0.02, top: 0.008 }, seed: c.seed });
    const nx = Math.max(4, Math.round(pw / 0.2)), ny = Math.max(2, Math.round(ph / 0.18));
    const btn = [];
    for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) if ((i + j) % 2 === 0) btn.push([-pw / 2 + (i / nx) * pw, -ph / 2 + (j / ny) * ph]);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      if (pa.getZ(i) < pt * 0.2) continue;
      const x = pa.getX(i), y = pa.getY(i);
      let dip = 0;
      for (const [bx, by] of btn) { const d2 = ((x - bx) ** 2 + (y - by) ** 2) / (0.06 * 0.06); dip = Math.max(dip, Math.exp(-d2)); }
      pa.setZ(i, pa.getZ(i) - dip * 0.028);
    }
    weldNormals(g);
    b.add(g, hbFab, { pos: [0, railTop + ph / 2 + 0.005, z0] });
    for (const [bx, by] of btn) { const sg = new THREE.SphereGeometry(0.009, 10, 6); sg.scale(1, 1, 0.5); b.add(sg, hbFab, { pos: [bx, railTop + ph / 2 + 0.005 + by, z0 + pt / 2 + 0.02 - 0.028] }); }
  } else if (hbType.includes('cane') || hbType.includes('rattan')) {
    // wooden frame headboard with a Vienna-cane panel
    const fr = 0.06, ft = hbT * 0.55;
    const z = -D / 2 + ft / 2;
    b.add(softBox(W, fr, ft, { r: 0.008, seg: 3 }), wood, { pos: [0, H - fr / 2, z] });
    b.add(softBox(W, fr, ft, { r: 0.006, seg: 2 }), wood, { pos: [0, railTop + fr / 2, z] });
    for (const s of [-1, 1]) b.add(softBox(fr, H - hbBottom, ft, { r: 0.008, seg: 3 }), wood, { pos: [s * (W / 2 - fr / 2), hbBottom + (H - hbBottom) / 2, z], axis: 'y' });
    const ph = H - railTop - 2 * fr;
    b.add(new THREE.PlaneGeometry(W - 2 * fr + 0.004, ph + 0.004), c.mat('cane'), { pos: [0, railTop + fr + ph / 2, z + 0.004] });
    b.add(new THREE.BoxGeometry(W - 2 * fr, ph, 0.006), c.mat('paper', { color: '#3a332d' }), { pos: [0, railTop + fr + ph / 2, z - ft / 2 + 0.004] });
  } else if (hbType === 'none') {
    // no headboard
  } else {
    // upholstered panel on a wooden back (default) — or full upholstered "wingback"
    const backT = hbT * 0.42;
    b.add(softBox(W, hbH, backT, { r: 0.008, seg: 3 }), wood, { pos: [0, hbBottom + hbH / 2, -D / 2 + backT / 2], axis: 'y' });
    const pw = W - (hbType.includes('wing') ? 0.0 : 0.07), ph = H - railTop - 0.035;
    const pt = hbT - backT + 0.005;
    b.add(softBox(pw, ph, pt, { r: Math.min(0.045, pt / 2.1), seg: 4, cell: 0.08, bulge: { front: 0.025, top: 0.006, left: 0.004, right: 0.004 }, wrinkle: 0.0015, seed: c.seed }), hbFab, { pos: [0, railTop + ph / 2 + 0.005, -D / 2 + backT + pt / 2 - 0.004] });
  }

  if (p.footboard === true || p.footboard === 'true') {
    const fh = clamp(cm(p.footboardHeight, 0.45), railTop + 0.02, H * 0.6);
    b.add(softBox(W, fh - legH, footT + 0.01, { r: frameIsFabric ? 0.02 : 0.008, seg: 3 }), wood, { pos: [0, legH + (fh - legH) / 2, D / 2 - (footT + 0.01) / 2], axis: 'y' });
  }
  // legs
  if (hidden) b.add(softBox(W - 0.12, legH, D - 0.16, { r: 0.003, seg: 1 }), c.mat('metal-black', { color: '#1d1a18' }), { pos: [0, legH / 2, 0] });
  else if (legType.includes('plinth')) b.add(softBox(W - 0.1, legH, D - 0.12, { r: 0.004, seg: 1 }), c.mat('metal-black', { color: '#1d1a18' }), { pos: [0, legH / 2, 0] });
  else if (legH > 0) addLegs(b, c, { type: legType.includes('metal') ? 'metal' : legType.includes('taper') ? 'wood-taper' : 'wood-block', w: W, d: D, top: legH, inset: 0.07, mat: frameIsFabric ? c.mat('walnut-dark') : wood, metalMat: c.mat('metal-black'), middle: true });

  const group = b.build('bed');
  return { group, anchors: { deck: V3(0, deckY, zc), top: V3(0, deckY, zc) }, anchorInfo: { deck: { w: mw, d: md } } };
}

export function mattress(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const t = clamp(cm(p.thickness != null ? p.thickness * 100 : null, H), 0.08, 0.4);
  const cover = c.mat('fabric-cotton', { color: p.coverColor || p.color || c.item?.colorHex || '#F4F2EE' });
  const band = c.mat('fabric-linen', { color: p.bandColor || '#d8d6d1' });
  const r = 0.04;
  b.add(softBox(W, t, D, { r, seg: 4, cell: 0.12, bulge: { top: 0.008, front: 0.004, back: 0.004, left: 0.004, right: 0.004 }, seed: c.seed }), cover, { pos: [0, t / 2, 0] });
  // knit border band (slightly proud)
  b.add(softBox(W + 0.014, t * 0.36, D + 0.014, { r: 0.03, seg: 3 }), band, { pos: [0, t * 0.5, 0] });
  // piping at top and bottom edges
  for (const y of [t - r * 0.35, r * 0.35]) {
    const loop = roundedRectLoop(W - r * 0.55, D - r * 0.55, r * 1.2, y, 5);
    b.add(tube(loop, 0.004, { tubular: 120, radial: 5, closed: true, tension: 0.05 }), band, {});
  }
  return { group: b.build('mattress'), anchors: { top: V3(0, t, 0) }, anchorInfo: { top: { w: W, d: D, h: t } } };
}

// ---------------------------------------------------------------- bedding
//
// Cloth is modelled as a thick sheet: a top surface draped analytically over the mattress (edge roll,
// hang, corner droop, low-frequency undulation and soft creases) plus a rolled hem built from the same
// surface (semicircular rim to the underside) — no separate piping tubes.

const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };

/** Low-frequency undulation (±1.5 cm, 25–40 cm wavelength) + soft creases, in metres, at flat coords (a, z). */
function clothRelief(seed, { creases = [], amp = 1 } = {}) {
  const r = rng(seed);
  const ph = Array.from({ length: 6 }, () => r() * Math.PI * 2);
  return (a, z) => {
    let d = 0.008 * Math.sin((2 * Math.PI * a) / 0.34 + ph[0]) * Math.sin((2 * Math.PI * z) / 0.39 + ph[1])
      + 0.005 * Math.sin((2 * Math.PI * (0.7 * a + z)) / 0.27 + ph[2])
      + 0.003 * Math.sin((2 * Math.PI * (a - 0.6 * z)) / 0.23 + ph[3]);
    for (const k of creases) {
      const px = a - k.x, pz = z - k.z;
      const along = px * k.dx + pz * k.dz;
      if (along < 0 || along > k.len) continue;
      const across = Math.abs(-px * k.dz + pz * k.dx);
      const t = along / k.len, fall = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.8;
      const w = k.w * (1 - 0.5 * t);
      d += fall * (-k.depth * Math.exp(-((across / w) ** 2)) + 0.35 * k.depth * Math.exp(-(((across - 1.7 * w) / w) ** 2)));
    }
    return d * amp;
  };
}

function makeCreases(seed, hx, hz, z0, count = 8) {
  const r = rng(seed + 77);
  const out = [];
  const add = (x, z, ang, len, depth) => out.push({ x, z, dx: Math.sin(ang), dz: Math.cos(ang), len, depth, w: 0.022 + r() * 0.012 });
  // from the pillows toward the foot, fanning out
  for (let i = 0; i < Math.ceil(count * 0.6); i++) {
    const x = (r() - 0.5) * hx * 1.4;
    add(x, z0 + 0.04 + r() * 0.06, Math.sign(x || 1) * (0.15 + r() * 0.5), 0.32 + r() * 0.3, 0.006 + r() * 0.005);
  }
  // from the foot corners inward
  for (const sx of [-1, 1]) for (let i = 0; i < Math.max(1, Math.floor(count * 0.2)); i++) {
    add(sx * (hx - 0.04 - r() * 0.05), hz - 0.03, Math.PI + sx * -(0.5 + r() * 0.35), 0.28 + r() * 0.18, 0.006 + r() * 0.004);
  }
  return out;
}

/**
 * Drape map for cloth lying on a box (mattress) whose top is at y = 0, half-size (hx, hz), corner radius rc.
 * The cloth top surface sits `lift` above the support. Returns (a, s) → [x, y, z].
 */
function drapeMap({ z0, hx, hz, rc = 0.06, lift = 0.03, maxDrop = 0.3, footHang = true, flare = 0.16, relief = null, seed = 1, droop = 0.3 }) {
  const r = rng(seed);
  const ph = Array.from({ length: 6 }, () => r() * Math.PI * 2);
  const R = rc + lift;
  const arcLen = (R * Math.PI) / 2;
  // e = flat distance beyond the start of the edge roll → [outward offset, y, hang length]
  const lat = (e) => {
    if (e <= 0) return [e, lift, 0];
    if (e <= arcLen) { const f = e / R; return [R * Math.sin(f), -rc + R * Math.cos(f), 0]; }
    const hang = e - arcLen;
    return [R, -rc - hang, hang];
  };
  return (a, s) => {
    const ax = Math.abs(a), sg = Math.sign(a) || 1;
    const z = z0 + s;
    const [ox, yx, hgx] = lat(ax - (hx - rc));
    const [oz, yz, hgz] = footHang ? lat(z - (hz - rc)) : [0, lift, 0];
    let x = ax <= hx - rc ? ax : hx - rc + ox;
    let zz = !footHang || z <= hz - rc ? z : hz - rc + oz;
    let y = smin(yx, yz, 0.03);
    if (hgx > 0 && hgz > 0) {
      // corner: the cloth that hangs on both sides falls into a soft diagonal cone, tip drooping lower
      const m = Math.min(hgx, hgz), e2 = m * m / (m + 0.05);
      x += flare * e2; zz += flare * e2; y -= droop * e2;
    }
    y = Math.max(y, -(maxDrop + lift));
    const top = clamp(1 - (lift - y) / (rc * 0.9), 0, 1);
    if (relief) y += relief(a, z) * top;
    // vertical folds where it hangs (±1 cm), growing toward the hem
    const hangX = Math.min(1, hgx / 0.1), hangZ = Math.min(1, hgz / 0.1);
    x += 0.009 * hangX * (Math.sin(s * 8.5 + ph[0]) * 0.6 + Math.sin(s * 19 + ph[1]) * 0.4);
    zz += 0.009 * hangZ * (Math.sin(a * 8.5 + ph[2]) * 0.6 + Math.sin(a * 19 + ph[3]) * 0.4);
    return [sg * x, y, zz];
  };
}

/**
 * Thick cloth: top surface over a wFlat × lFlat grid (a ∈ [−w/2, w/2], s ∈ [0, l]) through `map`, and a rolled
 * hem of thickness t around the whole perimeter (semicircle from the top surface to the hidden underside).
 */
function thickCloth(map, { wFlat, lFlat, nA = 56, nS = 60, t = 0.03, rimSeg = 6, headT = null, footT = null }) {
  nA = segs(nA, 16); nS = segs(nS, 16); rimSeg = segs(rimSeg, 3);
  const m = nA + 1;
  const P = new Float32Array((nS + 1) * m * 3);
  for (let j = 0; j <= nS; j++) for (let i = 0; i <= nA; i++) {
    const p = map(-wFlat / 2 + (i / nA) * wFlat, (j / nS) * lFlat);
    P.set(p, (j * m + i) * 3);
  }
  const at = (i, j, o) => P[(j * m + i) * 3 + o];
  const N = new Float32Array(P.length);
  const da = new THREE.Vector3(), ds = new THREE.Vector3(), n = new THREE.Vector3();
  for (let j = 0; j <= nS; j++) for (let i = 0; i <= nA; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(nA, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(nS, j + 1);
    da.set(at(i1, j, 0) - at(i0, j, 0), at(i1, j, 1) - at(i0, j, 1), at(i1, j, 2) - at(i0, j, 2));
    ds.set(at(i, j1, 0) - at(i, j0, 0), at(i, j1, 1) - at(i, j0, 1), at(i, j1, 2) - at(i, j0, 2));
    n.crossVectors(ds, da).normalize();
    N.set([n.x, n.y, n.z], (j * m + i) * 3);
  }
  // orient normals away from the support (centre vertex must point up)
  const c0 = ((nS >> 1) * m + (nA >> 1)) * 3;
  if (N[c0 + 1] < 0) for (let k = 0; k < N.length; k++) N[k] = -N[k];
  const pos = [], nor = [], uv = [], idx = [];
  // top surface
  for (let j = 0; j <= nS; j++) for (let i = 0; i <= nA; i++) {
    const k = (j * m + i) * 3;
    pos.push(P[k], P[k + 1], P[k + 2]); nor.push(N[k], N[k + 1], N[k + 2]); uv.push(-wFlat / 2 + (i / nA) * wFlat, (j / nS) * lFlat);
  }
  for (let j = 0; j < nS; j++) for (let i = 0; i < nA; i++) {
    const a = j * m + i, b = a + 1, c = a + m, d = c + 1;
    idx.push(a, c, d, a, d, b);
  }
  // perimeter loop (left, foot, right, head), with outward in-surface direction E
  const loop = [];
  for (let j = 0; j <= nS; j++) loop.push([0, j]);
  for (let i = 1; i <= nA; i++) loop.push([i, nS]);
  for (let j = nS - 1; j >= 0; j--) loop.push([nA, j]);
  for (let i = nA - 1; i >= 1; i--) loop.push([i, 0]);
  const base = pos.length / 3;
  const E = new THREE.Vector3(), Nv = new THREE.Vector3(), Pv = new THREE.Vector3(), q = new THREE.Vector3();
  let arc = 0;
  for (let li = 0; li < loop.length; li++) {
    const [i, j] = loop[li];
    const k = (j * m + i) * 3;
    Pv.set(P[k], P[k + 1], P[k + 2]); Nv.set(N[k], N[k + 1], N[k + 2]);
    E.set(0, 0, 0);
    const dir = (i2, j2, sgn) => { const k2 = (j2 * m + i2) * 3; q.set(P[k2] - P[k], P[k2 + 1] - P[k + 1], P[k2 + 2] - P[k + 2]).multiplyScalar(sgn); E.add(q.normalize()); };
    if (i === 0) dir(1, j, -1);
    if (i === nA) dir(nA - 1, j, -1);
    if (j === 0) dir(i, 1, -1);
    if (j === nS) dir(i, nS - 1, -1);
    E.addScaledVector(Nv, -E.dot(Nv)).normalize();
    if (li > 0) { const [pi, pj] = loop[li - 1]; const kp = (pj * m + pi) * 3; arc += Math.hypot(P[k] - P[kp], P[k + 1] - P[kp + 1], P[k + 2] - P[kp + 2]); }
    // headT: a thicker rolled fold along the head edge (j = 0) — the turn-down's fold reaching down to the
    // mattress — easing back to t over the first two rows of the sides
    // footT: thin hem along the free edge (j = nS), easing over the last rows of the sides
    let tt = headT ? t + (headT - t) * Math.max(0, 1 - j / 2) : t;
    if (footT) { const k = Math.max(0, Math.min(1, (j - nS * 0.6) / (nS * 0.4))); tt = tt + (footT - tt) * k * k * (3 - 2 * k); }
    for (let r2 = 0; r2 <= rimSeg; r2++) {
      const th = (r2 / rimSeg) * Math.PI;
      const cn = Math.cos(th), sn = Math.sin(th);
      pos.push(Pv.x - Nv.x * tt / 2 + (Nv.x * cn + E.x * sn) * tt / 2, Pv.y - Nv.y * tt / 2 + (Nv.y * cn + E.y * sn) * tt / 2, Pv.z - Nv.z * tt / 2 + (Nv.z * cn + E.z * sn) * tt / 2);
      nor.push(Nv.x * cn + E.x * sn, Nv.y * cn + E.y * sn, Nv.z * cn + E.z * sn);
      uv.push(arc, th * tt / 2);
    }
  }
  const rs = rimSeg + 1;
  for (let li = 0; li < loop.length; li++) {
    const l2 = (li + 1) % loop.length;
    for (let r2 = 0; r2 < rimSeg; r2++) {
      const a = base + li * rs + r2, b = base + l2 * rs + r2, c = a + 1, d = b + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function bedding(c) {
  const { W, D, params: p } = c;
  const b = new Builder(c.seed);
  const host = c.host || {};
  const mw = host.w || clamp(W - 0.6, 0.8, 2.0);
  const md = host.d || clamp(D - 0.4, 1.8, 2.2);
  const mh = host.h || 0.25;
  const hx = mw / 2, hz = md / 2;
  const duvetCol = p.duvetColor || c.item?.colorHex || '#F2EFE9';
  const duvetFab = p.duvetFabric || 'cotton';
  const duvet = fabricMat(c, duvetFab, duvetCol);
  const sheet = fabricMat(c, 'cotton', p.sheetColor || duvetCol);
  // fitted sheet over the top of the mattress (visible at the head)
  b.add(softBox(mw + 0.01, 0.05, md + 0.01, { r: 0.035, seg: 3 }), sheet, { pos: [0, -0.02, 0] });

  const t = clamp(cm(p.duvetThickness, 0.035), 0.015, 0.07);
  const z0 = -hz + clamp(md * 0.24, 0.38, 0.55);
  // drop: cover the mattress sides but stay above a platform rail (rail tops sit ~6 cm above the deck)
  const maxDrop = clamp(cm(p.drop, mh - 0.06), 0.08, 0.32);
  const rc = 0.07;
  const lFlat = (hz - z0) + (rc * Math.PI) / 2 + maxDrop * 0.85;
  const wFlat = mw + 2 * ((rc * Math.PI) / 2 - rc) + 2 * maxDrop * 0.85 + 0.02;
  // creases start below the turn-down (sampled finely there), so the fold edge stays a clean, smooth roll
  const fold = 0.27;
  const relief = clothRelief(c.seed, { creases: makeCreases(c.seed, hx, hz, z0 + fold, 8) });
  // open duvet starts inside the fold roll (its own head rim is hidden)
  const dz = t * 0.9;
  const dmap = drapeMap({ z0: z0 + dz, hx, hz, rc, lift: t, maxDrop, relief, seed: c.seed });
  b.add(thickCloth(dmap, { wFlat, lFlat: lFlat - dz, nA: 64, nS: 64, t }), duvet, { uv: 'keep' });
  // R2-17 turn-down: the duvet folded back over its head end — one duvet thickness lying 2 mm above the open
  // part (same relief, never intersecting), joined to the mattress by a rounded fold roll of full height (no
  // stair-stepped polyline: 96 segments across, no creases under it)
  const lift2 = 2 * t + 0.002;
  const fmap0 = drapeMap({ z0, hx, hz, rc, lift: lift2, maxDrop: maxDrop - 0.012, footHang: false, relief, seed: c.seed + 5 });
  // the folded part thins out toward its free edge (a duvet's sewn hem is ~1 cm): the top surface eases down over
  // the last 40 % so the hem is a soft 12 mm edge lying on the open duvet, not a 3 cm sunlit step
  const hemT = 0.012;
  const fmap = (a, s) => { const p = fmap0(a, s); const k = Math.max(0, Math.min(1, (s - fold * 0.6) / (fold * 0.4))); p[1] -= (k * k * (3 - 2 * k)) * (t * 0.9 - hemT); return p; };
  b.add(thickCloth(fmap, { wFlat: wFlat - 0.012, lFlat: fold, nA: 96, nS: 16, t: t * 0.9, headT: lift2, footT: hemT, rimSeg: 8 }), duvet, { uv: 'keep' });

  // throw folded across the foot (knit), lying on the duvet
  if (p.throwColor !== null && p.throw !== false) {
    const throwFab = fabricMat(c, p.throwFabric || 'knit', p.throwColor || '#7A7B55');
    const tt = 0.018, tl = 0.5, tz0 = hz - 0.62;
    const tw = Math.min(wFlat, mw + 0.34);
    // rests on the duvet (1.5 mm air gap, was 4 mm → read as a dark hem line, R2-17)
    const tmap = drapeMap({ z0: tz0, hx, hz, rc, lift: t + tt + 0.0015, maxDrop: maxDrop - 0.05, footHang: false, relief, seed: c.seed + 9 });
    b.add(thickCloth(tmap, { wFlat: tw, lFlat: tl, nA: 64, nS: 16, t: tt, rimSeg: 6 }), throwFab, { uv: 'keep' });
  }

  // pillows
  const nP = clamp(Math.round(p.pillows ?? 2), 0, 8);
  const cols = p.pillowColors && p.pillowColors.length ? p.pillowColors : [duvetCol];
  const perRow = mw >= 1.35 ? 2 : 1;
  const rows = [];
  let left = nP;
  while (left > 0) { const n = Math.min(perRow, left); rows.push(n); left -= n; }
  if (rows.length > 2) rows.length = 2;
  let ci = 0;
  const rr = rng(c.seed + 31);
  rows.forEach((n, ri) => {
    const pw = ri === 0 ? Math.min(0.72, mw / n - 0.04) : Math.min(0.55, mw / n - 0.12);
    const ph = ri === 0 ? 0.5 : 0.42;
    const pt = ri === 0 ? 0.17 : 0.15;
    const tilt = ri === 0 ? 0.52 : 0.7;
    const zBase = -hz + 0.06 + ri * 0.2;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : (i - (n - 1) / 2) * (mw / n) * (ri === 0 ? 0.98 : 0.86);
      const fab = fabricMat(c, ri === 0 ? 'cotton' : (p.pillowFabric || 'linen'), cols[ci++ % cols.length]);
      const dents = Array.from({ length: 2 + (rr() < 0.5 ? 1 : 0) }, () => [(rr() - 0.5) * pw * 0.6, (rr() - 0.5) * ph * 0.5, 0.012 + rr() * 0.012, 0.06 + rr() * 0.05]);
      const g = pillowGeometry(pw, ph, pt, { n: 18, pinch: ri === 0 ? 0.05 : 0.08, plump: 0.5, sag: 0.05, seed: c.seed + ri * 10 + i, squash: 0.6, dents, ears: 0.6 });
      const cy = (ph / 2) * Math.cos(tilt) + (pt / 2) * Math.sin(tilt) * 0.7;
      const cz = zBase + (ph / 2) * (-Math.sin(tilt)) + 0.16 + (pt / 2) * Math.cos(tilt) * 0.5;
      const yaw = (i - (n - 1) / 2) * -0.05 * (ri + 1);
      b.add(g, fab, { pos: [x, cy - 0.005 + 2 * t * 0, cz], rot: [-tilt, yaw, (i % 2 ? 1 : -1) * 0.02], uv: 'box' });
    }
  });
  return { group: b.build('bedding') };
}
