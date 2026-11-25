// Villar engine — fallback furniture + material library used only while the modeler's
// modules are missing or fail to load. Owner: engine.
// Proxies honour the furniture contract: origin = bottom-centre of footprint, front = +Z,
// userData.anchors / userData.lights, sizes from item.dims (cm → m).
import * as THREE from 'three';

const FALLBACK_COLORS = {
  'walnut-dark': '#4a3426', 'walnut-medium': '#7a5638', 'oak-light': '#c9ae88', 'oak-floor': '#c4a782',
  'porcelain-tile': '#d9d4cc', 'plaster-wall': '#ede7de', paint: '#ede7de', 'kitchen-front': '#d8d0c4',
  'metal-black': '#1c1c1c', 'metal-brass': '#c2a16a', 'metal-chrome': '#e9eaec', travertine: '#d8c6a8',
  'stone-worktop': '#e4e0da', 'ceramic-matte': '#cbb89a', 'glass-clear': '#ffffff', 'lamp-shade': '#ede5d6',
};

export function createFallbackMaterials() {
  const cache = new Map();
  let lampsOn = false;
  const glow = new Set();
  const lib = {
    get(key, opts = {}) {
      const k = key + '|' + (opts.color || '');
      if (cache.has(k)) return cache.get(k);
      const metal = /metal|chrome|brass/.test(key);
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(opts.color || FALLBACK_COLORS[key] || '#cfc8bd'),
        roughness: metal ? 0.35 : 0.8, metalness: metal ? 1 : 0,
      });
      if (/shade|bulb/.test(key)) { m.emissive = new THREE.Color('#ffc98a'); m.emissiveIntensity = 0; m.userData.glow = 1.5; glow.add(m); }
      m.name = key; m.userData.materialKey = key;
      cache.set(k, m);
      return m;
    },
    setLampsOn(on, intensity = 1) { lampsOn = on; for (const m of glow) m.emissiveIntensity = on ? m.userData.glow * intensity : 0; },
    get lampsOn() { return lampsOn; },
    dispose() { for (const m of cache.values()) m.dispose(); cache.clear(); },
    isFallback: true,
  };
  return lib;
}

const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
};

/** Box/primitive proxy for a catalog item. */
export function buildProxy(item, { materials }) {
  const g = new THREE.Group();
  const d = item.dims || { w: 50, d: 50, h: 50 };
  const W = d.w / 100, D = d.d / 100, H = d.h / 100;
  const p = item.model?.params || {};
  const color = item.colorHex || '#cfc8bd';
  const fab = materials.get(p.fabric ? 'fabric-' + p.fabric : 'fabric-linen', { color: p.fabricColor || color });
  const wood = materials.get(p.wood || p.frame || p.top || 'walnut-dark');
  const anchors = { top: new THREE.Vector3(0, H, 0) };
  const lights = [];
  switch (item.type) {
    case 'sofa': case 'armchair': {
      g.add(box(W, H * 0.45, D, fab, 0, 0.12, 0));
      g.add(box(W, H * 0.55, D * 0.22, fab, 0, 0.12 + H * 0.3, -D * 0.39));
      g.add(box(W * 0.98, 0.12, D * 0.9, wood, 0, 0, 0));
      anchors.seat = new THREE.Vector3(0, 0.12 + H * 0.45, 0.02);
      break;
    }
    case 'bed': {
      g.add(box(W, 0.28, D, wood));
      g.add(box(W, H, 0.08, materials.get('fabric-boucle', { color: p.headboardColor || '#E8E1D5' }), 0, 0, -D / 2 + 0.04));
      anchors.deck = new THREE.Vector3(0, 0.28, 0.04);
      break;
    }
    case 'mattress': g.add(box(W, H, D, materials.get('fabric-cotton', { color: '#f4f1ea' }))); break;
    case 'bedding': {
      g.add(box(W * 0.75, 0.05, D * 0.72, materials.get('fabric-cotton', { color: p.duvetColor || '#F2EFE9' }), 0, 0, 0.18));
      g.add(box(W * 0.7, 0.14, 0.4, materials.get('fabric-linen', { color: '#ece7de' }), 0, 0, -D * 0.33));
      break;
    }
    case 'rug': g.add(box(W, Math.max(0.008, H), D, materials.get('wool-rug', { color: p.color || color }))); break;
    case 'wall_art': {
      const art = box(W, H, D, wood); art.position.set(0, 0, D / 2); g.add(art);
      break;
    }
    case 'pendant_lamp': {
      const drop = p.drop || 0.75;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, drop, 6), materials.get('metal-black'));
      cord.position.y = -drop / 2; g.add(cord);
      const shade = new THREE.Mesh(new THREE.SphereGeometry(W / 2, 32, 16), materials.get('paper-shade', { color: p.color }));
      shade.position.y = -drop - W / 2; g.add(shade);
      lights.push({ type: 'point', position: [0, -drop - W / 2, 0], color: '#ffd8a8', intensity: 1, distance: 6 });
      break;
    }
    case 'table_lamp': case 'floor_lamp': {
      const shadeH = Math.min(0.32, H * 0.4);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, H - shadeH, 8), materials.get(p.base || 'metal-black'));
      base.position.y = (H - shadeH) / 2; g.add(base);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(W / 2 * 0.9, W / 2, shadeH, 32, 1, true), materials.get('lamp-shade', { color: p.shadeColor }));
      shade.position.y = H - shadeH / 2; g.add(shade);
      lights.push({ type: 'point', position: [0, H - shadeH / 2, 0], color: '#ffd8a8', intensity: 1, distance: 4 });
      break;
    }
    case 'curtains': {
      const pw = W / 2, mat = materials.get('fabric-linen', { color: p.color || '#E9E2D4' });
      const hgt = 2.82;
      g.add(box(0.9, hgt, 0.06, mat, -1.55, 0, 0));
      g.add(box(0.9, hgt, 0.06, mat, 1.55, 0, 0));
      void pw;
      break;
    }
    case 'plant': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.28, W * 0.22, 0.4, 24), materials.get('ceramic-matte', { color: p.potColor }));
      pot.position.y = 0.2; g.add(pot);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(W * 0.5, 1), materials.get('plant-leaf', { color: '#6f7d4f' }));
      crown.position.y = H - W * 0.5; g.add(crown);
      break;
    }
    case 'cushions': {
      const n = p.count || 3, cols = p.colors || ['#7A7B55', '#B5653F', '#E6DDCF'];
      for (let i = 0; i < n; i++) {
        const c = box(W, H, D, materials.get('fabric-linen', { color: cols[i % cols.length] }), (i - (n - 1) / 2) * (W + 0.15), 0, -0.2);
        c.rotation.x = -0.25; g.add(c);
      }
      break;
    }
    default: {
      const mat = /table|unit|nightstand|chair/.test(item.type) ? wood : fab;
      g.add(box(W, H, D, mat));
    }
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.anchors = anchors;
  g.userData.lights = lights;
  g.userData.proxy = true;
  return g;
}
