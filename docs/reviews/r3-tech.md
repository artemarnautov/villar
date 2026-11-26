# Villar: review round 3, tech and performance (r3-tech)

**Build:** 931e361 (diff baa1f80..931e361, 98 files). **Reviewer:** tech and performance. **Date:** 2026-11-26.
**Harness:** a copy of `tools/shoot.mjs` (`/tmp/rev3/tech/h.mjs`, same flags and lock) that adds an init script (long tasks, paints, frame-colour and probe-SH probes), CDP heap after GC, a request log, a worker list, and an optional COEP header. The COEP header makes `performance.measureUserAgentSpecificMemory()` available, which is how I measured the worker's memory. Logs: `/tmp/rev3/tech/run{A,B,C}.log`. Screenshots: `/tmp/rev3/tech/*.png`.
**Caveat:** SwiftShader on 2 CPUs, medium tier (`hardwareConcurrency` = 2). There is no `KHR_parallel_shader_compile`, so the GPU-path prewarm cannot run here (known #4). I judge from program counts, event logs and code; raw times are for ratios only.

## Verdict

**P0: 0 · P1: 0 · P2: 13** (9 new, plus 4 carried over from round 2: T10 partly fixed, T11, T12 and T13 not fixed). There are **no P0/P1 regressions**.

The round-2 tech P1s are fixed, and I verified each in the harness or with a repro:
- the blue/grey cast;
- the GI watchdog;
- the door race;
- context restore.

Style switches now run a single GI pass, and the room stays consistent under rapid clicks. 11 style switches plus 20 swaps show **no leak** in the page or in the new worker, which stays at 6 MB flat. What is left is polish and hardening:
- wall-colour consistency;
- the lead RPC's abuse surface;
- worker lifecycle;
- console noise after a restore;
- the load and caching work (T11) that is still not done.

**What clearly improved (measured):**
- **Known #1 is gone.** Cashmere + Day clicked in the same tick from Mediterranean + Evening: the frame stays warm-neutral throughout.

  | Point | Frame mean sRGB | b−r |
  |---|---|---|
  | During the wave | 133/103/73 | |
  | During the bake (stand-in) | 175/159/143 | −32 |
  | Settled | 177/169/158 | −19 |

  Round 2 was 80/87/85 for 47 s. AE and WB are constant per time (day gain 0.963/1.004/1.072, exposure 3.0). The fresh bake waits for the wave (`pendingFresh`) and then runs once.
- **A revisit is instant.** Mediterranean + Evening a second time, same tick: the frame at +2.5 s is 84/66/59 against 85/65/55 settled, served from the GI cache.
- **One GI pass per style switch** (0 cancels; round 2 had two passes, one cancelled).
- **The light-set compile on the time switch itself is gone:** `setTimeOfDay('evening')` costs 1 ms synchronously (round 2: 4.1 s). On SwiftShader the first Evening still compiles +30 programs (round 2: +56) and still has a 12.6 s long task, because there is no KHR here (known #4).
- **Programs plateau at 97** after visiting all four packs by day (round 2: 140), because probe captures now keep the environment on.
- **Context loss and restore:** events go `lost → restored → ready` in 5.6 s. The frame and probe SH are identical before and after (176/169/156), the art is intact, there are 0 `no pixels`/`overflow` errors, and thumbnails work again.
- **The furniture worker** loads under the production CSP (`worker-src 'self'`) and costs 6 MB (`measureUserAgentSpecificMemory`, COEP harness).
- `node tools/test-ai.mjs` passes **206/206**, `build-ai-index --check` passes (c8413ad9), and `tools/check-public.mjs` is **clean**.

## Round-2 findings: verification

| ID | Round-2 issue | Status | Evidence |
|---|---|---|---|
| Root cause #1 | Blue stand-in GI + frozen AE/AWB + bake starved by the wave | **Fixed** | `runA.log`: the GI cache (`load` events) and a sun-bounce stand-in (probe c0 0.75/0.61/0.52, warm). Deferral works (`pendFresh: true` while `fader` is active, then one fresh bake). Fixed WB/AE per time. `a-same-0/4s/16s/idle.png`. The stand-in now runs ~20 % brighter and a little warmer than the converged bake (probe luminance 0.64 vs 0.53; b/r 0.69 vs 0.88). That is fine to the eye, and tuning `k` would close it |
| T1 | Watchdog cancels local re-bakes after 4 min (GPU) | **Fixed** (code) | `runLocal` resets `giState.started`, and the stall test skips `probes.reading` (`index.js:1125`). Not reproducible on SwiftShader |
| T2 | Prewarm only at ready; first Evening after a style switch compiles synchronously | **Fixed on KHR GPUs; Partly overall** | `warmObjects` (both light sets + fades, HDR target bound), `queueWarm` after waves and swaps, `prebuildPacks` for other packs, and `setTimeOfDay` awaiting `compileAsync`. All of these return early without `KHR_parallel_shader_compile` → R3-08 |
| T3 | Door finish orphaned by fast double switch | **Fixed** | The Node repro against the 931e361 `architecture.js` + `fade.js` (`/tmp/rev3/tech/nm/door.mjs`) gives correct finish and 1 mesh in all 5 cases, including a 4-click burst. Browser: rapid chips and DW+LO same tick → Cashmere +150 ms both end with `paint` and 1 mesh (`runC.log`) |
| T4 | Restore: art black, GI from blank textures | **Fixed** | `runC.log`, `c-before-loss.png` vs `c-after-restore.png`: identical frame and probe SH, art visible, no texture-upload errors. 24 dead-context `delete` warnings remain → R3-07 |
| T5 | Focus during a wave frames the outgoing model | **Fixed** | Focus on the dining table 60 ms after a Mediterranean switch: the final item `dining-keira-100` is framed at NDC (−0.28, 0), inside the HUD-free area, 12° off the view axis |
| T6 | Stale fade clones | **Fixed** | `cloneFor()` now does `c.copy(m)`. Nit: each reuse wraps `onBeforeCompile` again (`attachSSAO` sees `villarSSAO: false`), so the wrapper chain grows by one per reuse. Harmless (same program key), but reset `c.onBeforeCompile` before `decorate(c)` |
| T7 | Thumbnails during the fly-to | **Fixed** (code) | `quiet()` waits for `controls.moving`/`fader.active`/drag, one per idle slice, with async readback on GPUs. HUD open: 5 of 9 tiles rendered after the flight |
| T8 | Idle prebuild not time-bounded | **Fixed** (code) | Worker builds, re-assembly in ≤ 8 ms slices, no forced `timeout`, `shouldYield`. `prebuildStats().maxSlice` could not be exercised here: `prebuildPacks` is off without KHR, and no focus happened in `runB` |
| T9 | Local re-bakes cancel each other | **Fixed** | `runB.log`: 1 pass (`only [96]`), 0 cancels per style switch. A wall ΔE threshold skips tiny re-bakes |
| T10 | Program count | **Partly** (not addressed; dropped 30 % anyway) | 97 programs after all packs (round 2: 140). Fades are still separate `alphaHash` variants |
| T11 | Load waterfall / caching | **Not fixed** | 146 requests (132 unique), **1,023 KB gzip** (round 2: 964). No `modulepreload`. `/js` and `/css` have no `Cache-Control`. `/vendor` is unversioned. The worker re-requests 14 modules, including three.core (1.4 MB, parsed a second time) |
| T12 | `/api/assistant` rate limit, GET disclosure | **Not fixed** | `api/assistant.js:385-387` still returns `authKind`; the limiter is still per-instance memory |
| T13 | CSP `style-src 'unsafe-inline'` | **Not fixed** | `vercel.json` unchanged (it is still correct for the import-map hash; 0 CSP violations in 3 runs) |

## Leaks and long tasks (re-measured)

`runB.log`: medium tier, by day, heap = CDP after forced GC, worker = `performance.measureUserAgentSpecificMemory()` with COEP.

| Point | Geometries | Textures | Programs | Page heap (GC) | Worker |
|---|---|---|---|---|---|
| Ready | 147 | 119 | 66 | 18.8 MB | 6 MB |
| After 11 style switches (all packs) | 236–266, flat | 161 | 97, flat | 28.0 MB | 6 MB |
| After 20 swaps | 252 | 169 (+8 new art/rug items) | 97 | 28.5 MB (+0.5) | 6 MB |

- After both loops: 33/33 slots consistent, 0 ghosts, 0 leftover fade materials, door and walls match the pack.
- SwiftShader long tasks: swap 29 (max 4.1 s), style switch 85 (max 3.6 s), first Evening 138 (max 12.6 s, no KHR). These are not representative; on GPUs T2's prewarm applies.
- Page load: FCP = LCP = 236 ms (poster), with 24 requests before FCP.

---


---

## New findings

### R3-01 [P2] Lead RPC: anyone holding the publishable key gets unlimited inserts and a relay into the team's Telegram, bypassing every check in `api/lead.js`
- Owner: coordinator
- Repro (code): `db/leads.sql:52-53` grants `EXECUTE` on `submit_lead(jsonb)` to `anon`, and the key is in `api/lead.js:110-111`. That file is not served, but it is in the repository, and publishable keys are public by design.
- Expected: the server-side re-pricing, honeypot and rate limits are the only way in.

  Actual: a direct `POST /rest/v1/rpc/submit_lead` with that key skips all of them.
  - `total` (1–10 M), `items` (any JSON array of 1–80 elements), `style`, `name` and `comment` are taken verbatim; the SQL checks only lengths and formats.
  - The per-phone limit (5/day) is bypassed by rotating numbers.
  - The DB trigger then posts each row to the team's Telegram.

  Realistic impact: low today (the key is not served), but a leaked repo or log turns it into an unlimited spam or phishing channel into the sales chat.
- Fix:
  - `revoke execute … from anon, authenticated; grant execute … to service_role;` and use a **secret** key from env (`SUPABASE_KEY`) in `api/lead.js`. Or make the function require a shared secret: `p->>'k' = current_setting('app.lead_secret')`.
  - Add a global cap in SQL (`count(*) where created_at > now() - interval '1 hour' < 60`).
  - Validate `items` element shape (`id` text ≤ 40, `qty` 1–4, integer `price`/`sum`) and that `total = Σ sum`.
  - Make the Telegram trigger send only those fields.

### R3-02 [P2] `db/leads.sql` does not contain the deployed migration (schema drift)
- Owner: coordinator
- Evidence: `db/leads.sql:55-63` only *describes* migration 2: `style_name`, the new `submit_lead` body and the `notify_lead_telegram` trigger with `pg_net`. It says "full text applied via migration …".
- Problem: the live function and trigger cannot be reviewed or re-created from the repo, and R3-01's fix needs the real body.
- Fix: commit the exact SQL of every applied migration (`supabase db dump --schema public` or the migration file), and re-review the trigger. It must use only server-computed fields, truncate, and send no `parse_mode`.

### R3-03 [P2] Wall colour depends on how you got to a style (paint compensation lost), and the painted door keeps the previous pack's wall colour
- Owner: engine
- Repro (`runC.log`, `runB.log`, `M.wall` colour via `arch.wallColor`):

  | Case | Wall | Pack hex |
  |---|---|---|
  | Dark Walnut at load | #F2EDE4 | |
  | Dark Walnut after a round trip | #ECE7DE | the pack hex |
  | Light Oak after a paint → paint switch | #E4E2D7 | |
  | Light Oak after Mediterranean (limewash → paint) | **#EAE8DD** | |

  The painted entry door showed **#E4E2D7** (Light Oak's walls) in a Cashmere room after a burst (`runC.log` door meshes).
- Expected: one wall colour per pack, whatever the path; a painted door matches the walls.

  Actual:
  - `materials.get('paint', {color})` divides the colour by the detail-texture mean (`applyFixes`). `animateWalls()` (`index.js:910-933`) lerps to the **raw** hex, so the walls end up ≈ 2.5 % sRGB (≈ 5 % linear) darker than at load.
  - When the finish changes (limewash ↔ paint), `prepareWallFinish` creates a fresh *compensated* material, while `animateWalls` animates the outgoing one.
  - `prepareDoorFinish` takes `M.wall.color` at prepare time (before the animation) and is not in `wallMaterials` until commit, so the door is never animated.
- Fix:
  - Animate toward the compensated target, e.g. `materials.get('paint', { color: hex }).color`, and apply it to the incoming wall material when a finish dissolve is pending.
  - Pass `A.walls` into `prepareDoorFinish(finish, A.walls)`.
  - Target: `arch.wallColor` identical for a pack on every path; door == walls when painted.

### R3-04 [P2] Worker lifecycle: never terminated, item caches survive engine dispose, and modules are fetched and parsed twice
- Owner: modeler (`furniture/index.js`) + coordinator (caching)
- Evidence:
  - `buildWorker()` keeps a module-level `WORKER` for the page's life. `dispose()` of the engine (plan fallback, retry) does not terminate it.
  - `ALL_CACHES` (`furniture/index.js:331`) strongly holds every engine's item cache, so a retry after a fatal context loss keeps the old prototypes' geometry in memory.
  - The worker graph re-requests 14 modules (`runA.log` requests: `three.module.js`, `three.core.js`, `materials.js`, `textures.js`, `furniture/*` twice). Under production headers, three comes from the HTTP cache, but the `/js` files revalidate, and three.core (1.4 MB) is parsed again in the worker.
  - The worker's `GLOW` key list (`worker.js:14`) duplicates what `materials.js` decides at runtime, so a new glowing material can make worker and direct builds differ.
- Fix:
  - Export `disposeBuildWorker()` that terminates the worker and clears `CACHES`/`ALL_CACHES` for that materials library, and call it from engine `dispose()`.
  - Terminate after ~60 s idle and recreate on demand.
  - Fold the worker graph into T11's caching or versioning.
  - Have `materials.js` export the glow key set.
- Checked OK:
  - **One three instance per realm.** Every module of the worker graph imports `../../../vendor/three/three.module.js`, which is the same URL as the import map's `three`, so there is no second instance on the main thread.
  - **No bare specifiers in the worker graph.** Import maps don't apply in workers.
  - **Transfers are safe.** Attribute and index buffers are transferred, and no generator keeps module-level geometry.
  - **Fallback.** `onerror` → main-thread builds. Art falls back when `OffscreenCanvas` 2D is missing.
  - **CSP.** `worker-src 'self'` allows it.

### R3-05 [P2] A second style switch during a dissolve snaps every in-flight furniture fade
- Owner: engine
- Repro: click a style, then another within ~1 s, with a door or wall finish change (e.g. DW → Light Oak → Cashmere).
- Expected: only the door/wall dissolve is finished early.

  Actual: `applyPackArchitecture()` serialises with `fader.flush()` (`index.js:871`, `:886`). `flush()` sets `t0 = -Infinity` on **all** runs, so every furniture item mid-dissolve from the first wave pops to its end state in one frame.
- Fix: keep the door/wall run handle (`fader.swap` → return `run`) and add `fader.finish(run)`, which flushes only that run.

### R3-06 [P2] Released textures are still uploaded without pixels in normal use
- Owner: modeler
- Evidence: `runB.log` has **2 × `WebGL: INVALID_VALUE: texSubImage2D: no pixels`** during style switches and swaps with **no** context loss (round 2: 4). `healOnUpdate` regenerates them afterwards, but the GL texture holds undefined or zero texels until then (a black flash for that material on the frames in between).
- Fix: in `releaseAfterUpload`, keep a 1-texel placeholder or the `{ width, height }` with a placeholder fill until the heal finishes, rather than `null`. Or log `t.name` in `healOnUpdate` to find the re-upload source (most likely a second GL texture created for the same `Source`, e.g. a `scaled()` clone with a new sampler key). Target: 0 such warnings over `runB.json`.

### R3-07 [P2] Context restore logs 24 "object does not belong to this context" warnings
- Owner: engine
- Evidence: `runC.log` after `restoreContext()` shows 12 × `delete` and 12 × `deleteVertexArray: object does not belong to this context`. Something still disposes geometries or render targets created by the dead context: `reallocate()` covers textures, but not geometries/VAOs or the post render targets.
- Fix: on `webglcontextlost`, mark `geometry.__villarDead = true` for the scene, or follow lighting/probes and drop handles without `dispose()`. SPEC: "No console errors". Target: 0 WebGL warnings over lose → restore.

### R3-08 [P2] Without KHR_parallel_shader_compile nothing is warmed after a style switch (T2 residual)
- Owner: engine
- Evidence: `warmObjects()`, `queueWarm()` and `prebuildPacks()` return early when `!parallelCompile` (`index.js:1161`, `:1175`, `:1215`). On such a browser, and in this harness, the first Evening after a style switch compiles synchronously: **+30 programs, 12.6 s max long task** here. The revisit Mediterranean + Evening compiled +33 (evening fade variants).
- Note: Chrome and Edge expose KHR. Check Safari and Firefox on the team's devices; if either lacks it, this is a P1 for those users.
- Fix: on non-KHR, run the per-object `renderer.compile` for the other light set from `requestIdleCallback` after each wave, one group per idle callback with `timeRemaining() > 30`. That is the same as `prewarm()`'s else branch, re-triggered by `flushChanges`. Target: ≤ 5 synchronous programs on the first Evening after any style switch.

### R3-09 [P2] An AI style switch (`fresh`) discards that pack's remembered picks, and Undo cannot bring them back
- Owner: coordinator (store) + assistant
- Repro: customise Light Oak (e.g. another sofa), switch to Dark Walnut by chip, then ask the AI line "light oak style". `setStyle(id, { fresh: true })` (`store.js:126-148`) overwrites `selections['light-oak']` with the defaults. Undo (`assistant.js:308-311`) restores Dark Walnut only, so the Light Oak sofa choice is gone. The manual chip path keeps it.
- Fix: before a `fresh` switch, keep `selections[target]` in the batch (`b.beforeTarget`). On undo, call `store.restore` for the previous style **and** put the target pack's selection back. Alternatively make `fresh` non-destructive: apply the curated set without writing it into the remembered per-pack state until the user accepts.

### Carried over (round 2, still open)
- **T10 [P2]** Fades are still separate `alphaHash` program variants. The count dropped to 97 anyway; the uniform-dither suggestion from round 2 still applies.
- **T11 [P2]** No `modulepreload`, `/js` and `/css` revalidated on every visit, `/vendor` unversioned. 146 requests / 1,023 KB gzip now, including the worker's duplicate fetches.
- **T12 [P2]** The `/api/assistant` GET still discloses `authKind`; the rate limit is per instance; there is no spend cap. The Russian supplier regex in `api/_deny.js` still misses «Хоум Сентр».
- **T13 [P2]** `style-src 'unsafe-inline'` could be `style-src-attr`.

---

## Checked and OK (new code)

- **Store** (`store.js`): per-style memory (`{ ...defaults, ...selections[id] }`); `restore(snap)` validates every id against the target pack's options and re-emits `style`/`change` with `reason: 'restore'`, which the engine stages as a wave; `applyStyle()` dedupes. The `fresh` caveat is R3-09.
- **AI Undo** (`assistant.js:303-325`): reverts only picks still as the AI set them, uses `store.restore` for style batches, and no-ops if the user has since moved to a third style. A style + time undo is exactly the same-tick case of known #1, which is now safe (see the verification table).
- **`/api/lead`:**
  - Origin check.
  - `MAX_BODY` now enforced even on pre-parsed bodies (better than `/api/assistant`).
  - Honeypot and fill-time checks return a silent 200.
  - `clean()` strips control characters and `<>`.
  - Server-side re-pricing from `_catalog.js` (unknown style → default; removed ids → pack defaults; verified with `validate()` probes).
  - Telegram text is sent without `parse_mode`.
  - Generic errors.
  - The rate limit is per instance, the same as T12.
- **SQL:** RLS on with no policies; `revoke all` from anon/authenticated; `SECURITY DEFINER` with `set search_path = public`; `revoke … from public`; per-phone daily limit; format and length checks. Abuse surface: R3-01.
- **Supplier deny list:** `api/_deny.js` is server-only and registered via `addDenyPatterns`. `tools/check-public.mjs` is clean on `site/` (vendor and lab excluded; `/lab` redirects in production).
- **CSP:** the import-map hash still matches; `boot.js` is an external classic script (no new inline); the worker is same-origin; 0 CSP violations in 3 `--csp` runs.

