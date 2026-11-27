// Villar engine — "Фото" mode: progressive path tracing of the current view with
// three-gpu-pathtracer's WebGLPathTracer (WebGL2 path). Owner: engine.
//
// The path tracer snapshots lights / materials / environment at setScene() time, so we put the
// scene into a "physical" state (real glass, sky portal, no raster-only tricks) just for that call
// and restore the raster state immediately after; the raster pipeline keeps drawing until the first
// full sample lands, then the path-traced image fades in.
//   • start/stop are race-free: every start takes a generation token; stop() (or dispose) bumps it,
//     so a start that is still loading / preparing never activates afterwards.
//   • The scene snapshot (BVH + texture atlas) is cached by `version`: re-entering Фото without a
//     swap or time change only updates the camera.
//   • Texture atlas 512² (256² below 'high') instead of 1024²: ~4× less GPU memory.
//   • Despeckle clamps radiance and rejects NaN/Inf, and applies the camera white balance.
//   • A lost WebGL context drops the tracer; the next start rebuilds it.
//   • Idle refinement (startRefine/stepRefine/stopRefine): the same tracer, but the engine composites the
//     despeckled + denoised HDR estimate through its own post chain (same exposure, white balance, shadow
//     dodge, bloom and tone mapping as raster → no pop); the scene snapshot is shared with Фото.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// benign notices raised inside the vendored tracer (r187 deprecations, missing parallel compile)
const QUIET = [/WebGLPathTracer.*deprecated/, /THREE\.Clock.*deprecated/, /iridescenceThicknessRange/, /KHR_parallel_shader_compile/];
function quietly(fn) {
  const warn = console.warn;
  console.warn = (...a) => { if (typeof a[0] === 'string' && QUIET.some((re) => re.test(a[0]))) return; warn.apply(console, a); };
  try { return fn(); } finally { console.warn = warn; }
}

const MAX_RADIANCE = 24; // per-pixel luminance clamp (pre-exposure HDR) — kills fireflies, never NaN

export function createPhoto({ renderer, scene, camera, emit, rasterRender, prepare, quality = 'high' }) {
  let mod = null;
  let pt = null;
  let active = false;
  let starting = null;
  let gen = 0;
  let target = 256;
  let lastSamples = -1;
  let done = false;
  let denoise = null;
  let quad = null;
  let despeckle = null, despeckleQuad = null, cleanRT = null;
  let exposureScale = 1;
  let snapshotVersion = null;
  // idle refinement
  let refining = false, refineGen = 0, refineSamples = -1, outRT = null, tmpRT = null;
  let demodQuad = null, atrousQuad = null;
  /**
   * Raster-guided denoise for idle refinement: the path-traced estimate is divided by the held raster frame
   * (same view, same materials → textures and edges cancel, what remains is the smooth lighting
   * difference), that ratio is filtered with an edge-aware à-trous wavelet whose edges come from the raster
   * frame, and the post pass multiplies it back onto the FULL-resolution raster frame. Low sample counts
   * look clean and keep every texture detail; the filter shrinks as samples accumulate (0 levels → exact).
   */
  function makeGuided() {
    const vs = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
    demodQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, guide: { value: null } }, vertexShader: vs,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform sampler2D guide; varying vec2 vUv;
        void main() {
          vec4 pa = texture2D( map, vUv );
          vec3 g = texture2D( guide, vUv ).rgb;
          // the raster frame is half float: a glint can be Inf, and Inf / Inf = NaN would spread through the
          // wavelet as a black block
          if ( any( isnan( g ) ) || any( isinf( g ) ) ) g = vec3( 1e4 );
          g = clamp( g, vec3( 0.0 ), vec3( 1e4 ) );
          if ( any( isnan( pa ) ) || any( isinf( pa ) ) ) pa = vec4( 0.0, 0.0, 0.0, 1.0 );
          float gl = dot( g, vec3( 0.2126, 0.7152, 0.0722 ) );
          // no geometry hit (dollhouse backdrop, traced without a background): keep the raster pixel
          vec3 d = pa.a < 0.5 ? vec3( 1.0 ) : clamp( pa.rgb / ( g + vec3( 0.006 ) ), 0.0, 24.0 );
          gl_FragColor = vec4( d, log2( gl + 1e-3 ) );
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    atrousQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, texel: { value: new THREE.Vector2() }, stepPx: { value: 1 }, kG: { value: 3 }, kR: { value: 0 } },
      vertexShader: vs,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec2 texel; uniform float stepPx; uniform float kG; uniform float kR; varying vec2 vUv;
        void main() {
          vec4 c = texture2D( map, vUv );
          if ( any( isnan( c ) ) || any( isinf( c ) ) ) c = vec4( 1.0, 1.0, 1.0, 0.0 );
          float lc = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          const float h[ 5 ] = float[]( 0.0625, 0.25, 0.375, 0.25, 0.0625 );
          vec3 sum = vec3( 0.0 ); float wsum = 0.0;
          for ( int y = -2; y <= 2; y ++ ) for ( int x = -2; x <= 2; x ++ ) {
            vec4 q = texture2D( map, vUv + vec2( x, y ) * stepPx * texel );
            if ( any( isnan( q ) ) || any( isinf( q ) ) ) continue;
            float lq = dot( q.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            float w = h[ x + 2 ] * h[ y + 2 ] * exp( - abs( q.a - c.a ) * kG - abs( lq - lc ) * kR );
            sum += q.rgb * w; wsum += w;
          }
          gl_FragColor = vec4( sum / max( wsum, 1e-6 ), c.a );
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
  }
  const unity = new THREE.Vector3(1, 1, 1);
  const wb = new THREE.Vector3(1, 1, 1);

  async function load() {
    if (mod) return mod;
    mod = await import('three-gpu-pathtracer');
    return mod;
  }

  function makeTracer() {
    // the WebGL tracer logs a deprecation notice in favour of the WebGPU one; we target WebGL2 on purpose
    quietly(() => { pt = new mod.WebGLPathTracer(renderer); });
    const ts = quality === 'high' ? 512 : 256;
    pt.textureSize.set(ts, ts);
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
    // firefly suppression: a pixel far brighter than all 8 neighbours is replaced by their mean;
    // radiance clamp + NaN rejection; camera white balance (same gains as the raster OutputPass)
    despeckle = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, k: { value: 2.5 }, gain: { value: wb }, maxL: { value: MAX_RADIANCE } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform float k; uniform vec3 gain; uniform float maxL; varying vec2 vUv;
        float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
        vec3 sane( vec3 c ) {
          if ( any( isnan( c ) ) || any( isinf( c ) ) ) return vec3( 0.0 );
          c = max( c, vec3( 0.0 ) );
          float l = lum( c );
          return l > maxL ? c * ( maxL / l ) : c;
        }
        void main() {
          vec2 px = 1.0 / vec2( textureSize( map, 0 ) );
          vec4 c = texture2D( map, vUv );
          float a = ( isnan( c.a ) || isinf( c.a ) ) ? 1.0 : c.a;
          c.rgb = sane( c.rgb );
          vec3 sum = vec3( 0.0 ); float mx = 0.0;
          for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
            if ( x == 0 && y == 0 ) continue;
            vec3 n = sane( texture2D( map, vUv + vec2( x, y ) * px ).rgb );
            sum += n; mx = max( mx, lum( n ) );
          }
          float l = lum( c.rgb );
          if ( l > k * mx + 0.02 ) c.rgb = sum / 8.0;
          gl_FragColor = vec4( c.rgb * gain, a );
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
      denoise.sigma = Math.max(0.8, 4.0 / Math.pow(s, 0.25));
      denoise.kSigma = 1.5;
      denoise.threshold = Math.max(0.015, 0.6 / Math.sqrt(s));
      denoise.opacity = ptQuad.material.opacity;
      const ac = r.autoClear; r.autoClear = false;
      const ex = r.toneMappingExposure; r.toneMappingExposure = ex * exposureScale;
      quad.render(r);
      r.toneMappingExposure = ex;
      r.autoClear = ac;
    };
  }

  function dropTracer({ glAlive = true } = {}) {
    if (pt && glAlive) { try { pt.dispose(); } catch { /* ignore */ } }
    if (glAlive) {
      quad?.dispose(); despeckleQuad?.dispose(); despeckle?.dispose(); cleanRT?.dispose(); outRT?.dispose(); tmpRT?.dispose(); denoise?.dispose();
      for (const q of [demodQuad, atrousQuad]) if (q) { q.material.dispose(); q.dispose(); }
    }
    pt = null; quad = null; despeckle = null; despeckleQuad = null; cleanRT = null; outRT = null; tmpRT = null; denoise = null;
    demodQuad = null; atrousQuad = null;
    refining = false;
    snapshotVersion = null;
  }

  /**
   * Start path tracing. `version` identifies the scene state (swaps, time of day, view mode); an
   * unchanged version reuses the previous snapshot. Resolves when started (or cancelled).
   */
  async function start({ samples = 256, scale = 1, version = null, whiteBalance = null } = {}) {
    if (active || starting) return starting;
    const my = ++gen;
    const job = (async () => {
      emit('photo', { state: 'preparing' });
      await load();
      if (my !== gen) return;
      // let the 'preparing' state paint before the synchronous scene build
      await new Promise((r) => setTimeout(r, 30));
      if (my !== gen) return;
      if (renderer.getContext().isContextLost()) throw new Error('WebGL context lost');
      stopRefine();
      if (!pt) makeTracer();
      pt.renderToCanvas = true; pt.rasterizeScene = true;
      pt.bounces = 6; pt.transmissiveBounces = 8;
      target = samples;
      if (whiteBalance) wb.copy(whiteBalance);
      const dpr = renderer.getPixelRatio();
      pt.renderScale = Math.min(1, scale * 1.5 / Math.max(1, dpr));
      camera.updateMatrixWorld();
      if (version === null || version !== snapshotVersion) {
        // physical scene state for the snapshot, then restore
        const restore = prepare();
        try {
          quietly(() => pt.setScene(scene, camera));
          exposureScale = restore.exposureScale || 1;
        } finally { restore(); }
        snapshotVersion = version;
      } else {
        quietly(() => pt.setCamera(camera));
      }
      if (my !== gen) { pt.pausePathTracing = true; return; }
      pt.pausePathTracing = false;
      pt.reset();
      lastSamples = -1; done = false;
      active = true;
      emit('photo', { state: 'started', target });
      emit('progress', { samples: 0, target });
    })();
    starting = job;
    try { await job; } catch (e) {
      console.error('[villar] photo mode failed', e);
      active = false;
      dropTracer({ glAlive: !renderer.getContext().isContextLost() });
      if (my === gen) emit('photo', { state: 'error', message: String(e && e.message || e) });
    } finally { if (starting === job) starting = null; }
  }

  function stop({ silent = false } = {}) {
    const was = active || !!starting;
    gen++;
    starting = null;
    active = false;
    if (pt) { pt.pausePathTracing = true; try { pt.reset(); } catch { /* lost context */ } }
    if (was && !silent) emit('photo', { state: 'stopped' });
    return was;
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

  // ---------------------------------------------------------------- idle refinement
  /**
   * Start refining the current view. `version` keys the scene snapshot (shared with Фото); `prepare`
   * gets { refine: true }. Resolves true when sampling has started, false if cancelled / unavailable.
   * The snapshot (geometry merge + BVH) is synchronous: callers start only after the camera rested.
   */
  async function startRefine({ version = null, scale = 1, tiles = 2 } = {}) {
    if (active || starting) return false;
    const my = ++refineGen;
    await load();
    if (my !== refineGen || active || starting) return false;
    if (renderer.getContext().isContextLost()) return false;
    if (!pt) makeTracer();
    pt.renderToCanvas = false; pt.rasterizeScene = false;
    pt.renderScale = scale;
    pt.tiles.set(tiles, tiles);
    pt.bounces = 4; pt.transmissiveBounces = 4; // the interior's GI is ~converged by bounce 4; faster refining
    camera.updateMatrixWorld();
    const t0 = performance.now();
    if (version === null || version !== snapshotVersion) {
      const restore = prepare({ refine: true });
      try {
        quietly(() => pt.setScene(scene, camera));
        exposureScale = restore.exposureScale || 1;
      } finally { restore(); }
      snapshotVersion = version;
    } else quietly(() => pt.setCamera(camera));
    const ms = performance.now() - t0;
    if (my !== refineGen) { pt.pausePathTracing = true; return false; }
    pt.pausePathTracing = false;
    pt.reset();
    refining = true; refineSamples = -1;
    return { snapshotMs: ms };
  }
  /** One tile of path tracing; re-filters the estimate when a full sample completed. */
  function stepRefine(guide = null) {
    if (!refining || !pt) return null;
    quietly(() => pt.renderSample());
    const s = pt.samples;
    const whole = Math.floor(s);
    if (whole >= 1 && whole !== refineSamples) { refineSamples = whole; filterTo(pt.target, whole, guide); }
    return { texture: refineSamples >= 1 && outRT ? outRT.texture : null, demod: !!guide, samples: s, compiling: !!pt.isCompiling };
  }
  /** despeckle (radiance clamp, NaN, fireflies) → smart denoise, into an HDR target in raster units */
  function filterTo(rt, s, guide = null) {
    const r = renderer;
    const w = rt.width, h = rt.height;
    if (guide) return guidedTo(rt, s, guide);
    if (!cleanRT || cleanRT.width !== w || cleanRT.height !== h) {
      cleanRT?.dispose();
      cleanRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    }
    if (!outRT || outRT.width !== w || outRT.height !== h) {
      outRT?.dispose();
      outRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
      outRT.texture.name = 'villar.refine';
    }
    const prev = r.getRenderTarget();
    const ac = r.autoClear; r.autoClear = true;
    try {
      despeckle.uniforms.map.value = rt.texture;
      despeckle.uniforms.k.value = s < 64 ? 2.0 : s < 256 ? 3.0 : 5.0;
      despeckle.uniforms.gain.value = unity.set(exposureScale, exposureScale, exposureScale);
      r.setRenderTarget(cleanRT); despeckleQuad.render(r);
      denoise.map = cleanRT.texture;
      denoise.sigma = Math.max(0.8, 4.0 / Math.pow(s, 0.25));
      denoise.kSigma = 1.5;
      denoise.threshold = Math.max(0.015, 0.6 / Math.sqrt(s));
      denoise.opacity = 1;
      denoise.transparent = false;
      r.setRenderTarget(outRT); quad.render(r);
    } finally {
      despeckle.uniforms.gain.value = wb;
      denoise.transparent = true;
      r.setRenderTarget(prev); r.autoClear = ac;
    }
  }
  function guidedTo(rt, s, guide) {
    const r = renderer;
    const w = rt.width, h = rt.height;
    const mk = (old, name) => {
      if (old && old.width === w && old.height === h) return old;
      old?.dispose();
      const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
      t.texture.name = name;
      return t;
    };
    cleanRT = mk(cleanRT, 'villar.refine.clean'); tmpRT = mk(tmpRT, 'villar.refine.tmp'); outRT = mk(outRT, 'villar.refine');
    if (!demodQuad) makeGuided();
    const levels = s < 16 ? 4 : s < 64 ? 3 : s < 192 ? 2 : s < 384 ? 1 : 0;
    const prev = r.getRenderTarget();
    const ac = r.autoClear; r.autoClear = true;
    try {
      despeckle.uniforms.map.value = rt.texture;
      // only true fireflies: at low sample counts most lit pixels are isolated, and replacing them by their
      // neighbours would throw the light away — the wavelet below averages them instead (energy preserved)
      despeckle.uniforms.k.value = s < 64 ? 8.0 : 12.0;
      despeckle.uniforms.gain.value = unity.set(exposureScale, exposureScale, exposureScale);
      r.setRenderTarget(cleanRT); despeckleQuad.render(r);
      // ping-pong so that the last pass lands in outRT
      const order = levels % 2 === 0 ? [outRT, tmpRT] : [tmpRT, outRT];
      const dm = demodQuad.material.uniforms;
      dm.map.value = cleanRT.texture; dm.guide.value = guide;
      r.setRenderTarget(order[0]); demodQuad.render(r);
      const am = atrousQuad.material.uniforms;
      am.texel.value.set(1 / w, 1 / h);
      am.kG.value = 3.0;
      am.kR.value = s < 64 ? 0 : 0.02 * Math.sqrt(s); // trust the estimate's own edges only once it has converged
      let src = order[0], dst = order[1];
      for (let i = 0; i < levels; i++) {
        am.map.value = src.texture; am.stepPx.value = 1 << i;
        r.setRenderTarget(dst); atrousQuad.render(r);
        [src, dst] = [dst, src];
      }
    } finally {
      despeckle.uniforms.gain.value = wb;
      r.setRenderTarget(prev); r.autoClear = ac;
    }
  }
  function stopRefine() {
    refineGen++;
    if (!refining) return false;
    refining = false;
    if (pt && !active) { pt.pausePathTracing = true; try { pt.reset(); } catch { /* lost context */ } }
    return true;
  }

  return {
    start, stop, render,
    startRefine, stepRefine, stopRefine,
    get refining() { return refining; },
    get refineRT() { return outRT; },
    get tracer() { return pt; },
    /** Set tile count / scale while refining (adaptive frame budget). */
    setRefineBudget({ tiles, scale } = {}) { if (!pt) return; if (tiles) pt.tiles.set(tiles, tiles); if (scale) pt.renderScale = scale; },
    get active() { return active; },
    get busy() { return !!starting; },
    get samples() { return pt ? pt.samples : 0; },
    get done() { return done; },
    /** The scene changed in a way the snapshot doesn't know about. */
    invalidateScene() { snapshotVersion = null; },
    setQuality(q) { if (q !== quality) { quality = q; dropTracer(); } },
    /** WebGL context lost: stop and forget every GL object of the dead context. */
    onContextLost() { stop(); stopRefine(); outRT = null; dropTracer({ glAlive: false }); },
    dispose() { stop({ silent: true }); stopRefine(); outRT?.dispose(); outRT = null; dropTracer(); },
  };
}
