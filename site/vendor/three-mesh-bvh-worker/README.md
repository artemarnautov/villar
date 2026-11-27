Worker-only copy of three-mesh-bvh (MIT, see LICENSE) — the import closure of `workers/generateMeshBVH.worker.js`,
with the bare `'three'` specifier rewritten to `/vendor/three/three.module.js` (import maps don't apply inside
workers). Used by the engine's path tracer to build the scene BVH off the main thread (`js/engine/photo.js`).
Regenerate from `../three-mesh-bvh/src` when that is updated.
