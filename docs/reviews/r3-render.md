# Villar — review round 3: render & lighting (art direction)

Date: 2026-11-26 · Build: `931e361` (`/tmp/villar-rev`) · Reviewer: render / lighting art director
Previous round: `docs/reviews/r2-render.md` (6.0/10; phone 4). Screenshots: `/tmp/rev3/render/` (crops in `crops/`).

## Verdict

**Overall: 7.0 / 10** (round 2: 6.0). Desktop, high tier: **7.2**. Phone, low tier: **6.5** (round 2: 4).
Per style: **Dark Walnut 7.5 · Light Oak 7.0 · Cashmere 7.0 · Mediterranean 6.5.**

Day, Sunset and Morning are now physically right. White walls are neutral, walnut is walnut, the corridor falls
off, sun patches and shade-lining shadows are crisp, and the golden-hour Living frame (`dw-golden-living.png`)
would pass for a photograph. What still reads as a game is concentrated in four places:
- **Evening:** the white balance over-corrects, so walls go lavender and the 2700 K lamps look like cool LEDs.
- **City:** the view outside is still grey clay.
- **Focus:** spot-metering on an item blows out its sunlit surroundings.
- **Assets:** a few tells remain (white olive trunk, satin bedding, invisible limewash).

Fixing the first three gets to 8.

**Round-2 findings: 16 Fixed, 7 Partly, 0 Not fixed, 1 not verifiable here** (R2-11, prewarm needs a GPU). The phone P0 is fixed.
**New findings: P0 0 · P1 4 · P2 8.**

### What clearly improved
- **Light and colour by day** (R2-02/03): shaded walls R/B 1.10, identical WB/EV in all presets, no blue stand-in
  frames. Known issue #1 is resolved.
- **Walnut** 59/48 at Entry/Day, with grain and fluting visible. The corridor and door now read.
- **No more GI seams**; **evening pools** at about −1 EV between lamps; the pendant pools on the table; shade
  linings cast solid sun shadows.
- **Phone:** fabrics are within −3 % of desktop, rendered at DPR 1.5.
- **Style reads:**
  - Light Oak is now Japandi: platform bed, slatted oak, paper column lamp.
  - Cashmere has its tulip table and visible bouclé.
  - Mediterranean has a real cane chair and visible cane on the sofa in focus.
- **Window glows** (p50 246), **lens** is 74° on the wide stage, the **night dollhouse** is warm grey, the **focus halo**
  fades out, and art looks like designer prints.

### Per style

| Style | Score (r2 → r3) | Reads as its style? What holds it back |
|---|---|---|
| Dark Walnut | 6.5 → **7.5** | Yes. Warm walnut with grain, oat linen, travertine, brass, olive and terracotta. The golden-hour frames are the best in the product. Held back by evening lavender walls and walnut that drops to 32 at night (R3-01). |
| Light Oak | 5.5 → **7.0** | Yes, now Japandi: low platform bed, slatted oak, paper column lamp, black planter, low oak table. Held back by sage bedding dominating the bedroom (R3-09), the same sofa archetype as DW, and the evening cast. |
| Cashmere | 6 → **7.0** | Yes, tone-on-tone ivory, bouclé, tulip table, champagne trim, no dark masses. By day the near-neutral catalogue colours read slightly cool-grey. Bouclé cells on the chairs are too large; evening is mauve (R3-01). |
| Mediterranean | 6 → **6.5** | Partly. The cane chair, cane TV unit, rattan dome, dhurrie, Aegean blue and terracotta carry it. Limewash is invisible, the dome is smooth plastic with wire spikes (R3-08), and the sofa cane is not visible from the Living preset. Evening was not captured: the switch lost the WebGL context in this harness. |

## Method

- Lab page `/lab/engine.html?clean&quality=high&force&adaptive=0`, 1440×900, software GL. Every frame below was
  taken after `villar.debug.gi` reported `ok / baked / not baking`, unless it is marked as a stand-in frame.
  Product page `index.html?quality=high` (desktop) and `index.html` at 390×844 @2x `--touch` (phone, low tier).
- Same measuring method as round 2: sRGB luma `Y′ = 0.2126R + 0.7152G + 0.0722B` on the PNGs
  (`scripts/lum.py`, `scripts/pct.py`); "R/B" = mean R ÷ mean B of the patch. New this round: "G-tint" =
  G ÷ ((R+B)/2). The wall paint `#ECE7DE` is 1.01; below about 0.97 a white wall reads mauve or pink.
- The lock queue was very long this round (about 15 waiting runs from other reviewers), so I merged runs. Runs used: 7 of the ~12 budget: day, sunset+morning, evening+style switches, Cashmere/Mediterranean day+focus, product desktop, phone; two of them ran out of time at the end (`r3.log`, `r5.log`).

### Entry/Day against the engine's own targets (Dark Walnut, `dw-day-eye.png`)

| Target | Engine says | I measure | Verdict |
|---|---|---|---|
| Walnut 45–65 | TV 60, nightstand 48 | TV **58.9** (82,55,29), nightstand **47.9** (75,43,17); Window view TV 49.6 | **pass** (round 2: 29 / 22) |
| Shaded white wall R/B ≈ 1.10–1.12 | 1.10–1.12 | camera wall **1.10**, far wall 1.10, ceiling 1.11 | **pass** (round 2: 1.31) |
| Near wall 165–185 | — | 173 (camera wall), 189 (wall at the window) | pass |
| Window centre 245–252 | p50 245 | sky between towers p50 **246** / p98 250 | **pass** (round 2: 227) |
| Sunlit floor 235–245 | — | patch core 224 (247,220,196), zone p90 230 | slightly low; R clips at 253 |
| Corridor walls ≥ 60, door ≥ 40 (R2-20) | — | corridor 60.1, door 58.9 with visible grain | **pass** (round 2: 42 / 30) |
| WB/EV identical across presets | fixed per TOD | Day: gain `[0.963,1.004,1.072]`, EV 0 in all 6 presets | **pass** |

Other times of day (DW, Entry unless noted):

| | Measured | Target / comment |
|---|---|---|
| Sunset shade walls | R/B 1.10–1.25; G-tint 0.94 | R/B ok (1.1–1.3); slightly magenta (R3-11) |
| Sunset sun patch on wall | (253,218,194) R/B 1.30 | R clips; target ≥ 1.5 with R ≤ 245 |
| Morning shade walls | R/B 1.01–1.04 | cool neutral, correct |
| Morning stand-in (2.5 s after switch, baking) | walls R/B 1.15; mean Y′ diff vs baked **0.15** | no blue cast (known issue #1 resolved) |
| Evening lamp-lit wall (Bedroom) | (235,219,210) R/B **1.12** | target 1.30–1.45: lamps read cool white (R3-01) |
| Evening shade walls | (61,45,43) … (104,89,83), G-tint 0.86–0.95 | lavender (R3-01) |
| Evening pools (Living) | far wall 48 vs next to lamp 66 Y′ | ≈ −0.9 EV linear (ratio ≈ 0.50; engine says 0.31 on its own patches): good |
| Evening walnut | TV 31.7 | target 45–60 |
| Window night city | p98 85 | ≤ 150: ok |

---

## Round-2 findings: verification

| R2 | Sev | Finding | Status | Evidence (round 3) |
|---|---|---|---|---|
| R2-01 | P0 | Phone (low tier): fabrics near-black by day | **Fixed** | Phone, Day, Entry (`ph-day-eye.png`): rug Y′ **123.5** (round 2: 4), sofa seat **77** (round 2: 8; desktop 79.4, −3 %), duvet 120–138 with no slate cast. Phone Evening is also correct (`ph-evening-eye.png`). One low-tier blotch remains (R3-12). |
| R2-02 | P1 | Baked GI far too warm | **Fixed** (day, sunset, morning); evening overshoots the other way (see R3-01) | Day shaded walls R/B **1.10**, ceiling 1.11 (round 2: 1.31). Sunset shade 1.10–1.25 (round 2: 1.8–2.1). Morning shade 1.01–1.04. The indirect tail is now luminance-only (`probes.js:428`, `TAIL 0.35`) with a chroma limit. |
| R2-03 | P1 | AWB/AE per view, aspect-dependent, frozen during bakes | **Fixed** | Gain and EV are identical in all 6 presets per time of day (Day `[0.963,1.004,1.072]`, EV 0; Sunset `[0.843,1.011,1.355]`). A Morning stand-in 2.5 s after the switch, while still baking, has **no blue cast**: walls R/B 1.15, mean Y′ difference from the baked frame **0.15**. Product page: 1.5 s after clicking **Sunset** the stand-in is warm, not blue (walls R/B 1.38–1.52, `p-sunset-1s.png`). Its mean Y′ is **−7.5 %** vs the baked frame (engine says −8.5 %), so the swap is barely noticeable. 3 s after **Evening** the stand-in is warm too (`p-evening-3s.png`). |
| R2-04 | P1 | Walnut chocolate-black | **Partly**: fixed by day and at sunset, not at evening | Day TV 58.9, nightstand 47.9, Window view 49.6; Sunset 52.6. Grain and fluting read (`dw-day-cu-tvunit.png`). Evening TV **31.7** (56,27,5), dining chair 22.6, below the 45–60 night target. |
| R2-05 | P1 | Horizontal GI seams on walls | **Fixed** | Living, columns x 20/60, y 560–700: 72–77, no step > 2 Y′ (round 2: 75→58). Wall beside the side table: smooth ramp 189→226 (round 2: hard band). Soft validity is at `probes.js:105`. |
| R2-06 | P1 | Grey-clay city by day; window does not glow | **Partly**: the window is fixed, the city is not | Sky between towers p50 **246** / p98 250 (target 245–252). The city is unchanged: light-grey towers (150), near-white low-rise roofs (198), no glass tint, roads or green (`crops/dw-day-eye-window.png`, `dw-day-cu-window-plant.png`). The Burj now has a spire silhouette. |
| R2-07 | P1 | Cashmere dining table is a solid block | **Fixed** | Soft-square ceramic top on a white tulip pedestal, chairs tuck (`gl-day-dining.png`, `gl-focus-dining_table.png`). |
| R2-08 | P1 | Shades cast no sun shadow | **Fixed** | Morning: a solid, soft drum shadow on the wall beside the right table lamp (`dw-morning-bed.png`). The linings work. |
| R2-09 | P1 | Evening GI washes out lamp pools | **Fixed** | Living: far wall 48 vs next to the lamp 66 Y′ (≈ −0.9 EV linear; round 2 −0.15 EV). Dining table top 227 vs floor 79. Real pools and dark corners (`dw-evening-window.png`). |
| R2-10 | P1 | Night windows are pixel blocks | **Partly** | City p98 **85** (target ≤ 150) and per-window variation is better, but lit windows are still a 2–4 px square mosaic with no floor banding (`crops/dw-evening-eye-window.png`). |
| R2-11 | P1 | Style switch at Evening compiles ~65 programs | **Not verifiable here** | The prewarm is skipped on software GL by design (known #4): DW→Cashmere at Evening still went 96 → **162** programs. The third switch (→ Mediterranean) lost the WebGL context in this harness (`renderer.info` reset to 3 programs) and the next screenshot timed out (`r3.log`). Needs a GPU check with `?prewarm=force`. |
| R2-12 | P1 | Light Oak does not read as Japandi | **Fixed** (catalog nit in R3-09) | Platform bed with slatted oak headboard, paper-cord column lamp, black planter, low oak coffee table, slatted oak TV unit (`lo-day-eye.png`, `lo-day-bed.png`). Oak no longer orange: TV unit R/B 1.71 (round 2: 2.75). |
| R2-13 | P1 | Mediterranean: no visible cane, no limewash | **Partly** | The Sukhna chair is now a real cane chair with an alpha weave (`med-focus-armchair.png`). Sofa cane shows on the arm fronts in focus (`med-focus-sofa.png`) but not from the Living preset. **Limewash is not visible**: wall mid-scale variance 4.25 vs 4.15 on DW's flat paint (high-pass std, same crop). |
| R2-14 | P1 | Pixelated reflections on glossy objects | **Fixed** (as far as visible) | The kettle is now matte black per its card. The TV and mirrors reflect the room smoothly. No blocky reflections in any frame. |
| R2-15 | P1 | Focus close-ups not exposed (kitchen black) | **Fixed**, but overshoots on sunlit objects (R3-04) | Kitchen focus worktop Y′ **76** (round 2: 20); spot EV +1.55. Sofa focus: seat 203 vs catalog 197 (+3 %). |
| R2-16 | P2 | Floor-lamp shade dark wedge | **Fixed** | Clean shade at Morning (`dw-morning-cu-floorlamp.png`). The modeler's diagnosis (stale AWB plus the jamb shadow) holds. |
| R2-17 | P2 | Throws flat, duvet edge jagged, olive trunk white | **Partly** | Throws drape over the arm with a fringe. The duvet still has a stair-stepped turn-down with a white hem line, and a new dark "dent" artifact (R3-07). The olive trunk is still near-white. |
| R2-18 | P2 | Bouclé felt-like, rust pendant trim | **Fixed** (scale nit) | Pebbled loop texture reads on the sofa and chairs (`crops/gl-day-eye-sofa.png`). The trim is now champagne brass. The chair cells are about 2× too large (~1.5 cm) and read like crackle (`crops/gl-day-dining-chair.png`). |
| R2-19 | P2 | Lens stretched on the 2.5:1 stage | **Fixed** | Product stage 1392×548: vertical FOV 33° → horizontal **73.9°**; no edge stretch (`p-day-eye.png`). |
| R2-20 | P2 | Entry corridor and door a black void | **Fixed** | Corridor walls 60.1, door 58.9 with warm grain (round 2: 42 / 30). |
| R2-21 | P2 | Evening dollhouse periwinkle; bath black | **Partly**: fixed at night, regressed by day (R3-03) | Night backdrop (61,57,53), bath lit (61). Day dollhouse is now overexposed: frame p50 226, oak floor R 249. |
| R2-22 | P2 | Layout/art issues | **Partly** | Art is now painterly and reads as designer prints; the Bedroom preset is reframed. Nightstand L still butts the TV console with no gap (`dw-day-cu-tvunit.png`). |
| R2-23 | P2 | Hard focus outline, canvas ring | **Fixed** | No outline or ring 6.5 s after `focus()` (edge pixels match the frame). After a real mouse click (product, armchair) the stage edge pixels are clean, so there is no canvas ring. |
| R2-24 | P2 | Phone renders at 1× | **Fixed** | Phone `dpr 1.5` (round 2: 1.0); the image is visibly sharper. 103 draw calls and 121 k triangles. |

---

## New findings (most severe first)

### R3-01 [P1] Evening walls go lavender and the 2700 K lamps read as cool white
- Owner: engine (`index.js` evening white balance; `lighting.js` lamp colour)
- Repro: lab or product, any style, Evening, any preset (DW Entry, Bedroom, Dining; Cashmere Entry).
- Expected: an evening interior under 2700 K bulbs, shot at about 3300 K. Lamp scallops warm cream (R/B ≈ 1.3–1.45),
  shade walls warm neutral, G-tint ≥ 0.98. The cosy amber look of the round-2 frames, minus the mustard.
- Actual:
  - The evening camera gain is now `[0.715, 1.005, 1.79]`, a 1.79× blue push (round 2: ~1.5). On top of the new
    desaturated indirect, it over-corrects.
  - Lamp-lit wall in the Bedroom (235,219,210), R/B **1.12**: neutral white, like a 4000 K LED.
  - Wall between the lamps (104,89,83), G-tint **0.95**. DW Living walls (61,45,43), G-tint 0.86. Dining walls
    (85,74,75). Walls and ceiling read lilac or mauve while the floor (132,83,36) and textiles stay orange.
  - The same evening scene in the dollhouse (WB strength 0.4) is warm and correct. The walk view is the outlier.
  - The evening stand-in, lit by direct light only before the GI bake (`p-evening-3s.png`), has warmer walls
    (53,43,37) than the baked frame (81,67,63, G-tint 0.93). So the magenta comes from the desaturated bounce
    under the 1.79× blue gain, not from the lamps.
- Evidence: `dw-evening-eye.png`, `dw-evening-bed.png`, `dw-evening-dining.png`, `dw-evening-living.png`,
  `gl-evening-eye.png`.
- Fix:
  1. `WB_STRENGTH.evening 0.6 → 0.3` (or set evening `wb` to 2900 K).
  2. Add a green/magenta tint term to `whiteBalanceGain` so that a neutral paint under a lamp lands on G-tint 1.00.
     The magenta comes from the probe `desaturate()` pulling the bounce toward grey while the gain still assumes a
     2700 K bounce.
  3. Keep the downlights and lamps at 2700 K.
  4. Targets (Entry and Bedroom, Evening): lamp-lit wall R/B 1.30–1.45, shade wall R/B 1.25–1.40, G-tint 0.98–1.02
     everywhere; walnut ≥ 45 (now 31.7).

### R3-02 [P1] The daytime city is still a grey clay model (carried over from R2-06)
- Owner: engine (`sky.js`) or coordinator (a licensed photo plate)
- Repro: any style, Day/Morning, Entry, Bedroom or Window close-up.
- Expected: Dubai from a high floor: tinted glass towers that reflect the sky, sand and concrete mid-rise, roads,
  some green.
- Actual: unchanged from round 2 apart from the Burj spire.
  - Towers are uniform light grey (Y′ 150, R/B 1.10) with a fine window grid.
  - Low-rise blocks are near-white flat roofs (198) that read like snow.
  - No roads, water or green. At Sunset no tower catches warm light.
  - Now that the interior is believable, this is the single largest CG tell in every daytime frame. The window is
    the brightest and most looked-at area of the image.
- Evidence: `crops/dw-day-eye-window.png`, `dw-day-cu-window-plant.png`, `dw-golden-eye.png`.
- Fix: a photographic backplate per time of day (round-1 E2 option A) is the fastest route to 8+. Procedural
  fallback, with concrete values:
  1. Glass tint straight from `GLASS` (no `curtain` brightening), `metalness 0`, haze emissive ×0.2 under 1.5 km.
  2. Roof albedo `#a89c88` with clutter.
  3. An asphalt grid `#57534c`.
  4. West faces lit by the sun at Sunset (sun-facing emissive term).
  5. Target: tower glass median Y′ 90–130 with visible sky reflection; roofs ≤ 170.

### R3-03 [P1] Day dollhouse (Plan) is overexposed: floor and furniture wash out
- Owner: engine (`index.js applyExposure`, cutaway factor)
- Repro: any style, Day, Plan.
- Expected: a bright but legible model with oak, rug and sofa reading as their colours.
- Actual: frame p50 **226**, p98 243. Oak floor (249,206,160) with R clipped, rug 217, sofa 199. Everything is cream
  on cream. Cause: Day `TOD.exposure` went 2.3 → 3.0 for the interior, but the cutaway factor stayed ×0.4, so the
  dollhouse got +0.4 EV. Round 2 was fine.
- Evidence: `dw-day-top.png`. Evening Plan is good (`dw-evening-top.png`).
- Fix: cutaway factor for daylight `0.4 → 0.28` (≈ −0.5 EV), or a separate `TOD[t].dollhouseExposure`.
  Target: frame p50 170–190, oak floor R ≤ 235.

### R3-04 [P1] Focus spot-metering blows out sunlit backgrounds (12–19 % of the frame clipped)
- Owner: engine (focus meter)
- Repro: lab, Day. `villar.focus('sofa')` (DW or Mediterranean); the same happens with a click.
- Expected: the object at its catalogue luminance, with the rest of the frame still photographic (≤ 3 % clipped).
- Actual: spot EV **+2.1 to +2.2** (exposure 3.0 → 13.8). The sofa matches its catalogue colour (203 vs 197), but the
  sunlit wall, side table and floor clip: **16.8 %** of pixels have a channel ≥ 252 (Mediterranean), 11.8 % (DW).
  In the product, `focus('sofa')` at 1440 clips **19 %** of the stage (`p-day-focus-sofa-api.png`), and the
  phone clips 8.2 % (`ph-day-focus-sofa.png`). The frame reads like an overexposed catalogue cut-out, and the jump
  from the room view is +2 stops. Clicking an item is the core "game" interaction, so a founder will see this
  first. (Known #7: `focus('sofa')` does fly to the sofa at 1440, so that issue is resolved.)
  Non-sunlit focus is fine (Cashmere table 0 %, kitchen 0 %).
- Evidence: `med-focus-sofa.png`, `dw-focus-sofa.png`, `p-day-focus-sofa-api.png`.
- Fix: cap spot compensation at +1.3 EV. Add highlight roll-off in focus mode (the Neutral tone mapper's shoulder
  starts late: lower `startCompression` or blend in AgX for the focus view). Or meter 70 % object / 30 % frame.
  Target: ≤ 3 % clipped, object within ±15 % of catalogue Y′.

### R3-05 [P2] Light halos around wall-mounted objects (TV, mirrors)
- Owner: engine (`post.js` SSAO/indirect AO)
- Repro: Light Oak or DW, Day, Dining preset.
- Actual: a lighter rounded-rectangle band 15–25 px wide hugs the TV and the mirror, +3 to +6 Y′ over the wall
  (TV right edge: 79→81 hump; mirror: 75→79), with a visible outer boundary. It reads like a sticker outline. The AO
  darkens the open wall but not the strip next to the object (a depth-discontinuity rejection artefact).
- Evidence: `crops/lo-day-dining-halo.png`, `crops/dw-day-dining-mirror.png`.
- Fix: in the GTAO denoise/upsample, treat a depth step behind a thin object as "keep the wall's AO", not "no
  occlusion". For example, use the wall-side sample's AO when `|Δdepth| > 0.05 m`, or set `thickness 0.5 → 0.15` so
  thin wall-mounted objects stop occluding. Target: no step > 2 Y′ in the 30 px around wall-mounted items.

### R3-06 [P2] Olive trunk still white (R2-17, carried over)
- Owner: modeler (`furniture/decor.js` `barkMat`)
- Repro: any style, Day, Entry or Window close-up.
- Actual: the trunk and leaders render near-white (PVC-pipe look) in sun and shade
  (`dw-day-cu-window-plant.png`, `med-focus-armchair.png`).
- Fix: bark gradient `#7f7566` → `#5e554a`, roughness 0.95, 2–4 cm fissure normal. Target: trunk Y′ ≤ 110 in
  sun at Entry/Day.

### R3-07 [P2] Bedding still reads as satin plastic; a dark "dent" artifact in the duvet
- Owner: modeler (`beds.js`, cotton material)
- Repro: DW, Morning or Day, Bedroom preset and close-up.
- Actual:
  - The duvet and pillows are smooth, untextured and slightly glossy.
  - The turn-down edge is still stair-stepped with a white hem line (`dw-day-cu-bed.png`, `dw-day-bed.png`).
  - At Morning a dark crumpled spot with hard shading appears in the middle of the duvet (`dw-morning-bed.png`
    x ≈ 700, y ≈ 600; `dw-morning-cu-bedlamp.png` x ≈ 830, y ≈ 580). It looks like a degenerate vertex or a crease
    normal flip.
- Fix:
  1. Percale weave normal (0.6 mm pitch) and `sheen 0.5 / sheenRoughness 0.85`, `specularIntensity ≤ 0.12`.
  2. Turn-down edge ≥ 64 segments with a 2–3 cm roll; delete the hem line.
  3. Clamp crease displacement and recompute normals around the dent.

### R3-08 [P2] Mediterranean limewash is invisible, and the rattan dome shows no weave and has wire spikes
- Owner: engine (wall finish), modeler (rattan dome)
- Repro: Mediterranean, Day, Entry and Living.
- Actual:
  - Walls are statistically the same as DW's flat paint (high-pass std 4.25 vs 4.15). The style's main
    architectural cue does not reach the screen.
  - The Audrey dome reads as smooth orange plastic at 1.5–3 m.
  - Two thin dark wires protrude through the dome's top (`crops/med-day-lamp-spikes.png`).
- Fix:
  1. Limewash: 0.4–1.2 m brushed cloud mottling at ±5–7 % albedo plus a faint trowel normal (`normalScale 0.2`).
     Target: mid-scale std ≥ 7 on the Entry wall crop.
  2. Rattan dome: woven normal and alpha at 6–8 mm, with the light showing through at night.
  3. Shorten the dome's internal struts to inside the shell.

### R3-09 [P2] Light Oak: sage bedding far exceeds the palette's single-accent share
- Owner: catalog
- Repro: Light Oak, Bedroom.
- Actual: a full sage duvet and two sage pillows make sage the dominant bedroom colour. The palette gives
  "Moss sage" 2.5 % (accent) and assigns bedding to "Rice paper" `#ECE7DC`.
- Fix: rice-paper or stone linen duvet, with sage on one pillow or the throw only.

### R3-10 [P2] Small material and asset tells
- Owner: modeler
- **Candle flames invisible.** The table glows warm at night, but the candles show no flame card
  (`crops/gl-evening-candles.png`). Add a 1.5 × 3 cm emissive flame card (camera-facing, additive) at evening.
- **"Amber glass" tumblers are opaque beige ceramic** (`dw-day-cu-dining.png`). Use transmission 0.9, tint `#c58a3e`,
  roughness 0.05.
- **Travertine worktop pits** are a dense uniform pepper pattern that reads as cork or terrazzo, and the pits sparkle
  near the sink (`crops/dw-focus-kitchen-worktop.png`). Use fewer, elongated voids along the banding (1–6 mm) and no
  specular in the pits.
- **Bouclé cell size** on the Cashmere dining chairs is ~1.5 cm and reads as crackle. Halve it.
- **Cognac leather armchair** is a smooth orange surface with no grain or crease darkening (`p-day-click-sofa.png`).
  Grain normal 0.6, roughness 0.5, darker creases at the channel seams.
- **Nightstand L still butts the TV console** (0 cm). Leave ≥ 12 cm (R2-22 layout part).

### R3-11 [P2] Sunset shade has a magenta tint
- Owner: engine (golden WB)
- Repro: DW, Sunset, Window or Living preset.
- Actual: shade walls (81,69,65) and ceiling (76,65,62), G-tint **0.94**: lilac rather than cool neutral. Sun
  patches clip in R (253,217,193), so they read peach-white, not golden (R/B 1.31; target ≥ 1.5). It is still the best
  light in the product (`dw-golden-living.png`), but the shade should be blue-grey, not mauve.
- Fix: the same tint term as R3-01. Golden sun `I 7.0 → 6.0` or exposure −0.2 EV so the sun patch keeps
  saturation (R ≤ 245).

### R3-12 [P2] Phone (low tier): dark round blotch on the bed base by day
- Owner: engine (low-tier probe lookup)
- Repro: phone 390×844 @2x, DW, Day, Entry.
- Actual: a ~30 px soft dark disc on the upholstered bed base side, under the duvet edge
  (`crops/ph-day-bed-blotch.png`, `crops/ph-day-bed.png`). It is not present on desktop high. It looks like a single
  low-validity probe inside the bed volume still dominating the 8-corner blend on `PROBE_RES.low`.
- Fix: on `low`, raise the invalid-probe weight floor (`mix(0.25,1.0,valid)` → `mix(0.6,1.0,valid)`), or push the
  lookup point 0.5 × spacing along the normal. Target: no local dip > 8 Y′ on flat upholstered faces.

---

## What stands between us and 8/10 (in order of score impact)

1. **Evening colour (R3-01): about +0.4.** Evening is the "wow" mode. Make the lamps 2700 K cream again without the
   round-2 mustard. Targets: lamp-lit wall R/B 1.30–1.45, G-tint 0.98–1.02, walnut ≥ 45 at night.
2. **The city outside the window (R3-02): about +0.4.** It is the brightest and most-looked-at part of every
   daytime frame. A photographic backplate per time of day, or the procedural values in R3-02. Tower glass
   Y′ 90–130 with sky reflection; roofs ≤ 170.
3. **Focus exposure (R3-04): about +0.2.** Spot EV ≤ +1.3 with a highlight shoulder; ≤ 3 % clipped; object within
   ±15 % of catalogue Y′.
4. **Textile and plant realism (R3-06, R3-07): about +0.2.** Percale bedding with weave and roll, no hem line, no
   dent; olive bark Y′ ≤ 110 in sun.
5. **Mediterranean identity (R3-08, sofa cane from presets): about +0.2 on that style.** Limewash mid-scale std ≥ 7;
   a woven rattan dome; cane visible on the sofa from the Living preset.
6. **Plan exposure and small tells (R3-03, R3-05, R3-10, R3-11, R3-12): about +0.2 together.**

With 1–4 done the product is an honest 8. Items 5–6 take Mediterranean and the edge cases to the same level.

## Notes for the harness and tech review
- In `r3.log`, the third style switch at Evening (Cashmere → Mediterranean) reset `renderer.info` to 3 programs and
  1 geometry (a context loss and restore). The next screenshot then blocked > 30 s. Software-GL memory may be the
  cause, but the tech reviewer should check that three packs' textures fit a mobile GPU budget.
- `villar.debug.whiteBalance` no longer exposes `awb` (round-2 scripts that read it fail; harmless).

## Screenshot index (`/tmp/rev3/render/`)
- **Dark Walnut**
  - Day: `dw-day-{eye,living,bed,dining,window,top}.png`; close-ups `dw-day-cu-{sofa,tvunit,bed,kitchen,dining,window-plant}.png`
  - Sunset: `dw-golden-{eye,living,window,bed}.png`
  - Morning: `dw-morning-{eye,bed,living}.png`, `dw-morning-standin-eye.png` (2.5 s, baking),
    `dw-morning-cu-{bedlamp,floorlamp}.png`
  - Evening: `dw-evening-{eye,living,bed,dining,window,top}.png`
- **Light Oak** Day: `lo-day-{eye,living,bed,dining}.png`
- **Cashmere**: Day `gl-day-{eye,living,dining}.png`; Evening `gl-evening-{eye,living}.png`
- **Mediterranean** Day: `med-day-{eye,living,bed}.png`
- **Focus**: `dw-focus-{kitchen,sofa}.png`, `gl-focus-dining_table.png`, `med-focus-{armchair,sofa}.png`
- **Product desktop**: `p-day-eye.png`, `p-sunset-1s.png`, `p-sunset-6s.png`, `p-sunset-eye.png`, `p-evening-3s.png`,
  `p-evening-eye.png`, `p-day-click-sofa.png` (lands on the armchair), `p-day-focus-sofa-api.png`
- **Phone**: `ph-day-eye.png`, `ph-day-focus-{bed,sofa}.png`, `ph-evening-eye.png`
- **Crops** in `crops/`. Logs in `r*.log`. Scripts in `scripts/` (`lum.py`, `pct.py`, `mk.py`).
