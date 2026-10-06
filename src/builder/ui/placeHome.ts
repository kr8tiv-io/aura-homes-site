/**
 * The ported home, drawn with the builder geometry inside the meadow slot.
 * Glass uses the site polycarbonate. The cedar tub uses the site hot tub.
 */
import * as THREE from 'three';
import { applyGlazeFinish, createPolycarbonateMaterial, type GlazeFinish } from '../../three/aura-unit';
import { createHotTub, type HotTub, type TubFrame } from '../../three/hot-tub';
import type { BuilderDocument } from '../core/document';
import {
  buildFixtureGeometry,
  disposeFixtureGeometry,
  resolveFixtures,
  type FixtureGeometry,
} from '../core/fixtures';
import { buildHome, disposeHome, type HomeGeometry, type Part } from '../core/geometry';

const FEET_TO_METRES = 0.3048;

const SOLID: Record<string, { color: string; roughness: number; metalness: number }> = {
  wall: { color: '#e7e1d5', roughness: 0.94, metalness: 0 },
  floor: { color: '#c4a07a', roughness: 0.74, metalness: 0 },
  roof: { color: '#2c2926', roughness: 0.55, metalness: 0.18 },
  trim: { color: '#9c7a55', roughness: 0.62, metalness: 0.12 },
  door: { color: '#6a5442', roughness: 0.82, metalness: 0 },
  frame: { color: '#3a3835', roughness: 0.45, metalness: 0.35 },
  sill: { color: '#b9b1a6', roughness: 0.9, metalness: 0 },
  pile: { color: '#6c7370', roughness: 0.6, metalness: 0.35 },
  deck: { color: '#a97e57', roughness: 0.86, metalness: 0 },
};

export type PlacedHome = {
  update: (document: BuilderDocument, glaze: GlazeFinish) => void;
  tick: (frame: TubFrame) => void;
  dispose: () => void;
};

function solidMesh(part: Part, materials: THREE.Material[]): THREE.Mesh {
  const look = SOLID[part.surface] ?? { color: '#d9d3c7', roughness: 0.8, metalness: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: look.color,
    roughness: look.roughness,
    metalness: look.metalness,
  });
  materials.push(material);
  const mesh = new THREE.Mesh(part.geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function attachHome(parent: THREE.Object3D): PlacedHome {
  const root = new THREE.Group();
  root.name = 'PortedHome';
  parent.add(root);
  let home: HomeGeometry | null = null;
  let fixtures: FixtureGeometry | null = null;
  let tub: HotTub | null = null;
  const materials: THREE.Material[] = [];

  const clear = () => {
    disposeHome(home);
    disposeFixtureGeometry(fixtures);
    tub?.dispose();
    for (const material of materials) material.dispose();
    materials.length = 0;
    home = null;
    fixtures = null;
    tub = null;
    root.clear();
  };

  return {
    update(document, glaze) {
      clear();
      home = buildHome(document.spec);
      const shell = new THREE.Group();
      shell.name = 'HomeShell';
      shell.scale.setScalar(FEET_TO_METRES);
      const showTub =
        document.spec.deck?.hotTub === true || document.fixtures.items.some((item) => item.kind === 'hot-tub');
      let glass: THREE.MeshPhysicalMaterial | null = null;
      const addPart = (part: Part, group: THREE.Group) => {
        if (showTub && (part.surface === 'tub' || part.surface === 'water')) return;
        if (part.surface === 'glass') {
          if (!glass) {
            glass = createPolycarbonateMaterial();
            applyGlazeFinish(glass, glaze);
            materials.push(glass);
          }
          const mesh = new THREE.Mesh(part.geometry, glass);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          group.add(mesh);
          return;
        }
        group.add(solidMesh(part, materials));
      };
      for (const volume of home.volumes) {
        const group = new THREE.Group();
        group.position.set(volume.origin[0], volume.origin[1], volume.origin[2]);
        group.rotation.y = volume.rotationY;
        for (const part of volume.parts) addPart(part, group);
        shell.add(group);
      }
      if (home.deck) {
        const group = new THREE.Group();
        group.position.set(home.deck.origin[0], home.deck.origin[1], home.deck.origin[2]);
        group.rotation.y = home.deck.rotationY;
        for (const part of home.deck.parts) addPart(part, group);
        shell.add(group);
      }
      const resolved = resolveFixtures(document.spec, document.fixtures);
      fixtures = buildFixtureGeometry(resolved, { clearances: false });
      const skip = new Set(
        resolved.items.filter((item) => item.kind.id === 'hot-tub').map((item) => item.fixture.id),
      );
      for (const group of fixtures.groups) {
        if (skip.has(group.id)) continue;
        const host = new THREE.Group();
        host.position.set(group.frame.origin[0], group.frame.origin[1], group.frame.origin[2]);
        host.rotation.y = group.frame.rotationY;
        const local = new THREE.Group();
        local.position.set(group.position[0], group.position[1], group.position[2]);
        local.rotation.set(group.rotation[0], group.rotation[1], group.rotation[2]);
        for (const part of group.parts) {
          const look = SOLID[part.surface] ?? { color: '#9c7a55', roughness: 0.7, metalness: 0.05 };
          const material = new THREE.MeshStandardMaterial(look);
          materials.push(material);
          local.add(new THREE.Mesh(part.geometry, material));
        }
        host.add(local);
        shell.add(host);
      }
      root.add(shell);
      if (showTub) {
        tub = createHotTub();
        tub.object.position.set(1.7, 0, 1.15);
        root.add(tub.object);
      }
    },
    tick(frame) {
      tub?.update(frame);
    },
    dispose() {
      clear();
      root.removeFromParent();
    },
  };
}
