/*
  Forest floor under the grass. Triplanar on the slopes, and darker where
  the sward is dense (the Codrops fluffiest-grass trick).
*/
import * as THREE from 'three';
import { ktx2Loader, whenKtx2 } from '../loaders';
import { anisotropyForTier } from '../surfaces';
import { applyHeightFog } from './height-fog';
import { sampleTerrainHeight } from './meadow/field';

function asset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\//, '');
}

const GROUND_PARS = /* glsl */ `
uniform sampler2D tForestC;
uniform sampler2D tForestR;
uniform sampler2D tForestA;
uniform sampler2D tForestN;
uniform sampler2D tMudC;
uniform sampler2D tMudR;
uniform sampler2D tMudA;
uniform sampler2D tMudN;
uniform sampler2D tGrassC;
uniform sampler2D tGrassN;
uniform sampler2D tSoilC;
uniform float uGroundReady;
uniform float uGrassReady;
uniform float uSoilReady;
varying vec3 vGroundWorld;
varying vec3 vGroundNormal;
float gGroundRough = 0.92;

float macroHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float macroNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(macroHash(i), macroHash(i + vec2(1.0, 0.0)), u.x),
    mix(macroHash(i + vec2(0.0, 1.0)), macroHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

vec3 groundSrgb(vec3 color) {
  return pow(max(color, vec3(0.0)), vec3(2.2));
}
vec3 groundTri(sampler2D tex, vec3 pos, vec3 normal, float scale, bool decode) {
  vec3 blend = pow(abs(normal), vec3(4.0));
  blend /= blend.x + blend.y + blend.z + 1e-4;
  vec3 x = texture2D(tex, pos.zy * scale).rgb;
  vec3 y = texture2D(tex, pos.xz * scale).rgb;
  vec3 z = texture2D(tex, pos.xy * scale).rgb;
  vec3 color = x * blend.x + y * blend.y + z * blend.z;
  return decode ? groundSrgb(color) : color;
}
vec3 groundTriBreak(sampler2D tex, vec3 pos, vec3 normal, bool decode) {
  vec3 fine = groundTri(tex, pos, normal, 0.5, decode);
  vec3 broad = groundTri(tex, pos + vec3(1.7, 0.0, 0.4), normal, 0.22, decode);
  float mask = smoothstep(0.32, 0.78, macroNoise(pos.xz * 0.11 + 2.0));
  return mix(fine, broad, mask * 0.55);
}
float groundDense(vec2 p) {
  float radius = length(p);
  float ring = 1.0 - smoothstep(16.0, 46.0, radius);
  float corridor = (1.0 - smoothstep(9.0, 18.0, abs(p.x))) * smoothstep(5.5, 11.0, p.y) * (1.0 - smoothstep(33.0, 41.0, p.y));
  float scatter = 0.34 * (1.0 - smoothstep(28.0, 48.0, radius));
  float density = max(ring, max(corridor, scatter));
  density *= 1.0 - smoothstep(6.0, 15.0, -p.y);
  return clamp(density, 0.0, 1.0);
}
`;

type GroundMaps = {
  forestC: THREE.Texture;
  forestR: THREE.Texture;
  forestA: THREE.Texture;
  forestN: THREE.Texture;
  mudC: THREE.Texture;
  mudR: THREE.Texture;
  mudA: THREE.Texture;
  mudN: THREE.Texture;
  grassC: THREE.Texture;
  grassN: THREE.Texture;
  soilC: THREE.Texture;
  ready: number;
  grassReady: number;
  soilReady: number;
};

export function makeGoldenTerrain(
  segments: number,
  textures: THREE.Texture[],
  materials: THREE.Material[],
  withFog = true,
) {
  const geo = new THREE.PlaneGeometry(170, 170, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const position = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    position.setY(i, sampleTerrainHeight(position.getX(i), position.getZ(i)));
  }
  geo.computeVertexNormals();

  const blank = new THREE.DataTexture(new Uint8Array([210, 198, 160, 255]), 1, 1);
  blank.needsUpdate = true;
  blank.wrapS = THREE.RepeatWrapping;
  blank.wrapT = THREE.RepeatWrapping;
  textures.push(blank);

  const maps: GroundMaps = {
    forestC: blank,
    forestR: blank,
    forestA: blank,
    forestN: blank,
    mudC: blank,
    mudR: blank,
    mudA: blank,
    mudN: blank,
    grassC: blank,
    grassN: blank,
    soilC: blank,
    ready: 0,
    grassReady: 0,
    soilReady: 0,
  };

  const mat = new THREE.MeshStandardMaterial({ color: '#6d7a4e', roughness: 0.92, metalness: 0 });
  if (withFog) applyHeightFog(mat);
  const previous = mat.onBeforeCompile;
  const previousKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    previous.call(mat, shader, renderer);
    shader.uniforms.tForestC = { value: maps.forestC };
    shader.uniforms.tForestR = { value: maps.forestR };
    shader.uniforms.tForestA = { value: maps.forestA };
    shader.uniforms.tForestN = { value: maps.forestN };
    shader.uniforms.tMudC = { value: maps.mudC };
    shader.uniforms.tMudR = { value: maps.mudR };
    shader.uniforms.tMudA = { value: maps.mudA };
    shader.uniforms.tMudN = { value: maps.mudN };
    shader.uniforms.tGrassC = { value: maps.grassC };
    shader.uniforms.tGrassN = { value: maps.grassN };
    shader.uniforms.tSoilC = { value: maps.soilC };
    shader.uniforms.uGroundReady = { value: maps.ready };
    shader.uniforms.uGrassReady = { value: maps.grassReady };
    shader.uniforms.uSoilReady = { value: maps.soilReady };
    mat.userData.groundUniforms = shader.uniforms;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGroundWorld;
varying vec3 vGroundNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_PARS}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, gGroundRough, step(0.5, uGroundReady));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (uGroundReady > 0.5) {
  vec3 nF = texture2D(tForestN, vGroundWorld.xz * 0.5).xyz * 2.0 - 1.0;
  vec3 nM = texture2D(tMudN, vGroundWorld.xz * 0.5).xyz * 2.0 - 1.0;
  float nSlope = clamp((1.0 - vGroundNormal.y) * 1.35, 0.0, 1.0);
  vec3 nTex = mix(nF, nM, nSlope);
  if (uGrassReady > 0.5) {
    vec3 nG = texture2D(tGrassN, vGroundWorld.xz * 0.5).xyz * 2.0 - 1.0;
    nTex = mix(nTex, nG, groundDense(vGroundWorld.xz) * 0.62);
  }
  vec3 worldN = normalize(vGroundNormal + vec3(nTex.x, nTex.z, nTex.y) * 0.55);
  normal = normalize(mat3(viewMatrix) * worldN);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if (uGroundReady > 0.5) {
  vec3 forest = groundTriBreak(tForestC, vGroundWorld, vGroundNormal, true);
  vec3 mud = groundTriBreak(tMudC, vGroundWorld, vGroundNormal, true);
  float slope = 1.0 - clamp(vGroundNormal.y, 0.0, 1.0);
  float damp = groundTri(tMudA, vGroundWorld, vGroundNormal, 0.5, false).r;
  float mudAmt = clamp(slope * 1.35 + damp * 0.28, 0.0, 1.0);
  if (uSoilReady > 0.5) {
    vec3 soil = groundTriBreak(tSoilC, vGroundWorld, vGroundNormal, true);
    mud = mix(mud, soil, 0.28);
  }
  vec3 albedo = mix(forest, mud, mudAmt);
  float sward = groundDense(vGroundWorld.xz);
  if (uGrassReady > 0.5) {
    vec3 grass = groundTriBreak(tGrassC, vGroundWorld, vGroundNormal, true);
    albedo = mix(albedo, grass, sward * 0.82);
  }
  float roughF = groundTri(tForestR, vGroundWorld, vGroundNormal, 0.5, false).r;
  float roughM = groundTri(tMudR, vGroundWorld, vGroundNormal, 0.5, false).r;
  float ao = mix(
    groundTri(tForestA, vGroundWorld, vGroundNormal, 0.5, false).r,
    groundTri(tMudA, vGroundWorld, vGroundNormal, 0.5, false).r,
    mudAmt
  );
  albedo *= mix(1.0, 0.84, sward);
  float macroFar = 1.0 - smoothstep(28.0, 90.0, length(vGroundWorld - cameraPosition));
  float macroA = macroNoise(vGroundWorld.xz * 0.045);
  float macroB = macroNoise(vGroundWorld.xz * 0.13 + 4.2);
  albedo *= 1.0 + ((macroA - 0.5) * 0.22 + (macroB - 0.5) * 0.08) * macroFar;
  diffuseColor.rgb = albedo * mix(0.9, 1.0, ao);
  gGroundRough = mix(roughF, roughM, mudAmt);
}`
      );
  };
  mat.customProgramCacheKey = () => `golden-ground-v2-${previousKey()}`;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Terrain';
  materials.push(mat);

  const load = (name: string, file: string) =>
    ktx2Loader.loadAsync(asset(`textures/${name}/${file}.ktx2`)).then((texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropyForTier();
      textures.push(texture);
      return texture;
    });

  const paint = () => {
    const uniforms = mat.userData.groundUniforms as Record<string, { value: unknown }> | undefined;
    if (!uniforms) return;
    uniforms.tForestC.value = maps.forestC;
    uniforms.tForestR.value = maps.forestR;
    uniforms.tForestA.value = maps.forestA;
    uniforms.tForestN.value = maps.forestN;
    uniforms.tMudC.value = maps.mudC;
    uniforms.tMudR.value = maps.mudR;
    uniforms.tMudA.value = maps.mudA;
    uniforms.tMudN.value = maps.mudN;
    uniforms.tGrassC.value = maps.grassC;
    uniforms.tGrassN.value = maps.grassN;
    uniforms.tSoilC.value = maps.soilC;
    uniforms.uGroundReady.value = maps.ready;
    uniforms.uGrassReady.value = maps.grassReady;
    uniforms.uSoilReady.value = maps.soilReady;
  };

  void whenKtx2().then(() => Promise.all([
    load('forrest_ground_01', 'diff'),
    load('forrest_ground_01', 'rough'),
    load('forrest_ground_01', 'ao'),
    load('forrest_ground_01', 'nor_gl'),
    load('brown_mud_leaves_01', 'diff'),
    load('brown_mud_leaves_01', 'rough'),
    load('brown_mud_leaves_01', 'ao'),
    load('brown_mud_leaves_01', 'nor_gl'),
  ])).then(([forestC, forestR, forestA, forestN, mudC, mudR, mudA, mudN]) => {
    maps.forestC = forestC;
    maps.forestR = forestR;
    maps.forestA = forestA;
    maps.forestN = forestN;
    maps.mudC = mudC;
    maps.mudR = mudR;
    maps.mudA = mudA;
    maps.mudN = mudN;
    maps.ready = 1;
    paint();
  }).catch(() => undefined);

  const jpg = new THREE.TextureLoader();
  const loadJpg = (file: string) =>
    jpg.loadAsync(asset(file)).then((texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropyForTier();
      textures.push(texture);
      return texture;
    });
  void Promise.all([
    loadJpg('textures/grass004/diff.jpg'),
    loadJpg('textures/grass004/nor_gl.jpg'),
  ]).then(([grassC, grassN]) => {
    maps.grassC = grassC;
    maps.grassN = grassN;
    maps.grassReady = 1;
    paint();
  }).catch(() => undefined);
  void loadJpg('textures/ground037/diff.jpg').then((soilC) => {
    maps.soilC = soilC;
    maps.soilReady = 1;
    paint();
  }).catch(() => undefined);

  return mesh;
}
