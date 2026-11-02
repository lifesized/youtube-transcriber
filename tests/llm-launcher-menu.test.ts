import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LLM_LAUNCHER_MENU_PROVIDERS,
  migrateLlmLauncherLastProvider,
  resolveLlmLauncherLastProvider,
  sortLlmLauncherMenuProviders,
} from "../lib/llm-launcher-menu";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("YTT-459: remaining menu options are ChatGPT and Claude only", () => {
  assert.ok(LLM_LAUNCHER_MENU_PROVIDERS.length >= 1);
  assert.deepEqual(
    LLM_LAUNCHER_MENU_PROVIDERS.map((p) => ({ id: p.id, name: p.name })),
    [
      { id: "chatgpt", name: "ChatGPT" },
      { id: "claude", name: "Claude" },
    ]
  );
});

test("YTT-459: unknown last-provider values migrate away from built-in/server-key", () => {
  assert.equal(resolveLlmLauncherLastProvider("chatgpt"), "chatgpt");
  assert.equal(resolveLlmLauncherLastProvider("claude"), "claude");
  assert.equal(resolveLlmLauncherLastProvider(null), null);
  assert.equal(resolveLlmLauncherLastProvider(""), null);

  for (const stale of [
    "builtin",
    "openrouter",
    "Built-in (OpenRouter)",
    "openai",
    "anthropic",
  ]) {
    const migrated = migrateLlmLauncherLastProvider(stale);
    assert.equal(migrated.value, null);
    assert.equal(migrated.didMigrate, true);
  }

  const keep = migrateLlmLauncherLastProvider("claude");
  assert.equal(keep.value, "claude");
  assert.equal(keep.didMigrate, false);
});

test("YTT-459: sorted menu is never empty and defaults ChatGPT then Claude", () => {
  const unsorted = sortLlmLauncherMenuProviders(null);
  assert.ok(unsorted.length >= 1);
  assert.deepEqual(
    unsorted.map((p) => p.name),
    ["ChatGPT", "Claude"]
  );

  const claudeFirst = sortLlmLauncherMenuProviders("claude");
  assert.deepEqual(
    claudeFirst.map((p) => p.id),
    ["claude", "chatgpt"]
  );

  const staleSort = sortLlmLauncherMenuProviders("builtin");
  assert.deepEqual(
    staleSort.map((p) => p.id),
    ["chatgpt", "claude"]
  );
});

test("YTT-459: sparkle menu source has no built-in server-key option", () => {
  const src = readFileSync(
    path.join(repoRoot, "components/ui/llm-launcher.tsx"),
    "utf8"
  );
  assert.doesNotMatch(src, /Built-in \(OpenRouter\)/);
  assert.doesNotMatch(src, /server key/);
  assert.doesNotMatch(src, /summarizeBuiltIn/);
  assert.doesNotMatch(src, /\/api\/summaries/);
  assert.match(src, /Open transcript in/);
  assert.match(src, /migrateLlmLauncherLastProvider/);
  assert.match(src, /menuProviders\.length > 0/);
  assert.match(src, /from ["']@\/lib\/llm-launcher-menu["']/);
  assert.doesNotMatch(src, /llm-launcher-menu\.js/);
});
