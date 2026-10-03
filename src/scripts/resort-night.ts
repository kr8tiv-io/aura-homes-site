import { gsap } from 'gsap';

/**
 * Night over the Stay still. Stars are one small canvas.
 * Steam is a handful of blurred sprites. Twinkle runs only
 * while the panel is on screen and motion is allowed.
 */

const STAR_COUNT = 90;
const DPR_CAP = 1.25;

export type ResortNight = {
  setProgress: (progress: number) => void;
  destroy: () => void;
};

type Star = {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
  base: number;
  warm: boolean;
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

/** 0 before start, 1 after end, smoothed between. */
const band = (progress: number, start: number, end: number) => {
  if (end <= start) return progress >= end ? 1 : 0;
  return smooth((progress - start) / (end - start));
};

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars(): Star[] {
  const rand = mulberry32(0x51a7);
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const roll = rand();
    stars.push({
      x: rand(),
      y: rand() * rand() * 0.96,
      size: roll > 0.92 ? 2.2 : roll > 0.72 ? 1.5 : 1,
      phase: rand() * Math.PI * 2,
      speed: 0.35 + rand() * 0.7,
      base: 0.35 + rand() * 0.65,
      warm: rand() > 0.82,
    });
  }
  return stars;
}

const motionQuery = '(min-width: 801px) and (prefers-reduced-motion: no-preference)';

export function mountResortNight(root: HTMLElement): ResortNight {
  const sky = root.querySelector<HTMLElement>('[data-night-sky]');
  const glow = root.querySelector<HTMLElement>('[data-night-glow]');
  const moon = root.querySelector<HTMLElement>('[data-night-moon]');
  const canvas = root.querySelector<HTMLCanvasElement>('[data-night-stars]');
  const sprites = Array.from(root.querySelectorAll<HTMLElement>('[data-night-steam] span'));
  const lines = Array.from(root.querySelectorAll<HTMLElement>('[data-night-line]'));
  const context = canvas?.getContext('2d', { alpha: true }) ?? null;
  const stars = makeStars();

  const skyOpacity = sky ? gsap.quickSetter(sky, 'opacity') : null;
  const glowOpacity = glow ? gsap.quickSetter(glow, 'opacity') : null;
  const moonOpacity = moon ? gsap.quickSetter(moon, 'opacity') : null;
  const moonY = moon ? gsap.quickSetter(moon, 'y', 'px') : null;
  const lineSet = lines.map((line) => ({
    opacity: gsap.quickSetter(line, 'opacity'),
    y: gsap.quickSetter(line, 'y', 'px'),
  }));
  const steamSet = sprites.map((sprite) => ({
    opacity: gsap.quickSetter(sprite, 'opacity'),
    x: gsap.quickSetter(sprite, 'x', 'px'),
    y: gsap.quickSetter(sprite, 'y', 'px'),
  }));

  const lineWindows: Array<[number, number]> = [
    [0.18, 0.36],
    [0.4, 0.58],
    [0.62, 0.8],
  ];

  const media = window.matchMedia(motionQuery);
  let allowMotion = media.matches;
  let onScreen = false;
  let hidden = document.hidden;
  let dead = false;
  let frame = 0;
  let needsSize = true;
  let starLevel = 0;
  let steamLevel = 0;

  const placeSteam = (now: number, drifting: boolean) => {
    steamSet.forEach((set, index) => {
      const local = clamp((steamLevel - index * 0.07) / 0.78);
      const shown = local * local * (3 - 2 * local);
      const driftX = drifting ? Math.cos(now * 0.00045 + index * 1.2) * 8 : 0;
      const driftY = drifting ? Math.sin(now * 0.00055 + index * 1.45) * 12 : 0;
      set.opacity(shown * (0.48 + (index % 3) * 0.1));
      set.x(driftX);
      set.y((1 - shown) * 16 - shown * (10 + index * 18) + driftY);
    });
  };

  const drawStars = (now: number, twinkle: boolean) => {
    if (!canvas || !context) return;
    if (needsSize) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      needsSize = false;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (starLevel < 0.004) return;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    for (let i = 0; i < stars.length; i += 1) {
      const star = stars[i];
      const flicker = twinkle ? 0.55 + 0.45 * Math.sin(now * 0.001 * star.speed + star.phase) : 0.86;
      context.globalAlpha = starLevel * star.base * flicker;
      context.fillStyle = star.warm ? '#f4f3ef' : '#ffffff';
      context.fillRect(star.x * canvas.width, star.y * canvas.height, star.size * dpr, star.size * dpr);
    }
    context.globalAlpha = 1;
  };

  const paintStill = () => {
    placeSteam(0, false);
    drawStars(0, false);
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    drawStars(now, true);
    placeSteam(now, true);
  };

  const syncLoop = () => {
    const want = allowMotion && onScreen && !hidden && (starLevel > 0.02 || steamLevel > 0.02);
    if (want && !frame) frame = requestAnimationFrame(tick);
    if (!want && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      paintStill();
    }
  };

  const setProgress = (progress: number) => {
    if (dead) return;
    const p = clamp(progress);
    starLevel = band(p, 0.06, 0.4);
    steamLevel = band(p, 0.5, 0.82);
    skyOpacity?.(band(p, 0, 0.4));
    const risen = band(p, 0.2, 0.62);
    moonOpacity?.(risen);
    moonY?.((1 - risen) * 72);
    glowOpacity?.(band(p, 0.45, 0.8));
    lineSet.forEach((set, index) => {
      const span = lineWindows[index] ?? [0.8, 1];
      const shown = band(p, span[0], span[1]);
      set.opacity(shown);
      set.y((1 - shown) * 14);
    });
    if (!frame) paintStill();
    syncLoop();
  };

  const onMotion = () => {
    allowMotion = media.matches;
    syncLoop();
    if (!frame) paintStill();
  };
  const onVisibility = () => {
    hidden = document.hidden;
    syncLoop();
  };
  const onResize = () => {
    needsSize = true;
    if (!frame) drawStars(0, false);
  };

  media.addEventListener('change', onMotion);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);

  const seen = new IntersectionObserver(
    (entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      syncLoop();
    },
    { threshold: 0.08 },
  );
  seen.observe(root);

  const resized = new ResizeObserver(() => {
    needsSize = true;
    if (!frame) drawStars(0, false);
  });
  if (canvas) resized.observe(canvas);

  setProgress(allowMotion ? 0 : 1);

  return {
    setProgress,
    destroy: () => {
      if (dead) return;
      dead = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      seen.disconnect();
      resized.disconnect();
      media.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    },
  };
}
