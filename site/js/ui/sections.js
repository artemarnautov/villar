// Data-driven static sections: studio header copy + style pack (palette, 60/30/10, rules). Owner: interface.
import { h, safeHex, inkFor } from './dom.js';
import { roleLabel, tierOf, TIERS } from './labels.js';

export function renderStudioCopy({ root, layout, stylepack }) {
  const area = layout.areaM2 ? `${Math.round(layout.areaM2)} м²` : '';
  const lead = root.querySelector('[data-studio-lead]');
  if (lead) {
    lead.textContent = `${layout.name ? layout.name.replace(/\s+/g, ' ') : `Студия ${area}`} в Дубае, стиль «${stylepack.name}». ` +
      'Наведите на любой предмет — увидите цену. Кликните — подберём замену.';
  }
}

// Draft markers from in-progress research data ("Черновик (уточняется): …") never reach the page.
const DRAFT = /^\s*(черновик|draft|tbd)[^:]{0,40}:\s*/i;
const cleanDraft = (t) => String(t || '').replace(DRAFT, '').replace(/^\p{Ll}/u, (c) => c.toUpperCase()).trim();
const isDraft = (t) => /^\s*(черновик|draft|tbd)|заглушк|уточняются/i.test(String(t));

const TECH = /L\*|LRV|ΔE|CRI|R9|BS\s?\d|Jotun|#[0-9a-f]{6}|\d\s?K\b/i;
const cap = (t) => t.replace(/^\s*\p{Ll}/u, (c) => c.toUpperCase());
/** "Орех — якорь, а не фон: 10–15% площади…" → { title: 'Орех — якорь, а не фон', body: '10–15% площади…' } */
function splitRule(text) {
  const t = String(text).trim();
  let i = t.indexOf(':');
  if (i < 0 || i > 44) { const d = t.indexOf(' — '); i = d > 0 && d <= 32 ? d : -1; if (i > 0) return { title: t.slice(0, i), body: cap(t.slice(i + 3)) }; }
  if (i > 0 && i <= 44) return { title: t.slice(0, i), body: cap(t.slice(i + 1).trim()) };
  return { title: '', body: t };
}

const FALLBACK_RULES = [
  'Шестьдесят процентов — тёплые светлые стены и пол, тридцать — дерево и текстиль, десять — акценты.',
  'Тёмный орех держит композицию: не больше трёх деревянных предметов в одной зоне взгляда.',
  'Олива и терракота — только в мелочах: подушки, керамика, искусство.',
  'Чёрный металл — тонкими линиями: ножки, рамы, светильники.',
];

export function renderStyle({ root, stylepack, palette }) {
  const name = stylepack.name || palette?.name || 'Стиль';
  root.querySelector('[data-pack-name]').textContent = `${name}.`;
  const tag = root.querySelector('[data-pack-tagline]');
  tag.textContent = stylepack.tagline || '';
  tag.hidden = !stylepack.tagline;
  const desc = root.querySelector('[data-pack-desc]');
  const raw = [stylepack.description, palette?.summary].find((t) => t && !/заглушк/i.test(t)) || '';
  const d = cleanDraft(raw);
  desc.textContent = d;
  desc.hidden = !d;

  const swatches = (palette?.swatches || []).filter((s) => s && s.hex).map((s) => ({
    ...s, hex: safeHex(s.hex), share: Number(s.share) > 0 ? Number(s.share) : 0, tier: tierOf(s.role),
  }));
  const pal = root.querySelector('[data-palette]');
  if (!swatches.length) { pal.hidden = true; return; }

  // Normalize shares (if missing, split evenly).
  let sum = swatches.reduce((a, s) => a + s.share, 0);
  if (sum <= 0) { swatches.forEach((s) => (s.share = 1 / swatches.length)); sum = 1; }
  swatches.forEach((s) => (s.share /= sum));

  // Segmented bar, ordered base → secondary → accent, largest first within a tier.
  const order = TIERS.map((t) => t.id);
  const barItems = [...swatches].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || b.share - a.share);
  const pct = (v) => (v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);
  const bar = root.querySelector('[data-ratio-bar]');
  bar.replaceChildren(...barItems.map((s) =>
    h('div', {
      class: 'ratio-seg', role: 'listitem',
      style: `--c:${s.hex};--ink:${inkFor(s.hex)};flex-grow:${(s.share * 1000).toFixed(0)};flex-basis:0`,
      title: `${s.name} — ${pct(s.share)}`, 'aria-label': `${s.name}, ${roleLabel(s.role).toLowerCase()}, ${pct(s.share)}`,
    }, s.share >= 0.08 ? h('span', null, pct(s.share)) : null)));

  const tiers = TIERS.map((t) => ({ ...t, share: swatches.filter((s) => s.tier === t.id).reduce((a, s) => a + s.share, 0) })).filter((t) => t.share > 0);
  const tierEl = root.querySelector('[data-ratio-tiers]');
  tierEl.replaceChildren(...tiers.map((t) =>
    h('div', { class: `ratio-tier${t.share < 0.14 ? ' is-narrow' : ''}${t.share < 0.06 ? ' is-tiny' : ''}`, style: `flex:${(t.share * 1000).toFixed(0)} 1 0` },
      h('b', null, pct(t.share)), h('span', null, t.label))));
  const sumLabel = root.querySelector('[data-ratio-label]');
  if (sumLabel) sumLabel.textContent = `Пропорция ${tiers.map((t) => Math.round(t.share * 100)).join(' / ')}`;

  // Large swatches, by share
  root.querySelector('[data-swatches]').replaceChildren(...[...swatches].sort((a, b) => b.share - a.share).map((s) =>
    h('li', { class: 'swatch' },
      h('div', { class: 'swatch-chip', style: `--c:${s.hex};--ink:${inkFor(s.hex)}`, 'aria-hidden': 'true' },
        h('span', { class: 'swatch-share' }, pct(s.share))),
      h('div', { class: 'swatch-name' }, s.name),
      h('div', { class: 'swatch-meta' }, `${roleLabel(s.role)} · `, h('span', { class: 'hex' }, s.hex), ` · ${pct(s.share)}`))));

  // Rules: palette first, then pack. Consumer-facing: skip the 60/30/10 rule (the bar shows it),
  // prefer plain-language rules over technical ones (LRV, ΔE, CRI…), show up to four.
  const all = [...(palette?.rules || []), ...(stylepack.rules || [])]
    .map((r) => cleanDraft(typeof r === 'string' ? r : r?.text || r?.rule || ''))
    .filter((r) => r && !isDraft(r) && !/^\s*60\s*\/\s*30/.test(r));
  const plain = all.filter((r) => !TECH.test(r));
  const picked = [...plain, ...all.filter((r) => TECH.test(r))].slice(0, 4);
  const list = (picked.length ? picked : FALLBACK_RULES).map(splitRule);
  root.querySelector('[data-rules]').replaceChildren(
    h('h3', { class: 't-h3 rules-title' }, 'Правила стиля'),
    ...list.map(({ title, body }, i) => h('div', { class: 'rule' },
      h('span', { class: 'rule-n' }, String(i + 1).padStart(2, '0')),
      title ? h('h4', { class: 'rule-t' }, title) : null,
      h('p', null, body))));
}
