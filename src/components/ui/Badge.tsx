import type { ReactNode } from "react";

export type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

type Props = {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
};

const variantClasses: Record<BadgeVariant, string> = {
  success:
    "bg-[#0F6E56]/10 text-[#0C5A46] ring-1 ring-inset ring-[#0F6E56]/25",
  warning:
    "bg-[#854F0B]/10 text-[#6B3F09] ring-1 ring-inset ring-[#854F0B]/25",
  danger:
    "bg-[#A32D2D]/10 text-[#862525] ring-1 ring-inset ring-[#A32D2D]/25",
  info: "bg-[#1B4F8A]/10 text-[#164070] ring-1 ring-inset ring-[#1B4F8A]/25",
  neutral:
    "bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-200/80",
};

export function Badge({
  children,
  variant = "neutral",
  className = "",
}: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${variantClasses[variant]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
