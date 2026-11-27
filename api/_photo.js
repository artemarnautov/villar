// Shared server code for api/photo.js and api/plate.js ("Live → Photo"). Owner: photo.
//
//  • Models: one ordered, provider-agnostic list per tier (env PHOTO_MODELS / PHOTO_HERO_MODELS / PLATE_MODELS).
//    An id `higgsfield:<model>` goes to the Higgsfield API (primary, async: submit → request_id → poll / webhook);
//    any other id is an AI Gateway model (fallback): 'chat' adapter (Nano Banana via /v1/chat/completions with
//    modalities ['text','image']) or 'edits' (image-only models such as FLUX.2: /v1/images/edits, JSON body).
//    A provider without credentials is skipped; a provider that says "no balance / bad key" is skipped for 10 min.
//  • Higgsfield auth: `Authorization: Key <id>:<secret>` from HIGGSFIELD_KEY (see hfCredentials for fallbacks).
//  • Gateway auth: the project's OIDC token (x-vercel-oidc-token header, else VERCEL_OIDC_TOKEN), else
//    AI_GATEWAY_API_KEY — the same order as api/assistant.js.
//  • Storage: Supabase Storage bucket `photos` (public read) + table public.photo_renders (index, cost log),
//    RPCs photo_take_quota / photo_refund_quota / photo_reject / photo_lock / photo_unlock (db/photos.sql).
//    SUPABASE_KEY is the project's secret key (sb_secret_…, Vercel env), the same one api/lead.js uses.
// No npm dependencies; runs as native ESM and when Vercel transpiles to CommonJS (no import.meta, no top-level await).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const env = (k) => (process.env[k] || '').trim();
export const PROMPT_VERSION = 'v1';     // docs/ART.md §2 skeleton. Bump only after the 3-canonical-frame test (ART §1)
export const KEY_VERSION = 'k1';        // bump to invalidate every cached photo (e.g. after a render overhaul)
export const BUCKET = 'photos';
const SUPABASE_URL = 'https://hdhwkvbecuzzrugogutd.supabase.co'; // same project as api/lead.js
export const GATEWAY_BASE = () => (env('AI_GATEWAY_BASE_URL') || 'https://ai-gateway.vercel.sh/v1').replace(/\/$/, '');

// ---------------------------------------------------------------------------------------------- models
// Gemini image models accept these output aspect ratios; the client pads its frame to the nearest one.
export const GEMINI_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
// cost: USD per output image by size tier. Gateway: AI Gateway catalog, 27 Nov 2026. FLUX.2 and every Higgsfield
// model: estimates (`estimate: true`) — Higgsfield bills its own prepaid balance and publishes no per-model API price
// in its docs; set real numbers with env PHOTO_COST='{"higgsfield:nano_banana_2_1":{"2K":0.06}}'.
export const MODELS = {
  // --- Higgsfield (primary). Endpoint paths are NOT in the public docs index (docs.higgsfield.ai, 27 Nov 2026): the
  // defaults follow the documented `{vendor}/{model}/{workflow}` pattern (e.g. alibaba/qwen-image-3/edit) and must be
  // confirmed in console.higgsfield.ai → model → API. Override: HIGGSFIELD_MODELS='{"nano_banana_2_1":{"path":"…","t2i":"…","images":"image_urls"}}'.
  'higgsfield:nano_banana_2_1': { provider: 'higgsfield', hf: 'nano_banana_2_1', label: 'Nano Banana 2.1 (Higgsfield)', path: 'google/nano-banana-2.1/edit', t2i: 'google/nano-banana-2.1/text-to-image', images: 'image_urls', maxRefs: 13, seed: true, sizes: ['1K', '2K', '4K'], aspects: ['auto', ...GEMINI_ASPECTS, '4:1', '1:4', '8:1', '1:8'], cost: { '1K': 0.067, '2K': 0.101, '4K': 0.151 }, estimate: true },
  'higgsfield:nano_banana_pro': { provider: 'higgsfield', hf: 'nano_banana_pro', label: 'Nano Banana Pro (Higgsfield)', path: 'google/nano-banana-pro/edit', t2i: 'google/nano-banana-pro/text-to-image', images: 'image_urls', maxRefs: 13, seed: false, sizes: ['1K', '2K', '4K'], aspects: GEMINI_ASPECTS, cost: { '1K': 0.1344, '2K': 0.1344, '4K': 0.24 }, estimate: true },
  'higgsfield:seedream_5_5': { provider: 'higgsfield', hf: 'seedream_5_5', label: 'Seedream 5.5 (Higgsfield)', path: 'bytedance/seedream-5.5/edit', t2i: 'bytedance/seedream-5.5/text-to-image', images: 'image_urls', maxRefs: 9, seed: false, sizes: ['1K', '2K', '4K'], aspects: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], extra: { background: 'opaque' }, cost: { '1K': 0.035, '2K': 0.035, '4K': 0.06 }, estimate: true },
  'higgsfield:gpt_image_2_6': { provider: 'higgsfield', hf: 'gpt_image_2_6', label: 'GPT Image 2.6 (Higgsfield)', path: 'openai/gpt-image-2.6/edit', t2i: 'openai/gpt-image-2.6/text-to-image', images: 'image_urls', maxRefs: 15, seed: false, sizes: ['1K', '2K'], aspects: ['auto', '1:1', '3:2', '2:3'], cost: { '1K': 0.08, '2K': 0.17 }, estimate: true },
  // --- AI Gateway (fallback)
  'google/gemini-3.1-flash-image': { provider: 'gateway', label: 'Nano Banana 2', api: 'chat', maxRefs: 10, sizes: ['512', '1K', '2K', '4K'], cost: { 512: 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 }, aspects: GEMINI_ASPECTS },
  'google/gemini-3.1-flash-image-preview': { provider: 'gateway', label: 'Nano Banana 2 (preview id)', api: 'chat', maxRefs: 10, sizes: ['512', '1K', '2K', '4K'], cost: { 512: 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 }, aspects: GEMINI_ASPECTS },
  'google/gemini-3.1-flash-lite-image': { provider: 'gateway', label: 'Nano Banana 2 Lite', api: 'chat', maxRefs: 6, sizes: ['1K'], cost: { '1K': 0.034 }, aspects: GEMINI_ASPECTS },
  'google/gemini-3-pro-image': { provider: 'gateway', label: 'Nano Banana Pro', api: 'chat', maxRefs: 8, sizes: ['1K', '2K', '4K'], cost: { '1K': 0.1344, '2K': 0.1344, '4K': 0.24 }, aspects: GEMINI_ASPECTS },
  'bfl/flux-2-pro': { provider: 'gateway', label: 'FLUX.2 [pro]', api: 'edits', maxRefs: 4, sizes: ['1K', '2K'], cost: { '1K': 0.045, '2K': 0.09 }, aspects: null, estimate: true },
  'bfl/flux-2-max': { provider: 'gateway', label: 'FLUX.2 [max]', api: 'edits', maxRefs: 4, sizes: ['1K', '2K'], cost: { '1K': 0.08, '2K': 0.16 }, aspects: null, estimate: true },
};
const DEFAULTS = {
  default: ['higgsfield:nano_banana_2_1', 'google/gemini-3.1-flash-image', 'google/gemini-3.1-flash-image-preview'],
  hero: ['higgsfield:nano_banana_pro', 'google/gemini-3-pro-image', 'higgsfield:nano_banana_2_1', 'google/gemini-3.1-flash-image'],
  plate: ['higgsfield:nano_banana_pro', 'google/gemini-3-pro-image'],
};
const ID_RE = /^(?:higgsfield:[a-z0-9_]{2,40}|[a-z0-9-]+\/[a-zA-Z0-9._:-]+)$/;
const parseList = (s) => s.split(',').map((x) => x.trim()).filter((x) => ID_RE.test(x));
const jsonEnv = (k) => { try { const v = JSON.parse(env(k) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

// ---------------------------------------------------------------------------------------------- live config
// public.photo_config (name → jsonb value), managed by the coordinator from the database (no redeploy, no env):
//   visitors  true | false   may visitors generate? absent = false (env PHOTO_VISITORS=1 is the fallback when absent)
//   pilots    ["<session id>", …]   sessions that may generate while visitors is off
//   caps      { "perIp": 12, "global": 60 }          (fallback: PHOTO_DAILY_IP / PHOTO_DAILY_CAP)
//   ab        "higgsfield:seedream_5_5:0.2"          (fallback: PHOTO_AB)
//   cost      { "<model id>": { "2K": 0.06 } }       (merged over PHOTO_COST)
//   models    { "nano_banana_2_1": { "path": "…", "t2i": "…", "images": "image_urls" } }   (merged over HIGGSFIELD_MODELS)
// Read with a 30 s in-memory cache. A read error (or no table yet) means visitors off and no pilots; the last good
// overrides (caps, ab, cost, models) stay in use.
const CONFIG_TTL_MS = 30_000;
const SESSION_RE = /^[a-z0-9]{8,40}$/i;
const cfg = { at: 0, ok: false, visitors: false, pilots: new Set(), caps: null, ab: null, cost: {}, models: {}, names: [] };
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
export async function loadConfig(db, { force = false } = {}) {
  if (!force && Date.now() - cfg.at < CONFIG_TTL_MS) return cfg;
  cfg.at = Date.now();
  if (!db) { cfg.ok = false; cfg.visitors = false; cfg.pilots = new Set(); return cfg; }
  try {
    const rows = (await db.call('/rest/v1/photo_config?select=name,value&limit=50', { timeoutMs: 4000 })) || [];
    const m = new Map(rows.map((r) => [r.name, r.value]));
    cfg.ok = true;
    cfg.visitors = m.has('visitors') ? m.get('visitors') === true : env('PHOTO_VISITORS') === '1';
    cfg.pilots = new Set((Array.isArray(m.get('pilots')) ? m.get('pilots') : []).filter((x) => typeof x === 'string' && SESSION_RE.test(x)).slice(0, 200));
    const caps = obj(m.get('caps'));
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100000 ? Math.floor(Number(v)) : null);
    cfg.caps = caps ? { perIp: num(caps.perIp), global: num(caps.global) } : null;
    cfg.ab = typeof m.get('ab') === 'string' ? m.get('ab').trim() : null;
    cfg.cost = obj(m.get('cost')) || {};
    cfg.models = obj(m.get('models')) || {};
    cfg.names = ['caps', 'ab', 'cost', 'models'].filter((k) => m.has(k) && m.get(k) != null && (typeof m.get(k) !== 'object' || Object.keys(m.get(k)).length));
  } catch (e) {
    cfg.ok = false; cfg.visitors = false; cfg.pilots = new Set();
    console.warn(`[photo] config read failed (visitors off): ${e?.status || e?.message || e}`);
  }
  return cfg;
}
/** The current snapshot (call loadConfig first in a request). */
export const liveConfig = () => cfg;
/** May this session start a paid generation? */
export const mayGenerate = (session) => cfg.ok && (cfg.visitors === true || (!!session && cfg.pilots.has(session)));
export const dailyCaps = () => ({
  perIp: cfg.caps?.perIp ?? Number(env('PHOTO_DAILY_IP') || 12),      // ART §1: caps until launch
  global: cfg.caps?.global ?? Number(env('PHOTO_DAILY_CAP') || 60),
});
export function resetConfigForTests() { Object.assign(cfg, { at: 0, ok: false, visitors: false, pilots: new Set(), caps: null, ab: null, cost: {}, models: {}, names: [] }); }

/** Config of one model id (known table + env overrides; unknown ids get a generic config of their provider). */
export function modelConfig(id) {
  const base = MODELS[id] || (id.startsWith('higgsfield:')
    ? { provider: 'higgsfield', hf: id.slice(11), label: id, path: '', images: 'image_urls', maxRefs: 9, sizes: ['1K', '2K'], aspects: ['auto', ...GEMINI_ASPECTS], cost: {}, estimate: true }
    : { provider: 'gateway', label: id, api: /^bfl\//.test(id) ? 'edits' : 'chat', maxRefs: 4, sizes: ['1K', '2K'], cost: {}, aspects: GEMINI_ASPECTS, estimate: true });
  const m = { id, ...base };
  if (m.provider === 'higgsfield') {
    const o = { ...(jsonEnv('HIGGSFIELD_MODELS')[m.hf] || {}), ...(obj(cfg.models[m.hf]) || {}) }; // photo_config.models wins
    if (typeof o.path === 'string' && /^[a-z0-9._/-]{3,120}$/.test(o.path)) m.path = o.path;
    if (typeof o.t2i === 'string' && /^[a-z0-9._/-]{3,120}$/.test(o.t2i)) m.t2i = o.t2i;
    if (typeof o.images === 'string' && /^[a-z_]{3,40}$/.test(o.images)) m.images = o.images;
    if (o.extra && typeof o.extra === 'object') m.extra = { ...(m.extra || {}), ...o.extra };
  }
  const c = obj(cfg.cost[id]) || jsonEnv('PHOTO_COST')[id];
  if (c && typeof c === 'object') { m.cost = { ...m.cost, ...c }; m.estimate = false; }
  return m;
}

/** Which providers can be called right now (credentials present). */
export const providersAvailable = (req) => ({ higgsfield: !!hfAuth(), gateway: !!authToken(req) || env('PHOTO_PROVIDER') === 'stub' });

/** Ordered model configs for a tier ('default' | 'hero' | 'plate'), only those whose provider is available. */
export function modelList(tier = 'default', avail = null) {
  const raw = tier === 'hero' ? env('PHOTO_HERO_MODELS') : tier === 'plate' ? env('PLATE_MODELS') : env('PHOTO_MODELS');
  const ids = raw ? parseList(raw) : DEFAULTS[tier] || DEFAULTS.default;
  const list = ids.map(modelConfig);
  return avail ? list.filter((m) => avail[m.provider]) : list;
}
/** A/B: env PHOTO_AB="higgsfield:seedream_5_5:0.2" sends ~20 % of cache misses (stable per key) to that model first. */
export function abModel(key) {
  const m = (cfg.ab ?? env('PHOTO_AB')).match(/^((?:higgsfield:[a-z0-9_]{2,40})|(?:[a-z0-9-]+\/[a-zA-Z0-9._-]+)):(0?\.\d+|1(?:\.0+)?)$/);
  if (!m) return null;
  const share = Number(m[2]);
  const bucket = parseInt(key.slice(0, 8), 16) / 0xffffffff;
  return bucket < share ? m[1] : null;
}
export const costOf = (model, size) => {
  const c = model?.cost || {};
  return Number(c[size] ?? c['2K'] ?? c['1K'] ?? 0) || 0;
};

// ---------------------------------------------------------------------------------------------- request helpers
export const header = (req, name) => {
  const h = req.headers || {};
  if (typeof h.get === 'function') return h.get(name) || '';
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v || '';
};
export const clientIp = (req) => String(header(req, 'x-forwarded-for')).split(',')[0].trim() || header(req, 'x-real-ip') || req.socket?.remoteAddress || 'unknown';
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
/** Salted, truncated IP hash: rate limits and logs never store the raw address. */
export const ipHash = (ip) => sha256(`${env('PHOTO_SALT') || 'villar-photo'}|${ip}`).slice(0, 20);

export function send(res, status, body, { cache = 'no-store' } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

/** Same-origin browsers only (other sites may not spend the gateway budget). Requests without Origin pass. */
export function sameOrigin(req) {
  const origin = header(req, 'origin');
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

/** JSON body up to maxBytes (Vercel parses JSON itself when the content type says so). */
export async function readJson(req, maxBytes) {
  let b;
  try { b = req.body; } catch { return { error: 'bad_request' }; }
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) {
    // already parsed by the platform: still enforce the size cap on what we keep
    return JSON.stringify(b).length > maxBytes * 1.05 ? { error: 'too_large' } : { body: b };
  }
  let raw = '';
  if (typeof b === 'string') raw = b;
  else if (Buffer.isBuffer(b)) raw = b.toString('utf8');
  else if (req && typeof req.on === 'function') {
    raw = await new Promise((resolve) => {
      const chunks = []; let size = 0; let over = false;
      req.on('data', (c) => { size += c.length; if (size <= maxBytes) chunks.push(c); else over = true; });
      req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(null));
    });
    if (raw == null) return { error: 'too_large' };
  }
  if (raw.length > maxBytes) return { error: 'too_large' };
  try { return { body: JSON.parse(raw || '{}') }; } catch { return { error: 'bad_request' }; }
}

/** Sliding-window limiter: `limits` = [{ windowMs, max }]. */
export function createLimiter(limits) {
  const hits = new Map();
  const longest = Math.max(...limits.map((r) => r.windowMs));
  return function limited(id, now = Date.now()) {
    let rec = hits.get(id);
    if (!rec) { rec = []; hits.set(id, rec); }
    while (rec.length && now - rec[0] > longest) rec.shift();
    for (const r of limits) if (rec.filter((t) => now - t < r.windowMs).length >= r.max) return true;
    rec.push(now);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > longest) hits.delete(k);
    return false;
  };
}

export function authToken(req) {
  const oidc = header(req, 'x-vercel-oidc-token');
  if (oidc) return { token: oidc, kind: 'oidc-header' };
  if (process.env.VERCEL_OIDC_TOKEN) return { token: process.env.VERCEL_OIDC_TOKEN, kind: 'oidc-env' };
  if (process.env.AI_GATEWAY_API_KEY) return { token: process.env.AI_GATEWAY_API_KEY, kind: 'api-key' };
  return null;
}

// ---------------------------------------------------------------------------------------------- gateway
export class GatewayError extends Error {
  constructor(code, message, status = 0, provider = null) { super(message); this.code = code; this.status = status; this.provider = provider; }
}
/** No balance / no billing / bad key (or the account's queue is full): every model of that provider fails alike. */
export const isFatalGateway = (e) => e instanceof GatewayError && (e.code === 'unavailable' || e.code === 'rate_limited');

async function gatewayFetch(path, { auth, body, timeoutMs, model }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  let res;
  try {
    res = await fetch(`${GATEWAY_BASE()}${path}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 400); } catch { /* ignore */ }
      const s = res.status;
      const code = s === 401 || s === 402 || s === 403 || /billing|credit|payment|insufficient/i.test(detail) ? 'unavailable'
        : s === 429 ? 'rate_limited' : s === 404 ? 'no_model' : s === 400 || s === 422 ? 'rejected' : 'gateway';
      throw new GatewayError(code, `gateway HTTP ${s} (${auth.kind}, ${model}): ${detail}`, s, 'gateway');
    }
    return await res.json();
  } catch (err) {
    if (err instanceof GatewayError) throw err;
    if (err?.name === 'AbortError' || ctrl.signal.aborted) throw new GatewayError('timeout', `gateway timeout after ${timeoutMs} ms (${model})`, 0, 'gateway');
    throw new GatewayError('gateway', `gateway error (${model}): ${err?.message || err}`, 0, 'gateway');
  } finally { clearTimeout(timer); }
}

export const dataUrlBytes = (u) => {
  const m = typeof u === 'string' && u.match(/^data:([^;,]+);base64,(.*)$/s);
  return m ? Buffer.from(m[2], 'base64') : null;
};
export async function fetchBytes(url, timeoutMs = 15000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new GatewayError('gateway', `image fetch HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

/** First image of a chat completion: message.images[] (AI Gateway) or image parts inside message.content. */
export async function imageFromChat(data) {
  const msg = data?.choices?.[0]?.message || {};
  const cands = [];
  for (const im of msg.images || []) cands.push(im?.image_url?.url || im?.url);
  if (Array.isArray(msg.content)) for (const p of msg.content) if (p?.type === 'image_url' || p?.image_url) cands.push(p?.image_url?.url || p?.url);
  for (const u of cands.filter(Boolean)) {
    const b = dataUrlBytes(u) || (/^https:\/\//.test(u) ? await fetchBytes(u) : null);
    if (b?.length) return { bytes: b, text: typeof msg.content === 'string' ? msg.content.slice(0, 300) : '' };
  }
  return { bytes: null, text: typeof msg.content === 'string' ? msg.content.slice(0, 300) : '' };
}
export async function imageFromImages(data) {
  const d = data?.data?.[0] || {};
  if (d.b64_json) return { bytes: Buffer.from(d.b64_json, 'base64'), text: '' };
  if (d.url) return { bytes: dataUrlBytes(d.url) || (await fetchBytes(d.url)), text: '' };
  return { bytes: null, text: '' };
}

/**
 * One image generation / edit.
 *   images: [{ url, label }] — url is https or a data: URL; images[0] is the image to edit (if any).
 *   Higgsfield: waits until `deadlineAt` (epoch ms); if the job is still running returns { pending: { requestId } }.
 * Returns { bytes, text, usage } | { pending }.
 */
export async function generateImage(opts) {
  if (opts.model.provider === 'higgsfield') return hfGenerate(opts);
  return gatewayGenerate(opts);
}

async function gatewayGenerate({ auth, model, prompt, images = [], aspectRatio = null, imageSize = '2K', width = 0, height = 0, timeoutMs = 50000 }) {
  if (!auth) throw new GatewayError('unavailable', 'AI Gateway: no OIDC token / AI_GATEWAY_API_KEY', 0, 'gateway');
  if (model.api === 'edits') {
    const body = {
      model: model.id, prompt, n: 1, response_format: 'b64_json',
      ...(images.length ? { images: images.map((im) => ({ image_url: im.url })) } : {}),
      ...(width && height ? { size: `${Math.round(width / 16) * 16}x${Math.round(height / 16) * 16}` } : {}),
      providerOptions: { blackForestLabs: { outputFormat: 'jpeg', safetyTolerance: 2 } },
    };
    const data = await gatewayFetch(images.length ? '/images/edits' : '/images/generations', { auth, body, timeoutMs, model: model.id });
    const out = await imageFromImages(data);
    if (!out.bytes) throw new GatewayError('empty', `no image in ${model.id} response`, 0, 'gateway');
    return { ...out, usage: data?.usage || null };
  }
  // chat: text instruction, then each image preceded by its caption
  const content = [{ type: 'text', text: prompt }];
  images.forEach((im) => {
    if (im.label) content.push({ type: 'text', text: im.label });
    content.push({ type: 'image_url', image_url: { url: im.url } });
  });
  const google = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) } };
  const body = {
    model: model.id,
    modalities: ['text', 'image'],
    messages: [{ role: 'user', content }],
    temperature: 0.4,
    stream: false,
    providerOptions: { google, vertex: google },
  };
  const data = await gatewayFetch('/chat/completions', { auth, body, timeoutMs, model: model.id });
  const out = await imageFromChat(data);
  if (!out.bytes) throw new GatewayError('empty', `no image in ${model.id} response${out.text ? `: ${out.text.slice(0, 120)}` : ''}`, 0, 'gateway');
  return { ...out, usage: data?.usage || null };
}

// ---------------------------------------------------------------------------------------------- Higgsfield
// docs.higgsfield.ai: base https://api.higgsfield.ai · `Authorization: Key <id>:<secret>` · POST /{endpoint} with an
// `Idempotency-Key` → { request_id, status_url } · GET /requests/{id}/status → queued | in_progress | completed |
// failed | nsfw | canceled, images[].url · inputs are public HTTPS URLs (POST /files/generate-upload-url for our bytes)
// · errors: 401 bad key, 403 insufficient balance, 404 model, 400/422 validation, 423/503 not ready, 429 queue full ·
// failed and nsfw jobs are not charged · outputs are deleted after 7 days (we copy them to Supabase Storage).
export const HF_BASE = () => (env('HIGGSFIELD_BASE_URL') || 'https://api.higgsfield.ai').replace(/\/$/, '');
/**
 * Higgsfield credentials. Lookup order (values are never logged or echoed):
 *   HIGGSFIELD_KEY (the founder's Vercel variable) — `id:secret`, or a bare key (+ HIGGSFIELD_SECRET if set);
 *   HIGGSFIELD_API_KEY (+ HIGGSFIELD_API_SECRET); HF_API_KEY (+ HF_API_SECRET); HF_API_KEY_ID (+ HF_API_KEY_SECRET).
 * The documented header is `Authorization: Key <key_id>:<key_secret>`; a bare key is sent as `Key <key>`.
 */
export function hfCredentials() {
  const pairs = [['HIGGSFIELD_KEY', 'HIGGSFIELD_SECRET'], ['HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET'], ['HF_API_KEY', 'HF_API_SECRET'], ['HF_API_KEY_ID', 'HF_API_KEY_SECRET']];
  for (const [k, sName] of pairs) {
    const key = env(k);
    if (!key) continue;
    if (key.includes(':')) return { header: `Key ${key}`, source: k, pair: true };
    const sec = env(sName);
    if (sec) return { header: `Key ${key}:${sec}`, source: k, pair: true };
    return { header: `Key ${key}`, source: k, pair: false };
  }
  return null;
}
export const hfAuth = () => hfCredentials()?.header || null;

/** Free auth probe: the status of a request id that cannot exist. 401 = bad credentials; 404 = they work. */
export async function hfProbe() {
  const c = hfCredentials();
  if (!c) return { configured: false, authOk: null, status: null };
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${HF_BASE()}/requests/00000000-0000-4000-8000-000000000000/status`, { headers: { Authorization: c.header }, signal: ctrl.signal });
    const authOk = r.status === 401 || r.status === 403 ? false : r.status === 404 || r.ok ? true : null;
    return { configured: true, source: c.source, pair: c.pair, authOk, status: r.status, ...(authOk === false && !c.pair ? { hint: `${c.source} should be id:secret` } : {}) };
  } catch (e) {
    return { configured: true, source: c.source, pair: c.pair, authOk: null, status: e?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally { clearTimeout(t); }
}

async function hfFetch(path, { method = 'GET', body, headers = {}, timeoutMs = 15000, model = '' } = {}) {
  const auth = hfAuth();
  if (!auth) throw new GatewayError('unavailable', 'Higgsfield: HIGGSFIELD_KEY not set', 0, 'higgsfield');
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(path.startsWith('https://') ? path : `${HF_BASE()}${path}`, {
      method, signal: ctrl.signal,
      headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!r.ok) {
      const st = r.status;
      const detail = typeof json?.detail === 'string' ? json.detail : text.slice(0, 300);
      const code = st === 401 || st === 403 ? 'unavailable' : st === 404 ? 'no_model' : st === 400 || st === 422 ? 'rejected'
        : st === 429 ? 'busy' : 'gateway';
      const hint = st === 404 && method === 'POST' && model
        ? ` — endpoint path unknown to Higgsfield: copy the model's API path from console.higgsfield.ai and upsert photo_config name 'models' = {"${String(model).replace(/^higgsfield:/, '')}":{"path":"<vendor>/<model>/<workflow>","t2i":"…"}} (live within 30 s), or set the same JSON in env HIGGSFIELD_MODELS`
        : st === 401 ? ` — check ${hfCredentials()?.source || 'HIGGSFIELD_KEY'} (expected id:secret)` : st === 403 ? ' — insufficient balance: top up at console.higgsfield.ai' : '';
      throw new GatewayError(code, `Higgsfield HTTP ${st} ${method} ${path.split('?')[0]} (${model}): ${detail}${hint}`, st, 'higgsfield');
    }
    return json;
  } catch (err) {
    if (err instanceof GatewayError) throw err;
    if (err?.name === 'AbortError') throw new GatewayError('timeout', `Higgsfield timeout ${method} ${path.split('?')[0]}`, 0, 'higgsfield');
    throw new GatewayError('gateway', `Higgsfield error: ${err?.message || err}`, 0, 'higgsfield');
  } finally { clearTimeout(t); }
}
/** Upload bytes for use as an input (presigned PUT); returns the public URL. */
export async function hfUpload(bytes, type = 'image/jpeg') {
  const up = await hfFetch('/files/generate-upload-url', { method: 'POST', body: { content_type: type } });
  if (!up?.upload_url || !up?.public_url) throw new GatewayError('gateway', 'Higgsfield upload: no URL', 0, 'higgsfield');
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(up.upload_url, { method: 'PUT', body: bytes, headers: { ...(up.upload_headers || { 'Content-Type': type }) }, signal: ctrl.signal });
    if (!r.ok) throw new GatewayError('gateway', `Higgsfield upload PUT HTTP ${r.status}`, r.status, 'higgsfield');
  } finally { clearTimeout(t); }
  return up.public_url;
}
export const hfStatus = (requestId) => hfFetch(`/requests/${encodeURIComponent(requestId)}/status`, { timeoutMs: 10000 });
const HF_TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled']);
/** Poll until terminal or `deadlineAt`; returns the last status object. */
export async function hfWait(requestId, deadlineAt) {
  let delay = 700, st = null;
  for (;;) {
    st = await hfStatus(requestId);
    if (HF_TERMINAL.has(st?.status) || Date.now() + delay > deadlineAt) return st;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(2000, Math.round(delay * 1.35));
  }
}
/** A finished status → image bytes (or a typed error). */
export async function hfResult(st, model) {
  if (st?.status === 'completed') {
    const url = st.images?.[0]?.url || st.payload?.images?.[0]?.url;
    if (!url) throw new GatewayError('empty', `Higgsfield ${model.id}: completed without images`, 0, 'higgsfield');
    return { bytes: await fetchBytes(url, 30000), text: '' };
  }
  if (st?.status === 'nsfw') throw new GatewayError('nsfw', `Higgsfield ${model.id}: moderation (nsfw)`, 0, 'higgsfield');
  if (st?.status === 'failed' || st?.status === 'canceled') throw new GatewayError('gateway', `Higgsfield ${model.id}: ${st.status}${st.error ? `: ${String(st.error).slice(0, 200)}` : ''}`, 0, 'higgsfield');
  return null; // still queued / in progress
}

async function hfGenerate({ model, prompt, images = [], aspectRatio = null, imageSize = '2K', deadlineAt = Date.now() + 45000, idempotencyKey = null, webhook = null, seed = null }) {
  const path = images.length ? model.path : model.t2i || model.path;
  if (!path) throw new GatewayError('no_model', `Higgsfield ${model.id}: endpoint path unknown (set HIGGSFIELD_MODELS)`, 0, 'higgsfield');
  // our inline frame → a Higgsfield input URL; the product photos are already public URLs
  const urls = [];
  for (const im of images.slice(0, (model.maxRefs ?? 9) + 1)) {
    const b = dataUrlBytes(im.url);
    urls.push(b ? await hfUpload(b, 'image/jpeg') : im.url);
  }
  const aspects = model.aspects || [];
  const aspect = aspectRatio && aspects.includes(aspectRatio) ? aspectRatio : aspects.includes('auto') ? 'auto' : aspectRatio;
  const body = {
    prompt,
    ...(urls.length ? { [model.images || 'image_urls']: urls } : {}),
    ...(aspect ? { aspect_ratio: aspect } : {}),
    resolution: String(imageSize || '2K').toLowerCase(),
    ...(model.seed && Number.isFinite(seed) ? { seed } : {}),
    ...(model.extra || {}),
  };
  const q = webhook ? `?hf_webhook=${encodeURIComponent(webhook)}` : '';
  const sub = await hfFetch(`/${path}${q}`, { method: 'POST', body, model: model.id, timeoutMs: 20000, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} });
  const requestId = sub?.request_id;
  if (!requestId) throw new GatewayError('gateway', `Higgsfield ${model.id}: no request_id`, 0, 'higgsfield');
  const st = await hfWait(requestId, deadlineAt);
  const out = await hfResult(st, model);
  return out ? { ...out, requestId } : { pending: { provider: 'higgsfield', requestId } };
}

/** Pick up a job submitted earlier: { bytes } when done, { pending } while running; throws when it failed. */
export async function resumeImage(model, requestId) {
  if (model.provider !== 'higgsfield') throw new GatewayError('gateway', `cannot resume ${model.id}`);
  const out = await hfResult(await hfStatus(requestId), model);
  return out || { pending: { provider: 'higgsfield', requestId } };
}

/** Standard Webhooks signature check (Higgsfield deliveries): HMAC-SHA256 of `${id}.${ts}.${raw}`, ±5 min. */
export function verifyWebhook(raw, headers, secret = env('HIGGSFIELD_WEBHOOK_SECRET')) {
  if (!secret) return false;
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sig = headers['webhook-signature'];
  if (!id || !ts || !sig || !/^\d{9,11}$/.test(String(ts))) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  let key;
  try { key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  const expected = createHmac('sha256', key).update(`${id}.${ts}.`).update(raw).digest();
  return String(sig).split(/\s+/).some((part) => {
    const [v, b64] = part.split(',');
    if (v !== 'v1' || !b64) return false;
    const got = Buffer.from(b64, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

// ---------------------------------------------------------------------------------------------- Supabase
const ROW_FIELDS = 'key,path,kind,model,status,rejects,source,width,height,updated_at,provider,request_id,style,time_of_day,size,aspect,session,ip_hash,refs';
export function supa() {
  const url = (env('SUPABASE_URL') || SUPABASE_URL).replace(/\/$/, '');
  const key = env('SUPABASE_KEY');
  if (!key) return null;
  // secret keys (sb_secret_…) go in `apikey` only; legacy JWT keys also as a bearer token (as api/lead.js)
  const auth = key.startsWith('sb_secret_') ? {} : { authorization: `Bearer ${key}` };
  const headers = (extra = {}) => ({ apikey: key, ...auth, ...extra });
  const call = async (path, { method = 'GET', body = undefined, headers: h = {}, timeoutMs = 8000, raw = false } = {}) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`${url}${path}`, { method, signal: ctrl.signal, headers: headers(h), body });
      if (raw) return r;
      const text = await r.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      if (!r.ok) { const e = new Error(`supabase ${method} ${path.split('?')[0]} HTTP ${r.status}: ${text.slice(0, 200)}`); e.status = r.status; e.body = json; throw e; }
      return json;
    } finally { clearTimeout(t); }
  };
  return {
    url, call,
    publicUrl: (path) => `${url}/storage/v1/object/public/${BUCKET}/${path}`,
    async put(path, bytes, type, { upsert = false, maxAge = 31536000 } = {}) {
      return call(`/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', body: bytes, timeoutMs: 20000, headers: { 'content-type': type, 'cache-control': `max-age=${maxAge}`, 'x-upsert': upsert ? 'true' : 'false' } });
    },
    async remove(paths) {
      return call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: paths }), headers: { 'content-type': 'application/json' } });
    },
    async rows(keys) {
      if (!keys.length) return [];
      const list = keys.map((k) => `"${k}"`).join(',');
      return (await call(`/rest/v1/photo_renders?key=in.(${encodeURIComponent(list)})&select=${ROW_FIELDS}`)) || [];
    },
    async rowByRequest(requestId) {
      return ((await call(`/rest/v1/photo_renders?request_id=eq.${encodeURIComponent(requestId)}&select=${ROW_FIELDS}&limit=1`)) || [])[0] || null;
    },
    async upsertRow(row) {
      return call('/rest/v1/photo_renders?on_conflict=key', { method: 'POST', body: JSON.stringify(row), headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' } });
    },
    /** Diagnostics only: does the bucket exist and is it public; are the tables there. Never throws. */
    async check() {
      const out = { bucketOk: null, bucketPublic: null, tablesOk: null };
      try { const b = await call(`/storage/v1/bucket/${BUCKET}`); out.bucketOk = !!b; out.bucketPublic = !!b?.public; } catch (e) { out.bucketOk = false; out.bucketStatus = e.status || 'network'; }
      try { await call('/rest/v1/photo_renders?select=key&limit=1'); out.tablesOk = true; } catch (e) { out.tablesOk = false; out.tablesStatus = e.status || 'network'; }
      return out;
    },
    rpc: (fn, args, opts) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args), headers: { 'content-type': 'application/json' }, ...opts }),
  };
}

/** Storage object path for a new generation: unique per generation, so a CDN never serves an old one. */
export const objectPath = (prefix, key, ext = 'jpg') => `${prefix}/${key.slice(0, 2)}/${key}-${randomBytes(4).toString('hex')}.${ext}`;

// ---------------------------------------------------------------------------------------------- vocabulary
export const STYLES_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const TIMES = ['morning', 'day', 'golden', 'evening'];
// Fixed vocabulary (ART §2): style and time wording comes only from here, never free text.
export const STYLE_WORDS = {
  'dark-walnut': 'Warm, calm, gallery-like: dark walnut, travertine and linen.',
  'light-oak': 'Quiet Nordic calm: pale oak, paper-white walls and linen; airy.',
  'greige-luxe': 'Soft tonal luxury: greige plaster, bouclé and champagne metal; gentle.',
  mediterranean: 'Sun-washed Mediterranean: limewash, cane, terracotta and olive; relaxed.',
};
export const LIGHT_WORDS = {
  morning: 'Soft early daylight from the window is the key light; the room is filled gently.',
  day: 'Daylight from the window is the key light, soft fill from the room; lamps are off or never the key.',
  golden: 'Low golden-hour sun from the window, long soft shadows, warm highlights.',
  evening: 'Blue hour: warm 2700 K lamps and downlights are the key light inside; the city is lit outside.',
};
export const GRADE_WORDS = 'Gentle S-curve, neutral-warm highlights, slightly cool shadows, a trace of halation around the window and lamp shades. Never an HDR real-estate look, never oversaturated; whites stay white. The window is exposed, never a white rectangle.';
export const TIME_WORDS = {
  morning: 'soft early-morning daylight, the low sun to the left outside the frame',
  day: 'bright midday daylight with sun patches on the floor, a clear sky with light haze',
  golden: 'golden-hour sunset light, warm low sun from the right, long soft shadows, a warm sky',
  evening: 'blue-hour evening: lamps and downlights on, warm 2700 K pools of light, the city lit outside',
};
export const WINDOW_WORDS = {
  morning: 'a real photograph of Dubai Marina towers in clear morning light, pale blue sky, natural haze',
  day: 'a real photograph of Dubai Marina towers under a clear blue midday sky with natural haze toward the horizon',
  golden: 'a real photograph of Dubai Marina towers at sunset, the sky glowing amber to soft blue, warm light on the glass',
  evening: 'a real photograph of Dubai Marina at blue hour, a deep blue sky, thousands of lit windows and city lights',
};
