export type TrustBadge = 'Verified Owner' | 'Authorized Agent (Owner Verified)' | 'Authorized Agent (Owner Unverified)';

export type ListingLike = {
  agent_id: string | null;
};

export type AuthorizationLike = {
  owner_verified: boolean;
  status?: string;
};

/**
 * The trust badge is never optional or hideable by the agent — it's
 * derived purely from board_authorizations.owner_verified (which only the
 * named owner or an admin can ever set true) and whether the listing has
 * an agent at all. A direct-owner listing (agent_id null) is always
 * "Verified Owner" since only the board's own owner_id can create one.
 */
export function computeTrustBadge(listing: ListingLike, authorization: AuthorizationLike | null): TrustBadge {
  if (!listing.agent_id) return 'Verified Owner';
  return authorization?.owner_verified ? 'Authorized Agent (Owner Verified)' : 'Authorized Agent (Owner Unverified)';
}

export const TRUST_BADGE_STYLE: Record<TrustBadge, { bg: string; color: string; icon: string }> = {
  'Verified Owner':                        { bg: '#ECFDF5', color: '#065F46', icon: '✓' },
  'Authorized Agent (Owner Verified)':      { bg: '#EFF6FF', color: '#1D4ED8', icon: '✓' },
  'Authorized Agent (Owner Unverified)':    { bg: '#FFFBEB', color: '#92400E', icon: '⚠' },
};

export function TrustBadgePill({ badge, small }: { badge: TrustBadge; small?: boolean }) {
  const s = TRUST_BADGE_STYLE[badge];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: small ? '0.625rem' : '0.6875rem', fontWeight: 700,
      color: s.color, background: s.bg,
      padding: small ? '2px 7px' : '3px 9px', borderRadius: 999,
      whiteSpace: 'nowrap',
    }}>
      <span>{s.icon}</span>{badge}
    </span>
  );
}
