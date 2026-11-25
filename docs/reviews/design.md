# Villar: Human Interface design review (pre-launch)

Reviewer: HI design pass against the Apple bar (apple.com product pages and HIG: clarity, deference, depth).
Scope: `site/index.html` + `site/css/*` + `site/js/ui/*` + `site/js/main.js`, rendered in headless Chrome
(SwiftShader WebGL) at 1440×900, 1280×800, 1024×768, 390×844 (touch) and 375×667 (touch).
I edited no project files. All evidence is in `/tmp/shots/`. I captured it with `tools/shoot.mjs` and a
scratch copy of it at `/tmp/qa/shoot2.mjs`, which adds real mouse moves, clicks, keyboard and touch, plus
`--block` to force the plan fallback.

**Overall verdict:** the bones are right. The type scale, the single walnut accent, glass overlays, the
segmented controls, the true-minus delta pills and the restraint in color all read as Apple-adjacent.
What breaks the feel is the product loop itself: (1) the live total is not on screen while you edit,
(2) the swap list shows flat color squares instead of the things you are choosing between, (3) on
phones the sheet buries the 3D you are editing, and (4) several strings read like internal design
notes, not consumer copy.

Owner tags: **[UI]** = interface (index.html, css, ui/*, main.js); **[ENG]** = engine;
**[DATA]** = catalog/stylepack/palette JSON; **[CORE]** = coordinator (`js/core/*`).

---

## P0: broken / launch blockers

### P0-1. The live total never appears after the main CTA [UI]
- Evidence: `/tmp/shots/rev-d-1440-studio-ready.png`, `/tmp/shots/cta1440-after-open-studio.png`
  (both show blank space under the stage). Measured after clicking «Открыть студию»: `#budget` has
  `opacity: 0` at 1440×900 (top 839 px), 1280×800 (750 px) and 1024×768 (721 px).
- Why: `#budget` is a `.reveal` element. The reveal observer uses `rootMargin: 0 0 -8% 0`, so its
  bottom edge is 828 px at 900 px height. It measures the *transformed* rect (`translateY(28px)`).
  `scrollToEl(stage)` puts the budget just past that edge, so it never intersects and stays invisible
  until the user scrolls on their own. The delta pill (`+1 200 AED`) disappears after 2.2 s, so
  "watch the total update live" never happens. At this viewport the stage (702 px) plus the budget
  (138 px) plus the nav (52 px) don't fit together anyway.
- Fix:
  1. Remove `reveal` from the product UI: `index.html` l.76 `class="studio-shell"` and l.93
     `class="budget"`. The editor should never fade in on scroll.
  2. Size the stage so the stage and the budget fit in one viewport on laptops:
     `.stage { height: clamp(440px, calc(100svh - var(--nav-h) - 176px), 820px); }`
     (gives 672 px at 900 h, 572 px at 800 h, 540 px at 768 h).
  3. `scrollToEl(stageEl)` should place the stage top at `nav + 12px`, not centred
     (`motion.js` l.47: pass `{ center: false }` and use `pad = 12`).
  4. Mobile (≤734 px): add a compact sticky summary while `#stage` is on screen and `#budget` is not:
     `position: fixed; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); height: 56px; border-radius: 999px;`
     using `.glass`. Content: «Итого 32 741 AED» plus a 44 px «Заказать» button. Show the delta pill there.

### P0-2. The swap delta reads as a pricing error for multi-piece items [UI]
- Evidence: `/tmp/shots/d1440-13-sheet-nightstand.png`, `/tmp/shots/m390-07-sheet-nightstand.png`.
  The current item is shown as «2 327 AED». The option row says «359 AED» and next to it «−3 936 AED».
  2 327 − 359 = 1 968, so a user sees wrong math. The delta is ×2 (both nightstands) but the price
  next to it is per piece. «−648 AED» for Verve has the same problem.
- Fix (`sheet.js` l.45 and l.69–72): when `qty > 1`, show every price for the whole set and put the
  unit price small:
  - Header price: `4 654 AED` with `<small>2 × 2 327 AED</small>`.
  - Option row: `opt-price = price(opt, qty)` («718 AED»), `opt-meta` ends with «· 359 AED за шт.».
    The delta stays «−3 936 AED».
  - Type line: «Прикроватная тумба · 2 шт.» (drop «в квартире», which wraps to 2 lines today).
  - Note (l.79), replacing «Замена применяется ко всем 2 предметам этого типа…»:
    `Меняются сразу ${qty} шт. — итог обновится автоматически.`

### P0-3. The mobile palette bar shows clipped glyphs [UI]
- Evidence: `/tmp/shots/m390-12-full-part3.png`. The labels render as «36°», «14», «10», «12'» because
  the segments are narrower than the label plus 14 px padding.
- Fix: `@media (max-width: 734px) { .ratio-seg span { display: none; } }`. In `sections.js` l.70,
  render the label only when `s.share >= 0.12` (and on desktop also only when the segment is
  ≥ 44 px wide). Use `.ratio-seg { padding: 10px 12px; }`.

### P0-4. A style-rule heading is a broken fragment, and the rules read as internal spec [UI][DATA]
- Evidence: `/tmp/shots/d1440-29-full-crop2.png`, `/tmp/shots/m390-12-full-part4.png`. Rule 03's title is
  «Акцентов по оттенку», because `splitRule()` cut «Акцентов по оттенку — не больше двух семейств…»
  at the dash. The bodies show «≤4 крупных ореховых массы», «в любом кадре», «серо-белёные породы —
  запрещены», «семейств». That is designer jargon on a consumer page.
- Fix: stop auto-splitting. Ship a curated `consumerRules: [{title, body}]` in the stylepack [DATA] and
  render that only. Suggested copy:
  1. **Орех — главный акцент.** Тёмного дерева немного: оно задаёт характер, а не заполняет комнату. Между тёмными вещами всегда есть светлое — ковёр, текстиль или камень.
  2. **Два тона дерева.** Тёмный орех в мебели и светлый дуб на полу. Без вишни, красного дерева и выбеленных пород.
  3. **Два акцентных цвета.** Олива и терракота — в подушках, керамике и искусстве. Всё крупное — в тёплых светлых тонах.
  4. **Одна вещь из кожи.** Коньячная кожа — только у кресла. Диван остаётся светлым.

---

## P1: noticeably off

### P1-1. On phones the bottom sheet hides the 3D you are editing [UI][ENG]
- Evidence: `/tmp/shots/m390-05-sheet-sofa.png`, `/tmp/shots/m375-05-sheet-sofa.png`. The sheet is
  `max-height: min(78vh, 680px)` over a 28 % scrim, so the stage is fully covered and dimmed. You
  cannot see a swap happen. At 375×667 only one option is visible above the fold.
- Fix: open at a medium detent and let the user drag up to a large one (iOS sheet detents).
  `.sheet { max-height: min(52svh, 460px); }` with `.sheet.is-expanded { max-height: min(86svh, 720px); }`.
  No scrim at the medium detent (`.sheet-scrim.is-open { opacity: 0 }` unless expanded). On open,
  scroll so the stage top sits under the nav. [ENG]: add `villar.setInsets({ bottom: px, right: px })`,
  which calls `camera.setViewOffset()` so the selected object is framed in the visible part of the stage.

### P1-2. On desktop the selected object can sit behind the sheet [ENG][UI]
- Evidence: `/tmp/shots/t1024-04-sheet-tv.png`. The TV unit is selected and fully covered by the sheet.
- Fix: the same `setInsets({ right: 392 + 24 })` call when the sheet opens; reset it on close.
  If the object is still covered, ease the yaw toward it (≤ 400 ms, `--ease`).

### P1-3. The hover card stays on top of the open sheet and covers the dock [UI]
- Evidence: `/tmp/shots/d1440-10-sheet-armchair-click.png`. After clicking the armchair, the card
  repeats the sheet's content and covers «Спальня» in the dock. The engine keeps re-emitting hover
  because the pointer is still on the object.
- Fix (`main.js` l.77):
  `onHover: (p) => (p && !(sheet?.isOpen && sheet.current?.slotId === p.slotId) ? card.show(p) : card.hide())`.
  Also clamp the card to the stage rect, not the viewport (`hovercard.js` `place()`: use
  `stage.getBoundingClientRect()`). In `/tmp/shots/d1440-05-hover-nightstand.png` it hangs 27 px below the stage.

### P1-4. Hover card stuck after the plan→3D handoff [UI]
- Evidence: `/tmp/shots/L1440-04-plan-hover.png`, `/tmp/shots/L1440-07-thumb.png`. A card for «Диван»
  that was opened in plan mode keeps floating over the 3D scene after the switch, and survives a view
  change. The engine only emits `hover:null` after it has hovered something itself.
- Fix: in `stage.js` `onReady()` (l.251) call `onHover(null)` before `hideLoading()`. Also call it in
  `plan.destroy()`.

### P1-5. Sheet scroll clips content under the header, and the price scrolls away [UI]
- Evidence: `/tmp/shots/d1440-11-sheet-armchair-swapped.png` (after a swap only the bottom half of
  «1 799 AED» is visible) and `/tmp/shots/d1440-15-sheet-sofa-scrolled.png` (option text is cut hard,
  with no divider or fade).
- Fix: put the price in the header so it is always visible, and add a scroll edge:
  `.sheet-body { mask-image: linear-gradient(#0000 0, #000 12px, #000 calc(100% - 20px), #0000); }`
  and `.sheet.is-scrolled .sheet-head { box-shadow: 0 0.5px 0 var(--hairline-strong); }`
  (toggle `is-scrolled` from a passive `scroll` listener on `.sheet-body`).

### P1-6. Swap options can't be told apart (flat color tiles instead of products) [ENG][UI]
- Evidence: `/tmp/shots/d1440-14-sheet-sofa.png` shows six near-identical cream squares;
  `/tmp/shots/d1440-10-sheet-armchair-click.png` shows Luna and Clyde as two identical cognac squares.
  The header tile (56 px gradient square) reads as a missing image.
- Fix: [ENG] expose `villar.thumbnail(itemId, { size: 96 })`. The generators are parametric, so render
  each option offscreen on a neutral `#f2efe8` backdrop with a 3/4 view, and cache the data URL.
  [UI] use it in `.opt-tile` and `.sheet-tile` (`object-fit: contain`) and keep the color dot in the meta line.
  Until thumbnails exist, drop the header tile and shrink `.opt-tile` to a 12 px color dot, so the
  list does not pretend to show images.

### P1-7. Information order in the sheet: the action sits below the fold [UI]
- Evidence: `/tmp/shots/m375-05-sheet-sofa.png` («Заменить на» starts at y = 523 of 667) and
  `/tmp/shots/d1440-13-sheet-nightstand.png`.
- Fix: order = header (type eyebrow, short name, price) → «Заменить на» list → «Характеристики»
  (dims, color, materials) → one-line note. Remove the «✓ Совместимо со стилем «Тёмный орех»» banner
  (it is true for every item by construction) and fold it into the note:
  «Все варианты подобраны под стиль «Тёмный орех» — по размеру, цвету и материалам.»
  Rename «Сейчас» → «Выбрано».

### P1-8. Numbers and units break across lines [UI][CORE]
- Evidence: `/tmp/shots/d1440-15-sheet-sofa-scrolled.png` and `/tmp/shots/m390-05-sheet-sofa.png`
  («213 × 92 × 88 / см», «194 × 96 × / 85 см»); `/tmp/shots/m390-09-budget.png`
  («стиль «Тёмный / орех»»).
- Fix: `format.js` l.12–15: join with `' × '` and end with `' см'`. In the option meta,
  wrap the dims in `<span style="white-space:nowrap">`. In `fmtDelta` (`dom.js` l.55) and `formatAED`
  ([CORE] `data.js` l.21) use `' AED'`. Wrap pack names in quotes with NBSP
  (`«Тёмный орех»`). Keep the ru-RU NBSP group separator; it matches apple.com/ru.

### P1-9. Names repeat their category; materials are ambiguous [UI][DATA]
- Evidence: `/tmp/shots/d1440-05-hover-nightstand.png` and `/tmp/shots/d1440-10-sheet-armchair-click.png`:
  «Прикроватная тумба / Прикроватная тумба Suri…», «Кресло / Кресло Luna…», «Подушки / Подушки: лён…».
  Materials are joined with commas inside comma-separated items: «Натуральная кожа, каркас — массив
  дерева, тон орех» (is «тон орех» a material?).
- Fix: [DATA] add `shortName` («Luna, натуральная кожа», «Suri, рифлёный орех», «Лён, олива и
  ржавчина — 3 шт.»). [UI] use `shortName` under the type eyebrow in the hover card and the sheet, and
  the full `name` in the budget and the modal. Render materials one per line in the sheet
  (`<dd>` with `<br>`), and show only the first material in the hover card. Hover card content should
  be: eyebrow, name, price, dims. Drop materials and color from the card; that cuts its height about 40 %.

### P1-10. First impression: a text-only hero, and the product starts about 1 000 px down [UI][ENG]
- Evidence: `/tmp/shots/rev-d-1440.png`. The first viewport is typography only; the 3D stage starts
  below the fold after another full-height section head. Loading (`/tmp/shots/rev-d-1440-studio.png`,
  `/tmp/shots/L1440-02-loading-25s.png`) is a blank beige card with a logo and a 3 px bar.
- Fix: lead with the product. Put a pre-rendered poster of the `eye` view (day, AVIF ~120 KB) directly
  under the hero CTAs, full-bleed with a 28 px radius, and reuse it as the stage background while the
  engine loads, cross-fading to live 3D (`opacity 600ms var(--ease)`). Hero padding:
  `clamp(48px, 8vh, 96px) var(--gutter) clamp(24px, 4vh, 40px)`, and `.t-hero` max 72 px so the poster
  peeks above the fold at 1440×900. Keep the phase labels («Строим стены…»); they're charming.
  Overlay them as a small glass chip on the poster instead of the full-card loader.

### P1-11. The budget list looks like a spreadsheet [UI]
- Evidence: `/tmp/shots/d1440-21-budget-list.png` (3 columns, 22 rows, 9 of 22 names ellipsized
  «Подушки: лён, олива, ржавчина — к…», «× 1» on almost every row, and the category repeated under
  each name). `/tmp/shots/m390-12-full-part2.png`: on mobile nearly every name is truncated.
- Fix: group by zone («Гостиная», «Спальня», «Столовая», «Окно и декор») with a subtotal per group.
  `.budget-lines { grid-template-columns: repeat(auto-fill, minmax(min(100%, 460px), 1fr)); }` (max 2 cols).
  `.line-name { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }`.
  Show `× n` only when n > 1. Replace the category subtitle with dims or remove it. Hover:
  `.line-btn:hover { background: var(--bg-alt); border-radius: 10px; }` (the current 12 %/88 % gradient
  looks like a rendering glitch).

### P1-12. The primary CTA leads to a dead end [UI]
- Evidence: `/tmp/shots/d1440-23-order-modal.png`, `/tmp/shots/m390-11-order.png`. «Заказать всё в один
  клик» (nav and budget) opens «Скоро … Понятно». The only action is to dismiss, and the note says the
  choice is lost on reload.
- Fix: set expectations on the button and give the modal a useful action. Budget CTA → «Заказать
  комплект». Modal title → «Заказ откроется совсем скоро». Description → «Скоро весь комплект «Тёмный
  орех» для этой студии можно будет заказать одной кнопкой. Привезём и соберём всё за один день.»
  Persist the selection in the URL hash ([CORE], e.g. `#s=sofa:sofa-hadley-3,…`). Primary button
  «Скопировать ссылку на комплект», secondary «Готово». Note → «Ссылка сохранит ваш выбор.»

### P1-13. Inconsistent terms («студия», «предмет/позиция», «Обед», «Кликните») [UI]
- «Студия» means three things: the company («ИИ-студия интерьера»), the apartment («Студия 38 м²») and
  the 3D editor (nav «Студия», CTA «Открыть студию»). Rename the editor: nav «Квартира», section eyebrow
  «Квартира в 3D», hero CTA «Смотреть в 3D». The modal's «для квартиры «Студия 38 м²»» → «для этой студии».
- «26 предметов · 22 позиции» (`/tmp/shots/d1440-12-budget-after-swap.png`): users can't tell the
  difference. Use «26 предметов · стиль «Тёмный орех»», and change the budget foot to «Нажмите на
  строку, чтобы выбрать замену.»
- View «Обед» (lunch) → «Столовая» (`labels.js` l.62).
- «Кликните» → «Нажмите» everywhere (hint, hover foot, studio lead, plan hint). It is the apple.com/ru
  convention and also works for touch. «Наведите на предмет» → «Наведите курсор на предмет».
- Studio lead on touch devices still says «Наведите… Кликните…» (`/tmp/shots/m390-04-hint.png`). Use
  `isTouch()` for «Коснитесь предмета — увидите цену и варианты замены.»
- How-it-works step 2: «Пройдитесь по комнатам» → «Пройдитесь по квартире» (it's a studio).
  Step 3 has a double «и»: «Мы привезём мебель, текстиль и декор и соберём всё…» → «Привезём мебель,
  текстиль и декор — и соберём всё за один день. Останется только въехать.»

### P1-14. The style section repeats itself and shows designer data [UI][DATA]
- Evidence: `/tmp/shots/d1440-29-full-crop1.png`, `/tmp/shots/d1440-29-full-crop2.png`. The H2 «Тёмный
  орех.» is followed by the lead «Тёмный орех. Тёплый лён. Ничего лишнего.» Each swatch shows its share
  three times (bar, chip corner, meta) plus a hex code («Стены · #ECE7DE · 36%»).
  «Каждый предмет реален и доступен к покупке» sounds machine-translated.
- Fix: tagline → «Тёплый лён. Травертин. Ничего лишнего.» (or strip a leading pack name in
  `sections.js` l.41). Swatch meta → «Стены · 36%». Remove `.swatch-share` from the chip and drop the
  hex. Last sentence of the description → «Всё это настоящие вещи — их можно купить.»
  On mobile use 3 columns of 100 px chips (`minmax(min(100%, 100px), 1fr)`, `--r-s`); 12 chips in
  2 columns take about 1 600 px of scrolling (`/tmp/shots/m390-12-full-part3.png`).

### P1-15. Touch targets under 44 px [UI]
- Measured at 390 px: dock `.seg-btn` 34 px tall (36 on desktop), sheet and modal close `.icon-btn`
  36×36, nav «Заказать» `.btn-sm` 32 px, «Показать состав» about 35 px, hero «Как это работает» about 20 px.
- Fix: `.seg-btn { height: 40px; }` with `.seg { padding: 2px; }` gives a 44 px control.
  `.icon-btn { width: 44px; height: 44px; } .icon-btn::before { content:""; position:absolute; inset:4px; border-radius:50%; background: inherit; }`
  (or keep a 32 px visual inside a 44 px hit box). `@media (hover: none) { .btn-sm { min-height: 44px; } .budget-toggle { min-height: 44px; } }`.

### P1-16. «Утро» and «Закат» icons are nearly the same; the mobile icon-only toggle gives no feedback [UI]
- Evidence: `/tmp/shots/d1440-02-hint.png` (top right: both are a half sun on a horizon) and
  `/tmp/shots/m390-08-timecycle.png` (cycled to «Закат»: only the icon changes, no label).
- Fix: morning = horizon + half sun + **up** arrow, golden = horizon + half sun + **down** arrow (the
  SF Symbols `sunrise`/`sunset` metaphor). On mobile, when the time changes, show the label in the hint
  chip slot for 1.2 s («Закат»), or make `.time-cycle` a 44 px capsule with the label: `width:auto; padding:0 14px 0 12px`.

### P1-17. Overlays cover the hero objects; weak portrait framing [UI][ENG]
- Evidence: `/tmp/shots/d1440-02-hint.png` and `/tmp/shots/d1440-19-living.png` (dock and hint sit on
  the coffee table in both views). `/tmp/shots/m375-03-stage.png` (hint plus dock take about 25 % of a
  453 px stage). `/tmp/shots/m390-04-hint.png` (portrait `eye` view crops the sofa out).
- Fix: move the hint to top-centre (`.stage-hint { top: 16px; bottom: auto; }`), shorten it to 4 s, and on
  mobile use one line: «Проведите — осмотреться · Коснитесь предмета». [ENG] add a portrait variant
  of each view (wider horizontal FOV, or a camera pulled back about 0.6 m when aspect < 0.8) so the sofa
  stays in frame.

---

## P2: polish

1. **Concentric radii.** The sheet (22 px) sits 12 px inside the 28 px stage, so it should be 16 px:
   `.sheet { border-radius: 16px; }`. The budget card (24 px) directly under the stage (28 px) should
   match: `.budget { border-radius: var(--r-xl); }`. Evidence: `/tmp/shots/d1440-12-budget-after-swap.png`.
2. **Context chip spacing.** «Тёмный орех · Студия 38 м²» has a double gap before the dot (8 px flex gap
   plus a leading space). Use `h('span', {class:'muted'}, '· …')` with `.chip .muted { margin-left: -4px; }`.
   Evidence: `/tmp/shots/d1440-02-hint.png`.
3. **Sticky hover on touch.** «Скрыть состав» stays underlined after a tap (`/tmp/shots/m390-10-budget-list.png`).
   Wrap every `:hover` rule (`.pill`, `.opt`, `.line-btn`, `.budget-toggle`, `.link`, `.btn-*`, `.icon-btn`)
   in `@media (hover: hover) { … }`.
4. **Contrast (WCAG AA, computed).** Swatch share labels at 13 px/600 with `opacity: .8`: Терракота 3.3:1,
   Латунь 2.65:1, Коньяк 4.29:1, Олива 4.24:1, all failing. Fix `inkFor()` (`dom.js` l.80) to pick the
   ink with the higher `contrast()` and drop the opacity (or remove the labels, see P1-14). Loading
   «68%» `#6e6e73` on `#e9e2d9` is 3.95:1; use `#515154` (≥ 6:1). Everything else checked passes:
   `--text-2` 4.91:1, `--accent-text #855633` 6.0:1, green delta 6.06:1, glass chips ≥ 5.7:1 over
   day and evening scenes.
5. **Focus ring on budget rows is a sharp rectangle** (`/tmp/shots/d1440-26-focus-nav.png`). Use
   `.line-btn { border-radius: 10px; }`. The dock focus ring is good (`/tmp/shots/d1440-27-focus-dock.png`).
6. **Scroll target is off by the reveal transform.** `scrollToEl` measures `.studio-shell` while it is
   still `translateY(28px)`, so the stage lands 28 px high (stage top 97 px instead of 125 px). This is
   fixed for free by P0-1 step 1.
7. **Section bands.** The style section is `#fff` on a `#fbfbfd` page, so the edge is almost invisible
   and looks accidental (`/tmp/shots/d1440-29-full-crop3.png`). Use `.how { background: var(--bg-alt); }`
   (#f5f5f7) so the white step cards lift.
8. **How-it-works rhythm.** Step 2's title takes 3 lines against 1 for the others, so the body text
   baselines don't line up. Title → «Осмотрите в 3D, замените что угодно». The page ends without a CTA;
   add `<a class="btn btn-primary btn-lg" href="#studio" data-scroll-studio>Смотреть квартиру в 3D</a>`
   centred, `margin-top: var(--s8)`.
9. **Modal details.** Perk text wraps to orphans («Сборка за один / день», «Доставка / всего /
   комплекта» on mobile). Copy: «Доставка комплекта», «Сборка за&nbsp;день», «Можно въезжать». The
   count wraps «26 предметов · 22 / позиции» (fixed by P1-13). Close button: 44 px (P1-15).
   Evidence: `/tmp/shots/m390-11-order.png`.
10. **Hero price anchor.** The hero note says «от 18 623 AED» but the configuration the user sees costs
    32 741 AED (76 % more). Either show «Комплект на фото — 32 741 AED», or add a one-tap «Собрать
    дешевле» preset in the budget bar so the anchor can be reached.
11. **Hero hidden until JS boots.** `.js .intro { opacity: 0 }` waits for the module graph (up to the
    4 s guard), which hurts LCP. Add `is-loaded` from an inline `DOMContentLoaded` listener in `<head>`.
12. **Dock state after free navigation.** After dragging or walking, «Вход» stays selected. Deselect the
    segmented control when the engine reports a free camera (needs an [ENG] `view` event with `null`).
    Top view («План») renders on a flat cool grey void (`/tmp/shots/d1440-18-top.png`); [ENG] use the
    warm stage gradient (`#efe9e2→#e6dfd6`) or transparent clear colour.
13. **Selection outline** is a hard white halo that reads as a rendering artifact on light upholstery
    (`/tmp/shots/d1440-15-sheet-sofa-scrolled.png`, white line down the sofa base). [ENG] use a 2 px
    `rgba(255,255,255,.85)` edge plus a 6 px soft outer glow at 25 %.
14. **Plan fallback.** The hint chip overlaps the plan's south wall (`/tmp/shots/P1440-02-plan-hover.png`):
    `.stage.is-plan .stage-hint { bottom: 20px; }` and `.stage-plan { padding-bottom: 88px; }`.
    The 45 s plan→3D switch is abrupt and can happen while the user is reading. When 3D becomes ready
    in plan mode, show a glass chip «3D готово · Открыть» instead of auto-swapping, and cross-fade
    (`opacity 500ms`) when the user taps it.
15. **Catalog naming typography** [DATA]: names use «200×290», «160×200», «Ø100» while the specs use
    «211 × 88 × 86 см». Use «200 × 290 см» and «Ø 100 см» in names (or drop sizes from names, since the
    dims row has them).
16. **Header line for multi-piece items** wraps «Прикроватная тумба · 2 шт. в / квартире»
    (`/tmp/shots/d1440-13-sheet-nightstand.png`). Fixed by P0-2 («· 2 шт.»).
17. **«Фото» label** is ambiguous (a camera? a gallery?). Use «Фотореализм», or keep «Фото» with the
    tooltip «Фотореалистичный кадр». Photo mode itself couldn't be verified: SwiftShader lost the WebGL
    context and the page crashed during path tracing. It needs a real-GPU pass.

---

## What already meets the bar (keep)
- Single walnut accent applied with restraint. Green only for savings, system blue only for focus.
  The true minus sign in deltas, «Та же цена» for zero deltas.
- Type scale and tracking (88/64/28/24/17), `text-wrap: balance` on headings, tabular numerals in
  prices and the animated total (700 ms ease-out-quart).
- Glass overlays stay legible over the bright window (day) and the dark scene (evening):
  `/tmp/shots/d1440-16-evening.png`, `/tmp/shots/d1440-17-golden.png`.
- The segmented control with a sliding thumb, roving tabindex and arrow keys. A visible focus ring.
- Loading phase copy, the plan fallback concept, `prefers-reduced-motion` handling, and the plan's
  accessible names («Диван: Диван Lansbury, трёхместный»).

## Method / reproduction notes
- Engine readiness in SwiftShader: about 70 s, and about 240 s once with a WebGL context loss. The UI
  switches to the plan at 45 s (`READY_TIMEOUT`), so slow devices will see the plan→3D handoff (P1-4,
  P2-14). Real-GPU timing is not represented here.
- Hover and selection used real Playwright mouse events at projected slot centres
  (`villar.debug.furnisher.meshesOf()` + camera projection), plus `villarUI.sheet.open()` for
  deterministic sheets. The harness and step files are in `/tmp/qa/` and `/tmp/steps/`.
