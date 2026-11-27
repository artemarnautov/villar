// Motion + page chrome behaviours. Owner: interface.
import { $, $$, reducedMotion } from './dom.js';

/**
 * Fade/slide sections in as they enter the viewport. No inline <head> script is needed (CSP): the
 * `js` class that enables the hidden state is set here, after anything already on screen is marked.
 */
export function setupReveal(root = document) {
  const els = $$('.reveal', root).filter((el) => !el.classList.contains('is-in'));
  const vh = window.innerHeight;
  for (const el of els) { const r = el.getBoundingClientRect(); if (r.top < vh && r.bottom > 0) el.classList.add('is-in'); }
  document.documentElement.classList.add('js');
  if (!('IntersectionObserver' in window) || reducedMotion()) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
  els.filter((el) => !el.classList.contains('is-in')).forEach((el) => io.observe(el));
}

/** Hairline under the nav once scrolled; aria-current on the section in view. */
export function setupNav() {
  const nav = $('.nav');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const links = $$('.nav-links a[href^="#"]');
  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const a = map.get(e.target.id);
      if (!a) continue;
      if (e.isIntersecting) { links.forEach((l) => l.removeAttribute('aria-current')); a.setAttribute('aria-current', 'true'); }
      else if (a.getAttribute('aria-current')) a.removeAttribute('aria-current');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  map.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
}

/** Smoothly scroll so an element sits just under the sticky nav (or centred, if asked and it fits). */
export function scrollToEl(el, { center = false, pad = 12 } = {}) {
  if (!el) return;
  const navH = $('.nav')?.offsetHeight || 0;
  const r = el.getBoundingClientRect();
  const room = window.innerHeight - navH;
  const top = center && r.height < room ? Math.max(pad, (room - r.height) / 2) : pad;
  const y = window.scrollY + r.top - navH - top;
  window.scrollTo({ top: Math.max(0, y), behavior: reducedMotion() ? 'auto' : 'smooth' });
}

// ---------------------------------------------------------------- springs (docs/FOCUS.md §5)
// One spring family for everything that moves: camera (mirrored by the engine), card, sheet, dissolve, snap and
// numbers. A spring has no duration: every new target retargets from the current value AND velocity, so an
// interrupted motion never restarts or pops. ω (rad/s) sets the pace, ζ the damping (1 = critically damped, no
// overshoot). A critically damped spring is within 1 % of its target after ≈ 6.6 / ω s.
export const SPRING = {
  camera: { omega: 10.5, zeta: 1 },   // ≈ 630 ms: the engine's flight (550–700 ms, scaled by distance)
  card: { omega: 10.5, zeta: 1 },     // the card rides the camera's curve, 60 ms behind it
  sheet: { omega: 12.5, zeta: 1 },    // phone sheet detents; after a flick it starts from the finger's speed
  fade: { omega: 19, zeta: 1 },       // cross-fades (card content, the 350 ms swap dissolve)
  number: { omega: 13, zeta: 1 },     // the live total (≈ 0.5 s)
  snap: { omega: 16, zeta: 0.88 },    // rest-angle snap: a 45° step overshoots < 1° (limit 4°)
};
export const CARD_DELAY_MS = 60;      // the card starts this long after the camera (FOCUS §1)

const SUBSTEP = 1 / 240;
/**
 * createSpring({ from, preset: 'card' | {omega, zeta}, precision, onUpdate(x, v), onRest(x) })
 *   .set(target, { velocity }) — retarget (keeps the current velocity unless one is given)
 *   .jump(x) — place without motion · .stop() · .value · .velocity · .target · .moving
 * Reduced motion: every set() lands at once.
 */
export function createSpring({ from = 0, preset = 'card', omega, zeta, precision = 0.001, onUpdate = null, onRest = null } = {}) {
  const cfg = typeof preset === 'object' ? preset : (SPRING[preset] || SPRING.card);
  let w = omega ?? cfg.omega, z = zeta ?? cfg.zeta;
  let x = from, v = 0, target = from, raf = 0, last = 0;
  const tick = (now) => {
    let dt = Math.min(0.064, Math.max(0, (now - last) / 1000)); last = now;
    while (dt > 1e-6) {
      const h = Math.min(SUBSTEP, dt);
      v += (-w * w * (x - target) - 2 * z * w * v) * h;  // semi-implicit Euler: stable at 240 Hz for ω ≤ 60
      x += v * h;
      dt -= h;
    }
    if (Math.abs(x - target) < precision && Math.abs(v) < precision * w) {
      x = target; v = 0; raf = 0;
      onUpdate?.(x, 0); onRest?.(x);
      return;
    }
    onUpdate?.(x, v);
    raf = requestAnimationFrame(tick);
  };
  const api = {
    get value() { return x; }, get velocity() { return v; }, get target() { return target; }, get moving() { return !!raf; },
    set(to, { velocity } = {}) {
      target = to;
      if (velocity != null && Number.isFinite(velocity)) v = velocity;
      if (reducedMotion()) { api.jump(to); onRest?.(to); return api; }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
      return api;
    },
    jump(to = target) { if (raf) cancelAnimationFrame(raf); raf = 0; x = target = to; v = 0; onUpdate?.(x, 0); return api; },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; v = 0; return api; },
    tune({ omega: o, zeta: d, precision: e } = {}) { if (o) w = o; if (d) z = d; if (e) precision = e; return api; },
  };
  return api;
}

/** Animated count between numbers, on the number spring (pace from `duration`). Returns a cancel fn. */
export function animateNumber(from, to, onFrame, { duration = 700 } = {}) {
  if (reducedMotion() || from === to) { onFrame(to); return () => {}; }
  const s = createSpring({ from, preset: 'number', omega: 7.5 / Math.max(0.12, duration / 1000), precision: Math.max(0.5, Math.abs(to - from) * 0.002), onUpdate: (x) => onFrame(x) });
  s.set(to);
  return () => s.stop();
}
