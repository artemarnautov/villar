// Digital twins (docs/TWINS.md pipeline A; contract: docs/requests/photo.md "From twins"). Owner: photo.
// Two queue job kinds, run by api/photo.js (?run=1), one step per call:
//   views — the turnaround: the item's product photos → front / left / back / right (/ three_quarter) images of the
//           product alone on white, one view per step, stored at twins/<itemId>/<view>.jpg
//   twin  — the reconstruction: the stored views → a 3D model at the provider → the GLB is streamed into Storage
//           (twins/<itemId>/<model>-s<seed>.glb), checked, and optionally copied to models/<itemId>[.lite].glb
// Facts (27 Nov 2026, this account, free /estimate): `tripo3d/h3.1/multiview-to-3d` takes `image_urls`;
// `hunyuan3d/v3/image-to-3d` requires `image_url`. The public docs carry no 3D schemas and do not say which field of
// the finished status holds the file, so: options are sent as the catalogue names them and dropped when the free
// estimate rejects them (result.optionsDropped); the GLB is found by scanning the status for URLs (result.outputKeys).
// Files starting with "_" are not routed by Vercel.
import INDEX from './_catalog.js';
import REFS from './_refs.js';
import {
  env, GatewayError, pickModels, bestSize, usableProviders, tryModels, dryRun, maxUsd, costOf, modelConfig, resumeImage, authToken, attemptOf,
  hfEstimate, hfSubmit, hfStatus, hfOutputs, liveConfig,
} from './_photo.js';
import { toStorableJpeg } from './_img.js';

const ITEM_RE = /^[a-z0-9-]{3,60}$/;
const VIEWS = ['front', 'left', 'back', 'right', 'three_quarter'];
const items = new Map((INDEX.catalog?.items || []).map((it) => [it.id, it]));
const deadlineMs = () => Math.max(5000, Number(env('PHOTO_DEADLINE_MS')) || 55_000);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const viewKey = (id, view, seed) => `twinview:${id}:${view.replace('_', '-')}:s${seed}`;
const viewPath = (id, view) => `twins/${id}/${view}.jpg`;

// ---------------------------------------------------------------------------------------------- views (prompt tv1)
const VIEW_BLOCKS = {
  front: 'View: FRONT. The camera faces the front of the product squarely, at 0°. A straight front elevation.',
  left: "View: LEFT SIDE. A straight side elevation of the product's own left side — the side that is at the RIGHT edge of the front view. The front of the product points to the LEFT edge of this image.",
  back: 'View: BACK. A straight rear elevation, the camera exactly opposite the front view. If the photos do not show the back, keep it conservative: the same material and colour continued plainly, the same outline as the front mirrored, a simple flat upholstered or panelled back with no added buttons, pockets, zips, labels, patterns or openings.',
  right: "View: RIGHT SIDE. A straight side elevation of the product's own right side — the side that is at the LEFT edge of the front view. The front of the product points to the RIGHT edge of this image.",
  three_quarter: "View: THREE-QUARTER. The camera is 35° round to the product's left of the front and 15° above the horizon, 85 mm lens, mild natural perspective. Same white background and shadowless light.",
};
export function turnaroundPrompt(item, material, view) {
  const d = item.dims || {};
  const w = Math.round(d.w || 0), dd = Math.round(d.round ? d.w : d.d || 0), h = Math.round(d.h || 0);
  const heightPct = Math.round((80 * h) / Math.max(w, dd, h, 1));
  const floorPct = Math.round((100 - heightPct) / 2);
  const common = [
    `Product reference sheet image of the exact product in the reference photos: ${item.nameEn || item.name} — ${material}.`,
    `Real size: ${w} cm wide, ${dd} cm deep, ${h} cm high.`,
    'Show only this one product, alone, complete and uncropped, centred, on a pure white (#FFFFFF) seamless background.',
    "Orthographic-like view: a long telephoto lens from far away, the camera level at the height of the product's middle, no perspective convergence, vertical lines vertical.",
    'Even, shadowless studio light from all sides: no cast shadow, no contact shadow, no floor reflection, no gradient, no vignette.',
    'Keep the product exactly as in the photos: the same proportions, silhouette, colours, materials, seams, cushions, legs and hardware. Invent nothing the photos do not show and add no accessories.',
    'Remove everything that is not part of the product as sold: scatter cushions, throws, books, plants, rugs, lamps, props, people, walls, floor, text, logos, labels, watermarks, dimension lines.',
    `Scale: the product's height spans exactly ${heightPct} % of the image height and it stands on a horizontal line ${floorPct} % above the bottom edge. This is the same in every image of the set.`,
  ].join('\n');
  const first = view === 'front' ? '' : 'Image 1 is the approved FRONT view of this set: match its scale, colours, materials and every detail exactly. The other images are the product photos.\n';
  return `${first}${common}\n${VIEW_BLOCKS[view]}`;
}

/** One step of a `views` job. */
export async function runViewsJob(db, job, { req, t0, trace }) {
  const p = job.params || {};
  const id = typeof p.itemId === 'string' && ITEM_RE.test(p.itemId) ? p.itemId : null;
  const item = id && items.get(id);
  if (!item) throw new GatewayError('rejected', 'views: params.itemId is not a catalogue item');
  if ((p.prompt || 'tv1') !== 'tv1') throw new GatewayError('rejected', `views: unknown prompt version ${clean(p.prompt, 12)}`);
  const pool = REFS.gallery?.[id] || REFS.refs?.[id] || [];
  const picks = (Array.isArray(p.refs) && p.refs.length ? p.refs : [1]).filter((n) => Number.isInteger(n) && n >= 1 && n <= 8).slice(0, 6);
  const photos = [...new Set(picks.map((n) => pool[n - 1]).filter(Boolean))];
  if (!photos.length && pool[0]) photos.push(pool[0]);
  if (!photos.length) throw new GatewayError('rejected', `views: no product photo for ${id}`);
  const material = clean(p.material, 240) || [item.colorEn, ...(item.materialsEn || [])].filter(Boolean).join(', ').toLowerCase();
  let views = (Array.isArray(p.views) && p.views.length ? p.views : VIEWS.slice(0, 4)).filter((v) => VIEWS.includes(v));
  views = ['front', ...new Set(views.filter((v) => v !== 'front'))];
  const want = p.resolution === '2K' ? '2K' : '1K';
  const seed = Number.isInteger(p.seed) ? p.seed : 1;
  const limit = Number.isFinite(Number(p.maxUsd)) && Number(p.maxUsd) > 0 ? Math.min(5, Number(p.maxUsd)) : maxUsd(false);
  const models = pickModels('default', usableProviders(req), p.model).filter((m) => !m.t2iOnly && (!m.aspects || m.aspects.includes('1:1')));
  if (!models.length) throw new GatewayError('unavailable', `views: ${p.model ? `model ${p.model} is not available` : 'no model available'}`);
  const frontUrl = db.publicUrl(viewPath(id, 'front'));
  const optsFor = (view, i) => (model, n) => (n > 0 ? null : {
    auth: authToken(req), prompt: turnaroundPrompt(item, material, view),
    images: [...(view === 'front' ? [] : [{ url: frontUrl }]), ...photos.map((url) => ({ url }))],
    aspectRatio: '1:1', imageSize: bestSize(model, want), deadlineAt: t0 + deadlineMs() - 6000, timeoutMs: 45_000,
    idempotencyKey: `${viewKey(id, view, seed)}-${job.id}`.slice(0, 64), seed: seed * 10 + i, maxCost: limit,
  });
  if (p.dry === true) {
    const estimates = await dryRun(models, optsFor('front', 0));
    const first = estimates.find((e) => Number.isFinite(e.usd));
    return { done: true, result: { dry: true, itemId: id, views, photos: photos.length, estimates, totalUsd: first ? +(first.usd * views.length).toFixed(4) : null }, cost: 0 };
  }
  const keys = views.map((v) => viewKey(id, v, seed));
  const rows = new Map((await db.rows(keys)).map((r) => [r.key, r]));
  const store = async (view, key, model, bytes, ms, requestId, estimate) => {
    const img = toStorableJpeg(bytes, { maxEdge: want === '2K' ? 2048 : 1440, quality: 90 });
    await db.put(viewPath(id, view), img.bytes, img.type, { upsert: true, maxAge: 3600 });
    const hasEst = Number.isFinite(estimate) && estimate > 0;
    const usd = hasEst ? estimate : costOf(model, bestSize(model, want));
    await db.upsertRow({ key, path: viewPath(id, view), kind: 'twin-view', source: 'preset', status: 'ok', model: model.id, provider: model.provider, request_id: requestId, prompt_version: 'tv1', size: bestSize(model, want), aspect: '1:1', width: img.width || null, height: img.height || null, bytes: img.bytes.length, ms, cost_usd: usd, refs: photos.length, updated_at: new Date().toISOString() });
    console.info(JSON.stringify({ ev: 'twin.view', itemId: id, view, model: model.id, usd, est: !hasEst, ms }));
  };
  for (let i = 0; i < views.length; i++) {
    const view = views[i], key = keys[i], r = rows.get(key);
    if (r?.status === 'ok') continue;                         // this seed's view exists: a re-run costs nothing
    if (r?.status === 'pending' && r.request_id) {
      const model = modelConfig(r.model);
      const out = await resumeImage(model, r.request_id);
      if (out.pending) return { pending: true, result: { view, request_id: r.request_id, model: r.model } };
      await store(view, key, model, out.bytes, Date.now() - Date.parse(r.updated_at || Date.now()), r.request_id, r.cost_usd == null ? NaN : Number(r.cost_usd));
      continue;
    }
    const t1 = Date.now();
    const { model, out } = await tryModels(models, optsFor(view, i), { trace, deadlineAt: t0 + deadlineMs() });
    if (out.pending) {
      await db.upsertRow({ key, path: null, kind: 'twin-view', source: 'preset', status: 'pending', model: model.id, provider: model.provider, request_id: out.pending.requestId, prompt_version: 'tv1', size: bestSize(model, want), aspect: '1:1', cost_usd: Number.isFinite(out.pending.estimate) ? out.pending.estimate : null, updated_at: new Date().toISOString() });
      return { pending: true, result: { view, request_id: out.pending.requestId, model: model.id, estimate: out.pending.estimate ?? null } };
    }
    await store(view, key, model, out.bytes, Date.now() - t1, out.requestId || null, out.estimate);
    // one view per step: the next call makes the next one (the front view must exist before the others start)
    if (i < views.length - 1) return { pending: true, result: { view, stored: true } };
  }
  const all = new Map((await db.rows(keys)).map((r) => [r.key, r]));
  const made = views.map((v, i) => { const r = all.get(keys[i]); return { view: v, model: r?.model || null, usd: r?.cost_usd == null ? null : Number(r.cost_usd), request_id: r?.request_id || null }; });
  return {
    done: true, cost: +made.reduce((a, m) => a + (m.usd || 0), 0).toFixed(4),
    result: { itemId: id, views: Object.fromEntries(views.map((v) => [v, db.publicUrl(viewPath(id, v))])), model: made[0]?.model || null, prompt: 'tv1', made },
  };
}

// ---------------------------------------------------------------------------------------------- twin (3D)
// path: the REST endpoint ('' = unknown for this account: set photo_config row `models`, e.g.
// {"meshy_v7_image_to_3d":{"path":"…","images":"image_url"}}); images: the input field; single: one URL, not a list.
export const TWIN_MODELS = {
  tripo_h3_1_multiview_to_3d: {
    path: 'tripo3d/h3.1/multiview-to-3d', images: 'image_urls', single: false, order: ['front', 'left', 'back', 'right'], min: 2, max: 4,
    defaults: { face_limit: 40000, texture: true, pbr: true, texture_quality: 'detailed', geometry_quality: 'detailed', texture_alignment: 'original_image', auto_size: false, orientation: 'default', quad: false },
    allow: ['face_limit', 'texture', 'pbr', 'texture_quality', 'geometry_quality', 'texture_alignment', 'auto_size', 'orientation', 'quad', 'texture_seed'], seedField: 'texture_seed',
  },
  hunyuan3d_v3_image_to_3d: {
    path: 'hunyuan3d/v3/image-to-3d', images: 'image_url', single: true, order: ['front', 'back', 'left', 'right'], min: 1, max: 4,
    defaults: { enable_pbr: true, face_count: 60000, generate_type: 'Normal', polygon_type: 'triangle' },
    allow: ['enable_pbr', 'face_count', 'generate_type', 'polygon_type'], seedField: null,
  },
  meshy_v7_image_to_3d: {
    path: '', images: 'image_url', single: true, order: ['three_quarter'], min: 1, max: 1,
    defaults: { model_type: 'standard', topology: 'triangle', target_polycount: 40000, symmetry_mode: 'auto', should_remesh: true, should_texture: true, enable_pbr: true, ultra_mode: true, enable_safety_checker: true },
    allow: ['model_type', 'topology', 'target_polycount', 'symmetry_mode', 'should_remesh', 'should_texture', 'enable_pbr', 'ultra_mode', 'enable_safety_checker'], seedField: null,
  },
  tripo_p2_image_to_3d: {
    path: '', images: 'image_url', single: true, order: ['three_quarter'], min: 1, max: 1,
    defaults: { face_limit: 40000, texture: true, pbr: true, texture_quality: 'detailed', delight: true, auto_size: false, export_uv: true, quad: false },
    allow: ['face_limit', 'texture', 'pbr', 'texture_quality', 'delight', 'auto_size', 'export_uv', 'quad', 'seed', 'texture_seed'], seedField: 'seed',
  },
};
function twinModel(name) {
  const base = TWIN_MODELS[name];
  if (!base) return null;
  const o = liveConfig().models?.[name] || {};
  let fromEnv = {}; try { fromEnv = JSON.parse(env('HIGGSFIELD_MODELS') || '{}')[name] || {}; } catch { /* ignore */ }
  const pick = (k, re) => (typeof o[k] === 'string' && re.test(o[k]) ? o[k] : typeof fromEnv[k] === 'string' && re.test(fromEnv[k]) ? fromEnv[k] : base[k]);
  const images = pick('images', /^[a-z_]{3,40}$/);
  return { ...base, name, id: `higgsfield:${name}`, path: pick('path', /^[a-zA-Z0-9._/-]{3,120}$/), images, single: 'single' in o ? !!o.single : images === base.images ? base.single : !/s$/.test(images) };
}

const BAD_EXT = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];
/** Check a GLB's header + JSON chunk (the first bytes of the file). Returns { faces, images, generator, jsonEnd }. */
export function inspectGlb(head, totalBytes = null) {
  if (head.length < 20 || head.toString('ascii', 0, 4) !== 'glTF') throw new GatewayError('rejected', 'not a GLB (no glTF magic)');
  if (head.readUInt32LE(4) !== 2) throw new GatewayError('rejected', `GLB version ${head.readUInt32LE(4)} (need 2)`);
  const length = head.readUInt32LE(8), jsonLen = head.readUInt32LE(12);
  if (head.readUInt32LE(16) !== 0x4e4f534a) throw new GatewayError('rejected', 'GLB: the first chunk is not JSON');
  if (totalBytes != null && length !== totalBytes) throw new GatewayError('rejected', `GLB length ${length} ≠ file size ${totalBytes}`);
  if (head.length < 20 + jsonLen) return { need: 20 + jsonLen };
  let g; try { g = JSON.parse(head.toString('utf8', 20, 20 + jsonLen)); } catch { throw new GatewayError('rejected', 'GLB: JSON chunk does not parse'); }
  const ext = [...(g.extensionsUsed || []), ...(g.extensionsRequired || [])].find((e) => BAD_EXT.includes(e));
  if (ext) throw new GatewayError('rejected', `GLB uses ${ext} (no decoder on the site)`);
  if ([...(g.buffers || []), ...(g.images || [])].some((x) => typeof x.uri === 'string' && !x.uri.startsWith('data:'))) throw new GatewayError('rejected', 'GLB references external files');
  if ((g.skins || []).length) throw new GatewayError('rejected', 'GLB has skins');
  let faces = 0;
  for (const m of g.meshes || []) for (const pr of m.primitives || []) {
    if (pr.mode != null && pr.mode !== 4) continue;
    const acc = g.accessors?.[pr.indices ?? pr.attributes?.POSITION];
    faces += Math.floor((acc?.count || 0) / 3);
  }
  return { faces, images: (g.images || []).length, generator: clean(g.asset?.generator, 80) || null, length, jsonEnd: 20 + jsonLen };
}

const MAX_GLB = 48 * 1024 * 1024;
/**
 * Stream a finished GLB from the provider into Storage without holding it in memory: the first bytes (header + JSON
 * chunk) are read and checked, then the same bytes and the rest of the body go to Storage as one streamed upload.
 */
export async function streamGlb(db, url, path) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 50_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok || !r.body) throw new GatewayError('gateway', `GLB download HTTP ${r.status}`);
    const declared = Number(r.headers.get('content-length')) || null;
    if (declared && declared > MAX_GLB) throw new GatewayError('rejected', `GLB is ${(declared / 1048576).toFixed(1)} MB (limit 48 MB)`);
    const reader = r.body.getReader();
    const first = []; let have = 0, info = { need: 20 };
    while (info.need && have < info.need) {
      const { done, value } = await reader.read();
      if (done) break;
      first.push(Buffer.from(value)); have += value.length;
      if (have >= info.need) info = inspectGlb(Buffer.concat(first), declared);
      if (info.need && info.need > 8 * 1024 * 1024) throw new GatewayError('rejected', 'GLB: JSON chunk over 8 MB');
    }
    if (info.need) throw new GatewayError('rejected', 'not a GLB (file shorter than its header says)');
    if (info.length > MAX_GLB) throw new GatewayError('rejected', `GLB is ${(info.length / 1048576).toFixed(1)} MB (limit 48 MB)`);
    let bytes = 0;
    const body = new ReadableStream({
      start(c) { for (const b of first) { bytes += b.length; c.enqueue(new Uint8Array(b)); } },
      async pull(c) {
        const { done, value } = await reader.read();
        if (done) { c.close(); return; }
        bytes += value.length;
        if (bytes > MAX_GLB) { c.error(new GatewayError('rejected', 'GLB over 48 MB')); return; }
        c.enqueue(value);
      },
      cancel() { reader.cancel().catch(() => {}); },
    });
    await db.putStream(path, body, 'model/gltf-binary', { upsert: true, maxAge: 3600 });
    if (bytes !== info.length) { await db.remove([path]).catch(() => {}); throw new GatewayError('rejected', `GLB length ${info.length} ≠ received ${bytes}`); }
    return { ...info, bytes };
  } finally { clearTimeout(timer); }
}

/** One step of a `twin` job. */
export async function runTwinJob(db, job, { t0, trace }) {
  const p = job.params || {};
  const id = typeof p.itemId === 'string' && ITEM_RE.test(p.itemId) ? p.itemId : null;
  if (!id || !items.has(id)) throw new GatewayError('rejected', 'twin: params.itemId is not a catalogue item');
  const tm = twinModel(String(p.model || 'tripo_h3_1_multiview_to_3d'));
  if (!tm) throw new GatewayError('rejected', `twin: unknown model ${clean(p.model, 40)}`);
  if ((p.prompt || 'tv1') !== 'tv1') throw new GatewayError('rejected', 'twin: unknown turnaround version');
  const as = ['candidate', 'model', 'lite'].includes(p.as) ? p.as : 'candidate';
  const seed = Number.isInteger(p.seed) ? p.seed : 1;
  let views = (Array.isArray(p.views) && p.views.length ? p.views : tm.order).filter((v) => VIEWS.includes(v)).slice(0, tm.max);
  if (p.swapLR === true) views = views.map((v) => (v === 'left' ? 'right' : v === 'right' ? 'left' : v));
  if (views.length < tm.min) throw new GatewayError('rejected', `twin: ${tm.name} needs ${tm.min}–${tm.max} views`);
  const model = { id: tm.id, provider: 'higgsfield' };
  const glbPath = `twins/${id}/${tm.name}-s${seed}.glb`;
  const finish = async (st, requestId, usd, ms) => {
    const outs = hfOutputs(st);
    const glb = outs.find((o) => /\.glb($|\?)/i.test(o.url)) || outs.find((o) => /glb|gltf|model|mesh/i.test(o.key) && !/\.(png|jpe?g|webp|mp4|zip|fbx|ply|obj|usdz)($|\?)/i.test(o.url));
    const outputKeys = outs.map((o) => o.key);                 // key names only: where this model puts its files
    if (!glb) { const e = new GatewayError('rejected', `twin: no GLB among the outputs (keys: ${outputKeys.join(', ') || 'none'})`); e.detail = `no GLB; output keys: ${outputKeys.join(', ')}`.slice(0, 200); throw e; }
    const info = await streamGlb(db, glb.url, glbPath);
    let copiedTo = null;
    if (as !== 'candidate') { copiedTo = as === 'lite' ? `models/${id}.lite.glb` : `models/${id}.glb`; await db.copy(glbPath, copiedTo); }
    const cost = Number.isFinite(usd) && usd > 0 ? usd : costOf(modelConfig(tm.id), '3d') || null;
    await db.upsertRow({ key: `twin:${id}:${tm.name.replace(/_/g, '-')}:s${seed}`, path: glbPath, kind: 'twin', source: 'preset', status: 'ok', model: tm.id, provider: 'higgsfield', request_id: requestId, prompt_version: 'tv1', bytes: info.bytes, ms, cost_usd: cost, refs: views.length, updated_at: new Date().toISOString() }).catch((e) => console.warn(`[twin] index write failed: ${e.message}`));
    console.info(JSON.stringify({ ev: 'twin.gen', itemId: id, model: tm.name, faces: info.faces, bytes: info.bytes, usd: cost, est: !(Number.isFinite(usd) && usd > 0), ms }));
    return { done: true, cost, result: { itemId: id, model: tm.name, glb: glbPath, url: db.publicUrl(glbPath), as, copiedTo, faces: info.faces, bytes: info.bytes, images: info.images, generator: info.generator, request_id: requestId, usd: cost, outputKey: glb.key, outputKeys, ms } };
  };
  // a provider job submitted by an earlier step
  if (job.result?.request_id && !p.dry) {
    const st = await hfStatus(job.result.request_id);
    if (st?.status === 'completed') return finish(st, job.result.request_id, Number(job.result.estimate), Date.now() - Date.parse(job.started_at || Date.now()));
    if (st?.status === 'failed' || st?.status === 'nsfw' || st?.status === 'canceled') { const e = new GatewayError('gateway', `twin: the provider job ${st.status}${st.error ? `: ${clean(st.error, 160)}` : ''}`, 0, 'higgsfield'); trace.push(attemptOf(model, e)); throw e; }
    return { pending: true, result: { request_id: job.result.request_id, status: st?.status || null } };
  }
  if (!tm.path) throw new GatewayError('no_model', `twin: the endpoint path of ${tm.name} is not known for this account — set photo_config row models = {"${tm.name}":{"path":"…","images":"image_urls"}}`, 0, 'higgsfield');
  // waits for its views (never generates them)
  const missing = [];
  for (const v of views) if (!(await db.exists(viewPath(id, v)))) missing.push(v);
  if (missing.length && !p.dry) return { pending: true, result: { waiting: 'views', missing } };
  const urls = views.map((v) => db.publicUrl(viewPath(id, v)));
  const inputs = { [tm.images]: tm.single ? urls[0] : urls };
  const opts = { ...tm.defaults };
  for (const [k, v] of Object.entries(p.options && typeof p.options === 'object' ? p.options : {})) if (tm.allow.includes(k) && ['string', 'number', 'boolean'].includes(typeof v)) opts[k] = v;
  if (as === 'lite' && 'face_limit' in opts && !(p.options && 'face_limit' in p.options)) opts.face_limit = 20000;
  if (tm.seedField) opts[tm.seedField] = seed;
  // free estimate with the real body; when the options are refused (unknown field names), once more with the inputs only
  let body = { ...inputs, ...opts }, usd, optionsDropped = false;
  try { usd = await hfEstimate(tm.path, body, tm.id); }
  catch (err) {
    trace.push(attemptOf(model, err));
    if (!(err instanceof GatewayError && err.code === 'rejected')) throw err;
    body = { ...inputs }; optionsDropped = true;
    usd = await hfEstimate(tm.path, body, tm.id).catch((e2) => { trace.push(attemptOf(model, e2)); throw e2; });
  }
  if (p.dry === true) return { done: true, cost: 0, result: { dry: true, itemId: id, model: tm.name, path: tm.path, usd, optionsDropped, fields: Object.keys(body), ...(missing.length ? { missingViews: missing } : {}) } };
  const limit = Number.isFinite(Number(p.maxUsd)) && Number(p.maxUsd) > 0 ? Math.min(10, Number(p.maxUsd)) : maxUsd(false);
  if (usd > limit) { const e = new GatewayError('too_expensive', `twin: estimate $${usd} is over the limit $${limit} (set params.maxUsd)`, 0, 'higgsfield'); trace.push(attemptOf(model, e)); throw e; }
  const requestId = await hfSubmit(tm.path, body, { model: tm.id, idempotencyKey: `twin-${id}-${tm.name}-s${seed}-${job.id}`.slice(0, 64) }).catch((e) => { trace.push(attemptOf(model, e)); throw e; });
  // 3D jobs run for minutes: look once after a short wait, then let the queue come back (20 s lease)
  await new Promise((r) => setTimeout(r, Math.min(4000, Math.max(0, deadlineMs() - (Date.now() - t0) - 20_000))));
  const st = await hfStatus(requestId).catch(() => null);
  if (st?.status === 'completed') return finish(st, requestId, usd, Date.now() - t0);
  return { pending: true, result: { request_id: requestId, estimate: usd, model: tm.name, optionsDropped, status: st?.status || 'queued' } };
}
