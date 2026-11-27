// POST /api/lead — "Order the set": a customer leaves a contact for the room they assembled.
//
// The client sends its contact fields plus the room snapshot ({ style, selection }). The server never trusts
// the client's prices: it re-prices the selection from the published catalog index (api/_catalog.js), stores
// the lead, and notifies the team. Supplier names, links and SKUs never leave the server (only public item
// names and Villar prices are stored and sent).
//
// Storage: Supabase project "villar" → RPC public.submit_lead(p jsonb) (db/leads.sql). The publishable key is
// public by design: with it one can only call submit_lead (constraints + 5/day per phone); the table itself is
// not readable or writable. SUPABASE_URL / SUPABASE_KEY env vars override the defaults.
// Notifications: a database trigger sends every new lead to Telegram (bot token + chat id in Supabase Vault), so
// leads are announced however they arrive. Only if storage fails does this function notify on its own
// (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID and/or RESEND_API_KEY + LEAD_EMAIL_TO env vars), so a real customer is
// never lost; with neither working it answers 503 and the UI keeps the form filled.
import INDEX from './_catalog.js';
import { createSim } from '../site/js/ai/core.js';

const MAX_BODY = 8 * 1024;
const RATE = [{ windowMs: 10 * 60_000, max: 4 }, { windowMs: 24 * 3_600_000, max: 12 }];
const MIN_FILL_MS = 2500; // humans don't fill a form in under ~2.5 s
const sim = createSim(INDEX);

const env = (k) => (process.env[k] || '').trim();
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
  try { b = req.body; } catch { return null; }
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return JSON.stringify(b).length > MAX_BODY ? null : b;
  let raw = typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString('utf8') : '';
  if (!raw && typeof req.on === 'function') {
    raw = await new Promise((resolve) => {
      let s = ''; let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) s += c; });
      req.on('end', () => resolve(size > MAX_BODY ? null : s));
      req.on('error', () => resolve(null));
    });
    if (raw == null) return null;
  }
  if (raw.length > MAX_BODY) return null;
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------- validation
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Returns { lead } or { error, field }. */
export function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'bad_request' };
  if (clean(body.company, 50)) return { error: 'spam' };                      // honeypot field, hidden from humans
  const openedMs = Number(body.openedMs);
  if (Number.isFinite(openedMs) && openedMs >= 0 && openedMs < MIN_FILL_MS) return { error: 'spam' };
  if (body.consent !== true) return { error: 'invalid', field: 'consent' };

  const name = clean(body.name, 80);
  if (name.length < 2) return { error: 'invalid', field: 'name' };
  const phoneRaw = clean(body.phone, 30);
  const digits = phoneRaw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || !/^\+?[\d\s()-]+$/.test(phoneRaw)) return { error: 'invalid', field: 'phone' };
  const phone = (phoneRaw.trim().startsWith('+') ? '+' : '') + digits;
  const email = clean(body.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return { error: 'invalid', field: 'email' };
  const comment = clean(body.comment, 600);
  const contact = ['phone', 'whatsapp', 'email'].includes(body.contact) ? body.contact : 'whatsapp';
  const lang = ['ru', 'en', 'ar'].includes(body.lang) ? body.lang : 'ru';

  // Re-price the room from the published index — never trust client prices.
  const style = sim.pack(body.style) ? body.style : INDEX.default;
  const selection = sim.normalizeSelection(style, body.selection && typeof body.selection === 'object' ? body.selection : {});
  const items = [];
  for (const key of sim.placedKeys(style)) {
    const it = sim.items.get(selection[key]);
    if (!it) continue;
    const qty = sim.qty(style, key);
    items.push({ key, id: it.id, name: it.name, nameEn: it.nameEn || it.name, qty, price: Math.round(it.price), sum: Math.round(it.price) * qty });
  }
  const total = items.reduce((a, l) => a + l.sum, 0);
  if (!items.length || total <= 0) return { error: 'invalid', field: 'room' };
  const pack = sim.pack(style);
  return { lead: { name, phone, email: email || null, comment: comment || null, contact, lang, style, styleName: pack?.name || style, styleNameEn: pack?.nameEn || style, total, items } };
}

// ---------------------------------------------------------------- storage + notifications
const SUPABASE_URL = 'https://hdhwkvbecuzzrugogutd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PNx3u8YmdyhZD5Zc-3LzjQ_zQYLq2Ni';
async function store(lead) {
  const url = env('SUPABASE_URL') || SUPABASE_URL; const key = env('SUPABASE_KEY') || SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { error: 'not_configured' };
  const p = { name: lead.name, phone: lead.phone, email: lead.email, comment: lead.comment, contact: lead.contact, lang: lead.lang, style: lead.style, styleName: lead.styleName, total: lead.total, items: lead.items.map(({ id, name, qty, price, sum }) => ({ id, name, qty, price, sum })) };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/submit_lead`, {
      method: 'POST', signal: ctl.signal,
      // Secret keys (sb_secret_…) go in `apikey` only; publishable/legacy keys also as a bearer token.
      headers: { 'content-type': 'application/json', apikey: key, ...(key.startsWith('sb_secret_') ? {} : { authorization: `Bearer ${key}` }) },
      body: JSON.stringify({ p }),
    });
    if (!r.ok) { console.error('[lead] store HTTP', r.status, (await r.text()).slice(0, 300)); return { error: 'store_failed' }; }
    const id = await r.json();
    return { id: typeof id === 'string' ? id : null };
  } catch (err) {
    console.error('[lead] store failed', err?.name || err);
    return { error: 'store_failed' };
  } finally { clearTimeout(t); }
}

const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
function summary(lead, id) {
  const head = `Новая заявка Villar${id ? ` · ${id.slice(0, 8)}` : ''}`;
  const contactRu = { phone: 'звонок', whatsapp: 'WhatsApp', email: 'e-mail' }[lead.contact];
  const lines = lead.items.map((l) => `• ${l.name}${l.qty > 1 ? ` × ${l.qty}` : ''} — ${fmt(l.sum)} AED`);
  return [
    head,
    `${lead.name} · ${lead.phone}${lead.email ? ` · ${lead.email}` : ''}`,
    `Связаться: ${contactRu} · язык: ${lead.lang.toUpperCase()}`,
    `Стиль: ${lead.styleName} · итого ${fmt(lead.total)} AED · ${lead.items.length} позиций`,
    lead.comment ? `Комментарий: ${lead.comment}` : '',
    '',
    ...lines,
  ].filter((x) => x !== '').join('\n');
}

async function notify(lead, id) {
  const text = summary(lead, id);
  const jobs = [];
  const tg = env('TELEGRAM_BOT_TOKEN'); const chat = env('TELEGRAM_CHAT_ID');
  if (tg && chat) {
    jobs.push(fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
    }).then((r) => { if (!r.ok) console.error('[lead] telegram HTTP', r.status); }));
  }
  const rk = env('RESEND_API_KEY'); const to = env('LEAD_EMAIL_TO');
  if (rk && to) {
    jobs.push(fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${rk}` },
      body: JSON.stringify({ from: env('LEAD_EMAIL_FROM') || 'Villar <onboarding@resend.dev>', to: to.split(',').map((s) => s.trim()), subject: `Villar: заявка ${lead.name}, ${fmt(lead.total)} AED`, text }),
    }).then((r) => { if (!r.ok) console.error('[lead] email HTTP', r.status); }));
  }
  const ctl = Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 4000))]);
  await ctl;
  return jobs.length;
}

// ---------------------------------------------------------------- handler
export default async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, { ok: true });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }

  const origin = header(req, 'origin');
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (origin && host) {
    let oh = ''; try { oh = new URL(origin).host; } catch { oh = 'invalid'; }
    if (oh !== host) return send(res, 403, { ok: false, error: 'forbidden' });
  }
  if (rateLimited(clientIp(req))) return send(res, 429, { ok: false, error: 'rate_limited' });

  const body = await readBody(req);
  const v = validate(body);
  if (v.error === 'spam') return send(res, 200, { ok: true }); // don't teach bots what tripped them
  if (v.error) return send(res, 400, { ok: false, error: v.error, field: v.field || null });

  const saved = await store(v.lead);
  if (saved.error) {
    // Still try to reach the team so a real customer isn't lost when the database is down or not set up yet.
    const sent = await notify(v.lead, null).catch(() => 0);
    if (sent) return send(res, 200, { ok: true, id: null, total: v.lead.total });
    return send(res, 503, { ok: false, error: saved.error });
  }
  console.info(JSON.stringify({ ev: 'lead', id: saved.id, style: v.lead.style, total: v.lead.total, n: v.lead.items.length }));
  return send(res, 200, { ok: true, id: saved.id, total: v.lead.total });
}

export const _test = { validate, summary, rateLimited };
