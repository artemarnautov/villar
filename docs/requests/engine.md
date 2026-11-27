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
- Events: `ready {quality, time, view, gi, photo, refine}` (`photo: false` → hide Фото: low tier or software GL);
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
- Round 2, milestone B:
  - `villar.setLabel(text)` sets the canvas accessible name (call it on language change, PT-05).
  - Posters per style, rendered by the engine from the exact Entry pose and lens at 1552×780:
    `/assets/posters/{dark-walnut,light-oak,greige-luxe,mediterranean}.jpg`. Pick by the saved style before first
    paint and cross-fade to the canvas (~300 ms) at `ready` (PT-16). The lens is fixed at 74° horizontal on any
    landscape stage, so `object-fit: cover` on the poster matches the live framing.
  - Thumbnails render only while the camera and dissolves are idle, one per idle slice (T7) — request them freely.
  - The focus halo fades out ~1.2 s after a flight lands; the canvas focus ring shows only for keyboard focus.
- Focus v2 (docs/FOCUS.md §1–2, §4), engine side:
  - **Flights** are critically damped springs of 550–700 ms, scaled by distance. A new `focus()` mid-flight keeps
    the current velocity, item → item glides without zooming out, and `unfocus()` returns to the view you came from.
  - **Framing:** the item fills ~55 % of the free height or 60 % of the free width, centred in the free area
    (lens shift), from the ¾ beauty angle (27.5° off its front) at 17.5° elevation (eye level for tall items).
    It falls back to other angles, heights or closer when something is in the way.
    `villar.debug.controls.state.focusInfo` reports the chosen pose.
  - **Spotlight:** while focused, the room renders −0.3 EV with a soft blur; the item keeps its light and colour.
  - **Turntable:** a horizontal drag on the stage turns the focused item (and what sits on it) about its footprint
    centre. Gain: 1.2 stage widths = 360° (mouse), 1 width = 300° (touch).
    - Release: inertia from the last 80 ms, velocity halves every 120 ms, then a critically damped settle on the
      nearest 45° rest angle, plus an 8 ms vibrate tick.
    - Away from home, the room dims to −0.7 EV and the item is drawn over it with a contact shadow, so it never clips.
  - **Tilt and zoom:** vertical drag tilts 5–45° and wheel/pinch zooms 0.7–1.6×, both rubber-banded at 0.35 and
    sprung back on release.
  - **Reset:** double-click or double-tap on the stage, or `villar.inspectReset()`.
  - **Leaving and swaps:** leaving, or swapping the focused item, springs it home in 400 ms (the swap waits for that).
  - **Keys** (canvas focused, item focused): ←/→ rest angles, ↑/↓ tilt, +/− zoom, 0 reset, [ ] previous/next
    item, Esc leaves.
  - **Walk order:** `villar.focusNext(±1)` steps left → right as the items were on screen when focus was entered,
    then continues round the room and wraps. It also emits `select` like a click.
  - **Events and state:** `inspect { slotId, angle (−180…180, 0 = home), atRest, home }` fires while the angle
    changes; `villar.inspect` returns the same snapshot.
- Round 4 (tech review):
  - **R4-05:** each slot group has at most one dissolve. A later wish (another style click, a slider step,
    Reset/Undo) waits for that dissolve and then rebuilds from the store's current selection. Every `applyPlan`
    origin (`budget`, `reset`, `restore`, `undo`) uses the slider's capped queue: 8 at a time, starts 45 ms apart.
  - **R4-06:** the slider warm-up builds exactly the active style's ladder items (`core/budget.js` plus pins, nearest
    step first). It re-runs on every style switch and `pins` change. The engine fetches `/data/budget.json` itself;
    pass `createVillar({ budget: data.budget })` to skip that fetch.
  - **R4-07:** photoscan sets unused for 2 min leave the GPU and come back before anything shows them. Medium tier
    loads 512 scans. `villar.debug.scans` → `{ sets, resident, mb }`.
  - **R4-09:** with `?pt=on`, a still is dropped when the scene changes without input (a scan or facade landing, a
    wall animation). Refinement doesn't start while textures are still loading.
  - **R4-10:** reserve (empty-slot) lamp lights only take a shadow slot when there are fewer real lamps than slots,
    and then with a 1 × 1 map rendered once.
- Idle refinement: the scene BVH is now built in a module Worker (`vendor/three-mesh-bvh-worker`: a worker-only
  copy of three-mesh-bvh whose imports point at the three URL). While the snapshot builds, the held raster frame
  stays on screen, so the path tracer's physical scene state is never drawn. Any input restores the scene at once.
  It is still opt-in (`?pt=on`) until the coordinator turns it back on.
- City: photographic CC0 facades (ambientCG) on the towers, darker gravel roofs with rooftop plant, and lit-window
  night facades. `/assets/city/*.jpg` (654 KB) loads after start; the procedural stand-ins show until then.
- Budget slider (docs/BUDGET.md), engine side:
  - `'change'` with `itemId: null` dissolves the model out, and null → item dissolves it in. Empty slots are
    skipped at load. An attached item whose host is empty is never placed.
  - `'plan' {reason: 'budget'}` bursts are coalesced per slot (latest wins). A slot that is mid-dissolve is rebuilt
    from the store's current selection when its dissolve ends. At most 8 slots dissolve at once, nearest first,
    with starts 45 ms apart. A host carries its attached items in the same rebuild.
  - GI re-bakes local probes once, after ≥ 350 ms with no plan event and only when not dragging. Lab, 11-plan
    drag: 0 bakes during the drag, one local bake after release.
  - `villar.setDragging(true|false)`: call on slider grab / release. While held, the engine defers thumbnails,
    bakes and idle refinement, and the camera ignores input. Please still `unfocus()` on grab.
  - Lights: an empty lamp or candle slot keeps a zero-intensity copy of its light set, so the evening light
    count stays the same (18 in the lab from the minimum room to the premium room) and no programs recompile.
  - The active pack's slider options are built off-thread and compiled (both light sets plus dissolves) in idle
    time after ready, and again after each style switch. A drag then only clones cached models and finds
    compiled programs. This needs parallel shader compile; on other browsers it runs as synchronous idle slices.
- Round 3 (focus + exposure):
  - `focus()` fits the object's actual box, not its bounding sphere, into the free part of the stage, so a sofa
    behind the HUD at 1280×800 is now shot from ≈ 3 m instead of from the entry (PT3-01 / D3-02). Candidate
    poses are scored for visibility: walls, other furniture, and for decor sets their own parts (PT3-03). It also
    tries a raised and a lowered pose. `villar.debug.controls.state.focusInfo` →
    `{ score, occluded, raised, dist }`.
  - Focus exposure: at most +2.3 EV over the room, aiming at ≈ −10–15 % of the catalogue Y′. A highlight roll-off
    keeps the sunlit backdrop from clipping (≤ 3 % guard; R3-04). `villar.debug.meter.clip` reports the estimate.
  - Portrait phones: if you want a different Entry pose (the sofa is out of the first view), tell me the stage
    size and which items must be in it, and I'll add a portrait variant of the preset.
- Photoreal push (levers 1 + 4):
  - **Idle refinement.** When the view rests (≥ 700 ms with no input, flight, dissolve, bake or thumbnail) on the
    desktop high tier, the engine path-traces the same frame and blends it in over the raster frame through the
    same exposure / white balance / tone mapping. Any input cancels it: camera motion, swaps, time and focus
    changes do so instantly; hover, clicks and `setInsets` with a 150 ms fade. Nothing to do on the UI side, but:
    keep calling `setInsets` while a panel animates (that pauses it), and don't render other WebGL on top.
  - Events: `refine {state: start|visible|done|cancel, samples, ms}`. Option `createVillar({ refine: 'off' })`
    disables it; URL `?pt=force` forces it on (software GL too, for the harness), `?pt=off` turns it off.
  - QA: `villar.debug.refine` → `{ on, phase, k, samples, tiles, snapshotMs, firstMs, cleanMs, sps, scale }`.
  - **Window.** The sky is now a photographic CC0 HDRI per time of day (`/assets/sky/*.hdr`, 0.6–0.8 MB each, the
    current time loads before the first frame, the others in idle time; same origin only). It also lights the path
    tracer, with a 0.53° sun disc for soft shadows.

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

## From modeler (photoreal, lever 2 + 3) — engine changes needed

1. **Photoscanned maps swap in after load.** `materials.get()` still returns its procedural material at once. When the CC0 scan set
   (`site/assets/materials/`, ≈ 0.3–1 MB a set, lazy per material) is on the GPU, its maps replace the procedural ones **in the same
   slots** (no shader recompile) and colour / roughness are re-derived. Subscribe once:
   `materials.onChange(() => { sceneVersion++; pathTracer?.updateMaterials?.(); rebakeAll(400); })` — anything that cached the old
   textures (path-tracer material/texture arrays, baked GI / probes, thumbnails) must refresh. Callbacks are batched (one per
   microtask); `materials.scanVersion` counts swaps.
   - `materials.ready()` / `pending()` now include the scan downloads (a set whose network + decode exceeds 90 s, or fails, keeps
     the procedural maps for good) — so the first GI bake after load already sees the scanned albedo.
   - Uploads go through `renderer.initTexture`, one texture per queue slice, ahead of queued procedural work (≈ 4–20 ms for a 1K
     map in SwiftShader; the 2K floor ≈ 100 ms in SwiftShader, once, at load); no upload lands inside a frame.
   - Clones are covered: the engine's `wallMaterial(...).clone()` and `satin(floor)` copies swap too (the clone hook re-registers).
   - Tier: `createMaterials(renderer, { quality })` → high 2048 (floor only has a 2K file), medium 1024, low 512.
   - `?scans=0` turns them off (A/B frames). `materials.scanStats()` → `{ sets, files, bytes, decoded, maxDecode, uploads,
     maxUpload, failed, ids }`.
2. **Wall colour animation.** `animateWalls(hex)` writes the raw hex into the wall material. The paint scan was prepared with a
   detail mean of 0.92 (procedural: 0.944) so that stays within 3 %. The limewash scan (R3-08: ± 6–8 % brushed clouds + trowel
   normal) has mean 0.85, so a raw hex written into a *limewash* material renders ≈ 10 % dark (today that only happens between two
   limewash packs; a finish change goes through `materials.get` and is compensated). To be exact everywhere:
   `to.clone().multiplyScalar(1 / (m.userData.detailMean || 1))` per material.
3. **Leaves (lever 3).** `plant-leaf` materials now carry an `onBeforeCompile` (back-lit translucency + underside tone,
   `customProgramCacheKey 'villar-leaf'`). `attachSSAO` chains it correctly (it calls `prev`). Please don't replace
   `onBeforeCompile` on these without chaining. The olive canopy uses an alpha-cut scanned leaf (`alphaTest 0.5`,
   `shadowSide: DoubleSide`) — leaf shadows are dappled now.
4. **CSP.** Scans are same-origin `fetch()` + `createImageBitmap` (needs only `connect-src 'self'`, already there). Consider a long
   `Cache-Control` for `/assets/materials/(.*)` (immutable content; `max-age=31536000`) in `vercel.json`.
5. **For lever 4 (the window):** CC0 HDRIs are reachable through GitHub mirrors (no polyhaven.com needed):
   `github.com/zuujis-cc0/polyhaven-hdris-pure-skies`, `…-streets-and-town`, `…-streets-and-town-2`, `…-interiors`, `…-interiors-2`,
   and `ambientcg-hdris`, `ambientcg-hdris-2…5`. Clone with `--depth 1 --filter=blob:none --sparse --no-checkout`, list names
   with `git ls-tree --name-only HEAD` (never `-l`: it fetches every blob), then `sparse-checkout add` only the 1K/2K files.
   `tools/materials-prep.mjs` shows the pattern, and how LICENSES.md is generated from each mirror's `MANIFEST.tsv`.
6. **R3-12 (phone bed-base blotch)** is not geometry: the bed base side is one smooth upholstered softBox and the duvet no longer
   intersects it (its hang is clamped above the rail). The review's diagnosis stands — please apply its low-tier probe fix
   (`mix(0.6, 1.0, valid)` or a 0.5 × spacing normal offset). The duvet's own dark "dent" (R3-07) was geometry and is fixed
   (crease depth soft-clamped to ±7 mm, creases ≥ 4 cm wide, duvet grid 96 × 80).
7. **Budgets.** All 21 scan sets at their largest file: 12.1 MB (high: floor 2K + 1K rest); medium 10.6 MB; low (512) 2.5 MB.
   Measured per style in the engine lab, high: Dark Walnut 8.7 MB / 15 sets; Dark Walnut → Mediterranean adds 3.0 MB / 4 sets.

## From modeler (round 4: R4-05/06/10/11/13) — engine changes needed

1. **R4-13 sink (architecture.js).** The basin is in your kitchen builder, so I can't change it from my files. I've
   written the replacement geometry: `sinkParts({ w, l, depth, r, rim })` from `furniture/index.js` (code in
   `furniture/fixtures.js`).
   - It returns `[{ geometry, key, opts, cast }]` in local metres. The origin is the centre of the cut-out, on the
     worktop top. x runs across the counter (wall → front), z along the run, y up.
   - The parts: a 17 cm drafted basin with a filleted floor falling 6 mm to the drain, a 15 mm brushed-steel rim
     lying on the worktop (4 mm), a chrome drain ring, and a slotted strainer. About 2 k triangles.
   - Suggested call, replacing the five `K(M.steel, …)` boxes and the `sinkDark` disc:
     `for (const p of sinkParts({ w: sd1 - sd0, l: sz1 - sz0, depth: 0.17 })) { const g = p.geometry.clone().translate(X - (sd0 + sd1) / 2, wy1, sinkZ); B.add(materials.get(p.key, p.opts), g, { cast: p.cast }); }`
     (adjust the axis if your X runs the other way; the basin is symmetric).
   - The basin still needs light. It sits inside the cabinet volume, so with invalid probes there (as with R4-09) it
     renders black. Please treat it like the bed base.
2. **R4-06 limewash.** The scan is now ±5 % around the wall colour: a ±4 % cloud plus fine detail clamped to ±1.2 %.
   The stains and pits are gone, and the normal is softened (normalScale 0.18).
   - Its detail mean is now **0.92, the same as the paint set**. A raw hex written by `animateWalls` therefore
     renders 8 % under the hex on every wall, paint or limewash alike (it was 15 % on limewash).
   - To be exact, divide by `m.userData.detailMean` as before. The same mean on both sets means a
     paint ↔ limewash style switch no longer jumps in brightness.
3. **R4-10 cane / wicker shadows.** This is done on my side, and it needs nothing from the renderer.
   - Alpha-cut materials (cane, open rattan, fringe, scanned leaves) now carry hashed-alpha depth and distance
     materials, available as `materials.shadowOf(material)`.
   - The furniture assembly sets `customDepthMaterial` / `customDistanceMaterial` on every such mesh, on every path:
     direct build, cache instance, and worker re-assembly.
   - Why the shadows were missing: three's own variant alpha-*tests* the map at the shadow camera's coarse mip. There
     the open weave averages below 0.5, so the whole panel dropped out of the shadow map.
   - **If you clone furniture meshes yourself** (thumbnails, dissolves): `Object3D.clone` does not copy
     `customDepthMaterial`. Copy it across, or call `materials.shadowOf(mesh.material)`.
4. **R4-11 rattan dome at night.** On my side:
   - The strands glow warm, with emissive equal to the weave albedo, driven by `setLampsOn` like the paper shades.
   - An emissive inner shell (`shade-glow`, hidden by day, casts nothing) shows through the gaps and from below.
   - The light descriptors for woven domes now include a soft side/up `point` (30 % of the lamp, no shadow).
   - The dappled weave pattern on the walls and ceiling needs a light cookie: a projected weave alpha on an up/side
     spot. That is yours. The weave alpha is `site/assets/materials/wicker/alpha_1k.jpg`, metric tile 0.35 m × 0.3.
5. **R4-09 bed-base blotch: my geometry does not contribute.**
   - The foot and side rails are single smooth softBoxes. No duvet, throw or sheet vertex reaches below the rail top:
     the duvet hang stops 6 cm above the deck.
   - The disc in `crops/gl-golden-bedbase.png` sits mid-rail, away from any seam. It is the probe lookup inside the
     closed bed volume (rails + deck + mattress), as diagnosed.

## From modeler (round 5): pivot/front for the FOCUS turntable

Every built item (`buildItem`, `buildItemCached` clones, worker re-assembly via `prebuildItems` / `buildItemAsync`)
now carries, on the root group's `userData`, all in the item's **local** frame (metres, before your slot transform):

| field | type | meaning |
|---|---|---|
| `pivot` | `[x, y, z]` | The turntable axis point: **x, z** = centre of the item's visual footprint (x/z centre of its body bbox), **y** = bottom of that bbox (the floor / support contact). Rotate about the vertical line through it. For floor items fitted by `buildItem` this is `[0, 0, 0]`; it differs for wall items (`wall_art`, wall `mirror`: z = half the depth, y = the bottom edge — the origin is the back-face centre), pendants (y = the lowest point of the shade, origin = ceiling mount), asymmetric shapes (organic mirrors). |
| `front` | `[x, y, z]` | Unit vector the item faces, its 0° rest angle. `[0, 0, 1]` (+Z) for every archetype today, as per the build conventions. The ¾ beauty angle is 25–30° off this vector. |
| `bounds` | `{ min: [x,y,z], max: [x,y,z] }` | The local body bbox the pivot is taken from — use it for the 55 % / 60 % framing instead of `Box3.setFromObject` (see the cords below). |
| `radial` | `bool` | `true` when the item has no meaningful front (round tables with w = d, plants, pendants, table / floor lamps except swing-arm, centrepieces). Optional: you may skip the rest-angle dial or the "back" snap for these. |

Suggested use: `turn.position.copy(pivotWorld); item.position.sub(pivotLocal)` — i.e. put the item in a holder at the
pivot and spin the holder. A turned item never changes its `pivot` / `front` (they are per-prototype constants;
cache clones get their own array copies, safe to mutate).

**Lamp cords (new, 360° backs).** Floor and table lamps now have a flex leaving the base at the back. These meshes are
tagged `mesh.userData.cord = true` and `mesh.userData.noFit = true`; `bounds`, `pivot` and the dims fit ignore them.
- Floor lamps: the flex lies on the floor and ends in a UK plug in a rear corner of the footprint (it may overhang
  the footprint by ≤ 4 cm on the slim column lamp). In the studio's corner slot that is against the walls, so
  `clampToRoom` is unaffected; if you ever see a lamp pushed off a wall, exclude `userData.noFit` meshes from
  `boundsOf()` (or use `userData.bounds`).
- Table lamps on a host (`ctx.host` = the nightstand's `anchorInfo.top`, as you already pass): the flex runs to the
  host's back edge and drops ≈ 7 cm over it (y < 0, below the anchor). Without a host it ends in a plug on the
  surface. On the turntable you may hide cords with `mesh.visible = !mesh.userData.cord` if the drop reads wrong
  against the invisible stage — your call.

**Other round-5 geometry the turntable will show (no engine change needed):** finished cabinet backs (veneered panel
let into the carcass), kraft dust covers + D-rings + wire on framed art and wall mirrors (behind the back plane,
z ≤ 0 — inside the wall once hung), pine stretchers on gallery-wrapped canvases, rug backing + edge UVs, felt glides /
metal end caps under legs, routed finger pulls, welts on back cushions and round the outside back of sofas.

**Villar Editions wall art (ART.md §5).** `buildItem` renders a real artwork when `item.model.params.image` (or
`images: [...]`) holds a URL — please resolve the catalogue's Storage key (`item.image`, e.g. `art/<id>.jpg`) with your
base-URL constant into `model.params.image` before building (or tell me the constant and I resolve it here).
- The image loads with `crossOrigin = 'anonymous'`, decodes via `createImageBitmap`, is uploaded with
  `renderer.initTexture` and only then replaces the motif placeholder in the same `map` slot (no shader change, no
  blank frame). `materials.onChange` fires on the swap (rebake GI / thumbnails as for scans); `materials.pending()` /
  `ready()` include image loads (≤ 20 s, then the motif stays).
- CSP: the Storage origin must be in `img-src` (an `<img>` load, not `fetch`). A failed load keeps the motif.
- Geometry: 4 cm canvas + float frame, origin = centre of the back plane as before; the frame lies 17 mm outside
  `dims` on each side (`userData.bounds` has the real size), hanging hardware sits at z ≤ 0.

**T8 prebuild slices.** `prebuildItems` now learns the first-time `materials.get` cost per material key and starts a
creation only when it fits what is left of the slice (unknown keys are assumed expensive); creations no longer stack
in one slice. `materials.get` itself got cheaper: procedural stand-ins of scanned furniture materials are generated at
half resolution while scans are on, the paper-cord bundle is shared across colours, and artwork canvases are
allocated in idle periods of their own (≤ 10 s, the ground colour shows meanwhile). Lab, 182 items, fresh library:
slowest first-time `materials.get` 21.5 → 7.6 ms (0 over 8 ms); prebuild `maxSlice` 17.6 → 12.4 ms, slices over
8 ms 13/23 → 6/29. The remaining spikes look like GC pauses (a trivial `plant-stem` once measured 29 ms). If you
want the last ones gone, run `prebuildItems` only while `!controls.moving` (as you do) — nothing in the slice is
above 7.6 ms of real work now. `prebuildStats()` is unchanged.

**Mesh rule (27 Nov, NaN tangents):** the Builder now gives every part real uvs (box projection instead of zeros) and
repairs zero-area uv triangles (flat lathe caps, pole fans) with a per-triangle box projection, so no furniture mesh
with a normal map / anisotropy / clearcoat normal has degenerate uvs. `node tools/fuzz-furniture.mjs` (new) checks it
for every archetype × junk params × 3 tiers and all catalogue items — 0 failures.

## From curator (27 Nov, ART §5): art hanging, edition images, rug tuck

Data is in place; nothing below needs a catalogue change. Review: `docs/reviews/curation-1.md`.

### 1. Hang wall art by rule, not at a fixed height (P1)

Today `place()` puts `wall_art` at `slot.pos` whatever the canvas height or the furniture below. With the old
60 cm pieces and the new 90–100 cm editions on the same slot, one of them is always wrong: at the old y = 1.60 a
90 cm canvas touches the 114 cm headboard; at the new fallback y a 60 cm piece floats 30 cm too high.

The three art slots in `site/data/layout-studio.json` now carry the rule:

```json
"hang": { "over": "sofa", "gap": 0.2, "gapMin": 0.15, "gapMax": 0.25, "centre": 1.45, "centreOn": "sofa",
          "span": [0.6667, 0.75], "wall": { "from": 3.4, "to": 8.8, "margin": 0.25 } }
```

Please compute, after the `over` slot's item is placed (and again when it or the art changes):

- `H`, `W` = the art's real visual size: `group.userData.bounds` (includes the float frame; a diptych is one block).
- **Height.** If `hang.over` names a slot that holds an item: `top` = world max y of that item's bounds (sofa back,
  headboard) and `y_centre = top + hang.gap + H / 2`. If the slot is empty or `over` is absent:
  `y_centre = hang.centre` (1.45 m).
- **`hang.clear`** (dining wall: `{ "slot": "dining_table", "gap": 0.18 }`): keep the bottom edge at least `gap`
  above that item's top: `y_centre = max(y_centre, top(clear.slot) + clear.gap + H / 2)`.
- **Ceiling.** Keep the top edge ≥ 0.30 m under the ceiling at that spot (the bulkhead is 2.55 m). If that pushes the
  piece down, the gap may shrink to `gapMin` and no further; below that, leave it and log
  `[villar] <id> does not fit above <over>`.
- **Along the wall.** Centre the block on `hang.centreOn`'s placed bounds (the sofa is clamped to the wall and
  aligned, so its real centre can differ from `slot.pos`), then clamp so the block stays inside
  `hang.wall.from + margin … hang.wall.to − margin` (metres along the wall's axis: z for the east and west walls,
  x for the bathroom partition).
- `slot.pos` y stays as the fallback and is tuned for the signature rooms (sofa 1.56, bed 1.74, dining 1.45).
- `hang.span` is informational (the data already satisfies it; `tools/test-ai.mjs` checks it). A
  `console.debug` when `W / width(over)` is outside `span ± 0.03` would help the reviewers.

Expected results, for a check in the harness (centre y, m): Dark Walnut Magazine: sofa wall 0.86 + 0.20 + 0.517 =
1.58 (canvas 100 + frame), bed wall 1.14 + 0.18 + 0.467 = 1.79, dining 1.45. Dark Walnut Fully furnished: Najla
120 × 80 over the 82 cm Daventry back = 1.42; Olina 120 × 60 over the 114 cm headboard = 1.62.

### 2. Edition images: resolve the Storage key (as the modeler asked in "From modeler (round 5)")

- Catalogue editions carry `edition: true` and `image: "art/<id>.jpg"` at item level (a Storage key, not a URL).
  Before building, set `model.params.image = MEDIA_BASE + item.image` (the constant is in `site/js/ui/config.js`;
  the server uses `db.publicUrl`). `params.frame`, `frameColor`, `frameWidth` (0.012), `motif`, `colors` and, for the
  three diptychs, `panels: [[0.7, 1.0], [0.7, 1.0]]` + `gap: 0.08` are already in the data.
- **Only once the file exists.** Until the art director approves a candidate, a request for `art/<id>.jpg` is a 404
  on every room load (three per style). Either probe once per session and cache the miss, or read a small manifest
  of approved ids (the photo engineer can write `art/index.json` when a job is approved). A failed load must not
  log an error to the console.
- Pass `edition` through to the builder as well (see `docs/requests/modeler.md`, "From curator" 1): an edition
  without an image should still get the canvas and float frame, with the motif as its face.
- `editions: false` in `styles.json`: `loadData` already removes editions from the packs (`withoutEditions`), so
  the engine never sees one. Nothing to do.

### 3. Rug tuck (P2, optional)

`rug` is placed at `slot.pos` (x = 2.95). A 200 cm-deep rug then runs 19–34 cm under the sofa front (good), but the
160 × 230 rug ends 4–12 cm under it: the sofa's front legs stand on the floor. I have recorded those pairs in the
packs' `avoid` and moved Mediterranean to a 200 × 290 rug. If you add
`"align": { "to": "sofa", "under": 0.22 }` semantics for flat items (the rug's sofa-side edge sits 22 cm behind the
sofa's front edge, real bounds), the small rug becomes usable again and I will remove those `avoid` pairs.

## From twins (27 Nov, docs/TWINS.md): show the real product when its twin exists

`site/js/engine/twins.js` (new, mine; no engine file touched) loads the GLB reconstruction of a catalogue item and
hands back an `Object3D` normalised exactly like a procedural item: catalogue dims, floor at y = 0, pivot at the
footprint centre, front +Z, `userData.pivot / front / bounds / radial`, shadows on, materials lit by the room
(`MeshStandardMaterial`, so SSAO via `decorate()`, the probe chunks and the box reflections apply as they are).
Proved in the lab (`/lab/twin.html`, "Dissolve test" runs the code below with the real `createFader`).

```js
const twins = createTwins({ THREE, renderer, baseUrl: MEDIA_BASE, quality: Q });   // MEDIA_BASE: site/js/ui/config.js (pass it in beside `media`)
twins.has(itemId)              // sync; false until the manifest (site/data/twins.json, {} today) is in, and after a failed load
twins.load(item)               // Promise<Object3D | null>, never rejects; cache + in-flight dedupe; one instance per call
twins.adopt(slotGroup, twin)   // twin into the SAME slot group → returns the `procedural` holder to fade out
twins.release(twin)            // hand an instance back (refcount; the model is freed with the last one, LRU 6 / 4 / 2)
twins.unload(itemId)           // abort an in-flight load, drop the cached model
twins.setLampsOn(on, k)        // shade glow of lamp twins: call it wherever materials.setLampsOn is called
twins.dispose()
```

### 1. `furnish.js`: 10 lines (procedural first, twin when it resolves)

`createFurnisher({ …, twins = null, onTwin = null })`. In `make()`, replace the final
`return { slot, item, group, lights, baseScaleY: group.scale.y, host: hostOf(slot.id) };` with:

```js
    const rec = { slot, item, group, lights, baseScaleY: group.scale.y, host: hostOf(slot.id), twin: null, gone: false };
    if (twins?.has(item.id)) twins.load(item).then((twin) => {          // docs/TWINS.md §2.5: the procedural model shows at once
      if (!twin) return;                                                 // 404 / bad dims / timeout: it simply stays
      const adopt = () => {                                              // → the procedural holder, or null when the rec is gone
        if (rec.gone || rec.twin) { twins.release(twin); return null; }
        ensureBVH(twin); rec.twin = twin;
        return twins.adopt(group, twin);                                 // same slot group; slotId / slotType on its meshes (ID pass, picking)
      };
      if (onTwin && placed.get(slot.id) === rec) onTwin(rec, adopt);     // on screen: the engine dissolves and re-lights (2)
      else adopt()?.removeFromParent();                                  // cached / prebuilt: nothing to animate
    });
    return rec;
```

and in `disposeRec(rec)`, as its first line (the twin is not in the modeler's cache, `releaseItem` would leak it):

```js
    rec.gone = true; if (rec.twin) { twins.release(rec.twin); rec.twin = null; }
```

Nothing else in `furnish.js` changes: the slot group, its transform, lights, anchors, `place()`, `hang()`, the rec
cache and `retire()` work on the group as before. `adopt()` moves the procedural meshes into one child group named
`procedural` (lights and light targets stay on the slot group), adds the twin beside it, copies the twin's
`bounds / pivot / front / radial / triangles` onto the slot group (`fitBounds`, the turntable and the framing read
them) and sets `castShadow / receiveShadow`. After the dissolve the holder is detached, so `boxOf`, `meshesOf`,
picking and the ID pass see the twin only.

### 2. `index.js`: the dissolve and what to invalidate (pass as `onTwin` to `createFurnisher`)

```js
  async function onTwin(rec, adopt) {
    const id = rec.slot.id;
    // never two runs on one group (R4-05): wait for a swap / wave on this slot family to end
    while (!disposed && (familyBusy(id) || styleWave)) await new Promise((r) => setTimeout(r, 120));
    if (disposed) return;
    const shell = adopt();
    if (!shell) return;
    if (furnisher.placed.get(id) !== rec) { shell.removeFromParent(); return; }   // swapped away meanwhile: it is in the cache
    budget.inflight.add(id);
    try {
      decorate(rec.twin); hideForCutaway(rec); refreshNoAO(); interaction.refresh(); sceneVersion++; invalidate(3);
      await fader.swap({ inn: [rec.twin], out: [shell], ms: 350, settle: false });   // TWINS §2.5: 350 ms
    } finally { budget.inflight.delete(id); shell.removeFromParent(); shell.visible = true; }
    if (disposed) return;
    if (highlighted === id) post.setSelection(furnisher.meshesOf(id));
    if (focusedSlot === id) refocus();
    renderer.shadowMap.needsUpdate = true; queueContact();
    scheduleLocal([furnisher.boxOf(id)]);          // probes near the item re-bake (the albedo changed), blends in
    queueWarm([rec.group]); invalidate(3);
  }
```

- **ID pass / capture:** `itemPass` keys on `mesh.userData.slotId`; `adopt()` sets it (and `slotType`, `itemId`) on
  every twin mesh, so `capture().items` and their bboxes follow the twin with no change.
- **GI:** same footprint, new albedo → the local re-bake above is enough; `giExact` keys on `sceneSig()`, which should
  now include `rec.twin ? 't' : 'p'` per slot (a room lit with the procedural sofa is not the room with its twin).
- **`sceneVersion++`** so Live → Photo does not show a photo developed from the procedural frame.
- **Lamps:** `twins.setLampsOn(on, k)` beside each `materials.setLampsOn?.(on, k)` (5 call sites). A lamp twin whose
  manifest entry has `glow: [from, to]` (fractions of the height) gets that band as a separate, non-shadow-casting
  mesh (`material.userData.glow`, name `twin:shade`), so your own-lamp shadow rule keeps working.
- **Load order ("visible items first"):** `twins.js` runs two loads at a time in call order. `placeAll()` asks in
  slot order; if you want the view's items first, call `make()` for them first or tell me and I add a priority.
- **Thumbnails** (`thumbs.js`) still render the procedural model. With `twins` passed in it could render
  `await twins.load(item)` instead (release it after the shot); say if you want a helper.
- **Path tracer / photo capture:** nothing special; the twin is ordinary meshes with `MeshStandardMaterial`.
- **Fader pool:** `createFader` keeps its alpha-hash clones per source material for the page's life. A twin that is
  unloaded leaves up to one clone per material behind (JS objects only, the textures are disposed). A
  `fader.forget(materials)` would close that; not urgent.
- **Context loss:** the twin's textures keep their `ImageBitmap`s, so three re-uploads them after a restore.

### 3. Failure is silent by construction

`load()` resolves `null` and logs one `console.debug` for: not in the manifest, `off`, manifest dims that no longer
match the catalogue (no download), 404, any HTTP error, 15 s timeout, a file that is not a GLB, Draco / meshopt /
KTX2, external URIs, rigged models, more faces or bytes than the tier allows (120k / 80k / 45k; 48 / 32 / 20 MB),
and proportions off by more than ±3 % after the uniform scale. A final failure is remembered for the session
(`has()` turns false: no second request); a timeout or network error may be retried after 2 minutes.

### 4. Open, engine side

- **Anchors.** The slot group keeps the procedural `anchors / anchorInfo` (seat, top, deck). A twin's seat can sit a
  centimetre or two off; the QA page lists each anchor against the twin's real surface. If the pilot shows cushions
  or lamps floating, I add `anchors` to the manifest and `adopt()` rewrites them: you would then `relocate()` the
  slot's descendants after `onTwin`.
- **Beds and sofas.** A reconstructed bed must be the frame and headboard only (mattress, bedding are their own
  slots), a sofa without scatter cushions and throws. The turnaround prompt removes them; the QA gate checks it.
