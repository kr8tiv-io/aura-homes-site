/*
  Wisps for the wood-fired tub. Camera-facing quads, never spheres.
  Curl drift is Stefan Gustavson's simplex (MIT):
  https://github.com/stegu/webgl-noise
  The tiling noise is three.js examples/textures/lava/cloud.png (MIT).
  Soft particles follow three.js PR 33887 (MIT):
  https://github.com/mrdoob/three.js/pull/33887
  The thin surface ribbons follow the laminar wisps in
  https://github.com/zlollo/realistic-webgl-smoke (MIT).
*/
import * as THREE from 'three';
import { motionTime } from '../quality';

export type SteamFrame = {
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer | null;
  dusk: number;
  night: number;
  reduced: boolean;
  /** World position of the stove glow. Steam warms on that side. */
  stoveWorld: THREE.Vector3;
};

export type Steam = {
  card: THREE.Mesh;
  update: (frame: SteamFrame) => void;
  dispose: () => void;
};

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform mat4 uTub;

varying vec2 vUv;
varying float vAlpha;
varying float vWisp;
varying vec3 vWorld;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289v(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 curlNoise(vec3 p) {
  float e = 0.18;
  float n1 = snoise(p);
  float n2 = snoise(p + vec3(e, 0.0, 0.0));
  float n3 = snoise(p + vec3(0.0, e, 0.0));
  float n4 = snoise(p + vec3(0.0, 0.0, e));
  float n5 = snoise(p + vec3(9.2, 2.8, 1.1));
  float n6 = snoise(p + vec3(9.2 + e, 2.8, 1.1));
  float n7 = snoise(p + vec3(9.2, 2.8 + e, 1.1));
  float n8 = snoise(p + vec3(9.2, 2.8, 1.1 + e));
  vec3 a = vec3(n2 - n1, n3 - n1, n4 - n1) / e;
  vec3 b = vec3(n6 - n5, n7 - n5, n8 - n5) / e;
  return vec3(a.y - b.z, a.z - b.x, a.x - b.y);
}

void main() {
  vUv = uv;
  vWisp = aSeed.z;
  float speed = aSeed.z > 0.5 ? 0.24 : 0.065;
  float life = fract(aSeed.y + uTime * speed);
  float fadeIn = smoothstep(0.0, 0.1, life);
  float fadeOut = 1.0 - smoothstep(0.4, 1.0, life);
  vAlpha = fadeIn * fadeOut;

  float rise = aSeed.z > 0.5
    ? life * 0.07
    : (1.0 - pow(1.0 - life, 1.7)) * 1.45;
  vec3 curl = curlNoise(vec3(aSeed.x * 3.4, rise * 0.85, aSeed.w * 2.0)) * life * 0.34;
  if (aSeed.z > 0.5) curl *= 0.22;

  vec3 local = (instanceMatrix * vec4(aSeed.x, 0.78 + rise, aSeed.w, 1.0)).xyz + curl;
  vec3 world = (uTub * vec4(local, 1.0)).xyz;
  vWorld = world;

  float grow = mix(1.0, 3.0, life);
  vec2 size = aSeed.z > 0.5 ? vec2(0.78, 0.05) : vec2(0.22, 0.28) * grow;
  float spin = aSeed.y * 6.28318 + life * (aSeed.z > 0.5 ? 0.2 : 0.7);
  float cs = cos(spin);
  float sn = sin(spin);
  vec2 corner = vec2(cs * position.x - sn * position.y, sn * position.x + cs * position.y);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  world += camRight * corner.x * size.x + camUp * corner.y * size.y;

  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tCloud;
uniform sampler2D tDepth;
uniform float uTime;
uniform float uMood;
uniform float uSoft;
uniform vec2 uResolution;
uniform vec3 uStove;
uniform float uNear;
uniform float uFar;

varying vec2 vUv;
varying float vAlpha;
varying float vWisp;
varying vec3 vWorld;

float eyeDist(float depth) {
  float z = depth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec2 flowA = vUv * vec2(1.35, 2.15) + vec2(uTime * 0.018, -uTime * 0.046);
  vec2 flowB = vUv * vec2(2.6, 3.3) + vec2(-uTime * 0.027, uTime * 0.033);
  float n1 = texture2D(tCloud, flowA).r;
  float n2 = texture2D(tCloud, flowB).r;
  float noise = smoothstep(0.04, 0.38, n1 * n2);
  float vertical = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.46, vUv.y);
  float side = vWisp > 0.5
    ? smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x)
    : smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
  float alpha = vAlpha * noise * vertical * side;
  alpha *= vWisp > 0.5 ? 0.72 : 0.9;
  alpha *= mix(0.42, 1.0, uMood);

  if (uSoft > 0.5) {
    vec2 duv = gl_FragCoord.xy / uResolution;
    float sceneDepth = texture2D(tDepth, duv).r;
    float fade = smoothstep(0.0, 0.3, eyeDist(sceneDepth) - eyeDist(gl_FragCoord.z));
    alpha *= fade;
  }

  if (alpha < 0.004) discard;

  float warm = clamp(1.0 - length(vWorld - uStove) / 1.7, 0.0, 1.0);
  warm *= mix(0.35, 1.0, uMood);
  vec3 col = mix(vec3(0.74, 0.77, 0.79), vec3(1.0, 0.64, 0.4), warm * 0.72);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

const CARD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CARD_FRAG = /* glsl */ `
uniform sampler2D tSteam;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tSteam, vUv);
}
`;

function asset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\//, '');
}

type Particle = {
  x: number;
  z: number;
  phase: number;
  spin: number;
  wisp: number;
  dist: number;
};

function hash(index: number) {
  const value = Math.sin(index * 127.1 + 19.19) * 43758.5453;
  return value - Math.floor(value);
}

export function createSteam(count: number, host: THREE.Object3D, occluder: THREE.Object3D): Steam {
  const total = Math.max(0, Math.floor(count));
  const wisps = total === 0 ? 0 : Math.min(6, Math.max(3, Math.round(total * 0.05)));
  const particles: Particle[] = [];
  for (let i = 0; i < total; i += 1) {
    const wisp = i >= total - wisps ? 1 : 0;
    const angle = hash(i + 2) * Math.PI * 2;
    const radius = wisp ? 0.18 + hash(i + 5) * 0.42 : 0.05 + hash(i + 4) * 0.5;
    particles.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      phase: hash(i + 8),
      spin: hash(i + 11),
      wisp,
      dist: 0,
    });
  }

  const seeds = new Float32Array(Math.max(1, total) * 4);
  const seedAttr = new THREE.InstancedBufferAttribute(seeds, 4);
  seedAttr.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.setAttribute('aSeed', seedAttr);

  const cloud = new THREE.TextureLoader().load(asset('textures/fx/cloud.png'));
  cloud.colorSpace = THREE.NoColorSpace;
  cloud.wrapS = THREE.RepeatWrapping;
  cloud.wrapT = THREE.RepeatWrapping;
  cloud.magFilter = THREE.LinearFilter;
  cloud.minFilter = THREE.LinearMipmapLinearFilter;

  const depthTarget = new THREE.WebGLRenderTarget(4, 4, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  depthTarget.depthTexture = new THREE.DepthTexture(4, 4);
  depthTarget.depthTexture.format = THREE.DepthFormat;
  depthTarget.depthTexture.type = THREE.UnsignedIntType;

  const colorTarget = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  colorTarget.texture.generateMipmaps = false;
  colorTarget.texture.minFilter = THREE.LinearFilter;
  colorTarget.texture.magFilter = THREE.LinearFilter;
  colorTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;

  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.BasicDepthPacking,
    side: THREE.DoubleSide,
  });

  const resolution = new THREE.Vector2(4, 4);
  const tubMatrix = new THREE.Matrix4();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTub: { value: tubMatrix },
      uCameraPos: { value: new THREE.Vector3() },
      tCloud: { value: cloud },
      tDepth: { value: depthTarget.depthTexture },
      uMood: { value: 1 },
      uSoft: { value: 0 },
      uResolution: { value: resolution },
      uStove: { value: new THREE.Vector3() },
      uNear: { value: 0.4 },
      uFar: { value: 80 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, total));
  mesh.count = total;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const identity = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i += 1) mesh.setMatrixAt(i, identity);
  mesh.instanceMatrix.needsUpdate = true;

  const steamScene = new THREE.Scene();
  steamScene.add(mesh);
  const depthScene = new THREE.Scene();

  const cardMat = new THREE.ShaderMaterial({
    uniforms: { tSteam: { value: colorTarget.texture } },
    vertexShader: CARD_VERT,
    fragmentShader: CARD_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cardMat);
  card.name = 'SteamCard';
  card.frustumCulled = false;
  card.renderOrder = 30;
  card.visible = false;
  host.add(card);

  const order = particles.map((_, index) => index);
  const world = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const cardPos = new THREE.Vector3();
  const hostQuat = new THREE.Quaternion();
  const camQuat = new THREE.Quaternion();
  let paintedW = 0;
  let paintedH = 0;
  let alive = true;

  const writeSeeds = (time: number) => {
    const speedOf = (particle: Particle) => (particle.wisp > 0.5 ? 0.24 : 0.065);
    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i];
      const life = (particle.phase + time * speedOf(particle)) % 1;
      const rise = particle.wisp > 0.5 ? life * 0.07 : (1 - (1 - life) ** 1.7) * 1.45;
      world.set(particle.x, 0.78 + rise, particle.z);
      world.applyMatrix4(tubMatrix);
      particle.dist = world.distanceToSquared(material.uniforms.uCameraPos.value as THREE.Vector3);
    }
    order.sort((a, b) => particles[b].dist - particles[a].dist);
    for (let i = 0; i < order.length; i += 1) {
      const particle = particles[order[i]];
      const offset = i * 4;
      seeds[offset] = particle.x;
      seeds[offset + 1] = particle.phase;
      seeds[offset + 2] = particle.wisp;
      seeds[offset + 3] = particle.z;
    }
    seedAttr.needsUpdate = true;
  };

  const fitTargets = (width: number, height: number) => {
    if (width === paintedW && height === paintedH) return;
    paintedW = width;
    paintedH = height;
    depthTarget.setSize(width, height);
    colorTarget.setSize(width, height);
    resolution.set(width, height);
  };

  const placeCard = (camera: THREE.PerspectiveCamera) => {
    host.updateWorldMatrix(true, false);
    const dist = Math.max(camera.near * 2.4, 0.42);
    camera.getWorldDirection(forward);
    cardPos.copy(camera.position).addScaledVector(forward, dist);
    host.worldToLocal(cardPos);
    card.position.copy(cardPos);
    host.getWorldQuaternion(hostQuat);
    camQuat.copy(camera.quaternion);
    card.quaternion.copy(camQuat).premultiply(hostQuat.invert());
    const fov = (camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(fov * 0.5) * dist;
    const width = height * (camera.aspect > 0 ? camera.aspect : 1);
    card.scale.set(width, height, 1);
  };

  const paint = (renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) => {
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    const longSide = 480;
    const width = Math.max(2, aspect >= 1 ? longSide : Math.floor(longSide * aspect));
    const height = Math.max(2, aspect >= 1 ? Math.floor(longSide / aspect) : longSide);
    fitTargets(width, height);

    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevScissorTest = renderer.getScissorTest();
    const prevViewport = renderer.getViewport(new THREE.Vector4());
    const prevScissor = renderer.getScissor(new THREE.Vector4());
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const parent = occluder.parent;
    const hidden: THREE.Object3D[] = [];
    occluder.traverse((node) => {
      if (node === occluder) return;
      const skip = node.name === 'Water' || node.name === 'DoorGlow' || node.name === 'DoorFlame' || node.name === 'Embers' || node.name === 'ContactShadow';
      if (!skip || !node.visible) return;
      node.visible = false;
      hidden.push(node);
    });

    try {
      renderer.autoClear = true;
      renderer.setScissorTest(false);
      if (parent) {
        occluder.updateWorldMatrix(true, true);
        depthScene.attach(occluder);
        depthScene.overrideMaterial = depthMat;
        renderer.setRenderTarget(depthTarget);
        renderer.setViewport(0, 0, width, height);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, true, true);
        renderer.render(depthScene, camera);
        depthScene.overrideMaterial = null;
        parent.attach(occluder);
      }
      material.uniforms.uSoft.value = parent ? 1 : 0;
      renderer.setRenderTarget(colorTarget);
      renderer.setViewport(0, 0, width, height);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(steamScene, camera);
      card.visible = total > 0;
    } finally {
      for (const node of hidden) node.visible = true;
      depthScene.overrideMaterial = null;
      if (occluder.parent !== parent && parent) parent.attach(occluder);
      renderer.setRenderTarget(prevTarget);
      renderer.setViewport(prevViewport);
      renderer.setScissor(prevScissor);
      renderer.setScissorTest(prevScissorTest);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.autoClear = prevAuto;
    }
  };

  return {
    card,
    update(frame) {
      if (!alive || total === 0) return;
      const time = frame.reduced ? 0 : motionTime(performance.now());
      host.updateWorldMatrix(true, false);
      tubMatrix.copy(host.matrixWorld);
      (material.uniforms.uCameraPos.value as THREE.Vector3).copy(frame.camera.position);
      material.uniforms.uTime.value = time;
      material.uniforms.uMood.value = THREE.MathUtils.clamp(Math.max(frame.dusk, frame.night), 0, 1);
      (material.uniforms.uStove.value as THREE.Vector3).copy(frame.stoveWorld);
      const persp = frame.camera as THREE.PerspectiveCamera;
      if (persp.isPerspectiveCamera) {
        material.uniforms.uNear.value = persp.near;
        material.uniforms.uFar.value = persp.far;
        placeCard(persp);
      }
      writeSeeds(time);
      if (!frame.renderer || !persp.isPerspectiveCamera) {
        card.visible = false;
        return;
      }
      try {
        paint(frame.renderer, persp);
      } catch {
        card.visible = false;
      }
    },
    dispose() {
      if (!alive) return;
      alive = false;
      card.removeFromParent();
      geo.dispose();
      material.dispose();
      cardMat.dispose();
      card.geometry.dispose();
      cloud.dispose();
      depthMat.dispose();
      depthTarget.dispose();
      colorTarget.dispose();
      depthTarget.depthTexture.dispose();
    },
  };
}
