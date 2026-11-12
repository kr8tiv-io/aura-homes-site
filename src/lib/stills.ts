import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import meadowSide from '../assets/media/story-meadow-side.webp';
import storyRoom from '../assets/media/story-room.webp';
import storyNest from '../assets/media/story-nest.webp';
import lounge from '../assets/media/layout-lounge-wind.webp';
import forest from '../assets/media/layout-forest.webp';
import gazebo from '../assets/media/layout-gazebo.webp';
import shell from '../assets/media/layout-shell.webp';
import sky from '../assets/media/layout-sky.webp';
import night from '../assets/media/layout-night.webp';
import resortDeck from '../assets/media/resort-deck.webp';
import resortTower from '../assets/media/resort-tower.webp';
import farmWall from '../assets/media/farm-wall.webp';
import farmRoom from '../assets/media/farm-room.webp';
import farmsExteriorSolar from '../assets/media/farms-exterior-solar.webp';
import farmsConsumables from '../assets/media/farms-consumables.webp';
import farmsMicroCity from '../assets/media/farms-micro-city.webp';
import farmsDinnerTable from '../assets/media/farms-dinner-table.webp';
import farmsRootsMist from '../assets/media/farms-roots-mist.webp';
import farmsWinter from '../assets/media/farms-winter.webp';
import waterLine from '../assets/media/water-line.webp';
import h2oExteriorAlberta from '../assets/media/h2o-exterior-alberta.webp';
import h2oExteriorWinter from '../assets/media/h2o-exterior-winter.webp';
import h2oBottleFill from '../assets/media/h2o-bottle-fill.webp';
import h2oBackyardBottling from '../assets/media/h2o-backyard-bottling.webp';
import h2oSponsorBottle from '../assets/media/h2o-sponsor-bottle.webp';
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
import hotTubTimeMachine from '../assets/media/hot-tub-time-machine.webp';
import coolRunnings from '../assets/media/cool-runnings.webp';
import fireAndIce from '../assets/media/fire-and-ice.webp';
import tubWardBound from '../assets/media/tub-ward-bound.webp';
import skyCollection from '../../public/film/collection/layout-sky-1280.webp';
import nightCollection from '../../public/film/collection/layout-night-1280.webp';
import gazeboCollection from '../../public/film/collection/layout-gazebo-1280.webp';
import forestCollection from '../../public/film/collection/layout-forest-1280.webp';
import farmWallCollection from '../../public/film/collection/farm-wall-1280.webp';

const stills: Record<string, ImageMetadata> = {
  '/film/story-meadow-side.webp': meadowSide,
  '/film/story-room.webp': storyRoom,
  '/film/story-nest.webp': storyNest,
  '/film/layout-lounge-wind.webp': lounge,
  '/film/layout-forest.webp': forest,
  '/film/layout-gazebo.webp': gazebo,
  '/film/layout-shell.webp': shell,
  '/film/layout-sky.webp': sky,
  '/film/layout-night.webp': night,
  '/film/resort-deck.webp': resortDeck,
  '/film/resort-tower.webp': resortTower,
  '/film/farm-wall.webp': farmWall,
  '/film/farm-room.webp': farmRoom,
  '/film/farms-exterior-solar.webp': farmsExteriorSolar,
  '/film/farms-consumables.webp': farmsConsumables,
  '/film/farms-micro-city.webp': farmsMicroCity,
  '/film/farms-dinner-table.webp': farmsDinnerTable,
  '/film/farms-roots-mist.webp': farmsRootsMist,
  '/film/farms-winter.webp': farmsWinter,
  '/film/water-line.webp': waterLine,
  '/film/h2o-exterior-alberta.webp': h2oExteriorAlberta,
  '/film/h2o-exterior-winter.webp': h2oExteriorWinter,
  '/film/h2o-bottle-fill.webp': h2oBottleFill,
  '/film/h2o-backyard-bottling.webp': h2oBackyardBottling,
  '/film/h2o-sponsor-bottle.webp': h2oSponsorBottle,
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
  '/media/specialty/hot-tub-time-machine.jpg': hotTubTimeMachine,
  '/media/specialty/cool-runnings.jpg': coolRunnings,
  '/media/specialty/fire-and-ice.jpg': fireAndIce,
  '/media/specialty/tub-ward-bound.jpg': tubWardBound,
  '/film/collection/layout-sky-1280.webp': skyCollection,
  '/film/collection/layout-night-1280.webp': nightCollection,
  '/film/collection/layout-gazebo-1280.webp': gazeboCollection,
  '/film/collection/layout-forest-1280.webp': forestCollection,
  '/film/collection/farm-wall-1280.webp': farmWallCollection,
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
