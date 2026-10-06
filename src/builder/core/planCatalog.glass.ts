/**
 * THE FLAT-ROOF GLASS WAVE — fifteen plans whose argument is the roof plane and
 * the wall under it.
 *
 * Every plan here is flat-roofed except two sheds, every one authors its own
 * openings rather than taking the library default, and every one states its own
 * modelled glazing ratio in `spec.notes` so the sentence rots the moment the
 * geometry moves. These are Aura originals. Nothing in this file is a
 * reproduction of, or adapted from, anybody's drawings.
 *
 * ---------------------------------------------------------------------------
 * WHY THE HELPERS BELOW ARE LOCAL RATHER THAN IMPORTED
 *
 * `opening`, `volume`, `spec` and `original` all exist in planCatalog.ts and
 * none of them is exported. Importing them once this module is concatenated
 * into PLAN_TEMPLATES would be a runtime crash, not a style problem:
 * planCatalog.ts would import this module to build its array, so THIS module's
 * body evaluates first, while planCatalog.ts's `const opening = …` and
 * `const auraSource = …` are still in the temporal dead zone. Every
 * `opening(...)` call here would throw "Cannot access 'opening' before
 * initialization" at import time.
 *
 * The fix is to move the authoring helpers into a third module both files
 * import — see the mount note in the handoff. Until that exists these are
 * narrowed local copies: `volume()` here REQUIRES `openings`, because a plan
 * that is about its elevation has to draw it, and the default four-opening
 * pattern is exactly what collapses the anti-padding gate's elevation axis.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE ENGINE ACTUALLY DRAWS, AND WHAT THESE PLANS THEREFORE DO NOT PROMISE
 *
 * A flat roof here is a projecting slab 0.9 ft thick (geometry.ts
 * ROOF_THICKNESS_FT) inside a perimeter upstand roughly 1.5 ft deep, with a
 * 0.5 ft lip above the deck. It is a thick roof edge, not a floating blade, and
 * no note in this file sells a knife edge.
 *
 * The deck falls 2 degrees toward `facing`, which eats head height on the low
 * wall: geometry.ts seats a wall at the LOWER of the roof heights over its own
 * thickness, less ROOF_SEAT_FT, and then clips openings by
 * OPENING_EDGE_CLEAR_FT. plan-catalog.spec.ts checks openings against
 * `wallHeightFt * storeys` and knows nothing about any of that, so a plan can
 * be green on every gate and still build trimmed glass with a viewport warning.
 * Every opening in this file was authored at least 0.25 ft below the real
 * seated head for its own wall, computed per wall rather than per volume.
 *
 * `facing` is set on every flat volume, chosen so the fall runs across the
 * shorter plan dimension and — where the plan wants full-height glass — so the
 * glazed elevation is the HIGH side, where the budget is
 * wallHeight − (overhang + wallThickness)·tan 2° − 0.17 instead of
 * wallHeight − (span + overhang)·tan 2° − 0.17.
 *
 * THE SHED TRAP, FOUND WHILE AUTHORING THIS SET. `ridgeHeightFt` (spec.ts:211)
 * computes a shed's rise from `widthFt`, but `buildRoofModel` (geometry.ts:781)
 * applies that rise across the FALL axis. A shed with `facing: "s"` therefore
 * draws a slope of atan(width·tan(pitch) / depth) — a 32 × 15 volume at a
 * stated 10 degrees draws at nearly 21 and stands 17 ft to the ridge. Both
 * sheds here fall east–west (`facing: "w"` / `"e"`), where fall run and ridge
 * span are the same dimension and the drawn pitch is the stated pitch, so their
 * prose can say what the model builds.
 *
 * ---------------------------------------------------------------------------
 * COMPOSITION, STATED SO IT CAN BE ARGUED WITH
 *
 * Five of the fifteen model above the 0.22 NBC 9.36 prescriptive reference
 * (32%, 30%, 25%, 25%, 23%) and carry the full disclosure. Ten sit under it on
 * purpose, with the floor at 14%. A wave of fifteen over-reference glass boxes
 * would pass every gate in the repo and still be dishonest by composition: the
 * disciplined plans are what make the aggressive ones mean anything.
 *
 * ---------------------------------------------------------------------------
 * WHICH WAY THE GLASS FACES, AND WHY THE PROSE HAS TO SAY SO
 *
 * A ratio is orientation-blind. `modelledGlazingRatio` divides glass by wall
 * and does not care whether the glass is on the one face that returns anything
 * in December or on the three that do not, so a plan can sit politely under the
 * reference and still spend its whole glazing budget pointing north. Three
 * plans in the first draft of this wave did exactly that and said nothing:
 * `tyngdegard-house` put its largest single pane on a north wall, `lysrekke-
 * house` put two full-height panes on east and west bedroom faces, and
 * `snofang-clerestory` justified 28% on clerestory gain when most of the
 * clerestory was north. Two of the three were redrawn and the third was cut
 * back; the notes on all three now name the compass.
 *
 * tests/plan-catalog-glass.spec.ts enforces this rather than trusting it: any
 * face carrying more than 12.5% of a plan's glass — half of an even four-way
 * split, on a set of plans that all claim to be south-led — has to be named, in
 * a sentence about openings, in the plan's own features or notes.
 */

import type { EcoMaterial } from "./designApi";

import type { PlanCostBasis, PlanSource, PlanTemplate } from "./planTypes";
import type { HomeSpec, Opening, RoofForm, Volume, Wall } from "./spec";

/* ---------------------------------------------------------------------------
   LOCAL AUTHORING HELPERS — see the header for why these are not imports.
   Behaviour is identical to planCatalog.ts's, minus the default opening
   pattern, which this set deliberately cannot reach.
   ------------------------------------------------------------------------- */

const AURA_REPO = "https://github.com/kr8tiv-ai/aura-homes";
const AURA_LICENSE = `${AURA_REPO}/blob/main/LICENSE`;

const auraSource = (): PlanSource => ({
  kind: "aura-authored",
  name: "Aura Homes",
  url: AURA_REPO,
  license: "MIT",
  licenseUrl: AURA_LICENSE,
  attribution: "Original editable concept by Aura Homes.",
  changes: "No third-party plan geometry was copied.",
  shareAlike: false,
  relationship: "original",
});

const opening = (
  id: string,
  wall: Opening["wall"],
  kind: Opening["kind"],
  widthFt: number,
  heightFt: number,
  offsetFt: number,
  sillFt = kind === "window" ? 3 : 0,
): Opening => ({ id, wall, kind, widthFt, heightFt, offsetFt, sillFt });

interface VolumeInput {
  id?: string;
  name?: string;
  width: number;
  depth: number;
  x?: number;
  z?: number;
  storeys?: 1 | 2;
  height?: number;
  roof: RoofForm;
  pitch?: number;
  facing: Wall;
  /** Required here, unlike planCatalog.ts's helper. Every plan in this wave is
   *  about its elevation, and an unauthored elevation is the library default,
   *  which is what makes two plans read as one building. */
  openings: Opening[];
}

function volume(input: VolumeInput): Volume {
  return {
    id: input.id ?? "main",
    name: input.name ?? "Main house",
    widthFt: input.width,
    depthFt: input.depth,
    x: input.x ?? 0,
    z: input.z ?? 0,
    /* No plan here is rotated. The wall letters n/s/e/w are LOCAL to a volume
       and nothing in the codebase checks them against north, so a rotated
       volume with a "south" glazing wall would make every solar sentence in
       this file false while every gate stayed green. */
    rotationDeg: 0,
    storeys: input.storeys ?? 1,
    wallHeightFt: input.height ?? 9.5,
    roof: {
      form: input.roof,
      pitchDeg: input.pitch ?? (input.roof === "shed" ? 18 : input.roof === "flat" ? 2 : 35),
      /* Left at the library default on every volume. plan-catalog.spec.ts pins
         `skygge-veranda` as the only plan whose overhang is not 1.5 by exact
         array equality, so a deep eave anywhere in this wave turns an unrelated
         green test red — and the horizontal read here is bought with
         proportion, not with a cantilever. */
      overhangFt: 1.5,
      facing: input.facing,
    },
    openings: input.openings,
  };
}

interface SpecInput {
  title: string;
  material?: EcoMaterial;
  volumes: Volume[];
  notes: string;
  deck?: { width: number; depth: number; hotTub?: boolean } | null;
}

function planSpec(input: SpecInput): HomeSpec {
  return {
    version: 1,
    name: input.title,
    material: input.material ?? "sip",
    climateZone: "7A",
    volumes: input.volumes,
    deck:
      input.deck === null
        ? null
        : {
            wall: "s",
            widthFt: input.deck?.width ?? Math.min(input.volumes[0]?.widthFt ?? 16, 18),
            depthFt: input.deck?.depth ?? 8,
            hotTub: input.deck?.hotTub ?? false,
          },
    siting: { frontFacesDeg: 180, slope: "flat" },
    notes: input.notes,
  };
}

function original(
  value: Omit<PlanTemplate, "source" | "spec"> & {
    material?: EcoMaterial;
    volumes: Volume[];
    notes: string;
    deck?: SpecInput["deck"];
  },
): PlanTemplate {
  return {
    ...value,
    source: auraSource(),
    spec: planSpec({
      title: value.title,
      material: value.material,
      volumes: value.volumes,
      notes: value.notes,
      deck: value.deck,
    }),
  };
}

/* ---------------------------------------------------------------------------
   THE GLAZING-PACKAGE PROXY

   the shared bill counted each glazed wall as one unit
   — per UNIT, not per square foot — and estimatePlanTemplate counts every
   non-door opening as one unit. A 34 ft glazing wall and a bathroom casement
   are therefore the same line item. That is tolerable for a library of punched
   windows and it is not tolerable for this one, so every plan here that carries
   a glazing wall says so on its cost basis. `ramme-pavilion` is the only plan
   in the wave with no glazing wall at all, and the only one whose glazing the
   shared bill of materials actually prices; it keeps the modelled basis.
   ------------------------------------------------------------------------- */

const glazingProxy = (label: string, what: string): PlanCostBasis => ({
  status: "proxy",
  label,
  note:
    `${what} Each glazed wall is recorded as one opening in the plan, not as a row of small windows.`,
});

export const GLASS_PLAN_TEMPLATES: PlanTemplate[] = [
  /* ────────────────────────────────────────────────────────────────────────
     SINGLE VOLUMES — length, wall height and opening rhythm, which is what the
     fixed south-east three-quarter camera actually shows.
     ──────────────────────────────────────────────────────────────────────── */

  original({
    id: "langsikt-pavilion",
    title: "Langsikt Pavilion",
    kicker: "640 sq ft · forty-foot bar",
    summary:
      "A forty-foot flat-roofed bar with two full-height glass halls on the south and a two-foot pier between them, and a north wall carrying nothing but a light band at head height.",
    bestFor: "A south-facing lot where the whole plan can be one room deep",
    bedrooms: 1,
    bathrooms: 1,
    sleeping: "One enclosed bedroom",
    storeys: 1,
    tags: ["400–800 sq ft", "one bedroom", "flat roof", "passive solar"],
    features: ["Two glass halls, one pier", "Roof falls north, away from the glass", "Sixteen-foot plan depth"],
    material: "sip",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "Two fifteen-foot glazing walls carry most of this plan's south envelope.",
    ),
    volumes: [
      volume({
        width: 40,
        depth: 16,
        height: 12,
        roof: "flat",
        /* The fall runs north, so the glazed south wall is the HIGH side of the
           2-degree deck and keeps its full head height. Falling it the other
           way would cost 0.54 ft off the glass and trim it silently. */
        facing: "n",
        openings: [
          opening("glass-sw", "s", "glazing-wall", 15, 11.3, 1.5, 0),
          opening("glass-se", "s", "glazing-wall", 15, 11.3, 18.5, 0),
          opening("door-s", "s", "door", 3, 6.8, 35.5),
          opening("band-n1", "n", "window", 10, 2, 4, 8.5),
          opening("band-n2", "n", "window", 10, 2, 26, 8.5),
          opening("win-e", "e", "window", 4, 7, 5, 2),
          opening("door-w", "w", "door", 3, 6.8, 5.5),
        ],
      }),
    ],
    deck: { width: 24, depth: 10 },
    notes:
      "Aura-authored long-bar concept. Modelled glazing is 30% of the modelled wall area, above the 22% NBC 9.36 prescriptive ceiling, and this plan goes to permit on the performance path: a better glazing package, a tighter envelope on the three near-blind walls, and a measured airtightness result. What the glass buys is a sixteen-foot plan depth in which every room touches the south wall, so there is no corridor and no room that needs a light on at noon in December. What it costs is stated plainly: 339 sq ft of glass sits where R-40 SIP wall would, and the heat loss through even a good triple-glazed unit is roughly six to eight times per square foot what that wall loses, all night, all January. A full-height pane at the -30 °C design condition has an inner surface near 12 to 14 °C and drives a downdraft felt as a draft three feet into the room, so a heat source at the base of the glass is a design requirement rather than an upgrade. The roof is drawn as a 0.9 ft slab inside a perimeter upstand about 1.5 ft deep — a thick edge, not a floating blade. Nothing in this build calculates a solar gain or a heat loss; an energy advisor confirms the banded prescriptive figure and the trade for the actual site, and an engineer owns the header over each fifteen-foot opening.",
  }),

  original({
    id: "horisont-pavilion",
    title: "Horisont Pavilion",
    kicker: "616 sq ft · thirty-four-foot glass wall",
    summary:
      "Forty-four feet long, fourteen feet deep, and one continuous thirty-four-foot screen of glass under a roof that falls toward it.",
    bestFor: "A long view the plan is willing to be organised around",
    bedrooms: 2,
    bathrooms: 1,
    sleeping: "Two enclosed bedrooms",
    storeys: 1,
    tags: ["400–800 sq ft", "two bedroom", "flat roof", "passive solar"],
    features: ["One continuous south screen", "Roof falls toward the deck", "Clerestory band on the tall north wall"],
    material: "sip",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "A single thirty-four-foot glazing wall carries the whole south elevation.",
    ),
    volumes: [
      volume({
        width: 44,
        depth: 14,
        height: 11,
        roof: "flat",
        /* The one plan in the wave whose roof falls TOWARD its glass. The
           fascia line is lowest directly over the deck, which presses the
           composition down and reads as shelter — and a 14 ft fall run keeps
           the head budget at 10.29 ft against 9.7 ft of authored glass. */
        facing: "s",
        openings: [
          opening("glass-s", "s", "glazing-wall", 34, 9.7, 3, 0),
          opening("door-s", "s", "door", 3.5, 7, 38),
          opening("cler-n1", "n", "window", 8, 2.5, 4, 7.5),
          opening("cler-n2", "n", "window", 8, 2.5, 18, 7.5),
          opening("cler-n3", "n", "window", 8, 2.5, 32, 7.5),
          opening("door-e", "e", "door", 3, 6.8, 4),
          opening("win-w", "w", "window", 3, 5, 5, 2),
        ],
      }),
    ],
    deck: { width: 30, depth: 12 },
    notes:
      "Aura-authored long-bar concept, and the most glazed plan in this wave. Modelled glazing is 32% of the modelled wall area, above the 22% NBC 9.36 prescriptive ceiling, and there is no reading under which it passes on the prescriptive path; it goes on the performance path with the best triple-glazed package, a thicker envelope on the near-blind north and the two ends, and airtightness testing. The glazing wall is drawn as a mullioned screen at the engine's 4 ft nominal spacing, not as one pane. What it buys: a fourteen-foot plan depth means no room is more than fourteen feet from daylight and there is no internal corridor at all, which is why a home with a bedroom, a bath and a full kitchen wall fits in 616 sq ft. What it costs: the heat loss through 329 sq ft of glass in place of R-40 wall is roughly six to eight times per square foot what the wall would lose at the -30 °C January design condition, twenty-four hours a day, and no eave changes that at three in the morning. The structural header over a thirty-four-foot opening is the engineer's first question, before the view is, and an energy advisor confirms the glazing trade for the real site — nothing here computes a solar gain, a heat loss or an overheating hour.",
  }),

  original({
    id: "hoyvegg-pavilion",
    title: "Høyvegg Pavilion",
    kicker: "600 sq ft · fourteen-foot wall",
    summary:
      "A fourteen-foot wall taken in two horizontal courses — full-height glass to eight and a half feet, a solid band, then a three-and-a-half-foot light band above it on the same width.",
    bestFor: "One tall room that wants a horizontal line in its glass",
    bedrooms: 2,
    bathrooms: 2,
    sleeping: "Two bedrooms behind the service wall",
    storeys: 1,
    tags: ["400–800 sq ft", "two bedroom", "flat roof", "clerestory"],
    features: ["Two courses of glass, one solid band", "Fourteen-foot single-storey wall", "Daylight from head height"],
    material: "sip",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "Two stacked registers of glazing wall and window make up the south elevation.",
    ),
    volumes: [
      volume({
        width: 30,
        depth: 20,
        height: 14,
        roof: "flat",
        facing: "n",
        /* Mullions divide vertically only at 4 ft nominal and there are no
           transoms (geometry.ts:1327). The only way to draw a horizontal line
           across a tall glazed elevation is a real solid course between two
           registers, which is what the 1 ft band between y 8.5 and y 9.5 is. */
        openings: [
          opening("glass-s1", "s", "glazing-wall", 11, 8.5, 2, 0),
          opening("glass-s2", "s", "glazing-wall", 11, 8.5, 15, 0),
          opening("band-s1", "s", "window", 11, 3.5, 2, 9.5),
          opening("band-s2", "s", "window", 11, 3.5, 15, 9.5),
          opening("door-s", "s", "door", 3.5, 7, 26.2),
          opening("win-e", "e", "window", 4, 7, 5, 2),
          opening("win-w", "w", "window", 4, 7, 5, 2),
          opening("cler-n1", "n", "window", 6, 2.5, 5, 10),
          opening("cler-n2", "n", "window", 6, 2.5, 19, 10),
        ],
      }),
    ],
    deck: { width: 24, depth: 12 },
    notes:
      "Aura-authored two-course elevation. Modelled glazing is 25% of the modelled wall area, above the 22% NBC 9.36 prescriptive ceiling, taken on the trade-off path with triple glazing throughout, a low-conductance frame, a thicker envelope on the near-blind north and the two ends, and airtightness testing. The two courses are a daylight argument as well as a picture: useful daylight depth is governed by head height rather than by sill, so a band at a 9.5 ft sill reaches further into a twenty-foot plan than the same area added to the bottom of the glass. The costs are specific. A fourteen-foot wall has more area to lose heat through than an eleven-foot one on the same footprint, so raising the wall to make the glass read full height also raised the denominator and the bill. The upper band sits above where anyone can reach it and cannot be opened for a summer purge without an operator, and a south elevation this size will overheat the room on a sunny February afternoon unless the floor carries real mass inside the insulation. This drawing models no mezzanine, no stair and no floor at band level; if any of those are wanted they are professional design, not a wall height, and an energy advisor owns the glazing trade.",
  }),

  original({
    id: "ramme-pavilion",
    title: "Ramme Pavilion",
    kicker: "572 sq ft · six framed windows",
    summary:
      "A flat-roofed pavilion with no glazing walls at all — six framed windows of six different sizes, each one aimed at something, and a modelled glazing figure of fourteen percent.",
    bestFor: "Anyone who wants the envelope doing the work and the heating plant small",
    bedrooms: 2,
    bathrooms: 1,
    sleeping: "Two bedrooms off a single hall",
    storeys: 1,
    tags: ["400–800 sq ft", "two bedroom", "flat roof", "low glazing"],
    /* "Six windows, six sizes" and not "six proportions": the six are 7×7, 4×4,
       3×9, 5×6, 2.5×8 and 4×2.5, which is six distinct sizes but only five
       distinct proportions, because two of them are square. The countable-claim
       gate in tests/plan-catalog-glass.spec.ts pins both numbers. */
    features: ["Six windows, six sizes", "No glazing walls anywhere", "Deep timber-frame reveals"],
    material: "timber_frame",
    /* The only plan in this wave with no glazing wall, and therefore the only
       one whose glazing the shared per-unit BOM actually prices correctly.
       It keeps the modelled basis on purpose. */
    volumes: [
      volume({
        width: 26,
        depth: 22,
        height: 11.5,
        roof: "flat",
        facing: "n",
        openings: [
          opening("frame-s1", "s", "window", 7, 7, 2, 1.5),
          opening("frame-s2", "s", "window", 4, 4, 11, 4),
          opening("door-s", "s", "door", 3.5, 7, 17),
          opening("frame-s3", "s", "window", 3, 9, 21.5, 1),
          opening("frame-e", "e", "window", 5, 6, 6, 2.5),
          opening("frame-w", "w", "window", 2.5, 8, 8, 1.5),
          opening("frame-n", "n", "window", 4, 2.5, 11, 7.5),
        ],
      }),
    ],
    deck: { width: 18, depth: 9 },
    notes:
      "Aura-authored disciplined counterweight, and the plan the rest of this wave is measured against. It is modelled at 14% glazing, inside the 22% NBC 9.36 prescriptive reference, and the reasoning is a superinsulation one rather than a pavilion one: with 152 sq ft of glass on a 572 sq ft home, most of it south, the envelope does the work and the heating system can be small. The single north opening is a 4 by 2.5 ft band at a 7.5 ft sill, deliberately, because north glass has no direct beam gain between the equinoxes and loses heat around the clock. The east and west windows are the weaker half of that argument and this record says so rather than leaving it to be found: 30 sq ft of east glass and 20 sq ft of west glass are a third of the plan's total, they take the low morning and evening sun no horizontal eave can shade, and the west pane is the one most likely to overheat this room on a July evening. They are here because a 26 by 22 ft plan glazed on one wall only is a corridor with a view, and that trade is stated rather than hidden. What this costs is daylight and drama: a twenty-two-foot-deep plan with this much south glass will want a light on at three in the afternoon in December, and if that trade reads wrong then Horisont or Langsikt is the plan and this one is not. Timber frame's 190 mm wall sets the glass about 2.2 in behind the outer face, which is the deepest reveal of the three lighter materials and the reason the openings are drawn as windows with sills rather than as wall-height screens. Glazing sizes, header spans and whether the 3 by 9 ft slot needs tempered glass are the supplier's and the engineer's calls; nothing here computes daylight or heat loss.",
  }),

  original({
    id: "soylegang-pavilion",
    title: "Søylegang Pavilion",
    kicker: "680 sq ft · five-bay colonnade",
    summary:
      "A south colonnade — five narrow full-height glass bays with two-foot piers between them, so the light arrives in five rooms and the structure stays in the wall.",
    bestFor: "A plan that wants to read as glass without spending the envelope on it",
    bedrooms: 2,
    bathrooms: 1.5,
    sleeping: "Two bedrooms, one behind each end bay",
    storeys: 1,
    tags: ["400–800 sq ft", "two bedroom", "mass timber", "passive solar"],
    features: ["Five full-height bays, five rooms", "Two-foot piers carry the wall", "Glass held to one elevation"],
    material: "clt",
    costBasis: glazingProxy(
      "CLT + glazing proxy",
      "Mass-timber panels are bought by the cubic metre with crane, erection-moisture and acoustic scope the Alberta bill of materials does not carry, and the panel layout and connections need the supplier's engineering.",
    ),
    volumes: [
      volume({
        width: 34,
        depth: 20,
        height: 12.5,
        roof: "flat",
        facing: "n",
        /* A 4 ft glazing wall gets round(4/4) = 1 bay and therefore no mullion,
           so each bay reads as a clean pane and the rhythm is carried by the
           piers — which are opaque wall, and are already in the denominator.
           Splitting one wall into five bays does not change the glazed area or
           the U-value of the glass; it changes where the structure and the
           insulation continuity live, and that is the only claim made for it. */
        openings: [
          opening("bay-1", "s", "glazing-wall", 4, 11.5, 1.5, 0),
          opening("bay-2", "s", "glazing-wall", 4, 11.5, 7.5, 0),
          opening("bay-3", "s", "glazing-wall", 4, 11.5, 13.5, 0),
          opening("bay-4", "s", "glazing-wall", 4, 11.5, 19.5, 0),
          opening("bay-5", "s", "glazing-wall", 4, 11.5, 25.5, 0),
          opening("door-s", "s", "door", 3, 7, 30.5),
          opening("cler-n1", "n", "window", 4, 2.5, 8, 8.5),
          opening("cler-n2", "n", "window", 4, 2.5, 22, 8.5),
          opening("slot-e1", "e", "window", 2, 6, 6, 3),
          opening("slot-e2", "e", "window", 2, 6, 12, 3),
          opening("win-w", "w", "window", 3, 5, 6.5, 3),
        ],
      }),
    ],
    deck: { width: 20, depth: 9 },
    notes:
      "Aura-authored colonnade. It is modelled at 21% glazing, inside the 22% NBC 9.36 prescriptive reference, and holds about four fifths of that glass — 230 sq ft of it — on the south elevation, which is the one orientation at 53.5 degrees north that returns anything in December. That is the whole point of the plan: five full-height bays put daylight into five rooms and still read as a wall of glass, while the piers between them carry the structure, the insulation continuity and the furniture. The east and west walls take two 2 by 6 ft slots and one small window between them, because low June sun arrives from north of east and north of west at this latitude and no horizontal eave can shade it. CLT is R-28 against SIP's R-40 and its 128 mm wall gives only about a 1.5 in glazing reveal, so this elevation gets its depth from the piers rather than from the reveal, and the envelope has less margin to spend than a SIP plan of the same shape. Panel layout, connections and the roof diaphragm are the supplier's engineering, and an energy advisor confirms the glazing package against the actual site.",
  }),

  original({
    id: "snofang-clerestory",
    title: "Snøfang Clerestory",
    kicker: "630 sq ft · three-sided light band",
    summary:
      "A rammed-earth room with one full-height glass wall on the south and a high light band on the other three sides, drawn so the mass sits inside the insulation and is charged by the south wall rather than by the band.",
    bestFor: "A build that wants thermal mass doing real work",
    bedrooms: 1,
    bathrooms: 1,
    sleeping: "One bedroom behind the mass wall",
    storeys: 1,
    tags: ["400–800 sq ft", "one bedroom", "thermal mass", "clerestory"],
    features: ["High band on three walls", "One full-height south wall", "Deep reveals in a heavy wall"],
    material: "rammed_earth",
    costBasis: glazingProxy(
      "Rammed-earth + glazing proxy",
      "A rammed-earth wall is formed and compacted on site around its own insulated core and is a structural element an engineer signs, not a panel the shared bill of materials prices.",
    ),
    volumes: [
      volume({
        width: 30,
        depth: 21,
        height: 12,
        roof: "flat",
        facing: "s",
        /* Rammed earth takes 2.95 ft off every e/w wall run (450 mm walls), the
           strictest built run in the library. Both east and west openings are
           sized against 18.05 ft, not against the 21 ft depth the catalog gate
           checks — opening-edit.spec.ts measures the built run and pins its
           exemption list to three plans that are not this one. */
        openings: [
          opening("glass-s", "s", "glazing-wall", 19, 10.5, 4.5, 0),
          opening("door-s", "s", "door", 3, 6.8, 25.5),
          /* The north band was three 8 by 3 ft lights, 72 sq ft — 63% of the
             whole high band and 21% of the plan's glass — on the one face that
             takes no direct beam between the equinoxes. It is now two 6 by
             2.5 ft lights. The band is for daylight depth in a 21 ft plan; the
             south wall is what charges the mass, and the note says so. */
          opening("band-n1", "n", "window", 6, 2.5, 3, 7.5),
          opening("band-n2", "n", "window", 6, 2.5, 21, 7.5),
          opening("band-e", "e", "window", 7, 3, 3, 7.5),
          opening("win-e", "e", "window", 4, 4, 12, 3),
          opening("band-w", "w", "window", 7, 3, 3, 7.5),
          opening("win-w", "w", "window", 4, 4, 12, 3),
        ],
      }),
    ],
    deck: { width: 18, depth: 9 },
    notes:
      "Aura-authored mass-and-clerestory concept. Modelled glazing is 25% of the modelled wall area, above the 22% NBC 9.36 prescriptive ceiling, and it goes on the trade-off path with a better glazing package, a tighter envelope on the solid walls and a measured airtightness result. Say the hard part first: rammed earth is about R-26 and it is mass, not resistance, so in zone 7A mass placed outside the insulation is a heat sink pointing at the sky. What charges that mass is the 199 sq ft of south glass and nothing else on this building. An earlier draft of this plan carried three 8 by 3 ft north lights and argued the case on clerestory gain, which was not true: 72 of the 114 sq ft of high band faced north, and at 53.5 degrees north a north light takes no direct beam at all between the equinoxes while losing heat around the clock. The north band is now two 6 by 2.5 ft lights, 30 sq ft, and it is there for daylight depth in a twenty-one-foot-deep plan rather than for gain. The two ends carry another 42 sq ft of band and 32 sq ft of ordinary window between them: east and west glass at this latitude takes low morning and evening summer sun that no horizontal eave reaches, which is the sun a room in July least wants, and gives back almost nothing in December. The drawing does not model the insulated core that makes a mass wall work here — an engineer owns the wall assembly and the thermal bridge at every reveal. What it costs: a full-height pane at -30 °C has an inner surface near 12 to 14 °C and drives a downdraft felt three feet away, so a heat source at the base of the south glass is a requirement, and a south wall this size will overheat this room on a sunny February afternoon if the floor is not doing the storage work the summary claims for it. The 450 mm wall sets the glass about 5.3 in behind the outer face, the deepest reveal this model can express — worth having on the building, and close to invisible in a catalog thumbnail that casts no shadows.",
  }),

  original({
    id: "terskel-pavilion",
    title: "Terskel Pavilion",
    kicker: "560 sq ft · two thresholds",
    summary:
      "A low shed tipped west over its own width, with two floor-level glass thresholds opening south onto a long deck and a north wall of ordinary windows that pays for them.",
    bestFor: "A plan built around walking straight out of the room",
    bedrooms: 1,
    bathrooms: 1.5,
    sleeping: "One bedroom, studio at the tall end",
    storeys: 1,
    tags: ["400–800 sq ft", "one bedroom", "shed roof", "indoor-outdoor"],
    features: ["Two thresholds, not one wall", "Roof tipped across the width", "Near-blind on the weather side"],
    material: "timber_frame",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "Two floor-level glazing walls open onto the deck and are the plan's whole south elevation.",
    ),
    volumes: [
      volume({
        width: 28,
        depth: 20,
        height: 11,
        roof: "shed",
        pitch: 9,
        /* Falls WEST, across the width. ridgeHeightFt derives a shed's rise
           from widthFt while buildRoofModel applies it across the fall axis, so
           only an east-west fall draws the pitch the plan states: 28 ft at
           9 degrees is a 4 ft 5 in rise to a 15 ft 5 in ridge, which is what
           the model builds. */
        facing: "w",
        openings: [
          opening("thresh-1", "s", "glazing-wall", 6.5, 10.4, 1.5, 0),
          opening("thresh-2", "s", "glazing-wall", 6.5, 10.4, 10, 0),
          opening("door-s", "s", "door", 3, 6.8, 18),
          opening("win-s", "s", "window", 3, 4, 22.5, 3),
          opening("win-n1", "n", "window", 4, 3, 4, 3.5),
          opening("win-n2", "n", "window", 4, 3, 16, 3.5),
          opening("cler-e", "e", "window", 5, 3, 6.5, 7.5),
          opening("door-w", "w", "door", 3, 6.8, 5),
          opening("win-w", "w", "window", 3, 3, 12, 3),
        ],
      }),
    ],
    deck: { width: 22, depth: 10 },
    notes:
      "Aura-authored threshold concept, modelled at 18% glazing, inside the 22% NBC 9.36 prescriptive reference. Two 6 ft 6 in openings do the same work as one continuous wall for the way a person actually moves between a room and a deck, and cost about 135 sq ft of glass instead of 210. What this plan does not get to claim is summer shading from its roof: the eave is the library's standard 1 ft 6 in, and at 53.5 degrees north the sun stands about 60 degrees up at solar noon on 21 June and about 13 degrees on 21 December, so a 1.5 ft overhang throws roughly 2.6 ft of shade in midsummer and about 0.35 ft at midwinter. That is hand geometry at noon from latitude and axial tilt — this codebase has no sun-path model — and it does nothing for low morning and evening sun and nothing at all for heat lost through the glass in January. Floor-level south glass will still bake this room in July; external shading is a line item, not an upgrade. A 9-degree shed is also well under the 25 degrees an Alberta shedding roof usually wants, so it is a membrane roof with a snow-load and drift review by an engineer, and the deck is drawn floating 2 ft 3 in above grade with no steps or guard modelled.",
  }),

  /* ────────────────────────────────────────────────────────────────────────
     TWO VOLUMES — the monitor, the stack, and the yard.

     Every abutting pair steps at least 3 ft in wall height, so the lower roof
     lands well below the taller volume's own roof rather than fighting it in
     the same plane. What the step does NOT do is keep the two roofs out of each
     other, and an earlier version of this comment claimed it did.

     geometry.ts:775-778 gives a flat roof a level parapet at `halfA = half +
     oh`: the slab and its upstand project the full 1.5 ft overhang past the
     wall face, on every side, with no trim at an abutment. A SIP wall is 165 mm
     — 0.54 ft. So in every abutting pair here the lower roof's slab and parapet
     pass THROUGH the taller wall and emerge about a foot inside it. That is a
     modelling artefact, not a design intent, and it is invisible from outside
     only because the taller wall is opaque there.

     `summarizeHome` reports wall-footprint overlap and nothing about roof
     slabs, so nothing in the repo would ever have said so. A real drawing
     resolves the two roofs into one flashed junction; this model cannot, and
     the plans that abut say as much in their notes.
     ──────────────────────────────────────────────────────────────────────── */

  original({
    id: "klarhet-monitor",
    title: "Klarhet Monitor",
    kicker: "832 sq ft · monitor behind the hall",
    summary:
      "A wide low living hall with a tall monitor bar standing behind it, its south face a band of clerestory glass looking over the hall roof.",
    bestFor: "A deep plan that needs light past the back of the room",
    bedrooms: 2,
    bathrooms: 1.5,
    sleeping: "Two bedrooms under the monitor",
    storeys: 1,
    tags: ["800–1,200 sq ft", "two bedroom", "flat roof", "clerestory"],
    /* "Near-blind" and not "blind": the monitor's north wall carries two 4 by
       4 ft windows, 32 sq ft on a 480 sq ft face. The hall's north wall is the
       junction and carries nothing, which is what made the old bullet feel
       true from the plan drawing and false from the street. */
    features: ["Monitor the full width of the house", "Light from two heights", "Near-blind north elevation"],
    material: "sip",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "A twenty-one-foot glazing wall carries the hall and is drawn as one opening.",
    ),
    volumes: [
      volume({
        id: "hall",
        name: "Hall",
        width: 32,
        depth: 16,
        z: 8,
        height: 10,
        roof: "flat",
        facing: "s",
        openings: [
          opening("glass-s", "s", "glazing-wall", 21, 8.6, 3.5, 0),
          opening("door-s", "s", "door", 3, 6.8, 26.5),
          opening("win-e", "e", "window", 4, 4, 5, 3),
          opening("win-w", "w", "window", 4, 4, 5, 3),
        ],
        /* The hall's north wall is the junction with the monitor across its
           full 32 ft width, so it carries nothing. */
      }),
      volume({
        id: "monitor",
        name: "Monitor bar",
        width: 32,
        depth: 10,
        z: -5,
        height: 15,
        roof: "flat",
        facing: "n",
        /* Sill 10.8 clears the hall's parapet top at 10.5 by 0.3 ft, which is
           the whole reason the clerestory sees sky rather than roof. */
        openings: [
          opening("cler-s1", "s", "window", 9, 3.5, 1.5, 10.8),
          opening("cler-s2", "s", "window", 9, 3.5, 11.5, 10.8),
          opening("cler-s3", "s", "window", 9, 3.5, 21.5, 10.8),
          opening("win-n1", "n", "window", 4, 4, 6, 3.5),
          opening("win-n2", "n", "window", 4, 4, 22, 3.5),
          opening("door-e", "e", "door", 3, 6.8, 2),
          opening("win-w", "w", "window", 3, 5, 3, 2.5),
        ],
      }),
    ],
    deck: { width: 20, depth: 9 },
    notes:
      "Aura-authored monitor, and the low end of this wave. It is modelled at 16% glazing, inside the 22% NBC 9.36 prescriptive reference, and the arithmetic deserves saying out loud rather than banking. The monitor bar adds 320 sq ft of real conditioned floor, and adding it is what dropped the ratio: the glass did not get smaller, the building got bigger. The denominator is generous too, and this record will not lean on it. It is perimeter times wall height times storeys with no deduction where volumes meet, so the 32 ft face the hall and the monitor share is counted twice — 480 sq ft on the monitor and 320 sq ft on the hall, about 800 of the 2,220 sq ft this 16% divides by. Roughly a third of that wall area is not exterior wall at all, and no percentage in this file should be read as though it were. What the monitor genuinely buys is 94 sq ft of glass at an 11 ft sill throwing light twenty-six feet back into a plan a south wall alone cannot reach past about twelve feet, and at 53.5 degrees north a south clerestory collects the 13-degree December beam while the roof edge above it shades the head of the band at the 60-degree June noon. What it costs is a second roof-to-wall junction where snow and flashing both collect, and clerestory glass nobody can reach to clean or curtain. The twenty-one-foot hall wall still loses heat all night in January at roughly six to eight times the rate of the R-40 wall it replaces. The junction detail and the snow drift against a five-foot step are an engineer's drawing, not a massing decision.",
  }),

  original({
    id: "takrygg-monitor",
    title: "Takrygg Monitor",
    kicker: "666 sq ft · shed monitor on a flat bar",
    summary:
      "A long low flat bar with a shed-roofed monitor riding behind it, the monitor's south face given entirely to a clerestory band above the bar's roof.",
    bestFor: "A single long room that still wants light from above",
    bedrooms: 1,
    bathrooms: 1,
    sleeping: "One bedroom at the west end",
    storeys: 1,
    tags: ["400–800 sq ft", "one bedroom", "shed roof", "clerestory"],
    features: ["Twenty-four-foot south screen", "Shed monitor breaks the flat plane", "Near-blind north wall"],
    material: "sip",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "A twenty-four-foot glazing wall is the bar's entire south elevation.",
    ),
    volumes: [
      volume({
        id: "bar",
        name: "Living bar",
        width: 36,
        depth: 13,
        z: 6.5,
        height: 10,
        roof: "flat",
        facing: "s",
        openings: [
          opening("glass-s", "s", "glazing-wall", 24, 9, 4, 0),
          opening("door-s", "s", "door", 3, 6.8, 29.5),
          /* The two north windows sit outside the monitor's 22 ft footprint and
             are symmetric about the wall's midpoint, so they land in real wall
             whichever end the offset is measured from. */
          opening("win-n1", "n", "window", 4.5, 3.5, 1.5, 3.5),
          opening("win-n2", "n", "window", 4.5, 3.5, 30, 3.5),
          opening("win-e", "e", "window", 4, 4.5, 4, 2.5),
          opening("win-w", "w", "window", 4, 4.5, 4, 2.5),
        ],
      }),
      volume({
        id: "monitor",
        name: "Monitor",
        width: 22,
        depth: 9,
        z: -4.5,
        height: 14.5,
        roof: "shed",
        pitch: 8,
        /* Falls east, across the 22 ft width, so the drawn slope is the stated
           8 degrees and the ridge is 14 ft 6 in + 3 ft 1 in = 17 ft 7 in. A
           north-south fall would have drawn this at 21 degrees. */
        facing: "e",
        openings: [
          opening("cler-s1", "s", "window", 6, 3, 1.5, 10.8),
          opening("cler-s2", "s", "window", 6, 3, 8, 10.8),
          opening("cler-s3", "s", "window", 6, 3, 14.5, 10.8),
          opening("cler-n", "n", "window", 5, 3, 8.5, 9),
          opening("win-e", "e", "window", 3, 4, 2.5, 3.5),
          opening("win-w", "w", "window", 3, 4, 2.5, 3.5),
        ],
      }),
    ],
    deck: { width: 22, depth: 9 },
    notes:
      "Aura-authored monitor, modelled at 20% glazing, inside the 22% NBC 9.36 prescriptive reference. The monitor's south clerestories are 54 sq ft of glass aimed at the December sun, which stands about 13 degrees above the horizon at this latitude; glass that high on a south face takes almost the whole winter beam and is shaded at the head by its own roof edge at the roughly 60-degree midsummer noon. That is hand arithmetic from latitude and axial tilt, not a simulation this codebase runs, and it says nothing about the low morning and evening sun an eave cannot touch. The cost is the junction: a shed monitor landing behind a flat roof is a wall-to-roof detail with an upstand on one side and a slope on the other, and it is where snow collects and where flashing fails if it is drawn by a massing tool instead of a professional. The twenty-four-foot south wall is 216 sq ft of glass losing heat all night, and the plan only lands at 20% because the rest of the building is deliberately close to blind: the two north walls carry 46 sq ft of window between them, none of which collects anything in December, and the four end windows carry 60 sq ft more. An 8-degree shed is far under the 25 degrees Alberta snow load usually wants on a shedding roof, so the roof build-up and the drift load are an engineer's call.",
  }),

  original({
    id: "stabel-house",
    title: "Stabel House",
    kicker: "1,200 sq ft · two storeys of south glass",
    summary:
      "A two-storey mass with its south face stacked in two registers of glass, and a single-storey bar running east off it eight feet lower.",
    bestFor: "A family plan on a narrow lot with one good elevation",
    bedrooms: 3,
    bathrooms: 2.5,
    sleeping: "Three bedrooms upstairs",
    storeys: 2,
    tags: ["800–1,200 sq ft", "three bedroom", "two storey", "flat roof"],
    features: [
      "Stacked south glazing on both floors",
      "Eight-foot step to the low bar",
      "Punched north street elevation",
    ],
    material: "sip",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "Three glazing walls, two of them stacked on an eighteen-foot two-storey elevation.",
    ),
    volumes: [
      volume({
        id: "mass",
        name: "Two-storey mass",
        width: 24,
        depth: 20,
        x: -8,
        storeys: 2,
        height: 9.5,
        roof: "flat",
        facing: "n",
        /* Two glazing walls on the same horizontal run, ten feet apart
           vertically with a real 0.8 ft solid course between them. Sharing an x
           span and disjoint in y is legal and is what a two-storey elevation
           is; it is also the only way to get a horizontal line into glass this
           tall, because the engine draws no transoms. */
        openings: [
          opening("glass-s-lower", "s", "glazing-wall", 18, 9.2, 2, 0),
          opening("glass-s-upper", "s", "glazing-wall", 18, 8.4, 2, 10),
          opening("door-s", "s", "door", 3, 6.8, 20.5),
          opening("win-n1", "n", "window", 4, 4, 5, 3.5),
          opening("win-n2", "n", "window", 4, 4, 15, 3.5),
          opening("win-n3", "n", "window", 4, 3.5, 5, 13),
          opening("win-n4", "n", "window", 4, 3.5, 15, 13),
          opening("win-w1", "w", "window", 3, 4, 5, 3),
          opening("win-w2", "w", "window", 3, 4, 5, 12),
        ],
        /* The mass's east wall carries no openings, and the reason is worth
           writing down instead of implying. The bar covers only the LOWER part
           of it: the bar stands 11 ft, 11.5 ft to the top of its parapet, while
           the mass is two storeys at 9.5 and stands 19. Twenty feet of depth by
           the remaining 7.5 ft is about 150 sq ft of real exposed wall above the
           bar's roof, fully in view from the south-east camera, and the plan's
           "eight-foot step to the low bar" is exactly that band. It is left
           blank because a window there would look out at eye level across a
           flat roof, not because anything is covering it. */
      }),
      volume({
        id: "bar",
        name: "Garden bar",
        width: 12,
        depth: 20,
        x: 10,
        height: 11,
        roof: "flat",
        facing: "e",
        openings: [
          opening("glass-s", "s", "glazing-wall", 9, 10, 1.5, 0),
          opening("win-e1", "e", "window", 4, 5, 4, 2.5),
          opening("win-e2", "e", "window", 4, 5, 11, 2.5),
          opening("win-n", "n", "window", 4, 3, 4, 6.5),
          opening("door-n", "n", "door", 2.8, 6.8, 8.5),
        ],
      }),
    ],
    deck: { width: 16, depth: 10 },
    notes:
      "Aura-authored stacked concept. Modelled glazing is 23% of the modelled wall area, above the 22% NBC 9.36 prescriptive ceiling, and it goes on the performance path with triple glazing, a low-conductance frame and measured airtightness. The honest part is where the glass is: 317 sq ft of it sits on one south wall of one volume, which is the only orientation at 53.5 degrees north that gives anything back in December, and every one of the other elevations is punched rather than glazed. The north street elevation is the second-largest share and the record should name it: 72 sq ft of window, 13% of the plan's glass, across four openings on the two-storey mass and one on the garden bar. It is there for cross-light, for egress from the upstairs bedrooms and because a blank street face is a bad neighbour, and none of it collects a winter beam. What stacking buys is 1,200 sq ft of floor on 152 ft of exterior wall, the least skin per square foot in this wave — stacking is the cheapest envelope move there is, which is why an elevation this glassy still lands only a point over the reference. What it costs: an upper-floor glazing wall cannot be shaded by an eighteen-inch eave and will run hot on a bright February afternoon unless there is real thermal mass inside the insulation, and eighteen feet of cold inner surface drives a downdraft that wants a heat source at its base. The stair, its landings and the floor opening are not modelled at all, a two-storey glazed volume wants a high-level vent for summer stack effect, and the guard at the upper glazing is the authority having jurisdiction's call — all three are professional design, and nothing here computes an overheating hour.",
  }),

  original({
    id: "arbeidsgard-house",
    title: "Arbeidsgård",
    kicker: "800 sq ft · house and shop in line",
    summary:
      "A house with a fourteen-foot workshop standing against its west wall — the living end takes the south and east light, and the shop takes the weather.",
    bestFor: "A trade run from home, where the shop is the north-west windbreak",
    bedrooms: 1,
    bathrooms: 1.5,
    sleeping: "One enclosed bedroom",
    storeys: 1,
    tags: ["800–1,200 sq ft", "one bedroom", "live work", "flat roof"],
    features: [
      "Ten-foot overhead door",
      "Shop stands against the weather side",
      "Three-and-a-half-foot step in the roof",
    ],
    material: "sip",
    costBasis: {
      status: "proxy",
      label: "Dwelling-rate + glazing proxy",
      note:
        "A trade workshop attached to a dwelling carries different structure, fire separation, ventilation and use. The drawing records the massing only.",
    },
    volumes: [
      volume({
        id: "house",
        name: "House",
        width: 26,
        depth: 20,
        height: 11.5,
        roof: "flat",
        facing: "n",
        /* The house's west wall is the junction with the shop over its whole
           depth and height, so it carries nothing. An opening on a wall another
           volume stands against is drawn into a face nobody can see and no gate
           in the repo reports it. */
        openings: [
          opening("glass-s", "s", "glazing-wall", 16, 10.9, 2.5, 0),
          opening("door-s", "s", "door", 3, 6.8, 19),
          opening("win-s", "s", "window", 3, 4, 22.5, 3),
          opening("cler-n1", "n", "window", 4, 3, 5, 6.5),
          opening("cler-n2", "n", "window", 4, 3, 17, 6.5),
          opening("glass-e", "e", "glazing-wall", 8, 10.2, 3.5, 0),
        ],
      }),
      volume({
        id: "shop",
        name: "Workshop",
        width: 14,
        depth: 20,
        x: -20,
        /* 15 against the house's 11.5, a 3.5 ft step. It was 14, which is a
           2.5 ft step — physically sound, and sitting exactly on the `< 2.5`
           boundary of the interpenetration gate, so a later half-foot edit in
           either direction would have decided whether the plan was reported. A
           gate a plan sits exactly on is not protecting it. */
        height: 15,
        roof: "flat",
        facing: "w",
        openings: [
          opening("glass-s", "s", "glazing-wall", 8, 10.5, 2, 0),
          /* An overhead door is a `door`, so it enters neither the glazed area
             nor the ratio — which is correct, and is also why it is the one
             opening in this wave that can be ten feet square. */
          opening("overhead-w", "w", "door", 10, 10, 4),
          opening("cler-w", "w", "window", 3, 3, 15, 8.5),
          opening("cler-n1", "n", "window", 4, 3, 4, 8.5),
          opening("cler-n2", "n", "window", 4, 3, 9, 8.5),
        ],
      }),
    ],
    deck: { width: 14, depth: 9 },
    notes:
      "Aura-authored live/work concept, modelled at 20% glazing, inside the 22% NBC 9.36 prescriptive reference. A workshop is what makes that figure honest rather than clever: a shop with one overhead door and four small windows drags the whole-building ratio down while the house end still carries a sixteen-foot glazing wall. It would be false to write that this plan keeps the glass modest, and measuring the house on its own is worse than the average rather than better. The house end carries 292 sq ft of glass. Perimeter times wall height gives it 1,058 sq ft of wall, but 230 sq ft of that is the west face the shop stands against, so the house has about 828 sq ft of real exterior wall and its own glazing share is nearer 35% than the 20% this record publishes for the pair. That is the number to argue with, and the 20% is the modelled one only because the model counts a buried face as wall. The 82 sq ft of east glazing on the house is the weakest orientation in the plan and is here for the working side of the site: low June morning sun at 53.5 degrees north arrives from north of east, no horizontal eave can shade it, and it returns almost nothing in December. The shop is drawn as a conditioned volume because this model has no other category, so its 280 sq ft is in the published area and in the cost range whether or not it is heated in January. A trade run from an attached shop raises fire separation, ventilation and use classification in every Alberta municipality, and that is a designer's and the authority having jurisdiction's question before it is an architectural one. The shop stands against the house's west wall so that elevation is sheltered rather than exposed; the model still draws both walls, and a real drawing resolves them into one assembly.",
  }),

  original({
    id: "tyngdegard-house",
    title: "Tyngdegård",
    kicker: "872 sq ft · two bars, one slot",
    summary:
      "Two rammed-earth bars a dozen feet apart with a slot of sheltered ground between them — the long bar stands north of the slot and opens onto it, and the low bar keeps its glass on the outward south face where the sun is.",
    bestFor: "A heavy-walled build that wants an outdoor room without a courtyard",
    bedrooms: 2,
    bathrooms: 1.5,
    sleeping: "Two bedrooms in the long bar",
    storeys: 1,
    tags: ["800–1,200 sq ft", "two bedroom", "thermal mass", "flat roof"],
    features: ["Two bars, twelve feet apart", "Every glazing wall faces south", "Punched openings on the other faces"],
    material: "rammed_earth",
    costBasis: glazingProxy(
      "Rammed-earth + glazing proxy",
      "Rammed-earth walls are formed and compacted on site around an insulated core, need an engineer and a specialist contractor, and are heavy enough to change the foundation.",
    ),
    volumes: [
      volume({
        id: "long",
        name: "Long bar",
        width: 32,
        depth: 16,
        z: -12,
        height: 11,
        roof: "flat",
        facing: "n",
        openings: [
          opening("glass-s", "s", "glazing-wall", 12, 10.2, 2, 0),
          opening("door-s", "s", "door", 3, 6.8, 14.6),
          opening("win-s1", "s", "window", 5, 4.5, 18.5, 2.5),
          opening("win-s2", "s", "window", 5, 4.5, 25, 2.5),
          opening("win-n1", "n", "window", 3, 3.5, 5.5, 5),
          opening("win-n2", "n", "window", 3, 3.5, 14.5, 5),
          opening("win-n3", "n", "window", 3, 3.5, 23.5, 5),
          opening("win-e", "e", "window", 2.5, 4, 4.5, 3),
          opening("win-w", "w", "window", 2.5, 4, 4.5, 3),
        ],
      }),
      volume({
        id: "low",
        name: "Low bar",
        width: 24,
        depth: 15,
        x: -2,
        z: 15.5,
        height: 8.5,
        roof: "flat",
        /* Twelve feet of clear ground between the two bars. Each carries a
           1.5 ft eave, so the slabs still stand nine feet apart — the only
           separation in this wave where the gap, rather than a height step, is
           what keeps two roofs out of one another. */
        facing: "s",
        /* THE GLAZING WALL MOVED, AND THE REASON IS THE WHOLE PLAN.
           This bar stands SOUTH of the slot, so its slot-facing wall is its
           north one. The first draft put a 15 × 7.9 ft glazing wall there —
           118.5 sq ft, the largest single pane in the plan, 33% of its glass —
           on the argument that the slot is the sheltered side. Sheltered from
           wind is not the same as facing the sun. That pane took no direct beam
           between the equinoxes and lost heat around the clock through a
           rammed-earth envelope already at about R-26.
           It is now on the outward SOUTH face. The slot is lit from the long
           bar's south wall instead, which is the face that collects, and the
           low bar's north wall keeps two punched windows onto the slot. The
           south wall is the LOW side of this roof's fall, so the pane is 7.4 ft
           rather than 7.9 — the seated head there is 7.75 ft, and 7.9 would
           have been trimmed in silence. */
        openings: [
          opening("glass-s", "s", "glazing-wall", 15, 7.4, 2, 0),
          opening("door-s", "s", "door", 2.8, 6.8, 18),
          opening("win-n1", "n", "window", 3, 3, 4, 4),
          opening("win-n2", "n", "window", 3, 3, 16, 4),
          opening("win-e", "e", "window", 2.5, 3, 4, 3.5),
        ],
      }),
    ],
    deck: { width: 14, depth: 8 },
    notes:
      "Aura-authored two-bar concept, modelled at 21% glazing, inside the 22% NBC 9.36 prescriptive reference — and that restraint is the argument rather than an accident. Rammed earth is about R-26 against SIP's R-40, and it is mass rather than resistance, so in zone 7A this wall only works with an insulated core and the drawing does not model that core. Holding the ratio to 21% is part of how a heavy wall stays defensible here, and putting the glass where the sun is doing the rest of it. An earlier draft of this plan hung its largest pane — a 15 ft glazing wall — on the low bar's north face, looking across the slot, and called the slot faces sheltered. Sheltered from wind and facing the sun are two different properties, and only one of them heats a room. Both glazing walls now face south, and the compass numbers are these: 278 sq ft of the plan's 355 sq ft of glass is on south walls, 49.5 sq ft across five punched windows is on north walls for cross-light and egress, and the east and west ends carry 27.5 sq ft between them. The two buildings carry ten punched windows in all. The 450 mm wall sets the glass about 5.3 in behind the outer face, which is a real shadow line on a real building and shades perhaps seven percent of a south pane at the June noon altitude — a nice detail, not a shading strategy, and it should not be priced as one. What the plan costs is two foundations, two roofs and a walk outside between them, and the shared bill of materials does not price rammed earth at all. The wall assembly, the insulated core, the foundation and the thermal bridge at each reveal belong to an engineer, and an energy advisor confirms whether the mass is placed where it can do the work this plan claims for it.",
  }),

  /* ────────────────────────────────────────────────────────────────────────
     THREE AND FOUR VOLUMES — in-line and comb compositions. No courtyards: the
     builder's first frame and the catalog thumbnail both look from the
     south-east at roughly 17 to 20 degrees above the horizon, so an enclosed
     court is a plan figure the buyer never sees, and glass turned inward is
     glass paid for and not rendered.
     ──────────────────────────────────────────────────────────────────────── */

  original({
    id: "tredelt-pavilion",
    title: "Tredelt Pavilion",
    kicker: "880 sq ft · three roofs in a line",
    summary:
      "Three flat roofs in a line — a tall glazed hall in the middle, two low bedroom bars butting into it left and right — so the building is forty-four feet long and sixteen feet of the middle is glass.",
    bestFor: "Two bedrooms that want to be a long way from the living room",
    bedrooms: 2,
    bathrooms: 2,
    sleeping: "One bedroom in each end bar",
    storeys: 1,
    tags: ["800–1,200 sq ft", "two bedroom", "flat roof", "clerestory"],
    features: ["Low plate, high plate, low plate", "Hall glazed nearly full height", "Bedroom windows kept small"],
    material: "timber_frame",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "One sixteen-foot hall wall and two seven-foot bedroom walls, three glazing walls in all.",
    ),
    volumes: [
      volume({
        id: "hall",
        name: "Hall",
        width: 22,
        depth: 22,
        height: 13,
        roof: "flat",
        facing: "n",
        openings: [
          opening("glass-s", "s", "glazing-wall", 16, 12.3, 3, 0),
          /* The door's west jamb touches the glass at x = 19. Touching is a
             shared mullion and is legal; only a positive overlap in both axes
             is a defect. */
          opening("door-s", "s", "door", 3, 7, 19),
          opening("cler-n1", "n", "window", 7, 3, 3, 8.5),
          opening("cler-n2", "n", "window", 7, 3, 12, 8.5),
        ],
      }),
      volume({
        id: "bar-w",
        name: "West bar",
        width: 11,
        depth: 18,
        x: -16.5,
        height: 9.5,
        roof: "flat",
        facing: "n",
        openings: [
          opening("glass-s", "s", "glazing-wall", 7, 8.8, 2, 0),
          opening("win-w", "w", "window", 3, 4.5, 5, 2.5),
          opening("win-n", "n", "window", 3, 2.5, 4, 5.5),
        ],
      }),
      volume({
        id: "bar-e",
        name: "East bar",
        width: 11,
        depth: 18,
        x: 16.5,
        height: 9.5,
        roof: "flat",
        facing: "n",
        openings: [
          opening("glass-s", "s", "glazing-wall", 7, 8.8, 2, 0),
          opening("door-e", "e", "door", 3, 6.8, 4),
          opening("win-e", "e", "window", 3, 4.5, 10, 2.5),
          opening("win-n", "n", "window", 3, 2.5, 4, 5.5),
        ],
      }),
    ],
    deck: { width: 18, depth: 10 },
    notes:
      "Aura-authored three-bar concept, modelled at 18% glazing, inside the 22% NBC 9.36 prescriptive reference. The composition argument is where the glass is not: 239 sq ft sits on the room people gather in and 165 sq ft is spread across two sleeping bars, and the building lands at 18% because the bedroom windows stayed small. The clerestories at an 8.5 ft sill put light into the middle of a twenty-two-foot-deep hall where a wall of glass at eye level cannot reach. The north side carries 57 sq ft across four openings — two clerestories over the hall at an 8.5 ft sill and one small window in each bedroom bar — which is 14% of the plan's glass on the face that returns nothing in December, and it is there for cross-light rather than for gain. Two things about the percentage should be said rather than banked. First, the end bars lowered it by adding wall area, not by removing glass, and the arithmetic is generous as well as honest: the denominator is perimeter times height with no deduction where volumes meet, so the 18 ft face where each bar meets the hall is counted on both volumes, about 700 of the 2,246 sq ft this 18% divides by. Nobody should read 18% as meaning the hall got less glassy. Second, three volumes is three foundations, three roofs and two junctions where flashing and snow both collect, and the model counts every square foot of all three as conditioned floor area whether the far bar is heated in February or not. The two junctions and the drift load against a 3 ft 6 in step are an engineer's drawing; nothing here computes a heat loss or a solar gain to support any of it.",
  }),

  original({
    id: "trappelys-terrace",
    title: "Trappelys Terrace",
    kicker: "1,248 sq ft · three roof planes",
    summary:
      "Three flat roof planes stepping up to the north, each riser turned into a south-facing light slot over the roof below it.",
    bestFor: "A larger family plan that wants daylight in the middle of it",
    bedrooms: 3,
    bathrooms: 2,
    sleeping: "Three bedrooms up the steps",
    storeys: 2,
    tags: ["1,200+ sq ft", "three bedroom", "flat roof", "clerestory"],
    features: ["Three planes, two risers", "Light slots over each roof", "Two-storey glass at the east end"],
    material: "sip",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "A fifteen-foot south wall and a fifteen-foot-tall two-storey east wall, both glazing walls.",
    ),
    volumes: [
      volume({
        id: "bar-s",
        name: "South bar",
        width: 24,
        depth: 13,
        z: 13,
        height: 8.5,
        roof: "flat",
        facing: "s",
        openings: [
          opening("glass-s", "s", "glazing-wall", 15, 7.5, 4.5, 0),
          opening("door-s", "s", "door", 3, 6.8, 20.5),
          opening("win-e", "e", "window", 4, 4, 4, 3),
          opening("win-w", "w", "window", 4, 4, 4, 3),
        ],
      }),
      volume({
        id: "bar-m",
        name: "Middle bar",
        width: 24,
        depth: 13,
        height: 12,
        roof: "flat",
        facing: "n",
        /* Sill 9.3 clears the south bar's parapet top at 9.0. After the 0.9 ft
           slab, the 0.5 ft lip and the seat the wall takes under its own roof,
           a 3.5 ft height step leaves about a 2 ft light slot. That is the real
           number and the notes publish it rather than promising a band. */
        openings: [
          opening("riser-1", "s", "window", 6.5, 2, 1.3, 9.3),
          opening("riser-2", "s", "window", 6.5, 2, 8.8, 9.3),
          opening("riser-3", "s", "window", 6.5, 2, 16.3, 9.3),
          /* The middle bar's north wall is the junction with a taller two-storey
             bar and is buried over its whole height, so it carries nothing. Its
             daylight comes from the risers above and two east windows. */
          opening("win-e1", "e", "window", 3, 5, 4, 2.5),
          opening("win-e2", "e", "window", 3, 5, 8, 2.5),
          opening("win-w", "w", "window", 3, 5, 4, 2.5),
        ],
      }),
      volume({
        id: "bar-n",
        name: "North bar",
        width: 24,
        depth: 13,
        z: -13,
        storeys: 2,
        height: 8,
        roof: "flat",
        facing: "n",
        openings: [
          opening("riser-1", "s", "window", 6.5, 2, 1.3, 12.8),
          opening("riser-2", "s", "window", 6.5, 2, 8.8, 12.8),
          opening("riser-3", "s", "window", 6.5, 2, 16.3, 12.8),
          opening("win-n1", "n", "window", 5, 4, 3.5, 3),
          opening("win-n2", "n", "window", 5, 4, 3.5, 10.5),
          opening("win-n3", "n", "window", 5, 4, 15.5, 3),
          opening("win-n4", "n", "window", 5, 4, 15.5, 10.5),
          opening("glass-e", "e", "glazing-wall", 9, 15, 1.5, 0),
          opening("win-w1", "w", "window", 4, 4, 4, 3),
          opening("win-w2", "w", "window", 4, 4, 4, 10.5),
        ],
      }),
    ],
    deck: { width: 18, depth: 9 },
    notes:
      "Aura-authored stepped-section concept, modelled at 19% glazing, inside the 22% NBC 9.36 prescriptive reference. Be blunt about what a 3 ft 6 in step actually yields: after the 0.9 ft roof slab, the 0.5 ft upstand and the seat the wall takes under its roof, each riser leaves a light slot a little over two feet tall. That is worth having, and worth describing accurately: the slot's head sits at about 11 ft 4 in, which is high enough to wash the ceiling at the back of a thirteen-foot-deep bar, where a window with its head at 6 ft 6 in is already running out. Daylight cannot travel further into a room than the room is deep, so what the riser buys is the last few feet and an even light off the ceiling — not eight extra feet of room — and it is not the band a section drawing would let you imagine. It costs two extra roof-to-wall junctions, two upstands that must be flashed into a vertical wall, and a snow pocket at each step that an engineer details for drifting. The 135 sq ft east glazing wall is the weakest part of the argument and the plan should not pretend otherwise: low June morning sun at 53.5 degrees north arrives from north of east, no horizontal eave can shade it, and it gives back almost nothing in December. It is also not the whole of it. This is the least south-led plan in the wave and the record has to say which way the rest of the glass points: 181 sq ft is on east walls, 35% of the plan's total and nearly as much as the 190 sq ft on the south; 80 sq ft of north window lights the three bedrooms and gives them their egress; and 63 sq ft is on west walls, which is the pane most likely to overheat a bedroom on a July evening and the hardest orientation on this building to shade. Only the south 190 collects a December beam. This model has no per-volume floor level, so the two-storey bar's internal plate and the middle bar's roof are drawn at their own heights and a real section has to reconcile them; that reconciliation, and the stair the model does not draw, are professional design.",
  }),

  original({
    id: "lysrekke-house",
    title: "Lysrekke House",
    kicker: "750 sq ft · three lanterns in a row",
    summary:
      "One long low bar with three small tall lanterns standing in a row behind it, each glazed north and south at the top so light drops into three rooms from above.",
    bestFor: "Three bedrooms that each want their own light",
    bedrooms: 3,
    bathrooms: 2,
    sleeping: "Three bedrooms, one under each lantern",
    storeys: 1,
    tags: ["400–800 sq ft", "three bedroom", "flat roof", "clerestory"],
    features: [
      "Three identical lanterns",
      "Twenty-five-foot south screen",
      "Four-and-a-half-foot slots between the masses",
    ],
    material: "sip",
    costBasis: glazingProxy(
      "Glazing-package proxy",
      "One twenty-five-foot glazing wall on the living bar, and none on the lanterns.",
    ),
    volumes: [
      volume({
        id: "bar",
        name: "Living bar",
        width: 34,
        depth: 15,
        z: 7.5,
        height: 10,
        roof: "flat",
        facing: "s",
        openings: [
          opening("glass-s", "s", "glazing-wall", 25, 8.9, 4, 0),
          opening("door-s", "s", "door", 3, 6.8, 30),
          /* Both north windows fall in the 4.5 ft gaps between lanterns and are
             symmetric about the wall's midpoint, so they sit in real wall from
             either end, with about 0.6 ft to spare at the tighter jamb. */
          opening("win-n1", "n", "window", 3, 3, 9.4, 5.5),
          opening("win-n2", "n", "window", 3, 3, 21.6, 5.5),
          opening("win-e", "e", "window", 4, 4.5, 4.5, 2.5),
          opening("win-w", "w", "window", 4, 4.5, 4.5, 2.5),
        ],
      }),
      /* THE LANTERNS, AND TWO THINGS THAT CHANGED.
         They are 8 ft wide rather than 9, which puts 4.5 ft of clear ground
         between them instead of 3.5. geometry.ts reports wall-footprint overlap
         and says nothing about roof slabs, so two masses closer than the sum of
         their 1.5 ft eaves interpenetrate in silence; 3.5 sat exactly on that
         3.5 ft threshold, which is a pass with no margin and one half-foot edit
         from being a defect.
         They are also genuinely identical now, which is what the feature bullet
         claims. The two end lanterns used to carry a 5 × 9 ft glazing wall each
         on their east and west faces — 90 sq ft, 17% of the plan's glass, on
         two bedroom elevations nothing can shade — while the centre one carried
         small windows. A lantern's south face is buried behind the bar below
         10.5 ft, so a lantern's only candidates for a full-height pane are
         east, west and north, and at 53.5 degrees north none of the three is
         defensible at that size on a bedroom. The panes are gone rather than
         moved. */
      ...(["w", "c", "e"] as const).map((suffix, i) =>
        volume({
          id: `box-${suffix}`,
          name: `${["West", "Centre", "East"][i]} lantern`,
          width: 8,
          depth: 10,
          x: (i - 1) * 12.5,
          z: -5,
          /* Falls north, away from the bar, on all three: the south wall is
             then the HIGH side and the two clerestories keep their head. */
          facing: "n",
          height: 14,
          roof: "flat",
          openings: [
            opening("cler-s", "s", "window", 6.5, 2.3, 0.75, 10.8),
            opening("cler-n", "n", "window", 6.5, 2.3, 0.75, 10.8),
            opening("win-n", "n", "window", 4, 4, 2, 3),
            opening("win-e", "e", "window", 3, 3.5, 3, 3.5),
            opening("win-w", "w", "window", 3, 3.5, 3, 3.5),
          ],
        }),
      ),
    ],
    deck: { width: 18, depth: 9 },
    notes:
      "Aura-authored comb, modelled at 19% glazing, inside the 22% NBC 9.36 prescriptive reference. Four volumes is four times the junction count, and the wall figure wants care before it is quoted: perimeter times height gives 206 ft of wall run for 750 sq ft of floor, but the 8 ft face where each lantern meets the bar is counted on both volumes, so about 48 ft of that is not exterior wall and the real figure is nearer 158 ft. Either way a cluster of small volumes is the reliable way to spend an envelope without noticing, and this one was measured against the library's own worst case before the plan was drawn rather than after. What it buys is that each of the three bedrooms is lit from above on two sides — a north band for even light and a south band for the low December beam — instead of by one window on one wall, which lets the long bar in front be a single room with one continuous south wall and almost nothing else. An earlier draft gave the two end lanterns a 5 by 9 ft glazing wall each, one facing east and one facing west, which was 90 sq ft of unshadeable full-height glass on two bedroom walls and 17% of the plan's glass; those panes are gone and the three lanterns are now identical, which is what the feature bullet always claimed. North still carries 111 sq ft, 23% of the remaining glass, and that is a decision rather than an oversight: the north bands are there for even daylight and the north windows are the bedrooms' egress, and none of it collects a beam in December. The bands are about 2 ft 4 in tall, which is what is left once the bar's slab and upstand are cleared, and that is the number rather than a wall of light. The slots between the lanterns are 4 ft 6 in of ground, and once each roof takes its 1.5 ft eave about 1 ft 6 in of open sky between fourteen-foot masses — a slot, not a courtyard, and the feature bullet gives the ground dimension rather than promising sky. Snow drifting into two slots that narrow is a real load case for the engineer, not a detail, and an energy advisor should confirm whether three small tall volumes earn their skin on this site.",
  }),
];
