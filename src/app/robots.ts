import type { MetadataRoute } from 'next';

const BASE = (process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app').replace(/\/$/, '');

// Private pages (accounts, admin, private links for owners and clients) stay out of search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard/', '/api/', '/o/', '/p/', '/s/', '/t/', '/invoice/', '/report/', '/poe/', '/shortlist', '/reset-password', '/forgot-password'],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
