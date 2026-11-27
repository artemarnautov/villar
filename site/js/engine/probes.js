// Villar engine — baked irradiance volume (spatially varying GI for the raster path). Owner: engine.
//
// three r187's WebGLRenderer natively shades `isLightProbeGrid` objects (SH9 per cell, 3D atlas) but
// the helper class isn't vendored, so we build the grid ourselves:
//   1. cube faces (12²) are rendered at every *valid* probe into a HalfFloat atlas (RGBA16F is
//      renderable + blendable with EXT_color_buffer_float alone — no EXT_float_blend, i.e. iOS-safe),
//   2. the atlas is copied to a Float32 target (no blending involved) and read back
//      (async PBO on GPUs, per-probe strips on software rasterisers),
//   3. SH9 is projected on the CPU, invalid probes are dilated from valid neighbours, and the
//      result goes into the HalfFloat Data3DTexture layout the renderer expects (7 RGBA texels per
//      probe; the spare 28th float stores the probe's validity).
//   4. A global chunk patch replaces three's plain trilinear lookup with 8 manual corner fetches
//      weighted by trilinear × validity × a DDGI-style back-face term, so light no longer bleeds
//      through partitions, built-ins or from probes buried in furniture.
// The grid object is *always* in the scene (never toggled) so program keys never change: before the
// first bake it carries a constant ambient SH, during the first bounce a zero SH. Baking is
// progressive, supports dirty subsets and never throws into the caller.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

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
    this.isLight = true;           // collected with the lights by the renderer
    this.isLightProbeGrid = true;
    this.type = 'LightProbeGrid';
    this.texture = null;
    this.boundingBox = new THREE.Box3();
    this.resolution = new THREE.Vector3(1, 1, 1);
    this.priority = 0;
    this.castShadow = false;
  }
}

// ----------------------------------------------------------------------------- shader patches
let patched = false;
export function patchProbeChunks() {
  if (patched) return; patched = true;
  const C = THREE.ShaderChunk;
  // 0. one non-finite pixel (a degenerate tangent frame, an overflowing emitter) must never reach the room
  //    capture: the PMREM spreads it to every material, then the probes, then the whole frame (black canvas,
  //    27 Nov). Exponent-bit test: survives fast-math compilers that fold isnan() away
  const OUT = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
  if (C.opaque_fragment.includes(OUT) && !C.opaque_fragment.includes('villarFinite')) {
    C.opaque_fragment = C.opaque_fragment.replace(OUT, `bvec3 villarFinite = lessThan( floatBitsToUint( outgoingLight ) & 0x7f800000u, uvec3( 0x7f800000u ) );
if ( ! all( villarFinite ) ) outgoingLight = vec3( 0.0 );
${OUT}`);
  }
  // 1. inside a probe grid the PMREM environment only provides reflections (no double diffuse)
  const from = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
  if (C.lights_fragment_maps.includes(from)) {
    C.lights_fragment_maps = C.lights_fragment_maps.replace(from, `#if NUM_LIGHT_PROBE_GRIDS > 0
			if ( probeGrid < 0 ) iblIrradiance += getIBLIrradiance( geometryNormal );
		#else
			${from}
		#endif`);
  }
  // 2. weighted 8-corner lookup (validity × back-face × trilinear) instead of hardware trilinear
  const src = C.lightprobes_pars_fragment;
  const start = src.indexOf('vec3 getLightProbeGridIrradiance(');
  const end = src.lastIndexOf('#endif');
  if (start < 0 || end < start) return;
  C.lightprobes_pars_fragment = src.slice(0, start) + /* glsl */`
vec3 villarSHIrradiance( vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec3 c5, vec3 c6, vec3 c7, vec3 c8, vec3 n ) {
	float x = n.x, y = n.y, z = n.z;
	vec3 r = c0 * 0.886227;
	r += c1 * 2.0 * 0.511664 * y;
	r += c2 * 2.0 * 0.511664 * z;
	r += c3 * 2.0 * 0.511664 * x;
	r += c4 * 2.0 * 0.429043 * x * y;
	r += c5 * 2.0 * 0.429043 * y * z;
	r += c6 * ( 0.743125 * z * z - 0.247708 );
	r += c7 * 2.0 * 0.429043 * x * z;
	r += c8 * 0.429043 * ( x * x - y * y );
	return max( r, vec3( 0.0 ) );
}
#ifdef VILLAR_SSAO
// furniture footprint at a world point: x = blurred occupancy, y = height of what stands there (m)
vec2 villarFootAt( vec3 p ) {
	if ( villarFootK <= 0.0 ) return vec2( 0.0 );
	vec2 uv = ( p.xz - villarFootBox.xy ) / villarFootBox.zw;
	if ( any( lessThan( uv, vec2( 0.0 ) ) ) || any( greaterThan( uv, vec2( 1.0 ) ) ) ) return vec2( 0.0 );
	vec2 f = texture2D( villarFoot, uv ).rg;
	return vec2( f.r, f.g * 3.0 );
}
// contact occlusion of the indirect light: the floor around and under furniture, and the low, side- or
// down-facing faces next to it (bed base, sofa plinth, wall behind a sideboard); faces higher up or facing
// up stay open (a seat, a table top). The probe grid alone leaves these zones ~1 EV too bright (R4 A/B)
float villarContact( vec3 p, vec3 n, vec2 f ) {
	float h = max( 0.2, f.y );
	float floorK = 1.0 - smoothstep( 0.02, 0.12, p.y );
	float sideK = ( 1.0 - smoothstep( 0.0, h * 0.8, p.y ) ) * ( 1.0 - max( n.y, 0.0 ) );
	return 1.0 - villarFootK * f.x * max( floorK, sideK );
}
#endif
vec3 getLightProbeGridIrradiance( highp sampler3D probesSH, vec3 probesMin, vec3 probesMax, vec3 probesResolution, vec3 worldPos, vec3 worldNormal ) {
	#ifdef VILLAR_SSAO
		vec2 villarF = villarFootAt( worldPos );
		// inside / next to furniture, invalid (buried) probes keep more weight: their dilated SH is closer to the
		// truth there than a lone valid probe across the bed (the dark blotch on the bed base, R4-09)
		float villarInvalid = mix( 0.25, 0.6, villarF.x );
	#else
		float villarInvalid = 0.25;
	#endif
	ivec3 res = ivec3( probesResolution + 0.5 );
	vec3 spacing = ( probesMax - probesMin ) / probesResolution;
	vec3 p = worldPos + worldNormal * spacing * 0.45;
	#ifdef VILLAR_PROBE_LIFT
		p.y += VILLAR_PROBE_LIFT; // surfaces below a counter top (sink basin) read the light above it
	#endif
	vec3 g = clamp( ( p - probesMin ) / spacing - 0.5, vec3( 0.0 ), vec3( res - 1 ) );
	ivec3 base = min( ivec3( floor( g ) ), max( res - 2, ivec3( 0 ) ) );
	vec3 f = clamp( g - vec3( base ), 0.0, 1.0 );
	int pad = res.z + 2;
	vec3 s0 = vec3( 0 ), s1 = vec3( 0 ), s2 = vec3( 0 ), s3 = vec3( 0 ), s4 = vec3( 0 ), s5 = vec3( 0 ), s6 = vec3( 0 ), s7 = vec3( 0 ), s8 = vec3( 0 );
	float wsum = 0.0;
	for ( int i = 0; i < 8; i ++ ) {
		ivec3 o = ivec3( i & 1, ( i >> 1 ) & 1, ( i >> 2 ) & 1 );
		ivec3 q = min( base + o, res - 1 );
		vec3 tri = mix( 1.0 - f, f, vec3( o ) );
		float w = tri.x * tri.y * tri.z;
		vec3 dir = probesMin + ( vec3( q ) + 0.5 ) * spacing - worldPos;
		float dl = length( dir );
		float bf = dl > 1e-4 ? ( dot( dir / dl, worldNormal ) + 1.0 ) * 0.5 : 1.0;
		w *= bf * bf + 0.05;
		int zb = q.z + 1;
		vec4 t0 = texelFetch( probesSH, ivec3( q.x, q.y, zb ), 0 );
		vec4 t1 = texelFetch( probesSH, ivec3( q.x, q.y, zb + pad ), 0 );
		vec4 t2 = texelFetch( probesSH, ivec3( q.x, q.y, zb + 2 * pad ), 0 );
		vec4 t3 = texelFetch( probesSH, ivec3( q.x, q.y, zb + 3 * pad ), 0 );
		vec4 t4 = texelFetch( probesSH, ivec3( q.x, q.y, zb + 4 * pad ), 0 );
		vec4 t5 = texelFetch( probesSH, ivec3( q.x, q.y, zb + 5 * pad ), 0 );
		vec4 t6 = texelFetch( probesSH, ivec3( q.x, q.y, zb + 6 * pad ), 0 );
		// soft validity: invalid probes hold dilated SH, so they still count (a hard 0/1 flips layers → seams)
		w *= mix( villarInvalid, 1.0, clamp( t6.w, 0.0, 1.0 ) );
		s0 += w * t0.xyz; s1 += w * vec3( t0.w, t1.xy ); s2 += w * vec3( t1.zw, t2.x ); s3 += w * t2.yzw;
		s4 += w * t3.xyz; s5 += w * vec3( t3.w, t4.xy ); s6 += w * vec3( t4.zw, t5.x ); s7 += w * t5.yzw; s8 += w * t6.xyz;
		wsum += w;
	}
	float iw = 1.0 / max( wsum, 1e-6 );
	vec3 villarE = villarSHIrradiance( s0 * iw, s1 * iw, s2 * iw, s3 * iw, s4 * iw, s5 * iw, s6 * iw, s7 * iw, s8 * iw, worldNormal );
	#ifdef VILLAR_SSAO
		villarE *= villarContact( worldPos, worldNormal, villarF );
	#endif
	return villarE;
}
` + src.slice(end);
}

// ----------------------------------------------------------------------------- volume
export function createProbeVolume({ renderer, scene, box, res = [4, 3, 8], faceSize = 12, obstacles = () => [] }) {
  patchProbeChunks();
  const [nx, ny, nz] = res;
  const N = nx * ny * nz;
  const S = faceSize;
  const cols = 6 * S;
  const grid = new ProbeGrid();
  grid.name = 'probe-grid';
  grid.boundingBox.copy(box);
  grid.resolution.set(nx, ny, nz);
  scene.add(grid);
  // GI capture needs renderable float colour (WebGL2 + EXT_color_buffer_float); no float *blending*
  const supported = renderer.extensions.has('EXT_color_buffer_float');

  // ------------------------------------------------------------------ SH textures
  const depth = 7 * (nz + 2);
  const makeTex = (name) => {
    const t = new THREE.Data3DTexture(new Uint16Array(nx * ny * depth * 4), nx, ny, depth);
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
    t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; // texelFetch only
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false; t.unpackAlignment = 1; t.name = name;
    return t;
  };
  // work: input of the next capture bounce (unblended). display: what materials see (blended).
  const work = makeTex('probe-sh-work'), zero = makeTex('probe-sh-zero'), display = makeTex('probe-sh');
  const H = THREE.DataUtils.toHalfFloat;
  function writeTex(tex, sh /* Float32Array(N*28) */) {
    const d = tex.image.data;
    for (let k = 0; k < 7; k++) {
      for (let iz = -1; iz <= nz; iz++) {
        const sz = Math.min(nz - 1, Math.max(0, iz));
        const slice = k * (nz + 2) + 1 + iz;
        for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
          const j = (sz * ny + iy) * nx + ix;
          const src = j * 28 + k * 4, dst = ((slice * ny + iy) * nx + ix) * 4;
          for (let q = 0; q < 4; q++) { const v = sh[src + q]; d[dst + q] = H(Number.isFinite(v) ? v : 0); }
        }
      }
    }
    tex.needsUpdate = true;
  }
  /** Smooth ambient SH: radiance `up` from above, `down` from below (linear RGB triplets). */
  function constantSH(up, down, out = new Float32Array(N * 28)) {
    for (let j = 0; j < N; j++) {
      const o = j * 28;
      out.fill(0, o, o + 28);
      for (let q = 0; q < 3; q++) out[o + q] = ((up[q] + down[q]) / 2) * 3.5449077;      // c0 = L·Y0·4π
      // c1 (Y axis) lives at floats 3,4,5 (c1.x in texel 0 .w, c1.yz in texel 1 .xy)
      for (let q = 0; q < 3; q++) out[o + 3 + q] = (up[q] - down[q]) * 0.488603 * Math.PI;
      out[o + 27] = 1;                                                                // validity
    }
    return out;
  }
  { const z = new Float32Array(N * 28); for (let j = 0; j < N; j++) z[j * 28 + 27] = 1; writeTex(zero, z); }
  const constSH = constantSH([0.05, 0.05, 0.05], [0.03, 0.03, 0.03]);
  const lastOut = new Float32Array(N * 28);          // last complete bake result (with tail)
  const shown = constSH.slice(), from = new Float32Array(N * 28), to = new Float32Array(N * 28);
  writeTex(display, shown);
  grid.texture = display;
  let hasBaked = false;
  let mode = 'constant';
  let blend = null;
  /** Show `src` on the display texture, blended over `ms` (0 = immediately). */
  function present(src, ms) {
    if (!(ms > 0)) { shown.set(src); writeTex(display, shown); blend = null; return; }
    from.set(shown); to.set(src); blend = { t0: performance.now(), ms };
  }
  /** Per frame: advance a running blend. Returns true while blending. */
  function update(now = performance.now()) {
    if (!blend) return false;
    const t = Math.min(1, Math.max(0, (now - blend.t0) / blend.ms));
    const e = t * t * (3 - 2 * t);
    for (let i = 0; i < shown.length; i++) shown[i] = (i % 28 === 27) ? to[i] : from[i] + (to[i] - from[i]) * e;
    writeTex(display, shown);
    if (t >= 1) blend = null;
    return true;
  }
  /** 'baked' (last bake; falls back to constant) or 'constant'. */
  function setMode(m, { ms = 0 } = {}) {
    mode = m === 'baked' && hasBaked ? 'baked' : 'constant';
    present(mode === 'baked' ? lastOut : constSH, ms);
  }

  // ------------------------------------------------------------------ grid geometry + validity
  const size = box.getSize(new THREE.Vector3());
  const spacing = new THREE.Vector3(size.x / nx, size.y / ny, size.z / nz);
  const gridPos = [];
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    gridPos.push(new THREE.Vector3(box.min.x + (ix + 0.5) * spacing.x, box.min.y + (iy + 0.5) * spacing.y, box.min.z + (iz + 0.5) * spacing.z));
  }
  let valid = new Uint8Array(N).fill(1);
  function classify() {
    const obs = obstacles();
    const m = 0.06;
    valid = new Uint8Array(N);
    for (let j = 0; j < N; j++) {
      const p = gridPos[j];
      valid[j] = obs.some((b) => p.x > b.min.x - m && p.x < b.max.x + m && p.y > b.min.y - m && p.y < b.max.y + m && p.z > b.min.z - m && p.z < b.max.z + m) ? 0 : 1;
    }
  }

  // ------------------------------------------------------------------ capture resources (lazy)
  let atlas = null, floatRT = null, copyQuad = null, cam = null, basis = null, norm = 1;
  let atlasBuf = null, stripBuf = null;
  const shBuf = new Float32Array(N * 28), prevSH = new Float32Array(N * 28), outSH = new Float32Array(N * 28), subSH = new Float32Array(N * 28);
  // first-bounce field (raw SH, direct light only) of the last complete bake: a local re-bake recomputes its
  // probes exactly like a fresh bake (B1 from zero, B2 from the B1 field, same tail), never on top of a
  // converged, tail-extrapolated result — repeated local bakes used to pile up energy (+1 EV, R4-01)
  const firstSH = new Float32Array(N * 28);
  let hasFirst = false;
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const software = /swiftshader|llvmpipe|software/i.test(dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '');
  // async (PBO + fence) readback on GPUs; software rasterisers reset the context on large reads
  const useAsync = !software && !!renderer.readRenderTargetPixelsAsync;

  function ensureResources() {
    if (atlas) return;
    atlas = new THREE.WebGLRenderTarget(cols, N * S, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true });
    atlas.texture.name = 'probe-atlas';
    floatRT = new THREE.WebGLRenderTarget(cols, useAsync ? N * S : S, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false });
    copyQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas.texture }, y0: { value: 0 } },
      vertexShader: 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: 'uniform sampler2D map; uniform float y0; void main() { gl_FragColor = texelFetch( map, ivec2( gl_FragCoord.x, gl_FragCoord.y + y0 ), 0 ); }',
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    }));
    cam = new THREE.PerspectiveCamera(90, 1, 0.03, 9000);
    atlasBuf = new Float32Array(cols * N * S * 4);
    stripBuf = new Float32Array(cols * S * 4);
    basis = new Float32Array(6 * S * S * 9);
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
    norm = (4 * Math.PI) / wsum;
  }

  function copyToFloat(y0, rows) {
    copyQuad.material.uniforms.y0.value = y0;
    floatRT.viewport.set(0, 0, cols, rows); floatRT.scissor.set(0, 0, cols, rows); floatRT.scissorTest = true;
    renderer.setRenderTarget(floatRT);
    copyQuad.render(renderer);
    floatRT.scissorTest = false;
  }

  const cc = new Float32Array(27), acc = new Float32Array(27);
  const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function projectCPU() {
    for (let j = 0; j < N; j++) {
      const o = j * 28;
      if (!valid[j]) { shBuf.fill(0, o, o + 28); continue; }
      cc.fill(0);
      for (let f = 0; f < 6; f++) for (let py = 0; py < S; py++) {
        const row = ((j * S + py) * cols + f * S) * 4, bRow = (f * S + py) * S * 9;
        for (let px = 0; px < S; px++) {
          const q = row + px * 4;
          const r = Math.min(atlasBuf[q], 64), g = Math.min(atlasBuf[q + 1], 64), bl = Math.min(atlasBuf[q + 2], 64);
          if (!(r + g + bl > 0)) continue; // skips zero and NaN
          const b = bRow + px * 9;
          for (let k = 0; k < 9; k++) { const w = basis[b + k]; cc[k * 3] += r * w; cc[k * 3 + 1] += g * w; cc[k * 3 + 2] += bl * w; }
        }
      }
      for (let i = 0; i < 27; i++) shBuf[o + i] = cc[i] * norm;
      shBuf[o + 27] = 1;
    }
    // dilate: invalid probes take the mean of valid 6-neighbours (keeps every fallback path sane)
    const idx = (ix, iy, iz) => (iz * ny + iy) * nx + ix;
    const filled = valid.slice();
    for (let pass = 0; pass < 6; pass++) {
      const next = filled.slice();
      for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
        const j = idx(ix, iy, iz);
        if (filled[j]) continue;
        let n = 0; acc.fill(0);
        for (const [dx, dy, dz] of NB) {
          const X = ix + dx, Y = iy + dy, Z = iz + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
          const k = idx(X, Y, Z);
          if (!filled[k]) continue;
          for (let i = 0; i < 27; i++) acc[i] += shBuf[k * 28 + i];
          n++;
        }
        if (n) { for (let i = 0; i < 27; i++) shBuf[j * 28 + i] = acc[i] / n; next[j] = 1; }
      }
      filled.set(next);
    }
    for (let j = 0; j < N; j++) shBuf[j * 28 + 27] = valid[j] ? 1 : 0;
    return shBuf;
  }

  // Indirect chroma (art direction, R2-02): every bounce off the oak floor multiplies its orange, and a
  // 2-bounce bake of a white room under a sunlit oak floor lands at R/B ≈ 2.3 — physically plausible,
  // photographically wrong (a photographer white-balances it away). Each SH band keeps its luminance and
  // a fraction `chroma` of its colour deviation.
  let chroma = 1;
  // The colour the bounce is pulled toward: the camera's neutral (1 / white-balance gain, luminance 1), so a
  // desaturated bounce renders grey after white balance — not lilac under a 2700 K-balanced camera (R3-01).
  const neutral = [1, 1, 1];
  function desaturate(sh, k) {
    const [nr, ng, nb] = neutral;
    for (let j = 0; j < N; j++) {
      const o = j * 28;
      for (let b = 0; b < 9; b++) {
        const i = o + b * 3, y = 0.2126 * sh[i] + 0.7152 * sh[i + 1] + 0.0722 * sh[i + 2];
        sh[i] = y * nr + (sh[i] - y * nr) * k; sh[i + 1] = y * ng + (sh[i + 1] - y * ng) * k; sh[i + 2] = y * nb + (sh[i + 2] - y * nb) * k;
      }
    }
  }
  /** Sanity: mean DC luminance of valid probes. A zero/NaN bake must never be shown. */
  function healthy(sh) {
    let s = 0, n = 0;
    for (let j = 0; j < N; j++) if (valid[j]) { const o = j * 28; s += 0.2126 * sh[o] + 0.7152 * sh[o + 1] + 0.0722 * sh[o + 2]; n++; }
    return n > 0 && Number.isFinite(s) && s / n > 1e-4;
  }

  // ------------------------------------------------------------------ progressive bake
  let job = null;
  let perFrame = useAsync ? 3 : 1;
  // missing bounces beyond the last one, extrapolated in LUMINANCE only (scaling the last bounce's chroma
  // would multiply the oak-floor colour bleed with every bounce: sepia walls, R2-02)
  let TAIL = 0.35, GAIN = 1;

  function renderProbe(j) {
    const p = gridPos[j];
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
    atlas.scissorTest = false;
  }

  /**
   * Starts (or restarts) a bake. `fresh`: the first bounce sees no indirect light (zero SH) and the
   * last bounce is extrapolated over the missing ones; otherwise the current grid feeds one
   * incremental bounce. `only`: probe indices to recapture (dirty subset, incremental bakes only).
   * Resolves true when a healthy result was uploaded, false otherwise. Never rejects.
   */
  function bake({ bounces = 2, fresh = true, only = null, prepare = () => () => {}, onBounce = () => {} } = {}) {
    if (job) { job.cancelled = true; job.resolve(false); job = null; }
    if (!supported) return Promise.resolve(false);
    try { ensureResources(); classify(); } catch (e) { console.warn('[villar] GI unavailable', e); return Promise.resolve(false); }
    // subset: incremental (legacy, !fresh) or fresh-equivalent (needs the stored first-bounce field, 2 bounces)
    const useSubset = only && hasBaked && (!fresh || (hasFirst && bounces === 2));
    const list = (useSubset ? [...only] : [...Array(N).keys()]).filter((j) => valid[j]);
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    job = { list, k: 0, bounce: 0, bounces, fresh, prepare, onBounce, resolve, cancelled: false, reading: false, hasWork: false, subset: useSubset ? new Set(only) : null };
    if (!list.length) { job = null; resolve(hasBaked); }
    return done;
  }

  function fail(j0, e) {
    console.warn('[villar] GI bake failed — keeping the previous lighting', e && e.message ? e.message : e);
    j0.cancelled = true;
    if (job === j0) job = null;
    if (hasBaked) writeTex(work, lastOut);
    j0.resolve(false);
  }

  /** Advance the bake; at most `perFrame` probes (GPU work is async) and `budgetMs` of CPU. */
  function step(budgetMs = 8) {
    const j0 = job;
    if (!j0 || j0.reading) return !!j0;
    if (gl.isContextLost()) { fail(j0, new Error('context lost')); return false; }
    const t0 = performance.now();
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    let restore = null;
    try {
      restore = j0.prepare(j0.bounce);
      renderer.shadowMap.autoUpdate = false;
      // bounce 0 of a fresh bake: no indirect light (zero SH — same shader variant, no recompile)
      grid.texture = (j0.bounce === 0 && j0.fresh) ? zero : (j0.hasWork || hasBaked ? work : display);
      let n = 0;
      while (j0.k < j0.list.length && n < perFrame && performance.now() - t0 < budgetMs) {
        const j = j0.list[j0.k++];
        renderProbe(j);
        if (!useAsync) {
          copyToFloat(j * S, S);
          renderer.readRenderTargetPixels(floatRT, 0, 0, cols, S, stripBuf);
          atlasBuf.set(stripBuf, j * S * cols * 4);
        }
        n++;
      }
      const dt = performance.now() - t0;
      if (useAsync && n === perFrame) perFrame = dt < budgetMs * 0.5 ? Math.min(8, perFrame + 1) : dt > budgetMs * 1.2 ? Math.max(1, perFrame - 1) : perFrame;
      if (j0.k >= j0.list.length) {
        j0.reading = true;
        let read = Promise.resolve();
        if (useAsync) {
          copyToFloat(0, N * S);
          read = renderer.readRenderTargetPixelsAsync(floatRT, 0, 0, cols, N * S, atlasBuf);
        }
        read.then(() => {
          if (j0.cancelled) return;
          const sh = projectCPU();
          const last = j0.bounce === j0.bounces - 1;
          if (j0.fresh && j0.bounce === 0) {
            if (j0.subset) {
              // the recaptured probes' first bounce into the stored field; the whole field lights bounce 2
              for (const j of j0.subset) firstSH.set(sh.subarray(j * 28, j * 28 + 28), j * 28);
              sh.set(firstSH);
            } else { firstSH.set(sh); hasFirst = true; }
          }
          if (j0.fresh && j0.bounce >= 1 && last) {
            for (let j = 0; j < N; j++) {
              const o = j * 28;
              const y1 = 0.2126 * sh[o] + 0.7152 * sh[o + 1] + 0.0722 * sh[o + 2];
              const y0 = 0.2126 * prevSH[o] + 0.7152 * prevSH[o + 1] + 0.0722 * prevSH[o + 2];
              const k = y1 > 1e-6 ? 1 + TAIL * Math.max(0, y1 - y0) / y1 : 1;
              for (let i = 0; i < 27; i++) outSH[o + i] = sh[o + i] * k;
              outSH[o + 27] = sh[o + 27];
            }
          } else outSH.set(sh);
          prevSH.set(sh);
          if (chroma < 1) desaturate(outSH, chroma);
          if (GAIN !== 1) for (let j = 0; j < N; j++) for (let i = 0; i < 27; i++) outSH[j * 28 + i] *= GAIN;
          let out = outSH;
          // a fresh-equivalent subset shows the first-bounce FIELD between its bounces (it lights bounce 2);
          // only its final result is merged into the converged grid
          if (j0.subset && (last || !j0.fresh)) {
            // dirty subset: keep every other probe's converged value (incl. its extrapolated tail)
            subSH.set(lastOut);
            for (let j = 0; j < N; j++) if (j0.subset.has(j) || !valid[j]) subSH.set(outSH.subarray(j * 28, j * 28 + 28), j * 28);
            out = subSH;
          }
          if (!healthy(out)) throw new Error('empty SH result');
          writeTex(work, out);
          j0.hasWork = true;
          j0.onBounce(j0.bounce);
          j0.bounce++;
          j0.reading = false;
          if (j0.bounce >= j0.bounces) {
            lastOut.set(out);
            hasBaked = true;
            if (job === j0) job = null;
            j0.resolve(true);
          } else j0.k = 0;
        }).catch((e) => fail(j0, e));
      }
    } catch (e) {
      fail(j0, e);
    } finally {
      grid.texture = display;
      if (atlas) atlas.scissorTest = false;
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = prevAuto;
      try { if (restore) restore(); } catch { /* ignore */ }
    }
    return !!job;
  }

  /** Probe indices whose cell centre lies within `margin` of a world box (dirty set). */
  function near(box3, margin = 1.4) {
    const b = box3.clone().expandByScalar(margin);
    const out = [];
    for (let j = 0; j < N; j++) if (b.containsPoint(gridPos[j])) out.push(j);
    return out;
  }

  return {
    grid, bake, step, near, setMode, update,
    /** Set the constant (pre-bake / dollhouse) ambient; shown at once if in constant mode. */
    setConstant(up, down, { ms = 0 } = {}) { constantSH(up, down, constSH); if (mode === 'constant') present(constSH, ms); },
    get mode() { return mode; },
    get blending() { return !!blend; },
    get supported() { return supported; },
    get hasBaked() { return hasBaked; },
    get baking() { return !!job; },
    get progress() { return job ? Math.min(1, (job.bounce + job.k / Math.max(1, job.list.length)) / job.bounces) : 1; },
    get count() { return N; },
    /** Fraction of the bounce light's colour that is kept (1 = physical). Applies from the next bake. */
    /** `white`: the camera's neutral as linear RGB (1 / WB gain); the bounce desaturates toward it. */
    setChroma(k, white = null) {
      chroma = Math.max(0, Math.min(1, k));
      if (white) {
        const l = 0.2126 * white[0] + 0.7152 * white[1] + 0.0722 * white[2];
        if (l > 0) { neutral[0] = white[0] / l; neutral[1] = white[1] / l; neutral[2] = white[2] / l; }
      } else { neutral[0] = neutral[1] = neutral[2] = 1; }
    },
    /** Missing-bounce extrapolation (luminance) and an overall indirect gain (evening pools, R2-09). */
    setTail(k) { TAIL = Math.max(0, k); },
    setGain(g) { GAIN = Math.max(0, g); },
    /** A bake is waiting for its GPU readback (progress does not move meanwhile — not a stall). */
    get reading() { return !!(job && job.reading); },
    /** Copy of the last converged result (for a per-(style, time) cache). */
    snapshot() { if (!hasBaked) return null; const a = lastOut.slice(); if (hasFirst) a.first = firstSH.slice(); return a; },
    /** Show a cached converged result (blended) and use it as the base for later incremental bakes. */
    load(sh, { ms = 400 } = {}) {
      if (!sh || sh.length !== lastOut.length) return false;
      if (job) { job.cancelled = true; job.resolve(false); job = null; }
      lastOut.set(sh); hasBaked = true; writeTex(work, lastOut);
      if (sh.first && sh.first.length === firstSH.length) { firstSH.set(sh.first); hasFirst = true; } else hasFirst = false;
      mode = 'baked'; present(lastOut, ms);
      return true;
    },
    /** Debug: per-probe validity + DC luminance of the last bake and of what is displayed. */
    dump() {
      const Y = (a, j) => 0.2126 * a[j * 28] + 0.7152 * a[j * 28 + 1] + 0.0722 * a[j * 28 + 2];
      const out = [];
      for (let j = 0; j < N; j++) out.push([gridPos[j].toArray().map((v) => +v.toFixed(2)), valid[j], +Y(lastOut, j).toFixed(3), +Y(shown, j).toFixed(3), +shown[j * 28 + 27].toFixed(2)]);
      return { res: [nx, ny, nz], mode, hasBaked, probes: out };
    },
    /** After a context restore the GPU copies are gone: re-upload CPU data, recreate capture targets. */
    onContextRestored() {
      if (job) { job.cancelled = true; job.resolve(false); job = null; }
      for (const t of [work, zero, display]) t.needsUpdate = true;
      atlas = null; floatRT = null; copyQuad = null; // GL objects of the dead context: drop, don't dispose
      hasBaked = false; blend = null; setMode('constant');
    },
    cancel() { if (job) { job.cancelled = true; job.resolve(false); job = null; } },
    dispose() {
      if (job) { job.cancelled = true; job.resolve(false); job = null; }
      scene.remove(grid);
      atlas?.dispose(); floatRT?.dispose(); copyQuad?.material?.dispose(); copyQuad?.dispose();
      work.dispose(); zero.dispose(); display.dispose();
    },
  };
}
