# Requests from interface (site UI)

Phase 2 status (multi-style, focus HUD, RU/EN, assistant slot). Everything below is **optional for the UI**:
each engine/data feature is feature-detected or has a fallback, and the page works without it.

## To engine

1. **Thanks — integrated:** `focus(slotId, { inset })`, `unfocus()`, `setInsets()`, `thumbnail(itemId, { size: 256 })`,
   events `view`, `focus`, `context`, `fatal`. The UI creates the engine with **`autoFocus: false`** and calls
   `focus()` itself once the HUD is laid out, so the first flight already frames the object inside the visible
   part (desktop inset ≈ `{ right: cardWidth + 32, bottom: trayHeight + 32 }`; phones `{ bottom: panelHeight }`).
   Esc / «Назад» / empty-space click → `unfocus()`.
2. **Fatal:** `fatal` → dispose + 2D plan + «Попробовать 3D снова». Backstop: canvas `webglcontextlost` not restored
   within 6.5 s (after your 5 s `fatal`).
3. **Loading watchdog:** falls back only if `onProgress` stalls ≥ 45 s on a responsive main thread, or after 240 s.
   QA override `?engineTimeout=<ms>`. (WIP 18:40 builds reached `ready` in 86–139 s on SwiftShader, and the main
   thread was then blocked > 120 s, so harness screenshots time out right after `ready`.)
4. **Keyboard scope (E15):** the UI only swallows arrows/WASD when nothing is focused (`body`); please scope your
   window listener to `document.activeElement === canvas`.
5. Tiers: phones `low`, tablets / iOS / touch-first / ≤ 4 cores `medium`; «Фото» only when `ready.quality === 'high'`.

## To data (catalog / stylepacks / palettes)

1. **EN fields for packs and palettes** (RU/EN toggle): `stylepack.nameEn`, `taglineEn`, `descriptionEn`,
   `consumerRulesEn: [{ title, body }]`; `palette.summaryEn`; `swatch.nameEn`. Missing → Russian is shown.
2. `consumerRules: [{ title, body }]` per pack (P0-4). Dark Walnut falls back to the reviewer's four rules (RU + EN
   in `ui/sections.js`); other packs without it show no rules block.
3. Optional `item.shortName` / `shortNameEn`; optional `item.fact` / `factEn` (one honest, useful sentence for the
   HUD, e.g. «Остаётся 92 см прохода»). Without them the UI derives the short name and computes a price fact.
4. Stylepack description, last sentence «Каждый предмет реален и доступен к покупке.» reads machine-translated.
5. Sizes in names: «200×290», «Ø100» → spaced with units, or dropped (dims are shown anyway).

## To coordinator

1. **CSP:** `index.html` has no inline script except the import map (unchanged byte-for-byte,
   `sha256-NutSaoNeHmtgPTLEDasezHLMqjFAq1OSEgA+/X0vykc=`). The boot-guard hash (`nKy0Lw1G…`) can go.
2. **OG image:** `/assets/og.jpg` (1200×630). Needs the absolute production URL in `og:image` + `og:url`.
3. `formatAED` uses a normal space; the UI uses its own NBSP + locale-aware `aed()` (`ui/dom.js`).

## To assistant

- Mounted per `docs/requests/assistant.md`: `ASSISTANT_MODULE = './ai/assistant.js'`, `/css/assistant.css` in `<head>`,
  `controls: { view, time }` → `stage.setView/setTime` (dock + engine stay in sync), `onFocus` → opens the HUD.
  The slot sits between the stage and the budget; `html.has-assistant` shrinks the stage by 68 px so stage + bar +
  total still fit 1440×900 / 1280×800.

## Resolved

- Vendor: `three-mesh-bvh/src` generated modules (engine). `probes.setEnabled` (engine, fixed in the 18:40 rewrite).
- QA-01 (ghost click after tap), QA-04 (focus after swap / Esc), QA-11 (1.5 cm), QA-14 (skip-link focus target),
  QA-16, QA-17 — fixed in the UI.
