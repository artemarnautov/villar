// Villar engine — lighting rig + time of day. Owner: engine.
//
//  • Sun: DirectionalLight with a shadow camera fitted tightly (in light space) to the apartment,
//    physically sensible altitude/azimuth per time of day; enters through the window wall (+Z).
//  • Sky: procedural HDR equirect (background; also the path tracer's environment).
//  • Interior "GI" for raster: window fill (RectAreaLight at the glazing), sun-patch bounce
//    (RectAreaLight lying on the sunlit floor, facing up), faint hemisphere, and an environment map
//    captured *inside the room* (CubeCamera → PMREM) so reflections/ambient see the real room.
//  • Evening: sun off, blue-hour sky + city lights, recessed downlights (2700 K spots), lamp lights
//    from furniture userData.lights, glowing shades, under-cabinet LED strip.
import * as THREE from 'three';
import { DEG, kelvin, clamp } from './util.js';
import { SKY_PRESETS, makeSkyTexture } from './sky.js';

export const TIMES = ['morning', 'day', 'golden', 'evening'];

// alt/az in degrees; az measured from the window normal (+Z) towards +X.
export const TOD = {
  morning: { sun: { alt: 17, az: 40, K: 4600, I: 7.0 }, exposure: 1.0, hemi: 0.10, windowFill: 0.55, env: 1.0, lamps: false },
  day:     { sun: { alt: 41, az: -24, K: 5500, I: 8.5 }, exposure: 0.85, hemi: 0.10, windowFill: 0.6, env: 1.0, lamps: false },
  golden:  { sun: { alt: 9, az: -47, K: 3000, I: 6.0 }, exposure: 1.05, hemi: 0.08, windowFill: 0.45, env: 1.0, lamps: false },
  evening: { sun: { alt: -5, az: -60, K: 3000, I: 0 }, exposure: 1.6, hemi: 0.02, windowFill: 0.05, env: 1.0, lamps: true },
};

const WARM = kelvin(2700);

export function createLighting({ renderer, scene, arch, layout, quality = 'high' }) {
  const S = layout.size;
  const X = S.x, Z = S.z;
  const center = new THREE.Vector3(X / 2, 0, Z / 2);
  const rig = new THREE.Group(); rig.name = 'lighting';
  scene.add(rig);

  // ---------------------------------------------------------------- sun
  const sun = new THREE.DirectionalLight(0xffffff, 8);
  sun.name = 'sun';
  sun.castShadow = true;
  const mapSize = quality === 'high' ? 4096 : quality === 'medium' ? 2048 : 1024;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.00018;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = quality === 'low' ? 1.5 : 3.0;
  sun.shadow.intensity = 1;
  sun.target.position.copy(center);
  rig.add(sun, sun.target);

  // ---------------------------------------------------------------- sky fill
  const hemi = new THREE.HemisphereLight(0xcfdcec, 0x8c7660, 0.1);
  hemi.name = 'hemi';
  hemi.position.set(0, 10, 0);
  rig.add(hemi);

  // window fill: luminance ≈ sky seen through the glazing
  const win = arch.window;
  const windowFill = new THREE.RectAreaLight(0xffffff, 0.6, win.x1 - win.x0, win.y1 - win.y0);
  windowFill.name = 'window-fill';
  windowFill.position.set((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, win.z - 0.02);
  windowFill.lookAt(windowFill.position.x, windowFill.position.y, 0);
  windowFill.userData.fake = true;
  rig.add(windowFill);

  // sun-patch bounce (warm floor bounce lighting walls/ceiling)
  const bounce = new THREE.RectAreaLight(0xffffff, 0, 1, 1);
  bounce.name = 'sun-bounce';
  bounce.rotation.x = Math.PI / 2; // emit +Y
  bounce.userData.fake = true;
  rig.add(bounce);

  // ---------------------------------------------------------------- evening lights
  const downlights = [];
  for (const p of arch.downlights) {
    const s = new THREE.SpotLight(WARM, 0, 0, 52 * DEG, 0.75, 2);
    s.position.copy(p);
    s.target.position.set(p.x, 0, p.z);
    s.castShadow = false;
    s.radius = 0.03; // path tracer soft source
    s.name = 'downlight';
    s.visible = false;
    rig.add(s, s.target);
    downlights.push(s);
  }
  let strip = null;
  if (arch.underCabinet) {
    const u = arch.underCabinet;
    strip = new THREE.RectAreaLight(kelvin(3000), 0, 0.03, u.len);
    strip.position.set(u.x, u.y, u.z);
    strip.rotation.x = -Math.PI / 2; // emit -Y, height along Z
    strip.name = 'led-strip';
    strip.visible = false;
    rig.add(strip);
  }

  // ---------------------------------------------------------------- environment (room capture)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const cubeRT = new THREE.WebGLCubeRenderTarget(quality === 'low' ? 64 : 128, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.05, 8000, cubeRT);
  cubeCam.position.set(X / 2, 1.35, Z * 0.6);
  let envRT = null;
  const skyCache = new Map();
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

  /** Approximate sunlit floor patch → place/size the bounce light. */
  function placeBounce(dir, cfg) {
    if (dir.y <= 0.02) { bounce.intensity = 0; return; }
    const corners = [[win.x0, win.y0], [win.x1, win.y0], [win.x0, win.y1], [win.x1, win.y1]];
    const xs = [], zs = [];
    for (const [x, y] of corners) {
      const t = y / dir.y;
      xs.push(clamp(x - dir.x * t, 0, X)); zs.push(clamp(win.z - dir.z * t, 0, Z));
    }
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const w = Math.max(0.3, x1 - x0), d = Math.max(0.3, z1 - z0);
    bounce.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    bounce.width = w; bounce.height = d;
    // radiance of the lit floor: E·ρ/π, diluted by the true patch area vs. the rect we use
    const fullArea = (win.x1 - win.x0) * (win.y1 - win.y0) * Math.abs(dir.z / dir.y);
    const fill = clamp(fullArea / (w * d), 0.15, 1);
    const E = cfg.sun.I * dir.y * 0.85;
    bounce.intensity = E * 0.42 / Math.PI * fill * 0.9;
    bounce.color.copy(kelvin(cfg.sun.K)).multiply(new THREE.Color('#e6cfae'));
  }

  // fallback fill (window rect light, floor bounce, hemisphere) is only used until the probe
  // volume is baked; with probes the bounce light is real and these would double count
  let fallback = true;
  let sunUpNow = true;
  function applyFallback() {
    windowFill.visible = fallback;
    bounce.visible = fallback && sunUpNow;
    hemi.visible = fallback;
  }
  function setFallback(on) { fallback = !!on; applyFallback(); }

  function setLampLights(list) { lampLights = list; applyLamps(); }

  function applyLamps() {
    const on = TOD[current].lamps;
    for (const l of lampLights) { l.visible = on; }
  }

  function setTimeOfDay(tod) {
    if (!TOD[tod]) tod = 'day';
    current = tod;
    const cfg = TOD[tod];
    const dir = sunDirection(cfg);
    // sun
    const sunUp = cfg.sun.I > 0 && dir.y > 0;
    sun.visible = sunUp;
    sun.color.copy(kelvin(cfg.sun.K));
    sun.intensity = cfg.sun.I;
    if (sunUp) fitShadow(dir);
    // sky
    skyTex = skyFor(tod);
    scene.background = skyTex;
    scene.backgroundIntensity = 1;
    const P = SKY_PRESETS[tod];
    hemi.color.set(P.zenith).lerp(new THREE.Color(P.horizon), 0.5);
    hemi.groundColor.set('#a08465');
    hemi.intensity = cfg.hemi;
    // window fill takes the horizon sky colour
    windowFill.color.set(P.horizon).lerp(new THREE.Color(P.zenith), 0.3);
    windowFill.intensity = P.horizonL * cfg.windowFill;
    placeBounce(dir, cfg);
    sunUpNow = sunUp;
    applyFallback();
    // evening lights
    const lamps = cfg.lamps;
    for (const s of downlights) { s.visible = lamps; s.intensity = lamps ? 5.5 : 0; }
    if (strip) { strip.visible = lamps; strip.intensity = lamps ? 9 : 0; }
    arch.downlightMaterial.emissiveIntensity = lamps ? 7 : 0;
    arch.ledMaterial.emissiveIntensity = lamps ? 5 : 0;
    applyLamps();
    return { exposure: cfg.exposure, envIntensity: cfg.env };
  }

  /** Capture the room into a cube map and use its PMREM as scene.environment. */
  function captureEnvironment({ hide = [], passes = 1 } = {}) {
    const prevBg = scene.background;
    const hidden = [];
    for (const o of hide) if (o.visible) { o.visible = false; hidden.push(o); }
    scene.traverse((o) => { if (o.userData.noCapture && o.visible) { o.visible = false; hidden.push(o); } });
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    for (let i = 0; i < passes; i++) {
      cubeCam.update(renderer, scene);
      const next = pmrem.fromCubemap(cubeRT.texture);
      if (envRT) envRT.dispose();
      envRT = next;
      scene.environment = envRT.texture;
    }
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    for (const o of hidden) o.visible = true;
    scene.background = prevBg;
  }

  return {
    rig, sun, hemi, windowFill, bounce, downlights, strip,
    get time() { return current; },
    get skyTexture() { return skyTex; },
    sunDirection: () => sunDirection(TOD[current]),
    setTimeOfDay, setLampLights, captureEnvironment, setFallback,
    get fallback() { return fallback; },
    fakeLights: [windowFill, bounce, hemi],
    dispose() {
      for (const t of skyCache.values()) t.dispose();
      skyCache.clear();
      if (envRT) envRT.dispose();
      cubeRT.dispose(); pmrem.dispose();
      sun.shadow.map?.dispose();
      scene.remove(rig);
    },
  };
}
