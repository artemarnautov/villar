# Budget slider — contract (founder request, 26 Nov)

> «Сделай ползунок с бюджетом, человек чтобы смог в лайве удобно и интуитивно менять ползунок и содержимое квартиры
> правильно и органично менялось; если поставит минимальный бюджет — там будет условно диван, тумба … (выяви наиболее
> распространённые конфигурации под бюджет), сделай всё не хуже качеством, чем Apple.»

## Product behaviour
- One slider, «Бюджет / Budget», under the stage next to the total. The thumb sits at the current room total.
- **Dragging is live.** The 3D room changes while you drag: items dissolve in and out, and pieces upgrade or downgrade.
  The total number follows smoothly.
- **Monotonic and organic.** Moving right only adds or upgrades. Moving left only removes or downgrades. The room
  never "reshuffles". Every intermediate state is a complete, designer-correct room for its budget:
  - pairs stay pairs (nightstands, table lamps, dining chairs);
  - dependencies hold (no bedding without a mattress, no tableware without a table);
  - style pairings hold (walnut ↔ travertine etc.).
- **Named levels** are milestones of the ladder for the active style, not fixed AED (site/data/budget.json):
  step 0 «Минимум / Minimum» · «Самое нужное / Essentials» (end of tier 1) · «Удобно жить / Comfortable» (tier 2) ·
  «Всё для жизни / Move-in ready» (tier 3) · «Полностью обставлено / Fully furnished» (every slot filled) ·
  «Как в журнале / Magazine-ready» (= the curated designer room, with Villar Editions on the three walls) ·
  «Без компромиссов / No compromises» (the designer's best pick in every place).
  Steps between the minimum and Essentials are «Основа / Basics». Tick marks on the track; the current level
  name shows next to the number.
- **Dependencies always hold.** A pinned or added piece brings what it needs (lamps → nightstands, tableware →
  table + chairs, …): `buildLadder` includes the closure in its minimum, and «Добавить» uses
  `requiredFor({ pack, spec, selection, key })` to add the missing pieces with it.
- **Style switch keeps the budget.** If the room is a budget-ladder step other than the designer room, switching
  style lands on the target style's richest step ≤ the same total (its minimum if higher):
  `store.setStyle(id, { selection: targetLadder.steps[i].selection })`. From the designer room it lands on the
  target's designer room as before.
- **Your picks stay.** Any item the customer picks by hand (HUD, AI, list) is *pinned*: the slider plans around it and
  never changes it. A pinned item shows a small pin in the list and the card, with «Открепить / Unpin».
  The slider's minimum rises to include pinned items.
- **Excluded items are visible.** In «Показать состав / Show items», items not in the current budget are listed muted:
  «Не входит в бюджет · Добавить» / "Not in this budget · Add". Adding one pins it.
- **The AI line uses the same planner.** «уложись в 25 000» moves the slider to the best state ≤ 25 000.
  «добавь торшер» adds and pins it.
- **Order and lead:** only included items are ordered and priced. The server re-prices with the same rules
  (null = not included).

## Data model
- `selection[key] = itemId | null`. `null` means the slot is empty: not rendered, not priced, not ordered.
  The default room has no nulls.
- The ladder spec lives in `site/data/budget.json`, built from `research/budget-tiers.md`:
  - `tiers` — slot type → tier 0..4;
  - `order` — order within a tier;
  - `groups` — keys that move together;
  - `requires` — dependencies;
  - `heroes` — upgrade order;
  - `levels` — RU/EN names + milestone.
- Style packs add (docs/ART.md §4, `docs/reviews/curation-1.md`):
  - `picks: { key: [signature, alt1, alt2] }` — at most three per place; the signature is the pack default;
  - `avoid: [[idA, idB], …]` — pairs that clash in one room.
- Catalogue: `edition: true` marks a Villar Edition (docs/ART.md §5). `styles.json` `editions: false` removes them
  from every pack (`withoutEditions` in `core/data.js`, also applied to the server index).

## Store API (coordinator, `site/js/core/store.js`)
- `store.applyPlan(selection, { reason: 'budget' })` sets many keys at once (nulls allowed). It emits
  `'plan' { reason, changes: [{key, slots, itemId|null, prev|null}] }`, then one `'change'` per changed key with
  the same reason.
- `store.select(key, itemId, { reason })` pins `key` when `reason` is `'user'` or `'ai'`.
- `store.pins()`, `store.pin(key)`, `store.unpin(key)`. Each emits `'pins'`.
- `store.included(key)` → boolean.
- `selected(x)` returns `null` for an empty slot. `lines()`, `total()` and `placed()` skip empty slots.
  `options(x)` is unchanged.
- `snapshot()` / `restore()` carry nulls and pins. Persistence stores nulls and pins (save version v3; v2 loads as
  "no nulls, no pins").

## Planner (coordinator, `site/js/core/budget.js`, also used by `ai/core.js` server-side)
- `buildLadder({ pack, packId, catalog, layout, spec, pinned, current })` returns
  `{ steps: [{ total, selection, delta: [{key, from, to}] }], levels: [{ id, name, nameEn, index, total }], minIndex,
  defaultIndex, maxIndex }`. It is deterministic and memoised per (packId, pins).
- `ladderIndexFor(ladder, budget)` returns the last step with `total ≤ budget`.
- Construction:
  - the minimum: tier 0 at the cheapest compliant options, plus pins;
  - add tier 1, tier 2, … one group per step, each at the curated item (falling back to the cheapest);
  - between tiers, upgrade the hero pieces toward the curated item when the research rule says so;
  - the ladder passes exactly through the curated default room;
  - above it, upgrade heroes to pricier options one step at a time, up to the premium room;
  - pairings are applied within the same step.
- Curation rules (27 Nov, marked `curator` in the code):
  - **Tier 3 order:** pendant, cushions, throw, sofa art, mirror, side table (the lamp over the table comes before
    the picture);
  - **Editions enter at the designer room.** A key whose curated item is an edition enters at the pack's first
    non-edition pick; the last designer steps hang the editions (sofa wall, bed wall, dining wall);
  - **Premium = the best pick.** Where the pack lists `picks` for a key, the premium step takes the priciest pick
    (ties: the earlier pick), not the priciest option;
  - **No clashing pair.** No entering, upgraded or premium piece may form an `avoid` pair with a piece in the room.

### Level totals, AED (27 Nov, after curation rounds 1–3; `tools/test-ai.mjs` checks the shape, not the numbers)

| Level | Dark Walnut | Light Oak | Cashmere | Mediterranean |
|---|---|---|---|---|
| Minimum | 7,852 | 7,180 | 9,688 | 6,832 |
| Самое нужное / Essentials | 13,330 | 11,938 | 14,890 | 12,994 |
| Удобно жить / Comfortable | 16,354 | 14,662 | 18,334 | 15,802 |
| Всё для жизни / Move-in ready | 19,597 | 16,735 | 21,025 | 18,973 |
| Полностью обставлено / Fully furnished | 26,237 | 20,968 | 28,544 | 23,847 |
| Как в журнале / Magazine-ready | 37,520 | 22,793 | 33,849 | 32,286 |
| Без компромиссов / No compromises | 41,689 | 25,396 | 35,634 | 33,680 |
| Steps on the ladder | 46 | 39 | 38 | 37 |

- Before curation: Magazine 36,243 / 21,280 / 32,216 / 29,965; No compromises 41,451 / 25,391 / 34,148 / 33,991.
- Round 2 (sourced pieces, `docs/reviews/curation-2.md`) moved: Light Oak Move-in and Fully furnished −60 (the
  130 cm triptych costs less than the 80 cm canvas); Cashmere +36 from Move-in up (taupe cushion set +96, mocha
  throw −60) and −371 at the top (the plain four-cushion set is no longer a pick); Mediterranean +252 from the
  Minimum to Fully furnished (the warm-oak TV unit replaces the pale-oak one), Magazine unchanged.
- Round 3 (product photos, `docs/reviews/curation-3.md`) moved: Mediterranean Magazine and No compromises −240 (the
  Natura armchair is the signature; the cane one stays an option); Light Oak Fully furnished −156 and Cashmere
  Fully furnished +144 (the Ember canvas is portrait, 60 × 90, so it left the bed walls for the dining walls; the
  80 cm square canvas is the simpler piece over the bed).
- Art at Magazine: 2,570 (Dark Walnut, Mediterranean) or 2,470 (Light Oak, Cashmere).
- With `editions: false` the simpler pieces stay on the walls: Magazine 35,907 / 21,016 / 32,372 / 30,985,
  No compromises 39,676 / 23,519 / 33,657 / 31,979.

## Engine
- A `'change'` with `itemId: null` dissolves the model out and frees the slot. A slot that goes from null to an item
  dissolves the model in at the slot.
- During a drag, `'plan'` events arrive in bursts (up to ~30/s):
  - coalesce per key (latest wins);
  - cap concurrent dissolves (stagger ≤ 60 ms);
  - keep ≥ 50 fps on desktop high;
  - re-bake GI only once the slider has settled (≥ 350 ms with no plan event), local probes only.
- `villar.setDragging(true|false)`, called by the UI, lets the engine defer thumbnails and bakes and keep the camera
  stable. If the camera is focused on an item, the UI calls `unfocus()` when the slider is grabbed, so the whole room
  stays visible.

## UI
- The slider component lives in the budget bar on desktop, and in the total/dock on phone.
- Thumb ≥ 28 px with a 44 px hit area. The track shows level ticks and a filled part. It snaps to ladder steps but
  feels continuous.
- The number animates and the level name crossfades. A "what changed" whisper shows during the drag, e.g.
  «+ Торшер · + Плед» or «− Зеркало», at most two items, then fades.
- Keyboard: ←/→ move one step, PageUp/PageDown jump to the next level, Home/End go to the minimum/maximum.
  `aria-valuetext` reads e.g. "28 340 AED, Move-in ready, 29 items".
- Reduced motion: no number animation; dissolves become cross-fades.
- Interplay:
  - grabbing the slider unfocuses the HUD;
  - a manual swap moves the thumb to the new total;
  - the style switch toast still offers Undo for slider changes (one undo per drag gesture, using
    `store.snapshot()` taken at pointerdown).

## Quality gate
- Apple-level: the review round includes playtest (drag on desktop and phone, keyboard, RU/EN), design (motion,
  feel, copy), render (intermediate rooms look complete and designed, nothing floating or half-placed) and tech
  (no long tasks during drag on GPU; no leaks after 50 sweeps).
