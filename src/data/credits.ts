/*
  Anything borrowed must get an entry here in the same commit.
*/

export const creditCategories = [
  'Code and libraries',
  '3D models',
  'Textures and HDRIs',
  'Techniques and inspiration',
  'Audio',
  'Fonts',
] as const;

export type CreditCategory = (typeof creditCategories)[number];

export interface Credit {
  name: string;
  author: string;
  license: string;
  link: string;
  licenseLink?: string;
  usedFor: string;
  category: CreditCategory;
  /** Paths under public/ that this entry covers. The build check reads these. */
  files?: string[];
}

const mit = 'https://opensource.org/licenses/MIT';
const ofl = 'https://openfontlicense.org/open-font-license-official-text/';

export const credits: Credit[] = [
  {
    name: 'Astro',
    author: 'The Astro Technology Company',
    license: 'MIT',
    link: 'https://astro.build',
    licenseLink: mit,
    usedFor: 'Pages, routing, and the transitions between them.',
    category: 'Code and libraries',
  },
  {
    name: 'React for Astro',
    author: 'The Astro Technology Company',
    license: 'MIT',
    link: 'https://docs.astro.build/en/guides/integrations-guide/react/',
    licenseLink: mit,
    usedFor: 'Mounting React islands inside Astro pages.',
    category: 'Code and libraries',
  },
  {
    name: 'React',
    author: 'Meta',
    license: 'MIT',
    link: 'https://react.dev',
    licenseLink: mit,
    usedFor: 'Interactive islands, including the room builder.',
    category: 'Code and libraries',
  },
  {
    name: 'React DOM',
    author: 'Meta',
    license: 'MIT',
    link: 'https://react.dev',
    licenseLink: mit,
    usedFor: 'Placing those islands in the document.',
    category: 'Code and libraries',
  },
  {
    name: 'three.js',
    author: 'mrdoob and contributors',
    license: 'MIT',
    link: 'https://threejs.org',
    licenseLink: mit,
    usedFor: 'The room builder and the meadow.',
    category: 'Code and libraries',
  },
  {
    name: 'React Three Fiber',
    author: 'Poimandres',
    license: 'MIT',
    link: 'https://github.com/pmndrs/react-three-fiber',
    licenseLink: mit,
    usedFor: 'A React renderer for the builder scene.',
    category: 'Code and libraries',
  },
  {
    name: 'Drei',
    author: 'Poimandres',
    license: 'MIT',
    link: 'https://github.com/pmndrs/drei',
    licenseLink: mit,
    usedFor: 'Staging helpers in the builder: lights, shadows, and models.',
    category: 'Code and libraries',
  },
  {
    name: 'React Postprocessing',
    author: 'Poimandres',
    license: 'MIT',
    link: 'https://github.com/pmndrs/react-postprocessing',
    licenseLink: mit,
    usedFor: 'Bloom, vignette, and grain on the builder.',
    category: 'Code and libraries',
  },
  {
    name: 'GSAP',
    author: 'GreenSock',
    license: 'Standard "no charge" license',
    link: 'https://gsap.com',
    licenseLink: 'https://gsap.com/standard-license',
    usedFor: 'Menu, page, and camera motion.',
    category: 'Code and libraries',
  },
  {
    name: 'Lenis',
    author: 'darkroom.engineering',
    license: 'MIT',
    link: 'https://github.com/darkroomengineering/lenis',
    licenseLink: mit,
    usedFor: 'Smooth scrolling on the inner pages.',
    category: 'Code and libraries',
  },
  {
    name: 'Tailwind CSS',
    author: 'Tailwind Labs',
    license: 'MIT',
    link: 'https://tailwindcss.com',
    licenseLink: mit,
    usedFor: 'Utility styles compiled into the site.',
    category: 'Code and libraries',
  },
  {
    name: 'Aura Homes v1 landing scene',
    author: 'Matt Aurora Ventures / KR8TIV AI',
    license: 'MIT',
    link: 'https://github.com/kr8tiv-ai/aura-homes',
    licenseLink: mit,
    usedFor: 'The earlier landing scene, kept for the builder port.',
    category: '3D models',
  },
  {
    name: 'snakey-locomotion grass blade',
    author: 'Murat Kamci',
    license: 'MIT',
    link: 'https://github.com/muratkamci/snakey-locomotion',
    licenseLink: mit,
    usedFor: 'The shape and wind of a single grass blade.',
    category: '3D models',
  },
  {
    name: 'Trimming my Grass Shader',
    author: 'Aleksandar Gjoreski',
    license: 'Referenced technique',
    link: 'https://aleksandargjoreski.dev/blog/trimming-my-grass-shader/',
    licenseLink: 'https://aleksandargjoreski.dev/blog/trimming-my-grass-shader/',
    usedFor: 'Thinning grass by distance, and seeding variation from world position.',
    category: 'Techniques and inspiration',
  },
  {
    name: 'How to Make The Fluffiest Grass With Three.js',
    author: 'Codrops',
    license: 'Referenced technique',
    link: 'https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/',
    licenseLink: 'https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/',
    usedFor: 'A soft, dense meadow built in three.js.',
    category: 'Techniques and inspiration',
  },
  {
    name: 'kage',
    author: 'MengTo',
    license: 'Motion reference',
    link: 'https://mengto.github.io/kage/',
    licenseLink: 'https://mengto.github.io/kage/',
    usedFor: 'A reference for calm, slow motion.',
    category: 'Techniques and inspiration',
  },
  {
    name: 'Cinzel',
    author: 'Natanael Gama',
    license: 'SIL Open Font License 1.1',
    link: 'https://fonts.google.com/specimen/Cinzel',
    licenseLink: ofl,
    usedFor: 'Display type and the wordmark.',
    category: 'Fonts',
  },
  {
    name: 'Inter',
    author: 'Rasmus Andersson',
    license: 'SIL Open Font License 1.1',
    link: 'https://rsms.me/inter/',
    licenseLink: ofl,
    usedFor: 'Body text.',
    category: 'Fonts',
  },
];
