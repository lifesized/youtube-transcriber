import * as React from "react";

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cx(
        "h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/35",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
        className
      )}
      {...props}
    />
  );
}

