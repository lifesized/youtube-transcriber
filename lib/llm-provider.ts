export type LlmProvider = "anthropic" | "openai";

export const LLM_DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
};

const SYSTEM = "You summarize video transcripts into structured markdown.";

export async function callLlmProvider(opts: {
  provider: LlmProvider;
  apiKey: string;
  title: string;
  transcriptText: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = opts.fetchImpl || fetch;
  const userContent = `Summarize this transcript from "${opts.title}".\n\nTranscript:\n\n${opts.transcriptText}`;

  if (opts.provider === "anthropic") {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: LLM_DEFAULT_MODELS.anthropic,
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      content?: Array<{ text?: string }>;
    };
    if (!response.ok) {
      throw new Error(data?.error?.message || `Anthropic error (${response.status})`);
    }
    const text = data.content?.map((block) => block.text || "").join("").trim();
    if (!text) throw new Error("The summary model returned no text.");
    return text;
  }

  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: LLM_DEFAULT_MODELS.openai,
      temperature: 0.3,
      max_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI error (${response.status})`);
  }
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The summary model returned no text.");
  return text;
}
