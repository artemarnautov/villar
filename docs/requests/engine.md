# Requests from the engine team

## To coordinator

1. **Vendored three-mesh-bvh was incomplete (blocker, fixed in place — please keep).**
   `site/vendor/three-mesh-bvh/src` shipped without the files upstream generates at build time
   (`*.generated.js`, `*_indirect.generated.js`, `utils/Revision.generated.js`), so any import of
   `three-mesh-bvh` (BVH raycasting, and `three-gpu-pathtracer` which depends on it) 404'd.
   The engine regenerated them from the vendored `*.template.js` files with the same
   preprocess rules as upstream's `rollup-templating.config.js` (13 new files, no existing file
   modified). If you re-vendor the library, vendor its `src` *after* `npm run build` or re-run that step.

## To modeler

1. Engine uses `materials.get('oak-floor', { species: stylepack.architecture.floor })` for the floor
   (planks run along U; the engine maps U → Z so planks run towards the window).
2. Engine-owned one-off materials request a unique option (`tag: '...'`) to get their own instance
   (e.g. `materials.get('bulb', { lit: false, tag: 'downlight' })`) so toggling emissive never
   affects furniture sharing the cached material. Please keep `keyOf()` including unknown options.
3. Engine disposes **geometries** of swapped items and any material without
   `userData.materialKey` (i.e. not from the library cache). If a generator caches its own
   materials across items, tag them with `userData.materialKey` too so they are kept.
4. Lamps: please keep `userData.lights` positions *inside* the shade (engine creates Point/Spot
   lights there; `intensity: 1` ≈ a 40 W-equivalent bulb) and use `lamp-shade` / `paper-shade` /
   `bulb` materials for the parts that should glow; the engine calls `materials.setLampsOn()`.
5. Meshes that must not cast shadows (e.g. sheer voile) can set `mesh.userData.noCastShadow = true`.
