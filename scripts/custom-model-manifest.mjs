/**
 * Files that actually exist under public/models/custom.
 * The client imports this virtual module and never probes a missing GLB.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'models', 'custom');
const virtual = 'virtual:aura-custom-models';
const resolved = `\0${virtual}`;

function filesOnDisk() {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const name of names) {
    if (!name.endsWith('.glb')) continue;
    const full = path.join(dir, name);
    let info;
    try {
      info = statSync(full);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isFile() || info.size <= 0) continue;
    files.push({ file: name, bytes: info.size });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return files;
}

function inCustomDir(file) {
  const rel = path.relative(dir, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function customModelManifest() {
  return {
    name: 'aura-custom-models',
    resolveId(id) {
      if (id === virtual) return resolved;
    },
    load(id) {
      if (id !== resolved) return null;
      return `export const CUSTOM_FILES = ${JSON.stringify(filesOnDisk())};\n`;
    },
    configureServer(server) {
      const bump = (file) => {
        if (!inCustomDir(file)) return;
        const mod = server.moduleGraph.getModuleById(resolved);
        if (!mod) return;
        server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', bump);
      server.watcher.on('unlink', bump);
      server.watcher.on('change', bump);
    },
  };
}
