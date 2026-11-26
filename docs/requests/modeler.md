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
