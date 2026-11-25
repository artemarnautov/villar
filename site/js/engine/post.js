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
    composer, renderPass, gtao, outline, bloom, output, rt,
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
      gtao.dispose(); outline.dispose(); bloom.dispose(); output.dispose();
      composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
    },
  };
}
