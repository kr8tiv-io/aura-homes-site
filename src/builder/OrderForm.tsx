import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { collectionStandalone, standaloneBySlug } from '../data/collection';
import { roomConcepts } from '../lib/rooms';
import { onQuality } from '../three/quality';
import { liveCapable, liveOptInAvailable } from './liveCapable';
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
  WOOD_FINISHES,
  buildOrderDocument,
  isStandalone,
  roomForSlug,
  selectionFromDocument,
  standaloneAddons,
  standaloneShowsTub,
  startingDocument,
  type OrderGlaze,
  type OrderSize,
  type WoodFinish,
} from './models';
import '../styles/builder-order.css';

const ROOM_STEPS = ['model', 'size', 'glass', 'addons', 'review'] as const;
const PIECE_STEPS = ['model', 'finish', 'addons', 'review'] as const;
type Step = (typeof ROOM_STEPS)[number] | (typeof PIECE_STEPS)[number];

const STEP_COPY: Record<Step, { title: string; note: string }> = {
  model: {
    title: 'Model',
    note: 'Twelve rooms. Below them, the hot tub and the cold plunge, on their own.',
  },
  size: {
    title: 'Size',
    note: 'Snug, room, or long. The plan stays itself.',
  },
  glass: {
    title: 'Glass',
    note: 'Clear, tinted, or mirror. The same polycarbonate, three moods.',
  },
  finish: {
    title: 'Finish',
    note: 'Western red cedar or thermowood.',
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

function initialState(): EditorState {
  return {
    doc: startingDocument(),
    past: [],
    future: [],
    label: null,
    loadEpoch: 0,
  };
}

function frameFocus(focus: string | undefined, standalone: boolean): string {
  if (standalone) return 'center';
  if (!focus || focus === 'center') return 'center 28%';
  return focus;
}

export default function OrderForm() {
  const [state, dispatch] = useReducer(editorReducer, undefined, initialState);
  const [step, setStep] = useState<Step>('model');
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(false);
  const [offer, setOffer] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ paint: () => void; destroy: () => void } | null>(null);
  const docRef = useRef(state.doc);
  const glazeRef = useRef<OrderGlaze>('clear');
  docRef.current = state.doc;

  const selection = selectionFromDocument(state.doc);
  const piece = isStandalone(selection.slug);
  const product = standaloneBySlug(selection.slug);
  const room = roomForSlug(selection.slug) ?? roomConcepts[0];
  const displayName = product?.name ?? room.name;
  const displayAlt = product?.alt ?? room.alt;
  const displayImage = product?.image ?? room.image ?? '';
  const steps: Step[] = piece ? [...PIECE_STEPS] : [...ROOM_STEPS];
  const showLive = (live || optIn) && (!piece || standaloneShowsTub(selection.slug));
  const focus = frameFocus(room.focus, piece);
  const frameStyle = { '--order-focus': focus } as CSSProperties;
  glazeRef.current = selection.glaze;
  const copy = piece && step === 'addons'
    ? { title: 'Add-ons', note: 'What comes with this piece.' }
    : piece && step === 'review'
      ? { title: 'Review', note: 'This is the piece, as it stands.' }
      : STEP_COPY[step];
  const sizeLabel = ORDER_SIZES.find((item) => item.id === selection.size)?.label ?? 'Room';
  const glazeLabel = GLAZE.find((item) => item.id === selection.glaze)?.label ?? 'Clear';
  const woodLabel = WOOD_FINISHES.find((item) => item.id === selection.wood)?.label ?? 'Western red cedar';
  const addonCatalog = piece ? standaloneAddons(selection.slug) : ORDER_ADDONS;
  const chosenAddons = addonCatalog.filter(
    (item) => (item.kind && selection.kinds.includes(item.kind)) || selection.plain.includes(item.id),
  );
  const pickedDetail = [piece ? woodLabel : sizeLabel, piece ? '' : glazeLabel, chosenAddons.map((item) => item.name).join(', ')]
    .filter((part) => part.length > 0)
    .join(' · ');

  const quoteHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set('model', selection.slug);
    if (piece) params.set('finish', selection.wood);
    else {
      params.set('size', sizeLabel);
      params.set('finish', selection.glaze);
    }
    if (chosenAddons.length) params.set('add-ons', chosenAddons.map((item) => item.name).join(', '));
    if (token) params.set('share', token);
    return `/pre-order?${params.toString()}`;
  }, [piece, selection.slug, selection.glaze, selection.wood, sizeLabel, chosenAddons, token]);

  const apply = (next: {
    slug: string;
    size: OrderSize;
    glaze: OrderGlaze;
    wood: WoodFinish;
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
    const coarse = window.matchMedia('(pointer: coarse)');
    const anyFine = window.matchMedia('(any-pointer: fine)');
    const decide = () => {
      const capable = liveCapable();
      setLive(capable);
      setOffer(liveOptInAvailable());
      if (capable) setOptIn(false);
    };
    decide();
    const stop = onQuality(decide);
    wide.addEventListener('change', decide);
    fine.addEventListener('change', decide);
    coarse.addEventListener('change', decide);
    anyFine.addEventListener('change', decide);
    reduced.addEventListener('change', decide);
    return () => {
      stop();
      wide.removeEventListener('change', decide);
      fine.removeEventListener('change', decide);
      coarse.removeEventListener('change', decide);
      anyFine.removeEventListener('change', decide);
      reduced.removeEventListener('change', decide);
    };
  }, []);

  useEffect(() => {
    const allowed: readonly Step[] = isStandalone(selection.slug) ? PIECE_STEPS : ROOM_STEPS;
    if (!allowed.includes(step)) setStep('model');
  }, [selection.slug, step]);

  useEffect(() => {
    if (!showLive) {
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
  }, [showLive]);

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
    const index = steps.indexOf(step);
    let next = index < 0 ? 0 : index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (next + 1) % steps.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (next - 1 + steps.length) % steps.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = steps.length - 1;
    else return;
    event.preventDefault();
    const id = steps[next];
    setStep(id);
    document.getElementById(`order-tab-${id}`)?.focus();
  };

  const chooseModel = (slug: string) => {
    if (isStandalone(slug)) {
      apply({
        slug,
        size: 'room',
        glaze: 'clear',
        wood: selection.wood,
        plain: [],
        kinds: [],
        label: 'Choose a model',
      });
      return;
    }
    const leavingPiece = isStandalone(selection.slug);
    const kinds = leavingPiece ? [] : [...selection.kinds];
    if (TUB_MODELS.has(slug) && !kinds.includes('hot-tub')) kinds.push('hot-tub');
    const plain = leavingPiece ? [] : selection.plain;
    apply({ ...selection, slug, kinds, plain, label: 'Choose a model' });
  };

  const toggleAddon = (id: string) => {
    const addon = addonCatalog.find((item) => item.id === id);
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

  const stepIndex = Math.max(0, steps.indexOf(step));

  return (
    <div className={showLive ? 'order is-live' : 'order'}>
      <div className="order-view">
        {showLive ? (
          <div ref={stageRef} className="order-stage" />
        ) : product?.imageRight && product.altRight ? (
          <div className="order-pair" style={frameStyle}>
            <img key={`${selection.slug}-a`} src={product.image} alt={product.alt} />
            <img key={`${selection.slug}-b`} src={product.imageRight} alt={product.altRight} />
          </div>
        ) : displayImage ? (
          <img key={selection.slug} className="order-still" src={displayImage} alt={displayAlt} style={frameStyle} />
        ) : (
          <div className="order-still" role="img" aria-label={displayAlt} />
        )}
        {showLive ? (
          <p className="order-view-caption">
            {piece ? 'A live view of the tub in the meadow.' : 'A live view of the room in the meadow.'}
          </p>
        ) : (
          <p className="order-picked">
            <strong>{displayName}</strong>
            <span>{pickedDetail}</span>
          </p>
        )}
        {offer && !showLive ? (
          <button type="button" className="order-live-open" onClick={() => setOptIn(true)}>
            Open the 3D view
          </button>
        ) : null}
      </div>

      <form
        className="order-form"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        {live ? null : (
          <p className="order-live-note">
            The live 3D builder shines on a larger screen. Open it on desktop to turn the room in the meadow.
          </p>
        )}
        <div className="order-tools">
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={state.past.length === 0}>
            Undo
          </button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={state.future.length === 0}>
            Redo
          </button>
        </div>

        <div className="order-tabs" role="tablist" aria-label="Design steps" onKeyDown={onTabs}>
          {steps.map((id) => (
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
            <>
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
            <p className="order-group" id="order-standalone">Standalone</p>
            <div className="order-choices" role="radiogroup" aria-labelledby="order-standalone">
              {collectionStandalone.items.map((item) => (
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
                  <span>{item.line}</span>
                </button>
              ))}
            </div>
            </>
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

          {step === 'finish' ? (
            <div className="order-choices" role="radiogroup" aria-label="Finish">
              {WOOD_FINISHES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="order-choice"
                  role="radio"
                  aria-checked={item.id === selection.wood}
                  onClick={() => apply({ ...selection, wood: item.id, label: 'Choose a finish' })}
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
              {addonCatalog.map((item) => {
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
                  <dd>{displayName}</dd>
                </div>
                {piece ? (
                  <div>
                    <dt>Finish</dt>
                    <dd>{woodLabel}</dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt>Size</dt>
                      <dd>{sizeLabel}</dd>
                    </div>
                    <div>
                      <dt>Glass</dt>
                      <dd>{glazeLabel}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Add-ons</dt>
                  <dd>{chosenAddons.length ? chosenAddons.map((item) => item.name).join(', ') : 'None yet'}</dd>
                </div>
              </dl>
              {piece ? null : <LiveReadout document={state.doc} />}
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
            onClick={() => setStep(steps[Math.max(0, stepIndex - 1)])}
            disabled={stepIndex === 0}
          >
            Back
          </button>
          <button
            type="button"
            className="order-next"
            onClick={() => setStep(steps[Math.min(steps.length - 1, stepIndex + 1)])}
            disabled={stepIndex === steps.length - 1}
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
