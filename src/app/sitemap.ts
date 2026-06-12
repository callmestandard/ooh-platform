import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app';

function toSlug(city: string) {
  return city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data } = await db
    .from('boards')
    .select('city')
    .eq('status', 'available')
    .not('city', 'is', null);

  const cities = [...new Set((data || []).map((r: { city: string }) => r.city).filter(Boolean))];

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE,                       lastModified: new Date(), changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${BASE}/marketplace`,      lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${BASE}/billboards`,       lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${BASE}/campaign-builder`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/signup`,           lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/auth/login`,       lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
  ];

  const cityPages: MetadataRoute.Sitemap = cities.map(city => ({
    url:             `${BASE}/billboards/${toSlug(city)}`,
    lastModified:    new Date(),
    changeFrequency: 'daily' as const,
    priority:        0.85,
  }));

  return [...staticPages, ...cityPages];
}
