"use strict";

/**
 * Token-first calls to the app's own local server.
 * Reuses lib/local-api-fetch.js (YTT-435 Bearer). Never mints a token.
 */

const { authorizedFetch, LocalApiAuthError } = require("../../lib/local-api-fetch.js");
const config = require("../config.js");

class LocalApiError extends Error {
  constructor(args) {
    super(args.message || "Local API error");
    this.name = "LocalApiError";
    this.status = args.status;
    this.code = args.code;
    this.payload = args.payload;
  }
}

function baseUrl(port) {
  return `http://127.0.0.1:${port || config.port}`;
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Invalid JSON from local API" };
  }
}

async function localRequest(path, init, options = {}) {
  const url = `${baseUrl(options.port)}${path}`;
  let res;
  try {
    res = await authorizedFetch(
      url,
      {
        ...init,
        signal: options.signal,
        headers: {
          Accept: "application/json",
          ...(init && init.headers),
        },
      },
      {
        token: options.token,
        env: options.env,
        readTokenFile: options.readTokenFile,
        fetchImpl: options.fetchImpl,
      }
    );
  } catch (err) {
    if (err instanceof LocalApiAuthError) throw err;
    if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) throw err;
    const wrapped = new LocalApiError({
      message: err && err.message ? err.message : "fetch failed",
      code: err && err.code,
    });
    if (err && err.code) wrapped.code = err.code;
    throw wrapped;
  }
  const payload = await readJson(res);
  if (!res.ok) {
    throw new LocalApiError({
      status: res.status,
      message: typeof payload.error === "string" ? payload.error : `HTTP ${res.status}`,
      payload,
    });
  }
  return payload;
}

function createLocalClient(options = {}) {
  const defaults = {
    port: options.port || config.port,
    token: options.token,
    env: options.env,
    readTokenFile: options.readTokenFile,
    fetchImpl: options.fetchImpl,
  };

  function opts(extra) {
    return { ...defaults, ...extra };
  }

  return {
    createTranscript(url, extra) {
      return localRequest(
        "/api/transcripts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
        opts(extra)
      );
    },
    createSummary(transcriptId, extra) {
      const body = { transcriptId };
      if (extra && extra.promptOverride) body.promptOverride = extra.promptOverride;
      return localRequest(
        "/api/summaries",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        opts(extra)
      );
    },
    cancelInFlight(extra) {
      return localRequest("/api/jobs/cancel", { method: "POST" }, opts(extra)).catch(() => ({
        ok: false,
      }));
    },
  };
}

module.exports = {
  LocalApiError,
  createLocalClient,
  baseUrl,
};
