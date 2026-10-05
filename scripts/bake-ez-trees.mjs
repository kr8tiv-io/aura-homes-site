/**
 * Bake six EZ-Tree variants (pine, spruce, aspen) to GLB.
 * Run: node scripts/bake-ez-trees.mjs
 * Then: node scripts/optimize-3d.mjs meadow-pine meadow-spruce meadow-aspen
 *
 * EZ-Tree is MIT, Daniel Greenheck, https://github.com/dgreenheck/ez-tree
 */
import './ez-dom-stub.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Tree } from '@dgreenheck/ez-tree';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets-src', 'models');

const VARIANTS = [
  { name: 'meadow-pine-a', preset: 'Pine Medium', seed: 11, spruce: false },
  { name: 'meadow-pine-b', preset: 'Pine Small', seed: 29, spruce: false },
  { name: 'meadow-spruce-a', preset: 'Pine Medium', seed: 47, spruce: true },
  { name: 'meadow-spruce-b', preset: 'Pine Small', seed: 83, spruce: true },
  { name: 'meadow-aspen-a', preset: 'Aspen Medium', seed: 101, spruce: false },
  { name: 'meadow-aspen-b', preset: 'Aspen Small', seed: 157, spruce: false },
];

function paint(mesh, color) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.86,
    metalness: 0,
    vertexColors: false,
  });
  mesh.material = material;
  return material;
}

function buildTree(spec) {
  const tree = new Tree();
  tree.loadPreset(spec.preset);
  tree.options.seed = spec.seed;
  tree.options.bark.textured = false;
  tree.options.bark.flatShading = true;
  tree.options.trellis.enabled = false;
  tree.options.trellis.visible = false;
  if (spec.spruce) {
    tree.options.branch.angle[1] = 16;
    tree.options.branch.angle[2] = 20;
    tree.options.branch.angle[3] = 24;
    tree.options.branch.children[0] = Math.max(4, (tree.options.branch.children[0] ?? 6) - 1);
    tree.options.leaves.tint = 0.35;
    tree.options.bark.tint = 0.25;
  }
  tree.generate();
  const bark = tree.branchesMesh;
  const leaves = tree.leavesMesh;
  if (!bark || !leaves) throw new Error(`${spec.name} did not generate meshes`);
  paint(bark, spec.spruce ? '#3e4a38' : spec.name.includes('aspen') ? '#6a533c' : '#5a4030');
  paint(leaves, spec.spruce ? '#1e3a28' : spec.name.includes('aspen') ? '#7d9a45' : '#2f5a38');
  bark.castShadow = true;
  leaves.castShadow = true;
  bark.name = 'bark';
  leaves.name = 'leaves';
  const group = new THREE.Group();
  group.name = spec.name;
  group.add(bark, leaves);
  return group;
}

const exporter = new GLTFExporter();
await mkdir(outDir, { recursive: true });

for (const spec of VARIANTS) {
  const group = buildTree(spec);
  const bin = await exporter.parseAsync(group, { binary: true, onlyVisible: true });
  const dest = path.join(outDir, spec.name, `${spec.name}.glb`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(bin));
  console.log(`${spec.name}  ${(bin.byteLength / 1024).toFixed(0)} KB`);
}
