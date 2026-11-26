# Villar, review round 2: playtest (customer + QA lead)

Build `baa1f80`, local harness `tools/shoot.mjs --csp` (headless Chrome, SwiftShader; desktop tier = `medium`,
phone tier = `low`). Viewports: 1440×900 EN and RU, 390×844 @2x `--touch` EN and RU. Evidence is in `/tmp/rev2/playtest/`
(`d*` = desktop, `p*` = phone). Step files are `run1.json`–`run7.json`, with logs `run*.log` next to them (run 2 hit the 590 s cap after 17 item checks; the
remaining items were covered through the budget list in run 4 and by real clicks in run 7). The store and AI
parser math was also re-run headless in Node against the shipped data (`/tmp/rev2/playtest/node/*.mjs`).

## Verdict

**Score: 7 / 10.** As a shop, the product now works end to end. Every item I clicked opened the right card, with the
right name, price, size, materials and colour (21 different items, 30 card checks, all matched). In-style swaps change the total by exactly the shown
delta, and sets (nightstands, lamps, chairs) are charged ×2. Cross-style preview totals match the real result: 433 of
433 anchors in Node, and the live run matched too. Cancel restores everything, and persistence and reset work. What
lets a picky customer down is trust in what they see. The 3D shows colours the card does not promise: a white duvet
renders navy-black on phones, an "Oatmeal" sofa renders grey-taupe in close-up, and a "black kettle" renders white. One
click on a style chip silently throws away all my picks. The language toggle leaves half the UI behind. The
hard-rule scan of the page text is clean, but the public JSON still carries paint brands and codes, and public JS names
the supplier.

**What clearly improved since round 1**
- QA-01 is fixed. A real tap on a phone opens the panel, and it stays open: no ghost click, and the total does not change
  (`p6-tap-real.png`).
- QA-04 is fixed. After a swap, focus stays on the selected tile (`act: tile is-current`). Esc / Back return focus to
  the opener: the canvas for 3D clicks, the budget line for list clicks (12 of 12).
- QA-03 is fixed. The page text has no supplier names, URLs or SKU-like codes in EN or RU (`textHits: []`, `attrHits: []`).
- The budget is exact in all 4 styles: line sum = zone subtotals = total = order modal
  (Dark Walnut 36,387 · Light Oak 23,432 · Cashmere 31,859 · Mediterranean 30,812).
- The local AI parser understood all 8 RU and 8 EN test phrases, and the room followed (details in the notes).
- The camera flies to the item and shows a Back pill. Esc is layered (confirm first, then the panel).

---

## Findings

### PT-01 [P1] A style chip silently discards every pick the customer made (no warning, no undo, no memory)
- Owner: coordinator (store), ui
- Repro: 1440×900 EN, Dark Walnut, Day. Swap sofa → Brighton, nightstands → Nazario, chairs → Stanton, table lamps →
  Tolima (total 32,595). Open the sofa and pick a Light Oak sofa from "From other styles" → Switch. Now click the "Dark Walnut" chip.
- Expected: either my Dark Walnut picks come back, or the chip warns first ("4 of your changes will be lost") and
  offers undo, like the in-panel cross-style confirm.
- Actual: the room lands on the pack defaults (36,387, `isCustomized() = false`). All 4 picks are gone. No confirm,
  no toast, no undo. The chip path has no preview at all, while the in-panel path does. The store already keeps
  `selections[packId]`, but `setStyle()` overwrites it with `defaultsOf[styleId]`. The AI "Undo" can restore a whole
  previous style with its picks, which shows the data is there.
- Evidence: `run3.log` (in-style swaps: total 36,387 → 32,595; after the Dark Walnut chip: `"total":36387,"def":true`),
  `d3-style-dark.png`.
- Fix: in `store.setStyle()`, restore `selections[styleId]` when that pack was customized before (anchor on top),
  or show the same consequence line as the panel ("Room switches to X: N items change, total ±Δ · Undo") for chip clicks.
  Target: chip A → B → A returns the exact A selection and total.

### PT-02 [P1] Phone (low tier): white bedding, sofa and rug render near-black navy, which contradicts the card and the thumbnail
- Owner: engine
- Repro: 390×844 @2x `--touch`, Dark Walnut, Day, Entry, right after load. Then tap the centre of the stage (curtains),
  or open Bedding from the list (RU).
- Expected: "white percale" bedding reads white/cream in shade, as on desktop: the duvet there is ≈ (176,159,138).
- Actual: on the shadow side the duvet pixels are (2,17,26) and (17,25,32), and the sofa and rug zone is (7,11,10). The
  lit side clips to (252,234,223). The card next to it says «Белый перкаль», and the tile thumbnail shows a white bed.
  At first glance a customer sees a navy duvet and a black sofa. Desktop `medium` does not do this, so it is
  tier-specific (`low`: no AO, 1 GI bounce, 1024 shadow map). Known issue 1 is a different trigger (style + time in
  one tick). This happens on a clean load.
- Evidence: `p6-ready.png`, `p6-ru-bedding.png`, `p6-tap-real.png`; `run6.log` (`q: "low"`).
- Fix: check the low-tier ambient/GI fallback (sky-only hemisphere fill looks like the cause). Shaded white fabric
  should stay ≥ 90/255 luminance with |B−R| < 15. Repro on desktop with `?quality=low` before testing on a real phone.

### PT-03 [P1] In focus close-ups, upholstery renders far darker and greyer than the card colour and the thumbnail
- Owner: engine (exposure in focus mode); see also R2-02 / R2-03
- Repro: 1440×900 EN, Dark Walnut, Day, Entry. Click the sofa (real click at 239,729). Separately, switch the sofa to
  Light Oak "Rockwell" via "From other styles".
- Expected: the close-up shows the colour the card names (Lansbury "Oatmeal" #CFC4B3 → (207,196,179); Rockwell "Stone
  linen" #C9C3B7), close to the tile thumbnail beside it.
- Actual: in close-up the sofa seat is (108,97,81) and the back is (72,68,62). The Rockwell seat is (99,93,81). The
  thumbnails in the same frame are (237,226,208) and (236,230,216). On screen the 3D sofa reads taupe-charcoal while
  its own card and tile say cream. In the wide Entry view the same sofa reads correctly light. This is the moment
  the customer studies the item, so it is where colour truth matters most.
- Evidence: `d2-real-sofa.png`, `d3-cross-preview.png`, `d3-cross-done.png`.
- Fix: in focus mode, meter exposure on the focused object's screen box, not the bright window. Or clamp the focus
  EV change against the pre-focus view. Target: the focused item's mean luminance within ±20 % of its catalogue
  `colorHex` under Day.

### PT-04 [P1] Kitchen accessories: card, thumbnail and 3D disagree (black kettle / dark board vs a white kettle and a light board)
- Owner: modeler (archetype params), catalog
- Repro: 1440×900 EN, Dark Walnut. Show items → "Kitchen: dark Laimai board, wooden caddy".
- Expected: the 3D shows what the card lists: "Matte black kettle, Wooden utensil caddy, Dark wood board", colour
  "Dark wood / white".
- Actual: the 3D kettle is white (with a blotchy grey texture) and the board is light wood. The selected tile
  thumbnail shows a black kettle. So the three surfaces describe three different products.
- Evidence: `d4-line-kitchen_decor.png`.
- Fix: map `kitchen-laimai-dark` params to the black kettle and dark board, and audit every `kitchen_decor` /
  `tableware` item for 3D vs `materialsEn` vs thumbnail. They share one renderer, so the 3D and the thumbnail should
  never differ.

### PT-05 [P1] Language toggle leaves parts of the UI in the boot language
- Owner: ui (style picker), engine (canvas label), assistant (chips); dup of D2-02 for the picker, the rest is new
- Repro: 1440×900, load in EN, click "RU". Or go RU → EN after one AI exchange.
- Expected: all chrome follows the toggle.
- Actual:
  - The style picker keeps "Style · Dark Walnut · Light Oak · Cashmere · Mediterranean" in a Russian UI
    (`stylepicker.js` has no `onLang`).
  - The canvas `aria-label` is hard-coded «3D-вид квартиры» in EN too (`engine/index.js:146`). A screen reader reads it
    in the Tab order right after the style chips.
  - After the first AI message, the suggestion chips stay in the old language («Покажи утро», «Уложись в 20 000» in
    the EN UI) until the next reply. `assistant.js` re-renders chips only `if (!log.length)`.
  - The HTML ships in Russian. On a reload the EN visitor sees «Квартира / Стиль / Собираем квартиру / Итого за
    квартиру» until the modules run (4.5 s here).
- Evidence: `d5-ru-budget.png` (EN picker in RU UI), `run4.log` (Tab stop `CANVAS "3D-вид квартиры"`), `run5.log`
  (`chips: ["Покажи утро",…]` after the EN toggle), `d4-reload-poster.png`.
- Fix: subscribe the picker to `onLang`. Set the canvas label from `t('stage.canvas')` on `onLang`. In the assistant
  `setLang`, always re-render the default chips. Pick `<html lang>` and the static strings before first paint (an
  inline 3-line script from `navigator.language` / saved choice).

### PT-06 [P1] AI "Undo" also reverts manual swaps made after the AI change
- Owner: assistant
- Repro: Dark Walnut. Type «диван подешевле» (Lansbury → Daventry). Then swap the rug by hand in the panel. Then press
  «Отменить» under the reply (it stays visible), or type «отмени».
- Expected: only the sofa goes back. My manual rug choice stays.
- Actual: reproduced live (EN, `run7.log`). "a cheaper sofa" → sofa Lansbury → Daventry. Rug swapped by hand
  Heaton → Dione. Undo → sofa back to Lansbury (correct) **and the rug back to Heaton** (my manual choice is lost
  without a word; the reply says "Changes undone."). Cause: `assistant.js` `undo()` loops over **every** key of
  `lastBatch.before.selection` and re-selects any key that differs now. The «Отменить» / Undo button stays in the reply
  area indefinitely, so this is easy to hit.
- Fix: store the batch's own changes `{key: [from, to]}` and on undo revert only keys whose current value is still `to`.
  Hide the Undo button once the user changes anything by hand.

### PT-07 [P1] Hard-rule scan: paint brand names and product codes in public JSON
- Owner: catalog
- Repro: `fetch('/data/palette-*.json')` from the page (all 11 data files are fetched on load).
- Expected: no brand names or article/SKU-like codes in anything public.
- Actual: 14 fields (none of them rendered: page `innerText` is clean in EN and RU):
  - `palette-dark-walnut.json` `swatches[0].paintRef` "Jotun 1622 Reflection (NCS 0801-Y25R); альтернатива — Farrow &
    Ball Pointing No. 2003 / Benjamin Moore White Dove OC-17"; `swatches[1].paintRef` "Jotun 1001 Egg White … Pantone
    11-4201 Cloud Dancer"; `swatches[3].paintRef` "… Jotun 10678 Space (NCS 1704-Y19R)"; `swatches[8].paintRef` "≈ Farrow
    & Ball Bancha No. 298"; `swatches[9].paintRef` "Farrow & Ball Red Earth No. 64"; `rules[10]` "(≈ Jotun 10678 Space)".
  - `palette-light-oak.json` `swatches[0].paintRef` "Jotun 1928 Summer Snow … Sherwin-Williams Shoji White SW 7042";
    `swatches[1].paintRef` (Jotun 1001, Pantone 11-4201); `swatches[4].paintRef` (Jotun 10678 Space).
  - `palette-greige-luxe.json` `swatches[0].paintRef` "Jotun 1281 Pearl Beige … Sherwin-Williams … Benjamin Moore";
    `swatches[1].paintRef`; `swatches[8].paintRef` "Pantone 17-1230 Mocha Mousse … Jotun 2771 Rustic Terracotta".
  - `palette-mediterranean.json` `swatches[0].paintRef` "Jotun 12303 Natural White"; `swatches[1].paintRef`.
  - Catalog, stylepacks, layout and styles: no brand, URL, SKU or supplier keys (`sku|url|link|source|supplier|brand|
    vendor|article|href` keys absent).
- Why P1 and not P0: these are paint references, not the furniture supplier, and they are never rendered. Under a
  literal reading of "brand name / article numbers" they still break the rule, and the fix is trivial.
- Fix: strip `paintRef` (and brand mentions in `rules[]`) from the shipped `site/data/palette-*.json`. Keep them in
  `research/`. Add a CI grep over `site/data` for `/jotun|farrow|benjamin|sherwin|pantone|ral |ncs /i`.

### PT-08 [P1] The supplier's name ships in public JS
- Owner: assistant
- Repro: view `/js/ai/core.js` (loaded on every visit).
- Actual: line 304 `const SUPPLIERS = /\b(home\s*cent(?:re|er)s?|homecentre|landmark\s*group|dragon\s*mart|…/i`, plus
  `SUPPLIERS_RU` with «хоум центр». The real supplier and its parent group are the first two entries of a public
  deny-list. Anyone who opens DevTools learns the source. (Round 1 QA-13 flagged just the word "landmark". This is
  the full name.)
- Fix: sanitise on the server (`api/`, which is not public), or ship only salted hashes of normalised tokens and compare
  hashes client-side. Target: `grep -ri "home.\?cent\|landmark" site/` returns nothing.

### PT-09 [P2] The mirror (and the hallway runner) can't be seen from any preset view
- Owner: engine (views) / coordinator (layout)
- Repro: 1440×900, Dark Walnut. Project every slot from all 6 view chips (`__pt.sp(slot)`).
- Actual: `mirror` is visible in 0 of 6 presets. `runner` and `kitchen_decor` are visible only from Window, at a
  distance. The mirror is on the entry wall behind the Entry camera. The customer pays for it (359 AED) but only finds it
  via "Show items" or by turning 180°.
- Evidence: `run1.log` (per-view visibility map), `d4-line-mirror.png` (reachable via the list only).
- Fix: add an "Entrance" preset, or start the Entry view a few degrees towards the mirror. Target: every priced item
  visible in ≥ 1 preset.

### PT-10 [P2] The same decor set is placed twice (coffee table and TV unit) and charged twice
- Owner: catalog / coordinator (pack slots)
- Repro: any style. Open the coffee-table decor: «Decor · 2 pcs», 1,048 AED = 2 × 524. Order modal: "Decor: sand vase,
  travertine, walnut × 2".
- Actual: `decor_coffee` and `decor_tv` resolve to one key (`decor_set`), so the identical vignette stands on both
  surfaces. A designer would not repeat a vignette in a 38 m² room, and the customer is charged for two identical sets.
- Fix: give the packs separate `decor_coffee` / `decor_tv` keys with different defaults (low tray + book stack vs vase +
  bowl).

### PT-11 [P2] Mediterranean keeps Dark Walnut's whole textile and art layer
- Owner: catalog
- Actual: 8 of 29 Mediterranean defaults are identical to Dark Walnut: `cushions, bedding, throw, art_sofa, art_bed,
  art_dining, plant, mattress`. These are the most visible accents. After the switch, the olive and rust cushions, the
  terracotta duvet cushion and all three artworks stay put (`d3-style-mediterranean.png`). The room says "same
  apartment, new chair". Light Oak shares 7 and Cashmere 10, but mostly non-signature slots (rug, mattress, runner).
- Fix: give Mediterranean its own cushions, throw, bedding accent and at least the sofa and bed art.

### PT-12 [P2] Tableware: "Table for two" vs "dinner set for 4/6, 6 tumblers, 16 pcs"; 5 near-identical tiles
- Owner: catalog
- Actual: every tableware option is named "Table for two: …". The card says "Stoneware (dinner set for 4), Amber glass,
  6 tumblers, …cutlery, 16 pcs", while the 3D shows two place settings. In the tray, 5 tiles truncate to "Table for two:
  sand stoneware,…" / "Table for two: speckled beige…", and their thumbnails look alike (`d2-item-tableware.png`).
- Fix: name the product, not the scene ("Sand stoneware set for 4 + amber glasses"). Show what is delivered vs what is
  laid out. Make the shortName differ in the first 20 characters.

### PT-13 [P2] Small card/data inconsistencies
- Owner: catalog / ui
- Rug name "Heaton wool rug, 200 × 290" vs Size "290 × 200 × 1.5 cm" (`d2-item-rug.png`). Pick one order (w × l).
- Cross-style other-style tiles: the same item is listed under several styles. For example, the white kettle set
  appears under Light Oak, Cashmere and Mediterranean at 168 AED (`d4-line-kitchen_decor.png`). Deduplicate, or show
  the target style on one tile.
- "From other styles" says "More styles are coming very soon" on 16 of 33 Dark Walnut slots while 4 styles exist (dup
  of D2-05). Counted per pack: Light Oak 3, Cashmere 3, Mediterranean 8.

### PT-14 [P2] AI dead-ends and literal readings
- Owner: assistant
- «кресло букле» / "boucle armchair" in Mediterranean → "Armchair: no matching option in this style." Dark Walnut and
  Cashmere both have the Pebble bouclé chair. Offer it ("Bouclé is in Dark Walnut — switch the armchair?") instead
  of stopping.
- «стиль средиземноморье, но диван оставь» switches and explains that Daventry is not in Mediterranean. That is honest,
  but it then picks Oshawa (+2,160 AED) without saying the price. Add the delta to the sentence.
- «сбрось» right after an AI style switch → «Всё и так как в исходной подборке.» The user most likely means "back to
  how it was". Offer "Back to Dark Walnut?" as a chip.
- «напиши стих про кота» → the "basic mode" help line. That is fine and leaks nothing. "where can I buy this sofa? send
  the link" / "what brand is the sofa?" → name + price only, with no link and no brand (good).

### PT-15 [P2] The reset link hides itself after use and drops keyboard focus to `<body>`
- Owner: ui
- Repro: customise, Tab to "Reset to the style's picks", press Enter.
- Actual: the button sets `hidden` on itself, and `document.activeElement` becomes `BODY` (`run4.log`). The next Tab
  starts from the top of the page.
- Fix: move focus to the "Show items" toggle (or the total) before hiding. Announce "Reset done".

### PT-16 [P2] Load seam: the poster and the first live frame have different framing (and the poster ignores the saved style)
- Owner: engine / ui
- Repro: 1440×900, fresh load. Compare `d1-00-loading.png` (poster, 32 %) with `d1-01-ready-hint.png` (live).
- Actual: the poster is a wider lens. The TV spans x 1060–1330 on the poster and x 1130–1415 live, and the bed
  grows by about 20 %. When the 3D takes over, the image zooms and shifts in one frame. The poster is always Dark Walnut, so a
  returning visitor with Light Oak saved (persistence works, `run4.log`) sees Dark Walnut under a "Light Oak" chip
  until ready.
- Fix: render the poster from the exact Entry pose and FOV at the stage's aspect ratio. Cross-fade poster → canvas
  over ~300 ms. Ship one poster per style and pick it from `localStorage` before first paint.

### PT-17 [P2] Panel robustness: tiles remain clickable for 520 ms after close and then throw
- Owner: ui
- Actual: `.hud-card/.hud-tray` keep `visibility: visible` for 520 ms after close (transition delay). A tile clicked in
  that window calls `store.select(ref())` with `cur = null`, and the page throws `Cannot read properties of null
  (reading 'slotId')` (seen as a pageerror in `run6.log`, triggered on a stale tile).
- Fix: `if (!cur) return;` in the tile `onPick` and `askStyle`, and set `inert` on the HUD when closed.

### PT-18 [P2] "Order the set" ends in "Ordering opens very soon" with no way to leave a contact
- Owner: coordinator
- Actual: the main CTA (header, budget, phone cart pill) opens an honest stub. Totals and lines are correct: 29 lines,
  sum 36,387, "33 items", and the modal fits on a phone without scrolling (`p6-order.png`). The customer is ready to
  buy and can only press "Done". (Copy is covered in D2-15.)
- Fix: add one optional field (phone / WhatsApp) or a "Notify me" button that stores the set, so intent isn't lost.

---

## Also confirmed (already reported by a parallel reviewer, my evidence only)
- Focus framing hides part of the object (D2-01): the pendant flies to a pose where the shade sits half under the tray
  (shade bottom at y ≈ 514 = tray top, `d2-item-pendant.png`). The cord gets the space, not the shade. The
  cross-style confirm bar also covers the card's Colour row and fact (`d3-cross-preview.png`, D2-10).
- Budget zone «Окно и зелень» holds the entry mirror and the hallway runner (D2-16).

## Notes on known issues (new information only)
- Known issue 3 (first Evening stall): `renderer.info.programs` jumps **66 → 120** on the first Evening (`run1.log`).
  Every lit material recompiles for the extra lamp lights. This is the cause of the stall, not the GI bake.
- Known issue 5 (card clipped): the clipped part grows with the name length. For Tableware (3-line name) the whole
  Colour row and the fact are cut, not just the last line (`d2-item-tableware.png`).

## What I tested and what passed (for the record)
- Load to ready: 32–45 s on software GL. The hint chip shows "Drag to look around · Click an item" (desktop) and "Swipe
  to look around · Tap an item" (phone). All 6 view chips and all 4 time chips switch the engine and
  stay in sync (`pressed` = current). On phones the time control collapses into one cycle pill, which works.
- Drag to look: synthetic mouse drag rotates the view (direction −0.27,0,0.96 → 0.57,0,0.82) and releases the preset
  chip. Click-to-walk: a real click on the floor at (650,668) in Entry starts a walk (z 2.40 → 2.57 and moving) and
  releases the chip (`run7.log`, `d7-walk.png`). Hover card: "Sofa · Lansbury 3-seater sofa · 2,999 AED · 211 × 88 ×
  86 cm", with no brand (`d7-hover.png`). Synthetic *touch* pointers can't be used in
  this harness (`setPointerCapture` rejects fake pointer ids), so phone checks used real taps only.
- Item cards: name, price (qty × price for sets, with "2 × …" note), size, materials and colour match the catalog for
  sofa, cushions, rug, coffee table, TV unit, armchair, floor lamp, bed, bedding, nightstand, curtains, plant, bed art,
  pendant, tableware, dining art, mirror, runner, kitchen decor, sofa art, dining chair (EN), and bedding (RU, phone).
  Esc and Back close the panel. The camera returns to the previous pose. Focus returns to the canvas or the budget line.
- In-style swaps: sofa +600, nightstands −3,936 (2 × 1,968), chairs −528 (2 × 264), table lamps +72 (2 × 36). In
  each case the total delta equals the tile delta, and the 3D shows the new id on both paired slots.
- Cross-style: preview "27 items change, total −9,163 AED" → real total 23,432 = preview. Cancel → same selection, same
  total, no pending tile. Node check: 433 / 433 anchors, preview total, delta and changed-count all exact.
- Styles: 4 chips. Totals and room change. Line sum = shown total = zone subtotals.
- Order modal: 29 lines, sum = total, "33 items". Esc and × both close it and return focus to "Order the set" (`run7.log`).
- Persistence: style, selection and total survive `location.reload()`. Reset restores the pack defaults and hides the
  link.
- AI (local parser, RU and EN): evening ✓, budget 25,000 → 8 swaps, 24,981 ✓ (and "already within budget" when it is) ✓,
  cheaper sofa ✓ (−360; "nothing cheaper" when cheapest) ✓, style + keep sofa ✓ (honest), bouclé armchair (see PT-14),
  reset ✓, undo ✓ (restored the whole previous style with its picks), poem → help line ✓.
- Keyboard: the Tab order is logical: nav → hero CTAs → 4 style chips → canvas → time → view → AI input → 3 chips →
  Show items → Order. Walk keys act only while the canvas has focus. In the AI input they type ("dw"). On a
  focused view chip, arrows move the chip. With `<body>` focused, nothing walks (the page scrolls). The window-level
  key guard in `stage.js:288` is now dead code, because the engine already scopes keys to the canvas.
- Perf (software GL, not representative): ready draw calls 202 → ~500 in steady state at `medium`, 652k triangles,
  66 programs (120 after Evening). Phone `low`: 96 calls, 121k triangles.
