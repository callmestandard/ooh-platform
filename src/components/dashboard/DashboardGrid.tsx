import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  columns?: "2" | "3" | "4";
};

const cols: Record<NonNullable<Props["columns"]>, string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 lg:grid-cols-3",
  "4": "sm:grid-cols-2 lg:grid-cols-4",
};

/** Responsive grid for KPI rows, chart slots, or table headers. */
export function DashboardGrid({
  children,
  className = "",
  columns = "4",
}: Props) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 ${cols[columns]} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
