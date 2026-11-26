# Villar — the push to photoreal (founder request, 26 Nov)

The founder looked at the current render and says it is still not photoreal: "надо довести до реализма".
Round-2 render score was 6.0. Real-time raster with procedural geometry and canvas textures plateaus around
6.5–7. Every photoreal web configurator gets past that the same way, and this plan follows it.

## The four levers (in order of impact per day of work)

1. **Path-traced stills on idle (engine).** Motion is real-time raster. When the camera rests
   (≥ 700 ms, no dissolve or flight in progress, page visible, desktop high tier), progressively path-trace
   the same frame with `three-gpu-pathtracer` (already vendored; `photo.js` has the pipeline + denoiser). Blend in
   over raster (WebGLPathTracer `renderDelay`/`fadeDuration`/`minSamples`). Any input cancels instantly and
   returns to raster with no pop. This gives true multi-bounce GI, soft area shadows, contact darkening,
   glossy reflections and colour bleeding, which are exactly the cues that read as "photo".
   - Budget: first useful image ≤ 1.5 s, clean (denoised) ≤ 6 s on a 2020+ laptop GPU. Tiles + `renderScale`
     adaptive so the UI never drops below 30 fps while refining; pause while HUD panels animate.
   - Emissive lamp shades + spot/point lights must match raster brightness (no exposure jump on blend). Same
     AgX/Neutral tone map and exposure as raster. Sun as a physical directional light with soft angle (~0.5°).
   - Phone/iPad/low tier: off (raster only), unless the device proves fast (measured samples/s) and is plugged in.
   - Focus mode and the dollhouse refine too. Thumbnails stay raster.
2. **Photoscanned materials (modeler).** Replace canvas-procedural albedo/normal/roughness with CC0
   photoscanned PBR sets (1K, 2K on high), one per material family: walnut / light oak / teak veneers, linen,
   bouclé, velvet, cotton percale, jute/flat-weave rug, wool pile rug, travertine, marble, ceramic glaze,
   limewash and painted plaster, brushed brass, black metal, glass, rattan/cane, paper shade, leather.
   Keep catalogue colours by tinting the scanned albedo (luminance-preserving), so every item still matches
   its card. Source only CC0/public-domain sets reachable from GitHub (`git clone --filter=blob:none --sparse`).
   Record the source and licence of every file in `site/assets/materials/LICENSES.md`. KTX2 or JPEG; total
   ≤ 25 MB lazy-loaded per style, ≤ 8 MB on low tier.
3. **Geometry that catches light (modeler).**
   - Bevel every hard edge (2–6 mm radius) so it catches a specular line.
   - Pillowy cushions with seams and piping; real curtain folds with sine pleats (not stripes).
   - Rug pile and fringe; slight sag on seat cushions; rounded tabletop edges.
   - Plants: use high-quality CC0 scanned models (glTF) or highly detailed procedural leaves with
     translucency. A plant is the #1 CG tell.
4. **The window (engine).** Replace the grey-box city with a photographic backplate per time of day:
   a real equirectangular HDR/EXR sky + skyline from a CC0 source, with the sun direction matched. Treat it as
   the light source for the path tracer (environment importance sampling). Night: a real night HDR.

## Acceptance (render reviewer, round 4)
- Blind test: 6 Villar frames (4 styles, Day/Sunset, Entry + Living) mixed with 6 real interior photos of similar
  rooms at similar resolution. The reviewer scores "photo or render" and realism 1–10 per frame. Target: Villar
  frames average ≥ 8.5, and at least 2 of 6 mistaken for photos.
- No regressions: style switch, swap and focus stay seamless; no long task > 100 ms on interaction (GPU path);
  phone raster quality ≥ round-3 level.
