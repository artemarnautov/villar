// GET /api/plate?time=day|sunset|evening[&w=2048] — the photographic window backplate (read-only). Owner: photo.
//
// One real-looking, wide (21:9) view from a high floor in Dubai Marina per time of day, cached in Supabase Storage
// (bucket `photos`, plates/v1/…). This endpoint NEVER generates (docs/ART.md: nothing is generated without a place in
// the product, and no visitor triggers a 4K job): plates come from the admin queue (public.photo_jobs, kinds
// `plate` · `plate-edit` · `mask`, run by /api/photo?run=1 → runPlateJob below). The day plate is Nano Banana Pro
// text-to-image (4K); sunset and evening are *edits* of the stored day plate, so the skyline is identical. A Postgres
// lock (photo_lock) and the pending row keep concurrent runs from generating twice; a failed or unfinished job never
// leaves a cached plate (only `status = ok` rows with a stored file are served).
//
// Response: { url, url2k, time, width, height, horizon, hfov, sun: { az, alt, K, color }, model, mask?, video: null }
//           | { pending: true, retryAfter } (another request is generating it) | { error }
//   url    — full plate (≤ 4096 px wide JPEG);  url2k — 2048 px rendition for phones / low tier (`w=2048` picks it as url)
//   horizon — fraction of the image height where the horizon sits (asked of the model: 0.5)
//   hfov    — intended horizontal field of view in degrees (asked of the model: ~100°)
//   sun     — the engine's sun for that time (lighting.js TOD): az from the window normal toward +X, alt, colour temperature
//   mask    — 8-bit PNG, white = sky (job kind `mask`): lets the engine split sky (infinity) from the city (a cylinder)
//           | { pending: true } while no plate is stored yet (queued, running, or not requested)
// Morning maps to day, golden to sunset. Kill switch: PHOTO_DISABLED (any value but 0/false) or PLATE_DISABLED.
// Models: PLATE_MODELS (default higgsfield:nano_banana_pro, then google/gemini-3-pro-image on the AI Gateway).
// Video loops (Veo 3.1 first = last frame) are specified in docs/PHOTOREAL.md; not generated here (see there).
import { randomBytes } from 'node:crypto';
import {
  env, modelConfig, pickModels, bestSize, usableProviders, tryModels, dryRun, maxUsd, costOf, clientIp, ipHash, send, sameOrigin, createLimiter, authToken,
  GatewayError, resumeImage, supa,
} from './_photo.js';
import { sniff, imageSize, decodePNG, downscale, encodeJPEG, encodeGrayPNG } from './_img.js';

export const PLATE_VERSION = 'v1';
const DEADLINE_MS = 55_000;
const LOCK_TTL_S = 120;
const PENDING_STALE_MS = 20 * 60_000;
const TIMES = { day: 'day', morning: 'day', sunset: 'sunset', golden: 'sunset', evening: 'evening' };
// lighting.js TOD (alt/az in degrees; az from the window normal +Z toward +X — looking out, +X is on the left)
export const SUN = {
  day: { az: -24, alt: 41, K: 5500 },
  sunset: { az: -47, alt: 9, K: 3500 },
  evening: { az: -60, alt: -5, K: 3000 },
};
const limited = createLimiter([{ windowMs: 60_000, max: 30 }]);

/** Approximate sRGB hex of a black-body colour temperature (Tanner Helland fit). */
export function kelvinHex(K) {
  const t = K / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

const COMMON = 'Wide 21:9 panorama, about 100 degrees horizontal field of view, a level camera at standing eye height: vertical lines stay vertical and the horizon lies exactly across the middle of the image. No window frame, mullions, glass reflections, interior, balcony railing or people in the foreground. Natural colours as a professional architectural photographer would capture them, crisp detail into the distance, real atmospheric haze growing with distance. No text, no watermark.';
export const PLATE_PROMPTS = {
  day: `A real photograph, not a render: the view straight out of a floor-to-ceiling window on the 40th floor of a residential tower in Dubai Marina, Dubai. In front: the marina water with moored yachts and the palm-lined promenade far below; around it, glass and stone residential towers of many different heights, shapes and colours — tapered, stepped and twisted crowns, balconies, rooftop plant — the nearest about 150 metres away; behind them the dense city fading into warm sandy haze, and a strip of the sea on the right toward the horizon. Clear midday sky, deep blue at the top paling to a soft haze at the horizon; the sun high to the upper right, outside the frame, lighting the right-facing facades. ${COMMON}`,
  sunset: `Edit this photograph. Keep every building exactly: its position, size, shape and silhouette; keep the water, the promenade, the horizon, the camera and the framing unchanged. Change only the time of day to golden-hour sunset: the sun low on the right near the horizon, just outside the right edge; warm amber light raking across the right-facing facades with long soft shadows; the sky glowing amber and peach near the horizon on the right, fading to soft blue at the top; the glass towers reflecting the sunset; slightly warmer haze. ${COMMON}`,
  evening: `Edit this photograph. Keep every building exactly: its position, size, shape and silhouette; keep the water, the promenade, the horizon, the camera and the framing unchanged. Change only the time of day to blue hour, about 30 minutes after sunset: a deep blue sky with a faint warm afterglow low on the right; many apartment windows lit, a natural mix of warm and cool interiors, some dark; street lights and the lit promenade, yachts with deck lights reflected in the marina water; no stars and no moon. ${COMMON}`,
  // ≤ 800 characters: for draft models with a short prompt limit (z-image)
  dayShort: 'A real photograph, not a render: the view straight out of a floor-to-ceiling window on the 40th floor of a tower in Dubai Marina. The marina water with yachts and the palm-lined promenade far below; glass and stone residential towers of many heights and shapes around it; the dense city fading into warm sandy haze, a strip of sea on the right. Clear midday sky, deep blue paling to haze at the horizon; the sun high to the upper right, outside the frame. Wide panorama, level camera, vertical lines vertical, the horizon exactly across the middle. No window frame, no glass reflections, no interior, no railing, no people, no text. Natural colours, crisp detail, real atmospheric haze.',
  mask: 'Edit this photograph. Replace the entire sky with a flat, pure green colour (#00FF00) everywhere the sky is visible, including between buildings. Keep every building, the water and everything else exactly as it is, with sharp edges. No other changes.',
};

const plateKey = (time, kind = '') => `plate:${PLATE_VERSION}:${time}${kind ? `:${kind}` : ''}`;

/** Encode a model output as the full plate (≤ 4096) + a 2048 rendition. JPEG outputs pass through. */
function renditions(bytes) {
  const t = sniff(bytes);
  if (t === 'image/png') {
    const img = decodePNG(bytes);
    const full = downscale(img, 4096, 4096), small = downscale(img, 2048, 2048);
    return { full: { bytes: encodeJPEG(full, 85), type: 'image/jpeg', width: full.width, height: full.height }, small: { bytes: encodeJPEG(small, 82), type: 'image/jpeg', width: small.width, height: small.height }, rgba: img };
  }
  const s = imageSize(bytes) || {};
  const one = { bytes, type: t || 'image/jpeg', width: s.width || 0, height: s.height || 0 };
  return { full: one, small: one, rgba: null };
}

/** Green-screen output → 8-bit sky mask (255 = sky), 2048 wide. */
function skyMask(bytes) {
  if (sniff(bytes) !== 'image/png') return null;
  const img = downscale(decodePNG(bytes), 2048, 2048);
  const { width: w, height: h, data } = img;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const k = (g - Math.max(r, b)) / 255;              // greenness: 1 on #00FF00
    m[i] = Math.round(255 * Math.max(0, Math.min(1, (k - 0.25) / 0.35)));
  }
  return { bytes: encodeGrayPNG(w, h, m), width: w, height: h };
}

async function readRows(db, keys, { pending = false } = {}) {
  const rows = await db.rows(keys);
  return new Map(rows.filter((r) => r.status === 'ok' || (pending && r.status === 'pending')).map((r) => [r.key, r]));
}
const fresh = (r) => r && r.status === 'pending' && Date.now() - Date.parse(r.updated_at || 0) < PENDING_STALE_MS;

function answer(db, time, rows, { small = false } = {}) {
  const full = rows.get(plateKey(time)), two = rows.get(plateKey(time, '2k')), mask = rows.get(plateKey('day', 'mask'));
  if (!full) return null;
  const sun = SUN[time];
  const url = db.publicUrl(full.path), url2k = two ? db.publicUrl(two.path) : url;
  return {
    url: small ? url2k : url, url2k, time, width: small && two ? two.width : full.width, height: small && two ? two.height : full.height,
    horizon: 0.5, hfov: 100, sun: { ...sun, color: kelvinHex(sun.K) }, model: full.model,
    ...(mask ? { mask: db.publicUrl(mask.path) } : {}), video: null,
  };
}

/** Store a finished plate: full + 2K renditions, index rows, cost line. `usd`: the provider's estimate when known. */
async function finishPlate(db, { time, model, bytes, ms, usd = NaN, requestId = null, size = '4K', aspect = '21:9' }) {
  const r = renditions(bytes);
  const rand = randomBytes(4).toString('hex');            // a new name per generation: CDNs never serve an old plate
  const pathFull = `plates/${PLATE_VERSION}/${time}-${rand}.jpg`;
  const path2k = `plates/${PLATE_VERSION}/${time}-2k-${rand}.jpg`;
  await db.put(pathFull, r.full.bytes, r.full.type);
  if (r.small !== r.full) await db.put(path2k, r.small.bytes, r.small.type);
  const hasEst = Number.isFinite(usd);
  const cost = hasEst ? usd : costOf(model, size);
  const base = { kind: 'plate', source: 'plate', status: 'ok', model: model.id, provider: model.provider, request_id: requestId, prompt_version: PLATE_VERSION, time_of_day: time, size, aspect, ms, refs: 0, updated_at: new Date().toISOString() };
  await db.upsertRow({ ...base, key: plateKey(time), path: pathFull, width: r.full.width, height: r.full.height, bytes: r.full.bytes.length, cost_usd: cost });
  await db.upsertRow({ ...base, key: plateKey(time, '2k'), path: r.small !== r.full ? path2k : pathFull, width: r.small.width, height: r.small.height, bytes: r.small.bytes.length, cost_usd: 0 });
  console.info(JSON.stringify({ ev: 'plate.gen', time, model: model.id, provider: model.provider, usd: cost, est: hasEst ? false : !!model.estimate, ms, w: r.full.width, h: r.full.height, bytes: r.full.bytes.length }));
}

/** The models of a plate job and the call options for each (per-model size and aspect; the day plate is text-to-image). */
function platePlan({ req, auth, time, dayUrl, params = {}, t0 }) {
  const want = ['1K', '2K', '4K'].includes(params.resolution) ? params.resolution : '4K';
  let models = pickModels('plate', usableProviders(req), params.model);
  models = time === 'day' ? models.filter((m) => !m.editOnly) : models.filter((m) => !m.t2iOnly);
  const images = time === 'day' ? [] : [{ url: dayUrl, label: 'The photograph to edit:' }];
  const seed = Number.isInteger(params.seed) ? params.seed : 7;
  const limit = Number.isFinite(Number(params.maxUsd)) && Number(params.maxUsd) > 0 ? Math.min(5, Number(params.maxUsd)) : maxUsd(false);
  const makeOpts = (model, n) => (n > 0 ? null : {
    auth, prompt: time === 'day' && model.maxPrompt && PLATE_PROMPTS.day.length > model.maxPrompt ? PLATE_PROMPTS.dayShort : PLATE_PROMPTS[time],
    images, aspectRatio: '21:9', imageSize: bestSize(model, want), quality: typeof params.quality === 'string' ? params.quality : null,
    timeoutMs: Math.max(5000, Math.min(50_000, DEADLINE_MS - (Date.now() - t0) - 3000)), deadlineAt: t0 + DEADLINE_MS - 6000,
    idempotencyKey: `plate-${PLATE_VERSION}-${time}-${model.id.replace(/[^a-z0-9]/gi, '')}-${Math.floor(Date.now() / 600_000)}`.slice(0, 64), seed, maxCost: limit,
  });
  return { models, makeOpts, want };
}

/** Submit (and, when fast enough, finish) one plate. Returns { done, model, usd, requestId } | { pending, … }. */
async function generate({ db, auth, req, time, dayUrl, t0, params = {}, trace = [] }) {
  const { models, makeOpts, want } = platePlan({ req, auth, time, dayUrl, params, t0 });
  if (!models.length) throw new GatewayError('unavailable', `plate: ${params.model ? `model ${params.model} is not available` : 'no model available'}`);
  if (env('PHOTO_PROVIDER') === 'stub') {
    await finishPlate(db, { time, model: models[0], bytes: Buffer.from(encodeJPEG({ width: 64, height: 28, data: new Uint8Array(64 * 28 * 4).fill(200) }, 80)), ms: 0 });
    return { done: true, model: models[0].id };
  }
  const t1 = Date.now();
  const { model, out } = await tryModels(models, makeOpts, { trace, deadlineAt: t0 + DEADLINE_MS, minLeftMs: 12_000 });
  const size = bestSize(model, want);
  if (out.pending) {
    await db.upsertRow({ key: plateKey(time), path: null, kind: 'plate', source: 'plate', status: 'pending', model: model.id, provider: model.provider, request_id: out.pending.requestId, prompt_version: PLATE_VERSION, time_of_day: time, size, aspect: '21:9', cost_usd: Number.isFinite(out.pending.estimate) ? out.pending.estimate : null, updated_at: new Date().toISOString() });
    return { pending: true, model: model.id, usd: out.pending.estimate ?? null, requestId: out.pending.requestId };
  }
  await finishPlate(db, { time, model, bytes: out.bytes, ms: Date.now() - t1, usd: out.estimate, requestId: out.requestId || null, size });
  return { done: true, model: model.id, usd: out.estimate ?? null, requestId: out.requestId || null };
}

/** A plate job submitted earlier (poll or webhook): finish it, or report it still running. */
export async function completePlate(db, row) {
  const time = row.time_of_day;
  if (!TIMES[time] || row.status !== 'pending' || !row.request_id) return { error: 'gateway' };
  if (!fresh(row)) { await db.upsertRow({ key: row.key, path: null, status: 'failed', model: row.model, prompt_version: PLATE_VERSION, updated_at: new Date().toISOString() }); return { error: 'gateway' }; }
  const model = modelConfig(row.model);
  let out;
  try { out = await resumeImage(model, row.request_id); }
  catch (err) {
    if (err instanceof GatewayError && (err.code === 'timeout' || err.code === 'busy')) return { pending: true };
    await db.upsertRow({ key: row.key, path: null, status: 'failed', model: row.model, prompt_version: PLATE_VERSION, updated_at: new Date().toISOString() });
    return { error: 'gateway' };
  }
  if (out.pending) return { pending: true };
  await finishPlate(db, { time, model, bytes: out.bytes, ms: Date.now() - Date.parse(row.updated_at || Date.now()), usd: row.cost_usd == null ? NaN : Number(row.cost_usd), requestId: row.request_id, size: row.size || '4K' });
  return { done: true };
}


/** Hold the lock for `key` while running `fn`; null when someone else holds it. */
async function withLock(db, key, fn) {
  const owner = Math.random().toString(36).slice(2, 14);
  let got = false;
  try { got = (await db.rpc('photo_lock', { p_key: key, p_owner: owner, p_ttl_seconds: LOCK_TTL_S })) === true; }
  catch (e) { console.error(`[plate] lock failed: ${e.message}`); throw new GatewayError('store_failed', e.message); }
  if (!got) return null;
  try { return await fn(); } finally { try { await db.rpc('photo_unlock', { p_key: key, p_owner: owner }); } catch { /* expires by itself */ } }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' });
  const q = req.query && Object.keys(req.query).length ? req.query : Object.fromEntries(new URL(req.url || '/', 'http://x').searchParams);
  const time = TIMES[String(q.time || '')];
  if (!time) return send(res, 400, { error: 'bad_request' });
  const small = String(q.w || '') === '2048';
  const ks = env('PHOTO_DISABLED').toLowerCase();
  if ((ks && ks !== '0' && ks !== 'false') || env('PLATE_DISABLED')) return send(res, 200, { error: 'disabled' });
  if (limited(ipHash(clientIp(req)))) return send(res, 200, { error: 'rate_limited' });
  const db = supa();
  if (!db) return send(res, 200, { error: 'not_configured' });
  let rows;
  try { rows = await readRows(db, [plateKey(time), plateKey(time, '2k'), plateKey('day', 'mask')]); }
  catch (e) { console.error(`[plate] read failed: ${e.message}`); return send(res, 200, { error: 'store_failed' }); }
  const out = answer(db, time, rows, { small });
  return out ? send(res, 200, out, { cache: 'public, max-age=300, s-maxage=3600' }) : send(res, 200, { pending: true, retryAfter: 600 });
}

// ---------------------------------------------------------------------------------------------- queue jobs
/**
 * One step of a queued plate job (kinds `plate` {time:'day'}, `plate-edit` {time:'sunset'|'evening'}, `mask`).
 * Returns { done, result } | { pending } (the provider job is still running: the queue re-claims it later) |
 * throws (the job fails; nothing is cached).
 */
/**
 * One step of a queued plate job (kinds `plate` {time:'day'}, `plate-edit` {time:'sunset'|'evening'}, `mask`).
 * Optional params: model (exactly this model, no substitute), resolution '1K'|'2K'|'4K' (default 4K → the best the
 * model has), quality, seed, maxUsd, dry: true (only the estimates), replace: true (generate again over a stored one).
 * Returns { done, result, cost } | { pending } (the provider job is still running: the queue re-claims it later) |
 * throws (the job fails; nothing is cached).
 */
export async function runPlateJob(db, job, { req, t0 = Date.now(), trace = [] } = {}) {
  const p = job.params || {};
  const auth = env('PHOTO_PROVIDER') === 'stub' ? { token: 'stub', kind: 'stub' } : authToken(req);
  if (job.kind === 'mask') {
    const rows = await readRows(db, [plateKey('day'), plateKey('day', 'mask')]);
    if (rows.has(plateKey('day', 'mask')) && !p.replace && !p.dry) return { done: true, result: { url: db.publicUrl(rows.get(plateKey('day', 'mask')).path) }, cost: 0 };
    if (!rows.has(plateKey('day'))) throw new GatewayError('rejected', 'mask: the day plate is not stored yet (run the plate job first)');
    const dayUrl = db.publicUrl(rows.get(plateKey('day')).path);
    const models = pickModels('plate', usableProviders(req), p.model).filter((m) => !m.t2iOnly);
    const makeOpts = (model, n) => (n > 0 ? null : { auth, prompt: PLATE_PROMPTS.mask, images: [{ url: dayUrl, label: 'The photograph to edit:' }], aspectRatio: '21:9', imageSize: bestSize(model, '2K'), timeoutMs: Math.max(5000, Math.min(45_000, DEADLINE_MS - (Date.now() - t0) - 3000)), deadlineAt: t0 + DEADLINE_MS - 5000, maxCost: maxUsd(false) });
    if (p.dry === true) return { done: true, result: { dry: true, estimates: await dryRun(models, makeOpts) }, cost: 0 };
    const got = await withLock(db, plateKey('day', 'mask'), async () => {
      const { model, out } = await tryModels(models, makeOpts, { trace, deadlineAt: t0 + DEADLINE_MS });
      if (out.pending) throw new GatewayError('timeout', 'mask: still running (queue the job again)');
      const m = skyMask(out.bytes);
      if (!m) throw new GatewayError('empty', `mask: ${model.id} did not return a PNG`);
      const path = `plates/${PLATE_VERSION}/day-sky-mask-${randomBytes(4).toString('hex')}.png`;
      await db.put(path, m.bytes, 'image/png');
      const usd = Number.isFinite(out.estimate) ? out.estimate : costOf(model, bestSize(model, '2K'));
      await db.upsertRow({ key: plateKey('day', 'mask'), path, kind: 'plate-mask', source: 'plate', status: 'ok', model: model.id, provider: model.provider, request_id: out.requestId || null, prompt_version: PLATE_VERSION, time_of_day: 'day', size: bestSize(model, '2K'), aspect: '21:9', width: m.width, height: m.height, bytes: m.bytes.length, cost_usd: usd, refs: 0, updated_at: new Date().toISOString() });
      console.info(JSON.stringify({ ev: 'plate.mask', model: model.id, usd }));
      return { url: db.publicUrl(path), model: model.id, usd, request_id: out.requestId || null };
    });
    if (!got) return { pending: true, result: { locked: true } };
    return { done: true, result: got, cost: got.usd };
  }
  const time = job.kind === 'plate' ? 'day' : TIMES[String(p.time || '')];
  if (!time || (job.kind === 'plate-edit' && time === 'day')) throw new GatewayError('rejected', `bad params.time for ${job.kind}`);
  const all = await readRows(db, [plateKey(time), plateKey('day')], { pending: true });
  const cur = all.get(plateKey(time));
  const day = all.get(plateKey('day'));
  const dayUrl = time === 'day' ? null : day?.status === 'ok' ? db.publicUrl(day.path) : null;
  if (p.dry === true) {
    const plan = platePlan({ req, auth, time, dayUrl: dayUrl || 'https://example.com/day-plate.jpg', params: p, t0 });
    return { done: true, result: { dry: true, time, estimates: await dryRun(plan.models, plan.makeOpts), ...(time !== 'day' && !dayUrl ? { note: 'the day plate is not stored yet: estimated with a placeholder image URL' } : {}) }, cost: 0 };
  }
  const describe = (r) => ({ url: db.publicUrl(r.path), time, model: r.model, width: r.width, height: r.height, usd: r.cost_usd == null ? null : Number(r.cost_usd), request_id: r.request_id || null });
  const mine = !!job.result?.request_id && cur?.request_id === job.result.request_id; // this job already produced it
  if (cur?.status === 'ok' && (!p.replace || mine)) return { done: true, result: describe(cur), cost: mine ? Number(cur.cost_usd) || 0 : 0 };
  if (fresh(cur)) {
    const out = await completePlate(db, cur);
    if (out.pending) return { pending: true, result: { request_id: cur.request_id, model: cur.model, estimate: cur.cost_usd == null ? null : Number(cur.cost_usd) } };
    if (out.error) throw new GatewayError('gateway', `${time}: the provider job ${String(cur.request_id).slice(0, 8)} (${cur.model}) failed`);
  } else {
    if (time !== 'day' && !dayUrl) throw new GatewayError('rejected', `${time}: the day plate is not stored yet (run the plate job first)`);
    const got = await withLock(db, plateKey(time), () => generate({ db, auth, req, time, dayUrl, t0, params: p, trace }));
    if (!got) return { pending: true, result: { locked: true } };
    if (got.pending) return { pending: true, result: { submitted: true, model: got.model, estimate: got.usd, request_id: got.requestId } };
  }
  const done = (await readRows(db, [plateKey(time)])).get(plateKey(time));
  if (!done) throw new GatewayError('gateway', `${time}: not stored`);
  return { done: true, result: describe(done), cost: done.cost_usd == null ? null : Number(done.cost_usd) };
}

export const _test = { kelvinHex, renditions, skyMask, plateKey };
export { TIMES as PLATE_TIMES };
