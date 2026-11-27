# Villar: digital twins (items that look like the real product)

Founder, 27 Nov: "айтемы должны быть реалистичнее … все должно выглядеть как в реальной жизни … высокое качество и соответствие оригиналу".

Today every item is a procedural approximation built from a handful of parameters. It can be clean, but it cannot be *that* sofa. The fix is to stop approximating: each item becomes a **digital twin made from the real product's photos**, checked against them, and the procedural model stays only as the instant placeholder and fallback.

## 1. Two kinds of twin
| Kind | Items | How | Why |
|---|---|---|---|
| **A. Reconstructed (GLB)** | sofas, armchairs, dining chairs, beds/headboards, lamps, plants, decor objects, cushions/throws as a set | product photos → clean 4-view turnaround (image model) → multiview-to-3D → GLB with PBR | organic shapes, upholstery, folds: reconstruction beats hand-built |
| **B. Exact-material procedural** | TV units, nightstands, tables, rugs, curtains, bedding, wall art, mirrors | keep crisp procedural geometry, but rebuild it from the product's real proportions and details, and take the surface from the product photo: the rug's own pattern, the artwork's own image, the veneer/stone/fabric swatch | flat panels and straight edges come out lumpy from reconstruction; a real texture on exact geometry is truer and free |

## 2. Pipeline A (through the admin job queue; Higgsfield)
1. **Sources** (`tools/twins.json`, server-only refs): per item 3–6 of the supplier's photos chosen for coverage (front, ¾, side, back if any, detail), plus dims and a one-line material description.
2. **Turnaround** (`kind: views`): Nano Banana 2.1, references = the photos; output four separate images, *front, left, back, right*, orthographic-like, the product alone on pure white, even studio light, no shadow, same scale, nothing invented beyond what the photos show (the back is inferred conservatively: plain upholstery/panel). 1K each.
3. **Reconstruct** (`kind: twin`): `tripo_h3_1_multiview_to_3d` (views ordered front, left, back, right; `pbr`, `texture_quality: detailed`, `geometry_quality: detailed`, `texture_alignment: original_image`, `face_limit` 40k). A/B on the pilot against `hunyuan3d_v3_image_to_3d` (LowPoly off, PBR on, 60k faces) and `meshy_v7_image_to_3d` (`ultra_mode`). The GLB is copied to Storage `models/<id>.glb`.
4. **Normalise at load (engine):** scale each axis-aligned extent to the catalogue dims (uniform scale by the largest dimension, then verify the other two within ±3 %; reject otherwise), floor at y = 0, pivot at the footprint centre, front = +Z; clamp roughness ≥ 0.35 on fabric, fix sRGB/linear, apply the room's environment and shadows; register in the ID pass.
5. **Display:** the procedural model shows at once; the twin loads lazily (visible items first), then a 350 ms dissolve. On low tier textures are downscaled to 1K at load and the face limit variant is 20k. If a twin fails to load or fails QA, the procedural model stays, silently.

## 3. Pipeline B (no generation cost)
- **Rugs, wall art:** crop the product's own top-down / frontal photo into the texture (server-side crop + perspective fix job, or a one-off through the image model: "flat frontal reproduction of this rug/artwork only").
- **Wood, stone, fabric:** a swatch crop from the product photo sets the tint and picks the nearest photoscan set; never a made-up colour.
- **Geometry:** leg shape and position, door/drawer layout, edge profile, plinth, handle type from the photos, encoded in `model.params` (extend the archetypes where they can't express it).

## 4. The fidelity gate (nothing ships without it)
For every twin the QA page (`/lab/twin.html`, not linked, redirected away in production like the rest of /lab) renders the twin at the reference photo's angle next to a neutral 8-angle sheet. The reviewer scores against the original photos (opened separately; never served from our site):
- silhouette and proportions (dims within ±3 %),
- colour (ΔE ≤ 6 on the main surface under neutral light),
- material read (fabric vs leather vs wood vs metal, sheen),
- details (legs, arms, seams, tufting, handles, shade shape),
- artefacts (melted edges, holes, baked highlights, mirrored text).
**Pass = every line ≥ 8/10.** A fail is regenerated once with a different seed/model; a second fail keeps the procedural model and is listed.

## 5. Budget and order
Per reconstructed item: 4 turnaround images + 1 reconstruction. The API prices for 3D aren't published; **the pilot measures them.**
1. **Pilot (3 items, one style): sofa, armchair, floor lamp of Dark Walnut.** Stop, read the real cost, review side by side, show the founder.
2. Then the signature rooms' kind-A items (≈ 12 per style, many shared) → the alternates → the rest.
3. Pipeline B runs in parallel for all rugs and supplier art (free).

## 6. Open business point
Twins and textures are derived from the supplier's product photos. Before public launch Villar needs the supplier's permission to use product imagery (standard in a reseller agreement).
