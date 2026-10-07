import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://aurahomes.fun')).toString().replace(/\/$/, '');
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap-index.xml\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
