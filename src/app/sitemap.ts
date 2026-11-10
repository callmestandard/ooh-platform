import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';
import { boardPath, citySlug } from '@/lib/public-links';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data } = await db
    .from('boards')
    .select('id, name, city, last_verified_at, created_at')
    .eq('status', 'available')
    .not('city', 'is', null);

  const rows = (data || []) as { id: string; name: string; city: string; last_verified_at: string | null; created_at: string | null }[];
  const cities = [...new Set(rows.map(r => r.city).filter(Boolean))];

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE,                       lastModified: new Date(), changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${BASE}/marketplace`,      lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${BASE}/billboards`,       lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${BASE}/formats`,          lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/glossary`,         lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/signup`,           lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/auth/login`,       lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
  ];

  const cityPages: MetadataRoute.Sitemap = cities.map(city => ({
    url:             `${BASE}/billboards/${citySlug(city)}`,
    lastModified:    new Date(),
    changeFrequency: 'daily' as const,
    priority:        0.85,
  }));

  const boardPages: MetadataRoute.Sitemap = rows.map(b => ({
    url:             `${BASE}${boardPath(b)}`,
    lastModified:    new Date(b.last_verified_at || b.created_at || Date.now()),
    changeFrequency: 'weekly' as const,
    priority:        0.7,
  }));

  return [...staticPages, ...cityPages, ...boardPages];
}
