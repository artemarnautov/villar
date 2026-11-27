# Villar: review round 4, tech and performance (r4-tech)

**Build:** 5c4e5d8 (diff 931e361..5c4e5d8: 220 files, 149 of them assets). **Reviewer:** tech and performance. **Date:** 2026-11-27.
**Harness:** the round-3 instrumented copy of `tools/shoot.mjs` (`/tmp/rev4/tech/h.mjs`, same flags, always behind `flock /tmp/villar-shoot.lock`). It adds an init script (long tasks), CDP heap after forced GC, and `inst4.js`. `inst4.js` wraps `fader.swap` to count concurrent dissolves and **overlaps**, meaning the same group in two dissolves at once. It also counts store `plan`/`change`/`pins` events, Undo toasts, and slider `grab`/`release`, and it estimates texture memory. Node checks of the planner, store and lead path: `/tmp/rev4/tech/{planner,drops,frozen,prime,r309}.mjs` (outputs next to them).
Runs:
- `runA` (desktop: slider level jumps and races);
- `runB` (desktop: 10 style switches, a style burst, 20 swaps, walls and doors);
- `runC` (phone 390×844 @2×, touch: a drag, a tap, a focus flight, reset, context loss).

Logs are `/tmp/rev4/tech/run{A,B,C}.log`. Screenshots are `/tmp/rev4/tech/{a-ready,a-min,a-max,a-undo-race,a-style-gesture,c-phone-ready,c-after-drag,c-focus-race,c-after-restore}.png`. `runB` hit the 590 s cap during its last step, so the post-swap GC heap and console tail are missing (the swap-loop counts are in).
**Caveat:** SwiftShader, 2 CPUs, no `KHR_parallel_shader_compile`. Desktop is the medium tier (scans at 1024) and phone is the low tier (scans at 512). I judge by counts and code, not by seconds. The harness queue was about 80 min long this round, so I made 3 runs, not 6.

## Verdict

**P0: 0 · P1: 2 · P2: 13** (9 new, plus 4 carried: R3-04, T11, T12 and T13).

The slider plumbing is solid:
- one Undo per gesture;
- coalesced, capped dissolves with 0 overlaps in a full touch drag;
- the room is consistent after every race I could provoke;
- no leaks across 10 style switches and 20 swaps;
- a clean context restore.

Two P1s remain:
1. **The planner breaks its own contract once the customer pins a common item in the default style.** Right then *downgrades* a piece and breaks a pairing, and the slider's binary search can land on a poorer room.
2. **The lead RPC is still callable with the public key.** The new global cap turns that into a one-script way to block every real lead for an hour.

Texture memory from the photoscans is the main new performance risk: ≈ 230 MB for the default room on desktop and tablets, ≈ 313 MB after visiting all styles.

**What clearly improved (measured):**
- **R3-03 is fixed.** On every path (10 switches, a 4-click burst), all 30–40 wall/skirting/painted-door materials sit exactly on their pack target (`off: 0`, `runB.log`). Painted doors equal the walls.
- **R3-07 is fixed.** Lose → restore → ready, then a swap: **0** "object does not belong to this context" warnings (round 3: 24). Scans re-decode from their kept blobs: 52 files re-uploaded (`runC.log`).
- **R3-09 is fixed.** An AI `fresh` switch followed by Undo brings back the other style's sofa *and* its budget nulls (`r309.mjs`).
- **R3-02 is fixed.** The deployed `submit_lead`/`notify_lead_telegram` bodies and the trigger are functionally identical to `db/leads.sql` migration 3 (read-only `pg_proc` query; grants match).
- **The slider gesture model holds up** (phone, a touch drag from the thumb min → max, 80 moves):
  - 46 `plan` events (≤ 7 changes each);
  - 1 grab / 1 release / **1 Undo toast**;
  - 85 dissolves, **max 6 concurrent** (cap 8), **0 overlaps**;
  - 33/33 consistent, 0 ghosts, 0 leftover fade materials;
  - camera controls disabled during the gesture and re-enabled after.
- **Planner fundamentals** (no pins, all 4 packs):
  - deterministic (item order reversed gives the same ladder);
  - monotonic totals and per-key monotonic;
  - passes exactly through the designer room (`defaultIndex` == the curated selection);
  - dependencies respected;
  - build 0.3–0.8 ms (cold 4.4 ms, worst with 6 random pins 10.9 ms, Node on this box);
  - parity with `ai/core.js planBudget` exact for 7 amounts × 4 packs, with and without a pin.
- **Lead path treats `null` as "not included".** Two nulls give 28 items / 32,885 AED instead of 30 / 36,243, and an all-null room gives `invalid:room`.
- **Persistence v3** round-trips nulls and pins. A v2 save loads as "no nulls, no pins".
- `node tools/test-ai.mjs`: **212/212**. `build-ai-index --check`: up to date (8ff56a1e). `check-public`: **clean**.

## Round-3 findings: verification

| ID | Round-3 issue | Status | Evidence |
|---|---|---|---|
| R3-01 | Lead RPC callable with the public key | **Partly** | Migration 3 (deployed, verified) adds shape checks for item elements, `Σ sum = total`, a 60/h global cap, a 5/day per-phone cap, and a Telegram flood stop at 21/h. But `EXECUTE` is still granted to `anon, authenticated` (live `routine_privileges`: `anon:EXECUTE`), and `api/lead.js:111` still falls back to the publishable key. The new global cap creates a DoS lever → **R4-02 (P1)** |
| R3-02 | `db/leads.sql` ≠ deployed DB | **Fixed** | `pg_proc.prosrc` of both functions matches migration 3 line for line (only one SQL comment differs). The trigger is `AFTER INSERT … EXECUTE FUNCTION notify_lead_telegram()` |
| R3-03 | Wall colour depends on path; door keeps the old wall colour | **Fixed** | `arch.wallTargets()` + `prepareDoorFinish(finish, A.walls)`. `runB`: 10 switches + burst, every wall material equals its target (`off: 0`), and painted doors = skirting = target. Mediterranean reads `#f9f5ec` before and `#fffff7` after its limewash scan lands. That is the intended scan re-compensation (map mean 0.85), not a path effect |
| R3-04 | Worker never terminated; global caches; double fetch | **Not fixed** | No `disposeBuildWorker`. `ALL_CACHES` is still module-global (`furniture/index.js:331`), and the `GLOW` list is still duplicated (`worker.js:14`) |
| R3-05 | Second switch snaps every furniture fade | **Fixed** (code) | `fader.finishTag(wallRun/doorRun)` finishes only the door/wall runs. `flushedTags` covers a run still compiling. But see R4-05: furniture can still be in two dissolves at once |
| R3-06 | `texSubImage2D: no pixels` in normal use | **Not reproduced** | `releaseAfterUpload` is unchanged, but there were **0** such warnings in `runA` (6 jumps, Undo, a style switch) and `runC` (drag, tap, reset, lose/restore). Round 3 saw 2 in its style/swap loop; this round's equivalent (`runB`) lost its console tail to the time cap, so re-check it once with `runB.json`. Not counted as open |
| R3-07 | 24 dead-context warnings on restore | **Fixed** | `forgetDeadContext()` + a global dispose filter. `runC`: 0 warnings after restore + swap. Note: it patches `THREE.EventDispatcher.prototype.dispatchEvent` globally after the first restore (cheap, but it is a vendor monkey-patch; leave a comment in `vendor/README`) |
| R3-08 | No warm-up without KHR | **Fixed** (code), not measurable here | `warmSync()` compiles one object × light set × (plain/fade) per idle slice and waits while anything moves. Gated by `canWarm()` = KHR or not software GL, so it is off in this harness. Each slice still compiles a whole group synchronously (arch/skyline can be many programs), so expect 100–500 ms idle tasks on non-KHR browsers |
| R3-09 | AI `fresh` switch loses the other style's picks | **Fixed** | `apply()` snapshots `memory`, and `undo()` passes it to `store.restore`. Node repro: Light Oak sofa `sofa-anders-3` + mirror `null` survive fresh → Undo → back. Residue: stale pins (R4-11) |
| T11 | No caching / modulepreload | **Not fixed** | `vercel.json` unchanged. 149 new asset files (≈ 19 MB) now also revalidate on every visit → R4-08 |
| T12 | `authKind` disclosed, per-instance limiter, «Хоум Сентр» | **Not fixed** | `api/assistant.js:392`. `api/_deny.js:4` still has `хоум\s*центр` only |
| T13 | `style-src 'unsafe-inline'` | **Not fixed** | `vercel.json` unchanged (0 CSP violations in 3 runs) |

## Measurements

### Leaks and counts (desktop, medium tier, by day; heap = CDP after forced GC)

| Point | Geometries | Textures | Programs | Page heap (GC) | Scan sets on GPU (est.) |
|---|---|---|---|---|---|
| Ready (Dark Walnut) | 153 | 168 | 94 | 23.0 MB | 15 sets @1024 ≈ **228 MB**, 6.8 MB downloaded (45 files) |
| After 10 style switches (all packs) | 242 → 271, flat from switch 3 | 181 → **220, flat** from switch 4 | 118 → **125, flat** | 32.2 MB | 20 sets ≈ **313 MB**, 10.0 MB downloaded (61 files) |
| After a 4-click burst + 20 swaps | 253–265, flat | 221 → 225 (+4 new rug/art items) | 125 | (run capped) | 20 sets |
| Phone (low tier) after drag, tap, focus, reset | 258 | 180 | 113 | 29.1 MB | 17 sets @512 ≈ 45 MB in scene |
| Phone after context restore | 155 | 126 | 66 | (GC not taken) | 52 files re-uploaded, max upload 11.5 ms |

- **No leak.** Geometries, textures and programs plateau once each pack has been seen. Heap +9 MB over 10 switches (round 3: +9.2). After the burst and after every race: 33/33 placed, 0 ghosts, 0 fade materials, 0 duplicate door meshes, lamps correct.
- Programs: 94 at ready (round 3: 66) and a 125 plateau (round 3: 97). That is +28 to +31, from the scan sets' alpha/normal variants, the reserve lights and the new dissolve variants. It is still flat, so T10 is unchanged in kind.
- Scan uploads on SwiftShader: max 134 ms per 1 k texture (`texImage2D` + mipmaps); max decode 7.9 s (off-thread, includes queueing). On a GPU, expect 3–10 ms per 1 k upload; that is fine at one per slice.
- **Overlaps (new instrument).**
  - 8 in 10 style switches, all `slot:bedding`;
  - 16 in the 4-click burst (bedding, art);
  - 3 in "Home, then Reset 300 ms later" (curtains, table lamp, nightstand);
  - 0 in a pure slider drag.

  See R4-05.

### Slider level jumps (desktop, focus `[role=slider]`, Home/End × 3, `runA.log`)

Each row starts from the previous room. Programs, geometries and textures are read after idle.

| Jump | Changes (1 `plan`) | Dissolves | Max concurrent | Overlaps | Undo toasts | To idle (SwiftShader) | Long tasks: n / max | Programs | Geometries | Textures |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 Home (→ 6 items, 7,852 AED) | 28 | 22 | 8 (cap) | 0 | 1 | 45.8 s | 39 / 3.0 s | 114 | 162 | 173 |
| 2 End (→ 33 items, 41,451 AED) | 30 | 22 | 8 | 0 | 1 | 44.4 s | 85 / 4.0 s | 116 | 227 | 183 |
| 3 Home | 30 | 22 | 8 | 0 | 1 | 39.7 s | 30 / 3.1 s | 116 | 227 | 183 |
| 4 End | 30 | 22 | 8 | 0 | 1 | 49.0 s | 81 / 4.0 s | 116 | 227 | 183 |
| 5 Home | 30 | 22 | 8 | 0 | 1 | 39.0 s | 26 / 3.0 s | 117 | 227 | 183 |
| 6 End | 30 | 22 | 8 | 0 | 1 | 43.2 s | 82 / 3.8 s | 117 | 227 | 183 |

- **No leak.** Counts are flat from jump 2. GC heap went 23.0 → 27.4 MB over the 6 jumps. That includes 2 scan sets first needed by the premium room (bouclé, wicker: 15 → 17 sets, ≈ 228 → 265 MB of textures), loaded lazily at the first End.
- After every jump: 33/33 (or 6/6) consistent, 0 ghosts, 0 fade materials, lamps correct, GI `ok`. The "ghosts" the checker lists at the minimum are the intentional `lamp-light-reserve` lights.
- The minimum room is sofa, bed, mattress, bedding, curtains and TV unit, as the brief says. `aria-valuetext` reads "36,243 AED, Magazine-ready, 33 items". The thumb is 28 px on a 44 px rail with `touch-action: pan-y`.
- End costs about 3× the long tasks of Home (≈ 82 vs ≈ 30). Both build 22 slots, but End builds the premium pieces, and on GPUs part of that cost remains because the premium pieces are not primed (R4-06). The seconds are SwiftShader compile time and are not representative.
- **Undo race.** Home, then the toast's Undo 1.15 s later while dissolves were still running: 30 `restore` changes, final room 33/33, 0 overlaps in this instance. The same race with Reset produced overlaps (R4-05).
- Across the whole run: 9 slider gestures gave 9 `grab`, 9 `release` and **9 Undo toasts** (one per gesture). No `texSubImage2D: no pixels` warnings, and 0 CSP violations.

---

## Findings

### R4-01 [P1] Planner: one pinned item in the default style makes "right" downgrade a piece, break a pairing, and makes `ladderIndexFor` pick a poorer room
- Owner: coordinator (`site/js/core/budget.js`)
- Repro:
  1. Dark Walnut. Pick the side table "Moxie" (or Tom or Arras), or the coffee table "Selric", in the HUD. That pins it.
  2. Drag the slider from Move-in ready toward Magazine-ready.
  3. Or Node: `buildLadder({pack: dark-walnut, pinned: {side_table: 'side-moxie'}})` (`/tmp/rev4/tech/drops.mjs`).
- Expected (BUDGET.md): moving right only adds or upgrades, pairings hold, and the slider lands on the richest step ≤ budget.
- Actual:
  - Step 28, `coffee_table → designer`, swaps `coffee-selric` (3,191, the pairing of the pinned `side-moxie`) for `coffee-moxie` (2,675). The total drops 32,693 → 32,177 while moving right, and the room ends up with the `side-moxie` ↔ `coffee-moxie` pair that the pack's pairings forbid.
  - The same happens for each of the 4 single pins listed above.
  - Over 300 random 1–6-key pin sets: **27/300** Dark Walnut ladders and 1/300 Cashmere ladders have a total drop. In **16/300**, `ladderIndexFor` (binary search, which assumes sorted totals) returns a poorer step than a linear scan for some budgets.
  - Dragging across the dip flips the coffee table back and forth.
- Evidence: `/tmp/rev4/tech/drops.mjs` output (`singlePinDrops_darkWalnut`, `downgradeSteps: 27`, `laddersWhereBinarySearchMissesRicherStep: 16`).
- Cause: step 3 (`budget.js:123-124`) commits `curated(k)` and `withCompanions(curated)` without the pairing check that step 4 has (`conflicts()`, `budget.js:128-133`). A fixed (pinned) partner's pairing therefore loses to the curated pick.
- Fix:
  - Move `conflicts()` above step 3. In both upgrade loops, skip `k → designer` when `conflicts(k, curated(k))` is true or when `curated(k).price < sel[k].price`, and use `pairFor(k)` as that key's "designer" item when a fixed partner dictates it.
  - Make the ladder monotonic by construction: `commit()` refuses a step whose total is below `run`. Optionally make `ladderIndexFor` a linear scan for the last step with `total ≤ budget` (≤ 50 steps).
  - Target: 0 total drops, 0 per-key downgrades and 0 pairing violations over 1,200 random pin sets × 4 packs, as a `tools/test-budget.mjs`. The script is ready to copy.
- Related nit: the memo key (`budget.js:188`) maps a pin value `undefined` to the same key as `null` (`JSON.stringify`), so `{sofa: undefined}` returns the sofa-empty ladder. That is harmless today because `pinnedMap` uses `?? null`. Filter out `undefined` before building the key.

### R4-02 [P1] Lead pipeline: the public key can still call `submit_lead`, and the new caps let one script block all real leads (60/h) and silence Telegram (21/h)
- Owner: coordinator (`db/leads.sql`, `api/lead.js`, Vercel env)
- Repro (code plus live metadata, nothing sent):
  - `routine_privileges` on the live DB: `submit_lead` → `anon:EXECUTE, authenticated:EXECUTE`.
  - The key is in `api/lead.js:111`, and `db/leads.sql:64` itself says it "lives in a public repo".
  - Migration 3 raises `busy` once 60 leads exist in the last hour (`leads.sql:81-83`), counting *all* rows. The trigger goes silent after 21 per hour (`:131-133`).
- Expected: nobody outside `api/lead.js` can write leads, and real customers are never blocked by strangers.
- Actual:
  - 60 well-formed `POST /rest/v1/rpc/submit_lead` calls per hour, each with a rotating phone and self-consistent items (any names ≤ 120 chars, any prices), make every real customer's `store()` fail for the rest of the hour.
  - `api/lead.js:188-193` then answers 503 unless the `TELEGRAM_*`/`RESEND_*` env fallback is configured.
  - Even below 60, 22 junk rows silence the team's Telegram for an hour, so real leads go unannounced.
  - Junk item names and comments still reach the sales chat (up to 20/h).
- Fix:
  - `revoke execute on function public.submit_lead(jsonb) from anon, authenticated; grant execute … to service_role;`
  - Put the **secret** key in Vercel env `SUPABASE_KEY`, and delete the publishable fallback (`api/lead.js:110-113`). Rotate the publishable key, since it is in git history.
  - Keep the caps as a safety net only.
  - Make sure `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are set on Vercel, so a DB outage still reaches the team.
  - Target: an anon RPC call returns 401/permission denied; `api/lead.js` still stores (test once with a real lead).

### R4-03 [P2] Prototype-named pins (`constructor`, `toString`, …) crash the planner on the server (500 after a paid model call) and on the client
- Owner: assistant (`api/assistant.js`) + coordinator (`core/budget.js`, `ai/core.js`, `core/store.js`)
- Repro:
  - Node: `sim.planBudget('dark-walnut', 20000, {pins: ['constructor']})` and `sim.applyActions({…pins: ['constructor']}, [{type: 'budget', amount: 20000}])` both throw `Cannot read properties of undefined (reading 'includes')` (`planner.mjs` → `simProto`, `applyProto`).
  - `cleanState()` (`api/assistant.js:270`) lets `constructor`, `toString`, `__proto__` and `valueOf` through, because it checks `keys[k]` rather than an own property.
  - On the server, `sim.applyActions` (`:459`/`:471`) runs after the gateway call and outside any `try`. A request with `state.pins: ["constructor"]` and «уложись в 20000» therefore spends tokens and then returns an unhandled 500.
  - Client: `store.pin('constructor')`, or a tampered v3 save (`store.js:74`, `:191`, `:258` use `slots?.[k]`), makes `planner.ladder()` throw on every slider sync.
- Fix:
  - Use `Object.hasOwn(obj, k)` for every key-from-input check: `cleanState`, `planBudget` (`ai/core.js:235`, both `p.slots` and `norm`), `normalizeSelection`, `buildLadder`'s pin filter (`budget.js:34`), and the store's `validFor`/`pin`/load/`restore`.
  - Wrap the post-gateway part of the handler in `try { … } catch { return fail(res, lang, 'bad_request') }`.
  - Add the 4 names to `tools/test-ai.mjs`.

### R4-04 [P2] A style switch during a slider gesture applies the OLD style's frozen ladder to the new style
- Owner: interface (`site/js/ui/budget-slider.js`)
- Repro:
  - Node (`frozen.mjs`): `begin('key')` → End in Dark Walnut → `setStyle('light-oak')` → Home → `end()`. The result is a Light Oak room that is on **no** Light Oak step (`indexOfSelection = -1`), 24 nulls, 7,897 AED (Light Oak minimum 7,180).
  - Browser (`runA`): this did *not* reproduce. On SwiftShader, End's synchronous rebuilds blocked the main thread past the 1 s key window, so the gesture had already ended (`dragging: false`) when the chip switch ran, and Home then used the Light Oak ladder correctly (7,180 AED, on the ladder). The race needs the gesture to still be open when the style changes.
  - Real-world triggers:
    - the AI or any programmatic switch while the 1 s key-gesture window is open;
    - Safari, where clicking a chip does not blur the thumb, so the window stays open;
    - multi-touch (one finger on the dock thumb, one on a style chip).
- Expected: a style switch ends the gesture; the next step uses the active style's ladder.
- Actual: `ladder()` returns `frozen` (`budget-slider.js:29`) whatever style is now active. `validFor` keeps the nulls and drops the foreign ids, so the room is a mix.
- Fix:
  - `const ladder = () => (frozen && frozen.packId === store.styleId() ? frozen : planner.ladder(store.style(), pinnedMap()));`
  - In the controller, `store.on('style', () => { if (gesture) end(); })`.

### R4-05 [P2] The same furniture group can be in two dissolves at once (style waves, bursts, Undo/Reset/AI-undo during slider dissolves); it pops instead of dissolving
- Owner: engine (`site/js/engine/index.js`)
- Repro, measured with `inst4.js` overlap counting:
  - `runB`, 10 chip-style switches: **8 overlaps, all `bedding`**. The wave's root filter (`flushChanges`, `roots = ids.filter(id => !ids.includes(slot.attach.slot))`) only checks the *direct* host. When bed and bedding change but the mattress does not (the mattress is the same default in all packs), bedding is rebuilt once as a descendant of bed and again as its own root.
  - `runB`, 4-click burst: 16 overlaps.
  - `runC`, Home then Reset 300 ms later: 3 overlaps (curtains, table lamp, nightstand). `reason: 'reset' | 'restore' | 'undo'` goes through `pendingChanges` → `swapSlots(all ids)` at once (`index.js:1093`), ignoring `budget.inflight`.
  - The pure slider path had 0 overlaps.
- Expected: each slot dissolves once; a later wish waits for the running dissolve (the "latest wins" rule the budget path already follows).
- Actual:
  - The second run's `dress()` skips meshes already wearing fade clones (`fade.js:38`), so the group has nothing to fade and goes `visible = false` at the end of the second run: a pop.
  - The bedding is also built twice per switch.
  - The final state is still consistent (33/33, 0 ghosts), so this is visual, not structural.
  - Undo/Reset/restore also dissolve the whole room in one `swapSlots` call: up to ~25 items in one synchronous rebuild, with no stagger and no cap. The slider path caps at 8 with 45 ms stagger.
- Fix:
  - In the wave: `roots = ids.filter(id => !ancestorsOf(id).some(a => ids.includes(a)))`, the same helper the budget path uses.
  - Route every `applyPlan` origin (`budget`, `restore`, `reset`, `undo`) through `budgetQueue` (keep a `PLAN_REASONS` set and remember the reason in `onPlan`).
  - In `swapSlots`, move ids that are in `budget.inflight` into `budget.pending` instead of rebuilding them.
  - Target: 0 overlaps over `runB.json` and the reset/Undo races.

### R4-06 [P2] Slider warm-up primes the 60 cheapest options, not the ladder: 11 of 26 Dark Walnut ladder items (the premium end) build and compile on the main thread on the first End
- Owner: engine (`primeBudget`, `index.js:1119-1131`) + modeler (cache size)
- Evidence (`prime.mjs`):
  - Dark Walnut has 79 non-room options; the ladder uses 26 of them.
  - The cheapest-60 rule leaves out `sofa-daventry-3`, `sofa-brighton-3`, `bed-maison-160`, `mattress-bliss-gel-160`, `dining-square-80`, `coffee-arras` and 5 more. These are exactly the heavy generators and the hero pieces that End/PageUp bring in.
  - The other packs are fully covered.
  - The item cache is `CACHE_MAX = 64` (`furniture/index.js:332`) against 33 placed items plus up to 60 primed ones, so primed prototypes evict each other before use.
- Expected (BUDGET.md): "no long tasks during drag on GPU". A drag only clones.
- Fix:
  - Prime the active ladder's items: `new Set(ladder.steps.flatMap(s => Object.values(s.selection)))` minus the room, ordered outward from the current index. Pass them from the UI (`villar.prebuildItems(ids)`), or let the engine import `core/budget.js` with `data.budget`.
  - Re-prime on `pins` change.
  - `setItemCacheSize(placed + ladderItems + 16)`, ≈ 96 on high.
  - Target: on a GPU, 0 synchronous `buildItem` calls during a min→max drag (count them via a `furniture/index.js` stat, like `prebuildStats`).

### R4-07 [P2] Photoscans: ≈ 16 MB of GPU memory per set on medium/high, never released; 230 MB for the default room, 313 MB after all styles; tablets get the full 1 k
- Owner: modeler (`textures.js`, `materials.js:213`)
- Evidence:
  - `runB` estimate: RGBA8 + mips, 3 maps per set (4 for wicker).
  - Ready (Dark Walnut): 15 sets @1024 ≈ **228 MB**. After 10 switches: 20 sets ≈ **313 MB**. 40 scan textures are in the live scene (179 MB); the rest stay uploaded in `texCache`.
  - `deviceCap()` puts iPads, Android tablets and ≤ 4 GB devices on **medium**, and `setScanTier` gives medium **1024**, the same as high. Only phones (low) get 512 (`runC`: 17 sets ≈ 45 MB in scene).
  - Roughness is uploaded as RGBA although only one channel is read.
  - On iPadOS, a 300 MB+ texture set plus render targets is a real context-loss risk (the restore path now works, but it is a visible reset).
- Fix (cheapest first):
  - Medium → 512 scans (`setScanTier(quality === 'high' ? 2048 : 512)`), or choose by `navigator.deviceMemory`.
  - Upload rough (and the wicker alpha) as `THREE.RedFormat`. WebGL2 accepts `ImageBitmap` sources for `R8/RED`, which saves 25 % per set.
  - Release sets no material of the active style has used for 2 min: refcount in `materials.js`, `dispose()` the scan textures, and re-decode from the kept blob on return (the T4 path already does this).
  - Longer term: KTX2 (UASTC normals, ETC1S albedo and rough), ≈ 4–6× less GPU memory and no main-thread mip generation.
  - Target: ≤ 64 MB of scan textures on medium after visiting all 4 styles, and ≤ 120 MB on high.

### R4-08 [P2] New assets (≈ 19 MB: 131 material JPEGs, 4 HDRs, 12 facades) have no long-lived caching; first 3D waits for the scans
- Owner: coordinator (`vercel.json`) + modeler (`tools/materials-prep.mjs`, `sky.js`)
- Evidence:
  - `vercel.json` has rules for `/vendor` and `/data` only, so Vercel's default `public, max-age=0, must-revalidate` applies. A return visit revalidates every scan the style uses (45 requests for Dark Walnut) plus the HDRs and facades.
  - Ready waits for `texturesSettled`. That includes `SCAN_PENDING` (`textures.js` `pendingTextures()`) through `watchTextures()` (`index.js:1878`, a 30 s race). On a first visit, 6.8 MB of Dark Walnut scans therefore sit between the poster and the live room (≈ 5 s at 10 Mbit/s).
- Fix:
  - Version the URLs: `materials-prep.mjs` writes `files[k] = "walnut/albedo_1k.jpg?v=<sha1-8>"`, and `SKY_HDR` and city URLs get the same `?v=`.
  - Then add exactly:
    ```json
    { "source": "/assets/materials/(.*)\\.jpg", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/assets/sky/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/assets/city/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/assets/materials/index.json", "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }] }
    ```
  - Until the URLs are versioned, use `public, max-age=604800, stale-while-revalidate=2592000` on the same three folders.
  - Verify with `curl -I` after deploy, since overlapping Vercel header rules are merged.
  - Stop gating `ready` on scans. They already swap in place without recompiles, and `watchTextures()` re-bakes GI once they land. Keep `SCAN_PENDING` out of the ready gate, and only `rebakeAll` when they arrive.
  - Target: a repeat visit makes 0 asset requests; time to ready on a first visit is independent of scan bytes.

### R4-09 [P2] Idle path tracer (`?pt=on`): a still can go stale without input (scans, facades, GI blend, wall animation)
- Owner: engine (`index.js:1012-1017`, frame loop)
- Checked OK:
  - It is off by default: `REFINE.on` needs `?pt=on` (not software GL) or `?pt=force`. No watcher runs and `three-gpu-pathtracer` is not imported until it starts.
  - Every input, camera move, store change, time change and resize cancels it (`refineInput`), with a generation token across the async `load()` and the `setTimeout(30)`.
  - Lost context drops the tracer.
- Problem:
  - While holding, raster passes are skipped (`post.js:392`). Several scene changes neither cancel nor restart it: a scan set landing (`watchTextures` → `sceneVersion++` only), a facade photo (`skyline.onTextures` → `sceneVersion++` only), the end of a wall-colour animation, and a GI blend after a late local bake.
  - `refineAllowed` does not check `materials.pending()`, so a refine can start with procedural maps and hold them until the next input.
- Fix:
  - Add `materials.pending?.() === 0` to `refineAllowed`.
  - In `frame()`, if the refine's version differs from the current `${sceneVersion}|…`, call `cancelRefine(true)`; the watcher restarts it.

### R4-10 [P2] Reserve lamp lights take shadow slots when there are fewer real lamps than slots
- Owner: engine (`furnish.js` `makeGhost`, `assignLampShadows`)
- Evidence: a ghost's down spot has `shadowPriority 0.5`. At Minimum/Essentials in the evening, with fewer than `maxLampShadows` real lamps, the 0-intensity reserve spots get `castShadow = true`. Each shadow update then renders up to 2 spot shadow maps for lights that emit nothing.
- Fix: keep the *count* of shadow-casting spot lights constant, which the program key needs, but put the slot on a light with `intensity > 0` when one exists. Otherwise set the ghost's `shadow.autoUpdate = false` and skip its map with a 1×1 shadow `mapSize` (the shader count is unchanged).

### R4-11 [P2] An AI `fresh` style switch leaves the target style's old pins on curated items
- Owner: coordinator (`store.js` `setStyle({fresh})`)
- Repro (`r309.mjs`): pin the Light Oak sofa → Dark Walnut → AI "light oak" (fresh). Light Oak now shows the curated `sofa-rockwell-3` but `pins()` is still `['sofa']`. The list shows a pin on a piece the customer never chose, and the slider plans around it.
- Fix: a `fresh` switch clears `pinsOf[target]` (as `reset()` does) and records the old set in the AI batch, so Undo restores it (`snap.pins`).

### Carried over (still open)
- **R3-04 [P2]** Worker lifecycle, global caches, the duplicate `GLOW` list. Unchanged; fix as in round 3.
- **T11/T12/T13 [P2]**:
  - no `modulepreload`, and `/js` and `/css` revalidate (now joined by the asset folders, R4-08);
  - `/api/assistant` GET still returns `authKind`, and the rate limiter is per instance;
  - `_deny.js` misses «Хоум Сентр»;
  - `style-src 'unsafe-inline'`.

---

## Checked and OK (new code)

- **Planner** (`core/budget.js`):
  - deterministic; no-pin ladders are monotonic and pass through the designer room;
  - pins are honoured on every step (0 violations in 1,200 random pin sets);
  - blocked dependents of a key pinned empty stay empty;
  - the memo cache is bounded (33 client, 25 server);
  - the worst build is ≈ 11 ms (Node), memoised per (pack, pins), so at most one build per pin change.
- **AI parity:**
  - the `budget` action in `ai/core.js` (amount rounded, `0 < amount ≤ 10 M`, one per answer, pins dropped after a style or reset in the same answer) equals the slider;
  - the `api/assistant.js` budget branch replaces the model's own swaps with the planner's answer;
  - `local.js` pins the «…, диван оставь» keys before planning, and the client pins them before asking the server;
  - exact selection parity in Node for 4 packs × 7 amounts × (no pin / one pin).
  - One gap: a same-style `style` action with an anchor sets `styled` on the client (pins dropped), while the server keeps pins (`style === state0.style`). That is rare; send `styled` only when `styleId` changed.
- **Store:**
  - `applyPlan` validates every entry, emits one `plan` before the `change`s, and does not pin;
  - `select` pins on `user`/`ai`;
  - `reset` clears pins;
  - `restore` carries nulls, pins and other styles' memory;
  - `included()`, `placed()`, `lines()` and `total()` skip nulls;
  - persistence v3 with a v2 fallback works (Node round trip);
  - `api/lead.js` + `normalizeSelection` treat `null` as excluded.
- **Slider UI:**
  - pointer capture with `lostpointercapture`/`pointercancel` → `stop()`;
  - a touch on the bare track waits for horizontal intent (`touch-action: pan-y` on the rail, `none` on the thumb);
  - a tap jumps (1 plan, 1 Undo);
  - keys: ←/→, PageUp/PageDown, Home/End; a key burst is one gesture, ended 1 s after the last key or on blur;
  - ARIA: `role=slider`, `tabindex=0`, `aria-valuemin/max/now/valuetext/label`, decorative parts `aria-hidden`;
  - thumb 28 px, rail 44 px;
  - two views (bar + dock) share one controller; listeners are subscribed once per view, and views are created once per page, so there is no leak;
  - one Undo per gesture (`runC`: 1 toast per drag, 1 per tap).
- **Engine slider path:**
  - per-slot coalescing ("latest wins", checked against the store at pump time);
  - topmost-of-family only;
  - ≤ 8 concurrent dissolves (measured max 6), 45 ms stagger, nearest first;
  - GI waits for `budgetBusy()` (dragging, runs, pending or < 350 ms since the last plan), local probes only;
  - `setDragging` disables camera input but lets an in-flight unfocus flight finish (`runC`: HUD closed, `focused: null`, controls re-enabled after release);
  - reserve lights keep the lamp light set constant by construction (2 spots + 1 point per lamp slot, flame pads on high; they are hidden by day with the real lamps), so empty ↔ lamp changes no light count. Measured: programs stay at 116–117 over 4 further min↔max jumps.
- **Scan loader:**
  - lazy per material, only what the style shows;
  - `createImageBitmap` off-thread;
  - one upload per queue slice via `renderer.initTexture`;
  - CPU bitmaps closed after upload; blobs kept for restore;
  - a 90 s fetch/decode timeout keeps the procedural maps;
  - `shareTexture` avoids re-uploads;
  - 0 failed sets.
- **Security:** `budget` amount validation is fine; pins are capped at 60 and deduplicated (prototype-name hole: R4-03); 0 CSP violations under the production headers.
