// Villar engine — lighting rig + time of day. Owner: engine.
//
//  • Sun: DirectionalLight with a shadow camera fitted tightly (in light space) to the apartment,
//    physically sensible altitude/azimuth per time of day; enters through the window wall (+Z).
//  • Sky: procedural HDR equirect (background; also the path tracer's environment).
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
import { SKY_PRESETS, makeSkyTexture } from './sky.js';

export const TIMES = ['morning', 'day', 'golden', 'evening'];

// alt/az in degrees; az measured from the window normal (+Z) towards +X. `wb` = camera white balance (K).
// Sun:sky irradiance ≈ 4–6 : 1 (hazy clear sky); exposure = calibrated base for the reference eye view.
export const TOD = {
  morning: { sun: { alt: 17, az: 40, K: 4700, I: 8.5 }, exposure: 3.0, wb: 5300, lamps: false },
  day:     { sun: { alt: 41, az: -24, K: 5500, I: 10.5 }, exposure: 3.0, wb: 6000, lamps: false },
  golden:  { sun: { alt: 9, az: -47, K: 3500, I: 7.0 }, exposure: 2.9, wb: 4600, lamps: false },
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

  // ---------------------------------------------------------------- evening lights (always present)
  const downlights = [];
  for (const p of arch.downlights) {
    const s = new THREE.SpotLight(WARM, 0, 0, 38 * DEG, 0.65, 2);
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
  function skyFor(tod) {
    if (!skyCache.has(tod)) skyCache.set(tod, makeSkyTexture(SKY_PRESETS[tod], sunDirection(TOD[tod])));
    return skyCache.get(tod);
  }
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
    skyTex = skyFor(tod);
    const P = SKY_PRESETS[tod];
    // portal radiance ≈ mean sky radiance seen through a vertical window; sky-blue weighted
    portal.color.set(P.horizon).lerp(new THREE.Color(P.zenith), 0.55);
    portal.intensity = (P.horizonL * 0.7 + P.zenithL * 0.3) * 0.92;
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
    rig, sun, downlights, strip, portal,
    capturePoint: CAPTURE,
    get time() { return current; },
    get skyTexture() { return skyTex; },
    skyFor, skyEnvFor,
    sunDirection: () => sunDirection(TOD[current]),
    setTimeOfDay, setLampLights, captureEnvironment, ambient, useLightSet,
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
      skyPMREM.clear();
    },
    dispose() {
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
