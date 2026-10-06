/* ===========================================================================
   THE SUN — so the passive-solar argument can be SEEN rather than read.

   Every page on this site says the glazing wall faces south. That is a claim
   a reader either believes or does not. Give somebody a slider that drags the
   sun across the sky and they watch the December sun arrive low through the
   glass and leave the north wall dark all day, and the argument stops being a
   sentence.

   WHAT THIS IS, EXACTLY. The standard solar-position identities for a given
   latitude, declination and hour angle. It is honest daylight geometry and it
   is NOT an energy model, a shading study or a solar-gain calculation — it
   moves a light, and the UI says so where it is offered.

   THREE SIMPLIFICATIONS, NAMED, because a silent one is a lie in a tool that
   is otherwise exact:
   1. SOLAR time, not clock time. Hour 12 is solar noon — the sun exactly due
      south — with no longitude correction, no equation of time and no daylight
      saving. Real Edmonton clock noon in July is roughly 13:40 solar.
   2. Three declinations rather than a date: the two solstices and the
      equinox. They are the three days that decide a passive-solar design, and
      a date picker would imply a precision the rest of this does not have.
   3. No refraction and no elevation. Both move the horizon by fractions of a
      degree, which is invisible on a massing model.

   PURE. No `Date.now`, no `Math.random`: the same hour and season always give
   the same sun. The scene is deterministic, and so is a screenshot of it.
   =========================================================================== */

/** The Alberta pilot's latitude — Edmonton, 53.5°N. Everything downstream of
 *  the builder (climate zone 7A, the snow load conversation, the December
 *  solar collapse in `lib/design/materials.ts`) is written for this parallel,
 *  so the sun is too rather than defaulting to somewhere sunnier. */
export const LATITUDE_DEG = 53.5;

export type Season = "winter" | "equinox" | "summer";

/** Solar declination, degrees. The axial tilt at the two solstices, and zero
 *  at the equinox — the three days a passive-solar section is drawn for. */
const DECLINATION_DEG: Record<Season, number> = {
  winter: -23.44,
  equinox: 0,
  summer: 23.44,
};

export const SEASONS: ReadonlyArray<{ id: Season; label: string; sub: string }> = [
  { id: "winter", label: "Dec 21", sub: "Winter solstice — the sun you are designing the glass for" },
  { id: "equinox", label: "Mar / Sep 21", sub: "Equinox — the shoulder seasons" },
  { id: "summer", label: "Jun 21", sub: "Summer solstice — the sun the overhang has to keep out" },
];

const RAD = Math.PI / 180;

export interface SunPosition {
  /** degrees above the horizon; negative when the sun has set */
  altitudeDeg: number;
  /** compass bearing of the sun, degrees clockwise from north */
  azimuthDeg: number;
  /** unit vector FROM the site TOWARD the sun, in the scene frame
   *  (+X east, +Z south, +Y up — the frame `lib/builder/geometry.ts` fixes) */
  direction: readonly [number, number, number];
  aboveHorizon: boolean;
  /** true for the hour either side of sunrise and sunset */
  lowSun: boolean;
}

/**
 * Where the sun is at `hour` (solar time, 0–24) on the given day.
 *
 * The identities, for anyone checking the arithmetic:
 *   H   = 15° × (hour − 12)                       — hour angle, 0 at solar noon
 *   sin(alt) = sin(lat)·sin(dec) + cos(lat)·cos(dec)·cos(H)
 *   cos(A)   = (sin(dec) − sin(alt)·sin(lat)) / (cos(alt)·cos(lat))
 *   azimuth  = A before solar noon, 360° − A after it
 *
 * `A` is already the bearing FROM NORTH — that is what the identity returns,
 * and the only thing the afternoon branch does is resolve which side of the
 * meridian the arc-cosine landed on. Checked against the case that makes the
 * error obvious: at solar noon on the winter solstice at 53.5°N the identity
 * gives cos(A) = −1, so A = 180° — the sun due south, 13.1° above the horizon,
 * which is exactly the sun the glazing wall exists for. (An earlier version
 * read A as an offset from south and put that sun in the NORTHERN sky, which
 * would have quietly inverted the whole passive-solar demonstration.)
 *
 * The site frame does the rest: north is −Z, so a bearing of 180° points along
 * +Z and the light falls on every south elevation at once.
 */
export function sunPosition(hour: number, season: Season): SunPosition {
  const lat = LATITUDE_DEG * RAD;
  const dec = DECLINATION_DEG[season] * RAD;
  const H = (hour - 12) * 15 * RAD;

  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const cosAlt = Math.cos(altitude);
  // At the pole of the formula (sun exactly overhead) azimuth is undefined;
  // at this latitude that never happens, but a guard costs nothing and an
  // acos of 1.0000000002 is a NaN that would blank the whole scene.
  const denom = cosAlt * Math.cos(lat);
  const cosA =
    Math.abs(denom) < 1e-9
      ? 1
      : Math.max(-1, Math.min(1, (Math.sin(dec) - sinAlt * Math.sin(lat)) / denom));
  const A = Math.acos(cosA);
  const azimuth = H <= 0 ? A : 2 * Math.PI - A;

  const altitudeDeg = altitude / RAD;
  return {
    altitudeDeg,
    azimuthDeg: (azimuth / RAD + 360) % 360,
    // bearing → scene: north is −Z, east is +X
    direction: [
      cosAlt * Math.sin(azimuth),
      Math.sin(altitude),
      -cosAlt * Math.cos(azimuth),
    ],
    aboveHorizon: altitudeDeg > 0,
    lowSun: altitudeDeg > 0 && altitudeDeg < 10,
  };
}

/** Hour, as a clock string. Solar time — the panel says so beside it. */
export function hourLabel(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The eight compass points, for reading a bearing back to somebody. */
export function bearingWords(deg: number): string {
  const points = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return points[i];
}
