#!/usr/bin/env node
"use strict";
/**
 * Ensure TRANSCRIBER_LOCAL_TOKEN is set, then exec the remaining argv as a command.
 * Usage: node scripts/run-with-local-token.js next dev -p 19720 --hostname 127.0.0.1
 */
const { spawn } = require("child_process");
const path = require("path");
const { ensureInEnv, ENV_NAME, getLocalApiTokenPath } = require("../lib/local-api-token");

ensureInEnv();
// Do not print the token. Path is safe to mention if debugging.
if (process.env.TRANSCRIBER_TOKEN_DEBUG === "1") {
  console.error(`[local-api-token] using file ${getLocalApiTokenPath()} (env ${ENV_NAME} set)`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-with-local-token.js <command> [args...]");
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
