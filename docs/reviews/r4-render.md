# Villar — review round 4: render & lighting (art direction)

Date: 2026-11-27 · Build: `5c4e5d8` (`/tmp/villar-rev`) · Reviewer: render / lighting art director
Previous round: `docs/reviews/r3-render.md` (7.0/10; phone 6.5). Screenshots: `/tmp/rev4/render/` (crops in `crops/`).

## Verdict

**Overall: 7.6 / 10** (round 3: 7.0). Desktop, high tier: **7.8**. Phone, low tier: **7.0** (round 3: 6.5).
Per style: **Dark Walnut 8.0 · Light Oak 7.5 · Cashmere 7.5 · Mediterranean 7.0.**

The photoscanned materials are the biggest single step in four rounds. Oak floor, walnut veneer, linen,
travertine, marble, leather, the olive and the cane chair now read as real objects. Sunset Living and the
olive close-up would pass as photographs at feed size. Evening is fixed: no lavender, a cosy amber, visible candle
flames.

It is not at 8.5 yet:
- The window still shows a massing-model city.
- Soft goods are too perfect.
- Sun patches clip flat.
- The budget slider makes the room's light drift by up to ~1 EV.
- The path-traced stills, the lever meant to carry the last step, do not yet match raster light.

**Round-3 findings: 6 Fixed · 5 Partly · 1 Not fixed** (R3-12 blotch). **New: P0 0 · P1 2 · P2 11.**
**PHOTOREAL.md blind test: not passed.** Mean realism 7.75 (target 8.5). 0 of 6 frames pass as photos at full size,
2 of 6 as thumbnails (details below).

### What clearly improved
- **Materials:** 21 CC0 photoscans, tinted to the catalogue. Walnut 59/51 Y′ with real figure; the oak floor has
  real plank variation; linen and travertine are convincing. Measured colours stay on the catalogue values.
- **Evening:** walls G-tint 1.00–1.02 (was 0.86–0.95). Lamp-lit wall R/B 1.24 (cream, not cool LED). Candle flames,
  translucent amber glass at night, and pendant shadows of eucalyptus on the table (`dw-evening-cu-dining.png`).
- **Focus:** 0.0 % clipped on the sofa, kitchen and bed (round 3: 12–19 %).
- **Dollhouse by day:** p50 179 (was 226), with a contact shadow under the model.
- **The olive:** scanned bark, translucent individual leaves. It is no longer the first CG tell.
- **Other fixes:** halos round the TV and mirror are gone by day; Light Oak bedding is fixed; the rattan dome is
  woven; the cane chair is real cane.
- **Phone:** portrait Entry shows the whole room; fabrics hold; DPR 1.5; no blotch.
- **City:** tinted glass facades, rooftop clutter, a correct Burj silhouette, real lit-window facades at night. It is
  better, but still not a photo (R4-02).

### Per style

| Style | r3 → r4 | Notes |
|---|---|---|
| Dark Walnut | 7.5 → **8.0** | Scanned walnut, travertine and marble carry it. Sunset Living is the best frame in the product. Held back by the city, bedding and flat sun patches. |
| Light Oak | 7.0 → **7.5** | Clean Japandi now (white bedding, slatted oak, paper column lamp). The coffee-table oak figure is a little large and orange at Sunset. Same city and bedding tells. |
| Cashmere | 7.0 → **7.5** | Tone-on-tone reads as intended. Bouclé shows. Dark blotch on the bed base (R4-09). In sun the bouclé armchair glows almost self-lit. |
| Mediterranean | 6.5 → **7.0** | Cane and rattan are now real. The new wall texture reads as stained concrete, not limewash (R4-06). The rattan dome is dark at night (R4-11). |

## Method

- Lab page `/lab/engine.html?clean&quality=high&force&adaptive=0`, 1440×900, software GL. Every frame was taken after
  `villar.debug.gi` reported `ok / baked / not baking`. Product page `index.html?quality=high` at 1440×900, and phone
  `index.html` at 390×844 @2x `--touch` (low tier).
- Budget slider: the lab applies the planner's ladder steps (`buildLadder` from `core/budget.js`, the same selections
  the slider uses) through `store.applyPlan(…, { reason: 'budget' })`. In the product I used keyboard Home /
  PageUp / End on `[role=slider]`, waiting ≥ 30 s per level.
- Path tracer: lab `&pt=force` at 640×400. Raster frame first, then the refined frame at 30 / 90 / 180 s
  (≈ 2.4 / 9 / 15.6 spp at 0.07 samples/s).
- Measurements as in rounds 2–3: sRGB luma `Y′`, `R/B` and `G-tint` = G ÷ ((R+B)/2) on fixed crops
  (`scripts/gt.py`, `scripts/pct.py`).
- Runs used: 8 of ~10. The lock queue held each run 15–60 min. Both chain scripts hit the 2-hour background limit;
  the path-trace run lost its last (300 s) frame, and the evening and phone runs were re-queued.

### Entry/Day against the engine's targets (Dark Walnut, `dw-day-eye.png`)

| Target | Round 3 | Round 4 | Verdict |
|---|---|---|---|
| Walnut 45–65 | TV 58.9 / nightstand 47.9 | TV **59.0** / nightstand **50.7**, scanned veneer with real figure | pass |
| Shaded white wall R/B ≈ 1.10 | 1.10 | **1.08–1.10**, G-tint 1.00 | pass |
| Near wall 165–185 | 173 | 173.5 (camera wall), 192 at the window | pass |
| Window centre 245–252 | sky p50 246 | sky p50 **236**, p90 240; glazing p98 245 | slightly low: the CC0 sky is a deeper blue (224,238,253) |
| Sunlit floor 235–245 | zone p90 230 | p90 232, p98 234; R clips at 253–254 | low edge; red clips (R4-04) |
| Corridor ≥ 60 / door ≥ 40 | 60 / 59 | corridor **60.1**, door **58.1**, warm grain | pass |
| Day dollhouse p50 170–190 | 226 | **179** | pass |

---

## Round-3 findings: verification

| R3 | Sev | Finding | Status | Evidence (round 4) |
|---|---|---|---|---|
| R3-01 | P1 | Evening walls lavender, lamps cool white | **Fixed** | No more lavender: Evening G-tint **1.00–1.02** on walls and ceiling (round 3: 0.86–0.95). WB gain `[0.76,1.02,1.51]` (was 1.79 blue). Lamp-lit wall in the Bedroom (238,217,191), R/B **1.24**: cream, just under the 1.30 target. Walnut 44.6 (target ≥ 45). The shaded walls run warm (R/B 1.76–2.07), which is known issue #6 and not re-reported. In the Living preset the lamp pools flattened again: far wall 66 vs next to the lamp 73 (−0.3 EV; round 3 −0.9 EV), R4-08. |
| R3-02 | P1 | Daytime city a grey clay model | **Partly** | Towers now read as tinted glass (Y′ 94–115, R/B 0.83–0.86, the CC0 facades are visible in close-ups); roofs have clutter and are darker (170–175, was 198); the Burj silhouette is right (`dw-day-bed.png`). Still extruded prisms on a flat beige plain with no roads, greenery, water or atmospheric depth variation. Rooftops form a regular grid. From the Entry view it reads as a massing model (`crops/dw-day-eye-window.png`). |
| R3-03 | P1 | Day dollhouse overexposed | **Fixed** | Frame p50 **179** (round 3: 226), oak floor (210,168,118) with no clip, rug 190, sofa 163 (`dw-day-top.png`). There is a soft contact shadow under the model. |
| R3-04 | P1 | Focus blows out sunlit backgrounds | **Fixed** | Pixels with a channel ≥ 252: sofa **0.0 %** (round 3: 11.8–19 %), kitchen 0.0 %, bed 0.0 % (`dw-focus-sofa.png`). Sofa seat top 156 vs catalogue 197 (−21 %); back cushions −15 %. The roll-off flattens the sunlit armchair in the background to a pastel (p50 175, little shading), which is acceptable. |
| R3-05 | P2 | Light halos round wall-mounted TV and mirror | **Fixed** (by day) | Dining preset, DW Day: the wall next to the TV ramps *down* toward it (100 → 84 over 10 px), and the same next to the mirror (93 → 60). That is contact occlusion, with no light band (round 3: a +3…+6 Y′ hump) (`crops/dw-day-dining-halo.png`). At Evening a faint light rim remains about 25 px above the TV (+5 Y′, ~8 px wide; `crops/dw-evening-dining-tvhalo.png`), which is minor. |
| R3-06 | P2 | Olive trunk white | **Fixed** | Scanned bark; in shade the trunk is dark grey-brown (`dw-focus-plant.png`). In direct sun it reads light grey (Y′ 203 at the pot's level, pot 195). That is physically right for olive bark at this exposure. The leaves are translucent and individually shaped. |
| R3-07 | P2 | Bedding satin plastic; jagged turn-down; dent | **Partly** | The satin sheen is gone (matte), and I saw no dent. The duvet and pillows still have **no visible weave at 1–2 m** and read as smooth shells. The turn-down hem is still a hairline stitch running across the duvet (`dw-day-cu-bed.png`, `dw-day-bed.png`). |
| R3-08 | P2 | Limewash invisible; rattan dome plain; wire spikes | **Partly**: the dome is fixed, the walls overshoot | The rattan dome has a real weave and no spikes (`med-day-living.png`). The walls now carry a strong photoscanned plaster with dark stains and cracks. It reads as **raw grey concrete**, not limewash white, especially in shade and at Sunset (`crops/med-golden-limewash.png`). See R4-06. |
| R3-09 | P2 | Light Oak sage bedding | **Fixed** | Light Oak bedding is now white with a stone throw (`lo-day-eye.png`). |
| R3-10 | P2 | Small tells (candles, amber glass, travertine, bouclé, leather, nightstand gap) | **Partly** | Travertine is now a real photoscan on the coffee table and worktop. The leather armchair has grain and sheen (`dw-focus-plant.png`). Bouclé is finer. Candles now have visible flames (`med-evening-living.png`). Amber tumblers read translucent at night (`dw-evening-cu-dining.png`) but still opaque by day (R4-13). **Nightstand L still butts the TV console** (`dw-day-cu-tvunit.png`). |
| R3-11 | P2 | Sunset shade magenta | **Partly**: the tint is fixed; warm/cool separation is lost | Shade walls G-tint **0.99–1.00** (round 3: 0.94). But the shade is now *warmer* than the sun: shade R/B 1.35–1.58 vs sun patch 1.32–1.33. The sun patch on the wall is clipped flat: p50 = p98 = 223 (252,218,191), so there is no plaster detail inside it (R4-04). |
| R3-12 | P2 | Dark blotch on the bed base | **Not fixed**, and also on desktop | Desktop high, Cashmere Sunset: a soft dark disc on the bed base side, Y′ 58 → **26** (`crops/gl-golden-bedbase.png`). A milder dip in DW Day (62 → 50). On the phone it is not visible this round: the bed base ramps smoothly 108 → 82 (`ph-day-eye.png`). |

---

## PHOTOREAL.md acceptance test (as far as possible here)

**Limits.** The sandbox cannot load real photographs into my view, so I could not put six real photos into the
mix. An image search for furnished Dubai studio listings returned only titles (no pixels for me to judge). So I did
the test one-sided: each Villar frame is scored "photo or render" and realism 1–10 at full size (1440×900) and as a
400 px thumbnail (how it appears in a feed). The reference is the look of real Dubai listing and interior-magazine
photography: wide-angle, a blown or HDR window, slightly crooked props, wrinkled textiles, and a dense, messy city.

| # | Frame | Full size: photo or render · realism | 400 px thumbnail | What gives it away |
|---|---|---|---|---|
| 1 | DW · Day · Entry (`dw-day-eye.png`) | render · **7.5** | render | City prisms; smooth duvet; perfectly square cushions |
| 2 | DW · Sunset · Living (`dw-golden-living.png`) | render · **8.5** | **photo** | Sun patch clipped flat; sofa cushions too regular |
| 3 | Light Oak · Day · Entry (`lo-day-eye.png`) | render · **7.5** | render | City; duvet; coffee-table oak grain a little large |
| 4 | Cashmere · Sunset · Entry (`gl-golden-eye.png`) | render · **8.0** | **photo** (borderline) | Dark blotch on the bed base; city |
| 5 | Cashmere · Day · Living (`gl-day-living.png`) | render · **7.5** | render | Armchair glows as if self-lit in sun; bouclé reads as felt in shade |
| 6 | Mediterranean · Sunset · Living (`med-golden-living.png`) | render · **7.5** | render | "Concrete" wall; flat sun patch |
| — | Path-traced still, DW Entry, 15.6 spp (`pt-living-180s.png`) | render · **8.0** at 640 px | **photo** | Denoiser smear on the olive, sheers and ceiling at this sample count |

**Result:** mean realism **7.75** (target ≥ 8.5). Mistaken for photos: **0 of 6 at full size**, 2 of 6 as thumbnails
(target 2 of 6 at full size). Not passed, but the gap is now specific and countable.

**The top 5 tells that remain** (in order of how quickly they give the frame away):
1. **The city** (R4-02): extruded prisms on a flat plain. It is in every daytime frame, behind the brightest pixels.
2. **Soft goods too perfect** (R4-05, R4-13): duvet and pillows without wrinkles or weave; seat and back cushions
   are perfect rectangles with no compression or crown; throws are thin sheets.
3. **Highlights clip flat** (R4-04): sun patches on walls and floor become uniform peach blocks with no texture or
   soft edge. Real photos keep the plaster grain and a wide penumbra in the patch.
4. **Contact and occlusion under furniture** (from the path-tracer A/B): under beds, sofas and in corners the raster
   is 1–1.2 EV brighter than the traced frame. Things sit on the floor without the dark crease a camera sees.
5. **No colour bleeding**: by day the raster keeps only 30 % of the bounce colour (`GI_CHROMA.day 0.3`). The traced
   frame shows walls next to the oak floor at R/B 1.16–1.29, while the raster's are 1.10. Real rooms with oak floors
   and sun have that warm bounce on walls and ceiling.

What already reads as photographic: the photoscanned oak floor, walnut veneer, linen, travertine and leather. Also
the olive (`dw-focus-plant.png` is the most convincing frame in the set), the cane chair, the shadow-lining lamps,
and the light falloff into the corridor.

---

## Path-traced still (`?pt=force`, 640×400, DW Entry, Day)

The frames are `pt-living-raster.png` (the held raster) and `pt-living-{30,90,180}s.png`, at 2.4, 9 and 15.6 spp.
At 0.07 samples/s on software GL the first image counted as visible arrived after 62 s; on a GPU the budget is
1.5 s, so speed is not judged here.
- **Light and exposure: does it match raster? Not yet.** Same crops, raster → traced (15.6 spp):

  | Region | Raster | Traced | Difference |
  |---|---|---|---|
  | Lit wall (right) | 172 (179,171,162) | 207 (221,204,190) | **+0.6 EV** |
  | Wall at the window (left) | 156 | 182 | +0.5 EV |
  | Ceiling | 161 | 166 | ≈ 0 |
  | Sun patch on the floor | 171 | 218 | +0.75 EV |
  | Bed base / room corner floor | 63 / 66 | 42 / 46 | **−1.1 to −1.2 EV** |
  | Sky in the window | 236 | 240 | ≈ 0 |

  The window and ceiling match (`PHOTO_EXPOSURE 1.25` works there). The interior does not: the traced frame has
  far more contrast, with lit surfaces +0.5–0.75 EV and contact zones −1.1 EV. When the still fades in over 450 ms,
  a user will see the room "develop" (brighten and darken in different places), which PHOTOREAL.md forbids ("no
  exposure jump on blend").
- **Colour.** The traced walls are warm from the oak floor's bounce (R/B 1.16–1.29, G-tint 0.99). The raster walls
  are 1.08–1.10, because day GI keeps only 30 % of the bounce colour. One of the two must move. Physically the traced
  frame is right; art-directionally the raster's neutral is what rounds 2–3 asked for. My recommendation: day
  `GI_CHROMA` 0.3 → 0.5, plus a slight path-tracer white-balance pull, so both land on wall R/B ≈ 1.15.
- **Soft shadows and GI: correct and clearly better.**
  - The olive and mullion shadows have contact-hardening penumbrae.
  - There is a warm sun-bounce glow on the ceiling and wall next to the window patch.
  - The bed, sofa and TV unit sit on the floor with real contact darkening.
  - The sheer curtains glow when backlit.
  - This is the "photo" look the raster is missing (tells 3–5 above).
- **Artefacts at this sample count:**
  - The denoiser smears fine detail (olive leaves, sheer folds, ceramics on the coffee table).
  - It leaves low-frequency blotches on the ceiling and the large white wall (dark patches at 30 s, still faintly
    at 180 s).
  - No fireflies, NaNs or black frames: the round-1 robustness issues are gone.
  - On a GPU at 48–384 spp this will clean up. The calibration issue above will not.
- **Observation for engine/tech:** in this run `villar.setView('living', { instant: true })` issued while the refine
  was running did not change the camera. The raster and all traced frames stayed on Entry. Please check that
  `setView` cancels a running refine and moves the camera (I could not re-run to confirm).
- **Fix (engine):**
  1. Calibrate on this exact frame: take the traced/raster ratio on the walls (+0.6 EV) and the contact zones
     (−1.1 EV).
  2. Raise raster contact occlusion: GTAO `blendIntensity` and radius under furniture, or a baked AO term per
     furniture footprint.
  3. Lower the probe GI `GAIN` slightly while matching the bounce colour (as above).
  4. Fade the traced still in over ≥ 900 ms with a luminance-matched crossfade.
  5. Target: ≤ 0.25 EV difference on the 6 crops above.

---

## Budget slider: the intermediate rooms

DW, Day. I checked Minimum (7,852 AED, 6 items; 24 empty slots), Essentials (13,330, step 3), Comfortable (16,354,
step 8) and the return to the designer room (36,243, step 32), each from 4 presets. In the product I also checked
Minimum, Essentials and No compromises via the keyboard.
- **No floating or intersecting items, no orphan decor.**
  - Every intermediate room is complete and grounded: bed, mattress and bedding; sofa; TV unit; sheers.
  - Nightstands, coffee table and the small square walnut dining table with its chairs arrive at Essentials.
  - Blackout panels, lamps and the rug arrive at Comfortable.
  - Lamps never appear without nightstands, and there is no tableware without the table. Chairs tuck under the
    table (`slider-ess-dining.png`).
- **Shadows are present** for every added item (sun, lamp linings, contact). Removed items leave no shadow
  ghosts: after a settle the sun shadow map and the GI both update.
- **Light changes: yes, and wrong (R4-01).** The indirect light brightens by up to ≈ +1 EV between Minimum and
  Comfortable on the same wall, and the designer room keeps the brighter light after a round trip. That is the main
  render defect of the slider.
- Blackout panels at Comfortable narrow the sun wedge on the living wall. That is correct and a nice cue.
- Minimum room in the Entry view: the cheapest bouclé sofa reads as smooth grey from 4 m (its bouclé texture shows
  only in the Living close-up). Expected at that distance, not a finding.

---

## New findings (most severe first)

### R4-01 [P1] Budget slider: indirect light drifts up as items are added, and does not return to the load state
- Owner: engine (`probes.js` local re-bake / `index.js` `runLocal`, settled-only local GI)
- Repro: lab `?quality=high&tod=day`, DW, ready. Apply ladder steps through `store.applyPlan` with the same
  selections the slider uses: Minimum (step 0) → Essentials (3) → Comfortable (8) → back to the designer room (32).
  Wait for `gi: ok/baked` after each step. Compare the same presets.
- Expected: same light for the same room; adding furniture changes the indirect light by a few percent at most, and
  slightly *down* (more occluders, darker fabrics). The designer room looks the same before and after a slider trip.
- Actual (sRGB Y′ on identical crops):
  - **Living preset, sofa wall:** Minimum 101 → Essentials 122 → Comfortable 137. That is ≈ **+1.0 EV** linear
    across three settles. The designer room at load is 107.
  - **Entry preset**, wall / ceiling / shaded floor:

    | State | Wall | Ceiling | Shaded floor |
    |---|---|---|---|
    | Minimum | 158 | 176 | 80 |
    | Comfortable | 186 | 205 | 114 |
    | Designer, at load | 174 | 184 | 96 |
    | Designer, back after the trip | 186 | 205 | 114 |

  - The restored designer room is therefore +0.2 EV (walls) and **+0.55 EV** (shaded floor) brighter than at load:
    it kept Comfortable's light.
  - The sofa in the Minimum room renders 74 on the same spot where it renders 115 at Comfortable.
  - To a user dragging the slider, the room's light visibly "breathes", brightening with every settle, even though
    the walls did not change.
- Evidence: `slider-{min,ess,comf}-{eye,living}.png`, `slider-back-eye.png` vs `dw-day-eye.png`, `r5.log`.
- Likely cause: each settled local bake starts from the current SH, which already contains the luminance tail and
  previous bounces, and adds another bounce on top, so energy accumulates. The (style, time) cache then stores the
  drifted result, and the designer room re-uses it on return (`back` settled in 5 s with `ok/baked`).
- Fix:
  1. Local bakes must recompute the changed probes from the *direct* and first-bounce terms, with the same bounce
     count and TAIL as a fresh bake. Never add a bounce on top of the stored, tail-extrapolated SH.
  2. Key the GI cache by selection signature, not only (style, time).
  3. After the slider has rested ≥ 2 s, run one fresh 2-bounce bake.
  4. Targets: the same selection within ±0.1 EV on any revisit; wall Y′ non-increasing (±0.1 EV) as tiers are added.

### R4-02 [P1] The view outside still reads as a massing model (R3-02, carried over)
- Owner: engine (`sky.js`) or coordinator (a licensed photographic plate)
- Repro: any style, Day/Morning/Sunset, Entry, Bedroom or Window close-up.
- Expected: Dubai from a high floor, with tinted glass towers of different shapes, roads, palms and water, and haze
  that grows with distance.
- Actual:
  - Better than round 3: glass facades with tint (Y′ 94–115, R/B 0.85), rooftop clutter, a correct Burj silhouette,
    and warm-lit faces at Sunset.
  - Still: every tower is a straight prism with a flat top. The low-rise is a regular grid of identical blocks on a
    flat beige plain, with no roads, greenery or water. Haze is uniform.
  - It is the single strongest "render" tell in every daytime frame, and the window is where the eye goes first.
- Evidence: `crops/dw-day-eye-window.png`, `dw-day-cu-window-plant.png`, `med-focus-armchair.png`,
  `dw-day-bed.png`.
- Fix: a photographic backplate per time of day (PHOTOREAL.md lever 4, "real equirectangular HDR + skyline"). If it
  stays procedural:
  1. Vary the silhouettes: setbacks, crowns, 15 % twisted or tapered towers.
  2. A road grid (asphalt `#57534c`, 12–20 m wide) with sparse palms.
  3. Distance-graded haze (+40 % at 3 km).
  4. Break the low-rise grid with ±30 % size jitter and random rotation.
  5. Target: no two adjacent towers with the same footprint and height ± 10 %.

### R4-03 [P2] Path-traced stills do not match raster yet (blocking `?pt=on` by default)
- Owner: engine (`photo.js` refine, `PHOTO_EXPOSURE`, probe `GAIN`/`GI_CHROMA`, GTAO)
- Repro: lab `&pt=force`, 640×400, DW, Day, Entry; compare the held raster with the 15.6 spp refine.
- Actual: lit walls +0.5–0.6 EV, the floor sun patch +0.75 EV, and contact zones (bed base, corners) −1.1 to −1.2 EV
  in the traced frame. Walls are warmer (R/B 1.16–1.29 vs 1.08–1.10). Window and ceiling match. Details in the
  path-tracer section.
- Fix: see the path-tracer section. Target: ≤ 0.25 EV on the six crops before enabling idle refine for users.

### R4-04 [P2] Sun patches clip to a flat peach; at Sunset the shade is warmer than the sun
- Owner: engine (`lighting.js` golden sun / exposure, tone-mapping shoulder)
- Repro: DW (or any style), Sunset, Living or Entry; also Day, Entry (floor patch).
- Actual:
  - The Sunset sun patch on the wall is a uniform block: p50 = p98 = 223 (252,218,191). R is clipped, so the plaster
    texture and the soft sun edge vanish inside it (`crops/dw-golden-sunpatch.png`).
  - Shade walls are R/B 1.35–1.58 while the sun patch is R/B 1.32. The golden-hour warm/cool separation has
    inverted again (round 3: shade 1.10–1.25). The tint is fixed (G-tint 0.99–1.00), but the light reads "uniformly
    amber" rather than "low sun in a cool room".
  - Day floor sun patch: R clips at 253–254.
- Fix:
  1. Golden: sun `I 7.0 → 5.8` (or exposure −0.25 EV for golden), and raise the sky/zenith share of the window fill
     so the shade cools.
  2. A hue-preserving shoulder: compress luminance, not per channel, above 0.8.
  3. Targets: sun patch R ≤ 245 with p98 − p50 ≥ 8 (texture survives); Sunset shade R/B 1.10–1.30, sun ≥ 1.45.

### R4-05 [P2] Bedding still reads as smooth shells (R3-07, carried over)
- Owner: modeler (`beds.js`, percale material)
- Repro: any style, Bedroom preset or bed close-up, Day.
- Actual:
  - The duvet and pillows are matte now, but no weave or wrinkle detail is visible at 1–2 m; they read as
    upholstered foam.
  - A hairline "stitch" runs across the duvet along the turn-down (`dw-day-cu-bed.png`, `dw-day-bed.png`).
  - Next to the photoscanned linen headboard and cushions, the bedding is now the most obviously CG soft good in
    the room.
- Fix:
  1. Percale normal at 0.6 mm pitch with `normalScale ≥ 0.6`.
  2. Low-frequency wrinkle normal (5–15 cm) over the duvet top.
  3. Pillow creases at the corners.
  4. Delete the hem line.
  5. Target: at the bed close-up, high-pass std on the duvet top ≥ 3 Y′ (now ≈ 1).

### R4-06 [P2] Mediterranean "limewash" reads as stained grey concrete
- Owner: modeler (`limewash` material set) / engine (wall finish)
- Repro: Mediterranean, Day Living or Sunset Living/Entry.
- Expected (`palette-mediterranean.json`): walls and ceiling as one coat of limewash `#F3EFE6`, a soft cloudy,
  brushed variation in the same colour.
- Actual:
  - The photoscanned "Painted Plaster Wall" carries dark stains, pits and cracks. High-pass deviations reach
    **−20 Y′** (DW paint: −15 at most), and the dark specks form blotches.
  - In shade and at Sunset it reads as polished raw concrete or a loft wall (`crops/med-golden-limewash.png`,
    `med-day-living.png`, `med-focus-armchair.png`). That pulls the style toward industrial and away from Mallorca.
- Fix:
  1. Remap the scan's albedo to ±5 % around the paint colour and drop the dark-speck band (clamp below −6 %).
  2. Keep the normal map at `normalScale 0.15–0.2` for the brushed relief; add a faint warm-white cloud.
  3. Target: high-pass min deviation ≥ −8 Y′ on the Living wall crop, mean within ΔE 3 of `#F3EFE6` in
     neutral light.

### R4-07 [P2] Focus highlight roll-off turns sunlit warm materials salmon-pink
- Owner: engine (focus roll-off in `index.js` / post)
- Repro: product 1440, DW, Day, `focus('sofa')`.
- Actual:
  - Clipping is fixed (0.6 % of the stage).
  - But the sunlit walnut side-table base renders **(225,170,137)**, G-tint 0.94, R/B 1.64. In the room view walnut
    reads (83,55,30), R/B 2.8.
  - The terracotta throw in sun goes peach (248,194,170).
  - The roll-off desaturates the hot channel first, so browns become pink.
- Evidence: `p-day-focus-sofa.png`.
- Fix: apply the roll-off to luminance and keep chroma ratios, or do it in AgX/OKLab space. Target: walnut in sun
  keeps R/B ≥ 2.2 and G-tint ≥ 0.96 in focus.

### R4-08 [P2] Evening: lamp pools in the Living view flattened again
- Owner: engine (evening GI gain / probe chroma)
- Repro: DW, Evening, Living preset.
- Actual: far end of the sofa wall 66, middle 66, next to the floor lamp 73 Y′. That is ≈ −0.3 EV (round 3: 48 vs 66,
  −0.9 EV). The Entry view still shows good scallops and pools (`dw-evening-eye.png`, the best evening frame so far),
  but the sofa wall reads evenly lit.
- Evidence: `dw-evening-living.png` vs `/tmp/rev3/render/dw-evening-living.png`.
- Fix: evening probe `GAIN` −20 %, or bake lamp indirect at 1 bounce without the luminance tail. Target: far wall /
  next-to-lamp ≤ 0.6 (linear) in the Living preset.

### R4-09 [P2] Dark blotch on the bed base, now on desktop too (R3-12, carried over)
- Owner: engine (probe lookup inside the bed volume)
- Repro: Cashmere, Sunset, Entry (strong); DW, Day, Entry (mild).
- Actual: a soft dark disc on the upholstered bed-base side. Cashmere Sunset: 58 → **26** Y′; DW Day: 62 → 50.
  On the phone it is not visible this round: the bed base ramps smoothly 108 → 82 (`ph-day-eye.png`).
- Evidence: `crops/gl-golden-bedbase.png`.
- Fix: as in round 3. Weight floor for invalid probes `mix(0.25,1,valid)` → `mix(0.6,1,valid)` on surfaces inside
  furniture footprints, or push the lookup point 0.5 × spacing along the normal. Target: no local dip > 8 Y′ on a
  flat upholstered face.

### R4-10 [P2] Alpha cane and wicker cast no shadow
- Owner: engine (shadow depth material for alpha-tested meshes) / modeler
- Repro: Mediterranean, Day, focus the armchair (or any cane/rattan item in sun).
- Actual: the chair frame and legs cast crisp sun shadows, but the cane seat and back cast none. The floor under the
  seat is lit as if open (`crops/med-cane-noshadow.png`, `med-focus-armchair.png`). In a sunlit frame this is an
  immediate CG tell.
- Fix: give the cane/wicker meshes a `customDepthMaterial` with the same `alphaMap` and `alphaTest`, so the shadow
  map sees the weave. Or at least a 50 % opacity proxy caster. Target: a dappled seat shadow in sun.

### R4-11 [P2] The rattan dome stays dark at night; its weave casts no dappled light
- Owner: modeler / engine (lamp light descriptors)
- Repro: Mediterranean, Evening, Living.
- Actual: the woven dome is a dark brown shell with a bright down-cone below it. Real rattan pendant and floor-dome
  lamps glow through the weave and throw a dappled pattern on the wall and ceiling, which is their whole appeal
  (`med-evening-living.png`).
- Fix: emissive inner face at about 30 % through the weave alpha, plus a weak up/side point light. For the pattern,
  a light cookie (projected weave alpha) on the up spot. Target: dome mean Y′ ≥ 90 at night with visible weave.

### R4-12 [P2] Phone: a bright 1–2 px rim stays on the focused object's silhouette
- Owner: engine (focus outline fade on the `low` tier)
- Repro: phone 390×844 @2x, DW, Day, `focus('bed')`; screenshot 7 s after the flight.
- Actual: a cream 1–2 px line traces the bed base's silhouette against the floor, about +40 Y′ over the floor
  (`crops/ph-focus-bed-rim.png`). On desktop the halo fades out as designed; on the phone it seems to stay.
- Fix: run the same 1.2 s fade-out on the low tier (or skip the outline pass there). Target: no edge pixel
  > +10 Y′ over its neighbours 2 s after landing.

### R4-13 [P2] Small material and layout tells
- Owner: modeler (glass, sink, throw), engine (layout)
- **Amber tumblers** are opaque amber ceramic, with no transmission or refraction (`dw-day-cu-dining.png`). Use
  `transmission 0.9`, `thickness 0.004`, `attenuationColor #c58a3e`, roughness 0.05.
- **Kitchen sink** is a flat black rectangle with no depth or rim. It reads as a hole (`dw-day-cu-kitchen.png`). Model
  a 15–18 cm basin with a brushed steel or composite rim and a drain.
- **Throws** are still thin sheets on the arm with a short fringe strip (`dw-day-cu-sofa.png`). Use 8–12 mm thickness
  and a soft fold at the arm edge.
- **Nightstand L still butts the TV console** in DW, and in the Essentials room (`dw-day-cu-tvunit.png`,
  `slider-ess-eye.png`). Leave ≥ 12 cm.

---

## Gap to 8.5: what to do, in order of score impact

1. **The window (R4-02): +0.4.** A photographic backplate per time of day, or the procedural values in R4-02. This
   is in every daytime frame and is the first tell.
2. **Path-traced stills calibrated, then on by default on capable GPUs (R4-03): +0.4.**
   - Match raster within 0.25 EV on the six crops.
   - Raise raster contact occlusion under furniture (now ~1.1 EV too bright).
   - Day `GI_CHROMA` 0.3 → 0.5, so walls pick up the oak bounce.
   - The traced frame already shows the contact darkening, bounce colour and soft penumbrae that make a render
     read as a photo. It is the lever that passes the blind test.
3. **Soft goods (R4-05, R4-13): +0.3.**
   - Duvet and pillow weave plus wrinkle normal; no hem line.
   - Seat cushions with crown and compression, back cushions with sag.
   - Throws 8–12 mm thick.
   - Target: duvet-top high-pass std ≥ 3 Y′.
4. **Highlights (R4-04, R4-07): +0.2.**
   - Hue-preserving shoulder, so a sun patch keeps texture (R ≤ 245, p98 − p50 ≥ 8).
   - Sunset shade cooler than the sun.
   - The focus roll-off keeps walnut brown.
5. **Slider light (R4-01): +0.1 on the score, but a correctness bug the founder will see while dragging.** The same
   selection within ±0.1 EV on every visit.
6. **Mediterranean parity (R4-06, R4-11): +0.1 overall (+0.5 on that style).** A limewash remap to ±5 % around
   `#F3EFE6`; the rattan dome glowing through its weave at night.
7. **The rest (R4-08 … R4-13): +0.1.** Evening pools in Living, the bed blotch, cane shadows, phone rim, the sink,
   tumblers by day, and the nightstand gap.

Items 1–4 take the product to about 8.5 on desktop.

## Screenshot index (`/tmp/rev4/render/`)
- **Dark Walnut**
  - Day: `dw-day-{eye,living,bed,dining,window,top}.png`; close-ups `dw-day-cu-{sofa,tvunit,bed,kitchen,dining,window-plant,coffee-rug}.png`
  - Sunset: `dw-golden-{eye,living,window}.png`
  - Evening: `dw-evening-{eye,living,bed,dining,window,top}.png`, `dw-evening-cu-{bed,dining}.png`
  - Focus: `dw-focus-{sofa,kitchen,bed,plant}.png`
- **Light Oak**: `lo-day-{eye,living,bed}.png`, `lo-golden-{eye,living}.png`
- **Cashmere**: `gl-day-{eye,living,bed,dining}.png`, `gl-golden-{eye,living}.png`
- **Mediterranean**: `med-day-{eye,living,bed}.png`, `med-golden-{eye,living}.png`, `med-evening-{eye,living}.png`,
  `med-focus-{armchair,floorlamp}.png`
- **Slider (lab)**: `slider-{min,ess,comf}-{eye,living,bed,dining}.png`, `slider-back-eye.png`
- **Product (1440)**: `p-day-eye.png`, `p-day-focus-sofa.png`, `p-day-click-bed.png`, `p-slider-{min,ess,max}.png`
- **Phone**: `ph-day-eye.png`, `ph-day-focus-{sofa,bed}.png`, `ph-evening-eye.png`
- **Path tracer**: `pt-living-raster.png`, `pt-living-{30,90,180}s.png` (Entry view; see the observation in that
  section)
- **Crops** in `crops/`. Logs in `r*.log`. Scripts in `scripts/` (`gt.py` adds G-tint).
