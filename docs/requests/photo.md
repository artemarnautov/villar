# Photo engineer: requests and notes

## From twins (27 Nov, docs/TWINS.md pipeline A): two job kinds, `views` and `twin`

The twin of a catalogue item is made in two paid stages through the admin queue you already run
(`public.photo_jobs`, `GET /api/photo?run=1`, one step per call, `pending` rows + the 20 s lease for provider jobs).
I do not touch `api/_photo.js` / `api/photo.js`; this is the contract the browser side (`site/js/engine/twins.js`,
`site/lab/twin.html`) and the planner (`tools/twins-jobs.mjs`) are written against. The planner already emits the
rows below; `node tools/twins-jobs.mjs --pilot --sql all` prints the pilot (3 `views` jobs, 6 `twin` jobs).

### 0. Schema and Storage

```sql
alter table public.photo_jobs drop constraint if exists photo_jobs_kind_check;
alter table public.photo_jobs add constraint photo_jobs_kind_check
  check (kind in ('plate', 'plate-edit', 'mask', 'edition', 'hero', 'preset', 'loop', 'views', 'twin'));
-- photo_renders.kind: add 'twin-view' and 'twin' if you index the outputs there (cost log), same pattern.
```

The bucket already allows `model/gltf-binary` up to 50 MB and names the prefixes (`db/photos.sql`). Paths:

| What | Storage key | Type |
|---|---|---|
| turnaround view | `twins/<itemId>/front.jpg`, `left.jpg`, `back.jpg`, `right.jpg`, `three_quarter.jpg` | JPEG q 90, 1K |
| a reconstruction candidate | `twins/<itemId>/<model>-s<seed>.glb` | `model/gltf-binary` |
| the approved twin | `models/<itemId>.glb` (and `models/<itemId>.lite.glb`) | `model/gltf-binary` |

`upsert: true`, `maxAge: 3600` for all of them (the browser adds `?v=<n>` from `site/data/twins.json`).
`twins/` is working material: never referenced by the site. Only `models/` is fetched by visitors.

### 1. `kind: 'views'` — the four-view turnaround (image model)

Params (validated like `edition`):

| Param | Type | Meaning |
|---|---|---|
| `itemId` | catalogue id, `^[a-z0-9-]{3,60}$` | must exist in `api/_catalog.js` (name, dims) and in the photo gallery (below) |
| `refs` | 1–8 integers in 1…24, 1-based | which of the item's product photos to send, in this order (front first) |
| `shows` | strings ≤ 90, parallel to `refs` | the curator's caption of each photo ("straight front, whole sofa", "drawing: front and side elevations…") |
| `drawing` | integer, optional | 1-based position **in `refs`** of the supplier's dimensioned drawing |
| `material` | string ≤ 240 | the curator's one line (what it is made of, colour in words) |
| `prompt` | `tv1` | turnaround prompt version; unknown version → `rejected` |
| `views` | subset of `front, left, back, right, three_quarter`, `front` always first | default the first four |
| `model` | `higgsfield:grok_image_2` (default) \| `higgsfield:qwen_image_3` | your existing ids; Nano Banana is disabled on this account (503 `model_disabled`) |
| `resolution` | `1K` (default) or `2K` | |
| `seed` | integer | Qwen only (`seed * 10 + i` for view *i*); Grok has no seed, so a second attempt there is simply a new call |

Behaviour:
- **One view per step**, like edition candidates (a row `twinview:<itemId>:<view>:s<seed>` in `photo_renders`,
  `pending` while the provider job runs). A view whose file exists for this seed is skipped, so a re-run costs nothing.
- **`front` first.** Every later view gets the stored front view as **image 1**, so the set is one object at one scale.
- Aspect `1:1` for every view (multiview reconstruction expects square, centred, same-scale inputs).
- Output: PNG → JPEG as you already do (`toStorableJpeg`, q 90, max edge 1440 at 1K), stored at the keys above.
- Result: `{ itemId, views: { front: <public url>, left: …, back: …, right: …, three_quarter?: … }, model, prompt }`;
  `cost` = views generated in this job × `costOf(model, resolution)`.
- Log line `{"ev":"twin.view", itemId, view, model, usd, est, ms}`.
- Failure rules as for editions (403 → job back to `queued`; nsfw / 400 → `failed` with the reason).

**The photo gallery.** `tools/twins.json` (curator, 188 items, done) points at positions in the item's photo list:
research `catalogItems[].photos` (the galleries of the item's components, dearest line first, each in the supplier's
order; up to 24). `api/_refs.js` holds only the main photo today (`refs`, ≤ 2 per item). Please extend
`tools/build-photo-refs.mjs` to also write

```js
export default { hash, refs: { … }, gallery: { "<itemId>": ["<photo 1>", "<photo 2>", …] } };   // = catalogItems[].photos, same order
```

and resolve `params.refs[n]` as `gallery[itemId][n - 1]` (a missing position → `rejected`, naming it). The
photo-engine use of `refs` (`MAX_PER_ITEM = 2`) stays as it is. Server-only, as today.

#### Which images go with which view

`max` = 10 for Grok, 3 for Qwen. Build the list, then cut it to `max`:

| View | Order of `image_urls` |
|---|---|
| `front` | the drawing if `drawing` is set and `max` is 3 → put it second; otherwise `refs` in the curator's order |
| `left`, `right` | stored **front view**, the **drawing** (if any), photos whose caption contains `side`, then the rest in order |
| `back` | stored front view, photos whose caption contains `back` or `rear`, then the rest in order |
| `three_quarter` | stored front view, photos whose caption contains `three-quarter`, then the rest in order |

**The supplier's dimensioned drawing is the source of the side views** (13 kind-A items have one: front and side
elevations on white, with dimension lines). No photo shows a true side elevation; the drawing does, to scale. It is
always among the references of `left` and `right`, with its own line in the prompt (below).

#### Request bodies (from the provider's API reference, 27 Nov)

Grok Image 2.0 — `POST https://api.higgsfield.ai/xai/grok-imagine-image-2.0` (`prompt` required; `image_urls` 0–10 URIs;
`aspect_ratio` `auto | 1:1 | 1:2 | 2:1 | 3:2 | 2:3 | 4:3 | 3:4 | 16:9 | 9:16`, default `auto`; `resolution`
`1k | 2k`, default `1k`; `quality` `low | medium`, default `medium`; no seed). $0.07 at 1k by the account's estimate.

```json
{ "prompt": "<tv1>", "image_urls": ["<image 1>", "…up to 10"], "aspect_ratio": "1:1", "resolution": "1k", "quality": "medium" }
```

Qwen Image 3, edit — `POST https://api.higgsfield.ai/alibaba/qwen-image-3/edit` (`additionalProperties: false`;
required `prompt`, `image_urls` 1–3 ordered; `seed` 0–2147483647; `resolution` `1k | 2k`; `aspect_ratio`
`1:1 | 2:3 | 3:2 | 3:4 | 4:3 | 7:9 | 9:7 | 9:16 | 16:9 | 21:9`; `prompt_extend` and `enable_thinking` default `true`,
and thinking requires extend; `negative_prompt`; `prompt_extend_mode` only `direct`). $0.04 at 1k by the account's estimate.

```json
{ "prompt": "<tv1>", "image_urls": ["<image 1>", "<image 2>", "<image 3>"], "aspect_ratio": "1:1", "resolution": "1k",
  "seed": 11, "prompt_extend": false, "enable_thinking": false,
  "negative_prompt": "shadow, floor, wall, room, props, people, text, watermark, dimension lines, perspective distortion, cropped" }
```

Both off (`prompt_extend`, `enable_thinking`), as your model config already has it: the prompt is a specification and
must not be rewritten. Both answer `{ "status": "completed", "request_id", "images": [{ "url" }] }`.
Which one draws the truer turnaround is the first thing the pilot decides: run the sofa's `front` on both
($0.07 + $0.04) before the other eleven views. Grok takes every photo at once; Qwen only two beside the front view.

#### The turnaround prompt, `tv1` (verbatim; `{…}` from the catalogue and the job)

For every view after the front, this line goes first:

```
Image 1 is the approved FRONT view of this set: match its scale, colours, materials and every detail exactly.
```

Then one caption line per reference image, in the order sent (`{n}` counts from 1, or from 2 after the front view):

```
Image {n}: product photo — {shows}.
Image {n}: the manufacturer's dimensioned drawing with front and side elevations. Take the outline and the proportions from it, the side outline above all. Do not reproduce its lines, arrows, numbers or text; surfaces, colours and materials come from the photos.
```

(the second form for the image at `drawing`). Then the common block:

```
Product reference sheet image of the exact product in the reference photos: {nameEn} — {material}.
Real size: {w} cm wide, {d} cm deep, {h} cm high.
Show only this one product, alone, complete and uncropped, centred, on a pure white (#FFFFFF) seamless background.
Orthographic-like view: a long telephoto lens from far away, the camera level at the height of the product's middle, no perspective convergence, vertical lines vertical.
Even, shadowless studio light from all sides: no cast shadow, no contact shadow, no floor reflection, no gradient, no vignette.
Keep the product exactly as in the photos: the same proportions, silhouette, colours, materials, seams, cushions, legs and hardware. Invent nothing the photos do not show and add no accessories.
Remove everything that is not part of the product as sold: scatter cushions, throws, books, plants, rugs, lamps, props, people, walls, floor, text, logos, labels, watermarks, dimension lines.
Scale: the product's height spans exactly {heightPct} % of the image height and it stands on a horizontal line {floorPct} % above the bottom edge. This is the same in every image of the set.
```

`heightPct = round(80 × h / max(w, d, h))`, `floorPct = round((100 − heightPct) / 2)`: the height is the one
dimension all elevations share, so pinning it pins the scale of the set (sofa 211 × 88 × 86 → 33 % and 34 %).

Then one view block:

```
front:          View: FRONT. The camera faces the front of the product squarely, at 0°. A straight front elevation.
left:           View: LEFT SIDE. A straight side elevation of the product's own left side — the side that is at the RIGHT edge of the front view. The front of the product points to the LEFT edge of this image.
back:           View: BACK. A straight rear elevation, the camera exactly opposite the front view. If the photos do not show the back, keep it conservative: the same material and colour continued plainly, the same outline as the front mirrored, a simple flat upholstered or panelled back with no added buttons, pockets, zips, labels, patterns or openings.
right:          View: RIGHT SIDE. A straight side elevation of the product's own right side — the side that is at the LEFT edge of the front view. The front of the product points to the RIGHT edge of this image.
three_quarter:  View: THREE-QUARTER. The camera is 35° round to the product's left of the front and 15° above the horizon, 85 mm lens, mild natural perspective. Same white background and shadowless light.
```

The only free text is the curator's: `material` and `shows` (control characters stripped, lengths capped; the file
carries no supplier name). The supplier's name, the product URL and the listing title never enter the prompt: the
name is the catalogue's public `nameEn`.

**Left and right are the product's own sides** (the character-sheet convention). Which convention each 3D model
expects is not documented; the pilot's floor lamp has a swing arm (asymmetric) and settles it: a mirrored model
means that model wants the other convention, and its job gets `swapLR: true` (see 2).

### 2. `kind: 'twin'` — the reconstruction (3D model)

Params:

| Param | Type | Meaning |
|---|---|---|
| `itemId` | catalogue id | |
| `model` | `tripo_h3_1_multiview_to_3d` \| `hunyuan3d_v3_image_to_3d` \| `meshy_v7_image_to_3d` \| `tripo_p2_image_to_3d` | anything else → `rejected`; no REST path configured → `no_model` |
| `views` | ordered view names | the inputs in the order **this model** expects (the planner fills it) |
| `single` | view name, optional | the view to send when the model can only take one image over REST (Hunyuan today) |
| `swapLR` | bool, default false | send `right` where `left` is listed and the reverse |
| `options` | object | the model's parameters, whitelisted per model (below); unknown keys dropped |
| `seed` | integer | names the candidate file |
| `prompt` | `tv1` | which turnaround set to read (`twins/<itemId>/…` of that version) |
| `as` | `candidate` (default) \| `model` \| `lite` | `candidate`: only `twins/<itemId>/<model>-s<seed>.glb`. `model`: also copy to `models/<itemId>.glb`. `lite`: also copy to `models/<itemId>.lite.glb` |

Behaviour:
- **Waits for its views.** If a listed view's file is missing, return `{ pending: true, result: { waiting: 'views' } }`
  (the normal 20 s lease; it counts toward the 40 attempts). Never generate views from here.
- Inputs are the public Storage URLs of the stored views (already HTTPS, no upload needed).
- **Estimate first.** `POST /estimate/<path>` with the exact body is free and validates it: a 400 names the wrong
  property (that is how `image_url` was found). Submit only after a 200, and log the estimate's `usd`.
- One provider job per queue job; `pending` + resume by `request_id` exactly as images. 3D jobs run for minutes:
  with the 20 s lease and 40 attempts a job has about 13 minutes of polling; raise `JOB_MAX_ATTEMPTS` for
  `twin` to 90 if the pilot shows longer runs.
- **Copy the GLB at once** (outputs expire after 7 days) and check it before storing:
  1. bytes 0–3 `glTF`, version 2, total length = file length. Anything else (Tripo P2 "may be GLB or FBX") → `failed`
     (`not a GLB`).
  2. Parse the JSON chunk (bytes 20 … 20 + chunk length). `failed` when `extensionsUsed` or `extensionsRequired`
     holds `KHR_draco_mesh_compression`, `EXT_meshopt_compression` or `KHR_texture_basisu` (the site has no
     decoders and the CSP has no wasm), when a buffer or image has a non-`data:` `uri`, or when `skins` is non-empty.
  3. `faces` = Σ over `meshes[].primitives[]` with `mode` 4 or absent of `floor(accessors[indices ?? attributes.POSITION].count / 3)`.
  4. size ≤ 48 MB (the browser's cap on the high tier; 32 MB medium, 20 MB low).
- Result: `{ itemId, model, glb: 'twins/<id>/<model>-s<seed>.glb', url, as, copiedTo: 'models/<id>.glb' | null,
  faces, bytes, images: <count>, generator: <asset.generator>, request_id, ms }` and `cost` (below).
- Log line `{"ev":"twin.gen", itemId, model, faces, bytes, usd, est, ms}`.

#### What is known about the REST side (27 Nov)

The public API reference (`docs.higgsfield.ai/docs/llms-full.txt`, 597 k characters, read end to end) documents
**no 3D endpoint**: its index says "84 entries: 17 Image and 67 Video", and the model pages run alphabetically from
Ads Studio to Z-Image with nothing for Tripo, Hunyuan3D or Meshy. So paths and bodies come from two places only:
the free `/estimate` probe on production (yours, `?diag=1&probe=1`) and the parameter names of the provider's model
catalogue (the same models, listed with their options).

| Model | REST path | Status | Body |
|---|---|---|---|
| `tripo_h3_1_multiview_to_3d` | `tripo3d/h3.1/multiview-to-3d` | **exists** (estimate 200 with `{ "image_urls": [a, b] }`, `usd` 0.000) | below; the image field is the one the probe sent |
| `hunyuan3d_v3_image_to_3d` | `hunyuan3d/v3/image-to-3d` | **exists** (400 `'image_url' is a required property` when sent `image_urls`) | below; one required `image_url` |
| `meshy_v7_image_to_3d` | unknown | `meshy/v7/image-to-3d`, `meshy/image-to-3d`, `meshy/multi-image-to-3d` are in your probe list; only the two paths above were reported as existing | — |
| `tripo_p2_image_to_3d` | unknown | `tripo/p2/image-to-3d` is in the probe list and was not reported; `tripo3d/p2/image-to-3d` (the vendor prefix that exists) is not in it yet | — |

Tripo H3.1 multiview (default) — `POST https://api.higgsfield.ai/tripo3d/h3.1/multiview-to-3d`, views in the order
**front, left, back, right** (2–4):

```json
{ "image_urls": ["<front>", "<left>", "<back>", "<right>"],
  "face_limit": 40000, "texture": true, "pbr": true, "texture_quality": "detailed", "geometry_quality": "detailed",
  "texture_alignment": "original_image", "auto_size": false, "orientation": "default", "quad": false, "texture_seed": 1 }
```

Catalogue ranges: `face_limit` 1000–2000000 (20000 for `lite`); `texture_quality`, `geometry_quality`
`standard | detailed`; `texture_alignment` `original_image | geometry`; `orientation` `default | align_image`;
`texture_seed` whole number. The option names are the catalogue's and have not been through `/estimate` yet: send
this whole body to `/estimate` once and trim whatever a 400 names.

Hunyuan3D v3 (A/B) — `POST https://api.higgsfield.ai/hunyuan3d/v3/image-to-3d`:

```json
{ "image_url": "<front>", "enable_pbr": true, "face_count": 60000, "generate_type": "Normal", "polygon_type": "triangle" }
```

Catalogue ranges: `face_count` 40000–1500000 (default 500000: always send it; no `lite`); `generate_type`
`Normal | LowPoly | Geometry`; `polygon_type` `triangle | quadrilateral`. The catalogue says the model takes 1–4
views ordered **front, back, left, right**, but the REST names of the extra views are unknown. Try them through
`/estimate`, in this order, and keep the first that is not rejected: `back_image_url` + `left_image_url` +
`right_image_url` beside `image_url`; `image_urls` (the three extra views) beside `image_url`. If neither passes,
send one image and make it `params.single` (`three_quarter`): a single orthographic front tells a reconstructor
nothing about depth.

Per-model option whitelists for the two without a path (catalogue names, for the day a path is found):
`meshy_v7_image_to_3d` — one image (`three_quarter`): `model_type: 'standard'`, `topology: 'triangle'`,
`target_polycount: 40000` (100–300000), `symmetry_mode: 'auto'` (`'off'` for asymmetric items),
`should_remesh: true`, `should_texture: true`, `enable_pbr: true`, `ultra_mode: true`,
`enable_safety_checker: true`; never `enable_rigging`, `enable_animation`, `pose_mode`, `texture_prompt`,
`texture_image_url`, `folder_id`. `tripo_p2_image_to_3d` — one image: `face_limit: 40000` (48–50000),
`texture: true`, `pbr: true`, `texture_quality: 'detailed'` (`fast | standard | detailed | extreme`),
`delight: true`, `auto_size: false`, `export_uv: true`, `quad: false`, `seed`, `texture_seed`.

More paths worth one free probe each, by the pattern of the two that exist (catalogue id with `/` and `.`):
`tripo3d/p2/image-to-3d`, `tripo3d/h3.1/image-to-3d`, `meshy/7/image-to-3d`, `meshy/meshy-7/image-to-3d`,
`meshy/v6/multi-image-to-3d`, `hunyuan3d/v3/multiview-to-3d`. The catalogue also lists a Meshy multi-image model
(1–4 views) that would suit the turnaround better than the single-image one.

`auto_size` stays off everywhere: the browser scales the model to the catalogue dims itself and rejects a twin whose
proportions are off by more than 3 % (`twins.js`), so a guessed real-world size adds nothing.

**Still unknown, to read off the first job:** where the completed status carries the file (the reference says
outputs sit in "model-specific fields", `images[]` for images and `video.url` for video; nothing for 3D). Log the
*keys* of the first completed 3D status, no values, and take the first `https://…` value that ends in `.glb` or
whose response starts with `glTF`.

#### Cost

`/estimate` answered `usd: 0.000` for Tripo H3.1, so the estimate cannot be trusted for 3D and the price is
unknown until a job has run. `cost`: `PHOTO_COST['higgsfield:<model>']['3d']` when set, else `null` with
`est: true`. For the pilot, please run the two models **one at a time** on the first item so the coordinator can
read the balance before and after each (console, or the Higgsfield connector's balance); the numbers then go into
`PHOTO_COST` and `tools/twins-jobs.mjs` (`PRICE`). `node tools/twins-jobs.mjs --pilot` prints the plan: 15
turnaround images = $1.05 on Grok ($0.60 on Qwen) and 6 reconstructions at an unknown price. The whole of kind A
that the curator cleared (76 items) is 304 images = $21.28 on Grok or $12.16 on Qwen, plus 76 reconstructions:
more than the balance can carry if a reconstruction costs over a few cents, so nothing beyond the pilot should be
queued before its three prices are read.

### 3. Nice to have (P2): a texture diet for the stored GLB

Generated GLBs usually embed 2K–4K PNG textures; a 40k-face model is then 15–40 MB, mostly PNG. The browser
downsizes after download, so the bytes are still paid on a phone. `api/_img.js` can decode PNG and encode JPEG: when
`as` is `model` or `lite`, re-pack the GLB with each opaque PNG image over 512 KB re-encoded as JPEG (q 90, max edge
2048; 1024 for `lite`), `mimeType` and `bufferViews` rewritten. Expected 5–10× smaller. Not needed for the pilot;
the candidate in `twins/` stays untouched as the master.

### 4. What the browser does with it (for your tests)

`site/data/twins.json` is a reviewed static file, written from the QA page after the fidelity gate; no API serves
it. An entry: `{ "<itemId>": { "glb": "models/<itemId>.glb", "v": 1, "faces": 39874, "dims": { "w": 211, "d": 87.4, "h": 86.2 }, "yaw": 0 } }`.
The engine fetches `MEDIA_BASE + glb + '?v=' + v` with `fetch` (`credentials: 'omit'`): Storage must answer with
CORS for the site origin (public objects do) and the CSP has the origin in `connect-src` (done in `tools/csp.mjs`).
A 404, a timeout (15 s), a compressed or oversized file, or proportions off by more than 3 % all end the same way:
the procedural model stays and nothing is shown to the visitor.

### 5. Pipeline B helpers (no model cost if the first route works; details in `tools/twins-b.md`)

Rugs, runners and supplier wall art need the product's own image as a flat texture:
`kind: 'flat'` `{ itemId, ref: <1-based photo>, quad?: [[x, y] × 4], out: 'rugs/<id>.jpg' | 'art/<id>.jpg', mode: 'crop' | 'model' }`.
- `crop`: fetch the photo, cut the quadrilateral (corners as fractions of the image, clockwise from top left; absent =
  the whole image), warp it to the item's `w : d` (rugs) or `w : h` (art) at 2048 px on the long side, store as JPEG
  q 90. `api/_img.js` has no JPEG decoder; if the image CDN serves a PNG rendition (`fmt=png`, unverified), decode
  that, otherwise this mode needs a baseline JPEG decoder (≈ 300 lines, no npm).
- `model` (fallback, one image: Qwen Image 3 edit, $0.04 by the account's estimate): the photo as the reference and the fixed prompt
  *"Flat, front-on reproduction of only the {rug | artwork} in the reference photo, filling the image edge to edge:
  same pattern, colours and proportions; no perspective, no shadow, no floor, no wall, no frame, no furniture, no
  text. Invent nothing."* at the nearest aspect.
- `kind: 'swatch'` `{ itemId, ref, box: [x, y, w, h] }` → `{ hex, lab }`: the median colour of that patch (needs the
  same decoder). The curator writes the result into the catalogue; nothing is stored.
These two are requests for a later round; nothing in the pilot depends on them.
