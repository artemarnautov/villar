// Villar furniture — sofas, armchairs, dining chairs, throw cushions. Owner: modeler.
import * as THREE from 'three';
import { Builder, softBox, pillowGeometry, roundLeg, tube, roundedRectLoop, lathe, V3, clamp, lerp, cm } from './geom.js';
import { fabricMat, addLegs, isMetal } from './parts.js';

// ---------------------------------------------------------------- upholstered body (sofa / armchair)

const ARM_W = { track: 0.15, square: 0.15, round: 0.19, rolled: 0.2, slope: 0.17, flared: 0.2, wide: 0.24, pad: 0.12, slim: 0.09, none: 0, armless: 0 };

function upholstered(c, o) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const fab = fabricMat(c, p.fabric, p.fabricColor || p.color);
  const isBoucle = /bouc/.test(String(p.fabric || ''));
  const woodKey = p.legMaterial || (p.wood && p.wood !== 'none' ? p.wood : null) || (p.frame && !/fabric|uphol/.test(p.frame) ? p.frame : null) || 'walnut-dark';
  const legMat = c.mat(woodKey, p.legColor && !isMetal(woodKey) ? { match: p.legColor } : undefined);
  const metal = c.mat(isMetal(woodKey) ? woodKey : 'metal-black', p.legColor ? { color: p.legColor } : undefined);
  const armType = String(p.arm || o.arm || 'track').toLowerCase();
  let legType = String(p.legs || o.legs || 'wood-taper').toLowerCase();
  const seats = clamp(Math.round(p.seats || o.seats || Math.max(1, Math.round(W / 0.72))), 1, 5);

  const legH = legType === 'none' ? 0 : legType.includes('plinth') ? 0.035 : legType.includes('bun') ? 0.05 : clamp(cm(p.legHeight, H * 0.17), 0.06, 0.18);
  let armW = ARM_W[armType] ?? 0.15;
  armW = Math.min(armW, W * (seats === 1 ? 0.2 : 0.1));
  if (p.armWidth) armW = cm(p.armWidth, armW);
  const seatH = clamp(cm(p.seatHeight, o.seatH || (p.depthStyle === 'lounge' ? 0.42 : 0.44)), 0.32, 0.52);
  const armH = armW > 0 ? clamp(cm(p.armHeight, Math.min(H - 0.12, seatH + 0.19)), seatH + 0.08, H) : 0;
  const backT = clamp(D * 0.17, 0.12, 0.2);
  const sct = clamp(cm(p.seatThickness, 0.16), 0.1, 0.22); // seat cushion thickness
  const baseTop = seatH - sct;
  const rArm = armType === 'round' || armType === 'rolled' ? Math.min(armW * 0.48, 0.1) : armType === 'slim' ? 0.02 : isBoucle ? 0.045 : 0.03;
  const rCush = isBoucle ? 0.045 : 0.032;
  const looseBack = p.back !== 'tight' && p.cushion !== 'tight' && p.backCushions !== 'tight' && p.backCushions !== 0;
  const innerW = W - 2 * armW;

  // base / deck
  const baseH = Math.max(0.05, baseTop - legH);
  b.add(softBox(innerW + 0.04, baseH, D - 0.01, { r: 0.015, seg: 2 }), fab, { pos: [0, legH + baseH / 2, 0.0] });

  // arms
  if (armW > 0) {
    const ah = armH - legH;
    for (const s of [-1, 1]) {
      const g = softBox(armW, ah, D, { r: rArm, seg: 4, cell: 0.07, bulge: { top: 0.006, left: 0.004, right: 0.004, front: 0.004 }, seed: c.seed + s });
      b.add(g, fab, { pos: [s * (W / 2 - armW / 2), legH + ah / 2, 0] });
    }
  }

  // back frame
  const bhK = p.backHeight === 'low' ? 0.16 : p.backHeight === 'high' ? 0.04 : 0.1;
  const backTop = looseBack ? Math.max(seatH + 0.15, H - bhK) : H;
  const bfh = backTop - legH;
  b.add(softBox(innerW + 0.02, bfh, backT, { r: Math.min(0.04, backT / 2.2), seg: 3, cell: 0.1, bulge: looseBack ? null : { front: 0.02, top: 0.008 } }), fab, { pos: [0, legH + bfh / 2, -D / 2 + backT / 2] });
  if (!looseBack) {
    // tight back: padded panel in front of the frame, optionally horizontally channel-stitched
    const ph = H - seatH - 0.02, pt = clamp(D * 0.13, 0.08, 0.14);
    const channels = /channel|horizontal/.test(String(p.backStitch || '')) ? clamp(Math.round(ph / 0.11), 3, 6) : 1;
    const chH = ph / channels;
    const lean = 0.1;
    for (let i = 0; i < channels; i++) {
      const t = (i + 0.5) / channels;
      const y = seatH - 0.02 + t * ph * Math.cos(lean);
      const z = -D / 2 + backT + pt / 2 - t * ph * Math.sin(lean) + 0.01;
      b.add(softBox(innerW, chH + 0.004, pt, { r: Math.min(chH / 2.2, 0.035), seg: 3, cell: 0.08, bulge: { front: channels > 1 ? 0.012 : 0.025, top: 0.004 }, wrinkle: 0.001, seed: c.seed + 50 + i }), fab, { pos: [0, y, z], rot: [-lean, 0, 0] });
    }
  }

  // seat cushions
  const nSeat = p.bench || p.seatCushions === 1 ? 1 : clamp(Math.round(p.seatCushions || seats), 1, 5);
  const cw = innerW / nSeat;
  const sd = D - backT + 0.012;
  const seatZ = -D / 2 + backT + sd / 2 - 0.006;
  for (let i = 0; i < nSeat; i++) {
    const x = -innerW / 2 + cw * (i + 0.5);
    const g = softBox(cw + 0.004, sct, sd, { r: rCush, seg: 4, cell: 0.07, bulge: { top: 0.022, front: 0.014, left: 0.005, right: 0.005 }, wrinkle: 0.0018, seed: c.seed + 10 + i });
    b.add(g, fab, { pos: [x, baseTop + sct / 2, seatZ] });
    if (p.piping) {
      for (const yy of [sct / 2 - rCush * 0.3, -sct / 2 + rCush * 0.3]) {
        const loop = roundedRectLoop(cw - rCush * 0.6, sd - rCush * 0.6, rCush * 0.8, yy, 4);
        b.add(tube(loop, 0.0035, { tubular: 90, radial: 5, closed: true, tension: 0.1 }), fab, { pos: [x, baseTop + sct / 2 + 0.002, seatZ] });
      }
    }
  }

  // back cushions
  let backFrontZ = -D / 2 + backT;
  if (looseBack) {
    const nBack = clamp(Math.round(p.backCushions && p.backCushions !== true ? p.backCushions : nSeat === 1 ? seats : nSeat), 1, 5);
    const bw = innerW / nBack;
    const bt = clamp(D * 0.22, 0.14, 0.22);
    const bh = Math.max(0.25, H - seatH + 0.02);
    const lean = (o.lean ?? 9) * Math.PI / 180;
    for (let i = 0; i < nBack; i++) {
      const x = -innerW / 2 + bw * (i + 0.5);
      const g = softBox(bw + 0.004, bh, bt, { r: Math.min(rCush * 1.3, bt / 2.2), seg: 4, cell: 0.07, bulge: { front: 0.03, back: 0.005, top: 0.01, left: 0.006, right: 0.006 }, wrinkle: 0.002, seed: c.seed + 30 + i, taper: 0.0 });
      // pivot at bottom-back edge, lean backwards
      const cy = seatH - 0.02 + (bh / 2) * Math.cos(lean);
      const cz = -D / 2 + backT + bt / 2 - (bh / 2) * Math.sin(lean) + 0.02;
      b.add(g, fab, { pos: [x, cy, cz], rot: [-lean, 0, 0] });
    }
    backFrontZ = -D / 2 + backT + bt * 0.9;
  } else backFrontZ += clamp(D * 0.13, 0.08, 0.14);

  // legs / plinth
  if (legType.includes('plinth')) {
    const pin = Math.max(0.04, rArm * 0.9, rCush * 0.6);
    b.add(softBox(W - 2 * pin, legH, D - 2 * pin, { r: 0.004, seg: 1 }), c.mat(isMetal(woodKey) ? woodKey : 'metal-black', { color: '#1d1a18' }), { pos: [0, legH / 2, 0] });
  } else if (legH > 0) {
    addLegs(b, c, { type: legType, w: W, d: D, top: legH, inset: legType.includes('metal') ? 0.03 : 0.07, mat: legMat, metalMat: metal, middle: W > 1.9, middleInset: D * 0.3 });
  }

  // exposed wooden base rail / frame under the upholstery
  const base = String(p.base || '').toLowerCase();
  if (base.includes('wood')) {
    const rh = base.includes('frame') ? 0.07 : 0.055;
    const railMat = c.mat(woodKey && !isMetal(woodKey) ? woodKey : 'walnut-dark');
    b.add(softBox(W + 0.004, rh, D + 0.004, { r: 0.006, seg: 2 }), railMat, { pos: [0, legH + rh / 2, 0] });
  }
  if (String(p.armPanel || '').match(/rattan|cane/) && armW > 0) {
    const pm = c.mat('cane', { color: p.armPanelColor || '#C2A77D' });
    const ah = armH - legH;
    for (const s of [-1, 1]) {
      b.add(new THREE.PlaneGeometry(D - 0.16, ah - 0.16), pm, { pos: [s * (W / 2 + 0.006), legH + ah / 2, 0], rot: [0, s * Math.PI / 2, 0] });
      b.add(new THREE.PlaneGeometry(D - 0.12, ah - 0.12), c.mat('walnut-dark'), { pos: [s * (W / 2 + 0.003), legH + ah / 2, 0], rot: [0, s * Math.PI / 2, 0] });
    }
  }

  const group = b.build(o.name || 'sofa');
  const seatAnchor = V3(0, seatH + 0.008, Math.min(D / 2 - 0.12, backFrontZ + 0.085));
  return { group, anchors: { seat: seatAnchor, top: V3(0, H, 0) }, anchorInfo: { seat: { w: innerW, d: D / 2 - backFrontZ } },
    spec: { armW, armH, legH, legType, baseTop, seatH, sct, innerW, nSeat, cw, rCush, rArm, fab, legMat, metal, sd } };
}

/** Sofa; params.chaise = 'left' | 'right' adds a chaise longue (item.dims.d = overall depth incl. chaise). */
export function sofa(c) {
  const p = c.params;
  const ch = String(p.chaise || p.corner || p.lshape || '').toLowerCase();
  if (!ch || ch === 'none' || ch === 'false' || c.D < 1.15) return upholstered(c, { name: 'sofa' });
  const Dm = clamp(cm(p.mainDepth, Math.min(c.D * 0.62, 0.98)), 0.75, c.D - 0.3);
  const main = upholstered({ ...c, D: Dm }, { name: 'sofa' });
  const off = -c.D / 2 + Dm / 2;
  for (const m of main.group.children) m.position.z += off;
  for (const a of Object.values(main.anchors)) a.z += off;
  const S = main.spec;
  const side = ch.includes('left') ? -1 : 1;
  const b = new Builder(c.seed + 99);
  const z0 = off + Dm / 2, z1 = c.D / 2, L = z1 - z0;
  const xc = side * (S.innerW / 2 - S.cw / 2);
  const baseH = Math.max(0.05, S.baseTop - S.legH);
  b.add(softBox(S.cw + 0.02, baseH, L + 0.02, { r: 0.015, seg: 2 }), S.fab, { pos: [xc, S.legH + baseH / 2, z0 + L / 2 - 0.01] });
  b.add(softBox(S.cw + 0.004, S.sct, L + 0.012, { r: S.rCush, seg: 4, cell: 0.07, bulge: { top: 0.022, front: 0.014, left: 0.005, right: 0.005 }, wrinkle: 0.0018, seed: c.seed + 77 }), S.fab, { pos: [xc, S.baseTop + S.sct / 2, z0 + L / 2 - 0.004] });
  if (S.armW > 0) {
    const ah = S.armH - S.legH;
    b.add(softBox(S.armW, ah, L + 0.03, { r: S.rArm, seg: 4, cell: 0.07, bulge: { top: 0.006, left: 0.004, right: 0.004, front: 0.004 }, seed: c.seed + 5 }), S.fab, { pos: [side * (c.W / 2 - S.armW / 2), S.legH + ah / 2, z0 + L / 2 - 0.015] });
  }
  if (S.legH > 0 && !String(S.legType).includes('plinth')) addLegs(b, c, { type: S.legType, w: S.cw + S.armW, d: L, top: S.legH, inset: 0.06, mat: S.legMat, metalMat: S.metal, cx: side * (c.W / 2 - (S.cw + S.armW) / 2), cz: z0 + L / 2 });
  const ext = b.build('chaise');
  while (ext.children.length) main.group.add(ext.children[0]);
  return main;
}

export function armchair(c) {
  const p = c.params;
  const style = String(p.style || 'lounge').toLowerCase();
  if (/barrel|tub/.test(style)) return barrelChair(c);
  if (/frame|scandi|wood|mid|danish|paddle/.test(style) || /wood|open|paddle/.test(String(p.arm || '')) || p.frameVisible || (/leather/.test(String(p.fabric || '')) && !/club|slipper/.test(style))) return woodFrameChair(c);
  const map = {
    lounge: { arm: 'round', lean: 13, seatH: 0.42 }, club: { arm: 'wide', lean: 9, seatH: 0.43 }, slipper: { arm: 'none', lean: 12, seatH: 0.43 },
    accent: { arm: 'slim', lean: 10, seatH: 0.45 }, wingback: { arm: 'round', lean: 8, seatH: 0.45 }, barrel: { arm: 'round', lean: 10, seatH: 0.43 },
  };
  const o = map[Object.keys(map).find((k) => style.includes(k)) || 'lounge'];
  return upholstered({ ...c, params: { seats: 1, legMaterial: p.frame, ...p } }, { ...o, name: 'armchair', legs: 'wood-taper' });
}

/** Barrel / tub chair: a continuous curved back-and-arm wall around a round seat on short legs. */
function barrelChair(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const fab = fabricMat(c, p.fabric, p.fabricColor || p.color);
  const legMat = c.mat(p.legMaterial || p.frame || 'walnut-dark');
  const legH = clamp(cm(p.legHeight, 0.12), 0.04, 0.25);
  const R = Math.min(W, D) / 2, t = clamp(R * 0.3, 0.09, 0.15);
  const seatH = clamp(cm(p.seatHeight, 0.43), 0.36, 0.5);
  const armH = clamp(cm(p.armHeight, seatH + 0.2), seatH + 0.1, H - 0.02);
  const backH = H;
  const open = (p.opening ?? 110) * Math.PI / 360; // half-angle of the front opening
  const shape = new THREE.Shape();
  const a0 = Math.PI / 2 + open, a1 = Math.PI / 2 + 2 * Math.PI - open;
  const bev = Math.min(0.035, t * 0.35);
  shape.absarc(0, 0, R - bev, a0, a1, false);
  shape.absarc(0, 0, R - t + bev, a1, a0, true);
  const wallH = backH - legH;
  const g = new THREE.ExtrudeGeometry(shape, { depth: wallH - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 64 });
  g.rotateX(Math.PI / 2); // shape y → z, extrusion → −y
  g.translate(0, wallH - bev, 0);
  // slope the top from the high back down to the arms
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const a = Math.atan2(z, x); // back = −π/2
    const back = Math.pow(Math.max(0, Math.cos(a + Math.PI / 2)) , 0.0) * Math.max(0, -Math.sin(a));
    const target = (armH - legH) + (wallH - (armH - legH)) * Math.pow(back, 1.3);
    pos.setY(i, y * (target / wallH));
  }
  g.computeVertexNormals();
  b.add(g, fab, { pos: [0, legH, 0] });
  // seat platform + crowned round cushion
  const sr = R - t + 0.01;
  b.add(new THREE.CylinderGeometry(sr + 0.01, sr + 0.01, seatH - 0.12 - legH, 48), fab, { pos: [0, legH + (seatH - 0.12 - legH) / 2, 0] });
  const prof = [];
  for (let i = 0; i <= 14; i++) { const t2 = i / 14; prof.push([Math.max(0.001, sr * Math.sin(t2 * Math.PI / 2) ** 0.35), 0.12 * (1 - Math.cos(t2 * Math.PI)) / 2]); }
  const cush = lathe(prof.map(([rr, y]) => [rr, y]).concat([[0.001, 0.13]]), 48);
  b.add(cush, fab, { pos: [0, seatH - 0.12, 0.02] });
  addLegs(b, c, { type: 'wood-taper', w: R * 1.3, d: R * 1.3, top: legH, inset: 0, mat: legMat });
  return { group: b.build('armchair'), anchors: { seat: V3(0, seatH, 0.05) } };
}

/** Mid-century lounge chair: exposed wooden side frames, paddle armrests, loose seat + channelled back cushions. */
function woodFrameChair(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const wood = c.mat(p.frame || p.wood || 'walnut-dark');
  const fab = fabricMat(c, p.fabric || 'leather', p.fabricColor || p.color);
  const seatH = clamp(cm(p.seatHeight, 0.41), 0.34, 0.46);
  const armY = clamp(cm(p.armHeight, seatH + 0.17), seatH + 0.1, H - 0.1);
  const legR = 0.019, armW = 0.055, armT = 0.026;
  const sx = W / 2 - armW / 2;
  const zF = D / 2 - 0.07, zB = -D / 2 + 0.12;
  for (const s of [-1, 1]) {
    const x = s * sx;
    // front leg (slight splay) up to the armrest
    const fl = roundLeg(legR, legR * 0.7, armY - armT, 14); fl.rotateZ(-s * 0.03);
    b.add(fl, wood, { pos: [x, armY - armT, zF], axis: 'y' });
    // rear leg raked backwards
    const rl = roundLeg(legR, legR * 0.7, armY - armT + 0.01, 14); rl.rotateX(0.16); rl.rotateZ(-s * 0.03);
    b.add(rl, wood, { pos: [x, armY - armT, zB + 0.02], axis: 'y' });
    // paddle armrest (wider at the front)
    b.add(softBox(armW, armT, D - 0.06, { r: 0.011, seg: 3 }), wood, { pos: [x, armY - armT / 2, 0.0], axis: 'z' });
    // side stretcher at seat-frame height
    b.add(softBox(0.026, 0.05, zF - zB, { r: 0.006, seg: 2 }), wood, { pos: [x, seatH - 0.12, (zF + zB) / 2], axis: 'z' });
  }
  // front/back seat rails
  b.add(softBox(2 * sx, 0.05, 0.026, { r: 0.006, seg: 2 }), wood, { pos: [0, seatH - 0.12, zF] });
  b.add(softBox(2 * sx, 0.05, 0.026, { r: 0.006, seg: 2 }), wood, { pos: [0, seatH - 0.1, zB] });
  // seat cushion (slight backwards tilt)
  const cw = 2 * sx - armW - 0.01;
  const st = 0.11;
  b.add(softBox(cw, st, zF - zB + 0.05, { r: 0.03, seg: 4, cell: 0.06, bulge: { top: 0.012, front: 0.008 }, wrinkle: 0.0015, seed: c.seed }), fab, { pos: [0, seatH - st / 2 + 0.01, (zF + zB) / 2 + 0.02], rot: [-0.06, 0, 0] });
  // back: raked frame posts + channelled cushion
  const rake = 0.32;
  const bh = H - seatH - 0.02;
  const zBack = zB - 0.03;
  for (const s of [-1, 1]) {
    const g = roundLeg(0.016, 0.014, bh + 0.05, 12); g.rotateX(-rake);
    b.add(g, wood, { pos: [s * (cw / 2 + 0.01), H - 0.01, zBack - (bh) * Math.sin(rake) + 0.02], axis: 'y' });
  }
  const nCh = 3, chH = bh / nCh;
  for (let i = 0; i < nCh; i++) {
    const t = (i + 0.5) / nCh;
    const y = seatH + 0.02 + t * bh * Math.cos(rake);
    const z = zBack + 0.07 - t * bh * Math.sin(rake);
    b.add(softBox(cw - 0.01, chH + 0.006, 0.085, { r: 0.03, seg: 4, cell: 0.06, bulge: { front: 0.015, back: 0.004 }, wrinkle: 0.001, seed: c.seed + i }), fab, { pos: [0, y, z], rot: [-rake, 0, 0] });
  }
  return { group: b.build('armchair'), anchors: { seat: V3(0, seatH, 0.05) } };
}

// ---------------------------------------------------------------- dining chair

export function diningChair(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const frameKey = p.frame || p.legMaterial || 'walnut-dark';
  const wood = c.mat(frameKey);
  const metalFrame = isMetal(frameKey);
  const seatMatKey = p.seat || 'fabric-boucle';
  const seatIsWood = /walnut|oak|wood|teak|ash/.test(seatMatKey);
  const seatMat = seatIsWood ? c.mat(seatMatKey) : /rattan|cane/.test(seatMatKey) ? c.mat('rattan') : fabricMat(c, seatMatKey, p.seatColor || '#E8E1D5');
  const back = String(p.back || 'curved').toLowerCase();
  const seatH = clamp(cm(p.seatHeight, 0.465), 0.42, 0.5);
  const seatT = seatIsWood ? 0.025 : 0.055;
  const frameTop = seatH - seatT;
  const legR = metalFrame ? 0.011 : 0.017;
  const inset = 0.03;
  const lx = W / 2 - inset - legR, lzF = D / 2 - inset - legR, lzB = -D / 2 + inset + legR;
  const apronH = 0.05;
  // legs
  for (const s of [-1, 1]) {
    b.add(roundLeg(legR, legR * 0.72, frameTop, 14), wood, { pos: [s * lx, frameTop, lzF], rot: [0.04, 0, -s * 0.03], axis: 'y' });
    b.add(roundLeg(legR, legR * 0.72, frameTop, 14), wood, { pos: [s * lx, frameTop, lzB], rot: [-0.08, 0, -s * 0.03], axis: 'y' });
  }
  // apron (seat frame)
  const aW = 2 * lx, aD = lzF - lzB;
  b.add(softBox(aW + 0.006, apronH, 0.02, { r: 0.004, seg: 2 }), wood, { pos: [0, frameTop - apronH / 2, lzF] });
  b.add(softBox(aW + 0.006, apronH, 0.02, { r: 0.004, seg: 2 }), wood, { pos: [0, frameTop - apronH / 2, lzB] });
  for (const s of [-1, 1]) b.add(softBox(0.02, apronH, aD, { r: 0.004, seg: 2 }), wood, { pos: [s * lx, frameTop - apronH / 2, (lzF + lzB) / 2], axis: 'z' });
  // stretchers
  if (!metalFrame) for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.008, 0.008, aD, 10).rotateX(Math.PI / 2), wood, { pos: [s * (lx - 0.004), 0.16, (lzF + lzB) / 2], axis: 'z' });
  // seat
  const seatW = W - 0.01, seatD = D - 0.03;
  if (seatIsWood) b.add(softBox(seatW, seatT, seatD, { r: 0.01, seg: 3 }), seatMat, { pos: [0, frameTop + seatT / 2, 0.01] });
  else b.add(softBox(seatW, seatT, seatD, { r: 0.022, seg: 4, cell: 0.05, bulge: { top: 0.012, front: 0.004 }, seed: c.seed }), seatMat, { pos: [0, frameTop + seatT / 2, 0.01] });

  // back
  const backTop = H;
  if (back.includes('curv') || back.includes('bent') || back.includes('round')) {
    // back legs continue up as raked posts; a bent-wood crest rail wraps around their tops
    const rake = 0.13;
    const postLen = (backTop - frameTop) / Math.cos(rake);
    const railH = clamp(cm(p.backHeight, 0.11), 0.06, 0.22);
    const zTop = lzB - (backTop - frameTop) * Math.tan(rake);
    for (const s of [-1, 1]) {
      const g = roundLeg(legR * 0.9, legR * 0.85, postLen - 0.01, 12);
      g.rotateX(-rake);
      b.add(g, wood, { pos: [s * lx, backTop - 0.01, zTop], axis: 'y' });
    }
    const R = W * 0.78, ang = 2 * Math.asin(Math.min(0.99, (lx + 0.03) / R));
    const t = 0.016;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, R + t, Math.PI / 2 - ang / 2, Math.PI / 2 + ang / 2, false);
    shape.absarc(0, 0, R, Math.PI / 2 + ang / 2, Math.PI / 2 - ang / 2, true);
    const g = new THREE.ExtrudeGeometry(shape, { depth: railH, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 32 });
    g.rotateX(-Math.PI / 2); // shape y → −z, extrude → +y
    // arc ends must meet the posts: post top at (±lx, zTop); arc point at angle with x = lx → z offset
    const zEnd = -Math.sqrt(Math.max(0, R * R - lx * lx));
    const zc = zTop - 0.012 - zEnd; // centre so that arc ends sit just in front of the posts
    b.add(g, back.includes('uphol') ? seatMat : wood, { pos: [0, backTop - railH - 0.006, zc], axis: 'x' });
    if (/y-splat|wishbone|splat/.test(String(p.backStyle || ''))) {
      // Y-shaped splat: two arms from the crest rail meeting in a stem down to the seat back
      const zMid = zc - R - 0.004, yRail = backTop - railH - 0.004, yFork = seatH + (yRail - seatH) * 0.45;
      const zAt = (y) => lzB - (y - frameTop) * Math.tan(rake) + 0.005;
      for (const s of [-1, 1]) b.add(tube([V3(s * 0.07, yRail + 0.005, zMid + 0.01), V3(s * 0.035, (yRail + yFork) / 2, zAt((yRail + yFork) / 2) - 0.03), V3(0, yFork, zAt(yFork) - 0.02)], 0.011, { tubular: 16, radial: 8 }), wood, { uv: 'box', axis: 'y' });
      b.add(softBox(0.05, yFork - seatH + 0.02, 0.016, { r: 0.007, seg: 2 }), wood, { pos: [0, (yFork + seatH) / 2, zAt((yFork + seatH) / 2) - 0.02], rot: [-rake, 0, 0], axis: 'y' });
    }
  } else if (back.includes('cane') || back.includes('rattan') || back.includes('frame')) {
    // raked posts + top/bottom rails framing a cane (or upholstered) panel
    const rake = 0.1;
    const postLen = (backTop - frameTop) / Math.cos(rake);
    const zTop = lzB - (backTop - frameTop) * Math.tan(rake);
    for (const s of [-1, 1]) { const g = roundLeg(legR * 0.9, legR * 0.85, postLen, 12); g.rotateX(-rake); b.add(g, wood, { pos: [s * lx, backTop, zTop], axis: 'y' }); }
    const ph = clamp(backTop - seatH - 0.12, 0.15, 0.35);
    const yTop = backTop - 0.03, yBot = yTop - ph;
    const zAt = (y) => lzB - (y - frameTop) * Math.tan(rake);
    b.add(softBox(2 * lx, 0.045, 0.022, { r: 0.008, seg: 2 }), wood, { pos: [0, yTop, zAt(yTop)], rot: [-rake, 0, 0] });
    b.add(softBox(2 * lx, 0.03, 0.02, { r: 0.006, seg: 2 }), wood, { pos: [0, yBot, zAt(yBot)], rot: [-rake, 0, 0] });
    const panel = back.includes('cane') || back.includes('rattan') ? c.mat('cane', p.caneColor ? { color: p.caneColor } : undefined) : seatMat;
    b.add(new THREE.PlaneGeometry(2 * lx - 0.02, ph - 0.03), panel, { pos: [0, (yTop + yBot) / 2, zAt((yTop + yBot) / 2)], rot: [-rake, 0, 0] });
  } else if (back.includes('spindle') || back.includes('slat')) {
    const postH = backTop - frameTop;
    for (const s of [-1, 1]) b.add(roundLeg(legR * 0.9, legR * 0.8, postH, 12), wood, { pos: [s * lx, backTop, lzB - 0.03], rot: [-0.1, 0, 0], axis: 'y' });
    b.add(softBox(2 * lx + 0.03, 0.06, 0.022, { r: 0.008, seg: 2 }), wood, { pos: [0, backTop - 0.035, lzB - 0.06], rot: [-0.1, 0, 0] });
    const n = back.includes('slat') ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const x = -lx + (2 * lx) * ((i + 1) / (n + 1));
      if (back.includes('slat')) b.add(softBox(0.05, 0.035, 0.014, { r: 0.004, seg: 1 }), wood, { pos: [0, frameTop + 0.12 + i * 0.09, lzB - 0.03 - i * 0.008], rot: [-0.1, 0, 0] });
      else b.add(roundLeg(0.006, 0.006, postH - 0.08, 8), wood, { pos: [x, backTop - 0.06, lzB - 0.035], rot: [-0.1, 0, 0], axis: 'y' });
    }
  } else {
    // upholstered / straight panel back
    const bh = backTop - seatH - 0.05;
    for (const s of [-1, 1]) b.add(roundLeg(legR * 0.9, legR * 0.8, backTop - frameTop - 0.04, 12), wood, { pos: [s * lx, backTop - 0.04, lzB - 0.02], rot: [-0.08, 0, 0], axis: 'y' });
    const shell = /shell|round/.test(String(p.backShape || ''));
    const bg = softBox(W - 0.04, bh, 0.05, { r: shell ? 0.024 : 0.02, seg: 4, cell: 0.05, bulge: { front: 0.01, back: 0.006, top: shell ? 0.02 : 0 }, seed: c.seed + 2 });
    if (shell) { const pa = bg.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i) / (W / 2); pa.setZ(i, pa.getZ(i) + 0.07 * x * x); const y = pa.getY(i) / (bh / 2); pa.setX(i, pa.getX(i) * (1 - 0.06 * Math.max(0, y))); } bg.computeVertexNormals(); }
    b.add(bg, seatMat, { pos: [0, seatH + 0.05 + bh / 2, lzB - 0.03], rot: [-0.1, 0, 0] });
  }
  // armrests (carver chair): extended front posts + flat arms running back to the back posts
  if (p.arms === true || p.arms === 'true') {
    const armY = seatH + 0.2;
    for (const s of [-1, 1]) {
      b.add(roundLeg(legR * 0.85, legR * 0.85, armY - frameTop, 12), wood, { pos: [s * lx, armY, lzF - 0.01], axis: 'y' });
      b.add(softBox(0.04, 0.022, lzF - lzB + 0.06, { r: 0.009, seg: 2 }), wood, { pos: [s * (lx + 0.004), armY + 0.006, (lzF + lzB) / 2 - 0.01], axis: 'z' });
    }
  }
  return { group: b.build('dining_chair'), anchors: { seat: V3(0, seatH, 0) } };
}

// ---------------------------------------------------------------- throw cushions

export function cushions(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const n = clamp(Math.round(p.count || 2), 1, 7);
  const colors = p.colors && p.colors.length ? p.colors : [c.item?.colorHex || '#d9cdb8'];
  const fabrics = p.fabrics || [];
  const sizes = p.sizes || [];
  const hostW = c.host?.w || 1.8;
  const lean = 0.2;
  // arrangement: alternate ends of the seat, larger ones behind
  const slots = [];
  if (n === 1) slots.push(-hostW * 0.33);
  else if (n === 2) slots.push(-hostW * 0.36, hostW * 0.36);
  else {
    const left = Math.ceil(n / 2), right = n - left;
    for (let i = 0; i < left; i++) slots.push(-hostW / 2 + 0.26 + i * 0.3);
    for (let i = 0; i < right; i++) slots.push(hostW / 2 - 0.26 - i * 0.3);
  }
  for (let i = 0; i < n; i++) {
    const sz = sizes[i];
    const sw = Array.isArray(sz) ? sz[0] : sz && typeof sz === 'object' ? sz.w : sz;
    const sh = Array.isArray(sz) ? sz[1] ?? sz[0] : sz && typeof sz === 'object' ? sz.h ?? sz.w : sz;
    const cw = sz != null ? clamp(cm(sw, W), 0.25, 0.7) : W * (i % 3 === 2 ? 0.9 : 1);
    const ch = sz != null ? clamp(cm(sh, H), 0.2, 0.7) : H * (i % 3 === 2 ? 0.9 : 1);
    const t = Math.max(0.1, D);
    const fab = fabricMat(c, fabrics[i] || (p.fabric === 'mixed' ? 'linen' : p.fabric) || 'linen', colors[i % colors.length]);
    const g = pillowGeometry(cw, ch, t * 1.25, { n: 18, pinch: 0.11, plump: 0.42, sag: 0.04, seed: c.seed + i * 7, squash: 0.6 });
    const x = slots[i];
    const second = (n >= 3) && (i === 1 || i === Math.ceil(n / 2) + 1);
    const yaw = (x < 0 ? 1 : -1) * (0.12 + (i % 2) * 0.08);
    const z = second ? 0.06 : 0;
    const roll = (x < 0 ? -1 : 1) * 0.05 * (i % 2 ? 1 : -1);
    b.add(g, fab, { pos: [x, ch / 2 * Math.cos(lean) + 0.0, z - Math.sin(lean) * ch / 2 + 0.02], rot: [-lean, yaw, roll], uv: 'box' });
  }
  return { group: b.build('cushions') };
}
