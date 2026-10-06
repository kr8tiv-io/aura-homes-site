/* ============================================================================
   BUILDER GEOMETRY — the HomeSpec, made visible.

   This is the half of the promise the user can SEE. `lib/builder/spec.ts` is
   the frozen contract; `lib/design/` turns a room program into a dimensioned
   drawing. This file turns the same HomeSpec into renderable geometry, so the
   thing somebody drags a slider on and the thing that gets drawn are one
   object rather than two models that agree by accident.

   WHAT IT IS NOT. Massing and layout only. Nothing here is a structural
   member, a permit set, or an engineered assembly. Wall thickness is real
   because it changes the plan and the price; the roof slab is a slab, not a
   rafter schedule, and it is never presented as one.

   THREE RULES THIS FILE OBEYS, because breaking any of them is how two parts
   of a system start disagreeing about the same house:

   1. spec.ts OWNS EVERY DERIVED QUANTITY. Ridge height comes from
      `ridgeHeightFt(v)`, footprint from `volumeFootprintSqFt(v)`, areas from
      `totalFloorAreaSqFt` / `groundFootprintSqFt` / `glazedAreaSqFt`. Nothing
      is recomputed inline. The roofs below are built to LAND ON
      `ridgeHeightFt(v)` rather than to re-derive a height from the pitch —
      see THE RIDGE INVARIANT.
   2. THE SITE FRAME IS DECIDED ONCE. A volume's world placement is a position
      and a single yaw, produced by `yawFromBearingDeg`. Every part of a volume
      is authored in that volume's LOCAL frame and returned un-transformed, so
      the scene applies exactly one transform per volume and there is no second
      place for a sign error to live.
   3. PURE. No React, no JSX, no Math.random, no Date.now, no network. The same
      spec produces byte-identical geometry, forever.

   THE RIDGE INVARIANT: for every roof form, the highest point of the built
   model equals `ridgeHeightFt(v)` exactly. Gable, a-frame and saltbox apex at
   it; the shed's high edge is deliberately FLUSH with the wall (only the low
   edge and the two rakes carry the overhang) so an eave cannot poke above the
   number the UI shows against a height limit; the flat roof's parapet coping
   tops out at it. That is the whole reason the roofs are built downward from
   `ridgeHeightFt` instead of upward from `pitchDeg`.

   NAMED DEPARTURES, because a silent one is a bug waiting to be discovered:
   · spec.ts calls `wallHeightFt` "floor to underside of the eave". The built
     model puts the roof's TOP surface on that line, so the underside sits one
     roof-panel thickness lower. Deliberate: it buys the ridge invariant above,
     and trades ~9 inches on a dimension nobody reads off a massing model.
   · `ridgeHeightFt` derives the shed's and the saltbox's rise from `widthFt`
     regardless of which way `facing` points. When the slope is turned to run
     across the depth, the BUILT pitch therefore differs from `pitchDeg`. The
     height is honoured and the built pitch is reported per volume as
     `builtPitchDeg`, rather than the geometry quietly re-deriving a different
     ridge from the pitch.

   LICENCE: nothing new. `three` (MIT) is already a dependency; the polygon
   clipping, the convex inset and the merge below are written here rather than
   pulled in, so no CSG or geometry library is added to an MIT repo.
   ========================================================================== */

import * as THREE from "three";
import {
  glazedAreaSqFt,
  groundFootprintSqFt,
  ridgeHeightFt,
  totalFloorAreaSqFt,
  volumeFootprintSqFt,
  type Deck,
  type HomeSpec,
  type Opening,
  type Volume,
  type Wall,
} from "./spec";
import { WALL_THICKNESS_MM } from "./materials";
import type { EcoMaterial } from "./designApi";

/* ===========================================================================
   UNITS AND THE SITE FRAME
   ===========================================================================

   EVERYTHING HERE IS IN FEET, matching spec.ts and the plan engine. The scene
   can put the whole thing in metres with ONE scale on the root group
   (`FT_TO_M`) — which is cheaper and far less error-prone than converting at
   a hundred call sites and getting ninety-nine of them right.

   Axes: +X east, +Z south (so north is −Z), +Y up. y = 0 is FINISHED FLOOR,
   shared by every volume, because the spec has no per-volume elevation.
   Grade is below it at `GRADE_Y_FT`: the homes stand on screw piles, never
   on concrete, which is standing repo doctrine (lib/design/materials.ts).
*/

/** Millimetres per foot. Wall thickness is the system's only mm dimension. */
export const MM_PER_FT = 304.8;

/** Scale the root group by this to render the model in metres. */
export const FT_TO_M = 0.3048;

/** Structural floor deck below finished floor. */
export const FLOOR_SLAB_FT = 0.75;
/** How far the piles stand proud of grade — the "visible crawl space shadow". */
export const PILE_EXPOSURE_FT = 2.0;
/** Ground plane height in a volume's local frame, and in the site frame. */
export const GRADE_Y_FT = -(FLOOR_SLAB_FT + PILE_EXPOSURE_FT);

/** Nominal screw-pile grid. The BOM's pile COUNT is the priced authority
 *  (lib/design/materials.ts `buildBom`); these are the visual representation
 *  of the same ~8 ft grid and are capped so a huge volume cannot flood the
 *  scene with cylinders. */
export const PILE_GRID_FT = 8;
export const MAX_PILES_PER_VOLUME = 48;
export const PILE_RADIUS_FT = 0.17;

/** Roof panel thickness. Raised per-volume when a thick wall meets a steep
 *  pitch — see `roofThicknessFor`, which is what keeps wall tops from either
 *  poking through the roof or leaving a slot of daylight under it. */
export const ROOF_THICKNESS_FT = 0.9;
/** How far a wall top is seated INSIDE the roof slab, so no wall face is ever
 *  coplanar with a roof face (coplanar faces are what z-fighting is). */
export const ROOF_SEAT_FT = 0.15;
/** Drainage fall on a "flat" roof. spec.ts fixes this at 2°. */
export const FLAT_ROOF_FALL_DEG = 2;
/** Parapet upstand on a flat roof. spec.ts's `ridgeHeightFt` for "flat" is
 *  `wall + 0.5`, so this must stay 0.5 for the ridge invariant to hold. */
export const PARAPET_FT = 0.5;
export const PARAPET_THICKNESS_FT = 0.5;
export const RIDGE_CAP_WIDTH_FT = 1.1;
export const RIDGE_CAP_HEIGHT_FT = 0.28;

/** Window / door frame face width and glazing thickness. */
export const FRAME_WIDTH_FT = 0.22;
export const GLASS_THICKNESS_FT = 0.08;
/** Where the glass sits in the reveal, as a fraction of wall thickness from
 *  the OUTER face. 0.3 gives rammed earth its deep exterior reveal for free. */
export const GLASS_SET_FRACTION = 0.3;
export const DOOR_THICKNESS_FT = 0.18;
export const SILL_PROJECT_FT = 0.35;
export const SILL_THICKNESS_FT = 0.12;
export const SILL_OVERHANG_FT = 0.15;
/** A glazing wall reads as a glazed SCREEN, not one impossible pane. */
export const MULLION_SPACING_FT = 4.0;
export const MULLION_WIDTH_FT = 0.18;

/** Deck walking surface, one step below finished floor. */
export const DECK_STEP_FT = 0.5;
export const DECK_SLAB_FT = 0.25;
export const DECK_BEAM_FT = 0.8;
export const DECK_PILE_GRID_FT = 6;
export const MAX_DECK_PILES = 24;
export const HOT_TUB_RADIUS_FT = 3.0;
export const HOT_TUB_HEIGHT_FT = 3.2;

/** Openings are held this far off the wall outline. Two reasons, both real:
 *  a hole that shares an edge with its outline degenerates the triangulation,
 *  and a door with `sillFt: 0` (the default spec has one) sits exactly on the
 *  wall's base line. A 1/4-inch skirt is invisible and keeps earcut honest. */
export const OPENING_EDGE_CLEAR_FT = 0.02;

/** A ridge past this is a data-entry accident (pitchDeg near 90 sends
 *  `ridgeHeightFt` to infinity). Geometry clamps and says so; the SUMMARY
 *  still reports spec.ts's number, because that is the contract. */
export const MAX_DRAWN_RIDGE_FT = 200;

/** Saltbox: how low the long slope's eave may come before the ridge is slid
 *  back toward centre. */
export const SALTBOX_MIN_EAVE_FT = 1.5;
/** The short slope's share of the run. Classic New England proportion. */
export const SALTBOX_SHORT_SHARE = 0.38;

/* ===========================================================================
   A SMALL CONVEX-POLYGON TOOLKIT

   Every wall outline this file produces is CONVEX — a rectangle, a trapezoid
   (shed), a tent (gable, saltbox) or a triangle (a-frame gable end). That is
   not luck, it is what lets openings be clipped exactly with twenty lines of
   Sutherland–Hodgman instead of a general polygon-boolean dependency.
   =========================================================================== */

/** A point in a 2D working plane: wall (run, height), or site (x, z). */
export type Pt2 = readonly [number, number];
export type Poly2 = Pt2[];

/** Half-plane `n · p >= d`, with `n` a unit inward normal. */
interface HalfPlane {
  nx: number;
  ny: number;
  d: number;
}

/** Signed area, doubled. Positive when the ring winds counter-clockwise. */
function shoelace2(poly: Poly2): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/** Unsigned area. */
export function polygonArea(poly: Poly2): number {
  return Math.abs(shoelace2(poly)) / 2;
}

/** Same ring, guaranteed counter-clockwise. */
function ccw(poly: Poly2): Poly2 {
  return shoelace2(poly) < 0 ? [...poly].reverse() : poly;
}

/** Drop consecutive (and wrap-around) duplicate vertices. */
function dedupe(poly: Poly2, tol = 1e-4): Poly2 {
  const out: Poly2 = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < tol && Math.abs(q[1] - p[1]) < tol) continue;
    out.push(p);
  }
  while (
    out.length > 1 &&
    Math.abs(out[0][0] - out[out.length - 1][0]) < tol &&
    Math.abs(out[0][1] - out[out.length - 1][1]) < tol
  ) {
    out.pop();
  }
  return out;
}

/** Inward half-planes of a CCW convex ring, each pushed in by `inset`. */
function halfPlanesOf(poly: Poly2, inset = 0): HalfPlane[] {
  const out: HalfPlane[] = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    // CCW ring: rotating the edge +90° points into the interior.
    const nx = -ey / len;
    const ny = ex / len;
    out.push({ nx, ny, d: nx * a[0] + ny * a[1] + inset });
  }
  return out;
}

/** Sutherland–Hodgman against one half-plane. Convex in, convex out. */
function clipToHalfPlane(poly: Poly2, h: HalfPlane): Poly2 {
  if (poly.length === 0) return poly;
  const out: Poly2 = [];
  const inside = (p: Pt2) => h.nx * p[0] + h.ny * p[1] - h.d;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const da = inside(a);
    const db = inside(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return dedupe(out);
}

/** Intersect a convex ring with a set of half-planes. */
function clipToHalfPlanes(poly: Poly2, planes: readonly HalfPlane[]): Poly2 {
  let p = poly;
  for (const h of planes) {
    p = clipToHalfPlane(p, h);
    if (p.length < 3) return [];
  }
  return p;
}

/** Intersection of two convex rings. Both must be CCW. */
export function convexIntersection(a: Poly2, b: Poly2): Poly2 {
  return clipToHalfPlanes(a, halfPlanesOf(b));
}

/** A convex ring shrunk by `d` on every edge — exact for convex input, and it
 *  is the same clipper, which is why there is no offsetting library here. */
function insetConvex(poly: Poly2, d: number): Poly2 {
  return clipToHalfPlanes(poly, halfPlanesOf(poly, d));
}

/** An axis-aligned rectangle as a CCW ring. */
function rectPoly(x0: number, y0: number, x1: number, y1: number): Poly2 {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

interface Aabb2 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function aabbOf(poly: Poly2): Aabb2 {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

function aabbOverlap(a: Aabb2, b: Aabb2, tol = 1e-6): boolean {
  return a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;
}

/** Is this ring a 4-point axis-aligned rectangle? The overwhelmingly common
 *  case, and the fast path that keeps an un-openinged wall a single BoxGeometry
 *  instead of a triangulation. */
function asAxisRect(poly: Poly2, tol = 1e-6): Aabb2 | null {
  if (poly.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    const dx = Math.abs(b[0] - a[0]);
    const dy = Math.abs(b[1] - a[1]);
    if (dx > tol && dy > tol) return null; // not axis aligned
  }
  const box = aabbOf(poly);
  if (box.x1 - box.x0 < tol || box.y1 - box.y0 < tol) return null;
  return box;
}

/* ===========================================================================
   THE SITE FRAME — one function, one sign, one place to be wrong
   =========================================================================== */

/**
 * A compass bearing (degrees CLOCKWISE from north, spec.ts's convention) as a
 * three.js rotation about +Y.
 *
 * With north at −Z and east at +X, a POSITIVE three.js Y rotation carries
 * north toward WEST — counter-clockwise on a map. Clockwise is therefore
 * negative. That sign lives here and nowhere else; `Volume.rotationDeg` and
 * `Siting.frontFacesDeg` both go through it.
 */
export function yawFromBearingDeg(bearingDeg: number): number {
  return (-bearingDeg * Math.PI) / 180;
}

/** Structural wall thickness in FEET for the spec's material. */
export function wallThicknessFt(material: EcoMaterial): number {
  return WALL_THICKNESS_MM[material] / MM_PER_FT;
}

/**
 * Which plan axis a wall RUNS along, in the volume's own frame.
 * n/s span the width (local X); e/w span the depth (local Z).
 */
const WALL_RUN_AXIS: Readonly<Record<Wall, "x" | "z">> = {
  n: "x",
  s: "x",
  e: "z",
  w: "z",
};

/**
 * Run direction and outward normal of each wall, in the volume's own frame.
 *
 * The run directions are not arbitrary: spec.ts measures `Opening.offsetFt`
 * "from the wall's left end, looking at it from outside". Stand outside each
 * wall facing the building and the left-to-right direction is the vector
 * below — and, usefully, `run × up === out` for all four, which is exactly
 * the right-handed basis the wall extrusion needs. If a future edit breaks
 * one of these, the extrusion inverts and the wall renders inside-out, which
 * is a loud failure rather than a quiet one.
 */
const WALL_AXES: Readonly<Record<Wall, { run: THREE.Vector3; out: THREE.Vector3 }>> = {
  n: { run: new THREE.Vector3(-1, 0, 0), out: new THREE.Vector3(0, 0, -1) },
  s: { run: new THREE.Vector3(1, 0, 0), out: new THREE.Vector3(0, 0, 1) },
  e: { run: new THREE.Vector3(0, 0, -1), out: new THREE.Vector3(1, 0, 0) },
  w: { run: new THREE.Vector3(0, 0, 1), out: new THREE.Vector3(-1, 0, 0) },
};

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The BUILT length of a wall, feet.
 *
 * The n and s walls run the full width. The e and w walls butt INTO them, so
 * they are two wall thicknesses shorter than `depthFt` — a real corner, and
 * the reason the four walls never overlap each other. The UI should clamp
 * `Opening.offsetFt` against this, not against `depthFt`.
 */
export function wallRunFt(v: Volume, wall: Wall, thicknessFt: number): number {
  return WALL_RUN_AXIS[wall] === "x"
    ? v.widthFt
    : Math.max(0.5, v.depthFt - 2 * thicknessFt);
}

/** The four plan corners of a volume, in WORLD feet, counter-clockwise. */
export function volumeCornersPlan(v: Volume): Pt2[] {
  return rectCornersPlan(v.x, v.z, v.widthFt, v.depthFt, v.rotationDeg);
}

/** Plan corners of any centred, yawed rectangle, in WORLD feet. */
export function rectCornersPlan(
  cx: number,
  cz: number,
  widthFt: number,
  depthFt: number,
  rotationDeg: number,
): Pt2[] {
  const yaw = yawFromBearingDeg(rotationDeg);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const hw = widthFt / 2;
  const hd = depthFt / 2;
  const local: Pt2[] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  // three.js rotation about +Y: x' = x·cos + z·sin, z' = −x·sin + z·cos
  return local.map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c] as Pt2);
}

/**
 * Overlap of two volumes in plan, square feet. 0 when they do not overlap.
 *
 * spec.ts SUMS footprints rather than unioning them, deliberately — so this
 * number is exactly how much `groundFootprintSqFt` over-reports, and the UI
 * can say so instead of the coverage figure quietly being wrong.
 */
export function volumeOverlapSqFt(a: Volume, b: Volume): number {
  const pa = ccw(volumeCornersPlan(a));
  const pb = ccw(volumeCornersPlan(b));
  if (!aabbOverlap(aabbOf(pa), aabbOf(pb))) return 0; // cheap reject first
  const hit = convexIntersection(pa, pb);
  return hit.length < 3 ? 0 : polygonArea(hit);
}

/* ===========================================================================
   THE CHEAP SUMMARY — everything the UI can show without rendering a frame
   =========================================================================== */

export interface VolumeSummary {
  id: string;
  name: string;
  /** straight from spec.ts — never recomputed here */
  ridgeHeightFt: number;
  /** straight from spec.ts */
  footprintSqFt: number;
  eaveHeightFt: number;
  /** world plan corners, CCW, walls only */
  plan: Pt2[];
}

export interface VolumeOverlap {
  a: string;
  b: string;
  areaSqFt: number;
}

export interface PlanBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** east–west extent */
  widthFt: number;
  /** north–south extent */
  depthFt: number;
}

export interface SiteSummary {
  volumes: VolumeSummary[];
  /** walls and deck only — the line a setback is normally measured to */
  bounds: PlanBounds;
  /** including eave overhangs — the line a bylaw with a projection limit wants */
  boundsWithRoof: PlanBounds;
  /** tallest `ridgeHeightFt` on the site */
  maxRidgeHeightFt: number;
  overlaps: VolumeOverlap[];
  hasOverlap: boolean;
  /** total overlap area = how much `groundFootprintSqFt` over-reports */
  overlapAreaSqFt: number;
  /* the three spec.ts areas, forwarded so the UI has one call and one source */
  totalFloorAreaSqFt: number;
  groundFootprintSqFt: number;
  glazedAreaSqFt: number;
}

export interface HomeCameraFrame {
  distance: number;
  height: number;
  position: [number, number, number];
  target: [number, number, number];
}

/**
 * Stable editor framing derived from the loaded home's actual world bounds.
 * Keeping this pure lets the viewport re-use the same frame for initial load
 * and "Frame the home" without snapping ordinary edits back to world origin.
 */
export function cameraFrameForSummary(summary: SiteSummary): HomeCameraFrame {
  const bounds = summary.boundsWithRoof;
  const span = Math.max(30, bounds.widthFt, bounds.depthFt, summary.maxRidgeHeightFt * 1.6);
  const distance = span * 1.9;
  const height = span * 0.85;
  const target: [number, number, number] = [
    (bounds.minX + bounds.maxX) / 2,
    Math.max(6, summary.maxRidgeHeightFt * 0.4),
    (bounds.minZ + bounds.maxZ) / 2,
  ];
  return {
    distance,
    height,
    position: [target[0] + distance * 0.72, height, target[2] + distance],
    target,
  };
}

function boundsOf(polys: readonly Poly2[]): PlanBounds {
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
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, widthFt: 0, depthFt: 0 };
  }
  return { minX, maxX, minZ, maxZ, widthFt: maxX - minX, depthFt: maxZ - minZ };
}

/** Plan corners of the deck, in WORLD feet, or null if there is no deck. */
export function deckCornersPlan(spec: HomeSpec): Pt2[] | null {
  const deck = spec.deck;
  const host = spec.volumes[0];
  if (!deck || !host) return null;
  const runsAlongX = WALL_RUN_AXIS[deck.wall] === "x";
  // Distance from the volume centre to the OUTER face of the host wall.
  const face = runsAlongX ? host.depthFt / 2 : host.widthFt / 2;
  const out = WALL_AXES[deck.wall].out;
  const cx = out.x * (face + deck.depthFt / 2);
  const cz = out.z * (face + deck.depthFt / 2);
  // The deck's width lies along the wall; its depth lies along the normal.
  const w = runsAlongX ? deck.widthFt : deck.depthFt;
  const d = runsAlongX ? deck.depthFt : deck.widthFt;
  const yaw = yawFromBearingDeg(host.rotationDeg);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Rotate the deck's local centre into the site frame, then offset by the host.
  const wx = host.x + cx * c + cz * s;
  const wz = host.z - cx * s + cz * c;
  return rectCornersPlan(wx, wz, w, d, host.rotationDeg);
}

/**
 * Everything the panel needs, with no geometry built and nothing uploaded to
 * the GPU. Safe to call on every keystroke.
 *
 * Cost is O(V² + V·O): one convex clip per volume PAIR (behind an AABB
 * reject) and one pass over the openings. For any plausible home — a handful
 * of volumes — that is a few hundred floating-point operations.
 */
export function summarizeHome(spec: HomeSpec): SiteSummary {
  const volumes: VolumeSummary[] = spec.volumes.map((v) => ({
    id: v.id,
    name: v.name,
    ridgeHeightFt: ridgeHeightFt(v),
    footprintSqFt: volumeFootprintSqFt(v),
    eaveHeightFt: v.wallHeightFt * v.storeys,
    plan: ccw(volumeCornersPlan(v)),
  }));

  const overlaps: VolumeOverlap[] = [];
  let overlapAreaSqFt = 0;
  for (let i = 0; i < spec.volumes.length; i++) {
    for (let j = i + 1; j < spec.volumes.length; j++) {
      const area = volumeOverlapSqFt(spec.volumes[i], spec.volumes[j]);
      if (area > 1e-3) {
        overlaps.push({ a: spec.volumes[i].id, b: spec.volumes[j].id, areaSqFt: area });
        overlapAreaSqFt += area;
      }
    }
  }

  const deckPoly = deckCornersPlan(spec);
  const wallPolys: Poly2[] = volumes.map((v) => v.plan);
  if (deckPoly) wallPolys.push(deckPoly);

  const roofPolys: Poly2[] = spec.volumes.map((v) =>
    // A conservative envelope: the eave overhang projects on all four sides
    // for the ridge-parallel eaves and the two rakes alike.
    rectCornersPlan(
      v.x,
      v.z,
      v.widthFt + 2 * Math.max(0, v.roof.overhangFt),
      v.depthFt + 2 * Math.max(0, v.roof.overhangFt),
      v.rotationDeg,
    ),
  );
  if (deckPoly) roofPolys.push(deckPoly);

  return {
    volumes,
    bounds: boundsOf(wallPolys),
    boundsWithRoof: boundsOf(roofPolys),
    maxRidgeHeightFt: volumes.reduce((m, v) => Math.max(m, v.ridgeHeightFt), 0),
    overlaps,
    hasOverlap: overlaps.length > 0,
    overlapAreaSqFt,
    totalFloorAreaSqFt: totalFloorAreaSqFt(spec),
    groundFootprintSqFt: groundFootprintSqFt(spec),
    glazedAreaSqFt: glazedAreaSqFt(spec),
  };
}

/* ===========================================================================
   THE ROOF MODEL — one section function, five forms

   Every roof here reduces to a single scalar function of ONE axis:

       topAt(a) = apexY − |a − apexA| · slope

   the height of the roof's TOP surface at position `a` along the axis the
   slopes fall down. Gable and a-frame fall across the width; shed, saltbox
   and flat fall whichever way `facing` points. That one function then drives
   BOTH the roof planes and every wall's top edge, which is why a gable end
   can never drift out of contact with the roof sitting on it.
   =========================================================================== */

/** A roof plane, described in the (fall axis, height) section plus a span. */
interface SlabSpec {
  a0: number;
  y0: number;
  a1: number;
  y1: number;
  /** extent on the perpendicular plan axis */
  s0: number;
  s1: number;
}

interface RoofModel {
  fallAxis: "x" | "z";
  /** fall-axis position and height of the high line (ridge, or high eave) */
  apexA: number;
  apexY: number;
  /** tangent of the pitch as BUILT (see the named departure in the header) */
  slope: number;
  angleRad: number;
  /** roof panel thickness for this volume */
  thicknessFt: number;
  /** floor to the eave line, = wallHeightFt × storeys */
  eaveY: number;
  /** the built maximum height — equal to ridgeHeightFt(v) by construction */
  builtRidgeY: number;
  topAt: (a: number) => number;
  slabs: SlabSpec[];
  ridgeCap: { a: number; halfSpan: number } | null;
  parapet: { topY: number; halfA: number; halfS: number; lowY: number } | null;
  /** false for the walls an a-frame does not have: the slope IS the wall */
  buildsWall: (wall: Wall) => boolean;
}

/** Which way the fall runs on its axis: +1 toward +X/+Z, −1 toward −X/−Z. */
function fallDirection(facing: Wall): 1 | -1 {
  return facing === "s" || facing === "e" ? 1 : -1;
}

/**
 * Roof thickness for this volume.
 *
 * A wall that crosses the fall axis has a top edge at ONE height but meets a
 * SLOPING roof, so its top is `t·tanθ` out of level across its own thickness.
 * Seat the wall at the low end of that range and it never pokes through the
 * roof; the roof then has to be deep enough to swallow the high end, which is
 * exactly `t·sinθ + seat`. A 450 mm rammed-earth wall under a steep pitch
 * therefore gets a deeper roof — which is also how it would really be built.
 */
function roofThicknessFor(wallT: number, angleRad: number): number {
  return Math.max(
    ROOF_THICKNESS_FT,
    wallT * Math.abs(Math.sin(angleRad)) + ROOF_SEAT_FT + 0.05,
  );
}

/** `ridgeHeightFt(v)`, guarded for the pitches that send tan() to infinity. */
function drawnRidgeFt(v: Volume, warnings: string[]): number {
  const r = ridgeHeightFt(v);
  const eave = v.wallHeightFt * v.storeys;
  if (!Number.isFinite(r) || r <= 0) {
    warnings.push(
      `${v.name}: a ${v.roof.pitchDeg}° pitch has no finite ridge; a minimal roof was drawn instead.`,
    );
    return eave + 0.5;
  }
  if (r > MAX_DRAWN_RIDGE_FT) {
    warnings.push(
      `${v.name}: a ${v.roof.pitchDeg}° pitch gives a ${r.toFixed(0)} ft ridge; the drawing is clamped at ${MAX_DRAWN_RIDGE_FT} ft. The summary still reports the spec figure.`,
    );
    return MAX_DRAWN_RIDGE_FT;
  }
  return r;
}

function buildRoofModel(v: Volume, wallT: number, warnings: string[]): RoofModel {
  const W = Math.max(1, v.widthFt);
  const D = Math.max(1, v.depthFt);
  const oh = Math.max(0, v.roof.overhangFt);
  const eaveY = Math.max(0.5, v.wallHeightFt * v.storeys);
  const R = drawnRidgeFt(v, warnings);
  const form = v.roof.form;

  // Defaults come from spec.ts's own comments: a shed faces south so the array
  // is in the sun; a saltbox carries its long slope down the WEATHER side.
  const facing: Wall = v.roof.facing ?? (form === "saltbox" ? "n" : "s");
  // Gable and a-frame always span the width, because that is the span
  // `ridgeHeightFt` uses. Only shed, saltbox and flat can be turned.
  const fallAxis: "x" | "z" =
    form === "gable" || form === "a-frame" ? "x" : WALL_RUN_AXIS[facing] === "x" ? "z" : "x";
  const half = fallAxis === "x" ? W / 2 : D / 2;
  const perpHalf = fallAxis === "x" ? D / 2 : W / 2;
  const dir = fallDirection(facing);
  const span: Pick<SlabSpec, "s0" | "s1"> = { s0: -(perpHalf + oh), s1: perpHalf + oh };

  const finish = (
    apexA: number,
    apexY: number,
    slope: number,
    slabs: SlabSpec[],
    opts: {
      builtRidgeY: number;
      ridgeCap?: RoofModel["ridgeCap"];
      parapet?: RoofModel["parapet"];
    },
  ): RoofModel => {
    const angleRad = Math.atan(slope);
    return {
      fallAxis,
      apexA,
      apexY,
      slope,
      angleRad,
      thicknessFt: roofThicknessFor(wallT, angleRad),
      eaveY,
      builtRidgeY: opts.builtRidgeY,
      topAt: (a: number) => apexY - Math.abs(a - apexA) * slope,
      slabs,
      ridgeCap: opts.ridgeCap ?? null,
      parapet: opts.parapet ?? null,
      buildsWall: (wall: Wall) => form !== "a-frame" || WALL_RUN_AXIS[wall] === fallAxis,
    };
  };

  switch (form) {
    case "flat": {
      /* Near-flat with a hidden fall to a scupper, inside a parapet. The DECK
         tops out at the eave line and falls at spec.ts's fixed 2°; the parapet
         coping is what reaches `ridgeHeightFt` (= wall + 0.5). That is the
         only reading under which both of spec.ts's statements are true. */
      const slope = Math.tan((FLAT_ROOF_FALL_DEG * Math.PI) / 180);
      const highA = -dir * (half + oh);
      const lowA = dir * (half + oh);
      const lowY = eaveY - Math.abs(lowA - highA) * slope;
      return finish(highA, eaveY, slope, [{ a0: highA, y0: eaveY, a1: lowA, y1: lowY, ...span }], {
        builtRidgeY: R,
        parapet: { topY: R, halfA: half + oh, halfS: perpHalf + oh, lowY },
      });
    }

    case "shed": {
      /* One plane. The HIGH edge is flush with the wall — no overhang there —
         so the built maximum is exactly `ridgeHeightFt`. Only the low edge and
         the two rakes project. */
      const run = 2 * half;
      const rise = Math.max(0.05, R - eaveY);
      const slope = rise / run;
      const highA = -dir * half;
      const lowA = dir * (half + oh);
      return finish(
        highA,
        R,
        slope,
        [{ a0: highA, y0: R, a1: lowA, y1: R - (run + oh) * slope, ...span }],
        { builtRidgeY: R },
      );
    }

    case "saltbox": {
      /* A gable with the ridge slid off centre: the SAME pitch both sides, so
         the long side simply ends lower — which is what buys the covered
         elevation on the weather side. If that would bring the long eave below
         head height the ridge slides back toward centre, rather than the roof
         burying itself in the ground. */
      const run = 2 * half;
      const rise = Math.max(0.05, R - eaveY);
      const needed = rise / (rise + Math.max(0.1, R - SALTBOX_MIN_EAVE_FT));
      const f = Math.min(0.5, Math.max(SALTBOX_SHORT_SHARE, needed));
      const slope = rise / (f * run);
      const apexA = dir * (f * run - half);
      return finish(
        apexA,
        R,
        slope,
        [
          { a0: apexA, y0: R, a1: -dir * (half + oh), y1: R - (f * run + oh) * slope, ...span },
          { a0: apexA, y0: R, a1: dir * (half + oh), y1: R - ((1 - f) * run + oh) * slope, ...span },
        ],
        { builtRidgeY: R, ridgeCap: { a: apexA, halfSpan: perpHalf + oh } },
      );
    }

    case "a-frame": {
      /* The slope IS the wall. spec.ts DOUBLES the rise for this form
         (`rise(width, pitch) * 2`), and that doubling is precisely what makes
         it read as the Aura reference home rather than a steep cottage — so
         the plane angle is taken FROM the spec's ridge, never re-derived from
         pitchDeg. The eave lands on the floor line and the overhang carries
         below it, which is what "meets near grade" means on a home standing
         on piles. */
      const slope = R / half;
      return finish(
        0,
        R,
        slope,
        [
          { a0: 0, y0: R, a1: half + oh, y1: R - (half + oh) * slope, ...span },
          { a0: 0, y0: R, a1: -(half + oh), y1: R - (half + oh) * slope, ...span },
        ],
        { builtRidgeY: R, ridgeCap: { a: 0, halfSpan: perpHalf + oh } },
      );
    }

    case "gable":
    default: {
      const rise = Math.max(0.05, R - eaveY);
      const slope = rise / half;
      return finish(
        0,
        R,
        slope,
        [
          { a0: 0, y0: R, a1: half + oh, y1: R - (half + oh) * slope, ...span },
          { a0: 0, y0: R, a1: -(half + oh), y1: R - (half + oh) * slope, ...span },
        ],
        { builtRidgeY: R, ridgeCap: { a: 0, halfSpan: perpHalf + oh } },
      );
    }
  }
}

/* ===========================================================================
   WALL FRAMES — a 2D drawing plane per wall, and the matrix that places it
   =========================================================================== */

interface WallFrame {
  wall: Wall;
  /** built length, feet */
  runFt: number;
  thicknessFt: number;
  /** (run, height, outward) → volume-local. Orthonormal, right-handed. */
  matrix: THREE.Matrix4;
  runsAlong: "x" | "z";
  /** plan coordinate of u = 0 and u = runFt, on the axis the wall runs along */
  u0: number;
  u1: number;
  /** plan coordinates of the inner and outer faces, on the other axis */
  faceInner: number;
  faceOuter: number;
}

/**
 * Build a wall's local drawing frame.
 *
 * The frame's +X is the run (left-to-right seen from OUTSIDE, matching
 * `Opening.offsetFt`), +Y is up from the finished floor, and +Z is the
 * outward normal — so a shape extruded from z = 0 to z = thickness runs from
 * the INNER face to the OUTER one, and `run × up === out` makes the basis
 * right-handed without a correction anywhere.
 *
 * n and s take the full width; e and w butt INTO them and are two wall
 * thicknesses shorter. That is what makes the four boxes a corner rather than
 * an overlap, and it is why `wallRunFt` exists for the UI to clamp against.
 */
function wallFrame(v: Volume, wall: Wall, t: number): WallFrame {
  const W = v.widthFt;
  const D = v.depthFt;
  const runsAlong = WALL_RUN_AXIS[wall];
  const runFt = wallRunFt(v, wall, t);
  const axes = WALL_AXES[wall];

  let origin: THREE.Vector3;
  let u0: number;
  let u1: number;
  let faceInner: number;
  let faceOuter: number;

  switch (wall) {
    case "n":
      origin = new THREE.Vector3(W / 2, 0, -D / 2 + t);
      u0 = W / 2;
      u1 = -W / 2;
      faceOuter = -D / 2;
      faceInner = -D / 2 + t;
      break;
    case "s":
      origin = new THREE.Vector3(-W / 2, 0, D / 2 - t);
      u0 = -W / 2;
      u1 = W / 2;
      faceOuter = D / 2;
      faceInner = D / 2 - t;
      break;
    case "e":
      origin = new THREE.Vector3(W / 2 - t, 0, D / 2 - t);
      u0 = D / 2 - t;
      u1 = -D / 2 + t;
      faceOuter = W / 2;
      faceInner = W / 2 - t;
      break;
    default:
      origin = new THREE.Vector3(-W / 2 + t, 0, -D / 2 + t);
      u0 = -D / 2 + t;
      u1 = D / 2 - t;
      faceOuter = -W / 2;
      faceInner = -W / 2 + t;
      break;
  }

  const matrix = new THREE.Matrix4().makeBasis(axes.run, UP, axes.out).setPosition(origin);
  return { wall, runFt, thicknessFt: t, matrix, runsAlong, u0, u1, faceInner, faceOuter };
}

/**
 * The wall's top edge, as a polyline in (run, height).
 *
 * A wall that RUNS ALONG the fall axis is a gable end: its top follows the
 * roof section, with a vertex at the ridge if the ridge crosses it. A wall
 * that crosses the fall axis carries a level top, seated at the LOWER of the
 * roof heights over its own thickness so nothing pokes through — the
 * counterpart of `roofThicknessFor`, which guarantees no gap on the other
 * side of that trade.
 */
function wallTopPoints(f: WallFrame, roof: RoofModel): Pt2[] {
  const seat = ROOF_SEAT_FT;
  if (f.runsAlong === roof.fallAxis) {
    const dir = f.u1 >= f.u0 ? 1 : -1;
    const pts: Pt2[] = [[0, Math.max(0, roof.topAt(f.u0) - seat)]];
    const uApex = (roof.apexA - f.u0) * dir;
    if (uApex > 1e-6 && uApex < f.runFt - 1e-6) {
      pts.push([uApex, Math.max(0, roof.apexY - seat)]);
    }
    pts.push([f.runFt, Math.max(0, roof.topAt(f.u1) - seat)]);
    return pts;
  }
  const y = Math.max(0, Math.min(roof.topAt(f.faceInner), roof.topAt(f.faceOuter)) - seat);
  return [
    [0, y],
    [f.runFt, y],
  ];
}

/* ===========================================================================
   GEOMETRY PRIMITIVES

   Three builders, and every part in the file comes out of one of them. Each
   returns a BufferGeometry already positioned in the volume's LOCAL frame, so
   a Part carries no transform of its own and the scene applies exactly one
   matrix per volume.
   =========================================================================== */

/**
 * A prism: a convex polygon with optional holes, extruded along the wall's
 * outward normal from `w0` to `w0 + depth`, then placed by `M`.
 *
 * WHY NOT CSG. A boolean per opening is the obvious way to cut a window and
 * it is a trap: it needs a BSP/BVH library this MIT repo does not have, it
 * allocates a fresh mesh per operation, and its cost scales with the FACE
 * COUNT of both operands — on a slider drag that is a stall you can feel. A
 * hole in a flat wall is a 2D problem, so it is solved in 2D: the opening is
 * clipped to the wall outline (exactly, because both are convex), handed to
 * three's own triangulator as a hole, and extruded once. Earcut over ~24
 * points is microseconds, the result is exact rather than approximate, and
 * the extrusion gives the window REVEAL for free — which is how a 450 mm
 * rammed-earth wall gets its deep reveals without anyone modelling them.
 *
 * The rectangle fast path matters: an un-openinged wall, and almost every
 * pane, sill and door, is an axis-aligned rectangle, and a BoxGeometry skips
 * the triangulator entirely.
 */
function prism(
  outline: Poly2,
  holes: readonly Poly2[],
  w0: number,
  depth: number,
  M: THREE.Matrix4,
): THREE.BufferGeometry | null {
  if (outline.length < 3 || depth <= 1e-6) return null;
  let g: THREE.BufferGeometry;
  const rect = holes.length === 0 ? asAxisRect(outline) : null;
  if (rect) {
    g = new THREE.BoxGeometry(rect.x1 - rect.x0, rect.y1 - rect.y0, depth);
    g.translate((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, w0 + depth / 2);
  } else {
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of holes) {
      if (h.length >= 3) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    }
    g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
    });
    if (w0 !== 0) g.translate(0, 0, w0);
  }
  g.applyMatrix4(M);
  return g;
}

/** A box drawn in a wall's (run, height, outward) frame. */
function wallBox(
  du: number,
  dh: number,
  dw: number,
  cu: number,
  ch: number,
  cw: number,
  M: THREE.Matrix4,
): THREE.BufferGeometry | null {
  if (du <= 1e-6 || dh <= 1e-6 || dw <= 1e-6) return null;
  const g = new THREE.BoxGeometry(du, dh, dw);
  g.translate(cu, ch, cw);
  g.applyMatrix4(M);
  return g;
}

/**
 * A roof plane: a slab whose TOP surface passes through the two section
 * points, spanning `s0..s1` on the perpendicular plan axis.
 *
 * Built with X along the slope, then tilted, then (for a fall along Z) swung
 * a quarter turn so X becomes Z. The swing is a ROTATION, never a mirror —
 * a mirror would invert every normal on the roof and light it from inside.
 */
function slopedSlab(
  fallAxis: "x" | "z",
  spec: SlabSpec,
  thickness: number,
): THREE.BufferGeometry | null {
  /* ORIENT THE SECTION FIRST — this is not tidying, it is the correctness
     step. A slab is described ridge-to-eave, so half of them run in the
     −axis direction (the west slope of every gable, any shed or saltbox
     facing north or west). Left as given, `atan2` returns an angle near ±π,
     `rotateZ` turns the box UPSIDE DOWN, and the "top" face the half-thickness
     offset is measured from is really the bottom: the whole plane lands one
     roof thickness too high and every roof normal points into the building.
     Sorting the two endpoints keeps θ inside (−π/2, π/2), where the offset
     below means what it says. Caught by asserting the ridge invariant across
     all five forms — it was a silent 0.9 ft on the model and a lighting bug
     on screen. */
  const flipEnds = spec.a1 < spec.a0;
  const a0 = flipEnds ? spec.a1 : spec.a0;
  const y0 = flipEnds ? spec.y1 : spec.y0;
  const a1 = flipEnds ? spec.a0 : spec.a1;
  const y1 = flipEnds ? spec.y0 : spec.y1;

  const da = a1 - a0;
  const dy = y1 - y0;
  const length = Math.hypot(da, dy);
  const width = Math.abs(spec.s1 - spec.s0);
  if (length <= 1e-6 || width <= 1e-6 || thickness <= 1e-6) return null;

  const theta = Math.atan2(dy, da);
  // Push the centre a half-thickness down the plane's normal, so the slab's
  // TOP face — not its centreline — lies on the section line.
  const ca = (a0 + a1) / 2 + Math.sin(theta) * (thickness / 2);
  const cy = (y0 + y1) / 2 - Math.cos(theta) * (thickness / 2);
  const cs = (spec.s0 + spec.s1) / 2;

  const g = new THREE.BoxGeometry(length, thickness, width);
  g.rotateZ(theta);
  const flip = fallAxis === "z";
  g.translate(ca, cy, flip ? -cs : cs);
  // rotateY(−90°) sends +X to +Z and +Z to −X, hence the negated span centre.
  if (flip) g.rotateY(-Math.PI / 2);
  return g;
}

/** A box in the volume's local frame. */
function localBox(
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
): THREE.BufferGeometry | null {
  if (dx <= 1e-6 || dy <= 1e-6 || dz <= 1e-6) return null;
  const g = new THREE.BoxGeometry(dx, dy, dz);
  g.translate(cx, cy, cz);
  return g;
}

/** A vertical cylinder in the volume's local frame. Low segment counts, to
 *  match the flat-shaded low-poly language of components/story/Scene.tsx. */
function localCylinder(
  rTop: number,
  rBottom: number,
  height: number,
  cx: number,
  cy: number,
  cz: number,
  segments: number,
): THREE.BufferGeometry | null {
  if (height <= 1e-6 || rTop <= 1e-6) return null;
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, segments);
  g.translate(cx, cy, cz);
  return g;
}

/* ===========================================================================
   THE RETURNED SHAPE

   Plain data plus BufferGeometry. No React, no materials, no colours — the
   scene owns the look, this file owns the shape, and the `surface` tag is the
   entire contract between them.
   =========================================================================== */

export type Surface =
  /** opaque exterior shell, with the reveals of every opening cut into it */
  | "wall"
  /** floor deck and, on a two-storey volume, the intermediate plate */
  | "floor"
  /** roof planes and the parapet */
  | "roof"
  /** ridge cap — proud metal trim */
  | "trim"
  /** glazing: windows and the glazing wall */
  | "glass"
  /** door leaf */
  | "door"
  /** window/door frame lining the reveal, and glazing-wall mullions */
  | "frame"
  /** projecting window sill */
  | "sill"
  /** galvanized screw pile — never concrete */
  | "pile"
  /** deck boards and their beams */
  | "deck"
  /** wood-fired cedar hot tub */
  | "tub"
  /** the water in it */
  | "water";

export interface Part {
  /** stable and derived only from the spec — no counters, no randomness */
  id: string;
  surface: Surface;
  volumeId: string | null;
  /** set when the part belongs to a specific wall */
  wall?: Wall;
  /** set when the part belongs to a specific opening */
  openingId?: string;
  /** already in the owning group's LOCAL frame; apply no further transform */
  geometry: THREE.BufferGeometry;
}

export interface VolumeGeometry {
  id: string;
  name: string;
  /** world position of the volume's local origin: footprint centre, finished floor */
  origin: readonly [number, number, number];
  /** the single rotation the scene applies, radians about +Y */
  rotationY: number;
  wallThicknessFt: number;
  eaveHeightFt: number;
  /** spec.ts's figure — and, by construction, the built maximum */
  ridgeHeightFt: number;
  /** the pitch actually built; differs from `roof.pitchDeg` when a shed or
   *  saltbox is turned across the depth (see the header's named departures) */
  builtPitchDeg: number;
  roofThicknessFt: number;
  parts: Part[];
}

export interface DeckGeometry {
  /** the deck lives in the FIRST volume's frame, because that is the wall it
   *  is attached to; same origin, same yaw, so it can never drift off it */
  origin: readonly [number, number, number];
  rotationY: number;
  wall: Wall;
  parts: Part[];
}

export interface HomeGeometry {
  volumes: VolumeGeometry[];
  deck: DeckGeometry | null;
  summary: SiteSummary;
  /** everything the model could not build faithfully, in plain sentences */
  warnings: string[];
}

/* ===========================================================================
   OPENINGS
   =========================================================================== */

interface PlacedOpening {
  opening: Opening;
  /** the clipped hole, in wall (run, height) coordinates */
  poly: Poly2;
  /** the inner edge of the frame — the actual daylight */
  inner: Poly2;
  box: Aabb2;
}

/**
 * Fit the openings of one wall into that wall's outline.
 *
 * Three things can go wrong and all three are reported rather than papered
 * over, because `glazedAreaSqFt` in spec.ts counts what the user ASKED for
 * and the FDWR check downstream is only honest if the two agree:
 *   · an opening can fall outside the outline entirely (a window in the part
 *     of a gable end the roof has already taken);
 *   · it can be partly outside, in which case the glazed area really built is
 *     smaller than the spec's;
 *   · two openings can overlap, which no single triangulation can express —
 *     the later one is skipped and named.
 */
function placeOpenings(
  openings: readonly Opening[],
  outline: Poly2,
  volumeName: string,
  wall: Wall,
  warnings: string[],
): PlacedOpening[] {
  if (openings.length === 0) return [];
  const planes = halfPlanesOf(outline, OPENING_EDGE_CLEAR_FT);
  const placed: PlacedOpening[] = [];

  for (const o of openings) {
    const w = Math.max(0, o.widthFt);
    const h = Math.max(0, o.heightFt);
    if (w < 0.1 || h < 0.1) continue;
    const nominal = rectPoly(o.offsetFt, o.sillFt, o.offsetFt + w, o.sillFt + h);
    const poly = clipToHalfPlanes(ccw(nominal), planes);

    if (poly.length < 3 || polygonArea(poly) < 0.05) {
      warnings.push(
        `${volumeName}: opening ${o.id} on the ${wall} wall falls outside the wall and was not cut. Its ${(w * h).toFixed(0)} sq ft still counts toward glazedAreaSqFt.`,
      );
      continue;
    }

    const box = aabbOf(poly);
    const clash = placed.find((p) => aabbOverlap(p.box, box));
    if (clash) {
      warnings.push(
        `${volumeName}: opening ${o.id} overlaps ${clash.opening.id} on the ${wall} wall; only the first was cut.`,
      );
      continue;
    }

    const built = polygonArea(poly);
    const asked = w * h;
    if (built < asked * 0.99) {
      warnings.push(
        `${volumeName}: opening ${o.id} on the ${wall} wall was trimmed to fit — ${built.toFixed(1)} of ${asked.toFixed(1)} sq ft.`,
      );
    }

    const inner = insetConvex(poly, FRAME_WIDTH_FT);
    placed.push({ opening: o, poly, inner: inner.length >= 3 ? inner : [], box });
  }
  return placed;
}

/** Frame, glazing/leaf, sill and mullions for one opening. */
function openingParts(
  v: Volume,
  wall: Wall,
  f: WallFrame,
  p: PlacedOpening,
): Part[] {
  const t = f.thicknessFt;
  const M = f.matrix;
  const o = p.opening;
  const out: Part[] = [];
  const push = (surface: Surface, suffix: string, g: THREE.BufferGeometry | null) => {
    if (g) out.push({ id: `${v.id}:${wall}:${o.id}:${suffix}`, surface, volumeId: v.id, wall, openingId: o.id, geometry: g });
  };

  // The frame lines the whole reveal: outer edge = the hole in the wall,
  // inner edge = the daylight. Insetting a convex ring is exact, so the frame
  // follows a trimmed opening around a gable slope without special-casing it.
  if (p.inner.length >= 3) {
    push("frame", "frame", prism(p.poly, [p.inner], 0, t, M));
  } else {
    push("frame", "frame", prism(p.poly, [], 0, t, M));
    return out; // too small to glaze; a frame with no daylight is honest
  }

  const box = aabbOf(p.inner);

  if (o.kind === "door") {
    push("door", "leaf", prism(p.inner, [], Math.max(0, t - 0.28), DOOR_THICKNESS_FT, M));
    return out;
  }

  // Glass sits GLASS_SET_FRACTION of the wall thickness in from the outside,
  // which is what gives a thick wall its deep exterior reveal.
  const glassCentre = t * (1 - GLASS_SET_FRACTION);
  push("glass", "glass", prism(p.inner, [], glassCentre - GLASS_THICKNESS_FT / 2, GLASS_THICKNESS_FT, M));

  if (o.kind === "glazing-wall") {
    // A glazing wall reads as a glazed SCREEN. One 16 ft pane does not exist.
    const width = box.x1 - box.x0;
    const bays = Math.max(1, Math.round(width / MULLION_SPACING_FT));
    for (let i = 1; i < bays; i++) {
      const u = box.x0 + (width * i) / bays;
      push(
        "frame",
        `mullion${i}`,
        wallBox(
          MULLION_WIDTH_FT,
          box.y1 - box.y0,
          Math.min(t * 0.45, 0.35),
          u,
          (box.y0 + box.y1) / 2,
          glassCentre,
          M,
        ),
      );
    }
    return out;
  }

  // Windows get a sill; doors and glazing walls meet the floor instead.
  const sillOuter = t + SILL_PROJECT_FT;
  const sillInner = t * 0.35;
  push(
    "sill",
    "sill",
    wallBox(
      box.x1 - box.x0 + 2 * SILL_OVERHANG_FT,
      SILL_THICKNESS_FT,
      sillOuter - sillInner,
      (box.x0 + box.x1) / 2,
      box.y0 - SILL_THICKNESS_FT / 2,
      (sillInner + sillOuter) / 2,
      M,
    ),
  );
  return out;
}

/* ===========================================================================
   ONE VOLUME
   =========================================================================== */

/**
 * A whole field of screw piles as ONE geometry.
 *
 * Measured, not assumed: 39 separate `CylinderGeometry` constructions cost
 * about a third of the entire default build, and three.js `dispose()` is not
 * free either — so a field of identical cylinders that nothing will ever
 * click on is built once and memcopied per position. It is hand-rolled
 * instancing without the InstancedMesh, which keeps this module free of any
 * opinion about how the scene draws things.
 */
function pileField(
  spots: readonly Pt2[],
  topY: number,
  height: number,
  offsetX = 0,
  offsetZ = 0,
): THREE.BufferGeometry | null {
  if (spots.length === 0 || height <= 1e-6) return null;
  const proto = new THREE.CylinderGeometry(PILE_RADIUS_FT, PILE_RADIUS_FT * 1.15, height, 8);
  const flat = proto.toNonIndexed();
  proto.dispose();
  const src = flat.getAttribute("position").array as ArrayLike<number>;
  const srcN = flat.getAttribute("normal").array as ArrayLike<number>;
  const srcU = flat.getAttribute("uv").array as ArrayLike<number>;
  const n = flat.getAttribute("position").count;

  const P = new Float32Array(n * 3 * spots.length);
  const N = new Float32Array(n * 3 * spots.length);
  const U = new Float32Array(n * 2 * spots.length);
  const cy = topY - height / 2;
  for (let s = 0; s < spots.length; s++) {
    const px = spots[s][0] + offsetX;
    const pz = spots[s][1] + offsetZ;
    const o3 = s * n * 3;
    const o2 = s * n * 2;
    for (let i = 0; i < n; i++) {
      P[o3 + i * 3] = src[i * 3] + px;
      P[o3 + i * 3 + 1] = src[i * 3 + 1] + cy;
      P[o3 + i * 3 + 2] = src[i * 3 + 2] + pz;
      N[o3 + i * 3] = srcN[i * 3];
      N[o3 + i * 3 + 1] = srcN[i * 3 + 1];
      N[o3 + i * 3 + 2] = srcN[i * 3 + 2];
      U[o2 + i * 2] = srcU[i * 2];
      U[o2 + i * 2 + 1] = srcU[i * 2 + 1];
    }
  }
  flat.dispose();

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
  return g;
}

/** Screw-pile positions on a ~8 ft grid, coarsened until the count fits. */
function pileGrid(widthFt: number, depthFt: number, gridFt: number, maxPiles: number): Pt2[] {
  let spacing = gridFt;
  let nx = Math.max(2, Math.ceil(widthFt / spacing) + 1);
  let nz = Math.max(2, Math.ceil(depthFt / spacing) + 1);
  while (nx * nz > maxPiles && spacing < 200) {
    spacing *= 1.35;
    nx = Math.max(2, Math.ceil(widthFt / spacing) + 1);
    nz = Math.max(2, Math.ceil(depthFt / spacing) + 1);
  }
  const inset = 0.75;
  const usableW = Math.max(0, widthFt - 2 * inset);
  const usableD = Math.max(0, depthFt - 2 * inset);
  const out: Pt2[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      out.push([
        -usableW / 2 + (usableW * i) / (nx - 1),
        -usableD / 2 + (usableD * j) / (nz - 1),
      ]);
    }
  }
  return out;
}

/**
 * Build one volume: shell, roof, openings, floor and piles.
 *
 * Exported on its own so a single volume can be tested — and eyeballed — with
 * no site, no deck and no summary around it.
 */
export function buildVolume(
  v: Volume,
  material: EcoMaterial,
  warnings: string[] = [],
): VolumeGeometry {
  const t = wallThicknessFt(material);
  const roof = buildRoofModel(v, t, warnings);
  const parts: Part[] = [];
  const push = (surface: Surface, id: string, g: THREE.BufferGeometry | null, extra?: Partial<Part>) => {
    if (g) parts.push({ id: `${v.id}:${id}`, surface, volumeId: v.id, geometry: g, ...extra });
  };

  /* ---- floor deck, and the plate between storeys ---- */
  push("floor", "floor", localBox(v.widthFt, FLOOR_SLAB_FT, v.depthFt, 0, -FLOOR_SLAB_FT / 2, 0));
  if (v.storeys === 2) {
    /* THE PLATE THAT CAME OUT THROUGH THE ROOF.
       A second floor drawn as "footprint minus wall thickness" is right under
       a gable and wrong under an a-frame, where the shell narrows as it
       rises: at a shallow pitch the plate sat metres ABOVE the ridge and was
       the tallest thing on the building, which broke the ridge invariant this
       whole file is built on. components/story/Scene.tsx learned the same
       lesson three times (its `spanAt`), so the rule is copied rather than
       rediscovered: any horizontal element inside the shell takes its extent
       from the roof at its OWN TOP, because that is where the shell is
       tightest. If nothing survives that, there is no second storey here and
       the model says so instead of drawing one. */
    const plateThick = 0.6;
    const plateTop = v.wallHeightFt;
    const clear = 0.25;
    const halfFall = roof.fallAxis === "x" ? v.widthFt / 2 : v.depthFt / 2;
    const halfPerp = roof.fallAxis === "x" ? v.depthFt / 2 : v.widthFt / 2;
    const roofHalf =
      roof.slope > 1e-6 ? (roof.apexY - plateTop) / roof.slope : Number.POSITIVE_INFINITY;

    let fLo = roof.apexA - roofHalf + clear;
    let fHi = roof.apexA + roofHalf - clear;
    // The walls that bound the fall axis, where the form actually has them.
    if (roof.buildsWall(roof.fallAxis === "x" ? "e" : "n")) {
      fLo = Math.max(fLo, -halfFall + t);
      fHi = Math.min(fHi, halfFall - t);
    }
    const pLo = -halfPerp + t;
    const pHi = halfPerp - t;

    if (fHi - fLo > 1 && pHi - pLo > 1 && plateTop + plateThick < roof.builtRidgeY) {
      const alongX = roof.fallAxis === "x";
      push(
        "floor",
        "plate",
        localBox(
          alongX ? fHi - fLo : pHi - pLo,
          plateThick,
          alongX ? pHi - pLo : fHi - fLo,
          alongX ? (fLo + fHi) / 2 : 0,
          plateTop - plateThick / 2,
          alongX ? 0 : (fLo + fHi) / 2,
        ),
      );
    } else {
      warnings.push(
        `${v.name}: a second storey does not fit under this ${v.roof.form} roof at ${v.roof.pitchDeg}° — the upper floor plate was left out. totalFloorAreaSqFt still counts both storeys.`,
      );
    }
  }

  /* ---- screw piles. No concrete, ever — repo doctrine, not decoration.
         These are the VISUAL grid; the BOM's `screw_piles` line is the priced
         authority, and it is deliberately not re-derived here. ---- */
  const pileTop = -FLOOR_SLAB_FT;
  push(
    "pile",
    "piles",
    pileField(
      pileGrid(v.widthFt, v.depthFt, PILE_GRID_FT, MAX_PILES_PER_VOLUME),
      pileTop,
      pileTop - GRADE_Y_FT,
    ),
  );

  /* ---- the shell ---- */
  const openingsByWall: Record<Wall, Opening[]> = { n: [], s: [], e: [], w: [] };
  for (const o of v.openings) openingsByWall[o.wall].push(o);

  for (const wall of ["n", "s", "e", "w"] as const) {
    if (!roof.buildsWall(wall)) {
      if (openingsByWall[wall].length > 0) {
        warnings.push(
          `${v.name}: the ${wall} wall does not exist on an a-frame — the slope is the wall — so ${openingsByWall[wall].length} opening(s) placed on it were not built. Move them to the gable ends.`,
        );
      }
      continue;
    }

    const f = wallFrame(v, wall, t);
    const top = wallTopPoints(f, roof);
    const outline = ccw(
      dedupe([[0, 0], [f.runFt, 0], ...[...top].reverse()]),
    );
    if (outline.length < 3 || polygonArea(outline) < 0.5) continue; // nothing left to build

    const placed = placeOpenings(openingsByWall[wall], outline, v.name, wall, warnings);
    push("wall", `wall-${wall}`, prism(outline, placed.map((p) => p.poly), 0, t, f.matrix), { wall });
    for (const p of placed) parts.push(...openingParts(v, wall, f, p));
  }

  /* ---- the roof ---- */
  roof.slabs.forEach((s, i) => {
    push("roof", `roof${i}`, slopedSlab(roof.fallAxis, s, roof.thicknessFt));
  });

  if (roof.ridgeCap) {
    // Top face level with the apex, so the cap trims the ridge without ever
    // becoming the tallest thing on the building. The ridge invariant holds.
    const { a, halfSpan } = roof.ridgeCap;
    const cy = roof.apexY - RIDGE_CAP_HEIGHT_FT / 2;
    push(
      "trim",
      "ridge",
      roof.fallAxis === "x"
        ? localBox(RIDGE_CAP_WIDTH_FT, RIDGE_CAP_HEIGHT_FT, halfSpan * 2, a, cy, 0)
        : localBox(halfSpan * 2, RIDGE_CAP_HEIGHT_FT, RIDGE_CAP_WIDTH_FT, 0, cy, a),
    );
  }

  if (roof.parapet) {
    const { topY, halfA, halfS, lowY } = roof.parapet;
    const bottom = Math.min(lowY, roof.apexY) - 0.3;
    const height = Math.max(0.2, topY - bottom);
    const cy = bottom + height / 2;
    const halfX = roof.fallAxis === "x" ? halfA : halfS;
    const halfZ = roof.fallAxis === "x" ? halfS : halfA;
    const p = PARAPET_THICKNESS_FT;
    push("roof", "parapet-n", localBox(halfX * 2, height, p, 0, cy, -halfZ + p / 2));
    push("roof", "parapet-s", localBox(halfX * 2, height, p, 0, cy, halfZ - p / 2));
    push("roof", "parapet-e", localBox(p, height, Math.max(0, halfZ * 2 - 2 * p), halfX - p / 2, cy, 0));
    push("roof", "parapet-w", localBox(p, height, Math.max(0, halfZ * 2 - 2 * p), -halfX + p / 2, cy, 0));
  }

  return {
    id: v.id,
    name: v.name,
    origin: [v.x, 0, v.z],
    rotationY: yawFromBearingDeg(v.rotationDeg),
    wallThicknessFt: t,
    eaveHeightFt: roof.eaveY,
    ridgeHeightFt: ridgeHeightFt(v),
    builtPitchDeg: (roof.angleRad * 180) / Math.PI,
    roofThicknessFt: roof.thicknessFt,
    parts,
  };
}

/* ===========================================================================
   THE DECK, AND THE HOT TUB THE BRIEF PROMISES ON EVERY HOME
   =========================================================================== */

function buildDeck(deck: Deck, host: Volume, warnings: string[]): DeckGeometry | null {
  const width = Math.max(1, deck.widthFt);
  const depth = Math.max(1, deck.depthFt);
  const out = WALL_AXES[deck.wall].out;
  const runsAlongX = WALL_RUN_AXIS[deck.wall] === "x";
  // Distance from the volume centre to the OUTER face of the host wall.
  const face = runsAlongX ? host.depthFt / 2 : host.widthFt / 2;

  // Plan extents in the HOST's local frame: width along the wall, depth out.
  const dx = runsAlongX ? width : depth;
  const dz = runsAlongX ? depth : width;
  const cx = out.x * (face + depth / 2);
  const cz = out.z * (face + depth / 2);

  const top = -DECK_STEP_FT;
  const parts: Part[] = [];
  const push = (surface: Surface, id: string, g: THREE.BufferGeometry | null) => {
    if (g) parts.push({ id: `deck:${id}`, surface, volumeId: host.id, geometry: g });
  };

  push("deck", "boards", localBox(dx, DECK_SLAB_FT, dz, cx, top - DECK_SLAB_FT / 2, cz));
  push(
    "deck",
    "beams",
    localBox(
      Math.max(0.5, dx - 0.5),
      DECK_BEAM_FT,
      Math.max(0.5, dz - 0.5),
      cx,
      top - DECK_SLAB_FT - DECK_BEAM_FT / 2,
      cz,
    ),
  );

  const pileTop = top - DECK_SLAB_FT - DECK_BEAM_FT;
  push(
    "pile",
    "piles",
    pileField(
      pileGrid(dx, dz, DECK_PILE_GRID_FT, MAX_DECK_PILES),
      pileTop,
      pileTop - GRADE_Y_FT,
      cx,
      cz,
    ),
  );

  if (deck.hotTub) {
    const clear = HOT_TUB_RADIUS_FT + 0.6;
    if (width < 2 * clear || depth < 2 * clear) {
      warnings.push(
        `The hot tub needs about ${(2 * clear).toFixed(0)} ft each way; the ${width.toFixed(0)} × ${depth.toFixed(0)} ft deck was drawn with it centred and tight.`,
      );
    }
    // Outboard, and off to one side — deterministic, never sampled.
    const alongOffset = Math.max(0, width / 2 - clear);
    const outOffset = Math.max(0, depth / 2 - clear);
    const tx = cx + (runsAlongX ? alongOffset : out.x * outOffset);
    const tz = cz + (runsAlongX ? out.z * outOffset : alongOffset);
    push(
      "tub",
      "tub",
      localCylinder(
        HOT_TUB_RADIUS_FT,
        HOT_TUB_RADIUS_FT * 0.96,
        HOT_TUB_HEIGHT_FT,
        tx,
        top + HOT_TUB_HEIGHT_FT / 2,
        tz,
        16,
      ),
    );
    push(
      "water",
      "water",
      localCylinder(
        HOT_TUB_RADIUS_FT - 0.28,
        HOT_TUB_RADIUS_FT - 0.28,
        0.08,
        tx,
        top + HOT_TUB_HEIGHT_FT - 0.4,
        tz,
        16,
      ),
    );
  }

  return {
    origin: [host.x, 0, host.z],
    rotationY: yawFromBearingDeg(host.rotationDeg),
    wall: deck.wall,
    parts,
  };
}

/* ===========================================================================
   THE WHOLE HOME
   =========================================================================== */

/**
 * Turn a HomeSpec into renderable geometry.
 *
 * Deterministic and pure: the same spec always yields the same vertices. The
 * geometries are OWNED BY THE CALLER — call `disposeHome` before dropping a
 * result, or a rebuild loop leaks GPU buffers, which is the one real hazard
 * in a builder that rebuilds on every drag.
 */
export function buildHome(spec: HomeSpec): HomeGeometry {
  const warnings: string[] = [];
  const volumes = spec.volumes.map((v) => buildVolume(v, spec.material, warnings));

  const host = spec.volumes[0];
  let deck: DeckGeometry | null = null;
  if (spec.deck && host) {
    deck = buildDeck(spec.deck, host, warnings);
  } else if (spec.deck && !host) {
    warnings.push("A deck is specified but there are no volumes for it to attach to.");
  }

  const summary = summarizeHome(spec);
  for (const o of summary.overlaps) {
    warnings.push(
      `Volumes ${o.a} and ${o.b} overlap by ${o.areaSqFt.toFixed(0)} sq ft in plan. spec.ts sums footprints rather than unioning them, so groundFootprintSqFt over-reports coverage by that much.`,
    );
  }

  return { volumes, deck, summary, warnings };
}

/** Free every GPU buffer this result owns. Call it before you replace one. */
export function disposeHome(home: HomeGeometry | null | undefined): void {
  if (!home) return;
  for (const v of home.volumes) for (const p of v.parts) p.geometry.dispose();
  if (home.deck) for (const p of home.deck.parts) p.geometry.dispose();
}

/** Every part of a home, volumes and deck alike, in a single flat list. */
export function allParts(home: HomeGeometry): Part[] {
  const out: Part[] = [];
  for (const v of home.volumes) out.push(...v.parts);
  if (home.deck) out.push(...home.deck.parts);
  return out;
}

/* ===========================================================================
   OPTIONAL: MERGE BY SURFACE

   `buildHome` returns parts UNMERGED on purpose. A part carries its volume,
   its wall and its opening id, and that metadata is what lets the UI hover a
   window or select a wall — the difference between a builder and a picture.
   The default home is about 30 parts, which is not a draw-call problem.

   When a spec grows past the point where it is one, merge each group's parts
   into a single geometry per surface per group. Metadata is lost by
   definition, so this is opt-in rather than the default. Merged geometries
   are new allocations: dispose them with `disposeMerged`.
   =========================================================================== */

export interface MergedGroup {
  surface: Surface;
  geometry: THREE.BufferGeometry;
  /** the parts that went in, so a merge can still be traced back */
  partIds: string[];
}

const MERGE_ATTRS = ["position", "normal", "uv"] as const;
const MERGE_ITEM_SIZE: Record<(typeof MERGE_ATTRS)[number], number> = {
  position: 3,
  normal: 3,
  uv: 2,
};

export function mergeParts(parts: readonly Part[]): MergedGroup[] {
  /* A plain object rather than a Map, and an explicit order array rather than
     insertion order: the tsconfig targets ES5, where Map iteration needs
     downlevelIteration, and a stable order keeps the output deterministic. */
  const groups: Partial<Record<Surface, Part[]>> = {};
  const order: Surface[] = [];
  for (const p of parts) {
    const list = groups[p.surface];
    if (list) {
      list.push(p);
    } else {
      groups[p.surface] = [p];
      order.push(p.surface);
    }
  }

  const out: MergedGroup[] = [];
  for (const surface of order) {
    const list: Part[] = groups[surface] ?? [];
    // Everything is brought to non-indexed so concatenation is a memcpy and
    // no index base has to be rewritten.
    const flat = list.map((p) => {
      const g = p.geometry;
      return g.index ? { g: g.toNonIndexed(), temp: true } : { g, temp: false };
    });

    let count = 0;
    for (const { g } of flat) count += g.getAttribute("position")?.count ?? 0;
    if (count === 0) {
      for (const f of flat) if (f.temp) f.g.dispose();
      continue;
    }

    const merged = new THREE.BufferGeometry();
    for (const attr of MERGE_ATTRS) {
      const size = MERGE_ITEM_SIZE[attr];
      const data = new Float32Array(count * size);
      let at = 0;
      for (const { g } of flat) {
        const n = g.getAttribute("position")?.count ?? 0;
        const src = g.getAttribute(attr);
        if (src && src.count === n) {
          for (let i = 0; i < n * size; i++) data[at + i] = src.array[i] as number;
        }
        at += n * size;
      }
      merged.setAttribute(attr, new THREE.BufferAttribute(data, size));
    }
    for (const f of flat) if (f.temp) f.g.dispose();

    out.push({ surface, geometry: merged, partIds: list.map((p) => p.id) });
  }
  return out;
}

/** Free geometries produced by `mergeParts`. */
export function disposeMerged(groups: readonly MergedGroup[] | null | undefined): void {
  if (!groups) return;
  for (const g of groups) g.geometry.dispose();
}
