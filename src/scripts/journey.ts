import { gsap, ScrollTrigger, prefersReducedMotion, holdPageMotion } from './motion';
import { onQuality, qualityProfile, showStill } from '../three/quality';
import { bindShots } from './shots';
import { bindReels } from './reel';

type SceneHandle = { setProgress: (t: number) => void; destroy: () => void };

/** Word rises, pinned passages, mouse shots, and the scroll-tinted field. */
export function bindJourneyMotion() {
  const field = document.querySelector<HTMLCanvasElement>('[data-field]');
  if (!field || field.dataset.journeyBound === 'yes') return;
  field.dataset.journeyBound = 'yes';
  void startJourney();
}

async function startJourney() {
  const reduce = prefersReducedMotion();
  const mm = gsap.matchMedia();
  const meadows: SceneHandle[] = [];
  const washes: SceneHandle[] = [];
  let fieldFx: SceneHandle | null = null;
  let scenesTask: Promise<void> | null = null;
  const passageAt: number[] = [];
  const washAt: number[] = [];
  let fieldAt = 0;

  const ensureScenes = () => {
    if (prefersReducedMotion()) {
      document.querySelectorAll<HTMLCanvasElement>('[data-meadow]').forEach((canvas) => showStill(canvas));
      return Promise.resolve();
    }
    if (qualityProfile().tier === 'off') return Promise.resolve();
    if (scenesTask) return scenesTask;
    scenesTask = (async () => {
      const { whenPageSettled } = await import('../three/scene-scheduler');
      await whenPageSettled();
      if (prefersReducedMotion() || qualityProfile().tier === 'off') return;
      const [meadowMod, washMod, fieldMod] = await Promise.all([
        import('./meadow'),
        import('./wash'),
        import('./field'),
      ]);
      if (meadows.length) return;
      meadows.push(...gsap.utils.toArray<HTMLCanvasElement>('[data-meadow]').map((canvas) => meadowMod.mountMeadow(canvas)));
      washes.push(...gsap.utils.toArray<HTMLCanvasElement>('[data-wash]').map((canvas) => washMod.mountWash(canvas)));
      const fieldCanvas = document.querySelector<HTMLCanvasElement>('[data-field]');
      fieldFx = fieldCanvas ? fieldMod.mountField(fieldCanvas) : null;
      meadows.forEach((meadow, index) => {
        if (passageAt[index] != null) meadow.setProgress(passageAt[index]);
      });
      washes.forEach((wash, index) => {
        if (washAt[index] != null) wash.setProgress(washAt[index]);
      });
      fieldFx?.setProgress(fieldAt);
    })();
    return scenesTask;
  };

  void ensureScenes();
  const stopQuality = onQuality(() => {
    void ensureScenes();
  });

  const ctx = gsap.context(() => {
    const stopShots = bindShots();
    const stopReels = bindReels();
    if (reduce) {
      gsap.set('.line', { yPercent: 0 });
      meadows.forEach((meadow) => meadow.setProgress(0.45));
      washes.forEach((wash) => wash.setProgress(0.25));
      fieldFx?.setProgress(0.35);
      return () => {
        stopShots();
        stopReels();
      };
    }

    const splitWords = (line: HTMLElement) => {
      const text = (line.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || line.querySelector('.word')) return;
      line.textContent = '';
      text.split(' ').forEach((word) => {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = word;
        line.appendChild(span);
      });
    };

    gsap.utils.toArray<HTMLElement>('.line').forEach((el) => {
      splitWords(el);
      if (el.closest('[data-passage]')) {
        gsap.set(el.querySelectorAll('.word'), { y: 0, yPercent: 130, opacity: 0 });
        return;
      }
      gsap.from(el.querySelectorAll('.word'), {
        yPercent: 140,
        rotate: (index: number) => (index % 2 === 0 ? -4 : 4),
        duration: 1.25,
        stagger: 0.06,
        ease: 'power4.out',
        scrollTrigger: { trigger: el, start: 'top 88%' },
      });
    });

    gsap.utils.toArray<HTMLElement>('.story-kicker, .story-lede, .story-still > div > p:not(.story-kicker)').forEach((el) => {
      if (el.closest('[data-passage]')) return;
      gsap.from(el, {
        y: 32,
        opacity: 0,
        duration: 1.15,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 90%' },
      });
    });

    gsap.from('.ways li', {
      y: 72,
      x: -28,
      opacity: 0,
      stagger: 0.13,
      duration: 1.2,
      ease: 'power4.out',
      scrollTrigger: { trigger: '.ways ol', start: 'top 80%' },
    });

    gsap.from('.journeys a', {
      y: 48,
      opacity: 0,
      stagger: 0.1,
      duration: 1.05,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.journeys ol', start: 'top 84%' },
    });

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const mobile = window.matchMedia('(max-width: 800px)').matches;
      gsap.utils.toArray<HTMLElement>('[data-passage]').forEach((section, index) => {
        const ghost = section.querySelector('.passage-ghost');
        const copy = section.querySelector('.passage-copy');
        const spacer = section.nextElementSibling instanceof HTMLElement && section.nextElementSibling.hasAttribute('data-passage-spacer')
          ? section.nextElementSibling
          : null;
        ScrollTrigger.create({
          trigger: section,
          start: 'top top',
          end: () => `+=${spacer?.offsetHeight || Math.round(window.innerHeight * (mobile ? 1.2 : 1.6))}`,
          pin: true,
          pinSpacing: false,
          scrub: 1,
          anticipatePin: 1,
          onUpdate: (self) => {
            const p = self.progress;
            passageAt[index] = p;
            meadows[index]?.setProgress(p);
            if (ghost) {
              gsap.set(ghost, {
                y: -190 * p,
                x: 110 * p,
                rotate: -8 + p * 12,
                scale: 0.82 + p * 0.34,
                opacity: 0.05 + p * 0.42,
              });
            }
            if (!copy) return;
            copy.querySelectorAll<HTMLElement>('.word').forEach((word, i) => {
              const local = Math.min(1, Math.max(0, (p - i * 0.05) / 0.24));
              const eased = 1 - (1 - local) ** 3;
              gsap.set(word, { y: 0, yPercent: (1 - eased) * 130, opacity: eased });
            });
            const kicker = copy.querySelector('.story-kicker');
            const body = copy.querySelector('p:last-child');
            if (kicker) gsap.set(kicker, { y: (1 - Math.min(1, p / 0.3)) * 22, opacity: Math.min(1, 0.2 + p * 1.6) });
            if (body) gsap.set(body, { y: (1 - Math.min(1, p / 0.62)) * 36, opacity: Math.min(1, Math.max(0, (p - 0.12) / 0.45)) });
          },
        });
      });

      gsap.utils.toArray<HTMLCanvasElement>('[data-wash]').forEach((canvas, index) => {
        ScrollTrigger.create({
          trigger: canvas.parentElement,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.6,
          onUpdate: (self) => {
            washAt[index] = self.progress;
            washes[index]?.setProgress(self.progress);
          },
        });
      });

      ScrollTrigger.create({
        trigger: 'main',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.4,
        onUpdate: (self) => {
          fieldAt = self.progress;
          fieldFx?.setProgress(self.progress);
        },
      });
    });

    return () => {
      stopShots();
      stopReels();
    };
  });

  requestAnimationFrame(() => ScrollTrigger.refresh());

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    stopQuality();
    ctx.revert();
    mm.revert();
    meadows.forEach((meadow) => meadow.destroy());
    washes.forEach((wash) => wash.destroy());
    fieldFx?.destroy();
  };
  holdPageMotion(release);

  if (import.meta.hot) import.meta.hot.dispose(release);
}
