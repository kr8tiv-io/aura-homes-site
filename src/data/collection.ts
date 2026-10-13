/**
 * The Aura catalog on /rooms.
 * Names and photographs for the twelve rooms live in src/lib/rooms.ts.
 * Edit stories, features, add-ons, and showpieces here. A tier slug must
 * match a room, and every room must appear once.
 * Standalone pieces are not rooms. They live in collectionStandalone.
 */

export type CollectionModel = {
  slug: string;
  story: string;
  features: string[];
};

export type CollectionTier = {
  id: string;
  index: string;
  name: string;
  line: string;
  models: CollectionModel[];
};

export type CollectionAddon = {
  name: string;
  detail?: string;
};

export type CollectionShowpiece = {
  name: string;
  line: string;
  image?: string;
  alt?: string;
  focus?: string;
};

export const collectionIntro = {
  kicker: 'The collection',
  title: 'Twelve rooms. Each one named.',
  lede: 'From a spare room to a tower of glass. Every Aura is drawn and furnished one at a time, and every model can carry Full Solar from the first order.',
};

export const collectionTiers: CollectionTier[] = [
  {
    id: 'first-rooms',
    index: '01',
    name: 'First Rooms',
    line: 'Beautiful nature rooms that bring you back outside. Where Aura starts.',
    models: [
      {
        slug: 'of-course-i-still-tow-you',
        story:
          'Our easiest room to love. A big glass front, a fold-down balcony, and a hitch that keeps your options open.',
        features: [
          'Ready to tow',
          'Mirror-glass front',
          'Fold-down glass balcony',
          'Linen bench',
        ],
      },
      {
        slug: 'hot-take',
        story:
          'A hot tub with a passport. Tow it somewhere beautiful, light the stove, and let the steam make its argument.',
        features: [
          'Wood-fired cedar tub',
          'Clear enclosure, two panels open',
          'Its own steel frame',
          'Firewood rack',
        ],
      },
      {
        slug: 'the-plus-one',
        story: "Everything a guest needs, starting with Don't Panic. There is always a towel.",
        features: [
          'Fold-out linen sofa',
          'Low oak table',
          'Glass side open to the meadow',
          'Two towels, always',
        ],
      },
    ],
  },
  {
    id: 'signature',
    index: '02',
    name: 'Signature',
    line: 'The rooms in the photographs. Warm, finished, built to stay.',
    models: [
      {
        slug: 'chapter-one',
        story:
          'The first Aura room, and still the one people point at. The long side opens and the evening walks in.',
        features: ['Opening glass bay', 'Honey oak', 'Linen sofa', 'Lit deck edge'],
      },
      {
        slug: 'the-soak',
        story: 'A wood-fired cedar tub, a black-glass room to warm up in, and a daybed for the part after.',
        features: ['Cedar tub', 'Black-glass room', 'Hanging daybed', 'Heated towel rail'],
      },
      {
        slug: 'the-stargazer',
        story: 'A bedroom with one job, and a ceiling full of stars.',
        features: ['Plush king bed', 'Glass skylight roof', 'Blackout shade', 'Acoustic insulation'],
      },
      {
        slug: 'nothing-to-see-here',
        story: 'You see the whole meadow. The meadow sees its own reflection.',
        features: ['One-way mirror glass', 'Glass end wall', 'Wide skylight', 'Linen daybed'],
      },
      {
        slug: 'root-access',
        story: 'Grow long and prosper. One long wall is a garden, and the fish handle the fertiliser.',
        features: ['Aquaponic grow wall', 'Fish loop', 'Grow light', 'Potting bench'],
      },
    ],
  },
  {
    id: 'adventure',
    index: '03',
    name: 'Adventure',
    line: 'Built for rough ground and long trips.',
    models: [
      {
        slug: 'the-forest-edge',
        story:
          'The long way round. A full-length glass side on all-terrain wheels, with the tub and the daybed already unpacked.',
        features: [
          'All-terrain axle',
          'Full-length glass side',
          'Cedar tub',
          'Roof rack for Full Solar',
        ],
      },
    ],
  },
  {
    id: 'resort',
    index: '04',
    name: 'Resort',
    line: 'Arrives with everything, netting included.',
    models: [
      {
        slug: 'siddharthas-a-wing',
        story: 'Enlightenment, with a very steep roof. It comes with everything, including the net.',
        features: [
          'Glass gable A-frame',
          'Railed deck and nets',
          'Full kitchen and sleeping loft',
          'Wood stove, in-floor heat, hot tub',
        ],
      },
      {
        slug: 'cloud-nine',
        story: 'Everything in the A-Wing, then more of all of it.',
        features: [
          'Under-deck nooks',
          'Nets on deck, loft and balcony',
          'Home gym and TV station',
          'Walnut, stone, best linens',
        ],
      },
      {
        slug: 'pandoras-glass-stairway',
        story: 'Open the box and climb. Every level is glass, and the top one is all sky.',
        features: [
          'Curved-glass levels',
          'Outside stair',
          'Roof deck with net',
          'In-floor heat and wood stove',
        ],
      },
    ],
  },
];

export const collectionAddons = {
  kicker: 'Coming next',
  title: 'Make it yours.',
  line: 'Every model takes add-ons. Full Solar comes first, on all twelve.',
  items: [
    { name: 'Here Comes The Sun', detail: 'Full Solar sized to your sky' },
    { name: 'The Hearth Of Gold', detail: 'Wood stove fireplace' },
    { name: 'Mount Doom, Domesticated', detail: 'Wood furnace' },
    { name: 'Warp Core Floors', detail: 'In-floor heating' },
    { name: 'The Ewok Treehouse Net', detail: 'Interior hanging net' },
    { name: 'Into The Spider-Verse', detail: 'Deck cargo net' },
    { name: 'Hang Solo', detail: 'Hanging daybed' },
    { name: 'The Restaurant At The End Of The Universe', detail: 'Full kitchen' },
    { name: 'Second Breakfast Station', detail: 'Kitchenette' },
    { name: 'A Pizza Hope', detail: 'Wood-fired pizza oven' },
    { name: 'The Arrakis Sauna' },
    { name: 'The Hoth Plunge', detail: 'Cool Runnings, our cedar cold plunge' },
    { name: 'Thirst Contact', detail: 'Water from the air' },
    { name: 'Aura Farms', detail: 'A growing wall' },
  ] satisfies CollectionAddon[],
  funLabel: 'And the fun ones',
  fun: [
    'Death Star Disco Ball',
    'The Batpole',
    'The Goonies Passage',
    'Planetarium Mode',
    "Don't Panic Towel Set",
    'Putt-Putt To Mordor',
  ],
};

export const collectionShowpieces = {
  kicker: 'Showpieces',
  title: 'Rooms on the water, and further out.',
  line: 'One at a time, as limited editions.',
  items: [
    {
      name: 'Of Course I Still Float You',
      line: 'A floating Aura on pontoons.',
    },
    {
      name: 'Twenty Thousand Leagues Under The Deck',
      line: 'A full Aura houseboat with a roof deck.',
      image: '/media/specialty/tower-lake-summer-dusk.jpg',
      alt: 'A round glass tower on a deck over a lake at pink summer dusk, with a roof deck, a stair, a sauna, and pines.',
      focus: 'center',
    },
    {
      name: 'The Life Of Pontoon',
      line: 'A towed floating room that launches wherever the view is best.',
    },
    {
      name: 'The Quad Squad',
      line: 'A garage bay and an all-glass living end.',
    },
    {
      name: 'The Bifrost',
      line: 'Two rooms joined by a glass bridge.',
    },
    {
      name: 'Ewok Village Edition',
      line: 'An Aura on stilts in the trees.',
    },
    {
      name: 'The Convertible',
      line: 'A roof that slides back for open-sky nights.',
    },
  ] satisfies CollectionShowpiece[],
};

export const collectionClose = {
  title: 'Return to Aura.',
  line: 'One beautiful room at a time.',
  cta: 'Get a quote',
  href: '/pre-order',
};

export type StandaloneAddon = {
  id: string;
  name: string;
  detail: string;
};

/** A product sold on its own. Fire and Ice is the pair: a card and a quote, with no page. */
export type StandaloneProduct = {
  slug: string;
  name: string;
  image: string;
  alt: string;
  imageRight?: string;
  altRight?: string;
  film?: string;
  line: string;
  tagline: string;
  story: string[];
  features: string[];
  addons: StandaloneAddon[];
  pairsWith?: string;
};

export const collectionStandalone = {
  kicker: 'Standalone',
  title: 'Hot and cold.',
  line: 'Made in our own shop, standard on many Aura rooms, and yours on their own.',
  pairKicker: 'Fire and Ice',
  pairTitle: 'Better as a pair.',
  pairLine: 'Fire and Ice puts Hot Tub Time Machine and Cool Runnings side by side, matched in cedar.',
  items: [
    {
      slug: 'hot-tub-time-machine',
      name: 'Hot Tub Time Machine',
      image: '/media/specialty/hot-tub-time-machine.jpg',
      alt: 'A wood-fired cedar hot tub on a steel and timber skid inside a clear polycarbonate enclosure, steam rising and the stove glowing in a wildflower meadow at dusk, stars coming out.',
      film: '/media/video/hot-tub-time-machine.mp4',
      line: 'A wood-fired cedar tub on its own skid. Light the stove, and the evening forgets what time it is.',
      tagline: 'Set the dial to dusk.',
      story: [
        'Wood smoke, a sky filling up with stars, and hot water that holds its warmth for hours. A round cedar tub with its own small stove, on a steel and timber skid that sets down level wherever the view is best.',
        'A clear polycarbonate enclosure keeps the heat close and lets the night in. The steam gathers under the roof, the stove glows through its little window, and the stars stay in the picture.',
        'It comes standard with many Aura rooms, and we make it in-house, in the same shop and by the same hands. Now it stands on its own.',
        'The stove ticks, the water warms, the smoke drifts up past the roof. An hour in, nobody is checking the time.',
      ],
      features: [
        'Wood-fired cedar tub',
        'Chimney stove with a glowing window',
        'Steel and timber skid',
        'Clear polycarbonate enclosure',
        'Made in-house by Aura',
      ],
      addons: [
        { id: 'finish', name: 'Finish', detail: 'Western red cedar or thermowood.' },
        { id: 'cover', name: 'Insulated cover', detail: 'Holds the heat overnight.' },
        { id: 'steps', name: 'Cedar steps', detail: 'A way up to the rim.' },
        { id: 'light', name: 'Warm LED light ring', detail: 'Dimmable, under the rim.' },
        { id: 'privacy', name: 'Privacy screen', detail: 'Cedar slats on one side.' },
        { id: 'tint', name: 'Tinted enclosure panels', detail: 'A softer night through the walls.' },
        { id: 'firewood', name: 'Firewood rack', detail: 'A dry stack beside the stove.' },
        { id: 'pair', name: 'Cool Runnings pairing', detail: 'Becomes Fire and Ice.' },
      ],
      pairsWith: 'cool-runnings',
    },
    {
      slug: 'cool-runnings',
      name: 'Cool Runnings',
      image: '/media/specialty/cool-runnings.jpg',
      alt: 'A long oval cedar cold-plunge bathtub with a sloped back on a low timber skid, ice water and a wooden stool with a towel, in a frosted forest clearing at dawn.',
      film: '/media/video/cool-runnings.mp4',
      line: 'A cedar cold-plunge bathtub. Ice water, a little mist, and a very awake morning.',
      tagline: 'Feel the rhythm. Then the cold.',
      story: [
        'A single-person cedar bathtub made for cold water. Long and oval, with a sloped back to lean into, smooth oiled cedar and rounded rims, on a low timber skid.',
        'Fill it, add ice, and sink in to the shoulders while the mist drifts off the water. Thirty seconds feels brave. Three minutes feels like a new morning.',
        'About half the size of Hot Tub Time Machine and made in-house by Aura, at home on frosted grass, a deck or the end of a dock.',
      ],
      features: [
        'Single-person cedar bathtub',
        'Sloped backrest',
        'Smooth oiled cedar, rounded rims',
        'Low timber skid',
        'Made in-house by Aura',
      ],
      addons: [
        { id: 'finish', name: 'Finish', detail: 'Western red cedar or thermowood.' },
        { id: 'lid', name: 'Insulated lid', detail: 'A cover for the cold.' },
        { id: 'step', name: 'Cedar step and towel rail', detail: 'A step up, and a place for the towel.' },
        { id: 'glow', name: 'Warm LED glow', detail: 'A quiet light in the mist.' },
        { id: 'privacy', name: 'Privacy screen', detail: 'Cedar slats on one side.' },
        { id: 'chiller', name: 'Chiller', detail: 'Cold on tap, ice optional.' },
        { id: 'pair', name: 'Hot Tub Time Machine pairing', detail: 'Becomes Fire and Ice.' },
      ],
      pairsWith: 'hot-tub-time-machine',
    },
    {
      slug: 'fire-and-ice',
      name: 'Fire and Ice',
      image: '/media/specialty/hot-tub-time-machine.jpg',
      alt: 'A wood-fired cedar hot tub on a steel and timber skid inside a clear polycarbonate enclosure, steam rising and the stove glowing in a wildflower meadow at dusk, stars coming out.',
      imageRight: '/media/specialty/cool-runnings.jpg',
      altRight: 'A long oval cedar cold-plunge bathtub with a sloped back on a low timber skid, ice water and a wooden stool with a towel, in a frosted forest clearing at dawn.',
      line: 'Hot Tub Time Machine and Cool Runnings, as a pair. Fire first, then ice, then fire again.',
      tagline: 'Fire first, then ice, then fire again.',
      story: [
        'The oldest ritual on the hill. Warm through by the stove, step into the cedar cold, then climb back into the steam. Two pieces made together in our shop, set side by side.',
      ],
      features: ['Hot Tub Time Machine', 'Cool Runnings', 'Matched cedar finish', 'One quote, one delivery.'],
      addons: [
        { id: 'finish', name: 'Matched finish', detail: 'Western red cedar or thermowood.' },
        { id: 'deck', name: 'Shared cedar deck joining the two', detail: 'One deck, both pieces.' },
        { id: 'covers', name: 'Covers for both', detail: 'Heat held, and the cold kept.' },
        { id: 'light', name: 'Warm LED for both', detail: 'Light for the tub and the plunge.' },
        { id: 'privacy', name: 'Privacy screen', detail: 'Cedar slats on one side.' },
        { id: 'firewood', name: 'Firewood rack', detail: 'A dry stack beside the stove.' },
      ],
    },
  ] satisfies StandaloneProduct[],
};

export function standaloneBySlug(slug: string): StandaloneProduct | undefined {
  return collectionStandalone.items.find((item) => item.slug === slug);
}

export function standalonePages(): StandaloneProduct[] {
  return collectionStandalone.items.filter((item) => item.film);
}
