/**
 * Download the CC0 set listed in the asset task into assets-src/.
 * Writes assets-src/SOURCES.md and assets-src/catalog.json.
 * Files over 25 MB are still downloaded so the pipeline can run.
 * SOURCES.md marks those so they stay out of git.
 *
 *   node scripts/fetch-cc0.mjs
 */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'assets-src');
const LIMIT = 25 * 1024 * 1024;
const HDRIS = [
  'alps_field',
  'evening_meadow',
  'qwantani_dusk_2_puresky',
  'kloofendal_48d_partly_cloudy_puresky',
  'rogland_clear_night',
];
const TEXTURES = [
  'fine_grained_wood',
  'weathered_brown_planks',
  'metal_plate',
  'forrest_ground_01',
  'brown_mud_leaves_01',
  'rocky_terrain_02',
  'bark_brown_02',
];
const MODELS = [
  'barrel_stove',
  'stone_fire_pit',
  'wooden_bucket_01',
  'fern_02',
  'rock_moss_set_01',
  'tree_stump_01',
  'pine_sapling_medium',
  'dandelion_01',
];
const MAPS = [
  ['Diffuse', 'diff'],
  ['nor_gl', 'nor_gl'],
  ['Rough', 'rough'],
  ['AO', 'ao'],
];

const catalog = { hdris: [], textures: [], models: [] };

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'aura-homes-assets', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function download(url, dest, expected) {
  await mkdir(path.dirname(dest), { recursive: true });
  if (expected && existsSync(dest)) {
    const size = (await stat(dest)).size;
    if (size === expected) return size;
  }
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'aura-homes-assets' } });
      if (!response.ok || !response.body) throw new Error(`${response.status} ${url}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
      return (await stat(dest)).size;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw last;
}

function authorsOf(info) {
  return Object.keys(info.authors || {});
}

function hdriUrl(slug, res) {
  return `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${res}/${slug}_${res}.hdr`;
}

function pickMap(files, key) {
  const block = files[key]?.['2k'];
  if (!block) return null;
  if (block.jpg) return { ...block.jpg, ext: 'jpg' };
  if (block.png) return { ...block.png, ext: 'png' };
  return null;
}

async function pool(items, limit, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        await fn(item);
      }
    }),
  );
}

async function fetchHdri(slug) {
  const info = await getJson(`https://api.polyhaven.com/info/${slug}`);
  const files = [];
  for (const res of ['1k', '2k']) {
    const url = hdriUrl(slug, res);
    const dest = path.join(srcRoot, 'hdri', `${slug}_${res}.hdr`);
    const size = await download(url, dest);
    files.push({ res, url, size, kept: size <= LIMIT, path: path.posix.join('hdri', `${slug}_${res}.hdr`) });
    console.log(`hdri ${slug} ${res}  ${mb(size)}`);
  }
  catalog.hdris.push({
    slug,
    name: info.name,
    authors: authorsOf(info),
    page: `https://polyhaven.com/a/${slug}`,
    files,
  });
}

async function fetchTexture(slug) {
  const [info, files] = await Promise.all([
    getJson(`https://api.polyhaven.com/info/${slug}`),
    getJson(`https://api.polyhaven.com/files/${slug}`),
  ]);
  const maps = [];
  for (const [key, fileName] of MAPS) {
    const chosen = pickMap(files, key);
    if (!chosen) {
      maps.push({ map: fileName, missing: true, key });
      console.warn(`texture ${slug} has no 2k ${key}`);
      continue;
    }
    const dest = path.join(srcRoot, 'textures', slug, `${fileName}.${chosen.ext}`);
    const size = await download(chosen.url, dest, chosen.size);
    maps.push({
      map: fileName,
      key,
      url: chosen.url,
      size,
      kept: size <= LIMIT,
      path: path.posix.join('textures', slug, `${fileName}.${chosen.ext}`),
    });
    console.log(`texture ${slug} ${fileName}  ${mb(size)}`);
  }
  catalog.textures.push({
    slug,
    name: info.name,
    authors: authorsOf(info),
    page: `https://polyhaven.com/a/${slug}`,
    maps,
  });
}

async function fetchModel(slug) {
  const [info, files] = await Promise.all([
    getJson(`https://api.polyhaven.com/info/${slug}`),
    getJson(`https://api.polyhaven.com/files/${slug}`),
  ]);
  const gltf = files.gltf?.['1k']?.gltf;
  if (!gltf?.url) throw new Error(`${slug} has no 1k glTF`);
  const dir = path.join(srcRoot, 'models', slug);
  const gltfName = path.basename(new URL(gltf.url).pathname);
  const written = [];
  const size = await download(gltf.url, path.join(dir, gltfName), gltf.size);
  written.push({ url: gltf.url, size, path: path.posix.join('models', slug, gltfName), kept: size <= LIMIT });
  const includes = Object.entries(gltf.include || {});
  await pool(includes, 4, async ([rel, meta]) => {
    const fileSize = await download(meta.url, path.join(dir, rel), meta.size);
    written.push({
      url: meta.url,
      size: fileSize,
      path: path.posix.join('models', slug, rel.split('\\').join('/')),
      kept: fileSize <= LIMIT,
    });
  });
  const total = written.reduce((sum, file) => sum + file.size, 0);
  console.log(`model ${slug}  ${written.length} files  ${mb(total)}`);
  catalog.models.push({
    slug,
    name: info.name,
    authors: authorsOf(info),
    page: `https://polyhaven.com/a/${slug}`,
    files: written,
    total,
  });
}

function fileLine(file) {
  const state = file.kept ? 'committed' : 'omitted from git, over 25 MB';
  return `- ${file.res || file.map || path.basename(file.path)}: ${mb(file.size)}, ${state}. ${file.url}`;
}

function section(title, items, body) {
  const lines = [`## ${title}`, ''];
  for (const item of items) {
    lines.push(`### ${item.name}`, '', `Authors: ${item.authors.join(', ') || 'Poly Haven contributors'}.`, `Page: ${item.page}`, '');
    lines.push(...body(item), '');
  }
  return lines;
}

function writeSources() {
  const lines = [
    '# Sources',
    '',
    'Raw downloads for the 3D pipeline. `npm run assets` reads this folder and writes the served files.',
    'Anything over 25 MB is downloaded for the build and listed here, and is not committed.',
    '',
    'Every Poly Haven asset is CC0. https://polyhaven.com/license',
    '',
    ...section('HDRIs', catalog.hdris, (item) => [
      '1k is for environment lighting. 2k is for a visible backdrop.',
      ...item.files.map(fileLine),
    ]),
    ...section('Textures', catalog.textures, (item) =>
      item.maps.map((map) => (map.missing ? `- ${map.map}: not published at 2k.` : fileLine(map))),
    ),
    ...section('Models', catalog.models, (item) => [
      `1k glTF, ${item.files.length} files, ${mb(item.total)} together.`,
      ...item.files.map(fileLine),
    ]),
  ];
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

async function main() {
  await pool(HDRIS, 2, fetchHdri);
  await pool(TEXTURES, 2, fetchTexture);
  await pool(MODELS, 2, fetchModel);
  catalog.hdris.sort((a, b) => HDRIS.indexOf(a.slug) - HDRIS.indexOf(b.slug));
  catalog.textures.sort((a, b) => TEXTURES.indexOf(a.slug) - TEXTURES.indexOf(b.slug));
  catalog.models.sort((a, b) => MODELS.indexOf(a.slug) - MODELS.indexOf(b.slug));
  await writeFile(path.join(srcRoot, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(path.join(srcRoot, 'SOURCES.md'), writeSources());
  const omitted = [
    ...catalog.hdris.flatMap((item) => item.files),
    ...catalog.textures.flatMap((item) => item.maps),
    ...catalog.models.flatMap((item) => item.files),
  ].filter((file) => file && file.kept === false);
  if (omitted.length) {
    console.log('Over 25 MB, leave out of git:');
    for (const file of omitted) console.log(`  ${file.path}`);
  } else {
    console.log('Every download is at or under 25 MB.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
