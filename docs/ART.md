# Villar: art direction (the look, the window, the collection, the art)

Founder brief, 27 Nov: a cinematic wow from the interface; no tokens wasted; images match the products; the window view beautiful, real and deep, so the person feels they are *in* the apartment; a reduced assortment is fine if the choice is right; several styles; everything fits like a top designer assembled it; add paintings and a choice of paintings that fit perfectly and raise the apartment's value. Apple philosophy.

Three rules decide every question below:
1. **Light is the material.** The room is lit by the window. Everything else supports that.
2. **Fewer, better.** Three right choices beat thirty. Nothing appears that a designer wouldn't have picked.
3. **Nothing is generated twice, and nothing is generated without a place in the product.**

## 1. Token economy ($30 balance)
- **Ladder.** T0 free (stub provider, `diag`). T1 draft: Nano Banana 2.1 at 1K. T2 final: 2K. T3 hero: Nano Banana Pro at 2K/4K, only for the window plate and the opening shot of each style.
- **A prompt version is tested on 3 canonical frames (T1) before it goes anywhere else.** A new version invalidates no cache until the coordinator approves it.
- **Every paid result is stored forever under its key** (Storage), logged with its cost, and reviewed by the art director (coordinator, in the browser) before it enters the product.
- **A photo that fails the fidelity guard is never shown**, and its prompt/model pair is counted; 2 failures out of 3 on the canonical frames blocks that pair.
- **Upscale only what is sold.** Art editions are generated at 2K for the screen; the print-resolution upscale happens per order.
- **Caps until launch:** 60 generations per day globally, 12 per IP, kill switch `PHOTO_DISABLED`.

| Planned spend | Count | Est. |
|---|---|---|
| Window plate: day (Pro 4K) + sunset + evening edits + sky mask | 4 | $1 |
| Fidelity A/B on canonical frames (NB 2.1 vs Seedream 5.5 vs Pro) | ~15 | $1.5 |
| Art editions: 24 works × 2 candidates (NB 2.1, 2K) | 48 | $2.5 |
| Opening shots: 4 styles × day (Pro 2K) | 4 | $0.6 |
| Preset photos: 4 styles × 4 views × 3 times (NB 2.1, 2K) | 48 | $2.5 |
| Window loops (8 s, first = last frame) × 3, after stills are approved | 3 | $2 |
| **Planned** | | **≈ $10** |
| Reserve for live visitors | | ≈ $20 |

## 2. The cinematic look (one look for live 3D, photos and plates)
- **Camera.** Room views read as 28–35 mm; item close-ups as 50–85 mm. Verticals are straight (architectural two-point perspective). Camera height 1.25–1.45 m. No wide-angle stretch, ever.
- **Light.** Key from the window, soft fill from the room, practical lamps warm (2700 K) and never the key by day. Exposed for the room *and* the view: the window is never a white rectangle. Contact shadows under everything.
- **Grade.** Gentle S-curve, neutral-warm highlights, slightly cool shadows, fine grain, a trace of halation around the window and lamp shades. Never the "HDR real-estate" look; never oversaturated; whites stay white.
- **Depth.** f/5.6 look for rooms (everything readable), f/2.8 for a focused item (the room falls soft behind it).
- **Photo prompt (edit), fixed skeleton.** *"Photograph of this exact interior. Keep the camera, framing and every object exactly as shown: same shapes, colours, materials and positions; add, remove or move nothing. Make it a real architectural photograph: natural window light with soft falloff, true contact shadows, real fabric weave and wrinkles, wood grain, subtle imperfections, 35 mm lens, f/5.6, fine film grain. The view through the window stays exactly as shown."* Then one line per top item from the catalogue (name, material, colour in words), and the references in the same order. The wording about style, mood or time of day comes from a fixed vocabulary per style pack; no free text.
- **Product truth.** References are ranked by pixel area. The selected artwork is always sent as a reference so the painting on the wall is the edition in the basket. Drift guard as in PHOTOREAL.md; in addition, compare each top item's bounding box (from the ID pass) between frame and photo, and reject when any of the top 5 moves or resizes by more than 4 %.

## 3. Presence: "you are in the apartment"
- **The window (the hero).** Photographic plate of a neutral, anonymous city view (founder, 27 Nov: no named district; a Dubai Hills buyer must not see the Marina): the sky is the subject, quiet low and mid-rise districts with trees far below, a few ordinary towers in the haze, no landmark, no water. Three times of day with one skyline. Later: a real view per community as a selectable "view pack". Depth in four planes: sky at infinity → far skyline → near towers → the balcony rail and window frame in the room's own 3D. Atmospheric haze grows with distance. By evening the glass carries a faint reflection of the room's lamps (4–6 %): the strongest "real glass" cue there is.
- **Living photo.** `villar.capture()` also returns the frame's depth (the engine has the true depth buffer). The developed photo is displayed with a depth-parallax shader: ±1.5° on pointer move (desktop) or device tilt (phone), eased with the house spring. The photo never sits dead on screen. Occlusion gaps are hidden by keeping the amplitude small and clamping at depth edges.
- **Opening shot.** On first load: 3.5 s slow push-in from the entry toward the window light, easing to rest; then the photo develops. Skippable by any input; never replays in the session; honours `prefers-reduced-motion`.
- **Time of day is a time-lapse**, not a cut: the sun sweeps, the plate crossfades through the edit sequence, lamps come up one by one (1.2 s total).
- **Develop moment.** A 600 ms exposure bloom from the window outward, then stillness. No spinner, no badge animation.

## 4. The Villar Collection (reduced, designed)
- Each style pack is a **composition**, not a list: 60-30-10 colour, at most 3 materials in a view, one metal finish, one or two wood tones, one accent colour repeated three times (cushion, art, object).
- Per slot the card shows **the designer's pick + at most 2 alternates**, each pre-checked against the rest of the pack (pairs that clash are not offered). Everything else sits behind a quiet "Все варианты" / "All options".
- Stylepacks carry `picks: { <slot>: [ids…] }` (first = signature) and `avoid: [[idA, idB], …]`.
- **Every budget level is a designed room.** The design reviewer signs off each of the 6 levels × 4 styles as "would a designer leave it like this?" (rug under front legs, lamp where there is a seat, art where there is a wall).

## 5. Art: Villar Editions
The existing 14 wall-art items are small for their walls (the sofa is ~2.2 m; the widest piece is 1.26 m) and read as decor, not art.
- **Sizing rule (industry standard):** art spans ⅔–¾ of the furniture below it; bottom edge 15–25 cm above the sofa back or headboard; otherwise centre at 145 cm. A pair or triptych counts as one block. The layout's art slots and the furnisher follow this for every item.
- **Editions:** original works made for each style with the image model, sold as framed canvas printed to order. 6 per style (24 total): 2 for the sofa wall (140–160 cm wide, or a diptych), 2 for the bed (120–140 cm), 2 for dining (70×100 portrait or a pair).
  - **Direction per style:** Dark Walnut: deep tonal abstracts, ink and umber, one rust accent. Light Oak: quiet Nordic landscapes and paper-white minimal line work. Greige Luxe: plaster-textured tonal fields, champagne and stone. Mediterranean: sun-washed coast and architecture studies, terracotta, olive, sea blue.
  - **Originality:** prompts describe medium, palette and composition only. No artist names, no reproductions or look-alikes of existing works, no text or signatures in the image.
  - **Fit by construction:** each prompt takes its palette from the pack's `palette-*.json` (the 10 % accent and two neutrals), so the piece belongs to the room.
  - **Frames:** float frame in the pack's wood tone or its metal finish; 4 cm deep canvas.
  - **Prices (AED, shown like any item):** 70×100 590 · 100×100 790 · 120×90 890 · 140×100 990 · 160×100 1,490 · diptych 2×70×100 1,090. UAE reference points: mass retail 150–600 for 80×120 to 100×140; designer boutiques 590–1,570.
  - **Catalogue fields:** `type: wall_art`, `edition: true`, `image: "art/<id>.jpg"` (a Storage key; one config constant holds the base URL), existing `model.params` kept as the fallback motif until the image exists.
  - **In the ladder:** editions enter at «Как в журнале» and «Без компромиссов»; the lower levels keep the simpler pieces. This is how art "raises the apartment".
- **Card row "Искусство" / "Art":** large tiles (the artwork, not a thumbnail of the room), designer's pick first, size and price under each, one tap to hang it.
- **Open business point:** editions need a print-to-order partner in Dubai (framed canvas, 3–5 days). Until one is signed, editions can be switched off with one flag (`editions: false` in styles.json).

## 6. Review gates
- **Art director (coordinator):** every paid output, in the browser, against §2–§5 before it ships.
- **Render reviewer:** blind photo-or-render test on the developed photos; window depth; evening glass.
- **Design reviewer:** each level × style composition; art sizing and hanging; the card's three-choice rule.
- **Playtest:** first 60 seconds: opening shot → focus → swap → art → budget; "did it feel like being there?" noted per step.
