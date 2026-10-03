import { gsap } from 'gsap';
import { ScrollTrigger, duration, prefersReducedMotion } from './motion';

let tween: gsap.core.Timeline | null = null;
let loadHooked = false;

function hookLoad() {
  if (loadHooked) return;
  loadHooked = true;
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}

/** Full-page dawn, golden hour, and dusk. Opacity only, tied to page scroll. */
export function bindDaylight() {
  if (tween) {
    tween.scrollTrigger?.kill();
    tween.kill();
    tween = null;
  }

  const root = document.getElementById('daylight');
  const dawn = root?.querySelector<HTMLElement>('.daylight-dawn');
  const gold = root?.querySelector<HTMLElement>('.daylight-gold');
  const dusk = root?.querySelector<HTMLElement>('.daylight-dusk');
  if (!root || !dawn || !gold || !dusk) return;

  if (prefersReducedMotion()) {
    gsap.set(dawn, { opacity: 1 });
    gsap.set([gold, dusk], { opacity: 0 });
    return;
  }

  gsap.set(dawn, { opacity: 1 });
  gsap.set(gold, { opacity: 0 });
  gsap.set(dusk, { opacity: 0 });

  const range = document.documentElement.scrollHeight - window.innerHeight;
  if (range < 64) return;

  hookLoad();
  tween = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: document.body,
      start: 'top top',
      end: 'bottom bottom',
      scrub: duration.scroll,
    },
  });
  tween.to(dawn, { opacity: 0, duration: 0.55 }, 0);
  tween.to(gold, { opacity: 1, duration: 0.42 }, 0.12);
  tween.to(gold, { opacity: 0, duration: 0.42 }, 0.55);
  tween.to(dusk, { opacity: 1, duration: 0.45 }, 0.55);
}
