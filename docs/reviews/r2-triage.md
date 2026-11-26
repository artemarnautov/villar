# Round 2 — triage and fix plan (coordinator)

Scores: render 6.0 (phone 4), design 6.5, playtest 7, tech: no P0. Target for round 3: P0/P1 = 0, render ≥ 8, design ≥ 8.
Reports: `r2-render.md`, `r2-design.md`, `r2-playtest.md`, `r2-tech.md` (IDs below refer to them). Evidence in `/tmp/rev2/*`.

Already fixed by the coordinator (commits a83661a, b0543fe — don't redo):
- PT-07 paint brands/codes stripped from public palettes (kept in `research/palette-paint-references.json`).
- PT-08 supplier deny list moved server-side (`api/_deny.js`); `tools/check-public.mjs` now gates every push.
- PT-01 store: each style keeps its picks (away and back loses nothing); `store.restore(snapshot)` added.
  AI style switches use `setStyle(id, { anchor, fresh: true })` (curated set) so AI totals stay exact.
- PT-06 AI Undo reverts only picks that are still as the AI set them; a style undo uses `store.restore`.

Ownership: engine = `site/js/engine/*`, layout; modeler = `site/js/furniture/*`, `materials.js`, `textures.js`;
catalog = `site/data/catalog.json`, stylepacks, palettes, `styles.json`; ui = `site/index.html`, `site/css/*`,
`site/js/ui/*`, `site/js/main.js`, `site/js/ai/assistant.js` + `local.js` + `i18n.js` + `css/assistant.css`;
coordinator = `store.js`, `data.js`, `vercel.json`, `api/*`, `tools/*`.

## Engine — milestone A (ship first: correctness of light + no freezes)
1. R2-01 / PT-02 [P0] low-tier probe GI returns ~no light on furniture (phone fabrics near-black). Target: phone
   frame of the default room within ±10 % luminance of the desktop frame on sofa/duvet/rug.
2. Known #1 / R2-03 / tech root cause: cache converged GI per (style, time) and show it immediately; stand-in for
   never-baked time gets a sun-bounce term (no blue); defer bakes until the style wave ends; reset AE/AWB on time
   change; AE/AWB must not depend on view or canvas aspect and must not freeze during a bake.
3. R2-02 warm GI (`probes.js` TAIL per channel → target R/B of shaded white wall ≤ 1.12 by day, ≤ 1.35 sunset).
4. R2-05 probe seams on walls (no step > 0.05 EV between adjacent probe cells; trilinear + wall-aligned grid).
5. R2-04 walnut too dark (engine part; modeler adjusts albedo): walnut Y′ 45–65 at Entry/Day.
6. T2 / R2-11 shader prewarm: prewarm both light sets for every pack at idle after ready and after each style
   switch, with `renderer.compileAsync` / KHR_parallel_shader_compile; no synchronous compile on a user action.
   Target: no long task > 100 ms on Evening, style switch or swap (measured with PerformanceObserver, GPU path).
7. T1 bake watchdog vs local re-bakes; T9 re-bakes cancel each other; T3 door finish race; T4 context restore
   (engine side: re-upload canvases, re-bake after textures are back).
8. R2-15 / PT-03 focus exposure: meter on the focused object (upholstery within ±15 % of its catalog colour Y′).
9. D2-01 (engine side): `focus()` must frame the object inside the free area left by HUD insets, fully visible,
   with margin; re-frame when insets change (T5: also re-frame after a style wave replaces the model).
## Engine — milestone B
R2-06 day city + window glow, R2-09 evening GI vs lamp pools, R2-10 night windows, R2-14 glossy reflections,
R2-08 lamp-shade shadows (with modeler), R2-19 lens clamp on wide stages, R2-20 entry exposure, R2-21 dollhouse
backdrop + bathroom, R2-22 layout, R2-23 / D2-22 outline (1.5 px soft), R2-24 phone DPR (min(dpr,1.5) when
budget allows), T5, T6, T7 (thumbnails only after the flight ends, budgeted ≤ 8 ms per idle slice), T8 (engine
side), T10 program count, PT-09 mirror/runner visible from a preset view, PT-16 poster = first live frame
(same camera; poster per style), R2-13 limewash wall finish for Mediterranean (wall material per pack),
PT-05 canvas aria-label follows language (expose `setLabel(text)` or let UI set it).

## Modeler
R2-04 walnut albedo/grain (with engine), R2-07 Cashmere Malta table = ceramic top on a slim tulip pedestal (not a
block), R2-13 visible cane panels on the Mediterranean sofa arms + a real cane/rattan chair archetype, R2-08 shades
that cast shadows (opaque/translucent shade mesh), R2-16 floor-lamp shade normals, R2-17 throws (draped, not
flat), duvet edge, olive trunk, R2-18 bouclé texture + pendant trim, PT-04 kitchen set must build from the item's
own colours (black kettle/dark board when the card says so — card, thumbnail and 3D must agree), R2-20 door
veneer, R2-22 art, T4 modeler side (art canvases restorable), T8 idle prebuild time-bounded.

## Catalog
R2-12 Light Oak must read Japandi on its own: its own bed (low, light oak/linen), rug (stone flatweave/jute),
lamps (paper), plant — not Dark Walnut's. PT-11 Mediterranean: its own textiles (stripes, terracotta/olive/blue,
linen) and art. R2-13 prefer items whose cane/rattan is visible. PT-10 the decor set appears on coffee table and
TV unit: make them two different items (separate keys like the three art slots) or one placement. PT-12 tableware
names vs contents, near-identical tiles. PT-13 data inconsistencies (rug name vs dims order). D2-03 EN names for
palette swatches/roles. D2-14 pack copy without jargon, rules shown for every pack. R2-18 pendant trim choice.

## UI (incl. assistant client)
D2-01 HUD footprint on laptops (object stays visible; HUD ≤ ~40 % of the stage; set insets for the engine),
D2-04 + known #2 "From other styles" layout desktop and phone, D2-02 / PT-05 language follows everywhere (style
picker, AI chips, canvas label via engine, initial HTML language), D2-05 "more styles soon" copy, D2-06 phone
double total, D2-07 AI line growth, D2-08 style chip immediate feedback, D2-09 assistant copy, D2-10 budget bar
jump, D2-11 confirm copy ("итог 23 432 AED · −9 163"), D2-12 tiles, D2-13 card materials, D2-15 EN quotes, D2-16
order modal copy, D2-17 mirror/runner grouping, D2-18 phone dock, D2-19 phone back gesture + first view, D2-20 logo
colour constant, D2-21 assistant a11y, known #4 (layout chip EN), known #5 (card clipping), PT-14 AI dead-ends
(offer the item from another style), PT-15 reset focus, PT-17 panel robustness, T7 UI side, PT-01 UI side: after a
manual style switch show a quiet toast «Стиль «…» · Вернуть» that calls `store.restore(prevSnapshot)`.

## Coordinator
T11 caching/waterfall, T12 assistant rate limit (shared store), T13 CSP style-src, PT-18 order: lead capture
(needs a decision from the founder), gate + ship each milestone, round-3 reviews.
