export interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
  ts?: string;
}

export interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

export interface SlackFileUploadResponse extends SlackApiResponse {
  file?: { id?: string; permalink?: string };
  files?: Array<{ id?: string; permalink?: string }>;
}

interface SlackExternalUploadUrlResponse extends SlackApiResponse {
  upload_url?: string;
  file_id?: string;
}

export type SlackBlock = Record<string, unknown>;

/**
 * Thrown when Slack returns a non-2xx HTTP response (rate-limit, 5xx,
 * auth revoked, malformed JSON, etc). Callers should treat this as a
 * retriable error.
 *
 * Keeps `status` (HTTP code) and `slackError` (parsed `error` field
 * from the response body if Slack returned JSON) separate so we can
 * branch retry logic on either dimension.
 */
export class SlackApiError extends Error {
  readonly status: number;
  readonly slackError?: string;

  constructor(args: { status: number; slackError?: string; message?: string }) {
    super(
      args.message ??
        `Slack API HTTP ${args.status}${args.slackError ? ` (${args.slackError})` : ""}`,
    );
    this.name = "SlackApiError";
    this.status = args.status;
    this.slackError = args.slackError;
  }
}

async function parseSlackResponse<T>(res: Response): Promise<T> {
  // Slack returns 200 even when the API call fails (with `ok: false`
  // in the body), but 429/5xx and proxy errors come back as HTML and
  // would silently look like success if we only checked the JSON body.
  // Short-circuit on non-2xx with a typed error so the caller can retry.
  if (!res.ok) {
    // Try to surface a Slack `error` code if the body happens to be
    // JSON (some 429 responses still are). Swallow any parse failure
    // so we always throw the typed error rather than a JSON SyntaxError.
    let slackError: string | undefined;
    try {
      const responseBody = (await res.json()) as { error?: string };
      slackError = responseBody?.error;
    } catch {
      // Non-JSON body (HTML error page, empty, etc.) — ignore.
    }
    throw new SlackApiError({ status: res.status, slackError });
  }

  return (await res.json()) as T;
}

async function slackFetch<T>(url: string, botToken: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  return parseSlackResponse<T>(res);
}

async function slackFormFetch<T>(url: string, botToken: string, body: Record<string, string>): Promise<T> {
  const form = new URLSearchParams(body);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: form,
  });

  return parseSlackResponse<T>(res);
}

export async function postSlackThreadReply(args: {
  botToken: string;
  channel: string;
  threadTs: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<SlackPostMessageResponse> {
  return slackFetch<SlackPostMessageResponse>("https://slack.com/api/chat.postMessage", args.botToken, {
    channel: args.channel,
    thread_ts: args.threadTs,
    text: args.text,
    blocks: args.blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
}

export async function updateSlackMessage(args: {
  botToken: string;
  channel: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<SlackPostMessageResponse> {
  return slackFetch<SlackPostMessageResponse>("https://slack.com/api/chat.update", args.botToken, {
    channel: args.channel,
    ts: args.ts,
    text: args.text,
    blocks: args.blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
}

export async function uploadSlackThreadFile(args: {
  botToken: string;
  channel: string;
  threadTs: string;
  filename: string;
  title: string;
  content: string;
  initialComment?: string;
}): Promise<SlackFileUploadResponse> {
  const bytes = new TextEncoder().encode(args.content);
  const uploadUrl = await slackFormFetch<SlackExternalUploadUrlResponse>(
    "https://slack.com/api/files.getUploadURLExternal",
    args.botToken,
    {
      filename: args.filename,
      length: String(bytes.byteLength),
    },
  );
  if (!uploadUrl.ok || !uploadUrl.upload_url || !uploadUrl.file_id) {
    return { ok: false, error: uploadUrl.error ?? "slack_upload_url_failed" };
  }
  try {
    const parsed = new URL(uploadUrl.upload_url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "files.slack.com") {
      return { ok: false, error: "invalid_upload_url" };
    }
  } catch {
    return { ok: false, error: "invalid_upload_url" };
  }

  const upload = await fetch(uploadUrl.upload_url, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: bytes,
  });
  if (!upload.ok) {
    throw new SlackApiError({ status: upload.status, message: `Slack file upload HTTP ${upload.status}` });
  }

  return slackFormFetch<SlackFileUploadResponse>(
    "https://slack.com/api/files.completeUploadExternal",
    args.botToken,
    {
      files: JSON.stringify([{ id: uploadUrl.file_id, title: args.title }]),
      channel_id: args.channel,
      thread_ts: args.threadTs,
      ...(args.initialComment ? { initial_comment: args.initialComment } : {}),
    },
  );
}

export interface SlackAuthTestResponse extends SlackApiResponse {
  url?: string;
  team?: string;
  user?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
}

export async function authTest(botToken: string): Promise<SlackAuthTestResponse> {
  return slackFormFetch<SlackAuthTestResponse>("https://slack.com/api/auth.test", botToken, {});
}

export async function addSlackReaction(args: {
  botToken: string;
  channel: string;
  timestamp: string;
  name: string;
}): Promise<SlackApiResponse> {
  return slackFetch<SlackApiResponse>("https://slack.com/api/reactions.add", args.botToken, {
    channel: args.channel,
    timestamp: args.timestamp,
    name: args.name,
  });
}

export async function removeSlackReaction(args: {
  botToken: string;
  channel: string;
  timestamp: string;
  name: string;
}): Promise<SlackApiResponse> {
  return slackFetch<SlackApiResponse>("https://slack.com/api/reactions.remove", args.botToken, {
    channel: args.channel,
    timestamp: args.timestamp,
    name: args.name,
  });
}
