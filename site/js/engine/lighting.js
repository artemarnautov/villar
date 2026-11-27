// Villar engine — lighting rig + time of day. Owner: engine.
//
//  • Sun: DirectionalLight with a shadow camera fitted tightly (in light space) to the apartment,
//    physically sensible altitude/azimuth per time of day; enters through the window wall (+Z).
//  • Sky: a photographic HDR per time of day (CC0 HDRI prepared offline, sky.js) — background, sky
//    reflections and the path tracer's environment; the procedural sky stands in until it has loaded.
//  • Path tracer sun: a distant circular area light subtending the real sun (0.53°) — soft, physically
//    sized shadows and specular glints; its irradiance equals the raster DirectionalLight's.
//  • Interior indirect light comes from the baked probe volume (probes.js). Until it is baked the
//    grid carries a constant ambient SH (`ambient(tod)`), so there are no "fallback" fill lights.
//  • Exactly two light sets exist: daylight (sun + GI) and evening (downlights, LED strip, lamp
//    lights; sun off). Within a set the count never changes (lamp slots carry normalised lights), so
//    swaps never recompile; the other set's programs are pre-compiled in the background (index.js).
//    Keeping all ~25 evening lights alive by day would multiply daytime shading cost for nothing.
//  • Evening: sun at 0, blue-hour sky + city lights, recessed downlights (2700 K spots), lamp lights
//    from furniture userData.lights, glowing shades, under-cabinet LED strip.
//  • The room is captured into a cube map (box-projected in materials, see reflections.js) used only
//    for reflections (the probe-grid patch disables its diffuse inside the apartment).
import * as THREE from 'three';
import { DEG, kelvin, clamp } from './util.js';
import { SKY_PRESETS, SKY_HDR, makeSkyTexture, loadSkyTexture } from './sky.js';

export const TIMES = ['morning', 'day', 'golden', 'evening'];

// alt/az in degrees; az measured from the window normal (+Z) towards +X. `wb` = camera white balance (K).
// Sun:sky irradiance ≈ 4–6 : 1 (hazy clear sky); exposure = calibrated base for the reference eye view.
export const TOD = {
  morning: { sun: { alt: 17, az: 40, K: 4700, I: 8.5 }, exposure: 3.0, wb: 5300, lamps: false },
  day:     { sun: { alt: 41, az: -24, K: 5500, I: 10.5 }, exposure: 3.0, wb: 6000, lamps: false },
  golden:  { sun: { alt: 9, az: -47, K: 3500, I: 6.3 }, exposure: 2.9, wb: 4600, lamps: false }, // I 7.0 → 6.3: sun patches keep their saturation (R3-11)
  evening: { sun: { alt: -5, az: -60, K: 3000, I: 0 }, exposure: 1.5, wb: 3300, lamps: true },
};

const WARM = kelvin(2700);
export const DOWNLIGHT_CD = 6.0;
export const STRIP_NITS = 9;

export function createLighting({ renderer, scene, arch, layout, quality = 'high' }) {
  const S = layout.size;
  const X = S.x, Z = S.z;
  const center = new THREE.Vector3(X / 2, 0, Z / 2);
  const rig = new THREE.Group(); rig.name = 'lighting';
  scene.add(rig);

  // ---------------------------------------------------------------- sun (always present)
  const sun = new THREE.DirectionalLight(0xffffff, 8);
  sun.name = 'sun';
  sun.castShadow = true;
  const mapSize = quality === 'high' ? 4096 : quality === 'medium' ? 2048 : 1024;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.00018;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = quality === 'low' ? 1.5 : 3.0;
  sun.target.position.copy(center);
  rig.add(sun, sun.target);

  // photo-mode sky portal (only visible while the path tracer snapshots the scene)
  const win = arch.window;
  const portal = new THREE.RectAreaLight(0xffffff, 1, win.x1 - win.x0 - 0.1, win.y1 - win.y0 - 0.06);
  portal.name = 'sky-portal';
  portal.position.set((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, win.z + 0.125); // outside the glass, inside the reveal
  portal.lookAt(portal.position.x, portal.position.y, 0);
  portal.visibleToCameraRays = false;
  portal.visible = false;
  rig.add(portal);
  // path-tracer sun: disc of the sun's angular size at SUN_D, facing the apartment (never drawn by raster)
  const SUN_D = 40, SUN_ANG = 0.53 * DEG;
  const sunDiam = 2 * SUN_D * Math.tan(SUN_ANG / 2);
  const sunDisc = new THREE.RectAreaLight(0xffffff, 0, sunDiam, sunDiam);
  sunDisc.isCircular = true;
  sunDisc.name = 'sun-disc';
  sunDisc.visibleToCameraRays = false;
  sunDisc.visible = false;
  rig.add(sunDisc);
  /** Radiance that gives the disc the DirectionalLight's irradiance: E = L · A / d². */
  function placeSunDisc(dir, I) {
    sunDisc.position.copy(center).setY(1.4).addScaledVector(dir, SUN_D);
    sunDisc.lookAt(center.x, 1.4, center.z);
    sunDisc.color.copy(sun.color);
    sunDisc.intensity = I > 0 ? (I * SUN_D * SUN_D) / ((Math.PI / 4) * sunDiam * sunDiam) : 0;
    sunDisc.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- evening lights (always present)
  const downlights = [];
  for (const p of arch.downlights) {
    // 48° with a 0.9 penumbra: soft-edged pools on the walls (38° / 0.65 drew hard discs; real flats at night, eng-6)
    const s = new THREE.SpotLight(WARM, 0, 0, 48 * DEG, 0.9, 2);
    s.position.copy(p);
    s.target.position.set(p.x, 0, p.z);
    s.castShadow = false;
    s.radius = 0.03; // path tracer soft source
    s.name = 'downlight';
    rig.add(s, s.target);
    downlights.push(s);
  }
  // under-cabinet LED strip: a row of wide, soft down spots (no RectAreaLight → no 300 KB LTC table)
  const strip = [];
  if (arch.underCabinet) {
    const u = arch.underCabinet;
    const n = 3, cd = (STRIP_NITS * 0.03 * u.len) / n;
    for (let i = 0; i < n; i++) {
      const z = u.z - u.len / 2 + (u.len * (i + 0.5)) / n;
      const s = new THREE.SpotLight(kelvin(3000), 0, 0, 80 * DEG, 1, 2);
      s.position.set(u.x, u.y - 0.005, z);
      s.target.position.set(u.x + 0.25, 0, z);
      s.castShadow = false; s.radius = 0.02; s.name = 'led-strip';
      s.userData.cd = cd;
      rig.add(s, s.target);
      strip.push(s);
    }
  }

  // ---------------------------------------------------------------- environment (room capture)
  let pmrem = new THREE.PMREMGenerator(renderer);
  // room reflections: 256² on high so mirror-like objects (kettle, glossy tops) don't show blocks (R2-14)
  let cubeRT = new THREE.WebGLCubeRenderTarget(quality === 'low' ? 64 : quality === 'medium' ? 128 : 256, { type: THREE.HalfFloatType, generateMipmaps: false });
  let cubeCam = new THREE.CubeCamera(0.05, 8000, cubeRT);
  const CAPTURE = new THREE.Vector3(X / 2, 1.35, Z * 0.6);
  cubeCam.position.copy(CAPTURE);
  let envRT = null;
  const skyCache = new Map();
  const skyPMREM = new Map();
  let skyTex = null;
  let current = 'day';
  let lampLights = [];

  function sunDirection(cfg) {
    const a = cfg.sun.alt * DEG, z = cfg.sun.az * DEG;
    return new THREE.Vector3(Math.sin(z) * Math.cos(a), Math.sin(a), Math.cos(z) * Math.cos(a)).normalize();
  }
  const hdrSky = new Map();   // tod → photographic sky texture (once loaded)
  const hdrTint = new Map();  // tod → colour of the sky light through the window (luminance 1)
  const plateTint = new Map(); // tod → the window plate's sky/horizon colour (luminance 1): wins over the HDR's
  const hdrHaze = new Map();  // tod → colour of the horizon haze band (luminance 1)
  /** Mean colour of the horizon band (0.5–3° elevation, all azimuths): the haze the city fades into. */
  function hazeTint(t) {
    const { data, width: W, height: H } = t.image;
    const fh = THREE.DataUtils.fromHalfFloat;
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < H; j++) {
      const lat = (((j + 0.5) / H) - 0.5) * 180;
      if (lat < 0.5 || lat > 3) continue;
      for (let i = 0; i < W; i += 2) { const o = (j * W + i) * 4; r += fh(data[o]); g += fh(data[o + 1]); b += fh(data[o + 2]); }
    }
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return L > 0 ? new THREE.Color(r / L, g / L, b / L) : null;
  }
  /** Cosine-weighted mean colour of the sky seen through the window (+Z), 0–45° elevation. */
  function windowTint(t) {
    const { data, width: W, height: H } = t.image;
    const fh = THREE.DataUtils.fromHalfFloat;
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < H; j += 2) {
      const lat = ((j + 0.5) / H - 0.5) * Math.PI;
      if (lat < 0 || lat > 0.8) continue;
      const cl = Math.cos(lat);
      for (let i = 0; i < W; i += 4) {
        const z = Math.sin(((i + 0.5) / W - 0.5) * 2 * Math.PI) * cl;
        if (z <= 0) continue;
        const w = z * cl, o = (j * W + i) * 4;
        r += fh(data[o]) * w; g += fh(data[o + 1]) * w; b += fh(data[o + 2]) * w;
      }
    }
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return L > 0 ? new THREE.Color(r / L, g / L, b / L) : null;
  }
  const hdrLoads = new Map(); // tod → Promise
  function skyFor(tod) {
    if (hdrSky.has(tod)) return hdrSky.get(tod);
    if (!skyCache.has(tod)) skyCache.set(tod, makeSkyTexture(SKY_PRESETS[tod], sunDirection(TOD[tod])));
    return skyCache.get(tod);
  }
  /**
   * Load the photographic sky of a time of day. Resolves true when it replaced the sky currently in
   * use (the caller refreshes reflections / GI), false otherwise; never rejects (procedural stays).
   */
  function loadSky(tod) {
    if (!SKY_HDR[tod]) return Promise.resolve(false);
    if (!hdrLoads.has(tod)) {
      hdrLoads.set(tod, loadSkyTexture(SKY_HDR[tod]).then((t) => {
        if (disposed) { t.dispose(); return null; }
        t.name = 'villar-sky-' + tod;
        hdrSky.set(tod, t);
        try { const c = windowTint(t); if (c) hdrTint.set(tod, c); const h = hazeTint(t); if (h) hdrHaze.set(tod, h); } catch { /* preset colour */ }
        const old = skyPMREM.get(tod); if (old) { old.dispose(); skyPMREM.delete(tod); }
        return t;
      }).catch((e) => { console.warn('[villar] sky', tod, e?.message || e); return null; }));
    }
    return hdrLoads.get(tod).then((t) => {
      if (!t || current !== tod || skyTex === t) return false;
      skyTex = t;
      return true;
    });
  }
  let disposed = false;
  /** PMREM of the sky alone (exterior objects reflect the sky, never the room). */
  function skyEnvFor(tod) {
    if (!skyPMREM.has(tod)) skyPMREM.set(tod, pmrem.fromEquirectangular(skyFor(tod)));
    return skyPMREM.get(tod).texture;
  }

  /** Fit the sun's orthographic shadow camera to the apartment (+ balcony) in light space. */
  function fitShadow(dir) {
    const pts = [];
    for (const x of [-0.2, X + 0.2]) for (const y of [-0.3, S.ceiling + 0.3]) for (const z of [-0.2, Z + 1.8]) pts.push(new THREE.Vector3(x, y, z));
    sun.position.copy(center).addScaledVector(dir, 40);
    sun.target.position.copy(center);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(sun.position, sun.target.position, new THREE.Vector3(0, 1, 0));
    view.setPosition(sun.position);
    const inv = view.clone().invert();
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) { p.applyMatrix4(inv); min.min(p); max.max(p); }
    const cam = sun.shadow.camera;
    cam.left = min.x - 0.05; cam.right = max.x + 0.05; cam.bottom = min.y - 0.05; cam.top = max.y + 0.05;
    cam.near = Math.max(0.1, -max.z - 1); cam.far = -min.z + 1;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }

  function setLampLights(list) { lampLights = list; applyLamps(); }
  /**
   * Time-lapse (ART §3): the sun between two times of day, t = 0…1 (direction, intensity, colour, shadow fit).
   * Only while the sun's light set is on; the end state equals setTimeOfDay(to).
   */
  function sunBlend(from, to, t) {
    const A = TOD[from].sun, B = TOD[to].sun;
    const IA = TOD[from].lamps ? 0 : A.I, IB = TOD[to].lamps ? 0 : B.I;
    let dz = B.az - A.az; dz = ((dz + 540) % 360) - 180;
    const cfg = { sun: { alt: A.alt + (B.alt - A.alt) * t, az: A.az + dz * t } };
    const dir = sunDirection(cfg);
    const I = (IA + (IB - IA) * t) * (dir.y > 0 ? 1 : 0);
    sun.color.copy(kelvin(A.K + (B.K - A.K) * t));
    sun.intensity = I;
    if (I > 0) fitShadow(dir);
    placeSunDisc(dir, I);
  }
  function applyLamps(on = TOD[current].lamps) {
    for (const l of lampLights) { l.visible = on; l.intensity = on ? (l.userData.baseIntensity ?? 1) : 0; }
  }
  /** Switch the light SET only (visibility) — used to pre-compile the other set's shader variants. */
  function useLightSet(evening) {
    for (const s of downlights) s.visible = evening;
    for (const s of strip) s.visible = evening;
    sun.visible = !evening;
    applyLamps(evening);
  }

  /**
   * Approximate ambient radiance (up/down) — the stand-in before a time of day has ever been baked, and the
   * dollhouse fill. Interior: a little sky + the sun's floor bounce (warm, from below), fitted to the baked
   * mean (day probe c0 luminance ≈ 0.5), so a stand-in never reads as a blue, sky-only room.
   */
  function ambient(tod = current, { dollhouse = false } = {}) {
    const P = SKY_PRESETS[tod], cfg = TOD[tod];
    const sky = new THREE.Color(P.horizon).lerp(new THREE.Color(P.zenith), 0.5);
    const Ls = (P.horizonL * 0.6 + P.zenithL * 0.4) * (dollhouse ? (cfg.lamps ? 0.5 : 1.0) : 0.17);
    const alt = Math.pow(Math.max(0, Math.sin(cfg.sun.alt * DEG)), 0.35); // low sun reaches deep into the room
    const sunC = kelvin(cfg.sun.K), floorTint = [1.0, 0.86, 0.7];
    const B = dollhouse ? 0 : cfg.sun.I * alt * 0.025;           // sun → floor/walls → room
    const lamps = cfg.lamps ? (dollhouse ? 0.02 : 0.03) : 0;
    const lampC = [1.0, 0.62, 0.32];
    const up = [0, 1, 2].map((i) => [sky.r, sky.g, sky.b][i] * Ls + [sunC.r, sunC.g, sunC.b][i] * floorTint[i] * B * 0.55 + lampC[i] * lamps);
    const down = [0, 1, 2].map((i) => [sky.r, sky.g, sky.b][i] * Ls * (dollhouse ? 0.35 : 0.5) + [sunC.r, sunC.g, sunC.b][i] * floorTint[i] * B + lampC[i] * lamps * 0.7);
    return { up, down };
  }

  function setTimeOfDay(tod) {
    if (!TOD[tod]) tod = 'day';
    current = tod;
    const cfg = TOD[tod];
    const dir = sunDirection(cfg);
    const sunUp = cfg.sun.I > 0 && dir.y > 0;
    sun.color.copy(kelvin(cfg.sun.K));
    sun.intensity = sunUp ? cfg.sun.I : 0;
    sun.visible = !cfg.lamps;
    if (sunUp) fitShadow(dir);
    placeSunDisc(dir, sunUp ? cfg.sun.I : 0);
    skyTex = skyFor(tod);
    const P = SKY_PRESETS[tod];
    // portal radiance ≈ mean sky radiance seen through a vertical window; sky-blue weighted
    portal.color.set(P.horizon).lerp(new THREE.Color(P.zenith), 0.55);
    portal.intensity = (P.horizonL * 0.7 + P.zenithL * 0.3) * 0.92;
    // photographic sky: its own colour through the window, same luminance calibration
    const tint = plateTint.get(tod) || (hdrSky.has(tod) && hdrTint.get(tod));
    if (tint) { const l = 0.2126 * portal.color.r + 0.7152 * portal.color.g + 0.0722 * portal.color.b; portal.color.copy(tint).multiplyScalar(l); }
    const lamps = cfg.lamps;
    for (const s of downlights) { s.intensity = lamps ? DOWNLIGHT_CD : 0; s.visible = lamps; }
    for (const s of strip) { s.intensity = lamps ? s.userData.cd : 0; s.visible = lamps; }
    arch.downlightMaterial.emissiveIntensity = lamps ? 7 : 0;
    arch.ledMaterial.emissiveIntensity = lamps ? 5 : 0;
    applyLamps();
    return { exposure: cfg.exposure, wb: cfg.wb };
  }

  /** Capture the room into a cube map and use its PMREM as scene.environment (reflections). */
  function captureEnvironment({ hide = [], passes = 1 } = {}) {
    const prevBg = scene.background;
    const hidden = [];
    for (const o of hide) if (o.visible) { o.visible = false; hidden.push(o); }
    scene.traverse((o) => { if (o.userData.noCapture && o.visible) { o.visible = false; hidden.push(o); } });
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      for (let i = 0; i < passes; i++) {
        cubeCam.update(renderer, scene);
        const next = pmrem.fromCubemap(cubeRT.texture);
        if (envRT) envRT.dispose();
        envRT = next;
        scene.environment = envRT.texture;
      }
    } finally {
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      for (const o of hidden) o.visible = true;
      scene.background = prevBg;
    }
  }

  return {
    rig, sun, downlights, strip, portal, sunDisc,
    loadSky, hasSky: (tod) => hdrSky.has(tod),
    /** Horizon haze colour of the photographic sky (luminance 1), or null while the procedural one is used. */
    hazeTint: (tod) => (hdrSky.has(tod) && hdrHaze.get(tod)) || null,
    capturePoint: CAPTURE,
    get time() { return current; },
    get skyTexture() { return skyTex; },
    skyFor, skyEnvFor,
    sunDirection: () => sunDirection(TOD[current]),
    setTimeOfDay, setLampLights, captureEnvironment, ambient, useLightSet, sunBlend,
    get lampLights() { return lampLights; },
    /** Window plate colours (plate.js colours()): the portal fill takes them; null = back to the HDR / preset. */
    setPlateTint(tod, c) {
      if (c && (c.sky || c.horizon)) {
        const t = (c.sky || c.horizon).clone().lerp(c.horizon || c.sky, 0.45);
        const l = 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b;
        if (l > 0) { plateTint.set(tod, t.multiplyScalar(1 / l)); return; }
      }
      plateTint.delete(tod);
    },
    get evening() { return !!TOD[current].lamps; },
    // kept for API compatibility: there are no fallback fill lights any more
    setFallback() {}, setDollhouse() {}, get fallback() { return false; },
    fakeLights: [],
    /** After a WebGL context restore: old GL objects are gone — recreate, don't dispose. */
    onContextRestored() {
      pmrem = new THREE.PMREMGenerator(renderer);
      cubeRT = new THREE.WebGLCubeRenderTarget(cubeRT.width, { type: THREE.HalfFloatType, generateMipmaps: false });
      cubeCam = new THREE.CubeCamera(0.05, 8000, cubeRT); cubeCam.position.copy(CAPTURE);
      envRT = null; scene.environment = null;
      for (const t of skyCache.values()) t.needsUpdate = true;
      for (const t of hdrSky.values()) t.needsUpdate = true;
      skyPMREM.clear();
    },
    dispose() {
      disposed = true;
      for (const t of hdrSky.values()) t.dispose();
      for (const t of skyCache.values()) t.dispose();
      for (const rt of skyPMREM.values()) rt.dispose();
      skyCache.clear(); skyPMREM.clear();
      if (envRT) envRT.dispose();
      cubeRT.dispose(); pmrem.dispose();
      sun.shadow.map?.dispose();
      scene.remove(rig);
    },
  };
}

export { clamp };
