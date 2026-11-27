// Live → Photo: read-only adapter over the 3D engine. Owner: photo.
// Uses the engine's Live → Photo API when present (feature-detected):
//   villar.busy                         true while anything changes the next frame on its own
//   villar.pose()                       quantized camera pose { position, yaw, pitch, fov, shift, key }
//   villar.capture({ width, height })   → Promise { blob (clean JPEG: no outline, marker, ghosts), width, height,
//                                         pose, items: [{ id, slot, type, area }] by pixel area (ID pass) }
// Without it (older engine) it reads the same state from `villar.debug` (renderer, post, camera, furnisher …) and
// renders the clean frame itself; every access is guarded, so a renamed field only disables the photo.
import * as THREE from 'three';

const q = (v, step) => Math.round(v / step) * step;
const fmt = (v, step, dec) => q(v, step).toFixed(dec).replace(/^-(0\.?0*)$/, '$1');

/** Why the engine is not at rest right now (null = resting). Never throws. */
export function busyReason(v, { ignoreRunning = false } = {}) {
  try {
    if (!v || !v.ready) return 'not-ready';
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'hidden';
    const d = v.debug || {};
    if (v.photoActive || d.photo?.busy || d.photo?.active) return 'pt-photo';
    if (v.busy === true) return 'busy';             // the engine's own view (flight, fades, slider runs, bakes, exposure)
    if (v.inspect && v.inspect.atRest === false) return 'turning'; // focused item still spinning / settling
    if (d.refine && d.refine.phase && d.refine.phase !== 'off') return 'refine';
    if (d.controls?.moving || d.controls?.isDragging?.() || d.controls?.mode === 'transition') return 'moving';
    if (d.fader?.active) return 'fade';
    if (d.gi?.baking || d.probes?.baking) return 'gi';
    const b = d.budget;
    if (b && (b.dragging || b.pending || b.inflight || b.runs)) return 'budget';
    if (d.thumbs?.busy) return 'thumbs';
    if (typeof d.materials?.pending === 'function' && d.materials.pending() > 0) return 'textures';
    // the render loop is on demand: running = something still changes on screen (exposure settling, halo fade …)
    if (d.running && !ignoreRunning) return 'rendering';
    return null;
  } catch { return 'error'; }
}

/** Quantised camera pose: the part of the cache key that says "same view". */
export function poseString(v) {
  try {
    const cut = !!(v.debug?.arch?.cutGroup?.visible) || v.view === 'top';
    if (typeof v.pose === 'function') {
      // the engine's key (5 cm, 0.5°, fov 0.5°, lens shift 1 %) + what it leaves out: stage aspect, dollhouse, item turn
      const p = v.pose();
      const gl = v.debug?.renderer?.domElement;
      const aspect = gl ? gl.width / Math.max(1, gl.height) : (v.debug?.camera?.aspect || 0);
      if (p?.key) return `${String(p.key).replace(/[^a-z0-9_:;,.|-]/gi, '')};a:${fmt(aspect, 0.01, 2)};m:${cut ? 1 : 0}${itemTurn(v)}`;
    }
    const cam = v.debug?.camera;
    if (!cam) return null;
    cam.updateMatrixWorld();
    const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const e = cam.projectionMatrix.elements;
    return build([pos.x, pos.y, pos.z], [dir.x, dir.y, dir.z], cam.fov, cam.aspect, [e[8], e[9]], cut) + itemTurn(v);
  } catch { return null; }
}
/** Focus (docs/FOCUS.md): the focused item's turntable angle is part of "the same view". */
function itemTurn(v) {
  try {
    const slot = v.focused;
    if (!slot) return '';
    const ins = v.inspect;                         // engine focus v2: { slotId, angle (0 = home), atRest, home }
    if (ins && ins.slotId === slot && Number.isFinite(ins.angle)) return `;o:${slot}:${fmt(ins.angle, 1, 0)}`;
    const g = v.debug?.furnisher?.groupOf?.(slot);
    if (!g) return `;o:${slot}`;
    const e = new THREE.Euler().setFromQuaternion(g.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    return `;o:${slot}:${fmt((e.y * 180) / Math.PI, 1, 0)}`;
  } catch { return ''; }
}
function build(p, d, fov, aspect, s, cut) {
  return `c:${p.map((x) => fmt(x, 0.02, 2)).join(',')};d:${d.map((x) => fmt(x, 0.002, 3)).join(',')};f:${fmt(fov, 0.1, 1)};s:${s.map((x) => fmt(x, 0.005, 3)).join(',')};a:${fmt(aspect, 0.01, 2)};m:${cut ? 1 : 0}`;
}

/**
 * Draw the current clean frame into `ctx` at (dx, dy, dw, dh). Re-renders synchronously so the WebGL drawing
 * buffer is valid (the same trick as villar.snapshot()), with the selection outline switched off for that one
 * frame. Returns { width, height } of the source drawing buffer, or null.
 */
export function drawFrame(v, ctx, dx, dy, dw, dh, { pad = null } = {}) {
  const d = v.debug;
  const gl = d?.renderer?.domElement;
  if (!gl || !d.post?.render) return null;
  const ol = d.post.outline;
  const was = ol ? ol.enabled : false;
  try {
    if (ol) ol.enabled = false;
    d.post.render(0.016);
    paint(ctx, gl, gl.width, gl.height, dx, dy, dw, dh, pad);
  } finally {
    if (ol) ol.enabled = was;
    if (was) d.invalidate?.(1); // put the outline back on screen
  }
  return { width: gl.width, height: gl.height };
}

/** Frame into (dx,dy,dw,dh); the padding around it (when the canvas is a model aspect ratio) is the stretched edge. */
function paint(ctx, src, sw, sh, dx, dy, dw, dh, pad) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (pad) {
    const { W, H } = pad;
    const blur = 'filter' in ctx;
    if (blur) ctx.filter = `blur(${Math.round(Math.max(W, H) / 90)}px)`;
    // edge strips stretched into the bands, then blurred: a soft continuation the model is told to complete
    if (dy > 0) {
      ctx.drawImage(src, 0, 0, sw, Math.max(1, sh * 0.04), 0, 0, W, dy + 2);
      ctx.drawImage(src, 0, sh * 0.96, sw, Math.max(1, sh * 0.04), 0, dy + dh - 2, W, H - dy - dh + 2);
    }
    if (dx > 0) {
      ctx.drawImage(src, 0, 0, Math.max(1, sw * 0.04), sh, 0, 0, dx + 2, H);
      ctx.drawImage(src, sw * 0.96, 0, Math.max(1, sw * 0.04), sh, dx + dw - 2, 0, W - dx - dw + 2, H);
    }
    if (blur) ctx.filter = 'none';
  }
  ctx.drawImage(src, 0, 0, sw, sh, dx, dy, dw, dh);
}

/**
 * The clean frame for the model, in a canvas of the model's aspect ratio (fit from index.js fitAspect):
 * the engine's capture() at fit.fw × fit.fh when available (it renders at that size whatever the screen's DPR, and
 * returns the items by pixel area), else a synchronous re-render through villar.debug.
 * Resolves { canvas, items | null, blob | null (the engine's JPEG when no padding was needed) } or null.
 */
export async function captureFrame(v, fit, { engine = true } = {}) {
  const c = document.createElement('canvas');
  c.width = fit.W; c.height = fit.H;
  const ctx = c.getContext('2d', { alpha: false });
  const pad = fit.fx > 0 || fit.fy > 0 ? { W: fit.W, H: fit.H } : null;
  if (engine && typeof v.capture === 'function') {
    let r;
    try { r = await v.capture({ width: fit.fw, height: fit.fh, quality: 0.92, wait: true, timeout: 1500 }); } catch { r = null; }
    if (r?.blob) {
      const bmp = await createImageBitmap(r.blob);
      paint(ctx, bmp, bmp.width, bmp.height, fit.fx, fit.fy, fit.fw, fit.fh, pad);
      bmp.close?.();
      // bbox (normalised [x, y, w, h] of the item in the frame) when the engine's ID pass provides it — requested
      const items = Array.isArray(r.items) ? r.items.map((x) => ({ id: x.id, slots: [x.slot], area: x.area, ...(Array.isArray(x.bbox) ? { bbox: x.bbox } : {}) })) : null;
      return { canvas: c, items, blob: pad ? null : r.blob };
    }
  }
  return drawFrame(v, ctx, fit.fx, fit.fy, fit.fw, fit.fh, { pad }) ? { canvas: c, items: null, blob: null } : null;
}

/** Drawing-buffer size of the live canvas. */
export function frameSize(v) {
  try {
    const gl = v.debug?.renderer?.domElement;
    if (gl) return { width: gl.width, height: gl.height, el: gl };
  } catch { /* fall through */ }
  return null;
}

/**
 * Visible catalog items ranked by screen area (fallback when the engine's capture gave none): a grid of BVH raycasts
 * (cols × rows) spread over idle slices. `itemOf(slotId)` maps a slot to its catalog item id.
 * Resolves [{ id, slots: [...], area }] (area = share of the frame), or [] when the engine can't be read.
 */
export async function visibleItems(v, itemOf, { cols = 40, rows = 24, signal } = {}) {
  const d = v.debug;
  if (!d?.camera || !d?.furnisher?.root) return [];
  const roots = [d.furnisher.root, d.arch?.full, d.arch?.cutGroup].filter((o) => o && o.visible !== false);
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  ray.far = 60;
  const ndc = new THREE.Vector2();
  const count = new Map();
  const N = cols * rows;
  let i = 0;
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible || p.userData?.noPick) return false; return true; };
  while (i < N) {
    if (signal?.aborted) return [];
    const t0 = performance.now();
    for (; i < N && performance.now() - t0 < 8; i++) {
      const cx = i % cols, cy = (i / cols) | 0;
      ndc.set(((cx + 0.5) / cols) * 2 - 1, -(((cy + 0.5) / rows) * 2 - 1));
      ray.setFromCamera(ndc, d.camera);
      let hitsAt;
      try { hitsAt = ray.intersectObjects(roots, true); } catch { hitsAt = []; }
      for (const h of hitsAt) {
        if (!shown(h.object)) continue;
        const m = h.object.material;
        if (m && (m.name === 'window-glass' || (m.transparent && m.opacity < 0.5) || m.blending === THREE.AdditiveBlending)) continue;
        let o = h.object;
        while (o && !o.userData?.slotId && o.parent) o = o.parent;
        const sid = o?.userData?.slotId;
        if (sid) count.set(sid, (count.get(sid) || 0) + 1);
        break; // first opaque hit occludes the rest
      }
    }
    if (i < N) await new Promise((r) => setTimeout(r, 0)); // yield: no long task
  }
  return rank([...count].map(([slotId, n]) => ({ slotId, id: itemOf(slotId), area: n / N })));
}

function rank(list) {
  const by = new Map();
  for (const x of list) {
    if (!x.id) continue;
    const e = by.get(x.id) || { id: x.id, slots: [], area: 0 };
    e.slots.push(x.slotId); e.area += x.area || 0;
    by.set(x.id, e);
  }
  return [...by.values()].sort((a, b) => b.area - a.area).map((e) => ({ ...e, area: +e.area.toFixed(4) }));
}
