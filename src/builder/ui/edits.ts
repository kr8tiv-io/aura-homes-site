/* ===========================================================================
   EDITS — every change the editor can make to a HomeSpec, as pure functions.

   The spec is FROZEN DATA (`lib/builder/spec.ts`). Nothing in the UI mutates
   it: every control produces a NEW spec, which is what makes undo a one-line
   feature instead of a rewrite, and what lets the 3D view, the read-out and
   the plan bridge all read the same immutable object with no chance of one of
   them seeing a half-applied change.

   DETERMINISTIC IDS. No `Math.random`, no counters that survive a reload, no
   `Date.now`. An id is derived from the ids already in the spec, so the same
   sequence of clicks always produces the same file, the same share link and
   the same export. Two people who build the same house get the same bytes.

   CLAMPS LIVE HERE, not in the components, because the same limit is enforced
   from a slider, from a keyboard, and from the "add" buttons, and three copies
   of a limit is two copies too many. Every clamp keeps the spec inside what
   `validateHomeSpec` (lib/builder/share.ts) will accept, so a spec built here
   can always be shared and always re-opened.
   =========================================================================== */

import {
  summarizeHome,
  wallRunFt,
  wallThicknessFt,
} from "../core/geometry";
import type {
  Deck,
  HomeSpec,
  Opening,
  OpeningKind,
  Volume,
  Wall,
} from "../core/spec";

/* ---------------------------------------------------------------- limits
   Chosen to be generous rather than opinionated: the tool should not decide
   what somebody is allowed to build. The two that are NOT taste:
   · pitch stops below 90°, because `ridgeHeightFt` takes tan(pitch) and 90°
     has no finite ridge — `share.ts` refuses such a spec outright.
   · every minimum is above zero, because the contract requires positives. */
export const LIMITS = {
  widthFt: { min: 6, max: 80, step: 0.5 },
  depthFt: { min: 6, max: 60, step: 0.5 },
  positionFt: { min: -80, max: 80, step: 0.5 },
  rotationDeg: { min: 0, max: 355, step: 5 },
  wallHeightFt: { min: 7, max: 16, step: 0.25 },
  pitchDeg: { min: 0, max: 60, step: 1 },
  overhangFt: { min: 0, max: 5, step: 0.25 },
  openingWidthFt: { min: 1, max: 40, step: 0.5 },
  openingHeightFt: { min: 1, max: 24, step: 0.5 },
  sillFt: { min: 0, max: 12, step: 0.25 },
  deckFt: { min: 4, max: 40, step: 0.5 },
  frontFacesDeg: { min: 0, max: 355, step: 5 },
} as const;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Snap to a step and kill float noise. 1e-4 ft is a thousandth of an inch —
 *  below anything this system draws, and the same quantisation the share
 *  codec applies, so a value never changes by round-tripping through a link. */
export const snap = (v: number, step: number): number =>
  Math.round(Math.round(v / step) * step * 1e4) / 1e4;

/* ------------------------------------------------------------------- ids */

/** The next free `<prefix><n>` given the ids already in use. Stable: it
 *  depends only on the spec, never on how many times a button was pressed. */
function nextId(prefix: string, taken: readonly string[]): string {
  let n = 1;
  const used = new Set(taken);
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

const volumeIds = (spec: HomeSpec): string[] => spec.volumes.map((v) => v.id);

const openingIds = (v: Volume): string[] => v.openings.map((o) => o.id);

/* --------------------------------------------------------------- volumes */

export const WALL_LABELS: Record<Wall, string> = {
  n: "North",
  s: "South",
  e: "East",
  w: "West",
};

export const KIND_LABELS: Record<OpeningKind, string> = {
  window: "Window",
  door: "Door",
  "glazing-wall": "Glazing wall",
};

/** Replace one volume, leaving everything else identical. */
export function patchVolume(spec: HomeSpec, id: string, patch: Partial<Volume>): HomeSpec {
  return {
    ...spec,
    volumes: spec.volumes.map((v) => (v.id === id ? { ...v, ...patch } : v)),
  };
}

export function patchRoof(spec: HomeSpec, id: string, patch: Partial<Volume["roof"]>): HomeSpec {
  return {
    ...spec,
    volumes: spec.volumes.map((v) => (v.id === id ? { ...v, roof: { ...v.roof, ...patch } } : v)),
  };
}

/**
 * A new volume, placed clear of everything already on the site.
 *
 * East of the current bounds with a 6 ft gap, which is deliberate: `spec.ts`
 * SUMS footprints rather than unioning them, so a new volume dropped on top of
 * an old one would silently inflate the coverage figure. Landing it in clear
 * ground means the first thing somebody sees is a second mass, not a warning.
 */
export function addVolume(spec: HomeSpec): { spec: HomeSpec; id: string } {
  const id = nextId("vol", volumeIds(spec));
  const widthFt = 16;
  const depthFt = 14;
  const bounds = summarizeHome(spec).bounds;
  const x = spec.volumes.length === 0 ? 0 : snap(bounds.maxX + 6 + widthFt / 2, 0.5);
  const template = spec.volumes[spec.volumes.length - 1];

  const volume: Volume = {
    id,
    name: `Volume ${spec.volumes.length + 1}`,
    widthFt,
    depthFt,
    x,
    z: 0,
    rotationDeg: 0,
    storeys: 1,
    wallHeightFt: template ? template.wallHeightFt : 9.5,
    roof: {
      form: template ? template.roof.form : "gable",
      pitchDeg: template ? template.roof.pitchDeg : 32,
      overhangFt: template ? template.roof.overhangFt : 1.5,
    },
    openings: [
      { id: "o1", wall: "s", kind: "window", widthFt: 5, heightFt: 4, offsetFt: 5.5, sillFt: 3 },
    ],
  };
  return { spec: { ...spec, volumes: [...spec.volumes, volume] }, id };
}

/** A copy of a volume, offset east so both are visible and neither overlaps. */
export function duplicateVolume(spec: HomeSpec, id: string): { spec: HomeSpec; id: string } {
  const source = spec.volumes.find((v) => v.id === id);
  if (!source) return { spec, id };
  const newId = nextId("vol", volumeIds(spec));
  const bounds = summarizeHome(spec).bounds;
  const copy: Volume = {
    ...source,
    id: newId,
    name: `${source.name} copy`,
    x: snap(bounds.maxX + 6 + source.widthFt / 2, 0.5),
    // openings are cloned wholesale; their ids only have to be unique within
    // a volume, so they can carry over unchanged
    openings: source.openings.map((o) => ({ ...o })),
  };
  return { spec: { ...spec, volumes: [...spec.volumes, copy] }, id: newId };
}

/**
 * Remove a volume.
 *
 * The deck attaches to `spec.volumes[0]`, so removing the FIRST volume moves
 * the deck onto whatever becomes first. That is a real change to the model and
 * the caller is told, rather than the deck quietly relocating.
 */
export function removeVolume(spec: HomeSpec, id: string): { spec: HomeSpec; deckMoved: boolean } {
  const wasFirst = spec.volumes[0]?.id === id;
  const volumes = spec.volumes.filter((v) => v.id !== id);
  return {
    spec: { ...spec, volumes },
    deckMoved: wasFirst && volumes.length > 0 && spec.deck !== null,
  };
}

/* -------------------------------------------------------------- openings */

/** The built length of a wall — what an opening's offset is measured along.
 *  From `geometry.ts`, because the e/w walls butt INTO the n/s walls and are
 *  therefore two wall thicknesses shorter than `depthFt`. Clamping against
 *  `depthFt` would let an opening hang off the end of a wall that is not
 *  there. */
export function wallLengthFt(spec: HomeSpec, v: Volume, wall: Wall): number {
  return wallRunFt(v, wall, wallThicknessFt(spec.material));
}

/** The first gap on a wall that will hold an opening of this width, with a
 *  6-inch reveal either side. Returns the far end when nothing fits, so the
 *  geometry's own "trimmed to fit" warning is what reports the problem — the
 *  editor never silently refuses to add what was asked for. */
function firstFreeOffset(v: Volume, wall: Wall, widthFt: number, runFt: number): number {
  const gap = 0.5;
  const taken = v.openings
    .filter((o) => o.wall === wall)
    .map((o) => [o.offsetFt - gap, o.offsetFt + o.widthFt + gap] as const)
    .sort((a, b) => a[0] - b[0]);

  let cursor = 1;
  for (const [from, to] of taken) {
    if (from - cursor >= widthFt) return snap(cursor, 0.5);
    cursor = Math.max(cursor, to);
  }
  return snap(clamp(cursor, 0, Math.max(0, runFt - widthFt - 0.5)), 0.5);
}

/** Sensible starting dimensions per kind. A glazing wall is the founder's
 *  "beautiful polycarbonate glass" — it starts at the full eave height, so it
 *  reads as the wall it is rather than as a large window. */
function openingDefaults(v: Volume, kind: OpeningKind): { widthFt: number; heightFt: number; sillFt: number } {
  const eave = v.wallHeightFt * v.storeys;
  if (kind === "door") return { widthFt: 3, heightFt: 6.8, sillFt: 0 };
  if (kind === "glazing-wall") {
    return { widthFt: Math.min(16, Math.max(6, v.widthFt - 8)), heightFt: Math.max(4, eave - 0.5), sillFt: 0 };
  }
  return { widthFt: 4, heightFt: 4, sillFt: 3 };
}

export function addOpening(
  spec: HomeSpec,
  volumeId: string,
  wall: Wall,
  kind: OpeningKind,
): { spec: HomeSpec; id: string } {
  const v = spec.volumes.find((x) => x.id === volumeId);
  if (!v) return { spec, id: "" };
  const id = nextId("o", openingIds(v));
  const { widthFt, heightFt, sillFt } = openingDefaults(v, kind);
  const runFt = wallLengthFt(spec, v, wall);
  const opening: Opening = {
    id,
    wall,
    kind,
    widthFt: Math.min(widthFt, Math.max(1, runFt - 1)),
    heightFt,
    offsetFt: firstFreeOffset(v, wall, widthFt, runFt),
    sillFt,
  };
  return { spec: patchVolume(spec, volumeId, { openings: [...v.openings, opening] }), id };
}

export function patchOpening(
  spec: HomeSpec,
  volumeId: string,
  openingId: string,
  patch: Partial<Opening>,
): HomeSpec {
  const v = spec.volumes.find((x) => x.id === volumeId);
  if (!v) return spec;
  return patchVolume(spec, volumeId, {
    openings: v.openings.map((o) => (o.id === openingId ? { ...o, ...patch } : o)),
  });
}

export function removeOpening(spec: HomeSpec, volumeId: string, openingId: string): HomeSpec {
  const v = spec.volumes.find((x) => x.id === volumeId);
  if (!v) return spec;
  return patchVolume(spec, volumeId, { openings: v.openings.filter((o) => o.id !== openingId) });
}

/* ------------------------------------------------------------------ deck */

/** The deck the brief promises on every home, at a size that holds the tub. */
export const DEFAULT_DECK: Deck = { wall: "s", widthFt: 20, depthFt: 10, hotTub: true };

export function setDeck(spec: HomeSpec, deck: Deck | null): HomeSpec {
  return { ...spec, deck };
}

export function patchDeck(spec: HomeSpec, patch: Partial<Deck>): HomeSpec {
  return spec.deck ? { ...spec, deck: { ...spec.deck, ...patch } } : spec;
}

/* ---------------------------------------------------------------- siting */

export function patchSiting(spec: HomeSpec, patch: Partial<HomeSpec["siting"]>): HomeSpec {
  return { ...spec, siting: { ...spec.siting, ...patch } };
}
