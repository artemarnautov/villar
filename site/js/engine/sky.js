// Villar engine — procedural HDR sky (equirect) + stylised Dubai skyline seen from a high floor.
// Owner: engine.
//
// The sky is an equirectangular HalfFloat DataTexture: used as scene.background in raster mode and
// as background + environment light source by the path tracer. The skyline is one merged mesh of
// towers / low-rise blocks / ground, with aerial perspective baked as (attenuated albedo + emissive
// airlight via a uv1 ramp). At night a second material swaps the airlight for lit windows.
import * as THREE from 'three';
import { rng, clamp, smoothstep, DEG } from './util.js';

// ----------------------------------------------------------------------------- sky presets
// Radiance units match lighting.js (sun ≈ 8–10 at noon).
export const SKY_PRESETS = {
  morning: { zenith: '#6f98c8', horizon: '#dfe3e3', ground: '#a99a84', haze: '#d9dcdc', zenithL: 0.32, horizonL: 0.95, groundL: 0.22, glow: '#ffd6a8', glowL: 1.1, hazeL: 0.9 },
  day:     { zenith: '#4d84c6', horizon: '#dfe7ee', ground: '#b3a58d', haze: '#cfd8e0', zenithL: 0.38, horizonL: 1.1,  groundL: 0.28, glow: '#fff1dc', glowL: 0.9, hazeL: 1.0 },
  golden:  { zenith: '#5f7fad', horizon: '#f3c491', ground: '#9a8166', haze: '#e9c29a', zenithL: 0.22, horizonL: 0.85, groundL: 0.15, glow: '#ffae5e', glowL: 2.2, hazeL: 0.75 },
  evening: { zenith: '#16264a', horizon: '#c9875f', ground: '#2a2a33', haze: '#4b4e68', zenithL: 0.030, horizonL: 0.075, groundL: 0.012, glow: '#ff9a5c', glowL: 0.09, hazeL: 0.05 },
};

const _c = new THREE.Color();
const lin = (hex) => new THREE.Color(hex); // THREE.Color(hex) converts sRGB hex → linear working space

/**
 * Builds an equirect sky. sunDir = normalized vector pointing to the sun (may be below horizon).
 */
export function makeSkyTexture(preset, sunDir, { width = 1024, height = 512 } = {}) {
  const P = preset;
  const zen = lin(P.zenith).multiplyScalar(P.zenithL);
  const hor = lin(P.horizon).multiplyScalar(P.horizonL);
  const gnd = lin(P.ground).multiplyScalar(P.groundL);
  const glow = lin(P.glow).multiplyScalar(P.glowL);
  const data = new Uint16Array(width * height * 4);
  const toH = THREE.DataUtils.toHalfFloat;
  const s = sunDir.clone().normalize();
  // horizon direction of the sun (for the low glow band even when the sun is below the horizon)
  const sh = new THREE.Vector3(s.x, 0, s.z); if (sh.lengthSq() < 1e-6) sh.set(0, 0, 1); sh.normalize();
  const d = new THREE.Vector3();
  const col = new THREE.Color();
  for (let j = 0; j < height; j++) {
    const lat = ((j + 0.5) / height - 0.5) * Math.PI;
    const y = Math.sin(lat), cl = Math.cos(lat);
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
      d.set(Math.cos(phi) * cl, y, Math.sin(phi) * cl);
      if (y >= 0) {
        // sky: horizon → zenith, a thin bright haze band right at the horizon
        const t = Math.pow(y, 0.45);
        col.copy(hor).lerp(zen, t);
        const band = Math.exp(-y * 18) * 0.35;
        col.r += hor.r * band; col.g += hor.g * band; col.b += hor.b * band;
      } else {
        // below the horizon: dusty ground haze fading into the ground colour
        const t = Math.pow(-y, 0.35);
        col.copy(hor).multiplyScalar(0.85).lerp(gnd, clamp(t * 1.2, 0, 1));
      }
      // sun glow (forward scattering) + horizon glow towards the sun azimuth
      const cosA = d.dot(s);
      const ang = Math.acos(clamp(cosA, -1, 1));
      const g1 = Math.exp(-ang / 0.09) * 1.0 + Math.exp(-ang / 0.35) * 0.35;
      const cosH = d.x * sh.x + d.z * sh.z;
      const hb = Math.max(0, cosH) ** 3 * Math.exp(-Math.abs(y) * 9) * 0.6;
      const k = g1 * (s.y > -0.12 ? 1 : 0) + hb;
      col.r += glow.r * k; col.g += glow.g * k; col.b += glow.b * k;
      const o = (j * width + i) * 4;
      data[o] = toH(col.r); data[o + 1] = toH(col.g); data[o + 2] = toH(col.b); data[o + 3] = toH(1);
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'villar-sky';
  return tex;
}

// ----------------------------------------------------------------------------- skyline
const GROUND_Y = -138;          // we are ~40 floors up
const TILE_W = 36, TILE_H = 42; // facade texture tile in metres (12 bays × 12 floors)

function facadeTextures() {
  // map: subtle floor bands + mullions (sRGB); night: lit windows (sRGB emissive)
  const N = 256, cells = 12, cs = N / cells;
  const day = new Uint8Array(N * N * 4), night = new Uint8Array(N * N * 4);
  const r = rng(77);
  const lit = [];
  for (let k = 0; k < cells * cells; k++) {
    const on = r() < 0.42;
    const warm = r();
    const b = 0.45 + r() * 0.55;
    lit.push(on ? (warm < 0.7 ? [255 * b, 196 * b, 128 * b] : [235 * b, 232 * b, 220 * b]) : [6, 7, 9]);
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
      const fx = (x % cs) / cs, fy = (y % cs) / cs;
      const slab = fy < 0.18;                 // floor slab band
      const mull = fx < 0.07;                 // vertical mullion
      const o = (y * N + x) * 4;
      const v = slab ? 150 : mull ? 190 : 225;
      day[o] = v; day[o + 1] = v; day[o + 2] = v; day[o + 3] = 255;
      const L = slab || mull ? [3, 3, 4] : lit[cy * cells + cx];
      night[o] = L[0]; night[o + 1] = L[1]; night[o + 2] = L[2]; night[o + 3] = 255;
    }
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.anisotropy = 4; t.needsUpdate = true; return t;
  };
  // airlight ramp: u = haze amount 0..1 → white*u (emissive colour tints it)
  const R = 64, ramp = new Uint8Array(R * 4);
  for (let i = 0; i < R; i++) { const v = Math.round((i / (R - 1)) * 255); ramp[i * 4] = v; ramp[i * 4 + 1] = v; ramp[i * 4 + 2] = v; ramp[i * 4 + 3] = 255; }
  const rampTex = new THREE.DataTexture(ramp, R, 1, THREE.RGBAFormat);
  rampTex.colorSpace = THREE.NoColorSpace; rampTex.magFilter = THREE.LinearFilter; rampTex.minFilter = THREE.LinearFilter;
  rampTex.channel = 1; rampTex.needsUpdate = true;
  return { day: mk(day), night: mk(night), ramp: rampTex };
}

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.uv1 = []; this.col = []; this.idx = []; }
  quad(p0, p1, p2, p3, n, uvs, haze, color) {
    const b = this.pos.length / 3;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) { this.nor.push(n[0], n[1], n[2]); this.uv1.push(haze, 0.5); this.col.push(color.r, color.g, color.b); }
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** Axis-aligned-in-local-frame box (rotated by `rot` around Y), sides + top. */
  tower(cx, cz, w, d, y0, y1, rot, haze, color, uOff, vOff) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, y, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    const hw = w / 2, hd = d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    let u = uOff;
    for (let k = 0; k < 4; k++) {
      const a = corners[k], b = corners[(k + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
      const n = [nx * c + nz * s, 0, -nx * s + nz * c];
      const u0 = u / TILE_W, u1 = (u + len) / TILE_W;
      const v0 = (y0 - GROUND_Y) / TILE_H + vOff, v1 = (y1 - GROUND_Y) / TILE_H + vOff;
      // winding a0 → a1 → b1 → b0 gives an outward-facing front side
      this.quad(P(a[0], y0, a[1]), P(a[0], y1, a[1]), P(b[0], y1, b[1]), P(b[0], y0, b[1]), n, [[u0, v0], [u0, v1], [u1, v1], [u1, v0]], haze, color);
      u += len;
    }
    // roof (dark, no windows: uv in a slab band)
    this.quad(P(-hw, y1, hd), P(hw, y1, hd), P(hw, y1, -hd), P(-hw, y1, -hd), [0, 1, 0], [[0, 0.01], [0.001, 0.01], [0.001, 0.012], [0, 0.012]], haze, color.clone().multiplyScalar(0.6));
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const TOWER_COLORS = ['#7d8c97', '#56636d', '#9aa6ad', '#c8b89e', '#d9d5cc', '#6c7a80', '#b3a68f', '#8f9aa0'];

export function createSkyline({ center = new THREE.Vector3(2.3, 0, 9.0), seed = 11 } = {}) {
  const r = rng(seed);
  const B = new GeoBuilder();
  const hazeOf = (dist) => 1 - Math.exp(-dist / 1700);
  const add = (ang, dist, w, d, h, rot, colHex) => {
    const cx = center.x + Math.sin(ang) * dist, cz = center.z + Math.cos(ang) * dist;
    const hz = hazeOf(dist);
    const c = new THREE.Color(colHex).multiplyScalar(1 - hz * 0.85);
    B.tower(cx, cz, w, d, GROUND_Y, GROUND_Y + h, rot, hz, c, r() * TILE_W, Math.floor(r() * 12) / 12);
    return { cx, cz };
  };
  // mid-rise and high-rise towers in a wide arc in front of the window (+Z hemisphere)
  for (let i = 0; i < 150; i++) {
    const ang = (r() * 2 - 1) * 115 * DEG;
    const near = r() < 0.15;
    const dist = near ? 330 + r() * 250 : 600 + Math.pow(r(), 0.85) * 1900;
    // keep a view corridor straight ahead for nearby towers
    if (dist < 700 && Math.abs(ang) < 28 * DEG) continue;
    const tall = r() < 0.3;
    const h = tall ? 200 + r() * 160 : 60 + r() * 140;
    const w = 18 + r() * 20, d = 18 + r() * 20;
    add(ang, dist, w, d, h, r() * Math.PI, TOWER_COLORS[(r() * TOWER_COLORS.length) | 0]);
    // occasional stepped crown
    if (tall && r() < 0.5) {
      const cx = center.x + Math.sin(ang) * dist, cz = center.z + Math.cos(ang) * dist;
      const hz = hazeOf(dist);
      const c = new THREE.Color('#9aa6ad').multiplyScalar(1 - hz * 0.85);
      B.tower(cx, cz, w * 0.6, d * 0.6, GROUND_Y + h, GROUND_Y + h + 18 + r() * 25, 0, hz, c, 0, 0);
    }
  }
  // low-rise city fabric near the ground
  for (let i = 0; i < 420; i++) {
    const ang = (r() * 2 - 1) * 120 * DEG;
    const dist = 140 + Math.pow(r(), 0.7) * 1800;
    add(ang, dist, 14 + r() * 30, 14 + r() * 30, 8 + r() * 30, r() * Math.PI, ['#c7b79f', '#d8cfc0', '#a99d8a', '#bdb3a3'][(r() * 4) | 0]);
  }
  // landmark supertall (stylised, stepped + spire) far to the left
  {
    const ang = -32 * DEG, dist = 2600;
    const cx = center.x + Math.sin(ang) * dist, cz = center.z + Math.cos(ang) * dist;
    const hz = hazeOf(dist);
    const c = new THREE.Color('#aab4ba').multiplyScalar(1 - hz * 0.85);
    let y = GROUND_Y, w = 70;
    for (let k = 0; k < 9; k++) {
      const h = k < 3 ? 110 : 70;
      B.tower(cx, cz, w, w * 0.9, y, y + h, k * 0.45, hz, c, 0, 0);
      y += h; w *= 0.8;
    }
    B.tower(cx, cz, 5, 5, y, y + 170, 0, hz, c, 0, 0);
  }
  // ground plane (desert/city haze)
  {
    const R = 5200;
    const hz = 0.75;
    const c = new THREE.Color('#b9a98f').multiplyScalar(1 - hz * 0.8);
    B.quad([center.x - R, GROUND_Y, center.z + R], [center.x + R, GROUND_Y, center.z + R], [center.x + R, GROUND_Y, center.z - R], [center.x - R, GROUND_Y, center.z - R],
      [0, 1, 0], [[0, 0.01], [0.001, 0.01], [0.001, 0.012], [0, 0.012]], hz, c);
  }
  const geometry = B.build();
  const tx = facadeTextures();
  const dayMat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: tx.day, roughness: 0.55, metalness: 0.0,
    emissive: new THREE.Color('#cfd8e0'), emissiveMap: tx.ramp, emissiveIntensity: 1,
  });
  dayMat.name = 'skyline-day';
  const nightMat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: tx.day, color: new THREE.Color(0.35, 0.36, 0.4), roughness: 0.6, metalness: 0,
    emissive: new THREE.Color(1, 1, 1), emissiveMap: tx.night, emissiveIntensity: 0.6,
  });
  nightMat.name = 'skyline-night';
  const mesh = new THREE.Mesh(geometry, dayMat);
  mesh.name = 'skyline';
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.noAO = true; mesh.userData.exterior = true;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();

  return {
    mesh,
    setTimeOfDay(tod, preset) {
      if (tod === 'evening') {
        mesh.material = nightMat;
        nightMat.emissiveIntensity = 0.55;
      } else {
        mesh.material = dayMat;
        dayMat.emissive.set(preset.haze).multiplyScalar(preset.hazeL);
      }
    },
    dispose() { geometry.dispose(); dayMat.dispose(); nightMat.dispose(); tx.day.dispose(); tx.night.dispose(); tx.ramp.dispose(); },
  };
}

export { GROUND_Y, smoothstep };
