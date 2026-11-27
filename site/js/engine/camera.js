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
const PORTRAIT = 0.8;           // stage aspect below which the portrait variants of presets apply
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
    // portrait stages (phones): Entry pulls back 0.4 m and turns toward the sofa, so sofa, bed and window are all
    // in the opening frame (D3-07: the sofa projected to x = −20 at 390×844)
    const v = (name === 'eye' && camera.aspect < PORTRAIT && views.eyePortrait) || views[name] || views.eye;
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
      // one critically damped spring per component (focus v2 §5): retargets keep the current velocity, so
      // a new tap mid-flight bends the path instead of restarting it; no fixed-duration tween
      const prev = state.transition && state.transition.kind === 'spring' ? state.transition : null;
      tr.kind = 'spring';
      tr.pos = (prev ? prev.pos : fromUp.pos).clone();
      tr.yaw = prev ? prev.yaw : fromUp.yaw;
      tr.pitch = prev ? prev.pitch : fromUp.pitch;
      tr.vPos = prev ? prev.vPos.clone() : new THREE.Vector3();
      tr.vYaw = prev ? prev.vYaw : 0;
      tr.vPitch = prev ? prev.vPitch : 0;
      tr.toPos = toUp.pos.clone();
      tr.toYaw = tr.yaw + wrapAngle(toUp.yaw - tr.yaw);
      tr.toPitch = toUp.pitch;
      // ~98 % settled after `dur` (ω·T ≈ 5.8)
      tr.w = 5.8 / dur;
      // lift over furniture when crossing the room at low height (walk ↔ focus only; item → item glides straight)
      const span = tr.pos.distanceTo(tr.toPos);
      tr.lift = prev || (state.mode === 'focus' && pose.mode === 'focus') ? 0 : Math.min(0.25, span * 0.04);
      tr.span = Math.max(1e-3, span);
    } else {
      tr.kind = 'free';
      tr.fromPos = camera.position.clone(); tr.fromQ = camera.quaternion.clone(); tr.fromShift = curShift;
      tr.toPos = to.pos; tr.toQ = to.quat; tr.toShift = to.shift;
      tr.lift = ((pose.mode === 'orbit') !== (state.mode === 'orbit')) ? 0.6 : 0;
    }
    state.transition = tr;
    state.mode = 'transition';
  }

  /**
   * Opening shot (ART §3): from `back` m behind the view's pose, a slow push-in to it on the house spring over
   * `seconds`. Any input stops it from its current velocity (a short coast, then the user's camera). Returns false
   * (and lands instantly) under prefers-reduced-motion.
   */
  function introFrom(to, back, rise) {
    const dir = dirFromYawPitch(to.yaw, 0, new THREE.Vector3());
    return { mode: 'walk', pos: resolve(to.pos.clone().addScaledVector(dir, -back).add(new THREE.Vector3(0, rise, 0))), yaw: to.yaw, pitch: to.pitch - 1.5 * DEG };
  }
  /** Put the camera on the opening shot's first frame (while loading), so the push-in starts without a jump. */
  function introPlace(name = 'eye', { back = 0.75, rise = -0.05 } = {}) {
    const to = poseForView(name);
    if (reduced || to.mode !== 'walk') return false;
    state.view = name; state.transition = null; commitPose(introFrom(to, back, rise));
    return true;
  }
  function intro(name = 'eye', { back = 0.75, rise = -0.05, seconds = 3.5, onDone = null } = {}) {
    const to = poseForView(name);
    state.view = name; state.returnPose = null;
    if (reduced || to.mode !== 'walk') { flyTo(to, { instant: true }); onDone?.(false); return false; }
    commitPose(introFrom(to, back, rise));
    flyTo(to, { duration: seconds, onDone: () => { onChange({ view: name, mode: 'walk' }); onDone?.(true); } });
    const tr = state.transition;
    if (tr) { tr.intro = true; tr.lift = 0; }
    return true;
  }
  /** Stop the opening shot where it is, easing out of its current velocity (≈ 0.45 s). */
  function cancelIntro() {
    const tr = state.transition;
    if (!tr || !tr.intro || tr.kind !== 'spring') return false;
    tr.intro = false;
    const w = 5.8 / 0.45;
    tr.w = w;
    tr.toPos.copy(tr.pos).addScaledVector(tr.vPos, 1 / w);
    tr.toYaw = tr.yaw + tr.vYaw / w; tr.toPitch = tr.pitch + tr.vPitch / w;
    tr.span = Math.max(1e-3, tr.pos.distanceTo(tr.toPos));
    tr.pose = { mode: 'walk', pos: resolve(tr.toPos.clone()), yaw: tr.toYaw, pitch: tr.toPitch };
    tr.toPos.copy(tr.pose.pos);
    api.onIntroCancel?.();
    return true;
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
   * Distance from the box centre at which all 8 corners of `box` fit within ±tw / ±tv (tangents of
   * the free rect's half-angles) when looking at `center` from direction (yaw, pitch).
   */
  const _bf = { f: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), o: new THREE.Vector3() };
  function boxFit(box, center, yaw, pitch, tw, tv) {
    const { f, r, u, o } = _bf;
    f.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    r.set(-f.z, 0, f.x).normalize();
    u.crossVectors(r, f);
    let d = 0;
    for (let i = 0; i < 8; i++) {
      o.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      const z = o.dot(f); // > 0: corner further from the camera than the centre
      d = Math.max(d, Math.abs(o.dot(r)) / tw - z, Math.abs(o.dot(u)) / tv - z, 0.35 - z);
    }
    return d;
  }
  /**
   * Fly to a pleasing 3/4 framing of an object: candidates around its front (±35° preferred), at a
   * distance from its size, camera a little above the object; each candidate must be a free spot
   * with a clear line of sight (`clear(from, to)`, supplied by the engine). Falls back to re-aiming
   * from where the camera is.
   */
  function focusOn({ center, size = 0.8, radius = null, box = null, front = null, clear = () => true, occlusion = null, preferYaw = null }) {
    if (!state.focus && !(state.transition && state.transition.pose.mode === 'focus')) state.returnPose = currentPose();
    const cam = camera.position;
    const base = front ? Math.atan2(front.x, front.z) : Math.atan2(cam.x - center.x, cam.z - center.z);
    // The object must fit the FREE part of the stage (HUD insets applied), with margin (D2-01).
    // With a box this is the exact fit of its 8 corners for each candidate direction; the bounding
    // sphere (fallback) is far too conservative for long low things on a wide stage — a sofa on a
    // 2.75:1 stage behind the HUD wanted 4.7 m and flew back to the entry.
    const r = Math.max(0.15, radius ?? size * 0.6);
    const tv = Math.tan((camera.fov * DEG) / 2), th = tv * camera.aspect;
    const fh = Math.max(0.25, 1 - state.insetTarget), fw = Math.max(0.25, 1 - state.insetRTarget);
    // focus v2 §1: the item fills ~55 % of the free height or 60 % of the free width, whichever binds first
    const FILL_H = 0.55, FILL_W = 0.6;
    const half = Math.min(Math.atan(tv * fh * FILL_H), Math.atan(th * fw * FILL_W));
    const dSphere = clamp(r / Math.sin(half), 0.9, 6);
    const tall = box ? box.max.y - box.min.y > 1.3 : false;
    const BEAUTY = 27.5 * DEG;
    const offs = [27.5, -27.5, 20, -20, 35, -35, 12, -12, 45, -45, 0, 60, -60, 80, -80, 100, -100].map((a) => a * DEG);
    let best = null;
    // every angle at its own fit distance, then closer steps; another angle is preferred to moving much
    // closer, the 17.5° elevation (eye level for tall items) to a higher / lower one, and views where
    // furniture, walls or the object's own parts hide it score worse (occlusion 0..1, PT3-03) — so a blocked
    // view falls back to another angle, a closer, a higher or a lower pose
    for (const [elev, hCost] of [[17.5, 0], [26, 0.35], [9, 0.45]]) {
      const pitchAt = (d) => {
        if (tall && hCost === 0) return Math.asin(clamp((1.5 - center.y) / Math.max(0.3, d), -0.5, 0.8));
        return clamp(elev * DEG, Math.asin(clamp((0.6 - center.y) / Math.max(0.3, d), -0.99, 0.99)), Math.asin(clamp((S.ceiling - 0.3 - center.y) / Math.max(0.3, d), -0.99, 0.99)));
      };
      const fitAt = (yaw) => {
        if (!box) return dSphere;
        let d = 2.2;
        for (let i = 0; i < 3; i++) d = boxFit(box, center, yaw, pitchAt(d), th * fw * FILL_W, tv * fh * FILL_H);
        return clamp(d, 0.9, 6);
      };
      for (const off of offs) {
        const yaw = base + off;
        const dFit = fitAt(yaw);
        for (const k of [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52]) {
          const dist = Math.max(0.7, dFit * k);
          const fo = { center: center.clone(), size, yaw, pitch: pitchAt(dist), dist };
          const p = focusPos(fo);
          let score = Math.abs(Math.abs(off) - BEAUTY) * 1.2 + (1 - k) * 4 + hCost + p.distanceTo(cam) * 0.02;
          if (preferYaw !== null) score += Math.abs(wrapAngle(yaw - preferYaw)) * 2.5;
          if (best && score >= best.score) continue;
          if (!freeSpot(p) || !clear(p, center)) continue;
          let occ = 0;
          if (occlusion) { occ = occlusion(p); score += occ * 4; if (best && score >= best.score) continue; }
          best = { fo, score, occ, hOff: elev - 17.5, k };
        }
      }
    }
    state.focusInfo = best ? { score: +best.score.toFixed(2), occluded: +best.occ.toFixed(2), raised: best.hOff, dist: +best.fo.dist.toFixed(2), fit: best.k, yawOff: +(wrapAngle(best.fo.yaw - base) / DEG).toFixed(1), elev: +(best.fo.pitch / DEG).toFixed(1) } : { fallback: true };
    let fo = best?.fo;
    if (!fo) {
      // nowhere better: stay, just turn toward the object
      const d = new THREE.Vector3().subVectors(cam, center);
      fo = { center: center.clone(), size, yaw: Math.atan2(d.x, d.z), pitch: Math.asin(clamp(d.y / Math.max(1e-6, d.length()), -0.99, 0.99)), dist: Math.max(0.6, d.length()) };
    }
    fo.yaw0 = fo.yaw; fo.dist0 = fo.dist; fo.pitch0 = fo.pitch; fo.yawVel = 0; fo.pitchVel = 0; fo.clear = clear;
    const span = camera.position.distanceTo(focusPos(fo));
    flyTo({ mode: 'focus', focus: fo }, { duration: preferYaw !== null ? 0.55 : clamp(0.55 + span * 0.035, 0.55, 0.7) });
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
  // focus v2 §2: tilt 5–45° and zoom 0.7–1.6× of the framing distance, rubber-banded (resistance 0.35) and
  // sprung back on release; a horizontal drag turns the ITEM (engine turntable), not the camera
  const TILT = [5 * DEG, 45 * DEG], ZOOM = [0.7, 1.6], RUBBER = 0.35;
  const band = (x, lo, hi) => (x < lo ? lo - (lo - x) * RUBBER : x > hi ? hi + (x - hi) * RUBBER : x);
  const tiltOf = (fo) => [Math.min(TILT[0], fo.pitch0 ?? TILT[0]), Math.max(TILT[1], fo.pitch0 ?? TILT[1])]; // ceiling items look up
  const unband = (x, lo, hi) => (x < lo ? lo - (lo - x) / RUBBER : x > hi ? hi + (x - hi) / RUBBER : x);
  /** Tilt / zoom step in focus mode (raw = pre-rubber values are tracked so the band feels continuous). */
  function focusTiltZoom(dpitch, dmul = 1) {
    const fo = state.focus;
    if (!fo) return false;
    const prev = { pitch: fo.pitch, dist: fo.dist };
    const [lo, hi] = tiltOf(fo);
    const rawP = unband(fo.pitch, lo, hi) + dpitch;
    fo.pitch = band(rawP, lo, hi);
    const z = fo.dist / fo.dist0;
    const rawZ = unband(z, ZOOM[0], ZOOM[1]) * dmul;
    fo.dist = fo.dist0 * band(rawZ, ZOOM[0], ZOOM[1]);
    const p = focusPos(fo);
    if (!freeSpot(p, 0.12) || !fo.clear(p, fo.center)) { Object.assign(fo, prev); return false; }
    fo.banded = true;
    applyFocusCamera();
    return true;
  }
  /** Orbit step in focus mode; rejected if the new viewpoint would be blocked. */
  function focusOrbit(dyaw, dpitch, ddist = 0) {
    const fo = state.focus;
    const prev = { yaw: fo.yaw, pitch: fo.pitch, dist: fo.dist };
    fo.yaw = clamp(fo.yaw0 + wrapAngle(fo.yaw + dyaw - fo.yaw0), fo.yaw0 - 80 * DEG, fo.yaw0 + 80 * DEG);
    fo.pitch = clamp(fo.pitch + dpitch, Math.min(3 * DEG, fo.pitch0 ?? 3 * DEG), 55 * DEG); // a lowered pose may look up
    fo.dist = clamp(fo.dist + ddist, Math.max(0.55, fo.dist0 * 0.6), fo.dist0 * 1.7);
    const p = focusPos(fo);
    if (!freeSpot(p, 0.12) || !fo.clear(p, fo.center)) { Object.assign(fo, prev); return false; }
    applyFocusCamera();
    return true;
  }

  // ---------------------------------------------------------------- input
  const pointers = new Map();
  let wheelAt = 0;
  let drag = null, pinchDist = 0, lastMoveTime = 0, moved = false, downAt = 0;
  let engaged = false;   // the user has interacted with the stage (wheel/keys allowed)
  const isFocused = () => document.activeElement === dom;
  const free = () => api.onFree?.(); // the user moved the camera off a preset

  function onPointerDown(e) {
    if (!state.enabled) return;
    cancelIntro();
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
      else if (state.mode === 'focus') focusTiltZoom(0, 1 - delta * 0.004);
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
      // mostly-horizontal motion turns the item (engine turntable); vertical tilts the camera
      const turned = api.onTurn ? api.onTurn(dx, e.pointerType || 'mouse', viewW) : false;
      if (!turned) {
        const dyaw = -dx * 0.0055;
        if (focusOrbit(dyaw, 0)) fo.yawVel = dyaw / dt * 0.6 + fo.yawVel * 0.4;
      }
      if (dy) focusTiltZoom(dy * 0.004);
      fo.pitchVel = 0;
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
      if (state.mode === 'focus' && moved) api.onTurnEnd?.();
      drag = null;
      dom.style.cursor = '';
      if (isClick) api.onClick?.(e);
    }
  }
  function onPointerLeave() { if (!isFocused()) engaged = false; }
  function onWheel(e) {
    if (!state.enabled) return;
    cancelIntro();
    // never hijack page scroll: zoom only once the stage is engaged (clicked/focused) or with ⌃/⌘ (pinch)
    if (!(engaged || isFocused() || e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const d = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -120, 120);
    if (state.mode === 'orbit') { state.orbit.radius = clamp(state.orbit.radius * (1 + d * 0.0012), 5, 22); orbitDirty = true; }
    else if (state.mode === 'walk') { state.dolly += -d * 0.004; free(); }
    else if (state.mode === 'focus') { focusTiltZoom(0, 1 + d * 0.0015); wheelAt = performance.now(); }
    api.onInteract?.();
  }
  const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'fast', ShiftRight: 'fast' };
  function onKeyDown(e) {
    if (!state.enabled || !isFocused()) return;   // keys only when the stage canvas has focus
    cancelIntro();
    if (e.code === 'Escape') { if (api.onEscape?.()) e.preventDefault(); return; }
    if (state.mode === 'focus' || (state.transition && state.transition.pose.mode === 'focus')) {
      // ←/→ rest angles, ↑/↓ tilt, +/− zoom, 0 reset, [ ] previous / next item (engine)
      if (api.onFocusKey?.(e.key, e.code)) { e.preventDefault(); api.onInteract?.(); }
      return;
    }
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
    if (state.transition && state.transition.kind === 'spring') {
      const tr = state.transition;
      // exact critically damped step (stable for any dt)
      const h = Math.min(rawDt, 0.12), w = tr.w, a = Math.exp(-w * h);
      const step = (x, v, g) => { const e = x - g, tmp = (v + w * e) * h; return [g + (e + tmp) * a, (v - w * tmp) * a]; };
      for (const c of ['x', 'y', 'z']) { const [x, v] = step(tr.pos[c], tr.vPos[c], tr.toPos[c]); tr.pos[c] = x; tr.vPos[c] = v; }
      [tr.yaw, tr.vYaw] = step(tr.yaw, tr.vYaw, tr.toYaw);
      [tr.pitch, tr.vPitch] = step(tr.pitch, tr.vPitch, tr.toPitch);
      const rem = tr.pos.distanceTo(tr.toPos), f = clamp(1 - rem / tr.span, 0, 1);
      _live.pos.copy(tr.pos); _live.pos.y += 4 * f * (1 - f) * tr.lift;
      _live.yaw = tr.yaw; _live.pitch = tr.pitch;
      applyUpright(_live.pos, _live.yaw, _live.pitch);
      tr.liveUpright = { pos: _live.pos.clone(), yaw: _live.yaw, pitch: _live.pitch };
      const done = rem < 0.002 && tr.vPos.length() < 0.01 && Math.abs(tr.toYaw - tr.yaw) < 0.001 && Math.abs(tr.toPitch - tr.pitch) < 0.001 && Math.abs(tr.vYaw) + Math.abs(tr.vPitch) < 0.01;
      if (done) { state.transition = null; commitPose(tr.pose); tr.onDone?.(); }
      return true;
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
      // rubber band: back inside the limits (critically damped, ~250 ms) once the finger / wheel lets go
      if (fo.banded && !drag && pointers.size === 0 && performance.now() - wheelAt > 120) {
        const [lo, hi] = tiltOf(fo);
        const pT = clamp(fo.pitch, lo, hi), zT = fo.dist0 * clamp(fo.dist / fo.dist0, ZOOM[0], ZOOM[1]);
        if (Math.abs(pT - fo.pitch) < 1e-4 && Math.abs(zT - fo.dist) < 1e-4) fo.banded = false;
        else {
          const k = 1 - Math.exp(-dt * 16);
          fo.pitch += (pT - fo.pitch) * k; fo.dist += (zT - fo.dist) * k;
          if (Math.abs(pT - fo.pitch) < 2e-4) fo.pitch = pT;
          if (Math.abs(zT - fo.dist) < 1e-3) fo.dist = zT;
          applyFocusCamera(); active = true;
        }
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

  let wasPortrait = null;
  function resize(w, h) {
    viewW = w; viewH = h;
    camera.aspect = w / h;
    const portrait = camera.aspect < PORTRAIT;
    const flip = wasPortrait !== null && portrait !== wasPortrait && state.view === 'eye' && state.mode === 'walk' && !state.transition;
    wasPortrait = portrait;
    const hfov = camera.aspect >= 1 ? H_FOV : H_FOV_PORTRAIT_MIN;
    // the lens is defined horizontally; very wide stages (2.5:1 product strip) keep 74° h by going down to 28° v (R2-19)
    camera.fov = clamp(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) / DEG, 28, 82);
    // rotating a phone while still on Entry: take the variant for the new orientation
    if (flip && views.eyePortrait) { const pose = poseForView('eye'); state.pos.copy(pose.pos); state.yaw = pose.yaw; state.pitch = pose.pitch; }
    applyCurrent();
  }

  Object.defineProperties(api, Object.getOwnPropertyDescriptors({
    state, update, setView, intro, introPlace, cancelIntro, get introActive() { return !!state.transition?.intro; }, walkTo, focusOn, unfocus, resize, resolve, freeSpot, focusTiltZoom,
    /** Back to the framing pose's tilt / zoom (inspect reset). */
    resetFocusView() { const fo = state.focus; if (!fo) return; fo.pitch = fo.pitch0 ?? fo.pitch; fo.dist = fo.dist0; fo.banded = false; applyFocusCamera(); },
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
