import * as THREE from "three";

import type {
  BuildingGraph,
  GraphPoint,
  GraphRoofZone,
  GraphStorey,
  GraphVertex,
} from "./buildingGraph";
import {
  disposeHome,
  type HomeGeometry,
  type Part,
  type PlanBounds,
  type Pt2,
  type SiteSummary,
  type VolumeGeometry,
  type VolumeSummary,
} from "./geometry";

const FLOOR_THICKNESS_FT = 0.35;
const ROOF_THICKNESS_FT = 0.3;
const OPENING_FILL_THICKNESS_FT = 0.08;
const EPS = 1e-7;

const point = (vertex: GraphVertex): GraphPoint => [vertex.xFt, vertex.zFt];
const areaOf = (points: readonly GraphPoint[]): number => {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    twice += points[index][0] * points[next][1] - points[next][0] * points[index][1];
  }
  return Math.abs(twice) / 2;
};

const vertexMap = (storey: GraphStorey): Map<string, GraphVertex> =>
  new Map(storey.vertices.map((vertex) => [vertex.id, vertex]));

function boundaryPoints(storey: GraphStorey, ids: readonly string[]): GraphPoint[] {
  const vertices = vertexMap(storey);
  return ids.map((id) => vertices.get(id)).filter((item): item is GraphVertex => !!item).map(point);
}

function boundsOf(graph: BuildingGraph): PlanBounds {
  const vertices = graph.storeys.flatMap((storey) => storey.vertices);
  if (vertices.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, widthFt: 0, depthFt: 0 };
  }
  const minX = Math.min(...vertices.map((vertex) => vertex.xFt));
  const maxX = Math.max(...vertices.map((vertex) => vertex.xFt));
  const minZ = Math.min(...vertices.map((vertex) => vertex.zFt));
  const maxZ = Math.max(...vertices.map((vertex) => vertex.zFt));
  return { minX, maxX, minZ, maxZ, widthFt: maxX - minX, depthFt: maxZ - minZ };
}

function voidArea(storey: GraphStorey, voidIds: readonly string[]): number {
  const wanted = new Set(voidIds);
  return storey.voids
    .filter((item) => wanted.has(item.id))
    .reduce((sum, item) => sum + areaOf(boundaryPoints(storey, item.boundaryVertexIds)), 0);
}

function slabArea(storey: GraphStorey): number {
  return storey.slabs.reduce(
    (sum, slab) =>
      sum + areaOf(boundaryPoints(storey, slab.boundaryVertexIds)) - voidArea(storey, slab.voidIds),
    0,
  );
}

function distanceToLine(pointValue: GraphPoint, a: GraphPoint, b: GraphPoint): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const run = Math.hypot(dx, dz);
  return run <= EPS
    ? 0
    : Math.abs(dx * (a[1] - pointValue[1]) - (a[0] - pointValue[0]) * dz) / run;
}

function roofPeak(storey: GraphStorey, zone: GraphRoofZone): number {
  const eave = storey.elevationFt + storey.heightFt;
  const points = boundaryPoints(storey, zone.boundaryVertexIds);
  const pitch = Math.tan((zone.pitchDeg * Math.PI) / 180);
  if (zone.form === "gable" && zone.ridge) {
    const span = Math.max(...points.map((item) => distanceToLine(item, zone.ridge!.start, zone.ridge!.end)), 0);
    return eave + span * pitch;
  }
  if (zone.form === "hipped") {
    const centre: GraphPoint = [
      points.reduce((sum, item) => sum + item[0], 0) / points.length,
      points.reduce((sum, item) => sum + item[1], 0) / points.length,
    ];
    const inset = Math.min(
      ...points.map((item, index) =>
        distanceToLine(centre, item, points[(index + 1) % points.length]),
      ),
    );
    return eave + inset * pitch;
  }
  if (zone.form === "shed" && zone.fallVector) {
    const length = Math.hypot(zone.fallVector[0], zone.fallVector[1]) || 1;
    const projections = points.map(
      (item) => (item[0] * zone.fallVector![0] + item[1] * zone.fallVector![1]) / length,
    );
    return eave + (Math.max(...projections) - Math.min(...projections)) * pitch;
  }
  return eave + ROOF_THICKNESS_FT;
}

/** Exterior wall area the glazing ratio uses: each wall's run times its storey
 *  height. Openings are not subtracted — the same convention
 *  `modelledWallAreaSqFt` keeps for a rectangular spec. */
export function modelledGraphWallAreaSqFt(graph: BuildingGraph): number {
  return graph.storeys.reduce((sum, storey) => {
    const vertices = vertexMap(storey);
    return (
      sum +
      storey.walls.reduce((wallSum, wall) => {
        const start = vertices.get(wall.startVertexId);
        const end = vertices.get(wall.endVertexId);
        if (!start || !end) return wallSum;
        return wallSum + Math.hypot(end.xFt - start.xFt, end.zFt - start.zFt) * storey.heightFt;
      }, 0)
    );
  }, 0);
}

/** Graph analogue of `modelledGlazingRatio`: glass over modelled wall area. */
export function modelledGraphGlazingRatio(graph: BuildingGraph): number {
  const wall = modelledGraphWallAreaSqFt(graph);
  return wall > 0 ? summarizeBuildingGraph(graph).glazedAreaSqFt / wall : 0;
}

/** Exact graph-owned areas and bounds used by the renderer, readout and quote handoff. */
export function summarizeBuildingGraph(graph: BuildingGraph): SiteSummary {
  const volumes: VolumeSummary[] = graph.storeys.map((storey) => {
    const plan = boundaryPoints(storey, storey.slabs[0]?.boundaryVertexIds ?? []) as Pt2[];
    const footprintSqFt = slabArea(storey);
    return {
      id: storey.id,
      name: storey.name,
      ridgeHeightFt: Math.max(
        storey.elevationFt + storey.heightFt,
        ...storey.roofZones.map((zone) => roofPeak(storey, zone)),
      ),
      footprintSqFt,
      eaveHeightFt: storey.elevationFt + storey.heightFt,
      plan,
    };
  });
  const bounds = boundsOf(graph);
  const groundElevation = Math.min(...graph.storeys.map((storey) => storey.elevationFt));
  const groundFootprintSqFt = graph.storeys
    .filter((storey) => Math.abs(storey.elevationFt - groundElevation) <= EPS)
    .reduce((sum, storey) => sum + slabArea(storey), 0);
  return {
    volumes,
    bounds,
    boundsWithRoof: bounds,
    maxRidgeHeightFt: Math.max(...volumes.map((volume) => volume.ridgeHeightFt), 0),
    overlaps: [],
    hasOverlap: false,
    overlapAreaSqFt: 0,
    totalFloorAreaSqFt: graph.storeys.reduce((sum, storey) => sum + slabArea(storey), 0),
    groundFootprintSqFt,
    glazedAreaSqFt: graph.storeys.reduce(
      (sum, storey) =>
        sum +
        storey.walls.reduce(
          (wallSum, wall) =>
            wallSum +
            wall.openings
              .filter((opening) => opening.kind !== "door")
              .reduce((openingSum, opening) => openingSum + opening.widthFt * opening.heightFt, 0),
          0,
        ),
      0,
    ),
  };
}

function boxPart(
  storey: GraphStorey,
  id: string,
  surface: Part["surface"],
  width: number,
  height: number,
  depth: number,
  centre: readonly [number, number, number],
  yaw: number,
  openingId?: string,
): Part | null {
  if (width <= EPS || height <= EPS || depth <= EPS) return null;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.rotateY(yaw);
  geometry.translate(centre[0], centre[1], centre[2]);
  return { id, surface, volumeId: storey.id, openingId, geometry };
}

function wallParts(storey: GraphStorey): Part[] {
  const vertices = vertexMap(storey);
  const parts: Part[] = [];
  for (const wall of storey.walls) {
    const start = vertices.get(wall.startVertexId)!;
    const end = vertices.get(wall.endVertexId)!;
    const dx = end.xFt - start.xFt;
    const dz = end.zFt - start.zFt;
    const length = Math.hypot(dx, dz);
    const ux = dx / length;
    const uz = dz / length;
    const yaw = -Math.atan2(dz, dx);
    const cuts = Array.from(
      new Set([
        0,
        length,
        ...wall.openings.flatMap((opening) => [opening.offsetFt, opening.offsetFt + opening.widthFt]),
      ]),
    )
      .sort((a, b) => a - b);
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const from = cuts[index];
      const to = cuts[index + 1];
      const mid = (from + to) / 2;
      const opening = wall.openings.find(
        (candidate) => mid > candidate.offsetFt - EPS && mid < candidate.offsetFt + candidate.widthFt + EPS,
      );
      const spans = opening
        ? [
            { from: 0, to: opening.sillFt },
            { from: opening.sillFt + opening.heightFt, to: storey.heightFt },
          ]
        : [{ from: 0, to: storey.heightFt }];
      for (const span of spans) {
        const part = boxPart(
          storey,
          `${wall.id}:shell:${index}:${span.from}`,
          "wall",
          to - from,
          span.to - span.from,
          wall.thicknessFt,
          [
            start.xFt + ux * ((from + to) / 2),
            storey.elevationFt + (span.from + span.to) / 2,
            start.zFt + uz * ((from + to) / 2),
          ],
          yaw,
        );
        if (part) parts.push(part);
      }
    }
    for (const opening of wall.openings) {
      const middle = opening.offsetFt + opening.widthFt / 2;
      const fill = boxPart(
        storey,
        `${wall.id}:opening:${opening.id}`,
        opening.kind === "door" ? "door" : "glass",
        opening.widthFt,
        opening.heightFt,
        OPENING_FILL_THICKNESS_FT,
        [
          start.xFt + ux * middle,
          storey.elevationFt + opening.sillFt + opening.heightFt / 2,
          start.zFt + uz * middle,
        ],
        yaw,
        opening.id,
      );
      if (fill) parts.push(fill);
    }
  }
  return parts;
}

function shapeFromBoundary(storey: GraphStorey, ids: readonly string[]): THREE.Shape {
  const points = boundaryPoints(storey, ids);
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => (index === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
  shape.closePath();
  return shape;
}

function floorParts(storey: GraphStorey): Part[] {
  return storey.slabs.map((slab) => {
    const shape = shapeFromBoundary(storey, slab.boundaryVertexIds);
    for (const voidId of slab.voidIds) {
      const face = storey.voids.find((item) => item.id === voidId);
      if (!face) continue;
      const hole = new THREE.Path();
      boundaryPoints(storey, face.boundaryVertexIds).forEach(([x, z], index) =>
        index === 0 ? hole.moveTo(x, z) : hole.lineTo(x, z),
      );
      hole.closePath();
      shape.holes.push(hole);
    }
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: FLOOR_THICKNESS_FT,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, storey.elevationFt, 0);
    return {
      id: `${storey.id}:floor:${slab.id}`,
      surface: "floor" as const,
      volumeId: storey.id,
      geometry,
    };
  });
}

function indexedGeometry(vertices: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function projectToSegment(value: GraphPoint, start: GraphPoint, end: GraphPoint): GraphPoint {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq <= EPS ? 0 : Math.max(0, Math.min(1, ((value[0] - start[0]) * dx + (value[1] - start[1]) * dz) / lengthSq));
  return [start[0] + dx * t, start[1] + dz * t];
}

function roofPart(storey: GraphStorey, zone: GraphRoofZone): Part | null {
  const boundary = boundaryPoints(storey, zone.boundaryVertexIds);
  if (boundary.length < 3) return null;
  const eave = storey.elevationFt + storey.heightFt;
  const pitch = Math.tan((zone.pitchDeg * Math.PI) / 180);
  if (zone.form === "hipped") {
    const peak = roofPeak(storey, zone);
    const centre: GraphPoint = [
      boundary.reduce((sum, item) => sum + item[0], 0) / boundary.length,
      boundary.reduce((sum, item) => sum + item[1], 0) / boundary.length,
    ];
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index < boundary.length; index += 1) {
      const a = boundary[index];
      const b = boundary[(index + 1) % boundary.length];
      const base = vertices.length / 3;
      vertices.push(a[0], eave, a[1], b[0], eave, b[1], centre[0], peak, centre[1]);
      indices.push(base, base + 1, base + 2);
    }
    return {
      id: `${storey.id}:roof:${zone.id}`,
      surface: "roof",
      volumeId: storey.id,
      geometry: indexedGeometry(vertices, indices),
    };
  }
  if (zone.form === "gable" && zone.ridge) {
    const peak = roofPeak(storey, zone);
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index < boundary.length; index += 1) {
      const a = boundary[index];
      const b = boundary[(index + 1) % boundary.length];
      const pa = projectToSegment(a, zone.ridge.start, zone.ridge.end);
      const pb = projectToSegment(b, zone.ridge.start, zone.ridge.end);
      if (areaOf([a, b, pb, pa]) <= EPS) continue;
      const base = vertices.length / 3;
      vertices.push(a[0], eave, a[1], b[0], eave, b[1], pb[0], peak, pb[1], pa[0], peak, pa[1]);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return {
      id: `${storey.id}:roof:${zone.id}`,
      surface: "roof",
      volumeId: storey.id,
      geometry: indexedGeometry(vertices, indices),
    };
  }

  const shape = new THREE.Shape(boundary.map(([x, z]) => new THREE.Vector2(x, z)));
  const geometry = new THREE.ShapeGeometry(shape);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const direction = zone.fallVector ?? ([0, 0] as const);
  const directionLength = Math.hypot(direction[0], direction[1]) || 1;
  const projections = boundary.map(
    ([x, z]) => (x * direction[0] + z * direction[1]) / directionLength,
  );
  const minimum = Math.min(...projections, 0);
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getY(index);
    const rise =
      zone.form === "shed"
        ? (((x * direction[0] + z * direction[1]) / directionLength) - minimum) * pitch
        : ROOF_THICKNESS_FT;
    positions.setXYZ(index, x, eave + rise, z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return {
    id: `${storey.id}:roof:${zone.id}`,
    surface: "roof",
    volumeId: storey.id,
    geometry,
  };
}

function stairParts(graph: BuildingGraph, storey: GraphStorey): Part[] {
  const parts: Part[] = [];
  for (const stair of graph.stairs ?? []) {
    if (stair.fromStoreyId !== storey.id) continue;
    const upper = graph.storeys.find((item) => item.id === stair.toStoreyId);
    if (!upper) continue;
    const dx = stair.end[0] - stair.start[0];
    const dz = stair.end[1] - stair.start[1];
    const run = Math.hypot(dx, dz);
    const rise = upper.elevationFt - storey.elevationFt;
    if (run <= EPS || rise <= EPS) continue;
    const count = Math.max(3, Math.ceil(rise / (7.5 / 12)));
    const treadRun = run / count;
    const ux = dx / run;
    const uz = dz / run;
    const yaw = -Math.atan2(dz, dx);
    for (let index = 0; index < count; index += 1) {
      const height = (rise * (index + 1)) / count;
      const along = treadRun * (index + 0.5);
      const part = boxPart(
        storey,
        `${stair.id}:tread:${index + 1}`,
        "floor",
        treadRun,
        height,
        stair.widthFt,
        [
          stair.start[0] + ux * along,
          storey.elevationFt + height / 2,
          stair.start[1] + uz * along,
        ],
        yaw,
      );
      if (part) parts.push(part);
    }
  }
  return parts;
}

/** Build a HomeGeometry-compatible export root directly from the graph. */
export function buildGraphHome(graph: BuildingGraph): HomeGeometry {
  const summary = summarizeBuildingGraph(graph);
  const warnings: string[] = [];
  const volumes: VolumeGeometry[] = graph.storeys.map((storey) => {
    const roofParts = storey.roofZones.map((zone) => roofPart(storey, zone)).filter((item): item is Part => !!item);
    const cappedByStorey = graph.storeys.some(
      (candidate) =>
        candidate.id !== storey.id &&
        candidate.elevationFt >= storey.elevationFt + storey.heightFt - EPS,
    );
    if (storey.roofZones.length === 0 && !cappedByStorey) {
      warnings.push(`${storey.name}: no explicit roof zone is defined; the walls remain open at the top.`);
    }
    const summaryVolume = summary.volumes.find((volume) => volume.id === storey.id)!;
    return {
      id: storey.id,
      name: storey.name,
      origin: [0, 0, 0] as const,
      rotationY: 0,
      wallThicknessFt: Math.max(...storey.walls.map((wall) => wall.thicknessFt), 0.5),
      eaveHeightFt: storey.elevationFt + storey.heightFt,
      ridgeHeightFt: summaryVolume.ridgeHeightFt,
      builtPitchDeg: storey.roofZones[0]?.pitchDeg ?? 0,
      roofThicknessFt: ROOF_THICKNESS_FT,
      parts: [...floorParts(storey), ...wallParts(storey), ...roofParts, ...stairParts(graph, storey)],
    };
  });
  return { volumes, deck: null, summary, warnings };
}

export function disposeGraphHome(home: HomeGeometry | null | undefined): void {
  disposeHome(home);
}
