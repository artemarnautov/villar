// Furniture fuzz build (Node, no browser): every archetype × 12 junk-param variants × 3 quality tiers, plus every
// catalogue item. Fails on: a throw / console.error from a generator, a non-finite bbox or vertex, a bad
// userData.pivot / front, and (NaN-tangent rule, 27 Nov) any mesh whose material has a normal map, a clearcoat
// normal map or anisotropy but no uvs / zero-area uvs. Also reports the largest catalogue triangle count per tier.
//   node tools/fuzz-furniture.mjs            → exit code 1 on any failure
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const THREE = await import(SITE + '/vendor/three/three.module.js');
const F = await import(SITE + '/js/engine/furniture/index.js');
const M = await import(SITE + '/js/engine/materials.js');
const LIB = Object.fromEntries(['high', 'medium', 'low'].map((q) => [q, M.createMaterials(null, { quality: q })]));
// the worker's stand-in library (no textures): what prebuildItems builds with
const descs = new Map();
const stub = { resolve: M.resolveMaterialKey, get(key, opts) { const canon = M.resolveMaterialKey(key); const id = canon + '|' + JSON.stringify(opts || {}); let m = descs.get(id); if (!m) { m = { isMaterial: true, uuid: 'wm' + descs.size, name: canon, userData: { materialKey: canon } }; descs.set(id, m); } return m; } };

function uvProblems(g) {
  const out = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!((m.anisotropy || 0) > 0 || m.normalMap || m.clearcoatNormalMap)) return;
    const geo = o.geometry, uv = geo.attributes.uv, P = geo.attributes.position;
    if (!uv) { out.push(`${o.name}: no uv`); return; }
    const ix = geo.index ? geo.index.array : null, n = ix ? ix.length / 3 : P.count / 3;
    let bad = 0, tot = 0;
    for (let t = 0; t < n; t++) {
      const a = ix ? ix[t * 3] : t * 3, b = ix ? ix[t * 3 + 1] : t * 3 + 1, c = ix ? ix[t * 3 + 2] : t * 3 + 2;
      const p = [P.getX(b) - P.getX(a), P.getY(b) - P.getY(a), P.getZ(b) - P.getZ(a)], q = [P.getX(c) - P.getX(a), P.getY(c) - P.getY(a), P.getZ(c) - P.getZ(a)];
      const area = Math.hypot(p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]);
      if (area < 1e-10) continue;
      const ua = Math.abs((uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a)));
      tot += area; if (!(ua > area * 1e-4)) bad += area;
    }
    if (tot > 0 && bad / tot > 0.001) out.push(`${o.name}: ${(100 * bad / tot).toFixed(1)}% zero-area uv`);
  });
  return out;
}
function check(item, q, host) {
  const errs = [];
  const oe = console.error, od = console.debug; console.error = (...x) => errs.push(x.map(String).join(' ')); console.debug = () => {};
  let bad = '', g = null;
  try { g = F.buildItem(item, { materials: stub, quality: q, host }); } catch (e) { errs.push('THROW ' + e.message); }
  console.error = oe;
  if (errs.length) bad = errs[0];
  if (g && !bad) {
    const bb = new THREE.Box3().setFromObject(g);
    if (!isFinite(bb.min.x + bb.max.y + bb.max.z)) bad = 'non-finite bbox';
    g.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.array.some((v) => !isFinite(v))) bad = 'NaN vertex'; });
    const u = g.userData;
    if (!u.pivot || u.pivot.some((v) => !isFinite(v)) || !u.front || Math.abs(Math.hypot(...u.front) - 1) > 1e-6) bad = bad || 'bad pivot/front';
  }
  if (!bad) {
    console.error = () => {};
    try { const g2 = F.buildItem(item, { materials: LIB[q], quality: q, host }); const pr = uvProblems(g2); if (pr.length) bad = 'UV ' + pr.join(' | '); } catch { /* canvas-only textures (rug patterns, art) need a browser */ }
    console.error = oe;
  }
  console.debug = od;
  return { bad, tris: g ? g.userData.triangles : 0 };
}
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[(rnd() * a.length) | 0];
const junk = [undefined, null, '', 'unknown', 0, -1, 3, 'walnut', 'black', 'brass', 'oak', 'velvet', 'leather', 'round', 'oval', 'rect', 'tripod', 'hairpin', 'pedestal', 'plinth', 'none', true, false, ['#ff0000'], '#B5653F', 'drum', 'cutout', 'fluted', 'cane', 'swing-arm', 'column', 'paint', 'travertine', 'x.jpg'];
const keys = ['seats', 'arm', 'legs', 'fabric', 'fabricColor', 'wood', 'shape', 'top', 'legMaterial', 'doors', 'drawers', 'handles', 'front', 'fronts', 'headboard', 'frame', 'base', 'shade', 'shadeColor', 'drop', 'pattern', 'material', 'color', 'panels', 'sheer', 'motif', 'colors', 'species', 'pot', 'items', 'count', 'style', 'back', 'seat', 'chaise', 'pillows', 'thickness', 'baseShape', 'fluted', 'open', 'stem', 'pedestalStyle', 'topMaterial', 'mount', 'armPanel', 'piping', 'image', 'edition', 'frameColor'];
let fails = 0, n = 0;
const fail = (s) => { fails++; if (fails <= 30) console.log('FAIL ' + s); };
for (const q of ['high', 'medium', 'low']) for (const a of F.ARCHETYPES) for (let t = 0; t < 12; t++) {
  const params = {};
  if (t > 0) for (let k = 0; k < 8; k++) params[pick(keys)] = pick(junk);
  const dims = t === 1 ? {} : t === 2 ? { w: 10, d: 10, h: 10 } : t === 3 ? { w: 400, d: 300, h: 300 } : { w: 40 + rnd() * 200, d: 30 + rnd() * 150, h: 20 + rnd() * 180 };
  const item = { id: `fz-${a}-${t}`, type: a, dims, colorHex: '#c8b8a0', model: { archetype: a, params } };
  n++;
  const r = check(item, q, t % 3 === 0 ? { w: 0.5, d: 0.4, h: 0.2 } : null);
  if (r.bad) fail(`${q} ${a} ${JSON.stringify(params)} ${JSON.stringify(dims)} → ${r.bad.slice(0, 240)}`);
}
const cat = JSON.parse(readFileSync(SITE + '/data/catalog.json', 'utf8'));
const items = cat.items || cat;
const maxT = {};
for (const q of ['high', 'medium', 'low']) for (const it of items) {
  n++;
  const host = it.type === 'bedding' ? { w: 1.6, d: 2.0, h: 0.25 } : it.type === 'cushions' ? { w: 1.9 } : null;
  const r = check(it, q, host);
  if (r.bad) fail(`${q} ${it.id} → ${r.bad.slice(0, 240)}`);
  if (!maxT[q] || r.tris > maxT[q][0]) maxT[q] = [r.tris, it.id];
}
console.log(`FUZZ ${n} builds (${items.length} catalogue items × 3 tiers + junk params), ${fails} failures; max catalogue triangles ` + Object.entries(maxT).map(([q, [t, id]]) => `${q} ${t} (${id})`).join(', '));
process.exit(fails ? 1 : 0);
