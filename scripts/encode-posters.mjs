/**
 * Same-pixel AVIF posters next to the WebP files the site already ships.
 * WebP files stay. A 1280 cabin poster is a downscale of the 1920 poster.
 * Run from the site root: node scripts/encode-posters.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from '../node_modules/sharp/dist/index.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-poster-'));

const posters = [
  'public/media/video/deck-poster.webp',
  'public/media/video/tower-poster.webp',
  'public/media/video/water-line-poster.webp',
  'public/media/video/hero-meadow-poster.webp',
  'public/media/video/hero-room-poster.webp',
  'public/media/video/hero-lounge-poster.webp',
  'public/media/video/hero-deck-poster.webp',
  'public/media/video/hot-tub-time-machine-poster.webp',
  'public/media/video/cool-runnings-poster.webp',
  'public/film/story-meadow-side.webp',
  'public/film/story-room.webp',
  'public/film/story-nest.webp',
  'public/film/layout-shell.webp',
  'public/film/layout-forest.webp',
  'public/film/layout-door.webp',
  'public/film/layout-office.webp',
  'public/film/layout-corner.webp',
  'public/film/layout-sky.webp',
  'public/film/layout-lounge-wind.webp',
  'public/film/layout-night.webp',
  'public/film/layout-roof.webp',
  'public/film/layout-gazebo.webp',
  'public/film/cabin-dusk-1920-poster.webp',
  'public/film/cabin-poster-hi.webp',
];

function ssim(encoded, reference) {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', encoded, '-i', reference, '-lavfi', 'ssim', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const text = `${result.stderr || ''}\n${result.stdout || ''}`;
  const match = text.match(/All:([0-9.]+)/);
  if (!match) throw new Error(`no ssim for ${encoded}\n${text.slice(-500)}`);
  return Number(match[1]);
}

async function encodeAvif(src, dest, quality) {
  await sharp(src).avif({ quality, effort: 4 }).toFile(dest);
}

const rows = [];

for (const rel of posters) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) {
    console.error(`MISSING ${rel}`);
    process.exitCode = 1;
    continue;
  }
  const meta = await sharp(src).metadata();
  const ref = path.join(tmp, `${path.basename(rel)}.png`);
  await sharp(src).png().toFile(ref);
  const dest = src.replace(/\.webp$/, '.avif');
  const webpBytes = fs.statSync(src).size;
  let quality = 55;
  let score = 0;
  let bytes = 0;
  for (const attempt of [55, 65, 70, 75, 80]) {
    quality = attempt;
    await encodeAvif(src, dest, quality);
    bytes = fs.statSync(dest).size;
    score = ssim(dest, ref);
    if (score >= 0.985) break;
  }
  rows.push({
    file: rel,
    width: meta.width,
    height: meta.height,
    quality,
    webpKB: Math.round(webpBytes / 1024),
    avifKB: Math.round(bytes / 1024),
    ssim: Number(score.toFixed(4)),
  });
  console.log(`${rel} q${quality} ${Math.round(bytes / 1024)}KB webp ${Math.round(webpBytes / 1024)}KB ssim ${score.toFixed(4)}`);
}

const cabinSrc = path.join(root, 'public/film/cabin-dusk-1920-poster.webp');
const cabinMeta = await sharp(cabinSrc).metadata();
const cabinWidth = Math.min(1280, cabinMeta.width);
const cabinRef = path.join(tmp, 'cabin-1280.png');
await sharp(cabinSrc).resize({ width: cabinWidth, kernel: 'lanczos3', withoutEnlargement: true }).png().toFile(cabinRef);
const cabinAvif = path.join(root, 'public/film/cabin-dusk-1280-poster.avif');
const cabinWebp = path.join(root, 'public/film/cabin-dusk-1280-poster.webp');
await sharp(cabinSrc)
  .resize({ width: cabinWidth, kernel: 'lanczos3', withoutEnlargement: true })
  .webp({ quality: 88, effort: 4, smartSubsample: false })
  .toFile(cabinWebp);
let cabinQuality = 55;
let cabinScore = 0;
for (const attempt of [55, 60, 65, 70, 75, 80, 88, 94]) {
  cabinQuality = attempt;
  await sharp(cabinSrc)
    .resize({ width: cabinWidth, kernel: 'lanczos3', withoutEnlargement: true })
    .avif({ quality: attempt, effort: 4 })
    .toFile(cabinAvif);
  cabinScore = ssim(cabinAvif, cabinRef);
  const smaller = fs.statSync(cabinAvif).size < fs.statSync(cabinWebp).size;
  if (cabinScore >= 0.985 && smaller) break;
}
const cabinWebpRefScore = ssim(cabinWebp, cabinRef);
rows.push({
  file: 'public/film/cabin-dusk-1280-poster.avif',
  width: cabinWidth,
  height: null,
  quality: cabinQuality,
  webpKB: Math.round(fs.statSync(cabinWebp).size / 1024),
  avifKB: Math.round(fs.statSync(cabinAvif).size / 1024),
  ssim: Number(cabinScore.toFixed(4)),
  webpSSIM: Number(cabinWebpRefScore.toFixed(4)),
  note: 'downscale of cabin-dusk-1920-poster, SSIM vs lanczos3 PNG',
});
console.log(`cabin-1280 avif q${cabinQuality} ssim ${cabinScore.toFixed(4)} webp q88 ssim ${cabinWebpRefScore.toFixed(4)}`);

const out = path.join(os.tmpdir(), 'poster-ssim.json');
fs.writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(`wrote ${out}`);
const low = rows.filter((row) => row.ssim < 0.985);
if (low.length) {
  console.error(`BELOW TARGET ${low.map((row) => row.file).join(', ')}`);
  process.exitCode = 1;
}
