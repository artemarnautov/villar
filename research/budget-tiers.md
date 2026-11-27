# Villar: budget slider. Priority ladder, levels and market evidence (studio-38)

Owner: market research, 27.11.2026. **Internal**: `research/` is not deployed, so source and supplier names appear
here. Nothing in this file may be copied into a public file as-is.
Feeds `site/data/budget.json` (contract: `docs/BUDGET.md`).
Prices are public AED: catalog `price` = regular supplier price × 1.2, catalog snapshot of 26.11.2026. Web sources were read on 26–27.11.2026.

Tags: **[market]** UAE prices or packages · **[reg]** Dubai regulation · **[survey]** buyer data ·
**[opinion]** designers, stagers, press · **[Villar]** our own calculation from `site/data/*.json`.

Reference implementation (scratch, not in the repo): `/tmp/villar-budget/budget-ladder.js` reading
`/tmp/villar-budget/budget-spec.json`. The spec is reproduced verbatim in §11. Every number table in this file was generated
from that script's output by `/tmp/villar-budget/gen-final.js`. No numbers were typed by hand.

---

## 0. Summary

- **Tier 0 (never omitted, the slider's left end):** bed, mattress, bedding, sofa, curtains, TV unit. This is sleep,
  sit, privacy and heat, plus the founder's «диван, тумба». It costs **6.6–9.7k** depending on style.
- **Tier 1, essentials:** the nightstand pair, the dining table with 2 chairs, and the coffee table. **Tier 2, comfort:** the blackout
  curtain layer, the bedside lamp pair, a rug, the floor lamp and tableware. **Tier 3, finishing:** cushions, art over the sofa, the throw,
  the pendant, the mirror and the side table. **Tier 4, styling:** the plant, the other 2 art pieces, 5 accessory sets, the runner and,
  last, the armchair.
- **Five levels.** Each is a milestone on the ladder of the active style:
  - «Самое нужное / Essentials», **11.9–14.9k**;
  - «Удобно жить / Comfortable», **14.7–18.2k**;
  - «Под ключ / Move-in ready», **16.8–20.9k**;
  - «Как в журнале / Magazine-ready», the designer room, **21.3–36.2k**;
  - «Без компромиссов / No compromises», the premium end, **25.4–41.5k**.
  Each figure is where the level starts, from the cheapest of the 4 styles to the priciest (per-style tables in §5.1).
- **Rule: complete first, then better.** Furniture enters at its cheapest option, keeping the furniture pairings. Details enter as the designer
  picked them. The only early upgrade is the blackout layer. Hero upgrades start once all 33 slots are filled, and the
  ladder then lands exactly on the designer room.
- **Market fit.**
  - The minimum matches the market's budget studio, 5–10k.
  - Essentials matches entry studio packages of 10.6–14.8k, which hold only 7 furniture pieces, with no mattress, curtains or bedding.
  - Move-in ready sits at the top of the 10–22k mid band.
  - Magazine-ready matches the 23–31k holiday-home packages and the 22–40k "premium / Airbnb-ready" band.

---

## 1. Sources

### 1.1 UAE furnishing packages (price points per tier)

- **GuestReady, furnishing packages, Dubai** [market]: https://www.guestready.com/services/furnishing-packages-dubai/
  (also https://www.guestready.com/?p=26683).
  - Studio "from" prices: **Basic AED 23,000 · Standard 27,000 · Recommended 31,000**. 1BR from 33,000, 2BR from 43,000.
  - Basic covers "mandatory DTCM items" and initial cleaning. Standard adds accent-wall paint. Recommended adds wall panelling or moulding
    and "premium décor".
  - Add-ons: large appliances 8,900, smart lock 1,296. No per-tier item list is published.
  - Read: this is the holiday-home turnkey benchmark for our Magazine-ready level. Move-in ready sits just below it.
- **FullFlat, Dubai furniture packages** [market]: https://fullflat.com/products/cloud-bay-studio-package ·
  https://fullflat.com/products/forest-zen-studio-package · https://fullflat.com/products/cloud-bay-1-bedroom-package ·
  https://fullflat.com/products/minimalism-package (price list for all lines).
  - Studio "from" prices, with a 15 % promo running:
    - mini studio: Soho Mood **7,327**;
    - entry lines: Soho Mood 10,600 · Nomad Nest 11,730 · Marina Calm 13,320 · Cloud Bay 13,439 · Dune Breath 14,833;
    - mid line: Pure Form 20,859;
    - upper lines: Gentle Waves 28,127 · Forest Zen 30,243 · Rocky Balance 30,906 · Atlas Spirit 31,357 · Kyoto Ridge 31,782;
    - top lines: Riviera Luxe 37,213 · Golden Rose 45,220 · Arabian Grace 45,815.
  - **Itemised, Cloud Bay studio:** 3-seat sofa 3,490 · coffee table 1,300 · TV stand 1,700 · marble-top dining table
    3,990 · 2 dining chairs 1,010 · double bed 3,640 · **one** bedside table 950.
    - Excluded, sold as add-ons: **mattress** (850 / 2,000), bedding (720 / 890), rugs (750 / 1,620), floor lamp 1,390, mirror 990, poster 360, cushion 60.
    - Curtains are not offered at all.
  - Forest Zen studio (30,243) has the same 7-piece structure.
  - Read: in the UAE market a "furniture package" means the structural pieces only. Mattress, lighting, textiles,
    rugs and décor are extras. This is the clearest real-world picture of our tier 0 + tier 1.
- **FullFlat blog, package vs piece-by-piece** [market]:
  https://fullflat.com/blogs/news/full-flat-furniture-packages-vs-piece-by-piece-shopping
  - Studio package 10,000–18,000 vs piece-by-piece 15,000–25,000. 1BR: 18,000–30,000 vs 25,000–40,000.
  - Hidden costs: per-retailer delivery, assembly at about AED 100–300 per item, pieces that don't match, impulse add-ons.
- **Real Estate Club Dubai, "Furniture packages 2026"** [market], an aggregator blog:
  https://realestateclubdubai.com/blog/property-management/furniture-packages-new-dubai-apartments-2026-cost-airbnb-vs-long-let
  - Turnkey studio, including delivery and assembly, excluding appliances: **budget 5,100–10,000 · mid 10,000–22,000 · premium / Airbnb-ready 22,000–40,000**.
    1BR: 7,500–12,500 · 12,500–30,000 · 30,000–54,000+.
  - What each tier holds:
    - every tier: sofa, coffee table, TV unit, curtains or blinds, rug, lighting, bed, mattress, bedside tables, dining set;
    - budget: lacks kitchenware, linens and décor;
    - premium: adds styling, art placement, kitchenware, linens and towels.
  - Components: linen sets 800–1,500, kitchenware 500–1,200.
  - Provider examples: TUKA 1-bed from 10,900, FullFlat studio from 5,100, Kiana luxury 1-bed 54,235.
  - Caveat: the FAQ quotes a budget studio at 5,000–8,000, which is inconsistent with the table.
- **Real Estate Club Dubai, furnished vs unfurnished** [market]:
  https://realestateclubdubai.com/blog/renting/furnished-vs-unfurnished-rental-dubai-2026-price-gap-pros-cons
  - Furnishing a studio yourself: **4,000–6,000 budget · 10,000–15,000 mid · 20,000–30,000 premium**.
  - Itemised 1BR table, budget / mid / premium:
    - sofa 800 / 2,500 / 6,000;
    - queen bed + mattress 1,200 / 3,500 / 8,000;
    - dining + 4 chairs 500 / 1,500 / 4,000;
    - curtains 400 / 1,000 / 3,000;
    - linens, towels and décor 400 / 1,000 / 2,500;
    - plus wardrobe, TV, washer and kitchen basics;
    - totals 6,200 / 16,500 / 38,500.
  - Furnished rents carry a **15–30 % premium, about 20 % on average**. Examples: Dubai Marina studio 55k → 70k a year, JVC studio 32k → 38k.
    [Villar] Payback for a landlord buying our Move-in ready level (16.8–20.9k) works out to about 1.1–1.4 years in Marina and 2.8–3.5 years in JVC.
- **Real Estate Club Dubai, staging page** [market]: https://realestateclubdubai.com/dubai-furniture-home-staging
  - 1BR: budget basic 7,500–15,000 · mid turnkey 15,000–35,000 · STR / Airbnb-ready 20,000–60,000.
  - STR-ready adds: hotel-grade bedding, a full kitchen kit, **blackout curtains**, and "**one standout piece** such as
    statement art or a designer chair".
- **Khaleej Times on TUKA (13.03.2023)** [market]: https://www.khaleejtimes.com/uae/how-tuka-dubai-reshapes-the-furniture-industry
  - A 1BR "for Dh10,900 or less with an installment plan". The figure is dated.
- **The National, "Furnishing an apartment for Dh15,000" (2010, updated 2021)** [market]:
  https://www.thenationalnews.com/arts/home-economics-furnishing-an-apartment-for-dh15000-1.541037
  - IKEA route Dh14,940; mixed route Dh15,172.
  - Advice: "major expenses take priority", starting with seating; **bed frames often exclude the mattress**; rugs, mirrors and lamps come last.
  - Read: the prices are old, but the buying order still holds.

### 1.2 What "furnished" means in Dubai

- **DET, Leasing Out Holiday Homes user guide, Appendix 1, Standard vs Deluxe** [reg]:
  https://www.dubaidet.gov.ae/en/legislative-news/-/media/DET%20SME%20CR%20Release%201%20new%20media%20files/pdfs/guest-accommodation/leasing-out-holiday-homes-user-guide-en.pdf
  - **Both classes** require:
    - "Sofa or armchair for two people, per bedroom or studio";
    - "Dining table with at least two chairs, per bedroom or studio";
    - "Rug or carpet";
    - a colour TV with remote;
    - "Wardrobe or cupboard with shelves and a mirror";
    - "Bedside table with drawer or shelf, as well as a shaded bedside lamp";
    - "**Curtains or blackout to completely darken the unit**";
    - two sets of sheets per bed and two sets of towels;
    - "Cooking utensils and 2 tableware for each bedroom".
  - **Deluxe** adds a coffee table, an oven, a separate freezer and a dishwasher for 2BR and up.
  - Minimum studio area: 17 m² Standard, 20 m² Deluxe.
  - Read: the Standard list is the official Dubai definition of "furnished". It equals our **tier 0–2, i.e. Comfortable**.
    The Deluxe extra (a coffee table) is already in tier 1.
- **dubizzle, "What is included in a furnished rental in Dubai"** [market]:
  https://www.dubizzle.com/blog/property/furnished-rental-amenities-dubai/
  - Furnished usually means:
    - bed + mattress, a wardrobe, curtains or blinds, AC and light fittings;
    - a sofa and TV;
    - a dining table with chairs;
    - kitchen appliances.
  - **Usually excluded:** bedding, towels, small electronics.
  - **"Semi-furnished" has no standard definition.** Inclusions are agreed in the inventory list attached to the tenancy
    contract. No Dubai source we found defines it, so we do not use the term.

### 1.3 Buying order (surveys and checklists)

- **TwentyCi, Property & Homemover Report Q2 2025 (UK)** [survey]:
  https://furniturenews.net/resources/study-reveals-when-homemovers-make-key-retail-purchases
  - **Bed and sofa orders peak on day 1–2 after getting the keys.** **Soft furnishings peak in month 2.**
  - The middle 50 % of furniture orders fall between 3 days before and 190 days after the move.
- **Porch / PGM survey, July 2021, 1,006 US movers** [survey]: https://porchgroupmedia.com/blog/movers-report-making-big-ticket-purchases/
  - 47 % bought or planned to buy furniture and décor within 12 months of the move.
- **Lalamove UAE, "How to furnish your apartment in Dubai on a budget"** [market]:
  https://www.lalamove.com/en-ae/blog/how-to-furnish-your-apartment-in-dubai-on-a-budget
  - Essentials first: bed and mattress, sofa, dining table and chairs, wardrobe or storage, kitchen basics, curtains or blinds, lighting.
  - "Rugs, artwork, and plants can follow."
  - Suggested split: **bedroom 30 % · living 30 % · dining 15 % · storage 15 % · décor 10 %**.
- **Klekktic (UAE retailer), "What furniture you will actually need"** [market]:
  https://klekktic.com/en-ae/blogs/stories/what-furniture-you-will-actually-need
  - Before move-in:
    1. bed frame AED 1,000–2,500 + mattress 800–2,200;
    2. 3-seat sofa 1,200–2,500;
    3. dining table + 2 chairs 800–1,800;
    4. window coverings for privacy;
    5. appliances;
    6. cookware and lighting, with bedside lamps at 100–200.
  - After move-in: rugs (200–400), wall décor, more seating, storage accessories.
- **Bayut / MyBayut, first-timers' list** [market]: https://www.bayut.com/mybayut/first-timers-list-buy-things-new-home/
  - "Set up the bedroom first": bed or mattress, 2 sets of bedding, lamps.
  - Sofa ("everything else can slowly follow").
  - Coffee table ("an inexpensive piece is fine").
  - Somewhere to eat: stools or the coffee table.
  - Kitchen: dishware for 4.
  - Décor later: throw pillows, plants, art, extra lighting.
- **Apartment Therapy, "Things to buy now, things to buy later"** [opinion]:
  https://www.apartmenttherapy.com/the-first-apartment-checklist-things-to-buy-now-things-to-buy-later-219419
  - **Now:** mattress ("if you aren't sleeping well…"), sofa, bed frame, window treatments ("necessary for privacy"),
    a couple of good lamps, plates and glasses.
  - **Later:** side tables, headboard, dining table, storage, rugs, art, serving dishes.
- **Redfin, first apartment checklist** [opinion]: https://www.redfin.com/blog/first-apartment-checklist/
  - Order: bed and bath basics for night one, then mattress, kitchen, the living room (couch, TV stand, lamp, window treatments),
    the dining set only if needed, and "décor, accent furniture, and plants" gradually.
- **Opendoor, "Setting a furniture budget"** [opinion]: https://www.opendoor.com/articles/setting-a-furniture-budget-for-your-new-home
  - Essentials first: beds, dining, seating. Splurge on daily-use items: mattress, sofa, dining table.
  - The living room plus the main bedroom take **40–60 %** of furnishing costs.
  - Studio or 1BR, mid-range: USD 3,000–12,000.

### 1.4 Spend split

- **Havenly, living-room cost guide** [opinion]: https://havenly.com/learn/how-much-does-a-living-room-cost
  - The sofa takes **about 30–40 % of the living-room furniture budget**.
  - Per-item USD bands, low / mid / high: sofa 400–900 / 900–2,500 / 2,500–6,000+; 8×10 rug 150–400 / 400–1,200 / 1,200–4,000;
    floor lamp 80–200 / 200–600; table lamp pair 60–200 / 200–600; off-the-shelf curtains 100–400 / 400–1,000;
    custom curtains 600–2,000 per window.
- Lalamove's 30/30/15/15/10 split, the Real Estate Club 1BR table and Opendoor's 40–60 % are above. Our own split is in §7.

### 1.5 Designers and stagers

- **Homes & Gardens, "6 reasons your home doesn't feel finished"** [opinion]:
  https://homesandgardens.com/interior-design/why-your-home-does-not-feel-right
  1. One light source ("relying solely on overhead lighting can leave rooms feeling flat and clinical").
  2. No personality.
  3. Missing drapery, so the room "feels like it's missing its final layer".
  4. No art.
  5. **No rug, or one too small.**
  6. All-white walls.
- **Homes & Gardens, "pieces designers always recommend"** [opinion]:
  https://www.homesandgardens.com/interior-design/pieces-designers-always-recommend-to-pull-a-room-together
  - Pillows and throws; a rug ("larger than you think"); one antique; accent lighting (ambient + task + accent);
    art and **mirrors ("light and the illusion of more space")**; one characterful accent chair; scent.
- **NAR, "Must-have staging items"** [opinion]: https://www.nar.realtor/news/styled-staged-sold/ready-set-stage-it-must-have-staging-items
  - Stagers' core stock is **lamps and pillows** ("alone go a long way"), plus linens, art, plants and accessories.
- **Livingetc, where to spend and save** [opinion]: https://www.livingetc.com/advice/where-to-spend-and-save-in-a-living-room
  - Spend on: the rug, sofa, chairs, window treatments, the coffee table (next after the sofa) and art.
  - Save on: pillows, small décor and side tables.
- **Havenly, splurge vs save** [opinion]: https://havenly.com/blog/how-to-decorate-a-living-room-on-a-budget
  - Splurge on the sofa and lighting. Save on the rug, pillows and throws, and décor.
  - Art and curtains are either; "hang your curtains high and wide".
- **Homes & Gardens, Emily Henderson** [opinion]: https://www.homesandgardens.com/news/two-items-you-should-never-overspend-on-designing-a-room
  - Don't overspend on the sofa or the rug. Spend on "conversation pieces": statement art, a one-off rug.
- **Redfin, layered lighting** [opinion]: https://www.redfin.com/blog/how-to-use-layered-lighting/
  - Ambient, task and accent light. Designers prefer lamps "between waist and eye level" to a single overhead light.
- **Airbnb, preparing your home** [opinion]: https://www.airbnb.com/resources/hosting-homes/a/prepare-your-home-for-guests-769
  - Linens for each bed, a comfortable mattress, a bedside table, lighting "accessible from bed", soft living-room
    light, throws, and "art, books, or throw pillows".
- **The National, curtains** [opinion]: https://thenationalnews.com/lifestyle/home/how-to-get-the-best-curtains-for-your-space-1.369149
  - "In bedrooms, it's advisable to opt for a full-length curtain with **blackout lining**." Curtains "protect your modesty".
- **Bayut, choosing curtains** [opinion]: https://www.bayut.com/mybayut/tips-choose-drapes-curtains-for-your-home
  - Sheers keep the daylight; solid fabric gives privacy; blackout insulates against light and noise.

### 1.6 Market price map: studio, AED

| Source | Budget / entry | Mid | Upper | Top |
|---|---|---|---|---|
| Real Estate Club, turnkey packages | 5,100–10,000 | 10,000–22,000 | 22,000–40,000 (premium / Airbnb-ready) | — |
| Real Estate Club, furnish it yourself | 4,000–6,000 | 10,000–15,000 | 20,000–30,000 | — |
| FullFlat studio lines (7 furniture pieces only) | 7,327 mini · 10,600–14,833 | 20,859 | 28,127–31,782 | 37,213–45,815 |
| FullFlat blog | package 10–18k | piece-by-piece 15–25k | — | — |
| GuestReady holiday-home packages | — | — | Basic 23,000 · Standard 27,000 · Recommended 31,000 | — |
| **Villar studio-38 (this file)** | minimum 6.6–9.7k · Essentials 11.9–14.9k | Comfortable 14.7–18.2k · Move-in ready 16.8–20.9k | Magazine-ready 21.3–36.2k | No compromises 25.4–41.5k |

[Villar] At the same money, FullFlat's 28–32k studio lines deliver 7 furniture pieces. Villar's 29–36k designer rooms fill
33 slots, including mattress, rug, 4 lights, curtains, textiles, 3 artworks and styling.

---

## 2. Priority ladder

Keys are stylepack selection keys. `nightstand`, `table_lamp` and `dining_chair` each cover two layout slots. `pendant_lamp`
is the layout slot `pendant`. The order column is the add order.

| # | Key (layout slots) | Tier | Why here (one line) | Evidence |
|---|---|---|---|---|
| 1 | bed | 0 | Sleep. The first thing people order after getting the keys. | TwentyCi; DET; Klekktic #1 |
| 2 | mattress | 0 | A frame without a mattress isn't a bed, and market packages often leave it out. | Apartment Therapy; FullFlat add-on; The National |
| 3 | bedding | 0 | Sleep isn't complete without it. A bare mattress renders as an unsold showroom. | DET (2 sets of sheets); Bayut; Airbnb |
| 4 | sofa | 0 | Sit. The other day-one purchase; DET's "sofa for two per studio". | TwentyCi; DET; Bayut |
| 5 | curtains | 0 | Privacy, heat and darkness on a 3.7 m floor-to-ceiling glass wall right beside the bed. | DET ("completely darken"); Apartment Therapy; The National |
| 6 | tv_unit | 0 | The founder's minimum («диван, тумба»). It is the only living-zone storage and anchors the fixed wall TV. | founder; every FullFlat package; Real Estate Club core list |
| 7 | nightstand ×2 | 1 | Phone, water and glasses at night. DET Standard requires one; we always add the pair. | DET; FullFlat studio |
| 8 | dining_table + dining_chair ×2 | 1 | Eat. DET (both classes) requires a table with 2 chairs; UAE lists put it in the essentials. | DET; Lalamove; Klekktic #3; FullFlat |
| 9 | coffee_table | 1 | A surface at the sofa. It sits in every UAE package, but DET asks for it only at Deluxe, so it is last of the essentials. | DET Deluxe; FullFlat; Bayut |
| 10 | *curtains → blackout layer* | 2 | A functional upgrade: the cheapest sets are sheer only, which gives no darkness and no heat cut. | DET; The National; STR-ready lists |
| 11 | table_lamp ×2 | 2 | Light reachable from bed. Ambient light is already built in (9 downlights), so lamps are the first comfort layer. | DET (shaded bedside lamp); Airbnb; Redfin |
| 12 | rug | 2 | Softness and acoustics on a hard floor, and it anchors the living zone. Room-sized when it costs at most 25 % more. | DET (rug or carpet); H&G; Livingetc |
| 13 | floor_lamp | 2 | Evening light in the living zone; designers say one light source feels "flat and clinical". | H&G; Havenly; Apartment Therapy |
| 14 | tableware | 2 | Makes the table usable (a set for 4–6). Budget packages omit it; Airbnb-ready ones include it. | DET; Bayut; Real Estate Club |
| 15 | cushions | 3 | Back support and the first accent colour. Stagers' #1 stock item, the most effect per AED. | NAR; H&G; Airbnb |
| 16 | art_sofa | 3 | The one statement piece, on the biggest wall and the first one seen from the entry. | H&G ("lack of artwork"); Emily Henderson; Real Estate Club (standout piece) |
| 17 | throw | 3 | Softens the sofa and adds the second accent, for little money (143–275 as curated). | H&G; Airbnb |
| 18 | pendant_lamp | 3 | Defines the dining zone and adds the decorative light layer. Needs the table under it. | Redfin (layers); Real Estate Club (lighting) |
| 19 | mirror | 3 | Bounces window light to the dining and entry side; makes 38 m² feel larger. | H&G (Nicky Mudie) |
| 20 | side_table | 3 | A drink or book surface at the sofa end. Useful but not essential; designers say save here. | Apartment Therapy (later); Livingetc |
| 21 | plant | 4 | The largest accessory (a 1.5–1.85 m olive tree) and the only living element near the window. | Redfin; Lalamove; Bayut (later) |
| 22 | art_bed | 4 | Second artwork; dresses the bed wall seen from the sofa. | H&G |
| 23 | decor_coffee | 4 | Tray and candles; styles the centre of the living zone. | NAR (bowls, candles) |
| 24 | centerpiece | 4 | Vase or candles on the table; follows the tableware. | NAR |
| 25 | decor_tv | 4 | Ceramics on the TV unit; balances the TV wall. | NAR |
| 26 | nightstand_decor | 4 | A small bedside vignette (115–227 as curated). | NAR |
| 27 | kitchen_decor | 4 | Kettle, board and utensil holder; the kitchen reads as lived-in. | Real Estate Club ("kitchenware staging") |
| 28 | art_dining | 4 | Third artwork, on the smallest wall. | H&G |
| 29 | runner | 4 | Entry and kitchen runner; the least visible from the main views. | — (styling) |
| 30 | armchair | 4 | A second seat and a character piece, but optional: the sofa seats three, and DET accepts sofa *or* armchair. It is the priciest optional item (1.6–4.4k). As the last add, its big step comes once the room is complete and doesn't stall mid budgets. | DET; H&G ("one characterful chair"); Real Estate Club (standout piece) |

Why the armchair is last: when it closed tier 3, greige-luxe stalled at 20,869 for every budget from 21k to 25k,
behind a +4,439 step. Dark-walnut stalled the same way behind +2,999. Skip-ahead isn't allowed (§6), so a big optional piece
has to come last.

---

## 3. Dependencies

**Hard rules.** The planner enforces them, and `requires` in §11 holds them. A child can't exist without its parent, and
removing the parent removes the child. A pin on a child pulls its parent into the minimum.

| Child | Requires | Why |
|---|---|---|
| mattress | bed | attached to the bed |
| bedding | mattress | attached to the mattress |
| table_lamp (l / r) | nightstand (l / r) | stands on it |
| nightstand_decor | nightstand | stands on `nightstand_l` |
| cushions, throw | sofa | attached to the sofa |
| side_table | sofa | serves the sofa end |
| decor_coffee | coffee_table | stands on it |
| decor_tv | tv_unit | stands on it |
| dining_chair ↔ dining_table | each other | a set: no table without chairs, no chairs without a table |
| tableware, centerpiece | dining_table | stand on it |
| pendant_lamp | dining_table | The shade bottom hangs about 1.53 m above the floor (80 cm over the table). Without a table it is a head-height obstacle on the kitchen–living walkway. |

**Soft rules** (`after` in §11). These are ordering preferences. The ladder order already satisfies them; they matter only when the
customer adds things by hand:

- Art goes in one piece at a time: `art_sofa` → `art_bed` → `art_dining`.
- `centerpiece` after `tableware`: function before décor.
- `side_table` after `coffee_table`. The packs pair their materials (walnut ↔ travertine).
- `armchair` after `floor_lamp`: the lamp may light the window corner alone; the chair comes into a lit corner.
- A throw only with the sofa or bed. In this layout it attaches to the sofa only.

---

## 4. Pairing rules

1. **Pairs: both or neither, the same item, priced ×2.** `nightstand` (l + r), `table_lamp` (l + r), `dining_chair` (1 + 2).
   One selection key each, so they move together by construction.
2. **Group:** `dining_table` + `dining_chair` enter together as one step (`groups`).
3. **Stylepack `pairings`** were built for style switching (`store.previewStyle`). In the slider:
   - **Furniture only.** Both sides must be in `furniture`. The curated rooms break some textile and accessory pairings:
     - light-oak breaks 3: the rockwell sofa wants the vayu throw; the grant bed wants sage-oat bedding; the thorn throw wants linen-oat cushions;
     - greige-luxe breaks 1: the sable floor lamp wants the dania table lamp.
     Enforcing those would stop the ladder passing through the designer room.
   - **Forward on add.** The entering item follows the furniture already in the room, never the reverse.
     Examples: light-oak's keira table brings the emily chairs; dark-walnut's daventry sofa brings the luna leather armchair;
     greige-luxe's daventry sofa brings the mons armchair.
   - **Companions move with a hero upgrade, in the same step.** Example: greige-luxe sofa → pebble brings the oti armchair and the heaton rug
     (+3,060 in one step).
   - **Premium is pairing-safe.** A premium option that would break a furniture pairing is skipped. Examples: dark-walnut keeps
     `side-moxie` with the `coffee-selric` table; light-oak keeps `rug-elsin` with the rockwell sofa.
   - Result: **0 furniture-pairing breaks at every step in all 4 styles.** The script checks this.

---

## 5. Budget levels

The levels are milestones on the active style's ladder, not fixed AED. The label shown is the highest milestone reached.
The minimum is the slider's left end, not a level.

| id | RU | EN | Milestone | Customer line (RU / EN) |
|---|---|---|---|---|
| essentials | Самое нужное | Essentials | end of tier 1 | Спать, сидеть, есть, хранить, шторы. / Sleep, sit, eat, store, curtains. |
| comfortable | Удобно жить | Comfortable | end of tier 2 | Блэкаут, свет у кровати и у дивана, ковёр, посуда. / Blackout, bedside and sofa light, a rug, tableware. |
| move-in | Под ключ | Move-in ready | end of tier 3 | Всё для жизни и уюта… Заезжайте с чемоданом. / Everything to live in and feel at home… Move in with a suitcase. |
| magazine | Как в журнале | Magazine-ready | designer room | Ровно комната дизайнера. / Exactly the designer's room. |
| no-compromise | Без компромиссов | No compromises | premium end | Лучшие варианты в каждом месте. / The best option in every place. |

### 5.1 Milestones per style, AED

| Milestone | slots | dark-walnut | light-oak | greige-luxe | mediterranean |
|---|---:|---:|---:|---:|---:|
| Minimum: tier 0 (slider left end, not a level) | 6 | 7 852 | 7 180 | 9 688 | 6 580 |
| **Самое нужное / Essentials**: end of tier 1 | 12 | 13 330 | 11 938 | 14 890 | 12 742 |
| **Удобно жить / Comfortable**: end of tier 2 | 17 | 16 354 | 14 662 | 18 214 | 15 502 |
| **Под ключ / Move-in ready**: end of tier 3 | 23 | 19 717 | 16 843 | 20 869 | 18 541 |
| end of tier 4 (all 33 slots, no level) | 33 | 26 573 | 21 232 | 28 388 | 23 415 |
| **Как в журнале / Magazine-ready**: designer room | 33 | 36 243 | 21 280 | 32 216 | 29 965 |
| **Без компромиссов / No compromises**: premium end | 33 | 41 451 | 25 391 | 34 148 | 33 991 |
| *ref: curated room as shipped today* | 33 | 36 243 | 20 683 | 31 619 | 29 368 |
| *ref: every slot at its cheapest option* | 33 | 21 875 | 18 438 | 25 174 | 20 433 |
| *ref: every slot at its priciest option (ignores pairings)* | 33 | 41 547 | 26 471 | 34 352 | 35 191 |

Ranges (from one milestone to the next):

| Level | dark-walnut | light-oak | greige-luxe | mediterranean | across styles |
|---|---|---|---|---|---|
| Самое нужное / Essentials | 13 330–16 353 | 11 938–14 661 | 14 890–18 213 | 12 742–15 501 | from 11.9k–14.9k |
| Удобно жить / Comfortable | 16 354–19 716 | 14 662–16 842 | 18 214–20 868 | 15 502–18 540 | from 14.7k–18.2k |
| Под ключ / Move-in ready | 19 717–36 242 | 16 843–21 279 | 20 869–32 215 | 18 541–29 964 | from 16.8k–20.9k |
| Как в журнале / Magazine-ready | 36 243–41 450 | 21 280–25 390 | 32 216–34 147 | 29 965–33 990 | from 21.3k–36.2k |
| Без компромиссов / No compromises | 41 451–41 451 | 25 391–25 391 | 34 148–34 148 | 33 991–33 991 | from 25.4k–41.5k |

### 5.2 What each level holds

- **Minimum, tier 0:** 6 slots: bed, mattress, bedding, sofa, curtains (sheer), TV unit. Every slot at its cheapest option.
  - Price: 6.6–9.7k.
  - Market: the budget studio band (Real Estate Club 5.1–10k; furnish-yourself 4–6k). Night one, per TwentyCi and Redfin.
- **Essentials:** 12 slots: + nightstand pair, dining table with 2 chairs, coffee table.
  - Furniture at its cheapest option, with furniture pairings kept.
  - Market: the UAE entry "furniture package" (FullFlat 10.6–14.8k: sofa, coffee table, TV stand, dining set, bed, 1 bedside table).
    Ours also has the mattress, bedding, curtains and a second nightstand. Lalamove and Klekktic list the same essentials.
- **Comfortable:** 17 slots: + blackout layer, bedside lamp pair, rug, floor lamp, tableware.
  - Lamps and tableware are the designer's picks. The rug is room-sized when it costs at most 25 % more.
  - Market: **this is the DET Standard "furnished" list** (sofa, dining + 2 chairs, rug, TV, bedside table + lamp, blackout,
    sheets, tableware; the wardrobe is built in), plus the Deluxe coffee table. Real Estate Club's mid band is 10–22k.
- **Move-in ready:** 23 slots: + cushions, art over the sofa, throw, pendant, mirror, side table.
  - Details are the designer's picks; furniture is still at the base option.
  - Market: the soft layer designers say makes a room "finished" (H&G: drapery, rug, lamps, art; NAR: lamps and pillows).
    Sits near the top of Real Estate Club's mid band (10–22k), just below "premium / Airbnb-ready" (22k+) and GuestReady Basic
    (23k, which includes cleaning and DTCM items).
- **Magazine-ready:** 33 slots: + plant, 2 more artworks, 5 accessory sets, runner, armchair (all 33 slots). Then
  hero upgrades to the designer's picks.
  - The top of this level is the designer room, the photo on the site.
  - Market: GuestReady Standard 27k and Recommended 31k; FullFlat's designer lines 28–32k; Real Estate Club premium 22–40k.
- **No compromises:** the premium end. Every key at its priciest pairing-safe option, heroes first.
  - Price: +1.9–5.2k over the designer room.
  - Market: FullFlat Riviera Luxe 37k, Golden Rose 45k, Arabian Grace 46k.
  - Caveat: visually this band is close to the designer room. It is mostly bed, mattress, chair and cushion swaps.

### 5.3 Difference from `docs/BUDGET.md`, for the coordinator

1. **Tier 0 holds 6 keys.** Bedding is in because the quality gate says no half-placed rooms. The TV unit is in because of the founder's «тумба».
2. **Entry option.** The contract says "each at the curated item". Here, furniture enters at its cheapest option (pairings
   kept) and details at the curated item. Under the literal contract, dark-walnut's Essentials costs **21,130 instead of
   13,330**: the curated walnut nightstand pair is 4,654 and the marble table 4,391. Greige-luxe breaks 20 furniture pairings
   along the ladder (its cheapest daventry sofa sits next to the curated heaton rug and oti armchair). Comparison, literal
   contract (difference vs this model):

| Milestone | dark-walnut | light-oak | greige-luxe | mediterranean |
|---|---:|---:|---:|---:|
| end of tier 1 | 21 130 (+7 800) | 11 938 (+0) | 14 890 (+0) | 12 742 (+0) |
| end of tier 2 | 24 517 (+8 163) | 14 065 (-597) | 18 277 (+63) | 14 785 (-717) |
| end of tier 3 | 27 880 (+8 163) | 16 246 (-597) | 20 932 (+63) | 17 824 (-717) |
| end of tier 4 | 34 736 (+8 163) | 20 635 (-597) | 29 891 (+1 503) | 22 938 (-477) |
| designer room | 36 243 (+0) | 20 683 (-597) | 31 619 (-597) | 29 368 (-597) |
| furniture-pairing breaks along the ladder | 0 | 0 | 20 | 0 |

3. **Levels.** The contract has 4 levels: Move-in ready = designer room, Magazine-ready = premium end. This file
   recommends 5: Move-in ready = end of tier 3, Magazine-ready = designer room, plus No compromises = premium end.
   - Why: in the Dubai market "turnkey" means complete and livable (holiday-home Basic and Standard), not designer materials. The
     premium band is only +1.9–5.2k and looks almost the same as the designer room, so calling it "magazine" over-promises.
   - To keep the 4-level contract, use the same milestones and rename: designer room = «Под ключ», premium = «Как в журнале»,
     and drop the end-of-tier-3 tick.
4. **Blackout.** In light-oak, greige-luxe and mediterranean the ladder passes through "designer room + blackout curtains" (+597), not the
   room shipped today, because their curated curtains are sheer only. Recommendation: switch those three defaults to the sheer +
   blackout set (§10.1). Until then, either accept the +597 or drop the functional step for those packs. Don't downgrade the
   curtains at the top: that breaks "right only adds".
5. **Ticks.** Merge two milestones that are within 3 % of the slider range and keep the higher name. No current style
   needs it after the tier-3 change, but light-oak's end-of-tier-4 (21,232) and designer room (21,280) are only 48 apart.

---

## 6. Upgrade vs add

**Rule (customer words): «Сначала — всё, потом — лучше» / "Complete first, then better."**

1. **Add in ladder order** (§2). Never upgrade a piece while a slot of the current or a lower tier is empty.
2. **Entry option** when a slot is added:
   - furniture (bed, mattress, sofa, curtains, TV unit, nightstands, dining set, coffee and side tables, rug, armchair):
     the cheapest option, unless furniture already in the room has a pairing for it;
   - rug: the room-sized one (≥ 290 cm) when it costs at most 1.25 × the cheapest;
   - **details** (lights, textiles, art, mirror, plant, accessories, tableware): **the designer's pick**. They carry
     the style's 10 % accent layer and cost little to get right. Curated minus cheapest is ≤ 393 per key in every pack.
3. **The only early upgrade is functional:** the curtain blackout layer, as the first step after Essentials. Test: an
   upgrade jumps the queue only if the cheap option fails a function (here: darkness and heat), not a look.
4. **Once all 33 slots are filled,** upgrade heroes to the designer's pick, hero-first: sofa → bed → mattress → rug → armchair
   → dining table → chairs → coffee table → side table → TV unit → nightstands → bedding → curtains. Pairing companions move in the
   same step. This lands exactly on the designer room.
5. **Above the designer room:** premium options, heroes first, then lights → art → textiles → plant and mirror → tableware →
   accessories. Skip any option that would break a furniture pairing.
6. **No skip-ahead.** If the next step doesn't fit, the room stays as it is and the UI shows "next: + Floor lamp · 479 AED".
   Skipping to later, cheaper steps would break monotonicity: a slightly larger budget would take the big item and drop the small ones.

**Why add beats upgrade here** [Villar]:

- Every option in a slot already passes the pack's style rules, so the cheapest one is still on-style. An empty slot is
  visible in the 3D render; a material upgrade mostly isn't.
- Look at the same money. The 12 Essentials slots at their priciest options cost about as much as the whole 33-slot
  room built by this rule:

| | dark-walnut | light-oak | greige-luxe | mediterranean |
|---|---:|---:|---:|---:|
| Essentials (10 keys / 12 slots) at the cheapest options, no pairings | 13 330 | 10 450 | 14 890 | 12 334 |
| Essentials as the ladder builds it (furniture pairings kept) | 13 330 | 11 938 | 14 890 | 12 742 |
| the same 12 slots at their priciest options | 25 937 | 14 201 | 17 671 | 21 857 |
| complete 33-slot room (end of tier 4) | 26 573 | 21 232 | 28 388 | 23 415 |

- Market and buyers agree on the order: bed and sofa on day 1–2, soft furnishings in month 2 (TwentyCi). Essentials first,
  décor later (Lalamove, Redfin, Bayut). Rooms feel unfinished because of missing layers, not cheap materials
  (H&G: lighting, drapery, art, rug).
- Hero order follows what the body touches daily and the eye sees first. Splurge on daily-use pieces: mattress, sofa,
  dining table (Opendoor; Havenly). Save on pillows, side tables and small décor (Livingetc; Havenly). So small items are never upgraded
  before a hero.

---

## 7. Spend split

**Market.**

- Lalamove UAE: bedroom 30 % · living 30 % · dining 15 % · storage 15 % · décor 10 %.
- Opendoor: living + main bedroom 40–60 %.
- Havenly: the sofa is 30–40 % of living-room furniture.
- Real Estate Club 1BR table, comparable categories only (sofa, bed + mattress, dining, curtains, linens + décor),
  budget / mid / premium:
  - sofa 24 / 26 / 26 %;
  - bed + mattress 36 / 37 / 34 %;
  - dining 15 / 16 / 17 %;
  - curtains 12 / 11 / 13 %;
  - linens + décor 12 / 11 / 11 %.

**Ours** [Villar]: category share of the total, averaged over the 4 styles. The range across styles is in brackets.

| Category | Essentials, cheapest | 33 slots, cheapest | designer room | 33 slots, priciest |
|---|---:|---:|---:|---:|
| Sofa | 18.9 % (17.5–20.7) | 11.2 % (10.5–12.1) | 11.6 % (8.3–16.3) | 10.2 % (8.2–13.6) |
| Bed + mattress | 26.5 % (23.6–32.5) | 15.7 % (14–18.4) | 12.3 % (9.7–16.4) | 14.0 % (11.3–17.7) |
| Armchair | — | 8.7 % (7.6–10.5) | 10.1 % (6.1–18.6) | 8.8 % (5.1–17.1) |
| Dining set | 18.1 % (13.3–24.3) | 10.8 % (7.9–14.7) | 12.7 % (6.3–16.5) | 11.3 % (5.8–16.7) |
| Storage / TV / bedside | 16.8 % (12.6–26) | 9.9 % (7.7–15.4) | 13.4 % (7.8–17.8) | 11.5 % (6.1–14.8) |
| Coffee + side tables | 13.3 % (4.9–19.2) | 12.6 % (8.5–15.8) | 9.2 % (7.6–10.1) | 8.6 % (5.9–10.8) |
| Lighting | — | 4.8 % (4.2–5.4) | 3.8 % (2.9–4.9) | 4.0 % (3.5–5) |
| Rugs | — | 5.6 % (4.7–7.1) | 6.5 % (4.7–7.8) | 7.7 % (6.2–9.7) |
| Curtains | 3.4 % (2.7–4.6) | 2.0 % (1.6–2.6) | 2.1 % (1.5–3) | 3.2 % (2.6–4.1) |
| Textiles (bedding, cushions, throw) | 3.1 % (2.6–3.7) | 4.9 % (3.8–6.1) | 4.3 % (3–5.6) | 6.7 % (5.6–8.6) |
| Art + mirror | — | 5.3 % (4.1–6.4) | 5.1 % (3.9–6.2) | 4.8 % (3.6–5.8) |
| Decor + plant | — | 5.9 % (4.8–7.3) | 6.3 % (5.3–7.6) | 6.9 % (6.1–8.1) |
| Tableware + kitchen | — | 2.7 % (2.4–3) | 2.6 % (2.1–3.3) | 2.5 % (1.9–3) |

Zone split of today's designer rooms (Lalamove's buckets):

| Style | Bedroom | Living | Dining | Storage (TV unit) | Décor | Sofa / living furniture |
|---|---:|---:|---:|---:|---:|---:|
| dark-walnut | 26 % | 40 % | 19 % | 3 % | 13 % | 28 % |
| light-oak | 23 % | 37 % | 20 % | 4 % | 16 % | 36 % |
| greige-luxe | 20 % | 52 % | 9 % | 8 % | 11 % | 24 % |
| mediterranean | 16 % | 40 % | 14 % | 15 % | 15 % | 34 % |

Read:

- At Essentials, sleep, sit and eat take about 64 % (bed + mattress 27, sofa 19, dining 18). That matches the market's sleep-heavy split.
- In the full room, Villar spends **less on sofa and bed (about 8–16 % each) than the market (24–37 %)**, because the money is
  spread over 33 slots instead of 5–7.
- The sofa's share of living furniture (24–36 %) matches Havenly's 30–40 %.
- Décor plus art is 9–14 %, close to Lalamove's 10 %.
- Greige-luxe leans on the living zone (52 %; the oti armchair alone is 19 %).
- **Curtains are 1.5–4.6 %, against 11–13 % in the UAE table.** For a 3.8 m floor-to-ceiling window, our off-the-shelf panels are
  cheap. Check that the ceiling track and hanging are in the install fee (§10.6).

Guideline for designers adding new options: keep the designer room roughly at bed + mattress 10–16 %, sofa 8–16 %, dining 6–17 %,
armchair 6–19 %, storage 8–18 %, tables 8–10 %, lighting 3–5 %, rugs 5–8 %, curtains + textiles 5–8 %, art + décor + plant 9–14 %,
tableware + kitchen 2–3 %. The upper ends belong to the style's statement piece.

---

## 8. Cheapest plausible room and most expensive room per style

**Cheapest plausible = Essentials** (tier 0 + 1, furniture pairings kept). Items, with prices ×2 for pairs:

- **dark-walnut** (13 330): bed bed-cloud-160 2 159; mattress mattress-rejuvenate-160 1 355; bedding bedding-white-sateen-oat 382; sofa sofa-daventry-3 2 639; curtains curtains-khor-sheer 358; tv_unit tv-hege 959; nightstand ×2 nightstand-nazario 718; dining_table dining-square-80 1 175; dining_chair ×2 chair-stanton 1 030; coffee_table coffee-arras 2 555
- **light-oak** (11 938): bed bed-grant-160 2 039; mattress mattress-rejuvenate-160 1 355; bedding bedding-white-sateen-oat 382; sofa sofa-rockwell-3 2 159; curtains curtains-sullivan-sheer 478; tv_unit tv-echo 767; nightstand ×2 nightstand-forren 838; dining_table dining-keira-100 839; dining_chair ×2 chair-emily 2 566; coffee_table coffee-echo 515
- **greige-luxe** (14 890): bed bed-cloud-160 2 159; mattress mattress-rejuvenate-160 1 355; bedding bedding-white-sateen-oat 382; sofa sofa-daventry-3 2 639; curtains curtains-sullivan-sheer 478; tv_unit tv-joyce 2 675; nightstand ×2 nightstand-qubba 1 198; dining_table dining-malta-90 1 019; dining_chair ×2 chair-salalah 958; coffee_table coffee-arkas 2 027
- **mediterranean** (12 742): bed bed-forren-160 1 559; mattress mattress-rejuvenate-160 1 355; bedding bedding-white-sateen-oat 382; sofa sofa-anders-3 2 159; curtains curtains-khor-sheer 358; tv_unit tv-echo 767; nightstand ×2 nightstand-forren 838; dining_table dining-keira-100 839; dining_chair ×2 chair-emily 2 566; coffee_table coffee-corta 1 919

- Without pairings: light-oak would be 10,450 (sven chairs instead of emily) and mediterranean 12,334 (canovia chairs).
  Dark-walnut and greige-luxe are the same either way.
- Dark-walnut costs 13.3k because its cheapest coffee table is the travertine-top arras at 2,555. Greige-luxe costs 14.9k because its only TV unit costs 2,675.
- **The UAE-functional floor** adds the blackout layer: dark-walnut 14,047 · light-oak 12,535 · greige-luxe 15,487 · mediterranean 13,459.
- **The absolute floor**, tier 0 only: 7,852 / 7,180 / 9,688 / 6,580.

**Most expensive full room:**

- Every key at its priciest option: dark-walnut **41,547** · light-oak **26,471** · greige-luxe **34,352** · mediterranean **35,191**.
- Pairing-safe premium end, the slider's right end: 41,451 / 25,391 / 34,148 / 33,991.

---

## 9. The ladder, step by step

### 9.1 Adds: cumulative total (step price)

| # | Step | Tier | dark-walnut | light-oak | greige-luxe | mediterranean |
|---|---|---|---:|---:|---:|---:|
| 0 | minimum (tier 0) | 0 | 7 852 (7 852) | 7 180 (7 180) | 9 688 (9 688) | 6 580 (6 580) |
| 1 | + nightstand | 1 | 8 570 (+718) | 8 018 (+838) | 10 886 (+1 198) | 7 418 (+838) |
| 2 | + dining_table + 2 dining_chair | 1 | 10 775 (+2 205) | 11 423 (+3 405) | 12 863 (+1 977) | 10 823 (+3 405) |
| 3 | + coffee_table | 1 | 13 330 (+2 555) | 11 938 (+515) | 14 890 (+2 027) | 12 742 (+1 919) |
| 4 | curtains → blackout | 2 | 14 047 (+717) | 12 535 (+597) | 15 487 (+597) | 13 459 (+717) |
| 5 | + table_lamp | 2 | 14 405 (+358) | 12 725 (+190) | 15 845 (+358) | 13 889 (+430) |
| 6 | + rug | 2 | 15 304 (+899) | 13 624 (+899) | 17 164 (+1 319) | 14 668 (+779) |
| 7 | + floor_lamp | 2 | 15 783 (+479) | 14 223 (+599) | 17 643 (+479) | 15 063 (+395) |
| 8 | + tableware | 2 | 16 354 (+571) | 14 662 (+439) | 18 214 (+571) | 15 502 (+439) |
| 9 | + cushions | 3 | 17 370 (+1 016) | 14 856 (+194) | 19 146 (+932) | 15 810 (+308) |
| 10 | + art_sofa | 3 | 17 969 (+599) | 15 155 (+299) | 19 385 (+239) | 16 445 (+635) |
| 11 | + throw | 3 | 18 244 (+275) | 15 322 (+167) | 19 552 (+167) | 16 588 (+143) |
| 12 | + pendant_lamp | 3 | 18 459 (+215) | 15 549 (+227) | 19 767 (+215) | 16 947 (+359) |
| 13 | + mirror | 3 | 18 818 (+359) | 15 788 (+239) | 20 006 (+239) | 17 486 (+539) |
| 14 | + side_table | 3 | 19 717 (+899) | 16 843 (+1 055) | 20 869 (+863) | 18 541 (+1 055) |
| 15 | + plant | 4 | 20 411 (+694) | 17 441 (+598) | 21 563 (+694) | 19 235 (+694) |
| 16 | + art_bed | 4 | 20 866 (+455) | 17 896 (+455) | 22 018 (+455) | 19 474 (+239) |
| 17 | + decor_coffee | 4 | 21 246 (+380) | 18 075 (+179) | 22 230 (+212) | 19 778 (+304) |
| 18 | + centerpiece | 4 | 21 491 (+245) | 18 304 (+229) | 22 324 (+94) | 20 007 (+229) |
| 19 | + decor_tv | 4 | 22 015 (+524) | 18 756 (+452) | 22 776 (+452) | 20 579 (+572) |
| 20 | + nightstand_decor | 4 | 22 242 (+227) | 18 871 (+115) | 23 003 (+227) | 20 694 (+115) |
| 21 | + kitchen_decor | 4 | 22 856 (+614) | 19 039 (+168) | 23 171 (+168) | 20 862 (+168) |
| 22 | + art_dining | 4 | 23 095 (+239) | 19 194 (+155) | 23 470 (+299) | 21 257 (+395) |
| 23 | + runner | 4 | 23 574 (+479) | 19 673 (+479) | 23 949 (+479) | 21 856 (+599) |
| 24 | + armchair | 4 | 26 573 (+2 999) | 21 232 (+1 559) | 28 388 (+4 439) | 23 415 (+1 559) |

### 9.2 Upgrades: to the designer room, then premium

- **dark-walnut**: to the designer room (8): sofa +360 · rug +1 080 · dining_table +3 216 · dining_chair +528 · coffee_table +120 · tv_unit +60 · nightstand +3 936 · bedding +370 → **36 243**. Premium (16): sofa +600 · bed +720 · mattress +444 · dining_chair +1 008 · coffee_table + side_table +816 · bedding +12 · pendant_lamp +204 · floor_lamp +60 · table_lamp +240 · cushions +323 · plant +421 · mirror +60 · art_dining +60 · tableware +72 · decor_tv +48 · runner +120 → **41 451**.
- **light-oak**: to the designer room (1): bedding +48 → **21 280**. Premium (12): bed +840 · mattress +444 · bedding +334 · pendant_lamp +132 · table_lamp +168 · cushions +1 145 · plant +517 · mirror +300 · decor_coffee +33 · centerpiece +16 · kitchen_decor +62 · runner +120 → **25 391**.
- **greige-luxe**: to the designer room (3): sofa + armchair + rug +3 060 · bed +720 · bedding +48 → **32 216**. Premium (9): mattress +444 · pendant_lamp +144 · table_lamp +120 · cushions +407 · plant +421 · tableware +72 · centerpiece +151 · kitchen_decor +53 · runner +120 → **34 148**.
- **mediterranean**: to the designer room (3): sofa + armchair +2 880 · tv_unit +3 612 · bedding +58 → **29 965**. Premium (10): bed +1 320 · mattress +444 · bedding +324 · pendant_lamp +60 · cushions +1 031 · throw +132 · plant +421 · art_bed +216 · centerpiece +16 · kitchen_decor +62 → **33 991**.

### 9.3 Step sizes

- dark-walnut: 49 steps, median 455; steps ≥ 2 000: dining_table + dining_chair +2 205; coffee_table +2 555; armchair +2 999; dining_table → curated +3 216; nightstand → curated +3 936
- light-oak: 38 steps, median 300; steps ≥ 2 000: dining_table + dining_chair +3 405
- greige-luxe: 37 steps, median 421; steps ≥ 2 000: coffee_table +2 027; armchair +4 439; sofa → curated +3 060
- mediterranean: 38 steps, median 430; steps ≥ 2 000: dining_table + dining_chair +3 405; sofa → curated +2 880; tv_unit → curated +3 612

### 9.4 What a customer gets at round budgets

This answers the founder's "most common configurations by budget". Cells read: total · slots filled out of 33 · level · next step.

| Budget, AED | dark-walnut | light-oak | greige-luxe | mediterranean |
|---:|---|---|---|---|
| 8 000 | 7 852 · 6/33 · minimum · next nightstand +718 | 7 180 · 6/33 · minimum · next nightstand +838 | below the minimum (9 688) | 7 418 · 8/33 · minimum · next dining_table+chairs +3 405 |
| 10 000 | 8 570 · 8/33 · minimum · next dining_table+chairs +2 205 | 8 018 · 8/33 · minimum · next dining_table+chairs +3 405 | 9 688 · 6/33 · minimum · next nightstand +1 198 | 7 418 · 8/33 · minimum · next dining_table+chairs +3 405 |
| 12 000 | 10 775 · 11/33 · minimum · next coffee_table +2 555 | 11 938 · 12/33 · Essentials · next curtains → blackout +597 | 10 886 · 8/33 · minimum · next dining_table+chairs +1 977 | 10 823 · 11/33 · minimum · next coffee_table +1 919 |
| 15 000 | 14 405 · 14/33 · Essentials · next rug +899 | 14 856 · 18/33 · Comfortable · next art_sofa +299 | 14 890 · 12/33 · Essentials · next curtains → blackout +597 | 14 668 · 15/33 · Essentials · next floor_lamp +395 |
| 18 000 | 17 969 · 19/33 · Comfortable · next throw +275 | 17 896 · 25/33 · Move-in ready · next decor_coffee +179 | 17 643 · 16/33 · Essentials · next tableware +571 | 17 486 · 22/33 · Comfortable · next side_table +1 055 |
| 20 000 | 19 717 · 23/33 · Move-in ready · next plant +694 | 19 673 · 32/33 · Move-in ready · next armchair +1 559 | 19 767 · 21/33 · Comfortable · next mirror +239 | 19 778 · 26/33 · Move-in ready · next centerpiece +229 |
| 22 000 | 21 491 · 27/33 · Move-in ready · next decor_tv +524 | 21 280 · 33/33 · Magazine-ready · next bed ↑↑ +840 | 21 563 · 24/33 · Move-in ready · next art_bed +455 | 21 856 · 32/33 · Move-in ready · next armchair +1 559 |
| 25 000 | 23 574 · 32/33 · Move-in ready · next armchair +2 999 | 24 860 · 33/33 · Magazine-ready · next mirror ↑↑ +300 | 23 949 · 32/33 · Move-in ready · next armchair +4 439 | 23 415 · 33/33 · Move-in ready · next sofa ↑ +2 880 |
| 30 000 | 28 013 · 33/33 · Move-in ready · next dining_table ↑ +3 216 | 25 391 · 33/33 · No compromises · top | 28 388 · 33/33 · Move-in ready · next sofa ↑ +3 060 | 29 965 · 33/33 · Magazine-ready · next bed ↑↑ +1 320 |
| 35 000 | 31 937 · 33/33 · Move-in ready · next nightstand ↑ +3 936 | 25 391 · 33/33 · No compromises · top | 34 148 · 33/33 · No compromises · top | 33 991 · 33/33 · No compromises · top |
| 40 000 | 39 843 · 33/33 · Magazine-ready · next pendant_lamp ↑↑ +204 | 25 391 · 33/33 · No compromises · top | 34 148 · 33/33 · No compromises · top | 33 991 · 33/33 · No compromises · top |

---

## 10. Findings for designers, catalog and engineering

1. **Blackout by default.** Light-oak, greige-luxe and mediterranean ship sheer-only curtains in the designer room. DET asks holiday homes to
   "completely darken the unit". The bed's side is about 0.6 m from the glass, with one nightstand between. Designers and STR guides call for blackout.
   Switch those defaults to the sheer + blackout set (+597 each). Dark-walnut already uses it.
2. **Lumpy steps.** These are where the slider will visibly jump (§9.3):
   - dark-walnut: nightstands → curated +3,936 and the Kentana table +3,216;
   - greige-luxe: the armchair +4,439, which is the daventry → mons pairing;
   - mediterranean: TV unit → curated +3,612.
   A mid-priced option in those slots (a walnut nightstand around 800–1,200, a dining table around 2,000, a greige-luxe armchair around 3,000,
   a mediterranean TV unit around 2,000) would smooth them. Alternatively, pair the greige-luxe daventry sofa with the emma armchair (2,640).
3. **Greige-luxe's floor is high (9.7k)** because its only TV unit is 2,675. A cheaper on-style unit would bring its minimum in line
   with the other styles (6.6–7.9k).
4. **Light-oak's range is narrow** (minimum 7.2k → premium 25.4k; the designer room is only +48 over the full base room). 10 of its 30
   keys have a single option, so there is little to upgrade.
5. **Pairings vs defaults.** Light-oak's curated room breaks 3 of its own pairings and greige-luxe's breaks 1 (§4). Designers should reconcile them.
   The slider ignores non-furniture pairings until then.
6. **Curtain install.** Curtains are 2–4 % of our room against 11–13 % in UAE estimates. Confirm that the 3.8 m ceiling track is covered.
7. **Mediterranean rug.** The only room-sized rug is the 1,979 wool. The cheapest (and curated) rug is the 160×230 dhurrie, which the designer
   pairs with the oshawa sofa on purpose, so the ladder keeps it (the 25 % rule). That's fine as is; a ~900 AED 200×290 option would give the
   designers a choice.
8. **Data flags for engineering.**
   - Blackout is detected by `nameEn` containing "blackout". Rug size is read from `dims.w`. Prefer an explicit
     `blackout: true` on curtain items in `catalog.json`.
   - Pins are not in the scratch script. Per the contract, a pinned key is fixed from step 0, pulls in its `requires` at their
     entry options, and its furniture pairings apply forward.
9. **No product below about 6.6k.** The market's bottom band is 4–6k (furnish it yourself). That is below the founder's stated minimum
   (sofa + TV unit), so it isn't a gap to fill now.

---

## 11. Machine-readable spec (draft of `site/data/budget.json`)

This is the file `/tmp/villar-budget/budget-spec.json`, verbatim; the reference planner reads it. Field meanings:

- `tiers`: key → tier 0..4.
- `order`: add order within each tier. `@curtains-blackout` is the functional step.
- `groups`: keys that move together. Pairs are already single keys.
- `requires`: hard dependencies.
- `after`: soft ordering, documentation only.
- `furniture`: keys that enter at the cheapest option and take part in pairings.
- `entry`: the entry-option rules.
- `functional`: early upgrades.
- `heroes`: upgrade order to curated.
- `premiumOrder`: upgrade order above curated.
- `pairings`: the slider's pairing policy.
- `rule`: the add-vs-upgrade rule in RU and EN.
- `levels`: RU / EN names, milestones and customer lines.
- `minimum`, `ticks`: the slider's left end and tick merging.

Milestones: `tier:0` is the minimum. `endOfTier:N` is the total after the last add or functional step of tier ≤ N. `designer` is after the
hero and curated upgrades. `premium` is the last step.

```json
{
  "version": 1,
  "source": "research/budget-tiers.md, 2026-11-27",
  "keys": "Stylepack selection keys, resolved the way store.keyOfSlotIn does it (slot id, else group, else slot type). Paired slots share one key: nightstand (x2), table_lamp (x2), dining_chair (x2).",
  "tiers": {
    "bed": 0,
    "mattress": 0,
    "bedding": 0,
    "sofa": 0,
    "curtains": 0,
    "tv_unit": 0,
    "nightstand": 1,
    "dining_table": 1,
    "dining_chair": 1,
    "coffee_table": 1,
    "table_lamp": 2,
    "rug": 2,
    "floor_lamp": 2,
    "tableware": 2,
    "cushions": 3,
    "art_sofa": 3,
    "throw": 3,
    "pendant_lamp": 3,
    "mirror": 3,
    "side_table": 3,
    "plant": 4,
    "art_bed": 4,
    "decor_coffee": 4,
    "centerpiece": 4,
    "decor_tv": 4,
    "nightstand_decor": 4,
    "kitchen_decor": 4,
    "art_dining": 4,
    "runner": 4,
    "armchair": 4
  },
  "order": {
    "0": ["bed", "mattress", "bedding", "sofa", "curtains", "tv_unit"],
    "1": ["nightstand", "dining_table", "dining_chair", "coffee_table"],
    "2": ["@curtains-blackout", "table_lamp", "rug", "floor_lamp", "tableware"],
    "3": ["cushions", "art_sofa", "throw", "pendant_lamp", "mirror", "side_table"],
    "4": [
      "plant", "art_bed", "decor_coffee", "centerpiece", "decor_tv", "nightstand_decor", "kitchen_decor",
      "art_dining", "runner", "armchair"
    ]
  },
  "groups": [["dining_table", "dining_chair"]],
  "requires": {
    "mattress": ["bed"],
    "bedding": ["mattress"],
    "table_lamp": ["nightstand"],
    "nightstand_decor": ["nightstand"],
    "cushions": ["sofa"],
    "throw": ["sofa"],
    "side_table": ["sofa"],
    "decor_coffee": ["coffee_table"],
    "decor_tv": ["tv_unit"],
    "dining_chair": ["dining_table"],
    "dining_table": ["dining_chair"],
    "tableware": ["dining_table"],
    "centerpiece": ["dining_table"],
    "pendant_lamp": ["dining_table"]
  },
  "after": {
    "art_bed": ["art_sofa"],
    "art_dining": ["art_bed"],
    "centerpiece": ["tableware"],
    "side_table": ["coffee_table"],
    "armchair": ["floor_lamp"]
  },
  "furniture": [
    "bed", "mattress", "sofa", "curtains", "tv_unit", "nightstand", "dining_table", "dining_chair",
    "coffee_table", "rug", "side_table", "armchair"
  ],
  "entry": {
    "tier0": "cheapest",
    "furniture": "cheapest, unless a furniture item already in the room has a pairing for this key: then the paired item",
    "details": "curated",
    "tieBreak": "equal prices: the curated item first",
    "rug": {"preferWidthCmAtLeast": 290, "ifPriceAtMost": 1.25}
  },
  "functional": [
    {
      "id": "curtains-blackout",
      "key": "curtains",
      "match": {"field": "nameEn", "pattern": "blackout"},
      "when": "first step after Essentials (start of tier 2)",
      "keepAboveCurated": true
    }
  ],
  "heroes": [
    "sofa", "bed", "mattress", "rug", "armchair", "dining_table", "dining_chair", "coffee_table", "side_table",
    "tv_unit", "nightstand", "bedding", "curtains"
  ],
  "premiumOrder": [
    "sofa", "bed", "mattress", "rug", "armchair", "dining_table", "dining_chair", "coffee_table", "side_table",
    "tv_unit", "nightstand", "bedding", "curtains", "pendant_lamp", "floor_lamp", "table_lamp", "art_sofa",
    "cushions", "throw", "plant", "mirror", "art_bed", "art_dining", "tableware", "decor_coffee", "decor_tv",
    "centerpiece", "nightstand_decor", "kitchen_decor", "runner"
  ],
  "pairings": {
    "scope": "furniture keys only (both sides in `furniture`); pairings on textiles and accessories are ignored by the slider because the curated room itself breaks some of them",
    "onAdd": "forward only: the entering item follows the items already in the room, never the reverse",
    "onHeroUpgrade": "the hero's furniture companions that are already in the room move to its paired items in the same step",
    "onPremium": "skip any premium option that would break a furniture pairing or force a companion to a cheaper item; try the next priciest option"
  },
  "rule": {
    "en": "Complete first, then better. Add slots in ladder order and never upgrade while a slot of the current or a lower tier is empty. The only exception is the blackout curtain layer, taken right after Essentials. Once all 33 slots are filled, upgrade heroes to the designer's pick, hero-first, with their companions in the same step. This lands exactly on the designer room. Above it, go to premium options: heroes first, then details.",
    "ru": "Сначала — всё, потом — лучше. Добавляем места по порядку лестницы и не улучшаем вещи, пока в текущем или более раннем уровне есть пустое место. Единственное исключение — блэкаут-слой штор сразу после «Самого нужного». Когда заполнены все 33 места, меняем главные вещи на выбор дизайнера, начиная с дивана, вместе с их парами — так лестница приходит точно в комнату дизайнера. Дальше — премиальные варианты: сначала главные вещи, потом детали."
  },
  "levels": [
    {
      "id": "essentials",
      "name": "Самое нужное",
      "nameEn": "Essentials",
      "milestone": "endOfTier:1",
      "blurb": "Спать, сидеть, есть, хранить, шторы.",
      "blurbEn": "Sleep, sit, eat, store, curtains."
    },
    {
      "id": "comfortable",
      "name": "Удобно жить",
      "nameEn": "Comfortable",
      "milestone": "endOfTier:2",
      "blurb": "Блэкаут, свет у кровати и у дивана, ковёр, посуда.",
      "blurbEn": "Blackout, bedside and sofa light, a rug, tableware."
    },
    {
      "id": "move-in",
      "name": "Под ключ",
      "nameEn": "Move-in ready",
      "milestone": "endOfTier:3",
      "blurb": "Всё для жизни и уюта: шторы, ковёр, свет, текстиль, картина. Заезжайте с чемоданом.",
      "blurbEn": "Everything to live in and feel at home: curtains, rug, lights, textiles, art. Move in with a suitcase."
    },
    {
      "id": "magazine",
      "name": "Как в журнале",
      "nameEn": "Magazine-ready",
      "milestone": "designer",
      "blurb": "Ровно комната дизайнера: стайлинг, растение, кресло, материалы как на фото.",
      "blurbEn": "Exactly the designer's room: styling, plant, armchair, materials as in the photos."
    },
    {
      "id": "no-compromise",
      "name": "Без компромиссов",
      "nameEn": "No compromises",
      "milestone": "premium",
      "blurb": "Лучшие варианты в каждом месте.",
      "blurbEn": "The best option in every place."
    }
  ],
  "minimum": {
    "milestone": "tier:0",
    "label": null,
    "note": "The slider's left end, plus pins and whatever the pins require. Not a named level."
  },
  "ticks": {"mergeIfWithinShare": 0.03, "keep": "higher"}
}
```

**Reference implementation:** `node /tmp/villar-budget/budget-ladder.js [--steps] [--contract] [--spec=…] [--out=…]`.

- It exports `buildLadder(packId)` → `{ steps: [{ total, add, kind, tier, label, delta: [{key, from, to}], selection }],
  milestones, levels: [{ id, name, nameEn, milestone, total, index }], minIndex, defaultIndex, maxIndex, problems }`
  and `ladderIndexFor(ladder, budget)`.
- It checks `requires`, furniture pairings and monotonicity at every step. Current result: 0 problems in all 4 styles.
- It writes `/tmp/villar-budget/budget-ladder-out.json`.
- `/tmp/villar-budget/gen-final.js` rebuilds every table in this file.
- `/tmp` is scratch, so copy the script into `site/js/core/budget.js` or `tools/` before it is lost.

---

## 12. Method and caveats

- **Data:** `site/data/catalog.json` (158 items; `price` is already ×1.2), `layout-studio.json` (33 slots), `stylepack-*.json`
  (options, defaults, pairings). The key resolution copies `store.keyOfSlotIn`.
- **Market numbers** are "from" or list prices on the day they were read. FullFlat ran a 15 % promo. Real Estate Club is an aggregator blog
  with internal inconsistencies. GuestReady prices include services such as cleaning and paint. Package scopes differ, with or without mattress,
  textiles or appliances, so compare by contents, not by price alone.
- **Western sources** (TwentyCi UK, Porch US, US checklists) were used for buying-order logic only, not for prices.
  Where they disagree with UAE sources, the UAE sources won. The dining set is the case: postponed in US lists, an essential in DET and UAE retailers' lists.
- **Not covered:** appliances, towels, wardrobe and kitchen built-ins (they belong to the apartment), the delivery and install fee, and VAT.
