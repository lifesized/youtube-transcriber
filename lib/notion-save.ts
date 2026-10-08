const NOTION_VERSION = "2022-06-28";
const RICH_TEXT_LIMIT = 2000;
const BLOCKS_PER_REQUEST = 100;

export function parseNotionId(input: string): string | null {
  if (typeof input !== "string") return null;
  const compact = input.replace(/-/g, "");
  const match = compact.match(/[0-9a-f]{32}/i);
  if (!match) return null;
  const hex = match[0].toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function chunkRichText(text: string, limit = RICH_TEXT_LIMIT): string[] {
  const src = text || "";
  if (src.length === 0) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < src.length; i += limit) {
    chunks.push(src.slice(i, i + limit));
  }
  return chunks;
}

export function textToParagraphBlocks(text: string): object[] {
  const chunks = chunkRichText(text);
  return chunks.map((content) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content } }],
    },
  }));
}

export function buildPageBody(summary: string | null | undefined, transcript: string): object[] {
  const parts = [];
  if (summary && summary.trim()) {
    parts.push("Summary", summary.trim(), "Transcript", transcript);
  } else {
    parts.push("Transcript", transcript);
  }
  return parts.flatMap((part) => textToParagraphBlocks(part));
}

function notionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionFetch(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  init: RequestInit
) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...notionHeaders(token), ...(init.headers || {}) },
  });
  const data = (await response.json().catch(() => ({}))) as {
    object?: string;
    message?: string;
    id?: string;
    properties?: Record<string, { type?: string }>;
    parent?: { type?: string };
  };
  if (!response.ok) {
    throw new Error(data.message || `Notion error (${response.status})`);
  }
  return data;
}

function titlePropertyName(properties: Record<string, { type?: string }> | undefined) {
  if (!properties) return "Name";
  for (const [name, value] of Object.entries(properties)) {
    if (value?.type === "title") return name;
  }
  return "Name";
}

export async function ensureDatabaseProperties(opts: {
  token: string;
  databaseId: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = opts.fetchImpl || fetch;
  const db = await notionFetch(
    fetchImpl,
    opts.token,
    `https://api.notion.com/v1/databases/${opts.databaseId}`,
    { method: "GET" }
  );
  const titleName = titlePropertyName(db.properties);
  const existing = db.properties || {};
  const needed: Record<string, object> = {};
  if (!existing.Channel) needed.Channel = { rich_text: {} };
  if (!existing["Video URL"]) needed["Video URL"] = { url: {} };
  if (!existing.Published) needed.Published = { date: {} };
  if (!existing.Saved) needed.Saved = { date: {} };
  if (Object.keys(needed).length > 0) {
    await notionFetch(
      fetchImpl,
      opts.token,
      `https://api.notion.com/v1/databases/${opts.databaseId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ properties: needed }),
      }
    );
  }
  return titleName;
}

async function appendBlocks(
  fetchImpl: typeof fetch,
  token: string,
  blockId: string,
  blocks: object[]
) {
  for (let i = 0; i < blocks.length; i += BLOCKS_PER_REQUEST) {
    const batch = blocks.slice(i, i + BLOCKS_PER_REQUEST);
    await notionFetch(
      fetchImpl,
      token,
      `https://api.notion.com/v1/blocks/${blockId}/children`,
      {
        method: "PATCH",
        body: JSON.stringify({ children: batch }),
      }
    );
  }
}

export async function saveVideoToNotion(opts: {
  token: string;
  databaseIdOrUrl: string;
  video: {
    title: string;
    author: string;
    videoUrl: string;
    createdAt: Date | string;
    baseSummary?: string | null;
    transcript: string;
  };
  fetchImpl?: typeof fetch;
}): Promise<{ pageId: string; parentType: "database" | "page" }> {
  const fetchImpl = opts.fetchImpl || fetch;
  const id = parseNotionId(opts.databaseIdOrUrl);
  if (!id) throw new Error("A Notion database ID or URL is required");
  if (!opts.token.trim()) throw new Error("A Notion integration token is required");

  const blocks = buildPageBody(opts.video.baseSummary, opts.video.transcript);
  const first = blocks.slice(0, BLOCKS_PER_REQUEST);
  const rest = blocks.slice(BLOCKS_PER_REQUEST);
  const published =
    opts.video.createdAt instanceof Date
      ? opts.video.createdAt.toISOString().slice(0, 10)
      : String(opts.video.createdAt).slice(0, 10);
  const saved = new Date().toISOString().slice(0, 10);

  let parentType: "database" | "page" = "database";
  let titleName = "Name";
  try {
    titleName = await ensureDatabaseProperties({
      token: opts.token,
      databaseId: id,
      fetchImpl,
    });
  } catch {
    parentType = "page";
  }

  const properties =
    parentType === "database"
      ? {
          [titleName]: {
            title: [{ text: { content: opts.video.title.slice(0, RICH_TEXT_LIMIT) } }],
          },
          Channel: {
            rich_text: [
              { text: { content: (opts.video.author || "").slice(0, RICH_TEXT_LIMIT) } },
            ],
          },
          "Video URL": { url: opts.video.videoUrl || null },
          Published: { date: { start: published } },
          Saved: { date: { start: saved } },
        }
      : {
          title: {
            title: [{ text: { content: opts.video.title.slice(0, RICH_TEXT_LIMIT) } }],
          },
        };

  const created = await notionFetch(
    fetchImpl,
    opts.token,
    "https://api.notion.com/v1/pages",
    {
      method: "POST",
      body: JSON.stringify({
        parent: parentType === "database" ? { database_id: id } : { page_id: id },
        properties,
        children: first,
      }),
    }
  );
  if (!created.id) throw new Error("Notion did not return a page id");
  if (rest.length > 0) {
    await appendBlocks(fetchImpl, opts.token, created.id, rest);
  }
  return { pageId: created.id, parentType };
}
