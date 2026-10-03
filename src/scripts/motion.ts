import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Shared feel for later effects. Long eases, nothing bouncy.
 * Animate transform and opacity only.
 * Pages that already tween keep their own numbers.
 * The splash film scrub stays in src/pages/index.astro.
 */
export const ease = {
  out: 'power3.out',
  inOut: 'power3.inOut',
  scrub: 'none',
  css: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

export const duration = {
  rise: 1.75,
  slow: 1.9,
  line: 1.25,
  fade: 1.15,
  scroll: 1.35,
} as const;

let lenis: Lenis | null = null;
let tickerFn: ((time: number) => void) | null = null;
const pageResets: Array<() => void> = [];

/** Register cleanup for a page effect so the next view transition can release it. */
export function holdPageMotion(stop: () => void) {
  pageResets.push(stop);
}

/** Drop scroll triggers and page effects before a view transition swaps the document. */
export function resetPageMotion() {
  while (pageResets.length) pageResets.pop()?.();
  ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
}

/**
 * Run page setup now, and again after each view transition.
 * The first astro:page-load is skipped because setup already ran.
 */
export function onPageLoad(setup: () => void) {
  setup();
  let skipFirst = true;
  document.addEventListener('astro:page-load', () => {
    if (skipFirst) {
      skipFirst = false;
      return;
    }
    setup();
  });
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type TweenConfig = NonNullable<Parameters<typeof gsap.to>[1]>;

/** Defaults for a later tween. Null when the visitor prefers reduced motion. */
export function motionVars(overrides: TweenConfig = {}): TweenConfig | null {
  if (prefersReducedMotion()) return null;
  return {
    duration: duration.rise,
    ease: ease.out,
    ...overrides,
  };
}

/** Run a later effect only when motion is allowed. */
export function ifMotion<T>(create: () => T): T | null {
  if (prefersReducedMotion()) return null;
  return create();
}

/** Stop the smooth-scroll loop so a view transition can start a fresh one. */
export function stopSmoothScroll() {
  if (tickerFn) {
    gsap.ticker.remove(tickerFn);
    tickerFn = null;
  }
  if (lenis) {
    lenis.destroy();
    lenis = null;
  }
  window.__lenis = undefined;
}

export function initSmoothScroll() {
  stopSmoothScroll();

  lenis = new Lenis({
    lerp: 0.1,
    wheelMultiplier: 1.2,
    touchMultiplier: 1.35,
    smoothWheel: true,
    syncTouch: true,
    anchors: true,
    autoRaf: false,
    respectReducedMotion: true,
  });

  lenis.on('scroll', ScrollTrigger.update);

  tickerFn = (time: number) => {
    lenis?.raf(time * 1000);
  };
  gsap.ticker.add(tickerFn);
  gsap.ticker.lagSmoothing(0);

  window.__lenis = lenis;
  window.__ScrollTrigger = ScrollTrigger;
  document.documentElement.classList.add('lenis');
  ScrollTrigger.refresh();
  return lenis;
}

export function scrollTo(target: string | HTMLElement, offset = 0) {
  if (lenis) {
    lenis.scrollTo(target, { offset, duration: duration.scroll });
    return;
  }
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

export { gsap, ScrollTrigger, lenis };
