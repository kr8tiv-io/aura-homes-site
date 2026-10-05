/*
  Hemi-octahedral impostors, beyond the near trees.
  The atlas and the billboard follow Andrea Gargaro's octahedral-impostor (MIT):
  https://github.com/agargaro/octahedral-impostor
*/
import * as THREE from 'three';

const SPRITES = 4;
const ATLAS = 512;

function hemiDirection(u: number, v: number) {
  const x = u * 2 - 1;
  const z = v * 2 - 1;
  const y = Math.max(1 - Math.abs(x) - Math.abs(z), 0.04);
  return new THREE.Vector3(x, y, z).normalize();
}

const IMPOSTOR_PROJECT = /* glsl */ `
vec3 impostorCorner = position;
#if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT
  mat4 impostorMatrix = instanceMatrix;
  vec3 impostorCenter = (modelMatrix * impostorMatrix * vec4(0.0, 0.5, 0.0, 1.0)).xyz;
  float impostorHeight = length(impostorMatrix[1].xyz);
  vec3 impostorX = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 impostorY = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 impostorWorld = impostorCenter + impostorX * impostorCorner.x * impostorHeight + impostorY * impostorCorner.y * impostorHeight;
  vec3 impostorCam = normalize(cameraPosition - impostorCenter);
  vec3 impostorAxisX = normalize(impostorMatrix[0].xyz);
  vec3 impostorAxisY = normalize(impostorMatrix[1].xyz);
  vec3 impostorAxisZ = normalize(impostorMatrix[2].xyz);
  vec3 impostorLocal = vec3(dot(impostorCam, impostorAxisX), dot(impostorCam, impostorAxisY), dot(impostorCam, impostorAxisZ));
  float impostorYUp = max(impostorLocal.y, 0.04);
  vec3 impostorHemi = normalize(vec3(impostorLocal.x, impostorYUp, impostorLocal.z));
  vec2 impostorOct = vec2(impostorHemi.x, impostorHemi.z);
  impostorOct = clamp(impostorOct * 0.5 + 0.5, 0.0, 0.999);
  vec2 impostorCell = floor(impostorOct * uSprites);
  vImpostorUv = (impostorCell + uv) / uSprites;
  vec4 mvPosition = viewMatrix * vec4(impostorWorld, 1.0);
  gl_Position = projectionMatrix * mvPosition;
#else
  #include <project_vertex>
#endif
`;

export function bakeHemiImpostor(renderer: THREE.WebGLRenderer, source: THREE.Object3D) {
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center.clone();
  const radius = Math.max(sphere.radius, 0.2);
  const target = new THREE.WebGLRenderTarget(ATLAS, ATLAS, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  target.texture.generateMipmaps = true;
  target.texture.minFilter = THREE.LinearMipmapLinearFilter;
  target.texture.magFilter = THREE.LinearFilter;

  const bakeScene = new THREE.Scene();
  bakeScene.add(source);
  const key = new THREE.DirectionalLight('#fff3dd', 2.2);
  key.position.set(4, 6, 3);
  bakeScene.add(key, new THREE.AmbientLight('#ffffff', 0.55));
  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.05, radius * 6);
  const cell = ATLAS / SPRITES;
  const previousTarget = renderer.getRenderTarget();
  const previousColor = new THREE.Color();
  const previousViewport = new THREE.Vector4();
  const previousScissor = new THREE.Vector4();
  renderer.getClearColor(previousColor);
  renderer.getViewport(previousViewport);
  renderer.getScissor(previousScissor);
  const previousAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  const previousScissorTest = renderer.getScissorTest();

  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.autoClear = false;
  for (let y = 0; y < SPRITES; y += 1) {
    for (let x = 0; x < SPRITES; x += 1) {
      const dir = hemiDirection((x + 0.5) / SPRITES, (y + 0.5) / SPRITES);
      camera.position.copy(center).addScaledVector(dir, radius * 2.4);
      camera.up.set(0, 1, 0);
      if (Math.abs(dir.y) > 0.92) camera.up.set(0, 0, 1);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      renderer.setViewport(x * cell, y * cell, cell, cell);
      renderer.setScissor(x * cell, y * cell, cell, cell);
      renderer.setScissorTest(true);
      renderer.clear(true, true, true);
      renderer.render(bakeScene, camera);
    }
  }
  renderer.setScissorTest(previousScissorTest);
  renderer.setViewport(previousViewport);
  renderer.setScissor(previousScissor);
  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(previousColor, previousAlpha);
  renderer.autoClear = previousAutoClear;
  bakeScene.remove(source);

  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0, 0, 0);
  const material = new THREE.MeshBasicMaterial({
    map: target.texture,
    transparent: true,
    alphaTest: 0.28,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSprites = { value: SPRITES };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uSprites;
varying vec2 vImpostorUv;`,
      )
      .replace('#include <project_vertex>', IMPOSTOR_PROJECT)
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vImpostorUv;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
varying vec2 vImpostorUv;`,
    );
  };
  material.customProgramCacheKey = () => 'hemi-octa-impostor';
  return { geometry, material, texture: target.texture, target };
}
