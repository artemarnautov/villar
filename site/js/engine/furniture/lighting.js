// Villar furniture — floor / table / pendant lamps. Owner: modeler.
// userData.lights: positions are inside the shades; colour warm 2700 K.
import * as THREE from '../../../vendor/three/three.module.js';
import { Builder, softBox, lathe, smoothProfile, slab, ellipseShape, tube, roundLeg, segs, V3, clamp, cm } from './geom.js';

const WARM = '#ffd2a1';

/** Shade UVs: u = arc length (m), v = 0..1 bottom→top (drives the lit-shade emissive falloff map). */
/** u = metres around; v = 0..1 up the shade (glow maps), or metres up it when `metric` (woven rattan). */
function shadeUV(g, R, metric = false) {
  const pos = g.attributes.position, uv = g.attributes.uv;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const span = metric ? 1 : Math.max(1e-4, y1 - y0), L = 2 * Math.PI * R;
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
  // woven shades (R4-11): the glow leaks through the whole weave — a soft side/up point light lights the ceiling and
  // the wall around the pendant (no shadow: the pattern needs a light cookie, see engine.md)
  if (kind === 'woven') out.push({ type: 'point', position: [x, ly + h * 0.25, z], color: col, intensity: I * 0.3, distance: distance * 0.7, decay: 2, shadow: false });
  out.push({ type: 'point', position: [x, ly, z], color: col, intensity: I * 0.1, distance: 1.2, decay: 2, shadow: false });
  return out;
}

function shadeMatFor(c, p, color) {
  const kind = String(p.shadeMaterial || p.shadeFabric || '').toLowerCase();
  if (kind.includes('paper') || String(p.shape || '').includes('paper')) return c.mat('paper-shade', { color });
  if (kind.includes('rattan') || kind.includes('cane')) return c.mat('rattan', { open: true, scale: 0.3 });
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
    // woven rattan (R3-08): one double-sided shell in metric UVs (6–8 mm weave, alpha gaps), no inner skin
    const woven = /rattan/.test(mat?.name || '');
    b.add(shadeUV(g, R, woven), mat, { pos: [0, yb, 0], uv: 'keep' });
    const gi = lathe(prof.map(([r, y]) => [r * 0.985, y - 0.002]).reverse(), seg);
    if (wave) { const pa = gi.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getZ(i), y = pa.getY(i); const a = Math.atan2(z, x); const k = 1 + wave * Math.sin(a * 6) * (1 - y / h); pa.setX(i, x * k); pa.setZ(i, z * k); } gi.computeVertexNormals(); }
    if (!woven) b.add(shadeUV(gi, R), inner || c.mat('metal-white'), { pos: [0, yb, 0], uv: 'keep' });
    // R4-11: at night the bulb's glow fills the woven dome — an emissive inner shell (hidden by day, casts nothing),
    // seen through the gaps and from below, behind the strands' own warm translucency
    else b.add(lathe(prof.map(([r, y]) => [r * 0.95, y * 0.96 - 0.004]).reverse(), segs(48, 24)), c.mat('shade-glow'), { pos: [0, yb, 0], uv: 'none', cast: false });
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

function spider(b, mat, { R, y, hubY, style = '' }) {
  // closed-top shades (dome, bell, mushroom, globe) hang from their apex: one short stem inside the shell — arms
  // aimed at a drum's top rim would pierce the curved shell (R3-08 "wire spikes")
  if (/dome|bell|mushroom|globe|sphere|ball/.test(String(style))) {
    const y0 = y - (y - hubY) * 1.35, len = Math.max(0.01, y - 0.006 - y0); // reaches down to the stem / pole top
    b.add(new THREE.CylinderGeometry(0.004, 0.004, len, 8), mat, { pos: [0, y0 + len / 2, 0], cast: false });
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), mat, { pos: [0, hubY, 0] });
    return;
  }
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

// ---------------------------------------------------------------- flex + plug (round 5: the FOCUS turntable shows backs)
//
// A real lamp's flex leaves the base at the back and lies on the floor / table. Cords are their own meshes tagged
// 'cord' (userData.noFit + cord): the fit, pivot and bounds ignore them. Without a host they stay inside the
// footprint and end in a UK (BS 1363) plug lying in a rear corner; on a host (table lamp on a nightstand) the flex
// runs to the host's back edge and drops over it.

/** Light flex for light bases, near-black otherwise. */
function cordColor(c, baseKey, baseColor) {
  const k = String(baseKey || '');
  if (baseColor && /^#/.test(baseColor) && !/brass|gold|black|walnut|teak/.test(k)) {
    const col = new THREE.Color(baseColor);
    if (col.r * 0.3 + col.g * 0.59 + col.b * 0.11 > 0.45) return '#e9e5de';
  }
  return /white|ceram|paint|plaster|oak-white|ash-light|travert|marble|opal|paper|stone/.test(k) ? '#e9e5de' : '#1d1b19';
}

/**
 * Flex along `pts` (Vector3[], the first point inside the base), a strain-relief sleeve at the exit and, if `plug`
 * ({ x, z, yaw }), a plug lying flat at the end. All parts tagged 'cord'. r = flex radius (2.6 mm).
 */
function addCord(b, c, { pts, color, plug = null, r = 0.0026 }) {
  const mat = c.mat('cord', { color });
  let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  b.add(new THREE.TubeGeometry(curve, segs(Math.max(24, Math.round(L / 0.01)), 10), r, segs(8, 5), false), mat, { uv: 'none', tag: 'cord' });
  // strain relief at the base exit (slightly fatter, tapered), along the first tangent
  const t0 = curve.getTangentAt(0.0001), p0 = curve.getPointAt(Math.min(0.5, 0.012 / Math.max(L, 0.02)));
  const sl = new THREE.CylinderGeometry(r * 1.25, r * 1.7, 0.016, segs(10, 6));
  sl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, -1, 0), t0)); // narrow end along the flex
  b.add(sl, mat, { pos: [p0.x, p0.y, p0.z], uv: 'none', tag: 'cord' });
  // the far end: rounded cap, or a plug
  const end = pts[pts.length - 1];
  if (!plug) { b.add(new THREE.SphereGeometry(r, segs(8, 5), segs(6, 4)), mat, { pos: [end.x, end.y, end.z], uv: 'none', tag: 'cord' }); return; }
  const light = new THREE.Color(color).r > 0.5;
  const body = c.mat(light ? 'plastic-white' : 'rubber', light ? {} : { color: '#1f1d1b' });
  const pin = c.mat('metal-nickel');
  const m = new THREE.Matrix4().makeRotationY(plug.yaw);
  const at = (x, y, z) => V3(x, y, z).applyMatrix4(m).add(V3(plug.x, 0, plug.z));
  // BS 1363 plug lying on its face: 45 × 51 mm body, 22 mm thick, cord grip at the back (−local z), pins forward
  const bodyG = softBox(0.045, 0.022, 0.051, { r: 0.004, seg: 2 }); bodyG.applyMatrix4(m);
  const bc = at(0, 0.011, 0);
  b.add(bodyG, body, { pos: [bc.x, bc.y, bc.z], uv: 'none', tag: 'cord' });
  const grip = new THREE.CylinderGeometry(0.0045, 0.006, 0.012, segs(10, 6)).rotateX(Math.PI / 2); grip.applyMatrix4(m);
  const gc = at(0, 0.0075, -0.0305);
  b.add(grip, body, { pos: [gc.x, gc.y, gc.z], uv: 'none', tag: 'cord' });
  for (const [px, py, w, h, l] of [[-0.011, 0.006, 0.0063, 0.004, 0.0177], [0.011, 0.006, 0.0063, 0.004, 0.0177], [0, 0.017, 0.004, 0.008, 0.0227]]) {
    const pg = new THREE.BoxGeometry(w, h, l); pg.applyMatrix4(m);
    const q = at(px, py, 0.0255 + l / 2);
    b.add(pg, pin, { pos: [q.x, q.y, q.z], uv: 'none', tag: 'cord' });
  }
  return at(0, 0.0075, -0.037); // where the flex enters the grip
}

/**
 * Route a flex from the base exit (ex, ey, ez — at the base's back) to a plug in a rear corner of the footprint
 * (W × D), lying on the surface y = 0. side = ±1 picks the corner.
 */
function floorCord(b, c, { ex, ey, ez, W, D, color, side = 1, via = null }) {
  const r = 0.0026;
  const cx = side * Math.max(0.03, W / 2 - 0.045), cz = -Math.max(0.04, D / 2 - 0.045);
  // plug points away from the lamp, diagonally into the corner
  const yaw = Math.atan2(cx - ex, cz - ez);
  const plugEnd = V3(cx - Math.sin(yaw) * 0.037, r, cz - Math.cos(yaw) * 0.037);
  const pts = [V3(ex, ey, ez + 0.006)];
  if (via) pts.push(...via);
  else pts.push(V3(ex, Math.max(r, ey * 0.45), ez - 0.012));
  const mid = V3((pts[pts.length - 1].x + plugEnd.x) / 2 - side * 0.012, r, (pts[pts.length - 1].z + plugEnd.z) / 2 + 0.004);
  pts.push(V3(pts[pts.length - 1].x + (mid.x - pts[pts.length - 1].x) * 0.4, r, pts[pts.length - 1].z - 0.02), mid, V3(plugEnd.x - Math.sin(yaw) * 0.018, r, plugEnd.z - Math.cos(yaw) * 0.018), plugEnd);
  const plug = { x: cx - Math.sin(yaw) * 0.0005, z: cz, yaw };
  addCord(b, c, { pts, color, plug, r });
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
    // flex: out of the hub, down behind the rear leg (clipped to it), then across the floor to the plug
    const a2 = (2 / 3) * Math.PI * 2 + Math.PI / 6, foot = V3(Math.cos(a2) * R * 0.95, 0, Math.sin(a2) * R * 0.95);
    // (runs on the inner face of the leg: the flex stays inside the footprint)
    const off = (t) => { const q = V3(0, legTop, 0).lerp(foot, t); return V3(q.x, q.y, q.z + 0.013); };
    floorCord(b, c, { ex: 0, ey: legTop - 0.02, ez: -0.012, W: c.W, D: c.D, color: cordColor(c, baseKey, p.baseColor), side: 1,
      via: [off(0.15), off(0.5), off(0.86), V3(foot.x + 0.012, 0.004, foot.z + 0.045)] });
  } else if (stem.includes('turn')) {
    // turned wooden column with beads on a round foot
    const top = yb + sh * 0.4;
    const prof = [[0.001, 0], [0.13, 0], [0.13, 0.02], [0.11, 0.035], [0.035, 0.06]];
    const n = 5;
    for (let i = 0; i < n; i++) { const y0 = 0.06 + (i / n) * (top - 0.08), y1 = 0.06 + ((i + 1) / n) * (top - 0.08); prof.push([0.022, y0 + (y1 - y0) * 0.15], [0.034, y0 + (y1 - y0) * 0.5], [0.022, y0 + (y1 - y0) * 0.85]); }
    prof.push([0.014, top], [0.001, top]);
    b.add(lathe(smoothProfile(prof, 90), 28), baseMat, { uv: 'cyl' });
    floorCord(b, c, { ex: 0, ey: 0.012, ez: -0.122, W: c.W, D: c.D, color: cordColor(c, baseKey, p.baseColor) });
  } else {
    const br = clamp(R * 0.75, 0.11, 0.17);
    b.add(slab(ellipseShape(br * 2, br * 2), 0.024, { bevel: 0.007, bevelSeg: 4 }), baseMat, {});
    b.add(new THREE.CylinderGeometry(0.0095, 0.0095, yb + sh * 0.4 - 0.024, 14), baseMat, { pos: [0, 0.024 + (yb + sh * 0.4 - 0.024) / 2, 0], axis: 'y' });
    b.add(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 14), baseMat, { pos: [0, 0.04, 0] });
    floorCord(b, c, { ex: 0, ey: 0.01, ez: -br + 0.004, W: c.W, D: c.D, color: cordColor(c, baseKey, p.baseColor) });
  }
  const rim = c.mat(/brass|gold/.test(baseKey) ? 'metal-brass' : 'metal-black');
  const ly = addShade(b, c, { style, R, h: sh, yb, mat: shade, rimMat: rim });
  spider(b, rim, { R: style.includes('cone') ? R * 0.68 : style.includes('pleat') ? R * 0.8 : R, y: yb + sh, hubY: yb + sh * 0.55, style });
  bulb(b, c, ly + 0.02, 0.028);
  const kind = /globe|sphere/.test(style) ? 'globe' : /dome|bell/.test(style) ? (/rattan/.test(shade?.name || '') ? 'woven' : 'dome') : 'open';
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
  floorCord(b, c, { ex: 0, ey: foot * 0.5, ez: -(R + 0.005) + 0.004, W: Math.max(c.W, 0.3), D: Math.max(c.D, 0.3), color: '#1d1b19' });
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
  { const g0 = new Builder(c.seed + 2); floorCord(g0, c, { ex: 0, ey: 0.01, ez: -br + 0.004, W: 2 * br + 0.08, D: c.D, color: cordColor(c, p.base || p.frame, p.baseColor), side: 1 });
    const cg = g0.build('cord'); for (const m of cg.children) { m.geometry.translate(-armL / 2, 0, 0); b.addObject(m); } }
  b.add(new THREE.CylinderGeometry(0.009, 0.009, stemTop - 0.02, 14), baseMat, { pos: [-armL / 2, 0.02 + (stemTop - 0.02) / 2, 0], axis: 'y' });
  b.add(tube([V3(-armL / 2, stemTop - 0.03, 0), V3(-armL / 2 + 0.02, stemTop, 0), V3(armL / 2 - 0.02, stemTop, 0), V3(armL / 2, stemTop - 0.03, 0)], 0.007, { tubular: 24, radial: 8, tension: 0.2 }), baseMat, {});
  b.add(new THREE.SphereGeometry(0.014, 12, 8), baseMat, { pos: [-armL / 2, stemTop - 0.03, 0] });
  const yb = stemTop - 0.05 - sh;
  b.add(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 8), baseMat, { pos: [armL / 2, stemTop - 0.06, 0] });
  const g = new Builder(c.seed + 1);
  const ly = addShade(g, c, { style, R, h: sh, yb, mat: shade, rimMat: baseMat });
  spider(g, baseMat, { R: style.includes('cone') ? R * 0.68 : R, y: yb + sh, hubY: yb + sh * 0.6, style });
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

/** Table-lamp flex: on a host top it runs to the host's back edge and drops over it; alone it ends in a plug. */
function tableCord(b, c, { rb, color }) {
  const r = 0.0026, ez = -rb + 0.004;
  const hd = c.host && Number(c.host.d) > 0.15 ? Number(c.host.d) : 0;
  if (!hd) { floorCord(b, c, { ex: 0, ey: 0.006, ez, W: Math.max(c.W, 0.22), D: Math.max(c.D, 0.22), color, side: 1 }); return; }
  const edge = -hd / 2 + 0.004, k = 0.016; // rounds the back edge (bend radius ≈ 1.6 cm), then hangs 7 cm
  const x1 = 0.035;
  const pts = [V3(0, 0.006, ez + 0.006), V3(0.004, r, ez - 0.014), V3(x1 * 0.7, r, (ez + edge) / 2), V3(x1, r, edge + k),
    V3(x1, r - k * 0.3, edge + k * 0.15), V3(x1 + 0.004, -k * 0.9, edge - k * 0.35), V3(x1 + 0.01, -0.075, edge - k * 0.55)];
  addCord(b, c, { pts, color, r });
}

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
    tableCord(b, c, { rb: R * 0.45, color: cordColor(c, baseKey, p.baseColor) });
    const ly = addShade(b, c, { style: 'mushroom', R, h: dh * 0.75, yb: H - dh * 0.75, mat: shade, rimMat: baseMat });
    bulb(b, c, ly, 0.02);
    return { group: b.build('table_lamp'), lights: shadeLights({ ly, yb: H - dh * 0.75, h: dh * 0.75, Rb: R, I: 0.6, kind: 'dome', distance: 3 }) };
  }
  const fn = BASE_SHAPES[Object.keys(BASE_SHAPES).find((k) => shapeName.includes(k)) || 'gourd'];
  const br = Math.min(R * 0.55, 0.11);
  const bprof = fn(bh, br);
  const lg = lathe(smoothProfile(bprof, 36), shapeName.includes('rib') ? 96 : 44);
  tableCord(b, c, { rb: bprof[1][0] * (shapeName.includes('rib') ? 1.03 : 1), color: cordColor(c, baseKey, p.baseColor) });
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
  spider(b, rim, { R: style.includes('cone') ? R * 0.68 : style.includes('pleat') ? R * 0.8 : R, y: yb + sh, hubY: yb + sh * 0.6, style });
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
  else if (shape.includes('rattan') || shape.includes('wicker') || shape.includes('hyacinth')) mat = c.mat('rattan', { color: p.shadeColor || undefined, open: true, scale: 0.3 });
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
  } else lights = shadeLights({ ly, yb: top - h, h, Rb: R, kind: /rattan|wicker|hyacinth/.test(shape) ? 'woven' : 'dome', distance: 5 });
  return {
    group: b.build('pendant_lamp'),
    anchors: { mount: V3(0, 0, 0), bottom: V3(0, top - h, 0) },
    lights,
  };
}
