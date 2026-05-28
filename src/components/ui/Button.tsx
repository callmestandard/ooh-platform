import { ButtonHTMLAttributes, forwardRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[#1B4F8A] text-white shadow-sm hover:bg-[#164070] focus-visible:ring-[#1B4F8A]/40 disabled:bg-[#1B4F8A]/50",
  secondary:
    "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 hover:border-zinc-400 focus-visible:ring-zinc-400/30 disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400",
  danger:
    "bg-[#A32D2D] text-white shadow-sm hover:bg-[#862525] focus-visible:ring-[#A32D2D]/40 disabled:bg-[#A32D2D]/50",
  ghost:
    "bg-transparent text-zinc-900 hover:bg-zinc-100 focus-visible:ring-zinc-400/30 disabled:text-zinc-400 disabled:hover:bg-transparent",
};

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  (
    {
      className = "",
      variant = "primary",
      loading = false,
      disabled,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={`
          inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold
          transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
          disabled:pointer-events-none disabled:cursor-not-allowed
          ${variantClasses[variant]}
          ${className}
        `.trim()}
        {...rest}
      >
        {loading && (
          <Spinner
            className={`h-4 w-4 animate-spin ${
              variant === "secondary" || variant === "ghost"
                ? "text-zinc-600"
                : "text-white"
            }`}
          />
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
