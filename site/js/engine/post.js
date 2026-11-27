// Villar engine — post-processing. Owner: engine.
//
//   GTAO (G-buffer + AO + Poisson denoise, BEFORE the beauty pass) → RenderPass (MSAA HalfFloat;
//   materials sample the AO in a patched `aomap_fragment`, so it only occludes *indirect* light,
//   never sun or lamps) → Meter (auto-exposure) → Outline (selection) → Bloom (lamps) →
//   Output (camera white balance in linear HDR, tone mapping, sRGB).
// Only the RenderPass target is multisampled; the ping-pong partner has samples = 0.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ----------------------------------------------------------------------------- shader patches
// Screen-space AO applied to indirect light only (UE/Unity style). Materials opt in through the
// VILLAR_SSAO define (+ shared uniforms via onBeforeCompile, see attachSSAO), so captures, probe
// bakes and thumbnails — which render outside post.render(), where the intensity is 0 — are unaffected.
const SSAO = {
  villarSSAO: { value: null },
  villarSSAOInv: { value: new THREE.Vector2(1, 1) },
  villarSSAOIntensity: { value: 0 },
  // contact occlusion from furniture footprints (index.js updateContact): R = blurred occupancy, G = height / 3 m
  villarFoot: { value: null },
  villarFootBox: { value: new THREE.Vector4(0, 0, 1, 1) },   // min x, min z, size x, size z (m)
  villarFootK: { value: 0 },
};
/** Furniture footprint map for contact occlusion of the indirect light (null / k 0 = off). */
export function setContactMap(texture, box, k = 0.75) {
  SSAO.villarFoot.value = texture || WHITE_TEX();
  if (box) SSAO.villarFootBox.value.set(box[0], box[1], box[2], box[3]);
  SSAO.villarFootK.value = texture ? k : 0;
}
const WHITE_TEX = () => WHITE;
let chunksPatched = false;
function patchChunks() {
  if (chunksPatched) return; chunksPatched = true;
  const C = THREE.ShaderChunk;
  C.aomap_pars_fragment = `${C.aomap_pars_fragment}
#ifdef VILLAR_SSAO
	uniform sampler2D villarSSAO;
	uniform vec2 villarSSAOInv;
	uniform float villarSSAOIntensity;
	uniform sampler2D villarFoot;
	uniform vec4 villarFootBox;
	uniform float villarFootK;
#endif`;
  C.aomap_fragment = `#ifdef VILLAR_SSAO
	{
		float villarAO = mix( 1.0, texture2D( villarSSAO, gl_FragCoord.xy * villarSSAOInv ).r, villarSSAOIntensity );
		reflectedLight.indirectDiffuse *= villarAO;
		#if defined( USE_ENVMAP ) && defined( STANDARD )
			reflectedLight.indirectSpecular *= computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), villarAO, material.roughness );
		#endif
	}
#endif
${C.aomap_fragment}`;
  // "AgX Punchy"-style look (contrast power / saturation in AgX log space) as CustomToneMapping
  const tm = C.tonemapping_pars_fragment;
  const custom = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (tm.includes(custom) && tm.includes('color = agxDefaultContrastApprox( color );')) {
    const agx = tm.slice(tm.indexOf('vec3 AgXToneMapping( vec3 color ) {'), tm.indexOf('vec3 NeutralToneMapping'));
    const look = agx
      .replace('vec3 AgXToneMapping( vec3 color ) {', 'vec3 CustomToneMapping( vec3 color ) {')
      .replace('color = agxDefaultContrastApprox( color );', `color = agxDefaultContrastApprox( color );
	{
		float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
		color = pow( max( color, vec3( 0.0 ) ), vec3( VILLAR_AGX_POWER ) );
		color = luma + VILLAR_AGX_SAT * ( color - luma );
	}`);
    C.tonemapping_pars_fragment = tm.replace(custom, `#ifndef VILLAR_AGX_POWER
	#define VILLAR_AGX_POWER 1.3
	#define VILLAR_AGX_SAT 1.25
#endif
${look}`);
  }
}

const WHITE = (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; })();

/** Opt a scene material into indirect-only SSAO (idempotent). Opaque lit materials only. */
export function attachSSAO(material) {
  if (!material || material.userData.villarSSAO || material.transparent || !(material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial)) return;
  material.userData.villarSSAO = true;
  material.defines = { ...(material.defines || {}), VILLAR_SSAO: '' };
  const prev = material.onBeforeCompile;
  if (!prev || !prev.villarSSAO) {
    const fn = function (shader, renderer) {
      if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(this, shader, renderer);
      Object.assign(shader.uniforms, SSAO);
    };
    fn.villarSSAO = true;
    material.onBeforeCompile = fn;
  }
  material.needsUpdate = true;
}

/** Writes centre-weighted log-luminance of the HDR frame into a 32×20 float target (on request). */
class MeterPass extends Pass {
  constructor(floatRT = true) {
    super();
    this.half = !floatRT;
    this.needsSwap = false;
    this.requested = false;
    this.fresh = false;
    this.rt = new THREE.WebGLRenderTarget(32, 20, { type: floatRT ? THREE.FloatType : THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, rect: { value: new THREE.Vector4(0, 0, 1, 1) }, useRect: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec4 rect; uniform float useRect; varying vec2 vUv;
        void main() {
          vec2 o = vec2( 0.25 ) / vec2( 32.0, 20.0 );
          float L = 0.0, mx = -20.0, cmx = -20.0;
          for ( int i = 0; i < 4; i ++ ) {
            vec2 j = vec2( i % 2 == 0 ? -o.x : o.x, i < 2 ? -o.y : o.y );
            vec3 c = texture2D( map, vUv + j ).rgb;
            c = clamp( c == c ? c : vec3( 0.0 ), vec3( 1e-4 ), vec3( 1e4 ) );   // NaN-safe
            float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
            L += log( l );
            mx = max( mx, log( l ) );
            cmx = max( cmx, log( max( c.r, max( c.g, c.b ) ) ) );
          }
          // spot (focused object's screen rect) or centre-weighted average
          float w;
          if ( useRect > 0.5 ) w = ( vUv.x >= rect.x && vUv.x <= rect.z && vUv.y >= rect.y && vUv.y <= rect.w ) ? 1.0 : 0.0;
          else { vec2 d = ( vUv - vec2( 0.5, 0.48 ) ) * vec2( 1.3, 1.6 ); w = exp( - dot( d, d ) * 3.0 ); }
          // R: log-luminance · w   G: w   B: brightest log-luminance of the texel, A: brightest log-channel
          // (whole frame, unweighted — the focus meter's highlight guard)
          gl_FragColor = vec4( L * 0.25 * w, w, mx, cmx );
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.requested) return;
    this.requested = false;
    this.material.uniforms.map.value = readBuffer.texture;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
    this.fresh = true;
  }
  dispose() { this.rt.dispose(); this.material.dispose(); this.quad.dispose(); }
}

/**
 * Local log-luminance (48×27, bilinear): a coarse map of how bright each region of the frame is, used by
 * the output pass to dodge deep shadows (corridor, kitchen) a little, like a photographer's local
 * exposure — never darkens, so bright windows don't halo (R2-20).
 */
class LocalLumPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(48, 27, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec2 vUv;
        void main() {
          vec2 o = vec2( 0.3 ) / vec2( 48.0, 27.0 );
          float L = 0.0;
          for ( int i = 0; i < 4; i ++ ) {
            vec2 j = vec2( i % 2 == 0 ? -o.x : o.x, i < 2 ? -o.y : o.y );
            vec3 c = texture2D( map, vUv + j ).rgb;
            c = clamp( c == c ? c : vec3( 0.0 ), vec3( 1e-4 ), vec3( 1e4 ) );
            L += log( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) );
          }
          gl_FragColor = vec4( L * 0.25, 0.0, 0.0, 1.0 );
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.enabled) return;
    this.material.uniforms.map.value = readBuffer.texture;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
  }
  dispose() { this.rt.dispose(); this.material.dispose(); this.quad.dispose(); }
}

// msaa: RenderPass samples. aoScale: AO resolution relative to the drawing buffer (capped by aoCss).
/**
 * Idle refinement compositor: on a `capture` frame it keeps a copy of the raster HDR frame; while
 * holding, the raster passes are skipped and the frame is mix(held raster, path-traced estimate, k)
 * — exposure, white balance, dodge, bloom and tone mapping downstream stay exactly the raster ones.
 */
class RefinePass extends Pass {
  constructor() {
    super();
    this.hold = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.hold.texture.name = 'villar.hold';
    const vs = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { map: { value: null } }, vertexShader: vs,
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D( map, vUv ); }',
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.mix = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tHold: { value: this.hold.texture }, tPT: { value: null }, k: { value: 0 }, demod: { value: 0 } }, vertexShader: vs,
      fragmentShader: /* glsl */`
        uniform sampler2D tHold; uniform sampler2D tPT; uniform float k; uniform float demod; varying vec2 vUv;
        void main() {
          vec3 a = texture2D( tHold, vUv ).rgb;
          vec3 t = texture2D( tPT, vUv ).rgb;
          if ( any( isnan( t ) ) || any( isinf( t ) ) ) t = demod > 0.5 ? vec3( 1.0 ) : a;
          // demodulated estimate (path traced ÷ raster, filtered): back onto the full-resolution raster frame
          vec3 b = k > 0.0 ? ( demod > 0.5 ? ( a + vec3( 0.006 ) ) * t : t ) : a;
          gl_FragColor = vec4( mix( a, b, k ), 1.0 );
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.capture = false; this.holding = false; this.k = 0; this.texture = null; this.demod = false;
    this.needsSwap = false;
  }
  setSize(w, h) { this.hold.setSize(w, h); this.holding = false; }
  render(renderer, writeBuffer, readBuffer) {
    if (this.capture) {
      this.copy.material.uniforms.map.value = readBuffer.texture;
      renderer.setRenderTarget(this.hold); this.copy.render(renderer);
      this.capture = false; this.holding = true;
    }
    if (!this.holding) { this.needsSwap = false; return; }
    const u = this.mix.material.uniforms;
    u.k.value = this.texture ? this.k : 0; u.tPT.value = this.texture; u.demod.value = this.demod ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.mix.render(renderer);
    this.needsSwap = true;
  }
  dispose() { this.hold.dispose(); this.copy.dispose(); this.mix.dispose(); this.copy.material.dispose(); this.mix.material.dispose(); }
}

/**
 * Focus v2 stage (FOCUS.md §1–2). Replaces the beauty RenderPass while an item is focused:
 *  1. the room WITHOUT the item family is rendered, then blurred (soft depth of field) and dimmed in place;
 *  2. the item family is drawn over it — keeping the room's depth (spotlight, item in the room) or with the depth
 *     cleared (turntable away from home: never clips into walls), over a soft contact shadow on an invisible
 *     turntable. The item keeps its exact light and catalogue colour; only the room dims.
 * Shadow maps are never re-rendered from the split passes (pending updates wait for a normal frame).
 */
class StageBlur {
  constructor() {
    const vs = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
    this.a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { map: { value: null } }, vertexShader: vs,
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D( map, vUv ); }',
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.blur = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: vs,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec2 dir; varying vec2 vUv;
        void main() {
          vec4 c = texture2D( map, vUv ) * 0.2270270270;
          c += ( texture2D( map, vUv + dir * 1.3846153846 ) + texture2D( map, vUv - dir * 1.3846153846 ) ) * 0.3162162162;
          c += ( texture2D( map, vUv + dir * 3.2307692308 ) + texture2D( map, vUv - dir * 3.2307692308 ) ) * 0.0702702703;
          gl_FragColor = c;
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.back = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, sharp: { value: null }, mixK: { value: 1 }, dim: { value: 1 } }, vertexShader: vs,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform sampler2D sharp; uniform float mixK; uniform float dim; varying vec2 vUv;
        void main() { gl_FragColor = vec4( mix( texture2D( sharp, vUv ).rgb, texture2D( map, vUv ).rgb, mixK ) * dim, 1.0 ); }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.sharp = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  }
  setSize(w, h) {
    this.sharp.setSize(w, h);
    this.a.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); this.b.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
  }
  /** Soften + dim the room already in `target` (its depth buffer is kept). */
  apply(renderer, target, blur, dim) {
    const prev = renderer.getRenderTarget();
    this.copy.material.uniforms.map.value = target.texture;
    renderer.setRenderTarget(this.sharp); this.copy.render(renderer);
    renderer.setRenderTarget(this.a); this.copy.render(renderer);
    const u = this.blur.material.uniforms;
    const r = Math.max(0.5, blur * 2.5);
    for (let i = 0; i < 2; i++) {
      u.map.value = this.a.texture; u.dir.value.set(r / this.a.width, 0); renderer.setRenderTarget(this.b); this.blur.render(renderer);
      u.map.value = this.b.texture; u.dir.value.set(0, r / this.a.height); renderer.setRenderTarget(this.a); this.blur.render(renderer);
    }
    const bu = this.back.material.uniforms;
    bu.map.value = this.a.texture; bu.sharp.value = this.sharp.texture; bu.mixK.value = Math.min(1, blur); bu.dim.value = dim;
    renderer.setRenderTarget(target); this.back.render(renderer);
    renderer.setRenderTarget(prev);
  }
  dispose() { for (const t of [this.a, this.b, this.sharp]) t.dispose(); for (const q of [this.copy, this.blur, this.back]) { q.material.dispose(); q.dispose(); } }
}

export const QUALITY = {
  high:   { msaa: 4, ao: true, aoScale: 1.0, aoCss: 1.35, aoSamples: 16, bloom: true, maxDpr: 2, lampShadows: 2, shadowMap: 4096 },
  medium: { msaa: 2, ao: true, aoScale: 0.5, aoCss: 1.0, aoSamples: 12, bloom: false, maxDpr: 1.5, lampShadows: 0, shadowMap: 2048 },
  low:    { msaa: 2, ao: false, aoScale: 0.5, aoCss: 1.0, aoSamples: 8, bloom: false, maxDpr: 1.5, lampShadows: 0, shadowMap: 1024 },
};

export function createPost({ renderer, scene, camera, quality = 'high', aoBox = null }) {
  patchChunks();
  let Q = QUALITY[quality] || QUALITY.high;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa });
  rt.texture.name = 'villar.hdr';
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1); // we size in drawing-buffer pixels ourselves
  // only the beauty pass needs MSAA; the ping-pong partner is single-sampled, without depth
  composer.renderTarget2.samples = 0;
  composer.renderTarget2.depthBuffer = false;

  // --- GTAO first: AO only (output Off), consumed by materials during the beauty pass
  const aoSize = () => {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    const dpr = renderer.getPixelRatio();
    const k = Math.min(Q.aoScale, Q.aoCss / Math.max(1, dpr));
    return [Math.max(1, Math.round(s.x * k)), Math.max(1, Math.round(s.y * k))];
  };
  const [aw, ah] = aoSize();
  const gtao = new GTAOPass(scene, camera, aw, ah);
  gtao.output = GTAOPass.OUTPUT.Off;
  gtao.needsSwap = false;
  gtao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 1.5, thickness: 0.5, scale: 1.0, samples: Q.aoSamples, distanceFallOff: 1.0, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 0.06, normalPhi: 12, radius: 3, radiusExponent: 1, rings: 2, samples: 16 });
  if (aoBox) gtao.setSceneClipBox(aoBox);
  const gtaoSetSize = gtao.setSize.bind(gtao);
  gtao.setSize = () => { const [w, h] = aoSize(); gtaoSetSize(w, h); };
  let noAO = [];
  const gtaoRender = gtao.render.bind(gtao);
  gtao.render = (r, wb, rb, dt, mask) => {
    // glass + exterior don't take part in the AO G-buffer (precomputed list, no traversal)
    const hidden = [];
    for (const o of noAO) if (o.visible) { o.visible = false; hidden.push(o); }
    const bg = scene.background; scene.background = null;
    try { gtaoRender(r, wb, rb, dt, mask); } finally {
      scene.background = bg;
      for (const o of hidden) o.visible = true;
    }
  };
  gtao.enabled = Q.ao;
  composer.addPass(gtao);
  let aoIntensity = 0.7;

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const stageBlur = new StageBlur();
  stageBlur.setSize(size.x, size.y);
  // stage: { mode: 'spot'|'stage', items: [objects drawn in the item pass], hideInItemPass: [objects], blob, dim, blur }
  let stage = null;
  const _stageDir = new THREE.Vector3(), _stagePos = new THREE.Vector3();
  const plainRender = renderPass.render.bind(renderPass);
  renderPass.render = (r, writeBuffer, readBuffer, dt, mask) => {
    if (!stage || !stage.items.length) return plainRender(r, writeBuffer, readBuffer, dt, mask);
    // a pending shadow-map update is rendered by a normal frame first (the split passes would drop the item's shadows)
    if (r.shadowMap.needsUpdate && stage.mode === 'spot') plainRender(r, writeBuffer, readBuffer, dt, mask);
    const pending = r.shadowMap.needsUpdate;
    r.shadowMap.needsUpdate = false;
    const hidden = [];
    const hide = (o) => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
    try {
      // 1. the room without the item
      for (const o of stage.items) hide(o);
      if (stage.blob) hide(stage.blob);
      plainRender(r, writeBuffer, readBuffer, dt, mask);
      for (const o of hidden.splice(0)) o.visible = true;
      // 2. soften + dim it in place (depth kept)
      stageBlur.apply(r, readBuffer, stage.blur, stage.dim);
      // 3. the item over it
      for (const o of stage.hideInItemPass) hide(o);
      const bg = scene.background; scene.background = null;
      const ac = r.autoClear; r.autoClear = false;
      r.setRenderTarget(readBuffer);
      if (stage.mode === 'stage') r.clearDepth();
      if (stage.blob) stage.blob.visible = true;
      // optional dolly back along the view axis for the item layer only (turntable clearance)
      const dolly = stage.mode === 'stage' ? (stage.dolly || 0) : 0;
      if (dolly > 0) { camera.getWorldDirection(_stageDir); _stagePos.copy(camera.position); camera.position.addScaledVector(_stageDir, -dolly); camera.updateMatrixWorld(); }
      // On the stage the screen-space AO does not belong to the item layer: it was computed for the room with
      // the item at home, the real camera and whatever stood in front of it (a coffee table), so its pattern
      // printed that furniture over the turned item ("the table reads through the sofa")
      const aoWas = SSAO.villarSSAOIntensity.value;
      if (stage.mode === 'stage') SSAO.villarSSAOIntensity.value = 0;
      try { r.render(scene, camera); } finally {
        SSAO.villarSSAOIntensity.value = aoWas;
        if (dolly > 0) { camera.position.copy(_stagePos); camera.updateMatrixWorld(); }
        r.autoClear = ac; scene.background = bg; if (stage.blob) stage.blob.visible = false;
      }
    } finally {
      for (const o of hidden) o.visible = true;
      r.shadowMap.needsUpdate = pending;
    }
  };
  const refine = new RefinePass();
  refine.setSize(size.x, size.y);
  composer.addPass(refine);

  // --- exposure metering (auto-exposure / eye adaptation)
  const meter = new MeterPass(renderer.extensions.has('EXT_color_buffer_float'));
  composer.addPass(meter);
  const local = new LocalLumPass();
  composer.addPass(local);

  // --- selection outline: thin, soft, warm white
  const outline = new OutlinePass(new THREE.Vector2(size.x, size.y), scene, camera, []);
  // soft, anti-aliased 1.5 px halo with a little glow (R2-23 / D2-22), faded out after the flight
  outline.edgeStrength = 1.5;
  outline.edgeGlow = 0.4;
  outline.edgeThickness = 1.5;
  outline.pulsePeriod = 0;
  outline.visibleEdgeColor.set('#d9d4cc');  // ≈ white at 85 %
  outline.hiddenEdgeColor.set('#4a453f');
  outline.downSampleRatio = 2;
  outline.enabled = false;
  composer.addPass(outline);

  // --- bloom for emissive lamps only (threshold far above any lit surface)
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.35, 6.0);
  // halation: the wide bloom mips lean warm (film's red layer scatter), the tight ones stay neutral
  if (bloom.bloomTintColors) bloom.bloomTintColors.forEach((v, i) => v.set(1, 1 - 0.03 * i, 1 - 0.06 * i));
  bloom.enabled = false;
  composer.addPass(bloom);

  // --- output: white balance (linear, pre tone mapping) + tone mapping + sRGB
  const output = new OutputPass();
  output.uniforms.villarGain = { value: new THREE.Vector3(1, 1, 1) };
  output.uniforms.villarLocal = { value: local.rt.texture };
  output.uniforms.villarLiftRef = { value: 0 };    // ln of the pre-exposure luminance that displays at ~9 %
  output.uniforms.villarLiftMax = { value: 0 };    // EV (0 = off)
  output.uniforms.villarShoulder = { value: 0 };   // focus highlight roll-off 0…1 (R3-04)
  // ART §2 grade, display-referred, after tone mapping: gentle S-curve, neutral-warm highlights, slightly cool
  // shadows, fine static grain; whites stay white. x = S-curve, y = split tone, z = grain (0 = off)
  output.uniforms.villarGrade = { value: new THREE.Vector3(0.14, 1, 1) };
  {
    const m = output.material;
    const a = 'gl_FragColor = texture2D( tDiffuse, vUv );';
    if (m.fragmentShader.includes(a)) {
      m.fragmentShader = m.fragmentShader
        .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\n\t\tuniform vec3 villarGain;\n\t\tuniform sampler2D villarLocal;\n\t\tuniform float villarLiftRef;\n\t\tuniform float villarLiftMax;\n\t\tuniform float villarShoulder;\n\t\tuniform vec3 villarGrade;')
        .replace(a, `${a}
			gl_FragColor.rgb *= villarGain;
			if ( villarLiftMax > 0.0 ) {
				float l = texture2D( villarLocal, vUv ).r;
				float lp = log( max( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 ) );
				// edge-aware: a pixel much brighter than its neighbourhood (a wall beside a black TV) is not lifted → no halos
				float k = clamp( 1.0 - ( lp - l ) * 2.0, 0.0, 1.0 );
				gl_FragColor.rgb *= exp2( k * clamp( 0.75 * ( villarLiftRef - l ) / 0.6931, 0.0, villarLiftMax ) );
			}
			if ( villarShoulder > 0.0 ) {
				// focus close-up: the brightest channel rolls off toward 2.4× white (Neutral clips at ≈ 2.65),
				// so a sunlit wall behind a boosted object stays photographic instead of clipping (R3-04)
				float m = max( gl_FragColor.r, max( gl_FragColor.g, gl_FragColor.b ) ) * toneMappingExposure;
				if ( m > 1.1 ) {
					float mc = 1.1 + ( m - 1.1 ) / ( 1.0 + ( m - 1.1 ) / 1.3 );
					gl_FragColor.rgb *= mix( 1.0, mc / m, villarShoulder );
				}
			}`);
      const srgb = 'gl_FragColor = sRGBTransferOETF( gl_FragColor );\n\n\t\t\t#endif';
      if (m.fragmentShader.includes(srgb)) {
        m.fragmentShader = m.fragmentShader.replace(srgb, `${srgb}
			{
				vec3 c = clamp( gl_FragColor.rgb, 0.0, 1.0 );
				float y = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
				// S-curve on luminance (hue kept): pivot 0.45, ends pinned
				float ys = y < 0.45 ? 0.45 * pow( y / 0.45, 1.0 + villarGrade.x ) : 1.0 - 0.55 * pow( ( 1.0 - y ) / 0.55, 1.0 + villarGrade.x );
				c *= y > 1e-4 ? ys / y : 1.0;
				// split tone: cool shadows, neutral-warm highlights; zero at black and at white
				float hw = smoothstep( 0.35, 0.85, ys ), keep = ( 1.0 - smoothstep( 0.9, 1.0, ys ) ) * smoothstep( 0.0, 0.08, ys );
				c += mix( vec3( -0.006, -0.001, 0.008 ), vec3( 0.008, 0.003, -0.006 ), hw ) * keep * villarGrade.y;
				// fine static film grain (stable frame to frame: the photo compare stays exact)
				vec2 q = floor( gl_FragCoord.xy );
				float n = fract( sin( dot( q, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) + fract( sin( dot( q, vec2( 39.3468, 11.135 ) ) ) * 24634.6345 ) - 1.0;
				c += n * 0.012 * villarGrade.z * 4.0 * ys * ( 1.0 - ys );
				gl_FragColor.rgb = clamp( c, 0.0, 1.0 );
			}`);
      }
      m.needsUpdate = true;
    }
  }
  composer.addPass(output);

  let bloomWanted = false;
  const sizeV = new THREE.Vector2();

  function syncSSAO() {
    const on = gtao.enabled;
    SSAO.villarSSAO.value = on ? gtao.pdRenderTarget.texture : WHITE;
    // the size the beauty pass renders at (a capture renders at its own size, not the canvas's: with the canvas
    // size here every captured frame carried a mis-scaled AO image, visible as ghost outlines)
    sizeV.set(rt.width, rt.height);
    SSAO.villarSSAOInv.value.set(1 / Math.max(1, sizeV.x), 1 / Math.max(1, sizeV.y));
  }
  syncSSAO();

  return {
    composer, renderPass, gtao, outline, bloom, output, rt, meter,
    get quality() { return quality; },
    get settings() { return Q; },
    setQuality(q) {
      quality = q; Q = QUALITY[q] || QUALITY.high;
      gtao.enabled = Q.ao;
      gtao.updateGtaoMaterial({ samples: Q.aoSamples });
      bloom.enabled = Q.bloom && bloomWanted;
      if (rt.samples !== Q.msaa) { rt.samples = Q.msaa; rt.dispose(); }
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      this.setSize(s.x, s.y);
    },
    /** strength: 0.22 for the walk view, 0.1 in the dollhouse (lamps stay lamps, not white discs). */
    setBloom(on, strength = 0.22, threshold = 6.0) { bloomWanted = on; bloom.strength = strength; bloom.threshold = threshold; bloom.enabled = Q.bloom && on; },
    /** ART §2 grade: { curve, split, grain } (0 = off each). */
    setGrade({ curve = 0.14, split = 1, grain = 1 } = {}) { output.uniforms.villarGrade.value.set(curve, split, grain); },
    setAO(v) { aoIntensity = v; },
    setNoAO(list) { noAO = list; },
    /** Shadow dodge: `ref` = ln(pre-exposure luminance shown at ~9 %), `max` = EV cap (0 = off). */
    setShoulder(k) { output.uniforms.villarShoulder.value = k; },
    /** Focus stage (null = off); see StageBlur. */
    setStage(st) { stage = st; },
    get stage() { return stage; },
    setLift(ref, max) { output.uniforms.villarLiftRef.value = ref; output.uniforms.villarLiftMax.value = max; local.enabled = max > 0; },
    /** Camera white balance as linear RGB gains (luminance-normalised). */
    setWhiteBalance(gain) { output.uniforms.villarGain.value.copy(gain); },
    setSelection(objects) { outline.selectedObjects = objects; outline.enabled = objects.length > 0; outline.edgeStrength = 1.5; outline.edgeGlow = 0.4; },
    /** 0…1 visibility of the selection halo (fades out after a focus flight). */
    setSelectionStrength(k) { outline.edgeStrength = 1.5 * k; outline.edgeGlow = 0.4 * k; outline.enabled = outline.selectedObjects.length > 0 && k > 0.01; },
    setSize(w, h) { composer.setSize(w, h); gtao.setSize(); stageBlur.setSize(w, h); syncSSAO(); },  // (composer sizes the refine hold too)
    /**
     * `ref` (idle refinement): { capture } keeps this raster frame; { texture, k } while holding mixes the
     * path-traced estimate over the held frame without re-rendering the scene (and without re-metering).
     */
    render(dt, ref = null) {
      // the MSAA target must be the beauty pass's read buffer (swap parity can change with passes)
      if (composer.readBuffer !== rt) composer.swapBuffers();
      if (!ref) { refine.holding = false; refine.capture = false; }
      else if (ref.capture) { refine.capture = true; refine.texture = null; refine.k = 0; }
      else { refine.texture = ref.texture || null; refine.k = ref.k || 0; refine.demod = !!ref.demod; }
      const skip = refine.holding && !refine.capture;
      const saved = skip ? [gtao.enabled, renderPass.enabled, meter.enabled, local.enabled] : null;
      if (skip) { gtao.enabled = false; renderPass.enabled = false; meter.enabled = false; local.enabled = false; }
      syncSSAO();
      SSAO.villarSSAOIntensity.value = gtao.enabled ? aoIntensity : 0;
      try { composer.render(dt); } finally {
        SSAO.villarSSAOIntensity.value = 0;
        if (saved) [gtao.enabled, renderPass.enabled, meter.enabled, local.enabled] = saved;
      }
    },
    /** Render the full chain into the composer's own target (not the canvas); returns that target (sRGB, tone mapped). */
    renderOffscreen(dt = 0.016) {
      const was = composer.renderToScreen;
      composer.renderToScreen = false;
      try { this.render(dt); } finally { composer.renderToScreen = was; }
      return composer.readBuffer;
    },
    get holding() { return refine.holding; },
    get holdRT() { return refine.hold; },
    /** Compile the post materials used only at night / on selection (bloom, outline) ahead of time. */
    prewarm() {
      const geo = new THREE.PlaneGeometry(2, 2), cam = new THREE.OrthographicCamera();
      const mats = [bloom.materialHighPassFilter, ...(bloom.separableBlurMaterials || []), bloom.compositeMaterial, bloom.blendMaterial,
        outline.maskBufferMaterial, outline.depthMaterial, outline.prepareMaskMaterial, outline.edgeDetectionMaterial, outline.separableBlurMaterial1, outline.separableBlurMaterial2, outline.overlayMaterial].filter(Boolean);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(composer.renderTarget2); // these passes render into linear float targets
      try { for (const m of mats) { try { renderer.compile(new THREE.Mesh(geo, m), cam); } catch { /* best effort */ } } }
      finally { renderer.setRenderTarget(prev); }
      geo.dispose();
    },
    /** After a context restore: GL objects are gone; mark targets for re-creation. */
    onContextRestored() { WHITE.needsUpdate = true; },
    dispose() {
      gtao.dispose(); outline.dispose(); bloom.dispose(); output.dispose(); meter.dispose(); local.dispose(); refine.dispose(); stageBlur.dispose();
      composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
    },
  };
}
