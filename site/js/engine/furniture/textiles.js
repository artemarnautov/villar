// Villar furniture — rugs and curtains. Owner: modeler.
import * as THREE from '../../../vendor/three/three.module.js';
import { Builder, roundedRectShape, ellipseShape, tube, softBox, V3, clamp, lerp, cm, segs } from './geom.js';
import { rng, Noise } from '../textures.js';
import { fabricMat } from './parts.js';

/** Split a geometry's triangles by face normal: [rest, matching] (matching = null if none). Non-indexed output. */
function splitFaces(g, pred) {
  const src = g.index ? g.toNonIndexed() : g;
  const P = src.attributes.position, N = src.attributes.normal, U = src.attributes.uv;
  const A = { p: [], n: [], u: [] }, B = { p: [], n: [], u: [] };
  const fn = new THREE.Vector3(), a = new THREE.Vector3(), b2 = new THREE.Vector3(), c2 = new THREE.Vector3();
  for (let i = 0; i < P.count; i += 3) {
    a.fromBufferAttribute(P, i); b2.fromBufferAttribute(P, i + 1); c2.fromBufferAttribute(P, i + 2);
    fn.subVectors(c2, b2).cross(a.clone().sub(b2)).normalize();
    const T = pred(fn) ? B : A;
    for (let k = 0; k < 3; k++) { T.p.push(P.getX(i + k), P.getY(i + k), P.getZ(i + k)); T.n.push(N.getX(i + k), N.getY(i + k), N.getZ(i + k)); T.u.push(U.getX(i + k), U.getY(i + k)); }
  }
  const mk = (T) => { if (!T.p.length) return null; const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(T.p, 3)); o.setAttribute('normal', new THREE.Float32BufferAttribute(T.n, 3)); o.setAttribute('uv', new THREE.Float32BufferAttribute(T.u, 2)); return o; };
  return [mk(A), mk(B)];
}

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
  // slight curl at the corners (±3–4 mm), as a laid rug never sits perfectly flat
  const rr = rng(c.seed + 4);
  const corners = round ? [] : [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]].map((q) => [...q, 0.002 + rr() * 0.003]);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let lift = 0;
    for (const [cx, cz, a] of corners) { const d = Math.hypot(x - cx, z - cz); if (d < 0.25) lift = Math.max(lift, a * (1 - d / 0.25) ** 2); }
    if (lift) pos.setY(i, pos.getY(i) + lift);
  }
  g.computeVertexNormals();
  // round 5 (tilted close-ups): the edge faces get their own UVs — along the edge × up (metric pile, no vertical
  // streaks; a pattern keeps its border texel) — and the underside is the rug's backing, not the pile
  const [top, under] = splitFaces(g, (n) => n.y < -0.6);
  if (!usePattern) {
    const tp = top.attributes.position, tn = top.attributes.normal, tu = top.attributes.uv;
    for (let i = 0; i < tp.count; i++) if (Math.abs(tn.getY(i)) < 0.6) tu.setXY(i, Math.abs(tn.getX(i)) > Math.abs(tn.getZ(i)) ? tp.getZ(i) : tp.getX(i), tp.getY(i) * 2.5);
  }
  b.add(top, mat, { uv: 'keep', cast: false });
  if (under) { const up = under.attributes.position, uu = under.attributes.uv; for (let i = 0; i < up.count; i++) uu.setXY(i, up.getX(i), up.getZ(i)); }
  if (under) b.add(under, c.mat(isJute ? 'jute' : 'fabric-cotton', { color: isJute ? '#a88f68' : '#cfc5b3' }), { uv: 'keep', cast: false });
  // edge binding: a 3 mm rolled whip-stitch around the perimeter
  if (!isJute || p.binding) {
    const pts = (round ? ellipseShape(W - 0.006, D - 0.006) : roundedRectShape(W - 0.006, D - 0.006, 0.01)).getPoints(round ? 96 : 12).map((q) => {
      let lift = 0;
      for (const [cx, cz, a] of corners) { const d = Math.hypot(q.x - cx, -q.y - cz); if (d < 0.25) lift = Math.max(lift, a * (1 - d / 0.25) ** 2); }
      return V3(q.x, t - 0.0025 + lift, -q.y);
    });
    b.add(tube(pts, 0.003, { tubular: round ? 160 : 120, radial: 6, closed: true, tension: 0.05 }), c.mat(isJute ? 'jute' : matKey, { color: p.bindingColor || p.patternColor || p.color || c.item?.colorHex }), { uv: 'box', cast: false });
  }
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
    const fab = sheer ? c.mat('fabric-sheer', { color, side: THREE.DoubleSide }) : c.mat(fk, { color, side: THREE.DoubleSide });
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
      addPanel(b, fab, { cx, z, gw: gw0 * 0.995, hang, wave, amp, phase: r() * Math.PI, k: k + li * 7, cast: !sheer, sheer, glider: { top: H - 0.019, mat: c.mat('plastic-white') } });
    }
  });
  // ceiling track (one per layer)
  const metal = c.mat(p.track || 'metal-white');
  for (let li = 0; li < nL; li++) b.add(softBox(span, 0.022, 0.026, { r: 0.003, seg: 2 }), metal, { pos: [0, H - 0.011, nL > 1 ? (li - (nL - 1) / 2) * -0.06 : 0], cast: false });
  return { group: b.build('curtains') };
}

function addPanel(b, fab, { cx, z, gw, hang, wave, amp, phase, k, cast, sheer = false, glider = null }) {
  const nx = Math.round(clamp(gw / 0.012, 30, 110));
  panelStrip(b, fab, { cx, z, gw, hang, wave, amp, phase, k, cast, nx, y0: 0.004, y1: hang, ny: 22 });
  // voile: doubled hem (6 cm) and heading tape (9 cm) read as denser bands, as in real sheers
  if (sheer) {
    panelStrip(b, fab, { cx, z, gw, hang, wave, amp, phase, k, cast, nx, y0: 0.004, y1: 0.064, ny: 2, off: 0.0015 });
    panelStrip(b, fab, { cx, z, gw, hang, wave, amp, phase, k, cast, nx, y0: hang - 0.09, y1: hang, ny: 2, off: 0.0015 });
  }
  const hp = [];
  for (let i = 0; i <= 40; i++) { const x = -gw / 2 + (i / 40) * gw; const ph = (x / wave) * Math.PI * 2 + phase; hp.push(V3(cx + x, hang - 0.004, z + Math.sin(ph) * amp * 0.85)); }
  b.add(tube(hp, 0.004, { tubular: 100, radial: 5 }), fab, { cast });
  // round 5: wave gliders — the heading hung 13 mm under the track from nothing. A nylon glider stem wherever the
  // wave crosses the track line (every half wave), from inside the heading up into the track
  if (glider) {
    for (let n = Math.ceil(((-gw / 2) / wave * 2 * Math.PI + phase) / Math.PI); ; n++) {
      const x = (n * Math.PI - phase) * wave / (2 * Math.PI);
      if (x > gw / 2) break;
      if (x < -gw / 2 + 0.01) continue;
      const zz = Math.sin(3.1 + k) * 0.004;
      const len = glider.top - (hang - 0.014);
      b.add(new THREE.CylinderGeometry(0.0032, 0.0038, len, 8), glider.mat, { pos: [cx + x, hang - 0.014 + len / 2, z + zz], uv: 'none', cast: false });
    }
  }
}

function panelStrip(b, fab, { cx, z, gw, hang, wave, amp, phase, k, cast, nx, y0, y1, ny, off = 0 }) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) {
    const y = y0 + (j / ny) * (y1 - y0), v = (y - 0.004) / (hang - 0.004);
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
  if (off) {
    const pa = g.attributes.position, na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i) + na.getX(i) * off, pa.getY(i), pa.getZ(i) + na.getZ(i) * off);
  }
  b.add(g, fab, { uv: 'keep', cast });
}

// ---------------------------------------------------------------- throw (draped blanket)

/**
 * Closed cloth slab from a surface function P(s, w) → Vector3 (s along the drape, w across, both 0..1):
 * top sheet, a copy offset by −t along the normal, and the four edges stitched with rounded rims.
 */
function clothSlab(P, ns, nw, t) {
  const top = [], nrm = [];
  for (let j = 0; j <= nw; j++) for (let i = 0; i <= ns; i++) top.push(P(i / ns, j / nw));
  // normals by finite differences on the grid
  const at = (i, j) => top[clamp(j, 0, nw) * (ns + 1) + clamp(i, 0, ns)];
  for (let j = 0; j <= nw; j++) for (let i = 0; i <= ns; i++) {
    const du = at(i + 1, j).clone().sub(at(i - 1, j)), dv = at(i, j + 1).clone().sub(at(i, j - 1));
    nrm.push(new THREE.Vector3().crossVectors(dv, du).normalize());
  }
  // orient so that "up" side faces +Y on average
  let sy = 0; for (const n of nrm) sy += n.y;
  const flip = sy < 0; if (flip) for (const n of nrm) n.negate();
  const pos = [], uv = [], idx = [], nor = [];
  const m = (ns + 1) * (nw + 1);
  const len = []; // arc length along s for metre UVs
  for (let j = 0; j <= nw; j++) { let a = 0; for (let i = 0; i <= ns; i++) { if (i) a += at(i, j).distanceTo(at(i - 1, j)); len.push(a); } }
  const wl = at(0, nw).distanceTo(at(0, 0));
  for (let k = 0; k < 2; k++) for (let j = 0; j <= nw; j++) for (let i = 0; i <= ns; i++) {
    const q = j * (ns + 1) + i; const p = top[q].clone().addScaledVector(nrm[q], k ? -t : 0);
    pos.push(p.x, p.y, p.z); uv.push(len[q], (j / nw) * wl);
    nor.push(k ? -nrm[q].x : nrm[q].x, k ? -nrm[q].y : nrm[q].y, k ? -nrm[q].z : nrm[q].z);
  }
  for (let j = 0; j < nw; j++) for (let i = 0; i < ns; i++) {
    const a = j * (ns + 1) + i, b = a + 1, c = a + ns + 1, d = c + 1;
    if (!flip) { idx.push(a, c, b, b, c, d); idx.push(m + a, m + b, m + c, m + b, m + d, m + c); }
    else { idx.push(a, b, c, b, d, c); idx.push(m + a, m + c, m + b, m + b, m + c, m + d); }
  }
  // rims (R4-13): a real rolled hem — half-round of diameter t bulging OUTWARD from the edge (the outward in-sheet
  // direction from the interior neighbours), with analytic normals, so the throw shows its thickness
  const E = new THREE.Vector3(), d = new THREE.Vector3();
  const rim = (ids) => {
    const base = pos.length / 3, R = 5;
    for (const q of ids) {
      const p0 = top[q], n = nrm[q];
      const i = q % (ns + 1), j = Math.floor(q / (ns + 1));
      E.set(0, 0, 0);
      const away = (i2, j2) => { d.copy(p0).sub(at(i2, j2)); if (d.lengthSq() > 1e-12) E.add(d.normalize()); };
      if (i === 0) away(1, j); if (i === ns) away(ns - 1, j); if (j === 0) away(i, 1); if (j === nw) away(i, nw - 1);
      E.addScaledVector(n, -E.dot(n)); if (E.lengthSq() < 1e-12) E.set(0, 0, 1); E.normalize();
      for (let r = 0; r <= R; r++) {
        const a = (r / R) * Math.PI, cn = Math.cos(a), sn = Math.sin(a);
        const out = p0.clone().addScaledVector(n, -t / 2 + cn * t / 2).addScaledVector(E, sn * t / 2);
        pos.push(out.x, out.y, out.z); uv.push(len[q] || 0, r * t);
        nor.push(n.x * cn + E.x * sn, n.y * cn + E.y * sn, n.z * cn + E.z * sn);
      }
    }
    const i0 = idx.length;
    for (let e = 0; e < ids.length - 1; e++) for (let r = 0; r < R; r++) {
      const a = base + e * (R + 1) + r, b = a + 1, c = a + R + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    // winding must agree with the analytic normals (front-side fabrics would cull the rim otherwise)
    const v = (k) => new THREE.Vector3(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]);
    let agree = 0;
    for (let k = i0; k < idx.length; k += 3 * R) {
      const A = v(idx[k]), B = v(idx[k + 1]), C = v(idx[k + 2]);
      const gn = B.sub(A).cross(C.sub(A));
      agree += gn.x * nor[3 * idx[k]] + gn.y * nor[3 * idx[k] + 1] + gn.z * nor[3 * idx[k] + 2];
    }
    if (agree < 0) for (let k = i0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }
  };
  const ring = [];
  for (let i = 0; i <= ns; i++) ring.push(i);
  for (let j = 1; j <= nw; j++) ring.push(j * (ns + 1) + ns);
  for (let i = ns - 1; i >= 0; i--) ring.push(nw * (ns + 1) + i);
  for (let j = nw - 1; j >= 0; j--) ring.push(j * (ns + 1));
  rim(ring);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * throw — knit or linen blanket. Params: fabric knit|linen|washed-linen|wool|boucle|cotton, color, drape
 * arm|back|folded, fringe bool, foldedWidth (m). dims = unfolded size (w × d cm); h ignored.
 * Origin = the sofa anchor it is attached to (throw_arm_r | throw_arm_l | throw_back); pass the anchor's
 * anchorInfo as ctx.host ({ mode, side, armW, armD, seatDrop, outsideDrop } or { mode:'back', backT,
 * frontDrop, outsideDrop }). Without a host it drapes over a generic 16 cm arm. 'folded' = neat stack (origin
 * bottom-centre) for a bed bench / ottoman / seat.
 */
export function throwBlanket(c) {
  const { W, D, params: p } = c;
  const b = new Builder(c.seed);
  const r = rng(c.seed + 21);
  const N = new Noise(c.seed + 3);
  const fk = String(p.fabric || 'knit').toLowerCase();
  const color = p.color || c.item?.colorHex || '#D9CDB8';
  const mat = /knit|chunky|waffle/.test(fk) ? c.mat('fabric-knit', { color })
    : /wash/.test(fk) ? c.mat('fabric-linen-washed', { color })
      // woven cotton throws: a heavier, open weave (≈ 3 mm yarn), not bed percale
      : /cotton|weave|dense|textur/.test(fk) ? c.mat('fabric-weave', { color })
        : fabricMat(c, fk, color);
  // R2-17 / R4-13: a throw lies folded double — 11–15 mm of cloth with rounded rolled hems
  const t = /knit|chunky|wool|bouc|waffle/.test(fk) ? 0.015 : /linen/.test(fk) ? 0.011 : 0.012;
  const host = c.host || {};
  const drape = String(p.drape || host.mode || 'arm').toLowerCase();
  if (drape === 'folded') {
    // folded in thirds then in half: 4–6 layers with soft rolled folds
    const fw = clamp(cm(p.foldedWidth, W / 3), 0.3, 0.6), fd = clamp(D / 4, 0.25, 0.5);
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const g = softBox(fw - i * 0.004, t * 1.1, fd - i * 0.003, { r: t * 0.55, seg: 2, cell: 0.04, wrinkle: 0.0015, seed: c.seed + i, bulge: { top: 0.002, front: 0.002 } });
      b.add(g, mat, { pos: [(r() - 0.5) * 0.006, t * 1.1 * (i + 0.5), (r() - 0.5) * 0.006], rot: [0, (r() - 0.5) * 0.03, 0] });
    }
    return { group: b.build('throw') };
  }
  const isBack = drape === 'back';
  const side = host.side || 1;
  const armW = host.armW || host.backT || 0.16;
  const inLen = isBack ? (host.frontDrop || 0.18) : (host.seatDrop || 0.2);
  const outLen = Math.min(host.outsideDrop || 0.35, isBack ? 0.4 : 0.42);
  const lie = isBack ? 0 : clamp(0.24, 0.1, 0.3); // part lying on the seat cushion
  // folded width along the arm/back and its length in the drape direction
  const wF = clamp(cm(p.foldedWidth, isBack ? Math.min(W * 0.45, 0.7) : Math.min(W / 3, (host.armD || 0.9) - 0.15)), 0.3, 0.8);
  // drape profile in (x = inside→outside, y) relative to the top centre of the arm/back
  const prof = new THREE.CatmullRomCurve3([
    V3(-armW / 2 - lie - 0.02, -inLen + t, 0),
    V3(-armW / 2 - 0.05, -inLen + t + 0.006, 0),
    V3(-armW / 2 - 0.016, -inLen * 0.45, 0),
    // soft folds over the arm edges (R4-13): the cloth bridges each corner with a ≈ 3 cm radius instead of hugging it
    V3(-armW / 2 - 0.006, -0.03, 0),
    V3(-armW / 2 + 0.03, 0.004, 0),
    V3(0, 0.006, 0),
    V3(armW / 2 - 0.03, 0.004, 0),
    V3(armW / 2 + 0.014, -0.035, 0),
    V3(armW / 2 + 0.02, -0.09, 0),
    V3(armW / 2 + 0.016, -outLen * 0.6, 0),
    V3(armW / 2 + 0.03, -outLen, 0),
  ], false, 'catmullrom', 0.4);
  const ns = segs(66, 28), nw = segs(36, 14);
  const ph = r() * 6.28, ph2 = r() * 6.28;
  const nFolds = 2 + (r() < 0.5 ? 0.5 : 1); // 2–3 soft folds across the width where the cloth hangs free
  const P = (s, w) => {
    const q = prof.getPointAt(s), tan = prof.getTangentAt(s);
    const n = V3(-tan.y, tan.x, 0); // in-plane normal (outward/up)
    const z = (w - 0.5) * wF;
    // fold amplitude: taut over the arm top, soft deep folds where it hangs (±2.5 cm), gentle rumple where it lies
    const freeOut = clamp((q.x - armW / 2) / 0.03, 0, 1) * clamp(-q.y / outLen, 0, 1);
    const freeIn = clamp((-armW / 2 - q.x) / 0.04, 0, 1);
    const amp = 0.0015 + freeOut * 0.024 + freeIn * 0.007;
    const folds = Math.sin((z / wF) * Math.PI * 2 * nFolds + ph) * 0.75 + N.n(z * 3.5 + 7, s * 2.5) * 0.45;
    const p3 = q.clone().addScaledVector(n, folds * amp);
    // hanging hem flares out a little and the corners drop
    p3.x += freeOut * freeOut * 0.022 * Math.abs(w - 0.5) * 2;
    p3.y -= freeOut * Math.pow(Math.abs(w - 0.5) * 2, 3) * 0.035;
    // seat part: low, smooth rumple; clear the crowned arm top (+1.2 cm) and the crowned seat cushion (up to +2.6 cm)
    p3.y += freeIn * Math.max(0, N.n(z * 3 + 3, s * 2.5)) * 0.01;
    p3.y += 0.012 + clamp((-armW / 2 - q.x) / 0.05, 0, 1) * clamp((-q.y - inLen * 0.55) / (inLen * 0.45), 0, 1) * (isBack ? 0 : 0.026);
    if (q.x > armW / 2) p3.x += 0.006; else if (q.x < -armW / 2) p3.x -= 0.006;
    p3.z = z + Math.sin(s * 7 + ph2) * 0.006;
    return p3;
  };
  const g = clothSlab(P, ns, nw, t);
  // into the anchor frame: arm → x across (mirrored for the left arm); back → x across becomes −z
  const toAnchor = (geo) => {
    if (isBack) geo.rotateY(Math.PI / 2);
    else if (side < 0) {
      geo.scale(-1, 1, 1);
      if (geo.index) { const ix = geo.index.array; for (let k = 0; k < ix.length; k += 3) { const tmp = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = tmp; } }
      // (scale(−1, 1, 1) already mirrors the normals; recomputing would discard the analytic hem normals)
    }
    return geo;
  };
  b.add(toAnchor(g), mat, { uv: 'keep' });
  if (p.fringe) {
    // R2-17 fringe: an alpha card strip (7 cm of twisted tassels) on both short hems — hanging under gravity on the
    // outside, lying out across the seat on the inside
    const fm = c.mat('fringe', { color });
    const card = (sEnd) => {
      const nn = segs(40, 14), pos = [], uv = [], idx = [];
      const ds = sEnd > 0.5 ? 1 : -1;
      let arc = 0, prev = null;
      for (let j = 0; j <= nn; j++) {
        const w = 0.02 + 0.96 * (j / nn);
        const a = P(sEnd, w), bb = P(sEnd - ds * 0.01, w);
        const out = a.clone().sub(bb).normalize();
        const hang = sEnd > 0.5 ? V3(0, -1, 0).lerp(out, 0.25).normalize() : V3(out.x, 0, out.z).normalize();
        const tip = a.clone().addScaledVector(hang, 0.07);
        if (sEnd < 0.5) { tip.y = a.y - t * 0.5 + 0.002; a.y -= t * 0.25; }
        if (prev) arc += a.distanceTo(prev);
        prev = a;
        pos.push(a.x, a.y - (sEnd > 0.5 ? t * 0.5 : 0), a.z, tip.x, tip.y, tip.z);
        uv.push(arc, 0, arc, 1);
      }
      for (let j = 0; j < nn; j++) { const k = j * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      fg.setIndex(idx); fg.computeVertexNormals();
      return fg;
    };
    for (const sEnd of [1, 0]) b.add(toAnchor(card(sEnd)), fm, { uv: 'keep' });
  }
  return { group: b.build('throw') };
}

/** runner — the rug generator with runner defaults (70×200 cm, striped border, low pile). */
export function runner(c) {
  const p = { pattern: 'double-border', texture: 'fine-weave', ...c.params };
  return rug({ ...c, params: p });
}
