// Villar engine — camera: "standing in the apartment" controller + dollhouse orbit. Owner: engine.
//
// Walk mode: eye height from the view (1.5–1.6 m), drag to look (grab-style, with inertia),
// WASD/arrows to walk, click floor to walk there, wheel/pinch to dolly, collision with walls,
// built-ins and furniture footprints. Orbit mode ('top'): dollhouse orbit around the plan.
// View changes are eased (~1 s); prefers-reduced-motion → short cross-cut.
import * as THREE from 'three';
import { clamp, easeInOutCubic, prefersReducedMotion, DEG } from './util.js';

const RADIUS = 0.24;        // body radius for collisions
const WALK_SPEED = 1.5;     // m/s
const LOOK_SPEED = 0.0042;  // rad per px at 58° vFOV
const PITCH_LIMIT = 80 * DEG;

export function createCameraController({ camera, dom, layout, colliders = [], onChange = () => {}, fov = 58 }) {
  const S = layout.size;
  const views = layout.views || {};
  const baseFov = fov;
  const reduced = prefersReducedMotion();

  const state = {
    mode: 'walk',
    pos: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    yawVel: 0, pitchVel: 0,
    move: new THREE.Vector3(),       // smoothed velocity
    keys: new Set(),
    dolly: 0,                        // pending dolly distance (m)
    walkTarget: null,                // Vector3 (click-to-walk)
    orbit: { target: new THREE.Vector3(S.x / 2, 0.4, S.z / 2), radius: 12.5, theta: 0.0, phi: 38 * DEG, thetaVel: 0, phiVel: 0 },
    transition: null,
    view: 'eye',
    enabled: true,
  };
  let dynamicColliders = [];

  // ---------------------------------------------------------------- helpers
  const dirFromYawPitch = (yaw, pitch, out = new THREE.Vector3()) =>
    out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  function yawPitchFromDir(d) {
    const n = d.clone().normalize();
    return { yaw: Math.atan2(n.x, n.z), pitch: Math.asin(clamp(n.y, -1, 1)) };
  }

  function applyWalkCamera() {
    camera.position.copy(state.pos);
    const d = dirFromYawPitch(state.yaw, state.pitch);
    camera.up.set(0, 1, 0);
    camera.lookAt(state.pos.x + d.x, state.pos.y + d.y, state.pos.z + d.z);
  }
  function orbitPose(o = state.orbit) {
    const p = new THREE.Vector3(
      o.target.x + o.radius * Math.cos(o.phi) * Math.sin(o.theta),
      o.target.y + o.radius * Math.sin(o.phi),
      o.target.z + o.radius * Math.cos(o.phi) * Math.cos(o.theta) * -1,
    );
    return p;
  }
  function applyOrbitCamera() {
    camera.position.copy(orbitPose());
    camera.up.set(0, 1, 0);
    camera.lookAt(state.orbit.target);
  }

  // ---------------------------------------------------------------- collision (2D, x/z)
  function resolve(p) {
    const r = RADIUS;
    p.x = clamp(p.x, r, S.x - r);
    p.z = clamp(p.z, r, S.z - r);
    const all = colliders.concat(dynamicColliders);
    for (let it = 0; it < 3; it++) {
      for (const c of all) {
        if (c.rot !== undefined) {
          // oriented rectangle: transform into local frame
          const dx = p.x - c.cx, dz = p.z - c.cz;
          const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
          const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
          const qx = clamp(lx, -c.hw, c.hw), qz = clamp(lz, -c.hd, c.hd);
          let ex = lx - qx, ez = lz - qz;
          let dist = Math.hypot(ex, ez);
          if (dist >= r) continue;
          if (dist < 1e-6) {
            // inside: push out along the shallowest axis
            const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
            if (px < pz) { ex = Math.sign(lx) || 1; ez = 0; dist = 0; }
            else { ez = Math.sign(lz) || 1; ex = 0; dist = 0; }
            const push = (px < pz ? px : pz) + r;
            const wx = ex * push, wz = ez * push;
            p.x += wx * Math.cos(c.rot) + wz * Math.sin(c.rot);
            p.z += -wx * Math.sin(c.rot) + wz * Math.cos(c.rot);
            continue;
          }
          const k = (r - dist) / dist;
          const wx = ex * k, wz = ez * k;
          p.x += wx * Math.cos(c.rot) + wz * Math.sin(c.rot);
          p.z += -wx * Math.sin(c.rot) + wz * Math.cos(c.rot);
        } else {
          const qx = clamp(p.x, c.x0, c.x1), qz = clamp(p.z, c.z0, c.z1);
          let ex = p.x - qx, ez = p.z - qz;
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

  // ---------------------------------------------------------------- views
  function poseForView(name) {
    if (name === 'top') {
      const o = { ...state.orbit, target: state.orbit.target.clone(), radius: 12.5, theta: 0.0, phi: 62 * DEG };
      return { mode: 'orbit', orbit: o, pos: orbitPose(o), target: o.target.clone() };
    }
    const v = views[name] || views.eye;
    const pos = new THREE.Vector3(...v.pos);
    const target = new THREE.Vector3(...v.target);
    const { yaw, pitch } = yawPitchFromDir(target.clone().sub(pos));
    return { mode: 'walk', pos, yaw, pitch, target };
  }

  function setView(name, { instant = false } = {}) {
    const pose = poseForView(name);
    state.view = name;
    state.walkTarget = null;
    state.yawVel = state.pitchVel = 0;
    state.orbit.thetaVel = state.orbit.phiVel = 0;
    const fromPos = camera.position.clone();
    const fromQ = camera.quaternion.clone();
    // target quaternion
    const tmp = new THREE.PerspectiveCamera();
    tmp.position.copy(pose.pos); tmp.lookAt(pose.target);
    const toQ = tmp.quaternion.clone();
    const commit = () => {
      state.mode = pose.mode;
      if (pose.mode === 'orbit') { state.orbit = pose.orbit; applyOrbitCamera(); }
      else { state.pos.copy(pose.pos); state.yaw = pose.yaw; state.pitch = pose.pitch; resolve(state.pos); applyWalkCamera(); }
    };
    if (instant) { commit(); state.transition = null; onChange({ view: name, mode: state.mode }); return; }
    const dist = fromPos.distanceTo(pose.pos);
    const dur = reduced ? 0.0001 : clamp(0.75 + dist * 0.05, 0.8, 1.4);
    // arc via a lifted midpoint when going to/from the dollhouse
    const lift = (pose.mode === 'orbit') !== (state.mode === 'orbit');
    state.transition = { t: 0, dur, fromPos, fromQ, toPos: pose.pos.clone(), toQ, commit, lift };
    state.mode = 'transition';
    onChange({ view: name, mode: pose.mode, transitioning: true });
  }

  // ---------------------------------------------------------------- input
  const pointers = new Map();
  let drag = null;
  let pinchDist = 0;
  let lastMoveTime = 0;
  let moved = false;
  let downAt = 0;
  const api = {};

  function onPointerDown(e) {
    if (!state.enabled) return;
    dom.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button };
      moved = false; downAt = performance.now();
      state.yawVel = state.pitchVel = 0; state.orbit.thetaVel = state.orbit.phiVel = 0;
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
      if (state.mode === 'orbit') state.orbit.radius = clamp(state.orbit.radius - delta * 0.03, 5, 22);
      else if (state.mode === 'walk') state.dolly += delta * 0.006;
      api.onInteract?.();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) moved = true;
    if (!moved) return;
    const now = performance.now();
    const dt = Math.max(1, now - lastMoveTime) / 1000; lastMoveTime = now;
    const k = LOOK_SPEED * (camera.fov / 58);
    if (state.mode === 'walk') {
      // grab-style: content follows the pointer
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
    }
    dom.style.cursor = 'grabbing';
    api.onInteract?.();
  }
  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    dom.releasePointerCapture?.(e.pointerId);
    if (pointers.size === 0 && drag) {
      const isClick = !moved && performance.now() - downAt < 450 && drag.button === 0;
      // inertia only if the pointer was still moving at release
      if (performance.now() - lastMoveTime > 80) { state.yawVel = state.pitchVel = 0; state.orbit.thetaVel = state.orbit.phiVel = 0; }
      if (reduced) { state.yawVel = state.pitchVel = 0; state.orbit.thetaVel = state.orbit.phiVel = 0; }
      drag = null;
      dom.style.cursor = '';
      if (isClick) api.onClick?.(e);
    }
  }
  function onWheel(e) {
    if (!state.enabled) return;
    e.preventDefault();
    const d = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -120, 120);
    if (state.mode === 'orbit') state.orbit.radius = clamp(state.orbit.radius * (1 + d * 0.0012), 5, 22);
    else if (state.mode === 'walk') state.dolly += -d * 0.004;
    api.onInteract?.();
  }
  const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'fast', ShiftRight: 'fast' };
  function onKeyDown(e) {
    if (!state.enabled) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const k = KEYMAP[e.code];
    if (!k) return;
    if (state.mode !== 'walk' && k !== 'fast') return;
    state.keys.add(k); state.walkTarget = null;
    if (k !== 'fast') e.preventDefault();
    api.onInteract?.();
  }
  function onKeyUp(e) { const k = KEYMAP[e.code]; if (k) state.keys.delete(k); }
  function onBlur() { state.keys.clear(); }

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  dom.style.touchAction = 'none';

  // ---------------------------------------------------------------- per-frame update
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), want = new THREE.Vector3();
  /** Returns true while the camera is moving (so the engine keeps rendering). */
  function update(rawDt) {
    const dt = Math.min(rawDt, 0.05);
    let active = false;
    if (state.mode === 'transition' && state.transition) {
      const tr = state.transition;
      tr.t += Math.min(rawDt, 0.5) / tr.dur;
      const t = easeInOutCubic(clamp(tr.t, 0, 1));
      camera.position.lerpVectors(tr.fromPos, tr.toPos, t);
      if (tr.lift) camera.position.y += Math.sin(t * Math.PI) * 0.6;
      camera.quaternion.slerpQuaternions(tr.fromQ, tr.toQ, t);
      if (tr.t >= 1) { state.transition = null; tr.commit(); onChange({ view: state.view, mode: state.mode }); }
      return true;
    }
    if (state.mode === 'walk') {
      // look inertia
      if (!drag && (Math.abs(state.yawVel) > 1e-3 || Math.abs(state.pitchVel) > 1e-3)) {
        state.yaw += state.yawVel * dt; state.pitch = clamp(state.pitch + state.pitchVel * dt, -PITCH_LIMIT, PITCH_LIMIT);
        const damp = Math.exp(-dt * 6.5);
        state.yawVel *= damp; state.pitchVel *= damp;
        active = true;
      } else if (!drag) { state.yawVel = state.pitchVel = 0; }
      // keyboard / dolly / click-to-walk
      fwd.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
      right.set(-fwd.z, 0, fwd.x);
      want.set(0, 0, 0);
      if (state.keys.has('f')) want.add(fwd);
      if (state.keys.has('b')) want.sub(fwd);
      if (state.keys.has('r')) want.add(right);
      if (state.keys.has('l')) want.sub(right);
      if (want.lengthSq() > 0) want.normalize().multiplyScalar(WALK_SPEED * (state.keys.has('fast') ? 1.8 : 1));
      if (state.walkTarget) {
        const to = state.walkTarget.clone().sub(state.pos); to.y = 0;
        const dist = to.length();
        if (dist < 0.02) { state.walkTarget = null; api.onArrive?.(); }
        else want.copy(to.normalize().multiplyScalar(Math.min(2.2, 0.6 + dist * 2.2)));
      }
      if (Math.abs(state.dolly) > 1e-3) {
        const step = state.dolly * Math.min(1, dt * 8);
        state.dolly -= step;
        const p0 = state.pos.clone();
        state.pos.addScaledVector(fwd, step);
        resolve(state.pos);
        if (p0.distanceToSquared(state.pos) < 1e-10) state.dolly = 0;
        active = true;
      }
      const a = 1 - Math.exp(-dt * 10);
      state.move.lerp(want, a);
      if (state.move.lengthSq() > 1e-5) {
        state.pos.addScaledVector(state.move, dt);
        resolve(state.pos);
        active = true;
      } else state.move.set(0, 0, 0);
      if (active) applyWalkCamera();
    } else if (state.mode === 'orbit') {
      const o = state.orbit;
      if (!drag && (Math.abs(o.thetaVel) > 1e-3 || Math.abs(o.phiVel) > 1e-3)) {
        o.theta += o.thetaVel * dt; o.phi = clamp(o.phi + o.phiVel * dt, 20 * DEG, 88 * DEG);
        const damp = Math.exp(-dt * 5.5); o.thetaVel *= damp; o.phiVel *= damp;
        active = true;
      }
      // smooth radius already applied directly; keep camera in sync
      applyOrbitCamera();
    }
    return active || state.keys.size > 0;
  }

  /** Walk to a floor point (click-to-walk). Keeps the current orientation. */
  function walkTo(point) {
    if (state.mode !== 'walk') return;
    const t = new THREE.Vector3(point.x, state.pos.y, point.z);
    resolve(t);
    state.walkTarget = t;
    api.onInteract?.();
  }

  function resize(w, h) {
    camera.aspect = w / h;
    // keep at least ~66° horizontal FOV on narrow (portrait) screens
    const hMin = 66 * DEG;
    const vFromH = 2 * Math.atan(Math.tan(hMin / 2) / camera.aspect) / DEG;
    camera.fov = clamp(Math.max(baseFov, vFromH), baseFov, 82);
    camera.updateProjectionMatrix();
  }

  Object.assign(api, {
    state, update, setView, walkTo, resize, resolve,
    get mode() { return state.mode; },
    get view() { return state.view; },
    get moving() { return !!state.transition || !!state.walkTarget || state.keys.size > 0 || Math.abs(state.dolly) > 1e-3; },
    setColliders(list) { dynamicColliders = list; },
    setEnabled(v) { state.enabled = v; if (!v) { state.keys.clear(); drag = null; } },
    isDragging: () => !!drag && moved,
    dispose() {
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  });
  return api;
}
