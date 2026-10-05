"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  chooseMeadowPlan,
  createMeadowSchedule,
  isMeadowReady,
  meadowTierRank,
  shouldStartMeadow,
  type MeadowPage,
  type MeadowPlan,
  type MeadowTier,
} from "./contract";
import { buildMeadowPage } from "./generator";
import { MeadowPromotionGovernor, type MeadowGovernorSnapshot } from "./governor";

export type MeadowRuntimeState = "idle" | "preparing" | "promoting" | "settled" | "frozen";

export interface MeadowProgressEvent {
  state: MeadowRuntimeState;
  tier: MeadowTier | null;
  pages: number;
  instances: number;
  governor: MeadowGovernorSnapshot;
}

type WorkerPageMessage = {
  type: "page";
  runId: string;
  page: MeadowPage;
  workerMs: number;
};

type WorkerDoneMessage = { type: "done"; runId: string };

function emitProgress(detail: MeadowProgressEvent): void {
  window.dispatchEvent(new CustomEvent<MeadowProgressEvent>("aura:meadow-progress", { detail }));
}

export function useProgressiveMeadow(options: {
  enabled: boolean;
  width: number;
  reducedMotion: boolean;
  lowPower: boolean;
  releaseAfterReady: boolean;
  invalidate: () => void;
}) {
  const plan = useMemo(
    () =>
      chooseMeadowPlan({
        width: options.width,
        reducedMotion: options.reducedMotion,
        lowPower: options.lowPower,
      }),
    [options.lowPower, options.reducedMotion, options.width],
  );
  const [pages, setPages] = useState<MeadowPage[]>([]);
  const [state, setState] = useState<MeadowRuntimeState>(options.enabled ? "preparing" : "idle");
  const pagesRef = useRef<MeadowPage[]>([]);
  const invalidateRef = useRef(options.invalidate);
  const planRef = useRef(plan);
  const pendingAckRef = useRef<(() => void) | null>(null);
  const heldAckRef = useRef<(() => void) | null>(null);
  const releaseAfterReadyRef = useRef(options.releaseAfterReady);
  const ackFrameRef = useRef(0);
  const ackPaintFrameRef = useRef(0);
  invalidateRef.current = options.invalidate;
  planRef.current = plan;
  releaseAfterReadyRef.current = options.releaseAfterReady;
  const planKey = `${plan.densityScale}:${plan.maxTier}:${plan.flowerCount}:${plan.animated}`;
  const mobile = options.width < 820;

  /* Backpressure follows the actual React/R3F commit, not an estimated timer.
     A worker page cannot unlock its successor until the new pages array has
     committed and two browser frames have had a chance to paint it. */
  useEffect(() => {
    const acknowledge = pendingAckRef.current;
    if (!acknowledge) return undefined;
    pendingAckRef.current = null;
    ackFrameRef.current = window.requestAnimationFrame(() => {
      ackPaintFrameRef.current = window.requestAnimationFrame(() => {
        acknowledge();
      });
    });
    return () => {
      window.cancelAnimationFrame(ackFrameRef.current);
      window.cancelAnimationFrame(ackPaintFrameRef.current);
    };
  }, [pages]);

  useEffect(() => {
    if (!options.releaseAfterReady || !heldAckRef.current) return;
    const acknowledge = heldAckRef.current;
    heldAckRef.current = null;
    acknowledge();
  }, [options.releaseAfterReady]);

  useEffect(() => {
    if (!shouldStartMeadow(options.enabled)) {
      pagesRef.current = [];
      setPages([]);
      setState("idle");
      return;
    }

    const activePlan = planRef.current;
    const runId = `meadow-${planKey}`;
    const governor = new MeadowPromotionGovernor({
      frameBudgetMs: mobile ? 33.3 : 16.7,
      longTaskLimitMs: 50,
    });
    let worker: Worker | null = null;
    let cancelled = false;
    let observer: PerformanceObserver | null = null;
    let fallbackTimer = 0;
    let acceptedTier: MeadowTier | null = null;
    let terminal = false;
    let integrationStartedAt = Number.POSITIVE_INFINITY;
    let integrationEndsAt = 0;

    pagesRef.current = [];
    pendingAckRef.current = null;
    heldAckRef.current = null;
    setPages([]);
    setState("preparing");

    const snapshot = (nextState: MeadowRuntimeState) => {
      const accepted = pagesRef.current;
      emitProgress({
        state: nextState,
        tier: acceptedTier,
        pages: accepted.length,
        instances: accepted.reduce((sum, page) => sum + page.count, 0),
        governor: governor.snapshot(),
      });
    };

    const stopMonitoring = () => {
      pendingAckRef.current = null;
      heldAckRef.current = null;
      window.cancelAnimationFrame(ackFrameRef.current);
      window.cancelAnimationFrame(ackPaintFrameRef.current);
      observer?.disconnect();
      window.removeEventListener("aura:render-duration", observeRenderDuration as EventListener);
    };

    const enterTerminal = (nextState: Extract<MeadowRuntimeState, "settled" | "frozen">) => {
      if (terminal) return;
      terminal = true;
      worker?.postMessage({ type: "cancel", runId });
      worker?.terminate();
      worker = null;
      window.clearTimeout(fallbackTimer);
      stopMonitoring();
      setState(nextState);
      snapshot(nextState);
    };

    const freezeIfNeeded = () => {
      if (terminal) return true;
      if (!governor.snapshot().frozen) return false;
      /* Near hero + fill pages are the composed fallback itself. Even if the
         surrounding page supplies a long task, seed that bounded pair before
         freezing; otherwise the loader would wait for vegetation forever. */
      if (!isMeadowReady(pagesRef.current)) return false;
      enterTerminal("frozen");
      return true;
    };

    const acceptPage = (page: MeadowPage) => {
      const seedingFallback = !isMeadowReady(pagesRef.current);
      if (cancelled || (!seedingFallback && !governor.canAccept(page.tier))) return false;
      const startedAt = performance.now();
      integrationStartedAt = startedAt;
      integrationEndsAt = Number.POSITIVE_INFINITY;
      pagesRef.current = [...pagesRef.current, page];
      if (seedingFallback && isMeadowReady(pagesRef.current)) {
        governor.resetFrameSample();
      }
      startTransition(() => setPages(pagesRef.current));
      invalidateRef.current();
      governor.observeLongTask(performance.now() - startedAt);
      if (acceptedTier === null || meadowTierRank(page.tier) > meadowTierRank(acceptedTier)) {
        acceptedTier = page.tier;
        governor.markHealthy(page.tier);
        setState("promoting");
      }
      snapshot("promoting");
      return !freezeIfNeeded();
    };

    const observeRenderDuration = (event: Event) => {
      if (terminal) return;
      const { startedAt, duration } = (event as CustomEvent<{ startedAt: number; duration: number }>).detail;
      if (startedAt >= integrationStartedAt && startedAt <= integrationEndsAt) {
        governor.observeFrame(duration);
        freezeIfNeeded();
      }
    };
    window.addEventListener("aura:render-duration", observeRenderDuration as EventListener);

    if ("PerformanceObserver" in window) {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.startTime >= integrationStartedAt && entry.startTime <= integrationEndsAt) {
              governor.observeLongTask(entry.duration);
            }
          }
          freezeIfNeeded();
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        observer = null;
      }
    }

    const finish = () => {
      if (cancelled || terminal || governor.snapshot().frozen) return;
      enterTerminal("settled");
    };

    const startFallback = () => {
      worker?.terminate();
      worker = null;
      const fallback = createMeadowSchedule({ ...activePlan, maxTier: "mid" });
      let cursor = 0;
      const buildNext = () => {
        if (cancelled || cursor >= fallback.length) {
          finish();
          return;
        }
        const startedAt = performance.now();
        const page = buildMeadowPage(fallback[cursor++]);
        governor.observeLongTask(performance.now() - startedAt);
        if (acceptPage(page)) fallbackTimer = window.setTimeout(buildNext, 16);
      };
      fallbackTimer = window.setTimeout(buildNext, 0);
    };

    if (typeof Worker !== "undefined") {
      worker = new Worker(new URL("../../../workers/meadow.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerPageMessage | WorkerDoneMessage>) => {
        if (event.data.runId !== runId || cancelled) return;
        if (event.data.type === "done") {
          finish();
          return;
        }
        const accepted = acceptPage(event.data.page);
        if (accepted && worker) {
          // workerMs is recorded by the worker for diagnostics only. It is not
          // main-thread blocking time and can never freeze browser promotion.
          void event.data.workerMs;
            if (!freezeIfNeeded()) {
              const acknowledgeWorker = () => worker?.postMessage({ type: "ack", runId });
              pendingAckRef.current = () => {
                integrationEndsAt = performance.now();
                if (isMeadowReady(pagesRef.current) && !releaseAfterReadyRef.current) {
                  heldAckRef.current = acknowledgeWorker;
                } else {
                  acknowledgeWorker();
                }
              };
          }
        }
      };
      worker.onerror = () => startFallback();
      worker.postMessage({ type: "start", runId, plan: activePlan } satisfies { type: "start"; runId: string; plan: MeadowPlan });
    } else {
      // A rare worker-disabled browser still gets a composed, deterministic
      // meadow. It builds one bounded page per timer and stops at mid-field.
      startFallback();
    }

    return () => {
      cancelled = true;
      worker?.postMessage({ type: "cancel", runId });
      worker?.terminate();
      window.clearTimeout(fallbackTimer);
      stopMonitoring();
    };
  }, [mobile, options.enabled, planKey]);

  return { pages, plan, state, ready: isMeadowReady(pages) };
}
