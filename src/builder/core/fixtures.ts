/* ===========================================================================
   PLACEABLE FIXTURES — the eco spec, made into objects you can put somewhere.

   `spec.ts` describes the SHELL: volumes, roofs, openings, a deck, a siting.
   It deliberately says nothing about what is inside, and it should not — the
   moment a wood stove becomes a field on HomeSpec, every share link, every
   drawing sheet and every export has to migrate when somebody adds a second
   one. So fixtures live HERE, in their own set, keyed to the shell by volume
   id and wall name, and the shell never learns about them.

   WHAT THIS FILE IS FOR

     · FLOOR items constrained to a floor region and snapping to walls. The
       plant: wood stove, wood-fired hot tub, water cistern, battery bank,
       HRV. The furniture: kitchen island, counter run, range, refrigerator,
       dining table, chair, sofa, armchair, bed, bunk, wardrobe, chest of
       drawers, shelving, entry bench, firewood store, drying rack, vanity,
       toilet, shower, bath.
     · WALL items snapped along a wall's run at a height, on the inside or the
       outside face: AWG unit, electrical panel, thermostat, greywater valve,
       wall-mounted heater, coat rail. WINDOWS AND DOORS ARE NOT HERE. They are
       `HomeSpec.Opening`, they are cut into the wall by geometry.ts, they are
       counted by `glazedAreaSqFt`, and a second definition of them would put
       the FDWR check and the opening schedule into permanent disagreement.
     · ROOF items snapped onto a chosen roof plane at that plane's own pitch:
       the solar array, sized in kW and drawn at the area that many modules
       actually cover.

   CLEARANCES ARE DATA, NOT DECORATION. Every kind carries a set of
   `ClearanceRule`s: named sides, real distances, a `zone` saying what KIND of
   space it is, and a `basis` + `source` saying where the number came from.
   The resolver turns them into boxes and reports what they hit. A wood stove
   whose 48-inch clearance runs into a SIP wall is a BLOCKED issue, not a
   styling choice.

   ...AND EVERY NUMBER IS MARKED. See `SOURCE_HONESTY` below. No primary
   standard was open while this file was written, so `verifiedAgainstSource`
   is `false` on every single rule and the UI is expected to say so. A figure
   attributed to a named code is a figure someone should CHECK against the
   current edition before building; a figure with no code behind it is marked
   `indicative` and is not dressed up as one.

   MORPH, NOT SCALE. A fixture resizes by changing its NAMED dimensions and
   rebuilding. Nothing is uniformly scaled, because uniform scaling is what
   makes a 10-foot island grow 5-inch-thick countertops and a king bed grow a
   4-foot headboard. In every builder below, the detail thicknesses — counter
   slab, stove legs, sofa arms, panel door lip, PV module — are CONSTANTS, and
   only the named dimensions move.

   WHERE THAT IS ENFORCED. Two rules in tests/furniture-fixtures.spec.ts do
   most of it by derivation, and they were measured over the wrong population:
   they cover 267 of the 449 part-axes this file holds constant, and the
   thresholds cannot be widened to cover the rest without raising false alarms
   on parts that are supposed to move. So each "... is CONSTANT" comment below
   ALSO has a per-axis entry in that spec's `CONSTANT_PART_AXES`, and the spec
   reads this file as text to check that none of them is a comment on its own.
   If you write a new one, declare it there; if you delete one, delete the
   entry. A sentence in here that nothing reads is how the AWG's spout came to
   be unguarded for a whole wave.

   DETERMINISM. No `Math.random`, no `Date.now`, no network. Ids are supplied
   or derived by counting; the same set always produces the same geometry and
   the same schedule.

   LICENCE / DEPENDENCIES. Nothing new. `three` (MIT) is already a dependency
   and is the only import that is not this repo's own code.
   =========================================================================== */

import * as THREE from "three";

import type { HomeSpec, Volume, Wall } from "./spec";
import { formatFeetInchesWords } from "./units";
import {
  ARRAY_SQ_FT_PER_KW,
  DECK_STEP_FT,
  WALL_RUN_AXIS,
  rotDir,
  roofSectionFor,
  wallRunFt,
  wallThicknessFt,
  wallTopProfile,
  yawFromBearingDeg,
  type Pt,
  type RoofPlane,
  type RoofSection,
} from "./fixtureFrame";

export { ARRAY_SQ_FT_PER_KW };

/* ===========================================================================
   THE HONESTY HEADER

   This string is not decoration either — mount it above the clearance readout.
   =========================================================================== */

export const SOURCE_HONESTY =
  "No clearance figure in this tool has been checked against a primary document by this software. " +
  "Figures marked CODE name the standard they are believed to come from and must be verified against " +
  "its current edition. Figures marked GUIDELINE come from a published design guideline, not a code. " +
  "Figures marked MANUFACTURER or INDICATIVE are typical values used to draw a sensible box and carry " +
  "no regulatory weight at all. The appliance label, the installation manual, the authority having " +
  "jurisdiction and — for any solid-fuel appliance — the WETT-certified inspector govern in every case.";

/** Schema version for a saved fixture set. Bumped when an old set would stop
 *  loading, exactly as `SPEC_VERSION` is for the shell. */
export const FIXTURES_VERSION = 1 as const;

/** Query/fragment key for a fixture token, if the integrator wants fixtures in
 *  the share URL. Deliberately not `h` — the shell's token owns that. */
export const FIXTURES_PARAM = "fx";

/* ===========================================================================
   UNITS AND SMALL SHARED CONSTANTS
   =========================================================================== */

/** Everything is FEET, matching spec.ts, geometry.ts and the plan engine. */
const IN = 1 / 12;
const MM = 1 / 304.8;

/** How close a floor item has to get to a wall before it snaps flat to it. */
export const WALL_SNAP_FT = 1.25;
/** Free positions land on this grid, so two people dragging the same fixture
 *  to "the middle" get the same number. */
export const FLOOR_GRID_FT = 0.25;
/** Wall items land on this grid along the run, and at this grid in height. */
export const WALL_GRID_FT = 0.25;
/** A hair of air between a fixture and the surface it snaps to, so two faces
 *  are never exactly coplanar (coplanar faces are what z-fighting is). */
export const SNAP_GAP_FT = 0.02;

/** Water, for the hot tub and cistern load facts. Pure arithmetic. */
const WATER_LB_PER_CU_FT = 62.4;
const LITRES_PER_CU_FT = 28.3168;

/**
 * PV module used to draw an array: a common 400 W module at roughly
 * 1134 × 1722 mm. INDICATIVE — it is here so an array has an honest module
 * grain and a real footprint, not because any particular module was specified.
 * Its area (about 21 sq ft) is consistent with `ARRAY_SQ_FT_PER_KW` = 53.
 */
export const PV_MODULE_W_FT = 1134 * MM;
export const PV_MODULE_H_FT = 1722 * MM;
export const PV_MODULE_WATTS = 400;
/** Module-to-module gap, and rail standoff above the roof surface. */
const PV_GAP_FT = 0.06;
const PV_STANDOFF_FT = 0.35;
const PV_THICKNESS_FT = 0.13;
/** Beyond this the scene gets a single slab instead of modules. */
const PV_MAX_DRAWN_MODULES = 160;

/* ===========================================================================
   CLEARANCES
   =========================================================================== */

/** What kind of space a clearance is. The zone decides how loudly a conflict
 *  is reported: a combustible clearance that hits a timber wall is a BLOCK; a
 *  circulation clearance that hits a sofa is a CHECK. */
export type ClearanceZone =
  /** clearance to combustible construction — the fire one */
  | "combustible"
  /** electrical / equipment working space you must be able to stand in */
  | "working-space"
  /** room to pull a filter, a core, a lid */
  | "service"
  /** non-combustible floor protection in front of and around an appliance */
  | "floor-pad"
  /** people moving past furniture */
  | "circulation"
  /** intake and discharge air a unit needs to work at all */
  | "airflow";

export type ClearanceBasis =
  /** attributed to a named installation code or standard */
  | "code"
  /** a published design guideline, which is not a code */
  | "guideline"
  /** typical of the product class; the unit's own manual governs */
  | "manufacturer"
  /** a sensible allowance with no document behind it, and said so */
  | "indicative";

export interface ClearanceRule {
  key: string;
  label: string;
  zone: ClearanceZone;
  /** feet added on each side of the fixture body, in the fixture's own frame.
   *  front is +Z (the face you approach), back is −Z, left is −X, right is +X. */
  front: number;
  back: number;
  left: number;
  right: number;
  /** height of the clearance volume, feet. `null` means "the fixture's own
   *  height". Measured from `from`. */
  heightFt: number | null;
  /**
   * Where the clearance volume STARTS vertically. It matters: an electrical
   * working space is 2.2 m measured from the FLOOR, not 2.2 m measured from
   * wherever the panel happens to be hung, and a wall heater's overhead
   * clearance starts at the TOP of the unit. Defaulting this to "base" and
   * getting the panel wrong is exactly the sort of quiet error this file is
   * supposed to make impossible.
   */
  from: "base" | "floor" | "top";
  basis: ClearanceBasis;
  /** the document this figure is believed to come from, named in full */
  source: string;
  /**
   * ALWAYS false. No primary document was consulted while writing this file,
   * so no figure in it may be presented as verified. Typed as the literal so
   * a future edit cannot flip one to `true` without also changing the type —
   * which is the point at which somebody has to actually go and check.
   */
  verifiedAgainstSource: false;
  note: string;
}

const rule = (
  r: Omit<ClearanceRule, "verifiedAgainstSource" | "from"> & Partial<Pick<ClearanceRule, "from">>,
): ClearanceRule => ({
  from: "base",
  ...r,
  verifiedAgainstSource: false,
});

export const CLEARANCE_BASIS_LABEL: Readonly<Record<ClearanceBasis, string>> = {
  code: "CODE — verify against the current edition",
  guideline: "GUIDELINE — a design guideline, not a code",
  manufacturer: "MANUFACTURER — typical; the unit's manual governs",
  indicative: "INDICATIVE — no document behind this number",
};

/* ===========================================================================
   THE CATALOGUE
   =========================================================================== */

export type FixtureMount = "floor" | "wall" | "roof";

export type FixtureKindId =
  // floor — equipment
  | "wood-stove"
  | "hot-tub"
  | "cistern"
  | "battery-bank"
  | "hrv"
  // floor — furniture: kitchen
  | "kitchen-island"
  | "counter-run"
  | "range"
  | "refrigerator"
  // floor — furniture: eating and sitting
  | "dining-table"
  | "dining-chair"
  | "sofa"
  | "armchair"
  // floor — furniture: sleeping and storage
  | "bed"
  | "bunk"
  | "wardrobe"
  | "dresser"
  | "shelving"
  // floor — furniture: entry and utility
  | "entry-bench"
  | "firewood-store"
  | "drying-rack"
  // floor — furniture: bathroom
  | "vanity"
  | "toilet"
  | "shower"
  | "bath"
  // wall
  | "awg"
  | "electrical-panel"
  | "thermostat"
  | "greywater-valve"
  | "wall-heater"
  | "coat-rail"
  // roof
  | "solar-array";

/** A named dimension a fixture MORPHS by. Never a scale factor. */
export interface FixtureDimension {
  key: string;
  label: string;
  unit: "ft" | "kW" | "kWh" | "count";
  min: number;
  max: number;
  step: number;
  default: number;
  hint?: string;
}

/** An enumerated choice that changes what the fixture IS, not how big it is —
 *  and, for the stove, changes its clearances by a factor of four. */
export interface FixtureOption {
  key: string;
  label: string;
  choices: ReadonlyArray<{ id: string; label: string; note?: string }>;
  default: string;
  hint?: string;
}

export type Dims = Readonly<Record<string, number>>;
export type Opts = Readonly<Record<string, string>>;

/** A derived number worth putting on a schedule — a water weight, an array
 *  area, a tank volume. Computed, never stored, so it cannot go stale. */
export interface FixtureFact {
  key: string;
  label: string;
  value: number;
  unit: string;
  /** how it reads to a person */
  text: string;
  note?: string;
}

export interface FixtureKind {
  id: FixtureKindId;
  mount: FixtureMount;
  label: string;
  /** two characters for a dense palette; this repo does not use emoji */
  tag: string;
  /** one sentence: what it is, and why an Aura home has one */
  blurb: string;
  dimensions: readonly FixtureDimension[];
  options: readonly FixtureOption[];
  /** plan and height extents of the BODY, feet, from the named dimensions */
  extents: (d: Dims, o: Opts) => { widthFt: number; depthFt: number; heightFt: number };
  /** how far the base sits above the floor (a hung HRV, a wall item's sill) */
  baseHeightFt?: (d: Dims, o: Opts) => number;
  clearances: (d: Dims, o: Opts) => ClearanceRule[];
  facts: (d: Dims, o: Opts) => FixtureFact[];
  /** the low-poly object, built in the fixture's own frame: origin at the
   *  centre of its base, +Z is the face you approach, feet */
  build: (d: Dims, o: Opts, ctx: BuildContext) => FixturePart[];
}

/** What a builder is allowed to know about where it landed. Only the roof
 *  array needs it, and only to lay modules out on the right plan axis. */
export interface BuildContext {
  fallAxis: "x" | "z";
}

const DEFAULT_CTX: BuildContext = { fallAxis: "x" };

/* ---------------------------------------------------------------- geometry */

export type FixtureSurface =
  /** matte black cast iron / firebox */
  | "stove"
  /** galvanized or stainless appliance metal */
  | "steel"
  /** a painted equipment enclosure */
  | "cabinet"
  /** cedar, oak, any timber */
  | "wood"
  /** upholstery and mattress */
  | "fabric"
  /** vitreous china and the acrylic that imitates it: basins, pans, trays */
  | "porcelain"
  /** water in a tub or a cistern */
  | "water"
  /** PV module glass */
  | "pv"
  /** a lens, a screen, a gauge */
  | "glass"
  /** a clearance volume that is satisfied */
  | "clearance"
  /** a clearance volume that is not */
  | "clearance-alert";

export interface FixturePart {
  /** suffix only; the resolver prefixes it with the fixture id */
  id: string;
  surface: FixtureSurface;
  geometry: THREE.BufferGeometry;
}

const box = (
  w: number,
  h: number,
  d: number,
  cx = 0,
  cy = 0,
  cz = 0,
): THREE.BufferGeometry =>
  new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)).translate(cx, cy, cz);

const cyl = (
  r: number,
  h: number,
  cx = 0,
  cy = 0,
  cz = 0,
  seg = 14,
): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(Math.max(0.01, r), Math.max(0.01, r), Math.max(0.01, h), seg, 1).translate(cx, cy, cz);

const part = (id: string, surface: FixtureSurface, geometry: THREE.BufferGeometry): FixturePart => ({
  id,
  surface,
  geometry,
});

const num = (d: Dims, key: string, fallback: number): number => {
  const v = d[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

const opt = (o: Opts, key: string, fallback: string): string => {
  const v = o[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
};

/* ---------------------------------------------------------- FLOOR: stove */

/**
 * The wood stove, and the only fixture in this file whose clearances change
 * the plan rather than decorate it.
 *
 * The four numbers below are the ones a WETT-certified inspector is checking
 * against CAN/CSA-B365, and they are the reason the clearance box is drawn at
 * all: 48 inches of empty air around an unlisted radiant stove is a large
 * piece of a small cabin, and finding that out on the drawing is very much
 * cheaper than finding it out on inspection day.
 *
 * READ THE NOTES. A LISTED appliance is governed by its own label and its own
 * installation manual — full stop — and the 18-inch default this tool draws
 * for one is a placeholder for the label figure, not a substitute for it.
 */
const woodStove: FixtureKind = {
  id: "wood-stove",
  mount: "floor",
  label: "Wood stove",
  tag: "WS",
  blurb:
    "The heat source an off-grid home can run with nothing arriving down a wire. It also brings the largest clearance in the house.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.4, max: 3.5, step: 0.05, default: 2.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 1.2, max: 3.0, step: 0.05, default: 1.7 },
    { key: "heightFt", label: "Body height", unit: "ft", min: 1.6, max: 4.0, step: 0.05, default: 2.2, hint: "to the top plate, legs excluded" },
  ],
  options: [
    {
      key: "listing",
      label: "Listing",
      default: "listed",
      hint: "The single fact that decides the clearance.",
      choices: [
        { id: "listed", label: "Listed appliance", note: "Certified to a recognised standard; the LABEL carries the clearance." },
        { id: "unlisted", label: "Unlisted appliance", note: "A shop-built or uncertified stove; the code's blanket clearance applies." },
      ],
    },
    {
      key: "shield",
      label: "Wall shielding",
      default: "none",
      choices: [
        { id: "none", label: "No shield" },
        { id: "listed-shield", label: "Listed / spaced shield", note: "A reduction the code permits only for a shield built to its own rules." },
      ],
    },
  ],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 2.0),
    depthFt: num(d, "depthFt", 1.7),
    heightFt: num(d, "heightFt", 2.2) + STOVE_LEG_FT,
  }),
  clearances: (_d, o) => {
    const listed = opt(o, "listing", "listed") === "listed";
    const shielded = opt(o, "shield", "none") === "listed-shield";
    const body = listed
      ? 18 * IN
      : shielded
        ? 450 * MM
        : 1200 * MM;
    const bodyNote = listed
      ? "PLACEHOLDER for the figure on this appliance's own label. A listed stove's clearance is whatever its listing says — often far less than this, occasionally more. Replace it with the label figure before anybody builds to it."
      : shielded
        ? "The reduced clearance an unlisted appliance is allowed only behind a shield built exactly to the code's shielding rules — correct material, correct air space, correct edge ventilation. A sheet of steel screwed to the wall is not one."
        : "The blanket clearance for an unlisted radiant solid-fuel appliance. It is large, it is the reason a small cabin plan moves the stove, and it is not negotiable without a listed shield or a listed appliance.";
    return [
      rule({
        key: "combustible",
        label: listed ? "To combustibles (label figure)" : "To combustibles",
        zone: "combustible",
        front: body,
        back: body,
        left: body,
        right: body,
        heightFt: null,
        basis: "code",
        source: "CAN/CSA-B365, Installation Code for Solid-Fuel-Burning Appliances and Equipment (Alberta's WETT inspections are carried out against it)",
        note: bodyNote,
      }),
      rule({
        key: "floor-pad",
        label: "Non-combustible floor protection",
        zone: "floor-pad",
        front: 450 * MM,
        back: 200 * MM,
        left: 200 * MM,
        right: 200 * MM,
        heightFt: 0.12,
        basis: "code",
        source: "CAN/CSA-B365 floor-protection extension (the same figures appear in NFPA 211)",
        note:
          "450 mm in front of the fuel-loading door, 200 mm at the sides and rear. The pad's required R-value or thickness is a separate question this tool does not answer — it draws the EXTENT only.",
      }),
      rule({
        key: "connector",
        label: "Single-wall flue connector to combustibles",
        zone: "combustible",
        front: 0,
        back: 0,
        left: 0,
        right: 0,
        heightFt: null,
        basis: "code",
        source: "CAN/CSA-B365, chimney-connector clearance",
        note:
          "450 mm from single-wall connector pipe to any combustible surface. It is listed here as a fact to check, not drawn as a box: this tool does not model the flue route, and drawing a clearance around a pipe it did not route would be an invention.",
      }),
    ];
  },
  facts: (_d, o) => {
    const listed = opt(o, "listing", "listed") === "listed";
    return [
      {
        key: "wett",
        label: "Inspection",
        value: 1,
        unit: "",
        text: listed ? "Listed appliance — WETT inspection to the label" : "Unlisted appliance — WETT inspection to the code's blanket clearance",
        note: "An insurer in Alberta will normally ask for a WETT inspection report on any solid-fuel appliance.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 2.0);
    const dp = num(d, "depthFt", 1.7);
    const h = num(d, "heightFt", 2.2);
    const parts: FixturePart[] = [];
    // Legs and the top plate are CONSTANT: a taller firebox does not get
    // taller legs. This is the morph rule, visible.
    const legY = STOVE_LEG_FT;
    parts.push(part("body", "stove", box(w, h - STOVE_TOP_FT, dp, 0, legY + (h - STOVE_TOP_FT) / 2, 0)));
    parts.push(part("top", "stove", box(w + 0.12, STOVE_TOP_FT, dp + 0.12, 0, legY + h - STOVE_TOP_FT / 2, 0)));
    const lx = w / 2 - 0.16;
    const lz = dp / 2 - 0.16;
    parts.push(part("leg-a", "stove", box(0.14, legY, 0.14, lx, legY / 2, lz)));
    parts.push(part("leg-b", "stove", box(0.14, legY, 0.14, -lx, legY / 2, lz)));
    parts.push(part("leg-c", "stove", box(0.14, legY, 0.14, lx, legY / 2, -lz)));
    parts.push(part("leg-d", "stove", box(0.14, legY, 0.14, -lx, legY / 2, -lz)));
    // The door is on the front (+Z), which is what makes the 450 mm pad
    // extension "in front of the fuel-loading door" mean something.
    parts.push(part("door", "glass", box(w * 0.6, (h - STOVE_TOP_FT) * 0.55, 0.06, 0, legY + (h - STOVE_TOP_FT) * 0.5, dp / 2 + 0.02)));
    parts.push(part("flue", "steel", cyl(STOVE_FLUE_R_FT, STOVE_FLUE_FT, 0, legY + h + STOVE_FLUE_FT / 2, -dp * 0.15, 12)));
    return parts;
  },
};

const STOVE_LEG_FT = 0.4;
const STOVE_TOP_FT = 0.14;
const STOVE_FLUE_FT = 3.0;
const STOVE_FLUE_R_FT = 3.5 * IN;

/* --------------------------------------------------------- FLOOR: hot tub */

const hotTub: FixtureKind = {
  id: "hot-tub",
  mount: "floor",
  label: "Wood-fired hot tub",
  tag: "HT",
  blurb:
    "The one on the deck of every Aura render. Placed here it becomes a load and a clearance rather than a picture.",
  dimensions: [
    { key: "diameterFt", label: "Diameter", unit: "ft", min: 4, max: 8, step: 0.1, default: 6.0 },
    { key: "heightFt", label: "Height", unit: "ft", min: 2.4, max: 4.2, step: 0.05, default: 3.2 },
    { key: "waterDepthFt", label: "Water depth", unit: "ft", min: 1.5, max: 3.6, step: 0.05, default: 2.6 },
  ],
  options: [],
  extents: (d) => {
    const dia = num(d, "diameterFt", 6);
    return { widthFt: dia, depthFt: dia + TUB_STOVE_FT, heightFt: num(d, "heightFt", 3.2) };
  },
  clearances: () => [
    rule({
      key: "snorkel",
      label: "Around the submerged / snorkel stove",
      zone: "combustible",
      front: 2.0,
      back: 0.5,
      left: 0.5,
      right: 0.5,
      heightFt: null,
      basis: "manufacturer",
      source: "wood-fired tub manufacturers' installation sheets (Snorkel, Alumitub and similar)",
      note:
        "Wood-fired tubs carry a firebox, a chimney and a stack that gets hot. The real figure is on the tub's own sheet and differs between a submerged snorkel and an external stove; this box is a typical allowance so the tub is not drawn tight against a rail.",
    }),
    rule({
      key: "access",
      label: "Access and entry",
      zone: "circulation",
      front: 1.5,
      back: 1.0,
      left: 1.0,
      right: 1.0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for getting in, out and around",
      note: "Room to step in, and to get at the tub to drain and clean it.",
    }),
  ],
  facts: (d) => {
    const dia = num(d, "diameterFt", 6);
    const depth = Math.min(num(d, "waterDepthFt", 2.6), num(d, "heightFt", 3.2) - 0.3);
    const volFt3 = Math.PI * (dia / 2) * (dia / 2) * Math.max(0, depth);
    const lb = volFt3 * WATER_LB_PER_CU_FT;
    const footprint = Math.PI * (dia / 2) * (dia / 2);
    const psf = footprint > 0 ? lb / footprint : 0;
    return [
      {
        key: "volume",
        label: "Water volume",
        value: volFt3 * LITRES_PER_CU_FT,
        unit: "L",
        text: `${Math.round(volFt3 * LITRES_PER_CU_FT).toLocaleString("en-CA")} L (${Math.round(volFt3 * 7.48052)} US gal)`,
      },
      {
        key: "load",
        label: "Water weight",
        value: lb,
        unit: "lb",
        text: `${Math.round(lb).toLocaleString("en-CA")} lb — about ${Math.round(psf)} lb/sq ft over the tub footprint, water alone`,
        note:
          "Water only: the tub, its stove and the people in it are on top of this. A residential deck is commonly designed for 40 lb/sq ft, so a filled tub normally needs its own beams or its own piles. That is a question for the P.Eng who seals the pile design, and this number exists to make sure the question gets asked.",
      },
    ];
  },
  build: (d) => {
    const dia = num(d, "diameterFt", 6);
    const h = num(d, "heightFt", 3.2);
    const depth = Math.min(num(d, "waterDepthFt", 2.6), h - 0.3);
    const r = dia / 2;
    // The stove hangs off the front, so the whole assembly is shifted back by
    // half its depth to keep the fixture's origin at the CENTRE of its stated
    // extents. Without this the body box would sit 8 inches off the object.
    const zc = -TUB_STOVE_FT / 2;
    return [
      part("shell", "wood", cyl(r, h, 0, h / 2, zc, 16)),
      // The rim band is CONSTANT thickness — a wider tub gets a wider tub, not
      // a chunkier rim.
      part("rim", "wood", cyl(r + 0.08, TUB_RIM_FT, 0, h - TUB_RIM_FT / 2, zc, 16)),
      part("water", "water", cyl(r - 0.12, 0.06, 0, Math.max(0.1, depth), zc, 16)),
      part("stove", "steel", cyl(TUB_STOVE_FT / 2, h * 0.85, 0, h * 0.425, zc + r + TUB_STOVE_FT / 2, 10)),
      part("stack", "steel", cyl(0.2, 2.4, 0, h * 0.85 + 1.2, zc + r + TUB_STOVE_FT / 2, 8)),
    ];
  },
};

const TUB_RIM_FT = 0.22;
const TUB_STOVE_FT = 1.3;

/* --------------------------------------------------------- FLOOR: cistern */

const cistern: FixtureKind = {
  id: "cistern",
  mount: "floor",
  label: "Water cistern",
  tag: "CI",
  blurb: "Stored water, which off grid is the difference between a home and a campsite.",
  dimensions: [
    { key: "diameterFt", label: "Diameter", unit: "ft", min: 2.5, max: 10, step: 0.1, default: 6.0 },
    { key: "heightFt", label: "Height", unit: "ft", min: 3, max: 8, step: 0.1, default: 6.0 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "diameterFt", 6),
    depthFt: num(d, "diameterFt", 6),
    heightFt: num(d, "heightFt", 6),
  }),
  clearances: () => [
    rule({
      key: "service",
      label: "Service and hatch access",
      zone: "service",
      front: 2.0,
      back: 0.5,
      left: 0.5,
      right: 0.5,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for reaching the hatch, the fittings and the pump",
      note:
        "A cistern needs to be opened, inspected and cleaned. This is not a code figure; a potable-water installation also has siting rules this tool does not model.",
    }),
  ],
  facts: (d) => {
    const dia = num(d, "diameterFt", 6);
    const h = num(d, "heightFt", 6);
    // Usable volume stops short of the very top: an air gap over stored water
    // is normal practice, and quoting the geometric volume would overstate it.
    const usableH = Math.max(0, h - 0.5);
    const volFt3 = Math.PI * (dia / 2) * (dia / 2) * usableH;
    const litres = volFt3 * LITRES_PER_CU_FT;
    return [
      {
        key: "capacity",
        label: "Usable capacity",
        value: litres,
        unit: "L",
        text: `${Math.round(litres).toLocaleString("en-CA")} L (${Math.round(volFt3 * 7.48052).toLocaleString("en-CA")} US gal)`,
        note: "Geometric volume less a 6-inch air gap at the top. Not a certified tank capacity.",
      },
      {
        key: "load",
        label: "Full weight",
        value: volFt3 * WATER_LB_PER_CU_FT,
        unit: "lb",
        text: `${Math.round(volFt3 * WATER_LB_PER_CU_FT).toLocaleString("en-CA")} lb full — water alone`,
        note: "A full cistern is one of the heaviest single objects in the house. Its position is a structural decision.",
      },
    ];
  },
  build: (d) => {
    const dia = num(d, "diameterFt", 6);
    const h = num(d, "heightFt", 6);
    const r = dia / 2;
    return [
      part("tank", "cabinet", cyl(r, h, 0, h / 2, 0, 16)),
      // Hatch and outlet are CONSTANT: a bigger tank does not get a bigger lid.
      part("hatch", "cabinet", cyl(0.75, 0.22, 0, h + 0.11, 0, 12)),
      part("outlet", "steel", box(0.4, 0.4, 0.35, 0, 0.55, r + 0.1)),
    ];
  },
};

/* ---------------------------------------------------- FLOOR: battery bank */

const batteryBank: FixtureKind = {
  id: "battery-bank",
  mount: "floor",
  label: "Battery bank",
  tag: "BB",
  blurb: "Where the array's afternoon goes so it can be somebody's evening.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.2, max: 6, step: 0.05, default: 2.2 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 0.7, max: 2.5, step: 0.05, default: 1.1 },
    { key: "heightFt", label: "Height", unit: "ft", min: 1.5, max: 7, step: 0.05, default: 4.0 },
    { key: "kwh", label: "Capacity", unit: "kWh", min: 5, max: 80, step: 0.5, default: 20 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 2.2),
    depthFt: num(d, "depthFt", 1.1),
    heightFt: num(d, "heightFt", 4.0),
  }),
  clearances: (d) => [
    rule({
      key: "working",
      label: "Working space in front",
      zone: "working-space",
      front: 1000 * MM, // 1 m
      back: 0,
      left: 0.25,
      right: 0.25,
      heightFt: 2200 * MM,
      from: "floor",
      basis: "code",
      source:
        "Canadian Electrical Code (CSA C22.1) Rule 2-308, working space about electrical equipment — cited by name, figure not verified",
      note:
        "1 m of working space in front of equipment likely to require examination while energised. An energy-storage installation ALSO falls under CEC Section 64 and, where the AHJ adopts it, NFPA 855 — both of which add siting, separation and fire-detection requirements this tool does not model and does not pretend to.",
    }),
    rule({
      key: "ventilation",
      label: "Ventilation and side clearance",
      zone: "airflow",
      front: 0,
      back: 0,
      left: 0.5,
      right: 0.5,
      heightFt: Math.max(0.5, num(d, "heightFt", 4.0) + 1.0),
      basis: "manufacturer",
      source: "battery cabinet installation manuals",
      note: "Typical. Every chemistry and every cabinet has its own figure, and a lithium unit's manual is the authority.",
    }),
  ],
  facts: (d) => {
    const kwh = num(d, "kwh", 20);
    return [
      {
        key: "kwh",
        label: "Nameplate capacity",
        value: kwh,
        unit: "kWh",
        text: `${kwh} kWh nameplate`,
        note:
          "Nameplate, not usable. Usable energy depends on the depth of discharge the chemistry and the warranty allow, and cold cuts into it — which in Alberta is the whole question.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 2.2);
    const dp = num(d, "depthFt", 1.1);
    const h = num(d, "heightFt", 4.0);
    return [
      part("plinth", "steel", box(w, BATT_PLINTH_FT, dp, 0, BATT_PLINTH_FT / 2, 0)),
      part("cabinet", "cabinet", box(w, h - BATT_PLINTH_FT, dp, 0, BATT_PLINTH_FT + (h - BATT_PLINTH_FT) / 2, 0)),
      // Door lip and status strip are CONSTANT — this is a taller cabinet, not
      // a bigger photograph of a cabinet.
      part("door", "cabinet", box(w - 0.16, h - BATT_PLINTH_FT - 0.2, 0.05, 0, BATT_PLINTH_FT + (h - BATT_PLINTH_FT) / 2, dp / 2 + 0.03)),
      part("status", "glass", box(0.5, 0.14, 0.04, w / 2 - 0.45, h - 0.4, dp / 2 + 0.05)),
    ];
  },
};

const BATT_PLINTH_FT = 0.12;

/* ------------------------------------------------------------- FLOOR: HRV */

const hrv: FixtureKind = {
  id: "hrv",
  mount: "floor",
  label: "HRV unit",
  tag: "HR",
  blurb:
    "A house this tight has to breathe on purpose. The HRV is how, and it needs to be reachable to change a filter.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.4, max: 3.5, step: 0.05, default: 2.2 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 1.0, max: 2.5, step: 0.05, default: 1.6 },
    { key: "heightFt", label: "Height", unit: "ft", min: 1.0, max: 2.5, step: 0.05, default: 1.5 },
    { key: "mountHeightFt", label: "Mount height", unit: "ft", min: 0, max: 8, step: 0.1, default: 6.0, hint: "0 stands it on the floor; higher hangs it" },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 2.2),
    depthFt: num(d, "depthFt", 1.6),
    heightFt: num(d, "heightFt", 1.5),
  }),
  baseHeightFt: (d) => Math.max(0, num(d, "mountHeightFt", 6.0)),
  clearances: () => [
    rule({
      key: "service",
      label: "Service face",
      zone: "service",
      front: 2.0,
      back: 0,
      left: 0.5,
      right: 0.5,
      heightFt: null,
      basis: "manufacturer",
      source: "HRV installation manuals (Venmar, Fantech, Lifebreath and similar)",
      note:
        "Room to open the unit and pull both filters and the core. Manuals commonly ask for around 600 mm at the service face; this box is 2 ft. The unit's own manual governs.",
    }),
    rule({
      key: "reach",
      label: "Standing room under a hung unit",
      zone: "service",
      front: 2.0,
      back: 0,
      left: 0.5,
      right: 0.5,
      heightFt: null,
      from: "floor",
      basis: "indicative",
      source: "none — the floor somebody has to stand on to reach a hung unit",
      note:
        "Measured from the FLOOR up, so a hung HRV over a kitchen island shows the conflict it really has: the unit fits, the person changing its filter does not.",
    }),
  ],
  facts: () => [
    {
      key: "balance",
      label: "Commissioning",
      value: 0,
      unit: "",
      text: "Airflow must be balanced on commissioning",
      note: "An HRV that has never been balanced is a fan. The balance report is a real deliverable, not a formality.",
    },
  ],
  build: (d) => {
    const w = num(d, "widthFt", 2.2);
    const dp = num(d, "depthFt", 1.6);
    const h = num(d, "heightFt", 1.5);
    return [
      part("case", "steel", box(w, h, dp, 0, h / 2, 0)),
      part("door", "steel", box(w - 0.14, h - 0.14, 0.05, 0, h / 2, dp / 2 + 0.03)),
      // Duct stubs are 6-inch nominal whatever the box is. Constant, on purpose.
      part("duct-a", "steel", cyl(HRV_DUCT_R_FT, 0.5, w * 0.28, h + 0.25, 0, 10)),
      part("duct-b", "steel", cyl(HRV_DUCT_R_FT, 0.5, -w * 0.28, h + 0.25, 0, 10)),
    ];
  },
};

const HRV_DUCT_R_FT = 3 * IN;

/* ------------------------------------------------------ FLOOR: island/bed/sofa */

const kitchenIsland: FixtureKind = {
  id: "kitchen-island",
  mount: "floor",
  label: "Kitchen island",
  tag: "KI",
  blurb: "The piece of furniture that decides whether a small plan works.",
  dimensions: [
    { key: "widthFt", label: "Length", unit: "ft", min: 3, max: 12, step: 0.1, default: 6.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 2, max: 4.5, step: 0.05, default: 3.0 },
    { key: "heightFt", label: "Counter height", unit: "ft", min: 2.6, max: 3.6, step: 0.02, default: 3.0, hint: "3 ft is the standard 36 in counter" },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 6),
    depthFt: num(d, "depthFt", 3),
    heightFt: num(d, "heightFt", 3),
  }),
  clearances: () => [
    rule({
      key: "work-aisle",
      label: "Work aisle (cook side)",
      zone: "circulation",
      front: 42 * IN,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "guideline",
      source: "NKBA Kitchen Planning Guidelines — a design guideline, not a building code",
      note: "42 in between the island and the run behind the cook, so a body and an open oven door fit in the same aisle.",
    }),
    rule({
      key: "walkway",
      label: "Walkway (other three sides)",
      zone: "circulation",
      front: 0,
      back: 36 * IN,
      left: 36 * IN,
      right: 36 * IN,
      heightFt: null,
      basis: "guideline",
      source: "NKBA Kitchen Planning Guidelines — a design guideline, not a building code",
      note: "36 in for a walkway with no work happening in it.",
    }),
  ],
  facts: (d) => {
    const w = num(d, "widthFt", 6);
    const dp = num(d, "depthFt", 3);
    return [
      {
        key: "counter",
        label: "Counter area",
        value: w * dp,
        unit: "sq ft",
        text: `${(w * dp).toFixed(1)} sq ft of counter`,
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 6);
    const dp = num(d, "depthFt", 3);
    const h = num(d, "heightFt", 3);
    // The counter slab and its overhang are CONSTANT. Uniform scaling is what
    // gives a 12-foot island a 3-inch-thick countertop; this does not.
    return [
      part("base", "cabinet", box(w - 2 * ISLAND_OVERHANG_FT, h - ISLAND_SLAB_FT, dp - 2 * ISLAND_OVERHANG_FT, 0, (h - ISLAND_SLAB_FT) / 2, 0)),
      part("counter", "steel", box(w, ISLAND_SLAB_FT, dp, 0, h - ISLAND_SLAB_FT / 2, 0)),
      part("toe", "cabinet", box(w - 2 * ISLAND_OVERHANG_FT - 0.2, ISLAND_TOE_FT, dp - 2 * ISLAND_OVERHANG_FT - 0.2, 0, ISLAND_TOE_FT / 2, 0)),
    ];
  },
};

const ISLAND_SLAB_FT = 0.13;
const ISLAND_OVERHANG_FT = 0.1;
const ISLAND_TOE_FT = 0.35;

const bed: FixtureKind = {
  id: "bed",
  mount: "floor",
  label: "Bed",
  tag: "BD",
  blurb: "The object that decides whether a bedroom is a bedroom or a corridor with a mattress in it.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 3, max: 7, step: 1 / 12, default: 5.0, hint: "double 4 ft 6, queen 5 ft 0, king 6 ft 4" },
    { key: "lengthFt", label: "Length", unit: "ft", min: 6, max: 7.5, step: 1 / 12, default: 80 * IN },
    { key: "heightFt", label: "Mattress top", unit: "ft", min: 1.2, max: 3, step: 0.05, default: 2.0 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 5),
    depthFt: num(d, "lengthFt", 80 * IN),
    heightFt: num(d, "heightFt", 2.0) + BED_HEADBOARD_FT,
  }),
  clearances: () => [
    rule({
      key: "sides",
      label: "Getting in and out",
      zone: "circulation",
      front: 2.0,
      back: 0,
      left: 2.0,
      right: 2.0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for making the bed and walking past it",
      note: "Not a code figure. It is the number that stops a plan from putting a queen bed 14 inches from a wall.",
    }),
  ],
  facts: (d) => {
    const w = num(d, "widthFt", 5);
    return [
      {
        key: "size",
        label: "Nominal size",
        value: w,
        unit: "ft",
        text:
          w >= 6 ? "King-ish" : w >= 4.9 ? "Queen-ish" : w >= 4.4 ? "Double-ish" : "Single-ish",
        note: "Named by width only. Mattress naming is not standardised across manufacturers.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 5);
    const l = num(d, "lengthFt", 80 * IN);
    const h = num(d, "heightFt", 2.0);
    // Headboard and mattress thickness are CONSTANT.
    return [
      part("base", "wood", box(w, Math.max(0.2, h - BED_MATTRESS_FT), l, 0, Math.max(0.1, (h - BED_MATTRESS_FT) / 2), 0)),
      part("mattress", "fabric", box(w - 0.1, BED_MATTRESS_FT, l - 0.1, 0, h - BED_MATTRESS_FT / 2, 0)),
      // The head is at −Z: the fixture's front (+Z) is the foot, which is the
      // side you approach.
      part("headboard", "wood", box(w, BED_HEADBOARD_FT + h * 0.4, 0.2, 0, h * 0.6 + (BED_HEADBOARD_FT + h * 0.4) / 2, -l / 2 - 0.1)),
      part("pillow", "fabric", box(w - 0.6, 0.3, 1.2, 0, h + 0.15, -l / 2 + 0.9)),
    ];
  },
};

const BED_MATTRESS_FT = 0.75;
const BED_HEADBOARD_FT = 1.2;

const sofa: FixtureKind = {
  id: "sofa",
  mount: "floor",
  label: "Sofa",
  tag: "SF",
  blurb: "Where the glazing wall gets looked at from.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 4, max: 12, step: 0.1, default: 7.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 2.4, max: 4.5, step: 0.05, default: 3.2 },
    { key: "heightFt", label: "Back height", unit: "ft", min: 2.0, max: 3.4, step: 0.05, default: 2.7 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 7),
    depthFt: num(d, "depthFt", 3.2),
    heightFt: num(d, "heightFt", 2.7),
  }),
  clearances: () => [
    rule({
      key: "front",
      label: "Legroom and passage",
      zone: "circulation",
      front: 2.5,
      back: 0,
      left: 0.5,
      right: 0.5,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for legs, a coffee table and a route past",
      note: "Not a code figure.",
    }),
  ],
  facts: () => [],
  build: (d) => {
    const w = num(d, "widthFt", 7);
    const dp = num(d, "depthFt", 3.2);
    const h = num(d, "heightFt", 2.7);
    // Arms, seat height and seat thickness are CONSTANT: a longer sofa is a
    // longer sofa, not a bigger one.
    const inner = Math.max(1.0, w - 2 * SOFA_ARM_FT);
    return [
      part("plinth", "wood", box(w, SOFA_SEAT_Y_FT - SOFA_SEAT_FT, dp - 0.3, 0, (SOFA_SEAT_Y_FT - SOFA_SEAT_FT) / 2, 0.1)),
      part("seat", "fabric", box(inner, SOFA_SEAT_FT, dp - 0.5, 0, SOFA_SEAT_Y_FT - SOFA_SEAT_FT / 2, 0.15)),
      part("back", "fabric", box(w, h - (SOFA_SEAT_Y_FT - SOFA_SEAT_FT), SOFA_BACK_FT, 0, (h + SOFA_SEAT_Y_FT - SOFA_SEAT_FT) / 2, -dp / 2 + SOFA_BACK_FT / 2)),
      part("arm-l", "fabric", box(SOFA_ARM_FT, SOFA_ARM_Y_FT, dp - 0.2, -(w - SOFA_ARM_FT) / 2, SOFA_ARM_Y_FT / 2, 0.05)),
      part("arm-r", "fabric", box(SOFA_ARM_FT, SOFA_ARM_Y_FT, dp - 0.2, (w - SOFA_ARM_FT) / 2, SOFA_ARM_Y_FT / 2, 0.05)),
    ];
  },
};

const SOFA_ARM_FT = 0.55;
const SOFA_ARM_Y_FT = 2.0;
const SOFA_SEAT_Y_FT = 1.4;
const SOFA_SEAT_FT = 0.45;
const SOFA_BACK_FT = 0.4;

/* ===========================================================================
   FLOOR: THE FURNITURE PROPER

   Everything above this line is plant: it heats, stores, generates or moves
   something. What follows is what a person actually puts in the rooms, and it
   is here for the same reason the stove is — because a small house is decided
   by what fits, and a piece of furniture with an honest footprint and an
   honest clearance is a fact about the plan rather than a picture of one.
   40 sq ft of bed, chair and table in a 500 sq ft cabin is 8% of the floor.

   THE HOUSE THESE ARE FOR. Small, cold, often off grid. That is not a mood:
   it is why a firewood store is a fixture, why the entry bench has a shelf
   under it, why the drying rack carries a moisture fact and not a picture of
   a towel, why the table has a work end, and why the toilet has a composting
   option whose facts talk about temperature. Anything that could go in any
   house anywhere has been given the reason it belongs in THIS one, in its
   `blurb`, and if a piece could not be given one it is not in the file.

   EVERY NUMBER IS STILL MARKED. Almost nothing here is code. Kitchen and
   bathroom figures that come from the NKBA's published planning guidelines
   are marked `guideline` and name them; the rest — chair pull-outs, drawer
   fronts, ladder room — are `indicative`, because no document was open and
   pretending otherwise would be worse than the missing citation. The single
   exception is a wood cookstove, which is a solid-fuel appliance and carries
   the same CAN/CSA-B365 clearance the wood stove above does, cited the same
   way and just as unverified.
   =========================================================================== */

/* ------------------------------------------------------ FLOOR: dining table */

/* Constant sections. A ten-foot table has the same 1 1/2-inch top and the same
   leg as a three-foot one; only the named dimensions move. */
const DINING_TOP_FT = 0.12;
const DINING_APRON_FT = 0.3;
const DINING_LEG_FT = 0.24;
/** Table edge a person needs to eat at. 24 in is close and friendly; 30 in is
 *  comfortable. Used to count seats, and stated in the fact's note. */
const DINING_SEAT_PITCH_FT = 2.0;
/** Below this width nobody sits at the ends — their knees meet in the middle. */
const DINING_END_MIN_FT = 2.5;

const diningTable: FixtureKind = {
  id: "dining-table",
  mount: "floor",
  label: "Dining table",
  tag: "DT",
  blurb:
    "The surface a small home eats at, works at and spreads a drawing over, which is why it is usually the piece that has to be bigger than it looks.",
  dimensions: [
    { key: "lengthFt", label: "Length", unit: "ft", min: 2.5, max: 10, step: 0.1, default: 6.0 },
    { key: "widthFt", label: "Width", unit: "ft", min: 2.2, max: 4.5, step: 0.05, default: 3.0, hint: "under 2 ft 6 nobody sits at the ends" },
    { key: "heightFt", label: "Height", unit: "ft", min: 2.2, max: 3.2, step: 0.02, default: 2.5, hint: "2 ft 6 is the standard 30 in dining height" },
  ],
  options: [
    {
      key: "duty",
      label: "What it does",
      default: "dining-and-work",
      hint: "In a house this size the table is normally both, and the difference is a chair that never gets pushed back in.",
      choices: [
        { id: "dining", label: "Dining only" },
        {
          id: "dining-and-work",
          label: "Dining and work",
          note: "One end holds a laptop, a lamp and a chair all week. It seats one fewer at dinner and it needs that end's floor kept clear.",
        },
      ],
    },
  ],
  // Length runs along the fixture's X, so it is the `widthFt` EXTENT — the same
  // convention the bed uses, where the mattress length is the depth.
  extents: (d) => ({
    widthFt: num(d, "lengthFt", 6),
    depthFt: num(d, "widthFt", 3),
    heightFt: num(d, "heightFt", 2.5),
  }),
  clearances: (_d, o) => {
    const rules = [
      rule({
        key: "chair-pull",
        label: "Chair pull-out and the route past",
        zone: "circulation",
        front: 36 * IN,
        back: 36 * IN,
        left: 36 * IN,
        right: 36 * IN,
        heightFt: null,
        basis: "indicative",
        source: "none — a working allowance for a chair coming back and a person getting past behind it",
        note:
          "About 24 in for the chair to come out and about a foot to edge past behind it. It is the figure furniture layout normally works to, no document was consulted for it, and that is exactly why it is marked indicative rather than dressed up as a guideline.",
      }),
    ];
    if (opt(o, "duty", "dining-and-work") === "dining-and-work") {
      rules.push(
        rule({
          key: "work-end",
          label: "Work end, permanently occupied",
          zone: "circulation",
          front: 0,
          back: 0,
          left: 2.5,
          right: 0,
          heightFt: null,
          basis: "indicative",
          source: "none — the floor a chair that never goes back in actually stands on",
          note:
            "A table that is also the desk has one end that is never clear. Drawing it means the plan reckons with the chair that lives there rather than with the tidy photograph.",
        }),
      );
    }
    return rules;
  },
  facts: (d, o) => {
    const len = num(d, "lengthFt", 6);
    const wid = num(d, "widthFt", 3);
    const sides = Math.max(0, Math.floor(len / DINING_SEAT_PITCH_FT)) * 2;
    const ends = wid >= DINING_END_MIN_FT ? 2 : 0;
    const seats = sides + ends;
    const working = opt(o, "duty", "dining-and-work") === "dining-and-work" ? 1 : 0;
    const facts: FixtureFact[] = [
      {
        key: "seats",
        label: "Seats",
        value: Math.max(0, seats - working),
        unit: "",
        text:
          working > 0
            ? `${Math.max(0, seats - working)} at dinner — ${seats} if the work end is cleared`
            : `${seats}`,
        note: `Counted at ${feetInches(DINING_SEAT_PITCH_FT)} of table edge a person, which is close; 30 in each is comfortable. The ends only count once the table is ${feetInches(DINING_END_MIN_FT)} wide.`,
      },
    ];
    if (working > 0) {
      facts.push({
        key: "duty",
        label: "Double duty",
        value: 0,
        unit: "",
        text: "The desk and the dining table are the same object",
        note:
          "It is the normal arrangement in a small home and it is worth drawing rather than assuming: the work end is floor that is occupied on a Tuesday afternoon, and dinner for six means clearing it first.",
      });
    }
    return facts;
  },
  build: (d) => {
    const l = num(d, "lengthFt", 6);
    const w = num(d, "widthFt", 3);
    const h = num(d, "heightFt", 2.5);
    // Top, apron and legs are CONSTANT sections: a longer table is a longer
    // table, not a chunkier one.
    const inset = DINING_LEG_FT / 2 + 0.22;
    const legH = h - DINING_TOP_FT;
    const lx = Math.max(0, l / 2 - inset);
    const lz = Math.max(0, w / 2 - inset);
    const parts: FixturePart[] = [
      part("top", "wood", box(l, DINING_TOP_FT, w, 0, h - DINING_TOP_FT / 2, 0)),
      part(
        "apron",
        "wood",
        box(
          Math.max(0.3, l - 2 * inset),
          DINING_APRON_FT,
          Math.max(0.3, w - 2 * inset),
          0,
          h - DINING_TOP_FT - DINING_APRON_FT / 2,
          0,
        ),
      ),
    ];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(
          part(
            `leg-${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
            "wood",
            box(DINING_LEG_FT, legH, DINING_LEG_FT, sx * lx, legH / 2, sz * lz),
          ),
        );
      }
    }
    return parts;
  },
};

/* ------------------------------------------------------ FLOOR: dining chair */

/** 18 in, and it does NOT move. A chair with a taller back is a chair with a
 *  taller back; seat height is set by the human leg, not by the drawing. */
const CHAIR_SEAT_Y_FT = 1.5;
const CHAIR_SEAT_FT = 0.12;
const CHAIR_LEG_FT = 0.12;
const CHAIR_SLAT_FT = 0.18;

const diningChair: FixtureKind = {
  id: "dining-chair",
  mount: "floor",
  label: "Chair",
  tag: "DC",
  blurb:
    "One chair, placed one at a time, because in a plan this tight the question is never the table — it is whether the chairs can come out.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.2, max: 2.2, step: 0.05, default: 1.5 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 1.3, max: 2.2, step: 0.05, default: 1.7 },
    { key: "heightFt", label: "Back height", unit: "ft", min: 2.2, max: 3.6, step: 0.05, default: 2.9 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 1.5),
    depthFt: num(d, "depthFt", 1.7),
    heightFt: num(d, "heightFt", 2.9),
  }),
  clearances: () => [
    rule({
      key: "push-back",
      label: "Room to push back and stand up",
      zone: "circulation",
      front: 0,
      back: 2.0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for getting out of a chair",
      note:
        "Behind the chair, because the chair faces its table. Two feet is enough to stand up in and not enough for somebody to walk behind you while you do.",
    }),
  ],
  facts: () => [
    {
      key: "seat",
      label: "Seat height",
      value: CHAIR_SEAT_Y_FT,
      unit: "ft",
      text: `${feetInches(CHAIR_SEAT_Y_FT)} above the floor, held constant`,
      note:
        "Raising the back does not raise the seat. It is the morph rule in the one place a person can see it: seat height is set by the human leg and a 30-in dining table, and neither of those scales with the drawing.",
    },
  ],
  build: (d) => {
    const w = num(d, "widthFt", 1.5);
    const dp = num(d, "depthFt", 1.7);
    const h = num(d, "heightFt", 2.9);
    const lx = Math.max(0.05, w / 2 - CHAIR_LEG_FT / 2);
    const lz = Math.max(0.05, dp / 2 - CHAIR_LEG_FT / 2);
    const legH = CHAIR_SEAT_Y_FT - CHAIR_SEAT_FT;
    const parts: FixturePart[] = [
      part("seat", "wood", box(w, CHAIR_SEAT_FT, dp, 0, CHAIR_SEAT_Y_FT - CHAIR_SEAT_FT / 2, 0)),
    ];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(
          part(
            `leg-${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
            "wood",
            box(CHAIR_LEG_FT, legH, CHAIR_LEG_FT, sx * lx, legH / 2, sz * lz),
          ),
        );
      }
      // The back is at −Z: the chair faces +Z, at the table.
      parts.push(
        part(
          `post-${sx > 0 ? "e" : "w"}`,
          "wood",
          box(CHAIR_LEG_FT, h - CHAIR_SEAT_Y_FT, CHAIR_LEG_FT, sx * lx, CHAIR_SEAT_Y_FT + (h - CHAIR_SEAT_Y_FT) / 2, -lz),
        ),
      );
    }
    // Two slats, always two, always the same section.
    for (let i = 0; i < 2; i++) {
      parts.push(
        part(
          `slat${i}`,
          "wood",
          box(
            Math.max(0.2, w - 2 * CHAIR_LEG_FT),
            CHAIR_SLAT_FT,
            0.07,
            0,
            CHAIR_SEAT_Y_FT + (h - CHAIR_SEAT_Y_FT) * (0.45 + i * 0.35),
            -lz,
          ),
        ),
      );
    }
    return parts;
  },
};

/* --------------------------------------------------------- FLOOR: armchair */

const armchair: FixtureKind = {
  id: "armchair",
  mount: "floor",
  label: "Armchair",
  tag: "AC",
  blurb:
    "The chair that ends up beside the stove, which in a house heated by one object is the most-used seat in it.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 2.2, max: 4.0, step: 0.05, default: 2.9 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 2.2, max: 3.6, step: 0.05, default: 3.0 },
    { key: "heightFt", label: "Back height", unit: "ft", min: 2.2, max: 3.4, step: 0.05, default: 2.8 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 2.9),
    depthFt: num(d, "depthFt", 3.0),
    heightFt: num(d, "heightFt", 2.8),
  }),
  clearances: () => [
    rule({
      key: "front",
      label: "Legroom and passage",
      zone: "circulation",
      front: 2.5,
      back: 0,
      left: 0.5,
      right: 0.5,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for legs and a route past",
      note:
        "Not a code figure. Worth watching where it lands: an armchair pulled up to the stove is a body sitting inside the stove's clearance-to-combustibles, and this tool will say so.",
    }),
  ],
  facts: () => [],
  build: (d) => {
    const w = num(d, "widthFt", 2.9);
    const dp = num(d, "depthFt", 3.0);
    const h = num(d, "heightFt", 2.8);
    // The SAME upholstery language as the sofa — same arm section, same seat
    // height, same back thickness — because it is the same piece of furniture
    // with one seat in it. Constants, shared on purpose.
    const inner = Math.max(0.8, w - 2 * SOFA_ARM_FT);
    return [
      // The plinth reaches the full stated depth at the front, which the sofa's
      // does not — a single chair's footprint is small enough that half an inch
      // of disagreement between the drawing and the clearance box matters.
      part("plinth", "wood", box(w, SOFA_SEAT_Y_FT - SOFA_SEAT_FT, dp - 0.3, 0, (SOFA_SEAT_Y_FT - SOFA_SEAT_FT) / 2, 0.15)),
      part("seat", "fabric", box(inner, SOFA_SEAT_FT, dp - 0.5, 0, SOFA_SEAT_Y_FT - SOFA_SEAT_FT / 2, 0.15)),
      part(
        "back",
        "fabric",
        box(w, h - (SOFA_SEAT_Y_FT - SOFA_SEAT_FT), SOFA_BACK_FT, 0, (h + SOFA_SEAT_Y_FT - SOFA_SEAT_FT) / 2, -dp / 2 + SOFA_BACK_FT / 2),
      ),
      part("arm-l", "fabric", box(SOFA_ARM_FT, SOFA_ARM_Y_FT, dp - 0.2, -(w - SOFA_ARM_FT) / 2, SOFA_ARM_Y_FT / 2, 0.05)),
      part("arm-r", "fabric", box(SOFA_ARM_FT, SOFA_ARM_Y_FT, dp - 0.2, (w - SOFA_ARM_FT) / 2, SOFA_ARM_Y_FT / 2, 0.05)),
    ];
  },
};

/* ------------------------------------------------------------- FLOOR: bunk */

const BUNK_MATTRESS_FT = 0.5;
const BUNK_DECK_FT = 0.18;
const BUNK_POST_FT = 0.3;
/** Guard rail above the upper mattress. Constant, and the reason the fixture's
 *  height is taller than the mattress a person lies on. */
const BUNK_RAIL_FT = 1.0;
/** The least anybody can sit up in below the upper deck. Enforced here rather
 *  than left to the sliders, because two independent height dimensions can be
 *  dragged into an impossible pair and the drawing must not go along with it. */
const BUNK_MIN_GAP_FT = 2.4;

/** The two mattress heights, reconciled. Single source for `extents` and
 *  `build`, exactly as `pvGrid` is for the array. */
function bunkLevels(d: Dims): { lowerTopFt: number; upperTopFt: number; gapFt: number } {
  const lowerTopFt = num(d, "lowerTopFt", 1.35);
  const wanted = num(d, "upperTopFt", 5.2);
  const floorOf = lowerTopFt + BUNK_MIN_GAP_FT + BUNK_DECK_FT + BUNK_MATTRESS_FT;
  const upperTopFt = Math.max(wanted, floorOf);
  return {
    lowerTopFt,
    upperTopFt,
    gapFt: upperTopFt - BUNK_MATTRESS_FT - BUNK_DECK_FT - lowerTopFt,
  };
}

const bunk: FixtureKind = {
  id: "bunk",
  mount: "floor",
  label: "Bunk beds",
  tag: "BK",
  blurb:
    "Two beds in the floor area of one, which is how a cabin sleeps the people who came to stay without becoming a bigger cabin.",
  dimensions: [
    { key: "widthFt", label: "Mattress width", unit: "ft", min: 2.5, max: 5, step: 1 / 12, default: 39 * IN, hint: "single 3 ft 3, double 4 ft 6" },
    { key: "lengthFt", label: "Mattress length", unit: "ft", min: 6, max: 7.5, step: 1 / 12, default: 75 * IN },
    { key: "lowerTopFt", label: "Lower mattress top", unit: "ft", min: 1.0, max: 2.2, step: 0.05, default: 1.35 },
    { key: "upperTopFt", label: "Upper mattress top", unit: "ft", min: 4.0, max: 6.5, step: 0.05, default: 5.2, hint: "held far enough above the lower bunk to sit up in it" },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 39 * IN),
    depthFt: num(d, "lengthFt", 75 * IN),
    heightFt: bunkLevels(d).upperTopFt + BUNK_RAIL_FT,
  }),
  clearances: () => [
    rule({
      key: "sit-up",
      label: "Sitting-up room above the top mattress",
      zone: "circulation",
      front: 0,
      back: 0,
      left: 0,
      right: 0,
      heightFt: 2.5,
      from: "top",
      basis: "indicative",
      source: "none — a working allowance for a head, measured from the guard rail",
      note:
        "Measured from the TOP of the guard rail, which stands a foot above the upper mattress — so this box asks for 2 ft 6 above the rail, about 3 ft 6 above the mattress. Under a sloped ceiling it is the clearance that decides which wall the bunk goes against, and the resolver also reports how far the whole frame stands above the eave line.",
    }),
    rule({
      key: "ladder",
      label: "Ladder and landing room",
      zone: "circulation",
      front: 2.5,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for climbing down in the dark",
      note: "The ladder is on the front face, so this is the floor somebody's feet arrive on at two in the morning.",
    }),
  ],
  facts: (d) => {
    const lv = bunkLevels(d);
    return [
      {
        key: "beds",
        label: "Beds",
        value: 2,
        unit: "",
        text: `2 in the footprint of one — ${feetInches(num(d, "widthFt", 39 * IN))} × ${feetInches(num(d, "lengthFt", 75 * IN))}`,
      },
      {
        key: "gap",
        label: "Room in the lower bunk",
        value: lv.gapFt,
        unit: "ft",
        text: `${feetInches(lv.gapFt)} from the lower mattress to the underside of the upper deck`,
        note:
          lv.upperTopFt > num(d, "upperTopFt", 5.2) + 1e-9
            ? `The upper bunk was raised to ${feetInches(lv.upperTopFt)} to keep ${feetInches(BUNK_MIN_GAP_FT)} of sitting-up room below it. Lower the lower bunk to bring it back down.`
            : "Enough to sit up in, which is what makes the lower bunk a bed rather than a shelf.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 39 * IN);
    const l = num(d, "lengthFt", 75 * IN);
    const lv = bunkLevels(d);
    const total = lv.upperTopFt + BUNK_RAIL_FT;
    const px = Math.max(0.05, w / 2 - BUNK_POST_FT / 2);
    const pz = Math.max(0.05, l / 2 - BUNK_POST_FT / 2);
    const parts: FixturePart[] = [];
    // Posts, decks, mattresses and rail are CONSTANT sections. Raising the top
    // bunk lifts it; it does not fatten the frame.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(
          part(
            `post-${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
            "wood",
            box(BUNK_POST_FT, total, BUNK_POST_FT, sx * px, total / 2, sz * pz),
          ),
        );
      }
    }
    for (const [name, top] of [
      ["lower", lv.lowerTopFt],
      ["upper", lv.upperTopFt],
    ] as const) {
      parts.push(part(`${name}-deck`, "wood", box(w, BUNK_DECK_FT, l, 0, top - BUNK_MATTRESS_FT - BUNK_DECK_FT / 2, 0)));
      parts.push(
        part(`${name}-mattress`, "fabric", box(w - 0.15, BUNK_MATTRESS_FT, l - 0.15, 0, top - BUNK_MATTRESS_FT / 2, 0)),
      );
    }
    parts.push(part("rail", "wood", box(w, 0.14, 0.12, 0, total - 0.07, pz)));
    // Three rungs, always three, always the same bar.
    for (let i = 0; i < 3; i++) {
      parts.push(
        part(
          `rung${i}`,
          "wood",
          cyl(0.06, w * 0.45)
            .rotateZ(Math.PI / 2)
            .translate(0, lv.lowerTopFt + ((lv.upperTopFt - lv.lowerTopFt) * (i + 1)) / 4, pz - 0.02),
        ),
      );
    }
    return parts;
  },
};

/* --------------------------------------------------------- FLOOR: wardrobe */

const WARDROBE_DOOR_FT = 0.07;
const WARDROBE_PLINTH_FT = 0.3;
const WARDROBE_HANDLE_FT = 0.06;
/** A hinged leaf swings its own width, and no leaf is built much wider than
 *  this before it starts to sag on its hinges. */
const WARDROBE_MAX_LEAF_FT = 2.6;
/** Rail a winter coat takes on the shoulder. INDICATIVE — a shirt is about
 *  1 1/2 in, a parka is nearer four, and the difference is the whole reason a
 *  cold-climate house runs out of hanging space first. */
const COAT_ON_RAIL_FT = 4 * IN;

const wardrobe: FixtureKind = {
  id: "wardrobe",
  mount: "floor",
  label: "Wardrobe",
  tag: "WR",
  blurb:
    "A house with no stud walls to bury a closet in has to stand its hanging space on the floor, where it takes up room and swings a door.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 2, max: 8, step: 0.1, default: 4.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 1.6, max: 3.0, step: 0.05, default: 2.0, hint: "2 ft is about the least a hanger fits in" },
    { key: "heightFt", label: "Height", unit: "ft", min: 5, max: 8, step: 0.1, default: 6.8 },
  ],
  options: [
    {
      key: "doors",
      label: "Doors",
      default: "hinged",
      hint: "The choice that decides how much floor in front of it has to stay empty.",
      choices: [
        { id: "hinged", label: "Hinged", note: "A leaf swings its own width out into the room, and that floor cannot hold anything." },
        { id: "sliding", label: "Sliding", note: "No swing at all, at the price of only ever opening half the wardrobe at a time." },
      ],
    },
  ],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 4),
    depthFt: num(d, "depthFt", 2),
    heightFt: num(d, "heightFt", 6.8),
  }),
  clearances: (d, o) => {
    const leaf = Math.min(num(d, "widthFt", 4) / 2, WARDROBE_MAX_LEAF_FT);
    const hinged = opt(o, "doors", "hinged") === "hinged";
    return [
      rule({
        key: "door-swing",
        label: hinged ? "Door swing and standing room" : "Standing room at the doors",
        zone: "circulation",
        front: hinged ? leaf : 2.0,
        back: 0,
        left: 0,
        right: 0,
        heightFt: null,
        basis: "indicative",
        source: "none — a working allowance for a door leaf and the person opening it",
        note: hinged
          ? `A leaf swings its own width, so this box is ${feetInches(leaf)} of floor that has to stay clear. Put the bed inside it and the wardrobe opens onto the bed.`
          : "Sliding doors need no swing, so this is only the floor somebody stands on. Remember that half the opening is always shut, which is why deep shelves behind a slider are shelves you see half of.",
      }),
    ];
  },
  facts: (d) => {
    const railFt = Math.max(0, num(d, "widthFt", 4) - 0.35);
    return [
      {
        key: "rail",
        label: "Hanging rail",
        value: railFt,
        unit: "ft",
        text: `${feetInches(railFt)} of rail — about ${Math.floor(railFt / COAT_ON_RAIL_FT)} winter coats`,
        note: `Counted at ${feetInches(COAT_ON_RAIL_FT)} a garment, which is indicative and is what a parka takes on the shoulder; a shirt takes well under half of that. A house in this climate runs out of rail in November, not in July.`,
      },
    ];
  },
  build: (d, o) => {
    const w = num(d, "widthFt", 4);
    const dp = num(d, "depthFt", 2);
    const h = num(d, "heightFt", 6.8);
    const sliding = opt(o, "doors", "hinged") === "sliding";
    const carcassH = h - WARDROBE_PLINTH_FT;
    // Door leaf, plinth and handle are CONSTANT. A wider wardrobe gets wider
    // doors, not thicker ones.
    const faceZ = dp / 2 - WARDROBE_DOOR_FT - 0.06;
    const parts: FixturePart[] = [
      part("carcass", "wood", box(w, carcassH, dp, 0, WARDROBE_PLINTH_FT + carcassH / 2, 0)),
      part("plinth", "wood", box(w - 0.18, WARDROBE_PLINTH_FT, dp - 0.18, 0, WARDROBE_PLINTH_FT / 2, 0)),
    ];
    const leafW = sliding ? w * 0.52 : (w - 0.06) / 2;
    for (const side of [-1, 1]) {
      parts.push(
        part(
          `door-${side > 0 ? "r" : "l"}`,
          "wood",
          box(
            leafW,
            carcassH - 0.12,
            WARDROBE_DOOR_FT,
            side * (sliding ? w * 0.24 : w / 4),
            WARDROBE_PLINTH_FT + carcassH / 2,
            // Sliders sit on two tracks, so one panel stands a leaf in front of
            // the other. It is the visible difference between the two options.
            faceZ + (sliding && side < 0 ? -WARDROBE_DOOR_FT - 0.02 : 0),
          ),
        ),
      );
      parts.push(
        part(
          `handle-${side > 0 ? "r" : "l"}`,
          "steel",
          box(WARDROBE_HANDLE_FT, 0.55, dp / 2 - faceZ - WARDROBE_DOOR_FT / 2, side * 0.1, WARDROBE_PLINTH_FT + carcassH * 0.5, (dp / 2 + faceZ + WARDROBE_DOOR_FT / 2) / 2),
        ),
      );
    }
    return parts;
  },
};

/* ---------------------------------------------------------- FLOOR: dresser */

const DRESSER_TOP_FT = 0.1;
const DRESSER_PLINTH_FT = 0.28;
/** The gap between drawer fronts. Constant, and the reason more drawers in the
 *  same carcass means shallower drawers rather than a fatter chest. */
const DRESSER_GAP_FT = 0.035;
const DRESSER_FRONT_FT = 0.06;

const dresser: FixtureKind = {
  id: "dresser",
  mount: "floor",
  label: "Chest of drawers",
  tag: "DS",
  blurb:
    "Folded storage that fits under the eave line, where a wardrobe will not stand and where a small house keeps most of its clothes.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 2, max: 6, step: 0.1, default: 3.4 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 1.2, max: 2.2, step: 0.05, default: 1.6 },
    { key: "heightFt", label: "Height", unit: "ft", min: 2.2, max: 4.5, step: 0.05, default: 3.0 },
    { key: "drawers", label: "Drawers", unit: "count", min: 2, max: 8, step: 1, default: 4 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 3.4),
    depthFt: num(d, "depthFt", 1.6),
    heightFt: num(d, "heightFt", 3.0),
  }),
  clearances: (d) => {
    const dp = num(d, "depthFt", 1.6);
    return [
      rule({
        key: "drawer-pull",
        label: "Drawer out, and somebody in front of it",
        zone: "circulation",
        front: dp + 1.0,
        back: 0,
        left: 0,
        right: 0,
        heightFt: null,
        basis: "indicative",
        source: "none — a working allowance for a drawer coming out and a person standing at it",
        note:
          "A drawer comes out about as far as the carcass is deep, and somebody stands in the foot beyond that. This box grows with the depth for exactly that reason — it is the one clearance here that a morph actually changes.",
      }),
    ];
  },
  facts: (d) => {
    const n = Math.max(1, Math.round(num(d, "drawers", 4)));
    const h = num(d, "heightFt", 3.0);
    const stack = Math.max(0.2, h - DRESSER_PLINTH_FT - DRESSER_TOP_FT);
    const clear = (stack - (n + 1) * DRESSER_GAP_FT) / n;
    return [
      {
        key: "drawers",
        label: "Drawers",
        value: n,
        unit: "",
        text: `${n} drawers, each about ${feetInches(Math.max(0, clear))} clear`,
        note:
          "More drawers in the same carcass is shallower drawers: the top, the plinth and the gaps between the fronts do not get thinner to make room. That is the whole difference between morphing an object and scaling a picture of one.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 3.4);
    const dp = num(d, "depthFt", 1.6);
    const h = num(d, "heightFt", 3.0);
    const n = Math.max(1, Math.round(num(d, "drawers", 4)));
    const stack = Math.max(0.2, h - DRESSER_PLINTH_FT - DRESSER_TOP_FT);
    const each = (stack - (n + 1) * DRESSER_GAP_FT) / n;
    const parts: FixturePart[] = [
      part("carcass", "wood", box(w, h - DRESSER_TOP_FT, dp, 0, (h - DRESSER_TOP_FT) / 2, 0)),
      part("top", "wood", box(w, DRESSER_TOP_FT, dp, 0, h - DRESSER_TOP_FT / 2, 0)),
      part("plinth", "wood", box(w - 0.16, DRESSER_PLINTH_FT, dp - 0.16, 0, DRESSER_PLINTH_FT / 2, 0)),
    ];
    for (let i = 0; i < n; i++) {
      const y = DRESSER_PLINTH_FT + DRESSER_GAP_FT * (i + 1) + each * (i + 0.5);
      parts.push(
        part(`drawer${i}`, "wood", box(w - 0.12, Math.max(0.05, each), DRESSER_FRONT_FT, 0, y, dp / 2 - DRESSER_FRONT_FT / 2)),
      );
      parts.push(part(`pull${i}`, "steel", box(w * 0.4, 0.07, 0.05, 0, y, dp / 2 - 0.02)));
    }
    return parts;
  },
};

/* --------------------------------------------------------- FLOOR: shelving */

const SHELF_FT = 0.1;
const SHELF_SIDE_FT = 0.1;

/** Shelves and their real spacing for a height. Taller unit, MORE shelves —
 *  the boards do not get thicker and the gaps do not get taller. Single source
 *  for `facts` and `build`. */
function shelvingRows(d: Dims): { count: number; spacingFt: number } {
  const h = num(d, "heightFt", 6.5);
  const wanted = Math.max(0.4, num(d, "spacingFt", 1.15));
  const gaps = Math.max(1, Math.floor((h - SHELF_FT) / (wanted + SHELF_FT)));
  return { count: gaps + 1, spacingFt: (h - SHELF_FT * (gaps + 1)) / gaps };
}

const shelving: FixtureKind = {
  id: "shelving",
  mount: "floor",
  label: "Shelving",
  tag: "SV",
  blurb:
    "Open storage for the wall you did not glaze, which in a house with one big window is where everything that is not a view has to live.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.5, max: 10, step: 0.1, default: 4.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 0.7, max: 2.0, step: 0.05, default: 1.0 },
    { key: "heightFt", label: "Height", unit: "ft", min: 2, max: 9, step: 0.1, default: 6.5 },
    { key: "spacingFt", label: "Clear between shelves", unit: "ft", min: 0.6, max: 2.0, step: 0.05, default: 1.15, hint: "the object decides how many shelves that gives" },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 4),
    depthFt: num(d, "depthFt", 1.0),
    heightFt: num(d, "heightFt", 6.5),
  }),
  clearances: () => [
    rule({
      key: "reach",
      label: "Room to stand and reach in",
      zone: "circulation",
      front: 2.5,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for reading the spines and lifting a box down",
      note: "Not a code figure. Shelving in a passage is shelving with a person standing in the passage.",
    }),
  ],
  facts: (d) => {
    const rows = shelvingRows(d);
    const w = num(d, "widthFt", 4);
    return [
      {
        key: "shelf",
        label: "Shelf run",
        value: rows.count * w,
        unit: "ft",
        text: `${rows.count} shelves — ${(rows.count * w).toFixed(1)} ft of run, ${feetInches(rows.spacingFt)} clear between`,
        note: "Raise the unit and it gains shelves at the same spacing rather than stretching the ones it has.",
      },
      {
        key: "fixing",
        label: "Fixing",
        value: 0,
        unit: "",
        text: "Tall shelving has to be fixed back to the structure",
        note:
          "This tool draws where it stands, not how it is held up. A loaded unit this tall is a tipping hazard and a seismic and wind question in some jurisdictions; the fixing is a real detail somebody has to draw.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 4);
    const dp = num(d, "depthFt", 1.0);
    const h = num(d, "heightFt", 6.5);
    const rows = shelvingRows(d);
    const parts: FixturePart[] = [];
    for (const side of [-1, 1]) {
      parts.push(
        part(
          `side-${side > 0 ? "e" : "w"}`,
          "wood",
          box(SHELF_SIDE_FT, h, dp, side * (w / 2 - SHELF_SIDE_FT / 2), h / 2, 0),
        ),
      );
    }
    // Boards are a CONSTANT board. The count moves, the section does not.
    for (let i = 0; i < rows.count; i++) {
      const y = SHELF_FT / 2 + i * (rows.spacingFt + SHELF_FT);
      parts.push(
        part(`shelf${i}`, "wood", box(Math.max(0.2, w - 2 * SHELF_SIDE_FT), SHELF_FT, dp, 0, Math.min(h - SHELF_FT / 2, y), 0)),
      );
    }
    return parts;
  },
};

/* ------------------------------------------------------ FLOOR: entry bench */

const BENCH_SEAT_FT = 0.14;
const BENCH_END_FT = 0.12;
const BENCH_SHELF_FT = 0.08;
const BENCH_SHELF_Y_FT = 0.42;
/** Floor a pair of winter boots stands on, side by side under a bench. */
const BOOT_PAIR_FT = 1.0;

const entryBench: FixtureKind = {
  id: "entry-bench",
  mount: "floor",
  label: "Entry bench",
  tag: "EB",
  blurb:
    "Somewhere to sit down and get wet boots off inside the door, which is the single most-used square metre of a house in this climate.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 2, max: 8, step: 0.1, default: 4.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 1.2, max: 2.2, step: 0.05, default: 1.5 },
    { key: "heightFt", label: "Seat height", unit: "ft", min: 1.2, max: 1.9, step: 0.05, default: 1.5 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 4),
    depthFt: num(d, "depthFt", 1.5),
    heightFt: num(d, "heightFt", 1.5),
  }),
  clearances: () => [
    rule({
      key: "sit",
      label: "Room to sit, bend and stand up",
      zone: "circulation",
      front: 3.0,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for a person bent over a boot",
      note:
        "Three feet, because getting a winter boot off is done with an elbow out and a door behind you. If the entry door's swing is in this box, the plan has a bench nobody can sit on when somebody arrives.",
    }),
  ],
  facts: (d) => {
    const pairs = Math.max(0, Math.floor(num(d, "widthFt", 4) / BOOT_PAIR_FT));
    return [
      {
        key: "boots",
        label: "Boot storage",
        value: pairs,
        unit: "",
        text: `About ${pairs} pairs on the shelf under the seat`,
        note: `Counted at ${feetInches(BOOT_PAIR_FT)} a pair side by side, which is generous for shoes and about right for winter boots.`,
      },
      {
        key: "floor",
        label: "The floor under it",
        value: 0,
        unit: "",
        text: "This is where the water, the salt and the grit land",
        note:
          "A season of boots puts meltwater and road salt on this square metre and nowhere else. It wants a floor finish that can take it and, in a house with a wood floor, something under the shelf to catch the drip — neither of which this tool draws.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 4);
    const dp = num(d, "depthFt", 1.5);
    const h = num(d, "heightFt", 1.5);
    return [
      part("seat", "wood", box(w, BENCH_SEAT_FT, dp, 0, h - BENCH_SEAT_FT / 2, 0)),
      part("end-w", "wood", box(BENCH_END_FT, h - BENCH_SEAT_FT, dp, -(w / 2 - BENCH_END_FT / 2), (h - BENCH_SEAT_FT) / 2, 0)),
      part("end-e", "wood", box(BENCH_END_FT, h - BENCH_SEAT_FT, dp, w / 2 - BENCH_END_FT / 2, (h - BENCH_SEAT_FT) / 2, 0)),
      part(
        "shelf",
        "wood",
        box(Math.max(0.2, w - 2 * BENCH_END_FT), BENCH_SHELF_FT, dp - 0.2, 0, Math.min(h - BENCH_SEAT_FT - BENCH_SHELF_FT, BENCH_SHELF_Y_FT), 0),
      ),
    ];
  },
};

/* --------------------------------------------------- FLOOR: firewood store */

const WOOD_POST_FT = 0.18;
/** The stack stands off the floor so air gets under it. Constant. */
const WOOD_BASE_FT = 0.25;
/** One split, drawn. A bigger store is MORE splits, never bigger ones. */
const LOG_R_FT = 0.2;
const LOG_MAX_DRAWN = 140;
/** A full cord is 128 cubic feet STACKED — the stack is the measure, so no
 *  air-between-the-splits fudge factor belongs here. */
const CORD_FT3 = 128;
/** Weight of a cord of seasoned spruce or pine. INDICATIVE, and stated: birch
 *  is nearer 3,700 lb and green wood of any species is far heavier again. */
const CORD_LB_SOFTWOOD = 2600;

const firewoodStore: FixtureKind = {
  id: "firewood-store",
  mount: "floor",
  label: "Firewood store",
  tag: "FS",
  blurb:
    "The indoor woodpile, because a stove is only as good as the dry wood within reach of it in February and that wood has to stand somewhere real.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.5, max: 8, step: 0.1, default: 3.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 1.0, max: 2.5, step: 0.05, default: 1.35, hint: "a 16 in split is 1 ft 4" },
    { key: "heightFt", label: "Height", unit: "ft", min: 1.5, max: 6, step: 0.1, default: 3.5 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 3.0),
    depthFt: num(d, "depthFt", 1.35),
    heightFt: num(d, "heightFt", 3.5),
  }),
  clearances: () => [
    rule({
      key: "loading",
      label: "Room to stack and to carry an armful in",
      zone: "circulation",
      front: 2.5,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for a person carrying wood",
      note:
        "The distance from the stove matters more than this number and is not set here: a woodpile is combustible, so it is the STOVE's clearance-to-combustibles that governs, and this tool reports the conflict when the two boxes meet.",
    }),
    rule({
      key: "air",
      label: "Air around the stack",
      zone: "airflow",
      front: 0,
      back: 0.25,
      left: 0.25,
      right: 0.25,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for air to get to a drying stack",
      note:
        "Wood stacked hard against a cold exterior wall neither dries nor lets the wall dry, and in a tight house the moisture it gives up has to go somewhere. Split, stacked and covered for a season before it comes indoors is the actual answer; this gap is the part a drawing can hold.",
    }),
  ],
  facts: (d) => {
    const w = num(d, "widthFt", 3.0);
    const dp = num(d, "depthFt", 1.35);
    const h = num(d, "heightFt", 3.5);
    const stacked = w * dp * Math.max(0, h - WOOD_BASE_FT);
    const cords = stacked / CORD_FT3;
    return [
      {
        key: "volume",
        label: "Stacked volume",
        value: cords,
        unit: "cord",
        text: `${stacked.toFixed(1)} cu ft stacked — ${cords.toFixed(2)} of a full cord`,
        note: `A full cord is ${CORD_FT3} cu ft of STACKED wood, air between the splits included, so this is a direct comparison and not an estimate.`,
      },
      {
        key: "weight",
        label: "Weight when full",
        value: cords * CORD_LB_SOFTWOOD,
        unit: "lb",
        text: `About ${Math.round(cords * CORD_LB_SOFTWOOD).toLocaleString("en-CA")} lb`,
        note: `Taken at ${CORD_LB_SOFTWOOD.toLocaleString("en-CA")} lb a cord for seasoned spruce or pine, which is indicative. Birch is nearer 3,700 lb and green wood of any species is heavier again — on a raised floor or a deck that difference is a structural question.`,
      },
      {
        key: "duration",
        label: "How long it lasts",
        value: 0,
        unit: "",
        text: "Not estimated here",
        note:
          "Burn rate depends on the stove, the species, the moisture content, the weather and how the house is run, and a number produced without those would be fiction. What this fixture gives you is an honest volume; the winter's total is a conversation with somebody who has heated this building.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 3.0);
    const dp = num(d, "depthFt", 1.35);
    const h = num(d, "heightFt", 3.5);
    const parts: FixturePart[] = [];
    const px = Math.max(0.05, w / 2 - WOOD_POST_FT / 2);
    const pz = Math.max(0.05, dp / 2 - WOOD_POST_FT / 2);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(
          part(
            `post-${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
            "steel",
            box(WOOD_POST_FT, h, WOOD_POST_FT, sx * px, h / 2, sz * pz),
          ),
        );
      }
    }
    parts.push(part("base", "steel", box(w, 0.08, dp, 0, WOOD_BASE_FT - 0.04, 0)));

    const rows = Math.max(1, Math.floor((h - WOOD_BASE_FT) / (2 * LOG_R_FT)));
    const cols = Math.max(1, Math.floor(w / (2 * LOG_R_FT)));
    if (rows * cols > LOG_MAX_DRAWN) {
      // An honest block rather than four hundred cylinders: the volume is
      // right, the grain is not drawn, and the facts still report the cords.
      parts.push(part("stack", "wood", box(w - 0.1, h - WOOD_BASE_FT, dp - 0.1, 0, WOOD_BASE_FT + (h - WOOD_BASE_FT) / 2, 0)));
      return parts;
    }
    // Splits lie with their length across the DEPTH, which is why the depth
    // default is a 16-inch split. Rotate first, then translate.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        parts.push(
          part(
            `log-${r}-${c}`,
            "wood",
            cyl(LOG_R_FT, dp - 0.06, 0, 0, 0, 8)
              .rotateX(Math.PI / 2)
              .translate(-w / 2 + LOG_R_FT + c * 2 * LOG_R_FT, WOOD_BASE_FT + LOG_R_FT + r * 2 * LOG_R_FT, 0),
          ),
        );
      }
    }
    return parts;
  },
};

/* ----------------------------------------------------- FLOOR: drying rack */

const RACK_LEG_FT = 0.12;
const RACK_BAR_R_FT = 0.05;
/** Water a spun load gives up as it dries. INDICATIVE — it depends on the
 *  machine's spin speed and on what is in the load — but the order of
 *  magnitude is the point, and indoors that water goes into the room. */
const LOAD_WATER_L = 2.5;

const dryingRack: FixtureKind = {
  id: "drying-rack",
  mount: "floor",
  label: "Drying rack",
  tag: "DY",
  blurb:
    "Where washing and wet outdoor clothes dry in a house with no room for a dryer and no wish to spend a battery on one.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.5, max: 6, step: 0.1, default: 3.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 0.8, max: 2.5, step: 0.05, default: 1.6 },
    { key: "heightFt", label: "Height", unit: "ft", min: 2.5, max: 6, step: 0.1, default: 4.5 },
    { key: "bars", label: "Bars", unit: "count", min: 3, max: 10, step: 1, default: 5 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 3.0),
    depthFt: num(d, "depthFt", 1.6),
    heightFt: num(d, "heightFt", 4.5),
  }),
  clearances: () => [
    rule({
      key: "air",
      label: "Moving air around it",
      zone: "airflow",
      front: 1.0,
      back: 1.0,
      left: 1.0,
      right: 1.0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance so cloth is not drying against furniture",
      note:
        "Wet cloth in still air stays wet, and a rack jammed against a sofa dries on one side. Near the stove it dries fast; INSIDE the stove's clearance-to-combustibles it is a fire, and this tool reports that overlap.",
    }),
  ],
  facts: (d) => {
    const bars = Math.max(1, Math.round(num(d, "bars", 5)));
    const w = num(d, "widthFt", 3.0);
    return [
      {
        key: "line",
        label: "Hanging line",
        value: bars * w,
        unit: "ft",
        text: `${(bars * w).toFixed(1)} ft of line across ${bars} bars`,
      },
      {
        key: "moisture",
        label: "Where the water goes",
        value: LOAD_WATER_L,
        unit: "L",
        text: `About ${LOAD_WATER_L} L a load, straight into the room's air`,
        note:
          "Indicative, and it depends on the spin. In an airtight house that water leaves through the HRV or it condenses on the coldest surface it can find — which in January is the inside of a window reveal or a thermal bridge. Mid-winter it is free humidity in a house that is otherwise too dry; in a mild damp shoulder season it is a mould question. Either way it is a reason the rack and the HRV belong on the same drawing.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 3.0);
    const dp = num(d, "depthFt", 1.6);
    const h = num(d, "heightFt", 4.5);
    const bars = Math.max(1, Math.round(num(d, "bars", 5)));
    const parts: FixturePart[] = [];
    const px = Math.max(0.05, w / 2 - RACK_LEG_FT / 2);
    const pz = Math.max(0.05, dp / 2 - RACK_LEG_FT / 2);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(
          part(
            `leg-${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
            "wood",
            box(RACK_LEG_FT, h, RACK_LEG_FT, sx * px, h / 2, sz * pz),
          ),
        );
      }
    }
    // Bars are a CONSTANT dowel, in two ranks so the depth is used. More bars
    // is more bars, at the same section.
    for (let i = 0; i < bars; i++) {
      const y = h * (0.25 + (0.7 * i) / Math.max(1, bars - 1));
      parts.push(
        part(
          `bar${i}`,
          "wood",
          cyl(RACK_BAR_R_FT, w - RACK_LEG_FT, 0, 0, 0, 8)
            .rotateZ(Math.PI / 2)
            .translate(0, Math.min(h - RACK_BAR_R_FT, y), (i % 2 === 0 ? -1 : 1) * (pz - RACK_LEG_FT)),
        ),
      );
    }
    return parts;
  },
};

/* --------------------------------------------------- FLOOR: refrigerator */

const FRIDGE_PLINTH_FT = 0.15;
const FRIDGE_DOOR_FT = 0.09;
const FRIDGE_GAP_FT = 0.05;
const FRIDGE_HANDLE_FT = 0.07;

const refrigerator: FixtureKind = {
  id: "refrigerator",
  mount: "floor",
  label: "Refrigerator",
  tag: "RF",
  blurb:
    "The one appliance that never switches off, which off grid makes it the load the battery bank is really sized for.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.8, max: 3.2, step: 0.05, default: 2.5 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 2.0, max: 3.0, step: 0.05, default: 2.5 },
    { key: "heightFt", label: "Height", unit: "ft", min: 3.0, max: 6.5, step: 0.05, default: 5.6 },
  ],
  options: [
    {
      key: "hinge",
      label: "Hinge side",
      default: "right",
      hint: "The door swings away from its hinge, so this decides which corner it can go in.",
      choices: [
        { id: "left", label: "Hinged left" },
        { id: "right", label: "Hinged right" },
      ],
    },
  ],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 2.5),
    depthFt: num(d, "depthFt", 2.5),
    heightFt: num(d, "heightFt", 5.6),
  }),
  clearances: (d, o) => {
    const w = num(d, "widthFt", 2.5);
    const hingeLeft = opt(o, "hinge", "right") === "left";
    return [
      rule({
        key: "door",
        label: "Door open, and somebody in front of it",
        zone: "circulation",
        front: w,
        back: 0,
        left: hingeLeft ? 0.5 : 0,
        right: hingeLeft ? 0 : 0.5,
        heightFt: null,
        basis: "indicative",
        source: "none — a working allowance for a door leaf as wide as the appliance",
        note:
          "An open door reaches out about the width of the appliance, which is why this box grows with the width. The half foot on the hinge side is the difference between a fridge in a corner and a fridge whose drawers will not come out past the wall.",
      }),
      rule({
        key: "airflow",
        label: "Air to the condenser",
        zone: "airflow",
        front: 0,
        back: 0.25,
        left: 0.1,
        right: 0.1,
        heightFt: null,
        basis: "manufacturer",
        source: "refrigerator installation manuals — a typical figure for the product class",
        note:
          "A fridge boxed in tight runs its compressor longer for the same coldness, and off grid that is battery. The unit's own manual carries the real figures.",
      }),
      rule({
        key: "above",
        label: "Air above it",
        zone: "airflow",
        front: 0,
        back: 0,
        left: 0,
        right: 0,
        heightFt: 0.25,
        from: "top",
        basis: "manufacturer",
        source: "refrigerator installation manuals",
        note: "Typical. Drawn as a slab above the unit so a cabinet built down onto it is visible.",
      }),
    ];
  },
  facts: (d) => {
    const w = num(d, "widthFt", 2.5);
    const dp = num(d, "depthFt", 2.5);
    const h = num(d, "heightFt", 5.6);
    const inner = Math.max(0, (w - 0.35) * (dp - 0.45) * (h - 0.7));
    return [
      {
        key: "volume",
        label: "Rough interior",
        value: inner,
        unit: "cu ft",
        text: `About ${inner.toFixed(1)} cu ft inside`,
        note:
          "Geometry less an allowance for the cabinet, the insulation and the door. Manufacturers measure and publish capacity their own way and the label figure will not match this exactly.",
      },
      {
        key: "load",
        label: "Electrical load",
        value: 0,
        unit: "",
        text: "Not estimated here — read the EnerGuide label",
        note:
          "Consumption spans a factor of three across units of the same size, and it rises in a warm room and falls in a cold one. Off grid the annual kWh on the label is the single number that decides how much battery and array this house needs, so it should come from the actual appliance and not from a tool that has never seen it.",
      },
    ];
  },
  build: (d, o) => {
    const w = num(d, "widthFt", 2.5);
    const dp = num(d, "depthFt", 2.5);
    const h = num(d, "heightFt", 5.6);
    const hingeLeft = opt(o, "hinge", "right") === "left";
    const bodyH = h - FRIDGE_PLINTH_FT;
    // Plinth, door thickness, the gap between the two doors and the handle are
    // CONSTANT: a taller fridge is a taller fridge.
    const freezerH = bodyH * 0.32;
    const fridgeH = bodyH - freezerH - FRIDGE_GAP_FT;
    const faceZ = dp / 2 - FRIDGE_DOOR_FT / 2;
    const handleX = (hingeLeft ? 1 : -1) * (w / 2 - 0.18);
    return [
      part("plinth", "steel", box(w - 0.1, FRIDGE_PLINTH_FT, dp - 0.1, 0, FRIDGE_PLINTH_FT / 2, 0)),
      part("body", "steel", box(w, bodyH, dp, 0, FRIDGE_PLINTH_FT + bodyH / 2, 0)),
      part("door-freezer", "steel", box(w - 0.04, freezerH, FRIDGE_DOOR_FT, 0, FRIDGE_PLINTH_FT + bodyH - freezerH / 2, faceZ)),
      part("door-fridge", "steel", box(w - 0.04, fridgeH, FRIDGE_DOOR_FT, 0, FRIDGE_PLINTH_FT + fridgeH / 2, faceZ)),
      part("handle-freezer", "cabinet", box(FRIDGE_HANDLE_FT, freezerH * 0.5, 0.05, handleX, FRIDGE_PLINTH_FT + bodyH - freezerH / 2, dp / 2 - 0.025)),
      part("handle-fridge", "cabinet", box(FRIDGE_HANDLE_FT, fridgeH * 0.4, 0.05, handleX, FRIDGE_PLINTH_FT + fridgeH * 0.7, dp / 2 - 0.025)),
    ];
  },
};

/* ------------------------------------------------------------ FLOOR: range */

const RANGE_TOP_FT = 0.1;
const RANGE_BURNER_R_FT = 0.3;
const RANGE_DOOR_FT = 0.07;
/** Cooktop to unprotected combustible cabinetry above. TYPICAL of the product
 *  class; the appliance's own manual and the hood's manual govern. */
const RANGE_ABOVE_FT = 30 * IN;

const range: FixtureKind = {
  id: "range",
  mount: "floor",
  label: "Range",
  tag: "RG",
  blurb:
    "Where the cooking happens, and — depending on what it burns — either an appliance, an electrical load the inverter has to carry, or a second solid-fuel appliance with everything that comes with one.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 2, max: 4, step: 0.05, default: 2.5 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 2, max: 3, step: 0.05, default: 2.2 },
    { key: "heightFt", label: "Height", unit: "ft", min: 2.6, max: 3.2, step: 0.02, default: 3.0, hint: "matched to a 36 in counter" },
  ],
  options: [
    {
      key: "fuel",
      label: "Fuel",
      default: "propane",
      hint: "The single fact that decides this fixture's clearances.",
      choices: [
        { id: "propane", label: "Propane", note: "Works with no grid and no battery, and puts combustion products and moisture into a very tight house." },
        { id: "electric", label: "Electric", note: "Clean at the point of use; off grid it is the largest instantaneous load in the building." },
        { id: "wood", label: "Wood cookstove", note: "A solid-fuel appliance. It carries the code's clearances, a WETT inspection, and heat you get whether or not July wanted any." },
      ],
    },
  ],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 2.5),
    depthFt: num(d, "depthFt", 2.2),
    heightFt: num(d, "heightFt", 3.0),
  }),
  clearances: (_d, o) => {
    const fuel = opt(o, "fuel", "propane");
    const rules: ClearanceRule[] = [
      rule({
        key: "work-aisle",
        label: "Work aisle at the cooking surface",
        zone: "circulation",
        front: 42 * IN,
        back: 0,
        left: 0,
        right: 0,
        heightFt: null,
        basis: "guideline",
        source: "NKBA Kitchen Planning Guidelines — a design guideline, not a building code",
        note: "42 in, the same figure the island uses: a body, an open oven door and somebody getting past all happen in this aisle.",
      }),
    ];
    if (fuel === "wood") {
      rules.push(
        rule({
          key: "combustible",
          label: "To combustibles (label figure)",
          zone: "combustible",
          front: 18 * IN,
          back: 18 * IN,
          left: 18 * IN,
          right: 18 * IN,
          heightFt: null,
          basis: "code",
          source:
            "CAN/CSA-B365, Installation Code for Solid-Fuel-Burning Appliances and Equipment (Alberta's WETT inspections are carried out against it)",
          note:
            "PLACEHOLDER for the figure on this cookstove's own label, exactly as for the wood stove: a listed appliance's clearance is whatever its listing says. An UNLISTED cookstove falls under the code's blanket clearance instead, which is far larger — 1200 mm unshielded — and this fixture does not offer that case because a shop-built kitchen range is not a thing anybody should be drawing from a palette.",
        }),
        rule({
          key: "floor-pad",
          label: "Non-combustible floor protection",
          zone: "floor-pad",
          front: 450 * MM,
          back: 200 * MM,
          left: 200 * MM,
          right: 200 * MM,
          heightFt: 0.12,
          basis: "code",
          source: "CAN/CSA-B365 floor-protection extension (the same figures appear in NFPA 211)",
          note:
            "450 mm in front of the fuel-loading door and 200 mm elsewhere. The EXTENT only — the pad's required thickness or R-value is a separate question this tool does not answer.",
        }),
      );
    } else {
      rules.push(
        rule({
          key: "above",
          label: "Above the cooking surface",
          zone: "combustible",
          front: 0,
          back: 0,
          left: 0,
          right: 0,
          heightFt: RANGE_ABOVE_FT,
          from: "top",
          basis: "manufacturer",
          source: "range and range-hood installation manuals — a typical figure for the product class",
          note:
            "Commonly 30 in from the cooking surface to unprotected combustible cabinetry, less where a listed hood or a shield is fitted. The appliance's manual governs, and this tool does not model the hood or its duct at all.",
        }),
      );
    }
    return rules;
  },
  facts: (_d, o) => {
    const fuel = opt(o, "fuel", "propane");
    if (fuel === "wood") {
      return [
        {
          key: "solid-fuel",
          label: "It is a solid-fuel appliance",
          value: 1,
          unit: "",
          text: "WETT inspection, a chimney, and heat in July",
          note:
            "Everything the wood stove carries applies here as well: a certified chimney, the clearances above, an inspection an Alberta insurer will normally ask to see, and a kitchen that gets hot in summer. In exchange it cooks with no grid, no propane delivery and no battery.",
        },
      ];
    }
    if (fuel === "electric") {
      return [
        {
          key: "load",
          label: "Off-grid load",
          value: 0,
          unit: "",
          text: "The largest instantaneous draw in the house",
          note:
            "A single induction element can pull well over 2 kW and an oven element more again, which is an inverter-sizing question rather than a battery-capacity one. The actual figures are on the appliance's rating plate; this tool does not guess them.",
        },
      ];
    }
    return [
      {
        key: "combustion",
        label: "Combustion in a tight house",
        value: 0,
        unit: "",
        text: "Propane burns to water vapour and combustion products, indoors",
        note:
          "A tight envelope does not forgive an unvented flame: cooking on propane wants real extract at the hob, and the tank, its regulator and its lines are governed by the propane installation code and its permits — none of which this tool models. Propane is also heavier than air, which is why a leak collects at the floor.",
      },
    ];
  },
  build: (d, o) => {
    const w = num(d, "widthFt", 2.5);
    const dp = num(d, "depthFt", 2.2);
    const h = num(d, "heightFt", 3.0);
    const fuel = opt(o, "fuel", "propane");
    const bodyH = h - RANGE_TOP_FT;
    // Cooktop slab, burner discs and door are CONSTANT sections.
    const parts: FixturePart[] = [
      part("body", fuel === "wood" ? "stove" : "cabinet", box(w, bodyH, dp, 0, bodyH / 2, 0)),
      part("top", fuel === "wood" ? "stove" : "steel", box(w, RANGE_TOP_FT, dp, 0, h - RANGE_TOP_FT / 2, 0)),
      part("door", fuel === "wood" ? "stove" : "steel", box(w - 0.14, bodyH * 0.55, RANGE_DOOR_FT, 0, bodyH * 0.42, dp / 2 - RANGE_DOOR_FT / 2)),
      part("glass", "glass", box(w * 0.6, bodyH * 0.3, 0.04, 0, bodyH * 0.45, dp / 2 - 0.02)),
    ];
    if (fuel === "wood") {
      // Two plates rather than four burners, and a flue — which, like the wood
      // stove's, stands outside the body's stated extents on purpose.
      for (const sx of [-1, 1]) {
        parts.push(
          part(`plate-${sx > 0 ? "e" : "w"}`, "steel", cyl(RANGE_BURNER_R_FT * 1.2, 0.03, sx * w * 0.22, h - 0.015, 0, 12)),
        );
      }
      parts.push(part("flue", "steel", cyl(STOVE_FLUE_R_FT, STOVE_FLUE_FT, 0, h + STOVE_FLUE_FT / 2, -dp * 0.3, 12)));
    } else {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          parts.push(
            part(
              `burner-${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
              fuel === "propane" ? "stove" : "glass",
              cyl(RANGE_BURNER_R_FT, 0.03, sx * w * 0.24, h - 0.015, sz * dp * 0.22, 12),
            ),
          );
        }
      }
    }
    return parts;
  },
};

/* ----------------------------------------------------- FLOOR: counter run */

/** The countertop is the SAME slab the island has — same material, same
 *  thickness, and it does not thicken when the run gets longer. */
const COUNTER_TOE_FT = 0.35;
const COUNTER_SPLASH_FT = 0.06;
/** The tap stands above the counter, and it is part of the object's height
 *  because anything hung over the sink has to clear it. */
const COUNTER_TAP_FT = 0.55;
const SINK_FT = 1.8;
/** NKBA's landing areas either side of the primary sink. Named, unverified. */
const SINK_LANDING_MAIN_FT = 24 * IN;
const SINK_LANDING_SECOND_FT = 18 * IN;

/** Where the sink actually sits, held inside the run. One source for the facts
 *  and the geometry so the drawing and the landing numbers cannot disagree. */
function sinkCentreFt(d: Dims): number {
  const l = num(d, "lengthFt", 8);
  const wanted = num(d, "sinkOffsetFt", 3.0);
  return Math.min(Math.max(wanted, SINK_FT / 2 + 0.3), Math.max(SINK_FT / 2 + 0.3, l - SINK_FT / 2 - 0.3));
}

const counterRun: FixtureKind = {
  id: "counter-run",
  mount: "floor",
  label: "Counter run",
  tag: "KC",
  blurb:
    "The working counter with the sink in it — the piece the whole kitchen is measured from, and the drain the greywater diverter is switching.",
  dimensions: [
    { key: "lengthFt", label: "Length", unit: "ft", min: 3, max: 16, step: 0.1, default: 8.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 1.8, max: 3.0, step: 0.05, default: 2.1, hint: "2 ft 1 is the usual 25 in counter" },
    { key: "heightFt", label: "Counter height", unit: "ft", min: 2.6, max: 3.6, step: 0.02, default: 3.0 },
    { key: "sinkOffsetFt", label: "Sink from the left end", unit: "ft", min: 0.5, max: 15, step: 0.25, default: 3.0, hint: "held inside the run whatever you ask for" },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "lengthFt", 8),
    depthFt: num(d, "depthFt", 2.1),
    // The tap is the top of the object, not the counter.
    heightFt: num(d, "heightFt", 3.0) + COUNTER_TAP_FT,
  }),
  clearances: () => [
    rule({
      key: "work-aisle",
      label: "Work aisle",
      zone: "circulation",
      front: 42 * IN,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "guideline",
      source: "NKBA Kitchen Planning Guidelines — a design guideline, not a building code",
      note: "42 in between this run and whatever is behind the cook, which is the same figure the island carries and for the same reason.",
    }),
  ],
  facts: (d) => {
    const l = num(d, "lengthFt", 8);
    const dp = num(d, "depthFt", 2.1);
    const centre = sinkCentreFt(d);
    const left = Math.max(0, centre - SINK_FT / 2);
    const right = Math.max(0, l - centre - SINK_FT / 2);
    const big = Math.max(left, right);
    const small = Math.min(left, right);
    const meets = big >= SINK_LANDING_MAIN_FT && small >= SINK_LANDING_SECOND_FT;
    return [
      {
        key: "counter",
        label: "Counter area",
        value: l * dp,
        unit: "sq ft",
        text: `${(l * dp).toFixed(1)} sq ft, ${feetInches(l)} of run`,
      },
      {
        key: "landing",
        label: "Landing either side of the sink",
        value: Math.min(left, right),
        unit: "ft",
        text: `${feetInches(left)} left, ${feetInches(right)} right — ${meets ? "meets" : "short of"} the ${feetInches(SINK_LANDING_MAIN_FT)} / ${feetInches(SINK_LANDING_SECOND_FT)} guideline`,
        note:
          "The NKBA's kitchen planning guidelines ask for about 24 in of counter on one side of the primary sink and 18 in on the other. A design guideline, not a code, and not verified here against its current edition — but it is the difference between a counter you can stack a drying rack of dishes on and one you cannot.",
      },
      {
        key: "greywater",
        label: "Where the water goes",
        value: 0,
        unit: "",
        text: "This drain is the one the greywater diverter switches",
        note:
          "Kitchen water carries grease and food solids and is the fraction of greywater most reuse systems refuse. If this home has a diverter fixture, the seasonal switch it makes is about this sink and the shower, not about the toilet.",
      },
    ];
  },
  build: (d) => {
    const l = num(d, "lengthFt", 8);
    const dp = num(d, "depthFt", 2.1);
    const h = num(d, "heightFt", 3.0);
    const centre = sinkCentreFt(d) - l / 2;
    return [
      part("base", "cabinet", box(l, h - ISLAND_SLAB_FT, dp - 0.06, 0, (h - ISLAND_SLAB_FT) / 2, 0.03)),
      part("counter", "steel", box(l, ISLAND_SLAB_FT, dp, 0, h - ISLAND_SLAB_FT / 2, 0)),
      part("toe", "cabinet", box(l - 0.2, COUNTER_TOE_FT, dp - 0.3, 0, COUNTER_TOE_FT / 2, 0.06)),
      // Splash, basin and tap are CONSTANT: a 16-foot run gets a longer counter,
      // not a bigger sink.
      part("splash", "steel", box(l, 0.35, COUNTER_SPLASH_FT, 0, h + 0.175, -dp / 2 + COUNTER_SPLASH_FT / 2)),
      part("basin", "steel", box(SINK_FT, 0.45, dp - 0.5, centre, h - ISLAND_SLAB_FT - 0.225, 0)),
      part("tap", "steel", cyl(0.06, COUNTER_TAP_FT, centre, h + COUNTER_TAP_FT / 2, -dp / 2 + 0.25, 8)),
    ];
  },
};

/* ===========================================================================
   FLOOR: THE BATHROOM

   Four fixtures whose numbers come from the NKBA's published bathroom planning
   guidelines. They are GUIDELINES: a code minimum also exists in most
   jurisdictions and is usually smaller — 15 in from a toilet centreline where
   the guideline asks 18, 21 in of clear floor where it asks 30 — and the
   authority having jurisdiction governs. Nothing here has been checked against
   the current edition of either document, which is what `verifiedAgainstSource`
   is saying on every one of them.

   The facts, on the other hand, are arithmetic on stated assumptions, and they
   are the reason these are worth placing at all in a house that carries its
   own water: a bath is 150 litres out of the cistern and the same 150 litres
   through the water heater.
   =========================================================================== */

const NKBA_BATH_SOURCE =
  "NKBA Bathroom Planning Guidelines — a design guideline, not a building code";

/** Clear floor space the guideline asks for in front of a fixture. */
const NKBA_CLEAR_FT = 30 * IN;
/** Centreline to any obstruction, either side of a toilet. */
const NKBA_WC_CENTRE_FT = 18 * IN;

/* ---------------------------------------------------------- FLOOR: vanity */

const VANITY_SLAB_FT = 0.12;
const VANITY_TOE_FT = 0.3;
const VANITY_BASIN_FT = 0.42;
/** The tap, which is part of the object's height because anything hung over
 *  the basin has to clear it. Constant. */
const VANITY_TAP_FT = 0.45;

const vanity: FixtureKind = {
  id: "vanity",
  mount: "floor",
  label: "Vanity",
  tag: "VN",
  blurb:
    "The basin and the only storage the bathroom of a small house gets, which is why its width is usually decided by the door beside it.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.6, max: 6, step: 0.05, default: 3.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 1.2, max: 2.2, step: 0.05, default: 1.7 },
    { key: "heightFt", label: "Counter height", unit: "ft", min: 2.4, max: 3.2, step: 0.05, default: 2.75, hint: "2 ft 9 is the common 33 in vanity" },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 3.0),
    depthFt: num(d, "depthFt", 1.7),
    heightFt: num(d, "heightFt", 2.75) + VANITY_TAP_FT,
  }),
  clearances: () => [
    rule({
      key: "clear-floor",
      label: "Clear floor space in front",
      zone: "circulation",
      front: NKBA_CLEAR_FT,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "guideline",
      source: NKBA_BATH_SOURCE,
      note:
        "Commonly quoted as 30 in of clear floor in front of a lavatory. The code minimum most jurisdictions enforce is smaller — around 21 in — so this box is the comfortable figure, not the legal one, and neither has been checked here against its current edition.",
    }),
  ],
  facts: (d) => {
    const w = num(d, "widthFt", 3.0);
    return [
      {
        key: "basins",
        label: "Basins",
        value: w >= 5 ? 2 : 1,
        unit: "",
        text: w >= 5 ? "Wide enough for two basins" : "One basin",
        note:
          w >= 5
            ? "Two basins costs you the counter between them, which in a bathroom this size is the only place anything gets put down. It is usually the wrong trade in a small house."
            : "One basin and the counter either side of it, which is the arrangement a small bathroom actually uses.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 3.0);
    const dp = num(d, "depthFt", 1.7);
    const h = num(d, "heightFt", 2.75);
    // Slab, basin and tap are CONSTANT. A six-foot vanity is a longer cabinet
    // with the same basin in it.
    return [
      part("carcass", "cabinet", box(w, h - VANITY_SLAB_FT, dp - 0.05, 0, (h - VANITY_SLAB_FT) / 2, 0.025)),
      part("counter", "steel", box(w, VANITY_SLAB_FT, dp, 0, h - VANITY_SLAB_FT / 2, 0)),
      part("toe", "cabinet", box(w - 0.16, VANITY_TOE_FT, dp - 0.3, 0, VANITY_TOE_FT / 2, 0.06)),
      part("basin", "porcelain", box(VANITY_BASIN_FT * 3, VANITY_BASIN_FT, dp - 0.55, 0, h - VANITY_SLAB_FT - VANITY_BASIN_FT / 2, 0.05)),
      part("tap", "steel", cyl(0.05, VANITY_TAP_FT, 0, h + VANITY_TAP_FT / 2, -dp / 2 + 0.22, 8)),
    ];
  },
};

/* ---------------------------------------------------------- FLOOR: toilet */

const WC_SEAT_FT = 0.09;
const WC_VENT_R_FT = 2 * IN;
/** A common current low-flow flush. INDICATIVE, and the arithmetic in the fact
 *  says so — dual-flush units use less on the small flush and older ones use
 *  three times this. */
const FLUSH_LITRES = 4.8;
const FLUSHES_PER_PERSON_DAY = 5;

const toilet: FixtureKind = {
  id: "toilet",
  mount: "floor",
  label: "Toilet",
  tag: "WC",
  blurb:
    "The fixture that decides whether this house needs a septic field and a winter's worth of stored water, or a vent pipe and somewhere warm to put a composting chamber.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.2, max: 2.0, step: 0.05, default: 1.5 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 2.0, max: 3.2, step: 0.05, default: 2.4 },
    { key: "heightFt", label: "Height", unit: "ft", min: 2.2, max: 3.4, step: 0.05, default: 2.6 },
  ],
  options: [
    {
      key: "type",
      label: "Type",
      default: "flush",
      hint: "Off grid this is a water-budget decision before it is a bathroom one.",
      choices: [
        { id: "flush", label: "Flush", note: "Stored water out and blackwater to a septic system this tool does not model." },
        { id: "composting", label: "Composting", note: "No water and no blackwater, in exchange for a vent to the roof, a warm room and somebody emptying it." },
      ],
    },
  ],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 1.5),
    depthFt: num(d, "depthFt", 2.4),
    heightFt: num(d, "heightFt", 2.6),
  }),
  clearances: (d, o) => {
    const w = num(d, "widthFt", 1.5);
    // The guideline is measured from the CENTRELINE, so the box only has to
    // reach out however far the pan itself does not — the same derivation the
    // electrical panel uses for its 750 mm width.
    const side = Math.max(0, NKBA_WC_CENTRE_FT - w / 2);
    const rules = [
      rule({
        key: "centreline",
        label: "Centreline to anything either side",
        zone: "circulation",
        front: 0,
        back: 0,
        left: side,
        right: side,
        heightFt: null,
        basis: "guideline",
        source: NKBA_BATH_SOURCE,
        note:
          "The guideline asks for 18 in from the centreline to any obstruction each side. Most codes enforce 15 in as a minimum, which is a smaller box than this one; the authority having jurisdiction governs and neither figure has been verified here.",
      }),
      rule({
        key: "clear-floor",
        label: "Clear floor space in front",
        zone: "circulation",
        front: NKBA_CLEAR_FT,
        back: 0,
        left: 0,
        right: 0,
        heightFt: null,
        basis: "guideline",
        source: NKBA_BATH_SOURCE,
        note: "Commonly quoted as 30 in in front of the fixture, against a code minimum nearer 21 in.",
      }),
    ];
    if (opt(o, "type", "flush") === "composting") {
      rules.push(
        rule({
          key: "empty",
          label: "Room to take the chamber out",
          zone: "service",
          front: 2.0,
          back: 0,
          left: 0,
          right: 0,
          heightFt: null,
          basis: "manufacturer",
          source: "composting-toilet installation manuals (Separett, Nature's Head, Sun-Mar and similar)",
          note:
            "The chamber or the tray comes out the front and it is not light. A composting unit built into a 2-ft alcove is a unit nobody empties, and the whole system depends on somebody emptying it.",
        }),
      );
    }
    return rules;
  },
  facts: (_d, o) => {
    if (opt(o, "type", "flush") === "composting") {
      return [
        {
          key: "water",
          label: "Water",
          value: 0,
          unit: "L",
          text: "None, and no blackwater either",
          note:
            "Taking the toilet off the water system is the single biggest change to an off-grid water budget, and it turns the rest of the house's waste into greywater — which is a different, and much easier, permitting conversation in Alberta than a septic system.",
        },
        {
          key: "temperature",
          label: "It only works warm",
          value: 0,
          unit: "",
          text: "The pile stops working below about freezing",
          note:
            "A composting toilet is a slow biological process, and a bathroom left to freeze while the house is empty is a bin rather than a composter. It also needs a vent that runs to the roof and a fan that runs continuously — which is a small but permanent electrical load.",
        },
      ];
    }
    const perPerson = FLUSH_LITRES * FLUSHES_PER_PERSON_DAY;
    return [
      {
        key: "water",
        label: "Water out of the cistern",
        value: perPerson,
        unit: "L",
        text: `About ${perPerson.toFixed(0)} L a person a day`,
        note:
          `Taken at ${FLUSH_LITRES} L a flush and ${FLUSHES_PER_PERSON_DAY} flushes a person, both indicative. Two people is roughly ${(perPerson * 2).toFixed(0)} L a day of stored, hauled or pumped water going down a drain — which is why a cistern's size and a toilet's type are the same decision.`,
      },
      {
        key: "blackwater",
        label: "Where it goes",
        value: 0,
        unit: "",
        text: "Blackwater — a septic system, not a greywater field",
        note:
          "In Alberta a private sewage system is governed by the Private Sewage Systems Standard of Practice and needs its own permit, its own design and its own inspection. This tool models none of that; it places the fixture that creates the requirement.",
      },
    ];
  },
  build: (d, o) => {
    const w = num(d, "widthFt", 1.5);
    const dp = num(d, "depthFt", 2.4);
    const h = num(d, "heightFt", 2.6);
    const composting = opt(o, "type", "flush") === "composting";
    if (composting) {
      const bodyH = h - WC_SEAT_FT;
      return [
        part("body", "cabinet", box(w, bodyH, dp, 0, bodyH / 2, 0)),
        part("seat", "wood", box(w * 0.72, WC_SEAT_FT, dp * 0.62, 0, h - WC_SEAT_FT / 2, dp * 0.16)),
        // The vent runs to the roof. Like the wood stove's flue it is drawn
        // beyond the body's stated extents, because it is a connector and the
        // extents describe the object somebody has to fit into a room.
        part("vent", "steel", cyl(WC_VENT_R_FT, 2.2, 0, h + 1.1, -dp / 2 + WC_VENT_R_FT + 0.05, 8)),
      ];
    }
    const cisternD = 0.55;
    const panH = Math.min(1.35, h - 0.4);
    return [
      part("cistern", "porcelain", box(w, h - 0.55, cisternD, 0, 0.55 + (h - 0.55) / 2, -dp / 2 + cisternD / 2)),
      part("pan", "porcelain", box(w * 0.72, panH, dp - cisternD, 0, panH / 2, -dp / 2 + cisternD + (dp - cisternD) / 2)),
      part("seat", "wood", box(w * 0.68, WC_SEAT_FT, (dp - cisternD) * 0.9, 0, panH + WC_SEAT_FT / 2, -dp / 2 + cisternD + (dp - cisternD) / 2)),
    ];
  },
};

/* ---------------------------------------------------------- FLOOR: shower */

const SHOWER_TRAY_FT = 0.22;
const SHOWER_GLASS_FT = 0.05;
const SHOWER_PANEL_FT = 0.08;
/** A common current low-flow head. INDICATIVE. */
const SHOWER_LPM = 7.6;
const SHOWER_MINUTES = 8;
/** The guideline's minimum interior, 36 in square. */
const SHOWER_MIN_SIDE_FT = 3.0;

const shower: FixtureKind = {
  id: "shower",
  mount: "floor",
  label: "Shower",
  tag: "SW",
  blurb:
    "Eight minutes of stored water that somebody had to heat, which off grid makes it the largest single draw on both the cistern and the hot water in the house.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 2.5, max: 5, step: 0.05, default: 3.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 2.5, max: 5, step: 0.05, default: 3.0 },
    { key: "heightFt", label: "Enclosure height", unit: "ft", min: 6, max: 7.5, step: 0.05, default: 6.9 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 3.0),
    depthFt: num(d, "depthFt", 3.0),
    heightFt: num(d, "heightFt", 6.9),
  }),
  clearances: () => [
    rule({
      key: "clear-floor",
      label: "Clear floor space at the entry",
      zone: "circulation",
      front: NKBA_CLEAR_FT,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "guideline",
      source: NKBA_BATH_SOURCE,
      note:
        "30 in of floor to stand and dry in, on the side the door is. Not verified against the current edition, and the code minimum is smaller.",
    }),
  ],
  facts: (d) => {
    const w = num(d, "widthFt", 3.0);
    const dp = num(d, "depthFt", 3.0);
    const litres = SHOWER_LPM * SHOWER_MINUTES;
    return [
      {
        key: "interior",
        label: "Interior",
        value: w * dp,
        unit: "sq ft",
        text: `${feetInches(w)} × ${feetInches(dp)} — ${w >= SHOWER_MIN_SIDE_FT && dp >= SHOWER_MIN_SIDE_FT ? "at or above" : "below"} the 36 in × 36 in the guideline asks for`,
        note:
          "The NKBA's bathroom guidelines quote 36 in square as the usable minimum interior. Smaller enclosures are sold and installed; they are the ones where you cannot bend down.",
      },
      {
        key: "water",
        label: "Water and heat",
        value: litres,
        unit: "L",
        text: `About ${litres.toFixed(0)} L for an ${SHOWER_MINUTES}-minute shower`,
        note:
          `Taken at ${SHOWER_LPM} L a minute, which is a common current low-flow head; an older one is half as much again. Every litre came out of the cistern and went through the water heater, and in a house running on a battery and a wood-fired coil that second half is the expensive one. A drain-water heat recovery pipe under this fixture is the standard answer and this tool does not draw it.`,
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 3.0);
    const dp = num(d, "depthFt", 3.0);
    const h = num(d, "heightFt", 6.9);
    const above = h - SHOWER_TRAY_FT;
    // Tray, glass and head are CONSTANT sections.
    return [
      part("tray", "porcelain", box(w, SHOWER_TRAY_FT, dp, 0, SHOWER_TRAY_FT / 2, 0)),
      part("wall-back", "cabinet", box(w, above, SHOWER_PANEL_FT, 0, SHOWER_TRAY_FT + above / 2, -dp / 2 + SHOWER_PANEL_FT / 2)),
      part("wall-side", "cabinet", box(SHOWER_PANEL_FT, above, dp, -w / 2 + SHOWER_PANEL_FT / 2, SHOWER_TRAY_FT + above / 2, 0)),
      part("glass-side", "glass", box(SHOWER_GLASS_FT, above, dp, w / 2 - SHOWER_GLASS_FT / 2, SHOWER_TRAY_FT + above / 2, 0)),
      // The front glass stops short of the far corner: that gap is the way in.
      part("glass-front", "glass", box(w * 0.55, above, SHOWER_GLASS_FT, -w * 0.22, SHOWER_TRAY_FT + above / 2, dp / 2 - SHOWER_GLASS_FT / 2)),
      part("riser", "steel", cyl(0.05, above * 0.75, 0, SHOWER_TRAY_FT + above * 0.375, -dp / 2 + 0.2, 8)),
      part("head", "steel", box(0.55, 0.06, 0.55, 0, SHOWER_TRAY_FT + above * 0.75, -dp / 2 + 0.45)),
    ];
  },
};

/* ------------------------------------------------------------ FLOOR: bath */

const BATH_FOOT_FT = 0.3;
const BATH_RIM_FT = 0.14;
/** A bath is not a box. INDICATIVE shape factor, used only to keep the water
 *  volume from being a straight overestimate. */
const BATH_SHAPE_FACTOR = 0.6;

const bath: FixtureKind = {
  id: "bath",
  mount: "floor",
  label: "Bath",
  tag: "BT",
  blurb:
    "A tub of stored, heated water standing on a small footprint, which makes it a water decision, an energy decision and — filled, with somebody in it — a floor-framing one.",
  dimensions: [
    { key: "lengthFt", label: "Length", unit: "ft", min: 4.5, max: 7, step: 0.05, default: 5.5 },
    { key: "widthFt", label: "Width", unit: "ft", min: 2.2, max: 3.2, step: 0.05, default: 2.6 },
    { key: "heightFt", label: "Rim height", unit: "ft", min: 1.6, max: 2.6, step: 0.05, default: 2.0 },
    { key: "waterDepthFt", label: "Water depth", unit: "ft", min: 0.6, max: 1.6, step: 0.05, default: 1.05 },
  ],
  options: [],
  // Length runs along X, as the dining table's does.
  extents: (d) => ({
    widthFt: num(d, "lengthFt", 5.5),
    depthFt: num(d, "widthFt", 2.6),
    heightFt: num(d, "heightFt", 2.0),
  }),
  clearances: () => [
    rule({
      key: "clear-floor",
      label: "Clear floor alongside",
      zone: "circulation",
      front: NKBA_CLEAR_FT,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "guideline",
      source: NKBA_BATH_SOURCE,
      note:
        "30 in of floor along the side you get in from. Getting into a bath is done standing on one leg, which is the reason the figure is not smaller.",
    }),
    rule({
      key: "tap-end",
      label: "Access to the tap end",
      zone: "service",
      front: 0,
      back: 0,
      left: 1.0,
      right: 0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for reaching the tap, the trap and the overflow",
      note:
        "A freestanding bath is plumbed from the floor and it is the fixture most likely to need somebody behind it with a wrench. Boxed into a corner, that becomes a floor that has to come up.",
    }),
  ],
  facts: (d) => {
    const l = num(d, "lengthFt", 5.5);
    const w = num(d, "widthFt", 2.6);
    const depth = Math.min(num(d, "waterDepthFt", 1.05), num(d, "heightFt", 2.0) - 0.25);
    const volFt3 = Math.max(0, l * w * depth * BATH_SHAPE_FACTOR);
    const litres = volFt3 * LITRES_PER_CU_FT;
    const lb = volFt3 * WATER_LB_PER_CU_FT;
    const footprint = Math.max(0.1, l * w);
    return [
      {
        key: "volume",
        label: "Water",
        value: litres,
        unit: "L",
        text: `About ${Math.round(litres)} L to fill`,
        note: `Taken at ${BATH_SHAPE_FACTOR} of the box the tub occupies, because a bath is not a box — indicative, and generous rather than mean. Every litre is stored water that was heated.`,
      },
      {
        key: "load",
        label: "Weight when full",
        value: lb,
        unit: "lb",
        text: `${Math.round(lb).toLocaleString("en-CA")} lb of water — about ${Math.round(lb / footprint)} lb/sq ft over its own footprint`,
        note:
          "Water alone; the tub and the person in it are on top of that. A residential floor is commonly designed for 40 lb/sq ft of live load, so a filled bath is a concentrated load worth naming to whoever sizes the joists — particularly on a raised floor over a crawl space or on piles.",
      },
    ];
  },
  build: (d) => {
    const l = num(d, "lengthFt", 5.5);
    const w = num(d, "widthFt", 2.6);
    const h = num(d, "heightFt", 2.0);
    const depth = Math.min(num(d, "waterDepthFt", 1.05), h - 0.25);
    const shellH = h - BATH_FOOT_FT;
    // Feet and rim are CONSTANT: a longer bath is a longer bath.
    const parts: FixturePart[] = [
      part("shell", "porcelain", box(l, shellH, w, 0, BATH_FOOT_FT + shellH / 2, 0)),
      part("rim", "porcelain", box(l, BATH_RIM_FT, w, 0, h - BATH_RIM_FT / 2, 0)),
      part("water", "water", box(l - 0.5, 0.06, w - 0.5, 0, Math.max(BATH_FOOT_FT + 0.1, depth), 0)),
    ];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(
          part(
            `foot-${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
            "steel",
            box(0.22, BATH_FOOT_FT, 0.22, sx * (l / 2 - 0.5), BATH_FOOT_FT / 2, sz * (w / 2 - 0.3)),
          ),
        );
      }
    }
    return parts;
  },
};

/* ----------------------------------------------------------- WALL: AWG */

const awg: FixtureKind = {
  id: "awg",
  mount: "wall",
  label: "AWG unit",
  tag: "AW",
  blurb: "Atmospheric water generation — condensing drinking water out of the air.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.0, max: 4, step: 0.05, default: 2.0 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 0.7, max: 2.0, step: 0.05, default: 1.2 },
    { key: "heightFt", label: "Height", unit: "ft", min: 1.2, max: 5, step: 0.05, default: 3.0 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 2.0),
    depthFt: num(d, "depthFt", 1.2),
    heightFt: num(d, "heightFt", 3.0),
  }),
  clearances: () => [
    rule({
      key: "airflow",
      label: "Intake and discharge air",
      zone: "airflow",
      front: 2.0,
      back: 0,
      left: 0.5,
      right: 0.5,
      heightFt: null,
      basis: "manufacturer",
      source: "AWG unit installation manuals",
      note: "An AWG is a condenser: starve it of air and it produces nothing. The unit's manual carries the real figures.",
    }),
  ],
  facts: () => [
    {
      key: "yield",
      label: "Water yield",
      value: 0,
      unit: "",
      text: "Yield is climate-dependent and is NOT estimated here",
      note:
        "Atmospheric water output falls with temperature and with relative humidity, and in an Alberta winter it falls a very long way. This tool places the unit and reserves its air; it does not predict litres per day, because a number produced without the local psychrometric data would be fiction.",
    },
  ],
  build: (d) => {
    const w = num(d, "widthFt", 2.0);
    const dp = num(d, "depthFt", 1.2);
    const h = num(d, "heightFt", 3.0);
    return [
      part("case", "cabinet", box(w, h, dp, 0, h / 2, 0)),
      // Louvre and spout are CONSTANT — with one correction to that sentence,
      // which was looser than the code beneath it. The spout is constant on
      // all three axes. The louvre is the case's grille: its height and depth
      // hold, and its WIDTH is w - 0.3 and always has been. Both readings are
      // declared per axis in tests/furniture-fixtures.spec.ts and checked
      // there against every dimension; this comment on its own measures
      // nothing, which is how the spout stayed unguarded.
      part("louvre", "steel", box(w - 0.3, 0.55, 0.05, 0, h * 0.72, dp / 2 + 0.03)),
      part("spout", "steel", box(0.35, 0.12, 0.25, 0, h * 0.3, dp / 2 + 0.12)),
    ];
  },
};

/* -------------------------------------------------- WALL: electrical panel */

const electricalPanel: FixtureKind = {
  id: "electrical-panel",
  mount: "wall",
  label: "Electrical panel",
  tag: "EP",
  blurb: "The distribution panel — and the working space in front of it, which is a real piece of floor.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 0.9, max: 2.5, step: 0.05, default: 1.3 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 0.25, max: 0.9, step: 0.05, default: 0.5 },
    { key: "heightFt", label: "Height", unit: "ft", min: 1.5, max: 4.5, step: 0.05, default: 2.6 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 1.3),
    depthFt: num(d, "depthFt", 0.5),
    heightFt: num(d, "heightFt", 2.6),
  }),
  clearances: (d) => {
    const w = num(d, "widthFt", 1.3);
    // The code's width is the greater of 750 mm and the equipment width, so
    // the side extension is whatever it takes to reach that.
    const side = Math.max(0, (750 * MM - w) / 2);
    return [
      rule({
        key: "working",
        label: "Working space",
        zone: "working-space",
        front: 1000 * MM,
        back: 0,
        left: side,
        right: side,
        heightFt: 2200 * MM,
        from: "floor",
        basis: "code",
        source:
          "Canadian Electrical Code (CSA C22.1) Rule 2-308, working space about electrical equipment — cited by name, figure not verified",
        note:
          "1 m of clear depth, a width of not less than 750 mm or the equipment width, and 2.2 m of headroom. This space must stay clear: it is not somewhere a cistern, a sofa or a set of shelves may end up. Verify the figures against the edition of the Code that the Alberta permit is issued under.",
      }),
    ];
  },
  facts: () => [
    {
      key: "access",
      label: "Access",
      value: 0,
      unit: "",
      text: "The working space must remain permanently clear",
      note: "An inspector will look at what is in front of the panel, not at what was in front of it on the drawing.",
    },
  ],
  build: (d) => {
    const w = num(d, "widthFt", 1.3);
    const dp = num(d, "depthFt", 0.5);
    const h = num(d, "heightFt", 2.6);
    return [
      part("can", "steel", box(w, h, dp, 0, h / 2, 0)),
      // The door lip is CONSTANT — it is a piece of folded steel, not a ratio.
      part("door", "steel", box(w - 0.06, h - 0.06, PANEL_DOOR_FT, 0, h / 2, dp / 2 + PANEL_DOOR_FT / 2)),
      part("handle", "steel", box(0.1, 0.35, 0.06, w / 2 - 0.14, h * 0.5, dp / 2 + PANEL_DOOR_FT + 0.03)),
    ];
  },
};

const PANEL_DOOR_FT = 0.06;

/* ------------------------------------------------------- WALL: thermostat */

const thermostat: FixtureKind = {
  id: "thermostat",
  mount: "wall",
  label: "Thermostat",
  tag: "TH",
  blurb: "Small, and the most position-sensitive object in the house.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 0.25, max: 0.8, step: 0.02, default: 0.42 },
    { key: "heightFt", label: "Height", unit: "ft", min: 0.2, max: 0.7, step: 0.02, default: 0.35 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 0.42),
    depthFt: THERMOSTAT_DEPTH_FT,
    heightFt: num(d, "heightFt", 0.35),
  }),
  clearances: () => [
    rule({
      key: "influence",
      label: "Away from anything that lies to it",
      zone: "service",
      front: 1.0,
      back: 0,
      left: 1.5,
      right: 1.5,
      heightFt: 2.0,
      basis: "indicative",
      source: "none — a working allowance around a sensor",
      note:
        "A thermostat in direct sun, above a heater, beside a door or on a cold exterior wall reports a temperature the room does not have, and the house then heats to the wrong one. This box is a reminder, not a rule; the resolver additionally flags a thermostat placed close to an opening.",
    }),
  ],
  facts: () => [
    {
      key: "height",
      label: "Mounting height",
      value: 1500 * MM,
      unit: "ft",
      text: "About 1.5 m above the floor is the usual mounting height",
      note: "Common practice, and it is also roughly where a wall-mounted control is reachable from a seated position. Not a code figure.",
    },
  ],
  build: (d) => {
    const w = num(d, "widthFt", 0.42);
    const h = num(d, "heightFt", 0.35);
    return [
      part("plate", "cabinet", box(w, h, THERMOSTAT_DEPTH_FT, 0, h / 2, 0)),
      part("screen", "glass", box(w - 0.1, h - 0.1, 0.02, 0, h / 2, THERMOSTAT_DEPTH_FT / 2 + 0.01)),
    ];
  },
};

const THERMOSTAT_DEPTH_FT = 0.13;

/* -------------------------------------------------- WALL: greywater valve */

const greywaterValve: FixtureKind = {
  id: "greywater-valve",
  mount: "wall",
  label: "Greywater diverter",
  tag: "GV",
  blurb: "The valve that sends greywater to reuse in summer and to the tank in winter. It has to be reachable.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 0.5, max: 2, step: 0.05, default: 0.9 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 0.3, max: 1.0, step: 0.05, default: 0.55 },
    { key: "heightFt", label: "Height", unit: "ft", min: 0.6, max: 2.5, step: 0.05, default: 1.2 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 0.9),
    depthFt: num(d, "depthFt", 0.55),
    heightFt: num(d, "heightFt", 1.2),
  }),
  clearances: () => [
    rule({
      key: "operate",
      label: "Room to operate and service",
      zone: "service",
      front: 2.0,
      back: 0,
      left: 0.5,
      right: 0.5,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for turning a valve and getting at a union",
      note:
        "A diverter that is behind a cistern is a diverter nobody switches over in October. The greywater SYSTEM itself is governed in Alberta by the Private Sewage Systems Standard of Practice and its permits — none of which this tool models.",
    }),
  ],
  facts: () => [
    {
      key: "seasonal",
      label: "Seasonal duty",
      value: 0,
      unit: "",
      text: "Summer to reuse, winter to the tank",
      note: "A greywater reuse field that freezes is a greywater backup. The diverter is the whole reason that is a switch and not a rebuild.",
    },
  ],
  build: (d) => {
    const w = num(d, "widthFt", 0.9);
    const dp = num(d, "depthFt", 0.55);
    const h = num(d, "heightFt", 1.2);
    return [
      part("body", "cabinet", box(w, h, dp, 0, h / 2, 0)),
      // Rotate FIRST, then translate: a rotate after a translate would swing
      // the handle around the fixture origin instead of standing it up.
      part("handle", "steel", cyl(0.09, 0.5).rotateX(Math.PI / 2).translate(0, h * 0.6, dp / 2 + 0.25)),
      part("pipe-in", "steel", cyl(0.16, 0.4, 0, h + 0.2, 0, 10)),
      part("pipe-out", "steel", cyl(0.16, 0.4, 0, -0.05, 0, 10)),
    ];
  },
};

/* ------------------------------------------------------ WALL: wall heater */

const wallHeater: FixtureKind = {
  id: "wall-heater",
  mount: "wall",
  label: "Wall heater",
  tag: "WH",
  blurb: "Backup or shoulder-season heat where the stove does not reach.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.0, max: 4.5, step: 0.05, default: 2.4 },
    { key: "depthFt", label: "Depth", unit: "ft", min: 0.25, max: 1.0, step: 0.05, default: 0.5 },
    { key: "heightFt", label: "Height", unit: "ft", min: 0.6, max: 2.5, step: 0.05, default: 1.4 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 2.4),
    depthFt: num(d, "depthFt", 0.5),
    heightFt: num(d, "heightFt", 1.4),
  }),
  clearances: () => [
    rule({
      key: "combustible",
      label: "To combustibles and furnishings",
      zone: "combustible",
      front: 3.0,
      back: 0,
      left: 0.5,
      right: 0.5,
      heightFt: null,
      basis: "manufacturer",
      source: "wall-heater installation manuals — a typical figure for the product class",
      note:
        "Commonly 3 ft in front, 6 in at the sides and 12 in above for a residential wall heater, but this varies by unit and by fuel and the manual is the authority. It is flagged in the combustible zone deliberately: a curtain or a sofa back inside this box is the actual failure mode.",
    }),
    rule({
      key: "above",
      label: "Above the unit",
      zone: "combustible",
      front: 0,
      back: 0,
      left: 0,
      right: 0,
      heightFt: 1.0,
      from: "top",
      basis: "manufacturer",
      source: "wall-heater installation manuals",
      note: "Typical. Drawn as a slab above the unit so a shelf placed over it is visible.",
    }),
  ],
  facts: () => [],
  build: (d) => {
    const w = num(d, "widthFt", 2.4);
    const dp = num(d, "depthFt", 0.5);
    const h = num(d, "heightFt", 1.4);
    const parts: FixturePart[] = [part("case", "cabinet", box(w, h, dp, 0, h / 2, 0))];
    // Three grille bars, always three, always the same thickness.
    for (let i = 0; i < 3; i++) {
      parts.push(
        part(`grille${i}`, "steel", box(w - 0.25, 0.09, 0.04, 0, h * (0.32 + i * 0.18), dp / 2 + 0.03)),
      );
    }
    return parts;
  },
};

/* ------------------------------------------------------- WALL: coat rail */

const RAIL_BOARD_FT = 0.08;
const RAIL_SHELF_FT = 0.1;
const RAIL_HOOK_R_FT = 0.05;
/** Hooks at a foot apart, because the garment on them is a parka and not a
 *  shirt. Constant: a longer rail is MORE hooks. */
const RAIL_HOOK_PITCH_FT = 1.0;
/** Where a rail this shape normally lands, and the default a new one takes. */
const RAIL_MOUNT_FT = 5.0;

const coatRail: FixtureKind = {
  id: "coat-rail",
  mount: "wall",
  label: "Coat rail",
  tag: "CR",
  blurb:
    "Where four wet parkas and a snow suit hang inside the door, which in this climate is a permanent fixture rather than a hook somebody screwed to a wall.",
  dimensions: [
    { key: "widthFt", label: "Width", unit: "ft", min: 1.5, max: 8, step: 0.1, default: 4.0 },
    { key: "depthFt", label: "Projection", unit: "ft", min: 0.6, max: 1.6, step: 0.05, default: 0.95, hint: "how far a loaded hook stands off the wall" },
    { key: "heightFt", label: "Board height", unit: "ft", min: 0.5, max: 1.4, step: 0.05, default: 0.85 },
  ],
  options: [],
  extents: (d) => ({
    widthFt: num(d, "widthFt", 4.0),
    depthFt: num(d, "depthFt", 0.95),
    heightFt: num(d, "heightFt", 0.85),
  }),
  // Only used to choose where a NEW one is hung; the placement then owns it.
  baseHeightFt: () => RAIL_MOUNT_FT,
  clearances: () => [
    rule({
      key: "hanging",
      label: "Room for what hangs on it",
      zone: "service",
      front: 2.0,
      back: 0,
      left: 0,
      right: 0,
      heightFt: null,
      basis: "indicative",
      source: "none — a working allowance for a loaded hook and the person reaching past it",
      note:
        "A coat on a hook is a foot deep before anybody stands in front of it. This box is at coat height rather than at floor height, so a bench tucked underneath is not reported as a conflict — that is the correct arrangement, not a clash.",
    }),
  ],
  facts: (d) => {
    const w = num(d, "widthFt", 4.0);
    const hooks = Math.max(1, Math.floor(w / RAIL_HOOK_PITCH_FT));
    return [
      {
        key: "hooks",
        label: "Hooks",
        value: hooks,
        unit: "",
        text: `${hooks} at ${feetInches(RAIL_HOOK_PITCH_FT)} apart`,
        note:
          "A foot apart, because winter outerwear is bulky and hooks any closer hold half as many coats as they appear to. More width is more hooks at the same spacing.",
      },
      {
        key: "wet",
        label: "The floor under it",
        value: 0,
        unit: "",
        text: "Wet coats drip, and this is where",
        note:
          "Snow melts off a shell for twenty minutes after somebody comes in. The floor below wants to take that, and the room wants somewhere for the moisture to go — which in a tight house means the HRV, and in a cold one means not hanging them over a cold exterior wall where the wall gets the condensation instead.",
      },
    ];
  },
  build: (d) => {
    const w = num(d, "widthFt", 4.0);
    const dp = num(d, "depthFt", 0.95);
    const h = num(d, "heightFt", 0.85);
    const hooks = Math.max(1, Math.floor(w / RAIL_HOOK_PITCH_FT));
    // Board, shelf and hook are CONSTANT sections.
    const parts: FixturePart[] = [
      part("board", "wood", box(w, h, RAIL_BOARD_FT, 0, h / 2, -dp / 2 + RAIL_BOARD_FT / 2)),
      part("shelf", "wood", box(w, RAIL_SHELF_FT, dp, 0, h - RAIL_SHELF_FT / 2, 0)),
    ];
    for (let i = 0; i < hooks; i++) {
      const x = -w / 2 + (w / hooks) * (i + 0.5);
      parts.push(
        part(
          `hook${i}`,
          "steel",
          cyl(RAIL_HOOK_R_FT, dp - RAIL_BOARD_FT, 0, 0, 0, 6)
            .rotateX(Math.PI / 2)
            .translate(x, h * 0.35, RAIL_BOARD_FT / 2),
        ),
      );
    }
    return parts;
  },
};

/* -------------------------------------------------------- ROOF: PV array */

const solarArray: FixtureKind = {
  id: "solar-array",
  mount: "roof",
  label: "Solar array",
  tag: "PV",
  blurb: "Sized in kW, drawn at the area that many modules actually cover, on a plane at the roof's own pitch.",
  dimensions: [
    { key: "kw", label: "Array size", unit: "kW", min: 0.5, max: 30, step: 0.1, default: 6.0 },
    /* 3 rows is the default because it is what fits the Aura reference home:
       a 6 kW array laid 2 rows deep is 30 ft across and the reference gable
       plane is 26.5 ft, so the tool would open by reporting a fixture that
       does not fit. Three rows is also a normal residential portrait layout,
       so this is a better default rather than a number chosen to hide a
       warning — and if it still does not fit, the warning is the point. */
    { key: "rowsDeep", label: "Rows up the slope", unit: "count", min: 1, max: 8, step: 1, default: 3, hint: "modules stacked up the slope; the rest go across" },
  ],
  options: [],
  extents: (d) => {
    const g = pvGrid(d);
    return { widthFt: g.acrossFt, depthFt: g.alongSlopeFt, heightFt: PV_THICKNESS_FT + PV_STANDOFF_FT };
  },
  clearances: () => [
    rule({
      key: "edge",
      label: "Roof-edge setback",
      zone: "service",
      front: 1.0,
      back: 1.0,
      left: 1.0,
      right: 1.0,
      heightFt: 0.2,
      basis: "indicative",
      source:
        "none — a working setback so modules are not hung over an eave or a rake. Fire-service access setbacks are set by the authority having jurisdiction; there is no single national figure that applies in Alberta, and the well-known 3-foot ridge setback belongs to the California Fire Code and is NOT quoted here as if it did.",
      note:
        "Keeps the array off the edge for wind uplift and for anyone working on the roof. Ask the AHJ what access path, if any, it requires before the array is finalised.",
    }),
  ],
  facts: (d) => {
    const g = pvGrid(d);
    return [
      {
        key: "modules",
        label: "Modules",
        value: g.modules,
        unit: "",
        text: `${g.modules} modules at ${PV_MODULE_WATTS} W nominal (${g.cols} across × ${g.rows} up the slope)`,
        note: `Module size is an indicative ${(PV_MODULE_W_FT * 12).toFixed(0)} × ${(PV_MODULE_H_FT * 12).toFixed(0)} in, close to a common 400 W panel. The real module comes from the supplier.`,
      },
      {
        key: "area",
        label: "Array area",
        value: g.areaSqFt,
        unit: "sq ft",
        text: `${g.areaSqFt.toFixed(0)} sq ft measured ON the slope`,
        note: `The drawing engine's ${ARRAY_SQ_FT_PER_KW} sq ft per kW rule of thumb gives ${(num(d, "kw", 6) * ARRAY_SQ_FT_PER_KW).toFixed(0)} sq ft for this size; the module grid is the number drawn.`,
      },
      {
        key: "dc",
        label: "Nominal DC",
        value: (g.modules * PV_MODULE_WATTS) / 1000,
        unit: "kW",
        text: `${((g.modules * PV_MODULE_WATTS) / 1000).toFixed(2)} kW DC as laid out`,
        note:
          "Nameplate DC only. Annual yield depends on latitude, tilt, azimuth, shading, snow cover and inverter losses, and is not estimated here.",
      },
    ];
  },
  build: (d, _o, ctx) => {
    const g = pvGrid(d);
    const parts: FixturePart[] = [];
    // Built in the TILTED frame: the along-slope axis is the roof's fall axis,
    // so after the single tilt rotation the modules lie in the roof plane.
    const alongIsX = ctx.fallAxis === "x";
    const sizeAlong = PV_MODULE_H_FT;
    const sizeAcross = PV_MODULE_W_FT;

    if (g.modules > PV_MAX_DRAWN_MODULES) {
      // An honest slab rather than 400 boxes: the area is right, the grain is
      // not drawn, and the schedule still reports the module count.
      const w = alongIsX ? g.alongSlopeFt : g.acrossFt;
      const dp = alongIsX ? g.acrossFt : g.alongSlopeFt;
      parts.push(part("slab", "pv", box(w, PV_THICKNESS_FT, dp, 0, 0, 0)));
      parts.push(part("rail", "steel", box(w, PV_RAIL_FT, dp, 0, -PV_THICKNESS_FT / 2 - PV_RAIL_FT / 2, 0)));
      return parts;
    }

    const pitchAlong = sizeAlong + PV_GAP_FT;
    const pitchAcross = sizeAcross + PV_GAP_FT;
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        if (r * g.cols + c >= g.modules) break;
        const a = (r - (g.rows - 1) / 2) * pitchAlong;
        const s = (c - (g.cols - 1) / 2) * pitchAcross;
        const x = alongIsX ? a : s;
        const z = alongIsX ? s : a;
        const w = alongIsX ? sizeAlong : sizeAcross;
        const dp = alongIsX ? sizeAcross : sizeAlong;
        parts.push(part(`m${r}-${c}`, "pv", box(w, PV_THICKNESS_FT, dp, x, 0, z)));
      }
    }
    // Two rails, always two, always the same section. Constant, on purpose.
    const railAlong = alongIsX ? g.alongSlopeFt : PV_RAIL_W_FT;
    const railAcross = alongIsX ? PV_RAIL_W_FT : g.alongSlopeFt;
    const off = (alongIsX ? g.acrossFt : g.alongSlopeFt) * 0.3;
    for (const sgn of [-1, 1]) {
      const x = alongIsX ? 0 : sgn * off;
      const z = alongIsX ? sgn * off : 0;
      parts.push(
        part(
          `rail${sgn > 0 ? "b" : "a"}`,
          "steel",
          box(railAlong, PV_RAIL_FT, railAcross, x, -PV_THICKNESS_FT / 2 - PV_RAIL_FT / 2, z),
        ),
      );
    }
    return parts;
  },
};

const PV_RAIL_FT = 0.12;
const PV_RAIL_W_FT = 0.16;

/** The module grid for an array size. Deterministic, and the single place the
 *  array's real extent is decided. */
export function pvGrid(d: Dims): {
  modules: number;
  rows: number;
  cols: number;
  alongSlopeFt: number;
  acrossFt: number;
  areaSqFt: number;
} {
  const kw = Math.max(0.1, num(d, "kw", 6));
  const modules = Math.max(1, Math.ceil((kw * 1000) / PV_MODULE_WATTS));
  const rows = Math.max(1, Math.min(Math.round(num(d, "rowsDeep", 2)), modules));
  const cols = Math.ceil(modules / rows);
  return {
    modules,
    rows,
    cols,
    alongSlopeFt: rows * PV_MODULE_H_FT + (rows - 1) * PV_GAP_FT,
    acrossFt: cols * PV_MODULE_W_FT + (cols - 1) * PV_GAP_FT,
    areaSqFt: modules * PV_MODULE_W_FT * PV_MODULE_H_FT,
  };
}

/* ------------------------------------------------------------ the catalogue */

export const FIXTURE_CATALOG: Readonly<Record<FixtureKindId, FixtureKind>> = {
  "wood-stove": woodStove,
  "hot-tub": hotTub,
  cistern,
  "battery-bank": batteryBank,
  hrv,
  "kitchen-island": kitchenIsland,
  "counter-run": counterRun,
  range,
  refrigerator,
  "dining-table": diningTable,
  "dining-chair": diningChair,
  sofa,
  armchair,
  bed,
  bunk,
  wardrobe,
  dresser,
  shelving,
  "entry-bench": entryBench,
  "firewood-store": firewoodStore,
  "drying-rack": dryingRack,
  vanity,
  toilet,
  shower,
  bath,
  awg,
  "electrical-panel": electricalPanel,
  thermostat,
  "greywater-valve": greywaterValve,
  "wall-heater": wallHeater,
  "coat-rail": coatRail,
  "solar-array": solarArray,
};

/**
 * Palette order: the systems that shape a plan first, then the furniture in the
 * order a person furnishes rooms — kitchen, then where you eat and sit, then
 * where you sleep and put things, then the door, then the bathroom.
 *
 * It is a list, and a list drifts: a kind that is in `FIXTURE_CATALOG` and not
 * in here has no button in the palette and cannot be placed at all, silently.
 * `tests/furniture-fixtures.spec.ts` asserts the two agree exactly.
 */
export const FIXTURE_KIND_IDS: readonly FixtureKindId[] = [
  // floor — the equipment that shapes the plan
  "wood-stove",
  "battery-bank",
  "cistern",
  "hrv",
  "hot-tub",
  // floor — kitchen
  "counter-run",
  "kitchen-island",
  "range",
  "refrigerator",
  // floor — eating and sitting
  "dining-table",
  "dining-chair",
  "sofa",
  "armchair",
  // floor — sleeping and storage
  "bed",
  "bunk",
  "wardrobe",
  "dresser",
  "shelving",
  // floor — the door, and the jobs a cold house does indoors
  "entry-bench",
  "firewood-store",
  "drying-rack",
  // floor — bathroom
  "vanity",
  "toilet",
  "shower",
  "bath",
  // wall
  "electrical-panel",
  "awg",
  "wall-heater",
  "thermostat",
  "greywater-valve",
  "coat-rail",
  // roof
  "solar-array",
];

/**
 * The furniture, as against the plant.
 *
 * The palette groups by this so somebody looking for a bed is not reading past
 * an HRV to find one, and NOTHING else in the file branches on it — a fixture's
 * only real taxonomy is still its mount.
 *
 * Two judgement calls worth stating rather than hiding. The RANGE and the
 * REFRIGERATOR are here: they are appliances, but they are appliances a person
 * furnishes a kitchen with, and a palette that files them under equipment sends
 * people to the wrong list. The HOT TUB is not: it has a firebox, a chimney and
 * a stack that gets hot, and it belongs beside the wood stove in a person's
 * head as much as in this file.
 */
export const FURNITURE_KIND_IDS: readonly FixtureKindId[] = [
  "counter-run",
  "kitchen-island",
  "range",
  "refrigerator",
  "dining-table",
  "dining-chair",
  "sofa",
  "armchair",
  "bed",
  "bunk",
  "wardrobe",
  "dresser",
  "shelving",
  "entry-bench",
  "firewood-store",
  "drying-rack",
  "vanity",
  "toilet",
  "shower",
  "bath",
  "coat-rail",
];

export const isFurnitureKind = (id: FixtureKindId): boolean => FURNITURE_KIND_IDS.includes(id);

export const kindsByMount = (mount: FixtureMount): FixtureKind[] =>
  FIXTURE_KIND_IDS.map((id) => FIXTURE_CATALOG[id]).filter((k) => k.mount === mount);

/** The dimension defaults for a kind — the starting point for a new fixture. */
export const defaultDims = (kind: FixtureKind): Record<string, number> =>
  Object.fromEntries(kind.dimensions.map((d) => [d.key, d.default]));

export const defaultOpts = (kind: FixtureKind): Record<string, string> =>
  Object.fromEntries(kind.options.map((o) => [o.key, o.default]));

/** Clamp a morph dimension to its declared range and step. Deterministic, and
 *  the reason two people typing "6.03" get the same fixture. */
export function clampDim(kind: FixtureKind, key: string, value: number): number {
  const spec = kind.dimensions.find((d) => d.key === key);
  if (!spec) return value;
  if (!Number.isFinite(value)) return spec.default;
  const stepped = Math.round(value / spec.step) * spec.step;
  const clamped = Math.min(spec.max, Math.max(spec.min, stepped));
  // Kill the float dust `round(x/step)*step` leaves behind.
  return Number(clamped.toFixed(6));
}

/** Set one named dimension. THIS is the morph: it never touches the others,
 *  and the geometry is rebuilt from the named set rather than scaled. */
export function morph(kind: FixtureKind, dims: Dims, key: string, value: number): Record<string, number> {
  return { ...dims, [key]: clampDim(kind, key, value) };
}

/* ===========================================================================
   PLACEMENT
   =========================================================================== */

/** Which floor a floor fixture stands on. The deck is a real host: the
 *  wood-fired tub belongs on it, and `HomeSpec.Deck` already reserves a spot
 *  for the ONE tub the shell knows about — see `resolveFixtures`, which warns
 *  when both exist so nobody counts two. */
export type FixtureHost =
  | { kind: "volume"; volumeId: string }
  | { kind: "deck" };

export interface FloorPlacement {
  mount: "floor";
  host: FixtureHost;
  /** plan position in the host frame, feet */
  x: number;
  z: number;
  /** yaw, degrees clockwise from the host frame's +Z. 0 faces +Z. */
  rotationDeg: number;
}

export interface WallPlacement {
  mount: "wall";
  volumeId: string;
  wall: Wall;
  /** along the wall's BUILT run from run = 0, the same origin and direction
   *  `Opening.offsetFt` uses: left-to-right seen from outside */
  offsetFt: number;
  /** centre of the fixture above the finished floor */
  heightFt: number;
  face: "inside" | "outside";
}

export interface RoofPlacement {
  mount: "roof";
  volumeId: string;
  /** index into the volume's `RoofSection.planes` */
  planeIndex: number;
  /** position on the roof's fall axis and on the perpendicular axis, in the
   *  volume's local plan frame, feet */
  a: number;
  s: number;
}

export type FixturePlacement = FloorPlacement | WallPlacement | RoofPlacement;

export interface PlacedFixture {
  id: string;
  kind: FixtureKindId;
  /** what the owner calls this one; "" falls back to the kind's label */
  label: string;
  dims: Record<string, number>;
  options: Record<string, string>;
  placement: FixturePlacement;
}

export interface FixtureSet {
  version: typeof FIXTURES_VERSION;
  items: PlacedFixture[];
}

export const emptyFixtureSet = (): FixtureSet => ({ version: FIXTURES_VERSION, items: [] });

/** A stable id: the kind plus the lowest free number. No counters, no clock. */
export function newFixtureId(kind: FixtureKindId, set: FixtureSet): string {
  for (let n = 1; ; n++) {
    const id = `${kind}-${n}`;
    if (!set.items.some((i) => i.id === id)) return id;
  }
}

/* ===========================================================================
   THE HOST FRAMES — where a fixture is allowed to be

   All of this is done in a volume's LOCAL frame, which is exact: `spec.ts`
   guarantees a volume is a rectangle, so its floor polygon IS a rectangle, and
   the deck's is another one in the same frame. That is worth saying plainly
   rather than dressing a rectangle up as a general polygon clip.
   =========================================================================== */

/** The single transform the scene applies to everything in a host. Identical
 *  to `VolumeGeometry.origin` / `.rotationY` in geometry.ts, on purpose. */
export interface FixtureFrame {
  /** world position of the frame origin */
  origin: readonly [number, number, number];
  /** radians about +Y */
  rotationY: number;
  /** the volume whose frame this is (the deck borrows volume[0]'s) */
  volumeId: string;
  /** the volume's own bearing, for composing world rotations */
  rotationDeg: number;
}

/** A wall a floor fixture can back onto. */
export interface FloorWallEdge {
  wall: Wall;
  /** the axis the wall runs along in the host frame */
  runAxis: "x" | "z";
  /** the coordinate of the wall's INNER face on the other axis */
  facePos: number;
  /** which way the room is from that face: +1 or −1 on the other axis */
  inward: 1 | -1;
  /** the yaw a fixture takes when it backs onto this wall */
  facingDeg: number;
  /** true when the wall is actually built (an a-frame has only two) */
  built: boolean;
}

export interface FloorRegion {
  host: FixtureHost;
  label: string;
  frame: FixtureFrame;
  /** the rectangle a fixture's body must stay inside, in the host frame */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** the walking surface, relative to finished floor */
  floorY: number;
  edges: FloorWallEdge[];
  /** the ceiling/eave a hung fixture must stay under, or null on the deck */
  headroomFt: number | null;
}

/** A fixture facing directly away from a wall, in the host frame. Derived
 *  once here so a sign error has one place to live: at rotationDeg 0 a
 *  fixture faces the frame's +Z, and `yawFromBearingDeg` is the sign. */
export const WALL_FACING_DEG: Readonly<Record<Wall, number>> = { n: 0, s: 180, e: 90, w: 270 };

const findVolume = (spec: HomeSpec, id: string): Volume | null =>
  spec.volumes.find((v) => v.id === id) ?? null;

const frameOf = (v: Volume): FixtureFrame => ({
  origin: [v.x, 0, v.z] as const,
  rotationY: yawFromBearingDeg(v.rotationDeg),
  volumeId: v.id,
  rotationDeg: v.rotationDeg,
});

/** The floor region of one volume: the inner face rectangle. */
export function volumeFloorRegion(spec: HomeSpec, volumeId: string): FloorRegion | null {
  const v = findVolume(spec, volumeId);
  if (!v) return null;
  const t = wallThicknessFt(spec);
  const roof = roofSectionFor(v, t);
  const hw = Math.max(0.5, v.widthFt / 2 - t);
  const hd = Math.max(0.5, v.depthFt / 2 - t);
  const edges: FloorWallEdge[] = (["n", "s", "e", "w"] as Wall[]).map((wall) => {
    const runAxis = WALL_RUN_AXIS[wall];
    const facePos =
      wall === "n" ? -hd : wall === "s" ? hd : wall === "e" ? hw : -hw;
    const inward: 1 | -1 = wall === "n" || wall === "w" ? 1 : -1;
    return { wall, runAxis, facePos, inward, facingDeg: WALL_FACING_DEG[wall], built: roof.buildsWall(wall) };
  });
  return {
    host: { kind: "volume", volumeId: v.id },
    label: v.name,
    frame: frameOf(v),
    minX: -hw,
    maxX: hw,
    minZ: -hd,
    maxZ: hd,
    floorY: 0,
    edges,
    headroomFt: roof.eaveY,
  };
}

/**
 * The deck's floor region, in the HOST VOLUME's frame.
 *
 * Mirrors `geometry.ts::deckCornersPlan` and `drawings/model.ts::deckModel`:
 * the deck hangs off the first volume and lives in its frame, so a fixture on
 * the deck needs no second transform and can never drift off it.
 */
export function deckFloorRegion(spec: HomeSpec): FloorRegion | null {
  const deck = spec.deck;
  const host = spec.volumes[0];
  if (!deck || !host) return null;
  const runsAlongX = WALL_RUN_AXIS[deck.wall] === "x";
  const face = runsAlongX ? host.depthFt / 2 : host.widthFt / 2;
  const out: Pt = deck.wall === "n" ? [0, -1] : deck.wall === "s" ? [0, 1] : deck.wall === "e" ? [1, 0] : [-1, 0];
  const cx = out[0] * (face + deck.depthFt / 2);
  const cz = out[1] * (face + deck.depthFt / 2);
  const w = runsAlongX ? deck.widthFt : deck.depthFt;
  const d = runsAlongX ? deck.depthFt : deck.widthFt;
  // The house wall the deck runs against is the one edge a deck fixture can
  // back onto; the other three are open air with no wall to snap to.
  //
  // The facing is REVERSED from the volume case, and that reversal is the
  // whole difference between the two: inside the house a fixture backed onto
  // the south wall faces north into the room, and on the deck the same wall
  // is at your back while you look south, away from the building.
  const houseEdge: FloorWallEdge = {
    wall: deck.wall,
    runAxis: WALL_RUN_AXIS[deck.wall],
    facePos: runsAlongX ? cz - out[1] * (d / 2) : cx - out[0] * (w / 2),
    inward: (out[runsAlongX ? 1 : 0] > 0 ? 1 : -1) as 1 | -1,
    facingDeg: (WALL_FACING_DEG[deck.wall] + 180) % 360,
    built: true,
  };
  return {
    host: { kind: "deck" },
    label: "Deck",
    frame: frameOf(host),
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
    // One step down from finished floor, matching geometry.ts's DECK_STEP_FT.
    floorY: -DECK_STEP_FT,
    edges: [houseEdge],
    headroomFt: null,
  };
}

export function floorRegion(spec: HomeSpec, host: FixtureHost): FloorRegion | null {
  return host.kind === "deck" ? deckFloorRegion(spec) : volumeFloorRegion(spec, host.volumeId);
}

/** Every floor region a fixture could be dropped into. */
export function floorRegions(spec: HomeSpec): FloorRegion[] {
  const out: FloorRegion[] = [];
  for (const v of spec.volumes) {
    const r = volumeFloorRegion(spec, v.id);
    if (r) out.push(r);
  }
  const deck = deckFloorRegion(spec);
  if (deck) out.push(deck);
  return out;
}

/* ===========================================================================
   ORIENTED BOXES — the whole collision story, in about sixty lines

   Every body and every clearance is a rectangle in plan with a yaw plus a
   height interval. Two of those overlap exactly when their plan rectangles
   overlap AND their height intervals do, and two convex rectangles overlap
   exactly when no one of their four edge normals separates them. That is the
   separating-axis theorem, it is twenty lines, and it is exact — which is
   worth far more here than a bounding-sphere approximation would be, because
   the answer decides whether the tool says a stove clearance is satisfied.
   =========================================================================== */

export interface Obb {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  /** same convention as `FloorPlacement.rotationDeg` */
  rotationDeg: number;
}

/** Rotate a direction in a frame by a bearing, using the repo's one sign. */
export function rotateLocal(rotationDeg: number, lx: number, lz: number): Pt {
  const yaw = yawFromBearingDeg(rotationDeg);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [lx * c + lz * s, -lx * s + lz * c];
}

export function obbCorners(o: Obb): Pt[] {
  return (
    [
      [-o.halfW, -o.halfD],
      [o.halfW, -o.halfD],
      [o.halfW, o.halfD],
      [-o.halfW, o.halfD],
    ] as const
  ).map(([x, z]) => {
    const r = rotateLocal(o.rotationDeg, x, z);
    return [o.cx + r[0], o.cz + r[1]] as Pt;
  });
}

const project = (pts: readonly Pt[], ax: number, az: number): { min: number; max: number } => {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const d = p[0] * ax + p[1] * az;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
};

/** Do two oriented plan rectangles overlap? SAT, exact, no tolerance games
 *  beyond one epsilon so a fixture snapped flush to another does not read as
 *  a collision. */
export function obbOverlap(a: Obb, b: Obb, tol = 1e-6): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes: Pt[] = [];
  for (const o of [a, b]) {
    axes.push(rotateLocal(o.rotationDeg, 1, 0), rotateLocal(o.rotationDeg, 0, 1));
  }
  for (const [ax, az] of axes) {
    const pa = project(ca, ax, az);
    const pb = project(cb, ax, az);
    if (pa.max <= pb.min + tol || pb.max <= pa.min + tol) return false;
  }
  return true;
}

const rangesOverlap = (a: readonly [number, number], b: readonly [number, number], tol = 1e-6): boolean =>
  a[1] > b[0] + tol && b[1] > a[0] + tol;

/** Is every corner of this box inside the axis-aligned region rectangle? */
function obbInsideRect(o: Obb, r: { minX: number; maxX: number; minZ: number; maxZ: number }, tol = 1e-6): boolean {
  return obbCorners(o).every(
    (p) => p[0] >= r.minX - tol && p[0] <= r.maxX + tol && p[1] >= r.minZ - tol && p[1] <= r.maxZ + tol,
  );
}

/* ===========================================================================
   SNAPPING
   =========================================================================== */

export interface SnapResult<P> {
  placement: P;
  /** what the snap actually did, in plain sentences for the UI */
  notes: string[];
  /** true when the request would have put the fixture outside its host */
  clamped: boolean;
  /**
   * false when the fixture cannot fit its host AT ALL — a stove wider than the
   * cabin, an array longer than the roof plane. Separate from `clamped`,
   * because being held inside a room is normal and being unable to be in it is
   * not, and the two deserve different volume in the UI.
   */
  fits: boolean;
  /** the wall it ended up against, when it snapped to one */
  snappedTo: Wall | null;
}

const grid = (v: number, step: number): number => Number((Math.round(v / step) * step).toFixed(6));

/**
 * Snap a floor fixture into its region.
 *
 * The order matters and is deliberate:
 *   1. if the requested position is within `WALL_SNAP_FT` of a built wall,
 *      the fixture turns to face away from it and its BACK goes flat against
 *      the inner face — because that is what somebody dragging a sofa toward
 *      a wall means, and half an inch of gap is not a design decision;
 *   2. otherwise the position lands on the quarter-foot grid;
 *   3. either way the body is clamped inside the region. NOTHING is ever
 *      placed outside the envelope, and if a clamp was needed it is reported
 *      rather than performed silently.
 */
export function snapFloor(
  region: FloorRegion,
  kind: FixtureKind,
  dims: Dims,
  options: Opts,
  want: { x: number; z: number; rotationDeg: number },
): SnapResult<FloorPlacement> {
  const notes: string[] = [];
  const ext = kind.extents(dims, options);
  let rotationDeg = ((Math.round(want.rotationDeg / 15) * 15) % 360 + 360) % 360;
  let x = want.x;
  let z = want.z;
  let snappedTo: Wall | null = null;

  // 1. wall snap
  let best: { edge: FloorWallEdge; dist: number } | null = null;
  for (const e of region.edges) {
    if (!e.built) continue;
    const along = e.runAxis === "x" ? z : x;
    const dist = Math.abs(along - e.facePos);
    if (dist <= WALL_SNAP_FT && (!best || dist < best.dist)) best = { edge: e, dist };
  }
  if (best) {
    const e = best.edge;
    rotationDeg = e.facingDeg;
    // The back face is half the DEPTH away from the centre once the fixture
    // is square to the wall, which it now is.
    const back = ext.depthFt / 2 + SNAP_GAP_FT;
    const seated = e.facePos + e.inward * back;
    if (e.runAxis === "x") z = seated;
    else x = seated;
    snappedTo = e.wall;
    notes.push(`Snapped flat against the ${e.wall.toUpperCase()} wall.`);
  }

  // 2. grid
  if (!best) {
    x = grid(x, FLOOR_GRID_FT);
    z = grid(z, FLOOR_GRID_FT);
  } else if (best.edge.runAxis === "x") {
    x = grid(x, FLOOR_GRID_FT);
  } else {
    z = grid(z, FLOOR_GRID_FT);
  }

  // 3. clamp the BODY inside the region
  const half = halfExtentsInPlan(ext.widthFt, ext.depthFt, rotationDeg);
  const minX = region.minX + half.x;
  const maxX = region.maxX - half.x;
  const minZ = region.minZ + half.z;
  const maxZ = region.maxZ - half.z;
  let clamped = false;
  let fits = true;
  if (minX > maxX || minZ > maxZ) {
    fits = false;
    // The fixture does not fit at all. Centre it and say so — a fixture
    // silently shrunk to fit would be a lie about the product.
    x = (region.minX + region.maxX) / 2;
    z = (region.minZ + region.maxZ) / 2;
    clamped = true;
    notes.push(
      `${kind.label} is larger than ${region.label}. It is drawn centred and overhanging; either the fixture or the volume has to change.`,
    );
  } else {
    const cx = Math.min(maxX, Math.max(minX, x));
    const cz = Math.min(maxZ, Math.max(minZ, z));
    if (Math.abs(cx - x) > 1e-6 || Math.abs(cz - z) > 1e-6) {
      clamped = true;
      notes.push(`Held inside ${region.label} — it cannot be placed outside the envelope.`);
    }
    x = cx;
    z = cz;
  }

  return {
    placement: { mount: "floor", host: region.host, x: Number(x.toFixed(6)), z: Number(z.toFixed(6)), rotationDeg },
    notes,
    clamped,
    fits,
    snappedTo,
  };
}

/** Half-extents of a yawed rectangle on the frame axes. */
function halfExtentsInPlan(widthFt: number, depthFt: number, rotationDeg: number): { x: number; z: number } {
  const a = rotateLocal(rotationDeg, widthFt / 2, 0);
  const b = rotateLocal(rotationDeg, 0, depthFt / 2);
  return { x: Math.abs(a[0]) + Math.abs(b[0]), z: Math.abs(a[1]) + Math.abs(b[1]) };
}

/** What a wall offers a wall fixture. */
export interface WallSlot {
  volumeId: string;
  volumeName: string;
  wall: Wall;
  runFt: number;
  thicknessFt: number;
  /** the wall's top edge in (run, height), from the drawing model */
  topProfile: Pt[];
  built: boolean;
  /** openings already on this wall, in run coordinates, so a panel does not
   *  get mounted over a window */
  openings: { id: string; from: number; to: number; sillFt: number; headFt: number }[];
  frame: FixtureFrame;
}

export function wallSlots(spec: HomeSpec, volumeId: string): WallSlot[] {
  const v = findVolume(spec, volumeId);
  if (!v) return [];
  const t = wallThicknessFt(spec);
  const roof = roofSectionFor(v, t);
  return (["n", "s", "e", "w"] as Wall[]).map((wall) => {
    const runFt = wallRunFt(v, wall, t);
    return {
      volumeId: v.id,
      volumeName: v.name,
      wall,
      runFt,
      thicknessFt: t,
      topProfile: wallTopProfile(v, wall, roof, t),
      built: roof.buildsWall(wall),
      openings: v.openings
        .filter((o) => o.wall === wall)
        .map((o) => {
          const from = Math.min(Math.max(0, o.offsetFt), runFt);
          const to = Math.min(Math.max(from, o.offsetFt + Math.max(0, o.widthFt)), runFt);
          return { id: o.id, from, to, sillFt: o.sillFt, headFt: o.sillFt + Math.max(0, o.heightFt) };
        }),
      frame: frameOf(v),
    };
  });
}

/** Height of a wall's top edge at a run position, interpolated along the
 *  profile. Mirrors the private `profileHeightAt` in drawings/model.ts. */
export function wallTopAt(profile: readonly Pt[], run: number): number {
  if (profile.length === 0) return 0;
  if (run <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if (run <= b[0]) {
      const span = b[0] - a[0];
      return span <= 1e-9 ? b[1] : a[1] + ((run - a[0]) / span) * (b[1] - a[1]);
    }
  }
  return profile[profile.length - 1][1];
}

/**
 * Snap a wall fixture along a wall.
 *
 * Along the run and up the wall, both on a quarter-foot grid, both clamped so
 * the fixture's own rectangle stays inside the wall — including under the
 * SLOPING top edge of a gable end, which is the case a naive height clamp
 * gets wrong and then hangs a panel out through the roof.
 */
export function snapWall(
  slot: WallSlot,
  kind: FixtureKind,
  dims: Dims,
  options: Opts,
  want: { offsetFt: number; heightFt: number; face: "inside" | "outside" },
): SnapResult<WallPlacement> {
  const notes: string[] = [];
  const ext = kind.extents(dims, options);
  const halfW = ext.widthFt / 2;
  const halfH = ext.heightFt / 2;
  let clamped = false;
  let fits = true;

  let offsetFt = grid(want.offsetFt, WALL_GRID_FT);
  const minOff = halfW;
  const maxOff = slot.runFt - halfW;
  if (minOff > maxOff) {
    offsetFt = slot.runFt / 2;
    clamped = true;
    fits = false;
    notes.push(`${kind.label} is wider than the ${slot.wall.toUpperCase()} wall of ${slot.volumeName}.`);
  } else {
    const c = Math.min(maxOff, Math.max(minOff, offsetFt));
    if (Math.abs(c - offsetFt) > 1e-6) {
      clamped = true;
      notes.push("Held inside the wall's built run.");
    }
    offsetFt = c;
  }

  // The wall's top over the fixture's own width, taken at both ends and at
  // any vertex between them: on a gable end the low end is what constrains it.
  const lowestTop = Math.min(
    wallTopAt(slot.topProfile, Math.max(0, offsetFt - halfW)),
    wallTopAt(slot.topProfile, Math.min(slot.runFt, offsetFt + halfW)),
  );

  let heightFt = grid(want.heightFt, WALL_GRID_FT);
  const minH = halfH + WALL_ITEM_FLOOR_CLEAR_FT;
  const maxH = lowestTop - halfH - WALL_ITEM_TOP_CLEAR_FT;
  if (minH > maxH) {
    heightFt = Math.max(minH, lowestTop / 2);
    clamped = true;
    fits = false;
    notes.push(`${kind.label} is taller than the wall at that point.`);
  } else {
    const c = Math.min(maxH, Math.max(minH, heightFt));
    if (Math.abs(c - heightFt) > 1e-6) {
      clamped = true;
      notes.push("Held under the wall's top edge.");
    }
    heightFt = c;
  }

  if (!slot.built) {
    notes.push(
      `The ${slot.wall.toUpperCase()} side of ${slot.volumeName} is roof, not wall — an A-frame's slope IS its wall. Nothing can be mounted there.`,
    );
  }

  return {
    placement: {
      mount: "wall",
      volumeId: slot.volumeId,
      wall: slot.wall,
      offsetFt: Number(offsetFt.toFixed(6)),
      heightFt: Number(heightFt.toFixed(6)),
      face: want.face,
    },
    notes,
    clamped,
    fits: fits && slot.built,
    snappedTo: slot.wall,
  };
}

const WALL_ITEM_FLOOR_CLEAR_FT = 0.25;
const WALL_ITEM_TOP_CLEAR_FT = 0.25;

/** A roof plane a roof fixture can sit on, with the facts needed to choose. */
export interface RoofSlot {
  volumeId: string;
  volumeName: string;
  planeIndex: number;
  plane: RoofPlane;
  section: RoofSection;
  /** the plane's own pitch, degrees — the tilt the array is actually at */
  pitchDeg: number;
  /** compass bearing the plane faces downhill, degrees clockwise from north */
  azimuthDeg: number;
  /** area of the plane measured ON the slope, sq ft */
  areaSqFt: number;
  frame: FixtureFrame;
}

export function roofSlots(spec: HomeSpec, volumeId: string): RoofSlot[] {
  const v = findVolume(spec, volumeId);
  if (!v) return [];
  const t = wallThicknessFt(spec);
  const section = roofSectionFor(v, t);
  const cosT = Math.max(1e-6, Math.cos(section.angleRad));
  return section.planes.map((plane, planeIndex) => {
    const dirSign: 1 | -1 = plane.a1 >= plane.a0 ? 1 : -1;
    // Downhill direction in the volume's local frame, then into the world.
    const local: Pt = section.fallAxis === "x" ? [dirSign, 0] : [0, dirSign];
    const world = rotDir(v, local[0], local[1]);
    // World north is −Z and east is +X, so a bearing clockwise from north is
    // atan2(dx, −dz). A south-facing slope reads 180.
    const azimuthDeg = (((Math.atan2(world[0], -world[1]) * 180) / Math.PI) % 360 + 360) % 360;
    const planRun = Math.abs(plane.a1 - plane.a0);
    const slopeRun = planRun / cosT;
    return {
      volumeId: v.id,
      volumeName: v.name,
      planeIndex,
      plane,
      section,
      pitchDeg: (section.angleRad * 180) / Math.PI,
      azimuthDeg,
      areaSqFt: slopeRun * Math.abs(plane.s1 - plane.s0),
      frame: frameOf(v),
    };
  });
}

/**
 * The plane whose downhill face is closest to due south, which in the northern
 * hemisphere is the one an array wants.
 *
 * `|180 − azimuth|` is exactly the angular distance from south for an azimuth
 * in [0, 360), so no wrap-around case is hiding here. TIES ARE REAL and are
 * broken by the lower index: a gable falls across the volume's WIDTH, so an
 * un-rotated gable offers an east plane and a west plane and neither is more
 * southerly than the other. Rotating the volume, or choosing a shed or a
 * saltbox, is what actually gives an array a south face.
 */
export function bestRoofSlot(spec: HomeSpec, volumeId: string): RoofSlot | null {
  const slots = roofSlots(spec, volumeId);
  let best: RoofSlot | null = null;
  let bestErr = Infinity;
  for (const s of slots) {
    const err = Math.abs(180 - s.azimuthDeg);
    if (err < bestErr - 1e-9) {
      bestErr = err;
      best = s;
    }
  }
  return best;
}

/** Snap a roof fixture onto a plane, inside the edge setback. */
export function snapRoof(
  slot: RoofSlot,
  kind: FixtureKind,
  dims: Dims,
  options: Opts,
  want: { a: number; s: number },
): SnapResult<RoofPlacement> {
  const notes: string[] = [];
  const ext = kind.extents(dims, options);
  const setback = kind.clearances(dims, options).find((c) => c.key === "edge");
  const inset = setback ? Math.max(setback.front, setback.back, setback.left, setback.right) : 0;
  const cosT = Math.max(1e-6, Math.cos(slot.section.angleRad));
  // The along-slope extent projects shorter in plan; that projection is what
  // has to fit between the plane's own fall-axis limits.
  const halfA = (ext.depthFt * cosT) / 2 + inset;
  const halfS = ext.widthFt / 2 + inset;

  const a0 = Math.min(slot.plane.a0, slot.plane.a1);
  const a1 = Math.max(slot.plane.a0, slot.plane.a1);
  const s0 = Math.min(slot.plane.s0, slot.plane.s1);
  const s1 = Math.max(slot.plane.s0, slot.plane.s1);

  let clamped = false;
  let fits = true;
  let a = grid(want.a, FLOOR_GRID_FT);
  let s = grid(want.s, FLOOR_GRID_FT);

  if (a0 + halfA > a1 - halfA) {
    a = (a0 + a1) / 2;
    clamped = true;
    fits = false;
    notes.push(
      `The array is ${(ext.depthFt * cosT).toFixed(1)} ft deep in plan and the ${slot.volumeName} roof plane is only ${(a1 - a0).toFixed(1)} ft. Reduce the rows, reduce the kW, or use a bigger roof.`,
    );
  } else {
    const c = Math.min(a1 - halfA, Math.max(a0 + halfA, a));
    if (Math.abs(c - a) > 1e-6) {
      clamped = true;
      notes.push("Held inside the roof plane's edge setback.");
    }
    a = c;
  }
  if (s0 + halfS > s1 - halfS) {
    s = (s0 + s1) / 2;
    clamped = true;
    fits = false;
    notes.push(
      `The array is ${ext.widthFt.toFixed(1)} ft across and the roof plane is only ${(s1 - s0).toFixed(1)} ft wide. Fewer columns (more rows up the slope), a smaller array, or a bigger roof.`,
    );
  } else {
    const c = Math.min(s1 - halfS, Math.max(s0 + halfS, s));
    if (Math.abs(c - s) > 1e-6 && !clamped) {
      clamped = true;
      notes.push("Held inside the roof plane's edge setback.");
    }
    s = c;
  }

  return {
    placement: {
      mount: "roof",
      volumeId: slot.volumeId,
      planeIndex: slot.planeIndex,
      a: Number(a.toFixed(6)),
      s: Number(s.toFixed(6)),
    },
    notes,
    clamped,
    fits,
    snappedTo: null,
  };
}

/* ===========================================================================
   ADDING A FIXTURE — one call, already snapped
   =========================================================================== */

/**
 * Put a new fixture of `kind` into the model at a sensible default place, and
 * return the new set. Never mutates the set it is given.
 *
 * Floor items land in the middle of the region; wall items land in the middle
 * of the first BUILT wall; roof items land in the middle of the most southerly
 * roof plane, which is the one that was going to be chosen anyway.
 */
export function addFixture(
  spec: HomeSpec,
  set: FixtureSet,
  kindId: FixtureKindId,
  where?: { host?: FixtureHost; volumeId?: string; wall?: Wall },
): { set: FixtureSet; id: string | null; problem: string | null } {
  const kind = FIXTURE_CATALOG[kindId];
  const dims = defaultDims(kind);
  const options = defaultOpts(kind);
  const id = newFixtureId(kindId, set);
  const firstVolume = spec.volumes[0];
  if (!firstVolume) return { set, id: null, problem: "This home has no volumes to put a fixture in." };

  let placement: FixturePlacement | null = null;

  if (kind.mount === "floor") {
    const host: FixtureHost =
      where?.host ??
      (kindId === "hot-tub" && spec.deck
        ? { kind: "deck" }
        : { kind: "volume", volumeId: where?.volumeId ?? firstVolume.id });
    const region = floorRegion(spec, host);
    if (!region) return { set, id: null, problem: "That host does not exist in this home." };
    placement = snapFloor(region, kind, dims, options, {
      x: (region.minX + region.maxX) / 2,
      z: (region.minZ + region.maxZ) / 2,
      rotationDeg: 0,
    }).placement;
  } else if (kind.mount === "wall") {
    const slots = wallSlots(spec, where?.volumeId ?? firstVolume.id);
    const slot = (where?.wall ? slots.find((s) => s.wall === where.wall) : null) ?? slots.find((s) => s.built) ?? slots[0];
    if (!slot) return { set, id: null, problem: "That volume has no walls." };
    const base = kind.baseHeightFt?.(dims, options);
    placement = snapWall(slot, kind, dims, options, {
      offsetFt: slot.runFt / 2,
      heightFt: base && base > 0 ? base : WALL_ITEM_DEFAULT_HEIGHT_FT,
      face: "inside",
    }).placement;
  } else {
    const slot = bestRoofSlot(spec, where?.volumeId ?? firstVolume.id);
    if (!slot) return { set, id: null, problem: "That volume has no roof planes." };
    placement = snapRoof(slot, kind, dims, options, {
      a: (Math.min(slot.plane.a0, slot.plane.a1) + Math.max(slot.plane.a0, slot.plane.a1)) / 2,
      s: (slot.plane.s0 + slot.plane.s1) / 2,
    }).placement;
  }

  const item: PlacedFixture = { id, kind: kindId, label: "", dims, options, placement };
  return { set: { version: FIXTURES_VERSION, items: [...set.items, item] }, id, problem: null };
}

const WALL_ITEM_DEFAULT_HEIGHT_FT = 4.5;

/** Replace one fixture, re-snapping it against the current shell. Pure. */
export function updateFixture(
  spec: HomeSpec,
  set: FixtureSet,
  id: string,
  change: Partial<Pick<PlacedFixture, "label" | "dims" | "options" | "placement">>,
): FixtureSet {
  return {
    version: FIXTURES_VERSION,
    items: set.items.map((item) => {
      if (item.id !== id) return item;
      const next: PlacedFixture = { ...item, ...change };
      return { ...next, placement: reSnap(spec, next) };
    }),
  };
}

export const removeFixture = (set: FixtureSet, id: string): FixtureSet => ({
  version: FIXTURES_VERSION,
  items: set.items.filter((i) => i.id !== id),
});

/**
 * Re-run the snap for a fixture against the CURRENT shell.
 *
 * This is the call the integrator must make after the spec changes. A volume
 * that shrinks, a roof that changes form, a wall that stops being built —
 * each one can leave a fixture outside the envelope, and the rule this file
 * keeps is that nothing is ever outside it. Re-snapping is idempotent: a
 * fixture that was already legal comes back unchanged.
 */
export function reSnap(spec: HomeSpec, item: PlacedFixture): FixturePlacement {
  return snapPlacement(spec, item)?.placement ?? item.placement;
}

/**
 * The snap for a fixture's CURRENT placement, notes and all.
 *
 * This is the function `resolveFixtures` runs, and the reason it exists apart
 * from `reSnap` is a bug this file used to have: `reSnap` returned only the
 * placement and threw the notes away, so a solar array too wide for its roof
 * plane was quietly centred and NOTHING said so. The snap decides where a
 * fixture may be AND what it had to do to get there, and both halves have to
 * reach the user.
 *
 * Returns null when the fixture points at part of a home that no longer
 * exists. Idempotent: an already-legal fixture comes back with `clamped:
 * false` and no notes.
 */
export function snapPlacement(
  spec: HomeSpec,
  item: PlacedFixture,
): SnapResult<FixturePlacement> | null {
  const kind = FIXTURE_CATALOG[item.kind];
  if (!kind) return null;
  const p = item.placement;
  if (p.mount === "floor") {
    const region = floorRegion(spec, p.host) ?? floorRegions(spec)[0];
    if (!region) return null;
    return snapFloor(region, kind, item.dims, item.options, p);
  }
  if (p.mount === "wall") {
    const slots = wallSlots(spec, p.volumeId);
    const slot = slots.find((s) => s.wall === p.wall) ?? slots[0];
    if (!slot) return null;
    return snapWall(slot, kind, item.dims, item.options, p);
  }
  const slots = roofSlots(spec, p.volumeId);
  const slot = slots[p.planeIndex] ?? slots[0];
  if (!slot) return null;
  return snapRoof(slot, kind, item.dims, item.options, p);
}

/** Re-snap every fixture. Call it once whenever the HomeSpec changes. */
export const reSnapAll = (spec: HomeSpec, set: FixtureSet): FixtureSet => ({
  version: FIXTURES_VERSION,
  items: set.items.map((i) => ({ ...i, placement: reSnap(spec, i) })),
});

/* ===========================================================================
   RESOLUTION — placement plus clearances plus what they hit
   =========================================================================== */

export interface ResolvedClearance {
  rule: ClearanceRule;
  /** the clearance volume, in the host frame */
  obb: Obb;
  yRange: readonly [number, number];
  /** true when this clearance box is clear of everything it was tested against */
  satisfied: boolean;
  /** what it hit, in plain words */
  conflicts: string[];
}

export type IssueSeverity = "blocked" | "check";

export interface FixtureIssue {
  fixtureId: string;
  severity: IssueSeverity;
  /** the clearance rule at fault, when there is one */
  ruleKey?: string;
  message: string;
}

export interface ResolvedFixture {
  fixture: PlacedFixture;
  kind: FixtureKind;
  label: string;
  frame: FixtureFrame;
  /** transform inside the frame: feet, and radians */
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  /** the body's plan rectangle in the host frame, and its height interval */
  obb: Obb;
  yRange: readonly [number, number];
  /** the same rectangle in WORLD plan feet, for cross-volume collision */
  worldObb: Obb;
  clearances: ResolvedClearance[];
  facts: FixtureFact[];
  /** where it is, in words, for the schedule */
  location: string;
  hostLabel: string;
  /** what the snap had to do to land it here, in plain sentences */
  notes: string[];
  /** the snap had to move it to keep it legal */
  clamped: boolean;
  /** false when it cannot fit its host at all */
  fits: boolean;
  /** the roof plane it landed on, when it is a roof item */
  roof: { pitchDeg: number; azimuthDeg: number; planeIndex: number } | null;
  buildContext: BuildContext;
}

export interface FixtureResolution {
  items: ResolvedFixture[];
  issues: FixtureIssue[];
  /** things about the SET rather than one fixture */
  warnings: string[];
}

/** Is the shell's wall assembly combustible? Decides whether a stove's
 *  clearance-to-combustibles hitting a wall is a block or a note. */
export function wallIsCombustible(spec: HomeSpec): boolean {
  // sip (OSB facings), clt and timber frame are wood. Rammed earth is mass.
  // INDICATIVE: the finish, the furring and the framing behind any of them can
  // change the answer, and the WETT inspector decides on the day.
  return spec.material !== "rammed_earth";
}

/**
 * Resolve a whole set against a spec: every transform, every clearance box,
 * every collision.
 *
 * Total — it never throws. A fixture pointing at a volume that has been
 * deleted is dropped with a warning rather than crashing the viewport.
 */
export function resolveFixtures(spec: HomeSpec, set: FixtureSet): FixtureResolution {
  const items: ResolvedFixture[] = [];
  const issues: FixtureIssue[] = [];
  const warnings: string[] = [];
  const combustible = wallIsCombustible(spec);

  for (const item of set.items) {
    const kind = FIXTURE_CATALOG[item.kind];
    if (!kind) {
      warnings.push(`Fixture "${item.id}" is of an unknown kind and was skipped.`);
      continue;
    }
    const r = resolveOne(spec, item, kind);
    if (!r) {
      warnings.push(
        `${kind.label} "${item.id}" points at part of the home that no longer exists, and is not drawn.`,
      );
      continue;
    }
    items.push(r);
  }

  if (spec.deck?.hotTub && items.some((i) => i.kind.id === "hot-tub")) {
    warnings.push(
      "This home's deck already carries a hot tub from the HomeSpec itself, and a hot-tub fixture has also been placed. They are two different tubs — count once, or turn the deck's tub off.",
    );
  }

  /* ---- what the snap had to do ----------------------------------------
     The snap is the only thing that knows a fixture did not fit where it was
     asked to go, so its notes are turned into issues HERE rather than being
     dropped on the floor. A fixture that cannot fit its host at all is a
     block; one that was merely held inside the envelope is a note. */
  for (const r of items) {
    if (!r.fits) {
      issues.push({
        fixtureId: r.fixture.id,
        severity: "blocked",
        message: `${r.label} does not fit ${r.hostLabel}. ${r.notes.join(" ")}`.trim(),
      });
    } else if (r.clamped && r.notes.length > 0) {
      issues.push({
        fixtureId: r.fixture.id,
        severity: "check",
        message: `${r.label}: ${r.notes.join(" ")}`,
      });
    }
  }

  /* ---- collisions ------------------------------------------------------
     Bodies are compared in WORLD plan coordinates, so two fixtures in
     different volumes are still compared honestly. Clearances are compared
     the same way. */
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (!rangesOverlap(a.yRange, b.yRange)) continue;
      if (obbOverlap(a.worldObb, b.worldObb)) {
        issues.push({
          fixtureId: a.fixture.id,
          severity: "blocked",
          message: `${a.label} and ${b.label} occupy the same space.`,
        });
      }
    }
  }

  for (const a of items) {
    // Roof fixtures are excluded from the obstruction pass — see the note in
    // `resolveOne`'s roof branch.
    if (a.fixture.placement.mount === "roof") continue;
    for (const c of a.clearances) {
      const worldBox = toWorldObb(c.obb, a.frame);
      for (const b of items) {
        if (b === a) continue;
        if (!rangesOverlap(c.yRange, b.yRange)) continue;
        if (obbOverlap(worldBox, b.worldObb)) {
          c.satisfied = false;
          c.conflicts.push(b.label);
          issues.push({
            fixtureId: a.fixture.id,
            severity: c.rule.zone === "combustible" || c.rule.zone === "working-space" ? "blocked" : "check",
            ruleKey: c.rule.key,
            message: `${a.label}: ${c.rule.label} (${feetInches(maxSide(c.rule))}) is obstructed by ${b.label}.`,
          });
        }
      }

      // Does the clearance run into the shell itself?
      const region = regionOf(spec, a);
      if (region && !obbInsideRect(c.obb, region)) {
        const isFire = c.rule.zone === "combustible";
        if (!isFire || combustible) {
          c.satisfied = false;
          c.conflicts.push(isFire ? "the wall assembly" : "the envelope");
          issues.push({
            fixtureId: a.fixture.id,
            severity: isFire ? "blocked" : "check",
            ruleKey: c.rule.key,
            message: isFire
              ? `${a.label}: ${c.rule.label} of ${feetInches(maxSide(c.rule))} runs into the wall, and this home is built of ${spec.material.replace("_", " ")}, which is combustible construction. Move the fixture, shield the wall to the code's rules, or use a listed appliance with a smaller listed clearance.`
              : `${a.label}: ${c.rule.label} extends past the edge of ${a.hostLabel}.`,
          });
        } else {
          issues.push({
            fixtureId: a.fixture.id,
            severity: "check",
            ruleKey: c.rule.key,
            message: `${a.label}: ${c.rule.label} reaches the rammed-earth wall. Mass wall, so not combustible construction in itself — but the finish, any furring and anything framed behind it still have to be checked by the inspector.`,
          });
        }
      }
    }

    // A thermostat next to a window reads the glass, not the room.
    if (a.kind.id === "thermostat" && a.fixture.placement.mount === "wall") {
      const p = a.fixture.placement;
      const slot = wallSlots(spec, p.volumeId).find((s) => s.wall === p.wall);
      const near = slot?.openings.find((o) => p.offsetFt > o.from - 2 && p.offsetFt < o.to + 2);
      if (near) {
        issues.push({
          fixtureId: a.fixture.id,
          severity: "check",
          message: `${a.label} is within 2 ft of opening "${near.id}". A thermostat beside glass or a door reports the draught, and the house heats to the wrong number.`,
        });
      }
    }

    // A wall item over an opening is not mounted, it is floating.
    if (a.fixture.placement.mount === "wall" && a.kind.id !== "thermostat") {
      const p = a.fixture.placement;
      const slot = wallSlots(spec, p.volumeId).find((s) => s.wall === p.wall);
      const half = a.kind.extents(a.fixture.dims, a.fixture.options);
      const hit = slot?.openings.find(
        (o) =>
          p.offsetFt + half.widthFt / 2 > o.from &&
          p.offsetFt - half.widthFt / 2 < o.to &&
          p.heightFt + half.heightFt / 2 > o.sillFt &&
          p.heightFt - half.heightFt / 2 < o.headFt,
      );
      if (hit) {
        issues.push({
          fixtureId: a.fixture.id,
          severity: "blocked",
          message: `${a.label} is mounted over opening "${hit.id}". There is no wall there to fix it to.`,
        });
      }
      if (slot && !slot.built) {
        issues.push({
          fixtureId: a.fixture.id,
          severity: "blocked",
          message: `${a.label} is on a side of ${slot.volumeName} that this roof form does not build as a wall.`,
        });
      }
    }
  }

  return { items, issues, warnings };
}

const maxSide = (r: ClearanceRule): number => Math.max(r.front, r.back, r.left, r.right);

function regionOf(spec: HomeSpec, r: ResolvedFixture): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (r.fixture.placement.mount !== "floor") return null;
  const region = floorRegion(spec, r.fixture.placement.host);
  return region ? { minX: region.minX, maxX: region.maxX, minZ: region.minZ, maxZ: region.maxZ } : null;
}

/** A host-frame box, in world plan feet. */
function toWorldObb(o: Obb, frame: FixtureFrame): Obb {
  const yaw = frame.rotationY;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    cx: frame.origin[0] + o.cx * c + o.cz * s,
    cz: frame.origin[2] - o.cx * s + o.cz * c,
    halfW: o.halfW,
    halfD: o.halfD,
    rotationDeg: o.rotationDeg + frame.rotationDeg,
  };
}

/**
 * One fixture, fully resolved.
 *
 * It resolves the SNAPPED placement rather than the stored one, so the
 * viewport can never draw a fixture somewhere it is not allowed to be, and it
 * carries the snap's own notes so the reason is never lost. The integrator
 * should still call `reSnapAll` after a spec change to bring the stored set
 * back into agreement with what is drawn.
 */
function resolveOne(spec: HomeSpec, item: PlacedFixture, kind: FixtureKind): ResolvedFixture | null {
  const label = item.label.trim() || kind.label;
  const ext = kind.extents(item.dims, item.options);
  const snap = snapPlacement(spec, item);
  if (!snap) return null;
  const p = snap.placement;

  if (p.mount === "floor") {
    const region = floorRegion(spec, p.host);
    if (!region) return null;
    const base = region.floorY + (kind.baseHeightFt?.(item.dims, item.options) ?? 0);
    const obb: Obb = { cx: p.x, cz: p.z, halfW: ext.widthFt / 2, halfD: ext.depthFt / 2, rotationDeg: p.rotationDeg };
    const yRange = [base, base + ext.heightFt] as const;
    const notes: string[] = [...snap.notes];
    if (region.headroomFt !== null && base + ext.heightFt > region.headroomFt) {
      notes.push(
        `Its top is ${feetInches(base + ext.heightFt - region.headroomFt)} above the eave line of ${region.label}.`,
      );
    }
    return {
      fixture: item,
      kind,
      label,
      frame: region.frame,
      position: [p.x, base, p.z] as const,
      rotation: [0, yawFromBearingDeg(p.rotationDeg), 0] as const,
      obb,
      yRange,
      worldObb: toWorldObb(obb, region.frame),
      clearances: resolveClearances(kind, item, obb, region.floorY, base, ext.heightFt),
      facts: kind.facts(item.dims, item.options),
      hostLabel: region.label,
      location: `${region.label} · ${feetInches(p.x)} E, ${feetInches(p.z)} S of centre · facing ${bearingWord(p.rotationDeg)}`,
      notes,
      clamped: snap.clamped,
      fits: snap.fits,
      roof: null,
      buildContext: DEFAULT_CTX,
    };
  }

  if (p.mount === "wall") {
    const v = findVolume(spec, p.volumeId);
    if (!v) return null;
    const slot = wallSlots(spec, p.volumeId).find((s) => s.wall === p.wall);
    if (!slot) return null;
    const t = slot.thicknessFt;
    // Local plan geometry of the wall, restated from drawings/model.ts's
    // private `wallPlanFrame` — same four cases, plan only.
    const W = v.widthFt;
    const D = v.depthFt;
    const originOuter: Pt =
      p.wall === "n" ? [W / 2, -D / 2] : p.wall === "s" ? [-W / 2, D / 2] : p.wall === "e" ? [W / 2, D / 2 - t] : [-W / 2, -D / 2 + t];
    const run: Pt = p.wall === "n" ? [-1, 0] : p.wall === "s" ? [1, 0] : p.wall === "e" ? [0, -1] : [0, 1];
    const out: Pt = p.wall === "n" ? [0, -1] : p.wall === "s" ? [0, 1] : p.wall === "e" ? [1, 0] : [-1, 0];
    // Inward distance from the OUTER face to the fixture's centre.
    const inward = p.face === "inside" ? t + ext.depthFt / 2 : -ext.depthFt / 2;
    const cx = originOuter[0] + run[0] * p.offsetFt - out[0] * inward;
    const cz = originOuter[1] + run[1] * p.offsetFt - out[1] * inward;
    const rotationDeg = (WALL_FACING_DEG[p.wall] + (p.face === "outside" ? 180 : 0)) % 360;
    const base = p.heightFt - ext.heightFt / 2;
    const obb: Obb = { cx, cz, halfW: ext.widthFt / 2, halfD: ext.depthFt / 2, rotationDeg };
    return {
      fixture: item,
      kind,
      label,
      frame: slot.frame,
      position: [cx, base, cz] as const,
      rotation: [0, yawFromBearingDeg(rotationDeg), 0] as const,
      obb,
      yRange: [base, base + ext.heightFt] as const,
      worldObb: toWorldObb(obb, slot.frame),
      // A wall fixture always hangs off a volume, whose walking surface is
      // finished floor — y = 0 in its own frame.
      clearances: resolveClearances(kind, item, obb, 0, base, ext.heightFt),
      facts: kind.facts(item.dims, item.options),
      hostLabel: slot.volumeName,
      location: `${slot.volumeName} · ${p.wall.toUpperCase()} wall ${p.face} face · ${feetInches(p.offsetFt)} from the left end · centre ${feetInches(p.heightFt)} above the floor`,
      notes: [...snap.notes],
      clamped: snap.clamped,
      fits: snap.fits,
      roof: null,
      buildContext: DEFAULT_CTX,
    };
  }

  const slots = roofSlots(spec, p.volumeId);
  const slot = slots[p.planeIndex];
  if (!slot) return null;
  const sec = slot.section;
  const dirSign: 1 | -1 = slot.plane.a1 >= slot.plane.a0 ? 1 : -1;
  const theta = sec.angleRad;
  // Offset perpendicular to the roof plane by the standoff: the surface's
  // normal in the (fall, height) section is (dirSign·sinθ, cosθ).
  const stand = PV_STANDOFF_FT + PV_THICKNESS_FT / 2;
  const a = p.a + dirSign * stand * Math.sin(theta);
  const y = sec.topAt(p.a) + stand * Math.cos(theta);
  const x = sec.fallAxis === "x" ? a : p.s;
  const z = sec.fallAxis === "x" ? p.s : a;
  // One tilt about the axis perpendicular to the fall. Derived in the header
  // of `snapRoof`'s neighbours: about Z when the fall runs along X, about X
  // when it runs along Z, and the sign follows the downhill direction.
  const rotation: readonly [number, number, number] =
    sec.fallAxis === "x" ? ([0, 0, -theta * dirSign] as const) : ([theta * dirSign, 0, 0] as const);
  const ctx: BuildContext = { fallAxis: sec.fallAxis };
  const ext3 = kind.extents(item.dims, item.options);
  const planAlong = ext3.depthFt * Math.cos(theta);
  const obb: Obb = {
    cx: x,
    cz: z,
    halfW: (sec.fallAxis === "x" ? planAlong : ext3.widthFt) / 2,
    halfD: (sec.fallAxis === "x" ? ext3.widthFt : planAlong) / 2,
    rotationDeg: 0,
  };
  return {
    fixture: item,
    kind,
    label,
    frame: slot.frame,
    position: [x, y, z] as const,
    rotation,
    obb,
    yRange: [y - 0.5, y + 0.5] as const,
    worldObb: toWorldObb(obb, slot.frame),
    /* Resolved so the SCHEDULE prints the setback and its caveat, but the
       collision pass skips roof-mounted fixtures entirely: a box drawn around
       an array 20 feet up would otherwise be compared against a sofa on the
       floor and report a conflict that does not exist. The setback is enforced
       where it actually belongs — in `snapRoof`, against the plane's edges. */
    clearances: resolveClearances(kind, item, obb, y, y, ext3.heightFt),
    facts: kind.facts(item.dims, item.options),
    hostLabel: slot.volumeName,
    location: `${slot.volumeName} roof · plane ${p.planeIndex + 1} of ${slots.length} · ${slot.pitchDeg.toFixed(1)}° pitch facing ${bearingWord(slot.azimuthDeg)}`,
    notes: [...snap.notes],
    clamped: snap.clamped,
    fits: snap.fits,
    roof: { pitchDeg: slot.pitchDeg, azimuthDeg: slot.azimuthDeg, planeIndex: p.planeIndex },
    buildContext: ctx,
  };
}

/**
 * Turn a kind's clearance RULES into positioned boxes.
 *
 * The vertical anchor is the part worth reading twice:
 *   from "base"  — starts at the fixture's own base. `heightFt: null` means
 *                  "as tall as the fixture".
 *   from "floor" — starts at the host's walking surface, which is what an
 *                  electrical working space and a standing-room allowance
 *                  actually mean. `heightFt: null` runs up to the top of the
 *                  fixture, so a hung unit's floor space is the floor under it.
 *   from "top"   — starts at the top of the fixture, for an overhead clearance.
 */
function resolveClearances(
  kind: FixtureKind,
  item: PlacedFixture,
  body: Obb,
  floorY: number,
  baseY: number,
  bodyHeightFt: number,
): ResolvedClearance[] {
  const topY = baseY + bodyHeightFt;
  return kind.clearances(item.dims, item.options).map((r) => {
    const halfW = body.halfW + (r.left + r.right) / 2;
    const halfD = body.halfD + (r.front + r.back) / 2;
    // The box is not centred on the fixture when the sides differ, so its
    // centre shifts by half the difference — in the FIXTURE's frame, then
    // rotated into the host's.
    const offX = (r.right - r.left) / 2;
    const offZ = (r.front - r.back) / 2;
    const shifted = rotateLocal(body.rotationDeg, offX, offZ);

    let y0: number;
    let y1: number;
    if (r.from === "top") {
      y0 = topY;
      y1 = topY + (r.heightFt ?? bodyHeightFt);
    } else if (r.from === "floor") {
      y0 = floorY;
      y1 = r.heightFt === null ? topY : floorY + r.heightFt;
    } else {
      y0 = baseY;
      y1 = baseY + (r.heightFt ?? bodyHeightFt);
    }

    return {
      rule: r,
      obb: {
        cx: body.cx + shifted[0],
        cz: body.cz + shifted[1],
        halfW: Math.max(0.01, halfW),
        halfD: Math.max(0.01, halfD),
        rotationDeg: body.rotationDeg,
      },
      yRange: [y0, Math.max(y0 + 0.05, y1)] as const,
      satisfied: true,
      conflicts: [],
    };
  });
}

/* ===========================================================================
   GEOMETRY FOR THE SCENE
   =========================================================================== */

/**
 * One fixture's meshes, and the two DIFFERENT frames they belong to.
 *
 * `parts` are in the FIXTURE's own frame and want `position` + `rotation`
 * applied. `clearanceParts` are already positioned and yawed in the HOST
 * frame, because a clearance is a piece of the room, not a piece of the
 * object — so they are siblings of the fixture group, never children of it.
 * Nesting them would apply the fixture transform twice and put a stove's
 * 48-inch clearance somewhere it is not. The mounting recipe is:
 *
 *   <group position={frame.origin} rotation={[0, frame.rotationY, 0]}>
 *     <group position={g.position} rotation={g.rotation}>{g.parts}</group>
 *     {g.clearanceParts}
 *   </group>
 */
export interface FixtureGroup {
  id: string;
  frame: FixtureFrame;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  parts: FixturePart[];
  /** already positioned and yawed in the HOST frame — siblings, not children */
  clearanceParts: FixturePart[];
}

export interface FixtureGeometry {
  groups: FixtureGroup[];
}

/** Build every mesh for a resolution. Deterministic; the caller owns disposal
 *  (`disposeFixtureGeometry`), exactly as BuilderApp owns the shell's. */
export function buildFixtureGeometry(res: FixtureResolution, opts?: { clearances?: boolean }): FixtureGeometry {
  const showClearances = opts?.clearances ?? true;
  return {
    groups: res.items.map((r) => {
      const parts = r.kind.build(r.fixture.dims, r.fixture.options, r.buildContext).map((p) => ({
        ...p,
        id: `${r.fixture.id}:${p.id}`,
      }));
      const clearanceParts: FixturePart[] = [];
      if (showClearances) {
        for (const c of r.clearances) {
          const h = c.yRange[1] - c.yRange[0];
          const g = box(c.obb.halfW * 2, h, c.obb.halfD * 2, c.obb.cx, c.yRange[0] + h / 2, c.obb.cz);
          clearanceParts.push({
            id: `${r.fixture.id}:clear:${c.rule.key}`,
            surface: c.satisfied ? "clearance" : "clearance-alert",
            // Yawed about its OWN centre, in the host frame — the rotation is
            // baked in rather than inherited, because this mesh is a sibling.
            geometry: rotateAbout(g, c.obb.cx, c.obb.cz, yawFromBearingDeg(c.obb.rotationDeg)),
          });
        }
      }
      return {
        id: r.fixture.id,
        frame: r.frame,
        position: r.position,
        rotation: r.rotation,
        parts,
        clearanceParts,
      };
    }),
  };
}

/** Yaw a geometry about a vertical axis through (x, z). */
function rotateAbout(g: THREE.BufferGeometry, x: number, z: number, yaw: number): THREE.BufferGeometry {
  return g.translate(-x, 0, -z).rotateY(yaw).translate(x, 0, z);
}

export function disposeFixtureGeometry(geo: FixtureGeometry | null | undefined): void {
  if (!geo) return;
  for (const g of geo.groups) {
    for (const p of g.parts) p.geometry.dispose();
    for (const p of g.clearanceParts) p.geometry.dispose();
  }
}

/* ===========================================================================
   THE SCHEDULE — fixtures as data, for the plan engine and the sheets
   =========================================================================== */

export interface FixtureScheduleRow {
  /** F-1, W-2, R-1: mount letter plus a number in placement order */
  tag: string;
  id: string;
  kind: FixtureKindId;
  kindLabel: string;
  label: string;
  mount: FixtureMount;
  host: string;
  location: string;
  /** the named dimensions, as stored — the morph state, not a scale */
  dims: Record<string, number>;
  options: Record<string, string>;
  sizeText: string;
  facts: FixtureFact[];
  clearances: {
    key: string;
    label: string;
    zone: ClearanceZone;
    basis: ClearanceBasis;
    source: string;
    verifiedAgainstSource: false;
    maxFt: number;
    text: string;
    satisfied: boolean;
    note: string;
  }[];
  issues: string[];
}

/**
 * The fixture set as flat rows.
 *
 * This is the handoff. Nothing downstream needs three.js, a React tree or a
 * resolver to read it: the plan engine can place symbols from `location`, a
 * schedule sheet can print `sizeText` and the clearance table, and a BOM can
 * count `kind`. `verifiedAgainstSource` rides along on every clearance row so
 * a printed sheet cannot quietly lose the caveat.
 */
export function fixtureSchedule(res: FixtureResolution): FixtureScheduleRow[] {
  const counters: Record<FixtureMount, number> = { floor: 0, wall: 0, roof: 0 };
  const letter: Record<FixtureMount, string> = { floor: "F", wall: "W", roof: "R" };
  return res.items.map((r) => {
    const mount = r.kind.mount;
    counters[mount] += 1;
    const ext = r.kind.extents(r.fixture.dims, r.fixture.options);
    return {
      tag: `${letter[mount]}-${counters[mount]}`,
      id: r.fixture.id,
      kind: r.kind.id,
      kindLabel: r.kind.label,
      label: r.label,
      mount,
      host: r.hostLabel,
      location: r.location,
      dims: { ...r.fixture.dims },
      options: { ...r.fixture.options },
      sizeText: `${feetInches(ext.widthFt)} W × ${feetInches(ext.depthFt)} D × ${feetInches(ext.heightFt)} H`,
      facts: r.facts,
      clearances: r.clearances.map((c) => ({
        key: c.rule.key,
        label: c.rule.label,
        zone: c.rule.zone,
        basis: c.rule.basis,
        source: c.rule.source,
        verifiedAgainstSource: c.rule.verifiedAgainstSource,
        maxFt: maxSide(c.rule),
        text: clearanceText(c.rule),
        satisfied: c.satisfied,
        note: c.rule.note,
      })),
      issues: res.issues.filter((i) => i.fixtureId === r.fixture.id).map((i) => i.message),
    };
  });
}

/** A clearance rule as one readable line. */
export function clearanceText(r: ClearanceRule): string {
  const sides: string[] = [];
  const all = r.front === r.back && r.back === r.left && r.left === r.right && r.front > 0;
  if (all) sides.push(`${feetInches(r.front)} all round`);
  else {
    if (r.front > 0) sides.push(`${feetInches(r.front)} front`);
    if (r.back > 0) sides.push(`${feetInches(r.back)} back`);
    if (r.left > 0 || r.right > 0) {
      sides.push(
        r.left === r.right
          ? `${feetInches(r.left)} each side`
          : `${feetInches(r.left)} left, ${feetInches(r.right)} right`,
      );
    }
  }
  if (r.heightFt !== null) sides.push(`${feetInches(r.heightFt)} high`);
  return sides.length > 0 ? sides.join(", ") : "see note";
}

/** The clearance sources in a set, deduplicated — a "where these numbers came
 *  from" block a sheet or a panel can print under `SOURCE_HONESTY`. */
export function clearanceSources(res: FixtureResolution): { basis: ClearanceBasis; source: string }[] {
  const seen: Record<string, true> = {};
  const out: { basis: ClearanceBasis; source: string }[] = [];
  for (const r of res.items) {
    for (const c of r.clearances) {
      const key = `${c.rule.basis}::${c.rule.source}`;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ basis: c.rule.basis, source: c.rule.source });
    }
  }
  return out.sort((a, b) =>
    a.basis === b.basis ? a.source.localeCompare(b.source) : a.basis.localeCompare(b.basis),
  );
}

/* ---------------------------------------------------------------- words */

/** Feet as prose — `6 ft 6 in` — because these strings land in sentences a
 *  clearance report speaks. Body shared via lib/units with the five
 *  drawing-style formatters; only the words differ. */
export const feetInches = (ft: number): string => formatFeetInchesWords(ft);

/** A bearing as a compass word. North is 0, and the site frame puts it at −Z. */
export function bearingWord(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return names[Math.round(d / 45) % 8];
}

/* ===========================================================================
   SERIALIZATION — a fixture set is a string

   Same shape of contract as `share.ts`: a version, a codec letter, base64url.
   The prefix is `F` rather than `A`, so a fixture token can never be mistaken
   for a design token and vice versa. Written here rather than in share.ts
   because fixtures are an optional layer over a spec, and the shell's link
   must keep working with no fixtures in it at all.
   =========================================================================== */

const FIXTURE_TOKEN_RE = /^F(\d+)r([A-Za-z0-9_-]+)$/;
const MAX_FIXTURE_TOKEN_CHARS = 32_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array | null {
  try {
    const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Validate an unknown value as a fixture set. Returns null and says why on
 *  the console, rather than throwing into a render. */
export function validateFixtureSet(value: unknown): FixtureSet | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== FIXTURES_VERSION) {
    console.error(`[aura/fixtures] fixture set is v${String(v.version)}; this build reads v${FIXTURES_VERSION}.`);
    return null;
  }
  if (!Array.isArray(v.items)) return null;
  const items: PlacedFixture[] = [];
  for (const raw of v.items) {
    if (typeof raw !== "object" || raw === null) continue;
    const it = raw as Record<string, unknown>;
    const kindId = it.kind as FixtureKindId;
    const kind = FIXTURE_CATALOG[kindId];
    if (!kind || typeof it.id !== "string") continue;
    const placement = validatePlacement(it.placement, kind.mount);
    if (!placement) continue;
    const dims = { ...defaultDims(kind) };
    if (typeof it.dims === "object" && it.dims !== null) {
      for (const d of kind.dimensions) {
        const raw2 = (it.dims as Record<string, unknown>)[d.key];
        if (typeof raw2 === "number") dims[d.key] = clampDim(kind, d.key, raw2);
      }
    }
    const options = { ...defaultOpts(kind) };
    if (typeof it.options === "object" && it.options !== null) {
      for (const o of kind.options) {
        const raw2 = (it.options as Record<string, unknown>)[o.key];
        if (typeof raw2 === "string" && o.choices.some((c) => c.id === raw2)) options[o.key] = raw2;
      }
    }
    items.push({
      id: it.id,
      kind: kindId,
      label: typeof it.label === "string" ? it.label.slice(0, 60) : "",
      dims,
      options,
      placement,
    });
  }
  return { version: FIXTURES_VERSION, items };
}

function validatePlacement(value: unknown, mount: FixtureMount): FixturePlacement | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  const n = (k: string, fallback = 0): number => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : fallback);
  if (mount === "floor" && p.mount === "floor") {
    const host = p.host as Record<string, unknown> | undefined;
    const parsed: FixtureHost =
      host?.kind === "deck"
        ? { kind: "deck" }
        : { kind: "volume", volumeId: typeof host?.volumeId === "string" ? host.volumeId : "" };
    if (parsed.kind === "volume" && parsed.volumeId === "") return null;
    return { mount: "floor", host: parsed, x: n("x"), z: n("z"), rotationDeg: n("rotationDeg") };
  }
  if (mount === "wall" && p.mount === "wall") {
    if (typeof p.volumeId !== "string" || !["n", "s", "e", "w"].includes(String(p.wall))) return null;
    return {
      mount: "wall",
      volumeId: p.volumeId,
      wall: p.wall as Wall,
      offsetFt: n("offsetFt"),
      heightFt: n("heightFt", 4.5),
      face: p.face === "outside" ? "outside" : "inside",
    };
  }
  if (mount === "roof" && p.mount === "roof") {
    if (typeof p.volumeId !== "string") return null;
    return { mount: "roof", volumeId: p.volumeId, planeIndex: Math.max(0, Math.round(n("planeIndex"))), a: n("a"), s: n("s") };
  }
  return null;
}

/** Encode a set. Byte-stable: the same set always gives the same string. */
export function encodeFixtureSet(set: FixtureSet): string {
  return `F${FIXTURES_VERSION}r${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(set)))}`;
}

/** Decode a token. Returns null — never throws, never guesses. */
export function decodeFixtureSet(token: unknown): FixtureSet | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_FIXTURE_TOKEN_CHARS) return null;
  const m = FIXTURE_TOKEN_RE.exec(token);
  if (!m) return null;
  if (Number(m[1]) !== FIXTURES_VERSION) {
    console.error(`[aura/fixtures] token is v${m[1]}; this build reads v${FIXTURES_VERSION} and will not guess.`);
    return null;
  }
  const bytes = base64UrlToBytes(m[2]);
  if (!bytes) return null;
  try {
    return validateFixtureSet(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
