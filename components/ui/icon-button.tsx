import * as React from "react";

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const base =
  "inline-flex items-center justify-center rounded-lg text-white/60 transition " +
  "hover:bg-white/5 hover:text-white/90 active:bg-white/10 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 " +
  "disabled:pointer-events-none disabled:opacity-50";

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md";
};

export function IconButton({ className, size = "md", type, ...props }: IconButtonProps) {
  const sizeClass = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  return (
    <button
      type={type ?? "button"}
      className={cx(base, sizeClass, className)}
      {...props}
    />
  );
}

export function iconButtonClassName(size: "sm" | "md" = "md"): string {
  return cx(base, size === "sm" ? "h-8 w-8" : "h-9 w-9");
}

