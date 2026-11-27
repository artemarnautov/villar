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
  env, modelList, modelConfig, providersAvailable, costOf, clientIp, ipHash, send, sameOrigin, createLimiter, authToken,
  GatewayError, isFatalGateway, generateImage, resumeImage, supa,
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

/** Store a finished plate: full + 2K renditions, index rows, cost line. */
async function finishPlate(db, { time, model, bytes, ms }) {
  const r = renditions(bytes);
  const rand = randomBytes(4).toString('hex');            // a new name per generation: CDNs never serve an old plate
  const pathFull = `plates/${PLATE_VERSION}/${time}-${rand}.jpg`;
  const path2k = `plates/${PLATE_VERSION}/${time}-2k-${rand}.jpg`;
  await db.put(pathFull, r.full.bytes, r.full.type);
  if (r.small !== r.full) await db.put(path2k, r.small.bytes, r.small.type);
  const usd = costOf(model, '4K');
  const base = { kind: 'plate', source: 'plate', status: 'ok', model: model.id, provider: model.provider, prompt_version: PLATE_VERSION, time_of_day: time, size: '4K', aspect: '21:9', ms, refs: 0, updated_at: new Date().toISOString() };
  await db.upsertRow({ ...base, key: plateKey(time), path: pathFull, width: r.full.width, height: r.full.height, bytes: r.full.bytes.length, cost_usd: usd });
  await db.upsertRow({ ...base, key: plateKey(time, '2k'), path: r.small !== r.full ? path2k : pathFull, width: r.small.width, height: r.small.height, bytes: r.small.bytes.length, cost_usd: 0 });
  console.info(JSON.stringify({ ev: 'plate.gen', time, model: model.id, provider: model.provider, usd, est: !!model.estimate, ms, w: r.full.width, h: r.full.height, bytes: r.full.bytes.length }));
}

/** Submit (and, when fast enough, finish) one plate; providers in PLATE_MODELS order. Returns { done } | { pending }. */
async function generate({ db, auth, req, time, dayUrl, t0 }) {
  const avail = providersAvailable(req);
  const models = modelList('plate', avail);
  if (!models.length) throw new GatewayError('unavailable', 'plate: no provider available');
  const skip = new Set(); let last = null;
  for (const model of models) {
    if (skip.has(model.provider)) continue;
    if (DEADLINE_MS - (Date.now() - t0) < 12_000) break;
    const images = time === 'day' ? [] : [{ url: dayUrl, label: 'The photograph to edit:' }];
    const t1 = Date.now();
    try {
      const out = env('PHOTO_PROVIDER') === 'stub'
        ? { bytes: Buffer.from(encodeJPEG({ width: 64, height: 28, data: new Uint8Array(64 * 28 * 4).fill(200) }, 80)) }
        : await generateImage({ auth, model, prompt: PLATE_PROMPTS[time], images, aspectRatio: '21:9', imageSize: '4K', timeoutMs: Math.min(50_000, DEADLINE_MS - (Date.now() - t0) - 3000), deadlineAt: t0 + DEADLINE_MS - 6000, idempotencyKey: `plate-${PLATE_VERSION}-${time}-${Math.floor(Date.now() / 600_000)}` });
      if (out.pending) {
        await db.upsertRow({ key: plateKey(time), path: null, kind: 'plate', source: 'plate', status: 'pending', model: model.id, provider: model.provider, request_id: out.pending.requestId, prompt_version: PLATE_VERSION, time_of_day: time, size: '4K', aspect: '21:9', updated_at: new Date().toISOString() });
        return { pending: true };
      }
      await finishPlate(db, { time, model, bytes: out.bytes, ms: Date.now() - t1 });
      return { done: true };
    } catch (err) {
      last = err;
      console.warn(`[plate] ${time} ${model.id} failed: ${err?.message || err}`);
      if (isFatalGateway(err)) skip.add(err.provider || model.provider);
    }
  }
  throw last || new GatewayError('gateway', 'plate: no model succeeded');
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
  await finishPlate(db, { time, model, bytes: out.bytes, ms: Date.now() - Date.parse(row.updated_at || Date.now()) });
  return { done: true };
}

async function generateMask({ db, auth, dayUrl, model, t0 }) {
  const t1 = Date.now();
  const out = await generateImage({ auth, model, prompt: PLATE_PROMPTS.mask, images: [{ url: dayUrl, label: 'The photograph to edit:' }], aspectRatio: '21:9', imageSize: '2K', timeoutMs: Math.min(45_000, DEADLINE_MS - (Date.now() - t0) - 3000), deadlineAt: t0 + DEADLINE_MS - 5000 });
  if (out.pending) throw new GatewayError('timeout', 'mask: still running (the next queue run retries)');
  const m = skyMask(out.bytes);
  if (!m) throw new GatewayError('empty', 'mask: model did not return a PNG');
  const path = `plates/${PLATE_VERSION}/day-sky-mask-${randomBytes(4).toString('hex')}.png`;
  await db.put(path, m.bytes, 'image/png');
  const usd = costOf(model, '2K');
  await db.upsertRow({ key: plateKey('day', 'mask'), path, kind: 'plate-mask', source: 'plate', status: 'ok', model: model.id, prompt_version: PLATE_VERSION, time_of_day: 'day', size: '2K', aspect: '21:9', width: m.width, height: m.height, bytes: m.bytes.length, ms: Date.now() - t1, cost_usd: usd, refs: 0, updated_at: new Date().toISOString() });
  console.info(JSON.stringify({ ev: 'plate.mask', model: model.id, usd, ms: Date.now() - t1 }));
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
export async function runPlateJob(db, job, { req, t0 = Date.now() } = {}) {
  const auth = env('PHOTO_PROVIDER') === 'stub' ? { token: 'stub', kind: 'stub' } : authToken(req);
  const avail = providersAvailable(req);
  if (!avail.higgsfield && !avail.gateway && env('PHOTO_PROVIDER') !== 'stub') throw new GatewayError('unavailable', 'no provider configured');
  if (job.kind === 'mask') {
    const rows = await readRows(db, [plateKey('day'), plateKey('day', 'mask')]);
    if (rows.has(plateKey('day', 'mask'))) return { done: true, result: { url: db.publicUrl(rows.get(plateKey('day', 'mask')).path) } };
    if (!rows.has(plateKey('day'))) throw new GatewayError('rejected', 'mask: the day plate is not stored yet (run the plate job first)');
    const model = modelList('plate', avail).find((m) => m.provider === 'gateway') || modelList('plate', avail)[0];
    await withLock(db, plateKey('day', 'mask'), () => generateMask({ db, auth, dayUrl: db.publicUrl(rows.get(plateKey('day')).path), model, t0 }));
    const after = await readRows(db, [plateKey('day', 'mask')]);
    const m = after.get(plateKey('day', 'mask'));
    if (!m) throw new GatewayError('gateway', 'mask: not stored');
    return { done: true, result: { url: db.publicUrl(m.path) }, cost: costOf(model, '2K') };
  }
  const time = job.kind === 'plate' ? 'day' : TIMES[String(job.params?.time || '')];
  if (!time || (job.kind === 'plate-edit' && time === 'day')) throw new GatewayError('rejected', `bad params.time for ${job.kind}`);
  const all = await readRows(db, [plateKey(time), plateKey('day')], { pending: true });
  const cur = all.get(plateKey(time));
  if (cur?.status === 'ok') return { done: true, result: { url: db.publicUrl(cur.path), time, model: cur.model }, cost: 0 };
  if (fresh(cur)) {
    const out = await completePlate(db, cur);
    if (out.pending) return { pending: true, result: { request_id: cur.request_id, model: cur.model } };
    if (out.error) throw new GatewayError('gateway', `${time}: the provider job failed`);
  } else {
    const day = all.get(plateKey('day'));
    if (time !== 'day' && day?.status !== 'ok') throw new GatewayError('rejected', `${time}: the day plate is not stored yet (run the plate job first)`);
    const dayUrl = time === 'day' ? null : db.publicUrl(day.path);
    const got = await withLock(db, plateKey(time), () => generate({ db, auth, req, time, dayUrl, t0 }));
    if (!got) return { pending: true, result: { locked: true } };
    if (got.pending) return { pending: true, result: { submitted: true } };
  }
  const done = (await readRows(db, [plateKey(time)])).get(plateKey(time));
  if (!done) throw new GatewayError('gateway', `${time}: not stored`);
  return { done: true, result: { url: db.publicUrl(done.path), time, model: done.model, width: done.width, height: done.height }, cost: costOf(modelConfig(done.model), '4K') };
}

export const _test = { kelvinHex, renditions, skyMask, plateKey };
export { TIMES as PLATE_TIMES };
