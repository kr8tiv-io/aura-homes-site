// Render the social card. Usage: node render.mjs <outDir>   (needs `playwright` + `sharp` resolvable)
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(process.env.AURA_TOOLS ? path.join(process.env.AURA_TOOLS, 'x.js') : import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? here);
const jobs = [
  ['a', '', 1200, 630, 'card-a'],
  ['b', '?v=b', 1200, 630, 'card-b'],
  ['sq', '?sq=1', 1200, 1200, 'card-square'],
];
const browser = await chromium.launch();
for (const [, qs, w, h, name] of jobs) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, 'index.html')).href + qs);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const raw = await page.screenshot({ type: 'png' });
  await sharp(raw).png({ palette: false, compressionLevel: 9 }).toFile(path.join(out, name + '.png'));
  await page.close();
}
await browser.close();
