/**
 * Board verification (migration 042) and honest display of board details.
 * The database decides the status; these helpers only show it. Never show a
 * board as verified unless verification_status says so.
 */

export type VerificationStatus = 'pending' | 'verified' | 'partner_verified';

export const UNKNOWN = 'Information unavailable';

export const VERIFICATION_META: Record<VerificationStatus, { label: string; short: string; help: string; bg: string; color: string; icon: string }> = {
  partner_verified: {
    label: 'Partner verified', short: 'Partner verified',
    help: 'The media owner manages this listing on the platform.',
    bg: '#ECFDF5', color: '#065F46', icon: '✓',
  },
  verified: {
    label: 'Verified', short: 'Verified',
    help: 'The media owner has confirmed this listing with our team.',
    bg: '#EFF6FF', color: '#1D4ED8', icon: '✓',
  },
  pending: {
    label: 'Pending verification', short: 'Pending',
    help: 'Sourced from the media owner’s materials. Not yet confirmed by the owner.',
    bg: '#F8FAFC', color: '#64748B', icon: '○',
  },
};

export function verificationOf(board: { verification_status?: string | null }): VerificationStatus {
  const s = board.verification_status;
  return s === 'verified' || s === 'partner_verified' ? s : 'pending';
}

export function VerificationBadge({ status, small }: { status: string | null | undefined; small?: boolean }) {
  const m = VERIFICATION_META[verificationOf({ verification_status: status })];
  return (
    <span
      title={m.help}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: m.bg, color: m.color, border: `1px solid ${m.color}22`,
        borderRadius: 99, padding: small ? '2px 8px' : '3px 10px',
        fontSize: small ? '0.6875rem' : '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden>{m.icon}</span>{m.label}
    </span>
  );
}

export function formatVerifiedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dimensionsText(width: number | null | undefined, height: number | null | undefined): string {
  return width && height ? `${width}m × ${height}m` : UNKNOWN;
}

export function illuminationText(illuminated: boolean | null | undefined): string {
  if (illuminated === true) return 'Illuminated';
  if (illuminated === false) return 'Not illuminated';
  return UNKNOWN;
}

/** "Area, City, State" with blanks skipped; the street address goes first when known. */
export function locationText(b: { address?: string | null; area?: string | null; city?: string | null; state?: string | null }): string {
  const parts = [b.address, b.area, b.city, b.state].map(p => (p ?? '').trim()).filter(Boolean);
  // Avoid "Lagos, Lagos" when the city and state share a name.
  const deduped = parts.filter((p, i) => parts.findIndex(q => q.toLowerCase() === p.toLowerCase()) === i);
  return deduped.length ? deduped.join(', ') : UNKNOWN;
}
