"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { DemoRole } from "@/lib/constants";
import NotificationBell from "./NotificationBell";

type NavItem = {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
};

function OOHLogo() {
  return (
    <svg width="120" height="28" viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="2" width="28" height="18" rx="2" fill="#1B4F8A"/>
      <rect x="3" y="5" width="22" height="12" rx="1.5" fill="#0F172A"/>
      <rect x="10" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="15.5" y="20" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="34" y="6" width="24" height="16" rx="2" fill="#1B4F8A"/>
      <rect x="37" y="9" width="18" height="10" rx="1.5" fill="#0F172A"/>
      <rect x="42" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="47.5" y="22" width="2.5" height="6" fill="#1B4F8A"/>
      <rect x="64" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="80" y="2" width="4" height="28" rx="2" fill="#1B4F8A"/>
      <rect x="64" y="13" width="20" height="4" rx="1" fill="#1B4F8A"/>
      <circle cx="88" cy="4" r="3" fill="#F59E0B"/>
      <text x="98" y="20" fontFamily="Georgia, serif" fontSize="18" fontWeight="700" fill="#F8FAFC" letterSpacing="-0.5">OOH</text>
      <text x="99" y="30" fontFamily="Arial, sans-serif" fontSize="6.5" fontWeight="400" fill="rgba(255,255,255,0.35)" letterSpacing="3">PLATFORM</text>
    </svg>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const agencyNav: NavItem[] = [
  { id: "dashboard",     label: "Dashboard",    path: "/dashboard/agency",                  icon: <Icon path="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" /> },
  { id: "marketplace",  label: "Find Boards",  path: "/dashboard/agency/marketplace",      icon: <Icon path="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /> },
  { id: "campaigns",    label: "Campaigns",    path: "/dashboard/agency/campaigns",        icon: <Icon path="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2 M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" /> },
  { id: "boards-map",   label: "Boards Map",   path: "/dashboard/agency/boards-map",       icon: <Icon path="M1 6l7-4 8 4 7-4v16l-7 4-8-4-7 4V6 M8 2v16 M16 6v16" /> },
  { id: "planner",     label: "Campaign Planner", path: "/dashboard/agency/campaign-planner", icon: <Icon path="M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /> },
  { id: "negotiations",label: "Negotiations", path: "/dashboard/agency/negotiations", icon: <Icon path="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /> },
  { id: "compliance",  label: "Compliance",   path: "/dashboard/agency/compliance",   icon: <Icon path="M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /> },
  { id: "availability", label: "Availability",  path: "/dashboard/agency/availability", icon: <Icon path="M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /> },
  { id: "creatives",   label: "Creatives",    path: "/dashboard/agency/creatives",    icon: <Icon path="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /> },
  { id: "audience",    label: "Audience",     path: "/dashboard/agency/audience",     icon: <Icon path="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" /> },
  { id: "invoices",    label: "Invoices",     path: "/dashboard/agency/invoices",     icon: <Icon path="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" /> },
  { id: "reports",          label: "Reports",          path: "/dashboard/agency/reports",           icon: <Icon path="M18 20V10 M12 20V4 M6 20v-6" /> },
  { id: "rate-intelligence", label: "Rate Intel",       path: "/dashboard/agency/rate-intelligence", icon: <Icon path="M22 12 18 12 15 21 9 3 6 12 2 12" /> },
  { id: "settings",         label: "Settings",         path: "/dashboard/settings",                 icon: <Icon path="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /> },
];

const clientNav: NavItem[] = [
  { id: "home",        label: "Home",         path: "/dashboard/client",                  icon: <Icon path="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" /> },
  { id: "plan",        label: "Proposals",    path: "/dashboard/client?tab=plan",         icon: <Icon path="M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /> },
  { id: "boards",      label: "Boards",       path: "/dashboard/client?tab=board-status", icon: <Icon path="M1 6l7-4 8 4 7-4v16l-7 4-8-4-7 4V6 M8 2v16 M16 6v16" /> },
  { id: "map",         label: "Map",          path: "/dashboard/client?tab=map",          icon: <Icon path="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /> },
  { id: "compliance",  label: "Compliance",   path: "/dashboard/client?tab=compliance",   icon: <Icon path="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" /> },
  { id: "performance", label: "Performance",  path: "/dashboard/client?tab=impressions",  icon: <Icon path="M18 20V10 M12 20V4 M6 20v-6" /> },
  { id: "billing",     label: "Billing",      path: "/dashboard/client?tab=billing",      icon: <Icon path="M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /> },
  { id: "settings",    label: "Settings",     path: "/dashboard/settings",                icon: <Icon path="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /> },
];

const ownerNav: NavItem[] = [
  { id: "my-boards",     label: "My Boards",     path: "/dashboard/owner",                     icon: <Icon path="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" /> },
  { id: "post-board",   label: "Post a Board",  path: "/dashboard/owner/post-board",          icon: <Icon path="M12 5v14 M5 12h14" /> },
  { id: "bookings",      label: "Bookings",       path: "/dashboard/owner?tab=bookings",        icon: <Icon path="M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01" /> },
  { id: "calendar",      label: "Calendar",       path: "/dashboard/owner?tab=calendar",        icon: <Icon path="M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /> },
  { id: "negotiations",  label: "Negotiations",   path: "/dashboard/owner/negotiations",        icon: <Icon path="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /> },
  { id: "earnings",      label: "Earnings",       path: "/dashboard/owner?tab=earnings",        icon: <Icon path="M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /> },
  { id: "analytics",     label: "Analytics",      path: "/dashboard/owner?tab=analytics",       icon: <Icon path="M18 20V10 M12 20V4 M6 20v-6" /> },
  { id: "rate-card",     label: "Rate Card",      path: "/dashboard/owner?tab=rate-card",       icon: <Icon path="M22 12 18 12 15 21 9 3 6 12 2 12" /> },
  { id: "invoices",      label: "Invoices",       path: "/dashboard/owner?tab=invoices",        icon: <Icon path="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" /> },
  { id: "settings",      label: "Settings",       path: "/dashboard/settings",                  icon: <Icon path="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /> },
];

const adminNav: NavItem[] = [
  { id: "overview",   label: "Overview",        path: "/dashboard/admin",                      icon: <Icon path="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" /> },
  { id: "inventory",  label: "Board Inventory",  path: "/dashboard/admin?tab=inventory",        icon: <Icon path="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" /> },
  { id: "bookings",   label: "All Bookings",     path: "/dashboard/admin?tab=bookings",         icon: <Icon path="M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01" /> },
  { id: "users",      label: "Users",            path: "/dashboard/admin?tab=users",            icon: <Icon path="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" /> },
  { id: "compliance", label: "Compliance Flags", path: "/dashboard/admin?tab=compliance",       icon: <Icon path="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01" /> },
  { id: "revenue",    label: "Revenue",          path: "/dashboard/admin?tab=revenue",          icon: <Icon path="M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /> },
  { id: "settings",   label: "Settings",         path: "/dashboard/settings",                   icon: <Icon path="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /> },
];

const navByRole: Record<DemoRole, NavItem[]> = {
  agency: agencyNav,
  client: clientNav,
  owner: ownerNav,
  admin: adminNav,
};

type Props = {
  role: DemoRole;
  userName: string;
  roleLabel: string;
  onLogout: () => void;
  isOpen?: boolean;
  onClose?: () => void;
};

export function Sidebar({ role, userName, roleLabel, onLogout, isOpen, onClose }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const items = navByRole[role];

  function isActive(item: NavItem) {
    const [itemPath, itemQuery] = item.path.split('?');
    const currentTab = searchParams.get('tab');

    // Tab-based item (has query string) — match both path and tab param
    if (itemQuery) {
      const params = new URLSearchParams(itemQuery);
      return pathname === itemPath && currentTab === params.get('tab');
    }

    // Role root item (e.g. /dashboard/owner) — active only when no tab is active
    if (itemPath === `/dashboard/${role}`) {
      return pathname === itemPath && !currentTab;
    }

    // Sub-page (e.g. /dashboard/agency/campaigns) — startsWith match
    return pathname.startsWith(itemPath);
  }

  const initials = (userName || '').split(" ").map(n => n[0] || '').join("").slice(0, 2).toUpperCase();

  return (
    <aside className={`ooh-sidebar${isOpen ? ' sidebar-open' : ''}`} style={{
      width: 240,
      background: "linear-gradient(180deg, #0A1628 0%, #0D1B2E 60%, #0A1628 100%)",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      flexShrink: 0,
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Ambient glow orb top-right */}
      <div style={{
        position: "absolute", top: -60, right: -60, width: 200, height: 200,
        background: "radial-gradient(circle, rgba(27,79,138,0.18) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      {/* Mobile close button */}
      <button
        className="sidebar-close-btn"
        onClick={onClose}
        aria-label="Close menu"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      {/* Logo */}
      <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <Link href={`/dashboard/${role}`} style={{ display: "inline-block" }}>
          <OOHLogo />
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
        {items.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.id}
              href={item.path}
              onClick={onClose}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "9px 10px 9px 12px",
                borderRadius: "9px",
                marginBottom: "2px",
                textDecoration: "none",
                background: active
                  ? "linear-gradient(90deg, rgba(27,79,138,0.55) 0%, rgba(27,79,138,0.28) 100%)"
                  : "transparent",
                borderLeft: active ? "2px solid #3B82F6" : "2px solid transparent",
                boxShadow: active ? "0 2px 12px rgba(27,79,138,0.25), inset 0 0 12px rgba(59,130,246,0.06)" : "none",
                transition: "all 0.18s ease",
                backdropFilter: active ? "blur(8px)" : "none",
              }}
              onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.borderLeft = "2px solid rgba(255,255,255,0.1)"; } }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.borderLeft = "2px solid transparent"; } }}
            >
              <span style={{ color: active ? "#60A5FA" : "rgba(255,255,255,0.38)", flexShrink: 0, display: "flex", filter: active ? "drop-shadow(0 0 6px rgba(96,165,250,0.6))" : "none", transition: "filter 0.2s" }}>
                {item.icon}
              </span>
              <span style={{
                fontSize: "0.8125rem",
                fontWeight: active ? 600 : 400,
                color: active ? "#F8FAFC" : "rgba(255,255,255,0.5)",
                flex: 1,
                letterSpacing: active ? "-0.01em" : "0",
              }}>
                {item.label}
              </span>
              {active && (
                <span className="pulse-glow" style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B", flexShrink: 0, boxShadow: "0 0 6px rgba(245,158,11,0.6)" }} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "0 16px" }} />

      {/* User + logout */}
      <div style={{ padding: "14px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "linear-gradient(135deg, #1B4F8A, #2563EB)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "11px", fontWeight: 700, color: "#fff",
            flexShrink: 0,
            boxShadow: "0 0 0 2px rgba(59,130,246,0.3), 0 0 12px rgba(27,79,138,0.4)",
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "rgba(255,255,255,0.85)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {userName}
            </p>
            <p style={{ fontSize: "0.6875rem", color: "rgba(255,255,255,0.35)", margin: 0 }}>
              {roleLabel}
            </p>
          </div>
          <NotificationBell role={role} />
          <button
            onClick={onLogout}
            title="Logout"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(255,255,255,0.3)", padding: "4px",
              borderRadius: "6px", display: "flex", alignItems: "center",
              transition: "color 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}