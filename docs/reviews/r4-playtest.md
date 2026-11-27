# Villar, review round 4: playtest (customer + QA lead)

Build `5c4e5d8`, local harness `tools/shoot.mjs --csp` (headless Chrome, SwiftShader; desktop tier `medium`, phone tier
`low`). Viewports: 1440×900 EN and RU, 1280×800 EN, and 390×844 @2x `--touch` EN and RU. Evidence is in
`/tmp/rev4/playtest/` (`d*` = desktop, `p*` = phone). The step files are `run1–7.json`, with logs next to them.

The planner was also swept exhaustively in Node against the shipped files: every style, every ladder step, every
single-key pin, and every «Add» at every level (`/tmp/rev4/playtest/node/ladder.mjs`, `pins.mjs`, `ai.mjs`,
`style.mjs`). Level jumps were made with the keyboard, waiting ~40 s each, as the brief asks. Run 7 adds one real-path
pointer drag (4 moves across 3 levels) and an Undo.

## Verdict

**Score: 8 / 10 (round 3: 8.5).** The budget slider works the way a customer expects, in almost every case:
- Every level, from the 7,852 AED minimum to 41,451 AED "No compromises", is a complete room.
- The total, the list, the order modal, the 3D and `aria-valuetext` agreed at every one of the 20+ stops I checked,
  on desktop and phone, in RU and EN.
- The keyboard works.
- A drag or a burst of keys gives exactly one Undo, and that Undo restores the room exactly.
- «уложись в 15 000» and "budget 20k" land on exactly the slider's room.

Two P1s keep it below round 3:
1. **Pins and «Add» break the dependency rule.** Pick a nicer table lamp, then slide to the minimum. You are now billed
   for two lamps that stand on no nightstand: they don't render, but they are priced and ordered.
2. **A style switch ignores the budget the customer set.** At "Move-in ready" or "Essentials", switching style lands
   on the other style's designer room. That costs up to +60 % with no word about it.

**Counts: P0 0 · P1 2 · P2 6.**

**What clearly improved**
- Round-3 items: PT3-01 (sofa focus at 1280×800), PT3-02 and PT3-04 are fixed. PT3-03 is partly fixed.
- The slider ladder is mathematically clean when nothing is pinned. Across 4 styles and 162 steps there are 0
  dependency or floating violations. Totals strictly increase, there are no removals or downgrades going right, and the
  ladder passes exactly through each designer room (36,243 / 21,280 / 32,216 / 29,965).
- The 3D always matched the store at every slider stop with no pins (`sync3d: []`). I checked 7 stops in run 1, 3 on the
  phone, 2 from the AI and 3 after style switches.
- Hard-rule scan: `tools/check-public.mjs` is clean. My own scan is also clean: page text and attributes, 13 fetched
  JSON files and 134 same-origin assets, in EN (desktop) and RU (phone). The one attribute hit was a base64 thumbnail
  data URL, a false positive.

---

## Round-3 findings: verification

| ID | Status | Evidence |
|---|---|---|
| PT3-01 [P1] 1280×800 sofa focus backed into the hallway | **Fixed** | A click lands at cam (1.29, 1.28, 4.45): front-on, whole sofa, no foreground (`d5-1280-sofa.png`). Opening it from the list gives the same clean 3/4 view (`d5-1280-sofa-list.png`). |
| PT3-02 [P2] AI style switch silently dropped remembered picks | **Fixed** | The reply now adds "Started from the style's set; Undo brings back your earlier picks." Undo restores `memory`. In Node, DW picks (36,183) → AI Mediterranean → AI DW fresh → Undo → chip back to DW gives 36,183: picks restored. |
| PT3-03 [P2] Focus framing ignores foreground occluders | **Partly** | Coffee-table decor: all 3 pieces are now visible (`d5-1280-decor_coffee.png`). Mirror: the dining pendant's shade still fills the right ~30 % of the free area, at 1280 (`d5-1280-mirror.png`) and 1440. |
| PT3-04 [P2] AI offer cut to one line | **Fixed** | The offer is its own pill, "Pebble bouclé chair · 1,799 AED · Switch →", next to the sentence (`d5-1280-ai-offer.png`). |
| PT3-05 [P2] No fallback channel when the lead request fails | **Not fixed** | Every failure still shows "Couldn't send it. Please try again in a minute." (`order-modal.js:247`). There is no WhatsApp or phone fallback. Carried as PT4-07. |

---

## Budget slider: what I checked

| Check | Result | Evidence |
|---|---|---|
| Every level is a complete, sensible room (no pins) | Pass | Node, 4 styles: 0 violations for floating items or requires, pairs share one key, monotonic. Minimum = sofa, bed + mattress + bedding, curtains, TV unit (6 keys). Essentials = 10 keys, Comfortable = 14, Move-in ready = 20, Magazine = 30. Screens: `d1-min/ess/comf/movein/mag/end.png`. |
| Total = list = order modal = 3D | Pass without pins (see PT4-01 for pins) | At Minimum 7,852: 6 lines, sum 7,852, order "6 items 7,852", 3D in sync. At No compromises 41,451: 30 lines, order 41,451. Every keyboard stop: `shown = total = lines sum`, `sync3d: []` (`run1.log`). |
| Pins | Pass | HUD swap to Brighton → "Your pick · the budget keeps it · Unpin" in the card, a pin in the list, `pins:[sofa]`. Home → minimum 8,812 with Brighton kept, and the floor marker shown. Unpin from the list keeps focus on the line. Unpin from the HUD clears the pin. The next Home follows the ladder again (`run2.log`, `d2-swap-pin.png`, `d2-min-pinned.png`). |
| Left-out list with «Добавить / Add» | Pass, except PT4-01 | At the minimum, 24 muted rows "Not in this budget · + Add", grouped by zone (`d1-min-list.png`). Add pins the item and raises the floor. Adding the floor lamp works. Adding tableware does not (PT4-01). |
| Exactly one Undo per gesture | Pass | Two PageDowns within 1 s → `toastsSeen: 1` (`run1.log`). Pointer drag with 4 moves across 3 levels → 1 toast, "Budget: Essentials, 14,405 AED · Undo". Undo → 36,243 exactly, 3D in sync (`run7.log`, `d7-after-undo.png`). |
| Keyboard and `aria-valuetext` | Pass | Home / End / PageUp / PageDown / ← / → all land on the right step. EN "36,243 AED, Magazine-ready, 33 items", RU "19 717 AED, Под ключ, 23 предмета". `aria-valuemin` rises with pins (7,852 → 8,812). Thumb 28 px, rail 44 px. |
| AI = slider | Pass | «уложись в 15 000» → 14,405, Essentials, and the slider's `planFor(15000)` = 14,405 (live, RU). "budget 20k" → 19,717 Move-in ready = `planFor(20000)` (live, EN). Node: 11 phrasings across 4 styles all match the ladder. "до 18 тыс" and "20k" parse. 5,000 gives an honest "can't go below 7,852". |
| A manual swap moves the thumb | Pass | Brighton +600: thumb 0.8450 → 0.8629, `now` 36,843, still on the ladder ("Magazine-ready"). |
| Style switch away from the designer room | **Fail**, see PT4-02 | |
| Persistence | Pass | Minimum with pins, then reload: same selection, same pins, same total (`run6.log`). |
| Phone dock | Pass | Dock 390×84 at the bottom. Level "Magazine-ready", number, "33 items". Taps on the track jump (10,775 → 22,856), and the list and 3D follow. RU dock and HUD pin are translated (`p4-*.png`). |

---

## Findings

### PT4-01 [P1] Pins and «Add» break "dependencies hold": lamps, tableware and decor are billed with no host, invisible in 3D
- Owner: coordinator (`core/budget.js buildLadder` minimum and pins), ui (`ui/budget.js` Add)
- Repro A (the common path): 1440×900 EN, Dark Walnut, designer room. Open Tableware → pick "Stone Age" (+23). Open
  Table lamps → pick "Tolima" (+72). Both are pinned, as designed. Focus the slider and press Home.
- Repro B: at the minimum, open "Show items" and press «Add» next to Tableware (or Table lamps, Bedside decor,
  Coffee-table decor, Centerpiece, Pendant, Chairs, Dining table).
- Expected (docs/BUDGET.md "dependencies hold … no tableware without a table"; `budget.json` minimum.note "plus pins and
  whatever the pins require"): either the host comes in too, or the item can't be added without it.
- Actual A: the room reads "Minimum · 9 items · 8,876 AED". It includes 2 × Tolima lamps (860 AED) and the tableware
  (594 AED), with no nightstands and no dining table. The engine can't place an attached item without its host, so
  they are **not rendered**, but they are priced, listed and in the order modal ("9 items, 8,876 AED"). That is
  1,454 AED for things the customer can't see. `sync3d` reports `table_lamp_l/_r` and `tableware: 3d=null`
  (`run6.log`, `d6-min-pinned-lamps.png`: bare bed, no lamps).
- Actual B: Add tableware at the minimum → total +571 (9,383), the line appears, and the dining corner is empty
  (`d2-min-add-tableware.png`, `run2.log`). It renders only once the slider brings the table in at Essentials.
- Scope (Node, `pins.mjs`): the same 8 keys fail in all 4 styles when pinned. That is `table_lamp`, `tableware`,
  `centerpiece`, `nightstand_decor` and `decor_coffee` (no host: invisible but billed), plus `pendant_lamp` (no table),
  and `dining_table` / `dining_chair` (one without the other). «Add» gives 32 violating cases.
- Fix:
  - In `buildLadder`, step 1: for each pinned key, add the closure of `spec.requires` and the layout `attach` parents at
    their entry item. Those keys become fixed-in, and the minimum rises accordingly.
  - In `ui/budget.js` Add: apply the key and its missing requirements in one `applyPlan`, labelled "Add tableware
    (+ dining table and chairs, +2,776 AED)". Or show the row as "Needs a dining table" with Add for the host.
  - Target: `violations()` in `node/pins.mjs` returns 0 for every pin and every Add, in all 4 styles.

### PT4-02 [P1] Switching style ignores the budget the customer set: the room jumps to the other style's designer room
- Owner: ui (`main.js switchStyle`), coordinator (`store.setStyle`)
- Repro: 1440×900 EN, Dark Walnut. Set the budget to "Move-in ready" (19,717 AED: slider, or AI "budget 20k"). Click
  the "Light Oak" chip.
- Expected: Light Oak at the same level ("Move-in ready", 16,843 AED), or at the best room ≤ 19,717, and the toast says
  so ("Light Oak · Move-in ready · 16,843 AED · Undo").
- Actual: Light Oak at 21,280 AED, "Magazine-ready", 33 items (`run3.log`, `d3-lo-after-switch.png`). The thumb jumps
  right and the level name changes. The toast only says "Light Oak style · Undo". From Essentials (13,330) the same
  click lands on 21,280, which is +7,950 (+60 %) (Node `style.mjs`). Switching back restores Dark Walnut at 19,717, so
  each style remembers its own state, but a new style always starts at its designer room. The HUD's "From other styles"
  preview has the same root cause: it quotes the designer total.
- Fix: in `switchStyle`, if the current room is on the ladder below the designer step and the target style has no
  customer picks, apply `ladder(target).steps[level index]` for the same level id. Or apply `planFor(currentTotal)`.
  Put the level and total in the toast. Target: from any named level, a switch keeps the same level name, and the
  toast states the new total.

### PT4-03 [P2] "Minimum" names every step below Essentials, so "Minimum · 11 items · 10,775 AED" overstates it
- Owner: ui (`budget-slider.js levelName`), coordinator (`levelAt`)
- Repro: phone, tap the dock track at ~12 % → 10,775 AED with nightstands, dining table and chairs. The level reads
  "Minimum" (`p4-tap-low.png`). The true minimum is 7,852 AED with 6 items.
- Fix: say "Minimum" only at index 0 (or at the pinned floor). Steps between 0 and Essentials should show no level name,
  or "Towards Essentials".

### PT4-04 [P2] Budget zones read "0 AED" when everything in them is left out
- Owner: ui (`ui/budget.js renderLines`)
- Repro: minimum, Show items → "Dining · 0 AED" above six "Not in this budget · Add" rows (`d1-min-list.png`).
- Fix: when a zone has no included lines, show "Not in this budget" in the header instead of "0 AED".

### PT4-05 [P2] The contract and the data disagree on what "Move-in ready" means
- Owner: coordinator (`docs/BUDGET.md` vs `site/data/budget.json`)
- `BUDGET.md` says «Под ключ / Move-in ready — exactly the curated designer set». The data has `move-in` =
  `endOfTier:3` (20 keys, 19,717 AED) and `magazine` = `designer` (36,243). In the UI, the default room is called
  "Magazine-ready". Both readings are defensible, but reviewers, the AI copy and the founder need one answer.
- Fix: update `BUDGET.md` §"Named levels" to match `budget.json` (5 levels, Magazine = designer).

### PT4-06 [P2] RU assistant speaks in a gendered first person again: «Собрал комнату под 15 000 AED…»
- Owner: assistant (`ai/i18n.js`, budget reply)
- Round 2 (D2-08) removed the gendered voice («Готово: …», «лампы включены»). The new budget reply brings it back
  (`d3-ru-ai15.png`).
- Fix: use «Комната под 15 000 AED: «Самое нужное», итог 14 405 AED.»

### PT4-07 [P2] (carried PT3-05) A failed lead still offers only "try again in a minute"
- Owner: coordinator / ui (`ui/order-modal.js` failure branch)
- Fix as before: one line with a `wa.me` link prefilled with the style, total and item count (no item names).

### PT4-08 [P2] (carried PT3-03, mirror) The dining pendant still occupies the foreground of the mirror close-up
- Owner: engine (`focusOn` clear-line)
- Evidence: `d5-1280-mirror.png`. The shade covers the right ~30 % of the free area. The mirror itself is fully visible.
- Fix: include hanging lamps in the occlusion score, or choose the vantage from the entry side.

---

## Notes
- Software GL: each level jump took 20–40 s to settle (dissolves compile per item), which the brief calls known issue 3.
  The longest single task during the runs was 6.2 s. The ladder is frozen during a gesture, so a slow frame never moved
  the room to the wrong step. The final room always matched the last key or the drag end.
- The stale whisper text ("+ Cushions · + Rug" in English after switching to RU) is hidden and `aria-hidden`. It
  refreshes on the next change, so it is not reported.
