# Villar, review round 2: design (Human Interface pass)

Build `baa1f80`, local harness (headless Chrome, SwiftShader, `--csp`). Viewports: 1440×900 EN and RU, 1280×800 EN,
1024×768 RU, 768×1024 touch EN, 390×844 @2x touch RU. The 390 EN run (G) was still queued on the shared lock when
this was written; the RU phone run covers the same flows. Evidence is in `/tmp/rev2/design/`; step files are in
`/tmp/rev2/design/steps/`. Screenshot prefixes: A = 1440 EN, B = 1440 RU, C = 1280 EN, D = 1024 RU, E = 768 touch
EN, F = 390 RU. `sheet-*.png` are contact sheets and `crop-*.png` are zooms.

## Verdict

**Score: 6.5 / 10.** There are no P0s. The page now feels like one calm product: the poster hero leads into the
stage, the live total sits under the stage on a laptop, swaps show real thumbnails, and sets, typography and
reduced motion are handled with care. The core loop still breaks the founder's "как в игре" promise. On laptops the
item card and the tray cover 59–68 % of the stage, so the camera flies to an object and the UI then hides it
(`C04-confirm.png` is the clearest case). On phones two totals sit on top of each other most of the time. Several
surfaces drop out of the chosen language or say something untrue.

**What clearly improved since round 1**
- At 1440×900 the style picker, stage, AI line and total fit one viewport (`A03`). The round-1 P0 (total invisible) is fixed.
- The engine renders the tile thumbnails on a neutral backdrop, so options are now distinguishable (`A06`, `B16`).
  The flat colour squares are gone.
- Sets: the set price is shown with a unit note («1 048 AED · 2 × 524 AED», «Меняются сразу 2 шт.», `B16`).
  The round-1 math confusion is fixed.
- The budget is grouped by zone, with subtotals, two columns, and "× n" only when n > 1 (`A14`).
- The poster sits under the hero and becomes the loading state (`B01`). Sunrise and sunset icons now differ
  (`crop-A03-time.png`). Segmented controls and icon buttons are 44 px. The phone time pill shows its label (`F05`).
- Focus mode hides the scene chrome and shows a Back pill. Esc is layered (confirm, then panel), and focus is
  restored. Budget row → HUD works and scrolls the stage back into view (`B16`).
- Typography: AED and units are joined with NBSP, dimensions use spaced «×», RU uses «», and the ru-RU / en-US
  separators ("36 387 AED" / "36,387 AED") match between the UI and the assistant.
- Reduced motion is handled in CSS, the count-up, `scrollToEl`, the camera `flyTo` and the swap fades.

**Motion.** On software GL each screenshot took 0.3–23 s, so the "150–300 ms" sequences (`sheet-A-fly.png`,
`sheet-A-swap.png`, `sheet-A-back-style.png`) captured end states and some mid-dissolve frames, but no
in-between camera frames. From the code, the curves are right: fly 0.8–1.3 s with upright interpolation, swap
dissolve 280 ms, style stagger 320 ms per slot, HUD 360/560 ms with a 120 ms delay. The swap is seamless: framing
holds and only the object dissolves (`sheet-A-swap-detail.png`). What the harness *can* show is how fast the UI
answers a click, and that is D2-08.

**New information on known issues**
- #2 (other-style tiles overlap): it happens on desktop too, and the cause is CSS. See D2-04.
- #5 (card's last line clipped): the cause is `.hud-card { max-height: calc(100% - var(--tray-h) - 48px) }`. At
  1280×800 that is 180 px for 320 px of content (172 px at 1024×768, cut mid-line through «Материалы»), and with
  the cross-style confirm open it drops to 108 / 100 px (name and price only, `C04`, `sheet-D-hud.png`). D2-01
  fixes it as a side effect.
- #3 (Evening stall): a style switch stalls the same way (first change painted 23 s after the click), and the
  pressed chip isn't painted either. See D2-08.

---

## P1: visibly wrong, the founder would notice

### D2-01 [P1] On laptops the HUD covers most of the stage, so the object you flew to is hidden or cropped
- Owner: ui (layout), engine (focus fit)
- Repro: 1440×900 or 1280×800 EN, Dark Walnut, Day, Entry. Open the sofa (`villarUI.hud.open({slotId:'sofa'})`),
  or click the armchair at (429, 498).
- Expected: the camera frames the whole object, with margin, in the part of the stage the UI leaves free, the way
  a game's inspect view does.
- Actual: the card (300 + 32 px) and the tray (220 + 32 px) leave 1060×296 px free at 1440×900 (41 % of the
  stage), 902×196 px at 1280×800 (32 %), 655×188 px at 1024×768 (28 %, `sheet-D-hud.png`), and 408×420 px at
  768×1024 (34 %, `E04`). The sofa's back is cut by the stage top and its seat is under the tray
  (`A06-hud-sofa.png`). At 1280 only a strip of the sofa is visible above the confirm and the tray (`C04-confirm.png`).
  The armchair's legs are under the tray (`B09`). The bed shows only the duvet (`B12`).
- Cause (engine): `camera.js` `focusOn()` picks the distance as `d0 = clamp(0.95 + size·1.25, 1.25, 3.6)` and steps
  it down (×0.86/0.72/0.58) until the spot is free. The FOV, the aspect and the free rect never enter the
  calculation. Insets only shift the optical axis (`setInsets` → `state.inset`, clamped to 0.7).
- Fix:
  - UI: on desktop, merge the card and the tray into one right-hand column instead of an L-shape (the Maps
    place-card pattern). Use one glass panel, `position:absolute; top:16px; right:16px; bottom:16px; width:360px;
    overflow-y:auto; border-radius:18px`. Order: eyebrow / name / price, then «В этом стиле» as a 2-column grid of
    156 px tiles, then «Из других стилей» (grouped, same grid), then «Подробнее» / "Details" (size, materials,
    colour, fact) as a disclosure. `insets()` → `{ right: 392, bottom: 0 }`, which leaves 1000×548 px free
    (72 %) at 1440×900 and 842×448 px at 1280×800. This also removes known issue 5 and D2-04.
  - Engine: `dist = 1.08 · r / sin(min(vFov·freeH/H, hFov·freeW/W) / 2)`, where r is the bounding-sphere radius,
    with the free rect applied through `setViewOffset`. When that spot is blocked, change the angle before moving
    closer. Target: no pixel of the selected object's outline under a panel or outside the stage.

### D2-02 [P1] The style picker doesn't follow a language switch
- Owner: ui
- Repro: boot in EN (headless default), click «RU».
- Expected: «Стиль · Тёмный орех · Светлый дуб · Кашемир · Средиземноморье».
- Actual: «Style · Dark Walnut · Light Oak · Cashmere · Mediterranean» stays in English. The stage chip right under
  it says «Тёмный орех» (`B01-hero-ru.png`, `B09`, `sheet-F1.png`). The picker only switches after the next style
  change (`sheet-F-stylefeedback.png`). A Russian browser that switches to EN gets the mirror image.
- Cause: `site/js/ui/stylepicker.js` re-renders only on `store.on('style')`.
- Fix: `import { t, onLang } from './i18n.js';` and add `onLang(render);` after `store.on('style', render);`.

### D2-03 [P1] The English page shows Russian palette names for the default style
- Owner: catalog
- Repro: EN, Dark Walnut (the default), Style section (`C08-style-en-2.png`).
- Actual: «Тёплый белый, Светлый дуб, Тёмный орех, Облачный потолок… Тёплый матовый чёрный» above English role
  labels ("Walls · 36%"). `palette-dark-walnut.json` has no `nameEn` on any of its 12 swatches, and no `summaryEn`.
  The other three packs have them.
- Fix: add `nameEn`: Warm white, Cloud ceiling, Light oak, Oat, Milky linen, Dark walnut, Olive, Travertine, Cognac
  leather, Terracotta, Satin brass, Warm matte black. Add a data check that every display field in
  `site/data/*.json` has an `…En` twin.

### D2-04 [P1] "From other styles" is broken on desktop too: groups crush each other, and the left column is half empty
- Owner: ui
- Known issue 2 is filed for phones; this is the desktop case and the cause.
- Repro: 1440×900 or 1280×800, open the sofa or the armchair.
- Actual: «В этом стиле» gets `flex: 1 1 60%` (790 px at 1440) for 3–4 tiles (380–510 px), so half the column is
  empty. «Из других стилей» is squeezed into 40 %. Each `.hud-group` (`min-width:0`) shrinks, and its own `.tiles`
  scroller clips cards mid-word («Anders 3-se», «Pebble three-sea»). The group label then runs under the next
  group: «Светлый ду» is overlapped by the Cashmere dots (`crop-A06-other.png`, `crop-B09-other.png`, `C04`).
  At 768×1024 touch the row is 280 px wide, and «Light Oak / Cash / Mediterrane» overprint each other (`E04-confirm.png`).
- Fix (`studio.css`, Tray):
  ```css
  .hud-same  { flex: 0 1 auto; max-width: 56%; }
  .hud-other { flex: 1 1 0; min-width: 0; }
  .hud-groups { gap: 20px; mask-image: linear-gradient(90deg, #000 calc(100% - 32px), transparent); }
  .hud-group { flex: none; min-width: auto; }
  .hud-group .tiles { overflow: visible; }   /* .hud-groups is the only scroller */
  ```
  With D2-01's column the groups stack vertically, which fixes desktop and phone together.

### D2-05 [P1] "More styles are coming very soon" while three other styles are live
- Owner: ui (copy), coordinator
- Repro: open bedding or any decor set (`B12-hud-nightstand.png`, `B16-line-to-hud.png`).
- Actual: `store.otherStyleOptions()` drops items that are already in my style, so for shared slots the list is
  empty and the HUD prints «Другие стили появятся совсем скоро» / "More styles are coming very soon". This is
  untrue and makes the product look unfinished, in a column that takes 40 % of the tray.
- Fix: when `groups.length === 0`, don't render `.hud-other` or `.hud-sep`, and let «В этом стиле» take the full
  width. If a line must stay, use «Во всех стилях — те же варианты.» / "Every style uses these same options."
  Show `hud.otherSoon` only when `store.styles().length < 2`.

### D2-06 [P1] Phone: the sticky total pill lands on top of the real total bar, so two totals overlap
- Owner: ui
- Repro: 390×844 @2x touch. Tap «Смотреть в 3D».
- Actual: the stage ends at 690, the AI line is at 702–758 and the budget bar starts at 770. The cartbar
  («Итого 36 387 AED · Заказать», 772–832) is drawn over it, and the bar's own 40 px «36 387 AED» shows through the
  glass (`F03`, `F11`, `F13`, `F15`, `sheet-F3.png`). This happens in almost every resting state. With the HUD open,
  the pill also floats over the sheet's tiles and the confirm, so three layers stack at the bottom edge (`F07`, `F10`).
- Cause: `budget.js` counts the bar as visible only at `intersectionRatio ≥ 0.6`.
- Fix: `new IntersectionObserver(([e]) => { budgetOn = e.isIntersecting; syncPill(); }, { threshold: 0, rootMargin: '0px 0px -60px 0px' })`.
  While the HUD is open, hide the pill and put the total in the panel header, right-aligned on the price row:
  «Итого 36 387 AED» at 13 px `--text-2`, with the delta pill beside it.

### D2-07 [P1] The AI line grows by up to 240 px and pushes the input and the total below the fold
- Owner: assistant, ui
- Repro: 1440×900 RU, stage under the nav, type «уложись в 25 000». Phone: the same, in EN or RU.
- Actual: the reply, eight change chips, «Отменить», the input and the suggestions grow the slot from 56 to 294 px
  (`ai_r [24,746,1392,294]`). The input and the total bar leave the screen (budget top 1052 at 900 h,
  `B18-ai-budget-ru.png`). On the phone the slot is 299 px (`F15`). Every reply shifts the page again by 34–70 px
  (`A16`→`A17`→`A20`). The round-1 rule "the total stays visible while you edit" is broken by the newest feature.
- Fix:
  1. Keep the input fixed. Show the reply as one line above it, and collapse the changes into one summary chip,
     «8 замен · −11 406 AED · Показать» / "8 swaps · −11,406 AED · Show", which expands inline to at most 2 rows.
  2. Cap the slot height: `.vai-caption { max-height: 64px; overflow: hidden; }`. Make the suggestion chips
     `position:absolute` under the bar, or hide them after the first exchange. Target: the budget bar moves 24 px at most.
  3. Flash the change in the budget bar (`flashDelta`) after an AI edit, so the total is where the answer lands.

### D2-08 [P1] A style chip gives no immediate feedback: the UI freezes before it says "yes"
- Owner: ui, engine
- Repro: 1440×900 EN, click «Light Oak», screenshots every 250 ms (`A12-style-*`, `sheet-A-back-style.png`).
- Actual: 2.7 s after the click the picker still shows Dark Walnut as active and the stage chip still says Dark
  Walnut. The first changed frame arrives 23 s later (software GL). The engine rebuild runs in the same task as the
  click, so the browser never paints the pressed state. This is «чтобы ничего не лагало» at its most visible: the
  tap seems to do nothing. A real GPU shortens the stall, but the order of operations is still wrong.
- Fix: in the `stylepicker.js` click handler, set `is-active` and `aria-pressed`, show «Меняем стиль…» /
  "Switching style…" in the stage (reuse `.loading-chip`), then
  `requestAnimationFrame(() => setTimeout(() => store.setStyle(id), 0))`. In the engine, yield between slot
  rebuilds (`await scheduler.yield?.()`) so no task runs over 50 ms. Target: the pressed chip paints within 100 ms.
  Do the same for the time-of-day control.

### D2-09 [P1] Assistant copy: an internal mode, a gendered voice, arrow notation and unitless numbers
- Owner: assistant
- Evidence: `A20-ai-unknown.png`, `B18-ai-budget-ru.png`, `F15`, logs in the A, B and C runs.

  | Where (`ai/local.js` `P`, `ai/i18n.js`) | Now | RU | EN |
  |---|---|---|---|
  | `unknown`: what every free-form request gets while the live model is off (known issue 6) | «Сейчас я работаю в упрощённом режиме…» / "I’m in basic mode right now…" | «Пока я понимаю простые просьбы. Например: «покажи вечер», «уложись в 25 000 AED», «диван светлее».» | "I understand simple requests for now — try “show the evening”, “keep it under 25,000 AED” or “a lighter sofa”." |
  | `budgetOk`, `many`, `style`, `time.evening`, `styleCantKeep` | «Уложился…», «Обновил…», «включил лампы», «Поставил…» | «Готово: 8 замен, итог 24 981 AED.», «Обновлено: 3 предмета.», «Вечер: лампы включены.», «…вместо него — «Daventry».» | — |
  | change chip `${label} → ${name}` | «Прикроватные тумбы → Nazario» | «Прикроватные тумбы: Nazario» | "Nightstands: Nazario" |
  | default chips and examples | «Уложись в 20 000», "Keep it under 19,000" | «Уложись в 20 000 AED» | "Keep it under 19,000 AED" |
  | `itemName()` | «Квадратный, 80×80», «Cloud, 160×200» | run through `pretty()` from `ui/format.js`: «80 × 80» | same |
  | `view.bed`, `view.dining` | «Спальная зона.» / "The sleeping area.", "The dining corner." | «Спальня.», «Столовая.» (the dock's words) | "Bedroom.", "Dining." |
  | `budgetAlready` | "You're" (straight apostrophe; everything else uses ’) | — | "You’re already within budget…" |

---

## P2: polish

### D2-10 [P2] The budget bar jumps 63 px sideways after the first change
- Owner: ui
- Evidence: the meta column is at x = 307 in `A03` and x = 370 after one swap in `A09`.
- Cause: `.budget-delta` is an in-flow flex child. It hides with `opacity:0` but keeps its text and about 63 px of
  width forever.
- Fix: `.budget-total { position: relative; } .budget-delta { position: absolute; left: 100%; bottom: 6px; margin-left: 10px; }`.
  Give `.budget-sum` a `min-width` of about 300 px so nothing reflows.

### D2-11 [P2] The cross-style confirm reads as "the total is negative" and crops the card
- Owner: ui
- Evidence: `A09`, `C04`: "The room switches to “Light Oak”: 25 items change, total −13,555 AED." The bar spans
  the stage above the tray and cuts the card to 208 px (108 px at 1280).
- Fix copy (`hud.consequence`, `hud.switch`), passing `total: aed(store.total() + pv.delta)`:
  - RU: «Комната перейдёт в стиль «Светлый дуб»: поменяются 25 предметов. Новый итог — 23 432 AED (−13 555 AED).»
    Buttons: «Отмена» and «Перейти в стиль «Светлый дуб»».
  - EN: "The room switches to Light Oak: 25 items change. New total 23,432 AED (−13,555 AED)." Buttons: "Cancel"
    and "Switch to Light Oak".
- Fix placement: anchor the confirm under the pending tile inside «Из других стилей» (or in the D2-01 column),
  `max-width: 420px`. Drop the `.hud.has-confirm .hud-card` max-height reduction.

### D2-12 [P2] Tiles: two "selected" signals, names that truncate to the same words, duplicate items
- Owner: ui, coordinator
- Evidence: `B09` (in RU «Luna, натуральная…» and «Clyde, натуральная…» read the same); `crop-A06-other.png`
  (Anders appears under both Light Oak and Mediterranean); `crop-B09-other.png` (Natura appears twice).
- Fix: keep the 2 px accent ring and replace the dark «✓ Выбрано» pill with a 20 px accent check badge at the
  thumbnail's top-right (`.tile.is-current .tile-vis::after`). Then
  `.tile { width: 132px } .tile-name { font-size: 12.5px; -webkit-line-clamp: 3; min-height: 48px }`. Show each
  item once in `otherStyleOptions()`, under the first style that has it.

### D2-13 [P2] Item card: a comma list of capitalised materials, and EN names repeat the category
- Owner: ui, catalog
- Evidence: `crop-A06-card.png` ("Woven fabric, Solid wood frame, Walnut-tone wood base and legs"), `B09`
  («Натуральная кожа, Каркас — массив дерева, тон орех»). Round-1 P1-9 is still open. `format.js` has
  `materialsList()`, but `hud.js` `renderCard` joins with ", ".
- Fix: render `materialsList(item)` one per line (`<br>`, max 3). Catalog: 0 of 141 items have
  `shortName`/`shortNameEn`. In EN the card reads "Sofa / Lansbury 3-seater sofa", and sofas mix "3-seater" with
  "three-seat". Add `shortNameEn` ("Lansbury, 3-seater") and use "3-seater" everywhere.

### D2-14 [P2] Style section: jargon in pack copy, and rules for one pack only
- Owner: catalog, ui
- Evidence: B and C run logs, `B02`, `C09`/`C10`, `F19`.
- Rewrites:
  - Dark Walnut: «Каждый предмет реален и доступен к покупке.» / "Every piece is real and available to buy." →
    «Всё это настоящие вещи — их можно заказать.» / "Every piece is real, and you can order it."
  - Light Oak: «…на ступень светлее пола… с пустым местом вокруг вещей» → «Японди для солнечной студии: светлый
    дуб, лён цвета камня, рисовая бумага и матовая керамика. Немного угольного дерева и тонкого чёрного металла
    для графики, шалфей для свежести — и много воздуха вокруг вещей.» / "Japandi for a sunny studio: light oak,
    stone-coloured linen, rice paper and matte stoneware. A touch of charcoal wood and fine black metal for
    definition, sage for freshness, and plenty of air around every piece."
  - Cashmere: «Тёмных масс нет: глубину дают фактура и ступени светлоты…» / "No dark masses: depth comes from
    texture and steps of lightness…" → «Никаких резких контрастов — только фактуры и мягкие переходы тона.» /
    "No harsh contrast, just texture and soft shifts of tone."
  - Mediterranean: drop «Пак собран для посуточной аренды у моря.» / "Made for short-term rentals by the sea." ("пак"
    is an internal word).
  - «Пропорция 60 / 30 / 10» → «Как распределены цвета» / "How the colours are balanced". «Светлый дуб (пол)» →
    «Светлый дуб пола».
- No stylepack ships `consumerRules`. The page falls back to hard-coded rules for Dark Walnut only, so «Правила
  стиля» disappears for the other three (`rulesHidden: true` for Cashmere). Add 3–4 rules per pack, in RU and EN.

### D2-15 [P2] Style names in quotes in English
- Owner: ui
- Evidence: "33 items · “Dark Walnut” style" (`A03`), "Switch to “Light Oak”" (`A09`), "the whole “Light Oak” set" (`A15`).
- Fix: `dom.js` `quoted()` returns the bare name when `isEn()`; keep «» in RU. Result: "33 items · Dark Walnut style".

### D2-16 [P2] The order modal says "soon" three times
- Owner: ui
- Evidence: `A15`, `B17`, `F18` («Скоро» / «совсем скоро» / «Скоро весь комплект…»).
- Fix: eyebrow → «Ваш комплект» / "Your set" (then remove `order.set` above the total). Keep the title. Description:
  «Весь комплект «Тёмный орех» можно будет заказать одной кнопкой — привезём и соберём всё за один день.» /
  "You’ll be able to order the whole Dark Walnut set with one button — we deliver and assemble everything in one
  day." `.modal-body { mask-image: linear-gradient(#000 calc(100% - 24px), transparent); }`; the list is cut hard
  at «Pavia marble…».

### D2-17 [P2] The mirror and the runner are filed under «Окно и зелень»
- Owner: ui
- Evidence: `A14-budget-open.png` ("Window & greenery: olive tree, curtains, runner, mirror").
- Fix: in `labels.js`, add a zone `entry` («Прихожая» / "Entry") for `runner`, `mirror` and `towels`, or rename it
  «Окно и прихожая» / "Window & entry".

### D2-18 [P2] Phone: the dock cuts off «План», and the dock slides sideways when the HUD opens
- Owner: ui
- Evidence: `sheet-F1.png` («Вход · Гостиная · Спальня · Столовая · У окна · П…» at 390 px with no fade). In the F
  run log the dock is at x = −147 with the HUD open: on phones, `.stage.is-focus .stage-dock` inherits the desktop
  `translateX(-50%)`, so it slides 171 px left while fading.
- Fix: `@media (max-width:734px) { .stage.is-focus .stage-dock { transform: translateY(8px); } }`. Add a
  `labelShort` for phones: «Вход · Диван · Кровать · Стол · Окно · План» / "Entry · Sofa · Bed · Table · Window · Plan".
  While the dock overflows, add `mask-image: linear-gradient(90deg, #000 calc(100% - 20px), transparent)`.

### D2-19 [P2] Phone: the Back gesture leaves the site, and the first view hides the sofa
- Owner: ui, engine
- Evidence: there is no `pushState`/`popstate` in `site/js`, so Android Back or an iOS edge swipe leaves the page
  instead of closing the panel. In the portrait Entry view the sofa's centre projects to x = −20 (`F` log, `F04`).
  Round-1 P1-17 is still open.
- Fix: on phones, `history.pushState({ hud: slotId }, '')` when the HUD opens and close it on `popstate`; do the
  same for the modal. Engine: a portrait variant of `eye` (pull back about 0.6 m or yaw about 12° toward the sofa
  when aspect < 0.8), so the sofa, the bed and the window are all in frame.

### D2-20 [P2] The logo changes colour with each style, and the Mediterranean and Light Oak accents come out muddy
- Owner: ui, catalog
- Evidence: `sheet-F-stylefeedback.png` (after Mediterranean the «V» mark and «Заказать» turn khaki),
  `A13`/`A14` (Light Oak makes every CTA charcoal, and «Hide items» reads grey). `accent.js` takes the first `wood`
  swatch and darkens it toward `#1d1d1f` until it reaches 4.6:1, which drains the colour.
- Fix: give the brand mark a fixed `--brand: #4a3426` in both wordmark SVGs in `index.html`. Add an optional
  `uiAccent` to `palette-*.json`: Mediterranean `#9a4a2c` (terracotta, 6.2:1 on white), Light Oak `#4f5a46` (deep
  sage, 7.3:1) or `#6b5a45` (oak, 6.6:1). Keep the current derivation as the fallback.

### D2-21 [P2] Assistant accessibility: small touch targets, a low-contrast placeholder, and a ticker that never stops
- Owner: assistant (the nav links: ui)
- Measured: `.vai-undo` 26 px (40 on touch), `.vai-hist-btn` 28 (40), `.vai-chip` 34 (40), `.vai-send` 36 (40).
  The ghost placeholder `#8a8a8f` on `#fff` is 3.44:1 (it carries the examples, so it needs to be read).
  `.vai-h-who` `#86868b` at 12.5 px is about 3.5:1. The placeholder rotates every 3.6 s indefinitely, including
  under reduced motion (it swaps text without the slide). The same applies outside the assistant: at 768×1024
  touch the nav links are 29 px tall (E run log), because only `.btn-sm` gets the coarse-pointer bump.
- Fix: `@media (pointer: coarse) { .vai-chip, .vai-undo, .vai-hist-btn { min-height: 44px } .vai-send { width: 44px; height: 44px } .nav-links a { padding: 15px 0 } }`.
  `.vai-ghost-line { color: #6e6e73 }` (4.9:1). `.vai-h-who { color: var(--text-2) }`. Stop after 3 rotations;
  never rotate under `prefers-reduced-motion`.
  Everything else measured passes: eyebrow 6.0:1, `--text-2` text 4.9–5.1:1, budget links 6.2–7.9:1, and the chip
  `.muted` 7.6:1. Focus rings are visible on the nav, Back and tiles (`crop-B10.png`, `crop-B24-25.png`).

### D2-22 [P2] Still open from round 1: the grey void in Plan, and the hard white selection halo
- Owner: engine
- Evidence: `B14-top-view.png` (a flat cool-grey void, plus a balcony rail floating on the right); `A06`, `B12`,
  `C04` (a 2 px white outline with visible stair-steps along the sofa and duvet tops).
- Fix: as in round-1 P2-12 and P2-13. Use the warm stage gradient `#efe9e2 → #e6dfd6` (or a transparent clear) for
  `top`. Make the outline 1.5 px `rgba(255,255,255,.85)` with a 6 px glow at 25 %, anti-aliased.
