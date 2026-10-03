import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import meadowSide from '../../public/film/story-meadow-side.webp';
import storyRoom from '../../public/film/story-room.webp';
import storyNest from '../../public/film/story-nest.webp';
import lounge from '../../public/film/layout-lounge-wind.webp';
import forest from '../../public/film/layout-forest.webp';
import sky from '../../public/film/layout-sky.webp';
import night from '../../public/film/layout-night.webp';
import resortDeck from '../../public/film/resort-deck.webp';
import resortTower from '../../public/film/resort-tower.webp';
import farmWall from '../../public/film/farm-wall.webp';
import farmRoom from '../../public/film/farm-room.webp';
import waterLine from '../../public/film/water-line.webp';
import costaCanopy from '../../public/film/costa-canopy.webp';

const stills: Record<string, ImageMetadata> = {
  '/film/story-meadow-side.webp': meadowSide,
  '/film/story-room.webp': storyRoom,
  '/film/story-nest.webp': storyNest,
  '/film/layout-lounge-wind.webp': lounge,
  '/film/layout-forest.webp': forest,
  '/film/layout-sky.webp': sky,
  '/film/layout-night.webp': night,
  '/film/resort-deck.webp': resortDeck,
  '/film/resort-tower.webp': resortTower,
  '/film/farm-wall.webp': farmWall,
  '/film/farm-room.webp': farmRoom,
  '/film/water-line.webp': waterLine,
  '/film/costa-canopy.webp': costaCanopy,
};

export function still(src: string): ImageMetadata {
  const image = stills[src];
  if (!image) throw new Error(`No still for ${src}`);
  return image;
}

/** One resized WebP for a video poster. The poster attribute takes a single URL. */
export async function posterSrc(src: string): Promise<string> {
  const image = still(src);
  const width = Math.min(1280, image.width);
  const result = await getImage({ src: image, format: 'webp', width, quality: 68 });
  return result.src;
}
