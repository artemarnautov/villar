// Live → Photo: talking to /api/photo — or, behind `?photo=stub`, a local stand-in that "develops" the frame in
// the browser (tone curve, warmth, vignette, grain) so the whole flow can be tested without the gateway. Owner: photo.
//   ?photo=stub              stub provider (in-memory "Storage", shared by this tab)
//   &photoLatency=1800       simulated model time, ms
//   &photoDrift=1            the stub returns a photo shifted by 3 % of the width (the guard must reject it)
//   &photoFail=unavailable   the stub answers like a provider without balance / billing
//   &photoPending=1          the stub answers like an async job still running (the client polls)
//   &photoLookupOnly=1       the stub answers like a server with visitor generation off (cache hits only)
//   ?photo=off               the feature stays off
//   ?photo=on                use /api/photo even on localhost (vercel dev); by default local hosts skip the API

const SID_KEY = 'villar:photo:sid';
/** A random id for this browser (localStorage, so a pilot session survives reloads and new tabs). No personal data. */
export function sessionId() {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
  for (const store of ['localStorage', 'sessionStorage']) {
    try {
      let s = window[store].getItem(SID_KEY);
      if (!s || !/^[a-z0-9]{8,40}$/i.test(s)) { s = make(); window[store].setItem(SID_KEY, s); }
      return s;
    } catch { /* storage blocked: try the next one */ }
  }
  return null;
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result); r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function post(body, { timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/photo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal, credentials: 'same-origin' });
    if (!r.ok) return { error: r.status === 404 ? 'not_configured' : r.status === 413 ? 'too_large' : 'bad_request' };
    return await r.json();
  } catch (e) { return { error: e?.name === 'AbortError' ? 'timeout' : 'network' }; }
  finally { clearTimeout(t); }
}

export function createServerTransport() {
  const session = sessionId();
  return {
    kind: 'server', session,
    /** enabled: the feature exists here; generate: THIS session may start a generation (else cache hits only). */
    async status() {
      try {
        const r = await fetch(`/api/photo${session ? `?s=${encodeURIComponent(session)}` : ''}`, { method: 'GET', credentials: 'same-origin' });
        if (!r.ok) return { enabled: false };
        const j = await r.json();
        return { enabled: !!j.enabled, generate: !!j.generate, aspects: Array.isArray(j.aspects) ? j.aspects.filter((x) => typeof x === 'string').slice(0, 24) : null };
      } catch { return { enabled: false }; }
    },
    lookup: (state) => post({ v: 1, op: 'lookup', session, state }, { timeoutMs: 8000 }),
    async develop(state, items, frameBlob) {
      const frame = await blobToDataUrl(frameBlob);
      return post({ v: 1, op: 'develop', session, state, items, frame }, { timeoutMs: 62000 });
    },
    poll: (key) => post({ v: 1, op: 'poll', session, key }, { timeoutMs: 30000 }),
    reject: (key, score) => post({ v: 1, op: 'reject', session, key, score }, { timeoutMs: 8000 }),
  };
}

// ------------------------------------------------------------------------------------------------- stub
const store = new Map(); // key → blob URL (the stub's "Storage"; lives as long as the tab)
const hashKey = async (s) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** A believable "development" of the frame: tone curve, slight warmth, vignette, fine grain. */
async function developLocally(blob, { drift = false } = {}) {
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, drift ? Math.round(w * 0.03) : 0, 0);
  if (drift) ctx.drawImage(bmp, 0, 0, 2, h, 0, 0, Math.round(w * 0.03), h);
  const img = ctx.getImageData(0, 0, w, h); const p = img.data;
  const curve = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) { const x = i / 255; const s = x * x * (3 - 2 * x); curve[i] = Math.round(255 * (0.72 * x + 0.28 * s)); } // gentle S
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  for (let y = 0; y < h; y++) {
    const vy = (y / h - 0.5) * 2;
    for (let x = 0; x < w; x++) {
      const vx = (x / w - 0.5) * 2;
      const vig = 1 - 0.10 * Math.min(1, (vx * vx + vy * vy) * 0.6);
      const g = rnd() * 7;
      const i = (y * w + x) * 4;
      p[i] = curve[p[i]] * vig * 1.025 + g; p[i + 1] = curve[p[i + 1]] * vig + g; p[i + 2] = curve[p[i + 2]] * vig * 0.965 + g;
    }
  }
  ctx.putImageData(img, 0, 0);
  bmp.close?.();
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
}

export function createStubTransport(params = new URLSearchParams(location.search)) {
  // live-tunable for QA: villarPhoto.debug.transport.cfg.drift = true …
  const cfg = { latency: Math.max(0, Number(params.get('photoLatency') || 1800)), drift: params.get('photoDrift') === '1', failWith: params.get('photoFail') || null, pending: params.get('photoPending') === '1', lookupOnly: params.get('photoLookupOnly') === '1' };
  const jobs = new Map(); // key → Promise<url> (async "provider" jobs)
  const keyOf = (state) => hashKey(['stub', state.style, JSON.stringify(state.selection), state.pose, state.time, state.size, state.aspect].join('|'));
  const log = [];
  return {
    kind: 'stub', log, cfg, store, session: sessionId(),
    async status() { return { enabled: true, generate: !cfg.lookupOnly }; },
    async lookup(state) {
      const key = await keyOf(state);
      await new Promise((r) => setTimeout(r, 60));
      log.push({ op: 'lookup', key: key.slice(0, 8), hit: store.has(key) });
      return store.has(key) ? { hit: true, url: store.get(key), key, model: 'stub', ms: 60 } : { hit: false, key };
    },
    async develop(state, items, frameBlob) {
      const t0 = performance.now();
      const key = await keyOf(state);
      log.push({ op: 'develop', key: key.slice(0, 8), items: items.length, bytes: frameBlob.size, at: Math.round(t0) });
      if (cfg.lookupOnly) return { error: 'lookup_only' };
      const job = (async () => {
        await new Promise((r) => setTimeout(r, cfg.latency));
        if (cfg.failWith) return { error: cfg.failWith };
        const out = await developLocally(frameBlob, { drift: cfg.drift });
        const url = URL.createObjectURL(out);
        store.set(key, url);
        return { url, key, model: 'stub', ms: Math.round(performance.now() - t0) };
      })();
      if (cfg.pending) { jobs.set(key, job); await new Promise((r) => setTimeout(r, 300)); return { pending: true, key, retryAfter: 1 }; }
      return job;
    },
    async poll(key) {
      log.push({ op: 'poll', key: key.slice(0, 8) });
      const j = jobs.get(key);
      if (!j) return store.has(key) ? { url: store.get(key), key, model: 'stub', cached: true } : { error: 'gateway' };
      const done = await Promise.race([j, new Promise((r) => setTimeout(() => r(null), 200))]);
      if (!done) return { pending: true, key, retryAfter: 1 };
      jobs.delete(key);
      return done;
    },
    async reject(key, score) {
      log.push({ op: 'reject', key: key.slice(0, 8), score });
      const u = store.get(key); if (u) { URL.revokeObjectURL(u); store.delete(key); }
      return { ok: true };
    },
  };
}
