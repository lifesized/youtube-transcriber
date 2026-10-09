"use strict";

const { progressBlocks, progressText } = require("./progress.js");
const { classifyLocalFailure, COPY } = require("./errors.js");
const { renderSummaryMarkdown, escapeSlackMrkdwn } = require("./format.js");
const {
  buildSlackPrimitivePrompt,
  buildThreadQuestionPrompt,
  resolvePreset,
  resolveArtifactMode,
  stripMention,
} = require("./prompt.js");

function sortUrls(urls) {
  const rank = { youtube: 0, linkedin: 1, spotify: 2 };
  return [...urls].sort((a, b) => (rank[a.platform] ?? 9) - (rank[b.platform] ?? 9));
}

const SIGNED_IN_SOURCES = new Set(["client_panel_scrape", "linkedin", "linkedin_whisper_local"]);

function isTuskAllowedSource(videoOrUrl) {
  if (!videoOrUrl || typeof videoOrUrl !== "object") return false;
  const platform = String(videoOrUrl.platform || "").toLowerCase();
  const source = String(videoOrUrl.source || "").toLowerCase();
  if (platform && platform !== "youtube") return false;
  if (source && source !== "youtube" && SIGNED_IN_SOURCES.has(source)) return false;
  if (source.startsWith("linkedin")) return false;
  return platform === "youtube" || (!platform && !source);
}

function youtubeUrlsOnly(urls) {
  return (urls || []).filter((item) => item && item.platform === "youtube" && item.url);
}

function parseSegments(transcript) {
  if (Array.isArray(transcript)) return transcript;
  if (typeof transcript !== "string") return [];
  try {
    const parsed = JSON.parse(transcript);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatTimestamp(ms) {
  const safe = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const mins = Math.floor(safe / 60);
  const secs = String(safe % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatTranscriptFile({ title, sourceUrl, segments }) {
  const lines = [`# ${title || "Transcript"}`, sourceUrl || "", ""];
  for (const segment of segments) {
    const text = segment && segment.text ? String(segment.text).trim() : "";
    if (!text) continue;
    const start = segment.startMs ?? (segment.start != null ? segment.start * 1000 : 0);
    lines.push(`[${formatTimestamp(start)}] ${text}`);
  }
  return lines.join("\n");
}

function cleanFileTitle(title) {
  const cleaned = String(title || "Transcript")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Transcript";
}

function safeFilename(title) {
  const base = String(title || "transcript")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .slice(0, 40) || "transcript";
  return `${base.replace(/\s+/g, "-").toLowerCase()}-transcript.txt`;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    err.code = "ABORT_ERR";
    throw err;
  }
}

function threadKey(channel, threadTs) {
  return `${channel}:${threadTs}`;
}

function createPipeline(options = {}) {
  const slack = options.slackApi;
  const local = options.localClient;
  const botToken = options.botToken;
  const botUserId = options.botUserId || "";
  const preset = resolvePreset(options.preset);
  const threadCache = options.threadCache || new Map();
  const maxThreads = options.maxThreads ?? 80;

  async function reactEyes(channel, ts) {
    try {
      await slack.addReaction({ botToken, channel, timestamp: ts, name: "eyes" });
    } catch {
      // reaction is best-effort
    }
  }

  async function postOrUpdate(card, stage, extra = {}) {
    const payload = {
      botToken,
      channel: card.channel,
      text: progressText({
        stage,
        mode: card.mode,
        sourceUrl: card.sourceUrl,
        detail: extra.detail,
      }),
      blocks: extra.blocks ||
        progressBlocks({
          stage,
          mode: card.mode,
          sourceUrl: card.sourceUrl,
          videoId: card.videoId,
          detail: extra.detail,
        }),
    };
    if (card.replyTs) {
      const updated = await slack.updateMessage({ ...payload, ts: card.replyTs });
      if (!updated || !updated.ts) throw new Error("slack_update_missing_ts");
      return updated.ts;
    }
    const posted = await slack.postMessage({ ...payload, threadTs: card.threadTs });
    if (!posted || !posted.ts) throw new Error("slack_post_missing_ts");
    return posted.ts;
  }

  async function uploadTranscript(card, video, segments) {
    await slack.uploadThreadFile({
      botToken,
      channel: card.channel,
      threadTs: card.threadTs,
      filename: safeFilename(video.title),
      title: `${cleanFileTitle(video.title)} — transcript`,
      content: formatTranscriptFile({
        title: video.title,
        sourceUrl: card.sourceUrl,
        segments,
      }),
      initialComment: video.title
        ? `Transcript for ${escapeSlackMrkdwn(video.title)}`
        : "Transcript",
    });
  }

  async function failCard(card, err) {
    const mapped = classifyLocalFailure(err);
    const detail = escapeSlackMrkdwn(mapped.message);
    try {
      if (card.replyTs) {
        await postOrUpdate(card, "failed", { detail });
      } else {
        await slack.postMessage({
          botToken,
          channel: card.channel,
          threadTs: card.threadTs,
          text: detail,
        });
      }
    } catch {
      // never leak
    }
    return { ok: false, error: mapped.code };
  }

  function jobOpts(signal, jobId) {
    const extra = { signal, jobTag: "tusk" };
    if (jobId) extra.jobId = jobId;
    return extra;
  }

  async function processUrl(evt, url, signal, jobId) {
    const mode = resolveArtifactMode(evt.text || "");
    const card = {
      channel: evt.channel,
      threadTs: evt.threadTs || evt.ts,
      sourceUrl: url.url,
      videoId: url.videoId || url.contentId,
      mode,
      replyTs: null,
    };
    if (!card.sourceUrl || !card.channel || !card.threadTs) {
      return { ok: false, error: "missing_target" };
    }

    try {
      await reactEyes(evt.channel, evt.ts);
      throwIfAborted(signal);
      card.replyTs = await postOrUpdate(card, "queued");
      throwIfAborted(signal);
      card.replyTs = await postOrUpdate(card, "fetching");

      const video = await local.createTranscript(card.sourceUrl, jobOpts(signal, jobId));
      throwIfAborted(signal);
      if (!isTuskAllowedSource({ ...url, ...video, platform: video.platform || url.platform })) {
        const err = new Error(COPY.not_youtube);
        err.status = 422;
        err.code = "tusk_not_youtube";
        throw err;
      }
      const segments = parseSegments(video.transcript);
      card.videoId = video.videoId || card.videoId;

      if (mode === "transcript") {
        card.replyTs = await postOrUpdate(card, "uploading");
        await uploadTranscript(card, video, segments);
        await postOrUpdate(card, "done", {
          detail: "I added the full transcript as a text file in this thread.",
        });
        rememberThread(card, video);
        return { ok: true, mode, cached: false };
      }

      card.replyTs = await postOrUpdate(card, "summarizing");
      let summary;
      try {
        summary = await local.createSummary(video.id, {
          ...jobOpts(signal, jobId),
          promptOverride: buildSlackPrimitivePrompt({
            title: video.title || "Video",
            preset,
          }),
        });
      } catch (err) {
        const mapped = classifyLocalFailure(err);
        if (mapped.code !== "no_llm") throw err;
        card.replyTs = await postOrUpdate(card, "uploading", { detail: COPY.no_llm });
        await uploadTranscript(card, video, segments);
        await postOrUpdate(card, "done", { detail: COPY.no_llm });
        rememberThread(card, video);
        return { ok: true, mode: "transcript", reason: "no_llm" };
      }
      throwIfAborted(signal);
      const markdown = renderSummaryMarkdown(summary.summary_md || summary.summary || "", {
        title: video.title,
        sourceUrl: card.sourceUrl,
      });
      await slack.updateMessage({
        botToken,
        channel: card.channel,
        ts: card.replyTs,
        text: markdown,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: markdown },
          },
        ],
      });
      rememberThread(card, video);
      return { ok: true, mode: "summary", cached: Boolean(summary.cached) };
    } catch (err) {
      return failCard(card, err);
    }
  }

  function rememberThread(card, video) {
    if (!card.channel || !card.threadTs || !video || !video.id || !card.sourceUrl) return;
    while (threadCache.size >= maxThreads) {
      const oldest = threadCache.keys().next().value;
      threadCache.delete(oldest);
    }
    threadCache.set(threadKey(card.channel, card.threadTs), {
      channel: card.channel,
      threadTs: card.threadTs,
      sourceUrl: card.sourceUrl,
      videoId: card.videoId,
      transcriptId: video.id,
      title: video.title || "Video",
    });
  }

  async function handleSupportedLink(evt, signal, jobId) {
    const urls = youtubeUrlsOnly(sortUrls(evt.urls || []));
    if (!urls.length) return { skipped: "not_youtube" };
    return processUrl(evt, urls[0], signal, jobId);
  }

  async function handleThreadQuestion(evt, signal, jobId) {
    const channel = evt && evt.channel;
    const threadTs = evt && (evt.threadTs || evt.ts);
    if (!channel || !threadTs) return { skipped: "no_thread" };
    const remembered = threadCache.get(threadKey(channel, threadTs));
    if (!remembered || remembered.channel !== channel || remembered.threadTs !== threadTs) {
      await slack.postMessage({
        botToken,
        channel,
        threadTs,
        text: "I only answer questions about the video already in this thread. Paste a supported link first.",
      });
      return { skipped: "no_thread_video" };
    }
    const question = stripMention(evt.text || "", evt.botUserId || botUserId);
    if (!question) {
      await slack.postMessage({
        botToken,
        channel,
        threadTs,
        text: "Ask a question about this thread’s video, e.g. `@Tusk what was the decision?`",
      });
      return { skipped: "empty_question" };
    }
    try {
      throwIfAborted(signal);
      const summary = await local.createSummary(remembered.transcriptId, {
        ...jobOpts(signal, jobId),
        promptOverride: buildThreadQuestionPrompt({
          title: remembered.title,
          question,
        }),
      });
      const markdown = renderSummaryMarkdown(summary.summary_md || summary.summary || "", {
        title: remembered.title,
        sourceUrl: remembered.sourceUrl,
      });
      await slack.postMessage({
        botToken,
        channel,
        threadTs,
        text: markdown,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: markdown } }],
      });
      return { ok: true, mode: "qa", transcriptId: remembered.transcriptId };
    } catch (err) {
      const mapped = classifyLocalFailure(err);
      await slack.postMessage({
        botToken,
        channel,
        threadTs,
        text: escapeSlackMrkdwn(mapped.message),
      });
      return { ok: false, error: mapped.code };
    }
  }

  return {
    handleSupportedLink,
    handleThreadQuestion,
    rememberThread,
    sortUrls,
    formatTranscriptFile,
    cleanFileTitle,
    safeFilename,
    threadCache,
  };
}

module.exports = {
  createPipeline,
  sortUrls,
  youtubeUrlsOnly,
  isTuskAllowedSource,
  formatTranscriptFile,
  cleanFileTitle,
  safeFilename,
  parseSegments,
};
