// Villar engine — photographic window plates (docs/PHOTOREAL.md "The window: plates", docs/ART.md §3). Owner: engine.
//
// One real photo per time of day (Dubai Marina, 40th floor, 21:9, ~100° wide) replaces the procedural city in the
// window, in depth planes:
//   sky   — the whole plate at infinity (moves with the camera: no parallax), top edge fading into the HDR sky;
//   city  — the plate with the sky mask cut out, on a cylinder R ≈ 900 m round the window (≈ 0.2° parallax);
//   near  — optional second mask (near towers) on R ≈ 250 m (≈ 0.7°);
//   without a mask: the plate alone on R ≈ 1500 m.
// The balcony rail and the window frame are the room's own 3D in front of it. Atmospheric haze grows with the
// layer's distance; past the plate's sides the image mirrors (no streaks), below its bottom it fades into the
// mean colour of the bottom band (the view down past the balcony slab).
//
// Every layer is drawn at a fixed 40 m view depth along its true ray (vertex shader): the interior (< 15 m) always
// covers it, it always covers the procedural skyline (> 100 m) during the crossfade, and the layers never fight.
// `GET /api/plate?time=…` → { url, url2k, width, height, horizon, hfov, sun, mask?, video } | { pending } | { error }.
// `pending` is the normal state until a plate is approved: the procedural city stays, and we poll gently.
import * as THREE from 'three';
import { clamp } from './util.js';

const TIMES = { morning: 'day', day: 'day', golden: 'sunset', sunset: 'sunset', evening: 'evening' };
const DEPTH = 40;            // m, view distance every layer is drawn at
const R = { city: 900, near: 250, single: 1500 };
const HAZE = { sky: 0, city: 0.06, near: 0.015, single: 0.05 };
// mean linear luminance the plate is scaled to (the window reads like today's calibrated sky; harness-tuned)
const PLATE_L = { day: 0.3, sunset: 0.22, evening: 0.035 };
const FADE_MS = 900;

const smooth = (t) => t * t * (3 - 2 * t);

/** Cylinder segment round (0,0,0) facing +Z, spanning the plate ±30 % beyond its sides and 35 % below. */
function arcGeometry(radius, hfov, vfov, horizon) {
  const nu = 96, nv = 28, u0 = -0.3, u1 = 1.3, v0 = -0.35, v1 = 1.0;
  const Hs = 2 * radius * Math.tan((vfov / 2) * Math.PI / 180); // height of the image (uv straight, as specified)
  const vh = 1 - horizon;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    const v = v0 + (v1 - v0) * (j / nv);
    for (let i = 0; i <= nu; i++) {
      const u = u0 + (u1 - u0) * (i / nu);
      const th = (0.5 - u) * hfov * Math.PI / 180; // u = 0 (image left) = +X = left when looking out along +Z
      pos.push(radius * Math.sin(th), (v - vh) * Hs, radius * Math.cos(th));
      uv.push(u, v);
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

/** MeshStandard (scene rule) that is all emission: the plate, its mask, haze, bottom fade, crossfade to a 2nd plate. */
function plateMaterial(kind, U) {
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1, envMapIntensity: 0,
    transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide, name: `window-plate-${kind}`,
  });
  m.defines = { PLATE_KIND: { sky: 0, city: 1, near: 2, single: 3 }[kind] };
  m.userData.plate = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { plateHazeK: { value: HAZE[kind] } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPlateUv;\nuniform vec3 plateOrigin;')
      .replace('#include <project_vertex>', `
        vPlateUv = uv;
        #if PLATE_KIND == 0
          // at infinity: direction only (the camera's translation does not move it)
          vec3 plateDir = normalize( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz - plateOrigin );
          vec4 mvPosition = vec4( mat3( viewMatrix ) * plateDir * ${DEPTH.toFixed(1)}, 1.0 );
        #else
          vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
          mvPosition.xyz = normalize( mvPosition.xyz ) * ${DEPTH.toFixed(1)};
        #endif
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vPlateUv;
        uniform sampler2D plateMap; uniform sampler2D plateMap2; uniform float plateMix;
        uniform sampler2D plateMask; uniform sampler2D plateMask2; uniform float plateHasMask;
        uniform sampler2D plateNear; uniform float plateHasNear;
        uniform vec3 plateBottom; uniform vec3 plateBottom2; uniform vec3 plateHaze; uniform vec3 plateHaze2;
        uniform float plateGain; uniform float plateGain2; uniform float plateHazeK;
        vec2 plateUv( vec2 uv ) {
          float u = uv.x < 0.0 ? - uv.x : ( uv.x > 1.0 ? 2.0 - uv.x : uv.x ); // mirrored past the sides
          return vec2( u, clamp( uv.y, 0.002, 0.998 ) );
        }`)
      .replace('#include <emissivemap_fragment>', `
        {
          vec2 puv = plateUv( vPlateUv );
          vec3 c1 = texture2D( plateMap, puv ).rgb * plateGain;
          vec3 c2 = texture2D( plateMap2, puv ).rgb * plateGain2;
          vec3 bottom = mix( plateBottom * plateGain, plateBottom2 * plateGain2, plateMix );
          vec3 haze = mix( plateHaze * plateGain, plateHaze2 * plateGain2, plateMix );
          vec3 c = mix( c1, c2, plateMix );
          c = mix( c, bottom, smoothstep( 0.0, -0.22, vPlateUv.y ) );         // below the plate: the bottom band
          c = mix( c, haze, plateHazeK );                                       // aerial perspective by depth plane
          float a = 1.0 - smoothstep( 0.9, 1.0, vPlateUv.y );                   // top edge: into the HDR sky
          #if PLATE_KIND == 1
            float sky = mix( texture2D( plateMask, puv ).r, texture2D( plateMask2, puv ).r, plateMix );
            a *= 1.0 - sky * step( 0.5, plateHasMask );
          #elif PLATE_KIND == 2
            a *= texture2D( plateNear, puv ).r * step( 0.5, plateHasNear );
          #endif
          totalEmissiveRadiance = c;
          diffuseColor.a *= a;
        }`);
  };
  m.customProgramCacheKey = () => `villar-plate-${kind}`;
  return m;
}

/** Feathered (≈ 2 px) single-channel mask texture from an image; white = sky. */
function maskTexture(img) {
  const c = document.createElement('canvas');
  c.width = Math.min(2048, img.naturalWidth || img.width); c.height = Math.round(c.width * (img.naturalHeight || img.height) / (img.naturalWidth || img.width));
  const g = c.getContext('2d');
  g.filter = `blur(${Math.max(0.6, c.width / 2048).toFixed(2)}px)`;
  g.drawImage(img, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
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
export function createPlate({ center, eyeY = 1.45, quality = 'high', enabled = true, source = null, base = '/api/plate', onChange = () => {} } = {}) {
  const group = new THREE.Group();
  group.name = 'window-plate';
  group.visible = false;
  group.position.set(center.x, 0, center.z);
  const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WHITE.needsUpdate = true;
  const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); BLACK.needsUpdate = true;
  const U = {
    plateMap: { value: BLACK }, plateMap2: { value: BLACK }, plateMix: { value: 0 },
    plateMask: { value: BLACK }, plateMask2: { value: BLACK }, plateHasMask: { value: 0 },
    plateNear: { value: BLACK }, plateHasNear: { value: 0 },
    plateBottom: { value: new THREE.Color() }, plateBottom2: { value: new THREE.Color() },
    plateHaze: { value: new THREE.Color() }, plateHaze2: { value: new THREE.Color() },
    plateGain: { value: 1 }, plateGain2: { value: 1 },
    plateOrigin: { value: new THREE.Vector3(center.x, eyeY, center.z) },
  };
  const mats = { sky: plateMaterial('sky', U), city: plateMaterial('city', U), near: plateMaterial('near', U), single: plateMaterial('single', U) };
  const meshes = {};
  let geomKey = '';
  function ensureGeometry(meta) {
    const hfov = clamp(+meta.hfov || 100, 40, 160);
    const vfov = hfov * (meta.height || 9) / (meta.width || 21);
    const horizon = clamp(+meta.horizon || 0.5, 0.2, 0.8);
    const key = `${hfov}|${vfov.toFixed(2)}|${horizon}`;
    if (key === geomKey) return;
    geomKey = key;
    for (const m of Object.values(meshes)) { m.geometry.dispose(); group.remove(m); }
    const mk = (kind, radius, order) => {
      const m = new THREE.Mesh(arcGeometry(radius, hfov, vfov, horizon), mats[kind]);
      m.position.y = eyeY; m.renderOrder = order; m.frustumCulled = false;
      m.userData.noPick = true; m.userData.noAO = true; m.userData.plate = true;
      m.castShadow = false; m.receiveShadow = false; m.name = `plate-${kind}`;
      group.add(m); meshes[kind] = m;
    };
    mk('sky', R.single, -30); mk('city', R.city, -20); mk('near', R.near, -10); mk('single', R.single, -30);
  }

  const plates = new Map(); // time → { state, meta, tex, mask, near, colours, gain, timer, tries }
  let want = null, shown = null, fade = 0, fadeTo = 0, mixAnim = null, disposed = false;
  let video = null;

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
    try {
      const url = quality === 'high' ? meta.url : (meta.url2k || meta.url);
      const [img, maskImg] = await Promise.all([loadImage(url), meta.mask ? loadImage(meta.mask).catch(() => null) : null]);
      if (disposed) return;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 8; tex.needsUpdate = true; tex.name = `plate:${time}`;
      const vfov = (+meta.hfov || 100) * (meta.height || img.naturalHeight) / (meta.width || img.naturalWidth);
      const colours = plateColours(img, clamp(+meta.horizon || 0.5, 0.2, 0.8), vfov, maskImg);
      const L = lum(colours?.mean) || 0.2;
      s.gain = (PLATE_L[time] ?? 0.5) / L;
      Object.assign(s, { state: 'ready', meta, tex, mask: maskImg ? maskTexture(maskImg) : null, colours });
      onChange({ type: 'ready', time });
      if (want === time) show(time);
    } catch {
      s.state = 'error';
    }
  }

  function bind(which, s) {
    const two = which === 2;
    U[two ? 'plateMap2' : 'plateMap'].value = s.tex;
    U[two ? 'plateMask2' : 'plateMask'].value = s.mask || BLACK;
    U[two ? 'plateGain2' : 'plateGain'].value = s.gain;
    U[two ? 'plateBottom2' : 'plateBottom'].value.copy(s.colours?.bottom || s.colours?.mean || new THREE.Color(0.2, 0.2, 0.2));
    U[two ? 'plateHaze2' : 'plateHaze'].value.copy(s.colours?.horizon || s.colours?.mean || new THREE.Color(0.5, 0.5, 0.5));
  }
  function layout(s) {
    ensureGeometry(s.meta);
    const masked = !!s.mask;
    U.plateHasMask.value = masked ? 1 : 0;
    U.plateHasNear.value = 0;
    meshes.sky.visible = masked; meshes.city.visible = masked; meshes.near.visible = false; meshes.single.visible = !masked;
  }
  /** Show `time`'s plate: fade in over the city, or crossfade from the plate on screen. */
  function show(time, { ms = FADE_MS } = {}) {
    const s = plates.get(time);
    if (!s || s.state !== 'ready') return false;
    if (mixAnim && mixAnim.to === time) { fadeTo = 1; return true; } // already crossfading there
    if (shown === time && !mixAnim) { fadeTo = 1; group.visible = true; return true; }
    if (shown && shown !== time && fade > 0.01) {
      bind(2, s);
      mixAnim = { t: 0, ms: Math.max(1, ms), to: time };
    } else {
      bind(1, s); U.plateMix.value = 0; layout(s);
      shown = time; mixAnim = null;
    }
    fadeTo = 1; group.visible = true;
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
    /** Time of day changed (or first call): show its plate if we have it, else ask for it; keep the city meanwhile. */
    setTimeOfDay(tod, { ms = FADE_MS } = {}) {
      const time = TIMES[tod] || 'day';
      want = time;
      const s = slot(time);
      if (s.state === 'ready') return show(time, { ms });
      if (s.state === 'idle') request(time);
      // no plate for this time yet: back to the procedural city (no pop — fade)
      if (shown) fadeTo = 0;
      return false;
    },
    /** Per frame. Returns true while animating (fade, crossfade). */
    step(dt) {
      let busy = false;
      if (fade !== fadeTo) {
        const k = dt * 1000 / FADE_MS;
        fade = fadeTo > fade ? Math.min(fadeTo, fade + k) : Math.max(fadeTo, fade - k);
        const e = smooth(fade);
        for (const m of Object.values(mats)) m.opacity = e;
        if (fade === 0) { group.visible = false; shown = null; syncVideo(); }
        busy = true;
      }
      if (mixAnim) {
        mixAnim.t += dt * 1000;
        const t = clamp(mixAnim.t / mixAnim.ms, 0, 1);
        U.plateMix.value = smooth(t);
        if (t >= 1) {
          const s = plates.get(mixAnim.to);
          bind(1, s); U.plateMix.value = 0; layout(s); shown = mixAnim.to; mixAnim = null; syncVideo();
        }
        busy = true;
      }
      return busy;
    },
    /** 0…1: how much of the window the plate covers (the engine hides the procedural city at 1). */
    get coverage() { return fade >= 1 && !mixAnim ? 1 : fade; },
    get shown() { return shown; },
    get animating() { return fade !== fadeTo || !!mixAnim; },
    /** Plate colours for lighting (linear, luminance 1): { sky, horizon } of the plate on screen, or null. */
    colours(tod) {
      const s = plates.get(TIMES[tod] || 'day');
      if (!s || s.state !== 'ready' || !s.colours) return null;
      const n = (c) => { if (!c) return null; const l = lum(c); return l > 0 ? c.clone().multiplyScalar(1 / l) : null; };
      return { sky: n(s.colours.sky), horizon: n(s.colours.horizon) };
    },
    state(tod) { return slot(TIMES[tod] || 'day').state; },
    /** Path tracer snapshot: the plate leaves (it keeps the HDR sky and the procedural city). */
    preparePhoto() { const v = group.visible; group.visible = false; return () => { group.visible = v; }; },
    dispose() {
      disposed = true;
      for (const s of plates.values()) { clearTimeout(s.timer); s.tex?.dispose(); s.mask?.dispose(); }
      for (const m of Object.values(meshes)) m.geometry.dispose();
      for (const m of Object.values(mats)) m.dispose();
      if (video) { video.el.pause(); video.tex.dispose(); video = null; }
      WHITE.dispose(); BLACK.dispose();
    },
  };
}
