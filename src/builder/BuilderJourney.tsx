import { useCallback, useEffect, useRef, useState } from 'react';
import { bindRevealHeadings } from '../scripts/reveal-heading';
import { ambientWanted, setAmbient } from '../scripts/ambient';
import StoryCanvas from './StoryCanvas';

function SlideText({ text }: { text: string }) {
  return (
    <span className="slide-face">
      <span className="slide-line">{text}</span>
      <span className="slide-line" aria-hidden="true">{text}</span>
    </span>
  );
}

type Beat = {
  id: string;
  n: string;
  label: string;
  heading: string;
  body: string;
  side: 'left' | 'right';
  href?: string;
  cta?: string;
};

const SOURCE = 'https://github.com/kr8tiv-ai/aura-homes';

const USES = ['A room', 'Glass on piles', 'A farm wall', 'Water from the air'] as const;
const GLASS = ['Clear', 'Mirror', 'Tinted'] as const;
const LENGTHS = ['20 ft', '28 ft', '36 ft'] as const;
type UseChoice = (typeof USES)[number];
type GlassChoice = (typeof GLASS)[number];
type LengthChoice = (typeof LENGTHS)[number];

const useSlug: Record<UseChoice, string> = {
  'A room': 'room',
  'Glass on piles': 'glass',
  'A farm wall': 'farm',
  'Water from the air': 'water',
};
const glassSlug: Record<GlassChoice, string> = {
  Clear: 'clear',
  Mirror: 'mirror',
  Tinted: 'tinted',
};
const lengthSlug: Record<LengthChoice, string> = {
  '20 ft': '20-ft',
  '28 ft': '28-ft',
  '36 ft': '36-ft',
};

const BEATS: Beat[] = [
  {
    id: 'walk',
    n: '01',
    label: 'Walk',
    heading: 'Scroll the clearing.',
    body: 'The camera moves from the ridge, to the cabin, onto the deck, and out to the tub.',
    side: 'right',
  },
  {
    id: 'look',
    n: '02',
    label: 'Look',
    heading: 'This is the room.',
    body: 'A room in the clearing. Night changes the light. Sound is the forest, if you want it.',
    side: 'left',
  },
  {
    id: 'glass',
    n: '03',
    label: 'Glass',
    heading: 'Set the glass.',
    body: 'Clear, mirror, or tinted. The choice is at the end of the scroll, and it stays in this browser.',
    side: 'right',
  },
  {
    id: 'length',
    n: '04',
    label: 'Length',
    heading: 'Set the length.',
    body: 'Twenty, twenty-eight, or thirty-six feet. Pick what the room is for the same way.',
    side: 'left',
  },
  {
    id: 'source',
    n: '05',
    label: 'Source',
    heading: 'Build it yourself.',
    body: 'Use the tool on this page, or take the source and run it from GitHub.',
    side: 'right',
    href: SOURCE,
    cta: 'Open the source',
  },
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export default function BuilderJourney() {
  const progressRef = useRef(0);
  const sectionsRef = useRef<Array<HTMLElement | null>>([]);
  const plateRefs = useRef<Array<HTMLElement | null>>([]);
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [night, setNight] = useState(false);
  const [sound, setSound] = useState(false);
  const [active, setActive] = useState(0);
  const [use, setUse] = useState<UseChoice>('A room');
  const [glass, setGlass] = useState<GlassChoice>('Clear');
  const [length, setLength] = useState<LengthChoice>('28 ft');
  const [shotKey, setShotKey] = useState<string | null>(null);
  const quoteHref = `/pre-order?finish=${glassSlug[glass]}&length=${lengthSlug[length]}&design=${useSlug[use]}`;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const set = () => setReduced(mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);

  const enter = useCallback((withSound: boolean) => {
    setLeaving(true);
    window.setTimeout(() => {
      setEntered(true);
      if (withSound) void setAmbient(true);
    }, 460);
  }, []);

  useEffect(() => {
    if (entered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enter(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entered, enter]);

  useEffect(() => {
    let anchors: number[] = [];
    let raf = 0;
    const scrollY = () => {
      const lenis = (window as Window & { __lenis?: { scroll?: number } }).__lenis;
      return lenis?.scroll ?? window.scrollY;
    };
    const measure = () => {
      const vh = window.innerHeight;
      const max = Math.max(1, document.documentElement.scrollHeight - vh);
      const secs = sectionsRef.current.filter(Boolean) as HTMLElement[];
      anchors = secs.map((el, i) => {
        if (i === 0) return 0;
        if (i === secs.length - 1) return max;
        return Math.min(max, Math.max(0, el.offsetTop + el.offsetHeight * 0.5 - vh * 0.5));
      });
      for (let i = 1; i < anchors.length; i++) anchors[i] = Math.max(anchors[i], anchors[i - 1] + 1);
    };
    const progressFor = (y: number) => {
      if (!anchors.length || y <= anchors[0]) return 0;
      for (let i = 0; i < anchors.length - 1; i++) {
        if (y <= anchors[i + 1]) return i + (y - anchors[i]) / (anchors[i + 1] - anchors[i]);
      }
      return anchors.length - 1;
    };
    const paint = (p: number) => {
      for (let i = 0; i < BEATS.length; i++) {
        const el = plateRefs.current[i];
        if (!el) continue;
        const o = 1 - smoothstep(0.3, 0.5, Math.abs(p - (i + 1)));
        el.style.opacity = o.toFixed(3);
        el.style.visibility = o < 0.02 ? 'hidden' : 'visible';
        el.style.pointerEvents = o > 0.35 ? 'auto' : 'none';
      }
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const p = progressFor(scrollY());
        progressRef.current = p;
        paint(p);
        const a = Math.round(p);
        setActive((prev) => (prev === a ? prev : a));
      });
    };
    measure();
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => {
      measure();
      onScroll();
    });
    const lenis = (window as Window & { __lenis?: { on?: (e: string, fn: () => void) => void } }).__lenis;
    lenis?.on?.('scroll', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    bindRevealHeadings(document.getElementById('byo-root') ?? document);
  }, [entered]);

  useEffect(() => {
    const sync = () => setSound(ambientWanted());
    sync();
    document.addEventListener('aura-ambient', sync);
    return () => document.removeEventListener('aura-ambient', sync);
  }, []);

  const toggleSound = () => {
    void setAmbient(!ambientWanted());
  };

  return (
    <div className="b-root">
      <StoryCanvas progressRef={progressRef} reduced={reduced} night={night} shotKey={shotKey} />

      <div className="b-hud">
        <button type="button" className="is-slide" onClick={() => setNight((n) => !n)}>
          <SlideText text={night ? 'Day' : 'Night'} />
        </button>
        <button type="button" className="is-slide" onClick={toggleSound}>
          <SlideText text={sound ? 'Sound off' : 'Sound'} />
        </button>
      </div>

      <div className="b-stage" aria-live="polite">
        {BEATS.map((b, i) => (
          <article
            key={b.id}
            ref={(el) => {
              plateRefs.current[i] = el;
            }}
            className={`b-plate b-plate-${b.side}`}
          >
            <p className="b-kicker">{b.n}  {b.label}</p>
            <h2 data-reveal-heading data-reveal-when="visible">{b.heading}</h2>
            <p>{b.body}</p>
            {b.href && b.cta ? (
              <a className="is-slide" href={b.href} target="_blank" rel="noreferrer"><SlideText text={b.cta} /></a>
            ) : null}
          </article>
        ))}
      </div>

      <div className="b-flow">
        <section
          className="b-span"
          ref={(el) => {
            sectionsRef.current[0] = el;
          }}
        >
          <div className="b-hero">
            <p className="b-kicker">The clearing</p>
            <h1 data-reveal-heading data-reveal-display="yes">Build Your Own.</h1>
            <p>Walk the clearing, then set the room.</p>
          </div>
        </section>
        {BEATS.map((b, i) => (
          <section
            key={b.id}
            className="b-span"
            aria-hidden={active !== i + 1}
            ref={(el) => {
              sectionsRef.current[i + 1] = el;
            }}
          />
        ))}
        <section
          className="b-end"
          id="shape"
          ref={(el) => {
            sectionsRef.current[BEATS.length + 1] = el;
          }}
        >
          <p className="b-kicker">06  The room</p>
          <h2 data-reveal-heading>Set it here.</h2>
          <p className="b-end-lead">
            Pick the use, the glass, and the length. Nothing on this page is for sale, and nothing is saved.
          </p>
          <form className="b-form" onSubmit={(e) => e.preventDefault()}>
            <label>
              Use
              <select
                value={use}
                onChange={(e) => {
                  const v = e.target.value as UseChoice;
                  setUse(v);
                  setShotKey(`use:${v}`);
                }}
              >
                {USES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              Glass
              <select
                value={glass}
                onChange={(e) => {
                  const v = e.target.value as GlassChoice;
                  setGlass(v);
                  setShotKey(`glass:${v}`);
                }}
              >
                {GLASS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              Length of the room
              <select
                value={length}
                onChange={(e) => {
                  const v = e.target.value as LengthChoice;
                  setLength(v);
                  setShotKey(`length:${v}`);
                }}
              >
                {LENGTHS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </form>
          <p className="b-brief">
            {length}. {glass} glass. {use}.
          </p>
          <a className="b-quote is-slide" href={quoteHref}><SlideText text="Send this design with a quote request" /></a>
          <p className="b-links">
            <a href={SOURCE} target="_blank" rel="noreferrer">Build it on GitHub</a>
          </p>
        </section>
      </div>

      {!entered && (
        <div className={`b-gate${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label="Enter the clearing">
          {!reduced && (
            <video
              className="b-gate-video"
              src="/film/builder-enter.mp4"
              autoPlay
              muted
              loop
              playsInline
              aria-hidden
            />
          )}
          <div className="b-gate-copy">
            <p className="b-kicker">The clearing</p>
            <h1 data-reveal-heading data-reveal-display="yes">Build Your Own.</h1>
            <p>Walk the clearing, then set the room.</p>
            <button type="button" className="is-slide" onClick={() => enter(true)}><SlideText text="Enter the clearing" /></button>
            <button type="button" className="b-quiet is-slide" onClick={() => enter(false)}><SlideText text="Enter quietly" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
