"use client";

import { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import Scene from "./Scene";
import StillScene from "./StillScene";

/** Fixed full-viewport canvas behind the copy. Detects WebGL up front and
 *  falls back to the still illustration so the page never renders blank. */
export default function StoryCanvas({
  progressRef,
  reduced,
  night = false,
}: {
  progressRef: React.MutableRefObject<number>;
  reduced: boolean;
  night?: boolean;
}) {
  const [webgl, setWebgl] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      setWebgl(!!gl);
    } catch {
      setWebgl(false);
    }
  }, []);

  if (webgl === null) return null;
  if (webgl === false) return <StillScene />;

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      frameloop={reduced ? "demand" : "always"}
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
      <Suspense fallback={null}>
        <Scene progressRef={progressRef} reduced={reduced} night={night} />
      </Suspense>
    </Canvas>
  );
}
