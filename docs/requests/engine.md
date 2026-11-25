# Engine team — requests & notes

## To coordinator

1. **Vendored three-mesh-bvh was incomplete (blocker, fixed in place — please keep).**
   `site/vendor/three-mesh-bvh/src` shipped without the files upstream generates at build time
   (`*.generated.js`, `*_indirect.generated.js`, `utils/Revision.generated.js`), so any import of
   `three-mesh-bvh` (BVH raycasting, and `three-gpu-pathtracer` which depends on it) 404'd.
   The engine regenerated them from the vendored `*.template.js` files with the same preprocess
   rules as upstream's `rollup-templating.config.js` (13 new files, no existing file modified).
   If you re-vendor the library, vendor its `src` *after* its build step.
2. **Layout refinements** (`site/data/layout-studio.json`, slot ids/types unchanged):
   - bath door moved to `center: 0.55` on `bath-east` (it was behind the wardrobe);
     wardrobe now `x 2.05–2.67, z 1.00–2.60, h 2.55` (flush with the partition and the bulkhead);
   - new `bulkhead` (dropped ceiling 2.55 m over entry/kitchen; the two corridor downlights sit in it),
     AC grille moved onto its front face;
   - `slidingDoorPane: 1` = middle pane (0-based, panes ordered along the wall — see `_notes`);
   - views `living`, `bed`, `dining`, `window` moved off furniture footprints (camera collides);
   - curtains slot `z 8.92` (tight to the glass).
3. Store contract change is handled: swaps rebuild only `event.slots` (+ attached children);
   `build()` uses `store.selected(slot.id)`.

## To interface

- `createVillar(opts)` extra options (all optional): `onProgress({progress 0…1, stage})` loading
  callback (stages: modules → scene → textures → lighting → ready), `palette`, `timeOfDay`, `view`,
  `quality`, `adaptive` (auto DPR/tier), `gi` (baked GI volume), `autoExposure`, `toneMapping`.
- Events: `ready {quality,time,view}`; `hover`/`select` `{slotId, slotType, item, x, y}` or `null`;
  `progress {samples, target}` (photo); `photo {state: preparing|started|done|stopped|error}`;
  `time {time}`.
- `villar.ready`, `villar.view`, `villar.timeOfDay`, `villar.photoActive`, `villar.snapshot()` (data URL).
- `ready` fires after real textures + baked lighting (first *good* frame); a preview frame is on
  screen earlier. Any drag/key/wheel or store change stops photo mode.

## To modeler

1. Floor: `materials.get('oak-floor', { species: stylepack.architecture.floor })`; planks run along U,
   the engine maps U → Z so planks run towards the window.
2. Engine-owned one-off materials request a unique option (`tag: '...'`) to get their own instance
   (e.g. `materials.get('bulb', { lit: false, tag: 'downlight' })`). Please keep `keyOf()` including
   unknown options.
3. On swap the engine disposes geometries and any material *without* `userData.materialKey`.
   If a generator caches its own materials across items, tag them with `userData.materialKey`.
4. Lamps: `userData.lights` inside the shade, `intensity: 1` ≈ 40 W-equivalent; the engine creates
   Point/Spot lights and calls `materials.setLampsOn()` for the evening.
5. `mesh.userData.noCastShadow = true` opts a mesh out of shadow casting (e.g. sheer voile).
6. Engine clamps any item taller than the ceiling (curtains with 300 cm drops are scaled to
   2.84 m). If you'd rather pool the hem on the floor, generate curtains to `ctx.span`/room height.
7. Scene is ~700 k triangles with the real catalogue; the plant/bedding/boucle meshes dominate.
   An LOD or lighter variant for the heaviest generators would help phones.
