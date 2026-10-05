/*
  Forest floor under the grass. Triplanar on the slopes, and darker where
  the sward is dense (the Codrops fluffiest-grass trick).
*/
import * as THREE from 'three';
import { ktx2Loader, whenKtx2 } from '../loaders';
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
uniform sampler2D tMudC;
uniform sampler2D tMudR;
uniform sampler2D tMudA;
uniform float uGroundReady;
varying vec3 vGroundWorld;
varying vec3 vGroundNormal;
float gGroundRough = 0.92;

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
  mudC: THREE.Texture;
  mudR: THREE.Texture;
  mudA: THREE.Texture;
  ready: number;
};

export function makeGoldenTerrain(segments: number, textures: THREE.Texture[], materials: THREE.Material[]) {
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
    mudC: blank,
    mudR: blank,
    mudA: blank,
    ready: 0,
  };

  const mat = new THREE.MeshStandardMaterial({ color: '#6d7a4e', roughness: 0.92, metalness: 0 });
  applyHeightFog(mat);
  const previous = mat.onBeforeCompile;
  const previousKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    previous.call(mat, shader, renderer);
    shader.uniforms.tForestC = { value: maps.forestC };
    shader.uniforms.tForestR = { value: maps.forestR };
    shader.uniforms.tForestA = { value: maps.forestA };
    shader.uniforms.tMudC = { value: maps.mudC };
    shader.uniforms.tMudR = { value: maps.mudR };
    shader.uniforms.tMudA = { value: maps.mudA };
    shader.uniforms.uGroundReady = { value: maps.ready };
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
        '#include <color_fragment>',
        `#include <color_fragment>
if (uGroundReady > 0.5) {
  vec3 forest = groundTri(tForestC, vGroundWorld, vGroundNormal, 0.16, true);
  vec3 mud = groundTri(tMudC, vGroundWorld, vGroundNormal, 0.16, true);
  float slope = 1.0 - clamp(vGroundNormal.y, 0.0, 1.0);
  float damp = groundTri(tMudA, vGroundWorld, vGroundNormal, 0.16, false).r;
  float mudAmt = clamp(slope * 1.35 + damp * 0.28, 0.0, 1.0);
  vec3 albedo = mix(forest, mud, mudAmt);
  float roughF = groundTri(tForestR, vGroundWorld, vGroundNormal, 0.16, false).r;
  float roughM = groundTri(tMudR, vGroundWorld, vGroundNormal, 0.16, false).r;
  float ao = mix(
    groundTri(tForestA, vGroundWorld, vGroundNormal, 0.16, false).r,
    groundTri(tMudA, vGroundWorld, vGroundNormal, 0.16, false).r,
    mudAmt
  );
  albedo *= mix(1.0, 0.42, groundDense(vGroundWorld.xz));
  diffuseColor.rgb = albedo * mix(0.82, 1.0, ao);
  gGroundRough = mix(roughF, roughM, mudAmt);
}`
      );
  };
  mat.customProgramCacheKey = () => `golden-ground-${previousKey()}`;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Terrain';
  materials.push(mat);

  const load = (name: string, file: string, color: boolean) =>
    ktx2Loader.loadAsync(asset(`textures/${name}/${file}.ktx2`)).then((texture) => {
      texture.colorSpace = color ? THREE.NoColorSpace : THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      textures.push(texture);
      return texture;
    });

  void whenKtx2().then(() => Promise.all([
    load('forrest_ground_01', 'diff', true),
    load('forrest_ground_01', 'rough', false),
    load('forrest_ground_01', 'ao', false),
    load('brown_mud_leaves_01', 'diff', true),
    load('brown_mud_leaves_01', 'rough', false),
    load('brown_mud_leaves_01', 'ao', false),
  ])).then(([forestC, forestR, forestA, mudC, mudR, mudA]) => {
    maps.forestC = forestC;
    maps.forestR = forestR;
    maps.forestA = forestA;
    maps.mudC = mudC;
    maps.mudR = mudR;
    maps.mudA = mudA;
    maps.ready = 1;
    const uniforms = mat.userData.groundUniforms as Record<string, { value: unknown }> | undefined;
    if (uniforms) {
      uniforms.tForestC.value = forestC;
      uniforms.tForestR.value = forestR;
      uniforms.tForestA.value = forestA;
      uniforms.tMudC.value = mudC;
      uniforms.tMudR.value = mudR;
      uniforms.tMudA.value = mudA;
      uniforms.uGroundReady.value = 1;
    }
  }).catch(() => undefined);

  return mesh;
}
