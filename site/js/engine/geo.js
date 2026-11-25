// Villar engine — geometry helpers for static architecture: world-UV boxes (metres) and a
// per-material batcher that merges everything into one draw call per material. Owner: engine.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Axis-aligned box from world extents with UVs in metres on every face (u/v follow the face so
 * textures are never mirrored or stretched). `uvSwap` swaps u/v on horizontal faces (e.g. planks).
 */
export function boxGeometry(x0, x1, y0, y1, z0, z1, { uvSwap = false, skip = '' } = {}) {
  const pos = [], nor = [], uv = [], idx = [];
  const face = (n, verts, uvs) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(...verts[i]); nor.push(...n); uv.push(...uvs[i]); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const H = (u, v) => (uvSwap ? [v, u] : [u, v]);
  // +X  (u = -z, v = y)
  if (!skip.includes('px')) face([1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
  // -X  (u = z, v = y)
  if (!skip.includes('nx')) face([-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
  // +Y  (u = x, v = -z)
  if (!skip.includes('py')) face([0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [H(x0, -z1), H(x1, -z1), H(x1, -z0), H(x0, -z0)]);
  // -Y  (u = x, v = z)
  if (!skip.includes('ny')) face([0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [H(x0, z0), H(x1, z0), H(x1, z1), H(x0, z1)]);
  // +Z  (u = x, v = y)
  if (!skip.includes('pz')) face([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  // -Z  (u = -x, v = y)
  if (!skip.includes('nz')) face([0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Normalise an arbitrary geometry to position/normal/uv, indexed, for merging. */
export function normalizeGeometry(g) {
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(idx);
  }
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  return g;
}

/** Collects geometries per material and merges them into one mesh per (material, flags). */
export class Batcher {
  constructor() { this.buckets = new Map(); }
  add(material, geometry, { cast = true, receive = true, userData = null, name = '' } = {}) {
    const key = material.uuid + (cast ? 'c' : '') + (receive ? 'r' : '') + (userData ? JSON.stringify(userData) : '');
    if (!this.buckets.has(key)) this.buckets.set(key, { material, cast, receive, userData, name, list: [] });
    this.buckets.get(key).list.push(normalizeGeometry(geometry));
  }
  build(group = new THREE.Group()) {
    for (const b of this.buckets.values()) {
      const merged = b.list.length === 1 ? b.list[0] : mergeGeometries(b.list, false);
      if (b.list.length > 1) for (const g of b.list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      mesh.name = b.name || b.material.name || 'arch';
      if (b.userData) Object.assign(mesh.userData, b.userData);
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

/** Cylinder whose axis is Y, base at y0, in world coords. */
export function cylinderY(x, z, y0, h, r, seg = 24, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg);
  g.translate(x, y0 + h / 2, z);
  return g;
}

/** Cylinder between two world points. */
export function cylinderBetween(a, b, r, seg = 16) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
