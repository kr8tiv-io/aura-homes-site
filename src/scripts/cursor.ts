import { gsap } from 'gsap';

const WORDS = ['View', 'Quote', 'Drag'] as const;
type CursorWord = (typeof WORDS)[number];

const MAGNET =
  '.nav-cta, .customs-quote, .byo-quote, .b-quote, .room-card a, .quote-form button, .join-card button, .contact-form button';
const QUOTE =
  '.nav-cta, .customs-quote, .byo-quote, .b-quote, .quote-form button, a[href*="/pre-order"]';
const FIELD = 'input, textarea, select';
const PULL = 8;

const fineQuery = () => window.matchMedia('(hover: hover) and (pointer: fine)');
const reduceQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');

type Pull = { x: (value: number) => void; y: (value: number) => void };

/**
 * Desktop cursor. A soft circle follows the pointer, then grows and names
 * the action. Primary buttons lean toward the pointer, at most 8px.
 * Touch and reduced motion keep the system cursor.
 */
export function bindSiteCursor() {
  const cursor = document.querySelector<HTMLElement>('.site-cursor');
  const word = cursor?.querySelector<HTMLElement>('.site-cursor-word');
  if (!cursor || !word) return;
  if (cursor.dataset.cursorReady === 'yes') return;
  cursor.dataset.cursorReady = 'yes';

  const pulls = new WeakMap<HTMLElement, Pull>();
  let magnet: HTMLElement | null = null;
  let label = '';
  let shown = false;
  let visible = false;

  const xTo = gsap.quickTo(cursor, 'x', { duration: 0.65, ease: 'power3.out' });
  const yTo = gsap.quickTo(cursor, 'y', { duration: 0.65, ease: 'power3.out' });

  gsap.set(cursor, { x: 0, y: 0, scale: 0.24, opacity: 0, transformOrigin: '50% 50%' });
  gsap.set(word, { opacity: 0 });

  const pullFor = (el: HTMLElement) => {
    let pair = pulls.get(el);
    if (!pair) {
      pair = {
        x: gsap.quickTo(el, 'x', { duration: 0.95, ease: 'power3.out' }),
        y: gsap.quickTo(el, 'y', { duration: 0.95, ease: 'power3.out' }),
      };
      pulls.set(el, pair);
    }
    return pair;
  };

  const releaseMagnet = () => {
    if (!magnet) return;
    const pair = pulls.get(magnet);
    pair?.x(0);
    pair?.y(0);
    magnet = null;
  };

  const moveMagnet = (el: HTMLElement, clientX: number, clientY: number) => {
    if (el !== magnet) {
      releaseMagnet();
      magnet = el;
    }
    const dx0 = Number(gsap.getProperty(el, 'x')) || 0;
    const dy0 = Number(gsap.getProperty(el, 'y')) || 0;
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2 - dx0;
    const cy = box.top + box.height / 2 - dy0;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > PULL) {
      dx = (dx / len) * PULL;
      dy = (dy / len) * PULL;
    }
    const pair = pullFor(el);
    pair.x(dx);
    pair.y(dy);
  };

  const paint = (next: CursorWord | null, interactive: boolean) => {
    const key = `${next ?? ''}:${interactive ? 'on' : 'off'}`;
    if (key === label) return;
    label = key;
    word.textContent = next ?? '';
    gsap.to(word, { opacity: next ? 1 : 0, duration: 0.85, ease: 'power3.out', overwrite: 'auto' });
    gsap.to(cursor, {
      scale: next ? 1 : interactive ? 0.46 : 0.24,
      duration: 1.15,
      ease: 'power3.out',
      overwrite: 'auto',
      transformOrigin: '50% 50%',
    });
  };

  const wordFor = (target: Element): { word: CursorWord | null; interactive: boolean; magnet: HTMLElement | null } => {
    if (target.closest(FIELD)) return { word: null, interactive: false, magnet: null };
    const control = target.closest<HTMLElement>('a, button');
    const drag = target.closest<HTMLElement>('[data-cursor="drag"]');
    if (control && (control.matches(QUOTE) || control.getAttribute('data-cursor') === 'quote')) {
      const pull = control.matches(MAGNET) && !control.matches(':disabled') ? control : null;
      return { word: 'Quote', interactive: true, magnet: pull };
    }
    if (drag && !control) return { word: 'Drag', interactive: true, magnet: null };
    const marked = control?.getAttribute('data-cursor');
    if (marked === 'view' || marked === 'drag' || marked === 'quote') {
      const wordName = (marked.charAt(0).toUpperCase() + marked.slice(1)) as CursorWord;
      const pull = wordName === 'Quote' && control && control.matches(MAGNET) ? control : null;
      return { word: wordName, interactive: true, magnet: pull };
    }
    if (control?.matches('a')) return { word: 'View', interactive: true, magnet: control.matches(MAGNET) ? control : null };
    if (control) {
      const pull = control.matches(MAGNET) && !control.matches(':disabled') ? control : null;
      return { word: null, interactive: true, magnet: pull };
    }
    return { word: null, interactive: false, magnet: null };
  };

  const showCursor = () => {
    if (visible) return;
    visible = true;
    gsap.to(cursor, { opacity: 1, duration: 0.55, ease: 'power3.out', overwrite: 'auto' });
  };

  const hideCursor = () => {
    visible = false;
    gsap.to(cursor, { opacity: 0, duration: 0.55, ease: 'power3.out', overwrite: 'auto' });
  };

  const onMove = (event: PointerEvent) => {
    const node = event.target;
    if (!(node instanceof Element)) return;
    if (!shown) {
      shown = true;
      visible = true;
      document.documentElement.classList.add('has-cursor');
      gsap.set(cursor, { x: event.clientX, y: event.clientY, opacity: 1 });
    } else {
      xTo(event.clientX);
      yTo(event.clientY);
    }
    if (!document.documentElement.classList.contains('has-cursor')) {
      document.documentElement.classList.add('has-cursor');
    }
    if (node.closest(FIELD)) {
      paint(null, false);
      releaseMagnet();
      hideCursor();
      return;
    }
    showCursor();
    const next = wordFor(node);
    paint(next.word, next.interactive);
    if (next.magnet) moveMagnet(next.magnet, event.clientX, event.clientY);
    else releaseMagnet();
  };

  const onLeave = () => {
    paint(null, false);
    releaseMagnet();
    hideCursor();
  };

  let listening = false;
  const listen = () => {
    if (listening) return;
    listening = true;
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
  };
  const arm = () => {
    if (!fineQuery().matches || reduceQuery().matches) {
      document.documentElement.classList.remove('has-cursor');
      onLeave();
      return;
    }
    listen();
  };

  fineQuery().addEventListener('change', arm);
  reduceQuery().addEventListener('change', arm);
  document.addEventListener('astro:page-load', () => {
    if (shown && fineQuery().matches && !reduceQuery().matches) {
      document.documentElement.classList.add('has-cursor');
    }
  });
  arm();
}
