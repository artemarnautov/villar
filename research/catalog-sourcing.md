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

`node` script (kept outside the repo, run after every build) checks, for **every pack in `styles.json`**:

- **Catalog:**
  - every layout slot resolves a default inside its options (slot id → group → type, as in `store.js`);
  - options exist in the catalog with the right type;
  - prices are integers equal to `round(Σ regular × 1.2)` and match the raw file;
  - EN fields are present and contain no Cyrillic.
- **Hygiene:** public JSON has none of the following:
  - `http`;
  - the supplier name;
  - pid / sku / url / price-basis keys;
  - 9-digit codes;
  - any of 30+ third-party marketplace brands (the list lives with the script; brands were read from the supplier's `brand` field for every component and are stored per product in `research/homecentre-raw.json`).
- **Numeric rules:**
  - every option is checked against the size bands of that pack's `stylepack-rules-<id>.md` (sofa w/d/back/seat, coffee-table footprint and height, dining height, chair w/d/back, lamp heights and shades, art widths per wall, etc.);
  - documented exceptions are listed as NOTES, not hidden.
- **Geometry:**
  - every option fits the `max` of every slot it is offered in (pendant: `h + drop`);
  - the pendant bottom is 70–85 cm above every dining option;
  - `art_bed` clears the default headboard by ≥ 15 cm;
  - sofa–coffee passage ≥ 45 cm and coffee–TV ≥ 75 cm for every option combination (the engine's `align` gap of 0.47 m is honoured).
- **Pairings and art:**
  - the three wall-art option sets are disjoint;
  - pairings reference valid keys and options.

Result (26.11.2026): **0 errors**. NOTES list every exception below. WARN lists slots with fewer than 3 options.

## 9. Phase 2 — QA fixes, details, EN fields, three new packs (25–26.11.2026)

### 9.1 QA fixes on «Тёмный орех»

- **QA-03 — brand names:**
  - `dining-mahmayi-80` → `dining-square-80` «Обеденный стол квадратный, 80×80»;
  - `plant-olive-homekode` → `plant-olive-180` «Оливковое дерево в горшке, 180 см».
  - Public names use model names only. Supplier brands are recorded per product in the raw file.
- **QA-12:** the Themis olive name now says 180 см, matching `dims.h`.
- **QA-08 — size bands.** Removed from DW:
  - sofas Hadley, Engler, Anders, Doree, Lockwood;
  - coffee tables Baku low and Baku high (this also resolves QA-20 for the Baku pair);
  - bed Nazario;
  - chairs Viona, Pebble, Alfred;
  - art Caitlin.

  Added:
  - sofas Brighton (222×90×82, light taupe, walnut base) and Daventry (230×95×82, ivory bouclé, brass feet);
  - coffee table Selric (walnut, Ø90×40);
  - side table Herald (walnut, Ø50×50);
  - chair Stanton (52×58×85).

  The default coffee table is now Moxie (oval 130×70×40), with Herald as the default side table, so walnut ↔ travertine holds.

  Documented 1 cm exceptions:
  - Lansbury back 86;
  - Kentana h 73;
  - Wishbone back 74.
- **QA-09:** the art option sets are disjoint. Pairings carry these rules:
  - side ↔ coffee material;
  - one bouclé piece;
  - Brighton → N1 rug.
- **QA-06:** solved by the engine's `align` (0.47 m). The validator confirms it for every combination.
- **Kitchen:**
  - the slot is 52×30×45, so the 30 cm bowl was dropped and the board leans against the backsplash (all sets 52×30×36–41);
  - the DW detail rules forbid light or red boards, so the bamboo-board set is no longer offered in DW;
  - the DW default is the dark-board set.
- **Curtains:** 390 → 380 to fit the new slot max.
- **Detail types** (tableware, centerpiece, kitchen_decor, throw, nightstand_decor, runner, mirror) have 2–4 options per pack where stock allows. Home Centre sells no decorative books, so `nightstand_decor` uses a box or tray, a bud vase and a candle or sprig.
- **EN fields:** every catalog item has `nameEn`, `materialsEn[]` and `colorEn`.
- **Public catalog:** contains only items offered by at least one pack. The others stay in the raw file with their verdicts.

### 9.2 New packs — defaults and budgets (default room, all placements)

| Pack | Default total | Target | Signature items sourced |
| --- | --- | --- | --- |
| light-oak «Светлый дуб» | 23,432 AED | 24–28k | sofa Rockwell (stone weave, charcoal legs), armchair Natura (oak frame), Echo TV unit + Echo coffee table (light oak, slatted), Keira round oak table, Emily wishbone chairs (pale wood, rope seat), Berit paper-cord pendant, Diamant paper column lamp, black round / arch mirrors, Pavia marble side table |
| greige-luxe «Кашемир» | 31,859 AED | 38–46k | sofa Pebble (curved ivory bouclé), armchairs Oti / Mons / Emma, Joyce TV unit (ivory + travertine top), Arkas oval coffee table, Joyce + Pavia side tables, Qubba ribbed nightstand, Malta marble-look pedestal table, Salalah chair |
| mediterranean «Средиземноморье» | 30,812 AED | 28–34k | sofa Oshawa (cane sides, light oak), Sukhna cane chair, Windsor mango + cane TV unit, Corta round oak coffee table, Forren bed + nightstand (warm oak), Emily rope-seat and Canovia cane-back chairs, Audrey rattan floor lamp, rattan pendants, terracotta textiles and art |

Light oak and Cashmere come in **below** their target bands. The stock that passes their rules is cheap (light oak: oak melamine pieces) or thin (Cashmere: the only compliant-looking dining table is an 849 AED ceramic pedestal table). Adding options does not change the defaults' prices.

### 9.3 Bridges

Bridge items follow `research/style-system.md` §2.7. Walnut, rattan or cane furniture, charcoal oak and curved bouclé are never bridged.

| Bridge | Items |
| --- | --- |
| All four packs | mattresses; Sullivan curtains; Cloud bed; Crosby lamp; Cosme linen pendant; Heaton rug; Ember art; three olive trees; Lillian tableware; Maya and Sable centrepieces; Thorn oat throw; Zen and Marco runners; travertine-candle bedside set; new cream-ceramic decor set; white-oat bedding |
| DW + LO + GL | Dexter linen pendant; Dione rug; linen-oat cushions; Zuri and Nyla art |
| DW + LO + MED | white-oat-olive bedding; Vayu / Norham throws; Pulara dhurrie; linen-olive cushions |
| DW + GL | Sable / Austen floor lamps; Dania lamp; Agnek and Artemis-arch mirrors; Olina art; Dara box; Mia tableware |
| DW + MED | terracotta cushions, bedding, decor and throw; rattan pendants; Aziza / Hiba / Aquarelle / Vaseo / Caitlin art |
| LO + GL + MED | Pavia all-marble side table (stone with no dark support) |
| LO + MED | Keira table; Emily chair; Echo TV unit (MED option, h 43); Mackenzie black arch mirror |

Each new pack has `pairings` on its anchors and its main bridges, so a cross-style swap carries the room along:
- sofa → cushions, throw, rug, coffee table, side table;
- bed → bedding, nightstand, lamp, bedside decor, art_bed;
- dining table → chair, pendant, tableware, centrepiece, art_dining;
- bridged rug, pendant and throw → their anchors.

### 9.4 Gaps and exceptions — please read

**Size-band exceptions.** These are inside the slot max and pass the clearances, per the coordinator's rule:
- LO: Rockwell depth 83; Anders back 90; Keira h 77; Emily back 74; Diamant is a Ø20 paper column, not a shade; Zuri 80 over the sofa.
- GL: Daventry back 82; Mons w 67; Emma d 95; Joyce coffee table is a soft rectangle (option only); Malta dining table is a 90 soft square.
- MED: Sukhna w 64; Echo TV h 43 (option only); Caitlin 126 over the bed (option only); Emily back 74; Canovia listed depth 40.

**Second pass (26.11.2026, coordinator-requested, time-boxed).**
- **GL dining table — fixed.** Malta (90×90×75): white marble-look ceramic top on an ivory tulip pedestal. Kentana is no longer offered in Cashmere; it stays in DW. Recorded exception: soft square instead of round Ø90–100. Every round stone or ivory table in stock is 110–120 cm (Modena, Neon, Tensa, Lumo, Willow, Lino).
- **MED dining chairs — fixed.** Emily (pale teak wishbone, woven rope seat) is the default. Canovia (honey wood, cane back) is the option. Sven is no longer offered in MED; it stays in LO.
  - Exceptions: Emily back 74 (the listing swaps width and height: "W74 D55 H54"); Canovia's listed depth 40 is the seat depth.
- **LO chairs — fixed.** Emily is the default; it is the rules' ★ "вишбон" chair. Sven (PU-coated seat) remains as an option.
- **LO nightstand — still a gap.** Forren (warm oak, ΔE > 8 from the LO oak) stays the default. Checked and rejected:
  - Grant: pale fluted oak, 45×40×51, ideal, but **out of stock online**; recheck later.
  - Natura, Anasa, Warner, Lorenzo, Frank: 55–70 cm wide, over the 50 cm slot.
  - Lumi: dark.
- **MED armchair — unchanged.** Sukhna's teak-brown frame is darker than W6. No compliant cane or rattan chair ≤ 95 cm was found in the time box.
- **Stock re-checked on the product page** ("Add To Basket" present, no "Out of Stock") for every new furniture item, including Brighton, Daventry, Selric, Herald, Stanton, Sukhna, Salalah, Arkas and both black mirrors.

**Thin options (1–2 per slot).** Most new-pack furniture slots have only 1–2 options: most Home Centre seating is 100–113 cm deep or over 240 cm wide; most light, ivory and oak TV units are 200 wide or more; Ripple, Myra, Kairo, Finn, Zeus, Rena and Vittoria were rejected. More can be sourced in a follow-up pass.

**Colours.** Colours of the new items are photo-sampled (studio lighting). Rockwell, Pebble, Daventry and Qubba sit near family boundaries. Qubba was held as review (L* ≈ 69, below the GL sofa band).

### 9.5 Bridge widening (data-only pass, 26.11.2026, no new browsing)

**New composite items.** These were built only from components already priced in the raw file:

| Item | Bridges to |
| --- | --- |
| `tableware-mia-smoke-wood` (sand stoneware, smoked glass, wooden cutlery) | DW, LO, MED |
| `tableware-lillian-amber-brass` (brass cutlery) | DW, GL |
| `kitchen-black-basic` (light board) | LO, MED; not DW, whose rules ban light boards; not GL, which bans black |
| `kitchen-white-travertine` | all four |
| `nsdecor-bud-vase-tealight` | all four |
| `decor-travertine-cream` | all four |
| `cushions-oat-ivory-4` | all four |
| `bedding-white-sateen-oat` | all four |
| `throw-boras-oat` | all four |

**Existing items added where the bridge condition holds:**
- `bed-maison-160` (soft N2, hidden base) → LO, MED;
- `mirror-artemis-round-black` (thin K1) → MED;
- `curtains-khor-sheer` → MED (ΔE 2.2 to the MED walls; Khor fails LO at 5.2 and GL at 6.2);
- `sofa-anders-3` → MED (cream, slim black legs; back 90 is a band exception, option only);
- `armchair-natura` → MED (W2 frame, the rules' alternative to W6).

**Unchanged:**
- Defaults, pairings and IDs; the three art sets stay disjoint.
- Validator: 0 errors.

**Slots still under 2 options:**

| Pack | Count | Slots |
| --- | --- | --- |
| LO | 11 | coffee_table, tv_unit, side_table, armchair, floor_lamp, nightstand, table_lamp, dining_table, and the three art walls (only Ember, Zuri and Nyla pass LO's art rules, so each wall gets one) |
| GL | 6 | tv_unit, nightstand, dining_table, dining_chair, art_sofa, art_bed |
| MED | 5 | coffee_table, side_table, floor_lamp, nightstand, dining_table |
| DW | 0 | – |

Each of these needs new sourcing.

### 9.6 Round-2 review fixes (26.11.2026)

**R2-12 — Light Oak's own layer.** New defaults, sourced and checked in stock on the product page:

| Slot | Item |
| --- | --- |
| Bed | Grant: pale oak, low platform, textured slatted headboard 110 |
| Rug | Elsin: stone pin-stripe flat weave, 290×200 |
| Table lamps | Laodica: speckled stoneware-look base, linen shade; exception: shade Ø22 vs 25–38 |
| Plant | olive in a charcoal ribbed pot; the pot is the charcoal accent the review asked for, next to the black mirror at the entrance |
| Cushions | sage and oat woven covers |
| Bedding | sage percale with an oat throw |

The paper lamps were already Light Oak's own (Berit pendant, Diamant column floor lamp).

Rejected:
- Jack paper-rope table lamp: out of stock online.
- Bosco charcoal stoneware lamp: Ø50 shade.
- Double-trunk ficus: 75 cm wide, glossy leaves.
- Lea jacquard throw: geometric acrylic.

Light Oak now shares only the mattress, the bed art and the runner with DW's defaults.

**PT-11 — Mediterranean's own layer.** New defaults:

| Slot | Item |
| --- | --- |
| Cushions | terracotta + Aegean-blue woven stripe + oat/jute band |
| Bedding | white percale + terracotta and blue-stripe cushions |
| Throw | Sultana: sand, fringed |
| Art | Macaire sand-wave relief over the sofa; Caitlin palm triptych over the bed (no longer in DW); Erato amphora relief at the dining table (Andreya banana leaves as the option) |
| Plant | a different olive in an olive-glazed pot |

Mediterranean now shares only the mattress with DW's defaults. The Arch blue cushion cover was rejected: out of stock online.

**PT-10 — decor.**
- `decor_set` is split into the slot keys `decor_coffee` (low: tray + candles, bowls, bud vases) and `decor_tv` (taller vase sets).
- The option sets are disjoint, and the validator enforces it.
- No layout change: the store already resolves the slot ids `decor_coffee` and `decor_tv`.

**PT-12 / PT-13 — tableware and rug names.**
- Tableware names now describe the delivered set, e.g. «Сервиз Mia на 4 персоны, янтарные стаканы, латунные приборы».
- Each tableware item has a `shortName` / `shortNameEn` that differs within the first 20 characters, plus `setNote` / `setNoteEn` ("you receive the full set; the 3D lays a table for two").
- Rug and runner names now follow the card's w × d order, and the validator checks it.
- Bed names say «под матрас 160×200» / "for a 160×200 mattress".

**D2-03 / D2-14 — copy and rules.**
- The Dark Walnut palette has `nameEn`, `summaryEn` and `nameEn` on all 12 swatches.
- All four pack descriptions and palette summaries use the reviewers' plain wording.
- «Светлый дуб (пол)» → «Светлый дуб пола».
- Every pack ships 4 `consumerRules` + `consumerRulesEn`.
- The validator fails if a display field has no `…En` twin.

**R2-18 — pendant trim.** The Cosme trim is now `#C9B99F`, a tone-on-tone natural linen stitch that suits every pack. It replaces the cognac `#8E5B34`.

**R2-13 — cane the modeler should render.**

| Archetype | Parameter → expected render |
| --- | --- |
| sofa | `armPanel: 'cane'\|'rattan'` + `armPanelColor` → cane panel on the outer, **front and inner** arm faces (Oshawa) |
| armchair | Sukhna is now `style: 'frame', frameVisible: true, seat: 'cane', back: 'cane', caneColor, woodColor` → exposed wood frame with cane seat and back panels, as in the dining-chair cane path; no upholstery |
| dining_chair | `back: 'cane'` + `caneColor` (Canovia); `seat: 'cord'` (Emily) and `seat: 'rattan'` (Wishbone), both with `backStyle: 'y-splat'` → woven seat texture |
| tv_unit | `fronts: 'cane'` (Windsor), already rendered |
| bed | `style: 'platform'`, `headboard: 'slatted'` (Grant); `headboard: 'cane'\|'rattan'` is supported for future items |
| pendant / floor lamp | `body: 'rattan'` or `'paper'`; `shadeMaterial: 'rattan'\|'paper'`. Diamant (`stem/shade: 'column'`, `base/shadeMaterial: 'paper'`) needs the paper-cord column, Ø 0.2 × 1.4 m, glowing at night |
| rug | `material: 'flat-weave'`, `pattern: 'pinstripe'` (Elsin) |
| wall_art | `relief: true` (Macaire, Erato) |
