# Villar: review round 2, tech and performance (r2-tech)

**Build:** baa1f80 (diff b90235b..baa1f80, 82 files). **Reviewer:** tech and performance (principal-engineer pass on "nothing lags, nothing leaks, nothing races"). **Date:** 2026-11-26.
**Harness:** a copy of `tools/shoot.mjs` (`/tmp/rev2/tech/h.mjs`, same flags and lock) that adds an init script (long-task and paint observers, frame-colour and probe-SH probes; `/tmp/rev2/tech/init.js`), CDP heap after GC, and a request log. Logs: `/tmp/rev2/tech/run*.log`. Screenshots: `/tmp/rev2/tech/*.png`.
**Caveat:** SwiftShader on 2 CPUs, shared with three other reviewers. The harness also picks the **medium** tier, because `hardwareConcurrency` is 2. Milliseconds are 10–50× real-GPU values. I judge from program counts, call counts, event order and code paths, and quote raw times only for ratios.

## Verdict

**No P0 · 4 × P1 · 9 × P2 (13 findings).**

Round 2 fixed almost every round-1 engine defect: the iOS GI bake, the photo races, context-loss handling, CSP/XSS, catalogue colour and the memory tiers. The data and AI layer is clean: integrity checks, index parity and 206/206 AI tests pass. Stale saves migrate safely, and 10 style switches plus 20 swaps show **no leak**.

What still breaks "nothing lags, seamless" is the orchestration of GI and shaders:
- The known blue cast is the generic sky-only stand-in GI shown during **every** time-of-day re-bake; a concurrent style wave stretches it 3×.
- On real GPUs, local GI re-bakes silently stop after 4 minutes.
- The first Evening after any style switch compiles ~50 programs synchronously.
- A quick double style switch can orphan the entry-door finish.
- A WebGL context restore leaves the wall art permanently black.

**What clearly improved since round 1 (verified):**
- iOS probe bake. The HalfFloat atlas does not need `EXT_float_blend`, and `step()` never throws.
- Photo start/stop uses generation tokens (round 1: E2).
- `controls.view`/`mode` are live getters (E3).
- Hidden dollhouse objects can no longer be picked (E5).
- Context loss is handled: emits `context`/`fatal`, the loop stops, and the UI falls back to the plan (E6).
- Lamp angles are in radians (E7). The detail-colour fix reaches the material (M1).
- The ping-pong render target has `samples = 0` (E14).
- The sky is 512×256: 14–72 ms per time in Node, was 180–550 ms (E10).
- The modeler modules load in parallel (E17).
- Texture tiers apply (medium 0.5, low 0.35), and CPU copies are dropped after upload (M2).
- The rAF loop stops when idle (E16).
- CSP and security headers ship, and `/lab/*` redirects (C1, M3).
- The store isolates listeners (C3) and keys lines per selection key (C4).
- The light count is constant within a light set: lamps are normalised to 2 spots + 1 point, candles are padded. A day swap compiled only +4 programs (the fade variants).
- `node tools/test-ai.mjs`: **206 passed, 0 failed**. `api/_catalog.js` is byte-identical to a fresh `build-ai-index.mjs` run (hash b029afae).

---

## Root cause of known issue #1 (blue/grey cast, style + time in the same tick)

**Not an AWB/AE bug.** It is the GI stand-in that the engine shows while it re-bakes after **every** time-of-day change, and a same-tick style switch makes that window about 3× longer.

Mechanism (index.js):
1. `setTimeOfDay()` (`:844-859`) sets `giState.state = 'stale'` and calls `giInterior()` (`:394-405`). That switches the probe grid to **`constant` mode**, which uses `lighting.ambient(tod)` (`lighting.js:152-162`): the **sky colour × 0.2, with no sun bounce**. It is the "never baked yet" fallback from page load, and it is reused for every time change. The previous bake is thrown away at once.
2. `bakeFresh()` then starts a 2-bounce bake. Until it lands, every surface not lit directly by the sun is lit by a blue, ~3× too dark SH. Measured on the probe grid (mean c0 RGB):

   | State | Probe c0 (r, g, b) |
   |---|---|
   | Evening, baked | 0.98 / 0.41 / 0.13 |
   | Constant stand-in | **0.14 / 0.17 / 0.21** (b/r 1.43, luminance 0.17) |
   | Day, baked | 0.65 / 0.47 / 0.32 (b/r 0.49, luminance 0.50) |

   Frame mean sRGB went from **80/87/85** during the bake (`r2-same-5s.png`) to **138/123/104** after it (`r2-same-20s.png`).
3. A same-tick style switch **starves that bake**. The style wave runs staggered `swapSlots()` jobs that build geometry and compile programs (+21 programs during the wave). On non-KHR or software GL, `fade.compile()` (`fade.js:75-79`) compiles synchronously. `frameBody` also lowers the probe budget while `fader.active` (`:948`).

   Measured bake progress: **8 % in the first 29 s** (wave running), then 8 → 97 % in 12.7 s. The cast lasted **47 s**. An uncontended day bake takes about 15 s here, and about 1–2 s on a real GPU.

   So "separately fine" just means short: every time switch shows a 1–2 s blue/dark flash on a GPU (15 s on SwiftShader). The AI line's `style`+`time` batch triples it.
4. AE and AWB are frozen while `probes.baking` (`:907`, `:943-944`), so the evening correction stays applied during the bake: AWB log-chroma −0.214/+0.065, EV +0.24.

   This is *not* what makes the room blue. Re-metering after the bake moved the gains to **bluer** values (−0.136/+0.181, then −0.159/+0.217). It only adds a small exposure error.

Minimal fix, in order of effect:
- **(a) Keep a per-(time, style) cache of the converged SH**, and present it instantly on a time change, with a 300 ms blend. This is `Map<"tod|style", Float32Array(N*28)>`, filled from `lastOut` when a bake resolves. Re-bake in the background only to refresh it.

  For a time that has never been baked, give the stand-in a **sun-bounce term**. In `ambient()`, add `sunColor·sunI·max(0, sin alt)·k` with k fitted so that the constant c0 luminance ≈ the baked 0.50, and bias it warm (floor albedo). Alternatively ship per-time prior SH from a dev bake: 96×28 floats × 4 times ≈ 43 KB.

  Target: probe c0 b/r within ±15 % of the converged value at all times, and frame mean luminance within 10 % during a re-bake.
- **(b) Don't bake during a style wave.** In `setTimeOfDay`, if `styleWave || fader.active`, defer `bakeFresh()` until `flushChanges()` resolves. The bake that ran during the wave captured half-old furniture, and it was followed by a second full 96/96-probe pass anyway (`dirty: 96`, see T9).
- **(c) Unprime AE/AWB on a time change.** Set `awb.primed = ae.primed = false; ae.ev = 0;` so that the static per-time WB applies (day `whiteBalanceGain(6000, 0.85)` = 0.963/1.004/1.072). Also let one meter read through while unprimed: in `render()`, use `(!probes.baking || !awb.primed)`.

Evidence: `run2.log` (1.5 s time series of AWB, AE, GI state and programs), `r2-med-evening.png`, `r2-same-5s.png` (blue-grey), `r2-same-20s.png` and `r2-same-45s.png` (correct).

## Known issue #3 (first Evening stalls): new information

- `setTimeOfDay('evening')` blocked the main thread **4.1 s synchronously** on SwiftShader. Programs went 126 → 182 (+56). The synchronous part is `bakeFresh()` → `refreshEnvironment()` → `captureEnvironment()`, which renders 6 cube faces with the new light set and so compiles every evening variant synchronously, before any frame.
- `prewarm()` (`:976-1002`) is skipped on software GL by design. On GPUs it runs **once, at `ready`** (see T2).

---

## Leaks, races and stalls (measured)

**Leaks.** One harness session, medium tier, by day (`run1.log`; heap = CDP `Runtime.getHeapUsage` after a forced GC):

| Point | Geometries | Textures | Programs | Heap after GC |
|---|---|---|---|---|
| Ready | 141 | 107 | 65 | 18.2 MB |
| After 4 rapid + 6 sequential style switches (all 4 packs, twice) | 231–252, flat over the last 6 | 143 | 139–140, flat | 27.5 MB |
| After 20 swaps (sofa, rug, coffee table, pendant, art, A↔B↔C) | 235–242 | 151 | 141 | 27.7 MB (+0.25 MB) |

- **No leak.** The +9 MB from ready to after-styles is the caches warming: 4 packs of materials, the modeler cache of 64 prototypes, and the furnisher cache of 28 records.
- The furniture root always held exactly 33 children, with 0 ghosts, 0 fade materials left on scene meshes, and engine items == store items for all 33 slots.
- The +8 textures over 20 swaps are newly seen art and rug items. They are bounded by the catalogue, but cached materials never release them.
- `buildItemCached`/`releaseItem` reference counting is correct: the furnisher cache holds references, so the modeler's LRU trims only idle prototypes.
- The thumbnail targets (512² RGBA16F ×4 MSAA + resolve + LDR, ≈ 11 MB GPU) are allocated once and reused, never freed while the engine lives. That is acceptable, but `thumbs` could free them after 30 s idle.

**Races (browser).**
- Rapid style chips (4 clicks 80 ms apart) and LO → DW → Cashmere 250 ms apart both ended consistent: walls, store/engine items, lamps, no ghosts. SwiftShader's multi-second synchronous work between clicks hides the door race; see T3 for the deterministic repro.
- Context loss *with* restore: measured, see T4. *Without* restore: from code, the engine emits `fatal` after 5 s and the UI's own 6.5 s backstop disposes the engine and shows the plan with a retry button. That step was dropped from the final run.
- Photo start/stop, swap-during-wave and focus-during-wave were dropped from the final run for lack of a harness slot. Photo was reviewed in code (OK); focus-during-wave is T5.

**Stalls and long tasks.** Raw SwiftShader times, for ratios only. Long tasks: count, total, max.

| Action | Long tasks (n, total, max) | Programs | Other |
|---|---|---|---|
| Swap (sofa) | 30, 23 s, 3.9 s | +4 | |
| HUD open / fly-to | 8, 14 s, 2.8 s | +13 | +15 textures |
| Style switch | 84, 46 s, 3.5 s | +42 | |
| First Evening | 138, 49 s, 12.4 s | +56 | `setTimeOfDay` itself 4.1 s synchronous |

- Shader strategy: `compileAsync` at load (KHR only) → `prewarm()` once after ready (KHR: `compileAsync` of the other light set + dollhouse; without KHR: synchronous `renderer.compile` per object in idle callbacks; software GL: skipped) → fade variants via `compileAsync` with a 2 s cap (without KHR: synchronous) → thumbnails via `compileAsync` (KHR only). The gaps are T2, T7, T8 and T10.
- Draw calls at rest: 200–202 per frame (medium). The engine is idle (no rAF) at rest.

---

## Findings

### T1 [P1] GI stops updating after 4 minutes: the bake watchdog cancels every local re-bake (GPU path)
- Owner: engine
- Repro (code path, GPU only): load the page on a real GPU and leave the time of day unchanged for more than 4 min. Then swap any item, or switch the style. The console logs `[villar] GI bake stalled — cancelled`, `villar.debug.gi.dirty` stays > 0, and the indirect light never reflects the change: after a style switch the old pack's wall and furniture bounce stays.
- Expected: local re-bakes complete at any time after load.

  Actual: the watchdog in `frameBody` (`index.js:950-954`) cancels when `now - giState.started > 240000`, on any frame where progress did not move. `giState.started` is set **only** in `bakeFresh()` (`:478`); `runLocal()` (`:509-511`) resets `lastAdvance`/`lastProgress` but not `started`.

  On GPUs the probe readback is async (`probes.js:398-401`). For ≥ 1 frame per bounce, `step()` returns early with `reading = true`, so progress is unchanged and the 240 s clause fires. `cancel()` resolves `false`, `runLocal`'s `.then` keeps `dirty` and re-shows the old `lastOut`, and nothing retries. Every later swap repeats this.

  SwiftShader uses the synchronous readback path, where progress moves every frame. That is why the harness and QA never see it.
- Evidence: code path above. It cannot be reproduced on SwiftShader, whose synchronous readback advances progress every frame. A 4-minute soak run was not possible because of the shared harness lock.
- Fix: in `runLocal()` (and `rebakeAll()`) set `giState.started = performance.now()`. Better, keep the start time per job. In `probes.js`, add `get reading()` and skip the stall test while it is true: `else if (!probes.reading && (…))`. Target: 0 watchdog cancels in a 30-minute soak with a swap every 20 s.

### T2 [P1] The shader prewarm runs once: the first Evening after any style switch compiles synchronously on every GPU
- Owner: engine
- Repro: on a desktop GPU (Chrome, KHR_parallel_shader_compile), wait for ready, switch to Mediterranean, then click Evening. The AI line issues `style` + `time` in one batch, e.g. «уютный вечер в средиземноморском стиле».
- Expected: no frame over 50 ms (PHASE2 §4).

  Actual: `prewarm()` (`index.js:976-1002`) compiles the *other* light set only for the furniture present **at `ready`**, and it is called only from `markReady()` (`:1022`). A style switch brings ~25 new item groups with new materials.

  Measured on the harness: **+42 programs** on the switch to Mediterranean, then **+56 programs** on the first Evening, with the `setTimeOfDay()` call itself blocking **4.1 s** synchronously on SwiftShader. On a GPU these Evening variants are compiled inside `setTimeOfDay → bakeFresh → refreshEnvironment → cubeCam.update`, a synchronous `renderer.render` where KHR does not help. Estimate: 0.5–3 s freeze on ANGLE/D3D or Metal.

  The same applies to items swapped in by day and first shown at night. `prebuildStep` → `fader.warm()` (`:826-828`) warms only the current set, and `prebuildPacks()` (`:1005-1018`) builds geometry but compiles nothing.
- Evidence: `run2.log` (`styleP` 84 → 126 programs; `eveP` 126 → 182; `eveSync` 4093 ms).
- Fix:
  - Run a debounced `prewarm()` from idle after every style wave and swap batch (in `flushChanges()` after `await Promise.all(jobs)`), restricted to the new groups: `withState(() => renderer.compileAsync(group, camera, scene))`.
  - In `prebuildStep`, warm both light sets.
  - In `setTimeOfDay`, when KHR is present, `await renderer.compileAsync(scene, camera)` under the new set *before* the synchronous `refreshEnvironment()`.
  - Target: 0 programs compiled synchronously on a time switch (compare `renderer.info.programs.length` before and after the first frame).

### T3 [P1] The entry door finish goes wrong, and can stay wrong for the session, after two style switches less than 1 s apart
- Owner: engine
- Repro: Light Oak → click Dark Walnut, then within 0.95 s Cashmere. The same happens with any burst of chip clicks, or with the assistant's undo of a style change within a second (`assistant.js:287`).
- Expected: the door finish always matches the active pack (`architecture.doorFinish`).

  Actual: `applyPackArchitecture()` (`index.js:769-777`) compares against `arch.doorFinish`, the *committed* finish (`architecture.js:575`). `commit()` runs only after the 250 ms delay + 700 ms dissolve. During that window `fader.swap()` has already **dressed** the door meshes with alpha-hash clones (`fade.js:34-43`, synchronous inside the async `swap`).

  A second `prepareDoorFinish()` (`architecture.js:580-604`) therefore finds **no mesh whose `material === d.mat`**, adds nothing, and its `commit()` still re-points `d.mat`/`d.finish`.
- Evidence: a Node repro with the **real** `architecture.js` + `fade.js` (fallback materials, stub renderer): `/tmp/rev2/tech/nm/door.mjs`.

  | Case | Door mesh | `arch.doorFinish` |
  |---|---|---|
  | Single LO switch (control) | oak | oak (correct) |
  | DW + Cashmere in one tick | **walnut** | walnut, room is Cashmere (wrong until the next switch) |
  | DW, then Cashmere +150 ms | **walnut** | **paint** |
  | …then LO, alone | **still walnut** | oak |

  In the last two rows the door is orphaned. The tracked material is used by no mesh, so later switches never fix it until a reload. Paint packs also animate the orphan via `wallMaterials`.

  In the browser harness the rapid-chip test came out right by luck (`run1.log`). On SwiftShader each switch blocks the main thread for seconds, so the next click lands after the first dissolve has committed. On a real GPU it does not.
- Fix:
  - Find door meshes by a stable tag (`o.userData.doorKey === key`), not by `material === d.mat`. That alone removes the orphaning.
  - Serialise: keep `doorRun`. When a new style event arrives while it is pending, `fader.flush()` and `commit()` it synchronously first.
  - Make `arch.doorFinish` return the pending target.
  - Target: after any burst of style clicks, `__door()` (`run1.json`) reports only the active pack's finish.

### T4 [P1] After a WebGL context restore, the wall art turns black for good and GI is re-baked from blank textures
- Owner: engine + modeler
- Repro: iOS Safari, background the tab long enough for the context to drop, then return. Or in DevTools: `ext = gl.getExtension('WEBGL_lose_context'); ext.loseContext(); setTimeout(() => ext.restoreContext(), 1500)`.
- Expected: the restored room looks like it did before the loss.

  Actual: the restore listeners fire in registration order. First three.js; then the engine (`index.js:165-171`, registered before the modules load), whose `onRestored` (`:1031-1042`) immediately calls `bakeFresh()` and `refreshEnvironment()`; and only after that `materials.js:195`, which starts `restoreTextures()`.

  Since round 2 the CPU copies are dropped after upload (`textures.js:152-158`: `image.data = null`, canvases shrunk to 1×1). Until the time-sliced regeneration finishes (seconds), every procedural map re-uploads as zero: black albedo, normal (−1,−1,−1), roughness 0.

  The GI bake (1–2 s on a GPU) and the cube capture therefore see a black, broken room. When the textures land, nothing re-bakes: `watchTextures()` is not called in `onRestored`, and `texturesSettled` is still `true`. The room keeps dark, wrong indirect light and reflections until the next time-of-day change. The bake also starts from `constant` mode, the blue stand-in described above.
- Evidence (**reproduced**, `run1.log`, medium tier, Dark Walnut by day): `loseContext()`, then `restoreContext()` 1.5 s later. The engine emits `context:lost` → `context:restored`, the stage stays 3D, and `ready` stays true.
  - **Both wall-art canvases render solid black after the restore and stay black**: compare `r3-before-loss.png` with `r3-after-restore.png` and `r3-after-restore15.png`, 15 s later with `materials.pending() = 0`.
  - The console shows **77 × `WebGL: INVALID_VALUE: texSubImage2D: no pixels`** and **4 × `glTexSubImage2D: Offset overflows texture dimensions`**.
  - Probe c0 luminance fell **0.404 → 0.372 (−8 %)** and was never re-baked (`gi.dirty 0`, `state ok`). On SwiftShader the bake took 30 s, so most textures had regenerated before it captured them; on a GPU (1–2 s bake) the error is far larger.

  Why the art stays black: `releaseAfterUpload()` shrinks a released canvas to 1×1 (`textures.js:157`). The engine's handler renders synchronously (cube capture) **before** `materials.js` regenerates anything, so three allocates **immutable `texStorage2D` storage at 1×1**. The later full-size `texSubImage2D` from the regenerated canvas overflows that storage and is rejected.

  4 more `no pixels` warnings appeared *before* the loss, during style switches and swaps. So some released DataTexture is re-uploaded without data in normal use. It is unidentified; instrument `onUpdate` to log `t.name` when `image.data === null`.
- Fix:
  - In `restoreTextures()`, call `t.dispose()` on every canvas/data texture before re-assigning `image`, so three reallocates storage at the real size. Do not shrink canvases to 1×1: keep `{ width, height }` and drop only the pixels.
  - In `onRestored`, call `materials.restore?.()` (wrapping `T.restoreTextures()`) **first**, set `texturesSettled = false`, and re-run the load path: `Promise.race([watchTextures(), timeout(30 s)]).then(() => { texturesSettled = true; bakeFresh(); })`. Alternatively register the engine's restore listener only after `createMaterials()`. Present the cached per-time SH from the root-cause fix (a) meanwhile. Target: probe c0 after restore within 5 % of before.

### T5 [P2] Focusing an item during a style wave frames the outgoing model and never re-frames
- Owner: engine
- Repro: click a style chip, then immediately click (or ask the AI to "show") the dining table or sofa while the ~1.2 s staggered wave is still running.
- Expected: the camera frames the item that ends up in the slot.

  Actual: `focus()` (`index.js:604-624`) computes `furnisher.boxOf(slotId)` once, from the item currently placed. The wave (`flushChanges`, `:719-731`) swaps that slot up to ~1 s later. `swapSlots()` (`:735-762`) refreshes the highlight but not the camera.

  When sizes differ (e.g. Kentana 100 cm rectangular → Keira round, or 3-seat → 2-seat sofas), the framing is off-centre or clipped. Code path only: the runtime check was dropped from the final run because of the harness lock.
- Fix: in `swapSlots()`, after `fader.swap`, `if (focusedSlot && all.includes(focusedSlot)) controls.refocus(furnisher.boxOf(focusedSlot))`: a short ease of `focus.center/dist` without changing yaw. Or, in `focus()`, `await` the pending swap of that slot (keep `pendingSwap: Map<slotId, Promise>`).

### T6 [P2] The fade clone pool hands out stale materials (glowing shades by day, placeholder colours)
- Owner: engine
- Repro:
  - In the evening, swap a table lamp; its shade's fade clone is created with `emissiveIntensity` ≈ 7. Switch to Day and swap the lamp back. For the 320 ms dissolve the shade glows.
  - Fabrics first faded before their textures landed fade in with the placeholder-corrected colour, then pop at the end of the fade.
- Expected: the dissolve shows exactly the final material.

  Actual: `cloneFor()` (`fade.js:19-31`) reuses a pooled clone and resets only `opacity`. These source changes are not re-synced:
  - `color`, fixed later by `applyFixes`/`matchColor` (`materials.js:229-251`);
  - `emissiveIntensity` (`setLampsOn`);
  - `visible` (candle `hideWhenOff`).
- Fix: in `cloneFor()`, after `pop()`: `c.copy(m); c.alphaHash = true; c.transparent = false; c.depthWrite = true; c.defines = { ...c.defines, VILLAR_SSAO: '' };` (`copy()` resets `defines` on Standard/Physical). Or adopt T10, which removes the pool entirely.

### T7 [P2] Opening an item runs N synchronous thumbnail renders during the 0.9 s fly-to
- Owner: engine (`thumbs.js`) + ui (`hud.js`)
- Repro: click any item. The HUD builds the card plus the "In this style" and "From other styles" tiles, and each tile calls `thumbs.get()` at once (`hud.js:39-48`). Meanwhile `stage.focus()` flies the camera (after 2 rAF).
- Expected: the flight stays at frame rate.

  Actual: thumbnails run back to back, separated only by `setTimeout(0)` (`thumbs.js:194`). Each one does:
  - `buildItem` (a cache miss for other packs);
  - a first-use compile, because the thumbnail scene has its own light set (synchronous without KHR);
  - a 512² MSAA render;
  - a **synchronous `readRenderTargetPixels`** (`thumbs.js:148`);
  - a CPU flip/composite loop over 1 MB;
  - `toDataURL('image/jpeg')`.

  Harness, one HUD open (armchair): **8 long tasks**, **+13 programs**, **+15 textures**. Chrome logged `GPU stall due to ReadPixels`.
- Fix:
  - Start thumbnails only when the focus transition has ended, and render ≤ 1 per idle frame.
  - Use `await renderer.readRenderTargetPixelsAsync()` and `OffscreenCanvas.convertToBlob()` with object URLs instead of JPEG dataURLs.
  - Light the thumbnail scene with the room's day set, so it reuses the room programs. Alternatively ship pre-rendered WebP thumbnails: 141 × ~12 KB, loaded lazily.
  - Target: 0 long tasks > 50 ms during a fly-to.

### T8 [P2] "Idle" prebuild is not time-bounded and is forced every 200 ms
- Owner: modeler (`furniture/index.js`) + engine
- Repro: on the high tier, load and do nothing. After `ready`, `prebuildPacks()` builds the default items of the other 3 packs (~84 items).
- Expected: idle slices of ≤ 8 ms.

  Actual:
  - `prebuildItems()` (`furniture/index.js:370-386`) checks its 6 ms budget only *between* items, and one `buildItem` is a 20–200 ms generator, BVH included.
  - `requestIdleCallback(step, { timeout: 200 })` forces the callback within 200 ms even when the page is busy, so on a mid laptop it becomes a train of long tasks during the first interactions.
  - `prebuildStep` (`index.js:819-831`) has the same shape: it checks `timeRemaining() < 6`, then does a build that can take 100 ms plus `fader.warm()`, which compiles synchronously without KHR.
- Fix: remove `timeout` (or use ≥ 3000 ms), yield after every item, and skip while `controls.moving || fader.active || probes.baking` (pass a `shouldYield()` from the engine). Longer term, generate geometry in a Worker; the generators are pure functions of item + seed. Target: 0 long tasks > 50 ms in the 30 s after ready without input.

### T9 [P2] Local re-bakes cancel each other; one style switch runs the full 96-probe pass twice
- Owner: engine
- Evidence: `run2.log` during the Mediterranean switch, by day: `bake only [96]` at 125.4 s is cancelled by another `bake only [96]` at 130.4 s, and the result lands at 143.2 s.
- Expected: one incremental pass covering every dirty probe.

  Actual: `probes.bake()` cancels any in-flight job (`probes.js:348`). `runLocal()` is re-armed by each of these: the walls (1.2 s), the door fade (0.95 s), textures landing (30 ms) and every staggered swap (600 ms). A running pass is therefore thrown away whenever a later trigger fires.

  On a slow device (a 96-probe pass takes 15–30 s on software GL), a user who swaps every few seconds **never gets converged GI**. A wall-tint change of a few percent also marks *every* probe dirty.
- Fix: while a local job runs, merge new dirty probes into a `pending` set and start one follow-up pass after it resolves. Never cancel an incremental pass for another incremental pass. Skip `rebakeAll()` for wall-colour changes under ΔE ≈ 3. Target: ≤ 1 full pass per style switch, and convergence with one swap every 5 s.

### T10 [P2] The program count balloons: alpha-hash fade variants and thumbnail variants on top of two light sets
- Owner: engine
- Evidence (harness, medium tier): programs went **65** at ready → 69 after one swap → 82 after one HUD open → 126 after one style switch → 182 after Evening → 209 after Cashmere + Day. In the by-day run (`run1.log`) the count plateaued at 140 after all 4 packs, so it is bounded, not a leak, but large.
  - Every fade (`fade.js:23-26`) creates an `alphaHash` clone, which needs its own program.
  - Every thumbnail uses a different light set.
  - Each program costs roughly 50–300 KB of driver memory on mobile, and without KHR its first use is a synchronous compile (the source of the style-switch long tasks).
- Fix: make the dissolve a **uniform**, not a program variant. In `attachSSAO`'s `onBeforeCompile`, inject `uniform float villarFade;` and `if (villarFade < 1.0 && villarHash(gl_FragCoord.xy) > villarFade) discard;` into every opaque material, and set the value per mesh in `onBeforeRender`. Fades then compile nothing, the pool disappears (also fixes T6), and swaps need no compile wait. Together with T7 (thumbnails sharing the room's lights), target ≤ 2× the at-ready count after visiting all packs and both light sets.

### T11 [P2] Load: 129 requests / 964 KB gzip, a critical chain ~15 round trips deep, every module revalidated on every visit
- Owner: coordinator (`vercel.json`, `index.html`) + engine
- Measured (request log, local server; sizes from disk, gzip -9):
  - **FCP = LCP = 196 ms**. The LCP element is the poster (`preload` + `fetchpriority=high`), and JS blocks nothing before paint.
  - **26 requests before FCP**: HTML, poster, 4 CSS (17 KB gz), 19 UI modules, `styles.json`.
  - The engine import starts at **337 ms**: with `rootMargin: 100%` the IntersectionObserver fires at once on a 900 px viewport, so "lazy" means immediate.
  - The modeler modules start at **682 ms** (imported inside `createVillar`).
  - Total **129 requests**: JS is 111 files, 790 KB gz (vendor 60 files 511 KB; first-party 51 files 280 KB). Data is 12 JSON files, 56 KB gz. The poster is 108 KB.
  - `three-mesh-bvh` is still **41 modules**: `ExtensionUtilities` pulls in the whole `MeshBVH` build chain, 7 levels deep.
- Problems:
  - There is no `modulepreload`. The chain is html → main → ui ×2 → engine/index → three.module → three.core, plus interaction → ExtensionUtilities → … (7 levels), plus materials/furniture → parts. That is about 15 sequential RTTs, ≈ 1.5 s at 100 ms RTT before the 3D can start building.
  - `/js` and `/css` carry no `Cache-Control`, so Vercel's default `max-age=0, must-revalidate` revalidates 111 modules on every visit, along the same chain.
  - `/vendor` is `max-age=86400, stale-while-revalidate=604800` and **unversioned**, so an upgrade can mix stale vendor code with fresh `/js` for up to a week (round-1 C2 half-fixed).
- Fix:
  - Add `<link rel="modulepreload">` for the engine's critical modules: engine/index, three.module, three.core, materials, furniture/index. Ship BVH as one pre-bundled file.
  - Version `/vendor/three@0.187.0/…` and mark it `immutable`.
  - Give `/js` and `/css` `max-age=300, stale-while-revalidate=86400`.
  - Start the engine import on idle after LCP rather than on page load.
  - Target: ≤ 5 RTTs to the engine's first frame on a cold load.

### T12 [P2] /api/assistant: rate limit and spend are per instance and easy to bypass; GET discloses the auth configuration
- Owner: assistant
- Checked OK:
  - The **`state` field is not an injection surface**. `cleanState()` (`api/assistant.js:259-265`) whitelists style/view/time, and `normalizeSelection` keeps only valid ids, so `<state>` contains only server-built text.
  - User text is capped at 500 chars and control-stripped. Actions are re-validated by `sim.applyActions` on the server and again on the client (`assistant.js:427`).
  - `sanitizeText` drops sentences that name suppliers, URLs or SKUs.
  - Errors return generic text with HTTP 200; details go only to the logs. `no-store` and `nosniff` are set.
- Issues:
  - (1) The Origin check (`:389-396`) applies only when the header is present, so scripts skip it. That leaves an in-memory `hits` Map (`:210-220`), which is **per function instance** and resets on cold start, with no global or daily cap. Each call carries a ~30 K-char system prompt (RU 44 KB UTF-8, ≈ 10–12 K tokens; prompt caching is requested) and up to 2 gateway calls.
  - (2) `GET /api/assistant` returns `model`, `auth` and `authKind` to anyone (`:383-386`).
  - (3) When Vercel has already parsed the body (`:225`), `MAX_BODY` is not enforced; up to 4.5 MB is walked by `cleanTurns`.
  - (4) `SUPPLIERS_RU` (`site/js/ai/core.js:305`) misses «Хоум Сентр»/«Хоум-центр» and the Arabic «هوم سنتر».
- Fix:
  - Add a Vercel Firewall rate-limit rule on `/api/assistant` plus an AI Gateway budget cap.
  - Return 404 on GET unless `VILLAR_DEBUG` is set.
  - Check `JSON.stringify(body).length <= MAX_BODY` after parsing.
  - Widen the regex: `хоум[\s-]*[сц]ентр\p{L}*`, `هوم\s*سنتر`.

### T13 [P2] The CSP matches the page, but `style-src 'unsafe-inline'` is wider than needed
- Owner: coordinator
- Checked OK:
  - `script-src 'self' 'sha256-NutSao…'` matches the only inline script, the import map. I recomputed the hash and it is identical.
  - There are no other inline scripts and no `eval` or `new Function`. The only `innerHTML` sink is `ui/dom.js:34`, which receives static icon markup.
  - `connect-src 'self'` covers `/api/assistant`, and `img-src data: blob:` covers the thumbnails.
  - With `--csp` the harness logged 0 violations across all runs.
- Issue: `'unsafe-inline'` is needed only for `style="--i:…"` attributes and JS-set custom properties.
- Fix: `style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'`. Add `Cross-Origin-Resource-Policy: same-origin` for `/data/*`.

---

## Checked and OK

- **Data integrity** (`/tmp/rev2/tech/scripts/integrity.mjs`):
  - 141 items. Every item is reachable from some pack's options: 0 unreachable, 0 dangling references, no duplicate ids, every default is in its options.
  - Every layout slot resolves to a key in all 4 packs. Option types match slot types, and no option exceeds `slot.max`.
  - Prices are integers from 65 to 5,879 AED. Dims are positive.
  - The only non-integers are three rug heights (`h: 1.5` cm): `rug-heaton`, `rug-dione`, `rug-marlow`. That is physically right, but it breaks an "integer cm" assumption if any consumer has one.
  - 37 pairings (86 entries) all point to valid options in their pack.
  - Wall art: the options of `art_sofa`/`art_bed`/`art_dining` **do not overlap** in any pack, and their defaults are distinct.
  - No URL, SKU, supplier or base-price fields. The supplier/number regex hit only `colorHex` values.
- **AI index and tests:** `build-ai-index.mjs` in a temp copy produced a byte-identical `api/_catalog.js` (`--check` passes, hash b029afae). `node tools/test-ai.mjs` reports **206 passed, 0 failed**.
- **Persistence migration** (`/tmp/rev2/tech/scripts/persist.mjs`, the real `store.js` with a localStorage shim and real data). I loaded six corrupt v2 saves:
  1. removed ids (`sofa-hadley-3`, `dining-mahmayi-80`, `bed-nazario-160`, `coffee-baku-low`) plus an unknown style `scandi-ghost`, an unknown pack and a bogus key;
  2. old ids under a valid style;
  3. `selections` holding a string, `null` and an array;
  4. truncated JSON;
  5. an array root;
  6. a v1-shaped object.

  Results: **no crash**. Unknown style → default pack. Removed ids are dropped and valid custom picks survive (`nightstand-nazario`, `rug-dione`). `total() == Σ placed == Σ lines()` in every case, all 33/33 slots are filled, and 0 ghost items. Nit: the corrupt save stays in storage until the next change; `save()` only runs on change, so you could call it once after load. The UI and engine reload part of this test did not get a harness slot. The store is the only gate, and both the engine (`furnisher.build` → `store.selected`) and the budget read only through it.
- **External requests:** none. All 129 requests in the request log went to the page's own origin.
- **Light counts are stable within a set:** all lamps are normalised to 2 spots + 1 point, and candles are padded on high. A day-time swap added only the fade variants (+4 programs) and caused no light-state recompile.
- **Photo mode:** start/stop is generation-token based (`photo.js:135-187`), and `stopPhoto()` cancels the deferred start (`index.js:674-702`). Code review only; the runtime start/stop test was dropped for lack of a harness slot.
- **Sky:** `makeSkyTexture` is now 512×256 and runs in 14–72 ms per time in Node (round 1: 180–550 ms).
