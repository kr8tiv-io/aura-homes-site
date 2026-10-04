import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import meadowSide from '../assets/media/story-meadow-side.webp';
import storyRoom from '../assets/media/story-room.webp';
import storyNest from '../assets/media/story-nest.webp';
import lounge from '../assets/media/layout-lounge-wind.webp';
import forest from '../assets/media/layout-forest.webp';
import sky from '../assets/media/layout-sky.webp';
import night from '../assets/media/layout-night.webp';
import resortDeck from '../assets/media/resort-deck.webp';
import resortTower from '../assets/media/resort-tower.webp';
import farmWall from '../assets/media/farm-wall.webp';
import farmRoom from '../assets/media/farm-room.webp';
import waterLine from '../assets/media/water-line.webp';
import costaCanopy from '../assets/media/costa-canopy.webp';
import aframeGolden from '../assets/media/aframe-golden-hour-meadow.webp';
import aframeAerial from '../assets/media/aframe-aerial-blue-hour-snow.webp';
import aframeDeck from '../assets/media/aframe-deck-detail-dusk.webp';
import towerGolden from '../assets/media/tower-golden-hour-meadow.webp';
import towerWinter from '../assets/media/tower-winter-dusk-wide.webp';
import towerNight from '../assets/media/tower-night-stars.webp';
import towerAerial from '../assets/media/tower-aerial-sunrise.webp';
import towerGlass from '../assets/media/tower-glass-detail-blue-hour.webp';
import towerLake from '../assets/media/tower-lake-summer-dusk.webp';

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
  '/media/specialty/aframe-golden-hour-meadow.jpg': aframeGolden,
  '/media/specialty/aframe-aerial-blue-hour-snow.jpg': aframeAerial,
  '/media/specialty/aframe-deck-detail-dusk.jpg': aframeDeck,
  '/media/specialty/tower-golden-hour-meadow.jpg': towerGolden,
  '/media/specialty/tower-winter-dusk-wide.jpg': towerWinter,
  '/media/specialty/tower-night-stars.jpg': towerNight,
  '/media/specialty/tower-aerial-sunrise.jpg': towerAerial,
  '/media/specialty/tower-glass-detail-blue-hour.jpg': towerGlass,
  '/media/specialty/tower-lake-summer-dusk.jpg': towerLake,
};

export function still(src: string): ImageMetadata {
  const image = stills[src];
  if (!image) throw new Error(`No still for ${src}`);
  return image;
}

/** One resized WebP for a video poster. The poster attribute takes a single URL. */
export async function posterSrc(src: string): Promise<string> {
  const image = still(src);
  const width = Math.min(1920, image.width);
  const result = await getImage({ src: image, format: 'webp', width, quality: 68 });
  return result.src;
}
