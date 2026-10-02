import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;
let tickerFn: ((time: number) => void) | null = null;

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function initSmoothScroll() {
  if (tickerFn) {
    gsap.ticker.remove(tickerFn);
    tickerFn = null;
  }
  if (lenis) {
    lenis.destroy();
    lenis = null;
  }

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
  return lenis;
}

export function scrollTo(target: string | HTMLElement, offset = 0) {
  if (lenis) {
    lenis.scrollTo(target, { offset, duration: 1.35 });
    return;
  }
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

export { gsap, ScrollTrigger, lenis };
