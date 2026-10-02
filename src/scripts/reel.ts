import { gsap, ScrollTrigger } from './motion';
import { bindFilmScrub } from './film-scrub';

type Mode = 'drift' | 'glide' | 'push' | 'lift' | 'rise' | 'wipe' | 'return' | 'hold' | 'steam';

const MODES: Record<
  Mode,
  {
    scale: number;
    endScale: number;
    xPercent: number;
    yPercent: number;
    rotate: number;
    clip: string | null;
    scrub: number;
    map: (p: number) => number;
  }
> = {
  drift: { scale: 1.08, endScale: 1, xPercent: -6, yPercent: 0, rotate: -1.1, clip: null, scrub: 0.35, map: (p) => p },
  glide: { scale: 1.05, endScale: 1, xPercent: 7, yPercent: 0, rotate: 0, clip: null, scrub: 0.6, map: (p) => p },
  push: { scale: 1.2, endScale: 1, xPercent: 0, yPercent: 5, rotate: 0, clip: null, scrub: 0.45, map: (p) => p },
  lift: { scale: 1.04, endScale: 1, xPercent: 0, yPercent: 12, rotate: 0, clip: null, scrub: 0.3, map: (p) => Math.min(1, p * 1.08) },
  rise: {
    scale: 1.08,
    endScale: 1,
    xPercent: 0,
    yPercent: 14,
    rotate: 0,
    clip: 'inset(24% 10% 30% 10%)',
    scrub: 0.35,
    map: (p) => Math.max(0, (p - 0.12) / 0.88),
  },
  wipe: {
    scale: 1.04,
    endScale: 1,
    xPercent: 0,
    yPercent: 0,
    rotate: 0,
    clip: 'inset(0% 36% 0% 36%)',
    scrub: 0.32,
    map: (p) => p * p * (3 - 2 * p),
  },
  return: {
    scale: 1.1,
    endScale: 1.02,
    xPercent: -7,
    yPercent: 0,
    rotate: 1.4,
    clip: null,
    scrub: 0.4,
    map: (p) => (p < 0.62 ? p / 0.62 : 1 - ((p - 0.62) / 0.38) * 0.55),
  },
  hold: { scale: 1.03, endScale: 1.01, xPercent: 0, yPercent: 0, rotate: 0, clip: null, scrub: 0.65, map: (p) => Math.min(1, p / 0.5) },
  steam: { scale: 1.12, endScale: 1.02, xPercent: 0, yPercent: 0, rotate: 0, clip: 'inset(18% 5% 0% 5%)', scrub: 0.5, map: (p) => p },
};

/** Scroll position drives each still's film, with a different play shape per shot. */
export function bindReels(root: ParentNode = document) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>('video[data-play]'));
  const stops: Array<() => void> = [];
  const ready = fetch('/film/scroll/manifest.json')
    .then((res) => (res.ok ? res.json() : {}))
    .then((data: { films?: string[] }) => new Set(data.films || []))
    .catch(() => new Set<string>());

  videos.forEach((video) => {
    const film = video.dataset.film;
    let attached = Boolean(video.getAttribute('src'));
    const attach = () => {
      if (attached || !film) return;
      attached = true;
      ready.then((names) => {
        const file = film.split('/').pop() || '';
        if (!names.has(file)) {
          attached = false;
          return;
        }
        if (video.getAttribute('src')) return;
        video.preload = 'auto';
        video.src = film;
        video.load();
      });
    };

    video.muted = true;
    video.playsInline = true;
    video.pause();

    const mode = (MODES[video.dataset.play as Mode] ? video.dataset.play : 'drift') as Mode;
    const spec = MODES[mode];
    const scrub = bindFilmScrub(video);
    const figure = video.closest('.story-figure') || video;

    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        attach();
        near.disconnect();
      },
      { rootMargin: '25% 0px' },
    );
    near.observe(figure);
    stops.push(() => near.disconnect());

    if (reduce) {
      scrub.setProgress(0.2);
      gsap.set(video, { scale: 1, clipPath: 'inset(0% 0% 0% 0%)' });
      return;
    }

    const from: gsap.TweenVars = { scale: spec.scale };
    const to: gsap.TweenVars = { scale: spec.endScale, ease: 'none' };
    if (spec.xPercent) {
      from.xPercent = spec.xPercent;
      to.xPercent = 0;
    }
    if (spec.yPercent) {
      from.yPercent = spec.yPercent;
      to.yPercent = 0;
    }
    if (spec.rotate) {
      from.rotate = spec.rotate;
      to.rotate = 0;
    }
    if (spec.clip) {
      from.clipPath = spec.clip;
      to.clipPath = 'inset(0% 0% 0% 0%)';
    }
    gsap.fromTo(video, from, {
      ...to,
      scrollTrigger: {
        trigger: figure,
        start: 'top 96%',
        end: 'top 42%',
        scrub: spec.scrub,
      },
    });

    const trigger = ScrollTrigger.create({
      trigger: figure,
      start: 'top 90%',
      end: mode === 'steam' ? 'bottom 8%' : 'bottom 22%',
      scrub: spec.scrub,
      onUpdate: (self) => scrub.setProgress(spec.map(self.progress)),
    });
    stops.push(() => trigger.kill());
  });

  return () => stops.forEach((stop) => stop());
}
