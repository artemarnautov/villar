// Villar engine — hover / click picking. Owner: engine.
// Throttled BVH-accelerated raycasts against furniture (architecture acts as an occluder only).
// Hits are mapped to slots through userData.slotId. Floor hits drive the walk marker.
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export function ensureBVH(root) {
  root.traverse((o) => {
    if (o.isMesh && o.geometry && !o.geometry.boundsTree && o.geometry.attributes.position?.count > 60) {
      try { o.geometry.computeBoundsTree(); } catch { /* non-indexable geometry: fall back to brute force */ }
    }
  });
}

export function createInteraction({ dom, camera, pickRoots, getSlotInfo, onHover, onSelect, onFloorClick, onFloorHover }) {
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const ndc = new THREE.Vector2();
  let pointer = null;        // { x, y } client px
  let dirty = false;
  let last = 0;
  let hovered = null;        // slotId
  let enabled = true;
  const THROTTLE = 45;       // ms

  function pick(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    raycaster.far = 60;
    const hits = raycaster.intersectObjects(pickRoots(), true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      const m = h.object.material;
      if (m && m.transparent && m.opacity < 0.5) continue; // see through glass
      if (h.object.userData.noPick) continue;
      let o = h.object;
      while (o && !o.userData.slotId && o.parent) o = o.parent;
      if (o && o.userData.slotId) return { slotId: o.userData.slotId, point: h.point, object: h.object };
      const surf = h.object.userData.surface;
      return { slotId: null, floor: surf === 'floor' && h.face && h.face.normal.y > 0.5, point: h.point };
    }
    return null;
  }

  function onMove(e) {
    if (e.pointerType === 'touch') return; // no hover on touch
    pointer = { x: e.clientX, y: e.clientY };
    dirty = true;
  }
  function onLeave() {
    pointer = null; dirty = false;
    if (hovered) { hovered = null; onHover(null); }
    onFloorHover?.(null);
    dom.style.cursor = '';
  }

  /** Called every frame by the engine. */
  function update(now, busy) {
    if (!enabled || !dirty || !pointer || now - last < THROTTLE) return;
    if (busy) { // while dragging the view: no hover feedback
      if (hovered) { hovered = null; onHover(null); }
      onFloorHover?.(null);
      return;
    }
    dirty = false; last = now;
    const hit = pick(pointer.x, pointer.y);
    const id = hit?.slotId || null;
    if (id) {
      const info = getSlotInfo(id);
      hovered = id;
      onHover(info ? { ...info, x: pointer.x, y: pointer.y } : null);
      dom.style.cursor = 'pointer';
      onFloorHover?.(null);
    } else {
      if (hovered) { hovered = null; onHover(null); }
      dom.style.cursor = '';
      onFloorHover?.(hit && hit.floor ? hit.point : null);
    }
  }

  function click(e) {
    if (!enabled) return;
    const hit = pick(e.clientX, e.clientY);
    if (hit && hit.slotId) {
      const info = getSlotInfo(hit.slotId);
      onSelect(info ? { ...info, x: e.clientX, y: e.clientY } : null);
    } else if (hit && hit.floor) {
      onFloorClick?.(hit.point);
      onSelect(null);
    } else onSelect(null);
  }

  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerleave', onLeave);

  return {
    update, click, pick,
    get hovered() { return hovered; },
    setEnabled(v) { enabled = v; if (!v) onLeave(); },
    refresh() { dirty = !!pointer; },
    dispose() { dom.removeEventListener('pointermove', onMove); dom.removeEventListener('pointerleave', onLeave); },
  };
}
