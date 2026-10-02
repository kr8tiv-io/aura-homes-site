export type RoomShell = 'room' | 'glass' | 'resort' | 'farm' | 'water' | 'unsure';

export type RoomConcept = {
  slug: string;
  name: string;
  shell: RoomShell;
  image: string;
  alt: string;
  description: string;
  focus: string;
};

export const roomConcepts: RoomConcept[] = [
  {
    slug: 'the-soak',
    name: 'The Soak',
    shell: 'room',
    image: '/film/layout-shell.webp',
    alt: 'A dark room on a steel frame in a meadow, with a wood-fired tub and a hanging swing.',
    description: 'A wood-fired tub and swing, standard. Then a slow seat in the grass.',
    focus: 'center',
  },
  {
    slug: 'chapter-one',
    name: 'Chapter One',
    shell: 'room',
    image: '/film/layout-door.webp',
    alt: 'A dark room at dusk with the glass door open onto warm wood and a daybed.',
    description: 'The first room, open to the field. A small start, with the door ajar.',
    focus: 'center',
  },
  {
    slug: 'the-plus-one',
    name: 'The Plus One',
    shell: 'room',
    image: '/film/layout-lounge-wind.webp',
    alt: 'A long linen sofa in a wood room, facing tall grass and a blue evening.',
    description: 'One more place, just past the house. Company, or a quiet hour.',
    focus: 'center',
  },
  {
    slug: 'the-stargazer',
    name: 'The Stargazer',
    shell: 'room',
    image: '/film/layout-sky.webp',
    alt: 'A bed under a glass roof of stars, with a dusk meadow beyond the glass.',
    description: 'A roof of glass, kept for the stars. Then the sky takes the watch.',
    focus: 'center 28%',
  },
  {
    slug: 'cloud-nine',
    name: 'Cloud Nine',
    shell: 'room',
    image: '/film/resort-deck.webp',
    alt: 'A lit deck in the snow with a cargo net for lounging, mountains behind it.',
    description: 'A net on the deck, for doing little. The afternoon loosens with you.',
    focus: 'center 62%',
  },
  {
    slug: 'nothing-to-see-here',
    name: 'Nothing To See Here',
    shell: 'room',
    image: '/film/layout-night.webp',
    alt: 'A low bed in a wood room under a skylight of stars, facing a night meadow.',
    description: 'A bedroom aimed at the view. The joke is how much there is to see.',
    focus: 'center',
  },
  {
    slug: 'hot-take',
    name: 'Hot Take',
    shell: 'room',
    image: '/film/layout-gazebo.webp',
    alt: 'A wood-fired tub on a small trailer, under a glass roof, in a green field.',
    description: 'A wood-fired tub on its own wheels. Tow it out, and light the stove.',
    focus: 'center',
  },
  {
    slug: 'root-access',
    name: 'Root Access',
    shell: 'farm',
    image: '/film/farm-wall.webp',
    alt: 'A glass room in tall grass at dusk, its long side filled with a wall of plants.',
    description: 'A whole room turned toward growing. Leaves inside, meadow outside.',
    focus: 'center',
  },
];

export function roomBySlug(slug: string | null): RoomConcept | undefined {
  if (!slug) return undefined;
  return roomConcepts.find((room) => room.slug === slug);
}
