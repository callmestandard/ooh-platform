import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, unauthorized } from '@/lib/require-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { loadQuotation, isAdmin } from '@/lib/quotation-server';
import { quotationPdf } from '@/lib/quotation-pdf';

export const runtime = 'nodejs';

// Quotation PDF (061). Admins may download any quotation; a buyer only their
// own, and never a draft. The file holds buyer-facing amounts only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuth(req);
  if (!user) return unauthorized();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const q = await loadQuotation(db, id);
  const admin = q ? await isAdmin(db, user) : false;
  if (!q || (!admin && (q.agencyId !== user.id || q.status === 'draft'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const pdf = await quotationPdf(q.pdf);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${q.ref}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
