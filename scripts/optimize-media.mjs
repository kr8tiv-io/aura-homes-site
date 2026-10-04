/**
 * Upscale widescreen stills and short films, then write AVIF and WebP.
 *
 * Splash stay put: public/film/cabin-dusk-hi.mp4, its poster, and every
 * scroll film or poster the landing page still points at. This script never
 * overwrites those paths.
 *
 * Images use realesrgan-ncnn-vulkan when the binary is on PATH or at
 * REALESRGAN. Otherwise sharp resizes with lanczos3.
 * Videos use ffmpeg scale=...:flags=lanczos, AV1 and H.264, no audio.
 *
 *   node scripts/optimize-media.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.join(root, '_archive', 'originals');
const masters = path.join(root, 'src', 'assets', 'media');
const sized = path.join(root, 'public', 'media', 'sized');
const videos = path.join(root, 'public', 'media', 'video');
const WIDTHS = [1280, 1920, 2560];
const SOFT_SCALE = 1.75;

/** Landing-page bytes. Read, never write. */
const SPLASH = new Set([
  'public/film/cabin-dusk-hi.mp4',
  'public/film/cabin-poster-hi.webp',
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
  'public/film/scroll/meadow-side.mp4',
  'public/film/scroll/room.mp4',
  'public/film/scroll/nest.mp4',
  'public/film/scroll/shell.mp4',
  'public/film/scroll/forest.mp4',
  'public/film/scroll/door.mp4',
  'public/film/scroll/office.mp4',
  'public/film/scroll/corner.mp4',
  'public/film/scroll/sky.mp4',
  'public/film/scroll/lounge-wind.mp4',
  'public/film/scroll/night.mp4',
  'public/film/scroll/roof.mp4',
  'public/film/scroll/gazebo.mp4',
]);

const STILLS = [
  'public/film/story-meadow-side.webp',
  'public/film/story-room.webp',
  'public/film/story-nest.webp',
  'public/film/layout-lounge-wind.webp',
  'public/film/layout-forest.webp',
  'public/film/layout-sky.webp',
  'public/film/layout-night.webp',
  'public/film/resort-deck.webp',
  'public/film/resort-tower.webp',
  'public/film/farm-wall.webp',
  'public/film/farm-room.webp',
  'public/film/water-line.webp',
  'public/film/costa-canopy.webp',
  'public/media/specialty/aframe-golden-hour-meadow.jpg',
  'public/media/specialty/aframe-aerial-blue-hour-snow.jpg',
  'public/media/specialty/aframe-deck-detail-dusk.jpg',
  'public/media/specialty/tower-golden-hour-meadow.jpg',
  'public/media/specialty/tower-winter-dusk-wide.jpg',
  'public/media/specialty/tower-night-stars.jpg',
  'public/media/specialty/tower-aerial-sunrise.jpg',
  'public/media/specialty/tower-glass-detail-blue-hour.jpg',
  'public/media/specialty/tower-lake-summer-dusk.jpg',
];

/** name, source, target width. Hero loops aim at 2560. Others at 1920. */
const FILMS = [
  ['hero-room', 'public/film/hero/room.mp4', 2560],
  ['hero-lounge', 'public/film/hero/lounge.mp4', 2560],
  ['hero-meadow', 'public/film/hero/meadow.mp4', 2560],
  ['hero-deck', 'public/film/hero/deck.mp4', 2560],
  ['deck', 'public/film/scroll/deck.mp4', 1920],
  ['tower', 'public/film/scroll/tower.mp4', 1920],
  ['farm-wall', 'public/film/scroll/farm-wall.mp4', 1920],
  ['farm-room', 'public/film/scroll/farm-room.mp4', 1920],
  ['water-line', 'public/film/scroll/water-line.mp4', 1920],
  ['builder-enter', 'public/film/builder-enter.mp4', 1920],
];

const report = [];

function rel(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function abs(file) {
  return path.join(root, file);
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function keepOriginal(file) {
  const dest = path.join(archive, file);
  ensure(path.dirname(dest));
  if (!fs.existsSync(dest)) fs.copyFileSync(abs(file), dest);
}

function retire(file) {
  if (SPLASH.has(file)) throw new Error(`Refusing to move splash media ${file}`);
  const dest = path.join(archive, file);
  ensure(path.dirname(dest));
  if (!fs.existsSync(abs(file))) return;
  if (!fs.existsSync(dest)) {
    fs.renameSync(abs(file), dest);
    return;
  }
  const unused = path.join(root, '_archive', 'unused', file);
  ensure(path.dirname(unused));
  if (!fs.existsSync(unused)) fs.renameSync(abs(file), unused);
}

function findRealesrgan() {
  const fromEnv = process.env.REALESRGAN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const found = spawnSync('where', ['realesrgan-ncnn-vulkan'], { encoding: 'utf8' });
  const line = found.stdout?.split(/\r?\n/).find(Boolean);
  return line || null;
}

const realesrgan = findRealesrgan();

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const tail = `${result.stderr || ''}\n${result.stdout || ''}`.trim().split(/\r?\n/).slice(-12).join('\n');
    throw new Error(`${cmd} ${args.join(' ')}\n${tail}`);
  }
}

async function edgeEnergy(input) {
  const { data, info } = await sharp(input)
    .greyscale()
    .resize(320, 180, { fit: 'cover' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  let acc = 0;
  for (let y = 0; y < info.height - 1; y += 1) {
    for (let x = 0; x < w - 1; x += 1) {
      const i = y * w + x;
      acc += Math.abs(data[i] - data[i + 1]) + Math.abs(data[i] - data[i + w]);
    }
  }
  return acc / (info.width * info.height);
}

async function upscaleImage(input, width) {
  const meta = await sharp(input).metadata();
  const sourceWidth = meta.width || width;
  if (sourceWidth >= width) {
    return { buffer: await sharp(input).toBuffer(), scaler: 'none', scale: 1, sourceWidth };
  }
  if (realesrgan) {
    const tmpIn = path.join(os.tmpdir(), `aura-in-${path.basename(input)}.png`);
    const tmpOut = path.join(os.tmpdir(), `aura-out-${path.basename(input)}.png`);
    await sharp(input).png().toFile(tmpIn);
    run(realesrgan, ['-i', tmpIn, '-o', tmpOut, '-n', 'realesrgan-x4plus', '-s', '4']);
    const buffer = await sharp(tmpOut)
      .resize({ width, kernel: sharp.kernel.lanczos3, withoutEnlargement: true })
      .toBuffer();
    fs.rmSync(tmpIn, { force: true });
    fs.rmSync(tmpOut, { force: true });
    return { buffer, scaler: 'realesrgan-x4plus', scale: width / sourceWidth, sourceWidth };
  }
  const buffer = await sharp(input)
    .resize({ width, kernel: sharp.kernel.lanczos3 })
    .toBuffer();
  return { buffer, scaler: 'lanczos3', scale: width / sourceWidth, sourceWidth };
}

async function writeSized(buffer, name) {
  const rows = [];
  for (const width of WIDTHS) {
    const base = sharp(buffer).resize({ width, kernel: sharp.kernel.lanczos3, withoutEnlargement: true });
    const avif = path.join(sized, `${name}-${width}.avif`);
    const webp = path.join(sized, `${name}-${width}.webp`);
    await base.clone().avif({ quality: 50, effort: 4 }).toFile(avif);
    await base.clone().webp({ quality: 68, effort: 4 }).toFile(webp);
    rows.push({ width, avif: fs.statSync(avif).size, webp: fs.statSync(webp).size });
  }
  return rows;
}

async function processStill(file) {
  if (SPLASH.has(file)) keepOriginal(file);
  else keepOriginal(file);
  const name = path.basename(file, path.extname(file));
  const before = fs.statSync(abs(file)).size;
  const beforeEnergy = await edgeEnergy(abs(file));
  const { buffer, scaler, scale, sourceWidth } = await upscaleImage(abs(file), 2560);
  const master = path.join(masters, `${name}.webp`);
  await sharp(buffer).webp({ quality: 84, effort: 4 }).toFile(master);
  const sizes = await writeSized(buffer, name);
  const afterEnergy = await edgeEnergy(master);
  const soft = scale >= SOFT_SCALE || afterEnergy < beforeEnergy * 0.72;
  const row = {
    kind: 'image',
    source: file,
    sourceWidth,
    before,
    master: rel(master),
    masterBytes: fs.statSync(master).size,
    scaler,
    scale: Number(scale.toFixed(2)),
    soft,
    sizes,
  };
  report.push(row);
  console.log(`${name}  ${sourceWidth}px -> 2560  ${scaler}  ${soft ? 'soft' : 'ok'}`);
}

function encodeVideo(input, output, width, codec) {
  const vf = `scale=${width}:-2:flags=lanczos`;
  const shared = ['-y', '-i', input, '-an', '-vf', vf, '-r', '24', '-pix_fmt', 'yuv420p'];
  if (codec === 'av1') {
    run('ffmpeg', [...shared, '-c:v', 'libsvtav1', '-crf', '32', '-preset', '6', output]);
    return;
  }
  run('ffmpeg', [...shared, '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', output]);
}

function encodeTighter(input, output, width, codec, crf) {
  const vf = `scale=${width}:-2:flags=lanczos`;
  const shared = ['-y', '-i', input, '-an', '-vf', vf, '-r', '24', '-pix_fmt', 'yuv420p'];
  if (codec === 'av1') {
    run('ffmpeg', [...shared, '-c:v', 'libsvtav1', '-crf', String(crf), '-preset', '6', output]);
    return;
  }
  run('ffmpeg', [...shared, '-c:v', 'libx264', '-crf', String(crf), '-preset', 'slow', '-movflags', '+faststart', output]);
}

async function posterFrom(input, outBase, width) {
  const png = path.join(os.tmpdir(), `${path.basename(outBase)}-poster.png`);
  run('ffmpeg', ['-y', '-ss', '1', '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2:flags=lanczos`, png]);
  const webp = `${outBase}-poster.webp`;
  const avif = `${outBase}-poster.avif`;
  await sharp(png).webp({ quality: 68, effort: 4 }).toFile(webp);
  await sharp(png).avif({ quality: 50, effort: 4 }).toFile(avif);
  fs.rmSync(png, { force: true });
  return { webp: fs.statSync(webp).size, avif: fs.statSync(avif).size };
}

async function processFilm(name, file, width) {
  if (SPLASH.has(file)) throw new Error(`Splash film listed for encode: ${file}`);
  const live = abs(file);
  const archived = path.join(archive, file);
  const input = fs.existsSync(live) ? live : archived;
  if (!fs.existsSync(input)) throw new Error(`missing film ${file}`);
  const before = fs.statSync(input).size;
  const outBase = path.join(videos, name);
  const webm = `${outBase}.webm`;
  const mp4 = `${outBase}.mp4`;
  encodeVideo(input, webm, width, 'av1');
  encodeVideo(input, mp4, width, 'h264');
  const cap = 4.2 * 1024 * 1024;
  let av1Crf = 32;
  let x264Crf = 23;
  for (let pass = 0; pass < 6; pass += 1) {
    const overWebm = fs.statSync(webm).size > cap;
    const overMp4 = fs.statSync(mp4).size > cap;
    if (!overWebm && !overMp4) break;
    let changed = false;
    if (overWebm && av1Crf < 52) {
      av1Crf += 4;
      encodeTighter(input, webm, width, 'av1', av1Crf);
      changed = true;
    }
    if (overMp4 && x264Crf < 38) {
      x264Crf += 3;
      encodeTighter(input, mp4, width, 'h264', x264Crf);
      changed = true;
    }
    if (!changed) break;
  }
  const posters = await posterFrom(input, outBase, Math.min(width, 1920));
  if (fs.existsSync(live)) retire(file);
  const row = {
    kind: 'video',
    source: file,
    before,
    width,
    webm: fs.statSync(webm).size,
    mp4: fs.statSync(mp4).size,
    av1Crf,
    x264Crf,
    posters,
  };
  report.push(row);
  console.log(`${name}  ${(before / 1024).toFixed(0)}KB -> webm ${(row.webm / 1024).toFixed(0)}KB  mp4 ${(row.mp4 / 1024).toFixed(0)}KB`);
}

ensure(masters);
ensure(sized);
ensure(videos);

console.log(realesrgan ? `upscaler ${realesrgan}` : 'upscaler sharp lanczos3');

for (const file of STILLS) {
  try {
    await processStill(file);
  } catch (error) {
    console.error(`image failed ${file}`);
    console.error(error);
    report.push({ kind: 'image', source: file, error: String(error) });
  }
}

for (const [name, file, width] of FILMS) {
  try {
    await processFilm(name, file, width);
  } catch (error) {
    console.error(`video failed ${file}`);
    console.error(error);
    report.push({ kind: 'video', source: file, error: String(error) });
  }
}

const reportPath = path.join(root, 'scripts', 'media-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`wrote ${rel(reportPath)}`);
