// Interactive 2D plan drawn from layout + store. Used as the graceful stage when 3D is unavailable.
// Emits the same hover/select payloads as the engine. Owner: interface.
import { safeHex } from './dom.js';
import { typeLabel } from './labels.js';
import { t, onLang } from './i18n.js';
import { nameOf } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
// Things that sit on (or drape over) a parent: reachable via the budget list, not drawn as footprints.
const SKIP = new Set(['cushions', 'mattress', 'bedding', 'decor_set', 'throw', 'tableware', 'centerpiece', 'kitchen_decor', 'nightstand_decor', 'towels']);
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};

export function createPlan({ container, layout, store, onHover, onSelect }) {
  const size = layout.size || { x: 4.6, z: 9 };
  const slots = new Map(layout.slots.map((s) => [s.id, s]));
  let portrait = false;
  let svgEl = null;
  let hot = null;

  // World (x, z) meters → plan (px, py) centimeters. Non-mirrored top view, rotated to landscape.
  const P = (x, z) => (portrait ? [x * 100, z * 100] : [z * 100, (size.x - x) * 100]);
  const W = () => (portrait ? size.x : size.z) * 100;
  const H = () => (portrait ? size.z : size.x) * 100;

  function worldPose(slot, depth = 0) {
    if (slot.pos) return { x: slot.pos[0], z: slot.pos[2], rot: slot.rotY || 0 };
    if (slot.attach && depth < 4) {
      const parent = slots.get(slot.attach.slot);
      if (!parent) return null;
      const pp = worldPose(parent, depth + 1);
      if (!pp) return null;
      const [ox = 0, , oz = 0] = slot.attach.offset || [];
      const t = (pp.rot * Math.PI) / 180;
      return { x: pp.x + ox * Math.cos(t) + oz * Math.sin(t), z: pp.z - ox * Math.sin(t) + oz * Math.cos(t), rot: pp.rot };
    }
    return null;
  }

  function footprint(pose, wM, dM) {
    const t = (pose.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    return [[-wM / 2, -dM / 2], [wM / 2, -dM / 2], [wM / 2, dM / 2], [-wM / 2, dM / 2]]
      .map(([lx, lz]) => P(pose.x + lx * c + lz * s, pose.z - lx * s + lz * c));
  }

  const wallPt = (wall, t) => {
    const [ax, az] = wall.from, [bx, bz] = wall.to;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    return [ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len];
  };

  function draw() {
    const vb = [-40, -40, W() + 80, H() + 80];
    const s = el('svg', { viewBox: vb.join(' '), role: 'group', 'aria-label': t('plan.aria'), preserveAspectRatio: 'xMidYMid meet' });
    const g = el('g');
    s.append(g);

    // Floor
    const [fx0, fy0] = P(0, 0), [fx1, fy1] = P(size.x, size.z);
    g.append(el('rect', { class: 'plan-floor', x: Math.min(fx0, fx1), y: Math.min(fy0, fy1), width: Math.abs(fx1 - fx0), height: Math.abs(fy1 - fy0) }));

    // Built-ins
    for (const b of layout.builtIns || []) {
      let x0, x1, z0, z1;
      if (b.type === 'kitchen' && b.wall === 'east') { x1 = size.x; x0 = size.x - (b.base?.depth || 0.62); z0 = b.zFrom; z1 = b.zTo; }
      else if (b.x0 != null) { x0 = b.x0; x1 = b.x1; z0 = b.z0; z1 = b.z1; }
      else continue;
      const pts = [P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)];
      g.append(el('polygon', { class: 'plan-built', points: pts.map((p) => p.join(',')).join(' ') }));
    }

    // Labels for fixed zones
    const label = (txt, x, z, along = false) => {
      const [px, py] = P(x, z);
      const t = el('text', { class: 'plan-label', x: px, y: py, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'data-label': '' });
      // Labels on narrow strips run along them (portrait plan rotates the kitchen strip vertical).
      if (along && portrait) t.setAttribute('transform', `rotate(-90 ${px} ${py})`);
      t.textContent = txt; g.append(t);
    };
    if ((layout.walls || []).some((w) => /bath/.test(w.id))) label(t('plan.bath'), 1.0, 1.3);
    if ((layout.builtIns || []).some((b) => b.type === 'kitchen')) label(t('plan.kitchen'), size.x - 0.31, 2.45, true);
    label(t('plan.entry'), 3.25, 1.05);

    // Items (rug first, then larger → smaller so small things stay clickable)
    const items = [];
    for (const slot of layout.slots) {
      if (SKIP.has(slot.type)) continue;
      const item = store.selected(slot.id);
      if (!item) continue;
      const pose = worldPose(slot);
      if (!pose) continue;
      const d = item.dims || {};
      let wM = (d.w || 40) / 100, dM = (d.d || 40) / 100;
      const thin = slot.mount === 'wall' || slot.type === 'curtains';
      if (thin) dM = Math.max(dM, 0.05);
      items.push({ slot, item, pose, wM, dM, thin, area: wM * dM });
    }
    items.sort((a, b) => (a.slot.type === 'rug' ? -1 : b.slot.type === 'rug' ? 1 : b.area - a.area));

    for (const it of items) {
      const { slot, item } = it;
      const grp = el('g', {
        class: `plan-item${slot.type === 'rug' ? ' is-rug' : ''}${it.thin ? ' is-thin' : ''}${slot.mount === 'ceiling' && slot.type !== 'curtains' ? ' is-ceiling' : ''}`,
        tabindex: '0', role: 'button', 'data-slot': slot.id, 'data-type': slot.type,
        'aria-label': `${typeLabel(slot.type)}: ${nameOf(item)}`,
        style: `--c:${safeHex(item.colorHex)}`,
      });
      const round = item.dims && (item.dims.round || item.model?.params?.shape === 'round' || slot.type === 'plant' || slot.type === 'pendant_lamp' || slot.type === 'table_lamp' || slot.type === 'floor_lamp');
      if (round) {
        const [cx, cy] = P(it.pose.x, it.pose.z);
        grp.append(el('circle', { class: 'shape', cx, cy, r: (Math.min(it.wM, it.dM) * 100) / 2 }));
      } else {
        const pts = footprint(it.pose, it.wM, it.dM);
        grp.append(el('polygon', { class: 'shape', points: pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '), 'stroke-linejoin': 'round' }));
      }
      const payload = (e) => ({ slotId: slot.id, slotType: slot.type, item: store.selected(slot.id), x: e.clientX, y: e.clientY });
      grp.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') onHover(payload(e)); });
      grp.addEventListener('pointerleave', () => onHover(null));
      grp.addEventListener('click', (e) => { e.stopPropagation(); onSelect(payload(e)); });
      const center = () => { const r = grp.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      grp.addEventListener('focus', () => { if (grp.matches(':focus-visible')) onHover({ slotId: slot.id, slotType: slot.type, item: store.selected(slot.id), ...center() }); });
      grp.addEventListener('blur', () => onHover(null));
      grp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const r = grp.getBoundingClientRect();
          onSelect({ slotId: slot.id, slotType: slot.type, item: store.selected(slot.id), x: r.left + r.width / 2, y: r.top + r.height / 2, keyboard: true });
        }
      });
      g.append(grp);
    }

    // Walls with openings cut out
    const wallG = el('g');
    for (const w of layout.walls || []) {
      const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
      const cuts = (layout.openings || []).filter((o) => o.wall === w.id).map((o) => {
        const a = o.center != null ? o.center - o.width / 2 : o.from;
        const b = o.center != null ? o.center + o.width / 2 : o.to;
        return { o, a: Math.max(0, a), b: Math.min(len, b) };
      }).sort((p, q) => p.a - q.a);
      let t = 0;
      const thick = (w.thickness || layout.size?.wallThickness || 0.15) * 100;
      const seg = (a, b) => {
        if (b - a < 0.005) return;
        const [x0, z0] = wallPt(w, a), [x1, z1] = wallPt(w, b);
        const [p0, p1] = [P(x0, z0), P(x1, z1)];
        wallG.append(el('line', { class: 'plan-wall', x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], 'stroke-width': thick }));
      };
      for (const c of cuts) {
        seg(t, c.a);
        const [x0, z0] = wallPt(w, c.a), [x1, z1] = wallPt(w, c.b);
        const [p0, p1] = [P(x0, z0), P(x1, z1)];
        if (c.o.type === 'window') {
          const nx = p1[1] - p0[1], ny = p0[0] - p1[0], nl = Math.hypot(nx, ny) || 1;
          for (const k of [-3, 3]) wallG.append(el('line', { class: 'plan-window', x1: p0[0] + (nx / nl) * k, y1: p0[1] + (ny / nl) * k, x2: p1[0] + (nx / nl) * k, y2: p1[1] + (ny / nl) * k }));
        } else if (c.o.closed) {
          wallG.append(el('line', { class: 'plan-door', x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1] }));
        } else {
          // Door leaf swung 90° into the apartment + arc
          const r = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          const [cx, cz] = [size.x / 2, size.z / 2];
          const [mx, mz] = wallPt(w, (c.a + c.b) / 2);
          const inward = P(mx + Math.sign(cx - mx) * (Math.abs(w.from[0] - w.to[0]) < 1e-6 ? 1 : 0), mz + Math.sign(cz - mz) * (Math.abs(w.from[1] - w.to[1]) < 1e-6 ? 1 : 0));
          const pm = P(mx, mz);
          const dx = inward[0] - pm[0], dy = inward[1] - pm[1], dl = Math.hypot(dx, dy) || 1;
          const leaf = [p0[0] + (dx / dl) * r, p0[1] + (dy / dl) * r];
          wallG.append(el('line', { class: 'plan-door', x1: p0[0], y1: p0[1], x2: leaf[0], y2: leaf[1] }));
          const sweep = ((leaf[0] - p0[0]) * (p1[1] - p0[1]) - (leaf[1] - p0[1]) * (p1[0] - p0[0])) > 0 ? 0 : 1;
          wallG.append(el('path', { class: 'plan-door', d: `M${leaf[0]},${leaf[1]} A${r},${r} 0 0 ${sweep} ${p1[0]},${p1[1]}`, 'stroke-dasharray': '4 4' }));
        }
        t = c.b;
      }
      seg(t, len);
    }
    g.append(wallG);

    // Click on empty floor clears the selection (same as the engine's select(null)).
    s.addEventListener('click', () => onSelect(null));
    container.replaceChildren(s);
    svgEl = s;
    fitText();
    if (hot) highlight(hot);
  }

  function fitText() {
    if (!svgEl) return;
    const vbW = W() + 80;
    const pxPerCm = (svgEl.clientWidth || container.clientWidth || 800) / vbW;
    const scale = Math.min(pxPerCm, (svgEl.clientHeight || 1) / (H() + 80));
    const fs = 12 / Math.max(scale, 0.2);
    svgEl.querySelectorAll('[data-label]').forEach((t) => t.setAttribute('font-size', fs.toFixed(1)));
  }

  function highlight(slotId) {
    hot = slotId;
    if (!svgEl) return;
    // Everything that shares the selection (both nightstands, both chairs) lights up together.
    const ids = new Set(slotId ? (store.slotsFor?.(slotId) || [slotId]) : []);
    svgEl.querySelectorAll('.plan-item').forEach((n) => n.classList.toggle('is-hot', ids.has(n.dataset.slot)));
    container.closest('.stage')?.classList.toggle('has-highlight', ids.size > 0);
  }

  function relayout() {
    const r = container.getBoundingClientRect();
    const want = r.width > 0 && r.height > r.width * 1.05;
    if (want !== portrait || !svgEl) { portrait = want; draw(); } else fitText();
  }

  const ro = 'ResizeObserver' in window ? new ResizeObserver(relayout) : null;
  ro?.observe(container);
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const off = store.on('change', schedule);
  const offLang = onLang(() => draw());
  relayout();

  return {
    highlight,
    destroy() {
      onHover(null);
      ro?.disconnect(); off?.(); offLang?.();
      container.replaceChildren();
      container.closest('.stage')?.classList.remove('has-highlight');
    },
  };
}
