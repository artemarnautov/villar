# Catalog sourcing — «Тёмный орех» × Home Centre UAE

Owner: catalog. Collected 2026-11-25. Not deployed (lives in `research/`).
Full per-product record (URLs, SKUs, regular + sale prices, dims, materials, verdicts): `research/homecentre-raw.json`.

## 1. Method

1. **Listings.** All pages of 20 Home Centre UAE categories (sofas, armchairs, coffee/side tables, TV units, beds,
   nightstands, dining tables, dining chairs, queen mattresses, floor/table/pendant lamps, curtains, trees,
   potted plants, wall art, rugs, decorative cushions, duvet covers, bed-in-a-bag, vases & bowls) plus planters and
   throws (page 1) and targeted searches. Read in the founder's built-in browser; product data decoded from
   `__NEXT_DATA__.props.initialState` (base64 JSON → `algoliaProductReducer.data.hits`), pagination `?p=N`
   (84 hits/page). About 6,400 listing rows scanned, one listing load every ~3 s.
2. **Shortlist by eye.** Thumbnails reviewed in contact sheets, then at larger size for wood tone, leg style,
   shape and fabric colour. Anything orange/teak, light oak, grey-washed, glossy or patterned was dropped here.
3. **Product pages.** About 140 product pages opened; `Weight & Dimensions`, `Material` and key specs read from the
   rendered page text. Only in-stock items (`inStock = 1`) were considered.
4. **Rules pass.** Every survivor checked against `research/stylepack-rules-dark-walnut.md` and
   `site/data/palette-dark-walnut.json` (wood tone ΔE76 ≤ 10 from `#553C2C`, light large textiles L* ≥ 70,
   olive + terracotta accents, one cognac-leather item type, satin brass + thin matte black, slot `max` sizes and
   the per-slot size/material rules). Colour hexes are estimated from photos (dominant visible surface) and
   checked with the CIELAB script from the rules doc.

## 2. Pricing

- `price` (public) = `round(regular × 1.2)`, integer AED. **Regular** = the listing's non-sale price
  (`wasPrice` = `price_range[0]`). Home Centre runs a ~30 % sale until 31 Dec 2026 on many items; sale prices
  are recorded in the raw file only and never used for the public price.
- **Sets.** Where the slot is a set in reality, one catalog item = several Home Centre products and
  `price = round(Σ regular × 1.2)` (components listed in `homecentre-raw.json → catalogItems`):
  - cushions = 3 cushions; bedding = duvet-cover set (+ throw, + accent cushion);
  - decor_set = 3 objects (vase/bowl/vase);
  - plant `plant-olive-themis` = olive tree + ceramic planter;
  - curtains = 2 × two-panel sets (4 panels, sheer) or 2 sheer + 2 blackout sets (8 panels, layered).
- The public catalog has no URLs, SKUs, supplier name or base prices (validated by script).

## 3. Coverage

| slot type | options | default (AED) | price range |
| --- | --- | --- | --- |
| sofa | 6 | `sofa-lansbury-3` (2999) | 2159–4799 |
| cushions | 3 | `cushions-linen-olive-rust` (1016) | 824–1256 |
| coffee_table | 4 | `coffee-baku-low` (1499) | 1355–2675 |
| decor_set | 3 | `decor-sand-travertine-walnut` (524) | 452–572 |
| rug | 4 | `rug-heaton-200x290` (1979) | 779–1979 |
| tv_unit | 4 | `tv-jasper` (1019) | 959–1019 |
| side_table | 3 | `side-moxie` (1199) | 923–1295 |
| armchair | 4 | `armchair-luna-leather` (2999) | 1799–2999 |
| floor_lamp | 3 | `floorlamp-sable` (479) | 479–539 |
| bed | **3** (target 4) | `bed-cloud-160` (2159) | 1319–2879 |
| mattress | 2 | `mattress-rejuvenate-160` (1355) | 1355–1799 |
| bedding | 3 | `bedding-white-oat-clay` (752) | 394–764 |
| nightstand | 3 | `nightstand-suri` (2327) | 359–2327 |
| table_lamp | 4 | `tablelamp-crosby` (179) | 179–299 |
| dining_table | **2** (target 3) | `dining-kentana-100` (4391) | 1175–4391 |
| dining_chair | 5 | `chair-linden` (779) | 779–2447 |
| pendant_lamp | 5 | `pendant-cosme` (215) | 215–419 |
| art_sofa (slot id) | 5 | `art-madar-aziza-100` (599) | 239–599 |
| art_bed (slot id) | **3** | `art-ember-90x60` (455) | 239–455 |
| art_dining (slot id) | 5 | `art-aquarelle-53x80` (239) | 95–299 |
| plant | 3 | `plant-olive-themis` (694) | 419–1115 |
| curtains | 3 | `curtains-sullivan-layered` (1075) | 358–1075 |

78 catalog items, built from 91 Home Centre products. 111 further candidates were checked and rejected, held for
review or not selected (reasons in the raw file). Wall art is chosen per placement: the style pack has keys
`art_sofa`, `art_bed`, `art_dining` (layout slot ids) instead of a shared `wall_art` key; catalog items keep
`type: "wall_art"`, and some pieces (Zuri, Caitlin) are offered in two slots.

### Default room — 32,741 AED (all 26 placements)

Lansbury oat sofa on a walnut rail · linen/olive/rust cushions · Baku walnut pebble coffee table · Heaton wool rug ·
Jasper walnut TV unit on brass legs · Moxie travertine side table · Luna cognac-leather armchair on walnut ·
Sable brass floor lamp · Cloud oat upholstered bed · Suri fluted-walnut nightstands ×2 with Crosby cream ceramic
lamps ×2 · white percale + oat throw + terracotta lumbar · Kentana marble/walnut pedestal table Ø100 with Linden
walnut chairs ×2 · Cosme linen pendant · three different artworks: Madar Aziza 100×100 over the sofa (the one statement piece: sand
ground, white relief stripes, terracotta-brown triangles), Ember 90×60 white botanical relief over the bed (quiet,
low format) and Aquarelle 53×80 sage-and-terracotta vase relief in the dining nook (ties to the olive/rust cushions) —
frames are one material (light wood-look) or none · olive tree in speckled ceramic planter ·
layered Sullivan sheer + blackout curtains.

Why this set: walnut appears in four places of different scale (TV unit, coffee table, nightstands, chair/table
bases) without any one large dark wall; the bed is soft oat so the bedroom isn't a second dark block; cognac is
used once (armchair); brass appears twice (TV legs, floor lamp); olive and terracotta are only in textiles.
Dark masses (L* < 40, > 0.5 m² front): TV unit only — well under the limit of 4.

## 4. Rules applied (summary of what removed items)

- **Size** (`layout-studio.json` max): most HC queen beds are > 125 cm high or > 190 cm wide; most round dining
  tables are Ø110–120; 3-seater leather sofas are 240–260 wide; many nightstands are 60 wide.
- **Wood tone:** "medium walnut" collections (Natura, Lyra, Raleigh, Forren) photograph at est. ΔE 12–15 from
  `#553C2C` — excluded (held as `review`). Mango/acacia/honey and light-oak pieces rejected.
- **Materials/colour:** leather sofas (rule: no leather sofa), button-tufted sofa (Selvino), ivory leather
  armchair (Dania), taupe-grey headboard (Mondo), viscose/sheen rugs, patterned/embroidered curtains, teal "sage"
  cushion, satin cushions, black-striped or metallic vases, pink/blue art.
- **Cross-slot rules that options cannot enforce** (store validates per slot only): side table should differ in
  material from the coffee table (defaults do: walnut ↔ travertine); cognac leather only once (only the armchair
  options use leather; no leather dining chairs were offered); boucle max once (only `armchair-pebble`).

### Held for review (not in options)
Brighton sofa (taupe N3), Lyra coffee/side/TV, Natura side/TV, Raleigh TV, Elodie side table (reddish fluted veneer),
Travertine coffee table Ø70 (below Ø80 rule), Canovia chair (dims look like seat size), Fern floor lamp (145 cm <
150), Linea rug (dark pinstripes too contrasty), Simmons mattress (31 cm > 30).

## 5. Data gaps and Home Centre data issues

- **Dimensions quality.** Some listed dims are wrong or partial: Olive Tree 175 lists W/L 175 (canopy is ~60 —
  estimated from photo); Urbano olive has height only; Tango floor lamp 25×14; Canovia chair 40×40; Dexter pendant
  "height 150" includes the suspension (shade body ~40 cm, estimated); wall-art "Width" field holds the frame depth.
  Estimated values are marked in `homecentre-raw.json → notes`.
- **Decor objects** list height only; diameters are estimated from photos (decor is a grouped set anyway).
- **Curtains.** Every plain Home Centre option is polyester with a metal **grommet** header (no linen, no pinch
  pleat). Panels are 300 cm drop; the catalog dims show the installed result (390 wide gathered, hemmed to 283 cm
  for the 285 cm ceiling). The rules forbid metallic grommets — the generator should show a ceiling-track heading.
- **Pricing.** Prices are as of 2026-11-25; Home Centre's temporary sale (mostly −30 %) is ignored by design.
  Marketplace brands sold through Home Centre (Wood Culture, Art and Craft, Mahmayi, HomeKode, Lilacs) may have
  longer delivery times.
- **Colour.** All `colorHex` values are photo estimates; "White" duvet/sheer listings were taken as warm white.
- **Dining table.** Only Kentana (Ø100) and Mahmayi (80×80) are walnut-toned and ≤ 100 cm; Kentana's top is light
  marble with soft veining (allowed as "warm honed marble", borderline).
- **Bed.** Only three queen beds pass size + colour. The best visual match (Leopold: cream headboard on walnut frame)
  is 140 cm high.

## 6. Notes for the coordinator / other teams

1. **Wall art per placement (resolved).** `art_sofa` options fit ≤ 160×100 (larger pieces added: Madar Aziza and
   Madar Hiba 100×100, Najla 120×80, Caitlin triptych 126×60); `art_bed` fits ≤ 140×90 **and** is limited to
   60 cm high so the bottom edge (centre at 1.60 m) clears the default Cloud headboard (114 cm) by ≥ 15 cm;
   `art_dining` fits ≤ 100×100 (50–80 wide per rules). Cross-slot caveat: with the Nazario bed (headboard 119 cm)
   the 60 cm bed pieces clear it by only 11 cm. Home Centre's best "arches" piece (Lina triptych, terracotta arches
   and palms) is 120 cm tall per panel and fits no slot. Most other large Home Centre canvases are portrait
   90–100 × 120–150 (too tall), blue/coastal, gold-leaf or calligraphy.
2. **Pendant drop (resolved).** With the slot `max.h` raised to 1.4 m, every pendant now hangs at
   `dims.h + drop` = 132 cm, so the shade bottom sits at 153 cm: 80 cm above Kentana (73 cm) and 78 cm above
   Mahmayi (75 cm), inside the 70–85 cm rule. The old 1.0 m limit only shortened the drops; it did not exclude any
   pendant, so no options needed adding. Home Centre's remaining pendants are clusters, glass/metal or
   shade-only "Mix and Match" items without a cord set.
3. decor_set is used twice (coffee table + TV unit) and nightstand / table_lamp / dining_chair twice each; the
   budget counts every placement (`store.total()`), as intended.

## 7. `model.params` vocabulary added beyond the brief

| key | values / meaning |
| --- | --- |
| `woodColor`, `fabricColor`, `legColor`, `topColor`, `frameColor`, `headboardColor` | hex override for the named part |
| sofa `legs` | + `metal-slim` (thin tapered metal leg) |
| sofa `base` | `wood-rail` (walnut rail under the seat, legs at the ends), `wood-frame` (wood surround) |
| sofa `armPanel` / `armPanelColor` | `rattan` panel inset in the arm |
| sofa `backStitch`, `depthStyle`, `seatHeight` | `horizontal-channel`; `lounge` (deep low seat); metres |
| armchair `arm` | + `wood-open` (open walnut arm, mid-century) |
| tables `shape` | + `pebble` (soft organic oval) |
| tables `legShape`, `legCount`, `pedestalStyle` | `cylinder`; integer; `turned-ball`, `block`, `fluted-cone`, `slatted-drum` |
| tables `topThickness`, `parsons` | metres; square parsons table (legs flush with top) |
| cabinets `open`, `legHeight`, `softClose` | count of open shelves/niches; metres; bool |
| cabinets `fronts` | + `herringbone` (chevron veneer door) |
| bed `headboard` | + `upholstered-tufted` |
| bed `headboardHeight`, `railHeight`, `footboard`, `footboardHeight`, `underLight`, `fabric` | metres / bool / `warm-2700K` |
| mattress `coverColor` | hex |
| lamps `body` | base silhouette: `gourd`, `ribbed-gourd`, `turned-stem`, `column`, `fabric`, `rattan` |
| lamps `stem` | `swing-arm`, `turned`, `straight` |
| lamps `shadeDiameter`, `shadeMaterial`, `shadeProfile`, `tiers`, `trimColor` | metres; `opal`; `flattened`, `organic-wave`; count; hex |
| pendant `drop` | metres from ceiling to top of shade (`dims.h + drop·100 ≤ max.h`; all options = 132 cm total) |
| wall_art `panels`, `gap`, `mirrored` | `[[w,h] m …]` for multi-panel sets; metres between panels; bool |
| rug `texture` | `fine-weave` |
| curtains `layers[]` | `{ fabric, color, panels, blackout }`, front-to-back order: sheer first |
| wall_art `frame` / `frameShape` / `relief` | + `oak-light`; `arch`; bool (3D relief, no glass) |
| plant `potDiameter`, `potHeight` | metres |
| cushions `sizes`, `fabrics` | `[[w,h] m …]`; per-cushion fabric when `fabric = mixed` |
| decor_set `heights` | metres per object, same order as `items` |
| dining_chair `arms`, `backShape`, `backStyle`, `caneColor` | bool; `rounded-shell`; `y-splat`; hex |

Round items carry `dims.round = true` (w = d = diameter), which `formatDims` in `site/js/core/data.js` uses.

## 8. Validation

`node` script (kept outside the repo) checks: every layout slot type has a default inside its options; every
option exists in the catalog with the right type; all prices are integers equal to `round(Σ regular × 1.2)` and
match the raw file; public JSON has no `http`, supplier name, pid/sku/url keys or 9-digit codes; every option fits
the `max` of every slot it is offered in (pendant: `h + drop`); slot keys resolve as in `store.js` (slot id →
group → type) and every layout slot gets a default; pendant shade bottom is 70–85 cm above every dining-table
option; art_bed options clear the default headboard by ≥ 15 cm; the three wall-art defaults are different.
Result: 0 errors, 0 warnings.
