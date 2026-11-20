import { supabase } from '@/lib/supabase';

// A booking's progress after the buyer accepts a quotation:
// booked → artwork received → installed → proof approved → ended.
// Every step comes from a real record (booking status, an artwork file, an
// install photo, our team's approval); nothing is estimated.

export type ArtworkFile = {
  id: string; file_name: string; path: string | null; url: string | null; mime_type: string | null; file_size: number | null;
  status: 'uploaded' | 'approved' | 'changes_requested' | 'printing' | 'live'; review_note: string | null; created_at: string;
};
export type ProofPhoto = {
  id: string; status: 'submitted' | 'verified' | 'flagged'; submitted_at: string; reviewed_at: string | null;
  path: string | null; url: string | null;
  // our team only
  distance_m?: number | null; submitted_by?: string | null; notes?: string | null; review_note?: string | null; source?: string | null;
};
export type CampaignBooking = {
  id: string; status: string; start_date: string | null; end_date: string | null; quotation_id: string | null; confirmed: boolean;
  campaign: { id: string | null; name: string | null; client_name: string | null };
  board: { id: string; name: string; area: string | null; city: string | null; photo: string | null };
  artwork: ArtworkFile[]; proofs: ProofPhoto[];
  // our team only
  has_install_link?: boolean; quotation_ref?: string | null; pinned?: boolean; board_phone?: string | null;
  owner?: { id: string; name: string; phone: string | null } | null;
};

export type StageKey = 'booked' | 'artwork' | 'installed' | 'proof' | 'ended';
export type Stage = { key: StageKey; label: string; done: boolean; note: string; tone: 'done' | 'now' | 'warn' | 'todo' };

const lagosToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

export function stagesOf(b: CampaignBooking, today = lagosToday()): Stage[] {
  const art = b.artwork;
  const latestArt = art[0];
  const artOk = art.some(a => a.status === 'approved' || a.status === 'printing' || a.status === 'live');
  const proofOk = b.proofs.some(p => p.status === 'verified');
  const proofWaiting = b.proofs.some(p => p.status === 'submitted');
  const retake = !proofOk && !proofWaiting && b.proofs.some(p => p.status === 'flagged');
  const ended = b.status === 'completed' || (!!b.end_date && b.end_date < today);

  const s: Stage[] = [
    { key: 'booked', label: 'Booked', done: b.confirmed, tone: b.confirmed ? 'done' : 'now',
      note: b.confirmed ? 'Confirmed with the media owner' : 'Our team is confirming with the media owner' },
    { key: 'artwork', label: 'Artwork received', done: art.length > 0 && latestArt?.status !== 'changes_requested',
      tone: artOk ? 'done' : latestArt?.status === 'changes_requested' ? 'warn' : art.length ? 'now' : 'todo',
      note: artOk ? 'Artwork approved' : latestArt?.status === 'changes_requested' ? 'Changes needed' : art.length ? 'Received, being checked' : 'Not sent yet' },
    { key: 'installed', label: 'Installed', done: proofOk || proofWaiting, tone: proofOk ? 'done' : proofWaiting ? 'now' : retake ? 'warn' : 'todo',
      note: proofOk ? 'Install photo approved' : proofWaiting ? 'Install photo being checked' : retake ? 'A new photo was requested' : 'No install photo yet' },
    { key: 'proof', label: 'Proof approved', done: proofOk, tone: proofOk ? 'done' : 'todo',
      note: proofOk ? 'Checked by our team' : 'Shown here once we have checked a photo' },
    { key: 'ended', label: 'Ended', done: ended, tone: ended ? 'done' : 'todo',
      note: b.end_date ? (ended ? 'Ended ' : 'Ends ') + fmtDay(b.end_date) : 'End date to confirm' },
  ];
  return s;
}

/** The one-line status for a booking. */
export function headline(b: CampaignBooking, today = lagosToday()): { text: string; tone: Stage['tone'] } {
  const st = stagesOf(b, today);
  if (st[4].done) return { text: 'Ended', tone: 'done' };
  if (st[3].done) return { text: 'Live: proof approved', tone: 'done' };
  // Something needing attention first, then the furthest step under way, then the next step to do.
  const now = st.find(s => s.tone === 'warn') ?? [...st].reverse().find(s => s.tone === 'now') ?? st.find(s => !s.done);
  return now ? { text: now.note, tone: now.tone === 'todo' ? 'now' : now.tone } : { text: 'In progress', tone: 'now' };
}

export const fmtDay = (d: string | null) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// ── Private files ─────────────────────────────────────────────────────────
export type BookingBucket = 'creatives' | 'compliance-photos';

/** Short-lived links for files you are allowed to open (others are left out). */
export async function signedLinks(bucket: BookingBucket, paths: (string | null | undefined)[], seconds = 900): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  if (!list.length) return {};
  const { data } = await supabase.storage.from(bucket).createSignedUrls(list, seconds);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) out[r.path] = r.signedUrl;
  return out;
}

/** Opens a booking file: a stored path (private bucket) or an old full link. */
export async function openBookingFile(bucket: BookingBucket, pathOrUrl: string | null | undefined) {
  if (!pathOrUrl) return;
  const win = window.open('', '_blank');
  let url: string | null = /^https?:/.test(pathOrUrl) ? pathOrUrl : null;
  if (!url) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(pathOrUrl, 300);
    url = data?.signedUrl ?? null;
  }
  if (win) { if (url) win.location.href = url; else win.close(); }
}

const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'file';

export const ARTWORK_ACCEPT = '.jpg,.jpeg,.png,.webp,.tif,.tiff,.pdf,.zip,.mp4,.ai,.eps,.psd';
export const ARTWORK_MAX = 50 * 1024 * 1024;

/** Buyer (or our team) sends artwork for a confirmed booking. */
export async function uploadArtwork(bookingId: string, file: File): Promise<string | null> {
  if (file.size > ARTWORK_MAX) return 'That file is over 50 MB. Send a smaller file, or a link to it by email.';
  const path = `${bookingId}/${Date.now()}-${safeName(file.name)}`;
  const up = await supabase.storage.from('creatives').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) return /mime|type/i.test(up.error.message) ? 'That file type is not accepted. Send JPG, PNG, PDF, TIFF, AI, EPS, PSD, ZIP or MP4.' : 'Upload failed. Try again.';
  const { error } = await supabase.from('creative_uploads').insert({
    booking_id: bookingId, file_url: path, file_path: path, file_name: file.name.slice(0, 200),
    file_size: file.size, mime_type: file.type || null, status: 'uploaded', uploaded_by: 'agency',
  });
  return error ? 'The file uploaded but could not be saved to the booking. Try again or tell our team.' : null;
}

/** Our team adds an install photo received another way (e.g. WhatsApp). It still needs approving. */
export async function uploadProofAsTeam(bookingId: string, file: File, note: string): Promise<string | null> {
  if (!file.type.startsWith('image/')) return 'Choose a photo.';
  const path = `poe/${bookingId}/${Date.now()}-${safeName(file.name)}`;
  const up = await supabase.storage.from('compliance-photos').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return 'Upload failed: ' + up.error.message;
  const { error } = await supabase.rpc('admin_record_proof', { p_booking_id: bookingId, p_path: path, p_note: note || null });
  return error ? error.message : null;
}
