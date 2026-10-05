export type MeadowTier = "near" | "mid" | "far";
export type MeadowLayer = "hero";

export interface MeadowCapabilityInput {
  width: number;
  reducedMotion: boolean;
  lowPower: boolean;
}

export interface MeadowPlan {
  densityScale: number;
  maxTier: MeadowTier;
  flowerCount: number;
  richFlowers: boolean;
  animated: boolean;
}

export interface MeadowPageTask {
  id: string;
  tier: MeadowTier;
  layer: MeadowLayer;
  x0: number;
  z0: number;
  size: number;
  capacity: number;
  seed: number;
}

export interface MeadowPage {
  id: string;
  tier: MeadowTier;
  layer: MeadowLayer;
  count: number;
  positions: Float32Array;
  random: Float32Array;
  clearance: Float32Array;
  bounds: {
    cx: number;
    cy: number;
    cz: number;
    radius: number;
  };
}

export const MEADOW_MAX_PAGE_INSTANCES = 2_000;
/* 0.25 is the approved drift for the 3D dust motes. The quarter-speed rule
   that briefly landed here belongs to the DOM border-star tracer
   (CARD_TRACER_SPEED_PX_PER_SECOND in CardFX) — a different surface. */
export const MEADOW_SPARKLE_SPEED = 0.25;

const TIER_ORDER: MeadowTier[] = ["near", "mid", "far"];

export function meadowTierRank(tier: MeadowTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function shouldStartMeadow(enabled: boolean): boolean {
  return enabled;
}

/** The loader may hand off only after ten small hero pages compose both
 * sides of the house. The offline atlas owns the dense carpet beyond these
 * live blades, so no second population is required for readiness. */
export function isMeadowReady(pages: MeadowPage[]): boolean {
  const near = pages.filter((page) => page.tier === "near" && page.count > 0);
  const instances = near.reduce((sum, page) => sum + page.count, 0);
  const hero = near.filter((page) => page.layer === "hero");
  const spansHeroView = hero.some((page) => page.bounds.cx < -2) && hero.some((page) => page.bounds.cx > 2);
  return (
    near.length >= 10 &&
    hero.length === near.length &&
    spansHeroView &&
    instances >= 15_000
  );
}

export function chooseMeadowPlan(input: MeadowCapabilityInput): MeadowPlan {
  if (input.reducedMotion) {
    return {
      densityScale: 0.56,
      maxTier: "mid",
      flowerCount: 200,
      richFlowers: false,
      animated: false,
    };
  }

  if (input.lowPower || input.width < 820) {
    return {
      densityScale: 0.5,
      maxTier: "mid",
      flowerCount: 380,
      richFlowers: false,
      animated: false,
    };
  }

  return {
    densityScale: 1,
    maxTier: "far",
      flowerCount: 1_000,
    richFlowers: true,
    animated: true,
  };
}

type LayerLayout = {
  tier: MeadowTier;
  layer: MeadowLayer;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  tile: number;
  density: number;
};

const LAYOUTS: LayerLayout[] = [
  { tier: "near", layer: "hero", x0: -24, x1: 24, z0: -12, z1: 48, tile: 12, density: 20 },
];

/**
 * Produce small, deterministic work units. Every unit fits inside one main-
 * thread materialisation budget; the worker sends one and waits for an ACK
 * before building the next, so transferred buffers never arrive in a burst.
 */
export function createMeadowSchedule(plan: MeadowPlan): MeadowPageTask[] {
  const tasks: MeadowPageTask[] = [];
  let seed = 0;

  for (const layout of LAYOUTS) {
    if (meadowTierRank(layout.tier) > meadowTierRank(plan.maxTier)) continue;
    for (let z = layout.z0; z < layout.z1; z += layout.tile) {
      for (let x = layout.x0; x < layout.x1; x += layout.tile) {
        /* Split the four authored opening tiles into three deterministic
           passes. This preserves their complete inventory while halving the
           integration cost of each former 4k-candidate page. Every other tile
           keeps two sparse silhouette passes over the atlas. */
        const focusTile = Math.abs(x + layout.tile / 2) <= 6 && z + layout.tile / 2 >= 18 && z + layout.tile / 2 <= 30;
        const passes = focusTile ? 3 : 2;
        for (let pass = 0; pass < passes; pass += 1) {
          tasks.push({
            id: `${layout.tier}-${layout.layer}-${x}-${z}-p${pass}`,
            tier: layout.tier,
            layer: layout.layer,
            x0: x,
            z0: z,
            size: layout.tile,
            capacity: 128,
            seed: seed++,
          });
        }
      }
    }
  }

  const focusX = 0;
  const focusZ = 25;
  const ordered = tasks.sort((a, b) => {
    const tier = meadowTierRank(a.tier) - meadowTierRank(b.tier);
    if (tier !== 0) return tier;
    const ad = Math.hypot(a.x0 + a.size / 2 - focusX, a.z0 + a.size / 2 - focusZ);
    const bd = Math.hypot(b.x0 + b.size / 2 - focusX, b.z0 + b.size / 2 - focusZ);
    return ad - bd || a.seed - b.seed;
  });

  return ordered.map((task, index) => ({
    ...task,
    capacity: index < 12
      ? MEADOW_MAX_PAGE_INSTANCES
      : Math.max(128, Math.round(192 * plan.densityScale)),
  }));
}
