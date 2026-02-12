import * as React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md";

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-white/15 text-white border border-white/20 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.3)] " +
    "hover:bg-white/20 active:bg-white/15",
  secondary:
    "border border-white/10 bg-white/5 text-white/90 hover:bg-white/10 active:bg-white/10",
  ghost: "bg-transparent text-white/80 hover:bg-white/5 active:bg-white/10",
  destructive:
    "bg-red-500/80 text-white border border-red-500/30 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.3)] hover:bg-red-500/90 active:bg-red-500/80",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  className,
  variant = "secondary",
  size = "md",
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx(base, sizes[size], variants[variant], className)}
      {...props}
    />
  );
}

