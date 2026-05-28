import { ReactNode } from "react";

type Props = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
};

export function Card({
  title,
  subtitle,
  children,
  className = "",
  headerClassName = "",
  bodyClassName = "",
}: Props) {
  const hasHeader = Boolean(title || subtitle);

  return (
    <section
      className={`rounded-xl border border-zinc-200/90 bg-white shadow-sm ${className}`.trim()}
    >
      {hasHeader && (
        <header
          className={`border-b border-zinc-100 px-5 py-4 ${headerClassName}`.trim()}
        >
          {title && (
            <h2 className="text-base font-semibold tracking-tight text-zinc-900">
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
          )}
        </header>
      )}
      <div className={`px-5 py-4 ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}
