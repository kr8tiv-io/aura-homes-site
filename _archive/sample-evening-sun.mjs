import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const file = new URL('../public/hdri/evening_meadow_1k.hdr', import.meta.url);
const buf = readFileSync(file);
const tex = new HDRLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const { data, width, height, type } = tex;
let best = 0;
let bu = 0;
let bv = 0;
for (let y = 0; y < height; y += 2) {
  for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 4;
    const r = type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i];
    const g = type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(data[i + 1]) : data[i + 1];
    const b = type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(data[i + 2]) : data[i + 2];
    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (lum > best) {
      best = lum;
      bu = x / width;
      bv = y / height;
    }
  }
}
const phi = (bu - 0.5) * Math.PI * 2;
const elev = (bv - 0.5) * Math.PI;
const dirY = Math.sin(elev);
const hyp = Math.cos(elev);
console.log(
  JSON.stringify(
    {
      bu,
      bv,
      best,
      dir: [Math.cos(phi) * hyp, dirY, Math.sin(phi) * hyp],
      width,
      height,
    },
    null,
    2,
  ),
);
