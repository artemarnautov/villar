// Model families for the focus card's «Цвет и материал» row (docs/FOCUS.md §3). Owner: interface.
//
//   node tools/build-families.mjs           derive `family`, write it into site/data/catalog.json, print the groups
//   node tools/build-families.mjs --check   exit 1 if catalog.json is not up to date (writes nothing)
//
// A family is one model sold in several finishes: the same slot type and the same model name, e.g. the Luna
// armchair in leather or in fabric. Only real catalogue items are grouped; nothing is ever recoloured.
//   - model name: the first Latin word of the Russian name (the catalogue keeps model names in Latin:
//     «Кресло Luna, ткань» → Luna); names without one (bedding sets, decor sets, «Оливковое дерево…») have none;
//   - a shape word splits a model (Artemis arched ≠ Artemis round): they are different products, not finishes;
//   - members must differ in finish (colour name or materials). Two items with the same finish under one name
//     are different designs (two paintings of one series), so that group is not a family.
//   - Villar Editions (`edition: true`) are original artworks, each its own piece: never a family.
// Items outside a family carry no `family` field. Re-runnable, and safe while others edit the catalogue: it loads
// the current file, patches only `family`, and saves. Line by line when it can (the diff is the field only); if
// another layout makes that impossible, it falls back to a structured load → patch → save (every other field and
// the key order kept, `family` placed after `type`).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'site/data/catalog.json');
const CHECK = process.argv.includes('--check');

const src = readFileSync(FILE, 'utf8');
const catalog = JSON.parse(src);
const items = catalog.items;

const LATIN = /\b(?!Villar\b)[A-Z][A-Za-zÀ-ɏ'’-]*/;   // the house brand is not a model name
const SHAPES = [
  ['arch', /\bарк|арочн|\barch/i],
  ['round', /кругл|\bround\b/i],
  ['oval', /овальн|\boval\b/i],
  ['square', /квадратн|\bsquare\b/i],
];
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
const finish = (i) => `${String(i.colorEn || i.color || '').toLowerCase()}|${(i.materialsEn || i.materials || []).join(';').toLowerCase()}`;

const groups = new Map();
for (const it of items) {
  if (it.edition) continue;
  const m = String(it.name || '').match(LATIN);
  if (!m) continue;
  const text = `${it.name} ${it.nameEn || ''}`;
  const shape = SHAPES.find(([, re]) => re.test(text))?.[0];
  const key = `${it.type}:${slug(m[0])}${shape ? `-${shape}` : ''}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(it);
}

const families = new Map();
const rejected = [];
for (const [key, members] of groups) {
  if (members.length < 2) continue;
  const fins = members.map(finish);
  if (new Set(fins).size !== fins.length) { rejected.push([key, members, 'same finish under one name: different designs, not variants']); continue; }
  families.set(key, members);
}
const familyOf = new Map();
for (const [key, members] of families) for (const it of members) familyOf.set(it.id, key);

// Line-level edit: `"family"` goes right after the item's `"type"` line; stale family lines are removed.
let out = src.replace(/\n[ \t]*"family": "[^"\n]*",(?=\n)/g, '');
let touched = 0;
out = out.replace(/(\n([ \t]*)"id": "([^"\n]+)",\n[ \t]*"type": "[^"\n]*",)/g, (all, head, indent, id) => {
  const fam = familyOf.get(id);
  if (!fam) return all;
  touched++;
  return `${head}\n${indent}"family": "${fam}",`;
});

// Safety: the result parses, every member got its field, and nothing else changed.
const strip = (o) => JSON.stringify({ ...o, items: o.items.map(({ family, ...rest }) => rest) });
let mode = 'lines';
let parsed = null;
try { parsed = JSON.parse(out); } catch { parsed = null; }
const fieldsOk = (o) => o && o.items.every((i) => (i.family || null) === (familyOf.get(i.id) || null));
if (!parsed || touched !== familyOf.size || !fieldsOk(parsed) || strip(parsed) !== strip(catalog)) {
  // structured fallback: same objects, same key order, `family` right after `type`
  mode = 'structured';
  const indent = (src.match(/\n([ \t]+)"/) || [null, ' '])[1];
  const next = { ...catalog, items: catalog.items.map((it) => {
    const o = {};
    for (const [k, v] of Object.entries(it)) {
      if (k === 'family') continue;
      o[k] = v;
      if (k === 'type' && familyOf.has(it.id)) o.family = familyOf.get(it.id);
    }
    if (familyOf.has(it.id) && !('family' in o)) o.family = familyOf.get(it.id);
    return o;
  }) };
  out = JSON.stringify(next, null, indent) + (src.endsWith('\n') ? '\n' : '');
  parsed = JSON.parse(out);
  if (strip(parsed) !== strip(catalog) || !fieldsOk(parsed)) { console.error('build-families: could not patch `family` safely — refusing to write'); process.exit(2); }
}

const name = (i) => `${i.nameEn || i.name} · ${i.colorEn || i.color || '—'} · ${i.price} AED`;
console.log(`Families (${families.size}, ${familyOf.size} items):`);
for (const [key, members] of families) {
  console.log(`  ${key}`);
  for (const it of members) console.log(`    - ${it.id.padEnd(30)} ${name(it)}`);
}
if (rejected.length) {
  console.log('\nNot families (review):');
  for (const [key, members, why] of rejected) console.log(`  ${key}: ${members.map((i) => i.id).join(', ')} (${why})`);
}

if (CHECK) {
  if (out !== src) { console.error('\ncatalog.json is stale: run node tools/build-families.mjs'); process.exit(1); }
  console.log('\ncatalog.json up to date');
} else if (out !== src) {
  writeFileSync(FILE, out);
  console.log(`\nwrote site/data/catalog.json (${familyOf.size} family fields, ${mode})`);
} else console.log('\ncatalog.json already up to date');
