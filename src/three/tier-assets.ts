/*
  Per-tier files for the meadow passages.

  Prompt 65 edits this table (and the phone gate in quality.ts). The
  scheduler does not choose URLs. Worlds read `tierAssets()` while they
  build, so a row change is enough.

  Today's rows match the scenes that already ship:
  - low golden meadows use the lighter pine stand, and still place props
  - vista passages (slope, snow, far) keep the grove
  - high and ultra load every grove LOD and the 2k Alps band

  A phone diet belongs in the low row: `lod: 'far'`, `props: false`,
  `goldenSky: 'off'` or `'1k'`. Leave high and ultra on these rows so a
  wide screen stays as it is.
*/
import { qualityProfile, type QualityTier } from './quality';

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
};

const PLANS: Record<QualityTier, TierAssetPlan> = {
  off: { trees: 'pines', vista: 'pines', props: false, lod: 'far', goldenSky: 'off', hdri: '1k' },
  low: { trees: 'pines', vista: 'grove', props: true, lod: 'all', goldenSky: '2k', hdri: '1k' },
  medium: { trees: 'grove', vista: 'grove', props: true, lod: 'all', goldenSky: '2k', hdri: '1k' },
  high: { trees: 'grove', vista: 'grove', props: true, lod: 'all', goldenSky: '2k', hdri: '1k' },
  ultra: { trees: 'grove', vista: 'grove', props: true, lod: 'all', goldenSky: '2k', hdri: '1k' },
};

export function tierAssets(tier: QualityTier = qualityProfile().tier): TierAssetPlan {
  return PLANS[tier];
}
