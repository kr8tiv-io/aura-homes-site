import { gsap, ScrollTrigger } from './motion';

declare global {
  interface Window {
    __lenis?: { on?: (event: string, cb: (self: { velocity: number }) => void) => void };
  }
}

const KINDS = ['drift', 'tilt', 'wipe', 'lift'] as const;

/** Mouse-led shots, scroll-velocity skew, and a slow float on the tub. */
export function bindShots(root: ParentNode = document) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const figures = gsap.utils.toArray<HTMLElement>('.story-figure', root);
  const stops: Array<() => void> = [];

  figures.forEach((figure, index) => {
    const media = figure.querySelector('img, video');
    if (!(media instanceof HTMLElement) || media.parentElement?.classList.contains('shot-move')) return;
    const wrap = document.createElement('div');
    wrap.className = 'shot-move';
    media.parentElement?.insertBefore(wrap, media);
    wrap.appendChild(media);
    const kind = media.dataset.shot || figure.dataset.shot || KINDS[index % KINDS.length];
    figure.dataset.shot = kind;

    if (reduce) return;

    const xTo = gsap.quickTo(wrap, 'x', { duration: kind === 'skid' ? 0.9 : 0.65, ease: 'power3' });
    const yTo = gsap.quickTo(wrap, 'y', { duration: 0.7, ease: 'power3' });
    const rotTo = gsap.quickTo(wrap, 'rotation', { duration: 0.85, ease: 'power3' });
    const ryTo = gsap.quickTo(wrap, 'rotationY', { duration: 0.8, ease: 'power3' });
    const rxTo = gsap.quickTo(wrap, 'rotationX', { duration: 0.8, ease: 'power3' });

    const onMove = (event: MouseEvent) => {
      const box = figure.getBoundingClientRect();
      const px = (event.clientX - box.left) / box.width - 0.5;
      const py = (event.clientY - box.top) / box.height - 0.5;
      if (kind === 'tilt') {
        ryTo(px * 9);
        rxTo(py * -6);
        xTo(px * 12);
        yTo(py * 8);
      } else if (kind === 'wipe') {
        xTo(px * -18);
        yTo(py * -8);
        gsap.to(media, {
          objectPosition: `${50 + px * 16}% ${50 + py * 10}%`,
          duration: 0.8,
          ease: 'power3.out',
          overwrite: 'auto',
        });
      } else if (kind === 'lift') {
        yTo(py * -18);
        xTo(px * 10);
      } else if (kind === 'skid') {
        xTo(px * 24);
        yTo(py * 14);
        rotTo(px * -2.2);
      } else {
        xTo(px * -22);
        yTo(py * -12);
        rotTo(px * 1.4);
      }
    };
    const onLeave = () => {
      xTo(0);
      yTo(0);
      rotTo(0);
      ryTo(0);
      rxTo(0);
      if (kind === 'wipe') {
        gsap.to(media, { objectPosition: '50% 42%', duration: 0.9, ease: 'power3.out', overwrite: 'auto' });
      }
    };
    figure.addEventListener('mousemove', onMove);
    figure.addEventListener('mouseleave', onLeave);
    stops.push(() => {
      figure.removeEventListener('mousemove', onMove);
      figure.removeEventListener('mouseleave', onLeave);
    });

    if (kind === 'skid' && !window.matchMedia('(max-width: 800px)').matches) {
      const float = gsap.to(media, {
        yPercent: -2.5,
        duration: 5.5,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
      stops.push(() => float.kill());
    }
  });

  if (!reduce) {
    const medias = figures
      .map((figure) => figure.querySelector('.shot-move'))
      .filter((node): node is HTMLElement => node instanceof HTMLElement);
    const hot = new Set<HTMLElement>();
    const seen = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const node = entry.target as HTMLElement;
          if (entry.isIntersecting) hot.add(node);
          else if (hot.delete(node)) gsap.set(node, { skewY: 0 });
        });
      },
      { rootMargin: '8% 0px' },
    );
    medias.forEach((node) => seen.observe(node));
    stops.push(() => seen.disconnect());
    const skew = { v: 0 };
    const skewTo = gsap.quickTo(skew, 'v', {
      duration: 0.4,
      ease: 'power3.out',
      onUpdate: () => {
        const y = (window.__lenis as { scroll?: number } | undefined)?.scroll ?? window.scrollY;
        const amount = y < window.innerHeight * 0.9 ? 0 : skew.v;
        hot.forEach((node) => gsap.set(node, { skewY: amount }));
      },
    });
    const lenis = window.__lenis as
      | { on?: (event: string, cb: (self: { velocity: number; scroll?: number }) => void) => (() => void) | void }
      | undefined;
    const onScroll = ({ velocity, scroll }: { velocity: number; scroll?: number }) => {
      const y = scroll ?? window.scrollY;
      if (y < window.innerHeight * 0.9) {
        skewTo(0);
        return;
      }
      skewTo(Math.max(-2.2, Math.min(2.2, velocity * 0.04)));
    };
    const offScroll = lenis?.on?.('scroll', onScroll);
    if (typeof offScroll === 'function') stops.push(offScroll);

    gsap.utils.toArray<HTMLElement>('[data-reveal]', root).forEach((img) => {
      const from = img.dataset.reveal || 'inset(20% 8% 18% 8%)';
      gsap.fromTo(
        img,
        { clipPath: from, scale: 1.14 },
        {
          clipPath: 'inset(0% 0% 0% 0%)',
          scale: 1.08,
          ease: 'none',
          scrollTrigger: { id: 'shot-reveal', trigger: img, start: 'top 94%', end: 'top 36%', scrub: 0.9 },
        },
      );
    });
  } else {
    gsap.set('[data-reveal]', { clipPath: 'inset(0% 0% 0% 0%)', scale: 1 });
  }

  return () => {
    stops.forEach((stop) => stop());
    ScrollTrigger.getAll()
      .filter((trigger) => trigger.vars.id === 'shot-reveal')
      .forEach((trigger) => trigger.kill());
  };
}
