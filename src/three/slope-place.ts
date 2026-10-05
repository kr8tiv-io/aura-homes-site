/*
  The glass passage slope: a cedar deck on helical steel piles,
  with the Aura unit standing on the deck.
*/
import * as THREE from 'three';
import { ktx2Loader, whenKtx2 } from './loaders';
import { anisotropyForTier, applyMacro } from './surfaces';
import { createAuraUnit, type AuraUnit } from './aura-unit';
import { sampleTerrainHeight } from './meadow-v1/meadow/field';

export type SlopePlace = {
  object: THREE.Group;
  dispose: () => void;
};

const DECK_Y = 4.55;
const DECK_Z = -7;

/** Meadow height, plus a ridge that climbs toward -Z and eases off to the sides. */
export function slopeHeight(x: number, z: number): number {
  const base = sampleTerrainHeight(x, z) * 0.25;
  const along = Math.max(0, -z - 1.5);
  const climb = Math.min(14, along * 0.42);
  const shoulder = Math.exp(-(x * x) / 260);
  return base + climb * shoulder;
}

export function slopeOrbit(): { p: [number, number, number]; t: [number, number, number]; fov: number }[] {
  return [
    { p: [8.4, 3.4, 5.2], t: [0.1, 4.1, -7], fov: 34 },
    { p: [5.2, 4.15, 1.4], t: [0, 4.35, -7.2], fov: 32 },
    { p: [2.4, 4.7, -2.2], t: [0, 4.5, -7.4], fov: 30 },
  ];
}

function asset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\//, '');
}

function tune(tex: THREE.Texture) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.4, 2.2);
  tex.anisotropy = anisotropyForTier();
  return tex;
}

export function createSlopePlace(): SlopePlace {
  const object = new THREE.Group();
  object.name = 'SlopePlace';
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  let alive = true;

  const metal = new THREE.MeshStandardMaterial({
    color: '#2a3036',
    roughness: 0.58,
    metalness: 0.86,
    envMapIntensity: 0.45,
  });
  const wood = new THREE.MeshStandardMaterial({
    color: '#b88862',
    roughness: 0.72,
    metalness: 0.02,
    envMapIntensity: 0.25,
  });
  mats.push(metal, wood);
  applyMacro(metal);
  applyMacro(wood);

  const pile = (length: number) => {
    const group = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(0.042, 0.05, length, 12);
    geos.push(shaftGeo);
    const shaft = new THREE.Mesh(shaftGeo, metal);
    shaft.position.y = length / 2;
    shaft.castShadow = true;
    group.add(shaft);
    const turns = 4;
    for (let i = 0; i < turns; i += 1) {
      const flightGeo = new THREE.TorusGeometry(0.14, 0.012, 6, 16, Math.PI * 1.7);
      geos.push(flightGeo);
      const flight = new THREE.Mesh(flightGeo, metal);
      flight.rotation.x = Math.PI / 2;
      flight.rotation.z = i * 0.85;
      flight.position.y = 0.16 + i * 0.15;
      flight.castShadow = true;
      group.add(flight);
    }
    const capGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.045, 12);
    geos.push(capGeo);
    const cap = new THREE.Mesh(capGeo, metal);
    cap.position.y = length;
    cap.castShadow = true;
    group.add(cap);
    return group;
  };

  const feet: Array<[number, number]> = [
    [-2.05, -3.05],
    [2.05, -3.05],
    [-2.05, 3.05],
    [2.05, 3.05],
    [-2.05, 0],
    [2.05, 0],
  ];
  for (const [x, z] of feet) {
    const ground = slopeHeight(x, DECK_Z + z);
    const length = Math.max(0.4, DECK_Y - ground);
    const screw = pile(length);
    screw.position.set(x, ground, DECK_Z + z);
    object.add(screw);
  }

  const deckGeo = new THREE.BoxGeometry(4.5, 0.16, 6.7);
  const deckUv = deckGeo.getAttribute('uv');
  if (deckUv) deckGeo.setAttribute('uv2', deckUv);
  geos.push(deckGeo);
  const deck = new THREE.Mesh(deckGeo, wood);
  deck.name = 'CedarDeck';
  deck.position.set(0, DECK_Y, DECK_Z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  object.add(deck);

  const unit: AuraUnit = createAuraUnit();
  unit.object.position.set(0, DECK_Y + 0.08, DECK_Z);
  unit.setMood(0.42);
  object.add(unit.object);

  const drop = (textures: THREE.Texture[]) => {
    for (const tex of textures) tex.dispose();
  };
  const loadSet = (name: string) =>
    whenKtx2().then(() =>
      Promise.all([
        ktx2Loader.loadAsync(asset(`textures/${name}/diff.ktx2`)),
        ktx2Loader.loadAsync(asset(`textures/${name}/nor_gl.ktx2`)),
        ktx2Loader.loadAsync(asset(`textures/${name}/rough.ktx2`)),
        ktx2Loader.loadAsync(asset(`textures/${name}/ao.ktx2`)),
      ]),
    );

  void loadSet('metal_plate').then((maps) => {
    if (!alive) {
      drop(maps);
      return;
    }
    const [diff, nor, rough, ao] = maps;
    for (const tex of maps) tune(tex);
    diff.colorSpace = THREE.SRGBColorSpace;
    nor.colorSpace = THREE.NoColorSpace;
    rough.colorSpace = THREE.NoColorSpace;
    ao.colorSpace = THREE.NoColorSpace;
    texs.push(...maps);
    metal.map = diff;
    metal.normalMap = nor;
    metal.roughnessMap = rough;
    metal.aoMap = ao;
    metal.aoMapIntensity = 0.55;
    metal.needsUpdate = true;
  }).catch(() => undefined);

  void loadSet('weathered_brown_planks').then((maps) => {
    if (!alive) {
      drop(maps);
      return;
    }
    const [diff, nor, rough, ao] = maps;
    for (const tex of maps) {
      tune(tex);
      tex.repeat.set(2.25, 3.35);
    }
    diff.colorSpace = THREE.SRGBColorSpace;
    nor.colorSpace = THREE.NoColorSpace;
    rough.colorSpace = THREE.NoColorSpace;
    ao.colorSpace = THREE.NoColorSpace;
    texs.push(...maps);
    wood.map = diff;
    wood.normalMap = nor;
    wood.roughnessMap = rough;
    wood.aoMap = ao;
    wood.aoMapIntensity = 0.28;
    wood.color.setRGB(1.45, 1.02, 0.68);
    wood.needsUpdate = true;
  }).catch(() => undefined);

  return {
    object,
    dispose() {
      if (!alive) return;
      alive = false;
      unit.dispose();
      object.removeFromParent();
      for (const geo of geos) geo.dispose();
      for (const mat of mats) mat.dispose();
      for (const tex of texs) tex.dispose();
    },
  };
}
