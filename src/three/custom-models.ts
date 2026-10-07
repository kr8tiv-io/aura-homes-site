/*
  Drop-in GLB slots. Matt adds a file under public/models/custom and the
  next build uses it. The manifest lists only files that are on disk.
  A missing name makes no request and stays on the procedural model.
  Nothing here mounts the A-frame. That slot is only prepared.
*/
import * as THREE from 'three';
import { CUSTOM_FILES } from 'virtual:aura-custom-models';
import { ktx2Loader, loadModel, whenKtx2 } from './loaders';
import { qualityProfile, type QualityTier } from './quality';
import { phoneAssetDiet } from './tier-assets';

export const CUSTOM_NAMES = ['aura-unit', 'hot-tub', 'gazebo', 'a-frame'] as const;
export type CustomName = (typeof CUSTOM_NAMES)[number];

export const CUSTOM_BUDGET_BYTES = 8 * 1024 * 1024;
export const CUSTOM_TEXTURE_EDGE = 2048;

/** Metres the named axis is scaled to. Length is Z, width is X, span is the larger. */
export const CUSTOM_FIT: Record<CustomName, { meters: number; measure: 'length' | 'width' | 'span' }> = {
  'aura-unit': { meters: 6, measure: 'length' },
  'hot-tub': { meters: 1.8, measure: 'width' },
  gazebo: { meters: 3, measure: 'span' },
  'a-frame': { meters: 6, measure: 'length' },
};

const WOOD_TINT: Record<CustomName, { tint: [number, number, number]; ao: number }> = {
  'aura-unit': { tint: [1.42, 1.02, 0.66], ao: 0.42 },
  'hot-tub': { tint: [1.62, 1.08, 0.68], ao: 0.18 },
  gazebo: { tint: [1.32, 0.9, 0.58], ao: 0.35 },
  'a-frame': { tint: [1.42, 1.02, 0.66], ao: 0.42 },
};

type Level = '' | '.lod1' | '.lod2';

const BY_TIER: Record<QualityTier, Level[]> = {
  off: ['.lod2', '.lod1', ''],
  low: ['.lod2', '.lod1', ''],
  medium: ['.lod1', '', '.lod2'],
  high: ['', '.lod1', '.lod2'],
  ultra: ['', '.lod1', '.lod2'],
};

const GLASS = /polycarbonate|glass/i;
const WATER = /water/i;
const WOOD = /cedar|wood|oak|timber/i;
const STEEL = /steel|metal|iron/i;

export type CustomHooks = {
  /** One polycarbonate material per named glass slot. The caller owns disposal. */
  polycarbonate?: () => THREE.Material;
  /** Shared tub water. The caller owns disposal and the time uniform. */
  water?: () => THREE.Material;
};

export type PlacedCustom = {
  object: THREE.Object3D;
  /** Cloned cedar and steel materials. Hook materials are not included. */
  materials: THREE.Material[];
  release: () => void;
};

export type ResolvedCustom = {
  url: string;
  bytes: number | null;
  /** `full`, `lod1`, or `lod2`. */
  level: string;
};

export function isCustomName(value: string): value is CustomName {
  return (CUSTOM_NAMES as readonly string[]).includes(value);
}

function asset(file: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + file.replace(/^\//, '');
}

function fileFor(name: CustomName, level: Level) {
  return asset(`models/custom/${name}${level}.glb`);
}

const known = new Map(CUSTOM_FILES.map((entry) => [entry.file, entry.bytes]));

/**
 * Picks a file from the build manifest. Nothing is fetched for a name that
 * is not on disk. `full` prefers the optimized source, then lod1, then lod2.
 * `quality` follows the current tier and falls back the other way.
 */
export async function resolveCustom(name: CustomName, prefer: 'quality' | 'full' = 'quality'): Promise<ResolvedCustom | null> {
  const order: Level[] =
    prefer === 'full'
      ? ['', '.lod1', '.lod2']
      : phoneAssetDiet()
        ? ['.lod2', '.lod1', '']
        : BY_TIER[qualityProfile().tier];
  for (const level of order) {
    const file = `${name}${level}.glb`;
    if (!known.has(file)) continue;
    return {
      url: fileFor(name, level),
      bytes: known.get(file) ?? null,
      level: level === '' ? 'full' : level.slice(1),
    };
  }
  return null;
}

/** Clone of the cached GLB, or null when every variant is absent. */
export async function loadCustomModel(name: CustomName, prefer: 'quality' | 'full' = 'quality'): Promise<THREE.Object3D | null> {
  const chosen = await resolveCustom(name, prefer);
  if (!chosen) return null;
  try {
    const gltf = await loadModel(chosen.url);
    return gltf.scene.clone(true);
  } catch {
    return null;
  }
}

function measureOf(size: THREE.Vector3, measure: 'length' | 'width' | 'span') {
  if (measure === 'width') return size.x > 0.05 ? size.x : Math.max(size.x, size.z);
  if (measure === 'length') return size.z > 0.05 ? size.z : Math.max(size.x, size.z);
  return Math.max(size.x, size.z);
}

function fitToFootprint(root: THREE.Object3D, name: CustomName) {
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const fit = CUSTOM_FIT[name];
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const measured = measureOf(size, fit.measure);
  if (measured > 1e-4) {
    root.scale.multiplyScalar(fit.meters / measured);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
  }
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
}

type PbrPack = {
  diff: THREE.Texture;
  nor: THREE.Texture;
  rough: THREE.Texture;
  ao: THREE.Texture;
};

const packs = new Map<string, Promise<PbrPack>>();

function loadPack(folder: 'fine_grained_wood' | 'metal_plate'): Promise<PbrPack> {
  const cached = packs.get(folder);
  if (cached) return cached;
  const pending = whenKtx2()
    .then(() =>
      Promise.all([
        ktx2Loader.loadAsync(asset(`textures/${folder}/diff.ktx2`)),
        ktx2Loader.loadAsync(asset(`textures/${folder}/nor_gl.ktx2`)),
        ktx2Loader.loadAsync(asset(`textures/${folder}/rough.ktx2`)),
        ktx2Loader.loadAsync(asset(`textures/${folder}/ao.ktx2`)),
      ]),
    )
    .then(([diff, nor, rough, ao]) => {
      const tune = (tex: THREE.Texture, colorSpace: THREE.ColorSpace) => {
        tex.colorSpace = colorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 2);
        tex.anisotropy = 8;
        return tex;
      };
      tune(diff, THREE.SRGBColorSpace);
      tune(nor, THREE.NoColorSpace);
      tune(rough, THREE.NoColorSpace);
      tune(ao, THREE.NoColorSpace);
      return { diff, nor, rough, ao };
    });
  packs.set(folder, pending);
  pending.catch(() => {
    if (packs.get(folder) === pending) packs.delete(folder);
  });
  return pending;
}

function ensureUv2(mesh: THREE.Mesh) {
  const geo = mesh.geometry;
  if (!geo || geo.getAttribute('uv2') || !geo.getAttribute('uv')) return;
  geo.setAttribute('uv2', geo.getAttribute('uv'));
}

function asStandard(mat: THREE.Material, owned: THREE.Material[]): THREE.MeshStandardMaterial | null {
  const mapped = mat as THREE.MeshStandardMaterial;
  if (mapped.map) return null;
  if (mapped.isMeshStandardMaterial) {
    const clone = mapped.clone();
    clone.vertexColors = false;
    const physical = clone as THREE.MeshPhysicalMaterial;
    if (physical.isMeshPhysicalMaterial) {
      physical.transmission = 0;
      physical.thickness = 0;
    }
    owned.push(clone);
    return clone;
  }
  const basic = mat as THREE.MeshBasicMaterial;
  if (!basic.isMeshBasicMaterial && !(mat as THREE.MeshLambertMaterial).isMeshLambertMaterial) return null;
  const created = new THREE.MeshStandardMaterial({ color: basic.color });
  owned.push(created);
  return created;
}

/**
 * Uniform scale, ground at y = 0, centre on XZ, shadows, and named materials.
 * Mutates `root`. Pass the clone from loadCustomModel, not the loader cache.
 * Cedar and steel maps replace an untextured base colour so it is not multiplied dark under the texture.
 */
export function placeCustomModel(root: THREE.Object3D, name: CustomName, hooks: CustomHooks = {}): PlacedCustom {
  fitToFootprint(root, name);
  root.name = name === 'aura-unit' ? 'AuraUnitModel' : `Custom${name}`;
  const owned: THREE.Material[] = [];
  const wood: THREE.MeshStandardMaterial[] = [];
  const steel: THREE.MeshStandardMaterial[] = [];
  const uvMeshes: THREE.Mesh[] = [];
  let live = true;

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let glass = false;
    let water = false;
    const next = list.map((mat) => {
      if (!mat) return mat;
      const label = `${mesh.name} ${mat.name}`;
      if (GLASS.test(label)) {
        glass = true;
        if (hooks.polycarbonate) return hooks.polycarbonate();
      }
      if (WATER.test(label)) {
        water = true;
        if (hooks.water) return hooks.water();
      }
      if (WOOD.test(label)) {
        const standard = asStandard(mat, owned);
        if (standard) {
          wood.push(standard);
          uvMeshes.push(mesh);
          return standard;
        }
      }
      if (STEEL.test(label)) {
        const standard = asStandard(mat, owned);
        if (standard) {
          steel.push(standard);
          uvMeshes.push(mesh);
          return standard;
        }
      }
      return mat;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
    const clear = glass || water;
    mesh.castShadow = !clear;
    mesh.receiveShadow = !clear;
    if (glass) mesh.renderOrder = 10;
    else if (water) mesh.renderOrder = 4;
  });

  for (const mesh of uvMeshes) ensureUv2(mesh);

  const paint = (
    mats: THREE.MeshStandardMaterial[],
    pack: PbrPack,
    tint: [number, number, number],
    ao: number,
    metalness: number,
    roughness: number,
    normal: number,
    env: number,
  ) => {
    if (!live) return;
    for (const mat of mats) {
      mat.map = pack.diff;
      mat.normalMap = pack.nor;
      mat.roughnessMap = pack.rough;
      mat.aoMap = pack.ao;
      mat.aoMapIntensity = ao;
      mat.normalScale.set(normal, normal);
      mat.color.setRGB(tint[0], tint[1], tint[2]);
      mat.metalness = metalness;
      mat.roughness = roughness;
      mat.envMapIntensity = env;
      mat.vertexColors = false;
      mat.needsUpdate = true;
    }
  };

  if (wood.length) {
    const look = WOOD_TINT[name];
    void loadPack('fine_grained_wood')
      .then((pack) => paint(wood, pack, look.tint, look.ao, 0.02, 0.68, 0.55, 0.22))
      .catch(() => undefined);
  }
  if (steel.length) {
    void loadPack('metal_plate')
      .then((pack) => paint(steel, pack, [1, 1, 1], 0.8, 0.86, 0.62, 1, 0.45))
      .catch(() => undefined);
  }

  return {
    object: root,
    materials: owned,
    release() {
      live = false;
      for (const mat of owned) mat.dispose();
      owned.length = 0;
    },
  };
}
