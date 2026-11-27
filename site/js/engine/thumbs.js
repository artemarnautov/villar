// Villar engine — catalog item thumbnails: the item alone in a neutral studio. Owner: engine.
//
//   thumbnail(item, { size: 256 }) → Promise<dataURL (JPEG)>
// Built with the same generators and shared materials as the room, rendered with the main renderer
// into an offscreen target (2× supersampled, MSAA), soft key light + room-like IBL, contact shadow on
// a `#f2efe8` backdrop, 3/4 view framed to the item's bounds. Renders are serialised, wait (≤ 4 s)
// for the item's procedural textures, and are cached per item + size.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { disposeObject, DEG } from './util.js';

const BACKDROP = '#f2efe8';
const FAR = new THREE.Vector3(-80, 0, -80); // outside the apartment box (no box-projected reflections)

export function createThumbnailer({ renderer, materials, buildItem, releaseItem = null, quality = 'high', shouldWait = () => false, software = false, prepare = null }) {
  // thumbnails never compete with a camera flight or a dissolve: one per idle slice, when the scene is quiet (T7)
  const quiet = () => new Promise((resolve) => {
    const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 50));
    const check = () => (shouldWait() ? setTimeout(() => idle(check), 120) : resolve());
    idle(check);
  });
  const cache = new Map();
  let chain = Promise.resolve();
  let inflight = 0; // thumbnails queued or rendering (idle refinement waits for them)
  let res = null;
  let disposed = false;

  function setup() {
    if (res) return res;
    const scene = new THREE.Scene();
    scene.name = 'villar-thumbnail';
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04);
    room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    pmrem.dispose();
    scene.environment = env.texture;
    scene.environmentIntensity = 0.75;
    const key = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.97, 0.93), 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    // shadow catcher: shadow only, composited over the flat backdrop (no visible horizon)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }));
    ground.receiveShadow = true;
    scene.add(ground);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
    const output = new OutputPass();
    output.renderToScreen = false;
    res = { scene, env, key, ground, camera, output, rtHDR: null, rtLDR: null, size: 0 };
    return res;
  }

  function targets(px) {
    if (res.size === px) return;
    res.rtHDR?.dispose(); res.rtLDR?.dispose();
    res.rtHDR = new THREE.WebGLRenderTarget(px, px, { type: THREE.HalfFloatType, samples: 4 });
    res.rtLDR = new THREE.WebGLRenderTarget(px, px, { type: THREE.UnsignedByteType, depthBuffer: false });
    res.size = px;
  }

  /** Place the camera on a 3/4 view and tighten the distance so the bounds fill ~84 % of the frame. */
  function frame(box) {
    const cam = res.camera;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const flat = size.y < 0.08 * Math.max(size.x, size.z);
    const elev = (flat ? 52 : 20) * DEG, az = 34 * DEG;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
    const r = Math.max(0.05, size.length() / 2);
    let dist = r / Math.sin((cam.fov * DEG) / 2);
    const target = center.clone();
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const t = Math.tan((cam.fov * DEG) / 2);
    for (let it = 0; it < 4; it++) {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      const inv = cam.matrixWorldInverse;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const p = c.clone().applyMatrix4(inv);
        const sx = p.x / (-p.z * t), sy = p.y / (-p.z * t);
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      const ext = Math.max(x1 - x0, y1 - y0) / 2;
      // recentre on the projected bounds, then scale the distance toward 84 % fill
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      target.addScaledVector(right, ((x0 + x1) / 2) * dist * t).addScaledVector(up, ((y0 + y1) / 2) * dist * t);
      dist *= ext / 0.84;
    }
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.lookAt(target);
    cam.near = Math.max(0.01, dist - r * 2); cam.far = dist + r * 4;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // key light from front-left above; shadow frustum fitted to the item + its shadow
    const k = res.key;
    k.target.position.copy(center);
    k.position.copy(center).add(new THREE.Vector3(-0.55, 1.1, 0.75).normalize().multiplyScalar(r * 6 + 1));
    const sc = k.shadow.camera;
    const e = r * 1.6;
    sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 0.05; sc.far = r * 12 + 2;
    sc.updateProjectionMatrix();
    res.ground.position.set(center.x, box.min.y + 0.001, center.z);
    res.ground.scale.setScalar(r * 8 + 1);
  }

  function renderOne(item, size) {
    setup();
    const ctx = { materials, quality };
    let group;
    try { group = buildItem(item, ctx); } catch (e) { return Promise.reject(e); }
    if (!group) return Promise.reject(new Error(`no model for ${item.id}`));
    group.position.copy(FAR);
    group.traverse((o) => { if (o.isMesh) { o.castShadow = !o.userData.noCastShadow; o.receiveShadow = true; } });
    res.scene.add(group);
    const pending = materials.pending ? materials.pending() : 0;
    // released photoscan sets come back before the studio render (engine hook, R4-07)
    const scanWait = prepare ? Promise.resolve(prepare(group)).catch(() => {}) : Promise.resolve();
    const texWait = scanWait.then(() => (pending > 0 && materials.ready ? Promise.race([materials.ready(), new Promise((r) => setTimeout(r, 4000))]) : null));
    // the studio's light set differs from the room's: compile its variants off the main thread first
    const wait = texWait.then(() => {
      if (!renderer.extensions.has('KHR_parallel_shader_compile')) return null;
      targets(Math.min(1024, Math.max(64, Math.round(size * 2))));
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(res.rtHDR); // compile the variant the studio render will use
      let p;
      try { p = renderer.compileAsync(res.scene, res.camera); } finally { renderer.setRenderTarget(prev); }
      return Promise.race([p, new Promise((r) => setTimeout(r, 3000))]).catch(() => null);
    });
    return wait.then(() => {
      try {
        if (disposed) throw new Error('disposed');
        const gl = renderer.getContext();
        if (gl.isContextLost()) throw new Error('WebGL context lost');
        group.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(group);
        if (box.isEmpty()) throw new Error('empty model');
        frame(box);
        const px = Math.min(1024, Math.max(64, Math.round(size * 2)));
        targets(px);
        // render (save + restore renderer state)
        const prevTarget = renderer.getRenderTarget();
        const prevExposure = renderer.toneMappingExposure;
        const prevClear = renderer.getClearColor(new THREE.Color()); const prevAlpha = renderer.getClearAlpha();
        const prevShadow = renderer.shadowMap.needsUpdate;
        try {
          renderer.toneMappingExposure = 1.0;
          renderer.setClearColor(0x000000, 0);
          renderer.shadowMap.needsUpdate = true;
          renderer.setRenderTarget(res.rtHDR);
          renderer.clear(true, true, false);
          renderer.render(res.scene, res.camera);
          res.output.render(renderer, res.rtLDR, res.rtHDR);
          const buf = new Uint8Array(px * px * 4);
          // GPU: async readback (no pipeline stall); software GL reads synchronously
          if (!software && renderer.readRenderTargetPixelsAsync) {
            return renderer.readRenderTargetPixelsAsync(res.rtLDR, 0, 0, px, px, buf).then(() => encode(buf, px, size));
          }
          renderer.readRenderTargetPixels(res.rtLDR, 0, 0, px, px, buf);
          return encode(buf, px, size);
        } finally {
          renderer.setRenderTarget(prevTarget);
          renderer.toneMappingExposure = prevExposure;
          renderer.setClearColor(prevClear, prevAlpha);
          renderer.shadowMap.needsUpdate = prevShadow;
        }
      } finally {
        res.scene.remove(group);
        if (releaseItem) releaseItem(group); else disposeObject(group, { isShared: (m) => !!m.userData?.materialKey });
      }
    });
  }

  const BG = [1, 3, 5].map((i) => parseInt(BACKDROP.slice(i, i + 2), 16)); // sRGB bytes
  function encode(buf, px, size) {
    const [br, bgc, bb] = BG;
    const big = document.createElement('canvas'); big.width = big.height = px;
    const c2 = big.getContext('2d');
    const img = c2.createImageData(px, px);
    const d = img.data;
    for (let y = 0; y < px; y++) {
      const src = (px - 1 - y) * px * 4, dst = y * px * 4; // flip Y
      for (let x = 0; x < px * 4; x += 4) {
        const a = buf[src + x + 3] / 255, ia = 1 - a;
        d[dst + x] = Math.min(255, buf[src + x] + br * ia);
        d[dst + x + 1] = Math.min(255, buf[src + x + 1] + bgc * ia);
        d[dst + x + 2] = Math.min(255, buf[src + x + 2] + bb * ia);
        d[dst + x + 3] = 255;
      }
    }
    c2.putImageData(img, 0, 0);
    const out = document.createElement('canvas'); out.width = out.height = size;
    const o2 = out.getContext('2d');
    o2.imageSmoothingEnabled = true; o2.imageSmoothingQuality = 'high';
    o2.drawImage(big, 0, 0, size, size);
    return out.toDataURL('image/jpeg', 0.9);
  }

  return {
    /** Promise<string> data URL; cached per item id + size. */
    thumbnail(item, { size = 256 } = {}) {
      size = Math.max(32, Math.min(512, Math.round(size) || 256));
      const k = `${item.id}@${size}`;
      if (cache.has(k)) return cache.get(k);
      inflight++;
      const p = chain.then(quiet).then(() => renderOne(item, size)).finally(() => { inflight--; });
      chain = p.catch(() => {});
      cache.set(k, p);
      p.catch(() => cache.delete(k)); // allow a retry after failures
      return p;
    },
    get busy() { return inflight > 0; },
    onContextLost() { cache.clear(); if (res) { res.rtHDR = null; res.rtLDR = null; res.size = 0; res.env = null; res = null; } },
    dispose() {
      disposed = true;
      cache.clear();
      if (!res) return;
      res.rtHDR?.dispose(); res.rtLDR?.dispose(); res.env?.dispose(); res.output.dispose();
      res.ground.geometry.dispose(); res.ground.material.dispose();
      res.key.shadow.map?.dispose();
      res = null;
    },
  };
}
