// Villar furniture generators — entry point. Owner: modeler.
//
//   import { buildItem, ARCHETYPES } from './furniture/index.js';
//   const group = buildItem(item, { materials });         // item = catalog item (dims in cm)
//   group.userData.anchors  → { top | seat | deck | ... : Vector3 } (local)
//   group.userData.lights   → [{ type: 'point'|'spot', position:[x,y,z], target:[x,y,z], angle, penumbra, color,
//                               intensity, distance, decay, shadow }]  — SPEC units: metres in the item's local
//                               frame, angle = spot HALF-angle in RADIANS (three.js), penumbra 0–1, intensity 1 ≈ 40 W,
//                               shadow advisory. Shaded lamps export down spot (70 %, shadow) + up spot (30 %) + glow point.
//
// Optional context in the 2nd arg (all optional, used when the engine knows them):
//   host:  { w, d, h }  metres — size of the parent surface (mattress for bedding, sofa seat for
//                        cushions = parent.userData.anchorInfo[anchor]); improves fit.
//   span:  metres       — curtains: width of the window/rail to spread panels across.
//   seed:  number       — variation seed (defaults to a hash of item.id).
//
// Conventions: origin = bottom-centre of footprint, front faces +Z, X = width, Y = up.
// pendant_lamp origin = ceiling mount (hangs −Y); wall_art origin = centre of back face (protrudes +Z);
// curtains origin = bottom-centre at floor. Overall bbox is fitted to item.dims (except
// bedding/cushions/decor_set/pendant drop, which depend on their host).

// SUPPORTED model.params (all optional; unknown values fall back to sensible defaults; material
// values may be any library key or free text like "walnut", "brass", "travertine", "cane"):
//  sofa        seats 1–5, arm track|square|round|rolled|slope|wide|slim|none, legs wood-taper|wood-block|
//              metal|hairpin|bun|plinth|none, fabric boucle|linen|velvet|leather|cotton|wool, fabricColor,
//              wood|legMaterial, back loose|tight, backCushions n|'tight', seatCushions n, bench, piping,
//              chaise left|right (dims.d = overall depth), mainDepth, seatHeight, armHeight, legHeight, seatThickness
//  armchair    style lounge|club|slipper|accent|wingback|barrel|mid-century|frame|scandi (exposed wood frame,
//              default when fabric = leather), fabric, fabricColor, frame (wood), legs, arm, seatHeight
//  dining_chair frame, seat (fabric/leather/wood/cane key), seatColor, back curved|spindle|slat|cane|upholstered|panel
//  cushions    count, colors[], fabric, fabrics[], sizes[{w,h} cm]       (host.w = sofa seat width)
//  coffee_table / side_table / dining_table
//              shape round|oval|rect|square|pebble|squircle, top (material), topThickness, legs pedestal|drum|
//              tulip|tripod|hairpin|wood-taper|metal|sled|trestle|plinth|block, legMaterial, fluted, shelf
//  tv_unit     doors, drawers, open, front flat|fluted|slatted|cane, legs, wood, handles none|cutout|knob|bar|
//              leather (+ -brass/-black), top (material, e.g. travertine)
//  nightstand  drawers, open|shelf, legs, wood, handles, front, top
//  bed         headboard upholstered-panel|channel|wingback|wood-panel|slatted|cane|none, headboardColor, fabric,
//              frame (wood or fabric key → upholstered frame), legs wood-short|wood-taper|metal|plinth|none,
//              mattressW/mattressD cm, deckHeight cm, railAbove cm
//  mattress    thickness (m), color, bandColor
//  bedding     duvetColor, duvetFabric, sheetColor, throwColor (null → no throw), throwFabric, pillows n,
//              pillowColors[], pillowFabric, drop cm                    (host = mattress {w,d,h})
//  floor_lamp  base (material), baseStyle disc|tripod, shade drum|cone|empire|pleated|dome|globe, shadeColor,
//              shadeMaterial linen|paper|opal|rattan, shadeHeight
//  table_lamp  base, baseColor, baseShape gourd|jar|cylinder|sphere|column, shade drum|cone|pleated|mushroom,
//              shadeColor, shadeMaterial
//  pendant_lamp shape globe-paper|globe-opal|dome|bell|drum|cone|rattan-dome|linen-drum, color, drop (m),
//              material, fitting
//  rug         shape rect|round|oval, material wool-rug|jute, color, pattern plain|plain-border|double-border|
//              stripes|berber|geometric|abstract|distressed|none, patternColor, fringe
//  curtains    panels, fabric linen|velvet, color, sheer, panelWidth, gathered, foldDepth, track (ctx.span = rail)
//  wall_art    frame walnut-dark|oak|black|white|brass|none(canvas wrap), motif abstract-arches|sun|organic|
//              lines|landscape|botanical|stripes|grid|mirror, colors[], mat (passe-partout) bool, matColor, frameWidth
//  plant       species olive-tree|fiddle-leaf|ficus-audrey|monstera|strelitzia|snake-plant|palm, pot ceramic-matte|
//              terracotta|travertine|basket|rattan|concrete|glazed, potColor, potShape cylinder|tapered|bowl|egg,
//              potDiameter/potHeight cm
//  decor_set   items[] of vase-tall|vase|vase-round|bottle|jar|bowl|books|candle|candlestick|tray|sculpture|
//              stones|box — each may carry a material ("bowl:travertine") or be {type, material, color};
//              colors[], materials[]
//  --- Phase 2 detail archetypes (real-size objects; see each generator's doc comment) ---
//  tableware   settings 2, colors[] (dinner, side, bowl), material stoneware|porcelain|ceramic-matte|terracotta|glass,
//              rim coupe|rimmed|flat|organic, bowl bool, glass tumbler|wine, glassColor, cutlery steel|brass|black|wood,
//              napkinColor, napkinFabric, napkinStyle left|plate, placemat none|linen|jute|rattan|leather|round-jute,
//              placematColor, axis x|z (settings face ±X by default), plateDiameter. Origin = table-top centre;
//              ctx.host = { w, d } of the top places the settings 4 cm in from the edge.
//  centerpiece style vase|candles|bowl; vase round|bottle|cylinder|amphora, vaseMaterial, vaseColor, vaseHeight,
//              stems olive|eucalyptus|pampas|tulip|ranunculus|grass|none, stemCount, flowerColor; candles: count,
//              candleColor, holder tray|plate|candlesticks, holderMaterial (flames glow + export tiny lights
//              with flame:true only while lamps are on); bowl: bowlMaterial, fruit[]
//  kitchen_decor items[] of board|crock|kettle|bottles|fruit-bowl|canisters, kettleMaterial steel|matte-white|
//              matte-black|brass, kettleColor, crockMaterial/Color, board (wood), fruit[] lemon|orange|green-apple|
//              apple|pear|fig|lime, bottleTint, canisterMaterial. Origin = worktop, back (−Z) against the wall.
//  throw       fabric knit|linen|washed-linen|wool|boucle|cotton, color, drape arm|back|folded, fringe, foldedWidth.
//              Attach at a sofa/armchair anchor throw_arm_r | throw_arm_l | throw_back with
//              ctx.host = parent.userData.anchorInfo[anchor]. dims = unfolded size.
//  nightstand_decor = decor_set with default items ['books', 'vase-round'] (uniformly fitted to dims)
//  runner      = rug (pattern double-border, fine weave by default); dims ~70×200
//  mirror      shape round|oval|arch|pill|rect|organic, mount wall|leaning, frame <material>|none, frameWidth,
//              frameDepth, frameColor, lean (deg). wall → origin like wall_art; leaning → bottom-centre of bbox,
//              group.userData.mount = 'wall' | 'leaning'
//  sofa        + shape curved|organic (arc-shaped, rounded), modular true (separate blocks, no arms by default)
//  bed         + style platform (Japandi low platform: wide deck reveal, low slatted/panel headboard)
//  --- round 3 ---
//  sofa        armPanel cane|rattan (+ armPanelColor): open wooden arm frames, cane on outer AND inner faces
//  armchair    seat|back|fabric cane|rattan → frame-and-cane chair (frame, woodColor, caneColor, legs …splay, arm)
//  floor_lamp  shade column (Ø = shadeDiameter) → paper-cord column lamp, even glow
//  pendant     trimColor light → linen tape, dark → leather
//  wall_art    motif relief-waves|amphora|abstract-shapes|textured-*, panels [[w,h],…] + gap (one image across),
//              mirrored (same painting flipped); the image depends on motif + colors, not on the id
//  plant       pot ribbed|glazed-ribbed
//  --- round 5 ---
//  wall_art    image (URL; the engine resolves the Storage key) | images [URL, …] (one per panel) → Villar Editions:
//              cover-cropped print on a 4 cm stretched canvas, float frame (frame wood key / metal / black / white /
//              none, frameWidth) with a 7 mm shadow gap OUTSIDE the dims; motif + colors stay the placeholder/fallback
//  every item  userData.pivot / front / bounds / radial (FOCUS turntable); lamp cords are meshes with userData.cord
//  decor_set   items box|bud-vase|sprig|candle|candles|tray … (material hints matched by affinity)
//  throw       fabric cotton-weave|dense|textured → open cotton weave; fringe → alpha tassel strips on both ends
//  kitchen_decor / tableware / centerpiece: the catalogue's structured params (kettle: { color }, colors: { kettle, … },
//              plate: { color, glaze }, glass: { tint }, cutlery: { finish }, vase: { shape }, stems: { species },
//              candles: { heights }, tray: { material }) + the materials text are normalised by
//              tabletop.normalizeDetailParams() — card, thumbnail and 3D agree (PT-04)
// Off-main-thread builds (T8): prebuildItems(items, ctx, { budget, shouldYield }), buildItemAsync, hasBuildWorker,
// prebuildStats — generators run in furniture/worker.js.
import * as THREE from '../../../vendor/three/three.module.js';
import { hashStr, setArtRenderer } from '../textures.js';
import { triCount, setLOD } from './geom.js';
import { sofa, armchair, diningChair, cushions } from './seating.js';
import { coffeeTable, sideTable, diningTable, nightstand, tvUnit } from './tables.js';
import { bed, mattress, bedding } from './beds.js';
import { floorLamp, tableLamp, pendantLamp } from './lighting.js';
import { rug, curtains, throwBlanket, runner } from './textiles.js';
import { wallArt, plant, decorSet, mirror } from './decor.js';
import { tableware, centerpiece, kitchenDecor, normalizeDetailParams } from './tabletop.js';

/** nightstand_decor — decor_set with bedside defaults (book stack + bud vase); same params as decor_set. */
const nightstandDecor = (c) => decorSet({ ...c, params: { items: ['books', 'vase-round'], ...c.params } });

const GEN = {
  sofa, armchair, coffee_table: coffeeTable, side_table: sideTable, tv_unit: tvUnit, bed, mattress, bedding,
  nightstand, dining_table: diningTable, dining_chair: diningChair, floor_lamp: floorLamp, table_lamp: tableLamp,
  pendant_lamp: pendantLamp, rug, curtains, wall_art: wallArt, plant, decor_set: decorSet, cushions,
  // Phase 2 detail archetypes
  tableware, centerpiece, kitchen_decor: kitchenDecor, throw: throwBlanket, nightstand_decor: nightstandDecor, runner, mirror,
};

export const ARCHETYPES = Object.keys(GEN);

// how to fit the generated bbox to item.dims: which axes, and where the origin sits
const FIT = {
  default: { axes: 'xyz', origin: 'bottom' },
  bedding: { axes: '', origin: 'none' },
  cushions: { axes: '', origin: 'none' },
  // real-size objects: fit uniformly and never enlarge (a round bowl must stay round)
  decor_set: { axes: 'xyz', origin: 'bottom', uniform: true, max: 1 },
  pendant_lamp: { axes: 'xz', origin: 'none' },
  wall_art: { axes: 'xy', origin: 'none' },
  curtains: { axes: 'y', origin: 'none' },
  plant: { axes: 'xyz', origin: 'bottom' },
  floor_lamp: { axes: 'xyz', origin: 'bottom' },
  table_lamp: { axes: 'xyz', origin: 'bottom' },
  rug: { axes: 'xz', origin: 'none' },
  runner: { axes: 'xz', origin: 'none' },
  mattress: { axes: 'xyz', origin: 'bottom' },
  // real-size objects laid out on their host surface (dims only bound the layout)
  tableware: { axes: '', origin: 'none' },
  centerpiece: { axes: '', origin: 'none' },
  kitchen_decor: { axes: '', origin: 'none' },
  nightstand_decor: { axes: 'xyz', origin: 'bottom', uniform: true, max: 1 },
  throw: { axes: '', origin: 'none' },
  mirror: { axes: 'xy', origin: 'none' }, // leaning mirrors override per build
};

const ARCH_ALIASES = {
  couch: 'sofa', loveseat: 'sofa', sectional: 'sofa', chair: 'armchair', accent_chair: 'armchair', lounge_chair: 'armchair',
  coffee: 'coffee_table', side: 'side_table', end_table: 'side_table', console: 'tv_unit', media_unit: 'tv_unit', sideboard: 'tv_unit',
  bedside: 'nightstand', bedside_table: 'nightstand', table: 'dining_table', chair_dining: 'dining_chair',
  lamp: 'table_lamp', pendant: 'pendant_lamp', ceiling_lamp: 'pendant_lamp', art: 'wall_art', poster: 'wall_art',
  floor_mirror: 'mirror', wall_mirror: 'mirror', leaning_mirror: 'mirror',
  cushion: 'cushions', pillows: 'cushions', throw_pillows: 'cushions', throw_pillow: 'cushions', decor: 'decor_set', vase: 'decor_set',
  dinnerware: 'tableware', place_setting: 'tableware', table_setting: 'tableware', candles: 'centerpiece', flowers: 'centerpiece',
  blanket: 'throw', plaid: 'throw', bedside_decor: 'nightstand_decor', hall_runner: 'runner', runner_rug: 'runner',
};

export function archetypeOf(item) {
  let a = item?.model?.archetype || item?.type || 'decor_set';
  a = String(a).toLowerCase().replace(/[-\s]/g, '_');
  if (GEN[a]) return a;
  if (ARCH_ALIASES[a]) return ARCH_ALIASES[a];
  for (const k of ARCHETYPES) if (a.includes(k)) return k;
  return 'decor_set';
}

/** Build a catalog item into a THREE.Group (metres). Never throws: falls back to a soft box. */
export function buildItem(item, ctx = {}) {
  const materials = ctx.materials;
  const arch = archetypeOf(item);
  const dims = item?.dims || {};
  const W = (Number(dims.w) || 50) / 100, D = (Number(dims.d) || Number(dims.w) || 50) / 100, H = (Number(dims.h) || 50) / 100;
  // PT-04: structured catalogue params ({ kettle: { color } }, plate: { color, glaze }, vase: { shape }, …) and the
  // materials text are mapped onto the generator params first, so card, thumbnail and 3D always agree
  const params = sanitizeParams(normalizeDetailParams(arch, item?.model?.params, item));
  const seed = ctx.seed ?? (hashStr(String(item?.id || arch)) % 100000);
  // material accessor: wood parts follow the catalogue woodColor (photo estimate) unless a part overrides it
  const WOODS = ['walnut-dark', 'walnut-medium', 'oak-light', 'oak-natural', 'oak-white', 'ash-light', 'ash-black', 'teak'];
  const mat = (k, o) => {
    const canon = materials.resolve ? materials.resolve(k) : k;
    if (params.woodColor && WOODS.includes(canon) && !(o && (o.match || o.tint))) o = { ...(o || {}), match: params.woodColor };
    return materials.get(k, o);
  };
  if (!params.materials && Array.isArray(item?.materials)) params.materialHints = item.materials.map(ruMaterialKey);
  const c = { materials, W, D, H, params, item, seed, host: ctx.host || null, span: ctx.span || null, mat };
  // level of detail from the engine quality tier: high = full, medium ≈ 60 %, low ≈ 40 % of the segments
  const q = String(ctx.quality || 'high');
  c.quality = q; c.lod = q === 'low' ? 0 : q === 'medium' ? 1 : 2;
  setLOD(c.lod);
  let res;
  try {
    res = GEN[arch](c);
  } catch (e) {
    console.error(`[furniture] ${arch} (${item?.id}) failed:`, e);
    res = fallback(c);
  } finally {
    setLOD(2);
  }
  const group = res.group || res;
  group.name = item?.id || arch;
  const anchors = res.anchors || {};
  const lights = res.lights || [];
  const info = res.anchorInfo || {};
  fit(group, anchors, lights, info, arch, W, D, H, res.fit || null);
  if (res.mount) group.userData.mount = res.mount;
  // FOCUS turntable (round 5): rotation axis + front direction, local space (see docs/requests/engine.md)
  turntable(group, arch, res, params, W, D);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; o.userData.itemId = item?.id; } });
  alphaShadows(group, ctx.materials);
  group.userData.anchors = anchors;
  group.userData.anchorInfo = info;
  group.userData.lights = lights;
  group.userData.archetype = arch;
  group.userData.pivot = group.userData.pivot || [0, 0, 0];
  group.userData.front = group.userData.front || [0, 0, 1];
  group.userData.itemId = item?.id;
  group.userData.triangles = triCount(group);
  return group;
}

const ARRAY_KEYS = ['colors', 'items', 'pillowColors', 'fabrics', 'sizes', 'materials', 'heights', 'layers', 'candleHeights', 'patterns'];

/** Russian catalogue material names → library keys (used as hints, e.g. per-object decor materials). */
const RU = [
  [/травертин/i, 'travertine'], [/мрамор/i, 'marble-white'], [/латун|золот/i, 'metal-brass'], [/хром|сталь/i, 'metal-chrome'],
  [/венск|сетк/i, 'cane'], [/бумажн\S*\s+шнур|датск\S*\s+шнур/i, 'paper-cord'], [/ротанг|плетён|гиацинт|шнур/i, 'rattan'], [/джут|сизаль/i, 'jute'], [/орех/i, 'walnut-dark'],
  [/ясен/i, 'ash-light'], [/беленый дуб|белёный дуб/i, 'oak-white'], [/дуб/i, 'oak-light'], [/дерев|шпон|гевеи|массив/i, 'walnut-dark'], [/терракот|глин/i, 'terracotta'], [/терраццо|терразцо/i, 'terrazzo'], [/керамогран/i, 'stone-worktop'], [/зеркал/i, 'mirror'], [/керамик/i, 'ceramic-matte'], [/стекл/i, 'glass-clear'],
  [/букле/i, 'fabric-boucle'], [/бархат|велюр|шенилл/i, 'fabric-velvet'], [/кож/i, 'leather-cognac'], [/лён|льн/i, 'fabric-linen'],
  [/шерст/i, 'wool-rug'], [/хлоп/i, 'fabric-cotton'], [/рогожк|ткан/i, 'fabric-linen'], [/металл|чёрн/i, 'metal-black'], [/бумаг/i, 'paper'],
];
export function ruMaterialKey(name) {
  const s = String(name || '');
  for (const [re, k] of RU) if (re.test(s)) return k;
  return null;
}
const NUM_KEYS = ['count', 'seats', 'drawers', 'doors', 'pillows', 'panels', 'stems', 'seatCushions', 'backCushions', 'drop', 'thickness', 'seatHeight', 'armHeight', 'legHeight', 'topThickness', 'shadeHeight', 'frameWidth', 'matWidth', 'potDiameter', 'potHeight', 'mainDepth', 'chaiseDepth', 'deckHeight', 'mattressW', 'mattressD', 'panelWidth', 'gathered', 'foldDepth', 'lumens', 'backHeight', 'armWidth', 'seatThickness', 'railAbove'];
const COLOR_RE = /^(#[0-9a-f]{3}([0-9a-f]{3})?|rgb\(.*\)|hsl\(.*\))$/i;
const isColor = (v) => typeof v === 'string' && COLOR_RE.test(v.trim());

/** Make catalog params safe: arrays are arrays, numbers are numbers, colours are valid (else dropped → defaults). */
export function sanitizeParams(raw) {
  const p = {};
  if (!raw || typeof raw !== 'object') return p;
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined || v === '') continue;
    if (ARRAY_KEYS.includes(k)) {
      let a = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [v];
      if (/colors|Colors/.test(k)) a = a.filter(isColor);
      if (a.length) p[k] = a;
      continue;
    }
    if (NUM_KEYS.includes(k)) {
      if (Array.isArray(v)) { p[k] = v; continue; } // e.g. wall_art triptych panels [[w, h], …]
      if (typeof v === 'boolean' && (k === 'backCushions' || k === 'seatCushions')) { p[k] = v; continue; }
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (isFinite(n)) p[k] = n; else if (k === 'backCushions' && v === 'tight') p[k] = v;
      continue;
    }
    if (/color$|Color$/.test(k)) { if (isColor(v)) p[k] = v.trim(); continue; }
    p[k] = v;
  }
  return p;
}

function fallback(c) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(c.W, c.H, c.D), c.mat('fabric-linen', { color: c.item?.colorHex || '#cccccc' }));
  m.position.y = c.H / 2;
  g.add(m);
  return { group: g, anchors: { top: new THREE.Vector3(0, c.H, 0) } };
}

const _box = new THREE.Box3();
const _gb = new THREE.Box3();

/**
 * Bounding box of the item's own body: meshes flagged `userData.noFit` (lamp cords and plugs lying on the floor or
 * table behind the base) are left out, so they never stretch the fit, the pivot or the turntable framing.
 */
function visualBox(root, out = new THREE.Box3()) {
  out.makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noFit) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    _gb.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    out.union(_gb);
  });
  return out;
}

/** Rotationally symmetric archetypes/shapes (the turntable may skip the rest-angle dial for these). */
const ROUND_RE = /round|circle/;

/**
 * FOCUS turntable (round 5). The engine turns a focused item about a vertical axis through its footprint centre:
 *   userData.pivot  [x, y, z]  local metres: footprint centre (x/z = centre of the visual bbox, cords excluded),
 *                               y = bottom of the visual bbox (the floor / support contact; for wall and ceiling
 *                               items the lowest point of the item)
 *   userData.front  [x, y, z]  local unit vector the item faces (its "0°" rest angle); +Z for every archetype
 *   userData.bounds { min: [x, y, z], max: [x, y, z] }  local visual bbox (cords excluded) — for framing
 *   userData.radial true when the item looks the same at every angle about the pivot (round tables, lamps, plants)
 */
function turntable(group, arch, res, p = {}, W = 1, D = 1) {
  const b = visualBox(group, new THREE.Box3());
  if (b.isEmpty()) { group.userData.pivot = [0, 0, 0]; group.userData.front = [0, 0, 1]; return; }
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  group.userData.pivot = [r6((b.min.x + b.max.x) / 2), r6(b.min.y), r6((b.min.z + b.max.z) / 2)];
  const f = res.front || [0, 0, 1];
  const l = Math.hypot(f[0], f[1], f[2]) || 1;
  group.userData.front = [r6(f[0] / l), r6(f[1] / l), r6(f[2] / l)];
  group.userData.bounds = { min: b.min.toArray().map(r6), max: b.max.toArray().map(r6) };
  if (res.radial != null) group.userData.radial = !!res.radial;
  else {
    const swing = /swing|arm/.test(String(p.stem || ''));
    group.userData.radial = /^(plant|pendant_lamp|centerpiece)$/.test(arch) || (/^(floor_lamp|table_lamp)$/.test(arch) && !swing)
      || (/_table$/.test(arch) && ROUND_RE.test(String(p.shape || '')) && Math.abs(W - D) < 0.02);
  }
}

/** Scale/offset the generated content so its bbox matches dims exactly (per FIT rules). */
function fit(group, anchors, lights, info, arch, W, D, H, override = null) {
  const rule = override || FIT[arch] || FIT.default;
  if (!rule.axes && rule.origin === 'none') return;
  group.updateMatrixWorld(true);
  visualBox(group, _box);
  if (_box.isEmpty()) return;
  const size = _box.getSize(new THREE.Vector3());
  const s = new THREE.Vector3(1, 1, 1);
  const want = { x: W, y: H, z: D };
  if (!rule.uniform) for (const a of rule.axes) {
    if (size[a] < 1e-4) continue;
    const k = want[a] / size[a];
    // generators build close to dims; a large correction means a part is missing (R2-07: a 3 cm table top was
    // stretched 30× into a floor-length block) — never distort that far, keep the real size instead
    if (k > 1.6 || k < 0.5) { console.debug(`[furniture] ${arch}: bbox ${a} ${size[a].toFixed(3)} m vs dims ${want[a].toFixed(3)} m — not stretched`); continue; }
    if (Math.abs(k - 1) > 1e-4) s[a] = k; // exact fit
  }
  if (rule.uniform) {
    let k = Infinity;
    for (const a of rule.axes) if (size[a] >= 1e-4) k = Math.min(k, want[a] / size[a]);
    if (!isFinite(k)) k = 1;
    k = Math.min(k, rule.max ?? Infinity);
    s.set(k, k, k);
  }
  const off = new THREE.Vector3();
  if (rule.origin === 'bottom') {
    const cx = (_box.min.x + _box.max.x) / 2, cz = (_box.min.z + _box.max.z) / 2;
    off.set(-cx * s.x, -_box.min.y * s.y, -cz * s.z);
  }
  if (s.x === 1 && s.y === 1 && s.z === 1 && off.lengthSq() < 1e-10) return;
  const inner = new THREE.Group();
  inner.name = 'fit';
  while (group.children.length) inner.add(group.children[0]);
  inner.scale.copy(s); inner.position.copy(off);
  group.add(inner);
  const tf = (v) => v.multiply(s).add(off);
  for (const k of Object.keys(anchors)) tf(anchors[k]);
  for (const L of lights) {
    const p = new THREE.Vector3(...L.position); tf(p); L.position = [p.x, p.y, p.z];
    if (L.target) { const t = new THREE.Vector3(...L.target); tf(t); L.target = [t.x, t.y, t.z]; }
  }
  for (const k of Object.keys(info)) { const i = info[k]; if (i.w) i.w *= s.x; if (i.d) i.d *= s.z; if (i.h) i.h *= s.y; }
}

export { triCount };
// R4-13: inset sink geometry for the architecture's kitchen (see fixtures.js; engine integrates)
export { sinkParts } from './fixtures.js';

// ---------------------------------------------------------------- build cache (seamless swaps)
//
//   const g = buildItemCached(item, ctx)   // same args as buildItem; returns a cheap clone of a cached prototype
//   releaseItem(g)                         // when the engine removes it (do NOT dispose its geometry/materials)
//   await prebuildItems(items, ctx)        // warm the cache in idle time (e.g. alternatives for the selected slot)
//   clearItemCache(materials?)             // drop everything (e.g. quality-tier change); disposes cached geometry
//
// Builds are deterministic (seeded by item.id), so a cached prototype is identical to a fresh build. Clones share
// geometry + materials; userData.anchors / anchorInfo / lights are per-instance copies. Key = item id + model params
// + dims + quality + host/span/seed, per materials library. Entries with live clones are never evicted; idle
// entries are evicted LRU beyond setItemCacheSize(n) (default 64).
const CACHES = new WeakMap();
const ALL_CACHES = new Set();
let CACHE_MAX = 64;
const r4 = (x) => (typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : x);

export function itemCacheKey(item, ctx = {}) {
  const h = ctx.host ? Object.keys(ctx.host).sort().map((k) => k + ':' + r4(ctx.host[k])).join(',') : '';
  return [item?.id, JSON.stringify(item?.model || null), JSON.stringify(item?.dims || null), item?.colorHex || '', ctx.quality || 'high', h, r4(ctx.span) ?? '', ctx.seed ?? ''].join('|');
}

function cacheFor(materials) {
  let m = CACHES.get(materials);
  if (!m) { m = new Map(); CACHES.set(materials, m); ALL_CACHES.add(m); }
  return m;
}

/**
 * R4-10: alpha-cut meshes (cane, open rattan, fringe, scanned leaves) cast hashed-alpha shadows. Object3D.clone does
 * not copy customDepthMaterial, so every assembly path (direct build, cache instance, worker re-assembly) calls this.
 */
function alphaShadows(root, materials) {
  if (!materials || typeof materials.shadowOf !== 'function') return root;
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const s = materials.shadowOf(o.material);
    if (s) { o.customDepthMaterial = s.depth; o.customDistanceMaterial = s.distance; }
  });
  return root;
}

function instance(proto, key) {
  const g = proto.clone(true);
  const u = proto.userData;
  const anchors = {};
  for (const [k, v] of Object.entries(u.anchors || {})) anchors[k] = v.clone();
  g.userData = {
    ...u, cacheKey: key, anchors,
    anchorInfo: JSON.parse(JSON.stringify(u.anchorInfo || {})),
    lights: (u.lights || []).map((L) => ({ ...L, position: [...L.position], ...(L.target ? { target: [...L.target] } : {}) })),
    pivot: [...(u.pivot || [0, 0, 0])], front: [...(u.front || [0, 0, 1])],
    ...(u.bounds ? { bounds: { min: [...u.bounds.min], max: [...u.bounds.max] } } : {}),
  };
  return g;
}

export function buildItemCached(item, ctx = {}) {
  if (!ctx.materials) return buildItem(item, ctx);
  const cache = cacheFor(ctx.materials);
  const key = itemCacheKey(item, ctx);
  let e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); } // LRU touch
  else { e = { proto: buildItem(item, ctx), refs: 0 }; cache.set(key, e); }
  e.refs++;
  const g = alphaShadows(instance(e.proto, key), ctx.materials);
  g.userData.cacheOwner = ctx.materials;
  trim(cache);
  return g;
}

export function releaseItem(group) {
  const key = group?.userData?.cacheKey, owner = group?.userData?.cacheOwner;
  if (!key || !owner) return;
  const cache = CACHES.get(owner); const e = cache && cache.get(key);
  if (e && e.refs > 0) e.refs--;
  if (cache) trim(cache);
}

function disposeProto(g) { g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }

function trim(cache) {
  if (cache.size <= CACHE_MAX) return;
  for (const [k, e] of cache) {
    if (cache.size <= CACHE_MAX) break;
    if (e.refs <= 0) { disposeProto(e.proto); cache.delete(k); }
  }
}

export function setItemCacheSize(n) { CACHE_MAX = Math.max(4, n | 0); }

export function clearItemCache(materials) {
  const list = materials ? [CACHES.get(materials)].filter(Boolean) : [...ALL_CACHES];
  for (const cache of list) { for (const e of cache.values()) disposeProto(e.proto); cache.clear(); }
}

// ---------------------------------------------------------------- off-main-thread builds (T8)
//
// prebuildItems() runs the generators in a module Worker (furniture/worker.js) and only re-assembles the result on
// the main thread, inside requestIdleCallback slices of ≤ budget ms (default 8): BufferGeometry from transferred
// arrays + materials.get() — typically 0.2–2 ms per item. No `timeout` forcing the callback into busy frames, and
// `shouldYield()` (engine: camera moving, fade, GI bake, photo) skips the slice. Without Worker support (or if the
// worker fails to load) it falls back to main-thread builds, one per slice, only when the slice's remaining time
// covers that archetype's measured build cost (or after the item was deferred for ~10 s of idle).

let WORKER = null; // null = not tried, false = unavailable, Worker
let WSEQ = 0;
const WJOBS = new Map();
function buildWorker() {
  if (WORKER !== null) return WORKER || null;
  WORKER = false;
  try {
    if (typeof Worker === 'undefined' || typeof window === 'undefined') return null;
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'villar-furniture' });
    w.onmessage = (e) => { const j = WJOBS.get(e.data?.id); if (j) { WJOBS.delete(e.data.id); j(e.data); } };
    w.onerror = (e) => {
      console.debug('[furniture] build worker unavailable — main-thread fallback', e?.message || '');
      WORKER = false; try { w.terminate(); } catch { /* ignore */ }
      for (const j of WJOBS.values()) j({ error: 'worker' });
      WJOBS.clear();
    };
    WORKER = w;
  } catch (e) { WORKER = false; }
  return WORKER || null;
}
function remote(payload) {
  const w = buildWorker();
  if (!w) return Promise.resolve({ error: 'no-worker' });
  const id = ++WSEQ;
  return new Promise((res) => {
    WJOBS.set(id, res);
    try { w.postMessage({ id, ...payload }); } catch (e) { WJOBS.delete(id); res({ error: String(e) }); }
  });
}
function buildRemote(item, ctx) {
  return remote({ item: JSON.parse(JSON.stringify(item)), ctx: { quality: ctx.quality, host: ctx.host || null, span: ctx.span ?? null, seed: ctx.seed } });
}
// artworks are painted in the same worker (no 50–150 ms canvas paint inside materials.get on the main thread)
let ART_WORKER_OK = true;
setArtRenderer((opts) => {
  if (!ART_WORKER_OK || !buildWorker()) return null;
  const o = {}; for (const [k, v] of Object.entries(opts || {})) if (v === null || ['string', 'number', 'boolean'].includes(typeof v) || Array.isArray(v)) o[k] = v;
  return remote({ art: o }).then((r) => { if (r && r.art) return r.art; if (r && /OffscreenCanvas|getContext/.test(r.error || '')) ART_WORKER_OK = false; throw new Error(r?.error || 'art'); });
});
/** Unique material descriptors of a worker build tree (in tree order). */
function matsOf(n, out = new Map()) {
  if (n.m && n.mat) { const id = n.mat.key + '|' + JSON.stringify(n.mat.opts || {}); if (!out.has(id)) out.set(id, n.mat); }
  for (const ch of n.c || []) matsOf(ch, out);
  return out;
}

/** Re-assemble a worker build tree with the real materials (same materials.get calls as a direct build). */
function fromTree(n, materials, root = true) {
  let o;
  if (n.m) {
    const g = new THREE.BufferGeometry();
    for (const [k, [arr, size, norm]] of Object.entries(n.g.a)) g.setAttribute(k, new THREE.BufferAttribute(arr, size, norm));
    if (n.g.i) g.setIndex(new THREE.BufferAttribute(n.g.i, 1));
    if (n.g.bs) { g.boundingSphere = new THREE.Sphere(new THREE.Vector3(n.g.bs[0], n.g.bs[1], n.g.bs[2]), n.g.bs[3]); g.boundingBox = new THREE.Box3(new THREE.Vector3(...n.g.bb.slice(0, 3)), new THREE.Vector3(...n.g.bb.slice(3))); }
    else { g.computeBoundingBox(); g.computeBoundingSphere(); }
    o = new THREE.Mesh(g, materials.get(n.mat.key, n.mat.opts));
  } else o = new THREE.Group();
  o.name = n.name; o.position.fromArray(n.p); o.quaternion.fromArray(n.q); o.scale.fromArray(n.s);
  o.castShadow = n.cs; o.receiveShadow = n.rs;
  if (root) {
    const u = n.ud;
    o.userData.anchors = Object.fromEntries(Object.entries(u.anchors || {}).map(([k, v]) => [k, new THREE.Vector3(...v)]));
    o.userData.anchorInfo = u.anchorInfo || {}; o.userData.lights = u.lights || [];
    if (u.mount) o.userData.mount = u.mount;
    o.userData.archetype = u.archetype; o.userData.itemId = u.itemId; o.userData.triangles = u.triangles;
    o.userData.pivot = u.pivot || [0, 0, 0]; o.userData.front = u.front || [0, 0, 1];
    if (u.bounds) o.userData.bounds = u.bounds;
    if (u.radial != null) o.userData.radial = u.radial;
  } else Object.assign(o.userData, n.ud);
  for (const ch of n.c) o.add(fromTree(ch, materials, false));
  return o;
}

// measured main-thread build cost per archetype (ms, EMA) — only used by the no-worker fallback
const COST = new Map();
// T8 (round 5): first-time materials.get cost, learned per canonical key (the last first-time creation of that key:
// a fabric's later colours share its texture bundle and are cheap, every rug pattern paints its own canvas). A
// descriptor already created for a library costs nothing. Unknown keys are assumed to be expensive, so they only
// start in a slice that still has that much time left — gets never stack past the budget.
const MAT_COST = new Map();
const MAT_DONE = new WeakMap(); // materials library → Set of descriptor ids already created
const MAT_DEFAULT = 4.5;
const descId = (d) => d.key + '|' + JSON.stringify(d.opts || {});
function matEstimate(materials, d) {
  const done = MAT_DONE.get(materials);
  if (done && done.has(descId(d))) return 0;
  const canon = materials.resolve ? materials.resolve(d.key) : d.key;
  return MAT_COST.get(canon) ?? MAT_DEFAULT;
}
function matCreate(materials, d) {
  let done = MAT_DONE.get(materials);
  if (!done) { done = new Set(); MAT_DONE.set(materials, done); }
  const id = descId(d);
  const t = performance.now();
  try { materials.get(d.key, d.opts); } catch { /* fromTree reports */ }
  const dt = performance.now() - t;
  if (!done.has(id)) { done.add(id); const canon = materials.resolve ? materials.resolve(d.key) : d.key; MAT_COST.set(canon, dt < 0.4 ? Math.min(MAT_COST.get(canon) ?? 0.5, 0.5) : dt); }
  return dt;
}
const STATS = { slices: 0, maxSlice: 0, totalMs: 0, worst: null, worstMs: 0 };
let MS_PER_VERT = 0.00012; // re-assembly cost estimate (learned)
/** Main-thread cost of prebuild idle slices so far (QA: maxSlice should stay ≤ budget). */
export function prebuildStats() { return { ...STATS, worker: !!WORKER }; }
function timedBuild(item, ctx) {
  const t0 = performance.now();
  const g = buildItem(item, ctx);
  const dt = performance.now() - t0, a = archetypeOf(item);
  COST.set(a, COST.has(a) ? COST.get(a) * 0.7 + dt * 0.3 : dt);
  return g;
}

/**
 * Warm the cache off the main thread (T8). Resolves with the number of items built.
 *   prebuildItems(items, { materials, quality, host?, span? }, { budget: 8, shouldYield: () => bool })
 * Main-thread work happens only inside idle slices and stops at min(budget, deadline.timeRemaining()).
 */
export function prebuildItems(items, ctx = {}, { budget = 8, shouldYield = null, worker = true } = {}) {
  if (!ctx.materials) return Promise.resolve(0);
  const cache = cacheFor(ctx.materials);
  const seen = new Set();
  const todo = (items || []).filter((it) => { if (!it) return false; const k = itemCacheKey(it, ctx); if (cache.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  if (!todo.length) return Promise.resolve(0);
  const useWorker = worker && !!buildWorker();
  const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(() => fn({ timeRemaining: () => budget, didTimeout: false }), 50));
  let built = 0, inflight = 0, scheduled = false, finished = false;
  const ready = [], local = useWorker ? [] : todo.splice(0), deferred = new Map();
  return new Promise((resolve) => {
    const finish = () => { if (!finished && !todo.length && !inflight && !ready.length && !local.length) { finished = true; trim(cache); resolve(built); } };
    const schedule = () => { if (!scheduled && !finished) { scheduled = true; idle(step); } };
    const pump = () => {
      while (WORKER && inflight < 2 && todo.length) {
        const it = todo.shift();
        if (cache.has(itemCacheKey(it, ctx))) continue;
        inflight++;
        buildRemote(it, ctx).then((r) => { inflight--; ready.push({ it, r }); schedule(); pump(); });
      }
      if (!WORKER && todo.length) local.push(...todo.splice(0)); // worker died: finish on the main thread
      if (local.length) schedule();
      finish();
    };
    const step = (deadline) => {
      scheduled = false;
      const t0 = performance.now();
      const left = () => Math.min(budget - (performance.now() - t0), deadline && deadline.timeRemaining ? deadline.timeRemaining() : budget);
      if (shouldYield && shouldYield()) { schedule(); return; }
      // 1) re-assemble worker results while the slice lasts; an item starts only if its estimated cost (learned
      //    ms per vertex) fits what is left — a big one waits for a fresh slice, and runs alone there
      let first = true;
      while (ready.length && left() > 0.3) {
        // 0) the item's NEW materials first, one materials.get per check: a first-time material allocates its texture
        //    bundle (up to ≈ 7 ms) — done in their own slices they never stack on top of the re-assembly
        const head = ready[0];
        if (head.r && head.r.tree) {
          if (!head.mats) head.mats = [...matsOf(head.r.tree).values()];
          // T8 (round 5): one material at a time, and only if its learned first-time cost fits what is left of the
          // slice (the first piece of work in a fresh slice always runs) — creations no longer stack to ≈ 30 ms
          while (head.mats.length && left() > 0.3) {
            const est = matEstimate(ctx.materials, head.mats[0]);
            if (!first && est > left()) break;
            matCreate(ctx.materials, head.mats.shift());
            if (est > 0.05) first = false;
          }
          if (head.mats.length) break;
        }
        const est = (ready[0].r?.verts || 0) * MS_PER_VERT;
        if (!first && est > left()) break;
        if (first && est > left() && left() < budget * 0.9) break; // a fresh, emptier slice comes next
        first = false;
        const { it, r } = ready.shift();
        const key = itemCacheKey(it, ctx);
        if (cache.has(key)) continue;
        if (r && r.tree) {
          const t1 = performance.now();
          try { cache.set(key, { proto: fromTree(r.tree, ctx.materials), refs: 0 }); built++; } catch (e) { console.debug('[furniture] worker result rejected', it.id, e); local.push(it); }
          const dt1 = performance.now() - t1;
          if (r.verts > 2000) MS_PER_VERT = MS_PER_VERT * 0.7 + (dt1 / r.verts) * 0.3;
          if (dt1 > STATS.worstMs) { STATS.worstMs = dt1; STATS.worst = it.id; }
        } else local.push(it);
      }
      // 2) main-thread fallback: at most one build per slice, only if it fits what is left of the slice
      if (local.length && left() > 0) {
        const it = local[0];
        const est = COST.get(archetypeOf(it)) ?? 25;
        const n = (deferred.get(it) || 0) + 1; deferred.set(it, n);
        if (est <= left() || (deadline && deadline.didTimeout) || n > 200) {
          local.shift(); deferred.delete(it);
          const key = itemCacheKey(it, ctx);
          if (!cache.has(key)) { cache.set(key, { proto: timedBuild(it, ctx), refs: 0 }); built++; }
        }
      }
      if (ready.length || local.length) schedule();
      pump();
      const dt = performance.now() - t0;
      STATS.slices++; STATS.maxSlice = Math.max(STATS.maxSlice, dt); STATS.totalMs += dt;
    };
    if (useWorker) pump(); else schedule();
  });
}

/**
 * Build in the worker and resolve with a cached clone (same as buildItemCached, without main-thread generator time).
 * Falls back to buildItemCached when no worker is available.
 */
export async function buildItemAsync(item, ctx = {}) {
  if (!ctx.materials) return buildItem(item, ctx);
  const cache = cacheFor(ctx.materials);
  const key = itemCacheKey(item, ctx);
  if (!cache.has(key) && buildWorker()) {
    const r = await buildRemote(item, ctx);
    if (!cache.has(key) && r && r.tree) cache.set(key, { proto: fromTree(r.tree, ctx.materials), refs: 0 });
  }
  return buildItemCached(item, ctx);
}

/** True when generators run off the main thread. */
export function hasBuildWorker() { return !!buildWorker(); }
