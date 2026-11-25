// Villar furniture — bed frame, mattress, bedding (duvet drape, pillows, throw). Owner: modeler.
import * as THREE from 'three';
import { Builder, softBox, pillowGeometry, tube, roundedRectLoop, V3, clamp, lerp, cm } from './geom.js';
import { fabricMat, addLegs, isMetal } from './parts.js';
import { rng } from '../textures.js';

const STD_W = [0.9, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0];
const STD_L = [1.9, 2.0, 2.1];
const pickStd = (list, max, fallback) => { let r = fallback; for (const v of list) if (v <= max + 1e-6) r = v; return r; };

export function bed(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const woodKey = p.frame || p.wood || 'walnut-dark';
  const frameIsFabric = /fabric|bouc|linen|velvet|uphol/.test(String(woodKey));
  const wood = frameIsFabric ? fabricMat(c, woodKey, p.headboardColor) : c.mat(woodKey);
  const hbType = String(p.headboard || 'upholstered-panel').toLowerCase();
  const hbFab = fabricMat(c, p.fabric || p.headboardFabric || 'boucle', p.headboardColor || '#E8E1D5');
  const legType = String(p.legs || 'wood-short').toLowerCase();
  const mw = cm(p.mattressW, pickStd(STD_W, W - 0.05, W - 0.1));
  const md = cm(p.mattressD, pickStd(STD_L, D - 0.08, D - 0.12));
  const hbT = clamp((D - md) * 0.62, 0.05, 0.14);
  const footT = clamp(D - md - hbT, 0.02, 0.08);
  const sideT = clamp((W - mw) / 2, 0.02, 0.12);
  const legH = legType === 'none' || legType.includes('floor') ? 0 : legType.includes('plinth') ? 0.07 : clamp(cm(p.legHeight, 0.1), 0.04, 0.25);
  const deckY = clamp(cm(p.deckHeight, legH + 0.2), 0.12, 0.5);
  const railTop = deckY + clamp(cm(p.railAbove, 0.06), 0, 0.15);
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
  } else if (hbType.includes('channel') || hbType.includes('tuft') || hbType.includes('rib')) {
    b.add(softBox(W, hbH, hbT * 0.4, { r: 0.006, seg: 2 }), wood, { pos: [0, hbBottom + hbH / 2, -D / 2 + hbT * 0.2], axis: 'y' });
    const n = Math.max(4, Math.round((W - 0.04) / 0.18));
    const cw = (W - 0.04) / n;
    const ch = H - railTop - 0.03;
    for (let i = 0; i < n; i++) b.add(softBox(cw + 0.004, ch, hbT * 0.6, { r: Math.min(0.04, cw / 2.3), seg: 4, cell: 0.08, bulge: { front: 0.02, top: 0.005 }, seed: c.seed + i }), hbFab, { pos: [-W / 2 + 0.02 + cw * (i + 0.5), railTop + ch / 2, -D / 2 + hbT * 0.4 + hbT * 0.3] });
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

  // legs
  if (legType.includes('plinth')) b.add(softBox(W - 0.1, legH, D - 0.12, { r: 0.004, seg: 1 }), c.mat('metal-black', { color: '#1d1a18' }), { pos: [0, legH / 2, 0] });
  else if (legH > 0) addLegs(b, c, { type: legType.includes('metal') ? 'metal' : legType.includes('taper') ? 'wood-taper' : 'wood-block', w: W, d: D, top: legH, inset: 0.07, mat: frameIsFabric ? c.mat('walnut-dark') : wood, metalMat: c.mat('metal-black'), middle: true });

  const group = b.build('bed');
  return { group, anchors: { deck: V3(0, deckY, zc), top: V3(0, deckY, zc) }, anchorInfo: { deck: { w: mw, d: md } } };
}

export function mattress(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const t = clamp(cm(p.thickness != null ? p.thickness * 100 : null, H), 0.08, 0.4);
  const cover = c.mat('fabric-cotton', { color: p.color || c.item?.colorHex || '#F4F2EE' });
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

/**
 * Cloth draped over a box (mattress) whose top is at y = 0, half-size (hx, hz), corner radius rc.
 * Flat cloth: width wFlat (x), length lFlat (along +z starting at z0). Returns { geom, edge: (a,s)->point }.
 */
function drape({ wFlat, lFlat, z0, hx, hz, rc = 0.05, lift = 0.0, puff = 0.04, nA = 60, nS = 70, seed = 1, maxDrop = 0.3, footHang = true, flare = 0.22, headRoll = 0 }) {
  const r = rng(seed);
  const ph = Array.from({ length: 8 }, () => r() * Math.PI * 2);
  const inner = (h) => h - rc;
  const lat = (e) => {
    // e = distance beyond (h - rc) along the cloth → [outwardOffset, down, hang]
    if (e <= 0) return [e, 0, 0];
    const arc = rc * Math.PI / 2;
    if (e <= arc) { const f = e / rc; return [rc * Math.sin(f), -(rc - rc * Math.cos(f)), 0]; }
    const hang = e - arc;
    return [rc, -rc - hang, hang];
  };
  const map = (a, s, off = 0) => {
    const ax = Math.abs(a), sg = Math.sign(a) || 1;
    const z = z0 + s;
    const [ox, dx, hx2] = lat(ax - inner(hx));
    const [oz, dz, hz2] = footHang ? lat(z - inner(hz)) : [z - inner(hz), 0, 0];
    let x = ax <= inner(hx) ? ax : inner(hx) + ox;
    let zz = z <= inner(hz) || !footHang ? z : inner(hz) + oz;
    let y = -Math.sqrt(dx * dx + dz * dz);
    // corner flare: cloth hanging on one side pushes the other outward
    if (hx2 > 0 && hz2 > 0) { const f = flare * Math.min(hz2, hx2); x += f; zz += f; }
    else { x += hz2 > 0 && ax > inner(hx) ? 0 : 0; }
    const hang = Math.max(hx2, hz2);
    if (y < -maxDrop) y = -maxDrop - (y + maxDrop) * -0.0; // hem stops at maxDrop (cloth would rest on the frame)
    // puffiness on top, tapering where the cloth wraps the edge
    const onTop = Math.max(0, 1 - Math.max(0, -y) / (rc * 1.2));
    const n = Math.sin(a * 3.1 + ph[0]) * Math.sin(s * 2.3 + ph[1]) * 0.5 + Math.sin(a * 7.3 + s * 5.1 + ph[2]) * 0.25 + Math.sin(s * 11 + ph[3]) * 0.12;
    let yy = y + lift + puff * (0.75 + 0.25 * n) * (0.3 + 0.7 * onTop);
    // vertical folds in the hanging part
    const fold = Math.sin(s * 9 + ph[4]) * 0.6 + Math.sin(s * 23 + ph[5]) * 0.4;
    const foldX = Math.sin(a * 9 + ph[6]) * 0.6 + Math.sin(a * 21 + ph[7]) * 0.4;
    x += (hx2 > 0 ? 0.012 * fold * Math.min(1, hx2 / 0.08) : 0) + off;
    zz += (hz2 > 0 ? 0.005 * foldX * Math.min(1, hz2 / 0.08) : 0) + (hz2 > 0 ? off : 0);
    // soft head roll (turn-down edge lifts slightly)
    if (headRoll && s < 0.06) yy += headRoll * (1 - s / 0.06);
    return [sg * x, yy, zz, hang];
  };
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nS; j++) {
    const s = (j / nS) * lFlat;
    for (let i = 0; i <= nA; i++) {
      const a = -wFlat / 2 + (i / nA) * wFlat;
      const p = map(a, s);
      pos.push(p[0], p[1], p[2]); uv.push(a, s);
    }
  }
  const m = nA + 1;
  for (let j = 0; j < nS; j++) for (let i = 0; i < nA; i++) {
    const a = j * m + i, b2 = a + 1, c2 = a + m, d = c2 + 1;
    idx.push(a, c2, d, a, d, b2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const edge = (samples = 80) => {
    const pts = [];
    const push = (a, s) => { const p = map(a, s); pts.push(V3(p[0], p[1], p[2])); };
    for (let i = 0; i <= samples; i++) push(-wFlat / 2, (i / samples) * lFlat);
    for (let i = 1; i <= samples; i++) push(-wFlat / 2 + (i / samples) * wFlat, lFlat);
    for (let i = 1; i <= samples; i++) push(wFlat / 2, lFlat - (i / samples) * lFlat);
    return pts;
  };
  const line = (s, samples = 60) => { const pts = []; for (let i = 0; i <= samples; i++) { const p = map(-wFlat / 2 + (i / samples) * wFlat, s); pts.push(V3(p[0], p[1], p[2])); } return pts; };
  return { geom: g, edge, line, map };
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
  const duvet = fabricMat(c, duvetFab, duvetCol, { side: THREE.DoubleSide });
  const sheet = fabricMat(c, 'cotton', p.sheetColor || duvetCol);
  // fitted sheet over the top of the mattress (visible at the head)
  b.add(softBox(mw + 0.01, 0.05, md + 0.01, { r: 0.035, seg: 3 }), sheet, { pos: [0, -0.02, 0] });

  // duvet
  const z0 = -hz + clamp(md * 0.24, 0.38, 0.55);
  // drop: cover the mattress sides but stay above a platform rail (rail tops sit ~6 cm above the deck)
  const maxDrop = clamp(cm(p.drop, mh - 0.06), 0.08, 0.32);
  const lFlat = (hz - z0) + maxDrop + 0.03;
  const wFlat = mw + 2 * (maxDrop + 0.03);
  const dv = drape({ wFlat, lFlat, z0, hx, hz, rc: 0.055, puff: 0.045, nA: 56, nS: 60, seed: c.seed, maxDrop, headRoll: 0.01 });
  b.add(dv.geom, duvet, { uv: 'keep' });
  // hem roll gives the duvet a visible thickness
  b.add(tube(dv.edge(70), 0.012, { tubular: 200, radial: 6, tension: 0.3 }), duvet, { uv: 'box' });
  // turn-down fold at the head
  const fold = drape({ wFlat, lFlat: 0.3, z0: z0 - 0.0, hx, hz, rc: 0.06, lift: 0.045, puff: 0.03, nA: 60, nS: 10, seed: c.seed + 5, maxDrop: maxDrop - 0.01, footHang: false });
  b.add(fold.geom, duvet, { uv: 'keep' });
  b.add(tube(fold.line(0, 70), 0.03, { tubular: 140, radial: 8, tension: 0.3 }), duvet, { uv: 'box', pos: [0, -0.005, 0.0] });
  b.add(tube(fold.line(0.3, 70), 0.01, { tubular: 140, radial: 6, tension: 0.3 }), duvet, { uv: 'box' });

  // throw folded across the foot
  if (p.throwColor !== null && p.throw !== false) {
    const throwFab = fabricMat(c, p.throwFabric || 'wool', p.throwColor || '#7A7B55', { side: THREE.DoubleSide });
    const tl = 0.5, tz0 = hz - 0.62;
    const tw = Math.min(wFlat, mw + 0.32);
    const th = drape({ wFlat: tw, lFlat: tl, z0: tz0, hx: hx + 0.03, hz: hz + 0.05, rc: 0.08, lift: 0.06, puff: 0.022, nA: 50, nS: 14, seed: c.seed + 9, maxDrop: maxDrop - 0.04, footHang: false });
    b.add(th.geom, throwFab, { uv: 'keep' });
    b.add(tube(th.line(0, 60), 0.014, { tubular: 120, radial: 6 }), throwFab, { uv: 'box' });
    b.add(tube(th.line(tl, 60), 0.014, { tubular: 120, radial: 6 }), throwFab, { uv: 'box' });
  }

  // pillows
  const nP = clamp(Math.round(p.pillows ?? 2), 0, 8);
  const cols = p.pillowColors && p.pillowColors.length ? p.pillowColors : [duvetCol];
  const perRow = mw >= 1.35 ? 2 : 1;
  const rows = [];
  let left = nP;
  // row 0: sleeping pillows against headboard; row 1: decorative, smaller and more upright-forward
  while (left > 0) { const n = Math.min(perRow, left); rows.push(n); left -= n; }
  if (rows.length > 2) { rows.length = 2; }
  let ci = 0;
  rows.forEach((n, ri) => {
    const pw = ri === 0 ? Math.min(0.72, mw / n - 0.04) : Math.min(0.55, mw / n - 0.12);
    const ph = ri === 0 ? 0.5 : 0.42;
    const pt = ri === 0 ? 0.16 : 0.15;
    const tilt = ri === 0 ? 0.52 : 0.7; // radians from vertical (leaning back)
    const zBase = -hz + 0.06 + ri * 0.2;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : (i - (n - 1) / 2) * (mw / n) * (ri === 0 ? 0.98 : 0.86);
      const fab = fabricMat(c, ri === 0 ? 'cotton' : (p.pillowFabric || 'linen'), cols[ci++ % cols.length]);
      const g = pillowGeometry(pw, ph, pt, { n: 16, pinch: ri === 0 ? 0.05 : 0.08, plump: 0.5, sag: 0.05, seed: c.seed + ri * 10 + i, squash: 0.6 });
      const cy = (ph / 2) * Math.cos(tilt) + (pt / 2) * Math.sin(tilt) * 0.7;
      const cz = zBase + (ph / 2) * (-Math.sin(tilt)) + 0.16 + (pt / 2) * Math.cos(tilt) * 0.5;
      const yaw = (i - (n - 1) / 2) * -0.05 * (ri + 1);
      b.add(g, fab, { pos: [x, cy - 0.005, cz], rot: [-tilt, yaw, (i % 2 ? 1 : -1) * 0.02], uv: 'box' });
    }
  });
  return { group: b.build('bedding') };
}
