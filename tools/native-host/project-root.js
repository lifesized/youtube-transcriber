"use strict";

/**
 * Recorded Transcriber checkout for the dev native host (com.transcribed.host).
 *
 * The host script can live in any checkout (e.g. a beta worktree); Start
 * always runs `npm run dev` from the root recorded in native-host.json.
 * Only `projectRoot` is read from that file, and it is only ever used as
 * `cwd`. Nothing from the file is executed or interpolated.
 */

const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("../../lib/write-file-atomic.js");

const CONFIG_FILE_NAME = "native-host.json";
const EXPECTED_PACKAGE_NAME = "youtube-transcriber";
const BAD_PROJECT_ROOT = "bad_project_root";

const DETAIL_MESSAGES = {
  not_set: "No project root is recorded.",
  empty: "Project root is empty.",
  not_absolute: "Project root must be an absolute path.",
  not_a_directory: "Project root is not an existing directory.",
  no_package_json: "Project root has no readable package.json.",
  wrong_package: `package.json name is not "${EXPECTED_PACKAGE_NAME}".`,
  no_dev_script: 'package.json has no "dev" script.',
  no_node_modules: "Project root has no node_modules (run npm install).",
  no_prisma_client: "Prisma client is not generated (run npm install).",
};

function getConfigPath(stateDir) {
  return path.join(stateDir, CONFIG_FILE_NAME);
}

function defaultProjectRoot() {
  return path.resolve(__dirname, "..", "..");
}

function refuse(detail, projectRoot) {
  const out = { ok: false, reason: BAD_PROJECT_ROOT, detail };
  if (projectRoot) out.projectRoot = projectRoot;
  return out;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * @returns {{ ok: true, projectRoot: string }
 *   | { ok: false, reason: "bad_project_root", detail: string, projectRoot?: string }}
 */
function validateProjectRoot(candidate) {
  if (candidate === undefined || candidate === null) return refuse("not_set");
  if (typeof candidate !== "string" || !candidate.trim()) return refuse("empty");
  const trimmed = candidate.trim();
  if (trimmed.includes("\0") || !path.isAbsolute(trimmed)) {
    return refuse("not_absolute");
  }

  const root = path.resolve(trimmed);
  if (!isDir(root)) return refuse("not_a_directory", root);

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return refuse("no_package_json", root);
  }
  if (!pkg || pkg.name !== EXPECTED_PACKAGE_NAME) return refuse("wrong_package", root);
  if (!pkg.scripts || typeof pkg.scripts.dev !== "string" || !pkg.scripts.dev.trim()) {
    return refuse("no_dev_script", root);
  }

  const nodeModules = path.join(root, "node_modules");
  if (!isDir(nodeModules)) return refuse("no_node_modules", root);
  if (
    !isFile(path.join(nodeModules, "@prisma", "client", "package.json")) ||
    !isFile(path.join(nodeModules, ".prisma", "client", "schema.prisma"))
  ) {
    return refuse("no_prisma_client", root);
  }

  return { ok: true, projectRoot: root };
}

/** Raw recorded value (unvalidated), or null when nothing is recorded. */
function readRecordedProjectRoot(stateDir) {
  let raw;
  try {
    raw = fs.readFileSync(getConfigPath(stateDir), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "projectRoot" in parsed) {
      return parsed.projectRoot;
    }
    return null;
  } catch {
    return "";
  }
}

/** The root Start must use. Never falls back to the host's own checkout. */
function resolveStartRoot(stateDir) {
  return validateProjectRoot(readRecordedProjectRoot(stateDir));
}

function writeProjectRootConfig(projectRoot, stateDir) {
  const validated = validateProjectRoot(projectRoot);
  if (!validated.ok) {
    const err = new Error(describeDetail(validated.detail));
    err.reason = validated.reason;
    err.detail = validated.detail;
    throw err;
  }
  const configPath = getConfigPath(stateDir);
  const body = JSON.stringify({ projectRoot: validated.projectRoot }, null, 2) + "\n";
  writeFileAtomic(configPath, body, 0o600);
  return { projectRoot: validated.projectRoot, configPath };
}

function clearProjectRootConfig(stateDir) {
  const configPath = getConfigPath(stateDir);
  try {
    fs.unlinkSync(configPath);
    return { cleared: true, configPath };
  } catch (e) {
    if (e && e.code === "ENOENT") return { cleared: false, configPath };
    throw e;
  }
}

function describeDetail(detail) {
  return DETAIL_MESSAGES[detail] || "Invalid project root.";
}

module.exports = {
  CONFIG_FILE_NAME,
  EXPECTED_PACKAGE_NAME,
  BAD_PROJECT_ROOT,
  getConfigPath,
  defaultProjectRoot,
  validateProjectRoot,
  readRecordedProjectRoot,
  resolveStartRoot,
  writeProjectRootConfig,
  clearProjectRootConfig,
  describeDetail,
};
