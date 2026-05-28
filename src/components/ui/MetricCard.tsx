import type { CSSProperties, ReactNode } from "react";

export type MetricTrend = "up" | "down" | "neutral";

type Props = {
  label: string;
  value: string | number;
  /** e.g. "+12%" or "−3%" */
  change?: string;
  trend?: MetricTrend;
  /** Left border accent — any valid CSS color */
  accentColor?: string;
  footer?: ReactNode;
  className?: string;
};

function TrendIcon({ trend }: { trend: MetricTrend }) {
  if (trend === "neutral") return null;
  const up = trend === "up";
  return (
    <span
      className={up ? "text-[#0F6E56]" : "text-[#A32D2D]"}
      aria-hidden
    >
      {up ? (
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  change,
  trend = "neutral",
  accentColor,
  footer,
  className = "",
}: Props) {
  const accentStyle: CSSProperties | undefined = accentColor
    ? { borderLeftWidth: 4, borderLeftStyle: "solid", borderLeftColor: accentColor }
    : undefined;

  return (
    <div
      className={`rounded-xl border border-zinc-200/90 bg-white p-5 shadow-sm ${className}`.trim()}
      style={accentStyle}
    >
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-zinc-900">
        {value}
      </p>
      {change != null && change !== "" && (
        <div className="mt-2 flex items-center gap-1.5 text-sm font-medium">
          <TrendIcon trend={trend} />
          <span
            className={
              trend === "up"
                ? "text-[#0F6E56]"
                : trend === "down"
                  ? "text-[#A32D2D]"
                  : "text-zinc-600"
            }
          >
            {change}
          </span>
        </div>
      )}
      {footer && <div className="mt-3 text-xs text-zinc-500">{footer}</div>}
    </div>
  );
}
