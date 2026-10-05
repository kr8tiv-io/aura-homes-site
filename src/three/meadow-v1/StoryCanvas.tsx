"use client";

import { Component, Suspense, startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import {
  nextOpeningSceneStage,
  selectOpeningSceneQuality,
  selectSceneQuality,
  type OpeningSceneStage,
  type SceneQuality,
} from "@/lib/three/sceneQuality";
import { probeWebGL } from "@/lib/three/webgl";
import Scene from "./Scene";

class SceneErrorBoundary extends Component<
  { children: ReactNode; onUnavailable?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onUnavailable?.();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ---------------------------------------------------------------------
   WEBGL PROBE — run on render, not in an effect, and hand the context back.

   Two things were wrong with probing inside useEffect and dropping the
   result on the floor:

   1. TIMING. StoryCanvas is only ever mounted on the client (Story.tsx
      pulls it in with next/dynamic ssr:false), so there is no hydration
      mismatch to defend against — and probing in an effect meant render 0
      returned null and <Canvas> could not mount until the following
      commit. Everything three.js does starts one commit later than it
      needs to, on the exact path the founder says feels slow.
   2. LEAKED CONTEXT. Browsers cap live WebGL contexts (~16 in Chrome) and
      dropping the JS reference does not free one — the GPU context lives
      until it is garbage collected or explicitly lost. Every mount leaked
      a probe context, and on a machine already near the cap that is what
      makes the real canvas come back context-lost. WEBGL_lose_context
      hands it straight back.

   The effect below stays purely as the SSR safety net: if this ever runs
   where `document` does not exist the probe returns null and the effect
   re-runs it after mount, i.e. exactly the old behaviour.
--------------------------------------------------------------------- */
interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

function runtimeQuality(reduced: boolean): SceneQuality {
  const nav = navigator as NavigatorWithMemory;
  return selectOpeningSceneQuality({
    width: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    deviceMemoryGb: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    reducedMotion: reduced,
  });
}

/** The quality the hardware actually earns, with the opening's caps lifted.
 *  Applied only after the last opening stage has painted a real frame — the
 *  0.14 grass cap exists to protect the first paint, and holding it forever
 *  was the bug that shipped a 14%-density meadow with dwarf flowers.
 *
 *  The frameloop is the module contract's, never overridden here: forcing
 *  "demand" on balanced/full froze the wind, clouds, steam and wildlife the
 *  moment the visitor stopped scrolling. The still tier already declares
 *  "demand" for the reduced-motion path that actually wants a still. */
function runtimeFullQuality(reduced: boolean): SceneQuality {
  const nav = navigator as NavigatorWithMemory;
  return selectSceneQuality({
    width: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    deviceMemoryGb: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    reducedMotion: reduced,
  });
}

/** Measure CPU time spent submitting an actual R3F render. A raw rAF delta
 * measures the monitor/browser cadence (20.8 ms on a 48 Hz surface), not the
 * active work Aura controls, and previously froze healthy promotion. */
function SceneRenderDurationSignal() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const originalRender = gl.render;
    const measuredRender: typeof gl.render = (scene, camera) => {
      const startedAt = performance.now();
      originalRender.call(gl, scene, camera);
      window.dispatchEvent(new CustomEvent("aura:render-duration", {
        detail: { startedAt, duration: performance.now() - startedAt },
      }));
    };
    gl.render = measuredRender;
    return () => {
      if (gl.render === measuredRender) gl.render = originalRender;
    };
  }, [gl]);
  return null;
}

/** Once the authored opening has settled, draw only for real input or state
 * changes. Scroll still invalidates every story-camera update, while an idle
 * scene stops burning GPU frames on an unchanged image. */
function StoryDemandInvalidator({ enabled }: { enabled: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!enabled) return undefined;
    let pendingFrame = 0;
    const requestFrame = () => {
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = 0;
        invalidate();
      });
    };
    window.addEventListener("scroll", requestFrame, { passive: true });
    window.addEventListener("resize", requestFrame, { passive: true });
    return () => {
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      window.removeEventListener("scroll", requestFrame);
      window.removeEventListener("resize", requestFrame);
    };
  }, [enabled, invalidate]);
  return null;
}

/** Signal each progressive phase only after R3F has completed a real frame.
 * The core signal releases the DOM loader; every later signal authorizes one
 * more idle-scheduled layer. */
function SceneFrameSignal({
  stage,
  armed,
  onPainted,
}: {
  stage: OpeningSceneStage;
  armed: boolean;
  onPainted: (stage: OpeningSceneStage) => void;
}) {
  const sent = useRef(false);
  const callback = useRef(onPainted);
  callback.current = onPainted;

  useFrame(() => {
    if (sent.current || !armed) return;
    sent.current = true;
    window.requestAnimationFrame(() => callback.current(stage));
  });
  return null;
}

/** Fixed full-viewport canvas behind the copy. Detects WebGL up front and
 *  falls back to the still illustration so the page never renders blank. */
export default function StoryCanvas({
  progressRef,
  reduced,
  night = false,
  allowFullQuality = false,
  releaseMeadowPromotion = false,
  onReady,
  onUnavailable,
  onStagePainted,
  onFetch,
}: {
  progressRef: React.MutableRefObject<number>;
  reduced: boolean;
  night?: boolean;
  /** The DOM handoff has completed its Ready hold, fade, and unmount. */
  allowFullQuality?: boolean;
  /** Continue beyond the composed ten-page meadow only after the DOM loader
   * has completed its visible Ready hold, fade, and unmount. */
  releaseMeadowPromotion?: boolean;
  onReady?: () => void;
  onUnavailable?: () => void;
  /** Reports each progressive stage's first committed frame up to the DOM
   *  loader, which stays visible until the meadow has painted. */
  onStagePainted?: (stage: OpeningSceneStage) => void;
  /** Reports THREE.DefaultLoadingManager counts (the six GLBs) up to the
   *  DOM loader. Observed here so drei stays inside this dynamic chunk. */
  onFetch?: (loaded: number, total: number) => void;
}) {
  const [webgl, setWebgl] = useState<boolean | null>(probeWebGL);
  const [quality, setQuality] = useState<SceneQuality>(() => runtimeQuality(reduced));
  const [lowPower, setLowPower] = useState(() => runtimeFullQuality(reduced).tier !== "full");
  const [stage, setStage] = useState<OpeningSceneStage>("core");
  const [paintedStage, setPaintedStage] = useState<OpeningSceneStage | null>(null);
  /** true once the LAST opening stage has painted — the moment the opening
   *  caps have done their job and the meadow may grow to full density. */
  const [settled, setSettled] = useState(false);
  const [meadowReady, setMeadowReady] = useState(false);
  /** true once the progressive meadow reports its terminal state (settled or
   *  governor-frozen) — the moment page integration can no longer collide
   *  with continuous rendering. */
  const [meadowTerminal, setMeadowTerminal] = useState(false);
  const fullQualityPromoted = useRef(false);
  const openingReadySent = useRef(false);

  const handleStagePainted = useCallback((painted: OpeningSceneStage) => {
    setPaintedStage(painted);
    onStagePainted?.(painted);
    if (painted === "core" && !openingReadySent.current) {
      openingReadySent.current = true;
      onReady?.();
    }
    if (painted === "meadow") setSettled(true);
  }, [onReady, onStagePainted]);
  const handleMeadowReady = useCallback(() => setMeadowReady(true), []);

  /* The meadow runtime broadcasts its lifecycle on the window (the same
     events the hardware proof records). Terminal means settled or frozen —
     either way, page integration is over. */
  useEffect(() => {
    const onMeadowProgress = (event: Event) => {
      const state = (event as CustomEvent<{ state?: string }>).detail?.state;
      if (state === "settled" || state === "frozen") setMeadowTerminal(true);
    };
    window.addEventListener("aura:meadow-progress", onMeadowProgress);
    return () => window.removeEventListener("aura:meadow-progress", onMeadowProgress);
  }, []);

  /* useProgress is a global zustand store wired to THREE.DefaultLoadingManager
     at module scope; Scene.tsx preloads the GLBs at module scope, so it is
     already counting by the time this component first renders. */
  const { errors: fetchErrors, loaded: fetchLoaded, total: fetchTotal } = useProgress();
  useEffect(() => {
    onFetch?.(fetchLoaded, fetchTotal);
  }, [onFetch, fetchLoaded, fetchTotal]);

  useEffect(() => {
    if (fetchErrors.length > 0) onUnavailable?.();
  }, [fetchErrors, onUnavailable]);

  useEffect(() => {
    if (webgl === null) setWebgl(probeWebGL() ?? false);
  }, [webgl]);

  useEffect(() => {
    if (webgl === false) onUnavailable?.();
  }, [onUnavailable, webgl]);

  useEffect(() => {
    const refreshQuality = () => {
      const full = runtimeFullQuality(reduced);
      setLowPower(full.tier !== "full");
      const next = fullQualityPromoted.current ? full : runtimeQuality(reduced);
      setQuality(next);
    };
    refreshQuality();
    window.addEventListener("resize", refreshQuality, { passive: true });
    return () => window.removeEventListener("resize", refreshQuality);
  }, [reduced, settled]);

  /* The promotion. Once the meadow stage has painted at the opening scale
     AND the DOM loader has completed its Ready hold/fade, lift the caps
     through the SAME idle boundary the stage machine uses. Rebuilding ~1M
     grass instances is exactly the task the opening split to avoid, so it
     cannot starve the loader's teardown or land inside its final frame. */
  useEffect(() => {
    if (!settled || !allowFullQuality || fullQualityPromoted.current) return;
    /* Promote only where the hardware earns the FULL tier. On balanced-tier
       devices promotion would lift almost nothing (sparkles 30→45; rich
       flowers need full), yet its re-render lands mid page-integration on
       slower hardware and trips the meadow governor — a measured 197 ms
       long task froze the mobile meadow at its opening floor. */
    if (lowPower) return;
    let idleHandle: number | null = null;
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const timer = window.setTimeout(() => {
      const promote = () => {
        fullQualityPromoted.current = true;
        startTransition(() => setQuality(runtimeFullQuality(reduced)));
      };
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(promote, { timeout: 2_000 });
      } else {
        window.requestAnimationFrame(promote);
      }
    }, 600);
    return () => {
      window.clearTimeout(timer);
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
    };
  }, [settled, allowFullQuality, lowPower, reduced]);

  /* Progress only after the current stage has produced a real frame. Each
     addition is scheduled through an idle boundary, so model cloning,
     atmosphere shaders and meadow instances cannot collapse back into the
     single 19-second task this replaces. */
  useEffect(() => {
    if (paintedStage !== stage) return;
    const next = nextOpeningSceneStage(stage);
    if (!next) return;

    const delay = stage === "core" ? 450 : stage === "site" ? 550 : stage === "forest" ? 700 : 900;
    let idleHandle: number | null = null;
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const timer = window.setTimeout(() => {
      const advance = () => startTransition(() => {
        setStage((current) => current === stage ? next : current);
      });
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(advance, { timeout: 1_200 });
      } else {
        window.requestAnimationFrame(advance);
      }
    }, delay);

    return () => {
      window.clearTimeout(timer);
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
    };
  }, [paintedStage, stage]);

  if (webgl === null) return null;
  if (webgl === false) return null;

  /* Low-power devices integrate the released meadow pages (11–44) on demand:
     a render landing in the same frame as a page merge was a measured
     161–197 ms long task that froze the mobile governor at its opening
     floor. The wind starts the moment the meadow reports terminal. Capable
     desktops integrate cleanly under the module contract (measured 0.2 ms
     causal max) and keep their wind from the first settled frame. */
  const integrationDemand = lowPower && settled && !meadowTerminal;

  return (
    <>
      <div
        data-scene-quality={quality.tier}
        data-scene-phase={stage}
        data-meadow-ready={stage === "meadow" ? String(meadowReady) : undefined}
        className="story-scene-root"
      >
        <SceneErrorBoundary onUnavailable={onUnavailable}>
        <Canvas
          shadows={quality.softShadows}
          dpr={[1, quality.maxDpr]}
          frameloop={integrationDemand ? "demand" : quality.frameloop}
        /* far was 140 — the mountain range sits well beyond that and was being
           clipped into a grey slab across the sky. 260 clears the range from
           every camera beat while keeping the near/far ratio modest enough not
           to cost depth precision (0.3/260 ≈ 870, vs 467 before) — which
           matters, because coplanar glass on the deck is only just resolved. */
        camera={{ fov: 38, near: 0.4, far: 260, position: [-4.5, 5.4, 17.5] }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          /* ACES over AgX (both trialled, Aug 2026): AgX's gentler highlight
             rolloff helped the dusk sun, but it desaturated the emerald
             landscape and teal firs — and vivid, alive foliage is what sells
             this eco brand. ACES keeps the greens punchy; the dusk clip AgX
             fixed was never actually a problem here. */
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
        }}
        style={{ position: "fixed", inset: 0, zIndex: 0 }}
        aria-hidden
      >
        {/* The fallback stays null on purpose. A Suspense fallback inside
            Canvas can only be 3D; the status card lives in Story.tsx so it
            paints before this bundle and survives main-thread scene work. */}
        <Suspense fallback={null}>
          <Scene
            progressRef={progressRef}
            reduced={reduced}
            night={night}
            quality={quality}
            lowPower={lowPower}
            releaseMeadowPromotion={releaseMeadowPromotion}
            stage={stage}
            onMeadowReady={handleMeadowReady}
          />
          <SceneFrameSignal
            key={stage}
            stage={stage}
            armed={stage !== "meadow" || meadowReady}
            onPainted={handleStagePainted}
          />
          <SceneRenderDurationSignal />
          {/* Demand rendering exists in exactly two places — the reduced-
              motion still tier, and low-power page integration — and both
              keep scroll/resize invalidation so the image tracks the camera. */}
          <StoryDemandInvalidator enabled={integrationDemand || (settled && quality.frameloop === "demand")} />
        </Suspense>
        </Canvas>
        </SceneErrorBoundary>
      </div>
    </>
  );
}
