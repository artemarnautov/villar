# Assistant (AI line under the editor) — integration notes & requests

Owner: assistant. Files: `api/assistant.js`, `api/_catalog.js` (generated), `site/js/ai/{assistant,core,local,i18n}.js`,
`site/css/assistant.css`, `tools/build-ai-index.mjs`, `tools/test-ai.mjs`, `site/lab/assistant.{html,js,css}`.

## To interface — mounting (2 lines)

`main.js` already has the right stub. Please:

1. Set `const ASSISTANT_MODULE = './ai/assistant.js';`
2. Add `<link rel="stylesheet" href="/css/assistant.css">` to `<head>` after `studio.css` (the module injects it
   if missing, but a head link avoids a flash of unstyled bar).

Your current call works as is (`villar` as a getter is supported — options are read lazily; `getView().lang` is the
live language, so the RU/EN toggle repaints the bar within a second). Recommended full call:

```js
await mod.mountAssistant({
  container: slot, store, lang: getLang(),
  get villar() { return stage.engine; },
  getView: () => ({ view: stage.view, time: stage.time, focus: hud.current?.slotId || null, lang: getLang() }),
  // Optional but recommended — keeps your segmented controls / HUD in sync with what the assistant does:
  controls: { view: (v) => stage.setView?.(v), time: (t) => stage.setTime?.(t) },
  onFocus: (slotId) => { const p = store.placed().find((x) => x.slotId === slotId); if (p) hud.open(p, { focus: false }); },
});
```

- **Request:** expose `stage.setView(name)` and `stage.setTime(name)` (set the segmented control + call the engine).
  Without `controls`, the bar calls `engine.setView/setTimeOfDay` directly: time stays in sync (engine emits `time`),
  the view dock only if the engine emits `view`.
- Without `onFocus` the bar calls `engine.focus(slotId)` if present, else highlights the slot and moves to its zone.
- Height: at rest the bar is 52 px (fits your 56 px slot / 68 px reserve). Suggestion chips appear only when the bar
  is focused/hovered or after the first exchange; reply + confirmations add ~40–90 px below the stage only then.
  The bar never overlays the 3D.
- Returned handle: `{ el, ask(text), setLang(l), focus(), busy, destroy() }`.
- The store must be the multi-style one (you already pass `packs`): `style` actions call `store.setStyle(id, { anchor })`;
  selects use reason `'assistant'`, undo uses `'undo'`.

## To engine

- `villar.focus(slotId)` (Phase 2 §3) is used for “покажи диван”; `villar.setView`, `villar.setTimeOfDay` for scene
  commands. A `view` event (already requested by interface) keeps the dock in sync.

## To coordinator — deploy & test

1. **Before every deploy that touches `site/data/*`:** `node tools/build-ai-index.mjs` (writes `api/_catalog.js`;
   `--check` exits 1 if stale — good for CI). Tests: `node tools/test-ai.mjs` (~200 checks on live data, gateway stubbed).
2. **Function:** `api/assistant.js` — Node, zero-config (`export default async function handler(req, res)`), no npm
   deps, ESM without `import.meta`/top-level await, so it works whether Vercel transpiles it to CJS (no `package.json`)
   or runs it as native ESM (if a root `package.json` with `"type": "module"` is added later). It imports
   `../site/js/ai/core.js` + `i18n.js` (shared with the browser) and `./_catalog.js`. No `vercel.json` change needed;
   CSP `connect-src 'self'` already allows it.
3. **Auth:** project OIDC (request header `x-vercel-oidc-token`, on by default) → else `VERCEL_OIDC_TOKEN` → else
   `AI_GATEWAY_API_KEY`. AI Gateway must be enabled for the team (billing/credits).
4. **Env (optional):** `VILLAR_MODEL` (default `anthropic/claude-haiku-5.5`), `VILLAR_REASONING`
   (`none` default for Haiku; set `default` to omit), `AI_GATEWAY_URL` (override endpoint).
5. **Smoke test after deploy:**
   ```sh
   curl -s https://<deployment>/api/assistant            # → {"ok":true,"model":…,"auth":true,"authKind":"oidc-header","index":{…}}
   curl -s https://<deployment>/api/assistant -H 'content-type: application/json' \
     -d '{"lang":"ru","messages":[{"role":"user","content":"уложись в 25 000"}],"state":{"style":"dark-walnut","selection":{}}}'
   ```
   Expect `budget.ok: true` and `budget.total ≤ 25000`. Logs: one JSON line per request
   (`{"ev":"assistant","status":"ok","ms":…,"inTok":…,"cachedTok":…}`, never user text); errors are prefixed
   `[assistant]` (`auth missing …`, `gateway HTTP 401 (oidc-header, model): …`, `gateway timeout …`).
   Preview deployments behind Vercel Authentication need the bypass header for curl.

## API contract

`POST /api/assistant` `{ messages: [{ role, content }], state: { style, selection, total, view, time }, lang }` →
`200 { reply, actions, chips, budget?, total, source: 'ai' }` or `200 { reply, actions: [], chips: [], error }`
(`unauthorized | gateway | timeout | rate_limited | bad_request | forbidden`). Actions (validated server-side against
the packs, canonical order): `{type:'style', styleId, anchor:{key,itemId}|null}`, `{type:'reset'}`,
`{type:'select', key, slotId, itemId}`, `{type:'time', name}`, `{type:'view', name}`, `{type:'focus', slotId}`.
Caps: body 24 KB, user text 500 chars, 8 turns, 700 output tokens, 8 s deadline (incl. one budget re-try), 12 req/min
and 80 req/h per IP (in-memory, best effort), cross-origin browser requests refused.
