# Villar — review round 2: render & lighting (art direction)

Date: 2026-11-26 · Build: `baa1f80` (`/tmp/villar-rev`) · Reviewer: render / lighting art director
Previous round: `docs/reviews/render.md` (5.5/10). Screenshots: `/tmp/rev2/render/` (crops in `crops/`).

## Verdict

**Overall: 6.0 / 10** (round 1: 5.5). Desktop, high tier: 6.5. Phone, low tier: 4.
Per style: **Dark Walnut 6.5 · Light Oak 5.5 · Cashmere 6 · Mediterranean 6.**

Light now has a direction and a falloff. Sun patches, mullion and olive-tree shadows, morning curtain shadows and
the evening lamp pools are good enough for a "game" read, and Evening/Entry on desktop is the best frame this
product has made. It is held below 7 by systemic problems, not by modelling detail:
- the baked GI is far too warm, so shade and whites go sepia at Sunset and mustard at Evening;
- the auto white balance and exposure are per view and freeze during bakes, so colours jump;
- walnut renders chocolate-black (a regression);
- the daytime city is still grey clay;
- **on phones, every fabric is near-black by day**.

Fix R2-01…R2-06 and the same assets should reach about 7.5; the style-specific asset fixes and a photographic
backplate are what it takes to pass 8.

### What clearly improved since round 1
- **Falloff and contrast (E1).** Sunlit floor p90–p98 = 232–239 (round 1: 226–228). The corridor/entry is now the
  darkest zone: walls Y′ 42 against 157–163 at the window end, Window view, Day. The room no longer reads as a lit set.
- **GTAO halos (E3)** are gone. No fuzz on bedding, cushions or the marble rim in any frame.
- **Verticals (E8)** are corrected. Mullions, door frames and wall corners are vertical in every preset.
- **Tone (E4).** With Neutral tone mapping the window reaches p98 250 and the sun patch does not clip to a white
  slab. Catalogue accent colours (terracotta, olive) hold their hue by day.
- **Evening (E6/M7).** Lamp shadows now exist: the armchair throws a shadow from the floor lamp, and so do the dining
  chairs and table from the pendant. The pendant pools on the table. Drum shades make the hourglass on the wall.
  Shades sit at Y′ 206–222 and no longer bloom to white. The blue-hour sky is navy (fixed from brown).
- **Textiles (M1).** The duvet has drape and folds instead of a foam slab. The dining marble has soft, flat veins (M2).
  Travertine on the DW coffee table reads as banded, pitted stone (M8).
- **Focus framing.** A click flies to a clean 3/4 view that fills the frame (`med-focus-sofa.png`,
  `med-focus-bed.png`), with no clipping through walls.
- **Morning** is now a genuinely good light: the bed with curtain-fold shadows (`dw-morning2-bed.png`) and the olive
  shadow over the TV wall (`dw-morning2-eye.png`).

## Method

- Lab page `/lab/engine.html?clean&quality=high&force&adaptive=0`, 1440×900, software GL (llvmpipe). Every frame
  was taken **after** `villar.debug.gi` reported `state ok / mode baked / baking false`. Frames shot during a bake
  are marked as such. Styles were switched with `__villarStore.setStyle()`, times with `villar.setTimeOfDay()`.
  Product page `index.html?quality=high` (desktop) and `index.html` 390×844 @2x `--touch` (phone, low tier).
- Numbers are sRGB luma `Y′ = 0.2126R + 0.7152G + 0.0722B` on the saved PNGs (`scripts/lum.py`, `scripts/pct.py`).
  "R/B" = mean R ÷ mean B of the patch: a neutral white wall under daylight should be ≈ 1.05–1.15 (paint
  `#ECE7DE` is 1.07).
- Engine debug state (WB gain, EV, programs, draw calls) was logged next to every frame (`run*.log`).

### Luminance vs the engine's own targets (Dark Walnut, Entry, Day — `dw-day-eye.png`)

| Target (engine) | Measured | Verdict |
|---|---|---|
| Walnut 45–65 | TV unit **29.4** (46,27,6), nightstand **22.2** (40,19,2) | **fail**; round 1 was 69 (92,65,47) |
| Sunlit floor 235–245 | p50 226 · p90 232–234 · p98 234–239 | ok (low edge); R channel clips at 253 |
| Near wall 165–185 | 157 (camera wall) · 163 (wall at the window) | slightly low; R/B **1.31** (should be ≈1.1) |
| Window centre 245–252 | sky between towers p50 227 / p90 233; glazing p98 250 | low: the sky reads ~1 stop under "glowing" |
| (far walls 110–135) | window-wall header 157, right reveal 133 | ok |

Other TODs, same view: Sunset shade walls 116–119 at R/B **1.8–2.1**, walnut 28 (50,24,**1**). Evening walls 116
at R/B **2.28**, ceiling R/B **2.70**, white bedding (193,141,71) R/B **2.72**, walnut 42 (69,38,4).

### Per style (Entry at Day and Evening, room presets at Day)

| Style | Score | Reads as its style? |
|---|---|---|
| Dark Walnut | 6.5 | Yes in composition: walnut, oat, travertine, brass, olive and terracotta. But the walnut goes black-orange (R2-04), so "warm walnut" becomes "dark brown furniture". Sunset is sepia (R2-02). Evening is the strongest frame of all four styles (`dw-evening2-eye.png`). |
| Light Oak | 5.5 | Weakly. It shares the bed, headboard, rug, table lamps and olive tree with DW, and no charcoal or black-metal accent is in frame, so it reads "DW minus walnut", not Japandi (R2-12). The oak renders orange: TV unit Y′ 60 at R/B 2.75, darker than the floor, where the palette wants one step lighter. |
| Cashmere | 6 | Yes by day: tone-on-tone ivory, bouclé, channel-tufted headboard, cream ribbed nightstands, no dark masses (`gl-day-eye.png`). Broken by the dining table, a solid glossy block (R2-07), and by the pendant's rust trim (R2-18). Bouclé reads as smooth felt. |
| Mediterranean | 6 | Partly. The cane TV unit, rattan dome floor lamp and pendant, dhurrie and terracotta bowl carry it (`med-day-eye.png`, `med-evening-eye.png`). The sofa shows no cane, the "cane" lounge chair is a mustard upholstered block, and the walls are flat paint, not limewash (R2-13). |

Evening for Cashmere and Light Oak (`gl-evening-eye.png`, `lo-evening-eye.png`) was captured on the third attempt,
with 60 s waits after each switch. Twice before, switching style while in Evening froze the page past the harness
limits (`run3.log`, `run5.log` → R2-11).
- Cashmere at Evening is the most convincing "quiet-luxury hotel" frame of the set.
- Light Oak at Evening still reads as DW without the walnut.
- All four Evening frames share the mustard cast of R2-02.

---

## Findings (most severe first)

### R2-01 [P0] Phone (low tier): fabrics render near-black by day (sofa, rug, duvet)
- Owner: engine (probe GI on the `low` tier)
- Repro: `index.html` 390×844 @2x `--touch` (tier `low`, dpr 1), DW, Day, Entry. Also seen after tapping an item
  (focus on curtains).
- Expected: oat sofa, oatmeal rug, white duvet, as on desktop (desktop high: duvet ≈ 200+, rug ≈ 150).
- Actual:
  - Rug Y′ **4** (5,4,2). Sofa Y′ **8** (8,8,6). Shaded duvet Y′ 47 (50,47,44); in the focus frame it is slate
    (55,59,61), so a white percale duvet reads navy.
  - Walls (125) and floor in the same frame are normal, and the sun-lit edge of the duvet is white. Only *indirect*
    light on furniture is missing, and fabrics are the worst hit.
  - At Evening (lamp-lit) the duvet is visible (76, still about half of desktop).
  - This is the default first impression on every phone, and it shows the catalogue products in the wrong colour.
- Evidence: `ph-day-eye.png`, `ph-day-focus.png`, `ph-evening-eye.png`. Diagnostic: the lab reproduces it on desktop with
  `?quality=low&force&tod=day`, so the cause is the tier, not the phone (`low-day-eye.png`): sofa Y′ 4 (1,5,6),
  duvet 1.8. With `villar.debug.probes.setMode('constant')` the same frame gives sofa 74, rug 80, duvet 87
  (`low-day-eye-constGI.png`). The **baked low-tier probe grid returns ≈ 0 irradiance on furniture**. Walls are
  only mildly affected. The material dump shows normal `MeshPhysicalMaterial` linen and wool with maps.
- Fix:
  1. In the probe lookup, when Σ(trilinear × validity) < 0.05, fall back to the constant ambient SH (or the nearest
     valid probe) instead of normalising four `1e-4`-weighted invalid corners.
  2. Make sure invalid probes get the dilated SH on **every** tier before upload. Low uses 1 bounce and the coarsest
     grid (`PROBE_RES.low = [4, 3, 7]`, cells ≈ 1.15 × 0.95 × 1.29 m), so a sofa, bed or rug can fill every
     corner of its cell with invalid probes.
  3. Run the `healthy()` check per region, not just the grid mean.
  4. Add `?quality=low&force` frames to the release checklist.
- Target: on `low`, every fabric within ±15 % Y′ of the `high` frame at the same view and time.

### R2-02 [P1] The baked GI is far too warm: shade, ceiling and whites go sepia (Sunset) and mustard (Evening)
- Owner: engine
- Repro: lab or product, any style, Entry. Compare Day → Sunset → Evening after the GI has baked.
- Expected: warm sun patches, shade near neutral (lit by sky plus some floor bounce). A white wall in shade should be
  R/B ≈ 1.05–1.15 by day, ≈ 1.1–1.3 at Sunset (clearly cooler than the sun patch) and ≈ 1.3–1.45 at Evening under
  2700 K with WB 3300 K.
- Actual (DW, Entry):
  - Day: walls R/B **1.31**, ceiling 1.31, shaded floor R/B 2.48.
  - Sunset: shade walls R/B **1.8–2.1**, i.e. *more* orange than the sun patch (1.28; that patch is also clipped).
    Walnut (50,24,**1**).
  - Evening: walls R/B **2.28**, ceiling **2.70**, white percale (193,141,71) R/B **2.72**.
  - Product Sunset (`p-sunset-eye.png`): walls 1.94, ceiling 1.86. The AWB is pinned at its clamp (B gain 1.41–1.51 at
    Sunset and Evening), so the HDR scene is warmer than the clamp can correct.
  - The same cast makes Light Oak furniture orange: TV unit (78,58,28) R/B 2.75, Y′ 60, *darker* than the floor,
    though the palette wants it one step lighter.
- Evidence: `dw-golden2-eye.png`, `dw-golden2-living.png`, `dw-evening2-eye.png`, `dw-evening2-bed.png`,
  `p-sunset-eye.png`, `p-evening-eye.png`, `lo-day-eye.png`. Round-1 day walls were R/B 1.21, round 2 is 1.31.
- Cause (high confidence): `probes.js:322` `TAIL = 0.5 / (1 − 0.5) = 1.0`. It is applied **per channel** to the last
  bounce delta (`sh + (sh − prevSH) · TAIL`, line 408). Each bounce off the oak floor (R/B ≈ 1.5) and warm walls
  multiplies the chroma, so doubling that delta doubles the colour bleed, not just the energy. Round 1 asked for
  0.3; it went up to 1.0.
- Fix:
  1. Extrapolate the missing bounces in **luminance only**: scale each probe's SH by `1 + TAIL·ΔY/Y` and keep the
     2-bounce chroma. Use `TAIL ≤ 0.35`.
  2. Clamp the tail's per-channel ratio to the 1-bounce chroma ±10 %.
  3. Re-check against photo mode on `window` / `dining`.
  4. Targets: Day walls R/B ≤ 1.15. Sunset shade R/B 1.1–1.3 with the sun patch ≥ 1.5. Evening white R/B ≤ 1.45.
     AWB gain inside ±0.15 log at every TOD; if it needs more, the light is wrong, not the camera.

### R2-03 [P1] AWB/AE are per view, depend on the canvas aspect, and freeze during every bake: the room goes blue-grey after a single Sunset click
- Owner: engine
- Repro: product `index.html?quality=high`, DW, Entry, Day, ready. Click **Sunset** once and wait 12 s.
- Expected: the frame warms toward sunset. The camera WB stays put while the GI bakes.
- Actual:
  - The whole room turns blue-grey for the whole bake (`p-sunset-early.png`). GI sits on the constant ambient
    (`stale/constant`) and the WB is still the **Day** gain `[0.848, 1.017, 1.277]`. On software GL that lasts 39 s.
  - In the lab the same happens after a view change: the Window view's correction `[-0.27, +0.33]` log was carried
    into Sunset. Shade walls R/B **0.78–0.82**, Y′ ≈ 85 (`dw-golden-eye.png`, `dw-golden-window.png`).
  - Gray-world is per frame, so catalogue colours shift between presets of the same TOD. Morning B gain: Entry
    1.157, Bedroom 1.234, Living **1.42** (+23 %). Day Cashmere: Entry 1.27, Bedroom 1.33, Living 1.48, Dining 1.49.
  - It also depends on the stage aspect. The same Sunset scene gets B gain 1.415 in the 1440×900 lab and 0.949 in the
    product's 1392×548 stage.
  - After a style switch the meter stopped for the rest of that sequence: all five Light Oak views logged identical
    EV −0.11 and WB, so the Dining view rendered about 1 EV darker than its DW counterpart (`lo-day-dining.png`).
  - In the Window view the Cashmere painted entry door is a cold neutral grey (63,63,63) instead of warm pearl
    (`gl-day-window.png`).
- New on known issue #1: same-tick chip clicks are not needed. The cast appears whenever the TOD changes while
  `probes.baking`, because `render()` only requests the meter when `giSettled && !probes.baking`
  (`index.js:907, 943–944`) and nothing resets `awb.cur` / `ae.ev` when the TOD changes.
- Fix:
  1. Make WB **deterministic per TOD**: use `TOD[t].wb` (once R2-02 is fixed this is enough). If AWB stays, limit it to
     ±0.05 log around that value and meter one fixed reference view per TOD × style, not every preset.
  2. On `setTimeOfDay` / `setStyle`, reset `awb.cur` and `ae.ev` to that TOD's defaults immediately.
  3. Keep metering during bakes (the meter reads the final frame and is cheap).
  4. While a TOD bake runs, cross-fade from the old baked SH instead of dropping to `constant`.
  5. Target: no frame during or after a TOD/style change with a shaded-wall R/B outside the TOD's band (R2-02).

### R2-04 [P1] Walnut renders chocolate-black: a regression that erases the Dark Walnut signature
- Owner: modeler (texture palette); engine (R2-02 makes it worse)
- Repro: DW, Entry, Day. TV unit and nightstands.
- Expected (engine's own target): walnut Y′ 45–65, warm brown with visible figure. Palette `#553C2C`, tolerance
  `#3F2C21…#6B4B35`.
- Actual:
  - Day: TV unit **29.4** (46,27,6), nightstand **22.2** (40,19,2). Grain is invisible at 3 m. Round 1: 69.3 (92,65,47).
  - Sunset 28 (50,24,1). Product Sunset 23 (43,19,3).
  - Evening 42 (69,38,4); the R/B 8–40 means the blue channel is crushed to 0–6.
  - The dining chairs and pedestal and the walnut entry door read as near-black silhouettes in the Dining and Window
    views (door Y′ 30).
- Evidence: `dw-day-eye.png`, `crops/dw-day-eye-right.png`, `dw-day-window.png`, `dw-golden2-eye.png`.
- Fix:
  1. In `textures.js` `WOOD_PALETTES['walnut-dark']`, lift the tones to light `#7a5a43` / mid `#5a4030` /
     dark `#3a2a1f` / streak `#86664c`. The mid is now `#463022`, below the palette. Also reduce the
     dark-tone chroma.
  2. Keep `clearcoat 0.22`, roughness 0.42 so a window sheen reads on the tops.
  3. With R2-02 fixed, re-measure. Target: walnut Y′ 50–65 by day and 45–60 at evening, with B ≥ 20.

### R2-05 [P1] Hard horizontal seams on walls (indirect light steps by 0.3–0.5 EV within one pixel)
- Owner: engine
- Repro: any style, Living preset, Day/Sunset/Morning.
  - (a) Left edge, wall behind the sofa arm, x 0–100 px, y ≈ 624.
  - (b) Wall beside the side table and armchair, x 900–1140, y 460–550 (Morning).
- Expected: smooth indirect light on a flat painted wall.
- Actual:
  - (a) Y′ steps from 75 to 58 in 4 px with a slanted, aliased edge. It is the same in DW, LO, GL and DW-Sunset
    (59→46, 75→61, 54→49), so it does not depend on furniture.
  - (b) A lighter band with a hard top edge: 157→177, 167→196, 160→219 (+0.15…+0.45 EV) at 0.6–0.9 m height.
- Evidence: `crops/dw-day-living-leftwall.png`, `crops/dw-morning-living-wallpatch.png`, `dw-morning2-living.png`,
  `lo-day-living.png`, `gl-day-living.png`.
  Bisect (DW, Living, Day): `bis-living-a-base.png` (baked GI), `bis-living-b-noAO.png` (GTAO off: steps unchanged,
  75→58 and 189→203), `bis-living-c-constGI.png` (probes forced to `constant`: both steps gone, flat 91 / 92).
  So the steps come from the probe-grid lookup, not from AO or the sun.
  The bright band in (b) is **all GI**: it looks like a sun patch, but with constant GI it disappears.
- Cause (likely): binary probe validity in the 8-corner lookup (`probes.js` patch, `w *= max( t6.w, 0.0 ) + 1e-4`).
  When a probe layer next to the wall or a piece of furniture is invalid, the normalised weights flip from the layer
  below to the layer above exactly at that layer's plane. That gives a hard step at constant height (≈ 0.6 / 0.9 m).
- Fix:
  1. Soft validity. Invalid probes already get dilated SH at bake time, so weight them `mix(0.25, 1.0, valid)`
     instead of `1e-4`.
  2. Better: DDGI Chebyshev visibility (mean / mean² hit distance per probe), the round-1 recommendation, instead of
     a binary flag.
  3. Bias the lookup point by `0.45·spacing` along the normal plus 0.1 m toward the camera.
  4. Target: no step > 3 Y′ between adjacent pixels on a flat wall in any preset or TOD. Check rows x 0–100 and
     900–1140 on the Living preset.

### R2-06 [P1] By day the city is still a grey clay model, and the window does not glow
- Owner: engine
- Repro: any style, Entry/Bedroom, Day or Morning.
- Expected: a Dubai high floor. Dark blue-green and bronze glass towers that reflect the sky, mid-tone sand and
  concrete low-rise, roads, a little green. The window is the brightest thing in frame (centre 245–252).
- Actual:
  - Every tower is the same light grey with a fine window grid. There are no visible reflections or tint variety
    (the `GLASS` tints are washed out by the haze emissive and the bright horizon reflection).
  - Low-rise roofs are near-white flat slabs that read like snow (`crops/dw-day-eye-window.png`).
  - Burj is a stack of grey cylinders.
  - Sky between the towers is p50 227 / p90 233 (target 245–252).
- Evidence: `dw-day-eye.png`, `dw-day-bed.png`, `lo-day-bed.png`, `dw-morning2-bed.png`, `crops/dw-day-eye-window.png`.
- Fix: round 1's option A (a photographic backplate, three plates day / golden / night) is still the only route to
  "photoreal". For the procedural route (`sky.js`):
  1. `glassDay` emissive haze ×0.55 → ×0.2 at `dist < 1500 m`, `metalness 0.35 → 0`, and take the vertex tint
     straight from `GLASS` (no `curtain` map brightening).
  2. Roof albedo `#a89c88` with a rooftop-clutter texture (AC boxes, parapets).
  3. A road grid in asphalt `#57534c`.
  4. Day `horizonL 0.75 → 0.9` so the sky reaches 245+ at the current exposure.
  5. Burj: Y-plan with 3 wings and setbacks, `#c9d2d8` glass.

### R2-07 [P1] Cashmere dining table renders as a solid glossy block to the floor
- Owner: modeler (catalog check: item "Malta ceramic-top dining table, painted metal tulip pedestal")
- Repro: Cashmere, Dining or Window preset, any time.
- Expected: a 90×90 soft-square top about 2–3 cm thick on a slim tulip pedestal, with knee space so the chairs can tuck.
- Actual:
  - The top footprint is extruded to the floor: a cream monolith that reads as a kitchen island or a washing machine.
  - The glossy body shows pixel-block reflection patches (see R2-14).
  - The chairs stand against its sides with no knee space.
- Evidence: `gl-day-dining.png`, `gl-day-window.png`, `crops/gl-day-window-table.png`.
- Fix:
  1. `furniture/tables.js`: for `shape: soft-square` build top (h 0.03) + apron (0.06) + tulip/trumpet pedestal
     (Ø 0.12 stem, Ø 0.50 foot).
  2. Marble-look ceramic only on the top, matte painted metal `#e6dfd3` below.

### R2-08 [P1] Lamp shades cast no shadow by day: floating ring outlines on walls and floor
- Owner: engine (`furnish.js:139`), modeler
- Repro: DW, Morning, Bedroom (right table lamp) or Entry (wall beside the right lamp). Also Plan, Day (floor next to
  the TV unit).
- Expected: a fabric drum shade in the sun casts a solid, soft shadow (slightly lighter at the rim).
- Actual: only the thin wire rings cast shadows. Two hairline ellipses float on the wall and floor with no shade
  shadow between them. It is an obvious CG tell in the best-lit frames.
- Evidence: `dw-morning2-bed.png` (wall right of the lamp), `dw-morning2-eye.png`, `crops/dw-day-top-tv.png`.
- Cause: `furnish.js:139` marks every mesh whose material is `glow` or named `shade|bulb` `noCastShadow`, so the
  lamp's own spots are not blocked. That also removes the shade from the **sun** shadow.
- Fix:
  1. Let shades cast. Keep them out of their own lamp's shadow by giving lamp spot shadows
     `shadow.camera.near = 0.12–0.15` (larger than the bulb-to-shade distance), or put the shade on a layer the
     lamp's shadow pass skips.
  2. Only the bulb stays `noCastShadow`.

### R2-09 [P1] Evening: the GI fills the room evenly and the lamp pools disappear
- Owner: engine
- Repro: DW, Evening, Living (after bake).
- Expected: pools of light. The wall 2.5 m from the floor lamp at least 1–1.5 EV darker than next to it, and dark
  corners between lamps.
- Actual: sofa wall far end 101.7 = mid 101.8 vs next to the lamp 113.4 (**0.15 EV**). The floor in the armchair's lamp
  shadow is 115 vs 129 lit. The pre-bake frame (constant ambient, `dw-evening-living.png`) had more night contrast
  than the baked one (`dw-evening2-living.png`).
- Fix:
  1. Evening probes: apply R2-02 (no chroma or energy tail).
  2. Bake lamp-only indirect at 1 bounce.
  3. Lower the evening constant/ambient floor.
  4. Target: far-wall/near-lamp ratio ≤ 0.5 (−1 EV) on the Living preset, with downlight scallops kept at p98 ≤ 235.

### R2-10 [P1] Night city: lit windows are big square pixels and glitter
- Owner: engine (`sky.js` night texture)
- Repro: any style, Evening, Entry or Bedroom.
- Expected: individual lit windows at 0.6–2 km are sub-pixel. Towers read as soft vertical stripes of warm/cool
  light with darker floors; the far city averages into a glow.
- Actual: 6–10 px square blocks in a regular grid that read as an LED billboard. Through the sheer they become
  glitter (`dw-evening2-bed.png` left, `dw-evening-living.png` right edge).
- Fix:
  1. Mip-mapped emissive with `anisotropy 16`.
  2. Window cells at real scale (3.2 m floor × 1.5 m bay), with per-floor dark bands.
  3. Beyond 1.2 km replace the texture with the averaged emissive (round-1 E2B).
  4. Clamp the max window radiance so the p98 of the city ≤ 150 at the evening exposure.

### R2-11 [P1] Style switch at Evening compiles ~65 programs and freezes the page
- Owner: engine
- Repro: lab, Evening, DW ready → `setStyle('light-oak')`, then a frame.
- Expected: no frame > 50 ms on a mid laptop (PHASE2 §4). New items share the pre-compiled evening programs.
- Actual: `programs` went from 73 to **138** and the next screenshot timed out (> 30 s blocked; `run3.log`). In the
  product, clicking an item at Evening also blocked > 30 s (`run7.log`, the focus screenshot timed out). Software-GL
  seconds are not representative, but the program count is: about 65 new variants per pack × time set.
- Fix: pre-compile each pack's material set for **both** light sets in idle time (`prebuildPacks` already exists;
  run `renderer.compileAsync` on the evening light rig for every pack). Unify material variants (same defines for
  sheen/clearcoat/transmission per family). Target: ≤ 5 new programs on any style switch after idle prewarm.

### R2-12 [P1] Light Oak does not read as Japandi
- Owner: catalog (item choice), modeler
- Repro: Light Oak, Day, Entry and Bedroom.
- Expected (`palette-light-oak.json`, rules): low profile, oak one step lighter than the floor, stone linen and
  rice paper, contrast from charcoal wood and thin black metal, one muted sage. Empty space around things.
- Actual:
  - The biggest objects are DW's. Same tufted "Cloud" bed and headboard, same Heaton rug, same Crosby table lamps,
    same olive tree.
  - No charcoal or black accent is in any preset frame (black only in the window frame and TV).
  - The "Diamant paper-cord **column**" floor lamp renders as a small drum on a stick (`crops/lo-day-eye-floorlamp.png`).
  - The oak renders orange-brown (R2-02).
  - The room reads as "Dark Walnut without walnut".
- Fix:
  1. Catalog: default LO bed to a platform/oak-frame bed (`style: 'platform'`, `headboard: 'wood-panel'|'slatted'`),
     a paper or rice-paper table lamp, a jute or flat-weave rug in stone, and one charcoal piece (side table or
     mirror) in the Entry view.
  2. Modeler: build the paper-cord column (Ø 0.25–0.3 × 1.2–1.5 m cylinder, emissive at night).

### R2-13 [P1] Mediterranean loses its signature: no visible cane on the sofa or the "cane" chair, and no limewash
- Owner: modeler (sofa arm panel, chair archetype), engine (wall finish), catalog
- Repro: Mediterranean, Day, Entry / Living / focus on the sofa.
- Expected (`palette-mediterranean.json`): walls and ceiling as one coat of limewash. Natural rattan and Vienna cane
  as the style's signature. Terracotta and olive accents.
- Actual:
  - "Oshawa sofa with cane sides": the cane is a plane only on the outer arm faces (`seating.js:149–155`). It is
    invisible from every preset and from the focus orbit, so the sofa reads as a plain linen sofa
    (`med-day-living.png`, `med-focus-sofa.png`).
  - "Sukhna cane lounge chair" (`style: lounge`, `fabric: cane`) renders as a mustard upholstered slipper chair, a
    saturated yellow block with no weave (`med-day-eye.png`, `med-evening-living.png`).
  - Walls use the same flat `paint` as every other pack.
  - What does work: the cane TV unit doors, the rattan dome floor lamp and pendant, the dhurrie rug, the terracotta
    bowl. Those are the only reasons the style reads at all.
- Fix:
  1. Sofa: cane panel inset into the arm *front and inner* faces as well (or a framed cane side panel spanning the
     full arm).
  2. Sukhna: build from the dining-chair cane path (exposed wood frame `#8E6446` + cane seat and back panels with
     an alpha weave), not as upholstery.
  3. Engine: add `architecture.wallFinish: 'limewash'` → `materials.get('plaster-wall', { color, mottle: 1.4 })` for
     walls and ceiling in this pack.

### R2-14 [P1] Reflections on glossy curved objects are pixelated (8-bit blocks)
- Owner: engine (room/env cube sampling)
- Repro: Mediterranean (any style's kitchen), Window view, click the kitchen decor → focus. Also the Cashmere dining
  table body.
- Actual: the steel kettle shows stair-stepped 6–10 px blocks of light and dark in its reflection
  (`crops/med-focus-kettle.png`). The same blocky rectangles show on the glossy Cashmere table
  (`crops/gl-day-window-table.png`). In a focus close-up this is the first thing the eye lands on.
- Fix: the box-projected room cube needs mipmaps + `LinearMipmapLinearFilter` and roughness-based LOD (or PMREM it).
  Raise its resolution to ≥ 256² per face on high. Check that `reflections.js` box projection does not sample a lower
  mip than roughness requires.

### R2-15 [P1] Focus close-ups are not exposed for the object: the kitchen is almost black
- Owner: engine
- Repro: lab, Mediterranean (after a style switch), Day, Window view → click the kitchen decor.
- Expected: spot metering when focused (the code allows +1.6 EV). The focused object's mid-tones ≥ 110.
- Actual: worktop Y′ **20** (30,19,3), upper cabinets 23. The kettle, fruit and board are barely visible. The meter
  was frozen after the style switch (identical EV −0.09 and WB across all views and focus shots, see R2-03), so the
  spot branch never ran. Even with it, +1.6 EV only lifts the worktop to about 45–50.
- Evidence: `med-focus-kitchen.png`, `med-focus-coffee.png` (dim), `run5.log`.
- Fix:
  1. Unfreeze the meter (R2-03).
  2. In focus mode, meter only the object's screen rect, allow up to +2.5 EV, and turn the under-cabinet LED strip
     on at 30 % by day when the kitchen is focused (it is a real fixture).
  3. Target: focused-object median Y′ 110–150 in any TOD.

### R2-16 [P2] Floor-lamp shade has a dark wedge (wrong normals)
- Owner: modeler
- Repro: DW, Morning or Day, Entry, Sable floor lamp (x≈250–262, y≈390–415).
- Actual: the left quarter of the tapered shade is a hard-edged dark slate wedge, (29,37,40) next to (115,92,65). It is
  there at both times of day, so it is not a sun shadow. A similar dark-slate sliver shows at the sofa arm/cushion
  junction (25,31,30).
- Evidence: `crops/dw-morning-lamp.png`, `crops/dw-morning-sofaarm.png`.
- Fix: recompute normals on the shade's seam segment (likely a lathe seam with flipped or duplicate vertices);
  `side: DoubleSide` with consistent winding.

### R2-17 [P2] Asset polish: throws are flat sheets, the duvet edge is jagged, the olive trunk is white
- Owner: modeler (`furniture/textiles.js`, `beds.js`, `decor.js:277`)
- Repro: any style, Day. Living/Entry (throw on the sofa's right arm), Bedroom (duvet), Entry (olive by the window).
- Actual:
  - **Throws** are a 2-sided plane with no thickness or fold shading. The hem lying on the seat is a jagged, aliased
    zig-zag, and "fringed edge" items show no fringe. They read like napkins cut with scissors
    (`crops/dw-day-living-throw.png`, `crops/gl-day-eye-sofa-throw.png`).
  - **Duvet** turn-down edge is a stair-stepped polyline (y 560–600 in `dw-day-bed.png`), and a thin white "hem"
    line still runs along the foot (y ≈ 760): the old tube in disguise (`gl-day-bed.png`, `dw-evening2-bed.png`).
  - **Olive trunk** uses `barkMat '#cfc4b4'` and renders near-white in sun and shade, like PVC pipe
    (`crops/dw-day-eye-window.png`).
- Fix:
  - Throw: 8–12 mm thickness with a rounded hem, ≥ 48 segments along the drape, 2–3 soft folds where it breaks over
    the arm (±3 cm), fringe as an alpha card strip (6–8 cm), knit or waffle normal at 8–12 mm cells.
  - Duvet: subdivide the turn-down edge (≥ 64 segments) with a 2–3 cm rounded roll; delete the hem line.
  - Bark: gradient `#7f7566` → `#5e554a`, roughness 0.95, 2–4 cm fissure normal. Olive bark is grey-brown and darker
    than the pot.

### R2-18 [P2] Cashmere bouclé reads as smooth felt; the pendant has a rust trim (a banned colour)
- Owner: modeler (bouclé), catalog/modeler (Cosme pendant trim)
- Repro: Cashmere, Day, Entry/Living (sofa, armchair); Dining (pendant).
- Actual: no loop texture at 1.5–3 m. The Cosme drum has two rust bands (≈ `#8a4a25`). Cashmere rules forbid rust and
  terracotta accents ("Цветные акценты … запрещены").
- Fix: bouclé normal 3–4 mm loop cells, `normalScale 1.2`, sheen 0.8 / sheenRoughness 0.95, plus slight AO variation
  in albedo. Trim colour from the pack's metal (`#B8A27A`) or tone-on-tone linen.

### R2-19 [P2] Product stage is 2.54:1, so the lens goes to 85° and the edges stretch
- Owner: engine (`camera.js:580–581`)
- Repro: product desktop 1440×900, Entry. The stage is 1392×548.
- Actual: vFOV is clamped at ≥ 40°, so hFOV becomes ≈ 85° (about 19 mm) instead of 74°. The sofa, cushions and art
  at the left edge are visibly stretched (`p-day-eye.png`).
- Fix: allow vFOV down to 30° for aspect > 2 (hFOV stays 74°), or show the room at 16:9 with a pillarboxed sky.

### R2-20 [P2] Entry corridor and door read as a black void by day
- Owner: engine (exposure), modeler (door veneer)
- Repro: DW, Day, Window preset.
- Actual: corridor walls Y′ 42, door 30 at a neutral/purple (33,29,30). The door's veneer is invisible and it reads as
  an opening. With the Cashmere AWB the painted door is a cold grey (63,63,63).
- Fix:
  1. Window preset: AE compensation 0.45 → 0.6 (spot-weight the centre).
  2. A small local-contrast lift (e.g. 2-zone exposure blend, ±0.5 EV) in post.
  3. Door veneer to the lifted walnut (R2-04).
  4. Target: corridor walls ≥ 60, door ≥ 40 with visible grain.

### R2-21 [P2] Evening dollhouse sits on a periwinkle backdrop; the bathroom is a black box
- Owner: engine (`applyBackdrop`, cutaway WB)
- Repro: any style, Evening, Plan.
- Actual: backdrop (189,205,235) R/B 0.80 because the cutaway WB (0.4 × 3300 K) is applied to `#c9c4bc`. Bath Y′ 15.
  Day is fine (185,182,177).
- Fix: render the backdrop after WB (or pre-compensate it), dark warm grey `#3a3632` at night. Give the bathroom one
  dim downlight in cutaway.

### R2-22 [P2] Small layout and art issues seen in every DW frame
- Owner: engine (layout), modeler (art)
- Nightstand L butts the 185 cm TV console with ~0 cm gap (`crops/dw-day-top-tv.png`). Leave ≥ 12 cm or shorten
  the console to 160 cm.
- The Bedroom preset puts the foot of the duvet in the lower 40 % of the frame (`dw-day-bed.png`). Move the camera to
  about [3.6, 1.5, 6.0] → target [0.6, 0.8, 7.5].
- Wall art: "Zuri" / LO canvas reads as crumpled paper with gold coins, and the DW "Aquarelle" relief as camouflage
  blobs. Use a softer, painterly texture with canvas weave at 1:1 scale.

### R2-23 [P2] Focus highlight is a hard 1-px white cut-out line; a cream ring frames the canvas after a click
- Owner: engine (outline pass), ui
- Repro: lab, any style, click the sofa, bed or coffee table.
- Actual:
  - The selection outline is a crisp white contour that also traces cushion tops and the duvet edge. It reads as a
    sticker cut-out on a photoreal frame.
  - After a mouse click a 2-px `#fff6e8` ring appears 2 px inside the canvas edge (`index.js:143` `:focus-visible`
    branch). Seen in headless Chrome after mouse clicks; please verify on a real browser.
- Evidence: `med-focus-sofa.png`, `med-focus-bed.png`, `med-evening-eye.png` (edges).
- Fix: outline `edgeStrength` ≈ 1.5, `edgeGlow` 0.4, `visibleEdgeColor` at 50 % alpha, fading out 1.2 s after the
  flight ends. Do not show the canvas ring for pointer-initiated focus.

### R2-24 [P2] Phone renders at 1× on 2× screens: the whole image is soft
- Owner: engine (`QUALITY.low.maxDpr = 1`)
- Repro: phone 390×844 @2x.
- Actual: the 366×573 CSS stage is rendered at 366×573 px and upscaled 2×. Edges and texture detail smear, and the
  city reads as mush (`ph-day-eye.png`). 96 draw calls and 121 k triangles leave headroom.
- Fix: `low.maxDpr 1.5` with MSAA 2 (or 1.25 + FXAA). Let the adaptive loop step down to 1.0 only when fps < 40.

---

## New information on known issues (not re-reported)

- **#1 (blue/grey cast).** Not only same-tick chip clicks: a single Sunset click shows it for the whole GI bake
  (`p-sunset-early.png`, 39 s on software GL). Cause: TOD changes drop the probes to `constant` ambient while AE/AWB
  keep the previous TOD's gains, because metering is gated on `!probes.baking` (`index.js:907, 943–944`) and nothing
  resets `awb.cur`/`ae.ev` on `setTimeOfDay`/`setStyle`. Fix in R2-03.
- **#3 (first Evening stall).** A style switch *while* in Evening has the same cost (programs 73 → 138), see R2-11.

## Fix order (engine → modeler → catalog)

1. **R2-01** Phone fabrics black: find and fix the low-tier indirect path for fabric materials (blocks the phone
   experience).
2. **R2-02** GI tail in luminance only, `TAIL ≤ 0.35`. Re-measure walls R/B per TOD (targets in R2-02).
3. **R2-03** Deterministic per-TOD WB. Reset AE/AWB on TOD/style change. Meter during bakes. Cross-fade the old SH
   instead of `constant`. Then **R2-15**: spot-meter focused objects.
4. **R2-04** Walnut palette lift. Target Y′ 50–65 by day.
5. **R2-05** Soft probe validity / Chebyshev visibility (removes the wall seams).
6. **R2-06 / R2-10** City by day (photo backplate, or the glass/roof/road changes) and at night (mips + averaged
   far emissive). Raise the day sky to 245+.
7. **R2-14** Mipmapped, roughness-filtered room reflections (kettle, glossy surfaces).
8. **R2-08** Shades cast sun shadows (lamp shadow `near` 0.12–0.15). **R2-09** Evening contrast: far wall ≤ −1 EV vs
   next to a lamp.
9. **R2-11** Pre-compile every pack × both light sets in idle. ≤ 5 new programs per style switch.
10. **R2-07 / R2-12 / R2-13** Style read: Cashmere table geometry; Light Oak item choices (platform bed, paper lamp,
    a charcoal piece); Mediterranean cane (sofa, Sukhna chair) and limewash walls.
11. P2 polish: R2-16 … R2-24.

Expected result: R2-01…R2-06 alone should move every style to about 7.5 on both tiers. With R2-07…R2-15 and a
photographic backplate, 8+ is realistic.

## Screenshot index (`/tmp/rev2/render/`)

- **Dark Walnut**
  - Day: `dw-day-{eye,living,bed,dining,window,top}.png`
  - Sunset (baked): `dw-golden2-{eye,living,window,bed}.png`
  - Morning (baked): `dw-morning2-{eye,bed,living}.png`
  - Evening (baked): `dw-evening2-{eye,living,bed,dining,window,top}.png`
  - Taken *during* a bake with the stale AWB (evidence for R2-03): `dw-golden-*.png`, `dw-morning-*.png`,
    `dw-evening-*.png`
- **Light Oak** Day: `lo-day-{eye,living,bed,dining,window}.png`
- **Cashmere** Day: `gl-day-{eye,living,bed,dining,window}.png`
- **Mediterranean**: Day `med-day-{eye,living,bed,dining,window}.png`; Evening `med-evening-{eye,living}.png`
- **Evening, Cashmere / Light Oak**: `gl-evening-eye.png`, `lo-evening-eye.png`
- **Focus** (Mediterranean): `med-focus-{sofa,bed,coffee,kitchen}.png`
- **Product desktop** (`index.html?quality=high`): `p-day-eye.png`, `p-sunset-early.png` (12 s after the click,
  mid-bake), `p-sunset-eye.png`, `p-evening-eye.png`
- **Phone** (390×844 @2x, low tier): `ph-day-eye.png`, `ph-day-focus.png`, `ph-evening-eye.png`
- **GI bisect**: `bis-living-{a-base,b-noAO,c-constGI}.png`
- **Low-tier diagnostic** (desktop lab, `quality=low&force`): `low-day-eye.png`, `low-day-eye-constGI.png`
- **Crops**: `crops/` (window, walnut, wall seams, throw, kettle, Cashmere table, lamp wedge, floor lamp)
- **Logs**: `run*.log` (engine state per frame). Scripts: `scripts/lum.py`, `scripts/pct.py`, `scripts/mk.py`.
