/* ===========================================================================
   THE HOME SPEC — the one contract the whole builder is built around.

   The founder's ask, in his words: "we have to create a builder that somebody
   can actually build their own smart homes, kind of like Nordic style type
   deal with beautiful polycarbonate glass ... and then they can go directly
   from a little thing that they're playing with all the way to production."

   That sentence sets the shape of this file. A spec has to be:

   1. SIMPLE ENOUGH TO PLAY WITH. Every field is a number a person can picture
      — feet, degrees, a named roof form. No matrices, no meshes, no CSG trees.
      Somebody dragging a slider must be editing something they understand.
   2. RICH ENOUGH TO BE A BUILDING. Multiple volumes, so an L-plan or a
      Nordic cluster of linked forms is expressible, not just one box. Roofs
      with real pitch. Openings placed on named walls.
   3. CONVERTIBLE TO PRODUCTION. It has to hand off to the deterministic plan
      engine in lib/design/ that already emits a dimensioned drawing. This is
      the whole point: the toy and the drawing must be the same object, or the
      "all the way to production" promise is a lie.

   FEET, everywhere, because North American residential construction is in
   feet and inches and the existing engine already speaks it. Wall thickness
   is the ONLY millimetre dimension in the system, because that is how panel
   and mass-wall products are actually specified — see lib/design/materials.ts.

   PURE DATA. No three.js types, no React, no functions with side effects.
   Geometry reads this; the plan bridge reads this; the export reads this;
   none of them may write their own concepts back into it.
   =========================================================================== */

import type { EcoMaterial, ClimateZone } from "./designApi";

/** Schema version, bumped whenever a saved spec would stop loading. Persisted
 *  with the spec so a share link from last month can be migrated rather than
 *  silently misread. */
export const SPEC_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// roofs
// ---------------------------------------------------------------------------

/**
 * The roof forms worth offering a beginner, and no more.
 *
 * Each is one that a SIP or timber shell actually builds well in a cold
 * climate, and each reads as a different HOUSE rather than a different
 * setting. Exotic forms were left out deliberately: a form nobody can price
 * is a form that breaks the promise that the toy becomes a drawing.
 */
export type RoofForm =
  /** two slopes off a central ridge — the default small-home roof */
  | "gable"
  /** the slope IS the wall, meeting near the ground: the Aura reference home */
  | "a-frame"
  /** one plane, one direction — cheapest to frame, best for a solar array */
  | "shed"
  /** near-flat with a hidden slope to drain; needs a parapet detail */
  | "flat"
  /** a gable with one long side carried further down — Nordic, and it buys
   *  a covered elevation on the weather side */
  | "saltbox";

export interface Roof {
  form: RoofForm;
  /** degrees from horizontal. Ignored for "flat" (which uses a fixed 2°
   *  drainage fall). Alberta snow load wants 25° or more for shedding. */
  pitchDeg: number;
  /** eave overhang in feet; shade in summer, weather protection always */
  overhangFt: number;
  /** which way a shed/saltbox slope faces — south puts the array in the sun */
  facing?: Wall;
}

// ---------------------------------------------------------------------------
// openings
// ---------------------------------------------------------------------------

/** The four walls of a volume, in its OWN frame before rotation. */
export type Wall = "n" | "s" | "e" | "w";

export type OpeningKind =
  | "window"
  | "door"
  /** floor-to-eave glazing — the "beautiful polycarbonate glass" wall */
  | "glazing-wall";

export interface Opening {
  id: string;
  wall: Wall;
  kind: OpeningKind;
  widthFt: number;
  heightFt: number;
  /** distance in feet from the wall's left end, looking at it from outside */
  offsetFt: number;
  /** sill height above the finished floor; 0 for doors and glazing walls */
  sillFt: number;
}

// ---------------------------------------------------------------------------
// volumes — the pieces you assemble
// ---------------------------------------------------------------------------

/**
 * One rectangular mass with its own roof.
 *
 * A house is one or more of these. Two volumes at right angles is an L-plan;
 * a small one against a big one is the Scandinavian "main house plus annexe"
 * that reads as vernacular rather than as an extension. Keeping the primitive
 * rectangular is what keeps the plan engine able to solve it — an arbitrary
 * polygon footprint would look freer and would quietly break the handoff to
 * production, which is the one thing this file exists to protect.
 */
export interface Volume {
  id: string;
  /** shown in the UI and carried into the room program as a hint */
  name: string;
  widthFt: number;
  depthFt: number;
  /** position of the volume's CENTRE on the site grid, in feet */
  x: number;
  z: number;
  /** rotation about the vertical axis, degrees clockwise from north */
  rotationDeg: number;
  storeys: 1 | 2;
  /** floor to underside of the eave, per storey */
  wallHeightFt: number;
  roof: Roof;
  openings: Opening[];
}

// ---------------------------------------------------------------------------
// the deck, because the brief says every home has one
// ---------------------------------------------------------------------------

export interface Deck {
  /** which wall of the FIRST volume it attaches to */
  wall: Wall;
  widthFt: number;
  depthFt: number;
  /** the wood-fired hot tub the brief promises on every home */
  hotTub: boolean;
}

// ---------------------------------------------------------------------------
// siting — the same facts lib/design/parcel.ts already reasons about
// ---------------------------------------------------------------------------

export interface Siting {
  /** compass bearing the front of the home faces, degrees; 180 is due south */
  frontFacesDeg: number;
  slope: "flat" | "gentle" | "steep";
}

// ---------------------------------------------------------------------------
// the spec
// ---------------------------------------------------------------------------

export interface HomeSpec {
  version: typeof SPEC_VERSION;
  name: string;
  /** decides wall thickness in mm, and therefore the plan and the price */
  material: EcoMaterial;
  climateZone: ClimateZone;
  volumes: Volume[];
  deck: Deck | null;
  siting: Siting;
  /** free text carried into the design brief */
  notes: string;
}

// ---------------------------------------------------------------------------
// derived helpers — pure, and the single definition of each quantity
// ---------------------------------------------------------------------------

/** Footprint of one volume, ignoring overlap with its neighbours. */
export const volumeFootprintSqFt = (v: Volume): number => v.widthFt * v.depthFt;

/** Total conditioned floor area: footprint times storeys, summed.
 *  This is the number handed to the plan engine as `total_sq_ft`, so it is
 *  defined once, here, and never recomputed inline anywhere else. */
export const totalFloorAreaSqFt = (spec: HomeSpec): number =>
  spec.volumes.reduce((sum, v) => sum + volumeFootprintSqFt(v) * v.storeys, 0);

/** Ground footprint — what the parcel's buildable envelope must contain.
 *  Deliberately the sum rather than a union: two volumes that overlap are a
 *  modelling mistake the UI should prevent, and silently under-reporting
 *  coverage would hide it. */
export const groundFootprintSqFt = (spec: HomeSpec): number =>
  spec.volumes.reduce((sum, v) => sum + volumeFootprintSqFt(v), 0);

/** Glazed area, used for the 22% NBC 9.36 FDWR check downstream. */
export const glazedAreaSqFt = (spec: HomeSpec): number =>
  spec.volumes.reduce(
    (sum, v) =>
      sum +
      v.openings
        .filter((o) => o.kind !== "door")
        .reduce((s, o) => s + o.widthFt * o.heightFt, 0),
    0,
  );

/** Ridge height above finished floor, for the height-limit conversation. */
export function ridgeHeightFt(v: Volume): number {
  const wall = v.wallHeightFt * v.storeys;
  const rise = (span: number, deg: number) => (span / 2) * Math.tan((deg * Math.PI) / 180);
  switch (v.roof.form) {
    case "flat":
      return wall + 0.5;
    case "shed":
      return wall + v.widthFt * Math.tan((v.roof.pitchDeg * Math.PI) / 180);
    case "a-frame":
      // the slope is the wall: the ridge is set by the span, not by a wall
      return rise(v.widthFt, v.roof.pitchDeg) * 2;
    case "saltbox":
    case "gable":
    default:
      return wall + rise(v.widthFt, v.roof.pitchDeg);
  }
}

/** A starting home that is already a real, buildable thing — the Aura
 *  reference build. Nobody should meet an empty canvas. */
export function defaultSpec(): HomeSpec {
  return {
    version: SPEC_VERSION,
    name: "My Aura home",
    material: "sip",
    climateZone: "7A",
    volumes: [
      {
        id: "main",
        name: "Main house",
        widthFt: 34,
        depthFt: 23.5,
        x: 0,
        z: 0,
        rotationDeg: 0,
        storeys: 1,
        wallHeightFt: 9.5,
        roof: { form: "gable", pitchDeg: 35, overhangFt: 1.5 },
        openings: [
          { id: "o1", wall: "s", kind: "glazing-wall", widthFt: 16, heightFt: 9, offsetFt: 9, sillFt: 0 },
          { id: "o2", wall: "s", kind: "door", widthFt: 3, heightFt: 6.8, offsetFt: 3, sillFt: 0 },
          { id: "o3", wall: "e", kind: "window", widthFt: 4, heightFt: 4, offsetFt: 8, sillFt: 3 },
          { id: "o4", wall: "w", kind: "window", widthFt: 4, heightFt: 4, offsetFt: 8, sillFt: 3 },
        ],
      },
    ],
    deck: { wall: "s", widthFt: 20, depthFt: 10, hotTub: true },
    siting: { frontFacesDeg: 180, slope: "flat" },
    notes: "",
  };
}
