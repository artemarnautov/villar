// POST /api/assistant — Villar's AI designer (Claude via Vercel AI Gateway). Owner: assistant.
//
// Request : { messages: [{ role: 'user'|'assistant', content }], state: { style, selection, total, view, time }, lang: 'ru'|'en' }
// Response: { reply, actions: [...], chips: [...], budget?: { target, total, ok, min }, total, error? }   (always JSON)
//   actions ∈ { type:'select', key, slotId, itemId } | { type:'style', styleId, anchor:{ key, itemId }|null }
//            | { type:'view', name } | { type:'time', name } | { type:'focus', slotId } | { type:'reset' }
// Errors come back as HTTP 200 { reply, actions: [], error } so the bar degrades to its local parser.
//
// Auth: the project's OIDC token (request header x-vercel-oidc-token, else env VERCEL_OIDC_TOKEN), else
// env AI_GATEWAY_API_KEY. Model: env VILLAR_MODEL (default anthropic/claude-haiku-5.5).
// No npm dependencies. Written so it runs both as native ESM and when Vercel transpiles it to CommonJS
// (no import.meta, no top-level await).
import INDEX from './_catalog.js';
import { createSim, parseBudget, sanitizeText, sanitizeChips, buildAiIndex, VIEWS, TIMES, addDenyPatterns } from '../site/js/ai/core.js';
import { SUPPLIERS, SUPPLIERS_RU } from './_deny.js';
addDenyPatterns(SUPPLIERS, SUPPLIERS_RU);
import { L, keyLabel, itemName, aed, num, defaultChips, styleName, plural } from '../site/js/ai/i18n.js';

const GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://ai-gateway.vercel.sh/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';
const DEADLINE_MS = 8000;      // whole request, both model calls included
const FIRST_CALL_MS = 7000;
const SECOND_CALL_MIN_MS = 2500;
const MAX_TOKENS = 700;
const MAX_BODY = 24 * 1024;
const MAX_USER_CHARS = 500;
const MAX_ASSISTANT_CHARS = 600;
const MAX_TURNS = 8;
const RATE = [{ windowMs: 60_000, max: 12 }, { windowMs: 3_600_000, max: 80 }];

// ------------------------------------------------------------------ index, simulator, prompts (cold start)
let index = INDEX;
let sim = createSim(index);
const prompts = new Map();
function setIndex(next) { index = next; sim = createSim(index); prompts.clear(); }

const model = () => process.env.VILLAR_MODEL || DEFAULT_MODEL;
function reasoningFor(m) {
  const env = (process.env.VILLAR_REASONING || '').trim().toLowerCase();
  if (env === 'default' || env === 'off-param') return null;
  if (env) return env;
  return /haiku/i.test(m) ? 'none' : null;
}

const TEXT = {
  ru: {
    unauthorized: 'Ассистент сейчас недоступен.', gateway: 'Ассистент сейчас недоступен.',
    timeout: 'Не успел ответить — попробуйте ещё раз.', rate_limited: 'Слишком много запросов. Подождите минуту.',
    bad_request: 'Не понял запрос.', forbidden: 'Запрос отклонён.', empty: 'Готово.',
    budgetMin: (m) => `Ниже ${m} в этом стиле не получится — собрал самый экономный вариант.`,
    budgetPlan: (n, lvl, t) => `Комната под ${n}: «${lvl}», итог ${t}.`,
    budgetFixed: (n, k, t) => `Уложился в ${n}: ${k} ${plural('ru', k, ['замена', 'замены', 'замен'])}, итог ${t}.`,
    budgetAlready: (t) => `Вы уже укладываетесь: итог ${t}.`,
  },
  en: {
    unauthorized: 'The assistant is unavailable right now.', gateway: 'The assistant is unavailable right now.',
    timeout: 'That took too long — please try again.', rate_limited: 'Too many requests. Please wait a minute.',
    bad_request: 'I didn’t understand the request.', forbidden: 'Request refused.', empty: 'Done.',
    budgetMin: (m) => `This style can’t go below ${m} — here is the most economical set.`,
    budgetPlan: (n, lvl, t) => `Room for ${n}: ${lvl}, total ${t}.`,
    budgetFixed: (n, k, t) => `Within ${n}: ${k} ${plural('en', k, ['swap', 'swaps'])}, total ${t}.`,
    budgetAlready: (t) => `You’re already within budget: total ${t}.`,
  },
};

const cm = (n) => Math.round(Number(n) || 0);
const dimsOf = (d) => (d ? (d.round ? `Ø${cm(d.w)}×${cm(d.h)}` : `${cm(d.w)}×${cm(d.d)}×${cm(d.h)}`) : '');

function systemPrompt(lang) {
  const l = L(lang);
  if (prompts.has(l)) return prompts.get(l);
  const en = l === 'en';
  const packs = Object.values(index.packs || {});
  const def = index.default;
  const slots = index.layout?.slots || [];

  // Places: one line per selection key of the default pack (slots sharing a choice listed together).
  const dp = index.packs[def];
  const byKey = new Map();
  for (const s of slots) {
    const k = sim.keyOfSlotIn(dp, s);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  const places = [...byKey.entries()].map(([k, ss]) => {
    const lbl = keyLabel(l, k, ss[0].type);
    const where = ss.length > 1 ? (en ? ` — one choice for ${ss.map((s) => s.id).join(', ')}` : ` — один выбор на ${ss.map((s) => s.id).join(', ')}`) : (ss[0].id !== k ? ` (slot ${ss[0].id})` : '');
    return `  ${k}: ${lbl} ×${ss.length}${where}`;
  }).join('\n');

  const packLines = packs.map((p) => {
    const d = sim.defaults(p.id);
    const head = `## ${p.id} — ${en ? '“' : '«'}${styleName(l, p)}${en ? '”' : '»'}${(en ? p.taglineEn || p.tagline : p.tagline) ? `: ${en ? p.taglineEn || p.tagline : p.tagline}` : ''}`;
    const tot = en ? `  Curated total ${num(l, sim.total(p.id, d))} AED; cheapest possible ${num(l, sim.minTotal(p.id))} AED.` : `  Базовый итог ${num(l, sim.total(p.id, d))} AED; минимально возможный ${num(l, sim.minTotal(p.id))} AED.`;
    const keys = sim.placedKeys(p.id).map((k) => `  ${k}: ${p.slots[k].options.map((o) => (o === d[k] ? `${o}*` : o)).join(', ')}`);
    const extra = Object.keys(p.slots).filter((k) => !sim.placedKeys(p.id).includes(k));
    return [head, tot, ...keys, extra.length ? (en ? `  (not placed in this layout yet: ${extra.join(', ')})` : `  (пока не размещены в планировке: ${extra.join(', ')})`) : ''].filter(Boolean).join('\n');
  }).join('\n');

  // Only items that can actually be placed (keys with a slot in the layout) — fewer tokens, no dead ends.
  const placeable = new Set();
  for (const p of packs) for (const k of sim.placedKeys(p.id)) for (const o of p.slots[k].options) placeable.add(o);
  const items = (index.catalog?.items || []).filter((it) => placeable.has(it.id)).map((it) => {
    const name = en ? it.nameEn || it.name : it.name;
    const color = en ? it.colorEn || it.color : it.color;
    const mats = (en ? it.materialsEn || it.materials : it.materials) || [];
    return `${it.id} | ${name} | ${cm(it.price)} | ${color || ''} ${it.colorHex || ''} | ${mats.join('; ')} | ${dimsOf(it.dims)}`;
  }).join('\n');

  const lname = String(index.layout?.name || '');
  const area = index.layout?.areaM2 && !/m²|м²/.test(lname) ? (en ? `, ${index.layout.areaM2} m²` : `, ${index.layout.areaM2} м²`) : '';
  const text = en ? `You are Villar, the interior designer inside a photoreal 3D editor of a furnished studio apartment in Dubai. You sound like a calm, experienced designer: brief, warm, precise. Never like a chatbot: no exclamation marks, no emoji, no filler.

Always answer by calling the respond tool exactly once.

Hard rules:
1. Only use items from the list below, and only for a place whose options list them in the active style (or in the style you switch to). Never invent items, colours or prices.
2. Never name shops, suppliers, retailers, SKUs, article numbers, codes or links. Model names (e.g. Lansbury) are fine.
3. Prices in AED, whole numbers. No promises about discounts, stock or delivery dates.
4. reply: 1–3 short sentences in English, no lists, no markdown. Do not state the apartment total (the interface shows it); you may mention what one swap saves.
5. Budget ("keep it under 25,000"): return concrete select actions so the total becomes ≤ the budget, and set budget. Fewer swaps are better; prefer swaps with the largest price gap that keep the look; touch the hero pieces (sofa, bed) last unless asked. The server verifies the sum.
6. "Cheaper" without a sum: the 1–3 most effective swaps. "Lighter/darker/warmer": judge by colour name and hex.
7. Style switch: a style action; anchorItemId = the item the user wants to keep (only if the new style offers it). Selects after a style action refer to the new style.
8. Camera and light: view / time actions; "show me the sofa" → focus with slotId.
9. Off-topic: steer back to the interior in one sentence, no actions.
10. chips: 2–4 short (≤ 28 characters) next steps in English that work here, e.g. "Show the evening", "Keep it under 25,000", "A lighter rug".

Apartment: ${index.layout?.name || 'Studio'}${area}.
Places (selection key: label ×count):
${places}
Views (view.name): eye (entry), living, bed (bedroom), dining, window, top (plan from above).
Times (time.name): morning, day, golden (sunset), evening (lamps on).

Styles (* = curated default):
${packLines}

Items: id | name | price AED | colour hex | materials | W×D×H cm
${items}` : `Ты — Villar, дизайнер интерьера в фотореалистичном 3D-редакторе меблированной студии в Дубае. Ты говоришь как спокойный опытный дизайнер: коротко, тепло, точно. Никогда как чат-бот: без восклицаний, эмодзи и пустых фраз.

Всегда отвечай одним вызовом инструмента respond.

Жёсткие правила:
1. Предлагай только предметы из списка ниже и только для места, в вариантах которого они перечислены в текущем стиле (или в стиле, на который переключаешь). Не выдумывай вещи, цвета и цены.
2. Никогда не называй магазины, поставщиков, ретейлеров, артикулы, коды и ссылки. Названия моделей (например, Lansbury) можно.
3. Цены — в AED, целыми числами. Не обещай скидки, наличие и сроки доставки.
4. reply — 1–3 коротких предложения по-русски, без списков и markdown. Не называй итог по квартире — интерфейс покажет его сам; экономию одной замены назвать можно.
5. Бюджет («уложись в 25 000»): верни конкретные действия select, чтобы итог стал ≤ бюджета, и заполни budget. Меньше замен — лучше; сначала замены с наибольшей разницей в цене без ущерба образу; главные вещи (диван, кровать) — в последнюю очередь, если не просили иного. Сервер проверит сумму.
6. «Дешевле» без суммы — 1–3 самые выгодные замены. «Светлее/темнее/теплее» — по названию цвета и hex.
7. Смена стиля — действие style; anchorItemId — предмет, который пользователь хочет сохранить (только если он есть в новом стиле). Действия select после style относятся к новому стилю.
8. Камера и свет — действия view / time; «покажи диван» — focus со slotId.
9. Вопрос не об интерьере — одним предложением верни разговор к квартире, без действий.
10. chips — 2–4 коротких (до 28 знаков) следующих шага по-русски, которые здесь работают, например «Покажи вечер», «Уложись в 25 000», «Ковёр светлее».

Квартира: ${index.layout?.name || 'Студия'}${area}.
Места (ключ выбора: название ×количество):
${places}
Ракурсы (view.name): eye (вход), living (гостиная), bed (спальня), dining (столовая), window (у окна), top (план сверху).
Время (time.name): morning (утро), day (день), golden (закат), evening (вечер, лампы включены).

Стили (* — по умолчанию):
${packLines}

Предметы: id | название | цена AED | цвет hex | материалы | Ш×Г×В см
${items}`;
  prompts.set(l, text);
  return text;
}

const TOOL = {
  type: 'function',
  function: {
    name: 'respond',
    description: 'Reply to the visitor and change the room. Call exactly once per turn.',
    parameters: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: '1–3 short sentences in the visitor’s language.' },
        actions: {
          type: 'array',
          maxItems: 24,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['select', 'style', 'view', 'time', 'focus', 'reset', 'budget'] },
              amount: { type: 'number', description: 'budget: AED amount — moves the budget slider (the room adds/removes/upgrades items to the best designer room within it)' },
              key: { type: 'string', description: 'select: selection key (or slotId)' },
              slotId: { type: 'string', description: 'focus/select: layout slot id' },
              itemId: { type: 'string', description: 'select: catalog item id' },
              styleId: { type: 'string', description: 'style: pack id' },
              anchorItemId: { type: 'string', description: 'style: item to keep' },
              name: { type: 'string', description: 'view or time name' },
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
        chips: { type: 'array', maxItems: 4, items: { type: 'string' } },
        budget: { type: 'number', description: 'AED budget the visitor asked for; omit if none.' },
      },
      required: ['reply', 'actions', 'chips'],
      additionalProperties: false,
    },
  },
};

// ------------------------------------------------------------------ request helpers
const header = (req, name) => {
  const h = req.headers || {};
  if (typeof h.get === 'function') return h.get(name) || '';
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v || '';
};
const clientIp = (req) => String(header(req, 'x-forwarded-for')).split(',')[0].trim() || header(req, 'x-real-ip') || req.socket?.remoteAddress || 'unknown';

const hits = new Map();
function rateLimited(ip, now = Date.now()) {
  let rec = hits.get(ip);
  if (!rec) { rec = []; hits.set(ip, rec); }
  const longest = Math.max(...RATE.map((r) => r.windowMs));
  while (rec.length && now - rec[0] > longest) rec.shift();
  for (const r of RATE) if (rec.filter((t) => now - t < r.windowMs).length >= r.max) return true;
  rec.push(now);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > longest) hits.delete(k);
  return false;
}

async function readBody(req) {
  let b;
  try { b = req.body; } catch { return { error: 'bad_request' }; } // Vercel's lazy JSON parser throws on invalid JSON
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return { body: b };
  let raw = '';
  if (typeof b === 'string') raw = b;
  else if (Buffer.isBuffer(b)) raw = b.toString('utf8');
  else if (req && typeof req.on === 'function') {
    raw = await new Promise((resolve) => {
      let s = ''; let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) s += c; });
      req.on('end', () => resolve(size > MAX_BODY ? null : s));
      req.on('error', () => resolve(null));
    });
    if (raw == null) return { error: 'bad_request' };
  }
  if (raw.length > MAX_BODY) return { error: 'bad_request' };
  try { return { body: JSON.parse(raw || '{}') }; } catch { return { error: 'bad_request' }; }
}

/** Last ≤ 8 turns, alternating, starting and ending with the user; lengths capped. */
function cleanTurns(messages) {
  const list = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, m.role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS) }));
  const merged = [];
  for (const m of list) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n${m.content}`.slice(-(m.role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS));
    else merged.push({ ...m });
  }
  while (merged.length && merged[merged.length - 1].role !== 'user') merged.pop();
  let turns = merged.slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== 'user') turns = turns.slice(1);
  return turns;
}

function cleanState(state) {
  const style = sim.pack(state?.style) ? state.style : index.default;
  const selection = sim.normalizeSelection(style, state?.selection);
  const view = VIEWS.includes(state?.view) ? state.view : null;
  const time = TIMES.includes(state?.time) ? state.time : null;
  const keys = sim.pack(style)?.slots || {};
  const pins = Array.isArray(state?.pins) ? [...new Set(state.pins.filter((k) => typeof k === 'string' && keys[k]))].slice(0, 60) : [];
  return { style, selection, view, time, pins };
}

function stateBlock(lang, st) {
  const en = L(lang) === 'en';
  const total = sim.total(st.style, st.selection);
  const sel = sim.placedKeys(st.style).map((k) => {
    const it = sim.items.get(st.selection[k]); const q = sim.qty(st.style, k);
    return it ? `${k}=${it.id} (${cm(it.price)}${q > 1 ? `×${q}` : ''})` : null;
  }).filter(Boolean).join('; ');
  return en
    ? `<state>\nstyle: ${st.style}; total: ${cm(total)} AED; cheapest possible in this style: ${cm(sim.minTotal(st.style))} AED; view: ${st.view || 'unknown'}; time: ${st.time || 'unknown'}\nselected: ${sel}\n</state>`
    : `<state>\nстиль: ${st.style}; итог: ${cm(total)} AED; минимум в этом стиле: ${cm(sim.minTotal(st.style))} AED; ракурс: ${st.view || 'неизвестно'}; время: ${st.time || 'неизвестно'}\nвыбрано: ${sel}\n</state>`;
}

// ------------------------------------------------------------------ gateway
function authToken(req) {
  const oidc = header(req, 'x-vercel-oidc-token');
  if (oidc) return { token: oidc, kind: 'oidc-header' };
  if (process.env.VERCEL_OIDC_TOKEN) return { token: process.env.VERCEL_OIDC_TOKEN, kind: 'oidc-env' };
  if (process.env.AI_GATEWAY_API_KEY) return { token: process.env.AI_GATEWAY_API_KEY, kind: 'api-key' };
  return null;
}

class GatewayError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

async function callGateway({ auth, messages, timeoutMs, relaxed = false }) {
  const m = model();
  const effort = relaxed ? null : reasoningFor(m);
  const body = {
    model: m,
    messages,
    tools: [TOOL],
    tool_choice: effort === 'none' && !relaxed ? { type: 'function', function: { name: 'respond' } } : 'auto',
    max_tokens: MAX_TOKENS,
    temperature: 0.4,
    providerOptions: { gateway: { caching: 'auto' } },
  };
  if (effort) body.reasoning = { effort };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(500, timeoutMs));
  let res;
  try {
    res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError' || ctrl.signal.aborted) throw new GatewayError('timeout', `gateway timeout after ${timeoutMs} ms`);
    throw new GatewayError('gateway', `gateway network error: ${err?.message || err}`);
  }
  if (!res.ok) {
    clearTimeout(timer);
    let detail = '';
    try { detail = (await res.text()).slice(0, 400); } catch { /* ignore */ }
    const code = res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : 'gateway';
    throw new GatewayError(code, `gateway HTTP ${res.status} (${auth.kind}, ${m}): ${detail}`, res.status);
  }
  let data;
  try { data = await res.json(); } catch (err) {
    clearTimeout(timer);
    throw new GatewayError(ctrl.signal.aborted ? 'timeout' : 'gateway', `gateway returned invalid JSON: ${err?.message || err}`);
  }
  clearTimeout(timer);
  return { data, model: m };
}

/** Extract { reply, actions, chips, budget } from a chat completion (tool call preferred). */
function parseCompletion(data) {
  const msg = data?.choices?.[0]?.message || {};
  const call = (msg.tool_calls || []).find((c) => c?.function?.name === 'respond') || (msg.tool_calls || [])[0];
  let args = null;
  if (call?.function?.arguments) {
    const a = call.function.arguments;
    try { args = typeof a === 'string' ? JSON.parse(a) : a; } catch { args = null; }
  }
  if (!args && typeof msg.content === 'string') {
    const m = msg.content.match(/\{[\s\S]*\}/);
    if (m) { try { args = JSON.parse(m[0]); } catch { /* plain text */ } }
    if (!args) args = { reply: msg.content, actions: [], chips: [] };
  }
  args = args && typeof args === 'object' ? args : {};
  return {
    reply: typeof args.reply === 'string' ? args.reply : '',
    actions: Array.isArray(args.actions) ? args.actions : [],
    chips: Array.isArray(args.chips) ? args.chips : [],
    budget: Number.isFinite(Number(args.budget)) && Number(args.budget) > 0 ? Math.round(Number(args.budget)) : null,
    usage: data?.usage || null,
  };
}

/** Replace raw item ids that slipped into the reply with their display names. */
function humanize(lang, text) {
  return String(text || '').replace(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g, (id) => {
    const it = sim.items.get(id);
    return it ? itemName(lang, it) : id;
  });
}

// ------------------------------------------------------------------ handler
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}
const fail = (res, lang, error, extra = {}) => send(res, 200, { reply: TEXT[L(lang)][error] || TEXT[L(lang)].gateway, actions: [], chips: [], error, ...extra });

export default async function handler(req, res) {
  const t0 = Date.now();
  const metric = { ev: 'assistant', model: model() };
  const log = (status, extra = {}) => { try { console.info(JSON.stringify({ ...metric, status, ms: Date.now() - t0, ...extra })); } catch { /* ignore */ } };

  if (req.method === 'GET' || req.method === 'HEAD') {
    const auth = authToken(req);
    return send(res, 200, { ok: true, model: model(), auth: !!auth, authKind: auth?.kind || null, index: { hash: index.hash, packs: Object.keys(index.packs || {}).length, items: index.catalog?.items?.length || 0 } });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { reply: '', actions: [], chips: [], error: 'method_not_allowed' }); }

  // Browsers on other sites may not spend our gateway budget.
  const origin = header(req, 'origin');
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (origin && host) {
    let oh = '';
    try { oh = new URL(origin).host; } catch { oh = 'invalid'; }
    if (oh !== host) { log('forbidden'); return fail(res, 'ru', 'forbidden'); }
  }

  const { body, error: bodyErr } = await readBody(req);
  const lang = L(body?.lang);
  metric.lang = lang;
  if (bodyErr || !body || typeof body !== 'object') { log('bad_request'); return fail(res, lang, 'bad_request'); }

  if (rateLimited(clientIp(req))) { log('rate_limited'); return fail(res, lang, 'rate_limited'); }

  const turns = cleanTurns(body.messages);
  if (!turns.length) { log('bad_request'); return fail(res, lang, 'bad_request'); }
  const userText = turns[turns.length - 1].content;
  const st = cleanState(body.state);
  const total0 = sim.total(st.style, st.selection);

  const auth = authToken(req);
  if (!auth) {
    console.error('[assistant] auth missing: no x-vercel-oidc-token request header and neither VERCEL_OIDC_TOKEN nor AI_GATEWAY_API_KEY is set. Enable OIDC for the project or add AI_GATEWAY_API_KEY.');
    log('unauthorized');
    return fail(res, lang, 'unauthorized');
  }
  metric.auth = auth.kind;

  const system = systemPrompt(lang);
  const convo = turns.map((m, i) => (i === turns.length - 1 ? { role: 'user', content: `${stateBlock(lang, st)}\n<request>\n${m.content}\n</request>` } : m));
  const messages = [{ role: 'system', content: system }, ...convo];

  const remaining = () => DEADLINE_MS - (Date.now() - t0);
  const usage = { in: 0, out: 0, cached: 0, calls: 0 };
  const addUsage = (u) => { if (!u) return; usage.in += u.prompt_tokens || 0; usage.out += u.completion_tokens || 0; usage.cached += u.prompt_tokens_details?.cached_tokens || 0; };

  let first;
  try {
    try {
      const r = await callGateway({ auth, messages, timeoutMs: Math.min(FIRST_CALL_MS, remaining()) });
      first = parseCompletion(r.data);
    } catch (err) {
      // Some models reject a forced tool choice / reasoning setting: retry once, relaxed.
      if (err instanceof GatewayError && err.status === 400 && remaining() > SECOND_CALL_MIN_MS) {
        console.warn(`[assistant] ${err.message} — retrying with tool_choice auto, provider-default reasoning`);
        const r = await callGateway({ auth, messages, timeoutMs: remaining() - 300, relaxed: true });
        first = parseCompletion(r.data);
      } else throw err;
    }
  } catch (err) {
    const code = err instanceof GatewayError ? err.code : 'gateway';
    console.error(`[assistant] ${err?.message || err}`);
    log(code, { auth: auth.kind });
    return fail(res, lang, code);
  }
  usage.calls++; addUsage(first.usage);

  // ---- validate
  let raw = first.actions;
  let reply = first.reply;
  let chips = first.chips;
  let v = sim.applyActions(st, raw);
  let total = sim.total(v.state.style, v.state.selection);

  // ---- budget: verify, iterate once, then guarantee
  const target = parseBudget(userText) || (/\d/.test(userText) ? first.budget : null);
  let budget = null;
  let iterations = 1;
  if (target && sim.hasBudget()) {
    // The budget slider's planner decides the room (same answer as dragging the slider to `target`); the model's
    // own swaps for the budget are ignored, its style/time/view/focus actions are kept.
    const keep = (Array.isArray(raw) ? raw : []).filter((a) => a && !['select', 'reset', 'budget'].includes(String(a.type || '').toLowerCase()));
    raw = [...keep, { type: 'budget', amount: target }];
    v = sim.applyActions(st, raw);
    total = sim.total(v.state.style, v.state.selection);
    const b = v.actions.find((a) => a.type === 'budget');
    const plan = sim.planBudget(v.state.style, target, { selection: v.state.style === st.style ? st.selection : v.state.selection, pins: v.state.style === st.style ? st.pins : [] });
    const lvl = plan?.level ? (lang === 'en' ? plan.level.nameEn : plan.level.name) : (lang === 'en' ? 'Minimum' : 'Минимум');
    reply = b && total <= target ? TEXT[lang].budgetPlan(aed(lang, target), lvl, aed(lang, total)) : TEXT[lang].budgetMin(aed(lang, plan?.min ?? total));
    budget = { target, total, ok: total <= target, min: plan?.min ?? total, level: plan?.level?.id || null };
  } else if (target) {
    if (total > target && remaining() >= SECOND_CALL_MIN_MS) {
      const en = lang === 'en';
      const fb = en
        ? `Check: after your actions the total is ${cm(total)} AED — ${cm(total - target)} AED over the ${cm(target)} AED budget. The cheapest possible total in style ${v.state.style} is ${cm(sim.minTotal(v.state.style))} AED. Call respond again with the COMPLETE list of actions (including the ones you already gave) so the total is ≤ ${cm(target)} AED.`
        : `Проверка: после твоих действий итог ${cm(total)} AED — на ${cm(total - target)} AED больше бюджета ${cm(target)} AED. Минимально возможный итог в стиле ${v.state.style}: ${cm(sim.minTotal(v.state.style))} AED. Вызови respond ещё раз с ПОЛНЫМ списком действий (включая уже предложенные), чтобы итог был ≤ ${cm(target)} AED.`;
      const prevSummary = `${reply}\n[actions: ${v.actions.map((a) => (a.type === 'select' ? `${a.key}=${a.itemId}` : a.type === 'style' ? `style=${a.styleId}` : `${a.type}${a.name ? `=${a.name}` : ''}`)).join(', ') || 'none'}]`;
      try {
        const r2 = await callGateway({ auth, messages: [...messages, { role: 'assistant', content: prevSummary.slice(0, 1200) }, { role: 'user', content: fb }], timeoutMs: remaining() - 300 });
        const second = parseCompletion(r2.data);
        usage.calls++; addUsage(second.usage); iterations = 2;
        const v2 = sim.applyActions(st, second.actions);
        const t2 = sim.total(v2.state.style, v2.state.selection);
        if (t2 <= target || t2 < total) { raw = second.actions; v = v2; total = t2; reply = second.reply || reply; chips = second.chips?.length ? second.chips : chips; }
      } catch (err) {
        console.warn(`[assistant] budget iteration skipped: ${err?.message || err}`);
      }
    }
    if (total > target) {
      // Deterministic guarantee: fewest further swaps that reach the budget (or the minimum).
      const fit = sim.fitBudget(v.state.style, v.state.selection, target);
      const extra = fit.swaps.map((s) => ({ type: 'select', key: s.key, itemId: s.to }));
      v = sim.applyActions(st, [...raw, ...extra]);
      total = sim.total(v.state.style, v.state.selection);
      const k = v.actions.filter((a) => a.type === 'select').length;
      reply = total <= target ? TEXT[lang].budgetFixed(aed(lang, target), k, aed(lang, total)) : TEXT[lang].budgetMin(aed(lang, sim.minTotal(v.state.style)));
      metric.fixup = extra.length;
    } else if (!v.actions.some((a) => a.type === 'select') && total0 <= target && !reply) {
      reply = TEXT[lang].budgetAlready(aed(lang, total));
    }
    budget = { target, total, ok: total <= target, min: sim.minTotal(v.state.style) };
  }

  reply = sanitizeText(humanize(lang, reply)) || TEXT[lang].empty;
  chips = sanitizeChips(chips);
  if (chips.length < 2) chips = sanitizeChips([...chips, ...defaultChips(lang, { total, time: st.time, view: st.view })]);

  log('ok', { auth: auth.kind, actions: v.actions.length, dropped: v.dropped.length, budget: !!target, iterations, calls: usage.calls, inTok: usage.in, outTok: usage.out, cachedTok: usage.cached });
  return send(res, 200, { reply, actions: v.actions, chips, ...(budget ? { budget } : {}), total, source: 'ai' });
}

// Test hooks (not part of the HTTP contract).
export const _test = { setIndexForTests: setIndex, buildIndexFromData: buildAiIndex, systemPrompt, cleanTurns, parseCompletion, rateLimited };
