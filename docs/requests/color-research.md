# Requests from color research (palettes, pack rules, style system)

Context: three new packs were added on 25.11.2026: `light-oak` («Светлый дуб»), `greige-luxe` («Кашемир»)
and `mediterranean` («Средиземноморье»). See `research/style-system.md`. Everything below is a request,
not an edit of another team's file.

## To catalog

1. **Source the three new packs** from `research/stylepack-rules-{light-oak,greige-luxe,mediterranean}.md`.
   The palettes are in `site/data/palette-*.json`. Every pack covers all 27 slot types.
2. **Tag bridges with several packs** (`tags: ["dark-walnut", "light-oak", …]`) and add them to each
   pack's `options`. A first list of current items that look like bridges is in
   `research/style-system.md` §2.7. Please confirm each one by photo (leg colour, frame, sheen).
3. **Check two current DW items against the new DW detail rules:**
   - `kitchen-walnut-black` lists an *acacia* board, so its tone must be within W1 (ΔE ≤ 12 from
     `#553C2C`);
   - `kitchen-white-basic` lists a plain "wood" board, so it must not read as light or orange wood (that
     would be a third wood tone in DW).
4. **Kitchen slot size.** `layout-studio.json` has `kitchen_decor.max = 52 × 30 × 45 cm` (between sink and
   hob), but the current `kitchen-*` items are listed at 100 × 30. Either compose 3–4 objects that fit
   52 cm, or agree with the engine on how a 100 cm set is placed.
5. Use `pairings` for each new pack's anchors (sofa, bed, dining table, TV unit, rug), following the
   scoring in `research/style-system.md` §2.6. A pairing is the curated answer to "what goes with this
   anchor".

## To engine

1. **Door finish per pack.** The palettes now set `architecture.doorFinish` per pack (`walnut-dark`,
   `oak-light`, or `paint` = wall colour). `layout-studio.json` hard-codes `finish: "walnut-dark"` on
   `entry-door`, and `architecture.js` gives `o.finish` precedence over `A.doorFinish`. Please let the
   pack value win for the entry door (e.g. drop the layout value, or prefer `A.doorFinish` when
   present).
2. Wall colour changes on style switch: walls are `#ECE7DE` / `#E4E2D7` / `#E8E2D4` / `#F3EFE6`. The
   skirting already follows `A.walls`. The ceiling, floor, fronts and window stay fixed in every pack.
3. Evening light is 2700 K in all four packs (spread ≤ 300 K), so lamp light descriptors need no
   per-pack colour.

## To interface

1. New palettes carry `nameEn`, `summaryEn` and swatch `nameEn` for the RU/EN toggle. The DW palette has
   no EN fields yet.
2. `ui/accent.js` picks the first `wood`-role swatch as the pack accent. The swatches are ordered so the
   accents come out as charcoal (light-oak), smoked oak (greige-luxe) and natural wood (mediterranean). If
   Mediterranean should show terracotta instead, that is a UI decision.
3. `consumerRules` for the new packs are not written yet. The palettes' `rules` are designer specs
   (ΔE, LRV), same as DW. Short consumer-voice versions can be drafted from the "Идея пака" paragraphs in
   the rules docs.

## To coordinator

1. When the catalog has stylepacks for the new ids, register them in `site/data/styles.json`.
2. Optional data proposal (`research/style-system.md` §2.9): precomputed `family` / `lab` / `statement` /
   `darkMass` attributes per catalog item, so the cross-style constraints and scoring can run without
   parsing names. This affects the store and catalog contracts, so it is your call.
