export function organizationJson(origin: string | URL) {
  const base = origin.toString().replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Aura Homes',
    url: `${base}/`,
    description: 'Beautiful second-life rooms that bring people back to nature, one room at a time.',
    logo: `${base}/favicon.svg`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Edmonton',
      addressRegion: 'Alberta',
      addressCountry: 'CA',
    },
  };
}
