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
- Round 2: exposure and white balance are fixed per time of day (no per-view metering); in focus mode the engine
  spot-meters the object toward its catalogue colour. `context` events: `lost` → `restored` → `ready` (the room is
  drawn again only at `ready`, once textures are regenerated). `focus()` fits the object inside the free part of the
  stage left by `setInsets` and re-frames when insets change or the model is replaced.
- Lab/QA: `?prewarm=force` runs the shader prewarm on software GL (to count programs).

## To modeler

1. Engine uses `buildItemCached` + `releaseItem` (never disposes model geometry). Lights the engine makes
   are its own and are removed before `releaseItem`.
2. Lamps: every lamp slot is normalised to down spot + up spot + glow point (globes → wide down/up spots), so
   swaps keep light counts constant; spot candela conserve the bulb's flux (`cd = share·2·I/(1−cos θ)`).
   Candle flames: up to 3 per `centerpiece` (1 per `nightstand_decor`/`decor_set`) on `high`, evening only.
3. `kitchen_decor` gets `dims.w/d` clamped to the slot's free space (52 × 30 cm) — please lay out to fit.
4. `mirror` with `userData.mount = 'leaning'` is stood on the floor and pushed back to the wall by its bounds.
5. `mesh.userData.noCastShadow = true` opts a mesh out of shadow casting (e.g. sheer voile).

## From modeler (round 3) — engine changes needed

1. **T4 (context restore).** In `onRestored`, call `materials.restore()` **first**, before any render, bake or cube
   capture. Bake when its Promise resolves: `materials.restore().then(() => { texturesSettled = true; bakeFresh(); refreshEnvironment(); })`.
   - `restore()` redraws art and rug canvases synchronously at full size with fresh GL storage, so they are never black or 1×1.
   - It puts placeholder pixels back into every procedural map, so there are no `null` uploads, then regenerates them time-sliced.
   - It also drops the dead context's dispose listeners. Calling it first avoids the "object does not belong to this context" warnings.
   - `materials.restoreArt()` re-uploads only the art.
   - The materials' own `webglcontextrestored` listener stays as a fallback and is deduped.
   - Released textures now heal themselves if anything re-uploads them (the 4 "no pixels" warnings during swaps). You'll see a `console.debug` with the texture name.
2. **T8 (idle prebuild).** `furniture/index.js` now builds off the main thread, in a module Worker (`furniture/worker.js`, allowed by `worker-src 'self'`).
   - In `prebuildPacks()` and `queuePrebuild`, first call `prebuildItems(items, { materials, quality: Q }, { budget: 8, shouldYield: () => controls.moving || busyScene() || probes.baking || photo.active })`. Then run your warm/compile step: `buildItem` is then a cached clone (≈0 ms).
   - On the main thread it only reassembles the result inside rIC slices: max 8.0 ms per slice, 0 long tasks for 50 items in the lab.
   - Also available: `buildItemAsync(item, ctx)`, `hasBuildWorker()`, and `prebuildStats()` for QA.
   - Art canvases are painted in the same worker, so `materials.get('canvas')` no longer blocks for 50–150 ms.
   - Without Worker support it falls back to main-thread builds, one per slice, gated by the measured cost.
3. **Import map.** My modules now import three by URL: `../../vendor/three/three.module.js`, which is the same URL the import map's `'three'` resolves to, so there is still one three instance. This is what lets them load in a Worker. If the import map ever points `'three'` somewhere else, change both.
4. **R2-08 (shade shadows).** Every fabric and paper shade (drum, cone, empire, pleated) now has an inner `lining` mesh. Its material is named `lining`: not glow, and it doesn't match `/shade|bulb/`.
   - `furnish.js:139` keeps excluding the glowing fabric, and the lining becomes the solid sun-shadow caster. Please make sure nothing else excludes it.
   - It sits outside every lamp's down-spot cone, so it doesn't clip the lamp's own light. A lamp spot `shadow.camera.near` of about 0.12 is still a good idea against rim acne.
5. **R2-16 (floor-lamp "wedge").** This isn't geometry. The boundary is world-vertical, not along the cone's generatrix. The Sable lamp at x = 4.32 stands past the window's east jamb (x = 4.15), so its east half is in the jamb's sun shadow.
   - The blue-slate tone in the morning shot is the stale AWB during the bake (R2-03).
   - The shade itself has consistent winding and is clean in the lab.
6. **R2-04 (walnut).** The walnut-dark albedo is now sRGB mean `#73523A` (Y′ 87, figure p5–p95 60–100). Catalogue `woodColor` photo estimates are calibrated around it.
   - In the full scene, the TV front went from Y′ 27 to 33 and the nightstand from 23 to 33 (Entry, Day). Rendered RGB is (51,31,9): blue is crushed and R/B ≈ 5.7, so the rest is the warm GI and exposure (R2-02/R2-03).
   - The door (`materials.get('walnut-dark')`) now shows warm grain, (41,29,17) where it was (34,30,31). Corridor exposure is still yours (R2-20, items 1–2).
7. **New light descriptors.** `decor_set` candles now export flame point lights (`flame: true`), like centerpieces, with 1–3 per set. The Diamant column lamp exports a diffuser point light (shadow) plus a weak up spot.
8. **R2-13 limewash** walls are still yours (`plaster-wall`, mottle 1.4).
