// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig, fontProviders } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { customModelManifest } from './scripts/custom-model-manifest.mjs';

// Override with SITE when a public domain exists. This build is not deployed.
const site = process.env.SITE ?? 'https://aurahomes.local';

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
