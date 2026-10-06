import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = require(path.join(repoRoot, "lib/local-api-fetch.js"));
const { localAuthHeadersFromToken } = require(
  path.join(repoRoot, "extension/local-auth-headers.js")
);

const SECRET = "super-secret-loopback-token";

test("resolveSharedLocalToken prefers TRANSCRIBER_LOCAL_TOKEN and does not read the file", () => {
  let reads = 0;
  const token = client.resolveSharedLocalToken(
    { TRANSCRIBER_LOCAL_TOKEN: SECRET },
    () => {
      reads += 1;
      return "from-file";
    }
  );
  assert.equal(token, SECRET);
  assert.equal(reads, 0);
});

test("resolveSharedLocalToken reads an existing token file and does not mint", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ytt-mcp-token-"));
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const prevAppData = process.env.APPDATA;
  const stored = "d".repeat(64);
  try {
    let tokenDir;
    if (process.platform === "win32") {
      process.env.APPDATA = dir;
      tokenDir = path.join(dir, "Transcriber");
    } else if (process.platform !== "darwin") {
      process.env.XDG_CONFIG_HOME = dir;
      tokenDir = path.join(dir, "transcriber");
    } else {
      return;
    }
    assert.equal(client.resolveSharedLocalToken({}), null);
    assert.equal(existsSync(path.join(tokenDir, "local-api.token")), false);

    mkdirSync(tokenDir, { recursive: true });
    const filePath = path.join(tokenDir, "local-api.token");
    writeFileSync(filePath, stored, { mode: 0o600 });
    assert.equal(client.resolveSharedLocalToken({}), stored);
    assert.equal(readFileSync(filePath, "utf8"), stored);

    writeFileSync(filePath, "too-short", { mode: 0o600 });
    assert.equal(client.resolveSharedLocalToken({}), null);
    assert.equal(readFileSync(filePath, "utf8"), "too-short");
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    if (prevAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prevAppData;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveSharedLocalToken is null when the token file cannot be read", () => {
  assert.equal(
    client.resolveSharedLocalToken({}, () => {
      throw new Error("EACCES");
    }),
    null
  );
  assert.equal(client.resolveSharedLocalToken({}, () => ""), null);
  assert.equal(client.resolveSharedLocalToken({}, () => null), null);
});

test("MCP without a token does not call fetch", async () => {
  let fetches = 0;
  await assert.rejects(
    () =>
      client.authorizedFetch(
        "http://127.0.0.1:19720/api/transcripts",
        { method: "GET" },
        {
          token: null,
          fetchImpl: async () => {
            fetches += 1;
            return new Response("[]", { status: 200 });
          },
        }
      ),
    (err) => {
      assert.equal(err.name, "LocalApiAuthError");
      assert.match(err.message, /without a loopback token/i);
      assert.equal(err.message.includes(SECRET), false);
      assert.equal(err.message.includes("Bearer"), false);
      return true;
    }
  );
  assert.equal(fetches, 0);
});

test("empty token and failed file lookup also do not call fetch", async () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(() =>
    client.authorizedFetch("http://127.0.0.1:19720/api/health", undefined, {
      token: "",
      fetchImpl,
    })
  );
  await assert.rejects(() =>
    client.authorizedFetch("http://127.0.0.1:19720/api/health", undefined, {
      env: {},
      readTokenFile: () => {
        throw new Error("missing");
      },
      fetchImpl,
    })
  );
  assert.equal(fetches, 0);
});

test("authorized fetch sends the YTT-435 Bearer header and not a URL token", async () => {
  /** @type {Record<string, string> | undefined} */
  let seen;
  /** @type {string} */
  let calledUrl = "";
  const res = await client.authorizedFetch(
    "http://127.0.0.1:19720/api/transcripts",
    {
      method: "GET",
      headers: {
        Authorization: "Bearer attacker",
        "Content-Type": "application/json",
      },
    },
    {
      token: SECRET,
      fetchImpl: async (url, init) => {
        calledUrl = String(url);
        seen = /** @type {Record<string, string>} */ (init?.headers);
        return new Response("[]", { status: 200 });
      },
    }
  );
  assert.equal(res.status, 200);
  assert.equal(calledUrl, "http://127.0.0.1:19720/api/transcripts");
  assert.equal(calledUrl.includes(SECRET), false);
  assert.deepEqual(seen, {
    "Content-Type": "application/json",
    ...localAuthHeadersFromToken(SECRET),
  });
  assert.equal(seen?.Authorization, `Bearer ${SECRET}`);
});

test("delete without confirm does not get or delete", async () => {
  for (const confirm of [undefined, false, "true", 1, null]) {
    let gets = 0;
    let deletes = 0;
    const result = await client.guardedDeleteTranscript({
      id: "abc",
      confirm,
      getTranscript: async () => {
        gets += 1;
        return { title: "Talk" };
      },
      deleteTranscript: async () => {
        deletes += 1;
      },
    });
    assert.equal(result.deleted, false);
    assert.match(result.message || "", /confirm set to true/);
    assert.equal(gets, 0);
    assert.equal(deletes, 0);
  }
});

test("delete with confirm true calls get then delete", async () => {
  /** @type {string[]} */
  const order = [];
  const result = await client.guardedDeleteTranscript({
    id: "abc",
    confirm: true,
    getTranscript: async (id) => {
      order.push(`get:${id}`);
      return { title: "Talk" };
    },
    deleteTranscript: async (id) => {
      order.push(`delete:${id}`);
    },
  });
  assert.deepEqual(result, { deleted: true, title: "Talk" });
  assert.deepEqual(order, ["get:abc", "delete:abc"]);
});

test("confirmed delete still does not reach fetch when the token is missing", async () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(
    () =>
      client.guardedDeleteTranscript({
        id: "abc",
        confirm: true,
        getTranscript: () =>
          client.authorizedFetch(
            "http://127.0.0.1:19720/api/transcripts/abc",
            { method: "GET" },
            { token: null, fetchImpl }
          ),
        deleteTranscript: () =>
          client.authorizedFetch(
            "http://127.0.0.1:19720/api/transcripts/abc",
            { method: "DELETE" },
            { token: null, fetchImpl }
          ),
      })
  );
  assert.equal(fetches, 0);
});

test("MCP client source does not mint a local API token", () => {
  const src = readFileSync(path.join(repoRoot, "lib/local-api-fetch.js"), "utf8");
  assert.doesNotMatch(src, /ensureLocalApiToken/);
  assert.doesNotMatch(src, /writeFileSync|mkdirSync|generateToken|writeTokenFile/);
  assert.match(src, /readFileSync/);
});

test("MCP tool source has no apiKey and delete is confirm-gated", () => {
  const src = readFileSync(
    path.join(repoRoot, "mcp-server/src/index.ts"),
    "utf8"
  );
  assert.doesNotMatch(src, /apiKey/);
  assert.match(src, /authorizedFetch/);
  assert.match(src, /guardedDeleteTranscript/);
  assert.doesNotMatch(src, /\bfetch\s*\(/);

  const deleteAt = src.indexOf('"delete_transcript"');
  assert.ok(deleteAt > 0);
  const deleteChunk = src.slice(deleteAt, deleteAt + 1800);
  assert.match(deleteChunk, /confirm:/);
  assert.match(deleteChunk, /guardedDeleteTranscript/);
  const guardAt = deleteChunk.indexOf("guardedDeleteTranscript");
  const methodAt = deleteChunk.indexOf('method: "DELETE"');
  assert.ok(guardAt > 0 && methodAt > guardAt);

  const summarizeAt = src.indexOf('"summarize_transcript"');
  assert.ok(summarizeAt > 0);
  const summarizeChunk = src.slice(summarizeAt, summarizeAt + 1400);
  assert.match(summarizeChunk, /transcriptId/);
  assert.doesNotMatch(summarizeChunk, /apiKey/);
  assert.doesNotMatch(summarizeChunk, /provider/);
});
