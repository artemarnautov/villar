// Loads the MVP data bundle. Owner: coordinator.
const BASE = '/data/';

async function getJSON(name) {
  const res = await fetch(BASE + name, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${name}: ${res.status}`);
  return res.json();
}

export async function loadData({ stylepackId = 'dark-walnut', layoutId = 'studio' } = {}) {
  const [layout, catalog, stylepack] = await Promise.all([
    getJSON(`layout-${layoutId}.json`),
    getJSON('catalog.json'),
    getJSON(`stylepack-${stylepackId}.json`),
  ]);
  let palette = null;
  try { palette = await getJSON(stylepack.palette || `palette-${stylepackId}.json`); } catch { /* optional */ }
  return { layout, catalog, stylepack, palette };
}

export const formatAED = (n) => `${new Intl.NumberFormat('ru-RU').format(Math.round(n))} AED`;
export const formatDims = (d) => (d ? (d.w === d.d && d.round ? `Ø${d.w} × ${d.h} см` : `${d.w} × ${d.d} × ${d.h} см`) : '');
