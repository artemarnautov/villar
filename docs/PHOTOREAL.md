# Villar — the push to photoreal (founder request, 26 Nov)

The founder looked at the current render and says it is still not photoreal: "надо довести до реализма".
Round-2 render score was 6.0. Real-time raster with procedural geometry and canvas textures plateaus around
6.5–7. Every photoreal web configurator gets past that the same way, and this plan follows it.

## The four levers (in order of impact per day of work)

1. **Path-traced stills on idle (engine).** Motion is real-time raster. When the camera rests
   (≥ 700 ms, no dissolve or flight in progress, page visible, desktop high tier), progressively path-trace
   the same frame with `three-gpu-pathtracer` (already vendored; `photo.js` has the pipeline + denoiser). Blend in
   over raster (WebGLPathTracer `renderDelay`/`fadeDuration`/`minSamples`). Any input cancels instantly and
   returns to raster with no pop. This gives true multi-bounce GI, soft area shadows, contact darkening,
   glossy reflections and colour bleeding, which are exactly the cues that read as "photo".
   - Budget: first useful image ≤ 1.5 s, clean (denoised) ≤ 6 s on a 2020+ laptop GPU. Tiles + `renderScale`
     adaptive so the UI never drops below 30 fps while refining; pause while HUD panels animate.
   - Emissive lamp shades + spot/point lights must match raster brightness (no exposure jump on blend). Same
     AgX/Neutral tone map and exposure as raster. Sun as a physical directional light with soft angle (~0.5°).
   - Phone/iPad/low tier: off (raster only), unless the device proves fast (measured samples/s) and is plugged in.
   - Focus mode and the dollhouse refine too. Thumbnails stay raster.
2. **Photoscanned materials (modeler).** Replace canvas-procedural albedo/normal/roughness with CC0
   photoscanned PBR sets (1K, 2K on high), one per material family: walnut / light oak / teak veneers, linen,
   bouclé, velvet, cotton percale, jute/flat-weave rug, wool pile rug, travertine, marble, ceramic glaze,
   limewash and painted plaster, brushed brass, black metal, glass, rattan/cane, paper shade, leather.
   Keep catalogue colours by tinting the scanned albedo (luminance-preserving), so every item still matches
   its card. Source only CC0/public-domain sets reachable from GitHub (`git clone --filter=blob:none --sparse`).
   Record the source and licence of every file in `site/assets/materials/LICENSES.md`. KTX2 or JPEG; total
   ≤ 25 MB lazy-loaded per style, ≤ 8 MB on low tier.
3. **Geometry that catches light (modeler).**
   - Bevel every hard edge (2–6 mm radius) so it catches a specular line.
   - Pillowy cushions with seams and piping; real curtain folds with sine pleats (not stripes).
   - Rug pile and fringe; slight sag on seat cushions; rounded tabletop edges.
   - Plants: use high-quality CC0 scanned models (glTF) or highly detailed procedural leaves with
     translucency. A plant is the #1 CG tell.
4. **The window (engine).** Replace the grey-box city with a photographic backplate per time of day:
   a real equirectangular HDR/EXR sky + skyline from a CC0 source, with the sun direction matched. Treat it as
   the light source for the path tracer (environment importance sampling). Night: a real night HDR.

## Acceptance (render reviewer, round 4)
- Blind test: 6 Villar frames (4 styles, Day/Sunset, Entry + Living) mixed with 6 real interior photos of similar
  rooms at similar resolution. The reviewer scores "photo or render" and realism 1–10 per frame. Target: Villar
  frames average ≥ 8.5, and at least 2 of 6 mistaken for photos.
- No regressions: style switch, swap and focus stay seamless; no long task > 100 ms on interaction (GPU path);
  phone raster quality ≥ round-3 level.

---

# Live → Photo (founder request, 27 Nov)

> «надо сделать так чтобы рендер реально был фотореалистичным … максимально дешево и эффективно … а за окном должно быть
> красивое реалистичное небо»

Like the iPhone camera: the real-time 3D stays the **viewfinder** (every click, swap and budget drag is instant). When
the camera rests, the current frame **develops into a photo** made by an image-edit model. The 3D frame is the input;
the model only adds realism (light, materials, imperfections, depth of field) and keeps every object, its position and
the camera. Any interaction returns to live 3D at once. The same view + the same room comes back instantly from cache.

## Architecture

```
site/js/photo/index.js      rest watch → capture → lookup/develop → structural check → crossfade; input → live
site/js/photo/engine.js     read-only engine adapter (rest state, clean capture, pose, visible items)
site/js/photo/guard.js      edge-map fidelity check
site/js/photo/transport.js  /api/photo client + the `?photo=stub` provider
site/js/photo/i18n.js       «Фото · ИИ-визуализация» / "Photo · AI visualisation" (RU/EN, ui/i18n.js language)
site/css/photo.css          the photo layer and the label (injected by the module)
site/js/main.js             one marked line mounts it (the page is unchanged without it)
api/photo.js                lookup · develop · poll · reject · ?diag=1 · ?run=1 (job queue); cache, limits, quotas, cost log
api/plate.js                window backplates: GET is read-only; generated only by queue jobs (runPlateJob)
api/photo-hook.js           Higgsfield webhook (Standard Webhooks signature)
api/_photo.js               providers (Higgsfield, AI Gateway), Supabase, prompts vocabulary
api/_img.js                 PNG decode, baseline JPEG encode, resize, size sniffing (no npm)
api/_refs.js                GENERATED server-only map item → product photo URLs (tools/build-photo-refs.mjs)
db/photos.sql               bucket `photos`, photo_renders / photo_quota / photo_locks, RPCs
tools/test-photo.mjs        offline server tests (gateway, Higgsfield and Supabase mocked)
tools/photo-presets.mjs     ART §1 plan + dry-run cost; emits SQL rows for the job queue (plates, editions, hero, preset)
```

**Flow.**
1. **Rest.** ≥ 700 ms with no input and no busy engine state (flight, fade, budget run, GI bake, textures,
   thumbnails, path tracer), the render loop idle (a loop that keeps ticking stops blocking 2.5 s after the last
   input), the page visible and ≥ 35 % of the stage on screen. One attempt per state.
2. **Capture.** `villar.capture({ width, height })` (engine, 8529c8d): a clean JPEG (no outline, marker, focus ring or
   dissolve ghosts) rendered at the requested size whatever the screen's DPR — 2048 px long edge for 2K, 1536 for 1K —
   plus the items by pixel area from an ID pass. It is drawn into a canvas padded to the model's nearest aspect ratio
   (1:1 … 21:9; the bands are the stretched, blurred frame edge, cropped off again later) and sent as JPEG q 0.88
   (≤ 1.45 MB; the engine's own JPEG when no padding is needed). The UI is DOM, so no HUD is in it. GPU: 0.1–0.3 s;
   software GL ≈ 16 s. Older engines: one synchronous re-render through `villar.debug` with the outline off.
3. **Visible items** ranked by screen area: the engine's ID pass (fallback: a 40 × 24 grid of BVH raycasts in ≤ 8 ms
   slices), as catalog item ids. The top 8 go to the model as product references.
4. **Lookup** (runs in parallel with step 3): `{ hit, url }` → load, check, show. A pending job → poll it.
5. **Develop** on a miss: the frame + items + state → `api/photo.js` → model → JPEG into Storage → `{ url, key, model, ms }`
   (or `{ pending, key }`: the client polls `op:'poll'` / `GET /api/photo?key=` until it lands, ≤ 2 min).
6. **Fidelity guard**, then the **develop moment**: the photo is drawn into a canvas the size of the stage (the same
   box as the WebGL canvas: pixel-aligned) and crossfades in over 1.1 s (desktop: a faint blur/desaturation clears
   with it; reduced motion: 240 ms opacity). The label fades in 0.5 s later. From the local cache: 420 ms.
7. **Back to live.** pointerdown / touchstart / wheel on the stage, any key outside text fields, a pointer travel
   > 24 px, any store change (swap, plan, style, pins), any engine view/time/focus/select event, or a pose change
   (programmatic camera) → the photo fades out in 140 ms. Results that arrive after the user moved on go to the
   local cache (shown when they come back), never on screen.

**Focus (docs/FOCUS.md).** A focused item at rest develops its close-up the same way: the lens shift of the framing
and the item's turntable angle (`o:<slot>:<yaw>`) are part of the pose, so every rest angle is its own photo.

## Providers and models (`api/_photo.js`, one ordered list per tier)

| Tier | Default order | Notes |
|---|---|---|
| photo, live visitors (`PHOTO_MODELS`) | `higgsfield:nano_banana_2_1` → `google/gemini-3.1-flash-image` → `…-preview`, **2K only (T2)** | 14 image inputs on Higgsfield (frame + 13 refs), 10 on the gateway |
| hero (`PHOTO_HERO_MODELS`, job queue only) | `higgsfield:nano_banana_pro` → `google/gemini-3-pro-image` → NB2 | |
| plate (`PLATE_MODELS`, job queue only) | `higgsfield:nano_banana_pro` → `google/gemini-3-pro-image` | 4K, 21:9 |
| edition (job param `model`, default `higgsfield:nano_banana_2_1`) | the first available provider | 2K, the work's aspect |
| A/B (`PHOTO_AB=higgsfield:seedream_5_5:0.2`) | 20 % of misses (stable per key) try that model first | Seedream 5.5: "edit that keeps everything untargeted unchanged"; also `bfl/flux-2-pro` on the gateway |

- **Higgsfield (primary).** `https://api.higgsfield.ai`, `Authorization: Key <id>:<secret>`. Credentials: `HIGGSFIELD_KEY`
  (the founder's single variable: `id:secret`, or a bare key), then `HIGGSFIELD_API_KEY` (+ `_SECRET`), `HF_API_KEY`
  (+ `HF_API_SECRET`), `HF_API_KEY_ID` (+ `HF_API_KEY_SECRET`); values are never logged or echoed. Async: `POST /{endpoint}`
  with `Idempotency-Key` → `request_id`; `GET /requests/{id}/status` → `queued | in_progress | completed | failed |
  nsfw | canceled`, `images[].url`. Inputs are public HTTPS URLs: the frame goes up via `POST /files/generate-upload-url`
  + presigned PUT; product photos are already URLs. 403 = no balance (provider skipped for 10 min, the gateway takes
  over in the same request), 404 = endpoint unknown (next model), 400/422 = once more without references, 429 = next
  model, `nsfw` = next model. Failed and nsfw jobs are not charged. Outputs expire after 7 days, so every result is
  copied into our Storage before it is used. The function waits ≤ ~50 s; then it stores a `pending` row and the
  client polls. With `HIGGSFIELD_WEBHOOK_SECRET` set it also registers `?hf_webhook=<site>/api/photo-hook`; a signed
  delivery (HMAC-SHA256 over `id.ts.body`, ±5 min) only triggers a re-read of the authenticated status (the payload URL
  is never trusted), then the same copy-to-Storage.
  - **Endpoint paths are not in the public docs index** (docs.higgsfield.ai lists Soul, Qwen, Recraft, Seedance …; the
    Nano Banana / Seedream / GPT Image pages are reachable from console.higgsfield.ai). Defaults follow the documented
    `{vendor}/{model}/{workflow}` pattern (`google/nano-banana-2.1/edit`, `…/text-to-image`, `google/nano-banana-pro/…`,
    `bytedance/seedream-5.5/…`, `openai/gpt-image-2.6/…`) with `image_urls`, `aspect_ratio`, `resolution` (1k/2k/4k),
    `seed`. **Confirm them in the console** and override without a deploy of code:
    `HIGGSFIELD_MODELS='{"nano_banana_2_1":{"path":"…/edit","t2i":"…/text-to-image","images":"image_urls"}}'`.
    A wrong path costs nothing: 404 → the gateway model answers, and the log line names the exact override to set
    (`photo_config` row `models`, live within 30 s, or the env variable).
- **AI Gateway (fallback).** Nano Banana models via `POST /v1/chat/completions` with `modalities: ['text','image']`,
  interleaved captions + `image_url` parts, `providerOptions.google.imageConfig { aspectRatio, imageSize }`; image in
  `choices[0].message.images[0].image_url.url`. FLUX.2 via `POST /v1/images/edits` (JSON `images: [{ image_url }]`,
  `data[0].b64_json`). Auth = the project's OIDC token or `AI_GATEWAY_API_KEY`, as `api/assistant.js`. The catalog
  lists `google/gemini-3.1-flash-image` (docs examples still use `…-preview`; both are in the list).

**Prompt (`PROMPT_VERSION v1` = docs/ART.md §2).** The fixed skeleton verbatim ("Photograph of this exact interior.
Keep the camera, framing and every object exactly as shown … 35 mm lens, f/5.6, fine film grain. The view through the
window stays exactly as shown."; a focused item gets "85 mm lens, f/2.8 with the room softly out of focus"), then one
line of fixed vocabulary per time of day (`LIGHT_WORDS`), per style pack (`STYLE_WORDS`) and the grade (`GRADE_WORDS`),
then one line per reference in order ("Image 2 — the sofa: Lansbury 3-seater sofa, oatmeal (woven fabric …); about 21 %
of the frame"). References are ranked by pixel area; **the selected wall art is always among them** (an edition's
`art/<id>.jpg` from Storage, otherwise its product photo). No free text anywhere. Item names, colours and materials come
from the public catalog; supplier names and URLs never appear in prompts or responses. ART §1: a new prompt version is
tried on the 3 canonical frames at T1 before it goes anywhere; bumping `PROMPT_VERSION` changes every cache key, so it
is only bumped after the coordinator approves.

## Costs (list prices, 27 Nov 2026)

| What | Price |
|---|---|
| Photo, gateway Nano Banana 2 | 512 $0.045 · 1K $0.067 · **2K $0.101** · 4K $0.151 (not $0.05: the catalog price at 2K is $0.101) |
| Photo, Nano Banana 2 Lite (1K only) | $0.034 |
| Hero, Nano Banana Pro | 1K/2K **$0.134** · 4K $0.24 |
| FLUX.2 [pro] (estimate, no catalog price) | ≈ $0.045–0.09 |
| Higgsfield (all models) | prepaid USD balance; no per-model API price published — the table uses the gateway list prices as estimates; set `PHOTO_COST` to real numbers |
| Window plates | 3 × $0.24 + optional mask $0.134 ≈ **$0.85 once** |
| Video loop (optional) | Veo 3.1 Lite 1080p $0.05/s, Fast $0.10/s → 8 s = $0.40 / $0.80 per time of day |
| ART §1 plan (`node tools/photo-presets.mjs`) | plates, mask, A/B, 24 editions × 2, 4 opening shots, 48 presets, 3 loops ≈ **$14** at gateway list prices (ART budgets ≈ $10; read the real Higgsfield charge after the first jobs) |

Phones ask for 1K (stage long edge < 1300 device px), desktops 2K. Only generations cost money: lookups, cache hits,
polls and the local cache are free. Every generation writes one log line
`{"ev":"photo.gen", model, provider, usd, est, size, refs, ms, bytes, …}` and its `photo_renders` row (`cost_usd`).

## Cache

- **Key** = sha256(key version `k1`, model id, prompt version `p1`, style, selection hash, pose, time of day, size,
  aspect). The selection hash is computed on the server from the validated selection (placed keys only, nulls kept).
  The pose is the engine's `pose().key` (`p<x,y,z>|y<yaw>|x<pitch>|f<fov>|s<shift>`) + `;a:<stage aspect>;m:<dollhouse>`
  `[;o:<focused slot>:<turntable angle>]` (without the engine API: `c:x,y,z (2 cm);d:dir;f:fov;s:shift;a;m`).
- A lookup checks the key of every model of the tier (a photo from any provider is a hit).
- Storage: `photos/v1/<k2>/<key>-<rand>.jpg` (user), `photos/preset/…` (generator), `photos/plates/v1/…`. A new name per
  generation, so a CDN never serves an old file. PNG outputs are transcoded to JPEG (q 86, ≤ 2560 px; 1K ≤ 1440 px).
- In the tab: an LRU of 24 photos by state; a state whose photo failed the guard is not retried in this session.
- In-flight requests for the same key share one generation; a pending job is never resubmitted (lookup → poll).

## Fidelity guard (`site/js/photo/guard.js`)

Frame and photo (cropped back from the padded aspect) → 256 px wide → luminance → 3 × 3 blur → Sobel → the strongest
15 % of gradients are "edges". `F1(0)` = edges of each image that have an edge of the other within 1 px. The same F1
for every offset up to ±4 px: if a shifted overlay is better by ≥ 0.05, the photo drifted. Per-tile recall on a 4 × 3
grid catches a removed or moved object. **Accept: F1(0) ≥ 0.42, no better shift within ±10 px, worst tile ≥ 0.22.** ART §2 per-item check
(`compareItems`): for the top 5 items by area, the frame's edges inside each item's bbox must not align better with the
photo at an offset > 4 % of the bbox, and their recall must hold — this runs as soon as `capture().items` carries `bbox`
(requested from the engine; until then the edge and tile checks above apply). A failed photo is
discarded (live 3D stays), the server is told (`op:'reject'` → `photo_reject`: user photos stop being served; after 2
rejects in 24 h the state is "unstable" and not regenerated; presets only count). The thresholds are first guesses:
calibrate on the first 50 real outputs (`?photoGuard=0.38` overrides `minF1`; the scores are in
`villarPhoto.debug.S.stats`).

## Kill switch, limits, failure modes

- `PHOTO_DISABLED=1` → everything off (the client sees `enabled:false` and never starts). `PHOTO_DISABLED=generate` →
  cache hits only. `PLATE_DISABLED=1` → plates off.
- Limits: develop 4/min and 30/h per IP, 20/h per session (in memory); daily caps in Postgres (ART §1): **12 per IP and
  per session** (`PHOTO_DAILY_IP`), **60 in total** (`PHOTO_DAILY_CAP`); a failed generation refunds its unit. Queue jobs
  are not counted against visitors (they are authorized by the row insert). `?run=1` 6/min, `?diag=1` 10/h per IP. Lookups 60/min, polls
  40/min, rejects 6/h per IP. Same-origin only. Body ≤ 2.6 MB, frame JPEG ≤ 1.6 MB and ≤ 2048 px (checked from the SOF).
- **Everything fails silently to live 3D**: no API (static hosting / the harness), no Storage, a kill switch, no
  balance or billing (`unavailable`: the client stops for 30 min), quota (6 h), rate limits (1 min), three errors in a
  row (10 min), a drifted photo, a CORS-tainted image. While neither provider is paid for, the page looks exactly as
  before: no spinner, no label, nothing over the room.

## The window: plates (`api/plate.js`)

`GET /api/plate?time=day|sunset|evening[&w=2048]` → `{ url, url2k, width, height, horizon: 0.5, hfov: 100,
sun: { az, alt, K, color }, model, mask?, video: null }` (or `{ pending }`). **The GET never generates**: plates come
only from queue jobs (`plate` {time:'day'}, `plate-edit` {time:'sunset'|'evening'}, `mask`), so no visitor can trigger a
4K Pro job. The day plate is a 4K, 21:9
text-to-image photo of Dubai Marina from the 40th floor (level camera, horizon across the middle, ~100° field, sun
high to the upper right — the engine's day sun is az −24°, alt 41°, i.e. to the right when looking out). Sunset and
evening are **edits of the stored day plate** ("keep every building exactly; change only the time of day"), so the
skyline is identical. Generated once, cached in Storage. Concurrency: the queue claim is `FOR UPDATE SKIP LOCKED` with a
lease, the submit holds a Postgres lock (`photo_lock`), and a running provider job is a `pending` row that later runs
resume instead of resubmitting. A failed or unfinished job never leaves a cached plate: only `status = ok` rows with a
stored file are served (tested: 3 concurrent runs → 1 submit; a failed job → nothing cached; the next job stores it).
The `mask` job adds the sky mask (green-screen edit → 8-bit PNG).

### Engine integration spec (engine owns the files; the plate replaces the procedural city)

1. **Fetch** `GET /api/plate?time=<day|sunset|evening>` (`w=2048` on medium/low tiers); morning → day, golden → sunset.
   On any error or `pending` keep the procedural city (today's look). Load with `crossOrigin = 'anonymous'`; the origin
   is in the CSP (`img-src`, `media-src`).
2. **Geometry.** A vertical cylinder segment centred on the window's centre line, radius R ≈ 900 m, spanning `hfov`
   (100°) around the window normal (+Z), height chosen so the image's vertical field is `hfov × height / width`
   (21:9 → ≈ 43°), with the image row `horizon` (0.5) at the camera's eye height (the plate was shot level). UVs map
   straight (equirect-like along the arc). `depthWrite` off, rendered after the interior, fog off, tone mapped as
   today's sky (sRGB texture, the same exposure path; scale its radiance so the window centre reads 245–252 like the
   current target).
3. **Depth layers (parallax).** Layer 0 = sky: the plate (or its mask's white part) on a sphere at infinity (no
   parallax). Layer 1 = city: the plate with the sky mask as alpha, on the R ≈ 900 m cylinder. Optional layer 2 =
   near towers: the same texture with a second mask on R ≈ 250 m. With walking amplitudes of ±3 m the parallax is
   ≈ 0.2° at 900 m and ≈ 0.7° at 250 m — enough to stop the window looking like a poster. Feather mask edges by 2 px.
   Without a mask: one layer at R ≈ 1500 m.
4. **Sun and sky light.** Per plate use `sun.az/alt/K` (= lighting.js TOD, so shadows already match), and sample the
   plate's mean colour over the sky band (rows above the horizon) and over the horizon band (± 3°) for the window fill
   / probe ambient instead of the procedural `SKY_PRESETS` horizon/zenith colours. Evening: the plate's lit windows
   replace the procedural night facades; keep the downlights as they are.
5. **Path tracer / reflections.** Keep the photographic HDR sky for environment light; the plate is what camera rays
   and window reflections see (glass reflection of the plate at 4 % is enough).
6. **Video loop (optional, later).** Per time of day an 8 s loop from the plate as first = last frame (Higgsfield
   `seedance_2_5` start/end image, `generate_audio:false`, or Veo 3.1 Lite/Fast first/last frame; ≈ $0.24–0.80 each,
   once), copied to Storage as MP4 (H.264, 1920 × 822, ≤ 4 MB). Use it as a `VideoTexture` on layer 1 only on desktop high,
   muted, `playsinline`, paused when the window is off screen or the tab hidden; the still stays the fallback and the
   poster frame. Not generated by `api/plate.js` yet (`video: null`): the video APIs are async jobs that run longer
   than a function; generate them with the preset tool once billing is on.

### Engine API used (feature-detected by `site/js/photo/engine.js`; older engines fall back to `villar.debug`)

- `villar.busy` — anything changing the next frame on its own (flights, fades, slider runs, bakes, exposure).
- `villar.capture({ width, height, quality, wait, timeout })` → `{ blob, width, height, pose, items, time, style, version }`.
- `villar.pose().key` — position 5 cm, direction 0.5°, fov 0.5°, lens shift 1 %. The photo layer appends what the key
  leaves out: `;a:<stage aspect 0.01>;m:<dollhouse>;o:<focused slot>:<turntable angle 1°>` (`villar.inspect`).
- `villar.inspect.atRest === false` (the item is still turning) counts as busy; `inspect`, `view`, `time`, `focus`,
  `select` events return to live.
- Still open: the `'rest'` / `'busy'` events could replace the 100 ms watch (kept for the input and visibility rules).

## Live config: who may generate (`public.photo_config`, photo-1b)

The site is public, so **visitor generation is off until the coordinator switches it on from the database**. The
functions read `photo_config` (name → jsonb) with a 30 s in-memory cache; env values stay the fallback; a read error (or
no table yet) means visitors off and no pilots, while lookups and the queue keep working.

| Row | Value | Effect |
|---|---|---|
| `visitors` | `true` \| `false` (absent = false; env `PHOTO_VISITORS=1` only when the row is absent) | visitors may develop |
| `pilots` | `["<session id>", …]` | these sessions may develop while `visitors` is off |
| `caps` | `{"perIp":12,"global":60}` | daily caps (else `PHOTO_DAILY_IP` / `PHOTO_DAILY_CAP`) |
| `ab` | `"higgsfield:seedream_5_5:0.2"` | the A/B share (else `PHOTO_AB`) |
| `cost` | `{"higgsfield:nano_banana_2_1":{"2K":0.06}}` | real prices, logged with `est:false` (over `PHOTO_COST`) |
| `models` | `{"nano_banana_2_1":{"path":"…","t2i":"…","images":"image_urls"}}` | Higgsfield endpoint overrides (over `HIGGSFIELD_MODELS`): fix a wrong path live |

- `develop` runs only if `visitors` is true or `body.session` is a pilot; otherwise `{ error: 'lookup_only' }`. The
  client treats that as "cache hits only for this session" (not an outage): it then looks the view up first and
  captures a frame only on a hit, so presets show for everyone at the cost of one small request per new view.
- `GET /api/photo?s=<session>` → `generate` computed the same way (the client passes its session id: a random id in
  localStorage, no personal data).
- `window.villarUI.photo` (read-only): `session` (copy it into `pilots`), `status()` → `{ enabled, generate, phase }`
  (asks the server again, e.g. 30 s after the pilots row changed), `last()` → the last attempt (`source`, `key`, `frame`
  = the key for a `hero` / `preset` job, `model`, `error`, `skip`, `guard`, timings).
- `diag` adds `config` (readable), `visitors`, `pilots` (a count, never the ids) and `overrides` (names only).
- The queue (`?run=1`) does not depend on any of this.

## Admin job queue (docs/ART.md: no secret in chat, nothing generated without a place in the product)

`public.photo_jobs` (id, kind `plate | plate-edit | mask | edition | hero | preset | loop`, params jsonb, status
`queued | running | done | failed`, result, cost, error, attempts, lease, timestamps). The coordinator inserts rows with
the Supabase connector — that insert is the authorization. `GET` or `POST /api/photo?run=1` takes no parameters: it claims
the oldest runnable job (`photo_claim_job`: queued, or running with an expired 70 s lease) with `FOR UPDATE SKIP LOCKED`
and runs **one step** of it, then returns `{ job, kind, status: done | running | failed | queued, result }` or `{ idle }`.
A provider job that is still running keeps the job `running` with a 20 s lease (the next call, or the webhook, finishes
it). No balance / bad key puts the job back to `queued` with the reason. More than 40 steps → failed.
- `plate` / `plate-edit` / `mask`: the window (above).
- `edition` {id, style, prompt, palette[≤6 hex], aspect, resolution 1K|2K, candidates 1–4, model?}: an original work →
  `art/<id>-c<n>.jpg` for each candidate, and c1 also as `art/<id>.jpg` (the catalog's `image`). The prompt adds the palette,
  "flat, front-on, no frame/wall/text/signature, not in the manner of any named artist". One candidate per step.
- `hero` / `preset` {from: <64-hex key>}: re-develops a stored visitor frame (`frames/<key>.jpg` + `.json`, kept by every
  live develop) with the hero (Pro) or default tier; stored as `source = preset` (never auto-rejected).
- `loop`: not implemented yet (photo-2) → failed with a reason.
- `node tools/photo-presets.mjs --sql plates | editions | hero --from <keys> | preset --from <keys>` prints the inserts.

## Diagnostics (free)

`GET /api/photo?diag=1` (10/h per IP) → `{ providers: { higgsfield: { configured, source, pair, authOk, status, hint? },
gateway: { configured } }, storage: { configured, bucketOk, bucketPublic, tablesOk }, disabled, jobs: { queued, running,
lastError }, caps, models, breakers, prompt }`. `authOk` comes from the status of a request id that cannot exist
(`GET /requests/00000000-…/status`: 401 = bad credentials, 404 = they work) — not billable. A bare `HIGGSFIELD_KEY`
that fails gets `hint: "HIGGSFIELD_KEY should be id:secret"`. No values are ever returned.

## Setup (the founder / coordinator)

1. **Higgsfield (primary).** console.higgsfield.ai → API keys → key ID + secret → prepaid USD balance (a higgsfield.ai
   plan does not include API access). Done by the founder (27 Nov: $30). Optional: Settings → webhook secret (`whsec_…`).
2. **Vercel env:** `HIGGSFIELD_KEY` = `<key id>:<key secret>` (set). Optional: `HIGGSFIELD_WEBHOOK_SECRET`,
   `HIGGSFIELD_MODELS` (only if the console paths differ), `PHOTO_SALT` (random; IP hashes), `PHOTO_DISABLED`,
   `PHOTO_MODELS`, `PHOTO_HERO_MODELS`, `PLATE_MODELS`, `PHOTO_AB`, `PHOTO_COST`, `PHOTO_REFS` (8), `PHOTO_DAILY_IP` (12),
   `PHOTO_DAILY_CAP` (60), `PHOTO_PUBLIC_URL`. Already there: `SUPABASE_KEY`. The AI Gateway fallback needs no variable
   (OIDC), only billing on the Vercel team.
3. **Supabase:** apply `db/photos.sql` (bucket + tables + RPCs; idempotent).
4. Deploy → `GET /api/photo?diag=1` (expect `authOk: true`, `bucketOk`, `tablesOk`, `config: true`, `visitors: false`) →
   open the site, copy `villarUI.photo.session` into `photo_config.pilots` → check a few photos → insert the plate jobs
   (`--sql plates`) → call `/api/photo?run=1` until each is `done` → review the plates in the browser.

## Tests

- `node tools/test-photo.mjs` — 136 offline checks (~60 s; incl. photo_config: default off, pilots, lookups while off,
  read error, cache, path / cost / caps / ab overrides): validation, kill switch, key, miss → develop → hit, reject →
  unstable, fallbacks (404, 400 → no refs, 402 → breaker), limits, quota, in-flight dedupe, Higgsfield (upload, submit,
  poll, 403 → gateway, nsfw → gateway, 404 → hint, pending → poll, signed webhook), key discovery + diag, the job queue
  (plates, edition, hero, concurrency, resume, failure leaves nothing cached, no balance → requeued), the guard math
  (identical / shifted / an item moved).
- Browser, without any API: `index.html?photo=stub` (`&photoLatency=…`, `&photoDrift=1`, `&photoFail=unavailable`,
  `&photoPending=1`); state and timings in `villarPhoto.debug.S.stats`. `?photo=off` turns the feature off.
