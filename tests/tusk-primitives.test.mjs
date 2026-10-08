import assert from "node:assert/strict";
import test from "node:test";
import { buildSlackPrimitivePrompt } from "../lib/tusk/primitives.ts";

test("builds an engineering primitive prompt", () => {
  const prompt = buildSlackPrimitivePrompt({
    title: "OAuth walkthrough",
    preset: "engineering",
  });
  assert.match(prompt, /"OAuth walkthrough"/);
  assert.match(prompt, /GitHub repositories/);
  assert.match(prompt, /Commands \/ code/);
  assert.match(prompt, /Do not invent links/);
});

test("uses custom instructions for custom preset", () => {
  const prompt = buildSlackPrimitivePrompt({
    title: "Customer call",
    preset: "custom",
    customInstructions: "Only return objections and next steps.",
  });
  assert.match(prompt, /Only return objections and next steps\./);
});
