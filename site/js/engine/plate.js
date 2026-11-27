// Villar engine — the window shows ONLY SKY (founder decision, 27 Nov; docs/PHOTOREAL.md "The window: plates",
// docs/ART.md §3). Owner: engine.
//
// No city, no skyline, no ground: through the glass there is sky down to the horizon and luminous haze below it.
//   skirt — always on: haze from a few degrees above the horizon down to the nadir, over the HDR sky's own ground,
//           so looking down from the high floor never shows an edge or a ground (also the fallback without a plate);
//   sky   — a sky-only plate when one is approved (`GET /api/plate?time=…` → { url, url2k, width, height, sky: true,
//           horizon: 1, hfov, sun, video } | { pending } | { error }): the image's bottom edge is the horizon, it
//           spans `hfov` round the window normal and hfov × height / width of elevation; past its sides it mirrors,
//           above its top the top row continues, below the horizon its bottom rows melt into a slightly brighter
//           haze. Both layers are at infinity (direction only: no parallax with walking, which is right for sky).
// The balcony rail and the window frame are the room's own 3D in front of it. Layers are drawn at a fixed 40 m
// view depth along their ray, so the interior always covers them. `pending` is the normal state until a plate is
// approved: the photographic HDR sky + skirt stay, and we poll gently.
import * as THREE from 'three';
import { clamp } from './util.js';

const TIMES = { morning: 'day', day: 'day', golden: 'sunset', sunset: 'sunset', evening: 'evening' };
const DEPTH = 40;            // m, view distance the layers are drawn at
// mean linear luminance a sky plate is scaled to (≈ today's calibrated sky through the window; `gain` tunes it)
const PLATE_L = { day: 0.16, sunset: 0.14, evening: 0.035 }; // lower than the plain HDR sky on purpose: clouds keep their texture
const FADE_MS = 900;
const KIND = { sky: 0, skirt: 4 };

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Sphere patch round the origin facing +Z: azimuth (0.5 − u) · hfov for u = −0.4 … 1.4 (image left = +X = left when
 * looking out), elevation v · vfov from the nadir to the zenith. uv = (u, v): v = 0 is the horizon.
 */
function skyPatch(hfov, vfov) {
  const nu = 72, nv = 48, u0 = -0.4, u1 = 1.4, v0 = -90 / vfov, v1 = 90 / vfov;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    // denser rows near the horizon
    const t = j / nv, e = (t < 0.5 ? -Math.pow(1 - 2 * t, 1.6) : Math.pow(2 * t - 1, 1.6)) * 90;
    const el = e * Math.PI / 180, v = e / vfov;
    for (let i = 0; i <= nu; i++) {
      const u = u0 + (u1 - u0) * (i / nu), az = (0.5 - u) * hfov * Math.PI / 180;
      pos.push(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      uv.push(u, clamp(v, v0, v1));
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** MeshStandard (scene rule) that is all emission: the sky plate (crossfading to a 2nd one) or the haze skirt. */
function plateMaterial(kind, U) {
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1, envMapIntensity: 0,
    transparent: true, opacity: kind === 'skirt' ? 1 : 0, depthWrite: false, fog: false, side: THREE.DoubleSide, name: `window-${kind}`,
  });
  m.defines = { PLATE_KIND: KIND[kind] };
  m.userData.plate = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPlateUv;')
      .replace('#include <project_vertex>', `
        vPlateUv = uv;
        // at infinity: direction only (the camera's translation does not move it)
        vec4 mvPosition = vec4( mat3( viewMatrix ) * normalize( mat3( modelMatrix ) * transformed ) * ${DEPTH.toFixed(1)}, 1.0 );
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vPlateUv;
        uniform sampler2D plateMap; uniform sampler2D plateMap2; uniform float plateMix; uniform float plateDrift;
        uniform vec3 plateBottom; uniform vec3 plateBottom2; uniform vec3 plateSkirt;
        uniform float plateGain; uniform float plateGain2;`)
      .replace('#include <emissivemap_fragment>', `
        {
          #if PLATE_KIND == 4
            // haze from just above the horizon down: the fallback "ground" of a sky-only window
            totalEmissiveRadiance = plateSkirt * ( 1.0 + 0.1 * smoothstep( 0.0, -0.6, vPlateUv.y ) );
            diffuseColor.a *= 1.0 - smoothstep( 0.0, 0.14, vPlateUv.y );
          #else
            float u = vPlateUv.x + plateDrift;
            u = u < 0.0 ? - u : ( u > 1.0 ? 2.0 - u : u );                          // mirrored past the sides
            vec2 puv = vec2( u, clamp( vPlateUv.y, 0.004, 0.996 ) );              // top row continues upward
            vec3 c = mix( texture2D( plateMap, puv ).rgb * plateGain, texture2D( plateMap2, puv ).rgb * plateGain2, plateMix );
            vec3 haze = mix( plateBottom * plateGain, plateBottom2 * plateGain2, plateMix );
            // below the horizon: the bottom rows melt into a slightly brighter haze (no edge, no ground)
            c = mix( c, haze * 1.08, smoothstep( 0.0, -0.3, vPlateUv.y ) );
            totalEmissiveRadiance = c;
          #endif
        }`);
  };
  m.customProgramCacheKey = () => `villar-window-${kind}`;
  return m;
}

/** Mean linear colours of the plate: whole frame, sky band, horizon band (±3°), bottom band. null if tainted. */
function plateColours(img, horizon, vfov, mask) {
  try {
    const W = 96, H = Math.max(8, Math.round(W * (img.naturalHeight || img.height) / (img.naturalWidth || img.width)));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let md = null;
    if (mask) { g.clearRect(0, 0, W, H); g.drawImage(mask, 0, 0, W, H); md = g.getImageData(0, 0, W, H).data; }
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const acc = () => ({ r: 0, g: 0, b: 0, n: 0 });
    const all = acc(), sky = acc(), hor = acc(), bot = acc();
    const hRow = horizon * H, band = (3 / vfov) * H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, r = lin(d[o]), gg = lin(d[o + 1]), b = lin(d[o + 2]);
      const add = (a) => { a.r += r; a.g += gg; a.b += b; a.n++; };
      add(all);
      const isSky = md ? md[o] > 127 : y < hRow - band;
      if (isSky && y < hRow) add(sky);
      if (Math.abs(y - hRow) <= Math.max(1, band)) add(hor);
      if (y >= H * 0.9) add(bot);
    }
    const col = (a) => (a.n ? new THREE.Color(a.r / a.n, a.g / a.n, a.b / a.n) : null);
    return { mean: col(all), sky: col(sky), horizon: col(hor), bottom: col(bot) };
  } catch { return null; } // a tainted canvas (no CORS): plate still shows, lighting keeps the HDR tint
}
const lum = (c) => (c ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 0);

function defaultFetch(url) {
  return fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : { error: `HTTP ${r.status}` }))
    .catch((e) => ({ error: e?.message || 'network' }));
}
function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous'; im.decoding = 'async';
    im.onload = () => res(im); im.onerror = () => rej(new Error('image'));
    im.src = url;
  });
}

/**
 * @param center  window centre line (x, z) — the cylinders' axis
 * @param eyeY    eye height the plate's horizon sits at
 * @param enabled false = never fetch (the procedural city stays)
 * @param source  optional (time) → Promise<plate json> (tests / stubs); default GET `${base}?time=`
 */
export function createPlate({ center, eyeY = 1.45, quality = 'high', enabled = true, source = null, base = '/api/plate', gain = 1, onChange = () => {} } = {}) {
  const group = new THREE.Group();
  group.name = 'window-sky';
  group.position.set(center.x, eyeY, center.z);
  const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); BLACK.needsUpdate = true;
  const U = {
    plateMap: { value: BLACK }, plateMap2: { value: BLACK }, plateMix: { value: 0 }, plateDrift: { value: 0 },
    plateBottom: { value: new THREE.Color() }, plateBottom2: { value: new THREE.Color() },
    plateSkirt: { value: new THREE.Color(0.5, 0.5, 0.5) },
    plateGain: { value: 1 }, plateGain2: { value: 1 },
  };
  const mats = { skirt: plateMaterial('skirt', U), sky: plateMaterial('sky', U) };
  const meshes = {};
  const mk = (kind, geo, order) => {
    const m = new THREE.Mesh(geo, mats[kind]);
    m.renderOrder = order; m.frustumCulled = false;
    m.userData.noPick = true; m.userData.noAO = true; m.userData.plate = true;
    m.castShadow = false; m.receiveShadow = false; m.name = `window-${kind}`;
    group.add(m); meshes[kind] = m;
    return m;
  };
  mk('skirt', skyPatch(100, 43), -40);
  let geomKey = '';
  function ensureGeometry(meta) {
    const hfov = clamp(+meta.hfov || 100, 40, 160);
    const vfov = hfov * (meta.height || 9) / (meta.width || 21);
    const key = `${hfov}|${vfov.toFixed(2)}`;
    if (key === geomKey) return;
    geomKey = key;
    if (meshes.sky) { meshes.sky.geometry.dispose(); group.remove(meshes.sky); }
    mk('sky', skyPatch(hfov, vfov), -30).visible = false;
  }

  const plates = new Map(); // time → { state, meta, tex, colours, gain, timer, tries }
  let want = null, shown = null, fade = 0, fadeTo = 0, mixAnim = null, disposed = false;
  let video = null, driftT = 0;

  function slot(time) { let s = plates.get(time); if (!s) { s = { state: 'idle', tries: 0 }; plates.set(time, s); } return s; }

  async function request(time) {
    const s = slot(time);
    if (!enabled || disposed || s.state === 'loading' || s.state === 'ready' || s.state === 'error') return;
    s.state = 'loading';
    const q = `${base}?time=${time}${quality === 'high' ? '' : '&w=2048'}`;
    const meta = await (source ? Promise.resolve(source(time)).catch((e) => ({ error: e?.message })) : defaultFetch(q));
    if (disposed) return;
    if (!meta || meta.error || (!meta.url && !meta.pending)) { s.state = 'error'; s.meta = meta; return; }
    if (meta.pending) {
      // not approved yet (the normal state): poll gently, backing off to 10 min
      s.state = 'pending'; s.tries++;
      const wait = clamp((+meta.retryAfter || 60) * 1000 * Math.pow(1.6, s.tries - 1), 30000, 600000);
      clearTimeout(s.timer); s.timer = setTimeout(() => { s.state = 'idle'; if (want === time || !shown) request(time); }, wait);
      return;
    }
    // only sky plates go in the window (an older plate with a skyline would put a district there)
    if (meta.sky !== true) { s.state = 'error'; s.meta = meta; return; }
    try {
      const url = quality === 'high' ? meta.url : (meta.url2k || meta.url);
      const img = await loadImage(url);
      if (disposed) return;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 8; tex.needsUpdate = true; tex.name = `sky-plate:${time}`;
      const vfov = (+meta.hfov || 100) * (meta.height || img.naturalHeight) / (meta.width || img.naturalWidth);
      const colours = plateColours(img, 1, vfov, null);
      const L = lum(colours?.mean) || 0.3;
      Object.assign(s, { state: 'ready', meta, tex, colours, gain: gain * (PLATE_L[time] ?? 0.5) / L });
      onChange({ type: 'ready', time });
      if (want === time) show(time);
    } catch {
      s.state = 'error';
    }
  }

  function bind(which, s) {
    const two = which === 2;
    U[two ? 'plateMap2' : 'plateMap'].value = s.tex;
    U[two ? 'plateGain2' : 'plateGain'].value = s.gain;
    U[two ? 'plateBottom2' : 'plateBottom'].value.copy(s.colours?.bottom || s.colours?.horizon || s.colours?.mean || new THREE.Color(0.5, 0.5, 0.5));
  }
  /** Show `time`'s sky: fade in over the HDR sky, or crossfade from the sky on screen. */
  function show(time, { ms = FADE_MS } = {}) {
    const s = plates.get(time);
    if (!s || s.state !== 'ready') return false;
    if (mixAnim && mixAnim.to === time) { fadeTo = 1; return true; } // already crossfading there
    if (shown === time && !mixAnim) { fadeTo = 1; return true; }
    ensureGeometry(s.meta);
    if (shown && shown !== time && fade > 0.01) {
      bind(2, s);
      mixAnim = { t: 0, ms: Math.max(1, ms), to: time };
    } else {
      bind(1, s); U.plateMix.value = 0;
      shown = time; mixAnim = null;
    }
    fadeTo = 1; meshes.sky.visible = true;
    syncVideo();
    onChange({ type: 'show', time });
    return true;
  }

  function syncVideo() {
    const s = shown && plates.get(shown);
    const src = s?.meta?.video;
    const allow = src && quality === 'high' && typeof document !== 'undefined' && !(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
    if (!allow) { if (video) { video.el.pause(); U.plateMap.value = video.still; video = null; } return; }
    if (video && video.src === src) return;
    const el = document.createElement('video');
    el.muted = true; el.loop = true; el.playsInline = true; el.crossOrigin = 'anonymous'; el.preload = 'auto'; el.src = src;
    const vt = new THREE.VideoTexture(el); vt.colorSpace = THREE.SRGBColorSpace;
    video = { el, src, tex: vt, still: s.tex };
    el.addEventListener('playing', () => { if (video?.el === el) { U.plateMap.value = vt; onChange({ type: 'frame' }); } }, { once: true });
    const tick = () => { if (video?.el !== el) return; onChange({ type: 'frame' }); el.requestVideoFrameCallback?.(tick); };
    el.requestVideoFrameCallback?.(tick);
    el.play().catch(() => {});
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!video) return; if (document.hidden) video.el.pause(); else video.el.play().catch(() => {}); });

  return {
    group,
    /** Time of day changed (or first call): show its sky plate if we have it, else ask for it; the HDR sky meanwhile. */
    setTimeOfDay(tod, { ms = FADE_MS } = {}) {
      const time = TIMES[tod] || 'day';
      want = time;
      const s = slot(time);
      if (s.state === 'ready') return show(time, { ms });
      if (s.state === 'idle') request(time);
      if (shown) fadeTo = 0; // no plate for this time yet: back to the HDR sky (a fade, no pop)
      return false;
    },
    /** Radiance of the haze below the horizon (linear RGB): the HDR sky's horizon haze of this time of day. */
    setHaze(color) { U.plateSkirt.value.copy(color); },
    /** Per frame. Returns true while animating (fade, crossfade). */
    step(dt) {
      let busy = false;
      if (fade !== fadeTo) {
        const k = dt * 1000 / FADE_MS;
        fade = fadeTo > fade ? Math.min(fadeTo, fade + k) : Math.max(fadeTo, fade - k);
        mats.sky.opacity = smooth(fade);
        if (fade === 0) { if (meshes.sky) meshes.sky.visible = false; shown = null; syncVideo(); }
        busy = true;
      }
      if (mixAnim) {
        mixAnim.t += dt * 1000;
        const t = clamp(mixAnim.t / mixAnim.ms, 0, 1);
        U.plateMix.value = smooth(t);
        if (t >= 1) {
          const s = plates.get(mixAnim.to);
          bind(1, s); U.plateMix.value = 0; shown = mixAnim.to; mixAnim = null; syncVideo();
        }
        busy = true;
      }
      return busy;
    },
    /** Slow cloud drift: a ping-pong of ±1 % of the plate's width over ~5 min (wrap-free). Returns true if it moved. */
    drift(dt) {
      if (!shown || fade < 1) return false;
      driftT += dt;
      U.plateDrift.value = 0.01 * Math.sin(driftT * 2 * Math.PI / 300);
      return true;
    },
    /** 0…1: how much of the window sky is the plate. */
    get coverage() { return fade >= 1 && !mixAnim ? 1 : fade; },
    get shown() { return shown; },
    get animating() { return fade !== fadeTo || !!mixAnim; },
    /** Plate colours for lighting (linear, luminance 1): { sky, horizon } of the plate, or null. */
    colours(tod) {
      const s = plates.get(TIMES[tod] || 'day');
      if (!s || s.state !== 'ready' || !s.colours) return null;
      const n = (c) => { if (!c) return null; const l = lum(c); return l > 0 ? c.clone().multiplyScalar(1 / l) : null; };
      return { sky: n(s.colours.sky || s.colours.mean), horizon: n(s.colours.horizon || s.colours.bottom) };
    },
    state(tod) { return slot(TIMES[tod] || 'day').state; },
    /** Path tracer snapshot: the raster sky layers leave (it lights with the HDR sky). */
    preparePhoto() { const v = group.visible; group.visible = false; return () => { group.visible = v; }; },
    dispose() {
      disposed = true;
      for (const s of plates.values()) { clearTimeout(s.timer); s.tex?.dispose(); }
      for (const m of Object.values(meshes)) m.geometry.dispose();
      for (const m of Object.values(mats)) m.dispose();
      if (video) { video.el.pause(); video.tex.dispose(); video = null; }
      BLACK.dispose();
    },
  };
}
