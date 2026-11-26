// Villar furniture — tabletop detail sets: tableware, centerpiece, kitchen_decor. Owner: modeler.
//
// All three sit on a surface: origin = centre of the surface footprint at the surface height (y = 0),
// front (+Z) = the side people stand/sit, back (−Z) = wall side for kitchen_decor. They are NOT rescaled to
// item.dims (real object sizes are kept); dims only bound the layout. Deterministic (seeded by item id).
//
// PT-04: every object builds from the item's OWN colour + material fields (card, thumbnail and 3D agree).
// normalizeDetailParams() maps the catalogue's structured params ({ kettle: { color } }, colors: { kettle, … },
// plate: { color, glaze }, vase: { shape, color }, …) and the materials text ("Matte black kettle", "Wooden
// utensil caddy", "Dark wood board") onto the flat generator params below.
import * as THREE from '../../../vendor/three/three.module.js';
import { rng } from '../textures.js';
import { Builder, lathe, smoothProfile, tube, softBox, slab, roundedRectShape, ellipseShape, V3, clamp, lerp, cm, segs } from './geom.js';
import { fabricMat } from './parts.js';

const _M = () => new THREE.Matrix4();
const TRS = (x, y, z, ry = 0, rx = 0, rz = 0, s = 1) => _M().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(s, s, s));

// -------------------------------------------------------------- catalogue param normalisation

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const hex = (v) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : undefined);
/** Linear relative luminance 0..1 of a hex colour. */
export function lumOf(h) { const c = new THREE.Color(h); return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722; }
const WOOD_RE = /wood|walnut|oak|teak|acacia|bamboo|mango|\bash\b|дерев|орех|дуб|акаци|бамбук|ясен|манго/;
const CERAMIC_RE = /ceram|stoneware|porcel|керамик|керамогранит|фарфор/;
/** Furniture wood key for free text + optional colour (dark → walnut, mid → teak/acacia, light → oak). */
export function woodFor(text, color) {
  const t = String(text || '').toLowerCase();
  if (/walnut|орех|espresso/.test(t)) return 'walnut-dark';
  if (/acacia|акаци|teak|тик|mango|манго/.test(t)) return 'teak';
  if (/bamboo|бамбук|\boak\b|дуб|beech|бук|birch|pale|light|светл/.test(t)) return 'oak-light';
  if (/dark|тёмн|темн/.test(t)) return 'walnut-dark';
  if (color) { const l = lumOf(color); return l < 0.06 ? 'walnut-dark' : l < 0.22 ? 'teak' : 'oak-light'; }
  return 'oak-light';
}
const texts = (item) => [...(item?.materialsEn || []), ...(item?.materials || [])].map((s) => String(s).toLowerCase());
const entry = (item, re) => texts(item).find((s) => re.test(s)) || '';
/** Material for a small object: wood keys get a calibrated colour match, everything else a colour. */
export function objMat(c, key, color, extra = {}) {
  const k = String(key || 'stoneware');
  if (/walnut|oak|teak|ash|wood|acacia|mango/.test(k)) return c.mat(WOOD_RE.test(k) && !/walnut|oak|teak|ash/.test(k) ? woodFor(k, color) : k, color ? { match: color, ...extra } : extra);
  if (/travert|marble|terrazzo/.test(k)) return c.mat(k, color ? { match: color, ...extra } : extra);
  if (/glass/.test(k)) return c.mat('glass-clear', { thickness: 0.004, ...(color ? { color } : {}), ...extra });
  if (/leather|кож/.test(k)) return c.mat('leather-cognac', { color: color || '#D6CBB8', ...extra });
  if (/^metal|brass|steel|chrome|nickel/.test(k)) return c.mat(k, color && !/brass/.test(k) ? { color, ...extra } : extra);
  return c.mat(k, { color: color || '#E6DED1', ...extra });
}

/** Map structured catalogue params onto the flat generator params (pure; unknown archetypes pass through). */
export function normalizeDetailParams(arch, raw, item) {
  const p = isObj(raw) ? { ...raw } : {};
  try {
    if (arch === 'kitchen_decor') return normKitchen(p, item);
    if (arch === 'tableware') return normTableware(p, item);
    if (arch === 'centerpiece') return normCenterpiece(p, item);
  } catch (e) { console.debug('[furniture] param normalisation failed', item?.id, e); }
  return p;
}

function normKitchen(p, item) {
  const cmap = isObj(p.colors) ? p.colors : {};
  const sub = (k) => (isObj(p[k]) ? p[k] : {});
  const col = (k, ...alts) => hex(sub(k).color) || hex(cmap[k]) || alts.map(hex).find(Boolean);
  const o = { ...p };
  for (const k of ['colors', 'kettle', 'crock', 'board', 'bottles', 'tray', 'bowl']) if (isObj(o[k])) delete o[k];
  if (!Array.isArray(p.items) || !p.items.length) {
    const have = ['board', 'crock', 'kettle', 'bottles', 'tray', 'bowl', 'canisters'].filter((k) => isObj(p[k]) || hex(cmap[k]) || (k === 'bottles' && hex(cmap.oil)));
    if (have.length) o.items = have.map((k) => (k === 'bowl' ? 'fruit-bowl' : k));
  }
  // kettle: colour, finish (matte-black | matte-white | steel | brass) and type (electric plastic jug | stovetop)
  const kt = entry(item, /kettle|чайник/);
  const kc = col('kettle', p.kettleColor);
  if (kc) o.kettleColor = kc;
  let km = sub('kettle').material || (typeof p.kettle === 'string' ? p.kettle : null) || p.kettleMaterial;
  if (!km) km = /black|чёрн|черн/.test(kt) ? 'matte-black' : /white|бел/.test(kt) ? 'matte-white' : /brass|латун|copper|мед/.test(kt) ? 'brass' : /steel|stainless|сталь|chrome/.test(kt) ? 'steel'
    : kc ? (lumOf(kc) < 0.08 ? 'matte-black' : lumOf(kc) > 0.55 ? 'matte-white' : 'steel') : undefined;
  if (km) o.kettleMaterial = km;
  if (sub('kettle').type) o.kettleType = sub('kettle').type;
  else if (!p.kettleType && (/plastic|пластик|electric|электр/.test(kt) || (kt && !/steel|сталь|brass|латун|enamel|эмал|stove|плит/.test(kt)))) o.kettleType = 'electric';
  // utensil holder: ceramic crock or wooden caddy
  const ct = entry(item, /utensil|caddy|holder|crock|подставк|держател/);
  const cc = col('crock', p.crockColor);
  if (cc) o.crockColor = cc;
  if (!p.crockMaterial) {
    if (sub('crock').material) o.crockMaterial = sub('crock').material;
    else if (WOOD_RE.test(ct) && !CERAMIC_RE.test(ct)) o.crockMaterial = woodFor(ct, cc);
    else if (CERAMIC_RE.test(ct)) o.crockMaterial = 'stoneware';
  }
  if (/caddy|box|ящик/.test(ct) || sub('crock').shape === 'caddy') o.crockShape = 'caddy';
  // board: wood from the text ("Acacia board", "Dark wood board"), tone from its colour
  const bt = entry(item, /board|доск/);
  const bc = col('board', p.boardColor);
  if (bc) o.boardColor = bc;
  if (typeof p.board !== 'string') o.board = sub('board').material || woodFor(bt, bc);
  if (sub('board').lean === false) o.boardLean = false;
  // oil / vinegar bottles: glass or ceramic
  const ot = entry(item, /bottle|бутыл|oil|масл|vinegar|уксус/);
  const oc = col('bottles', cmap.oil, p.bottleColor);
  if (oc) o.bottleColor = oc;
  const kind = sub('bottles').kind || p.bottleKind;
  o.bottleKind = kind ? (/ceram/.test(kind) ? 'ceramic' : 'glass') : CERAMIC_RE.test(ot) ? 'ceramic' : 'glass';
  // fruit bowl
  const wt = entry(item, /bowl|миск|чаш/);
  const wc = col('bowl', p.bowlColor);
  if (wc) o.bowlColor = wc;
  if (!p.bowlMaterial) o.bowlMaterial = sub('bowl').material || (WOOD_RE.test(wt) && !CERAMIC_RE.test(wt) ? woodFor(wt, wc) : /glass|стекл/.test(wt) ? 'glass' : 'stoneware');
  if (isObj(p.tray)) { o.trayMaterial = p.tray.material || 'travertine'; const tc = hex(p.tray.color); if (tc) o.trayColor = tc; }
  return o;
}

function normTableware(p, item) {
  const o = { ...p };
  const plate = isObj(p.plate) ? p.plate : isObj(p.plates) ? p.plates : null;
  const side = isObj(p.sidePlate) ? p.sidePlate : null;
  const bowl = isObj(p.bowl) ? p.bowl : null;
  const glass = isObj(p.glass) ? p.glass : null;
  const cut = isObj(p.cutlery) ? p.cutlery : null;
  const nap = isObj(p.napkin) ? p.napkin : null;
  for (const k of ['plate', 'plates', 'sidePlate', 'bowl', 'glass', 'cutlery', 'napkin']) if (isObj(o[k])) delete o[k];
  if (bowl) o.bowl = true;
  const pc = hex(plate?.color), sc = hex(side?.color) || pc, bc = hex(bowl?.color) || sc;
  if (pc && !(Array.isArray(p.colors) && p.colors.length)) o.colors = [pc, sc, bc];
  const dt = entry(item, /stoneware|porcelain|ceramic|керамогранит|фарфор|керамик|dinner|сервиз/);
  const glaze = String(plate?.glaze || '');
  if (!p.material) o.material = /porcelain|фарфор/.test(dt) ? 'porcelain' : /stoneware|керамогранит/.test(dt) ? 'stoneware' : /ceramic|керамик/.test(dt) ? 'ceramic-matte' : 'stoneware';
  if (/reactive|реактив/.test(glaze + ' ' + dt)) {
    if (!p.rim) o.rim = 'organic';
    const rc = hex(plate?.rimColor) || hex(p.rimColor); if (rc) o.rimColor = rc;
  }
  if (/rib/.test(glaze)) o.ribbed = true;
  // glass: tint amber | smoke | clear, style tumbler | pebble | wine
  const gt = entry(item, /glass|tumbler|стекл|стакан|бокал/);
  if (glass) {
    const tint = `${glass.tint || ''} ${glass.kind || ''} ${gt}`;
    const st = `${glass.style || ''} ${gt}`;
    o.glass = /wine|stem|бокал/.test(st) ? 'wine' : /pebble|organic/.test(st) ? 'pebble' : 'tumbler';
    o.glassTint = /amber|янтар/.test(tint) ? 'amber' : /smok|дым|grey|gray/.test(tint) ? 'smoke' : 'clear';
    const gc = hex(glass.color); if (gc) o.glassColor = gc;
  } else if (!p.glassTint && gt) o.glassTint = /amber|янтар/.test(gt) ? 'amber' : /smok|дым/.test(gt) ? 'smoke' : 'clear';
  // cutlery: steel | brass | black | wood (wood-handled steel)
  if (cut || typeof p.cutlery !== 'string') {
    const ct = entry(item, /cutlery|прибор|stainless|сталь|\bgold/);
    const f = `${cut?.finish || ''} ${cut?.material || ''} ${ct}`;
    o.cutlery = /wood|дерев/.test(f) ? 'wood' : /brass|gold|золот|латун/.test(f) ? 'brass' : /black|чёрн/.test(f) ? 'black' : 'steel';
    const hc = hex(cut?.handleColor) || hex(cut?.color);
    if (hc && o.cutlery === 'wood') o.handleColor = hc;
    if (hc && o.cutlery === 'brass') o.cutleryColor = hc;
  }
  if (nap) { const nc = hex(nap.color); if (nc) o.napkinColor = nc; if (nap.fabric) o.napkinFabric = nap.fabric; }
  if (!o.napkinFabric) { const nt = entry(item, /napkin|салфетк/); if (/linen|льн|лён/.test(nt)) o.napkinFabric = 'linen'; else if (/cotton|хлоп/.test(nt)) o.napkinFabric = 'cotton'; }
  return o;
}

function normCenterpiece(p, item) {
  const o = { ...p };
  const kind = String(p.kind || p.style || '').toLowerCase();
  if (!p.style) o.style = /candle/.test(kind) || isObj(p.candles) ? 'candles' : /bowl|fruit/.test(kind) ? 'bowl' : 'vase';
  if (isObj(p.vase)) {
    const v = p.vase; o.vase = v.shape || 'round';
    const vc = hex(v.color); if (vc) o.vaseColor = vc;
    if (v.height) o.vaseHeight = v.height; if (v.diameter) o.vaseDiameter = v.diameter; if (v.material) o.vaseMaterial = v.material;
  }
  if (!o.vaseMaterial && o.style === 'vase') {
    const t = entry(item, /vase|ваз|ceramic|керамик|glass|стекл|terracotta|терракот|stoneware/);
    o.vaseMaterial = /glass|стекл/.test(t) ? 'glass' : /terracotta|терракот/.test(t) ? 'terracotta' : /stoneware|speck|крап/.test(t) ? 'stoneware' : /ceramic|керамик/.test(t) ? 'ceramic-matte' : 'stoneware';
  }
  const st = entry(item, /eucalyp|эвкалипт|olive|олив|pampas|пампас|tulip|тюльпан|grass|трав|stem|ветк|bush|куст/);
  if (isObj(p.stems)) {
    const s = p.stems; o.stems = s.species || 'eucalyptus';
    const n = Number(s.count) || 0;
    if (n) o.stemCount = /bush|куст/.test(st) ? n * 4 : n;
    const sc = hex(s.color); if (sc) o.leafColor = sc;
    if (s.length) o.stemLength = s.length;
  } else if (!p.stems && o.style === 'vase' && st) {
    o.stems = /eucalyp|эвкалипт/.test(st) ? 'eucalyptus' : /olive|олив/.test(st) ? 'olive' : /pampas|пампас/.test(st) ? 'pampas' : /tulip|тюльпан/.test(st) ? 'tulip' : 'grass';
  }
  if (isObj(p.candles)) {
    const cd = p.candles;
    if (cd.count) o.count = cd.count;
    const cc = hex(cd.color); if (cc) o.candleColor = cc;
    if (Array.isArray(cd.heights)) o.candleHeights = cd.heights.map(Number).filter((x) => x > 0);
    if (cd.diameter) o.candleDiameter = cd.diameter;
    delete o.candles;
  }
  if (isObj(p.tray)) {
    const t = p.tray; o.holder = 'tray'; o.holderMaterial = t.material || 'travertine';
    const tc = hex(t.color); if (tc) o.holderColor = tc;
    if (t.shape) o.trayShape = t.shape;
    delete o.tray;
  }
  return o;
}

/** Ceramic / stoneware / porcelain / glass dish material from params. */
function dishMat(c, material, color) {
  const m = String(material || 'stoneware').toLowerCase();
  if (/glass/.test(m)) return c.mat('glass-clear', { color: color || '#f4f6f3', thickness: 0.004 });
  if (/terracotta|clay/.test(m)) return c.mat('terracotta', { color });
  if (/matte|bisque/.test(m)) return c.mat('ceramic-matte', { color: color || '#ECE6DC' });
  if (/porcelain|glazed|gloss/.test(m)) return c.mat('ceramic-glazed', { color: color || '#F3F1EC' });
  return c.mat('stoneware', { color: color || '#E9E2D6' });
}

function cutleryMats(c, kind, p) {
  const k = String(kind || 'steel').toLowerCase();
  const steel = c.mat('metal-nickel', { roughness: 0.35 });
  if (/brass|gold/.test(k)) return { blade: c.mat('metal-brass-brushed', p.cutleryColor ? { color: p.cutleryColor } : undefined), handle: null };
  if (/black|matte/.test(k)) return { blade: c.mat('metal-black', { roughness: 0.4 }), handle: null };
  if (/wood/.test(k)) { const hc = p.handleColor || '#8C6A4A'; return { blade: steel, handle: c.mat(woodFor('', hc), { match: hc }) }; }
  return { blade: steel, handle: null };
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
/** Split a closed dish profile at radius rs into [inner-out, rim band, inner-back] (shared points → seamless). */
function splitProfile(prof, rs) {
  const out = [[], [], []]; let part = 0;
  for (let i = 0; i < prof.length; i++) {
    const q = prof[i];
    if (i > 0) {
      const a = prof[i - 1];
      const crossOut = part === 0 && a[0] < rs && q[0] >= rs, crossIn = part === 1 && a[0] >= rs && q[0] < rs;
      if (crossOut || crossIn) {
        const t = (rs - a[0]) / (q[0] - a[0]); const m = [rs, a[1] + (q[1] - a[1]) * t];
        out[part].push(m); part++; out[part].push(m);
      }
    }
    out[part].push(q);
  }
  return part === 2 ? out : null;
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
  if (/pebble|organic/.test(k)) {
    // low hand-blown tumbler: rounded heavy base, soft bulge, slightly irregular
    return handmade(lathe(smoothProfile([[0.001, 0], [0.028, 0], [0.036, 0.008], [0.041, 0.04], [0.039, 0.085], [0.0375, 0.088], [0.0365, 0.084], [0.0378, 0.04], [0.031, 0.016], [0.001, 0.014]], 24), 32), 0.025, 7);
  }
  // tumbler: heavy base, slight taper
  return lathe([[0.001, 0], [0.033, 0], [0.0345, 0.003], [0.0385, 0.1], [0.0365, 0.1], [0.0328, 0.012], [0.001, 0.012]], 32);
}

function glassMat(c, p) {
  const tint = String(p.glassTint || (/amber/.test(String(p.glassColor || '')) ? 'amber' : '')).toLowerCase();
  if (tint === 'amber') return c.mat('glass-amber', { thickness: 0.003, tint: p.glassColor || '#b8742a', distance: 0.03 });
  if (tint === 'smoke') return c.mat('glass-amber', { thickness: 0.003, tint: p.glassColor || '#8a8378', distance: 0.05 });
  return c.mat('glass-clear', { thickness: 0.003, color: /^#/.test(p.glassColor || '') ? p.glassColor : undefined });
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
/** Wooden handle scale over the first 10 cm of a piece (wood-handled cutlery). */
function woodHandleGeom() {
  const g = softBox(0.016, 0.009, 0.1, { r: 0.0035, seg: 2 });
  g.translate(0, 0.0055, -0.05);
  return g;
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
 * tableware — place settings for the dining table. Params: settings (2), colors[] (plates, side, bowl), material
 * stoneware|porcelain|ceramic-matte|terracotta|glass, rim coupe|rimmed|flat|organic, rimColor (reactive glaze
 * breaking at the rim), bowl bool (true), glass tumbler|pebble|wine, glassTint amber|smoke|clear, glassColor,
 * cutlery steel|brass|black|wood (wood = steel with wooden handles, handleColor), napkinColor, napkinFabric,
 * placemat none|linen|jute|rattan|leather, placematColor, axis 'x' (settings face ±X, default) | 'z'.
 * Structured catalogue params (plate/sidePlate/bowl/glass/cutlery/napkin objects) are normalised first.
 * ctx.host = { w, d } of the table top places the settings 4 cm in from the edge.
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
  const rimMat = p.rimColor ? dishMat(c, p.material, p.rimColor) : null;
  const gm = glassMat(c, p);
  const cut = cutleryMats(c, p.cutlery, p);
  const napMat = fabricMat(c, p.napkinFabric || 'linen', p.napkinColor || '#D8CDBB');
  const pm = String(p.placemat || 'none').toLowerCase();
  const placeMat = pm === 'none' || pm === 'false' ? null : /jute|rattan|seagrass|woven/.test(pm) ? c.mat(/rattan/.test(pm) ? 'rattan' : 'jute', { color: p.placematColor }) : /leather/.test(pm) ? c.mat('leather-cognac', { color: p.placematColor || '#7a5a40' }) : fabricMat(c, 'linen', p.placematColor || '#CFC3AE');
  const rim = p.rim || 'coupe';
  const wob = /organic|raw|reactive/.test(rim) ? 0.012 : 0.002;
  // dish → list of [geometry, material] (reactive glaze: the rim band breaks to rimColor)
  const dish = (prof, seg, mat, seed) => {
    const parts = rimMat ? splitProfile(prof, prof.reduce((m, q) => Math.max(m, q[0]), 0) * 0.86) : null;
    if (!parts) return [[handmade(lathe(prof, seg), wob, seed), mat]];
    return [[handmade(lathe(parts[0], seg), wob, seed), mat], [handmade(lathe(parts[1], seg), wob, seed), rimMat], [handmade(lathe(parts[2], seg), wob, seed), mat]];
  };
  const pl = dish(plateProfile(plateR, rim), 40, plateMat, c.seed + 1);
  const sp = dish(plateProfile(plateR * 0.76, rim), 32, sideMat, c.seed + 2);
  const bw = p.bowl === false ? null : dish(bowlProfile(0.074, 0.058), 32, bowlMat, c.seed + 3);
  const gl = glassGeom(p.glass);
  const kn = knifeGeom(), fk = forkGeom(), spn = spoonGeom();
  const wh = cut.handle ? woodHandleGeom() : null;
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
    const put = (parts, m) => { for (const [g, mt] of parts) b.add(g.clone(), mt, { matrix: m }); };
    put(pl, at(TRS(jitter(), y, jitter(), r() * 6.28)));
    put(sp, at(TRS(0, y + 0.0098, 0, r() * 6.28)));
    if (bw) put(bw, at(TRS(0, y + 0.0098 + 0.0096, 0, r() * 6.28)));
    // napkin: folded rectangle under the fork (left), or rolled on the plate when napkinStyle = 'plate'
    const nx = -(plateR + 0.075);
    if (String(p.napkinStyle || 'left') === 'plate' && !bw) b.add(napkinGeom(0.13, 0.2, 0.008, c.seed + i), napMat, { matrix: at(TRS(0, y + 0.03, 0, 0.1)), uv: 'box' });
    else b.add(napkinGeom(0.12, 0.21, 0.007, c.seed + i), napMat, { matrix: at(TRS(nx, y, 0.01, (r() - 0.5) * 0.05)) });
    // cutlery: fork on the napkin (left), knife (blade in) and spoon on the right
    const mf = at(TRS(nx + 0.012, y + 0.0075, 0.1, (r() - 0.5) * 0.03));
    const mk = at(TRS(plateR + 0.028, y, 0.105, (r() - 0.5) * 0.03, 0, 0));
    const ms = at(TRS(plateR + 0.058, y, 0.115, (r() - 0.5) * 0.03));
    b.add(fk.clone(), cut.blade, { matrix: mf });
    b.add(kn.clone(), cut.blade, { matrix: mk });
    for (const g of spn) b.add(g.clone(), cut.blade, { matrix: ms });
    if (wh) for (const m of [mf, mk, ms]) b.add(wh.clone(), cut.handle, { matrix: m, axis: 'z' });
    // glass above the knife
    b.add(gl.clone(), gm, { matrix: at(TRS(plateR + 0.04, y, -plateR - 0.01)), uv: 'none' });
  }
  return { group: b.build('tableware'), anchors: { top: V3(0, 0.03, 0) } };
}

// -------------------------------------------------------------- centerpiece

function vaseProfile(kind, R, H) {
  const k = String(kind || 'bottle');
  if (/bud|bottle|narrow/.test(k)) return smoothProfile([[0.001, 0], [R * 0.8, 0], [R, H * 0.08], [R, H * 0.45], [R * 0.45, H * 0.72], [R * 0.3, H * 0.9], [R * 0.34, H], [R * 0.27, H], [R * 0.24, H * 0.88], [R * 0.38, H * 0.72], [R * 0.86, H * 0.45], [R * 0.86, H * 0.1], [0.001, H * 0.06]], 32);
  if (/ovoid|egg|ovo/.test(k)) return smoothProfile([[0.001, 0], [R * 0.5, 0], [R * 0.82, H * 0.14], [R, H * 0.42], [R * 0.92, H * 0.68], [R * 0.6, H * 0.9], [R * 0.42, H * 0.985], [R * 0.44, H], [R * 0.36, H], [R * 0.34, H * 0.96], [R * 0.52, H * 0.86], [R * 0.85, H * 0.65], [R * 0.9, H * 0.4], [R * 0.45, H * 0.08], [0.001, H * 0.07]], 36);
  if (/round|sphere|moon/.test(k)) return smoothProfile([[0.001, 0], [R * 0.45, 0], [R * 0.9, H * 0.2], [R, H * 0.5], [R * 0.8, H * 0.85], [R * 0.38, H * 0.97], [R * 0.4, H], [R * 0.33, H], [R * 0.31, H * 0.95], [R * 0.7, H * 0.82], [R * 0.86, H * 0.5], [R * 0.4, H * 0.08], [0.001, H * 0.07]], 32);
  if (/amphora|urn/.test(k)) return smoothProfile([[0.001, 0], [R * 0.45, 0], [R * 0.5, H * 0.05], [R, H * 0.4], [R * 0.75, H * 0.75], [R * 0.45, H * 0.88], [R * 0.55, H], [R * 0.48, H], [R * 0.38, H * 0.88], [R * 0.66, H * 0.75], [R * 0.9, H * 0.4], [R * 0.4, H * 0.07], [0.001, H * 0.06]], 32);
  // cylinder / tall
  return [[0.001, 0], [R * 0.96, 0], [R, 0.004], [R, H], [R * 0.9, H], [R * 0.9, H * 0.05], [0.001, H * 0.05]];
}

/** Dried / fresh stems in a vase: olive branch, eucalyptus, pampas, grass, tulip, ranunculus. */
export function addStems(b, c, { kind, n, x0, y0, z0, H, spread, r, leafColor = null }) {
  const k = String(kind || 'olive').toLowerCase();
  const stemMat = c.mat('plant-stem', { color: /pampas|grass|dried|bunny/.test(k) ? '#b89f78' : '#5d6b42' });
  const leafCol = leafColor || (/eucal/.test(k) ? '#8aa596' : /olive/.test(k) ? '#7f8f68' : /dried|grass|pampas|bunny/.test(k) ? '#c9b48e' : '#55703f');
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

/** Candle flame: tiny glowing lathe + its light descriptor (glows only while the lamps are on). */
export function addFlame(b, c, x, y, z, lights) {
  b.add(new THREE.CylinderGeometry(0.0008, 0.001, 0.012, 5).translate(0, 0.006, 0), c.mat('rubber', { color: '#1d1a17' }), { pos: [x, y, z], uv: 'none', cast: false });
  const fl = lathe(smoothProfile([[0.001, 0], [0.0035, 0.004], [0.004, 0.009], [0.002, 0.018], [0.001, 0.022]], 10), 10);
  b.add(fl, c.mat('flame'), { pos: [x, y + 0.008, z], uv: 'none', cast: false });
  lights.push({ type: 'point', position: [x, y + 0.02, z], color: '#ffb46b', intensity: 0.06, distance: 1.2, decay: 2, shadow: false, flame: true });
}

/**
 * centerpiece — style vase|candles|bowl. vase: vase round|ovoid|bottle|cylinder|amphora, vaseMaterial
 * (stoneware|terracotta|glass|travertine|ceramic-matte|ceramic-glazed), vaseColor, vaseHeight, stems olive|
 * eucalyptus|pampas|tulip|ranunculus|grass|none, stemCount, stemLength, leafColor, flowerColor. candles: count (3),
 * candleColor, candleHeights[], candleDiameter, holder tray|plate|candlesticks, holderMaterial, holderColor,
 * trayShape oval|rect. bowl: bowlMaterial + fruit[] (lemon|orange|green-apple|pear|fig).
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
    const hk = p.holderMaterial || (/brass|stick/.test(hold) ? 'metal-brass-brushed' : 'travertine');
    const hm = objMat(c, hk, p.holderColor);
    const wax = c.mat('wax', { color: p.candleColor || '#EFE7DA' });
    const R0 = clamp(cm(p.candleDiameter, 0.07) / 2, 0.02, 0.05);
    let y0 = 0;
    if (/tray|plate/.test(hold)) {
      const tw = clamp(W, 0.24, 0.45);
      const oval = /oval|round/.test(String(p.trayShape || '')) || /plate|round/.test(hold);
      b.add(slab(oval ? ellipseShape(tw, tw * 0.5) : roundedRectShape(tw, tw * 0.45, 0.03), 0.014, { bevel: 0.004 }), hm, {});
      y0 = 0.014;
    }
    const hs = p.candleHeights && p.candleHeights.length ? p.candleHeights.map((h) => cm(h, 0.15)) : [0.2, 0.14, 0.1, 0.17, 0.12];
    for (let i = 0; i < nC; i++) {
      const x = (i - (nC - 1) / 2) * (R0 * 2 + 0.016), z = (i % 2 ? 0.012 : -0.01);
      let y = y0;
      if (/stick/.test(hold)) {
        const sh = [0.24, 0.18, 0.28, 0.2, 0.22][i % 5];
        b.add(lathe(smoothProfile([[0.001, 0], [0.04, 0], [0.042, 0.006], [0.012, 0.02], [0.009, sh * 0.5], [0.013, sh * 0.55], [0.008, sh * 0.62], [0.008, sh - 0.012], [0.018, sh - 0.006], [0.017, sh], [0.011, sh], [0.001, sh - 0.004]], 24), 24), hm, { pos: [x, 0, z] });
        y = sh - 0.004;
        b.add(lathe([[0.001, 0], [0.011, 0], [0.011, 0.24], [0.009, 0.245], [0.001, 0.246]], 18), wax, { pos: [x, y, z] });
        y += 0.246;
      } else {
        const h = clamp(hs[i % hs.length], 0.05, 0.32), R = R0 + (i % 2) * 0.003;
        // pillar with a melted dish at the top
        b.add(lathe(smoothProfile([[0.001, 0], [R - 0.002, 0], [R, 0.003], [R, h - 0.004], [R - 0.003, h], [R * 0.7, h - 0.006], [0.004, h - 0.009], [0.001, h - 0.009]], 24), 24), wax, { pos: [x, y, z] });
        y += h - 0.009;
      }
      addFlame(b, c, x, y, z, lights);
    }
    return { group: b.build('centerpiece'), anchors: {}, lights };
  }
  if (/bowl|fruit/.test(style)) {
    const R = clamp(W / 2, 0.1, 0.17);
    const bm = objMat(c, p.bowlMaterial || 'walnut-medium', p.bowlColor);
    b.add(lathe(bowlProfile(R, R * 0.42), 40), bm, { uv: 'box' });
    addFruit(b, c, { cx: 0, cz: 0, y: 0.012, R: R * 0.8, kinds: p.fruit, r });
    return { group: b.build('centerpiece'), anchors: {} };
  }
  // vase with stems
  const vk = String(p.vase || 'round');
  const vH = clamp(cm(p.vaseHeight, /bottle|bud/.test(vk) ? 0.22 : 0.2), 0.08, 0.45);
  const vR = clamp(cm(p.vaseDiameter, (/bottle|bud/.test(vk) ? 0.09 : /ovoid|egg/.test(vk) ? vH * 0.62 : vH * 0.8)) / 2, 0.03, 0.15);
  const vmKey = String(p.vaseMaterial || 'stoneware');
  const vm = /glass/.test(vmKey) ? c.mat('glass-clear', { thickness: 0.004, color: p.vaseColor }) : /terracotta/.test(vmKey) ? c.mat('terracotta', { color: p.vaseColor }) : objMat(c, vmKey, p.vaseColor || '#E2D9CB');
  b.add(handmade(lathe(vaseProfile(vk, vR, vH), 40), 0.006, c.seed + 4), vm, { uv: 'box' });
  if (/glass/.test(vmKey)) b.add(lathe([[0.001, vH * 0.06], [vR * 0.84, vH * 0.06], [vR * 0.84, vH * 0.4], [0.001, vH * 0.4]], 32), c.mat('glass-clear', { color: '#eef2ea', thickness: 0.05 }), { uv: 'none' });
  const stems = String(p.stems || 'olive');
  const sH = p.stemLength ? clamp(cm(p.stemLength) - 0.08, 0.15, 0.6) : clamp((H || 0.55) - vH, 0.15, 0.6);
  if (stems !== 'none') addStems(b, c, { kind: stems, n: clamp(Math.round(p.stemCount ?? (/tulip|ranunc/.test(stems) ? 7 : 5)), 1, 14), x0: 0, y0: vH, z0: 0, H: sH, spread: clamp(W * 0.35, 0.05, 0.25), r, leafColor: p.leafColor || null });
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

/** Electric jug kettle (plastic): base plate, tapered body with a pour lip at −X… handle at +X (local). */
function electricKettle(b, mat, M) {
  const H = 0.225, R0 = 0.073, R1 = 0.064;
  b.add(lathe([[0.001, 0], [0.078, 0], [0.081, 0.004], [0.08, 0.017], [0.074, 0.02], [0.001, 0.02]], segs(40, 16)), mat, { matrix: M.clone() });
  const g = lathe(smoothProfile([[0.001, 0.021], [R0 - 0.012, 0.021], [R0 - 0.002, 0.026], [R0, 0.04], [R0 * 1.005, 0.08], [lerp(R0, R1, 0.6), 0.16], [R1, H - 0.012], [R1 * 0.985, H], [0.001, H]], 32), segs(48, 18));
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    if (y < H * 0.78) continue;
    const a = Math.atan2(z, x), lip = Math.max(0, -Math.cos(a)) ** 8; // spout toward −X
    const k = ((y - H * 0.78) / (H * 0.22)) ** 2;
    const s = 1 + (0.022 * k * lip) / R1;
    pa.setX(i, x * s); pa.setZ(i, z * s); pa.setY(i, y + 0.006 * k * lip);
  }
  g.computeVertexNormals();
  b.add(g, mat, { matrix: M.clone() });
  // lid: shallow dome + push button
  b.add(lathe([[0.058, H - 0.001], [0.056, H + 0.003], [0.04, H + 0.009], [0.001, H + 0.011]], segs(32, 12)), mat, { matrix: M.clone() });
  b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 16).translate(0.02, H + 0.012, 0), mat, { matrix: M.clone() });
  // D handle on +X
  b.add(tube([V3(R1 * 0.92, H - 0.022, 0), V3(0.105, H - 0.028, 0), V3(0.116, H - 0.075, 0), V3(0.108, 0.075, 0), V3(R0 * 0.94, 0.055, 0)], 0.011, { tubular: 36, radial: 10, tension: 0.5 }), mat, { matrix: M.clone() });
}

/** Stovetop kettle (steel / brass / enamel): domed body, bail handle, spout. */
function stovetopKettle(b, c, body, M) {
  const dark = c.mat('metal-black', { color: '#1e1c1a', roughness: 0.5 });
  const R = 0.085, h = 0.19;
  const at = (g, m, uv = 'box') => b.add(g, m, { matrix: M.clone(), uv });
  at(lathe(smoothProfile([[0.001, 0.002], [R * 0.95, 0.002], [R, 0.015], [R * 1.02, h * 0.45], [R * 0.85, h * 0.85], [R * 0.55, h], [0.001, h]], 24), 32).translate(0, 0.018, 0), body);
  at(new THREE.CylinderGeometry(R * 0.98, R * 1.0, 0.018, segs(36, 12)).translate(0, 0.009, 0), dark);
  at(lathe([[0.001, 0], [R * 0.5, 0], [R * 0.42, 0.012], [0.012, 0.016], [0.012, 0.03], [0.001, 0.032]], 28).translate(0, 0.018 + h, 0), dark);
  at(tube([V3(-R * 0.6, 0.018 + h * 0.98, 0), V3(-R * 0.95, 0.018 + h * 1.2, 0), V3(-R * 0.2, 0.018 + h * 1.35, 0), V3(R * 0.55, 0.018 + h * 1.2, 0), V3(R * 0.75, 0.018 + h * 0.85, 0)], 0.009, { tubular: 30, radial: 8 }), dark);
  at(tube([V3(-R * 0.9, 0.018 + h * 0.3, 0), V3(-R * 1.35, 0.018 + h * 0.6, 0), V3(-R * 1.55, 0.018 + h * 0.85, 0)], 0.011, { tubular: 16, radial: 8 }), body);
}

/** Wooden spoons / spatulas standing in a holder whose opening is centred at (x, y0, z). */
function addUtensils(b, c, { x, z, y0, spread, r }) {
  const uw = c.mat('teak');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + r(), lean = 0.12 + r() * 0.1;
    const L = 0.3 + r() * 0.06;
    const dir = V3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const base = V3(x + Math.cos(a) * spread, y0, z + Math.sin(a) * spread);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir);
    const hdl = new THREE.CylinderGeometry(0.0055, 0.006, L, 8).translate(0, L / 2, 0);
    b.add(hdl, uw, { matrix: _M().compose(base, q, V3(1, 1, 1)), axis: 'y' });
    const head = i % 2 ? new THREE.SphereGeometry(1, 12, 8).scale(0.022, 0.035, 0.006) : new THREE.BoxGeometry(0.05, 0.065, 0.006);
    head.translate(0, L + 0.025, 0);
    b.add(head, uw, { matrix: _M().compose(base, q, V3(1, 1, 1)), axis: 'y' });
  }
}

/**
 * kitchen_decor — worktop vignette packed inside W × D (the engine clamps it to the free zone, 52 × 30 cm) with
 * real object sizes: boards lean on the backsplash, the other objects are placed by a small collision-aware
 * packer (wall-side or front, left/right preference) — nothing interpenetrates, objects that do not fit are left
 * out. Params (after normalisation): items[] of board|crock|kettle|bottles|tray|fruit-bowl|canisters,
 * kettleMaterial matte-black|matte-white|steel|brass, kettleColor, kettleType electric|stovetop, crockMaterial
 * (wood key | stoneware | ceramic), crockColor, crockShape round|caddy, board (wood key), boardColor,
 * bottleKind glass|ceramic, bottleColor, bottleTint, bowlMaterial, bowlColor, fruit[], trayMaterial, trayColor,
 * canisterMaterial, canisterColor. Origin = worktop surface, back (−Z) against the wall.
 */
export function kitchenDecor(c) {
  const { W, D, params: p } = c;
  const b = new Builder(c.seed);
  const r = rng(c.seed + 13);
  const norm = (k) => (/fruit|bowl/.test(k) ? 'fruit-bowl' : /bottle|oil|vinegar/.test(k) ? 'bottles' : /board|chopping|cutting/.test(k) ? 'board' : /crock|utensil|caddy/.test(k) ? 'crock' : /canist|jar/.test(k) ? 'canisters' : /kettle/.test(k) ? 'kettle' : /tray/.test(k) ? 'tray' : k);
  const KNOWN = ['board', 'kettle', 'crock', 'bottles', 'tray', 'fruit-bowl', 'canisters'];
  let list = (Array.isArray(p.items) ? p.items : []).map((s) => norm(String(s && typeof s === 'object' ? s.type : s).toLowerCase())).filter((k) => KNOWN.includes(k));
  if (!list.length) list = ['board', 'crock', 'kettle', 'bottles', 'fruit-bowl'];
  list = [...new Set(list)];
  const km = String(p.kettleMaterial || 'steel').toLowerCase();
  const electric = /^elec/.test(String(p.kettleType || '')) || (!p.kettleType && /matte|plastic/.test(km));
  const caddy = p.crockShape === 'caddy';
  const trayCarries = list.includes('tray');
  const hw = Math.max(0.2, W / 2), hd = Math.max(0.12, D / 2), gap = 0.012;
  // footprints x × z (m) + preferences
  const F = {
    board: { w: 0.31, d: 0.06, z: 'wall', x: 'left' },
    kettle: { w: electric ? 0.205 : 0.23, d: electric ? 0.165 : 0.18, z: 'front', x: 'right' },
    'fruit-bowl': { w: 0.175, d: 0.175, z: 'front', x: 'center' },
    tray: { w: 0.28, d: 0.14, z: 'wall', x: 'right' },
    crock: { w: caddy ? 0.115 : 0.12, d: caddy ? 0.1 : 0.12, z: 'wall', x: 'left' },
    bottles: { w: 0.13, d: 0.065, z: 'wall', x: 'right', rot: true },
    canisters: { w: 0.23, d: 0.11, z: 'wall', x: 'right' },
  };
  const placed = [];
  const free = (x0, x1, z0, z1, ign) => x0 >= -hw - 1e-6 && x1 <= hw + 1e-6 && z0 >= -hd - 1e-6 && z1 <= hd + 1e-6
    && placed.every((q) => q === ign || x1 + gap <= q.x0 || x0 >= q.x1 + gap || z1 + gap <= q.z0 || z0 >= q.z1 + gap);
  const place = (k, f = F[k]) => {
    const xs = [], zs = [];
    for (let x = -hw + f.w / 2; x <= hw - f.w / 2 + 1e-6; x += 0.005) xs.push(x);
    for (let z = -hd + f.d / 2; z <= hd - f.d / 2 + 1e-6; z += 0.005) zs.push(z);
    if (f.x === 'right') xs.reverse(); else if (f.x === 'center') xs.sort((a, q) => Math.abs(a) - Math.abs(q));
    if (f.z === 'front') zs.reverse();
    for (const z of zs) for (const x of xs) if (free(x - f.w / 2, x + f.w / 2, z - f.d / 2, z + f.d / 2)) { const q = { k, x, z, w: f.w, d: f.d, x0: x - f.w / 2, x1: x + f.w / 2, z0: z - f.d / 2, z1: z + f.d / 2 }; placed.push(q); return q; }
    return null;
  };
  const ORDER = ['board', 'kettle', 'tray', 'fruit-bowl', 'crock', 'bottles', 'canisters'];
  const at = {};
  for (const k of ORDER) if (list.includes(k)) {
    at[k] = place(k);
    // a pair (bottles) may also stand one behind the other
    if (!at[k] && F[k].rot) { at[k] = place(k, { ...F[k], w: F[k].d, d: F[k].w, x: 'left' }); if (at[k]) at[k].rot = true; }
  }
  // the tray carries the bottles (and the crock when the bottles are absent)
  const onTray = trayCarries && at.tray ? (list.includes('bottles') ? 'bottles' : list.includes('crock') ? 'crock' : null) : null;
  if (onTray && at[onTray]) { placed.splice(placed.indexOf(at[onTray]), 1); }
  if (onTray && at.tray) at[onTray] = { x: at.tray.x + (onTray === 'bottles' ? 0.055 : 0.07), z: at.tray.z, y: 0.016 };

  for (const k of Object.keys(at)) {
    const q = at[k]; if (!q) continue;
    const y0 = q.y || 0;
    if (k === 'board') {
      // boards leaning against the backsplash (the front one smaller)
      const wood = c.mat(p.board || 'oak-light', p.boardColor ? { match: p.boardColor } : undefined);
      const boards = p.boardLean === false ? [[0.3, 0.2, 0.018, 0]] : [[0.3, 0.42, 0.018, -0.01], [0.22, 0.32, 0.016, 0.045]];
      boards.forEach(([bw, bh, t, dx], i) => {
        const g = slab(roundedRectShape(bw, bh, 0.03), t, { bevel: 0.004 });
        if (p.boardLean === false) { b.add(g, wood, { matrix: TRS(q.x, 0, q.z, 0), axis: 'x' }); return; }
        g.rotateX(Math.PI / 2); g.translate(0, bh / 2, 0);
        const tilt = -0.17 - i * 0.04;
        b.add(g, wood, { matrix: TRS(q.x + dx, 0, -hd + 0.012 + i * 0.022 + Math.sin(-tilt) * bh * 0.5, 0, tilt), axis: 'y' });
      });
    } else if (k === 'kettle') {
      const kc = p.kettleColor;
      // handle (local +X) toward the nearer end of the zone, spout toward the centre
      const M = TRS(q.x, y0, q.z, (q.x >= 0 ? 0 : Math.PI) + (r() - 0.5) * 0.3);
      if (electric) {
        const black = /black/.test(km) || (kc && lumOf(kc) < 0.08);
        const m = c.mat('plastic-white', { color: kc || (black ? '#1F1E1C' : '#F2F0EC'), roughness: black ? 0.62 : 0.45, clearcoat: black ? 0.05 : 0.15 });
        electricKettle(b, m, M);
      } else {
        const body = /white|enamel/.test(km) ? c.mat('ceramic-glazed', { color: kc || '#EEEBE4', roughness: 0.35 }) : /black/.test(km) ? c.mat('metal-black', { color: kc || '#26231f', roughness: 0.45 }) : /brass|copper/.test(km) ? c.mat('metal-brass-brushed', kc ? { color: kc } : undefined) : c.mat('metal-nickel', { roughness: 0.25, color: kc || '#d9d9d6' });
        stovetopKettle(b, c, body, M);
      }
    } else if (k === 'crock') {
      const cmk = p.crockMaterial || 'stoneware';
      const cm2 = objMat(c, cmk, p.crockColor || (/walnut|oak|teak|wood/.test(cmk) ? undefined : '#D9D0C1'));
      if (caddy) {
        // wooden utensil caddy: open box, dark interior
        b.add(softBox(0.11, 0.13, 0.095, { r: 0.006, seg: 2 }), cm2, { pos: [q.x, y0 + 0.065, q.z], axis: 'y' });
        b.add(new THREE.BoxGeometry(0.094, 0.003, 0.079), c.mat('paper', { color: '#2a2622' }), { pos: [q.x, y0 + 0.1305, q.z], cast: false });
        addUtensils(b, c, { x: q.x, z: q.z, y0: y0 + 0.03, spread: 0.018, r });
      } else {
        const R = 0.058, h = 0.16;
        b.add(handmade(lathe(smoothProfile([[0.001, 0], [R * 0.9, 0], [R, 0.01], [R, h], [R * 0.92, h + 0.002], [R * 0.9, h * 0.1], [0.001, h * 0.08]], 30), 28), 0.008, c.seed + 6), cm2, { pos: [q.x, y0, q.z] });
        addUtensils(b, c, { x: q.x, z: q.z, y0: y0 + 0.02, spread: 0.015, r });
      }
    } else if (k === 'bottles') {
      const cork = c.mat('cork');
      // pair side by side along X, or one behind the other (q.rot): offset d → (dx, dz)
      const off = (d) => (q.rot ? [q.x, q.z + d] : [q.x + d, q.z]);
      if (p.bottleKind === 'ceramic') {
        // ceramic oil / vinegar cruets with wooden stoppers
        const cmat = c.mat('ceramic-matte', { color: p.bottleColor || '#E8E1D6' });
        const stop = c.mat('teak');
        [[-0.032, 0.2], [0.032, 0.17]].forEach(([dx, h]) => {
          const R = 0.028;
          const [bx, bz] = off(dx);
          b.add(handmade(lathe(smoothProfile([[0.001, 0], [R * 0.85, 0], [R, h * 0.08], [R, h * 0.55], [R * 0.45, h * 0.78], [R * 0.3, h * 0.9], [R * 0.32, h], [0.001, h]], 28), 28), 0.01, c.seed + 20 + h * 100), cmat, { pos: [bx, y0, bz] });
          b.add(new THREE.CylinderGeometry(R * 0.36, R * 0.3, 0.022, 14).translate(0, h + 0.008, 0), stop, { pos: [bx, y0, bz], axis: 'y' });
        });
      } else {
        const glass = c.mat('glass-clear', { thickness: 0.004 });
        const oil = c.mat('glass-amber', { tint: p.bottleTint || '#8a7a2a' });
        const vin = c.mat('glass-amber', { tint: '#5a1e1a' });
        [[-0.033, 0.27, oil], [0.033, 0.23, vin]].forEach(([dx, h, liquid]) => {
          const R = 0.029;
          const prof = smoothProfile([[0.001, 0], [R, 0], [R, h * 0.62], [R * 0.4, h * 0.82], [R * 0.32, h], [R * 0.27, h], [R * 0.27, h * 0.84], [R * 0.93, h * 0.62], [R * 0.93, 0.006], [0.001, 0.006]], 24);
          const [bx, bz] = off(dx);
          b.add(lathe(prof, 32), glass, { pos: [bx, y0, bz], uv: 'none' });
          b.add(lathe([[0.001, 0.006], [R * 0.9, 0.006], [R * 0.9, h * 0.5], [0.001, h * 0.5]], 28), liquid, { pos: [bx, y0, bz], uv: 'none' });
          b.add(new THREE.CylinderGeometry(R * 0.3, R * 0.26, 0.025, 14).translate(0, h + 0.006, 0), cork, { pos: [bx, y0, bz] });
        });
      }
    } else if (k === 'tray') {
      const tm = objMat(c, p.trayMaterial || 'travertine', p.trayColor);
      b.add(slab(roundedRectShape(q.w - 0.01, q.d - 0.01, 0.02), 0.016, { bevel: 0.004 }), tm, { pos: [q.x, 0, q.z] });
    } else if (k === 'fruit-bowl') {
      const R = 0.084;
      const bm = objMat(c, p.bowlMaterial || 'stoneware', p.bowlColor || (/walnut|oak|teak|wood/.test(String(p.bowlMaterial || '')) ? undefined : '#E6DED1'));
      b.add(handmade(lathe(bowlProfile(R, 0.068), 40), 0.006, c.seed + 8), bm, { pos: [q.x, 0, q.z] });
      addFruit(b, c, { cx: q.x, cz: q.z, y: 0.012, R: R * 0.82, kinds: p.fruit, r });
    } else if (k === 'canisters') {
      const cmat = c.mat(p.canisterMaterial || 'ceramic-matte', { color: p.canisterColor || '#ECE6DC' });
      const lid = c.mat('oak-light');
      [[0.15, -0.058], [0.12, 0.058]].forEach(([h, dx]) => {
        b.add(lathe([[0.001, 0], [0.05, 0], [0.052, 0.004], [0.052, h], [0.001, h]], 32), cmat, { pos: [q.x + dx, 0, q.z] });
        b.add(new THREE.CylinderGeometry(0.053, 0.053, 0.02, 32).translate(0, h + 0.01, 0), lid, { pos: [q.x + dx, 0, q.z] });
      });
    }
  }
  return { group: b.build('kitchen_decor'), anchors: {}, layout: placed.map((q) => [q.k, +q.x.toFixed(3), +q.z.toFixed(3)]) };
}
