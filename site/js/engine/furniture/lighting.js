// Villar furniture — floor / table / pendant lamps. Owner: modeler.
// userData.lights: positions are inside the shades; colour warm 2700 K.
import * as THREE from '../../../vendor/three/three.module.js';
import { Builder, softBox, lathe, smoothProfile, slab, ellipseShape, tube, roundLeg, segs, V3, clamp, cm } from './geom.js';

const WARM = '#ffd2a1';

/** Shade UVs: u = arc length (m), v = 0..1 bottom→top (drives the lit-shade emissive falloff map). */
function shadeUV(g, R) {
  const pos = g.attributes.position, uv = g.attributes.uv;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const span = Math.max(1e-4, y1 - y0), L = 2 * Math.PI * R;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, uv.getX(i) * L, (pos.getY(i) - y0) / span);
  uv.needsUpdate = true;
  return g;
}

/**
 * Light descriptors for a shaded lamp (SPEC units: metres, angle = spot half-angle in RADIANS, penumbra 0–1).
 * Open drum/cone: down spot (70 %, shadowed) + up spot (30 %) + dim glow point (10 %) → hourglass cut-off on walls.
 * Dome (open below): down spot + glow. Diffuser globe: one point light.
 */
function shadeLights({ x = 0, z = 0, ly, yb, h, Rb, Rt = Rb, I = 1, kind = 'open', distance = 4.5 }) {
  const col = WARM;
  if (kind === 'globe') return [{ type: 'point', position: [x, ly, z], color: col, intensity: I, distance, decay: 2, shadow: true }];
  const down = clamp(Math.atan2(Rb, Math.max(0.02, ly - yb)), 0.6, 1.25);
  const out = [{ type: 'spot', position: [x, ly, z], target: [x, ly - 1, z], angle: down, penumbra: 0.35, color: col, intensity: I * 0.7, distance, decay: 2, shadow: true }];
  if (kind === 'open') {
    const up = clamp(Math.atan2(Rt, Math.max(0.02, yb + h - ly)), 0.5, 1.2);
    out.push({ type: 'spot', position: [x, ly, z], target: [x, ly + 1, z], angle: up, penumbra: 0.4, color: col, intensity: I * 0.3, distance: distance * 0.8, decay: 2, shadow: false });
  }
  out.push({ type: 'point', position: [x, ly, z], color: col, intensity: I * 0.1, distance: 1.2, decay: 2, shadow: false });
  return out;
}

function shadeMatFor(c, p, color) {
  const kind = String(p.shadeMaterial || p.shadeFabric || '').toLowerCase();
  if (kind.includes('paper') || String(p.shape || '').includes('paper')) return c.mat('paper-shade', { color });
  if (kind.includes('rattan') || kind.includes('cane')) return c.mat('rattan');
  if (kind.includes('opal') || kind.includes('glass') || String(p.shade || '').includes('opal')) return c.mat('opal-glass');
  if (kind.includes('metal') || kind.includes('black')) return c.mat('metal-black');
  if (kind.includes('brass')) return c.mat('metal-brass');
  return c.mat('lamp-shade', { color: color || '#EDE5D6' });
}

/** Turn a surface inside out (normals and winding), e.g. a shade lining seen from inside. */
function insideOut(g) {
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
  return g;
}
/**
 * R2-08: the styrene lining laminated inside a fabric shade — opaque, never emissive, so it is the shade's solid
 * shadow caster in the sun (the glowing fabric itself is kept out of shadow maps by the engine). It sits 2.5 mm
 * inside the fabric, outside every lamp spot cone (down spots aim at the bottom rim), and faces inward: at night it
 * is the bright inside of the shade seen from above.
 */
function addLining(b, c, { rb, rt, h, yb, shadeColor }) {
  const g = new THREE.CylinderGeometry(rt - 0.0025, rb - 0.0025, h - 0.004, segs(48, 18), 1, true);
  b.add(insideOut(g), c.mat('lining', { color: '#F4EFE6' }), { pos: [0, yb + h / 2, 0], uv: 'none' });
  void shadeColor;
}

/** Adds a shade (centre axis at origin x/z), bottom at yb, of given style. Returns light centre y. */
function addShade(b, c, { style = 'drum', R, h, yb, mat, rimMat, inner = null, open = 0, wave = 0, lining = true }) {
  const s = String(style).toLowerCase();
  const seg = 72;
  const lined = lining && mat && mat.userData?.glow && !/opal|rattan|glass/.test(mat.name || '');
  if (s.includes('pleat')) {
    // knife-pleated paper/fabric shade: zig-zag radius, slight taper
    const rt = R * 0.82, n = Math.max(24, Math.round((2 * Math.PI * R) / 0.022));
    const pos = [], uv = [];
    const ring = (y, r) => { const out = []; for (let i = 0; i <= n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2; const rr = r * (i % 2 ? 1.0 : 0.94); out.push([Math.cos(a) * rr, y, Math.sin(a) * rr, a * r]); } return out; };
    const r0 = ring(yb, R), r1 = ring(yb + h, rt);
    for (let i = 0; i < n * 2; i++) {
      const a = r0[i], b2 = r0[i + 1], c2 = r1[i], d = r1[i + 1];
      for (const q of [a, b2, d, a, d, c2]) { pos.push(q[0], q[1], q[2]); uv.push(q[3], (q[1] - yb) / h); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    b.add(g, mat, { uv: 'keep' });
    for (const [rr, y] of [[R * 0.97, yb], [rt * 0.97, yb + h]]) b.add(new THREE.TorusGeometry(rr, 0.002, 6, seg).rotateX(Math.PI / 2), rimMat, { pos: [0, y, 0] });
    if (lined) addLining(b, c, { rb: R * 0.94, rt: rt * 0.94, h, yb });
    return yb + h * 0.45;
  }
  if (s.includes('mushroom')) {
    const prof = Array.from({ length: 22 }, (_, i) => { const t = (i / 21) * Math.PI / 2; return [Math.max(0.004, R * Math.cos(t)), h * Math.sin(t)]; });
    b.add(shadeUV(lathe(prof, seg), R), mat, { pos: [0, yb, 0], uv: 'keep' });
    b.add(shadeUV(lathe(prof.map(([r, y]) => [r * 0.97, y - 0.003]).reverse(), seg), R), mat, { pos: [0, yb, 0], uv: 'keep' });
    return yb + h * 0.25;
  }
  if (s.includes('cone') || s.includes('empire') || s.includes('tapered')) {
    const rt = R * (s.includes('empire') ? 0.55 : 0.68);
    b.add(shadeUV(new THREE.CylinderGeometry(rt, R, h, segs(seg, 24), 1, true), R), mat, { pos: [0, yb + h / 2, 0], uv: 'keep' });
    for (const [rr, y] of [[R, yb], [rt, yb + h]]) b.add(new THREE.TorusGeometry(rr, 0.0028, 6, seg).rotateX(Math.PI / 2), rimMat, { pos: [0, y, 0] });
    if (lined) addLining(b, c, { rb: R, rt, h, yb });
    return yb + h * 0.45;
  }
  if (s.includes('dome') || s.includes('bell') || s.includes('mushroom')) {
    const prof = s.includes('bell')
      ? smoothProfile([[R, 0], [R * 0.92, h * 0.15], [R * 0.6, h * 0.55], [R * 0.32, h * 0.85], [R * 0.12, h], [0.012, h]], 40)
      : Array.from({ length: 25 }, (_, i) => { const t = (i / 24) * Math.PI / 2; return [Math.max(0.012, R * Math.cos(t)), h * Math.sin(t)]; });
    const g = lathe(prof, seg);
    if (wave) { const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getZ(i), y = pa.getY(i); const a = Math.atan2(z, x); const k = 1 + wave * Math.sin(a * 6) * (1 - y / h); pa.setX(i, x * k); pa.setZ(i, z * k); } g.computeVertexNormals(); }
    b.add(shadeUV(g, R), mat, { pos: [0, yb, 0], uv: 'keep' });
    const gi = lathe(prof.map(([r, y]) => [r * 0.985, y - 0.002]).reverse(), seg);
    if (wave) { const pa = gi.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getZ(i), y = pa.getY(i); const a = Math.atan2(z, x); const k = 1 + wave * Math.sin(a * 6) * (1 - y / h); pa.setX(i, x * k); pa.setZ(i, z * k); } gi.computeVertexNormals(); }
    b.add(shadeUV(gi, R), inner || c.mat('metal-white'), { pos: [0, yb, 0], uv: 'keep' });
    b.add(new THREE.TorusGeometry(R, 0.002, 6, seg).rotateX(Math.PI / 2), mat, { pos: [0, yb, 0] });
    return yb + h * 0.4;
  }
  if (s.includes('globe') || s.includes('sphere') || s.includes('ball') || s.includes('lantern')) {
    const Ry = h / 2;
    const ribs = s.includes('paper') || s.includes('lantern') ? 16 : 0;
    const pts = [];
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const t = -Math.PI / 2 + (i / N) * Math.PI;
      let r = R * Math.cos(t), y = Ry * Math.sin(t);
      if (ribs) { const k = Math.cos((i / N) * ribs * Math.PI * 2); r *= 1 + 0.012 * Math.max(0, k) ** 8 - 0.006; }
      pts.push([Math.max(0.0, r), y]);
    }
    // open top & bottom
    const hole = Math.max(0.035, open * R);
    const trimmed = pts.filter(([r, y]) => !(r < hole && Math.abs(y) > Ry * 0.3));
    b.add(shadeUV(lathe(trimmed, 40), R), mat, { pos: [0, yb + Ry, 0], uv: 'keep' });
    return yb + Ry;
  }
  // drum (default)
  b.add(shadeUV(new THREE.CylinderGeometry(R, R, h, segs(seg, 24), 1, true), R), mat, { pos: [0, yb + h / 2, 0], uv: 'keep' });
  for (const y of [yb, yb + h]) b.add(new THREE.TorusGeometry(R, 0.003, 6, seg).rotateX(Math.PI / 2), rimMat, { pos: [0, y, 0] });
  if (lined) addLining(b, c, { rb: R, rt: R, h, yb });
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
  const baseMat = c.mat(baseKey, p.baseColor && isMetalKey(baseKey) ? { color: p.baseColor } : undefined);
  const style = String(p.shade || 'drum').toLowerCase();
  const shade = shadeMatFor(c, p, p.shadeColor || '#EDE5D6');
  const R = clamp(cm(p.shadeDiameter, W) / 2, 0.1, 0.35);
  const stem = String(p.stem || '').toLowerCase();
  if (stem.includes('swing') || stem.includes('arm')) return swingArmLamp(c, { b, baseMat, shade, style, R });
  if (/column|cylinder|tube/.test(style) || /column/.test(stem) && /column|cylinder/.test(style)) return columnLamp(c);
  const sh = clamp(cm(p.shadeHeight, Math.min(0.36, W * 0.72)), 0.12, 0.5);
  const yb = H - sh;
  const woodBase = String(baseKey).includes('wood') || /walnut|oak|teak/.test(baseKey);
  const baseStyle = String(p.baseStyle || p.stand || (woodBase && !stem.includes('turn') ? 'tripod' : 'disc')).toLowerCase();
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
  } else if (stem.includes('turn')) {
    // turned wooden column with beads on a round foot
    const top = yb + sh * 0.4;
    const prof = [[0.001, 0], [0.13, 0], [0.13, 0.02], [0.11, 0.035], [0.035, 0.06]];
    const n = 5;
    for (let i = 0; i < n; i++) { const y0 = 0.06 + (i / n) * (top - 0.08), y1 = 0.06 + ((i + 1) / n) * (top - 0.08); prof.push([0.022, y0 + (y1 - y0) * 0.15], [0.034, y0 + (y1 - y0) * 0.5], [0.022, y0 + (y1 - y0) * 0.85]); }
    prof.push([0.014, top], [0.001, top]);
    b.add(lathe(smoothProfile(prof, 90), 28), baseMat, { uv: 'cyl' });
  } else {
    const br = clamp(R * 0.75, 0.11, 0.17);
    b.add(slab(ellipseShape(br * 2, br * 2), 0.024, { bevel: 0.007, bevelSeg: 4 }), baseMat, {});
    b.add(new THREE.CylinderGeometry(0.0095, 0.0095, yb + sh * 0.4 - 0.024, 14), baseMat, { pos: [0, 0.024 + (yb + sh * 0.4 - 0.024) / 2, 0], axis: 'y' });
    b.add(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 14), baseMat, { pos: [0, 0.04, 0] });
  }
  const rim = c.mat(/brass|gold/.test(baseKey) ? 'metal-brass' : 'metal-black');
  const ly = addShade(b, c, { style, R, h: sh, yb, mat: shade, rimMat: rim });
  spider(b, rim, { R: style.includes('cone') ? R * 0.68 : style.includes('pleat') ? R * 0.8 : R, y: yb + sh, hubY: yb + sh * 0.55 });
  bulb(b, c, ly + 0.02, 0.028);
  const kind = /globe|sphere/.test(style) ? 'globe' : /dome|bell/.test(style) ? 'dome' : 'open';
  return {
    group: b.build('floor_lamp'),
    lights: shadeLights({ ly: ly + 0.02, yb, h: sh, Rb: R, Rt: style.includes('cone') ? R * 0.68 : style.includes('pleat') ? R * 0.82 : R, I: p.lumens ? p.lumens / 800 : 1, kind }),
  };
}

const isMetalKey = (k) => /metal|brass|chrome|nickel|black|gold/.test(String(k || ''));

/**
 * Column floor lamp (Diamant-type): a full-height diffuser of wound paper cord, Ø = dims.w (≈ 0.2 m), on a slim
 * dark base disc, with a top cap. The cord column glows evenly at night (paper-shade, cord weave, no rim falloff);
 * one diffuser point light at mid-height + a weak up spot through the open top.
 */
function columnLamp(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const R = clamp(cm(p.shadeDiameter, W) / 2, 0.06, 0.2);
  const color = p.shadeColor || p.baseColor || '#EEE8DE';
  const paper = c.mat('paper-shade', { color, cord: true });
  const foot = 0.022, capH = 0.01, h = H - foot - capH;
  // wound cord column: UV u = height (m) so the cord rings run round the column, v = arc (m)
  const g = new THREE.CylinderGeometry(R, R, h, segs(48, 18), segs(24, 6), true);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), a = Math.atan2(pos.getX(i), pos.getZ(i));
    // very slight barrel (the cord stack bellies ~3 mm mid-height)
    const k = 1 + 0.015 * Math.sin(Math.PI * (y / h + 0.5));
    pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k);
    uv.setXY(i, y + h / 2, Math.abs(a) * R);
  }
  g.computeVertexNormals();
  b.add(g, paper, { pos: [0, foot + h / 2, 0], uv: 'keep' });
  b.add(insideOut(new THREE.CylinderGeometry(R - 0.004, R - 0.004, h - 0.01, segs(32, 12), 1, true)), paper, { pos: [0, foot + h / 2, 0], uv: 'none' });
  const dark = c.mat('metal-black', { color: '#2a2724', roughness: 0.6 });
  b.add(slab(ellipseShape(R * 2 + 0.01, R * 2 + 0.01), foot, { bevel: 0.004, bevelSeg: 2 }), dark, {});
  b.add(new THREE.TorusGeometry(R - 0.002, 0.004, 6, segs(48, 16)).rotateX(Math.PI / 2), c.mat('metal-white', { color: p.capColor || color }), { pos: [0, foot + h, 0] });
  const ly = foot + h * 0.55;
  bulb(b, c, ly, 0.03);
  return {
    group: b.build('floor_lamp'),
    lights: [
      { type: 'point', position: [0, ly, 0], color: WARM, intensity: (p.lumens ? p.lumens / 800 : 1) * 0.8, distance: 4.5, decay: 2, shadow: true },
      { type: 'spot', position: [0, ly, 0], target: [0, ly + 1, 0], angle: clamp(Math.atan2(R, foot + h - ly), 0.15, 0.6), penumbra: 0.6, color: WARM, intensity: 0.2, distance: 3, decay: 2, shadow: false },
    ],
  };
}

/** Swing-arm floor lamp: disc base, upright stem, horizontal arm, shade hanging at the arm end. */
function swingArmLamp(c, { b, baseMat, shade, style, R }) {
  const { H, params: p } = c;
  const sh = clamp(cm(p.shadeHeight, R * 1.2), 0.12, 0.4);
  // width = base radius + arm + shade radius = W (exact catalogue width)
  const br = clamp(c.W * 0.28, 0.09, 0.14);
  const armL = Math.max(0.06, c.W - br - R);
  const stemTop = H - 0.02;
  b.add(slab(ellipseShape(br * 2, br * 2), 0.022, { bevel: 0.007, bevelSeg: 4 }), baseMat, { pos: [-armL / 2, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.009, 0.009, stemTop - 0.02, 14), baseMat, { pos: [-armL / 2, 0.02 + (stemTop - 0.02) / 2, 0], axis: 'y' });
  b.add(tube([V3(-armL / 2, stemTop - 0.03, 0), V3(-armL / 2 + 0.02, stemTop, 0), V3(armL / 2 - 0.02, stemTop, 0), V3(armL / 2, stemTop - 0.03, 0)], 0.007, { tubular: 24, radial: 8, tension: 0.2 }), baseMat, {});
  b.add(new THREE.SphereGeometry(0.014, 12, 8), baseMat, { pos: [-armL / 2, stemTop - 0.03, 0] });
  const yb = stemTop - 0.05 - sh;
  b.add(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 8), baseMat, { pos: [armL / 2, stemTop - 0.06, 0] });
  const g = new Builder(c.seed + 1);
  const ly = addShade(g, c, { style, R, h: sh, yb, mat: shade, rimMat: baseMat });
  spider(g, baseMat, { R: style.includes('cone') ? R * 0.68 : R, y: yb + sh, hubY: yb + sh * 0.6 });
  bulb(g, c, ly, 0.026);
  const sg = g.build('shade');
  sg.children.forEach((m) => { m.position.x += armL / 2; });
  const group = b.build('floor_lamp');
  while (sg.children.length) group.add(sg.children[0]);
  return { group, lights: shadeLights({ x: armL / 2, ly, yb, h: sh, Rb: R, Rt: style.includes('cone') ? R * 0.68 : R, I: 1, kind: /dome|bell/.test(style) ? 'dome' : 'open' }) };
}

const BASE_SHAPES = {
  gourd: (h, r) => [[0.001, 0], [r * 0.5, 0], [r * 0.56, h * 0.025], [r * 0.86, h * 0.2], [r, h * 0.44], [r * 0.9, h * 0.66], [r * 0.58, h * 0.84], [r * 0.34, h * 0.93], [r * 0.3, h * 0.97], [r * 0.3, h], [0.001, h]],
  jar: (h, r) => [[0.001, 0], [r * 0.7, 0], [r * 0.74, h * 0.03], [r * 0.98, h * 0.4], [r, h * 0.6], [r * 0.86, h * 0.84], [r * 0.45, h * 0.94], [r * 0.3, h], [0.001, h]],
  cylinder: (h, r) => [[0.001, 0], [r * 0.82, 0], [r * 0.85, h * 0.02], [r * 0.85, h * 0.97], [r * 0.8, h], [0.001, h]],
  sphere: (h, r) => { const out = [[0.001, 0], [r * 0.4, 0]]; for (let i = 1; i < 12; i++) { const t = -Math.PI / 2 + (i / 12) * Math.PI; out.push([r * Math.cos(t), h * 0.5 + h * 0.5 * Math.sin(t)]); } out.push([r * 0.2, h], [0.001, h]); return out; },
  column: (h, r) => [[0.001, 0], [r * 0.7, 0], [r * 0.7, h * 0.06], [r * 0.32, h * 0.1], [r * 0.3, h * 0.92], [r * 0.4, h], [0.001, h]],
  turned: (h, r) => [[0.001, 0], [r * 0.85, 0], [r * 0.85, h * 0.05], [r * 0.4, h * 0.09], [r * 0.55, h * 0.2], [r * 0.25, h * 0.32], [r * 0.45, h * 0.46], [r * 0.22, h * 0.6], [r * 0.38, h * 0.74], [r * 0.2, h * 0.88], [r * 0.25, h], [0.001, h]],
};

export function tableLamp(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const baseKey = p.base || 'ceramic-matte';
  const baseMat = c.mat(baseKey, /ceram|paint|glaze/.test(baseKey) || isMetalKey(baseKey) ? { color: p.baseColor || (isMetalKey(baseKey) ? undefined : '#CBB89A') } : p.baseColor ? { match: p.baseColor } : undefined);
  const style = String(p.shade || 'drum').toLowerCase();
  const shade = shadeMatFor(c, p, p.shadeColor || '#EDE5D6');
  const R = clamp(cm(p.shadeDiameter, W) / 2, 0.08, 0.3);
  const sh = clamp(cm(p.shadeHeight, H * 0.42), 0.1, 0.4);
  const yb = H - sh;
  const bh = clamp(yb - 0.02, 0.1, H);
  const mushroom = style.includes('mushroom');
  const shapeName = String(p.baseShape || p.body || (mushroom ? 'stem' : /metal|brass|black|wood|walnut|oak/.test(baseKey) ? 'column' : 'gourd')).toLowerCase();
  if (mushroom) {
    // flared stem straight into the dome shade
    const dh = sh;
    const stemTop = H - dh * 0.35;
    const prof = smoothProfile([[0.001, 0], [R * 0.45, 0], [R * 0.45, 0.008], [R * 0.2, 0.03], [0.016, H * 0.25], [0.012, stemTop * 0.8], [0.014, stemTop], [0.001, stemTop]], 40);
    b.add(lathe(prof, 40), baseMat, { uv: 'cyl' });
    const ly = addShade(b, c, { style: 'mushroom', R, h: dh * 0.75, yb: H - dh * 0.75, mat: shade, rimMat: baseMat });
    bulb(b, c, ly, 0.02);
    return { group: b.build('table_lamp'), lights: shadeLights({ ly, yb: H - dh * 0.75, h: dh * 0.75, Rb: R, I: 0.6, kind: 'dome', distance: 3 }) };
  }
  const fn = BASE_SHAPES[Object.keys(BASE_SHAPES).find((k) => shapeName.includes(k)) || 'gourd'];
  const br = Math.min(R * 0.55, 0.11);
  const lg = lathe(smoothProfile(fn(bh, br), 36), shapeName.includes('rib') ? 96 : 44);
  if (shapeName.includes('rib')) {
    // vertical ribs (fluted ceramic)
    const pa = lg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getZ(i); const a = Math.atan2(z, x); const k = 1 + 0.035 * Math.abs(Math.sin(a * 12)); pa.setX(i, x * k); pa.setZ(i, z * k); }
    lg.computeVertexNormals();
  }
  b.add(lg, baseMat, { uv: /walnut|oak|wood/.test(baseKey) ? 'cyl' : 'box', axis: 'x' });
  // socket + neck
  const brass = c.mat('metal-brass');
  b.add(new THREE.CylinderGeometry(0.012, 0.016, 0.03, 16), brass, { pos: [0, bh + 0.012, 0] });
  b.add(new THREE.CylinderGeometry(0.004, 0.004, yb + sh * 0.5 - bh, 8), brass, { pos: [0, (bh + yb + sh * 0.5) / 2, 0] });
  const rim = c.mat('metal-brass');
  const ly = addShade(b, c, { style, R, h: sh, yb, mat: shade, rimMat: rim });
  spider(b, rim, { R: style.includes('cone') ? R * 0.68 : style.includes('pleat') ? R * 0.8 : R, y: yb + sh, hubY: yb + sh * 0.6 });
  bulb(b, c, ly + 0.01, 0.022);
  return {
    group: b.build('table_lamp'),
    lights: shadeLights({ ly: ly + 0.01, yb, h: sh, Rb: R, Rt: style.includes('cone') ? R * 0.68 : style.includes('pleat') ? R * 0.82 : R, I: 0.6, kind: /dome|bell|opal/.test(style) ? 'dome' : 'open', distance: 3 }),
  };
}

export function pendantLamp(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const body = String(p.body || '').toLowerCase();
  const prof = String(p.shadeProfile || '').toLowerCase();
  const shape = String(p.shape || ((p.shade ? p.shade : 'dome') + (body ? '-' + body : '') + (p.shadeMaterial ? '-' + p.shadeMaterial : '') + (prof ? '-' + prof : ''))).toLowerCase();
  const color = p.color || p.shadeColor || c.item?.colorHex || '#F3EEE4';
  const drop = clamp(Number(p.drop) || 0.7, 0.05, 2.0);
  const R = W / 2, h = H;
  let mat;
  if (shape.includes('paper') || shape.includes('lantern')) mat = c.mat('paper-shade', { color });
  else if (shape.includes('rattan') || shape.includes('wicker') || shape.includes('hyacinth')) mat = c.mat('rattan', { color: p.shadeColor || undefined });
  else if (shape.includes('glass') || shape.includes('opal')) mat = c.mat('opal-glass');
  else if (shape.includes('linen') || shape.includes('fabric') || shape.includes('drum') || shape.includes('pleat')) mat = c.mat('lamp-shade', { color });
  else mat = c.mat(p.material || (shape.includes('brass') ? 'metal-brass' : 'metal-black'), { color: p.material ? undefined : color === '#F3EEE4' ? undefined : color });
  const metal = c.mat(p.fitting || 'metal-black');
  // R2-18 trim bands: light trims are tone-on-tone linen tape, dark/saturated ones leather
  const trimLight = p.trimColor && new THREE.Color(p.trimColor).getHSL({}).l > 0.55;
  const trim = p.trimColor ? (trimLight ? c.mat('fabric-linen', { color: p.trimColor, side: THREE.DoubleSide }) : c.mat('leather-cognac', { color: p.trimColor })) : metal;
  // canopy + cord
  b.add(slab(ellipseShape(0.11, 0.11), 0.025, { bevel: 0.005 }), metal, { pos: [0, -0.025, 0] });
  b.add(new THREE.CylinderGeometry(0.0025, 0.0025, drop - 0.025, 6), c.mat('cord'), { pos: [0, -0.025 - (drop - 0.025) / 2, 0], cast: false });
  b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 14), metal, { pos: [0, -drop - 0.01, 0] });
  const top = -drop;
  let ly;
  if (shape.includes('globe') || shape.includes('sphere') || shape.includes('lantern') || (shape.includes('paper') && !shape.includes('dome'))) {
    ly = addShade(b, c, { style: 'globe' + (shape.includes('paper') ? '-paper' : ''), R, h, yb: top - h, mat, rimMat: metal, open: shape.includes('rattan') || shape.includes('flatten') ? 0.35 : 0 });
    // wire ribs hint at top/bottom rings
    b.add(new THREE.TorusGeometry(0.035, 0.002, 6, 24).rotateX(Math.PI / 2), metal, { pos: [0, top - 0.01, 0] });
  } else if (shape.includes('pleat')) {
    // tiered pleated fabric shade
    const tiers = clamp(Math.round(p.tiers || 1), 1, 3);
    const th = h / tiers;
    for (let i = 0; i < tiers; i++) addShade(b, c, { style: 'pleated', R: R * (1 - 0.18 * (tiers - 1 - i)), h: th * 1.05, yb: top - (i + 1) * th, mat, rimMat: trim });
    ly = top - h * 0.55;
  } else if (shape.includes('drum') || shape.includes('cone')) {
    ly = addShade(b, c, { style: shape.includes('cone') ? 'cone' : 'drum', R, h, yb: top - h, mat, rimMat: trim });
    if (p.trimColor) for (const y of [top - h + 0.012, top - 0.012]) b.add(new THREE.CylinderGeometry(R + 0.002, R + 0.002, 0.022, 72, 1, true), trim, { pos: [0, y, 0] });
    spider(b, metal, { R: shape.includes('cone') ? R * 0.68 : R, y: top, hubY: top - h * 0.2 });
  } else {
    // dome / bell (open at the bottom)
    ly = addShade(b, c, { style: shape.includes('bell') ? 'bell' : 'dome', R, h, yb: top - h, mat, rimMat: metal, inner: /rattan|wicker|paper|linen|opal|glass/.test(shape) ? mat : c.mat('metal-white'), wave: shape.includes('wave') || shape.includes('organic') ? 0.06 : 0 });
    ly = top - h * 0.45;
  }
  bulb(b, c, ly, 0.03);
  const globe = shape.includes('globe') || shape.includes('sphere') || shape.includes('lantern') || (shape.includes('paper') && !shape.includes('dome'));
  let lights;
  if (globe) lights = shadeLights({ ly, yb: top - h, h, Rb: R, kind: 'globe', distance: 5 });
  else if (shape.includes('drum') || shape.includes('cone') || shape.includes('pleat')) {
    // dining pendant: a shadowed down spot pooling on the table (55°, soft edge) + up-light + shade glow
    lights = shadeLights({ ly, yb: top - h, h, Rb: R, Rt: shape.includes('cone') ? R * 0.68 : R, kind: 'open', distance: 5 });
    lights[0].angle = 0.96; lights[0].penumbra = 0.5;
  } else lights = shadeLights({ ly, yb: top - h, h, Rb: R, kind: 'dome', distance: 5 });
  return {
    group: b.build('pendant_lamp'),
    anchors: { mount: V3(0, 0, 0), bottom: V3(0, top - h, 0) },
    lights,
  };
}
