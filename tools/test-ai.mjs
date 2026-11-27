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
  ['уложись в 5 000', (r) => r.budget && !r.budget.ok && r.budget.total === sim.minTotal(base.id)],
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
    else if (a.type === 'select') valid = store.select(a.key, a.itemId) && valid;
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
