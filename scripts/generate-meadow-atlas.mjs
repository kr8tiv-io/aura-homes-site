#!/usr/bin/env node

/**
 * Aura Homes progressive meadow atlas.
 *
 * This is an OFFLINE build tool. It authors the cutout texture and the fixed
 * instance table checked into public/textures; the browser only fetches those
 * bytes. No canvas, random source, or whole-field construction is required at
 * runtime.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
/* The built world's footprints come from the same module the runtime mask
   reads. Node type-strips this .ts import directly; the module is pure data
   for exactly that reason. */
import { TUB_CENTER, TUB_RADIUS, UNIT_RECT } from "../src/three/meadow-v1/meadow/geometry.ts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = fileURLToPath(import.meta.url);
const textureDir = path.join(appRoot, "public", "textures");
const imagePath = path.join(textureDir, "meadow-atlas.png");
const binaryPath = path.join(textureDir, "meadow-atlas.bin");
const metadataPath = path.join(textureDir, "meadow-atlas.json");

const SCHEMA = "ProgressiveMeadowMappedAtlasV6";
const WIDTH = 1_024;
const HEIGHT = 512;
const COLUMNS = 4;
const ROWS = 2;
const CELL_WIDTH = WIDTH / COLUMNS;
const CELL_HEIGHT = HEIGHT / ROWS;
const SUPERSAMPLE = 2;
const MAGIC = "AURAMDW1";
const VERSION = 1;
const STRIDE_BYTES = 48;
const GRASS_INSTANCES = 2_800;
const FLOWER_INSTANCES = 800;
const ALPHA_CUTOFF = 0.42;
const ANGULAR_LEAF_FACETS = true;
const ANGULAR_LEAF_WIDTH_SCALE = 1.24;
const GRASS_PROFILE = "asymmetric-fan-v1";
const LONGITUDINAL_MIDRIBS = true;
const SEED = 0xa117a5;

const CELLS = [
  { id: "grass-arching", kind: "grass", column: 0, row: 0, blades: 18, fans: 2, heightMin: 0.25, heightMax: 0.55, spread: 0.32, widthMin: 2.5, widthMax: 4.6, seedHeads: 1, seed: 11 },
  { id: "grass-fine", kind: "grass", column: 1, row: 0, blades: 22, fans: 3, heightMin: 0.29, heightMax: 0.61, spread: 0.24, widthMin: 1.9, widthMax: 3.3, seedHeads: 1, seed: 23 },
  { id: "grass-seed", kind: "grass", column: 2, row: 0, blades: 16, fans: 2, heightMin: 0.25, heightMax: 0.52, spread: 0.3, widthMin: 2.5, widthMax: 4.4, seedHeads: 2, seed: 37 },
  { id: "grass-tuft", kind: "grass", column: 3, row: 0, blades: 20, fans: 3, heightMin: 0.24, heightMax: 0.5, spread: 0.34, widthMin: 2.7, widthMax: 4.8, seedHeads: 1, seed: 53 },
  { id: "grass-sedge", kind: "grass", column: 0, row: 1, blades: 18, fans: 2, heightMin: 0.28, heightMax: 0.56, spread: 0.27, widthMin: 2.2, widthMax: 3.9, seedHeads: 1, seed: 71 },
  { id: "grass-wild", kind: "grass", column: 1, row: 1, blades: 19, fans: 3, heightMin: 0.25, heightMax: 0.58, spread: 0.31, widthMin: 2.2, widthMax: 4.3, seedHeads: 2, seed: 89 },
  { id: "flower-yarrow", kind: "flower", column: 2, row: 1, blades: 16, fans: 2, heightMin: 0.28, heightMax: 0.64, spread: 0.2, widthMin: 1.7, widthMax: 3.4, seedHeads: 0, seed: 107 },
  { id: "flower-aster", kind: "flower", column: 3, row: 1, blades: 15, fans: 2, heightMin: 0.28, heightMax: 0.65, spread: 0.22, widthMin: 1.7, widthMax: 3.5, seedHeads: 0, seed: 131 },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth01 = (a, b, value) => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function random(index, salt = 0) {
  const value = Math.sin((index + SEED) * 127.1 + salt * 311.7) * 43_758.5453;
  return value - Math.floor(value);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function paintDisc(surface, cx, cy, radius, color) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(surface.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(surface.height - 1, Math.ceil(cy + radius));
  const radiusSquared = radius * radius;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const offset = (y * surface.width + x) * 4;
      surface.data[offset] = color[0];
      surface.data[offset + 1] = color[1];
      surface.data[offset + 2] = color[2];
      surface.data[offset + 3] = 255;
    }
  }
}

function paintTriangle(surface, a, b, c, color) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(surface.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(surface.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const edge = (p0, p1, x, y) => (x - p0[0]) * (p1[1] - p0[1]) - (y - p0[1]) * (p1[0] - p0[0]);
  const winding = edge(a, b, c[0], c[1]);
  if (Math.abs(winding) < 0.0001) return;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const e0 = edge(a, b, px, py);
      const e1 = edge(b, c, px, py);
      const e2 = edge(c, a, px, py);
      if (winding > 0 ? e0 < 0 || e1 < 0 || e2 < 0 : e0 > 0 || e1 > 0 || e2 > 0) continue;
      const offset = (y * surface.width + x) * 4;
      surface.data[offset] = color[0];
      surface.data[offset + 1] = color[1];
      surface.data[offset + 2] = color[2];
      surface.data[offset + 3] = 255;
    }
  }
}

function quadraticPoint(points, t) {
  const mt = 1 - t;
  return [
    mt * mt * points[0][0] + 2 * mt * t * points[1][0] + t * t * points[2][0],
    mt * mt * points[0][1] + 2 * mt * t * points[1][1] + t * t * points[2][1],
  ];
}

/** Offline low-poly ribbons. Each blade gets independently seeded stations
 * and diagonal facets, so its matte structure survives mipmapping without the
 * synchronized horizontal barcode produced by R03C. */
function paintAngularBlade(surface, points, baseRadius, bottom, top, seed) {
  const segmentCount = 9 + Math.floor(random(seed, 31) * 4);
  const stations = [];
  for (let index = 0; index <= segmentCount; index += 1) {
    const baseT = index / segmentCount;
    const jitter = index === 0 || index === segmentCount
      ? 0
      : (random(seed, 40 + index) - 0.5) * (0.36 / segmentCount);
    const t = clamp01(baseT + jitter);
    const point = quadraticPoint(points, t);
    const before = quadraticPoint(points, Math.max(0, t - 0.015));
    const after = quadraticPoint(points, Math.min(1, t + 0.015));
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.max(0.0001, Math.hypot(dx, dy));
    const halfWidth = Math.max(1.15 * SUPERSAMPLE, baseRadius * ANGULAR_LEAF_WIDTH_SCALE * (1 - t * 0.82));
    const nx = -dy / length;
    const ny = dx / length;
    stations.push({
      t,
      centre: point,
      left: [point[0] + nx * halfWidth, point[1] + ny * halfWidth],
      right: [point[0] - nx * halfWidth, point[1] - ny * halfWidth],
      normal: [nx, ny],
      halfWidth,
    });
  }

  for (let index = 0; index < stations.length - 1; index += 1) {
    const current = stations[index];
    const next = stations[index + 1];
    const midT = (current.t + next.t) * 0.5;
    const variation = (random(seed, 80 + index) - 0.5) * 0.14;
    const split = 0.15 + random(seed, 100 + index) * 0.1;
    const darkT = clamp01(midT + variation - split);
    const lightT = clamp01(midT + variation + split);
    const darkColor = [mix(bottom[0], top[0], darkT), mix(bottom[1], top[1], darkT), mix(bottom[2], top[2], darkT)];
    const lightColor = [mix(bottom[0], top[0], lightT), mix(bottom[1], top[1], lightT), mix(bottom[2], top[2], lightT)];
    if (random(seed, 120 + index) < 0.5) {
      paintTriangle(surface, current.left, current.right, next.left, darkColor);
      paintTriangle(surface, current.right, next.right, next.left, lightColor);
    } else {
      paintTriangle(surface, current.left, current.right, next.right, lightColor);
      paintTriangle(surface, current.left, next.right, next.left, darkColor);
    }
  }

  // A restrained midrib gives broad fan leaves natural longitudinal detail.
  // It is painted strictly inside the existing opaque silhouette, so it only
  // changes RGB and cannot inflate atlas alpha coverage.
  if (LONGITUDINAL_MIDRIBS && random(seed, 170) > 0.24) {
    const offsetRatio = (random(seed, 171) - 0.5) * 0.12;
    const veinColor = random(seed, 172) < 0.5 ? [45, 78, 42] : [151, 177, 103];
    const veinEdges = (station, index) => {
      const wander = offsetRatio + (random(seed, 190 + index) - 0.5) * 0.035;
      const cx = station.centre[0] + station.normal[0] * station.halfWidth * wander;
      const cy = station.centre[1] + station.normal[1] * station.halfWidth * wander;
      const half = Math.min(station.halfWidth * 0.22, 0.7 * SUPERSAMPLE);
      return {
        left: [cx + station.normal[0] * half, cy + station.normal[1] * half],
        right: [cx - station.normal[0] * half, cy - station.normal[1] * half],
      };
    };
    for (let index = 1; index < stations.length - 2; index += 1) {
      const current = veinEdges(stations[index], index);
      const next = veinEdges(stations[index + 1], index + 1);
      paintTriangle(surface, current.left, current.right, next.left, veinColor);
      paintTriangle(surface, current.right, next.right, next.left, veinColor);
    }
  }
}

function paintFlower(surface, x, y, radius, variant, seed) {
  const petal = variant === 0 ? [239, 231, 198] : [184, 169, 199];
  const centre = variant === 0 ? [210, 177, 80] : [225, 190, 94];
  const petals = variant === 0 ? 7 : 8;
  for (let index = 0; index < petals; index += 1) {
    const angle = (index / petals) * Math.PI * 2 + random(seed, index) * 0.16;
    paintDisc(
      surface,
      x + Math.cos(angle) * radius * 0.78,
      y + Math.sin(angle) * radius * 0.78,
      radius * 0.68,
      petal,
    );
  }
  paintDisc(surface, x, y, radius * 0.62, centre);
}

function paintCell(surface, cell) {
  const left = cell.column * CELL_WIDTH * SUPERSAMPLE;
  const top = cell.row * CELL_HEIGHT * SUPERSAMPLE;
  const cellW = CELL_WIDTH * SUPERSAMPLE;
  const cellH = CELL_HEIGHT * SUPERSAMPLE;
  const baseY = top + cellH * 0.93;
  const dark = [54, 92, 49];
  const light = [135, 168, 91];

  for (let blade = 0; blade < cell.blades; blade += 1) {
    const key = cell.seed * 10_007 + blade;
    const fanIndex = blade % cell.fans;
    const orderInFan = Math.floor(blade / cell.fans);
    const bladesInFan = Math.ceil((cell.blades - fanIndex) / cell.fans);
    const fanPhase = bladesInFan <= 1 ? 0 : (orderInFan / (bladesInFan - 1)) * 2 - 1;
    const fanCentre = cell.fans === 1 ? 0.5 : 0.22 + (fanIndex / (cell.fans - 1)) * 0.56;
    const rootX = left + cellW * (fanCentre + (random(key, 1) - 0.5) * 0.065);
    const isSeedHead = cell.kind === "grass" && blade < cell.seedHeads;
    const heightRatio = isSeedHead
      ? Math.min(0.7, cell.heightMax + 0.07 + random(key, 2) * 0.04)
      : cell.heightMin + random(key, 2) * (cell.heightMax - cell.heightMin);
    const height = cellH * heightRatio;
    const lean = (fanPhase * cell.spread + (random(key, 3) - 0.5) * 0.075) * cellW;
    const rootY = baseY - random(key, 4) * cellH * 0.035;
    const tipX = Math.max(left + cellW * 0.035, Math.min(left + cellW * 0.965, rootX + lean));
    const controlX = rootX + (tipX - rootX) * 0.53 + (random(key, 5) - 0.5) * cellW * 0.035;
    const width = (cell.widthMin + random(key, 6) * (cell.widthMax - cell.widthMin)) * SUPERSAMPLE;
    paintAngularBlade(
      surface,
      [
        [rootX, rootY],
        [controlX, rootY - height * 0.50],
        [tipX, rootY - height],
      ],
      width,
      dark,
      light,
      key,
    );

    if (isSeedHead) {
      paintDisc(surface, tipX, rootY - height, (2.0 + random(key, 10) * 2.0) * SUPERSAMPLE, [167, 165, 93]);
    }

    if (cell.kind === "flower" && blade % 2 === 0) {
      paintFlower(
        surface,
        tipX,
        rootY - height,
        (3.4 + random(key, 11) * 2.7) * SUPERSAMPLE,
        cell.id === "flower-yarrow" ? 0 : 1,
        key,
      );
    }

  }

  // A dark basal mat makes each card read as a clump rather than loose sticks.
  for (let tuft = 0; tuft < 18; tuft += 1) {
    const key = cell.seed * 1009 + tuft;
    paintDisc(
      surface,
      left + cellW * (0.12 + random(key, 14) * 0.76),
      baseY - random(key, 15) * cellH * 0.035,
      (3.0 + random(key, 16) * 4.0) * SUPERSAMPLE,
      [52, 88, 47],
    );
  }
}

function makeAtlas() {
  const high = new PNG({ width: WIDTH * SUPERSAMPLE, height: HEIGHT * SUPERSAMPLE, colorType: 6 });
  high.data.fill(0);
  CELLS.forEach((cell) => paintCell(high, cell));

  const png = new PNG({ width: WIDTH, height: HEIGHT, colorType: 6 });
  let occupied = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const source = (((y * SUPERSAMPLE + sy) * high.width) + x * SUPERSAMPLE + sx) * 4;
          red += high.data[source];
          green += high.data[source + 1];
          blue += high.data[source + 2];
          alpha += high.data[source + 3];
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const target = (y * WIDTH + x) * 4;
      png.data[target] = Math.round(red / samples);
      png.data[target + 1] = Math.round(green / samples);
      png.data[target + 2] = Math.round(blue / samples);
      png.data[target + 3] = Math.round(alpha / samples);
      if (png.data[target + 3] >= Math.round(ALPHA_CUTOFF * 255)) occupied += 1;
    }
  }

  return {
    bytes: PNG.sync.write(png, {
      colorType: 6,
      bitDepth: 8,
      inputHasAlpha: true,
      compressionLevel: 9,
      deflateStrategy: 3,
      filterType: 4,
    }),
    occupancy: occupied / (WIDTH * HEIGHT),
  };
}

export function terrainHeight(x, z) {
  const radius = Math.hypot(x, z);
  const ridge = 4.6 * Math.exp(-((z - 25) ** 2) / (2 * 5.5 * 5.5)) *
    (1 - clamp01((Math.abs(x) - 16) / 24) * 0.75);
  const t = clamp01((radius - 13) / 30);
  let roll = t * t * (
    Math.sin(x * 0.16 + 1.7) * Math.cos(z * 0.13 - 0.6) +
    0.5 * Math.sin(x * 0.31 - 2.2) * Math.sin(z * 0.27 + 1.1)
  ) * 1.5;
  roll *= 1 - clamp01(ridge / 1.2) * 0.85;
  return ridge + roll;
}

function rectangleDistance(x, z, x0, z0, x1, z1) {
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
}

function segmentDistance(x, z, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const lengthSquared = vx * vx + vz * vz;
  const t = lengthSquared > 0 ? clamp01(((x - ax) * vx + (z - az) * vz) / lengthSquared) : 0;
  return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
}

const rectDistanceTo = (x, z, rect) => rectangleDistance(x, z, rect.x0, rect.z0, rect.x1, rect.z1);
const segmentDistanceTo = (x, z, run) => segmentDistance(x, z, run.ax, run.az, run.bx, run.bz);

/* MUST mirror sampleMeadowClearance(x, z, tight = false) in
   src/three/meadow-v1/meadow/field.ts. Atlas cards are tall, so they use
   the wide pads: the steel skid and the 1.8 m tub, and nothing else. */
export function clearance(x, z) {
  const fade = (distance, pad, feather) => clamp01((distance - pad) / feather);
  const unitClear = fade(rectDistanceTo(x, z, UNIT_RECT), 0.22, 0.85);
  const tubClear = fade(Math.hypot(x - TUB_CENTER.x, z - TUB_CENTER.z), TUB_RADIUS + 0.2, 0.7);
  return Math.min(unitClear, tubClear);
}

function density(x, z) {
  const radius = Math.hypot(x, z);
  const ring = 1 - smooth01(16, 35, radius);
  const corridor = (1 - smooth01(9, 18, Math.abs(x))) * smooth01(5.5, 11, z) * (1 - smooth01(33, 41, z));
  const scatter = 0.34 * (1 - smooth01(28, 48, radius));
  return clamp01(Math.max(ring, corridor, scatter) * (1 - smooth01(6, 15, -z)));
}

function makeRecord(index, kind) {
  const flower = kind === 1;
  // Near and mid bands are deliberately interleaved so either fixed camera
  // gets visible cutouts even when the live hero stream freezes at its floor.
  const near = flower ? index < 500 : index < 1_800;
  const baseSalt = flower ? 40_000 : 20_000;
  let attempt = 0;
  while (attempt < 50_000) {
    const key = baseSalt + index * 131 + attempt;
    const xRange = near ? 24 : 40;
    const z0 = near ? -10 : -16;
    const z1 = near ? 42 : 64;
    const x = (random(key, 1) * 2 - 1) * xRange;
    const z = z0 + random(key, 2) * (z1 - z0);
    const weight = density(x, z) * Math.sqrt(clearance(x, z));
    if (weight > 0.03 && random(key, 3) <= Math.min(1, weight * (near ? 1.24 : 1.02))) {
      const cellIndex = flower ? 6 + (index % 2) : index % 6;
      const cell = CELLS[cellIndex];
      const width = flower ? 0.58 + random(key, 4) * 0.42 : 0.72 + random(key, 4) * 0.78;
      const height = flower ? 0.56 + random(key, 5) * 0.46 : 0.52 + random(key, 5) * 0.88;
      return {
        values: [
          x,
          terrainHeight(x, z) - 0.025,
          z,
          width,
          height,
          random(key, 6) * Math.PI * 2,
          cell.column / COLUMNS,
          cell.row / ROWS,
          1 / COLUMNS,
          1 / ROWS,
          kind,
          random(key, 7),
        ],
        near,
      };
    }
    attempt += 1;
  }
  throw new Error(`Could not place deterministic ${flower ? "flower" : "grass"} record ${index}`);
}

function makeInstanceTable() {
  const total = GRASS_INSTANCES + FLOWER_INSTANCES;
  const headerBytes = 24;
  const bytes = Buffer.alloc(headerBytes + total * STRIDE_BYTES);
  bytes.write(MAGIC, 0, "ascii");
  bytes.writeUInt32LE(VERSION, 8);
  bytes.writeUInt32LE(total, 12);
  bytes.writeUInt32LE(STRIDE_BYTES, 16);
  bytes.writeUInt32LE(SEED, 20);

  let cursor = headerBytes;
  let nearFlowers = 0;
  let midFlowers = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < total; index += 1) {
    const kind = index < GRASS_INSTANCES ? 0 : 1;
    const localIndex = kind === 0 ? index : index - GRASS_INSTANCES;
    const record = makeRecord(localIndex, kind);
    if (kind === 1) {
      if (record.near) nearFlowers += 1;
      else midFlowers += 1;
    }
    record.values.forEach((value, component) => bytes.writeFloatLE(value, cursor + component * 4));
    minX = Math.min(minX, record.values[0]);
    maxX = Math.max(maxX, record.values[0]);
    minZ = Math.min(minZ, record.values[2]);
    maxZ = Math.max(maxZ, record.values[2]);
    cursor += STRIDE_BYTES;
  }

  return {
    bytes,
    summary: {
      total,
      grass: GRASS_INSTANCES,
      flowers: FLOWER_INSTANCES,
      nearFlowers,
      midFlowers,
      bounds: { minX, maxX, minZ, maxZ },
    },
  };
}

async function buildArtifacts() {
  const [source, atlas] = await Promise.all([readFile(sourcePath), Promise.resolve(makeAtlas())]);
  const instances = makeInstanceTable();
  const metadata = {
    schema: SCHEMA,
    version: VERSION,
    license: "Aura-authored",
    alphaMode: "MASK",
    alphaCutoff: ALPHA_CUTOFF,
    draws: 1,
    dimensions: { width: WIDTH, height: HEIGHT, columns: COLUMNS, rows: ROWS },
    cells: CELLS.map(({ seed: _seed, blades: _blades, ...cell }) => ({
      ...cell,
      uv: [cell.column / COLUMNS, cell.row / ROWS, 1 / COLUMNS, 1 / ROWS],
    })),
    instanceFormat: {
      magic: MAGIC,
      endian: "little",
      headerBytes: 24,
      strideBytes: STRIDE_BYTES,
      fields: ["x", "y", "z", "width", "height", "yaw", "cellX", "cellY", "cellW", "cellH", "kind", "seed"],
    },
        instances: instances.summary,
        renderedInstances: {
          total: GRASS_INSTANCES + FLOWER_INSTANCES,
          grass: GRASS_INSTANCES + FLOWER_INSTANCES,
          flowers: 0,
        },
        generation: {
          seed: SEED,
          supersample: SUPERSAMPLE,
          angularLeafFacets: ANGULAR_LEAF_FACETS,
          angularLeafWidthScale: ANGULAR_LEAF_WIDTH_SCALE,
          synchronizedBands: false,
          polygonSegments: [9, 12],
          grassProfile: GRASS_PROFILE,
          fanGrassCells: CELLS.filter((cell) => cell.kind === "grass").length,
          maxSeedHeadsPerGrassCell: Math.max(...CELLS.filter((cell) => cell.kind === "grass").map((cell) => cell.seedHeads)),
          longitudinalMidribs: LONGITUDINAL_MIDRIBS,
          midribsPreserveAlpha: true,
          runtimeRasterization: false,
    },
    files: {
      source: { path: "scripts/generate-meadow-atlas.mjs", bytes: source.byteLength, sha256: sha256(source) },
      image: {
        path: "public/textures/meadow-atlas.png",
        bytes: atlas.bytes.byteLength,
        sha256: sha256(atlas.bytes),
        alphaOccupancy: Number(atlas.occupancy.toFixed(8)),
      },
      instances: {
        path: "public/textures/meadow-atlas.bin",
        bytes: instances.bytes.byteLength,
        sha256: sha256(instances.bytes),
      },
    },
  };
  return {
    image: atlas.bytes,
    binary: instances.bytes,
    metadata: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`),
    parsedMetadata: metadata,
  };
}

/* `files.source` fingerprints THIS FILE, so it necessarily moves whenever the
   generator is edited — FD1 moved the scene footprints out to
   lib/three/meadow/geometry.ts and every byte of the atlas stayed identical.
   Folding that fingerprint into the artifact equality check would report
   every honest source edit as an artifact change and, worse, tempt whoever
   hits it to regenerate and mask a real one. So it is compared separately and
   REPORTED (see sourceFingerprint in the --verify output): the atlas bytes
   are the contract, the fingerprint is provenance that re-anchors on the next
   `generate` run. Everything else in the JSON, formatting included, stays
   pinned byte-for-byte. */
const withoutSourceFingerprint = (metadata) => {
  const { files, ...rest } = metadata;
  const { source: _source, ...remainingFiles } = files;
  return { ...rest, files: remainingFiles };
};

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function verify() {
  const expected = await buildArtifacts();
  const [actualImage, actualBinary, actualMetadata] = await Promise.all([
    readFile(imagePath),
    readFile(binaryPath),
    readFile(metadataPath),
  ]);
  const failures = [];
  if (!actualImage.equals(expected.image)) failures.push("meadow-atlas.png differs from deterministic output");
  if (!actualBinary.equals(expected.binary)) failures.push("meadow-atlas.bin differs from deterministic output");
  const metadata = JSON.parse(actualMetadata.toString("utf8"));
  if (!actualMetadata.equals(Buffer.from(canonicalJson(metadata)))) {
    failures.push("meadow-atlas.json is not the generator's canonical 2-space serialization");
  }
  if (canonicalJson(withoutSourceFingerprint(metadata)) !== canonicalJson(withoutSourceFingerprint(expected.parsedMetadata))) {
    failures.push("meadow-atlas.json differs from deterministic output");
  }
  const recordedSource = metadata.files.source.sha256;
  const currentSource = expected.parsedMetadata.files.source.sha256;
  if (metadata.schema !== SCHEMA) failures.push(`schema must be ${SCHEMA}`);
  if (metadata.alphaMode !== "MASK" || metadata.draws !== 1) failures.push("atlas must use one alpha-tested draw");
  if (metadata.files.image.alphaOccupancy < 0.08 || metadata.files.image.alphaOccupancy > 0.65) {
    failures.push("atlas alpha occupancy must remain within 8–65%");
  }
  if (metadata.instances.grass !== 2_800 || metadata.instances.flowers !== 800) failures.push("source inventory must retain 2,800 grass and 800 legacy flower slots");
  if (metadata.instances.nearFlowers !== 500 || metadata.instances.midFlowers !== 300) failures.push("legacy near/mid placement inventory regressed");
  if (metadata.renderedInstances.grass !== 3_600 || metadata.renderedInstances.flowers !== 0) failures.push("runtime mapping must render 3,600 grass cards and no billboard flowers");
  if (metadata.generation.grassProfile !== GRASS_PROFILE || metadata.generation.fanGrassCells !== 6) {
    failures.push("all six grass cells must use the asymmetric fan profile");
  }
  if (metadata.generation.maxSeedHeadsPerGrassCell > 2) failures.push("grass cells may carry at most two tall seed heads");
  if (!metadata.generation.longitudinalMidribs || !metadata.generation.midribsPreserveAlpha) {
    failures.push("offline fan leaves require alpha-preserving longitudinal midribs");
  }
  if (failures.length > 0) throw new Error(`Meadow atlas verification failed:\n- ${failures.join("\n- ")}`);
  process.stdout.write(`${JSON.stringify({
    verified: true,
    schema: metadata.schema,
    imageSha256: metadata.files.image.sha256,
    instancesSha256: metadata.files.instances.sha256,
    sourceSha256: recordedSource,
    sourceFingerprint: {
      recorded: recordedSource,
      current: currentSource,
      state: recordedSource === currentSource ? "anchored" : "stale - run generate to re-anchor",
    },
    alphaOccupancy: metadata.files.image.alphaOccupancy,
    instances: metadata.instances,
  }, null, 2)}\n`);
}

async function generate() {
  const artifacts = await buildArtifacts();
  await mkdir(textureDir, { recursive: true });
  await Promise.all([
    writeFile(imagePath, artifacts.image),
    writeFile(binaryPath, artifacts.binary),
    writeFile(metadataPath, artifacts.metadata),
  ]);
  process.stdout.write(`${JSON.stringify({
    generated: true,
    image: path.relative(appRoot, imagePath).replaceAll("\\", "/"),
    binary: path.relative(appRoot, binaryPath).replaceAll("\\", "/"),
    metadata: path.relative(appRoot, metadataPath).replaceAll("\\", "/"),
    imageSha256: artifacts.parsedMetadata.files.image.sha256,
    instancesSha256: artifacts.parsedMetadata.files.instances.sha256,
    sourceSha256: artifacts.parsedMetadata.files.source.sha256,
  }, null, 2)}\n`);
}

/* Only build when run as a CLI. The parity spec imports clearance() and
   terrainHeight() from this module; an import must never write textures. */
const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(sourcePath);
if (invokedAsScript) {
  if (process.argv.includes("--verify")) await verify();
  else await generate();
}
