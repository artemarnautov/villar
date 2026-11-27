// Digital twins (docs/TWINS.md, pipeline A): the paid generations as rows for the admin job queue (public.photo_jobs).
// Owner: twins. Nothing here calls a model or the network: the coordinator inserts the rows (the Supabase connector is
// the authorization), then `GET https://<site>/api/photo?run=1` runs one step per call. Job kinds `views` and `twin`
// are specified in docs/requests/photo.md ("From twins").
//
//   node tools/twins-jobs.mjs                       dry run: the plan and its cost table (default)
//   node tools/twins-jobs.mjs --pilot               only the pilot (wave 1: sofa, armchair, floor lamp of Dark Walnut's
//                                                   signature room), each reconstructed with both available models (A/B, TWINS §2.3)
//   node tools/twins-jobs.mjs --wave 2              only that wave (1 pilot · 2 signature rooms · 3 the other kind A)
//   node tools/twins-jobs.mjs --sql views [--pilot] SQL: the 4-view turnarounds (review them before paying for 3D)
//   node tools/twins-jobs.mjs --sql twin  [--pilot] SQL: the reconstructions (run after the views are approved)
//   node tools/twins-jobs.mjs --sql all   [--pilot] SQL: both, in order (a `twin` job waits for its views)
//   node tools/twins-jobs.mjs --only <id>[,<id>…]   restrict to these catalogue items
//   node tools/twins-jobs.mjs --models tripo_h3_1_multiview_to_3d[,…]   override the 3D models of every item
//   node tools/twins-jobs.mjs --views-model qwen    turnaround with Qwen Image 3 (3 references, has a seed) instead of
//                                                   Grok Image 2.0 (10 references, no seed; the default)
//   node tools/twins-jobs.mjs --lite                also queue the 20k-face variant for the low tier (models/<id>.lite.glb)
//   node tools/twins-jobs.mjs --seed 2              second attempt after a failed QA (TWINS §4: once, new seed / model)
//   node tools/twins-jobs.mjs --poor                include items the curator marked `poor` (photos too thin; off by default)
//
// Input: tools/twins.json — the curator's file (its `_readme` is the reference). Fields read here:
//   id        catalogue id
//   kind      "A" = reconstructed GLB (queued here) · "B" = exact-material procedural (never queued; tools/twins-b.md)
//   wave      1 pilot · 2 signature rooms · 3 other kind A · 4 kind B
//   refs      which of the item's product photos to use, 1-based positions in the item's photo list (the server's
//             gallery, same order as research catalogItems[].photos), front first; up to 8 of positions 1–24
//   shows     what each ref shows, parallel to refs (becomes the caption of that reference image; a ref whose
//             caption starts with "drawing" is the supplier's dimensioned drawing → the side views are taken from it)
//   material  one line in words
//   models    optional 3D models for this item; asymmetric: no symmetry assumption (chaise sofa, swing-arm lamp)
//   skip / hold  listed, not queued · poor  queued only with --poor
// The file carries no supplier name or URL: the job resolves `refs` on the server.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8'));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (flag(n) && argv[argv.indexOf(`--${n}`) + 1] && !argv[argv.indexOf(`--${n}`) + 1].startsWith('--') ? argv[argv.indexOf(`--${n}`) + 1] : d);

// ------------------------------------------------------------------------------------------------- models (TWINS §2.3)
// Parameter names and ranges as listed in the Higgsfield model catalogue (27 Nov 2026). `views` = the order in which
// each model expects the turnaround images; single-image models get the three-quarter view. `rest` = the REST path
// on api.higgsfield.ai: confirmed on production for two of them (the provider's free /estimate, 27 Nov); `null` = no
// path known yet (the public API reference documents no 3D endpoint), so those jobs cannot run until one is found.
export const MODELS = {
  tripo_h3_1_multiview_to_3d: {
    label: 'Tripo H3.1 multiview', rest: 'tripo3d/h3.1/multiview-to-3d', views: ['front', 'left', 'back', 'right'],
    options: (o) => ({ face_limit: o.lite ? 20000 : 40000, texture: true, pbr: true, texture_quality: 'detailed', geometry_quality: 'detailed', texture_alignment: 'original_image', auto_size: false, orientation: 'default', quad: false, texture_seed: o.seed }),
  },
  hunyuan3d_v3_image_to_3d: {
    // REST takes one required `image_url`; the names of the extra view fields are not confirmed → `single` is what
    // the job sends when it has to fall back to one image
    label: 'Hunyuan3D v3', rest: 'hunyuan3d/v3/image-to-3d', views: ['front', 'back', 'left', 'right'], single: 'three_quarter', noLite: 'face_count has a 40 000 minimum',
    options: () => ({ enable_pbr: true, face_count: 60000, generate_type: 'Normal', polygon_type: 'triangle' }),
  },
  meshy_v7_image_to_3d: {
    label: 'Meshy 7', rest: null, views: ['three_quarter'],
    options: (o) => ({ model_type: 'standard', topology: 'triangle', target_polycount: o.lite ? 20000 : 40000, symmetry_mode: o.asymmetric ? 'off' : 'auto', should_remesh: true, should_texture: true, enable_pbr: true, ultra_mode: true, enable_safety_checker: true }),
  },
  tripo_p2_image_to_3d: {
    label: 'Tripo P2 (single image)', rest: null, views: ['three_quarter'],
    options: (o) => ({ face_limit: o.lite ? 20000 : 40000, texture: true, pbr: true, texture_quality: 'detailed', delight: true, auto_size: false, export_uv: true, quad: false, seed: o.seed, texture_seed: o.seed }),
  },
};
const DEFAULT_MODEL = 'tripo_h3_1_multiview_to_3d';
const PILOT_MODELS = ['tripo_h3_1_multiview_to_3d', 'hunyuan3d_v3_image_to_3d'];   // the two with a known REST path; add Meshy with --models once it has one
const PILOT_SLOTS = ['sofa', 'armchair', 'floor_lamp'];
const PILOT_STYLE = 'dark-walnut';

// Turnaround image models (Nano Banana is disabled on this account, 27 Nov). `usd` = the provider's own /estimate
// for the account, read on production by the coordinator.
export const VIEW_MODELS = {
  grok: { id: 'higgsfield:grok_image_2', label: 'Grok Image 2.0', maxRefs: 10, seed: false, usd: 0.07 },   // ids as in api/_photo.js MODELS
  qwen: { id: 'higgsfield:qwen_image_3', label: 'Qwen Image 3 (edit)', maxRefs: 3, seed: true, usd: 0.04 },
};
// USD per reconstruction. `null` = unknown: no API price is published for 3D and /estimate answered $0.000 for
// Tripo H3.1, so the first real job of each model measures it (TWINS §5).
export const PRICE = { tripo_h3_1_multiview_to_3d: null, hunyuan3d_v3_image_to_3d: null, meshy_v7_image_to_3d: null, tripo_p2_image_to_3d: null };

// ------------------------------------------------------------------------------------------------- input
const catalog = read('site/data/catalog.json');
const byId = new Map((catalog.items || catalog).map((it) => [it.id, it]));
const cfgPath = opt('in', 'tools/twins.json');
const cfg = existsSync(resolve(ROOT, cfgPath)) ? read(cfgPath) : { items: [] };
const promptVersion = /^tv\d{1,3}$/.test(cfg.promptVersion || '') ? cfg.promptVersion : 'tv1';
const seed = Math.max(1, Math.min(9999, Number(opt('seed', 1)) || 1));
const only = opt('only', null)?.split(',').filter(Boolean) || null;
const forced = opt('models', null)?.split(',').filter((m) => MODELS[m]) || null;
const pilot = flag('pilot');
const wave = flag('wave') ? Number(opt('wave', 0)) : null;
const VM = VIEW_MODELS[opt('views-model', 'grok')] || VIEW_MODELS.grok;

function pilotIds() {
  const w1 = (cfg.items || []).filter((x) => x.wave === 1).map((x) => x.id);   // the curator's pilot wave
  if (w1.length) return w1;
  const picks = read(`site/data/stylepack-${PILOT_STYLE}.json`).picks || {};
  return PILOT_SLOTS.map((s) => (picks[s] || [])[0]).filter(Boolean);   // the first pick of a slot is the signature item
}
const problems = [], skippedPoor = [], noRest = new Set();
function plan() {
  const wanted = pilot ? pilotIds() : null;
  const rows = [];
  const listed = new Map((cfg.items || []).map((x) => [x.id, x]));
  const ids = wanted || [...listed.keys()];
  for (const id of ids) {
    if (only && !only.includes(id)) continue;
    const x = listed.get(id), it = byId.get(id);
    if (!it) { problems.push(`${id}: not in site/data/catalog.json`); continue; }
    if (!x) { problems.push(`${id}: not in ${cfgPath} (the curator has to choose its photos and write the material line)`); continue; }
    if (x.kind === 'B' || x.skip || x.hold) { if (wanted || only) problems.push(`${id}: not queued (${x.kind === 'B' ? 'kind B: tools/twins-b.md' : x.hold ? 'on hold' : 'skip'})`); continue; }
    if (wave != null && !wanted && x.wave !== wave) continue;
    if (x.poor && !flag('poor')) { skippedPoor.push(id); continue; }
    const clean = (t, n) => (typeof t === 'string' ? t.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
    const pairs = (Array.isArray(x.refs) ? x.refs : []).map((n, i) => [n, clean((x.shows || [])[i], 90)]).filter(([n]) => Number.isInteger(n) && n >= 1 && n <= 24).slice(0, 8);
    const refs = pairs.map((q) => q[0]), shows = pairs.map((q) => q[1]);
    const drawing = shows.findIndex((t) => /^drawing\b/i.test(t)) + 1;      // 1-based position in refs; 0 = none
    const material = clean(x.material, 240);
    if (!refs.length) { problems.push(`${id}: no reference photos chosen (refs)`); continue; }
    if (refs.length < 3) problems.push(`${id}: only ${refs.length} reference photo(s) — TWINS §2.1 asks for 3–6 (front, three-quarter, side, back if any, detail); the unseen sides will be inferred`);
    if (material.length < 8) { problems.push(`${id}: no material line`); continue; }
    if (!it.dims?.w || !it.dims?.h) { problems.push(`${id}: no dims in the catalogue`); continue; }
    const models = (forced || (pilot ? PILOT_MODELS : Array.isArray(x.models) && x.models.length ? x.models : [DEFAULT_MODEL])).filter((m) => MODELS[m]);
    if (!models.length) { problems.push(`${id}: no known model`); continue; }
    rows.push({ id, item: it, refs, shows, drawing, material, models, asymmetric: !!x.asymmetric, wave: x.wave ?? null });
  }
  return rows;
}

const needsHero = (models) => models.some((m) => MODELS[m].views.includes('three_quarter') || MODELS[m].single === 'three_quarter');
function viewsJob(r) {
  // one image per step: front first, then the others with the stored front as their first reference
  const extra = needsHero(r.models) ? ['three_quarter'] : [];
  return { kind: 'views', params: { itemId: r.id, refs: r.refs, shows: r.shows, ...(r.drawing ? { drawing: r.drawing } : {}), material: r.material, prompt: promptVersion, views: ['front', 'left', 'back', 'right', ...extra], model: VM.id, resolution: '1K', seed } };
}
function twinJobs(r) {
  const out = [];
  r.models.forEach((model, i) => {
    const M = MODELS[model];
    const primary = i === 0;                                   // the first model is the one that becomes models/<id>.glb
    if (!M.rest) noRest.add(model);
    const base = { itemId: r.id, model, views: M.views, ...(M.single ? { single: M.single } : {}), prompt: promptVersion, seed };
    out.push({ kind: 'twin', params: { ...base, options: M.options({ seed, asymmetric: r.asymmetric }), as: primary && !pilot ? 'model' : 'candidate' } });
    if (flag('lite') && primary && !M.noLite) out.push({ kind: 'twin', params: { ...base, options: M.options({ seed, asymmetric: r.asymmetric, lite: true }), as: 'lite' } });
  });
  return out;
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
// explicit, increasing created_at: the queue claims the oldest runnable job, and rows of one insert share now()
const toSql = (rows) => `insert into public.photo_jobs (kind, params, created_at) values\n${rows.map((r, i) => `  (${sqlStr(r.kind)}, ${sqlStr(JSON.stringify(r.params))}::jsonb, now() + interval '${i} milliseconds')`).join(',\n')};`;

const rows = plan();
const which = opt('sql', null);
if (which) {
  if (!['views', 'twin', 'all'].includes(which)) { console.error('use --sql views | twin | all'); process.exit(2); }
  const jobs = [];
  for (const r of rows) {
    if (which !== 'twin') jobs.push(viewsJob(r));
    if (which !== 'views') jobs.push(...twinJobs(r));
  }
  if (problems.length) console.error(problems.map((p) => `-- note: ${p}`).join('\n'));
  if (noRest.size) console.error(`-- note: no REST path is known for ${[...noRest].join(', ')} (docs/requests/photo.md)`);
  if (!jobs.length) { console.error('nothing to emit: no kind-A item of tools/twins.json matches (see the header of this file)'); process.exit(2); }
  console.log(`-- ${jobs.length} job(s) for ${rows.length} item(s), prompt ${promptVersion}, seed ${seed}${pilot ? ' — PILOT (candidates only: nothing is copied to models/ until one is approved)' : ''}`);
  console.log('-- run them with GET /api/photo?run=1 (one step per call); kinds `views` and `twin`: docs/requests/photo.md "From twins"');
  console.log(toSql(jobs));
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------- dry run
const usd = (v) => (v == null ? 'unknown' : `$${v.toFixed(2)}`);
console.log(`Digital twins — planned paid generations (docs/TWINS.md §5)${pilot ? ' — PILOT' : wave != null ? ` — wave ${wave}` : ''}. Nothing is generated by this tool.\n`);
if (!rows.length) console.log(`No items planned. ${pilot ? `The pilot items are ${pilotIds().join(', ')}; ` : ''}check ${cfgPath}.\n`);
console.log('| Item | Wave | Photos | Drawing | Turnaround images | USD | Reconstructions | USD |');
console.log('|---|---|---|---|---|---|---|---|');
let images = 0, imageUsd = 0;
const per = Object.fromEntries(Object.keys(MODELS).map((m) => [m, 0]));
for (const r of rows) {
  const v = viewsJob(r).params.views.length, t = twinJobs(r);
  images += v; imageUsd += v * VM.usd;
  for (const j of t) per[j.params.model]++;
  console.log(`| ${r.id} | ${r.wave ?? ''} | ${r.refs.length} | ${r.drawing ? 'yes' : '—'} | ${v} | ${usd(v * VM.usd)} | ${t.map((j) => `${MODELS[j.params.model].label}${j.params.as === 'lite' ? ' (lite)' : ''}`).join(', ')} | unknown |`);
}
const recon = Object.values(per).reduce((a, b) => a + b, 0);
console.log(`| **Total: ${rows.length} item(s)** | | | | **${images}** | **${usd(imageUsd)}** | **${recon}** | **unknown** |`);
console.log('\n| Price line | Count | Each | Sum |\n|---|---|---|---|');
console.log(`| Turnaround view, ${VM.label} at 1K (the provider's estimate for this account) | ${images} | $${VM.usd.toFixed(2)} | ${usd(imageUsd)} |`);
for (const [m, n] of Object.entries(per)) if (n) console.log(`| ${MODELS[m].label} (\`${m}\`) | ${n} | ${usd(PRICE[m])} | ${PRICE[m] == null ? 'unknown' : usd(n * PRICE[m])} |`);
const unknown = Object.entries(per).filter(([m, n]) => n && PRICE[m] == null).length;
console.log(`\nKnown part: ${usd(imageUsd)}.${unknown ? ` Unknown part: ${recon} reconstruction(s) on ${unknown} model(s): no API price is published for 3D, and the provider's estimate returned $0.000 for Tripo H3.1.` : ''}`);
console.log('Measure it: read the Higgsfield balance before and after the FIRST reconstruction of each model, then put the numbers into PRICE here and PHOTO_COST on the server. Queue one model at a time until the three prices are known.');
if (noRest.size) console.log(`\nNo REST path is known for ${[...noRest].join(', ')}: those jobs fail with "no_model" until HIGGSFIELD_MODELS names one (docs/requests/photo.md).`);
if (skippedPoor.length) console.log(`\nNot planned (photos too thin, \`poor\`; add --poor to include): ${skippedPoor.join(', ')}`);
if (problems.length) console.log(`\nNotes:\n${problems.map((p) => `- ${p}`).join('\n')}`);
console.log('\nEmit SQL: --sql views (review the four views first) → --sql twin; or --sql all. Add --pilot for the three pilot items.');
