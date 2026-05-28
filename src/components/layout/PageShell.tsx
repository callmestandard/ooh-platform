import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

/** Full-viewport wrapper for authenticated or marketing pages. */
export function PageShell({ children, className = "" }: Props) {
  return (
    <div className={`min-h-screen bg-zinc-50 ${className}`.trim()}>
      {children}
    </div>
  );
}
