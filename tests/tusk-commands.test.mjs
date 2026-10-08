import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commands = require(path.join(root, "electron/tusk/commands.js"));
const { resolveArtifactMode, isMentionTriggered } = await import("../lib/tusk/parse.ts");

test("/tusk help and status copy", () => {
  assert.equal(commands.parseSlashText(""), "help");
  assert.equal(commands.parseSlashText("help"), "help");
  assert.equal(commands.parseSlashText("status"), "status");
  assert.match(commands.slashReply("help"), /Paste a YouTube/);
  assert.match(commands.slashReply("help"), /@Tusk/);
  assert.match(
    commands.slashReply("status", { state: "connected", workspace: "Personal", botName: "tusk" }),
    /Personal/
  );
  assert.match(commands.slashReply("unknown"), /Unknown subcommand/);
});

test("mention and summarize/transcript mode parsing from the old events route", () => {
  assert.equal(isMentionTriggered("<@Ubot> summarize https://youtu.be/dQw4w9WgXcQ", "Ubot"), true);
  assert.equal(isMentionTriggered("https://youtu.be/dQw4w9WgXcQ", "Ubot"), false);
  assert.equal(resolveArtifactMode("<@Ubot> summarize https://youtu.be/x"), "summary");
  assert.equal(resolveArtifactMode("<@Ubot> transcript https://youtu.be/x"), "transcript");
  assert.equal(resolveArtifactMode("https://youtu.be/x"), "summary");
});

test("stripMention leaves only the question", async () => {
  const { stripMention } = await import("../lib/tusk/parse.ts");
  assert.equal(stripMention("<@Ubot> what was the decision?", "Ubot"), "what was the decision?");
});
