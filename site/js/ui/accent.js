// Derives the single UI accent from the style pack palette. Owner: interface.
import { safeHex, hexToRgb, contrast } from './dom.js';

const BG = '#fbfbfd';
// Until the palettes carry `uiAccent` (catalog), the reviewed picks for packs whose derived accent reads muddy (D2-20).
const PACK_ACCENT = { 'light-oak': '#4f5a46', mediterranean: '#9a4a2c' };

const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
function toHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hue = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue / 6, s, l];
}
function fromHsl([hh, ss, ll]) {
  if (ss === 0) return toHex([ll, ll, ll].map((v) => v * 255));
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss, p = 2 * ll - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return toHex([f(hh + 1 / 3), f(hh), f(hh - 1 / 3)].map((v) => v * 255));
}
const darken = (hex, by) => { const [hh, ss, ll] = toHsl(hex); return fromHsl([hh, Math.min(1, ss * 1.02), Math.max(0, ll - by)]); };
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
  // D2-20: a pack may name its own UI accent (e.g. Mediterranean terracotta) — used when it reads on white.
  const ui = safeHex(palette?.uiAccent || PACK_ACCENT[palette?.id] || '', '');
  if (ui && contrast(ui, '#ffffff') >= 4.5) accent = ui;

  // Button fill: white text needs ≥ 4.5:1. Darken by lowering lightness only (hue and saturation kept), so a light
  // wood stays a wood colour instead of draining to grey-charcoal (D2-20).
  for (let i = 0; i < 40 && contrast(accent, '#ffffff') < 4.6; i++) accent = darken(accent, 0.025);

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
