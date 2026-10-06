import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = require(path.join(repoRoot, "lib/provider-url-policy.js"));

const BLOCKED = /private, link-local, or metadata/i;

test("known provider hosts are allowlisted and lookalikes are not", () => {
  for (const url of [
    "https://api.groq.com/openai/v1/models",
    "https://api.groq.com/openai/v1/audio/transcriptions",
    "https://openrouter.ai/api/v1/models",
    "https://openrouter.ai/api/v1/audio/transcriptions",
    "https://api.openai.com/v1/audio/transcriptions",
    "https://API.GROQ.COM/openai/v1/models",
    "https://openrouter.ai./api/v1/models",
  ]) {
    const hostname = new URL(url).hostname;
    assert.equal(policy.isKnownProviderHost(hostname), true, url);
    assert.equal(policy.assertSafeProviderUrl(url), null, url);
    assert.equal(policy.providerFetchRedirect(hostname), "follow", url);
  }

  for (const host of [
    "api.groq.com.evil.com",
    "evilapi.groq.com",
    "notopenrouter.ai",
    "openrouter.ai.evil.com",
    "api.openai.com.attacker.test",
  ]) {
    assert.equal(policy.isKnownProviderHost(host), false, host);
    assert.equal(policy.providerFetchRedirect(host), "manual", host);
  }
});

test("built-in endpoint constants stay on the known-host allowlist", () => {
  const sources = ["lib/providers.ts", "lib/whisper-cloud.ts"];
  const urls = [];
  for (const rel of sources) {
    const src = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const match of src.matchAll(/https:\/\/[a-z0-9.-]+\/[a-z0-9./_-]+/g)) {
      urls.push(match[0]);
    }
  }
  assert.ok(urls.length >= 4);
  for (const url of urls) {
    assert.equal(policy.isKnownProviderHost(new URL(url).hostname), true, url);
    assert.equal(policy.assertSafeProviderUrl(url), null, url);
  }
});

test("rejects non-http schemes and embedded credentials", () => {
  assert.match(policy.assertSafeProviderUrl("not a url"), /invalid base url/i);
  assert.match(policy.assertSafeProviderUrl("file:///etc/passwd"), /http or https/i);
  assert.match(policy.assertSafeProviderUrl("gopher://example.com"), /http or https/i);
  assert.match(
    policy.assertSafeProviderUrl("https://user:pass@example.com/v1"),
    /credentials/i
  );
  assert.match(
    policy.assertSafeProviderUrl("http://user@169.254.169.254/latest/meta-data/"),
    /credentials/i
  );
});

test("blocks private, loopback, link-local, and metadata IPv4 literals", () => {
  const blocked = [
    "http://10.0.0.1/v1",
    "http://10.255.255.255",
    "http://127.0.0.1",
    "http://127.1",
    "http://0.0.0.0",
    "http://0",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://192.168.1.20:11434/v1",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.170.2",
    "http://169.254.1.1",
    "http://100.64.0.1",
    "http://100.100.100.200",
    "http://2852039166",
    "http://0xA9FEA9FE",
    "http://0xa9.0xfe.0xa9.0xfe",
    "http://2130706433",
    "https://192.0.2.1",
    "https://224.0.0.1",
  ];
  for (const url of blocked) {
    assert.match(policy.assertSafeProviderUrl(url), BLOCKED, url);
  }

  assert.equal(policy.assertSafeProviderUrl("https://8.8.8.8/v1"), null);
  assert.equal(policy.assertSafeProviderUrl("https://1.1.1.1"), null);
  assert.equal(policy.assertSafeProviderUrl("http://172.15.255.255"), null);
  assert.equal(policy.assertSafeProviderUrl("http://11.0.0.1"), null);
  assert.equal(policy.isBlockedIpAddress("169.254.169.254"), true);
  assert.equal(policy.isBlockedIpAddress("8.8.8.8"), false);
});

test("blocks loopback, unique-local, link-local, and mapped metadata IPv6", () => {
  const blocked = [
    "http://[::1]/",
    "http://[::]",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://[fd00:ec2::254]/latest/meta-data/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.1.2.3]/",
    "http://[::7f00:1]/",
    "http://[ff02::1]/",
    "http://[fec0::1]/",
    "http://[64:ff9b::169.254.169.254]/",
  ];
  for (const url of blocked) {
    assert.match(policy.assertSafeProviderUrl(url), BLOCKED, url);
  }

  assert.equal(
    policy.assertSafeProviderUrl("https://[2001:4860:4860::8888]/"),
    null
  );
  assert.equal(policy.assertSafeProviderUrl("http://[64:ff9b::8.8.8.8]/"), null);
  assert.equal(policy.isBlockedIpAddress("::ffff:a9fe:a9fe"), true);
  assert.equal(policy.isBlockedIpAddress("fd00:ec2::254"), true);
  assert.equal(policy.isBlockedIpAddress("2001:4860:4860::8888"), false);
});

test("blocks cloud metadata and local-only hostnames", () => {
  const blocked = [
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://metadata.google.internal./",
    "http://metadata.goog/",
    "http://metadata/",
    "http://localhost/",
    "http://localhost:11434/v1",
    "http://foo.localhost/",
    "http://ollama.local/v1",
    "http://llm.internal/v1",
    "http://kubernetes.default.svc/",
  ];
  for (const url of blocked) {
    assert.match(policy.assertSafeProviderUrl(url), BLOCKED, url);
  }

  assert.equal(policy.assertSafeProviderUrl("https://example.com/v1"), null);
  assert.equal(policy.assertSafeProviderUrl("http://example.com:8443/v1"), null);
});

test("DNS resolution blocks private answers and fails closed", async () => {
  const publicLookup = async () => ["1.1.1.1", "2606:4700:4700::1111"];
  assert.equal(
    await policy.assertSafeProviderUrlResolved("https://llm.example/v1", {
      lookup: publicLookup,
    }),
    null
  );

  const privateCases = [
    ["169.254.169.254"],
    ["10.0.0.5"],
    ["127.0.0.1"],
    ["192.168.0.2"],
    ["fd00:ec2::254"],
    ["::1"],
    ["1.1.1.1", "169.254.169.254"],
  ];
  for (const addresses of privateCases) {
    const error = await policy.assertSafeProviderUrlResolved(
      "https://llm.example/v1/models",
      { lookup: async () => addresses }
    );
    assert.match(error, BLOCKED, addresses.join(","));
  }

  const unresolved = await policy.assertSafeProviderUrlResolved(
    "https://missing.example/v1",
    {
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
    }
  );
  assert.match(unresolved, /could not be resolved/i);

  const empty = await policy.assertSafeProviderUrlResolved(
    "https://missing.example/v1",
    { lookup: async () => [] }
  );
  assert.match(empty, /could not be resolved/i);
});

test("known-provider allowlist does not bypass a private DNS answer", async () => {
  let lookups = 0;
  const error = await policy.assertSafeProviderUrlResolved(
    "https://api.groq.com/openai/v1/models",
    {
      lookup: async (hostname) => {
        lookups += 1;
        assert.equal(hostname, "api.groq.com");
        return ["169.254.169.254"];
      },
    }
  );
  assert.match(error, BLOCKED);
  assert.equal(lookups, 1);

  const allowed = await policy.assertSafeProviderUrlResolved(
    "https://openrouter.ai/api/v1/models",
    { lookup: async () => ["104.18.0.1"] }
  );
  assert.equal(allowed, null);
});

test("literal metadata addresses skip DNS", async () => {
  let called = false;
  const error = await policy.assertSafeProviderUrlResolved(
    "http://169.254.169.254/latest/meta-data/",
    {
      lookup: async () => {
        called = true;
        return ["1.1.1.1"];
      },
    }
  );
  assert.match(error, BLOCKED);
  assert.equal(called, false);
});

test("provider fetch paths use the shared policy", () => {
  const providers = readFileSync(path.join(repoRoot, "lib/providers.ts"), "utf8");
  const cloud = readFileSync(path.join(repoRoot, "lib/whisper-cloud.ts"), "utf8");
  const save = readFileSync(
    path.join(repoRoot, "app/api/settings/providers/route.ts"),
    "utf8"
  );
  const testRoute = readFileSync(
    path.join(repoRoot, "app/api/settings/providers/[id]/test/route.ts"),
    "utf8"
  );

  assert.match(providers, /assertSafeProviderUrlResolved/);
  assert.match(providers, /providerFetchRedirect/);
  assert.match(cloud, /assertSafeProviderUrlResolved/);
  assert.match(cloud, /providerFetchRedirect/);
  assert.match(save, /assertSafeProviderUrl/);
  assert.match(testRoute, /testProviderConnection/);
});
