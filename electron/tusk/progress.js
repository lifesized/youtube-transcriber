"use strict";

/**
 * Progress-card copy from the old Slack bot, plus queued / done / failed.
 * Placeholder strings for Design.
 */

function youtubeThumbnailUrl(videoId) {
  if (!videoId || String(videoId).includes(":")) return null;
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function stageCopy(stage, mode) {
  const transcript = mode === "transcript";
  switch (stage) {
    case "queued":
      return {
        fallback: "👀 Queued — I’ll work on this in the thread.",
        block: "👀 *Queued*\nI’ll work on this in the thread.",
      };
    case "fetching":
      return transcript
        ? {
            fallback: "👀 Step 1/2 — checking captions. I’ll share the transcript here when ready.",
            block: "👀 *Step 1/2 — Checking captions*\nI’ll share the transcript here when ready.",
          }
        : {
            fallback: "👀 Step 1/3 — checking captions. I’ll summarize it here when ready.",
            block: "👀 *Step 1/3 — Checking captions*\nI’ll summarize it here when ready.",
          };
    case "summarizing":
      return {
        fallback: "📝 Step 2/3 — transcript ready. Summarizing it now...",
        block: "📝 *Step 2/3 — Transcript ready*\nSummarizing it now...",
      };
    case "uploading":
      return {
        fallback: "📄 Uploading the transcript file…",
        block: "📄 *Uploading the transcript*\nI’ll attach it in this thread.",
      };
    case "done":
      return {
        fallback: transcript ? "✅ Transcript uploaded." : "✅ Summary ready.",
        block: transcript ? "✅ *Transcript uploaded*" : "✅ *Summary ready*",
      };
    case "failed":
      return {
        fallback: "⚠️ Tusk couldn’t finish that.",
        block: "⚠️ *Couldn’t finish*",
      };
    default:
      return {
        fallback: "👀 Working…",
        block: "👀 *Working*",
      };
  }
}

function isSafeSourceUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      (host === "www.youtube.com" || host === "open.spotify.com" || host === "www.linkedin.com")
    );
  } catch {
    return false;
  }
}

function escapeSlackMrkdwn(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function progressBlocks(args) {
  const copy = stageCopy(args.stage, args.mode);
  const extra = args.detail ? `\n${escapeSlackMrkdwn(args.detail)}` : "";
  const safeUrl = isSafeSourceUrl(args.sourceUrl) ? args.sourceUrl : "";
  const open = safeUrl ? `\n<${safeUrl}|Open video>` : "";
  const section = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `${copy.block}${extra}${open}`,
    },
  };
  const thumb = youtubeThumbnailUrl(args.videoId);
  if (thumb) {
    section.accessory = {
      type: "image",
      image_url: thumb,
      alt_text: "Video thumbnail",
    };
  }
  const blocks = [section];
  if (safeUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open video", emoji: true },
          url: safeUrl,
        },
      ],
    });
  }
  return blocks;
}

function progressText(args) {
  const copy = stageCopy(args.stage, args.mode);
  const parts = [copy.fallback];
  if (args.detail) parts.push(escapeSlackMrkdwn(args.detail));
  if (isSafeSourceUrl(args.sourceUrl)) parts.push(args.sourceUrl);
  return parts.join("\n");
}

module.exports = {
  youtubeThumbnailUrl,
  isSafeSourceUrl,
  stageCopy,
  progressBlocks,
  progressText,
};
