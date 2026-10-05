/*
  Parametric Aura room. Length runs along local +Z, matching the meadow
  footprint (UNIT_LENGTH). The fully clear long side faces local +X.
  The door side faces local -X, with one panel slid open.
  A GLB at public/models/custom/aura-unit.glb replaces this shell when it is present.
*/
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { loadCustomModel, placeCustomModel } from './custom-models';
import { ktx2Loader, whenKtx2 } from './loaders';
import { anisotropyForTier, applyMacro } from './surfaces';
import { UNIT_LENGTH, UNIT_WIDTH } from './meadow-v1/meadow/geometry';

export type GlazeFinish = 'clear' | 'mirror' | 'tinted';

export type AuraUnitOptions = {
  /** Cooler, rougher panes. The silhouette picks up a white frost. */
  frost?: boolean;
  /** Lamp starts low, so setMood can bring it up with the night. */
  rising?: boolean;
};

export type AuraUnit = {
  object: THREE.Group;
  setFinish: (finish: GlazeFinish, seconds?: number) => void;
  /** 0 is a dim room. 1 is the warm night interior. */
  setMood: (night: number) => void;
  dispose: () => void;
};

const HEIGHT = 2.6;
const GLASS_T = 0.008;
const POST = 0.07;
const GAP = 0.012;
const MULLION_T = 0.04;

type Glaze = {
  transmission: number;
  metalness: number;
  roughness: number;
  thickness: number;
  ior: number;
  specularIntensity: number;
  clearcoat: number;
  envMapIntensity: number;
  attenuationDistance: number;
  color: THREE.Color;
  attenuation: THREE.Color;
};

const clearGlaze = (): Glaze => ({
  transmission: 1,
  metalness: 0,
  roughness: 0.04,
  thickness: GLASS_T,
  ior: 1.586,
  specularIntensity: 1,
  clearcoat: 0.3,
  envMapIntensity: 1,
  attenuationDistance: 2,
  color: new THREE.Color('#ffffff'),
  attenuation: new THREE.Color('#eef6f7'),
});

const FINISH: Record<GlazeFinish, Glaze> = {
  clear: clearGlaze(),
  tinted: {
    ...clearGlaze(),
    attenuationDistance: 0.25,
    attenuation: new THREE.Color('#4b5560'),
  },
  mirror: {
    ...clearGlaze(),
    transmission: 0.15,
    metalness: 0.9,
    roughness: 0.05,
    color: new THREE.Color('#c9d3d6'),
  },
};

/**
 * Scroll orbit for the glass passage. The last point is on +X, level with
 * the look target in Z, so the view runs along -X through both long walls.
 * Direction (-11.2, -0.34, 0) dotted with the clear-side normal (1, 0, 0)
 * is -0.999. The opening point sits on the door side and looks toward -Z,
 * where the far ridges sit.
 */
export function glassOrbit(): { p: [number, number, number]; t: [number, number, number]; fov: number }[] {
  return [
    { p: [-5.5, 2.2, 6.8], t: [0.15, 1.18, -0.4], fov: 28 },
    { p: [-2.2, 1.9, 9.2], t: [0.1, 1.2, -0.15], fov: 27 },
    { p: [6.5, 1.7, 5.5], t: [0, 1.24, -0.05], fov: 26 },
    { p: [11.2, 1.58, 0], t: [0, 1.24, 0], fov: 24 },
  ];
}

function asset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\//, '');
}

function beveled(w: number, h: number, d: number, radius: number) {
  const geo = new RoundedBoxGeometry(w, h, d, 2, radius);
  const uv = geo.getAttribute('uv');
  if (uv) geo.setAttribute('uv2', uv);
  return geo;
}

/** Faint streaks. The map sits just under 1 so roughness 0.04 only shifts by about 3%. */
function smudgeMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#f7f7f7';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1;
  g.globalAlpha = 1;
  for (let i = 0; i < 7; i += 1) {
    const y = 18 + ((i * 47) % 220);
    g.beginPath();
    g.moveTo(8, y);
    g.lineTo(240, y + ((i % 3) - 1) * 6);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

let sharedSmudge: THREE.Texture | null | undefined;

/** One polycarbonate pane. Each caller keeps its own material. */
export function createPolycarbonateMaterial(): THREE.MeshPhysicalMaterial {
  if (sharedSmudge === undefined) sharedSmudge = smudgeMap();
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.04,
    roughnessMap: sharedSmudge ?? undefined,
    transmission: 1,
    thickness: GLASS_T,
    ior: 1.586,
    specularIntensity: 1,
    clearcoat: 0.3,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1,
    attenuationColor: '#eef6f7',
    attenuationDistance: 2,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.name = 'polycarbonate';
  return mat;
}

function contactMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const fade = g.createRadialGradient(256, 128, 24, 256, 128, 220);
  fade.addColorStop(0, 'rgba(0,0,0,0.62)');
  fade.addColorStop(0.45, 'rgba(0,0,0,0.28)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.beginPath();
  g.ellipse(256, 128, 236, 108, 0, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tune(tex: THREE.Texture, rx: number, ry: number) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = anisotropyForTier();
  return tex;
}

function isGlazeFinish(value: string): value is GlazeFinish {
  return value === 'clear' || value === 'mirror' || value === 'tinted';
}

export function createAuraUnit(options: AuraUnitOptions = {}): AuraUnit {
  const object = new THREE.Group();
  object.name = 'AuraUnit';
  const shell = new THREE.Group();
  shell.name = 'AuraUnitShell';
  object.add(shell);

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  let panes: THREE.MeshPhysicalMaterial[] = [];
  let alive = true;
  let releasePlaced = () => {};
  let from = FINISH.clear;
  let to = FINISH.clear;
  let fadeStart = 0;
  let fadeEnd = 0;
  const scratch = new THREE.Color();
  const scratchAtt = new THREE.Color();

  const write = (glaze: Glaze) => {
    for (const mat of panes) {
      mat.transmission = glaze.transmission;
      mat.metalness = glaze.metalness;
      mat.roughness = glaze.roughness;
      mat.thickness = glaze.thickness;
      mat.ior = glaze.ior;
      mat.specularIntensity = glaze.specularIntensity;
      mat.clearcoat = glaze.clearcoat;
      mat.envMapIntensity = glaze.envMapIntensity;
      mat.attenuationDistance = glaze.attenuationDistance;
      mat.color.copy(glaze.color);
      mat.attenuationColor.copy(glaze.attenuation);
      if (options.frost) {
        mat.roughness = Math.max(mat.roughness, 0.3);
        mat.clearcoat = 0.12;
        mat.clearcoatRoughness = 0.64;
        mat.thickness = 0.016;
        mat.attenuationDistance = Math.min(mat.attenuationDistance, 0.7);
        mat.attenuationColor.lerp(new THREE.Color('#d5e4ea'), 0.7);
      }
    }
  };

  const stepFade = (now: number) => {
    if (!alive || panes.length === 0 || fadeEnd <= fadeStart) return;
    const t = Math.min(1, (now - fadeStart) / (fadeEnd - fadeStart));
    const e = t * t * (3 - 2 * t);
    const mix = (a: number, b: number) => a + (b - a) * e;
    scratch.copy(from.color).lerp(to.color, e);
    scratchAtt.copy(from.attenuation).lerp(to.attenuation, e);
    for (const mat of panes) {
      mat.transmission = mix(from.transmission, to.transmission);
      mat.metalness = mix(from.metalness, to.metalness);
      mat.roughness = mix(from.roughness, to.roughness);
      mat.attenuationDistance = mix(from.attenuationDistance, to.attenuationDistance);
      mat.color.copy(scratch);
      mat.attenuationColor.copy(scratchAtt);
    }
    if (t >= 1) write(to);
  };

  const setFinish = (finish: GlazeFinish, seconds = 1.2) => {
    if (!isGlazeFinish(finish)) return;
    const next = FINISH[finish];
    const now = performance.now();
    stepFade(now);
    from = {
      ...to,
      transmission: panes[0]?.transmission ?? to.transmission,
      metalness: panes[0]?.metalness ?? to.metalness,
      roughness: panes[0]?.roughness ?? to.roughness,
      attenuationDistance: panes[0]?.attenuationDistance ?? to.attenuationDistance,
      color: scratch.clone().copy(panes[0]?.color ?? to.color),
      attenuation: scratchAtt.clone().copy(panes[0]?.attenuationColor ?? to.attenuation),
    };
    to = next;
    const dur = Math.max(0, seconds);
    fadeStart = now;
    fadeEnd = now + dur * 1000;
    if (dur === 0) write(next);
  };

  const steel = new THREE.MeshStandardMaterial({
    color: '#1a1d21',
    roughness: 0.62,
    metalness: 0.88,
    envMapIntensity: 0.45,
  });
  const cedar = new THREE.MeshStandardMaterial({
    color: '#c9956a',
    roughness: 0.68,
    metalness: 0.02,
    envMapIntensity: 0.22,
  });
  const oak = new THREE.MeshStandardMaterial({
    color: '#e4c7a4',
    roughness: 0.52,
    metalness: 0.02,
    envMapIntensity: 0.2,
  });
  const oakFloor = oak.clone();
  oakFloor.color.setRGB(1.55, 1.32, 1.05);
  const linen = new THREE.MeshStandardMaterial({
    color: '#e4ddd2',
    roughness: 0.92,
    metalness: 0,
  });
  applyMacro(steel);
  applyMacro(cedar);
  applyMacro(oak);
  applyMacro(oakFloor);
  applyMacro(linen);
  const linenWeave = new THREE.TextureLoader().load(asset('textures/paper-linen.webp'), (tex) => {
    if (!alive) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 3);
    tex.anisotropy = anisotropyForTier();
    linen.map = tex;
    linen.needsUpdate = true;
  });
  texs.push(linenWeave);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: '#f3e2c4',
    roughness: 0.7,
    emissive: '#ffc98a',
    emissiveIntensity: 1.35,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#1b1c1a',
    roughness: 0.46,
    metalness: 0.2,
  });
  const screenMat = new THREE.MeshStandardMaterial({
    color: '#14181c',
    roughness: 0.32,
    metalness: 0.08,
    emissive: '#1c2830',
    emissiveIntensity: 0.45,
  });
  mats.push(steel, cedar, oak, oakFloor, linen, shadeMat, dark, screenMat);

  const makePane = () => {
    const mat = createPolycarbonateMaterial();
    if (options.frost) {
      mat.customProgramCacheKey = () => 'aura-frost';
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <tonemapping_fragment>',
          `float auraEdge = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.0);
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.9, 0.94, 0.96), auraEdge * 0.62);
#include <tonemapping_fragment>`,
        );
      };
    }
    mats.push(mat);
    panes.push(mat);
    return mat;
  };

  const add = (
    parent: THREE.Object3D,
    name: string,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    radius = 0.01,
  ) => {
    const geo = beveled(w, h, d, radius);
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const halfW = UNIT_WIDTH / 2;
  const halfL = UNIT_LENGTH / 2;
  const postCX = halfW - POST / 2;
  const postCZ = halfL - POST / 2;
  const innerX = postCX - POST / 2;
  const innerZ = postCZ - POST / 2;
  const glassX = innerX - GAP - GLASS_T / 2;
  const glassY0 = 0.3;
  const glassY1 = 2.44;
  const glassH = glassY1 - glassY0;
  const glassCY = (glassY0 + glassY1) / 2;

  const mullions = [-1, 1];
  const endKeep = GLASS_T + GAP;
  const cuts = [-innerZ + endKeep, ...mullions.flatMap((z) => [z - MULLION_T / 2, z + MULLION_T / 2]), innerZ - endKeep];
  const bays: { center: number; length: number }[] = [];
  for (let i = 0; i < cuts.length; i += 2) {
    const a = cuts[i] + GAP;
    const b = cuts[i + 1] - GAP;
    bays.push({ center: (a + b) / 2, length: b - a });
  }

  const pane = (x: number, z: number, length: number, axis: 'x' | 'z') => {
    const geo = axis === 'x'
      ? beveled(GLASS_T, glassH, length, 0.0015)
      : beveled(length, glassH, GLASS_T, 0.0015);
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, makePane());
    mesh.name = 'polycarbonate';
    mesh.position.set(x, glassCY, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 10;
    shell.add(mesh);
    return mesh;
  };

  for (const bay of bays) pane(glassX, bay.center, bay.length, 'x');
  const doorBay = bays[bays.length - 1];
  for (let i = 0; i < bays.length - 1; i += 1) {
    pane(-glassX, bays[i].center, bays[i].length, 'x');
  }
  const mullionOuter = postCX - 0.01 + 0.045 / 2;
  const door = pane(-(mullionOuter + GAP + GLASS_T / 2), doorBay.center, doorBay.length, 'x');
  door.position.z = doorBay.center - doorBay.length * 0.94;
  add(
    shell,
    'door-pull',
    0.014,
    0.32,
    0.016,
    steel,
    door.position.x - 0.018,
    glassCY - 0.08,
    door.position.z + doorBay.length * 0.42,
    0.004,
  );
  const endSpan = (glassX - GAP) * 2;
  pane(0, innerZ - GAP - GLASS_T / 2, endSpan, 'z');
  pane(0, -(innerZ - GAP - GLASS_T / 2), endSpan, 'z');

  const postH = 2.36;
  const postY = 0.16 + postH / 2;
  for (const x of [-postCX, postCX]) {
    for (const z of [-postCZ, postCZ]) add(shell, 'frame', POST, postH, POST, steel, x, postY, z, 0.012);
  }
  for (const z of mullions) {
    add(shell, 'frame', 0.045, glassH, MULLION_T, steel, postCX - 0.01, glassCY, z, 0.008);
    add(shell, 'frame', 0.045, glassH, MULLION_T, steel, -(postCX - 0.01), glassCY, z, 0.008);
  }
  add(shell, 'frame', UNIT_WIDTH, 0.08, 0.06, steel, 0, 0.24, halfL - 0.04, 0.01);
  add(shell, 'frame', UNIT_WIDTH, 0.08, 0.06, steel, 0, 0.24, -(halfL - 0.04), 0.01);
  add(shell, 'frame', 0.06, 0.08, UNIT_LENGTH - 0.14, steel, halfW - 0.04, 0.24, 0, 0.01);
  add(shell, 'frame', 0.06, 0.08, UNIT_LENGTH - 0.14, steel, -(halfW - 0.04), 0.24, 0, 0.01);
  add(shell, 'frame', UNIT_WIDTH + 0.02, 0.06, 0.06, steel, 0, 2.5, halfL - 0.02, 0.01);
  add(shell, 'frame', UNIT_WIDTH + 0.02, 0.06, 0.06, steel, 0, 2.5, -(halfL - 0.02), 0.01);
  add(shell, 'frame', 0.06, 0.06, UNIT_LENGTH, steel, halfW - 0.02, 2.5, 0, 0.01);
  add(shell, 'frame', 0.06, 0.06, UNIT_LENGTH, steel, -(halfW - 0.02), 2.5, 0, 0.01);

  for (const x of [-0.86, 0.86]) add(shell, 'skid', 0.12, 0.16, UNIT_LENGTH - 0.28, steel, x, 0.11, 0, 0.02);
  for (const z of [-2.55, -0.85, 0.85, 2.55]) add(shell, 'skid', 1.7, 0.08, 0.1, steel, 0, 0.1, z, 0.016);
  const floor = add(shell, 'floor', UNIT_WIDTH - 0.28, 0.045, UNIT_LENGTH - 0.28, oakFloor, 0, 0.2, 0, 0.008);
  floor.castShadow = false;
  floor.onBeforeRender = () => stepFade(performance.now());

  const roof = add(shell, 'roof', UNIT_WIDTH + 0.1, 0.05, UNIT_LENGTH + 0.1, steel, 0, 2.575, 0, 0.012);
  roof.castShadow = true;
  add(shell, 'fascia', 0.02, 0.11, UNIT_LENGTH + 0.1, steel, halfW + 0.05, 2.49, 0, 0.006);
  add(shell, 'fascia', 0.02, 0.11, UNIT_LENGTH + 0.1, steel, -(halfW + 0.05), 2.49, 0, 0.006);
  add(shell, 'fascia', UNIT_WIDTH + 0.14, 0.11, 0.02, steel, 0, 2.49, halfL + 0.05, 0.006);
  add(shell, 'fascia', UNIT_WIDTH + 0.14, 0.11, 0.02, steel, 0, 2.49, -(halfL + 0.05), 0.006);

  const stepZ = doorBay.center;
  add(shell, 'step', 0.28, 0.1, doorBay.length * 0.92, cedar, -(halfW + 0.02), 0.05, stepZ, 0.012);

  const seat = add(shell, 'sofa', 0.72, 0.38, 1.72, linen, -0.38, 0.42, -0.85, 0.04);
  seat.castShadow = true;
  add(shell, 'sofa', 0.18, 0.36, 1.72, linen, -0.64, 0.72, -0.85, 0.03);
  const desk = add(shell, 'desk', 0.56, 0.045, 1.05, oak, 0.42, 0.74, 0.2, 0.008);
  desk.castShadow = true;
  for (const [lx, lz] of [[0.22, -0.22], [0.62, -0.22], [0.22, 0.62], [0.62, 0.62]] as Array<[number, number]>) {
    add(shell, 'desk', 0.045, 0.5, 0.045, oak, lx, 0.48, lz, 0.008);
  }
  const laptop = new THREE.Group();
  laptop.name = 'laptop';
  laptop.position.set(0.42, 0.77, 0.16);
  const baseGeo = beveled(0.34, 0.014, 0.24, 0.003);
  const screenGeo = beveled(0.34, 0.2, 0.008, 0.002);
  geos.push(baseGeo, screenGeo);
  const base = new THREE.Mesh(baseGeo, dark);
  base.position.y = 0.007;
  base.castShadow = true;
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, 0.12, -0.1);
  screen.rotation.x = -0.42;
  screen.castShadow = true;
  laptop.add(base, screen);
  shell.add(laptop);

  add(shell, 'lamp', 0.025, 0.72, 0.025, dark, 0.08, 0.6, -1.9, 0.006);
  const shade = add(shell, 'lamp', 0.16, 0.1, 0.16, shadeMat, 0.08, 1.05, -1.9, 0.02);
  shade.castShadow = false;
  const lamp = new THREE.PointLight('#ffc98a', 18, 10, 1.15);
  lamp.name = 'InteriorLamp';
  lamp.position.set(0.08, 1.02, -1.9);
  lamp.castShadow = false;
  object.add(lamp);
  if (options.rising) {
    lamp.intensity = 2.4;
    shadeMat.emissiveIntensity = 0.22;
  }
  const setMood = (night: number) => {
    const n = THREE.MathUtils.clamp(night, 0, 1);
    const floor = options.frost ? 9 : 2.4;
    lamp.intensity = THREE.MathUtils.lerp(floor, 28, n);
    shadeMat.emissiveIntensity = THREE.MathUtils.lerp(options.frost ? 0.85 : 0.22, 2.35, n);
  };

  const shadowTex = contactMap();
  if (shadowTex) {
    texs.push(shadowTex);
    const shadowGeo = new THREE.PlaneGeometry(UNIT_WIDTH + 0.9, UNIT_LENGTH + 0.7);
    shadowGeo.rotateX(-Math.PI / 2);
    geos.push(shadowGeo);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      toneMapped: true,
    });
    mats.push(shadowMat);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.name = 'ContactShadow';
    shadow.position.y = 0.012;
    shadow.renderOrder = 1;
    shadow.receiveShadow = false;
    shadow.castShadow = false;
    shadow.onBeforeRender = () => stepFade(performance.now());
    object.add(shadow);
  }

  write(FINISH.clear);

  const loadSet = (name: string) =>
    whenKtx2().then(() =>
      Promise.all([
        ktx2Loader.loadAsync(asset(`textures/${name}/diff.ktx2`)),
        ktx2Loader.loadAsync(asset(`textures/${name}/nor_gl.ktx2`)),
        ktx2Loader.loadAsync(asset(`textures/${name}/rough.ktx2`)),
        ktx2Loader.loadAsync(asset(`textures/${name}/ao.ktx2`)),
      ]),
    );

  const drop = (textures: THREE.Texture[]) => {
    for (const tex of textures) tex.dispose();
  };

  void loadSet('metal_plate').then((maps) => {
    if (!alive) {
      drop(maps);
      return;
    }
    const [diff, nor, rough, ao] = maps;
    tune(diff, 2.4, 1.4);
    tune(nor, 2.4, 1.4);
    tune(rough, 2.4, 1.4);
    tune(ao, 2.4, 1.4);
    texs.push(diff, nor, rough, ao);
    steel.map = diff;
    steel.normalMap = nor;
    steel.roughnessMap = rough;
    steel.aoMap = ao;
    steel.aoMapIntensity = 0.8;
    steel.needsUpdate = true;
  }).catch(() => undefined);

  void loadSet('fine_grained_wood').then((maps) => {
    if (!alive) {
      drop(maps);
      return;
    }
    const [diff, nor, rough, ao] = maps;
    diff.colorSpace = THREE.SRGBColorSpace;
    nor.colorSpace = THREE.NoColorSpace;
    rough.colorSpace = THREE.NoColorSpace;
    ao.colorSpace = THREE.NoColorSpace;
    tune(diff, 2.2, 1.6);
    tune(nor, 2.2, 1.6);
    tune(rough, 2.2, 1.6);
    tune(ao, 2.2, 1.6);
    const shared = [diff, nor, rough, ao];
    const floorMaps = shared.map((map) => {
      const clone = map.clone();
      clone.repeat.set(2.4, 6.2);
      clone.needsUpdate = true;
      return clone;
    });
    texs.push(...shared, ...floorMaps);
    const applyWood = (
      mat: THREE.MeshStandardMaterial,
      pack: THREE.Texture[],
      tint: [number, number, number],
      aoIntensity: number,
    ) => {
      const [d, n, r, a] = pack;
      mat.map = d;
      mat.normalMap = n;
      mat.roughnessMap = r;
      mat.aoMap = a;
      mat.aoMapIntensity = aoIntensity;
      mat.normalScale.set(0.55, 0.55);
      mat.color.setRGB(tint[0], tint[1], tint[2]);
      mat.needsUpdate = true;
    };
    applyWood(cedar, shared, [1.42, 1.02, 0.66], 0.42);
    applyWood(oak, shared, [1.28, 1.1, 0.88], 0.38);
    applyWood(oakFloor, floorMaps, [1.72, 1.46, 1.14], 0.3);
  }).catch(() => undefined);

  const adopt = (source: THREE.Object3D) => {
    if (!alive) return;
    const retired = new Set(panes);
    const placed = placeCustomModel(source, 'aura-unit', {
      polycarbonate: () => makePane(),
    });
    const found = panes.filter((mat) => !retired.has(mat));
    shell.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const index = geos.indexOf(mesh.geometry);
      if (index >= 0) geos.splice(index, 1);
      mesh.geometry.dispose();
    });
    shell.removeFromParent();
    panes = found;
    for (const mat of retired) {
      const index = mats.indexOf(mat);
      if (index >= 0) mats.splice(index, 1);
      mat.dispose();
    }
    for (const mat of placed.materials) mats.push(mat);
    object.add(placed.object);
    releasePlaced = placed.release;
    const live = new Set<THREE.Material>();
    object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of list) if (mat) live.add(mat);
    });
    for (let i = mats.length - 1; i >= 0; i -= 1) {
      if (!live.has(mats[i])) {
        mats[i].dispose();
        mats.splice(i, 1);
      }
    }
    write(to);
  };

  void loadCustomModel('aura-unit').then((scene) => {
    if (!scene) return;
    if (!alive) return;
    adopt(scene);
  });

  return {
    object,
    setFinish,
    setMood,
    dispose() {
      if (!alive) return;
      alive = false;
      releasePlaced();
      object.removeFromParent();
      for (const geo of geos) geo.dispose();
      for (const mat of mats) mat.dispose();
      for (const tex of texs) tex.dispose();
      geos.length = 0;
      mats.length = 0;
      texs.length = 0;
      panes = [];
    },
  };
}
