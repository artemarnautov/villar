// POST /api/photo — "Live → Photo": develops the resting 3D frame into a photograph with an image-edit model
// (Vercel AI Gateway), caches it in Supabase Storage, and serves the same view + selection from cache. Owner: photo.
//
// Providers: Higgsfield API first (async jobs), AI Gateway as the fallback — one ordered model list (api/_photo.js).
// Request (JSON, ≤ 2.6 MB):
//   { v: 1, op: 'lookup' | 'develop' | 'poll' | 'reject', session,
//     state: { style, time, selection: { key: itemId | null }, pose, aspect: '16:9', size: '1K' | '2K' },
//     items: [{ id, area }]               visible catalog items, ranked by screen area (develop)
//     frame: 'data:image/jpeg;base64,…'   the current frame, ≤ 2048 px long edge, ≤ 1.6 MB (develop)
//     key, score                          (reject) the client's structural check failed for this photo
//     key                                 (poll) a job that was still running when develop returned }
// Response (always JSON, HTTP 200 unless the request itself is malformed):
//   lookup  → { hit: true, url, key, model, ms } | { hit: false, key, pending? }
//   develop → { url, key, model, ms, cached? } | { pending: true, key, retryAfter }   (job still running: poll)
//   poll    → same as develop (also GET /api/photo?key=…)
//   reject  → { ok: true }
//   any     → { error: 'disabled' | 'unavailable' | 'rate_limited' | 'quota' | 'unstable' | 'timeout' | 'gateway' |
//                       'not_configured' | 'bad_request' | 'forbidden' | 'too_large' }
// GET → { ok, enabled, generate, models, prompt } (no secrets).  Webhook: api/photo-hook.js (Higgsfield → completePending).
//
// Cache key = sha256(key version, model id, prompt version, style, selection hash, pose, time of day, size, aspect).
// The selection hash is computed here from the validated selection (placed keys only), never taken from the client.
// Kill switch: env PHOTO_DISABLED=1 (everything off) or PHOTO_DISABLED=generate (cache hits only).
// Cost log: one JSON line per generation ({ ev:'photo.gen', model, usd, ms, … }) plus a row in photo_renders.
import INDEX from './_catalog.js';
import REFS from './_refs.js';
import { createSim } from '../site/js/ai/core.js';
import {
  env, PROMPT_VERSION, KEY_VERSION, modelList, modelConfig, pickModels, bestSize, pickAspect, usableProviders, providersAvailable, providerOff, resetBreakers,
  modelBreakers, tryModels, dryRun, attemptOf, maxUsd, abModel, costOf, header, clientIp, ipHash, sha256, send, sameOrigin, readJson, createLimiter,
  authToken, GatewayError, isFatalGateway, generateImage, resumeImage, supa, objectPath, STYLES_RE, TIMES, STYLE_WORDS, LIGHT_WORDS, GRADE_WORDS,
  hfProbe, loadConfig, liveConfig, mayGenerate, dailyCaps, resetConfigForTests, HF_BASE, hfAuth,
} from './_photo.js';
import { runPlateJob, runLoopJob } from './plate.js';
import { runViewsJob, runTwinJob } from './_twins.js';
import { fromDataUrl, jpegSize, toStorableJpeg, sniff } from './_img.js';

const sim = createSim(INDEX);
const MAX_BODY = 2.6 * 1024 * 1024;
const MAX_FRAME = 1.6 * 1024 * 1024;
const MAX_EDGE = 2048;
const deadlineMs = () => Math.max(5000, Number(env('PHOTO_DEADLINE_MS')) || 55_000); // vercel.json maxDuration 60
const SIZES = ['1K', '2K'];
const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '2:1', '1:2', '7:9', '9:7']; // the union of every model's list
const POSE_RE = /^[a-z0-9_:;,.|-]{8,220}$/i; // camera, plus the focused item's turn (o:slot_id:yaw)
const REF_LIMIT = () => Math.max(0, Math.min(10, Number(env('PHOTO_REFS') || 8)));
const DAILY_IP = () => dailyCaps().perIp;       // photo_config.caps → env → ART §1 defaults (12 / 60)
const DAILY_GLOBAL = () => dailyCaps().global;
const SESSION_RE = /^[a-z0-9]{8,40}$/i;
const UNSTABLE_REJECTS = 2;

// in-memory limits (per instance): lookups are cheap, generations are not
const lookupLimited = createLimiter([{ windowMs: 60_000, max: 60 }]);
const developLimitedIp = createLimiter([{ windowMs: 60_000, max: 4 }, { windowMs: 3_600_000, max: 30 }]);
const developLimitedSession = createLimiter([{ windowMs: 3_600_000, max: 20 }]);
const rejectLimited = createLimiter([{ windowMs: 3_600_000, max: 6 }]);
const diagLimited = createLimiter([{ windowMs: 3_600_000, max: 10 }]);
const inflight = new Map();             // key → Promise (two requests for the same photo share one generation)
const PENDING_STALE_MS = 15 * 60_000;   // a job not finished after this long is given up (and its quota refunded)
/** Providers with credentials and no open breaker (api/_photo.js: no balance / bad key → 10 min; per model → 1 h). */
const usable = (req) => usableProviders(req);

const killSwitch = () => {
  const v = env('PHOTO_DISABLED').toLowerCase();
  return v === 'generate' ? 'generate' : v && v !== '0' && v !== 'false' ? 'all' : null;
};

// ---------------------------------------------------------------------------------------------- validation
/** Returns { state } (normalised) or { error }. */
export function cleanState(s) {
  if (!s || typeof s !== 'object') return { error: 'bad_request' };
  const style = typeof s.style === 'string' && STYLES_RE.test(s.style) && sim.pack(s.style) ? s.style : null;
  if (!style) return { error: 'bad_request' };
  const time = TIMES.includes(s.time) ? s.time : null;
  if (!time) return { error: 'bad_request' };
  if (typeof s.pose !== 'string' || !POSE_RE.test(s.pose)) return { error: 'bad_request' };
  const aspect = ASPECTS.includes(s.aspect) ? s.aspect : null;
  if (!aspect) return { error: 'bad_request' };
  const size = SIZES.includes(s.size) ? s.size : '2K'; // visitors: the handler forces 2K (ART §1, T2)
  const rawSel = s.selection && typeof s.selection === 'object' && !Array.isArray(s.selection) ? s.selection : {};
  if (Object.keys(rawSel).length > 80) return { error: 'bad_request' };
  const selection = sim.normalizeSelection(style, rawSel);
  const keys = sim.placedKeys(style);
  const selHash = sha256(keys.map((k) => `${k}=${selection[k] ?? '-'}`).join('|')).slice(0, 32);
  return { state: { style, time, pose: s.pose, aspect, size, selection, selHash } };
}

export function keyFor(modelId, st, exp = null) {
  // exp: an admin experiment (prompt override) gets its own key, so it can never be served to a visitor's lookup
  return sha256([KEY_VERSION, modelId, PROMPT_VERSION, st.style, st.selHash, st.pose, st.time, st.size, st.aspect, ...(exp ? [exp] : [])].join('|'));
}

/** Visible items: in the catalog, in the selection; ranked as sent; ≤ 24. */
export function cleanItems(items, st) {
  const chosen = new Set(Object.values(st.selection).filter(Boolean));
  const out = []; const seen = new Set();
  for (const x of Array.isArray(items) ? items.slice(0, 40) : []) {
    const id = typeof x?.id === 'string' ? x.id : null;
    if (!id || seen.has(id) || !chosen.has(id) || !sim.items.has(id)) continue;
    const area = Number(x.area);
    seen.add(id);
    out.push({ id, area: Number.isFinite(area) ? Math.max(0, Math.min(1, area)) : 0 });
    if (out.length >= 24) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- prompt
const TYPE_WORDS = { wall_art: 'artwork on the wall', sofa: 'sofa', armchair: 'armchair', coffee_table: 'coffee table', rug: 'rug', bed: 'bed', bedding: 'bedding', nightstand: 'nightstand', tv_unit: 'TV unit', dining_table: 'dining table', dining_chair: 'dining chair', floor_lamp: 'floor lamp', table_lamp: 'table lamp', pendant_lamp: 'pendant lamp', curtains: 'curtains', plant: 'plant', mirror: 'mirror', cushions: 'cushions', throw: 'throw' };
const pct = (a) => (a >= 0.005 ? `about ${Math.round(a * 100)}% of the frame` : 'small in the frame');
function describe(it) {
  const mats = (it.materialsEn || []).slice(0, 3).join(', ');
  return `${it.nameEn || it.name}${it.colorEn ? `, ${it.colorEn.toLowerCase()}` : ''}${mats ? ` (${mats.toLowerCase()})` : ''}`;
}

/**
 * The instruction (ART §2, prompt version v1): the fixed skeleton, then fixed style / light / grade vocabulary, then
 * one line per reference item. Supplier names never appear: names, colours and materials come from the public catalog.
 */
export function buildPrompt({ time, style = null, refs, inline = false, closeUp = false, head = null }) {
  const lens = closeUp ? '85 mm lens, f/2.8 with the room softly out of focus behind the item' : '35 mm lens, f/5.6';
  const lines = head ? [head] : [
    `Photograph of this exact interior. Keep the camera, framing and every object exactly as shown: same shapes, colours, materials and positions; add, remove or move nothing. Make it a real architectural photograph: natural window light with soft falloff, true contact shadows, real fabric weave and wrinkles, wood grain, subtle imperfections, ${lens}, fine film grain. The view through the window stays exactly as shown.`,
    `${LIGHT_WORDS[time] || LIGHT_WORDS.day} ${STYLE_WORDS[style] || ''} ${GRADE_WORDS}`.replace(/\s+/g, ' ').trim(),
    'Do not crop, zoom, rotate or reframe; if image 1 has soft blurred bands along an edge, continue the room there.',
  ];
  if (refs.length) {
    lines.push(`Images 2–${refs.length + 1} are product photos of the items below, in this order, for material and detail only: keep each item's shape, size, position and colour from image 1, and ignore their backgrounds.`);
    if (inline) for (const r of refs) lines.push(r.label);
  }
  lines.push('Return one photograph with the same aspect ratio as image 1. No text, no watermark, no border.');
  return lines.join('\n');
}

/** Storage URL of an art edition's image (catalog `image: "art/<id>.jpg"`), when the item is an edition. */
const editionUrl = (db, it, ready) => (it && typeof it.image === 'string' && /^art\/[a-z0-9-]+\.jpg$/.test(it.image) && db && ready?.has(it.image) ? db.publicUrl(it.image) : null);
// An edition's image exists only once its job has run and a candidate was approved: a reference URL that 404s makes
// the provider reject the whole request ("an input file could not be downloaded"). HEAD-checked, cached 10 min.
const EDITION_TTL_MS = 600_000;
const editionSeen = new Map(); // image path → { ok, at }
async function readyEditions(db, selection) {
  const ready = new Set();
  if (!db) return ready;
  const paths = [...new Set(Object.values(selection || {}).map((id) => sim.items.get(id)?.image).filter((x) => typeof x === 'string' && /^art\/[a-z0-9-]+\.jpg$/.test(x)))];
  await Promise.all(paths.map(async (path) => {
    const c = editionSeen.get(path);
    if (c && Date.now() - c.at < EDITION_TTL_MS) { if (c.ok) ready.add(path); return; }
    const ok = await db.exists(path).catch(() => false);
    editionSeen.set(path, { ok, at: Date.now() });
    if (ok) ready.add(path);
  }));
  return ready;
}

/** References ranked by pixel area; the selected artwork is always among them (ART §2: the painting is the edition). */
function refImages(items, model, { selection = {}, db = null, ready = null } = {}) {
  const max = Math.min(REF_LIMIT(), model.maxRefs ?? 8);
  const out = [];
  const add = (id, area) => {
    const it = sim.items.get(id);
    const url = editionUrl(db, it, ready) || REFS.refs?.[id]?.[0];
    if (!url || !it || out.some((r) => r.id === id)) return;
    out.push({ id, url, label: `Image ${out.length + 2} — the ${TYPE_WORDS[it.type] || String(it.type || 'item').replace(/_/g, ' ')}: ${describe(it)}; ${pct(area)}.` });
  };
  const art = Object.values(selection).find((id) => id && sim.items.get(id)?.type === 'wall_art');
  for (const x of items) { if (out.length >= max - (art ? 1 : 0)) break; if (x.id !== art) add(x.id, x.area); }
  if (art) add(art, items.find((x) => x.id === art)?.area ?? 0);
  return out;
}

// ---------------------------------------------------------------------------------------------- storage
async function lookup(db, keys) {
  let rows = [];
  try { rows = await db.rows(keys); } catch (e) { console.error(`[photo] lookup failed: ${e.message}`); return { error: 'store_failed' }; }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const k of keys) {
    const r = byKey.get(k);
    if (r && r.status === 'ok') return { row: r };
  }
  const pending = keys.map((k) => byKey.get(k)).find((r) => r && r.status === 'pending' && Date.now() - Date.parse(r.updated_at || 0) < PENDING_STALE_MS);
  if (pending) return { row: null, pending };
  const primary = byKey.get(keys[0]);
  const recent = primary && Date.now() - Date.parse(primary.updated_at || 0) < 24 * 3_600_000;
  return { row: null, unstable: !!(primary && primary.rejects >= UNSTABLE_REJECTS && recent) };
}

const subjects = (ipH, session) => ['global', `ip:${ipH}`, ...(session ? [`s:${session}`] : [])];
async function takeQuota(db, ipH, session) {
  const subj = subjects(ipH, session);
  const caps = [DAILY_GLOBAL(), DAILY_IP(), ...(session ? [DAILY_IP()] : [])];
  try { return { ok: (await db.rpc('photo_take_quota', { p_subjects: subj, p_caps: caps })) === true, subj }; }
  catch (e) { console.error(`[photo] quota rpc failed: ${e.message}`); return { ok: false, error: 'store_failed', subj }; }
}
async function refundQuota(db, subj) {
  try { await db.rpc('photo_refund_quota', { p_subjects: subj }); } catch (e) { console.warn(`[photo] refund failed: ${e.message}`); }
}

// ---------------------------------------------------------------------------------------------- generation
/** Transcode, store in Storage, write the index row + the cost line. Returns the public response. */
async function storeResult(db, { model, key, meta, bytes, genMs, refs, admin, t0, usage = null }) {
  let img;
  try { img = toStorableJpeg(bytes, { maxEdge: meta.size === '1K' ? 1440 : meta.size === '4K' ? 3840 : 2560, quality: meta.size === '4K' ? 90 : 86 }); }
  catch (e) { throw new GatewayError('empty', `unusable image from ${model.id}: ${e.message}`, 0, model.provider); }
  const path = objectPath(admin ? 'preset' : 'v1', key, img.type === 'image/webp' ? 'webp' : 'jpg');
  await db.put(path, img.bytes, img.type);
  // the provider's own estimate for this call when there is one (Higgsfield), else the list price
  const hasEst = Number.isFinite(meta.estimate) && meta.estimate > 0;
  const usd = hasEst ? meta.estimate : costOf(model, meta.size);
  const row = {
    key, path, kind: 'photo', source: admin ? 'preset' : 'user', status: 'ok', model: model.id, provider: model.provider, request_id: meta.request_id || null,
    prompt_version: PROMPT_VERSION, style: meta.style, time_of_day: meta.time, size: meta.size, aspect: meta.aspect, width: img.width || null,
    height: img.height || null, bytes: img.bytes.length, ms: genMs, cost_usd: usd, refs, session: meta.session || null, ip_hash: meta.ip_hash || null,
    updated_at: new Date().toISOString(),
  };
  try { await db.upsertRow(row); } catch (e) { console.error(`[photo] index write failed: ${e.message}`); }
  console.info(JSON.stringify({ ev: 'photo.gen', key: key.slice(0, 12), model: model.id, provider: model.provider, usd, est: hasEst ? false : !!model.estimate, size: meta.size, aspect: meta.aspect, refs, ms: genMs, total: t0 ? Date.now() - t0 : null, bytes: img.bytes.length, transcoded: img.transcoded, inTok: usage?.prompt_tokens ?? null, outTok: usage?.completion_tokens ?? null, src: row.source, style: meta.style, time: meta.time }));
  return { url: db.publicUrl(path), key, model: model.id, ms: t0 ? Date.now() - t0 : genMs, w: img.width || null, h: img.height || null, usd, request_id: meta.request_id || null };
}

/** The job is still running at the provider: remember it, the client polls (or the webhook finishes it). */
async function storePending(db, { model, key, meta, requestId, refs, admin }) {
  await db.upsertRow({
    key, path: null, kind: 'photo', source: admin ? 'preset' : 'user', status: 'pending', model: model.id, provider: model.provider, request_id: requestId,
    prompt_version: PROMPT_VERSION, style: meta.style, time_of_day: meta.time, size: meta.size, aspect: meta.aspect, refs,
    cost_usd: Number.isFinite(meta.estimate) ? meta.estimate : null,
    session: meta.session || null, ip_hash: meta.ip_hash || null, updated_at: new Date().toISOString(),
  });
  console.info(JSON.stringify({ ev: 'photo.pending', key: key.slice(0, 12), model: model.id, request: String(requestId).slice(0, 8) }));
  return { pending: true, key, retryAfter: 3 };
}

const quotaSubjects = (row) => (row?.ip_hash ? ['global', `ip:${row.ip_hash}`, ...(row.session ? [`s:${row.session}`] : [])] : null);

/**
 * Finish a pending job (client poll or provider webhook): done → stored + { url }; running → { pending };
 * failed / given up → the row is marked failed, the quota refunded, { error }.
 */
export async function completePending(db, row, { t0 = Date.now() } = {}) {
  if (!row || row.status !== 'pending' || !row.request_id) return row?.status === 'ok' ? { url: db.publicUrl(row.path), key: row.key, model: row.model, ms: 0 } : { error: 'gateway' };
  const model = modelConfig(row.model);
  const fail = async (why) => {
    try { await db.upsertRow({ key: row.key, path: null, status: 'failed', model: row.model, prompt_version: PROMPT_VERSION, updated_at: new Date().toISOString() }); } catch { /* best effort */ }
    const subj = quotaSubjects(row); if (subj && row.source !== 'preset') await refundQuota(db, subj);
    console.info(JSON.stringify({ ev: 'photo.fail', key: row.key.slice(0, 12), code: why, model: row.model }));
    return { error: 'gateway' };
  };
  if (Date.now() - Date.parse(row.updated_at || 0) > PENDING_STALE_MS) return fail('stale');
  let out;
  try { out = await resumeImage(model, row.request_id); }
  catch (err) { if (err instanceof GatewayError && (err.code === 'timeout' || err.code === 'busy')) return { pending: true, key: row.key, retryAfter: 3 }; return fail(err?.code || 'gateway'); }
  if (out.pending) return { pending: true, key: row.key, retryAfter: 3 };
  const meta = { style: row.style, time: row.time_of_day, size: row.size || '2K', aspect: row.aspect, session: row.session, ip_hash: row.ip_hash, request_id: row.request_id, estimate: row.cost_usd == null ? NaN : Number(row.cost_usd) };
  return storeResult(db, { model, key: row.key, meta, bytes: out.bytes, genMs: Date.now() - Date.parse(row.updated_at || Date.now()), refs: row.refs ?? 0, admin: row.source === 'preset', t0 });
}

function webhookUrl(req) {
  if (!env('HIGGSFIELD_WEBHOOK_SECRET')) return null; // unsigned deliveries are not accepted: poll only
  const base = env('PHOTO_PUBLIC_URL') || (header(req, 'x-forwarded-host') ? `https://${header(req, 'x-forwarded-host')}` : '');
  return /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base.replace(/\/$/, '')) ? `${base.replace(/\/$/, '')}/api/photo-hook` : null;
}

/**
 * One photo: the tier's models in order (or exactly `named`), estimate first, then submit.
 *   frameUrl: the frame's public Storage URL (Higgsfield takes URLs; the gateway gets the bytes inline).
 *   dry: only ask what it would cost → { dry: true, estimates }.
 * Only models that can return exactly the frame's aspect ratio are tried (another shape would fail the client's
 * structural check, and that photo would be paid for nothing).
 */
async function develop({ req, auth, db, st, items, frame, frameSize, frameUrl = null, tier, session, ipH, t0, admin, named = null, dry = false, trace = [], limitUsd = null, head = null, noRefs = false }) {
  const exp = head ? `x:${sha256(head).slice(0, 16)}${noRefs ? ':n' : ''}` : null;
  const avail = usable(req);
  let models = pickModels(tier, avail, named);
  const ab = !named && tier === 'default' ? abModel(keyFor((models[0] || { id: 'none' }).id, st)) : null;
  const abCfg = ab ? modelConfig(ab) : null;
  if (abCfg && avail[abCfg.provider]) models = [abCfg, ...models.filter((m) => m.id !== ab)];
  // admin experiments may use a model that only answers 'auto' for this shape (it follows the input frame)
  const fits = (m) => !m.aspects || m.aspects.includes(st.aspect) || (admin && head && m.aspects.includes('auto'));
  for (const m of models.filter((x) => !fits(x))) trace.push({ provider: m.provider, model: m.id, status: null, code: 'aspect', detail: `cannot return ${st.aspect}` });
  models = models.filter(fits);
  if (!models.length) { const e = new GatewayError('unavailable', 'no model available for this frame (keys missing, breakers open, or no model with this aspect ratio)'); e.trace = trace; throw e; }
  const deadlineAt = t0 + deadlineMs();
  const meta = { style: st.style, time: st.time, size: st.size, aspect: st.aspect, session, ip_hash: ipH };
  const frameImg = { url: `data:image/jpeg;base64,${frame.toString('base64')}`, publicUrl: frameUrl, label: 'Image 1 — the render to turn into a photograph:' };
  const used = new Map(); // model id → the references of its latest try
  const ready = await readyEditions(db, st.selection);
  const makeOpts = (model, n, lastErr) => {
    // a second try only when the first was rejected with reference photos (an unreachable image, too many inputs)
    if (n > 1 || (n === 1 && !(lastErr instanceof GatewayError && lastErr.code === 'rejected' && used.get(model.id)?.length))) return null;
    const refs = n === 0 && !noRefs ? refImages(items, model, { selection: st.selection, db, ready }) : [];
    used.set(model.id, refs);
    const key = keyFor(model.id, st, exp);
    return {
      auth, prompt: buildPrompt({ time: st.time, style: st.style, refs, inline: model.provider === 'higgsfield', closeUp: /;o:/.test(st.pose), head }),
      images: [frameImg, ...refs], aspectRatio: model.aspects ? st.aspect : null, imageSize: bestSize(model, st.size),
      width: frameSize.width, height: frameSize.height, timeoutMs: Math.max(5000, Math.min(45_000, deadlineAt - Date.now() - 3000)),
      deadlineAt: deadlineAt - 4000, idempotencyKey: `${key.slice(0, 32)}-${n}`, webhook: webhookUrl(req), seed: parseInt(key.slice(0, 7), 16),
      maxCost: limitUsd ?? maxUsd(!admin),
    };
  };
  if (dry) return { dry: true, estimates: await dryRun(models, makeOpts) };
  if (env('PHOTO_PROVIDER') === 'stub') return storeResult(db, { model: models[0], key: keyFor(models[0].id, st), meta, bytes: frame, genMs: 0, refs: 0, admin, t0 }); // tests, offline
  const t1 = Date.now();
  const { model, out } = await tryModels(models, makeOpts, { trace, deadlineAt });
  const key = keyFor(model.id, st, exp);
  const refs = used.get(model.id)?.length || 0;
  const m2 = { ...meta, size: bestSize(model, st.size), estimate: out.pending ? out.pending.estimate : out.estimate, request_id: out.pending ? out.pending.requestId : out.requestId || null };
  if (out.pending) return { ...(await storePending(db, { model, key, meta: m2, requestId: out.pending.requestId, refs, admin })), model: model.id, usd: m2.estimate ?? null, request_id: out.pending.requestId };
  return storeResult(db, { model, key, meta: m2, bytes: out.bytes, genMs: Date.now() - t1, refs, admin, t0, usage: out.usage });
}

async function saveFrame(db, key, frame, st, items) {
  const state = { style: st.style, time: st.time, pose: st.pose, aspect: st.aspect, size: st.size, selection: st.selection };
  await Promise.all([
    db.put(`frames/${key}.jpg`, frame, 'image/jpeg', { upsert: true }),
    db.put(`frames/${key}.json`, Buffer.from(JSON.stringify({ v: 1, state, items })), 'application/json', { upsert: true }),
  ]);
}

// ---------------------------------------------------------------------------------------------- job queue (ART)
const JOB_MAX_ATTEMPTS = 40;          // provider polls included
const runLimited = createLimiter([{ windowMs: 60_000, max: 6 }, { windowMs: 3_600_000, max: 120 }]);
const jobPatch = (db, id, patch) => db.call(`/rest/v1/photo_jobs?id=eq.${Number(id)}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { 'content-type': 'application/json', prefer: 'return=minimal' } });

const jobUsd = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(5, Number(v)) : null);

/** Art edition: an original work for a style (docs/ART.md §5). One candidate per step; c1 also becomes art/<id>.jpg. */
async function runEditionJob(db, job, { req, t0, trace }) {
  const p = job.params || {};
  const id = typeof p.id === 'string' && /^[a-z0-9-]{3,60}$/.test(p.id) ? p.id : null;
  const style = typeof p.style === 'string' && STYLES_RE.test(p.style) ? p.style : null;
  const brief = typeof p.prompt === 'string' ? p.prompt.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 800) : '';
  const palette = (Array.isArray(p.palette) ? p.palette : []).filter((h) => /^#[0-9a-f]{6}$/i.test(h)).slice(0, 6);
  if (!id || !style || brief.length < 10) throw new GatewayError('rejected', 'edition: params need id, style and prompt');
  const n = Math.max(1, Math.min(4, Number(p.candidates) || 2));
  const aspect = ASPECTS.includes(p.aspect) ? p.aspect : '1:1';
  const want = ['1K', '2K'].includes(p.resolution) ? p.resolution : '2K';
  const models = pickModels('default', usable(req), p.model).filter((m) => !m.editOnly);
  if (!models.length) throw new GatewayError('unavailable', `edition: ${p.model ? `model ${p.model} is not available` : 'no model available'}`);
  const keys = Array.from({ length: n }, (_, i) => `art:${id}:c${i + 1}`);
  const prompt = [
    `An original artwork, made for a ${STYLE_WORDS[style] ? STYLE_WORDS[style].split(':')[0].toLowerCase() : 'calm, refined'} interior: ${brief}.`,
    palette.length ? `Palette strictly from these colours: ${palette.join(', ')}.` : '',
    'Show the whole work flat and front-on, filling the image edge to edge: no frame, no wall, no room, no shadow, no text, no signature, no watermark. Original composition; not in the manner of any named artist; not a reproduction of an existing work.',
  ].filter(Boolean).join('\n');
  const optsFor = (i) => (model, k) => (k > 0 ? null : { auth: authToken(req), prompt, images: [], aspectRatio: aspect, imageSize: bestSize(model, want), deadlineAt: t0 + deadlineMs() - 6000, timeoutMs: 45_000, idempotencyKey: `${keys[i]}-${job.id}`.slice(0, 64), seed: 1000 + i, maxCost: jobUsd(p.maxUsd) ?? maxUsd(false) });
  if (p.dry === true) {
    const estimates = await dryRun(models, optsFor(0));
    const first = estimates.find((e) => Number.isFinite(e.usd));
    return { done: true, result: { dry: true, id, candidates: n, estimates, totalUsd: first ? +(first.usd * n).toFixed(4) : null }, cost: 0 };
  }
  const rows = new Map((await db.rows(keys)).map((r) => [r.key, r]));
  const summary = async () => {
    const all = new Map((await db.rows(keys)).map((r) => [r.key, r]));
    const made = keys.map((k, i) => { const r = all.get(k); return r ? { candidate: i + 1, model: r.model, usd: r.cost_usd == null ? null : Number(r.cost_usd), request_id: r.request_id || null, status: r.status } : null; }).filter(Boolean);
    return { made, cost: +made.reduce((a2, m) => a2 + (m.status === 'ok' ? m.usd || 0 : 0), 0).toFixed(4) };
  };
  for (let i = 0; i < n; i++) {
    const key = keys[i]; const r = rows.get(key);
    if (r?.status === 'ok') continue;
    const finish = async (model, bytes, ms, requestId, estimate) => {
      const img = toStorableJpeg(bytes, { maxEdge: 2560, quality: 90 });
      const path = `art/${id}-c${i + 1}.jpg`;
      await db.put(path, img.bytes, img.type, { upsert: true, maxAge: 3600 });
      if (i === 0) await db.put(`art/${id}.jpg`, img.bytes, img.type, { upsert: true, maxAge: 3600 });
      const hasEst = Number.isFinite(estimate);
      const usd = hasEst ? estimate : costOf(model, bestSize(model, want));
      await db.upsertRow({ key, path, kind: 'edition', source: 'preset', status: 'ok', model: model.id, provider: model.provider, request_id: requestId, prompt_version: PROMPT_VERSION, style, size: bestSize(model, want), aspect, width: img.width || null, height: img.height || null, bytes: img.bytes.length, ms, cost_usd: usd, refs: 0, updated_at: new Date().toISOString() });
      console.info(JSON.stringify({ ev: 'edition.gen', id, candidate: i + 1, model: model.id, usd, est: hasEst ? false : !!model.estimate, ms }));
    };
    if (r?.status === 'pending' && r.request_id) {
      const model = modelConfig(r.model);
      const out = await resumeImage(model, r.request_id);
      if (out.pending) return { pending: true, result: { candidate: i + 1, request_id: r.request_id, model: r.model } };
      await finish(model, out.bytes, Date.now() - Date.parse(r.updated_at || Date.now()), r.request_id, r.cost_usd == null ? NaN : Number(r.cost_usd));
      continue;
    }
    const t1 = Date.now();
    if (env('PHOTO_PROVIDER') === 'stub') { await finish(models[0], Buffer.from(encodeStub()), 0, null, NaN); continue; }
    const { model, out } = await tryModels(models, optsFor(i), { trace, deadlineAt: t0 + deadlineMs() });
    if (out.pending) {
      await db.upsertRow({ key, path: null, kind: 'edition', source: 'preset', status: 'pending', model: model.id, provider: model.provider, request_id: out.pending.requestId, prompt_version: PROMPT_VERSION, style, size: bestSize(model, want), aspect, cost_usd: Number.isFinite(out.pending.estimate) ? out.pending.estimate : null, updated_at: new Date().toISOString() });
      return { pending: true, result: { candidate: i + 1, request_id: out.pending.requestId, model: model.id, estimate: out.pending.estimate ?? null } };
    }
    await finish(model, out.bytes, Date.now() - t1, out.requestId || null, out.estimate);
    if (i < n - 1 && deadlineMs() - (Date.now() - t0) < 30_000) return { pending: true, result: { candidate: i + 1, stored: true } };
  }
  const sum = await summary();
  return { done: true, result: { id, image: `art/${id}.jpg`, url: db.publicUrl(`art/${id}.jpg`), candidates: keys.map((_, i) => db.publicUrl(`art/${id}-c${i + 1}.jpg`)), made: sum.made }, cost: sum.cost };
}
const encodeStub = () => Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

/**
 * Hero / preset: re-develop a stored visitor frame (frames/<key>.jpg + .json) with the hero or the default tier.
 * params: { from: <64-hex frame key>, model?: exact model id, size?: '1K' | '2K' | '4K', dry?: true, maxUsd?: number }.
 */
async function runHeroJob(db, job, { req, t0, trace }) {
  const p = job.params || {};
  const from = typeof p.from === 'string' && /^[a-f0-9]{64}$/.test(p.from) ? p.from : null;
  if (!from) throw new GatewayError('rejected', `${job.kind}: params.from must be the 64-hex key of a stored frame`);
  const tier = job.kind === 'hero' ? 'hero' : 'default';
  if (job.result?.key && !p.dry) {
    const row = (await db.rows([job.result.key]))[0];
    const done = (r) => ({ done: true, result: { key: r.key, url: db.publicUrl(r.path), model: r.model, usd: r.cost_usd == null ? null : Number(r.cost_usd), request_id: r.request_id || null }, cost: r.cost_usd == null ? null : Number(r.cost_usd) });
    if (row?.status === 'ok') return done(row);
    if (row?.status === 'pending') {
      const out = await completePending(db, row, { t0 });
      if (out.pending) return { pending: true, result: job.result };
      if (out.url) return done((await db.rows([row.key]))[0] || { ...row, path: '' });
    }
  }
  const meta = await fetch(db.publicUrl(`frames/${from}.json`)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const frame = await fetch(db.publicUrl(`frames/${from}.jpg`)).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? Buffer.from(b) : null)).catch(() => null);
  if (!meta?.state || !frame) throw new GatewayError('rejected', `${job.kind}: frame ${from.slice(0, 12)} not found in Storage`);
  const { state: st, error } = cleanState({ ...meta.state });
  if (error) throw new GatewayError('rejected', `${job.kind}: stored state invalid`);
  st.size = ['1K', '2K', '4K'].includes(p.size) ? p.size : meta.state.size || '2K';
  const frameSize = jpegSize(frame);
  const items = cleanItems(meta.items, st);
  const head = typeof p.prompt === 'string' && p.prompt.length >= 40 && p.prompt.length <= 4000 ? p.prompt : null; // experiments only
  const out = await develop({ req, auth: authToken(req), db, st, items, frame, frameSize, frameUrl: db.publicUrl(`frames/${from}.jpg`), tier, session: null, ipH: null, t0, admin: true, named: p.model || null, dry: p.dry === true, trace, limitUsd: jobUsd(p.maxUsd), head, noRefs: p.refs === false });
  if (out.dry) return { done: true, result: { dry: true, from, estimates: out.estimates }, cost: 0 };
  if (out.pending) return { pending: true, result: { key: out.key, model: out.model, estimate: out.usd ?? null, request_id: out.request_id || null } };
  return { done: true, result: { key: out.key, url: out.url, model: out.model, usd: out.usd ?? null, request_id: out.request_id || null }, cost: out.usd ?? null };
}

/** Claim the oldest runnable job and run one step of it (GET or POST /api/photo?run=1; takes no parameters). */
async function runQueue(db, req) {
  const t0 = Date.now();
  let job;
  try { job = ((await db.rpc('photo_claim_job', { p_lease_seconds: 70 })) || [])[0]; }
  catch (e) { console.error(`[photo] claim failed: ${e.message}`); return { error: 'store_failed' }; }
  if (!job) return { ok: true, idle: true };
  const finish = (patch) => jobPatch(db, job.id, { ...patch, locked_until: null, finished_at: new Date().toISOString() }).catch((e) => console.error(`[photo] job ${job.id} update failed: ${e.message}`));
  // 3D reconstructions run for minutes (each step is one status check on a 20 s lease)
  if (job.attempts > (job.kind === 'twin' || job.kind === 'loop' ? 90 : JOB_MAX_ATTEMPTS)) { await finish({ status: 'failed', error: 'too many attempts' }); return { job: job.id, kind: job.kind, status: 'failed' }; }
  // every provider attempt of this step (provider, model, HTTP status, code, ≤ 200 chars): the coordinator reads the
  // job row, not the function logs. Earlier steps' attempts stay in result.attempts (last 12).
  const trace = [];
  const withTrace = (result, extra = []) => {
    const all = [...(Array.isArray(job.result?.attempts) ? job.result.attempts : []), ...trace, ...extra].slice(-12);
    return all.length ? { ...(result || {}), attempts: all } : result || null;
  };
  try {
    const out = job.kind === 'edition' ? await runEditionJob(db, job, { req, t0, trace })
      : job.kind === 'hero' || job.kind === 'preset' ? await runHeroJob(db, job, { req, t0, trace })
      : job.kind === 'views' ? await runViewsJob(db, job, { req, t0, trace })
      : job.kind === 'twin' ? await runTwinJob(db, job, { req, t0, trace })
      : job.kind === 'loop' ? await runLoopJob(db, job, { req, t0, trace })
      : await runPlateJob(db, job, { req, t0, trace });
    if (out.pending) {
      // the provider job is still running: re-claimable in 20 s (the next ?run=1 call checks it, the webhook may finish it first)
      // (a step that stored something and has more to do — the next view, the next candidate — is claimable at once)
      await jobPatch(db, job.id, { result: withTrace({ ...(job.result || {}), ...(out.result || {}) }), locked_until: new Date(Date.now() + (out.result?.stored ? -1000 : 20_000)).toISOString() });
      return { job: job.id, kind: job.kind, status: 'running', result: out.result || null, ms: Date.now() - t0 };
    }
    const result = withTrace({ ...(job.result?.request_id && !out.result?.request_id ? { request_id: job.result.request_id } : {}), ...(out.result || {}) });
    await finish({ status: 'done', result, cost: out.cost ?? null, error: null });
    console.info(JSON.stringify({ ev: 'photo.job', id: job.id, kind: job.kind, status: 'done', usd: out.cost ?? null, ms: Date.now() - t0 }));
    return { job: job.id, kind: job.kind, status: 'done', result, ms: Date.now() - t0 };
  } catch (err) {
    const own = Array.isArray(err?.trace) && err.trace !== trace ? err.trace.filter((x) => !trace.includes(x)) : [];
    const last = trace.length || own.length ? [] : [attemptOf(null, err)];
    const result = withTrace(job.result || {}, [...own, ...last]);
    const lines = (result?.attempts || []).slice(-6).map((x) => `${x.model || x.provider || '-'} ${x.status || ''} ${x.code}: ${x.detail}`.replace(/\s+/g, ' ').trim());
    const msg = `${String(err?.message || err).slice(0, 700)}${lines.length ? ` || attempts: ${lines.join(' | ')}` : ''}`.slice(0, 1900);
    // Higgsfield said "no balance / bad key": leave the job queued for a later run instead of failing it (a gateway
    // without billing is not a reason to wait: then the job fails with the attempts listed)
    const hfDown = [...trace, ...own].some((x) => x.provider === 'higgsfield' && x.code === 'unavailable') || (isFatalGateway(err) && err.provider === 'higgsfield');
    if (hfDown) { await jobPatch(db, job.id, { status: 'queued', error: msg, result, locked_until: null }).catch(() => {}); return { job: job.id, kind: job.kind, status: 'queued', error: 'unavailable', attempts: result?.attempts || [] }; }
    await finish({ status: 'failed', error: msg, result });
    console.info(JSON.stringify({ ev: 'photo.job', id: job.id, kind: job.kind, status: 'failed', error: msg.slice(0, 200) }));
    return { job: job.id, kind: job.kind, status: 'failed', error: err instanceof GatewayError ? err.code : 'gateway', attempts: result?.attempts || [] };
  }
}

async function jobStats(db) {
  try {
    const open = (await db.call('/rest/v1/photo_jobs?status=in.(queued,running)&select=status&limit=500')) || [];
    const last = ((await db.call('/rest/v1/photo_jobs?status=eq.failed&select=id,kind,error,finished_at&order=finished_at.desc&limit=1')) || [])[0] || null;
    return { queued: open.filter((j) => j.status === 'queued').length, running: open.filter((j) => j.status === 'running').length, lastError: last ? { id: last.id, kind: last.kind, error: String(last.error || '').slice(0, 300), at: last.finished_at } : null };
  } catch (e) { return { error: e.status || 'unavailable' }; }
}

const pollLimited = createLimiter([{ windowMs: 60_000, max: 40 }]);
async function pollKey(db, key, ipH, t0) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) return { error: 'bad_request' };
  if (pollLimited(ipH)) return { error: 'rate_limited', retryAfter: 5 };
  let rows;
  try { rows = await db.rows([key]); } catch (e) { console.error(`[photo] poll read failed: ${e.message}`); return { error: 'store_failed' }; }
  const row = rows[0];
  if (!row) return { error: 'gateway' };
  if (row.status === 'ok') return { url: db.publicUrl(row.path), key, model: row.model, ms: Date.now() - t0, cached: true };
  if (row.status !== 'pending') return { error: row.status === 'rejected' ? 'unstable' : 'gateway' };
  return completePending(db, row, { t0 });
}


// GET /api/photo?diag=1&probe=1 — which Higgsfield endpoints exist for this key, and what one call costs.
// Uses the provider's free POST /estimate/{endpoint}; the candidate list is fixed here (the request supplies nothing).
const PROBE_IMG = 'https://villar-blond.vercel.app/assets/og.jpg';
const PROBE_PATHS = [
  // documented image endpoints
  ['marketing-studio/image', 'edit'], ['marketing-studio/image/flare', 'edit'], ['marketing-studio/image/sunburst', 'edit'],
  ['xai/grok-imagine-image-2.0', 'edit'], ['alibaba/qwen-image-3/edit', 'edit'], ['alibaba/qwen-image-3/text-to-image', 't2i'],
  ['ideogram/v4.0', 't2i'], ['reve/edit', 'edit1'], ['reve/text-to-image', 't2i'], ['z-image/turbo', 't2i'], ['higgsfield-ai/soul/v2/standard', 't2i'],
  // guesses: Nano Banana / Seedream / GPT Image / FLUX
  ['nano-banana', 'edit'], ['nano-banana/pro', 'edit'], ['nano-banana-pro', 'edit'], ['nano-banana/edit', 'edit'], ['nano-banana-pro/edit', 'edit'],
  ['nano-banana-2', 'edit'], ['nano-banana-2/edit', 'edit'], ['nano-banana-2.1', 'edit'], ['nano-banana-2.1/edit', 'edit'],
  ['google/nano-banana', 'edit'], ['google/nano-banana/edit', 'edit'], ['google/nano-banana-pro', 'edit'], ['google/nano-banana-pro/edit', 'edit'], ['google/nano-banana-pro/text-to-image', 't2i'],
  ['google/nano-banana-2/edit', 'edit'], ['google/nano-banana-2.1/edit', 'edit'], ['google/nano-banana-2.1/text-to-image', 't2i'],
  ['bytedance/seedream/v4/edit', 'edit'], ['bytedance/seedream/v4/text-to-image', 't2i'], ['bytedance/seedream/v4.5/edit', 'edit'], ['bytedance/seedream-5.0/edit', 'edit'], ['bytedance/seedream-5.5/edit', 'edit'], ['bytedance/seedream/v5.5/edit', 'edit'],
  ['openai/gpt-image-2/edit', 'edit'], ['openai/gpt-image-2.6/edit', 'edit'], ['black-forest-labs/flux/v2', 'edit'], ['bfl/flux-2/pro/edit', 'edit'], ['flux-pro/kontext/max/text-to-image', 't2i'],
  // more guesses (the public API lists Seedream 5.0 Pro, Kling Image 4.0, Soul 2 by name; paths unknown)
  ['bytedance/seedream-5.0-pro/edit', 'edit'], ['bytedance/seedream/v5/pro/edit', 'edit'], ['bytedance/seedream/v5-pro/edit', 'edit'], ['bytedance/seedream-5-pro/edit', 'edit'], ['bytedance/seedream/v5/edit', 'edit'], ['bytedance/seedream-5.0/pro/edit', 'edit'], ['bytedance/seedream-v5-pro/edit', 'edit'], ['bytedance/seedream-5.0-pro', 'edit'], ['bytedance/seedream/v5/pro', 'edit'], ['bytedance/seedream/v5.0/pro/edit', 'edit'], ['bytedance/seedream/v4/edit', 'edit'],
  ['kling-image/v4.0', 'edit'], ['kling-image/v4.0/edit', 'edit'], ['kling-image/v4.0/image-to-image', 'edit'], ['kling-image/4.0', 'edit'], ['kling/image-4.0', 'edit'], ['kling/image/v4.0', 'edit'], ['kling-image/o1', 'edit'], ['kling-image/v4', 'edit'], ['kling-image/v4.0/text-to-image', 't2i'], ['kwaivgi/kling-image/v4.0', 'edit'], ['kling-ai/image/v4.0', 'edit'],
  ['higgsfield-ai/soul/reference', 'edit'], ['higgsfield-ai/soul/v2/reference', 'edit'], ['higgsfield-ai/soul/standard', 't2i'], ['higgsfield-ai/soul/v2/edit', 'edit'],
  ['openai/gpt-image-2', 'edit'], ['openai/gpt-image-2.6', 'edit'], ['openai/gpt-image-2.5', 'edit'], ['openai/gpt-image-2/image-to-image', 'edit'], ['gpt-image-2/edit', 'edit'], ['openai/gpt-image-1.5/edit', 'edit'],
  ['black-forest-labs/flux-2/pro/edit', 'edit'], ['black-forest-labs/flux-3/edit', 'edit'], ['bfl/flux-3/edit', 'edit'], ['flux-2/pro/edit', 'edit'], ['flux-kontext/pro', 'edit'], ['flux-pro/kontext/max/edit', 'edit'],
  ['xai/grok-imagine-image-2.0/edit', 'edit'], ['marketing-studio/image/4k', 'edit'],
  // 3D
  ['tripo/h3.1/multiview-to-3d', 'multi'], ['tripo/h3.1/image-to-3d', 'img1'], ['tripo3d/h3.1/multiview-to-3d', 'multi'], ['tripo/p2/image-to-3d', 'img1'],
  ['tencent/hunyuan3d/v3/image-to-3d', 'multi'], ['hunyuan3d/v3/image-to-3d', 'multi'], ['meshy/v7/image-to-3d', 'img1'], ['meshy/image-to-3d', 'img1'], ['meshy/multi-image-to-3d', 'multi'], ['meta/sam-3/3d-objects', 'img1'], ['sam-3/3d', 'img1'],
  // video (window loop)
  ['bytedance/seedance-2.5/image-to-video', 'i2v'], ['bytedance/seedance-2.0/image-to-video', 'i2v'], ['kling-video/o3/first-last-frame', 'flf'], ['kling-video/v3.0-turbo/image-to-video', 'i2v'], ['minimax/h3/image-to-video', 'i2v'], ['alibaba/wan-3.0/image-to-video', 'i2v'], ['pixverse/v6/image-to-video', 'i2v'],
  ['google/veo-3.1/fast/image-to-video', 'i2v'], ['veo-3.1/fast/image-to-video', 'i2v'],
];
const probeBody = (kind) => {
  const prompt = 'A quiet living room, natural window light.';
  if (kind === 't2i') return { prompt };
  if (kind === 'edit') return { prompt, image_urls: [PROBE_IMG] };
  if (kind === 'edit1') return { prompt, image_url: PROBE_IMG };
  if (kind === 'img1') return { image_url: PROBE_IMG };
  if (kind === 'multi') return { image_urls: [PROBE_IMG, PROBE_IMG] };
  if (kind === 'flf') return { prompt, first_frame_url: PROBE_IMG, last_frame_url: PROBE_IMG, duration: 5 };
  return { prompt, image_url: PROBE_IMG, duration: 5 };
};
async function probeEndpoints() {
  const auth = hfAuth();
  if (!auth) return { error: 'not_configured' };
  const one = async ([path, kind]) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 7000);
    try {
      const r = await fetch(`${HF_BASE()}/estimate/${path}`, { method: 'POST', headers: { Authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(probeBody(kind)), signal: ctrl.signal });
      const text = (await r.text()).slice(0, 400);
      let usd = null; try { usd = JSON.parse(text).usd ?? null; } catch { /* not json */ }
      return { path, status: r.status, ...(usd != null ? { usd } : r.status === 404 ? {} : { body: text.replace(/\s+/g, ' ').slice(0, 160) }) };
    } catch (e) { return { path, status: 0, body: e?.name === 'AbortError' ? 'timeout' : 'network' }; }
    finally { clearTimeout(t); }
  };
  const out = [];
  for (let i = 0; i < PROBE_PATHS.length; i += 8) out.push(...await Promise.all(PROBE_PATHS.slice(i, i + 8).map(one)));
  return { found: out.filter((x) => x.status !== 404 && x.status !== 0), missing: out.filter((x) => x.status === 404).length, failed: out.filter((x) => x.status === 0).length };
}

// ---------------------------------------------------------------------------------------------- handler
export default async function handler(req, res) {
  const t0 = Date.now();
  const ks = killSwitch();
  if (req.method === 'GET' || req.method === 'HEAD') {
    const db = supa();
    const q = req.query && Object.keys(req.query).length ? req.query : Object.fromEntries(new URL(req.url || '/', 'http://x').searchParams);
    await loadConfig(db);
    if (q.run) {
      if (ks === 'all' || ks === 'generate') return send(res, 200, { error: 'disabled' });
      if (!db) return send(res, 200, { error: 'not_configured' });
      if (runLimited(ipHash(clientIp(req)))) return send(res, 200, { error: 'rate_limited' });
      return send(res, 200, await runQueue(db, req));
    }
    // GET /api/photo?diag=1 — setup check: booleans and status codes only, no secrets, nothing billable
    if (q.diag) {
      if (diagLimited(ipHash(clientIp(req)))) return send(res, 200, { error: 'rate_limited' });
      if (q.probe) return send(res, 200, await probeEndpoints());
      const [higgsfield, storage, jobs] = await Promise.all([hfProbe(), db ? db.check() : Promise.resolve(null), db ? jobStats(db) : Promise.resolve(null)]);
      return send(res, 200, {
        providers: { higgsfield, gateway: { configured: !!authToken(req) } },
        storage: { configured: !!db, ...(storage || {}) },
        disabled: ks || false,
        jobs,
        caps: { perIp: DAILY_IP(), global: DAILY_GLOBAL() },
        // live config (public.photo_config): who may generate, and which overrides are active (names only)
        config: liveConfig().ok, visitors: liveConfig().visitors, pilots: liveConfig().pilots.size, overrides: liveConfig().names,
        models: modelList('default', usable(req)).map((m) => m.id),
        breakers: { higgsfield: providerOff('higgsfield'), gateway: providerOff('gateway'), models: modelBreakers() },
        prompt: PROMPT_VERSION,
      });
    }
    // GET /api/photo?key=… — poll a pending job (the same as op 'poll')
    if (typeof q.key === 'string') {
      if (ks === 'all') return send(res, 200, { error: 'disabled' });
      if (!db) return send(res, 200, { error: 'not_configured' });
      return send(res, 200, await pollKey(db, q.key, ipHash(clientIp(req)), t0));
    }
    const avail = usable(req);
    const models = modelList('default', avail);
    // GET /api/photo?s=<session>: `generate` = may THIS session start a generation (visitors on, or a pilot session)
    const s = typeof q.s === 'string' && SESSION_RE.test(q.s) ? q.s : null;
    const generate = !ks && !!db && models.length > 0 && mayGenerate(s);
    // aspects: the output shapes the first model can return exactly — the client pads its frame to one of these
    const aspects = models[0]?.aspects ? models[0].aspects.filter((x) => x !== 'auto') : null;
    return send(res, 200, { ok: true, enabled: ks !== 'all' && !!db, generate, models: models.map((m) => m.id), ...(aspects ? { aspects } : {}), prompt: PROMPT_VERSION });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' });
  if (ks === 'all') return send(res, 200, { error: 'disabled' });
  {
    const q = req.query && Object.keys(req.query).length ? req.query : Object.fromEntries(new URL(req.url || '/', 'http://x').searchParams);
    if (q.run) { // POST /api/photo?run=1: same as GET (no body parameters are read)
      const db = supa();
      if (ks === 'generate') return send(res, 200, { error: 'disabled' });
      if (!db) return send(res, 200, { error: 'not_configured' });
      if (runLimited(ipHash(clientIp(req)))) return send(res, 200, { error: 'rate_limited' });
      await loadConfig(db);
      return send(res, 200, await runQueue(db, req));
    }
  }

  const { body, error: bodyErr } = await readJson(req, MAX_BODY);
  if (bodyErr) return send(res, bodyErr === 'too_large' ? 413 : 400, { error: bodyErr });
  if (!body || typeof body !== 'object' || body.v !== 1) return send(res, 400, { error: 'bad_request' });
  const op = ['lookup', 'develop', 'poll', 'reject'].includes(body.op) ? body.op : null;
  if (!op) return send(res, 400, { error: 'bad_request' });
  const ip = clientIp(req);
  const ipH = ipHash(ip);
  const sessionRaw = String(body.session || header(req, 'x-villar-session') || '');
  const session = SESSION_RE.test(sessionRaw) ? sessionRaw : null;
  const admin = false;              // HTTP callers are always visitors; hero / preset / plates run only from the job queue
  const db = supa();
  if (!db) { console.error('[photo] SUPABASE_KEY is not set'); return send(res, 200, { error: 'not_configured' }); }
  await loadConfig(db);

  // ---- reject: the client's structural check found the photo drifted from the 3D frame
  if (op === 'reject') {
    const key = typeof body.key === 'string' && /^[a-f0-9]{64}$/.test(body.key) ? body.key : null;
    if (!key) return send(res, 400, { error: 'bad_request' });
    if (rejectLimited(ipH)) return send(res, 200, { error: 'rate_limited' });
    const score = Number.isFinite(Number(body.score)) ? Math.max(0, Math.min(1, Number(body.score))) : null;
    try { await db.rpc('photo_reject', { p_key: key, p_score: score }); } catch (e) { console.warn(`[photo] reject failed: ${e.message}`); }
    console.info(JSON.stringify({ ev: 'photo.reject', key: key.slice(0, 12), score, session: !!session }));
    return send(res, 200, { ok: true });
  }

  if (op === 'poll') return send(res, 200, await pollKey(db, body.key, ipH, t0));

  const { state: st, error: stErr } = cleanState(body.state);
  if (stErr) return send(res, 400, { error: stErr });
  const tier = 'default';
  st.size = '2K';                    // ART §1: live visitor generations are T2 only (NB 2.1 at 2K)
  // every model's key is looked up (a photo from any provider is a valid hit); the first usable model's key leads
  const primary = (modelList(tier, usable(req))[0] || modelList(tier)[0]).id;
  const keys = [...new Set([primary, ...modelList(tier).map((m) => m.id)])].map((id) => keyFor(id, st));

  if (op === 'lookup') {
    if (lookupLimited(ipH)) return send(res, 200, { error: 'rate_limited' });
    const found = await lookup(db, keys);
    if (found.error) return send(res, 200, { error: found.error });
    if (found.row) return send(res, 200, { hit: true, url: db.publicUrl(found.row.path), key: found.row.key, model: found.row.model, ms: Date.now() - t0, w: found.row.width, h: found.row.height });
    if (found.pending) return send(res, 200, { hit: false, pending: true, key: found.pending.key, retryAfter: 3 });
    return send(res, 200, { hit: false, key: keys[0], ...(found.unstable ? { unstable: true } : {}) });
  }

  // ---- develop
  if (ks === 'generate') return send(res, 200, { error: 'disabled' });
  // visitors generate only when the coordinator switched it on in photo_config, or for a pilot session; everyone
  // else keeps cache hits (lookups above): the client treats this as "lookup only", not as an outage
  if (!mayGenerate(session)) return send(res, 200, { error: 'lookup_only' });
  const avail = usable(req);
  if (!avail.higgsfield && !avail.gateway) {
    if (!providersAvailable(req).higgsfield && !providersAvailable(req).gateway) console.error('[photo] no provider: set HIGGSFIELD_KEY (id:secret) and/or enable the AI Gateway (OIDC / AI_GATEWAY_API_KEY)');
    return send(res, 200, { error: 'unavailable' });
  }
  const auth = env('PHOTO_PROVIDER') === 'stub' ? { token: 'stub', kind: 'stub' } : authToken(req);
  const frame = fromDataUrl(body.frame, MAX_FRAME);
  const frameSize = frame && sniff(frame) === 'image/jpeg' ? jpegSize(frame) : null;
  if (!frameSize || frameSize.width < 64 || frameSize.height < 64 || Math.max(frameSize.width, frameSize.height) > MAX_EDGE) return send(res, 400, { error: frame && frame.length >= MAX_FRAME ? 'too_large' : 'bad_request' });
  const items = cleanItems(body.items, st);
  if (!admin && (developLimitedIp(ipH) || (session && developLimitedSession(session)))) return send(res, 200, { error: 'rate_limited' });

  const found = await lookup(db, keys);
  if (found.row) return send(res, 200, { url: db.publicUrl(found.row.path), key: found.row.key, model: found.row.model, ms: Date.now() - t0, cached: true });
  if (found.pending) return send(res, 200, { pending: true, key: found.pending.key, retryAfter: 3 });
  if (found.unstable && !admin) return send(res, 200, { error: 'unstable', key: keys[0] });

  const flightKey = keys[0];
  if (inflight.has(flightKey)) {
    try { return send(res, 200, { ...(await inflight.get(flightKey)), shared: true }); } catch (e) { return send(res, 200, { error: e instanceof GatewayError ? e.code : "gateway" }); }
  }
  // registered synchronously after the check above, so a concurrent twin always finds it
  const job = (async () => {
    let quota = { ok: true, subj: null };
    if (!admin) {
      quota = await takeQuota(db, ipH, session);
      if (!quota.ok) throw new GatewayError(quota.error || 'quota', 'daily cap reached');
    }
    // keep the input frame + its state: a hero / preset job can later re-develop exactly this view (ART §1), and
    // Higgsfield reads the frame from this public URL (no second upload)
    const kept = await saveFrame(db, keys[0], frame, st, items).then(() => true, (e) => { console.warn(`[photo] frame not kept: ${e.message}`); return false; });
    try {
      const out = await develop({ req, auth, db, st, items, frame, frameSize, frameUrl: kept ? db.publicUrl(`frames/${keys[0]}.jpg`) : null, tier, session, ipH, t0, admin });
      const { usd: _usd, request_id: _rid, ...pub } = out; // cost and provider ids stay server-side
      return pub;
    } catch (err) { if (quota.subj) await refundQuota(db, quota.subj); throw err; }
  })();
  inflight.set(flightKey, job);
  try {
    const out = await job;
    return send(res, 200, { ...out, frame: flightKey });   // frame: the key of the kept input frame (hero / preset jobs)
  } catch (err) {
    const code = err instanceof GatewayError ? err.code : err?.status ? 'store_failed' : 'gateway';
    if (code !== 'quota') console.error(`[photo] develop failed (${code}): ${err?.message || err}`);
    console.info(JSON.stringify({ ev: 'photo.fail', code, ms: Date.now() - t0 }));
    return send(res, 200, { error: ['unavailable', 'rate_limited', 'timeout', 'quota', 'store_failed'].includes(code) ? code : 'gateway' });
  } finally { inflight.delete(flightKey); }
}

// Test hooks (not part of the HTTP contract).
export const _test = { cleanState, cleanItems, keyFor, buildPrompt, refImages, resetBreaker: resetBreakers, resetConfig: resetConfigForTests };
