// Offline tests for api/photo.js and api/plate.js (Live → Photo). Owner: photo.
//   node tools/test-photo.mjs
// The gateway and Supabase are mocked (global fetch), so this runs without network or credentials.
import { deflateSync } from 'node:zlib';
import { createHmac, randomUUID } from 'node:crypto';
import { encodeJPEG, jpegSize, sniff } from '../api/_img.js';

process.env.SUPABASE_KEY = 'sb_secret_test';
process.env.AI_GATEWAY_API_KEY = 'test-key';
delete process.env.PHOTO_DISABLED;
const photoMod = await import('../api/photo.js');
const plateMod = await import('../api/plate.js');
const photo = photoMod.default;
const plate = plateMod.default;
const hook = (await import('../api/photo-hook.js')).default;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } };
const section = (s) => console.log(`— ${s}`);

// ------------------------------------------------------------------------------------------- fixtures
function png(w, h, rgb = [180, 160, 140]) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (rgb[0] + x) & 255; raw[o + 1] = (rgb[1] + y) & 255; raw[o + 2] = rgb[2]; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** A small valid GLB: one mesh with `faces` triangles (indices accessor), optional extensions. */
function glbFile({ faces = 1200, ext = null, binBytes = 300_000 } = {}) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0', generator: 'mock-3d' }, ...(ext ? { extensionsUsed: [ext] } : {}), buffers: [{ byteLength: binBytes }], accessors: [{ count: faces * 3 }, { count: faces }], meshes: [{ primitives: [{ indices: 0, attributes: { POSITION: 1 } }] }], images: [{ bufferView: 0, mimeType: 'image/png' }] }));
  const jpad = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = Buffer.alloc(binBytes, 7);
  const head = Buffer.alloc(12); head.write('glTF', 0, 'ascii'); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jpad.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jpad.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, jpad, bh, bin]);
}
const frameJpeg = (w = 320, h = 180) => { const d = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 255)); return encodeJPEG({ width: w, height: h, data: d }, 80); };
const FRAME = `data:image/jpeg;base64,${frameJpeg().toString('base64')}`;
const SEL = { sofa: 'sofa-lansbury-3' };
const STATE = (over = {}) => ({ style: 'dark-walnut', time: 'day', selection: SEL, pose: 'c:2.31,1.55,0.42;d:0.12,-0.08,0.99;f:58.0;s:0,0;a:1.85;m:0', aspect: '16:9', size: '2K', ...over });

// ------------------------------------------------------------------------------------------- mocks
const db = { rows: new Map(), objects: new Map(), quota: new Map(), locks: new Map(), rpc: [], puts: 0, jobs: [], jobSeq: 0, config: new Map([['visitors', true]]), configFail: false, configReads: 0, streamed: 0 };
const gw = { calls: [], mode: 'ok', bodies: [] };
const hf = { calls: [], bodies: [], estimates: [], jobs: new Map(), mode: 'ok', uploads: 0, price: { '/xai/grok-imagine-image-2.0': 0.07, '/alibaba/qwen-image-3/edit': 0.04, '/alibaba/qwen-image-3/text-to-image': 0.04, '/marketing-studio/image': 0.452, '/z-image/turbo': 0.015 } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://ai-gateway.vercel.sh/v1/')) {
    const body = JSON.parse(opts.body);
    gw.calls.push(url.replace('https://ai-gateway.vercel.sh/v1', '')); gw.bodies.push(body);
    const mode = typeof gw.mode === 'function' ? gw.mode(body) : gw.mode;
    if (mode === '402') return json(402, { error: { message: 'Billing is not enabled for this team' } });
    if (mode === '403') return json(403, { error: { message: 'Free tier users do not have access to this model' } });
    if (mode === '404') return json(404, { error: { message: 'model not found' } });
    if (mode === '400') return json(400, { error: { message: 'could not fetch image_url' } });
    if (mode === 'slow') await new Promise((r) => setTimeout(r, 120));
    const img = png(640, 360).toString('base64');
    if (url.endsWith('/chat/completions')) return json(200, { choices: [{ message: { role: 'assistant', content: 'Here is the photo.', images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } }] } }], usage: { prompt_tokens: 3000, completion_tokens: 1300 } });
    return json(200, { data: [{ b64_json: img }] });
  }
  if (url.startsWith('https://api.higgsfield.ai/') || url.startsWith('https://hf-')) {
    const u = new URL(url); const p = u.pathname; const method = opts.method || 'GET';
    if (u.host === 'hf-upload.test') { hf.uploads++; return new Response(null, { status: 200 }); }
    if (u.host === 'hf-cdn.test' && p.endsWith('.mp4')) return new Response(Buffer.alloc(120_000, 3), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '120000' } });
    if (u.host === 'hf-cdn.test' && p.endsWith('.glb')) { const g = hf.glb || glbFile(); return new Response(g, { status: 200, headers: { 'content-type': 'model/gltf-binary', 'content-length': String(g.length) } }); }
    if (u.host === 'hf-cdn.test') return new Response(png(512, 288), { status: 200, headers: { 'content-type': 'image/png' } });
    if (opts.headers?.Authorization !== 'Key kid:ksec') return json(401, { detail: 'Invalid credentials' });
    hf.calls.push(`${method} ${p}`);
    if (p === '/files/generate-upload-url') return json(200, { public_url: `https://hf-cdn.test/in/${hf.calls.length}.jpg`, upload_url: `https://hf-upload.test/put/${hf.calls.length}`, content_type: 'image/jpeg', upload_headers: { 'Content-Type': 'image/jpeg', 'x-amz-tagging': 'retention=temporary' } });
    if (method === 'POST' && !p.startsWith('/requests/')) {
      const body = JSON.parse(opts.body);
      const est = p.startsWith('/estimate/');
      const path = est ? p.slice('/estimate'.length) : p;
      const mode = typeof hf.mode === 'function' ? hf.mode(path, body) : hf.mode;
      if (mode === '403') return json(403, { detail: 'Insufficient balance' });
      if (mode === '404') return json(404, { detail: 'Model not found' });
      if (mode === '503') return json(503, { detail: 'model_disabled' });
      if (mode === '422') return json(422, { detail: [{ loc: ['body', 'face_count'], msg: 'Additional properties are not allowed' }] });
      if (est) { hf.estimates.push({ path, body }); return json(200, { usd: String(hf.price[path] ?? 0.07) }); }
      hf.bodies.push({ path: p, body, idem: opts.headers['Idempotency-Key'], webhook: u.searchParams.get('hf_webhook') });
      const id = randomUUID(); hf.jobs.set(id, { polls: 0, mode, kind: /to-3d/.test(p) ? '3d' : /video/.test(p) ? 'video' : 'image' });
      return json(200, { status: 'queued', request_id: id, status_url: `https://api.higgsfield.ai/requests/${id}/status`, cancel_url: `https://api.higgsfield.ai/requests/${id}/cancel`, expires_after: 604800 });
    }
    const m = p.match(/^\/requests\/([a-f0-9-]+)\/status$/);
    if (m) {
      const j = hf.jobs.get(m[1]); if (!j) return json(404, { detail: 'not found' });
      j.polls++;
      if (j.mode === 'nsfw') return json(200, { status: 'nsfw', request_id: m[1] });
      if (j.mode === 'slow' && !j.release) return json(200, { status: 'in_progress', request_id: m[1] });
      if (j.polls < 2) return json(200, { status: j.polls === 1 ? 'queued' : 'in_progress', request_id: m[1] });
      if (j.kind === 'video') return json(200, { status: 'completed', request_id: m[1], video: { url: `https://hf-cdn.test/out/${m[1]}.mp4` } });
      if (j.kind === '3d') return json(200, { status: 'completed', request_id: m[1], model_mesh: { url: `https://hf-cdn.test/out/${m[1]}.glb`, content_type: 'model/gltf-binary' }, rendered_image: { url: `https://hf-cdn.test/out/${m[1]}.png` } });
      return json(200, { status: 'completed', request_id: m[1], expires_at: '2026-12-04T00:00:00Z', images: [{ url: `https://hf-cdn.test/out/${m[1]}.png` }] });
    }
    return json(404, { detail: `mock: no hf route ${method} ${p}` });
  }
  if (url.startsWith('https://hdhwkvbecuzzrugogutd.supabase.co')) {
    const u = new URL(url); const p = u.pathname;
    if (p.startsWith('/storage/v1/object/public/photos/')) {
      const o = db.objects.get(p.slice('/storage/v1/object/public/photos/'.length));
      return o ? new Response(o.bytes, { status: 200, headers: { 'content-type': o.type } }) : json(400, { error: 'not found' });
    }
    if (opts.headers?.apikey !== 'sb_secret_test' || opts.headers?.authorization) return json(401, { message: 'bad key header' });
    if (p === '/storage/v1/bucket/photos') return json(200, { id: 'photos', name: 'photos', public: true });
    if (p === '/storage/v1/object/copy' && opts.method === 'POST') { const c = JSON.parse(opts.body); const o = db.objects.get(c.sourceKey); if (!o) return json(404, { error: 'not found' }); db.objects.set(c.destinationKey, { ...o }); return json(200, { Key: `photos/${c.destinationKey}` }); }
    if (p === '/storage/v1/object/photos' && opts.method === 'DELETE') { for (const k of JSON.parse(opts.body).prefixes || []) db.objects.delete(k); return json(200, []); }
    if (p === '/rest/v1/photo_config') { db.configReads++; return db.configFail ? json(404, { message: 'relation "public.photo_config" does not exist' }) : json(200, [...db.config].map(([name, value]) => ({ name, value }))); }
    if (p === '/rest/v1/photo_jobs' && opts.method === 'PATCH') {
      const id = Number(u.searchParams.get('id').replace('eq.', '')); const j = db.jobs.find((x) => x.id === id);
      if (j) Object.assign(j, JSON.parse(opts.body)); return new Response(null, { status: 204 });
    }
    if (p === '/rest/v1/photo_jobs') {
      const st = u.searchParams.get('status') || '';
      let list = db.jobs.filter((j) => (st.startsWith('in.') ? st.slice(4, -1).split(',').includes(j.status) : st.startsWith('eq.') ? j.status === st.slice(3) : true));
      if (st === 'eq.failed') list = list.sort((x, y) => String(y.finished_at).localeCompare(String(x.finished_at)));
      return json(200, list.slice(0, Number(u.searchParams.get('limit') || 500)));
    }

    if (p.startsWith('/storage/v1/object/photos/') && opts.method === 'POST') {
      const path = p.slice('/storage/v1/object/photos/'.length);
      if (db.objects.has(path) && opts.headers['x-upsert'] !== 'true') return json(400, { error: 'Duplicate' });
      if (gw.mode === 'slow' || hf.mode === 'slow') await new Promise((r) => setTimeout(r, 5));
      const streamed = typeof opts.body?.getReader === 'function';
      if (streamed) db.streamed++;
      db.objects.set(path, { bytes: streamed ? Buffer.from(await new Response(opts.body).arrayBuffer()) : Buffer.from(opts.body), type: opts.headers['content-type'] }); db.puts++;
      return json(200, { Key: `photos/${path}` });
    }
    if (p === '/rest/v1/photo_renders' && (opts.method || 'GET') === 'GET' && u.searchParams.get('request_id')) {
      const rid = u.searchParams.get('request_id').replace(/^eq\./, '');
      return json(200, [...db.rows.values()].filter((r) => r.request_id === rid).slice(0, 1));
    }
    if (p === '/rest/v1/photo_renders' && (opts.method || 'GET') === 'GET') {
      const m = decodeURIComponent(u.search).match(/key=in\.\(([^)]*)\)/);
      const keys = m ? m[1].split(',').map((s) => s.replace(/"/g, '')) : [];
      return json(200, keys.map((k) => db.rows.get(k)).filter(Boolean));
    }
    if (p === '/rest/v1/photo_renders' && opts.method === 'POST') {
      const row = JSON.parse(opts.body); const prev = db.rows.get(row.key) || { rejects: 0, source: 'user' };
      db.rows.set(row.key, { ...prev, ...row, updated_at: row.updated_at || new Date().toISOString() }); return new Response(null, { status: 201 });
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length); const a = JSON.parse(opts.body); db.rpc.push(fn);
      if (fn === 'photo_take_quota') {
        if (db.quotaFull) return json(200, false);
        for (const s of a.p_subjects) db.quota.set(s, (db.quota.get(s) || 0) + 1); return json(200, true);
      }
      if (fn === 'photo_refund_quota') { for (const s of a.p_subjects) db.quota.set(s, Math.max(0, (db.quota.get(s) || 0) - 1)); return json(200, null); }
      if (fn === 'photo_reject') { const r = db.rows.get(a.p_key); if (r) { r.rejects++; if (r.source === 'user') r.status = 'rejected'; r.updated_at = new Date().toISOString(); } return json(200, r?.rejects ?? null); }
      if (fn === 'photo_claim_job') {
        const j = db.jobs.filter((x) => x.status === 'queued' || (x.status === 'running' && (!x.locked_until || Date.parse(x.locked_until) < Date.now()))).sort((x, y) => x.created_at.localeCompare(y.created_at))[0];
        if (!j) return json(200, []);
        Object.assign(j, { status: 'running', attempts: j.attempts + 1, locked_until: new Date(Date.now() + a.p_lease_seconds * 1000).toISOString() });
        return json(200, [{ ...j }]);
      }
      if (fn === 'photo_lock') { const l = db.locks.get(a.p_key); if (l && l.until > Date.now() && l.owner !== a.p_owner) return json(200, false); db.locks.set(a.p_key, { owner: a.p_owner, until: Date.now() + a.p_ttl_seconds * 1000 }); return json(200, true); }
      if (fn === 'photo_unlock') { const l = db.locks.get(a.p_key); if (l?.owner === a.p_owner) db.locks.delete(a.p_key); return json(200, null); }
    }
    return json(404, { message: `mock: no route ${opts.method || 'GET'} ${p}` });
  }
  return realFetch(url, opts);
};

const logs = [];
const origInfo = console.info, origWarn = console.warn, origErr = console.error;
console.info = (...a) => logs.push(a.join(' '));
console.warn = (...a) => logs.push(`[warn] ${a.join(' ')}`);
console.error = (...a) => { logs.push(`[error] ${a.join(' ')}`); if (String(a[0]).startsWith('  ✗')) origErr(...a); };

let ipN = 1;
async function call(fn, { method = 'POST', body, ip, headers = {} } = {}) {
  const req = { method, headers: { 'x-forwarded-for': ip || `10.0.0.${ipN++}`, host: 'villar.test', ...headers }, body, query: {} };
  if (method === 'GET' && body) req.query = body;
  let out = null;
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { out = s ? JSON.parse(s) : null; } };
  await fn(req, res);
  return { status: res.statusCode, body: out, headers: res.headers };
}

// ------------------------------------------------------------------------------------------- photo
section('GET status');
let r = await call(photo, { method: 'GET' });
ok(r.body.ok && r.body.enabled && r.body.generate, 'GET reports enabled + generate');
ok(!JSON.stringify(r.body).match(/key|secret|homecent/i) || !JSON.stringify(r.body).includes('sb_secret'), 'GET leaks no secret');

section('validation');
r = await call(photo, { body: { op: 'lookup', state: STATE() } });
ok(r.status === 400, 'missing v → 400');
r = await call(photo, { body: { v: 1, op: 'nope', state: STATE() } });
ok(r.status === 400, 'bad op → 400');
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE({ style: 'ikea-ish' }) } });
ok(r.status === 400, 'unknown style → 400');
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE({ pose: '<script>' }) } });
ok(r.status === 400, 'bad pose → 400');
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE({ aspect: '7:3' }) } });
ok(r.status === 400, 'bad aspect → 400');
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE({ time: 'noon' }) } });
ok(r.status === 400, 'bad time → 400');
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE(), frame: 'data:image/png;base64,' + png(100, 100).toString('base64') } });
ok(r.status === 400, 'PNG frame → 400');
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE(), frame: `data:image/jpeg;base64,${frameJpeg(2400, 1200).toString('base64')}` } });
ok(r.status === 400, 'frame over 2048 px → 400');
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE(), frame: 'data:image/jpeg;base64,' + Buffer.alloc(1.7 * 1024 * 1024, 1).toString('base64') } });
ok(r.status === 413 || r.status === 400, `oversize frame → ${r.status}`);
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE() }, headers: { origin: 'https://evil.example' } });
ok(r.status === 403, 'cross-origin → 403');

section('kill switch');
process.env.PHOTO_DISABLED = '1';
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE() } });
ok(r.body.error === 'disabled', 'PHOTO_DISABLED=1 → disabled');
r = await call(photo, { method: 'GET' });
ok(r.body.enabled === false && r.body.generate === false, 'GET reports disabled');
process.env.PHOTO_DISABLED = 'generate';
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE(), frame: FRAME } });
ok(r.body.error === 'disabled', 'PHOTO_DISABLED=generate blocks develop');
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE() } });
ok(r.body.hit === false, 'PHOTO_DISABLED=generate keeps lookups');
delete process.env.PHOTO_DISABLED;

section('miss → develop → hit');
const items = [{ id: 'sofa-lansbury-3', area: 0.21 }, { id: 'not-in-selection', area: 0.1 }, ...['armchair-emma', 'rug-x'].map((id) => ({ id, area: 0.05 }))];
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE() } });
ok(r.body.hit === false && /^[a-f0-9]{64}$/.test(r.body.key), 'lookup miss returns key');
const key0 = r.body.key;
gw.calls = []; gw.bodies = [];
const t0 = Date.now();
r = await call(photo, { body: { v: 1, op: 'develop', session: 'sessABCDEFGH', state: STATE(), items, frame: FRAME } });
const devMs = Date.now() - t0;
ok(r.body.url && r.body.key === key0 && r.body.model === 'google/gemini-3.1-flash-image' && Number.isFinite(r.body.ms), `develop → {url,key,model,ms} (${JSON.stringify(r.body).slice(0, 160)})`);
ok(gw.calls.length === 1 && gw.calls[0] === '/chat/completions', 'one chat completion call');
const b0 = gw.bodies[0];
ok(b0.model === 'google/gemini-3.1-flash-image' && b0.modalities.join() === 'text,image', 'model + modalities');
ok(b0.providerOptions.google.imageConfig.aspectRatio === '16:9' && b0.providerOptions.google.imageConfig.imageSize === '2K', 'aspect + size forwarded');
const parts = b0.messages[0].content;
const imgParts = parts.filter((p) => p.type === 'image_url');
ok(imgParts[0].image_url.url.startsWith('data:image/jpeg;base64,'), 'image 1 is the frame');
ok(imgParts.length === 3, `refs: the visible sofa + the selected artwork, nothing unselected (got ${imgParts.length - 1})`);
ok(imgParts[1].image_url.url.startsWith('https://'), 'ref is an https URL');
const promptText = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
ok(/^Photograph of this exact interior\. Keep the camera, framing and every object exactly as shown/.test(promptText) && /add, remove or move nothing/.test(promptText) && /Lansbury 3-seater sofa/.test(promptText) && /artwork on the wall/.test(promptText) && /Warm, calm, gallery-like/.test(promptText), 'ART §2 skeleton + style vocabulary + item and artwork captions');
ok(!/home\s*cent|homecentre|amplience/i.test(promptText), 'no supplier name in the prompt text');
ok(!/homecentre|amplience/i.test(JSON.stringify(r.body)), 'no supplier URL in the response');
const stored = [...db.objects.values()].pop();
ok(stored && sniff(stored.bytes) === 'image/jpeg' && jpegSize(stored.bytes)?.width === 640, 'PNG transcoded to JPEG in Storage');
ok(r.body.url.startsWith('https://hdhwkvbecuzzrugogutd.supabase.co/storage/v1/object/public/photos/v1/'), 'public URL');
const gen = logs.find((l) => l.includes('"ev":"photo.gen"'));
ok(gen && JSON.parse(gen).usd === 0.101, `cost log line (${gen?.slice(0, 120)})`);
ok(db.rows.get(key0)?.cost_usd === 0.101 && db.rows.get(key0)?.refs === 2, 'row has cost + refs');
ok(db.quota.get('global') === 1, 'quota taken once');

r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE() } });
ok(r.body.hit === true && r.body.key === key0 && r.body.url, 'lookup hit after develop');
gw.calls = [];
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE(), items, frame: FRAME } });
ok(r.body.cached === true && gw.calls.length === 0, 'develop on a cached state does not call the model');

section('key');
const { keyFor, cleanState } = photoMod._test;
const k1 = keyFor('m', cleanState(STATE()).state), k2 = keyFor('m', cleanState(STATE({ selection: { sofa: null } })).state);
const k3 = keyFor('m', cleanState(STATE({ time: 'golden' })).state), k4 = keyFor('m', cleanState(STATE({ pose: STATE().pose.replace('2.31', '2.33') })).state);
ok(new Set([k1, k2, k3, k4]).size === 4, 'selection / time / pose change the key');
ok(keyFor('m', cleanState(STATE({ selection: { sofa: 'sofa-lansbury-3', bogus: 'x' } })).state) === k1, 'unknown selection keys do not change the key');
ok(keyFor('m2', cleanState(STATE()).state) !== k1, 'model changes the key');

section('reject → unstable');
r = await call(photo, { body: { v: 1, op: 'reject', key: key0, score: 0.21 } });
ok(r.body.ok && db.rows.get(key0).status === 'rejected', 'reject marks the user photo rejected');
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE() } });
ok(r.body.hit === false, 'rejected photo is not served');
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE(), items, frame: FRAME } });
ok(r.body.url && db.rows.get(key0).status === 'ok', 'regenerated after one reject');
await call(photo, { body: { v: 1, op: 'reject', key: key0, score: 0.2 } });
r = await call(photo, { body: { v: 1, op: 'lookup', state: STATE() } });
ok(r.body.hit === false && r.body.unstable === true, 'two rejects → unstable flag');
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE(), items, frame: FRAME } });
ok(r.body.error === 'unstable', 'unstable state is not regenerated');

section('fallbacks');
const S2 = STATE({ time: 'golden' });
gw.calls = []; gw.mode = (b) => (b.model === 'google/gemini-3.1-flash-image' ? '404' : 'ok');
r = await call(photo, { body: { v: 1, op: 'develop', state: S2, items, frame: FRAME } });
ok(r.body.model === 'google/gemini-3.1-flash-image-preview' && gw.calls.length === 2, 'unknown model id → next model in the list');
gw.calls = []; gw.bodies = [];
gw.mode = (b) => (b.messages[0].content.filter((p) => p.type === 'image_url').length > 1 ? '400' : 'ok');
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ time: 'morning' }), items, frame: FRAME } });
ok(r.body.url && gw.calls.length === 2 && gw.bodies[1].messages[0].content.filter((p) => p.type === 'image_url').length === 1, '400 with refs → retried without refs');

section('billing off (402) → silent + breaker');
gw.calls = []; gw.mode = '402';
const q0 = db.quota.get('global');
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ time: 'evening' }), items, frame: FRAME } });
ok(r.body.error === 'unavailable' && gw.calls.length === 1, '402 → unavailable, no second model tried');
ok(db.quota.get('global') === q0, 'quota refunded after a failed generation');
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ time: 'evening', size: '1K' }), items, frame: FRAME } });
ok(r.body.error === 'unavailable' && gw.calls.length === 1, 'breaker: next develop fails fast without calling the gateway');
r = await call(photo, { method: 'GET' });
ok(r.body.generate === false, 'GET reports generate:false while the breaker is open');
photoMod._test.resetBreaker(); gw.mode = 'ok';

section('limits');
const ip = '10.9.9.9';
let limited = 0;
for (let i = 0; i < 6; i++) {
  r = await call(photo, { ip, body: { v: 1, op: 'develop', state: STATE({ pose: `c:${i},1,1;d:0,0,1;f:58;s:0,0;a:1.85;m:0` }), items, frame: FRAME } });
  if (r.body.error === 'rate_limited') limited++;
}
ok(limited === 2, `IP limit 4/min (rate_limited ${limited}×)`);
db.quotaFull = true;
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ pose: 'c:9,9,9;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.error === 'quota', 'daily cap → quota');
db.quotaFull = false;

section('in-flight dedupe');
gw.calls = []; gw.mode = 'slow';
const S3 = STATE({ pose: 'c:7,7,7;d:0,0,1;f:58;s:0,0;a:1.85;m:0' });
const [ra, rb] = await Promise.all([call(photo, { body: { v: 1, op: 'develop', state: S3, items, frame: FRAME } }), call(photo, { body: { v: 1, op: 'develop', state: S3, items, frame: FRAME } })]);
ok(ra.body.url && ra.body.url === rb.body.url && gw.calls.length === 1, 'two concurrent requests → one generation');
gw.mode = 'ok';

section('stub provider (server)');
process.env.PHOTO_PROVIDER = 'stub';
gw.calls = [];
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ pose: 'c:5,5,5;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.url && gw.calls.length === 0, 'PHOTO_PROVIDER=stub stores the frame without calling the gateway');
delete process.env.PHOTO_PROVIDER;

// ------------------------------------------------------------------------------------------- Higgsfield (primary)
section('Higgsfield: primary provider, async job');
// key discovery: the founder's single HIGGSFIELD_KEY = id:secret is the primary name
const { hfCredentials } = await import('../api/_photo.js');
process.env.HF_API_KEY = 'a'; process.env.HF_API_SECRET = 'b';
ok(hfCredentials()?.source === 'HF_API_KEY' && hfCredentials().header === 'Key a:b', 'fallback HF_API_KEY + HF_API_SECRET');
process.env.HIGGSFIELD_API_KEY = 'x'; process.env.HIGGSFIELD_API_SECRET = 'y';
ok(hfCredentials()?.source === 'HIGGSFIELD_API_KEY' && hfCredentials().header === 'Key x:y', 'HIGGSFIELD_API_KEY + _SECRET before HF_*');
process.env.HIGGSFIELD_KEY = 'barekey';
ok(hfCredentials()?.source === 'HIGGSFIELD_KEY' && hfCredentials().pair === false, 'HIGGSFIELD_KEY first; a bare key is flagged');
r = await call(photo, { method: 'GET', body: { diag: '1' } });
ok(r.body.providers.higgsfield.configured && r.body.providers.higgsfield.authOk === false && r.body.providers.higgsfield.hint === 'HIGGSFIELD_KEY should be id:secret', `diag: bare key → authOk false + hint (${JSON.stringify(r.body.providers.higgsfield)})`);
ok(!JSON.stringify(r.body).includes('barekey') && !JSON.stringify(r.body).includes('sb_secret'), 'diag never echoes a value');
for (const k of ['HF_API_KEY', 'HF_API_SECRET', 'HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET']) delete process.env[k];
process.env.HIGGSFIELD_KEY = 'kid:ksec';
r = await call(photo, { method: 'GET', body: { diag: '1' } });
ok(r.body.providers.higgsfield.authOk === true && r.body.providers.higgsfield.status === 404 && r.body.storage.bucketOk === true && r.body.storage.bucketPublic === true && r.body.storage.tablesOk === true && r.body.providers.gateway.configured === true && r.body.disabled === false, `diag: id:secret → authOk via a free 404 probe; storage ok (${JSON.stringify(r.body)})`);
const diagIp = '10.7.7.7'; let dl = 0;
for (let i = 0; i < 11; i++) { r = await call(photo, { method: 'GET', ip: diagIp, body: { diag: '1' } }); if (r.body.error === 'rate_limited') dl++; }
ok(dl === 1, 'diag: 10 per IP per hour');
hf.calls = [];
photoMod._test.resetBreaker();
r = await call(photo, { method: 'GET' });
ok(r.body.models[0] === 'higgsfield:grok_image_2' && r.body.models[1] === 'higgsfield:qwen_image_3', `GET lists the models this account has first (${r.body.models.join(', ')})`);
ok(Array.isArray(r.body.aspects) && r.body.aspects.includes('2:1') && !r.body.aspects.includes('auto') && !r.body.aspects.includes('21:9'), `GET gives the first model's exact aspects (${r.body.aspects})`);
hf.calls = []; hf.bodies = []; hf.estimates = []; gw.calls = []; logs.length = 0;
const SH = STATE({ pose: 'c:1,2,3;d:0,0,1;f:58;s:0,0;a:1.85;m:0' });
let tH = Date.now();
r = await call(photo, { body: { v: 1, op: 'develop', session: 'sessHIGGSFLD', state: SH, items, frame: FRAME } });
const hfMs = Date.now() - tH;
ok(r.body.url && r.body.model === 'higgsfield:grok_image_2' && gw.calls.length === 0, `stored from Higgsfield, gateway untouched (${JSON.stringify(r.body).slice(0, 140)})`);
ok(!('usd' in r.body) && !('request_id' in r.body), 'the visitor response carries no cost or provider id');
const hb = hf.bodies[0];
ok(hb && hb.path === '/xai/grok-imagine-image-2.0', `endpoint path ${hb?.path}`);
ok(hf.estimates.length === 1 && hf.estimates[0].path === hb.path && JSON.stringify(hf.estimates[0].body) === JSON.stringify(hb.body) && hf.calls.findIndex((c) => c.includes('/estimate/')) < hf.calls.findIndex((c) => c === `POST ${hb.path}`), 'estimate first, with the same body as the submit');
ok(hb && /\/storage\/v1\/object\/public\/photos\/frames\/[a-f0-9]{64}\.jpg$/.test(hb.body.image_urls[0]) && hf.uploads === 0, 'the frame is passed as its public Storage URL (no second upload)');
ok(hb && hb.body.image_urls.length === 3 && /^https:\/\//.test(hb.body.image_urls[1]), 'reference photos follow the frame');
ok(hb && hb.body.aspect_ratio === '16:9' && hb.body.resolution === '2k' && hb.body.quality === 'medium' && !('seed' in hb.body), `grok body: aspect_ratio / resolution 2k / quality, no seed (${JSON.stringify({ ...hb.body, prompt: '…', image_urls: hb.body.image_urls.length })})`);
ok(hb && /Image 2 — the sofa/.test(hb.body.prompt) && !/homecentre|amplience/i.test(hb.body.prompt), 'captions inline in the prompt, no supplier');
ok(hb && /^[a-f0-9]{32}-0$/.test(hb.idem) && hb.webhook === null, 'Idempotency-Key sent; no webhook without a secret');
ok(db.rows.get(r.body.key)?.provider === 'higgsfield' && db.rows.get(r.body.key)?.request_id && db.rows.get(r.body.key)?.cost_usd === 0.07, 'row records provider, request id and the estimate as cost_usd');
ok(JSON.parse(logs.find((l) => l.includes('"ev":"photo.gen"'))).est === false, 'cost line: est:false (the provider estimate)');
ok(hf.calls.filter((c) => c.includes('/status')).length >= 2, 'polled the status until completed');

section('Higgsfield: no balance (403) → AI Gateway in the same request');
hf.mode = '403'; hf.calls = []; gw.calls = []; hf.bodies = [];
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ pose: 'c:1,2,4;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.url && r.body.model === 'google/gemini-3.1-flash-image' && gw.calls.length === 1 && hf.bodies.length === 0, `fell back to the gateway, nothing submitted to Higgsfield (${r.body.model})`);
r = await call(photo, { method: 'GET' });
ok(!r.body.models.some((m) => m.startsWith('higgsfield:')) && r.body.generate, 'Higgsfield breaker open, gateway still generating');
photoMod._test.resetBreaker(); hf.mode = 'ok';

section('Higgsfield: unknown path (404) / disabled model (503) → next model, 1 h breaker per model, clear hint');
hf.mode = (p) => (p.includes('grok') ? '404' : 'ok'); gw.calls = []; hf.bodies = []; logs.length = 0;
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ pose: 'c:1,2,9;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.model === 'higgsfield:qwen_image_3' && gw.calls.length === 0 && logs.some((l) => l.includes("photo_config name 'models'") && l.includes('grok_image_2')), `a 404 names the override and the next Higgsfield model answers (${r.body.model})`);
const qb = hf.bodies[0];
ok(qb && qb.path === '/alibaba/qwen-image-3/edit' && qb.body.image_urls.length === 3 && qb.body.prompt_extend === false && qb.body.enable_thinking === false && Number.isInteger(qb.body.seed) && qb.body.resolution === '2k' && !('quality' in qb.body), `qwen body: frame + 2 refs, no prompt rewriting, seed (${JSON.stringify({ ...qb.body, prompt: '…', image_urls: qb.body.image_urls.length })})`);
r = await call(photo, { method: 'GET' });
ok(r.body.models[0] === 'higgsfield:qwen_image_3' && !r.body.models.includes('higgsfield:grok_image_2') && r.body.aspects.includes('21:9'), 'the 404 model is off (breaker); status now gives qwen and its aspects');
r = await call(photo, { method: 'GET', body: { diag: '1' }, ip: '10.4.9.1' });
ok(r.body.breakers.models.some((b) => b.id === 'higgsfield:grok_image_2') && r.body.breakers.higgsfield === false, 'diag lists the model breaker; the provider stays on');
hf.mode = 'ok'; hf.estimates = [];
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ pose: 'c:1,2,10;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.model === 'higgsfield:qwen_image_3' && !hf.estimates.some((e) => e.path.includes('grok')), 'while its breaker is open the model is not even estimated');
photoMod._test.resetBreaker();

section('Higgsfield: estimate over the limit / a shape the model cannot return → next model, nothing wasted');
hf.price['/xai/grok-imagine-image-2.0'] = 0.5; hf.bodies = [];
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ pose: 'c:1,2,11;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.model === 'higgsfield:qwen_image_3' && hf.bodies.length === 1 && !hf.bodies[0].path.includes('grok'), 'grok estimate $0.50 > the visitor limit $0.20 → not submitted; qwen answers');
hf.price['/xai/grok-imagine-image-2.0'] = 0.07; hf.bodies = []; hf.estimates = [];
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ aspect: '21:9', pose: 'c:1,2,12;d:0,0,1;f:58;s:0,0;a:2.33;m:0' }), items, frame: FRAME } });
ok(r.body.model === 'higgsfield:qwen_image_3' && hf.estimates.every((e) => !e.path.includes('grok')) && hf.bodies[0].body.aspect_ratio === '21:9', 'a 21:9 frame skips grok (no 21:9) and goes to qwen with 21:9');
hf.bodies = []; gw.calls = [];
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ aspect: '4:5', pose: 'c:1,2,13;d:0,0,1;f:58;s:0,0;a:0.8;m:0' }), items, frame: FRAME } });
ok(r.body.model === 'google/gemini-3.1-flash-image' && hf.bodies.length === 0, '4:5: neither Higgsfield model has it → the gateway model that does');

section('Higgsfield: moderation (nsfw) → next model');
hf.mode = 'nsfw'; gw.calls = [];
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ pose: 'c:1,2,5;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.url && r.body.model === 'google/gemini-3.1-flash-image', 'nsfw on both Higgsfield models → gateway model');
hf.mode = 'ok';

section('Higgsfield: slow job → pending → poll');
process.env.PHOTO_DEADLINE_MS = '9000';
process.env.HIGGSFIELD_WEBHOOK_SECRET = `whsec_${Buffer.from('a-very-secret-key-123456').toString('base64')}`;
process.env.PHOTO_PUBLIC_URL = 'https://villar.test';
hf.mode = 'slow'; hf.bodies = [];
const SP = STATE({ pose: 'c:1,2,6;d:0,0,1;f:58;s:0,0;a:1.85;m:0' });
tH = Date.now();
r = await call(photo, { body: { v: 1, op: 'develop', state: SP, items, frame: FRAME } });
ok(r.body.pending === true && /^[a-f0-9]{64}$/.test(r.body.key) && Date.now() - tH < 9500, `pending after the in-function wait (${Date.now() - tH} ms)`);
ok(hf.bodies[0]?.webhook === 'https://villar.test/api/photo-hook', 'webhook registered when the secret is set');
const pkey = r.body.key;
r = await call(photo, { body: { v: 1, op: 'lookup', state: SP } });
ok(r.body.hit === false && r.body.pending === true, 'lookup reports the running job (no second submit)');
r = await call(photo, { body: { v: 1, op: 'develop', state: SP, items, frame: FRAME } });
ok(r.body.pending === true && hf.bodies.length === 1, 'develop again does not resubmit');
r = await call(photo, { method: 'GET', body: { key: pkey } });
ok(r.body.pending === true, 'GET ?key= while running → pending');
for (const j of hf.jobs.values()) j.release = true;
r = await call(photo, { body: { v: 1, op: 'poll', key: pkey } });
ok(r.body.url && db.rows.get(pkey).status === 'ok', 'poll after completion → stored + url');

section('Higgsfield: signed webhook finishes a pending job');
hf.mode = 'slow';
const SW = STATE({ pose: 'c:1,2,7;d:0,0,1;f:58;s:0,0;a:1.85;m:0' });
r = await call(photo, { body: { v: 1, op: 'develop', state: SW, items, frame: FRAME } });
const wkey = r.body.key; const wrow = db.rows.get(wkey);
ok(r.body.pending && wrow?.request_id, 'second job pending');
for (const j of hf.jobs.values()) j.release = true;
const evt = Buffer.from(JSON.stringify({ request_id: wrow.request_id, status: 'completed', error: null, payload: { images: [{ url: 'https://evil.example/x.png' }] } }));
const sign = (raw, id = 'msg_1', ts = Math.floor(Date.now() / 1000)) => ({ 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${createHmac('sha256', Buffer.from('a-very-secret-key-123456')).update(`${id}.${ts}.`).update(raw).digest('base64')}` });
const hookCall = async (raw, headers) => {
  const { Readable } = await import('node:stream');
  const req = Object.assign(Readable.from([raw]), { method: 'POST', headers });
  let out = null; const res = { statusCode: 200, setHeader() {}, end(x) { out = x ? JSON.parse(x) : null; } };
  await hook(req, res); return { status: res.statusCode, body: out };
};
let hr = await hookCall(evt, { ...sign(evt), 'webhook-signature': 'v1,AAAA' });
ok(hr.status === 401 && db.rows.get(wkey).status === 'pending', 'bad signature → 401, nothing stored');
hr = await hookCall(evt, sign(evt, 'msg_2', Math.floor(Date.now() / 1000) - 900));
ok(hr.status === 401, 'stale timestamp → 401');
hr = await hookCall(evt, sign(evt));
ok(hr.status === 200 && db.rows.get(wkey).status === 'ok', 'valid delivery → stored from the authenticated status (not the payload URL)');
ok(![...db.objects.keys()].some((k) => /evil/.test(k)), 'payload URL ignored');
hr = await hookCall(evt, sign(evt, 'msg_3'));
ok(hr.status === 200 && hr.body.ignored, 'duplicate delivery ignored');
hf.mode = 'ok';
delete process.env.PHOTO_DEADLINE_MS; delete process.env.HIGGSFIELD_WEBHOOK_SECRET; delete process.env.PHOTO_PUBLIC_URL;

section('frames kept for hero jobs');
const frameKeys = [...db.objects.keys()].filter((k) => k.startsWith('frames/') && k.endsWith('.json'));
ok(frameKeys.length > 0 && JSON.parse(db.objects.get(frameKeys[0]).bytes).state.pose, `visitor develops keep frames/<key>.jpg + .json (${frameKeys.length})`);

// ------------------------------------------------------------------------------------------- job queue (ART)
const runQ = () => call(photo, { method: 'GET', body: { run: '1' }, ip: `10.8.${ipN++}.1` });
const runPost = async () => { const req = { method: 'POST', headers: { 'x-forwarded-for': `10.6.${ipN++}.1`, host: 'villar.test' }, query: { run: '1' }, body: {} }; let out = null; const res = { statusCode: 200, setHeader() {}, end(x) { out = x ? JSON.parse(x) : null; } }; await photo(req, res); return { body: out }; };
const addJob = (kind, params = {}) => { const id = ++db.jobSeq; db.jobs.push({ id, kind, params, status: 'queued', attempts: 0, created_at: new Date(Date.now() + id).toISOString(), locked_until: null, result: null }); return id; };
const job = (id) => db.jobs.find((j) => j.id === id);

delete process.env.HIGGSFIELD_KEY;
section('plates come only from the queue; GET /api/plate never generates');
db.rows.clear(); db.locks.clear(); gw.calls = []; hf.calls = []; hf.bodies = [];
r = await call(plate, { method: 'GET', body: { time: 'day' } });
ok(r.body.pending === true && gw.calls.length === 0 && hf.bodies.length === 0, 'first visitor: pending, nothing generated');
r = await runQ();
ok(r.body.idle === true, 'run with an empty queue → idle');
let jd = addJob('plate', { time: 'day' }), js = addJob('plate-edit', { time: 'sunset' });
r = await runQ();
ok(r.body.status === 'done' && job(jd).status === 'done' && gw.calls.length === 1 && gw.bodies.at(-1).model === 'google/gemini-3-pro-image' && gw.bodies.at(-1).providerOptions.google.imageConfig.imageSize === '4K', `day plate job (gateway Pro 4K) → done (${JSON.stringify(r.body).slice(0, 120)})`);
r = await runPost();
ok(r.body.status === 'done' && job(js).status === 'done' && gw.bodies.at(-1).messages[0].content.some((p) => p.type === 'image_url' && /plates\/v2\/day-/.test(p.image_url.url)), 'POST ?run=1: sunset job = an edit of the stored day plate');
r = await call(plate, { method: 'GET', body: { time: 'golden' } });
ok(r.body.url && r.body.time === 'sunset' && r.body.sun?.az === -47, 'GET golden → the cached sunset plate + sun');
r = await call(plate, { method: 'GET', body: { time: 'day', w: '2048' } });
ok(r.body.url && /-2k-/.test(r.body.url), 'phone rendition (w=2048)');
const n0 = gw.calls.length;
r = await call(plate, { method: 'GET', body: { time: 'evening' } });
ok(r.body.pending && gw.calls.length === n0, 'evening not queued → pending, no generation');
const je = addJob('plate-edit', { time: 'day' });
r = await runQ();
ok(job(je).status === 'failed' && /bad params/.test(job(je).error), 'plate-edit with time=day → failed with a reason');
r = await call(plate, { method: 'GET', body: { time: 'noon' } });
ok(r.status === 400, 'bad time → 400');

section('art edition job');
gw.calls = [];
const ja = addJob('edition', { id: 'dw-ink-umber-1', style: 'dark-walnut', prompt: 'large tonal abstract, layered ink washes in umber and soft black, one quiet rust field', palette: ['#3B2A20', '#E9E1D6', '#A4532E'], aspect: '3:2', resolution: '2K', candidates: 2 });
r = await runQ();
ok(job(ja).status === 'done' && gw.calls.length === 2 && db.objects.has('art/dw-ink-umber-1.jpg') && db.objects.has('art/dw-ink-umber-1-c2.jpg'), `2 candidates stored + art/<id>.jpg (${JSON.stringify(job(ja).result).slice(0, 140)})`);
const ep = gw.bodies.at(-1).messages[0].content[0].text;
ok(/#A4532E/.test(ep) && /no text, no signature/.test(ep) && /not in the manner of any named artist/.test(ep) && gw.bodies.at(-1).providerOptions.google.imageConfig.aspectRatio === '3:2', 'edition prompt: palette, originality, aspect');
const jb = addJob('edition', { id: 'x', style: 'dark-walnut', prompt: 'short' });
r = await runQ();
ok(job(jb).status === 'failed', 'invalid edition params → failed, nothing generated');

section('hero job from a stored visitor frame');
const fromKey = frameKeys[0].slice('frames/'.length, -'.json'.length);
gw.calls = [];
const jh = addJob('hero', { from: fromKey });
r = await runQ();
ok(job(jh).status === 'done' && job(jh).result?.url && gw.bodies.at(-1).model === 'google/gemini-3-pro-image', `hero → Pro tier, stored (${JSON.stringify(job(jh).result || job(jh).error).slice(0, 140)})`);
ok(db.rows.get(job(jh).result.key)?.source === 'preset', 'hero photo stored as preset (never auto-rejected)');
const jx = addJob('hero', { from: 'f'.repeat(64) });
r = await runQ();
ok(job(jx).status === 'failed' && /not found/.test(job(jx).error), 'hero from a missing frame → failed');
const jl = addJob('loop', {});
r = await runQ();
ok(job(jl).status === 'failed' && /params.time/.test(job(jl).error), 'loop without a time → failed with the reason');

section('Higgsfield plate job: concurrent runs, resume, failure leaves nothing cached');
process.env.HIGGSFIELD_KEY = 'kid:ksec'; process.env.PHOTO_DEADLINE_MS = '9000';
db.rows.clear(); db.locks.clear(); hf.bodies = []; hf.mode = 'slow';
const jp = addJob('plate', { time: 'day' });
const outs = await Promise.all([runQ(), runQ(), runQ()]);
ok(hf.bodies.length === 1 && outs.filter((o) => o.body.idle).length === 2 && job(jp).status === 'running', `3 concurrent runs → 1 claim, 1 submit (${outs.map((o) => o.body.status || (o.body.idle ? 'idle' : '?')).join(',')})`);
ok(hf.bodies[0].path === '/alibaba/qwen-image-3/text-to-image' && hf.bodies[0].body.resolution === '2k' && hf.bodies[0].body.aspect_ratio === '21:9' && !hf.bodies[0].body.image_urls && job(jp).result?.model === 'higgsfield:qwen_image_3' && job(jp).result?.estimate === 0.04 && job(jp).result?.request_id, `Higgsfield day plate: qwen text-to-image, 2k (its best), 21:9; the running job records model, estimate, request id (${JSON.stringify(job(jp).result)})`);
ok(db.rows.get('plate:v2:day')?.status === 'pending' && !db.rows.get('plate:v2:day')?.path, 'pending row has no plate path');
r = await call(plate, { method: 'GET', body: { time: 'day' } });
ok(r.body.pending, 'GET while running → pending');
r = await runQ();
ok(r.body.idle, 'lease not expired → not re-claimed');
job(jp).locked_until = new Date(Date.now() - 1000).toISOString();
r = await runQ();
ok(r.body.status === 'running' && hf.bodies.length === 1, 'lease expired → resumed, not resubmitted');
for (const j of hf.jobs.values()) if (!j.release) j.mode = 'nsfw';
job(jp).locked_until = new Date(Date.now() - 1000).toISOString();
r = await runQ();
ok(job(jp).status === 'failed' && db.rows.get('plate:v2:day')?.status === 'failed', 'provider job failed → job failed, row failed');
r = await call(plate, { method: 'GET', body: { time: 'day' } });
ok(r.body.pending && !r.body.url, 'nothing cached after the failure');
hf.mode = 'ok';
const jp2 = addJob('plate', { time: 'day' });
r = await runQ();
ok(job(jp2).status === 'done' && hf.bodies.length === 2, 'a new job stores the plate');
hf.mode = '403'; const jp3 = addJob('plate-edit', { time: 'evening' }); delete process.env.AI_GATEWAY_API_KEY;
r = await runQ();
ok(job(jp3).status === 'queued' && /balance/.test(job(jp3).error || ''), `no balance → the job stays queued with the reason (${job(jp3).status})`);
process.env.AI_GATEWAY_API_KEY = 'test-key'; hf.mode = 'ok';
delete process.env.PHOTO_DEADLINE_MS; delete process.env.HIGGSFIELD_KEY;

section('jobs: dry run, explicit model, cost limit, every attempt recorded');
process.env.HIGGSFIELD_KEY = 'kid:ksec'; photoMod._test.resetBreaker();
db.rows.clear(); db.locks.clear(); hf.bodies = []; hf.estimates = []; hf.mode = 'ok'; gw.mode = 'ok'; gw.calls = [];
for (const j of db.jobs) if (j.status === 'queued' || j.status === 'running') j.status = 'failed';   // leftovers of earlier sections
const jdry = addJob('plate', { time: 'day', dry: true });
r = await runQ();
const dry = job(jdry).result;
ok(job(jdry).status === 'done' && dry?.dry === true && hf.bodies.length === 0 && gw.calls.length === 0 && !db.rows.has('plate:v2:day'), `dry plate job: done, nothing submitted, nothing stored (${JSON.stringify(dry).slice(0, 300)})`);
ok(dry.estimates[0].model === 'higgsfield:qwen_image_3' && dry.estimates[0].usd === 0.04 && dry.estimates[0].path === 'alibaba/qwen-image-3/text-to-image' && dry.estimates[1].model === 'higgsfield:grok_image_2' && dry.estimates[1].body.aspect_ratio === '2:1' && dry.estimates[2].listPrice === true && dry.estimates[2].usd === 0.24, 'dry: one estimate per model in order (qwen t2i, grok at its nearest shape 2:1, gateway list price)');
const jmk = addJob('plate', { time: 'day', model: 'higgsfield:marketing_image', resolution: '4K', quality: 'medium' });
r = await runQ();
const mb = hf.bodies.at(-1);
ok(job(jmk).status === 'done' && mb.path === '/marketing-studio/image' && mb.body.quality === 'medium' && mb.body.resolution === '4k' && mb.body.aspect_ratio === '21:9' && mb.body.enhance_prompt === false && !mb.body.image_urls, `explicit model: marketing_image with explicit quality / resolution (${JSON.stringify({ ...(mb?.body || {}), prompt: '…' })} ${job(jmk).error || ''})`);
ok(job(jmk).result.model === 'higgsfield:marketing_image' && job(jmk).result.usd === 0.452 && job(jmk).result.request_id && job(jmk).cost === 0.452 && db.rows.get('plate:v2:day').cost_usd === 0.452, `result records model, estimate, request id; cost = the estimate (${JSON.stringify({ usd: job(jmk).result.usd, cost: job(jmk).cost })})`);
const jz = addJob('plate', { time: 'day', model: 'higgsfield:z_image', replace: true });
r = await runQ();
ok(job(jz).status === 'done' && hf.bodies.at(-1).path === '/z-image/turbo' && hf.bodies.at(-1).body.prompt.length <= 800 && db.rows.get('plate:v2:day').model === 'higgsfield:z_image', `replace: true regenerates with the named draft model; prompt within its 800 chars (${hf.bodies.at(-1).body.prompt.length})`);
db.rows.clear(); hf.bodies = []; hf.price['/marketing-studio/image'] = 0.9;
const jexp = addJob('plate', { time: 'day', model: 'higgsfield:marketing_image' });
r = await runQ();
ok(job(jexp).status === 'failed' && hf.bodies.length === 0 && /over the limit/.test(job(jexp).error) && job(jexp).result.attempts[0].code === 'too_expensive' && !db.rows.has('plate:v2:day'), `estimate $0.90 over the $0.60 limit → failed before submitting (${job(jexp).error?.slice(0, 120)})`);
const jexp2 = addJob('plate', { time: 'day', model: 'higgsfield:marketing_image', maxUsd: 1 });
r = await runQ();
ok(job(jexp2).status === 'done' && job(jexp2).cost === 0.9, 'the same job with maxUsd: 1 runs');
hf.price['/marketing-studio/image'] = 0.452;
// the production failure of 27 Nov: Higgsfield models off / unknown, gateway without credits
db.rows.clear(); hf.bodies = []; photoMod._test.resetBreaker();
hf.mode = (p) => (p.includes('qwen') ? '503' : p.includes('grok') ? '404' : 'ok'); gw.mode = '403';
const jf = addJob('plate', { time: 'day' });
r = await runQ();
const at = job(jf).result?.attempts || [];
ok(job(jf).status === 'failed' && at.length === 3 && at[0].model === 'higgsfield:qwen_image_3' && at[0].status === 503 && at[0].code === 'model_off' && at[1].status === 404 && at[2].provider === 'gateway' && at[2].status === 403 && /Free tier/.test(at[2].detail), `every attempt is in result.attempts (${JSON.stringify(at.map((x) => [x.model, x.status, x.code]))})`);
ok(/model_disabled/.test(job(jf).error) && /Free tier/.test(job(jf).error) && job(jf).error.length <= 2000 && r.body.attempts?.length === 3, `the job's error lists them too (${job(jf).error.slice(0, 200)})`);
ok(job(jf).status !== 'queued', 'a gateway without credits does not requeue the job (only Higgsfield "no balance" does)');
r = await call(photo, { method: 'GET', body: { diag: '1' }, ip: '10.4.9.2' });
ok(['higgsfield:qwen_image_3', 'higgsfield:grok_image_2'].every((id) => r.body.breakers.models.some((b) => b.id === id)) && r.body.breakers.gateway === true, 'diag: both model breakers (1 h) and the gateway breaker');
photoMod._test.resetBreaker(); gw.mode = 'ok';

section('jobs: hero from a stored frame — 503 on Nano Banana Pro → next model; dry');
hf.mode = (p) => (p.includes('nano-banana-pro') ? '503' : 'ok'); hf.bodies = []; hf.estimates = [];
const jhd = addJob('hero', { from: fromKey, dry: true });
r = await runQ();
ok(job(jhd).status === 'done' && job(jhd).result.dry && hf.bodies.length === 0 && job(jhd).result.estimates[0].error?.status === 503 && job(jhd).result.estimates[1].usd === 0.07, `hero dry: Pro reports 503, grok $0.07 (${JSON.stringify(job(jhd).result.estimates.map((e) => [e.model, e.usd ?? e.error?.status]))})`);
photoMod._test.resetBreaker();
const jh2 = addJob('hero', { from: fromKey });
r = await runQ();
const hh = hf.bodies.at(-1);
ok(job(jh2).status === 'done' && job(jh2).result.model === 'higgsfield:grok_image_2' && hh.path === '/xai/grok-imagine-image-2.0' && hh.body.image_urls[0].endsWith(`/frames/${fromKey}.jpg`) && job(jh2).result.usd === 0.07 && job(jh2).result.request_id, `hero: nano_banana_pro 503 → grok, frame by its Storage URL (${JSON.stringify(job(jh2).result).slice(0, 200)} ${job(jh2).error || ''})`);
ok(job(jh2).result.attempts?.[0]?.model === 'higgsfield:nano_banana_pro' && job(jh2).result.attempts[0].status === 503, `the failed first attempt stays in the done job's result (${JSON.stringify(job(jh2).result.attempts)})`);
const nbpCalls = () => hf.calls.filter((c) => c.includes('nano-banana-pro')).length;
const nbp = nbpCalls();
const jh3 = addJob('hero', { from: fromKey, model: 'higgsfield:nano_banana_pro' });
r = await runQ();
ok(job(jh3).status === 'failed' && nbpCalls() === nbp && nbp > 0, 'a job naming a model that is off fails at once (no substitute, no call while its breaker is open)');
photoMod._test.resetBreaker(); hf.mode = 'ok';
delete process.env.HIGGSFIELD_KEY;

section('twins: views job (one view per step, front first), twin job (estimate, submit, resume, streamed GLB)');
process.env.HIGGSFIELD_KEY = 'kid:ksec'; photoMod._test.resetBreaker(); hf.mode = 'ok'; gw.mode = 'ok';
for (const j of db.jobs) if (j.status === 'queued' || j.status === 'running') j.status = 'failed';
db.rows.clear(); hf.bodies = []; hf.estimates = []; hf.price['/tripo3d/h3.1/multiview-to-3d'] = 0.35;
const TID = 'sofa-lansbury-3';
const jvd = addJob('views', { itemId: TID, dry: true });
r = await runQ();
ok(job(jvd).status === 'done' && job(jvd).result.dry && job(jvd).result.totalUsd === 0.28 && hf.bodies.length === 0, `views dry: 4 views × grok $0.07 (${JSON.stringify(job(jvd).result).slice(0, 160)})`);
const jv = addJob('views', { itemId: TID, refs: [1], material: 'oatmeal woven fabric, walnut-tone wood base', seed: 3 });
r = await runQ();
ok(r.body.status === 'running' && db.objects.has(`twins/${TID}/front.jpg`) && !db.objects.has(`twins/${TID}/left.jpg`), 'step 1 stores the front view only');
const v0 = hf.bodies[0];
ok(v0.path === '/xai/grok-imagine-image-2.0' && v0.body.aspect_ratio === '1:1' && v0.body.resolution === '1k' && v0.body.image_urls.length === 1 && /^Product reference sheet image/.test(v0.body.prompt) && /Lansbury 3-seater sofa — oatmeal woven fabric/.test(v0.body.prompt) && /211 cm wide, 88 cm deep, 86 cm high/.test(v0.body.prompt) && /spans exactly 33 % of the image height/.test(v0.body.prompt) && /34 % above the bottom edge/.test(v0.body.prompt) && /View: FRONT\./.test(v0.body.prompt) && !/homecentre|amplience/i.test(v0.body.prompt), `front: prompt tv1 from the catalogue, 1:1, 1k, the product photo (${v0.body.prompt.slice(0, 80)}…)`);
for (let i = 0; i < 3; i++) r = await runQ();
const v1 = hf.bodies[1];
ok(job(jv).status === 'done' && ['front', 'left', 'back', 'right'].every((v) => db.objects.has(`twins/${TID}/${v}.jpg`)) && v1.body.image_urls[0].endsWith(`/twins/${TID}/front.jpg`) && v1.body.image_urls.length === 2 && /^Image 1 is the approved FRONT view/.test(v1.body.prompt) && /View: LEFT SIDE/.test(v1.body.prompt), `4 steps → 4 views; later views get the stored front view as image 1 (${job(jv).status} ${job(jv).error || ''})`);
ok(job(jv).cost === 0.28 && job(jv).result.made.length === 4 && job(jv).result.made[0].request_id && job(jv).result.views.back.endsWith('/back.jpg') && db.rows.get(`twinview:${TID}:front:s3`)?.kind === 'twin-view', `views result: urls, per-view model / usd / request id, cost $0.28 (${job(jv).cost})`);
const nV = hf.bodies.length; const jv2 = addJob('views', { itemId: TID, refs: [1], seed: 3 });
r = await runQ();
ok(job(jv2).status === 'done' && hf.bodies.length === nV, 're-running the same seed costs nothing');
const jbadv = addJob('views', { itemId: 'no-such-item' });
r = await runQ();
ok(job(jbadv).status === 'failed', 'views for an unknown item → failed');

const jtw0 = addJob('twin', { itemId: 'armchair-emma', model: 'tripo_h3_1_multiview_to_3d' });
r = await runQ();
ok(r.body.status === 'running' && job(jtw0).result.waiting === 'views' && job(jtw0).result.missing.length === 4 && !hf.bodies.some((b) => b.path.includes('tripo')), 'twin waits for its views (never generates them)');
job(jtw0).status = 'failed';
const jtd = addJob('twin', { itemId: TID, dry: true });
r = await runQ();
ok(job(jtd).status === 'done' && job(jtd).result.usd === 0.35 && job(jtd).result.fields.includes('image_urls') && job(jtd).result.fields.includes('face_limit'), `twin dry: the estimate and the body fields (${JSON.stringify(job(jtd).result)})`);
const jt = addJob('twin', { itemId: TID, model: 'tripo_h3_1_multiview_to_3d', seed: 5, as: 'model', options: { face_limit: 30000, enable_rigging: true } });
r = await runQ();
const tb = hf.bodies.at(-1);
ok(r.body.status === 'running' && tb.path === '/tripo3d/h3.1/multiview-to-3d' && tb.body.image_urls.length === 4 && tb.body.image_urls.map((u) => u.split('/').pop()).join() === 'front.jpg,left.jpg,back.jpg,right.jpg' && tb.body.face_limit === 30000 && tb.body.texture_seed === 5 && !('enable_rigging' in tb.body) && job(jt).result.request_id && job(jt).result.estimate === 0.35, `twin submit: 4 views in the model's order, whitelisted options, request id + estimate recorded (${JSON.stringify(job(jt).result)})`);
ok(db.streamed === 0 && !db.objects.has(`models/${TID}.glb`), 'nothing stored while the provider job runs');
job(jt).locked_until = new Date(Date.now() - 1000).toISOString();
r = await runQ();
if (job(jt).status === 'running') { job(jt).locked_until = new Date(Date.now() - 1000).toISOString(); r = await runQ(); }
const tr = job(jt).result;
ok(job(jt).status === 'done' && db.streamed === 1 && db.objects.get(`twins/${TID}/tripo_h3_1_multiview_to_3d-s5.glb`)?.type === 'model/gltf-binary' && db.objects.get(`twins/${TID}/tripo_h3_1_multiview_to_3d-s5.glb`).bytes.length === tr.bytes && db.objects.has(`models/${TID}.glb`), `GLB streamed into Storage and copied to models/<id>.glb (${job(jt).status} ${job(jt).error || ''})`);
ok(tr.faces === 1200 && tr.images === 1 && tr.generator === 'mock-3d' && tr.copiedTo === `models/${TID}.glb` && tr.outputKey === 'model_mesh.url' && tr.outputKeys.includes('rendered_image.url') && tr.usd === 0.35 && job(jt).cost === 0.35 && hf.bodies.filter((b) => b.path.includes('tripo')).length === 1, `twin result: faces, bytes, generator, output keys, cost; one submit only (${JSON.stringify({ faces: tr.faces, key: tr.outputKey, usd: tr.usd })})`);
hf.glb = glbFile({ ext: 'KHR_draco_mesh_compression' });
const jt2 = addJob('twin', { itemId: TID, seed: 6 });
r = await runQ(); for (let i = 0; i < 3 && job(jt2).status === 'running'; i++) { job(jt2).locked_until = new Date(Date.now() - 1000).toISOString(); r = await runQ(); }
ok(job(jt2).status === 'failed' && /KHR_draco_mesh_compression/.test(job(jt2).error) && !db.objects.has(`twins/${TID}/tripo_h3_1_multiview_to_3d-s6.glb`), `a Draco-compressed GLB is refused before anything is stored (${job(jt2).error?.slice(0, 90)})`);
hf.glb = Buffer.from('this is not a glb file at all, just text ..........');
const jt3 = addJob('twin', { itemId: TID, seed: 7 });
r = await runQ(); for (let i = 0; i < 3 && job(jt3).status === 'running'; i++) { job(jt3).locked_until = new Date(Date.now() - 1000).toISOString(); r = await runQ(); }
ok(job(jt3).status === 'failed' && /not a GLB/.test(job(jt3).error), 'a file that is not a GLB → failed');
hf.glb = null;
const jt4 = addJob('twin', { itemId: TID, model: 'meshy_v7_image_to_3d' });
r = await runQ();
ok(job(jt4).status === 'failed' && /photo_config row models/.test(job(jt4).error), 'a 3D model without a known path fails with the override to set');
hf.mode = (p, body) => (p.includes('hunyuan') && 'face_count' in body ? '422' : 'ok'); hf.price['/hunyuan3d/v3/image-to-3d'] = 0.2;
const jt5 = addJob('twin', { itemId: TID, model: 'hunyuan3d_v3_image_to_3d', dry: true });
r = await runQ();
ok(job(jt5).status === 'done' && job(jt5).result.optionsDropped === true && job(jt5).result.fields.join() === 'image_url' && job(jt5).result.attempts?.[0]?.status === 422, `options the endpoint refuses (free estimate) are dropped and reported (${JSON.stringify(job(jt5).result).slice(0, 200)})`);
hf.mode = 'ok';
delete process.env.HIGGSFIELD_KEY;

section('window loop: Kling O3 first = last frame, estimate first, MP4 streamed, served by /api/plate');
process.env.HIGGSFIELD_KEY = 'kid:ksec'; photoMod._test.resetBreaker(); hf.mode = 'ok';
for (const j of db.jobs) if (j.status === 'queued' || j.status === 'running') j.status = 'failed';
db.rows.clear(); hf.bodies = []; hf.price['/kling-video/o3/first-last-frame'] = 0.546; hf.price['/alibaba/wan-3.0/image-to-video'] = 0.6;
const jl0 = addJob('loop', { time: 'day' });
r = await runQ();
ok(job(jl0).status === 'failed' && /plate is not stored/.test(job(jl0).error), 'loop before its plate → failed with the reason');
const jpl = addJob('plate', { time: 'day' }); r = await runQ();
const jld = addJob('loop', { time: 'day', model: 'wan_3', resolution: '480p', dry: true });
r = await runQ();
ok(job(jld).status === 'done' && job(jld).result.usd === 0.6 && job(jld).result.body.end_image_url === job(jld).result.body.image_url && job(jld).result.body.generate_audio === false && job(jld).result.body.resolution === '480p', `loop dry (wan_3): estimate + the body (${JSON.stringify(job(jld).result).slice(0, 200)})`);
const nL = hf.bodies.length; const jlp = addJob('loop', { time: 'day' });
r = await runQ(); for (let i = 0; i < 3 && job(jlp).status === 'running'; i++) { job(jlp).locked_until = new Date(Date.now() - 1000).toISOString(); r = await runQ(); }
const lb = hf.bodies[nL];
ok(lb.path === '/kling-video/o3/first-last-frame' && lb.body.first_frame_url === lb.body.last_frame_url && /plates\/v2\/day-/.test(lb.body.first_frame_url) && lb.body.sound === 'off' && lb.body.mode === 'std' && lb.body.duration === 8 && /Seamless loop/.test(lb.body.prompt), `kling body: first = last = the plate, sound off, std, 8 s (${JSON.stringify({ ...lb.body, prompt: '…' }).slice(0, 200)})`);
ok(job(jlp).status === 'done' && job(jlp).cost === 0.546 && job(jlp).result.request_id && /day-loop-[a-f0-9]{8}\.mp4$/.test(job(jlp).result.url) && [...db.objects.entries()].some(([k, o]) => /day-loop-/.test(k) && o.type === 'video/mp4' && o.bytes.length === 120000), `MP4 streamed into Storage; cost = the estimate (${job(jlp).status} ${job(jlp).error || ''})`);
r = await call(plate, { method: 'GET', body: { time: 'day' } });
ok(/day-loop-.*\.mp4$/.test(r.body.video || ''), 'GET /api/plate → video url');
hf.price['/kling-video/o3/first-last-frame'] = 0.9; const nL2 = hf.bodies.length;
const jlx = addJob('loop', { time: 'day', mode: 'pro', replace: true });
r = await runQ();
ok(job(jlx).status === 'failed' && /over the limit/.test(job(jlx).error) && hf.bodies.length === nL2, 'a loop estimated above the limit is not submitted');
delete process.env.HIGGSFIELD_KEY;

section('diag: jobs');
addJob('loop', {});   // one job waiting
r = await call(photo, { method: 'GET', body: { diag: '1' }, ip: '10.5.5.5' });
ok(r.body.jobs && r.body.jobs.queued === 1 && r.body.jobs.lastError && r.body.caps.perIp === 12 && r.body.caps.global === 60, `diag.jobs + caps (${JSON.stringify(r.body.jobs).slice(0, 160)})`);

// ------------------------------------------------------------------------------------------- live config (photo-1b)
section('photo_config: visitors off by default, pilots, lookups keep working');
const setConfig = (entries) => { db.config = new Map(entries); photoMod._test.resetConfig(); };
const SC = STATE({ pose: 'c:4,4,1;d:0,0,1;f:58;s:0,0;a:1.85;m:0' });
// a photo that exists (generated while visitors were on)
setConfig([['visitors', true]]);
gw.calls = []; gw.mode = 'ok';
r = await call(photo, { body: { v: 1, op: 'develop', session: 'pilotSESSION1', state: SC, items, frame: FRAME } });
ok(r.body.url && gw.calls.length === 1, 'visitors on → develop generates');
setConfig([]);                                         // no rows at all = the default
gw.calls = [];
r = await call(photo, { body: { v: 1, op: 'develop', session: 'someVisitor01', state: STATE({ pose: 'c:4,4,2;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.error === 'lookup_only' && gw.calls.length === 0, `default (no rows) → develop answers lookup_only, nothing generated (${JSON.stringify(r.body)})`);
r = await call(photo, { body: { v: 1, op: 'lookup', session: 'someVisitor01', state: SC } });
ok(r.body.hit === true && r.body.url, 'lookup still hits while visitors are off');
r = await call(photo, { method: 'GET', body: { s: 'someVisitor01' } });
ok(r.body.enabled === true && r.body.generate === false, 'GET ?s= → enabled, generate:false for a visitor');
setConfig([['visitors', false], ['pilots', ['pilotSESSION1', 'bad id!', 42]]]);
r = await call(photo, { method: 'GET', body: { s: 'pilotSESSION1' } });
ok(r.body.generate === true, 'GET ?s=<pilot> → generate:true');
r = await call(photo, { method: 'GET' });
ok(r.body.generate === false, 'GET without a session → generate:false');
gw.calls = [];
r = await call(photo, { body: { v: 1, op: 'develop', session: 'pilotSESSION1', state: STATE({ pose: 'c:4,4,3;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.url && gw.calls.length === 1, 'pilot session → develop generates');
r = await call(photo, { body: { v: 1, op: 'develop', session: 'someVisitor01', state: STATE({ pose: 'c:4,4,4;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.error === 'lookup_only', 'a non-pilot is still lookup_only');
r = await call(photo, { body: { v: 1, op: 'develop', state: STATE({ pose: 'c:4,4,4;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.error === 'lookup_only', 'no session → lookup_only');
r = await call(photo, { method: 'GET', body: { diag: '1' }, ip: '10.4.4.1' });
ok(r.body.config === true && r.body.visitors === false && r.body.pilots === 1 && Array.isArray(r.body.overrides) && r.body.overrides.length === 0 && !JSON.stringify(r.body).includes('pilotSESSION1'), `diag: visitors, pilots count, no ids (${JSON.stringify({ v: r.body.visitors, p: r.body.pilots, o: r.body.overrides })})`);

section('photo_config: read error → visitors off; 30 s cache; queue independent');
db.configFail = true; photoMod._test.resetConfig();
db.config = new Map([['visitors', true]]);
r = await call(photo, { body: { v: 1, op: 'develop', session: 'pilotSESSION1', state: STATE({ pose: 'c:4,4,5;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.error === 'lookup_only', 'config unreadable (no table yet) → lookup_only even for a pilot');
r = await call(photo, { body: { v: 1, op: 'lookup', state: SC } });
ok(r.body.hit === true, 'lookups work without the config table');
const jq = addJob('edition', { id: 'cfg-off-edition', style: 'light-oak', prompt: 'a quiet northern coastal landscape at dawn, pale mist', candidates: 1 });
for (let i = 0; i < 6 && job(jq).status !== 'done'; i++) r = await runQ();   // FIFO: older leftover jobs go first
ok(job(jq).status === 'done', `the queue runs while visitors are off / config unreadable (${job(jq).status} ${job(jq).error || ''})`);
db.configFail = false; photoMod._test.resetConfig();
db.configReads = 0;
for (let i = 0; i < 4; i++) await call(photo, { body: { v: 1, op: 'lookup', state: SC } });
ok(db.configReads === 1, `config is cached (1 read for 4 requests, got ${db.configReads})`);

section('photo_config: overrides (models path, order, cost, caps, ab)');
process.env.HIGGSFIELD_KEY = 'kid:ksec'; photoMod._test.resetBreaker();
setConfig([['visitors', true], ['models', { grok_image_2: { path: 'xai/grok-next/edit', images: 'input_images' } }], ['cost', { 'google/gemini-3.1-flash-image': { '2K': 0.09 } }], ['caps', { perIp: 3, global: 9, maxUsdVisitor: 0.05 }]]);
hf.bodies = []; hf.mode = 'ok'; logs.length = 0; hf.price['/xai/grok-next/edit'] = 0.03;
r = await call(photo, { body: { v: 1, op: 'develop', session: 'someVisitor01', state: STATE({ pose: 'c:4,4,6;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.url && hf.bodies[0]?.path === '/xai/grok-next/edit' && Array.isArray(hf.bodies[0].body.input_images) && !hf.bodies[0].body.image_urls, `config path + field override used (${hf.bodies[0]?.path})`);
ok(db.rows.get(r.body.key)?.cost_usd === 0.03, 'the estimate of the overridden path is the cost');
r = await call(photo, { method: 'GET', body: { diag: '1' }, ip: '10.4.4.2' });
ok(r.body.caps.perIp === 3 && r.body.caps.global === 9 && r.body.visitors === true && ['caps', 'cost', 'models'].every((k) => r.body.overrides.includes(k)), `diag: caps + override names (${r.body.overrides})`);
setConfig([['visitors', true], ['order', { default: ['google/gemini-3.1-flash-image', 'higgsfield:qwen_image_3'] }], ['cost', { 'google/gemini-3.1-flash-image': { '2K': 0.09 } }]]);
gw.calls = []; hf.bodies = []; logs.length = 0;
r = await call(photo, { body: { v: 1, op: 'develop', session: 'someVisitor01', state: STATE({ pose: 'c:4,4,8;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.model === 'google/gemini-3.1-flash-image' && hf.bodies.length === 0, 'config order: the gateway model first');
ok(db.rows.get(r.body.key)?.cost_usd === 0.09 && JSON.parse(logs.find((l) => l.includes('"ev":"photo.gen"'))).est === false, 'config cost override for a model without an estimate call (est:false)');
setConfig([['visitors', true], ['ab', 'google/gemini-3.1-flash-image:1']]);
gw.calls = []; hf.bodies = [];
r = await call(photo, { body: { v: 1, op: 'develop', session: 'someVisitor01', state: STATE({ pose: 'c:4,4,7;d:0,0,1;f:58;s:0,0;a:1.85;m:0' }), items, frame: FRAME } });
ok(r.body.model === 'google/gemini-3.1-flash-image' && hf.bodies.length === 0, 'config ab = 100 % → that model first');
delete process.env.HIGGSFIELD_KEY;
setConfig([['visitors', true]]);

console.info = origInfo; console.warn = origWarn; console.error = origErr;
console.log(`\n${pass} passed, ${fail} failed · develop (mock gateway) ${devMs} ms · develop (mock Higgsfield, 3 polls) ${hfMs} ms`);
if (fail) { console.log(logs.filter((l) => /\[(warn|error)\]/.test(l)).slice(-12).join('\n')); process.exit(1); }

// ------------------------------------------------------------------------------------------- guard (pure parts)
{
  const { compare, compareItems } = await import('../site/js/photo/guard.js');
  const W = 256, H = 144;
  const mk = (draw) => { const E = new Uint8Array(W * H); draw((x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) E[y * W + x] = 1; }); let n = 0; for (const v of E) n += v; return { w: W, h: H, E, n }; };
  const rect = (set, x0, y0, x1, y1) => { for (let x = x0; x <= x1; x++) { set(x, y0); set(x, y1); } for (let y = y0; y <= y1; y++) { set(x0, y); set(x1, y); } };
  const scene = (dx = 0, sofaDx = 0) => mk((set) => { rect(set, 10 + dx, 10, 120 + dx, 130); rect(set, 140 + dx + sofaDx, 70, 230 + dx + sofaDx, 120); rect(set, 30 + dx, 30, 90 + dx, 60); for (let i = 0; i < 40; i++) set(150 + dx + i, 20 + (i % 7)); });
  const A = scene();
  let g = compare(A, scene());
  ok(g.ok && g.f1 > 0.95, `guard: identical → ok (f1 ${g.f1})`);
  g = compare(A, scene(3));
  ok(!g.ok && g.reason === 'shifted', `guard: 3 px global shift → rejected (${g.reason}, shift ${g.shift})`);
  g = compare(A, scene(8));
  ok(!g.ok, `guard: 8 px shift (3 % of 256) → rejected (${g.reason}, f1 ${g.f1})`);
  const items = [{ id: 'sofa', area: 0.2, bbox: [140 / W, 70 / H, 91 / W, 51 / H] }, { id: 'bed', area: 0.3, bbox: [10 / W, 10 / H, 111 / W, 121 / H] }];
  const B = scene(0, 9);
  const it = compareItems(A, B, items);
  ok(!it.ok && it.worst.id === 'sofa', `item guard: sofa moved 9 px (≈ 10 % of its box) → rejected (${JSON.stringify(it.worst)})`);
  ok(compareItems(A, scene(), items).ok, 'item guard: nothing moved → ok');
  console.log(`guard checks done · ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
