// Villar — procedural PBR material library. Owner: modeler.
//
//   import { createMaterials, boxProjectUVs } from './materials.js';
//   const materials = createMaterials(renderer);          // textures are generated lazily, once
//   materials.get('walnut-dark');                          // cached MeshPhysicalMaterial
//   materials.get('fabric-boucle', { color: '#E8E1D5' });  // cached by key + options
//   materials.get('oak-floor', { species: 'oak-light' });  // plank floor (2.4 m × 1.2 m tile)
//   materials.setLampsOn(true);                            // lamp-shade / bulb materials glow
//
// UV CONVENTION — IMPORTANT: every textured material is authored for UVs in METRES
// (1 UV unit = 1 m of real surface). Each texture's `repeat` is 1 / (tile size in m).
// Architecture/furniture geometry should therefore carry world-scale UVs:
//   boxProjectUVs(geometry, { axis: 'x' })   // tri-planar box projection in local metres
//   planarUVs(geometry, 'xz')                // floors/ceilings; 'xy' / 'zy' for walls
// (Default PlaneGeometry / BoxGeometry UVs are 0..1 per face → textures would look 3–20× too big.)
// Exceptions that use 0..1 UVs: 'canvas' (art image), 'wool-rug' with a `pattern` (rug pattern),
// 'plant-leaf' (leaf space).
//
// All materials are MeshStandardMaterial / MeshPhysicalMaterial (path-tracer compatible).

// by URL = the module the import map's 'three' resolves to (one instance); also loadable in a Worker (T8)
import * as THREE from '../../vendor/three/three.module.js';
import * as T from './textures.js';

export const MATERIAL_KEYS = [
  'walnut-dark', 'walnut-medium', 'oak-light', 'oak-natural', 'ash-black', 'teak', 'oak-floor', 'porcelain-tile', 'plaster-wall', 'paint',
  'fabric-boucle', 'fabric-linen', 'fabric-velvet', 'fabric-cotton', 'fabric-wool', 'fabric-knit', 'fabric-sheer', 'fabric-weave', 'paper-cord', 'leather-cognac', 'metal-black', 'metal-white', 'metal-brass',
  'metal-chrome', 'metal-nickel', 'marble-white', 'travertine', 'stone-worktop', 'ceramic-matte', 'ceramic-glazed', 'glass-clear', 'glass-frosted',
  'ash-light', 'oak-white', 'terrazzo', 'metal-brass-brushed', 'terracotta', 'stoneware', 'fabric-linen-washed', 'wax', 'flame', 'fruit', 'cork',
  'rattan', 'cane', 'rattan-wrap', 'fringe', 'lining', 'jute', 'wool-rug', 'glass-amber', 'opal-glass', 'plant-leaf', 'plant-stem', 'bark', 'soil', 'lamp-shade', 'paper-shade', 'bulb', 'kitchen-front', 'lacquer',
  'mirror', 'canvas', 'paper', 'pages', 'cord', 'rubber', 'plastic-white',
];

/** Loose names → canonical keys (catalog params may use free-form material names). */
const ALIASES = [
  [/walnut.*(light|natural|medium)|^walnut-?med/, 'walnut-medium'],
  [/walnut|dark.?wood|espresso|wenge|chocolate/, 'walnut-dark'],
  [/oak.*floor|parquet|laminate|floor/, 'oak-floor'],
  [/smoked|oak.*(dark|natural|honey)|natural.?oak/, 'oak-natural'],
  [/white.?oak|oak.?white|bleach|limed|whitewash|white.?oil/, 'oak-white'],
  [/\bash\b(?!-black)|ash-light|light.?ash|ash.?wood|natural.?ash/, 'ash-light'],
  [/oak|beech|birch|pine|light.?wood|maple/, 'oak-light'],
  [/black.*(ash|oak|wood)|ash-black|ebon/, 'ash-black'],
  [/teak|mango|acacia|sheesham|rosewood|solid.?wood|wood|veneer|timber/, 'teak'],
  [/rattan.?wrap|wrapped|binding/, 'rattan-wrap'],
  [/fringe|tassel/, 'fringe'],
  [/lining|liner/, 'lining'],
  [/vienna|cane|straw|webbing|сетк/, 'cane'],
  [/rattan|wicker|bamboo|woven|basket/, 'rattan'],
  [/jute|sisal|seagrass|rope|hemp/, 'jute'],
  [/bouc|sherpa|teddy/, 'fabric-boucle'],
  [/velvet|velour|chenille/, 'fabric-velvet'],
  [/washed.?linen|linen.?washed|stone.?washed|stonewash/, 'fabric-linen-washed'],
  [/linen|fabric|polyester|textile|weave|upholster/, 'fabric-linen'],
  [/cotton|percale|sateen|satin/, 'fabric-cotton'],
  [/felt|wool-fabric/, 'fabric-wool'],
  [/knit|waffle|chunky/, 'fabric-knit'],
  [/sheer|voile/, 'fabric-sheer'],
  [/paper.?cord|danish.?cord|cord.?seat/, 'paper-cord'],
  [/leather|\bpu\b|suede|nubuck/, 'leather-cognac'],
  [/brushed.?(brass|gold|bronze)|satin.?(brass|gold)|antique.?brass|aged.?brass/, 'metal-brass-brushed'],
  [/brass|gold|bronze|copper/, 'metal-brass'],
  [/chrome|stainless|silver|polished.?steel/, 'metal-chrome'],
  [/nickel|brushed.?steel|aluminium|aluminum|steel/, 'metal-nickel'],
  [/white.*metal|metal.*white/, 'metal-white'],
  [/black|iron|metal|powder/, 'metal-black'],
  [/marble/, 'marble-white'],
  [/travert/, 'travertine'],
  [/terrazzo/, 'terrazzo'],
  [/stone|quartz|sinter|granite|concrete|cement/, 'stone-worktop'],
  [/terracotta|terra.?cotta|unglazed|clay|earthenware|теракот/, 'terracotta'],
  [/stoneware|speckle|reactive/, 'stoneware'],
  [/glaze|gloss.*cer/, 'ceramic-glazed'],
  [/ceram|porcel|resin|polyresin/, 'ceramic-matte'],
  [/wax|candle/, 'wax'],
  [/cork/, 'cork'],
  [/opal|milk.?glass/, 'opal-glass'],
  [/amber|smok/, 'glass-amber'],
  [/frost|satin.?glass/, 'glass-frosted'],
  [/glass|acrylic/, 'glass-clear'],
  [/wool|rug|carpet|shag/, 'wool-rug'],
  [/rice.?paper|paper.?shade/, 'paper-shade'],
  [/shade/, 'lamp-shade'],
  [/mirror/, 'mirror'],
  [/lacquer|gloss/, 'lacquer'],
  [/mdf|paint|matt|kitchen|front/, 'kitchen-front'],
  [/plaster|wall/, 'plaster-wall'],
  [/plastic|pvc|abs/, 'plastic-white'],
  [/leaf|foliage/, 'plant-leaf'],
  [/paper/, 'paper'],
];

export function resolveMaterialKey(key) {
  if (!key) return 'paint';
  const k = String(key).toLowerCase().trim();
  if (MATERIAL_KEYS.includes(k)) return k;
  for (const [re, canon] of ALIASES) if (re.test(k)) return canon;
  return 'paint';
}

// ---------------------------------------------------------------- UV helpers (metres)

const _n = new THREE.Vector3();

/**
 * Tri-planar box projection in local metres. Converts to non-indexed so each triangle gets one
 * projection (no smearing across the 45° switch). `axis` = preferred U direction ('x' | 'y' | 'z'),
 * e.g. 'y' for vertical wood grain on legs. `offset` shifts the texture (randomise per piece).
 */
export function boxProjectUVs(geometry, { axis = 'x', scale = 1, offset = [0, 0] } = {}) {
  const fa = geometry.userData && geometry.userData.faceAxis;
  if (fa && geometry.index && fa.length === geometry.attributes.position.count) {
    // per-face grids (softBox): project each vertex by its face's axis, keep the geometry indexed
    const pos = geometry.attributes.position, uv = new Float32Array(pos.count * 2), s = 1 / scale;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), dom = fa[i];
      let u, v;
      if (dom === 1) { if (axis === 'z') { u = z; v = x; } else { u = x; v = z; } }
      else if (dom === 2) { if (axis === 'y') { u = y; v = x; } else { u = x; v = y; } }
      else { if (axis === 'y') { u = y; v = z; } else { u = z; v = y; } }
      uv[i * 2] = u * s + offset[0]; uv[i * 2 + 1] = v * s + offset[1];
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geometry;
  }
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const s = 1 / scale;
  for (let i = 0; i < pos.count; i += 3) {
    _n.set(0, 0, 0);
    for (let k = 0; k < 3; k++) { _n.x += nor.getX(i + k); _n.y += nor.getY(i + k); _n.z += nor.getZ(i + k); }
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    const dom = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k);
      let u, v;
      if (dom === 'y') { if (axis === 'z') { u = z; v = x; } else { u = x; v = z; } }
      else if (dom === 'z') { if (axis === 'y') { u = y; v = x; } else { u = x; v = y; } }
      else { if (axis === 'y') { u = y; v = z; } else { u = z; v = y; } }
      uv[(i + k) * 2] = u * s + offset[0];
      uv[(i + k) * 2 + 1] = v * s + offset[1];
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Cylindrical projection around local Y (turned / lathe parts). u = height (grain runs along the
 * axis), v = |angle| × radius (mirrored → no seam). `ref` = reference radius in metres.
 */
export function cylinderUVs(geometry, { ref = null, offset = [0, 0], swap = false } = {}) {
  const g = geometry; // |angle| mapping is seamless → stays indexed
  const pos = g.attributes.position;
  let R = ref;
  if (!R) { R = 0; for (let i = 0; i < pos.count; i++) R = Math.max(R, Math.hypot(pos.getX(i), pos.getZ(i))); R = R * 0.8 || 0.05; }
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const a = Math.abs(Math.atan2(pos.getX(i), pos.getZ(i)));
    const u = pos.getY(i), v = a * R;
    uv[i * 2] = (swap ? v : u) + offset[0]; uv[i * 2 + 1] = (swap ? u : v) + offset[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Planar projection: plane 'xz' (floors), 'xy' (walls facing z), 'zy' (walls facing x). */
export function planarUVs(geometry, plane = 'xz', { scale = 1, offset = [0, 0] } = {}) {
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const a = plane[0], b = plane[1];
  for (let i = 0; i < pos.count; i++) {
    const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
    uv[i * 2] = p[a] / scale + offset[0]; uv[i * 2 + 1] = p[b] / scale + offset[1];
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** Scales existing 0..1 UVs to metres for a face of size (w, h) metres. */
export function scaleUVs(geometry, w, h) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  uv.needsUpdate = true;
  return geometry;
}

// ---------------------------------------------------------------- factory

export function createMaterials(renderer, { quality = 'high' } = {}) {
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 8;
  T.setMaxAnisotropy(Math.min(16, maxAniso));
  // texture resolution per tier (GPU memory: high ≈ 1, medium ¼, low ⅛ of the texels)
  T.setTextureQuality(quality === 'low' ? 0.35 : quality === 'medium' ? 0.5 : 1);
  // CPU copies are released after upload; regenerate procedurally if the GL context comes back (T4).
  // The engine should call materials.restore() FIRST in its own 'webglcontextrestored' handler (before any render
  // or bake) and bake when the returned Promise resolves; this listener is the fallback (deduped).
  let lastRestore = -1e9;
  const restore = () => {
    const now = performance.now();
    if (now - lastRestore > 1500) { lastRestore = now; T.restoreTextures(); }
    return T.whenTexturesReady();
  };
  const onRestore = () => { restore(); };
  renderer?.domElement?.addEventListener?.('webglcontextrestored', onRestore);

  const texCache = new Map();
  const matCache = new Map();
  const glowMats = new Set();
  let lampsOn = false;
  let lampIntensity = 1;

  const tex = (name, fn) => {
    if (!texCache.has(name)) texCache.set(name, fn());
    return texCache.get(name);
  };

  /** Texture clone sharing the procedural Source; heals itself if ever uploaded after the pixels were released. */
  const tclone = (t) => { const c = t.clone(); c.onUpdate = T.healOnUpdate; return c; };
  /** Clone a texture bundle with a different tile scale (shares GPU source). */
  const scaled = (bundle, s = 1, off = null) => {
    if (s === 1 && !off) return bundle;
    const out = { ...bundle };
    for (const k of ['map', 'normalMap', 'roughnessMap']) {
      if (!bundle[k]) continue;
      const t = tclone(bundle[k]);
      t.repeat.copy(bundle[k].repeat).multiplyScalar(1 / s);
      if (off) t.offset.set(off[0], off[1]);
      out[k] = t;
    }
    return out;
  };

  const col = (hex, fallback) => new THREE.Color(hex || fallback);
  /**
   * Colour compensated for the mean of a near-white detail map, so the rendered average equals the
   * catalogue colour. Material constructors COPY colours, so the correction is applied to the created
   * material in get() (see `fixes`) — now if the texture is ready, otherwise when it lands.
   */
  let fixes = [];
  const detailColor = (hex, bundle, fallback) => {
    const base = col(hex, fallback);
    if (bundle && bundle.onReady) fixes.push({ bundle, base });
    return base.clone().multiplyScalar(1 / Math.max(0.5, (bundle && bundle.mean) || 1));
  };
  const applyFixes = (m, list) => {
    for (const { bundle, base } of list) {
      const set = (b) => m.color.copy(base).multiplyScalar(1 / Math.max(0.5, b.mean || 1));
      bundle.onReady(set); // runs immediately when already generated
    }
  };
  /**
   * Shift a full-colour albedo texture so its average matches a catalogue hex (e.g. woodColor,
   * topColor). strength 0..1 (photo-estimated colours are trusted at 75 %).
   */
  const matchColor = (m, bundle, hex, strength = 0.75, ref = null) => {
    if (!hex || !bundle) return m;
    const apply = (b) => {
      const t = new THREE.Color(hex); const mr = b.meanRGB || [b.mean, b.mean, b.mean];
      if (ref) {
        // calibrated species (R2-04): catalogue photo estimates of dark woods read 1–1.5 stops under the real
        // albedo. Keep their hue and their tone *relative* to the species reference (√ compressed) and anchor the
        // level to the palette mean, so '#5A3F2E' → palette mean (≈ #73523A), '#4A3528' → ≈ #69492F, '#6E4A33' → ≈ #7D5940.
        const lum = (c) => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
        const Lt = Math.max(1e-4, lum(t)), Lr = Math.max(1e-4, lum(new THREE.Color(ref)));
        const Lp = mr[0] * 0.3 + mr[1] * 0.59 + mr[2] * 0.11;
        t.multiplyScalar((Lp * Math.sqrt(Lt / Lr)) / Lt);
      }
      const k = [t.r / Math.max(1e-3, mr[0]), t.g / Math.max(1e-3, mr[1]), t.b / Math.max(1e-3, mr[2])].map((x) => 1 + (Math.min(3, x) - 1) * strength);
      m.color.setRGB(k[0], k[1], k[2]);
    };
    if (bundle.done) apply(bundle); else bundle.onReady(apply);
    return m;
  };

  const physical = (p) => new THREE.MeshPhysicalMaterial(p);
  const standard = (p) => new THREE.MeshStandardMaterial(p);

  const withTex = (b, nScale = 1) => ({
    map: b.map || null,
    normalMap: b.normalMap || null,
    normalScale: new THREE.Vector2(nScale, nScale),
    roughnessMap: b.roughnessMap || null,
  });

  // --- builders -------------------------------------------------
  const wood = (species, o, extra = {}) => {
    const chevron = /chevron|herring/.test(String(o.layout || ''));
    const b0 = chevron ? tex('chevron:' + species, () => T.chevronTextures(species)) : tex('wood:' + species, () => T.woodTextures(species, T.hashStr(species) % 97 + 3));
    const b = scaled(b0, o.scale || 1);
    const m = physical({
      ...withTex(b, 0.55), color: o.tint ? col(o.tint) : 0xffffff, roughness: o.roughness ?? 1, metalness: 0,
      clearcoat: o.clearcoat ?? extra.clearcoat ?? 0.18, clearcoatRoughness: extra.clearcoatRoughness ?? 0.42,
      specularIntensity: 0.6,
    });
    if (o.match) matchColor(m, b0, o.match, o.matchStrength ?? 0.75, T.WOOD_PALETTES[species]?.ref || null);
    return m;
  };

  const fabric = (bundleName, gen, o, defaults) => {
    const b = o.sheer ? scaled(tex('voile', () => T.voileTextures()), o.scale || 1) : scaled(tex(bundleName, gen), o.scale || 1);
    const c = detailColor(o.color, b, defaults.color);
    // sheen tinted by the fabric itself (fibre scatter), only slightly lifted — never a white satin highlight
    const sheenTint = new THREE.Color(o.color || defaults.color).lerp(new THREE.Color(0xffffff), defaults.sheenWhite ?? 0.08);
    const m = physical({
      ...withTex(b, defaults.normalScale ?? 1), color: c, roughness: o.roughness ?? 1, metalness: 0,
      sheen: defaults.sheen ?? 0.4, sheenRoughness: defaults.sheenRoughness ?? 0.85, sheenColor: sheenTint,
      specularIntensity: defaults.specular ?? 0.14,
      side: o.side ?? (o.sheer ? THREE.DoubleSide : THREE.FrontSide),
    });
    if (o.sheer) {
      // voile: open weave (alpha in the map) + density variation; ~0.45 average opacity
      m.roughnessMap = null; m.normalScale.set(0.5, 0.5);
      m.transparent = true; m.opacity = o.opacity ?? 0.95; m.depthWrite = false; m.userData.sheer = true;
      m.sheen = 0.6; m.sheenRoughness = 0.9; m.specularIntensity = 0.08;
    }
    return m;
  };

  const DEF = {
    // woods ----------------------------------------------------
    'walnut-dark': (o) => wood('walnut-dark', o, { clearcoat: 0.22 }),
    'walnut-medium': (o) => wood('walnut-medium', o, { clearcoat: 0.2 }),
    'oak-light': (o) => wood('oak-light', o, { clearcoat: 0.1, clearcoatRoughness: 0.5 }),
    'oak-natural': (o) => wood('oak-natural', o, { clearcoat: 0.12 }),
    // Japandi / Scandi: matte oiled finishes (low, broad clearcoat)
    'ash-light': (o) => wood('ash-light', o, { clearcoat: 0.08, clearcoatRoughness: 0.55 }),
    'oak-white': (o) => wood('oak-white', o, { clearcoat: 0.06, clearcoatRoughness: 0.6 }),
    'ash-black': (o) => wood('ash-black', o, { clearcoat: 0.12 }),
    'teak': (o) => wood('teak', o, { clearcoat: 0.12 }),
    'oak-floor': (o) => {
      const sp = o.species && T.WOOD_PALETTES[o.species] ? o.species : 'oak-light';
      const b = scaled(tex('floor:' + sp, () => T.floorTextures(sp, 3)), o.scale || 1);
      // matte-lacquered engineered oak: base roughness ≈ 0.55 (map) + clearcoat 0.3 / 0.3 for the window sheen
      return physical({ ...withTex(b, 0.7), roughness: o.roughness ?? 1, metalness: 0, clearcoat: o.clearcoat ?? 0.3, clearcoatRoughness: o.clearcoatRoughness ?? 0.3, specularIntensity: 0.5 });
    },
    // architecture --------------------------------------------
    'porcelain-tile': (o) => {
      const b = scaled(tex('tile:' + (o.color || 'def'), () => T.porcelainTileTextures(5, o.color || '#d9d4cc')), o.scale || 1);
      return physical({ ...withTex(b, 0.6), roughness: 1, metalness: 0, specularIntensity: 0.8 });
    },
    // walls: albedo/roughness mottling on a 3 m tile (opts.mottle scales it: 1 walls, 0.4 ceilings),
    // roller stipple normal on a 0.4 m tile
    'plaster-wall': (o) => DEF.paint({ mottle: 1.4, ...o }),
    'paint': (o) => {
      const amp = Math.round((o.mottle ?? 1) * 10) / 10;
      const b = scaled(tex('paint:' + amp, () => T.paintTextures(71, amp)), o.scale || 1);
      const st = scaled(tex('stipple', () => T.paintStippleTextures()), o.scale || 1);
      return standard({ map: b.map, roughnessMap: b.roughnessMap, normalMap: st.normalMap, normalScale: new THREE.Vector2(0.15, 0.15), color: detailColor(o.color, b, '#EDE7DE'), roughness: o.roughness != null ? o.roughness / 0.86 : 1, metalness: 0 });
    },
    'kitchen-front': (o) => {
      const b = tex('peel', () => T.orangePeelTextures(81, 0.15));
      const m = physical({ normalMap: b.normalMap, normalScale: new THREE.Vector2(0.12, 0.12), color: col(o.color, '#D8D0C4'), roughness: o.roughness ?? 0.42, metalness: 0, specularIntensity: 0.6 });
      return m;
    },
    'lacquer': (o) => {
      const b = tex('peel', () => T.orangePeelTextures(81, 0.15));
      return physical({ normalMap: b.normalMap, normalScale: new THREE.Vector2(0.05, 0.05), color: col(o.color, '#2b2724'), roughness: o.roughness ?? 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12 });
    },
    // textiles ------------------------------------------------
    'fabric-boucle': (o) => fabric('boucle', () => T.boucleTextures(), o, { color: '#E8E1D5', sheen: 0.8, sheenRoughness: 0.95, normalScale: 1.2, sheenWhite: 0.12, specular: 0.12 }),
    'fabric-linen': (o) => fabric('linen', () => T.linenTextures(), o, { color: '#D9CDB8', sheen: 0.25, sheenRoughness: 0.8, normalScale: 1.0, specular: 0.15 }),
    'fabric-velvet': (o) => fabric('velvet', () => T.velvetTextures(), o, { color: '#6b6a4a', sheen: 1.0, sheenRoughness: 0.45, normalScale: 0.6, sheenWhite: 0.2, specular: 0.15 }),
    'fabric-cotton': (o) => fabric('cotton', () => T.cottonTextures(), o, { color: '#F2EFE9', sheen: 0.5, sheenRoughness: 0.85, normalScale: 0.6, specular: 0.12 }),
    'fabric-wool': (o) => fabric('woolpile', () => T.woolPileTextures(), o, { color: '#cfc6b8', sheen: 0.6, sheenRoughness: 0.9, normalScale: 0.6, specular: 0.1 }),
    'fabric-knit': (o) => fabric('knit', () => T.knitTextures(), o, { color: '#D3C6B1', sheen: 0.6, sheenRoughness: 0.9, normalScale: 1.2, specular: 0.1 }),
    'fabric-sheer': (o) => DEF['fabric-linen']({ ...o, sheer: true }),
    // woven cotton throw: open plain weave of ≈ 3 mm yarns with slubs (reads as cloth, not percale or felt)
    'fabric-weave': (o) => fabric('weave', () => T.linenTextures(119, { tile: 0.2, threads: 64 }), o, { color: '#D8CDBA', sheen: 0.45, sheenRoughness: 0.85, normalScale: 1.4, specular: 0.12 }),
    // stone-washed linen: same weave + soft crinkle relief, a touch more sheen from the broken fibres
    'fabric-linen-washed': (o) => fabric('linen-washed', () => T.linenTextures(113, { washed: true }), o, { color: '#D6CBB8', sheen: 0.35, sheenRoughness: 0.85, normalScale: 1.1, specular: 0.14 }),
    'paper-cord': (o) => {
      const c = o.color || '#cdb58a';
      const b = scaled(tex('cord:' + c, () => T.cordTextures(129, c)), o.scale || 1);
      return physical({ ...withTex(b, 1), roughness: 1, metalness: 0, sheen: 0.3, sheenRoughness: 0.8, sheenColor: new THREE.Color(c), specularIntensity: 0.2 });
    },
    'leather-cognac': (o) => {
      const c = o.color || '#86471f';
      const b = scaled(tex('leather:' + c, () => T.leatherTextures(141, c)), o.scale || 1);
      return physical({ ...withTex(b, 0.6), roughness: 1.05, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4, sheen: 0.15, sheenRoughness: 0.6, sheenColor: new THREE.Color(c), specularIntensity: 0.5 });
    },
    'wool-rug': (o) => {
      const fine = /weave|flat|kilim/.test(String(o.texture || ''));
      const pile = fine ? tex('linen-rug', () => T.linenTextures(117, { tile: 0.3, threads: 110 })) : tex('woolpile', () => T.woolPileTextures());
      const c = detailColor(o.color, pile, '#E3DACB');
      if (o.pattern && o.pattern !== 'none') {
        // pattern map in rug UV (0..1 over the rug); pile normal repeats in metres
        const w = o.w || 2.9, d = o.d || 2.0;
        const pattern = T.rugPatternTexture({ w, d, color: o.color || '#E3DACB', patternColor: o.patternColor || '#B9A88E', pattern: o.pattern, seed: o.seed || 1, shape: o.shape || 'rect' });
        const n = tclone(pile.normalMap); n.repeat.set(w / pile.tile[0], d / pile.tile[1]);
        const r = tclone(pile.roughnessMap); r.repeat.copy(n.repeat);
        return physical({ map: pattern, normalMap: n, normalScale: new THREE.Vector2(1, 1), roughnessMap: r, roughness: 1, color: detailColor('#ebebeb', pile, '#ebebeb'), sheen: 0.6, sheenRoughness: 0.9, sheenColor: new THREE.Color(o.color || '#E3DACB').lerp(new THREE.Color(0xffffff), 0.3), specularIntensity: 0.2 });
      }
      return physical({ ...withTex(scaled(pile, o.scale || 1), 1), color: c, roughness: 1, sheen: 0.5, sheenRoughness: 0.9, sheenColor: new THREE.Color(o.color || '#E3DACB').lerp(new THREE.Color(0xffffff), 0.3), specularIntensity: 0.2 });
    },
    'jute': (o) => {
      const c = o.color || '#b89a6c';
      if (o.pattern && o.pattern !== 'none' && o.pattern !== 'plain') {
        const w = o.w || 2.3, d = o.d || 1.6;
        const jb = tex('jute:' + c, () => T.juteTextures(161, c));
        const pattern = T.rugPatternTexture({ w, d, color: c, patternColor: o.patternColor || '#C2A77D', pattern: o.pattern, seed: o.seed || 1, shape: o.shape || 'rect' });
        const n = tclone(jb.normalMap); n.repeat.set(w / jb.tile[0], d / jb.tile[1]);
        return physical({ map: pattern, normalMap: n, normalScale: new THREE.Vector2(1, 1), roughness: 0.95, metalness: 0, sheen: 0.3, sheenRoughness: 0.9, sheenColor: new THREE.Color(c), specularIntensity: 0.3 });
      }
      const b = scaled(tex('jute:' + c, () => T.juteTextures(161, c)), o.scale || 1);
      return physical({ ...withTex(b, 1), roughness: 1, metalness: 0, sheen: 0.3, sheenRoughness: 0.9, sheenColor: new THREE.Color(c), specularIntensity: 0.3 });
    },
    // Vienna cane webbing (R2-13): one detail map for every colour, open octagonal holes via alphaTest (they also
    // cut the shadow), glossy strands. Use on double-sided planes; behind it is the room, not a backing.
    'cane': (o) => {
      const b = scaled(tex('cane', () => T.caneTextures(155)), o.scale || 1);
      const m = physical({ ...withTex(b, 0.9), color: detailColor(o.color, b, '#d2ad74'), roughness: 1, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide, clearcoat: 0.15, clearcoatRoughness: 0.35, specularIntensity: 0.55, sheen: 0.15, sheenRoughness: 0.5, sheenColor: new THREE.Color(o.color || '#d2ad74') });
      m.shadowSide = THREE.DoubleSide;
      return m;
    },
    // rattan / cane binding wrapped round frames and panel edges (u along the part)
    'rattan-wrap': (o) => {
      const b = scaled(tex('rattan-wrap', () => T.rattanWrapTextures()), o.scale || 1);
      return physical({ ...withTex(b, 1), color: detailColor(o.color, b, '#C4A57A'), roughness: 1, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.3, specularIntensity: 0.55 });
    },
    // fringe / tassel card strip (alpha), coloured like its textile
    'fringe': (o) => {
      const b = tex('fringe', () => T.fringeTextures());
      const m = physical({ map: b.map, normalMap: b.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: detailColor(o.color, b, '#D8CDBA'), roughness: 1, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide, sheen: 0.5, sheenRoughness: 0.9, sheenColor: new THREE.Color(o.color || '#D8CDBA'), specularIntensity: 0.1 });
      m.shadowSide = THREE.DoubleSide;
      return m;
    },
    // lamp-shade lining (styrene laminate inside fabric shades): matte, opaque, never glows → it is the shade's
    // shadow caster by day (R2-08) and the bright inner surface at night
    'lining': (o) => standard({ color: col(o.color, '#F4EFE6'), roughness: 0.85, metalness: 0 }),
    'rattan': (o) => {
      const c = o.color || '#c49a5e';
      const b = scaled(tex('rattan:' + c, () => T.rattanTextures(151, c)), o.scale || 1);
      return physical({ ...withTex(b, 1), roughness: 1, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.5, specularIntensity: 0.5, side: o.side ?? THREE.DoubleSide });
    },
    // metals --------------------------------------------------
    'metal-black': (o) => {
      const b = tex('peel', () => T.orangePeelTextures(81, 0.15));
      return physical({ normalMap: b.normalMap, normalScale: new THREE.Vector2(0.25, 0.25), color: col(o.color, '#1c1c1c'), roughness: o.roughness ?? 0.55, metalness: 0, specularIntensity: 0.7 });
    },
    'metal-white': (o) => {
      const b = tex('peel', () => T.orangePeelTextures(81, 0.15));
      return physical({ normalMap: b.normalMap, normalScale: new THREE.Vector2(0.2, 0.2), color: col(o.color, '#ece9e3'), roughness: o.roughness ?? 0.5, metalness: 0 });
    },
    'metal-brass': (o) => {
      const b = scaled(tex('brushed', () => T.brushedTextures()), o.scale || 1);
      return physical({ ...withTex(b, 0.3), color: col(o.color, '#c2a16a'), roughness: o.roughness ?? 1, metalness: 1, anisotropy: 0.5, anisotropyRotation: 0 });
    },
    // brushed / satin brass: stronger anisotropic streaks, broader highlight, slightly deeper colour
    'metal-brass-brushed': (o) => {
      const b = scaled(tex('brushed', () => T.brushedTextures()), o.scale || 1);
      return physical({ ...withTex(b, 0.4), color: col(o.color, '#b8955c'), roughness: o.roughness ?? 1.25, metalness: 1, anisotropy: 0.85, anisotropyRotation: o.rotation ?? 0 });
    },
    'metal-chrome': (o) => physical({ color: col(o.color, '#e9eaec'), roughness: o.roughness ?? 0.07, metalness: 1 }),
    'metal-nickel': (o) => {
      const b = scaled(tex('brushed', () => T.brushedTextures()), o.scale || 1);
      return physical({ ...withTex(b, 0.25), map: null, color: col(o.color, '#c9c8c4'), roughness: o.roughness ?? 0.8, metalness: 1, anisotropy: 0.6 });
    },
    'mirror': (o) => standard({ color: col(o.color, '#f4f6f6'), roughness: 0.015, metalness: 1 }),
    // stone & ceramic ----------------------------------------
    // finish: polished (default) | satin (marble-look sintered ceramic, honed stone): broader, softer highlight
    'marble-white': (o) => {
      const b0 = tex('marble', () => T.marbleTextures()); const b = scaled(b0, o.scale || 1);
      const satin = o.finish === 'satin' || o.finish === 'honed';
      return matchColor(physical({ map: b.map, roughness: o.roughness ?? (satin ? 0.24 : 0.12), metalness: 0, clearcoat: satin ? 0.3 : 0.6, clearcoatRoughness: satin ? 0.16 : 0.06, specularIntensity: satin ? 0.65 : 0.8 }), b0, o.match, 0.5);
    },
    'travertine': (o) => {
      const b0 = tex('travertine', () => T.travertineTextures()); const b = scaled(b0, o.scale || 1);
      return matchColor(physical({ ...withTex(b, 0.6), roughness: 1, metalness: 0, specularIntensity: 0.6 }), b0, o.match, 0.6);
    },
    'stone-worktop': (o) => {
      const b = scaled(tex('quartz', () => T.quartzTextures()), o.scale || 1);
      return physical({ ...withTex(b, 0.2), roughness: 1, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.15 });
    },
    'ceramic-matte': (o) => {
      const b = scaled(tex('ceramic', () => T.ceramicTextures()), o.scale || 1);
      return physical({ ...withTex(b, 0.5), color: detailColor(o.color, b, '#CBB89A'), roughness: o.roughness ?? 1, metalness: 0, specularIntensity: 0.6 });
    },
    'ceramic-glazed': (o) => {
      const b = scaled(tex('ceramic', () => T.ceramicTextures()), o.scale || 1);
      return physical({ map: b.map, normalMap: b.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), color: detailColor(o.color, b, '#e8e2d6'), roughness: o.roughness ?? 0.18, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.08 });
    },
    'terrazzo': (o) => {
      const key = 'terrazzo:' + (o.base || '') + (Array.isArray(o.chips) ? o.chips.join(',') : '');
      const b0 = tex(key, () => T.terrazzoTextures(63, { ...(o.base ? { base: o.base } : {}), ...(Array.isArray(o.chips) ? { chips: o.chips } : {}) }));
      const b = scaled(b0, o.scale || 1);
      return matchColor(physical({ ...withTex(b, 0.4), roughness: 1, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.12, specularIntensity: 0.7 }), b0, o.match, 0.5);
    },
    'stoneware': (o) => {
      const b = scaled(tex('stoneware', () => T.stonewareTextures()), o.scale || 1);
      return physical({ ...withTex(b, 0.5), color: detailColor(o.color, b, '#E9E2D6'), roughness: o.roughness ?? 1, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35, specularIntensity: 0.6 });
    },
    'terracotta': (o) => {
      const b = scaled(tex('terracotta', () => T.terracottaTextures()), o.scale || 1);
      return physical({ ...withTex(b, 0.8), color: detailColor(o.color, b, '#B5674A'), roughness: o.roughness ?? 1, metalness: 0, specularIntensity: 0.35, sheen: 0.15, sheenRoughness: 0.9, sheenColor: new THREE.Color(o.color || '#B5674A') });
    },
    'wax': (o) => physical({ color: col(o.color, '#EFE7DA'), roughness: 0.55, metalness: 0, sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color('#fff6e8'), specularIntensity: 0.4 }),
    // candle flame: glows only while the lamps are on (setLampsOn); hidden by day
    'flame': (o) => {
      const m = physical({ color: col(o.color, '#ffd89a'), emissive: new THREE.Color('#ffae55'), emissiveIntensity: 0, roughness: 1, metalness: 0, transparent: true, opacity: 0.92, depthWrite: false });
      m.userData.hideWhenOff = true; m.visible = lampsOn;
      registerGlow(m, o, 4);
      return m;
    },
    // fruit skin: waxy, peel = 1 adds citrus pores
    'fruit': (o) => {
      const b = o.peel ? tex('peel-citrus', () => T.orangePeelTextures(83, 0.04)) : null;
      return physical({ normalMap: b ? b.normalMap : null, normalScale: new THREE.Vector2(0.8, 0.8), color: col(o.color, '#E08A2C'), roughness: o.peel ? 0.5 : 0.38, metalness: 0, clearcoat: o.peel ? 0.15 : 0.45, clearcoatRoughness: 0.35, sheen: 0.2, sheenRoughness: 0.6, sheenColor: new THREE.Color(o.color || '#E08A2C') });
    },
    'cork': (o) => {
      const b = tex('terracotta', () => T.terracottaTextures());
      return physical({ ...withTex(b, 1.4), color: detailColor(o.color, b, '#B48E64'), roughness: 1, metalness: 0, specularIntensity: 0.2 });
    },
    'glass-clear': (o) => physical({ color: col(o.color, '#ffffff'), roughness: 0.02, metalness: 0, transmission: 1, thickness: o.thickness ?? 0.006, ior: 1.5, specularIntensity: 1, attenuationColor: new THREE.Color('#e9f3ef'), attenuationDistance: 0.6 }),
    // tinted glass: amber (default) or smoke (pass a grey-brown tint and a longer distance → lighter)
    'glass-amber': (o) => physical({ color: col(o.color, '#ffffff'), roughness: 0.04, metalness: 0, transmission: 1, thickness: o.thickness ?? 0.006, ior: 1.5, attenuationColor: new THREE.Color(o.tint || '#b8742a'), attenuationDistance: o.distance ?? 0.02, specularIntensity: 1 }),
    'opal-glass': (o) => {
      const m = physical({ color: col(o.color, '#f6f3ee'), roughness: 0.25, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.05, emissive: new THREE.Color('#ffcf96'), emissiveIntensity: 0, specularIntensity: 0.8, side: THREE.DoubleSide });
      registerGlow(m, o, 0.9);
      return m;
    },
    'glass-frosted': (o) => physical({ color: col(o.color, '#f7f7f5'), roughness: 0.4, metalness: 0, transmission: 1, thickness: o.thickness ?? 0.01, ior: 1.5, specularIntensity: 1 }),
    // moulded plastic (kettles, appliances): colour + roughness (matte black ≈ 0.6) with a faint orange-peel
    'plastic-white': (o) => {
      const b = tex('peel', () => T.orangePeelTextures(81, 0.15));
      return physical({ normalMap: b.normalMap, normalScale: new THREE.Vector2(0.08, 0.08), color: col(o.color, '#f0eee9'), roughness: o.roughness ?? 0.4, metalness: 0, clearcoat: o.clearcoat ?? 0.2, clearcoatRoughness: 0.3, specularIntensity: 0.6 });
    },
    'rubber': (o) => standard({ color: col(o.color, '#1a1a1a'), roughness: 0.8, metalness: 0 }),
    'cord': (o) => physical({ color: col(o.color, '#151515'), roughness: 0.7, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#555') }),
    // plants --------------------------------------------------
    'plant-leaf': (o) => {
      // pattern 'snake': Sansevieria banding + yellow margin baked into the map (leaf-space UVs)
      const b = o.pattern === 'snake' ? tex('leaf-snake', () => T.snakeLeafTextures()) : tex('leaf', () => T.leafTextures());
      return physical({ map: b.map, normalMap: b.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: col(o.color, '#ffffff'), vertexColors: !!o.vertexColors, roughness: o.roughness ?? 0.5, metalness: 0, side: THREE.DoubleSide, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color('#b7cf8f'), specularIntensity: 0.5 });
    },
    'plant-stem': (o) => standard({ color: col(o.color, '#5d5a3c'), roughness: 0.7, metalness: 0, vertexColors: !!o.vertexColors }),
    // olive / tree bark (R2-17): grey-brown, darker than any pot, fissured; o.color tints it
    'bark': (o) => {
      const b = tex('bark2', () => T.barkTextures());
      return standard({ map: b.map, normalMap: b.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: b.roughnessMap, roughness: 1, metalness: 0, color: col(o.color, '#ffffff') });
    },
    'soil': (o) => {
      const b = scaled(tex('soil', () => T.soilTextures()), o.scale || 1);
      return standard({ ...withTex(b, 1), roughness: 1, metalness: 0 });
    },
    // lighting ------------------------------------------------
    'lamp-shade': (o) => {
      const b = scaled(tex('linen', () => T.linenTextures()), o.scale || 1);
      const c = detailColor(o.color, b, '#EDE5D6');
      // lit: warm emission with a weave × vertical falloff map (shade UV v = 0..1 bottom→top), so the
      // fabric stays visible and the rims darken; glow kept low so bloom doesn't wash it out
      const glow = tex('shadeglow', () => T.shadeGlowTextures());
      const m = physical({ ...withTex(b, 0.6), color: c, roughness: 1, metalness: 0, side: THREE.DoubleSide, sheen: 0.25, sheenRoughness: 0.85, sheenColor: new THREE.Color(o.color || '#EDE5D6'), emissive: new THREE.Color('#ffcf96').lerp(new THREE.Color(o.color || '#EDE5D6'), 0.25), emissiveMap: glow.map, emissiveIntensity: 0, specularIntensity: 0.12 });
      registerGlow(m, o, 0.7);
      return m;
    },
    // paper shade; o.cord = wound paper cord (column lamps: UV u along the height) with an even glow
    'paper-shade': (o) => {
      if (o.cord) {
        const w = tex('rattan-wrap', () => T.rattanWrapTextures());
        const m = physical({ map: w.map, normalMap: w.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: w.roughnessMap, color: detailColor(o.color, w, '#EEE8DE'), roughness: 2.4, metalness: 0, side: THREE.FrontSide, sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color(o.color || '#EEE8DE'), emissive: new THREE.Color('#ffcf96').lerp(new THREE.Color(o.color || '#EEE8DE'), 0.35), emissiveIntensity: 0, specularIntensity: 0.1 });
        registerGlow(m, o, 0.55);
        return m;
      }
      const b = tex('cotton', () => T.cottonTextures());
      const glow = tex('shadeglow', () => T.shadeGlowTextures());
      const m = physical({ map: b.map, normalMap: b.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), color: col(o.color, '#F3EEE4'), roughness: 0.9, metalness: 0, side: THREE.DoubleSide, emissive: new THREE.Color('#ffcf96').lerp(new THREE.Color(o.color || '#F3EEE4'), 0.3), emissiveMap: glow.map, emissiveIntensity: 0, specularIntensity: 0.12 });
      registerGlow(m, o, 0.8);
      return m;
    },
    'bulb': (o) => {
      const m = standard({ color: col(o.color, '#fff4e0'), roughness: 0.3, metalness: 0, emissive: new THREE.Color('#ffd7a0'), emissiveIntensity: 0 });
      registerGlow(m, o, 6);
      return m;
    },
    // paper & art ---------------------------------------------
    'paper': (o) => standard({ color: col(o.color, '#f1ede4'), roughness: 0.9, metalness: 0 }),
    'pages': (o) => {
      const b = tex('pages', () => pagesTex());
      return standard({ map: b, color: col(o.color, '#efe8da'), roughness: 0.92, metalness: 0 });
    },
    'canvas': (o) => {
      const w = o.w || 0.6, h = o.h || 0.8;
      const weave = tex('canvasweave', () => T.canvasWeaveTextures());
      const n = tclone(weave.normalMap); n.repeat.set(w / weave.tile[0], h / weave.tile[1]);
      const art = o.map || T.artTexture({ motif: o.motif, colors: o.colors, aspect: w / h, seed: o.seed || 1, relief: !!o.relief });
      // relief art (mirrored = the pair hung flipped: the relief's x slope flips with it)
      if (art && art.normalMap) return standard({ map: art.map, normalMap: art.normalMap, normalScale: new THREE.Vector2(o.mirrored ? -0.9 : 0.9, -0.9), roughness: 0.86, metalness: 0 });
      return standard({ map: art, normalMap: n, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.88, metalness: 0 });
    },
  };

  function pagesTex() {
    // fine horizontal lines for book page edges (UV v across page stack)
    const w = 8, h = 256, d = new Uint8Array(w * h * 4); const r = T.rng(5);
    for (let y = 0; y < h; y++) { const k = 225 + r() * 30 | 0; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = k; d[i + 1] = k - 4; d[i + 2] = k - 12; d[i + 3] = 255; } }
    const t = T.dataTexture(d, w, h, { srgb: true, repeat: [1, 1 / 0.04] });
    return t;
  }

  function registerGlow(m, o, k) {
    m.userData.glow = k;
    if (o.lit === true) { m.emissiveIntensity = k * lampIntensity; return; }
    if (o.lit === false) return;
    m.userData.followsLamps = true;
    glowMats.add(m);
    m.emissiveIntensity = lampsOn ? k * lampIntensity : 0;
  }

  const keyOf = (key, opts) => {
    if (!opts) return key;
    const ks = Object.keys(opts).filter((k) => opts[k] !== undefined && k !== 'map').sort();
    let s = key;
    for (const k of ks) s += '|' + k + '=' + (typeof opts[k] === 'object' ? JSON.stringify(opts[k]) : String(opts[k]));
    if (opts.map) s += '|map=' + opts.map.uuid;
    return s;
  };

  function get(key, opts = {}) {
    let canon = resolveMaterialKey(key);
    const o = { ...(opts || {}) };
    // free-form wood/floor keys like 'walnut-floor'
    if (canon === 'oak-floor' && !o.species) {
      const k = String(key).toLowerCase();
      if (k.includes('walnut')) o.species = 'walnut-medium';
      else if (k.includes('natural') || k.includes('smoked')) o.species = 'oak-natural';
    }
    if (typeof o.color === 'number') o.color = '#' + o.color.toString(16).padStart(6, '0');
    for (const ck of ['color', 'tint', 'patternColor', 'match']) if (o[ck] != null && !(typeof o[ck] === 'string' && /^(#[0-9a-f]{3}([0-9a-f]{3})?|rgb\(.*\)|hsl\(.*\)|[a-z]+)$/i.test(o[ck].trim()) && (o[ck][0] === '#' || o[ck].startsWith('rgb') || o[ck].startsWith('hsl') || o[ck].toLowerCase() in THREE.Color.NAMES))) delete o[ck];
    const ck = keyOf(canon, o);
    let m = matCache.get(ck);
    if (!m) {
      fixes = [];
      m = DEF[canon](o);
      applyFixes(m, fixes);
      fixes = [];
      m.name = canon;
      m.userData.materialKey = canon;
      matCache.set(ck, m);
    }
    return m;
  }

  function setLampsOn(on, intensity = 1) {
    lampsOn = !!on; lampIntensity = intensity;
    for (const m of glowMats) { m.emissiveIntensity = lampsOn ? (m.userData.glow || 1) * lampIntensity : 0; if (m.userData.hideWhenOff) m.visible = lampsOn; }
  }

  function dispose() {
    for (const m of matCache.values()) m.dispose();
    const seen = new Set();
    for (const b of texCache.values()) {
      const list = b && b.isTexture ? [b] : Object.values(b || {}).filter((t) => t && t.isTexture);
      for (const t of list) if (!seen.has(t)) { seen.add(t); t.dispose(); }
    }
    matCache.clear(); texCache.clear(); glowMats.clear();
    T.forgetTextures();
    renderer?.domElement?.removeEventListener?.('webglcontextrestored', onRestore);
  }

  /** Pre-generate textures for a list of keys (e.g. during a loading screen). */
  function warm(keys = ['oak-floor', 'plaster-wall', 'walnut-dark', 'fabric-boucle', 'fabric-linen']) {
    for (const k of keys) get(k);
  }

  return {
    get, setLampsOn, dispose, warm,
    /** Resolves when every queued procedural texture has been generated (await before photo mode). */
    ready: () => T.whenTexturesReady(),
    /** Number of textures still generating. */
    pending: () => T.pendingTextures(),
    /** Generate everything still queued synchronously (blocking). */
    flush: () => T.flushTextures(),
    /**
     * T4: after 'webglcontextrestored', call before the first render: art/rug canvases are redrawn synchronously
     * with fresh GL storage, procedural maps get placeholder pixels at once and their real pixels time-sliced.
     * Resolves when every texture is back (bake GI / capture reflections then). Idempotent per restore.
     */
    restore,
    /** Redraw + re-upload only the art canvases (cheap, synchronous). */
    restoreArt: () => T.restoreArt(),
    get lampsOn() { return lampsOn; },
    keys: MATERIAL_KEYS.slice(),
    resolve: resolveMaterialKey,
    boxProjectUVs, planarUVs, scaleUVs, cylinderUVs,
  };
}
