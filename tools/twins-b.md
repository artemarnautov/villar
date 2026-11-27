# Twins, pipeline B: exact material on exact geometry (docs/TWINS.md §3)

Owner: twins. Pipeline A (reconstruction, `tools/twins-jobs.mjs`) is for soft and organic items. Pipeline B is for
everything flat or straight-edged: the procedural geometry stays, and what the visitor sees on it comes from the
product's own photo. No reconstruction, no manifest entry in `site/data/twins.json`, almost no generation cost.

Three routes, by archetype:

| Route | Archetypes | Catalogue items today | What comes from the photo |
|---|---|---|---|
| **1. Flat texture** | `rug`, `runner` | 5 + 4 | the whole top face: the rug's own pattern, colours, border |
| **2. Image** | `wall_art` that is not an edition | 15 (39 − 24 editions) | the artwork itself |
| **3. Swatch** | `tv_unit`, `nightstand`, `coffee_table`, `side_table`, `dining_table`, `mirror` frames, `curtains`, `bedding`, `mattress`; also the legs and frames of kind-A items until their twin exists | ≈ 50 | a measured colour per surface → tint + the nearest photoscan set |

The geometry half of §3 (leg shape and position, door and drawer layout, edge profile, plinth, handles) is the
curator's audit against the photos, encoded in `model.params`; the modeler extends an archetype only where the
params cannot express what the photo shows (list at the end).

## Route 1: rugs and runners → flat texture

1. **Source.** The curator picks the photo that shows the rug flat from above (most listings have one) and, when it
   is not the whole frame, marks the rug's four corners. In `tools/twins.json`, beside the pipeline-A items:
   `{ "id": "rug-heaton-200x290", "flat": { "ref": 1, "quad": [[0.08, 0.05], [0.93, 0.06], [0.92, 0.95], [0.07, 0.94]] } }`
   (`ref` 1-based like `refs`; `quad` = corners as fractions of the image, clockwise from top left; absent = whole image).
2. **Make the texture** (job `flat`, spec in `docs/requests/photo.md` §5): crop the quadrilateral, warp it to the
   rug's `w : d`, 2048 px on the long side, JPEG q 90 → Storage `rugs/<id>.jpg`. Free when the crop route works on
   the server; otherwise one image per rug through the image model (Qwen Image 3 edit, $0.04 each by the account's
   estimate: 9 items = $0.36) with the fixed "flat, front-on reproduction of only this rug" prompt.
3. **Catalogue.** The same two fields editions use, so the engine needs nothing new:
   - item level: `"image": "rugs/<id>.jpg"` (a Storage key; the engine resolves it to `model.params.image` only when
     the key is in the approved set, exactly as for `art/<id>.jpg`: `furnish.js` already does this for any item with
     `image`);
   - `model.params.pattern` and `patternColor` stay: they are the placeholder while the image loads and the fallback
     if it fails.
   **Not `params.texture`:** the rug builder already reads `params.texture` as the pile type
   (`"weave" | "flat" | "kilim"` → fine flat weave instead of wool pile). The image goes in `image`, and
   `texture` keeps saying how the surface is woven, which the photo cannot tell the shader.
4. **Check** (QA, no page needed beyond the furniture lab: `/lab/furniture.html?item=<id>&cam=top`): pattern
   orientation (the long side along `d`), border not cropped, colour against the photo under the neutral light
   (ΔE ≤ 6), no baked shadow of furniture (pick another photo or use the model route if there is one).

## Route 2: supplier wall art → the image

1. **Source.** The frontal product photo; `{ "id": "art-najla-120x80", "flat": { "ref": 1, "quad": […the canvas inside the frame…] } }`.
   The quad is the artwork only, without frame and passe-partout: those stay procedural (`params.frame`,
   `params.mat`), in the piece's real colours.
2. **Make the image:** the same `flat` job → `art/<id>.jpg` (the prefix editions already use; ids do not collide,
   editions are `art-ed-…`). Triptychs and pairs: one image across the block, `params.panels` + `gap` cut it, as today.
3. **Catalogue.** `"image": "art/<id>.jpg"` at item level, nothing else. `edition` stays absent.
4. **Builder gap** (modeler request 2): `params.image` today always builds an *edition* (4 cm canvas in a float
   frame). A supplier piece with an image must keep its own construction: the bar frame, the mat, the glass, the
   real depth from `dims.d`.
5. **Rights.** These are reproductions of the supplier's artwork: covered by the same permission as every product
   photo (TWINS §6), and never offered as a Villar Edition.

## Route 3: wood, stone, fabric, metal → swatch → tint + nearest scan set

Today `woodColor`, `fabricColor`, `topColor` and friends are estimates typed in from the photo by eye. The route
replaces the estimate with a measurement and lets the measurement choose the scan.

1. **Source.** Per surface of an item, a small box on a photo where that surface is evenly lit and in focus:
   `{ "id": "tv-truman", "swatch": { "wood": { "ref": 1, "box": [0.31, 0.52, 0.08, 0.06] }, "cane": { "ref": 1, "box": […] } } }`.
   Avoid highlights, shadows, edges; two boxes on different photos beat one (the tool takes the median of all).
2. **Measure** (job `swatch`, or offline by the curator with any colour picker set to a 31 × 31 average): the median
   in Lab, returned as hex. Product photos are lit by a studio softbox on white: measure a white-background patch of
   the same photo too and divide by it (white balance and exposure), otherwise every wood comes out a third of a
   stop too light.
3. **Choose the scan set.** Ten sets exist (`tools/materials-licences.json`): wood `walnut`, `oak`, `oak-white`,
   `teak`, `floor-oak`; textile `linen`, `boucle`, `velvet`, `percale`; `leather`. Rule: within the surface's kind
   (the curator says wood / textile / leather; the photo cannot), take the set whose mean albedo is nearest in Lab
   to the swatch, then tint it to the swatch (the library's existing `match` option). A set whose mean is more than
   ΔE 25 away would need so much tint that its grain contrast turns wrong: flag those items instead of shipping them
   (they need a new scan, or stay procedural).
4. **Catalogue.** No new field for the common case: the measured colour replaces the estimate in the params the
   builders already read, and the wood / fabric key becomes the chosen set's key:

   | Surface | Param (existing) | Key param (existing) |
   |---|---|---|
   | carcass, legs, frames | `woodColor` | `wood`, `frame`, `legMaterial` |
   | upholstery | `fabricColor`, `seatColor`, `headboardColor` | `fabric`, `seat` |
   | table and cabinet tops | `topColor` | `top`, `topMaterial` |
   | cane, rattan | `caneColor` | — |
   | shades, pots, frames | `shadeColor`, `potColor`, `frameColor` | `shadeMaterial`, `pot`, `frame` |
   | curtains, bedding, throws | `color`, `duvetColor`, `sheetColor`, `throwColor` | `fabric`, `duvetFabric` |

   One new, optional marker at item level so the reviewers know which colours are measured:
   `"swatched": ["wood", "fabric"]`. The card's `colorHex` stays the curator's (it is a UI colour, not a material).
5. **Check.** `/lab/furniture.html?sheet=<id>,m:<key>%23<hex>`: the item next to a plain swatch of the measured colour;
   they must read as the same material under the lab's neutral light (ΔE ≤ 6 on the main surface, TWINS §4).

## Order of work

1. Rugs and runners (9): the largest visible gain per item, a rug is a fifth of the living room's pixels.
2. Supplier art (15): after modeler request 2.
3. Swatches for the signature rooms' kind-B items, then the alternates.
4. Geometry audit of the same items, alongside 3.

## What has to exist first

| Need | Who | Where it is filed |
|---|---|---|
| `flat` and `swatch` jobs (or the decision to do them offline) | photo | `docs/requests/photo.md` §5 |
| rug / runner `params.image`; supplier art keeps its frame with `image`; mean albedo per scan set + `nearestScan` | modeler | `docs/requests/modeler.md` "From twins" |
| `rugs/…` and supplier `art/…` keys in the approved-media list (`media.approved`) | interface / photo | same mechanism as editions (`art/index.json`) |
| the photo choices, quads, swatch boxes, surface kinds | curator | `tools/twins.json` (`flat`, `swatch` beside `refs`) |

## Geometry from the photos: what the params can already say

Enough for most pieces (see the `furniture/index.js` header): `legs` (11 styles) + `legHeight`, `doors`, `drawers`,
`open`, `front` (flat / fluted / slatted / cane), `handles` (cutout / knob / bar / leather, finishes), `top` +
`topThickness`, `shape` (round / oval / rect / pebble / squircle), `fluted`, `shelf`, `pedestalStyle`.
Not expressible today, to be confirmed item by item in the curator's audit before anything is requested:
leg inset from the corners, asymmetric door and drawer layouts (two drawers over one door), edge profile of tops
(bullnose, chamfer, knife edge), plinth recess depth, handle position, glass doors.
