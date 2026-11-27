// Villar engine — seamless swaps: dissolve furniture in / out. Owner: engine.
//
// A fading group temporarily wears alpha-hashed clones of its (shared) materials — opaque,
// depth-writing, sorted like the original, dithered by `opacity` and resolved by MSAA — plus a
// subtle scale settle. Clones come from a per-material pool so a second fade reuses the already
// compiled alpha-hash program; the first use of a variant is compiled asynchronously when the
// driver supports KHR_parallel_shader_compile. Shadows can't be dithered, so casting switches over
// at mid-fade (old off, new on) with one shadow-map update — hidden by the dissolve.
import * as THREE from 'three';
import { clamp } from './util.js';

const smooth = (t) => t * t * (3 - 2 * t);

export function createFader({ renderer, scene, camera, target = () => null, onShadow = () => {}, decorate = () => {} }) {
  const pool = new Map();       // source material → [clone]
  const runs = new Set();
  const parallel = renderer.extensions.has('KHR_parallel_shader_compile');

  function cloneFor(m) {
    let list = pool.get(m);
    if (!list) { list = []; pool.set(m, list); }
    let c = list.pop();
    if (c) c.copy(m);                     // re-sync: colour fixes, lamp glow, visibility may have changed (T6)
    else c = m.clone();
    c.alphaHash = true; c.transparent = false; c.depthWrite = true;
    c.userData = { ...m.userData, fadeOf: m, villarSSAO: false };
    decorate(c);
    c.opacity = 0;
    return c;
  }
  function release(c) { const src = c.userData.fadeOf; if (src) { c.opacity = 1; pool.get(src)?.push(c); } }

  function dress(group) {
    const meshes = [];
    group.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      const m = o.material;
      if (m.transparent || m.userData?.fadeOf) return; // glass etc: left as is
      meshes.push([o, m, o.castShadow]);
      o.material = cloneFor(m);
    });
    return meshes;
  }
  function undress(meshes) {
    for (const [o, m, cast] of meshes) { const c = o.material; o.material = m; o.castShadow = cast; release(c); }
  }

  /**
   * Fade groups: `inn` appear, `out` disappear, over `ms` after `delay`. Resolves when done.
   * Light intensities of `inLights` ramp 0 → base with the fade.
   */
  const flushedTags = new WeakSet(); // tags finished early (the run may still be compiling)
  async function swap({ inn = [], out = [], inLights = [], ms = 280, delay = 0, settle = true, tag = null }) {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) ms = 1;
    const dressedIn = inn.map((g) => ({ g, meshes: dress(g), base: g.scale.clone() }));
    const dressedOut = out.map((g) => ({ g, meshes: dress(g), base: g.scale.clone() }));
    for (const d of dressedIn) for (const [o] of d.meshes) o.castShadow = false;
    // compile the alpha-hash variants without blocking (first use only); the incoming groups stay
    // hidden until their programs are ready, the outgoing ones keep showing
    if (dressedIn.length || dressedOut.length) {
      for (const d of dressedIn) d.g.visible = false;
      await compile([...inn, ...out]);
      for (const d of dressedIn) d.g.visible = true;
    }
    const lights = inLights.map((l) => [l, l.intensity]);
    for (const [l] of lights) l.intensity = 0;
    return new Promise((resolve) => {
      const run = { t0: performance.now() + delay, ms, dressedIn, dressedOut, lights, resolve, swapped: false, settle, tag };
      if (tag && flushedTags.has(tag)) run.t0 = -Infinity;
      runs.add(run);
      step(performance.now());
    });
  }

  async function compile(objs) {
    try {
      // compile against the beauty pass's render target (tone mapping / colour space are in the key)
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target());
      let ps;
      try { ps = parallel ? objs.map((o) => renderer.compileAsync(o, camera, scene)) : (objs.forEach((o) => renderer.compile(o, camera, scene)), null); }
      finally { renderer.setRenderTarget(prev); }
      if (ps) await Promise.race([Promise.all(ps), new Promise((r) => setTimeout(r, 2000))]);
    } catch { /* compiles on first draw */ }
  }
  /** Idle-time warm-up: compile a (detached) group's normal and fade variants. */
  async function warm(group) {
    const meshes = dress(group);
    try { await compile([group]); } finally { undress(meshes); }
    await compile([group]);
  }

  function finish(run) {
    runs.delete(run);
    for (const d of run.dressedIn) { undress(d.meshes); d.g.scale.copy(d.base); }
    for (const d of run.dressedOut) { undress(d.meshes); d.g.scale.copy(d.base); d.g.visible = false; }
    for (const [l, I] of run.lights) l.intensity = I;
    onShadow();
    run.resolve();
  }

  /** Per frame. Returns true while anything is fading. */
  function step(now = performance.now()) {
    if (!runs.size) return false;
    for (const run of [...runs]) {
      const t = clamp((now - run.t0) / run.ms, 0, 1);
      const e = smooth(t);
      for (const d of run.dressedIn) {
        for (const [o] of d.meshes) o.material.opacity = e;
        if (run.settle) {
          const s = 0.965 + 0.035 * (1 - Math.pow(1 - t, 3)); // gentle settle
          d.g.scale.set(d.base.x * s, d.base.y * s, d.base.z * s);
        }
      }
      for (const d of run.dressedOut) for (const [o] of d.meshes) o.material.opacity = 1 - e;
      for (const [l, I] of run.lights) l.intensity = I * e;
      if (!run.swapped && t >= 0.5) {
        run.swapped = true;
        for (const d of run.dressedIn) for (const [o, , cast] of d.meshes) o.castShadow = cast;
        for (const d of run.dressedOut) for (const [o] of d.meshes) o.castShadow = false;
        onShadow();
      }
      if (t >= 1) finish(run);
    }
    return true;
  }

  return {
    swap, step, warm,
    /** Warm-up helpers: wear the fade clones (for a compile), then take them off again. */
    dressForWarm: (group) => dress(group),
    undress: (meshes) => undress(meshes),
    get active() { return runs.size > 0; },
    /** Finish only the run(s) started with this `tag` (door / wall serialisation, R3-05). */
    finishTag(tag) {
      if (!tag) return;
      flushedTags.add(tag);
      let hit = false;
      for (const run of runs) if (run.tag === tag) { run.t0 = -Infinity; hit = true; }
      if (hit) step(performance.now());
    },
    /** Finish everything at once (photo mode, dispose). */
    flush() { for (const run of [...runs]) { run.t0 = -Infinity; } step(performance.now()); },
    dispose() {
      this.flush();
      for (const list of pool.values()) for (const c of list) c.dispose();
      pool.clear();
    },
  };
}
