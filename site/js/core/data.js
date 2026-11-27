// Loads the MVP data bundle. Owner: coordinator.
// styles.json lists every style pack; all packs (small JSON) are loaded up front so cross-style
// swaps are instant. Falls back to the single dark-walnut pack if styles.json is missing.
const BASE = '/data/';

async function getJSON(name) {
  const res = await fetch(BASE + name, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${name}: ${res.status}`);
  return res.json();
}

export async function loadData({ layoutId = 'studio' } = {}) {
  let index;
  try { index = await getJSON('styles.json'); } catch { index = { default: 'dark-walnut', packs: [{ id: 'dark-walnut' }] }; }
  const [layout, catalog, budget, ...packList] = await Promise.all([
    getJSON(`layout-${layoutId}.json`),
    getJSON('catalog.json'),
    getJSON('budget.json').catch(() => null),          // budget slider ladder spec (optional: no slider without it)
    ...index.packs.map((p) => getJSON(p.file || `stylepack-${p.id}.json`).catch(() => null)),
  ]);
  const packs = {};
  const palettes = {};
  await Promise.all(packList.filter(Boolean).map(async (pk) => {
    packs[pk.id] = pk;
    try { palettes[pk.id] = await getJSON(pk.palette || `palette-${pk.id}.json`); } catch { /* optional */ }
  }));
  const styleId = packs[index.default] ? index.default : Object.keys(packs)[0];
  // Back-compat fields for code written against a single pack.
  return { layout, catalog, packs, palettes, budget, styleId, stylepack: packs[styleId], palette: palettes[styleId] || null };
}

export const formatAED = (n) => `${new Intl.NumberFormat('ru-RU').format(Math.round(n))} AED`;
export const formatDims = (d) => (d ? (d.w === d.d && d.round ? `Ø${d.w} × ${d.h} см` : `${d.w} × ${d.d} × ${d.h} см`) : '');
