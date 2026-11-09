// MVP launch mode: the platform runs as a curated marketplace (discover →
// request → quote → agree), and our team completes bookings by hand. Advanced
// tools (MPOs, contracts, invoices, call logging, direct owner contact,
// campaign planning…) stay in the code but are hidden. Set
// NEXT_PUBLIC_MVP_MODE=false to show them.
export const MVP_MODE = process.env.NEXT_PUBLIC_MVP_MODE !== 'false';

export const MVP_HANDOFF_TEXT = 'Request accepted. Our team will contact you to complete the booking.';

type RoleRules = {
  /** Where the role lands; hidden pages send people here. */
  home: string;
  /** Dashboard paths the role may open (exact match, or a prefix ending in "/"). */
  allow: string[];
  /** ?tab= values allowed on the role's root dashboard page (others are dropped). */
  tabs?: string[];
};

// Roles not listed (client, agent, marketer) are not offered at signup in
// MVP mode; existing accounts keep their full dashboards.
const RULES: Record<string, RoleRules> = {
  agency: {
    home: '/dashboard/agency/requests',
    allow: ['/dashboard/agency/requests', '/dashboard/agency/negotiations', '/dashboard/agency/negotiations/'],
  },
  owner: {
    home: '/dashboard/owner',
    allow: [
      '/dashboard/owner', '/dashboard/owner/post-board', '/dashboard/owner/import-boards',
      '/dashboard/owner/availability-requests', '/dashboard/owner/negotiations', '/dashboard/owner/negotiations/',
      '/dashboard/owner/claim-boards',
    ],
    tabs: ['boards'],
  },
  admin: {
    home: '/dashboard/admin/requests',
    allow: ['/dashboard/admin', '/dashboard/admin/requests', '/dashboard/admin/claims', '/dashboard/admin/import-boards'],
    tabs: ['overview', 'inventory', 'users'],
  },
};

/** Tabs a role's root page should show in MVP mode (undefined = all). */
export function mvpTabs(role: string): string[] | undefined {
  return MVP_MODE ? RULES[role]?.tabs : undefined;
}

/**
 * Where to send a user who opens a page hidden in MVP mode, or null if the
 * page is fine. Shared pages (/dashboard/settings) are always allowed.
 */
export function mvpRedirect(role: string, pathname: string, tab: string | null): string | null {
  const rules = MVP_MODE ? RULES[role] : undefined;
  if (!rules) return null;
  // Another role's dashboard (e.g. an owner opening /dashboard/admin/…).
  const area = pathname.split('/')[2];
  if (area && area !== role && area !== 'settings' && pathname.startsWith('/dashboard/')) return rules.home;
  if (!pathname.startsWith(`/dashboard/${role}`)) return null;
  // The buyer's old in-dashboard marketplace makes offers outside the request flow.
  if (role === 'agency' && pathname.startsWith('/dashboard/agency/marketplace')) return '/marketplace';
  if (pathname === `/dashboard/${role}`) {
    if (!rules.allow.includes(pathname)) return rules.home;
    if (tab && rules.tabs && !rules.tabs.includes(tab)) return pathname;
    return null;
  }
  const ok = rules.allow.some(p => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
  return ok ? null : rules.home;
}

/** Where a role lands after signing in. */
export function roleHome(role: string): string {
  return (MVP_MODE && RULES[role]?.home) || `/dashboard/${role}`;
}
