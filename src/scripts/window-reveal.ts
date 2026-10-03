import { gsap, ScrollTrigger, duration, ease, prefersReducedMotion } from './motion';

const ID = 'window-reveal';
const CLOSED_Y = '49.5%';
const CLOSED_X = '16%';
const OPEN = '0%';
const SCALE = 1.07;

let loadHooked = false;

function dropWindows() {
  ScrollTrigger.getAll()
    .filter((trigger) => trigger.vars.id === ID)
    .forEach((trigger) => trigger.kill());
}

function mediaOf(frame: HTMLElement) {
  return frame.querySelector<HTMLElement>('[data-window-media]');
}

function settle(frame: HTMLElement) {
  frame.setAttribute('data-window-done', '');
  frame.style.setProperty('--win-y', OPEN);
  frame.style.setProperty('--win-x', OPEN);
  const media = mediaOf(frame);
  if (media) gsap.set(media, { clearProps: 'transform' });
}

/** How long a card waits behind the others in its grid. Story frames wait none. */
function gridDelay(frame: HTMLElement, batch: Element[]) {
  const grid = frame.closest('[data-window-grid]');
  if (!grid) return 0;
  const mates = batch.filter((node) => node.closest('[data-window-grid]') === grid);
  const index = mates.indexOf(frame);
  return index > 0 ? index * 0.1 : 0;
}

function open(frame: HTMLElement, delay: number) {
  const media = mediaOf(frame);
  const shared = {
    duration: duration.slow,
    ease: ease.inOut,
    delay,
    overwrite: 'auto' as const,
  };
  let pending = media ? 2 : 1;
  const finish = () => {
    pending -= 1;
    if (pending > 0) return;
    settle(frame);
  };
  gsap.to(frame, {
    ...shared,
    '--win-y': OPEN,
    '--win-x': OPEN,
    onComplete: finish,
  });
  if (media) {
    gsap.to(media, {
      ...shared,
      scale: 1,
      transformOrigin: '50% 50%',
      force3D: true,
      onComplete: finish,
    });
  }
}

function hookLoad() {
  if (loadHooked) return;
  loadHooked = true;
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}

/**
 * Photographs open like a window.
 * The frame begins as a thin inset along the horizon, then grows outward.
 * The picture inside eases down a little on the same breath.
 * Cards that share a grid follow one another by 0.1s.
 * The splash film is not part of this.
 */
export function bindWindowReveals() {
  dropWindows();

  const frames = gsap.utils.toArray<HTMLElement>('[data-window]');
  if (!frames.length) return;

  frames.forEach((frame) => {
    gsap.killTweensOf(frame);
    const media = mediaOf(frame);
    if (media) gsap.killTweensOf(media);
  });

  if (prefersReducedMotion()) {
    frames.forEach(settle);
    return;
  }

  const fresh = frames.filter((frame) => !frame.hasAttribute('data-window-done'));
  fresh.forEach((frame) => {
    gsap.set(frame, { '--win-y': CLOSED_Y, '--win-x': CLOSED_X });
    const media = mediaOf(frame);
    if (media) gsap.set(media, { scale: SCALE, transformOrigin: '50% 50%', force3D: true });
  });

  if (!fresh.length) return;

  const created = ScrollTrigger.batch(fresh, {
    start: 'top 86%',
    once: true,
    onEnter: (entered) => {
      entered.forEach((node) => open(node as HTMLElement, gridDelay(node as HTMLElement, entered)));
    },
  });
  created.forEach((trigger) => {
    trigger.vars.id = ID;
  });

  hookLoad();
  requestAnimationFrame(() => ScrollTrigger.refresh());
}
