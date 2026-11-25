// Villar engine — "Фото" mode: progressive path tracing of the current view with
// three-gpu-pathtracer's WebGLPathTracer (WebGL2 path). Owner: engine.
//
// The path tracer snapshots lights / materials / environment at setScene() time, so we put the
// scene into a "physical" state (no fake fill lights, sky as environment, real glass transmission)
// just for that call and restore the raster state immediately after; the raster pipeline keeps
// drawing until the first full sample lands, then the path-traced image fades in.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// benign notices raised inside the vendored tracer (r187 deprecations, missing parallel compile)
const QUIET = [/WebGLPathTracer.*deprecated/, /THREE\.Clock.*deprecated/, /iridescenceThicknessRange/, /KHR_parallel_shader_compile/];
function quietly(fn) {
  const warn = console.warn;
  console.warn = (...a) => { if (typeof a[0] === 'string' && QUIET.some((re) => re.test(a[0]))) return; warn.apply(console, a); };
  try { return fn(); } finally { console.warn = warn; }
}

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
  let despeckle = null, despeckleQuad = null, cleanRT = null;
  let exposureScale = 1;

  async function load() {
    if (mod) return mod;
    mod = await import('three-gpu-pathtracer');
    return mod;
  }

  function makeTracer() {
    // the WebGL tracer logs a deprecation notice in favour of the WebGPU one; we target WebGL2 on purpose
    quietly(() => { pt = new mod.WebGLPathTracer(renderer); });
    pt.tiles.set(2, 2);
    pt.bounces = 6;
    pt.transmissiveBounces = 8;
    pt.filterGlossyFactor = 0.5;
    pt.multipleImportanceSampling = true;
    pt.minSamples = 1;
    pt.renderDelay = 0;
    pt.fadeDuration = 450;
    pt.dynamicLowRes = false;
    pt.rasterizeScene = true;
    pt.rasterizeSceneCallback = () => rasterRender();
    denoise = new mod.DenoiseMaterial({ map: null, sigma: 2.5, threshold: 0.08, kSigma: 1.0, transparent: true, premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha });
    quad = new FullScreenQuad(denoise);
    // firefly suppression: a pixel far brighter than all 8 neighbours is replaced by their mean
    despeckle = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, k: { value: 2.5 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform float k; varying vec2 vUv;
        float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
        void main() {
          vec2 px = 1.0 / vec2( textureSize( map, 0 ) );
          vec4 c = texture2D( map, vUv );
          vec3 sum = vec3( 0.0 ); float mx = 0.0;
          for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
            if ( x == 0 && y == 0 ) continue;
            vec3 n = texture2D( map, vUv + vec2( x, y ) * px ).rgb;
            sum += n; mx = max( mx, lum( n ) );
          }
          float l = lum( c.rgb );
          if ( l > k * mx + 0.02 ) c.rgb = sum / 8.0;
          gl_FragColor = c;
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    despeckleQuad = new FullScreenQuad(despeckle);
    pt.renderToCanvasCallback = (rt, r, ptQuad) => {
      const s = Math.max(1, pt.samples);
      if (!cleanRT || cleanRT.width !== rt.width || cleanRT.height !== rt.height) {
        cleanRT?.dispose();
        cleanRT = new THREE.WebGLRenderTarget(rt.width, rt.height, { type: THREE.HalfFloatType, depthBuffer: false });
      }
      const prev = r.getRenderTarget();
      despeckle.uniforms.map.value = rt.texture;
      despeckle.uniforms.k.value = s < 64 ? 2.0 : s < 256 ? 3.0 : 5.0;
      r.setRenderTarget(cleanRT); despeckleQuad.render(r); r.setRenderTarget(prev);
      // denoise strongly while noisy, fade the filter out as the estimate converges
      denoise.map = cleanRT.texture;
      denoise.sigma = Math.max(0.8, 3.5 / Math.pow(s, 0.28));
      denoise.threshold = Math.max(0.012, 0.35 / Math.pow(s, 0.55));
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
        quietly(() => pt.setScene(scene, camera));
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
    quietly(() => pt.renderSample());
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
      despeckleQuad?.dispose(); despeckle?.dispose(); cleanRT?.dispose();
      if (denoise) denoise.dispose();
      pt = null;
    },
  };
}

export { THREE };
