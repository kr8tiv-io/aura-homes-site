// @ts-check
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, fontProviders } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { customModelManifest } from './scripts/custom-model-manifest.mjs';

// SITE still overrides. A plain build uses the live origin.
const site = process.env.SITE ?? 'https://aurahomes.fun';

/** Studio route and the empty public archive stay out of the Pages upload. */
function omitDevUpload() {
  return {
    name: 'omit-dev-upload',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const root = fileURLToPath(dir);
        const roots = [root, path.join(root, 'client')];
        await Promise.all(
          roots.flatMap((folder) => [
            rm(path.join(folder, 'dev'), { recursive: true, force: true }),
            rm(path.join(folder, '_archive'), { recursive: true, force: true }),
          ]),
        );
      },
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site,
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    sitemap({
      filter: (page) => !/\/(?:builder|api|dev)(?:\/|$)/.test(new URL(page).pathname),
    }),
    omitDevUpload(),
  ],
  fonts: [
    {
      // Wordmark only. The file is a latin subset of AURA, weight axis kept.
      provider: fontProviders.local(),
      name: 'Cinzel',
      cssVariable: '--font-cinzel',
      weights: ['400 900'],
      styles: ['normal'],
      fallbacks: ['serif'],
      display: 'swap',
      options: {
        variants: [
          {
            weight: '400 900',
            style: 'normal',
            display: 'swap',
            src: ['./src/assets/fonts/cinzel-wordmark.woff2'],
          },
        ],
      },
    },
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-inter',
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['sans-serif'],
      display: 'swap',
    },
    {
      // Latin subset, opsz + wght. SOFT is already 0 in the outlines.
      // The rvrn lookup is dropped so WONK stays off (no alternate glyphs).
      provider: fontProviders.local(),
      name: 'Fraunces',
      cssVariable: '--font-display',
      weights: ['100 900'],
      styles: ['normal', 'italic'],
      fallbacks: ['serif'],
      display: 'swap',
      options: {
        variants: [
          {
            weight: '100 900',
            style: 'normal',
            display: 'swap',
            src: ['./src/assets/fonts/fraunces-latin-opsz-wght-normal.woff2'],
          },
          {
            weight: '100 900',
            style: 'italic',
            display: 'swap',
            src: ['./src/assets/fonts/fraunces-latin-opsz-wght-italic.woff2'],
          },
        ],
      },
    },
    {
      provider: fontProviders.google(),
      name: 'IBM Plex Mono',
      cssVariable: '--font-spec',
      weights: ['400', '500'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['monospace'],
      display: 'swap',
    },
  ],
  vite: {
    plugins: [tailwindcss(), customModelManifest()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
});
