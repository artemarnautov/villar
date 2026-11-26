// Villar engine — architecture from layout JSON: walls with real openings, skirting, ceiling +
// bulkhead with recessed downlights, floor, built-in kitchen and wardrobe, doors, window wall with
// black metal frames and a sliding pane, wall-mounted TV, AC grille, balcony + glass railing.
// Everything static is merged per material. A second "cutaway" set (walls cut at 1.2 m, no ceiling)
// is built for the dollhouse view. Owner: engine.
import * as THREE from 'three';
import { Batcher, boxGeometry, cylinderY, cylinderBetween } from './geo.js';

const WOOD_SPECIES = ['oak-light', 'oak-natural', 'walnut-dark', 'walnut-medium', 'teak', 'ash-black'];

export const CUT_HEIGHT = 1.2;

export function buildArchitecture({ layout, stylepack, palette, materials }) {
  // stylepack.architecture wins; palette.architecture fills anything it leaves out
  const A = { ...(palette?.architecture || {}), ...(stylepack?.architecture || {}) };
  const S = layout.size;
  const X = S.x, Z = S.z, H = S.ceiling, T = S.wallThickness || 0.15;
  const owned = []; // engine-owned materials (disposed with the architecture)
  const own = (m) => { m.userData.engineOwned = true; owned.push(m); return m; };

  // ---------------------------------------------------------------- materials
  const floorKey = A.floor || 'oak-light';
  const M = {
    wall: own(materials.get('paint', { color: A.walls || '#EDE7DE' }).clone()),      // own: wall colour follows the style
    ceiling: materials.get('paint', { color: A.ceiling || '#F5F2EC' }),
    floor: own(satin(WOOD_SPECIES.includes(floorKey) ? materials.get('oak-floor', { species: floorKey }) : materials.get(floorKey))),
    skirting: own(materials.get('kitchen-front', { color: A.walls || '#EDE7DE', roughness: 0.5 }).clone()),
    front: materials.get('kitchen-front', { color: A.kitchenFronts || '#D6CFBF' }),
    wfront: materials.get('kitchen-front', { color: A.wardrobeFronts || A.kitchenFronts || '#D6CFBF' }),
    // dark recess seen through the 4 mm front gaps: reads as a continuous shadow line
    carcass: own(new THREE.MeshStandardMaterial({ color: '#2b2723', roughness: 1, metalness: 0, name: 'cabinet-recess' })),
    plinth: materials.get('kitchen-front', { color: shade(A.kitchenFronts || '#D8D0C4', 0.45), roughness: 0.7 }),
    worktop: materials.get(A.worktop || 'travertine'),
    black: materials.get('metal-black', { color: '#1b1b1b' }),
    frame: materials.get(A.windowFrame || 'metal-black', { color: '#161616', roughness: 0.45 }),
    steel: materials.get('metal-nickel'),
    white: materials.get('metal-white'),
    doorEntry: null,
    tile: own(materials.get('porcelain-tile', { color: '#cfc7bb' }).clone()),
    facade: materials.get('paint', { color: '#d9d3c9' }),
    concrete: materials.get('paint', { color: '#b9b3aa' }),
    cap: own(new THREE.MeshStandardMaterial({ color: '#34312e', roughness: 0.9, name: 'cutaway-cap' })),
    tvBody: materials.get('lacquer', { color: '#0b0b0c', roughness: 0.35 }),
    tvScreen: own(new THREE.MeshPhysicalMaterial({ color: '#030304', roughness: 0.2, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.05, specularIntensity: 0.5, envMapIntensity: 0.5, name: 'tv-screen' })),
    hob: own(new THREE.MeshPhysicalMaterial({ color: '#08080a', roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, name: 'hob-glass' })),
    hobRing: own(new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.4, name: 'hob-ring' })),
    sinkDark: own(new THREE.MeshStandardMaterial({ color: '#202022', roughness: 0.5, metalness: 0.6, name: 'drain' })),
    glass: own(makeGlass('#ffffff')),
    railGlass: own(makeGlass('#dff0ea')),
    diffuser: materials.get('bulb', { color: '#f3f1ec', lit: false, tag: 'downlight' }),
    led: materials.get('bulb', { color: '#fff3de', lit: false, tag: 'led-strip' }),
    grilleSlot: own(new THREE.MeshStandardMaterial({ color: '#2b2a29', roughness: 0.8, name: 'grille-slot' })),
    bathTile: materials.get('porcelain-tile', { color: '#d4cfc6' }),
    bathWall: materials.get('porcelain-tile', { color: '#e4e0d8' }),
    ceramic: materials.get('ceramic-glazed', { color: '#f2f0ec' }),
    wood: materials.get('walnut-medium'),
    mirror: materials.get('mirror'),
  };
  // door finish: from the opening if the layout pins it, else from the active pack (doorFinish);
  // one engine-owned material per door so a style change can dissolve to another finish
  const finishMaterial = (finish, walls) => (finish === 'paint'
    ? materials.get('kitchen-front', { color: walls || '#EDE7DE', roughness: 0.45 })
    : materials.get(finish || 'walnut-dark'));
  const doorMats = new Map(); // opening id → { mat, finish, fromPack }
  const doorFinish = (o) => {
    const key = o.id || `${o.wall}@${o.center}`;
    if (!doorMats.has(key)) {
      const finish = o.finish || A.doorFinish || 'walnut-dark';
      doorMats.set(key, { mat: own(finishMaterial(finish, A.walls).clone()), finish, fromPack: !o.finish });
    }
    return doorMats.get(key).mat;
  };

  // ---------------------------------------------------------------- walls geometry model
  const walls = layout.walls.map((w) => {
    const [ax, az] = w.from, [bx, bz] = w.to;
    const alongX = Math.abs(bz - az) < 1e-6;
    const t = w.thickness || T;
    const perimeter = !w.thickness;
    let c0, c1; // thickness range on the perpendicular axis
    const c = alongX ? az : ax;
    if (perimeter) {
      const mid = alongX ? Z / 2 : X / 2;
      if (c <= mid) { c0 = c - t; c1 = c; } else { c0 = c; c1 = c + t; }
    } else { c0 = c - t / 2; c1 = c + t / 2; }
    let a0 = Math.min(alongX ? ax : az, alongX ? bx : bz), a1 = Math.max(alongX ? ax : az, alongX ? bx : bz);
    if (perimeter && alongX) { a0 -= T; a1 += T; } // perimeter walls along X overlap the corners
    if (!perimeter) { a1 += t / 2; a0 -= a0 > 0.01 ? t / 2 : 0.06; } // overlap neighbours: no raster cracks
    return { ...w, alongX, t, c0, c1, a0, a1, perimeter, dir: Math.sign((alongX ? bx - ax : bz - az)) || 1, start: alongX ? ax : az };
  });
  const wallById = Object.fromEntries(walls.map((w) => [w.id, w]));
  const openings = (layout.openings || []).map((o) => {
    const w = wallById[o.wall];
    // position along the wall measured from `from`, converted to world axis coordinate
    const toWorld = (d) => w.start + w.dir * d;
    let lo, hi;
    if (o.center !== undefined) { lo = toWorld(o.center - o.width / 2); hi = toWorld(o.center + o.width / 2); }
    else { lo = toWorld(o.from); hi = toWorld(o.to); }
    const s0 = Math.min(lo, hi), s1 = Math.max(lo, hi);
    const mullions = (o.mullions || []).map((m) => toWorld(m)).sort((a, b) => a - b);
    return { ...o, w, s0, s1, sill: o.sill ?? 0, head: o.head ?? o.height ?? 2.1, mullionsW: mullions };
  });

  const bulk = layout.bulkhead || { x0: 1.95, x1: X, z0: -T, z1: 3.4, y: 2.55 };
  const inBulk = (x, z) => x >= bulk.x0 - 1e-3 && x <= bulk.x1 + 1e-3 && z >= bulk.z0 - 1e-3 && z <= bulk.z1 + 1e-3;
  const ceilingAt = (x, z) => (inBulk(x, z) ? bulk.y : H);

  // ---------------------------------------------------------------- build (full / cut)
  const glassMeshes = [];
  const downlights = [];
  let underCabinet = null;

  function build(cut) {
    const B = new Batcher();
    const extras = [];
    const isCut = cut < 10;
    const box = (mat, x0, x1, y0, y1, z0, z1, opts = {}) => {
      if (y0 >= cut - 1e-4) return;
      y1 = Math.min(y1, cut);
      if (x1 - x0 < 1e-5 || y1 - y0 < 1e-5 || z1 - z0 < 1e-5) return;
      B.add(mat, boxGeometry(x0, x1, y0, y1, z0, z1, opts), opts);
    };
    const W = (alongX, a0, a1, y0, y1, c0, c1, mat, opts) => (alongX ? box(mat, a0, a1, y0, y1, c0, c1, opts) : box(mat, c0, c1, y0, y1, a0, a1, opts));

    // floor (planks run along Z, towards the window) + structural slab
    {
      const g = boxGeometry(-0.05, X + 0.05, -0.02, 0, -0.05, Z + 0.05, { uvSwap: true, skip: 'ny' });
      B.add(M.floor, g, { cast: false, receive: true, name: 'floor', userData: { surface: 'floor' } });
      box(M.concrete, -T, X + T, -0.3, -0.02, -T, Z + T, { receive: false });
    }
    // ceiling slab + bulkhead
    if (!isCut) {
      box(M.ceiling, -T, X + T, H, H + 0.25, -T, Z + T);
      box(M.ceiling, bulk.x0, bulk.x1, bulk.y, H + 0.01, bulk.z0, bulk.z1);
    }
    // walls with openings
    for (const w of walls) {
      const ops = openings.filter((o) => o.w === w).sort((a, b) => a.s0 - b.s0);
      let a = w.a0;
      const yB = -0.02, yT = H + 0.03; // sink into the floor / ceiling slabs
      for (const o of ops) {
        W(w.alongX, a, o.s0, yB, yT, w.c0, w.c1, M.wall);
        if (o.sill > 0) W(w.alongX, o.s0, o.s1, yB, o.sill, w.c0, w.c1, M.wall);
        W(w.alongX, o.s0, o.s1, o.head, yT, w.c0, w.c1, M.wall);
        a = o.s1;
      }
      W(w.alongX, a, w.a1, yB, yT, w.c0, w.c1, M.wall);
      if (isCut) {
        // dark section caps (architectural poché)
        let a2 = w.a0;
        for (const o of ops) { if (o.sill < cut) { W(w.alongX, a2, o.s0, cut, cut + 0.004, w.c0, w.c1, M.cap, { cast: false }); a2 = o.s1; } }
        W(w.alongX, a2, w.a1, cut, cut + 0.004, w.c0, w.c1, M.cap, { cast: false });
      }
    }
    skirting(box, walls, openings);
    for (const o of openings) {
      if (o.type === 'door') door(box, B, o, cut);
      else if (o.type === 'window') windowWall(box, B, o, cut, extras);
    }
    for (const b of layout.builtIns || []) {
      if (b.type === 'kitchen') kitchen(box, B, b, cut);
      else if (b.type === 'wardrobe') wardrobe(box, B, b, cut);
    }
    bathroom(box, B);
    for (const p of layout.fixedProps || []) {
      if (p.type === 'tv' && !isCut) tv(box, p);
      else if (p.type === 'downlights' && !isCut) downlightFixtures(B, p);
      else if (p.type === 'ac-grille' && !isCut) acGrille(box, p);
    }
    const grp = B.build(new THREE.Group());
    for (const m of extras) grp.add(m);
    return grp;
  }

  // ---------------------------------------------------------------- skirting
  function skirting(box, walls, ops) {
    const h = 0.075, t = 0.012;
    const bathRect = { x0: 0, x1: 2.0, z0: 0, z1: 2.6 };
    const blocked = (layout.builtIns || []).map((b) => b.type === 'kitchen'
      ? { x0: X - (b.base?.depth || 0.62) - 0.05, x1: X + 1, z0: b.zFrom - 0.02, z1: b.zTo + 0.02 }
      : { x0: b.x0 - 0.02, x1: b.x1 + 0.05, z0: b.z0 - 0.02, z1: b.z1 + 0.02 });
    const isLiving = (x, z) => x > 0 && x < X && z > 0 && z < Z && !(x < bathRect.x1 && z < bathRect.z1);
    for (const w of walls) {
      for (const side of [-1, 1]) {
        const face = side < 0 ? w.c0 : w.c1;
        const probe = face + side * 0.05;
        // sample whether that side is the living space
        const mid = (Math.max(w.a0, 0) + Math.min(w.a1, w.alongX ? X : Z)) / 2;
        if (!(w.alongX ? isLiving(mid, probe) : isLiving(probe, mid))) {
          // partitions: the living side may only exist along part of the wall
          if (w.perimeter) continue;
        }
        // build intervals along the wall
        let segs = [[Math.max(0, w.a0), Math.min(w.alongX ? X : Z, w.a1)]];
        const cutOut = (s0, s1) => { segs = segs.flatMap(([a, b]) => (s1 <= a || s0 >= b ? [[a, b]] : [[a, s0], [s1, b]].filter(([p, q]) => q - p > 0.02))); };
        for (const o of ops) if (o.w === w && o.sill < 0.1) cutOut(o.s0 - (o.type === 'door' ? 0.07 : 0), o.s1 + (o.type === 'door' ? 0.07 : 0));
        // remove parts not in living space or behind built-ins
        const step = 0.05;
        const finalSegs = [];
        for (const [a, b] of segs) {
          let s = null;
          for (let u = a; u <= b + 1e-6; u += step) {
            const uu = Math.min(u, b);
            const px = w.alongX ? uu : probe, pz = w.alongX ? probe : uu;
            const ok = isLiving(px, pz) && !blocked.some((r) => px >= r.x0 && px <= r.x1 && pz >= r.z0 && pz <= r.z1);
            if (ok && s === null) s = uu;
            if ((!ok || uu >= b - 1e-6) && s !== null) { const e = ok ? uu : uu - step; if (e - s > 0.04) finalSegs.push([s, e]); s = null; }
          }
        }
        for (const [a, b] of finalSegs) {
          const c0 = side < 0 ? face - t : face, c1 = side < 0 ? face : face + t;
          if (w.alongX) box(M.skirting, a, b, 0, h, c0, c1); else box(M.skirting, c0, c1, 0, h, a, b);
        }
      }
    }
  }

  // ---------------------------------------------------------------- doors
  function door(box, B, o, cut) {
    const w = o.w, fin = doorFinish(o);
    const interiorSide = interiorSideOf(w);
    const face = interiorSide > 0 ? w.c1 : w.c0;
    const s0 = o.s0, s1 = o.s1, hgt = o.head;
    const P = (a0, a1, y0, y1, d0, d1, mat, opts) => {
      // d measured from the interior face going into the room (positive) or into the wall (negative)
      const c0 = face + interiorSide * d0, c1 = face + interiorSide * d1;
      const lo = Math.min(c0, c1), hi = Math.max(c0, c1);
      if (w.alongX) box(mat, a0, a1, y0, y1, lo, hi, opts); else box(mat, lo, hi, y0, y1, a0, a1, opts);
    };
    const depth = w.t;
    // jamb lining
    P(s0, s0 + 0.02, 0, hgt, -depth, 0.0, fin);
    P(s1 - 0.02, s1, 0, hgt, -depth, 0.0, fin);
    P(s0, s1, hgt - 0.02, hgt, -depth, 0.0, fin);
    // leaf (closed), set 3 cm into the opening
    P(s0 + 0.022, s1 - 0.022, 0.006, hgt - 0.022, -0.075, -0.03, fin, { uvVertical: true });
    // architrave (painted)
    const aw = 0.07, ap = 0.016;
    P(s0 - aw, s0, 0, hgt + aw, 0, ap, M.skirting);
    P(s1, s1 + aw, 0, hgt + aw, 0, ap, M.skirting);
    P(s0 - aw, s1 + aw, hgt, hgt + aw, 0, ap, M.skirting);
    // lever handle on the room side, opposite the hinge (hinge on the side closer to the corner)
    const hingeAtStart = (o.hinge || 'start') === 'start';
    const hx = hingeAtStart ? s1 - 0.075 : s0 + 0.075;
    const hy = 1.02;
    if (hy < cut) {
      const dirA = hingeAtStart ? -1 : 1;
      const rose = (cx, cy, d) => {
        const g = new THREE.CylinderGeometry(0.026, 0.026, 0.012, 24);
        if (w.alongX) g.rotateX(Math.PI / 2); else g.rotateZ(Math.PI / 2);
        const c = face + interiorSide * d;
        if (w.alongX) g.translate(cx, cy, c); else g.translate(c, cy, cx);
        B.add(M.black, g);
      };
      rose(hx, hy, -0.03 + 0.006);
      const lv0 = Math.min(hx, hx + dirA * 0.13), lv1 = Math.max(hx, hx + dirA * 0.13);
      P(lv0, lv1, hy - 0.009, hy + 0.009, 0.012, 0.03, M.black);
      P(hx - 0.009, hx + 0.009, hy - 0.009, hy + 0.009, -0.03, 0.012, M.black);
    }
  }

  function interiorSideOf(w) {
    if (w.perimeter) {
      const mid = w.alongX ? Z / 2 : X / 2;
      return w.c1 <= mid + 1e-6 ? 1 : -1;
    }
    // partitions: the side away from the bathroom (bath occupies the low-x / low-z corner)
    return 1;
  }

  // ---------------------------------------------------------------- window wall
  function windowWall(box, B, o, cut, extras) {
    const w = o.w; // north wall assumed along X with interior at c0
    const zi = w.c0, zo = w.c1; // interior / exterior faces
    const fz0 = zi + 0.04, fz1 = zi + 0.11; // outer frame depth
    const fw = 0.05;
    const x0 = o.s0, x1 = o.s1, y0 = o.sill, y1 = o.head;
    const F = M.frame;
    // outer frame
    box(F, x0, x0 + fw, y0, y1, fz0, fz1);
    box(F, x1 - fw, x1, y0, y1, fz0, fz1);
    box(F, x0, x1, y1 - fw, y1, fz0, fz1);
    box(F, x0, x1, y0, y0 + 0.035, zi - 0.01, zo - 0.01); // threshold track
    // reveal liners (painted) to hide the wall core edges
    // mullions
    const ms = o.mullionsW;
    for (const m of ms) box(F, m - 0.025, m + 0.025, y0 + 0.035, y1 - fw, fz0 + 0.005, fz1 - 0.005);
    // panes
    const edges = [x0 + fw, ...ms.flatMap((m) => [m - 0.025, m + 0.025]), x1 - fw];
    const panes = [];
    for (let i = 0; i < edges.length; i += 2) panes.push([edges[i], edges[i + 1]]);
    const slide = o.slidingDoorPane ?? -1;
    const gy0 = y0 + 0.035, gy1 = y1 - fw;
    const glassBoxes = [];
    panes.forEach(([a, b], i) => {
      if (i === slide) {
        // sliding sash on the inner track, overlapping the neighbouring mullions
        const sa = a - 0.022, sb = b + 0.022, sz0 = zi + 0.002, sz1 = zi + 0.038, sw = 0.045;
        box(F, sa, sa + sw, gy0, gy1, sz0, sz1);
        box(F, sb - sw, sb, gy0, gy1, sz0, sz1);
        box(F, sa, sb, gy0, gy0 + 0.06, sz0, sz1);
        box(F, sa, sb, gy1 - sw, gy1, sz0, sz1);
        // pull handle
        box(F, sa + 0.012, sa + 0.03, 0.85, 1.35, sz0 - 0.03, sz0);
        box(F, sa + 0.012, sa + 0.03, 0.85, 0.87, sz0 - 0.03, sz0 + 0.005);
        box(F, sa + 0.012, sa + 0.03, 1.33, 1.35, sz0 - 0.03, sz0 + 0.005);
        glassBoxes.push([sa + sw, sb - sw, gy0 + 0.06, gy1 - sw, zi + 0.017, zi + 0.023]);
      } else {
        glassBoxes.push([a, b, gy0, gy1, zi + 0.072, zi + 0.078]);
      }
    });
    // glass (its own mesh: transparent, no shadows, excluded from AO)
    const g = new Batcher();
    for (const [a, b, c, d, e, f] of glassBoxes) {
      if (c >= cut) continue;
      g.add(M.glass, boxGeometry(a, b, c, Math.min(d, cut), e, f), { cast: false, receive: false });
    }
    const gg = g.build();
    [...gg.children].forEach((m) => { m.userData.noAO = true; m.userData.glass = true; m.renderOrder = 2; glassMeshes.push(m); extras.push(m); });

    // balcony
    const out = o.outside || {};
    const bd = out.balconyDepth || 1.6;
    const bz0 = zo, bz1 = zo + bd;
    box(M.tile, 0, X, -0.045, -0.03, bz0, bz1, { cast: false });
    box(M.concrete, 0, X, -0.26, -0.045, bz0, bz1);
    box(M.facade, -0.005, X + 0.005, -0.27, -0.03, bz1 - 0.005, bz1 + 0.02); // slab edge fascia
    // glass railing
    const rz0 = bz1 - 0.06, rz1 = bz1 - 0.045;
    box(M.steel, 0, X, -0.03, 0.06, rz0 - 0.015, rz1 + 0.015);
    box(M.steel, 0, X, 1.06, 1.1, rz0 - 0.012, rz1 + 0.012);
    const rg = new Batcher();
    rg.add(M.railGlass, boxGeometry(0.01, X - 0.01, 0.06, 1.06, rz0, rz1), { cast: false, receive: false });
    const rgg = rg.build();
    [...rgg.children].forEach((m) => { m.userData.noAO = true; m.userData.glass = true; m.renderOrder = 1; glassMeshes.push(m); extras.push(m); });
    // exterior facade around the window (outer wall face + slab edges above)
    box(M.facade, -T, X + T, H, H + 0.25, zo, zo + 0.02);
  }

  // ---------------------------------------------------------------- kitchen (east wall)
  function kitchen(box, B, k, cut) {
    // local frame: d = distance from wall face (x = X - d), z along the wall
    const K = (mat, d0, d1, y0, y1, z0, z1, opts) => box(mat, X - d1, X - d0, y0, y1, z0, z1, opts);
    const g = 0.004; // front gap (4 mm, dark recess behind)
    const base = k.base, up = k.uppers, tall = k.tallUnit;
    const D = base.depth, BH = base.height;
    const fD0 = D - 0.02, fD1 = D;
    const topT = 0.03, y0f = 0.1;
    // plinth
    K(M.plinth, 0.0, D - 0.06, 0, y0f, base.zFrom, base.zTo + 0.0);
    // carcass
    K(M.carcass, 0, fD0, y0f, BH - topT, base.zFrom, base.zTo);
    // fronts: sink cabinet (2 doors), hob drawers (3), end door (1)
    const sinkZ = base.sinkAt, hobZ = base.hobAt;
    const zA0 = base.zFrom, zA1 = Math.min(hobZ - 0.3, base.zTo);
    const zB0 = zA1, zB1 = Math.min(hobZ + 0.3, base.zTo);
    const zC0 = zB1, zC1 = base.zTo;
    const fy0 = y0f + g, fy1 = BH - topT - g;
    const zMid = (zA0 + zA1) / 2;
    K(M.front, fD0, fD1, fy0, fy1, zA0 + g, zMid - g / 2);
    K(M.front, fD0, fD1, fy0, fy1, zMid + g / 2, zA1 - g / 2);
    const drawerYs = [fy0, fy0 + 0.25, fy0 + 0.5, fy1];
    for (let i = 0; i < 3; i++) K(M.front, fD0, fD1, drawerYs[i] + (i ? g / 2 : 0), drawerYs[i + 1] - (i < 2 ? g / 2 : 0), zB0 + g / 2, zB1 - g / 2);
    if (zC1 - zC0 > 0.1) K(M.front, fD0, fD1, fy0, fy1, zC0 + g / 2, zC1 - g);
    // handles (slim black bars, 12 mm)
    const hd0 = fD1, hd1 = fD1 + 0.026, hs = 0.006;
    const vbar = (z, y0, y1) => { K(M.black, hd0 + 0.014, hd1, y0, y1, z - hs, z + hs); K(M.black, hd0, hd0 + 0.014, y0, y0 + 0.012, z - 0.004, z + 0.004); K(M.black, hd0, hd0 + 0.014, y1 - 0.012, y1, z - 0.004, z + 0.004); };
    const hbar = (zc, y, len) => { K(M.black, hd0 + 0.014, hd1, y - hs, y + hs, zc - len / 2, zc + len / 2); K(M.black, hd0, hd0 + 0.014, y - 0.004, y + 0.004, zc - len / 2, zc - len / 2 + 0.012); K(M.black, hd0, hd0 + 0.014, y - 0.004, y + 0.004, zc + len / 2 - 0.012, zc + len / 2); };
    vbar(zMid - 0.04, fy1 - 0.22, fy1 - 0.04);
    vbar(zMid + 0.04, fy1 - 0.22, fy1 - 0.04);
    for (let i = 0; i < 3; i++) hbar((zB0 + zB1) / 2, drawerYs[i + 1] - 0.05, 0.3);
    if (zC1 - zC0 > 0.1) vbar(zC0 + 0.04, fy1 - 0.22, fy1 - 0.04);
    // worktop with sink cut-out
    const wt = M.worktop, wy0 = BH - topT, wy1 = BH;
    const sz0 = sinkZ - 0.24, sz1 = sinkZ + 0.24, sd0 = 0.1, sd1 = 0.52;
    K(wt, 0, D + 0.02, wy0, wy1, base.zFrom, sz0);
    K(wt, 0, D + 0.02, wy0, wy1, sz1, base.zTo);
    K(wt, 0, sd0, wy0, wy1, sz0, sz1);
    K(wt, sd1, D + 0.02, wy0, wy1, sz0, sz1);
    // undermount basin (brushed steel)
    const by0 = wy0 - 0.2;
    K(M.steel, sd0, sd1, by0, by0 + 0.008, sz0, sz1);
    K(M.steel, sd0, sd0 + 0.008, by0, wy0, sz0, sz1);
    K(M.steel, sd1 - 0.008, sd1, by0, wy0, sz0, sz1);
    K(M.steel, sd0, sd1, by0, wy0, sz0, sz0 + 0.008);
    K(M.steel, sd0, sd1, by0, wy0, sz1 - 0.008, sz1);
    if (by0 + 0.01 < cut) B.add(M.sinkDark, cylinderY(X - (sd0 + sd1) / 2, sinkZ, by0 + 0.008, 0.003, 0.035));
    // faucet (matte black), behind the basin
    if (wy1 + 0.33 < cut) {
      const fx = X - 0.055, fzz = sinkZ;
      B.add(M.black, cylinderY(fx, fzz, wy1, 0.035, 0.026));
      B.add(M.black, cylinderBetween(new THREE.Vector3(fx, wy1, fzz), new THREE.Vector3(fx, wy1 + 0.31, fzz), 0.013));
      B.add(M.black, cylinderBetween(new THREE.Vector3(fx, wy1 + 0.31, fzz), new THREE.Vector3(X - 0.27, wy1 + 0.31, fzz), 0.012));
      B.add(M.black, cylinderBetween(new THREE.Vector3(X - 0.27, wy1 + 0.31, fzz), new THREE.Vector3(X - 0.27, wy1 + 0.25, fzz), 0.012));
      B.add(M.black, cylinderBetween(new THREE.Vector3(fx - 0.0, wy1 + 0.12, fzz + 0.02), new THREE.Vector3(fx, wy1 + 0.12, fzz + 0.09), 0.006));
    }
    // hob (black glass) with rings
    K(M.hob, 0.07, 0.59, wy1, wy1 + 0.005, hobZ - 0.29, hobZ + 0.29);
    if (wy1 < cut) {
      for (const [dd, zz, r] of [[0.2, hobZ - 0.14, 0.09], [0.2, hobZ + 0.14, 0.075], [0.46, hobZ - 0.14, 0.075], [0.46, hobZ + 0.14, 0.09]]) {
        const ring = new THREE.RingGeometry(r - 0.004, r, 48); ring.rotateX(-Math.PI / 2); ring.translate(X - dd, wy1 + 0.0055, zz);
        B.add(M.hobRing, ring, { cast: false });
      }
    }
    // backsplash
    K(wt, 0, 0.012, wy1, up.y0, base.zFrom, base.zTo);
    // end panel facing the living room
    K(M.front, 0, D + 0.02, 0, BH, base.zTo, base.zTo + 0.018);
    // uppers
    const uD = up.depth;
    K(M.carcass, 0, uD - 0.02, up.y0 + 0.016, up.y1, up.zFrom, up.zTo);
    K(M.front, 0, uD - 0.02, up.y0, up.y0 + 0.016, up.zFrom, up.zTo); // underside panel
    const n = 4, uw = (up.zTo - up.zFrom) / n;
    for (let i = 0; i < n; i++) {
      const a = up.zFrom + i * uw + g / 2, b = up.zFrom + (i + 1) * uw - g / 2;
      K(M.front, uD - 0.02, uD, up.y0 + g, up.y1 - g, a, b);
      const hz = i % 2 === 0 ? b - 0.04 : a + 0.04;
      // handles near the bottom edge
      const hy0 = up.y0 + 0.04, hy1 = up.y0 + 0.2;
      if (hy1 < cut) { K(M.black, uD + 0.014, uD + 0.026, hy0, hy1, hz - hs, hz + hs); K(M.black, uD, uD + 0.014, hy0, hy0 + 0.012, hz - 0.004, hz + 0.004); K(M.black, uD, uD + 0.014, hy1 - 0.012, hy1, hz - 0.004, hz + 0.004); }
    }
    K(M.front, 0, uD, up.y0, up.y1, up.zTo, up.zTo + 0.018);
    // integrated hood visor above the hob
    K(M.steel, 0.04, uD - 0.01, up.y0 - 0.02, up.y0, hobZ - 0.28, hobZ + 0.28);
    // LED strip under the uppers
    K(M.led, uD - 0.07, uD - 0.05, up.y0 - 0.004, up.y0, up.zFrom + 0.05, up.zTo - 0.05, { cast: false });
    underCabinet = { x: X - (uD - 0.06), y: up.y0 - 0.006, z: (up.zFrom + up.zTo) / 2, len: up.zTo - up.zFrom - 0.1 };
    // soffit above the uppers up to the bulkhead
    K(M.wall, 0, uD, up.y1, bulk.y + 0.005, up.zFrom, up.zTo + 0.018);
    // tall unit (fridge column)
    K(M.plinth, 0, D - 0.06, 0, y0f, tall.zFrom, tall.zTo);
    K(M.carcass, 0, fD0, y0f, tall.height, tall.zFrom, tall.zTo);
    const ty1 = tall.height - g;
    const split = 1.36;
    K(M.front, fD0, fD1, fy0, split - g / 2, tall.zFrom + g, tall.zTo - g / 2);
    K(M.front, fD0, fD1, split + g / 2, ty1, tall.zFrom + g, tall.zTo - g / 2);
    vbar(tall.zTo - 0.045, split - 0.62, split - 0.08);
    vbar(tall.zTo - 0.045, split + 0.08, split + 0.5);
    K(M.wall, 0, D, tall.height, bulk.y + 0.005, tall.zFrom, tall.zTo);
    K(M.front, 0, D, 0, tall.height, tall.zFrom - 0.018, tall.zFrom);
  }

  // ---------------------------------------------------------------- wardrobe
  function wardrobe(box, B, w) {
    const g = 0.004, x0 = w.x0, x1 = w.x1, z0 = w.z0, z1 = w.z1, h = w.height;
    const fx0 = x1 - 0.02;
    box(M.plinth, x0, x1 - 0.05, 0, 0.08, z0 + 0.02, z1 - 0.02);
    box(M.carcass, x0, fx0, 0.08, h, z0 + 0.018, z1 - 0.018);
    box(M.wfront, x0, x1, 0, h, z0, z0 + 0.018);   // end panels (front finish)
    box(M.wfront, x0, x1, 0, h, z1 - 0.018, z1);
    const n = w.doors || 3, dw = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      const a = z0 + i * dw + g / 2, b = z0 + (i + 1) * dw - g / 2;
      box(M.wfront, fx0, x1, 0.08 + g, h - g, a, b);
    }
    // long bar handles (pairs meet at door joints)
    const bar = (z) => {
      box(M.black, x1 + 0.014, x1 + 0.026, 0.75, 1.55, z - 0.006, z + 0.006);
      box(M.black, x1, x1 + 0.014, 0.75, 0.762, z - 0.004, z + 0.004);
      box(M.black, x1, x1 + 0.014, 1.538, 1.55, z - 0.004, z + 0.004);
    };
    bar(z0 + dw - 0.04); bar(z0 + dw + 0.04); bar(z1 - 0.04);
  }

  // ---------------------------------------------------------------- bathroom (seen in the dollhouse)
  function bathroom(box, B) {
    const bx = 1.95, bz = 2.55; // inner extents (partition faces)
    box(M.bathTile, 0, bx, 0, 0.006, 0, bz, { cast: false });
    box(M.bathWall, 0, 0.004, 0.006, 1.2, 0, bz, { cast: false });
    box(M.bathWall, 0, bx, 0.006, 1.2, 0, 0.004, { cast: false });
    // shower: tray + glass screen in the entry-side corner
    box(M.ceramic, 0, 0.9, 0.006, 0.04, 0, 0.9);
    box(M.steel, 0.895, 0.905, 0.04, 2.0, 0.02, 0.06);          // shower screen profile
    // WC against the west wall
    box(M.ceramic, 0.004, 0.2, 0.006, 0.82, 1.3, 1.68);          // cistern / in-wall frame cover
    box(M.ceramic, 0.2, 0.62, 0.3, 0.42, 1.31, 1.67);            // bowl
    box(M.ceramic, 0.25, 0.5, 0.006, 0.3, 1.38, 1.6);
    // vanity against the partition to the dining area
    box(M.wood, 0.95, 1.65, 0.3, 0.82, bz - 0.46, bz);
    box(M.ceramic, 0.95, 1.65, 0.82, 0.86, bz - 0.47, bz);
    box(M.mirror, 1.0, 1.6, 1.0, 1.75, bz - 0.012, bz - 0.004);
  }

  // ---------------------------------------------------------------- fixed props
  function tv(box, p) {
    const inches = p.size || 65;
    const diag = inches * 0.0254, w = diag * 16 / Math.hypot(16, 9), h = diag * 9 / Math.hypot(16, 9);
    const [px, py, pz] = p.pos;
    // assume mounted on the west wall facing +X (rotY 90) — general case: swap axes by rotY
    const facesX = Math.abs(Math.round((p.rotY || 0) / 90)) % 2 === 1;
    if (facesX) {
      const xb = Math.max(0.005, px - 0.015);
      box(M.tvBody, xb, xb + 0.028, py - h / 2 - 0.006, py + h / 2 + 0.006, pz - w / 2 - 0.006, pz + w / 2 + 0.006);
      box(M.tvScreen, xb + 0.028, xb + 0.0295, py - h / 2 + 0.004, py + h / 2 - 0.004, pz - w / 2 + 0.004, pz + w / 2 - 0.004);
    } else {
      box(M.tvBody, px - w / 2, px + w / 2, py - h / 2, py + h / 2, pz - 0.015, pz + 0.015);
    }
  }

  function downlightFixtures(B, p) {
    for (const [x, z] of p.points) {
      const y = ceilingAt(x, z);
      B.add(M.white, cylinderY(x, z, y - 0.004, 0.004, 0.048, 32), { cast: false });
      B.add(M.black, cylinderY(x, z, y - 0.0045, 0.001, 0.04, 32), { cast: false });
      B.add(M.diffuser, cylinderY(x, z, y - 0.006, 0.0015, 0.032, 32), { cast: false });
      downlights.push(new THREE.Vector3(x, y - 0.008, z));
    }
  }

  function acGrille(box, p) {
    const [cx, cy, cz] = p.pos, [w, h] = p.size;
    // on the bulkhead front face if it sits there, otherwise a ceiling slot
    const zf = bulk.z1;
    box(M.white, cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, zf, zf + 0.008, { cast: false });
    box(M.grilleSlot, cx - w / 2 + 0.02, cx + w / 2 - 0.02, cy - h / 2 + 0.02, cy + h / 2 - 0.02, zf + 0.0005, zf + 0.0085, { cast: false });
    for (let i = 1; i <= 3; i++) {
      const y = cy - h / 2 + 0.02 + (h - 0.04) * (i / 4);
      box(M.white, cx - w / 2 + 0.02, cx + w / 2 - 0.02, y - 0.003, y + 0.003, zf + 0.002, zf + 0.012, { cast: false });
    }
    void cz;
  }

  // ---------------------------------------------------------------- assemble
  const full = build(Infinity);
  const nFullDownlights = downlights.length;
  const cutGroup = build(CUT_HEIGHT);
  downlights.length = nFullDownlights;
  const allGlass = glassMeshes;

  // Shadow leaks: by default three renders *back* faces into the shadow map, so a wall's stored
  // occluder depth is its interior face and anything touching it (floor, partitions) passes the
  // biased test → bright seams along junctions. Architecture gets engine-owned clones of its
  // materials (textures shared) that render both sides into the shadow map instead.
  const shadowClones = new Map();
  const withDoubleShadow = (m) => {
    if (m.userData.engineOwned) { m.shadowSide = THREE.DoubleSide; return m; }
    if (!shadowClones.has(m)) {
      const c = m.clone();
      c.shadowSide = THREE.DoubleSide;
      c.userData = { ...m.userData, engineOwned: true, shadowClone: true };
      owned.push(c);
      shadowClones.set(m, c);
    }
    return shadowClones.get(m);
  };
  for (const g of [full, cutGroup]) g.traverse((o) => { if (o.isMesh && o.castShadow) o.material = withDoubleShadow(o.material); });
  // door meshes carry a stable tag (style changes swap their material)
  for (const [key, d] of doorMats) for (const g of [full, cutGroup]) g.traverse((o) => { if (o.isMesh && o.material === d.mat) o.userData.doorKey = key; });
  // keep handles used by lighting.js pointing at the live instances
  M.diffuser = shadowClones.get(M.diffuser) || M.diffuser;
  M.led = shadowClones.get(M.led) || M.led;

  full.name = 'architecture'; cutGroup.name = 'architecture-cutaway';
  cutGroup.visible = false;
  const group = new THREE.Group(); group.name = 'architecture-root';
  group.add(full, cutGroup);
  group.traverse((o) => { if (o.isMesh) { o.userData.architecture = true; } });

  const lightsPts = downlights;

  // 2D colliders for the camera (x/z rectangles)
  const colliders = [
    { x0: -1, x1: 2.05, z0: -1, z1: 2.65, kind: 'bath' },
  ];
  for (const b of layout.builtIns || []) {
    if (b.type === 'kitchen') colliders.push({ x0: X - b.base.depth - 0.02, x1: X + 1, z0: b.zFrom - 0.02, z1: b.zTo + 0.02, kind: 'kitchen' });
    if (b.type === 'wardrobe') colliders.push({ x0: b.x0 - 0.05, x1: b.x1 + 0.03, z0: b.z0, z1: b.z1, kind: 'wardrobe' });
  }

  const exterior = [M.railGlass, M.tile, shadowClones.get(M.facade) || M.facade, shadowClones.get(M.concrete) || M.concrete];
  return {
    group, full, cutGroup,
    glass: allGlass,
    glassMaterials: [M.glass, M.railGlass],
    /** Materials that carry the wall colour (walls, skirting, painted doors) — animated on style changes. */
    get wallMaterials() { return [M.wall, M.skirting, ...[...doorMats.values()].filter((d) => d.finish === 'paint').map((d) => d.mat)]; },
    get doorFinish() { return [...doorMats.values()].find((d) => d.fromPack)?.finish || null; },
    /**
     * Stage a door-finish change: new meshes (same geometry, new material) are added next to the old
     * ones for a dissolve; `commit()` removes the old ones. Doors pinned by the layout are kept.
     */
    prepareDoorFinish(finish) {
      // door meshes are found by a stable tag, never by material identity: a dissolve dresses them in
      // temporary clones, and a second switch during it must still find them (T3)
      const inn = [], out = [], jobs = [];
      for (const [key, d] of doorMats) {
        if (!d.fromPack || d.finish === finish) continue;
        const mat = own(finishMaterial(finish, '#' + M.wall.color.getHexString()).clone());
        mat.shadowSide = THREE.DoubleSide;
        const found = [];
        for (const g of [full, cutGroup]) g.traverse((o) => { if (o.isMesh && o.userData.doorKey === key && !o.userData.doorOld) found.push(o); });
        for (const o of found) {
          const m2 = new THREE.Mesh(o.geometry, mat);
          m2.position.copy(o.position); m2.quaternion.copy(o.quaternion); m2.scale.copy(o.scale);
          m2.castShadow = o.castShadow; m2.receiveShadow = o.receiveShadow; m2.renderOrder = o.renderOrder;
          m2.userData = { ...o.userData, doorKey: key, doorOld: false }; m2.name = o.name;
          o.userData.doorOld = true;
          o.parent.add(m2);
          inn.push(m2); out.push(o);
        }
        jobs.push({ d, mat });
      }
      let done = false;
      return {
        inn, out, finish,
        commit() {
          if (done) return; done = true;
          for (const o of out) o.removeFromParent();
          for (const { d, mat } of jobs) { d.mat = mat; d.finish = finish; }
        },
      };
    },
    get wallColor() { return '#' + M.wall.color.getHexString(); },
    /** Exterior surfaces reflect the sky PMREM, never the interior capture. */
    setSkyEnv(tex) { for (const m of exterior) { if (m.envMap !== tex) { m.envMap = tex; m.needsUpdate = true; } } },
    /** Path tracer: real transmissive glass (white + subtle attenuation, no teal), no PMREM maps. */
    preparePhoto() {
      const saved = [];
      const set = (m, k, v) => { saved.push([m, k, m[k]]); m[k] = v; };
      for (const [m, att, dist] of [[M.glass, '#f2f6f4', 1.0], [M.railGlass, '#e9f2ee', 0.5]]) {
        set(m, 'color', new THREE.Color(0xffffff)); set(m, 'transmission', 1); set(m, 'thickness', 0.012);
        set(m, 'attenuationColor', new THREE.Color(att)); set(m, 'attenuationDistance', dist);
        set(m, 'specularColor', new THREE.Color(0xffffff)); set(m, 'transparent', false); set(m, 'blending', THREE.NormalBlending);
        set(m, 'roughness', 0); set(m, 'opacity', 1);
      }
      for (const m of exterior) set(m, 'envMap', null);
      return () => { for (let i = saved.length - 1; i >= 0; i--) { const [m, k, v] = saved[i]; m[k] = v; } };
    },
    downlights: lightsPts,
    downlightMaterial: M.diffuser,
    ledMaterial: M.led,
    underCabinet,
    window: (() => { const o = openings.find((q) => q.type === 'window'); return o ? { x0: o.s0, x1: o.s1, y0: o.sill, y1: o.head, z: o.w.c0 } : null; })(),
    bounds: new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(X, H, Z)),
    colliders,
    ceilingAt,
    setCutaway(on) { full.visible = !on; cutGroup.visible = !!on; },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of owned) m.dispose();
    },
  };
}

/**
 * Raster glass = Fresnel reflection only, added on top of whatever is behind it (no diffuse, so no
 * milky veil by day; at night the box-projected room capture makes the glazing a dim mirror).
 * The path tracer gets real transmissive glass instead (see preparePhoto).
 */
function makeGlass(specular) {
  return new THREE.MeshPhysicalMaterial({
    color: 0x000000, roughness: 0.02, metalness: 0, ior: 1.5, specularIntensity: 1, specularColor: new THREE.Color(specular),
    transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    envMapIntensity: 1, name: 'window-glass',
  });
}

/** Engine clone of the floor with a matte lacquer coat (broad soft window reflection). */
function satin(m) {
  const c = m.clone();
  if ('clearcoat' in c) { c.clearcoat = Math.max(c.clearcoat || 0, 0.3); c.clearcoatRoughness = 0.32; }
  c.userData = { ...m.userData };
  return c;
}

function shade(hex, k) {
  const c = new THREE.Color(hex); c.multiplyScalar(k);
  return '#' + c.getHexString();
}
