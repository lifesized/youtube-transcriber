import { extractVideoId } from "../youtube";

const URL_REGEX = /https?:\/\/[^\s<>()]+/g;

export interface SlackYouTubeUrl {
  url: string;
  videoId: string;
}

function normalizeSlackUrl(rawUrl: string): string {
  // Slack autolinks may look like <https://youtu.be/id|youtu.be/id>.
  const withoutWrapper = rawUrl
    .replace(/^</, "")
    .split("|")[0]
    ?.split(">")[0] ?? rawUrl;

  return withoutWrapper.replace(/[.,;:!?)]$/g, "");
}

export function extractYouTubeUrlsFromSlackText(text: string): SlackYouTubeUrl[] {
  const matches = text.match(URL_REGEX) ?? [];
  const seen = new Set<string>();
  const urls: SlackYouTubeUrl[] = [];

  for (const match of matches) {
    const url = normalizeSlackUrl(match);
    try {
      const videoId = extractVideoId(url);
      if (seen.has(videoId)) continue;
      seen.add(videoId);
      urls.push({ url, videoId });
    } catch {
      // Ignore non-YouTube URLs and malformed links.
    }
  }

  return urls;
}
