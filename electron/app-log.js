"use strict";

/**
 * Packaged main-process file log.
 * Electron's app.setPath("logs") does not create the directory or tee
 * console.* — James had no ~/Library/Logs/Transcriber App/ at all.
 */

const fs = require("fs");
const path = require("path");
const util = require("util");
const config = require("./config.js");

const FILE_NAME = "main.log";
const FILE_MODE = 0o600;
const MAX_BYTES = 5 * 1024 * 1024;

// The console before install() teed it, so error() prints each line once.
let plainConsole = console;

function resolveLogDir() {
  return config.resolveAppLogDir();
}

function resolveLogFile() {
  return path.join(resolveLogDir(), FILE_NAME);
}

function ensureLogDir() {
  const dir = resolveLogDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function formatArgs(args) {
  return args
    .map((a) => (typeof a === "string" ? a : util.inspect(a, { depth: 4 })))
    .join(" ");
}

/** Keep one previous file: main.log.1 is replaced each time. */
function rotateIfFull(file) {
  try {
    if (fs.statSync(file).size >= MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // No log yet.
  }
}

function writeLine(level, args) {
  try {
    ensureLogDir();
    const file = resolveLogFile();
    rotateIfFull(file);
    const line = `[${new Date().toISOString()}] [${level}] ${formatArgs(args)}\n`;
    fs.appendFileSync(file, line, { mode: FILE_MODE });
  } catch {
    // Never throw from the logger.
  }
}

/** Builds before 0600 created main.log 0644. */
function tightenMode(file) {
  try {
    fs.chmodSync(file, FILE_MODE);
  } catch {
    // Not created yet; appendFileSync creates it 0600.
  }
}

function install(consoleObj = console) {
  ensureLogDir();
  tightenMode(resolveLogFile());
  const orig = {
    log: consoleObj.log.bind(consoleObj),
    warn: consoleObj.warn.bind(consoleObj),
    error: consoleObj.error.bind(consoleObj),
  };
  plainConsole = orig;
  consoleObj.log = (...args) => {
    writeLine("info", args);
    orig.log(...args);
  };
  consoleObj.warn = (...args) => {
    writeLine("warn", args);
    orig.warn(...args);
  };
  consoleObj.error = (...args) => {
    writeLine("error", args);
    orig.error(...args);
  };
  writeLine("info", ["file log opened", resolveLogFile()]);
  return resolveLogFile();
}

/** One main.log line and one console line, whether or not install() ran. */
function error(...args) {
  writeLine("error", args);
  plainConsole.error(...args);
}

module.exports = {
  FILE_NAME,
  MAX_BYTES,
  resolveLogDir,
  resolveLogFile,
  ensureLogDir,
  writeLine,
  install,
  error,
};
