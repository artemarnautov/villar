// Studio stage: poster → live 3D engine, overlay controls, photo mode, hint, and the 2D plan fallback.
// Owner: interface. Talks to the engine only through its public API (docs/SPEC.md, docs/requests/engine.md);
// optional engine features (setInsets, thumbnail, view/contextlost events) are feature-detected.
import { h, svg, safeHex, isTouch, NBSP } from './dom.js';
import { icon } from './icons.js';
import { views as viewItems, times as timeItems, VIEW_IDS, TIME_IDS } from './labels.js';
import { t, onLang, isEn } from './i18n.js';
import { packName } from './format.js';
import { createSegmented } from './segmented.js';
import { createPlan } from './plan.js';

const RING_C = 2 * Math.PI * 8;
// Loading watchdog: fall back to the plan when progress stalls (not merely when it is slow).
const STALL_MS = 45000;   // covers async shader compile between the "modules" and "scene" progress marks
const HARD_MS = 240000;
const CONTEXT_RESTORE_MS = 6500;   // the engine emits 'fatal' after 5 s; this is the backstop

export function createStage({ root, store, layout, palettes, onHover, onSelect, onModeChange, onBack }) {
  const canvasHost = root.querySelector('.stage-canvas');
  const planHost = root.querySelector('.stage-plan');
  const loading = root.querySelector('.stage-loading');
  const poster = root.querySelector('.stage-poster');
  const ui = root.querySelector('.stage-ui');
  const loadBar = loading.querySelector('.loading-bar');
  const loadLabel = loading.querySelector('.loading-label');
  const loadPct = loading.querySelector('.loading-pct');

  const qs = new URLSearchParams(location.search);
  const override = Number(qs.get('engineTimeout'));
  const stallMs = override > 0 ? override : STALL_MS;
  const hardMs = override > 0 ? Math.max(override, HARD_MS) : HARD_MS;

  let villar = null;
  let plan = null;
  let mode = 'idle';        // idle | loading | 3d | plan
  let photo = null;          // { target, done }
  let hintTimer = 0;
  let watchdog = 0;
  let lastPointer = null;
  let generation = 0;        // bumps on every mount/fail so late engine instances get disposed
  let mountArgs = null;      // for «Попробовать 3D снова»
  let quality = 'high';
  // T7: thumbnails are rendered one per idle frame, and not while the camera is flying to an object.
  const thumbCache = new Map();   // itemId → Promise<url|null>
  let thumbQueue = [], thumbBusy = false, thumbHoldUntil = 0, thumbTimer = 0, thumbSeq = 0;
  // D3-10: tiles on screen go first, in the order they became visible; the rest keep their place behind them.
  const nextThumb = () => {
    let at = -1, best = Infinity;
    thumbQueue.forEach((j, i) => { if (j.prio && j.prio < best) { best = j.prio; at = i; } });
    return at >= 0 ? thumbQueue.splice(at, 1)[0] : thumbQueue.shift();
  };
  function pumpThumbs() {
    if (thumbBusy || !thumbQueue.length || thumbTimer) return;
    const wait = thumbHoldUntil - performance.now();
    if (wait > 0) { thumbTimer = setTimeout(() => { thumbTimer = 0; pumpThumbs(); }, wait + 16); return; }
    thumbBusy = true;
    const run = () => {
      if (thumbHoldUntil > performance.now()) { thumbBusy = false; pumpThumbs(); return; }
      const job = nextThumb();
      if (!job) { thumbBusy = false; return; }
      let p;
      try { p = Promise.resolve(villar?.thumbnail?.(job.id, { size: 256 })); } catch (e) { p = Promise.reject(e); }
      p.then((url) => job.resolve(url || null), () => job.resolve(null)).finally(() => { thumbBusy = false; pumpThumbs(); });
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 500 }); else setTimeout(run, 32);
  }
  function clearThumbs() {
    for (const j of thumbQueue) j.resolve(null);
    thumbQueue = []; thumbCache.clear();
    clearTimeout(thumbTimer); thumbTimer = 0;
  }
  // D2-08: let the pressed state paint before the engine does heavy work in the same task.
  const defer = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));
  const roomName = () => (isEn()
    ? (layout.nameEn || (layout.areaM2 ? `Studio ${Math.round(layout.areaM2)}${NBSP}m²` : 'Studio'))
    : (layout.name || ''));
  const narrowMq = window.matchMedia('(max-width: 734px)');
  const viewList = () => (narrowMq.matches ? VIEW_IDS.map((v) => ({ value: v, label: t(`vshort.${v}`) })) : viewItems());
  const labelCanvas = () => canvasHost.querySelector('canvas')?.setAttribute('aria-label', t('stage.canvas'));
  const warn = (...a) => console.warn('[villar:ui]', ...a);
  const call = (fn, ...args) => {
    if (!villar || typeof villar[fn] !== 'function') return undefined;
    try { return villar[fn](...args); } catch (e) { warn(`engine.${fn} failed`, e); return undefined; }
  };
  const setMode = (m) => { mode = m; root.dataset.mode = m; onModeChange?.(m); };
  let focused = null; // { slotId, inset } while the HUD holds focus — replayed when the engine becomes ready

  // Known issue 5: the poster is the saved style's frame (boot.js picks it); it follows a style switch made
  // before the 3D is ready, and cross-fades to the canvas at 'ready' (CSS .is-ready).
  const posterBase = poster?.dataset.posterBase || '';
  const posterDefault = poster ? `${posterBase}${poster.dataset.posterDefault || ''}.jpg` : '';
  if (poster) {
    poster.addEventListener('error', () => {
      if (posterBase && !poster.src.endsWith(posterDefault)) poster.src = posterDefault;
      else poster.remove();
    });
  }
  function syncPoster() {
    if (!poster?.isConnected || !posterBase || root.classList.contains('is-ready')) return;
    const id = store.styleId?.();
    if (!id || !/^[a-z][a-z-]{1,40}$/.test(id)) return;
    const next = `${posterBase}${id}.jpg`;
    if (!poster.src.endsWith(next)) poster.src = next;
  }
  syncPoster();

  // ---------- Controls ----------
  const chipDot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  const chipLabel = h('span');
  const chipRoom = h('span', { class: 'muted' });
  const chip = h('div', { class: 'chip glass' }, chipDot, chipLabel, chipRoom);
  function syncChip() {
    const pal = palettes?.[store.styleId?.()] || null;
    chipDot.style.setProperty('--c', safeHex((pal?.swatches || []).find((s) => /wood/i.test(s.role))?.hex, '#4a3426'));
    chipLabel.textContent = mode === 'plan' ? t('stage.plan') : packName(store.style?.()) || t('style');
    chipRoom.textContent = `·${NBSP}${roomName()}`;
  }

  const views = createSegmented({
    label: t('stage.views'), items: viewList(), value: 'eye',
    onChange: (v) => { cancelPhoto(); defer(() => call('setView', v)); },
  });
  const times = createSegmented({
    label: t('stage.times'), items: timeItems().map((x) => ({ ...x, icon: x.value })), value: 'day', className: 'time-seg',
    onChange: (v) => setTime(v),
  });
  const timeCycle = h('button', { type: 'button', class: 'pill glass time-cycle' });
  timeCycle.addEventListener('click', () => {
    const i = TIME_IDS.indexOf(times.value);
    const next = TIME_IDS[(i + 1) % TIME_IDS.length];
    times.set(next);
    setTime(next);
  });

  const ring = svg(`<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle class="track" cx="10" cy="10" r="8"/><circle class="bar" cx="10" cy="10" r="8" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/></svg>`);
  const ringBar = ring.querySelector('.bar');
  const photoLbl = h('span', { class: 'lbl' }, t('photo'));
  const photoCount = h('span', { class: 'count', 'aria-hidden': 'true' });
  const photoBtn = h('button', {
    type: 'button', class: 'pill glass photo-btn', 'aria-pressed': 'false',
    'aria-label': t('photo.aria'), title: t('photo.title'),
  }, svg(icon('camera')), ring, photoLbl, photoCount);
  photoBtn.addEventListener('click', () => (photo ? cancelPhoto() : startPhoto()));

  const hintChip = h('div', { class: 'chip glass' });
  const hint = h('div', { class: 'stage-hint', 'aria-hidden': 'true' }, hintChip);
  let hintKind = '3d';
  function setHint(kind) {
    hintKind = kind;
    if (kind === 'plan') hintChip.replaceChildren(svg(icon('cube')), h('span', null, t(isTouch() ? 'hint.planTouch' : 'hint.planMouse')));
    else hintChip.replaceChildren(svg(icon('drag')), h('span', null, t(isTouch() ? 'hint.touch' : 'hint.mouse')));
  }
  setHint('3d');

  const photoNoteTxt = h('span', null, t('photo.note'));
  const photoNote = h('div', { class: 'photo-note', 'aria-hidden': 'true' },
    h('div', { class: 'chip glass' }, svg(icon('sparkle')), photoNoteTxt));
  const retryLbl = h('span', null, t('retry'));
  const retryBtn = h('button', { type: 'button', class: 'pill glass retry-btn', hidden: true }, svg(icon('cube')), retryLbl);
  retryBtn.addEventListener('click', () => retry());
  const backLbl = h('span', null, t('back'));
  const backBtn = h('button', { type: 'button', class: 'pill glass back-btn', hidden: true },
    svg(icon('chevronLeft')), backLbl);
  backBtn.addEventListener('click', () => onBack?.());
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const busyLbl = h('span', { class: 'loading-label' });
  const busyChip = h('div', { class: 'busy-chip', 'aria-hidden': 'true', hidden: true },
    h('div', { class: 'loading-chip glass' }, busyLbl, h('span', { class: 'loading-bar is-indeterminate' }, h('i'))));

  const topL = h('div', { class: 'stage-top-l' }, chip);
  const topBack = h('div', { class: 'stage-back' }, backBtn);
  const topR = h('div', { class: 'stage-top-r' }, times.el, timeCycle, photoBtn, retryBtn);
  const dock = h('div', { class: 'stage-dock' }, views.el);
  ui.replaceChildren(topL, topBack, topR, dock, hint, photoNote, busyChip, live);
  const syncDockOverflow = () => views.el.classList.toggle('is-overflow', views.el.scrollWidth > views.el.clientWidth + 1);
  narrowMq.addEventListener?.('change', () => { views.relabel(viewList()); requestAnimationFrame(syncDockOverflow); });
  if ('ResizeObserver' in window) new ResizeObserver(syncDockOverflow).observe(views.el);
  const show3dControls = (on) => {
    for (const n of [times.el, timeCycle, photoBtn, dock]) n.hidden = !on;
    if (on) photoBtn.hidden = !(quality === 'high' && typeof villar?.startPhoto === 'function');
  };
  show3dControls(false);

  function syncTimeCycle() {
    const v = TIME_IDS.includes(times.value) ? times.value : 'day';
    timeCycle.replaceChildren(svg(icon(v)), h('span', null, t(`time.${v}`)));
    timeCycle.setAttribute('aria-label', t('stage.timeAria', { t: t(`time.${v}`) }));
  }
  function setTime(v) {
    cancelPhoto();
    defer(() => call('setTimeOfDay', v));
    syncTimeCycle();
    live.textContent = `${t('stage.times')}: ${t(`time.${v}`)}`;
  }
  syncTimeCycle();

  // ---------- Loading ----------
  const STAGES = { start: 'load.start', modules: 'load.start', scene: 'load.scene', textures: 'load.textures', lighting: 'load.lighting', ready: 'load.ready' };
  const PHASES = [[0.25, 'load.scene'], [0.6, 'load.textures'], [0.95, 'load.lighting'], [1.01, 'load.ready']];
  let loadStage = null;
  let lastProgress = -1, lastProgressAt = 0, lastTick = 0, startedAt = 0;
  function setLoad(v, stage) {
    if (v == null || !Number.isFinite(v)) {
      loadBar.classList.add('is-indeterminate');
      loadPct.textContent = '';
      return;
    }
    v = Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
    if (v > lastProgress) { lastProgress = v; lastProgressAt = performance.now(); }
    loadBar.classList.remove('is-indeterminate');
    loadBar.style.setProperty('--p', v.toFixed(3));
    loadPct.textContent = `${Math.round(v * 100)}%`;
    if (stage) loadStage = stage;
    loadLabel.textContent = t(STAGES[loadStage] || PHASES.find(([x]) => v < x)?.[1] || 'load.ready');
    loading.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }
  function onProgress(p) {
    if (mode === '3d') { onPhoto(p); return; }
    if (mode !== 'loading') return;
    if (typeof p === 'number') return setLoad(p);
    if (!p || typeof p !== 'object') return;
    const v = p.progress ?? p.value ?? p.p ?? (p.loaded != null && p.total ? p.loaded / p.total : null);
    if (v != null) setLoad(Number(v), p.stage);
  }
  function showLoading() {
    root.classList.remove('is-ready');
    loading.classList.remove('is-done');
    loading.removeAttribute('aria-hidden');
  }
  function hideLoading() { loading.classList.add('is-done'); loading.setAttribute('aria-hidden', 'true'); }

  function startWatchdog(gen) {
    clearInterval(watchdog);
    startedAt = lastProgressAt = lastTick = performance.now();
    lastProgress = -1;
    watchdog = setInterval(() => {
      if (gen !== generation || mode !== 'loading') return clearInterval(watchdog);
      const now = performance.now();
      // A late tick means the main thread was busy (the engine is working), not stalled.
      if (now - lastTick > 3000) lastProgressAt = now;
      lastTick = now;
      if (now - lastProgressAt > stallMs || now - startedAt > hardMs) {
        clearInterval(watchdog);
        fail(new Error(now - startedAt > hardMs ? 'took too long' : 'loading stalled'), { quiet: true });
      }
    }, 1000);
  }

  // ---------- Hint ----------
  function showHint(ms = 4000) {
    clearTimeout(hintTimer);
    hint.classList.add('is-visible');
    hintTimer = setTimeout(hideHint, ms);
  }
  function hideHint() { clearTimeout(hintTimer); hint.classList.remove('is-visible'); }

  // ---------- Photo mode ----------
  function setRing(prog) {
    if (prog == null) { ring.classList.add('is-spin'); ringBar.setAttribute('stroke-dashoffset', (RING_C * 0.72).toFixed(2)); return; }
    ring.classList.remove('is-spin');
    ringBar.setAttribute('stroke-dashoffset', (RING_C * (1 - Math.max(0, Math.min(1, prog)))).toFixed(2));
  }
  function startPhoto() {
    if (mode !== '3d' || !villar || typeof villar.startPhoto !== 'function') return;
    hideHint();
    onHover(null);
    photo = { target: null, done: false };
    root.classList.add('is-photo');
    photoBtn.classList.add('is-active');
    photoBtn.classList.remove('is-done');
    photoBtn.setAttribute('aria-pressed', 'true');
    photoBtn.setAttribute('aria-label', t('photo.stopAria'));
    photoLbl.textContent = t('photo.rendering');
    photoCount.textContent = '';
    photoNoteTxt.textContent = t('photo.note');
    setRing(null);
    live.textContent = t('photo.live');
    const r = call('startPhoto');
    if (r && typeof r.then === 'function') r.catch((e) => { warn('startPhoto rejected', e); resetPhotoUI(); });
  }
  function resetPhotoUI() {
    photo = null;
    root.classList.remove('is-photo');
    photoBtn.classList.remove('is-active', 'is-done');
    photoBtn.setAttribute('aria-pressed', 'false');
    photoBtn.setAttribute('aria-label', t('photo.aria'));
    photoLbl.textContent = t('photo');
    photoCount.textContent = '';
  }
  function cancelPhoto() {
    if (!photo) return;
    resetPhotoUI();
    call('stopPhoto');
  }
  function onPhoto(p) {
    if (p == null) return;
    const obj = typeof p === 'object' ? p : {};
    if (!photo) {
      // The UI already cancelled: make sure the engine agrees (it may still be preparing).
      if ((obj.state === 'started' || obj.samples != null) && villar?.photoActive !== false) call('stopPhoto');
      return;
    }
    let samples = null, target = null, prog = null, done = false, stopped = false;
    if (typeof p === 'number') prog = p > 1 ? p / 100 : p;
    else {
      samples = obj.samples ?? obj.sample ?? obj.spp ?? obj.count ?? null;
      target = obj.target ?? obj.total ?? obj.max ?? obj.maxSamples ?? obj.goal ?? null;
      prog = obj.progress ?? null;
      done = !!(obj.done || obj.complete || obj.converged || obj.state === 'done');
      stopped = obj.active === false || obj.running === false || obj.stopped || obj.cancelled || ['stopped', 'cancelled', 'error'].includes(obj.state);
      if (target) photo.target = target;
      if (samples != null && target == null && photo.target) target = photo.target;
      if (prog == null && samples != null && target) prog = samples / target;
    }
    if (stopped && !done) {
      if (obj.state === 'error') warn('photo mode failed:', obj.message || '');
      return resetPhotoUI();
    }
    if (obj.state === 'preparing' || (obj.state === 'started' && samples == null)) return;
    if (prog != null && prog >= 1) done = true;
    setRing(done ? 1 : prog);
    if (samples != null) photoCount.textContent = target ? `${samples} / ${target}` : String(samples);
    else if (prog != null) photoCount.textContent = `${Math.round(prog * 100)}%`;
    if (done && !photo.done) {
      photo.done = true;
      photoBtn.classList.add('is-done');
      photoLbl.textContent = t('photo.done');
      photoNoteTxt.textContent = t('photo.noteDone');
      live.textContent = t('photo.liveDone');
    }
  }

  // Any interaction with the scene cancels photo mode and dismisses the hint.
  const interact = () => { hideHint(); cancelPhoto(); };
  canvasHost.addEventListener('pointerdown', interact, { passive: true, capture: true });
  canvasHost.addEventListener('wheel', interact, { passive: true, capture: true });
  canvasHost.addEventListener('touchstart', interact, { passive: true, capture: true });
  root.addEventListener('keydown', (e) => {
    if (['Tab', 'Shift', 'Alt', 'Meta', 'Control'].includes(e.key)) return;
    if (photo && !photoBtn.contains(e.target)) cancelPhoto();
  });
  canvasHost.addEventListener('pointermove', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
  canvasHost.addEventListener('pointerleave', () => onHover(null));

  // The engine walks with arrows/WASD from a window-level listener (engine request E15). Until it scopes
  // that to its canvas, keep page keyboard scrolling: only swallow those keys when nothing is focused.
  const WALK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
  window.addEventListener('keydown', (e) => {
    if (!WALK_KEYS.has(e.code) || mode !== '3d') return;
    const t = e.target;
    if (t === document || t === document.body || t === document.documentElement) e.stopImmediatePropagation();
  }, true);

  // ---------- Focus mode (HUD open): quiet the scene controls, offer «Назад» ----------
  function setFocusMode(on) {
    root.classList.toggle('is-focus', !!on);
    backBtn.hidden = !on;
    if (on) { hideHint(); cancelPhoto(); }
  }

  // ---------- Language ----------
  onLang(() => {
    views.relabel(viewList(), t('stage.views'));
    labelCanvas();
    times.relabel(timeItems(), t('stage.times'));
    syncTimeCycle(); syncChip(); setHint(hintKind);
    retryLbl.textContent = t('retry'); backLbl.textContent = t('back');
    if (!photo) { photoLbl.textContent = t('photo'); photoBtn.setAttribute('aria-label', t('photo.aria')); }
    photoBtn.title = t('photo.title');
    if (mode === 'loading') loadLabel.textContent = t(STAGES[loadStage] || 'load.label');
    root.setAttribute('aria-label', t('stage.aria'));
  });
  syncChip();

  // ---------- Engine ----------
  function bind(v, gen) {
    const on = (evt, fn) => { try { v.on?.(evt, (p) => { if (gen === generation) fn(p); }); } catch (e) { warn(`on(${evt}) failed`, e); } };
    on('progress', onProgress);
    on('photo', (p) => onPhoto(p));
    on('hover', (p) => {
      if (photo || mode !== '3d') return;
      if (!p) return onHover(null);
      onHover({ ...p, x: p.x ?? lastPointer?.x, y: p.y ?? lastPointer?.y });
    });
    on('select', (p) => { if (mode === '3d') onSelect(p || null); });
    on('time', (p) => {
      const t = p?.time || p;
      if (TIME_IDS.includes(t) && t !== times.value) { times.set(t); syncTimeCycle(); }
    });
    on('view', (p) => {
      const vname = p && typeof p === 'object' ? p.view : p;
      views.set(VIEW_IDS.includes(vname) ? vname : null);
    });
    on('ready', (p) => onReady(p));
    // Fatal context loss / engine errors → plan. Event names are tolerant until the engine pins one.
    for (const evt of ['contextlost', 'contextLost', 'context-lost', 'lost', 'fatal']) {
      on(evt, (p) => fail(new Error(`engine ${evt}${p?.message ? `: ${p.message}` : ''}`), { canRetry: true }));
    }
    // Our own detector, in case the engine never reports it: a lost context that isn't restored soon.
    const canvas = canvasHost.querySelector('canvas');
    if (canvas) {
      let lostTimer = 0;
      canvas.addEventListener('webglcontextlost', () => {
        clearTimeout(lostTimer);
        lostTimer = setTimeout(() => { if (gen === generation) fail(new Error('WebGL context lost'), { canRetry: true }); }, CONTEXT_RESTORE_MS);
      });
      canvas.addEventListener('webglcontextrestored', () => clearTimeout(lostTimer));
    }
  }

  function onReady(info) {
    if (mode === '3d' || mode === 'plan') return;
    clearInterval(watchdog);
    onHover(null);
    setMode('3d');
    root.classList.add('is-3d', 'is-ready');
    root.classList.remove('is-plan');
    syncChip();
    labelCanvas();
    setHint('3d');
    hideLoading();
    if (info?.quality) quality = info.quality;
    show3dControls(true);
    retryBtn.hidden = true;
    const view = info?.view || villar?.view;
    const time = info?.time || villar?.timeOfDay;
    if (view && VIEW_IDS.includes(view)) views.set(view);
    if (time && TIME_IDS.includes(time)) times.set(time);
    else call('setTimeOfDay', times.value);
    syncTimeCycle();
    // The HUD was opened while the engine was still loading: fly there now that it can.
    if (focused) {
      call('highlight', focused.slotId);
      if (typeof villar?.focus === 'function') call('focus', focused.slotId, { inset: focused.inset });
      else call('setInsets', focused.inset);
    }
    setTimeout(() => { if (mode === '3d' && !focused) showHint(); }, 700);
  }

  async function mountEngine(create, opts) {
    mountArgs = { create, opts };
    quality = opts?.quality || quality;
    const gen = ++generation;
    if (plan) { plan.destroy(); plan = null; planHost.hidden = true; root.classList.remove('is-plan'); }
    setMode('loading');
    showLoading();
    setLoad(null);
    loadStage = null;
    loadLabel.textContent = t('load.label');
    retryBtn.hidden = true;
    startWatchdog(gen);
    let v;
    try {
      // autoFocus: false — the UI decides when to fly, so the first flight already knows the HUD insets.
      v = await create({ container: canvasHost, store, onProgress: (p) => { if (gen === generation) onProgress(p); }, view: views.value || 'eye', timeOfDay: times.value, autoFocus: false, ...opts });
    } catch (err) {
      if (gen === generation) fail(err, { canRetry: true });
      return null;
    }
    if (gen !== generation) { try { v?.dispose?.(); } catch { /* already gone */ } return null; }
    if (!v) { fail(new Error('createVillar returned nothing')); return null; }
    villar = v;
    bind(v, gen);
    if (v.ready === true || window.__villarReady) onReady();
    else {
      // Belt and braces: the engine may have emitted 'ready' before we subscribed.
      const poll = () => {
        if (gen !== generation || mode !== 'loading') return;
        if (v.ready === true || window.__villarReady) return onReady();
        setTimeout(poll, 400);
      };
      setTimeout(poll, 400);
    }
    return v;
  }

  function showPlan() {
    if (mode === 'plan') return;
    setMode('plan');
    root.classList.add('is-plan');
    root.classList.remove('is-3d', 'is-ready', 'is-photo');
    planHost.hidden = false;
    plan = createPlan({ container: planHost, layout, store, onHover, onSelect });
    hideLoading();
    syncChip();
    show3dControls(false);
    setHint('plan');
    setTimeout(() => { if (mode === 'plan') showHint(5000); }, 400);
  }

  /** Engine missing, failed, stalled or lost its context: dispose it and show the plan. */
  function fail(err, { canRetry = true, quiet = false } = {}) {
    if (mode === 'plan' && !villar) return;
    generation++;
    clearInterval(watchdog);
    if (err) (quiet ? console.info : console.warn)('[villar:ui] 3D unavailable — showing the interactive plan:', err?.message || err);
    resetPhotoUI();
    onHover(null);
    if (villar) { call('dispose'); villar = null; }
    clearThumbs();
    canvasHost.replaceChildren();
    showPlan();
    retryBtn.hidden = !(canRetry && mountArgs);
  }

  function retry() {
    if (!mountArgs) return;
    onSelect(null);
    mountEngine(mountArgs.create, mountArgs.opts);
  }

  return {
    mountEngine,
    fail,
    retry,
    get mode() { return mode; },
    get engine() { return villar; },
    get view() { return views.value; },
    get time() { return times.value; },
    /** Programmatic view / time (assistant): moves the segmented controls and the engine together. */
    setView(name) {
      if (!VIEW_IDS.includes(name)) return false;
      cancelPhoto(); views.set(name); call('setView', name); return true;
    },
    setTime(name) {
      if (!TIME_IDS.includes(name)) return false;
      times.set(name); setTime(name); return true;
    },
    highlight(slotId) {
      if (mode === '3d') call('highlight', slotId ?? null);
      else plan?.highlight(slotId ?? null);
    },
    /** Tell the engine which part of the stage the HUD covers (feature-detected). */
    setInsets(insets) {
      if (focused) focused.inset = insets;
      if (mode === '3d') call('setInsets', insets || { right: 0, bottom: 0 });
    },
    /** Game-like focus on an object (engine flies the camera); falls back to highlight + insets. */
    focus(slotId, inset) {
      setFocusMode(true);
      focused = { slotId, inset };
      if (mode !== '3d') { plan?.highlight(slotId); return; }
      call('highlight', slotId);
      if (typeof villar?.focus === 'function') call('focus', slotId, { inset });
      else call('setInsets', inset);
    },
    unfocus() {
      setFocusMode(false);
      focused = null;
      if (mode !== '3d') { plan?.highlight(null); return; }
      call('highlight', null);
      if (typeof villar?.unfocus === 'function') call('unfocus');
      call('setInsets', { right: 0, bottom: 0 });
    },
    syncStyle() { syncChip(); syncPoster(); },
    /** The budget slider is held: the engine keeps the camera still and defers thumbnails and bakes. */
    setDragging(on) {
      if (on) { hideHint(); thumbHoldUntil = Math.max(thumbHoldUntil, performance.now() + 60_000); }
      else { thumbHoldUntil = performance.now() + 400; pumpThumbs(); }
      call('setDragging', !!on);
    },
    /** Quiet glass chip at the top of the stage while something heavy happens (style switch). Returns hide(). */
    busy(text) {
      busyLbl.textContent = text;
      busyChip.hidden = false;
      requestAnimationFrame(() => busyChip.classList.add('is-visible'));
      return () => { busyChip.classList.remove('is-visible'); setTimeout(() => { if (!busyChip.classList.contains('is-visible')) busyChip.hidden = true; }, 320); };
    },
    /** Product thumbnails rendered by the engine (feature-detected; cached per item; queued — T7). */
    thumbs: {
      available: () => mode === '3d' && typeof villar?.thumbnail === 'function',
      get(id) {
        if (!thumbCache.has(id)) {
          thumbCache.set(id, new Promise((resolve) => thumbQueue.push({ id, resolve })));
          pumpThumbs();
        }
        return thumbCache.get(id);
      },
      /** Move a queued thumbnail ahead of the ones nobody can see yet. */
      bump(id) { const j = thumbQueue.find((x) => x.id === id && !x.prio); if (j) j.prio = ++thumbSeq; },
      /** Hold rendering (e.g. for the duration of a camera flight). */
      hold(ms) { thumbHoldUntil = Math.max(thumbHoldUntil, performance.now() + ms); },
    },
    cancelPhoto,
  };
}
