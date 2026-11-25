// Villar furniture generators — entry point. Owner: modeler.
//
//   import { buildItem, ARCHETYPES } from './furniture/index.js';
//   const group = buildItem(item, { materials });         // item = catalog item (dims in cm)
//   group.userData.anchors  → { top | seat | deck | ... : Vector3 } (local)
//   group.userData.lights   → [{ type, position:[x,y,z], color, intensity, distance, decay }]
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
import * as THREE from 'three';
import { hashStr } from '../textures.js';
import { triCount } from './geom.js';
import { sofa, armchair, diningChair, cushions } from './seating.js';
import { coffeeTable, sideTable, diningTable, nightstand, tvUnit } from './tables.js';
import { bed, mattress, bedding } from './beds.js';
import { floorLamp, tableLamp, pendantLamp } from './lighting.js';
import { rug, curtains } from './textiles.js';
import { wallArt, plant, decorSet } from './decor.js';

const GEN = {
  sofa, armchair, coffee_table: coffeeTable, side_table: sideTable, tv_unit: tvUnit, bed, mattress, bedding,
  nightstand, dining_table: diningTable, dining_chair: diningChair, floor_lamp: floorLamp, table_lamp: tableLamp,
  pendant_lamp: pendantLamp, rug, curtains, wall_art: wallArt, plant, decor_set: decorSet, cushions,
};

export const ARCHETYPES = Object.keys(GEN);

// how to fit the generated bbox to item.dims: which axes, and where the origin sits
const FIT = {
  default: { axes: 'xyz', origin: 'bottom' },
  bedding: { axes: '', origin: 'none' },
  cushions: { axes: '', origin: 'none' },
  decor_set: { axes: '', origin: 'none' },
  pendant_lamp: { axes: 'xz', origin: 'none' },
  wall_art: { axes: 'xy', origin: 'none' },
  curtains: { axes: 'y', origin: 'none' },
  plant: { axes: 'y', origin: 'bottom', uniform: true },
  floor_lamp: { axes: 'y', origin: 'bottom', uniform: true },
  table_lamp: { axes: 'y', origin: 'bottom', uniform: true },
  rug: { axes: 'xz', origin: 'none' },
  mattress: { axes: 'xyz', origin: 'bottom' },
};

const ARCH_ALIASES = {
  couch: 'sofa', loveseat: 'sofa', sectional: 'sofa', chair: 'armchair', accent_chair: 'armchair', lounge_chair: 'armchair',
  coffee: 'coffee_table', side: 'side_table', end_table: 'side_table', console: 'tv_unit', media_unit: 'tv_unit', sideboard: 'tv_unit',
  bedside: 'nightstand', bedside_table: 'nightstand', table: 'dining_table', chair_dining: 'dining_chair',
  lamp: 'table_lamp', pendant: 'pendant_lamp', ceiling_lamp: 'pendant_lamp', art: 'wall_art', poster: 'wall_art', mirror: 'wall_art',
  cushion: 'cushions', pillows: 'cushions', throw_pillows: 'cushions', decor: 'decor_set', vase: 'decor_set',
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
  const params = sanitizeParams(item?.model?.params);
  const seed = ctx.seed ?? (hashStr(String(item?.id || arch)) % 100000);
  // material accessor: wood parts follow the catalogue woodColor (photo estimate) unless a part overrides it
  const WOODS = ['walnut-dark', 'walnut-medium', 'oak-light', 'oak-natural', 'ash-black', 'teak'];
  const mat = (k, o) => {
    const canon = materials.resolve ? materials.resolve(k) : k;
    if (params.woodColor && WOODS.includes(canon) && !(o && (o.match || o.tint))) o = { ...(o || {}), match: params.woodColor };
    return materials.get(k, o);
  };
  if (!params.materials && Array.isArray(item?.materials)) params.materialHints = item.materials.map(ruMaterialKey);
  const c = { materials, W, D, H, params, item, seed, host: ctx.host || null, span: ctx.span || null, mat };
  let res;
  try {
    res = GEN[arch](c);
  } catch (e) {
    console.error(`[furniture] ${arch} (${item?.id}) failed:`, e);
    res = fallback(c);
  }
  const group = res.group || res;
  group.name = item?.id || arch;
  const anchors = res.anchors || {};
  const lights = res.lights || [];
  const info = res.anchorInfo || {};
  fit(group, anchors, lights, info, arch, W, D, H);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; o.userData.itemId = item?.id; } });
  group.userData.anchors = anchors;
  group.userData.anchorInfo = info;
  group.userData.lights = lights;
  group.userData.archetype = arch;
  group.userData.itemId = item?.id;
  group.userData.triangles = triCount(group);
  return group;
}

const ARRAY_KEYS = ['colors', 'items', 'pillowColors', 'fabrics', 'sizes', 'materials', 'heights', 'layers'];

/** Russian catalogue material names → library keys (used as hints, e.g. per-object decor materials). */
const RU = [
  [/травертин/i, 'travertine'], [/мрамор/i, 'marble-white'], [/латун|золот/i, 'metal-brass'], [/хром|сталь/i, 'metal-chrome'],
  [/венск|сетк/i, 'cane'], [/ротанг|плетён|гиацинт|шнур/i, 'rattan'], [/джут|сизаль/i, 'jute'], [/орех|дерев|шпон|гевеи|массив/i, 'walnut-dark'],
  [/дуб/i, 'oak-light'], [/терракот|глин/i, 'ceramic-matte:#B5674A'], [/керамик/i, 'ceramic-matte'], [/стекл/i, 'glass-clear'],
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

/** Scale/offset the generated content so its bbox matches dims exactly (per FIT rules). */
function fit(group, anchors, lights, info, arch, W, D, H) {
  const rule = FIT[arch] || FIT.default;
  if (!rule.axes && rule.origin === 'none') return;
  group.updateMatrixWorld(true);
  _box.setFromObject(group);
  if (_box.isEmpty()) return;
  const size = _box.getSize(new THREE.Vector3());
  const s = new THREE.Vector3(1, 1, 1);
  const want = { x: W, y: H, z: D };
  for (const a of rule.axes) {
    if (size[a] < 1e-4) continue;
    const k = want[a] / size[a];
    if (Math.abs(k - 1) > 1e-4) s[a] = k; // exact fit (generators are built close to dims already)
  }
  if (rule.uniform) { const k = s[rule.axes[0]]; s.set(k, k, k); }
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
  for (const L of lights) { const p = new THREE.Vector3(...L.position); tf(p); L.position = [p.x, p.y, p.z]; }
  for (const k of Object.keys(info)) { const i = info[k]; if (i.w) i.w *= s.x; if (i.d) i.d *= s.z; if (i.h) i.h *= s.y; }
}

export { triCount };
