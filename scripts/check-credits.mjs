/**
 * Warn when a file in public/models, public/hdri, public/textures, or public/decoders
 * is not named by a credits entry `files` array. Warnings do not fail the build.
 *
 *   node scripts/check-credits.mjs
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customModelCredits } from './custom-credits.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const creditsPath = path.join(root, 'src', 'data', 'credits.ts');
const watched = ['models', 'hdri', 'textures', 'decoders'];

const source = await readFile(creditsPath, 'utf8');
const mentioned = [];
for (const block of source.matchAll(/files\s*:\s*\[([\s\S]*?)\]/g)) {
  for (const hit of block[1].matchAll(/['"]([^'"]+)['"]/g)) {
    mentioned.push(hit[1].replaceAll('\\', '/').replace(/^\/+/, '').replace(/^public\//, ''));
  }
}

for (const entry of await customModelCredits(root)) {
  for (const file of entry.files ?? []) mentioned.push(file);
}

function covers(rel) {
  return mentioned.some((entry) => entry === rel || entry.endsWith(`/${rel}`) || rel.endsWith(`/${entry}`));
}

async function walk(dir, relDir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    const rel = `${relDir}/${name}`.replaceAll('\\', '/');
    const info = await stat(abs);
    if (info.isDirectory()) found.push(...(await walk(abs, rel)));
    else if (!['.md', '.json', '.txt'].includes(path.extname(name).toLowerCase())) found.push(rel);
  }
  return found;
}

const missing = [];
for (const folder of watched) {
  const abs = path.join(root, 'public', folder);
  try {
    const info = await stat(abs);
    if (!info.isDirectory()) continue;
  } catch (error) {
    if (error && error.code === 'ENOENT') continue;
    throw error;
  }
  for (const rel of await walk(abs, folder)) {
    if (!covers(rel)) missing.push(`public/${rel}`);
  }
}

if (missing.length) {
  console.warn(`credits: ${missing.length} file${missing.length === 1 ? '' : 's'} with no credits entry`);
  for (const file of missing) console.warn(`credits: no entry mentions ${file}`);
}
