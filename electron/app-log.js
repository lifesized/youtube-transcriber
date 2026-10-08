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

function writeLine(level, args) {
  try {
    ensureLogDir();
    const line = `[${new Date().toISOString()}] [${level}] ${formatArgs(args)}\n`;
    fs.appendFileSync(resolveLogFile(), line);
  } catch {
    // Never throw from the logger.
  }
}

function install(consoleObj = console) {
  ensureLogDir();
  const orig = {
    log: consoleObj.log.bind(consoleObj),
    warn: consoleObj.warn.bind(consoleObj),
    error: consoleObj.error.bind(consoleObj),
  };
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

module.exports = {
  FILE_NAME,
  resolveLogDir,
  resolveLogFile,
  ensureLogDir,
  writeLine,
  install,
};
