# Villar — Phase 2: "photoreal game" editor

Founder brief (25.11.2026): the interactive editor must be photorealistic — correct renders, shadows,
light, items. Clicking an item flies the camera to it like in a game and shows convenient info; the user
can pick another item of the same style, or an item from another style — then the rest of the room adapts
so everything stays designer-correct and organic. It should feel like a photoreal game (GTA-level
freedom, photoreal look). Seamless: no seams, no lag, no pop-in. An AI input line under the editor
(runs on Claude). Every apartment detail counts: decor, rugs, curtains, tableware, kitchen items, etc.
Reviewers at every stage use the product and send back technical, product and aesthetic defects.

## 1. Multi-style system (coordinator: store/data — done)

- `site/data/styles.json` = `{ default, packs: [{ id, file }] }`. Each pack = `stylepack-<id>.json`
  (+ `palette-<id>.json`). Items are shared in `catalog.json`; an item may appear in several packs.
- A pack may add `pairings: { "<anchorItemId>": { "<slotKey>": "<itemId>", ... } }` — what to choose
  around a given anchor when the room re-styles to this pack.
- Store API (see `site/js/core/store.js`): `styles()`, `styleId()`, `style(id)`,
  `otherStyleOptions(slotId)` → `[{ style, key, items }]`, `previewStyle(styleId, { slotId, itemId })`
  → `{ total, delta, changedSlots, anchorKey }`, `setStyle(styleId, { anchor })`.
  Events: `'style' { styleId, prev, anchor, changes[] }` fires BEFORE the per-key `'change'` events
  (`reason: 'style'`), so the engine can stage one smooth transition.
- Persistence: localStorage `villar:v2:<layoutId>` keeps the active style and each pack's selection.

Target packs (research + catalog): **Тёмный орех** (exists) + 3 more that Home Centre can actually
supply and Dubai buyers want, e.g. light oak Japandi, warm modern greige/travertine + brass, and a
coastal/Mediterranean rattan-terracotta pack. Each pack fills EVERY slot type, including the new detail
slots below.

## 2. Every detail of the apartment (layout: engine; archetypes: modeler; items: catalog)

New slot types (all priced, all hoverable):

| type | where | notes |
| --- | --- | --- |
| `tableware` | attach `dining_table` top | two place settings: plates, bowls, glasses, cutlery, napkins |
| `centerpiece` | attach `dining_table` top, center | vase with stems/flowers or candle trio |
| `kitchen_decor` | kitchen worktop | kettle, utensil crock, board, oil/vinegar, fruit bowl |
| `throw` | attach `sofa` (arm/back anchor) | knitted/linen throw draped |
| `nightstand_decor` | attach `nightstand_l` top beside lamp | books + small vase/candle |
| `runner` | entry corridor floor | runner rug ~70×200 |
| `mirror` | entry or bedroom wall (engine picks a wall that is really free) | round/arched/leaning |
| `towels` (optional) | only if the bathroom is opened | — |

The catalog must cover every new type for every pack.

## 3. Game-like camera & focus (engine)

- Click an item → camera flies to a pleasing 3/4 framing of that object (ease-in-out ~0.9 s, no
  clipping through walls/furniture, respects collision), then a light orbit around the object is
  available. Esc / "Назад" / clicking empty space returns smoothly to the previous viewpoint.
- `villar.focus(slotId, { inset: { bottom, right } })` frames the object inside the visible part of
  the stage (sheet/HUD insets). `villar.unfocus()`.
- Free roam stays: WASD/arrows, drag to look, click floor to walk, scroll to dolly. On touch:
  one-finger look, tap floor to walk, pinch dolly. Movement must feel like a polished first-person game:
  inertia, acceleration curves, head height 1.6 m, no jitter.

## 4. Seamless and fast (engine + modeler)

- No pop-in: swaps cross-fade/scale-in (~250 ms) while the GI/shadows update without visible stepping.
  A style switch staggers changes across the room (~1.2 s total) like a reveal.
- Pre-build: after load, build the current pack's alternatives for the selected slot in idle time;
  cache geometry/material per item id.
- No frame > 50 ms during interaction on a mid laptop; idle = no rendering; first good frame fast.
- Thumbnails: `villar.thumbnail(itemId)` for the sheet (real renders, cached).

## 5. HUD / info (interface)

- Focus mode HUD: compact card anchored near the object: name, price, size, materials, color; key facts
  (e.g. "Подходит по размеру: остаётся 92 см прохода"); actions: "Заменить", "Убрать" (if allowed).
- Alternatives row: **«В этом стиле»** (thumbnails, price delta) and **«Из других стилей»** grouped by
  pack, each with a preview of the consequence: "Комната перейдёт в стиль «X»: изменится N предметов,
  итог ±Δ AED" → confirm → `store.setStyle(id, { anchor })`.
- Style switcher (pack chips) visible near the stage; palette section follows the active pack.
- Language: RU + EN toggle (default from browser); catalog items carry `nameEn`, `materialsEn`,
  `colorEn`. Arabic later.

## 6. AI assistant (new owner: assistant agent)

- Input line directly under the editor (above the budget): "Спросите или попросите что угодно:
  «сделай уютнее», «уложись в 25 000», «покажи вечер», «замени диван на что-то светлее»".
- `POST /api/assistant` (Vercel Function, Node, no npm deps) → Claude via **Vercel AI Gateway**
  (OpenAI- or Anthropic-compatible endpoint; auth with the project's OIDC token
  `x-vercel-oidc-token` header / `VERCEL_OIDC_TOKEN`, fallback `AI_GATEWAY_API_KEY`). Model configurable
  (`VILLAR_MODEL`, default a fast Claude model). Request: `{ messages, state: store.snapshot() + view,
  time, lang }`. Response: `{ reply, actions: [...], chips: [...] }` where actions ∈
  `select {key|slotId, itemId}`, `style {styleId, anchor?}`, `view {name}`, `time {name}`,
  `focus {slotId}`, `reset`. The server validates every action against the packs (compatibility rules
  are non-negotiable) and caps tokens/rate.
- Client applies actions through store/engine with visible feedback; shows the reply; suggestion chips.
- Offline fallback (no network / gateway not authorized): a client-side intent parser (RU/EN) for
  view/time/style/cheaper/budget/swap-by-color so the bar never feels dead.

## 7. Review loop (every stage)

After each dev milestone the coordinator runs four reviewers in parallel, each USING the product:
1. **Playtester (product)** — acts as a Dubai investor furnishing a unit and as a first-time renter;
   completes real tasks (find a cheaper sofa, switch style, ask the AI, order) and logs friction.
2. **Render & motion art director** — realism, light, materials, camera feel, transitions, seams.
3. **Design (HI)** — Apple-level visual polish, copy, typography, responsiveness, accessibility.
4. **Tech & performance** — errors, races, memory, frame times, payload, security.
Findings go to `docs/reviews/<round>-<reviewer>.md`, owners fix, the loop repeats until every P0/P1 is
closed and the render reviewer scores ≥ 8/10.
