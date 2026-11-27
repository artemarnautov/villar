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
  // editions flag: with `editions: false` no pack offers, picks or defaults to a Villar Edition (see withoutEditions)
  if (index.editions === false) Object.assign(packs, withoutEditions(packs, catalog));
  const styleId = packs[index.default] ? index.default : Object.keys(packs)[0];
  // Back-compat fields for code written against a single pack.
  // `editions: false` in styles.json switches Villar Editions off everywhere in the UI (docs/ART.md §5).
  return { layout, catalog, packs, palettes, budget, styleId, stylepack: packs[styleId], palette: palettes[styleId] || null, editions: index.editions !== false };
}

/**
 * editions flag (docs/ART.md §5, curator). `editions: false` in styles.json takes Villar Editions out of every pack:
 * options, picks, avoid pairs and defaults. A slot whose default was an edition falls back to its first non-edition
 * pick (else its first non-edition option), so the room, the budget ladder and the order never contain one.
 * Pure: returns new pack objects. loadData and tools/build-ai-index.mjs both use it, so browser and server agree.
 */
export function withoutEditions(packs, catalog) {
  const ed = new Set((catalog?.items || []).filter((i) => i.edition).map((i) => i.id));
  const out = {};
  for (const [id, p] of Object.entries(packs || {})) {
    const slots = {};
    const picks = p.picks ? { ...p.picks } : null;
    for (const [k, cfg] of Object.entries(p.slots || {})) {
      const options = (cfg.options || []).filter((o) => !ed.has(o));
      if (!options.length || options.length === (cfg.options || []).length) { slots[k] = cfg; continue; } // no edition here, or nothing else to hang
      const pk = (p.picks?.[k] || []).filter((o) => !ed.has(o));
      const def = ed.has(cfg.default) ? (pk[0] || options[0]) : cfg.default;
      slots[k] = { ...cfg, default: def, options: [def, ...options.filter((o) => o !== def)] };
      if (picks && picks[k]) picks[k] = [def, ...pk.filter((o) => o !== def)];
    }
    out[id] = { ...p, slots, ...(picks ? { picks } : {}), ...(Array.isArray(p.avoid) ? { avoid: p.avoid.filter((pr) => !ed.has(pr[0]) && !ed.has(pr[1])) } : {}) };
  }
  return out;
}

export const formatAED = (n) => `${new Intl.NumberFormat('ru-RU').format(Math.round(n))} AED`;
export const formatDims = (d) => (d ? (d.w === d.d && d.round ? `Ø${d.w} × ${d.h} см` : `${d.w} × ${d.d} × ${d.h} см`) : '');
