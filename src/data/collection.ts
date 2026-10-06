/**
 * The Aura catalog on /rooms.
 * Names and photographs live in src/lib/rooms.ts. Edit stories, features,
 * add-ons, and showpieces here. A slug must match a room, and every room
 * must appear once.
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
  lede: 'From a second-life trailer to a tower of glass. Every Aura is finished, furnished and made one at a time, and every model can carry Full Solar from the first order.',
};

export const collectionTiers: CollectionTier[] = [
  {
    id: 'second-life',
    index: '01',
    name: 'Second Life',
    line: 'Refurbished trailers, made beautiful. Where Aura starts.',
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
          'Its own trailer',
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
    { name: 'The Hoth Plunge' },
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
