/**
 * Plan record types the glass catalog needs.
 * The priced estimate and the full plan library were not brought across.
 */
import type { HomeSpec } from "./spec";

export type PlanSource =
  | {
      kind: "aura-authored";
      name: "Aura Homes";
      url: string;
      license: "MIT";
      licenseUrl: string;
      attribution: string;
      changes: string;
      shareAlike: false;
      relationship: "original";
    }
  | {
      kind: "licensed-adaptation";
      name: string;
      url: string;
      license: string;
      licenseUrl: string;
      attribution: string;
      changes: string;
      shareAlike: true;
      relationship: "dimensional-adaptation" | "system-informed-study";
    }
  /** US-government plan sets (17 USC 105) and other verified public-domain
   *  work. No licence survives to pass on — shareAlike is structurally false —
   *  but the provenance chain is recorded exactly as carefully as a licence,
   *  because "public domain" claimed without evidence is how a catalog ends up
   *  shipping somebody's copyrighted drawings. Every entry names where the
   *  rights statement was read and what Aura changed. */
  | {
      kind: "public-domain-adaptation";
      name: string;
      url: string;
      license: string;
      licenseUrl: string;
      attribution: string;
      changes: string;
      shareAlike: false;
      relationship: "dimensional-adaptation" | "system-informed-study";
    };

/** Whether the plan's sleeping loft is a modelled volume, an admitted gap, or
 *  not part of the building. A loft is a fact; the `sleeping` sentence is not. */
export type PlanLoft = "none" | "unmodelled" | "modelled";

/** How the loft relates to the rest of the sleeping. `primary` is a loft-only
 *  cabin; `secondary` sits over a main floor; `dormitory` is group sleeping. */
export type PlanLoftRole = "none" | "primary" | "secondary" | "dormitory";

export interface PlanSleepingFacts {
  loft: PlanLoft;
  loftRole: PlanLoftRole;
  enclosed: boolean;
  studio: boolean;
  cabins: boolean;
  alcoves: boolean;
  suite: boolean;
}

export interface PlanTemplate {
  id: string;
  title: string;
  kicker: string;
  summary: string;
  bestFor: string;
  bedrooms: number;
  bathrooms: number;
  sleeping: string;
  storeys: 1 | 2;
  tags: readonly string[];
  features: readonly string[];
  /** How honestly the shared Alberta BOM represents this design's intended
   *  construction. A proxy is still useful for scale, but must never read as
   *  a steel/polycarbonate quote. */
  costBasis?: PlanCostBasis;
  source: PlanSource;
  spec: HomeSpec;
}

export interface PlanCostBasis {
  status: "modelled" | "proxy";
  label: string;
  note: string;
}
