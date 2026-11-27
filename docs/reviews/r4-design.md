# Villar, review round 4: design (Human Interface pass, with the budget slider as the main subject)

Build `5c4e5d8`, local harness (headless Chrome, SwiftShader, `--csp`). Evidence is in `/tmp/rev4/design/`; step
files are in `/tmp/rev4/design/steps/` and run logs are `S*.log`. Ladder numbers come from
`/tmp/rev4/design/scripts/ladder.mjs`, which runs `core/budget.js` on the shipped data. Runs: A = 1440×900 EN,
F = 390×844 @2x touch RU, C = 1280×800 RU, D = 1440×900 RU (follow-up), H = 390×844 touch EN (follow-up).
Level jumps were driven by the keyboard (Home / PageUp / PageDown). Drags were driven by synthetic pointer events
on the rail (`__down/__move/__up` in `steps/lib.mjs`), because the harness has no drag step.

## Verdict

**Score: 8.0 / 10** (round 3: 7.5). **P0: 0 · P1: 1 · P2: 8.** The budget slider on its own: **7 / 10.**

All ten round-3 findings are fixed. The editor now holds together on desktop and phone in both languages: the
calm HUD column, the honest sofa framing at 1280, the phone answer under the input, a portrait Entry that shows
the sofa, and loading skeletons. The budget slider is well built underneath. It moves along the ladder, follows
the keyboard, reads its value aloud, has one Undo per gesture (verified on desktop and phone: 19,717 → 36,243 AED,
all 33 items back), and keeps pins. Its feedback (count-up, delta pill, level crossfade, whisper) is the right family of motion. What keeps it
from Apple level is legibility, not mechanics. Nothing on screen says «Бюджет», that the room will rebuild, what
the five unlabelled dots mean, or why a pinned room cannot go lower. A first-time visitor gets "price", not "my
room fits my budget".

**What clearly improved:** every D3 item (table below); the slider's live behaviour and accessibility
(`role=slider`, `aria-valuetext` with level and count, Home/End/PageUp/PageDown, reduced motion); and the phone
dock that keeps one total on screen. Copy improved too: «Не входит в бюджет · Добавить», «Ваш выбор · бюджет не
меняет · Открепить», "Budget: Minimum, 7,852 AED · Undo". Pinned rows get a pin glyph and a 44 px «Открепить».

### What stands between this and 8.5+
1. **D4-01 (P1):** a visible name «Бюджет · …», end labels «7 852 AED … 41 451 AED», and a one-time hint
   «Двигайте — комната подстроится под бюджет» / "Drag — the room adapts to your budget".
2. **D4-02:** a value bubble over the thumb while dragging («Под ключ · 23 574 AED»), 6 px ticks, desktop tick
   labels, and a named level for the 19.7k–35.9k plateau.
3. **D4-04 + D4-06:** a floor that reads as "blocked" (neutral hatch, fill starting at the floor, a pin glyph, a
   whisper at the floor). Out rows that show the price («+ 2 999 AED»), grouped under one «Не входит в бюджет»
   subheading per zone instead of 20 repeats.
4. **D4-05:** the slider's Undo sits in the budget bar or the dock, next to the control, not at the top of the stage.

**Coverage.** Five runs:
- A — 1440 EN, keyboard jumps and a synthetic drag;
- F — 390 RU, the phone dock, keyboard and drag;
- C — 1280 RU, D3-02, HUD close on grab, the list, pins;
- D — 1440 RU follow-up, Undo restore verified, left-out rows, pinned row, floor, palette;
- H — 390 EN follow-up, Undo restore verified on the phone, out rows, pinned row, HUD pin (`sheet-H.png`).

The shared lock was heavily contended (40–90 min waits). Software GL takes 1.8–2.7 s per dissolve step during a
drag (known issue 3), so the motion was judged from frames 250 ms apart plus the code paths, not from frame rate.

## Round-3 findings: status

| ID | Round-3 finding | Status | Evidence (round 4) |
|---|---|---|---|
| D3-01 | Phone: an AI reply pushes the input down 141 px | **Fixed** | The answer now sits *under* the input: one line, with «Ещё», undo and history as 44 px icons (`sheet-F2.png`, 4th frame). The slot is 106 px against 197 px in round 3, and it grows downward. |
| D3-02 | 1280: the sofa focus looks down the kitchen counter | **Fixed** | `C02-hud-sofa.png`: a 3/4 front view with the cushions facing the camera and the side table and coffee-table decor as context. `__frame`: `inFree 1.0`, fills 62 %. |
| D3-03 | HUD secondary text below AA over dark scenes | **Fixed** | `.hud-panel` sets `--text-2: #5f5f64` with glass at 0.94 (0.98 without backdrop-filter): ≥ 5.3:1 on the darkest sample. |
| D3-04 | AI chips repeat the category inside the name | **Fixed** | «Кресло: Emma, букле»-style chips, and "can’t" with a curly apostrophe. A **new** regression in the budget reply is reported as D4-07. |
| D3-05 | EN names repeat the eyebrow; "3-seater" vs "three-seat" | **Fixed** | "Sofa / Lansbury 3-seater", "Brighton 3-seater", "Daventry bouclé 3-seater", "Bedding / White sateen, oat throw" (A log). One leftover: "Oshawa 3-seater sofa with cane sides". |
| D3-06 | Lead form: empty phone error, masculine consent, summary wrap, 36 px link | **Fixed** | «Укажите телефон», «Разрешаю Villar связаться со мной…» / "Villar may contact me…". The phone summary stacks («Стиль «Тёмный орех» \| 32 предмета»). `__small()` reports nothing under 44 px in the lead form on touch (F log). |
| D3-07 | Phone: the first view shows no sofa | **Fixed** | Portrait Entry: the sofa centre projects to x = 67 (it was −20). Sofa, armchair, bed and window are all in frame (`sheet-F1.png`, 1st frame). |
| D3-08 | The hover card lingers over the dock and through a style switch | **Fixed** (code) | `hovercard.js` has an `avoid()` keep-out for the dock and corner controls, hides on `store.on('style')`, and `quiet(600)` after the HUD closes. |
| D3-09 | The tiny palette tier shows a bare "5%" | **Fixed** | Light Oak tiers now read «60% База · 35% Второй план · 5% Акценты» (D log, `D07-palette.png`). |
| D3-10 | Thumbnail placeholders look like missing pictures | **Fixed** | A shimmer skeleton with no dot while loading (`F09`: the sofa tiles are soft beige skeletons). 7 tiles were `is-loading` 700 ms after opening on software GL. A visible-first queue exists. |

---

## The budget slider

### What it gets right (keep)
- **Placement.** On desktop it sits in the budget bar, between the total and «Заказать комплект». The rail is 811 px
  wide at 1440 and 600 px at 1280, and the bar's height grew by only 4 px (104 → 108). On the phone it lives in a
  solid dock that replaces the old total pill: level · count on the left, the total on the right, and the rail
  under them (`sheet-F1.png`). The dock never appears together with the full bar or with the HUD, so there is
  still only one total on screen.
- **Thumb and track.** A white 28 px thumb with a hairline and soft shadow, and a 44 px hit area. It scales ×1.1
  while dragged. The track is 6 px with the accent fill. It follows iOS conventions and looks calm.
- **Feedback.**
  - The total counts in 260 ms during a drag and 600–700 ms otherwise.
  - A delta pill shows the change since the grab: "−28,391 AED" in green, "+17,899 AED".
  - The level name crossfades.
  - The whisper reads well: "+ Cushions · + Rug", "+ Armchair · Better dining table", «− Кресло · − Растение».
- **Behaviour.**
  - Grabbing the slider closes the HUD (C log: `hudOpen:false`), so the whole room comes back into view.
  - The thumb settles on the room's real total on release (0.70 → 0.6958).
  - Pins shift the ticks honestly (Essentials 13,330 → 14,825 with the floor lamp and cushions pinned).
  - The AI's «уложись в 25 000» moves the same slider with the same whisper.
- **Accessibility.**
  - `role=slider` with `aria-label` «Бюджет» / "Budget".
  - `aria-valuetext` «36 243 AED, Как в журнале, 33 предмета» / "36,243 AED, Magazine-ready, 33 items", announced on
    release.
  - Keys: ←/→, PageUp/PageDown and Home/End all work.
  - Reduced motion removes the number roll, the crossfades and the thumb glide, and the engine dissolves become 1 ms.
  - On touch, `__small()` lists nothing under 44 px in the dock, the list or the lead form.
- **Copy.** Mostly consumer-grade in both languages: «Самое нужное · Удобно жить · Под ключ · Как в журнале · Без
  компромиссов», "Not in this budget · Add", «Ваш выбор · бюджет не меняет · Открепить», "Budget: Minimum,
  7,852 AED · Undo".

### Would a first-time visitor understand it without explanation?
**Partly, not fully.**
- *What they will get:* "this changes the price". The control sits next to «Итого за квартиру», and the number
  moves with it.
- *What they will not get:*
  1. That it is a **budget** and the **room rebuilds itself** to fit it. The word «Бюджет» appears nowhere on
     screen; it is only in `aria-label`. «Как в журнале · 33 предмета» reads as a status, not as a position on a
     scale.
  2. What the **dots** are. Five unlabelled 4 px dots, three of them packed into the left third. Their names exist
     only as `title` tooltips, which never appear on touch.
  3. Why **some things stay**. The pinned floor is a 24–27 px hatch on the dark fill, explained only by a tooltip.
- On the phone it is harder still: the dock is the only place it lives, the three left ticks are 30–33 px apart,
  and there is no hover.

**Minimum onboarding (three small things, no tour):**
1. **A visible name.** Prefix the level line with the word: «Бюджет · Как в журнале · 33 предмета» / "Budget ·
   Magazine-ready · 33 items". In `budget-slider.js` `createSliderView()`, add
   `h('span', { class: 'bs-name' }, t('bs.label'))` before `level`, styled
   `.bs-name { font: 500 14px/1.3 var(--font-text); color: var(--text-2); } .bs-name::after { content: "\00a0·"; }`.
2. **End labels under the rail** (desktop and phone), the way Apple labels price ranges: «7 852 AED» on the left
   and «41 451 AED» on the right, 12 px `--text-2`, in a 16 px row under the track. They show it is a scale and
   where it ends.
3. **A one-time hint** the first time the rail scrolls into view, stored in `localStorage` like the language. It
   is a glass chip above the thumb: «Двигайте — комната подстроится под бюджет» / "Drag — the room adapts to your
   budget". It goes away on the first grab, or after 6 s.

Tick labels are optional; see D4-02.

## Findings

### D4-01 [P1] The slider has no visible name, scale or explanation, so its main idea (the room fits your budget) is invisible
- Owner: ui
- Repro: 1440×900 EN or 390×844 RU, a fresh visit. Look at the budget bar or the phone dock.
- Expected (the founder's bar «удобно и интуитивно … не хуже, чем Apple»): you can tell at a glance what the
  control is and what it does, before touching it.
- Actual:
  - The bar reads "Apartment total 36,243 AED · Magazine-ready · 33 items · Dark Walnut style", then a dark line with
    a thumb at 84 % (`crop-A02-track.png`, `C02`). The dock reads «Как в журнале · 33 предмета · 36 243 AED» plus a
    rail (`sheet-F1.png`).
  - "Budget" exists only in `aria-label`. The ends are unlabelled, and the ticks' names are `title` tooltips.
  - Nothing says the room will change. The first-time test above: a visitor understands "price", not "the room
    rebuilds".
- Fix: the three items in "Minimum onboarding" above, with exact copy:
  - `bs.name`: «Бюджет» / "Budget", shown before the level.
  - End labels: `aed(ladder.min)` and `aed(ladder.max)`.
  - The one-time hint: `bs.hint` «Двигайте — комната подстроится под бюджет» / "Drag — the room adapts to your
    budget".
  - Target: in a 5-person hallway test, 4 of 5 say "it changes what's in the room to fit a budget" before touching it.

### D4-02 [P2] Ticks: tiny, faint, unlabelled, and three of five crowd into the left third
- Owner: ui, coordinator (ladder)
- Evidence: `crop-A02-track.png`, A and F logs. On the AED scale, Dark Walnut ticks sit at 16.3 / 25.3 / 35.3 /
  84.5 / 100 %. That is 73–81 px apart at 1440 and **30–33 px apart on the phone**. The 4 px dots
  (`rgba(0,0,0,.3)` on the 9 % track) are 2.1:1. «Под ключ» / "Move-in ready" is the label for half the track
  (19,717 → 35,873 AED, steps 14–31), and «Без компромиссов» only for the very last pixel. Light Oak, Cashmere and
  Mediterranean show the same shape (ladder script).
- Fix:
  - Dots: `.bs-tick { width: 6px; height: 6px; margin: -3px 0 0 -3px; background: rgba(0,0,0,.38); } .bs-tick.is-passed { background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.12); }`.
  - While dragging, show a value bubble above the thumb: «Под ключ · 23 574 AED», a 13 px glass chip,
    `transform: translate(-50%, -38px)`. This is the Apple pattern for a slider whose ticks have names. It fixes the
    phone, where hover tooltips never appear.
  - Desktop ≥ 1024 px only: label three ticks under the rail (Essentials, Move-in ready, Magazine-ready) in 11 px
    `--text-2`. Merge Comfortable into Essentials' label when they are < 90 px apart.
  - Ladder (coordinator): name the plateau. Add a level between Move-in ready and Magazine-ready (the armchair and
    the first hero upgrades, about 27–31 k: «С характером» / "With character"), so no label spans more than 25 %
    of the track.

### D4-03 [P2] The "what changed" whisper lists 2 of up to 27 changes, and its crossfade overprints the meta
- Owner: ui
- Evidence:
  - Home from the default room removes 27 items. The whisper says only "− Nightstands · − Dining table" (A log).
    PageDown removes 10, and the whisper says «− Кресло · − Растение» (C log).
  - `A07-drag-up.png` (`sheet-A-bar-seq.png`, 5th row): during the 200 ms crossfade "+ Armchair · Better dining
    table" and "33 items · Dark Walnut style" are drawn on top of each other in the same grid cell.
- Fix:
  - Add a count when more changed: `bs.more` «и ещё {n}» / "+{n} more". Example: «− Тумбы · − Обеденный стол и ещё
    25» / "− Nightstands · − Dining table +25 more".
  - Make the crossfade sequential, not simultaneous: `.bs-sub > * { transition: opacity 140ms var(--ease); }
    .bs-sub.is-whispering > :first-child { transition-delay: 0ms; } .bs-sub.is-whispering .bs-whisper {
    transition-delay: 120ms; }`. Use the reverse delays when it ends. Or slide the whisper up 4 px over the meta.

### D4-04 [P2] The pinned floor is a 24–27 px hatch on the dark fill: it reads as a glitch and hides under the thumb
- Owner: ui
- Evidence:
  - `crop-C07-bar.png`: with the floor lamp and cushions pinned, the floor is 4.45 % of a 600 px rail (27 px),
    drawn as white stripes *on top of the accent fill*.
  - At the minimum, the 28 px thumb covers all of it (C log: `p 0.0445`, `f 0.0445`). With only the floor lamp
    pinned, the floor is 10 px at 1440 (D log), entirely under the thumb, and the level still says «Минимум» at
    8 331 AED instead of 7 852 AED, with no visible reason.
  - Its meaning, «Ниже не опустить: здесь ваши вещи», is a `title` tooltip.
- Fix:
  - Draw the floor as *unreachable track*, neutral and not accent: `.bs-floor { background: repeating-linear-gradient(-45deg, rgba(0,0,0,.16) 0 1.5px, transparent 1.5px 4px), #efece6; border-radius: 3px 0 0 3px; }`.
  - Start the fill at the floor: `.bs-fill { left: calc(var(--f) * 100%); width: calc((var(--p) - var(--f)) * 100%); }`.
  - Add a 12 px pin glyph at the boundary (`left: calc(var(--f) * 100%)`, 16 px above the track).
  - When the thumb reaches the floor, say it in the whisper slot: «Ниже не опустить — здесь ваши вещи · Открепить»,
    with «Открепить» as a 44 px link that opens the list scrolled to the pinned rows.

### D4-05 [P2] The slider's Undo toast appears at the top of the stage, far from the slider and sometimes off-screen
- Owner: ui
- Evidence: `sheet-A-home.png`. Focusing the thumb from the keyboard scrolls the bar into view, which pushes the
  stage top (and the toast) under the nav: the Undo for the change you just made is invisible. Even when it is
  visible, it is 560–600 px above the control on desktop and 600 px on the phone (`sheet-F1.png`, 2nd frame). It
  disappears after 7 s.
- Fix: when `g.source` is the slider, show the toast in the budget bar's whisper row: «Бюджет: Минимум, 7 852 AED ·
  Вернуть» right-aligned under the rail. On the phone, show it in the dock row. Keep the stage toast for style
  switches. Raise `ms` to 10 000 for slider changes, and keep it until the next interaction with the room.

### D4-06 [P2] «Не входит в бюджет · Добавить» rows don't say what adding costs
- Owner: ui
- Evidence: `crop-A15-out.png`: "○ Armchair · Not in this budget · + Add". 20 such rows at Essentials (C log). Add
  inserts the style's default piece (here a 2,999 AED armchair) and pins it, with no price shown before or after.
- Also: at Essentials, «Не входит в бюджет» repeats on 20 rows in a row (`sheet-D-list.png`), so the list reads
  as noise. On the phone, "Not in this budget" repeats 9 times in Living alone (`sheet-H.png`, 2nd frame).
- Fix:
  - Show the price on the action, `+ 2 999 AED` / `+ 2,999 AED` (`aria-label`: «Добавить кресло Luna за
    2 999 AED»), and the item's short name instead of the bare category: «Кресло Luna».
  - Group the left-out rows per zone under one muted 13 px subheading, «Не входит в бюджет» / "Not in this
    budget", and drop the per-row note: `.line-note { display: none }` inside the group, with
    `.budget-group .out-head { padding: 12px 8px 4px; font: 500 13px/1.3 var(--font-text); color: var(--text-2); }`.

### D4-07 [P2] Slider copy: a gendered AI reply, EN quotes, «Под ключ» collides with the service promise, RU "better/simpler"
- Owner: assistant (first two), coordinator (`budget.json`), ui
- Evidence: F, C and A logs.

  | Where | Now | RU | EN |
  |---|---|---|---|
  | `ai/local.js` and `api/assistant.js` `budgetPlan` | «Собрал комнату под 25 000 AED: «Под ключ», итог 23 574 AED.» / "Room set for 25,000 AED: “Move-in ready”, total 23,574 AED." | «Комната под 25 000 AED: «Под ключ», итог 23 574 AED.» (no gender) | "Room for 25,000 AED: Move-in ready, total 23,574 AED." (no quotes, as in D2-15) |
  | `ai/assistant.js` budget chip | «Бюджет: «Под ключ»» / "Budget: “Move-in ready”" | «Бюджет: Под ключ» | "Budget: Move-in ready" |
  | `budget.json` level 3 | «Под ключ» | «Всё для жизни». «Под ключ» means delivery plus assembly, which Villar promises at *every* level. | "Move-in ready" (keep) |
  | `bs.up` / `bs.down` | «Обеденный стол лучше» / «Обеденный стол проще» | «Лучше: обеденный стол» / «Проще: обеденный стол» (parallel to EN) | "Better dining table" (keep) |
  | toast action vs AI undo | «Вернуть» (toast) / «Отменить» (AI) | One word for one action: «Отменить» | "Undo" |

### D4-08 [P2] The slider thumb's focus ring is fainter than the site's and below 3:1
- Owner: ui
- Evidence: `crop-A02-track.png`. `.bs-thumb:focus-visible` draws `0 0 0 4px rgba(0,113,227,.55)`, which is
  `#73b1f0` on white: **2.26:1** (WCAG 1.4.11 needs 3:1). Everywhere else uses `outline: 2px solid #0071e3` (4.6:1).
- Fix: `.bs-thumb:focus-visible { box-shadow: 0 0 0 0.5px rgba(0,0,0,.14), 0 2px 5px rgba(0,0,0,.14), 0 0 0 2px #fff, 0 0 0 4px #0071e3; }`.

### D4-09 [P2] At 1280 RU the level line truncates the item count
- Owner: ui
- Evidence: `crop-C07-bar.png`: «Самое нужное · 14 предмето…». The head row shares its width with «Скрыть состав»
  and «Сбросить к подборке стиля» (`grid-template-columns: minmax(0,1fr) auto`). Whispers truncate the same way.
- Fix: drop the style from the slider's meta, since the stage chip and the picker already say it: `bs` meta =
  «14 предметов» only. Move «Сбросить к подборке стиля» into the list foot (it is a list-level action), and keep
  only «Показать состав» in the head.


