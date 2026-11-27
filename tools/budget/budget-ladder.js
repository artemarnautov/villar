// Villar budget ladder: reference implementation of research/budget-tiers.md (scratch, not deployed).
// Usage: node /tmp/villar-budget/budget-ladder.js [--spec=path] [--contract] [--steps] [--out=path]
//   --contract  literal docs/BUDGET.md variant, for comparison: tier 1+ enters at the curated item, no blackout step.
//   --steps     print every step.
// Reads site/data/{catalog,layout-studio,stylepack-*}.json and the spec JSON. Prices are public AED (catalog `price`).
const fs = require('fs');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const D = '/home/claude/villar/site/data/';
const SPEC = JSON.parse(fs.readFileSync(arg('spec', '/tmp/villar-budget/budget-spec.json'), 'utf8'));
const CONTRACT = flag('contract');
const catalog = JSON.parse(fs.readFileSync(D + 'catalog.json', 'utf8'));
const layout = JSON.parse(fs.readFileSync(D + 'layout-studio.json', 'utf8'));
const styles = JSON.parse(fs.readFileSync(D + 'styles.json', 'utf8')).packs.map((p) => p.id);
const items = new Map(catalog.items.map((i) => [i.id, i]));
const keyOf = (p, s) => (p.slots[s.id] && s.id) || (s.group && p.slots[s.group] && s.group) || s.type;
const FURN = new Set(SPEC.furniture);
const FUNC = new Map(SPEC.functional.map((f) => [f.id, f]));
const matches = (it, m) => new RegExp(m.pattern, 'i').test(String(it[m.field] || ''));

function buildLadder(packId) {
  const p = JSON.parse(fs.readFileSync(`${D}stylepack-${packId}.json`, 'utf8'));
  const qty = {};
  for (const s of layout.slots) { const k = keyOf(p, s); qty[k] = (qty[k] || 0) + 1; }
  for (const k of Object.keys(SPEC.tiers)) if (!p.slots[k]) throw new Error(`${packId}: spec key ${k} missing in pack`);
  const curated = (k) => items.get(p.slots[k].default);
  const opts = (k) => p.slots[k].options.map((id) => items.get(id)).filter(Boolean)
    .sort((a, b) => a.price - b.price || (b.id === p.slots[k].default) - (a.id === p.slots[k].default));
  const cheapest = (k) => opts(k)[0];
  const sel = {}; const steps = []; let run = 0;
  const total = () => Object.entries(sel).reduce((a, [k, it]) => a + it.price * qty[k], 0);
  const snapshot = () => Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, v.id]));
  const commit = (label, kind, tier, changes) => {
    const delta = [];
    for (const [k, it] of changes) { if (sel[k]?.id !== it.id) delta.push({ key: k, from: sel[k]?.id || null, to: it.id }); sel[k] = it; }
    if (!delta.length) return;
    const t = total(); steps.push({ label, kind, tier, add: t - run, total: t, delta, selection: snapshot() }); run = t;
  };
  const pairFor = (k) => { // forward furniture pairing from what is already in the room
    if (!FURN.has(k)) return null;
    for (const [k2, it] of Object.entries(sel)) {
      const want = FURN.has(k2) && p.pairings?.[it.id]?.[k];
      if (want && p.slots[k].options.includes(want)) return items.get(want);
    }
    return null;
  };
  const entry = (k, tier) => {
    if (tier === 0) return cheapest(k);
    if (CONTRACT) return curated(k);
    const paired = pairFor(k); if (paired) return paired;
    if (!FURN.has(k)) return curated(k);
    if (k === 'rug') {
      const c = cheapest(k); const r = opts(k).find((i) => i.dims?.w >= SPEC.entry.rug.preferWidthCmAtLeast);
      return r && r.price <= SPEC.entry.rug.ifPriceAtMost * c.price ? r : c;
    }
    return cheapest(k);
  };
  const withCompanions = (k, it) => {
    const ch = [[k, it]];
    for (const [k2, id] of Object.entries(p.pairings?.[it.id] || {}))
      if (sel[k2] && FURN.has(k) && FURN.has(k2) && p.slots[k2].options.includes(id)) ch.push([k2, items.get(id)]);
    return ch;
  };
  const grouped = new Map(); for (const g of SPEC.groups) for (const k of g) grouped.set(k, g);
  const keptByFunction = (k) => !CONTRACT && SPEC.functional.some((f) => f.key === k && f.keepAboveCurated && sel[k] && matches(sel[k], f.match));

  // 1. minimum = tier 0
  commit('minimum (tier 0)', 'min', 0, SPEC.order['0'].map((k) => [k, entry(k, 0)]));
  // 2. adds, tier by tier
  for (const t of [1, 2, 3, 4]) {
    for (const k of SPEC.order[String(t)]) {
      if (k.startsWith('@')) {
        const f = FUNC.get(k.slice(1));
        if (!CONTRACT && f) { const it = opts(f.key).find((i) => matches(i, f.match)); if (it && it.price > sel[f.key].price) commit(`${f.key} → ${f.match.pattern}`, 'func', t, [[f.key, it]]); }
        continue;
      }
      if (sel[k]) continue; // already added with its group
      const g = grouped.get(k) || [k]; const ch = [];
      for (const gk of g) { const it = entry(gk, t); ch.push([gk, it]); sel[gk] = it; } // later group members see earlier ones
      for (const gk of g) delete sel[gk];
      commit('+ ' + g.join(' + '), 'add', t, ch);
    }
  }
  const complete = run;
  // 3. heroes → curated (companions in the same step), then tidy the rest
  for (const k of SPEC.heroes) if (!keptByFunction(k) && sel[k].id !== curated(k).id) commit(`↑ ${k} → curated`, 'upg', 5, withCompanions(k, curated(k)));
  for (const k of SPEC.premiumOrder) if (!keptByFunction(k) && sel[k].id !== curated(k).id) commit(`↑ ${k} → curated`, 'upg', 5, [[k, curated(k)]]);
  const designer = run;
  // 4. premium, pairing-safe
  const conflicts = (k, m) => {
    if (!FURN.has(k)) return false;
    for (const [k2, it2] of Object.entries(sel)) { if (k2 === k) continue; const w = FURN.has(k2) && p.pairings?.[it2.id]?.[k]; if (w && w !== m.id) return true; }
    for (const [k2, w] of Object.entries(p.pairings?.[m.id] || {})) if (sel[k2] && FURN.has(k2) && sel[k2].id !== w && items.get(w).price < sel[k2].price) return true;
    return false;
  };
  for (const k of SPEC.premiumOrder) {
    const m = opts(k).filter((i) => i.price > sel[k].price).sort((a, b) => b.price - a.price).find((c) => !conflicts(k, c));
    if (m) commit(`↑ ${k} → premium`, 'prem', 6, withCompanions(k, m));
  }

  // checks
  const problems = [];
  steps.forEach((s, i) => {
    for (const [k, deps] of Object.entries(SPEC.requires)) if (s.selection[k]) for (const d of deps) if (!s.selection[d]) problems.push(`step ${i}: ${k} without ${d}`);
    for (const [k, id] of Object.entries(s.selection)) for (const [k2, w] of Object.entries(p.pairings?.[id] || {}))
      if (FURN.has(k) && FURN.has(k2) && s.selection[k2] && s.selection[k2] !== w) problems.push(`step ${i}: pairing ${id}→${k2}=${w} broken`);
    if (i && s.add <= 0) problems.push(`step ${i}: not monotonic (${s.add})`);
  });
  const designerSel = steps.find((s) => s.total === designer)?.selection || {};
  const offCurated = Object.keys(p.slots).filter((k) => designerSel[k] !== p.slots[k].default);
  const endOfTier = (t) => { const s = steps.filter((x) => x.tier <= t && (x.kind === 'min' || x.kind === 'add' || x.kind === 'func')); return s[s.length - 1].total; };
  const milestones = { 'tier:0': steps[0].total, 'endOfTier:1': endOfTier(1), 'endOfTier:2': endOfTier(2), 'endOfTier:3': endOfTier(3), 'endOfTier:4': complete, designer, premium: run };
  const levels = SPEC.levels.map((l) => ({ id: l.id, name: l.name, nameEn: l.nameEn, milestone: l.milestone, total: milestones[l.milestone],
    index: steps.findIndex((s) => s.total === milestones[l.milestone]) }));
  const curatedTotal = Object.keys(p.slots).reduce((a, k) => a + curated(k).price * qty[k], 0);
  return { packId, steps, milestones, levels, curatedTotal, offCurated, problems, minIndex: 0, maxIndex: steps.length - 1,
    defaultIndex: steps.findIndex((s) => s.total === designer) };
}

/** Last step with total ≤ budget (clamped to the minimum). */
const ladderIndexFor = (ladder, budget) => { let i = 0; ladder.steps.forEach((s, j) => { if (s.total <= budget) i = j; }); return i; };

const out = {};
for (const id of styles) {
  const L = buildLadder(id); out[id] = L;
  const f = (n) => n.toLocaleString('en-US').replace(/,/g, ' ');
  console.log(`\n=== ${id}${CONTRACT ? ' (contract variant)' : ''}: ${L.steps.length} steps, problems: ${L.problems.length}`
    + `, designer state off-curated: [${L.offCurated.join(', ')}] (curated room as shipped ${f(L.curatedTotal)})`);
  console.log('   ' + Object.entries(L.milestones).map(([k, v]) => `${k} ${f(v)}`).join(' · '));
  console.log('   budget 20 000 → step', ladderIndexFor(L, 20000), f(L.steps[ladderIndexFor(L, 20000)].total));
  if (flag('steps')) for (const s of L.steps) console.log(`   ${s.kind.padEnd(4)} T${s.tier} ${String(s.add).padStart(6)} ${String(s.total).padStart(6)}  ${s.label}  [${s.delta.map((d) => d.key + ':' + d.to).join(', ')}]`);
  for (const pr of L.problems.slice(0, 5)) console.log('   PROBLEM', pr);
}
fs.writeFileSync(arg('out', `/tmp/villar-budget/budget-ladder-out${CONTRACT ? '-contract' : ''}.json`), JSON.stringify(out, null, 1));
module.exports = { buildLadder, ladderIndexFor };
