// Villar furniture — wall art, plants, decor sets. Owner: modeler.
import * as THREE from '../../../vendor/three/three.module.js';
import { Builder, softBox, lathe, smoothProfile, slab, ellipseShape, roundedRectShape, tube, segs, getLOD, V3, clamp, lerp, cm } from './geom.js';
import { rng, hashStr } from '../textures.js';
import { objMat, addStems, addFlame } from './tabletop.js';

// ---------------------------------------------------------------- wall art

// ---------------------------------------------------------------- picture / mirror backs (round 5, FOCUS turntable)
//
// The turntable shows the back of everything that hangs. A framed picture gets a kraft dust cover let into the frame
// with two D-rings and a hanging wire; a gallery-wrapped canvas shows its pine stretcher (and a cross brace on large
// canvases), the folded canvas on the stretcher's back and the raw canvas between the bars. Hardware lies behind the
// back plane (z ≤ 0, inside the wall once hung), never in front of it.

/** Two D-rings on the side bars (at ¾ height) + a sagging picture wire between them. hw = half width to the rings. */
function hangingWire(b, c, { hw, y, sag = 0.035, x0 = 0, z0 = 0 }) {
  const steel = c.mat('metal-nickel');
  for (const s of [-1, 1]) {
    b.add(softBox(0.012, 0.024, 0.0012, { r: 0.0005, seg: 1 }), steel, { pos: [x0 + s * hw, y, z0 - 0.0006], uv: 'none' });
    const ring = new THREE.TorusGeometry(0.0075, 0.0011, 5, 12, Math.PI);
    ring.rotateZ(-s * Math.PI / 2 + Math.PI); // half ring opening toward the plate
    b.add(ring, steel, { pos: [x0 + s * (hw - 0.006), y - 0.004, z0 - 0.0016], uv: 'none' });
  }
  const xw = hw - 0.012;
  b.add(tube([V3(x0 - xw, y - 0.004, z0 - 0.0018), V3(x0 - xw * 0.45, y - 0.004 - sag * 0.8, z0 - 0.002), V3(x0, y - 0.004 - sag, z0 - 0.002), V3(x0 + xw * 0.45, y - 0.004 - sag * 0.8, z0 - 0.002), V3(x0 + xw, y - 0.004, z0 - 0.0018)], 0.0007, { tubular: 40, radial: 4 }), steel, { uv: 'none' });
}

/**
 * Gallery-wrap canvas of w × h, depth d, centred at x0: painted (wrapped) sides, pine stretcher bars, the canvas fold
 * on the bars' back, raw canvas inside, a cross brace above ~70 cm. The art plane itself is added by the caller.
 */
function stretcherBack(b, c, { x0 = 0, w, h, d, edge, z0 = 0, wrap = null }) {
  const bar = Math.min(0.042, Math.min(w, h) * 0.12), t = 0.0012;
  // wrap = { mat, u0, u1, v0, v1, flip }: the print runs round the edges (and onto the back folds) — the skins take
  // the artwork's border texels (clamped UVs), else the painted edge colour
  const skin = (g, pos, onEdge = true) => {
    g.translate(pos[0], pos[1], pos[2] + z0);
    if (!wrap) { b.add(g, edge, {}); return; }
    const pa = g.attributes.position, uv = new Float32Array(pa.count * 2);
    for (let i = 0; i < pa.count; i++) {
      let u = clamp((pa.getX(i) - (x0 - w / 2)) / w, 0.003, 0.997), v = clamp((pa.getY(i) + h / 2) / h, 0.003, 0.997);
      if (wrap.flip) u = 1 - u;
      uv[i * 2] = wrap.u0 + u * (wrap.u1 - wrap.u0); uv[i * 2 + 1] = wrap.v0 + v * (wrap.v1 - wrap.v0);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    b.add(g, wrap.mat, { uv: 'keep' });
    void onEdge;
  };
  const pine = c.mat('ash-light', { match: '#d9c3a0' });
  const raw = c.mat('fabric-linen', { color: '#ddd2bf' });
  // wrapped sides (the painting runs round the edge) — thin skins over the stretcher's outer faces
  const sk = d - 0.0006;
  skin(softBox(w, t, sk, { r: 0.0005, seg: 1 }), [x0, h / 2 - t / 2, sk / 2]);
  skin(softBox(w, t, sk, { r: 0.0005, seg: 1 }), [x0, -h / 2 + t / 2, sk / 2]);
  skin(softBox(t, h - 2 * t + 0.0004, sk, { r: 0.0005, seg: 1 }), [x0 - w / 2 + t / 2, 0, sk / 2]);
  skin(softBox(t, h - 2 * t + 0.0004, sk, { r: 0.0005, seg: 1 }), [x0 + w / 2 - t / 2, 0, sk / 2]);
  // stretcher bars (bevelled away from the canvas: 2 mm off its back), 1 mm behind the wrap at the back
  const sd = d - 0.004, sz = z0 + 0.001 + sd / 2;
  b.add(softBox(w - 2 * t, bar, sd, { r: 0.002, seg: 1 }), pine, { pos: [x0, h / 2 - t - bar / 2, sz], axis: 'x' });
  b.add(softBox(w - 2 * t, bar, sd, { r: 0.002, seg: 1 }), pine, { pos: [x0, -h / 2 + t + bar / 2, sz], axis: 'x' });
  b.add(softBox(bar, h - 2 * t - 2 * bar + 0.002, sd, { r: 0.002, seg: 1 }), pine, { pos: [x0 - w / 2 + t + bar / 2, 0, sz], axis: 'y' });
  b.add(softBox(bar, h - 2 * t - 2 * bar + 0.002, sd, { r: 0.002, seg: 1 }), pine, { pos: [x0 + w / 2 - t - bar / 2, 0, sz], axis: 'y' });
  if (Math.max(w, h) > 0.7) {
    if (w >= h) b.add(softBox(bar * 0.8, h - 2 * t - 2 * bar + 0.002, sd - 0.004, { r: 0.002, seg: 1 }), pine, { pos: [x0, 0, sz + 0.002], axis: 'y' });
    else b.add(softBox(w - 2 * t - 2 * bar + 0.002, bar * 0.8, sd - 0.004, { r: 0.002, seg: 1 }), pine, { pos: [x0, 0, sz + 0.002], axis: 'x' });
  }
  // the canvas folded round onto the bars' back (≈ 2.5 cm), and the raw canvas back between the bars
  const fold = Math.min(bar * 0.62, 0.026);
  const e = 0.0006; // folds stop 0.6 mm inside the wrap (no coplanar faces with the skins)
  for (const [fwid, fh, fx, fy] of [[w - 2 * e, fold, 0, h / 2 - e - fold / 2], [w - 2 * e, fold, 0, -h / 2 + e + fold / 2], [fold, h - 2 * fold - 2 * e, -w / 2 + e + fold / 2, 0], [fold, h - 2 * fold - 2 * e, w / 2 - e - fold / 2, 0]]) {
    skin(new THREE.BoxGeometry(fwid, fh, 0.0008), [x0 + fx, fy, -0.0002]); // 0.6 mm proud of the skins' ends
  }
  const back = new THREE.PlaneGeometry(w - 2 * t - 0.004, h - 2 * t - 0.004).rotateY(Math.PI);
  b.add(back, raw, { pos: [x0, 0, z0 + d - 0.0025], axis: 'x' });
}

/**
 * Villar Editions (ART.md §5): a real artwork image on a 4 cm stretched canvas in a slim float frame.
 *   params.image = URL (the engine resolves the Storage key), params.images = [URL, …] one per panel, else one image
 *   across params.panels; params.frame = wood key / metal finish / black / white / none; frameWidth (face, m).
 * The item's dims are the canvas (or the whole diptych/triptych block): the image is cover-cropped to it, never
 * stretched; the frame stands 7 mm off the canvas (the shadow gap) and is outside the dims. The motif is the
 * placeholder while the image loads, and the fallback if it fails. Origin = centre of the back plane (z = 0).
 */
function editionArt(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const images = Array.isArray(p.images) ? p.images.filter((x) => typeof x === 'string' && x) : [];
  const image = typeof p.image === 'string' && p.image ? p.image : images[0];
  const artSeed = hashStr(String(p.motif || '') + (p.colors || []).join(',')) % 100000;
  const fk = String(p.frame || 'oak-light').toLowerCase();
  const framed = !/^(none|canvas|wrap|frameless)/.test(fk);
  const frameMat = !framed ? null : fk.includes('white') ? c.mat('kitchen-front', { color: p.frameColor || '#f2efe9' }) : fk.includes('black') ? c.mat('lacquer', { color: p.frameColor || '#1c1b1a', roughness: 0.5 }) : /brass|gold|champagne/.test(fk) ? c.mat('metal-brass-brushed', p.frameColor ? { color: p.frameColor } : undefined) : c.mat(fk, p.frameColor ? { match: p.frameColor } : undefined);
  const dc = 0.04, gap = 0.007, fw = clamp(cm(p.frameWidth, 0.01), 0.006, 0.02), tray = framed ? 0.005 : 0;
  const panels = Array.isArray(p.panels) && p.panels.length > 1 ? p.panels.map((q) => (Array.isArray(q) ? q : [q?.w, q?.h]).map((v) => cm(v, 0.5))) : [[W, H]];
  const pg = panels.length > 1 ? clamp(cm(p.gap, 0.04), 0, 0.2) : 0;
  const tw = panels.reduce((a, q) => a + q[0], 0) + pg * (panels.length - 1), th = Math.max(...panels.map((q) => q[1]));
  const k = Math.min(W / tw, H / th);
  const one = images.length < panels.length; // one image across the block
  const artFor = (i, pw, ph) => c.mat('canvas', { motif: p.motif, colors: p.colors, w: one ? tw * k : pw, h: one ? th * k : ph, seed: artSeed, image: one ? image : images[i], aspect: one ? tw / th : pw / ph, mirrored: p.mirrored ? true : undefined });
  let x = -tw * k / 2;
  panels.forEach(([pw0, ph0], i) => {
    const pw = pw0 * k, ph = ph0 * k, cx = x + pw / 2;
    const art = artFor(i, pw, ph);
    const u0 = one ? (x + tw * k / 2) / (tw * k) : 0, u1 = one ? (x + pw + tw * k / 2) / (tw * k) : 1;
    const v0 = one ? 0.5 - ph / (th * k) / 2 : 0, v1 = one ? 0.5 + ph / (th * k) / 2 : 1;
    const face = new THREE.PlaneGeometry(pw, ph), fu = face.attributes.uv;
    for (let j = 0; j < fu.count; j++) { const u = p.mirrored ? 1 - fu.getX(j) : fu.getX(j); fu.setXY(j, u0 + u * (u1 - u0), v0 + fu.getY(j) * (v1 - v0)); }
    b.add(face, art, { pos: [cx, 0, tray + dc], uv: 'keep' });
    stretcherBack(b, c, { x0: cx, w: pw, h: ph, d: dc, z0: tray, edge: art, wrap: { mat: art, u0, u1, v0, v1, flip: !!p.mirrored } });
    if (framed) {
      // float frame: an L profile — the face wall (fw thick, 2 mm proud of the canvas) and the tray it sits in,
      // which runs under the 7 mm shadow gap and 2 cm in under the canvas
      const ow = pw + 2 * (gap + fw), oh = ph + 2 * (gap + fw), fd = tray + dc + 0.002;
      const bar = (w, h, bx, by, axis) => b.add(softBox(w, h, fd, { r: Math.min(0.0015, fw / 4), seg: 2 }), frameMat, { pos: [cx + bx, by, fd / 2], axis });
      bar(ow, fw, 0, oh / 2 - fw / 2, 'x'); bar(ow, fw, 0, -oh / 2 + fw / 2, 'x');
      bar(fw, oh - 2 * fw + 0.0004, -ow / 2 + fw / 2, 0, 'y'); bar(fw, oh - 2 * fw + 0.0004, ow / 2 - fw / 2, 0, 'y');
      const lip = gap + 0.02, iw = ow - 2 * fw - 0.0004, ih = oh - 2 * fw - 0.0004;
      for (const [w, h, bx, by] of [[iw, lip, 0, ih / 2 - lip / 2], [iw, lip, 0, -ih / 2 + lip / 2], [lip, ih - 2 * lip - 0.0004, -iw / 2 + lip / 2, 0], [lip, ih - 2 * lip - 0.0004, iw / 2 - lip / 2, 0]]) {
        b.add(new THREE.BoxGeometry(w, h, tray), frameMat, { pos: [cx + bx, by, tray / 2], axis: w > h ? 'x' : 'y' });
      }
      hangingWire(b, c, { hw: ow / 2 - fw / 2, y: oh * 0.25, sag: Math.min(0.04, ow * 0.05), x0: cx });
    } else hangingWire(b, c, { hw: pw / 2 - 0.045, y: ph * 0.25, sag: Math.min(0.04, pw * 0.05), x0: cx });
    x += pw + pg * k;
  });
  return { group: b.build('wall_art'), fit: { axes: '', origin: 'none' } };
}

export function wallArt(c) {
  const { W, H, D, params: p } = c;
  // Villar Editions: an edition is built as one (canvas + float frame + panels) even before its image exists — the
  // motif is its face until the engine passes params.image (curator delta 1)
  if ((typeof p.image === 'string' && p.image) || (Array.isArray(p.images) && p.images.length) || c.item?.edition === true || p.edition === true) return editionArt(c);
  const b = new Builder(c.seed);
  const frameKey = String(p.frame || 'walnut-dark').toLowerCase();
  const depth = clamp(D, 0.015, 0.06);
  const isMirror = /mirror/.test(String(p.kind || p.motif || c.item?.type || ''));
  // the image is a function of motif + palette (not of the product id), so a mirrored pair (params.mirrored) is
  // the same painting flipped
  const artSeed = hashStr(String(p.motif || '') + (p.colors || []).join(',')) % 100000;
  const relief = !!p.relief || /textur|impasto|paste|plaster|relief/.test(String(p.motif || ''));
  const flipU = (g) => { if (!p.mirrored) return g; const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); return g; };
  if (frameKey === 'none' || frameKey.includes('canvas') || frameKey.includes('wrap')) {
    // gallery-wrapped canvas on a stretcher; params.panels = [[w, h], …] (m) + gap → one painting across a
    // triptych/diptych (each panel shows its own slice of the same image)
    const panels = Array.isArray(p.panels) && p.panels.length > 1 ? p.panels.map((q) => (Array.isArray(q) ? q : [q?.w, q?.h]).map((v) => cm(v, 0.5))) : null;
    const gap = panels ? clamp(cm(p.gap, 0.03), 0, 0.2) : 0;
    const art = c.mat('canvas', { motif: p.motif, colors: p.colors, w: W, h: H, seed: artSeed, relief, mirrored: p.mirrored ? true : undefined });
    const bgc = (p.colors || []).find((x) => new THREE.Color(x).getHSL({}).l > 0.75) || '#efe8dc';
    const edge = c.mat('paper', { color: bgc });
    if (panels) {
      const tw = panels.reduce((s, q) => s + q[0], 0) + gap * (panels.length - 1), th = Math.max(...panels.map((q) => q[1]));
      const k = Math.min(W / tw, H / th);
      let x = -tw * k / 2;
      for (const [pw0, ph0] of panels) {
        const pw = pw0 * k, ph = ph0 * k;
        const g = new THREE.PlaneGeometry(pw, ph);
        const uv = g.attributes.uv;
        const u0 = (x + tw * k / 2) / (tw * k), u1 = (x + pw + tw * k / 2) / (tw * k), v0 = 0.5 - ph / (th * k) / 2;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (ph / (th * k)));
        b.add(flipU(g), art, { pos: [x + pw / 2, 0, depth], uv: 'keep' });
        stretcherBack(b, c, { x0: x + pw / 2, w: pw, h: ph, d: depth, edge });
        hangingWire(b, c, { hw: pw / 2 - 0.04, y: ph * 0.25, sag: Math.min(0.03, pw * 0.08), x0: x + pw / 2 });
        x += pw + gap * k;
      }
      return { group: b.build('wall_art') };
    }
    b.add(flipU(new THREE.PlaneGeometry(W, H)), art, { pos: [0, 0, depth], uv: 'keep' });
    stretcherBack(b, c, { w: W, h: H, d: depth, edge });
    hangingWire(b, c, { hw: W / 2 - 0.045, y: H * 0.25, sag: Math.min(0.04, W * 0.06) });
    return { group: b.build('wall_art') };
  }
  const frameMat = frameKey.includes('white') ? c.mat('kitchen-front', { color: '#f2efe9' }) : frameKey.includes('black') ? c.mat('lacquer', { color: '#1c1b1a', roughness: 0.45 }) : frameKey.includes('brass') || frameKey.includes('gold') ? c.mat('metal-brass') : c.mat(frameKey);
  const fw = clamp(cm(p.frameWidth, Math.min(W, H) * 0.035), 0.012, 0.06);
  if (String(p.frameShape || '').includes('arch')) {
    // arch-topped frame: extruded ring + shaped canvas
    const archShape = (w, h) => { const sh = new THREE.Shape(); const r = w / 2; const yb = -H / 2 + (H - h) / 2, yt = yb + h - r; sh.moveTo(-w / 2, yb); sh.lineTo(w / 2, yb); sh.lineTo(w / 2, yt); sh.absarc(0, yt, r, 0, Math.PI, false); sh.lineTo(-w / 2, yb); return sh; };
    const outer = archShape(W, H), inner = archShape(W - 2 * fw, H - 2 * fw);
    outer.holes.push(new THREE.Path(inner.getPoints(48).reverse()));
    const fg = new THREE.ExtrudeGeometry(outer, { depth: depth - 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 48 });
    b.add(fg, frameMat, { pos: [0, 0, 0.002] });
    const ag = new THREE.ShapeGeometry(inner, 48);
    const pa = ag.attributes.position, uv = ag.attributes.uv; const iw = W - 2 * fw, ih = H - 2 * fw;
    for (let i = 0; i < pa.count; i++) uv.setXY(i, (pa.getX(i) + iw / 2) / iw, (pa.getY(i) + ih / 2) / ih);
    const art = c.mat('canvas', { motif: p.motif, colors: p.colors, w: iw, h: ih, seed: artSeed, relief, mirrored: p.mirrored ? true : undefined });
    b.add(ag, art, { pos: [0, 0, depth - 0.006], uv: 'keep' });
    // dust cover: a 2.5 mm kraft board let into the frame back (a single-sided shape here was see-through from behind)
    const kraft = new THREE.ExtrudeGeometry(archShape(W - 2 * fw + 0.004, H - 2 * fw + 0.004), { depth: 0.0025, bevelEnabled: false, curveSegments: 32 });
    b.add(kraft, c.mat('paper', { color: '#9c805f' }), { pos: [0, 0, 0.0015], uv: 'box' });
    hangingWire(b, c, { hw: W / 2 - fw / 2, y: H * 0.2, sag: Math.min(0.04, W * 0.06) });
    return { group: b.build('wall_art') };
  }
  // frame bars (mitred look via overlapping soft boxes)
  const bar = (w, h, x, y, axis) => b.add(softBox(w, h, depth, { r: Math.min(0.003, fw / 4), seg: 2 }), frameMat, { pos: [x, y, depth / 2], axis });
  bar(W, fw, 0, H / 2 - fw / 2, 'x');
  bar(W, fw, 0, -H / 2 + fw / 2, 'x');
  bar(fw, H - 2 * fw + 0.0004, -W / 2 + fw / 2, 0, 'y');
  bar(fw, H - 2 * fw + 0.0004, W / 2 - fw / 2, 0, 'y');
  const iw = W - 2 * fw, ih = H - 2 * fw;
  // backing: a kraft dust cover let 1.5 mm into the frame back (it was a dark sheet), D-rings + wire on the back
  b.add(new THREE.BoxGeometry(iw + 0.0006, ih + 0.0006, 0.003), c.mat('paper', { color: '#9c805f' }), { pos: [0, 0, 0.003] });
  hangingWire(b, c, { hw: W / 2 - fw / 2, y: H * 0.25, sag: Math.min(0.04, W * 0.06) });
  if (isMirror) {
    b.add(new THREE.PlaneGeometry(iw, ih), c.mat('mirror'), { pos: [0, 0, depth - 0.006], uv: 'keep' });
    return { group: b.build('wall_art') };
  }
  const matW = p.mat === false || p.passepartout === false || p.relief || /canvas|холст/i.test(String((c.item?.materials || [])[0] || '')) ? 0 : clamp(cm(p.matWidth, Math.min(iw, ih) * 0.12), 0, Math.min(iw, ih) * 0.3);
  const aw = iw - 2 * matW, ah = ih - 2 * matW;
  const art = c.mat('canvas', { motif: p.motif, colors: p.colors, w: aw, h: ah, seed: artSeed, relief, mirrored: p.mirrored ? true : undefined });
  b.add(flipU(new THREE.PlaneGeometry(aw, ah)), art, { pos: [0, 0, depth - 0.008], uv: 'keep' });
  if (matW > 0) {
    const mm = c.mat('paper', { color: p.matColor || '#f3efe7' });
    const mt = 0.002, z = depth - 0.006;
    b.add(new THREE.BoxGeometry(iw, matW, mt), mm, { pos: [0, ih / 2 - matW / 2, z] });
    b.add(new THREE.BoxGeometry(iw, matW, mt), mm, { pos: [0, -ih / 2 + matW / 2, z] });
    b.add(new THREE.BoxGeometry(matW, ah, mt), mm, { pos: [-iw / 2 + matW / 2, 0, z] });
    b.add(new THREE.BoxGeometry(matW, ah, mt), mm, { pos: [iw / 2 - matW / 2, 0, z] });
  }
  return { group: b.build('wall_art') };
}

// ---------------------------------------------------------------- plants

/** Tapered sweep along a CatmullRom path. radius(t) in metres. Adds per-vertex colour if given. */
function sweep(points, radius, { radial: radial0 = 7, tubular = null } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const n = segs(tubular || Math.max(4, points.length * 3), 3);
  const radial = segs(radial0, 3);
  const frames = curve.computeFrenetFrames(n, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  // UVs in metres: u around (mirrored → no seam), v along the curve (bark fissures run along the trunk)
  const len = curve.getLength(), r0 = radius(0);
  for (let i = 0; i <= n; i++) {
    const t = i / n; curve.getPointAt(t, P);
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      N.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r); nor.push(N.x, N.y, N.z); uv.push((0.5 - Math.abs(j / radial - 0.5)) * 2 * Math.PI * r0, t * len);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b2 = a + radial + 1;
    idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geom: g, curve };
}

/** Merge many leaf instances into one geometry with per-leaf vertex colours. */
class LeafBatch {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.v = 0; this.leaves = []; }
  /** cell = [index, count]: the leaf samples atlas column `index` of `count` (photoscanned leaf atlas). */
  add(tmpl, matrix, color, cell = null) {
    const p = tmpl.attributes.position, n = tmpl.attributes.normal, u = tmpl.attributes.uv;
    this.leaves.push([this.v, p.count, this.idx.length, tmpl.index.array.length, matrix.elements[12], matrix.elements[13], matrix.elements[14]]);
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), vn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix); vn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(vn.x, vn.y, vn.z);
      this.uv.push(cell ? (cell[0] + u.getX(i)) / cell[1] : u.getX(i), u.getY(i));
      const k = tmpl.userData.shade ? tmpl.userData.shade[i] : 1;
      if (Array.isArray(k)) this.col.push(color.r * k[0], color.g * k[1], color.b * k[2]);
      else this.col.push(color.r * k, color.g * k, color.b * k);
    }
    const ix = tmpl.index.array;
    for (let i = 0; i < ix.length; i++) this.idx.push(ix[i] + this.v);
    this.v += p.count;
  }
  get triangles() { return this.idx.length / 3; }
  /**
   * Round 5 triangle budget: keep at most maxTris (≤ 60 k per item on high). Leaves are thinned evenly (a fixed
   * stride pattern, deterministic) and each kept leaf grows about its stalk by (1/f)^0.3 so the canopy keeps its mass.
   */
  cap(maxTris) {
    if (!(maxTris > 0) || this.triangles <= maxTris || !this.leaves.length) return this;
    const f = maxTris / this.triangles, grow = Math.pow(1 / f, 0.3);
    const out = new LeafBatch();
    let acc = 0;
    for (const [v0, vn, i0, iN, ax, ay, az] of this.leaves) {
      acc += f; if (acc < 1) continue; acc -= 1;
      const base = out.v;
      for (let i = 0; i < vn; i++) {
        const k = (v0 + i) * 3;
        out.pos.push(ax + (this.pos[k] - ax) * grow, ay + (this.pos[k + 1] - ay) * grow, az + (this.pos[k + 2] - az) * grow);
        out.nor.push(this.nor[k], this.nor[k + 1], this.nor[k + 2]); out.col.push(this.col[k], this.col[k + 1], this.col[k + 2]);
        out.uv.push(this.uv[(v0 + i) * 2], this.uv[(v0 + i) * 2 + 1]);
      }
      for (let i = 0; i < iN; i++) out.idx.push(this.idx[i0 + i] - v0 + base);
      out.v += vn;
      out.leaves.push([base, vn, out.idx.length - iN, iN, ax, ay, az]);
    }
    return out;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Leaf template: grid in leaf space (u across 0..1, v along 0..1), length L along +Y, width from outline(v).
 * fold = V-fold along midrib, arch = curvature along length, holes = monstera fenestration.
 */
function leafTemplate({ L = 0.06, Wd = 0.012, outline = (v) => Math.sin(Math.PI * Math.min(1, v * 1.05)) ** 0.8, nu: nu0 = 2, nv: nv0 = 4, fold = 0.25, arch = 0.15, wave = 0, holes = null }) {
  const nu = nu0 > 3 ? segs(nu0, 2) : nu0, nv = nv0 > 4 ? segs(nv0, 4) : nv0;
  const pos = [], uv = [], idx = [], shade = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const w = outline(v) * Wd / 2;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu; const s = u * 2 - 1;
      const x = s * w;
      const y = v * L;
      let z = Math.abs(s) * w * fold + Math.sin(v * Math.PI) * L * arch * 0.0 - (v * v) * L * arch;
      if (wave) z += Math.sin(v * 14 + s * 2) * wave * Math.abs(s);
      pos.push(x, y, z); uv.push(u, v); shade.push(0.9 + 0.1 * (1 - Math.abs(s)));
    }
  }
  const m = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (holes && holes((i + 0.5) / nu, (j + 0.5) / nv)) continue;
    const a = j * m + i, b2 = a + 1, c2 = a + m, d = c2 + 1;
    idx.push(a, b2, d, a, d, c2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.shade = shade;
  return g;
}

/**
 * Monstera deliciosa leaf: cordate blade split into lobes by slits that run from the margin toward
 * the midrib along the lateral veins (built as separate lobe strips → clean cuts), length along +Y.
 */
function monsteraLeaf({ L = 0.4, Wd = 0.38, lobes = 7, seed = 1, fold = 0.1, arch = 0.18 }) {
  const r = rng(seed);
  const pos = [], uv = [], idx = [], shade = [];
  const outline = (v) => v < 0.05 ? 0.66 * (1 + v * 1.5) : Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + v * 0.9)), 0.4) * (1 - 0.15 * v);
  const tilt = 0.22; // lateral veins rise toward the margin
  const vert = (sgn, sa, v) => {
    const w = outline(v) * Wd / 2;
    const x = sgn * sa * w, y = v * L;
    const z = sa * w * fold - v * v * L * arch;
    pos.push(x, y, z); uv.push(0.5 + sgn * sa * 0.5, v); shade.push(0.9 + 0.1 * (1 - sa));
    return pos.length / 3 - 1;
  };
  const NS = 6, NV = 3;
  for (const sgn of [-1, 1]) {
    for (let k = 0; k < lobes; k++) {
      const gapK = 0.12 + r() * 0.1, reach = 0.22 + r() * 0.3; // slit width at margin, slit depth start
      const base = pos.length / 3;
      for (let i = 0; i <= NS; i++) {
        const sa = i / NS; // 0 = midrib, 1 = margin
        const g = sa < reach ? 0 : gapK * (0.55 + 0.45 * (sa - reach) / (1 - reach)); // narrow slot, slightly wider at the margin
        for (let j = 0; j <= NV; j++) {
          const ph = k + g / 2 + (1 - g) * (j / NV);
          let v = ph / lobes + sa * tilt * (1 - ph / lobes);
          // cordate base: the first lobe's lower edge sweeps back below the petiole toward the margin
          if (k === 0) v -= (1 - j / NV) * (sa ** 1.5) * (tilt + 0.12);
          v = Math.min(1, Math.max(-0.14, v));
          vert(sgn, sa, v);
        }
      }
      const m = NV + 1;
      for (let i = 0; i < NS; i++) for (let j = 0; j < NV; j++) {
        const a = base + i * m + j, b2 = a + 1, c2 = a + m, d = c2 + 1;
        if (sgn > 0) idx.push(a, c2, d, a, d, b2); else idx.push(a, d, c2, a, b2, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.shade = shade;
  return g;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s3 = new THREE.Vector3();
/** Matrix placing a leaf at p pointing along dir with its upper face (+Z) turned toward `up` (blade horizontal-ish), then twisted. */
function leafMatrixFacing(p, dir, up, twist, scale) {
  const Y = dir.clone().normalize();
  const Z = up.clone().addScaledVector(Y, -up.dot(Y));
  if (Z.lengthSq() < 1e-6) Z.set(1, 0, 0).addScaledVector(Y, -Y.x);
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  if (twist) m.multiply(new THREE.Matrix4().makeRotationY(twist));
  m.scale(_s3.set(scale, scale, scale));
  m.setPosition(p);
  return m;
}

/** Matrix placing a leaf at point p, pointing along dir, with roll around dir and scale. */
function leafMatrix(p, dir, roll, scale) {
  _q.setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize());
  _q2.setFromAxisAngle(V3(0, 1, 0), roll);
  _q.multiply(_q2);
  _s3.set(scale, scale, scale);
  return _m4.clone().compose(p, _q, _s3);
}

function addPot(b, c, { r, h, style, color }) {
  const s = String(style || 'ceramic-matte').toLowerCase();
  let mat;
  if (/rattan|basket|wicker|seagrass|jute/.test(s)) mat = c.mat(/jute|seagrass/.test(s) ? 'jute' : 'rattan');
  else if (/concrete|cement|stone/.test(s)) mat = c.mat('stone-worktop');
  else if (/terracotta|clay/.test(s)) mat = c.mat('ceramic-matte', { color: color || '#b5653f' });
  else if (/travert/.test(s)) mat = c.mat('travertine');
  else if (/glaze/.test(s)) mat = c.mat('ceramic-glazed', { color: color || '#e8e2d6', roughness: 0.3 });
  else mat = c.mat('ceramic-matte', { color: color || '#CBB89A' });
  const shape = String(c.params.potShape || (/basket|rattan/.test(s) ? 'basket' : 'cylinder')).toLowerCase();
  let prof;
  if (shape.includes('bowl')) prof = [[0.001, 0], [r * 0.55, 0], [r * 0.62, 0.006], [r * 0.95, h * 0.55], [r, h * 0.96], [r * 0.96, h], [r * 0.9, h * 0.97], [r * 0.86, h * 0.75]];
  else if (shape.includes('taper')) prof = [[0.001, 0], [r * 0.72, 0], [r * 0.75, 0.008], [r * 0.98, h * 0.94], [r, h], [r * 0.93, h], [r * 0.9, h * 0.85]];
  else if (shape.includes('egg') || shape.includes('round')) prof = [[0.001, 0], [r * 0.5, 0], [r * 0.85, h * 0.25], [r, h * 0.6], [r * 0.85, h * 0.95], [r * 0.8, h], [r * 0.74, h * 0.97], [r * 0.7, h * 0.85]];
  else prof = [[0.001, 0], [r * 0.9, 0], [r * 0.94, 0.006], [r * 0.97, h * 0.5], [r, h * 0.985], [r * 0.985, h], [r * 0.93, h], [r * 0.91, h * 0.9]];
  const pg = lathe(smoothProfile(prof, 48), /rib|flut/.test(s) ? 144 : 48);
  if (/rib|flut/.test(s)) {
    // vertical ribs (~2.4 cm pitch) on the outer wall only, fading at the foot and the rim
    const pa = pg.attributes.position, n = Math.max(16, Math.round((2 * Math.PI * r) / 0.024));
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), z = pa.getZ(i), y = pa.getY(i), rr = Math.hypot(x, z);
      if (rr < r * 0.8 || y > h * 0.97 || y < 0.004) continue;
      const k = 1 + 0.035 * Math.pow(Math.abs(Math.cos(Math.atan2(z, x) * n / 2)), 0.6) * Math.min(1, y / 0.03);
      pa.setX(i, x * k); pa.setZ(i, z * k);
    }
    pg.computeVertexNormals();
  }
  b.add(pg, mat, { uv: 'cyl', axis: 'around' });
  b.potMats = [mat];
  const soilY = h * 0.9;
  const sr = (shape.includes('egg') ? r * 0.72 : r * 0.9);
  const soil = lathe([[sr * 1.01, soilY - 0.03], [sr, soilY - 0.004], [sr * 0.6, soilY + 0.008], [0.001, soilY + 0.012]], 32);
  b.add(soil, c.mat('soil'), { uv: 'box', cast: false });
  b.potMats.push(c.mat('soil'));
  return soilY + 0.008;
}

function plantColors(base, n, r, spread = 0.12) {
  const out = []; const c0 = new THREE.Color(base);
  const hsl = {}; c0.getHSL(hsl);
  for (let i = 0; i < n; i++) out.push(new THREE.Color().setHSL(hsl.h + (r() - 0.5) * 0.04, clamp(hsl.s + (r() - 0.5) * spread, 0, 1), clamp(hsl.l + (r() - 0.5) * spread, 0, 1)));
  return out;
}

export function plant(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const r = rng(c.seed + 17);
  const species = String(p.species || 'olive-tree').toLowerCase();
  const potR = clamp(p.potDiameter ? cm(p.potDiameter) / 2 : Math.min(W * 0.3, H * 0.12, 0.24), 0.05, 0.3);
  const potH = clamp(p.potHeight ? cm(p.potHeight) : potR * 2 * (H > 1.0 ? 0.95 : 0.85), 0.08, 0.6);
  const soilY = addPot(b, c, { r: potR, h: potH, style: p.pot, color: p.potColor });
  const leaves = new LeafBatch();
  const stems = [];
  let kind = 'olive';
  if (/fiddle|lyrata|rubber|elastica|audrey|benghal|ficus/.test(species)) kind = 'fiddle';
  else if (/bird|strelitzia|banana|musa|heliconia/.test(species)) kind = 'bird';
  else if (/monstera|philo|calathea|alocasia/.test(species)) kind = 'monstera';
  else if (/snake|sansev|zz|aloe|yucca|dracaena|cactus/.test(species)) kind = 'snake';
  else if (/palm|areca|kentia|fern/.test(species)) kind = 'palm';
  // every leaf transmits light (back-lit translucency) and has its own underside tone (see materials 'plant-leaf');
  // the olive uses the photoscanned lanceolate leaf atlas (alpha-cut blade) and a silver underside
  const leafMat = c.mat('plant-leaf', { vertexColors: true, roughness: species.includes('fiddle') || species.includes('rubber') ? 0.32 : 0.5, ...(kind === 'olive' ? { scan: 'leaf', under: 'olive' } : {}) });
  const stemMat = c.mat('plant-stem', { color: /monstera|philo|calathea|alocasia|bird|strelitzia|banana|musa/.test(species) ? '#5b6e3a' : '#6b6248' });
  // grey-brown fissured bark (R2-17), always darker than the pot; fiddle/rubber stems are smoother and greener
  const barkMat = c.mat('bark', { color: /fiddle|lyrata|rubber|elastica|audrey|ficus/.test(species) ? '#b9b39a' : '#ffffff', scale: 0.4 });

  // LOD: fewer but larger leaves keep the canopy mass on medium / low
  const dens = [0.34, 0.58, 1][getLOD()], leafK = 1 / Math.pow(dens, 0.35);
  if (kind === 'olive') {
    // multi-stem olive: short trunk splitting into 3 leaders, airy rounded canopy of ~1500 silver-green leaves
    const crownY = lerp(soilY, H, 0.42), top = H;
    const trunkPts = [V3(0, soilY - 0.03, 0)];
    let x = 0, z = 0;
    for (let i = 1; i <= 4; i++) { x += (r() - 0.5) * 0.035; z += (r() - 0.5) * 0.035; trunkPts.push(V3(x, lerp(soilY, crownY, i / 4), z)); }
    const tr = sweep(trunkPts, (t) => lerp(0.032, 0.02, t) * (1 + 0.12 * Math.sin(t * 17 + 1)), { radial: 10 });
    b.add(tr.geom, barkMat, { uv: 'keep' });
    // blade card a little wider than the leaf: the scanned alpha cuts the real lanceolate outline
    const tmpl = leafTemplate({ L: 0.075, Wd: 0.018, outline: (v) => 0.32 + 0.68 * Math.pow(Math.sin(Math.PI * Math.min(1, v)), 0.5), nu: 2, nv: 3, fold: 0.22, arch: 0.17 });
    // upper face: dark grey-green (the silver underside is the material's back-face tone)
    const cols = plantColors('#5c6846', 32, r, 0.16);
    const canopy = { c: V3(0, lerp(crownY, top, 0.56), 0), rx: W / 2 * 0.8, ry: (top - crownY) * 0.52 };
    const leafAt = (lp, tan, k) => {
      const rel = lp.clone().sub(canopy.c);
      const e = Math.hypot(rel.x / canopy.rx, rel.y / canopy.ry, rel.z / canopy.rx);
      if (e > 1.16) return;
      const side = k % 2 ? 1 : -1;
      const perp = V3(-tan.z, 0, tan.x).normalize().multiplyScalar(side);
      // olive leaves sit in opposite pairs at an acute angle to the twig (30–50°), tips up and out
      const ld = tan.clone().multiplyScalar(0.9 + r() * 0.3).add(perp.multiplyScalar(0.75)).add(V3(0, -0.1 + r() * 0.45, 0)).normalize();
      leaves.add(tmpl, leafMatrix(lp, ld, r() * Math.PI, (0.75 + r() * 0.5) * leafK), cols[(r() * cols.length) | 0], [r() < 0.5 ? 0 : 1, 2]);
    };
    const branch = (start, dir, len, rad, depth) => {
      const pts = [start.clone()];
      const d = dir.clone().normalize();
      const n = depth === 0 ? 5 : 3;
      for (let i = 1; i <= n; i++) {
        d.x += (r() - 0.5) * 0.4; d.z += (r() - 0.5) * 0.4; d.y += depth === 0 ? 0.05 : -0.02; d.normalize();
        const np = pts[i - 1].clone().addScaledVector(d, len / n);
        // pull back inside the canopy envelope
        const rel = np.clone().sub(canopy.c);
        const e = Math.hypot(rel.x / canopy.rx, rel.y / canopy.ry, rel.z / canopy.rx);
        // pull back inside the envelope (twigs never poke out bare past the foliage)
        if (e > 0.95) np.sub(rel.multiplyScalar(0.7 * (e - 0.95) / e));
        pts.push(np);
      }
      const sw = sweep(pts, (t) => lerp(rad, rad * 0.5, t), { radial: depth === 0 ? 7 : depth === 1 ? 5 : 4, tubular: depth === 0 ? 14 : 6 });
      b.add(sw.geom, depth === 0 ? barkMat : stemMat, { uv: 'keep' });
      if (depth < 2) {
        const kids = depth === 0 ? 5 : 4;
        for (let k = 0; k < kids; k++) {
          const t = 0.35 + 0.65 * ((k + r() * 0.5) / kids);
          const sp = sw.curve.getPointAt(Math.min(1, t));
          const tan = sw.curve.getTangentAt(Math.min(1, t));
          const a = r() * Math.PI * 2;
          const out = V3(Math.cos(a), 0.25 + r() * 0.5, Math.sin(a)).normalize();
          branch(sp, tan.clone().multiplyScalar(0.6).add(out).normalize(), len * (0.5 + r() * 0.15), rad * 0.55, depth + 1);
        }
      }
      if (depth >= 1) {
        const count = Math.round((depth === 2 ? 42 : 20) * dens);
        for (let k = 0; k < count; k++) {
          const t = 0.2 + 0.8 * (k / count);
          leafAt(sw.curve.getPointAt(t), sw.curve.getTangentAt(t), k);
        }
        // tip tuft
        const tip = sw.curve.getPointAt(1), tt = sw.curve.getTangentAt(1);
        for (let k = 0; k < Math.round(5 * dens); k++) leafAt(tip.clone().add(V3((r() - 0.5) * 0.02, (r() - 0.5) * 0.02, (r() - 0.5) * 0.02)), tt.clone().add(V3(r() - 0.5, r() - 0.3, r() - 0.5)).normalize(), k);
      }
    };
    const nMain = 3 + (r() < 0.5 ? 1 : 0);
    const tip = trunkPts[trunkPts.length - 1];
    for (let i = 0; i < nMain; i++) {
      const a = (i / nMain) * Math.PI * 2 + r() * 0.8;
      branch(tip.clone().add(V3(0, -0.02 * i, 0)), V3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5), (top - crownY) * 0.62, 0.016, 0);
    }
  } else if (kind === 'fiddle') {
    const stemsN = clamp(Math.round(p.stems || 1), 1, 3);
    const audrey = /audrey|benghal|elastica|rubber|ficus(?!.*lyrata)/.test(species) && !/fiddle|lyrata/.test(species);
    const tmpl = audrey ? leafTemplate({ L: 0.16, Wd: 0.1, outline: (v) => Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.02)), 0.7), nu: 4, nv: 7, fold: 0.15, arch: 0.15 }) : leafTemplate({ L: 0.28, Wd: 0.2, outline: (v) => { const a = Math.sin(Math.PI * Math.min(1, v * 1.02)) ** 0.6; return a * (0.62 + 0.38 * Math.sin(v * Math.PI * 0.9) ** 2) * (v > 0.85 ? 1 - (v - 0.85) * 2.2 : 1); }, nu: 6, nv: 10, fold: 0.18, arch: 0.22, wave: 0.004 });
    const cols = plantColors(audrey ? '#4d6b3a' : '#3f5f2e', 20, r, 0.1);
    for (let s = 0; s < stemsN; s++) {
      const ox = (s - (stemsN - 1) / 2) * 0.05;
      const pts = [V3(ox, soilY - 0.02, 0)];
      for (let i = 1; i <= 6; i++) pts.push(V3(ox + (r() - 0.5) * 0.03 + ox * i * 0.3, lerp(soilY, H - 0.12 - s * 0.12, i / 6), (r() - 0.5) * 0.03));
      const sw = sweep(pts, (t) => lerp(0.016, 0.008, t), { radial: 8 });
      b.add(sw.geom, barkMat, { uv: 'keep' });
      const n = audrey ? 34 : 22;
      for (let k = 0; k < n; k++) {
        const t = (audrey ? 0.45 : 0.35) + (audrey ? 0.55 : 0.65) * (k / (n - 1));
        const lp = sw.curve.getPointAt(t);
        const a = k * 2.4 + s;
        const out = V3(Math.cos(a), 0.55 + t * 0.5, Math.sin(a)).normalize();
        const sc = (0.8 + 0.3 * Math.sin(t * Math.PI)) * clamp(W / 0.55, 0.75, 1.35) * (t > 0.95 ? 0.7 : 1);
        leaves.add(tmpl, leafMatrix(lp.clone().addScaledVector(out, 0.02), out, a + Math.PI / 2 + (r() - 0.5) * 0.6, sc), cols[(r() * cols.length) | 0]);
      }
    }
  } else if (kind === 'bird') {
    // Strelitzia nicolai: long upright petioles, large paddle leaves with natural tears
    const n = 8;
    const cols = plantColors('#3e5c34', 12, r, 0.1);
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996 + r() * 0.5;
      const lean = 0.06 + r() * 0.3;
      const avail = H - soilY;
      const L = clamp(avail * (0.3 + r() * 0.08), 0.25, 0.65);
      const petL = Math.max(0.2, (avail - L * Math.cos(lean * 1.3)) * (0.7 + r() * 0.3));
      const out = V3(Math.cos(a), 0, Math.sin(a));
      const base = V3(Math.cos(a) * 0.03, soilY - 0.01, Math.sin(a) * 0.03);
      const top = base.clone().addScaledVector(out, Math.sin(lean) * petL).add(V3(0, Math.cos(lean) * petL, 0));
      const mid = base.clone().lerp(top, 0.5).addScaledVector(out, -0.01);
      const sw = sweep([base, mid, top], (t) => lerp(0.014, 0.008, t), { radial: 6, tubular: 10 });
      b.add(sw.geom, stemMat, { uv: 'keep' });
      const tears = Array.from({ length: 4 + ((r() * 4) | 0) }, () => [0.2 + r() * 0.7, r() < 0.5 ? -1 : 1, 0.25 + r() * 0.6]);
      const tmpl = leafTemplate({ L, Wd: L * 0.36, outline: (v) => Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.0)), 0.6), nu: 8, nv: 30, fold: 0.1, arch: 0.12, wave: 0.004,
        holes: (u, v) => tears.some(([tv, sd, dp]) => Math.abs(v - tv) < 0.018 && Math.sign(u - 0.5) === sd && Math.abs(u * 2 - 1) > 1 - dp) });
      const dir = top.clone().sub(base).normalize().addScaledVector(out, 0.35).normalize();
      leaves.add(tmpl, leafMatrix(top, dir, a + Math.PI / 2 + (r() - 0.5) * 0.8, 1), cols[(r() * cols.length) | 0]);
    }
  } else if (kind === 'monstera' || kind === 'palm') {
    const isPalm = kind === 'palm';
    const nLeaves = isPalm ? 9 : 11;
    const leafL = isPalm ? 0.12 : clamp(H * 0.3, 0.18, 0.42);
    // fenestration: slits from the margin toward the midrib following the lateral veins + small oval holes
    const holes = isPalm ? null : (u, v) => {
      const sgn = u < 0.5 ? 0 : 1, s = Math.abs(u * 2 - 1);
      if (v < 0.1 || v > 0.9) return false;
      const ph = (v - s * 0.22) * 6.5;
      const idx = Math.floor(ph), f = ph - idx;
      const hsh = Math.abs(Math.sin(idx * 12.9898 + sgn * 78.233) * 43758.5453) % 1;
      if (s > 0.42 + hsh * 0.25 && Math.abs(f - 0.5) < 0.07) return true;
      if (hsh > 0.35 && s > 0.17 && s < 0.32 && Math.abs(f - 0.5) < 0.12 && v > 0.2 && v < 0.78) return true;
      return false;
    };
    const monsteraOutline = (v) => { const a = Math.sin(Math.PI * Math.min(1, 0.06 + v * 0.94)); return Math.pow(a, 0.45) * (1 - 0.2 * v); };
    const tmpls = isPalm ? [leafTemplate({ L: 0.2, Wd: 0.025, nu: 2, nv: 4, fold: 0.3, arch: 0.25 })] : [0, 1, 2].map((q) => monsteraLeaf({ L: leafL, Wd: leafL * 1.15, lobes: 6, seed: c.seed + q * 31 }));
    const tmpl = tmpls[0];
    void holes; void monsteraOutline;
    const cols = plantColors(isPalm ? '#4f6d36' : '#2f5428', 20, r, 0.1);
    for (let k = 0; k < nLeaves; k++) {
      const a = (k / nLeaves) * Math.PI * 2 * 1.618 + r() * 0.4;
      const tilt = isPalm ? 0.25 + r() * 0.7 : 0.35 + r() * 0.75;
      const sh = (H - soilY) * (isPalm ? 0.55 + r() * 0.4 : 0.4 + r() * 0.55) - (isPalm ? 0 : leafL * 0.45);
      const outv = V3(Math.cos(a), 0, Math.sin(a));
      const base = V3(Math.cos(a) * 0.02, soilY - 0.01, Math.sin(a) * 0.02);
      const tipStem = base.clone().addScaledVector(outv, Math.sin(tilt) * sh * (isPalm ? 0.5 : 0.75)).add(V3(0, Math.cos(tilt * 0.6) * sh, 0));
      const mid = base.clone().lerp(tipStem, 0.5).add(V3(0, sh * 0.08, 0)).addScaledVector(outv, -0.02);
      const sw = sweep([base, mid, tipStem], (t) => lerp(isPalm ? 0.006 : 0.009, 0.005, t), { radial: 6, tubular: 10 });
      b.add(sw.geom, stemMat, { uv: 'keep' });
      if (isPalm) {
        // frond: arching rachis with leaflets on both sides
        const fr = [tipStem.clone()];
        const d = outv.clone().multiplyScalar(0.6).add(V3(0, 0.7, 0)).normalize();
        for (let i = 1; i <= 5; i++) { d.y -= 0.22; d.normalize(); fr.push(fr[i - 1].clone().addScaledVector(d, W * 0.12)); }
        const rs = sweep(fr, (t) => lerp(0.004, 0.0015, t), { radial: 4, tubular: 12 });
        b.add(rs.geom, stemMat, { uv: 'keep' });
        for (let i = 0; i < 22; i++) {
          const t = 0.08 + 0.9 * (i / 22);
          const lp = rs.curve.getPointAt(t); const tan = rs.curve.getTangentAt(t);
          for (const sd of [-1, 1]) {
            const perp = V3(-tan.z, 0, tan.x).normalize().multiplyScalar(sd);
            const ld = perp.clone().add(tan.clone().multiplyScalar(0.8)).add(V3(0, -0.25, 0)).normalize();
            leaves.add(tmpl, leafMatrix(lp, ld, Math.PI / 2, (1 - t * 0.5) * clamp(W / 0.6, 0.6, 1.4)), cols[(r() * cols.length) | 0]);
          }
        }
      } else {
        const ld = outv.clone().multiplyScalar(Math.sin(tilt) + 0.4).add(V3(0, Math.cos(tilt) * 0.5, 0)).normalize();
        // blade faces up and slightly outward, tip droops away from the plant
        const face = V3(0, 1, 0).addScaledVector(outv, 0.35);
        leaves.add(tmpls[k % tmpls.length], leafMatrixFacing(tipStem, ld, face, (r() - 0.5) * 0.35, 0.75 + r() * 0.35), cols[(r() * cols.length) | 0]);
      }
    }
  } else {
    // snake plant: upright sword blades with banding
    const n = 12;
    // pattern lives in the 'snake' leaf map; vertex colour only varies each blade by a few %
    const cols = plantColors('#f2f2ee', 10, r, 0.06);
    const snakeMat = c.mat('plant-leaf', { vertexColors: true, pattern: 'snake', roughness: 0.42 });
    const blades = new LeafBatch();
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, rad = r() * potR * 0.55;
      const L = (H - soilY) * (0.6 + r() * 0.4);
      const Wd = 0.05 + r() * 0.025;
      const tmpl = leafTemplate({ L, Wd, outline: (v) => Math.min(1, Math.sin(Math.PI * Math.min(1, v * 0.98)) ** 0.25) * (1 - v * 0.35), nu: 8, nv: 34, fold: 0.35, arch: 0.02 });
      tmpl.userData.shade = null;
      const dir = V3(Math.cos(a) * 0.15 * (0.5 + r()), 1, Math.sin(a) * 0.15 * (0.5 + r())).normalize();
      blades.add(tmpl, leafMatrix(V3(Math.cos(a) * rad, soilY - 0.01, Math.sin(a) * rad), dir, a + r(), 1), cols[(r() * cols.length) | 0]);
    }
    b.add(blades.geometry(), snakeMat, { uv: 'keep' });
  }
  // triangle budget per item (round 5): high ≤ 58 k, medium ≤ 38 k, low ≤ 24 k — the canopy gives way first
  const budget = [24000, 38000, 58000][getLOD()];
  const lg = leaves.cap(budget - b.triangles()).geometry();
  b.add(lg, leafMat, { uv: 'keep' });
  const group = b.build('plant');
  // fit the foliage to the catalogue footprint exactly (scale branches + leaves about the trunk axis);
  // the pot keeps its real size
  const fol = group.children.filter((m) => !(b.potMats || []).includes(m.material));
  const bb = new THREE.Box3();
  for (const m of fol) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox); }
  if (!bb.isEmpty()) {
    const sx = clamp(W / Math.max(1e-3, 2 * Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x))), 0.5, 1.8);
    const sz = clamp(c.D / Math.max(1e-3, 2 * Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z))), 0.5, 1.8);
    for (const m of fol) {
      const pa = m.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); const k = clamp((y - soilY) / 0.25, 0, 1); pa.setX(i, pa.getX(i) * (1 + (sx - 1) * k)); pa.setZ(i, pa.getZ(i) * (1 + (sz - 1) * k)); }
      const na = m.geometry.attributes.normal;
      for (let i = 0; i < na.count; i++) { const k = clamp((pa.getY(i) - soilY) / 0.25, 0, 1); const nx = na.getX(i) / (1 + (sx - 1) * k), nz = na.getZ(i) / (1 + (sz - 1) * k), ny = na.getY(i); const l = Math.hypot(nx, ny, nz) || 1; na.setXYZ(i, nx / l, ny / l, nz / l); }
      pa.needsUpdate = true; na.needsUpdate = true; m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere();
    }
  }
  return { group };
}

// ---------------------------------------------------------------- decor set

function book(b, c, { w, d, t, color, x, y, z, rotY = 0 }) {
  const cover = c.mat('fabric-linen', { color });
  const pages = c.mat('pages');
  const g = new THREE.Group();
  const ct = 0.0022;
  const m = new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), rotY), V3(1, 1, 1));
  const add = (geom, mat, pos, opt = {}) => { geom.translate(...pos); geom.applyMatrix4(m); b.add(geom, mat, { uv: opt.uv || 'box', axis: opt.axis || 'x' }); };
  add(softBox(w, ct, d, { r: 0.001, seg: 1 }), cover, [0, ct / 2, 0]);
  add(softBox(w, ct, d, { r: 0.001, seg: 1 }), cover, [0, t - ct / 2, 0]);
  // spine (rounded) on -x side
  const sp = new THREE.CylinderGeometry(t / 2, t / 2, d, 10, 1, false, Math.PI, Math.PI); sp.rotateX(Math.PI / 2); sp.scale(0.35, 1, 1);
  add(sp, cover, [-w / 2 + 0.001, t / 2, 0]);
  // page block (inset), with page lines running along v
  const pb = new THREE.BoxGeometry(w - 0.006, t - 2 * ct, d - 0.006);
  add(pb, pages, [0.001, t / 2, 0], { axis: 'x' });
  void g;
}

function vaseProfile(kind, h, r) {
  switch (kind) {
    case 'vase-tall': case 'bottle': return [[0.001, 0], [r * 0.7, 0], [r * 0.76, 0.006], [r, h * 0.35], [r * 0.82, h * 0.62], [r * 0.32, h * 0.82], [r * 0.28, h * 0.97], [r * 0.34, h], [r * 0.26, h * 0.99], [r * 0.24, h * 0.9]];
    case 'vase-round': case 'vase': return [[0.001, 0], [r * 0.5, 0], [r * 0.9, h * 0.3], [r, h * 0.55], [r * 0.72, h * 0.85], [r * 0.4, h * 0.97], [r * 0.42, h], [r * 0.34, h * 0.98], [r * 0.3, h * 0.88]];
    case 'jar': return [[0.001, 0], [r * 0.8, 0], [r, h * 0.3], [r, h * 0.8], [r * 0.7, h * 0.95], [r * 0.7, h], [r * 0.62, h], [r * 0.6, h * 0.9]];
    case 'bowl': return [[0.001, 0], [r * 0.45, 0], [r * 0.5, 0.006], [r * 0.85, h * 0.45], [r, h], [r * 0.95, h], [r * 0.82, h * 0.5], [r * 0.4, h * 0.12], [0.001, h * 0.1]];
    case 'candle': return [[0.001, 0], [r, 0], [r, h], [r * 0.9, h], [0.001, h * 0.98]];
    default: return [[0.001, 0], [r, 0], [r, h], [0.001, h]];
  }
}

/**
 * Catalogue material hints → objects. Parallel lists map 1:1; shorter lists are assigned by affinity (stone/wood →
 * tray, terracotta → the most terracotta-coloured piece, wood → the darkest piece, wax → candle, leather → box);
 * objects left over take the set's ceramic hint.
 */
function assignHints(kinds, hints, colors) {
  const H = hints.filter(Boolean);
  if (!H.length) return null;
  if (hints.length === kinds.length) return hints;
  const out = kinds.map(() => null);
  const lum = (i) => { const h = colors[i % (colors.length || 1)]; if (!h) return 0.5; const c3 = new THREE.Color(h); return c3.r * 0.2126 + c3.g * 0.7152 + c3.b * 0.0722; };
  const warm = (i) => { const h = colors[i % (colors.length || 1)]; if (!h) return 0; const c3 = new THREE.Color(h); return c3.r - c3.b; };
  const score = (k, i, h) => {
    if (/travert|marble|stone/.test(h)) return (/tray/.test(k) ? 3 : 0) + (/bowl/.test(k) ? 1 : 0);
    if (/walnut|oak|teak|ash|wood/.test(h)) return (/tray|box/.test(k) ? 1.5 : 0) + (lum(i) < 0.12 ? 2 : 0);
    if (/terracotta/.test(h)) return warm(i) > 0.25 ? 3 : 0;
    if (/leather/.test(h)) return /box/.test(k) ? 3 : 0;
    if (/metal|brass/.test(h)) return /candlestick|tray/.test(k) ? 2 : 0;
    if (/glass/.test(h)) return /vase|bottle/.test(k) ? 1 : 0;
    return 0;
  };
  for (const h of H) {
    let best = -1, bs = 0;
    kinds.forEach((k, i) => { if (out[i]) return; const s = score(k, i, h); if (s > bs) { bs = s; best = i; } });
    if (best >= 0) out[best] = h;
  }
  const ceramic = H.find((h) => /ceram|stoneware/.test(h));
  return out.map((h, i) => h || (ceramic && !/candle|sprig|stem|book/.test(kinds[i]) ? ceramic : null));
}

export function decorSet(c) {
  const { W, D, H, params: p } = c;
  const b = new Builder(c.seed);
  const r = rng(c.seed + 3);
  // items: 'vase-tall' | 'vase-tall:travertine' | { type, material, color }; params.materials[i] also accepted
  const raw = p.items && p.items.length ? p.items : ['vase-tall', 'books', 'bowl'];
  const hints = assignHints(raw.map((s) => String(typeof s === 'object' ? s.type || s.kind || 'vase' : s).split(':')[0].toLowerCase()), p.materialHints || [], p.colors || []);
  const itemMats = raw.map((s, i) => (typeof s === 'object' ? s.material : String(s).split(':')[1]) || (p.materials && p.materials[i]) || (hints && hints[i]) || null);
  const heights = (p.heights || []).map((h) => cm(h, null));
  const itemCols = raw.map((s) => (typeof s === 'object' ? s.color : null));
  const list = raw.map((s) => String(typeof s === 'object' ? s.type || s.kind || 'vase' : s).split(':')[0].toLowerCase());
  let curIdx = 0;
  const lights = [];
  const colors = p.colors && p.colors.length ? p.colors : ['#CBB89A', '#3B3B3B', '#B5653F'];
  const col = (i) => colors[i % colors.length];
  // footprint per item ('sprig' goes into the preceding vase: no footprint of its own)
  const fp = list.map((k, i) => (k.includes('sprig') || k.includes('stem') ? (i > 0 && /vase|bottle/.test(list[i - 1]) ? 0 : 0.06)
    : k.includes('book') ? 0.24 : k.includes('tray') ? Math.min(W, 0.36) : k.includes('candles') ? 0.17 : k.includes('bowl') ? Math.min(0.22, W * 0.45)
      : k.includes('bud') ? 0.075 : k.includes('box') ? 0.15 : k.includes('tall') || k.includes('bottle') ? 0.12 : k.includes('candle') ? 0.08 : 0.13));
  let lastVase = null;
  const total = fp.reduce((a, v) => a + v, 0) + 0.03 * (list.length - 1);
  const k0 = Math.min(1, W / total);
  let x = -Math.min(W, total) / 2;
  let booksTop = null;
  let trayY = 0;
  const trayIdx = list.findIndex((k) => k.includes('tray'));
  if (trayIdx >= 0) {
    // the tray carries the other objects: draw it first, full width, then lay the rest out on it
    const tw = Math.min(W, Math.max(0.3, total * 0.8)), td = Math.min(D, 0.26);
    const tm = objMat(c, itemMats[trayIdx] || p.trayMaterial || 'walnut-dark', itemCols[trayIdx] || col(trayIdx));
    b.add(slab(roundedRectShape(tw, td, 0.03), 0.012, { bevel: 0.003 }), tm, {});
    b.add(tube([...Array(33)].map((_, j) => { const a = (j / 32) * Math.PI * 2; const ca = Math.cos(a), sa = Math.sin(a); return V3(Math.sign(ca) * Math.pow(Math.abs(ca), 0.4) * (tw / 2 - 0.004), 0.018, Math.sign(sa) * Math.pow(Math.abs(sa), 0.4) * (td / 2 - 0.004)); }), 0.0045, { tubular: 96, radial: 5, closed: true }), tm, {});
    trayY = 0.012;
    fp[trayIdx] = 0;
    const tot2 = fp.reduce((a, v) => a + v, 0) + 0.025 * (list.length - 2);
    x = -Math.min(tw - 0.04, tot2) / 2;
  }
  list.forEach((kind, i) => {
    curIdx = i;
    if (i === trayIdx) return;
    const w = fp[i] * k0;
    let cx = x + w / 2; let cz = (i % 2 ? 0.25 : -0.2) * D * 0.5; let baseY = 0;
    const color = itemCols[i] || col(i);
    if (kind.includes('book')) {
      const n = 2 + (r() < 0.5 ? 1 : 0);
      let y = 0;
      const bc = ['#3b3b3b', '#d9cdb8', '#7a7b55', '#b5653f', '#e6ddcf', '#5a4a3a'];
      for (let k = 0; k < n; k++) {
        const bw = Math.min(w, 0.24 - k * 0.02 - r() * 0.02), bd = Math.min(D * 0.9, 0.17 - k * 0.01), bt = 0.022 + r() * 0.014;
        book(b, c, { w: bw, d: bd, t: bt, color: k === 0 ? color : bc[(k * 2 + i) % bc.length], x: cx, y, z: cz * 0.3, rotY: (r() - 0.5) * 0.25 });
        y += bt;
      }
      booksTop = { x: cx, y, z: cz * 0.3 };
    } else if ((kind.includes('bowl') || kind.includes('sculpt') || kind.includes('object') || kind.includes('candle') || kind.includes('stone')) && booksTop && list.indexOf(kind) === list.findIndex((q) => q === kind) && i === list.findIndex((q) => q.includes('book')) + 1 && !kind.includes('bowl')) {
      cx = booksTop.x; cz = booksTop.z; baseY = booksTop.y; addSmall(kind, cx, baseY, cz, color);
    } else if (kind.includes('tray')) {
      const tw = w, td = Math.min(D, 0.24);
      b.add(slab(roundedRectShape(tw, td, 0.03), 0.012, { bevel: 0.003 }), c.mat(p.trayMaterial || 'walnut-dark'), { pos: [cx, 0, cz * 0.2] });
      b.add(tube([...Array(33)].map((_, j) => { const a = (j / 32) * Math.PI * 2; return V3(cx + Math.cos(a) * (tw / 2 - 0.004), 0.02, cz * 0.2 + Math.sin(a) * (td / 2 - 0.004)); }), 0.004, { tubular: 64, radial: 5, closed: true }), c.mat(p.trayMaterial || 'walnut-dark'), {});
    } else {
      addSmall(kind, cx, trayY, trayY ? cz * 0.3 : cz, color);
    }
    x += w + 0.03 * k0;
  });

  function addSmall(kind, cx, y0, cz, color) {
    let mk = itemMats[curIdx];
    if (mk && mk.includes(':')) { color = mk.split(':')[1]; mk = mk.split(':')[0]; }
    const HH = heights[curIdx];
    // PT-04: every object uses its own material hint + colour (wood/travertine get a calibrated colour match)
    const auto = /glaze|gloss/.test(kind) ? 'ceramic-glazed' : /brass|candlestick/.test(kind) ? 'metal-brass' : /travert/.test(kind) ? 'travertine' : /marble/.test(kind) ? 'marble-white' : /wood|walnut/.test(kind) ? 'walnut-dark' : 'ceramic-matte';
    const mkey = mk && !/wax|paper|воск/.test(mk) ? mk : auto;
    const ceramic = /amber|glass/.test(kind) && !mk ? c.mat('glass-amber') : objMat(c, mkey, color);
    if (kind.includes('sprig') || kind.includes('stem')) {
      // a few stems (eucalyptus by default) in the preceding vase, or a single sprig laid down
      const v = lastVase || { x: cx, y: y0 + 0.004, z: cz };
      addStems(b, c, { kind: /olive/.test(kind) ? 'olive' : /grass|pampas/.test(kind) ? 'grass' : 'eucalyptus', n: lastVase ? 3 : 1, x0: v.x, y0: v.y, z0: v.z, H: Math.max(0.08, (HH || Math.min(0.2, H * 0.6))), spread: 0.035, r, leafColor: color && /^#/.test(color) ? color : null });
      return;
    }
    if (kind.includes('candle') && !kind.includes('stick') && !kind.includes('holder')) {
      // pillar candles (wax, own colour) with a flame that glows at night; 'candles' = a trio of heights
      const wax = c.mat('wax', { color: color || '#F1EEE6' });
      const many = kind.includes('candles');
      const top = HH || (many ? 0.2 : 0.09);
      const hs = many ? [top, top * 0.7, top * 0.48] : [top];
      const R = many ? 0.034 : Math.min(0.04, Math.max(0.03, top * 0.4));
      hs.forEach((h, k) => {
        const x = cx + (many ? (k - 1) * (R * 2 + 0.012) : 0), z = cz + (many ? (k % 2 ? 0.014 : -0.01) : 0);
        if (mk && /ceram|stone|travert|glass/.test(mk) && !many) {
          // candle in a holder (ceramic / travertine tealight cup)
          b.add(lathe(smoothProfile([[0.001, 0], [R + 0.012, 0], [R + 0.014, 0.008], [R + 0.01, Math.min(0.06, h * 0.55)], [R + 0.004, Math.min(0.06, h * 0.55)], [R + 0.004, 0.008], [0.001, 0.008]], 20), 32), ceramic, { pos: [x, y0, z], uv: 'box' });
        }
        b.add(lathe(smoothProfile([[0.001, 0], [R - 0.002, 0], [R, 0.003], [R, h - 0.004], [R - 0.003, h], [R * 0.7, h - 0.006], [0.004, h - 0.009], [0.001, h - 0.009]], 24), 24), wax, { pos: [x, y0 + (mk && !many && /ceram|stone|travert|glass/.test(mk) ? 0.008 : 0), z], uv: 'box' });
        addFlame(b, c, x, y0 + h - 0.009 + (mk && !many && /ceram|stone|travert|glass/.test(mk) ? 0.008 : 0), z, lights);
      });
      return;
    }
    if (kind.includes('bud')) {
      // bud vase: small bottle with a narrow neck
      const h = HH || 0.12, rr = Math.min(0.036, Math.max(0.026, h * 0.3));
      b.add(lathe(smoothProfile([[0.001, 0], [rr * 0.8, 0], [rr, h * 0.12], [rr, h * 0.45], [rr * 0.5, h * 0.72], [rr * 0.32, h * 0.9], [rr * 0.38, h], [rr * 0.26, h], [rr * 0.22, h * 0.9], [rr * 0.3, h * 0.72], [rr * 0.85, h * 0.45], [rr * 0.85, h * 0.1], [0.001, h * 0.06]], 28), 32), ceramic, { pos: [cx, y0, cz], uv: 'box' });
      lastVase = { x: cx, y: y0 + h, z: cz };
      return;
    }
    if (kind.includes('tall') || kind.includes('bottle')) {
      const h = HH || Math.min(H * 0.92, 0.34), rr = Math.min(0.07, h * 0.18);
      b.add(lathe(smoothProfile(vaseProfile('vase-tall', h, rr), 40), 40), ceramic, { pos: [cx, y0, cz], uv: 'box' });
      lastVase = { x: cx, y: y0 + h, z: cz };
      if (list[curIdx + 1] && /sprig|stem/.test(list[curIdx + 1])) return;
      // dried branches
      if (p.stems !== false && H - (y0 + h) > 0.08) {
        const stem = c.mat('plant-stem', { color: '#8a7a5c' });
        const leaf = c.mat('plant-leaf', { color: '#b9a98a', roughness: 0.7 });
        const lt = leafTemplate({ L: 0.03, Wd: 0.012, nu: 2, nv: 3, fold: 0.2 });
        const lb = new LeafBatch();
        for (let k = 0; k < 3; k++) {
          const a = k * 2.1 + r();
          const extra = Math.min(0.2 + r() * 0.08, H - (y0 + h) - 0.012);
          const pts = [V3(cx, y0 + h * 0.75, cz), V3(cx + Math.cos(a) * 0.03, y0 + h + extra * 0.5, cz + Math.sin(a) * 0.03), V3(cx + Math.cos(a) * 0.09, y0 + h + extra, cz + Math.sin(a) * 0.09)];
          const sw = sweep(pts, () => 0.0018, { radial: 4, tubular: 10 });
          b.add(sw.geom, stem, { uv: 'keep' });
          for (let j = 0; j < 9; j++) { const t = 0.4 + 0.6 * j / 9; const lp = sw.curve.getPointAt(t); const tn = sw.curve.getTangentAt(t); const dir = V3(Math.cos(a + j * 2.4), 0.4, Math.sin(a + j * 2.4)).add(tn).normalize(); lb.add(lt, leafMatrix(lp, dir, j, 1), new THREE.Color(1, 1, 1)); }
        }
        const g = lb.geometry(); g.deleteAttribute('color');
        b.add(g, leaf, { uv: 'keep' });
      }
    } else if (kind.includes('bowl')) {
      const h = HH || Math.min(0.07, H * 0.3), rr = Math.min(0.12, W * 0.24, Math.max(0.06, h * 1.6));
      b.add(lathe(smoothProfile(vaseProfile('bowl', h, rr), 30), 48), /wood|walnut/.test(kind) ? c.mat('walnut-dark') : ceramic, { pos: [cx, y0, cz], uv: 'box' });
    } else if (kind.includes('candlestick') || kind.includes('holder')) {
      const h = 0.16 + (curIdx % 2) * 0.06;
      b.add(lathe(smoothProfile([[0.001, 0], [0.04, 0], [0.04, 0.008], [0.012, 0.02], [0.008, h * 0.5], [0.012, h - 0.02], [0.016, h - 0.006], [0.016, h], [0.001, h]], 30), 32), ceramic, { pos: [cx, y0, cz], uv: 'box' });
      b.add(new THREE.CylinderGeometry(0.011, 0.011, 0.18, 16), c.mat('paper', { color: '#f2ece0' }), { pos: [cx, y0 + h + 0.09, cz] });
    } else if (kind.includes('candle')) {
      const h = 0.1 + r() * 0.05, rr = 0.035;
      b.add(lathe(vaseProfile('candle', h, rr), 28), c.mat('paper', { color: '#f2ece0' }), { pos: [cx, y0, cz], uv: 'box' });
      b.add(new THREE.CylinderGeometry(0.0012, 0.0012, 0.012, 4), c.mat('rubber'), { pos: [cx, y0 + h + 0.004, cz] });
    } else if (kind.includes('sculpt') || kind.includes('object') || kind.includes('ring')) {
      const h = HH || 0.13;
      if (h > 0.18) {
        // tall organic sculpture: stacked soft forms
        const prof = smoothProfile([[0.001, 0], [0.05, 0], [0.055, h * 0.12], [0.03, h * 0.3], [0.06, h * 0.5], [0.05, h * 0.68], [0.02, h * 0.82], [0.035, h * 0.94], [0.001, h]], 50);
        b.add(lathe(prof, 36), ceramic, { pos: [cx, y0, cz], uv: 'box' });
      } else {
        const rr = h * 0.38;
        b.add(new THREE.TorusGeometry(rr, rr * 0.32, 16, 40), ceramic, { pos: [cx, y0 + rr * 1.32 + 0.01, cz], rot: [0, 0.4, 0] });
        b.add(slab(ellipseShape(rr * 1.2, rr * 0.8), 0.012, { bevel: 0.003 }), ceramic, { pos: [cx, y0, cz] });
      }
    } else if (kind.includes('stone') || kind.includes('pebble')) {
      for (let k = 0; k < 3; k++) { const g = new THREE.SphereGeometry(0.03 - k * 0.006, 16, 10); g.scale(1, 0.45, 0.8); b.add(g, c.mat('stone-worktop'), { pos: [cx + (k - 1) * 0.045, y0 + 0.012, cz + (r() - 0.5) * 0.03] }); }
    } else if (kind.includes('box')) {
      // lidded box (leather / wood / ceramic from its own material hint + colour), lid seam 1 cm below the top
      const bm = mk ? ceramic : objMat(c, 'walnut-dark', color);
      const bh = HH || 0.07;
      b.add(softBox(0.14, bh - 0.012, 0.1, { r: 0.004, seg: 2 }), bm, { pos: [cx, y0 + (bh - 0.012) / 2, cz] });
      b.add(softBox(0.143, 0.0115, 0.103, { r: 0.004, seg: 2 }), bm, { pos: [cx, y0 + bh - 0.006, cz] });
    } else if (kind.includes('jar')) {
      const h = HH || Math.min(0.16, H * 0.5), rr = 0.05;
      b.add(lathe(smoothProfile(vaseProfile('jar', h, rr), 30), 40), ceramic, { pos: [cx, y0, cz], uv: 'box' });
    } else {
      const h = HH || Math.min(0.2, H * 0.6), rr = Math.min(0.09, Math.max(0.05, h * 0.38));
      b.add(lathe(smoothProfile(vaseProfile('vase-round', h, rr), 40), 40), ceramic, { pos: [cx, y0, cz], uv: 'box' });
      lastVase = { x: cx, y: y0 + h, z: cz };
    }
  }
  return { group: b.build('decor_set'), lights };
}

export { leafTemplate, sweep, LeafBatch, leafMatrix };
void hashStr;

// ---------------------------------------------------------------- mirror

function mirrorShape(kind, w, h, inset = 0) {
  const W = w - 2 * inset, H = h - 2 * inset;
  const k = String(kind || 'round').toLowerCase();
  if (/round|circle|oval/.test(k)) return ellipseShape(W, H, 96);
  if (/pill|capsule|stadium/.test(k)) return roundedRectShape(W, H, Math.min(W, H) / 2 - 1e-4);
  if (/arch/.test(k)) {
    const s = new THREE.Shape(), R = W / 2, yb = -H / 2, yc = H / 2 - R;
    s.moveTo(-R, yb); s.lineTo(R, yb); s.lineTo(R, yc); s.absarc(0, yc, R, 0, Math.PI, false); s.lineTo(-R, yb);
    return s;
  }
  if (/organic|wave|blob/.test(k)) {
    const s = new THREE.Shape(), n = 96;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, rr = 1 + 0.045 * Math.sin(3 * a + 0.6) + 0.03 * Math.sin(5 * a + 1.9);
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), 0.75) * W / 2 * rr, y = Math.sign(sa) * Math.pow(Math.abs(sa), 0.75) * H / 2 * rr;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    return s;
  }
  return roundedRectShape(W, H, Math.min(0.02, W / 4));
}

/**
 * mirror — shape round|oval|arch|pill|rect|organic, mount wall|leaning, frame oak-light|ash-light|walnut-dark|
 * metal-brass-brushed|metal-black|rattan|travertine|none (bevelled frameless), frameWidth (m, 0.025), frameColor.
 * wall: origin = centre of the back face, protrudes +Z (like wall_art; fitted to w × h).
 * leaning: origin = bottom-centre of its bbox, leaning back 7°; bbox depth (≈ h·sin 7°) can exceed dims.d —
 * put its back at the wall using the bbox. The glass is a perfect metal mirror: it reflects the scene's
 * env map (and true reflections in the path tracer); no Reflector needed.
 */
export function mirror(c) {
  const { W, H, params: p } = c;
  const b = new Builder(c.seed);
  const kind = p.shape || p.mirrorShape || 'round';
  const fk = String(p.frame ?? 'metal-brass-brushed').toLowerCase();
  const frameless = fk === 'none' || fk === 'frameless' || fk === 'bevel';
  const fw = frameless ? 0 : clamp(cm(p.frameWidth, /rattan/.test(fk) ? 0.06 : 0.025), 0.006, 0.12);
  const fd = frameless ? 0 : clamp(cm(p.frameDepth, 0.03), 0.012, 0.06);
  const glass = c.mat('mirror', { color: p.glassTint || '#eef0ee' });
  const back = c.mat('metal-black', { color: '#2a2724', roughness: 0.8 });
  if (!frameless) {
    const fmat = /rattan|cane/.test(fk) ? c.mat('rattan', { color: p.frameColor }) : c.mat(fk, p.frameColor ? { color: p.frameColor } : undefined);
    const outer = mirrorShape(kind, W, H, 0);
    outer.holes.push(new THREE.Path(mirrorShape(kind, W, H, fw).getPoints(96)));
    const bev = Math.min(0.004, fw / 4, fd / 4);
    const g = new THREE.ExtrudeGeometry(outer, { depth: fd - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 64 });
    g.translate(0, 0, bev);
    b.add(g, fmat, { uv: 'box', axis: 'y' });
    // glass sits 5 mm behind the frame face
    const gl = new THREE.ShapeGeometry(mirrorShape(kind, W, H, fw - 0.004), 64);
    gl.translate(0, 0, fd - 0.007);
    b.add(gl, glass, { uv: 'none', cast: false });
  } else {
    // frameless: 5 mm glass with a 15 mm polished bevel
    const g = new THREE.ExtrudeGeometry(mirrorShape(kind, W, H, 0.015), { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.015, bevelSegments: 1, curveSegments: 64 });
    g.translate(0, 0, 0.01);
    b.add(g, glass, { uv: 'none' });
  }
  const bk = new THREE.ShapeGeometry(mirrorShape(kind, W, H, Math.max(0.01, fw * 0.5)), 48);
  bk.rotateY(Math.PI); bk.translate(0, 0, 0.004);
  b.add(bk, back, { uv: 'none', cast: false });
  const mount = String(p.mount || 'wall').toLowerCase();
  // wall mirrors hang on a wire between two D-rings (round 5: the turntable shows the back)
  // (framed: the rings sit on the frame's back at z = 0; frameless: on the back board, 4 mm in)
  if (!/lean|floor/.test(mount)) {
    const rnd = /round|oval|organic/.test(String(kind)), yR = rnd ? H * 0.12 : H * 0.25;
    const hw = frameless || rnd ? Math.max(0.05, Math.min(W / 2 - 0.05, Math.sqrt(Math.max(0, 1 - (2 * yR / H) ** 2)) * (W / 2) - Math.max(0.012, fw) - 0.03)) : W / 2 - fw / 2;
    hangingWire(b, c, { hw, y: yR, sag: Math.min(0.04, W * 0.06), z0: frameless || rnd ? 0.004 : 0 });
  }
  const group = b.build('mirror');
  if (/lean|floor/.test(mount)) {
    const lean = clamp((p.lean ?? 7) * Math.PI / 180, 0.04, 0.2);
    // stand on the bottom edge: rotate about the bottom-front line, back top toward −Z
    for (const m of group.children) { m.geometry.translate(0, H / 2, 0); m.geometry.rotateX(-lean); m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere(); }
    return { group, mount: 'leaning', fit: { axes: '', origin: 'bottom' } };
  }
  return { group, mount: 'wall', fit: { axes: 'xy', origin: 'none' } };
}
