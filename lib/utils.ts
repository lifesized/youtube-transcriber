/**
 * Format milliseconds to timestamp string (HH:MM:SS or MM:SS).
 */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) {
    const hh = String(hours).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Concatenate class names, filtering out falsy values.
 * Useful for conditional className composition.
 */
export function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}
