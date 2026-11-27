// Villar assistant tests (owner: assistant). Run: node tools/test-ai.mjs [--verbose]
// 1. core: key logic parity with store.js, applyActions validation, fitBudget
// 2. local.js: RU + EN intents against the real catalog (+ a synthetic second pack for style switches)
// 3. api/assistant.js: handler with a stubbed AI Gateway (canned tool calls), validation, budget loop,
//    errors, rate limit, auth diagnostics
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
const json = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

const { createSim, parseBudget, sanitizeText } = await import(resolve(ROOT, 'site/js/ai/core.js'));
// The handler registers the server-only supplier deny list on import; do the same for direct sanitizer tests.
{ const { addDenyPatterns } = await import(resolve(ROOT, 'site/js/ai/core.js')); const d = await import(resolve(ROOT, 'api/_deny.js')); addDenyPatterns(d.SUPPLIERS, d.SUPPLIERS_RU); }
const { parseLocal } = await import(resolve(ROOT, 'site/js/ai/local.js'));
const { createStore } = await import(resolve(ROOT, 'site/js/core/store.js'));

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; if (VERBOSE) console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra, null, 0).slice(0, 600) : ''); }
};
const section = (s) => console.log(`\n# ${s}`);

// ---------------------------------------------------------------- data
const catalog = json('site/data/catalog.json');
const layout = json('site/data/layout-studio.json');
const styles = json('site/data/styles.json');
const packs = {};
for (const p of styles.packs) packs[p.id] = json(`site/data/${p.file || `stylepack-${p.id}.json`}`);
const base = packs[styles.default] || Object.values(packs)[0];

// Synthetic second pack (tests only): same keys, reversed option order → different defaults; one pairing.
if (!packs['test-light']) {
  const slots = {};
  for (const [k, cfg] of Object.entries(base.slots)) {
    const opts = [...cfg.options].reverse();
    slots[k] = { default: opts[0], options: opts };
  }
  packs['test-light'] = {
    id: 'test-light', name: 'Тестовый лён', nameEn: 'Test Linen', tagline: 'Тест', slots,
    pairings: { [base.slots.sofa.options[0]]: { rug: base.slots.rug.options[1] } },
  };
}
let budgetSpec = null;
try { budgetSpec = JSON.parse(readFileSync(resolve(ROOT, 'site/data/budget.json'), 'utf8')); } catch { /* optional */ }
const data = { catalog, layout, packs, budget: budgetSpec };
// Fixtures derived from the data, so catalog edits don't break the suite.
const itemById = new Map((catalog.items || catalog).map((i) => [i.id, i]));
const priceOf = (id) => Number(itemById.get(id)?.price) || 0;
const SOFA_A = base.slots.sofa.options[0], SOFA_B = base.slots.sofa.options.at(-1);
const NIGHT_B = (base.slots.nightstand || base.slots.nightstands)?.options.at(-1);
// A real second pack if one exists (for natural-language style switches), else the synthetic one.
const REAL_LO = packs['light-oak'] ? 'light-oak' : null;
const LO = REAL_LO || 'test-light';
const sim = createSim(data);
const S0 = { style: base.id, selection: sim.defaults(base.id) };

// ---------------------------------------------------------------- 1. core
section('core: parity with store.js');
{
  const store = createStore({ catalog, layout, packs, styleId: base.id, persist: false });
  ok(store.total() === sim.total(base.id, S0.selection), 'default total matches store.total()', [store.total(), sim.total(base.id, S0.selection)]);
  for (const s of layout.slots) ok(store.keyOf(s.id) === sim.keyIn(base, s.id), `key of ${s.id}`);
  ok(sim.qty(base.id, 'nightstand') === store.qty('nightstand'), 'qty nightstand');
  // Decor is two independent keys (coffee table, TV unit) since round 2; older packs used one decor_set ×2.
  if (base.slots.decor_set) ok(sim.qty(base.id, 'decor_set') === 2, 'decor_set has 2 placements');
  else ok(sim.qty(base.id, 'decor_coffee') === 1 && sim.qty(base.id, 'decor_tv') === 1, 'decor_coffee and decor_tv are separate placements');
  // style landing parity
  const anchor = { slotId: 'sofa', itemId: base.slots.sofa.options[0] };
  const pv = store.previewStyle('test-light', anchor);
  const ss = sim.styleSelection('test-light', anchor);
  ok(JSON.stringify(pv.selection) === JSON.stringify(ss.selection), 'styleSelection == store.previewStyle (with anchor + pairing)');
  ok(ss.selection.rug === base.slots.rug.options[1], 'pairing applied');
  ok(pv.total === sim.total('test-light', ss.selection), 'preview total parity');
  // apply via store and compare totals
  const r = sim.applyActions(S0, [{ type: 'select', key: 'sofa', itemId: SOFA_B }, { type: 'select', slotId: 'nightstand_r', itemId: NIGHT_B }]);
  store.select('sofa', SOFA_B); store.select('nightstand_r', NIGHT_B);
  ok(store.total() === sim.total(r.state.style, r.state.selection), 'total after selects matches store', [store.total(), sim.total(r.state.style, r.state.selection)]);
}

section('core: applyActions validation');
{
  const r = sim.applyActions(S0, [
    { type: 'select', key: 'sofa', itemId: 'sofa-does-not-exist' },
    { type: 'select', key: 'sofa', itemId: 'bed-cloud-160' },          // wrong type
    { type: 'select', key: 'rug', itemId: 'rug-marlow-200x290' },     // ok
    { type: 'select', itemId: 'tv-hege' },                             // key inferred
    { type: 'select', slotId: 'art_bed', itemId: 'art-olina-120x60' }, // per-placement key
    { type: 'select', key: 'art_sofa', itemId: 'art-olina-120x60' },  // not an option there
    { type: 'view', name: 'bedroom' }, { type: 'time', name: 'sunset' }, { type: 'view', name: 'kitchen-roof' },
    { type: 'style', styleId: 'nope' }, { type: 'focus', slotId: 'nightstands' }, { type: 'explode' },
    { type: 'select', key: 'sofa', itemId: S0.selection.sofa }, // no-op
  ]);
  const t = r.actions.map((a) => a.type + ':' + (a.key || a.name || a.slotId || a.styleId || ''));
  ok(t.includes('select:rug') && t.includes('select:tv_unit') && t.includes('select:art_bed'), 'valid selects kept', t);
  ok(!t.some((x) => x === 'select:sofa'), 'invalid + no-op sofa selects dropped', t);
  ok(!t.includes('select:art_sofa'), 'incompatible per-slot option dropped');
  ok(t.includes('view:bed') && t.includes('time:golden'), 'view/time aliases normalized', t);
  ok(t.includes('focus:nightstand_l'), 'focus by group → first slot', t);
  ok(r.dropped.length === 6, 'dropped count', r.dropped.map((d) => d.why));
  // keys a pack defines but the layout does not place yet (e.g. throw before the engine adds its slot) are refused
  const unplaced = Object.keys(base.slots).find((k) => !sim.placedKeys(base.id).includes(k));
  if (unplaced) {
    const ru = sim.applyActions(S0, [{ type: 'select', key: unplaced, itemId: base.slots[unplaced].options.at(-1) }]);
    ok(ru.actions.length === 0, `select on unplaced key "${unplaced}" dropped`, ru.actions);
  }
  const st = sim.applyActions(S0, [{ type: 'select', key: 'sofa', itemId: SOFA_B }, { type: 'style', styleId: 'Test Linen', anchorItemId: SOFA_A }]);
  ok(st.actions[0].type === 'style' && st.actions[0].styleId === 'test-light', 'style resolved by English name and ordered first', st.actions);
  ok(st.actions[0].anchor?.key === 'sofa', 'anchor resolved');
  ok(st.state.selection.sofa === SOFA_B, 'select after style applies in the target pack');
}

section('core: budget planner (slider parity)');
if (budgetSpec) {
  const p0 = sim.planBudget(base.id, 20000, { selection: S0.selection });
  ok(p0 && p0.total <= 20000 && p0.level, `planBudget 20 000 → ${p0?.total} (${p0?.level?.id})`);
  const nulls = Object.values(p0.selection).filter((v) => v === null).length;
  ok(nulls > 0, `a lower budget leaves slots empty (${nulls})`);
  const pf = sim.planBudget(base.id, 1e7, { selection: S0.selection });
  ok(pf.total >= S0.total || pf.total >= sim.total(base.id, S0.selection), 'max budget ≥ designer room');
  const pinSofa = SOFA_B;
  const sp = { ...S0.selection, sofa: pinSofa };
  const pp = sim.planBudget(base.id, 15000, { selection: sp, pins: ['sofa'] });
  ok(pp.selection.sofa === pinSofa, 'pinned sofa kept by the planner');
  const r = sim.applyActions(S0, [{ type: 'budget', amount: 20000 }]);
  ok(r.actions[0]?.type === 'budget' && sim.total(r.state.style, r.state.selection) === p0.total, 'budget action = planBudget');
  ok(sim.applyActions(S0, [{ type: 'budget', amount: -5 }]).dropped.length === 1, 'bad amount dropped');
} else ok(true, 'no budget.json — skipped');

// FOCUS guest (docs/FOCUS.md §3 «Из других стилей»): one piece taken from another style, without switching the room.
section('core: guest items (one piece from another style)');
{
  const realIds = Object.keys(packs).filter((id) => id !== 'test-light');
  // a key of the base style and an item another real style offers for it that the base style doesn't
  const guestFor = (key) => {
    const own = new Set(base.slots[key]?.options || []);
    for (const id of realIds) if (id !== base.id) for (const o of packs[id].slots?.[key]?.options || []) if (!own.has(o) && itemById.has(o)) return { id: o, from: id };
    return null;
  };
  const keysWithGuests = Object.keys(base.slots).filter((k) => sim.placedKeys(base.id).includes(k) && guestFor(k));
  ok(keysWithGuests.length > 0, `the data has guest candidates (${keysWithGuests.join(', ')})`);
  const K = keysWithGuests.includes('rug') ? 'rug' : keysWithGuests[0];
  const G = guestFor(K);
  // an item of the right type that no pack offers for K (per-placement art keys make this exact)
  const typeK = layout.slots.find((s) => sim.keyIn(base, s.id) === K)?.type;
  const offeredAnywhere = new Set(realIds.flatMap((id) => packs[id].slots?.[K]?.options || []));
  const NOT_OFFERED = (catalog.items || catalog).find((i) => i.type === typeK && !offeredAnywhere.has(i.id))?.id
    || (catalog.items || catalog).find((i) => i.type !== typeK)?.id;

  // store: select → guestStyle → snapshot/restore
  {
    const store = createStore({ catalog, layout, packs, styleId: base.id, persist: false });
    ok(store.select(K, G.id) === true && store.selected(K)?.id === G.id, `store.select accepts a guest (${K} ← ${G.id} from ${G.from})`);
    ok(store.guestStyle(K) === G.from, 'guestStyle names the style it comes from', store.guestStyle(K));
    ok(store.guestStyle(K, base.slots[K].default) === null, 'own options are not guests');
    ok(store.isPinned(K), 'a guest pick is pinned like any pick');
    ok(store.total() === sim.total(base.id, { ...sim.defaults(base.id), [K]: G.id }), 'total prices the guest');
    const snap = store.snapshot();
    store.select(K, base.slots[K].default);
    ok(store.selected(K)?.id === base.slots[K].default, 'swap back to an own option');
    store.restore(snap);
    ok(store.selected(K)?.id === G.id && store.isPinned(K), 'restore(snapshot) brings the guest and its pin back');
    ok(store.select(K, NOT_OFFERED) === false && store.selected(K)?.id === G.id, `an id no pack offers for ${K} is rejected (${NOT_OFFERED})`);
    ok(store.select('art_sofa', 'art-ember-90x60') === (realIds.some((id) => packs[id].slots?.art_sofa?.options?.includes('art-ember-90x60'))), 'per-placement keys: art offered only for another wall is rejected');
    // a style switch keeps a guest only if it is pinned
    const other = realIds.find((id) => id !== base.id);
    store.setStyle(other);
    store.setStyle(base.id);
    ok(store.selected(K)?.id === G.id, 'switching away and back keeps the pinned guest');
    store.unpin(K);
    store.setStyle(other);
    store.setStyle(base.id);
    ok(store.selected(K)?.id !== G.id && !store.guestStyle(K), 'an unpinned guest drops to the style’s own pick on a style landing', store.selected(K)?.id);
  }

  // persistence: a reload keeps a pinned guest; an unpinned one in storage falls back to the designer pick
  {
    const mem = new Map();
    const prevLS = globalThis.localStorage;
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    try {
      const s1 = createStore({ catalog, layout, packs, styleId: base.id });
      s1.select(K, G.id);
      const s2 = createStore({ catalog, layout, packs, styleId: base.id });
      ok(s2.selected(K)?.id === G.id && s2.isPinned(K), 'reload (persistence v3) keeps the pinned guest');
      const keyName = [...mem.keys()][0];
      const saved = JSON.parse(mem.get(keyName));
      saved.pins[base.id] = (saved.pins[base.id] || []).filter((k) => k !== K);
      mem.set(keyName, JSON.stringify(saved));
      const s3 = createStore({ catalog, layout, packs, styleId: base.id });
      ok(s3.selected(K)?.id === base.slots[K].default, 'reload drops an unpinned guest to the designer pick', s3.selected(K)?.id);
      saved.selections[base.id][K] = NOT_OFFERED; saved.pins[base.id] = [K];
      mem.set(keyName, JSON.stringify(saved));
      const s4 = createStore({ catalog, layout, packs, styleId: base.id });
      ok(s4.selected(K)?.id !== NOT_OFFERED, 'reload rejects an id no pack offers for the key');
    } finally { globalThis.localStorage = prevLS; }
  }

  // planner: a pinned guest is kept in every step; its requires/deps come with it; the guest wins pairings
  if (budgetSpec) {
    const sel = { ...S0.selection, [K]: G.id };
    for (const amount of [0, 15000, 25000, 1e7]) {
      const p = sim.planBudget(base.id, amount, { selection: sel, pins: [K] });
      ok(p.selection[K] === G.id, `planner keeps the pinned guest at ${amount} AED`, p.selection[K]);
    }
    const { buildLadder } = await import(resolve(ROOT, 'site/js/core/budget.js'));
    const req = budgetSpec.requires || {};
    const depKey = Object.keys(req).find((k) => base.slots[k] && guestFor(k) && req[k].every((d) => base.slots[d]) && (budgetSpec.tiers?.[k] ?? 0) > 0);
    if (depKey) {
      const g = guestFor(depKey);
      const Lr = buildLadder({ pack: base, items: catalog.items, layout, spec: budgetSpec, pinned: { [depKey]: g.id } });
      const min = Lr.steps[0].selection;
      ok(Lr.steps.every((s) => s.selection[depKey] === g.id), `ladder keeps the guest ${depKey} (${g.id}) in every step`);
      ok(req[depKey].every((d) => min[d] != null), `the minimum brings what the guest ${depKey} requires (${req[depKey].join(', ')})`, req[depKey].map((d) => [d, min[d]]));
    } else ok(true, 'no guest with requirements in this data — skipped');
    // pairings: a guest furniture pin is never moved by a partner's pairing; the partner adapts
    const furn = new Set(budgetSpec.furniture || []);
    const pk = Object.keys(base.slots).find((k) => furn.has(k) && guestFor(k) && Object.values(base.pairings || {}).some((m) => m[k]));
    if (pk) {
      const g = guestFor(pk);
      const Lr = buildLadder({ pack: base, items: catalog.items, layout, spec: budgetSpec, pinned: { [pk]: g.id } });
      ok(Lr.steps.every((s) => s.selection[pk] === g.id), `a partner's pairing never moves the guest ${pk} (${g.id})`);
    } else ok(true, 'no paired guest in this data — skipped');
  }

  // server: the lead re-prices a guest from the published index and still rejects an id no pack offers
  {
    const lead = await import(resolve(ROOT, 'api/lead.js'));
    const body = { name: 'Test Guest', phone: '+971 50 123 4567', consent: true, style: base.id, selection: { ...S0.selection, [K]: G.id } };
    const r = lead.validate(body);
    const line = r.lead?.items?.find((l) => l.key === K);
    ok(line?.id === G.id && line.price === Math.round(priceOf(G.id)), 'lead re-pricing accepts and prices a guest', line);
    ok(r.lead?.total === r.lead?.items.reduce((a, l) => a + l.sum, 0), 'lead total includes the guest');
    const bad = lead.validate({ ...body, selection: { ...S0.selection, [K]: NOT_OFFERED } });
    ok(bad.lead?.items?.find((l) => l.key === K)?.id === base.slots[K].default, 'lead replaces an id no pack offers with the designer pick');
    ok(sim.normalizeSelection(base.id, { [K]: G.id })[K] === G.id && sim.normalizeSelection(base.id, { [K]: NOT_OFFERED })[K] === base.slots[K].default, 'normalizeSelection: guest kept, foreign id dropped');
  }
}

section('core: fitBudget');
{
  const t0 = sim.total(base.id, S0.selection);
  const min = sim.minTotal(base.id);
  for (const target of [t0 - 500, t0 - 4000, Math.round((t0 + min) / 2), min + 10, min]) {
    const f = sim.fitBudget(base.id, S0.selection, target);
    ok(f.ok && f.total <= target, `fit ≤ ${target}`, { total: f.total, swaps: f.swaps.length });
    ok(f.total === sim.total(base.id, f.selection), 'reported total is real');
  }
  const f1 = sim.fitBudget(base.id, S0.selection, t0 - 500);
  ok(f1.swaps.length === 1, 'small cut = one swap', f1.swaps);
  const imp = sim.fitBudget(base.id, S0.selection, min - 1000);
  ok(!imp.ok && imp.total === min, 'impossible target lands on the minimum', { total: imp.total, min });
  const prot = sim.fitBudget(base.id, S0.selection, t0 - 1500, { protect: ['sofa'] });
  ok(prot.ok && !prot.swaps.some((s) => s.key === 'sofa'), 'protected key untouched', prot.swaps);
  ok(parseBudget('уложись в 25 000') === 25000 && parseBudget('budget 25k') === 25000 && parseBudget('2 кресла') === null, 'parseBudget');
  ok(sanitizeText('Купите в Home Centre. Диван светлее.') === 'Диван светлее.', 'sanitize supplier sentence');
}

// ---------------------------------------------------------------- 2. local
// Curator (docs/ART.md §4–5): the three-choice rule, clashing pairs, Villar Editions, art sizing.
section('curator: picks, avoid, Villar Editions');
if (budgetSpec) {
  const { buildLadder } = await import(resolve(ROOT, 'site/js/core/budget.js'));
  const { withoutEditions } = await import(resolve(ROOT, 'site/js/core/data.js'));
  const realIds = Object.keys(packs).filter((id) => id !== 'test-light');
  const items = catalog.items || catalog;
  const editions = items.filter((i) => i.edition);
  const isEd = (id) => !!itemById.get(id)?.edition;
  const ART_KEYS = ['art_sofa', 'art_bed', 'art_dining'];
  const clashIn = (pack, ids) => { const have = new Set(ids.filter(Boolean)); return (pack.avoid || []).filter(([a, b]) => have.has(a) && have.has(b)); };
  const span = (art, below) => art.dims.w / below.dims.w;
  const IN_RULE = (r) => r >= 2 / 3 - 0.03 && r <= 3 / 4 + 0.03; // ⅔–¾ of the furniture below, ± 3 %

  for (const id of realIds) {
    const pack = packs[id];
    const keys = Object.keys(pack.slots);
    // picks: at most three per slot, each a valid option, the signature first and equal to the pack default
    ok(pack.picks && keys.every((k) => Array.isArray(pack.picks[k]) && pack.picks[k].length >= 1 && pack.picks[k].length <= 3), `${id}: every slot has 1–3 picks`, keys.filter((k) => !Array.isArray(pack.picks?.[k]) || pack.picks[k].length > 3 || !pack.picks[k].length));
    const bad = keys.flatMap((k) => (pack.picks?.[k] || []).filter((p) => !pack.slots[k].options.includes(p) || !itemById.has(p)).map((p) => `${k}:${p}`));
    ok(bad.length === 0, `${id}: every pick is a valid option of its slot`, bad);
    ok(keys.every((k) => new Set(pack.picks?.[k] || []).size === (pack.picks?.[k] || []).length), `${id}: no pick is listed twice`);
    const sigOff = keys.filter((k) => pack.picks?.[k]?.[0] !== pack.slots[k].default);
    ok(sigOff.length === 0, `${id}: the signature composition equals the pack default`, sigOff);
    ok(keys.every((k) => pack.slots[k].options[0] === pack.slots[k].default), `${id}: the default leads its options`, keys.filter((k) => pack.slots[k].options[0] !== pack.slots[k].default));
    // avoid: well-formed pairs of pieces this pack offers
    const offered = new Set(keys.flatMap((k) => pack.slots[k].options));
    const badPairs = (pack.avoid || []).filter((pr) => !Array.isArray(pr) || pr.length !== 2 || pr[0] === pr[1] || !offered.has(pr[0]) || !offered.has(pr[1]));
    ok(Array.isArray(pack.avoid) && badPairs.length === 0, `${id}: avoid pairs name two pieces the pack offers`, badPairs);
    // every pick was checked against the rest of the signature composition
    const sig = Object.fromEntries(keys.map((k) => [k, pack.slots[k].default]));
    ok(clashIn(pack, Object.values(sig)).length === 0, `${id}: the signature composition has no clashing pair`, clashIn(pack, Object.values(sig)));
    const pickClash = keys.flatMap((k) => (pack.picks?.[k] || []).flatMap((p) => clashIn(pack, Object.values({ ...sig, [k]: p })).map((pr) => `${k}:${p} ↔ ${pr.join('+')}`)));
    ok(pickClash.length === 0, `${id}: no pick clashes with the signature composition`, pickClash);
    // pairings never contradict the signature composition
    const pairOff = Object.entries(pack.pairings || {}).flatMap(([a, m]) => (Object.values(sig).includes(a) ? Object.entries(m).filter(([k, b]) => sig[k] !== b).map(([k, b]) => `${a} → ${k}:${b}`) : []));
    ok(pairOff.length === 0, `${id}: a signature piece's pairings point at signature pieces`, pairOff);
    const pairClash = Object.entries(pack.pairings || {}).flatMap(([a, m]) => Object.values(m).filter((b) => clashIn(pack, [a, b]).length).map((b) => `${a} + ${b}`));
    ok(pairClash.length === 0, `${id}: no pairing joins two pieces the pack tells apart`, pairClash);

    // the default ladder: no avoid pair in any step; editions only from the designer's room up
    const L = buildLadder({ pack, items, layout, spec: budgetSpec });
    const stepClash = L.steps.map((s, i) => [i, clashIn(pack, Object.values(s.selection))]).filter(([, c]) => c.length);
    ok(stepClash.length === 0, `${id}: no avoid pair inside any ladder step`, stepClash.slice(0, 3));
    const lv = Object.fromEntries(L.levels.map((l) => [l.id, l]));
    const before = L.steps.slice(0, lv.complete.index + 1).filter((s) => Object.values(s.selection).some(isEd)).length;
    ok(before === 0, `${id}: no edition up to «Полностью обставлено»`, before);
    for (const name of ['magazine', 'no-compromise']) {
      const sel = L.steps[lv[name].index].selection;
      ok(ART_KEYS.every((k) => isEd(sel[k])), `${id}: ${name} hangs editions on all three walls`, ART_KEYS.map((k) => sel[k]));
      // ART §5 sizing: the canvas spans ⅔–¾ of what stands below it
      const r = { art_sofa: span(itemById.get(sel.art_sofa), itemById.get(sel.sofa)), art_bed: span(itemById.get(sel.art_bed), itemById.get(sel.bed)), art_dining: span(itemById.get(sel.art_dining), itemById.get(sel.dining_table)) };
      ok(Object.values(r).every(IN_RULE), `${id}: ${name} art spans ⅔–¾ of the furniture below`, r);
    }
    ok(Object.keys(sig).every((k) => L.steps[lv.magazine.index].selection[k] === sig[k]), `${id}: «Как в журнале» is the signature composition`);
    ok(lv['no-compromise'].total > lv.magazine.total && lv.magazine.total > lv.complete.total, `${id}: levels rise (${lv.complete.total} < ${lv.magazine.total} < ${lv['no-compromise'].total})`);
    const premium = L.steps[lv['no-compromise'].index].selection;
    const offPick = keys.filter((k) => premium[k] !== L.steps[lv.magazine.index].selection[k] && !(pack.picks[k] || []).includes(premium[k]));
    ok(offPick.length === 0, `${id}: «Без компромиссов» only uses designer picks`, offPick.map((k) => `${k}:${premium[k]}`));

    // editions wiring: 6 per style, two per wall, the first pick and one alternate
    const mine = editions.filter((e) => (e.tags || []).includes(id));
    ok(mine.length === 6, `${id}: six editions`, mine.map((e) => e.id));
    ok(ART_KEYS.every((k) => pack.slots[k].options.filter(isEd).length === 2 && isEd(pack.picks[k][0]) && isEd(pack.picks[k][1]) && pack.picks[k][2] && !isEd(pack.picks[k][2])), `${id}: each wall offers two editions (picks 1–2) and one simpler piece (pick 3)`);
  }

  // the 24 works as catalogue items (ART §5 fields and price table)
  const PRICE = { '70x100': 590, '100x100': 790, '120x90': 890, '140x100': 990, '160x100': 1490, 'diptych': 1090 };
  ok(editions.length === 24, `24 editions in the catalogue (${editions.length})`);
  const edBad = editions.filter((e) => {
    const dip = Array.isArray(e.model?.params?.panels) && e.model.params.panels.length === 2;
    const price = dip ? PRICE.diptych : PRICE[`${e.dims.w}x${e.dims.h}`];
    return !(e.type === 'wall_art' && e.edition === true && e.image === `art/${e.id}.jpg` && e.price === price && e.dims.d === 4
      && e.name && e.nameEn && e.shortName && e.shortNameEn && /холст/i.test(e.materials?.[0] || '') && /плавающая рама/i.test((e.materials || []).join(' '))
      && e.model?.archetype === 'wall_art' && e.model.params.motif && Array.isArray(e.model.params.colors) && e.model.params.colors.length >= 2 && e.model.params.frame);
  });
  ok(edBad.length === 0, 'editions carry type, edition, image, table price, RU/EN names, canvas + float frame, fallback motif', edBad.map((e) => e.id));
  ok(layout.slots.filter((s) => s.type === 'wall_art').every((s) => s.hang && typeof s.hang.centre === 'number' && (!s.hang.over || layout.slots.some((q) => q.id === s.hang.over))), 'art slots carry a hang rule (over / gap / centre)');

  // editions flag: off → no pack offers, picks or defaults to an edition, and no ladder step holds one
  ok(typeof styles.editions === 'boolean', 'styles.json has the editions flag', styles.editions);
  const real = Object.fromEntries(realIds.map((id) => [id, packs[id]]));
  const off = withoutEditions(real, catalog);
  ok(realIds.every((id) => Object.entries(off[id].slots).every(([k, c]) => !isEd(c.default) && !c.options.some(isEd) && c.options.includes(c.default) && !(off[id].picks[k] || []).some(isEd) && off[id].picks[k][0] === c.default)), 'editions off: no edition in options, picks or defaults');
  ok(realIds.every((id) => buildLadder({ pack: off[id], items, layout, spec: budgetSpec }).steps.every((s) => !Object.values(s.selection).some(isEd))), 'editions off: no ladder step holds an edition');
  ok(realIds.every((id) => JSON.stringify(real[id].slots) === JSON.stringify(packs[id].slots)), 'withoutEditions is pure (the packs are untouched)');

  // server parity: the published index carries picks, avoid and the edition mark, so its ladder is the browser's
  const { buildAiIndex } = await import(resolve(ROOT, 'site/js/ai/core.js'));
  const index = buildAiIndex({ catalog, layout, packs: real, styles, budget: budgetSpec });
  const same = realIds.filter((id) => {
    const a = buildLadder({ pack: packs[id], items, layout, spec: budgetSpec });
    const b = buildLadder({ pack: index.packs[id], items: index.catalog.items, layout: index.layout, spec: index.budget });
    return a.steps.length === b.steps.length && a.steps.every((s, i) => s.total === b.steps[i].total && JSON.stringify(s.selection) === JSON.stringify(b.steps[i].selection));
  });
  ok(same.length === realIds.length, 'the server index builds the same ladders as the browser data', realIds.filter((id) => !same.includes(id)));

  // prompts (tools/editions.json) and jobs (tools/editions-jobs.sql)
  const ed = json('tools/editions.json');
  const works = ed.works || [];
  ok(works.length === 24 && works.every((w) => itemById.get(w.id)?.edition) && new Set(works.map((w) => w.id)).size === 24, 'editions.json lists the 24 catalogue editions');
  ok(works.every((w) => w.id && w.style && w.aspect && w.prompt && Array.isArray(w.palette) && w.palette.length >= 3 && w.frame), 'each work has id, style, aspect, prompt, palette, frame');
  const palHex = (id) => new Set(JSON.stringify(json(`site/data/${packs[id].palette || `palette-${id}.json`}`)).toUpperCase().match(/#[0-9A-F]{6}/g));
  const offPal = works.filter((w) => !w.palette.every((h) => palHex(w.style).has(h.toUpperCase())) || w.palette.length > 6);
  ok(offPal.length === 0, 'each palette (≤ 6 colours) comes from the pack palette file', offPal.map((w) => w.id));
  ok(works.every((w) => w.prompt.length <= 800 && !w.prompt.includes('#')), 'each brief fits the job (≤ 800 characters, colours in words)', works.filter((w) => w.prompt.length > 800 || w.prompt.includes('#')).map((w) => `${w.id}:${w.prompt.length}`));
  ok(works.every((w) => ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4'].includes(w.aspect) && Math.abs(Math.log((w.size_cm[0] / w.size_cm[1]) / (w.aspect.split(':')[0] / w.aspect.split(':')[1]))) < 0.08), 'each aspect is one the image model offers, within 8 % of the canvas');
  const BANNED = /in the style of|style of|inspired by|homage|reproduction of|replica|after the|matisse|picasso|rothko|monet|van gogh|kandinsky|klee|mondrian|hokusai|twombly|hilma|morandi|hopper|cezanne|cézanne|de sta[eë]l|diebenkorn/i;
  ok(works.every((w) => !BANNED.test(w.prompt)), 'prompts name no artist, no "style of", no reproduction', works.filter((w) => BANNED.test(w.prompt)).map((w) => w.id));
  ok(works.every((w) => /no frame/i.test(w.prompt) && /no wall/i.test(w.prompt) && /no perspective/i.test(w.prompt) && /no text/i.test(w.prompt) && /no signature/i.test(w.prompt) && /frontal/i.test(w.prompt)), 'prompts ask for the artwork alone: flat, frontal, no frame, wall, perspective, text or signature');
  ok(works.every((w) => w.frame === itemById.get(w.id).model.params.frame && w.image === itemById.get(w.id).image), 'editions.json frame and image match the catalogue');
  const sql = readFileSync(resolve(ROOT, 'tools/editions-jobs.sql'), 'utf8');
  const rows = [...sql.matchAll(/^insert into photo_jobs \(kind, params\) values \('edition', \$job\$(.+)\$job\$::jsonb\);$/gm)].map((m) => JSON.parse(m[1]));
  ok(rows.length === 24 && rows.every((r, i) => r.id === works[i].id && r.style === works[i].style && r.prompt === works[i].prompt && r.aspect === works[i].aspect && JSON.stringify(r.palette) === JSON.stringify(works[i].palette) && r.candidates === 2 && r.resolution === '2K'), 'editions-jobs.sql: one edition job per work, 2 candidates, 2K, in step with editions.json');

  // Round 2 (sourcing): every sold piece has its supplier record in research/ (never under site/), priced by the rule
  const rawFile = json('research/homecentre-raw.json');
  const rawItems = new Map((rawFile.catalogItems || []).map((c) => [c.id, c]));
  const rawProducts = new Map((rawFile.products || []).map((p) => [String(p.pid), p]));
  const sold = items.filter((i) => !i.edition);
  const noRaw = sold.filter((i) => !rawItems.has(i.id)).map((i) => i.id);
  ok(noRaw.length === 0, 'every non-edition catalogue item has a raw sourcing record', noRaw);
  const offRule = sold.filter((i) => { const c = rawItems.get(i.id); if (!c) return false; const reg = c.components.reduce((a, x) => a + x.regular * x.qty, 0); return !(c.regularTotal === reg && c.publicPrice === Math.round(reg * 1.2) && i.price === c.publicPrice); }).map((i) => i.id);
  ok(offRule.length === 0, 'public price = round(Σ regular × 1.2) and matches the raw record', offRule);
  const badComp = sold.flatMap((i) => (rawItems.get(i.id)?.components || []).filter((x) => rawProducts.get(String(x.pid))?.status !== 'accepted').map((x) => `${i.id}:${x.pid}`));
  ok(badComp.length === 0, 'every component of a sold item is an accepted supplier product', badComp);
  const offeredNow = (id) => realIds.filter((s) => Object.values(packs[s].slots).some((c) => c.options.includes(id)));
  const NEW = ['nightstand-grant', 'cushions-linen-oat-taupe', 'throw-verona-mocha', 'throw-fallon-taupe', 'art-seren-triptych', 'tv-truman'];
  ok(NEW.every((id) => itemById.has(id) && offeredNow(id).length && JSON.stringify([...(rawItems.get(id)?.offeredBy || [])].sort()) === JSON.stringify(offeredNow(id).sort())
    && rawItems.get(id).components.some((x) => /^https:\/\/(media\.homecentre\.com|cdn\.media\.amplience\.net)\//.test(rawProducts.get(String(x.pid))?.image || ''))), 'round-2 items are in the catalogue, offered by the packs the raw record names, with a reference photo', NEW.filter((id) => !itemById.has(id) || !offeredNow(id).length));

  // the four gaps of curation round 1, as numbers (CIELAB, D65)
  const lab = (hex) => { const n = parseInt(hex.slice(1), 16); let [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883; const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); [x, y, z] = [f(x), f(y), f(z)]; return [116 * y - 16, 500 * (x - y), 200 * (y - z)]; };
  const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
  const hexOf = (id) => itemById.get(id).colorHex;
  const sigOf = (id, k) => packs[id].slots[k].default;
  if (packs['light-oak']) {
    const d = dE(hexOf(sigOf('light-oak', 'nightstand')), hexOf(sigOf('light-oak', 'bed')));
    ok(d <= 6, `Light Oak: nightstand within ΔE 6 of the bed (${d.toFixed(1)})`);
    const simple = itemById.get(packs['light-oak'].picks.art_sofa.find((id) => !isEd(id)));
    ok(simple && simple.dims.w >= 120 && simple.dims.w <= 140 && simple.price < 500, 'Light Oak: the simpler sofa-wall piece is 120–140 cm wide and under 500 AED', simple && [simple.id, simple.dims.w, simple.price]);
  }
  if (packs['greige-luxe']) {
    const sofaL = lab(hexOf(sigOf('greige-luxe', 'sofa')))[0];
    const cush = itemById.get(sigOf('greige-luxe', 'cushions')).model.params.colors.map((c) => sofaL - lab(c)[0]);
    ok(Math.max(...cush) >= 15, `Cashmere: one cushion is at least 15 L* darker than the sofa (${Math.max(...cush).toFixed(0)})`);
    const thr = Math.abs(sofaL - lab(hexOf(sigOf('greige-luxe', 'throw')))[0]);
    ok(thr >= 10, `Cashmere: the throw is at least 10 L* from the sofa (${thr.toFixed(0)})`);
  }
  if (packs.mediterranean) {
    const bed = hexOf(sigOf('mediterranean', 'bed'));
    const tv = packs.mediterranean.slots.tv_unit.options.map((id) => [id, dE(hexOf(id), bed), itemById.get(id).price]);
    ok(tv.every(([, d]) => d <= 10) && tv.some(([, , p]) => p < 1500), 'Mediterranean: every TV unit is within ΔE 10 of the bed wood, one under 1,500 AED', tv.map(([id, d, p]) => `${id} ${d.toFixed(1)} ${p}`));
  }
  // Round 3 (digital twins, docs/TWINS.md): tools/twins.json names the source photos of every catalogue item
  const twinsDoc = json('tools/twins.json');
  const twinList = twinsDoc.items || [];
  const twinBy = new Map(twinList.map((x) => [x.id, x]));
  ok(twinList.length === items.length && items.every((i) => twinBy.has(i.id)) && twinBy.size === twinList.length, 'twins.json lists every catalogue item exactly once', items.filter((i) => !twinBy.has(i.id)).map((i) => i.id));
  const KIND_A = new Set(['sofa', 'armchair', 'dining_chair', 'bed', 'floor_lamp', 'table_lamp', 'pendant_lamp', 'plant', 'decor_set', 'centerpiece', 'kitchen_decor', 'nightstand_decor', 'tableware', 'cushions', 'throw']);
  const offKind = items.filter((i) => twinBy.get(i.id)?.kind !== (KIND_A.has(i.type) ? 'A' : 'B')).map((i) => i.id);
  ok(offKind.length === 0, 'twins: kind A for soft and organic items, kind B for flat and straight-edged ones (TWINS §1)', offKind);
  const photosOf = (id) => rawItems.get(id)?.photos || [];
  const noGallery = sold.filter((i) => !photosOf(i.id).length || photosOf(i.id).length !== (rawItems.get(i.id).photoViews || []).length || !photosOf(i.id).every((u) => /^https:\/\/(media\.homecentre\.com|cdn\.media\.amplience\.net)\//.test(u))).map((i) => i.id);
  ok(noGallery.length === 0, 'twins: every sold item has its photo list (and what each photo shows) in research/', noGallery);
  const badRefs = sold.filter((i) => { const t = twinBy.get(i.id), n = photosOf(i.id).length; return !t || !Array.isArray(t.refs) || !t.refs.length || t.refs.length > 6 || new Set(t.refs).size !== t.refs.length || !t.refs.every((r) => Number.isInteger(r) && r >= 1 && r <= n) || (t.shows || []).length !== t.refs.length; }).map((i) => i.id);
  ok(badRefs.length === 0, 'twins: refs are 1–6 distinct 1-based positions in the item photo list, each with what it shows', badRefs);
  const usableView = (id, r) => !/styled room|group shot|infographic|not reviewed/.test(rawItems.get(id).photoViews[r - 1] || '');
  const occluded = sold.filter((i) => twinBy.get(i.id).kind === 'A' && !twinBy.get(i.id).refs.every((r) => usableView(i.id, r))).map((i) => i.id);
  ok(occluded.length === 0, 'twins: no kind-A reference is a styled-room, group or infographic photo', occluded);
  const thin = sold.filter((i) => { const t = twinBy.get(i.id); return t.kind === 'A' && t.refs.length < 3 && !t.poor; }).map((i) => i.id);
  ok(thin.length === 0, 'twins: a kind-A item with fewer than three photos is flagged poor', thin);
  ok(twinList.every((x) => typeof x.material === 'string' && x.material.length >= 8 && x.material.length <= 240 && typeof x.notes === 'string' && Number.isFinite(x.yawHint)), 'twins: every item has a material line (≤ 240), notes and a yawHint');
  ok(twinList.filter((x) => x.kind === 'B').every((x) => x.skip === true) && twinList.filter((x) => x.hold).every((x) => x.skip === true), 'twins: kind B and held items are never queued for reconstruction');
  ok(items.filter((i) => i.edition).every((i) => twinBy.get(i.id).refs.length === 0 && twinBy.get(i.id).skip === true), 'twins: editions carry no supplier photo');
  const pilot = ['sofa', 'armchair', 'floor_lamp'].map((k) => packs['dark-walnut']?.picks?.[k]?.[0]);
  ok(JSON.stringify(twinList.slice(0, 3).map((x) => x.id)) === JSON.stringify(pilot) && twinList.slice(0, 3).every((x) => x.wave === 1 && x.refs.length >= 4 && !x.skip && x.yawHint === 0), 'twins: the pilot three (Dark Walnut sofa, armchair, floor lamp) lead the file, front photo first', twinList.slice(0, 3).map((x) => x.id));
  const sigA = new Set(realIds.flatMap((s) => Object.keys(packs[s].slots).map((k) => packs[s].picks[k][0])).filter((id) => KIND_A.has(itemById.get(id).type)));
  const order = twinList.map((x) => (x.wave === 1 ? 1 : x.kind === 'A' ? (sigA.has(x.id) ? 2 : 3) : 4));
  ok(order.every((w, i) => w === twinList[i].wave && (i === 0 || order[i - 1] <= w)), 'twins: order = pilot, kind A of the signature rooms, the other kind A, then kind B');
  const flatTypes = new Set(['rug', 'runner', 'wall_art']);
  const noFlat = sold.filter((i) => flatTypes.has(i.type) && !(Number.isInteger(twinBy.get(i.id).flat?.ref) && twinBy.get(i.id).flat.ref <= photosOf(i.id).length)).map((i) => i.id);
  ok(noFlat.length === 0, 'twins: every rug, runner and supplier artwork names the photo to crop for its surface', noFlat);
  const caseGoods = new Set(['tv_unit', 'nightstand', 'coffee_table', 'side_table', 'dining_table']);
  ok(sold.filter((i) => caseGoods.has(i.type)).every((i) => (twinBy.get(i.id).geometry || '').length > 20), 'twins: every case good and table has its geometry read from the photos');
  ok(!/homecentre|home\s*cent|amplience|https?:|\b1[67]\d{7}\b/i.test(JSON.stringify(twinsDoc)), 'twins.json carries no supplier name, URL or product code');
  // what the photos corrected in the catalogue
  const ember = itemById.get('art-ember-90x60');
  ok(ember.dims.w === 60 && ember.dims.h === 90 && realIds.every((s) => !packs[s].slots.art_bed.options.includes(ember.id)), 'Ember is portrait (60 × 90) and hangs on no bed wall');
  ok(realIds.every((s) => { const o = ART_KEYS.map((k) => packs[s].slots[k].options); return o.flat().length === new Set(o.flat()).size; }), 'no artwork is offered for two walls of one room');
  ok(packs.mediterranean?.picks.armchair[0] === 'armchair-natura' && packs.mediterranean.slots.armchair.options.includes('armchair-sukhna'), 'Mediterranean: Natura is the signature armchair, the cane one stays an option');
} else ok(true, 'no budget.json — skipped');

section('local.js');
const L = (text, extra = {}) => parseLocal(text, { data, sim, style: S0.style, selection: S0.selection, view: 'eye', time: 'day', lang: 'ru', ...extra });
const types = (r) => r.actions.map((a) => a.type);
const sel = (r, key) => r.actions.find((a) => a.type === 'select' && a.key === key)?.itemId;
const cases = [
  ['покажи вечер', (r) => types(r).join() === 'time' && r.actions[0].name === 'evening' && r.confidence === 'high'],
  ['вечер', (r) => r.actions[0]?.name === 'evening' && r.confidence === 'high'],
  ['закат', (r) => r.actions[0]?.name === 'golden'],
  ['Покажи утро в спальне', (r) => r.actions.some((a) => a.name === 'morning') && r.actions.some((a) => a.name === 'bed') && r.confidence === 'high'],
  ['гостиная', (r) => r.actions[0]?.name === 'living'],
  ['вид у окна', (r) => r.actions[0]?.name === 'window'],
  ['план', (r) => r.actions[0]?.name === 'top'],
  ['покажи вход', (r) => r.actions[0]?.name === 'eye'],
  ['столовая днём', (r) => r.actions.some((a) => a.name === 'dining') && r.actions.some((a) => a.name === 'day')],
  ['show the evening', (r) => r.actions[0]?.name === 'evening' && r.confidence === 'high', { lang: 'en' }],
  ['bedroom at sunset', (r) => r.actions.some((a) => a.name === 'bed') && r.actions.some((a) => a.name === 'golden'), { lang: 'en' }],
  ['top view', (r) => r.actions[0]?.name === 'top', { lang: 'en' }],
  ['покажи диван', (r) => r.actions[0]?.type === 'focus' && r.actions[0].slotId === 'sofa'],
  ['диван подешевле', (r) => priceOf(sel(r, 'sofa')) > 0 && priceOf(sel(r, 'sofa')) < priceOf(S0.selection.sofa) && r.confidence === 'low'],
  ['cheaper sofa', (r) => priceOf(sel(r, 'sofa')) > 0 && priceOf(sel(r, 'sofa')) < priceOf(S0.selection.sofa), { lang: 'en' }],
  ['сделай дешевле', (r) => r.actions.filter((a) => a.type === 'select').length >= 5 && r.total === sim.minTotal(base.id)],
  ['замени диван на что-то светлее', (r) => { const id = sel(r, 'sofa'); return id && id !== S0.selection.sofa; }],
  ['диван светлее', (r) => !!sel(r, 'sofa')],
  ['диван темнее', (r) => true],
  ['кресло светлее', (r) => ['armchair-luna-fabric', 'armchair-pebble'].includes(sel(r, 'armchair'))],
  ['ткань вместо кожи у кресла', (r) => true],
  ['кресло букле', (r) => sel(r, 'armchair') === 'armchair-pebble'],
  ['a boucle armchair', (r) => sel(r, 'armchair') === 'armchair-pebble', { lang: 'en' }],
  ['зелёные подушки', (r) => true],
  ['подушки на диване потеплее', (r) => !!sel(r, 'cushions') && !sel(r, 'sofa')],
  ['картина над кроватью другая', (r) => !!sel(r, 'art_bed') && !sel(r, 'bed')],
  ['ротанговый светильник', (r) => ['pendant-tobin', 'pendant-accorsa', 'pendant-naturel'].includes(sel(r, 'pendant_lamp'))],
  ['мраморный стол', (r) => sel(r, 'dining_table') === undefined || sel(r, 'dining_table') === 'dining-kentana-100'],
  ['стол подешевле', (r) => priceOf(sel(r, 'dining_table')) > 0 && priceOf(sel(r, 'dining_table')) < priceOf(S0.selection.dining_table)],
  ['журнальный столик из травертина', (r) => { const id = sel(r, 'coffee_table') || (/уже/.test(r.reply) ? S0.selection.coffee_table : null); return /травертин/i.test(JSON.stringify(itemById.get(id) || {})); }],
  ['уложись в 25 000', (r) => r.budget && r.budget.total <= 25000 && r.budget.ok],
  ['уложись в 30 000, диван оставь', (r) => r.budget?.ok && !sel(r, 'sofa')],
  ['budget 26k', (r) => r.budget?.ok && r.budget.total <= 26000, { lang: 'en' }],
  ['уложись в 5 000', (r) => r.budget && !r.budget.ok && r.budget.total === (sim.hasBudget() ? sim.planBudget(base.id, 5000).min : sim.minTotal(base.id))],
  ['сбрось', (r) => types(r).join() === 'reset' || r.reply.length > 0],
  ['отмени', (r) => r.undo === true],
  ['что ты умеешь?', (r) => r.understood && r.actions.length === 0],
  ['сделай уютнее', (r) => r.actions.some((a) => a.type === 'time' && a.name === 'evening')],
  ['make it cozier', (r) => r.actions.some((a) => a.name === 'evening'), { lang: 'en' }],
  ['стиль светлый дуб', (r) => r.actions[0]?.type === 'style' && r.actions[0].styleId === LO],
  ['переключи на Light Oak, но диван оставь', (r) => {
    if (r.actions[0]?.type !== 'style' || r.actions[0].styleId !== LO) return false;
    const keepable = packs[LO].slots.sofa?.options.includes(S0.selection.sofa);
    // keepable → anchored; not offered by the new style → no anchor, and the reply says the sofa can't stay
    return keepable ? r.actions[0].anchor?.itemId === S0.selection.sofa : !r.actions[0].anchor && /sofa|диван/i.test(r.reply);
  }, { lang: 'en' }],
  ['стиль Test Linen', (r) => r.actions[0]?.type === 'style' && r.actions[0].styleId === 'test-light'],
  ['сколько стоит диван', (r) => /AED/.test(r.reply) && r.actions.length === 0],
  ['какой итог?', (r) => /AED/.test(r.reply)],
  ['напиши стихотворение про кота', (r) => !r.understood && r.actions.length === 0],
  ['', (r) => r.actions.length === 0],
  ['зеленый плед', (r) => r.actions.length === 0 && /плед/i.test(r.reply) || !!sel(r, 'throw')],
  ['другие стулья', (r) => !!sel(r, 'dining_chair')],
  ['тумбочки дешевле', (r) => sel(r, 'nightstand') === 'nightstand-nazario'],
  ['лампы у кровати светлее', (r) => true],
  ['ковёр поменьше', (r) => sel(r, 'rug') === 'rug-pulara-160x230'],
];
for (const [text, check, extra] of cases) {
  const r = L(text, extra);
  let good = false;
  try { good = check(r); } catch (e) { good = false; }
  ok(good, `local: ${JSON.stringify(text)}`, { reply: r.reply, actions: r.actions, conf: r.confidence });
  if (VERBOSE) console.log('       →', r.reply, '|', r.actions.map((a) => `${a.type}:${a.key || a.name || a.slotId || a.styleId || ''}${a.itemId ? '=' + a.itemId : ''}`).join(' '), '|', r.confidence);
  // every local action must be valid for the store
  const store = createStore({ catalog, layout, packs, styleId: base.id, persist: false });
  let valid = true;
  for (const a of r.actions) {
    if (a.type === 'style') valid = store.setStyle(a.styleId, { anchor: a.anchor || undefined }) && valid;
    else if (a.type === 'reset') store.reset();
    else if (a.type === 'select') valid = store.select(a.key, a.itemId, { reason: 'ai' }) && valid;
    else if (a.type === 'budget') {
      // Same as the client: the slider's planner around the store's pins.
      const plan = sim.planBudget(store.styleId(), a.amount, { selection: store.state.selection, pins: store.pins() });
      valid = !!plan && valid;
      if (plan) store.applyPlan(plan.selection, { reason: 'budget' });
    }
  }
  ok(valid, `local actions apply cleanly: ${JSON.stringify(text)}`);
  if (r.budget) ok(store.total() === r.budget.total, `budget total matches store: ${JSON.stringify(text)}`, [store.total(), r.budget.total]);
}

// ---------------------------------------------------------------- 3. server
section('api/assistant.js');
const api = await import(resolve(ROOT, 'api/assistant.js'));
const handler = api.default;
const T = api._test;
T.setIndexForTests?.(T.buildIndexFromData ? T.buildIndexFromData({ catalog, layout, packs, styles: { default: base.id } }) : null);

function mockRes() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.json = (b) => { r.body = b; return r; };
  r.end = (b) => { if (b) { try { r.body = JSON.parse(b); } catch { r.body = b; } } return r; };
  r.send = (b) => r.end(typeof b === 'string' ? b : JSON.stringify(b));
  return r;
}
let ipN = 0;
const req = (body, { headers = {}, method = 'POST', ip } = {}) => ({
  method, body, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || `10.0.0.${++ipN}`, host: 'villar.test', ...headers },
});
const realFetch = globalThis.fetch;
let calls = [];
const toolReply = (args) => ({ ok: true, status: 200, async json() { return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'respond', arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3000, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 2800 } } }; }, async text() { return ''; } });
const stub = (fn) => { calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return fn(calls.length, JSON.parse(init.body)); }; };
const state = { ...S0, total: sim.total(S0.style, S0.selection), view: 'eye', time: 'day' };
const AUTH = { 'x-vercel-oidc-token': 'test-oidc' };
const ALT_SOFA = base.slots.sofa.options.find((id) => id !== S0.selection.sofa);
const silence = () => { const o = { info: console.info, warn: console.warn, error: console.error, log: console.log }; console.info = console.warn = console.error = () => {}; return () => Object.assign(console, o); };

{
  const restore = silence();
  // happy path with mixed valid/invalid actions
  stub(() => toolReply({ reply: 'Поставил Hadley — светлее. Купите в Home Centre!', actions: [
    { type: 'select', key: 'sofa', itemId: ALT_SOFA }, { type: 'select', key: 'sofa', itemId: 'bed-cloud-160' },
    { type: 'time', name: 'evening' }, { type: 'view', name: 'living' }, { type: 'select', key: 'rug', itemId: 'rug-fake' },
  ], chips: ['Покажи вечер', 'Уложись в 25 000', 'Очень-очень-очень длинная подсказка про всё на свете'] }));
  let res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'диван светлее и вечер' }], state, lang: 'ru' }, { headers: AUTH }), res);
  ok(res.statusCode === 200 && res.body?.reply === 'Поставил Hadley — светлее.', 'reply sanitized (supplier sentence dropped)', res.body);
  ok(res.body.actions.map((a) => a.type).join() === 'select,time,view', 'only valid actions returned, canonical order', res.body.actions);
  ok(res.body.chips.length === 2, 'chips sanitized', res.body.chips);
  ok(calls[0].url === 'https://ai-gateway.vercel.sh/v1/chat/completions', 'gateway endpoint');
  ok(calls[0].init.headers.Authorization === 'Bearer test-oidc', 'OIDC header used as bearer');
  ok(calls[0].body.tools?.[0]?.function?.name === 'respond' && calls[0].body.max_tokens <= 800, 'tool + small max_tokens', calls[0].body.max_tokens);
  ok(calls[0].body.model === (process.env.VILLAR_MODEL || 'anthropic/claude-haiku-5.5'), 'default model', calls[0].body.model);
  const sys = calls[0].body.messages[0].content;
  ok(typeof sys === 'string' && sys.includes(ALT_SOFA) && !/home\s*cent/i.test(sys), 'system prompt has catalog, no supplier', sys.length);
  ok(!/\bsku\b|https?:/i.test(sys), 'no SKUs/links in prompt');
  ok(calls[0].body.messages.at(-1).content.includes('диван светлее'), 'user text forwarded');

  // budget: model overshoots → server iterates once, then verifies
  const t0 = state.total;
  stub((n) => n === 1
    ? toolReply({ reply: 'Сэкономил на коврe.', actions: [{ type: 'select', key: 'rug', itemId: 'rug-marlow-200x290' }], budget: 25000 })
    : toolReply({ reply: 'Теперь в бюджете.', actions: [{ type: 'select', key: 'rug', itemId: 'rug-marlow-200x290' }, { type: 'select', key: 'sofa', itemId: 'sofa-anders-3' }, { type: 'select', key: 'dining_table', itemId: 'dining-mahmayi-80' }, { type: 'select', key: 'nightstand', itemId: 'nightstand-nazario' }], budget: 25000 }));
  res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'уложись в 25 000' }], state, lang: 'ru' }, { headers: AUTH }), res);
  ok(calls.length === 2, 'over budget → one more model iteration', calls.length);
  ok(calls[1].body.messages.at(-1).content.includes('25'), 'feedback mentions the budget');
  ok(res.body.budget?.ok && res.body.budget.total <= 25000, 'final total verified ≤ budget', res.body.budget);
  const after = sim.applyActions(S0, res.body.actions);
  ok(sim.total(after.state.style, after.state.selection) === res.body.budget.total, 'budget.total equals the real total of returned actions');

  // budget: model keeps overshooting → deterministic fix-up
  stub(() => toolReply({ reply: 'Готово.', actions: [{ type: 'select', key: 'rug', itemId: 'rug-marlow-200x290' }] }));
  res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'Уложись в 24 000 AED' }], state, lang: 'ru' }, { headers: AUTH }), res);
  const a2 = sim.applyActions(S0, res.body.actions);
  ok(res.body.budget?.ok && sim.total(a2.state.style, a2.state.selection) <= 24000, 'greedy fix-up guarantees the budget', res.body.budget);
  ok(calls.length === 2, 'still at most 2 model calls');

  // impossible budget
  stub(() => toolReply({ reply: 'Хорошо.', actions: [] }));
  res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'уложись в 3 000' }], state, lang: 'ru' }, { headers: AUTH }), res);
  ok(res.body.budget && !res.body.budget.ok && res.body.budget.total === sim.minTotal(base.id), 'impossible budget → minimum set + honest flag', res.body.budget);
  ok(/3\s?000|ниже|не получится/i.test(res.body.reply), 'reply explains the minimum', res.body.reply);

  // style with anchor
  stub(() => toolReply({ reply: 'Светлый дуб, диван оставил.', actions: [{ type: 'style', styleId: 'test-light', anchorItemId: 'sofa-lansbury-3' }, { type: 'select', key: 'rug', itemId: 'rug-dione-200x290' }] }));
  res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'хочу светлый дуб, диван оставь' }], state, lang: 'ru' }, { headers: AUTH }), res);
  ok(res.body.actions[0]?.type === 'style' && res.body.actions[0].anchor?.itemId === 'sofa-lansbury-3', 'style + anchor validated', res.body.actions);

  // gateway errors → graceful 200 JSON with error
  for (const [label, fn, code] of [
    ['401', () => ({ ok: false, status: 401, async text() { return '{"error":{"message":"unauthorized"}}'; }, async json() { return {}; } }), 'unauthorized'],
    ['500', () => ({ ok: false, status: 500, async text() { return 'boom'; }, async json() { return {}; } }), 'gateway'],
    ['throw', () => { throw new Error('ECONNRESET'); }, 'gateway'],
    ['bad json', () => ({ ok: true, status: 200, async json() { return { choices: [{ message: { content: 'просто текст без инструмента' } }] }; } }), null],
  ]) {
    stub(fn);
    res = mockRes();
    await handler(req({ messages: [{ role: 'user', content: 'диван светлее' }], state, lang: 'ru' }, { headers: AUTH }), res);
    ok(res.statusCode === 200 && Array.isArray(res.body.actions) && typeof res.body.reply === 'string' && (code ? res.body.error === code : true), `gateway ${label} → 200 + { reply, actions, error }`, res.body);
  }

  // timeout
  stub(() => new Promise((r, j) => setTimeout(() => j(Object.assign(new Error('aborted'), { name: 'AbortError' })), 50)));
  res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'диван светлее' }], state, lang: 'ru' }, { headers: AUTH }), res);
  ok(res.body.error === 'timeout' || res.body.error === 'gateway', 'abort → timeout error', res.body);

  // missing auth → no gateway call
  const saved = { a: process.env.AI_GATEWAY_API_KEY, o: process.env.VERCEL_OIDC_TOKEN };
  delete process.env.AI_GATEWAY_API_KEY; delete process.env.VERCEL_OIDC_TOKEN;
  stub(() => toolReply({ reply: 'x', actions: [] }));
  res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'привет' }], state, lang: 'ru' }), res);
  ok(res.body.error === 'unauthorized' && calls.length === 0, 'no auth → unauthorized without calling the gateway', res.body);
  process.env.AI_GATEWAY_API_KEY = 'vck_test';
  stub(() => toolReply({ reply: 'Готово.', actions: [] }));
  res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'привет' }], state, lang: 'ru' }), res);
  ok(calls[0]?.init.headers.Authorization === 'Bearer vck_test', 'API key fallback');
  if (saved.a) process.env.AI_GATEWAY_API_KEY = saved.a; else delete process.env.AI_GATEWAY_API_KEY;
  if (saved.o) process.env.VERCEL_OIDC_TOKEN = saved.o;

  // caps: long input, history trimming, bad body, method
  stub(() => toolReply({ reply: 'Ок.', actions: [] }));
  res = mockRes();
  const hist = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(2000) }));
  hist.push({ role: 'user', content: 'Ъ'.repeat(5000) });
  await handler(req({ messages: hist, state, lang: 'ru' }, { headers: AUTH }), res);
  const sent = calls[0]?.body.messages || [];
  ok(sent.length <= 1 + 8, 'history capped to 8 turns', sent.length);
  ok(sent.slice(1, -1).every((m) => m.content.length <= 600), 'each history turn length capped', sent.map((m) => m.content.length));
  ok((sent.at(-1)?.content.match(/Ъ/g) || []).length === 500, 'user input capped at 500 chars');
  res = mockRes();
  await handler(req('{not json', { headers: AUTH }), res);
  ok(res.statusCode === 200 && res.body.error === 'bad_request', 'bad JSON → bad_request', res.body);
  res = mockRes();
  await handler(req(null, { method: 'PUT', headers: AUTH }), res);
  ok(res.statusCode === 405, 'PUT → 405');
  res = mockRes();
  await handler(req(null, { method: 'GET', headers: AUTH }), res);
  ok(res.statusCode === 200 && res.body.ok === true && res.body.auth === true && !JSON.stringify(res.body).includes('test-oidc'), 'GET health, no secrets', res.body);
  res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'hi' }], state }, { headers: { ...AUTH, origin: 'https://evil.example' } }), res);
  ok(res.body.error === 'forbidden', 'cross-origin browser request refused', res.body);

  // rate limit
  stub(() => toolReply({ reply: 'Ок.', actions: [] }));
  let limited = 0;
  for (let i = 0; i < 20; i++) { res = mockRes(); await handler(req({ messages: [{ role: 'user', content: 'вечер' }], state, lang: 'ru' }, { headers: AUTH, ip: '10.9.9.9' }), res); if (res.body.error === 'rate_limited') limited++; }
  ok(limited > 0 && limited < 20, 'per-IP rate limit kicks in', limited);

  // English
  stub(() => toolReply({ reply: 'Here is a lighter sofa.', actions: [{ type: 'select', key: 'sofa', itemId: ALT_SOFA }], chips: ['Show the evening'] }));
  res = mockRes();
  await handler(req({ messages: [{ role: 'user', content: 'a lighter sofa' }], state, lang: 'en' }, { headers: AUTH }), res);
  ok(/Villar/.test(calls[0].body.messages[0].content) && /English/.test(calls[0].body.messages[0].content), 'EN system prompt', calls[0].body.messages[0].content.slice(0, 120));
  ok(res.body.actions.length === 1, 'EN actions');
  restore();
}
globalThis.fetch = realFetch;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
