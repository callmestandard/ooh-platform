"use client";

import type { DemoRole } from "@/lib/constants";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useDashboardRole } from "./DashboardLayout";

type Props = {
  role: DemoRole;
  children: ReactNode;
};

export function RoleGuard({ role: expected, children }: Props) {
  const role = useDashboardRole();
  const router = useRouter();

  useEffect(() => {
    if (!role) return;
    if (role !== expected) {
      router.replace(`/dashboard/${role}`);
    }
  }, [role, expected, router]);

  if (!role || role !== expected) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-48 animate-pulse rounded-md bg-zinc-200/90" />
      </div>
    );
  }

  return <>{children}</>;
}
