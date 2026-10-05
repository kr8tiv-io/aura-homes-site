/**
 * Credits for a custom model Matt dropped in public/models/custom.
 * A sidecar counts only when that slot's GLB (or a lod) is actually on disk.
 * Missing or broken JSON is skipped. The build warning still names the GLB.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const customSlots = {
  'aura-unit': 'the room',
  'hot-tub': 'the tub',
  gazebo: 'the gazebo',
  'a-frame': 'the A-frame',
};

const levels = ['', '.lod1', '.lod2'];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function exists(file) {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function customModelCredits(root = path.resolve(here, '..')) {
  const dir = path.join(root, 'public', 'models', 'custom');
  let names = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const present = new Set(names);
  const credits = [];
  for (const slot of Object.keys(customSlots)) {
    if (!present.has(`${slot}.json`)) continue;
    const files = [];
    for (const level of levels) {
      const rel = `models/custom/${slot}${level}.glb`;
      if (present.has(`${slot}${level}.glb`) && (await exists(path.join(root, 'public', rel)))) {
        files.push(rel);
      }
    }
    if (!files.length) continue;
    let data;
    try {
      data = JSON.parse(await readFile(path.join(dir, `${slot}.json`), 'utf8'));
    } catch (error) {
      console.warn(`credits: skipped public/models/custom/${slot}.json (${error instanceof Error ? error.message : error})`);
      continue;
    }
    const name = text(data?.name);
    const author = text(data?.author);
    const license = text(data?.license);
    const link = text(data?.link);
    const tool = text(data?.tool);
    if (!name || !author || !license || !link) {
      console.warn(`credits: skipped public/models/custom/${slot}.json (name, author, license, and link are required)`);
      continue;
    }
    const made = tool ? ` Made with ${tool}.` : '';
    credits.push({
      name,
      author,
      license,
      link,
      usedFor: `A custom model for ${customSlots[slot]}.${made}`,
      category: '3D models',
      files,
    });
  }
  return credits;
}
