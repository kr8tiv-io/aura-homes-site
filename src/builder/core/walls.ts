/* ===========================================================================
   WALLS — the plan-editor's geometry. Pure functions, no React, no three.js
   objects, no clock, no randomness.

   WHAT THIS EXISTS FOR
   --------------------
   Until now a person composed rectangular VOLUMES with sliders. They could
   not push a single wall, and they could not say where an interior partition
   goes — the room packer in `lib/design/layout.ts` decided that for them. The
   founder's blueprint asks for "a 2D interface allowing users to move, draw,
   or delete walls and corners via mouse-driven interactions", and that is a
   real gap rather than a restatement of what is already here.

   This module is everything that gap needs which is not a pixel: the frame
   maths, snapping, hit-testing, wall offsetting, the partition model and the
   constraint solving that keeps an edit inside a spec the rest of the system
   will still accept. `components/builder/Plan2D.tsx` draws it and nothing
   else.

   THE PRIMITIVE STAYS RECTANGULAR — AND THAT IS THE WHOLE DESIGN
   -------------------------------------------------------------
   `spec.ts` says why, in its own words: "Keeping the primitive rectangular is
   what keeps the plan engine able to solve it — an arbitrary polygon footprint
   would look freer and would quietly break the handoff to production."

   That comment was read before a line of this was written, and it was
   believed. So a corner drag here is not a free vertex move: it is a resize of
   TWO faces at once with the opposite corner pinned, which is exactly what a
   resize handle does everywhere else and which leaves the footprint a
   rectangle. A wall drag moves ONE face. Neither can produce an L out of a
   single volume — an L is two volumes, which the spec already expresses and
   the drawings already handle.

   The one genuinely new concept is the INTERIOR PARTITION, and it is
   deliberately not a polygon either: it is axis-aligned in the volume's own
   frame, because a partition at 23 degrees would have to become a room, and a
   non-rectangular room is precisely what the floor-plan sheet and the room
   solver cannot draw or fill today. Offering an angled partition would be
   offering a dead end with a pretty gesture on it.

   WHERE PARTITIONS LIVE, AND THE HONEST PART
   ------------------------------------------
   `Partition` is declared HERE, not in `spec.ts`, because that file was not
   to be edited. That has a consequence worth stating plainly rather than
   discovering later: `validateHomeSpec` in `lib/builder/share.ts` rebuilds a
   fresh spec from validated primitives ONLY, so an extra `partitions` key
   hung on a HomeSpec would be silently dropped by every share link and every
   JSON import. Partitions therefore travel as their own value, with their own
   codec below (`encodePartitions` / `decodePartitions`), until `spec.ts` and
   `share.ts` gain the field. The exact addition those two files need is
   written out in this agent's report.

   FRAME — copied from `geometry.ts`, never re-derived
   --------------------------------------------------
   · World plan is (x, z) in FEET. +x is east, +z is south, so north is −z.
   · `Volume.rotationDeg` is clockwise from north; the three.js yaw is its
     negation (`yawFromBearingDeg`), and that sign lives in geometry.ts alone.
   · A volume's local frame is centred on (v.x, v.z). Local +x runs to world
     (cos yaw, −sin yaw); local +z runs to world (sin yaw, cos yaw).
   · Local corner order matches `rectCornersPlan`: 0=(−hw,−hd) 1=(+hw,−hd)
     2=(+hw,+hd) 3=(−hw,+hd).
   · Wall n is the local −z face, s the +z face, e the +x face, w the −x face.
   · An opening's `offsetFt` is measured from the wall's LEFT end looking at it
     from outside, which is the run direction in `geometry.ts`'s `WALL_AXES`:
     n runs −x, s runs +x, e runs −z, w runs +z. The e and w walls butt into
     the n and s walls, so their run is `depthFt − 2·thickness` — that is
     `wallRunFt`, and it is imported rather than restated.

   DETERMINISM. No `Math.random`, no `Date.now`. Ids are derived from the ids
   already present, the same rule `edits.ts` follows, so the same sequence of
   drags produces the same file and the same export.
   =========================================================================== */

import { LIMITS, clamp, patchVolume, snap as quantise } from "../ui/edits";
import {
  MM_PER_FT,
  wallRunFt,
  wallThicknessFt,
  yawFromBearingDeg,
} from "./geometry";
import { PARTITION_MM } from "./materials";
import type { HomeSpec, Opening, Volume, Wall } from "./spec";

/* ===========================================================================
   1. VECTORS AND FRAMES
   =========================================================================== */

/** A point or a delta in the plan, feet. `z` is the SOUTHWARD axis, matching
 *  `geometry.ts` — not a screen y, which is a different thing computed in
 *  section 3 and never confused with this one. */
export interface Vec2 {
  x: number;
  z: number;
}

/** Kill float noise at a thousandth of a foot — a hundredth of an inch, below
 *  anything this system draws, and the same quantum `edits.ts` settles on. */
export const q = (v: number): number => Math.round(v * 1e3) / 1e3;

/** The volume's rotation as the pair of cosines the transforms need. */
export interface Basis {
  cx: number;
  cz: number;
  c: number;
  s: number;
}

export function basisOf(v: Volume): Basis {
  const yaw = yawFromBearingDeg(v.rotationDeg);
  return { cx: v.x, cz: v.z, c: Math.cos(yaw), s: Math.sin(yaw) };
}

/** Volume-local feet → world feet. Identical to the mapping inside
 *  `rectCornersPlan`, which is why a corner computed here lands exactly where
 *  the 3D model and the drawings put it. */
export function toWorld(v: Volume, local: Vec2): Vec2 {
  const b = basisOf(v);
  return {
    x: b.cx + local.x * b.c + local.z * b.s,
    z: b.cz - local.x * b.s + local.z * b.c,
  };
}

/** World feet → volume-local feet. The inverse of the above; the rotation is
 *  orthonormal so the inverse is the transpose and no division is involved. */
export function toLocal(v: Volume, world: Vec2): Vec2 {
  const b = basisOf(v);
  const dx = world.x - b.cx;
  const dz = world.z - b.cz;
  return { x: dx * b.c - dz * b.s, z: dx * b.s + dz * b.c };
}

/** A world DIRECTION into the volume's frame — no translation. Used to turn a
 *  pointer delta into a face movement. */
export function dirToLocal(v: Volume, world: Vec2): Vec2 {
  const b = basisOf(v);
  return { x: world.x * b.c - world.z * b.s, z: world.x * b.s + world.z * b.c };
}

/* ---------------------------------------------------------- wall identity */

/** Which local axis a wall's outer FACE sits on (n/s are z faces, e/w are x
 *  faces). The wall RUNS along the other one. */
export function faceAxisOf(wall: Wall): "x" | "z" {
  return wall === "e" || wall === "w" ? "x" : "z";
}

/** Sign of the wall's face on its axis: n is −z, s is +z, e is +x, w is −x. */
export function faceSignOf(wall: Wall): -1 | 1 {
  return wall === "s" || wall === "e" ? 1 : -1;
}

export const WALLS_CW: readonly Wall[] = ["n", "e", "s", "w"];

/** The two walls that meet at each corner, in `rectCornersPlan` order. */
export const CORNER_WALLS: readonly (readonly [Wall, Wall])[] = [
  ["w", "n"],
  ["e", "n"],
  ["e", "s"],
  ["w", "s"],
];

/** Half-extent of the volume on a local axis. */
export function halfOn(v: Volume, axis: "x" | "z"): number {
  return (axis === "x" ? v.widthFt : v.depthFt) / 2;
}

/** Local coordinate of a wall's OUTER face, on its face axis. */
export function wallFaceLocal(v: Volume, wall: Wall): number {
  return faceSignOf(wall) * halfOn(v, faceAxisOf(wall));
}

export function cornerLocal(v: Volume, index: number): Vec2 {
  const hw = v.widthFt / 2;
  const hd = v.depthFt / 2;
  const table: readonly Vec2[] = [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ];
  return table[((index % 4) + 4) % 4];
}

export function cornerWorld(v: Volume, index: number): Vec2 {
  return toWorld(v, cornerLocal(v, index));
}

export function volumeCornersWorld(v: Volume): Vec2[] {
  return [0, 1, 2, 3].map((i) => cornerWorld(v, i));
}

/**
 * A wall as a segment in the volume's own frame, with `a` at offset 0.
 *
 * `a` is the LEFT end looking at the wall from outside — the end
 * `Opening.offsetFt` counts from. The e and w walls start one structural
 * thickness in from the corner, because they butt into the n and s walls;
 * that inset is what makes `runFt` agree with `wallRunFt` instead of with
 * `depthFt`, and it is why an opening dragged to the far end of an east wall
 * stops short of the corner rather than hanging in the air.
 */
export function wallSegmentLocal(
  v: Volume,
  wall: Wall,
  structThicknessFt: number,
): { a: Vec2; b: Vec2; runFt: number; dir: Vec2 } {
  const face = wallFaceLocal(v, wall);
  const runFt = wallRunFt(v, wall, structThicknessFt);
  switch (wall) {
    case "n": {
      // runs toward −x, full width, starting at the +x end
      const start = { x: v.widthFt / 2, z: face };
      return { a: start, b: { x: start.x - runFt, z: face }, runFt, dir: { x: -1, z: 0 } };
    }
    case "s": {
      // runs toward +x, full width, starting at the −x end
      const start = { x: -v.widthFt / 2, z: face };
      return { a: start, b: { x: start.x + runFt, z: face }, runFt, dir: { x: 1, z: 0 } };
    }
    case "e": {
      // runs toward −z, inset one thickness at each end
      const start = { x: face, z: v.depthFt / 2 - structThicknessFt };
      return { a: start, b: { x: face, z: start.z - runFt }, runFt, dir: { x: 0, z: -1 } };
    }
    default: {
      // "w" — runs toward +z, inset one thickness at each end
      const start = { x: face, z: -v.depthFt / 2 + structThicknessFt };
      return { a: start, b: { x: face, z: start.z + runFt }, runFt, dir: { x: 0, z: 1 } };
    }
  }
}

export function wallSegmentWorld(
  v: Volume,
  wall: Wall,
  structThicknessFt: number,
): { a: Vec2; b: Vec2; runFt: number } {
  const seg = wallSegmentLocal(v, wall, structThicknessFt);
  return { a: toWorld(v, seg.a), b: toWorld(v, seg.b), runFt: seg.runFt };
}

/** A point `tFt` along a wall's run, in the volume's frame. */
export function pointOnWallLocal(
  v: Volume,
  wall: Wall,
  structThicknessFt: number,
  tFt: number,
): Vec2 {
  const seg = wallSegmentLocal(v, wall, structThicknessFt);
  return { x: seg.a.x + seg.dir.x * tFt, z: seg.a.z + seg.dir.z * tFt };
}

/** How far along a wall's run a world point falls, feet from the offset-0 end.
 *  Unclamped on purpose — the caller decides whether running off the end is an
 *  error or a value to clamp. */
export function tAlongWall(
  v: Volume,
  wall: Wall,
  structThicknessFt: number,
  world: Vec2,
): number {
  const seg = wallSegmentLocal(v, wall, structThicknessFt);
  const p = toLocal(v, world);
  return (p.x - seg.a.x) * seg.dir.x + (p.z - seg.a.z) * seg.dir.z;
}

/** The built run of a wall, feet — forwarded from geometry so there is one
 *  definition of a wall's length in the system. */
export function wallRunOf(spec: HomeSpec, v: Volume, wall: Wall): number {
  return wallRunFt(v, wall, wallThicknessFt(spec.material));
}

export function structThicknessOf(spec: HomeSpec): number {
  return wallThicknessFt(spec.material);
}

/* ===========================================================================
   2. PARTITIONS — the new first-class thing
   =========================================================================== */

/** 90 mm, non-structural, the same everywhere — `lib/design/materials.ts` is
 *  the source, and `drawings/model.ts` reads the same constant, so a partition
 *  drawn here is the thickness the schedule prints. */
export const PARTITION_THICKNESS_FT = PARTITION_MM / MM_PER_FT;

/** Below this a partition is a nub rather than a wall. Also the smallest span
 *  a drag is allowed to leave behind, so a resize never quietly deletes one. */
export const MIN_PARTITION_FT = 2;

/** A doorway wide enough to be a doorway. NBC wants 810 mm clear for a
 *  barrier-free door; 2'-8" is the common residential leaf. Neither is checked
 *  here — this is only the floor a drag may not go below. */
export const MIN_DOOR_FT = 2;

export interface PartitionDoor {
  /** centre of the opening, in the same local coordinate as `fromFt`/`toFt` */
  atFt: number;
  widthFt: number;
}

/**
 * One interior partition, in its VOLUME's local frame.
 *
 * Local rather than world so it rotates and translates with its volume for
 * free — drag the mass across the site and the rooms go with it, which is the
 * only behaviour anybody would accept.
 *
 * `axis` is the axis the partition RUNS along. `atFt` is its position on the
 * other axis. `fromFt`/`toFt` are its ends on the run axis, always ordered.
 * All four are volume-local feet measured from the volume's centre, so they
 * are the same numbers `cornerLocal` returns and can be compared directly.
 */
export interface Partition {
  id: string;
  volumeId: string;
  axis: "x" | "z";
  atFt: number;
  fromFt: number;
  toFt: number;
  thicknessFt: number;
  door: PartitionDoor | null;
}

/** The next free `p<n>`, derived from the ids in use. Deterministic: the same
 *  sequence of draws always produces the same ids. */
export function nextPartitionId(taken: readonly string[]): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`p${n}`)) n += 1;
  return `p${n}`;
}

export function partitionsOf(list: readonly Partition[], volumeId: string): Partition[] {
  return list.filter((p) => p.volumeId === volumeId);
}

/** The rectangle a partition may live in: the volume's inside face to inside
 *  face, on both axes. */
export function interiorBoundsLocal(
  v: Volume,
  structThicknessFt: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const hw = Math.max(0, v.widthFt / 2 - structThicknessFt);
  const hd = Math.max(0, v.depthFt / 2 - structThicknessFt);
  return { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd };
}

export function partitionSegmentLocal(p: Partition): { a: Vec2; b: Vec2 } {
  return p.axis === "x"
    ? { a: { x: p.fromFt, z: p.atFt }, b: { x: p.toFt, z: p.atFt } }
    : { a: { x: p.atFt, z: p.fromFt }, b: { x: p.atFt, z: p.toFt } };
}

export function partitionSegmentWorld(v: Volume, p: Partition): { a: Vec2; b: Vec2 } {
  const seg = partitionSegmentLocal(p);
  return { a: toWorld(v, seg.a), b: toWorld(v, seg.b) };
}

export const partitionLengthFt = (p: Partition): number => Math.abs(p.toFt - p.fromFt);

/** A point at `tFt` measured from `fromFt` along the run. */
export function pointOnPartitionLocal(p: Partition, tFt: number): Vec2 {
  const along = p.fromFt + tFt;
  return p.axis === "x" ? { x: along, z: p.atFt } : { x: p.atFt, z: along };
}

/** The four corners of the partition's own footprint, local — what gets drawn
 *  as a band rather than a hairline, because 90 mm is a real dimension and a
 *  plan that hides it is lying about the room size. */
export function partitionQuadLocal(p: Partition): [Vec2, Vec2, Vec2, Vec2] {
  const h = p.thicknessFt / 2;
  return p.axis === "x"
    ? [
        { x: p.fromFt, z: p.atFt - h },
        { x: p.toFt, z: p.atFt - h },
        { x: p.toFt, z: p.atFt + h },
        { x: p.fromFt, z: p.atFt + h },
      ]
    : [
        { x: p.atFt - h, z: p.fromFt },
        { x: p.atFt - h, z: p.toFt },
        { x: p.atFt + h, z: p.toFt },
        { x: p.atFt + h, z: p.fromFt },
      ];
}

/**
 * Turn two dragged local points into a partition, or refuse.
 *
 * The axis is whichever the drag is longer on — so a person drags roughly
 * across the room and gets a wall square to the one they were looking at,
 * which is the gesture people actually make. An angled result is not offered;
 * the header says why.
 *
 * Returns null when the drag was too short to mean anything, so a stray click
 * cannot leave a two-inch wall behind for somebody to find later.
 */
export function partitionFromDrag(
  v: Volume,
  volumeId: string,
  aLocal: Vec2,
  bLocal: Vec2,
  structThicknessFt: number,
  thicknessFt: number = PARTITION_THICKNESS_FT,
): Omit<Partition, "id"> | null {
  const dx = Math.abs(bLocal.x - aLocal.x);
  const dz = Math.abs(bLocal.z - aLocal.z);
  const axis: "x" | "z" = dx >= dz ? "x" : "z";
  const runA = axis === "x" ? aLocal.x : aLocal.z;
  const runB = axis === "x" ? bLocal.x : bLocal.z;
  // The position is taken from where the drag STARTED, not the average: the
  // first point is the one somebody aimed, the second is where they let go.
  const at = axis === "x" ? aLocal.z : aLocal.x;
  if (Math.abs(runB - runA) < MIN_PARTITION_FT) return null;

  const draft: Partition = {
    id: "",
    volumeId,
    axis,
    atFt: q(at),
    fromFt: q(Math.min(runA, runB)),
    toFt: q(Math.max(runA, runB)),
    thicknessFt: q(thicknessFt),
    door: null,
  };
  const fitted = fitPartition(v, draft, structThicknessFt);
  return fitted === null
    ? null
    : {
        volumeId: fitted.volumeId,
        axis: fitted.axis,
        atFt: fitted.atFt,
        fromFt: fitted.fromFt,
        toFt: fitted.toFt,
        thicknessFt: fitted.thicknessFt,
        door: fitted.door,
      };
}

/**
 * Pull one partition back inside its volume, or return null if the volume has
 * no room left for it.
 *
 * Null is a decision to be handled, never a silent delete: `clampPartitions`
 * keeps such a partition at the smallest legal size and reports it, so a
 * volume shrunk by accident and grown back leaves the plan where it was.
 */
export function fitPartition(
  v: Volume,
  p: Partition,
  structThicknessFt: number,
): Partition | null {
  const b = interiorBoundsLocal(v, structThicknessFt);
  const runMin = p.axis === "x" ? b.minX : b.minZ;
  const runMax = p.axis === "x" ? b.maxX : b.maxZ;
  const atMin = p.axis === "x" ? b.minZ : b.minX;
  const atMax = p.axis === "x" ? b.maxZ : b.maxX;
  if (runMax - runMin <= 0 || atMax - atMin <= 0) return null;

  const atFt = q(clamp(p.atFt, atMin, atMax));
  let fromFt = clamp(Math.min(p.fromFt, p.toFt), runMin, runMax);
  let toFt = clamp(Math.max(p.fromFt, p.toFt), runMin, runMax);

  // Preserve the length where the interior allows it, rather than letting a
  // clamp eat one end: slide the pair, then shorten only if it truly cannot fit.
  const want = Math.min(Math.max(toFt - fromFt, MIN_PARTITION_FT), runMax - runMin);
  if (toFt - fromFt < want) {
    if (fromFt + want <= runMax) toFt = fromFt + want;
    else {
      toFt = runMax;
      fromFt = runMax - want;
    }
  }
  if (toFt - fromFt < MIN_PARTITION_FT && runMax - runMin < MIN_PARTITION_FT) return null;

  const out: Partition = {
    ...p,
    atFt,
    fromFt: q(fromFt),
    toFt: q(toFt),
    door: null,
  };
  out.door = p.door ? fitDoor(out, p.door) : null;
  return out;
}

/** Keep a doorway inside the partition it is cut into, with a stub of wall at
 *  each end so a door leaf has something to hang on. */
export function fitDoor(p: Partition, door: PartitionDoor): PartitionDoor | null {
  const stub = 0.25;
  const span = partitionLengthFt(p);
  const widthFt = Math.min(Math.max(door.widthFt, MIN_DOOR_FT), Math.max(0, span - 2 * stub));
  if (widthFt < MIN_DOOR_FT) return null;
  const lo = p.fromFt + stub + widthFt / 2;
  const hi = p.toFt - stub - widthFt / 2;
  return { atFt: q(clamp(door.atFt, Math.min(lo, hi), Math.max(lo, hi))), widthFt: q(widthFt) };
}

/** Every partition of one volume, refitted after that volume changed shape.
 *  `adjusted` names the ones that had to move so the UI can say so out loud. */
export function clampPartitions(
  v: Volume,
  list: readonly Partition[],
  structThicknessFt: number,
): { partitions: Partition[]; adjusted: string[] } {
  const adjusted: string[] = [];
  const partitions = list.map((p) => {
    if (p.volumeId !== v.id) return p;
    const fitted = fitPartition(v, p, structThicknessFt);
    if (fitted === null) {
      adjusted.push(p.id);
      return p; // kept, not destroyed — see `fitPartition`
    }
    if (
      fitted.atFt !== p.atFt ||
      fitted.fromFt !== p.fromFt ||
      fitted.toFt !== p.toFt ||
      (fitted.door?.atFt ?? null) !== (p.door?.atFt ?? null) ||
      (fitted.door?.widthFt ?? null) !== (p.door?.widthFt ?? null)
    ) {
      adjusted.push(p.id);
    }
    return fitted;
  });
  return { partitions, adjusted };
}

/** Drop partitions whose volume no longer exists. Returns what was dropped so
 *  the caller can mention it rather than a room silently vanishing. */
export function pruneOrphanPartitions(
  spec: HomeSpec,
  list: readonly Partition[],
): { partitions: Partition[]; dropped: Partition[] } {
  const live = new Set(spec.volumes.map((v) => v.id));
  const partitions: Partition[] = [];
  const dropped: Partition[] = [];
  for (const p of list) (live.has(p.volumeId) ? partitions : dropped).push(p);
  return { partitions, dropped };
}

/* ---------------------------------------------------- partition mutations */

export function addPartition(
  list: readonly Partition[],
  draft: Omit<Partition, "id">,
): { partitions: Partition[]; id: string } {
  const id = nextPartitionId(list.map((p) => p.id));
  return { partitions: [...list, { ...draft, id }], id };
}

export function removePartition(list: readonly Partition[], id: string): Partition[] {
  return list.filter((p) => p.id !== id);
}

export function patchPartition(
  list: readonly Partition[],
  id: string,
  patch: Partial<Partition>,
): Partition[] {
  return list.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

/** Slide a whole partition sideways to a new position on its across axis. */
export function movePartitionTo(
  v: Volume,
  list: readonly Partition[],
  id: string,
  atFt: number,
  structThicknessFt: number,
): Partition[] {
  return list.map((p) => {
    if (p.id !== id) return p;
    return fitPartition(v, { ...p, atFt: q(atFt) }, structThicknessFt) ?? p;
  });
}

/** Drag one END of a partition along its run. The other end is pinned, and the
 *  minimum length is enforced by pushing the dragged end back, never by
 *  dragging the pinned one — a resize must not move the end you are holding
 *  still. */
export function dragPartitionEnd(
  v: Volume,
  list: readonly Partition[],
  id: string,
  end: 0 | 1,
  runFt: number,
  structThicknessFt: number,
): Partition[] {
  return list.map((p) => {
    if (p.id !== id) return p;
    const pinned = end === 0 ? p.toFt : p.fromFt;
    const sign = end === 0 ? -1 : 1; // which side of the pin the moving end is on
    const moved = pinned + sign * Math.max(MIN_PARTITION_FT, sign * (runFt - pinned));
    const next: Partition = {
      ...p,
      fromFt: q(Math.min(pinned, moved)),
      toFt: q(Math.max(pinned, moved)),
    };
    return fitPartition(v, next, structThicknessFt) ?? p;
  });
}

export function setPartitionDoor(
  list: readonly Partition[],
  id: string,
  door: PartitionDoor | null,
): Partition[] {
  return list.map((p) => (p.id === id ? { ...p, door: door ? fitDoor(p, door) : null } : p));
}

/* ===========================================================================
   3. THE VIEW — world feet to screen pixels and back

   Pixels, not a viewBox in feet. A viewBox would make the browser choose the
   letterboxing and then every hit tolerance would have to be reverse-engineered
   out of `getScreenCTM`. Holding the transform here means one pixel of
   tolerance is exactly one pixel at any zoom, stroke widths stay crisp instead
   of scaling with the model, and the same numbers that draw the plan are the
   numbers that hit-test it.
   =========================================================================== */

export interface View {
  /** pixels per foot */
  scale: number;
  /** the world point that lands at pixel (0, 0) */
  originX: number;
  originZ: number;
  widthPx: number;
  heightPx: number;
}

export interface Px {
  x: number;
  y: number;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** North is up: screen y increases with world z (south), which is what a site
 *  plan does and what `deckCornersPlan` and the drawings already assume. */
export function toPx(view: View, p: Vec2): Px {
  return { x: (p.x - view.originX) * view.scale, y: (p.z - view.originZ) * view.scale };
}

export function toWorldPt(view: View, px: Px): Vec2 {
  return { x: px.x / view.scale + view.originX, z: px.y / view.scale + view.originZ };
}

export const ftPerPx = (view: View): number => (view.scale > 0 ? 1 / view.scale : 0);

/** Everything the plan should be able to see, plus a margin so a home is not
 *  drawn hard against the frame. Never returns a degenerate box — an empty
 *  site still needs a grid to draw a first volume onto. */
export function contentBounds(spec: HomeSpec, padFt = 8): WorldBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of spec.volumes) {
    for (const c of volumeCornersWorld(v)) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.z < minZ) minZ = c.z;
      if (c.z > maxZ) maxZ = c.z;
    }
  }
  if (!Number.isFinite(minX)) return { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
  return { minX: minX - padFt, maxX: maxX + padFt, minZ: minZ - padFt, maxZ: maxZ + padFt };
}

/**
 * The view that fits `bounds` into a box of pixels, then honours the user's
 * zoom and pan on top.
 *
 * Zoom is about the CENTRE of the fitted view rather than about the world
 * origin, so zooming does not send the house off the edge — the commonest
 * annoyance in hand-rolled plan viewers and a two-line fix here.
 */
export function makeView(
  bounds: WorldBounds,
  widthPx: number,
  heightPx: number,
  zoom = 1,
  panPx: Px = { x: 0, y: 0 },
): View {
  const w = Math.max(1e-6, bounds.maxX - bounds.minX);
  const d = Math.max(1e-6, bounds.maxZ - bounds.minZ);
  const fit = Math.min(widthPx / w, heightPx / d);
  const scale = Math.max(1e-6, fit * Math.max(0.05, zoom));
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midZ = (bounds.minZ + bounds.maxZ) / 2;
  return {
    scale,
    originX: midX - (widthPx / 2 + panPx.x) / scale,
    originZ: midZ - (heightPx / 2 + panPx.y) / scale,
    widthPx,
    heightPx,
  };
}

/** The world rectangle currently on screen — what the grid is drawn across, so
 *  the grid costs the visible lines and not the site's. */
export function viewWorldBounds(view: View): WorldBounds {
  const a = toWorldPt(view, { x: 0, y: 0 });
  const b = toWorldPt(view, { x: view.widthPx, y: view.heightPx });
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
  };
}

/** Grid line positions on one axis, inclusive of the edges. Returns an empty
 *  array when the spacing would be finer than `minPx`, which is how the grid
 *  thins out on zoom-out instead of turning into a grey wash. */
export function gridLines(
  from: number,
  to: number,
  stepFt: number,
  scale: number,
  minPx = 6,
): number[] {
  if (stepFt <= 0 || stepFt * scale < minPx) return [];
  const first = Math.ceil(from / stepFt) * stepFt;
  const out: number[] = [];
  for (let v = first; v <= to; v += stepFt) out.push(q(v));
  return out;
}

/* ===========================================================================
   4. SNAPPING

   Three kinds, and they are ranked, because an unranked snap is a coin toss
   the user has to fight:

   1. ALIGNMENT beats everything. Lining a face up with a neighbour's corner is
      a stated intention; landing on a grid line is a default.
   2. GRID next.
   3. Otherwise free, quantised to a thousandth of a foot.

   Tolerance is given in FEET by the caller — pixels divided by scale — so the
   snap feels the same at every zoom instead of grabbing half the site when you
   zoom out.
   =========================================================================== */

export interface SnapSettings {
  /** 0 turns the grid off entirely */
  gridFt: number;
  /** snap to other volumes' corners and faces */
  align: boolean;
  /** the radius of the snap, in screen pixels */
  tolPx: number;
}

export const DEFAULT_SNAP: SnapSettings = { gridFt: 0.5, align: true, tolPx: 10 };

/** Grid steps worth offering. Feet, because the model is in feet: 3 inches is
 *  the finest anybody dimensions a wall to on a study drawing. */
export const GRID_STEPS: readonly { ft: number; label: string }[] = [
  { ft: 0, label: "Off" },
  { ft: 0.25, label: '3"' },
  { ft: 0.5, label: '6"' },
  { ft: 1, label: "1 ft" },
  { ft: 2, label: "2 ft" },
];

export type SnapKind = "free" | "grid" | "align";

export interface Snapped {
  value: number;
  kind: SnapKind;
  /** the candidate that won, when `kind` is "align" — drawn as a guide */
  guide: number | null;
}

export function snapScalar(
  raw: number,
  candidates: readonly number[],
  tolFt: number,
  settings: SnapSettings,
): Snapped {
  if (settings.align && candidates.length > 0) {
    let best: number | null = null;
    let bestD = tolFt;
    for (const c of candidates) {
      const d = Math.abs(c - raw);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best !== null) return { value: q(best), kind: "align", guide: q(best) };
  }
  /* The grid is a QUANTISER, not a magnet: with it on, every value lands on a
     line. A magnet — snap only when within tolerance — leaves a band of
     unsnapped values between the lines, and the dimension you get out is then
     a function of how fast you were moving the mouse, which is not a
     dimension anybody can build to. `tolFt` is deliberately unused here; it
     governs the alignment pass above, where a near-miss is meaningful. */
  if (settings.gridFt > 0) return { value: q(quantise(raw, settings.gridFt)), kind: "grid", guide: null };
  return { value: q(raw), kind: "free", guide: null };
}

export interface SnappedPoint {
  p: Vec2;
  x: Snapped;
  z: Snapped;
}

export function snapPoint(
  raw: Vec2,
  xCandidates: readonly number[],
  zCandidates: readonly number[],
  tolFt: number,
  settings: SnapSettings,
): SnappedPoint {
  const x = snapScalar(raw.x, xCandidates, tolFt, settings);
  const z = snapScalar(raw.z, zCandidates, tolFt, settings);
  return { p: { x: x.value, z: z.value }, x, z };
}

/**
 * Snap a whole MOVE rather than a point.
 *
 * Dragging a volume, the thing that should line up is one of its four corners
 * against a neighbour's — not its centre, which nobody can see. So every
 * corner is tested against every candidate and the smallest correction wins;
 * the grid then applies to the CENTRE, because `Volume.x`/`z` are what the
 * spec stores and a centre on a half-foot keeps the numbers in the panel
 * readable.
 */
export function snapMove(
  points: readonly Vec2[],
  proposed: Vec2,
  xCandidates: readonly number[],
  zCandidates: readonly number[],
  tolFt: number,
  settings: SnapSettings,
): { delta: Vec2; guideX: number | null; guideZ: number | null } {
  const pick = (values: number[], candidates: readonly number[]) => {
    let bestD = tolFt;
    let delta = 0;
    let guide: number | null = null;
    for (const v of values) {
      for (const c of candidates) {
        const d = Math.abs(c - v);
        if (d <= bestD) {
          bestD = d;
          delta = c - v;
          guide = c;
        }
      }
    }
    return { delta, guide };
  };

  if (settings.align) {
    const ax = pick(
      points.map((p) => p.x),
      xCandidates,
    );
    const az = pick(
      points.map((p) => p.z),
      zCandidates,
    );
    if (ax.guide !== null || az.guide !== null) {
      return {
        delta: { x: q(ax.delta), z: q(az.delta) },
        guideX: ax.guide === null ? null : q(ax.guide),
        guideZ: az.guide === null ? null : q(az.guide),
      };
    }
  }
  if (settings.gridFt > 0) {
    return {
      delta: {
        x: q(quantise(proposed.x, settings.gridFt) - proposed.x),
        z: q(quantise(proposed.z, settings.gridFt) - proposed.z),
      },
      guideX: null,
      guideZ: null,
    };
  }
  return { delta: { x: 0, z: 0 }, guideX: null, guideZ: null };
}

/* ------------------------------------------------------------- candidates */

/** World x and z values worth lining up with: every corner of every OTHER
 *  volume. Corners rather than centres, because a corner is a thing you can
 *  see on the plan and a centre is not. */
export function worldAlignCandidates(
  spec: HomeSpec,
  exceptVolumeId: string | null,
): { xs: number[]; zs: number[]; corners: Vec2[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  const corners: Vec2[] = [];
  for (const v of spec.volumes) {
    if (v.id === exceptVolumeId) continue;
    for (const c of volumeCornersWorld(v)) {
      corners.push(c);
      xs.push(q(c.x));
      zs.push(q(c.z));
    }
  }
  return { xs, zs, corners };
}

/**
 * The same idea in ONE volume's frame, for a face or corner drag.
 *
 * Every other volume's corners are projected into this volume's local axes.
 * For a neighbour at the same rotation that is exactly "flush with that wall";
 * for a neighbour at some other angle it is "in line with that corner", which
 * is still a real alignment and still worth offering — a face plane through a
 * neighbour's corner is a thing an architect draws on purpose.
 *
 * The volume's own partitions are included, because pulling a wall out to meet
 * an existing partition is a normal move and there is no reason to make it a
 * fight.
 */
export function localAlignCandidates(
  spec: HomeSpec,
  v: Volume,
  partitions: readonly Partition[],
): { xs: number[]; zs: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const other of spec.volumes) {
    if (other.id === v.id) continue;
    for (const c of volumeCornersWorld(other)) {
      const l = toLocal(v, c);
      xs.push(q(l.x));
      zs.push(q(l.z));
    }
  }
  for (const p of partitions) {
    if (p.volumeId !== v.id) continue;
    if (p.axis === "x") {
      zs.push(q(p.atFt));
      xs.push(q(p.fromFt), q(p.toFt));
    } else {
      xs.push(q(p.atFt));
      zs.push(q(p.fromFt), q(p.toFt));
    }
  }
  return { xs, zs };
}

/** Offsets along one wall worth lining an opening up with: the ends of every
 *  other opening on the same wall, and the wall's own midpoint. Centring a
 *  window on a wall is the single most common thing anybody does with one. */
export function openingAlignCandidates(
  spec: HomeSpec,
  v: Volume,
  wall: Wall,
  exceptOpeningId: string | null,
  widthFt: number,
): number[] {
  const run = wallRunOf(spec, v, wall);
  const out: number[] = [q((run - widthFt) / 2)];
  for (const o of v.openings) {
    if (o.wall !== wall || o.id === exceptOpeningId) continue;
    out.push(q(o.offsetFt), q(o.offsetFt + o.widthFt));
    // the offset that would butt this opening's far edge against that one
    out.push(q(o.offsetFt - widthFt));
  }
  return out.filter((t) => t >= 0 && t <= run);
}

/* ===========================================================================
   5. HIT TESTING

   Priority order is deliberate and is the difference between an editor that
   feels sharp and one that grabs the wrong thing: the SMALLEST target wins,
   because a small target is hard to hit and a large one is not. Handles first,
   then edges, then interiors. Volumes are tested last-drawn-first so the mass
   on top of the pile is the one you grab.
   =========================================================================== */

export type PlanHandle =
  | { kind: "corner"; volumeId: string; index: number }
  | { kind: "wall"; volumeId: string; wall: Wall }
  | { kind: "opening"; volumeId: string; openingId: string }
  | { kind: "opening-end"; volumeId: string; openingId: string; end: 0 | 1 }
  | { kind: "partition"; id: string }
  | { kind: "partition-end"; id: string; end: 0 | 1 }
  | { kind: "partition-door"; id: string }
  | { kind: "volume"; volumeId: string };

export function handleKey(h: PlanHandle | null): string {
  if (!h) return "";
  switch (h.kind) {
    case "corner":
      return `corner:${h.volumeId}:${h.index}`;
    case "wall":
      return `wall:${h.volumeId}:${h.wall}`;
    case "opening":
      return `opening:${h.volumeId}:${h.openingId}`;
    case "opening-end":
      return `opening-end:${h.volumeId}:${h.openingId}:${h.end}`;
    case "partition":
      return `partition:${h.id}`;
    case "partition-end":
      return `partition-end:${h.id}:${h.end}`;
    case "partition-door":
      return `partition-door:${h.id}`;
    default:
      return `volume:${h.volumeId}`;
  }
}

/** Distance from a point to a segment, feet. The clamped-projection form, so a
 *  point past either end measures to the endpoint rather than to the infinite
 *  line — which is the difference between grabbing a wall and grabbing the air
 *  beyond its corner. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz;
  if (len2 <= 1e-12) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * vx), p.z - (a.z + t * vz));
}

/** Is a world point inside the volume's footprint? Done in the local frame,
 *  where the test is two comparisons rather than a polygon crossing count. */
export function pointInVolume(v: Volume, world: Vec2): boolean {
  const l = toLocal(v, world);
  return Math.abs(l.x) <= v.widthFt / 2 && Math.abs(l.z) <= v.depthFt / 2;
}

export function hitTest(
  spec: HomeSpec,
  partitions: readonly Partition[],
  world: Vec2,
  tolFt: number,
): PlanHandle | null {
  const th = structThicknessOf(spec);
  const volumes = [...spec.volumes].reverse(); // topmost first

  // 1. corners — the smallest target on the plan
  for (const v of volumes) {
    for (let i = 0; i < 4; i++) {
      const c = cornerWorld(v, i);
      if (Math.hypot(world.x - c.x, world.z - c.z) <= tolFt) {
        return { kind: "corner", volumeId: v.id, index: i };
      }
    }
  }

  // 2. opening ends, then openings
  for (const v of volumes) {
    for (const o of v.openings) {
      const a = toWorld(v, pointOnWallLocal(v, o.wall, th, o.offsetFt));
      const b = toWorld(v, pointOnWallLocal(v, o.wall, th, o.offsetFt + o.widthFt));
      if (Math.hypot(world.x - a.x, world.z - a.z) <= tolFt)
        return { kind: "opening-end", volumeId: v.id, openingId: o.id, end: 0 };
      if (Math.hypot(world.x - b.x, world.z - b.z) <= tolFt)
        return { kind: "opening-end", volumeId: v.id, openingId: o.id, end: 1 };
      if (distToSegment(world, a, b) <= tolFt)
        return { kind: "opening", volumeId: v.id, openingId: o.id };
    }
  }

  // 3. partition ends, doors, then partitions
  for (const p of partitions) {
    const v = spec.volumes.find((x) => x.id === p.volumeId);
    if (!v) continue;
    const seg = partitionSegmentWorld(v, p);
    if (Math.hypot(world.x - seg.a.x, world.z - seg.a.z) <= tolFt)
      return { kind: "partition-end", id: p.id, end: 0 };
    if (Math.hypot(world.x - seg.b.x, world.z - seg.b.z) <= tolFt)
      return { kind: "partition-end", id: p.id, end: 1 };
    if (p.door) {
      const d = toWorld(v, pointOnPartitionLocal(p, p.door.atFt - p.fromFt));
      if (Math.hypot(world.x - d.x, world.z - d.z) <= tolFt)
        return { kind: "partition-door", id: p.id };
    }
    if (distToSegment(world, seg.a, seg.b) <= Math.max(tolFt, p.thicknessFt)) {
      return { kind: "partition", id: p.id };
    }
  }

  // 4. walls
  for (const v of volumes) {
    for (const wall of WALLS_CW) {
      const seg = wallSegmentWorld(v, wall, th);
      if (distToSegment(world, seg.a, seg.b) <= Math.max(tolFt, th)) {
        return { kind: "wall", volumeId: v.id, wall };
      }
    }
  }

  // 5. the mass itself
  for (const v of volumes) {
    if (pointInVolume(v, world)) return { kind: "volume", volumeId: v.id };
  }
  return null;
}

/** Which volume a world point falls in, for the partition tool — a partition
 *  belongs to exactly one mass and drawing one across two would be a lie about
 *  what gets built. */
export function volumeAt(spec: HomeSpec, world: Vec2): Volume | null {
  for (let i = spec.volumes.length - 1; i >= 0; i--) {
    if (pointInVolume(spec.volumes[i], world)) return spec.volumes[i];
  }
  return null;
}

/* ===========================================================================
   6. CONSTRAINED EDITS — the offsetting and solving

   Every one of these takes a spec and returns a NEW spec, the discipline
   `edits.ts` set and the reason undo is a stack rather than a rewrite. They
   also return the partitions, because a wall that moves takes the rooms
   behind it with it, and returning the two separately would let a caller apply
   half an edit.
   =========================================================================== */

export interface PlanEdit {
  spec: HomeSpec;
  partitions: Partition[];
  /** ids of openings and partitions the constraint solver had to move. NOT a
   *  failure — a report, so the UI can say "two windows moved" instead of the
   *  user finding out from a drawing later. */
  adjusted: string[];
}

const dimLimit = (axis: "x" | "z") => (axis === "x" ? LIMITS.widthFt : LIMITS.depthFt);

/**
 * Openings pulled back onto a wall that just got shorter.
 *
 * The offset is clamped; the WIDTH is not touched. Narrowing somebody's window
 * because they nudged a wall would be the tool making a design decision, and
 * `geometry.ts` already reports an over-wide opening as "trimmed to fit" —
 * that warning is the right place for it, in words, rather than a silent
 * resize here.
 */
function clampOpenings(
  spec: HomeSpec,
  v: Volume,
): { openings: Opening[]; adjusted: string[] } {
  const th = structThicknessOf(spec);
  const adjusted: string[] = [];
  const openings = v.openings.map((o) => {
    const run = wallRunFt(v, o.wall, th);
    const max = Math.max(0, run - o.widthFt);
    const offsetFt = q(clamp(o.offsetFt, 0, max));
    if (offsetFt !== o.offsetFt) {
      adjusted.push(o.id);
      return { ...o, offsetFt };
    }
    return o;
  });
  return { openings, adjusted };
}

/**
 * The one function every resize goes through.
 *
 * Given new LOCAL face positions on either axis (relative to the volume's
 * current centre), it produces the new width, depth and world centre, shifts
 * every partition by the same amount in the opposite direction so the rooms
 * stay where they are on the ground, and then re-fits both the partitions and
 * the openings.
 *
 * The partition compensation is the part that is easy to get wrong and
 * obvious once seen: partitions are stored relative to the volume's CENTRE,
 * and a face drag moves the centre by half the change. Without the
 * compensation, dragging the east wall out by four feet slides every interior
 * wall two feet east — which looks like a bug and is a coordinate frame.
 */
export function resizeVolume(
  spec: HomeSpec,
  partitions: readonly Partition[],
  volumeId: string,
  faces: { xMin?: number; xMax?: number; zMin?: number; zMax?: number },
): PlanEdit {
  const v = spec.volumes.find((x) => x.id === volumeId);
  if (!v) return { spec, partitions: [...partitions], adjusted: [] };

  const solveAxis = (axis: "x" | "z", lo: number | undefined, hi: number | undefined) => {
    const half = halfOn(v, axis);
    const lim = dimLimit(axis);
    let min = lo ?? -half;
    let max = hi ?? half;
    // A face dragged past its opposite number would invert the volume. Stop it
    // at the minimum dimension instead, holding whichever face was NOT dragged.
    if (max - min < lim.min) {
      if (hi !== undefined && lo === undefined) max = min + lim.min;
      else if (lo !== undefined && hi === undefined) min = max - lim.min;
      else {
        const mid = (min + max) / 2;
        min = mid - lim.min / 2;
        max = mid + lim.min / 2;
      }
    }
    if (max - min > lim.max) {
      if (hi !== undefined && lo === undefined) max = min + lim.max;
      else if (lo !== undefined && hi === undefined) min = max - lim.max;
      else {
        const mid = (min + max) / 2;
        min = mid - lim.max / 2;
        max = mid + lim.max / 2;
      }
    }
    return { dim: q(max - min), shift: (min + max) / 2 };
  };

  const ax = solveAxis("x", faces.xMin, faces.xMax);
  const az = solveAxis("z", faces.zMin, faces.zMax);

  const centre = toWorld(v, { x: ax.shift, z: az.shift });
  const nextVolume: Volume = {
    ...v,
    widthFt: ax.dim,
    depthFt: az.dim,
    x: q(clamp(centre.x, LIMITS.positionFt.min, LIMITS.positionFt.max)),
    z: q(clamp(centre.z, LIMITS.positionFt.min, LIMITS.positionFt.max)),
  };

  const shifted = partitions.map((p) =>
    p.volumeId !== volumeId
      ? p
      : {
          ...p,
          atFt: q(p.atFt - (p.axis === "x" ? az.shift : ax.shift)),
          fromFt: q(p.fromFt - (p.axis === "x" ? ax.shift : az.shift)),
          toFt: q(p.toFt - (p.axis === "x" ? ax.shift : az.shift)),
          door: p.door
            ? { ...p.door, atFt: q(p.door.atFt - (p.axis === "x" ? ax.shift : az.shift)) }
            : null,
        },
  );

  const withOpenings = clampOpenings(spec, nextVolume);
  const solvedVolume: Volume = { ...nextVolume, openings: withOpenings.openings };
  const nextSpec = patchVolume(spec, volumeId, {
    widthFt: solvedVolume.widthFt,
    depthFt: solvedVolume.depthFt,
    x: solvedVolume.x,
    z: solvedVolume.z,
    openings: solvedVolume.openings,
  });
  const fitted = clampPartitions(solvedVolume, shifted, structThicknessOf(spec));

  return {
    spec: nextSpec,
    partitions: fitted.partitions,
    adjusted: [...withOpenings.adjusted, ...fitted.adjusted],
  };
}

/** Push ONE wall in or out. `faceLocal` is the wall's new position on its face
 *  axis, in the volume's current local frame. */
export function offsetWall(
  spec: HomeSpec,
  partitions: readonly Partition[],
  volumeId: string,
  wall: Wall,
  faceLocal: number,
): PlanEdit {
  const faces =
    wall === "e"
      ? { xMax: faceLocal }
      : wall === "w"
        ? { xMin: faceLocal }
        : wall === "s"
          ? { zMax: faceLocal }
          : { zMin: faceLocal };
  return resizeVolume(spec, partitions, volumeId, faces);
}

/** Drag a CORNER: the two walls that meet there move together and the opposite
 *  corner is pinned. The footprint stays a rectangle — see the header. */
export function dragCorner(
  spec: HomeSpec,
  partitions: readonly Partition[],
  volumeId: string,
  index: number,
  local: Vec2,
): PlanEdit {
  const [wx, wz] = CORNER_WALLS[((index % 4) + 4) % 4];
  const faces: { xMin?: number; xMax?: number; zMin?: number; zMax?: number } = {};
  if (faceSignOf(wx) > 0) faces.xMax = local.x;
  else faces.xMin = local.x;
  if (faceSignOf(wz) > 0) faces.zMax = local.z;
  else faces.zMin = local.z;
  return resizeVolume(spec, partitions, volumeId, faces);
}

/** Move a whole mass. Partitions ride along untouched — they are stored in the
 *  volume's frame, which is the entire reason they are stored that way. */
export function moveVolumeTo(
  spec: HomeSpec,
  partitions: readonly Partition[],
  volumeId: string,
  centre: Vec2,
): PlanEdit {
  return {
    spec: patchVolume(spec, volumeId, {
      x: q(clamp(centre.x, LIMITS.positionFt.min, LIMITS.positionFt.max)),
      z: q(clamp(centre.z, LIMITS.positionFt.min, LIMITS.positionFt.max)),
    }),
    partitions: [...partitions],
    adjusted: [],
  };
}

/* -------------------------------------------------------------- openings */

/** Slide an opening along its wall. */
export function moveOpening(
  spec: HomeSpec,
  volumeId: string,
  openingId: string,
  offsetFt: number,
): HomeSpec {
  const v = spec.volumes.find((x) => x.id === volumeId);
  const o = v?.openings.find((x) => x.id === openingId);
  if (!v || !o) return spec;
  const run = wallRunOf(spec, v, o.wall);
  const next = q(clamp(offsetFt, 0, Math.max(0, run - o.widthFt)));
  if (next === o.offsetFt) return spec;
  return patchVolume(spec, volumeId, {
    openings: v.openings.map((x) => (x.id === openingId ? { ...x, offsetFt: next } : x)),
  });
}

/**
 * Drag one EDGE of an opening. The other edge is pinned, so the gesture reads
 * as "make this window wider on this side" rather than "recentre it", and the
 * dimension that changes is the one under the cursor.
 */
export function resizeOpening(
  spec: HomeSpec,
  volumeId: string,
  openingId: string,
  end: 0 | 1,
  tFt: number,
): HomeSpec {
  const v = spec.volumes.find((x) => x.id === volumeId);
  const o = v?.openings.find((x) => x.id === openingId);
  if (!v || !o) return spec;
  const run = wallRunOf(spec, v, o.wall);
  const lim = LIMITS.openingWidthFt;
  const pinned = end === 0 ? o.offsetFt + o.widthFt : o.offsetFt;
  const moved = clamp(tFt, 0, run);
  let lo = Math.min(pinned, moved);
  let hi = Math.max(pinned, moved);
  let width = clamp(hi - lo, lim.min, Math.min(lim.max, run));
  if (end === 0) lo = pinned - width;
  else hi = pinned + width;
  // A clamp at the wall's end can push the pinned edge; keep it on the wall.
  if (lo < 0) lo = 0;
  if (lo + width > run) width = Math.max(lim.min, run - lo);
  hi = lo + width;

  return patchVolume(spec, volumeId, {
    openings: v.openings.map((x) =>
      x.id === openingId ? { ...x, offsetFt: q(lo), widthFt: q(hi - lo) } : x,
    ),
  });
}

/* ===========================================================================
   7. DIMENSIONS — the numbers that go on screen while you drag

   Returned as NUMBERS. Formatting to 12'-6" happens in the component, using
   the drawing kit's own `fmtFt`, so the number under the cursor is lettered by
   the same function that letters the sheet and the two can never disagree
   about what 4.5 feet reads as.
   =========================================================================== */

export interface Chain {
  /** clear distance from the wall's offset-0 end to the near edge */
  before: number;
  /** the thing itself */
  span: number;
  /** clear distance from the far edge to the wall's far end */
  after: number;
  /** the run the chain sits on, so `before + span + after` is checkable */
  totalFt: number;
}

export function openingChain(spec: HomeSpec, v: Volume, o: Opening): Chain {
  const run = wallRunOf(spec, v, o.wall);
  return {
    before: q(o.offsetFt),
    span: q(o.widthFt),
    after: q(Math.max(0, run - o.offsetFt - o.widthFt)),
    totalFt: q(run),
  };
}

/** A partition's position measured to the two walls it runs BETWEEN — the
 *  dimension a framer actually wants, inside face to centreline. */
export function partitionAcrossChain(
  v: Volume,
  p: Partition,
  structThicknessFt: number,
): Chain {
  const b = interiorBoundsLocal(v, structThicknessFt);
  const lo = p.axis === "x" ? b.minZ : b.minX;
  const hi = p.axis === "x" ? b.maxZ : b.maxX;
  return {
    before: q(p.atFt - lo - p.thicknessFt / 2),
    span: q(p.thicknessFt),
    after: q(hi - p.atFt - p.thicknessFt / 2),
    totalFt: q(hi - lo),
  };
}

/* ===========================================================================
   8. THE CODEC — how partitions round-trip

   `validateHomeSpec` in `share.ts` rebuilds a spec from validated primitives
   and drops everything else, which means an extra key on HomeSpec would NOT
   survive a share link. So partitions carry their own payload with their own
   gate, built to the same rule: check the contract, then construct a fresh
   object out of checked primitives, so a hand-edited file cannot smuggle a
   field into application state.

   Deterministic: fixed key order, values quantised to a thousandth of a foot,
   `JSON.stringify` over an array. The same plan always produces the same
   string, which is what makes it safe to put in a URL beside the spec.
   =========================================================================== */

export const PARTITIONS_VERSION = 1 as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The gate — now a READER ONLY. Nothing writes this wire format any more:
 *  the BuilderDocument codec (`lib/builder/document.ts`) carries partitions
 *  as validated plain objects inside the one document payload. This decoder
 *  stays so every `.aura.json` written in the era when partitions travelled
 *  as their own `auraEditor` sidecar block still opens with its walls.
 *  Returns null rather than throwing, and rebuilds every field. */
export function partitionsFromWire(value: unknown): Partition[] | null {
  if (!isObj(value)) return null;
  if (value.version !== PARTITIONS_VERSION) return null;
  if (!Array.isArray(value.partitions)) return null;

  const out: Partition[] = [];
  const seen = new Set<string>();
  for (const raw of value.partitions) {
    if (!isObj(raw)) return null;
    if (typeof raw.i !== "string" || raw.i.length === 0) return null;
    if (seen.has(raw.i)) return null;
    seen.add(raw.i);
    if (typeof raw.v !== "string" || raw.v.length === 0) return null;
    if (raw.a !== "x" && raw.a !== "z") return null;
    if (!isNum(raw.t) || !isNum(raw.f) || !isNum(raw.o)) return null;
    if (!isNum(raw.k) || raw.k <= 0) return null;

    let door: PartitionDoor | null = null;
    if (raw.d !== undefined) {
      if (!Array.isArray(raw.d) || raw.d.length !== 2) return null;
      const [at, w] = raw.d;
      if (!isNum(at) || !isNum(w) || w <= 0) return null;
      door = { atFt: at, widthFt: w };
    }

    out.push({
      id: raw.i,
      volumeId: raw.v,
      axis: raw.a,
      atFt: raw.t,
      fromFt: Math.min(raw.f, raw.o),
      toFt: Math.max(raw.f, raw.o),
      thicknessFt: raw.k,
      door,
    });
  }
  return out;
}

