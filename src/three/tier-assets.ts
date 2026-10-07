/*
  Per-tier files for the meadow passages.

  Desktop rows match the scenes that already ship. High and ultra stay on
  those rows so a wide screen does not change.

  Phones (low and medium) share one diet: lod2 grove, no heavy props, no
  Alps 2k, no multi-megabyte normal maps. Prop lod2 files are still
  0.65 to 1.61 MB, so they are dropped rather than fetched.
*/
import { isPhoneClass, qualityProfile, type QualityTier } from './quality';

export type SurfacePack = 'full' | 'color' | 'off';
export type GroundPack = 'full' | 'color';

export type TierAssetPlan = {
  /** Non-vista forest. `pines` is the lighter stand. `grove` is the full scatter. */
  trees: 'pines' | 'grove';
  /** Vista passages such as slope, snow, and the far field. */
  vista: 'pines' | 'grove';
  /** Ferns, stump, moss rock, and dandelions around a golden meadow. */
  props: boolean;
  /** `all` fetches full, lod1, and lod2. `far` fetches lod2 only. */
  lod: 'all' | 'far';
  /** Alps band behind the golden sky. `off` keeps the Preetham dome only. */
  goldenSky: '2k' | '1k' | 'off';
  /** Size token for an unpinned HDRI. Pinned passage URLs stay as authored. */
  hdri: '1k' | '2k';
  /** The 5 MB ground normals and the other KTX2 normal maps. */
  normals: boolean;
  /** Roughness and ambient-occlusion maps. */
  detail: boolean;
  /** Unit, tub, slope, and dressed-ground texture sets. */
  surfaces: SurfacePack;
  /** Golden ground. `color` is diffuse only. */
  ground: GroundPack;
};

const FULL: Omit<TierAssetPlan, 'trees' | 'vista' | 'props' | 'lod' | 'goldenSky'> = {
  hdri: '1k',
  normals: true,
  detail: true,
  surfaces: 'full',
  ground: 'full',
};

const PLANS: Record<QualityTier, TierAssetPlan> = {
  off: {
    trees: 'pines',
    vista: 'pines',
    props: false,
    lod: 'far',
    goldenSky: 'off',
    hdri: '1k',
    normals: false,
    detail: false,
    surfaces: 'off',
    ground: 'color',
  },
  low: { trees: 'pines', vista: 'grove', props: true, lod: 'all', goldenSky: '2k', ...FULL },
  medium: { trees: 'grove', vista: 'grove', props: true, lod: 'all', goldenSky: '2k', ...FULL },
  high: { trees: 'grove', vista: 'grove', props: true, lod: 'all', goldenSky: '2k', ...FULL },
  ultra: { trees: 'grove', vista: 'grove', props: true, lod: 'all', goldenSky: '2k', ...FULL },
};

const PHONE: TierAssetPlan = {
  trees: 'grove',
  vista: 'grove',
  props: false,
  lod: 'far',
  goldenSky: 'off',
  hdri: '1k',
  normals: false,
  detail: false,
  surfaces: 'color',
  ground: 'color',
};

/** Low and medium phones. An explicit high or ultra query keeps the desktop row. */
export function phoneAssetDiet(tier: QualityTier = qualityProfile().tier): boolean {
  if (!isPhoneClass()) return false;
  return tier === 'low' || tier === 'medium';
}

export function tierAssets(tier: QualityTier = qualityProfile().tier): TierAssetPlan {
  if (phoneAssetDiet(tier)) return PHONE;
  return PLANS[tier];
}
