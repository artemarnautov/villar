// Villar furniture — rugs and curtains. Owner: modeler.
import * as THREE from 'three';
import { Builder, roundedRectShape, ellipseShape, tube, V3, clamp, cm } from './geom.js';
import { rng } from '../textures.js';

export function rug(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const t = clamp(H, 0.006, 0.03);
  const shape = String(p.shape || 'rect').toLowerCase();
  const matKey = p.material || 'wool-rug';
  const isJute = /jute|sisal|seagrass/.test(matKey);
  const pattern = String(p.pattern || (isJute ? 'none' : 'plain'));
  const round = shape.includes('round') || shape.includes('circle') || shape.includes('oval');
  const plain = pattern === 'none' || pattern === 'plain' || pattern === 'solid';
  const usePattern = !plain;
  const mat = isJute
    ? c.mat('jute', usePattern ? { color: p.color || '#b89a6c', pattern, patternColor: p.patternColor, w: W, d: D, shape: round ? 'round' : 'rect', seed: c.seed } : { color: p.color || '#b89a6c' })
    : c.mat(matKey, usePattern ? { color: p.color || c.item?.colorHex, pattern, patternColor: p.patternColor, w: W, d: D, shape: round ? 'round' : 'rect', seed: c.seed, texture: p.texture } : { color: p.color || c.item?.colorHex, texture: p.texture });
  const s = round ? ellipseShape(W, D) : roundedRectShape(W, D, 0.012);
  const bev = Math.min(0.004, t * 0.45);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, t - bev * 2), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: round ? 96 : 8 });
  g.rotateX(-Math.PI / 2); g.translate(0, bev, 0);
  // planar UVs: pattern → 0..1 over rug, otherwise metres
  const pos = g.attributes.position; const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (usePattern) { uv[i * 2] = x / W + 0.5; uv[i * 2 + 1] = 0.5 - z / D; } else { uv[i * 2] = x; uv[i * 2 + 1] = z; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  b.add(g, mat, { uv: 'keep', cast: false });
  // fringe on the short ends
  if (p.fringe && !round) {
    const fm = c.mat('fabric-cotton', { color: p.fringeColor || p.color || '#e9e1d3' });
    const r = rng(c.seed);
    const ends = W >= D ? 'x' : 'z';
    const L = ends === 'x' ? D : W;
    const n = Math.round(L / 0.012);
    for (const sgn of [-1, 1]) for (let i = 0; i < n; i++) {
      const u = -L / 2 + (i + 0.5) * (L / n);
      const len = 0.05 + r() * 0.012;
      const a = ends === 'x' ? V3(sgn * W / 2, 0.003, u) : V3(u, 0.003, sgn * D / 2);
      const e = ends === 'x' ? V3(sgn * (W / 2 + len), 0.002, u + (r() - 0.5) * 0.01) : V3(u + (r() - 0.5) * 0.01, 0.002, sgn * (D / 2 + len));
      const fg = new THREE.CylinderGeometry(0.0016, 0.0016, len, 4, 1);
      fg.rotateZ(Math.PI / 2);
      if (ends === 'z') fg.rotateY(Math.PI / 2);
      b.add(fg, fm, { pos: [(a.x + e.x) / 2, 0.003, (a.z + e.z) / 2], cast: false });
    }
  }
  return { group: b.build('rug'), anchors: { top: V3(0, t, 0) } };
}

/**
 * Curtains: `panels` gathered panels, wave folds, hung from a slim ceiling track.
 * ctx.span (m) = rail width; panels are spread to the ends of the rail. Default span = item width.
 */
export function curtains(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  // layers: [{ fabric, color, panels, blackout }] front (room side) to back; default = one layer from params
  const layers = Array.isArray(p.layers) && p.layers.length ? p.layers.slice(0, 3) : [{ fabric: p.fabric, color: p.color, panels: p.panels, sheer: p.sheer }];
  const span = Math.max(c.span || W, W * (c.span ? 0 : 1), 0.4);
  const hang = H - 0.035;
  const r = rng(c.seed);
  const nL = layers.length;
  layers.forEach((L, li) => {
    const sheer = L.sheer ?? (/sheer|voile|вуал/.test(String(L.fabric || '')) || (li === 0 && p.sheer && nL === 1));
    const color = (L.color && /^#/.test(L.color) ? L.color : null) || p.color || c.item?.colorHex || '#E9E2D4';
    const fk = /velvet/.test(String(L.fabric || '')) ? 'fabric-velvet' : 'fabric-linen';
    const fab = sheer ? c.mat('fabric-linen', { color, sheer: true, side: THREE.DoubleSide, opacity: 0.55 }) : c.mat(fk, { color, side: THREE.DoubleSide });
    const panels = clamp(Math.round(L.panels || p.panels || 2), 1, 6);
    // sheer layer spreads over ~2/3 of the rail (parted in the middle); opaque layers are stacked at the ends
    const cover = sheer ? (nL > 1 ? 0.62 : 0.56) : 0.24;
    const groupW = (span * cover) / 2; // per side
    const perSide = Math.max(1, Math.round(panels / 2));
    const gw0 = panels === 1 ? span * cover : groupW / perSide;
    const z = nL > 1 ? (li - (nL - 1) / 2) * -0.06 : 0;
    const wave = 0.13, amp = clamp(p.foldDepth ? cm(p.foldDepth) : sheer ? 0.03 : 0.04, 0.015, 0.07);
    for (let k = 0; k < panels; k++) {
      const left = panels === 1 ? true : k < perSide;
      const idx = left ? k : k - perSide;
      const cx = panels === 1 ? -span / 2 + gw0 / 2 : left ? -span / 2 + gw0 * (idx + 0.5) : span / 2 - gw0 * (idx + 0.5);
      addPanel(b, fab, { cx, z, gw: gw0 * 0.995, hang, wave, amp, phase: r() * Math.PI, k: k + li * 7, cast: !sheer });
    }
  });
  // ceiling track (one per layer)
  const metal = c.mat(p.track || 'metal-white');
  for (let li = 0; li < nL; li++) b.add(new THREE.BoxGeometry(span, 0.022, 0.026), metal, { pos: [0, H - 0.011, nL > 1 ? (li - (nL - 1) / 2) * -0.06 : 0], cast: false });
  return { group: b.build('curtains') };
}

function addPanel(b, fab, { cx, z, gw, hang, wave, amp, phase, k, cast }) {
  const nx = Math.round(clamp(gw / 0.012, 30, 110)), ny = 22;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) {
    const v = j / ny; const y = 0.004 + v * (hang - 0.004);
    const ampY = amp * (0.85 + 0.25 * (1 - v));
    let arc = 0, prevX = 0, prevZ = 0;
    for (let i = 0; i <= nx; i++) {
      const x = -gw / 2 + (i / nx) * gw;
      const ph = (x / wave) * Math.PI * 2 + phase;
      let zz = Math.sin(ph) * ampY + Math.sin(ph * 0.37 + k) * 0.006 * (1 - v) + Math.sin(v * 3.1 + k) * 0.004;
      if (i > 0) arc += Math.hypot(x - prevX, zz - prevZ);
      prevX = x; prevZ = zz;
      pos.push(cx + x, y, z + zz); uv.push(arc, y);
    }
  }
  const m = nx + 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * m + i, bb = a + 1, cc = a + m, d = cc + 1; idx.push(a, bb, d, a, d, cc); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  b.add(g, fab, { uv: 'keep', cast });
  const hp = [];
  for (let i = 0; i <= 40; i++) { const x = -gw / 2 + (i / 40) * gw; const ph = (x / wave) * Math.PI * 2 + phase; hp.push(V3(cx + x, hang - 0.004, z + Math.sin(ph) * amp * 0.85)); }
  b.add(tube(hp, 0.004, { tubular: 100, radial: 5 }), fab, { cast });
}
