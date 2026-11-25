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
  const pattern = p.pattern || (isJute ? 'none' : 'plain');
  const round = shape.includes('round') || shape.includes('circle') || shape.includes('oval');
  const usePattern = !isJute && pattern !== 'none';
  const mat = isJute ? c.mat('jute', { color: p.color || '#b89a6c' }) : c.mat(matKey, usePattern ? { color: p.color || c.item?.colorHex, pattern, patternColor: p.patternColor, w: W, d: D, shape: round ? 'round' : 'rect', seed: c.seed } : { color: p.color || c.item?.colorHex });
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
  const panels = clamp(Math.round(p.panels || 2), 1, 4);
  const sheer = !!p.sheer;
  const color = p.color || c.item?.colorHex || '#E9E2D4';
  const fab = sheer ? c.mat('fabric-linen', { color, sheer: true, side: THREE.DoubleSide }) : c.mat(p.fabric === 'velvet' ? 'fabric-velvet' : 'fabric-linen', { color, side: THREE.DoubleSide });
  if (sheer) { fab.transparent = true; fab.opacity = 0.62; fab.depthWrite = false; fab.sheen = 0.5; }
  const span = Math.max(c.span || W, W);
  const panelW = (p.panelWidth ? cm(p.panelWidth) : W / panels); // flat fabric width per panel… gathered:
  const gathered = clamp(p.gathered ? cm(p.gathered) : (c.span ? Math.min(panelW * 0.55, span / panels) : W / panels), 0.2, span / panels);
  const hang = H - 0.035; // below the track
  const r = rng(c.seed);
  const wave = 0.13, amp = clamp(p.foldDepth ? cm(p.foldDepth) : 0.035, 0.015, 0.07);
  const nx = Math.round(clamp(gathered / 0.012, 40, 110)), ny = 22;
  for (let k = 0; k < panels; k++) {
    // panel centre along x
    let cx;
    if (panels === 1) cx = c.span ? -span / 2 + gathered / 2 : 0;
    else if (c.span) cx = k < panels / 2 ? -span / 2 + gathered / 2 + k * gathered : span / 2 - gathered / 2 - (panels - 1 - k) * gathered;
    else cx = -W / 2 + gathered * (k + 0.5);
    const gw = gathered * 0.995;
    const phase = r() * Math.PI;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= ny; j++) {
      const v = j / ny; const y = 0.004 + v * (hang - 0.004);
      // folds deepen slightly toward the hem, hem flares a touch
      const ampY = amp * (0.85 + 0.25 * (1 - v));
      let arc = 0, prevX = 0, prevZ = 0;
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const x = -gw / 2 + u * gw;
        const ph = (x / wave) * Math.PI * 2 + phase;
        let z = Math.sin(ph) * ampY + Math.sin(ph * 0.37 + k) * 0.006 * (1 - v);
        const sway = Math.sin(v * 3.1 + k) * 0.004;
        z += sway;
        if (i > 0) arc += Math.hypot(x - prevX, z - prevZ);
        prevX = x; prevZ = z;
        pos.push(cx + x, y, z);
        uv.push(arc, y);
      }
    }
    const m = nx + 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * m + i, bb = a + 1, cc = a + m, d = cc + 1;
      idx.push(a, bb, d, a, d, cc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    b.add(g, fab, { uv: 'keep', cast: !sheer });
    // heading tape (stiffer band at the top) + hem weight line
    const hp = [];
    for (let i = 0; i <= 40; i++) { const x = -gw / 2 + (i / 40) * gw; const ph = (x / wave) * Math.PI * 2 + phase; hp.push(V3(cx + x, hang - 0.004, Math.sin(ph) * amp * 0.85)); }
    b.add(tube(hp, 0.004, { tubular: 120, radial: 5 }), fab, { cast: !sheer });
  }
  // ceiling track
  const metal = c.mat(p.track || 'metal-white');
  const tg = new THREE.BoxGeometry(span, 0.022, 0.03);
  b.add(tg, metal, { pos: [0, H - 0.011, 0.0], cast: false });
  return { group: b.build('curtains') };
}
