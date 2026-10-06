/* ===========================================================================
   SURFACES — "paint this wall."

   `lib/builder/geometry.ts` decides the SHAPE of a home and tags every piece
   it emits with a `Surface` ("wall", "roof", "glass", "frame"…). The viewport
   turns that tag into a look. That is already enough for the founder's first
   ask — frame and glazing are separate meshes carrying separate tags, so they
   were never one material to begin with (see VERIFIED, below).

   What it is NOT enough for is the second ask: letting a PERSON say *this*
   wall is charred timber and the one round the corner is not. For that the
   system needs a name for an individual surface that survives being edited,
   a place to record the choice against that name, and a way to turn a click
   in the 3D view back into the name. Those three things are this file.

   THE ONE HARD PROBLEM: A NAME THAT DOES NOT MOVE
   -----------------------------------------------
   A material assignment is worthless if it wanders. Somebody chars the south
   wall, drags the width slider, and the char must still be on the south wall —
   not on the roof, not on the east wall, not gone. So the naming rule is:

       A SURFACE IS NAMED BY SPEC IDENTITY ONLY.

   Volume id, wall letter, opening id. Never an array index, never a dimension,
   never a position, never anything derived from the built geometry. Everything
   a person can drag — width, depth, height, pitch, overhang, rotation, storeys,
   roof form, the number of openings — is therefore invisible to the name, and
   an assignment made before the drag is the same assignment after it.

   That rules out the obvious shortcut of reusing `Part.id`, which is stable
   for walls but NOT for everything:

   · `main:roof0` and `main:roof1` are slab INDICES. `buildRoofModel` emits a
     gable as [+a slope, −a slope] and a saltbox as [−a slope, +a slope] — the
     opposite order. Keying a material to `roof0` means switching gable →
     saltbox silently swaps which side of the roof it is on. So every roof
     plane of a volume, plus its parapet, is ONE surface here: `vol:main/roof`.
     Which is also how a roof is really specified — standing seam covers the
     roof, not the north half of it.
   · `main:s:o1:glass` embeds the WALL an opening is on. Move that window to
     the east elevation and the part id changes, so the assignment would be
     lost — even though it is plainly the same window. The name used here,
     `vol:main/opening:o1/glass`, drops the wall and the paint follows the
     window round the building.

   THE ID REUSE HAZARD, NAMED
   --------------------------
   `components/builder/edits.ts` mints ids with `nextId`, which deliberately
   returns the LOWEST free id so that the same clicks always produce the same
   file. A consequence: delete `vol2`, add a volume, and the new one is also
   `vol2`. Nothing about the name is wrong — but an override left behind by the
   deleted volume would land on the new one, which is the exact failure this
   file exists to prevent. `pruneOverrides` is the answer and the caller has to
   run it on spec change; see its own comment for the trade it makes with undo.

   VERIFIED — WHAT GEOMETRY.TS ALREADY DOES
   ----------------------------------------
   The blueprint asks that "separate components of a single mesh (e.g. frame vs
   glazing) are assigned distinct material IDs". Read against the code, the
   premise does not apply: they are not a single mesh. `openingParts` emits a
   frame prism, a glass prism, a door leaf, a sill and each mullion as SEPARATE
   `Part`s with their own `surface` tags, and `buildVolume` does the same for
   walls, roof planes, ridge cap, parapet, floor and piles. So the model never
   needs multi-material `BufferGeometry` groups, `geometry.addGroup`, or a
   material array — which is a real win, because groups are what force every
   sub-material onto one mesh's transform and one draw call's state. Nothing in
   this file adds groups either. Overriding a material is a lookup, not a
   re-triangulation, and the geometry is untouched.

   NO TEXTURES ARE SHIPPED, and that is a decision rather than an omission:
   · The viewport's visual language is flat-shaded low-poly with no maps at all
     (`components/builder/Viewport.tsx`, `components/story/Scene.tsx`), and a
     photographic timber map on one wall of that scene reads as a mistake.
   · The UVs would not carry it. `prism` returns `BoxGeometry` on its fast path
     and `ExtrudeGeometry` otherwise; BoxGeometry emits 0–1 UVs per face
     whatever the face measures, while ExtrudeGeometry's default generator
     emits world-unit UVs. The same map would therefore tile at a different
     scale on a plain wall than on one with a window in it. Honest texturing
     needs a UV pass in geometry.ts first, which is not this file's to write.
   · Every texture is bytes to download and a licence to audit. Nothing here
     has either. If maps are ever added they must be CC0 with the source named
     in NOTICE — no NC clause, no ND clause.

   LICENCE: no new dependency. Not even a runtime import of three — the only
   thing this file wants from it is TYPES, so the import is `import type` and
   the module stays pure data and arithmetic. See PICKING for why the BVH the
   blueprint recommends was measured and then not adopted.

   TWO THINGS ARE CALLED "MATERIAL" IN THIS TOOL AND THEY ARE NOT THE SAME.
   `HomeSpec.material` is the STRUCTURAL choice — sip, clt, timber frame,
   rammed earth — and it sets wall thickness, the R-value, the plan and the
   price (lib/design/materials.ts). Everything in this file is a FINISH: what
   a surface looks like. Nothing here moves a number on a drawing or in the
   bill of materials, and the picker says so on screen. Wiring a finish into
   the BOM would be a real feature and a different one; pretending it already
   is would be the kind of quiet lie the honesty policy exists to stop.

   PURE AND DETERMINISTIC. No Math.random, no Date.now, no network, no React.
   Override maps are emitted with sorted keys so the same choices always
   serialise to the same bytes.
   =========================================================================== */

import type * as THREE from "three";
import type { HomeGeometry, Part, Surface } from "./geometry";
import type { HomeSpec, Opening, Wall } from "./spec";

/* ===========================================================================
   THE PALETTE — the eco materials the product already talks about

   Colour, roughness and metalness only, because that is the whole material
   model the viewport uses. These are three.js material parameters, NOT UI
   chrome: they are deliberately the same in day and night mode, because a
   cedar deck is the same cedar after dark. The lighting changes; the timber
   does not. (The picker draws its swatches from these values as SVG fills, so
   no colour ever reaches a className or a style attribute.)
   =========================================================================== */

export type MaterialId =
  /* walls */
  | "lime-render"
  | "timber-cladding"
  | "charred-timber"
  | "rammed-earth"
  /* roofs */
  | "standing-seam"
  | "standing-seam-zinc"
  | "corten"
  | "sedum-roof"
  /* timber */
  | "cedar-decking"
  | "cedar-tub"
  | "engineered-timber"
  | "oiled-oak"
  /* glazing */
  | "triple-glazing"
  | "polycarbonate"
  /* metal and stone */
  | "black-aluminium"
  | "cast-stone"
  | "galvanized-trim"
  | "galvanized-steel"
  | "still-water";

export interface SurfaceMaterial {
  id: MaterialId;
  label: string;
  /** one honest sentence: what this actually is, not what it evokes */
  note: string;
  /** three.js colour. Not theme-aware, on purpose — see the header. */
  color: string;
  roughness: number;
  metalness: number;
  /** translucent materials only */
  opacity?: number;
  /** smooth shading; the default is the flat shading of the low-poly language */
  smooth?: boolean;
  /** materials light passes through neither cast nor receive */
  noShadow?: boolean;
  /** the geometry surfaces this is a sensible choice on. The picker offers
   *  these first and still allows everything else — a person who wants a
   *  charred-timber roof is not wrong, they are making a decision. */
  suits: readonly Surface[];
}

const WALLS: readonly Surface[] = ["wall"];
const ROOFS: readonly Surface[] = ["roof"];
const TIMBER_FLAT: readonly Surface[] = ["deck", "floor", "door", "wall"];
const METALWORK: readonly Surface[] = ["trim", "frame", "sill", "pile"];

/**
 * Every material, keyed by id.
 *
 * The DEFAULT entries below reproduce `Viewport.tsx`'s `SURFACES` table value
 * for value, so adopting this module changes nothing on screen until somebody
 * actually overrides something. That is the point: this is an addition, not a
 * repaint.
 */
export const MATERIALS: Readonly<Record<MaterialId, SurfaceMaterial>> = {
  /* ---- walls ---- */
  "lime-render": {
    id: "lime-render",
    label: "Lime render",
    note: "Breathable mineral render over the panel. The builder's default wall.",
    color: "#e7e1d5",
    roughness: 0.94,
    metalness: 0,
    suits: WALLS,
  },
  "timber-cladding": {
    id: "timber-cladding",
    label: "Timber cladding",
    note: "Vertical larch or pine boards, oiled. Silvers with weather rather than failing.",
    color: "#c9a678",
    roughness: 0.9,
    metalness: 0,
    suits: ["wall", "deck", "door"],
  },
  "charred-timber": {
    id: "charred-timber",
    label: "Charred timber",
    note: "Shou sugi ban. The char is the weather layer, so there is no coating to renew.",
    color: "#1c1a18",
    roughness: 0.82,
    metalness: 0.02,
    suits: ["wall", "door", "deck"],
  },
  "rammed-earth": {
    id: "rammed-earth",
    label: "Rammed earth",
    note: "Stabilised earth in lifts. Thermal mass, not insulation — it wants an insulated core.",
    color: "#c2ab8d",
    roughness: 0.96,
    metalness: 0,
    suits: WALLS,
  },

  /* ---- roofs ---- */
  "standing-seam": {
    id: "standing-seam",
    label: "Standing seam, charcoal",
    note: "Concealed-fix steel. Sheds Alberta snow and takes a solar array on clamps, no penetrations.",
    color: "#2a302c",
    roughness: 0.55,
    metalness: 0.3,
    suits: ["roof", "wall", "trim"],
  },
  "standing-seam-zinc": {
    id: "standing-seam-zinc",
    label: "Standing seam, zinc",
    note: "The same seam in natural zinc. Lighter in the landscape and it patinas rather than fades.",
    color: "#8a9096",
    roughness: 0.42,
    metalness: 0.55,
    suits: ["roof", "wall", "trim"],
  },
  corten: {
    id: "corten",
    label: "Weathering steel",
    note: "Corten. The rust is the finish; the runoff stains what is underneath it, so detail the base.",
    color: "#8a4a2f",
    roughness: 0.78,
    metalness: 0.18,
    suits: ["roof", "wall", "trim"],
  },
  "sedum-roof": {
    id: "sedum-roof",
    label: "Sedum roof",
    note: "A living mat. Heavy when saturated — this is a structural decision, not a finish.",
    color: "#6f8358",
    roughness: 1,
    metalness: 0,
    suits: ROOFS,
  },

  /* ---- timber ---- */
  "cedar-decking": {
    id: "cedar-decking",
    label: "Cedar decking",
    note: "Western red cedar boards, gapped for drainage. The default deck.",
    color: "#a97e57",
    roughness: 0.86,
    metalness: 0,
    suits: TIMBER_FLAT,
  },
  "cedar-tub": {
    id: "cedar-tub",
    label: "Cedar staves",
    note: "The wood-fired tub's shell. Same species as the deck, darker with use.",
    color: "#6d523c",
    roughness: 0.9,
    metalness: 0,
    smooth: true,
    suits: ["tub", "deck"],
  },
  "engineered-timber": {
    id: "engineered-timber",
    label: "Engineered timber floor",
    note: "The floor deck as seen from below and between storeys. The builder's default floor.",
    color: "#b08a5e",
    roughness: 0.78,
    metalness: 0,
    suits: ["floor", "deck"],
  },
  "oiled-oak": {
    id: "oiled-oak",
    label: "Oiled oak",
    note: "The door leaf. The builder's default door.",
    color: "#6a5442",
    roughness: 0.85,
    metalness: 0,
    suits: ["door", "wall", "deck"],
  },

  /* ---- glazing ---- */
  "triple-glazing": {
    id: "triple-glazing",
    label: "Triple glazing",
    note: "Argon-filled, low-e. The builder's default glass, and what a zone 7A winter needs.",
    color: "#a8cfd4",
    roughness: 0.08,
    metalness: 0.15,
    opacity: 0.34,
    noShadow: true,
    suits: ["glass"],
  },
  polycarbonate: {
    id: "polycarbonate",
    label: "Multiwall polycarbonate",
    note: "Translucent rather than transparent: it carries light deep into a room and gives no view out.",
    color: "#cddfe0",
    roughness: 0.35,
    metalness: 0.05,
    opacity: 0.5,
    noShadow: true,
    suits: ["glass", "wall"],
  },

  /* ---- metal and stone ---- */
  "black-aluminium": {
    id: "black-aluminium",
    label: "Black aluminium",
    note: "Thermally broken window and door frames, and the glazing-wall mullions. The default frame.",
    color: "#20261f",
    roughness: 0.6,
    metalness: 0.25,
    suits: ["frame", "trim", "sill"],
  },
  "cast-stone": {
    id: "cast-stone",
    label: "Cast stone",
    note: "The projecting sill that throws water clear of the wall below. The default sill.",
    color: "#8d968f",
    roughness: 0.7,
    metalness: 0.1,
    suits: ["sill", "trim"],
  },
  "galvanized-trim": {
    id: "galvanized-trim",
    label: "Galvanized flashing",
    note: "Ridge cap and flashings. The default trim.",
    color: "#8f9a94",
    roughness: 0.4,
    metalness: 0.6,
    suits: METALWORK,
  },
  "galvanized-steel": {
    id: "galvanized-steel",
    label: "Galvanized steel",
    note: "The screw piles the home stands on. Never concrete — repo doctrine, not decoration.",
    color: "#6c7370",
    roughness: 0.6,
    metalness: 0.35,
    smooth: true,
    suits: ["pile", "trim", "frame"],
  },
  "still-water": {
    id: "still-water",
    label: "Water",
    note: "What is in the tub. Here so the tub's water can be turned off visually, not a build choice.",
    color: "#4f8d86",
    roughness: 0.2,
    metalness: 0.1,
    opacity: 0.88,
    smooth: true,
    noShadow: true,
    suits: ["water"],
  },
};

/** Every material in a fixed order — the order the picker shows them in. */
export const MATERIAL_LIST: readonly SurfaceMaterial[] = [
  MATERIALS["lime-render"],
  MATERIALS["timber-cladding"],
  MATERIALS["charred-timber"],
  MATERIALS["rammed-earth"],
  MATERIALS["standing-seam"],
  MATERIALS["standing-seam-zinc"],
  MATERIALS.corten,
  MATERIALS["sedum-roof"],
  MATERIALS["cedar-decking"],
  MATERIALS["cedar-tub"],
  MATERIALS["engineered-timber"],
  MATERIALS["oiled-oak"],
  MATERIALS["triple-glazing"],
  MATERIALS.polycarbonate,
  MATERIALS["black-aluminium"],
  MATERIALS["cast-stone"],
  MATERIALS["galvanized-trim"],
  MATERIALS["galvanized-steel"],
  MATERIALS["still-water"],
];

export function isMaterialId(value: unknown): value is MaterialId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MATERIALS, value);
}

/**
 * The material a surface wears when nobody has said otherwise.
 *
 * These twelve entries ARE `Viewport.tsx`'s `SURFACES` table, restated once so
 * there is a single source. If the two ever disagree, this one is the bug.
 */
export const DEFAULT_MATERIAL: Readonly<Record<Surface, MaterialId>> = {
  wall: "lime-render",
  floor: "engineered-timber",
  roof: "standing-seam",
  trim: "galvanized-trim",
  glass: "triple-glazing",
  door: "oiled-oak",
  frame: "black-aluminium",
  sill: "cast-stone",
  pile: "galvanized-steel",
  deck: "cedar-decking",
  tub: "cedar-tub",
  water: "still-water",
};

export function defaultMaterialFor(surface: Surface): SurfaceMaterial {
  return MATERIALS[DEFAULT_MATERIAL[surface]];
}

/** The materials worth offering for a surface, best first, then the rest.
 *  Nothing is withheld — a list that hides options is a list that argues. */
export function materialsFor(surface: Surface): {
  recommended: readonly SurfaceMaterial[];
  others: readonly SurfaceMaterial[];
} {
  const fits = (m: SurfaceMaterial) => m.suits.indexOf(surface) !== -1;
  return {
    recommended: MATERIAL_LIST.filter(fits),
    others: MATERIAL_LIST.filter((m) => !fits(m)),
  };
}

/* ===========================================================================
   IDENTITY

   The grammar, in full. Every id is one of these and nothing else:

       vol:<volumeId>/wall:<n|s|e|w>
       vol:<volumeId>/roof                      every roof plane and the parapet
       vol:<volumeId>/trim                      ridge cap and flashings
       vol:<volumeId>/floor                     floor deck and the storey plate
       vol:<volumeId>/piles
       vol:<volumeId>/opening:<openingId>/frame frame and glazing-wall mullions
       vol:<volumeId>/opening:<openingId>/glass
       vol:<volumeId>/opening:<openingId>/leaf  door leaf
       vol:<volumeId>/opening:<openingId>/sill
       vol:<volumeId>/misc:<surface>            unreachable today; see `misc`
       deck/boards                              boards and beams
       deck/piles
       deck/tub
       deck/water

   Readable on purpose. These end up in a share link and in a saved file, and
   a debuggable string beats an opaque hash the first time somebody has to work
   out why their east wall came back the wrong colour.
   =========================================================================== */

export type SurfaceId = string;

/** What part of a home a surface belongs to, after parsing its id back. */
export type ParsedSurfaceId =
  | { scope: "volume"; volumeId: string; role: "wall"; wall: Wall }
  | { scope: "volume"; volumeId: string; role: "roof" | "trim" | "floor" | "piles" }
  | {
      scope: "volume";
      volumeId: string;
      role: "opening";
      openingId: string;
      part: "frame" | "glass" | "leaf" | "sill";
    }
  | { scope: "volume"; volumeId: string; role: "misc"; surface: string }
  | { scope: "deck"; role: "boards" | "piles" | "tub" | "water" };

export interface SurfaceRef {
  id: SurfaceId;
  /** the geometry tag that decides this surface's DEFAULT material */
  surface: Surface;
  volumeId: string | null;
  wall?: Wall;
  openingId?: string;
  /** what to call it in a list: "South wall", "Roof", "Window o3 — glass" */
  label: string;
  /** which part of the home it is on: a volume name, or "Deck" */
  group: string;
  /** how many `Part`s wear it — the honest measure of what a click repaints */
  partCount: number;
}

const WALL_WORD: Readonly<Record<Wall, string>> = {
  n: "North",
  s: "South",
  e: "East",
  w: "West",
};

/** geometry.ts surface tag → the opening sub-part it represents. */
const OPENING_PART: Readonly<Partial<Record<Surface, "frame" | "glass" | "leaf" | "sill">>> = {
  frame: "frame",
  glass: "glass",
  door: "leaf",
  sill: "sill",
};

const DECK_PART: Readonly<Partial<Record<Surface, "boards" | "piles" | "tub" | "water">>> = {
  deck: "boards",
  pile: "piles",
  tub: "tub",
  water: "water",
};

/**
 * The surface id for one built part.
 *
 * `onDeck` is passed in rather than sniffed off the part, because a deck part
 * carries `volumeId: host.id` — `deck:piles` and `main:piles` are both surface
 * "pile" on volume "main", and only the caller knows which list it came from.
 * `buildSurfaceIndex` walks `HomeGeometry` structurally for exactly this
 * reason and never parses a `Part.id` string.
 */
function surfaceIdOfPart(part: Part, onDeck: boolean): SurfaceId {
  if (onDeck) {
    return "deck/" + (DECK_PART[part.surface] ?? "boards");
  }
  const vid = part.volumeId ?? "site";
  const base = "vol:" + vid;
  const opening = OPENING_PART[part.surface];
  if (opening) {
    // An opening sub-part that lost its opening id would be un-nameable, so it
    // gets a volume-level name rather than silently joining another surface.
    return part.openingId ? base + "/opening:" + part.openingId + "/" + opening : base + "/misc:" + part.surface;
  }
  switch (part.surface) {
    case "wall":
      return part.wall ? base + "/wall:" + part.wall : base + "/misc:wall";
    case "roof":
      return base + "/roof";
    case "trim":
      return base + "/trim";
    case "floor":
      return base + "/floor";
    case "pile":
      return base + "/piles";
    default:
      return base + "/misc:" + part.surface;
  }
}

/** An id back into what it points at. `null` when the string is not a valid
 *  surface id at all — which is how a corrupt share link gets dropped rather
 *  than half-applied. */
export function parseSurfaceId(id: SurfaceId): ParsedSurfaceId | null {
  if (typeof id !== "string" || id.length === 0) return null;

  if (id.indexOf("deck/") === 0) {
    const role = id.slice(5);
    if (role === "boards" || role === "piles" || role === "tub" || role === "water") {
      return { scope: "deck", role };
    }
    return null;
  }

  if (id.indexOf("vol:") !== 0) return null;
  const slash = id.indexOf("/");
  if (slash < 0) return null;
  const volumeId = id.slice(4, slash);
  if (volumeId.length === 0) return null;
  const rest = id.slice(slash + 1);

  if (rest === "roof" || rest === "trim" || rest === "floor" || rest === "piles") {
    return { scope: "volume", volumeId, role: rest };
  }
  if (rest.indexOf("wall:") === 0) {
    const w = rest.slice(5);
    if (w === "n" || w === "s" || w === "e" || w === "w") {
      return { scope: "volume", volumeId, role: "wall", wall: w };
    }
    return null;
  }
  if (rest.indexOf("misc:") === 0) {
    const surface = rest.slice(5);
    return surface.length > 0 ? { scope: "volume", volumeId, role: "misc", surface } : null;
  }
  if (rest.indexOf("opening:") === 0) {
    const tail = rest.slice(8);
    const cut = tail.lastIndexOf("/");
    if (cut <= 0) return null;
    const openingId = tail.slice(0, cut);
    const part = tail.slice(cut + 1);
    if (part === "frame" || part === "glass" || part === "leaf" || part === "sill") {
      return { scope: "volume", volumeId, role: "opening", openingId, part };
    }
    return null;
  }
  return null;
}

/* ---------------------------------------------------------------- labels */

const OPENING_PART_WORD: Readonly<Record<"frame" | "glass" | "leaf" | "sill", string>> = {
  frame: "frame",
  glass: "glass",
  leaf: "leaf",
  sill: "sill",
};

const KIND_WORD: Readonly<Record<Opening["kind"], string>> = {
  window: "Window",
  door: "Door",
  "glazing-wall": "Glazing wall",
};

function labelFor(part: Part, onDeck: boolean, opening: Opening | undefined): string {
  if (onDeck) {
    switch (DECK_PART[part.surface] ?? "boards") {
      case "piles":
        return "Deck piles";
      case "tub":
        return "Hot tub";
      case "water":
        return "Tub water";
      default:
        return "Deck boards";
    }
  }
  const sub = OPENING_PART[part.surface];
  if (sub && part.openingId) {
    // With the spec in hand the label names the thing ("Window on the south
    // wall"); without it, the opening id is still an honest handle.
    const what = opening
      ? KIND_WORD[opening.kind] + " on the " + WALL_WORD[opening.wall].toLowerCase() + " wall"
      : "Opening " + part.openingId;
    return what + " — " + OPENING_PART_WORD[sub];
  }
  switch (part.surface) {
    case "wall":
      return part.wall ? WALL_WORD[part.wall] + " wall" : "Wall";
    case "roof":
      return "Roof";
    case "trim":
      return "Ridge and flashings";
    case "floor":
      return "Floor deck";
    case "pile":
      return "Screw piles";
    default:
      return part.surface.charAt(0).toUpperCase() + part.surface.slice(1);
  }
}

/* ===========================================================================
   THE INDEX — every surface on a built home, and the click-to-surface map
   =========================================================================== */

export interface SurfaceIndex {
  /** every distinct surface, in build order: volumes first, then the deck */
  surfaces: SurfaceRef[];
  byId: Map<SurfaceId, SurfaceRef>;
  /**
   * BufferGeometry INSTANCE → surface. Keyed on the object, not on its uuid:
   * `THREE.MathUtils.generateUUID` is random, and a random key — even one that
   * never leaves memory — is a thing that can drift. The instance cannot.
   *
   * This works because `Viewport` renders `geometry={part.geometry}`, so the
   * geometry hanging off a raycast hit IS the `Part.geometry` that built it.
   * It does NOT survive `mergeParts`, which allocates fresh geometries and
   * discards part metadata by definition — a merged scene is not pickable and
   * `mergeParts`'s own comment says so.
   */
  byGeometry: Map<THREE.BufferGeometry, SurfaceRef>;
  /** the parts wearing each surface — what a highlight has to draw */
  partsById: Map<SurfaceId, Part[]>;
}

/**
 * Index a built home.
 *
 * `spec` is optional and only improves labels: with it an opening reads as
 * "Window on the south wall", without it as "Opening o3". Nothing about
 * identity depends on it, so an index built from geometry alone is just as
 * correct.
 *
 * Cost is one pass over the parts — about thirty of them on the reference
 * home. Safe to rebuild whenever the geometry does.
 */
export function buildSurfaceIndex(home: HomeGeometry, spec?: HomeSpec): SurfaceIndex {
  const surfaces: SurfaceRef[] = [];
  const byId = new Map<SurfaceId, SurfaceRef>();
  const byGeometry = new Map<THREE.BufferGeometry, SurfaceRef>();
  const partsById = new Map<SurfaceId, Part[]>();

  const openings = new Map<string, Opening>();
  if (spec) {
    for (const v of spec.volumes) {
      for (const o of v.openings) openings.set(v.id + "/" + o.id, o);
    }
  }

  const take = (part: Part, onDeck: boolean, group: string) => {
    const id = surfaceIdOfPart(part, onDeck);
    let ref = byId.get(id);
    if (!ref) {
      const key = (part.volumeId ?? "") + "/" + (part.openingId ?? "");
      ref = {
        id,
        surface: part.surface,
        volumeId: part.volumeId,
        wall: part.wall,
        openingId: part.openingId,
        label: labelFor(part, onDeck, openings.get(key)),
        group,
        partCount: 0,
      };
      byId.set(id, ref);
      surfaces.push(ref);
      partsById.set(id, []);
    }
    ref.partCount += 1;
    (partsById.get(id) as Part[]).push(part);
    byGeometry.set(part.geometry, ref);
  };

  for (const v of home.volumes) {
    for (const part of v.parts) take(part, false, v.name);
  }
  if (home.deck) {
    for (const part of home.deck.parts) take(part, true, "Deck");
  }

  return { surfaces, byId, byGeometry, partsById };
}

/** The surface an object in the scene belongs to, or null for scene furniture
 *  (the ground, the grid, the sun marker, a highlight overlay). */
export function surfaceOfObject(
  index: SurfaceIndex,
  object: THREE.Object3D | null | undefined,
): SurfaceRef | null {
  if (!object) return null;
  const geometry = (object as { geometry?: THREE.BufferGeometry }).geometry;
  if (!geometry) return null;
  return index.byGeometry.get(geometry) ?? null;
}

/* ===========================================================================
   PICKING — measured, then decided

   THE BLUEPRINT RECOMMENDS three-mesh-bvh WITH faceIndex RAYCASTING. It was
   benchmarked against this exact model rather than accepted, and the numbers
   say do not adopt it. Measured on node 24 / three r169, 2000 rays each,
   the same scene graph the viewport builds:

     scene                         meshes   tris   plain raycast   + three-mesh-bvh
     reference home (default spec)     27   1,820     0.026 ms        0.046 ms
     six-volume, 72-opening stress    232  11,176     0.031 ms        0.401 ms

   The BVH is 1.8× slower on the reference home and 13× slower on the stress
   scene, and costs another 10–13 ms building trees on every rebuild — which,
   in a builder that rebuilds the whole model on every slider tick, is the
   expensive number, not the raycast.

   THE HARNESS WAS FALSIFIED BEFORE THE RESULT WAS BELIEVED. Run the same
   comparison against ONE 517,000-triangle mesh and three-mesh-bvh is 1,348×
   faster than the brute-force raycaster (4,118× with `firstHitOnly`). So the
   library works and was genuinely engaged; it simply solves a problem this
   model does not have. A BVH amortises tree traversal over a huge triangle
   count inside a single mesh. An Aura home is the opposite shape: dozens of
   tiny meshes of a few hundred triangles each, where three's own
   bounding-sphere-then-box reject already discards almost everything and the
   survivors are a handful of triangles. Adding a tree per mesh pays the
   traversal setup and keeps the triangle test.

   THE COST OF ADOPTING IT ANYWAY, for the record: three-mesh-bvh, MIT
   (Garrett Johnson), installed here at 0.7.8 as a transitive dependency of
   @react-three/drei — latest 0.9.14, published 2026-08-01. Its ESM build is
   192,180 bytes raw; minified with the repo's own swc it is 71,780 bytes, 22.6
   KB gzipped, 19.9 KB brotli. Being in node_modules is not being in the
   bundle: nothing imports it today, so that 22.6 KB is real weight it would
   add to the /build route. Paying it to make picking slower is not a trade.

   VERDICT: no new dependency. Picking uses three's own `Raycaster`, which is
   already in the bundle, and 0.03 ms per pick leaves room for roughly 540
   picks inside one 60fps frame. If the model ever becomes one merged mesh of
   six figures of triangles, revisit — and the benchmark above is the test to
   re-run, not a re-read of the blueprint.

   ON faceIndex: three's `Intersection` already carries `faceIndex`, and it is
   passed through below for anyone who wants it. It is deliberately NOT part of
   surface identity. A triangle index is exactly the kind of name this file
   forbids — it moves the moment a wall is re-triangulated by adding a window.
   The name of a surface is "the south wall", not "triangle 47".
   =========================================================================== */

export interface SurfacePick {
  ref: SurfaceRef;
  /** world-space hit point, feet in the builder's site frame */
  point: readonly [number, number, number];
  distance: number;
  /** three's own face index for the triangle hit. Informational — see above. */
  faceIndex: number | null;
}

/**
 * The nearest surface under a ray.
 *
 * `root` should be the export root — the group holding the volumes and the
 * deck and nothing else — so the ground plane and the grid can never be
 * picked. Objects with no indexed geometry are skipped rather than aborting
 * the search, which is what lets a highlight overlay sit in the same subtree
 * without swallowing clicks.
 */
export function pickSurface(
  index: SurfaceIndex,
  raycaster: THREE.Raycaster,
  root: THREE.Object3D,
): SurfacePick | null {
  const hits = raycaster.intersectObject(root, true);
  for (const hit of hits) {
    const ref = surfaceOfObject(index, hit.object);
    if (!ref) continue;
    return {
      ref,
      point: [hit.point.x, hit.point.y, hit.point.z],
      distance: hit.distance,
      faceIndex: typeof hit.faceIndex === "number" ? hit.faceIndex : null,
    };
  }
  return null;
}

/** The colour a picked surface is washed with. The same emerald mark the
 *  viewport's volume-selection plate uses, so selection reads as one idea. */
export const PICK_HIGHLIGHT_COLOR = "#10b981";

/* ===========================================================================
   THE OVERRIDE MAP

   A plain string → string record, because it has to survive `JSON.stringify`
   into a saved file and a share link. Keys are sorted on every write, so the
   same set of choices always serialises to the same bytes — the same promise
   the exporters make.
   =========================================================================== */

export type SurfaceOverrides = Readonly<Record<SurfaceId, MaterialId>>;

/** The empty map. A frozen shared constant: nothing ever mutates one. */
export const NO_OVERRIDES: SurfaceOverrides = Object.freeze({});

function canonical(entries: readonly (readonly [SurfaceId, MaterialId])[]): SurfaceOverrides {
  const out: Record<SurfaceId, MaterialId> = {};
  const sorted = entries.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [id, m] of sorted) out[id] = m;
  return out;
}

function entriesOf(overrides: SurfaceOverrides): (readonly [SurfaceId, MaterialId])[] {
  return Object.keys(overrides).map((k) => [k, overrides[k]] as const);
}

/** Assign a material to a surface, or pass `null` to put it back to default.
 *  Returns a NEW map; nothing here mutates, for the same reason `edits.ts`
 *  does not — an immutable value is what makes history and re-render cheap. */
export function setSurfaceMaterial(
  overrides: SurfaceOverrides,
  id: SurfaceId,
  material: MaterialId | null,
): SurfaceOverrides {
  const kept = entriesOf(overrides).filter((e) => e[0] !== id);
  if (material === null) {
    return kept.length === Object.keys(overrides).length ? overrides : canonical(kept);
  }
  if (overrides[id] === material) return overrides;
  kept.push([id, material] as const);
  return canonical(kept);
}

export function countOverrides(overrides: SurfaceOverrides): number {
  return Object.keys(overrides).length;
}

/** The assignments, in canonical order, for a UI list or a diff. */
export function overrideEntries(
  overrides: SurfaceOverrides,
): readonly { id: SurfaceId; material: SurfaceMaterial }[] {
  return Object.keys(overrides)
    .sort()
    .map((id) => ({ id, material: MATERIALS[overrides[id]] }));
}

/**
 * Drop every assignment whose target is no longer in the spec.
 *
 * THIS IS NOT HOUSEKEEPING, IT IS THE FIX FOR ID REUSE. `edits.ts` mints the
 * lowest free id, so a deleted `vol2` frees the name and the next volume added
 * takes it. Without this pass a charred `vol:vol2/wall:s` would reappear on a
 * volume that has nothing to do with it — an assignment jumping to a different
 * wall, which is the one failure this whole file is built to prevent.
 *
 * THE TRADE, NAMED. Run on every spec change, this loses the material when a
 * volume is deleted AND UNDONE: the spec comes back, the override does not.
 * That is the deliberate choice — a lost colour is visible and one click to
 * redo, a colour on the wrong wall is invisible and wrong for good. A caller
 * who wants both keeps the override map in the SAME history entry as the spec
 * (`BuilderApp`'s reducer already stores whole immutable values), in which
 * case undo restores both together and pruning is only needed on load.
 *
 * Walls are never pruned by roof form. An a-frame has no north or south wall,
 * but "the north wall of vol1" is a fact about the volume, not about its roof —
 * so a form changed to a-frame and back keeps its paint.
 */
export function pruneOverrides(spec: HomeSpec, overrides: SurfaceOverrides): SurfaceOverrides {
  const alive = entriesOf(overrides).filter(([id]) => {
    const parsed = parseSurfaceId(id);
    if (!parsed) return false;
    if (parsed.scope === "deck") return spec.deck !== null;
    const volume = spec.volumes.find((v) => v.id === parsed.volumeId);
    if (!volume) return false;
    if (parsed.role === "opening") {
      return volume.openings.some((o) => o.id === parsed.openingId);
    }
    return true;
  });
  return alive.length === Object.keys(overrides).length ? overrides : canonical(alive);
}

/**
 * Whatever came out of a file or a share link, made safe.
 *
 * Anything that is not a parseable surface id paired with a known material is
 * dropped. A material renamed out of the palette in a later version therefore
 * falls back to the default rather than rendering as undefined — a home from
 * an old link opens, and opens honestly.
 */
export function validateOverrides(raw: unknown): SurfaceOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_OVERRIDES;
  const source = raw as Record<string, unknown>;
  const out: (readonly [SurfaceId, MaterialId])[] = [];
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (parseSurfaceId(key) && isMaterialId(value)) out.push([key, value] as const);
  }
  return out.length === 0 ? NO_OVERRIDES : canonical(out);
}

/* ===========================================================================
   RESOLUTION — the one question the renderer asks
   =========================================================================== */

/** The material for a surface: the override if there is one, else the default
 *  for its geometry tag. */
export function materialForSurface(
  surface: Surface,
  id: SurfaceId,
  overrides: SurfaceOverrides,
): SurfaceMaterial {
  const chosen = overrides[id];
  return chosen !== undefined && isMaterialId(chosen) ? MATERIALS[chosen] : defaultMaterialFor(surface);
}

export function materialForRef(ref: SurfaceRef, overrides: SurfaceOverrides): SurfaceMaterial {
  return materialForSurface(ref.surface, ref.id, overrides);
}

/**
 * The material for one built part — the call the viewport makes per mesh.
 *
 * A part with no entry in the index (which should not happen, and would mean
 * the index is stale) still renders: it falls back to its own surface default
 * rather than disappearing or throwing mid-frame.
 */
export function materialForPart(
  part: Part,
  index: SurfaceIndex,
  overrides: SurfaceOverrides,
): SurfaceMaterial {
  const ref = index.byGeometry.get(part.geometry);
  return ref ? materialForRef(ref, overrides) : defaultMaterialFor(part.surface);
}

/** Has this surface been changed from its default? */
export function isOverridden(id: SurfaceId, overrides: SurfaceOverrides): boolean {
  return overrides[id] !== undefined;
}

/**
 * The assignments as plain sentences — for a read-out, a schedule, or the
 * finishes note on a drawing.
 *
 * Surfaces still on the model are named ("South wall, Main house — charred
 * timber"). One that is not is still listed by id rather than hidden, because
 * an assignment the person made and cannot see is worse than an odd-looking
 * line.
 */
export function describeOverrides(
  index: SurfaceIndex,
  overrides: SurfaceOverrides,
): readonly string[] {
  return overrideEntries(overrides).map(({ id, material }) => {
    const ref = index.byId.get(id);
    return ref ? ref.label + ", " + ref.group + " — " + material.label : id + " — " + material.label;
  });
}
