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
// Higgsfield facts below come from the provider's free POST /estimate/{path} run with this account's key on
// 27 Nov 2026 (GET /api/photo?diag=1&probe=1) and from docs.higgsfield.ai/docs/llms-full.txt (body schemas).
// cost: USD per output by size tier — only a fallback: every Higgsfield call asks /estimate first and stores that.
// Fields of a Higgsfield entry: path (edit) · t2i (text-to-image path) · images (body field for input URLs) ·
// maxRefs (input images besides the frame) · sizes · aspects · seed · extra (fixed body fields) · quality ·
// maxPrompt · explicit (never picked automatically: only when a job names it) · editOnly / t2iOnly.
const QWEN_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '7:9', '9:7', '9:16', '16:9', '21:9'];
export const MODELS = {
  // --- Higgsfield (primary): endpoints that answered 200 for this account
  'higgsfield:grok_image_2': { provider: 'higgsfield', hf: 'grok_image_2', label: 'Grok Imagine Image 2.0', path: 'xai/grok-imagine-image-2.0', t2i: 'xai/grok-imagine-image-2.0', images: 'image_urls', maxRefs: 9, seed: false, sizes: ['1K', '2K'], aspects: ['auto', '1:1', '1:2', '2:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'], quality: 'medium', cost: { '1K': 0.07, '2K': 0.1 }, estimate: true },
  'higgsfield:qwen_image_3': { provider: 'higgsfield', hf: 'qwen_image_3', label: 'Qwen Image 3', path: 'alibaba/qwen-image-3/edit', t2i: 'alibaba/qwen-image-3/text-to-image', images: 'image_urls', maxRefs: 2, seed: true, sizes: ['1K', '2K'], aspects: QWEN_ASPECTS, extra: { prompt_extend: false, enable_thinking: false }, cost: { '1K': 0.04, '2K': 0.06 }, estimate: true },
  'higgsfield:marketing_image': { provider: 'higgsfield', hf: 'marketing_image', label: 'Marketing Studio Image', path: 'marketing-studio/image', t2i: 'marketing-studio/image', images: 'image_urls', maxRefs: 15, seed: false, sizes: ['1K', '2K', '4K'], aspects: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'], quality: 'high', extra: { enhance_prompt: false, moderation: 'auto' }, explicit: true, cost: { '1K': 0.3, '2K': 0.452, '4K': 0.9 }, estimate: true },
  'higgsfield:z_image': { provider: 'higgsfield', hf: 'z_image', label: 'Z-Image Turbo (drafts)', path: '', t2i: 'z-image/turbo', images: 'image_urls', maxRefs: 0, seed: true, t2iOnly: true, maxPrompt: 800, sizes: ['1K', '2K'], aspects: QWEN_ASPECTS, extra: { prompt_extend: false }, explicit: true, cost: { '1K': 0.015, '2K': 0.03 }, estimate: true },
  // --- Higgsfield: not available to this account today. nano-banana-pro exists but answers 503 model_disabled;
  // the others are 404 (their paths are guesses after the confirmed `nano-banana-pro[/edit]` pattern). They stay
  // listed so they work the day the account gets them: 503 / 423 / 404 → that model is skipped for 1 h.
  'higgsfield:nano_banana_pro': { provider: 'higgsfield', hf: 'nano_banana_pro', label: 'Nano Banana Pro (Higgsfield)', path: 'nano-banana-pro/edit', t2i: 'nano-banana-pro', images: 'image_urls', maxRefs: 13, seed: false, sizes: ['1K', '2K', '4K'], aspects: GEMINI_ASPECTS, cost: { '1K': 0.1344, '2K': 0.1344, '4K': 0.24 }, estimate: true },
  'higgsfield:nano_banana_2_1': { provider: 'higgsfield', hf: 'nano_banana_2_1', label: 'Nano Banana 2.1 (Higgsfield)', path: 'nano-banana-2.1/edit', t2i: 'nano-banana-2.1', images: 'image_urls', maxRefs: 13, seed: true, sizes: ['1K', '2K', '4K'], aspects: ['auto', ...GEMINI_ASPECTS], explicit: true, cost: { '1K': 0.067, '2K': 0.101, '4K': 0.151 }, estimate: true },
  'higgsfield:seedream_5_5': { provider: 'higgsfield', hf: 'seedream_5_5', label: 'Seedream 5.5 (Higgsfield)', path: 'bytedance/seedream-5.5/edit', t2i: 'bytedance/seedream-5.5/text-to-image', images: 'image_urls', maxRefs: 9, seed: false, sizes: ['1K', '2K', '4K'], aspects: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], extra: { background: 'opaque' }, explicit: true, cost: { '1K': 0.035, '2K': 0.035, '4K': 0.06 }, estimate: true },
  // --- AI Gateway (fallback; needs billing on the Vercel team — today it answers 403 "free tier")
  'google/gemini-3.1-flash-image': { provider: 'gateway', label: 'Nano Banana 2', api: 'chat', maxRefs: 10, sizes: ['512', '1K', '2K', '4K'], cost: { 512: 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 }, aspects: GEMINI_ASPECTS },
  'google/gemini-3.1-flash-image-preview': { provider: 'gateway', label: 'Nano Banana 2 (preview id)', api: 'chat', maxRefs: 10, sizes: ['512', '1K', '2K', '4K'], cost: { 512: 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 }, aspects: GEMINI_ASPECTS },
  'google/gemini-3.1-flash-lite-image': { provider: 'gateway', label: 'Nano Banana 2 Lite', api: 'chat', maxRefs: 6, sizes: ['1K'], cost: { '1K': 0.034 }, aspects: GEMINI_ASPECTS },
  'google/gemini-3-pro-image': { provider: 'gateway', label: 'Nano Banana Pro', api: 'chat', maxRefs: 8, sizes: ['1K', '2K', '4K'], cost: { '1K': 0.1344, '2K': 0.1344, '4K': 0.24 }, aspects: GEMINI_ASPECTS },
  'bfl/flux-2-pro': { provider: 'gateway', label: 'FLUX.2 [pro]', api: 'edits', maxRefs: 4, sizes: ['1K', '2K'], cost: { '1K': 0.045, '2K': 0.09 }, aspects: null, estimate: true },
  'bfl/flux-2-max': { provider: 'gateway', label: 'FLUX.2 [max]', api: 'edits', maxRefs: 4, sizes: ['1K', '2K'], cost: { '1K': 0.08, '2K': 0.16 }, aspects: null, estimate: true },
};
// Orders (override: photo_config row `order` = {"default":[…],"hero":[…],"plate":[…]}, then env PHOTO_MODELS / …).
const DEFAULTS = {
  default: ['higgsfield:grok_image_2', 'higgsfield:qwen_image_3', 'google/gemini-3.1-flash-image', 'google/gemini-3.1-flash-image-preview'],
  hero: ['higgsfield:nano_banana_pro', 'higgsfield:grok_image_2', 'higgsfield:qwen_image_3', 'google/gemini-3-pro-image'],
  plate: ['higgsfield:qwen_image_3', 'higgsfield:grok_image_2', 'google/gemini-3-pro-image'],
};
const ID_RE = /^(?:higgsfield:[a-z0-9_]{2,40}|[a-z0-9-]+\/[a-zA-Z0-9._:-]+)$/;
export const isModelId = (x) => typeof x === 'string' && ID_RE.test(x);
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
//   order     { "default": ["higgsfield:grok_image_2", …], "hero": […], "plate": […] }      (else env PHOTO_MODELS …)
//   caps.maxUsd / caps.maxUsdVisitor   the most one call may cost by the provider's estimate (0.6 / 0.2)
// Read with a 30 s in-memory cache. A read error (or no table yet) means visitors off and no pilots; the last good
// overrides (caps, ab, cost, models) stay in use.
const CONFIG_TTL_MS = 30_000;
const SESSION_RE = /^[a-z0-9]{8,40}$/i;
const cfg = { at: 0, ok: false, visitors: false, pilots: new Set(), caps: null, ab: null, cost: {}, models: {}, order: {}, names: [] };
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
    const usd = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 20 ? Number(v) : null);
    cfg.caps = caps ? { perIp: num(caps.perIp), global: num(caps.global), maxUsd: usd(caps.maxUsd), maxUsdVisitor: usd(caps.maxUsdVisitor) } : null;
    cfg.ab = typeof m.get('ab') === 'string' ? m.get('ab').trim() : null;
    cfg.cost = obj(m.get('cost')) || {};
    cfg.models = obj(m.get('models')) || {};
    cfg.order = obj(m.get('order')) || {};
    cfg.names = ['caps', 'ab', 'cost', 'models', 'order'].filter((k) => m.has(k) && m.get(k) != null && (typeof m.get(k) !== 'object' || Object.keys(m.get(k)).length));
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
/** The most one call may cost by the provider's estimate: queue jobs 0.6 USD, visitor photos 0.2 USD by default. */
export const maxUsd = (visitor = false) => (visitor ? cfg.caps?.maxUsdVisitor ?? (Number(env('PHOTO_MAX_USD_VISITOR')) || 0.2) : cfg.caps?.maxUsd ?? (Number(env('PHOTO_MAX_USD')) || 0.6));
export function resetConfigForTests() { Object.assign(cfg, { at: 0, ok: false, visitors: false, pilots: new Set(), caps: null, ab: null, cost: {}, models: {}, order: {}, names: [] }); modelBreaker.clear(); }

/** Config of one model id (known table + env / photo_config overrides; unknown ids get a generic config). */
export function modelConfig(id) {
  const base = MODELS[id] || (id.startsWith('higgsfield:')
    ? { provider: 'higgsfield', hf: id.slice(11), label: id, path: '', images: 'image_urls', maxRefs: 2, sizes: ['1K', '2K'], aspects: ['auto', ...GEMINI_ASPECTS], cost: {}, estimate: true }
    : { provider: 'gateway', label: id, api: /^bfl\//.test(id) ? 'edits' : 'chat', maxRefs: 4, sizes: ['1K', '2K'], cost: {}, aspects: GEMINI_ASPECTS, estimate: true });
  const m = { id, ...base };
  if (m.provider === 'higgsfield') {
    const o = { ...(jsonEnv('HIGGSFIELD_MODELS')[m.hf] || {}), ...(obj(cfg.models[m.hf]) || {}) }; // photo_config.models wins
    const pathRe = /^[a-zA-Z0-9._/-]{3,120}$/;
    if (typeof o.path === 'string' && pathRe.test(o.path)) m.path = o.path;
    if (typeof o.t2i === 'string' && pathRe.test(o.t2i)) m.t2i = o.t2i;
    if (typeof o.images === 'string' && /^[a-z_]{3,40}$/.test(o.images)) m.images = o.images;
    if (Number.isInteger(o.maxRefs) && o.maxRefs >= 0 && o.maxRefs <= 20) m.maxRefs = o.maxRefs;
    if (Array.isArray(o.aspects)) m.aspects = o.aspects.filter((x) => typeof x === 'string' && /^(auto|\d{1,2}:\d{1,2})$/.test(x));
    if (Array.isArray(o.sizes)) m.sizes = o.sizes.filter((x) => ['512', '1K', '2K', '4K'].includes(x));
    if (typeof o.quality === 'string' && /^[a-z]{2,10}$/.test(o.quality)) m.quality = o.quality;
    if (o.extra && typeof o.extra === 'object') m.extra = { ...(m.extra || {}), ...o.extra };
  }
  const c = obj(cfg.cost[id]) || jsonEnv('PHOTO_COST')[id];
  if (c && typeof c === 'object') { m.cost = { ...m.cost, ...c }; m.estimate = false; }
  return m;
}

/** Which providers can be called right now (credentials present). */
export const providersAvailable = (req) => ({ higgsfield: !!hfAuth(), gateway: !!authToken(req) || env('PHOTO_PROVIDER') === 'stub' });

// A model the provider reported as disabled / blocked / unknown (503, 423, 404) is skipped for an hour (per instance).
const modelBreaker = new Map();
const MODEL_BREAKER_MS = 3_600_000;
export const tripModel = (id, why = '') => { modelBreaker.set(id, { until: Date.now() + MODEL_BREAKER_MS, why: String(why).slice(0, 60) }); };
export const modelOff = (id) => { const b = modelBreaker.get(id); if (!b) return false; if (b.until < Date.now()) { modelBreaker.delete(id); return false; } return true; };
export const modelBreakers = () => [...modelBreaker].filter(([id]) => modelOff(id)).map(([id, b]) => ({ id, why: b.why }));

/**
 * Ordered model configs for a tier ('default' | 'hero' | 'plate'). With `avail`: only models whose provider has
 * credentials and that are not switched off by their breaker. Models marked `explicit` are never in an automatic
 * list unless the order row / env names them; a job names one with params.model (see pickModels).
 */
export function modelList(tier = 'default', avail = null) {
  const fromCfg = Array.isArray(cfg.order?.[tier]) ? cfg.order[tier].filter((x) => typeof x === 'string' && ID_RE.test(x)) : null;
  const raw = tier === 'hero' ? env('PHOTO_HERO_MODELS') : tier === 'plate' ? env('PLATE_MODELS') : env('PHOTO_MODELS');
  const ids = fromCfg?.length ? fromCfg : raw ? parseList(raw) : DEFAULTS[tier] || DEFAULTS.default;
  const list = ids.map(modelConfig);
  return avail ? list.filter((m) => avail[m.provider] && !modelOff(m.id)) : list;
}
/** Models for a job: exactly params.model when it names one (no silent substitute), else the tier's list. */
export function pickModels(tier, avail, named = null) {
  if (typeof named === 'string' && ID_RE.test(named)) { const m = modelConfig(named); return avail[m.provider] ? [m] : []; }
  return modelList(tier, avail);
}
/** The size tier a model will really produce for a wish ('1K' | '2K' | '4K'): the wish, else the largest below it. */
export function bestSize(model, want = '2K') {
  const rank = ['512', '1K', '2K', '4K'];
  const have = (model.sizes || ['1K', '2K']).slice().sort((x, y) => rank.indexOf(x) - rank.indexOf(y));
  if (have.includes(want)) return want;
  const below = have.filter((x) => rank.indexOf(x) <= rank.indexOf(want));
  return below.length ? below[below.length - 1] : have[0];
}
const ratio = (a) => { const m = /^(\d+):(\d+)$/.exec(a); return m ? Number(m[1]) / Number(m[2]) : null; };
/**
 * The aspect a model is asked for. Exact when it has it. Edits: otherwise 'auto' (follow the input) when offered.
 * Text-to-image: the nearest ratio it offers. `exact` says whether the output will have the wanted shape.
 */
export function pickAspect(model, want, { edit = false } = {}) {
  const list = model.aspects || [];
  if (!want || !list.length) return { aspect: want || null, exact: true };
  if (list.includes(want)) return { aspect: want, exact: true };
  if (edit && list.includes('auto')) return { aspect: 'auto', exact: false };
  const w = ratio(want);
  const c = list.filter((x) => ratio(x)).sort((x, y) => Math.abs(Math.log(ratio(x) / w)) - Math.abs(Math.log(ratio(y) / w)))[0];
  return { aspect: c || want, exact: false };
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
      const e = new GatewayError(code, `gateway HTTP ${s} (${auth.kind}, ${model}): ${detail}`, s, 'gateway');
      e.detail = detail.replace(/\s+/g, ' ').slice(0, 200);
      throw e;
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
  // the gateway has no estimate call: its catalog price is the estimate
  const estimate = costOf(opts.model, bestSize(opts.model, opts.imageSize || '2K'));
  if (opts.dry) return { dry: true, estimate, path: opts.model.api === 'edits' ? '/images/edits' : '/chat/completions', listPrice: true };
  if (Number.isFinite(opts.maxCost) && estimate > opts.maxCost) throw new GatewayError('too_expensive', `${opts.model.id}: list price $${estimate} is over the limit $${opts.maxCost}`, 0, 'gateway');
  return gatewayGenerate({ ...opts, imageSize: bestSize(opts.model, opts.imageSize || '2K') });
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
      // 503 model_disabled / 423 model_blocked: this model is off for the account (the model breaker skips it for 1 h)
      const code = st === 401 || st === 403 ? 'unavailable' : st === 404 ? 'no_model' : st === 503 || st === 423 ? 'model_off'
        : st === 400 || st === 422 ? 'rejected' : st === 429 ? 'busy' : 'gateway';
      const hint = st === 404 && method === 'POST' && model
        ? ` — endpoint path unknown to Higgsfield: copy the model's API path from console.higgsfield.ai and upsert photo_config name 'models' = {"${String(model).replace(/^higgsfield:/, '')}":{"path":"<vendor>/<model>/<workflow>","t2i":"…"}} (live within 30 s), or set the same JSON in env HIGGSFIELD_MODELS`
        : st === 401 ? ` — check ${hfCredentials()?.source || 'HIGGSFIELD_KEY'} (expected id:secret)` : st === 403 ? ' — insufficient balance: top up at console.higgsfield.ai' : '';
      const e = new GatewayError(code, `Higgsfield HTTP ${st} ${method} ${path.split('?')[0]} (${model}): ${detail}${hint}`, st, 'higgsfield');
      e.detail = String(detail).replace(/\s+/g, ' ').slice(0, 200);
      throw e;
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

/** The request body of one Higgsfield image call, from the model's registry entry (exact field names and enums). */
export function hfBody(model, { prompt, urls = [], aspectRatio = null, imageSize = '2K', seed = null, quality = null }) {
  const edit = urls.length > 0;
  const { aspect } = pickAspect(model, aspectRatio, { edit });
  let text = String(prompt || '');
  if (model.maxPrompt && text.length > model.maxPrompt) { // cut at a sentence end inside the limit
    const cut = text.slice(0, model.maxPrompt); const dot = cut.lastIndexOf('. ');
    text = dot > model.maxPrompt * 0.5 ? cut.slice(0, dot + 1) : cut;
  }
  const q = quality || model.quality || null;
  return {
    prompt: text,
    ...(edit ? { [model.images || 'image_urls']: urls } : {}),
    ...(aspect ? { aspect_ratio: aspect } : {}),
    resolution: bestSize(model, imageSize || '2K').toLowerCase(),
    ...(q ? { quality: q } : {}),
    ...(model.seed && Number.isFinite(seed) ? { seed: Math.abs(Math.trunc(seed)) % 2147483647 } : {}),
    ...(model.extra || {}),
  };
}
/** The provider's own price for exactly this call (free): POST /estimate/{path} with the real body → USD. */
export async function hfEstimate(path, body, model = '') {
  const r = await hfFetch(`/estimate/${path}`, { method: 'POST', body, model, timeoutMs: 10000 });
  const usd = Number(r?.usd);
  if (!Number.isFinite(usd) || usd < 0) throw new GatewayError('gateway', `Higgsfield estimate for ${model}: no usd in the answer`, 0, 'higgsfield');
  return usd;
}

/**
 * One Higgsfield image call: estimate first (free) → refuse above `maxCost` → submit → poll until `deadlineAt`.
 *   images: [{ url, publicUrl? }] — a public HTTPS URL is passed as is (publicUrl wins over an inline data: URL;
 *   inline bytes without one are uploaded through /files/generate-upload-url).
 *   dry: true → return { dry, estimate, path, body } without submitting (nothing is charged).
 * Returns { bytes, requestId, estimate, path } | { pending: { requestId, estimate } } | { dry … }.
 */
async function hfGenerate({ model, prompt, images = [], aspectRatio = null, imageSize = '2K', deadlineAt = Date.now() + 45000, idempotencyKey = null, webhook = null, seed = null, quality = null, dry = false, maxCost = Infinity }) {
  const edit = images.length > 0;
  if (edit && model.t2iOnly) throw new GatewayError('rejected', `${model.id} is text-to-image only`, 0, 'higgsfield');
  const path = edit ? model.path : model.t2i || model.path;
  if (!path) throw new GatewayError('no_model', `Higgsfield ${model.id}: endpoint path unknown (photo_config 'models' / HIGGSFIELD_MODELS)`, 0, 'higgsfield');
  const urls = [];
  for (const im of images.slice(0, (model.maxRefs ?? 2) + 1)) {
    if (im.publicUrl) { urls.push(im.publicUrl); continue; }
    const b = dataUrlBytes(im.url);
    urls.push(b ? (dry ? 'https://example.com/frame.jpg' : await hfUpload(b, 'image/jpeg')) : im.url);
  }
  const body = hfBody(model, { prompt, urls, aspectRatio, imageSize, seed, quality });
  const estimate = await hfEstimate(path, body, model.id);
  if (dry) return { dry: true, estimate, path, body: { ...body, prompt: `${body.prompt.slice(0, 60)}…` } };
  if (estimate > maxCost) { const e = new GatewayError('too_expensive', `Higgsfield ${model.id}: estimate $${estimate} is over the limit $${maxCost} (photo_config caps.maxUsd, or the job's maxUsd)`, 0, 'higgsfield'); e.detail = `estimate ${estimate} > limit ${maxCost}`; throw e; }
  const q = webhook ? `?hf_webhook=${encodeURIComponent(webhook)}` : '';
  const sub = await hfFetch(`/${path}${q}`, { method: 'POST', body, model: model.id, timeoutMs: 20000, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} });
  const requestId = sub?.request_id;
  if (!requestId) throw new GatewayError('gateway', `Higgsfield ${model.id}: no request_id`, 0, 'higgsfield');
  const st = await hfWait(requestId, deadlineAt);
  const out = await hfResult(st, model);
  return out ? { ...out, requestId, estimate, path } : { pending: { provider: 'higgsfield', requestId, estimate, path } };
}

/** Submit any Higgsfield endpoint (3D, video …): returns the request id. The caller estimates first. */
export async function hfSubmit(path, body, { model = '', idempotencyKey = null } = {}) {
  const sub = await hfFetch(`/${path}`, { method: 'POST', body, model, timeoutMs: 20000, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} });
  if (!sub?.request_id) throw new GatewayError('gateway', `Higgsfield ${model}: no request_id`, 0, 'higgsfield');
  return sub.request_id;
}
/** Every URL in a completed status, with the path of keys that leads to it: [{ key: 'model_mesh.url', url }]. */
export function hfOutputs(st) {
  const out = [];
  const walk = (v, key, depth) => {
    if (depth > 5 || v == null) return;
    if (typeof v === 'string') { if (/^https:\/\//.test(v) && !/^(status_url|cancel_url)$/.test(key.split('.').pop())) out.push({ key, url: v }); return; }
    if (Array.isArray(v)) { v.slice(0, 20).forEach((x, i) => walk(x, `${key}[${i}]`, depth + 1)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, key ? `${key}.${k}` : k, depth + 1);
  };
  walk(st, '', 0);
  return out;
}

// A provider that said "no balance / bad key" is skipped for 10 minutes (per instance).
const providerBreaker = { higgsfield: 0, gateway: 0 };
const PROVIDER_BREAKER_MS = 10 * 60_000;
export const tripProvider = (pv) => { if (pv in providerBreaker) providerBreaker[pv] = Date.now() + PROVIDER_BREAKER_MS; };
export const providerOff = (pv) => Date.now() < (providerBreaker[pv] || 0);
export const resetBreakers = () => { providerBreaker.higgsfield = 0; providerBreaker.gateway = 0; modelBreaker.clear(); };
/** Providers with credentials and no open breaker. */
export const usableProviders = (req) => { const a = providersAvailable(req); return { higgsfield: a.higgsfield && !providerOff('higgsfield'), gateway: a.gateway && !providerOff('gateway') }; };

/**
 * Try `models` in order until one answers. `makeOpts(model, n, lastErr)` returns the generateImage options for the
 * n-th try of that model (n = 0, 1 …) or null to move on. Every failure is appended to `trace` (attemptOf).
 *   no balance / bad key (401, 403)        → the whole provider is skipped (breaker 10 min)
 *   model disabled / blocked / unknown path → that model is skipped (breaker 1 h)
 *   anything else                           → the next try of the model (if makeOpts offers one), else the next model
 * Returns { model, out } (out: generateImage's { bytes … } | { pending }); throws the last error with `.trace`.
 */
export async function tryModels(models, makeOpts, { trace = [], minLeftMs = 8000, deadlineAt = Infinity } = {}) {
  const skip = new Set();
  let last = null;
  for (const model of models) {
    if (skip.has(model.provider) || modelOff(model.id)) continue;
    for (let n = 0; n < 3; n++) {
      if (deadlineAt - Date.now() < minLeftMs) { last = last || new GatewayError('timeout', 'no time left for another model'); break; }
      const opts = makeOpts(model, n, last);
      if (!opts) break;
      try {
        const out = await generateImage({ ...opts, model });
        return { model, out, trace };
      } catch (err) {
        last = err;
        trace.push(attemptOf(model, err));
        console.warn(`[photo] ${model.id} failed (${err instanceof GatewayError ? err.code : 'error'}): ${err?.message || err}`);
        if (isFatalGateway(err)) { const pv = err.provider || model.provider; skip.add(pv); if (err.code === 'unavailable') tripProvider(pv); break; }
        if (err instanceof GatewayError && (err.code === 'model_off' || err.code === 'no_model')) { tripModel(model.id, `${err.status || ''} ${err.detail || ''}`); break; }
        if (err instanceof GatewayError && err.code === 'too_expensive') break;
      }
    }
  }
  const e = last || new GatewayError('unavailable', 'no model available (no credentials, or every model is switched off)');
  e.trace = trace;
  throw e;
}
/** What each model would cost for this call, nothing submitted: [{ model, usd, path } | { model, error }]. */
export async function dryRun(models, makeOpts) {
  const out = [];
  for (const model of models) {
    const opts = makeOpts(model, 0, null);
    if (!opts) continue;
    try { const r = await generateImage({ ...opts, model, dry: true }); out.push({ model: model.id, usd: r.estimate, path: r.path, ...(r.listPrice ? { listPrice: true } : {}), ...(r.body ? { body: r.body } : {}) }); }
    catch (err) { out.push({ model: model.id, error: attemptOf(model, err) }); if (err instanceof GatewayError && (err.code === 'model_off' || err.code === 'no_model')) tripModel(model.id, `${err.status || ''} ${err.detail || ''}`); }
  }
  return out;
}

/** One line of a job's attempt log (the coordinator cannot read the function logs): no secrets, ≤ 200 chars of detail. */
export function attemptOf(model, err, extra = {}) {
  const g = err instanceof GatewayError;
  return { provider: model?.provider || (g && err.provider) || null, model: model?.id || null, status: g ? err.status || null : null, code: g ? err.code : 'error', detail: String((g && err.detail) || err?.message || err || '').replace(/\s+/g, ' ').slice(0, 200), ...extra };
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
const ROW_FIELDS = 'key,path,kind,model,status,rejects,source,width,height,updated_at,provider,request_id,style,time_of_day,size,aspect,session,ip_hash,refs,cost_usd';
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
    /** Streamed upload (large files: GLB, MP4): `stream` is a web ReadableStream; nothing is buffered here. */
    async putStream(path, stream, type, { upsert = true, maxAge = 3600, timeoutMs = 50000 } = {}) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', body: stream, duplex: 'half', signal: ctrl.signal, headers: headers({ 'content-type': type, 'cache-control': `max-age=${maxAge}`, 'x-upsert': upsert ? 'true' : 'false' }) });
        if (!r.ok) { const e = new Error(`supabase streamed upload ${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); e.status = r.status; throw e; }
        return true;
      } finally { clearTimeout(t); }
    },
    /** Server-side copy inside the bucket (no download): replaces the destination. */
    async copy(from, to) {
      try { await call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: [to] }), headers: { 'content-type': 'application/json' } }); } catch { /* nothing to replace */ }
      return call('/storage/v1/object/copy', { method: 'POST', body: JSON.stringify({ bucketId: BUCKET, sourceKey: from, destinationKey: to }), headers: { 'content-type': 'application/json' }, timeoutMs: 30000 });
    },
    /** Does a public object exist? */
    async exists(path) {
      try { const r = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${path}`, { method: 'HEAD' }); return r.ok; } catch { return false; }
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
  morning: 'a real photograph of a modern city seen from a high floor in clear morning light, pale blue sky, natural haze',
  day: 'a real photograph of a modern city seen from a high floor under a clear blue midday sky with natural haze toward the horizon',
  golden: 'a real photograph of a modern city seen from a high floor at sunset, the sky glowing amber to soft blue, warm light on the buildings',
  evening: 'a real photograph of a modern city seen from a high floor at blue hour, a deep blue sky, lit windows and street lights',
};
