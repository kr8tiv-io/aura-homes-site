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
      provider: fontProviders.google(),
      name: 'Cinzel',
      cssVariable: '--font-cinzel',
      weights: ['400 900'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['serif'],
      display: 'swap',
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
