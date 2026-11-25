// Villar furniture — tables & case goods. Owner: modeler.
import * as THREE from 'three';
import { Builder, softBox, roundLeg, squareLeg, lathe, smoothProfile, slab, roundedRectShape, ellipseShape, superellipseShape, tube, V3, clamp, cm } from './geom.js';
import { addLegs, addHandle, addFlutes, addSlats, isMetal } from './parts.js';

function topShape(shape, W, D) {
  const s = String(shape || 'rect').toLowerCase();
  if (s.includes('round') || s.includes('circle')) return { shape: ellipseShape(W, D), round: true };
  if (s.includes('oval') || s.includes('ellip')) return { shape: W / D > 1.25 ? superellipseShape(W, D, 2.4) : ellipseShape(W, D), round: true };
  if (s.includes('organic') || s.includes('pebble')) return { shape: pebbleShape(W, D), round: true };
  if (s.includes('squircle') || s.includes('soft')) return { shape: superellipseShape(W, D, 4), round: true };
  return { shape: roundedRectShape(W, D, Math.min(0.02, Math.min(W, D) * 0.05)), round: false };
}

function pebbleShape(W, D) {
  const s = new THREE.Shape();
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const t = i / n * Math.PI * 2;
    const r = 1 + 0.06 * Math.sin(2 * t + 0.7) + 0.04 * Math.sin(3 * t + 2.1);
    const x = Math.cos(t) * W / 2 * r * 0.94, y = Math.sin(t) * D / 2 * r * 0.94;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  return s;
}

/** Shared table builder: top + base. */
function table(c, kind) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const topKey = p.top || p.wood || 'walnut-dark';
  const topMat = c.mat(topKey);
  const legKey = p.legMaterial || (String(p.legs || '').includes('metal') ? 'metal-black' : topKey);
  const legMat = c.mat(legKey);
  const isStone = /marble|travert|stone|quartz|glass/.test(topKey);
  const tt = clamp(cm(p.topThickness, isStone ? 0.025 : kind === 'dining' ? 0.034 : 0.03), 0.012, 0.06);
  const { shape, round } = topShape(p.shape, W, D);
  b.add(slab(shape, tt, { bevel: Math.min(0.006, tt / 3), bevelSeg: 3, curveSeg: 64 }), topMat, { pos: [0, H - tt, 0], uv: 'box', axis: 'x' });
  const under = H - tt;
  const legs = String(p.legs || (round ? 'pedestal' : 'wood-taper')).toLowerCase();
  const fluted = p.fluted || legs.includes('flut');

  if (legs.includes('pedestal') || legs.includes('drum') || legs.includes('column') || legs.includes('tulip') || legs.includes('cylinder')) {
    const rBase = Math.min(W, D) * (kind === 'side' ? 0.36 : legs.includes('drum') ? 0.4 : 0.3);
    if (legs.includes('tulip')) {
      const prof = smoothProfile([[0.001, 0], [rBase * 1.0, 0.0], [rBase * 0.95, 0.012], [rBase * 0.22, under * 0.12], [rBase * 0.16, under * 0.6], [rBase * 0.5, under * 0.96], [rBase * 0.55, under], [0.001, under]], 50);
      b.add(lathe(prof, 48), legMat, { uv: 'cyl' });
    } else if (kind === 'side' && !legs.includes('drum')) {
      const rc = Math.min(0.045, rBase * 0.3);
      b.add(new THREE.CylinderGeometry(rc, rc, under - 0.02, 32), legMat, { pos: [0, under / 2, 0], axis: 'y' });
      b.add(slab(ellipseShape(rBase * 2, rBase * 2), 0.02, { bevel: 0.006 }), legMat, { pos: [0, 0, 0], axis: 'x' });
    } else {
      // drum / trumpet pedestal (optionally fluted)
      const isDrum = legs.includes('drum');
      const rc = isDrum ? Math.min(W, D) * 0.4 : Math.min(W, D) * (kind === 'dining' ? 0.115 : 0.25);
      const foot = kind === 'dining' && !isDrum ? Math.min(W, D) * 0.34 : 0;
      if (fluted) {
        const n = Math.max(16, Math.round((2 * Math.PI * rc) / 0.03));
        b.add(new THREE.CylinderGeometry(rc * 0.94, rc * 0.94, under - 0.03, 48), legMat, { pos: [0, under / 2 + 0.005, 0], axis: 'y' });
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const fr = (Math.PI * rc) / n;
          b.add(new THREE.CylinderGeometry(fr, fr, under - 0.03, 8, 1, true), legMat, { pos: [Math.cos(a) * rc * 0.94, under / 2 + 0.005, Math.sin(a) * rc * 0.94], axis: 'y' });
        }
        b.add(new THREE.CylinderGeometry(rc * 0.9, rc * 0.9, 0.012, 40), c.mat('metal-black', { color: '#1d1a18' }), { pos: [0, 0.006, 0] });
      } else if (foot) {
        // trumpet: column flaring into a low disc foot
        const prof = smoothProfile([[0.001, 0], [foot, 0], [foot, 0.012], [foot * 0.92, 0.024], [rc * 1.9, 0.05], [rc * 1.15, under * 0.22], [rc, under * 0.5], [rc * 1.05, under - 0.03], [rc * 1.5, under - 0.004], [0.001, under - 0.004]], 60);
        b.add(lathe(prof, 64), legMat, { uv: 'cyl' });
      } else {
        const prof = smoothProfile([[0.001, 0.012], [rc * 0.97, 0.012], [rc, 0.03], [rc * 0.95, under * 0.5], [rc, under - 0.012], [rc * 0.97, under], [0.001, under]], 40);
        b.add(lathe(prof, 72), legMat, { uv: 'cyl' });
        // recessed shadow-gap plinth
        b.add(new THREE.CylinderGeometry(rc * 0.9, rc * 0.9, 0.012, 48), c.mat('metal-black', { color: '#1d1a18' }), { pos: [0, 0.006, 0] });
      }
    }
  } else if (legs.includes('tripod') || legs.includes('three')) {
    const n = 3, r0 = Math.min(W, D) * 0.18, r1 = Math.min(W, D) * 0.42;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 2;
      const top = V3(Math.cos(a) * r0, under, Math.sin(a) * r0), bot = V3(Math.cos(a) * r1, 0, Math.sin(a) * r1);
      const len = top.distanceTo(bot);
      const g = isMetal(legKey) ? new THREE.CylinderGeometry(0.008, 0.008, len, 12) : new THREE.CylinderGeometry(0.016, 0.011, len, 14);
      const m = new THREE.Matrix4().lookAt(top, bot, V3(0, 1, 0));
      g.rotateX(Math.PI / 2);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(m)));
      g.translate((top.x + bot.x) / 2, under / 2, (top.z + bot.z) / 2);
      b.add(g, legMat, { uv: 'box', axis: 'y' });
    }
    if (isMetal(legKey)) b.add(new THREE.TorusGeometry(r0 * 1.0, 0.006, 8, 40).rotateX(Math.PI / 2), legMat, { pos: [0, under - 0.008, 0] });
    if (p.shelf) b.add(slab(ellipseShape(r1 * 1.3, r1 * 1.3), 0.015), topMat, { pos: [0, under * 0.35, 0] });
  } else if (legs.includes('sled') || legs.includes('u-') || legs.includes('frame')) {
    for (const s of [-1, 1]) {
      const x = s * (W / 2 - 0.08);
      const pts = [V3(x, under - 0.005, -D / 2 + 0.07), V3(x, 0.006, -D / 2 + 0.07), V3(x, 0.006, D / 2 - 0.07), V3(x, under - 0.005, D / 2 - 0.07)];
      b.add(tube(pts, 0.009, { tubular: 60, radial: 8, tension: 0.05 }), legMat, { axis: 'y' });
    }
  } else if (legs.includes('trestle') || legs.includes('panel') || legs.includes('slab')) {
    for (const s of [-1, 1]) b.add(softBox(0.04, under, D * 0.8, { r: 0.006, seg: 2 }), legMat, { pos: [s * (W / 2 - W * 0.15), under / 2, 0], axis: 'y' });
    b.add(softBox(W * 0.7 - 0.04, 0.05, 0.03, { r: 0.004, seg: 1 }), legMat, { pos: [0, under * 0.25, 0] });
  } else if (legs.includes('plinth') || legs.includes('block') || legs.includes('box')) {
    const { shape: s2 } = topShape(p.shape, W * 0.72, D * 0.72);
    b.add(slab(s2, under, { bevel: 0.004 }), legMat, { axis: 'y' });
  } else {
    // four legs (wood taper, hairpin, metal square, x-base…)
    const inset = round ? Math.min(W, D) * 0.2 : 0.06;
    const lx = round ? (W / 2) * 0.62 : W / 2 - inset, lz = round ? (D / 2) * 0.62 : D / 2 - inset;
    addLegs(b, c, { type: legs, w: lx * 2, d: lz * 2, top: under, inset: 0, mat: legMat, metalMat: c.mat(isMetal(legKey) ? legKey : 'metal-black'), splay: legs.includes('splay') ? 0.08 : 0.0 });
    if (!legs.includes('hairpin') && !round && kind !== 'coffee') {
      // apron
      const ah = kind === 'dining' ? 0.07 : 0.05;
      b.add(softBox(W - 2 * inset - 0.01, ah, 0.02, { r: 0.003, seg: 1 }), legMat, { pos: [0, under - ah / 2, D / 2 - inset] });
      b.add(softBox(W - 2 * inset - 0.01, ah, 0.02, { r: 0.003, seg: 1 }), legMat, { pos: [0, under - ah / 2, -D / 2 + inset] });
      for (const s of [-1, 1]) b.add(softBox(0.02, ah, D - 2 * inset - 0.01, { r: 0.003, seg: 1 }), legMat, { pos: [s * (W / 2 - inset), under - ah / 2, 0], axis: 'z' });
    }
    if (p.shelf && kind !== 'dining') b.add(slab(topShape(p.shape, lx * 2 + 0.02, lz * 2 + 0.02).shape, 0.018, { bevel: 0.004 }), topMat, { pos: [0, under * 0.3, 0] });
  }
  return { group: b.build(kind + '_table'), anchors: { top: V3(0, H, 0) }, anchorInfo: { top: { w: W, d: D } } };
}

export function coffeeTable(c) { return table(c, 'coffee'); }
export function sideTable(c) { return table(c, 'side'); }
export function diningTable(c) { return table(c, 'dining'); }

// ---------------------------------------------------------------- case goods

/**
 * Cabinet body with fronts. layout = array of columns, each { w (fraction), cells: [{ type:'drawer'|'door'|'open', h (fraction) }] }.
 */
function cabinet(c, { W, D, H, layout, legType, woodKey, handles, front = 'flat', name, top = null }) {
  const b = new Builder(c.seed);
  const wood = c.mat(woodKey);
  const dark = c.mat('walnut-dark', { tint: '#5a4a40' });
  const legH = legType === 'none' ? 0 : String(legType).includes('plinth') ? 0.06 : clamp(H * 0.26, 0.1, 0.2);
  const bodyH = H - legH;
  const panelT = 0.018, reveal = 0.003, frontT = 0.018;
  const bodyD = D - frontT;
  const bz = -D / 2 + bodyD / 2;
  // carcass: top, bottom, sides, back as one soft box slightly inset
  b.add(softBox(W, panelT, bodyD + frontT, { r: 0.004, seg: 2 }), top ? c.mat(top) : wood, { pos: [0, H - panelT / 2, 0] });
  b.add(softBox(W, panelT, bodyD, { r: 0.003, seg: 1 }), wood, { pos: [0, legH + panelT / 2, bz] });
  for (const s of [-1, 1]) b.add(softBox(panelT, bodyH - panelT, bodyD + frontT, { r: 0.003, seg: 2 }), wood, { pos: [s * (W / 2 - panelT / 2), legH + (bodyH - panelT) / 2, 0], axis: 'y' });
  b.add(new THREE.BoxGeometry(W - 2 * panelT, bodyH - 2 * panelT, 0.006), dark, { pos: [0, legH + bodyH / 2, -D / 2 + 0.01] });
  // inner shadow volume behind reveals
  b.add(new THREE.BoxGeometry(W - 2 * panelT, bodyH - 2 * panelT, 0.004), dark, { pos: [0, legH + bodyH / 2, D / 2 - frontT - 0.004] });
  // fronts
  const fx0 = -W / 2 + panelT, fw = W - 2 * panelT;
  const fy0 = legH + panelT, fh = bodyH - 2 * panelT;
  const zf = D / 2 - frontT / 2;
  const totalW = layout.reduce((s, col) => s + col.w, 0);
  let x = fx0;
  const handleMat = c.mat(/brass|gold/.test(handles) ? 'metal-brass' : /black/.test(handles) ? 'metal-black' : 'metal-brass');
  layout.forEach((col, ci) => {
    const cw = (col.w / totalW) * fw;
    const totalH = col.cells.reduce((s, ce) => s + ce.h, 0);
    let y = fy0 + fh;
    col.cells.forEach((cell) => {
      const ch = (cell.h / totalH) * fh;
      const cx = x + cw / 2, cy = y - ch / 2;
      const w = cw - reveal * 2, h = ch - reveal * 2;
      if (cell.type === 'open') {
        b.add(softBox(cw, 0.012, bodyD - 0.02, { r: 0.002, seg: 1 }), wood, { pos: [cx, y - ch + 0.006, bz] });
      } else {
        if (front === 'fluted' && cell.type === 'door') {
          b.add(new THREE.BoxGeometry(w, h, frontT * 0.6), wood, { pos: [cx, cy, zf - frontT * 0.2] });
          addFlutes(b, wood, { cx, cy, z: zf + frontT * 0.1, w, h, pitch: 0.026, depth: 0.007 });
        } else if (front === 'slatted' && cell.type === 'door') {
          b.add(new THREE.BoxGeometry(w, h, frontT * 0.5), dark, { pos: [cx, cy, zf - frontT * 0.25] });
          addSlats(b, wood, { cx, cy, z: zf - frontT * 0.1, w, h, pitch: 0.04, slatW: 0.026, depth: 0.014 });
        } else if (front === 'cane' && cell.type === 'door') {
          // wooden frame door with a Vienna-cane insert over a dark backing
          const fr = Math.min(0.045, w * 0.12);
          b.add(softBox(w, fr, frontT, { r: 0.0025, seg: 2 }), wood, { pos: [cx, cy + h / 2 - fr / 2, zf] });
          b.add(softBox(w, fr, frontT, { r: 0.0025, seg: 2 }), wood, { pos: [cx, cy - h / 2 + fr / 2, zf] });
          b.add(softBox(fr, h - 2 * fr + 0.001, frontT, { r: 0.0025, seg: 2 }), wood, { pos: [cx - w / 2 + fr / 2, cy, zf], axis: 'y' });
          b.add(softBox(fr, h - 2 * fr + 0.001, frontT, { r: 0.0025, seg: 2 }), wood, { pos: [cx + w / 2 - fr / 2, cy, zf], axis: 'y' });
          b.add(new THREE.PlaneGeometry(w - 2 * fr + 0.004, h - 2 * fr + 0.004), c.mat('cane'), { pos: [cx, cy, zf + 0.002] });
          b.add(new THREE.BoxGeometry(w - 2 * fr, h - 2 * fr, 0.004), dark, { pos: [cx, cy, zf - frontT / 2 + 0.002] });
        } else {
          b.add(softBox(w, h, frontT, { r: 0.0025, seg: 2 }), wood, { pos: [cx, cy, zf] });
        }
        // handle
        const ht = handles || 'none';
        if (ht === 'cutout' || ht === 'none' || ht === 'push') {
          if (ht === 'cutout' || (ht === 'none' && cell.type === 'drawer')) {
            // finger groove: dark slot at top of the front
            b.add(new THREE.BoxGeometry(Math.min(0.14, w * 0.4), 0.012, 0.004), dark, { pos: [cx, y - reveal - 0.012, zf + frontT / 2 + 0.0005] });
          }
        } else if (cell.type === 'drawer') addHandle(b, c, ht, { x: cx, y: cy + (ht.includes('knob') ? 0 : h * 0.15), z: zf + frontT / 2, w: Math.min(0.16, w * 0.4), mat: handleMat });
        else addHandle(b, c, ht, { x: ci < layout.length / 2 ? cx + w / 2 - 0.04 : cx - w / 2 + 0.04, y: cy + h * 0.2, z: zf + frontT / 2, w: 0.14, vertical: true, mat: handleMat });
      }
      y -= ch;
    });
    // column divider
    if (ci < layout.length - 1) b.add(new THREE.BoxGeometry(panelT, fh, bodyD - 0.02), wood, { pos: [x + cw, fy0 + fh / 2, bz] });
    x += cw;
  });
  // legs
  if (String(legType).includes('plinth')) b.add(softBox(W - 0.06, legH, D - 0.06, { r: 0.003, seg: 1 }), dark, { pos: [0, legH / 2, -0.01] });
  else if (legH > 0) addLegs(b, c, { type: legType, w: W, d: D, top: legH, inset: 0.045, mat: wood, metalMat: c.mat('metal-black') });
  return { group: b.build(name), anchors: { top: V3(0, H, 0) }, anchorInfo: { top: { w: W, d: D } } };
}

export function nightstand(c) {
  const { W, D, H, params: p } = c;
  const drawers = clamp(Math.round(p.drawers ?? 2), 0, 4);
  const cells = [];
  if (p.open || p.shelf) cells.push({ type: 'open', h: 1 });
  for (let i = 0; i < drawers; i++) cells.push({ type: 'drawer', h: 1 });
  if (!cells.length) cells.push({ type: 'door', h: 1 });
  return cabinet(c, { W, D, H, layout: [{ w: 1, cells }], legType: p.legs || 'wood-taper', woodKey: p.wood || p.frame || 'walnut-dark', handles: p.handles || 'none', front: p.front || (p.fluted ? 'fluted' : 'flat'), name: 'nightstand', top: p.top || null });
}

export function tvUnit(c) {
  const { W, D, H, params: p } = c;
  const doors = clamp(Math.round(p.doors ?? 2), 0, 4);
  const drawers = clamp(Math.round(p.drawers ?? 0), 0, 4);
  const open = p.open ?? (doors + drawers === 0);
  const cols = [];
  const half = Math.ceil(doors / 2);
  for (let i = 0; i < half; i++) cols.push({ w: 1, cells: [{ type: 'door', h: 1 }] });
  if (drawers > 0) {
    const n = drawers;
    if (W / (doors + 1) > 0.45 || n <= 2) cols.push({ w: 1, cells: Array.from({ length: n }, () => ({ type: 'drawer', h: 1 })) });
  }
  if (open) cols.push({ w: 1, cells: [{ type: 'open', h: 1 }, { type: 'open', h: 1 }] });
  for (let i = half; i < doors; i++) cols.push({ w: 1, cells: [{ type: 'door', h: 1 }] });
  if (!cols.length) cols.push({ w: 1, cells: [{ type: 'open', h: 1 }] });
  const front = p.front || (p.fluted ? 'fluted' : p.slatted ? 'slatted' : 'flat');
  return cabinet(c, { W, D, H, layout: cols, legType: p.legs || 'wood-taper', woodKey: p.wood || 'walnut-dark', handles: p.handles || 'none', front, name: 'tv_unit', top: p.top || null });
}
