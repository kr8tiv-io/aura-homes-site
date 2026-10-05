/*
  Pine, spruce, and aspen variants baked from EZ-Tree, scattered with
  InstancedMesh2. Past 60 m they swap to hemi-octahedral impostors.
*/
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { InstancedMesh2 } from '@three.ez/instanced-mesh';
import { loadModel } from '../loaders';
import { applyHeightFog } from './height-fog';
import { sampleMeadowClearance, sampleTerrainHeight } from './meadow/field';
import { bakeHemiImpostor } from './impostor';

const VARIANTS = ['meadow-pine-a', 'meadow-pine-b', 'meadow-spruce-a', 'meadow-spruce-b', 'meadow-aspen-a', 'meadow-aspen-b'];
const HEIGHTS = [5.4, 4.6, 6.1, 5.2, 4.8, 3.9];

const SCATTER: { pos: [number, number, number]; rotY?: number; scale?: number }[] = [
  { pos: [-23, 0, -14], rotY: 0.3, scale: 1.3 },
  { pos: [20, 0, -18], rotY: 1.2, scale: 1.35 },
  { pos: [-11, 0, -24], rotY: 2.1, scale: 1.5 },
  { pos: [28, 0, -8], rotY: 0.6, scale: 1.25 },
  { pos: [-31, 0, -4], rotY: 2.8, scale: 1.4 },
  { pos: [4, 0, -26], rotY: 5.0, scale: 1.6 },
  { pos: [30, 0, -24], rotY: 3.4, scale: 1.8 },
  { pos: [-33, 0, -20], rotY: 1.7, scale: 1.85 },
  { pos: [-26, 0, 16], rotY: 0.9, scale: 1.1 },
  { pos: [30, 0, 14], rotY: 5.6, scale: 1.15 },
  { pos: [-17, 0, -33], rotY: 4.1, scale: 1.9 },
  { pos: [15, 0, -34], rotY: 0.2, scale: 2.0 },
  { pos: [-13, 0, 27], rotY: 2.4, scale: 1.05 },
  { pos: [15, 0, 28], rotY: 3.9, scale: 1.1 },
  { pos: [-9, 0, 33], rotY: 1.4, scale: 1.0 },
  { pos: [10, 0, 34], rotY: 4.6, scale: 0.95 },
  { pos: [-10.5, 0, -5], rotY: 0.4, scale: 1 },
  { pos: [9.5, 0, -4.5], rotY: 1.9, scale: 0.9 },
  { pos: [-13.5, 0, 5.5], rotY: 3.1, scale: 1.1 },
  { pos: [5, 0, -10], rotY: 2.2, scale: 1.05 },
  { pos: [-5.5, 0, -11.5], rotY: 4.4, scale: 0.9 },
  { pos: [14.5, 0, -10], rotY: 5.1, scale: 1.2 },
  { pos: [12.5, 0, 15.5], rotY: 1.1, scale: 0.85 },
  { pos: [-11.5, 0, 17.5], rotY: 4.9, scale: 0.9 },
  { pos: [-6.5, 0, 24.5], rotY: 2.6, scale: 0.8 },
  { pos: [9, 0, 25.5], rotY: 5.7, scale: 0.75 },
  { pos: [-5, 0, 28.5], rotY: 1.3, scale: 0.85 },
  { pos: [6, 0, 29.5], rotY: 3.8, scale: 0.7 },
];

const PROPS: { file: string; height: number; pos: [number, number]; rot: number }[] = [
  { file: 'fern_02.glb', height: 0.55, pos: [3.4, 2.1], rot: 0.4 },
  { file: 'fern_02.glb', height: 0.42, pos: [-3.6, 0.6], rot: 2.2 },
  { file: 'rock_moss_set_01.glb', height: 0.48, pos: [8.3, 3.2], rot: 1.1 },
  { file: 'tree_stump_01.glb', height: 0.38, pos: [-3.9, -4.4], rot: 0.7 },
  { file: 'dandelion_01.glb', height: 0.22, pos: [2.9, 4.7], rot: 0.2 },
  { file: 'dandelion_01.glb', height: 0.18, pos: [-2.5, 4.9], rot: 1.6 },
];

function asset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\//, '');
}

function normalizeHeight(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  geometry.translate(-center.x, -box.min.y, -center.z);
  const height = size.y || 1;
  geometry.scale(1 / height, 1 / height, 1 / height);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Quantized glTF positions clamp if a node scale is written back into the integer buffer. */
function asFloat3(geometry: THREE.BufferGeometry, name: string) {
  const attribute = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (!attribute) return;
  if (!attribute.normalized && attribute.array instanceof Float32Array) return;
  const floats = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i += 1) {
    const offset = i * attribute.itemSize;
    floats[offset] = attribute.getX(i);
    floats[offset + 1] = attribute.getY(i);
    if (attribute.itemSize > 2) floats[offset + 2] = attribute.getZ(i);
    if (attribute.itemSize > 3) floats[offset + 3] = attribute.getW(i);
  }
  geometry.setAttribute(name, new THREE.BufferAttribute(floats, attribute.itemSize));
}

function paintedGeometry(mesh: THREE.Mesh) {
  const source = mesh.geometry;
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  asFloat3(geometry, 'position');
  asFloat3(geometry, 'normal');
  const material = mesh.material as THREE.MeshStandardMaterial;
  const color = material?.color ? material.color : new THREE.Color('#6a7a48');
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

async function loadVariant(name: string, level: '' | '.lod1' | '.lod2') {
  const gltf = await loadModel(asset(`models/${name}${level}.glb`));
  const parts: THREE.BufferGeometry[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = paintedGeometry(mesh);
    geometry.applyMatrix4(mesh.matrixWorld);
    parts.push(geometry);
  });
  if (!parts.length) return null;
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!merged) return null;
  if (parts.length > 1) parts.forEach((part) => part.dispose());
  return normalizeHeight(merged);
}

function treeMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
  });
  applyHeightFog(material);
  return material;
}

export type GroveHandle = {
  claimRenderer: (renderer: THREE.WebGLRenderer) => void;
};

export function mountGoldenGrove(
  scene: THREE.Scene,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
  textures: THREE.Texture[],
  alive: () => boolean,
  onEmpty?: () => void,
  heightAt: (x: number, z: number) => number = sampleTerrainHeight,
  clear?: { x: number; z: number; r: number },
  props = true,
): GroveHandle {
  const pending: { mesh: InstancedMesh2; source: THREE.Mesh }[] = [];
  const baked = new Set<InstancedMesh2>();
  let loadsDone = false;

  const count = Math.max(6, Math.round(SCATTER.length * 0.85));
  const groups = VARIANTS.map(() => [] as { x: number; y: number; z: number; rot: number; scale: number }[]);
  SCATTER.slice(0, count).forEach((spot, index) => {
    if (sampleMeadowClearance(spot.pos[0], spot.pos[2]) < 0.35) return;
    if (clear) {
      const dx = spot.pos[0] - clear.x;
      const dz = spot.pos[2] - clear.z;
      if (dx * dx + dz * dz < clear.r * clear.r) return;
    }
    const variant = index % VARIANTS.length;
    const height = HEIGHTS[variant] * (spot.scale ?? 1);
    groups[variant].push({
      x: spot.pos[0],
      y: heightAt(spot.pos[0], spot.pos[2]),
      z: spot.pos[2],
      rot: spot.rotY ?? 0,
      scale: height,
    });
  });

  void Promise.all(
    VARIANTS.map(async (name, index) => {
      const spots = groups[index];
      if (!spots.length || !alive()) return;
      try {
      const [full, mid, far] = await Promise.all([
        loadVariant(name, '').catch(() => null),
        loadVariant(name, '.lod1').catch(() => null),
        loadVariant(name, '.lod2').catch(() => null),
      ]);
      if (!alive() || !full) return;
      geometries.push(full);
      if (mid) geometries.push(mid);
      if (far) geometries.push(far);
      const material = treeMaterial();
      const midMaterial = treeMaterial();
      const farMaterial = treeMaterial();
      materials.push(material, midMaterial, farMaterial);
      const mesh = new InstancedMesh2(full, material, { capacity: spots.length });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = name;
      if (mid) mesh.addLOD(mid, midMaterial, 28);
      if (far) mesh.addLOD(far, farMaterial, 46);
      const up = new THREE.Vector3(0, 1, 0);
      mesh.addInstances(spots.length, (obj, spotIndex) => {
        const spot = spots[spotIndex];
        obj.position.set(spot.x, spot.y, spot.z);
        obj.quaternion.setFromAxisAngle(up, spot.rot);
        obj.scale.setScalar(spot.scale);
      });
      scene.add(mesh);
      const source = new THREE.Mesh(full, material);
      pending.push({ mesh, source });
      } catch {
        return;
      }
    }),
  ).then(() => {
    loadsDone = true;
    if (alive() && baked.size === 0 && pending.length === 0) onEmpty?.();
  }).catch(() => {
    loadsDone = true;
    if (alive()) onEmpty?.();
  });

  if (props) placeGoldenProps(scene, geometries, materials, alive);

  return {
    claimRenderer(renderer) {
      for (const item of pending) {
        if (baked.has(item.mesh)) continue;
        const card = bakeHemiImpostor(renderer, item.source);
        geometries.push(card.geometry);
        materials.push(card.material);
        textures.push(card.texture);
        applyHeightFog(card.material);
        item.mesh.addLOD(card.geometry, card.material, 60);
        card.target.dispose();
        baked.add(item.mesh);
      }
      if (loadsDone) pending.length = 0;
    },
  };
}

export function placeGoldenProps(
  scene: THREE.Scene,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
  alive: () => boolean,
) {
  for (const prop of PROPS) {
    if (sampleMeadowClearance(prop.pos[0], prop.pos[1]) < 0.4) continue;
    void loadModel(asset(`models/${prop.file}`)).then((gltf) => {
      if (!alive()) return;
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = prop.height / (size.y || 1);
      const clone = gltf.scene.clone(true);
      clone.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const source = mesh.material as THREE.MeshStandardMaterial;
        if (source?.isMeshStandardMaterial) {
          const next = source.clone();
          next.roughness = Math.max(source.roughness, 0.72);
          applyHeightFog(next);
          mesh.material = next;
          materials.push(next);
        }
      });
      const y = sampleTerrainHeight(prop.pos[0], prop.pos[1]) - box.min.y * scale;
      clone.position.set(prop.pos[0], y, prop.pos[1]);
      clone.scale.setScalar(scale);
      clone.rotation.y = prop.rot;
      clone.name = prop.file;
      scene.add(clone);
    }).catch(() => undefined);
  }
  void geometries;
}
