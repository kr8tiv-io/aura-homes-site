/* Roof and wall frames the fixture catalog measures against.
   Lifted from the drawing model so the sheet set stays behind.
   The ridge still comes from ridgeHeightFt in spec.ts. */
import {
  ridgeHeightFt,
  type HomeSpec,
  type RoofForm,
  type Volume,
  type Wall,
} from "./spec";
import { PARTITION_MM, WALL_THICKNESS_MM } from "./materials";

export const MM_PER_FT = 304.8;

/** Structural floor deck below finished floor. */
export const FLOOR_SLAB_FT = 0.75;
/** How far the piles stand proud of grade. */
export const PILE_EXPOSURE_FT = 2.0;
/** Ground plane, in the same frame as everything else. */
export const GRADE_Y_FT = -(FLOOR_SLAB_FT + PILE_EXPOSURE_FT);

/** Nominal screw-pile grid. */
export const PILE_GRID_FT = 8;

export const ROOF_THICKNESS_FT = 0.9;
export const ROOF_SEAT_FT = 0.15;
export const FLAT_ROOF_FALL_DEG = 2;
export const PARAPET_FT = 0.5;

export const SALTBOX_MIN_EAVE_FT = 1.5;
export const SALTBOX_SHORT_SHARE = 0.38;

export const DECK_STEP_FT = 0.5;
export const DECK_SLAB_FT = 0.25;
export const DECK_BEAM_FT = 0.8;
export const HOT_TUB_RADIUS_FT = 3.0;

/** A glazing wall reads as a glazed SCREEN, not one impossible pane. */
export const MULLION_SPACING_FT = 4.0;

/** Rough-opening allowance over the unit size. Nominal, and the schedule says
 *  so: the real allowance comes from the supplied unit's installation sheet. */
export const RO_WIDTH_ALLOWANCE_FT = 0.75 / 12; // 3/4"
export const RO_HEIGHT_ALLOWANCE_FT = 0.5 / 12; // 1/2"

/** Indicative PV array area per kW — modern modules run near 400 W over about
 *  21 sq ft. Used only to draw an array FOOTPRINT, never to size a system. */
export const ARRAY_SQ_FT_PER_KW = 53;

const EPS = 1e-9;

/* =====================================================================
   SMALL VECTOR + POLYGON TOOLKIT
   ===================================================================== */

export type Pt = readonly [number, number];

export const polygonArea = (poly: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
};

/**
 * Convex hull, monotone chain. Deterministic: the sort is total (x then y) so
 * the same points always produce the same ring, starting at the same vertex.
 *
 * This is what makes the elevations exact rather than approximate. Every solid
 * this set projects — the wall mass under a concave roof line, a sloped roof
 * slab, a parapet upstand — is CONVEX, and the orthographic silhouette of a
 * convex solid is exactly the convex hull of its projected vertices. So the
 * outline is computed, not sketched.
 */
export function hull(pts: readonly Pt[]): Pt[] {
  if (pts.length < 3) return [...pts];
  const p = [...pts].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: Pt, a: Pt, b: Pt): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (src: readonly Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 1e-9) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  const lower = build(p);
  const upper = build([...p].reverse());
  const ring = [...lower, ...upper];
  return ring.length >= 3 ? ring : [...pts];
}

export interface Extent {
  min: number;
  max: number;
}

export const extentOf = (values: readonly number[]): Extent =>
  values.length === 0
    ? { min: 0, max: 0 }
    : { min: Math.min(...values), max: Math.max(...values) };

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function boxOf(polys: readonly (readonly Pt[])[]): Box {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  return { minX, maxX, minZ, maxZ };
}

/** Do two axis-aligned boxes overlap? Used only to WARN about roof
 *  intersections, never to invent a valley line. */
export const boxesOverlap = (a: Box, b: Box, tol = 1e-6): boolean =>
  a.minX < b.maxX - tol && b.minX < a.maxX - tol && a.minZ < b.maxZ - tol && b.minZ < a.maxZ - tol;

/* =====================================================================
   THE SITE FRAME
   ===================================================================== */

/** A compass bearing (clockwise from north) as a rotation about +Y. The sign
 *  is `lib/builder/geometry.ts::yawFromBearingDeg` and must not differ. */
export const yawFromBearingDeg = (bearingDeg: number): number => (-bearingDeg * Math.PI) / 180;

/** A point in a volume's local frame, in world feet. */
export function toWorld(v: Volume, lx: number, lz: number): Pt {
  const yaw = yawFromBearingDeg(v.rotationDeg);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [v.x + lx * c + lz * s, v.z - lx * s + lz * c];
}

/** A direction in a volume's local frame, rotated but not translated. */
export function rotDir(v: Volume, lx: number, lz: number): Pt {
  const yaw = yawFromBearingDeg(v.rotationDeg);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [lx * c + lz * s, -lx * s + lz * c];
}

/** The four plan corners of a centred, yawed rectangle, in world feet. */
export function rectCorners(
  v: Volume,
  widthFt: number,
  depthFt: number,
  offsetX = 0,
  offsetZ = 0,
): Pt[] {
  const hw = widthFt / 2;
  const hd = depthFt / 2;
  return (
    [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as const
  ).map(([x, z]) => toWorld(v, x + offsetX, z + offsetZ));
}

/** Which plan axis a wall RUNS along, in the volume's own frame. */
export const WALL_RUN_AXIS: Readonly<Record<Wall, "x" | "z">> = {
  n: "x",
  s: "x",
  e: "z",
  w: "z",
};

/** Outward normal of each wall in the volume's own frame, as (x, z). */
const WALL_OUT: Readonly<Record<Wall, Pt>> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
};

/** Run direction of each wall — left-to-right seen from OUTSIDE, which is the
 *  direction `Opening.offsetFt` is measured in. */
const WALL_RUN: Readonly<Record<Wall, Pt>> = {
  n: [-1, 0],
  s: [1, 0],
  e: [0, -1],
  w: [0, 1],
};

export const WALL_NAME: Readonly<Record<Wall, string>> = {
  n: "NORTH",
  s: "SOUTH",
  e: "EAST",
  w: "WEST",
};

/** Structural wall thickness in FEET. */
export const wallThicknessFt = (spec: HomeSpec): number =>
  WALL_THICKNESS_MM[spec.material] / MM_PER_FT;

export const partitionThicknessFt = (): number => PARTITION_MM / MM_PER_FT;

/**
 * The BUILT length of a wall, feet.
 *
 * The n and s walls run the full width; e and w butt INTO them and are two
 * wall thicknesses shorter. Same rule as `lib/builder/geometry.ts::wallRunFt`,
 * and the reason an opening's `offsetFt` is clamped against this rather than
 * against `depthFt`.
 */
export const wallRunFt = (v: Volume, wall: Wall, t: number): number =>
  WALL_RUN_AXIS[wall] === "x" ? v.widthFt : Math.max(0.5, v.depthFt - 2 * t);

/* =====================================================================
   THE ROOF SECTION — one scalar function, five forms
   ===================================================================== */

export interface RoofPlane {
  /** fall-axis position and height of the high end */
  a0: number;
  y0: number;
  /** and of the low end */
  a1: number;
  y1: number;
  /** extent on the perpendicular plan axis */
  s0: number;
  s1: number;
}

export interface RoofSection {
  form: RoofForm;
  /** the local plan axis the slopes fall down */
  fallAxis: "x" | "z";
  facing: Wall;
  /** half the footprint on the fall axis, and on the other one */
  halfFall: number;
  halfPerp: number;
  overhangFt: number;
  /** high line: position on the fall axis, and its height */
  apexA: number;
  apexY: number;
  slope: number;
  angleRad: number;
  /** floor to eave — `wallHeightFt × storeys` */
  eaveY: number;
  /** `ridgeHeightFt(v)`, never re-derived */
  ridgeY: number;
  thicknessFt: number;
  /** height of the roof's TOP surface at `a` on the fall axis */
  topAt: (a: number) => number;
  planes: RoofPlane[];
  parapet: { topY: number; halfA: number; halfS: number; lowY: number } | null;
  /** true for the forms with a ridge line worth drawing on a roof plan */
  hasRidge: boolean;
  /** the roof's extent on the fall axis, including overhang */
  fallExtent: Extent;
  perpExtent: Extent;
  /** false for the walls an a-frame does not have: the slope IS the wall */
  buildsWall: (wall: Wall) => boolean;
  /** anything the drawing had to clamp, in words */
  warnings: string[];
}

/** `ridgeHeightFt(v)`, guarded for the pitches that send tan() to infinity.
 *  Mirrors `lib/builder/geometry.ts::drawnRidgeFt`. */
function drawnRidge(v: Volume, warnings: string[]): number {
  const r = ridgeHeightFt(v);
  const eave = v.wallHeightFt * v.storeys;
  if (!Number.isFinite(r) || r <= 0) {
    warnings.push(
      `${v.name}: a ${v.roof.pitchDeg}° pitch has no finite ridge, so a minimal roof is drawn. ` +
        `This is a data-entry error in the model, not a design.`,
    );
    return eave + 0.5;
  }
  return r;
}

/** The roof section of one volume. Internal — callers use `roofSectionFor`,
 *  which is the version that takes the material's wall thickness. */
function roofSection(v: Volume): RoofSection {
  const warnings: string[] = [];
  const W = Math.max(1, v.widthFt);
  const D = Math.max(1, v.depthFt);
  const oh = Math.max(0, v.roof.overhangFt);
  const eaveY = Math.max(0.5, v.wallHeightFt * v.storeys);
  const R = drawnRidge(v, warnings);
  const form = v.roof.form;

  // spec.ts's own defaults: a shed faces south so the array is in the sun; a
  // saltbox carries its long slope down the WEATHER side.
  const facing: Wall = v.roof.facing ?? (form === "saltbox" ? "n" : "s");
  // Gable and a-frame always span the width, because that is the span
  // `ridgeHeightFt` uses. Only shed, saltbox and flat can be turned.
  const fallAxis: "x" | "z" =
    form === "gable" || form === "a-frame" ? "x" : WALL_RUN_AXIS[facing] === "x" ? "z" : "x";
  const halfFall = fallAxis === "x" ? W / 2 : D / 2;
  const halfPerp = fallAxis === "x" ? D / 2 : W / 2;
  const dir: 1 | -1 = facing === "s" || facing === "e" ? 1 : -1;
  const span = { s0: -(halfPerp + oh), s1: halfPerp + oh };

  /* Roof thickness needs the material, which a `Volume` does not carry.
     `roofSectionFor` sets it around this call and restores it afterwards, so
     the function stays pure from every caller's point of view. */
  const wallT = roofSectionWallT;

  const finish = (
    apexA: number,
    apexY: number,
    slope: number,
    planes: RoofPlane[],
    parapet: RoofSection["parapet"] = null,
    hasRidge = false,
  ): RoofSection => {
    const angleRad = Math.atan(slope);
    const thicknessFt = Math.max(
      ROOF_THICKNESS_FT,
      wallT * Math.abs(Math.sin(angleRad)) + ROOF_SEAT_FT + 0.05,
    );
    const fallValues = planes.flatMap((p) => [p.a0, p.a1]);
    return {
      form,
      fallAxis,
      facing,
      halfFall,
      halfPerp,
      overhangFt: oh,
      apexA,
      apexY,
      slope,
      angleRad,
      eaveY,
      ridgeY: R,
      thicknessFt,
      topAt: (a: number) => apexY - Math.abs(a - apexA) * slope,
      planes,
      parapet,
      hasRidge,
      fallExtent: extentOf(fallValues),
      perpExtent: { min: span.s0, max: span.s1 },
      buildsWall: (wall: Wall) => form !== "a-frame" || WALL_RUN_AXIS[wall] === fallAxis,
      warnings,
    };
  };

  switch (form) {
    case "flat": {
      const slope = Math.tan((FLAT_ROOF_FALL_DEG * Math.PI) / 180);
      const highA = -dir * (halfFall + oh);
      const lowA = dir * (halfFall + oh);
      const lowY = eaveY - Math.abs(lowA - highA) * slope;
      return finish(
        highA,
        eaveY,
        slope,
        [{ a0: highA, y0: eaveY, a1: lowA, y1: lowY, ...span }],
        { topY: R, halfA: halfFall + oh, halfS: halfPerp + oh, lowY },
      );
    }
    case "shed": {
      // The HIGH edge is flush with the wall — no overhang there — so the built
      // maximum is exactly `ridgeHeightFt`.
      const run = 2 * halfFall;
      const rise = Math.max(0.05, R - eaveY);
      const slope = rise / run;
      const highA = -dir * halfFall;
      const lowA = dir * (halfFall + oh);
      return finish(highA, R, slope, [
        { a0: highA, y0: R, a1: lowA, y1: R - (run + oh) * slope, ...span },
      ]);
    }
    case "saltbox": {
      const run = 2 * halfFall;
      const rise = Math.max(0.05, R - eaveY);
      const needed = rise / (rise + Math.max(0.1, R - SALTBOX_MIN_EAVE_FT));
      const f = Math.min(0.5, Math.max(SALTBOX_SHORT_SHARE, needed));
      const slope = rise / (f * run);
      const apexA = dir * (f * run - halfFall);
      return finish(
        apexA,
        R,
        slope,
        [
          { a0: apexA, y0: R, a1: -dir * (halfFall + oh), y1: R - (f * run + oh) * slope, ...span },
          {
            a0: apexA,
            y0: R,
            a1: dir * (halfFall + oh),
            y1: R - ((1 - f) * run + oh) * slope,
            ...span,
          },
        ],
        null,
        true,
      );
    }
    case "a-frame": {
      // spec.ts DOUBLES the rise for this form, so the plane angle is taken
      // FROM the spec's ridge and never re-derived from pitchDeg.
      const slope = R / halfFall;
      return finish(
        0,
        R,
        slope,
        [
          { a0: 0, y0: R, a1: halfFall + oh, y1: R - (halfFall + oh) * slope, ...span },
          { a0: 0, y0: R, a1: -(halfFall + oh), y1: R - (halfFall + oh) * slope, ...span },
        ],
        null,
        true,
      );
    }
    case "gable":
    default: {
      const rise = Math.max(0.05, R - eaveY);
      const slope = rise / halfFall;
      return finish(
        0,
        R,
        slope,
        [
          { a0: 0, y0: R, a1: halfFall + oh, y1: R - (halfFall + oh) * slope, ...span },
          { a0: 0, y0: R, a1: -(halfFall + oh), y1: R - (halfFall + oh) * slope, ...span },
        ],
        null,
        true,
      );
    }
  }
}

/* The wall thickness the roof-thickness rule needs. A module-level value
   rather than a parameter so `roofSection` keeps the exact shape of
   geometry.ts's `buildRoofModel`; `buildHomeModel` sets it from the spec's
   material before building any volume, and it is restored afterwards, so the
   function stays pure from the caller's point of view. */
let roofSectionWallT = WALL_THICKNESS_MM.sip / MM_PER_FT;

/** Roof section for a volume built of a known material. The one entry point
 *  callers should use. */
export function roofSectionFor(v: Volume, wallT: number): RoofSection {
  const prev = roofSectionWallT;
  roofSectionWallT = wallT;
  try {
    return roofSection(v);
  } finally {
    roofSectionWallT = prev;
  }
}

/** A wall's top edge in (run, height), mirroring geometry.ts's
 *  `wallTopPoints`: a gable end follows the roof section, a wall crossing the
 *  fall axis carries a level top seated at the LOWER of its two roof heights. */
export function wallTopProfile(
  v: Volume,
  wall: Wall,
  roof: RoofSection,
  t: number,
): Pt[] {
  const runFt = wallRunFt(v, wall, t);
  const runsAlong = WALL_RUN_AXIS[wall];
  const { u0, u1, faceInner, faceOuter } = wallPlanFrame(v, wall, t);

  if (runsAlong === roof.fallAxis) {
    const dir = u1 >= u0 ? 1 : -1;
    const pts: Pt[] = [[0, Math.max(0, roof.topAt(u0) - ROOF_SEAT_FT)]];
    const uApex = (roof.apexA - u0) * dir;
    if (uApex > 1e-6 && uApex < runFt - 1e-6) pts.push([uApex, Math.max(0, roof.apexY - ROOF_SEAT_FT)]);
    pts.push([runFt, Math.max(0, roof.topAt(u1) - ROOF_SEAT_FT)]);
    return pts;
  }
  const y = Math.max(0, Math.min(roof.topAt(faceInner), roof.topAt(faceOuter)) - ROOF_SEAT_FT);
  return [
    [0, y],
    [runFt, y],
  ];
}

/* =====================================================================
   WALL FRAMES — where a wall starts, which way it runs, where its faces are
   ===================================================================== */

interface WallPlanFrame {
  /** plan coordinate of run = 0 and run = runFt, on the axis the wall runs */
  u0: number;
  u1: number;
  /** plan coordinates of the inner and outer faces, on the other axis */
  faceInner: number;
  faceOuter: number;
  /** local (x, z) of the run = 0 point, on the OUTER face */
  originOuter: Pt;
}

/** Restated from `lib/builder/geometry.ts::wallFrame`, in plan only. */
function wallPlanFrame(v: Volume, wall: Wall, t: number): WallPlanFrame {
  const W = v.widthFt;
  const D = v.depthFt;
  switch (wall) {
    case "n":
      return { u0: W / 2, u1: -W / 2, faceOuter: -D / 2, faceInner: -D / 2 + t, originOuter: [W / 2, -D / 2] };
    case "s":
      return { u0: -W / 2, u1: W / 2, faceOuter: D / 2, faceInner: D / 2 - t, originOuter: [-W / 2, D / 2] };
    case "e":
      return { u0: D / 2 - t, u1: -D / 2 + t, faceOuter: W / 2, faceInner: W / 2 - t, originOuter: [W / 2, D / 2 - t] };
    default:
      return { u0: -D / 2 + t, u1: D / 2 - t, faceOuter: -W / 2, faceInner: -W / 2 + t, originOuter: [-W / 2, -D / 2 + t] };
  }
}
