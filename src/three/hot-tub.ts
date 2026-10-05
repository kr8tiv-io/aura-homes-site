/*
  One cedar tub for the meadow passage, the resort deck, and the later builder.
  The stove is Poly Haven barrel_stove. The door glow follows FakeGlowMaterial
  (MIT, https://github.com/ektogamat/fake-glow-material-threejs). The high-tier
  flame follows THREE.Fire (MIT, https://github.com/mattatz/THREE.Fire).
  Floor caustics follow the baked-loop idea in threejs-caustics (BSD-3,
  https://github.com/martinRenou/threejs-caustics).
*/
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ktx2Loader, loadModel, whenKtx2 } from './loaders';
import { motionTime, qualityProfile } from './quality';
import { HOT_TUB_SLOT } from './meadow-v1/meadow/geometry';
import { sampleTerrainHeight } from './meadow-v1/meadow/field';
import { createPolycarbonateMaterial } from './aura-unit';
import { loadCustomModel, placeCustomModel } from './custom-models';
import { createSteam, type SteamFrame } from './fx/steam';

export type TubFrame = {
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer | null;
  dusk: number;
  night: number;
  reduced: boolean;
};

export type HotTub = {
  object: THREE.Group;
  /** Tub, stove, and anything attached for the steam depth pass. Not the steam card. */
  body: THREE.Group;
  update: (frame: TubFrame) => void;
  dispose: () => void;
};

export type TubPlace = {
  object: THREE.Group;
  update: (frame: TubFrame) => void;
  dispose: () => void;
};

const STAVES = 40;
const RADIUS = 0.9;
const HEIGHT = 1;
const WATER_Y = 0.78;
const DECK_TOP = 0.08;
const FIRE = new THREE.Color('#ff7a2a');
const FIRE_WARM = new THREE.Color('#ffb060');

function asset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\//, '');
}

function hash(index: number) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function beveled(w: number, h: number, d: number, radius: number) {
  const geo = new RoundedBoxGeometry(w, h, d, 2, radius);
  const uv = geo.getAttribute('uv');
  if (uv) geo.setAttribute('uv2', uv);
  return geo;
}

function taperStave(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    const k = y / HEIGHT + 0.5;
    const taper = 1 - k * 0.12;
    pos.setX(i, pos.getX(i) * taper);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function tune(tex: THREE.Texture, rx: number, ry: number) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = 8;
  return tex;
}

function causticMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i += 1) {
    const x = (hash(i) * 220) + 18;
    const y = (hash(i + 40) * 220) + 18;
    const r = 10 + hash(i + 9) * 22;
    const fade = g.createRadialGradient(x, y, 0, x, y, r);
    fade.addColorStop(0, 'rgba(210, 255, 236, 0.7)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = fade;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function contactMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const fade = g.createRadialGradient(128, 128, 20, 128, 128, 120);
  fade.addColorStop(0, 'rgba(0,0,0,0.55)');
  fade.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.beginPath();
  g.arc(128, 128, 120, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float glow = pow(1.0 - clamp(length(p), 0.0, 1.0), 3.6);
  if (glow < 0.02) discard;
  gl_FragColor = vec4(uColor * uIntensity, glow);
}
`;

const FLAME_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main() {
  float n = noise(vec2(vUv.x * 4.0, vUv.y * 6.0 - uTime * 1.5));
  n += 0.5 * noise(vec2(vUv.x * 8.0 + 2.2, vUv.y * 11.0 - uTime * 2.1));
  float flame = smoothstep(0.42, 0.9, n + (1.0 - vUv.y) * 0.55);
  float mask = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x);
  mask *= smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.62, vUv.y);
  float alpha = flame * mask;
  if (alpha < 0.04) discard;
  vec3 col = mix(vec3(0.85, 0.16, 0.02), vec3(1.0, 0.62, 0.18), pow(clamp(flame, 0.0, 1.0), 1.5));
  float hot = smoothstep(0.78, 1.0, flame) * smoothstep(0.15, 0.0, abs(vUv.x - 0.5));
  gl_FragColor = vec4(col * mix(0.65, 2.1, hot), alpha);
}
`;

const FLOOR_DARKEN = /* glsl */ `
float tubR = length(vEmissiveMapUv - vec2(0.5)) * 2.0;
diffuseColor.rgb *= mix(vec3(0.22, 0.36, 0.34), vec3(1.0, 0.92, 0.82), smoothstep(0.12, 0.92, tubR));
`;

function flicker(time: number) {
  return 0.86
    + Math.sin(time * 3.1) * 0.07
    + Math.sin(time * 7.4 + 1.7) * 0.04
    + Math.sin(time * 12.8 + 0.4) * 0.02;
}

/**
 * Scroll push-in for the tub passage. The path stays above the rim, then
 * settles inside the opening at the water, looking toward the stove door.
 */
export function steamOrbit(): { p: [number, number, number]; t: [number, number, number]; fov: number }[] {
  const cx = HOT_TUB_SLOT.x;
  const cz = HOT_TUB_SLOT.z;
  const waterY = sampleTerrainHeight(cx, cz) + DECK_TOP + WATER_Y;
  return [
    { p: [cx + 2.4, waterY + 2.35, cz + 7.4], t: [cx - 0.4, waterY + 0.35, cz - 0.2], fov: 34 },
    { p: [cx + 3.6, waterY + 1.75, cz + 3.4], t: [cx - 0.15, waterY + 0.22, cz], fov: 32 },
    { p: [cx + 1.35, waterY + 1.15, cz + 0.7], t: [cx - 0.1, waterY + 0.1, cz], fov: 34 },
    { p: [cx + 0.62, waterY + 0.42, cz + 0.22], t: [cx - 0.25, waterY + 0.02, cz - 0.02], fov: 46 },
  ];
}

export type TubWater = {
  material: THREE.MeshPhysicalMaterial;
  uniforms: { uWaterTime: { value: number } };
  textures: THREE.Texture[];
};

/** The tub water from the meadow passage. Callers share one material so the scroll stays in step. */
export function createTubWaterMaterial(): TubWater {
  const normal1 = new THREE.TextureLoader().load(asset('textures/water/Water_1_M_Normal.jpg'));
  const normal2 = new THREE.TextureLoader().load(asset('textures/water/Water_2_M_Normal.jpg'));
  const textures: THREE.Texture[] = [];
  for (const tex of [normal1, normal2]) {
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    textures.push(tex);
  }
  const material = new THREE.MeshPhysicalMaterial({
    color: '#e4f0ee',
    metalness: 0,
    roughness: 0.05,
    transmission: 0.9,
    thickness: 0.2,
    ior: 1.333,
    specularIntensity: 1,
    envMapIntensity: 1.15,
    attenuationColor: '#2f4a48',
    attenuationDistance: 0.6,
    normalMap: normal1,
    normalScale: new THREE.Vector2(0.16, 0.16),
    transparent: true,
    side: THREE.DoubleSide,
  });
  material.name = 'water';
  const uniforms = { uWaterTime: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tWater2 = { value: normal2 };
    shader.uniforms.uWaterTime = uniforms.uWaterTime;
    shader.fragmentShader = `uniform sampler2D tWater2;\nuniform float uWaterTime;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `
        vec3 mapN = texture2D(normalMap, vNormalMapUv + vec2(uWaterTime * 0.012, uWaterTime * 0.007)).xyz * 2.0 - 1.0;
        vec3 mapN2 = texture2D(tWater2, vNormalMapUv * 1.35 + vec2(-uWaterTime * 0.009, uWaterTime * 0.014)).xyz * 2.0 - 1.0;
        mapN = normalize(vec3(mapN.xy + mapN2.xy * 0.65, mapN.z));
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);
      `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `
        float auraFres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 4.0);
        outgoingLight += auraFres * vec3(0.22, 0.28, 0.3);
        #include <output_fragment>
      `,
    );
  };
  return { material, uniforms, textures };
}

export function createHotTub(): HotTub {
  const object = new THREE.Group();
  object.name = 'HotTub';
  const body = new THREE.Group();
  body.name = 'HotTubBody';
  object.add(body);

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const woods: THREE.MeshStandardMaterial[] = [];
  const metals: THREE.MeshStandardMaterial[] = [];
  let alive = true;
  let releasePlaced = () => {};

  const wood = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.64,
    metalness: 0.02,
    envMapIntensity: 0.28,
  });
  wood.color.setRGB(1.62, 1.08, 0.68);
  wood.vertexColors = true;
  const wet = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.36,
    metalness: 0.04,
    envMapIntensity: 0.4,
  });
  wet.color.setRGB(0.78, 0.62, 0.5);
  const band = new THREE.MeshStandardMaterial({
    color: '#2c3238',
    roughness: 0.62,
    metalness: 0.84,
    envMapIntensity: 0.5,
  });
  woods.push(wood, wet);
  metals.push(band);
  mats.push(wood, wet, band);

  const staveGeo = beveled(0.152, HEIGHT, 0.04, 0.004);
  taperStave(staveGeo);
  geos.push(staveGeo);
  const staves = new THREE.InstancedMesh(staveGeo, wood, STAVES);
  staves.name = 'Staves';
  staves.castShadow = true;
  staves.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  for (let i = 0; i < STAVES; i += 1) {
    const angle = (i / STAVES) * Math.PI * 2;
    const wobble = (hash(i) - 0.5) * 0.012;
    dummy.position.set(Math.cos(angle) * 0.872, HEIGHT / 2, Math.sin(angle) * 0.872);
    dummy.rotation.set((hash(i + 3) - 0.5) * 0.02, Math.PI / 2 - angle + wobble, (hash(i + 6) - 0.5) * 0.015);
    dummy.updateMatrix();
    staves.setMatrixAt(i, dummy.matrix);
    tint.setRGB(0.96 + hash(i + 1) * 0.06, 0.94 + hash(i + 2) * 0.06, 0.9 + hash(i + 4) * 0.08);
    staves.setColorAt(i, tint);
  }
  staves.instanceMatrix.needsUpdate = true;
  if (staves.instanceColor) staves.instanceColor.needsUpdate = true;
  body.add(staves);

  const addMesh = (
    name: string,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    cast = true,
  ) => {
    const uv = geo.getAttribute('uv');
    if (uv && !geo.getAttribute('uv2')) geo.setAttribute('uv2', uv);
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };

  const rim = addMesh('Rim', new THREE.TorusGeometry(0.905, 0.05, 10, 48), wood, 0, 0.98, 0);
  rim.rotation.x = Math.PI / 2;
  const floorRing = addMesh('FloorRing', new THREE.TorusGeometry(0.8, 0.028, 8, 36), wood, 0, 0.06, 0);
  floorRing.rotation.x = Math.PI / 2;
  for (const y of [0.28, 0.7]) {
    const hoop = addMesh('Band', new THREE.TorusGeometry(0.908, 0.016, 8, 40), band, 0, y, 0);
    hoop.rotation.x = Math.PI / 2;
  }

  const floor = addMesh('Floor', new THREE.CircleGeometry(0.8, 40), wood, 0, 0.045, 0, false);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  const caustic = causticMap();
  if (caustic) {
    texs.push(caustic);
    floor.material = wood.clone();
    const floorMat = floor.material as THREE.MeshStandardMaterial;
    floorMat.vertexColors = false;
    floorMat.emissive = new THREE.Color('#8fd4c8');
    floorMat.emissiveMap = caustic;
    floorMat.emissiveIntensity = 0.55;
    woods.push(floorMat);
    mats.push(floorMat);
    floorMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${FLOOR_DARKEN}`,
      );
    };
  }

  const wetBand = addMesh(
    'WetBand',
    new THREE.CylinderGeometry(0.82, 0.82, 0.07, 40, 1, true),
    wet,
    0,
    WATER_Y,
    0,
    false,
  );
  wetBand.castShadow = false;

  const stepMat = wood.clone();
  stepMat.vertexColors = false;
  woods.push(stepMat);
  mats.push(stepMat);
  addMesh('Step', beveled(0.46, 0.1, 0.28, 0.012), stepMat, 0.05, 0.05, 1.08);
  addMesh('Step', beveled(0.42, 0.1, 0.24, 0.012), stepMat, 0.02, 0.16, 0.9);

  const tubWater = createTubWaterMaterial();
  const waterMat = tubWater.material;
  const waterUniforms = tubWater.uniforms;
  texs.push(...tubWater.textures);
  mats.push(waterMat);
  const water = addMesh('Water', new THREE.CircleGeometry(0.8, 48), waterMat, 0, WATER_Y, 0, false);
  water.rotation.x = -Math.PI / 2;
  water.castShadow = false;
  water.renderOrder = 4;

  const stove = new THREE.Group();
  stove.name = 'WoodStove';
  body.add(stove);
  const fallback = addMesh('StoveFallback', new THREE.CylinderGeometry(0.16, 0.17, 0.42, 20), band, 0, 0, 0);
  fallback.castShadow = true;
  stove.add(fallback);
  stove.position.set(-0.78, WATER_Y, 0);

  const slitMat = new THREE.MeshStandardMaterial({
    color: '#1a100c',
    emissive: FIRE.clone(),
    emissiveIntensity: 2.4,
    roughness: 0.4,
    metalness: 0.1,
    toneMapped: false,
  });
  mats.push(slitMat);
  const slit = new THREE.Mesh(beveled(0.012, 0.16, 0.09, 0.002), slitMat);
  slit.name = 'DoorSlit';
  slit.position.set(0.17, -0.02, 0);
  stove.add(slit);
  geos.push(slit.geometry);

  const glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: FIRE.clone() },
      uIntensity: { value: 0.9 },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  mats.push(glowMat);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), glowMat);
  glow.name = 'DoorGlow';
  glow.position.set(0.2, -0.02, 0);
  glow.rotation.y = Math.PI / 2;
  glow.renderOrder = 6;
  stove.add(glow);
  geos.push(glow.geometry);

  const flameUniforms = { uTime: { value: 0 } };
  let flame: THREE.Mesh | null = null;
  const tier = qualityProfile().tier;
  if (tier === 'high' || tier === 'ultra') {
    const flameMat = new THREE.ShaderMaterial({
      uniforms: flameUniforms,
      vertexShader: GLOW_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    mats.push(flameMat);
    flame = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.34), flameMat);
    flame.name = 'DoorFlame';
    flame.position.set(0.185, 0.01, 0);
    flame.rotation.y = Math.PI / 2;
    flame.renderOrder = 7;
    stove.add(flame);
    geos.push(flame.geometry);
  }

  const chimneyMat = band.clone();
  chimneyMat.color.set('#14171a');
  chimneyMat.roughness = 0.48;
  metals.push(chimneyMat);
  mats.push(chimneyMat);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.046, 0.82, 12), chimneyMat);
  chimney.name = 'Chimney';
  chimney.position.set(0.02, 0.58, 0);
  chimney.castShadow = true;
  stove.add(chimney);
  geos.push(chimney.geometry);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.04, 12), chimneyMat);
  cap.name = 'ChimneyCap';
  cap.position.set(0.02, 1.02, 0);
  stove.add(cap);
  geos.push(cap.geometry);

  const light = new THREE.PointLight(FIRE.clone(), 8, 3.4, 2);
  light.name = 'StoveLight';
  light.position.set(0.12, 0.02, 0);
  stove.add(light);

  const modelPivot = new THREE.Group();
  modelPivot.name = 'BarrelStove';
  stove.add(modelPivot);

  const placeFire = (halfRadial: number, halfHeight: number) => {
    slit.position.set(halfRadial * 0.98, -halfHeight * 0.08, 0);
    glow.position.set(halfRadial + 0.02, -halfHeight * 0.08, 0);
    if (flame) flame.position.set(halfRadial + 0.035, 0.06, 0);
    light.position.set(halfRadial * 0.55, 0.02, 0);
    chimney.position.set(-halfRadial * 0.05, halfHeight + 0.36, 0);
    cap.position.set(-halfRadial * 0.05, halfHeight + 0.78, 0);
  };

  void loadModel(asset('models/barrel_stove.glb')).then((gltf) => {
    if (!alive) return;
    const model = gltf.scene.clone(true);
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 0.5 / Math.max(size.y, 0.001);
    model.position.copy(center).multiplyScalar(-1);
    modelPivot.scale.setScalar(scale);
    modelPivot.rotation.y = Math.PI / 2;
    modelPivot.add(model);
    const halfRadial = (size.z * scale) / 2;
    const halfHeight = (size.y * scale) / 2;
    stove.position.set(-(0.84 - halfRadial * 0.35), WATER_Y, 0);
    placeFire(halfRadial, halfHeight);
    fallback.visible = false;
  }).catch(() => undefined);

  const EMBER_COUNT = 48;
  const emberGeo = new THREE.BufferGeometry();
  const emberPos = new Float32Array(EMBER_COUNT * 3);
  const emberAttr = new THREE.BufferAttribute(emberPos, 3);
  emberAttr.setUsage(THREE.DynamicDrawUsage);
  emberGeo.setAttribute('position', emberAttr);
  geos.push(emberGeo);
  const emberMat = new THREE.PointsMaterial({
    color: FIRE.clone(),
    size: 0.026,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    sizeAttenuation: true,
  });
  mats.push(emberMat);
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.name = 'Embers';
  embers.frustumCulled = false;
  embers.renderOrder = 8;
  stove.add(embers);
  const emberSeed = Array.from({ length: EMBER_COUNT }, (_, i) => ({
    phase: hash(i + 20),
    drift: (hash(i + 21) - 0.5) * 0.12,
    sway: hash(i + 22) * Math.PI * 2,
  }));

  const count = qualityProfile().steamParticles;
  const steam = createSteam(count, object, body);
  const stoveWorld = new THREE.Vector3();

  const shadowTex = contactMap();
  if (shadowTex) {
    texs.push(shadowTex);
    const shadowGeo = new THREE.PlaneGeometry(2.2, 2.2);
    shadowGeo.rotateX(-Math.PI / 2);
    geos.push(shadowGeo);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    mats.push(shadowMat);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.name = 'ContactShadow';
    shadow.position.y = 0.008;
    shadow.renderOrder = 1;
    object.add(shadow);
  }

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
    tune(diff, 2.4, 1.2);
    tune(nor, 2.4, 1.2);
    tune(rough, 2.4, 1.2);
    tune(ao, 2.4, 1.2);
    texs.push(diff, nor, rough, ao);
    for (const mat of woods) {
      mat.map = diff;
      mat.normalMap = nor;
      mat.roughnessMap = rough;
      mat.aoMap = ao;
      mat.aoMapIntensity = 0.18;
      mat.normalScale.set(0.45, 0.45);
      mat.needsUpdate = true;
    }
  }).catch(() => undefined);

  void loadSet('metal_plate').then((maps) => {
    if (!alive) {
      drop(maps);
      return;
    }
    const [diff, nor, rough, ao] = maps;
    tune(diff, 3, 0.4);
    tune(nor, 3, 0.4);
    tune(rough, 3, 0.4);
    tune(ao, 3, 0.4);
    texs.push(diff, nor, rough, ao);
    for (const mat of metals) {
      mat.map = diff;
      mat.normalMap = nor;
      mat.roughnessMap = rough;
      mat.aoMap = ao;
      mat.aoMapIntensity = 0.7;
      mat.needsUpdate = true;
    }
  }).catch(() => undefined);

  void loadCustomModel('hot-tub').then((scene) => {
    if (!scene || !alive) return;
    const placed = placeCustomModel(scene, 'hot-tub', {
      polycarbonate: () => {
        const mat = createPolycarbonateMaterial();
        mats.push(mat);
        return mat;
      },
      water: () => waterMat,
    });
    if (!alive) {
      placed.release();
      return;
    }
    for (const child of [...body.children]) {
      if (child.name === 'WoodStove' || child.name === 'Gazebo') continue;
      child.visible = false;
    }
    for (const mat of placed.materials) mats.push(mat);
    body.add(placed.object);
    releasePlaced = placed.release;
  });

  return {
    object,
    body,
    update(frame) {
      if (!alive) return;
      const time = frame.reduced ? 0 : motionTime(performance.now());
      const pulse = flicker(time);
      slitMat.emissiveIntensity = 1.35 * pulse;
      glowMat.uniforms.uIntensity.value = 0.32 + pulse * 0.1;
      light.intensity = 7.2 * pulse;
      light.color.copy(FIRE).lerp(FIRE_WARM, THREE.MathUtils.clamp((pulse - 0.8) * 1.5, 0, 1));
      flameUniforms.uTime.value = time;
      waterUniforms.uWaterTime.value = time;
      if (caustic) caustic.offset.set(time * 0.018, time * 0.012);
      const night = THREE.MathUtils.clamp(frame.night, 0, 1);
      emberMat.opacity = night;
      embers.visible = night > 0.04;
      const mouthY = chimney.position.y + 0.52;
      for (let i = 0; i < EMBER_COUNT; i += 1) {
        const seed = emberSeed[i];
        const life = (seed.phase + time * 0.11) % 1;
        const rise = life * 1.35;
        emberPos[i * 3] = chimney.position.x + Math.cos(seed.sway + life * 2.4) * seed.drift * life;
        emberPos[i * 3 + 1] = mouthY + rise;
        emberPos[i * 3 + 2] = chimney.position.z + Math.sin(seed.sway + life * 1.8) * seed.drift * life;
      }
      emberAttr.needsUpdate = true;
      stove.getWorldPosition(stoveWorld);
      steam.update({ ...frame, stoveWorld });
    },
    dispose() {
      if (!alive) return;
      alive = false;
      releasePlaced();
      steam.dispose();
      object.removeFromParent();
      for (const geo of geos) geo.dispose();
      for (const mat of mats) mat.dispose();
      for (const tex of texs) tex.dispose();
    },
  };
}

/** Tub, cedar deck, and a clear gazebo open on local +X and -X. */
export function createTubPlace(): TubPlace {
  const object = new THREE.Group();
  object.name = 'TubPlace';
  const tub = createHotTub();
  tub.object.position.y = DECK_TOP;
  object.add(tub.object);

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const deckMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.68,
    metalness: 0.02,
  });
  deckMat.color.setRGB(1.32, 0.9, 0.58);
  const steel = new THREE.MeshStandardMaterial({
    color: '#1a1d21',
    roughness: 0.6,
    metalness: 0.86,
    envMapIntensity: 0.45,
  });
  mats.push(deckMat, steel);

  const deckGeo = new THREE.CylinderGeometry(1.38, 1.38, DECK_TOP, 48);
  geos.push(deckGeo);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.name = 'Deck';
  deck.position.y = DECK_TOP / 2;
  deck.receiveShadow = true;
  deck.castShadow = true;
  object.add(deck);

  const shelter = new THREE.Group();
  shelter.name = 'Gazebo';
  object.add(shelter);

  const postGeo = beveled(0.055, 2.08, 0.055, 0.008);
  geos.push(postGeo);
  const posts: Array<[number, number]> = [
    [1.02, 1.02],
    [1.02, -1.02],
    [-1.02, 1.02],
    [-1.02, -1.02],
  ];
  for (const [x, z] of posts) {
    const post = new THREE.Mesh(postGeo, steel);
    post.name = 'GazeboPost';
    post.position.set(x, 0.08 + 1.04, z);
    post.castShadow = true;
    post.receiveShadow = true;
    shelter.add(post);
  }

  const beamGeo = beveled(2.1, 0.045, 0.045, 0.006);
  geos.push(beamGeo);
  for (const z of [1.02, -1.02]) {
    const beam = new THREE.Mesh(beamGeo, steel);
    beam.position.set(0, 2.14, z);
    beam.castShadow = true;
    shelter.add(beam);
  }
  const beamSide = beveled(0.045, 0.045, 2.1, 0.006);
  geos.push(beamSide);
  for (const x of [1.02, -1.02]) {
    const beam = new THREE.Mesh(beamSide, steel);
    beam.position.set(x, 2.14, 0);
    beam.castShadow = true;
    shelter.add(beam);
  }
  const addPane = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const geo = beveled(w, h, d, 0.0015);
    geos.push(geo);
    const mat = createPolycarbonateMaterial();
    mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'GazeboPane';
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 10;
    shelter.add(mesh);
  };
  addPane(1.9, 1.78, 0.008, 0, 1.16, 0.99);
  addPane(1.9, 1.78, 0.008, 0, 1.16, -0.99);
  addPane(2.12, 0.008, 2.12, 0, 2.2, 0);
  object.updateMatrixWorld(true);
  tub.body.attach(shelter);

  let releaseGazebo = () => {};
  void loadCustomModel('gazebo').then((scene) => {
    if (!scene || !shelter.parent) return;
    const placed = placeCustomModel(scene, 'gazebo', {
      polycarbonate: () => {
        const mat = createPolycarbonateMaterial();
        mats.push(mat);
        return mat;
      },
    });
    if (!shelter.parent) {
      placed.release();
      return;
    }
    for (const child of [...shelter.children]) child.removeFromParent();
    for (const mat of placed.materials) mats.push(mat);
    shelter.add(placed.object);
    releaseGazebo = placed.release;
  });

  void whenKtx2().then(() =>
    Promise.all([
      ktx2Loader.loadAsync(asset('textures/fine_grained_wood/diff.ktx2')),
      ktx2Loader.loadAsync(asset('textures/fine_grained_wood/nor_gl.ktx2')),
      ktx2Loader.loadAsync(asset('textures/fine_grained_wood/rough.ktx2')),
    ]),
  ).then((maps) => {
    const [diff, nor, rough] = maps;
    if (!deck.parent) {
      maps.forEach((tex) => tex.dispose());
      return;
    }
    diff.colorSpace = THREE.SRGBColorSpace;
    nor.colorSpace = THREE.NoColorSpace;
    rough.colorSpace = THREE.NoColorSpace;
    tune(diff, 2.2, 2.2);
    tune(nor, 2.2, 2.2);
    tune(rough, 2.2, 2.2);
    deckMat.map = diff;
    deckMat.normalMap = nor;
    deckMat.roughnessMap = rough;
    deckMat.needsUpdate = true;
  }).catch(() => undefined);

  void whenKtx2().then(() =>
    Promise.all([
      ktx2Loader.loadAsync(asset('textures/metal_plate/diff.ktx2')),
      ktx2Loader.loadAsync(asset('textures/metal_plate/nor_gl.ktx2')),
      ktx2Loader.loadAsync(asset('textures/metal_plate/rough.ktx2')),
    ]),
  ).then((maps) => {
    if (!deck.parent) {
      maps.forEach((tex) => tex.dispose());
      return;
    }
    const [diff, nor, rough] = maps;
    tune(diff, 1.5, 2);
    tune(nor, 1.5, 2);
    tune(rough, 1.5, 2);
    steel.map = diff;
    steel.normalMap = nor;
    steel.roughnessMap = rough;
    steel.needsUpdate = true;
  }).catch(() => undefined);

  return {
    object,
    update(frame) {
      tub.update(frame);
    },
    dispose() {
      releaseGazebo();
      tub.dispose();
      object.removeFromParent();
      for (const geo of geos) geo.dispose();
      for (const mat of mats) mat.dispose();
      deckMat.map?.dispose();
      deckMat.normalMap?.dispose();
      deckMat.roughnessMap?.dispose();
      steel.map?.dispose();
      steel.normalMap?.dispose();
      steel.roughnessMap?.dispose();
    },
  };
}

