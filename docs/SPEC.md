# Villar MVP — engineering spec (source of truth)

Villar is an AI interior studio: a user picks a style pack, sees a real apartment furnished in 3D with
purchasable items, hovers any object to see price and specs, swaps items only for style-compatible
alternatives, and sees the live total. MVP = one studio apartment, one style pack ("Тёмный орех" /
Dark Walnut), catalog sourced from Home Centre UAE, prices = Home Centre regular price × 1.2.

UI language: Russian. Currency: AED. Units in code: meters, Y up. Catalog dims: centimeters.

## Hard rules

- Static site, no build step. Everything deployable lives in `site/`. Vercel serves `site/` as-is.
- 3D libraries are vendored (no CDN): `site/vendor/three` (three.js r187: `three.module.js`,
  `three.core.js`, `three.webgpu.js`, `three.tsl.js`, `addons/` = examples/jsm),
  `site/vendor/three-mesh-bvh/src`, `site/vendor/three-gpu-pathtracer/src` (v0.0.28, WebGL path tracer).
- Import map (every HTML page that uses 3D must include exactly this):
  ```html
  <script type="importmap">{"imports":{
    "three":"/vendor/three/three.module.js",
    "three/addons/":"/vendor/three/addons/",
    "three/examples/jsm/":"/vendor/three/addons/",
    "three/webgpu":"/vendor/three/three.webgpu.js",
    "three/tsl":"/vendor/three/three.tsl.js",
    "three-mesh-bvh":"/vendor/three-mesh-bvh/src/index.js",
    "three-mesh-bvh/webgpu":"/vendor/three-mesh-bvh/src/webgpu/index.js",
    "three-gpu-pathtracer":"/vendor/three-gpu-pathtracer/src/index.js"
  }}</script>
  ```
- Never show product URLs, SKUs, article numbers or the supplier name anywhere on the public site.
  The public `site/data/catalog.json` must not contain them. Sourcing data (URLs, SKUs, base prices)
  lives only in `research/` (not deployed).
- No external network requests at runtime (no CDNs, no Google Fonts). System font stack only:
  `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", Roboto, system-ui, sans-serif`.
- No AI API calls at runtime. "AI" in the MVP = curated presets + compatibility rules authored by us.
- All materials must be `MeshStandardMaterial` / `MeshPhysicalMaterial` (path-tracer compatible).
  No custom ShaderMaterial on scene objects.

## Directory and ownership

| Path | Owner | Notes |
| --- | --- | --- |
| `docs/SPEC.md`, `site/js/core/*` | coordinator | store + data loading; ask coordinator for changes |
| `site/data/layout-studio.json` | engine (initial version by coordinator) | architecture + slots |
| `site/js/engine/*` (except materials/furniture) | engine | renderer, scene, architecture, light, camera, interaction, post, photo mode |
| `site/js/engine/materials.js`, `site/js/engine/textures.js`, `site/js/engine/furniture/*` | modeler | procedural PBR materials + parametric furniture generators |
| `site/index.html`, `site/css/*`, `site/js/ui/*`, `site/js/main.js` | interface | Apple-style site + editor UI |
| `site/data/palette-dark-walnut.json`, `research/color-research.md` | color research | palette + rules |
| `site/data/catalog.json`, `site/data/stylepack-dark-walnut.json`, `research/homecentre-*.json`, `research/catalog-sourcing.md` | catalog | real Home Centre items |
| `tools/*` | coordinator | `tools/shoot.mjs` = headless screenshot harness |
| `site/lab/*.html` | each team may add its own lab page (`lab/engine.html`, `lab/furniture.html`) | dev/test pages, OK to deploy |

Do not edit files you don't own. If you need a change in another team's file, write the request in
`docs/requests/<your-team>.md` and tell the coordinator in your final report.

## Coordinate system and conventions

- Meters, Y up. Apartment interior spans x ∈ [0, 4.6], z ∈ [0, 9.0], floor y = 0, ceiling y = 2.85.
- Entry is at z = 0 (south wall). Floor-to-ceiling window wall is z = 9.0 (north wall in local terms;
  treat it as the sunny side — afternoon sun enters through it).
- Furniture generator output: a `THREE.Group` whose origin is the **bottom-center of its footprint**,
  front facing **+Z**, width along X, depth along Z, height along Y. Sizes in meters.
- Slot `rotY` is degrees around +Y applied to the item; 0 = item front faces +Z; 90 = faces +X;
  -90 = faces -X; 180 = faces -Z.

## Data contracts

### `site/data/layout-studio.json`
Architecture (walls, openings, built-ins, fixed props) and `slots`. Each slot:
```json
{ "id": "sofa", "type": "sofa", "pos": [4.13, 0, 5.05], "rotY": -90,
  "max": { "w": 2.4, "d": 1.05, "h": 1.0 },
  "attach": null }
```
`attach` (optional) = `{ "slot": "coffee_table", "anchor": "top", "offset": [0, 0, 0] }` — the item is
placed relative to the anchor exported by the parent's generator (see anchors below).
`group` (optional) = slots that always share one item choice (e.g. both nightstands): swapping one swaps all.

### `site/data/catalog.json` (public)
```json
{ "currency": "AED", "markup": 1.2, "items": [ {
  "id": "sofa-oslo-3",                // stable id, kebab-case
  "type": "sofa",                     // = slot type
  "name": "Диван Oslo, трёхместный",  // Russian display name (model name may stay Latin)
  "price": 4799,                      // AED integer, already = round(base × 1.2)
  "dims": { "w": 220, "d": 92, "h": 82 },   // cm; for round items w = d = diameter
  "materials": ["Букле", "Массив ореха"],
  "color": "Молочный",
  "colorHex": "#E8E1D5",
  "tags": ["dark-walnut"],
  "model": { "archetype": "sofa", "params": { "seats": 3, "arm": "track", "legs": "wood-taper",
             "fabric": "boucle", "fabricColor": "#E8E1D5", "wood": "walnut-dark" } }
} ] }
```
No URL, SKU, supplier or base price in this file.

### `site/data/stylepack-dark-walnut.json`
```json
{ "id": "dark-walnut", "name": "Тёмный орех", "tagline": "...", "description": "...",
  "palette": "palette-dark-walnut.json",
  "architecture": { "floor": "oak-light", "walls": "#EDE7DE", "ceiling": "#F5F2EC", "kitchenFronts": "#D8D0C4", "worktop": "travertine" },
  "slots": { "<slot type>": { "default": "<item id>", "options": ["<item id>", "..."] } },
  "rules": ["human-readable compatibility rules shown nowhere yet, used by us"] }
```
`options` = the only items the user may swap to for that slot type (pre-validated compatibility).

### `site/data/palette-dark-walnut.json`
```json
{ "id": "dark-walnut", "name": "Тёмный орех",
  "roles": { "base": [...], "secondary": [...], "accent": [...], "wood": [...], "metal": [...] },
  "swatches": [ { "name": "Тёплый белый", "hex": "#EDE7DE", "role": "walls", "share": 0.6 } ],
  "rules": [ "..." ] }
```

## Runtime architecture

```
main.js ─► data.js (fetch JSON) ─► store.js (selection state)
   │                                   │ change events
   ├─► engine/index.js  createVillar({ container, store, layout, catalog, stylepack })
   │        emits: ready, hover, select, progress, photo
   └─► ui/*  (hover card, item panel + swap list, budget bar, view controls)
```

### Store (`site/js/core/store.js`, coordinator)
- `store.state` = `{ catalog, stylepack, layout, selection: { [slotType]: itemId } }`
- `store.select(slotType, itemId)` validates against `stylepack.slots[slotType].options`.
- `store.on('change', fn)` → `fn({ slotType, itemId, prev })`.
- `store.placed()` → `[{ slotId, slotType, item }]` for every slot in the layout (grouped slots count each placement).
- `store.total()` → sum of `item.price` over `placed()`.

### Engine API (`site/js/engine/index.js`, engine)
```js
const villar = await createVillar({ container, store, layout, catalog, stylepack, quality: 'high' });
villar.on('ready'|'hover'|'select'|'progress', fn)
// hover/select payload: { slotId, slotType, item, x, y } (x,y = client px) or null
villar.setView('eye' | 'living' | 'bed' | 'dining' | 'window' | 'top')   // camera presets
villar.setTimeOfDay('morning' | 'day' | 'golden' | 'evening')           // sun + sky + lamps
villar.startPhoto(); villar.stopPhoto();                                 // progressive path tracing of current view
villar.highlight(slotId | null)
villar.dispose()
window.villar = villar; window.__villarReady = true  // after first good frame (for QA harness)
```
The engine listens to `store.on('change')` and swaps the 3D model in every slot of that type.

### Furniture generators (`site/js/engine/furniture/index.js`, modeler)
```js
import { buildItem, ARCHETYPES } from './furniture/index.js';
const group = buildItem(item, { materials });   // item = catalog item (dims in cm)
group.userData.anchors = { top: Vector3, seat: Vector3, deck: Vector3, ... }   // local coords
group.userData.lights = [ { type: 'point'|'spot', position: [x,y,z], color: '#ffd8a8', intensity: 1, distance: 4 } ]  // lamps
```
Required archetypes: `sofa, armchair, coffee_table, side_table, tv_unit, bed, mattress, bedding,
nightstand, dining_table, dining_chair, floor_lamp, table_lamp, pendant_lamp, rug, curtains,
wall_art, plant, decor_set, cushions`.

### Materials (`site/js/engine/materials.js`, modeler)
```js
import { createMaterials } from './materials.js';
const materials = createMaterials(renderer);     // builds procedural textures once
materials.get('walnut-dark')                      // cached
materials.get('fabric-boucle', { color: '#E8E1D5' })
```
Keys (minimum): `walnut-dark, walnut-medium, oak-light, oak-floor, porcelain-tile, plaster-wall, paint,
fabric-boucle, fabric-linen, fabric-velvet, leather-cognac, metal-black, metal-brass, metal-chrome,
marble-white, travertine, stone-worktop, ceramic-matte, glass-clear, glass-frosted, rattan, jute, wool-rug,
plant-leaf, soil, lamp-shade, kitchen-front, mirror, canvas`.

## Quality bar

- First meaningful frame < 4 s on a laptop; 60 fps target in interactive mode on an M1/M2-class GPU,
  ≥ 30 fps on integrated GPUs (adaptive pixel ratio).
- Photoreal look: physically based materials, filmic tone mapping (AgX or ACES), sun shadows that fall
  correctly through the window, soft contact shadows / AO, warm lamp light in the evening.
- "Feels like standing in the apartment": default camera at eye height 1.6 m, ~24 mm full-frame
  equivalent (vertical FOV ≈ 55–60°), smooth look-around and walk, collision with walls.
- No console errors. Works in Chrome, Safari 17+, Firefox; usable on iPhone.

## QA harness

```
cd /home/claude/villar
NODE_PATH=$(npm root -g) node tools/shoot.mjs --page /index.html --out /tmp/shots/x.png --wait 8000
NODE_PATH=$(npm root -g) node tools/shoot.mjs --page /lab/engine.html --steps /tmp/steps.json
```
Headless Chrome uses SwiftShader (software WebGL): it is slow but faithful. Use it to check
console errors and look at renders (open the PNG with the Read tool).
