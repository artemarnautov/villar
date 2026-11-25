# Villar — render & lighting review (art direction / lighting TD)

Date: 2026-11-25 · Build reviewed: working tree in `/home/claude/villar` (three r187, AgX, lab page `/lab/engine.html`)
Goal under review (founder): *"top render with realistic elements; light must fall correctly on objects; it should feel like a person is standing in the apartment."*

## Verdict

**Realism: 5.5 / 10 (interactive raster).** The direction is right: the room is well proportioned, sun geometry is
correct, the mullion and olive-tree shadows are good, walnut and oak materials work, and the evening reads warm.
Light falls in the right direction, but **not with the right falloff, contrast or colour**. Four things give it away as
CG: (1) the room is lit almost evenly from window to entry door, (2) the city outside is grey clay boxes,
(3) every silhouette has a "hairy" screen-space AO halo, (4) the textiles (bedding, cushions) look like foam and satin
plastic. Fixing the top 5 items below should take it to about 7.5. Getting past 8.5 needs a photographic exterior and
a GI pass checked against the path tracer.

What already works (keep it):
- Sun path is plausible for a south-facing Dubai high-rise window in winter (day alt 41° ≈ 13:30 Jan; golden alt 9°,
  az −47°; morning az +40° from the east side). Mullion shadows are crisp, I saw no shadow acne, peter-panning or wall/floor/ceiling
  light leaks (double-sided shadow casters on architecture work). See `golden-living.png`, `morning-bed.png`.
- Architecture detail: curtain track with gliders, bulkhead + linear AC grille, skirting, recessed downlights,
  sliding sash with pull handle, balcony glass railing.
- Walnut: grain direction, figure and scale are right (`diag/day-close-tvunit.png`). Oak plank width (20 cm) is right.
- Evening downlight scallops on the wardrobe and the TV specular highlight read correctly (`evening-window.png`, `evening-dining.png`).

## Method & environment caveats

- Matrix: 4 times of day × 6 views, 1600×1000, `/lab/engine.html?clean` (UI hidden) → `/tmp/rev-render/<tod>-<view>.png`.
  Close-ups via `villar.debug.setPose()` → `/tmp/rev-render/diag/*.png`. Tests with GTAO on/off, tone mapping and photo mode →
  `/tmp/rev-render/final/*.png`, `/tmp/rev-render/photo/*.png`. Crops → `/tmp/rev-render/crop-*.png`.
  (Screenshots live in `/tmp`, not in the repo. To regenerate: steps = `setTimeOfDay(t)` + 12 s, then `setView(v)` + 9 s per shot.)
- The machine was heavily contended (2 cores, load 18–20 from parallel QA runs). Under SwiftShader the WebGL context was
  **lost and restored several times** (`[villar] WebGL context lost during render / probe-bake`). One matrix frame
  (`morning-window.png`) and several diagnostic frames came out black. In one run `window.villar` was not ready after 70 s.
- Auto-exposure never metered in headless (`villar.debug.meter` → `{ev:0,target:0}`, no `log`), so **all frames are at the
  hand-set per-TOD base exposure**. `day-dining-AEoff.png` matches the AE-on frame. Brightness differences are therefore lighting,
  not exposure.
- Photo mode (path tracer): the first attempt crashed the GPU process seconds after `startPhoto()` (white page,
  `photo/pt-*.png`). The second attempt never reached ready. The third gave one usable early frame,
  `final/pt-eye-060s.png`; after that the image went almost black (`final/pt-eye-120s.png`) and the session was killed.
  See "Photo mode result" below. Some frames in `final/` were also rendered in a **broken GI state** (see E10).

Severity: **P0** = blocks "standing in a real apartment"; **P1** = clearly visible CG tell; **P2** = polish.

---

## ENGINE (owner: engine — `site/js/engine/*` except materials/textures/furniture)

### E1 · P0 · The interior is lit evenly: no daylight falloff with depth
Evidence: `day-window.png`, `day-dining.png`, `golden-dining.png`, `day-eye.png`.
Measured on `day-window.png` (linear luminance of the displayed image):
| surface | distance from glazing | Y |
|---|---|---|
| TV wall, near window | ~2 m | 0.31 |
| TV wall, far | ~5.5 m | 0.29 (−0.1 EV) |
| bath partition facing window | 6.4 m | 0.41 |
| corridor/wardrobe end by entry | ~8 m | 0.39 |

The room has a 3.7 × 2.6 m window on the short wall of a 4.6 × 9 m plan. A real room like this loses about **1.5–3 EV**
between 1–2 m and 6–8 m from the glass, and the entry under the 2.55 m bulkhead is the darkest zone. Here the entry is as
bright as the bed area. That is the main reason it feels like a lit set and not a room. Sun-patch contrast is also low:
sun floor vs shaded floor = 0.61 / 0.26 → 1.2 EV displayed (`day-living.png`). After tone mapping a photo of this room
would show ~2.5–3.5 EV.

**Path-tracer check** (`final/pt-eye-060s.png` vs `day-eye.png`, same view, same exposure; `PHOTO_EXPOSURE = 1.0`
is meant to be "calibrated against GI"):
| region | raster Y | path-traced Y (≈60 s, early spp, denoised) | Δ |
|---|---|---|---|
| sky through window | 0.735 | 0.743 | 0.0 EV |
| wall near window (right, mid) | 0.367 | 0.126 | −1.5 EV |
| ceiling | 0.376 | 0.131 | −1.5 EV |
| wall at camera (~7 m from glass) | 0.366 | 0.042 | **−3.1 EV** |
| shaded floor | 0.212 | 0.010 | −4.4 EV |

The early frame is noisy, and despeckle/denoise at low spp biases dark (the sun patch also reads −1.3 EV), so treat these
numbers as a direction, not a calibration. Even after allowing ~1 EV of bias, the path tracer shows the gradient the raster
lacks: the window matches, the interior is 1–2+ EV darker, and the far wall is darkest. Raster indirect light is
**overbright and too uniform**.

Root-cause hypotheses (in order of likelihood):
1. `probes.js` — trilinear SH interpolation has **no visibility term**. Probes are 0.92 × 0.95 × 0.90 m apart. The thin
   bath partitions, wardrobe and bulkhead don't block interpolation, so living-room irradiance bleeds into the corridor and
   dining corner. Probes that fall inside obstacles are nudged, not invalidated.
2. `probes.js` `TAIL = 0.45/(1-0.45) = 0.82` adds 82 % of the 1→2-bounce delta as "missing bounces". In a white room the
   extra bounces are almost uniform, so this pushes the whole room toward one value. With wall albedo 0.84 and ceiling 0.90
   the tail is closer to 0.3–0.4 of the delta after visibility is accounted for.
3. `sky.js` presets: the sky is bright relative to the sun. Day: `horizonL 1.1` (horizontal sky irradiance ≈ 2.2) vs
   sun `I 8.5 · sin41° ≈ 5.6` → sun:sky ≈ 2.5:1. Clear-sky Dubai is about 4–6:1 even in haze. The ambient term is therefore
   too large compared with direct light.
4. `post.js` GTAO multiplies the final image (direct + indirect) instead of only the indirect term (see E3), so corners
   lose direct light too. The indirect term, which most needs occlusion, gets only screen-space occlusion with a 0.32 m radius.

Fix (do in this order; check each step with the path tracer on `window` and `dining`):
- Calibrate first. Render `window` view in photo mode at 256 spp, then compare the far-wall / near-wall luminance ratio with
  raster. Target: raster within ±0.3 EV of the PT at 3 sample points (near wall, dining wall, entry wall).
- `probes.js`: set `TAIL` to `0.3` (or bake a real third bounce on `high`). Raise the grid to `[8, 4, 16]` on high: the bake is
  progressive and 12² faces are cheap. Give each probe a validity weight: 0 if its grid point is inside an obstacle box, 1
  otherwise. Patch `lightprobes_pars_fragment` (you already patch `lights_fragment_maps`) to do 8 manual corner fetches
  weighted by trilinear weight × validity × a DDGI-style Chebyshev visibility term. Store mean/mean² hit distance per probe in
  a second small `Data3DTexture`; you already render 6 faces per probe, so also write depth.
- `sky.js`: day `horizonL 1.1 → 0.75`, `zenithL 0.38 → 0.30`. Morning `0.95 → 0.70`. Golden `0.85 → 0.60`.
  `lighting.js` day sun `I 8.5 → 10.5`, morning `7 → 8.5`. Then raise `exposure` about +0.3 EV per TOD to restore mid-grey on the
  near walls. Net effect: sunlit patch ~+1 EV over shade, back of room ~−1 EV.
- `index.js` auto-exposure: compensation `0.62 → 0.4` and clamp `+1.3 → +0.7 EV`. The dining/entry views should *feel*
  darker than the window side, as they do for a person standing there.

### E2 · P0 · The view outside does not say "high floor in Dubai"
Evidence: `day-bed.png`, `diag/day-close-window-floor-junction.png`, `day-eye.png`, `evening-bed.png`,
`crop-evening-eye-window.png`.
- By day the city is flat grey clay: matte untextured boxes, a beige ground, no glass, no reflections, no roads, no water,
  no greenery. Low-rise blocks 6–40 m tall on a 64 m grid read as a 1970s suburb, not Downtown/Marina.
- `sky.js` skyline material has no `envMap`, so it uses `scene.environment`, which is the **interior room capture**. The towers
  are ambient-lit by a beige room.
- At night (`evening-*`) the lit-window texture turns into blocky squares close up and shimmering noise far away. The ground rings
  use the same facade/night texture, which makes a striped light band along the horizon. The blue-hour sky reads
  **red-brown** (measured sRGB 73/51/47 in `evening-eye.png`) because `glowL 0.11` (orange) is 2× `horizonL 0.05`.

Fix (pick A; B is the fallback):
- **A (recommended, what archviz studios do):** a photographic backplate. Use 3 licensed equirect or cylindrical plates
  (day, golden, night), ≥8k wide, shot from about the 35th–45th floor, vendored under `site/` (allowed: no CDN). Use them as
  `scene.background` and keep the procedural HDR sky for lighting and as the PT environment. Parallax is negligible: content is
  ≥300 m away, and ±3 m of walking shifts it by ≤0.6°. Match haze and colour per TOD to the plate.
- **B (procedural):** glass curtain walls. Use `MeshPhysicalMaterial` with dark tinted colour (`#22313a`…`#5f727c`, plus 20 %
  bronze/silver towers), `roughness 0.06–0.12`, `metalness 0`, and **`envMap` = the sky PMREM** (set it explicitly). Add a mullion
  normal map with 1.5 m bays and per-tower tint and UV jitter. Haze toward warm sand `#d9cdb8` instead of grey. Add a roads
  layer (asphalt `#5a5650` lines on the ground ring), sparse palms/green, a Gulf water band near the horizon on one side, and a
  correct Burj Khalifa silhouette (Y-plan, setbacks, 828 m) in place of the stacked cubes. Night: per-window brightness and
  colour variation, emissive texture with mips + anisotropy 16. Beyond ~1.5 km drop the window texture for an averaged emissive.
  Remove the night texture from the ground rings and use sparse warm street-light dots. Evening sky: `glowL 0.11 → 0.03`,
  horizon `#3b4f7a` L 0.06, zenith `#132a5e` L 0.035.

### E3 · P0 · GTAO halos: "hairy" edges on bedding, cushions, marble rim, door gaps
Evidence: `crop-golden-bed-bedding.png`, `crop-day-living-sofa.png`, `golden-dining.png` (marble rim, wardrobe edge),
`crop-evening-dining-wardrobe.png` (grain beside the handles). A/B: **`crop-gtao-on-vs-off.png`**: left is `day-bed.png`
with GTAO, right is `diag/day-close-bed-noGTAO.png`. With GTAO off the fringes are **gone**. (`final/day-close-bed-GTAO-{on,off}.png`
were rendered in the broken-GI state of E10 and are not useful for this comparison.)
Root cause (`post.js`): GTAO runs at **half resolution** (`aoScale 0.5`) and is bilinearly upsampled. The Poisson denoiser
uses `depthPhi: 2`. In `PoissonDenoiseShader`, `depthDiff` is the plane distance in **metres**, so samples are only rejected
across >2 m depth steps, which means never inside a room. `radius: 6` half-res px ≈ 12 full-res px. AO is smeared across
every silhouette and looks like fuzz. GTAO is also blended over the whole lit image (`blendIntensity 0.85`), which darkens
direct sunlight in corners.
Fix:
- `updatePdMaterial({ depthPhi: 0.06, normalPhi: 12, lumaPhi: 10, radius: 3, rings: 2, samples: 16 })`.
- On `high`, `aoScale: 1.0` (or keep half-res with a depth-aware bilateral upsample).
- `updateGtaoMaterial({ radius: 0.25, thickness: 0.5, distanceExponent: 1.5, samples: 16 })`, `blendIntensity 0.7`.
- Better: render GTAO **before** the beauty pass and sample it in a patched `aomap_fragment`, so it only multiplies
  `reflectedLight.indirectDiffuse` (and specular occlusion), not the sun and lamps. This is how UE/Unity apply SSAO. No
  scene ShaderMaterial is needed; it is a chunk patch like `patchShaderChunks`.

### E4 · P1 · Tone & contrast: milky AgX, the window doesn't glow, catalogue colours shift
Evidence: `day-eye.png` (sky in window sRGB 222, walls 173 → the window is only ~1 EV above the interior).
(The A/B frame `final/day-eye-neutralTM.png` was rendered in the broken-GI state of E10, so the tone-mapper comparison is
still to do. Use the lab's AgX/ACES/Neutral buttons on a healthy frame.)
AgX base (no look) is deliberately low-contrast and desaturating. Together with E1 the image has no blacks (darkest large
area is the walnut, ~sRGB 60) and no near-whites. The window should be the brightest thing in frame, rolling to near-white
at its centre, with a soft roll-off into the reveal.
This is also a **product** issue. Villar sells catalogue colours (`colorHex`). The "Молочный" sofa `#CFC4B3` and the
terracotta cushions should read as their swatches in daylight, and AgX desaturates and hue-shifts them.
Fix (`index.js`/`post.js`):
- Default to `NeutralToneMapping` (Khronos PBR Neutral; it preserves base colour) with exposure re-calibrated. Keep AgX only
  for golden/evening if preferred. Or keep AgX and add a "Punchy" look (contrast power ≈ 1.35 and saturation ≈ 1.3 in AgX log
  space) via a custom `toneMapping` chunk. Post is not a scene material, so the SPEC allows it.
- After E1, target in the eye view: window centre sRGB 245–252, sunlit floor 235–245, near walls 165–185, far walls
  110–135, walnut 45–65.

### E5 · P1 · White balance: everything is peach; no warm/cool separation
Evidence: shaded wall R/B in sRGB: day 155/128 (1.21), morning 188/145 (1.30), golden 162/113 (**1.43**), golden ceiling
168/114 (`golden-living.png`, `golden-eye.png`, `morning-living.png`). The paint itself is `#EDE7DE` (R/B 1.07).
In real golden/morning light the sun patches are warm and the shade is lit by blue sky, so it is neutral-to-cool. That
contrast is what reads as "golden hour". Here the shade is as orange as the sun because the window fill and probes are fed
by the warm horizon colour (`windowFill.color = horizon.lerp(zenith, 0.3)`, golden horizon `#efcfa8`), plus warm floor bounce,
and the camera is fixed at D65.
Fix:
- `sky.js`: golden horizon `#efcfa8 → #e9d2b8` and zenith weight up. Morning horizon cooler `#d6dde3`.
- `lighting.js`: `windowFill`/`portal` colour = `horizon.lerp(zenith, 0.55)` (more sky blue).
- Add camera white balance in linear HDR before tone mapping (multiply by `1 / kelvin(WB)` normalised to luminance). Per TOD:
  day 6000 K, morning 5300 K, golden 4600 K, evening 3300 K. Goal: shaded white walls read within ±3 % neutral in day, sun
  patches read warm.

### E6 · P1 · Lamps: no shadows, no shade cut-off, pendant doesn't pool on the table
Evidence: `diag/evening-close-bed-lamps.png`, `diag/evening-close-dining-pendant.png`, `evening-eye.png`, `evening-top.png`.
- `furnish.js makeLights()` forces `castShadow = false`, although the modeler sets `shadow: true` for the floor lamp and pendant.
  Light passes through shades, the armchair and pillows. No object casts a lamp shadow, so the night scenes look
  "evenly glowing".
- Drum shades should make the hourglass cut-off on the wall above and below the shade. You get round glows instead.
- The drum pendant is a `point` light, so it lights the wall art next to it brightest. The table under it gets no pool,
  and a dining pool is the whole point of that light at night.
Fix:
- `furnish.js`: honour `L.shadow`. Point shadow 512², `bias -0.002`, `normalBias 0.02`, `radius 4`. Allow shadows on at most
  2 lamps on high and 0 on medium/low.
- For drum/cone shades, model each lamp as **two spots** (down: angle = shade bottom half-angle ≈ 50–60°, penumbra 0.35,
  70 % of flux, shadowed; up: angle ≈ 45°, penumbra 0.4, 30 %) plus a dim unshadowed point (10 %) for the shade glow. The
  modeler should export `lights` that way (owner split: engine honours the schema, modeler sets the values).
- Pendant drum: a down spot aimed at the table (angle 55°, penumbra 0.5, shadow on). The table top should land about +1.5 EV
  over the surrounding floor.
- Bloom in the dollhouse (`evening-top.png`) blows the lamps into large white discs. Use bloom strength 0.22 → 0.1 when cutaway.

### E7 · P1 · Window glass: milky veil by day, no night reflections
Evidence: `day-eye.png` (the view below the railing top line is foggier: two layers of white-diffuse glass),
`evening-eye.png`, `final/evening-window-glass.png` (looking straight at the glazing at night: zero room reflection; low-rise
roofs also glow light grey at night).
`architecture.js makeGlass()` uses `color #ffffff, opacity 0.08` (railing `0.14`). With normal alpha blending that **adds a
white diffuse, lit surface** over the view (a veil). Real glass has no diffuse, only Fresnel reflection. At night the
glazing should be the room's best mirror (dark exterior, lit interior: ~8–12 % double-glazed reflection), and it shows
nothing.
Fix: glass `color #000000`, `opacity 1`, `transparent: true`, `premultipliedAlpha: true`, alpha from Fresnel via
`specularIntensity 1` (or `transmission: 1` on high only). Railing glass the same, tint in `specularColor` `#dff0ea`. At
evening, give the glass an `envMap` from a cube capture taken **near the window** (box-projected via a small
`envmap_physical_pars_fragment` patch, room AABB 0..4.6 × 0..2.85 × 0..9) and `envMapIntensity 1.0`. Then the lamps and
sofa reflect in the glazing.

### E8 · P1 · Camera: converging verticals and a 20 mm (not 24 mm) lens
Evidence: `day-bed.png` and `golden-bed.png` (TV and window mullions lean), `day-living.png`, `day-dining.png`;
`day-eye.png` (stretched cushions at the left edge).
- Preset pitch: living −11.7°, bed −13.1°, dining −11.5°. Architectural photography always corrects verticals (shift lens).
  Leaning walls are the fastest "amateur/game" tell.
- `camera.js` `fov = 58` is **vertical**. At 16:10 that is hFOV 83° ≈ 20 mm full-frame, not 24 mm, and the edges stretch.
Fix:
- Two-point perspective for presets: keep the camera level (pitch 0) and shift the frustum. After
  `updateProjectionMatrix()`, set `camera.projectionMatrix.elements[9] = tan(−pitch) / tan(vfov/2)` (e.g. −12° → 0.38) and
  update the inverse. During free look, blend the shift toward real pitch beyond ±15° (like "auto upright").
- Define the lens by **horizontal** FOV on landscape: 74° (24 mm) → vFOV ≈ 50° at 16:10. Keep your portrait rule (≥66° h).

### E9 · P1 · Floors and lacquered wood show no reflections
Evidence: `day-window.png`, `day-dining.png`, `day-eye.png` (no window sheen on the floor near the glass), `diag/day-close-tvunit.png`.
The oak floor next to a floor-to-ceiling window should show a broad soft reflection of the glazing, strongest at grazing
angles. That single cue sells "real floor". Engine part: the reflection source is a room cube captured at
(2.3, 1.35, 5.4) without box projection, so floor reflections are in the wrong place even when the material allows them.
Fix: box-projected env (same patch as E7) for `floor` and furniture tops, plus SSR on high (three `SSRPass`, or a cheap
floor-only planar reflection blurred to `roughness 0.3`, intensity ×0.25). Material values: see M5.

### E10 · P1 · Robustness: untextured first frames, black indirect light, black photo
Evidence:
- `diag/day-close-sofa.png` (flat placeholder fabric, flat walnut) vs `diag/day-close-sofa2.png` (textures landed).
- **Broken GI state:** `final/day-close-bed-GTAO-on.png`, `final/day-eye-neutralTM.png`. Indirect light is ~0: shaded
  floor Y 0.010 vs 0.21 normally, shaded duvet nearly black, only sunlit areas visible. It looks like the probe grid is
  enabled (`lighting.setFallback(false)`, `probes.setEnabled(true)`) with an empty/zero SH texture. This happened after
  context loss/restore during a bake. A real user on a GPU that drops its context, such as a mobile tab switch, would see this.
- Photo mode went from a valid early frame (`final/pt-eye-060s.png`) to almost black (`final/pt-eye-120s.png`) within 60 s,
  probably a context loss or NaN accumulation. Separately, the first attempt crashed the GPU process (`photo/pt-040s.png`).
- Log: `WebGL context lost during probe-bake`, `villar is not defined` after 70 s (`photo/log2.txt`).
`index.js` marks textures "settled" after a **15 s timeout** even if procedural textures are still pending, then bakes GI
and env with flat placeholders. On a slow laptop or phone the first frames (and the baked GI) are untextured.
Fix:
- Show the loader until `materials.pending() === 0`, keeping the timeout only as a hard fallback at 30 s. Re-bake env/GI
  when the textures land (`watchTextures` → `relight({fresh:false})`).
- `webglcontextrestored`: cancel any running bake (`job.cancelled`), call `probes.setEnabled(false)` + `lighting.setFallback(true)`
  until a **complete** fresh bake has uploaded, and re-upload `grid.texture` (`tex.needsUpdate = true`; the old GPU copy is gone).
  Never enable the grid when the last upload was zero. Add a sanity check: SH DC luminance mean > 1e-3, else keep the fallback.
- Photo mode: on context loss call `stopPhoto()`, rebuild the tracer (`pt.dispose(); pt = null`) and restart. Clamp
  per-sample radiance (`pt.filterGlossyFactor` already set; add a max-luminance clamp ~20 in the despeckle pass) and reject NaN.
- Make sure `markReady()` still fires after a restore during the initial bake.
- PT only: the balcony rail glass (`#e3f1ec`, `transmission 1`) renders as a saturated **teal band** (`final/pt-eye-060s.png`).
  Use `color #ffffff` + `attenuationColor #e9f2ee`, `attenuationDistance 0.5`, `thickness 0.012`.

### E11 · P2 · Door/drawer gaps alias into dotted light lines (kitchen, wardrobe)
Evidence: `crop-evening-dining-wardrobe.png`, `diag/day-close-kitchen.png`.
3 mm geometric gaps are sub-pixel at 3 m (dotted), and they read **light**, not dark. Sharp front edges catch light, and the
carcass behind is lit like the front.
Fix (`architecture.js`): front-panel edge radius 1.5 mm (softBox) so a thin highlight line shows. Gaps 4 mm with a dark
recess material (`#2a2622`, roughness 1) set 15 mm back. Then MSAA resolves it as a continuous dark line.

### E12 · P2 · Entry door veneer grain runs horizontally
Evidence: `diag/day-close-kitchen.png`, `day-window.png`. Interior doors are veneered with vertical grain.
Fix: in `architecture.js door()`, box-project the leaf with `axis: 'y'` or rotate the UVs 90°.

### E13 · P2 · Sun shadow penumbra & sun patch polish
Shadows are good (no acne/leaks). For extra realism: PCSS-style contact hardening (penumbra = 0.0093 × occluder distance:
mullion at 4 m ≈ 3.7 cm, leaves at 1.5 m ≈ 1.4 cm, chair legs at contact ≈ 0). Also add a faint warm bounce on the
ceiling above the sun patch. Probes catch it, but at 0.9 m resolution it smears.

### E14 · P2 · Dollhouse ("top")
Evidence: `day-top.png`, `evening-top.png`. The model floats on flat grey with no contact shadow; walls show light caps.
Fix: a soft ground shadow (baked blurred footprint or `ContactShadows`-style blurred depth), cap colour `#34312e`
consistently, bloom limits (E6).

---

## MODELER (owner: modeler — `materials.js`, `textures.js`, `furniture/*`)

### M1 · P1 · Bedding reads as foam slabs + plastic tubes
Evidence: `golden-bed.png`, `day-bed.png`, `final/day-close-bed-GTAO-off.png`, `crop-golden-bed-bedding.png`.
The duvet is a rigid slab with a rounded rim. The hem and turn-down are **tubes** (`tube(... 0.012/0.03)`) that read as
piping or plastic pipe. The throw is a flat board with tubes at both ends, and there are no wrinkles or soft compression.
Cotton sheen + `specularIntensity 0.35` give a satin-plastic look in the sun patch.
Fix (`beds.js`, `materials.js`):
- Drop the hem tubes. Build the turn-down as a folded drape layer, ≥4 cm thick and rounded.
- Add low-frequency drape displacement (±1.5 cm, 25–40 cm wavelength) and 6–10 soft crease lines radiating from the pillows
  and the foot corners.
- The duvet should sag over the mattress edge with a 6–8 cm radius roll. Pillows already have good shapes; add 2–3 shallow
  dents.
- Cotton: `roughness 1`, `sheen 0.5`, `sheenRoughness 0.85`, `specularIntensity 0.12`, percale weave normal at 0.6 mm pitch.
- Throw: waffle or chunky knit normal (8–12 mm cells), `normalScale 1.2`, wool sheen. It should read as knit at 2 m.

### M2 · P1 · Marble looks like an oil slick
Evidence: `diag/day-close-dining.png`, `day-dining.png`, `golden-dining.png`.
Domain-warped fbm gives blobby, liquid veins with **relief**: `px.h = -vv*0.1` feeds the normal map, so veins look carved
on a polished stone. The contrast is high and the pattern is too large and isotropic.
Fix (`textures.js marbleTextures`): vein height `0` (polished stone is flat). Use ridged noise `1-abs(fbm)` raised to
pow 6–10 along one dominant warped direction for 1–2 major veins per metre, plus thin branching secondaries (pow 20,
opacity 0.3). Vein colour `#9a948c` at max 55 %, slightly soft-edged (translucency look). Tile 1.6 m. Material
`roughness 0.12`, `clearcoat 0.6`, `clearcoatRoughness 0.06`.

### M3 · P1 · Sofa & cushions: boxy, no tailoring; cushions satin-plastic
Evidence: `diag/day-close-sofa2.png`, `crop-day-living-sofa.png`, `day-living.png`.
The upholstery has no welts, seams or crowning, and the back cushions are perfect rectangles. The throw cushions have a
uniform satin sheen gradient with no fabric breakup at 2–3 m.
Fix (`seating.js`, `materials.js`):
- Welt/piping on seat cushion edges (r 4 mm). Seat crowning +1.5 cm. Back cushions with 1–2 cm top sag and soft corner
  pinch. A seam line on the arm fronts.
- Cushions: 2–3 random dents, corner "ears" slightly compressed.
- Linen: `sheen 0.35 → 0.25`, `specularIntensity 0.3 → 0.15`, slub normal visible at 2 m (`normalScale 0.8 → 1.0`).
- Bouclé: `normalStrength 5` aliases at distance. Lower it to 2.5 and add the loop "fuzz" via `sheen 0.8`, `sheenRoughness 0.95`
  instead of normal amplitude.

### M4 · P1 · Walls are perfectly uniform
Evidence: every wall in the matrix, e.g. `day-living.png`, `diag/day-close-ceiling-corner.png`.
`paintTextures` varies albedo ±1 % over a 0.5 m tile, so walls read as flat CG planes at room scale.
Fix: a second, large-scale layer — 1.5–3 m mottling ±2.5 % albedo, roller stipple normal at 2–3 mm (`normalScale 0.15`),
roughness 0.82–0.9 (eggshell, slight grazing sheen). Very faint darkening in the bottom 10 cm (scuffs) on the entry/kitchen
walls only. Ceiling flatter (±1 %).

### M5 · P1 · Oak floor: too short planks, visible tiling, no sheen
Evidence: `day-dining.png`, `diag/day-close-tvunit.png`, `day-top.png`.
Planks are 0.9–1.5 m (avg ~1.2 m) on a 2.4 × 1.2 m tile, so the repeat is visible across 4.6 × 9 m. Engineered wide
plank is 1.8–2.2 m. The material is `roughness 1 × map`, `clearcoat 0.06` → no window sheen (see E9).
Fix (`textures.js floorTextures`, `materials.js 'oak-floor'`): plank length 1.8–2.2 m, tile 4.4 × 1.2 m (or per-plank random
UV offset/flip). Tone variance ±6 % (now up to +18 %, which reads as laminate). Matte lacquer: base roughness ~0.55,
`clearcoat 0.3`, `clearcoatRoughness 0.3`.

### M6 · P2 · Rug reads as a board
Evidence: `diag/day-close-coffee-rug.png`, `day-window.png`. It is a flat-weave texture on a crisp 1.5 cm slab.
Fix: a pile normal at 2–3 mm, `sheen 0.6/0.9`, edge binding with a 3 mm roll, ±3 mm waviness near the corners, and a contact
darkening strip on the floor along the rug edge.

### M7 · P1 · Lamp shades glow flat white; lamp light schema
Evidence: `diag/evening-close-bed-lamps.png`, `diag/evening-close-dining-pendant.png`.
Emissive `glow 1.6` saturates through bloom into featureless white cylinders, and the fabric texture is lost.
Fix (`materials.js 'lamp-shade'`): glow 1.6 → 0.7. Emissive colour warmer (`#ffcf96`). A vertical emissive gradient
(brighter at bulb height, darker at the rims). Keep the linen map visible. Export `lights` as down/up spots per E6.
Pendant drum: a down spot with `shadow: true`.

### M8 · P2 · "Travertine" worktop reads as light wood / sandstone
Evidence: `diag/day-close-kitchen.png`. The bands are wavy like wood grain and the pits are too fine.
Fix: straighter, finer bands with ±1° wobble. Visible pits of 1–6 mm as darker voids. Ivory-beige palette (`#e3d6c0` /
`#cdbb9c`). Honed `roughness 0.45`.

### M9 · P2 · Leather armchair, plant, decor
Evidence: `day-living.png`, `diag/day-close-window-floor-junction.png`.
- Leather: smooth cognac panels. Add grain normal 0.6, `roughness 0.5`, `clearcoat 0.25/0.4`, darker creases at the channel
  seams (baked into albedo), slightly lighter edge wear.
- Plant: the soil is a flat grey disc (use dark-brown bark mulch + a few pebbles) and the pot is too clean. Leaves are
  fine; add slight back-light translucency (sheen tint `#b7cf8f` and two-sided normal flip).
- Front gaps on furniture (TV unit, nightstands) read as light lines (`diag/day-close-tvunit.png`). Same fix as E11.

### M10 · P2 · Sheer curtains
Evidence: `day-eye.png`, `diag/day-close-ceiling-corner.png`. Good folds and translucency. Uniform `opacity 0.55` reads as
tinted film at grazing angles. Real voile thickens at grazing angles and glows when backlit by sun. Fix: an alpha map with a
weave and slight density variation, `opacity 0.45` centre and denser hems. Add a weak emissive tint from the window side
(day only, sky colour × 0.1).

---

## Per time of day — exposure / WB summary

| TOD | Exposure | WB | Sun | Notes |
|---|---|---|---|---|
| morning | slightly hot; walls 188/165/145 | too peach (R/B 1.30) | az +40°, alt 17°: patch on west wall + bed, beautiful (`morning-bed.png`) | shade should be cool-blue |
| day | high-key, low contrast; window only ~1 EV over walls | mildly warm (R/B 1.21) | alt 41°: patch ~3 m deep, crisp mullions | needs E1/E4 |
| golden | flat peach everywhere incl. ceiling | strong orange cast (R/B 1.43) | alt 9°: sun on east wall with mullion + olive shadows, best frame (`golden-living.png`) | needs cool shade (E5) |
| evening | OK level, cozy | 2700 K good, slightly orange | — | lamps unshadowed (E6); sky brown not blue (E2); no glass reflections (E7) |

## Photo mode result (path tracer)

- Tested on `eye` / day at 1280×800. After ~60 s (`final/pt-eye-060s.png`) it is still very noisy, as expected on
  SwiftShader. It already shows the physically right picture: bright window, darker room, falloff toward the camera, crisp sun
  patch with the olive shadow. That is the look the raster should match (E1 table).
- Convergence trend: noise drops as expected for the first minute. Then the frame went almost black (`pt-eye-120s.png`) and
  stayed so, a robustness bug (E10), not a convergence trait. A GPU at 256–512 spp will be fine visually.
- Artefacts seen in PT only: the teal rail-glass band (E10 fix list). `PHOTO_EXPOSURE = 1.0` matches the window to raster
  but not the interior. Once E1 is fixed the two should agree, and then photo mode will look like a "developed" version of
  the live view instead of a different image.
- Recommended use now: path-trace `window` and `dining` at 256 spp on a real GPU once, as the **reference** for retuning
  E1 (probe TAIL, sky/sun ratio). Keep those two frames in `docs/reviews/` as calibration targets.

## Top 10 fixes (priority order)

1. E1 — rebalance GI: probe visibility + TAIL 0.3 + sky/sun ratio (sky −30 %, sun +25 %), validated against the PT. Gets falloff back.
2. E3 — GTAO: `depthPhi 0.06`, full-res on high, AO on indirect only. Removes the hairy halos.
3. E2 — replace the grey-box skyline with a photographic Dubai backplate (or glass towers with sky envMap); fix the night city.
4. E4 — Khronos Neutral (or AgX Punchy) + exposure targets; let the window glow, keep catalogue colours true.
5. E5 — camera white balance per TOD + cooler sky fill. Warm sun, neutral-cool shade.
6. E8 — two-point perspective (projection shift) + 24 mm horizontal FOV.
7. E6/M7 — lamp spots with shadows (honour `shadow:true`), drum cut-off, pendant pool on the table, dimmer shades.
8. M1/M3 (+M2/M4) — textiles: drape wrinkles, no hem tubes, matte cotton, tailored sofa. Marble with flat polished veins; large-scale paint variation.
9. E7/E9/M5 — glass without veil + night reflections. Floor sheen (clearcoat 0.3/0.3, box-projected env or SSR), longer planks.
10. E10 — never enable an empty probe grid (black indirect after context restore). Wait for real textures before the first bake. Make photo mode recover from context loss.

## Screenshot index (all under `/tmp/rev-render/`)
- Matrix: `{morning,day,golden,evening}-{eye,living,bed,dining,window,top}.png` (`morning-window.png` is black from a context loss; see `final/`).
- Close-ups: `diag/day-close-{sofa,sofa2,window-floor-junction,ceiling-corner,tvunit,coffee-rug,dining,kitchen}.png`,
  `diag/day-close-bed-noGTAO.png`, `diag/evening-close-{bed-lamps,dining-pendant}.png`, `diag/day-dining-AEoff.png`.
- Path tracer: `final/pt-eye-060s.png` (valid early frame), `final/pt-eye-120s.png` (went black), `photo/pt-*.png` (GPU crash).
- Broken-GI bug frames: `final/day-close-bed-GTAO-{on,off}.png`, `final/day-eye-neutralTM.png`. Night glass:
  `final/evening-window-glass.png`.
- Crops: **`crop-gtao-on-vs-off.png`**, `crop-golden-bed-bedding.png`, `crop-day-living-sofa.png`,
  `crop-evening-eye-window.png`, `crop-evening-dining-wardrobe.png`.
- Most telling four: `day-window.png` (flat GI), `crop-gtao-on-vs-off.png` (halos), `day-bed.png` (grey-box city +
  leaning verticals + foam bedding), `golden-living.png` (what already works: sun + mullion/olive shadows; also the peach cast).
