// Villar engine — post-processing. Owner: engine.
// RenderPass (MSAA HalfFloat) → GTAO (half-res, contact shadows) → Outline (selection) →
// Bloom (lamps only, high tier) → OutputPass (tone mapping + sRGB).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

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
      uniforms: { map: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec2 vUv;
        void main() {
          vec2 o = vec2( 0.25 ) / vec2( 32.0, 20.0 );
          float L = 0.0;
          for ( int i = 0; i < 4; i ++ ) {
            vec2 j = vec2( i % 2 == 0 ? -o.x : o.x, i < 2 ? -o.y : o.y );
            vec3 c = texture2D( map, vUv + j ).rgb;
            L += log( max( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 ) );
          }
          vec2 d = ( vUv - vec2( 0.5, 0.48 ) ) * vec2( 1.3, 1.6 );
          float w = exp( - dot( d, d ) * 3.0 );
          gl_FragColor = vec4( L * 0.25 * w, w, 0.0, 1.0 );
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

export const QUALITY = {
  high:   { msaa: 4, ao: true, aoScale: 0.5, bloom: true, maxDpr: 2 },
  medium: { msaa: 4, ao: true, aoScale: 0.5, bloom: false, maxDpr: 1.5 },
  low:    { msaa: 2, ao: false, aoScale: 0.5, bloom: false, maxDpr: 1 },
};

export function createPost({ renderer, scene, camera, quality = 'high', aoBox = null }) {
  let Q = QUALITY[quality] || QUALITY.high;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa });
  rt.texture.name = 'villar.hdr';
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1); // we size in drawing-buffer pixels ourselves

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // --- GTAO (half resolution, world-space radius), glass/skyline excluded
  const gtao = new GTAOPass(scene, camera, Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
  if (aoBox) gtao.setSceneClipBox(aoBox);
  const gtaoSetSize = gtao.setSize.bind(gtao);
  gtao.setSize = (w, h) => gtaoSetSize(Math.max(1, Math.round(w * Q.aoScale)), Math.max(1, Math.round(h * Q.aoScale)));
  const gtaoRender = gtao.render.bind(gtao);
  const hiddenForAO = [];
  gtao.render = (r, wb, rb, dt, mask) => {
    // hide glass + exterior during the AO G-buffer pass
    scene.traverse((o) => { if (o.userData.noAO && o.visible) { o.visible = false; hiddenForAO.push(o); } });
    const bg = scene.background; scene.background = null;
    gtaoRender(r, wb, rb, dt, mask);
    scene.background = bg;
    for (const o of hiddenForAO) o.visible = true;
    hiddenForAO.length = 0;
  };
  gtao.enabled = Q.ao;
  composer.addPass(gtao);

  // --- exposure metering (auto-exposure / eye adaptation)
  const meter = new MeterPass(renderer.extensions.has('EXT_color_buffer_float'));
  composer.addPass(meter);

  // --- selection outline: thin, soft, warm white
  const outline = new OutlinePass(new THREE.Vector2(size.x, size.y), scene, camera, []);
  outline.edgeStrength = 2.2;
  outline.edgeGlow = 0.0;
  outline.edgeThickness = 1.0;
  outline.pulsePeriod = 0;
  outline.visibleEdgeColor.set('#fff6e8');
  outline.hiddenEdgeColor.set('#6e655a');
  outline.downSampleRatio = 2;
  outline.enabled = false;
  composer.addPass(outline);

  // --- bloom for emissive lamps only (threshold far above any lit surface)
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.35, 6.0);
  bloom.enabled = false;
  composer.addPass(bloom);

  const output = new OutputPass();
  composer.addPass(output);

  let bloomWanted = false;

  return {
    composer, renderPass, gtao, outline, bloom, output, rt, meter,
    get quality() { return quality; },
    setQuality(q) {
      quality = q; Q = QUALITY[q] || QUALITY.high;
      gtao.enabled = Q.ao;
      bloom.enabled = Q.bloom && bloomWanted;
      if (rt.samples !== Q.msaa) { rt.samples = Q.msaa; composer.renderTarget2.samples = Q.msaa; rt.dispose(); composer.renderTarget2.dispose(); }
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      this.setSize(s.x, s.y);
    },
    setBloom(on) { bloomWanted = on; bloom.enabled = Q.bloom && on; },
    setSelection(objects) { outline.selectedObjects = objects; outline.enabled = objects.length > 0; },
    setSize(w, h) { composer.setSize(w, h); },
    render(dt) { composer.render(dt); },
    dispose() {
      gtao.dispose(); outline.dispose(); bloom.dispose(); output.dispose(); meter.dispose();
      composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
    },
  };
}
