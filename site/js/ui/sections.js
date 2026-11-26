// Data-driven static sections: style pack (palette, 60/30/10, rules) and the live hero price note.
// Owner: interface.
import { h, safeHex, inkFor, aed, typo } from './dom.js';
import { roleLabel, tierOf, tiers as tierList } from './labels.js';
import { t, L, isEn } from './i18n.js';
import { packName } from './format.js';

// Draft markers from in-progress research data ("Черновик (уточняется): …") never reach the page.
const DRAFT = /^\s*(черновик|draft|tbd)[^:]{0,40}:\s*/i;
const cleanDraft = (t) => String(t || '').replace(DRAFT, '').replace(/^\p{Ll}/u, (c) => c.toUpperCase()).trim();

/**
 * Consumer-voice rules. The palette's own rules are a designer spec (LRV, ΔE, "≤4 ореховых массы")
 * and are not shown on the page; the pack may ship curated `consumerRules: [{ title, body }]`.
 */
const HOUSE_RULES_EN = [
  { title: 'Walnut is the main accent.', body: 'Only a little dark wood: it sets the character instead of filling the room. There is always something light between dark pieces — a rug, textiles or stone.' },
  { title: 'Two wood tones.', body: 'Dark walnut for furniture, light oak for the floor. No cherry, mahogany or bleached woods.' },
  { title: 'Two accent colours.', body: 'Olive and terracotta live in cushions, ceramics and art. Everything large stays warm and light.' },
  { title: 'One leather piece.', body: 'Cognac leather only on the armchair. The sofa stays light.' },
];
const HOUSE_RULES = [
  { title: 'Орех — главный акцент.', body: 'Тёмного дерева немного: оно задаёт характер, а не заполняет комнату. Между тёмными вещами всегда есть светлое — ковёр, текстиль или камень.' },
  { title: 'Два тона дерева.', body: 'Тёмный орех в мебели и светлый дуб на полу. Без вишни, красного дерева и выбеленных пород.' },
  { title: 'Два акцентных цвета.', body: 'Олива и терракота — в подушках, керамике и искусстве. Всё крупное — в тёплых светлых тонах.' },
  { title: 'Одна вещь из кожи.', body: 'Коньячная кожа — только у кресла. Диван остаётся светлым.' },
];

/** Live hero line: what the set on screen costs. */
export function renderHeroNote({ el, store }) {
  if (!el) return;
  const t2 = t;
  const paint = () => {
    const total = store.total();
    if (!total) { el.hidden = true; return; }
    el.textContent = t2('hero.note', { total: aed(total) });
    el.hidden = false;
  };
  paint();
  store.on('change', paint);
  return paint;
}

export function renderStyle({ root, stylepack, palette }) {
  const name = packName(stylepack) || palette?.name || t('style');
  root.querySelector('[data-pack-name]').textContent = `${name}.`;

  // Tagline without repeating the pack name the heading already says ("Тёмный орех. Тёплый лён…").
  const tag = root.querySelector('[data-pack-tagline]');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagline = String(L(stylepack.tagline, stylepack.taglineEn) || '').replace(new RegExp(`^\\s*${esc}\\s*[.,:—–-]?\\s*`, 'i'), '').trim();
  tag.textContent = tagline;
  tag.hidden = !tagline;

  const desc = root.querySelector('[data-pack-desc]');
  const raw = [L(stylepack.description, stylepack.descriptionEn), L(palette?.summary, palette?.summaryEn)].find((x) => x && !/заглушк/i.test(x)) || '';
  const d = cleanDraft(raw);
  desc.textContent = typo(d);
  desc.hidden = !d;

  const swatches = (palette?.swatches || []).filter((s) => s && s.hex).map((s) => ({
    ...s, hex: safeHex(s.hex), share: Number(s.share) > 0 ? Number(s.share) : 0, tier: tierOf(s.role),
  }));
  const pal = root.querySelector('[data-palette]');
  pal.hidden = !swatches.length;
  if (!swatches.length) { renderRules(root, stylepack); return; }

  // Normalize shares (if missing, split evenly).
  let sum = swatches.reduce((a, s) => a + s.share, 0);
  if (sum <= 0) { swatches.forEach((s) => (s.share = 1 / swatches.length)); sum = 1; }
  swatches.forEach((s) => (s.share /= sum));

  // One segmented bar, ordered base → secondary → accent, largest first within a tier.
  const TIERS = tierList();
  const order = TIERS.map((x) => x.id);
  const barItems = [...swatches].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || b.share - a.share);
  const pct = (v) => (v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);
  root.querySelector('[data-ratio-bar]').replaceChildren(...barItems.map((s) =>
    h('div', {
      class: 'ratio-seg', role: 'listitem',
      style: `--c:${s.hex};--ink:${inkFor(s.hex)};flex-grow:${(s.share * 1000).toFixed(0)};flex-basis:0`,
      title: `${L(s.name, s.nameEn)} — ${pct(s.share)}`, 'aria-label': `${L(s.name, s.nameEn)}, ${roleLabel(s.role).toLowerCase()}, ${pct(s.share)}`,
    }, s.share >= 0.12 ? h('span', null, pct(s.share)) : null)));

  const tiers = TIERS.map((x) => ({ ...x, share: swatches.filter((s) => s.tier === x.id).reduce((a, s) => a + s.share, 0) })).filter((x) => x.share > 0);
  root.querySelector('[data-ratio-tiers]').replaceChildren(...tiers.map((x) =>
    h('div', { class: `ratio-tier${x.share < 0.14 ? ' is-narrow' : ''}${x.share < 0.06 ? ' is-tiny' : ''}`, style: `flex:${(x.share * 1000).toFixed(0)} 1 0` },
      h('b', null, pct(x.share)), h('span', null, x.label))));
  const sumLabel = root.querySelector('[data-ratio-label]');
  if (sumLabel) sumLabel.textContent = t('style.ratio', { r: tiers.map((x) => Math.round(x.share * 100)).join(' / ') });

  // Swatches by share: chip, name, role · share. (No hex codes: this is a consumer page.)
  root.querySelector('[data-swatches]').replaceChildren(...[...swatches].sort((a, b) => b.share - a.share).map((s) =>
    h('li', { class: 'swatch' },
      h('div', { class: 'swatch-chip', style: `--c:${s.hex}`, 'aria-hidden': 'true' }),
      h('div', { class: 'swatch-name' }, L(s.name, s.nameEn)),
      h('div', { class: 'swatch-meta' }, `${roleLabel(s.role)} · ${pct(s.share)}`))));

  renderRules(root, stylepack);
}

function renderRules(root, stylepack) {
  const curated = (L(stylepack.consumerRules, stylepack.consumerRulesEn) || [])
    .map((r) => (typeof r === 'string' ? { title: '', body: r } : { title: r?.title || '', body: r?.body || r?.text || '' }))
    .filter((r) => r.body || r.title);
  // House rules are written for Тёмный орех only; other packs show their own consumerRules (or none).
  const fallback = stylepack.id === 'dark-walnut' ? (isEn() ? HOUSE_RULES_EN : HOUSE_RULES) : [];
  const list = (curated.length ? curated : fallback).slice(0, 4);
  const box = root.querySelector('[data-rules]');
  box.hidden = !list.length;
  box.replaceChildren(
    h('h3', { class: 't-h3 rules-title' }, t('style.rules')),
    ...list.map(({ title, body }, i) => h('div', { class: 'rule' },
      h('span', { class: 'rule-n' }, String(i + 1).padStart(2, '0')),
      title ? h('h4', { class: 'rule-t' }, typo(title)) : null,
      body ? h('p', null, typo(body)) : null)));
}
