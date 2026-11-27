// Villar engine — public entry point. Owner: engine.
//
//   const villar = await createVillar({ container, store, layout, catalog, stylepack, quality: 'high' });
//   villar.on('ready'|'hover'|'select'|'progress'|'photo'|'view'|'focus'|'time'|'context'|'fatal', fn)
//   villar.setView('eye'|'living'|'bed'|'dining'|'window'|'top')
//   villar.setTimeOfDay('morning'|'day'|'golden'|'evening')
//   villar.focus(slotId, { inset: { bottom, right } }); villar.unfocus(); villar.setInsets({ bottom, right })
//   villar.thumbnail(itemId, { size: 256 }) → Promise<dataURL>
//   villar.startPhoto(); villar.stopPhoto(); villar.highlight(slotId|null); villar.dispose()
//
// Rendering is on demand: the rAF loop runs only while something changes (camera motion, fades,
// GI bake/blend, auto-exposure, photo accumulation) and stops when idle.
import * as THREE from 'three';
import { createEmitter, clamp, whiteBalanceGain, DEG } from './util.js';
import { buildArchitecture } from './architecture.js';
import { createLighting, TOD, TIMES } from './lighting.js';
import { createSkyline, SKY_PRESETS } from './sky.js';
import { createPost, QUALITY, attachSSAO } from './post.js';
import { createCameraController } from './camera.js';
import { createInteraction, ensureBVH } from './interaction.js';
import { createFurnisher } from './furnish.js';
import { createPhoto } from './photo.js';
import { createProbeVolume } from './probes.js';
import { patchReflectionChunks } from './reflections.js';
import { createFader } from './fade.js';
import { createThumbnailer } from './thumbs.js';
import { buildProxy, createFallbackMaterials } from './proxies.js';

const VIEWS = ['eye', 'living', 'bed', 'dining', 'window', 'top'];
const TONE = { neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping, 'agx-punchy': THREE.CustomToneMapping, aces: THREE.ACESFilmicToneMapping };
const BASE_EXPOSURE = { neutral: 1.0, agx: 1.18, 'agx-punchy': 1.12, aces: 0.85 };
const DEFAULT_TONE = 'neutral';
// slots hidden in the dollhouse (they hang from the ceiling or sit high on cut walls)
const CUTAWAY_HIDE = new Set(['pendant_lamp', 'wall_art', 'curtains', 'mirror']);
const NO_OBSTACLE = new Set(['rug', 'runner', 'curtains', 'wall_art', 'mirror', 'pendant_lamp', 'throw', 'tableware', 'centerpiece', 'kitchen_decor', 'nightstand_decor']);
const PHOTO_EXPOSURE = 1.25;   // path-traced vs raster: the traced Entry/Day frame averaged −0.37 EV (portal + sun disc)
const RANK = { low: 0, medium: 1, high: 2 };
const TIERS = ['low', 'medium', 'high'];
// evening: a 3300 K camera under 2700 K lamps keeps them cream (R3-01: 0.6 pushed blue ×1.8 → lavender walls)
const WB_STRENGTH = { morning: 0.85, day: 0.85, golden: 0.75, evening: 0.45 };
// green/magenta trim: the desaturated night bounce under the blue gain drifts lilac (R3-01) / sunset shade magenta (R3-11)
const WB_TINT = { morning: 1, day: 1, golden: 1.02, evening: 1.04 };

let chunksPatched = false;
function patchShadowChunk(taps) {
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

/** Device ceiling for the quality tier: phones → low, tablets / iOS / small-memory → medium. */
function deviceCap() {
  if (typeof navigator === 'undefined') return 'high';
  const ua = navigator.userAgent || '';
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const iOS = /iPhone|iPad|iPod/.test(ua) || iPadOS;
  const android = /Android/.test(ua);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) <= 540;
  const phone = /iPhone|iPod/.test(ua) || (android && /Mobile/.test(ua)) || (coarse && small);
  const mem = navigator.deviceMemory || 8;
  if (phone || mem <= 2) return 'low';
  if (iOS || android || coarse || mem <= 4) return 'medium';
  return 'high';
}

async function loadModules() {
  // the two modeler modules load in parallel (no import waterfall)
  const [m, f] = await Promise.allSettled([import('./materials.js'), import('./furniture/index.js')]);
  return {
    makeMaterials: (renderer, quality) => {
      if (m.status === 'fulfilled') { try { return m.value.createMaterials(renderer, { quality }); } catch (e) { console.debug('[villar] createMaterials failed, using fallback materials', e); } }
      else console.debug('[villar] materials.js unavailable, using fallback materials', m.reason);
      return createFallbackMaterials();
    },
    buildItem: (() => {
      if (f.status !== 'fulfilled' || typeof f.value.buildItem !== 'function') { console.debug('[villar] furniture module unavailable, using box proxies', f.reason); return buildProxy; }
      // the modeler's build cache: cheap clones sharing geometry + materials (release, never dispose)
      const B = typeof f.value.buildItemCached === 'function' ? f.value.buildItemCached : f.value.buildItem;
      return (item, ctx) => {
        try { return B(item, ctx); }
        catch (e) { console.warn(`[villar] buildItem failed for ${item.id}; using proxy`, e); return buildProxy(item, ctx); }
      };
    })(),
    releaseItem: f.status === 'fulfilled' && typeof f.value.releaseItem === 'function' && typeof f.value.buildItemCached === 'function'
      ? (g) => { if (g?.userData?.cacheKey) f.value.releaseItem(g); else g?.traverse((o) => o.geometry?.dispose()); } : null,
    prebuildItems: f.status === 'fulfilled' && typeof f.value.prebuildItems === 'function' ? f.value.prebuildItems : null,
  };
}

export async function createVillar({
  container, store, layout, catalog, stylepack, palette = null, palettes = null,
  quality = 'high', forceQuality = false, timeOfDay = 'day', view = 'eye', adaptive = true, toneMapping = DEFAULT_TONE, gi = true, autoExposure = true,
  autoFocus = true, onProgress = null, prewarm: prewarmOpt = 'auto', refine: refineOpt = 'auto',
} = {}) {
  if (!container) throw new Error('createVillar: container is required');
  layout = layout || store?.state?.layout;
  stylepack = store?.style?.() || stylepack || store?.state?.stylepack;
  // the active pack's architecture (walls, door finish …): palette block, pack block on top
  const archOf = (id) => {
    const pk = (id && store?.style?.(id)) || stylepack;
    const pal = (palettes && palettes[pk?.id]) || (pk?.id === stylepack?.id ? palette : null) || null;
    return { ...(pal?.architecture || {}), ...(pk?.architecture || {}) };
  };
  if (store?.styleId && palettes) palette = palettes[store.styleId()] || palette;
  catalog = catalog || store?.state?.catalog;
  const events = createEmitter();
  let disposed = false;
  // loading progress for the host UI (0…1), monotonic
  let loadP = 0;
  const loadProgress = (v, stage) => {
    v = Math.max(loadP, Math.min(1, v));
    if (v === loadP && stage !== 'ready') return;
    loadP = v;
    try { onProgress?.({ progress: v, stage }); } catch { /* host callback */ }
  };
  loadProgress(0.03, 'start');
  const modulesP = loadModules(); // start fetching while the renderer spins up
  const cap = deviceCap();
  let Q = QUALITY[quality] ? quality : 'high';
  if (!forceQuality && RANK[Q] > RANK[cap]) Q = cap;
  patchShadowChunk(Q === 'low' ? 5 : Q === 'medium' ? 8 : 12);

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  let tone = TONE[toneMapping] ? toneMapping : DEFAULT_TONE;
  renderer.toneMapping = TONE[tone];
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const gl = renderer.getContext();
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;-webkit-tap-highlight-color:transparent;';
  // visible focus ring for keyboard users only (QA-14); pointer focus stays ring-less
  let lastPointer = -1e9;
  canvas.addEventListener('pointerdown', () => { lastPointer = performance.now(); }, true);
  canvas.addEventListener('focus', () => {
    let kb = false;
    try { kb = canvas.matches(':focus-visible'); } catch { /* old engines */ }
    if (performance.now() - lastPointer < 800) kb = false; // focus that came from a click / tap: no ring (R2-23)
    canvas.style.outline = kb ? '2px solid #fff6e8' : 'none'; canvas.style.outlineOffset = kb ? '-4px' : '0';
  });
  canvas.addEventListener('blur', () => { canvas.style.outline = 'none'; });
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute('aria-label', '3D-вид квартиры');
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);
  let phase = 'init';
  let raf = 0;
  let contextLost = false, lostTimer = 0, restoring = false;
  let onRestored = () => {};
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (disposed) return;
    console.warn(`[villar] WebGL context lost during ${phase}`);
    contextLost = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    try { if (REFINE.phase !== 'off') cancelRefine(true); } catch { /* not built yet */ }
    try { photo?.onContextLost(); thumbs?.onContextLost(); probes?.cancel(); } catch { /* not built yet */ }
    events.emit('context', { state: 'lost' });
    clearTimeout(lostTimer);
    // not back within 5 s → the host should fall back (2D plan)
    lostTimer = setTimeout(() => { if (contextLost && !disposed) events.emit('fatal', { reason: 'context-lost' }); }, 5000);
  });
  /**
   * R3-07: three's managers of the LOST context left 'dispose' listeners on every geometry, material, texture and
   * render target they had seen; disposing such an object later (swaps, resizes, releases) made them delete
   * handles of the dead context ("object does not belong to this context"). On restore (three has already
   * re-initialised; nothing has been drawn yet) drop those listeners from everything the engine reaches; the new
   * managers add their own on first use. Listeners of our own (e.g. the modeler's regenerators) are kept.
   */
  // The old managers' listener closures are shared by every object they saw — also by objects the engine can't
  // reach (the modeler's cached prototypes, pools). Once known, a 'dispose' never calls them again (R3-07).
  const DEAD_DISPOSERS = new Set();
  function installDeadFilter() {
    const P = THREE.EventDispatcher.prototype;
    if (P.__villarDeadFilter) { P.__villarDeadFilter.add(DEAD_DISPOSERS); return; }
    const sets = new Set([DEAD_DISPOSERS]);
    const orig = P.dispatchEvent;
    P.dispatchEvent = function (event) {
      const l = event && event.type === 'dispose' && this._listeners && this._listeners.dispose;
      if (l && l.length) this._listeners.dispose = l.filter((fn) => { for (const d of sets) if (d.has(fn)) return false; return true; });
      return orig.call(this, event);
    };
    P.__villarDeadFilter = sets;
  }
  const THREE_DISPOSERS = new Set(['onGeometryDispose', 'onMaterialDispose', 'onTextureDispose', 'onRenderTargetDispose']);
  function forgetDeadContext() {
    const seen = new Set();
    const strip = (o) => {
      if (!o || seen.has(o)) return;
      seen.add(o);
      const l = o._listeners && o._listeners.dispose;
      if (l && l.length) o._listeners.dispose = l.filter((fn) => { if (THREE_DISPOSERS.has(fn.name)) { DEAD_DISPOSERS.add(fn); return false; } return true; });
    };
    installDeadFilter();
    const stripMaterial = (m) => {
      if (!m || seen.has(m)) return;
      strip(m);
      for (const k in m) { const v = m[k]; if (v && v.isTexture) strip(v); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) { const v = u && u.value; if (v && v.isTexture) strip(v); }
    };
    scene.traverse((o) => {
      if (o.geometry) strip(o.geometry);
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) stripMaterial(m);
    });
    for (const t of [scene.background, scene.environment]) if (t && t.isTexture) strip(t);
    for (const rt of [post.rt, post.composer.renderTarget1, post.composer.renderTarget2, post.holdRT]) if (rt) { strip(rt); strip(rt.texture); }
    for (const pass of post.composer.passes) {
      for (const k of Object.keys(pass)) {
        const v = pass[k];
        if (!v) continue;
        if (v.isWebGLRenderTarget) { strip(v); strip(v.texture); } else if (v.isMaterial) stripMaterial(v); else if (v.isTexture) strip(v);
      }
    }
  }
  canvas.addEventListener('webglcontextrestored', () => {
    if (disposed) return;
    console.warn('[villar] WebGL context restored — rebuilding lighting');
    contextLost = false; clearTimeout(lostTimer);
    try { forgetDeadContext(); } catch { /* best effort */ }
    try { onRestored(); } catch (e) { console.warn('[villar] restore failed', e); events.emit('fatal', { reason: 'restore-failed' }); return; }
    events.emit('context', { state: 'restored' });
  });

  const maxDpr = () => Math.min(window.devicePixelRatio || 1, QUALITY[Q].maxDpr, 2);
  let dpr = maxDpr();
  const cssSize = () => ({ w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) });
  { const { w, h } = cssSize(); renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); }

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  scene.name = 'villar';
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 9000);
  camera.name = 'eye';

  const mods = await modulesP;
  if (disposed) return null;
  const materials = mods.makeMaterials(renderer, Q);
  const buildItem = mods.buildItem;
  loadProgress(0.15, 'modules');

  const S = layout.size;
  const arch = buildArchitecture({ layout, stylepack, palette, materials });
  scene.add(arch.group);
  const skyline = createSkyline({ center: new THREE.Vector3(S.x / 2, 0, S.z) });
  scene.add(skyline.group);
  // a facade photo landed: redraw (the path tracer's snapshot is stale too)
  skyline.onTextures = () => { if (disposed) return; sceneVersion++; invalidate(2); };
  const lighting = createLighting({ renderer, scene, arch, layout, quality: Q });
  // parallax-corrected room reflections (box = apartment incl. the window wall)
  patchReflectionChunks({ min: [-0.02, -0.02, -0.02], max: [S.x + 0.02, S.ceiling + 0.02, S.z + 0.25], probe: lighting.capturePoint.toArray() });
  const post = createPost({ renderer, scene, camera, quality: Q, aoBox: new THREE.Box3(new THREE.Vector3(-0.3, -0.1, -0.3), new THREE.Vector3(S.x + 0.3, S.ceiling + 0.3, S.z + 2)) });
  // Programs are keyed on the render target's tone mapping / colour space: compile with the HDR target
  // bound, exactly as the beauty pass renders, or every pre-compiled program is the wrong variant.
  const withHDR = (fn) => { const prev = renderer.getRenderTarget(); renderer.setRenderTarget(post.rt); try { return fn(); } finally { renderer.setRenderTarget(prev); } };
  const furnisher = createFurnisher({ layout, store, materials, buildItem, releaseItem: mods.releaseItem, quality: Q, maxLampShadows: post.settings.lampShadows });
  scene.add(furnisher.root);
  furnisher.placeAll();
  furnisher.assignLampShadows();
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
    for (const o of [mesh, dot]) { o.userData = { noCapture: true, noAO: true, noPick: true }; o.castShadow = false; o.receiveShadow = false; }
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, mat: m, target: 0, pulse: 0 };
  })();

  // dollhouse contact shadow: a soft, blurred footprint under the model (no flat "floating" look)
  const groundShadow = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 256, 512);
    x.filter = 'blur(18px)'; x.fillStyle = '#fff';
    x.fillRect(40, 40, 176, 432);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
    const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, transparent: true, opacity: 0.42, alphaMap: t, depthWrite: false, name: 'dollhouse-shadow' });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(S.x * 256 / 176, S.z * 512 / 432).rotateX(-Math.PI / 2), m);
    mesh.position.set(S.x / 2, -0.305, S.z / 2);
    mesh.userData = { noCapture: true, noAO: true, noPick: true };
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
    scene.add(mesh);
    return { mesh, tex: t };
  })();

  // ---------------------------------------------------------------- GI probe volume
  const PROBE_RES = { high: [5, 3, 10], medium: [4, 3, 8], low: [4, 3, 7] };
  const probes = createProbeVolume({
    renderer, scene,
    box: new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(S.x, S.ceiling, S.z)),
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

  // ---------------------------------------------------------------- materials: SSAO + no-AO list
  function decorate(root) {
    root.traverse((o) => {
      if (!o.isMesh || o.userData.noAO) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) attachSSAO(m);
    });
  }
  function refreshNoAO() {
    const list = [];
    scene.traverse((o) => { if (o.userData.noAO && o.isMesh) list.push(o); });
    post.setNoAO(list);
  }
  decorate(arch.group); decorate(furnisher.root);
  refreshNoAO();
  const fader = createFader({ renderer, scene, camera, target: () => post.rt, decorate: attachSSAO, onShadow: () => { renderer.shadowMap.needsUpdate = true; invalidate(2); } });
  const thumbs = createThumbnailer({ renderer, materials, buildItem, releaseItem: mods.releaseItem, quality: Q, software: /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? 0x1F01))), shouldWait: () => controls.moving || fader.active || controls.isDragging() || budget.dragging });

  // ---------------------------------------------------------------- state & helpers
  let framesToRender = 3;
  let currentTime = TOD[timeOfDay] ? timeOfDay : 'day';
  let exposureOverride = null;
  let highlighted = null;
  let focusedSlot = null;
  let cutaway = false;
  let texturesSettled = false;
  let giSettled = false;
  let sceneVersion = 0;          // bumps on anything a photo snapshot must know about
  let freeView = false;          // the user moved off the last preset
  const insets = { bottom: 0, right: 0 };
  const wbGain = new THREE.Vector3(1, 1, 1);

  // ---------------------------------------------------------------- loop (on demand)
  let last = performance.now(), lastRenderAt = 0, ready = false, settledFrames = 0;
  const clock = { frames: 0 };
  let inFrame = false;
  function wake() {
    if (raf || inFrame || disposed || contextLost || restoring) return; // inside a frame the loop re-arms itself
    last = -1; // first frame after a wake: nominal dt (rAF timestamps may precede the wake call)
    raf = requestAnimationFrame(frame);
  }
  const invalidate = (n = 2) => { framesToRender = Math.max(framesToRender, n); wake(); };
  let hoverX = 0, hoverY = 0, onHoverMove = null; // set once the refinement controller exists
  canvas.addEventListener('pointermove', (e) => {
    // pointer movement is input: a refining still fades back to raster (hover highlight / price)
    if (Math.abs(e.clientX - hoverX) + Math.abs(e.clientY - hoverY) > 3) { hoverX = e.clientX; hoverY = e.clientY; onHoverMove?.(); }
    wake();
  });

  // ---------------------------------------------------------------- exposure + white balance
  // Deterministic per time of day (calibrated on the Entry view): the room never changes colour or
  // brightness because you looked elsewhere, resized the stage or a bake is running (R2-03). Only focus
  // mode meters — on the focused object's screen rect, toward its catalogue colour (incident-meter
  // logic), so a sofa reads as its swatch in the close-up (R2-15 / PT-03).
  const ae = { ev: 0, target: 0, busy: false, buf: new Float32Array(32 * 20 * 4), hbuf: post.meter.half ? new Uint16Array(32 * 20 * 4) : null, enabled: autoExposure, last: 0, lastLog: null, spot: null };
  const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const softwareGL = /swiftshader|llvmpipe|software/i.test(dbgInfo ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)) : '');
  const parallelCompile = renderer.extensions.has('KHR_parallel_shader_compile') && !softwareGL;
  const linY = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }; // sRGB hex → linear Y
  /** Screen rect (uv) of the focused object, shrunk to its core so the backdrop barely votes. */
  function spotRect() {
    const box = focusedSlot && furnisher.boxOf(focusedSlot);
    if (!box || box.isEmpty()) return null;
    const v = new THREE.Vector3();
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      const u = (v.x + 1) / 2, w = (v.y + 1) / 2;
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, w); y1 = Math.max(y1, w);
    }
    const sx = (x1 - x0) * 0.18, sy = (y1 - y0) * 0.18;
    x0 = clamp(x0 + sx, 0, 1); x1 = clamp(x1 - sx, 0, 1); y0 = clamp(y0 + sy, 0, 1); y1 = clamp(y1 - sy, 0, 1);
    // at least ~2 meter texels
    if (x1 - x0 < 2 / 32) { const c = (x0 + x1) / 2; x0 = c - 1 / 32; x1 = c + 1 / 32; }
    if (y1 - y0 < 2 / 20) { const c = (y0 + y1) / 2; y0 = c - 1 / 20; y1 = c + 1 / 20; }
    return [x0, y0, x1, y1];
  }
  function readMeter() {
    if (!post.meter.fresh || ae.busy) return;
    post.meter.fresh = false;
    ae.busy = true;
    const dst = ae.hbuf || ae.buf;
    const done = () => {
      ae.busy = false;
      if (ae.hbuf) for (let i = 0; i < ae.hbuf.length; i++) ae.buf[i] = THREE.DataUtils.fromHalfFloat(ae.hbuf[i]);
      let sl = 0, sw = 0;
      for (let i = 0; i < 32 * 20; i++) { sl += ae.buf[i * 4]; sw += ae.buf[i * 4 + 1]; }
      if (!(sw > 1e-6)) return;
      const logL = sl / sw;               // HDR is pre-exposure
      if (!Number.isFinite(logL)) return;  // never let a NaN texel reach the exposure
      ae.lastLog = logL;
      if (!ae.spot) return;
      // expose so the object's (log-average) luminance lands at ~78 % of its catalogue colour, at most +2.3 EV over
      // the room (R3-04: +1.3 alone left a shaded sofa at −40 % of its swatch; the roll-off below keeps the
      // backdrop from clipping, which is what made +2.2 look like a cut-out)…
      const base = (BASE_EXPOSURE[tone] ?? 1) * TOD[currentTime].exposure;
      const evSpot = clamp(Math.log2((0.78 * ae.spot.Y) / (base * Math.exp(logL))), -1.5, 2.3);
      // …with a highlight roll-off in the output (setShoulder) the backdrop stays photographic; if even that
      // would leave more than ~3 % of the frame clipped, give up to −0.25 EV of the object's match (≈ −15 % Y′).
      // Clipping is estimated from the meter's brightest channel per texel, through the same roll-off curve.
      let ev = evSpot;
      if (ev > 0) {
        const gmax = Math.max(wbGain.x, wbGain.y, wbGain.z);
        const roll = (m) => (m > 1.1 ? 1.1 + (m - 1.1) / (1 + (m - 1.1) / 1.3) : m);
        const frac = (e) => { const E = base * Math.pow(2, e) * gmax; let n = 0; for (let i = 0; i < 32 * 20; i++) if (roll(Math.exp(ae.buf[i * 4 + 3]) * E) > 2.3) n++; return n / 640; };
        const floor = Math.max(0, evSpot - 0.25);
        while (ev > floor && frac(ev) > 0.03) ev = Math.max(floor, ev - 0.05);
        ae.clip = +frac(ev).toFixed(3);
      }
      ae.target = ev;
      if (Math.abs(ae.target - ae.ev) > 0.03) invalidate(2);
    };
    if (!softwareGL && renderer.readRenderTargetPixelsAsync) renderer.readRenderTargetPixelsAsync(post.meter.rt, 0, 0, 32, 20, dst).then(done, () => { ae.busy = false; });
    else { try { renderer.readRenderTargetPixels(post.meter.rt, 0, 0, 32, 20, dst); done(); } catch { ae.busy = false; } }
  }
  /** Focus metering on/off (target colour from the item's catalogue colour). */
  function setSpot(slotId) {
    const item = slotId ? furnisher.info(slotId)?.item : null;
    ae.spot = slotId && ae.enabled ? { slotId, Y: clamp(linY(item?.colorHex || '#b8b0a4'), 0.04, 0.8) } : null;
    if (!ae.spot) ae.target = 0;
    post.meter.material.uniforms.useRect.value = ae.spot ? 1 : 0;
    invalidate(2);
  }
  const mqReduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function stepExposure(dt) {
    if (!Number.isFinite(ae.ev) || Math.abs(ae.ev) > 4) ae.ev = 0;
    if (!(dt > 0)) return false;
    const d = ae.target - ae.ev;
    if (Math.abs(d) < 0.03) { if (ae.ev !== ae.target) { ae.ev = ae.target; applyExposure(); } return false; }
    ae.ev += d * (1 - Math.exp(-Math.min(dt, 1) / (mqReduced?.matches || softwareGL ? 0.02 : 0.3)));
    applyExposure();
    return true;
  }
  function applyExposure() {
    const base = BASE_EXPOSURE[tone] ?? 1;
    // dollhouse: open to the sun and sky, brighter than the interior → its own exposure
    // daylight dollhouse 0.17 (R3-03: the interior exposure went up 2.3 → 3.0, the open model must not follow)
    const v = exposureOverride ?? base * TOD[currentTime].exposure * (cutaway ? (TOD[currentTime].lamps ? 0.8 : 0.17) : Math.pow(2, ae.ev));
    renderer.toneMappingExposure = Number.isFinite(v) ? v : base * TOD[currentTime].exposure;
    // dodge deep interior shadows (corridor, kitchen) by up to ~0.9 EV; off in the dollhouse and at night
    // night: a gentler dodge keeps dark wood legible (walnut ≥ 45, R3-01) without flattening the lamp pools
    const lift = cutaway ? 0 : TOD[currentTime].lamps ? 0.7 : 1.4;
    post.setLift(Math.log(0.11 / Math.max(1e-4, renderer.toneMappingExposure)), lift);
    // focus boost → highlight roll-off, in step with the boost (R3-04)
    post.setShoulder(ae.spot && !cutaway ? clamp(ae.ev / 0.4, 0, 1) : 0);
  }
  function applyWhiteBalance() {
    whiteBalanceGain(TOD[currentTime].wb, cutaway ? 0.4 : (WB_STRENGTH[currentTime] ?? 0.8), wbGain, cutaway ? 1 : (WB_TINT[currentTime] ?? 1));
    post.setWhiteBalance(wbGain);
  }

  // ---------------------------------------------------------------- dollhouse / cutaway
  // dollhouse backdrop: warm stage gradient by day, dark warm grey at night — pre-compensated for exposure,
  // white balance and tone mapping, so it lands on exactly these colours (R2-21 / D2-22)
  const BACKDROP = { day: ['#efe9e2', '#e3dcd2'], night: ['#3e3a36', '#2f2b28'] };
  const backdropTex = (() => {
    const t = new THREE.DataTexture(new Uint16Array(2 * 64 * 4), 2, 64, THREE.RGBAFormat, THREE.HalfFloatType);
    t.colorSpace = THREE.LinearSRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return t;
  })();
  const invNeutral = (v) => (v < 0.76 ? v : Math.min(8, 0.0576 / Math.max(1e-3, 1 - v) - 0.24 + 0.76));
  function updateBackdrop() {
    const [top, bot] = BACKDROP[TOD[currentTime].lamps ? 'night' : 'day'].map((h) => new THREE.Color(h));
    const ex = Math.max(1e-3, renderer.toneMappingExposure), g = wbGain, d = backdropTex.image.data, H = THREE.DataUtils.toHalfFloat;
    for (let y = 0; y < 64; y++) {
      const c = bot.clone().lerp(top, y / 63);
      let out = [c.r, c.g, c.b];
      // inverse of Neutral's toe (dark colours: offset = x − 6.25x² of the min channel) and shoulder
      const om = Math.min(...out);
      if (om < 0.04) { const x = Math.sqrt(Math.max(0, om) / 6.25); out = out.map((v) => v + (x - om)); }
      const peak = Math.max(...out), k = peak > 0.76 ? invNeutral(peak) / peak : 1;
      const lin = [out[0] * k / ex / g.x, out[1] * k / ex / g.y, out[2] * k / ex / g.z];
      for (let x = 0; x < 2; x++) { const o = (y * 2 + x) * 4; d[o] = H(lin[0]); d[o + 1] = H(lin[1]); d[o + 2] = H(lin[2]); d[o + 3] = H(1); }
    }
    backdropTex.needsUpdate = true;
  }
  const topBackdrop = backdropTex;
  const cutHidden = new Set();
  function giInterior({ ms = 0 } = {}) {
    if (cutaway) {
      const a = lighting.ambient(currentTime, { dollhouse: true });
      probes.setConstant(a.up, a.down);
      probes.setMode('constant', { ms });
    } else if (probes.hasBaked && giState.state === 'ok') probes.setMode('baked', { ms });
    else {
      // never baked for this time yet: sky + sun-bounce stand-in (not a blue, sky-only room)
      const a = lighting.ambient(currentTime);
      probes.setConstant(a.up, a.down);
      probes.setMode('constant', { ms });
    }
  }
  function applyBackdrop() {
    if (cutaway) updateBackdrop();
    skyline.group.visible = !cutaway;
    scene.background = cutaway ? topBackdrop : lighting.skyTexture;
    groundShadow.mesh.visible = cutaway;
    post.setBloom(TOD[currentTime].lamps, cutaway ? 0.1 : 0.22);
  }
  function hideForCutaway(rec) {
    if (cutaway && (CUTAWAY_HIDE.has(rec.slot.type) || rec.slot.mount === 'wall')) { rec.group.visible = false; cutHidden.add(rec.group); }
  }
  function setCutaway(on) {
    if (cutaway === on) return;
    refineInput(true);
    cutaway = on;
    arch.setCutaway(on);
    for (const g of cutHidden) g.visible = true;
    cutHidden.clear();
    for (const rec of furnisher.placed.values()) hideForCutaway(rec);
    applyExposure();
    applyWhiteBalance();
    applyBackdrop();
    giInterior();
    renderer.shadowMap.needsUpdate = true;
    sceneVersion++;
    invalidate();
  }
  /** Run fn with the full (non-cutaway) apartment, real sky and interior GI — for light captures. */
  function withFullScene(fn) {
    const was = cutaway;
    if (was) {
      arch.setCutaway(false); skyline.group.visible = true; scene.background = lighting.skyTexture; groundShadow.mesh.visible = false;
      for (const g of cutHidden) g.visible = true;
    }
    const prevTex = probes.grid.texture;
    try { return fn(); } finally {
      probes.grid.texture = prevTex;
      if (was) { arch.setCutaway(true); for (const g of cutHidden) g.visible = false; applyBackdrop(); }
    }
  }

  // ---------------------------------------------------------------- environment + GI orchestration
  function refreshEnvironment(passes = 1) {
    phase = 'env-capture';
    renderer.shadowMap.needsUpdate = true;
    withFullScene(() => lighting.captureEnvironment({ passes, hide: [marker.mesh] }));
    renderer.shadowMap.needsUpdate = true;
    sceneVersion++;
    invalidate();
  }
  const giState = { enabled: gi && probes.supported, converged: false, failed: false, inflightFresh: false, inflightLocal: false, pendingFresh: false, dirty: new Set(), timer: 0, lastProgress: -1, lastAdvance: 0, started: 0, state: 'none' };
  let relightGen = 0;
  // converged GI per (style, time of day): shown at once on a time / style change, refreshed in the
  // background only if the furniture differs from when it was baked (R2-03, tech root cause (a))
  const giCache = new Map();
  const styleKey = () => store?.styleId?.() || stylepack?.id || 'default';
  const giKey = (tod = currentTime) => `${styleKey()}|${tod}`;
  const sceneSig = () => { try { return JSON.stringify(store?.snapshot?.().selection || {}) + '|' + arch.wallColor + '|' + arch.doorFinish + '|' + (lighting.hasSky(currentTime) ? 'hdr' : 'proc'); } catch { return ''; } };
  function cacheGI() { const sh = probes.snapshot(); if (sh && !cutaway) giCache.set(giKey(), { sh, sig: sceneSig() }); }
  /** Present the cached GI for the current (style, time); returns 'fresh' | 'stale' | null. */
  function useCachedGI(ms = 400) {
    const c = giCache.get(giKey());
    if (!c || !probes.load(c.sh, { ms: cutaway ? 0 : ms })) return null;
    giState.state = 'ok'; giState.converged = true;
    if (cutaway) giInterior();
    return c.sig === sceneSig() ? 'fresh' : 'stale';
  }
  const busyScene = () => !!styleWave || fader.active || budgetBusy();
  const bakePrepare = () => {
    const hidden = [];
    const hide = (o) => { if (o.visible) { o.visible = false; hidden.push(o); } };
    hide(marker.mesh); hide(groundShadow.mesh);
    // the room env stays on during captures: an env-less variant of every material (×2 light sets) would
    // otherwise be compiled on the first bake of each time of day (R2-11); its diffuse part is skipped
    // inside the probe grid anyway, only the specular share is captured
    const env = scene.environment;
    const was = cutaway;
    if (was) {
      arch.setCutaway(false); skyline.group.visible = true; scene.background = lighting.skyTexture;
      for (const g of cutHidden) g.visible = true;
    }
    return () => {
      for (const o of hidden) o.visible = true;
      scene.environment = env;
      if (was) { arch.setCutaway(true); for (const g of cutHidden) g.visible = false; applyBackdrop(); }
    };
  };
  // two bounces on every tier: with one, surfaces lit only by the sky stay black to the probes (R2-01)
  const bounces = () => 2;
  /** Full bake from scratch (load, time of day, context restore). Never rejects. Deferred during a style wave. */
  function bakeFresh() {
    clearTimeout(giState.timer);
    if (!giState.enabled) { refreshEnvironment(1); giSettled = true; invalidate(3); return Promise.resolve(false); }
    if (busyScene() && giSettled) { giState.pendingFresh = true; return Promise.resolve(false); }
    giState.pendingFresh = false;
    const gen = ++relightGen;
    giState.inflightFresh = true; giState.inflightLocal = false; giState.dirty.clear();
    giState.started = performance.now(); giState.lastAdvance = performance.now(); giState.lastProgress = -1;
    refreshEnvironment(1);
    const t0 = performance.now();
    return probes.bake({ bounces: bounces(), fresh: true, prepare: bakePrepare }).then((ok) => {
      if (gen !== relightGen || disposed) return ok;
      giState.inflightFresh = false;
      perf.bakeMs = performance.now() - t0;
      if (ok) { giState.converged = true; giState.failed = false; giState.state = 'ok'; cacheGI(); }
      else if (!probes.hasBaked) { giState.failed = true; console.warn('[villar] rendering without baked GI'); }
      giInterior({ ms: ready ? 600 : 0 });
      refreshEnvironment(1);
      giSettled = true;
      if (giState.dirty.size) scheduleLocal();
      invalidate(3);
      return ok;
    });
  }
  /** Re-bake only the probes near what changed (swaps), one bounce on top of the converged GI. */
  function scheduleLocal(boxes = [], delay = 600) {
    if (!giState.enabled || giState.failed) { clearTimeout(giState.timer); giState.timer = setTimeout(() => { if (!disposed) refreshEnvironment(1); }, delay); return; }
    for (const b of boxes) if (b && !b.isEmpty()) for (const j of probes.near(b, 1.5)) giState.dirty.add(j);
    clearTimeout(giState.timer);
    giState.timer = setTimeout(runLocal, delay);
  }
  function runLocal() {
    if (disposed || contextLost) return;
    if (giState.inflightFresh) return;          // the fresh bake re-runs the dirty set when done
    if (giState.inflightLocal) return;          // never cancel a running pass: it re-arms when done (T9)
    if (!giState.converged) { bakeFresh(); return; }
    if (busyScene()) { giState.timer = setTimeout(runLocal, 150); return; } // wait for the wave / fades
    if (giState.pendingFresh) { bakeFresh(); return; }
    const only = [...giState.dirty];
    if (!only.length) { refreshEnvironment(1); return; }
    const gen = ++relightGen;
    giState.inflightLocal = true;
    giState.started = performance.now(); giState.lastAdvance = performance.now(); giState.lastProgress = -1;
    probes.bake({ bounces: 1, fresh: false, only, prepare: bakePrepare }).then((ok) => {
      if (gen !== relightGen || disposed) return;
      giState.inflightLocal = false;
      if (ok) { for (const j of only) giState.dirty.delete(j); giState.state = 'ok'; cacheGI(); }
      giInterior({ ms: 500 });
      refreshEnvironment(1);
      if (giState.dirty.size) { clearTimeout(giState.timer); giState.timer = setTimeout(runLocal, 60); } // merged follow-up
      invalidate(3);
    });
  }
  /** Everything changed a little (textures landed, wall colour): one incremental bounce for all. */
  function rebakeAll(delay = 300) {
    if (!giState.enabled || giState.failed) { scheduleLocal([], delay); return; }
    for (let j = 0; j < probes.count; j++) giState.dirty.add(j);
    clearTimeout(giState.timer);
    giState.timer = setTimeout(runLocal, delay);
  }
  /** After a style wave: run whatever was deferred. */
  function resumeGI() {
    if (giState.pendingFresh) bakeFresh();
    else if (giState.dirty.size) scheduleLocal([], 100);
  }
  // the modeler's procedural textures are generated time-sliced: re-capture once they land
  let texWatch = null;
  function watchTextures() {
    if (texWatch || !materials.pending || materials.pending() === 0) return texWatch || Promise.resolve();
    texWatch = materials.ready().then(() => {
      texWatch = null;
      if (disposed) return;
      if (texturesSettled) rebakeAll(30);
      sceneVersion++;
      invalidate(3);
    });
    return texWatch;
  }

  // ---------------------------------------------------------------- camera + interaction
  const archRay = new THREE.Raycaster();
  archRay.firstHitOnly = true;
  /** Line of sight from a focus viewpoint to the object (walls, partitions, built-ins). */
  const clearLine = (from, to) => {
    const d = new THREE.Vector3().subVectors(to, from);
    const len = d.length();
    archRay.set(from, d.normalize());
    archRay.far = Math.max(0.01, len - 0.25);
    return archRay.intersectObject(arch.full, true).length === 0;
  };
  const controls = createCameraController({
    camera, dom: canvas, layout, colliders: arch.colliders,
    onChange: (e) => {
      invalidate();
      if (e.mode === 'orbit') setCutaway(true);          // entering the dollhouse: cut at take-off
      else if (!e.transitioning) setCutaway(false);      // leaving it: once landed
      if (!e.transitioning) { freeView = false; events.emit('view', { view: controls.view }); }
    },
  });
  controls.setColliders(furnisher.colliders());
  controls.onFree = () => {
    if (!freeView && controls.mode === 'walk') { freeView = true; events.emit('view', { view: null }); }
  };
  controls.onEscape = () => { if (focusedSlot || controls.focused) { unfocus(); events.emit('select', null); return true; } return false; };

  const interaction = createInteraction({
    dom: canvas, camera,
    pickRoots: () => [furnisher.root, cutaway ? arch.cutGroup : arch.full],
    getSlotInfo: (id) => furnisher.info(id),
    onHover: (p) => events.emit('hover', p),
    onSelect: (p) => {
      events.emit('select', p);
      if (!autoFocus) return;
      if (p && p.slotId) focus(p.slotId);
      else if (focusedSlot) unfocus();
    },
    onFloorClick: (pt) => {
      if (focusedSlot) return; // empty-space click while focused = back (handled by onSelect(null))
      if (controls.mode !== 'walk') return;
      controls.walkTo(pt);
      marker.mesh.position.set(pt.x, 0.004, pt.z);
      marker.pulse = 1; marker.mesh.visible = true;
      invalidate();
    },
    onFloorHover: (pt) => {
      if (pt && controls.mode === 'walk' && !focusedSlot && !photo.active) {
        marker.mesh.position.set(pt.x, 0.004, pt.z);
        marker.target = 0.55; marker.mesh.visible = true;
      } else marker.target = 0;
      invalidate();
    },
  });
  controls.onClick = (e) => { if (photo.active || photo.busy || pendingPhoto) return; interaction.click(e); };
  controls.onInteract = () => { refineInput(false); if (photo.active || photo.busy || pendingPhoto) stopPhoto(); invalidate(); };

  // ---------------------------------------------------------------- focus (game-like)
  function slotFront(slotId) {
    const rec = furnisher.placed.get(slotId);
    if (!rec) return null;
    const q = new THREE.Quaternion(); rec.group.getWorldQuaternion(q);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q); f.y = 0;
    return f.lengthSq() > 1e-6 ? f.normalize() : null;
  }
  /** Frame a slot's current model (fits the free part of the stage; see camera.focusOn). */
  function frameSlot(slotId, { refit = false } = {}) {
    const box = furnisher.boxOf(slotId);
    if (!box || box.isEmpty()) return false;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const rec = furnisher.placed.get(slotId);
    // low, wide things (rugs, runners): frame a point a bit above the surface
    if (size.y < 0.08) center.y += 0.05;
    const radius = size.length() / 2;
    controls.focusOn({
      center, size: Math.max(size.x, size.y * 1.15, size.z), radius, box,
      front: rec?.slot.mount === 'ceiling' ? null : slotFront(slotId), clear: clearLine,
      occlusion: occlusionFor(slotId, box),
      preferYaw: refit ? controls.state.focus?.yaw ?? null : null,
    });
    return true;
  }
  /**
   * Fraction (0..1) of sample points on the object hidden from a viewpoint (PT3-03), by architecture (kitchen
   * run, partitions), by other furniture (a pendant shade in front of the mirror) or — for small multi-part sets
   * (decor, tableware) — by the set's own parts (the candle holder behind the bowl). Never counted: the object's
   * support and what is attached to it (throw, cushions, the table under the tableware), and anything entirely
   * below the object (a ray from a camera above cannot meet it).
   */
  const _occRay = new THREE.Ray(), _occD = new THREE.Vector3(), _occHit = new THREE.Vector3();
  const occCaster = new THREE.Raycaster();
  const SET_TYPES = new Set(['decor_set', 'tableware', 'centerpiece', 'nightstand_decor']);
  function relatedSlots(slotId) {
    const byId = new Map(layout.slots.map((q) => [q.id, q]));
    const rel = new Set([slotId]);
    for (let q = byId.get(slotId); q?.attach; q = byId.get(q.attach.slot)) rel.add(q.attach.slot); // supports
    let grew = true;
    while (grew) { grew = false; for (const q of layout.slots) if (q.attach && rel.has(q.attach.slot) && !rel.has(q.id) && isBelow(q.id, slotId)) { rel.add(q.id); grew = true; } }
    return rel;
  }
  // attached children only (not siblings on the same support): walk up from q to see if slotId is an ancestor
  function isBelow(id, slotId) {
    const byId = new Map(layout.slots.map((q) => [q.id, q]));
    for (let q = byId.get(id); q?.attach; q = byId.get(q.attach.slot)) if (q.attach.slot === slotId) return true;
    return false;
  }
  function occlusionFor(slotId, box) {
    const rel = relatedSlots(slotId);
    const others = [];
    for (const id of furnisher.placed.keys()) {
      if (rel.has(id)) continue;
      const b = furnisher.boxOf(id);
      if (!b || b.isEmpty() || b.max.y < box.min.y + 0.02) continue;
      // boxes are coarse (chairs, a pendant's cord): inset them by 12 % horizontally
      const sz = b.getSize(_occD);
      b.min.x += sz.x * 0.12; b.max.x -= sz.x * 0.12; b.min.z += sz.z * 0.12; b.max.z -= sz.z * 0.12;
      others.push(b);
    }
    const slot = layout.slots.find((q) => q.id === slotId);
    const own = furnisher.meshesOf(slotId).filter((m) => m.isMesh && m.visible !== false);
    // a "part" = the node right under the slot's group (bowl, candle holder…); its meshes don't hide each other
    // parts live under the first node that branches (sets are often wrapped in a single group)
    let root = furnisher.placed.get(slotId)?.group;
    const hasMesh = (o) => { let f = false; o.traverse((c) => { if (c.isMesh && c.userData.slotId === slotId) f = true; }); return f; };
    for (let i = 0; i < 6 && root; i++) {
      const kids = root.children.filter(hasMesh);
      if (kids.length !== 1 || kids[0].isMesh) break;
      root = kids[0];
    }
    const partOf = (m) => { let o = m; while (o.parent && o.parent !== root) o = o.parent; return o; };
    const pts = []; const owners = [];
    let parts = false;
    if (SET_TYPES.has(slot?.type) && own.length > 1) {
      const byPart = new Map();
      for (const m of own) { const k = partOf(m); if (!byPart.has(k)) byPart.set(k, new THREE.Box3()); byPart.get(k).expandByObject(m); }
      const items = [...byPart.entries()].filter(([, bb]) => !bb.isEmpty())
        .map(([k, bb]) => ({ k, bb, v: bb.getSize(new THREE.Vector3()).lengthSq() })).sort((x, y) => y.v - x.v).slice(0, 6);
      if (items.length >= 2) {
        parts = true;
        for (const it of items) { const c = it.bb.getCenter(new THREE.Vector3()); c.y = it.bb.min.y + (it.bb.max.y - it.bb.min.y) * 0.6; pts.push(c); owners.push(it.k); }
      }
    }
    if (!parts) {
      const sz = box.getSize(new THREE.Vector3());
      pts.push(box.getCenter(new THREE.Vector3())); owners.push(null);
      for (const fx of [0.2, 0.8]) for (const fz of [0.2, 0.8]) {
        pts.push(new THREE.Vector3(box.min.x + sz.x * fx, box.min.y + sz.y * 0.75, box.min.z + sz.z * fz)); owners.push(null);
      }
    }
    return (from) => {
      let hidden = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const len = _occD.subVectors(p, from).length();
        if (len < 1e-3) continue;
        _occD.divideScalar(len);
        archRay.set(from, _occD); archRay.far = Math.max(0.01, len - 0.05);
        let hit = archRay.intersectObject(arch.full, true).length > 0;
        if (!hit) {
          _occRay.set(from, _occD);
          for (const b of others) {
            if (b.containsPoint(p)) continue; // the plate under a chair's box edge is not "behind" the chair
            if (_occRay.intersectBox(b, _occHit) && _occHit.distanceTo(from) < len - 0.05) { hit = true; break; }
          }
        }
        if (!hit && parts) {
          occCaster.set(from, _occD); occCaster.far = Math.max(0.01, len - 0.01);
          hit = occCaster.intersectObjects(own, false).some((h) => partOf(h.object) !== owners[i]);
        }
        if (hit) hidden++;
      }
      return hidden / pts.length;
    };
  }
  function focus(slotId, opts = {}) {
    refineInput(true);
    if (opts.inset) {
      // insets that come with the call frame this flight (no extra re-frame)
      insets.bottom = Math.max(0, +opts.inset.bottom || 0); insets.right = Math.max(0, +opts.inset.right || 0);
      controls.setInsets(insets);
    }
    if (!furnisher.boxOf(slotId)) return false;
    if (photo.active || photo.busy || pendingPhoto) stopPhoto();
    if (cutaway) setCutaway(false);
    const same = focusedSlot === slotId && controls.focused;
    focusedSlot = slotId;
    frameSlot(slotId, { refit: same });
    highlightSlot(slotId);
    setSpot(slotId);
    queuePrebuild(slotId);
    events.emit('focus', { slotId });
    marker.target = 0;
    invalidate(2);
    return true;
  }
  /** Re-frame the focused object (insets changed, or its model was replaced). */
  let refocusTimer = 0;
  function refocus() {
    clearTimeout(refocusTimer);
    refocusTimer = setTimeout(() => { if (focusedSlot && controls.focused && !disposed) { frameSlot(focusedSlot, { refit: true }); setSpot(focusedSlot); } }, 120);
  }
  function unfocus() {
    if (!focusedSlot && !controls.focused) return false;
    refineInput(true);
    focusedSlot = null;
    controls.unfocus();
    highlightSlot(null);
    setSpot(null);
    events.emit('focus', { slotId: null });
    invalidate(2);
    return true;
  }
  function setInsets({ bottom = insets.bottom, right = insets.right } = {}) {
    const b = Math.max(0, +bottom || 0), r = Math.max(0, +right || 0);
    const changed = Math.abs(b - insets.bottom) > 2 || Math.abs(r - insets.right) > 2;
    if (changed) refineInput(false); // HUD panel animating
    insets.bottom = b; insets.right = r;
    controls.setInsets(insets);
    if (changed && focusedSlot) refocus(); // keep the object inside the free part of the stage
    invalidate(2);
  }
  let haloT0 = 0, haloK = 1;
  function highlightSlot(slotId) {
    if ((slotId || null) !== highlighted) refineInput(false);
    haloT0 = 0; haloK = 1;
    highlighted = slotId || null;
    post.setSelection(highlighted && !photo.active ? furnisher.meshesOf(highlighted) : []);
    invalidate(2);
  }

  // ---------------------------------------------------------------- photo mode
  let photoNeedsRender = false;
  let pendingPhoto = null;
  const photo = createPhoto({
    renderer, scene, camera, quality: Q,
    emit: (evt, p) => { events.emit(evt, p); photoNeedsRender = true; invalidate(1); },
    rasterRender: () => post.render(0.016),
    prepare: () => {
      // physical state for the path tracer snapshot (Фото and idle refinement alike)
      const saved = [];
      const set = (obj, key, val) => { saved.push([obj, key, obj[key]]); obj[key] = val; };
      set(marker.mesh, 'visible', false);
      set(groundShadow.mesh, 'visible', false);
      set(probes.grid, 'visible', false);
      // window portal: the sky's light enters as an area light over the window (importance-sampled, fast,
      // low-noise convergence — sampling the environment from inside a room wastes most rays on walls); the
      // photographic sky stays what camera rays see outside, and escaping indirect rays no longer sample it
      // (no double count). Dollhouse: no portal, the sky lights the open room directly. The sun is a disc of
      // its real angular size (soft, physical shadows and glints).
      set(scene, 'environment', lighting.skyTexture);
      set(scene, 'environmentIntensity', cutaway ? 1 : 0);
      set(lighting.portal, 'visible', !cutaway);
      // dollhouse: the backdrop is a screen-space gradient in raster; the tracer would read it as an equirect
      // sky — trace without a background (alpha 0) and keep the raster backdrop there
      if (cutaway) set(scene, 'background', null);
      const sunOn = lighting.sun.visible && lighting.sun.intensity > 0;
      set(lighting.sun, 'visible', false);
      set(lighting.sunDisc, 'visible', sunOn);
      const restoreArch = arch.preparePhoto();
      const restoreSky = skyline.preparePhoto();
      const restore = () => {
        restoreSky(); restoreArch();
        for (let i = saved.length - 1; i >= 0; i--) { const [o, k, v] = saved[i]; o[k] = v; }
      };
      restore.exposureScale = PHOTO_EXPOSURE;
      return restore;
    },
  });
  function startPhoto(opts = {}) {
    if (photo.active || photo.busy || pendingPhoto) return;
    refineInput(true);
    fader.flush();
    interaction.setEnabled(false);
    marker.target = 0; marker.mesh.visible = false;
    post.setSelection([]);
    const tok = {};
    pendingPhoto = tok;
    const go = () => {
      if (pendingPhoto !== tok || disposed) return;
      pendingPhoto = null;
      photo.start({ samples: opts.samples || (Q === 'high' ? 512 : 256), scale: opts.scale || 1, version: sceneVersion, whiteBalance: wbGain });
      invalidate(1);
    };
    if (materials.pending && materials.pending() > 0) {
      events.emit('photo', { state: 'preparing' });
      Promise.race([materials.ready(), new Promise((r) => setTimeout(r, 30000))]).then(go);
    } else go();
  }
  function stopPhoto() {
    const hadPending = !!pendingPhoto;
    pendingPhoto = null;
    const was = photo.stop();                 // emits 'stopped' if it was starting / running
    if (hadPending && !was) events.emit('photo', { state: 'stopped' });
    if (!hadPending && !was) return;
    interaction.setEnabled(true);
    if (highlighted) post.setSelection(furnisher.meshesOf(highlighted));
    invalidate(3);
  }

  // ---------------------------------------------------------------- idle refinement (path-traced stills)
  // When the view rests (≥ 700 ms: no input, flight, dissolve, bake, thumbnail or HUD animation; page
  // visible) the same frame is progressively path-traced and blended in over the held raster frame through
  // the raster post chain. Any input cancels it: instantly when the camera moves or the scene changes, with a
  // 150 ms fade otherwise. Desktop high tier; `?pt=force` forces it on (software GL too — the harness),
  // `?pt=off` turns it off. The tile count adapts so the page keeps ≥ 30 fps while it refines.
  const ptParam = (() => { try { return new URLSearchParams(location.search).get('pt'); } catch { return null; } })();
  const REFINE = {
    // Opt-in (`?pt=on`) until the path tracer's scene/BVH build runs off the main thread (it stalls 1–2 s after a
    // scene change); then default back to: desktop high tier, not software GL.
    on: ptParam === 'force' || (ptParam === 'on' && refineOpt !== 'off' && !softwareGL),
    phase: 'off', // off | starting | run | done | fade
    k: 0, t0: 0, fadeFrom: 0, lastInput: 0, lastActive: 0, gen: 0,
    tiles: 2, samples: 0, target: 384, frames: 0, dtAvg: 16,
    stats: { snapshotMs: 0, firstMs: 0, cleanMs: 0, sps: 0, tiles: 2, scale: 1 },
  };
  const REST_MS = 700, FADE_IN_MS = 450, FADE_OUT_MS = 150, MIN_SPP = 4, CLEAN_SPP = 48;
  /** Any input: remember it; cancel a refinement (instant = the camera / scene changes). */
  function refineInput(instant = false) {
    REFINE.lastInput = performance.now();
    if (REFINE.phase !== 'off') cancelRefine(instant);
  }
  function cancelRefine(instant = true) {
    const was = REFINE.phase;
    photo.stopRefine();
    REFINE.gen++;
    if (instant || REFINE.k <= 0.001 || !post.holding) { REFINE.phase = 'off'; REFINE.k = 0; }
    else { REFINE.phase = 'fade'; REFINE.fadeFrom = REFINE.k; REFINE.t0 = performance.now(); }
    if (was !== 'off' && was !== 'fade') events.emit('refine', { state: 'cancel', samples: Math.floor(REFINE.samples) });
    invalidate(2);
  }
  function refineAllowed(now) {
    return REFINE.on && ready && texturesSettled && !disposed && !contextLost && !restoring
      && (typeof document === 'undefined' || document.visibilityState !== 'hidden')
      && now - Math.max(REFINE.lastInput, REFINE.lastActive) >= REST_MS
      && !controls.moving && !controls.isDragging() && !fader.active && !styleWave && !probes.baking
      && !photo.active && !photo.busy && !pendingPhoto && !thumbs.busy && pendingChanges.size === 0 && !budgetBusy(now);
  }
  function startRefine() {
    const my = ++REFINE.gen;
    REFINE.phase = 'starting'; REFINE.k = 0; REFINE.samples = 0; REFINE.frames = 0; REFINE.readyAt = 0; REFINE.stats.cleanAt = 0;
    REFINE.stats.firstMs = 0; REFINE.stats.cleanMs = 0; lastRefineTex = null; REFINE.startAt = performance.now();
    const dpr = renderer.getPixelRatio();
    const scale = clamp(1.25 / Math.max(1, dpr), 0.5, 1); // ≈ CSS pixels, denoised
    REFINE.stats.scale = scale;
    // let a frame paint first: the snapshot below is synchronous (geometry merge + BVH, cached per version)
    setTimeout(() => {
      if (my !== REFINE.gen || !refineAllowed(performance.now())) { if (my === REFINE.gen) REFINE.phase = 'off'; return; }
      photo.startRefine({ version: `${sceneVersion}|${cutaway ? 1 : 0}|${currentTime}`, scale, tiles: REFINE.tiles }).then((r) => {
        if (my !== REFINE.gen) return;
        if (!r) { REFINE.phase = 'off'; return; }
        REFINE.stats.snapshotMs = Math.round(r.snapshotMs);
        REFINE.phase = 'run'; REFINE.t0 = performance.now(); REFINE.capture = true;
        events.emit('refine', { state: 'start' });
        invalidate(2);
      }).catch((e) => { console.warn('[villar] refine failed', e); if (my === REFINE.gen) { REFINE.phase = 'off'; REFINE.on = ptParam === 'force'; } });
    }, 30);
  }
  /** Per frame while refining: one tile, adaptive budget, fade; returns the post `ref` argument. */
  function stepRefine(now, dtMs) {
    if (REFINE.phase === 'fade') {
      REFINE.k = REFINE.fadeFrom * clamp(1 - (now - REFINE.t0) / FADE_OUT_MS, 0, 1);
      if (REFINE.k <= 0) { REFINE.phase = 'off'; REFINE.k = 0; return null; }
      invalidate(1);
      return { texture: lastRefineTex, k: REFINE.k, demod: lastRefineDemod };
    }
    if (REFINE.phase !== 'run' && REFINE.phase !== 'done') return null;
    if (REFINE.capture) { REFINE.capture = false; invalidate(1); return { capture: true }; }
    if (REFINE.phase === 'run') {
      // keep the page ≥ 30 fps: more tiles (less work per frame) when frames run long
      if (dtMs > 0 && dtMs < 250) REFINE.dtAvg += (dtMs - REFINE.dtAvg) * 0.2;
      if (++REFINE.frames % 8 === 0) {
        const t = REFINE.tiles;
        const nt = REFINE.dtAvg > 30 ? Math.min(6, t + 1) : REFINE.dtAvg < 18 ? Math.max(1, t - 1) : t;
        if (nt !== t) { REFINE.tiles = nt; photo.setRefineBudget({ tiles: nt }); }
        REFINE.stats.tiles = REFINE.tiles;
      }
      const r = photo.stepRefine(post.holdRT.texture);
      if (r) {
        REFINE.samples = r.samples;
        if (r.texture) { lastRefineTex = r.texture; lastRefineDemod = !!r.demod; }
        const el = now - REFINE.t0;
        const fromRest = now - REFINE.startAt; // includes the snapshot
        if (r.samples >= MIN_SPP && lastRefineTex && !REFINE.readyAt) { REFINE.readyAt = now; REFINE.stats.firstMs = Math.round(fromRest); events.emit('refine', { state: 'visible', samples: Math.floor(r.samples), ms: Math.round(el) }); }
        if (r.samples >= CLEAN_SPP && !REFINE.stats.cleanAt) { REFINE.stats.cleanAt = now; REFINE.stats.cleanMs = Math.round(fromRest); }
        if (el > 0) REFINE.stats.sps = +(r.samples / (el / 1000)).toFixed(2);
        if (Math.floor(r.samples) >= REFINE.target) { REFINE.phase = 'done'; photo.stopRefine(); events.emit('refine', { state: 'done', samples: Math.floor(r.samples), ms: Math.round(el) }); }
      }
      if (REFINE.readyAt) REFINE.k = clamp((now - REFINE.readyAt) / FADE_IN_MS, 0, 1);
      invalidate(1);
    }
    return { texture: lastRefineTex, k: REFINE.k, demod: lastRefineDemod };
  }
  let lastRefineTex = null, lastRefineDemod = false;
  onHoverMove = () => refineInput(false);
  let refineWatch = 0;
  const refineWatchOn = () => !!refineWatch;
  function refineWatchStart() {
    refineWatch = setInterval(() => {
      if (REFINE.phase === 'off' && refineAllowed(performance.now())) startRefine();
    }, 200);
  }
  if (REFINE.on) refineWatchStart();

  // ---------------------------------------------------------------- store changes (seamless swaps)
  let styleWave = null; // { t0, n } while a style switch is being staged
  const pendingChanges = new Map(); // slotId → true (batched per microtask)
  let changeFlush = null;
  function onStoreChange(e) {
    refineInput(true);
    if (photo.active || photo.busy || pendingPhoto) stopPhoto();
    const ids = Array.isArray(e.slots) && e.slots.length ? e.slots : furnisher.slotsOfType(e.slotType).map((s) => s.id);
    if (e.reason === 'budget' && !styleWave) { budgetQueue(ids); return; }
    for (const id of ids) pendingChanges.set(id, true);
    if (!changeFlush) changeFlush = Promise.resolve().then(flushChanges);
  }

  // ---------------------------------------------------------------- budget slider (docs/BUDGET.md)
  // 'plan' bursts (up to ~30/s while dragging) are coalesced per slot: a slot that is mid-dissolve keeps only
  // its latest wish and is rebuilt from the store's CURRENT selection when its dissolve ends (latest wins).
  // A host carries its attached items (decor, lamps, tableware) in the same rebuild. Up to BUDGET_MAX slots
  // dissolve at once, their starts staggered by ≤ 60 ms, nearest first. GI re-bakes (local probes) only after
  // the slider has settled: ≥ 350 ms without a plan event, not dragging, nothing pending.
  const budget = { dragging: false, lastPlan: 0, pending: new Set(), inflight: new Set(), runs: 0, timer: 0, primed: null };
  const BUDGET_SETTLE = 350, BUDGET_STAGGER = 45, BUDGET_MAX = 8, BUDGET_MS = 220;
  const slotOf = new Map(layout.slots.map((q) => [q.id, q]));
  const ancestorsOf = (id) => { const out = []; for (let q = slotOf.get(id); q?.attach; q = slotOf.get(q.attach.slot)) out.push(q.attach.slot); return out; };
  const descendantsOf = (id) => { const out = []; const walk = (h) => { for (const q of layout.slots) if (q.attach?.slot === h) { out.push(q.id); walk(q.id); } }; walk(id); return out; };
  function budgetBusy(now = performance.now()) {
    return budget.dragging || budget.runs > 0 || budget.pending.size > 0 || now - budget.lastPlan < BUDGET_SETTLE;
  }
  function onPlan(e) {
    if (!e || e.reason !== 'budget') return;
    budget.lastPlan = performance.now();
    refineInput(true);
    primeBudget();
  }
  /** First touch of the slider: the active pack's options are built off-thread so drags only clone. */
  function primeBudget() {
    const sid = store?.styleId?.() ?? 'default';
    if (budget.primed === sid || !store?.options) return;
    budget.primed = sid;
    const seen = new Set(), items = [];
    for (const q of layout.slots) for (const o of store.options(q.id) || []) {
      const it = typeof o === 'string' ? store.item?.(o) : (o?.item || o);
      if (it?.id && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
    }
    // not the ones already in the room (warmed at ready); cheapest first — the left end of the slider comes first
    const inRoom = new Set([...furnisher.placed.values()].map((r) => r.item.id));
    warmItemQueue(items.filter((it) => !inRoom.has(it.id)).sort((a, b) => (a.price || 0) - (b.price || 0)).slice(0, 60));
  }
  function budgetQueue(ids) {
    budget.lastPlan = Math.max(budget.lastPlan, performance.now());
    for (const id of ids) budget.pending.add(id);
    if (!budget.timer) budget.timer = setTimeout(pumpBudget, 0);
  }
  function pumpBudget() {
    budget.timer = 0;
    if (disposed) return;
    const busy = (id) => budget.inflight.has(id) || ancestorsOf(id).some((a) => budget.inflight.has(a)) || descendantsOf(id).some((d) => budget.inflight.has(d));
    const ready = [];
    for (const id of budget.pending) {
      if (busy(id)) continue;
      // already what the store wants (A → B → A within a burst): nothing to do
      const rec = furnisher.placed.get(id), want = store.selected(id);
      if ((rec?.item.id ?? null) === (want?.id ?? null) && !ancestorsOf(id).some((a) => budget.pending.has(a))) { budget.pending.delete(id); continue; }
      ready.push(id);
    }
    // a host's rebuild carries its attached items: start only the topmost of each family
    const readySet = new Set(ready);
    const roots = ready.filter((id) => !ancestorsOf(id).some((a) => readySet.has(a)));
    const cam = camera.position;
    const posOf = (id) => { const q = slotOf.get(id); return q?.pos ? new THREE.Vector3(...q.pos) : (furnisher.boxOf(id)?.getCenter(new THREE.Vector3()) || cam); };
    roots.sort((a, b) => posOf(a).distanceTo(cam) - posOf(b).distanceTo(cam));
    const n = Math.max(0, Math.min(roots.length, BUDGET_MAX - budget.runs));
    const step = Math.min(60, BUDGET_STAGGER);
    for (let i = 0; i < n; i++) {
      const id = roots[i];
      const fam = [id, ...descendantsOf(id)];
      for (const f of fam) { budget.pending.delete(f); budget.inflight.add(f); }
      budget.runs++;
      setTimeout(() => {
        Promise.resolve(disposed ? null : swapSlots([id], { ms: BUDGET_MS })).catch((err) => console.warn('[villar] budget swap', err)).finally(() => {
          for (const f of fam) budget.inflight.delete(f);
          budget.runs--;
          if (budget.pending.size && !budget.timer) budget.timer = setTimeout(pumpBudget, 0);
        });
      }, i * step);
    }
    // more waiting (busy families or over the cap): try again shortly
    if (budget.pending.size && !budget.timer) budget.timer = setTimeout(pumpBudget, 80);
    invalidate(2);
  }
  /** The UI holds the slider: no thumbnails, bakes or camera moves until it lets go. */
  function setDragging(on) {
    on = !!on;
    if (budget.dragging === on) return;
    budget.dragging = on;
    if (on) { refineInput(true); primeBudget(); controls.setEnabled(false); }
    else { budget.lastPlan = Math.max(budget.lastPlan, performance.now() - BUDGET_SETTLE + 120); controls.setEnabled(true); }
    invalidate(2);
  }
  async function flushChanges() {
    changeFlush = null;
    const ids = [...pendingChanges.keys()];
    pendingChanges.clear();
    if (!ids.length || disposed) return;
    const wave = styleWave;
    if (wave) {
      // stage the room: one slot (group of attached slots) per step, spread over ~1.2 s, nearest first
      const roots = ids.filter((id) => { const s = layout.slots.find((q) => q.id === id); return !s?.attach || !ids.includes(s.attach.slot); });
      const camPos = camera.position;
      const posOf = (id) => { const s = layout.slots.find((q) => q.id === id); return s?.pos ? new THREE.Vector3(...s.pos) : (furnisher.boxOf(id)?.getCenter(new THREE.Vector3()) || camPos); };
      roots.sort((a, b) => posOf(a).distanceTo(camPos) - posOf(b).distanceTo(camPos));
      const step = Math.min(110, 1000 / Math.max(1, roots.length));
      wave.started = true;
      const jobs = roots.map((id, i) => new Promise((r) => setTimeout(() => { swapSlots([id], { ms: 320 }).then(r); }, i * step)));
      await Promise.all(jobs);
      if (styleWave === wave) { styleWave = null; resumeGI(); }
      queueWarm([...furnisher.placed.values()].map((r) => r.group));
      if (ready) idle(primeBudget); // the new pack's slider ladder
      return;
    }
    await swapSlots(ids, { ms: 260 });
  }
  /** Rebuild slots with a dissolve; GI re-bakes locally afterwards and blends in. */
  async function swapSlots(ids, { ms = 260 } = {}) {
    if (disposed) return;
    const oldBoxes = ids.map((id) => furnisher.boxOf(id)).filter(Boolean);
    const { ids: all, outgoing, incoming } = furnisher.rebuildSlots(ids, { keepOld: true });
    for (const rec of incoming) { decorate(rec.group); hideForCutaway(rec); }
    furnisher.assignLampShadows();
    lighting.setLampLights(furnisher.lampLights());
    controls.setColliders(furnisher.colliders());
    refreshNoAO();
    if (highlighted && all.includes(highlighted)) post.setSelection(furnisher.meshesOf(highlighted));
    interaction.refresh();
    sceneVersion++;
    const inLights = TOD[currentTime].lamps ? incoming.flatMap((r) => r.lights) : [];
    // items aligned to a rebuilt one (coffee table ↔ sofa) glide to their new spot
    const moves = furnisher.relocate(furnisher.dependents(all));
    for (const m of moves) m.group.position.copy(m.from);
    if (moves.length) { glides.push({ t0: performance.now(), ms: Math.max(ms, 320), moves }); controls.setColliders(furnisher.colliders()); }
    invalidate(3);
    await fader.swap({ inn: incoming.map((r) => r.group), out: outgoing.map((r) => r.group), inLights, ms });
    furnisher.retire(outgoing);
    if (disposed) return;
    if (highlighted && all.includes(highlighted)) post.setSelection(furnisher.meshesOf(highlighted));
    renderer.shadowMap.needsUpdate = true;
    const newBoxes = incoming.map((r) => new THREE.Box3().setFromObject(r.group));
    scheduleLocal([...oldBoxes, ...newBoxes]);
    watchTextures();
    if (!styleWave) queueWarm(incoming.map((r) => r.group));
    // the focused slot got a new model: re-frame it (T5)
    if (focusedSlot && all.includes(focusedSlot)) refocus();
    invalidate(3);
  }
  const unsubStore = store?.on ? store.on('change', onStoreChange) : () => {};
  const unsubPlan = store?.on ? store.on('plan', onPlan) : () => {};
  // 'style' (user / AI switch) and 'restore' (undo) are staged the same way
  const unsubStyle = store?.on ? store.on('style', (e) => {
    const wave = styleWave = { t0: performance.now(), id: e?.styleId, started: false };
    applyPackArchitecture(archOf(e?.styleId), e?.styleId);
    // the target style's converged GI (if visited before) is a far better stand-in than the old room's
    useCachedGI(1200);
    // a style event without item changes (same picks) must not leave the GI deferred
    setTimeout(() => { if (styleWave === wave && !wave.started) { styleWave = null; resumeGI(); } }, 50);
  }) : () => {};
  let doorRun = null, wallRun = null;
  /** Walls (+ skirting, painted doors) blend to the pack colour; the entry door dissolves to its finish. */
  function applyPackArchitecture(A, packId = null) {
    // wall finish (paint ↔ limewash): a dissolve of the wall meshes, serialised like the door
    const finish = A.wallFinish || (packId === 'mediterranean' ? 'limewash' : 'paint');
    const curFinish = wallRun ? wallRun.finish : arch.wallFinish;
    if (finish !== curFinish) {
      if (wallRun) { fader.finishTag(wallRun); wallRun.commit(); wallRun = null; }
      const sw = finish !== arch.wallFinish ? arch.prepareWallFinish(finish, A.walls) : null;
      if (sw) {
        for (const m of sw.inn) decorate(m);
        wallRun = sw;
        fader.swap({ inn: sw.inn, out: sw.out, ms: 900, delay: 150, settle: false, tag: sw }).then(() => {
          sw.commit(); if (wallRun === sw) wallRun = null;
          refreshNoAO(); sceneVersion++; rebakeAll(150);
        });
      }
    }
    if (A.walls) animateWalls(A.walls, 1200);
    const current = doorRun ? doorRun.finish : arch.doorFinish;
    if (A.doorFinish && A.doorFinish !== current) {
      // serialise: a pending dissolve is finished and committed before the next one starts (T3)
      if (doorRun) { fader.finishTag(doorRun); doorRun.commit(); doorRun = null; }
      if (A.doorFinish === arch.doorFinish) return;
      const sw = arch.prepareDoorFinish(A.doorFinish, A.walls);
      for (const m of sw.inn) decorate(m);
      doorRun = sw;
      fader.swap({ inn: sw.inn, out: sw.out, ms: 700, delay: 250, settle: false, tag: sw }).then(() => {
        sw.commit(); if (doorRun === sw) doorRun = null;
        refreshNoAO(); sceneVersion++; scheduleLocal([new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(3.3, 1.1, 0.1), new THREE.Vector3(1.2, 2.3, 0.4))], 200);
      });
    }
  }

  const glides = [];
  function stepGlides(now) {
    if (!glides.length) return false;
    for (const g of [...glides]) {
      const t = clamp((now - g.t0) / g.ms, 0, 1), e = t * t * (3 - 2 * t);
      for (const m of g.moves) { m.group.position.lerpVectors(m.from, m.to, e); m.group.updateMatrixWorld(true); }
      if (t >= 1) { glides.splice(glides.indexOf(g), 1); renderer.shadowMap.needsUpdate = true; }
    }
    return true;
  }
  // wall colour (style packs may recommend one): smooth 1.2 s blend, then one GI bounce for all
  let wallAnim = null;
  function animateWalls(hex, ms = 1200) {
    const mats = arch.wallMaterials;
    // compensated per-material targets (what a fresh load of this pack shows), not the raw hex (R3-03)
    const to = arch.wallTargets ? arch.wallTargets(hex) : mats.map(() => new THREE.Color(hex));
    if (mats.every((m, i) => m.color.equals(to[i]))) return;
    wallAnim = { t0: performance.now(), ms, from: mats.map((m) => m.color.clone()), to, mats };
    invalidate(2);
  }
  function stepWalls(now) {
    if (!wallAnim) return false;
    const t = clamp((now - wallAnim.t0) / wallAnim.ms, 0, 1);
    const e = t * t * (3 - 2 * t);
    wallAnim.mats.forEach((m, i) => m.color.copy(wallAnim.from[i]).lerp(wallAnim.to[i], e));
    if (t >= 1) {
      const big = wallAnim.from.some((c, i) => { const d = wallAnim.to[i]; return Math.max(Math.abs(c.r - d.r), Math.abs(c.g - d.g), Math.abs(c.b - d.b)) > 0.012; });
      wallAnim = null; sceneVersion++;
      if (big) rebakeAll(100); // ΔE ≲ 3: not worth a pass (T9)
    }
    return true;
  }

  // pre-build: alternatives of the focused/selected slot are generated in idle time (cached)
  let prebuildQ = [];
  const shouldYield = () => controls.moving || busyScene() || probes.baking || photo.active;
  /** The modeler's worker builds (main thread only reassembles in ≤ 8 ms idle slices). */
  function workerPrebuild(items) {
    if (!mods.prebuildItems || !items.length) return Promise.resolve();
    try { return Promise.resolve(mods.prebuildItems(items, { materials, quality: Q }, { budget: 8, shouldYield })).catch(() => {}); }
    catch { return Promise.resolve(); }
  }
  function queuePrebuild(slotId) {
    if (!store?.options) return;
    const opts = (store.options(slotId) || []).map((o) => (typeof o === 'string' ? store.item?.(o) : (o?.item || o))).filter((it) => it && it.id);
    const sids = store.slotsFor?.(slotId) || [slotId];
    const jobs = [];
    for (const item of opts) for (const sid of sids) jobs.push({ slotId: sid, item });
    prebuildQ = jobs.concat(prebuildQ.filter((q) => !sids.includes(q.slotId))).slice(0, 24);
    workerPrebuild(opts).then(() => idle(prebuildStep)); // geometry off-thread first, then place + compile
  }
  const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(() => fn({ timeRemaining: () => 8 }), 60));
  async function prebuildStep(deadline) {
    if (disposed || contextLost || !prebuildQ.length) return;
    if (controls.moving || fader.active || probes.baking || photo.active) { idle(prebuildStep); return; }
    if (deadline?.timeRemaining && deadline.timeRemaining() < 6) { idle(prebuildStep); return; }
    const { slotId, item } = prebuildQ.shift();
    const rec = furnisher.prebuildOne(slotId, item);
    if (rec) {
      decorate(rec.group);
      rec.group.position.set(0, -50, 0); rec.group.updateMatrixWorld(true);
      await fader.warm(rec.group);
    }
    if (prebuildQ.length) idle(prebuildStep);
  }

  // ---------------------------------------------------------------- time of day
  // share of the bounce light's colour kept in the GI (see probes.setChroma): neutral shade by day,
  // some warmth kept at sunset and under the lamps
  const GI_CHROMA = { morning: 0.35, day: 0.3, golden: 0.55, evening: 0.6 };
  const GI_TO_CAMERA = { golden: true, evening: true }; // desaturate toward the camera's neutral (R3-01 / R3-11)
  // evening: no extrapolated tail and less indirect, so lamp pools read (far wall ≤ −1 EV vs next to a lamp)
  const GI_TAIL = { morning: 0.35, day: 0.35, golden: 0.35, evening: 0 };
  const GI_GAIN = { morning: 1, day: 1, golden: 1, evening: 0.6 };
  let appliedSky = null;
  function applyTimeOfDay(tod) {
    appliedSky = lighting.skyFor(tod);
    // evening / sunset: the bounce desaturates toward what the camera renders neutral (no lilac / mauve shade)
    const camWhite = GI_TO_CAMERA[tod] ? (() => { const g = whiteBalanceGain(TOD[tod].wb, WB_STRENGTH[tod] ?? 0.8, new THREE.Vector3(), WB_TINT[tod] ?? 1); return [1 / g.x, 1 / g.y, 1 / g.z]; })() : null;
    probes.setChroma(GI_CHROMA[tod] ?? 0.5, camWhite);
    probes.setTail(GI_TAIL[tod] ?? 0.35);
    probes.setGain(GI_GAIN[tod] ?? 1);
    lighting.setTimeOfDay(tod);
    const env = lighting.skyEnvFor(tod);
    // the city's aerial-perspective haze takes the photographic sky's horizon colour (same level as before)
    skyline.setTimeOfDay(tod, { ...SKY_PRESETS[tod], hazeTint: lighting.hazeTint(tod) }, env);
    arch.setSkyEnv(env);
    materials.setLampsOn?.(TOD[tod].lamps, 1);
    applyExposure();
    applyWhiteBalance();
    applyBackdrop();
  }
  let todGen = 0;
  /** A photographic sky landed after its time of day was applied with the procedural stand-in. */
  function skyLanded(tod) {
    if (disposed || tod !== currentTime || appliedSky === lighting.skyFor(tod)) return;
    applyTimeOfDay(tod);
    refreshEnvironment(1);
    if (texturesSettled) rebakeAll(300);
    invalidate(3);
  }
  /** Preload the other times' skies once the first frame is up (idle, one at a time). */
  function preloadSkies() {
    const rest = TIMES.filter((t) => t !== currentTime && !lighting.hasSky(t));
    const next = () => { const t = rest.shift(); if (t && !disposed) idle(() => lighting.loadSky(t).then(next)); };
    next();
  }
  /**
   * Time of day. With KHR_parallel_shader_compile the new light set is compiled off-thread first (the old
   * time stays on screen meanwhile; after the idle prewarm this resolves at once), so the switch itself
   * never compiles synchronously (T2). GI: cached converged result for (style, time) if any, else the
   * sun-bounce stand-in, then a bake (deferred while a style wave runs).
   */
  function setTimeOfDay(tod) {
    if (!TOD[tod]) { console.warn(`[villar] unknown time of day "${tod}"`); return; }
    refineInput(true);
    if (photo.active || photo.busy || pendingPhoto) stopPhoto();
    const my = ++todGen;
    const go = () => {
      if (my !== todGen || disposed) return;
      const changed = tod !== currentTime;
      currentTime = tod;
      applyTimeOfDay(tod);
      sceneVersion++;
      if (changed || !probes.hasBaked) {
        const cached = useCachedGI(ready ? 400 : 0);
        if (!cached) { giState.state = 'stale'; giInterior({ ms: ready ? 300 : 0 }); }
        if (!texturesSettled) refreshEnvironment(1);
        else if (cached === 'fresh') refreshEnvironment(1);
        else if (cached === 'stale') { refreshEnvironment(1); rebakeAll(300); }
        else bakeFresh();
      }
      renderer.shadowMap.needsUpdate = true;
      events.emit('time', { time: tod });
      invalidate(3);
    };
    // the photographic sky of that time: normally preloaded; otherwise wait briefly, else swap it in later
    if (!lighting.hasSky(tod)) {
      const late = lighting.loadSky(tod);
      Promise.race([late, new Promise((r) => setTimeout(r, 1200))]).then(() => { if (my === todGen) setTimeOfDay(tod); });
      late.then(() => skyLanded(tod));
      return;
    }
    const evening = !!TOD[tod].lamps;
    if (ready && parallelCompile && evening !== lighting.evening) {
      lighting.useLightSet(evening);
      let p;
      try { p = withHDR(() => renderer.compileAsync(scene, camera)); } catch { p = null; } finally { lighting.useLightSet(lighting.evening); }
      Promise.race([p || Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]).then(go, go);
    } else go();
  }

  // ---------------------------------------------------------------- sizing + adaptive DPR
  let lastSize = '';
  function resize(force = false) {
    const { w, h } = cssSize();
    const key = `${w}x${h}@${dpr}`;
    if (!force && key === lastSize) return;
    lastSize = key;
    refineInput(true);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.setSize(db.x, db.y);
    controls.resize(w, h);
    controls.setInsets(insets);
    photoNeedsRender = true;
    invalidate();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(container); else window.addEventListener('resize', () => resize());

  const perf = { frames: 0, time: 0, slowStreak: 0, fastStreak: 0, fps: 0, bakeMs: 0, worst: 0 };
  function adapt(dt) {
    if (!adaptive) return;
    perf.frames++; perf.time += dt;
    if (perf.time < 1.2) return;
    const fps = perf.frames / perf.time;
    perf.fps = fps; perf.frames = 0; perf.time = 0;
    if (fps < 40) {
      perf.slowStreak++; perf.fastStreak = 0;
      if (dpr > 1.0 + 1e-3) { dpr = Math.max(1, dpr - 0.25); resize(true); }
      else if (perf.slowStreak >= 3 && Q !== 'low') {
        Q = Q === 'high' ? 'medium' : 'low';
        post.setQuality(Q);
        photo.setQuality(Q);
        console.debug('[villar] quality →', Q, `(${fps.toFixed(0)} fps)`);
        perf.slowStreak = 0;
      }
    } else if (fps > 58) {
      perf.fastStreak++; perf.slowStreak = 0;
      if (perf.fastStreak >= 4 && dpr < maxDpr() - 1e-3) { dpr = Math.min(maxDpr(), dpr + 0.25); resize(true); perf.fastStreak = 0; }
    } else { perf.slowStreak = 0; perf.fastStreak = 0; }
  }

  // ---------------------------------------------------------------- frame
  function render(now) {
    phase = 'render';
    // spot meter in focus mode only, at rest (a few times a second; bakes don't matter)
    if (ae.spot && !cutaway && !controls.moving && now - ae.last > 250) {
      const r = spotRect();
      if (r) { post.meter.material.uniforms.rect.value.set(...r); post.meter.requested = true; ae.last = now; }
    }
    const ref = REFINE.phase === 'off' || REFINE.phase === 'starting' ? null : stepRefine(now, lastRenderAt ? now - lastRenderAt : 0);
    post.render(0.016, ref);
    if (!post.holding) readMeter();
    const dt = (now - lastRenderAt) / 1000;
    if (lastRenderAt && dt < 0.25 && !probes.baking && !ref) adapt(dt);
    lastRenderAt = now;
    clock.frames++;
  }
  function frame(now) {
    raf = 0;
    if (disposed || contextLost || restoring) return;
    inFrame = true;
    try { frameBody(now); } finally { inFrame = false; }
    if (!disposed && !contextLost && (framesToRender > 0 || keepAlive)) raf = requestAnimationFrame(frame);
  }
  let keepAlive = false;
  function frameBody(now) {
    const dt = last < 0 ? 1 / 60 : clamp((now - last) / 1000, 0, 0.25); last = now;
    renderer.info.reset();
    let busy = false;
    const moving = controls.update(dt);
    interaction.update(now, controls.isDragging() || controls.mode === 'transition');
    if (interaction.pending) busy = true;
    // floor marker fade / pulse
    if (marker.mesh.visible) {
      const want = marker.pulse > 0 ? 0.9 : marker.target;
      marker.mat.opacity += (want - marker.mat.opacity) * Math.min(1, dt * 10);
      if (marker.pulse > 0) { marker.pulse = Math.max(0, marker.pulse - dt * 1.4); const s = 1 + (1 - marker.pulse) * 0.5; marker.mesh.scale.setScalar(s); }
      else marker.mesh.scale.setScalar(1);
      if (marker.mat.opacity < 0.01 && marker.target === 0 && marker.pulse === 0) marker.mesh.visible = false;
      invalidate(1);
    }
    if (fader.step(now)) invalidate(1);
    if (stepWalls(now)) invalidate(1);
    // focus halo: a cue during the flight, gone 1.2 s after landing (R2-23)
    if (focusedSlot && highlighted && !photo.active) {
      if (controls.moving) { haloT0 = 0; if (haloK !== 1) { haloK = 1; post.setSelectionStrength(1); } }
      else {
        if (!haloT0) haloT0 = now + 1200;
        const k = clamp(1 - (now - haloT0) / 600, 0, 1);
        if (k !== haloK) { haloK = k; post.setSelectionStrength(k); invalidate(1); }
        else if (k > 0) invalidate(1);
      }
    }
    if (stepGlides(now)) invalidate(1);
    if (probes.update(now)) invalidate(1);
    if (stepExposure(dt)) invalidate(1);
    if (moving) invalidate(2);
    if (moving || fader.active || controls.isDragging()) {
      REFINE.lastActive = now;
      if (REFINE.phase !== 'off') cancelRefine(true);
    }
    if (probes.baking && !photo.active) {
      phase = 'probe-bake';
      probes.step(moving || controls.isDragging() || fader.active ? 4 : 10);
      busy = true;
      // watchdog: a bake that stops advancing (driver trouble) gives up → render without GI
      const p = probes.progress;
      if (p !== giState.lastProgress) { giState.lastProgress = p; giState.lastAdvance = now; }
      else if (!probes.reading && (now - giState.lastAdvance > 15000 || now - giState.started > 240000)) {
        console.warn('[villar] GI bake stalled — cancelled');
        probes.cancel(); giState.inflightLocal = false;
      }
    }
    if (photo.active) {
      // path tracing: one sample (tile set) per frame until converged
      if (!photo.done || photoNeedsRender) { photo.render(); photoNeedsRender = false; }
      busy = busy || !photo.done;
    } else if (framesToRender > 0) {
      framesToRender--;
      render(now);
      if (!ready && clock.frames >= 2 && giSettled && texturesSettled) {
        // first good frame: exposure metered too (or a few frames passed without a reading)
        settledFrames++;
        if (settledFrames >= 1) markReady();
      }
    } else lastRenderAt = 0;
    const ft = performance.now() - now;
    if (ready && ft > perf.worst) perf.worst = ft;
    keepAlive = !!(moving || busy || photo.busy);
  }

  // Shader prewarm (T2 / R2-11): every object the user can meet is compiled for BOTH light sets
  // (daylight / evening) and its dissolve variant, off the main thread with KHR_parallel_shader_compile:
  // the room at ready, every new style's items after its wave, swapped-in items, and the other packs'
  // default items in idle time. No user action then compiles synchronously.
  // the light set + everything else that is night-only (glowing shades, candles, the night city)
  const withLightSet = (evening, fn) => {
    const cur = lighting.evening;
    if (evening === cur) return fn();
    lighting.useLightSet(evening);
    materials.setLampsOn?.(evening, 1);
    try { return skyline.withMaterials(evening, fn); } finally { lighting.useLightSet(cur); materials.setLampsOn?.(cur, 1); }
  };
  /** Programs can be compiled ahead at all (non-KHR software GL would freeze for seconds per program). */
  const canWarm = () => parallelCompile || !softwareGL || prewarmOpt === 'force';
  async function warmObjects(objs, { fades = true } = {}) {
    if (disposed || contextLost || !objs.length) return;
    if (!parallelCompile) { if (canWarm()) await warmSync(objs, { fades }); return; }
    const ps = [];
    for (const ev of [false, true]) withLightSet(ev, () => {
      for (const o of objs) {
        ps.push(withHDR(() => renderer.compileAsync(o, camera, scene)));
        if (fades) { const d = fader.dressForWarm(o); try { ps.push(withHDR(() => renderer.compileAsync(o, camera, scene))); } finally { fader.undress(d); } }
      }
    });
    await Promise.race([Promise.all(ps).catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  }
  /**
   * No KHR_parallel_shader_compile (R3-08): the same warm-up as synchronous compiles, one object × light set ×
   * (plain | fade) per idle slice, only while nothing moves or dissolves — the compile cost lands in idle time
   * instead of on the first Evening after a style switch. Already-compiled programs cost nothing.
   */
  async function warmSync(objs, { fades = true } = {}) {
    for (const o of objs) {
      for (const ev of [false, true]) {
        for (const fade of fades ? [false, true] : [false]) {
          await new Promise((r) => idle(r));
          for (let i = 0; i < 240 && !disposed && (controls.moving || controls.isDragging() || busyScene()); i++) await new Promise((r) => setTimeout(r, 250));
          if (disposed || contextLost || photo.active || (o !== scene && !o.parent)) return;
          try {
            withLightSet(ev, () => {
              const d = fade ? fader.dressForWarm(o) : null;
              try { withHDR(() => renderer.compile(o, camera, scene)); } finally { if (d) fader.undress(d); }
            });
          } catch { /* compiles on first draw */ }
        }
      }
    }
  }
  const warmQueue = new Set();
  let warmTimer = 0;
  /** Debounced: warm these groups (both light sets + fades) when the scene is quiet. */
  function queueWarm(groups) {
    if (!canWarm()) return;
    for (const g of groups) warmQueue.add(g);
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => idle(async () => {
      if (busyScene()) { queueWarm([]); return; }
      const list = [...warmQueue].filter((g) => g.parent); warmQueue.clear();
      await warmObjects(list);
    }), 400);
  }
  async function prewarm() {
    // software GL compiles on the CPU (seconds per program): don't freeze the page after `ready`
    // ('force' = lab/QA: run it on software GL too, to count programs)
    if (disposed || photo.active || contextLost || (softwareGL && prewarmOpt !== 'force')) return;
    try {
      if (parallelCompile) {
        await warmObjects([scene], { fades: false });
        await warmObjects([...furnisher.placed.values()].map((r) => r.group));
        arch.setCutaway(true); groundShadow.mesh.visible = true;
        const p = Promise.all([false, true].map((ev) => withLightSet(ev, () => withHDR(() => renderer.compileAsync(arch.cutGroup, camera, scene)))));
        arch.setCutaway(cutaway); groundShadow.mesh.visible = cutaway;
        await p;
        post.prewarm();
      } else {
        post.prewarm();
        // no parallel compile: one object × light set (× fade) per idle slice (each slice blocks for its compile)
        await warmSync([arch.group, skyline.group], { fades: false });
        await warmSync([...furnisher.placed.values()].map((r) => r.group));
      }
    } catch (e) { console.debug('[villar] prewarm skipped', e); arch.setCutaway(cutaway); groundShadow.mesh.visible = cutaway; }
  }

  /**
   * Idle: build the other packs' default items (modeler cache) and compile their programs for both light
   * sets, one item per idle slice, only while nothing else is going on (T8).
   */
  function prebuildPacks() {
    if (disposed || Q === 'low' || !store?.styles || !parallelCompile) return;
    const active = store.styleId?.();
    const rootTypes = new Set(layout.slots.filter((q) => !q.attach).map((q) => q.type));
    const queue = [];
    for (const pk of store.styles() || []) {
      if (!pk || pk.id === active) continue;
      for (const [key, cfg] of Object.entries(pk.slots || {})) {
        const it = store.item?.(cfg.default);
        if (it && (rootTypes.has(it.type) || rootTypes.has(key)) && !queue.some((q) => q.id === it.id)) queue.push(it);
      }
    }
    warmItemQueue(queue);
  }
  /**
   * Build each item (off-thread first, then a cached clone), compile its programs for both light sets and its
   * dissolve, one item per idle slice, only while nothing else is going on (T8; budget slider ladder).
   */
  function warmItemQueue(queue) {
    if (!queue.length || !canWarm()) return;
    const step = async (deadline) => {
      if (disposed || contextLost || !queue.length) return;
      if (!step.built) { step.built = true; await workerPrebuild(queue); }
      if (controls.moving || busyScene() || probes.baking || photo.active || (deadline?.timeRemaining && deadline.timeRemaining() < 8)) { idle(step); return; }
      const item = queue.shift();
      let g = null;
      try { g = buildItem(item, { materials, quality: Q }); } catch { g = null; }
      if (g) {
        decorate(g);
        g.position.set(0, -50, 0); g.updateMatrixWorld(true);
        try { await warmObjects([g]); } finally { if (mods.releaseItem) mods.releaseItem(g); }
      }
      if (queue.length) idle(step);
    };
    idle(step);
  }

  function markReady() {
    ready = true;
    // after the room: the active pack's slider ladder (all its options), then the other packs' defaults
    idle(() => prewarm().then(() => idle(() => { primeBudget(); prebuildPacks(); })));
    loadProgress(1, 'ready');
    window.villar = api;
    window.__villarReady = true;
    // photo mode is offered on 'high' with a hardware GPU (software GL freezes for tens of seconds)
    events.emit('ready', { quality: Q, time: currentTime, view: controls.view, tier: Q, gi: giState.converged ? 'baked' : 'ambient', photo: Q === 'high' && !softwareGL, refine: REFINE.on });
  }

  // ---------------------------------------------------------------- context restore
  onRestored = () => {
    lighting.onContextRestored();
    probes.onContextRestored();
    post.onContextRestored();
    renderer.shadowMap.needsUpdate = true;
    giState.converged = false; giState.inflightFresh = false; giState.inflightLocal = false;
    applyTimeOfDay(currentTime);
    // the converged GI comes back from the CPU cache at once; nothing is captured until the modeler's
    // procedural textures are regenerated (its restore listener runs after this one), or the bake and
    // the reflection capture would see a black room (T4)
    if (!useCachedGI(0)) { giState.state = 'stale'; giInterior(); }
    texturesSettled = false;
    // Nothing is drawn until the procedural textures are back: a draw now would allocate their GPU
    // storage from the released (empty / 1×1) CPU copies, and the regenerated full-size upload would
    // then be rejected — black walls and art for the rest of the session (T4). The modeler's
    // materials.restore() runs first (fresh storage at full size, placeholders, time-sliced regen).
    restoring = true;
    let restored = null;
    try { restored = materials.restore?.(); } catch (e) { console.debug('[villar] materials.restore failed', e); }
    Promise.resolve(restored).catch(() => {}).then(() => {
      if (disposed || contextLost) return;
      Promise.race([watchTextures(), new Promise((r) => setTimeout(r, 30000))]).then(() => {
        if (disposed || contextLost) return;
        restoring = false;
        texturesSettled = true;
        renderer.shadowMap.needsUpdate = true;
        const cached = giCache.get(giKey());
        if (cached && cached.sig === sceneSig()) refreshEnvironment(1); else bakeFresh();
        sceneVersion++;
        invalidate(3);
        events.emit('context', { state: 'ready' });
      });
    });
  };

  // ---------------------------------------------------------------- public API
  const api = {};
  Object.defineProperties(api, Object.getOwnPropertyDescriptors({
    on: (evt, fn) => events.on(evt, fn),
    off: (evt, fn) => events.off(evt, fn),
    get ready() { return ready; },
    get quality() { return Q; },
    setView(name, opts) {
      if (!VIEWS.includes(name) && !(layout.views || {})[name]) { console.warn(`[villar] unknown view "${name}"`); return; }
      if (photo.active || photo.busy || pendingPhoto) stopPhoto();
      if (focusedSlot) { focusedSlot = null; highlightSlot(null); setSpot(null); events.emit('focus', { slotId: null }); }
      controls.setView(name, opts);
      invalidate(2);
    },
    get view() { return freeView ? null : controls.view; },
    setTimeOfDay,
    get timeOfDay() { return currentTime; },
    startPhoto, stopPhoto,
    get photoActive() { return photo.active; },
    highlight(slotId) { highlightSlot(slotId); },
    focus, unfocus, setInsets,
    /** Budget slider held (true) / released (false): defers thumbnails, bakes and camera input meanwhile. */
    setDragging,
    /** Accessible name of the canvas (follows the UI language, PT-05). */
    setLabel(text) { if (text) canvas.setAttribute('aria-label', String(text)); },
    get focused() { return focusedSlot; },
    /** Neutral-studio render of a catalog item, cached. */
    thumbnail(itemId, { size = 256 } = {}) {
      const item = typeof itemId === 'object' ? itemId : (store?.item?.(itemId) || (catalog?.items || catalog || []).find?.((i) => i.id === itemId));
      if (!item) return Promise.reject(new Error(`unknown item ${itemId}`));
      if (contextLost || restoring) return Promise.reject(new Error('WebGL context is being restored'));
      return thumbs.thumbnail(item, { size }).finally(() => invalidate(1));
    },
    /** Build a slot's alternatives in idle time (the UI calls this when the item sheet opens). */
    prebuild(slotId) { queuePrebuild(slotId); },
    /** Current frame as a data URL (renders synchronously so the drawing buffer is valid). */
    snapshot(type = 'image/jpeg', q = 0.92) {
      if (photo.active) photo.render(); else post.render(0.016);
      return canvas.toDataURL(type, q);
    },
    dispose,
    // debug / lab helpers (not part of the product contract)
    debug: {
      renderer, scene, camera, lighting, post, arch, furnisher, controls, materials, probes, fader, thumbs,
      relight: () => bakeFresh(), rebakeAll, refreshEnvironment, applyPackArchitecture,
      get fps() { return perf.fps; }, get bakeMs() { return perf.bakeMs; }, get dpr() { return dpr; }, get quality() { return Q; },
      get worstFrame() { return perf.worst; }, resetWorst() { perf.worst = 0; },
      get gi() { return { ...giState, dirty: giState.dirty.size, mode: probes.mode, hasBaked: probes.hasBaked, baking: probes.baking }; },
      get running() { return !!raf; },
      /** idle refinement state: phase, blend, samples, adaptive tiles, timings (ms) and samples/s */
      get refine() { return { on: REFINE.on, phase: REFINE.phase, k: +REFINE.k.toFixed(3), samples: +REFINE.samples.toFixed(2), tiles: REFINE.tiles, ...REFINE.stats }; },
      setRefine(on) { REFINE.on = !!on; if (!on && REFINE.phase !== 'off') cancelRefine(true); if (on && !refineWatchOn()) refineWatchStart(); },
      photo,
      setToneMapping(name) { if (TONE[name]) { tone = name; renderer.toneMapping = TONE[name]; applyExposure(); invalidate(); } },
      get toneMapping() { return tone; },
      setExposure(v) { exposureOverride = v; applyExposure(); invalidate(); },
      setWhiteBalance(K, strength = 1) { whiteBalanceGain(K, strength, wbGain); post.setWhiteBalance(wbGain); invalidate(); },
      get whiteBalance() { return { gain: wbGain.toArray().map((v) => +v.toFixed(3)) }; },
      setQuality(q) { if (QUALITY[q]) { Q = q; post.setQuality(q); photo.setQuality(q); dpr = maxDpr(); resize(true); } },
      setAdaptive(v) { adaptive = !!v; },
      setAutoExposure(v) { ae.enabled = !!v; ae.target = 0; applyExposure(); invalidate(); },
      setAO(v) { post.setAO(v); invalidate(); },
      get meter() { return { log: ae.lastLog, ev: ae.ev, target: ae.target, clip: ae.clip ?? null }; },
      setPose(pos, target) {
        const st = controls.state;
        st.transition = null; st.focus = null; st.mode = 'walk';
        st.pos.set(...pos);
        const d = new THREE.Vector3(...target).sub(new THREE.Vector3(...pos)).normalize();
        st.yaw = Math.atan2(d.x, d.z); st.pitch = Math.asin(d.y);
        controls.resize(cssSize().w, cssSize().h);
        setCutaway(false);
        invalidate();
      },
      invalidate,
      info() { return { ...renderer.info.render, programs: renderer.info.programs?.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
    },
  }));

  let progTimer = 0;
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(progTimer);
    clearTimeout(giState.timer); clearTimeout(lostTimer);
    pendingPhoto = null;
    unsubStore?.(); unsubStyle?.(); unsubPlan?.(); clearTimeout(budget.timer);
    ro?.disconnect();
    photo.dispose();
    fader.dispose();
    thumbs.dispose();
    controls.dispose();
    interaction.dispose();
    furnisher.dispose();
    arch.dispose();
    probes.dispose();
    skyline.dispose();
    lighting.dispose();
    post.dispose();
    marker.mesh.geometry.dispose(); marker.mat.dispose();
    groundShadow.mesh.geometry.dispose(); groundShadow.mesh.material.dispose(); groundShadow.tex.dispose();
    materials.dispose?.();
    events.clear();
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* already lost */ }
    canvas.remove();
    clearInterval(refineWatch);
    if (window.villar === api) { delete window.villar; window.__villarReady = false; }
  }

  // ---------------------------------------------------------------- go
  // photographic sky for the first time of day (local file, ~0.6 MB) before anything is lit or baked
  await Promise.race([lighting.loadSky(currentTime), new Promise((r) => setTimeout(r, 4000))]);
  if (disposed) return null;
  lighting.loadSky(currentTime).then(() => skyLanded(currentTime));
  resize(true);
  controls.setView(VIEWS.includes(view) ? view : 'eye', { instant: true });
  if (controls.view === 'top' || controls.mode === 'orbit') setCutaway(true);
  applyTimeOfDay(currentTime);
  giInterior();
  phase = 'compile';
  if (renderer.extensions.has('KHR_parallel_shader_compile')) {
    try { await withHDR(() => renderer.compileAsync(scene, camera)); } catch { /* compile on first frame */ }
  }
  if (disposed) return null;
  refreshEnvironment(1);
  invalidate(3);
  loadProgress(0.3, 'scene');
  // loading bar: textures 0.3→0.65, GI bake 0.65→0.97
  let maxPending = 1;
  progTimer = setInterval(() => {
    if (disposed || ready) { clearInterval(progTimer); return; }
    const pend = materials.pending ? materials.pending() : 0;
    maxPending = Math.max(maxPending, pend);
    if (!texturesSettled) loadProgress(0.3 + 0.35 * (1 - pend / maxPending), 'textures');
    else if (probes.baking) loadProgress(0.65 + 0.32 * probes.progress, 'lighting');
  }, 200);
  // "first good frame" = real textures (hard cap 30 s) + GI baked (or given up) + env captured
  Promise.race([watchTextures(), new Promise((r) => setTimeout(r, 30000))]).then(() => {
    if (disposed) return;
    texturesSettled = true;
    bakeFresh();
    invalidate(3);
    preloadSkies();
  });
  void DEG; void TIERS;
  return api;
}

export { VIEWS, TIMES };
