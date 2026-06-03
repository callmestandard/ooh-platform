"use client";

import { supabase } from "@/lib/supabase";
import { getSession, getCurrentProfile, signOut } from "@/lib/auth";
import { ROLE_STORAGE_KEY, type DemoRole } from "@/lib/constants";
import { useRouter, usePathname } from "next/navigation";
import { Suspense, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";

const DashboardRoleContext = createContext<DemoRole | null>(null);
export function useDashboardRole() { return useContext(DashboardRoleContext); }

const roleLabelMap: Record<DemoRole, string> = {
  agency: "Agency",
  client: "Client",
  owner:  "Board Owner",
  admin:  "Platform Admin",
};

// Fallback display names used when the profiles table has no name set
const demoNames: Record<DemoRole, string> = {
  agency: "Alex Okonkwo",
  client: "MTN Nigeria",
  owner:  "Alhaji Sule",
  admin:  "Tunde Adeyemi",
};

function SidebarFallback() {
  return <div style={{ width: 240, background: "#0F172A", flexShrink: 0 }} />;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [role, setRole]           = useState<DemoRole | null>(null);
  const [userName, setUserName]   = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [mounted, setMounted]     = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setMounted(true);

      // ── 1. Try real Supabase session ───────────────────────────────────────
      const session = await getSession();

      if (session) {
        const profile = await getCurrentProfile();
        if (!cancelled && profile) {
          setRole(profile.role);
          setUserName(profile.full_name || profile.email);
          setRoleLabel(roleLabelMap[profile.role]);
          return;
        }
        // Session exists but no profile row yet — fall through to localStorage fallback
        // so the app still works during setup (don't sign the user out aggressively)
      }

      // ── 2. Fallback: localStorage demo mode ────────────────────────────────
      const raw = localStorage.getItem(ROLE_STORAGE_KEY);
      if (raw === "agency" || raw === "client" || raw === "owner" || raw === "admin") {
        if (!cancelled) {
          setRole(raw);
          setUserName(demoNames[raw]);
          setRoleLabel(roleLabelMap[raw]);
        }
        return;
      }

      // ── 3. No auth at all → back to login ─────────────────────────────────
      if (!cancelled) router.replace("/auth/login");
    }

    init();

    // Listen for sign-out events from any tab / Supabase token refresh failure
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        localStorage.removeItem(ROLE_STORAGE_KEY);
        router.replace("/");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handleLogout() {
    await signOut();
    localStorage.removeItem(ROLE_STORAGE_KEY);
    router.push("/");
  }

  if (!mounted || !role) {
    return (
      <div style={{ display: "flex", height: "100vh", background: "#F8FAFC" }}>
        <div style={{ width: 240, background: "#0F172A" }} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            width: 28, height: 28,
            border: "2px solid #E2E8F0", borderTopColor: "#1B4F8A",
            borderRadius: "50%", animation: "spin 0.7s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <DashboardRoleContext.Provider value={role}>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {/* Backdrop — click to close sidebar on mobile */}
        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

        <Suspense fallback={<SidebarFallback />}>
          <Sidebar
            role={role}
            userName={userName}
            roleLabel={roleLabel}
            onLogout={handleLogout}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
        </Suspense>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* Mobile top bar */}
          <div className="mobile-header">
            <button
              className="hamburger-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <span className="mobile-header-title">OOH Platform</span>
          </div>

          <main className="ooh-main" style={{ flex: 1, overflowY: "auto", background: "#F8FAFC", padding: "28px 32px" }}>
            {children}
          </main>
          <OnboardingWizard role={role} userName={userName} />
        </div>
      </div>
    </DashboardRoleContext.Provider>
  );
}

export { DashboardLayout };
