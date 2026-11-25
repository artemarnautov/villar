# Villar

AI interior studio MVP: a real Dubai studio apartment furnished in 3D from a curated style pack.
Hover any object for price and specs, swap it only for style-compatible alternatives, watch the
total update live, and order everything in one click (ordering is a stub in the MVP).

- **Style pack:** «Тёмный орех» (Dark Walnut)
- **Catalog:** real items sourced from Home Centre UAE; public prices = regular price × 1.2
- **Render:** three.js r187 (vendored), physically based materials, sun through the window,
  GTAO, time of day, progressive path-traced photo mode (three-gpu-pathtracer)
- **Stack:** static site, no build step; Vercel serves `site/` (see `vercel.json`)

## Structure

```
site/            deployed site (index.html, css, js, data, vendor, lab pages)
  js/core/       data loading + selection store
  js/engine/     3D engine, materials, furniture generators
  js/ui/         interface
  data/          layout, catalog (public), style pack, palette
  vendor/        three.js, three-mesh-bvh, three-gpu-pathtracer (MIT)
research/        sourcing data and research (not deployed)
docs/SPEC.md     contracts and conventions
tools/shoot.mjs  headless screenshot / QA harness
```

## Run locally

```
cd site && python3 -m http.server 8080   # open http://localhost:8080
```

QA screenshots (headless Chrome):

```
NODE_PATH=$(npm root -g) node tools/shoot.mjs --page /index.html --out shots/home.png --wait 9000
```

## Licenses

three.js, three-mesh-bvh and three-gpu-pathtracer are MIT-licensed (© their authors) and vendored
unmodified under `site/vendor/`.
