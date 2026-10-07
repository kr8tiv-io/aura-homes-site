import { gsap, ScrollTrigger, prefersReducedMotion } from './motion';

const ID = 'depth-parallax';

/**
 * 0.8 scroll speed means the picture lags the frame.
 * Across the whole pass (frame entering to leaving) it travels
 * (1 - speed) of that distance, inside the clip.
 * Scale runs 1.15 to 1 on the same transform. Ease stays none
 * so the speed stays constant. Scrub lag is the calm.
 */
function readZoom(frame: HTMLElement) {
  const zoom = Number(frame.dataset.zoom || '1');
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function readOriginY(origin: string) {
  const part = origin.trim().split(/\s+/)[1] || '50%';
  if (part.endsWith('%')) {
    const value = Number(part.slice(0, -1)) / 100;
    if (Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  }
  return 0.5;
}

function readSpeed(layer: HTMLElement) {
  const speed = Number(layer.dataset.depthSpeed);
  return Number.isFinite(speed) ? speed : 0.8;
}

/** How far this layer can slide without opening a gap at the resting scale. */
function travelFor(frame: HTMLElement, speed: number, zoom: number, originY: number) {
  const frameH = frame.clientHeight;
  const ideal = Math.abs(1 - speed) * (frameH + window.innerHeight);
  if (zoom > 1.01) {
    const slackTop = originY * (zoom - 1) * frameH;
    const slackBottom = (1 - originY) * (zoom - 1) * frameH;
    const half = Math.min(ideal / 2, slackTop, slackBottom);
    return { extra: 0, half };
  }
  return { extra: ideal, half: ideal / 2 };
}

function narrow() {
  return window.matchMedia('(max-width: 800px)').matches;
}

/**
 * Phone story bleeds keep a short drift. The desktop travel is deep enough
 * to slide the room out and leave only the grass.
 */
function place(mover: HTMLElement, frame: HTMLElement, speed: number, zoom: number, originY: number) {
  if (narrow() && frame.classList.contains('story-bleed')) {
    // The phone frame matches the still. Any travel would open a gap.
    mover.style.height = '100%';
    mover.style.top = '0px';
    return 0;
  }
  const { extra, half } = travelFor(frame, speed, zoom, originY);
  mover.style.height = extra > 0 ? `${frame.clientHeight + extra}px` : '100%';
  mover.style.top = extra > 0 ? `${-extra / 2}px` : '0px';
  return half;
}

function settle(mover: HTMLElement, zoom: number) {
  mover.style.height = '100%';
  mover.style.top = '0px';
  gsap.set(mover, { y: 0, scale: zoom, overwrite: 'auto' });
}

/** Clip-safe parallax for every DepthImage on the page. */
export function bindDepthImages() {
  ScrollTrigger.getAll()
    .filter((trigger) => trigger.vars.id === ID)
    .forEach((trigger) => trigger.kill());

  const roots = gsap.utils.toArray<HTMLElement>('[data-depth-root]');
  if (!roots.length) return;

  roots.forEach((root) => {
    const frame =
      root.closest<HTMLElement>('.story-bleed, .wild-frame, .stay-frame, .living-hero') ?? root;
    const zoom = readZoom(frame);
    const origin = frame.dataset.depthOrigin || '50% 50%';
    const originY = readOriginY(origin);
    const reduced = prefersReducedMotion();

    root.querySelectorAll<HTMLElement>('[data-depth-speed]').forEach((layer) => {
      const mover = layer.querySelector<HTMLElement>('.depth-mover');
      if (!mover) return;
      const speed = readSpeed(layer);
      mover.style.transformOrigin = origin;

      if (reduced) {
        settle(mover, zoom);
        return;
      }

      const half = () => place(mover, frame, speed, zoom, originY);
      const startScale = () => (narrow() && frame.classList.contains('story-bleed') ? zoom : zoom * 1.15);
      gsap.fromTo(
        mover,
        { y: () => half(), scale: startScale },
        {
          y: () => -half(),
          scale: zoom,
          ease: 'none',
          force3D: true,
          scrollTrigger: {
            id: ID,
            trigger: frame,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1.4,
            invalidateOnRefresh: true,
          },
        },
      );
    });
  });

  requestAnimationFrame(() => ScrollTrigger.refresh());
}
