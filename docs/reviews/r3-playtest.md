# Villar, review round 3: playtest (customer + QA lead)

Build `931e361`, local harness `tools/shoot.mjs --csp` (headless Chrome, SwiftShader; desktop tier `medium`, phone tier
`low`). Viewports: 1440×900 EN and RU, 1280×800 EN, 390×844 @2x `--touch` EN and RU. Evidence is in
`/tmp/rev3/playtest/` (`d*` = desktop, `p*` = phone). The step files are `run1/2/2b/3/4/5/6.json`, with logs next to them.
Run 2 crashed: the screenshot right after a cross-style switch waited past 30 s on software GL. Run 2b re-ran its second
half. The store, catalog and AI-parser checks were re-run in Node against the shipped files (`/tmp/rev3/playtest/node/`).

## Verdict

**Score: 8.5 / 10 (round 2: 7).** 17 of the 18 round-2 findings are fixed. PT-17, and the Undo button on PT-01's
toast, were verified in code only. PT-16 remains open under known issue 5. The loop a customer plays is now honest:
- What the card says, the 3D shows. The white duvet on a phone is light grey, not navy-black. The close-up sofa is
  within a few percent of its catalogue colour. The kitchen set has the black kettle and the dark board.
- Going to another style and back loses nothing.
- AI Undo only touches what the AI did.
- The language toggle carries the whole UI.
- "Order the set" captures a real lead.

One P1 remains, and it is known issue 7. At 1280×800 the sofa still does not get a game-like close-up. The camera
backs into the entry hallway and frames it side-on, behind the kitchen counter. At 1440×900 the same click is correct.

**Counts: P0 0 · P1 1 · P2 4.**

**What clearly improved**
- Colour truth in 3D. On the phone, the duvet went from (2,17,26) in round 2 to (167,165,162) now (`p4-ready.png`). In
  the desktop close-up, the sofa back went from (72,68,62) to (211,191,171), against #CFC4B3 = (207,196,179) in the
  catalogue (`d1-sofa-focus.png`).
- Picks are remembered per style. With 3 Dark Walnut picks (32,979 AED), Light Oak → Dark Walnut via the chip returns
  the exact selection, `exact: true`. The toast "Light Oak style · Undo" appears, and the 3D matches the store for all
  33 placements after every switch (`mismatch3d: []`).
- The item panel no longer hides the object. In every settled focus shot at 1440 and 1280 the object is clear of the
  panel (`coveredByUI: 0`): sofa, armchair, bedding, nightstand, bed, pendant, mirror, art, kitchen decor, both decor
  sets and tableware. On the phone the sheet is 383 of 844 px, and the tapped item stays visible above it.
- Hard rule: `tools/check-public.mjs` is clean. My own scan is clean too: page text, attributes, all 11 JSON files
  and 130 same-origin HTML/JS/CSS/JSON/SVG assets, in EN and RU.
- The lead form works locally up to the expected network failure. Validation, focus on the first error, the
  e-mail-required switch, the calm error with the form kept filled, and Esc with focus return all behave.

---

## Round-2 findings: verification

| ID | Round-2 finding (short) | Status | Evidence |
|---|---|---|---|
| PT-01 | Style chip discarded the customer's picks | **Fixed** | `run2b.log`: Dark Walnut with 3 picks (32,979) → Light Oak → Dark Walnut: `exact:true, total 32979`. Toast "Light Oak style · Undo" shown. All 3D placements match the store. Node: A→B→A exact for both packs, `restore()` exact. The toast Undo button is verified in code only (`main.js` `switchStyle` → `store.restore(prev)`). On software GL the toast appears only after the switch unblocks (~20 s), so my live click missed it. |
| PT-02 | Phone low tier: white fabrics near-black navy | **Fixed** | Phone duvet (167,165,162) and (155,153,151); desktop duvet (157,153,149), so phone is within ±10 % of desktop. No blue cast. `p4-ready.png`, `p4-ru-bedding.png`. |
| PT-03 | Focus close-ups much darker than the card colour | **Fixed** | Lansbury close-up: back (211,191,171) and seat in shade (156,145,131), against catalogue (207,196,179) and thumbnail (239,232,220). Round 2 was (72,68,62) and (108,97,81). `d1-sofa-focus.png`. |
| PT-04 | Kitchen set: card, thumbnail and 3D disagreed | **Fixed** | The 3D shows a matte black kettle, a dark board and a white bowl, which matches "Matte black kettle · Dark wood board · Dark wood / white" (`d6-kitchen_decor.png`). |
| PT-05 | Language toggle left parts behind | **Fixed** | RU: the picker reads «Стиль · Тёмный орех · Светлый дуб · Кашемир · Средиземноморье», the canvas label «3D-вид квартиры», the chips are RU, and the layout chip reads «Студия 38 м²». Back to EN after a conversation: picker, canvas label ("3D view of the apartment") and chips switch at once (`run3.log`). An EN visitor gets an EN page before the modules load: at 4.5 s after reload the label reads "Setting up the apartment" (`run2b.log`). |
| PT-06 | AI Undo also reverted manual swaps | **Fixed** | «диван подешевле» → manual throw swap → «отмени»: the sofa went back and the throw stayed (`run3.log`: `manual: throw-norham-olive = wanted`). |
| PT-07 | Paint brands and codes in public JSON | **Fixed** | `check-public` clean. Deep scan of `site/data/*.json`: 0 brand, URL, SKU-like or supplier-key hits. |
| PT-08 | Supplier name in public JS | **Fixed** | No supplier, marketplace or paint brand in any of the 130 served assets, EN or RU (`codeHits: []`). The deny-list moved to `api/_deny.js`. |
| PT-09 | Mirror not visible from any preset | **Fixed** | The Window preset now shows the mirror, the runner and the kitchen decor (`run1.log` visibility map). |
| PT-10 | One decor set placed and charged twice | **Fixed** | `decor_coffee` ("Coffee table decor", 380 AED) and `decor_tv` ("TV unit decor", 524 AED) are separate keys with different defaults in all 4 packs. qty 1 each. `d6-decor_*.png`. |
| PT-11 | Mediterranean reused Dark Walnut's textiles and art | **Fixed** | Mediterranean now shares 1 of 30 defaults with Dark Walnut (the mattress), and Light Oak 3. Mediterranean has its own cushions, bedding, throw and art (`d3-ru-boucle.png`). |
| PT-12 | Tableware: "Table for two" vs sets for 4/6; tiles look alike | **Fixed** | Names: "Mia stoneware set for 4, amber glasses, brass cutlery". Tile names are distinct ("Mia · amber and brass", "Stone Age · dark glaze", "Lillian · smoke and wood"…). The card lists the full contents under "What's included". |
| PT-13 | Rug name vs size, duplicate other-style tiles, "coming soon" | **Fixed** | Every rug and runner name matches its dims (e.g. "Heaton … 290×200" = 290 × 200). Other-style tiles are de-duplicated (`hud.js otherGroups`). "More styles are coming very soon" now shows only when fewer than 2 styles exist. Otherwise the section is hidden. |
| PT-14 | AI dead-ends | **Fixed** | «кресло букле» in Mediterranean → "…есть в стиле «Тёмный орех» — «Pebble», 1 799 AED" plus the chip «Перейти в «Тёмный орех» с «Pebble»», which works. «…но диван оставь» now states the price change "(+1 800 AED)". (See PT3-02 for one side effect.) |
| PT-15 | Reset dropped keyboard focus to `<body>` | **Fixed** | After Reset, focus is on "Show items" (`act: budget-toggle`). |
| PT-16 | Poster and first live frame differ (and ignore the saved style) | **Not fixed (known 5)** | Still `/assets/poster.jpg`. New detail: the live lens is now 33° (round 2: 40°), so the jump is bigger. The TV's left edge moves from x 1060 on the poster to 1235 live (`d1-00-loading.png` vs `d1-01-ready.png`). `assets/posters/dark-walnut.jpg` already matches the new framing (window ≈ 29 % of the width in both), so wiring it in should remove the seam. |
| PT-17 | Tiles clickable while the panel closes → TypeError | **Fixed (code)** | `hud.js:81`: tile clicks are ignored when `cur` is null. No pageerror in any round-3 run. |
| PT-18 | "Order the set" dead end | **Fixed** | Lead form. Empty submit → "Enter your name / Check the number / Your consent is needed", with focus on Name. Bad values → the email error appears. Preferred contact = Email with no address → "Add an email to be contacted by". Valid submit → calm "Couldn't send it…" (known 6): fields kept, button re-enabled, focus on Send. Esc closes and returns focus to "Order the set". Reopening keeps the values. On the phone the sheet fits 828/844 px with Send at y 760, and focus lands on the title so the keyboard doesn't pop (`d2b-order-*.png`, `p4-order*.png`). |

---

## New findings

### PT3-01 [P1] Known issue 7 is still open at 1280×800: sofa focus backs into the entry hallway and shoots it side-on past the kitchen
- Owner: engine (`camera.js focusOn` vantage choice)
- Repro: 1280×800 EN, Dark Walnut, Day, Entry. Click the sofa, open it from "Show items", or call `villar.focus('sofa')`.
- Expected: the same game-like 3/4 shot as at 1440×900 (`d1-sofa-focus.png`): the sofa front-on, filling the free
  area left of the panel, nothing in the foreground.
- Actual: all three paths land on the same pose, cam ≈ (3.33, 1.29, 0.56), direction (0.17, 0, 0.99). That is the
  hallway by the door, about 4.6 m from the sofa. The sofa is seen from its arm end. The kitchen counter, kettle and
  utensils fill the left ~45 % of the free area, and the sofa takes ~20 % of its width. The panel does not cover it
  (`coveredByUI: 0`). It is visible, but it is not "flying to the item".
  At 1440×900 the vantage is the bed corner, (0.96, 1.28, 8.57) → a clean 3/4 front view. 1280×800 is the default
  scaled resolution of a 13" laptop.
- Evidence: `d5-1280-sofa-hudopen.png`, `d5-1280-sofa-engine.png`, `d5-1280-sofa.png`, `run5.log`. Compare
  `d1-sofa-focus.png` (1440).
- Fix: score candidate vantages by the angle to the item's front (`slotFront`): reject > 60° off-front. Also score the
  share of the free area covered by other geometry in front of the target (≤ 10 %). When the narrower free area
  (aspect ≈ 1.9 at 1280) pushes the distance past the room, widen the FOV up to ~45° instead of backing out of the
  room. Target: at 1280×800 and 1440×900 the sofa's front face is visible, it takes ≥ 30 % of the free-area width, and
  no foreground occluder.

### PT3-02 [P2] An AI style switch drops the picks remembered in the target style, while the chip keeps them
- Owner: assistant / coordinator (`setStyle(..., { fresh: true })`)
- Repro (RU, `run3.log`): in Dark Walnut, «уложись в 25 000» (8 swaps) and «диван подешевле», then «отмени» (the
  sofa reverts) → Dark Walnut at 24,837. Then «стиль средиземноморье, но диван оставь», then «кресло букле», then tap
  «Перейти в «Тёмный орех» с «Pebble»».
- Expected: back in Dark Walnut with my 8 budget picks plus the Pebble chair (about 24,837 − 1,200 = 23,637). That is
  what the style chip would give since PT-01.
- Actual: Dark Walnut lands on the curated set plus Pebble, 35,043 AED (+11,406). The reply says only «Стиль «Тёмный
  орех» с «Pebble».», with no word that the 8 picks were reset. Undo can recover them, but the customer has no reason
  to suspect the loss.
- Fix: for AI style actions, use the remembered selection like the chip does. If `fresh` is needed for exact
  predictions, predict from `previewStyle(id, anchor)` without `fresh`. Or at least say it in the reply ("your 8
  earlier picks in Dark Walnut were reset — Undo").

### PT3-03 [P2] Focus framing ignores foreground occluders near small and wall items
- Owner: engine (`focusOn` clear-line)
- Mirror, 1440 and 1280: the dining pendant's shade fills ~25–30 % of the free area in the right foreground. The
  mirror itself is fully visible (`d1-item-mirror.png`, `d5-1280-mirror.png`).
- Coffee-table decor: the camera sits so close that the white candle holder (1 of the 3 pieces on the card) is hidden
  behind the travertine bowl (`d6-decor_coffee.png`).
- Fix: run the clear-line test against hanging lamps too, and pick a vantage from which every sub-mesh of a set
  is visible (≥ 1 pick hit per sub-mesh).

### PT3-04 [P2] The AI reply is cut to one line on desktop, so the decisive part (item and price) hides behind «Ещё»
- Owner: ui (assistant)
- Repro: 1440×900 RU, Mediterranean, «кресло букле».
- Actual: «Кресло: в этом стиле такого нет, но есть в стиле «Тёмный орех» — «Pebb…» · Перейти · Ещё»
  (`d3-ru-boucle.png`). The name and the 1 799 AED price are cut off, and you have to press «Ещё» to read them.
- Fix: allow 2 lines before truncating on desktop, or render the offer as its own line ("Pebble · 1 799 AED ·
  Перейти").

### PT3-05 [P2] When the lead request fails, the customer gets no other way to reach us
- Owner: coordinator / ui
- Repro: fill the form validly and send. Locally this always fails (known 6). In production the same state shows for
  a timeout, 5xx or 429.
- Actual: "Couldn't send it. Please try again in a minute." The form stays filled (good), but a ready buyer has no
  fallback, and many will not come back in a minute.
- Fix: in the failure and rate-limit states, add one line: "or message us on WhatsApp", a `wa.me` link with the style,
  total and item count prefilled (no item names needed). Target: no dead end on any lead error.

---

## Known issues: new information only
- **#4 (first Evening):** programs 68 → 97 on the first Evening (round 2: 66 → 120). One long task of 34.8 s on software
  GL. A cross-style switch blocked the page long enough for a 30 s screenshot to time out (`run2.log`). Not
  representative of GPUs, as the brief says. The 3D did match the store once it settled (`mismatch3d: []` at 20–25 s).
- **#5 (poster):** see PT-16. With the new 33° live lens the jump grew. The per-style poster files already match the
  live framing.
- **#7 (focus at 1280/1440):** fine at 1440×900, still wrong at 1280×800. See PT3-01.

## What I tested and what passed (for the record)
- Load to ready: 21–46 s on software GL. EN hint "Drag to look around · Click an item". Phone hint "Swipe to look around
  · Tap an item". The phone dock reads "Entry · Sofa · Bed · Table · Window · Plan". All 4 time chips switch the engine.
- Real taps on the phone (curtains, coffee table): the sheet opens and stays. There is no ghost pick: the total is
  unchanged. Back returns. The "From other styles" tiles have 0 overlaps (4 tiles).
- Item cards: name, price (qty × price with the "2 × …" note), size, colour and materials matched the catalogue for
  sofa, armchair, bedding, nightstand, mirror, tableware, kitchen decor, both decor sets, centrepiece, curtains, coffee
  table, bed and bedding (RU, phone). Esc / Back return the camera and focus.
- In-style swaps: sofa +600, nightstands −3,936 (2 × 1,968), table lamps +72 (2 × 36). Each total delta equals the
  tile delta, both paired slots change in 3D, and the panel's own "Total" line updates.
- Cross-style: preview "The room switches to Light Oak: 30 items change. New total 20,647 AED (−12,332 AED)." The real
  result is the same 20,647, and Cancel restores everything. In Node, 475 of 475 anchors are exact (total, delta and
  changed-count).
- Styles: Cashmere 31,619 · Mediterranean 29,368 · Dark Walnut (remembered) 32,979 · defaults 36,243 / 20,647 /
  31,619 / 29,368. For each one, the lines sum to the shown total and to the zone subtotals. The new zone "Entry"
  holds the mirror and runner.
- AI (local parser), RU and EN: evening, budget 25,000 (8 swaps → 24,993), cheaper sofa, style + keep the sofa (honest,
  with the price), bouclé offer with a working chip, reset, undo (AI picks only), poem → short help line. "Where can I
  buy this sofa / send the link" → name and price only, no link and no brand.
- Persistence: style, selection and total survive `location.reload()`, and the page boots in EN. Reset works and
  keeps focus.
- Hard rule: `node tools/check-public.mjs` is clean. My JSON deep scan of `site/data` found 0 hits. The in-page scan
  (EN desktop and RU phone) covered innerText, aria-label/title/alt/href/src and fetches of 11 JSON files plus 130
  same-origin assets: 0 hits for supplier/marketplace/paint brands, product URLs or SKU-like codes. Latin model names
  (Lansbury, Hege…) remain by SPEC.
