// Villar furniture — tabletop detail sets: tableware, centerpiece, kitchen_decor. Owner: modeler.
//
// All three sit on a surface: origin = centre of the surface footprint at the surface height (y = 0),
// front (+Z) = the side people stand/sit, back (−Z) = wall side for kitchen_decor. They are NOT rescaled to
// item.dims (real object sizes are kept); dims only bound the layout. Deterministic (seeded by item id).
import * as THREE from 'three';
import { rng } from '../textures.js';
import { Builder, lathe, smoothProfile, tube, softBox, slab, roundedRectShape, ellipseShape, V3, clamp, lerp, cm, segs } from './geom.js';
import { fabricMat } from './parts.js';

const _M = () => new THREE.Matrix4();
const TRS = (x, y, z, ry = 0, rx = 0, rz = 0, s = 1) => _M().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(s, s, s));

/** Ceramic / stoneware / porcelain / glass dish material from params. */
function dishMat(c, material, color) {
  const m = String(material || 'stoneware').toLowerCase();
  if (/glass/.test(m)) return c.mat('glass-clear', { color: color || '#f4f6f3', thickness: 0.004 });
  if (/terracotta|clay/.test(m)) return c.mat('terracotta', { color });
  if (/matte|bisque/.test(m)) return c.mat('ceramic-matte', { color: color || '#ECE6DC' });
  if (/porcelain|glazed|gloss/.test(m)) return c.mat('ceramic-glazed', { color: color || '#F3F1EC' });
  return c.mat('stoneware', { color: color || '#E9E2D6' });
}

function cutleryMat(c, kind) {
  const k = String(kind || 'steel').toLowerCase();
  if (/brass|gold/.test(k)) return c.mat('metal-brass-brushed');
  if (/black|matte/.test(k)) return c.mat('metal-black', { roughness: 0.4 });
  if (/wood/.test(k)) return c.mat('walnut-medium');
  return c.mat('metal-nickel', { roughness: 0.35 });
}

// -------------------------------------------------------------- dishes (lathe profiles, [r, y])

function plateProfile(R, rim) {
  const r = String(rim || 'coupe');
  if (/rim(?!less)|wide|classic/.test(r)) return smoothProfile([[0.001, 0], [R * 0.45, 0], [R * 0.5, 0.004], [R * 0.64, 0.006], [R * 0.72, 0.016], [R * 0.97, 0.022], [R, 0.025], [R * 0.975, 0.0275], [R * 0.72, 0.0205], [R * 0.64, 0.0105], [R * 0.3, 0.0095], [0.001, 0.0095]], 28);
  if (/organic|wavy|reactive|raw/.test(r)) return smoothProfile([[0.001, 0], [R * 0.5, 0], [R * 0.55, 0.004], [R * 0.86, 0.012], [R * 0.99, 0.022], [R * 0.985, 0.0255], [R * 0.94, 0.0225], [R * 0.82, 0.0145], [R * 0.4, 0.0105], [0.001, 0.0105]], 24);
  if (/flat|lip/.test(r)) return smoothProfile([[0.001, 0], [R * 0.6, 0], [R * 0.64, 0.004], [R * 0.93, 0.008], [R, 0.017], [R * 0.985, 0.0195], [R * 0.92, 0.0115], [R * 0.4, 0.0095], [0.001, 0.0095]], 36);
  // coupe (rimless, rounded)
  return smoothProfile([[0.001, 0], [R * 0.42, 0], [R * 0.46, 0.004], [R * 0.78, 0.009], [R * 0.97, 0.021], [R, 0.0245], [R * 0.982, 0.0265], [R * 0.94, 0.0225], [R * 0.74, 0.0125], [R * 0.4, 0.0098], [0.001, 0.0098]], 24);
}
function bowlProfile(R, h) {
  return smoothProfile([[0.001, 0], [R * 0.48, 0], [R * 0.52, 0.006], [R * 0.84, h * 0.42], [R, h], [R * 0.965, h + 0.0025], [R * 0.93, h * 0.96], [R * 0.79, h * 0.46], [R * 0.45, 0.011], [0.001, 0.011]], 24);
}
/** Wobble a lathe slightly (hand-thrown look): radius × (1 + a·sin(kθ+φ)). */
function handmade(g, amp, seed) {
  const r = rng(seed), k = 2 + ((r() * 2) | 0), ph = r() * 6.28;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const a = Math.atan2(z, x); const s = 1 + amp * Math.sin(k * a + ph) + amp * 0.5 * Math.sin((k + 3) * a + ph * 2); p.setX(i, x * s); p.setZ(i, z * s); }
  g.computeVertexNormals();
  return g;
}

function glassGeom(kind) {
  const k = String(kind || 'tumbler');
  if (/wine|stem/.test(k)) {
    return lathe(smoothProfile([[0.001, 0], [0.036, 0], [0.037, 0.002], [0.034, 0.003], [0.006, 0.006], [0.0035, 0.02], [0.0035, 0.085], [0.012, 0.096], [0.036, 0.13], [0.04, 0.17], [0.036, 0.205], [0.0345, 0.205], [0.0385, 0.17], [0.0345, 0.132], [0.011, 0.1], [0.001, 0.098]], 32), 32);
  }
  // tumbler: heavy base, slight taper
  return lathe([[0.001, 0], [0.033, 0], [0.0345, 0.003], [0.0385, 0.1], [0.0365, 0.1], [0.0328, 0.012], [0.001, 0.012]], 32);
}

// -------------------------------------------------------------- cutlery (flat extrusions lying on the table)

function flatPiece(outline, t = 0.0025, holes = []) {
  const s = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 1, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); // shape y → −z (length runs away from the diner), extrusion → +y
  g.translate(0, 0.0006, 0);
  // gentle lift toward both ends (real cutlery is curved)
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setY(i, p.getY(i) + Math.pow(Math.abs(z + 0.1) / 0.1, 2) * 0.004); }
  g.computeVertexNormals();
  return g;
}
const handle = (w0, w1, L) => [[-w0 / 2, 0], [w0 / 2, 0], [w1 / 2, L], [-w1 / 2, L]];
function knifeGeom() {
  return flatPiece([[-0.0085, 0], [0.0085, 0.0], [0.009, 0.006], [0.006, 0.105], [0.0095, 0.115], [0.011, 0.19], [0.006, 0.215], [-0.003, 0.22], [-0.006, 0.2], [-0.006, 0.115], [-0.006, 0.105], [-0.009, 0.006]], 0.0028);
}
function forkGeom() {
  const pts = [[-0.008, 0], [0.008, 0], [0.008, 0.005], [0.0035, 0.11], [0.012, 0.135], [0.0125, 0.2]];
  // four tines along the top edge (right to left)
  const tw = 0.0042, gap = (0.025 - 4 * tw) / 3;
  for (let i = 0; i < 4; i++) {
    const x1 = 0.0125 - i * (tw + gap), x0 = x1 - tw;
    pts.push([x1, 0.2], [x1 - 0.0008, 0.2], [x0 + 0.0008, 0.2], [x0, 0.2]);
    if (i < 3) pts.push([x0, 0.16], [x0 - gap, 0.16]);
  }
  pts.push([-0.0125, 0.135], [-0.012, 0.135], [-0.0035, 0.11], [-0.008, 0.005]);
  // dedupe consecutive
  const out = []; for (const q of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-5) out.push(q); }
  return flatPiece(out, 0.0024);
}
function spoonGeom() {
  const g1 = flatPiece([...handle(0.016, 0.006, 0.12)].concat([]), 0.0024);
  // bowl: half ellipsoid shell
  const bowl = new THREE.SphereGeometry(1, segs(16, 8), segs(8, 4), 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bowl.scale(0.021, 0.008, 0.032); bowl.translate(0, 0.009, -0.152);
  const rim = new THREE.TorusGeometry(1, 0.06, 4, segs(24, 10)); rim.rotateX(Math.PI / 2); rim.scale(0.021, 0.02, 0.032); rim.translate(0, 0.009, -0.152);
  return [g1, bowl, rim];
}

// -------------------------------------------------------------- napkin: soft folded linen with a slight drape

function napkinGeom(w, d, t, seed) {
  const g = softBox(w, t, d, { r: Math.min(0.004, t / 2.2), seg: 2, cell: 0.02, wrinkle: 0.0012, seed, bulge: { top: 0.0015 } });
  const r = rng(seed), ph = r() * 6.28;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) + 0.0015 * Math.sin(x * 40 + ph) * Math.sin(z * 30)); }
  g.computeVertexNormals();
  return g;
}

// -------------------------------------------------------------- tableware

/**
 * tableware — place settings for the dining table. Params: settings (2), colors[] (plates, accent), material
 * stoneware|porcelain|ceramic-matte|terracotta|glass, rim coupe|rimmed|flat|organic, bowl bool (true),
 * glass tumbler|wine, glassColor, cutlery steel|brass|black|wood, napkinColor, napkinFabric, placemat
 * none|linen|jute|rattan|leather, placematColor, axis 'x' (settings face ±X, default — chairs at the table's
 * ends) | 'z'. ctx.host = { w, d } of the table top places the settings 4 cm in from the edge.
 */
export function tableware(c) {
  const p = c.params;
  const b = new Builder(c.seed);
  const r = rng(c.seed + 5);
  const cols = p.colors && p.colors.length ? p.colors : ['#E9E2D6', '#CDBFA8'];
  const n = clamp(Math.round(p.settings ?? 2), 1, 6);
  const axis = String(p.axis || 'x');
  const hw = c.host?.w || c.W || 1, hd = c.host?.d || c.D || 1;
  const reach = (axis === 'z' ? hd : hw) / 2;
  const plateR = clamp(cm(p.plateDiameter, 0.27) / 2, 0.12, 0.15);
  const dist = Math.max(0.12, reach - plateR - 0.04);
  const plateMat = dishMat(c, p.material, cols[0]);
  const sideMat = dishMat(c, p.material, cols[1] || cols[0]);
  const bowlMat = dishMat(c, p.bowlMaterial || p.material, cols[2] || cols[1] || cols[0]);
  const glassMat = c.mat(/amber/.test(String(p.glassColor || '')) ? 'glass-amber' : 'glass-clear', { thickness: 0.003, color: /^#/.test(p.glassColor || '') ? p.glassColor : undefined });
  const cut = cutleryMat(c, p.cutlery);
  const napMat = fabricMat(c, p.napkinFabric || 'linen', p.napkinColor || '#D8CDBB');
  const pm = String(p.placemat || 'none').toLowerCase();
  const placeMat = pm === 'none' || pm === 'false' ? null : /jute|rattan|seagrass|woven/.test(pm) ? c.mat(/rattan/.test(pm) ? 'rattan' : 'jute', { color: p.placematColor }) : /leather/.test(pm) ? c.mat('leather-cognac', { color: p.placematColor || '#7a5a40' }) : fabricMat(c, 'linen', p.placematColor || '#CFC3AE');
  const rim = p.rim || 'coupe';
  const pl = handmade(lathe(plateProfile(plateR, rim), 40), /organic|raw|reactive/.test(rim) ? 0.012 : 0.002, c.seed + 1);
  const sp = handmade(lathe(plateProfile(plateR * 0.76, rim), 32), /organic|raw|reactive/.test(rim) ? 0.012 : 0.002, c.seed + 2);
  const bw = p.bowl === false ? null : handmade(lathe(bowlProfile(0.074, 0.058), 32), 0.006, c.seed + 3);
  const gl = glassGeom(p.glass);
  const kn = knifeGeom(), fk = forkGeom(), spn = spoonGeom();
  for (let i = 0; i < n; i++) {
    // settings around the table: n = 2 → opposite ends of the axis; more → spread round
    const a = n === 2 ? (i === 0 ? 0 : Math.PI) : (i / n) * Math.PI * 2;
    const ang = axis === 'z' ? a : a + Math.PI / 2;
    // setting frame: the diner sits at +Z of the setting, looking −Z toward the table centre
    const S = TRS(Math.sin(ang) * dist, 0, Math.cos(ang) * dist, ang);
    const at = (m) => S.clone().multiply(m);
    let y = 0;
    if (placeMat) {
      const shape = /round/.test(pm) ? ellipseShape(0.38, 0.38) : roundedRectShape(0.44, 0.32, 0.02);
      b.add(slab(shape, 0.004, { bevel: 0.0015 }), placeMat, { matrix: at(TRS(0, 0, -0.01)) });
      y = 0.004;
    }
    const jitter = () => (r() - 0.5) * 0.008;
    b.add(pl.clone(), plateMat, { matrix: at(TRS(jitter(), y, jitter(), r() * 6.28)) });
    b.add(sp.clone(), sideMat, { matrix: at(TRS(0, y + 0.0098, 0, r() * 6.28)) });
    if (bw) b.add(bw.clone(), bowlMat, { matrix: at(TRS(0, y + 0.0098 + 0.0096, 0, r() * 6.28)) });
    // napkin: folded rectangle under the fork (left), or rolled on the plate when napkinStyle = 'plate'
    const nx = -(plateR + 0.075);
    if (String(p.napkinStyle || 'left') === 'plate' && !bw) b.add(napkinGeom(0.13, 0.2, 0.008, c.seed + i), napMat, { matrix: at(TRS(0, y + 0.03, 0, 0.1)), uv: 'box' });
    else b.add(napkinGeom(0.12, 0.21, 0.007, c.seed + i), napMat, { matrix: at(TRS(nx, y, 0.01, (r() - 0.5) * 0.05)) });
    // cutlery: fork on the napkin (left), knife (blade in) and spoon on the right
    b.add(fk.clone(), cut, { matrix: at(TRS(nx + 0.012, y + 0.0075, 0.1, (r() - 0.5) * 0.03)) });
    b.add(kn.clone(), cut, { matrix: at(TRS(plateR + 0.028, y, 0.105, (r() - 0.5) * 0.03, 0, 0)) });
    for (const g of spn) b.add(g.clone(), cut, { matrix: at(TRS(plateR + 0.058, y, 0.115, (r() - 0.5) * 0.03)) });
    // glass above the knife
    b.add(gl.clone(), glassMat, { matrix: at(TRS(plateR + 0.04, y, -plateR - 0.01)), uv: 'none' });
  }
  return { group: b.build('tableware'), anchors: { top: V3(0, 0.03, 0) } };
}

// -------------------------------------------------------------- centerpiece

function vaseProfile(kind, R, H) {
  const k = String(kind || 'bottle');
  if (/bud|bottle|narrow/.test(k)) return smoothProfile([[0.001, 0], [R * 0.8, 0], [R, H * 0.08], [R, H * 0.45], [R * 0.45, H * 0.72], [R * 0.3, H * 0.9], [R * 0.34, H], [R * 0.27, H], [R * 0.24, H * 0.88], [R * 0.38, H * 0.72], [R * 0.86, H * 0.45], [R * 0.86, H * 0.1], [0.001, H * 0.06]], 32);
  if (/round|sphere|moon/.test(k)) return smoothProfile([[0.001, 0], [R * 0.45, 0], [R * 0.9, H * 0.2], [R, H * 0.5], [R * 0.8, H * 0.85], [R * 0.38, H * 0.97], [R * 0.4, H], [R * 0.33, H], [R * 0.31, H * 0.95], [R * 0.7, H * 0.82], [R * 0.86, H * 0.5], [R * 0.4, H * 0.08], [0.001, H * 0.07]], 32);
  if (/amphora|urn/.test(k)) return smoothProfile([[0.001, 0], [R * 0.45, 0], [R * 0.5, H * 0.05], [R, H * 0.4], [R * 0.75, H * 0.75], [R * 0.45, H * 0.88], [R * 0.55, H], [R * 0.48, H], [R * 0.38, H * 0.88], [R * 0.66, H * 0.75], [R * 0.9, H * 0.4], [R * 0.4, H * 0.07], [0.001, H * 0.06]], 32);
  // cylinder / tall
  return [[0.001, 0], [R * 0.96, 0], [R, 0.004], [R, H], [R * 0.9, H], [R * 0.9, H * 0.05], [0.001, H * 0.05]];
}

/** Dried / fresh stems in a vase: olive branch, eucalyptus, pampas, grass, tulip, ranunculus. */
function addStems(b, c, { kind, n, x0, y0, z0, H, spread, r }) {
  const k = String(kind || 'olive').toLowerCase();
  const stemMat = c.mat('plant-stem', { color: /pampas|grass|dried|bunny/.test(k) ? '#b89f78' : '#5d6b42' });
  const leafCol = /eucal/.test(k) ? '#8aa596' : /olive/.test(k) ? '#7f8f68' : /dried|grass|pampas|bunny/.test(k) ? '#c9b48e' : '#55703f';
  const leafMat = c.mat('plant-leaf', { color: leafCol, roughness: /eucal/.test(k) ? 0.6 : 0.5 });
  const flowerCol = String(c.params.flowerColor || (/tulip/.test(k) ? '#E9D9C6' : '#F1E8DA'));
  const flowerMat = c.mat('fabric-cotton', { color: flowerCol });
  const leafG = (L, Wd) => {
    const g = new THREE.PlaneGeometry(Wd, L, 1, 2); g.translate(0, L / 2, 0);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const v = p.getY(i) / L; p.setX(i, p.getX(i) * Math.sin(Math.PI * Math.min(1, 0.08 + v)) ** 0.7); p.setZ(i, -v * v * L * 0.25); }
    g.computeVertexNormals(); return g;
  };
  const tmpl = /eucal/.test(k) ? leafG(0.035, 0.034) : /olive/.test(k) ? leafG(0.06, 0.011) : leafG(0.09, 0.012);
  for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI * 2 + r() * 0.8;
    const lean = spread * (0.5 + r() * 0.7);
    const top = V3(x0 + Math.cos(a) * lean, y0 + H * (0.75 + r() * 0.35), z0 + Math.sin(a) * lean);
    const mid = V3(x0 + Math.cos(a) * lean * 0.35, lerp(y0, top.y, 0.55), z0 + Math.sin(a) * lean * 0.35);
    const base = V3(x0 + Math.cos(a) * 0.006, y0 - 0.05, z0 + Math.sin(a) * 0.006);
    const crv = new THREE.CatmullRomCurve3([base, mid, top]);
    b.add(new THREE.TubeGeometry(crv, segs(14, 6), /pampas|grass/.test(k) ? 0.0016 : 0.0022, 4, false), stemMat, { uv: 'box' });
    if (/pampas|bunny/.test(k)) {
      // plume: soft elongated tuft
      const plume = new THREE.SphereGeometry(1, segs(10, 6), segs(8, 4)); plume.scale(0.022, 0.09, 0.022);
      const dir = crv.getTangentAt(1);
      b.add(plume, c.mat('fabric-boucle', { color: '#E2D5BF' }), { matrix: _M().compose(top.clone().addScaledVector(dir, 0.06), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir), V3(1, 1, 1)) });
      continue;
    }
    if (/tulip|ranunc|rose|flower|peony/.test(k)) {
      const head = lathe(smoothProfile([[0.001, -0.002], [0.012, 0.004], [0.019, 0.02], [0.017, 0.04], [0.012, 0.048], [0.008, 0.044]], 16), 14);
      const dir = crv.getTangentAt(1);
      b.add(head, flowerMat, { matrix: _M().compose(top, new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir), V3(1, 1, 1)) });
    }
    // leaves along the stem
    const nl = /eucal/.test(k) ? 9 : /olive/.test(k) ? 14 : /tulip/.test(k) ? 2 : 6;
    for (let j = 0; j < nl; j++) {
      const t = /tulip/.test(k) ? 0.25 + j * 0.2 : 0.3 + 0.68 * (j / nl);
      const pt = crv.getPointAt(t), tan = crv.getTangentAt(t);
      const side = j % 2 ? 1 : -1;
      const perp = V3(-tan.z, 0, tan.x).normalize().multiplyScalar(side);
      const ld = /eucal/.test(k) ? perp.clone().add(V3(0, -0.4, 0)).normalize() : tan.clone().multiplyScalar(0.7).add(perp).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), ld);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), r() * Math.PI));
      const sc = /tulip/.test(k) ? 1.8 : 0.8 + r() * 0.4;
      b.add(tmpl.clone(), leafMat, { matrix: _M().compose(pt, q, V3(sc, sc, sc)), uv: 'none' });
    }
  }
}

/**
 * centerpiece — style vase|candles|bowl. vase: vase round|bottle|cylinder|amphora, vaseMaterial
 * (stoneware|terracotta|glass|travertine|ceramic-glazed), vaseColor, stems olive|eucalyptus|pampas|tulip|
 * ranunculus|grass|none, stemCount, flowerColor. candles: count (3), candleColor, holder tray|plate|
 * candlesticks, holderMaterial. bowl: bowlMaterial + fruit[] (lemon|orange|green-apple|pear|fig).
 */
export function centerpiece(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const r = rng(c.seed + 9);
  const style = String(p.style || (p.candles ? 'candles' : 'vase')).toLowerCase();
  const lights = [];
  if (/candle/.test(style)) {
    const nC = clamp(Math.round(p.count ?? 3), 1, 5);
    const hold = String(p.holder || 'tray').toLowerCase();
    const hm = c.mat(p.holderMaterial || (/brass|stick/.test(hold) ? 'metal-brass-brushed' : 'travertine'));
    const wax = c.mat('wax', { color: p.candleColor || '#EFE7DA' });
    let y0 = 0;
    if (/tray|plate/.test(hold)) {
      const tw = clamp(W, 0.24, 0.45);
      b.add(slab(/round|plate/.test(hold) ? ellipseShape(tw, tw * 0.7) : roundedRectShape(tw, tw * 0.45, 0.03), 0.014, { bevel: 0.004 }), hm, {});
      y0 = 0.014;
    }
    const hs = [0.2, 0.14, 0.1, 0.17, 0.12];
    for (let i = 0; i < nC; i++) {
      const x = (i - (nC - 1) / 2) * 0.085, z = (i % 2 ? 0.02 : -0.015);
      let y = y0;
      if (/stick/.test(hold)) {
        const sh = [0.24, 0.18, 0.28, 0.2, 0.22][i % 5];
        b.add(lathe(smoothProfile([[0.001, 0], [0.04, 0], [0.042, 0.006], [0.012, 0.02], [0.009, sh * 0.5], [0.013, sh * 0.55], [0.008, sh * 0.62], [0.008, sh - 0.012], [0.018, sh - 0.006], [0.017, sh], [0.011, sh], [0.001, sh - 0.004]], 24), 24), hm, { pos: [x, 0, z] });
        y = sh - 0.004;
        b.add(lathe([[0.001, 0], [0.011, 0], [0.011, 0.24], [0.009, 0.245], [0.001, 0.246]], 18), wax, { pos: [x, y, z] });
        y += 0.246;
      } else {
        const h = clamp(H ? H * hs[i % 5] / 0.2 : hs[i % 5], 0.06, 0.3), R = 0.035 + (i % 2) * 0.005;
        // pillar with a melted dish at the top
        b.add(lathe(smoothProfile([[0.001, 0], [R - 0.002, 0], [R, 0.003], [R, h - 0.004], [R - 0.003, h], [R * 0.7, h - 0.006], [0.004, h - 0.009], [0.001, h - 0.009]], 24), 24), wax, { pos: [x, y, z] });
        y += h - 0.009;
      }
      b.add(new THREE.CylinderGeometry(0.0008, 0.001, 0.012, 5).translate(0, 0.006, 0), c.mat('rubber', { color: '#1d1a17' }), { pos: [x, y, z], uv: 'none', cast: false });
      // flame (glows only when the lamps are on, like the shades)
      const fl = lathe(smoothProfile([[0.001, 0], [0.0035, 0.004], [0.004, 0.009], [0.002, 0.018], [0.001, 0.022]], 10), 10);
      b.add(fl, c.mat('flame'), { pos: [x, y + 0.008, z], uv: 'none', cast: false });
      lights.push({ type: 'point', position: [x, y + 0.02, z], color: '#ffb46b', intensity: 0.06, distance: 1.2, decay: 2, shadow: false, flame: true });
    }
    return { group: b.build('centerpiece'), anchors: {}, lights };
  }
  if (/bowl|fruit/.test(style)) {
    const R = clamp(W / 2, 0.1, 0.17);
    const bm = c.mat(p.bowlMaterial || 'walnut-medium', { color: p.bowlColor });
    b.add(lathe(bowlProfile(R, R * 0.42), 40), bm, { uv: /walnut|oak|teak|wood/.test(String(p.bowlMaterial || 'walnut')) ? 'box' : 'box' });
    addFruit(b, c, { cx: 0, cz: 0, y: 0.012, R: R * 0.8, kinds: p.fruit, r });
    return { group: b.build('centerpiece'), anchors: {} };
  }
  // vase with stems
  const vk = p.vase || 'round';
  const vH = clamp(cm(p.vaseHeight, /bottle|bud/.test(vk) ? 0.22 : 0.2), 0.08, 0.45), vR = clamp(cm(p.vaseDiameter, /bottle|bud/.test(vk) ? 0.09 : 0.16) / 2, 0.03, 0.15);
  const vmKey = String(p.vaseMaterial || 'stoneware');
  const vm = /glass/.test(vmKey) ? c.mat('glass-clear', { thickness: 0.004, color: p.vaseColor }) : /terracotta/.test(vmKey) ? c.mat('terracotta', { color: p.vaseColor }) : c.mat(vmKey, { color: p.vaseColor || '#E2D9CB' });
  b.add(handmade(lathe(vaseProfile(vk, vR, vH), 40), 0.006, c.seed + 4), vm, { uv: 'box' });
  if (/glass/.test(vmKey)) b.add(lathe([[0.001, vH * 0.06], [vR * 0.84, vH * 0.06], [vR * 0.84, vH * 0.4], [0.001, vH * 0.4]], 32), c.mat('glass-clear', { color: '#eef2ea', thickness: 0.05 }), { uv: 'none' });
  const stems = String(p.stems || 'olive');
  if (stems !== 'none') addStems(b, c, { kind: stems, n: clamp(Math.round(p.stemCount ?? (/tulip|ranunc/.test(stems) ? 7 : 5)), 1, 14), x0: 0, y0: vH, z0: 0, H: clamp((H || 0.55) - vH, 0.15, 0.6), spread: clamp(W * 0.35, 0.05, 0.25), r });
  return { group: b.build('centerpiece'), anchors: {} };
}

/** Fruit heap in a bowl: spheres with peel normal, slightly squashed, stacked in a rough dome. */
function addFruit(b, c, { cx, cz, y, R, kinds, r }) {
  const list = Array.isArray(kinds) && kinds.length ? kinds : ['lemon', 'orange', 'green-apple'];
  const spec = {
    lemon: { col: '#E3C04A', r: 0.032, sx: 1.25, peel: 1 }, orange: { col: '#E08A2C', r: 0.037, sx: 1, peel: 1 }, 'green-apple': { col: '#9DBA4E', r: 0.036, sx: 0.95, peel: 0 },
    apple: { col: '#B8352B', r: 0.036, sx: 0.95, peel: 0 }, pear: { col: '#C9B45A', r: 0.033, sx: 1, peel: 0, pear: true }, fig: { col: '#5a3a45', r: 0.024, sx: 1, peel: 0 }, lime: { col: '#7FA33A', r: 0.026, sx: 1.1, peel: 1 },
  };
  const n = clamp(Math.round(R / 0.028) + 3, 4, 9);
  const placed = [];
  for (let i = 0; i < n; i++) {
    const k = String(list[i % list.length]).toLowerCase();
    const s = spec[k] || spec.orange;
    let pos = null;
    for (let tries = 0; tries < 30 && !pos; tries++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (R - s.r);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      let yy = y + s.r * 0.9 + (d / R) ** 2 * R * 0.3;
      for (const q of placed) { const dd = Math.hypot(q.x - x, q.z - z); if (dd < q.r + s.r) yy = Math.max(yy, q.y + Math.sqrt(Math.max(0, (q.r + s.r) ** 2 - dd * dd)) * 0.9); }
      if (yy < y + s.r * 2.6) pos = { x, y: yy, z, r: s.r };
    }
    if (!pos) continue;
    placed.push(pos);
    const g = s.pear ? lathe(smoothProfile([[0.001, -s.r], [s.r * 0.8, -s.r * 0.8], [s.r, -s.r * 0.2], [s.r * 0.6, s.r * 0.6], [s.r * 0.4, s.r * 1.3], [0.001, s.r * 1.45]], 16), 18) : new THREE.SphereGeometry(s.r, segs(16, 10), segs(11, 7));
    if (!s.pear) g.scale(s.sx, 0.92, 1);
    const m = c.mat('fruit', { color: s.col, peel: s.peel });
    b.add(g, m, { matrix: TRS(pos.x, pos.y, pos.z, r() * 6.28, (r() - 0.5) * 0.6, (r() - 0.5) * 0.6) });
  }
}

// -------------------------------------------------------------- kitchen_decor

/**
 * kitchen_decor — worktop vignette, laid out left→right along X inside W×D, against the wall (−Z).
 * Params: items[] subset/order of kettle|crock|board|bottles|fruit-bowl|canisters (default all but canisters),
 * kettleColor/kettleMaterial (steel|matte-white|matte-black|brass), crockMaterial/crockColor,
 * board (wood key), fruit[] kinds, bottleTint ('#6a7a3a' oil), canisterMaterial.
 */
export function kitchenDecor(c) {
  const { W, D, params: p } = c;
  const b = new Builder(c.seed);
  const r = rng(c.seed + 13);
  const fp = { board: 0.3, crock: 0.14, kettle: 0.22, bottles: 0.14, 'fruit-bowl': 0.28, canisters: 0.24 };
  const norm = (k) => (/fruit|bowl/.test(k) ? 'fruit-bowl' : /bottle|oil|vinegar/.test(k) ? 'bottles' : /board|chopping|cutting/.test(k) ? 'board' : /crock|utensil/.test(k) ? 'crock' : /canist|jar/.test(k) ? 'canisters' : /kettle/.test(k) ? 'kettle' : k);
  let list = (Array.isArray(p.items) ? p.items : []).map((s) => norm(String(s && typeof s === 'object' ? s.type : s).toLowerCase())).filter((k) => fp[k]);
  if (!list.length) list = ['board', 'crock', 'kettle', 'bottles', 'fruit-bowl'];
  const total = list.reduce((a, k) => a + (fp[k] || 0.15), 0) + 0.05 * (list.length - 1);
  const k0 = Math.min(1, W / total);
  let x = -Math.min(W, total) / 2;
  const back = -D / 2 + 0.06;
  for (const k of list) {
    const w = (fp[k] || 0.15) * k0; const cx = x + w / 2; x += w + 0.05 * k0;
    if (k === 'board') {
      // two boards leaning against the backsplash, the front one smaller
      const wood = c.mat(p.board || 'oak-light');
      const boards = [[0.3, 0.42, 0.018, -0.02], [0.22, 0.32, 0.016, 0.05]];
      boards.forEach(([bw, bh, t, dx], i) => {
        const g = slab(roundedRectShape(bw, bh, 0.03), t, { bevel: 0.004 });
        // handle hole near the top
        g.rotateX(Math.PI / 2); g.translate(0, bh / 2, 0);
        const tilt = -0.17 - i * 0.04;
        b.add(g, wood, { matrix: TRS(cx + dx * k0, 0, -D / 2 + 0.03 + i * 0.03 + Math.sin(-tilt) * bh * 0.5, 0, tilt), axis: 'y' });
      });
    } else if (k === 'crock') {
      const cm2 = c.mat(p.crockMaterial || 'stoneware', { color: p.crockColor || '#D9D0C1' });
      const R = 0.06, h = 0.16;
      b.add(handmade(lathe(smoothProfile([[0.001, 0], [R * 0.9, 0], [R, 0.01], [R, h], [R * 0.92, h + 0.002], [R * 0.9, h * 0.1], [0.001, h * 0.08]], 30), 28), 0.008, c.seed + 6), cm2, { pos: [cx, 0, back + 0.01] });
      // wooden spoons / spatula / whisk
      const uw = c.mat('teak');
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + r(), lean = 0.12 + r() * 0.1;
        const L = 0.3 + r() * 0.06;
        const dir = V3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
        const base = V3(cx + Math.cos(a) * 0.015, 0.02, back + 0.01 + Math.sin(a) * 0.015);
        const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir);
        const hdl = new THREE.CylinderGeometry(0.0055, 0.006, L, 8).translate(0, L / 2, 0);
        b.add(hdl, uw, { matrix: _M().compose(base, q, V3(1, 1, 1)), axis: 'y' });
        const head = i % 2 ? new THREE.SphereGeometry(1, 12, 8).scale(0.022, 0.035, 0.006) : new THREE.BoxGeometry(0.05, 0.065, 0.006);
        head.translate(0, L + 0.025, 0);
        b.add(head, uw, { matrix: _M().compose(base, q, V3(1, 1, 1)), axis: 'y' });
      }
    } else if (k === 'kettle') {
      const km = String(p.kettleMaterial || p.kettle || 'steel').toLowerCase();
      const body = /white/.test(km) ? c.mat('ceramic-glazed', { color: p.kettleColor || '#EEEBE4', roughness: 0.35 }) : /black/.test(km) ? c.mat('metal-black', { color: p.kettleColor || '#26231f', roughness: 0.45 }) : /brass|copper/.test(km) ? c.mat('metal-brass-brushed', { color: p.kettleColor }) : c.mat('metal-nickel', { roughness: 0.25, color: p.kettleColor || '#d9d9d6' });
      const dark = c.mat('metal-black', { color: '#1e1c1a', roughness: 0.5 });
      const R = 0.085, h = 0.19;
      b.add(lathe(smoothProfile([[0.001, 0.002], [R * 0.95, 0.002], [R, 0.015], [R * 1.02, h * 0.45], [R * 0.85, h * 0.85], [R * 0.55, h], [0.001, h]], 24), 32), body, { pos: [cx, 0.018, back + 0.06] });
      b.add(new THREE.CylinderGeometry(R * 0.98, R * 1.0, 0.018, segs(36, 12)).translate(0, 0.009, 0), dark, { pos: [cx, 0, back + 0.06] });
      b.add(lathe([[0.001, 0], [R * 0.5, 0], [R * 0.42, 0.012], [0.012, 0.016], [0.012, 0.03], [0.001, 0.032]], 28), dark, { pos: [cx, 0.018 + h, back + 0.06] });
      b.add(tube([V3(cx - R * 0.6, 0.018 + h * 0.98, back + 0.06), V3(cx - R * 0.95, 0.018 + h * 1.2, back + 0.06), V3(cx - R * 0.2, 0.018 + h * 1.35, back + 0.06), V3(cx + R * 0.55, 0.018 + h * 1.2, back + 0.06), V3(cx + R * 0.75, 0.018 + h * 0.85, back + 0.06)], 0.009, { tubular: 30, radial: 8 }), dark, { uv: 'box' });
      b.add(tube([V3(cx - R * 0.9, 0.018 + h * 0.3, back + 0.06), V3(cx - R * 1.35, 0.018 + h * 0.6, back + 0.06), V3(cx - R * 1.55, 0.018 + h * 0.85, back + 0.06)], 0.011, { tubular: 16, radial: 8 }), body, { uv: 'box' });
    } else if (k === 'bottles') {
      const glass = c.mat('glass-clear', { thickness: 0.004 });
      const oil = c.mat('glass-amber', { tint: p.bottleTint || '#8a7a2a' });
      const vin = c.mat('glass-amber', { tint: '#5a1e1a' });
      const cork = c.mat('cork');
      [[-0.035, 0.27, oil], [0.035, 0.23, vin]].forEach(([dx, h, liquid]) => {
        const R = 0.03;
        const prof = smoothProfile([[0.001, 0], [R, 0], [R, h * 0.62], [R * 0.4, h * 0.82], [R * 0.32, h], [R * 0.27, h], [R * 0.27, h * 0.84], [R * 0.93, h * 0.62], [R * 0.93, 0.006], [0.001, 0.006]], 24);
        b.add(lathe(prof, 32), glass, { pos: [cx + dx, 0, back + 0.04], uv: 'none' });
        b.add(lathe([[0.001, 0.006], [R * 0.9, 0.006], [R * 0.9, h * 0.5], [0.001, h * 0.5]], 28), liquid, { pos: [cx + dx, 0, back + 0.04], uv: 'none' });
        b.add(new THREE.CylinderGeometry(R * 0.3, R * 0.26, 0.025, 14).translate(0, h + 0.006, 0), cork, { pos: [cx + dx, 0, back + 0.04] });
      });
    } else if (k === 'fruit-bowl') {
      const R = 0.13;
      const bm = c.mat(p.bowlMaterial || 'stoneware', { color: p.bowlColor || '#E6DED1' });
      b.add(handmade(lathe(bowlProfile(R, 0.075), 40), 0.006, c.seed + 8), bm, { pos: [cx, 0, back + 0.17] });
      addFruit(b, c, { cx, cz: back + 0.17, y: 0.012, R: R * 0.82, kinds: p.fruit, r });
    } else if (k === 'canisters') {
      const cmat = c.mat(p.canisterMaterial || 'ceramic-matte', { color: p.canisterColor || '#ECE6DC' });
      const lid = c.mat('oak-light');
      [[0.15, -0.06], [0.12, 0.06]].forEach(([h, dx]) => {
        b.add(lathe([[0.001, 0], [0.05, 0], [0.052, 0.004], [0.052, h], [0.001, h]], 32), cmat, { pos: [cx + dx * k0, 0, back + 0.04] });
        b.add(new THREE.CylinderGeometry(0.053, 0.053, 0.02, 32).translate(0, h + 0.01, 0), lid, { pos: [cx + dx * k0, 0, back + 0.04] });
      });
    }
  }
  return { group: b.build('kitchen_decor'), anchors: {} };
}
