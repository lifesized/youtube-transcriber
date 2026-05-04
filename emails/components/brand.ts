// Brand tokens — mirror of app/globals.css (HSL → hex for email-client safety).
// Dark editorial. Single warm accent. Light fallback variants for clients
// that hard-block dark backgrounds (rare).

export const brand = {
  bg: "#0a0a0a",
  panel: "#121212",
  panel2: "#171717",
  border: "#242424",
  borderStrong: "#2e2e2e",
  text: "#fafafa",
  muted: "#b3b3b3",
  muted2: "#8c8c8c",
  accent: "#a68a5b",
  accentDim: "#7d6644",
  danger: "#d96666",
  success: "#7ab87a",
} as const;

export const fonts = {
  heading: '"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
} as const;

export const sizing = {
  containerWidth: 560,
  radius: 10,
  radiusSm: 6,
} as const;

export const APP_URL = "https://transcribed.dev";

export function utm(path: string, campaign: string, content?: string): string {
  const url = new URL(path, APP_URL);
  url.searchParams.set("utm_source", "email");
  url.searchParams.set("utm_medium", "lifecycle");
  url.searchParams.set("utm_campaign", campaign);
  if (content) url.searchParams.set("utm_content", content);
  return url.toString();
}
