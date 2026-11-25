// Villar furniture — floor / table / pendant lamps. Owner: modeler.
// userData.lights: positions are inside the shades; colour warm 2700 K.
import * as THREE from 'three';
import { Builder, softBox, lathe, smoothProfile, slab, ellipseShape, tube, roundLeg, V3, clamp, cm } from './geom.js';

const WARM = '#ffd2a1';

function shadeMatFor(c, p, color) {
  const kind = String(p.shadeMaterial || p.shadeFabric || '').toLowerCase();
  if (kind.includes('paper') || String(p.shape || '').includes('paper')) return c.mat('paper-shade', { color });
  if (kind.includes('rattan') || kind.includes('cane')) return c.mat('rattan');
  if (kind.includes('opal') || kind.includes('glass') || String(p.shade || '').includes('opal')) return c.mat('opal-glass');
  if (kind.includes('metal') || kind.includes('black')) return c.mat('metal-black');
  if (kind.includes('brass')) return c.mat('metal-brass');
  return c.mat('lamp-shade', { color: color || '#EDE5D6' });
}

/** Adds a shade (centre axis at origin x/z), bottom at yb, of given style. Returns light centre y. */
function addShade(b, c, { style = 'drum', R, h, yb, mat, rimMat, inner = null }) {
  const s = String(style).toLowerCase();
  const seg = 72;
  if (s.includes('pleat')) {
    // knife-pleated paper/fabric shade: zig-zag radius, slight taper
    const rt = R * 0.82, n = Math.max(24, Math.round((2 * Math.PI * R) / 0.022));
    const pos = [], uv = [];
    const ring = (y, r) => { const out = []; for (let i = 0; i <= n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2; const rr = r * (i % 2 ? 1.0 : 0.94); out.push([Math.cos(a) * rr, y, Math.sin(a) * rr, a * r]); } return out; };
    const r0 = ring(yb, R), r1 = ring(yb + h, rt);
    for (let i = 0; i < n * 2; i++) {
      const a = r0[i], b2 = r0[i + 1], c2 = r1[i], d = r1[i + 1];
      for (const q of [a, b2, d, a, d, c2]) { pos.push(q[0], q[1], q[2]); uv.push(q[3], q[1]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    b.add(g, mat, { uv: 'keep' });
    for (const [rr, y] of [[R * 0.97, yb], [rt * 0.97, yb + h]]) b.add(new THREE.TorusGeometry(rr, 0.002, 6, seg).rotateX(Math.PI / 2), rimMat, { pos: [0, y, 0] });
    return yb + h * 0.45;
  }
  if (s.includes('mushroom')) {
    const prof = Array.from({ length: 22 }, (_, i) => { const t = (i / 21) * Math.PI / 2; return [Math.max(0.004, R * Math.cos(t)), h * Math.sin(t)]; });
    b.add(lathe(prof, seg), mat, { pos: [0, yb, 0], uv: 'box' });
    b.add(lathe(prof.map(([r, y]) => [r * 0.97, y - 0.003]).reverse(), seg), mat, { pos: [0, yb, 0], uv: 'box' });
    return yb + h * 0.25;
  }
  if (s.includes('cone') || s.includes('empire') || s.includes('tapered')) {
    const rt = R * (s.includes('empire') ? 0.55 : 0.68);
    b.add(new THREE.CylinderGeometry(rt, R, h, seg, 1, true), mat, { pos: [0, yb + h / 2, 0], uv: 'box', axis: 'x' });
    for (const [rr, y] of [[R, yb], [rt, yb + h]]) b.add(new THREE.TorusGeometry(rr, 0.0028, 6, seg).rotateX(Math.PI / 2), rimMat, { pos: [0, y, 0] });
    return yb + h * 0.45;
  }
  if (s.includes('dome') || s.includes('bell') || s.includes('mushroom')) {
    const prof = s.includes('bell')
      ? smoothProfile([[R, 0], [R * 0.92, h * 0.15], [R * 0.6, h * 0.55], [R * 0.32, h * 0.85], [R * 0.12, h], [0.012, h]], 40)
      : Array.from({ length: 25 }, (_, i) => { const t = (i / 24) * Math.PI / 2; return [Math.max(0.012, R * Math.cos(t)), h * Math.sin(t)]; });
    const g = lathe(prof, seg);
    b.add(g, mat, { pos: [0, yb, 0], uv: 'box' });
    const gi = lathe(prof.map(([r, y]) => [r * 0.985, y - 0.002]).reverse(), seg);
    b.add(gi, inner || c.mat('metal-white'), { pos: [0, yb, 0], uv: 'box' });
    b.add(new THREE.TorusGeometry(R, 0.002, 6, seg).rotateX(Math.PI / 2), mat, { pos: [0, yb, 0] });
    return yb + h * 0.4;
  }
  if (s.includes('globe') || s.includes('sphere') || s.includes('ball') || s.includes('lantern')) {
    const Ry = h / 2;
    const ribs = s.includes('paper') || s.includes('lantern') ? 14 : 0;
    const pts = [];
    const N = 90;
    for (let i = 0; i <= N; i++) {
      const t = -Math.PI / 2 + (i / N) * Math.PI;
      let r = R * Math.cos(t), y = Ry * Math.sin(t);
      if (ribs) { const k = Math.cos((i / N) * ribs * Math.PI * 2); r *= 1 + 0.006 * Math.max(0, k) ** 6 - 0.004; }
      pts.push([Math.max(0.0, r), y]);
    }
    // open top & bottom
    const open = 0.035;
    const trimmed = pts.filter(([r, y]) => !(r < open && Math.abs(y) > Ry * 0.5));
    b.add(lathe(trimmed, 64), mat, { pos: [0, yb + Ry, 0], uv: 'box' });
    return yb + Ry;
  }
  // drum (default)
  b.add(new THREE.CylinderGeometry(R, R, h, seg, 1, true), mat, { pos: [0, yb + h / 2, 0], uv: 'box', axis: 'x' });
  for (const y of [yb, yb + h]) b.add(new THREE.TorusGeometry(R, 0.003, 6, seg).rotateX(Math.PI / 2), rimMat, { pos: [0, y, 0] });
  return yb + h * 0.45;
}

function spider(b, mat, { R, y, hubY }) {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add(tube([V3(0, hubY, 0), V3(Math.cos(a) * R * 0.5, (hubY + y) / 2, Math.sin(a) * R * 0.5), V3(Math.cos(a) * R, y, Math.sin(a) * R)], 0.0016, { tubular: 8, radial: 4 }), mat, {});
  }
  b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), mat, { pos: [0, hubY, 0] });
}

function bulb(b, c, y, r = 0.03) {
  const g = new THREE.SphereGeometry(r, 20, 14);
  b.add(g, c.mat('bulb'), { pos: [0, y, 0], cast: false });
  b.add(new THREE.CylinderGeometry(r * 0.45, r * 0.45, r * 1.2, 12), c.mat('metal-brass'), { pos: [0, y - r * 1.2, 0], cast: false });
}

export function floorLamp(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const baseKey = p.base || p.frame || 'metal-black';
  const baseMat = c.mat(baseKey);
  const style = String(p.shade || 'drum').toLowerCase();
  const shade = shadeMatFor(c, p, p.shadeColor || '#EDE5D6');
  const R = W / 2;
  const sh = clamp(cm(p.shadeHeight, Math.min(0.36, W * 0.72)), 0.12, 0.5);
  const yb = H - sh;
  const baseStyle = String(p.baseStyle || p.stand || (String(baseKey).includes('wood') || /walnut|oak|teak/.test(baseKey) ? 'tripod' : 'disc')).toLowerCase();
  if (baseStyle.includes('tripod')) {
    const legTop = yb - 0.08;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const top = V3(0, legTop, 0), bot = V3(Math.cos(a) * R * 0.95, 0, Math.sin(a) * R * 0.95);
      const len = top.distanceTo(bot);
      const g = new THREE.CylinderGeometry(0.013, 0.01, len, 12);
      g.translate(0, -len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, -1, 0), bot.clone().sub(top).normalize());
      g.applyQuaternion(q); g.translate(top.x, top.y, top.z);
      b.add(g, baseMat, { axis: 'y' });
    }
    b.add(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 14), c.mat('metal-brass'), { pos: [0, legTop, 0] });
    b.add(new THREE.CylinderGeometry(0.006, 0.006, yb + sh * 0.4 - legTop, 10), c.mat('metal-brass'), { pos: [0, (legTop + yb + sh * 0.4) / 2, 0] });
  } else {
    const br = clamp(R * 0.75, 0.11, 0.17);
    b.add(slab(ellipseShape(br * 2, br * 2), 0.024, { bevel: 0.007, bevelSeg: 4 }), baseMat, {});
    b.add(new THREE.CylinderGeometry(0.0095, 0.0095, yb + sh * 0.4 - 0.024, 14), baseMat, { pos: [0, 0.024 + (yb + sh * 0.4 - 0.024) / 2, 0], axis: 'y' });
    b.add(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 14), baseMat, { pos: [0, 0.04, 0] });
  }
  const rim = c.mat(/brass|gold/.test(baseKey) ? 'metal-brass' : 'metal-black');
  const ly = addShade(b, c, { style, R, h: sh, yb, mat: shade, rimMat: rim });
  spider(b, rim, { R: style.includes('cone') ? R * 0.68 : R, y: yb + sh, hubY: yb + sh * 0.55 });
  bulb(b, c, ly + 0.02, 0.028);
  return {
    group: b.build('floor_lamp'),
    lights: [{ type: 'point', position: [0, ly + 0.02, 0], color: WARM, intensity: p.lumens ? p.lumens / 800 : 1, distance: 4.5, decay: 2, shadow: true }],
  };
}

const BASE_SHAPES = {
  gourd: (h, r) => [[0.001, 0], [r * 0.5, 0], [r * 0.56, h * 0.025], [r * 0.86, h * 0.2], [r, h * 0.44], [r * 0.9, h * 0.66], [r * 0.58, h * 0.84], [r * 0.34, h * 0.93], [r * 0.3, h * 0.97], [r * 0.3, h], [0.001, h]],
  jar: (h, r) => [[0.001, 0], [r * 0.7, 0], [r * 0.74, h * 0.03], [r * 0.98, h * 0.4], [r, h * 0.6], [r * 0.86, h * 0.84], [r * 0.45, h * 0.94], [r * 0.3, h], [0.001, h]],
  cylinder: (h, r) => [[0.001, 0], [r * 0.82, 0], [r * 0.85, h * 0.02], [r * 0.85, h * 0.97], [r * 0.8, h], [0.001, h]],
  sphere: (h, r) => { const out = [[0.001, 0], [r * 0.4, 0]]; for (let i = 1; i < 12; i++) { const t = -Math.PI / 2 + (i / 12) * Math.PI; out.push([r * Math.cos(t), h * 0.5 + h * 0.5 * Math.sin(t)]); } out.push([r * 0.2, h], [0.001, h]); return out; },
  column: (h, r) => [[0.001, 0], [r * 0.7, 0], [r * 0.7, h * 0.06], [r * 0.32, h * 0.1], [r * 0.3, h * 0.92], [r * 0.4, h], [0.001, h]],
};

export function tableLamp(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const baseKey = p.base || 'ceramic-matte';
  const baseMat = c.mat(baseKey, { color: p.baseColor || '#CBB89A' });
  const style = String(p.shade || 'drum').toLowerCase();
  const shade = shadeMatFor(c, p, p.shadeColor || '#EDE5D6');
  const R = W / 2;
  const sh = clamp(cm(p.shadeHeight, H * 0.42), 0.1, 0.4);
  const yb = H - sh;
  const bh = clamp(yb - 0.02, 0.1, H);
  const mushroom = style.includes('mushroom');
  const shapeName = String(p.baseShape || (mushroom ? 'stem' : /metal|brass|black|wood|walnut|oak/.test(baseKey) ? 'column' : 'gourd')).toLowerCase();
  if (mushroom) {
    // flared stem straight into the dome shade
    const dh = sh;
    const stemTop = H - dh * 0.35;
    const prof = smoothProfile([[0.001, 0], [R * 0.45, 0], [R * 0.45, 0.008], [R * 0.2, 0.03], [0.016, H * 0.25], [0.012, stemTop * 0.8], [0.014, stemTop], [0.001, stemTop]], 40);
    b.add(lathe(prof, 40), baseMat, { uv: 'cyl' });
    const ly = addShade(b, c, { style: 'mushroom', R, h: dh * 0.75, yb: H - dh * 0.75, mat: shade, rimMat: baseMat });
    bulb(b, c, ly, 0.02);
    return { group: b.build('table_lamp'), lights: [{ type: 'point', position: [0, ly, 0], color: WARM, intensity: 0.6, distance: 3, decay: 2, shadow: false }] };
  }
  const fn = BASE_SHAPES[Object.keys(BASE_SHAPES).find((k) => shapeName.includes(k)) || 'gourd'];
  const br = Math.min(R * 0.55, 0.11);
  b.add(lathe(smoothProfile(fn(bh, br), 60), 56), baseMat, { uv: 'box', axis: 'x' });
  // socket + neck
  const brass = c.mat('metal-brass');
  b.add(new THREE.CylinderGeometry(0.012, 0.016, 0.03, 16), brass, { pos: [0, bh + 0.012, 0] });
  b.add(new THREE.CylinderGeometry(0.004, 0.004, yb + sh * 0.5 - bh, 8), brass, { pos: [0, (bh + yb + sh * 0.5) / 2, 0] });
  const rim = c.mat('metal-brass');
  const ly = addShade(b, c, { style, R, h: sh, yb, mat: shade, rimMat: rim });
  spider(b, rim, { R: style.includes('cone') ? R * 0.68 : R, y: yb + sh, hubY: yb + sh * 0.6 });
  bulb(b, c, ly + 0.01, 0.022);
  return {
    group: b.build('table_lamp'),
    lights: [{ type: 'point', position: [0, ly + 0.01, 0], color: WARM, intensity: 0.6, distance: 3, decay: 2, shadow: false }],
  };
}

export function pendantLamp(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const shape = String(p.shape || 'dome').toLowerCase();
  const color = p.color || c.item?.colorHex || '#F3EEE4';
  const drop = clamp(Number(p.drop) || 0.7, 0.05, 2.0);
  const R = W / 2, h = H;
  let mat;
  if (shape.includes('paper') || shape.includes('lantern')) mat = c.mat('paper-shade', { color });
  else if (shape.includes('rattan') || shape.includes('wicker')) mat = c.mat('rattan');
  else if (shape.includes('glass') || shape.includes('opal')) mat = c.mat('opal-glass');
  else if (shape.includes('linen') || shape.includes('fabric') || shape.includes('drum')) mat = c.mat('lamp-shade', { color });
  else mat = c.mat(p.material || (shape.includes('brass') ? 'metal-brass' : 'metal-black'), { color: p.material ? undefined : color === '#F3EEE4' ? undefined : color });
  const metal = c.mat(p.fitting || 'metal-black');
  // canopy + cord
  b.add(slab(ellipseShape(0.11, 0.11), 0.025, { bevel: 0.005 }), metal, { pos: [0, -0.025, 0] });
  b.add(new THREE.CylinderGeometry(0.0025, 0.0025, drop - 0.025, 6), c.mat('cord'), { pos: [0, -0.025 - (drop - 0.025) / 2, 0], cast: false });
  b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 14), metal, { pos: [0, -drop - 0.01, 0] });
  const top = -drop;
  let ly;
  if (shape.includes('globe') || shape.includes('sphere') || shape.includes('lantern') || (shape.includes('paper') && !shape.includes('dome'))) {
    ly = addShade(b, c, { style: 'globe' + (shape.includes('paper') ? '-paper' : ''), R, h, yb: top - h, mat, rimMat: metal });
    // wire ribs hint at top/bottom rings
    b.add(new THREE.TorusGeometry(0.035, 0.002, 6, 24).rotateX(Math.PI / 2), metal, { pos: [0, top - 0.01, 0] });
  } else if (shape.includes('drum') || shape.includes('cone')) {
    ly = addShade(b, c, { style: shape.includes('cone') ? 'cone' : 'drum', R, h, yb: top - h, mat, rimMat: metal });
    spider(b, metal, { R: shape.includes('cone') ? R * 0.68 : R, y: top, hubY: top - h * 0.2 });
  } else {
    // dome / bell (open at the bottom)
    ly = addShade(b, c, { style: shape.includes('bell') ? 'bell' : 'dome', R, h, yb: top - h, mat, rimMat: metal, inner: /rattan|wicker|paper|linen|opal|glass/.test(shape) ? mat : c.mat('metal-white') });
    ly = top - h * 0.45;
  }
  bulb(b, c, ly, 0.03);
  return {
    group: b.build('pendant_lamp'),
    anchors: { mount: V3(0, 0, 0), bottom: V3(0, top - h, 0) },
    lights: [{ type: shape.includes('dome') || shape.includes('bell') ? 'spot' : 'point', position: [0, ly, 0], target: [0, ly - 1, 0], angle: 1.0, penumbra: 0.6, color: WARM, intensity: 1, distance: 5, decay: 2, shadow: true }],
  };
}
