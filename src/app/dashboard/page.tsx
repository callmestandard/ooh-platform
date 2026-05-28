"use client";

import { ROLE_STORAGE_KEY, type DemoRole } from "@/lib/constants";
import { getSession, getCurrentProfile } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    async function redirect() {
      // Try real Supabase session first
      const session = await getSession();
      if (session) {
        const profile = await getCurrentProfile();
        if (profile) {
          router.replace(`/dashboard/${profile.role}`);
          return;
        }
      }

      // Fallback: localStorage demo mode
      const raw = localStorage.getItem(ROLE_STORAGE_KEY) as DemoRole | null;
      if (raw === "agency" || raw === "client" || raw === "owner" || raw === "admin") {
        router.replace(`/dashboard/${raw}`);
        return;
      }

      router.replace("/");
    }

    redirect();
  }, [router]);

  return (
    <div style={{
      display: "flex", minHeight: "100vh",
      alignItems: "center", justifyContent: "center",
      background: "#F8FAFC",
    }}>
      <div style={{
        width: 28, height: 28,
        border: "2px solid #E2E8F0", borderTopColor: "#1B4F8A",
        borderRadius: "50%", animation: "spin 0.7s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
