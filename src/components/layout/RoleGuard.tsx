"use client";

import type { DemoRole } from "@/lib/constants";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useDashboardRole } from "./DashboardLayout";

type Props = {
  /** One role, or several that may all open the page. */
  role: DemoRole | DemoRole[];
  children: ReactNode;
};

export function RoleGuard({ role: expected, children }: Props) {
  const role = useDashboardRole();
  const router = useRouter();
  const ok = !!role && (Array.isArray(expected) ? expected.includes(role) : role === expected);

  useEffect(() => {
    if (!role) return;
    if (!ok) {
      router.replace(`/dashboard/${role}`);
    }
  }, [role, ok, router]);

  if (!ok) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-48 animate-pulse rounded-md bg-zinc-200/90" />
      </div>
    );
  }

  return <>{children}</>;
}
