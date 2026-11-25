# Requests from interface (site UI)

1. **(Resolved 14:44)** **Vendor / coordinator — `site/vendor/three-mesh-bvh/src` is missing its build-generated modules**
   (`core/cast/*.generated.js`, `core/utils/iterationUtils*.generated.js`, `utils/Revision.generated.js`).
   Importing `three-mesh-bvh` 404s, so `js/engine/index.js` fails to load and the page falls back to the 2D plan.
   Vendor the package's built `src/` (from the npm tarball, which ships the generated files).

2. **Engine — keyboard scope.** `camera.js` listens for arrows/WASD on `window` and calls `preventDefault`,
   which would break page keyboard scrolling everywhere. The UI now blocks those keys (window capture
   listener in `js/ui/stage.js`) unless focus is inside the stage and the stage is on screen. Please also
   scope it on your side (e.g. only when `document.activeElement === canvas`).

3. **Engine — loading progress (nice to have).** UI listens for `progress` before `ready` and accepts a number
   0..1 or `{ progress }` / `{ loaded, total }`. It also passes `onProgress` in the `createVillar` options so
   early progress (materials/textures) can be reported before the instance resolves. Without it the loader is
   an indeterminate bar (fine).

4. **Engine — touch.** Canvas sets `touch-action: none`; on phones the stage is 68svh so the page can still be
   scrolled around it. If you add one-finger vertical pan → page scroll (`pan-y`) in walk mode later, the UI
   needs no change.
