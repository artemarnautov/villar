// Villar engine — digital twins: GLB reconstructions of the real products (docs/TWINS.md). Owner: twins.
//
//   const twins = createTwins({ THREE, renderer, baseUrl, quality });
//   twins.has(itemId)              true when site/data/twins.json lists a usable twin (false until `twins.ready`)
//   twins.load(item)               Promise<Object3D | null> — NEVER rejects: null on 404, bad dims, timeout (15 s),
//                                  corrupt / compressed / oversized files, abort. The procedural model simply stays.
//   twins.adopt(slotGroup, twin)   puts the twin into the SAME slot group; returns the procedural shell to fade out
//   twins.restore(slotGroup, twin, shell)   the way back (procedural again)
//   twins.release(twin)            hand an instance back (geometry / textures are freed with the last one, LRU)
//   twins.unload(itemId)           abort the in-flight load of an item and drop its cached model
//   twins.setLampsOn(on, k)        shade glow of lamp twins (mirror of materials.setLampsOn)
//   twins.dispose()                abort everything, free everything
//
// Manifest (site/data/twins.json), one entry per catalogue item id — written by the QA page, reviewed by hand:
//   { "<itemId>": {
//       "glb": "models/<id>.glb",   Storage key under `baseUrl` (a leading "/" = a path on this origin). Required.
//       "v": 1,                     version: cache-buster (?v=) and cache key. Bump when the file is regenerated.
//       "faces": 39874,             triangles of the file (information; the tier caps below are enforced on the file)
//       "dims": { "w": 211, "d": 87.4, "h": 86.2 },   the twin's own size in cm after the uniform scale (QA page).
//                                   Checked against the catalogue BEFORE downloading: a stale twin costs no bytes.
//       "yaw": 0,                   degrees about +Y applied before measuring, so the product's front faces +Z
//       "up": "y",                  "z" for a Z-up export
//       "lite": "models/<id>.lite.glb",  optional 20k-face variant for the low tier
//       "glow": [0.78, 1],          lamps: the shade as a band of the height (0 = floor, 1 = top) → glows at night
//       "glowK": 0.9,               its strength
//       "roughMin": 0.35,           roughness floor (default 0.35 for upholstery, 0.04 otherwise)
//       "origin": "bottom",         "bottom" (floor items) | "top" (pendants: ceiling mount) | "back" (wall items)
//       "check": "xyz",             which extents must match the catalogue (pendants: "xz")
//       "tol": 0.03,                tolerance of that check (≤ 0.06)
//       "fit": "exact",             "exact": after the check the remaining ≤ tol difference is scaled away per axis,
//                                   so the footprint equals the catalogue's; "uniform": keep the uniform scale;
//                                   "stretch" (engine, eng-8): like "exact" with a tolerance up to ±20 % — multiview
//                                   reconstructions get the depth wrong by ~10 % (Tripo armchair pilot: D −12 %)
//       "radial": false,            no meaningful front (plants, round lamps): the turntable may skip the dial
//       "off": true                 listed but not used (failed QA)
//   } }
//
// Normalisation (TWINS §2.4), in this order: up / yaw → precise bbox of every vertex → uniform scale by the
// catalogue's largest dimension → the other extents within ±3 % or the twin is rejected → floor at y = 0, pivot at
// the footprint centre, front +Z → materials (sRGB / linear slots, roughness floor, unlit → lit, the glTF
// "metallic 1 / roughness 1" default → dielectric) → textures ≤ 2K (high) / 1K (medium, low), uploaded one per
// frame → `userData.pivot / front / bounds / radial` exactly like the procedural items
// (docs/requests/engine.md "From modeler (round 5)") plus `userData.twin` (the QA report).
//
// The file must be a self-contained, uncompressed GLB: no Draco / meshopt / KTX2 (their decoders are not vendored
// and would need wasm in the CSP), no external buffers or images (a model file never makes the page fetch a URL).

const DEG = Math.PI / 180;
const TIMEOUT_MS = 15000;
const RETRY_MS = 120000;                    // a timeout / network error may be tried again after this; other failures are final
const LIMITS = {
  high: { tex: 2048, faces: 120000, bytes: 48e6, keep: 6 },
  medium: { tex: 1024, faces: 80000, bytes: 32e6, keep: 4 },
  low: { tex: 1024, faces: 45000, bytes: 20e6, keep: 2 },
};
const COMPRESSED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];
const KEY_RE = /^\/?[a-z0-9][a-z0-9/_.-]{0,160}\.glb$/i;
const SRGB_SLOTS = ['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap'];
const LINEAR_SLOTS = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenRoughnessMap', 'specularIntensityMap', 'transmissionMap', 'thicknessMap'];
// archetypes whose main surface is cloth or leather: generated PBR is too shiny on them (TWINS §2.4)
const UPHOLSTERED = new Set(['sofa', 'armchair', 'dining_chair', 'bed', 'cushions', 'throw', 'bedding', 'mattress', 'rug', 'runner', 'curtains']);
const RADIAL = new Set(['plant', 'pendant_lamp', 'centerpiece', 'floor_lamp', 'table_lamp']);
const ARCH_RULES = {
  pendant_lamp: { origin: 'top', check: 'xz' },
  wall_art: { origin: 'back', check: 'xy' },
  mirror: { origin: 'back', check: 'xy' },
};

class TwinError extends Error {
  constructor(reason, detail = '', data = null) { super(`${reason}${detail ? `: ${detail}` : ''}`); this.reason = reason; this.detail = detail; this.data = data; }
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r1 = (v) => Math.round(v * 10) / 10;
const archOf = (item) => String(item?.model?.archetype || item?.type || '').toLowerCase().replace(/[-\s]/g, '_');
const tick = () => new Promise((r) => {
  const t = setTimeout(r, 60);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { clearTimeout(t); r(); });
});

/** GLB container check before anything is parsed: magic, version, the JSON chunk's extensions, external URIs, size. */
function sniff(buffer, limits) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) throw new TwinError('corrupt', 'not a GLB (too short)');
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new TwinError('corrupt', 'not a GLB (magic)');
  if (dv.getUint32(4, true) !== 2) throw new TwinError('corrupt', `glTF version ${dv.getUint32(4, true)}`);
  const total = dv.getUint32(8, true), jsonLen = dv.getUint32(12, true);
  if (total > buffer.byteLength || dv.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLen > buffer.byteLength) throw new TwinError('corrupt', 'truncated GLB');
  let json;
  try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen))); } catch { throw new TwinError('corrupt', 'GLB JSON chunk'); }
  const used = [...(json.extensionsUsed || []), ...(json.extensionsRequired || [])];
  const bad = COMPRESSED.find((e) => used.includes(e));
  if (bad) throw new TwinError('compressed', `${bad} (deliver plain GLB)`);
  const external = [...(json.buffers || []), ...(json.images || [])].some((x) => typeof x?.uri === 'string' && !x.uri.startsWith('data:'));
  if (external) throw new TwinError('external', 'GLB references external files');
  let faces = 0;
  for (const m of json.meshes || []) for (const p of m.primitives || []) {
    const acc = (json.accessors || [])[p.indices ?? p.attributes?.POSITION];
    if (acc && (p.mode === undefined || p.mode === 4)) faces += Math.floor((acc.count || 0) / 3);
  }
  if (faces > limits.faces) throw new TwinError('heavy', `${faces} faces > ${limits.faces}`, { faces });
  if ((json.skins || []).length) throw new TwinError('rigged', 'skinned model');
  return { faces, images: (json.images || []).length, generator: String(json.asset?.generator || '').slice(0, 80) };
}

/** Precise bbox of every mesh vertex in `root`'s own space. */
function measure(THREE, root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    m.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
  });
  return box;
}

export function createTwins({
  THREE, renderer = null, baseUrl = '', quality = 'high', manifest = null, manifestUrl = null,
  fetch: fetchFn = null, timeout = TIMEOUT_MS, concurrency = 2, onReject = null,
} = {}) {
  if (!THREE) throw new Error('createTwins: THREE is required');
  const tier = LIMITS[quality] ? quality : 'high';
  const limits = LIMITS[tier];
  const doFetch = fetchFn || ((...a) => fetch(...a));
  const protos = new Map();       // key → { key, id, root, refs, bytes, at, glow: [materials], doomed }
  const pending = new Map();      // key → { promise, ctrl, id }
  const failed = new Map();       // key → retry-at (Infinity = final for this session)
  const errors = new Map();       // itemId → { reason, detail, data }
  const instances = new WeakMap(); // instance root → proto
  const glowMats = new Set();
  let lamps = { on: false, k: 1 };
  let disposed = false, entries = {}, loaderP = null, running = 0;
  const waiters = [];

  // ---------------------------------------------------------------- manifest
  function setManifest(m) {
    entries = {};
    for (const [id, e] of Object.entries(m && typeof m === 'object' ? m : {})) {
      if (!e || typeof e !== 'object' || typeof e.glb !== 'string' || !KEY_RE.test(e.glb) || e.glb.includes('..')) continue;
      if (e.lite !== undefined && (typeof e.lite !== 'string' || !KEY_RE.test(e.lite) || e.lite.includes('..'))) continue;
      entries[id] = e;
    }
  }
  const ready = (async () => {
    if (manifest) { setManifest(manifest); return true; }
    try {
      const url = manifestUrl || new URL('../../data/twins.json', import.meta.url).href;
      const res = await doFetch(url, { cache: 'no-cache' });
      if (res.ok) setManifest(await res.json());
    } catch { /* no manifest → no twins */ }
    return true;
  })();

  const variantOf = (e) => (tier === 'low' && e.lite ? 'lite' : 'full');
  const keyOf = (id, e) => `${id}|${variantOf(e)}|${e.v ?? 0}|${e.yaw ?? 0}`;
  const urlOf = (e) => {
    const k = variantOf(e) === 'lite' ? e.lite : e.glb;
    return `${k.startsWith('/') ? '' : baseUrl}${k}${e.v != null ? `?v=${encodeURIComponent(e.v)}` : ''}`;
  };
  const blocked = (key) => { const t = failed.get(key); if (t === undefined) return false; if (Date.now() < t) return true; failed.delete(key); return false; };

  function has(itemId) {
    const e = entries[itemId];
    if (disposed || !e || e.off) return false;
    if (!baseUrl && !String(variantOf(e) === 'lite' ? e.lite : e.glb).startsWith('/')) return false;
    return !blocked(keyOf(itemId, e));
  }

  // ---------------------------------------------------------------- rules per item
  function rulesFor(item, e) {
    const arch = archOf(item), base = ARCH_RULES[arch] || {};
    const d = item?.dims || {};
    const W = Number(d.w) / 100, H = Number(d.h) / 100, D = Number(d.d ?? d.w) / 100;
    const check = /^[xyz]{1,3}$/.test(e.check || '') ? e.check : base.check || 'xyz';
    return {
      arch, target: { x: W, y: H, z: D }, check,
      origin: ['bottom', 'top', 'back'].includes(e.origin) ? e.origin : base.origin || 'bottom',
      tol: Math.min(e.fit === 'stretch' ? 0.2 : 0.06, Math.max(0.001, Number(e.tol) || (e.fit === 'stretch' ? 0.15 : 0.03))),
      exact: e.fit !== 'uniform',
      yaw: Number(e.yaw) || 0, up: e.up === 'z' ? 'z' : 'y',
      roughMin: Number.isFinite(Number(e.roughMin)) && e.roughMin !== null && e.roughMin !== undefined ? Math.min(1, Math.max(0, Number(e.roughMin))) : UPHOLSTERED.has(arch) ? 0.35 : 0.04,
      radial: typeof e.radial === 'boolean' ? e.radial : RADIAL.has(arch),
      glow: Array.isArray(e.glow) && e.glow.length === 2 && e.glow.every((v) => Number.isFinite(v)) ? [Math.max(0, Math.min(e.glow[0], e.glow[1])), Math.min(1, Math.max(e.glow[0], e.glow[1]))] : null,
      glowK: Number.isFinite(Number(e.glowK)) && e.glowK != null ? Number(e.glowK) : 0.9,
    };
  }
  /** Manifest dims (cm) against the catalogue, before any download. */
  function precheck(item, e, R) {
    const m = e.dims;
    if (!m || typeof m !== 'object') return;
    const t = { x: R.target.x * 100, y: R.target.y * 100, z: R.target.z * 100 }, got = { x: Number(m.w), y: Number(m.h), z: Number(m.d ?? m.w) };
    for (const a of R.check) if (Number.isFinite(got[a]) && Number.isFinite(t[a]) && t[a] > 0 && Math.abs(got[a] / t[a] - 1) > R.tol + 0.002) {
      throw new TwinError('stale-dims', `manifest ${a} ${got[a]} cm vs catalogue ${r1(t[a])} cm`);
    }
  }

  // ---------------------------------------------------------------- normalise
  function normalise(scene, item, R, info) {
    const id = item.id;
    const strip = [];
    scene.traverse((o) => { if (o.isLight || o.isCamera || o.isPoints || o.isLine) strip.push(o); });
    for (const o of strip) o.removeFromParent();
    let faces = 0, vertices = 0, meshes = 0;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) throw new TwinError('rigged', 'skinned mesh');
      if (o.isInstancedMesh || o.isBatchedMesh) throw new TwinError('instanced', 'instanced meshes are not measured: deliver plain meshes');
      const g = o.geometry, pos = g?.attributes?.position;
      if (!pos || !pos.count) return;
      if (!g.attributes.normal) g.computeVertexNormals();
      faces += Math.floor((g.index ? g.index.count : pos.count) / 3); vertices += pos.count; meshes++;
    });
    if (!faces) throw new TwinError('empty', 'no triangles');
    if (faces > limits.faces) throw new TwinError('heavy', `${faces} faces > ${limits.faces}`, { faces });

    const root = new THREE.Group(), fitG = new THREE.Group(), rotG = new THREE.Group();
    root.name = `twin:${id}`; fitG.name = 'twin-fit'; rotG.name = 'twin-turn';
    root.add(fitG); fitG.add(rotG); rotG.add(scene);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R.yaw * DEG);
    if (R.up === 'z') q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    rotG.quaternion.copy(q);

    const b0 = measure(THREE, root);
    const s0 = b0.getSize(new THREE.Vector3());
    if (b0.isEmpty() || ![s0.x, s0.y, s0.z, b0.min.x, b0.min.y, b0.min.z].every(Number.isFinite) || Math.max(s0.x, s0.y, s0.z) <= 0) throw new TwinError('geometry', 'empty or non-finite bounds');
    const T = R.target;
    for (const a of R.check) if (!(T[a] > 0)) throw new TwinError('no-dims', `catalogue has no ${a} extent for ${id}`);
    // uniform scale by the catalogue's largest checked dimension …
    const lead = [...R.check].sort((a, b) => T[b] - T[a])[0];
    if (!(s0[lead] > 0)) throw new TwinError('geometry', `flat along ${lead}`);
    const s = T[lead] / s0[lead];
    // … then the others must agree within the tolerance
    const err = {}, cm = { w: r1(s0.x * s * 100), d: r1(s0.z * s * 100), h: r1(s0.y * s * 100) };
    let worst = 0;
    for (const a of R.check) { err[a] = s0[a] * s / T[a] - 1; worst = Math.max(worst, Math.abs(err[a])); }
    // would a quarter turn fit? (a hint for the QA page: front on ±X instead of ±Z)
    let turned = Infinity;
    if (R.check.includes('x') && R.check.includes('z')) {
      const sw = { x: s0.z, y: s0.y, z: s0.x }, st = T[lead] / sw[lead];
      turned = 0; for (const a of R.check) turned = Math.max(turned, Math.abs(sw[a] * st / T[a] - 1));
    }
    const report = {
      id, v: info.v ?? null, variant: info.variant, bytes: info.bytes, generator: info.generator || '',
      faces, vertices, meshes, yaw: R.yaw, up: R.up, origin: R.origin, check: R.check, tol: R.tol,
      native: { x: r6(s0.x), y: r6(s0.y), z: r6(s0.z) }, scale: r6(s), lead,
      catalogue: { w: r1(T.x * 100), d: r1(T.z * 100), h: r1(T.y * 100) }, dims: cm,
      err: { w: err.x ?? null, h: err.y ?? null, d: err.z ?? null }, worst, ok: worst <= R.tol,
      hint: worst > R.tol && turned <= R.tol ? 'fits after a quarter turn: try yaw ±90' : null,
      fixes: [], warnings: [], textures: [], ms: {},
    };
    if (!report.ok && !info.force) throw new TwinError('dims', `${[...R.check].map((a) => `${a} ${(err[a] * 100).toFixed(1)} %`).join(', ')} (tolerance ±${(R.tol * 100).toFixed(1)} %)${report.hint ? `; ${report.hint}` : ''}`, report);
    if (!report.ok) report.rejected = 'dims';

    const k = { x: s, y: s, z: s };
    if (R.exact && report.ok) for (const a of R.check) k[a] = T[a] / s0[a];
    report.residual = { x: r6(k.x / s - 1), y: r6(k.y / s - 1), z: r6(k.z / s - 1) };
    fitG.scale.set(k.x, k.y, k.z);
    const min = { x: b0.min.x * k.x, y: b0.min.y * k.y, z: b0.min.z * k.z }, max = { x: b0.max.x * k.x, y: b0.max.y * k.y, z: b0.max.z * k.z };
    const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
    if (R.origin === 'top') fitG.position.set(-cx, -max.y, -cz);            // ceiling mount, hangs −Y
    else if (R.origin === 'back') fitG.position.set(-cx, -cy, -min.z);      // centre of the back face, protrudes +Z
    else fitG.position.set(-cx, -min.y, -cz);                               // floor at y = 0, footprint centre
    const b = measure(THREE, root);
    root.userData.bounds = { min: b.min.toArray().map(r6), max: b.max.toArray().map(r6) };
    root.userData.pivot = [r6((b.min.x + b.max.x) / 2), r6(b.min.y), r6((b.min.z + b.max.z) / 2)];
    root.userData.front = [0, 0, 1];
    root.userData.radial = R.radial;
    root.userData.itemId = id;
    root.userData.archetype = R.arch;
    root.userData.triangles = faces;
    root.userData.twin = report;
    return root;
  }

  // ---------------------------------------------------------------- materials
  function fixMaterials(root, R, report) {
    const seen = new Map();
    const fix = (m) => {
      if (seen.has(m)) return seen.get(m);
      let out = m;
      if (!m.isMeshStandardMaterial) {
        // unlit / legacy materials would ignore the room's light: make them physically lit
        out = new THREE.MeshStandardMaterial({ color: m.color ? m.color.clone() : 0xffffff, map: m.map || null, roughness: 0.85, metalness: 0, side: m.side, vertexColors: !!m.vertexColors, alphaTest: m.alphaTest || 0 });
        if (m.isMeshBasicMaterial) report.warnings.push('unlit material: the texture has baked light');
        report.fixes.push(`${m.type} → MeshStandardMaterial`);
        m.dispose();
      }
      // the glTF defaults (metallic 1, roughness 1, no maps) mean "no PBR block was written": a dielectric
      if (!out.metalnessMap && !out.roughnessMap && out.metalness >= 0.9 && out.roughness >= 0.9) { out.metalness = 0; report.fixes.push('metallic default → 0'); }
      if (out.transparent) {
        // blended surfaces cannot dissolve or write depth: cut out instead
        out.transparent = false; out.depthWrite = true; out.opacity = 1; if (out.map) out.alphaTest = out.alphaTest || 0.5;
        report.fixes.push('alpha blend → cut-out');
      }
      for (const s of SRGB_SLOTS) if (out[s]?.isTexture && out[s].colorSpace !== THREE.SRGBColorSpace) { out[s].colorSpace = THREE.SRGBColorSpace; out[s].needsUpdate = true; report.fixes.push(`${s} → sRGB`); }
      for (const s of LINEAR_SLOTS) if (out[s]?.isTexture && out[s].colorSpace !== THREE.NoColorSpace) { out[s].colorSpace = THREE.NoColorSpace; out[s].needsUpdate = true; report.fixes.push(`${s} → linear`); }
      if (!out.roughnessMap && out.roughness < R.roughMin) { report.fixes.push(`roughness ${out.roughness.toFixed(2)} → ${R.roughMin}`); out.roughness = R.roughMin; }
      out.envMapIntensity = 1;
      out.name = `twin:${out.name || 'surface'}`;
      out.userData = { ...(out.userData || {}), twin: true };
      seen.set(m, out);
      return out;
    };
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
      o.castShadow = true; o.receiveShadow = true;
      o.userData.itemId = report.id;
    });
    report.materials = new Set(seen.values()).size;
  }

  /** Downscale to the tier's cap and clamp the roughness texels; one canvas pass per image, awaited between images. */
  async function fixTextures(root, R, report, alive) {
    const sources = new Map(); // Source → { texs: Set, slots: Set, floor: 0…255 }
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const s of [...SRGB_SLOTS, ...LINEAR_SLOTS]) {
          const t = m[s];
          if (!t?.isTexture || !t.source?.data) continue;
          let rec = sources.get(t.source);
          if (!rec) { rec = { texs: new Set(), slots: new Set(), floor: 0 }; sources.set(t.source, rec); }
          rec.texs.add(t); rec.slots.add(s);
          if (s === 'roughnessMap') rec.floor = Math.max(rec.floor, Math.min(255, Math.ceil(255 * R.roughMin / Math.max(0.05, m.roughness))));
        }
      }
    });
    const cap = Math.min(limits.tex, renderer?.capabilities?.maxTextureSize || limits.tex);
    const aniso = Math.min(tier === 'high' ? 8 : 4, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
    for (const [source, rec] of sources) {
      if (!alive()) return;
      const img = source.data, w = img.width | 0, h = img.height | 0;
      if (!w || !h) continue;
      const k = Math.min(1, cap / Math.max(w, h));
      // the texel floor: always for upholstery (≥ 0.1), for the small general floor only when the image is redrawn anyway
      const clamp = rec.floor > 0 && !rec.slots.has('map') && !rec.slots.has('emissiveMap');
      const entry = { slots: [...rec.slots].join('+'), from: [w, h], size: [w, h] };
      if (k < 1 || (clamp && R.roughMin >= 0.1)) {
        const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
        const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
        const ctx = canvas.getContext('2d', { willReadFrequently: clamp });
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, cw, ch);
        if (clamp) {
          const px = ctx.getImageData(0, 0, cw, ch), d = px.data, lo = rec.floor;
          let n = 0;
          for (let i = 1; i < d.length; i += 4) if (d[i] < lo) { d[i] = lo; n++; }
          if (n) { ctx.putImageData(px, 0, 0); entry.clamped = +(n / (cw * ch)).toFixed(3); }
        }
        let data = canvas;
        if (typeof createImageBitmap === 'function') { try { data = await createImageBitmap(canvas, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); } catch { data = canvas; } }
        source.data = data; source.needsUpdate = true;
        for (const t of rec.texs) t.needsUpdate = true;
        img.close?.();
        entry.size = [cw, ch];
        await tick();
      }
      for (const t of rec.texs) if (rec.slots.has('map') && t.anisotropy < aniso) t.anisotropy = aniso;
      report.textures.push(entry);
    }
    report.texMax = report.textures.reduce((a, t) => Math.max(a, t.size[0], t.size[1]), 0);
    report.gpuMB = +(report.textures.reduce((a, t) => a + t.size[0] * t.size[1] * 4 * 1.34, 0) / 1048576).toFixed(1);
    // upload one image per frame, so the dissolve starts on a warm GPU and no frame carries a 2K upload
    if (renderer?.initTexture) for (const rec of sources.values()) {
      if (!alive()) return;
      for (const t of rec.texs) { try { renderer.initTexture(t); } catch { /* uploads on first draw */ } }
      await tick();
    }
  }

  /** Lamps: the triangles inside the manifest's height band become the shade — own mesh, glows with setLampsOn. */
  function splitGlow(root, R, report, proto) {
    if (!R.glow) return;
    const b = root.userData.bounds, y0 = b.min[1], H = b.max[1] - b.min[1];
    const lo = y0 + R.glow[0] * H, hi = y0 + R.glow[1] * H;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4(), v = new THREE.Vector3();
    const targets = [];
    root.traverse((o) => { if (o.isMesh && !Array.isArray(o.material) && o.geometry?.attributes?.position) targets.push(o); });
    let lit = 0;
    for (const o of targets) {
      const g = o.geometry, pos = g.attributes.position;
      M.multiplyMatrices(inv, o.matrixWorld);
      const idx = g.index ? g.index.array : null, n = idx ? idx.length : pos.count;
      const ys = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) ys[i] = v.fromBufferAttribute(pos, i).applyMatrix4(M).y;
      const inside = [], rest = [];
      for (let i = 0; i + 2 < n; i += 3) {
        const a = idx ? idx[i] : i, bb = idx ? idx[i + 1] : i + 1, c = idx ? idx[i + 2] : i + 2;
        const y = (ys[a] + ys[bb] + ys[c]) / 3;
        (y >= lo && y <= hi ? inside : rest).push(a, bb, c);
      }
      if (!inside.length) continue;
      const mat = o.material.clone();
      mat.emissive = new THREE.Color('#ffcf96'); mat.emissiveMap = o.material.map || null; mat.emissiveIntensity = lamps.on ? R.glowK * lamps.k : 0;
      mat.side = THREE.DoubleSide; mat.name = 'twin:shade'; mat.userData = { ...o.material.userData, glow: R.glowK, twin: true };
      proto.glow.push(mat); glowMats.add(mat);
      const Arr = pos.count > 65535 ? Uint32Array : Uint16Array;
      if (!rest.length) { o.material = mat; o.userData.noCastShadow = true; o.castShadow = false; lit += inside.length / 3; continue; }
      const g2 = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(g.attributes)) g2.setAttribute(name, attr);
      g2.setIndex(new THREE.BufferAttribute(new Arr(inside), 1));
      g.setIndex(new THREE.BufferAttribute(new Arr(rest), 1));
      g.boundingBox = null; g.boundingSphere = null;
      const shade = new THREE.Mesh(g2, mat);
      shade.name = 'twin-shade'; shade.position.copy(o.position); shade.quaternion.copy(o.quaternion); shade.scale.copy(o.scale);
      shade.userData = { itemId: report.id, noCastShadow: true };
      shade.castShadow = false; shade.receiveShadow = true;
      o.parent.add(shade);
      lit += inside.length / 3;
    }
    report.glow = { band: R.glow, faces: lit };
    if (!lit) report.warnings.push('glow band holds no triangles');
  }

  // ---------------------------------------------------------------- load
  const acquire = () => (running < concurrency ? (running++, Promise.resolve()) : new Promise((r) => waiters.push(r)));
  const releaseSlot = () => { const next = waiters.shift(); if (next) next(); else running--; };
  const getLoader = () => (loaderP ||= import('three/addons/loaders/GLTFLoader.js').then((m) => m.GLTFLoader));

  async function toBuffer(src, signal, t) {
    if (src instanceof ArrayBuffer) return src;
    if (ArrayBuffer.isView(src)) return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
    if (typeof Blob !== 'undefined' && src instanceof Blob) {
      if (src.size > limits.bytes) throw new TwinError('heavy', `${(src.size / 1e6).toFixed(1)} MB > ${(limits.bytes / 1e6).toFixed(0)} MB`);
      return src.arrayBuffer();
    }
    let res;
    try { res = await doFetch(String(src), { signal, credentials: 'omit', cache: 'force-cache' }); }
    catch (e) { throw new TwinError(signal.aborted ? (signal.reason === 'timeout' ? 'timeout' : 'aborted') : 'network', String(e?.message || e)); }
    if (!res.ok) throw new TwinError(res.status === 404 ? 'not-found' : 'http', `HTTP ${res.status}`);
    const len = Number(res.headers?.get?.('content-length')) || 0;
    if (len > limits.bytes) { try { res.body?.cancel?.(); } catch { /* ignore */ } throw new TwinError('heavy', `${(len / 1e6).toFixed(1)} MB > ${(limits.bytes / 1e6).toFixed(0)} MB`); }
    let buf;
    try { buf = await res.arrayBuffer(); }
    catch (e) { throw new TwinError(signal.aborted ? (signal.reason === 'timeout' ? 'timeout' : 'aborted') : 'network', String(e?.message || e)); }
    if (buf.byteLength > limits.bytes) throw new TwinError('heavy', `${(buf.byteLength / 1e6).toFixed(1)} MB > ${(limits.bytes / 1e6).toFixed(0)} MB`);
    t.fetch = Math.round(performance.now() - t.t0);
    return buf;
  }

  function disposeTree(root) {
    const seen = new Set();
    root?.traverse?.((o) => {
      if (o.geometry) { if (o.geometry.boundsTree && o.geometry.disposeBoundsTree) o.geometry.disposeBoundsTree(); o.geometry.dispose(); }
      for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
        if (seen.has(m)) continue; seen.add(m);
        for (const s of [...SRGB_SLOTS, ...LINEAR_SLOTS]) {
          const tx = m[s];
          if (tx?.isTexture && !seen.has(tx)) { seen.add(tx); try { tx.source?.data?.close?.(); } catch { /* not a bitmap */ } tx.dispose(); }
        }
        glowMats.delete(m);
        m.dispose();
      }
    });
  }
  function disposeProto(p) {
    protos.delete(p.key);
    for (const m of p.glow) glowMats.delete(m);
    disposeTree(p.root);
    p.root = null;
  }
  function trim() {
    const idle = [...protos.values()].filter((p) => p.refs <= 0 && p.cache);
    idle.sort((a, b) => a.at - b.at);
    while (idle.length > limits.keep) disposeProto(idle.shift());
  }

  async function build(key, item, e, R, src, force) {
    const ctrl = new AbortController();
    const rec = { ctrl, id: item.id, promise: null };
    rec.promise = (async () => {
      await acquire();
      const t = { t0: performance.now() };
      const timer = setTimeout(() => ctrl.abort('timeout'), timeout);
      const alive = () => !ctrl.signal.aborted && !disposed;
      const stop = new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new TwinError(ctrl.signal.reason === 'timeout' ? 'timeout' : 'aborted', `after ${Math.round(performance.now() - t.t0)} ms`)), { once: true }));
      stop.catch(() => {});
      let root = null, scene = null;
      const proto = { key, id: item.id, root: null, refs: 0, bytes: 0, at: performance.now(), glow: [], cache: !src, doomed: false };
      try {
        if (ctrl.signal.aborted) throw new TwinError('aborted', 'before start');
        const buffer = await Promise.race([toBuffer(src ?? urlOf(e), ctrl.signal, t), stop]);
        const head = sniff(buffer, limits);
        const GLTFLoader = await Promise.race([getLoader(), stop]);
        const t1 = performance.now();
        const gltf = await Promise.race([new Promise((res, rej) => {
          try { new GLTFLoader().parse(buffer, '', res, (err) => rej(new TwinError('corrupt', String(err?.message || err).slice(0, 200)))); }
          catch (err) { rej(new TwinError('corrupt', String(err?.message || err).slice(0, 200))); }
        }).then((g) => { if (!alive()) disposeTree(g.scene || g.scenes?.[0]); return g; }), stop]);
        scene = gltf.scene || gltf.scenes?.[0];
        if (!scene) throw new TwinError('empty', 'no scene');
        t.parse = Math.round(performance.now() - t1);
        await tick();
        const t2 = performance.now();
        root = normalise(scene, item, R, { v: e.v, variant: src ? 'file' : variantOf(e), bytes: buffer.byteLength, generator: head.generator, force });
        const report = root.userData.twin;
        fixMaterials(root, R, report);
        proto.root = root; proto.bytes = buffer.byteLength;
        splitGlow(root, R, report, proto);
        t.fit = Math.round(performance.now() - t2);
        const t3 = performance.now();
        await Promise.race([fixTextures(root, R, report, alive), stop]);
        if (!alive()) throw new TwinError(ctrl.signal.reason === 'timeout' ? 'timeout' : 'aborted', 'during textures');
        t.tex = Math.round(performance.now() - t3);
        report.ms = { fetch: t.fetch ?? 0, parse: t.parse, fit: t.fit, tex: t.tex, total: Math.round(performance.now() - t.t0) };
        root.userData.triangles = report.faces;
        protos.set(key, proto);
        errors.delete(item.id);
        return proto;
      } catch (err) {
        const te = err instanceof TwinError ? err : new TwinError('error', String(err?.message || err).slice(0, 200));
        for (const m of proto.glow) glowMats.delete(m);
        disposeTree(root || scene);
        errors.set(item.id, { reason: te.reason, detail: te.detail, data: te.data });
        if (te.reason !== 'aborted' && !src) failed.set(key, te.reason === 'timeout' || te.reason === 'network' || te.reason === 'http' ? Date.now() + RETRY_MS : Infinity);
        if (te.reason !== 'aborted') { console.debug(`[villar] twin ${item.id}: ${te.message} — the procedural model stays`); try { onReject?.(item.id, te.reason, te.detail); } catch { /* listener */ } }
        return null;
      } finally {
        clearTimeout(timer);
        releaseSlot();
        if (pending.get(key) === rec) pending.delete(key);
      }
    })();
    pending.set(key, rec);
    return rec.promise;
  }

  function instance(proto) {
    const inst = proto.root.clone(true);            // shares geometry, materials and textures
    inst.userData.twin = proto.root.userData.twin;  // one report object (clone() deep-copies userData)
    proto.refs++; proto.at = performance.now();
    instances.set(inst, proto);
    return inst;
  }

  /**
   * item = the catalogue item ({ id, dims (cm), type, model }). Options (QA page / tests only):
   *   src    a File / Blob / ArrayBuffer / URL instead of the manifest's file (never cached)
   *   entry  manifest fields for this call (yaw, up, glow, tol, …), merged over the manifest's
   *   force  return the twin even when the ±tol check fails (`userData.twin.rejected = 'dims'`)
   */
  async function load(item, { src = null, entry = null, force = false } = {}) {
    try {
      await ready;
      if (disposed || !item?.id) return null;
      const e = { ...(entries[item.id] || {}), ...(entry || {}) };
      if (!src && (!entries[item.id] || e.off || typeof e.glb !== 'string')) return null;
      const R = rulesFor(item, e);
      const key = src ? `${item.id}|src|${Math.random().toString(36).slice(2)}` : keyOf(item.id, e);
      if (!src) {
        if (blocked(key)) return null;
        const hit = protos.get(key);
        if (hit && !hit.doomed) return instance(hit);
        try { precheck(item, e, R); }
        catch (err) { errors.set(item.id, { reason: err.reason, detail: err.detail }); failed.set(key, Infinity); console.debug(`[villar] twin ${item.id}: ${err.message} — the procedural model stays`); try { onReject?.(item.id, err.reason, err.detail); } catch { /* listener */ } return null; }
      }
      const run = pending.get(key)?.promise || build(key, item, e, R, src, force);
      const proto = await run;
      if (!proto || proto.doomed || disposed || !proto.root) return null;
      return instance(proto);
    } catch (err) {
      console.debug('[villar] twin load failed', err);
      return null;
    }
  }

  function release(inst) {
    const proto = inst && instances.get(inst);
    if (!proto) return;
    instances.delete(inst);
    inst.removeFromParent();
    proto.refs--;
    if (proto.refs <= 0 && (proto.doomed || !proto.cache)) disposeProto(proto);
    else trim();
  }

  function unload(itemId) {
    for (const [key, rec] of pending) if (rec.id === itemId) { rec.ctrl.abort('unload'); pending.delete(key); }
    for (const p of [...protos.values()]) if (p.id === itemId) { if (p.refs <= 0) disposeProto(p); else { p.doomed = true; protos.delete(p.key); } }
  }

  // ---------------------------------------------------------------- the slot group (engine integration)
  const holdsMesh = (o) => { let f = false; o.traverse((c) => { if (c.isMesh) f = true; }); return f; };
  /**
   * Put a loaded twin into the slot group the procedural item lives in. The procedural meshes move into one
   * `procedural` holder (returned) so the engine's fader can dissolve holder → twin inside the same group; lights,
   * light targets, anchors and the slot transform stay where they are. The twin's meshes get the group's
   * `slotId / slotType` (ID pass, picking) and the group's turntable fields become the twin's.
   */
  function adopt(group, twin) {
    const u = group.userData, shell = new THREE.Group();
    shell.name = 'procedural';
    for (const c of [...group.children]) if (c !== twin && !c.isLight && holdsMesh(c)) shell.add(c);
    group.add(shell); group.add(twin);
    twin.traverse((o) => {
      if (u.slotId !== undefined) { o.userData.slotId = u.slotId; o.userData.slotType = u.slotType; }
      if (o.isMesh) { o.castShadow = !o.userData.noCastShadow; o.receiveShadow = true; }
    });
    const t = twin.userData;
    shell.userData.procedural = { bounds: u.bounds, pivot: u.pivot, front: u.front, radial: u.radial, triangles: u.triangles };
    u.bounds = { min: [...t.bounds.min], max: [...t.bounds.max] }; u.pivot = [...t.pivot]; u.front = [...t.front]; u.radial = t.radial;
    u.triangles = t.triangles; u.twin = { v: t.twin?.v ?? null, faces: t.triangles };
    return shell;
  }
  /** Undo `adopt`: the procedural meshes return to the group, the twin leaves it (release it afterwards). */
  function restore(group, twin, shell) {
    if (shell) {
      const p = shell.userData.procedural || {};
      for (const c of [...shell.children]) group.add(c);
      shell.removeFromParent();
      Object.assign(group.userData, { bounds: p.bounds, pivot: p.pivot, front: p.front, radial: p.radial, triangles: p.triangles });
    }
    delete group.userData.twin;
    twin?.removeFromParent();
  }

  function setLampsOn(on, k = 1) {
    lamps = { on: !!on, k };
    for (const m of glowMats) m.emissiveIntensity = lamps.on ? (m.userData.glow || 1) * k : 0;
  }

  return {
    ready, has, load, release, unload, adopt, restore, setLampsOn,
    /** The manifest entry of an item (or null). */
    entry: (itemId) => entries[itemId] || null,
    /** Why the last load of this item returned null: { reason, detail, data } (data = the dims report on 'dims'). */
    lastError: (itemId) => errors.get(itemId) || null,
    /** The QA report of a loaded twin (also at `twin.userData.twin`). */
    report: (twin) => twin?.userData?.twin || null,
    stats: () => ({ tier, manifest: Object.keys(entries).length, cached: protos.size, loading: pending.size, failed: failed.size, instances: [...protos.values()].reduce((a, p) => a + p.refs, 0), gpuMB: +[...protos.values()].reduce((a, p) => a + (p.root?.userData.twin?.gpuMB || 0), 0).toFixed(1) }),
    limits: { ...limits, timeout },
    dispose() {
      disposed = true;
      for (const rec of pending.values()) rec.ctrl.abort('dispose');
      pending.clear();
      for (const p of [...protos.values()]) disposeProto(p);
      glowMats.clear(); failed.clear();
    },
  };
}
