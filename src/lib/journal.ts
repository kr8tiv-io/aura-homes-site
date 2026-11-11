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
    title: 'One room, a lot of side hustles',
    excerpt:
      'Guest room, office, glass deck, resort, grow room, water maker. One Aura room, a lot of different jobs.',
    date: '2026-09-30',
    tags: ['Room'],
    cover: '/film/story-room.webp',
    coverAlt: 'An open room of oak and linen, facing a green field at dusk.',
  },
  {
    href: '/journal/aura-farms',
    title: 'Aura Farms: salad that grows up the wall',
    excerpt:
      'How an aeroponic garden wall works, who it is for, and what it can grow.',
    date: '2026-09-30',
    tags: ['Farm'],
    cover: '/film/farm-wall.webp',
    coverAlt: 'A black glass room in a dusk meadow, one wall a vertical aeroponic garden.',
  },
  {
    href: '/journal/water-from-the-air',
    title: 'Thirst Contact: water from the sky, bottled in your backyard',
    excerpt: 'A standard atmospheric water generator on the roof, a little bottling line inside, and fresh water from thin air.',
    date: '2026-09-30',
    tags: ['Water'],
    cover: '/film/water-line.webp',
    coverAlt: 'A small bottling line and plain plastic jugs inside the oak room.',
  },
  {
    href: '/journal/free-food-and-water',
    title: 'The Aura Network: the big idea for later',
    excerpt:
      'Free food and free water networks, with owners paid to keep them running. A future expansion, not open yet.',
    date: '2026-09-30',
    tags: ['Later'],
    cover: '/film/layout-forest.webp',
    coverAlt: 'A glass room at the edge of a pine forest, open toward a dusk meadow.',
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
