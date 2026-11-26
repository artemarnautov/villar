# Villar MVP — launch QA report

QA lead · 2026-11-25 · read-only pass: no project file was edited apart from this report.
Scripts, logs and screenshots are in `/tmp/qa/` (scratch space, not in the repo).

## Builds under test

The tree changed during QA: commit `c161115` landed at 17:42 and 37 more files were modified without a commit
afterwards. Every result below names the build it was measured on.

| Tag | Build | How tested |
| --- | --- | --- |
| **B1** | `fbdaee8` (16:46) | runs A and B: every swap, geometry checks, heap cycles |
| **B2** | `c161115` = **HEAD = live** | `git archive` copy in `/tmp/qa/head`. Runs G, H (desktop with `--csp`), D (390×844), E2 (keyboard) and the real-touch run |
| **B3** | working tree at 17:57 (`c161115` + 37 uncommitted files) | run F (`--csp`) |

**Live = B2.** With a cache-busting query, the live `/js/core/store.js` already has `isCustomized`, `localStorage` and
`slotIds`. The live `probes.js` has `setEnabled` (≈285 lines, same as HEAD). `/lab/engine.html` redirects to the
landing page. The data JSON matches the local files.

## Verdict

**NO-GO until the two P0s are fixed.**
1. **QA-01:** on phones, tapping a 3D object opens the swap sheet and it closes again at once. This is on live.
2. **QA-02:** the current working tree must not be deployed. Uncommitted engine changes break 3D.

Data integrity, prices, budget math, swapping, the order modal, the deployment config and supplier hygiene (one P1
aside) are solid.

## PASS/FAIL by check

### 1. Data integrity (`/tmp/qa/data-integrity.mjs`; same result on B1 and B3)

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| 1.1 | Every layout slot resolves a default (slot id → group → type) | **PASS** | 26 slots → 22 keys. Every default exists and is in its options. No unused pack keys. |
| 1.2 | Every option exists and matches the slot type | **PASS** | 80 option entries. No duplicates inside a key. No orphan catalog items. |
| 1.3 | Options fit slot `max` (catalog cm vs layout m; pendant counts `h + drop`) | **PASS** | On catalog dims. Some real models exceed `max`; see QA-07. |
| 1.4 | Public price = `round(Σ regular × 1.2)`, integer, from research raw data | **PASS** | 78/78. Components re-summed from `products[].regularPrice`. No price derived from sale prices. All component products are `accepted`. `markup` 1.2, AED. |
| 1.5 | No URL/SKU/pid/supplier in `site/` (JSON, JS, HTML, CSS, comments) | **FAIL (P1)** | 0 hits for Home Centre / homecentre / URLs / the 202 raw pids and skus / accepted English titles / 9-digit codes across 544 files. Public JSON has no sensitive keys. **But:** the marketplace brand names *Mahmayi* and *HomeKode* are public (QA-03), and the literal word "landmark" sits in `sky.js` comments (QA-13). |
| 1.6 | Russian names, materials and colours are sensible | **PASS (1 warn)** | Every name, material and colour is Cyrillic. Latin appears only in model names and "TC". Plant name says "175 см" but dims say 180 (QA-12). |
| 1.7 | Duplicates | **PASS (warns)** | No duplicate ids or names. Two artworks are offered in two slots each, so one work can hang twice (QA-09). The two mattresses render identically (QA-20). |
| 1.8 | `colorHex` valid | **PASS** | All item, `model.params` and palette hexes are `#RRGGBB`. |
| 1.9a | Colour rules (numeric) | **PASS** | All 42 walnut hexes are ΔE76 ≤ 10 from `#553C2C` (max 9.9, `chair-linden`), with h° 54.5–60.9 and L* 24–35. Sofa fabric L* 79.6–90.4. Rugs L* 77.9–87.4 (≥ 65), all ≥ 30 LRV lighter than the walnut coffee tables. Curtains L* 84.9–93.8. Duvets L* 84.6–94.2. Both cognac leathers fall inside L1. No cold greys or bluish whites. Bouclé on one item only. No chrome. Leather only on armchairs. Default room has 1 dark mass (TV unit). |
| 1.9b | Size rules (numeric, rules doc §2/§3) | **FAIL (P2)** | 15 violations, 3 of them defaults (QA-08). |
| 1.9c | Cross-slot rules | **FAIL (P2)** | Not enforceable with the current options (QA-09). |

### 2. Budget math (runs A and G, in page)

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| 2.1 | `store.total()` = Σ over `placed()` after every swap | **PASS** | 80/80 swaps on B1 and on B2, plus 3 more full cycles (B1). |
| 2.2 | Grouped slots counted per placement | **PASS** | Nightstands ×2, table lamps ×2, dining chairs ×2, `decor_set` ×2 (coffee table + TV). The delta after each swap is (new − old) × qty. |
| 2.3 | Wall art counted once per slot | **PASS** | B2: the same work in `art_sofa` and `art_dining` gives 2 separate lines; Σ lines = total. |
| 2.4 | Itemized lines sum to the total | **PASS** | Budget DOM "32 741", 26 items · 22 lines. Order modal Σ lines = 32 741. |
| 2.5 | Defaults and hero | **PASS** | Default total 32 741 AED (matches `catalog-sourcing.md`). B2 hero "от 18 623 AED" = cheapest compatible option per placement (recomputed offline). |
| 2.6 | Persisted selection (new in B2) | **PASS** | Writes to `localStorage`. A fresh store restores it. Tampered entries (unknown id, id from another key, wrong type) fall back to defaults. Broken JSON is tolerated. `reset()` returns to 32 741. A throwing listener no longer blocks the others. |
| 2.7 | API accepts a group name (SPEC) | **FAIL (P2)** | QA-10 |

### 3. Functional flows (harness `tools/shoot.mjs` and copies that stream the logs)

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| 3.1 | Boot to 3D, no console errors | **PASS** on B1 and B2 · **FAIL (P0)** on B3 | B1/B2 ready after 64–115 s on SwiftShader, quality auto-drops to `medium`. Only GL driver "GPU stall due to ReadPixels" performance warnings. B3: `probes.setEnabled is not a function`, so the page falls back to the 2D plan (QA-02). |
| 3.2 | Swap every option of every key; 3D rebuilds | **PASS** | B1 and B2: 80/80. For each swap: `select()` returns true, every slot of the key shows the new item in a new group, all 26 placements stay present, every mesh uses MeshStandard/MeshPhysical, no proxies, 0 build errors. B2 took 71 s with no console errors. |
| 3.3 | 3D renders look right (sampled) | **PASS (notes)** | Shots 10–20 and A/B/G: eye, living, bed, dining, window, top and evening views, before and after swaps. Clipping notes in QA-07; render notes in QA-18. |
| 3.4 | Hover card matches the catalog, no links/SKU | **PASS (1 P2)** | B2: 26/26 slots through the UI API. Name, price, "× 2 шт." for groups, dims, materials and colour all correct. No `<a>`, ids, URLs or pid-like numbers. Real pointer hover (synthetic `pointermove` on the canvas) gave the right card and a pointer cursor for sofa, coffee table, armchair, art and side table. Rug thickness shows as "2 см" (QA-11). |
| 3.5 | Sheet shows only compatible options | **PASS (1 P2)** | B2: 22/22 keys list exactly the pack options in pack order. The current item is marked. Prices, and deltas × qty, are right. Clicking an option swaps the item, updates the total and re-renders the sheet. Rug dims rounding again (QA-11). |
| 3.6 | Order modal totals | **PASS** | B2 and B3: opens from the nav CTA, total 32 741 AED, 22 lines, Σ = total, updates live while open, closes. |
| 3.7 | Mobile 390×844 | **FAIL (P0)** | Layout passes: no horizontal overflow, stage 366×574, bottom sheet scrolls, order modal fits (42–802 px of 844). **Tap on a 3D object → sheet closes at once (QA-01).** Polish items in QA-16. |
| 3.8 | Keyboard: Tab order | **PASS (P2 notes)** | skip link → logo → nav → Заказать → hero CTAs → canvas → time segmented control (roving tabindex) → Фото → view dock → budget toggle → order CTA. Focus rings are visible except on the canvas (QA-14). The view dock responds to arrow keys. Arrow keys walk only while the canvas has focus and the page scrolls otherwise. |
| 3.9 | Keyboard: Esc closes sheet and modal | **PASS** | Sheet: closes. Modal: closes and focus returns to "Заказать". Modal over sheet: the first Esc closes only the modal, the second closes the sheet. |
| 3.10 | Keyboard swap flow | **FAIL (P1)** | Focus is lost after every swap (QA-04). There is no keyboard way to pick an object in 3D; the budget list is the accessible path and it works (focus lands on "Закрыть"). |
| 3.11 | Photo mode | **NOT VERIFIED** | Under SwiftShader the page stopped responding for >30 s (screenshot timeout). Needs a real GPU (QA-18). |
| 3.12 | Long-session stability | **PASS with risk (P2)** | No JS leak: with forced GC the heap went 331 → 336 → 336 → 338 MB over 3 full swap cycles, and geometry/texture counts stayed flat. Two WebGL context losses and one renderer crash in SwiftShader marathons (QA-18). |

### 4. Deployment config

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| 4.1 | `vercel.json` serves `site/` (`outputDirectory: site`, `cleanUrls`, no build) | **PASS** | B2 also redirects `/lab` and `/lab/*` to `/`. Vendor cache is now 1 day + SWR (B1 had `immutable` on unversioned paths). Data uses `must-revalidate`. |
| 4.2 | Nothing referenced outside `site/`; every import resolves | **PASS** | Static resolver on B1, B2 and B3: 200 modules, 491 imports, 124–126 bare specifiers all resolved through the import map, 0 missing. HTML assets and meta images exist. No `research/` paths. In the browser: 126 requests, 0 external, 0 with status ≥ 400. |
| 4.3 | Import map identical to SPEC on every 3D page | **PASS** | index, lab/engine, lab/furniture |
| 4.4 | Production CSP doesn't break the page | **PASS** | B2 and B3 with `--csp`: 0 `securitypolicyviolation` events. B2 inline-script hashes match the CSP. Maintenance risk in QA-19. |
| 4.5 | `research/` not deployed | **PASS** | Live `/research/homecentre-raw.json` and `/research/catalog-sourcing.md` → 4xx. |

### 5. Live site (`https://villar-blond.vercel.app/`, WebFetch)

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| 5.1 | Serves the current build | **PASS** | Live = `c161115` (see Builds). The first fetch without a cache-buster returned an older `store.js`, most likely the fetch tool's cache; confirm with a hard reload after the next deploy. |
| 5.2 | `/data/catalog.json` public, no supplier info | **PASS (P1 caveat)** | 78 items. Keys are only `currency`, `markup` and `items`. No http, homecentre, Home Centre, Landmark, sku, pid, url or 9-digit numbers. Still contains the Mahmayi/HomeKode names (QA-03). |

## Defects

### P0

**QA-01 · Mobile: tapping an object in 3D opens the item sheet and it closes again at once** · owner **interface** · build B2 = live
- **Repro:** Playwright with `isMobile`, `hasTouch`, 390×844, iPhone UA. Load `/`, wait for `__villarReady`, scroll to the stage, `touchscreen.tap` on the bed (and on the armchair).
- **Evidence:** `/tmp/qa/touch.mjs` event trace, 2/2 taps:
  `pointerdown → pointerup → controls.onClick → sheet.open bedding → select bedding → scrim is-open → touchend → click target=sheet-scrim → sheet.close`
- **Cause:** on compact screens the scrim opens under the finger. The browser's synthesized `click` after `touchend` hits the scrim, and `sheet.js` closes the sheet on any scrim click.
- **Impact:** the core flow, tap to swap, fails on phones. The budget list path still works.
- **Fix:** ignore scrim clicks for about 400 ms after opening, or apply the existing `suppressOutside` guard to the scrim too. The WIP `sheet.js` redesign (medium detent without a scrim) may remove the problem; re-run `/tmp/qa/touch.mjs` once WIP 3D works again.

**QA-02 · Current working tree breaks 3D (`probes.setEnabled is not a function`)** · owner **engine** (deploy gate: **coordinator**) · build B3
- **Repro:** at 17:57, `NODE_PATH=$(npm root -g) node tools/shoot.mjs --page /index.html --wait 20000` on the working tree. The console shows `[villar:ui] 3D unavailable — showing the interactive plan: probes.setEnabled is not a function`.
- **Cause:** the uncommitted `probes.js` (17:47) dropped `setEnabled`. `engine/index.js` (unchanged since 16:20) still calls it at lines 246, 251 and 298.
- **Impact:** `vercel` CLI deploys the working tree, uncommitted files included. Deploying now would ship a 2D-only site. The plan fallback itself works: order, budget and sheet all pass on B3.
- **Fix:** sync the engine API. Before any deploy, require a harness smoke run with `ready=true`, no `pageerror`, and `--csp`.

### P1

**QA-03 · Marketplace brand names in public data** · owner **catalog**
- **Where:** `site/data/catalog.json`
  - name "Обеденный стол **Mahmayi**, 80×80", id `dining-mahmayi-80`
  - name "Оливковое дерево **HomeKode**, 180 см", id `plant-olive-homekode`
  - both ids also appear in `stylepack-dark-walnut.json`
- **Why it matters:** these are vendor/retailer names, not model names (the sourcing doc lists them as marketplace brands sold through the supplier). They are shown in the hover card, sheet, budget and order modal, and they lead straight to the source listing.
- **Fix:** rename to neutral model names and new ids. `research/` keeps the mapping.

**QA-04 · Keyboard and screen-reader focus is lost after every swap** · owner **interface** · B2
- **Repro:**
  1. Tab to "Показать состав" and press Enter.
  2. Focus the first line and press Enter; the sheet opens with focus on "Закрыть".
  3. Tab to an option and press Enter.
  4. Result: `document.activeElement` = BODY, because the option list is re-rendered with `replaceChildren`.
  5. Press Esc: the sheet closes, focus stays on a button inside the now hidden sheet, and the opener is not restored (the budget line button was re-rendered too).
- **Evidence:** `/tmp/qa/run-E2-kbd.log` (SWAPKEY, ESC lines).
- **Fix:** after render, focus the newly current option (or update the nodes in place), and look the opener up again by slot id on close.

### P2

**QA-06 · Passage between sofa and coffee table below the rule** · owner **engine** (layout) / **catalog**
- Default room: 35 cm (rule ≥ 45 cm).
- Other combinations: Doree 28 cm; Lockwood or Engler 31 cm; Hadley 33 cm; Arras 34 cm; Baku-high 40 cm; Moxie 44 cm.
- Measured on real model footprints (`/tmp/qa/evals/geometry.js`).

**QA-07 · Furniture goes through walls and curtains** · owner **engine** (slot positions) + **modeler** (model sizes)

Default room:
- `floorlamp-sable`: 5.8 cm through the wall and 13.1 cm into the curtain stack. Its swing-arm model is 60 cm wide; catalog says 40, slot `max.w` is 50.
- `bed-cloud-160`: 2.0 cm through the west wall (`pos.x` 1.10 with depth 224).
- `nightstand_r`: 9.3 cm into the curtains.
- Olive tree canopy: 11.3 cm into the curtains and 13.9 cm over the foot of the bed. The canopy model is 74 cm wide; catalog says 60, slot max is 70.

Option-specific:
- Doree: 4.0 cm through the east wall. Lockwood: 1.0 cm. The sofa slot sits at x = 4.13 m, which leaves room for at most 94 cm of depth, but `max.d` is 1.05 m.
- Nazario bed: 2.5 cm through the wall.
- Frosty floor lamp: 7.3 cm.
- Other model-vs-catalog size gaps: `tablelamp-tolima` model depth 40 vs 35 cm; `plant-olive-homekode` canopy 66 vs 55 cm.

Evidence: `/tmp/qa/run-B.log` (GEOM lines), `/tmp/qa/run-A.log` and `/tmp/qa/run-G.log` (SIZE lines).

**QA-08 · Catalog breaks the numeric size rules of `stylepack-rules-dark-walnut.md`** · owner **catalog**

15 violations, 3 of them defaults:

| Item | Value | Rule |
| --- | --- | --- |
| `sofa-lansbury-3` (default) | back 86 | ≤ 85 |
| `coffee-baku-low` (default) | h 27 | 35–45; footprint 106×88 is neither "Ø80–100" nor "oval 110–130 × 60–75" |
| `dining-kentana-100` (default) | h 73 | 74–77 |
| hadley / engler / anders | backs 88 / 92 / 90 | ≤ 85 |
| lockwood | w 194 | 200–230 |
| doree | w 240, d 102 | 200–230; 85–100 |
| `coffee-baku-high` | h 32 | 35–45 |
| `bed-nazario-160` | headboard 119 | 90–115 |
| `chair-viona`, `chair-pebble` | w 59 | 45–55 |
| `chair-alfred` | h 87 | 75–85 |
| `chair-wishbone` | h 74 | 75–85 |

`catalog-sourcing.md` §8 reports "0 errors" because its script does not check these ranges.

Two minor notes:
- The linen layer of the layered curtains is ΔE76 7.6 from the walls (rule ≤ 5 is the preferred target; a warmer tone is allowed).
- Olina's "золотое тиснение" (gold foil) is borderline against the metals rule.

**QA-09 · Cross-slot rules can't be enforced with the current options** · owner **coordinator** (store constraint) + **catalog**
- `art-caitlin-triptych` (in `art_sofa` and `art_bed`) and `art-zuri-80` (in `art_sofa` and `art_dining`) let one work hang twice, against "Три работы на стенах разные". Verified in B2: the store accepts it and produces 2 lines.
- With either travertine coffee table (moxie, arras), every side-table option is travertine too, so "орех ↔ травертин" cannot be met.
- Nazario bed with any `art_bed` piece leaves an 11 cm gap above the headboard (rule ≥ 15).

**QA-10 · Store API does not resolve group names** · owner **coordinator** · B2
- `store.select('nightstands', 'nightstand-nazario')` returns false with a console warning.
- `slotsFor('nightstands')` returns `[]` and `qty('nightstands')` returns 0.
- The SPEC says "Every API accepts a slot id, group, key or type". In `keyOf`, map a group to `keyOfSlot` of its first slot.

**QA-11 · Rug thickness shown rounded** · owner **interface**
- Hover card, sheet and option rows show "290 × 200 × 2 см"; the catalog says `h: 1.5`.
- Cause: `fmtNum` rounds to an integer. Allow one decimal place for dimensions.

**QA-12 · Plant name contradicts its dims** · owner **catalog**
- "Оливковое дерево 175 см в керамическом кашпо" has `dims.h` 180. The hover card shows both numbers.

**QA-13 · The word "landmark" in public JS** · owner **engine**
- `site/js/engine/sky.js` line 212 on B2 (lines 8 and 283 in the WIP). It means a supertall tower, not the supplier group, but it trips the forbidden-string scan. Rename it.

**QA-14 · Keyboard focus visibility** · owner **engine** / **interface**
- The canvas gets focus with no visible ring, because the engine sets `outline:none` on it.
- The skip link moves to `#studio` but leaves `activeElement` on BODY. Add `tabindex="-1"` to the section and focus it.

**QA-15 · Taps and clicks dropped while the main thread is busy** · owner **engine** (`camera.js`)
- The click test measures `performance.now()` inside the handlers. Under load the handlers ran 1235 ms apart while the event timestamps were 15 ms apart, so the tap was ignored.
- This also happened to later synthetic desktop clicks during the GI bake after swaps.
- Fix: use `e.timeStamp`.

**QA-16 · Mobile polish** · owner **interface**
- Palette ratio labels are clipped at 390 px ("36'", "14'", "12'"); shot `36-m-style.png`.
- 9 tap targets are under 44 px: the view dock buttons are 34 px tall, nav "Заказать" 32 px, "Показать состав" 35 px.
- The studio lead tells touch users to "Наведите на любой предмет" (hover).

**QA-17 · Style section repeats the pack name** · owner **interface** / **catalog**
- The H2 "Тёмный орех." is followed by the tagline "Тёмный орех. Тёплый лён. Ничего лишнего." Shot `36-m-style.png`.

**QA-18 · Robustness under software GL** · owner **engine**
- Two WebGL context losses during long swap sessions. The engine restores, but every later swap logs `INVALID_OPERATION: delete: object does not belong to this context`.
- One renderer crash in the first marathon (about 140 swaps plus view changes). It did not reproduce, and the heap has no leak (see 3.12).
- The JS heap sits at 280–330 MB, which is a risk for iPhone tab limits.
- Photo mode froze the page for more than 30 s. Consider disabling "Фото" when `softwareGL` is detected; the engine already detects it.
- The sync `readPixels` path on software GL produces the "GPU stall" warnings.
- In the evening shot, the sheer curtains show white speckle (`20-eye-evening.png`).

**QA-19 · CSP hash upkeep** · owner **coordinator**
- `vercel.json` pins the SHA-256 of each inline script.
- WIP `index.html` has already removed the boot-guard script, so the CSP lists a stale but harmless hash.
- Any edit to the import map without re-running `node tools/csp.mjs` blocks the import map in production and takes all 3D down. Add a hash check to the deploy gate.

**QA-20 · Options that look identical in 3D** · owner **modeler** / **catalog** · info
- The two mattresses have identical `model.params`, so a swap shows no visible change.
- `coffee-baku-high` and `coffee-baku-low` share params and differ only in size.

## Not covered

- Real-GPU performance: first frame under 4 s and 60 fps.
- Safari and Firefox.
- Photo-mode convergence.
- Real iOS touch. The emulated touch reproduced QA-01; confirm the fix on a device.
