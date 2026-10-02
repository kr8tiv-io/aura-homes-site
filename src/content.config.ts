import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const journal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/journal' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    cover: z.string(),
    coverAlt: z.string(),
    excerpt: z.string(),
    tags: z.array(z.string()).default([]),
    // A note stays off the index, and out of the production build, until this is false.
    draft: z.boolean().default(true),
    // YouTube video id. An empty string reserves the film frame without embedding anything.
    youtube: z.string().optional(),
  }),
});

export const collections = { journal };
