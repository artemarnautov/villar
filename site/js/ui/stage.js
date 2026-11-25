// Studio stage: hosts the 3D engine, overlay controls, loading, photo mode, hint and the plan fallback.
// Owner: interface. Talks to the engine only through the public API in docs/SPEC.md.
import { h, svg, safeHex, isTouch } from './dom.js';
import { icon } from './icons.js';
import { VIEWS, TIMES } from './labels.js';
import { createSegmented } from './segmented.js';
import { createPlan } from './plan.js';

const RING_C = 2 * Math.PI * 8;
const READY_TIMEOUT = 45000;

export function createStage({ root, store, layout, stylepack, palette, onHover, onSelect }) {
  const canvasHost = root.querySelector('.stage-canvas');
  const planHost = root.querySelector('.stage-plan');
  const loading = root.querySelector('.stage-loading');
  const ui = root.querySelector('.stage-ui');
  const loadBar = loading.querySelector('.loading-bar');
  const loadLabel = loading.querySelector('.loading-label');
  const loadPct = loading.querySelector('.loading-pct');

  let villar = null;
  let plan = null;
  let mode = 'loading';     // loading | 3d | plan
  let photo = null;          // { samples, target, done }
  let hintTimer = 0;
  let readyTimer = 0;
  let lastPointer = null;
  const warn = (...a) => console.warn('[villar:ui]', ...a);
  const call = (fn, ...args) => {
    if (!villar || typeof villar[fn] !== 'function') return undefined;
    try { return villar[fn](...args); } catch (e) { warn(`engine.${fn} failed`, e); return undefined; }
  };

  // ---------- Controls ----------
  const woodHex = safeHex((palette?.swatches || []).find((s) => /wood/i.test(s.role))?.hex, '#4a3426');
  const chipLabel = h('span', null, stylepack.name || 'Стиль');
  const chip = h('div', { class: 'chip glass' },
    h('span', { class: 'dot', style: `--c:${woodHex}`, 'aria-hidden': 'true' }),
    chipLabel, h('span', { class: 'muted' }, `· ${layout.name || 'Квартира'}`));

  const views = createSegmented({
    label: 'Ракурс', items: VIEWS, value: 'eye',
    onChange: (v) => { cancelPhoto(); call('setView', v); },
  });
  const times = createSegmented({
    label: 'Время суток', items: TIMES.map((t) => ({ ...t, icon: t.value })), value: 'day', className: 'time-seg',
    onChange: (v) => setTime(v),
  });
  const timeCycle = h('button', { type: 'button', class: 'pill glass time-cycle' });
  timeCycle.addEventListener('click', () => {
    const i = TIMES.findIndex((t) => t.value === times.value);
    const next = TIMES[(i + 1) % TIMES.length].value;
    times.set(next);
    setTime(next);
  });

  const ring = svg(`<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle class="track" cx="10" cy="10" r="8"/><circle class="bar" cx="10" cy="10" r="8" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/></svg>`);
  const ringBar = ring.querySelector('.bar');
  const photoLbl = h('span', { class: 'lbl' }, 'Фото');
  const photoCount = h('span', { class: 'count', 'aria-hidden': 'true' });
  const photoBtn = h('button', { type: 'button', class: 'pill glass photo-btn', 'aria-pressed': 'false', 'aria-label': 'Фото: фотореалистичный рендер текущего вида' },
    svg(icon('camera')), ring, photoLbl, photoCount);
  photoBtn.addEventListener('click', () => (photo ? cancelPhoto() : startPhoto()));

  const hintChip = h('div', { class: 'chip glass' });
  const hint = h('div', { class: 'stage-hint', 'aria-hidden': 'true' }, hintChip);
  function setHint(kind) {
    if (kind === 'plan') {
      hintChip.replaceChildren(svg(icon('cube')),
        h('span', null, isTouch() ? 'Коснитесь предмета, чтобы заменить' : 'Наведите на предмет · Кликните, чтобы заменить'));
    } else {
      hintChip.replaceChildren(svg(icon('drag')),
        h('span', null, isTouch()
          ? 'Проведите, чтобы осмотреться · Коснитесь предмета'
          : 'Перетащите, чтобы осмотреться · Кликните по предмету'));
    }
  }
  setHint('3d');
  const photoNoteTxt = h('span', null, 'Фотореалистичный рендер · любое действие отменит');
  const photoNote = h('div', { class: 'photo-note', 'aria-hidden': 'true' },
    h('div', { class: 'chip glass' }, svg(icon('sparkle')), photoNoteTxt));
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });

  const topL = h('div', { class: 'stage-top-l' }, chip);
  const topR = h('div', { class: 'stage-top-r' }, times.el, timeCycle, photoBtn);
  const dock = h('div', { class: 'stage-dock' }, views.el);
  ui.replaceChildren(topL, topR, dock, hint, photoNote, live);
  for (const n of [topR, dock]) n.hidden = true;

  function syncTimeCycle() {
    const t = TIMES.find((x) => x.value === times.value) || TIMES[1];
    timeCycle.innerHTML = icon(t.value);
    timeCycle.setAttribute('aria-label', `Время суток: ${t.label}. Нажмите, чтобы сменить`);
    timeCycle.title = t.label;
  }
  function setTime(v) {
    cancelPhoto();
    call('setTimeOfDay', v);
    syncTimeCycle();
    live.textContent = `Время суток: ${TIMES.find((t) => t.value === v)?.label || ''}`;
  }
  syncTimeCycle();

  // ---------- Loading ----------
  const PHASES = [[0.25, 'Строим стены'], [0.55, 'Расставляем мебель'], [0.85, 'Настраиваем свет'], [1.01, 'Почти готово']];
  function setLoad(v) {
    if (v == null || !Number.isFinite(v)) {
      loadBar.classList.add('is-indeterminate');
      loadPct.textContent = '';
      return;
    }
    v = Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
    loadBar.classList.remove('is-indeterminate');
    loadBar.style.setProperty('--p', v.toFixed(3));
    loadPct.textContent = `${Math.round(v * 100)}%`;
    loadLabel.textContent = PHASES.find(([t]) => v < t)?.[1] || 'Почти готово';
    loading.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }
  function onProgress(p) {
    if (mode === '3d') { if (photo) onPhoto(p); return; }
    if (typeof p === 'number') return setLoad(p);
    if (!p || typeof p !== 'object') return;
    const v = p.progress ?? p.value ?? p.p ?? (p.loaded != null && p.total ? p.loaded / p.total : null);
    if (v != null) setLoad(Number(v));
  }
  function hideLoading() { loading.classList.add('is-done'); loading.setAttribute('aria-hidden', 'true'); }

  // ---------- Hint ----------
  function showHint() {
    clearTimeout(hintTimer);
    hint.classList.add('is-visible');
    hintTimer = setTimeout(hideHint, 7000);
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
    photo = { samples: 0, target: null, done: false };
    root.classList.add('is-photo');
    photoBtn.classList.add('is-active');
    photoBtn.classList.remove('is-done');
    photoBtn.setAttribute('aria-pressed', 'true');
    photoBtn.setAttribute('aria-label', 'Остановить фоторежим');
    photoLbl.textContent = 'Рендер';
    photoCount.textContent = '';
    photoNoteTxt.textContent = 'Фотореалистичный рендер · любое действие отменит';
    setRing(null);
    live.textContent = 'Фоторежим: идёт фотореалистичный рендер. Любое действие отменит.';
    const r = call('startPhoto');
    if (r && typeof r.then === 'function') r.catch((e) => { warn('startPhoto rejected', e); resetPhotoUI(); });
  }
  function resetPhotoUI() {
    photo = null;
    root.classList.remove('is-photo');
    photoBtn.classList.remove('is-active', 'is-done');
    photoBtn.setAttribute('aria-pressed', 'false');
    photoBtn.setAttribute('aria-label', 'Фото: фотореалистичный рендер текущего вида');
    photoLbl.textContent = 'Фото';
    photoCount.textContent = '';
  }
  function cancelPhoto() {
    if (!photo) return;
    call('stopPhoto');
    resetPhotoUI();
  }
  function onPhoto(p) {
    if (!photo || p == null) {
      return;
    }
    let samples = null, target = null, prog = null, done = false, stopped = false;
    if (typeof p === 'number') prog = p > 1 ? p / 100 : p;
    else if (typeof p === 'object') {
      samples = p.samples ?? p.sample ?? p.spp ?? p.count ?? null;
      target = p.target ?? p.total ?? p.max ?? p.maxSamples ?? p.goal ?? null;
      prog = p.progress ?? (samples != null && target ? samples / target : null);
      done = !!(p.done || p.complete || p.converged || p.state === 'done');
      stopped = p.active === false || p.running === false || p.stopped || p.cancelled || ['stopped', 'cancelled', 'error'].includes(p.state);
      if (target) photo.target = target;
      if (samples != null && target == null && photo.target) target = photo.target;
      if (prog == null && samples != null && target) prog = samples / target;
    }
    if (stopped && !done) {
      if (p.state === 'error') warn('photo mode failed:', p.message || '');
      return resetPhotoUI();
    }
    if (p.state === 'preparing' || (p.state === 'started' && samples == null)) return;
    if (prog != null && prog >= 1) done = true;
    setRing(done ? 1 : prog);
    if (samples != null) photoCount.textContent = target ? `${samples} / ${target}` : String(samples);
    else if (prog != null) photoCount.textContent = `${Math.round(prog * 100)}%`;
    if (done && !photo.done) {
      photo.done = true;
      photoBtn.classList.add('is-done');
      photoLbl.textContent = 'Готово';
      photoNoteTxt.textContent = 'Кадр готов · любое действие вернёт в 3D';
      live.textContent = 'Фото готово.';
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

  // The engine walks with arrows/WASD from a window-level listener. Only let those keys reach it
  // while focus is inside the stage and the stage is on screen, so page scrolling stays intact.
  const WALK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
  let onScreen = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { onScreen = e.intersectionRatio > 0.35; }, { threshold: [0, 0.35, 0.6, 1] }).observe(root);
  }
  window.addEventListener('keydown', (e) => {
    if (!WALK_KEYS.has(e.code) || mode !== '3d') return;
    const inStage = root.contains(document.activeElement);
    if (!inStage || !onScreen) e.stopImmediatePropagation();
  }, true);

  // ---------- Engine ----------
  function bind(v) {
    const on = (evt, fn) => { try { v.on?.(evt, fn); } catch (e) { warn(`on(${evt}) failed`, e); } };
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
      if (TIMES.some((x) => x.value === t) && t !== times.value) { times.set(t); syncTimeCycle(); }
    });
    on('ready', (p) => onReady(p));
  }

  function onReady(info) {
    if (mode === '3d') return;
    clearTimeout(readyTimer);
    if (plan) { plan.destroy(); plan = null; planHost.hidden = true; }
    mode = '3d';
    root.classList.add('is-3d');
    root.classList.remove('is-plan');
    chipLabel.textContent = stylepack.name || 'Стиль';
    setHint('3d');
    hideLoading();
    topR.hidden = false; dock.hidden = false;
    photoBtn.hidden = typeof villar?.startPhoto !== 'function';
    // Reflect engine state if it exposes it; otherwise push our defaults.
    const view = info?.view || villar?.view;
    const time = info?.time || villar?.timeOfDay;
    if (view && VIEWS.some((x) => x.value === view)) views.set(view);
    if (time && TIMES.some((x) => x.value === time)) times.set(time);
    else call('setTimeOfDay', times.value);
    syncTimeCycle();
    setTimeout(showHint, 600);
  }

  async function mountEngine(create, opts) {
    setLoad(null);
    loadLabel.textContent = 'Собираем квартиру';
    readyTimer = setTimeout(() => {
      if (mode === 'loading') { console.info('[villar:ui] 3D still loading — showing the interactive plan meanwhile'); showPlan(); }
    }, READY_TIMEOUT);
    const v = await create({ container: canvasHost, store, onProgress, view: views.value, timeOfDay: times.value, ...opts });
    if (!v) throw new Error('createVillar returned nothing');
    villar = v;
    bind(v);
    if (window.__villarReady || v.ready === true) onReady();
    else {
      // Belt and braces: the engine may have emitted 'ready' before we subscribed.
      const t0 = performance.now();
      const poll = () => {
        if (mode === '3d') return;
        if (window.__villarReady) return onReady();
        if (performance.now() - t0 < READY_TIMEOUT + 60000) setTimeout(poll, 300);
      };
      setTimeout(poll, 300);
    }
    return v;
  }

  function showPlan() {
    if (mode === 'plan' || mode === '3d') return;
    mode = 'plan';
    root.classList.add('is-plan');
    planHost.hidden = false;
    plan = createPlan({ container: planHost, layout, store, onHover, onSelect });
    hideLoading();
    chipLabel.textContent = 'План';
    topR.hidden = true; dock.hidden = true;
    setHint('plan');
    setTimeout(showHint, 400);
  }

  function fail(err) {
    clearTimeout(readyTimer);
    if (err) warn('3D engine unavailable — showing interactive plan.', err?.message || err);
    if (villar) { call('dispose'); villar = null; }
    canvasHost.replaceChildren();
    showPlan();
  }

  return {
    mountEngine,
    fail,
    get mode() { return mode; },
    get engine() { return villar; },
    highlight(slotId) {
      if (mode === '3d') call('highlight', slotId ?? null);
      else plan?.highlight(slotId ?? null);
    },
    cancelPhoto,
  };
}
