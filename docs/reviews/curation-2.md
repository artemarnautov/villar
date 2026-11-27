# Villar, curation round 2: the four gaps closed by sourcing

Curator, 27 Nov. Follows `docs/reviews/curation-1.md` ("Open" 1–4). Supplier data, links and the candidates that
were checked and not used are in `research/` only (`catalog-sourcing.md` §9.7, `homecentre-raw.json`).

## What was found

| Gap | Piece (catalogue id) | Size, cm | Colour | AED | What it fixes, in numbers |
|---|---|---|---|---|---|
| Light Oak nightstand | Grant, fluted light oak, 2 drawers (`nightstand-grant`) | 45 × 40 × 51 | light oak `#D6C2A2`, the bed's own finish | 419 | Nightstand to bed: ΔE 20 → 0 in the data (3.4–4.6 between the two product photos; rule ≤ 6). Same price as the piece it replaces. |
| Cashmere cushions | Linen set of 3: milk, oat, taupe (`cushions-linen-oat-taupe`) | 50 × 50 each | `#ECE6DC` / `#D6CBB8` / `#A39480` | 1,028 | Darkest cushion to sofa: ΔL* 4 → 24 (rule ≥ 15). |
| Cashmere throw | Verona, mocha, tonal fringe (`throw-verona-mocha`) | 130 × 170 | mocha `#7B6354` | 107 | Throw to sofa: ΔL* 4 → 42 (rule ≥ 10). The room now steps ivory → oat → taupe → mocha on the sofa itself. |
| Cashmere throw, alternate | Fallon chenille, taupe (`throw-fallon-taupe`) | 130 × 170 | taupe `#9E9389` | 107 | ΔL* 24 to the Cashmere sofa, 17 to the Light Oak sofa; offered in both packs. |
| Light Oak sofa-wall art | Seren triptych, white meadow grasses on sage, unframed (`art-seren-triptych`) | 130 × 50 (3 × 40 × 50, 5 cm gaps) | sage `#8A9F8E` / white | 239 | Span over the 200 cm sofa below «Как в журнале»: 0.40 → 0.65. Green is now in cushion, throw and art from «Всё для жизни». |
| Mediterranean TV unit | Truman, warm oak, two cane doors, open shelf (`tv-truman`) | 180 × 45 × 61 | warm oak `#BE9367` | 1,019 | TV unit to bed and coffee table at the lower levels: ΔE 16 → 3–6 (rule ≤ 10). |

All six were in stock on the product page on 27 Nov. Every one reuses an existing 3D archetype (fluted nightstand
on a plinth, three-panel unframed canvas, cane-front TV unit on block legs, linen cushions, fringed throw): no new
builder is needed.

## Wiring

- **Light Oak.** Grant is the nightstand (default, pick, and the bed's pairing); Forren stays in "all options" and is
  an `avoid` pair with the Grant bed. Seren is the third pick on the sofa wall and the piece the ladder hangs below
  the designer's room. Fallon taupe is a third throw pick.
- **Cashmere.** The taupe set and the mocha throw are the defaults and the sofa's pairings. The two oat throws are
  `avoid` pairs with both ivory sofas. The plain oat sets are no longer picks, so «Без компромиссов» keeps the
  taupe set.
- **Mediterranean.** Truman is the entry TV unit and the second pick; Windsor stays the signature. The pale-oak
  Echo is no longer offered in this pack (it stays in Light Oak).
- `picks`, `avoid`, pairings, the ladder and the tests were re-run. `api/_catalog.js` and `api/_refs.js` are rebuilt:
  164 of 188 items have a reference photo; the other 24 are the editions, which use their own image.

## Level totals after round 2, AED (changes from round 1)

| Level | Dark Walnut | Light Oak | Cashmere | Mediterranean |
|---|---|---|---|---|
| Minimum | 7,852 | 7,180 | 9,688 | 6,832 (+252) |
| Essentials | 13,330 | 11,938 | 14,890 | 12,994 (+252) |
| Comfortable | 16,354 | 14,662 | 18,334 | 15,802 (+252) |
| Move-in ready | 19,597 | 16,735 (−60) | 21,025 (+36) | 18,973 (+252) |
| Fully furnished | 26,237 | 21,124 (−60) | 28,400 (+36) | 23,847 (+252) |
| Magazine-ready | 37,520 | 22,793 | 33,849 (+36) | 32,526 |
| No compromises | 41,689 | 25,396 | 35,634 (−371) | 33,920 |

## What could not be found

- **A mocha cushion in a natural fabric.** The only mocha and brown plain cushions are an outdoor acrylic. The set
  therefore steps to taupe, and the mocha step comes from the throw.
- **A knitted, bouclé or waffle throw in taupe or mocha** (the materials the Cashmere rule names). Both throws are
  soft polyester weaves: the colour is right, the material is an exception.
- **A quiet neutral abstract for Light Oak**, landscape, 120–140 cm, under 500 AED. The one right subject is 80 cm
  wide and 120 high. Seren is a sage botanical, and its sage is cooler than the pack's swatch (hue 145–153 against
  114); it needs a look in a render beside the sage cushion and throw.
- **A warm-wood TV unit without cane** at 160–190 cm. The right one is 200 cm wide.

## Mediterranean: the woven count

The rule allows two large woven furniture types. The signature room has three and a half:

| Piece | Weave | Where it stands |
|---|---|---|
| Sukhna armchair | cane seat and back, the whole chair | living zone, beside the sofa |
| Windsor TV unit (Truman below Magazine) | cane door fronts | living zone, facing the sofa |
| Emily dining chairs ×2 | cord seats | dining zone |
| Oshawa sofa | cane arm panels (not in the rule's list, but it reads as woven) | living zone |

**Proposal: swap the armchair.** Put the Natura armchair (linen cushions on an open oak frame, already an option in
this pack, 1,559 AED) in place of Sukhna (1,799).
- It is the piece that doubles the weave: a cane chair on the same wall as a sofa with cane arms, facing a cane TV
  unit. Without it the living zone has cane on the sofa arms and the TV fronts, and the dining zone has the cord
  seats: two types from the rule's list.
- Sukhna is also the pack's one wood exception: its teak-brown frame is far from the warm oak of everything else.
- The living zone keeps a statement: the diptych over the sofa, and the cane sofa itself.
- Cost: Magazine −240 AED (32,286). Natura's frame is pale oak, a step lighter than the warm oak; it is thin and
  mostly covered by cushions.

Not applied: it changes the signature room, so it is the coordinator's and the founder's call. The TV unit is the
worse swap (no cane-free unit fits the slot) and the dining chairs the weakest (cord seats under a table are the
least visible weave).

## Also changed in this round

- **Diptych gap 8 → 10 cm** (block 148 → 150 cm), on the modeler's advice after seeing the float frames 4 cm
  apart. Spans: 0.71 over the Dark Walnut sofa, 0.75 over Light Oak's, 0.67 over Mediterranean's.
- The modeler now builds an edition as two framed canvases with the placeholder motif even before its image
  exists, and tints the brass frame to champagne, so the round-1 caveat about diptychs no longer applies.

## For the design reviewer

- Seren's sage beside the Vayu throw and the Kyedae cushion (cooler green).
- Truman at 61 cm under the wall TV: 26 cm between the top and the screen; decor on it is 33–40 cm tall.
- The mocha throw on the ivory bouclé: the strongest contrast in the Cashmere room (ΔL* 42).
