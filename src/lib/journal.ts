export type JournalCard = {
  href: string;
  title: string;
  excerpt: string;
  date: string;
  tags: string[];
  cover: string;
  coverAlt: string;
};

export const legacyNotes: JournalCard[] = [
  {
    href: '/journal/one-shell',
    title: 'One room, several lives',
    excerpt:
      'The room, the glass, the resort, the farm wall, and the water line are one object with different work inside it.',
    date: '2026-09-30',
    tags: ['Room'],
    cover: '/film/story-room.webp',
    coverAlt: 'An open room of oak and linen, facing a green field at dusk.',
  },
  {
    href: '/journal/aura-farms',
    title: 'Aura Farms, grown on the wall',
    excerpt:
      'Vertical aeroponics in the same room: what it is, who can buy it, and what a free-food network would ask of it.',
    date: '2026-09-30',
    tags: ['Farm'],
    cover: '/film/farm-wall.webp',
    coverAlt: 'A black glass room in a dusk meadow, one wall a vertical aeroponic garden.',
  },
  {
    href: '/journal/water-from-the-air',
    title: 'Water from the air, bottled in the room',
    excerpt: 'H20 comes later. The generator and the bottling line still need further research.',
    date: '2026-09-30',
    tags: ['Water'],
    cover: '/film/water-line.webp',
    coverAlt: 'A small bottling line and plain plastic jugs inside the oak room.',
  },
  {
    href: '/journal/free-food-and-water',
    title: 'Free food, free water, named by the label',
    excerpt:
      'The network we hope to build: an advertiser’s name on the jug or the harvest. The person who takes it does not pay.',
    date: '2026-09-30',
    tags: ['Hope'],
    cover: '/film/layout-forest.webp',
    coverAlt: 'A glass room at the edge of a pine forest, open toward a dusk meadow.',
  },
  {
    href: '/journal/build-your-own',
    title: 'Build your own',
    excerpt: 'The builder is a tool. Set the room on this site, or build it from the GitHub source.',
    date: '2026-09-30',
    tags: ['Builder'],
    cover: '/film/story-nest.webp',
    coverAlt: 'A teal velvet hanging daybed under a steel arch, the cabin behind it.',
  },
];

export function formatJournalDate(value: Date | string) {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
