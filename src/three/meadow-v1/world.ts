/*
  The hill fly-over, as one vanilla world on the shared stage.
  Homepage grass, the far passage, and Build Your Own each pass their own
  spline. Nothing here opens a second canvas or a second composer.
*/
import * as THREE from 'three';
import { registerView, type StageTone } from '../stage';
import { hdrLoader, ktx2Loader, loadEnvironment, loadModel, whenKtx2 } from '../loaders';
import { motionTime, onQuality, qualityProfile } from '../quality';
import { anisotropyForTier, applyMacro } from '../surfaces';
import { prefersReducedMotion } from '../../scripts/motion';
import { AURA_UNIT_SLOT, HOT_TUB_SLOT } from './meadow/geometry';
import { meadowShade, sampleMeadowClearance, sampleMeadowDensity, sampleTerrainHeight } from './meadow/field';
import { FROZEN_T, WIND_DIR, buildFlowerField, gustEnvelope, makeFlowerMaterial } from './flora';
import {
  G_FILL,
  G_HERO,
  grassClock,
  makeGrassMaterial,
  plantGrass,
  trimGrass,
  type GrassTile,
} from './grass';
import { EVENING_SUN, applyHeightFog, heightFog } from './height-fog';
import { addGoldenSky } from './golden-sky';
import { makeGoldenTerrain } from './golden-ground';
import { mountGoldenGrove, placeGoldenProps } from './grove';

export type SplinePoint = {
  p: [number, number, number];
  t: [number, number, number];
  fov: number;
  ground?: number;
};

export type TimeOfDay = 'day' | 'dusk' | 'night' | 'scroll';

export type MeadowShot = {
  p: [number, number, number];
  t: [number, number, number];
  fov: number;
};

export type MeadowWorldOptions = {
  spline?: SplinePoint[];
  timeOfDay?: TimeOfDay;
  density?: number;
  intro?: boolean;
  /** Hold the composed still instead of following the spline. */
  reducedShot?: boolean;
  readProgress?: () => number;
  exposure?: number;
  tone?: StageTone;
  hdri?: string;
  envIntensity?: number;
  ao?: boolean;
  /** Homepage grass only. The builder keeps the day fly-over. */
  grade?: 'golden';
  hdriPinned?: boolean;
  shadow?: 'soft';
  bloom?: { threshold: number; intensity: number };
  godrays?: boolean;
  flare?: boolean;
  /** Daylight product shot. One warm sun, no intro pull, no pointer drift. */
  product?: boolean;
  /** Skip pointer drift. The intro pull still runs when intro is set. */
  steady?: boolean;
  /** Fill the empty AuraUnitSlot. Grass leaves the slot empty. */
  occupyUnit?: (slot: THREE.Group) => (() => void) | void;
  /** Fill HotTubSlot. Grass leaves the slot empty. */
  occupyTub?: (slot: THREE.Group) => (() => void) | void;
  /** After the camera is placed. The renderer arrives on the second frame. */
  onFrame?: (frame: MeadowFrame) => void;
  /** Scroll from dusk into night. Stars and the warm lights follow it. */
  nightScroll?: boolean;
  /** Second environment. The sky eases from `hdri` into this as night rises. */
  hdriNight?: string;
  /** Ground height. The slope passage passes a steeper ridge. */
  heightAt?: (x: number, z: number) => number;
  /** Skip grass so rock or snow stays the ground. Default is the meadow. */
  meadow?: boolean;
  /** PBR ground. Meadow keeps the coloured terrain. */
  ground?: 'meadow' | 'rock' | 'snow';
  /** Open the far plane, keep the mountain layers, and use height fog. */
  vista?: boolean;
  /** Drop trees and stones inside this radius. The slope deck uses it. */
  clear?: { x: number; z: number; r: number };
};

export type MeadowFrame = {
  camera: THREE.PerspectiveCamera;
  dt: number;
  dusk: number;
  night: number;
  reduced: boolean;
  renderer: THREE.WebGLRenderer | null;
};

export type MeadowHandle = {
  setProgress: (t: number) => void;
  setTimeOfDay: (next: TimeOfDay) => void;
  setDensity: (n: number) => void;
  setShot: (shot: MeadowShot | null) => void;
  destroy: () => void;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Thirteen controls. Beats sit on the even indices. Tension is 0.38. */
export const FLYOVER_SPLINE: SplinePoint[] = [
  { p: [-2.0, 2.5, 31.5], t: [0.4, 4.7, 20.0], fov: 36, ground: 1 },
  { p: [-0.8, 2.4, 27.5], t: [0.2, 4.9, 18.5], fov: 36, ground: 1 },
  { p: [0.6, 2.6, 23.5], t: [0.0, 1.6, 0.0], fov: 40, ground: 1 },
  { p: [-3.4, 2.2, 17.4], t: [0.0, 2.0, 0.8], fov: 41, ground: 1 },
  { p: [-5.2, 2.0, 12.2], t: [0.5, 2.6, 1.8], fov: 41, ground: 1 },
  { p: [-1.0, 3.0, 12.6], t: [0.4, 1.9, 1.4], fov: 43, ground: 1 },
  { p: [7.4, 5.6, 13.6], t: [0.0, 1.8, 1.6], fov: 44 },
  { p: [4.4, 2.2, 9.8], t: [0.6, 1.8, 4.4], fov: 42, ground: 1 },
  { p: [0.8, 1.8, 8.3], t: [0.2, 2.0, 3.8], fov: 41, ground: 1 },
  { p: [0.3, 2.35, 5.7], t: [4.6, 1.1, 5.3], fov: 42 },
  { p: [5.6, 2.0, 7.6], t: [0.6, 2.1, 2.8], fov: 42 },
  { p: [7.4, 2.4, 9.4], t: [0.4, 2.2, 1.8], fov: 40 },
  { p: [9.4, 4.3, 13.4], t: [0.2, 2.2, 1.2], fov: 37 },
];

/**
 * Low over the crest, then a slow arc onto the evening-sun azimuth so the
 * disc and the unit share the settle. ground adds ridge height. Look targets
 * are world space. Far begins on the last grass point.
 */
export const GRASS_SPLINE: SplinePoint[] = [
  { p: [-1.2, 2.5, 27.5], t: [0.4, 1.6, 2.0], fov: 38, ground: 1 },
  { p: [-4.5, 2.3, 18.0], t: [1.2, 2.2, 4.0], fov: 38, ground: 1 },
  { p: [-8.5, 2.2, 8.0], t: [2.0, 3.4, 8.0], fov: 37, ground: 1 },
  { p: [-12.4, 2.15, -2.0], t: [6.8, 5.9, 11.9], fov: 36, ground: 1 },
  { p: [-14.2, 2.05, -8.4], t: [5.05, 5.39, 5.53], fov: 36, ground: 1 },
  { p: [-13.4, 1.95, -9.6], t: [5.85, 5.29, 4.33], fov: 35, ground: 1 },
];
/**
 * Starts near the unit, then drifts back and rises so the room is a small
 * warm light in the dusk meadow. Heights are world space.
 */
export const FAR_SPLINE: SplinePoint[] = [
  { p: [6.4, 2.2, 12.8], t: [1.5, 1.35, 2.1], fov: 34 },
  { p: [11, 7.4, 26], t: [0.7, 1.9, 0.5], fov: 34 },
  { p: [18, 18, 48], t: [0.25, 2.8, 0.15], fov: 32 },
  { p: [24, 36, 86], t: [0.15, 3.6, 0.05], fov: 28 },
];

export const REDUCED_SHOT: MeadowShot = {
  p: [9.4, 4.3, 13.4],
  t: [0.2, 2.2, 1.2],
  fov: 38,
};

const KEY = new THREE.Vector3(18, 16, 13).normalize();

const PATCHES: { pos: [number, number, number]; rotY?: number; scale?: number }[] = [
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
];

const TEAL_PINES: { pos: [number, number, number]; rotY?: number; scale?: number }[] = [
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

const ROCKS: { pos: [number, number, number]; rotY?: number; scale?: number }[] = [
  { pos: [3.8, 0, 8.6], rotY: 0.7, scale: 0.45 },
  { pos: [-6.4, 0, 3.4], rotY: 2.4, scale: 0.32 },
  { pos: [7.6, 0, -2.6], rotY: 1.1, scale: 0.6 },
  { pos: [-8.6, 0, -6.2], rotY: 3.8, scale: 0.85 },
  { pos: [2.1, 0, -6.6], rotY: 5.2, scale: 0.4 },
  { pos: [-2.9, 0, 9.8], rotY: 0.2, scale: 0.24 },
  { pos: [4.6, 0, 11.8], rotY: 1.6, scale: 0.4 },
];

const LANTERNS: { pos: [number, number, number]; rotY?: number; scale?: number }[] = [
  { pos: [1.15, 0, 7.15], rotY: 0.4, scale: 1 },
  { pos: [-1.05, 0, 7.05], rotY: 2.2, scale: 1 },
  { pos: [1.35, 0, 8.75], rotY: 1.1, scale: 1 },
  { pos: [4.75, 0, 6.9], rotY: 5.2, scale: 1 },
  { pos: [-2.65, 0, 30.15], rotY: 2.8, scale: 1 },
];

const SHAFTS = [
  { pos: [-10.6, -3.6] as [number, number], w: 2.3, len: 9.5, o: 1, rot: 0.3 },
  { pos: [-13.4, 4.8] as [number, number], w: 1.7, len: 8, o: 0.8, rot: 1.2 },
  { pos: [9.6, -4.2] as [number, number], w: 2.5, len: 9, o: 0.9, rot: -0.4 },
  { pos: [5.4, -9.6] as [number, number], w: 1.9, len: 8.5, o: 0.7, rot: 0.8 },
];

const MIST = [
  { pos: [-15, 1.4, -7], scale: 16, speed: 0.05 },
  { pos: [13, 1, -11], scale: 14, speed: 0.035 },
  { pos: [-6, 0.9, -17], scale: 18, speed: 0.045 },
  { pos: [10, 1.6, 8], scale: 12, speed: 0.03 },
  { pos: [-17, 1.2, 9], scale: 13, speed: 0.04 },
];

function asset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\//, '');
}

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function ridged(x: number, y: number, octaves = 5) {
  let sum = 0;
  let freq = 1;
  let amp = 0.5;
  let prev = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    let n = vnoise(x * freq, y * freq);
    n = 1 - Math.abs(n * 2 - 1);
    n *= n;
    n *= prev;
    prev = n;
    sum += n * amp;
    freq *= 2.07;
    amp *= 0.5;
  }
  return sum;
}

function makeTerrain(segments: number, heightAt: (x: number, z: number) => number = sampleTerrainHeight) {
  const geo = new THREE.PlaneGeometry(170, 170, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const position = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const cA = new THREE.Color('#8db284');
  const cB = new THREE.Color('#a4c295');
  const cC = new THREE.Color('#b7c489');
  const cSward = new THREE.Color('#4d6a42');
  const tmp = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heightAt(x, z));
    const n1 = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.17 + 1.2);
    const n2 = 0.5 + 0.5 * Math.sin(x * 0.61 - z * 0.43 + 4);
    tmp.copy(cA).lerp(cB, n1).lerp(cC, n2 * 0.25);
    const m =
      0.5 * Math.sin(x * 1.9 + z * 1.4) +
      0.3 * Math.sin(x * 4.3 - z * 3.1 + 2.2) +
      0.7 * (hash2(Math.floor(x * 1.3), Math.floor(z * 1.3)) - 0.5);
    const shade = meadowShade(x, z);
    tmp.lerp(cSward, shade * 0.55);
    const value = (1 + m * 0.075) * (1 - 0.44 * shade);
    colors[i * 3] = tmp.r * value;
    colors[i * 3 + 1] = tmp.g * (1 + m * 0.055) * (1 - 0.44 * shade);
    colors[i * 3 + 2] = tmp.b * value;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerraWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerraWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerraWorld;
float terraHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float terraNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(terraHash(i), terraHash(i + vec2(1.0, 0.0)), u.x),
             mix(terraHash(i + vec2(0.0, 1.0)), terraHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float terraD = length(vViewPosition);
  float terraPatch = terraNoise(vTerraWorld.xz * 2.1);
  float terraFadeP = 1.0 - smoothstep(26.0, 60.0, terraD);
  diffuseColor.rgb *= 1.0 + (terraPatch - 0.47) * 0.14 * terraFadeP;
}`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Terrain';
  return mesh;
}

function makeTexturedGround(segments: number, heightAt: (x: number, z: number) => number, color: string) {
  const geo = new THREE.PlaneGeometry(170, 170, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const position = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    position.setY(i, heightAt(position.getX(i), position.getZ(i)));
  }
  geo.computeVertexNormals();
  if (geo.getAttribute('uv')) geo.setAttribute('uv2', geo.getAttribute('uv'));
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0 });
  applyMacro(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Terrain';
  return mesh;
}

function ridgeGeometry(seed: number, width: number, height: number, jag: number) {
  const segs = 128;
  const geo = new THREE.PlaneGeometry(width, height, segs, 1);
  const position = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i <= segs; i += 1) {
    const t = i / segs;
    const a = Math.sin(t * 5.1 + seed * 2.3) * 0.55;
    const b = Math.sin(t * 11.7 + seed * 5.9) * 0.26;
    const c = Math.sin(t * 27.3 + seed * 1.4) * 0.11;
    const peak = clamp01((a + b + c) * 0.5 + 0.5) ** 1.35;
    position.setY(i, peak * height * jag);
    position.setY(i + segs + 1, -height * 0.5);
  }
  geo.computeVertexNormals();
  return geo;
}

function addMountainRange(parent: THREE.Group, geometries: THREE.BufferGeometry[], materials: THREE.Material[]) {
  const bands = [
    { seed: 1.7, z: -168, w: 700, h: 132, jag: 1, color: '#a8bcc9', op: 0.85, y: 2 },
    { seed: 4.2, z: -134, w: 600, h: 104, jag: 0.94, color: '#8ea7b8', op: 0.92, y: 1 },
    { seed: 8.9, z: -106, w: 500, h: 78, jag: 0.88, color: '#748ea3', op: 0.97, y: 0 },
  ];
  const group = new THREE.Group();
  group.name = 'MountainRange';
  group.renderOrder = -10;
  for (const band of bands) {
    const geo = ridgeGeometry(band.seed, band.w, band.h, band.jag);
    geometries.push(geo);
    const rock = new THREE.MeshBasicMaterial({
      name: 'RidgeRock',
      color: band.color,
      transparent: true,
      opacity: band.op,
      fog: false,
      side: THREE.DoubleSide,
    });
    rock.userData.span = [band.w, band.h];
    const snow = new THREE.MeshBasicMaterial({
      name: 'RidgeSnow',
      color: '#f4f8fa',
      transparent: true,
      opacity: 0.72,
      fog: false,
      side: THREE.DoubleSide,
    });
    materials.push(rock, snow);
    const mesh = new THREE.Mesh(geo, rock);
    mesh.position.set(0, band.y, band.z);
    mesh.frustumCulled = false;
    const cap = new THREE.Mesh(geo, snow);
    cap.position.set(0, band.y + band.h * 0.05, band.z + 1.5);
    cap.scale.set(1, 0.955, 1);
    cap.frustumCulled = false;
    group.add(mesh, cap);
  }
  parent.add(group);
}

function snowRangeGeometry(seed: number, width: number, depth: number, sx: number, sz: number, hMul: number, wash: number) {
  const geo = new THREE.PlaneGeometry(width, depth, sx, sz);
  geo.rotateX(-Math.PI / 2);
  const position = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const near = (z + depth / 2) / depth;
    const rid = ridged(x * 0.0132 + 11.3 + seed, z * 0.014 + 4.1 + seed * 0.7, 5);
    const macro = 0.45 + 0.55 * vnoise(x * 0.0022 + 2.7 + seed, z * 0.004 + 9.4);
    let h = Math.min(1, (rid * macro) / 0.78) ** 1.08 * 0.78 * 55 * hMul * (0.42 + near * 0.9);
    h *= Math.min(1, Math.max(0, (near - 0.02) / 0.22));
    position.setY(i, h);
  }
  geo.computeVertexNormals();
  const normal = geo.attributes.normal as THREE.BufferAttribute;
  const sky = new THREE.Color('#d9e6ee');
  const rock = new THREE.Color('#4a5a69');
  const rockHi = new THREE.Color('#6f8090');
  const snow = new THREE.Color('#f7fbfd');
  const tree = new THREE.Color('#41584c');
  const tmp = new THREE.Color();
  const cols = new Float32Array(position.count * 3);
  let maxH = 1;
  for (let i = 0; i < position.count; i += 1) maxH = Math.max(maxH, position.getY(i));
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const z = position.getZ(i);
    const alt = y / maxH;
    const slope = 1 - Math.abs(normal.getY(i));
    const line = 0.42 + vnoise(position.getX(i) * 0.02 + seed, z * 0.02) * 0.17;
    const snowAmt = clamp01((alt - line) / 0.13) * clamp01(1 - (slope - 0.34) / 0.16);
    const treeAmt = clamp01((0.16 - alt) / 0.22);
    tmp.copy(rock).lerp(rockHi, clamp01(alt * 0.9)).lerp(tree, treeAmt * 0.8).lerp(snow, snowAmt);
    const ndl = normal.getX(i) * KEY.x + normal.getY(i) * KEY.y + normal.getZ(i) * KEY.z;
    tmp.multiplyScalar(0.4 + clamp01(ndl * 0.66 + 0.4) * 0.94);
    const near = (z + depth / 2) / depth;
    const haze = clamp01(wash + (1 - near) * 0.24 + (1 - smoothstep(0, 0.26, alt)) * 0.26 - alt * 0.22);
    tmp.lerp(sky, Math.min(0.9, haze));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

function addSnowRange(parent: THREE.Group, geometries: THREE.BufferGeometry[], materials: THREE.Material[]) {
  const group = new THREE.Group();
  group.name = 'SnowRange';
  const far = snowRangeGeometry(37.4, 1150, 130, 120, 12, 1.45, 0.5);
  const mid = snowRangeGeometry(0, 900, 110, 180, 16, 1, 0.3);
  geometries.push(far, mid);
  const farMat = new THREE.MeshBasicMaterial({ name: 'SnowRange', vertexColors: true, fog: false });
  const midMat = new THREE.MeshBasicMaterial({ name: 'SnowRange', vertexColors: true, fog: false });
  materials.push(farMat, midMat);
  const farMesh = new THREE.Mesh(far, farMat);
  farMesh.position.set(70, -13, -232);
  farMesh.frustumCulled = false;
  farMesh.renderOrder = -11;
  const midMesh = new THREE.Mesh(mid, midMat);
  midMesh.position.set(0, -9, -172);
  midMesh.frustumCulled = false;
  midMesh.renderOrder = -10;
  group.add(farMesh, midMesh);
  group.userData.mats = [farMat, midMat];
  parent.add(group);
  return group;
}

function paintSnow(group: THREE.Group, dusk: number, night: number) {
  const mats = group.userData.mats as THREE.MeshBasicMaterial[] | undefined;
  if (!mats) return;
  const r = (1 + dusk * 0.1) * (1 - night * 0.56);
  const g = (1 - dusk * 0.03) * (1 - night * 0.5);
  const b = (1 - dusk * 0.14) * (1 - night * 0.34);
  for (const mat of mats) mat.color.setRGB(r, g, b);
}

function addClouds(parent: THREE.Group, geometries: THREE.BufferGeometry[], materials: THREE.Material[]) {
  const group = new THREE.Group();
  group.name = 'Clouds';
  const crown = new THREE.Color('#fffdf5');
  const body = new THREE.Color('#eff2f1');
  const base = new THREE.Color('#c0ccd1');
  const tmp = new THREE.Color();
  for (let cloud = 0; cloud < 6; cloud += 1) {
    const parts: THREE.BufferGeometry[] = [];
    const lobes = 4 + (cloud % 3);
    for (let i = 0; i < lobes; i += 1) {
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const s = 0.7 + hash2(cloud, i) * 0.8;
      geo.scale(s * 1.3, s * 0.55, s);
      const off = i - (lobes - 1) / 2;
      geo.translate(off * 1.05, -Math.abs(off) * 0.16, (hash2(i, cloud) - 0.5) * 0.4);
      parts.push(geo);
    }
    let total = 0;
    for (const part of parts) total += part.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let offset = 0;
    for (const part of parts) {
      const p = part.attributes.position as THREE.BufferAttribute;
      pos.set(p.array as Float32Array, offset);
      offset += p.count * 3;
      part.dispose();
    }
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      minY = Math.min(minY, pos[i]);
      maxY = Math.max(maxY, pos[i]);
    }
    const span = Math.max(0.001, maxY - minY);
    for (let i = 0; i < pos.length; i += 3) {
      const lift = (pos[i + 1] - minY) / span;
      tmp.copy(base).lerp(body, lift).lerp(crown, lift * lift);
      const ndl = KEY.y * 0.6 + 0.4;
      tmp.multiplyScalar(0.72 + lift * ndl * 0.45);
      col[i] = tmp.r;
      col[i + 1] = tmp.g;
      col[i + 2] = tmp.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geometries.push(geo);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    const angle = cloud * 0.9;
    mesh.position.set(Math.cos(angle) * (18 + cloud * 6), 28 + (cloud % 3) * 6, Math.sin(angle) * 14 - 6);
    mesh.scale.setScalar(3.2 + (cloud % 2));
    mesh.userData.baseX = mesh.position.x;
    mesh.userData.phase = cloud;
    group.add(mesh);
  }
  parent.add(group);
  return group;
}

function addStars(parent: THREE.Group) {
  const count = 700;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const s = Math.sin(i * 91.7) * 43758.5453;
    const a = (s - Math.floor(s)) * Math.PI * 2;
    const t = Math.sin(i * 33.1) * 43758.5453;
    const el = 0.08 + (t - Math.floor(t)) * 0.72;
    pos[i * 3] = Math.cos(a) * Math.cos(el) * 190;
    pos[i * 3 + 1] = Math.sin(el) * 190;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * 190;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 2,
    sizeAttenuation: true,
    color: '#dfe9f5',
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'StarField';
  points.renderOrder = -11;
  points.frustumCulled = false;
  parent.add(points);
  return { geo, mat, points };
}

function moonDisc() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 58);
  grad.addColorStop(0, 'rgba(255, 250, 236, 1)');
  grad.addColorStop(0.42, 'rgba(244, 236, 214, 0.95)');
  grad.addColorStop(0.72, 'rgba(232, 224, 204, 0.35)');
  grad.addColorStop(1, 'rgba(232, 224, 204, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function softDisc() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(244,250,246,0.55)');
  grad.addColorStop(0.6, 'rgba(244,250,246,0.16)');
  grad.addColorStop(1, 'rgba(244,250,246,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function shaftTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const v = ctx.createLinearGradient(0, 256, 0, 0);
  v.addColorStop(0, 'rgba(255,238,200,0.14)');
  v.addColorStop(0.45, 'rgba(255,238,200,0.55)');
  v.addColorStop(0.85, 'rgba(255,238,200,0.10)');
  v.addColorStop(1, 'rgba(255,238,200,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 64, 256);
  const h = ctx.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.3, 'rgba(0,0,0,1)');
  h.addColorStop(0.7, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function placeNormalized(
  src: THREE.Object3D,
  height: number,
  placements: { pos: [number, number, number]; rotY?: number; scale?: number }[],
  sway: THREE.Object3D[],
  heightAt: (x: number, z: number) => number = sampleTerrainHeight,
) {
  const box = new THREE.Box3().setFromObject(src);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const k = height / (size.y || 1);
  const group = new THREE.Group();
  for (const placement of placements) {
    const scale = placement.scale ?? 1;
    const obj = src.clone(true);
    obj.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material?.isMeshStandardMaterial) {
        const next = material.clone();
        if (next.name === 'Green') next.color.set('#356247');
        if (next.name === 'Wood') next.color.set('#5d4030');
        next.roughness = 1;
        next.metalness = 0;
        next.envMapIntensity = 0.3;
        mesh.material = next;
      }
    });
    obj.position.set(-center.x * k * scale, -box.min.y * k * scale, -center.z * k * scale);
    obj.scale.setScalar(k * scale);
    const pivot = new THREE.Group();
    pivot.add(obj);
    const y = heightAt(placement.pos[0], placement.pos[2]) - 0.06;
    pivot.position.set(placement.pos[0], y, placement.pos[2]);
    pivot.rotation.y = placement.rotY ?? 0;
    group.add(pivot);
    sway.push(pivot);
  }
  return group;
}

function addLiteForest(
  parent: THREE.Group,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
  textures: THREE.Texture[],
  scale: number,
  alive: () => boolean,
) {
  const placements = [...PATCHES.slice(0, Math.max(4, Math.round(12 * scale))), ...TEAL_PINES.slice(0, Math.max(3, Math.round(9 * scale)))];
  const crownGeo = new THREE.ConeGeometry(1, 1, 6);
  const trunkGeo = new THREE.CylinderGeometry(1, 1.18, 1, 6);
  geometries.push(crownGeo, trunkGeo);
  const crownMat = new THREE.MeshStandardMaterial({ color: '#356247', roughness: 1, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5d4030', roughness: 1, flatShading: true });
  applyMacro(crownMat);
  applyMacro(trunkMat);
  materials.push(crownMat, trunkMat);
  void whenKtx2()
    .then(() =>
      Promise.all([
        ktx2Loader.loadAsync(asset('textures/bark_brown_02/diff.ktx2')),
        ktx2Loader.loadAsync(asset('textures/bark_brown_02/nor_gl.ktx2')),
        ktx2Loader.loadAsync(asset('textures/bark_brown_02/rough.ktx2')),
      ]),
    )
    .then((maps) => {
      if (!alive()) {
        for (const tex of maps) tex.dispose();
        return;
      }
      const [diff, nor, rough] = maps;
      for (const tex of maps) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 3);
        tex.anisotropy = anisotropyForTier();
      }
      diff.colorSpace = THREE.SRGBColorSpace;
      nor.colorSpace = THREE.NoColorSpace;
      rough.colorSpace = THREE.NoColorSpace;
      trunkMat.map = diff;
      trunkMat.normalMap = nor;
      trunkMat.roughnessMap = rough;
      trunkMat.needsUpdate = true;
      textures.push(...maps);
    })
    .catch(() => undefined);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, placements.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, placements.length);
  crowns.receiveShadow = true;
  const dummy = new THREE.Object3D();
  placements.forEach((placement, index) => {
    const treeScale = placement.scale ?? 1;
    const height = (index < 12 ? 5.2 : 4.3) * treeScale;
    const y = sampleTerrainHeight(placement.pos[0], placement.pos[2]);
    dummy.position.set(placement.pos[0], y + height * 0.52, placement.pos[2]);
    dummy.rotation.set(0, placement.rotY ?? 0, 0);
    dummy.scale.set(1.25 * treeScale, height, 1.25 * treeScale);
    dummy.updateMatrix();
    crowns.setMatrixAt(index, dummy.matrix);
    dummy.position.set(placement.pos[0], y + height * 0.14, placement.pos[2]);
    dummy.scale.set(0.16 * treeScale, height * 0.28, 0.16 * treeScale);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
  });
  const group = new THREE.Group();
  group.name = 'LiteForest';
  group.add(crowns, trunks);
  parent.add(group);
}

function addSlots(parent: THREE.Group, heightAt: (x: number, z: number) => number = sampleTerrainHeight) {
  const unit = new THREE.Group();
  unit.name = 'AuraUnitSlot';
  unit.position.set(AURA_UNIT_SLOT.x, heightAt(AURA_UNIT_SLOT.x, AURA_UNIT_SLOT.z), AURA_UNIT_SLOT.z);
  const tub = new THREE.Group();
  tub.name = 'HotTubSlot';
  tub.position.set(HOT_TUB_SLOT.x, heightAt(HOT_TUB_SLOT.x, HOT_TUB_SLOT.z), HOT_TUB_SLOT.z);
  parent.add(unit, tub);
}

function makeCurves(spline: SplinePoint[]) {
  const position = new THREE.CatmullRomCurve3(
    spline.map(
      (point) =>
        new THREE.Vector3(
          point.p[0],
          point.ground ? sampleTerrainHeight(point.p[0], point.p[2]) + point.p[1] : point.p[1],
          point.p[2],
        ),
    ),
    false,
    'catmullrom',
    0.38,
  );
  const target = new THREE.CatmullRomCurve3(
    spline.map((point) => new THREE.Vector3(point.t[0], point.t[1], point.t[2])),
    false,
    'catmullrom',
    0.38,
  );
  return { position, target };
}

function fovAt(spline: SplinePoint[], u: number) {
  if (spline.length >= 13) {
    const beat = u * 6;
    const index = Math.min(Math.floor(beat), 5);
    const frac = clamp01(beat - index);
    return THREE.MathUtils.lerp(spline[index * 2].fov, spline[Math.min(index + 1, 6) * 2].fov, frac);
  }
  const scaled = u * (spline.length - 1);
  const index = Math.min(Math.floor(scaled), spline.length - 2);
  return THREE.MathUtils.lerp(spline[index].fov, spline[index + 1].fov, scaled - index);
}

type Built = {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  winds: { uTime: { value: number }; uGust: { value: number } }[];
  hero: GrassTile[];
  fill: GrassTile[];
  heroMat: THREE.ShaderMaterial | null;
  fillMat: THREE.ShaderMaterial | null;
  flowerMat: THREE.ShaderMaterial | null;
  stars: THREE.PointsMaterial | null;
  mist: THREE.Sprite[];
  clouds: THREE.Object3D[];
  sway: THREE.Object3D[];
  shafts: THREE.MeshBasicMaterial[];
  birds: THREE.InstancedMesh | null;
  snow: THREE.Group | null;
  generation: number;
  release: (() => void) | null;
};

function emptyBuilt(): Built {
  return {
    geometries: [],
    materials: [],
    textures: [],
    winds: [],
    hero: [],
    fill: [],
    heroMat: null,
    fillMat: null,
    flowerMat: null,
    stars: null,
    mist: [],
    clouds: [],
    sway: [],
    shafts: [],
    birds: null,
    snow: null,
    generation: 0,
    release: null,
  };
}

const VEIL_WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
VEIL_WHITE.wrapS = THREE.RepeatWrapping;
VEIL_WHITE.wrapT = THREE.RepeatWrapping;
VEIL_WHITE.colorSpace = THREE.NoColorSpace;
VEIL_WHITE.needsUpdate = true;

function distanceVeil(material: THREE.Material, haze: { value: THREE.Color }, kind: 'ridge' | 'range') {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uVeilHaze = haze;
    shader.uniforms.tVeilSnow = { value: (material.userData.veilSnow as THREE.Texture | undefined) ?? VEIL_WHITE };
    shader.uniforms.uVeilOn = { value: material.userData.veilSnow ? 1 : 0 };
    material.userData.veilUniforms = shader.uniforms;
    if (!shader.vertexShader.includes('vVeilWorld')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vVeilWorld;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvVeilWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
    }
    const extra = kind === 'range'
      ? `
if (uVeilOn > 0.5) {
  vec3 snow = texture2D(tVeilSnow, vVeilWorld.xz * 0.5).rgb;
  snow = pow(max(snow, vec3(0.0)), vec3(2.2));
  diffuseColor.rgb *= mix(vec3(1.0), snow, 0.22);
}`
      : `
{
  float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 crushed = mix(vec3(luma), diffuseColor.rgb, 0.4);
  float aerial = smoothstep(40.0, 220.0, length(vVeilWorld - cameraPosition));
  diffuseColor.rgb = mix(crushed, uVeilHaze, aerial * 0.62);
}`;
    if (!shader.fragmentShader.includes('vVeilWorld')) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vVeilWorld;\nuniform vec3 uVeilHaze;\nuniform sampler2D tVeilSnow;\nuniform float uVeilOn;',
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\n${extra}`);
    }
  };
  material.customProgramCacheKey = () => `veil-${kind}-${previousKey()}`;
}

function disposeBuilt(built: Built, scene: THREE.Scene) {
  built.release?.();
  built.release = null;
  const environment = scene.environment;
  const environmentIntensity = scene.environmentIntensity;
  scene.clear();
  scene.environment = environment;
  scene.environmentIntensity = environmentIntensity;
  for (const tile of [...built.hero, ...built.fill]) tile.geo.dispose();
  for (const geo of built.geometries) geo.dispose();
  for (const mat of built.materials) mat.dispose();
  for (const tex of built.textures) tex.dispose();
  built.heroMat?.dispose();
  built.fillMat?.dispose();
  built.flowerMat?.dispose();
  built.stars?.dispose();
}

export function mountMeadowWorld(view: HTMLElement, options: MeadowWorldOptions = {}): MeadowHandle {
  const golden = options.grade === 'golden';
  const vista = options.vista === true;
  const heightAt = options.heightAt ?? sampleTerrainHeight;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.4, golden || vista ? 1100 : 260);
  camera.position.set(-4.5, 5.4, 17.5);
  const vistaFog = options.ground === 'snow' ? '#d5e3ee' : options.ground === 'rock' ? '#c9d3da' : '#d2c2ae';
  const fog = new THREE.Fog(golden ? '#e4c9a4' : vista ? vistaFog : '#e3ede7', golden || vista ? 24 : 30, golden || vista ? 140 : 88);
  scene.fog = fog;
  scene.background = golden || options.hdri ? null : fog.color;

  let spline = options.spline?.length ? options.spline : FLYOVER_SPLINE;
  let timeOfDay: TimeOfDay = options.timeOfDay ?? 'scroll';
  let density = options.density ?? 1;
  let shot: MeadowShot | null = null;
  let dead = false;
  let suspended = false;
  let ticket = 0;
  let built = emptyBuilt();
  let curves = makeCurves(spline);
  const rig = { smooth: 0, mx: 0, my: 0, started: -1, dusk: 0, night: 0, shotBlend: 0, progress: 0 };
  const pointer = { x: 0, y: 0 };
  const sun = new THREE.DirectionalLight('#fff3dd', 2.6);
  const hemi = new THREE.HemisphereLight('#eef7ff', '#94ad8e', 0.5);
  const ambient = new THREE.AmbientLight('#ffffff', 0.14);
  const fill = new THREE.DirectionalLight('#d8ece6', 0.16);
  fill.position.set(-14, 9, -16);
  const coolPos = new THREE.Vector3(18, 16, 13).multiplyScalar(1.5);
  const warmPos = new THREE.Vector3(-18, 7, 18);
  const nightPos = new THREE.Vector3(-14, 30, -10);
  const coolCol = new THREE.Color('#fff3dd');
  const warmCol = new THREE.Color('#ffb46b');
  const nightCol = new THREE.Color('#9fb6d8');
  const coolFog = new THREE.Color('#e3ede7');
  const warmFog = new THREE.Color('#eedcc6');
  const nightFog = new THREE.Color('#161f2b');
  const scratch = new THREE.Color();
  const daySun = new THREE.Color('#fff3dd');
  const duskSun = new THREE.Color('#ffc48c');
  const tipDay = new THREE.Color('#93b06a');
  const tipDusk = new THREE.Color('#9aa863');
  const scratchV = new THREE.Vector3();
  const shotP = new THREE.Vector3();
  const shotT = new THREE.Vector3();
  const camP = new THREE.Vector3();
  const camT = new THREE.Vector3();
  const camD = new THREE.Vector3();

  let claim: ((renderer: THREE.WebGLRenderer) => void) | null = null;
  let frameRenderer: THREE.WebGLRenderer | null = null;
  let skyNight: { value: number } | null = null;
  let skyHaze: { value: THREE.Color } | null = null;
  let ridgeHaze: { value: THREE.Color } | null = null;
  let moonMat: THREE.SpriteMaterial | null = null;
  let duskEnv: THREE.Texture | null = null;
  let nightEnv: THREE.Texture | null = null;
  let envsAsked = false;

  const applyShadow = () => {
    const map = qualityProfile().shadowMapSize;
    sun.castShadow = map > 0;
    if (map <= 0) return;
    sun.shadow.mapSize.set(map, map);
    sun.shadow.bias = options.product ? -0.00045 : -0.00025;
    sun.shadow.normalBias = options.product ? 0.025 : 0.012;
    if (options.product) sun.shadow.radius = 2.5;
    const cam = sun.shadow.camera;
    cam.near = options.product ? 0.6 : 1;
    cam.far = options.product ? 48 : golden ? 70 : 90;
    const span = options.product ? 9 : golden ? 12 : 24;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.updateProjectionMatrix();
  };

  const dressGround = (mesh: THREE.Mesh, kind: 'rock' | 'snow', generation: number) => {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const repeat = 85;
    const apply = (maps: THREE.Texture[]) => {
      if (dead || generation !== built.generation) {
        for (const tex of maps) tex.dispose();
        return;
      }
      const [diff, nor, rough, ao] = maps;
      for (const tex of maps) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat, repeat);
        tex.anisotropy = anisotropyForTier();
      }
      diff.colorSpace = THREE.SRGBColorSpace;
      nor.colorSpace = THREE.NoColorSpace;
      rough.colorSpace = THREE.NoColorSpace;
      ao.colorSpace = THREE.NoColorSpace;
      mat.map = diff;
      mat.normalMap = nor;
      mat.roughnessMap = rough;
      mat.aoMap = ao;
      mat.aoMapIntensity = kind === 'snow' ? 0.45 : 0.7;
      mat.color.set('#ffffff');
      mat.needsUpdate = true;
      built.textures.push(...maps);
    };
    if (kind === 'rock') {
      void whenKtx2()
        .then(() =>
          Promise.all([
            ktx2Loader.loadAsync(asset('textures/rocky_terrain_02/diff.ktx2')),
            ktx2Loader.loadAsync(asset('textures/rocky_terrain_02/nor_gl.ktx2')),
            ktx2Loader.loadAsync(asset('textures/rocky_terrain_02/rough.ktx2')),
            ktx2Loader.loadAsync(asset('textures/rocky_terrain_02/ao.ktx2')),
          ]),
        )
        .then(apply)
        .catch(() => undefined);
      void new THREE.TextureLoader().loadAsync(asset('textures/ground037/diff.jpg')).then((tex) => {
        if (dead || generation !== built.generation) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = anisotropyForTier();
        built.textures.push(tex);
        mat.userData.macroSoil = tex;
        mat.userData.macroSoilAmt = 0.55;
        const uniforms = mat.userData.macroUniforms as
          | { tMacroSoil?: { value: THREE.Texture }; uMacroSoil?: { value: number } }
          | undefined;
        if (uniforms?.tMacroSoil && uniforms.uMacroSoil) {
          uniforms.tMacroSoil.value = tex;
          uniforms.uMacroSoil.value = 0.55;
        }
      }).catch(() => undefined);
      return;
    }
    const loader = new THREE.TextureLoader();
    void Promise.all(
      ['diff', 'nor_gl', 'rough', 'ao'].map((name) => loader.loadAsync(asset(`textures/snow_02/${name}.jpg`))),
    )
      .then(apply)
      .catch(() => undefined);
  };

  const paintGrass = (mat: THREE.ShaderMaterial | null, duskAmt: number, nightAmt: number) => {
    if (!mat) return;
    const uniforms = mat.uniforms;
    (uniforms.uSunCol.value as THREE.Color).copy(daySun).lerp(duskSun, duskAmt);
    if (uniforms.uColTip) (uniforms.uColTip.value as THREE.Color).copy(tipDay).lerp(tipDusk, duskAmt * 0.55);
    scratchV.copy(warmPos).normalize();
    (uniforms.uSunDir.value as THREE.Vector3).copy(KEY).lerp(scratchV, duskAmt).normalize();
    uniforms.uSunI.value = (1.15 - duskAmt * 0.3) * (1 - nightAmt * 0.7);
    uniforms.uNight.value = nightAmt;
  };

  const buildCore = () => {
    applyShadow();
    if (golden) {
      sun.color.set('#ffb56a');
      sun.intensity = 2.35;
      sun.position.copy(EVENING_SUN).multiplyScalar(48);
      sun.target.position.set(0, 1.2, 0);
      scene.add(sun.target);
      hemi.color.set('#f3d7b0');
      hemi.groundColor.set('#6a7348');
      hemi.intensity = 0.38;
    } else {
      sun.position.copy(coolPos);
    }
    if (options.product) {
      fill.intensity = 0;
      sun.target.position.set(0, 1.15, 0);
      scene.add(sun.target);
    }
    scene.add(hemi, ambient, sun, fill);
    const segments = qualityProfile().tier === 'ultra' || qualityProfile().tier === 'high' ? 160 : 96;
    const textured = options.ground === 'rock' || options.ground === 'snow';
    const terrain = textured
      ? makeTexturedGround(segments, heightAt, options.ground === 'snow' ? '#e7eef2' : '#8d8680')
      : makeGoldenTerrain(segments, built.textures, built.materials, golden || vista);
    built.geometries.push(terrain.geometry);
    if (textured) {
      const material = terrain.material as THREE.Material;
      if (vista) applyHeightFog(material);
      built.materials.push(material);
    }
    scene.add(terrain);
    if (options.ground === 'rock' || options.ground === 'snow') dressGround(terrain as THREE.Mesh, options.ground, built.generation);
    addSlots(scene, heightAt);
    const releases: Array<() => void> = [];
    const take = (name: string, occupy?: (slot: THREE.Group) => (() => void) | void) => {
      if (!occupy) return;
      const slot = scene.getObjectByName(name);
      if (!(slot instanceof THREE.Group)) return;
      const release = occupy(slot);
      if (typeof release === 'function') releases.push(release);
    };
    take('AuraUnitSlot', options.occupyUnit);
    take('HotTubSlot', options.occupyTub);
    if (releases.length) {
      built.release = () => {
        for (const release of releases) release();
      };
    }
  };

  const placePines = (generation: number) => {
    void loadModel(asset('models/pines.glb')).then((pines) => {
      if (dead || suspended || generation !== built.generation) return;
      pines.scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (!mat?.isMeshStandardMaterial) return;
        mat.roughness = 1;
        mat.metalness = 0;
      });
      const count = Math.max(1, Math.ceil(PATCHES.length * Math.min(1, Math.max(0.35, qualityProfile().grassScale * density))));
      const pinesGroup = placeNormalized(pines.scene, 5.2, PATCHES.slice(0, count), built.sway);
      pinesGroup.name = 'Forest';
      scene.add(pinesGroup);
      pinesGroup.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material;
        const list = Array.isArray(material) ? material : [material];
        for (const item of list) {
          if (!item) continue;
          if (golden) applyHeightFog(item);
          built.materials.push(item);
        }
      });
    }).catch(() => {
      if (!dead && !suspended && generation === built.generation) {
        addLiteForest(
          scene,
          built.geometries,
          built.materials,
          built.textures,
          Math.max(0.35, qualityProfile().grassScale * density),
          () => !dead && !suspended && generation === built.generation,
        );
      }
    });
  };

  const buildForest = () => {
    const profile = qualityProfile();
    const scale = Math.max(0.35, profile.grassScale * density);
    const generation = built.generation;
    if (golden) {
      const alive = () => !dead && !suspended && generation === built.generation;
      if (profile.tier === 'low') {
        placePines(generation);
        placeGoldenProps(scene, built.geometries, built.materials, alive);
        return;
      }
      const grove = mountGoldenGrove(scene, built.geometries, built.materials, built.textures, alive, () => {
        if (alive()) placePines(generation);
      });
      claim = grove.claimRenderer;
      return;
    }
    if (vista) {
      const alive = () => !dead && !suspended && generation === built.generation;
      const grove = mountGoldenGrove(
        scene,
        built.geometries,
        built.materials,
        built.textures,
        alive,
        undefined,
        heightAt,
        options.clear,
        !options.ground,
      );
      claim = grove.claimRenderer;
      return;
    }
    if (profile.tier === 'low') {
      addLiteForest(scene, built.geometries, built.materials, built.textures, scale, () => !dead && !suspended && generation === built.generation);
      return;
    }
    const kept = (list: typeof PATCHES) => {
      const zone = options.clear;
      if (!zone) return list;
      const r2 = zone.r * zone.r;
      return list.filter((item) => {
        const dx = item.pos[0] - zone.x;
        const dz = item.pos[2] - zone.z;
        return dx * dx + dz * dz > r2;
      });
    };
    const count = (list: typeof PATCHES) => {
      const source = kept(list);
      return source.slice(0, Math.max(1, Math.ceil(source.length * Math.min(1, scale))));
    };
    void Promise.all([
      loadModel(asset('models/pines.glb')),
      loadModel(asset('models/pine-teal.glb')),
      loadModel(asset('models/rocks.glb')),
      loadModel(asset('models/lantern.glb')),
    ]).then(([pines, teal, rocks, lantern]) => {
      if (dead || suspended || generation !== built.generation) return;
      const tint = (root: THREE.Object3D, rock = false) => {
        root.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (!mat?.isMeshStandardMaterial) return;
          if (rock) mat.color.set('#828d84');
          mat.roughness = 1;
          mat.metalness = 0;
        });
      };
      tint(pines.scene);
      tint(teal.scene);
      tint(rocks.scene, true);
      const pinesGroup = placeNormalized(pines.scene, 5.2, count(PATCHES), built.sway, heightAt);
      const tealGroup = placeNormalized(teal.scene, 4.3, count(TEAL_PINES), built.sway, heightAt);
      const rockGroup = placeNormalized(rocks.scene, 1.4, count(ROCKS), [], heightAt);
      const lanternGroup = options.ground ? null : placeNormalized(lantern.scene, 0.38, count(LANTERNS), [], heightAt);
      pinesGroup.name = 'Forest';
      tealGroup.name = 'TealForest';
      scene.add(pinesGroup, tealGroup, rockGroup);
      if (lanternGroup) scene.add(lanternGroup);
      for (const group of [pinesGroup, tealGroup, rockGroup, lanternGroup]) {
        if (!group) continue;
        group.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          const material = mesh.material;
          const list = Array.isArray(material) ? material : [material];
          for (const item of list) {
            if (!item) continue;
            if (vista) applyHeightFog(item);
            built.materials.push(item);
          }
        });
      }
    }).catch(() => {
      if (!vista && !dead && !suspended && generation === built.generation) {
        addLiteForest(scene, built.geometries, built.materials, built.textures, scale, () => !dead && !suspended && generation === built.generation);
      }
    });
  };

  const addHdriDome = (generation: number) => {
    if (!options.hdri || golden || options.hdriNight) return;
    const haze = { value: fog.color.clone() };
    skyHaze = haze;
    const hold = new THREE.DataTexture(
      new Uint8Array([
        Math.round(fog.color.r * 255),
        Math.round(fog.color.g * 255),
        Math.round(fog.color.b * 255),
        255,
      ]),
      1,
      1,
    );
    hold.colorSpace = THREE.LinearSRGBColorSpace;
    hold.magFilter = THREE.LinearFilter;
    hold.minFilter = THREE.LinearFilter;
    hold.generateMipmaps = false;
    hold.needsUpdate = true;
    built.textures.push(hold);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHdr: { value: hold as THREE.Texture },
        uHaze: haze,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vDir = world.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uHdr;
        uniform vec3 uHaze;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          vec2 uv = vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5);
          vec3 sky = texture2D(uHdr, uv).rgb;
          float elev = dir.y;
          float hazeAmt = 1.0 - smoothstep(0.02, 0.28, elev);
          sky = mix(sky, uHaze, hazeAmt * 0.78);
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const radius = 420;
    if (camera.far < radius * 1.25) {
      camera.far = radius * 1.35;
      camera.updateProjectionMatrix();
    }
    const geo = new THREE.SphereGeometry(radius, 32, 18);
    built.geometries.push(geo);
    built.materials.push(mat);
    const dome = new THREE.Mesh(geo, mat);
    dome.name = 'HdriSky';
    dome.frustumCulled = false;
    dome.renderOrder = -22;
    scene.add(dome);
    hdrLoader.load(asset(options.hdri), (tex) => {
      if (dead || generation !== built.generation) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      mat.uniforms.uHdr.value = tex;
      built.textures.push(tex);
      scene.background = null;
    });
  };

  const dressBackdrop = (generation: number) => {
    const alive = () => !dead && !suspended && generation === built.generation;
    const haze = { value: fog.color.clone() };
    ridgeHaze = haze;
    for (const mat of built.materials) {
      if (mat.name === 'RidgeRock' || mat.name === 'RidgeSnow') distanceVeil(mat, haze, 'ridge');
      if (mat.name === 'SnowRange') distanceVeil(mat, haze, 'range');
    }
    void whenKtx2()
      .then(() => ktx2Loader.loadAsync(asset('textures/rocky_terrain_02/diff.ktx2')))
      .then((tex) => {
        if (!alive()) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = anisotropyForTier();
        built.textures.push(tex);
        for (const mat of built.materials) {
          if (mat.name !== 'RidgeRock' || !(mat instanceof THREE.MeshBasicMaterial)) continue;
          const span = mat.userData.span as [number, number] | undefined;
          const clone = tex.clone();
          clone.repeat.set(span ? span[0] / 16 : 24, span ? Math.max(2, span[1] / 8) : 6);
          clone.needsUpdate = true;
          built.textures.push(clone);
          mat.map = clone;
          mat.needsUpdate = true;
        }
      })
      .catch(() => undefined);
    void new THREE.TextureLoader().loadAsync(asset('textures/snow_02/diff.jpg')).then((tex) => {
      if (!alive()) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = anisotropyForTier();
      built.textures.push(tex);
      for (const mat of built.materials) {
        if (mat.name === 'SnowRange') {
          mat.userData.veilSnow = tex;
          const uniforms = mat.userData.veilUniforms as
            | { tVeilSnow?: { value: THREE.Texture }; uVeilOn?: { value: number } }
            | undefined;
          if (uniforms?.tVeilSnow && uniforms.uVeilOn) {
            uniforms.tVeilSnow.value = tex;
            uniforms.uVeilOn.value = 1;
          }
        }
        if (mat.name === 'RidgeSnow' && mat instanceof THREE.MeshBasicMaterial) {
          const clone = tex.clone();
          clone.colorSpace = THREE.SRGBColorSpace;
          clone.wrapS = THREE.RepeatWrapping;
          clone.wrapT = THREE.RepeatWrapping;
          clone.repeat.set(6, 2.4);
          clone.needsUpdate = true;
          built.textures.push(clone);
          mat.map = clone;
          mat.needsUpdate = true;
        }
      }
    }).catch(() => undefined);
  };

  const addNightSky = (generation: number) => {
    const nightMix = { value: 0 };
    skyNight = nightMix;
    const hold = new THREE.DataTexture(new Uint8Array([18, 22, 28, 255]), 1, 1);
    hold.colorSpace = THREE.LinearSRGBColorSpace;
    hold.needsUpdate = true;
    built.textures.push(hold);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uFrom: { value: hold as THREE.Texture },
        uTo: { value: hold as THREE.Texture },
        uNight: nightMix,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vDir = world.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFrom;
        uniform sampler2D uTo;
        uniform float uNight;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          vec2 uv = vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5);
          vec3 day = texture2D(uFrom, uv).rgb;
          vec3 night = texture2D(uTo, uv).rgb;
          gl_FragColor = vec4(mix(day, night, clamp(uNight, 0.0, 1.0)), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const geo = new THREE.SphereGeometry(480, 28, 16);
    built.geometries.push(geo);
    built.materials.push(mat);
    const dome = new THREE.Mesh(geo, mat);
    dome.name = 'NightSky';
    dome.frustumCulled = false;
    dome.renderOrder = -20;
    scene.add(dome);
    const take = (url: string, key: 'uFrom' | 'uTo') => {
      hdrLoader.load(asset(url), (tex) => {
        if (dead || generation !== built.generation) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        mat.uniforms[key].value = tex;
        built.textures.push(tex);
        scene.background = null;
      });
    };
    if (options.hdri) take(options.hdri, 'uFrom');
    if (options.hdriNight) take(options.hdriNight, 'uTo');
  };

  const buildAtmosphere = () => {
    const generation = built.generation;
    if (golden) {
      addGoldenSky(scene, built.geometries, built.materials, built.textures, () => !dead && !suspended && generation === built.generation);
    }
    const mountains = new THREE.Group();
    addMountainRange(mountains, built.geometries, built.materials);
    scene.add(mountains);
    built.snow = addSnowRange(scene, built.geometries, built.materials);
    const clouds = addClouds(scene, built.geometries, built.materials);
    built.clouds = clouds.children.slice();
    const stars = addStars(scene);
    built.geometries.push(stars.geo);
    built.stars = stars.mat;
    if (options.hdri && !golden && !options.hdriNight) addHdriDome(generation);
    if (options.hdriNight && options.hdri) addNightSky(generation);
    dressBackdrop(generation);
    if (options.nightScroll) {
      const moonTex = moonDisc();
      if (moonTex) {
        built.textures.push(moonTex);
        moonMat = new THREE.SpriteMaterial({
          map: moonTex,
          color: '#f4efe4',
          transparent: true,
          depthWrite: false,
          fog: false,
          opacity: 0,
        });
        built.materials.push(moonMat);
        const moon = new THREE.Sprite(moonMat);
        moon.name = 'Moon';
        moon.position.set(-70, 36, -150);
        moon.scale.set(16, 16, 1);
        moon.renderOrder = -12;
        moon.frustumCulled = false;
        scene.add(moon);
      }
    }
    const mistTex = softDisc();
    if (mistTex) {
      built.textures.push(mistTex);
      for (const spec of MIST) {
        const mat = new THREE.SpriteMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.15 });
        built.materials.push(mat);
        const sprite = new THREE.Sprite(mat);
        const lift = options.heightAt || options.ground ? heightAt(spec.pos[0], spec.pos[2]) : 0;
        const mistY = lift + spec.pos[1];
        sprite.position.set(spec.pos[0], mistY, spec.pos[2]);
        sprite.scale.set(spec.scale, spec.scale * 0.4, 1);
        sprite.userData.base = spec.pos[0];
        sprite.userData.y = mistY;
        sprite.userData.speed = spec.speed;
        sprite.userData.index = built.mist.length;
        scene.add(sprite);
        built.mist.push(sprite);
      }
    }
    const birdGeo = new THREE.BufferGeometry();
    birdGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, -0.5, 0.16, -0.22, -0.5, 0, 0.02, 0, 0, 0, 0.5, 0, 0.02, 0.5, 0.16, -0.22]), 3),
    );
    built.geometries.push(birdGeo);
    const birdMat = new THREE.MeshBasicMaterial({ color: '#3d4a45', transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    built.materials.push(birdMat);
    const birds = new THREE.InstancedMesh(birdGeo, birdMat, 8);
    birds.frustumCulled = false;
    birds.name = 'Birds';
    scene.add(birds);
    built.birds = birds;
    const shaftTier = qualityProfile().tier;
    const shaftsOn = options.ground ? false : options.product ? false : golden ? shaftTier === 'medium' : shaftTier !== 'low';
    const shaftTex = shaftTexture();
    if (shaftTex && shaftsOn) {
      built.textures.push(shaftTex);
      const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), golden ? EVENING_SUN : KEY);
      for (const spec of SHAFTS) {
        const mat = new THREE.MeshBasicMaterial({
          map: shaftTex,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        });
        built.materials.push(mat);
        built.shafts.push(mat);
        const holder = new THREE.Group();
        holder.position.set(spec.pos[0], sampleTerrainHeight(spec.pos[0], spec.pos[1]) + 0.1, spec.pos[1]);
        holder.quaternion.copy(aim);
        const geo = new THREE.PlaneGeometry(spec.w, spec.len);
        built.geometries.push(geo);
        const a = new THREE.Mesh(geo, mat);
        a.position.y = spec.len / 2;
        a.rotation.y = spec.rot;
        const b = new THREE.Mesh(geo, mat);
        b.position.y = spec.len / 2;
        b.rotation.y = spec.rot + 1.25;
        holder.add(a, b);
        holder.userData.gain = spec.o;
        scene.add(holder);
      }
    }
  };

  const buildMeadow = () => {
    if (options.meadow === false) return;
    const profile = qualityProfile();
    const scale = profile.grassScale * density;
    if (scale <= 0) return;
    const planted = plantGrass(scale);
    built.hero = planted.hero;
    built.fill = planted.fill;
    built.heroMat = makeGrassMaterial(G_HERO);
    built.fillMat = makeGrassMaterial(G_FILL);
    const addTiles = (tiles: GrassTile[], mat: THREE.ShaderMaterial) => {
      for (const tile of tiles) {
        const mesh = new THREE.Mesh(tile.geo, mat);
        tile.geo.userData.mesh = mesh;
        scene.add(mesh);
      }
    };
    addTiles(built.hero, built.heroMat);
    addTiles(built.fill, built.fillMat);
    const flowers = buildFlowerField(
      Math.round(160 * scale),
      profile.tier === 'high' || profile.tier === 'ultra',
      {
        ground: sampleTerrainHeight,
        density: sampleMeadowDensity,
        clearance: (x, z) => sampleMeadowClearance(x, z),
      },
      golden,
    );
    if (flowers) {
      built.flowerMat = makeFlowerMaterial();
      built.geometries.push(flowers.geo);
      scene.add(new THREE.Mesh(flowers.geo, built.flowerMat));
    }
    const generation = built.generation;
    void Promise.all([
      fetch(asset('textures/meadow-atlas.bin')).then((response) => response.arrayBuffer()),
      new THREE.TextureLoader().loadAsync(asset('textures/meadow-atlas.png')),
    ]).then(([buffer, texture]) => {
      if (dead || suspended || generation !== built.generation) {
        texture.dispose();
        return;
      }
      const resource = decodeAtlas(buffer, texture);
      if (!resource) {
        texture.dispose();
        return;
      }
      built.geometries.push(resource.geo);
      built.materials.push(resource.mat);
      built.textures.push(texture);
      built.winds.push(resource.wind);
      const mesh = new THREE.Mesh(resource.geo, resource.mat);
      mesh.name = 'MeadowAtlasField';
      mesh.frustumCulled = false;
      scene.add(mesh);
    }).catch(() => undefined);
  };

  const rebuild = () => {
    skyNight = null;
    skyHaze = null;
    ridgeHaze = null;
    moonMat = null;
    disposeBuilt(built, scene);
    ticket += 1;
    built = emptyBuilt();
    built.generation = ticket;
    claim = null;
    scene.fog = fog;
    scene.background = golden || options.hdri ? null : fog.color;
    curves = makeCurves(spline);
    buildCore();
    window.setTimeout(() => {
      if (dead || suspended) return;
      buildForest();
      window.setTimeout(() => {
        if (dead || suspended) return;
        buildAtmosphere();
        window.setTimeout(() => {
          if (dead || suspended) return;
          buildMeadow();
        }, 32);
      }, 32);
    }, 16);
  };

  const onPointer = (event: PointerEvent) => {
    pointer.x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    pointer.y = -((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const registered = registerView({
    element: view,
    scene,
    camera,
    ao: options.ao ?? false,
    exposure: options.exposure ?? 1.02,
    tone: options.tone ?? 'agx',
    hdri: options.hdri,
    hdriPinned: options.hdriPinned,
    envIntensity: options.envIntensity,
    shadow: options.shadow,
    bloom: options.bloom,
    godrays: options.godrays ? sun : undefined,
    flare: options.flare,
    claimRenderer(renderer) {
      frameRenderer = renderer;
      claim?.(renderer);
      if (envsAsked || !options.hdriNight || !options.hdri) return;
      envsAsked = true;
      void loadEnvironment(renderer, asset(options.hdri)).then((texture) => {
        if (!dead) duskEnv = texture;
      }).catch(() => undefined);
      void loadEnvironment(renderer, asset(options.hdriNight)).then((texture) => {
        if (!dead) nightEnv = texture;
      }).catch(() => undefined);
    },
    update(progress, dt) {
      if (dead || suspended) return;
      const reduced = prefersReducedMotion();
      const raw = options.readProgress ? options.readProgress() : progress;
      const target = clamp01(raw);
      const step = Math.min(dt, 1 / 20);
      if (reduced) {
        rig.smooth = target;
        rig.mx = 0;
        rig.my = 0;
      } else {
        rig.smooth = THREE.MathUtils.damp(rig.smooth, target, 5, step);
        rig.mx = THREE.MathUtils.damp(rig.mx, pointer.x, 3, step);
        rig.my = THREE.MathUtils.damp(rig.my, pointer.y, 3, step);
      }
      if (Math.abs(target - rig.progress) > 0.012 && rig.shotBlend > 0.02) rig.shotBlend = THREE.MathUtils.damp(rig.shotBlend, 0, 1.4, step);
      rig.progress = target;
      if (shot && rig.shotBlend < 1) rig.shotBlend = THREE.MathUtils.damp(rig.shotBlend, 1, 1.6, step);

      const elapsed = motionTime(performance.now());
      const clock = grassClock(reduced, elapsed || FROZEN_T);
      const u = clamp01(rig.smooth);
      const scrollDusk = spline.length >= 13 ? smoothstep(4 / 6, 1, u) : smoothstep(0.45, 1, u);
      let duskTarget = options.product || timeOfDay === 'day' ? 0 : timeOfDay === 'dusk' || timeOfDay === 'night' ? 1 : scrollDusk;
      let nightTarget = options.product ? 0 : timeOfDay === 'night' ? 1 : 0;
      if (options.nightScroll && !options.product) {
        duskTarget = Math.max(duskTarget, smoothstep(0, 0.42, u));
        nightTarget = smoothstep(0.18, 0.92, u);
      }
      rig.dusk = reduced ? duskTarget : THREE.MathUtils.damp(rig.dusk, Math.max(duskTarget, nightTarget), 5, step);
      rig.night = reduced ? nightTarget : THREE.MathUtils.damp(rig.night, nightTarget, 2.2, step);

      if (options.reducedShot && reduced) {
        camera.position.set(REDUCED_SHOT.p[0], REDUCED_SHOT.p[1], REDUCED_SHOT.p[2]);
        camera.lookAt(REDUCED_SHOT.t[0], REDUCED_SHOT.t[1], REDUCED_SHOT.t[2]);
        camera.fov = REDUCED_SHOT.fov;
        camera.updateProjectionMatrix();
      } else if (shot && rig.shotBlend > 0.02) {
        curves.position.getPoint(u, camP);
        curves.target.getPoint(u, camT);
        shotP.set(shot.p[0], shot.p[1], shot.p[2]);
        shotT.set(shot.t[0], shot.t[1], shot.t[2]);
        camP.lerp(shotP, rig.shotBlend);
        camT.lerp(shotT, rig.shotBlend);
        camera.position.copy(camP);
        camera.lookAt(camT);
        camera.fov = THREE.MathUtils.lerp(fovAt(spline, u), shot.fov, rig.shotBlend);
        camera.updateProjectionMatrix();
      } else {
        if (rig.started < 0) rig.started = performance.now();
        const intro = options.intro && !reduced ? easeOutCubic(clamp01((performance.now() - rig.started) / 2200)) : 1;
        curves.position.getPoint(u, camP);
        curves.target.getPoint(u, camT);
        let fov = fovAt(spline, u);
        const aspect = camera.aspect || 1;
        const tall = clamp01((1.55 - aspect) / 1);
        if (tall > 0) {
          camD.subVectors(camP, camT).normalize();
          camP.addScaledVector(camD, tall * 5.5);
          camP.y += tall * 0.8;
          fov *= 1 + tall * 0.32;
        }
        if (!options.product) {
          const opening = 1 - intro;
          camP.z += opening * 4.2;
          camP.y += opening * 0.5;
          fov += opening * 6;
          if (!reduced && !options.steady) {
            const par = 1 - clamp01((u * 6) / 1.6) * 0.5;
            camP.x += rig.mx * 0.5 * par;
            camP.y += rig.my * 0.28 * par;
            camT.x -= rig.mx * 0.16 * par;
            camT.y -= rig.my * 0.09 * par;
          }
        }
        const minY = heightAt(camP.x, camP.z) + 0.7;
        if (camP.y < minY) camP.y = minY;
        camera.position.copy(camP);
        camera.lookAt(camT);
        if (Math.abs(camera.fov - fov) > 1e-3) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
      }

      const duskAmt = golden ? 0.68 : rig.dusk;
      const nightAmt = golden ? 0 : rig.night;
      if (golden) {
        heightFog.color.value.set('#e4c9a4');
        sun.position.copy(camera.position).addScaledVector(EVENING_SUN, 46);
        sun.target.position.copy(camera.position);
        sun.target.updateMatrixWorld();
        sun.color.set('#ffb56a');
        sun.intensity = 2.35;
        hemi.color.set('#f3d7b0');
        hemi.groundColor.set('#6a7348');
        hemi.intensity = 0.38;
        fog.color.copy(heightFog.color.value);
        heightFog.sun.value.copy(EVENING_SUN);
        heightFog.near.value = fog.near;
        heightFog.far.value = fog.far;
      } else {
        scratchV.lerpVectors(coolPos, warmPos, duskAmt).lerp(nightPos, nightAmt);
        sun.position.copy(scratchV);
        scratch.copy(coolCol).lerp(warmCol, duskAmt).lerp(nightCol, nightAmt);
        sun.color.copy(scratch);
        sun.intensity = (2.6 - duskAmt * 0.9) * (1 - nightAmt * 0.82);
        hemi.intensity = (0.5 - duskAmt * 0.18) * (1 - nightAmt * 0.72);
        scratch.copy(coolFog).lerp(warmFog, duskAmt).lerp(nightFog, nightAmt);
        if (options.ground === 'snow') scratch.lerp(coolFog, 0.72);
        fog.color.copy(scratch);
        if (vista) {
          heightFog.color.value.copy(fog.color);
          heightFog.falloff.value = options.ground === 'rock' ? 0.16 : 0.28;
          heightFog.near.value = 16;
          heightFog.far.value = options.ground === 'snow' ? 96 : 130;
          heightFog.sun.value.copy(sun.position).normalize();
        }
      }
      if (options.product) {
        sun.color.set('#fff3dd');
        sun.intensity = 2.35;
        sun.position.copy(KEY).multiplyScalar(22);
        sun.target.position.set(0, 1.15, 0);
        sun.target.updateMatrixWorld();
        hemi.intensity = 0.32;
        ambient.intensity = 0.08;
        fog.color.set('#e7eeea');
        if (scene.background instanceof THREE.Color) scene.background.copy(fog.color);
      }

      if (built.snow) paintSnow(built.snow, duskAmt, nightAmt);
      if (built.stars) built.stars.opacity = nightAmt * 0.95;
      if (moonMat) moonMat.opacity = nightAmt * 0.9;
      if (skyHaze) skyHaze.value.copy(fog.color);
      if (ridgeHaze) ridgeHaze.value.copy(fog.color);
      if (skyNight) skyNight.value = nightAmt;
      if (duskEnv && nightEnv) {
        scene.environment = nightAmt < 0.5 ? duskEnv : nightEnv;
        const edge = nightAmt < 0.5 ? 1 - nightAmt * 2 : (nightAmt - 0.5) * 2;
        scene.environmentIntensity = (options.envIntensity ?? 0.45) * (0.28 + 0.72 * edge);
      }
      paintGrass(built.heroMat, duskAmt, nightAmt);
      paintGrass(built.fillMat, duskAmt, nightAmt);
      paintGrass(built.flowerMat, duskAmt, nightAmt);
      if (golden) {
        for (const mat of [built.heroMat, built.fillMat, built.flowerMat]) {
          if (!mat) continue;
          (mat.uniforms.uSunDir.value as THREE.Vector3).copy(EVENING_SUN);
          (mat.uniforms.uSunCol.value as THREE.Color).set('#ffb56a');
          mat.uniforms.uSunI.value = 1.35;
          if (mat.uniforms.uHeightFog) mat.uniforms.uHeightFog.value = 1;
          if (mat.uniforms.uHeightFogSun) (mat.uniforms.uHeightFogSun.value as THREE.Vector3).copy(EVENING_SUN);
          if (mat.uniforms.uHeightFogColor) (mat.uniforms.uHeightFogColor.value as THREE.Color).copy(heightFog.color.value);
          if (mat.uniforms.uHeightFogFalloff) mat.uniforms.uHeightFogFalloff.value = heightFog.falloff.value;
          mat.uniforms.uFogNear.value = 28;
          mat.uniforms.uFogFar.value = 140;
          (mat.uniforms.uHemiSky.value as THREE.Color).set('#f3d7b0');
          (mat.uniforms.uHemiGround.value as THREE.Color).set('#6a7348');
        }
      }
      const gust = gustEnvelope(clock);
      for (const wind of built.winds) {
        wind.uTime.value = clock;
        wind.uGust.value = gust;
      }
      for (const mat of [built.heroMat, built.fillMat, built.flowerMat]) {
        if (!mat) continue;
        mat.uniforms.uTime.value = clock;
        mat.uniforms.uGust.value = gust;
        (mat.uniforms.uCamPos.value as THREE.Vector3).copy(camera.position);
        mat.uniforms.uNight.value = nightAmt;
        if (mat.uniforms.uProjScale) mat.uniforms.uProjScale.value = 1 / Math.tan((camera.fov * Math.PI) / 360);
        (mat.uniforms.uFogColor.value as THREE.Color).copy(fog.color);
      }
      trimGrass(built.hero, G_HERO, camera.position);
      trimGrass(built.fill, G_FILL, camera.position);

      const wind = reduced ? 0 : 1;
      const wcos = Math.cos(0.62);
      const wsin = Math.sin(0.62);
      built.sway.forEach((tree, index) => {
        const phase = index * 0.7;
        const slow = Math.sin(clock * 0.42 + phase) * 0.5 + 0.5;
        const gust = Math.max(0, Math.sin(clock * 0.85 - tree.position.x * 0.12 - tree.position.z * 0.09)) * 0.55;
        const lean = (0.007 + slow * 0.005 + gust * 0.011) * wind;
        tree.rotation.z = -lean * wcos;
        tree.rotation.x = lean * wsin;
      });
      built.clouds.forEach((cloud) => {
        const phase = cloud.userData.phase as number;
        cloud.position.x = (cloud.userData.baseX as number) + Math.sin(clock * 0.05 + phase) * 1.4 * wind;
        if (options.nightScroll) {
          const mat = (cloud as THREE.Mesh).material as THREE.MeshBasicMaterial;
          if (mat?.color) mat.color.setScalar(1 - nightAmt * 0.94);
        }
      });
      built.mist.forEach((sprite) => {
        const index = sprite.userData.index as number;
        const speed = sprite.userData.speed as number;
        sprite.position.x = (sprite.userData.base as number) + Math.sin(clock * speed * 2 + index * 1.8) * 2.4 * (reduced ? 0 : 1);
        sprite.position.y = (sprite.userData.y as number) + Math.sin(clock * speed + index) * 0.3 * (reduced ? 0 : 1);
        if (options.nightScroll) sprite.material.opacity = 0.15 * (1 - nightAmt);
      });
      if (options.nightScroll && built.birds) {
        const birdMat = built.birds.material as THREE.MeshBasicMaterial;
        birdMat.opacity = 0.55 * (1 - nightAmt);
      }
      if (built.birds) {
        const dummy = new THREE.Object3D();
        for (let i = 0; i < 8; i += 1) {
          const phase = (i / 8) * Math.PI * 2;
          const radius = 26 + (i % 4) * 5.5;
          const angle = (reduced ? FROZEN_T : clock) * 0.055 + phase;
          dummy.position.set(Math.cos(angle) * radius, 17 + Math.sin(angle * 1.7 + phase) * 2.6 + (i % 3) * 1.4, Math.sin(angle) * radius * 0.72 - 6);
          dummy.rotation.set(0, -angle + Math.PI / 2, Math.sin(angle * 2.2 + phase) * 0.22);
          const beat = reduced ? 1 : 0.72 + Math.sin(clock * 6.4 + phase * 3.1) * 0.28;
          dummy.scale.set(1.05 * beat, 1, 1.05);
          dummy.updateMatrix();
          built.birds.setMatrixAt(i, dummy.matrix);
        }
        built.birds.instanceMatrix.needsUpdate = true;
      }
      options.onFrame?.({
        camera,
        dt: step,
        dusk: rig.dusk,
        night: rig.night,
        reduced,
        renderer: frameRenderer,
      });

      const shaftWindow = smoothstep(0.55 / 6, 1.3 / 6, u) * (1 - smoothstep(2.6 / 6, 3.4 / 6, u));
      built.shafts.forEach((mat, index) => {
        mat.opacity = (reduced ? 0 : shaftWindow * (1 - nightAmt) * SHAFTS[index].o * 0.32);
      });
    },
    suspend() {
      suspended = true;
      disposeBuilt(built, scene);
      built = emptyBuilt();
    },
    resume() {
      if (dead) return;
      suspended = false;
      rebuild();
    },
  });

  rebuild();
  const stopQuality = onQuality((next) => {
    if (dead || next.tier === 'off') return;
    if (!suspended) rebuild();
  });

  return {
    setProgress(t: number) {
      registered.setProgress(t);
    },
    setTimeOfDay(next: TimeOfDay) {
      timeOfDay = next;
    },
    setDensity(n: number) {
      density = n;
      if (!dead && !suspended) rebuild();
    },
    setShot(next: MeadowShot | null) {
      shot = next;
      if (next) rig.shotBlend = Math.max(rig.shotBlend, 0.15);
      else rig.shotBlend = 0;
    },
    destroy() {
      if (dead) return;
      dead = true;
      stopQuality();
      window.removeEventListener('pointermove', onPointer);
      registered.destroy();
      disposeBuilt(built, scene);
    },
  };
}

function decodeAtlas(buffer: ArrayBuffer, texture: THREE.Texture) {
  if (buffer.byteLength < 24) return null;
  const view = new DataView(buffer);
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
  const version = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  const stride = view.getUint32(16, true);
  if (magic !== 'AURAMDW1' || version !== 1 || stride !== 48) return null;
  if (buffer.byteLength !== 24 + count * stride) return null;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count * 2);
  const yaws = new Float32Array(count);
  const uvRects = new Float32Array(count * 4);
  const seeds = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = 24 + index * stride;
    positions[index * 3] = view.getFloat32(offset, true);
    positions[index * 3 + 1] = view.getFloat32(offset + 4, true);
    positions[index * 3 + 2] = view.getFloat32(offset + 8, true);
    sizes[index * 2] = view.getFloat32(offset + 12, true);
    sizes[index * 2 + 1] = view.getFloat32(offset + 16, true);
    yaws[index] = view.getFloat32(offset + 20, true);
    const sourceKind = view.getFloat32(offset + 40, true);
    const seed = view.getFloat32(offset + 44, true);
    const cell = Math.min(5, Math.floor(seed * 6));
    uvRects[index * 4] = sourceKind === 0 ? view.getFloat32(offset + 24, true) : (cell % 4) / 4;
    uvRects[index * 4 + 1] = sourceKind === 0 ? view.getFloat32(offset + 28, true) : Math.floor(cell / 4) / 2;
    uvRects[index * 4 + 2] = view.getFloat32(offset + 32, true);
    uvRects[index * 4 + 3] = view.getFloat32(offset + 36, true);
    seeds[index] = seed;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, 0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5]), 3),
  );
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]), 1));
  geo.setAttribute('aAtlasPos', new THREE.InstancedBufferAttribute(positions, 3));
  geo.setAttribute('aAtlasSize', new THREE.InstancedBufferAttribute(sizes, 2));
  geo.setAttribute('aAtlasYaw', new THREE.InstancedBufferAttribute(yaws, 1));
  geo.setAttribute('aAtlasUv', new THREE.InstancedBufferAttribute(uvRects, 4));
  geo.setAttribute('aAtlasSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, 22), 76);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: 0.42,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  const wind = { uTime: { value: FROZEN_T }, uWindDir: { value: WIND_DIR.clone() }, uGust: { value: gustEnvelope(FROZEN_T) } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uWindDir = wind.uWindDir;
    shader.uniforms.uGust = wind.uGust;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aAtlasPos;
attribute vec2 aAtlasSize;
attribute float aAtlasYaw;
attribute vec4 aAtlasUv;
attribute float aAtlasSeed;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uGust;`,
      )
      .replace('#include <uv_vertex>', `#ifdef USE_MAP
  vMapUv = ( mapTransform * vec3( aAtlasUv.xy + uv * aAtlasUv.zw, 1 ) ).xy;
#endif`)
      .replace(
        '#include <begin_vertex>',
        `vec3 atlasLocal = position;
atlasLocal.xz *= aAtlasSize.x;
atlasLocal.y *= aAtlasSize.y;
float atlasTurn = aAtlasYaw + (aAtlasSeed - 0.5) * 0.08;
float atlasCos = cos(atlasTurn);
float atlasSin = sin(atlasTurn);
vec3 transformed = vec3(
  atlasLocal.x * atlasCos - atlasLocal.z * atlasSin,
  atlasLocal.y,
  atlasLocal.x * atlasSin + atlasLocal.z * atlasCos
) + aAtlasPos;
float windPh = aAtlasSeed * 6.2831853;
float windTravelling = sin(uTime * 0.62 - dot(aAtlasPos.xz, uWindDir) * 0.135);
float windSway = windTravelling * 0.7;
float windBendT = position.y * position.y;
float windAmp = (0.34 + 0.66 * uGust) * aAtlasSize.y * 0.16;
transformed.xz += uWindDir * windBendT * windSway * windAmp;
transformed.y -= windBendT * abs(windSway) * windAmp * 0.18;`,
      );
  };
  return { geo, mat, wind };
}
