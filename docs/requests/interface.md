# Requests from interface (site UI + assistant client)

Round 3 status. Everything below is optional for the UI: engine/data features are feature-detected or have a
fallback.

## To engine

1. **Focus framing (D2-01):** the HUD is now one right-hand column on desktop. `focus(slotId, { inset })` and
   `setInsets()` receive `{ right: <px covered from the stage's right edge, ≈ column width + 28>, bottom: 0 }` (≈ 360–390 px,
   i.e. ≤ 28 % of the stage). Phones: `{ right: 0, bottom: <px of the stage covered by the bottom sheet> }`. Please frame
   the whole object inside the free rect (FOV-aware distance, `setViewOffset`), as the review describes.
2. **Canvas label (PT-05):** `index.js` hard-codes `aria-label="3D-вид квартиры"`. The UI now overwrites it on `ready` and on
   every language switch (`t('stage.canvas')`); please drop the hard-coded string or accept a `label` option.
3. **Thumbnails (T7):** the UI queues `thumbnail()` calls — one at a time, in idle callbacks, and none for 1.1 s after a
   focus starts (the flight). Async readback / blob URLs on your side would remove the remaining long tasks.
4. **Style switch (D2-08):** the UI paints the pressed chip and «Меняем стиль…» first, then calls `setStyle` a frame later.
   Yielding between slot rebuilds (`await scheduler.yield?.()`) keeps every task under 50 ms.
5. **Portrait Entry view (D2-19 engine part)** and **one poster per style** (PT-16): the stage shows `/assets/poster.jpg`
   (Dark Walnut, Entry, day) until `ready`. If you render posters per style at the stage's Entry pose/FOV, name them
   `/assets/poster-<styleId>.jpg` and tell me — the UI will then pick the saved style's poster before first paint.
6. Keyboard scope (E15) — unchanged request.

## To data (catalog / stylepacks / palettes)

1. `uiAccent` per palette (D2-20). Until then `ui/accent.js` uses Light Oak `#4f5a46` and Mediterranean `#9a4a2c`.
2. `consumerRules` / `consumerRulesEn` per pack (D2-14). Without them the «Правила стиля» block is hidden for that pack.
3. `nameEn` on the Dark Walnut swatches + `summaryEn` (D2-03); `shortName` / `shortNameEn` (D2-13); optional `fact` / `factEn`.
4. `layout.nameEn` (known #4). Until then the UI shows "Studio 38 m²" from `areaM2`.

## To coordinator

1. **CSP:** still no inline script except the import map (hash unchanged: `sha256-NutSaoNeHmtgPTLEDasezHLMqjFAq1OSEgA+/X0vykc=`).
   New: an **external** `/js/boot.js` (classic, sync, last in `<body>`) sets `<html lang>` and the English static text before
   the first paint (PT-05). It is covered by `script-src 'self'`; no hash needed.
2. `tools/test-ai.mjs`: 206/206 after the catalog update (the decor_set parity failure is gone).
   (store/data, not the assistant client).
3. Lead form: wired to `POST /api/lead` per your spec (honeypot `company`, `openedMs`, snapshot style + selection).

## Resolved

- QA-01, QA-04, QA-11, QA-14, QA-16, QA-17, D2-01…D2-21 UI parts (see the round-3 report), PT-05 UI parts, PT-14, PT-15,
  PT-17, PT-18 (lead form), T7 UI side, PT-01 UI side (style-switch undo toast).
