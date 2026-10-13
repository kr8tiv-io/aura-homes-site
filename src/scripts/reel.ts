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

  const compactQuery = '(max-width: 1000px)';
  const compactNow = () => window.matchMedia(compactQuery).matches;
  const connOf = () => (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const slowLink = () => {
    const conn = connOf();
    if (!conn) return false;
    if (conn.saveData) return true;
    return conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || conn.effectiveType === '3g';
  };

  const allowFilm = (video: HTMLVideoElement) => {
    if (video.dataset.still !== 'poster') {
      if (compactNow() && (reduce || slowLink())) return false;
      return true;
    }
    if (reduce) return false;
    if (!window.matchMedia('(min-width: 801px) and (any-pointer: fine)').matches) return false;
    if (slowLink()) return false;
    return true;
  };

  // One phone film at a time, so thirteen scroll clips do not open together.
  let filmGate: Promise<void> = Promise.resolve();
  const slots: Array<{
    figure: Element;
    on: boolean;
    attach: () => void;
    release: () => void;
  }> = [];
  let electFrame = 0;
  const elect = () => {
    if (!compactNow()) return;
    const mid = window.innerHeight / 2;
    let best: (typeof slots)[number] | null = null;
    let bestDist = Infinity;
    for (const slot of slots) {
      if (!slot.on) continue;
      const box = slot.figure.getBoundingClientRect();
      const dist = Math.abs(box.top + box.height / 2 - mid);
      if (dist < bestDist) {
        best = slot;
        bestDist = dist;
      }
    }
    for (const slot of slots) {
      if (slot === best) slot.attach();
      else slot.release();
    }
  };
  const scheduleElect = () => {
    if (!compactNow() || electFrame) return;
    electFrame = window.requestAnimationFrame(() => {
      electFrame = 0;
      elect();
    });
  };
  window.addEventListener('scroll', scheduleElect, { passive: true });
  stops.push(() => {
    window.removeEventListener('scroll', scheduleElect);
    if (electFrame) window.cancelAnimationFrame(electFrame);
  });

  videos.forEach((video) => {
    const film = video.dataset.film;
    let attached = Boolean(video.getAttribute('src') || video.querySelector('source'));
    let generation = 0;
    const attach = () => {
      if (attached || !film) return;
      attached = true;
      const mine = ++generation;
      const job = () =>
        ready.then((names) => {
          if (mine !== generation) return;
          const file = film.split('/').pop() || '';
          const known = names.has(file) || film.startsWith('/media/video/');
          if (!known || !allowFilm(video)) {
            attached = false;
            return;
          }
          if (video.getAttribute('src') || video.querySelector('source')) return;
          const webm = video.dataset.filmWebm;
          const compact = compactNow();
          if (webm && !compact) {
            video.preload = 'metadata';
            const add = (src: string, type: string) => {
              const source = document.createElement('source');
              source.src = src;
              source.type = type;
              video.appendChild(source);
            };
            add(webm, 'video/webm');
            add(film, 'video/mp4');
            video.load();
            return;
          }
          if (mine !== generation) return;
          video.preload = compact ? 'metadata' : 'auto';
          let meta: Promise<void> | undefined;
          if (compact) {
            meta = new Promise((resolve) => {
              const done = () => resolve();
              video.addEventListener('loadedmetadata', done, { once: true });
              video.addEventListener('error', done, { once: true });
              window.setTimeout(done, 4000);
            });
          }
          video.src = film;
          video.load();
          if (mine !== generation) {
            video.removeAttribute('src');
            const poster = video.dataset.poster;
            if (poster) video.poster = poster;
            video.load();
            return;
          }
          return meta;
        });
      if (compactNow()) filmGate = filmGate.then(job, job);
      else void job();
    };

    const release = () => {
      if (!compactNow()) return;
      if (!video.getAttribute('src') && !video.querySelector('source')) return;
      generation += 1;
      video.pause();
      video.removeAttribute('src');
      video.querySelectorAll('source').forEach((node) => node.remove());
      const poster = video.dataset.poster;
      if (poster) video.poster = poster;
      video.load();
      attached = false;
    };

    video.muted = true;
    video.playsInline = true;
    video.pause();

    const mode = (MODES[video.dataset.play as Mode] ? video.dataset.play : 'drift') as Mode;
    const spec = MODES[mode];
    const scrub = bindFilmScrub(video);
    const figure = video.closest('.story-figure') || video;
    const phone = window.matchMedia('(max-width: 800px)').matches;

    const usePoster = () => {
      const src = video.dataset.poster;
      if (src && video.getAttribute('poster') !== src) video.poster = src;
    };

    const compact = compactNow();
    const slot = { figure, on: false, attach, release };
    slots.push(slot);
    const near = new IntersectionObserver(
      (entries) => {
        slot.on = entries.some((entry) => entry.isIntersecting);
        if (slot.on) usePoster();
        if (!compact) {
          if (slot.on) {
            attach();
            near.disconnect();
          }
          return;
        }
        elect();
      },
      { rootMargin: compact ? '70% 0px' : '40% 0px' },
    );
    near.observe(figure);
    stops.push(() => near.disconnect());

    if (reduce) {
      usePoster();
      scrub.setProgress(0.2);
      gsap.set(video, { scale: 1, clipPath: 'inset(0% 0% 0% 0%)' });
      return;
    }

    if (phone) {
      gsap.set(video, { scale: 1, xPercent: 0, yPercent: 0, rotate: 0, clipPath: 'inset(0% 0% 0% 0%)' });
    } else {
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
    }

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
