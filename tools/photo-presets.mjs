// Live → Photo: the planned paid generations (docs/ART.md §1) as rows for the admin job queue (public.photo_jobs).
// Owner: photo. Nothing here calls a model: the coordinator inserts the rows (Supabase connector = the authorization),
// then `GET https://<site>/api/photo?run=1` runs one step per call (a provider job that is still running is picked up
// again by a later call, or finished by the webhook).
//
//   node tools/photo-presets.mjs                          dry run: the plan and its cost estimate (default)
//   node tools/photo-presets.mjs --sql plates             SQL: day plate, sunset + evening edits, sky mask
//   node tools/photo-presets.mjs --sql editions [--styles dark-walnut] [--candidates 2]
//                                                         SQL: Villar Editions, 6 per style (ART §5)
//   node tools/photo-presets.mjs --sql hero --from <64-hex key>[,<key>…]    hero (Pro) photos of stored frames
//   node tools/photo-presets.mjs --sql preset --from <keys>                 preset (T2) photos of stored frames
//
// Hero / preset photos re-develop a frame that a visit already uploaded (frames/<key>.jpg + .json in Storage, kept by
// every develop): open the view on the deployed site, let it develop once (T2), take its key from
// `villarPhoto.debug.S.last` (or photo_renders), and queue it here. ART §1: a new prompt version is tried on the
// 3 canonical frames at T1 first; every paid output is reviewed in the browser before it enters the product.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8'));
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const STYLES = read('site/data/styles.json').packs.map((p) => p.id);
const styles = String(opt('styles', STYLES.join(','))).split(',').filter((s) => STYLES.includes(s));
const candidates = Math.max(1, Math.min(4, Number(opt('candidates', 2))));

// USD per output — estimates: Higgsfield publishes no per-model API price. After the first jobs, read the real charge
// (balance delta), then set PHOTO_COST and update docs/ART.md §1.
const PRICE = { t1: 0.067, t2: 0.101, proPlate4k: 0.24, pro2k: 0.134, mask: 0.134, loop: 0.67 };

// ------------------------------------------------------------------------------------------------- editions (ART §5)
// Medium, palette and composition only: no artist names, no look-alikes, no text. The palette comes from the pack.
const DIRECTION = {
  'dark-walnut': [
    ['sofa', '3:2', 'a large tonal abstract of layered ink washes, umber over soft black, one quiet rust field low on the left, visible brush drag and paper-like texture'],
    ['sofa', '3:2', 'a horizon-like band composition in umber, smoke and warm black, edges dissolving into each other, a single thin rust line across the lower third'],
    ['bed', '4:3', 'a calm field of warm umber with a soft darker cloud rising from the bottom, sparse dry-brush marks, generous negative space'],
    ['bed', '4:3', 'two overlapping vertical veils of ink, one umber and one charcoal, a faint rust glow where they meet, matte textured surface'],
    ['dining', '2:3', 'a single bold ink gesture on warm off-white, umber and black, a small rust accent, fibrous paper texture'],
    ['dining', '2:3', 'a stacked composition of three soft rectangles in umber, ink and rust, edges feathered, quiet and architectural'],
  ],
  'light-oak': [
    ['sofa', '3:2', 'a quiet northern coastal landscape at dawn, pale mist over low dunes, a thin sea line, very soft greys and oat tones, painterly'],
    ['sofa', '3:2', 'minimal continuous line work in soft charcoal on paper-white, a slow horizon of hills, lots of white space'],
    ['bed', '4:3', 'a pale birch forest in fog, silhouettes barely there, oat, grey and white, gentle watercolour bleeds'],
    ['bed', '4:3', 'a still lake with a single low island, washed greys and sage, a wide quiet sky'],
    ['dining', '2:3', 'a minimal botanical line drawing of a single branch in charcoal on warm white paper'],
    ['dining', '2:3', 'three soft stacked stones drawn in graphite with a pale sage wash, centred, lots of white space'],
  ],
  'greige-luxe': [
    ['sofa', '3:2', 'a plaster-textured tonal field in greige and stone, a soft champagne sheen catching raking light, trowel marks'],
    ['sofa', '3:2', 'two tonal plaster planes, warm stone and pale greige, divided by a fine champagne seam'],
    ['bed', '4:3', 'a soft arch shape in raised plaster on a warm greige ground, subtle champagne highlights, tone on tone'],
    ['bed', '4:3', 'layered limestone-like strata in pearl, taupe and stone, gently textured, calm and luxurious'],
    ['dining', '2:3', 'a single raised plaster circle on a stone-coloured field, a faint champagne patina'],
    ['dining', '2:3', 'vertical tonal bands of greige, cream and stone in textured plaster, softly lit from the side'],
  ],
  mediterranean: [
    ['sofa', '3:2', 'a sun-washed Mediterranean coast study, white village walls stepping down to a sea-blue bay, terracotta roofs, loose painterly light'],
    ['sofa', '3:2', 'an olive grove at midday in loose brushwork, silver-green leaves, terracotta earth, a strip of sea blue on the horizon'],
    ['bed', '4:3', 'an architecture study of whitewashed arches and a blue door in strong sun, soft shadows, gouache texture'],
    ['bed', '4:3', 'a calm sea horizon with a single small sail, sea blue and limewash white, warm terracotta rocks in the foreground'],
    ['dining', '2:3', 'a still life of terracotta pots and an olive branch on a sunlit limewash ledge, loose and luminous'],
    ['dining', '2:3', 'a single tall cypress beside a white wall, terracotta and olive tones, strong afternoon light'],
  ],
};
function editionRows() {
  const rows = [];
  for (const st of styles) {
    const r = read(`site/data/palette-${st}.json`).roles || {};
    // the 10 % accent and two neutrals (ART §5), plus the pack's wood
    const palette = [...(r.accent || []).slice(0, 2), ...(r.base || []).slice(0, 1), ...(r.secondary || []).slice(0, 1), ...(r.wood || []).slice(0, 1)].slice(0, 5);
    (DIRECTION[st] || []).forEach(([wall, aspect, prompt], i) => rows.push({ kind: 'edition', params: { id: `${st}-${wall}-${i + 1}`, style: st, wall, prompt, palette, aspect, resolution: '2K', candidates } }));
  }
  return rows;
}
const plateRows = () => [
  { kind: 'plate', params: { time: 'day' } },
  { kind: 'plate-edit', params: { time: 'sunset' } },
  { kind: 'plate-edit', params: { time: 'evening' } },
  { kind: 'mask', params: {} },
];
const frameRows = (kind) => String(opt('from', '')).split(',').filter((k) => /^[a-f0-9]{64}$/.test(k)).map((from) => ({ kind, params: { from } }));
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const toSql = (rows) => `insert into public.photo_jobs (kind, params) values\n${rows.map((r) => `  (${sqlStr(r.kind)}, ${sqlStr(JSON.stringify(r.params))}::jsonb)`).join(',\n')};`;

const which = opt('sql', null);
if (which) {
  const rows = which === 'plates' ? plateRows() : which === 'editions' ? editionRows() : which === 'hero' || which === 'preset' ? frameRows(which) : [];
  if (!rows.length) { console.error('nothing to emit (use --sql plates|editions|hero|preset; hero/preset need --from <keys>)'); process.exit(2); }
  console.log(`-- ${rows.length} job(s); run them with GET /api/photo?run=1 (one step per call)\n${toSql(rows)}`);
  process.exit(0);
}

const works = editionRows().length;
const plan = [
  ['Window plate: day (Pro 4K) + sunset + evening edits', 3, PRICE.proPlate4k],
  ['Sky mask (Pro 2K)', 1, PRICE.mask],
  ['Fidelity A/B on the 3 canonical frames (T1)', 15, PRICE.t1],
  [`Art editions: ${works} works × ${candidates} candidates (NB 2.1, 2K)`, works * candidates, PRICE.t2],
  ['Opening shots: 4 styles × day (hero, Pro 2K)', 4, PRICE.pro2k],
  ['Preset photos: 4 styles × 4 views × 3 times (T2)', 48, PRICE.t2],
  ['Window loops (8 s, first = last frame) × 3 — after the stills are approved', 3, PRICE.loop],
];
let total = 0;
console.log('Live → Photo — planned paid generations (docs/ART.md §1). Prices are estimates until the first charges are read.\n');
console.log('| Item | Count | Est. USD |\n|---|---|---|');
for (const [label, n, each] of plan) { total += n * each; console.log(`| ${label} | ${n} | $${(n * each).toFixed(2)} |`); }
console.log(`| **Planned** | | **$${total.toFixed(2)}** |`);
console.log('\nAt gateway list prices (NB2 2K $0.101) the plan is above ART §1\'s ≈ $10; at the Higgsfield rate it may be lower — read the real charge after the first 3 jobs.');
console.log('Caps until launch: 60 generations/day in total, 12 per IP (PHOTO_DAILY_CAP, PHOTO_DAILY_IP); queue jobs do not count against visitors.');
console.log('Emit SQL: --sql plates | --sql editions | --sql hero --from <key> | --sql preset --from <key>');
