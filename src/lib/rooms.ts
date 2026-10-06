export type RoomShell = 'room' | 'glass' | 'resort' | 'farm' | 'water' | 'unsure';

export type RoomConcept = {
  slug: string;
  name: string;
  shell: RoomShell;
  image: string | null;
  alt: string;
  shot?: string;
  description: string;
  focus: string;
};

export const roomConcepts: RoomConcept[] = [
  {
    slug: 'the-soak',
    name: 'The Soak',
    shell: 'room',
    image: '/film/story-meadow-side.webp',
    alt: 'A black glass room in tall grass at dusk, a cedar tub steaming, and a hanging seat under an arch.',
    description: 'A wood-fired tub and swing, standard. Then a slow seat in the grass.',
    focus: 'center',
  },
  {
    slug: 'chapter-one',
    name: 'A Starry Night',
    shell: 'room',
    image: '/film/story-room.webp',
    alt: 'A dark glass room at dusk, the door open onto a linen seat and a green meadow.',
    description: 'The first room, open to the field. A small start, kept for the dark.',
    focus: 'center',
  },
  {
    slug: 'the-plus-one',
    name: "A Hitchhiker's Guide to the Guest Room",
    shell: 'room',
    image: '/film/layout-lounge-wind.webp',
    alt: 'A long linen sofa in a wood room, facing tall grass and a blue evening.',
    description: 'A guest room just past the house. Company, or a quiet hour.',
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
    name: "Aurora's Looking Glass",
    shell: 'room',
    image: '/film/layout-night.webp',
    alt: 'A low bed in a wood room under a skylight of stars, facing a night meadow.',
    description: 'A bedroom aimed at the view. The glass gives the night back.',
    focus: 'center',
  },
  {
    slug: 'hot-take',
    name: 'Hot Take',
    shell: 'room',
    image: '/film/layout-gazebo.webp',
    alt: 'Wood-fired cedar tub on a steel chassis, inside a clear glass gazebo with two panels open.',
    description: 'A wood-fired tub on its own wheels. Tow it out, and light the stove.',
    focus: 'center',
  },
  {
    slug: 'root-access',
    name: 'Leaf Skywalker',
    shell: 'farm',
    image: '/film/farm-wall.webp',
    alt: 'A glass room in tall grass at dusk, its long side filled with a wall of plants.',
    description: 'A whole room turned toward growing. Leaves inside, meadow outside.',
    focus: 'center',
  },
  {
    slug: 'of-course-i-still-tow-you',
    name: 'Of Course I Still Tow You',
    shell: 'room',
    image: '/film/layout-forest.webp',
    alt: 'Reflective glass room at the forest edge, with a door, a fold-down glass balcony, and a cedar deck.',
    description: 'A glass front and a fold-down balcony. The hitch stays on.',
    focus: 'center',
  },
  {
    slug: 'the-forest-edge',
    name: 'The Forest Edge',
    shell: 'room',
    image: '/film/layout-shell.webp',
    alt: 'A long dark room on all-terrain wheels in a meadow, with a full-length band of mirror glass, a steaming cedar tub, and a hanging daybed.',
    description: 'A long glass side on rough-ground wheels. The tub and the daybed ride along.',
    focus: 'center',
  },
  {
    slug: 'siddharthas-a-wing',
    name: "Siddhartha's A-Wing",
    shell: 'resort',
    image: '/media/specialty/aframe-golden-hour-meadow.jpg',
    alt: 'A black A-frame on a lit glass deck in a wildflower meadow at golden hour, with a sauna, a steaming tub, forest, and golden peaks.',
    description: 'A steep glass roof over a full stay. The net is already hung.',
    focus: 'center',
  },
  {
    slug: 'pandoras-glass-stairway',
    name: "Pandora's Glass Stairway to Heaven",
    shell: 'resort',
    image: '/film/resort-tower.webp',
    alt: 'A round glass tower in the snow, with curved glass levels, an outside stair, and a lit roof deck, mountains behind the pines.',
    description: 'Glass on every level, and a roof of sky.',
    focus: 'center',
  },
];

export function roomBySlug(slug: string | null): RoomConcept | undefined {
  if (!slug) return undefined;
  return roomConcepts.find((room) => room.slug === slug);
}
