/* Footprints come from ONE module so the mask and the slots cannot drift.
   Pads and feathers stay here, because they are this consumer's own.
   The only holes are the steel skid and the tub. */
import { TUB_CENTER, TUB_RADIUS, UNIT_RECT, type GroundRect } from "./geometry";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smooth01 = (a: number, b: number, value: number) => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function meadowRandom(index: number, salt = 0): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43_758.5453;
  return value - Math.floor(value);
}

export function sampleTerrainHeight(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  const ridge =
    4.6 *
    Math.exp(-Math.pow(z - 25, 2) / (2 * 5.5 * 5.5)) *
    (1 - clamp01((Math.abs(x) - 16) / 24) * 0.75);
  const t = clamp01((radius - 13) / 30);
  let roll =
    t *
    t *
    (Math.sin(x * 0.16 + 1.7) * Math.cos(z * 0.13 - 0.6) +
      0.5 * Math.sin(x * 0.31 - 2.2) * Math.sin(z * 0.27 + 1.1)) *
    1.5;
  roll *= 1 - clamp01(ridge / 1.2) * 0.85;
  return ridge + roll;
}

function rectangleDistance(x: number, z: number, x0: number, z0: number, x1: number, z1: number) {
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
}

const rectDistanceTo = (x: number, z: number, rect: GroundRect) =>
  rectangleDistance(x, z, rect.x0, rect.z0, rect.x1, rect.z1);

/** 0 inside a footprint, rising to 1 once the feather is clear. */
export function sampleMeadowClearance(x: number, z: number, tight = false): number {
  const fade = (distance: number, pad: number, feather: number) => clamp01((distance - pad) / feather);
  const unit = tight ? [0.08, 0.28] : [0.22, 0.85];
  // Gazebo posts sit about 1.48 m from the tub centre. The loose pad is the
  // hero grass, so that ring stays bare. The tight pad still clears the deck.
  const tub = tight ? [TUB_RADIUS + 0.45, 0.4] : [TUB_RADIUS + 0.7, 0.55];
  const unitClear = fade(rectDistanceTo(x, z, UNIT_RECT), unit[0], unit[1]);
  const tubClear = fade(Math.hypot(x - TUB_CENTER.x, z - TUB_CENTER.z), tub[0], tub[1]);
  return Math.min(unitClear, tubClear);
}

export function sampleMeadowDensity(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  const ring = 1 - smooth01(16, 35, radius);
  const corridor =
    (1 - smooth01(9, 18, Math.abs(x))) * smooth01(5.5, 11, z) * (1 - smooth01(33, 41, z));
  const scatter = 0.34 * (1 - smooth01(28, 48, radius));
  return clamp01(Math.max(ring, corridor, scatter) * (1 - smooth01(6, 15, -z)));
}

/** Ground darkening under the sward. The shade ring runs past the planted ring. */
export function meadowShade(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  const ring = 1 - smooth01(16, 46, radius);
  const corridor =
    (1 - smooth01(9, 18, Math.abs(x))) * smooth01(5.5, 11, z) * (1 - smooth01(33, 41, z));
  const scatter = 0.34 * (1 - smooth01(28, 48, radius));
  const density = clamp01(Math.max(ring, corridor, scatter) * (1 - smooth01(6, 15, -z)));
  return density * Math.pow(sampleMeadowClearance(x, z), 0.35);
}
