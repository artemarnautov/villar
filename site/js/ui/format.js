// Item presentation helpers shared by hover card, sheet and budget. Owner: interface.
// Never surfaces ids, SKUs, links or supplier data — only display fields.
import { h, safeHex, fmtNum } from './dom.js';
import { formatAED } from '../core/data.js';

/** Dimensions: { label: 'Ш × Г × В', value: '220 × 92 × 82 см' }; round items → Ø. */
export function dims(item) {
  const d = item?.dims;
  if (!d) return null;
  const n = (v) => (v == null || v === '' ? null : fmtNum(v));
  const [w, dp, ht] = [n(d.w), n(d.d), n(d.h)];
  if (d.round || (d.shape === 'round')) return { label: 'Ø × В', value: `${w} × ${ht} см` };
  const parts = [w, dp, ht].filter(Boolean);
  if (!parts.length) return null;
  return { label: 'Ш × Г × В', value: `${parts.join(' × ')} см` };
}

/** Price or a dash — never "NaN AED". */
export const price = (item, qty = 1) => (Number.isFinite(Number(item?.price)) && item?.price !== '' ? formatAED(Number(item.price) * qty) : '—');
export const nameOf = (item) => String(item?.name || '').trim() || 'Предмет';

export function materials(item) {
  let m = item?.materials;
  if (typeof m === 'string') m = m.split(/\s*[,;]\s*/);
  if (!Array.isArray(m) || !m.length) return '';
  // "Букле, массив ореха": lower-case the first letter of later items unless it's an acronym (МДФ, LED).
  return m.filter(Boolean).map((x, i) => {
    x = String(x).trim();
    if (i === 0) return x.charAt(0).toUpperCase() + x.slice(1);
    return /^.\p{Ll}/u.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x;
  }).join(', ');
}

export const colorHex = (item) => safeHex(item?.colorHex);

export function colorNode(item) {
  return [h('span', { class: 'dot-c', style: `--c:${colorHex(item)}`, 'aria-hidden': 'true' }), item?.color || '—'];
}

/** <dl> rows: Ш×Г×В, materials, color. */
export function specRows(item) {
  const rows = [];
  const dm = dims(item);
  if (dm) rows.push(h('div', null, h('dt', null, dm.label), h('dd', null, dm.value)));
  const mt = materials(item);
  if (mt) rows.push(h('div', null, h('dt', null, 'Материалы'), h('dd', null, mt)));
  if (item?.color || item?.colorHex) rows.push(h('div', null, h('dt', null, 'Цвет'), h('dd', null, ...colorNode(item))));
  return rows;
}
