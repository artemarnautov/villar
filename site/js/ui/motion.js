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

/** Animated count between numbers. Returns a cancel fn. */
export function animateNumber(from, to, onFrame, { duration = 700 } = {}) {
  if (reducedMotion() || from === to) { onFrame(to); return () => {}; }
  let raf = 0;
  const t0 = performance.now();
  const ease = (t) => 1 - (1 - t) ** 4;
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    onFrame(from + (to - from) * ease(t));
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
