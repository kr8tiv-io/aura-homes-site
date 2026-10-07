/*
  One WebGL canvas for the page. Meadow passages, the cream wash, and the
  field light all register views. The canvas is created only after the splash
  spacer has left the viewport, so the film stays on its own pixels.
  Tracers and warmth stay on their own contexts: one sits under the film and
  the other is a soft-light layer above it.
*/
import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Pass,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { configureRenderer, loadEnvironment, releaseEnvironment } from './loaders';
import { displayDpr, ensureQuality, hdriFor, noteFrame, onQuality, qualityProfile, setDebugStats, showStill } from './quality';
import { prefersReducedMotion } from '../scripts/motion';
import { TinySunFlareEffect } from './meadow-v1/flare';

declare module 'n8ao' {
  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: {
      halfRes: boolean;
      aoRadius: number;
      intensity: number;
      gammaCorrection: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}

export type StageTone = 'agx' | 'neutral';
export type StageLayer = 'wash' | 'field' | 'scene';

export type StageView = {
  element: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  update: (progress: number, dt: number) => void;
  /** Return false to skip drawing this frame. Animation still runs. */
  draw?: () => boolean;
  ao?: boolean;
  exposure?: number;
  tone?: StageTone;
  layer?: StageLayer;
  hdri?: string;
  /** Keep this exact HDRI. Quality will not swap 1k for 2k. */
  hdriPinned?: boolean;
  envIntensity?: number;
  /** Soft shadows only while this view is the one being painted. */
  shadow?: 'soft';
  bloom?: { threshold: number; intensity: number };
  /** High and ultra only. The light must already cast a shadow. */
  godrays?: THREE.DirectionalLight;
  /** High tier only. */
  flare?: boolean;
  /** Bake impostors once the shared renderer exists. */
  claimRenderer?: (renderer: THREE.WebGLRenderer) => void;
  /** Drop geometries once the passage is more than two screens away. */
  suspend?: () => void;
  /** Rebuild after the passage comes back within two screens. */
  resume?: () => void;
};

type Composer = EffectComposer & { depthRenderTarget: THREE.WebGLRenderTarget | null };

type Entry = {
  view: StageView;
  progress: number;
  dead: boolean;
  ready: boolean;
  compileStarted: boolean;
  envReady: boolean;
  envAsked: boolean;
  composer: EffectComposer | null;
  toneEffect: ToneMappingEffect | null;
  pw: number;
  ph: number;
  dormant: boolean;
  baseHdri: string;
};

const LAYER_ORDER: StageLayer[] = ['wash', 'field', 'scene'];

let canvas: HTMLCanvasElement | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let entries: Entry[] = [];
let raf = 0;
let looping = false;
let drawScheduled = false;
let lastTime = 0;
let scenePaints = 0;
let booted = false;
let bootFailed = false;
let listening = false;
let sizeW = 0;
let sizeH = 0;
let sizePr = 0;
let approachObserver: IntersectionObserver | null = null;
let viewportObserver: IntersectionObserver | null = null;
let godraysCtor: (new (
  light: THREE.DirectionalLight,
  camera: THREE.PerspectiveCamera,
  params?: { density?: number; maxDensity?: number; color?: THREE.Color; raymarchSteps?: number; gammaCorrection?: boolean; resolutionScale?: number },
) => Pass) | null = null;
let godraysLoading = false;

let quad: THREE.Mesh | null = null;
let quadScene: THREE.Scene | null = null;
let quadCamera: THREE.OrthographicCamera | null = null;
let washTarget: THREE.WebGLRenderTarget | null = null;
let washMaterial: THREE.ShaderMaterial | null = null;

const linearToSrgb = `
  vec3 linearToSrgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(0.4166667)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
  }
`;

const srgbToLinear = `
  vec3 srgbToLinear(vec3 c) {
    vec3 lo = c * 0.0773993808;
    vec3 hi = pow(max((c + 0.055) * 0.9478672986, vec3(0.0)), vec3(2.4));
    return mix(lo, hi, step(vec3(0.04045), c));
  }
`;

function splashBlocks(): boolean {
  const spacer = document.querySelector<HTMLElement>('[data-splash-spacer]');
  if (!spacer) return false;
  return spacer.getBoundingClientRect().bottom > 0;
}

function onScreen(rect: DOMRect): boolean {
  return (
    rect.width >= 2 &&
    rect.height >= 2 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
}

function pageScroll(): number {
  const lenis = (window as Window & { __lenis?: { scroll?: number } }).__lenis;
  return lenis?.scroll ?? window.scrollY;
}

function requestDraw() {
  if (looping || drawScheduled || !booted) return;
  drawScheduled = true;
  requestAnimationFrame((time) => {
    drawScheduled = false;
    draw(time);
  });
}

function shouldRun(): boolean {
  if (!renderer || !canvas || document.hidden) return false;
  if (qualityProfile().tier === 'off') return false;
  const stageRect = canvas.getBoundingClientRect();
  if (stageRect.bottom <= 0 || stageRect.top >= window.innerHeight || stageRect.width < 2) return false;
  for (const entry of entries) {
    if (entry.dead || entry.dormant) continue;
    const rect = entry.view.element.getBoundingClientRect();
    if (!onScreen(rect)) continue;
    if (entry.view.draw && entry.view.draw() === false) continue;
    return true;
  }
  return false;
}

function clearStage() {
  if (!renderer) return;
  const w = sizeW || window.innerWidth;
  const h = sizeH || window.innerHeight;
  renderer.setRenderTarget(null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
}

function syncLoop() {
  if (!renderer || !booted) return;
  if (prefersReducedMotion() || !shouldRun()) {
    if (looping) {
      renderer.setAnimationLoop(null);
      looping = false;
      clearStage();
    }
    return;
  }
  if (looping) return;
  looping = true;
  lastTime = 0;
  renderer.setAnimationLoop(onFrame);
}

function onFrame(time: number) {
  const host = window as Window & { __auraFrames?: number };
  host.__auraFrames = (host.__auraFrames ?? 0) + 1;
  if (!shouldRun()) {
    renderer?.setAnimationLoop(null);
    looping = false;
    clearStage();
    return;
  }
  draw(time);
}

function onScroll() {
  if (!booted) maybeBoot();
  else if (prefersReducedMotion()) requestDraw();
  else syncLoop();
}

function onResize() {
  if (!renderer || !booted) return;
  resizeRenderer();
  if (prefersReducedMotion()) requestDraw();
  else syncLoop();
}

function onVisibility() {
  if (document.hidden) {
    renderer?.setAnimationLoop(null);
    looping = false;
    return;
  }
  syncLoop();
  if (prefersReducedMotion()) requestDraw();
}

function armListeners() {
  if (listening) return;
  listening = true;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('wheel', onScroll, { passive: true });
  window.addEventListener('touchmove', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
}

function dropListeners() {
  if (!listening) return;
  listening = false;
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('wheel', onScroll);
  window.removeEventListener('touchmove', onScroll);
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVisibility);
}

function resizeRenderer() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = displayDpr();
  if (w === sizeW && h === sizeH && pr === sizePr) return;
  sizeW = w;
  sizeH = h;
  sizePr = pr;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
}

function placeCanvas(node: HTMLCanvasElement) {
  const main = document.querySelector('main');
  if (main) main.prepend(node);
  else document.body.prepend(node);
}

function maybeBoot() {
  if (booted || bootFailed) return;
  if (qualityProfile().tier === 'off') return;
  if (splashBlocks()) return;
  if (!entries.some((entry) => !entry.dead)) return;
  try {
    boot();
  } catch {
    bootFailed = true;
    canvas?.remove();
    canvas = null;
    renderer = null;
    document.dispatchEvent(new CustomEvent('aura-stage-failed'));
  }
}

function boot() {
  const node = document.createElement('canvas');
  node.className = 'stage-canvas';
  node.setAttribute('aria-hidden', 'true');
  node.dataset.stage = 'live';
  placeCanvas(node);

  const gl = new THREE.WebGLRenderer({
    canvas: node,
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance',
    premultipliedAlpha: true,
  });
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.NoToneMapping;
  gl.toneMappingExposure = 1;
  const profile = qualityProfile();
  gl.shadowMap.enabled = profile.shadowMapSize > 0;
  gl.shadowMap.type = THREE.PCFShadowMap;
  gl.shadowMap.autoUpdate = true;
  gl.transmissionResolutionScale = profile.transmissionScale;
  gl.autoClear = false;
  gl.info.autoReset = false;
  gl.setClearColor(0x000000, 0);
  configureRenderer(gl);

  node.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    looping = false;
    gl.setAnimationLoop(null);
    bootFailed = true;
    document.querySelectorAll<HTMLCanvasElement>('[data-meadow]').forEach((meadow) => {
      showStill(meadow);
      const passage = meadow.closest('.passage');
      if (!(passage instanceof HTMLElement)) return;
      passage.classList.remove('is-stage');
      delete passage.dataset.stage;
      passage.querySelector('[data-passage-loader]')?.remove();
    });
    document.dispatchEvent(new CustomEvent('aura-stage-failed'));
  });

  canvas = node;
  renderer = gl;
  booted = true;
  resizeRenderer();
  ensureQuad();
  ensureObservers();
  if (viewportObserver) viewportObserver.observe(node);

  if (prefersReducedMotion()) requestDraw();
  else syncLoop();
}

function ensureQuad() {
  if (quad) return;
  quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ensureWashMaterial());
  quad.frustumCulled = false;
  quadScene = new THREE.Scene();
  quadScene.add(quad);
  quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
}

function ensureWashMaterial() {
  if (washMaterial) return washMaterial;
  washMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: { tWash: { value: null } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tWash;
      ${linearToSrgb}
      ${srgbToLinear}
      void main() {
        vec4 wash = texture2D(tWash, vUv);
        float coverage = clamp(wash.a, 0.0, 1.0);
        vec3 straight = coverage > 0.001 ? wash.rgb / coverage : wash.rgb;
        vec3 paper = srgbToLinear(vec3(0.95686, 0.95294, 0.93725));
        vec3 src = mix(paper, paper * straight, coverage);
        float e0 = length(vUv / vec2(0.34, 0.26));
        float e1 = length((vUv - vec2(1.0, 0.0)) / vec2(0.34, 0.26));
        float mask = clamp((1.0 - smoothstep(0.0, 0.72, e0)) + (1.0 - smoothstep(0.0, 0.72, e1)), 0.0, 1.0);
        float a = clamp(coverage * mask * 0.42, 0.0, 1.0);
        vec3 display = linearToSrgb(src);
        gl_FragColor = vec4(display * a, a);
      }
    `,
  });
  return washMaterial;
}

function ensureWashTarget() {
  if (!renderer) return null;
  const w = Math.max(2, renderer.domElement.width);
  const h = Math.max(2, renderer.domElement.height);
  if (!washTarget) {
    washTarget = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: true,
      stencilBuffer: false,
      type: THREE.UnsignedByteType,
    });
    washTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  } else if (washTarget.width !== w || washTarget.height !== h) {
    washTarget.setSize(w, h);
  }
  return washTarget;
}

function fitComposer(composer: EffectComposer, width: number, height: number) {
  composer.inputBuffer.setSize(width, height);
  composer.outputBuffer.setSize(width, height);
  (composer as Composer).depthRenderTarget?.setSize(width, height);
  for (const pass of composer.passes) pass.setSize(width, height);
}

function makeComposer(entry: Entry): EffectComposer | null {
  if (!renderer) return null;
  const view = entry.view;
  const camera = view.camera;
  const composer = new EffectComposer(renderer, {
    depthBuffer: true,
    stencilBuffer: true,
    // Half float so the evening sky and the sun disc reach AgX. An 8-bit buffer
    // clamps that whole dome to white, and AgX then paints it one gray.
    frameBufferType: THREE.HalfFloatType,
  });
  /* setSize would resize the shared canvas. Fit the buffers only. */
  composer.autoRenderToScreen = false;

  const profile = qualityProfile();
  const tone = new ToneMappingEffect({
    mode: view.tone === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX,
  });
  const noise = new NoiseEffect({ premultiply: true });
  noise.blendMode.opacity.value = 0.025;
  const vignette = new VignetteEffect({ offset: 0.2, darkness: 0.25 });
  const smaa = new SMAAEffect();
  const effects = [tone, smaa, vignette, noise];
  if (profile.bloom) {
    effects.unshift(
      new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: view.bloom?.threshold ?? 0.9,
        intensity: view.bloom?.intensity ?? 0.35,
      }),
    );
  }
  if (view.flare && profile.tier === 'high' && camera instanceof THREE.PerspectiveCamera && view.godrays) {
    effects.push(new TinySunFlareEffect(view.godrays.position, camera));
  }
  const effect = new EffectPass(camera, ...effects);
  effect.renderToScreen = true;

  const renderPass = new RenderPass(view.scene, camera);
  renderPass.renderToScreen = false;
  composer.addPass(renderPass);

  if (view.ao && profile.ao) {
    const ao = new N8AOPostPass(view.scene, camera, 2, 2);
    ao.configuration.gammaCorrection = false;
    ao.setQualityMode('Performance');
    ao.configuration.halfRes = profile.aoHalfRes;
    ao.configuration.aoRadius = 1.5;
    ao.configuration.intensity = 2.5;
    ao.renderToScreen = false;
    composer.addPass(ao);
  }

  if (
    view.godrays &&
    godraysCtor &&
    (profile.tier === 'high' || profile.tier === 'ultra') &&
    camera instanceof THREE.PerspectiveCamera
  ) {
    const rays = new godraysCtor(view.godrays, camera, {
      density: 1 / 96,
      maxDensity: 0.32,
      color: new THREE.Color('#ffb56a'),
      raymarchSteps: 36,
      gammaCorrection: false,
      resolutionScale: 0.5,
    });
    rays.renderToScreen = false;
    composer.addPass(rays);
  }

  composer.addPass(effect);
  entry.toneEffect = tone;
  entry.composer = composer;
  return composer;
}

function ensureGodrays(entry: Entry) {
  const tier = qualityProfile().tier;
  if (!entry.view.godrays || (tier !== 'high' && tier !== 'ultra') || godraysCtor || godraysLoading) return;
  godraysLoading = true;
  void import('three-good-godrays')
    .then((mod) => {
      godraysCtor = mod.GodraysPass as typeof godraysCtor;
      for (const item of entries) {
        if (!item.view.godrays || item.dead) continue;
        item.composer?.dispose();
        item.composer = null;
        item.toneEffect = null;
        item.pw = 0;
        item.ph = 0;
      }
      requestDraw();
    })
    .catch(() => {
      godraysLoading = false;
    });
}

function prepareView(entry: Entry) {
  const view = entry.view;
  if (!renderer) return;
  if (view.hdri && !entry.envAsked) {
    entry.envAsked = true;
    const url = view.hdri;
    loadEnvironment(renderer, url)
      .then((texture) => {
        if (entry.dead) return;
        view.scene.environment = texture;
        if (view.envIntensity != null) view.scene.environmentIntensity = view.envIntensity;
        entry.envReady = true;
        requestDraw();
      })
      .catch(() => {
        entry.envReady = true;
        requestDraw();
      });
  }
  if (!entry.compileStarted) {
    entry.compileStarted = true;
    renderer
      .compileAsync(view.scene, view.camera)
      .then(() => {
        entry.ready = true;
        requestDraw();
      })
      .catch(() => {
        entry.ready = true;
        requestDraw();
      });
  }
}

function paintWash(entry: Entry) {
  if (!renderer || !quad) return;
  const target = ensureWashTarget();
  const material = ensureWashMaterial();
  if (!target) return;
  renderer.setScissorTest(false);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(entry.view.scene, entry.view.camera);
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  material.uniforms.tWash.value = target.texture;
  renderer.render(quadScene!, quadCamera!);
}

function paintField(entry: Entry, rect: DOMRect) {
  if (!renderer) return;
  const left = rect.left;
  const bottom = window.innerHeight - rect.bottom;
  renderer.setRenderTarget(null);
  renderer.setScissorTest(true);
  renderer.setViewport(left, bottom, rect.width, rect.height);
  renderer.setScissor(left, bottom, rect.width, rect.height);
  renderer.render(entry.view.scene, entry.view.camera);
}

function paintScene(entry: Entry, rect: DOMRect, dt: number) {
  if (!renderer || !entry.ready || !entry.envReady) return;
  const composer = entry.composer ?? makeComposer(entry);
  if (!composer) return;
  const pr = renderer.getPixelRatio();
  const w = Math.max(2, Math.floor(rect.width * pr));
  const h = Math.max(2, Math.floor(rect.height * pr));
  if (entry.pw !== w || entry.ph !== h) {
    fitComposer(composer, w, h);
    entry.pw = w;
    entry.ph = h;
  }
  if (entry.toneEffect) {
    entry.toneEffect.mode = entry.view.tone === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX;
  }
  const left = rect.left;
  const bottom = window.innerHeight - rect.bottom;
  renderer.setScissorTest(true);
  renderer.setViewport(left, bottom, rect.width, rect.height);
  renderer.setScissor(left, bottom, rect.width, rect.height);
  renderer.toneMappingExposure = entry.view.exposure ?? 1;
  ensureGodrays(entry);
  entry.view.claimRenderer?.(renderer);
  composer.render(dt);
  const passage = entry.view.element.closest('.passage');
  if (passage instanceof HTMLElement) {
    passage.classList.add('is-stage');
    scenePaints += 1;
    (passage as HTMLElement & { __auraPaints?: number }).__auraPaints = ((passage as HTMLElement & { __auraPaints?: number }).__auraPaints ?? 0) + 1;
    (window as Window & { __auraScenePaints?: number }).__auraScenePaints = scenePaints;
    if (passage.dataset.stage !== 'live') {
      passage.dataset.stage = 'live';
      passage.dispatchEvent(new CustomEvent('aura-stage-live'));
    }
  }
}

function draw(time: number) {
  if (!renderer || !booted) return;
  const raw = lastTime ? time - lastTime : 16.7;
  const dt = Math.min(0.05, Math.max(0, raw) / 1000) || 1 / 60;
  lastTime = time;
  noteFrame(raw);
  resizeRenderer();
  renderer.info.reset();

  renderer.setRenderTarget(null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);

  for (const layer of LAYER_ORDER) {
    for (const entry of entries) {
      if (entry.dead || entry.dormant || (entry.view.layer ?? 'scene') !== layer) continue;
      const rect = entry.view.element.getBoundingClientRect();
      const visible = onScreen(rect);
      const layerName = entry.view.layer ?? 'scene';
      if (layerName === 'scene' && !visible) continue;
      const camera = entry.view.camera;
      if (camera instanceof THREE.PerspectiveCamera && rect.width >= 2 && rect.height >= 2) {
        const aspect = rect.width / rect.height;
        if (Math.abs(camera.aspect - aspect) > 0.001) {
          camera.aspect = aspect;
          camera.updateProjectionMatrix();
        }
      }
      try {
        entry.view.update(entry.progress, dt);
      } catch {
        continue;
      }
      if (!visible) continue;
      if (entry.view.draw && entry.view.draw() === false) continue;
      prepareView(entry);
      if (layer === 'scene' && (!entry.ready || !entry.envReady)) continue;
      if (layer !== 'scene' && !entry.ready) continue;
      try {
        if (layer === 'wash') paintWash(entry);
        else if (layer === 'field') paintField(entry, rect);
        else paintScene(entry, rect, dt);
      } catch (error) {
        const host = window as Window & { __auraPaintError?: string };
        if (!host.__auraPaintError) host.__auraPaintError = String(error).slice(0, 240);
      }
    }
  }

  if (canvas) canvas.dataset.stageViews = String(entries.filter((entry) => !entry.dead).length);
  let bytes = 0;
  if (debugTextures) bytes = visibleTextureBytes();
  setDebugStats({
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    textures: renderer.info.memory.textures,
    bytes,
  });
}

const debugTextures = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug3d');

function visibleTextureBytes() {
  const seen = new Set<THREE.Texture>();
  let bytes = 0;
  const add = (tex: THREE.Texture | null | undefined) => {
    if (!tex || seen.has(tex)) return;
    seen.add(tex);
    const image = tex.image as { width?: number; height?: number } | undefined;
    const w = image?.width ?? 0;
    const h = image?.height ?? 0;
    if (w > 0 && h > 0) bytes += w * h * 4;
  };
  for (const entry of entries) {
    if (entry.dead || entry.dormant) continue;
    const rect = entry.view.element.getBoundingClientRect();
    if (!onScreen(rect)) continue;
    const scene = entry.view.scene;
    if (scene.environment) add(scene.environment);
    if (scene.background instanceof THREE.Texture) add(scene.background);
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      const material = mesh.material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const item of list) {
        for (const value of Object.values(item)) {
          if (value instanceof THREE.Texture) add(value);
        }
      }
    });
  }
  return bytes;
}

function suspendEntry(entry: Entry) {
  if (entry.dormant || entry.dead) return;
  if (getComputedStyle(entry.view.element).position === 'fixed') return;
  entry.dormant = true;
  entry.composer?.dispose();
  entry.composer = null;
  entry.toneEffect = null;
  entry.ready = false;
  entry.compileStarted = false;
  entry.envAsked = false;
  entry.envReady = !entry.view.hdri;
  entry.view.element.closest('.passage')?.classList.remove('is-stage');
  try {
    entry.view.suspend?.();
  } catch {
    /* A released view must not stop the others. */
  }
}

function resumeEntry(entry: Entry) {
  if (!entry.dormant || entry.dead) return;
  try {
    entry.view.resume?.();
  } catch {
    return;
  }
  entry.dormant = false;
  entry.ready = false;
  entry.compileStarted = false;
  entry.envAsked = false;
  entry.envReady = !entry.view.hdri;
}

function ensureObservers() {
  if (approachObserver) return;
  approachObserver = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        const entry = entries.find((item) => item.view.element === record.target);
        if (!entry || entry.dead) continue;
        if (record.isIntersecting) resumeEntry(entry);
        else suspendEntry(entry);
      }
      syncLoop();
    },
    { rootMargin: '200% 0px 200% 0px' },
  );
  viewportObserver = new IntersectionObserver(() => {
    syncLoop();
    if (prefersReducedMotion()) requestDraw();
  });
}

function disposeStage() {
  looping = false;
  cancelAnimationFrame(raf);
  raf = 0;
  renderer?.setAnimationLoop(null);
  approachObserver?.disconnect();
  viewportObserver?.disconnect();
  approachObserver = null;
  viewportObserver = null;
  dropListeners();
  for (const entry of entries) {
    entry.composer?.dispose();
    entry.composer = null;
  }
  entries = [];
  washTarget?.dispose();
  washTarget = null;
  washMaterial?.dispose();
  washMaterial = null;
  if (quad) {
    quad.geometry.dispose();
    quad = null;
  }
  quadScene = null;
  quadCamera = null;
  releaseEnvironment();
  renderer?.dispose();
  renderer = null;
  canvas?.remove();
  canvas = null;
  booted = false;
  bootFailed = false;
  sizeW = 0;
  sizeH = 0;
  sizePr = 0;
  lastTime = 0;
}

export function registerView(view: StageView): { setProgress: (t: number) => void; destroy: () => void } {
  ensureQuality();
  const baseHdri = view.hdri ?? '';
  if (baseHdri && !view.hdriPinned) view.hdri = hdriFor(baseHdri);
  const entry: Entry = {
    view,
    progress: 0,
    dead: false,
    ready: false,
    compileStarted: false,
    envReady: !view.hdri,
    envAsked: false,
    composer: null,
    toneEffect: null,
    pw: 0,
    ph: 0,
    dormant: false,
    baseHdri,
  };
  entries.push(entry);
  if (view.layer === 'wash' || view.layer === 'field') view.element.dataset.stageHost = 'on';
  ensureObservers();
  approachObserver?.observe(view.element);
  viewportObserver?.observe(view.element);
  armListeners();
  maybeBoot();

  let gone = false;
  return {
    setProgress(t: number) {
      entry.progress = Math.min(1, Math.max(0, t));
      if (prefersReducedMotion()) requestDraw();
    },
    destroy() {
      if (gone || entry.dead) return;
      gone = true;
      entry.dead = true;
      approachObserver?.unobserve(view.element);
      viewportObserver?.unobserve(view.element);
      entry.composer?.dispose();
      entry.composer = null;
      entries = entries.filter((item) => item !== entry);
      if (!entries.some((item) => !item.dead)) disposeStage();
    },
  };
}

/** Scroll position helper for views that stay quiet above the fold. */
export function stagePageScroll(): number {
  return pageScroll();
}

onQuality((profile) => {
  if (!renderer || profile.tier === 'off') return;
  renderer.transmissionResolutionScale = profile.transmissionScale;
  renderer.shadowMap.enabled = profile.shadowMapSize > 0;
  for (const entry of entries) {
    entry.composer?.dispose();
    entry.composer = null;
    entry.toneEffect = null;
    entry.pw = 0;
    entry.ph = 0;
    if (!entry.baseHdri || entry.view.hdriPinned) continue;
    const next = hdriFor(entry.baseHdri);
    if (next === entry.view.hdri) continue;
    entry.view.hdri = next;
    entry.envAsked = false;
    entry.envReady = false;
    entry.ready = false;
    entry.compileStarted = false;
  }
  sizePr = -1;
  resizeRenderer();
  if (prefersReducedMotion()) requestDraw();
  else syncLoop();
});
