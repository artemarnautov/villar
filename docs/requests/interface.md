# Requests from interface (site UI + assistant client)

Round 4 status. Everything below is optional for the UI: engine and data features are feature-detected or have a
fallback.

## To engine

1. **Phone first view (D3-07):** the UI still asks for `view: 'eye'` on every viewport. At 390×844 the sofa projects to
   x = −20. Please choose a portrait variant of `eye` inside the engine when the stage aspect is below 0.8. Either
   turn about 12° toward the sofa or step back 0.5–0.6 m, so that at least 70 % of the sofa's box is in frame and the
   window is still visible. Ship it as `layout.views.eyePortrait` (data) or compute it in `camera.js`. The UI needs
   no change. If you would rather the UI pass `view: 'eyePortrait'`, tell me and I will add it behind a
   feature check.
2. **Sofa focus at 1280×800 (D3-02 / PT3-01):** `focus('sofa', { inset: { right: 361, bottom: 0 } })` returns true and
   `villar.focused === 'sofa'`, but the camera stays near the entry, and the kitchen counter hides the sofa's end (no
   outline is visible). The insets now come from the panel's resting position, not the slide-in frame (345 → 361 px).
3. **Thumbnails (D3-10):** the UI renders a shimmer while thumbnails load. Tiles that are visible jump the queue
   (`thumbs.bump`), in reading order. Calls still run one at a time in idle callbacks and wait 1.1 s after a focus
   starts (T7). To reach "first 4 in ≤ 600 ms on a GPU", the flight wait could drop to about 0.6 s if `thumbnail()`
   no longer blocks frames.
4. **Canvas label:** the UI overwrites the hard-coded `aria-label` on `ready` and on every language switch.
5. Keyboard scope (E15): unchanged request.

## To data (catalog / stylepacks / palettes)

1. Names are tidied **at display level only** (`ui/labels.js` together with `ai/i18n.js`):
   - "three-seat" → "3-seater";
   - in EN, the category noun that the eyebrow already says is dropped;
   - a set's own «Постель:» / "Bedding:" prefix is dropped after a slot label.

   The catalog is unchanged. If you standardise the names at the source, the display rules simply stop matching.
2. `uiAccent` per palette (D2-20) is still optional. Until it ships, `ui/accent.js` keeps its fallbacks.

## Budget slider (round 5): status and requests

UI side is in: `ui/budget-slider.js` (controller + views), the bar beside the total, the phone dock, the list
(«Не входит в бюджет · Добавить», pins with «Открепить»), the HUD pin line, one Undo per gesture, the AI client.

To coordinator:
1. `tools/test-ai.mjs` (5 failures, all expectations of the old fitBudget path):
   - the local-actions loop applies `style`, `reset` and `select` only. Add `budget`:
     `const p = sim.planBudget(store.styleId(), a.amount, { selection: store.state.selection, pins: store.pins() }); store.applyPlan(p.selection);`
   - «уложись в 5 000» expects `sim.minTotal()` (all-cheapest room, 21 875). The planner's minimum is the tier-0 room
     (7 852): compare with `sim.planBudget(base.id, 5000).min`.
2. `api/assistant.js` `budgetPlan`: when the plan lands below Essentials, `plan.level` is null and the reply reads
   «Собрал комнату под 10 000 AED: «», итог 8 570 AED». The client says «Минимум» / "Minimum" there.
3. `ai/core.js` `applyActions`: after a `reset` in the same answer, the budget still plans around `state0.pins`, but
   `store.reset()` clears the pins on the client, so the two rooms can differ. Suggest pins = [] after a reset.
4. «уложись в 30 000, диван оставь»: the client pins the kept pieces before it calls the server (so `state.pins`
   already contains them); no server change needed.

To engine (tested with the working tree, software GL):
- Desktop and phone: min → Essentials → designer → max, no errors. Two quick plans (designer → Move-in → Comfortable)
  leave 4 stale slots after 15 s and converge by 45 s on software GL (`villar.debug.furnisher.placed` vs the store).
- `setDragging` is called on grab and release; the HUD is closed (unfocus) on grab.

## To coordinator

1. **CSP:** the only inline script is still the import map, with its hash unchanged
   (`sha256-NutSaoNeHmtgPTLEDasezHLMqjFAq1OSEgA+/X0vykc=`). The external `/js/boot.js` now also picks the poster
   for the saved style (`/assets/posters/<style>.jpg`, read from `villar:v3:studio-38`, falling back to `v2`). It is still
   covered by `script-src 'self'`.
2. Lead form: every failure (429 rate_limited, 503, timeout, network) shows the same calm "try again" message and
   keeps the form filled (PT3-05). There is no WhatsApp fallback, per the founder.

## Resolved

- D3-01, D3-03, D3-04, D3-05 (display side), D3-06, D3-08, D3-09, D3-10 (UI side), PT3-02 (reply note), PT3-04,
  PT3-05, known issue 5 (per-style poster), plus everything listed in earlier rounds.
