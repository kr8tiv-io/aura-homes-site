import { gsap, ScrollTrigger } from './motion';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

/**
 * "Not a house. Not a shed. Something better."
 * A scroll-scrubbed assembly on the sticky intro stage:
 *   1. The two "Not a" lines gather from scattered, blurred letters.
 *   2. A Bronze rule strikes through each and they fold inward and recede.
 *   3. "Something better." rises out of depth, converging from wide tracking,
 *      then a Halo light sweeps across it.
 * Transform, opacity and (desktop only) filter. Text stays live HTML, the
 * heading keeps its aria-label, and reduced motion never calls this.
 */
export function bindHeadlineAssemble(section: HTMLElement): () => void {
  const head = section.querySelector<HTMLElement>('[data-assemble-head]');
  if (!head) return () => {};
  const lines = Array.from(head.querySelectorAll<HTMLElement>('[data-assemble-line]'));
  const strikes = Array.from(head.querySelectorAll<HTMLElement>('[data-strike]'));
  const sheen = head.querySelector<HTMLElement>('[data-sheen]');
  const bloom = head.querySelector<HTMLElement>('[data-bloom]');
  const kicker = section.querySelector<HTMLElement>('.story-kicker');
  const lede = section.querySelector<HTMLElement>('.story-lede');
  if (lines.length < 3) return () => {};

  // Screen readers read the heading's aria-label; the split pieces stay silent.
  const splits = lines.map((line) => {
    line.setAttribute('aria-hidden', 'true');
    return new SplitText(line, { type: 'words,chars', aria: 'none', charsClass: 'hl-char', wordsClass: 'hl-word' });
  });
  section.classList.add('is-assembling');

  const narrow = window.matchMedia('(max-width: 800px)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches && !narrow;
  const spread = narrow ? Math.max(0.42, window.innerWidth / 1100) : 1;

  // Stable pseudo-random scatter, so every visit pulls together the same way.
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const signed = (min: number, max: number) => (rnd() < 0.5 ? -1 : 1) * (min + rnd() * (max - min));

  const tl = gsap.timeline({ defaults: { ease: 'none' }, paused: true });

  if (kicker) tl.fromTo(kicker, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 1.6, ease: 'power2.out' }, 0);

  // 1. Gather the two "Not a" lines.
  [splits[0], splits[1]].forEach((split, n) => {
    const chars = split.chars as HTMLElement[];
    chars.forEach((char) => {
      gsap.set(char, {
        x: signed(40, 190) * spread,
        y: signed(50, 210) * spread,
        z: fine ? signed(0, 260) : 0,
        rotation: signed(6, 38),
        rotationX: fine ? signed(10, 70) : 0,
        opacity: 0,
        filter: fine ? 'blur(14px)' : 'none',
      });
    });
    tl.to(
      chars,
      {
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        rotationX: 0,
        opacity: 1,
        filter: fine ? 'blur(0px)' : 'none',
        duration: 3.2,
        ease: 'power3.out',
        stagger: { each: 0.05, from: 'random' },
      },
      n * 0.6,
    );
  });

  // 2. Strike them through, then fold each line inward and let it recede.
  strikes.forEach((strike, n) => {
    tl.fromTo(strike, { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'power3.inOut' }, 4.2 + n * 0.35);
  });
  [splits[0], splits[1]].forEach((split, n) => {
    const chars = split.chars as HTMLElement[];
    const mid = (chars.length - 1) / 2;
    tl.to(
      chars,
      {
        x: (i: number) => (mid - i) * (narrow ? 2.2 : 3.4),
        opacity: 0.26,
        duration: 1.6,
        ease: 'power2.inOut',
      },
      4.8 + n * 0.25,
    );
    tl.to(lines[n].parentElement, { scale: 0.94, y: -8, duration: 1.6, ease: 'power2.inOut' }, 4.8 + n * 0.25);
  });
  tl.to(strikes, { opacity: 0.8, duration: 1.4 }, 5.3);

  // 3. "Something better." rises out of depth and converges from wide tracking.
  const better = splits[2].chars as HTMLElement[];
  const mid = (better.length - 1) / 2;
  gsap.set(better, {
    x: (i: number) => (i - mid) * (narrow ? 14 : 30),
    yPercent: 70,
    z: fine ? -520 : 0,
    rotationX: fine ? -82 : -40,
    opacity: 0,
    filter: fine ? 'blur(16px)' : 'none',
    transformOrigin: '50% 100%',
  });
  tl.to(
    better,
    {
      x: 0,
      yPercent: 0,
      z: 0,
      rotationX: 0,
      opacity: 1,
      filter: fine ? 'blur(0px)' : 'none',
      duration: 2.8,
      ease: 'expo.out',
      stagger: { each: 0.05, from: 'center' },
    },
    5.0,
  );

  // Halo light across the resolved line, with a soft bloom left behind it.
  if (bloom) {
    tl.fromTo(bloom, { opacity: 0, scaleX: 0.5 }, { opacity: 1, scaleX: 1, duration: 1.8, ease: 'power2.out' }, 6.9);
    tl.to(bloom, { opacity: 0.55, duration: 1.2 }, 8.7);
  }
  if (sheen) {
    tl.fromTo(sheen, { opacity: 0, '--sheen-x': '-40%' }, { opacity: 1, duration: 0.35 }, 7.2);
    tl.to(sheen, { '--sheen-x': '140%', duration: 2, ease: 'power1.inOut' }, 7.2);
    tl.to(sheen, { opacity: 0, duration: 0.5 }, 8.7);
  }

  if (lede) tl.fromTo(lede, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1.4, ease: 'power2.out' }, 8.0);
  tl.to({}, { duration: 0.6 }, 9.4);

  // The stage is sticky inside a tall section, so the layout never changes.
  // Phones clip the root overflow, which turns body into the sticky scrollport,
  // so there the stage is pinned in place over the same real-layout height.
  const stage = section.querySelector<HTMLElement>('[data-intro-stage]');
  const pin =
    narrow && stage
      ? ScrollTrigger.create({
          trigger: section,
          start: 'top top',
          end: 'bottom bottom',
          pin: stage,
          pinSpacing: false,
          anticipatePin: 0.4,
          invalidateOnRefresh: true,
        })
      : null;

  const trigger = ScrollTrigger.create({
    trigger: section,
    start: 'top 70%',
    end: 'bottom bottom',
    scrub: narrow ? 0.6 : 0.9,
    animation: tl,
  });

  return () => {
    pin?.kill();
    trigger.kill();
    tl.kill();
    splits.forEach((split) => split.revert());
    lines.forEach((line) => line.removeAttribute('aria-hidden'));
    section.classList.remove('is-assembling');
  };
}
