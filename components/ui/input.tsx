import * as React from "react";

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cx(
        "h-10 w-full rounded-full border border-white/10 bg-black/30 px-4 text-sm text-white placeholder:text-white/35",
        "hover:border-white/30 transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-white/10",
        "aria-[invalid=true]:border-red-400/60 aria-[invalid=true]:focus-visible:ring-red-400/30",
        className
      )}
      {...props}
    />
  );
}

