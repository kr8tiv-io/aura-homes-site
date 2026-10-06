export type SceneQualityTier = "still" | "balanced" | "full";

export interface SceneQualityInputs {
  width: number;
  devicePixelRatio: number;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  reducedMotion: boolean;
}

export interface SceneQuality {
  tier: SceneQualityTier;
  maxDpr: number;
  grassScale: number;
  postprocessing: boolean;
  softShadows: boolean;
  environmentResolution: 32 | 64;
  shadowMapSize: 1024 | 2048;
  sparkleCount: number;
  frameloop: "always" | "demand";
}

export interface BuilderSceneQuality {
  tier: SceneQualityTier;
  maxDpr: number;
  environmentResolution: 32 | 64;
  shadowMapSize: 1024 | 2048;
  contactShadowResolution: 256 | 512;
  frameloop: "demand";
}

export const OPENING_SCENE_STAGES = ["core", "site", "forest", "atmosphere", "meadow"] as const;
export type OpeningSceneStage = (typeof OPENING_SCENE_STAGES)[number];

export function nextOpeningSceneStage(stage: OpeningSceneStage): OpeningSceneStage | null {
  const index = OPENING_SCENE_STAGES.indexOf(stage);
  return OPENING_SCENE_STAGES[index + 1] ?? null;
}

const STILL: SceneQuality = {
  tier: "still",
  maxDpr: 1.25,
  grassScale: 0.32,
  postprocessing: false,
  softShadows: false,
  environmentResolution: 32,
  shadowMapSize: 1024,
  sparkleCount: 30,
  frameloop: "demand",
};

const BALANCED: SceneQuality = {
  tier: "balanced",
  maxDpr: 1.25,
  grassScale: 0.38,
  postprocessing: false,
  softShadows: false,
  environmentResolution: 32,
  shadowMapSize: 1024,
  sparkleCount: 45,
  frameloop: "always",
};

const FULL: SceneQuality = {
  tier: "full",
  maxDpr: 1.75,
  grassScale: 1,
  postprocessing: true,
  softShadows: true,
  environmentResolution: 64,
  shadowMapSize: 2048,
  sparkleCount: 80,
  frameloop: "always",
};

/**
 * Choose a scene budget from stable browser capability hints.
 *
 * Unknown memory/core values deliberately do not earn the full tier. Those
 * hints are absent in several privacy-conscious browsers, and a beautiful
 * balanced scene is a better default than betting the interaction on a GPU
 * we know nothing about.
 */
export function selectSceneQuality(input: SceneQualityInputs): SceneQuality {
  if (input.reducedMotion) return { ...STILL };

  const constrained =
    input.width < 820 ||
    (input.deviceMemoryGb !== undefined && input.deviceMemoryGb <= 4) ||
    (input.hardwareConcurrency !== undefined && input.hardwareConcurrency <= 4);
  if (constrained) return { ...BALANCED };

  const capable =
    input.width >= 1100 &&
    input.deviceMemoryGb !== undefined &&
    input.deviceMemoryGb >= 8 &&
    input.hardwareConcurrency !== undefined &&
    input.hardwareConcurrency >= 8;

  return capable ? { ...FULL } : { ...BALANCED };
}

/** One-way runtime fallback after the renderer has supplied real evidence. */
export function degradeSceneQuality(quality: SceneQuality): SceneQuality {
  return quality.tier === "full" ? { ...BALANCED } : quality;
}

/**
 * First entry is deliberately capped at the balanced shader set. Starting
 * full and reacting to slow frames is too late: the expensive programs have
 * already compiled, and downgrading then compiles a second set. Full remains
 * available for a future explicit quality control, never as a surprise cost
 * during the landing handoff.
 */
export function selectOpeningSceneQuality(input: SceneQualityInputs): SceneQuality {
  const safe = degradeSceneQuality(selectSceneQuality(input));
  return {
    ...safe,
    /* The authored terrain carries the meadow at a distance; the opening
       only needs enough individual blades to resolve around the house.
       Building 400k+ instances before the first frame caused a measured
       19-second main-thread stall on the target Radeon 740M. */
    grassScale: Math.min(safe.grassScale, 0.14),
    sparkleCount: Math.min(safe.sparkleCount, 30),
  };
}

/**
 * The builder shares the story's capability tiers, but never its continuous
 * render loop. Editing benefits from richer light on capable hardware; an
 * idle model does not benefit from drawing the same frame sixty times.
 */
export function selectBuilderSceneQuality(input: SceneQualityInputs): BuilderSceneQuality {
  return asBuilderQuality(selectSceneQuality(input));
}

/** One-way renderer-evidence fallback with the builder's demand contract. */
export function degradeBuilderSceneQuality(
  quality: BuilderSceneQuality,
): BuilderSceneQuality {
  return quality.tier === "full" ? asBuilderQuality(BALANCED) : quality;
}

function asBuilderQuality(quality: SceneQuality): BuilderSceneQuality {
  return {
    tier: quality.tier,
    maxDpr: quality.maxDpr,
    environmentResolution: quality.environmentResolution,
    shadowMapSize: quality.shadowMapSize,
    contactShadowResolution: quality.tier === "full" ? 512 : 256,
    frameloop: "demand",
  };
}
