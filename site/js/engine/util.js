// Villar engine — small shared helpers. Owner: engine.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** Deterministic PRNG (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Black-body colour temperature → linear-sRGB THREE.Color (Tanner Helland fit, good 1000–12000 K). */
export function kelvin(K) {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = new THREE.Color();
  c.setRGB(clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255, THREE.SRGBColorSpace);
  return c;
}

/** Dispose geometries (and engine-owned materials) under an object. Library materials are shared → kept. */
export function disposeObject(root, { isShared = () => true } = {}) {
  root.traverse((o) => {
    if (o.geometry) {
      if (o.geometry.boundsTree && o.geometry.disposeBoundsTree) o.geometry.disposeBoundsTree();
      o.geometry.dispose();
    }
    if (o.material) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) if (m && !isShared(m)) m.dispose();
    }
    if (o.isLight && o.dispose) o.dispose();
  });
}

export function createEmitter() {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt)?.delete(fn);
    },
    off(evt, fn) { map.get(evt)?.delete(fn); },
    emit(evt, payload) {
      const set = map.get(evt);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(payload); } catch (e) { console.error(`[villar] listener for "${evt}" failed`, e); }
      }
    },
    clear() { map.clear(); },
  };
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Planckian (black-body) white in linear sRGB, normalised to max = 1 — CIE xy from the Kim et al.
 * cubic fit (1667–25000 K), XYZ → linear sRGB. More accurate than `kelvin()` (a display-sRGB fit).
 */
export function planckRGB(T) {
  T = clamp(T, 1667, 25000);
  const t = 1e3 / T, t2 = t * t, t3 = t2 * t;
  const x = T <= 4000
    ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.179910
    : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390;
  const x2 = x * x, x3 = x2 * x;
  const y = T <= 2222 ? -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
    : T <= 4000 ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
  const X = x / y, Z = (1 - x - y) / y;
  const r = 3.2406 * X - 1.5372 - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 + 0.0415 * Z;
  const b = 0.0557 * X - 0.2040 + 1.0570 * Z;
  const m = Math.max(r, g, b);
  return new THREE.Color(Math.max(0, r / m), Math.max(0, g / m), Math.max(0, b / m));
}

/**
 * Camera white balance gains (von Kries in linear sRGB) for a white point of `K` kelvin, applied with
 * `strength` (0…1, in log space) and normalised to unit luminance so exposure is unaffected.
 */
export function whiteBalanceGain(K, strength = 1, out = new THREE.Vector3(), tint = 1) {
  const w = planckRGB(K), d = planckRGB(6504);
  const g = [d.r / Math.max(1e-4, w.r), d.g / Math.max(1e-4, w.g), d.b / Math.max(1e-4, w.b)].map((v) => Math.pow(v, strength));
  g[1] *= tint; // green/magenta: > 1 pulls a magenta cast back to neutral
  const l = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
  return out.set(g[0] / l, g[1] / l, g[2] / l);
}
