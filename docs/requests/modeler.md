# Modeler: requests and notes

Owner of `site/js/engine/materials.js`, `textures.js`, `furniture/*`, `site/lab/furniture.html`.

## To engine

1. **Light descriptors are in RADIANS (SPEC, E7).**
   `group.userData.lights[]` entries look like `{ type: 'spot'|'point', position, target, angle, penumbra, color, intensity, distance, decay, shadow }`. They use metres in the item's local frame. `angle` is the spot **half-angle in radians** (three.js `SpotLight.angle`); please stop multiplying it by `DEG` in `furnish.js`.
   - **Shaded lamps:** a down spot (70 %, `shadow: true`), an up spot (30 %), and a weak glow point (10 %, `distance` 1.2).
   - **Pendant drums/cones:** a down spot (angle 0.96, `shadow: true`).
   - **Globes:** one point light.
   - `target` is set for every spot and is transformed with the item fit.
   - **Candle flames:** centrepiece candles export tiny point lights with `flame: true`. Enable them only at night. Their flame material is hidden while lamps are off (`setLampsOn`).
2. **Floor:** `materials.get('oak-floor')` defaults to clearcoat 0.3 / clearcoatRoughness 0.3, matching your floor-reflection work. Both values can be overridden: `get('oak-floor', { clearcoat, clearcoatRoughness })`.
3. **Ceilings:** use `materials.get('paint', { color, mottle: 0.4 })`. Walls get `mottle` 1 by default; `plaster-wall` uses 1.4.
4. **Texture memory:** CPU pixel data is released after GPU upload. On `webglcontextrestored`, materials regenerate the textures by themselves.
   Tools that read `texture.image.data` must call `setKeepTextureData(true)` from `textures.js` first.
5. **Throw anchor (Phase 2).**
   - Sofas and upholstered armchairs export `throw_arm_r`, `throw_arm_l` (arm-top centre) and `throw_back` (top of the back, left third), plus `anchorInfo[name]`.
   - To attach a `throw` item at one of those anchors, call `buildItem(throwItem, { materials, host: parent.userData.anchorInfo[name] })`.
   - The throw's `params.drape` (`arm` | `back` | `folded`) or `host.mode` selects the shape. Suggested default: `throw_arm_r`. Use `throw_back` when the throw's drape is `back`.
6. **Tabletop details (Phase 2).** `tableware`, `centerpiece` and `nightstand_decor` attach at the host's `top` anchor.
   - For `tableware`, pass `host = parent.userData.anchorInfo.top` (`{ w, d }`).
   - Place settings face ±X by default, which matches the studio's chairs at x 0.42 and 1.58 around the table at x 1.0. Use `params.axis: 'z'` if the chairs are along Z.
   - `kitchen_decor` origin is the worktop surface, with its back (−Z) to the wall. It lays itself out inside `dims.w × dims.d` and keeps real object sizes, so it is not scaled.
7. **Mirrors (Phase 2).** `group.userData.mount` is `'wall'` or `'leaning'`.
   - **wall:** origin is the centre of the back face, the same as `wall_art`.
   - **leaning:** origin is the bottom-centre of the bbox, leaning back 7°. The bbox depth is about h·sin 7°, so put its back at the wall using the bbox.
   - The glass is a metal-1 / roughness-0.015 mirror and reflects your env map. No Reflector is needed.
8. **Seamless swaps: build cache (Phase 2), exported from `furniture/index.js`.**
   - `buildItemCached(item, ctx)` takes the same arguments as `buildItem` and returns a cheap clone that shares geometry and materials.
   - `releaseItem(group)`: call this on removal instead of disposing the geometry.
   - `prebuildItems(items, ctx, { budget: 8 })` warms the cache in idle slices. Use it for the selected slot's alternatives and the next style pack.
   - `clearItemCache(materials?)` and `setItemCacheSize(n)` (default 64 idle entries).
   - Builds are deterministic (seeded by `item.id`), so a cached prototype is identical to a fresh build. The cache key includes `ctx.quality`, `host`, `span` and `seed`.
9. **LOD:** pass `ctx.quality` (`'low'` | `'medium'` | `'high'`). Segment counts drop to about 40 % / 60 %, and plant leaf density to 34 % / 58 %. Texture resolution follows the quality tier set when the material library is created.

10. **Round 3 (see `docs/requests/engine.md`, "From modeler (round 3)").**
    - T4: call `materials.restore()` first on a context restore.
    - T8: `prebuildItems(items, ctx, { budget: 8, shouldYield })` builds in a Worker. Also `buildItemAsync`, `hasBuildWorker`, `prebuildStats`.
    - R2-08: the shade `lining` mesh is the shadow caster.
    - The fit guard: a generated bbox is never stretched by more than ×1.6 or less than ×0.5 per axis. It logs `console.debug` instead; that is what turned the Malta top into a block.
    - `decor_set` / `nightstand_decor` now fit uniformly and are never enlarged.

## To catalog — round 3 (fields the 3D now reads; no data change required)

- **Kitchen / tableware / centerpiece:** the structured params you already ship are mapped onto the generators (PT-04). The materials text decides what each object is made of. You don't need to change anything.
  - Kitchen: `kettle|crock|board|bottles|tray: { color, material?, kind?, lean? }` and `colors: { kettle, crock, board, oil, bowl }`.
  - Tableware: `plate|plates|sidePlate|bowl|glass|cutlery|napkin: {…}`.
  - Centerpiece: `kind`, `vase: { shape, color, height }`, `stems: { species, count, color, length }`, `candles: { count, color, heights, diameter }`, `tray: { material, color, shape }`.
  - Materials text examples: "Matte black kettle" → black electric kettle; "Wooden utensil caddy" → wooden caddy; "Acacia / Dark wood board"; "Ceramic oil bottle"; "Wooden bowl"; "Wood-handled cutlery"; "Smoked / Amber glass".
  - The kitchen set is packed collision-free into the 52 × 30 cm zone at real sizes.
- **Cane:** cane, rattan, wicker, ротанг, плетён and венск are all recognised.
  - Armchair: `seat|back|fabric = cane` → frame-and-cane chair (`frame`, `woodColor`, `caneColor`, `legs: wood-splay`, `arm`).
  - Sofa: `armPanel: rattan|cane` → open oak arm frames with cane on the outer and inner faces (`armPanelColor`).
  - Dining chair: `back: cane` (`caneColor`), `seat: cord|paper|rattan` + `backStyle: y-splat` → paper cord. Bed `headboard: cane`, tv/nightstand `fronts: cane`.
- **Floor lamp:** `shade: column` (or `stem: column` + shade column) → paper-cord column lamp. `shadeMaterial: paper` glows evenly.
- **Pendant:** `trimColor` that is light (HSL l > 0.55) → linen tape trim; dark → leather.
- **Wall art:** motifs `relief-waves|dune|sand`, `amphora|vase|urn`, `abstract-shapes` (soft composed), `textured-*` (tone-on-tone plaster). `panels: [[w,h],…]` + `gap` → one painting across a triptych. `mirrored: true` → the same painting flipped. The image is a function of motif + colours, so a pair matches.
- **Plant:** `pot: ribbed | glazed-ribbed` → vertical ribs.
- **Decor items:** `box` (takes its material hint: leather/wood), `bud-vase`, `sprig` (goes into the preceding vase), `candle` / `candles` (wax in its colour, flame at night), `tray`. Material hints shorter than the item list are matched by affinity: stone/wood → tray, terracotta → the terracotta-coloured piece, wood → the darkest piece.
- **Throw:** `fabric: cotton-weave | dense | textured` → open ≈3 mm cotton weave (`fabric-weave`); `waffle` → waffle knit; `fringe: true` → tassel strips on both ends.

## To catalog (new params; also documented in the `furniture/index.js` header)

- **Woods:** `ash-light` and `oak-white` (white-oiled) are new furniture woods. Free text also resolves: "ash", "bleached/white oak", "ясень".
  - Brushed brass is `metal-brass-brushed` ("brushed/satin/antique brass").
  - New stones and ceramics: `terrazzo` (opts `base`, `chips[]`), `terracotta`, `stoneware`.
  - Washed linen is `fabric-linen-washed`.
- **tableware:** `material`, `colors[]`, `rim` (coupe | rimmed | flat | organic), `bowl`, `glass` (tumbler | wine), `cutlery` (steel | brass | black | wood), `napkinColor`, `placemat` (none | linen | jute | rattan | leather | round-jute), `axis`.
- **centerpiece:** `style` (vase | candles | bowl).
  - vase: `vase`, `vaseMaterial`, `stems` (olive | eucalyptus | pampas | tulip | ranunculus | grass).
  - candles: `count`, `holder` (tray | plate | candlesticks), `holderMaterial`.
  - bowl: `fruit[]`.
- **kitchen_decor:** `items[]` (board | crock | kettle | bottles | fruit-bowl | canisters), `kettleMaterial` (steel | matte-white | matte-black | brass), `crockMaterial`, `board`, `fruit[]`.
- **throw:** `fabric` (knit | linen | washed-linen | wool | boucle), `color`, `drape` (arm | back | folded), `fringe`. `dims` is the unfolded size.
- **nightstand_decor:** same as `decor_set`; default items are `['books', 'vase-round']`.
- **runner:** same as `rug`; default pattern is `double-border`, fine weave.
- **mirror:** `shape` (round | oval | arch | pill | rect | organic), `mount` (wall | leaning), `frame` (any material key or `none`), `frameWidth`, `frameColor`.
- **sofa:** `shape: 'curved'` (organic arc, plinth). `modular: true` gives separate blocks; `arm: 'block'` adds end blocks.
- **bed:** `style: 'platform'` gives a Japandi low deck. `headboard` takes wood-panel | slatted | cane | upholstered; `sideShelves` is a bool.
- **dining_chair:** `seat: 'paper-cord'` gives a woven Danish-cord seat. Rattan on a `backStyle: 'y-splat'` chair is also treated as cord.
- **plant:** `species: 'snake-plant'` now renders Laurentii banding with a yellow margin, and monstera leaves are cordate with fenestration slots.

## From engine (round 2, milestone A)

1. **R2-04 walnut.** With the engine's GI fixed (neutral shade, R/B 1.12 by day), the Dark Walnut TV unit measures
   Y′ 42 (58,39,19) at Entry/Day — target 45–65 (palette `#553C2C`). Please lift `walnut-dark` as the render review
   suggests (light `#7a5a43`, mid `#5a4030`, dark `#3a2a1f`, streak `#86664c`, less chroma in the dark tone).
2. **T4 context restore.** The engine now draws nothing after `webglcontextrestored` until `materials.pending()`
   reaches 0 (so no 1×1 storage is allocated from released copies) — verified: no `texSubImage2D: no pixels`, art and
   walls intact. Please still make `restoreTextures()` robust on its own: `t.dispose()` before re-assigning `image`,
   and keep `{ width, height }` on released canvases (drop only the pixels). An optional `materials.restore()` is
   called by the engine if present.
3. **Upload warnings in normal use.** 2 × `glTexSubImage2D: Offset overflows texture dimensions` appear during a
   time-of-day switch (no context loss) — some released texture is re-uploaded with a different size. Please log
   `t.name` in `onUpdate` when `image.data === null` to find it.
4. **Shade shadows (R2-08, milestone B on our side).** The engine will let shades cast sun shadows and push lamp
   shadow `near` past the shade; please keep only the bulb mesh `noCastShadow`, the shade opaque/translucent.

## Photoreal (lever 2 + 3) — modeler notes for catalog / engine

- **No catalog change is needed.** Every material key keeps its meaning and its colour parameters; the photoscans are tinted
  to the same catalogue colours (wood: species mean + `woodColor` calibration as before; fabrics / leather / rugs / plaster:
  grey scan detail × the item colour; stone: the scan's colour pulled toward `match`).
- **Scanned sets** (CC0, `site/assets/materials/`, sources in `LICENSES.md`, rebuilt by `tools/materials-prep.mjs`):
  walnut, oak, white oak (also ash / black ash), teak veneers; wide-plank oak floor (2K); linen, bouclé, velvet, percale,
  leather; pile, flat-weave and jute rugs; travertine, marble; painted plaster / limewash; woven rattan; olive bark; a
  lanceolate leaf atlas. Procedural stays for: cane, rattan binding, knit, waffle, voile, paper / lamp glow, metals, glass,
  ceramics, terrazzo, kitchen fronts, chevron floors.
- **Plants:** all leaves are translucent against the light and have a distinct underside; the olive uses the scanned leaf
  (alpha outline, silver underside) and scanned bark.

## Engine → modeler (photoreal round, 26 Nov)

1. **`glTexSubImage2D: Offset overflows texture dimensions` (UI report) — not reproducible on the current tree.**
   I hooked `texStorage2D` / `texImage2D` / `texSubImage2D` (per bound texture: allocated size vs upload rectangle) and
   ran lab Day → Sunset → Evening → Morning plus the real index flow (HUD on the sofa with 7 thumbnails →
   Mediterranean wave → Evening → Sunset, scan sets loaded): **0 overflowing uploads, 0 WebGL warnings**. Your
   `tclone` (keeps the Source version) and `shareTexture` changes appear to have removed it.
   - The mechanism that produced it: a second GL texture for the same `Source` (a clone with another sampler cache
     key) gets its first upload while the canvas is released (1×1), so its storage is 1×1. `healOnUpdate` then
     redraws the original and `reallocate()`s only the original. The clone's 1×1 storage survives, and the
     full-size redraw is sub-uploaded into it.
   - To close it for good: in `healOnUpdate(tex)`, also `reallocate(tex)` (the texture whose upload triggered the
     heal), not only the original in `HEAL`.
   - Hook for QA: `/tmp/eng/tools/gl-hook.js` (an `addInitScript`; it records offending uploads in
     `window.__texOverflow`).
2. **Sky files.** `site/assets/sky/*.hdr` (engine) are listed in `site/assets/materials/LICENSES.md` under "Skies". I
   appended that section and did not touch your rows.
- **Round-3 asset tells (R3-06/07/08/10) done in the modeler's files:** darker scanned olive bark (albedo ≈ #5a5246); matte
  scanned percale (roughness 0.88, weave normal), crease dent removed, turn-down resting on the duvet with an 8 mm edge; rattan
  shades woven (scan + alpha gaps, light through) with the wire spikes removed (dome / bell / globe shades hang from one inner
  stem); candle flames are self-lit additive teardrops with a hot core; amber glass transmits `#c58a3e`; travertine uses the
  scanned vein-cut slab (elongated voids along the banding, uniform honed roughness 0.45, no pit sparkle); leather has scanned
  grain (normal 0.6, roughness 0.5); bouclé loops ≈ 5–8 mm (was ≈ 1.5 cm cells); limewash is its own scanned set.

## Engine → modeler (round 4: R4-07 photoscan GPU memory, 27 Nov)

The coordinator let me edit your `textures.js` / `materials.js` for this; here is what changed so you can review it:
- `textures.js`:
  - Every Texture on a scan set's Source is now tracked: the set's own maps, `shareTexture()` copies and
    `trackScanClone()` for clones made elsewhere.
  - New exports: `scanSets()` (`[{ id, size, evicted, bytes }]`), `scanIdOf(texture)`, `evictScanSet(id)` (disposes
    every tracked Texture of the set, so three frees the GL texture) and `restoreScanSet(id)` (the T4 re-decode
    from the kept blob; it returns a Promise).
  - The per-set `regen` now returns that Promise and clears the evicted flag on any path, including heal and
    context restore.
- `materials.js`:
  - `tclone()` calls `T.trackScanClone(t, c)`.
  - The scan tier is now `quality === 'high' ? 2048 : 512`, so medium (tablets) gets 512 instead of 1024.
  - `createMaterials()` exposes `scanSets`, `scanIdOf`, `evictScanSet` and `restoreScanSet`.
- The engine (`index.js`) sweeps every 20 s. A set no scene material has used for 2 min is evicted. Before anything
  is shown (swaps, style waves, door and wall dissolves, thumbnails), its evicted sets are restored, and the object
  stays hidden until they are back.
- **Please keep this in mind:** if you clone a scan texture anywhere else (`texture.clone()`, `new Texture()` on its
  source), call `trackScanClone(orig, clone)`. An untracked clone keeps its GL texture alive, so the set's memory is
  never freed (nothing breaks).
- **Not done** (still open from the review):
  - Roughness as `RedFormat`. three's `roughnessmap_fragment` reads `.g`, so an R8 map would read 0 unless the chunk
    is patched; I didn't change it.
  - KTX2.

## Round 4 (R4-05/06/10/11/13), modeler side. No catalog change needed

- **Bedding:**
  - Percale is a 0.5 m tile: the poplin scan plus a periodic crumple of 3–16 cm micro-wrinkles in the normal map.
  - The duvet has 46 soft rumples (10–25 cm) on top of the long creases, on a 120 × 100 grid.
  - The turn-down hem is 4 mm, and its rim shades like the duvet, so there is no hairline.
  - The throw slab reaches into the duvet instead of floating, so its edges show no dashed gaps.
  - Pillows have a lens section, concave sides, corner creases and a crisp seam.
- **Sofa cushions:**
  - Seat crown +2.2 cm, sat-in −1.3 cm.
  - Back cushions sag 2.4 cm and are plumper.
  - Scatter cushions get the new pillow shape.
- **Throws:** they lie 11–15 mm thick (folded double), with real rolled hems (outward half-round, analytic normals),
  and bridge the arm edges with soft ≈ 3 cm folds.
- **Limewash:** ±5 % around the wall colour, with no stains or pits.
- **Rattan shades** glow through the weave at night.
- **Alpha-cut items** (cane, rattan, fringe, olive leaves) cast dappled shadows.
- **Amber glass** has a clear skin and an amber body.
- **The kitchen sink** geometry is ready in `furniture/fixtures.js`; the engine integrates it.
