# Villar, review round 3: design (Human Interface pass)

Build `931e361`, local harness (headless Chrome, SwiftShader, `--csp`). Evidence is in `/tmp/rev3/design/`; step
files are in `/tmp/rev3/design/steps/` and run logs are `/tmp/rev3/design/R*.log`. Prefixes: A = 1440×900 EN,
C = 1280×800 EN, F = 390×844 @2x touch RU, G = 390×844 @2x touch EN (the run owed from round 2). `sheet-*.png` are contact sheets.

## Verdict

**Score: 7.5 / 10** (round 2: 6.5). **P0: 0 · P1: 2 · P2: 8.**

This is now a calm, coherent product. On desktop the item panel is one quiet column that covers a quarter of the
stage, and the camera frames the object beside it. On phones there is one total, the sheet sits at a medium detent
with the object above it, the dock fits, and Back works. Style chips answer within one frame, and an Undo toast
follows the switch. Language, typography and copy hold in both RU and EN. Two things still break the game-like
feel the founder asked for. On a phone, every AI reply shoves the input down by 141 px. At 1280×800 the sofa
"inspect" shot looks down the kitchen counter at the sofa's end.

Of the 22 round-2 findings, 18 are **Fixed**, 3 are **Partly** fixed (D2-07, D2-13, D2-19) and none are **Not
fixed**. Known issue 7 is verified: the camera flies to the sofa at 1440 and 1280, but the 1280 composition is
D3-02.

**What clearly improved:** the desktop HUD (`A06` against round 2's `C04`), the phone sheet and the single total
(`sheet-F1.png`), the immediate style feedback with a toast, the lead form (`A15`: errors sit on the label line so
nothing jumps, and the first invalid field gets focus), pack copy and rules in both languages, the constant brand
mark, assistant voice and touch targets, and the soft selection halo.

### What stands between this and 8/10
1. **D3-01**: on phones, put the AI answer *under* the bar and limit it to one line plus the summary chip. The
   input must not move (`assistant.css`, the `order` and `line-clamp` changes listed there).
2. **D3-02**: the sofa focus at 1280 should be a 3/4 front view with no foreground occluder
   (`camera.js focusOn`, front-biased yaw and a corner-ray clearance check).
3. **D3-03**: `.hud-panel { --text-2: #5f5f64; background: rgba(251,251,253,.94) }`, so secondary text stays
   ≥ 4.5:1 over dark scenes.
4. **D3-05 + D3-04**: EN names without the repeated category ("Lansbury 3-seater", "White percale, oat throw…"),
   and AI chips without a double label («Постельное бельё: белый сатин, овсяный плед»).
5. **D3-10**: a shimmer skeleton instead of a coloured dot while thumbnails load, and visible tiles rendered
   first (≤ 600 ms on a GPU).

The rest (D3-06 to D3-09) is polish that moves the score from 8 toward 8.5: lead-form copy («Укажите телефон»,
«Разрешаю Villar связаться со мной…»), the phone first view framing the sofa, the hover card staying clear of the
dock, and the label for a tiny palette tier.

**Coverage note.** The shared lock was heavily contended (waits of 40–90 min per run). Four runs landed: 1440 EN (A),
1280 EN (C), 390 RU (F) and 390 EN (G, the run owed from round 2). The 1440 RU, 1024 RU and 768 touch runs
(B, D, E) did not get a slot, and I stopped them to free the queue. RU on desktop uses the same strings as the RU
phone run, which were checked there and in `stylepicker.js`/`i18n.js`. The 1024/768 HUD widths follow
`clamp(300px, 26vw, 360px)`. The step files are ready to re-run: `steps/R2.json`, `R6.json`, `R7.json`.

## Round-2 findings: status

| ID | Round-2 finding | Status | Evidence (round 3) |
|---|---|---|---|
| D2-01 | The HUD covers 59–68 % of the stage, and the object is cropped | **Fixed** | A single right-hand column, 360×524 px, covers 25 % of the stage at 1440×900 (`A06-hud-sofa.png`). The sofa sits fully in the free area (`__frame`: `inFree 1.0`, fills 19 % of it), with the coffee table and side table as context. Bedding and the floor lamp are also `inFree 1.0` (`A10`, `A11`). On the phone the sheet covers 34 % and the sofa is `inFree 1.0`, filling 31 % (`F05`). At 1280×800: 333×424 px, 26 % (C log), but see D3-02. |
| D2-02 | The style picker doesn't follow the language | **Fixed** | `F02`: «Стиль · Тёмный орех · Светлый дуб · Кашемир · Средиземноморье» right after the RU toggle. The canvas label and the stage chip («Студия 38 м²», known r2 #4) follow too. |
| D2-03 | Russian palette names on the EN page | **Fixed** | `A20`: "Warm grey-white, Light oak floor… Matte black". All four palettes have `nameEn` and `summaryEn`. |
| D2-04 | "From other styles" crushed on desktop | **Fixed** | `sheet-A-panel.png`: groups stack vertically in a 2-column tile grid, with each item shown once (Anders appears once now). |
| D2-05 | "More styles are coming very soon" while three styles exist | **Fixed** | `hud.js` `renderOther()` returns nothing when every style shares the options. Bedding now has real alternatives from Light Oak and Mediterranean (`A10`). |
| D2-06 | Phone: two totals overlap | **Fixed** | `F02`/`F14`: the pill stays hidden while any part of the bar is visible. With the HUD open the total is in the sheet header («Итого 36 243 AED», `F05`). |
| D2-07 | The AI line grows by up to 240 px | **Partly** | Desktop meets the target: the reply borrows 6 px above and the total moves +20 px (C log: budget top 754 → 774; `sheet-A-ai.png`). Phone: the slot goes from 56 to **197 px** (+141 px) and the input jumps down in RU and EN (`sheet-F3.png`, `sheet-G2.png`). See D3-01. |
| D2-08 | No immediate feedback on style chips | **Fixed** | `__style()`: first frame after the click at 3–17 ms (A, C, F, G logs), chip `aria-pressed=true`, «Меняем стиль…» / "Switching style…" chip visible. The toast with Undo follows (`sheet-A-style-toast.png`, `F11`). |
| D2-09 | Assistant copy: internal mode, gendered voice, arrows, units | **Fixed** (one regression in D3-04) | "I understand simple requests for now — try…", «Готово: …», «Вечер: лампы включены.», «Кресло: Emma, букле», «Уложись в 28 000 AED», «Ø 80», «290 × 200». |
| D2-10 | The budget bar jumps 63 px after the first change | **Fixed** | `.budget-side` stays at x = 376 before and after swaps and a style switch (A log). |
| D2-11 | The confirm reads as a negative total and crops the card | **Fixed** | "The room switches to Light Oak: 30 items change. New total 20,647 AED (−15,596 AED)." It is pinned to the foot of the column (`sheet-A-panel.png`, `F07`). Esc cancels the confirm first and leaves the panel open. |
| D2-12 | Tiles: two "selected" signals, truncation, duplicates | **Fixed** | The ring plus a 20 px check badge, with no pill (`A06`). Names get 2 lines in a wider 2-column grid. Duplicates are removed. |
| D2-13 | Materials as a comma list; EN names repeat the category | **Partly** | Materials are one per line under «Подробнее» / "Details" (`sheet-A-panel.png`). EN names still repeat the eyebrow ("Bedding / Bedding: white percale…", "Floor lamp / Sable brass floor lamp", "Sofa / Lansbury 3-seater sofa"), and sofas still mix "3-seater" and "three-seat". Only 5 of 158 items have `shortNameEn`. See D3-05. |
| D2-14 | Jargon in pack copy; rules for one pack | **Fixed** | All four packs have rewritten descriptions plus 4 `consumerRules` in RU and EN (`A19`–`A21`, `F17`–`F19`). |
| D2-15 | Quoted style names in English | **Fixed** | "33 items · Dark Walnut style", "Switch to Light Oak", "Light Oak style · Undo". |
| D2-16 | "Soon" three times in the modal | **Fixed** (replaced) | The order modal is now a lead form (`A14`, `F15`). It has new copy issues, in D3-06. |
| D2-17 | The mirror and runner under «Окно и зелень» | **Fixed** | `labels.js` adds the `entry` zone «Прихожая» / "Entry". |
| D2-18 | Phone dock clips «План» and slides sideways | **Fixed** | «Вход · Диван · Кровать · Стол · Окно · План» fits at 390 px (`F02`). The focus-mode dock gets `translateY` only on phones, and an overflow mask exists. |
| D2-19 | Phone Back gesture; the first view hides the sofa | **Partly** | Back: `history.back()` with the HUD open closes it and keeps the page (F log: `open:false`, same URL). First view: the sofa centre still projects to x = −20 in portrait Entry (F log), so the sofa is a grey sliver at the left edge (`F02`). See D3-07. |
| D2-20 | The logo changes colour; muddy accents | **Fixed** | `--brand: #4a3426` in both wordmarks. Light Oak uses deep sage `#4f5a46`, and Mediterranean terracotta `#9a4a2c`. The derivation now keeps the hue (`A15`, Cashmere in `F14`). |
| D2-21 | Assistant a11y: targets, contrast, ticker | **Fixed** | Touch: chips, undo, summary and history are 44 px and send is 44×44 (F log `__small()` lists none). The ghost text is `#6e6e73` (4.9:1). Rotation stops after 3 examples and never runs under reduced motion. Touch nav links have 15 px padding. |
| D2-22 | Grey Plan void; hard white halo | **Fixed** (halo); Plan not re-shot | The halo is a 1.5 px soft warm outline that fades after the flight (`A06`, `A10`: barely visible, no stair-steps). `post.js`/`index.js` add a warm "dollhouse backdrop" for `top`. |

---

## Findings (round 3)

### D3-01 [P1] Phone: an AI reply pushes the input down by 141 px
- Owner: assistant
- Repro: 390×844 touch, RU. Scroll the AI line into view and send «уложись в 25 000».
- Expected: the input stays where the thumb is. The reply occupies one line, and the changes sit behind the summary
  chip (the desktop behaviour).
- Actual: the slot grows from 56 to 197 px in RU and EN (F and G logs, `sheet-F3.png`, `sheet-G2.png`). The reply is clamped to 2 lines; then come the
  summary row («12 замен · −6 445 AED · Показать · Отменить») and a separate «История» row. All of it is inserted
  *above* the input, so the input and the total jump 141 px. On a real phone with the keyboard up, the field you just
  typed into moves away. Desktop is fine: the slot grows 26 px, 6 of which come from the gap above it, so the
  total moves +20 px (C log).
- Fix (`assistant.css`, the `@media (max-width: 734px)` block):
  ```css
  .vai-col { display: flex; flex-direction: column; }
  .vai-barwrap { order: 1; }            /* the bar first… */
  .vai-caption { order: 2; padding: 8px 4px 0 18px; }   /* …the answer under it, growing downward */
  .vai-reply { -webkit-line-clamp: 1; }
  .vai-reply-row { flex-wrap: nowrap; }
  .vai-hist-btn .lbl { display: none; }  /* history becomes a 44 px clock icon in the same row */
  ```
  Target: the input's `top` changes by 0 px after a reply, and the slot grows by ≤ 52 px (one 44 px row plus 8).

### D3-02 [P1] At 1280×800 the sofa focus looks along the kitchen counter at the sofa's end
- Owner: engine
- This verifies known issue 7. The camera does fly to the sofa at both 1440 and 1280. The 1280 composition is wrong,
  though.
- Repro: 1280×800 EN, Dark Walnut, Day, Entry. `villarUI.hud.open({slotId:'sofa'})`, or click the sofa.
- Expected: a 3/4 front view, like 1440×900 (`A06-hud-sofa.png`): the whole sofa, the cushions facing the camera,
  and the coffee table as context.
- Actual (`C06-hud-sofa.png`): the camera stands in the kitchen. The counter, kettle and drawers fill the left
  ~35 % of the free area in the foreground, and the sofa is seen end-on, small (14 % of the free area,
  `__frame: obj [320,248,550,490]`). The object is technically "in frame", but the shot reads as the kitchen.
- Fix (`camera.js` `focusOn()`): limit the candidate yaw to ±50° of the slot's front (`front`) before trying wider
  offsets, and reject a spot when the ray from the camera to the four bottom corners of the object's box hits other
  geometry in the first 40 % of the distance (the existing `clear()` checks only the centre line). Score the
  candidates by how close `fillOfFree` is to 0.25–0.4 rather than by distance from the current camera. Target: the
  1440, 1280 and 1024 shots of the sofa agree within 20° of yaw.

### D3-03 [P2] On a dark scene the HUD glass turns grey and its secondary text drops below AA
- Owner: ui
- Evidence: `A10-hud-bedding.png`. Over the dark TV wall the panel samples `#e9e8e9`, so `--text-2` (`#6e6e73`, 12–13 px:
  the eyebrow, the dims line, «5 options») is 4.15:1. Over the bright sofa scene it is 4.64–4.70:1 (`A06`).
- Fix: `.hud-panel { --text-2: #5f5f64; background: rgba(251,251,253,0.94); }`. That is ≥ 5.3:1 on the darkest
  sample, and the glass still reads as glass. Apply the same to `.hud` on phones (it is 0.97 there already, so only
  the `--text-2` override is needed).

### D3-04 [P2] AI change chips repeat the category inside the name
- Owner: assistant, catalog
- Evidence: F log after «уложись в 25 000»: «Декор у кровати: У кровати: керамическая мини-ваза и подсвечник», «Постельное
  бельё: Постель: белый сатин, овсяный плед», «Растение: Оливковое дерево Urbano Blanc…».
- Fix: `ai/i18n.js` `itemName()` should also strip the item's own leading «Something:» label (`/^[^:]{2,24}:\s*/`)
  after the slot label. Result: «Декор у кровати: керамическая мини-ваза и подсвечник», «Постельное бельё: белый
  сатин, овсяный плед». Same in EN ("Bedding: white sateen, oat throw").
- Also in EN `P.en.budgetMin`: "This style can't go below…" uses a straight apostrophe (G log). It should be
  "can’t", matching "You’re" and "I’m".

### D3-05 [P2] EN item names still repeat the eyebrow and mix "3-seater" and "three-seat"
- Owner: catalog (plus the `shortNameOf` EN fallback in ui)
- Evidence: `sheet-A-panel.png`: "Bedding / Bedding: white percale, oat throw, terracotta cushion" (and the same
  prefix on all 7 tiles), "Floor lamp / Sable brass floor lamp, 162 cm", "Sofa / Lansbury 3-seater sofa", "Brighton
  three-seat sofa". RU is already clean («Диван / Lansbury, трёхместный»), so the two languages differ in quality.
- Fix: `format.js` `shortNameOf()`, EN branch. Strip a leading "Bedding:", "Decor:", "Cushions:" or "Kitchen:" and
  a trailing category noun matching `typeLabel()` ("… sofa", "… floor lamp", "… armchair"). That gives "Lansbury
  3-seater", "Sable brass, 162 cm", "White percale, oat throw, terracotta cushion". Catalog: standardise "3-seater".

### D3-06 [P2] Lead form: three copy details and one small target
- Owner: ui
- Evidence: `A15-lead-errors.png`, `F15`/`F16`, F log.
- Fix:
  - An empty phone shows "Check the number" / «Проверьте номер». When the field is empty, use "Enter your phone
    number" / «Укажите телефон», and keep «Проверьте номер» for a malformed value.
  - Consent «Согласен, что Villar свяжется…» is masculine. Use «Разрешаю Villar связаться со мной по этой заявке».
    EN: "Villar may contact me about this request".
  - The phone summary wraps as «Стиль «Кашемир» · / 33 предмета» (`F15`). On ≤ 734 px drop the « · » and put the
    count on its own line (`.lead-sum-top` → `flex-direction: column; align-items: flex-start`).
  - «Посмотреть состав» / "View items" (`.lead-list-btn`) is 36 px tall on touch. Use
    `@media (pointer: coarse) { .lead-list-btn { min-height: 44px; } }`.

### D3-07 [P2] Phone: the first view still shows no sofa
- Owner: engine
- Evidence: F log. The sofa's centre projects to x = −20 at 390×844 in Entry; `F02` shows a grey sliver at the
  bottom-left. The first thing a phone visitor sees is a bed and a window, not the living room they are about to
  furnish.
- Fix: a portrait variant of `eye` when aspect < 0.8. Yaw about 12° toward the sofa, or pull back 0.5–0.6 m. Target:
  the sofa's bounding box at least 70 % inside the frame, with the window still in view.

### D3-08 [P2] The hover card lingers over the dock after the panel closes and through a style switch
- Owner: ui
- Evidence: `sheet-A-style-toast.png`. With the pointer resting on the curtains, the card (Curtains · 478 AED)
  sits on top of «Entry · Living» in the dock through the whole style switch and the toast.
- Fix: in `hovercard.js` `place()`, treat the dock and top controls as no-go rects: flip above the cursor when the
  card would overlap `.stage-dock`. Hide the card on `store.on('style')` and for 600 ms after `hud.close()`.

### D3-09 [P2] Palette: the smallest tier shows a bare "5%" without its name
- Owner: ui
- Evidence: `A19-style.png` (Light Oak: "60% Base · 35% Secondary · 5%").
- Cause: `.ratio-tier.is-tiny span { display: none; }` hides «Акценты» / "Accents" below 6 %.
- Fix: keep the label and let it overflow to the left: `.ratio-tier.is-tiny { overflow: visible; text-align: right; }`
  `.ratio-tier.is-tiny span { display: block; white-space: nowrap; direction: rtl; }`. Or render the tiny tier's
  label after the bar as «5 % акценты».

### D3-10 [P2] Thumbnail placeholders read as missing pictures
- Owner: ui, engine
- Evidence: `A10`, `A11`, `F09`. 3.5 s after opening (software GL), the bedding, floor lamp and bed tiles still show
  a flat coloured dot in a beige box. The sofa tiles had loaded because they were prebuilt. The dot looks like an
  empty state, not "loading".
- Fix: UI: `.tile-vis.is-loading { background: linear-gradient(100deg, #efebe4 30%, #f7f4ef 50%, #efebe4 70%) 0 0 / 200% 100%; animation: shimmer 1.2s linear infinite; }`,
  drop the dot while loading, and keep it only as the no-3D fallback (`.is-swatch`). Engine: when the HUD opens,
  render the visible tiles first (current, then the next 3) before prebuilding the rest. Target on a GPU: the first
  4 thumbnails in ≤ 600 ms.
