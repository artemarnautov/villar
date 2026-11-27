// POST /api/photo-hook — Higgsfield job webhook (Standard Webhooks signature, HIGGSFIELD_WEBHOOK_SECRET). Owner: photo.
//
// api/photo.js and api/plate.js register `?hf_webhook=<this URL>` on submit only when the secret is set. A delivery is a
// trigger, not a source of truth: after the signature check we look the job up by request_id and re-read its status
// from the authenticated status endpoint (completePending / completePlate), then copy the output into Storage.
// 2xx = recorded (Higgsfield stops retrying); 5xx = try again (it retries network failures and 5xx for two hours).
import { supa, verifyWebhook, send, env, loadConfig } from './_photo.js';
import { completePending } from './photo.js';
import { completePlate } from './plate.js';

const MAX_BODY = 64 * 1024;

async function rawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.on === 'function' && req.readable !== false) {
    const buf = await new Promise((resolve) => {
      const chunks = []; let size = 0; let over = false;
      req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); else over = true; });
      req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
      req.on('error', () => resolve(null));
    });
    if (buf && buf.length) return buf;
  }
  // already consumed by a body parser: only a string/Buffer body keeps the exact bytes the signature covers
  let b; try { b = req.body; } catch { b = null; }
  if (typeof b === 'string') return Buffer.from(b);
  if (Buffer.isBuffer(b)) return b;
  return null;
}

const lower = (h) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!env('HIGGSFIELD_WEBHOOK_SECRET')) return send(res, 404, { error: 'not_configured' });
  const raw = await rawBody(req);
  if (!raw) return send(res, 400, { error: 'bad_request' });
  if (!verifyWebhook(raw, lower(req.headers))) return send(res, 401, { error: 'bad_signature' });
  let evt;
  try { evt = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'bad_request' }); }
  const requestId = typeof evt?.request_id === 'string' && /^[a-f0-9-]{16,64}$/i.test(evt.request_id) ? evt.request_id : null;
  if (!requestId) return send(res, 400, { error: 'bad_request' });
  const db = supa();
  if (!db) return send(res, 503, { error: 'not_configured' });
  await loadConfig(db); // cost / path overrides
  let row;
  try { row = await db.rowByRequest(requestId); } catch (e) { console.error(`[photo-hook] lookup failed: ${e.message}`); return send(res, 503, { error: 'store_failed' }); }
  if (!row || row.status !== 'pending') return send(res, 200, { ok: true, ignored: true }); // unknown or already finished (duplicate)
  if (row.kind === 'edition') return send(res, 200, { ok: true, queued: true });            // the job queue resumes editions
  try {
    const out = row.kind === 'plate' ? await completePlate(db, row) : await completePending(db, row);
    console.info(JSON.stringify({ ev: 'photo.hook', kind: row.kind, key: row.key.slice(0, 16), status: evt.status, result: out?.url || out?.done ? 'stored' : out?.pending ? 'pending' : 'failed' }));
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(`[photo-hook] finishing ${row.key.slice(0, 16)} failed: ${e?.message || e}`);
    return send(res, 500, { error: 'retry' });
  }
}
