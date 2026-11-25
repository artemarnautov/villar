// Villar engine — "Фото" mode: progressive path tracing of the current view with
// three-gpu-pathtracer's WebGLPathTracer (WebGL2 path). Owner: engine.
//
// The path tracer snapshots lights / materials / environment at setScene() time, so we put the
// scene into a "physical" state (no fake fill lights, sky as environment, real glass transmission)
// just for that call and restore the raster state immediately after; the raster pipeline keeps
// drawing until the first full sample lands, then the path-traced image fades in.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export function createPhoto({ renderer, scene, camera, emit, rasterRender, prepare }) {
  let mod = null;
  let pt = null;
  let active = false;
  let starting = null;
  let target = 256;
  let lastSamples = -1;
  let done = false;
  let denoise = null;
  let quad = null;
  let exposureScale = 1;

  async function load() {
    if (mod) return mod;
    mod = await import('three-gpu-pathtracer');
    return mod;
  }

  function makeTracer() {
    // the WebGL tracer logs a deprecation notice in favour of the WebGPU one; we target WebGL2 on purpose
    const warn = console.warn;
    console.warn = (...a) => { if (typeof a[0] === 'string' && a[0].includes('WebGLPathTracer') && a[0].includes('deprecated')) return; warn.apply(console, a); };
    try { pt = new mod.WebGLPathTracer(renderer); } finally { console.warn = warn; }
    pt.tiles.set(2, 2);
    pt.bounces = 6;
    pt.transmissiveBounces = 8;
    pt.filterGlossyFactor = 0.35;
    pt.multipleImportanceSampling = true;
    pt.minSamples = 1;
    pt.renderDelay = 0;
    pt.fadeDuration = 450;
    pt.dynamicLowRes = false;
    pt.rasterizeScene = true;
    pt.rasterizeSceneCallback = () => rasterRender();
    denoise = new mod.DenoiseMaterial({ map: null, sigma: 2.5, threshold: 0.08, kSigma: 1.0, transparent: true, premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha });
    quad = new FullScreenQuad(denoise);
    pt.renderToCanvasCallback = (rt, r, ptQuad) => {
      const s = Math.max(1, pt.samples);
      // denoise strongly while noisy, fade the filter out as the estimate converges
      denoise.map = rt.texture;
      denoise.sigma = Math.max(0.9, 3.2 / Math.pow(s, 0.3));
      denoise.threshold = Math.max(0.015, 0.12 / Math.pow(s, 0.45));
      denoise.opacity = ptQuad.material.opacity;
      const ac = r.autoClear; r.autoClear = false;
      const ex = r.toneMappingExposure; r.toneMappingExposure = ex * exposureScale;
      quad.render(r);
      r.toneMappingExposure = ex;
      r.autoClear = ac;
    };
  }

  async function start({ samples = 256, scale = 1 } = {}) {
    if (active || starting) return starting;
    starting = (async () => {
      emit('photo', { state: 'preparing' });
      await load();
      if (!pt) makeTracer();
      target = samples;
      const dpr = renderer.getPixelRatio();
      pt.renderScale = Math.min(1, scale * 1.5 / Math.max(1, dpr));
      // physical scene state for the snapshot, then restore
      const restore = prepare();
      try {
        camera.updateMatrixWorld();
        pt.setScene(scene, camera);
        exposureScale = restore.exposureScale || 1;
      } finally { restore(); }
      pt.pausePathTracing = false;
      pt.reset();
      lastSamples = -1; done = false;
      active = true;
      emit('photo', { state: 'started', target });
      emit('progress', { samples: 0, target });
    })();
    try { await starting; } catch (e) {
      console.error('[villar] photo mode failed', e);
      active = false;
      emit('photo', { state: 'error', message: String(e && e.message || e) });
    } finally { starting = null; }
  }

  function stop() {
    if (!active && !starting) return;
    active = false;
    if (pt) { pt.pausePathTracing = true; pt.reset(); }
    emit('photo', { state: 'stopped' });
  }

  /** Called by the engine each frame while active. Returns true if it drew the frame. */
  function render() {
    if (!active || !pt) return false;
    if (done) pt.pausePathTracing = true;
    pt.renderSample();
    const s = Math.floor(pt.samples);
    if (s !== lastSamples) {
      lastSamples = s;
      emit('progress', { samples: Math.min(s, target), target });
      if (s >= target && !done) { done = true; emit('photo', { state: 'done', samples: s }); }
    }
    return true;
  }

  return {
    start, stop, render,
    get active() { return active; },
    get busy() { return !!starting; },
    get samples() { return pt ? pt.samples : 0; },
    get done() { return done; },
    dispose() {
      active = false;
      if (pt) pt.dispose();
      if (quad) quad.dispose();
      if (denoise) denoise.dispose();
      pt = null;
    },
  };
}

export { THREE };
