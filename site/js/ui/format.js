// Item presentation helpers shared by hover card, sheet, budget and modal. Owner: interface.
// Never surfaces ids, SKUs, links or supplier data — only display fields.
import { h, safeHex, fmtNum, aed, NBSP } from './dom.js';
import { L, t, isEn } from './i18n.js';
import { displayName, displayShortName } from './labels.js';

const X = `${NBSP}×${NBSP}`;

/** Typographic clean-up of catalog names: "160×200" → "160 × 200", "Ø90" → "Ø 90" (non-breaking). */
export const pretty = (s) => String(s || '').trim()
  .replace(/ —/g, `${NBSP}—`)
  .replace(/(\d)\s*[×x]\s*(\d)/g, `$1${X}$2`)
  .replace(/Ø\s*(\d)/g, `Ø${NBSP}$1`);

/** Full display name (budget, order summary), in the interface language. */
export const nameOf = (item) => pretty(displayName(item)) || t('item');

/** Short name under a category eyebrow (labels.js decides what the eyebrow already says). */
export const shortNameOf = (item) => pretty(displayShortName(item)) || nameOf(item);
const cap = (s) => s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());

const priceOk = (item) => item && item.price !== '' && Number.isFinite(Number(item.price));
/** Price for one piece or a set; never "NaN AED". */
export const price = (item, qty = 1) => (priceOk(item) ? aed(Number(item.price) * qty) : '—');
/** "2 × 359 AED" for sets, '' for single pieces. */
export const unitNote = (item, qty) => (qty > 1 && priceOk(item) ? `${qty}${X}${aed(Number(item.price))}` : '');
/** Pack display name in the interface language. */
export const packName = (pack) => L(pack?.name, pack?.nameEn) || '';

/** Dimensions: { label: 'Ш × Г × В', value: '220 × 92 × 82 см' }; round items → Ø. Non-breaking throughout. */
export function dims(item) {
  const d = item?.dims;
  if (!d) return null;
  // QA-11: thin things keep their decimal (rug 1.5 cm), everything else is whole centimetres.
  const n = (v) => {
    if (v == null || v === '') return null;
    const x = Number(v);
    if (!Number.isFinite(x)) return null;
    return x < 10 && x % 1 ? new Intl.NumberFormat(isEn() ? 'en-US' : 'ru-RU', { maximumFractionDigits: 1 }).format(x) : fmtNum(x);
  };
  const [w, dp, ht] = [n(d.w), n(d.d), n(d.h)];
  const cm = `${NBSP}${t('unit.cm')}`;
  if (d.round || d.shape === 'round') return { label: t('hud.size'), value: `Ø${NBSP}${w}${X}${ht}${cm}` };
  const parts = [w, dp, ht].filter(Boolean);
  if (!parts.length) return null;
  return { label: t('dims.whd'), value: `${parts.join(X)}${cm}` };
}

/** Materials as a list ("Букле", "Каркас — массив дерева", …). */
export function materialsList(item) {
  let m = L(item?.materials, item?.materialsEn);
  if (typeof m === 'string') m = m.split(/\s*;\s*/);
  if (!Array.isArray(m)) return [];
  return m.map((x) => cap(String(x || '').trim())).filter(Boolean);
}

export const colorHex = (item) => safeHex(item?.colorHex);
/** Sets (tableware): what is delivered vs what the 3D view shows. */
export const setNoteOf = (item) => String(L(item?.setNote, item?.setNoteEn) || '').trim();
export const colorName = (item) => L(item?.color, item?.colorEn) || '';

export const dot = (item, cls = '') =>
  h('span', { class: `dot-c ${cls}`.trim(), style: `--c:${colorHex(item)}`, 'aria-hidden': 'true' });

/** <dl> rows for the sheet: dims, color, materials (one per line). */
export function specRows(item) {
  const rows = [];
  const dm = dims(item);
  if (dm) rows.push(h('div', null, h('dt', null, dm.label), h('dd', null, dm.value)));
  if (item?.color || item?.colorHex) rows.push(h('div', null, h('dt', null, t('hud.color')), h('dd', null, dot(item), colorName(item) || '—')));
  const mats = materialsList(item);
  if (mats.length) rows.push(h('div', null, h('dt', null, t('hud.materials')), h('dd', null, mats.map((m, i) => [i ? h('br') : null, m]))));
  return rows;
}
