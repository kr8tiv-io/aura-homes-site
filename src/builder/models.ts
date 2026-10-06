/**
 * The twelve locked rooms, each started from a glass-catalog plan.
 * The old Nordic titles stay in the catalog. The form speaks the room names.
 */
import { collectionAddons, standaloneBySlug } from '../data/collection';
import { roomConcepts, type RoomConcept } from '../lib/rooms';
import { builderDocumentFromLegacySpec, type BuilderDocument } from './core/document';
import { addFixture, emptyFixtureSet, type FixtureKindId, type FixtureSet } from './core/fixtures';
import { GLASS_PLAN_TEMPLATES } from './core/planCatalog.glass';
import { clamp, LIMITS, snap } from './ui/edits';
import { SPEC_VERSION, type Deck, type HomeSpec, type Volume } from './core/spec';

export type OrderSize = 'snug' | 'room' | 'long';
export type OrderGlaze = 'clear' | 'tinted' | 'mirror';
export type WoodFinish = 'cedar' | 'thermowood';

export const STANDALONE_SLUGS = ['hot-tub-time-machine', 'cool-runnings', 'fire-and-ice'] as const;

export function isStandalone(slug: string): boolean {
  return (STANDALONE_SLUGS as readonly string[]).includes(slug);
}

/** Hot Tub Time Machine and the Fire and Ice pair draw the site hot tub. */
export function standaloneShowsTub(slug: string): boolean {
  return slug === 'hot-tub-time-machine' || slug === 'fire-and-ice';
}

export const WOOD_FINISHES: { id: WoodFinish; label: string; note: string }[] = [
  { id: 'cedar', label: 'Western red cedar', note: 'The grain, oiled and warm.' },
  { id: 'thermowood', label: 'Thermowood', note: 'Heat-treated timber, quieter in colour.' },
];

export const ORDER_SIZES: { id: OrderSize; label: string; note: string; factor: number }[] = [
  { id: 'snug', label: 'Snug', note: 'A little closer to the glass.', factor: 0.82 },
  { id: 'room', label: 'Room', note: 'The plan as it was drawn.', factor: 1 },
  { id: 'long', label: 'Long', note: 'More floor, same quiet.', factor: 1.18 },
];

const PLAN_BY_SLUG: Record<string, string> = {
  'the-soak': 'terskel-pavilion',
  'chapter-one': 'langsikt-pavilion',
  'the-plus-one': 'ramme-pavilion',
  'the-stargazer': 'snofang-clerestory',
  'cloud-nine': 'stabel-house',
  'nothing-to-see-here': 'soylegang-pavilion',
  'hot-take': 'terskel-pavilion',
  'root-access': 'tredelt-pavilion',
  'of-course-i-still-tow-you': 'ramme-pavilion',
  'the-forest-edge': 'tyngdegard-house',
  'siddharthas-a-wing': 'hoyvegg-pavilion',
  'pandoras-glass-stairway': 'trappelys-terrace',
};

export const TUB_MODELS = new Set(['the-soak', 'hot-take']);

export type OrderAddon = {
  id: string;
  name: string;
  detail?: string;
  kind?: FixtureKindId;
};

const coming = collectionAddons.items;

function addon(id: string, name: string, detail: string | undefined, kind?: FixtureKindId): OrderAddon {
  return { id, name, detail, kind };
}

export const ORDER_ADDONS: OrderAddon[] = [
  addon('full-solar', coming[0].name, coming[0].detail, 'solar-array'),
  addon('hearth', coming[1].name, coming[1].detail, 'wood-stove'),
  addon('furnace', coming[2].name, coming[2].detail),
  addon('floors', coming[3].name, coming[3].detail),
  addon('ewok', coming[4].name, coming[4].detail),
  addon('spider', coming[5].name, coming[5].detail),
  addon('hansolo', coming[6].name, coming[6].detail),
  addon('restaurant', coming[7].name, coming[7].detail),
  addon('breakfast', coming[8].name, coming[8].detail),
  addon('pizza', coming[9].name, coming[9].detail),
  addon('sauna', coming[10].name, coming[10].detail),
  addon('hoth', coming[11].name, coming[11].detail),
  addon('thirst', coming[12].name, coming[12].detail, 'awg'),
  addon('farms', coming[13].name, coming[13].detail),
  addon('cedar-tub', 'Cedar tub', 'A wood-fired tub on the deck.', 'hot-tub'),
  addon('battery', 'Battery bank', 'Stored sun, for the quiet hours.', 'battery-bank'),
  addon('firewood', 'Firewood store', 'A dry stack beside the room.', 'firewood-store'),
  addon('composting', 'Composting', 'A quiet place for the scraps.'),
];

const planById = new Map(GLASS_PLAN_TEMPLATES.map((plan) => [plan.id, plan]));

function token(notes: string, key: string): string | null {
  const match = notes.match(new RegExp(`\\[aura-${key}:([^\\]]+)\\]`));
  return match ? match[1] : null;
}

function writeToken(notes: string, key: string, value: string): string {
  const line = `[aura-${key}:${value}]`;
  const pattern = new RegExp(`\\[aura-${key}:[^\\]]+\\]`);
  if (pattern.test(notes)) return notes.replace(pattern, line);
  const trimmed = notes.trim();
  return trimmed ? `${trimmed}\n${line}` : line;
}

function scaleVolume(volume: Volume, factor: number): Volume {
  const widthFt = snap(clamp(volume.widthFt * factor, LIMITS.widthFt.min, LIMITS.widthFt.max), LIMITS.widthFt.step);
  const depthFt = snap(clamp(volume.depthFt * factor, LIMITS.depthFt.min, LIMITS.depthFt.max), LIMITS.depthFt.step);
  const wallHeightFt = snap(
    clamp(volume.wallHeightFt * (factor === 1 ? 1 : 0.5 + factor / 2), LIMITS.wallHeightFt.min, LIMITS.wallHeightFt.max),
    LIMITS.wallHeightFt.step,
  );
  const widthRatio = widthFt / volume.widthFt;
  const depthRatio = depthFt / volume.depthFt;
  return {
    ...volume,
    widthFt,
    depthFt,
    wallHeightFt,
    openings: volume.openings.map((opening) => {
      const alongWall = opening.wall === 'n' || opening.wall === 's';
      const along = alongWall ? widthRatio : depthRatio;
      const run = alongWall ? widthFt : depthFt;
      const width = snap(
        clamp(opening.widthFt * along, LIMITS.openingWidthFt.min, Math.min(LIMITS.openingWidthFt.max, run)),
        LIMITS.openingWidthFt.step,
      );
      return {
        ...opening,
        widthFt: width,
        heightFt: snap(
          clamp(opening.heightFt * (wallHeightFt / volume.wallHeightFt), LIMITS.openingHeightFt.min, Math.min(LIMITS.openingHeightFt.max, wallHeightFt)),
          LIMITS.openingHeightFt.step,
        ),
        offsetFt: snap(clamp(opening.offsetFt * along, 0, Math.max(0, run - width)), LIMITS.openingWidthFt.step),
      };
    }),
  };
}

function scaleDeck(deck: Deck | null, factor: number): Deck | null {
  if (!deck) return null;
  return {
    ...deck,
    widthFt: snap(clamp(deck.widthFt * factor, LIMITS.deckFt.min, LIMITS.deckFt.max), LIMITS.deckFt.step),
    depthFt: snap(clamp(deck.depthFt * factor, LIMITS.deckFt.min, LIMITS.deckFt.max), LIMITS.deckFt.step),
  };
}

export function roomForSlug(slug: string): RoomConcept | undefined {
  return roomConcepts.find((room) => room.slug === slug);
}

/** Finish is its own step. The rest are the piece's add-ons. */
export function standaloneAddons(slug: string): OrderAddon[] {
  const product = standaloneBySlug(slug);
  if (!product) return [];
  return product.addons
    .filter((item) => item.id !== 'finish')
    .map((item) => addon(`${slug}:${item.id}`, item.name, item.detail));
}

const PIECE_VOLUME: Volume = {
  id: 'piece',
  name: 'Piece',
  widthFt: 8,
  depthFt: 8,
  x: 0,
  z: 0,
  rotationDeg: 0,
  storeys: 1,
  wallHeightFt: 8,
  roof: { form: 'flat', pitchDeg: 1, overhangFt: 0.5 },
  openings: [],
};

export function selectionFromDocument(doc: BuilderDocument): {
  slug: string;
  size: OrderSize;
  glaze: OrderGlaze;
  plain: string[];
  kinds: FixtureKindId[];
} {
  const notes = doc.spec.notes;
  const slug = token(notes, 'model') ?? 'the-soak';
  const sizeToken = token(notes, 'size');
  const glazeToken = token(notes, 'glaze');
  const plainToken = token(notes, 'plain');
  const size: OrderSize = sizeToken === 'snug' || sizeToken === 'long' ? sizeToken : 'room';
  const glaze: OrderGlaze = glazeToken === 'tinted' || glazeToken === 'mirror' ? glazeToken : 'clear';
  const plain = plainToken ? plainToken.split(',').filter(Boolean) : [];
  const woodToken = token(notes, 'wood');
  const wood: WoodFinish = woodToken === 'thermowood' ? 'thermowood' : 'cedar';
  const kinds = doc.fixtures.items.map((item) => item.kind);
  return { slug, size, glaze, wood, plain, kinds };
}

export function buildOrderDocument(input: {
  slug: string;
  size: OrderSize;
  glaze: OrderGlaze;
  wood: WoodFinish;
  plain: readonly string[];
  kinds: readonly FixtureKindId[];
}): BuilderDocument {
  if (isStandalone(input.slug)) return buildStandaloneDocument(input);
  const room = roomForSlug(input.slug) ?? roomConcepts[0];
  const plan = planById.get(PLAN_BY_SLUG[room.slug] ?? 'ramme-pavilion') ?? GLASS_PLAN_TEMPLATES[0];
  const factor = ORDER_SIZES.find((item) => item.id === input.size)?.factor ?? 1;
  const base = structuredClone(plan.spec) as HomeSpec;
  let spec: HomeSpec = {
    ...base,
    name: room.name,
    volumes: base.volumes.map((volume) => {
      const scaled = scaleVolume(volume, factor);
      if (room.slug !== 'siddharthas-a-wing') return scaled;
      return { ...scaled, roof: { ...scaled.roof, form: 'a-frame', pitchDeg: 52 } };
    }),
    deck: scaleDeck(base.deck, factor),
    notes: base.notes,
  };
  const wantsTub = input.kinds.includes('hot-tub');
  if (wantsTub) {
    spec = {
      ...spec,
      deck: spec.deck
        ? { ...spec.deck, hotTub: true }
        : { wall: 's', widthFt: 12, depthFt: 8, hotTub: true },
    };
  } else if (spec.deck) {
    spec = { ...spec, deck: { ...spec.deck, hotTub: false } };
  }
  let notes = spec.notes;
  notes = writeToken(notes, 'model', room.slug);
  notes = writeToken(notes, 'size', input.size);
  notes = writeToken(notes, 'glaze', input.glaze);
  notes = writeToken(notes, 'plain', input.plain.join(','));
  spec = { ...spec, notes };
  let fixtures: FixtureSet = emptyFixtureSet();
  for (const kind of input.kinds) {
    const added = addFixture(spec, fixtures, kind);
    if (added.set) fixtures = added.set;
  }
  const document = builderDocumentFromLegacySpec(spec);
  return { ...document, fixtures };
}

function buildStandaloneDocument(input: {
  slug: string;
  size: OrderSize;
  glaze: OrderGlaze;
  wood: WoodFinish;
  plain: readonly string[];
  kinds: readonly FixtureKindId[];
}): BuilderDocument {
  const product = standaloneBySlug(input.slug);
  const tub = standaloneShowsTub(input.slug);
  const deck: Deck | null = tub ? { wall: 's', widthFt: 12, depthFt: 10, hotTub: true } : null;
  let notes = '';
  notes = writeToken(notes, 'model', input.slug);
  notes = writeToken(notes, 'size', input.size);
  notes = writeToken(notes, 'glaze', 'clear');
  notes = writeToken(notes, 'wood', input.wood);
  notes = writeToken(notes, 'plain', input.plain.join(','));
  const spec: HomeSpec = {
    version: SPEC_VERSION,
    name: product?.name ?? input.slug,
    material: 'sip',
    climateZone: '7A',
    volumes: [{ ...PIECE_VOLUME }],
    deck,
    siting: { frontFacesDeg: 180, slope: 'flat' },
    notes,
  };
  const document = builderDocumentFromLegacySpec(spec);
  return { ...document, fixtures: emptyFixtureSet() };
}

export function startingDocument(): BuilderDocument {
  return buildOrderDocument({
    slug: 'the-soak',
    size: 'room',
    glaze: 'clear',
    wood: 'cedar',
    plain: [],
    kinds: ['hot-tub'],
  });
}
