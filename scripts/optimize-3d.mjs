/**
 * Optimize raw models and textures into the files the site serves.
 *
 * Models in assets-src/models (.glb or .gltf):
 *   dedup, prune, weld, resize to 2048,
 *   UASTC for normal maps, ETC1S for colour, Meshopt,
 *   then LOD1 (ratio 0.5) and LOD2 (ratio 0.15).
 *   Writes public/models/<name>.glb, <name>.lod1.glb, <name>.lod2.glb.
 *   A .glb dropped in public/models/custom (not a lod) is optimized in place
 *   to custom/<name>.glb, custom/<name>.lod1.glb, and custom/<name>.lod2.glb.
 *
 * Textures in assets-src/textures (png or jpeg):
 *   the same KTX2 choice, max 2048, written under public/textures as .ktx2.
 *   A normal map is any file whose name contains "nor" or "normal".
 *
 * HDR files in assets-src/hdri are copied to public/hdri unchanged.
 * 1k is for environment lighting. 2k is for a visible backdrop.
 *
 * Requires KTX-Software 4.4 or newer (`ktx` on PATH, or tools/ktx-software).
 * https://github.com/KhronosGroup/KTX-Software/releases
 *
 *   node scripts/optimize-3d.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
const modelsSrc = path.join(root, 'assets-src', 'models');
const texturesSrc = path.join(root, 'assets-src', 'textures');
const hdriSrc = path.join(root, 'assets-src', 'hdri');
const modelsOut = path.join(root, 'public', 'models');
const texturesOut = path.join(root, 'public', 'textures');
const hdriOut = path.join(root, 'public', 'hdri');
const scratch = path.join(root, 'assets-src', '.tmp');
const MAX_EDGE = '2048';
const LIMIT = 25 * 1024 * 1024;

const ktxPath = findKtx();

function findKtx() {
  try {
    const listed = execFileSync('where.exe', ['ktx'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const line = listed
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean);
    if (line) return line;
  } catch {
    /* not on PATH */
  }
  const base = path.join(root, 'tools', 'ktx-software');
  if (!existsSync(base)) return null;
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const abs = path.join(dir, name);
      let info;
      try {
        info = statSync(abs);
      } catch {
        continue;
      }
      if (info.isDirectory()) stack.push(abs);
      else if (name.toLowerCase() === 'ktx.exe') return abs;
    }
  }
  return null;
}

function ktxEnv() {
  const env = { ...process.env };
  if (!ktxPath) return env;
  const dir = path.dirname(ktxPath);
  const key = Object.keys(env).find((name) => name.toLowerCase() === 'path') || 'PATH';
  env[key] = `${dir}${path.delimiter}${env[key] || ''}`;
  return env;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function fileSize(file) {
  return (await stat(file)).size;
}

async function dirSize(dir) {
  let total = 0;
  const names = await readdir(dir, { withFileTypes: true });
  for (const name of names) {
    const abs = path.join(dir, name.name);
    if (name.isDirectory()) total += await dirSize(abs);
    else total += (await stat(abs)).size;
  }
  return total;
}

async function walk(dir, test, rel = '') {
  if (!existsSync(dir)) return [];
  const found = [];
  const names = await readdir(dir, { withFileTypes: true });
  for (const name of names) {
    if (name.name.startsWith('.')) continue;
    const abs = path.join(dir, name.name);
    const next = rel ? `${rel}/${name.name}` : name.name;
    if (name.isDirectory()) found.push(...(await walk(abs, test, next)));
    else if (test(name.name)) found.push({ abs, rel: next });
  }
  return found;
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: ktxEnv(),
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gltf-transform ${args[0]} exited ${code}`));
    });
  });
}

async function transform(command, input, output, extra = []) {
  await mkdir(path.dirname(output), { recursive: true });
  await runCli([command, input, output, ...extra]);
}

function modelName(rel) {
  const parts = rel.split('/');
  if (parts.length > 1) return parts[0];
  return path.basename(parts[0], path.extname(parts[0])).replace(/_1k$/, '');
}

function noteLarge(label, bytes) {
  if (bytes > LIMIT) {
    console.warn(`credits: ${label} is ${formatBytes(bytes)}, over 25 MB. Leave it out of git.`);
  }
}

async function copyDecoders() {
  const three = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs');
  const dracoSrc = path.join(three, 'draco', 'gltf');
  const basisSrc = path.join(three, 'basis');
  const dracoOut = path.join(root, 'public', 'decoders', 'draco');
  const basisOut = path.join(root, 'public', 'decoders', 'basis');
  await mkdir(dracoOut, { recursive: true });
  await mkdir(basisOut, { recursive: true });
  for (const name of await readdir(dracoSrc)) {
    await copyFile(path.join(dracoSrc, name), path.join(dracoOut, name));
  }
  for (const name of await readdir(basisSrc)) {
    const info = await stat(path.join(basisSrc, name));
    if (info.isFile()) await copyFile(path.join(basisSrc, name), path.join(basisOut, name));
  }
  console.log('decoders  public/decoders/draco and public/decoders/basis');
}

async function compressTextures(input, output) {
  const uastc = output.replace(/\.glb$/, '.uastc.glb');
  await transform('uastc', input, uastc, ['--slots', 'normalTexture', '--resize', MAX_EDGE, '--jobs', '2']);
  await transform('etc1s', uastc, output, ['--resize', MAX_EDGE, '--jobs', '2']);
  await rm(uastc, { force: true });
}

async function optimizeModel(file, outDir = modelsOut) {
  const name = modelName(file.rel);
  const work = path.join(scratch, name);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const before = await dirSize(path.dirname(file.abs));
  const cleaned = path.join(work, 'cleaned.glb');
  const welded = path.join(work, 'welded.glb');
  const resized = path.join(work, 'resized.glb');
  const ktx = path.join(work, 'ktx.glb');

  await transform('dedup', file.abs, cleaned);
  await transform('prune', cleaned, path.join(work, 'pruned.glb'));
  await transform('weld', path.join(work, 'pruned.glb'), welded);
  await transform('resize', welded, resized, ['--width', MAX_EDGE, '--height', MAX_EDGE]);
  await compressTextures(resized, ktx);

  await mkdir(outDir, { recursive: true });
  const outputs = [
    { ratio: null, file: path.join(outDir, `${name}.glb`) },
    { ratio: '0.5', file: path.join(outDir, `${name}.lod1.glb`) },
    { ratio: '0.15', file: path.join(outDir, `${name}.lod2.glb`) },
  ];

  for (const output of outputs) {
    const source = output.ratio
      ? path.join(work, `simplified-${output.ratio}.glb`)
      : ktx;
    if (output.ratio) {
      await transform('simplify', ktx, source, ['--ratio', output.ratio, '--error', '1']);
    }
    await transform('meshopt', source, output.file);
  }

  const sizes = [];
  for (const output of outputs) {
    const bytes = await fileSize(output.file);
    sizes.push(bytes);
    noteLarge(path.relative(root, output.file), bytes);
  }
  console.log(
    [
      name,
      `  before ${formatBytes(before)}`,
      `  full   ${formatBytes(sizes[0])}`,
      `  lod1   ${formatBytes(sizes[1])}`,
      `  lod2   ${formatBytes(sizes[2])}`,
    ].join('\n'),
  );
  await rm(work, { recursive: true, force: true });
}

function isNormalMap(name) {
  return /(^|[^a-z])(nor|normal)([^a-z]|$)/i.test(name);
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return null;
}

async function wrapTexture(src, dest, normal) {
  const bytes = await readFile(src);
  const mime = mimeFor(src);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setType('VEC3')
    .setBuffer(buffer);
  const texture = doc.createTexture(path.basename(src)).setImage(new Uint8Array(bytes)).setMimeType(mime);
  const material = doc.createMaterial();
  if (normal) material.setNormalTexture(texture);
  else material.setBaseColorTexture(texture);
  const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material);
  const mesh = doc.createMesh().addPrimitive(prim);
  doc.createScene().addChild(doc.createNode().setMesh(mesh));
  await new NodeIO().write(dest, doc);
}

function extractFirstImage(glb) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('expected a GLB');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= glb.length) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const chunk = glb.subarray(start, start + length);
    if (type === 0x4e4f534a) json = JSON.parse(Buffer.from(chunk).toString('utf8'));
    if (type === 0x004e4942) bin = chunk;
    offset = start + length;
  }
  const image = json?.images?.[0];
  if (!image || image.bufferView == null || !bin) throw new Error('compressed texture is missing an image');
  const bufferView = json.bufferViews[image.bufferView];
  const byteOffset = bufferView.byteOffset || 0;
  return Buffer.from(bin.subarray(byteOffset, byteOffset + bufferView.byteLength));
}

async function optimizeTexture(file) {
  const mime = mimeFor(file.abs);
  if (!mime) {
    console.warn(`skip ${file.rel}: KTX2 input must be png or jpeg`);
    return;
  }
  const normal = isNormalMap(file.rel);
  const work = path.join(scratch, 'textures', file.rel.replace(/[\\/]/g, '__'));
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const wrapped = path.join(work, 'in.glb');
  const compressed = path.join(work, 'out.glb');
  await wrapTexture(file.abs, wrapped, normal);
  if (normal) await transform('uastc', wrapped, compressed, ['--slots', 'normalTexture', '--resize', MAX_EDGE, '--jobs', '2']);
  else await transform('etc1s', wrapped, compressed, ['--resize', MAX_EDGE, '--jobs', '2']);
  const ktx2 = extractFirstImage(await readFile(compressed));
  const destRel = file.rel.replace(/\.[^.]+$/, '.ktx2');
  const dest = path.join(texturesOut, destRel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, ktx2);
  const before = await fileSize(file.abs);
  noteLarge(path.relative(root, dest), ktx2.length);
  console.log(
    `${file.rel}  ${normal ? 'UASTC' : 'ETC1S'}  before ${formatBytes(before)}  after ${formatBytes(ktx2.length)}`,
  );
  await rm(work, { recursive: true, force: true });
}

async function copyHdri() {
  const files = await walk(hdriSrc, (name) => name.toLowerCase().endsWith('.hdr'));
  if (!files.length) return;
  await mkdir(hdriOut, { recursive: true });
  for (const file of files) {
    const dest = path.join(hdriOut, file.rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(file.abs, dest);
    const bytes = await fileSize(dest);
    const role = /_1k\.hdr$/i.test(file.rel) ? 'lighting' : /_2k\.hdr$/i.test(file.rel) ? 'backdrop' : 'hdr';
    noteLarge(path.relative(root, dest), bytes);
    console.log(`${file.rel}  ${role}  ${formatBytes(bytes)} (copied)`);
  }
}

function isDroppedGlb(name) {
  return /\.glb$/i.test(name) && !/\.lod\d+\.glb$/i.test(name);
}

async function optimizeCustomDrops(wanted) {
  const dir = path.join(modelsOut, 'custom');
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const name of await readdir(dir)) {
    if (!isDroppedGlb(name)) continue;
    const rel = name;
    if (!wanted(rel)) continue;
    const abs = path.join(dir, name);
    const info = await stat(abs);
    if (!info.isFile()) continue;
    await optimizeModel({ abs, rel }, dir);
    count += 1;
  }
  return count;
}

async function main() {
  if (!existsSync(cli)) {
    throw new Error('Install @gltf-transform/cli before running npm run assets.');
  }
  if (!ktxPath) {
    throw new Error(
      'Command "ktx" was not found. Install KTX-Software 4.4 or newer and put ktx on PATH,\n' +
        'or unpack it under tools/ktx-software.\n' +
        'https://github.com/KhronosGroup/KTX-Software/releases',
    );
  }
  console.log(`ktx  ${ktxPath}`);
  await copyDecoders();
  await mkdir(scratch, { recursive: true });

  const only = process.argv.slice(2);
  const wanted = (name) => !only.length || only.some((item) => name.includes(item));

  const models = (await walk(modelsSrc, (name) => /\.(gltf|glb)$/i.test(name))).filter((file) => wanted(file.rel));
  for (const model of models) await optimizeModel(model);
  const customCount = await optimizeCustomDrops(wanted);

  const textures = (await walk(texturesSrc, (name) => /\.(png|jpe?g)$/i.test(name))).filter((file) => wanted(file.rel));
  for (const texture of textures) await optimizeTexture(texture);

  if (!only.length || only.some((item) => item.includes('hdri') || item.endsWith('.hdr'))) await copyHdri();
  await rm(scratch, { recursive: true, force: true });
  if (!models.length && !customCount && !textures.length && !existsSync(hdriSrc)) {
    console.log('No files in assets-src/models, assets-src/textures, assets-src/hdri, or public/models/custom.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
