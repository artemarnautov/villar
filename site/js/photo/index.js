// Live → Photo — the real-time 3D is the viewfinder; when the camera rests the frame "develops" into a photograph
// made by an image-edit model (api/photo.js). Owner: photo. Spec: docs/PHOTOREAL.md, "Live → Photo".
//
//   rest (≥ 700 ms: no input, no flight / fade / budget run / GI bake, page and stage visible)
//     → capture a clean frame (no outline, no HUD) padded to the model's nearest aspect ratio
//     → visible items ranked by screen area (BVH raycast grid; an engine ID pass when it exists)
//     → lookup (same view + same room = instant) → else develop (upload the frame, the model edits it)
//     → structural check (edges of frame vs photo) → crossfade the photo in, pixel-aligned over the live frame
//   any pointer / key / wheel input, store change or camera change → back to live 3D in ≤ 150 ms.
// Every failure is silent: no API (static hosting), kill switch, no billing, a drifted photo → the live 3D stays.
import { busyReason, poseString, captureFrame, frameSize, visibleItems } from './engine.js';
import { edgeMap, compare, compareItems, GUARD } from './guard.js';
import { createServerTransport, createStubTransport } from './transport.js';
import { tp, onLang } from './i18n.js';

const REST_MS = 700;
const RUNNING_GRACE_MS = 2500;       // a render loop that keeps ticking this long after the last input no longer blocks
const FADE_IN_MS = 1100, FADE_IN_LOCAL_MS = 420, FADE_OUT_MS = 140;
const TICK_MS = 100;
const MAX_EDGE = 2048;
const LOCAL_MAX = 24;
const MAX_DETACHED = 2;
const ASPECTS = [['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3], ['4:5', 4 / 5], ['5:4', 5 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9], ['21:9', 21 / 9]];
const OFF_ERRORS = new Set(['disabled', 'unavailable', 'not_configured', 'quota', 'network']);

const now = () => performance.now();
const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Nearest model aspect ratio (log distance) and the padded canvas the frame sits in. */
export function fitAspect(w, h, maxEdge = MAX_EDGE, { up = false, aspects = null } = {}) {
  const a = w / h;
  // the shapes the server's first model can return exactly (GET /api/photo → aspects), else the default list
  const fromServer = (aspects || []).map((x) => { const m = /^(\d{1,2}):(\d{1,2})$/.exec(x); return m ? [x, Number(m[1]) / Number(m[2])] : null; }).filter(Boolean);
  const list = fromServer.length ? fromServer : ASPECTS;
  let best = list[0];
  for (const x of list) if (Math.abs(Math.log(x[1] / a)) < Math.abs(Math.log(best[1] / a))) best = x;
  const t = best[1];
  let PW, PH;
  if (a >= t) { PW = w; PH = w / t; } else { PH = h; PW = h * t; }
  const k = up ? maxEdge / Math.max(PW, PH) : Math.min(1, maxEdge / Math.max(PW, PH));
  PW = Math.round(PW * k); PH = Math.round(PH * k);
  const fw = Math.round(w * k), fh = Math.round(h * k);
  const ox = Math.round((PW - fw) / 2), oy = Math.round((PH - fh) / 2);
  return { aspect: best[0], W: PW, H: PH, fx: ox, fy: oy, fw, fh, crop: { x: ox / PW, y: oy / PH, w: fw / PW, h: fh / PH } };
}

function hashStr(s) { // FNV-1a, for the local state key only (the server computes its own)
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

function injectCss() {
  if (document.querySelector('link[data-villar-photo]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = '/css/photo.css'; l.dataset.villarPhoto = '';
  document.head.appendChild(l);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(() => resolve(img)) : resolve(img));
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

export async function mountPhoto({ root, store, stage }) {
  const params = new URLSearchParams(location.search);
  const mode = params.get('photo');
  if (mode === 'off' || !root || !store || !stage) return null;
  // the local QA harness / python http.server have no /api: don't even probe there (no 404 in anyone's console);
  // `?photo=on` forces the probe (e.g. `vercel dev` on localhost)
  if (!mode && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return null;
  const transport = mode === 'stub' ? createStubTransport(params) : createServerTransport();
  const status = { enabled: false, generate: false };
  let lastRec = () => null, phaseNow = () => 'off';
  /** Ask the server again (e.g. after this session was added to the pilots): { enabled, generate, phase }. */
  const refreshStatus = async () => { Object.assign(status, { enabled: false, generate: false }, await transport.status()); return { enabled: status.enabled, generate: status.generate, phase: phaseNow() }; };
  // read-only handle for the coordinator: the session id to put into photo_config.pilots, the status, the last attempt
  if (window.villarUI) {
    try { Object.defineProperty(window.villarUI, 'photo', { configurable: true, enumerable: true, value: Object.freeze({ get session() { return transport.session || null; }, status: refreshStatus, last: () => lastRec() }) }); } catch { /* frozen host object */ }
  }
  await refreshStatus();
  if (!status.enabled) return null; // static hosting, kill switch, no Storage: nothing happens
  const guardOpts = Number(params.get('photoGuard')) > 0 ? { minF1: Number(params.get('photoGuard')) } : {};
  injectCss();

  // ---------------------------------------------------------------- DOM: photo layer + label
  const layer = document.createElement('div');
  layer.className = 'vp-photo';
  layer.setAttribute('aria-hidden', 'true');
  const pic = document.createElement('canvas');
  pic.className = 'vp-photo-img';
  layer.appendChild(pic);
  const label = document.createElement('div');
  label.className = 'vp-label glass';
  label.setAttribute('role', 'note');
  const labelTxt = document.createElement('span');
  label.append(Object.assign(document.createElement('i'), { className: 'vp-dot' }), labelTxt);
  const paintLabel = () => { labelTxt.textContent = tp('label'); label.setAttribute('aria-label', tp('label.aria')); };
  paintLabel();
  onLang(paintLabel);
  const ui = root.querySelector('.stage-ui');
  root.insertBefore(layer, ui || null);
  root.appendChild(label);

  // ---------------------------------------------------------------- state
  const S = {
    phase: 'live',            // live | working | shown
    token: 0,                 // bumps on every input / change: results of older work are cached, not shown
    lastInput: now(),
    working: false,
    shown: null,              // { stateKey, pose, entry }
    offUntil: 0, fails: 0,
    inView: true,
    stats: [], last: null, fadeOut: [],
    lastBusy: 0, lastRender: 0, attempted: null,
    detached: 0,              // jobs still running for states the user has left (≤ MAX_DETACHED)
  };
  phaseNow = () => S.phase;
  lastRec = () => {
    const L = S.last;
    if (!L) return null;
    return { source: L.source, key: L.key || null, frame: L.frame || null, model: L.model || null, error: L.error || null, skip: L.skip || null, rejected: !!L.rejected, guard: L.guard || null, restToShownMs: L.restToShown ?? null, developMs: L.developMs ?? null, totalMs: L.totalMs ?? null, pending: !!L.pending };
  };
  const local = new Map();    // stateKey → { url, img, crop, key, guard }
  const noRetry = new Set();  // stateKeys whose photo failed the structural check this session
  const engine = () => (stage.mode === '3d' ? stage.engine : null);

  // ---------------------------------------------------------------- back to live
  function goLive(reason = 'input') {
    S.token++;
    S.lastInput = now();
    S.attempted = null;
    if (S.phase === 'shown') {
      const t0 = now();
      layer.style.setProperty('--vp-dur', `${FADE_OUT_MS}ms`);
      layer.classList.remove('is-on', 'is-developing');
      label.classList.remove('is-on');
      const done = () => { S.fadeOut.push({ reason, ms: Math.round(now() - t0) }); if (S.fadeOut.length > 20) S.fadeOut.shift(); };
      layer.addEventListener('transitionend', done, { once: true });
      S.shown = null;
    }
    if (S.phase !== 'working') S.phase = 'live';
  }

  // input: anything that moves the camera, changes the room or the light → live, and the rest timer restarts
  const onPointer = () => goLive('pointer');
  root.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
  root.addEventListener('touchstart', onPointer, { capture: true, passive: true });
  root.addEventListener('wheel', () => goLive('wheel'), { capture: true, passive: true });
  let travel = 0, lastMove = null;
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (lastMove && now() - lastMove.t > 280) travel = 0;   // a pause: a new gesture
    if (lastMove) travel += Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y);
    lastMove = { x: e.clientX, y: e.clientY, t: now() };
    if (travel > 24) { travel = 0; if (S.phase === 'shown') goLive('move'); else S.lastInput = now(); }
  }, { passive: true });
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    goLive('key');
  }, { capture: true });
  for (const evt of ['change', 'plan', 'style', 'pins']) store.on?.(evt, () => goLive(`store:${evt}`));
  let bound = null;
  const bindEngine = (v) => {
    if (!v || bound === v) return;
    bound = v;
    for (const evt of ['view', 'time', 'focus', 'select', 'photo', 'refine', 'context', 'inspect']) { try { v.on(evt, () => goLive(`engine:${evt}`)); } catch { /* optional */ } }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') S.lastInput = now(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { S.inView = e.isIntersecting && e.intersectionRatio >= 0.35; }, { threshold: [0, 0.35, 0.6] }).observe(root);

  // ---------------------------------------------------------------- state of the room + view
  function currentState(v) {
    const pose = poseString(v);
    if (!pose) return null;
    const fs = frameSize(v);
    if (!fs) return null;
    const time = v.timeOfDay || stage.time || 'day';
    const selection = { ...(store.state?.selection || {}) };
    // 4K where the screen can show it (the stage is ≥ 1800 device pixels wide), else 2K; the price is the same
    const size = (root.clientWidth || 0) * (window.devicePixelRatio || 1) >= 1800 ? '4K' : '2K';
    // the engine's capture renders at any size: give the model 2048 px whatever the screen DPR
    const engineCapture = typeof v.capture === 'function';
    const fit = fitAspect(fs.width, fs.height, MAX_EDGE, { up: engineCapture, aspects: status.aspects });
    const state = { style: store.styleId(), time, selection, pose, aspect: fit.aspect, size };
    const selKey = hashStr(Object.keys(selection).sort().map((k) => `${k}=${selection[k] ?? '-'}`).join('|'));
    return { state, fit, fs, stateKey: `${state.style}|${time}|${selKey}|${pose}|${size}|${fit.aspect}` };
  }
  const itemOf = (slotId) => store.placed?.().find((p) => p.slotId === slotId)?.item?.id || null;

  // ---------------------------------------------------------------- capture
  /** QA only (`?photo=stub&photoFrame=poster`): the stage poster as the "frame", for harnesses whose WebGL readback is blank. */
  function posterFrame(fit) {
    const img = root.querySelector('.stage-poster');
    if (!img?.naturalWidth) return null;
    const c = document.createElement('canvas'); c.width = fit.W; c.height = fit.H;
    const ctx = c.getContext('2d', { alpha: false });
    const k = Math.max(fit.fw / img.naturalWidth, fit.fh / img.naturalHeight); // object-fit: cover
    const sw = fit.fw / k, sh = fit.fh / k;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, fit.W, fit.H);
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, fit.fx, fit.fy, fit.fw, fit.fh);
    return { canvas: c, items: null, blob: null };
  }
  async function capture(v, fit) {
    if (transport.kind === 'stub' && params.get('photoFrame') === 'poster') { const r = posterFrame(fit); return r && { ...r, edges: edgeMap(r.canvas, fit.fx, fit.fy, fit.fw, fit.fh), qa: 'poster' }; }
    let r = await captureFrame(v, fit);
    let edges = r && edgeMap(r.canvas, fit.fx, fit.fy, fit.fw, fit.fh);
    if (r && edges.n < 40) {
      // a blank frame (seen from the engine capture on software GL): try the synchronous path once, never send it
      r = await captureFrame(v, fit, { engine: false });
      edges = r && edgeMap(r.canvas, fit.fx, fit.fy, fit.fw, fit.fh);
      if (r && edges.n < 40) return null;
    }
    return r ? { ...r, edges } : null;
  }
  const toJpeg = (canvas, q) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));

  // ---------------------------------------------------------------- show
  function drawPhoto(entry) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.min(3200, Math.round(root.clientWidth * dpr)), h = Math.round((w * root.clientHeight) / Math.max(1, root.clientWidth));
    pic.width = w; pic.height = h;
    const ctx = pic.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const { img, crop } = entry;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    ctx.drawImage(img, crop.x * iw, crop.y * ih, crop.w * iw, crop.h * ih, 0, 0, w, h);
  }
  async function show(entry, rec, { fast = false } = {}) {
    drawPhoto(entry);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduced ? 240 : fast ? FADE_IN_LOCAL_MS : FADE_IN_MS;
    layer.style.setProperty('--vp-dur', `${dur}ms`);
    layer.classList.toggle('is-developing', !fast && !reduced);
    await raf2();
    if (rec.token !== S.token) return false;
    layer.classList.add('is-on');
    label.classList.add('is-on');
    S.phase = 'shown';
    S.shown = { stateKey: rec.stateKey, pose: rec.pose, entry };
    rec.shownAt = now(); rec.fadeMs = dur;
    rec.restToShown = Math.round(rec.shownAt - rec.restAt);
    return true;
  }

  // ---------------------------------------------------------------- one rest → one photo
  async function verify(entry, edges) {
    const img = entry.img;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const { crop } = entry;
    // models return their own pixel grid (Kling 21:9 = 3840 × 1623, not 1646): up to 3 % off the frame's shape is
    // compared and shown at the frame's shape (an invisible stretch); more than that is a different picture
    const off = Math.abs(Math.log(((crop.w * iw) / (crop.h * ih)) / (edges.w / edges.h)));
    if (off > 0.03) return { ok: false, reason: 'aspect' };
    const b = edgeMap(img, crop.x * iw, crop.y * ih, crop.w * iw, crop.h * ih, edges.w, edges.h);
    const g = compare(edges, b, guardOpts);
    // ART §2: the top 5 items must not move or resize by > 4 % — needs bboxes from the engine's ID pass
    if (g.ok && entry.items?.some((x) => x.bbox)) {
      const it = compareItems(edges, b, entry.items);
      return { ...g, items: it, ok: it.ok, reason: it.ok ? null : 'item-moved' };
    }
    return g;
  }
  function remember(stateKey, entry) {
    local.delete(stateKey); local.set(stateKey, entry);
    while (local.size > LOCAL_MAX) local.delete(local.keys().next().value);
  }
  function backoff(err) {
    if (OFF_ERRORS.has(err)) S.offUntil = now() + (err === 'quota' ? 6 * 3600e3 : 30 * 60e3);
    else if (err === 'rate_limited') S.offUntil = now() + 60e3;
    else if (++S.fails >= 3) { S.offUntil = now() + 10 * 60e3; S.fails = 0; }
  }

  /** An async provider job: poll until it lands (≤ 6 min: a 4K re-shoot can queue for minutes), whether or not the user is still looking. */
  async function waitJob(first, rec) {
    let r = first;
    const t0 = now();
    while (r?.pending && r.key && now() - t0 < 360000) {
      await new Promise((res) => setTimeout(res, Math.max(1500, Math.min(8000, (r.retryAfter || 3) * 1000))));
      r = await transport.poll(r.key);
      rec.polls = (rec.polls || 0) + 1;
    }
    return r?.pending ? { error: 'timeout' } : r;
  }

  /** `job`, or { moved: true } as soon as the user leaves the state the job was for (whichever comes first). */
  const unlessLeft = (job, token) => {
    let iv = 0;
    const left = new Promise((resolve) => { iv = setInterval(() => { if (S.token !== token) resolve({ moved: true }); }, 150); });
    return Promise.race([job, left]).finally(() => clearInterval(iv));
  };

  async function develop(v) {
    const token = S.token;
    const rec = { token, restAt: now(), source: null };
    S.working = true; S.phase = 'working'; S.last = rec;
    try {
      const cur = currentState(v);
      if (!cur) { rec.skip = 'no-state'; return; }
      Object.assign(rec, { stateKey: cur.stateKey, pose: cur.state.pose });
      if (noRetry.has(cur.stateKey)) { rec.skip = 'no-retry'; return; }
      // 1. this tab already has it: instant
      const mine = local.get(cur.stateKey);
      if (mine) { rec.source = 'local'; await show(mine, rec, { fast: true }); return; }
      // 1b. a session that may not generate (visitors off, not a pilot): ask the cache first and capture only on a
      //     hit, so a visitor without a photo pays one small request per new view and no render
      let t = now();
      let look = null;
      if (!status.generate) {
        look = await transport.lookup(cur.state);
        rec.lookupMs = Math.round(now() - t);
        if (look?.error) { rec.error = look.error; backoff(look.error); return; }
        if (!look?.hit && !look?.pending) { rec.skip = 'lookup-only'; return; }
        if (token !== S.token) { rec.skip = 'stale'; return; }
      }
      // 2. capture (the engine's clean frame, or one synchronous re-render with the outline off)
      t = now();
      const cap = await capture(v, cur.fit);
      rec.captureMs = Math.round(now() - t);
      if (!cap) { rec.skip = 'capture'; return; }
      if (token !== S.token) { rec.skip = 'stale'; return; }
      // 3. lookup; the visible items (needed only to develop) are ranked meanwhile and never delay a cache hit
      t = now();
      const itemsP = cap.items ? Promise.resolve(cap.items) : status.generate ? visibleItems(v, itemOf).catch(() => []) : Promise.resolve([]);
      if (!look) { look = await transport.lookup(cur.state); rec.lookupMs = Math.round(now() - t); }
      if (look?.error) { rec.error = look.error; backoff(look.error); return; }
      const tryEntry = async (r) => {
        const t1 = now();
        const img = await loadImage(r.url);
        rec.loadMs = Math.round(now() - t1);
        rec.key = r.key || null; rec.model = rec.model || r.model || null;
        const entry = { url: r.url, img, crop: cur.fit.crop, key: r.key, model: r.model, items: cap.items };
        const t2 = now();
        let g;
        try { g = await verify(entry, cap.edges); } catch (e) { g = { ok: false, reason: 'tainted' }; }
        rec.guardMs = Math.round(now() - t2); rec.guard = g;
        return { entry, g };
      };
      /** The user moved on while a job runs: let it finish in the background into the local cache. */
      const detach = (job) => {
        rec.skip = 'detached'; S.detached++;
        job.then(async (r) => {
          if (r?.error === 'lookup_only') status.generate = false; else if (r?.error) backoff(r.error);
          if (!r?.url) return;
          const { entry, g } = await tryEntry(r);
          if (g.ok) remember(cur.stateKey, entry); else { noRetry.add(cur.stateKey); transport.reject(r.key, g.f1); }
        }).catch(() => {}).finally(() => { S.detached--; });
      };
      if (look?.pending) { // someone (maybe this tab, earlier) already asked for exactly this photo
        const job = waitJob(look, rec);
        const done = await unlessLeft(job, token);
        if (done?.moved) { detach(job); return; }
        if (done?.url) Object.assign(look, { hit: true, url: done.url, key: done.key, model: done.model });
      }
      let res = look?.hit ? look : null;
      rec.source = res ? 'cache' : null;
      if (res) {
        const { entry, g } = await tryEntry(res);
        if (g.ok) { remember(cur.stateKey, entry); if (token === S.token) await show(entry, rec, { fast: true }); return; }
        transport.reject(res.key, g.f1);
        res = null;
      }
      if (!status.generate) { rec.skip = 'lookup-only'; return; }
      const items = await itemsP;
      rec.items = items.slice(0, 10).map((x) => `${x.id}:${(x.area * 100).toFixed(1)}%`);
      if (token !== S.token) { rec.skip = 'stale'; return; }
      // 4. develop: upload the frame, the model edits it
      t = now();
      let blob = cap.blob || await toJpeg(cap.canvas, 0.88);
      if (blob && blob.size > 1.45 * 1024 * 1024) blob = await toJpeg(cap.canvas, 0.78);
      rec.engineCapture = !!cap.items;
      rec.encodeMs = Math.round(now() - t); rec.bytes = blob?.size || 0;
      if (!blob) { rec.skip = 'encode'; return; }
      t = now();
      const job = transport.develop(cur.state, items.slice(0, 24).map((x) => ({ id: x.id, area: x.area })), blob)
        .then((o) => (o?.pending ? (rec.pending = true, waitJob(o, rec)) : o));
      const out = await unlessLeft(job, token);
      if (out?.moved) { detach(job); return; }
      rec.developMs = Math.round(now() - t);
      if (out?.error === 'lookup_only') { status.generate = false; rec.skip = 'lookup-only'; return; } // cache hits only from now on
      if (!out || out.error || !out.url) {
        rec.error = out?.error || 'empty';
        if (out?.error === 'unstable') noRetry.add(cur.stateKey); else backoff(rec.error);
        return;
      }
      S.fails = 0;
      rec.source = out.cached ? 'cache' : 'model';
      rec.model = out.model; rec.serverMs = out.ms; rec.frame = out.frame || null;
      const { entry, g } = await tryEntry(out);
      if (!g.ok) {
        // drifted: discard, keep live 3D, and tell the server to drop that cache key
        noRetry.add(cur.stateKey);
        rec.rejected = true;
        transport.reject(out.key, g.f1);
        return;
      }
      remember(cur.stateKey, entry);
      if (token === S.token) await show(entry, rec);
      else rec.skip = 'stale-cached';  // the user moved on: kept for when they come back
    } catch (err) {
      rec.error = String(err?.message || err);
      backoff('error');
    } finally {
      rec.totalMs = Math.round(now() - rec.restAt);
      S.stats.push(rec); if (S.stats.length > 40) S.stats.shift();
      S.working = false;
      if (S.phase === 'working') S.phase = 'live';
    }
  }

  // ---------------------------------------------------------------- the watch
  // rest = no input for REST_MS, no busy engine state for REST_MS, and the render loop idle for REST_MS (a loop
  // that keeps ticking — exposure settling — stops blocking RUNNING_GRACE_MS after the last input)
  const timer = setInterval(() => {
    const v = engine();
    if (!v) return;
    bindEngine(v);
    const t = now();
    if (S.phase === 'shown') {
      // the camera moved without an input event we saw (assistant, programmatic view): live again
      const p = poseString(v);
      if (p && p !== S.shown?.pose) goLive('pose');
      return;
    }
    if (S.working || S.detached >= MAX_DETACHED) return;
    const why = busyReason(v);
    if (why === 'rendering') S.lastRender = t; else if (why) S.lastBusy = t;
    if (t < S.offUntil || !S.inView || document.visibilityState === 'hidden') return;
    if (t - S.lastInput < REST_MS || t - S.lastBusy < REST_MS) return;
    if (t - S.lastRender < REST_MS && t - S.lastInput < RUNNING_GRACE_MS) return;
    if (why && why !== 'rendering') return;
    const cur = currentState(v);
    if (!cur || cur.stateKey === S.attempted) return; // one attempt per state until something changes
    S.attempted = cur.stateKey;
    develop(v);
  }, TICK_MS);

  const api = {
    get phase() { return S.phase; },
    goLive,
    debug: { S, local, noRetry, transport, status, guard: GUARD, fitAspect },
    dispose() { clearInterval(timer); layer.remove(); label.remove(); },
  };
  window.villarPhoto = api;
  return api;
}
