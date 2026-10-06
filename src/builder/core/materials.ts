/**
 * Wall assembly thicknesses the builder geometry reads.
 * The priced material tables were not brought across.
 */
import type { EcoMaterial } from "./designApi";

export type EcoMaterialKey =
  | EcoMaterial // "sip" | "rammed_earth" | "clt" | "timber_frame"
  | "bamboo"
  | "reclaimed_timber"
  | "hempcrete_infill"; // non-structural, paired with a frame

export const ECO_MATERIALS: readonly EcoMaterialKey[] = [
  "sip",
  "clt",
  "timber_frame",
  "rammed_earth",
  "bamboo",
  "reclaimed_timber",
  "hempcrete_infill",
];

/**
 * Structural wall thickness in mm. Real numbers — they change the plan, the
 * net internal area, and the price per square foot, which is why the wall is
 * modelled instead of drawn as a generic line. The packer insets the interior
 * envelope by this on all four sides.
 */
export const WALL_THICKNESS_MM: Readonly<Record<EcoMaterialKey, number>> = {
  sip: 165,
  clt: 128,
  timber_frame: 190,
  rammed_earth: 450,
  bamboo: 175,
  reclaimed_timber: 200,
  hempcrete_infill: 300, // timber frame + hempcrete infill
};

/** Effective R-value of the assembly, for the honest energy note on the sheet. */
export const WALL_R_VALUE: Readonly<Record<EcoMaterialKey, number>> = {
  sip: 40,
  clt: 28,
  timber_frame: 32,
  rammed_earth: 26, // mass, not resistance — needs an insulated core
  bamboo: 24,
  reclaimed_timber: 30,
  hempcrete_infill: 27,
};

/**
 * Interior partitions are the same everywhere — they are not structural.
 * (Mirrors `PARTITION_MM` in `design-api/app/models.py`, which is where the
 * layout engine reads it from; kept here because it is a wall-assembly fact,
 * not a schema detail.)
 */
export const PARTITION_MM = 90;
