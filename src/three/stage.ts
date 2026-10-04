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
import { prefersReducedMotion } from '../scripts/motion';

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
  envIntensity?: number;
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
};

const LAYER_ORDER: StageLayer[] = ['wash', 'field', 'scene'];

let canvas: HTMLCanvasElement | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let entries: Entry[] = [];
let raf = 0;
let looping = false;
let drawScheduled = false;
let lastTime = 0;
let booted = false;
let bootFailed = false;
let listening = false;
let sizeW = 0;
let sizeH = 0;
let sizePr = 0;

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

function pixelRatioCap(): number {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (prefersReducedMotion() || saveData) return 1;
  if (window.matchMedia('(max-width: 800px), (pointer: coarse)').matches) return 1.25;
  return 1.5;
}

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

function onScroll() {
  if (!booted) maybeBoot();
  else if (prefersReducedMotion()) requestDraw();
}

function onResize() {
  if (!renderer || !booted) return;
  resizeRenderer();
  if (prefersReducedMotion()) requestDraw();
}

function armListeners() {
  if (listening) return;
  listening = true;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('wheel', onScroll, { passive: true });
  window.addEventListener('touchmove', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
}

function dropListeners() {
  if (!listening) return;
  listening = false;
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('wheel', onScroll);
  window.removeEventListener('touchmove', onScroll);
  window.removeEventListener('resize', onResize);
}

function resizeRenderer() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = pixelRatioCap();
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
  if (splashBlocks()) return;
  if (!entries.some((entry) => !entry.dead)) return;
  try {
    boot();
  } catch {
    bootFailed = true;
    canvas?.remove();
    canvas = null;
    renderer = null;
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
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;
  gl.shadowMap.autoUpdate = true;
  gl.autoClear = false;
  gl.setClearColor(0x000000, 0);
  configureRenderer(gl);

  canvas = node;
  renderer = gl;
  booted = true;
  resizeRenderer();
  ensureQuad();

  if (prefersReducedMotion()) requestDraw();
  else startLoop();
}

function startLoop() {
  if (looping) return;
  looping = true;
  lastTime = 0;
  const tick = (time: number) => {
    if (!looping) return;
    raf = requestAnimationFrame(tick);
    if (document.hidden) return;
    draw(time);
  };
  raf = requestAnimationFrame(tick);
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
    frameBufferType: THREE.UnsignedByteType,
  });
  /* setSize would resize the shared canvas. Fit the buffers only. */
  composer.autoRenderToScreen = false;

  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 0.9,
    intensity: 0.35,
  });
  const tone = new ToneMappingEffect({
    mode: view.tone === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX,
  });
  const noise = new NoiseEffect({ premultiply: true });
  noise.blendMode.opacity.value = 0.025;
  const vignette = new VignetteEffect({ offset: 0.2, darkness: 0.25 });
  const smaa = new SMAAEffect();
  const effect = new EffectPass(camera, bloom, tone, smaa, vignette, noise);
  effect.renderToScreen = true;

  const renderPass = new RenderPass(view.scene, camera);
  renderPass.renderToScreen = false;
  composer.addPass(renderPass);

  if (view.ao) {
    const ao = new N8AOPostPass(view.scene, camera, 2, 2);
    ao.configuration.gammaCorrection = false;
    ao.setQualityMode('Performance');
    ao.configuration.halfRes = true;
    ao.configuration.aoRadius = 1.5;
    ao.configuration.intensity = 2.5;
    ao.renderToScreen = false;
    composer.addPass(ao);
  }

  composer.addPass(effect);
  entry.toneEffect = tone;
  entry.composer = composer;
  return composer;
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
  composer.render(dt);
  entry.view.element.closest('.passage')?.classList.add('is-stage');
}

function draw(time: number) {
  if (!renderer || !booted) return;
  const dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 1 / 60;
  lastTime = time;
  resizeRenderer();

  renderer.setRenderTarget(null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);

  for (const layer of LAYER_ORDER) {
    for (const entry of entries) {
      if (entry.dead || (entry.view.layer ?? 'scene') !== layer) continue;
      const rect = entry.view.element.getBoundingClientRect();
      const visible = onScreen(rect);
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
      } catch {
        /* One view can fail without stopping the others. */
      }
    }
  }

  if (canvas) canvas.dataset.stageViews = String(entries.filter((entry) => !entry.dead).length);
}

function disposeStage() {
  looping = false;
  cancelAnimationFrame(raf);
  raf = 0;
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
  };
  entries.push(entry);
  if (view.layer === 'wash' || view.layer === 'field') view.element.dataset.stageHost = 'on';
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
