# Villar, curation round 1: every style × every budget level (design audit + data fixes)

Curator, 27 Nov. Brief: `docs/ART.md` §4 "The Villar Collection" and §5 "Art: Villar Editions". Rule files:
`research/style-system.md`, `research/stylepack-rules-*.md`, `research/budget-tiers.md`.

**Method.** Each level's room is the planner's own output (`site/js/core/budget.js` on the shipped data), not a
hand-made list. For the 4 styles × 7 stops (the minimum + 6 named levels) I checked, from the catalogue fields
(`colorHex`, `dims`, materials, `model.params`): 60-30-10, hard materials per zone, metal finish, wood tones, the
accent repeated three times, and scale (rug to sofa, bedside lamp to nightstand, art to the furniture below it).
Colour distances are CIELAB (ΔE76, L*). No browser frames were taken; anything that needs eyes on a render is
listed under "For the design reviewer".

## Verdict

**Before:** the four signature rooms were sound in colour and material, but (1) every wall work was decor-sized
(0.40–0.57 of the sofa; the rule is ⅔–¾), (2) «Без компромиссов» took the *most expensive option* in each place, which
removed the accent colour in three styles (sage, terracotta and olive-and-rust cushions were all replaced by the
plain 4-cushion oat set), (3) Mediterranean stood on a 160 × 230 rug that ends 4–12 cm under the sofa, and (4) three
packs contradicted their own pairings.

**After:** 24 Villar Editions sized to the furniture; one signature and at most two pre-checked alternates per
place (`picks`); 29 clashing pairs recorded (`avoid`) and kept out of every ladder step; «Без компромиссов» is the best
*designer* pick in each place; pairings agree with the signature rooms. Tests: `node tools/test-ai.mjs` 238 → 339.

Four gaps cannot be closed with the current assortment and need sourcing or a founder decision (§ "Open").

## What changed in the data

| File | Change |
|---|---|
| `site/data/catalog.json` | + 24 items (`type: wall_art`, `edition: true`, `image: "art/<id>.jpg"`); `rug-marlow-200x290` also tagged `mediterranean`. Nothing else touched. |
| `site/data/stylepack-*.json` | `picks` (30 slots each, 1–3 ids, signature first = default), `avoid` (17 + 4 + 2 + 6 pairs), options reordered (picks first), new art defaults, 5 other defaults (below), pairings aligned with the signature rooms. |
| `site/data/budget.json` | tier 3 order: the pendant first, then cushions, throw, art (was cushions, art, throw, pendant: art before the lamp over the table); entry and premium rules documented; three level blurbs. |
| `site/data/layout-studio.json` | art slots carry a `hang` rule (see "Art sizing and hanging"); fallback heights re-tuned. |
| `site/data/styles.json` | `"editions": true`. |
| `site/js/core/budget.js` | planner reads `picks`, `avoid` and `edition` (4 small edits, marked `curator`). |
| `site/js/core/data.js` | `withoutEditions()` and its use in `loadData` (marked `editions flag`). |
| `site/js/ai/core.js`, `tools/build-ai-index.mjs` | the server index carries `picks`, `avoid`, `edition`, `image`, and honours the flag, so the server ladder equals the browser's (tested). |
| `tools/editions.json`, `tools/editions-jobs.sql`, `tools/build-editions-sql.mjs` | prompts and generation jobs for the 24 works. |
| `tools/test-ai.mjs` | + section "curator: picks, avoid, Villar Editions" (101 checks). |

### Default (signature) changes other than art

| Style | Place | Was → now | Why (designer) |
|---|---|---|---|
| Light Oak | throw | Thorn oat → **Vayu sage waffle** | The oat throw is ΔL* 3 from the stone-linen sofa: it disappears. Sage reads (ΔL* 22), repeats the cushion's green (the pack needs its one accent in ≥ 2 places) and is what the pack's own pairing and the stylist note asked for. −48 AED. |
| Cashmere | bedside lamps | Crosby ceramic → **Dania brass + alabaster** | The pack's metal is champagne brass and its rule asks for stone or alabaster in lamps. Dania repeats the floor lamp and mirror finish (one metal, now in four places). It was already the floor lamp's pairing. +120 AED. |
| Mediterranean | rug | Pulara 160 × 230 → **Heaton 200 × 290 wool** | 160 cm ends 12 cm under the Oshawa sofa (4 cm under the Anders at lower levels) and is only 6 cm wider than the sofa: the rug floated in front of the seating. 200 × 290 goes 32 cm under and 33 cm past each end. +1,200 AED. |
| Mediterranean | rug at lower levels | Pulara → **Marlow 200 × 290** (added to the pack) | Same fault with the cheaper sofa; Marlow is the only room-sized rug under 1,000 AED in a warm sand. +120 AED. |
| Mediterranean | throw | Sultana sand → **Olivia terracotta** | Sand on a cream sofa is ΔL* 3: invisible. Terracotta is the pack's main accent and now sits in cushion, throw and object. +132 AED. |
| Mediterranean | bedside lamps | Tolima (40 cm shade) → **Crosby (30 cm)** | A 40 cm shade on a 45 cm top (0.89) leaves no room for the bedside vignette; 30 cm is ⅔. −72 AED. |

### Art below the designer's room (the simpler pieces)

| Style | Sofa wall | Bed wall | Dining wall |
|---|---|---|---|
| Dark Walnut | Madar Aziza 100 → **Najla 120 × 80** (0.43 → 0.52 of the 230 cm sofa) | Ember 90 × 60 → **Olina 120 × 60** (0.49 → 0.66 of the headboard) | Aquarelle 53 × 80 (0.66 of the 80 cm table) |
| Light Oak | Zuri 80 (0.40: too small, see Open 3) | Ember 90 × 60 (0.52) | Nyla 50 × 70 (0.50) |
| Cashmere | Olina 120 × 60 (0.52) | Ember 90 × 60 (0.49) | Zuri 80 → **Nyla 50 × 70** (80 cm over a 90 cm table was 0.89) |
| Mediterranean | Macaire 120 × 60 (0.60) | Caitlin triptych 126 × 60 (0.74) | Erato 80 (0.80, a little wide, kept for its clay relief) |

## Per style

Columns: L* of the large soft masses (all must be light, ≥ 70); dark masses = pieces with L* < 40 and a face over
0.5 m²; accents = number of places each accent family appears in; rug = size, how far it runs under the sofa front,
ΔL* to the sofa; art span = canvas width ÷ width of the furniture below (rule ⅔–¾ = 0.67–0.75); lamp = shade ÷
nightstand width (rule ≤ ¾).

### Dark Walnut

| Level | Total, AED (was → now) | Places | Large masses (L*) | Dark masses | Accents (places) | Rug ↔ sofa | Art span (sofa · bed · dining) | Lamp / nightstand |
|---|---|---|---|---|---|---|---|---|
| Minimum | 7,852 | 6/30 | sofa 87, curtains 94, bedding 94 | 1 | none yet | — | — | — |
| Essentials | 13,330 | 10/30 | same | 2 | none yet | — | — | — |
| Comfortable | 16,354 | 14/30 | + rug 78 | 2 | none yet | 200 × 290, 31 cm under, ΔL* −9 | — | 0.63 |
| Move-in ready | 19,717 → 19,597 | 20/30 | same | 2 | green ×1, terracotta ×2 | same | 0.52 · — · — | 0.63 |
| Fully furnished | 26,573 → 26,237 | 30/30 | same | 2 | green ×4, terracotta ×3, cognac ×1 | same | 0.52 · 0.66 · 0.66 | 0.63 |
| Magazine-ready | 36,243 → 37,520 | 30/30 | sofa 80, rug 80, curtains 93, bedding 94 | 1 | green ×3, terracotta ×6, cognac ×1 | 200 × 290, 24 cm under, ΔL* 1 | 0.70 · 0.66 · 0.70 | 0.67 |
| No compromises | 41,451 → 41,689 | 30/30 | sofa 79, rug 80 | 1 | terracotta ×6, green ×3, cognac ×1 | 200 × 290, 26 cm under | 0.72 · 0.72 · 0.70 | 0.67 |

- **60-30-10:** shell (warm white, oak floor) / oat and milk textiles + walnut / olive, terracotta, cognac, brass.
  Holds at every level. Dark masses 1–2 (limit 4), always with the rug or a textile between them.
- **Materials:** walnut, travertine, linen (+ one cognac leather piece). **Metal:** satin brass (sofa feet at the
  lower levels, floor lamp, TV-unit legs, cutlery); matte black only as the kettle and window frame. **Wood:** one
  walnut (all pieces ΔE ≤ 10 of `#553C2C`) + the oak floor.
- **Accent ×3:** from Move-in the sofa carries olive + rust cushions and a terracotta throw; the plant and the
  eucalyptus add green at Fully furnished; at Magazine the three editions each carry one rust mark.
- **Findings.** C1-01 art underscale (fixed: editions; Najla and Olina below). C1-02 «Без компромиссов» replaced the
  olive-and-rust cushions with the plain oat set, the travertine coffee table with a 90 cm walnut one (a fourth dark
  mass, and it forced the side table to travertine), the walnut mirror with a bronze arch beside satin brass, and the
  bedroom's terracotta with olive for +12 AED (fixed: premium = picks; now Brighton sofa, Maison bed, Wishbone chairs,
  two-tier linen pendant, brass bedside lamps, velvet-and-linen cushions that keep both accents, the 160 cm work).
  C1-03 sofa and rug are ΔE 2.4 apart at Magazine (kept on purpose: the sofa's walnut plinth draws the line; Dione
  cream wool is the alternate for a lighter island).
- **Verdict:** every level reads as a designed room. Weakest stop: Move-in, where the 120 cm work is 0.52 of the
  230 cm sofa.

No compromises differs from Magazine in: sofa, bed, mattress, dining chairs, pendant, bedside lamps, cushions, sofa
art (Umber No. 1 → Ink Field), plant, tableware.

### Light Oak

| Level | Total, AED (was → now) | Places | Large masses (L*) | Dark masses | Accents (places) | Rug ↔ sofa | Art span (sofa · bed · dining) | Lamp / nightstand |
|---|---|---|---|---|---|---|---|---|
| Minimum | 7,180 | 6/30 | sofa 79, curtains 93, bedding 94 | 0 | none yet | — | — | — |
| Essentials | 11,938 | 10/30 | same | 0 | none yet | — | — | — |
| Comfortable | 14,662 | 14/30 | + rug 81 | 0 | none yet | 200 × 290, 19 cm under, ΔL* 2 | — | 0.49 |
| Move-in ready | 16,843 → 16,795 | 20/30 | same | 0 | green ×2, charcoal ×1 | same | 0.40 · — · — | 0.49 |
| Fully furnished | 21,232 → 21,184 | 30/30 | same | 0 | green ×2 (+ plant), charcoal ×2 | same | 0.40 · 0.52 · 0.50 | 0.49 |
| Magazine-ready | 21,280 → 22,793 | 30/30 | same | 0 | green ×4, charcoal ×3 | same | 0.70 · 0.69 · 0.70 | 0.49 |
| No compromises | 25,391 → 25,396 | 30/30 | rug 87 | 0 | green ×5, charcoal ×5 | 200 × 290, 19 cm under, ΔL* 8 | 0.74 · 0.69 · 0.70 | 0.67 |

- **60-30-10:** shell / stone linen, rice paper, light oak / sage, charcoal, stoneware. Holds. No dark mass.
- **Materials:** light oak, paper, marble side table. **Metal:** matte black only. **Wood:** pale oak (TV unit,
  coffee table, bed, table, chairs, armchair frame) + charcoal (sofa legs). **One piece is off-tone:** the Forren
  nightstands (`#B58F66`, ΔE 20 from the Grant bed they stand against; the rule is ≤ 6). They are the pack's only
  nightstand. See Open 1.
- **Accent ×3:** sage cushion + sage throw from Move-in, the olive tree and eucalyptus at Fully furnished, the
  editions at Magazine (sage shore, sage wash). Charcoal contrast: sofa legs, mirror, planter.
- **Findings.** C1-04 oat throw invisible on the sofa (fixed). C1-05 «Без компромиссов» swapped the sage cushions
  for the plain oat set and the sage-ready sofa lost its only colour (fixed: now the linen set with one olive
  cushion); the polypropylene rug could never be upgraded because the sofa pairing locked it (fixed: Dione handmade
  wool at the top, ΔL* 8 to the sofa instead of 2). C1-06 bed pairing asked for sage bedding while the room uses white
  and oat (fixed). C1-07 the 22 cm Laodica lamp is small beside a 110 cm headboard (kept as the signature for its
  stoneware; Crosby, ⅔ of the top, is the alternate and the top level's lamp).
- **Verdict:** designed from Comfortable up; **Move-in and Fully furnished still hang an 80 cm canvas over a 200 cm
  sofa** (Open 3).

No compromises differs from Magazine in: rug, mattress, bedding (adds an olive cushion), bedside lamps, cushions,
sofa art (Still Shore → Line No. 1 diptych), mirror (arch), coffee-table decor, centrepiece, kettle (black).

### Cashmere (greige-luxe)

| Level | Total, AED (was → now) | Places | Large masses (L*) | Dark masses | Accents (places) | Rug ↔ sofa | Art span (sofa · bed · dining) | Lamp / nightstand |
|---|---|---|---|---|---|---|---|---|
| Minimum | 9,688 | 6/30 | sofa 87, curtains 93, bedding 94 | 0 | none | — | — | — |
| Essentials | 14,890 | 10/30 | same | 0 | none | — | — | — |
| Comfortable | 18,214 → 18,334 | 14/30 | + rug 87 | 0 | none | 200 × 290, 31 cm under, ΔL* 1 (bouclé on flat wool) | — | 0.60 |
| Move-in ready | 20,869 → 20,989 | 20/30 | same | 0 | none | same | 0.52 · — · — | 0.60 |
| Fully furnished | 28,388 → 28,364 | 30/30 | same | 0 | mocha ×1 | same | 0.52 · 0.49 · 0.56 | 0.60 |
| Magazine-ready | 32,216 → 33,813 | 30/30 | sofa 86, rug 80 | 0 | mocha ×2 (+ smoked oak) | 200 × 290, 34 cm under, ΔL* −5 | 0.67 · 0.72 · 0.78 | 0.60 |
| No compromises | 34,148 → 36,005 | 30/30 | same | 0 | mocha ×3 (+ smoked oak) | same | 0.76 · 0.72 · 0.78 | 0.60 |

- **60-30-10:** shell / ivory bouclé, greige, travertine / mocha, smoked oak, champagne brass. Holds; no dark mass.
- **Materials:** travertine, ivory lacquer, smoked oak. **Metal:** one brass finish (`#A88B55`) on floor lamp,
  bedside lamps, mirror, cutlery. **Wood:** smoked oak only, in legs and pedestals.
- **Accent ×3:** the pack has no colour by design; its "accent" is the mocha step. Until now it existed only in the
  smoked-oak legs. The editions carry it (mocha field, mocha undertone), with champagne as a hairline.
- **Findings.** C1-08 no cushion and no throw in the catalogue is darker than the sofa (rule: one cushion ΔL* ≥ 15,
  throw ΔL* ≥ 10; best available is 4). Not fixable in data: Open 2. C1-09 ceramic bedside lamps in a brass-and-stone
  room (fixed: Dania). C1-10 dining art 80 cm over a 90 cm table (fixed: Nyla below, edition 70 cm at Magazine).
  C1-11 travertine coffee table beside a marble side table and the same stone-and-ivory piece twice are recorded as
  `avoid` (one stone per zone; side table must contrast).
- **Verdict:** calm and coherent at every level; the lightness ladder is short until the editions arrive.

No compromises differs from Magazine in: mattress, pendant, sofa art (Travertine No. 1 → Champagne Field),
cushions (four), plant, tableware (for six), centrepiece, kitchen set.

### Mediterranean

| Level | Total, AED (was → now) | Places | Large masses (L*) | Dark masses | Accents (places) | Rug ↔ sofa | Art span (sofa · bed · dining) | Lamp / nightstand |
|---|---|---|---|---|---|---|---|---|
| Minimum | 6,580 | 6/30 | sofa 88, curtains 94, bedding 94 | 0 | none yet | — | — | — |
| Essentials | 12,742 | 10/30 | same | 0 | none yet | — | — | — |
| Comfortable | 15,502 → 15,550 | 14/30 | + rug 78 | 0 | none yet | 200 × 290, 24 cm under (was 160 × 230, 4 cm) | — | 0.67 (was 0.89) |
| Move-in ready | 18,541 → 18,721 | 20/30 | same | 0 | terracotta ×2, blue ×1 | same | 0.60 · — · — | 0.67 |
| Fully furnished | 23,415 → 23,595 | 30/30 | same | 0 | terracotta ×4, blue ×1, green ×2 | same | 0.60 · 0.74 · 0.80 | 0.67 |
| Magazine-ready | 29,965 → 32,526 | 30/30 | sofa 81, rug 80 | 0 | terracotta ×7, blue ×3, olive ×2 | 200 × 290, 32 cm under (was 160 × 230, 12 cm) | 0.66 · 0.71 · 0.70 | 0.67 |
| No compromises | 33,991 → 33,920 | 30/30 | same | 0 | same | same | 0.71 · 0.71 · 0.70 | 0.67 |

- **60-30-10:** limewash shell / bleached linen, rattan, warm wood / terracotta, sea blue, olive, iron. Holds.
- **Materials:** cane and rattan, warm oak, linen (+ the marble side table). **Metal:** wrought-iron black only.
  **Wood:** warm oak family (bed, nightstands, coffee table, cane TV unit: ΔE ≤ 5 of `#B99A72`); the dining set is a
  step paler (table ΔE 8, chairs 7 from the table) and reads as its own zone. At the lower levels the pale-oak Echo
  TV unit stands opposite the warm-oak coffee table (ΔE 16): Open 4.
- **Accent ×3:** terracotta in cushion, throw and coffee-table object from Move-in/Fully furnished; blue in the
  striped cushion, the bedding and the sofa work; olive only in the planter and one work (the third family is allowed
  in one artwork).
- **Findings.** C1-12 rug too small (fixed). C1-13 sand throw invisible (fixed). C1-14 lamp shade as wide as the
  nightstand (fixed). C1-15 «Без компромиссов» replaced the terracotta-and-blue cushions with the plain oat set, the
  oak bed with a greige channel-tufted one and the triptych with the smaller Ember (fixed: the bed, cushions and
  bedding now stay; the top level adds the 160 cm work, the hyacinth pendant, the larger olive tree). C1-16 woven
  furniture: cane armchair + cane TV unit + cord dining chairs, and cane arm panels on the sofa. The rule allows two
  large woven types; kept as the pack's signature, flagged for the design reviewer.
- **Verdict:** the room is now anchored (rug) and the accent reads (throw). Lower levels carry the TV-unit tone gap.

No compromises differs from Magazine in: mattress, pendant, sofa art (Noon Coast → Terracotta Roofs), plant,
centrepiece, kitchen set.

## Picks and avoid

- `picks[slot] = [signature, alt1, alt2]`, at most 3. The signature is the pack default (tested). An alternate is
  listed only if it sits with the *rest of the signature room* (tested against `avoid`) and, when it costs more
  than the signature, is a real step up: «Без компромиссов» takes the priciest pick. A slot may have one or two picks
  when nothing else passes (e.g. the Dark Walnut side table: every other option is travertine beside the
  travertine coffee table).
- `avoid` holds measured clashes only: the same hard material side by side (side ↔ coffee table), a second
  bouclé piece, two brass finishes (bronze arch mirror with satin brass), a stone mix in one zone (Cashmere), a
  160 cm rug that stops short of the sofa legs, a throw within ΔL* 3 of its sofa, a 40 cm shade on a 40–45 cm
  nightstand, a 160 cm canvas over a 200 cm sofa.
- The planner never forms an `avoid` pair (tested on every step of every default ladder).

## Art sizing and hanging (ART §5)

| Wall | Furniture below (cm) | Edition sizes | Span | Free wall |
|---|---|---|---|---|
| Sofa (east) | sofas 200–230 wide, backs 75–90 high | 140 × 100, 160 × 100, diptych 2 × 70 × 100 with 10 cm between canvases (150; was 8 cm, widened on the modeler's advice) | 0.66–0.76 at the levels that use them | 5.4 m run (kitchen end to curtain stack); art centred on the sofa |
| Bed (west) | headboards 167–182 wide, 100–114 high | 120 × 90 (both works) | 0.66–0.72 | 3.1 m between the TV and the curtain |
| Dining (bathroom partition) | tables 80–100 | 70 × 100 portrait (both works) | 0.70 (0.78 over the 90 cm Cashmere table) | 2.0 m; 65 cm clear each side |

- **Which size goes where.** Dark Walnut and Mediterranean lead with the diptych (their signature sofas are 211 and
  224); Light Oak and Cashmere lead with 140 × 100 (sofas 200 and 210). The 160 cm work is the top-level piece
  where the sofa is ≥ 210; Light Oak's 200 cm sofas get the diptych instead (160 would be 0.80).
- **No 140 × 100 over the bed.** It would span 0.77–0.84 of every bed in the catalogue. Both bed works are 120 × 90.
- **Hanging.** The furnisher hangs art at a fixed height from the layout (`slot.pos` y), whatever the canvas height
  or the sofa back: a 60 cm work sat 46 cm above the sofa, and a 90 cm work would touch the 114 cm headboard. The
  layout now states the rule as data (`hang: { over, gap, centre, centreOn, span, wall }`) and the request to the
  engine is filed (`docs/requests/engine.md`, "From curator"). Until it lands, `pos` y is tuned for the signature
  rooms (sofa 1.56, bed 1.74, dining 1.45): right for the editions, 10–15 cm high for the simpler pieces.

## Villar Editions (24)

Float frame in the pack's wood or metal, 4 cm canvas, printed to order. Titles are ours; no artist, no reference to
an existing work. Fallback motif and colours are in `model.params`, so each renders today.

| Style · frame | Wall | id | Title (RU / EN) | Size, cm | AED | Role |
|---|---|---|---|---|---|---|
| Dark Walnut · dark walnut | sofa | `art-ed-dw-umber-1` | Умбра № 1 / Umber No. 1 | diptych 2 × 70 × 100 | 1,090 | signature |
| | sofa | `art-ed-dw-ink-field` | Чернильное поле / Ink Field | 160 × 100 | 1,490 | alternate, top level |
| | bed | `art-ed-dw-umber-2` | Умбра № 2 / Umber No. 2 | 120 × 90 | 890 | signature |
| | bed | `art-ed-dw-warm-shadow` | Тёплая тень / Warm Shadow | 120 × 90 | 890 | alternate |
| | dining | `art-ed-dw-rust-stroke` | Ржавый штрих / Rust Stroke | 70 × 100 | 590 | signature |
| | dining | `art-ed-dw-ink-3` | Тушь № 3 / Ink No. 3 | 70 × 100 | 590 | alternate |
| Light Oak · light oak | sofa | `art-ed-lo-still-shore` | Тихий берег / Still Shore | 140 × 100 | 990 | signature |
| | sofa | `art-ed-lo-line-1` | Линия № 1 / Line No. 1 | diptych 2 × 70 × 100 | 1,090 | alternate, top level |
| | bed | `art-ed-lo-morning-mist` | Утренний туман / Morning Mist | 120 × 90 | 890 | signature |
| | bed | `art-ed-lo-line-2` | Линия № 2 / Line No. 2 | 120 × 90 | 890 | alternate |
| | dining | `art-ed-lo-winter-light` | Зимний свет / Winter Light | 70 × 100 | 590 | signature |
| | dining | `art-ed-lo-line-3` | Линия № 3 / Line No. 3 | 70 × 100 | 590 | alternate |
| Cashmere · champagne brass | sofa | `art-ed-gl-travertine-1` | Травертин № 1 / Travertine No. 1 | 140 × 100 | 990 | signature |
| | sofa | `art-ed-gl-champagne-field` | Поле шампань / Champagne Field | 160 × 100 | 1,490 | alternate, top level |
| | bed | `art-ed-gl-hush` | Тишина / Hush | 120 × 90 | 890 | signature |
| | bed | `art-ed-gl-stone-light` | Камень и свет / Stone and Light | 120 × 90 | 890 | alternate |
| | dining | `art-ed-gl-mocha-2` | Мокко № 2 / Mocha No. 2 | 70 × 100 | 590 | signature |
| | dining | `art-ed-gl-layers` | Слои / Layers | 70 × 100 | 590 | alternate |
| Mediterranean · natural oak | sofa | `art-ed-med-noon-coast` | Берег в полдень / Noon Coast | diptych 2 × 70 × 100 | 1,090 | signature |
| | sofa | `art-ed-med-terracotta-roofs` | Терракотовые крыши / Terracotta Roofs | 160 × 100 | 1,490 | alternate, top level |
| | bed | `art-ed-med-olive-grove` | Оливковая роща / Olive Grove | 120 × 90 | 890 | signature |
| | bed | `art-ed-med-quiet-cove` | Тихая бухта / Quiet Cove | 120 × 90 | 890 | alternate |
| | dining | `art-ed-med-arch-shade` | Арка и тень / Arch and Shade | 70 × 100 | 590 | signature |
| | dining | `art-ed-med-steps-sea` | Лестница к морю / Steps to the Sea | 70 × 100 | 590 | alternate |

- **In the ladder.** Up to «Полностью обставлено» the walls carry the simpler pieces. The last three steps before
  «Как в журнале» hang the editions, sofa wall first (Dark Walnut: +611, +651, +351 AED). «Без компромиссов» swaps the
  sofa work for the larger one. Art at Magazine: 2,570 AED (Dark Walnut, Mediterranean) or 2,470 (Light Oak,
  Cashmere).
- **Flag.** `"editions": false` in `styles.json` removes them from options, picks and defaults; every art slot falls
  back to its simpler pick, in the browser and in the server index (tested: no ladder step holds an edition).
- **Prompts.** `tools/editions.json`: medium, colours in words, composition, texture; the hex palette (pack accent
  first, then its neutrals, then deeper pack tones) travels separately; each brief is under the job's 800-character
  limit. `tools/editions-jobs.sql`: 24 rows for `public.photo_jobs`, 2 candidates each, 2K.

## Open (sourcing or founder decision)

> **Update, round 2 (27 Nov):** items 1–4 are closed by sourcing; see `docs/reviews/curation-2.md`. Items 5–7 were
> accepted by the coordinator. The totals in the tables above are round-1 numbers; current ones are in `docs/BUDGET.md`.

1. **Light Oak nightstand.** The only option is warm oak beside a pale-oak bed (ΔE 20). Needs one pale-oak
   nightstand (ΔE ≤ 8 from `#D2BA94`, ≤ 52 cm high, ≤ 50 cm wide). Until then the pair stays.
2. **Cashmere textiles.** No taupe or mocha cushion set and no taupe throw exist in the catalogue, so the pack's
   own contrast rules cannot be met at any level. Needs one cushion set with a mocha cushion and one taupe or mocha
   throw.
3. **Light Oak art below Magazine.** The only non-edition work for the sofa wall is 80 cm. Either source one
   120–140 cm quiet piece under 500 AED, or let Light Oak's sofa edition enter one level earlier.
4. **Mediterranean TV unit below Magazine.** The affordable unit is pale oak in a warm-oak room; the right one costs
   4,379. Needs one warm-wood unit under 1,500 AED.
5. **Bed editions are both 120 × 90.** ART §5 said 120–140; 140 × 100 breaks the ¾ rule on every bed sold. The
   100 × 100 size from the price table is unused for the same reason (too narrow for the sofa and the bed, too wide
   for the table).
6. **«Без компромиссов» is now "the designer's best pick", not "the most expensive option".** Totals: Dark Walnut
   41,689, Light Oak 25,396, Cashmere 36,005, Mediterranean 33,920.
7. **Mediterranean costs 2,561 AED more at Magazine** (rug 1,200, art 1,301, throw 132, lamps −72).
8. **Print partner** (ART §5 open point): the flag is in place; nothing else depends on it.

## For the design reviewer (needs eyes on a frame)

- Sofa and rug within ΔE 2–4 in Dark Walnut and Light Oak signature rooms: does the plinth / leg gap separate them?
- Cashmere at Magazine: 70 cm canvas over the 90 cm round table (0.78), 160 cm over the 210 cm sofa at the top (0.76).
- Mediterranean woven count (C1-16).
- Diptych gap: now 10 cm canvas to canvas (about 6 cm of wall between the float frames), on the modeler's advice.
- Fallback motifs (before the images exist): they are placeholders, not the works.
