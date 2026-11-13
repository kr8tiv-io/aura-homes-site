/**
 * The Aura Collection catalog for /collection.
 * Copy comes from src/data/products.json (the printed catalog).
 * Group is added here. The Stargazer stays in Rooms.
 * Visible copy never uses the word "quoted".
 */
import catalogJson from './products.json';
import imageMeta from './collection-images.json';
import { standalonePages } from './collection';

export type CatalogStage = 'Available soon' | 'Coming after';

export type CatalogGroup = 'rooms' | 'soaks' | 'sleep' | 'systems' | 'resort';

export type CatalogFilter = CatalogGroup | 'all';

export type CatalogImage = {
  src: string;
  srcset: string;
  width: number;
  height: number;
  alt: string;
};

export type CatalogProduct = {
  slug: string;
  name: string;
  stage: CatalogStage;
  tier: string;
  kicker: string;
  lede: string;
  no: number;
  number: string;
  group: CatalogGroup;
  pairs: readonly [string, string] | readonly [string];
  hero: CatalogImage;
  second?: CatalogImage;
  href: string;
};

export type CatalogAddon = {
  name: string;
  plain: string;
  text: string;
  id: string;
};

export type CatalogAddonCategory = {
  category: string;
  id: string;
  items: CatalogAddon[];
};

export type CatalogLimited = {
  name: string;
  text: string;
  image?: CatalogImage;
};

export type CatalogSomeday = {
  name: string;
  text: string;
};

type ImageFile = {
  w1280: number;
  h1280: number;
  w1920?: number;
  h1920?: number;
};

type RawProduct = {
  slug: string;
  name: string;
  stage: CatalogStage;
  tier: string;
  kicker: string;
  lede: string;
  addons: string[];
  images: { hero: string; second?: string };
  no: number;
};

type RawCatalog = {
  products: RawProduct[];
  compare: string[][];
  limited: { name: string; text: string; image?: string }[];
  someday: [string, string][];
  addons: { category: string; items: { name: string; plain: string; text: string }[] }[];
};

const catalog = catalogJson as RawCatalog;
const images = imageMeta as Record<string, ImageFile>;

/** Existing room pages. Anything else goes to the waitlist with the catalog slug. */
const roomPageSlugs = new Set(standalonePages().map((item) => item.slug));

/**
 * Catalog slugs that are the same room as an older /rooms slug already on the waitlist.
 * The card still links with the catalog slug. The waitlist form maps these across.
 */
export const waitlistSlugAlias: Record<string, string> = {
  'a-starry-night': 'chapter-one',
  'hitchhikers-guide-to-the-guest-room': 'the-plus-one',
  'auroras-looking-glass': 'nothing-to-see-here',
  'leaf-skywalker': 'root-access',
  'pandoras-glass-stairway-to-heaven': 'pandoras-glass-stairway',
};

const groupBySlug: Record<string, CatalogGroup> = {
  'lie-down-skywalker': 'sleep',
  'of-course-i-still-tow-you': 'rooms',
  'the-goldfish-protocol': 'rooms',
  'hot-take': 'soaks',
  'hitchhikers-guide-to-the-guest-room': 'rooms',
  'behind-door-number-one': 'rooms',
  'a-starry-night': 'rooms',
  'the-soak': 'soaks',
  'tub-ward-bound': 'soaks',
  'the-stargazer': 'rooms',
  'office-space-odyssey': 'rooms',
  'auroras-looking-glass': 'rooms',
  'hot-tub-time-machine': 'soaks',
  'cool-runnings': 'soaks',
  'fire-and-ice': 'soaks',
  'thirst-contact': 'systems',
  'leaf-skywalker': 'rooms',
  'jungle-book-canopy-of-stars': 'rooms',
  'the-forest-edge': 'rooms',
  'siddharthas-a-wing': 'resort',
  'cloud-nine': 'resort',
  'pandoras-glass-stairway-to-heaven': 'resort',
  'waste-of-space': 'systems',
  'space-cowboy': 'rooms',
};

const altByFile: Record<string, string> = {
  'skywalker-meadow.jpg':
    'A polycarbonate sleep room with a bed, a reading lamp, and a small glowing heater, in a wildflower meadow under the Milky Way, pines standing around it.',
  'layout-forest.jpg':
    'A long mirror polycarbonate room on tandem wheels at the edge of a meadow at dusk, a wood entry door, a fold-down polycarbonate balcony with a linen bench, and pines behind.',
  'goldfish-hero.jpg':
    'A simple white room with a polycarbonate door and wide windows, one pale chair inside, on a cedar deck in a meadow of birch trees.',
  'layout-gazebo.jpg':
    'A steaming cedar hot tub on a tandem trailer in a meadow at dusk, inside a clear polycarbonate enclosure with a lockable polycarbonate door, firewood stacked beside it.',
  'layout-lounge-wind.jpg':
    'A long linen sofa in a wood room, polycarbonate walls open toward a blue evening meadow.',
  'layout-door.jpg':
    'A long dark room at dusk with a solid entry door and folding polycarbonate doors, one of them open onto warm oak, a linen sofa, and a desk.',
  'story-room.jpg':
    'A dark polycarbonate room at dusk, the long side open onto a linen sofa, a deck, and a green meadow.',
  'story-meadow-side.jpg':
    'A black polycarbonate room in tall grass at dusk, a cedar tub steaming on the deck, and a hanging seat under a steel arch.',
  'cabin-poster-hi.jpg':
    'A black polycarbonate room at dusk with its polycarbonate side open onto warm oak, a wood-fired cedar tub steaming on a dark deck, and a teal daybed swinging from chains under a steel arch, river stones glowing softly along the deck.',
  'the-soak-unit.jpg':
    'A black bedroom on tandem wheels in a sunny meadow, its polycarbonate side open onto a plush bed, a wood-fired cedar tub steaming on the cedar deck at the back.',
  'tubward-bound-meadow.jpg':
    'A black polycarbonate bedroom on wheels in a meadow at golden hour, the bed glowing through open polycarbonate, a cedar tub steaming on its own dark deck in the grass beside it.',
  'story-nest.jpg':
    'A round teal hanging daybed on chains under a steel arch, beside a black polycarbonate room in a meadow at dusk.',
  'layout-sky.jpg':
    'A plush bed on a low oak platform under a polycarbonate roof of stars, warm wood all around, with a dusk meadow beyond the end window.',
  'layout-corner.jpg':
    'A walnut desk, a brass lamp, and a linen chair in a wood room, with a polycarbonate door open onto a dusk meadow.',
  'layout-night.jpg':
    'A low linen bed in a wood room under a skylight of the Milky Way, facing a night meadow through a polycarbonate end wall, with an oak shelf along the side.',
  'hot-tub-time-machine.jpg':
    'A round wood-fired cedar tub with a glowing stove and a tall chimney, inside a clear polycarbonate enclosure in wildflowers at dusk.',
  'aura-cold-plunge-bathtub.jpg':
    'A long oval cedar cold-plunge tub on a low timber base in a frosted clearing, with a stool and folded towels, pines behind it.',
  'fire-and-ice.jpg':
    'A wood-fired round cedar tub and a long oval cedar plunge side by side inside a clear enclosure on a deck in a frosty meadow at dusk.',
  'water-roof.jpg':
    'A walk-in water and grow room in a meadow at dusk, oak lining and a stainless bottling bench with glass bottles inside, a grow rack of greens, and the water machine on the roof, forested hills behind.',
  'water-line.jpg':
    'Glass bottles filling from a tube on a steel bench inside a wood room, with a dusk meadow through the window.',
  'farm-wall.jpg':
    'A polycarbonate grow room on a wood deck in a dusk meadow, its long side filled with a lit wall of plants, forest and mountains behind.',
  'farm-room.jpg':
    'A wood room with a floor-to-ceiling wall of leafy greens in vertical channels, and a wildflower meadow beyond the polycarbonate.',
  'canopy-of-stars.jpg':
    'A smoked polycarbonate room with warm wood inside and a polycarbonate rail, set among ferns in a misty rainforest at dusk.',
  'forest-edge-wide.jpg':
    'A long dark room on large wheels in a meadow, a full-length band of mirror polycarbonate, a steaming cedar tub, and a hanging daybed under a steel arch.',
  'a-wing-golden-hour.jpg':
    'A steep black polycarbonate lodge with a full-height gable, a wide railed deck, a steaming tub, and a small wood sauna, in a wildflower meadow at golden hour with mountains behind.',
  'a-wing-hot-tub.jpg':
    'A steaming cedar tub on a lit deck in front of a steep polycarbonate gable, snow falling at dusk.',
  'resort-deck.jpg':
    'A steep polycarbonate lodge on a lit deck at night, stairs coming up from the snow, mountains behind the pines.',
  'resort-tower.jpg':
    'A round tower of curved polycarbonate in the snow, several lit levels, an outside stair, and mountains behind the pines.',
  'waste-of-space-long-1.jpg':
    'A long dark room in a meadow at dusk, with a stair to a railed roof that holds a steaming cedar tub, a hammock, chairs, and a telescope.',
  'waste-of-space-long-2.jpg':
    'A long dark room at night, its stair rising to a roof deck with a steaming cedar tub, a hammock, lounge chairs, a small gym corner, and a telescope.',
  'space-cowboy.jpg':
    'A long black bumper-pull trailer in a meadow at dusk, tinted polycarbonate along the side, a stair, a railed roof deck, and a steaming cedar tub on the rear deck.',
  'fly-you.jpg':
    'A small white amphibious plane with its wings folded, parked on its trailer beside a polycarbonate sleep room, a lake and mountains behind.',
  'float-you.jpg':
    'A dark polycarbonate room on pontoons at a wooden dock, warm wood and a linen sofa inside, on a calm lake at dusk.',
  'full-solar.jpg':
    'A dark polycarbonate room in a golden meadow with solar panels on the roof and a second panel on a cedar pad, aspen trees and mountains behind.',
};

export const catalogFilters = [
  { id: 'all', label: 'All' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'soaks', label: 'Soaks and plunges' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'systems', label: 'Off-grid and systems' },
  { id: 'resort', label: 'Resort' },
] as const satisfies readonly { id: CatalogFilter; label: string }[];

export const stageSections = [
  {
    id: 'available-soon',
    stage: 'Available soon',
    kicker: 'Available soon',
    title: 'The first builds',
    lede: 'The rooms we build first: simple, warm and beautiful, with the sleep rooms, the soaks and our own wood-fired tub leading the way.',
  },
  {
    id: 'coming-after',
    stage: 'Coming after',
    kicker: 'Coming after',
    title: 'The wilder editions',
    lede: 'More polycarbonate, more terrain, more water. The bigger dreams, built as the first rooms make room for them.',
  },
] as const;

/** The printed catalog says "quoted". The site does not. */
export function publicCopy(text: string): string {
  return text.replaceAll('Quoted on every build.', 'On every build.');
}

export function productHref(slug: string): string {
  if (roomPageSlugs.has(slug)) return `/rooms/${slug}`;
  return `/pre-order?model=${encodeURIComponent(slug)}`;
}

export function addonAnchor(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `addon-${slug}`;
}

function picture(file: string): CatalogImage {
  const dim = images[file];
  const alt = altByFile[file];
  if (!dim || !alt) throw new Error(`Collection image ${file} needs a resized file and alt text`);
  const base = `/film/collection/${file.replace(/\.[^.]+$/, '')}`;
  const small = `${base}-1280.webp`;
  const parts = [`${small} ${dim.w1280}w`];
  if (dim.w1920 && dim.h1920) parts.push(`${base}-1920.webp ${dim.w1920}w`);
  return { src: small, srcset: parts.join(', '), width: dim.w1280, height: dim.h1280, alt };
}

function toProduct(raw: RawProduct): CatalogProduct {
  const group = groupBySlug[raw.slug];
  if (!group) throw new Error(`Collection product ${raw.slug} needs a group`);
  const pairs = raw.addons.slice(0, 2);
  if (pairs.length < 1) throw new Error(`Collection product ${raw.slug} needs an add-on pair`);
  return {
    slug: raw.slug,
    name: raw.name,
    stage: raw.stage,
    tier: raw.tier,
    kicker: raw.kicker,
    lede: raw.lede,
    no: raw.no,
    number: String(raw.no).padStart(2, '0'),
    group,
    pairs: pairs as CatalogProduct['pairs'],
    hero: picture(raw.images.hero),
    second: raw.images.second ? picture(raw.images.second) : undefined,
    href: productHref(raw.slug),
  };
}

export const catalogProducts: CatalogProduct[] = catalog.products.map(toProduct);

export const featureProduct = catalogProducts.find((product) => product.slug === 'lie-down-skywalker');
if (!featureProduct) throw new Error('Lie Down, Skywalker is missing from the catalog');

export const availableGrid = catalogProducts.filter(
  (product) => product.stage === 'Available soon' && product.slug !== featureProduct.slug,
);
export const comingGrid = catalogProducts.filter((product) => product.stage === 'Coming after');

export const catalogAddons: CatalogAddonCategory[] = catalog.addons.map((category) => ({
  category: category.category,
  id: addonAnchor(category.category),
  items: category.items.map((item) => ({
    name: item.name,
    plain: item.plain,
    text: publicCopy(item.text),
    id: addonAnchor(item.name),
  })),
}));

export const catalogLimited: CatalogLimited[] = catalog.limited.map((item) => ({
  name: item.name,
  text: item.text,
  image: item.image ? picture(item.image) : undefined,
}));

export const catalogSomeday: CatalogSomeday[] = catalog.someday.map(([name, text]) => ({ name, text }));

export const catalogCompare: string[][] = catalog.compare;

export const fullSolarImage = picture('full-solar.jpg');

const heroFiles = catalogProducts.map((product) => product.hero.src);
if (new Set(heroFiles).size !== heroFiles.length) {
  throw new Error('Two collection cards share a photograph');
}

if (catalogProducts.length !== 24) {
  throw new Error(`The collection lists ${catalogProducts.length} products. The catalog has 24.`);
}
if (catalogProducts.filter((product) => product.stage === 'Available soon').length !== 16) {
  throw new Error('Available soon should list 16 products');
}
if (comingGrid.length !== 8) throw new Error('Coming after should list 8 products');
if (catalogAddons.length !== 10) throw new Error('The add-on menu should have 10 categories');

const higherGround = catalogAddons
  .flatMap((category) => category.items)
  .find((item) => item.name === 'Mission: Higher Ground');
if (!higherGround || higherGround.plain !== 'Roof deck, any room') {
  throw new Error('Mission: Higher Ground belongs in the add-on menu as Roof deck, any room');
}
if (catalogProducts.some((product) => product.name === 'Mission: Higher Ground')) {
  throw new Error('Mission: Higher Ground is an add-on, not a model');
}

const leagues = catalogLimited.find((item) => item.name === 'Twenty Thousand Leagues Under The Deck');
if (!leagues || leagues.image) {
  throw new Error('Twenty Thousand Leagues Under The Deck stays text-only');
}

const shown = [
  ...catalogProducts.flatMap((product) => [product.name, product.kicker, product.lede, product.tier, ...product.pairs]),
  ...catalogAddons.flatMap((category) => [
    category.category,
    ...category.items.flatMap((item) => [item.name, item.plain, item.text]),
  ]),
  ...catalogLimited.flatMap((item) => [item.name, item.text]),
  ...catalogSomeday.flatMap((item) => [item.name, item.text]),
  ...catalogCompare.flat(),
  ...Object.values(altByFile),
  ...stageSections.flatMap((section) => [section.title, section.lede]),
];

const banned = /\b(crypto|atco|shell|skid|chassis|frame|quote|quoted|deposit|refund|gonna|wanna)\b/i;
for (const line of shown) {
  if (banned.test(line) || /[—–]/.test(line)) {
    throw new Error(`Collection copy is not allowed: ${line}`);
  }
}
