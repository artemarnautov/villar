// Derives the single UI accent from the style pack palette. Owner: interface.
import { safeHex, hexToRgb, contrast } from './dom.js';

const BG = '#fbfbfd';

const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
const saturation = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

/** Pick the pack's signature dark tone (wood first), keep it AA-safe for white text and as text on the page. */
export function applyAccent(palette) {
  const sw = Array.isArray(palette?.swatches) ? palette.swatches : [];
  const pick =
    sw.find((s) => /wood|walnut|орех/i.test(`${s.role} ${s.name}`)) ||
    [...sw].sort((a, b) => contrast(safeHex(b.hex), BG) - contrast(safeHex(a.hex), BG))[0];
  let accent = safeHex(pick?.hex, '#4a3426');

  // Button fill: white text needs ≥ 4.5:1 — darken toward near-black until it passes.
  for (let i = 0; i < 12 && contrast(accent, '#ffffff') < 4.6; i++) accent = mix(accent, '#1d1d1f', 0.15);

  // Text accent: warm the accent toward the pack's most saturated accent swatch (e.g. terracotta),
  // as far as it still reads at ≥ 5:1 on the page.
  const warm = sw
    .filter((s) => /accent|акцент/i.test(String(s.role)))
    .map((s) => safeHex(s.hex))
    .sort((a, b) => saturation(b) - saturation(a))[0] || '#ffffff';
  let text = accent;
  for (let t = 0.05; t <= 0.9; t += 0.05) {
    const c = mix(accent, warm, t);
    if (contrast(c, BG) >= 5.2) text = c; else break;
  }

  const [r, g, b] = hexToRgb(accent);
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-hover', mix(accent, '#ffffff', 0.12));
  root.setProperty('--accent-text', text);
  root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.08)`);
  root.setProperty('--accent-ring', `rgba(${r}, ${g}, ${b}, 0.32)`);
  return accent;
}
