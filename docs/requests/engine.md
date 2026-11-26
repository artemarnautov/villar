# Engine team — requests & notes

## To coordinator

1. **Vendored three-mesh-bvh was incomplete (fixed in place — please keep).** `site/vendor/three-mesh-bvh/src`
   shipped without the files upstream generates at build time (`*.generated.js`, `utils/Revision.generated.js`).
   The engine regenerated them from the vendored `*.template.js` (13 new files). Re-vendor `src` *after* its build.
   The engine now imports `three-mesh-bvh/src/utils/ExtensionUtilities.js` directly (fewer modules on load).
2. **Layout** (`site/data/layout-studio.json`; existing slot ids/types unchanged):
   - Phase 2 slots: `tableware`, `centerpiece` (dining table top), `kitchen_decor` (worktop, between sink and
     hob; `mount: "worktop"`), `throw` (sofa `throw_arm_r`), `nightstand_decor` (nightstand_l top, outboard of
     the lamp), `runner` (entry corridor), `mirror` (free entry wall east of the door, `mount: "wall"`).
   - Kitchen: sink 1.95 / hob 3.02 (was 2.05 / 2.75) → a real 54 cm free worktop zone between them.
   - QA-06: `coffee_table.align = { to: "sofa", gap: 0.47 }` — the table is placed 47 cm from the *real* front
     of whichever sofa is chosen, and glides to its new spot on a sofa swap.
   - QA-07: bedroom run re-spaced (nightstand_l 6.25, bed 7.45, nightstand_r 8.61, art 7.45), plant 2.66/8.45,
     curtains span 3.8 m; and every floor item is clamped off walls and the curtain stack by its real model
     bounds at placement (≤ 1 cm gap), so oversize models (swing-arm lamp, deep sofas) no longer clip.
   - Entry door `finish` removed: the door finish comes from the active pack (`architecture.doorFinish`).
3. **Deploy set**: see the engine's milestone report (it lists the exact files).
4. **Harness note:** since the sandbox image changed, headless Chromium drops `--use-angle=swiftshader` unless
   `CHROMIUM_KEEP_GL_SWITCHES=1` is set; WebGL then runs on llvmpipe (Vulkan). The engine treats both as software GL.
5. **CSP:** `/lab/engine.html` now uses the byte-identical import map of `index.html` and an external
   `/lab/engine-lab.js`, so it runs under the production CSP (the old inline script was blocked).

## To interface

- `createVillar(opts)` options (all optional): `onProgress({progress 0…1, stage})`, `palette`, `palettes`
  (by pack id; optional — style transitions read `store.style(id).architecture`), `timeOfDay`, `view`, `quality` (capped by device: phones → low,
  tablets/iOS → medium; `forceQuality: true` to override), `adaptive`, `gi`, `autoExposure`,
  `toneMapping` (`neutral` default | `agx` | `agx-punchy` | `aces`), `autoFocus` (default true).
- Events: `ready {quality, time, view, gi, photo}` (`photo: false` → hide Фото: low tier or software GL);
  `hover` / `select` `{slotId, slotType, item, x, y}` or `null`; `focus {slotId|null}`; `view {view|null}`
  (`null` = free camera after drag/walk); `time {time}`; `progress {samples, target}`;
  `photo {state: preparing|started|done|stopped|error}`; `context {state: lost|restored}` (transient);
  `fatal {reason}` — the context did not come back within 5 s: show the 2D plan.
- Focus: `villar.focus(slotId, { inset: { bottom, right } })` flies (~0.9 s) to a collision-safe 3/4 view of
  the object; drag orbits around it, wheel/pinch changes distance. `villar.unfocus()` (also Esc on the canvas,
  or a click on empty space) flies back. With `autoFocus` a click on an item focuses it by itself.
- `villar.setInsets({ bottom, right })` (CSS px of stage covered by the sheet/panel) — eased; the object stays
  centred in the uncovered part. Call on sheet open/resize/close.
- `villar.thumbnail(itemId, { size })` → `Promise<dataURL>` (JPEG, `#f2efe8` backdrop, 3/4 view, cached).
- `villar.prebuild(slotId)` — build that slot's alternatives in idle time (also done on focus).
- Keys (WASD/arrows) act only while the canvas has focus; the wheel zooms only after the stage was clicked
  (or with ⌃/⌘). The canvas shows a focus ring for keyboard focus only.
- `villar.view` is `null` while the camera is free.

## To modeler

1. Engine uses `buildItemCached` + `releaseItem` (never disposes model geometry). Lights the engine makes
   are its own and are removed before `releaseItem`.
2. Lamps: every lamp slot is normalised to down spot + up spot + glow point (globes → wide down/up spots), so
   swaps keep light counts constant; spot candela conserve the bulb's flux (`cd = share·2·I/(1−cos θ)`).
   Candle flames: up to 3 per `centerpiece` (1 per `nightstand_decor`/`decor_set`) on `high`, evening only.
3. `kitchen_decor` gets `dims.w/d` clamped to the slot's free space (52 × 30 cm) — please lay out to fit.
4. `mirror` with `userData.mount = 'leaning'` is stood on the floor and pushed back to the wall by its bounds.
5. `mesh.userData.noCastShadow = true` opts a mesh out of shadow casting (e.g. sheer voile).
