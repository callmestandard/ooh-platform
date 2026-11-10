import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import { boardIdFromParam, boardPath } from '@/lib/public-links';
import { displayName } from '@/lib/display-name';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ooh-platform-xi.vercel.app';

const FORMAT_LABELS: Record<string, string> = {
  billboard: 'Billboard', unipole: 'Unipole', gantry: 'Gantry', bridge_panel: 'Bridge panel',
  wall_drape: 'Wall drape', digital: 'LED / digital screen', led: 'LED screen',
};

// The board page itself loads in the browser; this gives search engines and
// link previews (WhatsApp, X, LinkedIn) the board's own title, text and photo.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = boardIdFromParam((await params).id);
  if (!id) return { title: 'Board not found' };

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: b } = await db.from('boards')
    .select('id, name, city, state, area, address, format, photo_urls')
    .eq('id', id).maybeSingle();
  if (!b) return { title: 'Board not found', robots: { index: false } };

  const format = FORMAT_LABELS[b.format] ?? 'Billboard';
  const place = [b.area, b.city, b.state && b.state !== b.city ? b.state : null].filter(Boolean).join(', ');
  const nice = displayName(b.name);
  const title = `${nice}${b.city && !nice.toLowerCase().includes(b.city.toLowerCase()) ? `, ${b.city}` : ''}`;
  const description = `${format} for advertising${place ? ` in ${place}` : ''}${b.address ? ` (${b.address})` : ''}. See photos and the location, then request a price and availability from the media owner.`;
  const url = `${BASE_URL}${boardPath(b)}`;
  const photo = (b.photo_urls as string[] | null)?.find(Boolean);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website', siteName: 'OOH Platform', ...(photo ? { images: [{ url: photo }] } : {}) },
    twitter: { card: photo ? 'summary_large_image' : 'summary', title, description, ...(photo ? { images: [photo] } : {}) },
  };
}

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
