// Villar engine — baked irradiance volume (spatially varying GI for the raster path). Owner: engine.
//
// three r187's WebGLRenderer natively shades `isLightProbeGrid` objects (SH9 irradiance per cell,
// trilinear in a 3D atlas) but the helper class isn't vendored, so we build the grid ourselves:
//   1. cube faces (16²) are rendered at every probe position into one atlas render target
//      (probes inside furniture / built-ins are nudged out, the grid point stays put),
//   2. a fragment pass projects every probe's 6×16² texels onto SH9 (GPU, no per-probe readback),
//   3. 7 RGBA texels per probe are read back asynchronously and written into the HalfFloat
//      Data3DTexture layout the renderer expects (7 coefficient blocks of nz+2 padded slices).
// Baking is progressive (time-budgeted per frame) so it never blocks interaction.
import * as THREE from 'three';

const FACES = [
  { F: [1, 0, 0], U: [0, 1, 0] }, { F: [-1, 0, 0], U: [0, 1, 0] },
  { F: [0, 1, 0], U: [0, 0, 1] }, { F: [0, -1, 0], U: [0, 0, 1] },
  { F: [0, 0, 1], U: [0, 1, 0] }, { F: [0, 0, -1], U: [0, 1, 0] },
].map(({ F, U }) => {
  const f = new THREE.Vector3(...F), u = new THREE.Vector3(...U);
  return { F: f, U: u, R: new THREE.Vector3().crossVectors(f, u) };
});

class ProbeGrid extends THREE.Object3D {
  constructor() {
    super();
    this.isLight = true;           // so the renderer collects it with the lights
    this.isLightProbeGrid = true;
    this.type = 'LightProbeGrid';
    this.texture = null;
    this.boundingBox = new THREE.Box3();
    this.resolution = new THREE.Vector3(1, 1, 1);
    this.priority = 0;
    this.castShadow = false;
  }
}

/** Global chunk patch: inside a probe grid the PMREM environment only provides reflections. */
let patched = false;
export function patchProbeChunks() {
  if (patched) return; patched = true;
  const C = THREE.ShaderChunk;
  const from = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
  if (C.lights_fragment_maps.includes(from)) {
    C.lights_fragment_maps = C.lights_fragment_maps.replace(from, `#if NUM_LIGHT_PROBE_GRIDS > 0
			if ( probeGrid < 0 ) iblIrradiance += getIBLIrradiance( geometryNormal );
		#else
			${from}
		#endif`);
  }
}

export function createProbeVolume({ renderer, scene, box, res = [4, 3, 8], faceSize = 12, obstacles = () => [] }) {
  patchProbeChunks();
  const [nx, ny, nz] = res;
  const N = nx * ny * nz;
  const S = faceSize;
  const grid = new ProbeGrid();
  grid.name = 'probe-grid';
  grid.boundingBox.copy(box);
  grid.resolution.set(nx, ny, nz);
  scene.add(grid);

  // atlas: probe j occupies row j, faces side by side
  const cols = 6 * S;
  const atlas = new THREE.WebGLRenderTarget(cols, N * S, {
    type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true,
  });
  atlas.texture.name = 'probe-atlas';
  const cam = new THREE.PerspectiveCamera(90, 1, 0.03, 9000);

  // per-texel SH9 basis × solid-angle weight, shared by all probes (CPU projection)
  const T = 6 * S * S;
  const basis = new Float32Array(T * 9);
  let wsum = 0;
  for (let f = 0; f < 6; f++) for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const u = ((px + 0.5) / S) * 2 - 1, v = ((py + 0.5) / S) * 2 - 1;
    const { F, R, U } = FACES[f];
    let x = F.x + u * R.x + v * U.x, y = F.y + u * R.y + v * U.y, z = F.z + u * R.z + v * U.z;
    const l2 = x * x + y * y + z * z, w = 1 / (l2 * Math.sqrt(l2)), il = 1 / Math.sqrt(l2);
    x *= il; y *= il; z *= il;
    const b = ((f * S + py) * S + px) * 9;
    basis[b] = 0.282095 * w; basis[b + 1] = 0.488603 * y * w; basis[b + 2] = 0.488603 * z * w; basis[b + 3] = 0.488603 * x * w;
    basis[b + 4] = 1.092548 * x * y * w; basis[b + 5] = 1.092548 * y * z * w; basis[b + 6] = 0.315392 * (3 * z * z - 1) * w;
    basis[b + 7] = 1.092548 * x * z * w; basis[b + 8] = 0.546274 * (x * x - y * y) * w;
    wsum += w;
  }
  const norm = (4 * Math.PI) / wsum;
  const atlasBuf = new Float32Array(cols * N * S * 4);
  const shBuf = new Float32Array(7 * N * 4);
  const c = new Float32Array(27);
  function projectCPU() {
    for (let j = 0; j < N; j++) {
      c.fill(0);
      for (let f = 0; f < 6; f++) for (let py = 0; py < S; py++) {
        const row = ((j * S + py) * cols + f * S) * 4;
        const bRow = ((f * S + py) * S) * 9;
        for (let px = 0; px < S; px++) {
          const o = row + px * 4;
          const r = Math.min(atlasBuf[o], 64), g = Math.min(atlasBuf[o + 1], 64), bl = Math.min(atlasBuf[o + 2], 64);
          if (!(r + g + bl > 0)) continue; // also skips NaN
          const b = bRow + px * 9;
          for (let k = 0; k < 9; k++) { const w = basis[b + k]; c[k * 3] += r * w; c[k * 3 + 1] += g * w; c[k * 3 + 2] += bl * w; }
        }
      }
      for (let i = 0; i < 27; i++) c[i] *= norm;
      // pack 27 floats into 7 RGBA texels (c0.xyz c1.x | c1.yz c2.xy | c2.z c3.xyz | c4.xyz c5.x | c5.yz c6.xy | c6.z c7.xyz | c8.xyz 0)
      const o = j * 28;
      for (let i = 0; i < 27; i++) shBuf[o + i] = c[i];
      shBuf[o + 27] = 0;
    }
    return shBuf;
  }

  // probe positions (cell centres) + capture positions (nudged out of obstacles)
  const size = box.getSize(new THREE.Vector3());
  const spacing = new THREE.Vector3(size.x / nx, size.y / ny, size.z / nz);
  const gridPos = [];
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    gridPos.push(new THREE.Vector3(box.min.x + (ix + 0.5) * spacing.x, box.min.y + (iy + 0.5) * spacing.y, box.min.z + (iz + 0.5) * spacing.z));
  }
  let capturePos = gridPos.map((p) => p.clone());

  function nudge() {
    const obs = obstacles();
    const m = 0.1;
    capturePos = gridPos.map((p0) => {
      let p = p0.clone();
      for (let it = 0; it < 4; it++) {
        const hit = obs.find((b) => p.x > b.min.x - m && p.x < b.max.x + m && p.y > b.min.y - m && p.y < b.max.y + m && p.z > b.min.z - m && p.z < b.max.z + m);
        if (!hit) break;
        const cands = [
          new THREE.Vector3(p.x, hit.max.y + m + 0.02, p.z),
          new THREE.Vector3(hit.min.x - m - 0.02, p.y, p.z), new THREE.Vector3(hit.max.x + m + 0.02, p.y, p.z),
          new THREE.Vector3(p.x, p.y, hit.min.z - m - 0.02), new THREE.Vector3(p.x, p.y, hit.max.z + m + 0.02),
        ].filter((c) => c.x > box.min.x + 0.12 && c.x < box.max.x - 0.12 && c.y > box.min.y + 0.12 && c.y < box.max.y - 0.12 && c.z > box.min.z + 0.12 && c.z < box.max.z - 0.12);
        if (!cands.length) break;
        cands.sort((a, b) => a.distanceToSquared(p0) - b.distanceToSquared(p0));
        p = cands[0];
      }
      return p;
    });
  }

  // 3D texture (HalfFloat RGBA): x = nx, y = ny, z = 7 blocks of (nz + 2) padded slices
  const depth = 7 * (nz + 2);
  const texData = new Uint16Array(nx * ny * depth * 4);
  const tex = new THREE.Data3DTexture(texData, nx, ny, depth);
  tex.format = THREE.RGBAFormat; tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false; tex.unpackAlignment = 1;
  tex.name = 'probe-sh';

  function upload(buf) {
    const toH = THREE.DataUtils.toHalfFloat;
    for (let k = 0; k < 7; k++) {
      for (let iz = -1; iz <= nz; iz++) {
        const sz = Math.min(nz - 1, Math.max(0, iz));
        const slice = k * (nz + 2) + 1 + iz;
        for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
          const j = (sz * ny + iy) * nx + ix;           // probe index (same order as gridPos)
          const src = j * 28 + k * 4;
          const dst = ((slice * ny + iy) * nx + ix) * 4;
          for (let c = 0; c < 4; c++) texData[dst + c] = toH(buf[src + c]);
        }
      }
    }
    tex.needsUpdate = true;
    grid.texture = tex;
  }

  // async (PBO + fence) readback avoids a pipeline stall on real GPUs; software rasterisers
  // (SwiftShader) reset the context on fence waits, so they read synchronously
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const useAsync = !/swiftshader|llvmpipe|software/i.test(gpuName) && !window.__villarSyncReadback;

  // ---------------------------------------------------------------- progressive bake
  let job = null;
  function renderProbe(j) {
    const p = capturePos[j];
    cam.position.copy(p);
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      cam.up.copy(F.U);
      cam.lookAt(p.x + F.F.x, p.y + F.F.y, p.z + F.F.z);
      cam.updateMatrixWorld();
      atlas.viewport.set(f * S, j * S, S, S);
      atlas.scissor.set(f * S, j * S, S, S);
      atlas.scissorTest = true;
      renderer.setRenderTarget(atlas);
      renderer.render(scene, cam);
    }
  }

  /** Starts (or restarts) a bake. `bounces` ≥ 1. Returns a Promise resolved when uploaded. */
  function bake({ bounces = 2, fresh = true, prepare = () => () => {}, onBounce = () => {} } = {}) {
    if (job) { job.cancelled = true; job.resolve(); }
    nudge();
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    job = { next: 0, bounce: 0, bounces, fresh, prepare, onBounce, resolve, cancelled: false, reading: false };
    return done;
  }

  /**
   * Advance the current bake: at most `maxProbes` probes (GPU work is asynchronous, so a JS time
   * budget alone can queue seconds of GPU work) and at most `budgetMs` of CPU time.
   */
  let perFrame = useAsync ? 3 : 1;
  function step(budgetMs = 8) {
    if (!job || job.reading) return !!job;
    const t0 = performance.now();
    const j0 = job;
    const restore = j0.prepare(j0.bounce);
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    // bounce 0 sees no indirect light (grid hidden); later bounces see the previous result
    const gridVisible = grid.visible;
    if (j0.bounce === 0 && j0.fresh) grid.visible = false;
    try {
      let n = 0;
      while (j0.next < N && n < perFrame && performance.now() - t0 < budgetMs) { renderProbe(j0.next++); n++; }
      // adapt the per-frame count to the CPU cost of a probe (6 scene renders)
      const dt = performance.now() - t0;
      if (useAsync && n === perFrame) perFrame = dt < budgetMs * 0.5 ? Math.min(8, perFrame + 1) : dt > budgetMs * 1.2 ? Math.max(1, perFrame - 1) : perFrame;
    } finally {
      grid.visible = gridVisible;
      atlas.scissorTest = false;
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = prevAuto;
      restore();
    }
    if (j0.next >= N) {
      // async readback of the float atlas, SH9 projection on the CPU
      j0.reading = true;
      const read = (useAsync && renderer.readRenderTargetPixelsAsync)
        ? renderer.readRenderTargetPixelsAsync(atlas, 0, 0, cols, N * S, atlasBuf)
        : new Promise((res) => { renderer.readRenderTargetPixels(atlas, 0, 0, cols, N * S, atlasBuf); res(); });
      read.then(() => {
        if (j0.cancelled) return;
        upload(projectCPU());
        j0.onBounce(j0.bounce);
        j0.bounce++;
        j0.reading = false;
        if (j0.bounce >= j0.bounces) { job = null; j0.resolve(); }
        else j0.next = 0;
      }).catch((e) => { console.warn('[villar] probe readback failed', e); if (job === j0) job = null; j0.resolve(); });
    }
    return true;
  }

  return {
    grid, bake, step,
    get baking() { return !!job; },
    get count() { return N; },
    setEnabled(v) { grid.visible = v; },
    debugPositions: () => ({ grid: gridPos, capture: capturePos }),
    dispose() {
      if (job) job.cancelled = true;
      scene.remove(grid);
      atlas.dispose(); tex.dispose();
    },
  };
}
