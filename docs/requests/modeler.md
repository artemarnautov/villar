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
