# Requests from interface (site UI + assistant client)

Round 4 status. Everything below is optional for the UI: engine and data features are feature-detected or have a
fallback.

## To engine

1. **Phone first view (D3-07):** the UI still asks for `view: 'eye'` on every viewport. At 390×844 the sofa projects to
   x = −20. Please choose a portrait variant of `eye` inside the engine when the stage aspect is below 0.8. Either
   turn about 12° toward the sofa or step back 0.5–0.6 m, so that at least 70 % of the sofa's box is in frame and the
   window is still visible. Ship it as `layout.views.eyePortrait` (data) or compute it in `camera.js`. The UI needs
   no change. If you would rather the UI pass `view: 'eyePortrait'`, tell me and I will add it behind a
   feature check.
2. **Sofa focus at 1280×800 (D3-02 / PT3-01):** `focus('sofa', { inset: { right: 361, bottom: 0 } })` returns true and
   `villar.focused === 'sofa'`, but the camera stays near the entry, and the kitchen counter hides the sofa's end (no
   outline is visible). The insets now come from the panel's resting position, not the slide-in frame (345 → 361 px).
3. **Thumbnails (D3-10):** the UI renders a shimmer while thumbnails load. Tiles that are visible jump the queue
   (`thumbs.bump`), in reading order. Calls still run one at a time in idle callbacks and wait 1.1 s after a focus
   starts (T7). To reach "first 4 in ≤ 600 ms on a GPU", the flight wait could drop to about 0.6 s if `thumbnail()`
   no longer blocks frames.
4. **Canvas label:** the UI overwrites the hard-coded `aria-label` on `ready` and on every language switch.
5. Keyboard scope (E15): unchanged request.

## To data (catalog / stylepacks / palettes)

1. Names are tidied **at display level only** (`ui/labels.js` together with `ai/i18n.js`):
   - "three-seat" → "3-seater";
   - in EN, the category noun that the eyebrow already says is dropped;
   - a set's own «Постель:» / "Bedding:" prefix is dropped after a slot label.

   The catalog is unchanged. If you standardise the names at the source, the display rules simply stop matching.
2. `uiAccent` per palette (D2-20) is still optional. Until it ships, `ui/accent.js` keeps its fallbacks.

## Budget slider (round 6): status and requests

Done in the UI (D4-01…D4-09, R4-04, PT4-01, PT4-02, labels):
- «Бюджет · <level> · N предметов»; AED ends under the track; a one-time hint (`localStorage villar:bs-hint`).
- 6 px ticks; levels within 1.5 % (or 24 px on screen) merge to the later name; tick names on ≥ 1024 px.
- A value bubble while dragging; the whisper shows two changes, then «+N ещё», one line at a time.
- The pinned floor is a solid muted segment, «📍 Ваши вещи · 12 346 AED» under it, which opens the pinned rows.
- The gesture's «Вернуть» sits beside the slider, 10 s; the stage toast is kept for style switches only.
- Left-out rows say «Добавить · 571 AED» (dependencies included, «вместе с: журнальный столик»), under one
  subheading per zone; a zone with nothing in it shows no «0 AED».
- «Минимум» at step 0, «Основа» until Essentials (slider, aria, AI reply).
- R4-04: a style switch during a gesture ends it; the next move uses the new style's ladder; the gesture's Undo
  (old style snapshot) stays on offer.
- PT4-01: Add = `requiredFor` deps via `applyPlan`, then `select` (pins).
- PT4-02: a manual switch from an off-designer ladder step lands on the target's richest step ≤ the total
  (`setStyle(id, { selection })`), toast «Светлый дуб · Всё для жизни, 19 673 AED · Вернуть».

## To coordinator

1. **CSP:** the only inline script is still the import map, with its hash unchanged
   (`sha256-NutSaoNeHmtgPTLEDasezHLMqjFAq1OSEgA+/X0vykc=`). The external `/js/boot.js` now also picks the poster
   for the saved style (`/assets/posters/<style>.jpg`, read from `villar:v3:studio-38`, falling back to `v2`). It is still
   covered by `script-src 'self'`.
2. Lead form: every failure (429 rate_limited, 503, timeout, network) shows the same calm "try again" message and
   keeps the form filled (PT3-05). There is no WhatsApp fallback, per the founder.

## Focus card (docs/FOCUS.md, round 7): requests to engine

The card (`ui/hud.js`) feature-detects all of these and works without them.

1. **`villar.focusNext(dir)` → `slotId | null`.** It should pick the next stop and fly there, and the UI then opens the
   card without asking for a second flight. Until it ships, the UI orders the walk itself (`ui/walk.js`): the items on
   screen at entry, left to right, then zone by zone, with one stop per selection key.
2. **`villar.project(slotIds)` → `{ [slotId]: { x, y, angle, visible } }`.** x and y are NDC, and `angle` is the yaw off
   the view axis, positive to the right. The UI reads `debug.camera` and `debug.furnisher.boxOf` until this exists.
3. **`villar.prefetch(itemIds, { slotId })`.** The card asks for every item its visible tiles would swap in. That includes
   other styles' pieces and variants, which `prebuild(slotId)` does not build (it covers the active pack's options only).
4. **`'inspect' { slotId, angle, atRest, home }`** from the turntable. The UI announces the rest angle (front, ¾, side,
   back) and sets `.is-inspecting` on the card. `'rest'` already exists, and the UI uses it to release the thumbnail
   hold as soon as the camera lands.
5. **Insets mid-motion.** A phone detent change calls `setInsets` once, at the start of the sheet's spring, with the
   target detent. Today the re-frame waits for a 120 ms debounce and then flies for 0.6 s. Please retarget the current
   flight from its velocity instead, so the camera and the sheet move as one.
6. **Swaps keep the camera.** On a variant or model swap (`'change'` for the focused slot), keep the camera and the
   turntable angle, unless the new box differs by more than about 10 %. Today a model replacement always re-frames (T5).
7. **Guests** (store.js, approved by the coordinator). A slot may hold an item that another pack offers for the same key.
   `store.options()` is unchanged, so `prebuild` does not cover these items, and request 3 matters for them.

## Resolved

- D3-01, D3-03, D3-04, D3-05 (display side), D3-06, D3-08, D3-09, D3-10 (UI side), PT3-02 (reply note), PT3-04,
  PT3-05, known issue 5 (per-style poster), plus everything listed in earlier rounds.

## From curator (27 Nov, ART §4–5): picks, avoid, the Art row

The data now carries what `ui/hud.js` already reads. Contract and the few things to adjust. Review:
`docs/reviews/curation-1.md`.

**Data contract**
- `pack.picks[key] = [signature, alt1?, alt2?]`: 1–3 ids, each an option of that slot. `picks[key][0]` is always
  the pack default (tested), so "signature" and "the style's own pick" are the same thing.
- `pack.avoid = [[idA, idB], …]`: pieces that clash when both are in the room (29 pairs over four packs).
- `item.edition === true`, `item.image = "art/<id>.jpg"` (a Storage key; `mediaUrl()` resolves it),
  `item.shortName` / `shortNameEn` = the work's title («Умбра № 1» / "Umber No. 1"), `item.name` = title + size.
- `styles.json` `editions` (boolean). When it is `false`, `loadData` now also strips editions from every pack's
  options, picks and defaults (`withoutEditions` in `core/data.js`), so `store.defaultOf()` is never an edition;
  your `editions` filter stays as a second guard.
- Each art slot's picks are `[edition (signature), edition (alternate), simpler piece]`.
- `budget.json` level blurbs changed for «Всё для жизни», «Как в журнале», «Без компромиссов».

**The card**
1. **Picks first, signature marked.** «Выбор дизайнера» / "Designer's pick" on `picks[key][0]`; the other picks
   next; everything else behind «Все варианты» / "All options". You have this.
2. **Do not top the head up to three.** `curate()` fills the head from the price-sorted rest when a slot has fewer
   than three picks. A short list is deliberate (nothing else passed the check against the signature room): e.g.
   Mediterranean cushions have one pick because every other set drops the blue stripe that the bedding and the sofa
   work repeat. When `pack.picks[key]` exists, please show only those (plus the current piece if it is not among
   them) and put the rest behind «Все варианты».
3. **Clashing pieces.** Shown last, as now. If a customer picks one anyway, one quiet line under the name is enough:
   «Спорит с: <short name>» / "Fights with: <short name>" (the other half of the `avoid` pair that is in the room).
   No dialog, no block.
4. **Row «Искусство» / "Art"** for the three `wall_art` slots (ART §5): large tiles that show the artwork itself
   (`mediaUrl(item.image)` for editions, the engine thumbnail for the others and whenever the image is missing or
   fails to load), designer's pick first, then the second edition, then the simpler piece; under each: title, size
   as «150 × 100 см · диптих» / "150 × 100 cm · diptych" or «140 × 100 см», and the price; one tap hangs it. The
   «Villar Editions» mark you already draw is right.
5. **Below «Как в журнале» the ladder hangs the simpler piece.** Your `editionsFirst()` already leads with the
   simpler pieces at those levels. Please keep the signature mark on the edition there too (it is still the
   designer's pick); the order is what changes.
6. **«Без компромиссов»** is now the priciest *pick* in each place, so the whisper during the drag never names a
   piece that is not one of the three shown on the card.
