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
  const topCol = p.topColor || null;
  const topMat = c.mat(topKey, topCol ? (/ceram|paint|lacq|kitchen/.test(topKey) ? { color: topCol } : { match: topCol }) : undefined);
  const legKey = p.legMaterial || (String(p.legs || '').includes('metal') ? 'metal-black' : topKey);
  const legMat = c.mat(legKey, p.legColor ? (isMetal(legKey) || /ceram/.test(legKey) ? { color: p.legColor } : { match: p.legColor }) : undefined);
  const isStone = /marble|travert|stone|quartz|glass/.test(topKey);
  const tt = clamp(cm(p.topThickness, isStone ? 0.025 : kind === 'dining' ? 0.034 : 0.03), 0.012, 0.06);
  const { shape, round } = topShape(p.shape, W, D);
  b.add(slab(shape, tt, { bevel: Math.min(0.006, tt / 3), bevelSeg: 3, curveSeg: 64 }), topMat, { pos: [0, H - tt, 0], uv: 'box', axis: 'x' });
  const under = H - tt;
  const legs = String(p.legs || (round ? 'pedestal' : 'wood-taper')).toLowerCase();
  const ps = String(p.pedestalStyle || '').toLowerCase();
  const fluted = p.fluted || legs.includes('flut') || ps.includes('flut');

  if (legs.includes('pedestal') && ps && !ps.includes('drum') || ps.includes('slat')) {
    const R0 = Math.min(W, D);
    if (ps.includes('block')) {
      // square/soft block pedestal
      const bw = R0 * (kind === 'side' ? 0.36 : 0.34);
      b.add(softBox(bw, under, bw, { r: 0.01, seg: 3 }), legMat, { pos: [0, under / 2, 0], axis: 'y' });
    } else if (ps.includes('cone')) {
      // tapered cone, optionally fluted
      const rt = R0 * 0.16, rb = R0 * (kind === 'side' ? 0.34 : 0.3);
      if (fluted) {
        // fluted cone: lathe-like surface with scalloped (concave) flutes around
        const n = Math.max(14, Math.round((2 * Math.PI * rb) / 0.04));
        const segA = n * 6, segY = 8;
        const pos = [], idx = [];
        for (let j = 0; j <= segY; j++) {
          const t = j / segY, y = t * under, r0 = rb + (rt - rb) * t;
          for (let i = 0; i <= segA; i++) {
            const a = (i / segA) * Math.PI * 2;
            const f = (i % 6) / 6; const k = 1 - 0.07 * Math.sin(f * Math.PI);
            pos.push(Math.cos(a) * r0 * k, y, Math.sin(a) * r0 * k);
          }
        }
        const m = segA + 1;
        for (let j = 0; j < segY; j++) for (let i = 0; i < segA; i++) { const a = j * m + i, b2 = a + 1, c2 = a + m, d = c2 + 1; idx.push(a, c2, d, a, d, b2); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        b.add(g, legMat, { uv: 'cyl' });
        b.add(new THREE.CylinderGeometry(rb * 0.92, rb * 0.92, 0.01, 48), c.mat('metal-black', { color: '#1d1a18' }), { pos: [0, 0.005, 0] });
      } else b.add(new THREE.CylinderGeometry(rt, rb, under, 48), legMat, { pos: [0, under / 2, 0], uv: 'cyl' });
    } else if (ps.includes('ball') || ps.includes('turned') || ps.includes('bead')) {
      // stacked turned spheres
      const prof = [];
      const n = kind === 'side' ? 3 : 4; const rr = R0 * (kind === 'side' ? 0.2 : 0.17);
      prof.push([0.001, 0], [rr * 0.7, 0]);
      for (let i = 0; i < n; i++) {
        const y0 = (i / n) * under, y1 = ((i + 1) / n) * under;
        for (let k = 0; k <= 10; k++) { const t = k / 10; prof.push([Math.max(rr * 0.35, rr * Math.sin(t * Math.PI)), y0 + (y1 - y0) * t]); }
      }
      prof.push([rr * 0.6, under], [0.001, under]);
      b.add(lathe(prof, 48), legMat, { uv: 'cyl' });
    } else if (ps.includes('slat')) {
      // ring of vertical slats around a dark core, on a disc foot
      const rc = R0 * (kind === 'dining' ? 0.2 : 0.25), n = Math.max(12, Math.round((2 * Math.PI * rc) / 0.045));
      b.add(new THREE.CylinderGeometry(rc * 0.8, rc * 0.8, under, 32), c.mat('walnut-dark', { tint: '#3a2e26' }), { pos: [0, under / 2, 0] });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        b.add(softBox(0.03, under - 0.02, 0.022, { r: 0.006, seg: 2 }), legMat, { pos: [Math.cos(a) * rc, under / 2, Math.sin(a) * rc], rot: [0, -a + Math.PI / 2, 0], axis: 'y' });
      }
      if (kind === 'dining') b.add(slab(ellipseShape(rc * 2.6, rc * 2.6), 0.025, { bevel: 0.006 }), legMat, {});
    }
    return { group: b.build(kind + '_table'), anchors: { top: V3(0, H, 0) }, anchorInfo: { top: { w: W, d: D } } };
  }
  if (legs.includes('four-block') || (legs.includes('block') && p.legShape) || p.parsons) {
    // chunky legs: cylinders (legShape) or squares; parsons = flush with the top corners
    const cyl = String(p.legShape || '').includes('cyl');
    const lw = clamp(Math.min(W, D) * (p.parsons ? 0.07 : 0.11), 0.04, 0.12);
    const insetX = p.parsons ? lw / 2 : round ? W * 0.22 : lw / 2 + 0.06;
    const insetZ = p.parsons ? lw / 2 : round ? D * 0.22 : lw / 2 + 0.06;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (W / 2 - insetX), z = sz * (D / 2 - insetZ);
      if (cyl) b.add(new THREE.CylinderGeometry(lw / 2, lw / 2, under, 32), legMat, { pos: [x, under / 2, z], uv: 'cyl' });
      else b.add(softBox(lw, under, lw, { r: 0.004, seg: 2 }), legMat, { pos: [x, under / 2, z], axis: 'y' });
    }
    if (p.parsons) {
      const ah = 0.06;
      b.add(softBox(W - 0.004, ah, D - 0.004, { r: 0.003, seg: 1 }), legMat, { pos: [0, under - ah / 2, 0] });
    }
    return { group: b.build(kind + '_table'), anchors: { top: V3(0, H, 0) }, anchorInfo: { top: { w: W, d: D } } };
  }

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
  const p = c.params;
  const b = new Builder(c.seed);
  const wood = c.mat(woodKey);
  const frontWood = /herring|chevron/.test(front) ? c.mat(woodKey, { layout: 'chevron' }) : wood;
  const dark = c.mat('walnut-dark', { tint: '#5a4a40' });
  const lt = String(legType);
  const legH = lt === 'none' || lt.includes('hidden') ? 0 : lt.includes('plinth') ? clamp(cm(p.legHeight, 0.06), 0.03, 0.12) : clamp(cm(p.legHeight, H * 0.26), 0.04, 0.25);
  const legMat = p.legMaterial ? c.mat(p.legMaterial, p.legColor ? (isMetal(p.legMaterial) ? { color: p.legColor } : { match: p.legColor }) : undefined) : null;
  const bodyH = H - legH;
  const panelT = 0.018, reveal = 0.003, frontT = 0.018;
  const bodyD = D - frontT;
  const bz = -D / 2 + bodyD / 2;
  // carcass: top, bottom, sides, back as one soft box slightly inset
  b.add(softBox(W, panelT, bodyD + frontT, { r: 0.004, seg: 2 }), top ? c.mat(top) : wood, { pos: [0, H - panelT / 2, 0] });
  b.add(softBox(W, panelT, bodyD, { r: 0.003, seg: 1 }), wood, { pos: [0, legH + panelT / 2, bz] });
  for (const s of [-1, 1]) b.add(softBox(panelT, bodyH - panelT, bodyD + frontT, { r: 0.003, seg: 2 }), wood, { pos: [s * (W / 2 - panelT / 2), legH + (bodyH - panelT) / 2, 0], axis: 'y' });
  b.add(new THREE.BoxGeometry(W - 2 * panelT, bodyH - 2 * panelT, 0.006), dark, { pos: [0, legH + bodyH / 2, -D / 2 + 0.01] });

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
        b.add(softBox(cw, 0.014, bodyD - 0.02, { r: 0.002, seg: 1 }), wood, { pos: [cx, y - ch + 0.007, bz] });
        b.add(new THREE.BoxGeometry(cw, ch, 0.006), wood, { pos: [cx, cy, -D / 2 + 0.016] });
      } else {
        // dark shadow plane behind the reveals of closed fronts
        b.add(new THREE.BoxGeometry(cw, ch, 0.004), dark, { pos: [cx, cy, D / 2 - frontT - 0.004] });
        if (front === 'fluted') {
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
          b.add(softBox(w, h, frontT, { r: 0.0025, seg: 2 }), frontWood, { pos: [cx, cy, zf] });
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
  if (lt.includes('plinth')) b.add(softBox(W - 0.06, legH, D - 0.06, { r: 0.003, seg: 1 }), dark, { pos: [0, legH / 2, -0.01] });
  else if (legH > 0) addLegs(b, c, { type: legType, w: W, d: D, top: legH, inset: 0.045, mat: legMat || wood, metalMat: legMat || c.mat('metal-black') });
  else if (lt.includes('hidden')) b.add(softBox(W - 0.08, 0.04, D - 0.08, { r: 0.003, seg: 1 }), dark, { pos: [0, 0.02, -0.01] });
  return { group: b.build(name), anchors: { top: V3(0, H, 0) }, anchorInfo: { top: { w: W, d: D } } };
}

export function nightstand(c) {
  const { W, D, H, params: p } = c;
  const drawers = clamp(Math.round(p.drawers ?? 2), 0, 4);
  const doors = clamp(Math.round(p.doors ?? 0), 0, 2);
  const open = p.open === true ? 1 : clamp(Math.round(Number(p.open) || (p.shelf ? 1 : 0)), 0, 3);
  const cells = [];
  for (let i = 0; i < open; i++) cells.push({ type: 'open', h: 0.8 });
  for (let i = 0; i < drawers; i++) cells.push({ type: 'drawer', h: 1 });
  if (doors) cells.push({ type: 'door', h: Math.max(1, 2 - drawers) });
  if (!cells.length) cells.push({ type: 'door', h: 1 });
  return cabinet(c, { W, D, H, layout: [{ w: 1, cells }], legType: p.legs || 'wood-taper', woodKey: p.wood || p.frame || 'walnut-dark', handles: p.handles || 'none', front: String(p.fronts || p.front || (p.fluted ? 'fluted' : 'flat')), name: 'nightstand', top: p.top || null });
}

export function tvUnit(c) {
  const { W, D, H, params: p } = c;
  const doors = clamp(Math.round(p.doors ?? 2), 0, 4);
  const drawers = clamp(Math.round(p.drawers ?? 0), 0, 6);
  const openN = p.open === true ? 1 : clamp(Math.round(Number(p.open) || 0), 0, 4);
  const cols = [];
  const half = Math.ceil(doors / 2);
  for (let i = 0; i < half; i++) cols.push({ w: 1, cells: [{ type: 'door', h: 1 }] });
  if (drawers > 2 && doors === 0) {
    // a row of drawers under an open shelf
    for (let i = 0; i < drawers; i++) cols.push({ w: 1, cells: openN ? [{ type: 'open', h: 0.9 }, { type: 'drawer', h: 1 }] : [{ type: 'drawer', h: 1 }] });
  } else {
    if (drawers > 0) cols.push({ w: 1, cells: Array.from({ length: drawers }, () => ({ type: 'drawer', h: 1 })) });
    for (let i = 0; i < openN; i++) cols.push({ w: openN > 1 ? 0.7 : 1, cells: [{ type: 'open', h: 1 }, { type: 'open', h: 1 }] });
  }
  for (let i = half; i < doors; i++) cols.push({ w: 1, cells: [{ type: 'door', h: 1 }] });
  if (!cols.length) cols.push({ w: 1, cells: [{ type: 'open', h: 1 }] });
  const front = String(p.fronts || p.front || (p.fluted ? 'fluted' : p.slatted ? 'slatted' : 'flat'));
  return cabinet(c, { W, D, H, layout: cols, legType: p.legs || 'wood-taper', woodKey: p.wood || 'walnut-dark', handles: p.handles || 'none', front, name: 'tv_unit', top: p.top || null });
}
