/*
  Quality tiers for the shared stage. "off" skips WebGL and leaves a still.
  The governor drops a tier when frames stay slow and promotes when they stay
  easy, never more than one step above the tier we started from.
*/
import { getGPUTier } from '@pmndrs/detect-gpu';
import { prefersReducedMotion } from '../scripts/motion';

export type QualityTier = 'off' | 'low' | 'medium' | 'high' | 'ultra';

export type QualityProfile = {
  tier: QualityTier;
  maxDpr: number;
  shadowMapSize: number;
  grassScale: number;
  ao: boolean;
  aoHalfRes: boolean;
  bloom: boolean;
  transmissionScale: number;
  steamParticles: number;
  impostorDistance: number;
  hdri: '1k' | '2k';
};

const ORDER: QualityTier[] = ['off', 'low', 'medium', 'high', 'ultra'];

const PROFILES: Record<QualityTier, QualityProfile> = {
  off: {
    tier: 'off',
    maxDpr: 1,
    shadowMapSize: 0,
    grassScale: 0,
    ao: false,
    aoHalfRes: true,
    bloom: false,
    transmissionScale: 0.25,
    steamParticles: 0,
    impostorDistance: 0,
    hdri: '1k',
  },
  low: {
    tier: 'low',
    maxDpr: 1,
    shadowMapSize: 0,
    grassScale: 0.35,
    ao: false,
    aoHalfRes: true,
    bloom: false,
    transmissionScale: 0.25,
    steamParticles: 40,
    impostorDistance: 16,
    hdri: '1k',
  },
  medium: {
    tier: 'medium',
    maxDpr: 1.25,
    shadowMapSize: 1024,
    grassScale: 0.6,
    ao: true,
    aoHalfRes: true,
    bloom: false,
    transmissionScale: 0.5,
    steamParticles: 72,
    impostorDistance: 28,
    hdri: '1k',
  },
  high: {
    tier: 'high',
    maxDpr: 1.5,
    shadowMapSize: 2048,
    grassScale: 1,
    ao: true,
    aoHalfRes: true,
    bloom: true,
    transmissionScale: 0.75,
    steamParticles: 110,
    impostorDistance: 46,
    hdri: '1k',
  },
  ultra: {
    tier: 'ultra',
    maxDpr: 2,
    shadowMapSize: 2048,
    grassScale: 1.25,
    ao: true,
    aoHalfRes: false,
    bloom: true,
    transmissionScale: 1,
    steamParticles: 140,
    impostorDistance: 120,
    // Lighting stays at 1k. A 2k map is only an explicit backdrop, such as the Alps band.
    hdri: '1k',
  },
};

const listeners = new Set<(profile: QualityProfile) => void>();

let started = false;
let tier: QualityTier = 'high';
let startTier: QualityTier = 'high';
let startLocked = false;
let queryLocked = false;
let heldTier: QualityTier | null = null;
let webgl2ok = true;

let dprFrom = 1.5;
let dprTo = 1.5;
let dprAt = 0;

const frames: number[] = [];
let slowSince = 0;
let fastSince = 0;
let quietUntil = 0;
let avgMs = 0;

let debugNode: HTMLElement | null = null;
let debugFps = 0;
let debugCalls = 0;
let debugTris = 0;
let debugTex = 0;
let debugBytes = 0;

function rank(value: QualityTier): number {
  return ORDER.indexOf(value);
}

function clampTier(value: QualityTier, floor: QualityTier, ceiling: QualityTier): QualityTier {
  const low = rank(floor);
  const high = rank(ceiling);
  const next = Math.min(high, Math.max(low, rank(value)));
  return ORDER[next] ?? floor;
}

function deviceMemory(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return nav.deviceMemory ?? 0;
}

function connectionSaveData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return !!nav.connection?.saveData;
}

/**
 * A small window, or a finger with no mouse or trackpad.
 * A touch laptop that also has a fine pointer stays on the desktop path.
 */
export function isPhoneClass(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth < 1024) return true;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const fine = window.matchMedia('(any-pointer: fine)').matches;
  return coarse && !fine;
}

let builderDprLocked = false;
let seenGpu: { tier: number; type: string; gpu: string } | null = null;

/** The builder's phone stage asks for a 1x buffer even when the tier allows 1.25. */
export function lockPhoneBuilderDpr(on: boolean) {
  builderDprLocked = on;
}

/**
 * Phone profiles keep the same tier names and tighten the budget.
 * Desktop profiles are the rows above, unchanged.
 */
function activeProfile(next: QualityTier = tier): QualityProfile {
  const base = PROFILES[next];
  if (!isPhoneClass() || next === 'off' || next === 'high' || next === 'ultra') return base;
  if (next === 'low') {
    return {
      ...base,
      maxDpr: 1,
      shadowMapSize: 0,
      grassScale: 0.28,
      ao: false,
      bloom: false,
      steamParticles: 24,
    };
  }
  return {
    ...base,
    maxDpr: 1.25,
    shadowMapSize: 0,
    grassScale: 0.45,
    ao: false,
    bloom: false,
    steamParticles: 36,
  };
}

/** Forest fill. Desktop keeps the 0.35 floor. Phones may sit lower. */
export function foliageScale(density = 1): number {
  const scale = qualityProfile().grassScale * density;
  const floor = isPhoneClass() ? 0.2 : 0.35;
  return Math.max(floor, scale);
}

/** Phones draw at 30 fps. Desktop is uncapped. */
export function frameIntervalMs(): number {
  return isPhoneClass() ? 1000 / 30 : 0;
}

function forcedOff(): boolean {
  if (typeof window === 'undefined') return true;
  if (connectionSaveData()) return true;
  if (window.matchMedia('(prefers-reduced-data: reduce)').matches) return true;
  if (!webgl2ok) return true;
  return false;
}

function probeWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function readQuery(): QualityTier | null {
  const value = new URLSearchParams(window.location.search).get('quality');
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'ultra') return value;
  return null;
}

/** Cores and memory can only pull a tier down. Unknown memory does not. */
function capByHardware(value: QualityTier): QualityTier {
  if (value === 'off') return 'off';
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = deviceMemory();
  let ceiling: QualityTier = 'high';
  if ((mem > 0 && mem <= 2) || cores <= 2) ceiling = 'low';
  else if (mem > 0 && mem <= 4 && cores <= 4) ceiling = 'medium';
  return clampTier(value, 'off', ceiling);
}

function syncGuess(): QualityTier {
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = deviceMemory();
  if (mem > 0 && mem <= 2) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

function tierFromGpu(gpuTier: number, type: string): QualityTier {
  if (type === 'WEBGL_UNSUPPORTED' || type === 'BLOCKLISTED') return 'off';
  if (type === 'BENCHMARK_FETCH_FAILED' || type === 'FALLBACK' || type === 'SSR') return syncGuess();
  if (gpuTier <= 1) return 'low';
  if (gpuTier === 2) return 'medium';
  return 'high';
}

/**
 * Phones start low. A published GPU tier of 3 or above is the medium path.
 * SwiftShader is blocklisted by detect-gpu, but it is the headless stand-in
 * and it can draw the phone diet. Other blocklisted GPUs stay on the poster.
 */
function phoneTierFromGpu(gpuTier: number, type: string, gpu = ''): QualityTier {
  if (type === 'WEBGL_UNSUPPORTED') return 'off';
  if (type === 'BLOCKLISTED') return gpu.toLowerCase().includes('swiftshader') ? 'low' : 'off';
  if (type === 'BENCHMARK_FETCH_FAILED' || type === 'FALLBACK' || type === 'SSR') return 'low';
  if (gpuTier >= 3) return 'medium';
  return 'low';
}

function resolvedTier(): QualityTier {
  if (!webgl2ok) return 'off';
  if (queryLocked) return readQuery() ?? tier;
  if (forcedOff()) return 'off';
  if (isPhoneClass()) {
    const next = seenGpu ? phoneTierFromGpu(seenGpu.tier, seenGpu.type, seenGpu.gpu) : 'low';
    return next === 'off' ? 'off' : capByHardware(next);
  }
  if (seenGpu) return capByHardware(tierFromGpu(seenGpu.tier, seenGpu.type));
  return capByHardware(syncGuess());
}

function sampleDpr(now: number): number {
  const span = now - dprAt;
  if (span >= 600) return dprTo;
  const t = span / 600;
  const k = t * t * (3 - 2 * t);
  return dprFrom + (dprTo - dprFrom) * k;
}

function retargetDpr(next: number, fade: boolean) {
  const now = performance.now();
  dprFrom = fade ? sampleDpr(now) : next;
  dprTo = next;
  dprAt = fade ? now : now - 1000;
}

function paintDebug() {
  if (!debugNode) return;
  const fps = debugFps > 0 ? String(Math.round(debugFps)) : '0';
  const tris = debugTris >= 1000 ? `${(debugTris / 1000).toFixed(1)}k` : String(debugTris);
  const mb = debugBytes > 0 ? `\n${(debugBytes / (1024 * 1024)).toFixed(1)} MB est` : '';
  debugNode.textContent = `tier ${tier}\n${fps} fps\n${debugCalls} calls\n${tris} tris\n${debugTex} tex${mb}`;
}

function ensureDebug() {
  if (typeof window === 'undefined') return;
  if (!new URLSearchParams(window.location.search).has('debug3d')) return;
  if (debugNode) {
    paintDebug();
    return;
  }
  const node = document.createElement('p');
  node.className = 'stage-debug';
  node.setAttribute('aria-hidden', 'true');
  node.dataset.stageDebug = 'on';
  document.body.appendChild(node);
  debugNode = node;
  paintDebug();
}

function applyTier(next: QualityTier, fade: boolean) {
  const changed = next !== tier;
  tier = next;
  retargetDpr(activeProfile(next).maxDpr, fade && changed);
  document.documentElement.dataset.quality = next;
  if (changed) {
    frames.length = 0;
    avgMs = 0;
    slowSince = 0;
    fastSince = 0;
    quietUntil = performance.now() + 2000;
    syncStills();
    const profile = activeProfile(next);
    for (const listener of listeners) listener(profile);
  }
  ensureDebug();
  paintDebug();
}

function syncStills() {
  document.querySelectorAll<HTMLCanvasElement>('[data-meadow]').forEach((canvas) => {
    const passage = canvas.closest('.passage');
    const live = passage instanceof HTMLElement && passage.dataset.stage === 'live';
    if (tier === 'off' || !live) showStill(canvas);
    else hideStill(canvas);
  });
}

export function showStill(canvas: HTMLElement) {
  const passage = canvas.closest('.passage');
  if (!(passage instanceof HTMLElement)) return;
  const poster = canvas.dataset.poster;
  passage.classList.remove('is-stage');
  passage.classList.add('is-still');
  passage.style.backgroundImage = poster ? `url("${poster}")` : '';
}

export function hideStill(canvas: HTMLElement) {
  const passage = canvas.closest('.passage');
  if (!(passage instanceof HTMLElement)) return;
  passage.classList.remove('is-still');
  passage.style.backgroundImage = '';
}

function pickInitial(): QualityTier {
  // No WebGL2 stays off even when the query asks for a tier.
  if (!webgl2ok) return 'off';
  const query = readQuery();
  // An explicit ?quality= wins over save-data. ?quality=off stays off.
  if (query) {
    queryLocked = true;
    return query;
  }
  return resolvedTier();
}

async function refineWithGpu() {
  if (queryLocked || !webgl2ok || forcedOff()) {
    startTier = tier;
    startLocked = true;
    return;
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    webgl2ok = false;
    startTier = 'off';
    startLocked = true;
    applyTier('off', false);
    return;
  }
  try {
    const gpu = await getGPUTier({
      glContext: gl,
      benchmarksURL: '/gpu-benchmarks',
    });
    seenGpu = { tier: gpu.tier, type: gpu.type, gpu: gpu.gpu ?? '' };
    const next = resolvedTier();
    startTier = next === 'off' ? 'off' : next;
    startLocked = true;
    applyTier(next, true);
  } catch {
    startTier = tier === 'off' ? 'off' : tier;
    startLocked = true;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

function onResize() {
  if (queryLocked || !webgl2ok) return;
  const next = resolvedTier();
  if (next === tier) return;
  if (next === 'off') {
    heldTier = startLocked && startTier !== 'off' ? startTier : tier;
    applyTier('off', false);
    return;
  }
  heldTier = null;
  startTier = next;
  applyTier(next, true);
}

export function ensureQuality(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  webgl2ok = probeWebGL2();
  const initial = pickInitial();
  startTier = initial;
  applyTier(initial, false);
  if (!queryLocked && initial !== 'off') void refineWithGpu();
  else startLocked = true;
  window.addEventListener('resize', onResize, { passive: true });
}

export function qualityProfile(): QualityProfile {
  ensureQuality();
  return activeProfile(tier);
}

export function onQuality(listener: (profile: QualityProfile) => void): () => void {
  ensureQuality();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hdriFor(url: string): string {
  return url.replace(/_(1|2)k\.hdr$/, `_${qualityProfile().hdri}.hdr`);
}

/**
 * Scroll progress still moves the camera. Wind, steam, and drift do not.
 * Reduced motion on a phone stays on the passage poster (the scheduler
 * refuses to mount). Desktop keeps this freeze when a view is already up.
 */
export function motionTime(ms: number): number {
  return prefersReducedMotion() ? 0 : ms * 0.001;
}

/**
 * Rolling 90-frame average. A frame above 80ms is a hitch, not a sample:
 * it blocks promotion and stays out of the average. Drop after 2s over 20ms.
 * Promote after 6s under 11ms, and never above the start tier plus one.
 */
export function noteFrame(ms: number): void {
  if (tier === 'off' || !startLocked || prefersReducedMotion()) return;
  const now = performance.now();
  if (now < quietUntil) return;
  if (!Number.isFinite(ms) || ms <= 0 || ms > 80) {
    fastSince = 0;
    return;
  }
  frames.push(ms);
  if (frames.length > 90) frames.shift();
  avgMs = frames.reduce((sum, value) => sum + value, 0) / frames.length;
  debugFps = 1000 / avgMs;
  if (frames.length < 90) return;

  if (avgMs > 20) {
    if (!slowSince) slowSince = now;
    fastSince = 0;
    if (now - slowSince >= 2000 && rank(tier) > rank('low')) {
      slowSince = 0;
      applyTier(ORDER[rank(tier) - 1] ?? 'low', true);
    }
    return;
  }
  slowSince = 0;

  let ceiling = clampTier(ORDER[rank(startTier) + 1] ?? startTier, 'low', 'ultra');
  // A phone never climbs into high on its own. An explicit ?quality= above medium stays put.
  if (isPhoneClass()) {
    const cap: QualityTier = queryLocked && rank(startTier) > rank('medium') ? startTier : 'medium';
    if (rank(ceiling) > rank(cap)) ceiling = cap;
  }
  if (avgMs < 11 && rank(tier) < rank(ceiling)) {
    if (!fastSince) fastSince = now;
    if (now - fastSince >= 6000) {
      fastSince = 0;
      applyTier(ORDER[rank(tier) + 1] ?? tier, true);
    }
    return;
  }
  fastSince = 0;
}

export function displayDpr(): number {
  ensureQuality();
  if (tier === 'off' || builderDprLocked) return 1;
  const dpr = sampleDpr(performance.now());
  if (!isPhoneClass()) return dpr;
  if (tier === 'low') return Math.min(dpr, 1);
  if (tier === 'medium') return Math.min(dpr, 1.25);
  return dpr;
}

export function setDebugStats(stats: { calls: number; tris: number; textures: number; bytes?: number }) {
  debugCalls = stats.calls;
  debugTris = stats.tris;
  debugTex = stats.textures;
  debugBytes = stats.bytes ?? 0;
  if (avgMs > 0) debugFps = 1000 / avgMs;
  paintDebug();
}
