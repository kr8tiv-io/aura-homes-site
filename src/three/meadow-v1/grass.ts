/*
  Grass field v6, hero and filler. The blade program is the one from the
  earlier meadow: travelling gusts, species clumps, and a per-tile trim.
  Colour stays linear so the shared stage can tone-map it once.
*/
import * as THREE from 'three';
import { FROZEN_T, WIND_DIR, gustEnvelope } from './flora';
import {
  meadowRandom,
  sampleMeadowClearance,
  sampleMeadowDensity,
  sampleTerrainHeight,
} from './meadow/field';

export type GrassLayerCfg = {
  near: number;
  far: number;
  pmin: number;
  band: number;
  tile: number;
  segs: number;
};

export const G_HERO: GrassLayerCfg = { near: 16, far: 34, pmin: 0.04, band: 0.16, tile: 8, segs: 4 };
export const G_FILL: GrassLayerCfg = { near: 8, far: 16, pmin: 0, band: 0.16, tile: 6, segs: 1 };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const keepFraction = (cfg: GrassLayerCfg, distance: number) =>
  1 + (cfg.pmin - 1) * smooth01(cfg.near, cfg.far, distance);

function grassBlade(segs: number) {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  if (segs === 1) {
    pos.push(-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0);
    uvs.push(0, 0, 1, 0, 0.5, 1);
    idx.push(0, 1, 2);
    return { pos: new Float32Array(pos), uvs: new Float32Array(uvs), idx: new Uint16Array(idx) };
  }
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    if (i === segs) {
      pos.push(0, t, 0);
      uvs.push(0.5, t);
    } else {
      pos.push(-0.5, t, 0, 0.5, t, 0);
      uvs.push(0, t, 1, t);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segs - 1) * 2;
  idx.push(last, last + 1, last + 2);
  return { pos: new Float32Array(pos), uvs: new Float32Array(uvs), idx: new Uint16Array(idx) };
}

const GRASS_VERT = /* glsl */ `
precision highp float;
attribute vec3 aPos;
attribute vec4 aRand;
attribute float aClear;
uniform float uTime;
uniform vec4 uLod;
uniform float uRichWind;
uniform vec2 uWindDir;
uniform vec3 uCamPos;
uniform float uProjScale;
uniform float uGust;
varying float vT;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vHue;
varying vec3 vGround;
varying float vSpecies;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 groundColor(vec2 p){
  vec3 cA = vec3(0.2661, 0.4451, 0.2307);
  vec3 cB = vec3(0.3711, 0.5395, 0.3005);
  vec3 cC = vec3(0.4734, 0.5520, 0.2502);
  float n1 = 0.5 + 0.5 * sin(p.x * 0.23 + p.y * 0.17 + 1.2);
  float n2 = 0.5 + 0.5 * sin(p.x * 0.61 - p.y * 0.43 + 4.0);
  return mix(mix(cA, cB, n1), cC, n2 * 0.25);
}
float meadowD(vec2 p){
  float r = length(p);
  float ring = 1.0 - smoothstep(16.0, 35.0, r);
  float corr = (1.0 - smoothstep(9.0, 18.0, abs(p.x))) * smoothstep(5.5, 11.0, p.y) * (1.0 - smoothstep(33.0, 41.0, p.y));
  float scat = 0.34 * (1.0 - smoothstep(28.0, 48.0, r));
  float d = max(ring, max(corr, scat));
  d *= 1.0 - smoothstep(6.0, 15.0, -p.y);
  return clamp(d, 0.0, 1.0);
}
void main(){
  float t = uv.y;
  float side = position.x;
  vec3 base = aPos;
  float dist = distance(base, uCamPos);
  float p = mix(1.0, uLod.x, smoothstep(uLod.y, uLod.z, dist));
  float projH = (aRand.y * aClear) * uProjScale / max(dist, 0.001);
  p *= smoothstep(0.0040, 0.020, projH);
  float vis = 1.0 - smoothstep(p - uLod.w, p, aRand.w);
  vis *= smoothstep(0.18, 0.55, dist);
  float sp = h21(floor(base.xz * 0.55) + 19.3);
  float isTuft = smoothstep(0.48, 0.54, sp) * (1.0 - smoothstep(0.78, 0.84, sp));
  float isStem = smoothstep(0.78, 0.84, sp);
  float hMul = mix(1.0, 0.66, isTuft) * mix(1.0, 1.75, isStem);
  float wMul = mix(1.0, 1.12, isTuft) * mix(1.0, 0.5, isStem);
  float bendMul = mix(1.0, 1.4, isTuft) * mix(1.0, 0.3, isStem);
  float bh = aRand.y * aClear * vis * hMul;
  float bw = aRand.z * wMul;
  bw *= 1.0 + dist * 0.010;
  vec2 wd = normalize(uWindDir);
  float stiff = 0.74 + 0.52 * h21(base.xz * 4.3 + 5.1);
  float ph = aRand.w * 6.2831853;
  float travelling = sin(uTime * 0.62 - dot(base.xz, wd) * 0.135);
  float crossWave = sin(uTime * 0.41 + base.x * 0.082 - base.z * 0.057 + ph);
  float ripple = sin(uTime * 1.85 + base.x * 0.31 + base.z * 0.23 + ph * 0.5);
  float front = 0.5 + 0.5 * travelling;
  float amp = (0.34 + 0.66 * front * uGust) / stiff;
  float lean;
  vec2 dir;
  if (uRichWind > 0.5) {
    float flutter = sin(uTime * 2.6 / stiff + ph) * 0.16;
    lean = (0.66 + travelling * 0.30 + ripple * 0.18 + flutter) * amp;
    float yaw = crossWave * 0.52 + ripple * 0.12;
    dir = wd * cos(yaw) + vec2(-wd.y, wd.x) * sin(yaw);
  } else {
    lean = (0.66 + travelling * 0.34 + 0.14 * sin(uTime * 2.6 / stiff + ph)) * amp;
    dir = wd;
  }
  float la = h21(floor(base.xz * 3.7)) * 6.2831853;
  vec2 rest = vec2(cos(la), sin(la)) * mix(0.05, 0.26, h21(base.xz * 1.9 + 7.0));
  vec2 restH = rest * bendMul;
  vec2 windH = dir * lean * 0.60 * bendMul;
  vec2 horiz = restH + windH;
  float hl = length(horiz);
  vec3 tipOff = normalize(vec3(horiz.x, max(1.0 - hl * 0.42, 0.22), horiz.y)) * bh;
  vec2 midH = restH * 0.32 + windH * 0.15;
  vec3 midOff = normalize(vec3(midH.x, 0.76, midH.y)) * bh * 0.5;
  float omt = 1.0 - t;
  vec3 curve = 2.0 * omt * t * midOff + t * t * tipOff;
  vec3 wDir3 = vec3(cos(aRand.x + position.z), 0.0, sin(aRand.x + position.z));
  float taper = mix(1.0 - 0.76 * t * t, 1.0 - 0.40 * t, isTuft);
  float head = 1.0 + isStem * 3.2 * smoothstep(0.70, 0.85, t) * (1.0 - smoothstep(0.90, 1.0, t));
  float w = bw * taper * head;
  vec3 viewDir = normalize(uCamPos - base);
  float edgeOn = abs(dot(viewDir, wDir3));
  w *= mix(1.0, 1.3, edgeOn);
  vec3 world = base + curve + wDir3 * side * w;
  vec3 tang = 2.0 * (1.0 - 2.0 * t) * midOff + 2.0 * t * tipOff;
  vec3 nrm = normalize(cross(wDir3, normalize(tang + vec3(0.0, 1e-4, 0.0))));
  nrm = normalize(nrm + wDir3 * side * 1.1);
  vT = t;
  vNormal = nrm;
  vWorld = world;
  vHue = h21(floor(base.xz * 2.3) + 3.1);
  float md = meadowD(base.xz);
  vGround = mix(groundColor(base.xz), vec3(0.0744, 0.1442, 0.0546), md * 0.45) * (1.0 - 0.35 * md);
  vSpecies = sp;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const GRASS_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColTip;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uCamPos;
uniform float uNight;
uniform float uSunI;
varying float vT;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vHue;
varying vec3 vGround;
varying float vSpecies;
void main(){
  vec3 tip = uColTip;
  tip = mix(tip, tip * vec3(1.10, 1.05, 0.88), smoothstep(0.78, 0.86, vSpecies));
  vec3 col = mix(vGround, tip, pow(vT, 1.35));
  col *= (0.88 + vHue * 0.26) * vec3(1.0 + vHue * 0.04 - 0.02, 1.0, 1.0 - vHue * 0.04 + 0.02);
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float ndl = dot(N, uSunDir) * 0.5 + 0.5;
  vec3 light = uSunCol * uSunI * ndl * ndl;
  light += mix(uHemiGround, uHemiSky, N.y * 0.5 + 0.5) * 0.55;
  vec3 V = normalize(uCamPos - vWorld);
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  light += uSunCol * back * 0.24 * vT;
  float ao = mix(0.68, 1.04, smoothstep(0.0, 0.6, vT));
  col *= light * ao;
  vec3 H = normalize(V + uSunDir);
  col += uSunCol * pow(max(dot(N, H), 0.0), 26.0) * 0.06 * vT;
  col = mix(col, col * vec3(0.34, 0.40, 0.54), uNight);
  col = min(col, vec3(2.2));
  float fd = distance(uCamPos, vWorld);
  col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, fd));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeGrassMaterial(cfg: GrassLayerCfg) {
  return new THREE.ShaderMaterial({
    vertexShader: GRASS_VERT,
    fragmentShader: GRASS_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: FROZEN_T },
      uLod: { value: new THREE.Vector4(cfg.pmin, cfg.near, cfg.far, cfg.band) },
      uRichWind: { value: cfg.segs >= 4 ? 1 : 0 },
      uWindDir: { value: WIND_DIR.clone() },
      uCamPos: { value: new THREE.Vector3() },
      uProjScale: { value: 2.7 },
      uGust: { value: gustEnvelope(FROZEN_T) },
      uColTip: { value: new THREE.Color('#93b06a') },
      uSunDir: { value: new THREE.Vector3(18, 16, 13).normalize() },
      uSunCol: { value: new THREE.Color('#fff3dd') },
      uSunI: { value: 1.15 },
      uHemiSky: { value: new THREE.Color('#dcecf4') },
      uHemiGround: { value: new THREE.Color('#7a8b5e') },
      uFogColor: { value: new THREE.Color('#e3ede7') },
      uFogNear: { value: 30 },
      uFogFar: { value: 88 },
      uNight: { value: 0 },
    },
  });
}

export type GrassTile = {
  id: string;
  geo: THREE.InstancedBufferGeometry;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  n: number;
};

function plantTile(
  id: string,
  cfg: GrassLayerCfg,
  x0: number,
  z0: number,
  capacity: number,
  seed: number,
  hero: boolean,
): GrassTile | null {
  const positions = new Float32Array(capacity * 3);
  const random = new Float32Array(capacity * 4);
  const clearance = new Float32Array(capacity);
  let count = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  const columns = Math.max(1, Math.ceil(Math.sqrt(capacity)));
  for (let candidate = 0; candidate < capacity; candidate += 1) {
    const row = Math.floor(candidate / columns);
    const column = candidate % columns;
    const key = seed * 10007 + candidate;
    const x = x0 + ((column + meadowRandom(key, 1)) / columns) * cfg.tile;
    const z = z0 + ((row + meadowRandom(key, 2)) / columns) * cfg.tile;
    const density = sampleMeadowDensity(x, z);
    if (density < 0.015 || meadowRandom(key, 3) > density) continue;
    const clear = sampleMeadowClearance(x, z, !hero);
    if (clear < 0.055) continue;
    const y = sampleTerrainHeight(x, z) - 0.02;
    positions[count * 3] = x;
    positions[count * 3 + 1] = y;
    positions[count * 3 + 2] = z;
    random[count * 4] = meadowRandom(key, 4) * Math.PI * 2;
    random[count * 4 + 1] = hero ? 0.18 + Math.pow(meadowRandom(key, 5), 1.5) * 0.34 : 0.08 + meadowRandom(key, 5) * 0.1;
    random[count * 4 + 2] = hero ? 0.026 + meadowRandom(key, 6) * 0.018 : 0.045 + meadowRandom(key, 6) * 0.04;
    random[count * 4 + 3] = meadowRandom(key, 7);
    clearance[count] = hero ? clear : Math.sqrt(clear);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    count += 1;
  }
  if (count < 4) return null;
  const order = Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => random[a * 4 + 3] - random[b * 4 + 3],
  );
  const sortedPositions = new Float32Array(count * 3);
  const sortedRandom = new Float32Array(count * 4);
  const sortedClearance = new Float32Array(count);
  order.forEach((source, destination) => {
    sortedPositions.set(positions.subarray(source * 3, source * 3 + 3), destination * 3);
    sortedRandom.set(random.subarray(source * 4, source * 4 + 4), destination * 4);
    sortedClearance[destination] = clearance[source];
  });
  const blade = grassBlade(cfg.segs);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(blade.pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(blade.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(blade.idx, 1));
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(sortedPositions, 3));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(sortedRandom, 4));
  geo.setAttribute('aClear', new THREE.InstancedBufferAttribute(sortedClearance, 1));
  geo.instanceCount = count;
  const cx = x0 + cfg.tile / 2;
  const cz = z0 + cfg.tile / 2;
  const cy = (minY + maxY) / 2;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy + 0.25, cz), Math.hypot(cfg.tile, cfg.tile) / 2 + 0.8);
  return { id, geo, cx, cy, cz, radius: Math.hypot(cfg.tile, cfg.tile) / 2 + 0.4, n: count };
}

export function plantGrass(scale: number): { hero: GrassTile[]; fill: GrassTile[] } {
  const hero: GrassTile[] = [];
  const fill: GrassTile[] = [];
  const amount = Math.max(0.2, scale);
  let seed = 3;
  for (let z = -8; z < 40; z += G_HERO.tile) {
    for (let x = -32; x < 32; x += G_HERO.tile) {
      seed += 1;
      const density = sampleMeadowDensity(x + 4, z + 4);
      if (density < 0.06) continue;
      const capacity = Math.round((density > 0.35 ? 220 : 90) * amount);
      const tile = plantTile(`h-${x}-${z}`, G_HERO, x, z, capacity, seed, true);
      if (tile) hero.push(tile);
    }
  }
  for (let z = 0; z < 32; z += G_FILL.tile) {
    for (let x = -24; x < 24; x += G_FILL.tile) {
      seed += 1;
      if (sampleMeadowDensity(x + 3, z + 3) < 0.08) continue;
      const tile = plantTile(`f-${x}-${z}`, G_FILL, x, z, Math.round(160 * amount), seed, false);
      if (tile) fill.push(tile);
    }
  }
  return { hero, fill };
}

export function trimGrass(tiles: GrassTile[], cfg: GrassLayerCfg, camera: THREE.Vector3) {
  for (const tile of tiles) {
    const dx = camera.x - tile.cx;
    const dy = camera.y - tile.cy;
    const dz = camera.z - tile.cz;
    const distance = Math.max(0, Math.hypot(dx, dy, dz) - tile.radius);
    const fraction = keepFraction(cfg, distance);
    const mesh = tile.geo.userData.mesh as THREE.Mesh | undefined;
    if (!mesh) continue;
    if (fraction <= 0.001) {
      mesh.visible = false;
      continue;
    }
    const count = Math.ceil(Math.min(1, fraction + 0.02) * tile.n);
    if (count < 2) {
      mesh.visible = false;
    } else {
      mesh.visible = true;
      tile.geo.instanceCount = count;
    }
  }
}

export function grassClock(frozen: boolean, elapsed: number) {
  return frozen ? FROZEN_T : elapsed;
}
