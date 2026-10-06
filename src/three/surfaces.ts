/*
  Shared surface treatment. Albedo is sRGB. Data maps stay linear.
  A low-frequency multiply hides a 2 m tile.
*/
import * as THREE from 'three';
import { qualityProfile } from './quality';

export function anisotropyForTier(): number {
  const tier = qualityProfile().tier;
  if (tier === 'high' || tier === 'ultra') return 8;
  if (tier === 'medium') return 4;
  return 2;
}

export function tuneMap(tex: THREE.Texture, repeatX: number, repeatY: number, srgb: boolean) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropyForTier();
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return tex;
}

const MACRO_FUNCS = /* glsl */ `
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
`;

const MACRO_APPLY = /* glsl */ `
{
  float macroFar = 1.0 - smoothstep(28.0, 90.0, length(vMacroWorld - cameraPosition));
  float macroA = macroNoise(vMacroWorld.xz * 0.045);
  float macroB = macroNoise(vMacroWorld.xz * 0.13 + 4.2);
  float macroLift = (macroA - 0.5) * 0.22 + (macroB - 0.5) * 0.08;
  diffuseColor.rgb *= 1.0 + macroLift * macroFar;
  if (uMacroSoil > 0.001) {
    vec3 soil = texture2D(tMacroSoil, vMacroWorld.xz * 0.5).rgb;
    soil = pow(max(soil, vec3(0.0)), vec3(2.2));
    float soilMask = smoothstep(0.32, 0.72, macroNoise(vMacroWorld.xz * 0.07 + 9.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, soil, soilMask * uMacroSoil * macroFar);
  }
}
`;

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.wrapS = THREE.RepeatWrapping;
WHITE.wrapT = THREE.RepeatWrapping;
WHITE.colorSpace = THREE.NoColorSpace;
WHITE.needsUpdate = true;

/** Break up tiling on a material that still has three's color chunk. */
export function applyMacro(material: THREE.Material) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (!shader.vertexShader.includes('vMacroWorld')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vMacroWorld;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvMacroWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
#ifdef USE_MAP
  vec2 seamP = position.xz * 0.11;
  float seamA = sin(dot(seamP, vec2(1.7, 2.3)));
  float seamB = sin(dot(seamP, vec2(2.9, 1.1)) + 1.7);
  vMapUv += vec2(seamA, seamB) * 0.28;
#endif`,
        );
    }
    shader.uniforms.tMacroSoil = { value: (material.userData.macroSoil as THREE.Texture | undefined) ?? WHITE };
    shader.uniforms.uMacroSoil = { value: (material.userData.macroSoilAmt as number | undefined) ?? 0 };
    material.userData.macroUniforms = shader.uniforms;
    if (!shader.fragmentShader.includes('macroNoise')) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec3 vMacroWorld;\nuniform sampler2D tMacroSoil;\nuniform float uMacroSoil;\n${MACRO_FUNCS}`,
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\n${MACRO_APPLY}`);
    }
  };
  material.customProgramCacheKey = () => `macro-v2-${previousKey()}`;
  return material;
}
