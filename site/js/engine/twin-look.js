// Villar engine — per-twin look pass (eng-8): small, data-driven corrections a reconstructed GLB may need before it
// stands in the room. Owner: engine. Driven by the twin's manifest entry (`look`, site/data/twins.json) or the lab.
//
//   look: {
//     rules: [{                      up to 3 albedo corrections, each under its own mask
//       key: "#a3653a",              reference colour of the surface to change (sRGB); the shift is relative to it
//       tol: 0.12,                   colour-key tolerance (HSV distance); 0 = no colour mask (band / rough only)
//       band: [0, 0.32],             optional height band (0 = floor, 1 = top of the twin): the frame, the legs…
//       rough: [0.5, 1],             optional roughness-map range (wood vs leather when the atlas tells them apart)
//       to: "#5e4230",               target swatch: hue moves by to − key, saturation and value scale by to / key
//       amount: 1,                   0…1
//       roughMul: 1                  roughness × this under the mask
//     }],
//     rough: { mul: 1, min: 0, max: 1 },   whole-twin roughness override
//     spec: 0.6,                     dielectric specular strength (MeshPhysical specularIntensity; null = keep)
//     seam: {                        view-projection seam fix, baked into vertex colours (gains, mean 1)
//       mode: "mirror",              "mirror": furniture is left–right symmetric, so each point is matched in
//                                     brightness with its mirror image across the plane (a view seam down the middle
//                                     of the seat: the lighter half comes down, the darker up, only where they differ)
//                                     — "level": low-frequency levelling toward the mean (broad blotches)
//       axis: "x", at: 0.5,          the mirror plane: axis of the twin (front = +Z), position as a fraction of its bounds
//       res: 0.03,                   "mirror": size of the brightness cells compared (m; texture detail below it is kept)
//       radius: 0.15,                "level": radius of the low-frequency field (m)
//       band: [0.3, 0.7], key, tol,  optional: only this height band / colour / roughness-map range is corrected
//       rough: [0, 0.5], max: 0.25   (max = the largest gain, ±25 %)
//     }
//   }
//
// The colour rules run in the fragment shader (uniforms: the lab tunes them live; defines only change with the
// rule count). Masks use the RAW texture colour, before the seam gains. Everything is idempotent per material /
// geometry (instances of one twin share both).
import * as THREE from 'three';

export const MAX_RULES = 3;
const NONE = -1;

// ---------------------------------------------------------------- colour helpers (sRGB 0…1, HSV in 0…1)
const srgbOf = (hex) => { const c = new THREE.Color(); c.setStyle(hex, THREE.SRGBColorSpace); const o = {}; c.getRGB(o, THREE.SRGBColorSpace); return [o.r, o.g, o.b]; };
export function rgbToHSV([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h / 6 + 1) % 1;
  return [h, mx > 0 ? d / mx : 0, mx];
}
export function hsvDistance(a, k) {
  let dh = Math.abs(a[0] - k[0]); dh = Math.min(dh, 1 - dh) * 2;
  dh *= Math.min(1, Math.min(a[1], k[1]) * 3);
  return Math.hypot(dh, a[1] - k[1], 0.5 * (a[2] - k[2]));
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6))); return t * t * (3 - 2 * t); };
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** Normalise a manifest / lab `look` block (unknown fields dropped, numbers clamped). */
export function normaliseLook(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const pair = (v, lo, hi) => (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(Number(x))) ? [num(v[0], lo, lo, hi), num(v[1], hi, lo, hi)].sort((a, b) => a - b) : null);
  const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).slice(0, MAX_RULES).map((r) => ({
    key: hex(r?.key), to: hex(r?.to), tol: num(r?.tol, 0.12, 0, 1), band: pair(r?.band, 0, 1), rough: pair(r?.rough, 0, 1),
    amount: num(r?.amount, 1, 0, 1), roughMul: num(r?.roughMul, 1, 0.2, 4),
  })).filter((r) => r.key && (r.to || r.roughMul !== 1));
  const rough = raw.rough && typeof raw.rough === 'object' ? { mul: num(raw.rough.mul, 1, 0.2, 4), min: num(raw.rough.min, 0, 0, 1), max: num(raw.rough.max, 1, 0, 1) } : null;
  const spec = raw.spec === null || raw.spec === undefined ? null : num(raw.spec, null, 0, 1);
  let seam = null;
  if (raw.seam && typeof raw.seam === 'object' && (raw.seam.mode === 'mirror' || raw.seam.mode === 'level')) {
    const s = raw.seam;
    seam = {
      mode: s.mode, axis: ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'x', at: num(s.at, 0.5, 0, 1),
      res: num(s.res, 0.03, 0.01, 0.2), radius: num(s.radius, 0.15, 0.03, 1),
      band: pair(s.band, 0, 1), rough: pair(s.rough, 0, 1), key: hex(s.key), tol: num(s.tol, 0, 0, 1), max: num(s.max, 0.25, 0.02, 0.6),
    };
  }
  if (!rules.length && !rough && spec === null && !seam) return null;
  return { rules, rough, spec, seam };
}
/** Stable JSON of a normalised look (manifest / URL / cache keys). */
export function lookJSON(look) { return look ? JSON.stringify(look) : ''; }

// ---------------------------------------------------------------- shader
const PARS = /* glsl */`
#ifdef TWIN_LOOK
varying float vTwinH;
uniform vec3 twinKey[ TWIN_LOOK_RULES ];
uniform vec3 twinTo[ TWIN_LOOK_RULES ];
uniform vec4 twinBand[ TWIN_LOOK_RULES ];
uniform vec3 twinRR[ TWIN_LOOK_RULES ];
uniform vec3 twinOpt[ TWIN_LOOK_RULES ];   // tol, amount, roughMul
uniform vec3 twinRough;                     // mul, min, max
uniform float twinPreview;
vec3 twinSRGB( vec3 c ) { c = max( c, vec3( 0.0 ) ); return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) ); }
vec3 twinLin( vec3 c ) { return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) ); }
vec3 twinHSV( vec3 c ) {
	vec4 K = vec4( 0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0 );
	vec4 p = mix( vec4( c.bg, K.wz ), vec4( c.gb, K.xy ), step( c.b, c.g ) );
	vec4 q = mix( vec4( p.xyw, c.r ), vec4( c.r, p.yzx ), step( p.x, c.r ) );
	float d = q.x - min( q.w, q.y );
	return vec3( abs( q.z + ( q.w - q.y ) / ( 6.0 * d + 1e-10 ) ), d / ( q.x + 1e-10 ), q.x );
}
vec3 twinRGB( vec3 c ) {
	vec3 p = abs( fract( c.xxx + vec3( 1.0, 2.0 / 3.0, 1.0 / 3.0 ) ) * 6.0 - 3.0 );
	return c.z * mix( vec3( 1.0 ), clamp( p - 1.0, 0.0, 1.0 ), c.y );
}
#endif
`;
const FRAG = /* glsl */`
#ifdef TWIN_LOOK
	float twinM[ TWIN_LOOK_RULES ];
	{
		float twinRt = 1.0;
		#ifdef USE_ROUGHNESSMAP
			twinRt = texture2D( roughnessMap, vRoughnessMapUv ).g;
		#endif
		vec3 twinS = twinSRGB( diffuseColor.rgb );
		vec3 twinH0 = twinHSV( twinS );
		vec3 twinOut = diffuseColor.rgb;
		for ( int i = 0; i < TWIN_LOOK_RULES; i ++ ) {
			vec3 k = twinKey[ i ];
			float tol = twinOpt[ i ].x;
			float m = 1.0;
			if ( tol > 0.0 ) {
				float dh = abs( twinH0.x - k.x ); dh = min( dh, 1.0 - dh ) * 2.0;
				dh *= clamp( min( twinH0.y, k.y ) * 3.0, 0.0, 1.0 );
				float d = length( vec3( dh, twinH0.y - k.y, 0.5 * ( twinH0.z - k.z ) ) );
				m = 1.0 - smoothstep( tol, tol * 1.6 + 1e-4, d );
			}
			vec4 b = twinBand[ i ];
			if ( b.w > 0.5 ) m *= smoothstep( b.x - b.z, b.x + b.z, vTwinH ) * ( 1.0 - smoothstep( b.y - b.z, b.y + b.z, vTwinH ) );
			vec3 rr = twinRR[ i ];
			if ( rr.z > 0.5 ) m *= smoothstep( rr.x - 0.03, rr.x + 0.03, twinRt ) * ( 1.0 - smoothstep( rr.y - 0.03, rr.y + 0.03, twinRt ) );
			m *= twinOpt[ i ].y;
			twinM[ i ] = m;
			vec3 t = twinTo[ i ];
			if ( t.z >= 0.0 && m > 0.0 ) {
				vec3 h2 = vec3( fract( twinH0.x + t.x - k.x + 1.0 ), clamp( twinH0.y * t.y / max( k.y, 1e-3 ), 0.0, 1.0 ), clamp( twinH0.z * t.z / max( k.z, 1e-3 ), 0.0, 1.0 ) );
				twinOut = mix( twinOut, twinLin( twinRGB( h2 ) ), m );
			}
			if ( abs( twinPreview - float( i ) ) < 0.5 ) twinOut = mix( twinOut, vec3( 0.6, 0.0, 0.6 ), m * 0.85 );
		}
		diffuseColor.rgb = twinOut;
	}
#endif
`;
const ROUGH = /* glsl */`
#ifdef TWIN_LOOK
	for ( int i = 0; i < TWIN_LOOK_RULES; i ++ ) roughnessFactor *= mix( 1.0, twinOpt[ i ].z, twinM[ i ] );
	roughnessFactor = clamp( roughnessFactor * twinRough.x, twinRough.y, twinRough.z );
#endif
`;

function makeUniforms() {
  const arr = (f) => Array.from({ length: MAX_RULES }, f);
  return {
    twinKey: { value: arr(() => new THREE.Vector3()) }, twinTo: { value: arr(() => new THREE.Vector3(0, 0, -1)) },
    twinBand: { value: arr(() => new THREE.Vector4()) }, twinRR: { value: arr(() => new THREE.Vector3()) },
    twinOpt: { value: arr(() => new THREE.Vector3(0, 0, 1)) }, twinRough: { value: new THREE.Vector3(1, 0, 1) },
    twinPreview: { value: NONE },
  };
}
function setUniforms(U, look) {
  const rules = look?.rules || [];
  for (let i = 0; i < MAX_RULES; i++) {
    const r = rules[i];
    if (!r) { U.twinOpt.value[i].set(0, 0, 1); U.twinTo.value[i].set(0, 0, -1); U.twinBand.value[i].set(0, 1, 0, 0); U.twinRR.value[i].set(0, 1, 0); continue; }
    U.twinKey.value[i].fromArray(rgbToHSV(srgbOf(r.key)));
    if (r.to) U.twinTo.value[i].fromArray(rgbToHSV(srgbOf(r.to))); else U.twinTo.value[i].set(0, 0, -1);
    U.twinBand.value[i].set(r.band ? r.band[0] : 0, r.band ? r.band[1] : 1, 0.02, r.band ? 1 : 0);
    U.twinRR.value[i].set(r.rough ? r.rough[0] : 0, r.rough ? r.rough[1] : 1, r.rough ? 1 : 0);
    U.twinOpt.value[i].set(r.tol, r.amount, r.roughMul);
  }
  const R = look?.rough;
  U.twinRough.value.set(R ? R.mul : 1, R ? R.min : 0, R ? R.max : 1);
}

/**
 * (Re)install the look's shader patch on a material that carries `userData.twinLook` (idempotent; chains with the
 * SSAO patch in either order). The fader's dissolve clones call this too, so a fading twin keeps its look.
 */
export function installLook(m) {
  const L = m?.userData?.twinLook;
  if (!L || !m.isMeshStandardMaterial) return;
  const n = String(Math.max(1, L.n));
  if (!m.defines || m.defines.TWIN_LOOK === undefined || m.defines.TWIN_LOOK_RULES !== n) {
    m.defines = { ...(m.defines || {}), TWIN_LOOK: '', TWIN_LOOK_RULES: n };
    m.needsUpdate = true;
  }
  if (m.onBeforeCompile?.twinLook) return;
  const prev = m.onBeforeCompile;
  const fn = function (shader, renderer) {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(this, shader, renderer);
    const U = this.userData?.twinLook?.uniforms;
    if (!U) return;
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#ifdef TWIN_LOOK\nattribute float twinH;\nvarying float vTwinH;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef TWIN_LOOK\n\tvTwinH = twinH;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH}`);
  };
  fn.twinLook = true;
  fn.villarSSAO = !!prev?.villarSSAO;
  m.onBeforeCompile = fn;
  m.needsUpdate = true;
}

// ---------------------------------------------------------------- CPU side: texture reads, vertex data
const pixelCache = new WeakMap(); // texture Source → { [cap]: { w, h, data, flipY } }
/** The pixels of a texture (≤ cap px), for picking and the seam statistics. null when unreadable. */
export function readTexture(tex, cap = 1024) {
  const src = tex?.source;
  if (!src?.data) return null;
  let bucket = pixelCache.get(src);
  if (bucket?.[cap]) return bucket[cap];
  const img = src.data, w0 = img.width || img.naturalWidth || 0, h0 = img.height || img.naturalHeight || 0;
  if (!w0 || !h0 || typeof document === 'undefined') return null;
  const k = Math.min(1, cap / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  try {
    const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const out = { w, h, data: g.getImageData(0, 0, w, h).data, flipY: !!tex.flipY };
    if (!bucket) { bucket = {}; pixelCache.set(src, bucket); }
    bucket[cap] = out;
    return out;
  } catch { return null; }
}
/** sRGB 0…1 texel at a uv (wrapping), honouring the texture's flipY. */
export function sampleTexture(px, u, v) {
  if (!px) return null;
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(px.w - 1, Math.floor(u * px.w)), y = Math.min(px.h - 1, Math.floor((px.flipY ? 1 - v : v) * px.h));
  const o = (y * px.w + x) * 4;
  return [px.data[o] / 255, px.data[o + 1] / 255, px.data[o + 2] / 255];
}

const meshesOf = (root) => { const out = []; root.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position && !o.userData.fadePre) out.push(o); }); return out; };

/** Per vertex: position in the twin's space and normalised height (the band masks). */
function vertexData(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4(), v = new THREE.Vector3();
  const b = root.userData.bounds;
  const y0 = b ? b.min[1] : 0, H = b ? Math.max(1e-6, b.max[1] - b.min[1]) : 1;
  const list = [];
  for (const o of meshesOf(root)) {
    const g = o.geometry, pos = g.attributes.position;
    M.multiplyMatrices(inv, o.matrixWorld);
    const P = new Float32Array(pos.count * 3), Hh = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      Hh[i] = (v.y - y0) / H;
    }
    list.push({ mesh: o, geometry: g, P, H: Hh, y0, Hspan: H });
  }
  return list;
}

/** CPU twin of the shader's mask (seam statistics use the same rules). */
function maskOf(sel, hsv, h, rt) {
  let m = 1;
  if (sel.key && sel.tol > 0) { const d = hsvDistance(hsv, sel.keyHSV); m = 1 - smoothstep(sel.tol, sel.tol * 1.6 + 1e-4, d); }
  if (sel.band) m *= smoothstep(sel.band[0] - 0.02, sel.band[0] + 0.02, h) * (1 - smoothstep(sel.band[1] - 0.02, sel.band[1] + 0.02, h));
  if (sel.rough) m *= smoothstep(sel.rough[0] - 0.03, sel.rough[0] + 0.03, rt) * (1 - smoothstep(sel.rough[1] - 0.03, sel.rough[1] + 0.03, rt));
  return m;
}

const S2L = Float32Array.from({ length: 256 }, (_, i) => toLin(i / 255));
const L2S = (() => { const t = new Uint8Array(4096); for (let i = 0; i < 4096; i++) { const v = i / 4095; t[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); } return t; })();
/** Cooperative slicing: awaits a macrotask once `budget` ms of main-thread work have passed (no long frames). */
function yielder(budget = 8) {
  let t = performance.now();
  return async () => {
    if (performance.now() - t < budget) return;
    await new Promise((r) => setTimeout(r, 0));
    t = performance.now();
  };
}
const CELL_KEY = (cx, cy, cz) => ((cx + 512) * 1024 + (cy + 512)) * 1024 + (cz + 512);

/**
 * Seam fix in TEXTURE space. A view-projection seam is a sharp step inside triangles (gains per vertex leave a
 * line), so every texel of the albedo atlas gets its 3D position by rasterising the triangles in UV space
 * (≤ 512 px), brightness is compared in 3D cells, and a gain map — smooth on each side, sharp at the mirror
 * plane — multiplies the full-resolution albedo, which replaces the material's map (the original is kept only
 * for the lab, to re-apply other settings).
 */
async function seamTexture(root, list, seam, { keepOriginal = false, alive = () => true } = {}) {
  const t0 = performance.now();
  const tick = yielder(8);
  let work = 0;
  const key = JSON.stringify(seam);
  const report = { mode: seam.mode, maps: 0 };
  const b = root.userData.bounds, ax = { x: 0, y: 1, z: 2 }[seam.axis];
  const lo = b ? b.min[ax] : -0.5, hi = b ? b.max[ax] : 0.5, plane = lo + (hi - lo) * seam.at;
  const sel = { key: seam.key, keyHSV: seam.key ? rgbToHSV(srgbOf(seam.key)) : null, tol: seam.tol, band: seam.band, rough: seam.rough || null };
  // meshes by albedo map
  const byMap = new Map();
  for (const e of list) for (const m of Array.isArray(e.mesh.material) ? e.mesh.material : [e.mesh.material]) {
    if (!m?.map || !e.geometry.attributes.uv) continue;
    let r = byMap.get(m.map); if (!r) { r = { mats: new Set(), parts: [] }; byMap.set(m.map, r); }
    r.mats.add(m); if (!r.parts.includes(e)) r.parts.push(e);
  }
  const clampG = (g) => Math.min(1 + seam.max, Math.max(1 / (1 + seam.max), g));
  for (const [M, rec] of byMap) {
    if (M.userData?.twinSeamKey === key) { report.maps++; report.cached = true; continue; }
    const orig = M.userData?.twinOrig || M;
    const px = readTexture(orig, 512);
    if (!px) { report.skipped = 'texture not readable'; continue; }
    const rough = readTexture([...rec.mats][0].roughnessMap, 512);
    const W = px.w, Hh = px.h, N = W * Hh;
    // 1. UV raster: texel → 3D position (NaN = not on the surface)
    const pos = new Float32Array(N * 3).fill(NaN);
    for (const e of rec.parts) {
      const uv = e.geometry.attributes.uv, idx = e.geometry.index, n = idx ? idx.count : uv.count;
      for (let t = 0; t + 2 < n; t += 3) {
        if ((t & 1023) === 0) { await tick(); if (!alive()) return { aborted: true }; }
        const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
        const X = [uv.getX(ia) * W - 0.5, uv.getX(ib) * W - 0.5, uv.getX(ic) * W - 0.5];
        const Y = [(px.flipY ? 1 - uv.getY(ia) : uv.getY(ia)) * Hh - 0.5, (px.flipY ? 1 - uv.getY(ib) : uv.getY(ib)) * Hh - 0.5, (px.flipY ? 1 - uv.getY(ic) : uv.getY(ic)) * Hh - 0.5];
        const x0 = Math.max(0, Math.floor(Math.min(...X))), x1 = Math.min(W - 1, Math.ceil(Math.max(...X)));
        const y0 = Math.max(0, Math.floor(Math.min(...Y))), y1 = Math.min(Hh - 1, Math.ceil(Math.max(...Y)));
        const den = (Y[1] - Y[2]) * (X[0] - X[2]) + (X[2] - X[1]) * (Y[0] - Y[2]);
        if (!(Math.abs(den) > 1e-12) || x1 - x0 > W / 2 || y1 - y0 > Hh / 2) continue;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const w0 = ((Y[1] - Y[2]) * (x - X[2]) + (X[2] - X[1]) * (y - Y[2])) / den;
          const w1 = ((Y[2] - Y[0]) * (x - X[2]) + (X[0] - X[2]) * (y - Y[2])) / den;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
          const o = (y * W + x) * 3;
          for (let c = 0; c < 3; c++) pos[o + c] = w0 * e.P[ia * 3 + c] + w1 * e.P[ib * 3 + c] + w2 * e.P[ic * 3 + c];
        }
      }
    }
    // 2. texel luminance + mask; 3D cells (the mirror grid has a boundary ON the plane: no cell straddles it)
    const y0w = list[0]?.y0 ?? 0, Hw = list[0]?.Hspan ?? 1;
    const cell = seam.mode === 'mirror' ? seam.res : seam.radius * 0.75;
    const ci = (p, a) => (seam.mode === 'mirror' && a === ax ? Math.floor((p - plane) / cell) : Math.floor(p / cell));
    const lum = new Float32Array(N), mask = new Float32Array(N), cells = new Map();
    let sLo = 0, wLo = 0, sHi = 0, wHi = 0, covered = 0;
    for (let i = 0; i < N; i++) {
      if ((i & 16383) === 0) { await tick(); if (!alive()) return { aborted: true }; }
      const x = pos[i * 3]; if (Number.isNaN(x)) continue;
      covered++;
      const y = pos[i * 3 + 1], z = pos[i * 3 + 2], o = i * 4;
      const r8 = px.data[o], g8 = px.data[o + 1], b8 = px.data[o + 2];
      lum[i] = 0.2126 * S2L[r8] + 0.7152 * S2L[g8] + 0.0722 * S2L[b8];
      const m = maskOf(sel, rgbToHSV([r8 / 255, g8 / 255, b8 / 255]), (y - y0w) / Hw, rough ? rough.data[o + 1] / 255 : 1);
      mask[i] = m;
      if (m < 0.5) continue;
      const p = [x, y, z], k = CELL_KEY(ci(x, 0), ci(y, 1), ci(z, 2));
      let c = cells.get(k); if (!c) { c = { s: 0, w: 0 }; cells.set(k, c); }
      c.s += lum[i]; c.w += 1;
      if (p[ax] < plane) { sLo += lum[i]; wLo++; } else { sHi += lum[i]; wHi++; }
    }
    const meanOf = (cx, cy, cz) => { const c = cells.get(CELL_KEY(cx, cy, cz)); return c && c.w >= 2 ? c.s / c.w : null; };
    // neighbourhood mean, never crossing the plane along the axis (mirror)
    const near = (q) => {
      let s = 0, w = 0;
      for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) for (let c = -1; c <= 1; c++) {
        const r = [q[0] + a, q[1] + bb, q[2] + c];
        if (seam.mode === 'mirror' && (r[ax] < 0) !== (q[ax] < 0)) continue;
        const v = meanOf(r[0], r[1], r[2]); if (v === null) continue;
        const wt = a === 0 && bb === 0 && c === 0 ? 4 : 1; s += v * wt; w += wt;
      }
      return w ? s / w : null;
    };
    let gmean = 0, gw = 0; for (const c of cells.values()) { gmean += c.s; gw += c.w; } gmean = gw ? gmean / gw : 0;
    const gain = new Map(); // cell → gain
    for (const k of cells.keys()) {
      if ((++work & 1023) === 0) await tick();
      const cz = (k % 1024) - 512, cy = (Math.floor(k / 1024) % 1024) - 512, cx = Math.floor(k / 1048576) - 512, q = [cx, cy, cz];
      const own = near(q);
      let g = 1;
      if (seam.mode === 'mirror') { const r = q.slice(); r[ax] = -1 - q[ax]; const mir = near(r); g = own && mir ? clampG(Math.sqrt(mir / own)) : 1; }
      else g = own ? clampG(gmean / own) : 1;
      gain.set(k, g);
    }
    // 3. gain per texel: trilinear over the 8 surrounding cells on the same side
    const G = new Float32Array(N).fill(1), have = new Uint8Array(N);
    let moved = 0, gmin = Infinity, gmax = 0;
    for (let i = 0; i < N; i++) {
      if ((i & 8191) === 0) { await tick(); if (!alive()) return { aborted: true }; }
      const x = pos[i * 3]; if (Number.isNaN(x) || mask[i] <= 0.01) continue;
      const p = [x, pos[i * 3 + 1], pos[i * 3 + 2]];
      const f = p.map((v, a) => (seam.mode === 'mirror' && a === ax ? (v - plane) / cell : v / cell) - 0.5);
      const base = f.map(Math.floor);
      const side = ci(p[ax], ax) < 0;
      let s = 0, w = 0;
      for (let c = 0; c < 8; c++) {
        const q = [base[0] + (c & 1), base[1] + ((c >> 1) & 1), base[2] + ((c >> 2) & 1)];
        if (seam.mode === 'mirror' && (q[ax] < 0) !== side) continue;
        const gv = gain.get(CELL_KEY(q[0], q[1], q[2])); if (gv === undefined) continue;
        const wt = (1 - Math.abs(f[0] - q[0])) * (1 - Math.abs(f[1] - q[1])) * (1 - Math.abs(f[2] - q[2]));
        if (wt <= 0) continue; s += gv * wt; w += wt;
      }
      const g = w > 0 ? s / w : 1;
      G[i] = 1 + (g - 1) * mask[i]; have[i] = 1;
      if (mask[i] > 0.5) { gmin = Math.min(gmin, G[i]); gmax = Math.max(gmax, G[i]); if (Math.abs(G[i] - 1) > 0.02) moved++; }
    }
    // gutter: 2 px dilation (mipmaps never pull an uncorrected border into the surface)
    for (let pass = 0; pass < 2; pass++) {
      const src = G.slice(), hv = have.slice();
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (hv[i]) continue;
        let s = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= Hh) continue; const j = yy * W + xx; if (hv[j]) { s += src[j]; n++; } }
        if (n) { G[i] = s / n; have[i] = 1; }
      }
    }
    // 4. the full-resolution albedo × gain (bilinear from the gain map), in linear light
    const img = orig.source.data, FW = img.width || img.naturalWidth, FH = img.height || img.naturalHeight;
    const cv = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(FW, FH) : Object.assign(document.createElement('canvas'), { width: FW, height: FH });
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, FW, FH);
    await tick(); if (!alive()) return { aborted: true };
    // in bands of 64 rows (one getImageData of a 2K texture alone is a ~50 ms task)
    for (let yb = 0; yb < FH; yb += 64) {
      const bh = Math.min(64, FH - yb), band = ctx.getImageData(0, yb, FW, bh), d = band.data;
      for (let yy = 0; yy < bh; yy++) {
        const y = yb + yy;
        const gy = Math.min(Hh - 1, Math.max(0, (y + 0.5) * Hh / FH - 0.5)), y0i = Math.floor(gy), y1i = Math.min(Hh - 1, y0i + 1), ty = gy - y0i;
        for (let x = 0; x < FW; x++) {
          const gx = Math.min(W - 1, Math.max(0, (x + 0.5) * W / FW - 0.5)), x0i = Math.floor(gx), x1i = Math.min(W - 1, x0i + 1), tx = gx - x0i;
          const g = (G[y0i * W + x0i] * (1 - tx) + G[y0i * W + x1i] * tx) * (1 - ty) + (G[y1i * W + x0i] * (1 - tx) + G[y1i * W + x1i] * tx) * ty;
          if (Math.abs(g - 1) < 1e-3) continue;
          const o = (yy * FW + x) * 4;
          for (let c = 0; c < 3; c++) d[o + c] = L2S[Math.min(4095, Math.round(S2L[d[o + c]] * g * 4095))];
        }
      }
      ctx.putImageData(band, 0, yb);
      await tick(); if (!alive()) return { aborted: true };
    }
    const T = new THREE.Texture(cv);
    for (const k of ['mapping', 'channel', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy', 'format', 'type', 'colorSpace', 'flipY', 'premultiplyAlpha', 'generateMipmaps', 'unpackAlignment']) T[k] = orig[k];
    T.offset.copy(orig.offset); T.repeat.copy(orig.repeat); T.rotation = orig.rotation; T.center.copy(orig.center);
    T.name = `${orig.name || 'albedo'}:seam`;
    T.userData = { twinSeamKey: key, twinOrig: keepOriginal ? orig : null };
    T.needsUpdate = true;
    for (const m of rec.mats) { m.map = T; m.needsUpdate = true; }
    if (M !== orig) M.dispose();                 // a previous lab correction
    if (!keepOriginal && M === orig) orig.dispose(); // production: the corrected map is the only one on the GPU
    report.maps++;
    Object.assign(report, { plane: +plane.toFixed(4), lumLow: wLo ? +(sLo / wLo).toFixed(4) : null, lumHigh: wHi ? +(sHi / wHi).toFixed(4) : null, cells: cells.size, texels: covered, gainMin: Number.isFinite(gmin) ? +gmin.toFixed(3) : null, gainMax: gmax ? +gmax.toFixed(3) : null, corrected: covered ? +(moved / covered).toFixed(3) : 0, size: [FW, FH] });
  }
  report.ms = Math.round(performance.now() - t0);
  return report;
}
/** Seam switched off (lab): the original albedo back on every material that wore a corrected one. */
function seamRestore(root) {
  for (const o of meshesOf(root)) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
    const T = m?.map, orig = T?.userData?.twinOrig;
    if (orig) { m.map = orig; m.needsUpdate = true; T.dispose(); }
  }
}

/** Physical copy of a Standard material (for `spec`), without carrying undefined physical fields. */
function toPhysical(m) {
  if (m.isMeshPhysicalMaterial) return m;
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.userData = { ...m.userData };
  p.name = m.name;
  return p;
}

/**
 * Apply (or re-apply) a look to a loaded twin root. Idempotent; geometry attributes and materials are shared with
 * the twin's other instances. Async: the seam fix is time-sliced (≤ 8 ms per slice). A newer call supersedes an
 * older one still running ({ aborted: true }). Resolves a small report (rule count, seam statistics).
 */
export async function applyLook(root, raw, opts = {}) {
  const gen = (root.userData.twinLookGen = (root.userData.twinLookGen || 0) + 1);
  const alive = () => root.userData.twinLookGen === gen;
  const look = normaliseLook(raw);
  const report = { rules: look?.rules.length || 0, rough: !!look?.rough, spec: look?.spec ?? null, seam: null };
  const meshes = meshesOf(root);
  // materials: spec needs MeshPhysical (converted once, shared across the twin's meshes)
  const conv = new Map();
  for (const o of meshes) {
    const fix = (m) => {
      if (!m?.isMeshStandardMaterial) return m;
      if (look?.spec !== null && look?.spec !== undefined && !m.isMeshPhysicalMaterial) {
        if (!conv.has(m)) conv.set(m, m.userData.twinPhysical || (m.userData.twinPhysical = toPhysical(m)));
        m = conv.get(m);
      }
      return m;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  }
  const mats = new Set();
  for (const o of meshes) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.isMeshStandardMaterial) mats.add(m);
  // vertex data: the height attribute (band masks); the seam fix works on the albedo texture
  let list = null;
  if (look && (look.rules.length || look.rough || look.seam)) {
    list = vertexData(root);
    for (const e of list) {
      const g = e.geometry;
      if (!g.attributes.twinH || g.userData.twinHRoot !== root.uuid) { g.setAttribute('twinH', new THREE.BufferAttribute(e.H, 1)); g.userData.twinHRoot = root.uuid; }
    }
  }
  if (look?.seam) { report.seam = await seamTexture(root, list, look.seam, { keepOriginal: !!opts.keepOriginal, alive }); if (!alive()) return { aborted: true }; }
  else seamRestore(root);
  for (const m of mats) {
    if (look?.spec !== null && look?.spec !== undefined && m.isMeshPhysicalMaterial) m.specularIntensity = look.spec;
    if (look && (look.rules.length || look.rough)) {
      const L = m.userData.twinLook || (m.userData.twinLook = { uniforms: makeUniforms(), n: 1 });
      L.n = Math.max(1, look.rules.length);
      setUniforms(L.uniforms, look);
      installLook(m);
    } else if (m.userData.twinLook) {
      // switched off: neutral uniforms (the patch stays compiled; identity)
      setUniforms(m.userData.twinLook.uniforms, null);
    }
  }
  root.userData.twinLook = look;
  root.userData.twinLookReport = report;
  return report;
}

/** Lab: show rule `i`'s mask in magenta (−1 = off). */
export function previewMask(root, i = NONE) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) { const L = m?.userData?.twinLook; if (L) L.uniforms.twinPreview.value = i; }
  });
}

/** Lab: the raw albedo (sRGB hex) of a twin mesh at a uv — the colour key the picker sets. */
export function albedoAt(mesh, uv) {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const px = readTexture(m?.map);
  const a = px && uv ? sampleTexture(px, uv.x, uv.y) : null;
  if (!a) return null;
  const base = m.color ? [m.color.r, m.color.g, m.color.b].map((c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)) : [1, 1, 1];
  const to = (v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0');
  return '#' + to(a[0] * base[0]) + to(a[1] * base[1]) + to(a[2] * base[2]);
}
