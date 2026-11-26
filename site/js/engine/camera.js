// Villar engine — camera: first-person "standing in the apartment" controller, object focus and the
// dollhouse orbit. Owner: engine.
//
// Lens: 24 mm full-frame equivalent defined by the HORIZONTAL field of view (74° on landscape;
// portrait keeps ≥ 66° horizontal). Verticals stay vertical: within ±15° of look pitch the camera
// stays level and the frustum is shifted (architectural shift lens / two-point perspective); beyond
// that the extra pitch is real rotation. Right / bottom viewport insets (HUD panel, mobile sheet)
// move the optical centre into the uncovered part of the stage.
// Modes:
//   walk   — eye height 1.6 m, drag to look (grab-style, inertia), WASD/arrows (only while the stage
//            has focus), click floor to walk (gives up when blocked), wheel/pinch to dolly (wheel only
//            after the user engaged the stage — page scroll is never hijacked), collisions.
//   focus  — framed on one object from a collision-safe 3/4 viewpoint; drag = light orbit around it
//            (bounded), wheel/pinch = distance. `unfocus()` returns to the previous viewpoint.
//   orbit  — dollhouse ('top').
// Every change of viewpoint is an eased flight (~0.9 s); reduced motion → instant cut.
import * as THREE from 'three';
import { clamp, easeInOutCubic, DEG } from './util.js';

const RADIUS = 0.24;          // body radius for collisions
const WALK_SPEED = 1.5;       // m/s
const LOOK_SPEED = 0.0042;    // rad per px at ~50° vFOV
const PITCH_LIMIT = 80 * DEG;
const SHIFT_MAX = 15 * DEG;   // look pitch absorbed by lens shift (verticals stay vertical)
const H_FOV = 74 * DEG;       // 24 mm full-frame, horizontal
const H_FOV_PORTRAIT_MIN = 66 * DEG;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createCameraController({ camera, dom, layout, colliders = [], onChange = () => {} }) {
  const S = layout.size;
  const views = layout.views || {};
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!mq?.matches;
  mq?.addEventListener?.('change', (e) => { reduced = e.matches; });

  const state = {
    mode: 'walk',
    pos: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    yawVel: 0, pitchVel: 0,
    move: new THREE.Vector3(),
    keys: new Set(),
    dolly: 0,
    walkTarget: null,
    walkProgress: { d: Infinity, t: 0 },
    orbit: { target: new THREE.Vector3(S.x / 2, 0.4, S.z / 2), radius: 12.5, theta: 0.0, phi: 38 * DEG, thetaVel: 0, phiVel: 0 },
    focus: null,         // { center, size, yaw, pitch, dist, yaw0, dist0, yawVel, pitchVel }
    returnPose: null,    // where unfocus() goes back to
    transition: null,
    look: null,          // eased re-aim in walk / orbit
    view: 'eye',
    enabled: true,
    inset: 0, insetTarget: 0,    // bottom inset, fraction of viewport height
    insetR: 0, insetRTarget: 0,  // right inset, fraction of viewport width
  };
  let dynamicColliders = [];
  let viewW = 1, viewH = 1;
  let orbitDirty = true;
  let curShift = 0;
  const api = {};

  // ---------------------------------------------------------------- lens + upright shift
  const _d = new THREE.Vector3();
  const dirFromYawPitch = (yaw, pitch, out = _d) =>
    out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  function yawPitchFromDir(d) {
    const l = Math.max(1e-9, d.length());
    return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(clamp(d.y / l, -1, 1)) };
  }
  /** fov + vertical lens shift + insets. ndc of the optical axis: (−insetR, +inset). */
  function applyProjection(shiftAngle) {
    curShift = shiftAngle;
    camera.updateProjectionMatrix();
    const t = Math.tan((camera.fov * DEG) / 2);
    camera.projectionMatrix.elements[9] = Math.tan(shiftAngle) / t - state.inset;
    camera.projectionMatrix.elements[8] = state.insetR;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  const splitPitch = (p) => { const s = clamp(p, -SHIFT_MAX, SHIFT_MAX); return { shift: s, rot: p - s }; };
  /** Upright camera at pos looking along (yaw, pitch). */
  function applyUpright(pos, yaw, pitch) {
    const { shift, rot } = splitPitch(pitch);
    camera.position.copy(pos);
    const d = dirFromYawPitch(yaw, rot);
    camera.up.set(0, 1, 0);
    camera.lookAt(pos.x + d.x, pos.y + d.y, pos.z + d.z);
    applyProjection(shift);
  }
  const applyWalkCamera = () => applyUpright(state.pos, state.yaw, state.pitch);

  function orbitPose(o = state.orbit, out = new THREE.Vector3()) {
    return out.set(
      o.target.x + o.radius * Math.cos(o.phi) * Math.sin(o.theta),
      o.target.y + o.radius * Math.sin(o.phi),
      o.target.z - o.radius * Math.cos(o.phi) * Math.cos(o.theta),
    );
  }
  const _o = new THREE.Vector3();
  function applyOrbitCamera() {
    camera.position.copy(orbitPose(state.orbit, _o));
    camera.up.set(0, 1, 0);
    camera.lookAt(state.orbit.target);
    applyProjection(0);
    orbitDirty = false;
  }
  function focusPos(fo, out = new THREE.Vector3()) {
    return out.set(
      fo.center.x + Math.sin(fo.yaw) * Math.cos(fo.pitch) * fo.dist,
      fo.center.y + Math.sin(fo.pitch) * fo.dist,
      fo.center.z + Math.cos(fo.yaw) * Math.cos(fo.pitch) * fo.dist,
    );
  }
  /** Upright (yaw/pitch) description of a focus pose: from the camera toward the object. */
  function focusUpright(fo) {
    const pos = focusPos(fo);
    const { yaw, pitch } = yawPitchFromDir(new THREE.Vector3().subVectors(fo.center, pos));
    return { pos, yaw, pitch };
  }
  const _fp = new THREE.Vector3(), _fd = new THREE.Vector3();
  function applyFocusCamera() {
    const fo = state.focus;
    focusPos(fo, _fp);
    _fd.subVectors(fo.center, _fp);
    const { yaw, pitch } = yawPitchFromDir(_fd);
    applyUpright(_fp, yaw, pitch);
  }
  function applyCurrent() {
    if (state.mode === 'walk') applyWalkCamera();
    else if (state.mode === 'orbit') applyOrbitCamera();
    else if (state.mode === 'focus') applyFocusCamera();
    else applyProjection(curShift);
  }

  // ---------------------------------------------------------------- collision (2D, x/z)
  function resolve(p, r = RADIUS) {
    p.x = clamp(p.x, r, S.x - r);
    p.z = clamp(p.z, r, S.z - r);
    const all = colliders.concat(dynamicColliders);
    for (let it = 0; it < 3; it++) {
      for (const c of all) {
        if (c.rot !== undefined) {
          const dx = p.x - c.cx, dz = p.z - c.cz;
          const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
          const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
          const qx = clamp(lx, -c.hw, c.hw), qz = clamp(lz, -c.hd, c.hd);
          const ex = lx - qx, ez = lz - qz;
          const dist = Math.hypot(ex, ez);
          if (dist >= r) continue;
          let wx, wz;
          if (dist < 1e-6) {
            const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
            if (px < pz) { wx = (Math.sign(lx) || 1) * (px + r); wz = 0; } else { wz = (Math.sign(lz) || 1) * (pz + r); wx = 0; }
          } else { const k = (r - dist) / dist; wx = ex * k; wz = ez * k; }
          p.x += wx * Math.cos(c.rot) + wz * Math.sin(c.rot);
          p.z += -wx * Math.sin(c.rot) + wz * Math.cos(c.rot);
        } else {
          const qx = clamp(p.x, c.x0, c.x1), qz = clamp(p.z, c.z0, c.z1);
          const ex = p.x - qx, ez = p.z - qz;
          const dist = Math.hypot(ex, ez);
          if (dist >= r) continue;
          if (dist < 1e-6) {
            const dl = p.x - c.x0, dr = c.x1 - p.x, db = p.z - c.z0, dt = c.z1 - p.z;
            const m = Math.min(dl, dr, db, dt);
            if (m === dl) p.x = c.x0 - r; else if (m === dr) p.x = c.x1 + r; else if (m === db) p.z = c.z0 - r; else p.z = c.z1 + r;
            continue;
          }
          p.x += (ex / dist) * (r - dist); p.z += (ez / dist) * (r - dist);
        }
      }
      p.x = clamp(p.x, r, S.x - r);
      p.z = clamp(p.z, r, S.z - r);
    }
    return p;
  }
  /** A camera position that is inside the room and not inside furniture / walls. */
  function freeSpot(p, r = 0.18) {
    if (p.y < 0.35 || p.y > S.ceiling - 0.15) return false;
    const q = resolve(p.clone(), r);
    return Math.hypot(q.x - p.x, q.z - p.z) < 0.01;
  }

  // ---------------------------------------------------------------- poses + flights
  // pose = { mode:'walk', pos, yaw, pitch } | { mode:'orbit', orbit } | { mode:'focus', focus }
  function poseForView(name) {
    if (name === 'top') {
      const wide = camera.aspect > 1.05; // long axis across landscape screens, window on the right
      const o = { ...state.orbit, target: new THREE.Vector3(S.x / 2, 0.4, S.z / 2), radius: wide ? 9.6 : 11.2, theta: wide ? -90 * DEG : 0, phi: wide ? 58 * DEG : 64 * DEG, thetaVel: 0, phiVel: 0 };
      return { mode: 'orbit', orbit: o };
    }
    const v = views[name] || views.eye;
    const pos = resolve(new THREE.Vector3(...v.pos));
    const { yaw, pitch } = yawPitchFromDir(new THREE.Vector3(...v.target).sub(pos));
    return { mode: 'walk', pos, yaw, pitch };
  }
  /** The pose the camera is at (or flying to). */
  function currentPose() {
    if (state.transition) return state.transition.pose;
    if (state.mode === 'orbit') return { mode: 'orbit', orbit: { ...state.orbit, target: state.orbit.target.clone() } };
    if (state.mode === 'focus') return { mode: 'focus', focus: { ...state.focus, center: state.focus.center.clone() } };
    return { mode: 'walk', pos: state.pos.clone(), yaw: state.yaw, pitch: state.pitch };
  }
  const upright = (pose) => (pose.mode === 'walk' ? { pos: pose.pos, yaw: pose.yaw, pitch: pose.pitch } : pose.mode === 'focus' ? focusUpright(pose.focus) : null);
  /** Camera position + orientation + shift a pose renders with. */
  function poseTransform(pose) {
    const o = new THREE.Object3D();
    let shift = 0;
    if (pose.mode === 'orbit') { o.position.copy(orbitPose(pose.orbit)); o.lookAt(pose.orbit.target); }
    else {
      const u = upright(pose);
      const sp = splitPitch(u.pitch); shift = sp.shift;
      o.position.copy(u.pos); o.lookAt(u.pos.clone().add(dirFromYawPitch(u.yaw, sp.rot, new THREE.Vector3())));
    }
    o.rotateY(Math.PI); // Object3D.lookAt aims +Z; cameras look down −Z
    return { pos: o.position.clone(), quat: o.quaternion.clone(), shift };
  }
  function commitPose(pose) {
    state.mode = pose.mode;
    if (pose.mode === 'orbit') { state.orbit = pose.orbit; state.focus = null; applyOrbitCamera(); }
    else if (pose.mode === 'focus') { state.focus = pose.focus; applyFocusCamera(); }
    else { state.focus = null; state.pos.copy(pose.pos); state.yaw = pose.yaw; state.pitch = pose.pitch; applyWalkCamera(); }
  }

  /** Eased flight to a pose from wherever the camera is now (also mid-flight). */
  function flyTo(pose, { instant = false, duration = null, onDone = null } = {}) {
    state.walkTarget = null; state.look = null; state.dolly = 0;
    state.yawVel = state.pitchVel = 0;
    state.orbit.thetaVel = state.orbit.phiVel = 0;
    if (state.focus) state.focus.yawVel = state.focus.pitchVel = 0;
    if (instant || reduced) {
      state.transition = null; commitPose(pose); onDone?.();
      return;
    }
    // where the camera is right now, as an upright pose if possible (keeps verticals straight)
    const fromUp = state.transition ? state.transition.liveUpright
      : state.mode === 'walk' ? { pos: state.pos.clone(), yaw: state.yaw, pitch: state.pitch }
        : state.mode === 'focus' ? focusUpright(state.focus) : null;
    const toUp = upright(pose);
    const to = poseTransform(pose);
    const dist = camera.position.distanceTo(to.pos);
    const dur = duration ?? clamp(0.7 + dist * 0.05, 0.8, 1.3);
    const tr = { t: 0, dur, pose, onDone, liveUpright: null };
    if (fromUp && toUp) {
      tr.kind = 'upright';
      tr.fromPos = fromUp.pos.clone(); tr.toPos = toUp.pos.clone();
      tr.fromYaw = fromUp.yaw; tr.dYaw = wrapAngle(toUp.yaw - fromUp.yaw);
      tr.fromPitch = fromUp.pitch; tr.toPitch = toUp.pitch;
      // lift over furniture when crossing the room at low height
      tr.lift = Math.min(0.25, dist * 0.04);
    } else {
      tr.kind = 'free';
      tr.fromPos = camera.position.clone(); tr.fromQ = camera.quaternion.clone(); tr.fromShift = curShift;
      tr.toPos = to.pos; tr.toQ = to.quat; tr.toShift = to.shift;
      tr.lift = ((pose.mode === 'orbit') !== (state.mode === 'orbit')) ? 0.6 : 0;
    }
    state.transition = tr;
    state.mode = 'transition';
  }

  function setView(name, { instant = false } = {}) {
    const pose = poseForView(name);
    state.view = name;
    state.returnPose = null;
    const leavingFocus = !!state.focus;
    state.focus = null;
    if (leavingFocus) api.onFocusEnd?.();
    flyTo(pose, { instant, onDone: () => onChange({ view: name, mode: pose.mode }) });
    onChange({ view: name, mode: pose.mode, transitioning: !(instant || reduced) });
  }

  // ---------------------------------------------------------------- focus
  /**
   * Fly to a pleasing 3/4 framing of an object: candidates around its front (±35° preferred), at a
   * distance from its size, camera a little above the object; each candidate must be a free spot
   * with a clear line of sight (`clear(from, to)`, supplied by the engine). Falls back to re-aiming
   * from where the camera is.
   */
  function focusOn({ center, size = 0.8, radius = null, front = null, clear = () => true, preferYaw = null }) {
    if (!state.focus && !(state.transition && state.transition.pose.mode === 'focus')) state.returnPose = currentPose();
    const cam = camera.position;
    const base = front ? Math.atan2(front.x, front.z) : Math.atan2(cam.x - center.x, cam.z - center.z);
    // distance that fits the object's bounding sphere inside the FREE part of the stage (HUD insets
    // applied), with margin (D2-01): r / sin(half-angle of the free rect)
    const r = Math.max(0.15, radius ?? size * 0.6);
    const tv = Math.tan((camera.fov * DEG) / 2), th = tv * camera.aspect;
    const fh = Math.max(0.25, 1 - state.insetTarget), fw = Math.max(0.25, 1 - state.insetRTarget);
    const half = Math.min(Math.atan(tv * fh), Math.atan(th * fw));
    const dFit = clamp((1.12 * r) / Math.sin(half), 0.9, 5.5);
    const offs = [35, -35, 25, -25, 48, -48, 12, -12, 62, -62, 0, 80, -80, 100, -100].map((a) => a * DEG);
    let best = null;
    // prefer another angle before moving closer; closer only when no angle has room
    for (const k of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
      const dist = dFit * k;
      const dy = clamp(center.y + 0.3 + r * 0.45, 0.95, 1.75) - center.y;
      const h = Math.sqrt(Math.max(0.04, dist * dist - dy * dy));
      for (const off of offs) {
        const fo = { center: center.clone(), size, yaw: base + off, pitch: Math.atan2(dy, h), dist };
        const p = focusPos(fo);
        if (!freeSpot(p) || !clear(p, center)) continue;
        let score = Math.abs(Math.abs(off) - 35 * DEG) * 1.2 + p.distanceTo(cam) * 0.04;
        if (preferYaw !== null) score += Math.abs(wrapAngle(fo.yaw - preferYaw)) * 2.5;
        if (!best || score < best.score) best = { fo, score };
      }
      if (best) break;
    }
    let fo = best?.fo;
    if (!fo) {
      // nowhere better: stay, just turn toward the object
      const d = new THREE.Vector3().subVectors(cam, center);
      fo = { center: center.clone(), size, yaw: Math.atan2(d.x, d.z), pitch: Math.asin(clamp(d.y / Math.max(1e-6, d.length()), -0.99, 0.99)), dist: Math.max(0.6, d.length()) };
    }
    fo.yaw0 = fo.yaw; fo.dist0 = fo.dist; fo.yawVel = 0; fo.pitchVel = 0; fo.clear = clear;
    flyTo({ mode: 'focus', focus: fo }, { duration: preferYaw !== null ? 0.6 : 0.9 });
    return true;
  }
  /** Back to where the camera was before focusing. */
  function unfocus({ instant = false } = {}) {
    const back = state.returnPose;
    if (!state.focus && !(state.transition && state.transition.pose.mode === 'focus')) return false;
    state.returnPose = null;
    flyTo(back || poseForView(state.view || 'eye'), { instant, duration: 0.9, onDone: () => onChange({ view: state.view, mode: state.mode }) });
    return true;
  }
  /** Orbit step in focus mode; rejected if the new viewpoint would be blocked. */
  function focusOrbit(dyaw, dpitch, ddist = 0) {
    const fo = state.focus;
    const prev = { yaw: fo.yaw, pitch: fo.pitch, dist: fo.dist };
    fo.yaw = clamp(fo.yaw0 + wrapAngle(fo.yaw + dyaw - fo.yaw0), fo.yaw0 - 80 * DEG, fo.yaw0 + 80 * DEG);
    fo.pitch = clamp(fo.pitch + dpitch, 3 * DEG, 55 * DEG);
    fo.dist = clamp(fo.dist + ddist, Math.max(0.55, fo.dist0 * 0.6), fo.dist0 * 1.7);
    const p = focusPos(fo);
    if (!freeSpot(p, 0.12) || !fo.clear(p, fo.center)) { Object.assign(fo, prev); return false; }
    applyFocusCamera();
    return true;
  }

  // ---------------------------------------------------------------- input
  const pointers = new Map();
  let drag = null, pinchDist = 0, lastMoveTime = 0, moved = false, downAt = 0;
  let engaged = false;   // the user has interacted with the stage (wheel/keys allowed)
  const isFocused = () => document.activeElement === dom;
  const free = () => api.onFree?.(); // the user moved the camera off a preset

  function onPointerDown(e) {
    if (!state.enabled) return;
    engaged = true;
    if (!isFocused()) dom.focus?.({ preventScroll: true });
    dom.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button };
      moved = false; downAt = e.timeStamp || performance.now();
      state.yawVel = state.pitchVel = 0; state.orbit.thetaVel = state.orbit.phiVel = 0; state.look = null;
      if (state.focus) state.focus.yawVel = state.focus.pitchVel = 0;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      moved = true;
    }
    api.onInteract?.();
  }
  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const delta = d - pinchDist; pinchDist = d;
      if (state.mode === 'orbit') { state.orbit.radius = clamp(state.orbit.radius - delta * 0.03, 5, 22); orbitDirty = true; }
      else if (state.mode === 'walk') { state.dolly += delta * 0.006; free(); }
      else if (state.mode === 'focus') focusOrbit(0, 0, -delta * 0.004);
      api.onInteract?.();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) { moved = true; if (state.mode === 'walk') free(); }
    if (!moved) return;
    const now = performance.now();
    const dt = Math.max(1, now - lastMoveTime) / 1000; lastMoveTime = now;
    const k = LOOK_SPEED * (camera.fov / 50);
    if (state.mode === 'walk') {
      const dyaw = dx * k, dpitch = dy * k;
      state.yaw += dyaw; state.pitch = clamp(state.pitch + dpitch, -PITCH_LIMIT, PITCH_LIMIT);
      state.yawVel = dyaw / dt * 0.6 + state.yawVel * 0.4; state.pitchVel = dpitch / dt * 0.6 + state.pitchVel * 0.4;
      state.walkTarget = null;
      applyWalkCamera();
    } else if (state.mode === 'orbit') {
      const o = state.orbit;
      o.theta -= dx * 0.006; o.phi = clamp(o.phi + dy * 0.004, 20 * DEG, 88 * DEG);
      o.thetaVel = -dx * 0.006 / dt * 0.6 + o.thetaVel * 0.4; o.phiVel = dy * 0.004 / dt * 0.6 + o.phiVel * 0.4;
      applyOrbitCamera();
    } else if (state.mode === 'focus') {
      const fo = state.focus;
      const dyaw = -dx * 0.0055, dpitch = dy * 0.004;
      if (focusOrbit(dyaw, dpitch)) { fo.yawVel = dyaw / dt * 0.6 + fo.yawVel * 0.4; fo.pitchVel = dpitch / dt * 0.6 + fo.pitchVel * 0.4; }
      else fo.yawVel = fo.pitchVel = 0;
    }
    dom.style.cursor = 'grabbing';
    api.onInteract?.();
  }
  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    dom.releasePointerCapture?.(e.pointerId);
    if (pointers.size === 0 && drag) {
      // event timestamps, not handler time: a busy main thread must not turn taps into drags (QA-15)
      const isClick = !moved && (e.timeStamp || performance.now()) - downAt < 450 && drag.button === 0;
      if (performance.now() - lastMoveTime > 80 || reduced) {
        state.yawVel = state.pitchVel = 0; state.orbit.thetaVel = state.orbit.phiVel = 0;
        if (state.focus) state.focus.yawVel = state.focus.pitchVel = 0;
      }
      drag = null;
      dom.style.cursor = '';
      if (isClick) api.onClick?.(e);
    }
  }
  function onPointerLeave() { if (!isFocused()) engaged = false; }
  function onWheel(e) {
    if (!state.enabled) return;
    // never hijack page scroll: zoom only once the stage is engaged (clicked/focused) or with ⌃/⌘ (pinch)
    if (!(engaged || isFocused() || e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const d = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -120, 120);
    if (state.mode === 'orbit') { state.orbit.radius = clamp(state.orbit.radius * (1 + d * 0.0012), 5, 22); orbitDirty = true; }
    else if (state.mode === 'walk') { state.dolly += -d * 0.004; free(); }
    else if (state.mode === 'focus') focusOrbit(0, 0, d * 0.002);
    api.onInteract?.();
  }
  const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'fast', ShiftRight: 'fast' };
  function onKeyDown(e) {
    if (!state.enabled || !isFocused()) return;   // keys only when the stage canvas has focus
    if (e.code === 'Escape') { if (api.onEscape?.()) e.preventDefault(); return; }
    const k = KEYMAP[e.code];
    if (!k) return;
    if (state.mode !== 'walk') return;
    state.keys.add(k); state.walkTarget = null; state.look = null;
    if (k !== 'fast') { e.preventDefault(); free(); }
    api.onInteract?.();
  }
  function onKeyUp(e) { const k = KEYMAP[e.code]; if (k) state.keys.delete(k); }
  function onBlur() { state.keys.clear(); engaged = false; }

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('pointerleave', onPointerLeave);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('keydown', onKeyDown);
  dom.addEventListener('keyup', onKeyUp);
  dom.addEventListener('blur', onBlur);
  window.addEventListener('blur', onBlur);
  dom.style.touchAction = 'none';

  // ---------------------------------------------------------------- per-frame update
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), want = new THREE.Vector3(), tmpV = new THREE.Vector3();
  const _live = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  /** Returns true while the camera is moving (the engine keeps rendering). */
  function update(rawDt) {
    const dt = Math.min(rawDt, 0.05);
    let active = false;
    // smooth insets (sheet / panel open-close)
    if (Math.abs(state.insetTarget - state.inset) > 1e-4 || Math.abs(state.insetRTarget - state.insetR) > 1e-4) {
      const a = reduced ? 1 : 1 - Math.exp(-rawDt * 8);
      state.inset += (state.insetTarget - state.inset) * a;
      state.insetR += (state.insetRTarget - state.insetR) * a;
      if (Math.abs(state.insetTarget - state.inset) < 1e-3) state.inset = state.insetTarget;
      if (Math.abs(state.insetRTarget - state.insetR) < 1e-3) state.insetR = state.insetRTarget;
      applyCurrent();
      active = true;
    }
    if (state.transition) {
      const tr = state.transition;
      tr.t += Math.min(rawDt, 0.25) / tr.dur;
      const t = easeInOutCubic(clamp(tr.t, 0, 1));
      if (tr.kind === 'upright') {
        _live.pos.lerpVectors(tr.fromPos, tr.toPos, t);
        _live.pos.y += Math.sin(t * Math.PI) * tr.lift;
        _live.yaw = tr.fromYaw + tr.dYaw * t;
        _live.pitch = tr.fromPitch + (tr.toPitch - tr.fromPitch) * t;
        applyUpright(_live.pos, _live.yaw, _live.pitch);
        tr.liveUpright = { pos: _live.pos.clone(), yaw: _live.yaw, pitch: _live.pitch };
      } else {
        camera.position.lerpVectors(tr.fromPos, tr.toPos, t);
        camera.position.y += Math.sin(t * Math.PI) * tr.lift;
        camera.quaternion.slerpQuaternions(tr.fromQ, tr.toQ, t);
        applyProjection(tr.fromShift + (tr.toShift - tr.fromShift) * t);
        tr.liveUpright = null;
      }
      if (tr.t >= 1) { state.transition = null; commitPose(tr.pose); tr.onDone?.(); }
      return true;
    }
    if (state.mode === 'walk') {
      if (state.look) {
        const L = state.look;
        L.t += rawDt / L.dur;
        const t = easeInOutCubic(clamp(L.t, 0, 1));
        state.yaw = L.fromYaw + L.dYaw * t;
        state.pitch = L.fromPitch + (L.toPitch - L.fromPitch) * t;
        if (L.t >= 1) state.look = null;
        active = true;
      }
      // look inertia
      if (!drag && (Math.abs(state.yawVel) > 1e-3 || Math.abs(state.pitchVel) > 1e-3)) {
        state.yaw += state.yawVel * dt; state.pitch = clamp(state.pitch + state.pitchVel * dt, -PITCH_LIMIT, PITCH_LIMIT);
        const damp = Math.exp(-dt * 6.5);
        state.yawVel *= damp; state.pitchVel *= damp;
        active = true;
      } else if (!drag) { state.yawVel = state.pitchVel = 0; }
      fwd.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
      right.set(-fwd.z, 0, fwd.x);
      want.set(0, 0, 0);
      if (state.keys.has('f')) want.add(fwd);
      if (state.keys.has('b')) want.sub(fwd);
      if (state.keys.has('r')) want.add(right);
      if (state.keys.has('l')) want.sub(right);
      if (want.lengthSq() > 0) want.normalize().multiplyScalar(WALK_SPEED * (state.keys.has('fast') ? 1.8 : 1));
      if (state.walkTarget) {
        tmpV.copy(state.walkTarget).sub(state.pos); tmpV.y = 0;
        const dist = tmpV.length();
        // give up when blocked: < 1 cm of progress over 0.3 s
        const wp = state.walkProgress;
        wp.t += rawDt;
        if (wp.t > 0.3) { if (wp.d - dist < 0.01) { state.walkTarget = null; api.onArrive?.(false); } wp.d = dist; wp.t = 0; }
        if (state.walkTarget && dist < 0.02) { state.walkTarget = null; api.onArrive?.(true); }
        else if (state.walkTarget) want.copy(tmpV.normalize().multiplyScalar(Math.min(2.0, 0.5 + dist * 2.0)));
      }
      if (Math.abs(state.dolly) > 1e-3) {
        const step = state.dolly * Math.min(1, dt * 8);
        state.dolly -= step;
        tmpV.copy(state.pos);
        state.pos.addScaledVector(fwd, step);
        resolve(state.pos);
        if (tmpV.distanceToSquared(state.pos) < 1e-10) state.dolly = 0;
        active = true;
      } else state.dolly = 0;
      // acceleration curve: ~0.12 s to speed up, ~0.18 s to stop
      const a = 1 - Math.exp(-dt * (want.lengthSq() > state.move.lengthSq() ? 9 : 6));
      state.move.lerp(want, a);
      if (state.move.lengthSq() > 1e-5) {
        state.pos.addScaledVector(state.move, dt);
        resolve(state.pos);
        active = true;
      } else state.move.set(0, 0, 0);
      if (active) applyWalkCamera();
    } else if (state.mode === 'focus') {
      const fo = state.focus;
      if (!drag && (Math.abs(fo.yawVel) > 1e-3 || Math.abs(fo.pitchVel) > 1e-3)) {
        if (!focusOrbit(fo.yawVel * dt, fo.pitchVel * dt)) fo.yawVel = fo.pitchVel = 0;
        const damp = Math.exp(-dt * 5.5); fo.yawVel *= damp; fo.pitchVel *= damp;
        active = true;
      }
    } else if (state.mode === 'orbit') {
      const o = state.orbit;
      if (state.look) {
        const L = state.look;
        L.t += rawDt / L.dur;
        const t = easeInOutCubic(clamp(L.t, 0, 1));
        o.target.lerpVectors(L.fromTarget, L.toTarget, t);
        o.radius = L.fromR + (L.toR - L.fromR) * t;
        if (L.t >= 1) state.look = null;
        orbitDirty = true; active = true;
      }
      if (!drag && (Math.abs(o.thetaVel) > 1e-3 || Math.abs(o.phiVel) > 1e-3)) {
        o.theta += o.thetaVel * dt; o.phi = clamp(o.phi + o.phiVel * dt, 20 * DEG, 88 * DEG);
        const damp = Math.exp(-dt * 5.5); o.thetaVel *= damp; o.phiVel *= damp;
        orbitDirty = true; active = true;
      }
      if (orbitDirty) { applyOrbitCamera(); active = true; }
    }
    return active || state.keys.size > 0 || !!state.walkTarget;
  }

  /** Walk to a floor point (click-to-walk). Keeps the current orientation. */
  function walkTo(point) {
    if (state.mode !== 'walk') return;
    const t = new THREE.Vector3(point.x, state.pos.y, point.z);
    resolve(t);
    state.walkTarget = t;
    state.walkProgress.d = Infinity; state.walkProgress.t = 0;
    free();
    api.onInteract?.();
  }

  function resize(w, h) {
    viewW = w; viewH = h;
    camera.aspect = w / h;
    const hfov = camera.aspect >= 1 ? H_FOV : H_FOV_PORTRAIT_MIN;
    // the lens is defined horizontally; very wide stages (2.5:1 product strip) keep 74° h by going down to 28° v (R2-19)
    camera.fov = clamp(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) / DEG, 28, 82);
    applyCurrent();
  }

  Object.defineProperties(api, Object.getOwnPropertyDescriptors({
    state, update, setView, walkTo, focusOn, unfocus, resize, resolve, freeSpot,
    get mode() { return state.transition ? 'transition' : state.mode; },
    get targetMode() { return state.transition ? state.transition.pose.mode : state.mode; },
    get view() { return state.view; },
    get focused() { return !!state.focus || !!(state.transition && state.transition.pose.mode === 'focus'); },
    get moving() { return !!state.transition || !!state.walkTarget || state.keys.size > 0 || Math.abs(state.dolly) > 1e-3 || !!state.look; },
    get engaged() { return engaged || isFocused(); },
    setColliders(list) { dynamicColliders = list; },
    setEnabled(v) { state.enabled = v; if (!v) { state.keys.clear(); drag = null; } },
    /** Insets in CSS px: the part of the stage covered by HUD (right panel / bottom sheet). */
    setInsets({ bottom = 0, right: r = 0 } = {}) {
      state.insetTarget = clamp(bottom / Math.max(1, viewH), 0, 0.7);
      state.insetRTarget = clamp(r / Math.max(1, viewW), 0, 0.6);
    },
    isDragging: () => !!drag && moved,
    dispose() {
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('pointerleave', onPointerLeave);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('keydown', onKeyDown);
      dom.removeEventListener('keyup', onKeyUp);
      dom.removeEventListener('blur', onBlur);
      window.removeEventListener('blur', onBlur);
    },
  }));
  return api;
}
