/*
  Falling snow for the resort meadow. Camera-facing quads, never spheres.
  The flakes draw in their own pass, then a card in the main view, the same
  path the steam uses. Sharing the tree instancing pass drops the draw.
  Curl drift is Stefan Gustavson's simplex (MIT):
  https://github.com/stegu/webgl-noise
  Flake shape samples three.js examples/textures/lava/cloud.png (MIT).
  Soft particles follow three.js PR 33887 (MIT):
  https://github.com/mrdoob/three.js/pull/33887
*/
import * as THREE from 'three';
import { motionTime, qualityProfile } from '../quality';

export type SnowFrame = {
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer | null;
  reduced: boolean;
};

export type Snowfall = {
  update: (frame: SnowFrame) => void;
  dispose: () => void;
};

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;

varying vec2 vUv;
varying float vAlpha;
varying float vEye;

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

vec3 curl(vec3 p) {
  float e = 0.12;
  float n1 = snoise(p);
  float n2 = snoise(p + vec3(e, 0.0, 0.0));
  float n3 = snoise(p + vec3(0.0, e, 0.0));
  float n4 = snoise(p + vec3(0.0, 0.0, e));
  return vec3(n3 - n1, n4 - n1, n2 - n1) / e;
}

void main() {
  vUv = uv;
  float life = fract(aSeed.w + uTime * (0.035 + aSeed.y * 0.02));
  vec3 camForward = normalize(-vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
  vec3 camRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 camUp = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  float across = clamp(aSeed.x / 23.0, -1.0, 1.0);
  float depthN = clamp(aSeed.z / 23.0, -1.0, 1.0) * 0.5 + 0.5;
  float dist = mix(4.0, 18.0, depthN);
  float lift = (0.42 - life) * 1.35;
  vec3 drift = curl(vec3(across * 1.6, uTime * 0.045 + aSeed.y * 2.4, dist * 0.06));
  vec3 p = cameraPosition + camForward * dist + camRight * across * dist * 0.7 + camUp * lift * dist * 0.62;
  p += drift * 0.4;
  p = (instanceMatrix * vec4(p, 1.0)).xyz;
  float spin = aSeed.y * 6.28318 + life * 0.7;
  float cs = cos(spin);
  float sn = sin(spin);
  vec2 corner = vec2(cs * position.x - sn * position.y, sn * position.x + cs * position.y);
  float size = mix(0.07, 0.16, aSeed.y);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = normalize(cross(toCam, right));
  vec3 world = p + right * corner.x * size + up * corner.y * size;
  vAlpha = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.84, 1.0, life));
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  vEye = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tCloud;
uniform sampler2D tDepth;
uniform float uTime;
uniform float uSoft;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;

varying vec2 vUv;
varying float vAlpha;
varying float vEye;

float eyeDist(float depth) {
  float z = depth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec2 flowA = vUv * 1.8 + vec2(uTime * 0.02, 0.0);
  vec2 flowB = vUv * 3.4 + vec2(0.2, -uTime * 0.03);
  float n1 = texture2D(tCloud, flowA).r;
  float n2 = texture2D(tCloud, flowB).r;
  float disc = smoothstep(0.5, 0.14, length(vUv - 0.5));
  float mote = smoothstep(0.2, 0.85, max(n1, n2));
  float flake = disc * mix(0.7, 1.0, mote);
  float alpha = vAlpha * flake * 0.86;
  if (uSoft > 0.5) {
    vec2 duv = clamp(gl_FragCoord.xy / uResolution, 0.0, 1.0);
    float sceneDepth = texture2D(tDepth, duv).r;
    float gap = eyeDist(sceneDepth) - vEye;
    float fade = smoothstep(0.0, 0.8, gap);
    if (sceneDepth <= 0.001 || sceneDepth >= 0.998) fade = 1.0;
    // A far-plane depth sample reads as a near surface and would erase the fall.
    fade = max(fade, 0.62);
    alpha *= fade;
  }
  if (alpha < 0.02) discard;
  vec3 col = vec3(0.96, 0.97, 0.98);
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
uniform sampler2D tSnow;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tSnow, vUv);
}
`;

function asset(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\//, '');
}

function hash(index: number) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function countForTier() {
  const tier = qualityProfile().tier;
  if (tier === 'ultra') return 200;
  if (tier === 'high') return 160;
  if (tier === 'medium') return 100;
  if (tier === 'low') return 56;
  return 0;
}

export function createSnowfall(parent: THREE.Object3D): Snowfall {
  const total = countForTier();
  const seeds = new Float32Array(Math.max(1, total) * 4);
  for (let i = 0; i < total; i += 1) {
    seeds[i * 4] = (hash(i + 1) - 0.5) * 46;
    seeds[i * 4 + 1] = hash(i + 2);
    seeds[i * 4 + 2] = (hash(i + 3) - 0.5) * 46;
    seeds[i * 4 + 3] = hash(i + 4);
  }
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));

  const cloud = new THREE.TextureLoader().load(asset('textures/fx/cloud.png'));
  cloud.colorSpace = THREE.NoColorSpace;
  cloud.wrapS = THREE.RepeatWrapping;
  cloud.wrapT = THREE.RepeatWrapping;
  cloud.magFilter = THREE.LinearFilter;
  cloud.minFilter = THREE.LinearMipmapLinearFilter;

  const depthTarget = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true, stencilBuffer: false });
  depthTarget.depthTexture = new THREE.DepthTexture(4, 4);
  depthTarget.depthTexture.format = THREE.DepthFormat;
  depthTarget.depthTexture.type = THREE.UnsignedIntType;
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });

  const colorTarget = new THREE.WebGLRenderTarget(4, 4, {
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  colorTarget.texture.generateMipmaps = false;
  colorTarget.texture.minFilter = THREE.LinearFilter;
  colorTarget.texture.magFilter = THREE.LinearFilter;
  colorTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;

  const resolution = new THREE.Vector2(4, 4);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      tCloud: { value: cloud },
      tDepth: { value: depthTarget.depthTexture },
      uSoft: { value: 0 },
      uResolution: { value: resolution },
      uNear: { value: 0.4 },
      uFar: { value: 260 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, total));
  mesh.name = 'Snowfall';
  mesh.count = total;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const identity = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i += 1) mesh.setMatrixAt(i, identity);
  mesh.instanceMatrix.needsUpdate = true;
  const snowScene = new THREE.Scene();
  if (total > 0) snowScene.add(mesh);

  const cardMat = new THREE.ShaderMaterial({
    uniforms: { tSnow: { value: colorTarget.texture } },
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
  const cardGeo = new THREE.PlaneGeometry(1, 1);
  const card = new THREE.Mesh(cardGeo, cardMat);
  card.name = 'SnowCard';
  card.frustumCulled = false;
  card.renderOrder = 8;
  card.visible = false;
  if (total > 0) parent.add(card);

  let paintedW = 0;
  let paintedH = 0;
  let alive = true;
  const forward = new THREE.Vector3();
  const cardPos = new THREE.Vector3();
  const hostQuat = new THREE.Quaternion();
  const camQuat = new THREE.Quaternion();

  const fitTargets = (width: number, height: number) => {
    if (width === paintedW && height === paintedH) return;
    paintedW = width;
    paintedH = height;
    depthTarget.setSize(width, height);
    colorTarget.setSize(width, height);
    resolution.set(width, height);
  };

  const placeCard = (camera: THREE.PerspectiveCamera) => {
    parent.updateWorldMatrix(true, false);
    const dist = Math.max(camera.near * 2.2, 0.35);
    camera.getWorldDirection(forward);
    cardPos.copy(camera.position).addScaledVector(forward, dist);
    parent.worldToLocal(cardPos);
    card.position.copy(cardPos);
    parent.getWorldQuaternion(hostQuat);
    camQuat.copy(camera.quaternion);
    card.quaternion.copy(camQuat).premultiply(hostQuat.invert());
    const fov = (camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(fov * 0.5) * dist;
    const width = height * (camera.aspect > 0 ? camera.aspect : 1);
    card.scale.set(width, height, 1);
  };

  const paint = (renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) => {
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    const longSide = 640;
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
    const host = parent;
    const previousOverride = host instanceof THREE.Scene ? host.overrideMaterial : null;
    const hidden: THREE.Object3D[] = [];
    try {
      renderer.autoClear = true;
      renderer.setScissorTest(false);
      if (host instanceof THREE.Scene) {
        const keep = new Set(['Terrain', 'AuraUnitSlot', 'HotTubSlot', 'SlopePlace']);
        for (const child of host.children) {
          if (keep.has(child.name) || !child.visible) continue;
          child.visible = false;
          hidden.push(child);
        }
        host.overrideMaterial = depthMat;
        renderer.setRenderTarget(depthTarget);
        renderer.setViewport(0, 0, width, height);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, true, true);
        renderer.render(host, camera);
        host.overrideMaterial = previousOverride;
        material.uniforms.uSoft.value = 1;
      }
      renderer.setRenderTarget(colorTarget);
      renderer.setViewport(0, 0, width, height);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(snowScene, camera);
      card.visible = total > 0;
    } finally {
      for (const child of hidden) child.visible = true;
      if (host instanceof THREE.Scene) host.overrideMaterial = previousOverride;
      renderer.setRenderTarget(prevTarget);
      renderer.setViewport(prevViewport);
      renderer.setScissor(prevScissor);
      renderer.setScissorTest(prevScissorTest);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.autoClear = prevAuto;
    }
  };

  return {
    update(frame) {
      if (!alive || total === 0) return;
      material.uniforms.uTime.value = frame.reduced ? 0 : motionTime(performance.now());
      const persp = frame.camera as THREE.PerspectiveCamera;
      if (!persp.isPerspectiveCamera) return;
      material.uniforms.uNear.value = persp.near;
      material.uniforms.uFar.value = persp.far;
      if (!frame.renderer) {
        material.uniforms.uSoft.value = 0;
        card.visible = false;
        return;
      }
      try {
        paint(frame.renderer, persp);
        placeCard(persp);
      } catch {
        material.uniforms.uSoft.value = 0;
        card.visible = total > 0;
      }
    },
    dispose() {
      if (!alive) return;
      alive = false;
      mesh.removeFromParent();
      card.removeFromParent();
      geo.dispose();
      cardGeo.dispose();
      material.dispose();
      cardMat.dispose();
      cloud.dispose();
      depthMat.dispose();
      depthTarget.dispose();
      colorTarget.dispose();
    },
  };
}
