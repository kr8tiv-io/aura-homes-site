import type { MeadowPage, MeadowPageTask } from "./contract";
import {
  meadowRandom,
  sampleMeadowClearance,
  sampleMeadowDensity,
  sampleTerrainHeight,
} from "./field";

function tierWeight(task: MeadowPageTask, x: number, z: number): number {
  const radius = Math.hypot(x, z - 4);
  if (task.tier === "near") return 1 - Math.min(0.7, Math.max(0, radius - 20) / 35);
  if (task.tier === "mid") return Math.min(1, Math.max(0, (radius - 12) / 12));
  return Math.min(1, Math.max(0, (radius - 28) / 18));
}

export function buildMeadowPage(task: MeadowPageTask): MeadowPage {
  const columns = Math.max(1, Math.ceil(Math.sqrt(task.capacity)));
  const positions = new Float32Array(task.capacity * 3);
  const random = new Float32Array(task.capacity * 4);
  const clearance = new Float32Array(task.capacity);
  const tight = false;
  let count = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let candidate = 0; candidate < task.capacity; candidate += 1) {
    const row = Math.floor(candidate / columns);
    const column = candidate % columns;
    const key = task.seed * 10_007 + candidate;
    const x = task.x0 + ((column + meadowRandom(key, 1)) / columns) * task.size;
    const z = task.z0 + ((row + meadowRandom(key, 2)) / columns) * task.size;
    const density = sampleMeadowDensity(x, z) * tierWeight(task, x, z);
    if (density < 0.015 || meadowRandom(key, 3) > density) continue;
    const clear = sampleMeadowClearance(x, z, tight);
    if (clear < 0.055) continue;

    const y = sampleTerrainHeight(x, z) - 0.02;
    const offset3 = count * 3;
    const offset4 = count * 4;
    positions[offset3] = x;
    positions[offset3 + 1] = y;
    positions[offset3 + 2] = z;

    const hero = true;
    random[offset4] = meadowRandom(key, 4) * Math.PI * 2;
    random[offset4 + 1] = hero
      ? 0.18 + Math.pow(meadowRandom(key, 5), 1.5) * 0.34
      : 0.12 + meadowRandom(key, 5) * 0.18;
    random[offset4 + 2] = hero
      ? 0.026 + meadowRandom(key, 6) * 0.018
      : 0.12 + meadowRandom(key, 6) * 0.12;
    random[offset4 + 3] = meadowRandom(key, 7);
    clearance[count] = task.layer === "hero" ? clear : Math.sqrt(clear);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    count += 1;
  }

  const cx = task.x0 + task.size / 2;
  const cz = task.z0 + task.size / 2;
  const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : sampleTerrainHeight(cx, cz);

  const order = Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => random[a * 4 + 3] - random[b * 4 + 3],
  );
  const sortedPositions = new Float32Array(count * 3);
  const sortedRandom = new Float32Array(count * 4);
  const sortedClearance = new Float32Array(count);
  order.forEach((source, destination) => {
    sortedPositions.set(positions.subarray(source * 3, source * 3 + 3), destination * 3);
    sortedRandom.set(random.subarray(source * 4, source * 4 + 4), destination * 4);
    sortedClearance[destination] = clearance[source];
  });

  return {
    id: task.id,
    tier: task.tier,
    layer: task.layer,
    count,
    positions: sortedPositions,
    random: sortedRandom,
    clearance: sortedClearance,
    bounds: { cx, cy, cz, radius: Math.hypot(task.size, task.size) / 2 + 0.8 },
  };
}

export function meadowTransferList(page: MeadowPage): Transferable[] {
  return [page.positions.buffer, page.random.buffer, page.clearance.buffer];
}
