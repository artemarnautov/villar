// Villar engine — public entry point. Owner: engine.
//
//   const villar = await createVillar({ container, store, layout, catalog, stylepack, quality: 'high' });
//   villar.on('ready'|'hover'|'select'|'progress'|'photo', fn)
//   villar.setView('eye'|'living'|'bed'|'dining'|'window'|'top')
//   villar.setTimeOfDay('morning'|'day'|'golden'|'evening')
//   villar.startPhoto(); villar.stopPhoto(); villar.highlight(slotId|null); villar.dispose()
//
// Rendering is on demand: frames are drawn only while something changes (camera motion,
// transitions, swaps, highlight, photo accumulation), which keeps laptops cool and fans quiet.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createEmitter, clamp, prefersReducedMotion } from './util.js';
import { buildArchitecture, CUT_HEIGHT } from './architecture.js';
import { createLighting, TOD, TIMES } from './lighting.js';
import { createSkyline, SKY_PRESETS } from './sky.js';
import { createPost, QUALITY } from './post.js';
import { createCameraController } from './camera.js';
import { createInteraction, ensureBVH } from './interaction.js';
import { createFurnisher } from './furnish.js';
import { createPhoto } from './photo.js';
import { createProbeVolume } from './probes.js';
import { buildProxy, createFallbackMaterials } from './proxies.js';

const VIEWS = ['eye', 'living', 'bed', 'dining', 'window', 'top'];
const TONE = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping };
const BASE_EXPOSURE = { agx: 1.0, aces: 0.72, neutral: 0.85 };
// slots hidden in the dollhouse (they hang from the ceiling or sit high on cut walls)
const CUTAWAY_HIDE = new Set(['pendant_lamp', 'wall_art', 'curtains']);

let chunksPatched = false;
function patchShaderChunks(taps) {
  if (chunksPatched) return;
  chunksPatched = true;
  // r187 PCF = 5 Vogel taps with per-pixel rotation; more taps → smooth, grain-free penumbrae.
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const re = /shadow = \(\s*texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( 0, 5, phi \) \* radius, shadowCoord\.z \) \)[\s\S]*?\) \* 0\.2;/g;
  const out = src.replace(re, `shadow = 0.0;
				for ( int i = 0; i < VILLAR_SHADOW_TAPS; i ++ ) {
					shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, VILLAR_SHADOW_TAPS, phi ) * radius, shadowCoord.z ) );
				}
				shadow /= float( VILLAR_SHADOW_TAPS );`);
  if (out !== src) THREE.ShaderChunk.shadowmap_pars_fragment = `#define VILLAR_SHADOW_TAPS ${taps}\n` + out;
}

async function loadMaterials(renderer, quality) {
  try {
    const m = await import('./materials.js');
    return m.createMaterials(renderer, { quality });
  } catch (e) {
    console.debug('[villar] materials.js unavailable, using fallback materials', e);
    return createFallbackMaterials();
  }
}
async function loadFurniture() {
  try {
    const m = await import('./furniture/index.js');
    if (typeof m.buildItem !== 'function') throw new Error('furniture/index.js has no buildItem');
    return (item, ctx) => {
      try { return m.buildItem(item, ctx); }
      catch (e) { console.warn(`[villar] buildItem failed for ${item.id}; using proxy`, e); return buildProxy(item, ctx); }
    };
  } catch (e) {
    console.debug('[villar] furniture module unavailable, using box proxies', e);
    return buildProxy;
  }
}

export async function createVillar({
  container, store, layout, catalog, stylepack, palette = null,
  quality = 'high', timeOfDay = 'day', view = 'eye', adaptive = true, toneMapping = 'agx', gi = true,
} = {}) {
  if (!container) throw new Error('createVillar: container is required');
  layout = layout || store?.state?.layout;
  stylepack = stylepack || store?.state?.stylepack;
  catalog = catalog || store?.state?.catalog;
  const events = createEmitter();
  let disposed = false;
  let Q = QUALITY[quality] ? quality : 'high';
  patchShaderChunks(Q === 'low' ? 5 : Q === 'medium' ? 8 : 12);

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE[toneMapping] || THREE.AgXToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;-webkit-tap-highlight-color:transparent;';
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute('aria-label', '3D-вид квартиры');
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);
  RectAreaLightUniformsLib.init();

  const maxDpr = () => Math.min(window.devicePixelRatio || 1, QUALITY[Q].maxDpr, 2);
  let dpr = maxDpr();
  const cssSize = () => ({ w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) });
  {
    const { w, h } = cssSize();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
  }

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  scene.name = 'villar';
  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 9000);
  camera.name = 'eye';

  const materials = await loadMaterials(renderer, Q);
  const buildItem = await loadFurniture();
  if (disposed) return null;

  const arch = buildArchitecture({ layout, stylepack, palette, materials });
  scene.add(arch.group);
  const skyline = createSkyline({ center: new THREE.Vector3(layout.size.x / 2, 0, layout.size.z) });
  scene.add(skyline.mesh);
  const lighting = createLighting({ renderer, scene, arch, layout, quality: Q });
  const furnisher = createFurnisher({ layout, store, materials, buildItem, quality: Q });
  scene.add(furnisher.root);
  furnisher.placeAll();
  lighting.setLampLights(furnisher.lampLights());
  ensureBVH(arch.group);

  // floor marker for click-to-walk
  const marker = (() => {
    const g = new THREE.RingGeometry(0.13, 0.155, 48); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 0.9, transparent: true, opacity: 0.0, depthWrite: false, roughness: 1 });
    const mesh = new THREE.Mesh(g, m);
    const dotG = new THREE.CircleGeometry(0.03, 24); dotG.rotateX(-Math.PI / 2);
    const dot = new THREE.Mesh(dotG, m);
    mesh.add(dot);
    mesh.renderOrder = 5;
    mesh.userData = { noCapture: true, noAO: true, noPick: true };
    dot.userData = { noCapture: true, noAO: true, noPick: true };
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, mat: m, target: 0, pulse: 0 };
  })();

  // ---------------------------------------------------------------- GI probe volume
  const PROBE_RES = { high: [5, 3, 10], medium: [4, 3, 8], low: [4, 3, 7] };
  const NO_OBSTACLE = new Set(['rug', 'curtains', 'wall_art', 'pendant_lamp']);
  const probes = createProbeVolume({
    renderer, scene,
    box: new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(layout.size.x, layout.size.ceiling, layout.size.z)),
    res: PROBE_RES[Q] || PROBE_RES.high,
    obstacles: () => {
      const out = arch.colliders.map((c) => new THREE.Box3(new THREE.Vector3(c.x0, -1, c.z0), new THREE.Vector3(c.x1, 4, c.z1)));
      for (const rec of furnisher.placed.values()) {
        if (NO_OBSTACLE.has(rec.slot.type)) continue;
        out.push(new THREE.Box3().setFromObject(rec.group));
      }
      return out;
    },
  });

  // ---------------------------------------------------------------- post
  const aoBox = new THREE.Box3(new THREE.Vector3(-0.3, -0.1, -0.3), new THREE.Vector3(layout.size.x + 0.3, layout.size.ceiling + 0.3, layout.size.z + 2));
  const post = createPost({ renderer, scene, camera, quality: Q, aoBox });

  // ---------------------------------------------------------------- state & helpers
  let framesToRender = 3;
  const invalidate = (n = 2) => { framesToRender = Math.max(framesToRender, n); };
  let currentTime = TOD[timeOfDay] ? timeOfDay : 'day';
  let tone = TONE[toneMapping] ? toneMapping : 'agx';
  let exposureOverride = null;
  let highlighted = null;
  let cutaway = false;
  let envTimer = 0;
  let texturesSettled = false;

  function applyExposure() {
    const base = BASE_EXPOSURE[tone] ?? 1;
    renderer.toneMappingExposure = exposureOverride ?? base * TOD[currentTime].exposure;
  }

  function setCutaway(on) {
    if (cutaway === on) return;
    cutaway = on;
    arch.setCutaway(on);
    for (const [id, rec] of furnisher.placed) {
      const hide = on && (CUTAWAY_HIDE.has(rec.slot.type) || (rec.slot.mount === 'wall'));
      rec.group.visible = !hide;
      void id;
    }
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  }

  function refreshEnvironment(passes = 1) {
    renderer.shadowMap.needsUpdate = true;
    const wasCut = cutaway;
    if (wasCut) { arch.setCutaway(false); }
    lighting.captureEnvironment({ passes, hide: [marker.mesh] });
    if (wasCut) { arch.setCutaway(true); }
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  }
  // the modeler's procedural textures are generated time-sliced after first use: re-render and
  // re-capture the room environment once they land (placeholders are flat grey)
  let texWatch = null;
  function watchTextures() {
    if (texWatch || !materials.pending || materials.pending() === 0) return texWatch || Promise.resolve();
    texWatch = materials.ready().then(() => {
      texWatch = null;
      if (disposed) return;
      if (texturesSettled) scheduleEnvironment(30, { fresh: false, bounces: 1 });
      invalidate(3);
    });
    return texWatch;
  }
  function scheduleEnvironment(delay = 250, opts = { fresh: false, bounces: 1 }) {
    clearTimeout(envTimer);
    envTimer = setTimeout(() => { if (!disposed) { if (gi) relight(opts); else refreshEnvironment(1); } }, delay);
  }

  /** Shadows → GI probes (progressive) → room reflection capture. */
  let relightGen = 0;
  function relight({ fresh = true, bounces = 2 } = {}) {
    renderer.shadowMap.needsUpdate = true;
    const gen = ++relightGen;
    if (fresh) { probes.setEnabled(false); lighting.setFallback(true); refreshEnvironment(1); }
    const prepare = () => {
      const hidden = [];
      const hide = (o) => { if (o.visible) { o.visible = false; hidden.push(o); } };
      hide(marker.mesh);
      const env = scene.environment; scene.environment = null;
      const wasFallback = lighting.fallback; lighting.setFallback(false);
      const wasCut = cutaway; if (wasCut) arch.setCutaway(false);
      return () => {
        for (const o of hidden) o.visible = true;
        scene.environment = env;
        lighting.setFallback(wasFallback);
        if (wasCut) arch.setCutaway(true);
      };
    };
    const t0 = performance.now();
    return probes.bake({
      bounces, fresh, prepare,
      onBounce: (b) => {
        if (gen !== relightGen) return;
        probes.setEnabled(true); lighting.setFallback(false);
        if (b === bounces - 1) { refreshEnvironment(1); perf.bakeMs = performance.now() - t0; }
        invalidate(3);
      },
    });
  }

  // ---------------------------------------------------------------- camera + interaction
  const controls = createCameraController({
    camera, dom: canvas, layout, colliders: arch.colliders,
    onChange: (e) => {
      invalidate();
      if (e.mode === 'orbit' && !e.transitioning) setCutaway(true);
      if (e.mode === 'walk' && !e.transitioning) setCutaway(false);
      if (e.transitioning && e.mode === 'orbit') setCutaway(true);
    },
  });
  controls.setColliders(furnisher.colliders());

  const interaction = createInteraction({
    dom: canvas, camera,
    pickRoots: () => [furnisher.root, cutaway ? arch.cutGroup : arch.full],
    getSlotInfo: (id) => furnisher.info(id),
    onHover: (p) => events.emit('hover', p),
    onSelect: (p) => events.emit('select', p),
    onFloorClick: (pt) => {
      if (controls.mode !== 'walk') return;
      controls.walkTo(pt);
      marker.mesh.position.set(pt.x, 0.004, pt.z);
      marker.pulse = 1; marker.mesh.visible = true;
      invalidate();
    },
    onFloorHover: (pt) => {
      if (pt && controls.mode === 'walk' && !photo.active) {
        marker.mesh.position.set(pt.x, 0.004, pt.z);
        marker.target = 0.55; marker.mesh.visible = true;
      } else marker.target = 0;
      invalidate();
    },
  });
  controls.onClick = (e) => { if (photo.active) return; interaction.click(e); };
  controls.onInteract = () => { if (photo.active) stopPhoto(); invalidate(); };

  // ---------------------------------------------------------------- photo mode
  let photoNeedsRender = false;
  const photo = createPhoto({
    renderer, scene, camera,
    emit: (evt, p) => { events.emit(evt, p); photoNeedsRender = true; },
    rasterRender: () => post.render(0.016),
    prepare: () => {
      // physical state for the path tracer snapshot
      const saved = [];
      const set = (obj, key, val) => { saved.push([obj, key, obj[key]]); obj[key] = val; };
      for (const l of lighting.fakeLights) set(l, 'visible', false);
      set(marker.mesh, 'visible', false);
      set(scene, 'environment', lighting.skyTexture);
      set(scene, 'environmentIntensity', 1);
      for (const m of arch.glassMaterials) { set(m, 'transmission', 1); set(m, 'opacity', 1); set(m, 'transparent', false); set(m, 'roughness', 0.0); }
      const sky = skyline.mesh.material;
      const skyEm = sky.emissiveMap;
      if (currentTime !== 'evening') { set(sky, 'emissiveMap', null); set(sky, 'emissiveIntensity', 0.45); }
      const restore = () => { for (let i = saved.length - 1; i >= 0; i--) { const [o, k, v] = saved[i]; o[k] = v; } sky.emissiveMap = skyEm; };
      restore.exposureScale = 1.0;
      return restore;
    },
  });
  function startPhoto(opts = {}) {
    if (photo.active || photo.busy) return;
    interaction.setEnabled(false);
    marker.target = 0; marker.mesh.visible = false;
    post.setSelection([]);
    const go = () => photo.start({ samples: opts.samples || (Q === 'high' ? 512 : 256), scale: opts.scale || 1 });
    if (materials.pending && materials.pending() > 0) { events.emit('photo', { state: 'preparing' }); materials.ready().then(go); } else go();
  }
  function stopPhoto() {
    if (!photo.active && !photo.busy) return;
    photo.stop();
    interaction.setEnabled(true);
    if (highlighted) post.setSelection(furnisher.meshesOf(highlighted));
    invalidate(3);
  }

  // ---------------------------------------------------------------- store changes
  const unsubStore = store?.on ? store.on('change', ({ slotType }) => {
    if (photo.active || photo.busy) stopPhoto();
    const rebuilt = furnisher.rebuildType(slotType);
    lighting.setLampLights(furnisher.lampLights());
    controls.setColliders(furnisher.colliders());
    if (cutaway) for (const id of rebuilt) {
      const rec = furnisher.placed.get(id);
      if (rec && (CUTAWAY_HIDE.has(rec.slot.type) || rec.slot.mount === 'wall')) rec.group.visible = false;
    }
    if (highlighted && rebuilt.includes(highlighted)) post.setSelection(furnisher.meshesOf(highlighted));
    renderer.shadowMap.needsUpdate = true;
    scheduleEnvironment(200, { fresh: false, bounces: 1 });
    watchTextures();
    interaction.refresh();
    invalidate(3);
  }) : () => {};

  // ---------------------------------------------------------------- time of day
  function setTimeOfDay(tod) {
    if (!TOD[tod]) { console.warn(`[villar] unknown time of day "${tod}"`); return; }
    if (photo.active || photo.busy) stopPhoto();
    currentTime = tod;
    lighting.setTimeOfDay(tod);
    skyline.setTimeOfDay(tod, SKY_PRESETS[tod]);
    materials.setLampsOn?.(TOD[tod].lamps, 1);
    post.setBloom(TOD[tod].lamps);
    applyExposure();
    if (texturesSettled && gi) relight({ fresh: true, bounces: Q === 'low' ? 1 : 2 });
    else refreshEnvironment(1);
    events.emit('time', { time: tod });
  }

  // ---------------------------------------------------------------- sizing + adaptive DPR
  function resize() {
    const { w, h } = cssSize();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.setSize(db.x, db.y);
    controls.resize(w, h);
    invalidate();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(container);
  window.addEventListener('resize', resize);

  const perf = { frames: 0, time: 0, slowStreak: 0, fastStreak: 0, fps: 0 };
  function adapt(dt) {
    if (!adaptive) return;
    perf.frames++; perf.time += dt;
    if (perf.time < 1.2) return;
    const fps = perf.frames / perf.time;
    perf.fps = fps; perf.frames = 0; perf.time = 0;
    if (fps < 45) {
      perf.slowStreak++; perf.fastStreak = 0;
      if (dpr > 1.0 + 1e-3) { dpr = Math.max(1, dpr - 0.25); resize(); }
      else if (perf.slowStreak >= 3 && Q !== 'low') {
        Q = Q === 'high' ? 'medium' : 'low';
        post.setQuality(Q);
        console.debug('[villar] quality →', Q, `(${fps.toFixed(0)} fps)`);
        perf.slowStreak = 0;
      }
    } else if (fps > 58) {
      perf.fastStreak++; perf.slowStreak = 0;
      if (perf.fastStreak >= 4 && dpr < maxDpr() - 1e-3) { dpr = Math.min(maxDpr(), dpr + 0.25); resize(); perf.fastStreak = 0; }
    } else { perf.slowStreak = 0; perf.fastStreak = 0; }
  }

  // ---------------------------------------------------------------- loop
  let raf = 0, last = performance.now(), lastRenderAt = 0, ready = false, giSettled = false;
  const clock = { frames: 0 };
  function render(now) {
    if (photo.active) {
      // path tracing: one sample (tile set) per frame until converged
      if (!photo.done || photoNeedsRender) { photo.render(); photoNeedsRender = false; }
      return;
    }
    if (renderer.shadowMap.needsUpdate) { /* consumed by this render */ }
    post.render(0.016);
    const dt = (now - lastRenderAt) / 1000;
    if (lastRenderAt && dt < 0.25) adapt(dt);
    lastRenderAt = now;
    clock.frames++;
  }
  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = (now - last) / 1000; last = now;
    renderer.info.reset();
    const moving = controls.update(dt);
    interaction.update(now, controls.isDragging() || controls.mode !== 'walk' && controls.mode !== 'orbit');
    // floor marker fade / pulse
    if (marker.mesh.visible) {
      const want = marker.pulse > 0 ? 0.9 : marker.target;
      marker.mat.opacity += (want - marker.mat.opacity) * Math.min(1, dt * 10);
      if (marker.pulse > 0) { marker.pulse = Math.max(0, marker.pulse - dt * 1.4); const s = 1 + (1 - marker.pulse) * 0.5; marker.mesh.scale.setScalar(s); }
      else marker.mesh.scale.setScalar(1);
      if (marker.mat.opacity < 0.01 && marker.target === 0 && marker.pulse === 0) marker.mesh.visible = false;
      invalidate(1);
    }
    if (moving) invalidate(2);
    if (probes.baking && !photo.active) probes.step(moving || controls.isDragging() ? 4 : 10);
    if (photo.active) { render(now); return; }
    if (framesToRender > 0) {
      framesToRender--;
      render(now);
      if (!ready && clock.frames >= 2 && giSettled) markReady();
    } else lastRenderAt = 0;
  }

  function markReady() {
    ready = true;
    window.villar = api;
    window.__villarReady = true;
    events.emit('ready', { quality: Q, time: currentTime, view: controls.view });
  }

  // ---------------------------------------------------------------- public API
  const api = {
    on: (evt, fn) => events.on(evt, fn),
    off: (evt, fn) => events.off(evt, fn),
    setView(name, opts) {
      if (!VIEWS.includes(name) && !(layout.views || {})[name]) { console.warn(`[villar] unknown view "${name}"`); return; }
      if (photo.active || photo.busy) stopPhoto();
      controls.setView(name, opts);
      invalidate(2);
    },
    get view() { return controls.view; },
    setTimeOfDay,
    get timeOfDay() { return currentTime; },
    startPhoto, stopPhoto,
    get photoActive() { return photo.active; },
    highlight(slotId) {
      highlighted = slotId || null;
      post.setSelection(highlighted && !photo.active ? furnisher.meshesOf(highlighted) : []);
      invalidate(2);
    },
    /** Current frame as a data URL (renders synchronously so the drawing buffer is valid). */
    snapshot(type = 'image/jpeg', q = 0.92) {
      if (photo.active) photo.render(); else post.render(0.016);
      return canvas.toDataURL(type, q);
    },
    dispose,
    // debug / lab helpers (not part of the product contract)
    debug: {
      renderer, scene, camera, lighting, post, arch, furnisher, controls, materials, probes, relight,
      get fps() { return perf.fps; }, get bakeMs() { return perf.bakeMs; }, get dpr() { return dpr; }, get quality() { return Q; },
      setToneMapping(name) { if (TONE[name]) { tone = name; renderer.toneMapping = TONE[name]; applyExposure(); invalidate(); } },
      setExposure(v) { exposureOverride = v; applyExposure(); invalidate(); },
      setQuality(q) { if (QUALITY[q]) { Q = q; post.setQuality(q); dpr = maxDpr(); resize(); } },
      setAdaptive(v) { adaptive = !!v; },
      setPose(pos, target) { controls.state.pos.set(...pos); const d = new THREE.Vector3(...target).sub(new THREE.Vector3(...pos)).normalize(); controls.state.yaw = Math.atan2(d.x, d.z); controls.state.pitch = Math.asin(d.y); controls.setView && camera.position.set(...pos); camera.lookAt(...target); invalidate(); },
      invalidate,
      info() { return { ...renderer.info.render, programs: renderer.info.programs?.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
    },
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    clearTimeout(envTimer);
    unsubStore?.();
    ro?.disconnect();
    window.removeEventListener('resize', resize);
    photo.dispose();
    controls.dispose();
    interaction.dispose();
    furnisher.dispose();
    arch.dispose();
    probes.dispose();
    skyline.dispose();
    lighting.dispose();
    post.dispose();
    marker.mesh.geometry.dispose(); marker.mat.dispose();
    materials.dispose?.();
    events.clear();
    renderer.dispose();
    canvas.remove();
    if (window.villar === api) { delete window.villar; window.__villarReady = false; }
  }

  // ---------------------------------------------------------------- go
  resize();
  controls.setView(VIEWS.includes(view) ? view : 'eye', { instant: true });
  setTimeOfDay(currentTime);
  if (renderer.extensions.has('KHR_parallel_shader_compile')) {
    try { await renderer.compileAsync(scene, camera); } catch { /* compile on first frame */ }
  }
  if (disposed) return null;
  invalidate(3);
  raf = requestAnimationFrame(frame);
  // "first good frame" = real textures + room environment captured with them
  Promise.race([watchTextures(), new Promise((r) => setTimeout(r, 15000))]).then(async () => {
    if (disposed) return;
    texturesSettled = true;
    if (gi) await relight({ fresh: true, bounces: Q === 'low' ? 1 : 2 });
    else refreshEnvironment(2);
    giSettled = true;
    invalidate(3);
  });
  void clamp; void prefersReducedMotion; void TIMES; void CUT_HEIGHT;
  return api;
}

export { VIEWS, TIMES };
