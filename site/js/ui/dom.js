// Tiny DOM helpers. Owner: interface. All data goes in as text nodes (never innerHTML).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div', { class: 'x', onclick: fn, style: '--c:#fff' }, child, 'text') */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v; // trusted, static markup only (icons)
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

/** Static SVG markup → element. */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const safeHex = (hex, fallback = '#d9d2c7') => (typeof hex === 'string' && HEX.test(hex.trim()) ? hex.trim() : fallback);

/** Russian plural: plural(5, ['предмет', 'предмета', 'предметов']) */
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

import { locale, isEn } from './i18n.js';

const nfs = {};
const nf = () => (nfs[locale()] ||= new Intl.NumberFormat(locale()));
export const NBSP = '\u00A0';
export const fmtNum = (n) => nf().format(Math.round(n));
/** "32 741 AED" — the unit never wraps away from the number. */
export const aed = (n) => `${nf().format(Math.round(n))}${NBSP}AED`;
/** Signed AED delta with a real minus sign: "+350 AED", "−350 AED". */
export const fmtDelta = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf().format(Math.abs(Math.round(n)))}${NBSP}AED`;
/** Russian typography: a dash never starts a line. */
export const typo = (s) => String(s ?? '').replace(/ —/g, '\u00A0—');
/** «Тёмный орех» with non-breaking spaces inside the quotes. */
export const quoted = (s) => {
  const v = String(s || '').trim().replace(/\s+/g, NBSP);
  return isEn() ? `“${v}”` : `«${v}»`;
};

export const mq = (q) => window.matchMedia(q);
export const reducedMotion = () => mq('(prefers-reduced-motion: reduce)').matches;
export const isTouch = () => mq('(hover: none)').matches;
export const isCompact = () => mq('(max-width: 734px)').matches;

/** Relative luminance of a hex color (WCAG). */
export function luminance(hex) {
  const c = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function hexToRgb(hex) {
  let x = safeHex(hex).slice(1);
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
}
export const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
/** Ink (text) color that reads best on a given background (higher WCAG contrast wins). */
export const inkFor = (bg) => (contrast('#1d1d1f', bg) >= contrast('#ffffff', bg) ? '#1d1d1f' : '#ffffff');
