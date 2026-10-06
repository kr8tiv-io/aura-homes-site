import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import { roomConcepts } from '../lib/rooms';
import { onQuality, qualityProfile, type QualityTier } from '../three/quality';
import { validateBuilderDocument } from './core/document';
import type { FixtureKindId } from './core/fixtures';
import { decodeDocument, encodeDocument } from './core/share';
import { readAutosave, writeAutosave } from './core/store';
import { editorReducer, type EditorState } from './history';
import LiveReadout from './ui/LiveReadout';
import {
  ORDER_ADDONS,
  ORDER_SIZES,
  TUB_MODELS,
  buildOrderDocument,
  roomForSlug,
  selectionFromDocument,
  startingDocument,
  type OrderGlaze,
  type OrderSize,
} from './models';
import '../styles/builder-order.css';

const STEPS = ['model', 'size', 'glass', 'addons', 'review'] as const;
type Step = (typeof STEPS)[number];

const STEP_COPY: Record<Step, { title: string; note: string }> = {
  model: {
    title: 'Model',
    note: 'Twelve rooms. Start with the one that feels like the hour.',
  },
  size: {
    title: 'Size',
    note: 'Snug, room, or long. The plan stays itself.',
  },
  glass: {
    title: 'Glass',
    note: 'Clear, tinted, or mirror. The same polycarbonate, three moods.',
  },
  addons: {
    title: 'Add-ons',
    note: 'What comes with the room.',
  },
  review: {
    title: 'Review',
    note: 'This is the room, as it stands.',
  },
};

const GLAZE: { id: OrderGlaze; label: string; note: string }[] = [
  { id: 'clear', label: 'Clear', note: 'The meadow comes through.' },
  { id: 'tinted', label: 'Tinted', note: 'A softer sky.' },
  { id: 'mirror', label: 'Mirror', note: 'The glass holds the view.' },
];

const LIVE_TIERS = new Set<QualityTier>(['medium', 'high', 'ultra']);

function initialState(): EditorState {
  return {
    doc: startingDocument(),
    past: [],
    future: [],
    label: null,
    loadEpoch: 0,
  };
}

function liveNow(): boolean {
  if (typeof window === 'undefined') return false;
  const tier = qualityProfile().tier;
  const wide = window.matchMedia('(min-width: 1024px)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return LIVE_TIERS.has(tier) && wide && fine && !reduced;
}

export default function OrderForm() {
  const [state, dispatch] = useReducer(editorReducer, undefined, initialState);
  const [step, setStep] = useState<Step>('model');
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ paint: () => void; destroy: () => void } | null>(null);
  const docRef = useRef(state.doc);
  const glazeRef = useRef<OrderGlaze>('clear');
  docRef.current = state.doc;

  const selection = selectionFromDocument(state.doc);
  const room = roomForSlug(selection.slug) ?? roomConcepts[0];
  glazeRef.current = selection.glaze;
  const copy = STEP_COPY[step];
  const sizeLabel = ORDER_SIZES.find((item) => item.id === selection.size)?.label ?? 'Room';
  const glazeLabel = GLAZE.find((item) => item.id === selection.glaze)?.label ?? 'Clear';
  const chosenAddons = ORDER_ADDONS.filter(
    (item) => (item.kind && selection.kinds.includes(item.kind)) || selection.plain.includes(item.id),
  );

  const quoteHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set('model', selection.slug);
    params.set('size', sizeLabel);
    params.set('finish', selection.glaze);
    if (chosenAddons.length) params.set('add-ons', chosenAddons.map((item) => item.name).join(', '));
    if (token) params.set('share', token);
    return `/pre-order?${params.toString()}`;
  }, [selection.slug, selection.glaze, sizeLabel, chosenAddons, token]);

  const apply = (next: {
    slug: string;
    size: OrderSize;
    glaze: OrderGlaze;
    plain: string[];
    kinds: FixtureKindId[];
    label: string;
  }) => {
    const draft = buildOrderDocument(next);
    const check = validateBuilderDocument(draft);
    if (!check.ok) return;
    dispatch({ type: 'commit', doc: check.document, label: next.label });
    setCopied(false);
  };

  useEffect(() => {
    let cancel = false;
    const open = async () => {
      const hash = location.hash.replace(/^#/, '');
      const queryShare = new URLSearchParams(location.search).get('share') ?? '';
      const shared = hash || queryShare;
      if (shared) {
        try {
          const decoded = await decodeDocument(shared);
          if (!cancel && decoded) {
            dispatch({ type: 'load', doc: decoded, label: 'Open a shared design', quiet: true });
            setReady(true);
            return;
          }
        } catch {
          /* A bad link starts from The Soak. */
        }
      }
      try {
        const saved = await readAutosave();
        if (!cancel && saved.present && saved.readable) {
          dispatch({ type: 'load', doc: saved.record.document, label: 'Restore', quiet: true });
        }
      } catch {
        /* The first visit stays on The Soak. */
      }
      if (!cancel) setReady(true);
    };
    void open();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      writeAutosave(state.doc).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(id);
  }, [ready, state.doc]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wide = window.matchMedia('(min-width: 1024px)');
    const fine = window.matchMedia('(pointer: fine)');
    const decide = () => setLive(liveNow());
    decide();
    const stop = onQuality(decide);
    wide.addEventListener('change', decide);
    fine.addEventListener('change', decide);
    reduced.addEventListener('change', decide);
    return () => {
      stop();
      wide.removeEventListener('change', decide);
      fine.removeEventListener('change', decide);
      reduced.removeEventListener('change', decide);
    };
  }, []);

  useEffect(() => {
    if (!live) {
      sceneRef.current?.destroy();
      sceneRef.current = null;
      return;
    }
    const host = stageRef.current;
    if (!host) return;
    let dead = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (dead || sceneRef.current) return;
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void import('./ui/orderScene').then(({ mountOrderScene }) => {
          if (dead || !stageRef.current || sceneRef.current) return;
          sceneRef.current = mountOrderScene(stageRef.current, {
            document: () => docRef.current,
            glaze: () => glazeRef.current,
          });
        });
      },
      { rootMargin: '200px' },
    );
    observer.observe(host);
    return () => {
      dead = true;
      observer.disconnect();
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [live]);

  useEffect(() => {
    sceneRef.current?.paint();
  }, [state.doc, selection.glaze]);

  useEffect(() => {
    if (step !== 'review') return;
    let cancel = false;
    encodeDocument(state.doc)
      .then((value) => {
        if (!cancel) setToken(value);
      })
      .catch(() => {
        if (!cancel) setToken(null);
      });
    return () => {
      cancel = true;
    };
  }, [state.doc, step]);

  const onTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = STEPS.indexOf(step);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % STEPS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + STEPS.length) % STEPS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = STEPS.length - 1;
    else return;
    event.preventDefault();
    const id = STEPS[next];
    setStep(id);
    document.getElementById(`order-tab-${id}`)?.focus();
  };

  const chooseModel = (slug: string) => {
    const kinds = [...selection.kinds];
    if (TUB_MODELS.has(slug) && !kinds.includes('hot-tub')) kinds.push('hot-tub');
    apply({ ...selection, slug, kinds, label: 'Choose a model' });
  };

  const toggleAddon = (id: string) => {
    const addon = ORDER_ADDONS.find((item) => item.id === id);
    if (!addon) return;
    if (addon.kind) {
      const kinds = selection.kinds.includes(addon.kind)
        ? selection.kinds.filter((kind) => kind !== addon.kind)
        : [...selection.kinds, addon.kind];
      apply({ ...selection, kinds, label: addon.name });
      return;
    }
    const plain = selection.plain.includes(addon.id)
      ? selection.plain.filter((item) => item !== addon.id)
      : [...selection.plain, addon.id];
    apply({ ...selection, plain, label: addon.name });
  };

  const copyLink = async () => {
    const value = token ?? (await encodeDocument(state.doc));
    const url = new URL('/build-your-own', location.origin);
    url.hash = value;
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
    } catch {
      setCopied(false);
    }
    history.replaceState(null, '', `${url.pathname}${url.hash}`);
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="order">
      <div className="order-view">
        {live ? (
          <div ref={stageRef} className="order-stage" />
        ) : room.image ? (
          <img className="order-still" src={room.image} alt={room.alt} />
        ) : (
          <div className="order-still" role="img" aria-label={room.alt} />
        )}
        {live ? <p className="order-view-caption">A live view of the room in the meadow.</p> : null}
      </div>

      <form
        className="order-form"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="order-tools">
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={state.past.length === 0}>
            Undo
          </button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={state.future.length === 0}>
            Redo
          </button>
        </div>

        <div className="order-tabs" role="tablist" aria-label="Design steps" onKeyDown={onTabs}>
          {STEPS.map((id) => (
            <button
              key={id}
              id={`order-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={step === id}
              aria-controls="order-panel"
              tabIndex={step === id ? 0 : -1}
              onClick={() => setStep(id)}
            >
              {STEP_COPY[id].title}
            </button>
          ))}
        </div>

        <div className="order-panel" role="tabpanel" id="order-panel" aria-labelledby={`order-tab-${step}`}>
          <h2 className="order-step-title" data-reveal-heading>
            {copy.title}
          </h2>
          <p className="order-note">{copy.note}</p>

          {step === 'model' ? (
            <div className="order-choices" role="radiogroup" aria-label="Model">
              {roomConcepts.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className="order-choice"
                  role="radio"
                  aria-checked={item.slug === selection.slug}
                  onClick={() => chooseModel(item.slug)}
                >
                  <i aria-hidden="true" />
                  <strong>{item.name}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === 'size' ? (
            <div className="order-choices" role="radiogroup" aria-label="Size">
              {ORDER_SIZES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="order-choice"
                  role="radio"
                  aria-checked={item.id === selection.size}
                  onClick={() => apply({ ...selection, size: item.id, label: 'Choose a size' })}
                >
                  <i aria-hidden="true" />
                  <strong>{item.label}</strong>
                  <span>{item.note}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === 'glass' ? (
            <div className="order-choices" role="radiogroup" aria-label="Glass">
              {GLAZE.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="order-choice"
                  role="radio"
                  aria-checked={item.id === selection.glaze}
                  onClick={() => apply({ ...selection, glaze: item.id, label: 'Choose the glass' })}
                >
                  <i aria-hidden="true" />
                  <strong>{item.label}</strong>
                  <span>{item.note}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === 'addons' ? (
            <div className="order-choices">
              {ORDER_ADDONS.map((item) => {
                const on = item.kind ? selection.kinds.includes(item.kind) : selection.plain.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="order-choice"
                    role="checkbox"
                    aria-checked={on}
                    aria-pressed={on}
                    onClick={() => toggleAddon(item.id)}
                  >
                    <i aria-hidden="true" />
                    <strong>{item.name}</strong>
                    {item.detail ? <span>{item.detail}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {step === 'review' ? (
            <>
              <dl className="order-review">
                <div>
                  <dt>Model</dt>
                  <dd>{room.name}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{sizeLabel}</dd>
                </div>
                <div>
                  <dt>Glass</dt>
                  <dd>{glazeLabel}</dd>
                </div>
                <div>
                  <dt>Add-ons</dt>
                  <dd>{chosenAddons.length ? chosenAddons.map((item) => item.name).join(', ') : 'None yet'}</dd>
                </div>
              </dl>
              <LiveReadout document={state.doc} />
              <div className="order-actions">
                <a className="is-slide order-quote" href={quoteHref}>
                  <span className="slide-face">
                    <span className="slide-line">Get a quote</span>
                    <span className="slide-line" aria-hidden="true">
                      Get a quote
                    </span>
                  </span>
                </a>
                <button type="button" className="order-share" onClick={() => void copyLink()}>
                  Copy a link
                </button>
              </div>
              <p className="order-status" role="status">
                {copied ? 'Link copied.' : ''}
              </p>
            </>
          ) : null}
        </div>

        <div className="order-nav">
          <button
            type="button"
            className="order-next"
            onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])}
            disabled={stepIndex === 0}
          >
            Back
          </button>
          <button
            type="button"
            className="order-next"
            onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)])}
            disabled={stepIndex === STEPS.length - 1}
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
