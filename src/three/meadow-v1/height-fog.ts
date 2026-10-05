/*
  Height fog plus distance fog. Thicker in the valley, thinner up the slope,
  warm toward the sun and cool away from it.
  The injection follows Simon Dev's onBeforeCompile fog tutorial (MIT):
  https://github.com/simondevyoutube/ThreeJS_Tutorial_Fog
*/
import * as THREE from 'three';

export const EVENING_SUN = new THREE.Vector3(0.756, 0.36, 0.547).normalize();

export const heightFog = {
  color: { value: new THREE.Color('#e4c9a4') },
  sun: { value: EVENING_SUN.clone() },
  falloff: { value: 0.38 },
  near: { value: 28 },
  far: { value: 140 },
};

const FOG_PARS = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vHeightWorld;
`;

const FOG_VERT = /* glsl */ `
#include <fog_vertex>
#if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT
  vec4 heightWorld = instanceMatrix * vec4(transformed, 1.0);
  vHeightWorld = (modelMatrix * heightWorld).xyz;
#else
  vHeightWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

const FOG_FRAG_PARS = /* glsl */ `
#include <fog_pars_fragment>
varying vec3 vHeightWorld;
uniform vec3 uHeightFogColor;
uniform vec3 uHeightFogSun;
uniform float uHeightFogFalloff;
uniform float uHeightFogNear;
uniform float uHeightFogFar;
`;

const FOG_FRAG = /* glsl */ `
float heightDist = distance(cameraPosition, vHeightWorld);
float heightBand = smoothstep(uHeightFogNear, uHeightFogFar, heightDist);
float heightValley = exp(-max(vHeightWorld.y - 0.35, 0.0) * uHeightFogFalloff);
float heightAmt = clamp(heightBand * mix(0.32, 1.08, heightValley), 0.0, 0.9);
vec3 heightTo = normalize(vHeightWorld - cameraPosition);
float heightSun = pow(max(dot(heightTo, normalize(uHeightFogSun)), 0.0), 6.0);
vec3 heightWarm = uHeightFogColor * vec3(1.14, 0.97, 0.76);
vec3 heightCool = uHeightFogColor * vec3(0.78, 0.88, 1.03);
gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(heightCool, heightWarm, heightSun), heightAmt);
`;

/** Replace three's linear fog on a material that already has fog enabled. */
export function applyHeightFog(material: THREE.Material) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uHeightFogColor = heightFog.color;
    shader.uniforms.uHeightFogSun = heightFog.sun;
    shader.uniforms.uHeightFogFalloff = heightFog.falloff;
    shader.uniforms.uHeightFogNear = heightFog.near;
    shader.uniforms.uHeightFogFar = heightFog.far;
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', FOG_PARS)
      .replace('#include <fog_vertex>', FOG_VERT);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', FOG_FRAG_PARS);
    if (shader.fragmentShader.includes('#include <tonemapping_fragment>')) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <tonemapping_fragment>', `${FOG_FRAG}\n#include <tonemapping_fragment>`)
        .replace('#include <fog_fragment>', '');
    } else {
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FOG_FRAG);
    }
  };
  material.customProgramCacheKey = () => `height-fog-${previousKey()}`;
  return material;
}
