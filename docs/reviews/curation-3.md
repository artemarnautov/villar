# Curation, round 3: source material for the digital twins (27 Nov)

Curator. Brief: docs/TWINS.md. Every gallery photo of the 184 supplier products behind the 164 sold catalogue items
was opened in the built-in browser and classified by eye (about 900 photos). The 24 Villar Editions have no supplier
photo.

## 1. What exists now

| File | What |
|---|---|
| `research/homecentre-raw.json` | `products[].images` (full gallery, supplier's order) and `imageViews` (what each shows); `catalogItems[].photos` (the item's photo list) and `photoViews`; `round3` block. URLs live only here. |
| `tools/twins.json` | 188 items, in work order. Per item: `kind`, `wave`, `refs`, `shows`, `material`, `notes`, `yawHint`; for kind B also `flat`, `geometry`; where the photos corrected the catalogue `paramsApplied`, `toModeler`; flags `poor`, `hold`, `skip`. No supplier name, URL or code. |
| `docs/requests/modeler.md` | "From curator, round 3": the geometry audit, 18 rows. |

**The refs contract.** `refs` are 1-based positions in the item's photo list (`catalogItems[].photos`): the galleries
of the item's components, dearest line first (the order `tools/build-photo-refs.mjs` already uses), each in the
supplier's order. Front first; 3 to 6 for kind A. This follows `tools/twins-jobs.mjs` (1-based), which read the file
without changes: `node tools/twins-jobs.mjs --pilot` plans the three pilot items, the full run plans 90.

Three things the consumers need to do (not mine to edit):
1. `tools/build-photo-refs.mjs` → `api/_refs.js` `gallery[id]` = `catalogItems[].photos`, whole. The draft contract in
   `docs/requests/photo.md` says "main component, up to 8": sets need the other components, and twelve products have
   9 photos.
2. `tools/twins-jobs.mjs` drops any ref above 12. 19 sets (cushions, decor, tableware, kitchen) point at photos
   13 to 20 of their list and lose them silently. Raise the cap to 24.
3. For three products the stored lead `image` is gallery image 2 (pids in `round3.mainPhotoIsSecond`), so there
   `gallery[id][0]` is not `refs[id][0]`. The photo list keeps gallery order.

**Classification (TWINS §1).** Kind A, 91: sofas, armchairs, dining chairs, beds, floor / table / pendant lamps,
plants, decor sets, centrepieces, kitchen and nightstand decor, tableware, cushions, throws. Kind B, 97: TV units,
nightstands, coffee / side / dining tables, rugs, runners, wall art (15 supplier pieces and 24 editions), mirrors,
curtains, bedding, mattresses. Waves: 1 pilot (3), 2 kind A of the four signature rooms (46), 3 the other kind A
(42), 4 kind B. Kind-A coverage: 46 items have six refs, 8 five, 17 four, 12 three, 8 fewer (flagged).

`yawHint` = the angle between the camera and the product's front in `refs[0]`: 0 straight on, 35 three-quarter. The
side (left or right) was not recorded.

`material`: twelve lines are written from the photos (the pilot three and the items where the photos contradict the
catalogue). The rest restate the catalogue's materials and colour with a sheen word; no contradiction was seen for
them when the photos were classified.

## 2. The pilot three (Dark Walnut signature), photo by photo

Numbers are positions in the item's photo list.

**`sofa-lansbury-3`** (8 photos) → refs `[2, 1, 8, 4, 3, 6]`
| # | Shows | Used |
|---|---|---|
| 1 | three-quarter, whole sofa, in a room (a rug under the front legs) | yes |
| 2 | straight front, whole sofa | yes, first |
| 3 | front of the arm, base corner and leg, close | yes |
| 4 | side of the arm and the walnut base rail, close | yes |
| 5 | top-down on the seat cushion and arm | no (the six are better spent elsewhere) |
| 6 | fabric weave, macro | yes |
| 7 | styled room: throw, cushions and a coffee table cover the sofa | no |
| 8 | drawing on white: front and side elevations with dimension lines (211 × 88) | yes: the only true side view |
- No back view: plain upholstery has to be assumed.
- The photos show **two seat cushions and two back cushions** on a three-seat width; the catalogue built three.
  Corrected (`seatCushions: 2`, `backCushions: 2`).
- Track arms, a walnut-tone base rail with corner legs, loose cushions with a self-piped edge.

**`armchair-luna-leather`** (6 photos) → refs `[2, 1, 6, 3, 4]`
| # | Shows | Used |
|---|---|---|
| 1 | three-quarter, whole chair, on a rug | yes |
| 2 | straight front, whole chair | yes, first |
| 3 | rear three-quarter, close: the back of the backrest and the arm joint | yes: the only view of the back |
| 4 | arm and leather seat, close (grain, creases) | yes |
| 5 | styled room, the chair small and cropped | no |
| 6 | drawing on white: front and side elevations (74 × 80 × 83) | yes |
- Open walnut-tone frame, sculpted arms, turned tapered legs, cognac leather cushions.

**`floorlamp-sable`** (5 photos) → refs `[1, 3, 4, 2]`
| # | Shows | Used |
|---|---|---|
| 1 | whole lamp, off, beside a sofa; base and stem visible | yes, first |
| 2 | the same view, lit | yes, last (true shade colour is photo 1) |
| 3 | shade and swing-arm joint, close | yes |
| 4 | stepped round brass base and stem, close | yes |
| 5 | styled room with a second lamp, partly hidden | no |
- The thinnest of the three: no white-background shot, no drawing, one viewing side only (the arm to the viewer's
  left of the stem). The turnaround's back and far side will be inferred. `asymmetric: true` kept.

## 3. Where the photos contradict the catalogue

**Corrected in the catalogue** (existing params and texts; fuzz build green):

| Item | Was | The photos show | Change |
|---|---|---|---|
| `art-ember-90x60` | landscape 90 × 60, over beds | portrait, 60 wide × 90 high | dims and name; moved from the bed walls to the dining walls (id kept) |
| `armchair-natura` | linen cushions on an open oak frame | fully upholstered tub chair on a wooden base with tapered legs | `style: barrel`; name and materials |
| `floorlamp-audrey` | wooden tripod | slim black metal stem on a round black base | params and materials |
| `pendant-berit` | paper-cord dome | wide shallow cone of handmade paper with pressed flowers, cane-stitched rim | `shade: cone`; name and materials |
| `pendant-tobin` | open dome | closed, flattened rattan globe | `shade: globe`, flattened |
| `sofa-lansbury-3` | three seat and back cushions | two and two | cushion counts |
| `chair-canovia` | armless | open wood arms | `arms: true` |
| `nightstand-forren` | one drawer under an open niche, cut-out pull | two drawers, small dark knobs | drawers, handles |
| `nightstand-nazario` | two drawers | open niche over one drawer | drawers |
| `nightstand-qubba` | no handles | champagne-metal trim and pulls | handles, materials |
| `nightstand-grant` | fluted, no handles | wide V-grooved planks, black bar pulls | handles, name, materials |
| `cushions-tuscany-siena` | blue stripe | blue ribbed solid | pattern, name, materials |
| `art-aquarelle-53x80` | sage / terracotta | clay tan (the sage was the wall behind it) | colour |
| `runner-kaela`, `runner-zen-alba` | berber lines; plain border | distressed; tonal geometric | pattern |
| `chair-emily` (research) | dead image link | the supplier moved the files | link fixed; `api/_refs.js` rebuilt |

**Held: colour or design decisions (not changed; `hold` in twins.json, never queued):**

| Item | Catalogue | Photos | Why it matters |
|---|---|---|---|
| `coffee-echo` | light oak `#D2BA94` | walnut brown in all seven photos (side face `#61442F`) | **Light Oak's signature and only coffee table is not light oak.** No light variant exists at the supplier; the one candidate looked at (round, 100 cm, mid-brown) stays rejected. Needs a replacement or a decision. |
| `throw-olivia-terracotta` | terracotta `#A85A3A` | one photo, caramel rust `#A07555` | signature throw of Dark Walnut and Mediterranean; a twin would come out caramel |
| `nightstand-suri` | walnut `#6B4530`, two drawers | reddish teak brown (`#6F3310` to `#884417`, sunlit), one drawer visible | Dark Walnut signature; tone and drawer count to confirm |
| `curtains-sullivan-layered` | blackout layer `#DCD3C5` | taupe linen, `#A08E81` to `#B2A79F` | signature curtains of all four rooms; the rule is ΔE ≤ 5 to the walls |
| `curtains-khor-sheer` | plain sheer | embroidered floral motif | the pack rules exclude patterned curtains |

Not held, but to decide:
- `armchair-natura`: the base and legs read warm mid-brown (`#966945`), not pale oak. It is the signature armchair of
  Light Oak (its only one) and now of Mediterranean. Fine for Mediterranean; in Light Oak it is a second wood tone.
  The round-2 argument "its wood matches" was wrong; "no cane" still holds.
- `pendant-berit` (Light Oak signature): the paper carries pink and yellow petals and green stems.
- `kitchen-white-basic`: the utensil holder carries the word "Utensils" and a leaf print; kettles carry a small brand
  mark (leave lettering off the twins).
- `art-aquarelle-53x80`, `art-vaseo-53x80`: amphora-shaped cut-outs, not rectangles (modeler row 17).
- `bed-maison-160`: slim brass legs are visible (modeler row 14).

## 4. Pipeline B facts

- **Rugs and runners, the photo to crop** (`flat.ref`): Heaton 2, Dione 6 (flat on white, dimension lines to mask),
  Pulara 2, Marlow 2 and Elsin 2 (a sofa covers a strip along the top edge), Zen Bianca 5, Marco Sandy 5 (both flat
  on white), Kaela 1. **Zen Alba has no top-down photo**: only a perspective view down a corridor.
- **Supplier art, the frontal photo:** photo 1 for Zuri, Sylvan, Aquarelle, Vaseo, Ember, Nyla, Aziza, Hiba, Najla,
  Caitlin, Olina, Andreya; photo 4 (flat on white, dimension lines to mask) for Macaire, Erato, Seren.
- `needsQuad` marks every piece that does not fill the frame (all but Zuri and Najla): the corners are not marked yet.
  Swatch boxes (twins-b route 3) are not marked either; that is the next pass.
- **Case goods and tables:** `geometry` on each of the 31 items: bays left to right, door and drawer count, handle
  type, legs and their position, edge and plinth. Jasper and Hege match today's params; the rest are in the modeler
  table.

## 5. Photos too thin for a faithful twin (`poor`)

| Item | Kind | Signature of | Why |
|---|---|---|---|
| `throw-olivia-terracotta` | A | dark-walnut, mediterranean | a single photo (also held) |
| `plant-olive-themis`, `plant-olive-charcoal` | A | dark-walnut, greige-luxe; light-oak | the tree has a single photo (the planters are well covered) |
| `plant-olive-kerby` | A | mediterranean | the planter has a single photo |
| `plant-olive-urbano` | A | | a single photo |
| `armchair-oti` | A | greige-luxe | two photos, both three-quarter on white |
| `armchair-emma` | A | | two photos, one usable |
| `floorlamp-diamant` | A | light-oak | two near-identical photos (enough for a round column) |
| `chair-emily` | A | light-oak, mediterranean | three photos, none straight-on, no side or back |
| `throw-vayu-sage`, `throw-norham-olive`, `throw-boras-oat` | A | light-oak (Vayu) | two usable photos (flat textiles: likely enough) |
| `kitchen-white-basic`, `kitchen-white-travertine` | A | light-oak, greige-luxe, mediterranean | the kettle has two photos |
| `kitchen-laimai-dark` | A | dark-walnut | the board is shown only with food and hands on it |
| `dining-kentana-100`, `dining-keira-100` | B | dark-walnut; light-oak, mediterranean | always photographed with chairs around the table |

Also: no photo shows a set together (cushion, decor, tableware and kitchen sets are separate products), so the
arrangement of a set twin is ours to compose.

## 6. Data changes outside the twins

- **Mediterranean signature armchair = Natura** (decision of round 2). The cane armchair stays an option.
- **Ember rewired.** Dark Walnut and Mediterranean: off the bed wall, onto the dining-wall options. Light Oak: the
  simpler bed-wall piece is the 80 cm square canvas (moved from the sofa-wall options); Ember is a dining option.
  Cashmere: the 80 cm canvas over the bed (moved from the dining options); Ember is the simpler dining piece
  (60 / 90 = 0.67). No artwork is offered for two walls of one room (tested).
- **Totals** (docs/BUDGET.md): Mediterranean Magazine 32,286 and No compromises 33,680 (−240 each); Light Oak Fully
  furnished 20,968 (−156); Cashmere Fully furnished 28,544 (+144). Everything else unchanged.
- docs/BUDGET.md: the round-2 edit had left a second, stale copy of three sections; removed.

## 7. Checks

`node tools/test-ai.mjs` 365 passed (348 + 17 new: twins.json coverage, kinds, refs in range, no occluded reference,
poor flags, order, flat photos, geometry, no supplier data, Ember, Natura). `tools/test-photo.mjs` 131 + 136 passed.
`check-public` clean. `fuzz-furniture` 1,536 builds, 0 failures. `build-families --check`, `build-editions-sql
--check` up to date. AI index hash 105b68c4; photo refs hash 12fdd24d63ab.
