/**
 * Planar design-intent geometry for Aura Homes.
 *
 * Feet are explicit, ids are semantic and stable, and every mutation is
 * atomic: a candidate graph is validated before it can replace the caller's
 * graph. This module does not guess structure, code compliance, roof joins or
 * room use. It records editable planar intent from which those later views
 * can be derived consistently.
 */

import type { HomeSpec, RoofForm, Volume, Wall } from "./spec";

export const BUILDING_GRAPH_VERSION = 1 as const;
const EPS = 1e-8;

export type GraphPoint = readonly [xFt: number, zFt: number];
export type GraphWallKind = "external" | "partition";
export type GraphOpeningKind = "window" | "door" | "glazing-wall";
export type GraphRoofForm = "gable" | "hipped" | "shed" | "flat";

/**
 * A graph roof form as the LEGACY `RoofForm` union can express it.
 *
 * THE GRAPH KNOWS ONE ROOF THE SPEC DOES NOT. `RoofForm` is
 * gable | a-frame | shed | flat | saltbox, with no hip, and the graph builds
 * real hips — `buildRoofModel` has its own `form === "hipped"` branch. So every
 * boundary that turns a graph storey back into a `Volume` has to answer what a
 * hip becomes, and until now two of them answered by casting, which is how a
 * roof the drawing cannot express became a type error rather than a disclosed
 * approximation.
 *
 * A hip is a gable whose ends also slope, so `gable` is the nearest honest
 * neighbour and the only one that keeps the ridge. It is still an
 * APPROXIMATION and it is lossy in a direction that matters: a gable end is
 * full height where a hip's is cut away, so anything reading headroom near the
 * end walls from the mapped volume reads more room than the graph builds.
 * Callers must say so rather than let the shape pass silently — the drawing
 * model pushes a warning, and the fixture host names it in the palette.
 */
export const legacyRoofFormFor = (form: GraphRoofForm): RoofForm =>
  form === "hipped" ? "gable" : form;

/** True when `legacyRoofFormFor` had to give something up. */
export const roofFormIsApproximated = (form: GraphRoofForm): boolean => form === "hipped";

export interface GraphVertex {
  id: string;
  xFt: number;
  zFt: number;
}

export interface GraphOpening {
  id: string;
  kind: GraphOpeningKind;
  /** Distance from the wall's start vertex along its run. */
  offsetFt: number;
  widthFt: number;
  heightFt: number;
  sillFt: number;
}

export interface GraphWallEdge {
  id: string;
  startVertexId: string;
  endVertexId: string;
  kind: GraphWallKind;
  thicknessFt: number;
  openings: GraphOpening[];
}

export interface GraphDirectedEdge {
  wallId: string;
  forward: boolean;
}

export interface GraphRoomFace {
  id: string;
  name: string;
  boundary: GraphDirectedEdge[];
  areaSqft: number;
}

export interface GraphSlab {
  id: string;
  boundaryVertexIds: string[];
  voidIds: string[];
}

export interface GraphVoid {
  id: string;
  boundaryVertexIds: string[];
}

export interface GraphRoofZone {
  id: string;
  form: GraphRoofForm;
  boundaryVertexIds: string[];
  pitchDeg: number;
  /** Direction of downward fall in plan for a shed. */
  fallVector?: GraphPoint;
  /** Design-intent ridge for a gable, clipped to the footprint. */
  ridge?: { start: GraphPoint; end: GraphPoint };
}

export interface GraphStorey {
  id: string;
  name: string;
  elevationFt: number;
  heightFt: number;
  vertices: GraphVertex[];
  walls: GraphWallEdge[];
  rooms: GraphRoomFace[];
  slabs: GraphSlab[];
  voids: GraphVoid[];
  roofZones: GraphRoofZone[];
}

export interface GraphStair {
  id: string;
  fromStoreyId: string;
  toStoreyId: string;
  /** Flight centreline in the shared site plan frame. */
  start: GraphPoint;
  end: GraphPoint;
  widthFt: number;
  /** Explicit void in the upper slab; never inferred by the renderer. */
  openingVoidId: string;
}

export interface GraphShaft {
  id: string;
  fromStoreyId: string;
  toStoreyId: string;
  centre: GraphPoint;
  widthFt: number;
  depthFt: number;
  openingVoidId: string;
}

export interface GraphStackedRoomRelationship {
  lowerStoreyId: string;
  lowerRoomId: string;
  upperStoreyId: string;
  upperRoomId: string;
  overlapSqft: number;
}

export interface BuildingGraph {
  kind: "building-graph";
  version: typeof BUILDING_GRAPH_VERSION;
  units: "feet";
  storeys: GraphStorey[];
  /** Additive v1 field. Older graph documents omit it and read as empty. */
  stairs?: GraphStair[];
  /** Additive v1 field. A shaft always owns explicit referenced voids. */
  shafts?: GraphShaft[];
}

export type BuildingGraphValidation =
  | { ok: true; graph: BuildingGraph }
  | { ok: false; problem: string };

export type GraphMutation =
  | { ok: true; graph: BuildingGraph }
  | { ok: false; problem: string; graph: BuildingGraph };

export type GraphFactoryResult =
  | { ok: true; graph: BuildingGraph }
  | { ok: false; problem: string };

export type RoofZoneResult =
  | { ok: true; zone: GraphRoofZone }
  | { ok: false; problem: string };

export interface DuplicateStoreyOptions {
  id: string;
  name: string;
  elevationFt: number;
  heightFt?: number;
}

export interface GraphStairInput {
  id: string;
  fromStoreyId: string;
  toStoreyId: string;
  start: GraphPoint;
  end: GraphPoint;
  widthFt: number;
}

export interface GraphShaftInput {
  id: string;
  fromStoreyId: string;
  toStoreyId: string;
  centre: GraphPoint;
  widthFt: number;
  depthFt: number;
}

export type LegacyGraphConversion =
  | {
      ok: true;
      graph: BuildingGraph;
      /** Untouched source for recovery or a future higher-fidelity migration. */
      legacyRecovery: HomeSpec;
      warnings: string[];
    }
  | { ok: false; problem: string };

const finite = (value: number): boolean => Number.isFinite(value);
const pointOf = (vertex: GraphVertex): GraphPoint => [vertex.xFt, vertex.zFt];
const samePoint = (a: GraphPoint, b: GraphPoint): boolean =>
  Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
const cross = (a: GraphPoint, b: GraphPoint, c: GraphPoint): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const distance = (a: GraphPoint, b: GraphPoint): number =>
  Math.hypot(b[0] - a[0], b[1] - a[1]);

function polygonArea(points: readonly GraphPoint[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2;
}

function pointOnSegment(point: GraphPoint, a: GraphPoint, b: GraphPoint): boolean {
  return (
    Math.abs(cross(a, b, point)) <= EPS &&
    point[0] >= Math.min(a[0], b[0]) - EPS &&
    point[0] <= Math.max(a[0], b[0]) + EPS &&
    point[1] >= Math.min(a[1], b[1]) - EPS &&
    point[1] <= Math.max(a[1], b[1]) + EPS
  );
}

function segmentsIntersect(a: GraphPoint, b: GraphPoint, c: GraphPoint, d: GraphPoint): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (
    ((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS)) &&
    ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS))
  ) {
    return true;
  }
  return (
    (Math.abs(abC) <= EPS && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) <= EPS && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) <= EPS && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) <= EPS && pointOnSegment(b, c, d))
  );
}

function polygonSelfIntersects(points: readonly GraphPoint[]): boolean {
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length;
      if (left === right || leftNext === right || rightNext === left) continue;
      if (segmentsIntersect(points[left], points[leftNext], points[right], points[rightNext])) {
        return true;
      }
    }
  }
  return false;
}

function pointInPolygon(point: GraphPoint, polygon: readonly GraphPoint[]): boolean {
  if (polygon.some((a, index) => pointOnSegment(point, a, polygon[(index + 1) % polygon.length]))) {
    return true;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses =
      (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function vertexMap(storey: GraphStorey): Map<string, GraphVertex> {
  return new Map(storey.vertices.map((vertex) => [vertex.id, vertex]));
}

function wallLength(storey: GraphStorey, wall: GraphWallEdge): number {
  const vertices = vertexMap(storey);
  const start = vertices.get(wall.startVertexId);
  const end = vertices.get(wall.endVertexId);
  return start && end ? distance(pointOf(start), pointOf(end)) : Number.NaN;
}

interface HalfEdge extends GraphDirectedEdge {
  from: string;
  to: string;
  angle: number;
}

const halfKey = (edge: GraphDirectedEdge): string => `${edge.wallId}:${edge.forward ? "f" : "r"}`;
const boundaryKey = (boundary: readonly GraphDirectedEdge[]): string =>
  boundary.map((edge) => edge.wallId).sort().join("|");
const directedCycleKey = (boundary: readonly GraphDirectedEdge[]): string => {
  const tokens = boundary.map(halfKey);
  if (tokens.length === 0) return "";
  let best = tokens.join("|");
  for (let offset = 1; offset < tokens.length; offset += 1) {
    const rotated = [...tokens.slice(offset), ...tokens.slice(0, offset)].join("|");
    if (rotated < best) best = rotated;
  }
  return best;
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Derive bounded faces from the planar half-edge embedding. */
export function deriveRoomFaces(
  storey: GraphStorey,
  previous: readonly GraphRoomFace[] = storey.rooms,
): GraphRoomFace[] {
  const vertices = vertexMap(storey);
  const outgoing = new Map<string, HalfEdge[]>();
  const add = (edge: HalfEdge) => {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  };
  for (const wall of storey.walls) {
    const start = vertices.get(wall.startVertexId);
    const end = vertices.get(wall.endVertexId);
    if (!start || !end) continue;
    add({
      wallId: wall.id,
      forward: true,
      from: start.id,
      to: end.id,
      angle: Math.atan2(end.zFt - start.zFt, end.xFt - start.xFt),
    });
    add({
      wallId: wall.id,
      forward: false,
      from: end.id,
      to: start.id,
      angle: Math.atan2(start.zFt - end.zFt, start.xFt - end.xFt),
    });
  }
  outgoing.forEach((list) => {
    list.sort((a, b) => a.angle - b.angle || halfKey(a).localeCompare(halfKey(b)));
  });

  const visited = new Set<string>();
  const faces: Array<{ boundary: GraphDirectedEdge[]; area: number; centroid: GraphPoint }> = [];
  for (const wall of storey.walls) {
    for (const seed of [
      { wallId: wall.id, forward: true },
      { wallId: wall.id, forward: false },
    ] as const) {
      if (visited.has(halfKey(seed))) continue;
      const boundary: GraphDirectedEdge[] = [];
      const points: GraphPoint[] = [];
      let current: GraphDirectedEdge = seed;
      const guard = storey.walls.length * 2 + 1;
      for (let step = 0; step < guard; step += 1) {
        const key = halfKey(current);
        if (visited.has(key)) break;
        visited.add(key);
        boundary.push(current);
        const currentWall = storey.walls.find((item) => item.id === current.wallId);
        if (!currentWall) break;
        const fromId = current.forward ? currentWall.startVertexId : currentWall.endVertexId;
        const toId = current.forward ? currentWall.endVertexId : currentWall.startVertexId;
        const from = vertices.get(fromId);
        if (!from) break;
        points.push(pointOf(from));
        const at = outgoing.get(toId) ?? [];
        const reverseIndex = at.findIndex(
          (candidate) => candidate.wallId === current.wallId && candidate.forward !== current.forward,
        );
        if (reverseIndex < 0 || at.length === 0) break;
        const next = at[(reverseIndex - 1 + at.length) % at.length];
        current = { wallId: next.wallId, forward: next.forward };
        if (halfKey(current) === halfKey(seed)) break;
      }
      const area = polygonArea(points);
      if (boundary.length >= 3 && area > EPS) {
        faces.push({
          boundary,
          area,
          centroid: [
            points.reduce((sum, point) => sum + point[0], 0) / points.length,
            points.reduce((sum, point) => sum + point[1], 0) / points.length,
          ],
        });
      }
    }
  }

  faces.sort(
    (a, b) =>
      a.centroid[0] - b.centroid[0] ||
      a.centroid[1] - b.centroid[1] ||
      boundaryKey(a.boundary).localeCompare(boundaryKey(b.boundary)),
  );
  const prior = new Map(previous.map((room) => [boundaryKey(room.boundary), room]));
  return faces.map((face, index) => {
    const key = boundaryKey(face.boundary);
    const existing = prior.get(key);
    return {
      id: existing?.id ?? `room-${stableHash(`${storey.id}|${key}`)}`,
      name: existing?.name ?? `Room ${index + 1}`,
      boundary: face.boundary,
      areaSqft: Math.round(face.area * 1e6) / 1e6,
    };
  });
}

function graphWithStorey(graph: BuildingGraph, storey: GraphStorey): BuildingGraph {
  return {
    ...graph,
    storeys: graph.storeys.map((item) => (item.id === storey.id ? storey : item)),
  };
}

function fail(graph: BuildingGraph, problem: string): GraphMutation {
  return { ok: false, graph, problem };
}

function wallIntersectionProblem(storey: GraphStorey): string | null {
  const vertices = vertexMap(storey);
  for (let left = 0; left < storey.walls.length; left += 1) {
    const aWall = storey.walls[left];
    const a = vertices.get(aWall.startVertexId);
    const b = vertices.get(aWall.endVertexId);
    if (!a || !b) continue;
    for (let right = left + 1; right < storey.walls.length; right += 1) {
      const bWall = storey.walls[right];
      const c = vertices.get(bWall.startVertexId);
      const d = vertices.get(bWall.endVertexId);
      if (!c || !d) continue;
      const shared = [a.id, b.id].filter((id) => id === c.id || id === d.id);
      if (!segmentsIntersect(pointOf(a), pointOf(b), pointOf(c), pointOf(d))) continue;
      if (shared.length === 1) {
        const sharedPoint = pointOf(vertices.get(shared[0])!);
        const otherA = samePoint(pointOf(a), sharedPoint) ? pointOf(b) : pointOf(a);
        const otherB = samePoint(pointOf(c), sharedPoint) ? pointOf(d) : pointOf(c);
        if (Math.abs(cross(sharedPoint, otherA, otherB)) > EPS) continue;
        const dot =
          (otherA[0] - sharedPoint[0]) * (otherB[0] - sharedPoint[0]) +
          (otherA[1] - sharedPoint[1]) * (otherB[1] - sharedPoint[1]);
        if (dot <= EPS) continue;
      }
      return `Walls ${aWall.id} and ${bWall.id} intersect without a shared planar vertex.`;
    }
  }
  return null;
}

export function validateBuildingGraph(value: BuildingGraph): BuildingGraphValidation {
  if (!value || value.kind !== "building-graph" || value.version !== BUILDING_GRAPH_VERSION)
    return { ok: false, problem: "Building graph format or version is unsupported." };
  if (value.units !== "feet") return { ok: false, problem: "Building graph units must be feet." };
  if (!Array.isArray(value.storeys) || value.storeys.length === 0)
    return { ok: false, problem: "Building graph has no storey." };

  const globalIds = new Set<string>();
  for (const storey of value.storeys) {
    if (!storey.id || globalIds.has(storey.id))
      return { ok: false, problem: `Duplicate or empty storey id ${storey.id}.` };
    globalIds.add(storey.id);
    if (!finite(storey.elevationFt) || !finite(storey.heightFt) || storey.heightFt <= 0)
      return { ok: false, problem: `Storey ${storey.id} has invalid elevation or height.` };
    const vertices = vertexMap(storey);
    if (vertices.size !== storey.vertices.length)
      return { ok: false, problem: `Storey ${storey.id} has duplicate vertex ids.` };
    for (const vertex of storey.vertices) {
      if (!vertex.id || !finite(vertex.xFt) || !finite(vertex.zFt))
        return { ok: false, problem: `Storey ${storey.id} has an invalid vertex.` };
      if (globalIds.has(vertex.id)) return { ok: false, problem: `Duplicate graph id ${vertex.id}.` };
      globalIds.add(vertex.id);
    }
    for (let left = 0; left < storey.vertices.length; left += 1) {
      for (let right = left + 1; right < storey.vertices.length; right += 1) {
        if (samePoint(pointOf(storey.vertices[left]), pointOf(storey.vertices[right]))) {
          return { ok: false, problem: `Vertices ${storey.vertices[left].id} and ${storey.vertices[right].id} occupy the same point.` };
        }
      }
    }
    const undirected = new Set<string>();
    const openingIds = new Set<string>();
    for (const wall of storey.walls) {
      if (!wall.id || globalIds.has(wall.id)) return { ok: false, problem: `Duplicate graph id ${wall.id}.` };
      globalIds.add(wall.id);
      const start = vertices.get(wall.startVertexId);
      const end = vertices.get(wall.endVertexId);
      if (!start || !end) return { ok: false, problem: `Wall ${wall.id} references a missing vertex.` };
      const length = distance(pointOf(start), pointOf(end));
      if (length <= EPS) return { ok: false, problem: `Wall ${wall.id} has zero length.` };
      if (wall.kind !== "external" && wall.kind !== "partition")
        return { ok: false, problem: `Wall ${wall.id} has an unsupported kind.` };
      if (!finite(wall.thicknessFt) || wall.thicknessFt <= 0)
        return { ok: false, problem: `Wall ${wall.id} has invalid thickness.` };
      const edgeKey = [start.id, end.id].sort().join("|");
      if (undirected.has(edgeKey)) return { ok: false, problem: `Duplicate wall edge ${edgeKey}.` };
      undirected.add(edgeKey);
      const sortedOpenings = [...wall.openings].sort((a, b) => a.offsetFt - b.offsetFt);
      for (let index = 0; index < sortedOpenings.length; index += 1) {
        const opening = sortedOpenings[index];
        if (!opening.id || openingIds.has(opening.id) || globalIds.has(opening.id))
          return { ok: false, problem: `Duplicate or empty opening id ${opening.id}.` };
        openingIds.add(opening.id);
        globalIds.add(opening.id);
        if (
          !["window", "door", "glazing-wall"].includes(opening.kind) ||
          !finite(opening.offsetFt) ||
          !finite(opening.widthFt) ||
          !finite(opening.heightFt) ||
          !finite(opening.sillFt) ||
          opening.offsetFt < -EPS ||
          opening.widthFt <= 0 ||
          opening.heightFt <= 0 ||
          opening.sillFt < 0 ||
          opening.offsetFt + opening.widthFt > length + EPS
        ) {
          return { ok: false, problem: `Opening ${opening.id} does not fit wall ${wall.id}.` };
        }
        const previous = sortedOpenings[index - 1];
        if (previous && previous.offsetFt + previous.widthFt > opening.offsetFt + EPS)
          return { ok: false, problem: `Openings ${previous.id} and ${opening.id} overlap.` };
      }
    }
    const intersection = wallIntersectionProblem(storey);
    if (intersection) return { ok: false, problem: intersection };

    for (const slab of storey.slabs) {
      if (!slab.id || globalIds.has(slab.id)) return { ok: false, problem: `Duplicate graph id ${slab.id}.` };
      globalIds.add(slab.id);
      if (slab.boundaryVertexIds.length < 3 || slab.boundaryVertexIds.some((id) => !vertices.has(id)))
        return { ok: false, problem: `Slab ${slab.id} has an invalid boundary.` };
      const points = slab.boundaryVertexIds.map((id) => pointOf(vertices.get(id)!));
      if (Math.abs(polygonArea(points)) <= EPS || polygonSelfIntersects(points))
        return { ok: false, problem: `Slab ${slab.id} boundary is self-intersecting or empty.` };
    }
    const voidIds = new Set<string>();
    for (const voidFace of storey.voids) {
      if (!voidFace.id || globalIds.has(voidFace.id) || voidIds.has(voidFace.id))
        return { ok: false, problem: `Duplicate or empty void id ${voidFace.id}.` };
      globalIds.add(voidFace.id);
      voidIds.add(voidFace.id);
      if (
        voidFace.boundaryVertexIds.length < 3 ||
        voidFace.boundaryVertexIds.some((id) => !vertices.has(id))
      ) {
        return { ok: false, problem: `Void ${voidFace.id} has an invalid boundary.` };
      }
      const points = voidFace.boundaryVertexIds.map((id) => pointOf(vertices.get(id)!));
      if (Math.abs(polygonArea(points)) <= EPS || polygonSelfIntersects(points))
        return { ok: false, problem: `Void ${voidFace.id} boundary is self-intersecting or empty.` };
    }
    for (const slab of storey.slabs) {
      if (slab.voidIds.some((id) => !voidIds.has(id)))
        return { ok: false, problem: `Slab ${slab.id} references a missing void.` };
    }

    for (const roof of storey.roofZones) {
      if (!roof.id || globalIds.has(roof.id)) return { ok: false, problem: `Duplicate graph id ${roof.id}.` };
      globalIds.add(roof.id);
      if (
        !["gable", "hipped", "shed", "flat"].includes(roof.form) ||
        !finite(roof.pitchDeg) ||
        roof.pitchDeg < 0 ||
        roof.boundaryVertexIds.length < 3 ||
        roof.boundaryVertexIds.some((id) => !vertices.has(id))
      ) {
        return { ok: false, problem: `Roof zone ${roof.id} is invalid.` };
      }
      if (
        roof.fallVector &&
        (!finite(roof.fallVector[0]) || !finite(roof.fallVector[1]) || distance([0, 0], roof.fallVector) <= EPS)
      ) {
        return { ok: false, problem: `Roof zone ${roof.id} has an invalid fall vector.` };
      }
      if (
        roof.ridge &&
        (!finite(roof.ridge.start[0]) ||
          !finite(roof.ridge.start[1]) ||
          !finite(roof.ridge.end[0]) ||
          !finite(roof.ridge.end[1]) ||
          samePoint(roof.ridge.start, roof.ridge.end))
      ) {
        return { ok: false, problem: `Roof zone ${roof.id} has an invalid ridge.` };
      }
    }

    const derived = deriveRoomFaces(storey, storey.rooms);
    if (derived.length !== storey.rooms.length)
      return { ok: false, problem: `Storey ${storey.id} room faces are stale or incomplete.` };
    for (const room of storey.rooms) {
      const match = derived.find((candidate) => boundaryKey(candidate.boundary) === boundaryKey(room.boundary));
      if (
        !match ||
        !finite(room.areaSqft) ||
        room.areaSqft <= 0 ||
        directedCycleKey(match.boundary) !== directedCycleKey(room.boundary) ||
        Math.abs(match.areaSqft - room.areaSqft) > 1e-6
      )
        return { ok: false, problem: `Room ${room.id} is not an exact face of the wall graph.` };
      if (globalIds.has(room.id)) return { ok: false, problem: `Duplicate graph id ${room.id}.` };
      globalIds.add(room.id);
    }
  }

  const levels = [...value.storeys].sort(
    (a, b) => a.elevationFt - b.elevationFt || a.id.localeCompare(b.id),
  );
  for (let index = 0; index < levels.length - 1; index += 1) {
    const lower = levels[index];
    const upper = levels[index + 1];
    if (lower.elevationFt + lower.heightFt > upper.elevationFt + EPS) {
      return {
        ok: false,
        problem: `Storeys ${lower.id} and ${upper.id} overlap vertically.`,
      };
    }
  }

  if (value.stairs !== undefined && !Array.isArray(value.stairs)) {
    return { ok: false, problem: "Building graph stairs must be an array." };
  }
  for (const stair of value.stairs ?? []) {
    if (!stair.id || globalIds.has(stair.id))
      return { ok: false, problem: `Duplicate or empty stair id ${stair.id}.` };
    globalIds.add(stair.id);
    const lower = value.storeys.find((storey) => storey.id === stair.fromStoreyId);
    const upper = value.storeys.find((storey) => storey.id === stair.toStoreyId);
    if (!lower || !upper || lower === upper || lower.elevationFt >= upper.elevationFt) {
      return { ok: false, problem: `Stair ${stair.id} has invalid connected storeys.` };
    }
    if (
      !finite(stair.start[0]) ||
      !finite(stair.start[1]) ||
      !finite(stair.end[0]) ||
      !finite(stair.end[1]) ||
      distance(stair.start, stair.end) <= EPS ||
      !finite(stair.widthFt) ||
      stair.widthFt <= 0
    ) {
      return { ok: false, problem: `Stair ${stair.id} has invalid flight geometry.` };
    }
    const opening = upper.voids.find((item) => item.id === stair.openingVoidId);
    if (!opening || !upper.slabs.some((slab) => slab.voidIds.includes(opening.id))) {
      return { ok: false, problem: `Stair ${stair.id} has no explicit opening in ${upper.id}.` };
    }
  }
  if (value.shafts !== undefined && !Array.isArray(value.shafts)) {
    return { ok: false, problem: "Building graph shafts must be an array." };
  }
  for (const shaft of value.shafts ?? []) {
    if (!shaft.id || globalIds.has(shaft.id))
      return { ok: false, problem: `Duplicate or empty shaft id ${shaft.id}.` };
    globalIds.add(shaft.id);
    const lower = value.storeys.find((storey) => storey.id === shaft.fromStoreyId);
    const upper = value.storeys.find((storey) => storey.id === shaft.toStoreyId);
    if (!lower || !upper || lower === upper || lower.elevationFt >= upper.elevationFt) {
      return { ok: false, problem: `Shaft ${shaft.id} has invalid connected storeys.` };
    }
    if (
      !finite(shaft.centre[0]) ||
      !finite(shaft.centre[1]) ||
      !finite(shaft.widthFt) ||
      !finite(shaft.depthFt) ||
      shaft.widthFt <= 0 ||
      shaft.depthFt <= 0
    ) {
      return { ok: false, problem: `Shaft ${shaft.id} has invalid footprint geometry.` };
    }
    const opening = upper.voids.find((item) => item.id === shaft.openingVoidId);
    if (!opening || !upper.slabs.some((slab) => slab.voidIds.includes(opening.id))) {
      return { ok: false, problem: `Shaft ${shaft.id} has no explicit opening in ${upper.id}.` };
    }
  }
  return { ok: true, graph: value };
}

export function singleStoreyGraphFromPolygon(
  input: readonly GraphPoint[],
  options: { storeyId?: string; heightFt?: number; wallThicknessFt?: number } = {},
): GraphFactoryResult {
  const points = input.map((point): GraphPoint => [point[0], point[1]]);
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
  if (points.length < 3) return { ok: false, problem: "A footprint needs at least three vertices." };
  if (points.some((point) => !finite(point[0]) || !finite(point[1])))
    return { ok: false, problem: "Footprint coordinates must be finite." };
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      if (samePoint(points[left], points[right]))
        return { ok: false, problem: "A footprint cannot repeat a vertex." };
    }
  }
  if (polygonSelfIntersects(points))
    return { ok: false, problem: "The footprint is self-intersecting." };
  const signedArea = polygonArea(points);
  if (Math.abs(signedArea) <= EPS) return { ok: false, problem: "The footprint has no area." };
  if (signedArea < 0) points.reverse();

  const storeyId = options.storeyId ?? "storey-1";
  const vertices = points.map((point, index): GraphVertex => ({
    id: `vertex-${index + 1}`,
    xFt: point[0],
    zFt: point[1],
  }));
  const walls = vertices.map((vertex, index): GraphWallEdge => ({
    id: `wall-${index + 1}`,
    startVertexId: vertex.id,
    endVertexId: vertices[(index + 1) % vertices.length].id,
    kind: "external",
    thicknessFt: options.wallThicknessFt ?? 0.5,
    openings: [],
  }));
  let storey: GraphStorey = {
    id: storeyId,
    name: "Ground floor",
    elevationFt: 0,
    heightFt: options.heightFt ?? 9.5,
    vertices,
    walls,
    rooms: [],
    slabs: [{ id: "slab-1", boundaryVertexIds: vertices.map((vertex) => vertex.id), voidIds: [] }],
    voids: [],
    roofZones: [],
  };
  storey = { ...storey, rooms: deriveRoomFaces(storey, []) };
  const graph: BuildingGraph = {
    kind: "building-graph",
    version: BUILDING_GRAPH_VERSION,
    units: "feet",
    storeys: [storey],
    stairs: [],
    shafts: [],
  };
  const checked = validateBuildingGraph(graph);
  return checked.ok ? { ok: true, graph } : checked;
}

export function moveGraphVertex(
  graph: BuildingGraph,
  storeyId: string,
  vertexId: string,
  point: GraphPoint,
  snapFt = 0,
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  if (!storey.vertices.some((vertex) => vertex.id === vertexId))
    return fail(graph, `Vertex ${vertexId} does not exist.`);
  if (!finite(point[0]) || !finite(point[1])) return fail(graph, "Vertex coordinates must be finite.");
  const snap = (value: number): number =>
    snapFt > EPS ? Math.round(value / snapFt) * snapFt : value;
  const vertices = storey.vertices.map((vertex) =>
    vertex.id === vertexId ? { ...vertex, xFt: snap(point[0]), zFt: snap(point[1]) } : vertex,
  );
  let candidateStorey = { ...storey, vertices };
  candidateStorey = { ...candidateStorey, rooms: deriveRoomFaces(candidateStorey, storey.rooms) };
  const candidate = graphWithStorey(graph, candidateStorey);
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

function insertBoundaryVertex(ids: readonly string[], start: string, end: string, inserted: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const current = ids[index];
    const next = ids[(index + 1) % ids.length];
    out.push(current);
    if ((current === start && next === end) || (current === end && next === start)) out.push(inserted);
  }
  return out;
}

function insertExtrudeIntoBoundary(
  ids: readonly string[],
  startId: string,
  endId: string,
  startOutId: string,
  endOutId: string,
): string[] {
  for (let index = 0; index < ids.length; index += 1) {
    const current = ids[index];
    const next = ids[(index + 1) % ids.length];
    if (current === startId && next === endId) {
      return [...ids.slice(0, index + 1), startOutId, endOutId, ...ids.slice(index + 1)];
    }
    if (current === endId && next === startId) {
      return [...ids.slice(0, index + 1), endOutId, startOutId, ...ids.slice(index + 1)];
    }
  }
  return [...ids];
}

/**
 * Push an exterior wall outward, growing the footprint. Two new vertices are
 * created; the original wall keeps its openings and becomes the new outer
 * run. Adjacent walls stay where they are. This is not two vertex moves —
 * moving the endpoints would shear the neighbouring walls.
 */
export function extrudeGraphWall(
  graph: BuildingGraph,
  storeyId: string,
  wallId: string,
  distanceFt: number,
  snapFt = 0,
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  const wall = storey.walls.find((item) => item.id === wallId);
  if (!wall) return fail(graph, `Wall ${wallId} does not exist.`);
  if (wall.kind !== "external") {
    return fail(graph, `Only an exterior wall can be extruded. ${wallId} is a partition.`);
  }
  const snap = (value: number): number =>
    snapFt > EPS ? Math.round(value / snapFt) * snapFt : value;
  const distance = snap(distanceFt);
  if (!finite(distance) || distance <= EPS) {
    return fail(graph, "An extrusion must move the wall a positive distance.");
  }

  const vertices = vertexMap(storey);
  const start = vertices.get(wall.startVertexId);
  const end = vertices.get(wall.endVertexId);
  if (!start || !end) return fail(graph, `Wall ${wallId} is missing an endpoint.`);
  const dx = end.xFt - start.xFt;
  const dz = end.zFt - start.zFt;
  const run = Math.hypot(dx, dz);
  if (run <= EPS) return fail(graph, `Wall ${wallId} has no direction to extrude along.`);
  /* Footprints are stored counter-clockwise. The outward normal is a clockwise
     quarter-turn of the wall direction. */
  const ox = (dz / run) * distance;
  const oz = (-dx / run) * distance;

  const used = new Set([
    ...storey.vertices.map((item) => item.id),
    ...storey.walls.map((item) => item.id),
  ]);
  const nextId = (prefix: string): string => {
    let n = 1;
    let id = `${prefix}-${n}`;
    while (used.has(id)) {
      n += 1;
      id = `${prefix}-${n}`;
    }
    used.add(id);
    return id;
  };
  const startOutId = nextId("vertex");
  const endOutId = nextId("vertex");
  const returnStartId = nextId("wall");
  const returnEndId = nextId("wall");

  const startOut: GraphVertex = {
    id: startOutId,
    xFt: start.xFt + ox,
    zFt: start.zFt + oz,
  };
  const endOut: GraphVertex = {
    id: endOutId,
    xFt: end.xFt + ox,
    zFt: end.zFt + oz,
  };

  const candidateStorey: GraphStorey = {
    ...storey,
    vertices: [...storey.vertices, startOut, endOut],
    walls: [
      ...storey.walls.filter((item) => item.id !== wallId),
      {
        id: returnStartId,
        startVertexId: wall.startVertexId,
        endVertexId: startOutId,
        kind: "external",
        thicknessFt: wall.thicknessFt,
        openings: [],
      },
      {
        ...wall,
        startVertexId: startOutId,
        endVertexId: endOutId,
      },
      {
        id: returnEndId,
        startVertexId: endOutId,
        endVertexId: wall.endVertexId,
        kind: "external",
        thicknessFt: wall.thicknessFt,
        openings: [],
      },
    ],
    slabs: storey.slabs.map((slab) => ({
      ...slab,
      boundaryVertexIds: insertExtrudeIntoBoundary(
        slab.boundaryVertexIds,
        wall.startVertexId,
        wall.endVertexId,
        startOutId,
        endOutId,
      ),
    })),
    voids: storey.voids.map((item) => ({
      ...item,
      boundaryVertexIds: insertExtrudeIntoBoundary(
        item.boundaryVertexIds,
        wall.startVertexId,
        wall.endVertexId,
        startOutId,
        endOutId,
      ),
    })),
    roofZones: storey.roofZones.map((zone) => ({
      ...zone,
      boundaryVertexIds: insertExtrudeIntoBoundary(
        zone.boundaryVertexIds,
        wall.startVertexId,
        wall.endVertexId,
        startOutId,
        endOutId,
      ),
    })),
    rooms: [],
  };
  const withRooms = { ...candidateStorey, rooms: deriveRoomFaces(candidateStorey, storey.rooms) };
  const candidate = graphWithStorey(graph, withRooms);
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

/**
 * Change a wall's thickness. Topology and openings stay put. Zero or
 * non-finite thickness is refused — the same rule validateBuildingGraph uses.
 */
export function setGraphWallThickness(
  graph: BuildingGraph,
  storeyId: string,
  wallId: string,
  thicknessFt: number,
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  const wall = storey.walls.find((item) => item.id === wallId);
  if (!wall) return fail(graph, `Wall ${wallId} does not exist.`);
  if (!finite(thicknessFt) || thicknessFt <= EPS) {
    return fail(graph, `Wall ${wallId} thickness must be greater than zero.`);
  }
  const snapped = Math.round(thicknessFt * 100) / 100;
  if (snapped === wall.thicknessFt) return { ok: true, graph };
  const candidate = graphWithStorey(graph, {
    ...storey,
    walls: storey.walls.map((item) => (item.id === wallId ? { ...item, thicknessFt: snapped } : item)),
  });
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

/**
 * Name a derived room face. Faces themselves are computed; this is the only
 * field a person authors. An empty name is refused. Topology is untouched.
 */
export function renameGraphRoom(
  graph: BuildingGraph,
  storeyId: string,
  roomId: string,
  name: string,
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  const room = storey.rooms.find((item) => item.id === roomId);
  if (!room) return fail(graph, `Room ${roomId} does not exist.`);
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return fail(graph, "A room needs a name.");
  if (trimmed.length > 40) return fail(graph, "Keep the room name short enough to read on the plan.");
  if (trimmed === room.name) return { ok: true, graph };
  const candidate = graphWithStorey(graph, {
    ...storey,
    rooms: storey.rooms.map((item) => (item.id === roomId ? { ...item, name: trimmed } : item)),
  });
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

export function splitWallAt(
  graph: BuildingGraph,
  storeyId: string,
  wallId: string,
  distanceFromStartFt: number,
  vertexId: string,
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  const wallIndex = storey.walls.findIndex((wall) => wall.id === wallId);
  const wall = storey.walls[wallIndex];
  if (!wall) return fail(graph, `Wall ${wallId} does not exist.`);
  if (!vertexId || storey.vertices.some((vertex) => vertex.id === vertexId))
    return fail(graph, `Vertex id ${vertexId} is empty or already exists.`);
  const length = wallLength(storey, wall);
  if (!finite(distanceFromStartFt) || distanceFromStartFt <= EPS || distanceFromStartFt >= length - EPS)
    return fail(graph, `Wall split must be strictly inside ${wallId}.`);

  const firstOpenings: GraphOpening[] = [];
  const secondOpenings: GraphOpening[] = [];
  for (const opening of wall.openings) {
    const end = opening.offsetFt + opening.widthFt;
    if (end <= distanceFromStartFt + EPS) firstOpenings.push(opening);
    else if (opening.offsetFt >= distanceFromStartFt - EPS) {
      secondOpenings.push({ ...opening, offsetFt: opening.offsetFt - distanceFromStartFt });
    } else {
      return fail(
        graph,
        `Opening ${opening.id} crosses the proposed split on ${wallId}; move the split or the opening.`,
      );
    }
  }

  const verticesById = vertexMap(storey);
  const start = verticesById.get(wall.startVertexId)!;
  const end = verticesById.get(wall.endVertexId)!;
  const ratio = distanceFromStartFt / length;
  const inserted: GraphVertex = {
    id: vertexId,
    xFt: start.xFt + (end.xFt - start.xFt) * ratio,
    zFt: start.zFt + (end.zFt - start.zFt) * ratio,
  };
  let secondWallId = `${wall.id}-split-${vertexId}`;
  let suffix = 2;
  while (storey.walls.some((item) => item.id === secondWallId)) {
    secondWallId = `${wall.id}-split-${vertexId}-${suffix}`;
    suffix += 1;
  }
  const firstWall: GraphWallEdge = {
    ...wall,
    endVertexId: vertexId,
    openings: firstOpenings,
  };
  const secondWall: GraphWallEdge = {
    ...wall,
    id: secondWallId,
    startVertexId: vertexId,
    openings: secondOpenings,
  };
  const walls = [...storey.walls];
  walls.splice(wallIndex, 1, firstWall, secondWall);
  let candidateStorey: GraphStorey = {
    ...storey,
    vertices: [...storey.vertices, inserted],
    walls,
    slabs: storey.slabs.map((slab) => ({
      ...slab,
      boundaryVertexIds: insertBoundaryVertex(
        slab.boundaryVertexIds,
        wall.startVertexId,
        wall.endVertexId,
        vertexId,
      ),
    })),
    voids: storey.voids.map((voidFace) => ({
      ...voidFace,
      boundaryVertexIds: insertBoundaryVertex(
        voidFace.boundaryVertexIds,
        wall.startVertexId,
        wall.endVertexId,
        vertexId,
      ),
    })),
    roofZones: storey.roofZones.map((zone) => ({
      ...zone,
      boundaryVertexIds: insertBoundaryVertex(
        zone.boundaryVertexIds,
        wall.startVertexId,
        wall.endVertexId,
        vertexId,
      ),
    })),
  };
  candidateStorey = { ...candidateStorey, rooms: deriveRoomFaces(candidateStorey, storey.rooms) };
  const candidate = graphWithStorey(graph, candidateStorey);
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

export function addPartitionEdge(
  graph: BuildingGraph,
  storeyId: string,
  wallId: string,
  startVertexId: string,
  endVertexId: string,
  thicknessFt = 0.4,
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  const vertices = vertexMap(storey);
  const start = vertices.get(startVertexId);
  const end = vertices.get(endVertexId);
  if (!wallId || storey.walls.some((wall) => wall.id === wallId))
    return fail(graph, `Partition id ${wallId} is empty or already exists.`);
  if (!start || !end || start.id === end.id) return fail(graph, "Partition endpoints must be distinct graph vertices.");
  if (!finite(thicknessFt) || thicknessFt <= 0) return fail(graph, "Partition thickness must be positive.");
  const footprint = storey.slabs[0]?.boundaryVertexIds.map((id) => pointOf(vertices.get(id)!)) ?? [];
  for (const fraction of [0.25, 0.5, 0.75]) {
    const sample: GraphPoint = [
      start.xFt + (end.xFt - start.xFt) * fraction,
      start.zFt + (end.zFt - start.zFt) * fraction,
    ];
    if (!pointInPolygon(sample, footprint))
      return fail(graph, `Partition ${wallId} leaves the storey footprint.`);
  }
  let candidateStorey: GraphStorey = {
    ...storey,
    walls: [
      ...storey.walls,
      {
        id: wallId,
        startVertexId,
        endVertexId,
        kind: "partition",
        thicknessFt,
        openings: [],
      },
    ],
  };
  const rooms = deriveRoomFaces(candidateStorey, storey.rooms);
  if (rooms.length !== storey.rooms.length + 1)
    return fail(graph, `Partition ${wallId} does not divide exactly one existing room.`);
  candidateStorey = { ...candidateStorey, rooms };
  const candidate = graphWithStorey(graph, candidateStorey);
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

export function addGraphOpening(
  graph: BuildingGraph,
  storeyId: string,
  wallId: string,
  opening: GraphOpening,
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  const wall = storey.walls.find((item) => item.id === wallId);
  if (!wall) return fail(graph, `Wall ${wallId} does not exist.`);
  if (storey.walls.some((item) => item.openings.some((candidate) => candidate.id === opening.id)))
    return fail(graph, `Opening id ${opening.id} already exists.`);
  const candidateStorey = {
    ...storey,
    walls: storey.walls.map((item) =>
      item.id === wallId ? { ...item, openings: [...item.openings, { ...opening }] } : item,
    ),
  };
  const candidate = graphWithStorey(graph, candidateStorey);
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

/**
 * Change one opening's box on its host wall. Topology stays put. Zero or
 * non-finite dimensions are refused; hanging off the wall or overlapping a
 * neighbour is refused by `validateBuildingGraph` in the same words the
 * add-and-split path already uses.
 */
export function setGraphOpening(
  graph: BuildingGraph,
  storeyId: string,
  wallId: string,
  openingId: string,
  box: { offsetFt: number; widthFt: number; sillFt: number; heightFt: number },
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  const wall = storey.walls.find((item) => item.id === wallId);
  if (!wall) return fail(graph, `Wall ${wallId} does not exist.`);
  const opening = wall.openings.find((item) => item.id === openingId);
  if (!opening) return fail(graph, `Opening ${openingId} does not exist on ${wallId}.`);
  const snapped = {
    offsetFt: Math.round(box.offsetFt * 100) / 100,
    widthFt: Math.round(box.widthFt * 100) / 100,
    sillFt: Math.round(box.sillFt * 100) / 100,
    heightFt: Math.round(box.heightFt * 100) / 100,
  };
  if (
    !finite(snapped.offsetFt) ||
    !finite(snapped.widthFt) ||
    !finite(snapped.sillFt) ||
    !finite(snapped.heightFt)
  ) {
    return fail(graph, `Opening ${openingId} needs finite offset, width, sill and height.`);
  }
  if (snapped.widthFt <= EPS || snapped.heightFt <= EPS) {
    return fail(graph, `Opening ${openingId} width and height must be greater than zero.`);
  }
  if (
    snapped.offsetFt === opening.offsetFt &&
    snapped.widthFt === opening.widthFt &&
    snapped.sillFt === opening.sillFt &&
    snapped.heightFt === opening.heightFt
  ) {
    return { ok: true, graph };
  }
  const candidateStorey = {
    ...storey,
    walls: storey.walls.map((item) =>
      item.id === wallId
        ? {
            ...item,
            openings: item.openings.map((candidate) =>
              candidate.id === openingId ? { ...candidate, ...snapped } : candidate,
            ),
          }
        : item,
    ),
  };
  const candidate = graphWithStorey(graph, candidateStorey);
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

/** Same buildable step `scenarios.ts` uses so a graph move and a spec move
 *  cannot disagree about what "60% of this opening" lands on. */
const GRAPH_STEP_FT = 0.25;
const stepGraphDown = (value: number): number => Math.floor(value / GRAPH_STEP_FT) * GRAPH_STEP_FT;
const spansOverlap = (a0: number, a1: number, b0: number, b1: number): boolean =>
  Math.min(a1, b1) - Math.max(a0, b0) > 1e-9;
const isGlazedOpening = (opening: GraphOpening): boolean => opening.kind !== "door";

/**
 * Every glazed opening scaled on its host wall. Doors stay put — they still
 * act as obstacles — matching `scaleGlass` in scenarios.ts so the Impact
 * panel and the co-pilot write the same house they already write for a spec.
 *
 * Height first, then width, each clamped to the storey head / wall run and
 * to the first neighbour in that direction. A failed validation returns the
 * input graph unchanged.
 */
export function scaleGraphOpenings(graph: BuildingGraph, factor: number): GraphMutation {
  if (!finite(factor) || factor <= 0) return fail(graph, "Opening scale factor must be positive.");
  const grow = factor > 1;
  const storeys = graph.storeys.map((storey) => {
    const head = storey.heightFt;
    return {
      ...storey,
      walls: storey.walls.map((wall) => {
        const run = wallLength(storey, wall);
        if (!finite(run)) return wall;

        const heights = wall.openings.map((opening) => {
          if (!isGlazedOpening(opening)) return opening.heightFt;
          if (!grow) {
            return Math.min(
              opening.heightFt,
              Math.max(GRAPH_STEP_FT, stepGraphDown(opening.heightFt * factor)),
            );
          }
          let ceiling = head;
          for (const other of wall.openings) {
            if (other === opening) continue;
            const above = other.sillFt >= opening.sillFt + opening.heightFt - 1e-9;
            if (!above) continue;
            if (
              spansOverlap(
                opening.offsetFt,
                opening.offsetFt + opening.widthFt,
                other.offsetFt,
                other.offsetFt + other.widthFt,
              )
            ) {
              ceiling = Math.min(ceiling, other.sillFt);
            }
          }
          const room = ceiling - opening.sillFt;
          return Math.max(opening.heightFt, Math.min(stepGraphDown(opening.heightFt * factor), room));
        });

        const widths = wall.openings.map((opening, index) => {
          if (!isGlazedOpening(opening)) return opening.widthFt;
          if (!grow) {
            return Math.min(
              opening.widthFt,
              Math.max(GRAPH_STEP_FT, stepGraphDown(opening.widthFt * factor)),
            );
          }
          const y0 = opening.sillFt;
          const y1 = opening.sillFt + heights[index];
          let edge = run;
          wall.openings.forEach((other, otherIndex) => {
            if (otherIndex === index) return;
            const right = other.offsetFt >= opening.offsetFt + opening.widthFt - 1e-9;
            if (!right) return;
            const oy0 = other.sillFt;
            const oy1 = other.sillFt + heights[otherIndex];
            if (spansOverlap(y0, y1, oy0, oy1)) edge = Math.min(edge, other.offsetFt);
          });
          const room = edge - opening.offsetFt;
          return Math.max(opening.widthFt, Math.min(stepGraphDown(opening.widthFt * factor), room));
        });

        return {
          ...wall,
          openings: wall.openings.map((opening, index) => ({
            ...opening,
            widthFt: widths[index],
            heightFt: heights[index],
          })),
        };
      }),
    };
  });
  const candidate: BuildingGraph = { ...graph, storeys };
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

const scalePoint = (point: GraphPoint, factor: number): GraphPoint => [
  point[0] * factor,
  point[1] * factor,
];

/**
 * Similarity about the site origin. Vertices, stairs, shafts and roof
 * guides scale; openings keep their modelled sizes so the glass stays the
 * glass that was drawn while the wall denominator grows — the same
 * contract `scaleFootprint` keeps for a rectangular spec.
 */
export function scaleGraphPlan(graph: BuildingGraph, factor: number): GraphMutation {
  if (!finite(factor) || factor <= 0) return fail(graph, "Plan scale factor must be positive.");
  if (factor === 1) return { ok: true, graph };
  const storeys = graph.storeys.map((storey) => {
    const vertices = storey.vertices.map((vertex) => ({
      ...vertex,
      xFt: vertex.xFt * factor,
      zFt: vertex.zFt * factor,
    }));
    const roofZones = storey.roofZones.map((zone) => ({
      ...zone,
      fallVector: zone.fallVector ? scalePoint(zone.fallVector, factor) : zone.fallVector,
      ridge: zone.ridge
        ? { start: scalePoint(zone.ridge.start, factor), end: scalePoint(zone.ridge.end, factor) }
        : zone.ridge,
    }));
    const next: GraphStorey = { ...storey, vertices, roofZones };
    return { ...next, rooms: deriveRoomFaces(next, storey.rooms) };
  });
  const stairs = graph.stairs?.map((stair) => ({
    ...stair,
    start: scalePoint(stair.start, factor),
    end: scalePoint(stair.end, factor),
    widthFt: Math.max(stair.widthFt, stepGraphDown(stair.widthFt * factor)),
  }));
  const shafts = graph.shafts?.map((shaft) => ({
    ...shaft,
    centre: scalePoint(shaft.centre, factor),
    widthFt: Math.max(shaft.widthFt, stepGraphDown(shaft.widthFt * factor)),
    depthFt: Math.max(shaft.depthFt, stepGraphDown(shaft.depthFt * factor)),
  }));
  const candidate: BuildingGraph = {
    ...graph,
    storeys,
    ...(stairs ? { stairs } : {}),
    ...(shafts ? { shafts } : {}),
  };
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

const rotatePoint = (point: GraphPoint, cos: number, sin: number): GraphPoint => [
  point[0] * cos - point[1] * sin,
  point[0] * sin + point[1] * cos,
];

/**
 * Rotation about the site origin. Vertices, stairs, shafts and roof guides
 * turn; openings stay wall-relative so they come with the walls. Same
 * contract `rotateHome` keeps for a rectangular spec: the glass does not
 * change size, only which way the house faces.
 */
export function rotateGraphPlan(graph: BuildingGraph, deg: number): GraphMutation {
  if (!finite(deg)) return fail(graph, "Plan rotation must be a finite number of degrees.");
  const turns = ((deg % 360) + 360) % 360;
  if (turns === 0) return { ok: true, graph };
  const radians = (turns * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const storeys = graph.storeys.map((storey) => {
    const vertices = storey.vertices.map((vertex) => {
      const [xFt, zFt] = rotatePoint([vertex.xFt, vertex.zFt], cos, sin);
      return { ...vertex, xFt, zFt };
    });
    const roofZones = storey.roofZones.map((zone) => ({
      ...zone,
      fallVector: zone.fallVector ? rotatePoint(zone.fallVector, cos, sin) : zone.fallVector,
      ridge: zone.ridge
        ? { start: rotatePoint(zone.ridge.start, cos, sin), end: rotatePoint(zone.ridge.end, cos, sin) }
        : zone.ridge,
    }));
    const next: GraphStorey = { ...storey, vertices, roofZones };
    return { ...next, rooms: deriveRoomFaces(next, storey.rooms) };
  });
  const stairs = graph.stairs?.map((stair) => ({
    ...stair,
    start: rotatePoint(stair.start, cos, sin),
    end: rotatePoint(stair.end, cos, sin),
  }));
  const shafts = graph.shafts?.map((shaft) => ({
    ...shaft,
    centre: rotatePoint(shaft.centre, cos, sin),
  }));
  const candidate: BuildingGraph = {
    ...graph,
    storeys,
    ...(stairs ? { stairs } : {}),
    ...(shafts ? { shafts } : {}),
  };
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

/**
 * Stretch about the plan centroid: X × kx and Z × kz. Area is preserved when
 * kx × kz = 1. Openings stay wall-relative; a wall that becomes shorter than
 * its glass is refused by validation rather than silently trimmed.
 */
export function stretchGraphPlan(graph: BuildingGraph, kx: number, kz: number): GraphMutation {
  if (!finite(kx) || !finite(kz) || kx <= 0 || kz <= 0) {
    return fail(graph, "Plan stretch factors must be positive.");
  }
  if (kx === 1 && kz === 1) return { ok: true, graph };
  const vertices = graph.storeys.flatMap((storey) => storey.vertices);
  if (vertices.length === 0) return fail(graph, "There is no plan to stretch.");
  const minX = Math.min(...vertices.map((vertex) => vertex.xFt));
  const maxX = Math.max(...vertices.map((vertex) => vertex.xFt));
  const minZ = Math.min(...vertices.map((vertex) => vertex.zFt));
  const maxZ = Math.max(...vertices.map((vertex) => vertex.zFt));
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const stretchPoint = (point: GraphPoint): GraphPoint => [
    cx + (point[0] - cx) * kx,
    cz + (point[1] - cz) * kz,
  ];
  const storeys = graph.storeys.map((storey) => {
    const nextVertices = storey.vertices.map((vertex) => {
      const [xFt, zFt] = stretchPoint([vertex.xFt, vertex.zFt]);
      return { ...vertex, xFt, zFt };
    });
    const roofZones = storey.roofZones.map((zone) => ({
      ...zone,
      /* The tuple has to be written as a tuple. An array literal widens to
         number[], which `GraphPoint` — a readonly two-element tuple — will not
         accept, and the loss is not cosmetic: a fall vector with one element
         or three is a roof that slopes nowhere or in a direction the renderer
         cannot read. `stretchPoint` is not reusable here because a fall vector
         is a DIRECTION, not a position: it scales but must not be translated
         about the centroid the way a vertex is. */
      fallVector: zone.fallVector
        ? ([zone.fallVector[0] * kx, zone.fallVector[1] * kz] as GraphPoint)
        : zone.fallVector,
      ridge: zone.ridge
        ? { start: stretchPoint(zone.ridge.start), end: stretchPoint(zone.ridge.end) }
        : zone.ridge,
    }));
    const next: GraphStorey = { ...storey, vertices: nextVertices, roofZones };
    return { ...next, rooms: deriveRoomFaces(next, storey.rooms) };
  });
  const stairs = graph.stairs?.map((stair) => ({
    ...stair,
    start: stretchPoint(stair.start),
    end: stretchPoint(stair.end),
  }));
  const shafts = graph.shafts?.map((shaft) => ({
    ...shaft,
    centre: stretchPoint(shaft.centre),
    widthFt: shaft.widthFt * kx,
    depthFt: shaft.depthFt * kz,
  }));
  const candidate: BuildingGraph = {
    ...graph,
    storeys,
    ...(stairs ? { stairs } : {}),
    ...(shafts ? { shafts } : {}),
  };
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

/** Duplicate one complete planar level, aligned in the shared site frame. */
export function duplicateGraphStorey(
  graph: BuildingGraph,
  sourceStoreyId: string,
  options: DuplicateStoreyOptions,
): GraphMutation {
  const source = graph.storeys.find((storey) => storey.id === sourceStoreyId);
  if (!source) return fail(graph, `Storey ${sourceStoreyId} does not exist.`);
  if (!options.id || graph.storeys.some((storey) => storey.id === options.id))
    return fail(graph, `Storey id ${options.id} is empty or already exists.`);
  if (!finite(options.elevationFt) || !finite(options.heightFt ?? source.heightFt) || (options.heightFt ?? source.heightFt) <= 0)
    return fail(graph, "Duplicated storey levels must be finite and its height must be positive.");

  const vertexIds = new Map(source.vertices.map((vertex) => [vertex.id, `${options.id}:${vertex.id}`]));
  const wallIds = new Map(source.walls.map((wall) => [wall.id, `${options.id}:${wall.id}`]));
  const voidIds = new Map(source.voids.map((item) => [item.id, `${options.id}:${item.id}`]));
  let duplicated: GraphStorey = {
    id: options.id,
    name: options.name,
    elevationFt: options.elevationFt,
    heightFt: options.heightFt ?? source.heightFt,
    vertices: source.vertices.map((vertex) => ({ ...vertex, id: vertexIds.get(vertex.id)! })),
    walls: source.walls.map((wall) => ({
      ...wall,
      id: wallIds.get(wall.id)!,
      startVertexId: vertexIds.get(wall.startVertexId)!,
      endVertexId: vertexIds.get(wall.endVertexId)!,
      openings: wall.openings.map((opening) => ({
        ...opening,
        id: `${options.id}:${opening.id}`,
      })),
    })),
    rooms: [],
    slabs: source.slabs.map((slab) => ({
      ...slab,
      id: `${options.id}:${slab.id}`,
      boundaryVertexIds: slab.boundaryVertexIds.map((id) => vertexIds.get(id)!),
      voidIds: slab.voidIds.map((id) => voidIds.get(id)!),
    })),
    voids: source.voids.map((item) => ({
      ...item,
      id: voidIds.get(item.id)!,
      boundaryVertexIds: item.boundaryVertexIds.map((id) => vertexIds.get(id)!),
    })),
    roofZones: source.roofZones.map((zone) => ({
      ...zone,
      id: `${options.id}:${zone.id}`,
      boundaryVertexIds: zone.boundaryVertexIds.map((id) => vertexIds.get(id)!),
    })),
  };
  duplicated = { ...duplicated, rooms: deriveRoomFaces(duplicated, []) };
  const sourceWithoutRoof = { ...source, roofZones: [] };
  const candidate: BuildingGraph = {
    ...graph,
    storeys: [
      ...graph.storeys.map((storey) => (storey.id === source.id ? sourceWithoutRoof : storey)),
      duplicated,
    ].sort((a, b) => a.elevationFt - b.elevationFt || a.id.localeCompare(b.id)),
    stairs: [...(graph.stairs ?? [])],
    shafts: [...(graph.shafts ?? [])],
  };
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

export function setGraphStoreyLevels(
  graph: BuildingGraph,
  storeyId: string,
  levels: { elevationFt?: number; heightFt?: number },
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  const elevationFt = levels.elevationFt ?? storey.elevationFt;
  const heightFt = levels.heightFt ?? storey.heightFt;
  if (!finite(elevationFt) || !finite(heightFt) || heightFt <= 0)
    return fail(graph, "Storey elevation must be finite and height must be positive.");
  const candidate = graphWithStorey(graph, { ...storey, elevationFt, heightFt });
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

function stairRectangle(input: GraphStairInput): GraphPoint[] | null {
  const dx = input.end[0] - input.start[0];
  const dz = input.end[1] - input.start[1];
  const run = Math.hypot(dx, dz);
  if (run <= EPS || input.widthFt <= 0) return null;
  const px = (-dz / run) * (input.widthFt / 2);
  const pz = (dx / run) * (input.widthFt / 2);
  return [
    [input.start[0] + px, input.start[1] + pz],
    [input.end[0] + px, input.end[1] + pz],
    [input.end[0] - px, input.end[1] - pz],
    [input.start[0] - px, input.start[1] - pz],
  ];
}

/** Add one design-intent stair and the explicit void it requires above. */
export function addGraphStair(graph: BuildingGraph, input: GraphStairInput): GraphMutation {
  if (!input.id || (graph.stairs ?? []).some((stair) => stair.id === input.id))
    return fail(graph, `Stair id ${input.id} is empty or already exists.`);
  if (
    !finite(input.start[0]) ||
    !finite(input.start[1]) ||
    !finite(input.end[0]) ||
    !finite(input.end[1]) ||
    !finite(input.widthFt)
  ) {
    return fail(graph, "Stair geometry must be finite.");
  }
  const lower = graph.storeys.find((storey) => storey.id === input.fromStoreyId);
  const upper = graph.storeys.find((storey) => storey.id === input.toStoreyId);
  if (!lower || !upper || lower.elevationFt >= upper.elevationFt)
    return fail(graph, "A stair must connect an existing lower storey to an existing upper storey.");
  const rectangle = stairRectangle(input);
  if (!rectangle) return fail(graph, "A stair needs a positive run and width.");
  const lowerSlab = lower.slabs.find((slab) => {
    const polygon = boundaryPointsForStorey(lower, slab.boundaryVertexIds);
    return rectangle.every((item) => pointInPolygon(item, polygon));
  });
  const upperSlab = upper.slabs.find((slab) => {
    const polygon = boundaryPointsForStorey(upper, slab.boundaryVertexIds);
    return rectangle.every((item) => pointInPolygon(item, polygon));
  });
  if (!lowerSlab || !upperSlab)
    return fail(graph, "The complete stair and upper opening must fit inside aligned floor plates.");
  for (const existing of upper.voids) {
    const polygon = boundaryPointsForStorey(upper, existing.boundaryVertexIds);
    if (
      rectangle.some((item) => pointInPolygon(item, polygon)) ||
      polygon.some((item) => pointInPolygon(item, rectangle))
    ) {
      return fail(graph, `The stair opening overlaps void ${existing.id}.`);
    }
  }

  const openingVoidId = `${input.id}:opening`;
  const vertexIds = rectangle.map((_, index) => `${input.id}:opening:vertex-${index + 1}`);
  const candidateUpper: GraphStorey = {
    ...upper,
    vertices: [
      ...upper.vertices,
      ...rectangle.map(([xFt, zFt], index): GraphVertex => ({ id: vertexIds[index], xFt, zFt })),
    ],
    voids: [
      ...upper.voids,
      { id: openingVoidId, boundaryVertexIds: vertexIds },
    ],
    slabs: upper.slabs.map((slab) =>
      slab.id === upperSlab.id ? { ...slab, voidIds: [...slab.voidIds, openingVoidId] } : slab,
    ),
  };
  const candidate: BuildingGraph = {
    ...graphWithStorey(graph, candidateUpper),
    stairs: [
      ...(graph.stairs ?? []),
      {
        id: input.id,
        fromStoreyId: input.fromStoreyId,
        toStoreyId: input.toStoreyId,
        start: [...input.start] as GraphPoint,
        end: [...input.end] as GraphPoint,
        widthFt: input.widthFt,
        openingVoidId,
      },
    ],
  };
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

/** Add a rectangular design-intent service shaft with an explicit upper void. */
export function addGraphShaft(graph: BuildingGraph, input: GraphShaftInput): GraphMutation {
  if (!input.id || (graph.shafts ?? []).some((shaft) => shaft.id === input.id))
    return fail(graph, `Shaft id ${input.id} is empty or already exists.`);
  if (
    !finite(input.centre[0]) ||
    !finite(input.centre[1]) ||
    !finite(input.widthFt) ||
    !finite(input.depthFt) ||
    input.widthFt <= 0 ||
    input.depthFt <= 0
  ) {
    return fail(graph, "A shaft needs a finite centre and positive dimensions.");
  }
  const lower = graph.storeys.find((storey) => storey.id === input.fromStoreyId);
  const upper = graph.storeys.find((storey) => storey.id === input.toStoreyId);
  if (!lower || !upper || lower.elevationFt >= upper.elevationFt)
    return fail(graph, "A shaft must connect an existing lower storey to an existing upper storey.");
  const halfWidth = input.widthFt / 2;
  const halfDepth = input.depthFt / 2;
  const rectangle: GraphPoint[] = [
    [input.centre[0] - halfWidth, input.centre[1] - halfDepth],
    [input.centre[0] + halfWidth, input.centre[1] - halfDepth],
    [input.centre[0] + halfWidth, input.centre[1] + halfDepth],
    [input.centre[0] - halfWidth, input.centre[1] + halfDepth],
  ];
  const fits = (storey: GraphStorey) =>
    storey.slabs.find((slab) => {
      const polygon = boundaryPointsForStorey(storey, slab.boundaryVertexIds);
      return rectangle.every((item) => pointInPolygon(item, polygon));
    });
  const lowerSlab = fits(lower);
  const upperSlab = fits(upper);
  if (!lowerSlab || !upperSlab)
    return fail(graph, "The complete service shaft must fit inside aligned floor plates.");
  for (const existing of upper.voids) {
    const polygon = boundaryPointsForStorey(upper, existing.boundaryVertexIds);
    if (
      rectangle.some((item) => pointInPolygon(item, polygon)) ||
      polygon.some((item) => pointInPolygon(item, rectangle))
    ) {
      return fail(graph, `The shaft opening overlaps void ${existing.id}.`);
    }
  }
  const openingVoidId = `${input.id}:opening`;
  const vertexIds = rectangle.map((_, index) => `${input.id}:opening:vertex-${index + 1}`);
  const candidateUpper: GraphStorey = {
    ...upper,
    vertices: [
      ...upper.vertices,
      ...rectangle.map(([xFt, zFt], index): GraphVertex => ({ id: vertexIds[index], xFt, zFt })),
    ],
    voids: [...upper.voids, { id: openingVoidId, boundaryVertexIds: vertexIds }],
    slabs: upper.slabs.map((slab) =>
      slab.id === upperSlab.id ? { ...slab, voidIds: [...slab.voidIds, openingVoidId] } : slab,
    ),
  };
  const candidate: BuildingGraph = {
    ...graphWithStorey(graph, candidateUpper),
    shafts: [
      ...(graph.shafts ?? []),
      {
        id: input.id,
        fromStoreyId: input.fromStoreyId,
        toStoreyId: input.toStoreyId,
        centre: [...input.centre] as GraphPoint,
        widthFt: input.widthFt,
        depthFt: input.depthFt,
        openingVoidId,
      },
    ],
  };
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

function boundaryPointsForStorey(storey: GraphStorey, ids: readonly string[]): GraphPoint[] {
  const vertices = vertexMap(storey);
  return ids.map((id) => vertices.get(id)).filter((item): item is GraphVertex => !!item).map(pointOf);
}

function roomPolygon(storey: GraphStorey, room: GraphRoomFace): GraphPoint[] {
  const walls = new Map(storey.walls.map((wall) => [wall.id, wall]));
  const vertices = vertexMap(storey);
  return room.boundary
    .map((edge) => {
      const wall = walls.get(edge.wallId);
      if (!wall) return null;
      const id = edge.forward ? wall.startVertexId : wall.endVertexId;
      const vertex = vertices.get(id);
      return vertex ? pointOf(vertex) : null;
    })
    .filter((item): item is GraphPoint => item !== null);
}

function isConvexPolygon(polygon: readonly GraphPoint[]): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const value = cross(polygon[index], polygon[(index + 1) % polygon.length], polygon[(index + 2) % polygon.length]);
    if (Math.abs(value) <= EPS) continue;
    const next = Math.sign(value);
    if (sign !== 0 && sign !== next) return false;
    sign = next;
  }
  return true;
}

function lineIntersection(a: GraphPoint, b: GraphPoint, c: GraphPoint, d: GraphPoint): GraphPoint {
  const ab: GraphPoint = [b[0] - a[0], b[1] - a[1]];
  const cd: GraphPoint = [d[0] - c[0], d[1] - c[1]];
  const denominator = ab[0] * cd[1] - ab[1] * cd[0];
  if (Math.abs(denominator) <= EPS) return b;
  const delta: GraphPoint = [c[0] - a[0], c[1] - a[1]];
  const t = (delta[0] * cd[1] - delta[1] * cd[0]) / denominator;
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}

function convexIntersection(subject: GraphPoint[], clip: readonly GraphPoint[]): GraphPoint[] {
  let output = subject;
  const orientation = polygonArea(clip) >= 0 ? 1 : -1;
  for (let index = 0; index < clip.length; index += 1) {
    const a = clip[index];
    const b = clip[(index + 1) % clip.length];
    const input = output;
    output = [];
    for (let itemIndex = 0; itemIndex < input.length; itemIndex += 1) {
      const current = input[itemIndex];
      const previous = input[(itemIndex + input.length - 1) % input.length];
      const currentInside = cross(a, b, current) * orientation >= -EPS;
      const previousInside = cross(a, b, previous) * orientation >= -EPS;
      if (currentInside) {
        if (!previousInside) output.push(lineIntersection(previous, current, a, b));
        output.push(current);
      } else if (previousInside) {
        output.push(lineIntersection(previous, current, a, b));
      }
    }
    if (output.length === 0) break;
  }
  return output;
}

/** Exact overlap relationships for adjacent convex room faces; complex faces are left unclaimed. */
export function deriveStackedRoomRelationships(
  graph: BuildingGraph,
): GraphStackedRoomRelationship[] {
  const storeys = [...graph.storeys].sort(
    (a, b) => a.elevationFt - b.elevationFt || a.id.localeCompare(b.id),
  );
  const relationships: GraphStackedRoomRelationship[] = [];
  for (let index = 0; index < storeys.length - 1; index += 1) {
    const lower = storeys[index];
    const upper = storeys[index + 1];
    for (const lowerRoom of lower.rooms) {
      const lowerPolygon = roomPolygon(lower, lowerRoom);
      if (!isConvexPolygon(lowerPolygon)) continue;
      for (const upperRoom of upper.rooms) {
        const upperPolygon = roomPolygon(upper, upperRoom);
        if (!isConvexPolygon(upperPolygon)) continue;
        const overlap = convexIntersection([...lowerPolygon], upperPolygon);
        const overlapSqft = Math.round(Math.abs(polygonArea(overlap)) * 1e6) / 1e6;
        if (overlapSqft <= EPS) continue;
        relationships.push({
          lowerStoreyId: lower.id,
          lowerRoomId: lowerRoom.id,
          upperStoreyId: upper.id,
          upperRoomId: upperRoom.id,
          overlapSqft,
        });
      }
    }
  }
  return relationships;
}

function polygonCentroid(points: readonly GraphPoint[]): GraphPoint {
  let crossSum = 0;
  let x = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const term = a[0] * b[1] - b[0] * a[1];
    crossSum += term;
    x += (a[0] + b[0]) * term;
    z += (a[1] + b[1]) * term;
  }
  return [x / (3 * crossSum), z / (3 * crossSum)];
}

function linePolygonIntersections(
  origin: GraphPoint,
  direction: GraphPoint,
  polygon: readonly GraphPoint[],
): Array<{ point: GraphPoint; t: number }> {
  const found: Array<{ point: GraphPoint; t: number }> = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const edge: GraphPoint = [b[0] - a[0], b[1] - a[1]];
    const denominator = direction[0] * edge[1] - direction[1] * edge[0];
    if (Math.abs(denominator) <= EPS) continue;
    const delta: GraphPoint = [a[0] - origin[0], a[1] - origin[1]];
    const t = (delta[0] * edge[1] - delta[1] * edge[0]) / denominator;
    const u = (delta[0] * direction[1] - delta[1] * direction[0]) / denominator;
    if (u < -EPS || u > 1 + EPS) continue;
    const point: GraphPoint = [origin[0] + direction[0] * t, origin[1] + direction[1] * t];
    if (!found.some((item) => samePoint(item.point, point))) found.push({ point, t });
  }
  return found.sort((a, b) => a.t - b.t);
}

export function deriveRoofZone(
  storey: GraphStorey,
  form: GraphRoofForm,
  pitchDeg: number,
): RoofZoneResult {
  const vertices = vertexMap(storey);
  const boundaryIds = storey.slabs[0]?.boundaryVertexIds ?? [];
  const polygon = boundaryIds.map((id) => vertices.get(id)).filter((value): value is GraphVertex => !!value).map(pointOf);
  if (polygon.length < 3) return { ok: false, problem: "A roof zone needs a valid slab boundary." };
  if (!finite(pitchDeg) || pitchDeg < 0 || (form !== "flat" && pitchDeg <= 0))
    return { ok: false, problem: `${form} roof pitch must be ${form === "flat" ? "zero or positive" : "positive"}.` };
  const base: GraphRoofZone = {
    id: `roof-${storey.id}-${form}`,
    form,
    boundaryVertexIds: [...boundaryIds],
    pitchDeg,
  };
  if (form === "flat") return { ok: true, zone: base };
  if (form === "hipped") {
    if (!isConvexPolygon(polygon)) {
      return {
        ok: false,
        problem:
          "A single automatic hipped roof only fits a convex zone. Define explicit roof zones for this concave footprint instead of inventing joins.",
      };
    }
    return { ok: true, zone: base };
  }

  const external = storey.walls
    .filter((wall) => wall.kind === "external")
    .map((wall) => ({ wall, length: wallLength(storey, wall) }))
    .sort((a, b) => b.length - a.length || a.wall.id.localeCompare(b.wall.id));
  const longest = external[0]?.wall;
  if (!longest) return { ok: false, problem: "A pitched roof needs an external wall direction." };
  const start = vertices.get(longest.startVertexId)!;
  const end = vertices.get(longest.endVertexId)!;
  const run = distance(pointOf(start), pointOf(end));
  const direction: GraphPoint = [(end.xFt - start.xFt) / run, (end.zFt - start.zFt) / run];
  const cleanZero = (value: number): number => (Math.abs(value) <= EPS ? 0 : value);
  const fallVector: GraphPoint = [cleanZero(-direction[1]), cleanZero(direction[0])];
  if (form === "shed") return { ok: true, zone: { ...base, fallVector } };

  const intersections = linePolygonIntersections(polygonCentroid(polygon), direction, polygon);
  if (intersections.length !== 2) {
    return {
      ok: false,
      problem:
        "A single deterministic gable ridge does not fit this concave footprint. Define explicit roof zones instead of inventing joins.",
    };
  }
  return {
    ok: true,
    zone: {
      ...base,
      ridge: { start: intersections[0].point, end: intersections[1].point },
    },
  };
}

/**
 * Replace one storey's authored roof zones with a single derived zone.
 * Saltbox and a-frame stay spec-only — they are not GraphRoofForm values.
 */
export function setGraphRoofForm(
  graph: BuildingGraph,
  storeyId: string,
  form: GraphRoofForm,
  pitchDeg?: number,
): GraphMutation {
  const storey = graph.storeys.find((item) => item.id === storeyId);
  if (!storey) return fail(graph, `Storey ${storeyId} does not exist.`);
  const current = storey.roofZones[0];
  const pitch =
    pitchDeg ??
    (form === "flat" ? 0 : current && current.form !== "flat" && current.pitchDeg > 0 ? current.pitchDeg : 30);
  const derived = deriveRoofZone(storey, form, pitch);
  if (!derived.ok) return fail(graph, derived.problem);
  if (
    storey.roofZones.length === 1 &&
    current &&
    current.form === derived.zone.form &&
    current.pitchDeg === derived.zone.pitchDeg &&
    JSON.stringify(current.ridge) === JSON.stringify(derived.zone.ridge) &&
    JSON.stringify(current.fallVector) === JSON.stringify(derived.zone.fallVector)
  ) {
    return { ok: true, graph };
  }
  const candidate = graphWithStorey(graph, { ...storey, roofZones: [derived.zone] });
  const checked = validateBuildingGraph(candidate);
  return checked.ok ? { ok: true, graph: candidate } : fail(graph, checked.problem);
}

const LEGACY_WALL_ORDER: readonly Wall[] = ["n", "e", "s", "w"];

function legacyVolumeCorners(volume: Volume): GraphPoint[] {
  const radians = (-volume.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const halfWidth = volume.widthFt / 2;
  const halfDepth = volume.depthFt / 2;
  return [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ].map(([x, z]): GraphPoint => [
    volume.x + x * cosine + z * sine,
    volume.z - x * sine + z * cosine,
  ]);
}

/**
 * Loss-aware bridge from Claude-era rotated rectangles into one ground-floor
 * planar graph. It refuses multi-storey volumes because flattening them would
 * erase intermediate plates. The original HomeSpec always rides beside a
 * successful conversion for recovery.
 */
export function legacySpecToBuildingGraph(
  spec: HomeSpec,
  wallThicknessFt: number,
): LegacyGraphConversion {
  if (!finite(wallThicknessFt) || wallThicknessFt <= 0)
    return { ok: false, problem: "Legacy conversion needs a positive wall thickness." };
  if (spec.volumes.length === 0)
    return { ok: false, problem: "The legacy design has no volume to convert." };
  if (spec.volumes.some((volume) => volume.storeys !== 1)) {
    return {
      ok: false,
      problem:
        "This legacy design contains multi-storey intent. Conversion is refused until intermediate floor plates, stairs and openings can be preserved.",
    };
  }

  const warnings: string[] = [];
  if (spec.deck) {
    warnings.push(
      "The legacy deck remains in the recovery HomeSpec; deck topology is not yet part of BuildingGraph v1.",
    );
  }
  const heights = new Set(spec.volumes.map((volume) => volume.wallHeightFt));
  if (heights.size > 1) {
    warnings.push(
      "Legacy volumes had different wall heights. BuildingGraph v1 uses the tallest height for this storey and preserves every original height in the recovery HomeSpec.",
    );
  }

  const vertices: GraphVertex[] = [];
  const walls: GraphWallEdge[] = [];
  const slabs: GraphSlab[] = [];
  const roofZones: GraphRoofZone[] = [];
  for (const volume of spec.volumes) {
    const corners = legacyVolumeCorners(volume);
    const volumeVertices = corners.map((point, index): GraphVertex => ({
      id: `vol:${volume.id}:vertex:${index + 1}`,
      xFt: Math.abs(point[0]) <= EPS ? 0 : point[0],
      zFt: Math.abs(point[1]) <= EPS ? 0 : point[1],
    }));
    vertices.push(...volumeVertices);
    const volumeWalls = LEGACY_WALL_ORDER.map((legacyWall, index): GraphWallEdge => {
      const start = corners[index];
      const end = corners[(index + 1) % corners.length];
      const fullLength = distance(start, end);
      const endInset = legacyWall === "e" || legacyWall === "w" ? wallThicknessFt : 0;
      const openings = volume.openings
        .filter((opening) => opening.wall === legacyWall)
        .map((opening): GraphOpening => ({
          id: `vol:${volume.id}:opening:${opening.id}`,
          kind: opening.kind,
          // HomeSpec offsets run from outside-left; the CCW graph edge runs
          // the other way on all four faces.
          offsetFt: fullLength - endInset - opening.offsetFt - opening.widthFt,
          widthFt: opening.widthFt,
          heightFt: opening.heightFt,
          sillFt: opening.sillFt,
        }));
      return {
        id: `vol:${volume.id}:wall:${legacyWall}`,
        startVertexId: volumeVertices[index].id,
        endVertexId: volumeVertices[(index + 1) % volumeVertices.length].id,
        kind: "external",
        thicknessFt: wallThicknessFt,
        openings,
      };
    });
    walls.push(...volumeWalls);
    const slab: GraphSlab = {
      id: `vol:${volume.id}:slab:1`,
      boundaryVertexIds: volumeVertices.map((vertex) => vertex.id),
      voidIds: [],
    };
    slabs.push(slab);

    if (["gable", "shed", "flat"].includes(volume.roof.form)) {
      const roofStorey: GraphStorey = {
        id: `roof-source:${volume.id}`,
        name: volume.name,
        elevationFt: 0,
        heightFt: volume.wallHeightFt,
        vertices: volumeVertices,
        walls: volumeWalls,
        rooms: [],
        slabs: [slab],
        voids: [],
        roofZones: [],
      };
      const roof = deriveRoofZone(
        roofStorey,
        volume.roof.form as GraphRoofForm,
        volume.roof.pitchDeg,
      );
      if (roof.ok) roofZones.push({ ...roof.zone, id: `vol:${volume.id}:roof:1` });
      else warnings.push(`${volume.name}: ${roof.problem}`);
    } else {
      warnings.push(
        `${volume.name}: ${volume.roof.form} roof intent remains only in the recovery HomeSpec until an explicit planar roof zone can preserve it.`,
      );
    }
  }

  let storey: GraphStorey = {
    id: "storey-1",
    name: "Ground floor",
    elevationFt: 0,
    heightFt: Math.max(...spec.volumes.map((volume) => volume.wallHeightFt)),
    vertices,
    walls,
    rooms: [],
    slabs,
    voids: [],
    roofZones,
  };
  storey = { ...storey, rooms: deriveRoomFaces(storey, []) };
  storey = {
    ...storey,
    rooms: storey.rooms.map((room) => {
      const volume = spec.volumes.find((candidate) =>
        room.boundary.every((edge) => edge.wallId.startsWith(`vol:${candidate.id}:wall:`)),
      );
      return volume ? { ...room, name: volume.name } : room;
    }),
  };
  const graph: BuildingGraph = {
    kind: "building-graph",
    version: BUILDING_GRAPH_VERSION,
    units: "feet",
    storeys: [storey],
    stairs: [],
    shafts: [],
  };
  const checked = validateBuildingGraph(graph);
  if (!checked.ok) {
    return {
      ok: false,
      problem:
        `The legacy rectangles cannot be represented as one planar graph without repair: ${checked.problem} ` +
        "The source HomeSpec was not changed.",
    };
  }
  return {
    ok: true,
    graph,
    legacyRecovery: JSON.parse(JSON.stringify(spec)) as HomeSpec,
    warnings,
  };
}
