/*
  Lazy passage mounting.

  Prompt 65 enables phones without editing this file.

  - src/three/quality.ts
    An explicit ?quality=low|medium|high|ultra|off already wins over the
    width, pointer, and save-data gate. No-WebGL2 stays off. To let phones
    mount, narrow forcedOff() so a phone can leave the off tier.
  - src/three/tier-assets.ts
    Per-tier trees, vista, props, LOD, Alps band, and unpinned HDRI size.
    Worlds read tierAssets() while they build. This module only re-exports
    that map. Change the rows, not the scheduler.

  passageBudget(), from the live quality profile:
  - off, and reduced motion: nothing mounts. The poster stays.
  - every other tier mounts a passage when it is near the viewport, and
    leaves it mounted. Scrolling back must not tear the world down.
    Rendering still pauses while that passage is offscreen.

  A world is created only after window load plus an idle callback, and only
  when its passage is within about two viewport heights on a phone, or
  about three and a half on a desktop. Once nearby photos have finished,
  idle time may prefetch the next passage only when that passage is already
  inside the same lead. A passage still far below the fold stays on its
  poster and does not fetch.
*/
import mark from '../assets/logo/aura-mark.svg?raw';
import { prefersReducedMotion } from '../scripts/motion';
import { openLoadSession } from './asset-progress';
import { visualsPending } from './loaders';
import { hideStill, isPhoneClass, onQuality, qualityProfile, showStill, type QualityTier } from './quality';

export { tierAssets, type TierAssetPlan } from './tier-assets';

export type PassageBudget = {
  /** False on the off tier and while motion is reduced. The poster stays. */
  mount: boolean;
  /**
   * Retained for callers. Mounted worlds are not discarded to honour this
   * number: tearing one down to show the next re-fetched shared files and
   * flashed the poster on the way back.
   */
  maxLive: number;
};

export type PassageLive = {
  destroy: () => void;
};

const LINES: Record<string, string> = {
  grass: 'Preparing the meadow.',
  far: 'Preparing the meadow.',
  glass: 'Preparing the glass.',
  steam: 'Preparing the water.',
  slope: 'Preparing the slope.',
  snow: 'Preparing the snow.',
};

const RING = 289;

type Slot = {
  canvas: HTMLCanvasElement;
  passage: HTMLElement;
  mount: () => PassageLive | null;
  live: PassageLive | null;
  wanted: boolean;
  loading: boolean;
  generation: number;
};

const slots: Slot[] = [];
let observer: IntersectionObserver | null = null;
let settled: Promise<void> | null = null;
let reconciling = false;
let again = false;
let hooked = false;
let prefetchQueued = false;

export function passageBudget(tier: QualityTier = qualityProfile().tier): PassageBudget {
  if (tier === 'off' || prefersReducedMotion()) return { mount: false, maxLive: 0 };
  if (tier === 'low' || tier === 'medium') return { mount: true, maxLive: 1 };
  return { mount: true, maxLive: 6 };
}

/** window load, then an idle callback (or a short timeout when idle is missing). */
export function whenPageSettled(): Promise<void> {
  if (settled) return settled;
  settled = new Promise((resolve) => {
    const idle = () => {
      const ric = window.requestIdleCallback;
      if (typeof ric === 'function') ric(() => resolve(), { timeout: 1500 });
      else window.setTimeout(resolve, 300);
    };
    if (document.readyState === 'complete') idle();
    else window.addEventListener('load', idle, { once: true });
  });
  return settled;
}

function lineFor(canvas: HTMLCanvasElement): string {
  return LINES[canvas.dataset.scene || ''] || 'Preparing the meadow.';
}

function showLoader(passage: HTMLElement, line: string) {
  passage.querySelector('[data-passage-loader]')?.remove();
  if (prefersReducedMotion()) return null;
  const node = document.createElement('div');
  node.className = 'passage-loader';
  node.dataset.passageLoader = 'on';
  node.innerHTML = `
    <div class="passage-loader-cluster">
      <div class="passage-loader-mark" aria-hidden="true">${mark}
        <svg class="passage-loader-progress" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(156,122,85,0.35)" stroke-width="1.25"></circle>
          <circle data-loader-ring cx="60" cy="60" r="46" fill="none" stroke="#9c7a55" stroke-width="1.25" stroke-dasharray="${RING}" stroke-dashoffset="${RING}" transform="rotate(-90 60 60)"></circle>
        </svg>
      </div>
      <p class="passage-loader-name" aria-hidden="true">AURA</p>
      <p class="passage-loader-line">${line}</p>
    </div>`;
  const copy = passage.querySelector('.passage-copy');
  if (copy) passage.insertBefore(node, copy);
  else passage.appendChild(node);
  const ring = node.querySelector<SVGCircleElement>('[data-loader-ring]');
  return {
    setProgress(ratio: number) {
      if (!ring) return;
      const clamped = Math.max(0, Math.min(1, ratio));
      ring.style.strokeDashoffset = String(RING * (1 - clamped));
    },
    finish() {
      node.classList.add('is-leaving');
      const remove = () => {
        if (node.isConnected) node.remove();
      };
      node.addEventListener('transitionend', remove, { once: true });
      window.setTimeout(remove, 1400);
    },
    remove() {
      node.remove();
    },
  };
}

function release(slot: Slot) {
  slot.generation += 1;
  slot.loading = false;
  slot.live?.destroy();
  slot.live = null;
  delete slot.passage.dataset.stage;
  slot.passage.classList.remove('is-stage');
  slot.passage.querySelector('[data-passage-loader]')?.remove();
  showStill(slot.canvas);
}

function closeness(slot: Slot): number {
  const rect = slot.passage.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  return Math.abs(mid - window.innerHeight / 2);
}

function leadViewports(): number {
  // Two viewport heights on a phone. Desktop scrolls farther between frames.
  return isPhoneClass() ? 2 : 3.5;
}

function leadMargin(): string {
  const pct = Math.round(leadViewports() * 100);
  return `${pct}% 0px ${pct}% 0px`;
}

/**
 * Same window as the IntersectionObserver rootMargin. A passage is near when
 * any part of it overlaps the viewport expanded by leadViewports().
 */
function passageIsNear(passage: HTMLElement): boolean {
  const rect = passage.getBoundingClientRect();
  if (rect.height < 8) return false;
  const vh = window.innerHeight || 1;
  const lead = vh * leadViewports();
  return rect.bottom > -lead && rect.top < vh + lead;
}

/**
 * The next passage below the fold, after the photos around the scroll
 * position have finished. It must already sit inside the lead. A passage
 * that is still far below the fold is left alone. The observer mounts it
 * once it comes near.
 */
function schedulePrefetch() {
  if (prefetchQueued || typeof window === 'undefined') return;
  prefetchQueued = true;
  const run = () => {
    prefetchQueued = false;
    void whenPageSettled().then(() => {
      if (prefersReducedMotion() || qualityProfile().tier === 'off') return;
      if (visualsPending()) {
        window.setTimeout(schedulePrefetch, 500);
        return;
      }
      const vh = window.innerHeight || 1;
      const ordered = [...slots].sort(
        (a, b) => a.passage.getBoundingClientRect().top - b.passage.getBoundingClientRect().top,
      );
      let picked = false;
      for (const slot of ordered) {
        const top = slot.passage.getBoundingClientRect().top;
        if (slot.wanted || slot.live || slot.loading || top <= vh * 0.85) continue;
        if (picked) break;
        if (!passageIsNear(slot.passage)) break;
        picked = true;
        activate(slot);
      }
    });
  };
  const ric = window.requestIdleCallback;
  if (typeof ric === 'function') ric(() => run(), { timeout: 1800 });
  else window.setTimeout(run, 700);
}

function activate(slot: Slot) {
  if (slot.live || slot.loading) return;
  const budget = passageBudget();
  if (!budget.mount) return;
  const generation = ++slot.generation;
  slot.loading = true;
  showStill(slot.canvas);
  const loader = showLoader(slot.passage, lineFor(slot.canvas));
  const session = openLoadSession();
  const stopProgress = session.subscribe((ratio) => loader?.setProgress(ratio));
  let live: PassageLive | null = null;
  try {
    live = slot.mount();
  } catch {
    live = null;
  }
  if (!live || slot.generation !== generation) {
    stopProgress();
    session.close();
    loader?.remove();
    live?.destroy();
    slot.loading = false;
    slot.live = null;
    showStill(slot.canvas);
    return;
  }
  slot.live = live;
  const finish = () => {
    if (slot.generation !== generation) return;
    slot.loading = false;
    hideStill(slot.canvas);
    stopProgress();
    session.close();
    loader?.finish();
  };
  if (slot.passage.dataset.stage === 'live') finish();
  else slot.passage.addEventListener('aura-stage-live', finish, { once: true });
  window.setTimeout(() => {
    if (slot.generation !== generation) return;
    if (slot.passage.dataset.stage === 'live') return;
    loader?.remove();
    showStill(slot.canvas);
  }, 90000);
}

async function reconcile() {
  if (reconciling) {
    again = true;
    return;
  }
  reconciling = true;
  try {
    await whenPageSettled();
    const budget = passageBudget();
    if (!budget.mount) {
      for (const slot of slots) {
        if (slot.live || slot.loading) release(slot);
        else showStill(slot.canvas);
      }
      return;
    }
    const wanted = slots.filter((slot) => slot.wanted);
    const nearest = [...wanted].sort((a, b) => closeness(a) - closeness(b));
    for (const slot of nearest) {
      if (slot.live || slot.loading) continue;
      activate(slot);
    }
  } finally {
    reconciling = false;
    if (again) {
      again = false;
      void reconcile();
    } else if (budgetMounting()) {
      schedulePrefetch();
    }
  }
}

function budgetMounting(): boolean {
  return passageBudget().mount;
}

function ensureHooks() {
  if (hooked || typeof window === 'undefined') return;
  hooked = true;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  motion.addEventListener('change', () => {
    void reconcile();
  });
  onQuality(() => {
    void reconcile();
  });
  document.addEventListener('aura-stage-failed', () => {
    for (const slot of slots) release(slot);
  });
  window.addEventListener('scroll', () => schedulePrefetch(), { passive: true });
  observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        const slot = slots.find((item) => item.passage === record.target);
        if (!slot) continue;
        slot.wanted = record.isIntersecting;
      }
      void reconcile();
    },
    { root: null, rootMargin: leadMargin(), threshold: 0 },
  );
}

/**
 * Keep the poster until this passage is near the viewport, then mount it.
 * The returned function disposes the world and stops watching.
 */
export function watchPassage(canvas: HTMLCanvasElement, mount: () => PassageLive | null): () => void {
  const passage = canvas.closest('.passage');
  if (!(passage instanceof HTMLElement)) {
    const live = mount();
    return () => live?.destroy();
  }
  showStill(canvas);
  ensureHooks();
  const slot: Slot = {
    canvas,
    passage,
    mount,
    live: null,
    wanted: false,
    loading: false,
    generation: 0,
  };
  slots.push(slot);
  observer?.observe(passage);
  return () => {
    observer?.unobserve(passage);
    const index = slots.indexOf(slot);
    if (index >= 0) slots.splice(index, 1);
    slot.generation += 1;
    slot.live?.destroy();
    slot.live = null;
    passage.querySelector('[data-passage-loader]')?.remove();
  };
}
