/*
  Preetham sky, then one more ridge: Alps Field as a grounded band
  behind the ported mountain cards. three.js examples, MIT.
*/
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { hdrLoader } from '../loaders';
import { EVENING_SUN, heightFog } from './height-fog';

function asset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\//, '');
}

const BACKDROP_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform float uBlur;
uniform vec3 uFogColor;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec3 vWorld;

vec3 backdropTap(vec2 uv) {
  vec2 stepUv = vec2(uBlur * 0.085);
  vec3 color = texture2D(tMap, uv).rgb;
  color += texture2D(tMap, uv + vec2(stepUv.x, 0.0)).rgb;
  color += texture2D(tMap, uv - vec2(stepUv.x, 0.0)).rgb;
  color += texture2D(tMap, uv + vec2(0.0, stepUv.y)).rgb;
  color += texture2D(tMap, uv - vec2(0.0, stepUv.y)).rgb;
  return color / 5.0;
}

void main() {
  vec3 color = backdropTap(vUv);
  color = color / (vec3(1.0) + color * 0.45);
  // Sphere v 0.5 is the horizon. A short band, then the Preetham dome.
  float elev = vUv.y - 0.50;
  float ridge = smoothstep(0.0, 0.028, elev) * (1.0 - smoothstep(0.04, 0.09, elev));
  vec3 toward = normalize(vWorld - cameraPosition);
  float sun = pow(max(dot(toward, normalize(uSunDir)), 0.0), 4.0);
  vec3 warm = uFogColor * vec3(1.12, 0.96, 0.78);
  vec3 cool = uFogColor * vec3(0.8, 0.9, 1.02);
  color = mix(color, mix(cool, warm, sun), (1.0 - ridge) * 0.72 + 0.18);
  float alpha = ridge;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

const BACKDROP_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export function addGoldenSky(
  scene: THREE.Scene,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
  textures: THREE.Texture[],
  alive: () => boolean,
) {
  const sky = new Sky();
  sky.name = 'PreethamSky';
  sky.scale.setScalar(1000);
  sky.frustumCulled = false;
  sky.renderOrder = -20;
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 6;
  uniforms.rayleigh.value = 1.6;
  uniforms.mieCoefficient.value = 0.004;
  uniforms.mieDirectionalG.value = 0.82;
  uniforms.sunPosition.value.copy(EVENING_SUN).multiplyScalar(400);
  uniforms.cloudCoverage.value = 0.18;
  uniforms.cloudDensity.value = 0.22;
  const skyMaterial = sky.material as THREE.ShaderMaterial;
  skyMaterial.depthWrite = false;
  skyMaterial.fog = false;
  skyMaterial.toneMapped = false;
  // The stage tone-maps once. The example sky shader also encodes sRGB, which flattens the sun.
  const previous = skyMaterial.onBeforeCompile;
  skyMaterial.onBeforeCompile = (shader, renderer) => {
    previous?.call(skyMaterial, shader, renderer);
    // Preetham toward this sun is about 4 to 90. AgX whites out past ~16, so the
    // body is logged into range and the disc is added back on top of that.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <tonemapping_fragment>', '')
      .replace('#include <colorspace_fragment>', '')
      .replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        `vec3 skyBody = max(texColor - sundiscColor, vec3(0.0));
        float skyLuma = max(dot(skyBody, vec3(0.2126, 0.7152, 0.0722)), 0.0001);
        float skyMapped = log2(1.0 + skyLuma * 1.6) / log2(29.0);
        skyBody *= skyMapped / skyLuma;
        float sunGlow = pow(max(dot(direction, vSunDirection), 0.0), 6.0);
        skyBody += vec3(0.55, 0.22, 0.05) * sunGlow;
        gl_FragColor = vec4(skyBody + vec3(sundisc) * vec3(8.0, 5.2, 2.0), 1.0);`,
      );
  };
  const previousKey = skyMaterial.customProgramCacheKey?.bind(skyMaterial);
  skyMaterial.customProgramCacheKey = () => `golden-sky-${previousKey ? previousKey() : ''}`;
  materials.push(skyMaterial);
  geometries.push(sky.geometry);
  scene.add(sky);

  void hdrLoader.loadAsync(asset('hdri/alps_field_2k.hdr')).then((hdr) => {
    if (!alive()) {
      hdr.dispose();
      return;
    }
    hdr.colorSpace = THREE.LinearSRGBColorSpace;
    hdr.wrapS = THREE.ClampToEdgeWrapping;
    hdr.wrapT = THREE.ClampToEdgeWrapping;
    hdr.needsUpdate = true;
    textures.push(hdr);
    const height = 6;
    const radius = 430;
    const shell = new GroundedSkybox(hdr, height, radius, 64);
    shell.name = 'AlpsRidge';
    shell.position.y = height;
    shell.frustumCulled = false;
    shell.renderOrder = -16;
    geometries.push(shell.geometry);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tMap: { value: hdr },
        uBlur: { value: 0.03 },
        uFogColor: heightFog.color,
        uSunDir: heightFog.sun,
      },
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const replaced = shell.material;
    shell.material = material;
    if (!Array.isArray(replaced)) replaced.dispose();
    materials.push(material);
    scene.add(shell);
  }).catch(() => undefined);

  return sky;
}
