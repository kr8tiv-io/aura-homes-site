import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import fullQuality from '../data/avif-full-quality.json';
import keepWidths from '../data/srcset-keep.json';
import meadowSide from '../../public/film/story-meadow-side.webp';
import layoutSky from '../../public/film/layout-sky.webp';
import resortTower from '../../public/film/resort-tower.webp';
import farmWall from '../../public/film/farm-wall.webp';
import waterLine from '../../public/film/water-line.webp';

/** Widths at or under the master. Never upscale. */
const LADDER = [480, 640, 828, 960, 1280, 1600, 1920, 2560];

const collection1280 = import.meta.glob<ImageMetadata>(
  '../../public/film/collection/*-1280.webp',
  { eager: true, import: 'default' },
);
const collection1920 = import.meta.glob<ImageMetadata>(
  '../../public/film/collection/*-1920.webp',
  { eager: true, import: 'default' },
);

const films: Record<string, ImageMetadata> = {
  '/film/story-meadow-side.webp': meadowSide,
  '/film/layout-sky.webp': layoutSky,
  '/film/resort-tower.webp': resortTower,
  '/film/farm-wall.webp': farmWall,
  '/film/water-line.webp': waterLine,
};

export type PictureExtra = { image: ImageMetadata; original: string };

export type PictureSet = {
  avif: string;
  webp: string;
  /** Master WebP that ships today. Fallback src, and the full-size WebP candidate. */
  src: string;
  width: number;
  height: number;
};

const cache = new Map<string, Promise<PictureSet>>();

function widthsFor(master: number): number[] {
  const widths = LADDER.filter((width) => width <= master);
  if (!widths.includes(master)) widths.push(master);
  widths.sort((a, b) => a - b);
  return widths.length ? widths : [master];
}

function byBasename(map: Record<string, ImageMetadata>, name: string): ImageMetadata | undefined {
  const hit = Object.entries(map).find(([key]) => key.endsWith(`/${name}`));
  return hit?.[1];
}

export function filmMeta(src: string): { image: ImageMetadata; original: string } {
  const image = films[src];
  if (!image) throw new Error(`No public film for ${src}`);
  return { image, original: src };
}

export function collectionMeta(file: string): { image: ImageMetadata; original: string; extra?: PictureExtra } {
  const base = file.replace(/\.[^.]+$/, '');
  const image = byBasename(collection1280, `${base}-1280.webp`);
  if (!image) throw new Error(`No collection master for ${file}`);
  const original = `/film/collection/${base}-1280.webp`;
  const wider = byBasename(collection1920, `${base}-1920.webp`);
  const extra = wider && wider.width > image.width
    ? { image: wider, original: `/film/collection/${base}-1920.webp` }
    : undefined;
  return { image, original, extra };
}

function fullAvifQuality(original: string): number {
  const quality = (fullQuality as Record<string, number>)[original];
  if (!quality) throw new Error(`No full-size AVIF quality for ${original}`);
  return quality;
}

/**
 * Drop a width when that encode is at least as large as a wider one.
 * The browser would otherwise download more bytes for fewer pixels.
 * The kept wider file still covers the slot.
 */
function allowed(original: string, width: number, format: 'avif' | 'webp'): boolean {
  const row = (keepWidths as Record<string, { avif: number[]; webp: number[] }>)[original];
  if (!row) return true;
  return row[format].includes(width);
}

async function candidate(image: ImageMetadata, width: number, format: 'avif' | 'webp', quality: number) {
  const result = await getImage({ src: image, width, format, quality });
  return { url: result.src, width: result.attributes.width ?? width };
}

function srcset(parts: { url: string; width: number }[]): string {
  const byWidth = new Map<number, string>();
  for (const part of parts) byWidth.set(part.width, part.url);
  return [...byWidth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([width, url]) => `${url} ${width}w`)
    .join(', ');
}

async function build(image: ImageMetadata, original: string, extra?: PictureExtra): Promise<PictureSet> {
  const master = image.width;
  const avifParts: { url: string; width: number }[] = [];
  const webpParts: { url: string; width: number }[] = [];
  for (const width of widthsFor(master)) {
    const full = width >= master;
    const slot = full ? master : width;
    // Full-size AVIF is chosen per file so SSIM stays at or above 0.985 and the file stays smaller than the WebP. Smaller widths use one setting that cleared the hardest samples.
    if (full || allowed(original, slot, 'avif')) {
      avifParts.push(await candidate(image, slot, 'avif', full ? fullAvifQuality(original) : 94));
    }
    if (full || allowed(original, slot, 'webp')) {
      if (full) webpParts.push({ url: original, width: master });
      else webpParts.push(await candidate(image, slot, 'webp', 94));
    }
  }
  if (extra && extra.image.width > master) {
    if (allowed(original, extra.image.width, 'avif')) {
      avifParts.push(await candidate(extra.image, extra.image.width, 'avif', fullAvifQuality(extra.original)));
    }
    if (allowed(original, extra.image.width, 'webp')) {
      webpParts.push({ url: extra.original, width: extra.image.width });
    }
  }
  return {
    avif: srcset(avifParts),
    webp: srcset(webpParts),
    src: original,
    width: image.width,
    height: image.height,
  };
}

/** One encode set per public file, shared by the picture and its preload. */
export function pictureSet(image: ImageMetadata, original: string, extra?: PictureExtra): Promise<PictureSet> {
  const key = `${original}|${extra?.original ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const task = build(image, original, extra);
  cache.set(key, task);
  return task;
}
