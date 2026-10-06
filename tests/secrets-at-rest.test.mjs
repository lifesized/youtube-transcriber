import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cryptoMod = require(path.join(repoRoot, "lib/secrets-crypto.js"));
const store = require(path.join(repoRoot, "lib/secrets-store.js"));

const ENV = cryptoMod.ENV_NAME;

async function withKey(hex, fn) {
  const prev = process.env[ENV];
  process.env[ENV] = hex;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  }
}

test("encrypt/decrypt roundtrip", async () => {
  const keyHex = cryptoMod.generateSecretsKeyHex();
  await withKey(keyHex, () => {
    const plain = "sk-or-v1-test-secret-key-abcdef";
    const enc = cryptoMod.encryptSecret(plain);
    assert.ok(cryptoMod.isEncryptedSecret(enc));
    assert.notEqual(enc, plain);
    assert.equal(cryptoMod.decryptSecret(enc), plain);
    // encrypting twice yields different ciphertext (random IV)
    const enc2 = cryptoMod.encryptSecret(plain);
    assert.notEqual(enc, enc2);
    assert.equal(cryptoMod.decryptSecret(enc2), plain);
  });
});

test("decrypt fails closed without master key", async () => {
  const keyHex = cryptoMod.generateSecretsKeyHex();
  const enc = await withKey(keyHex, () =>
    cryptoMod.encryptSecret("gsk_test_key_123456")
  );
  const prev = process.env[ENV];
  delete process.env[ENV];
  try {
    assert.throws(
      () => cryptoMod.decryptSecret(enc),
      (err) =>
        err instanceof cryptoMod.SecretsKeyError &&
        /TRANSCRIBER_SECRETS_KEY is required/i.test(err.message)
    );
  } finally {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  }
});

test("wrong master key fails closed", async () => {
  const keyA = cryptoMod.generateSecretsKeyHex();
  const keyB = cryptoMod.generateSecretsKeyHex();
  const enc = await withKey(keyA, () => cryptoMod.encryptSecret("sk-secret"));
  await withKey(keyB, () => {
    assert.throws(
      () => cryptoMod.decryptSecret(enc),
      (err) => err instanceof cryptoMod.SecretsKeyError
    );
  });
});

test("maskStoredSecret never returns plaintext", async () => {
  const keyHex = cryptoMod.generateSecretsKeyHex();
  const plain = "sk-or-v1-abcdefghijklmnop";
  const enc = await withKey(keyHex, () => cryptoMod.encryptSecret(plain));
  const masked = await withKey(keyHex, () => cryptoMod.maskStoredSecret(enc));
  assert.ok(!masked.includes("sk-or"));
  assert.ok(masked.endsWith(plain.slice(-4)));
  assert.match(masked, /^\*+[a-z0-9]{4}$/i);
  const prev = process.env[ENV];
  delete process.env[ENV];
  try {
    assert.equal(cryptoMod.maskStoredSecret(enc), "••••••••");
  } finally {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  }
});

test("plaintext passthrough until migration; write requires master key", () => {
  const prev = process.env[ENV];
  delete process.env[ENV];
  try {
    assert.equal(cryptoMod.decryptSecret("plain-gsk-key"), "plain-gsk-key");
    assert.throws(
      () => store.encryptApiKeyForStorage("plain-gsk-key"),
      (err) => err instanceof cryptoMod.SecretsKeyError
    );
  } finally {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  }
});

test("migratePlaintextSecrets encrypts provider + groq_api_key rows", async () => {
  const keyHex = cryptoMod.generateSecretsKeyHex();
  /** @type {Array<{ id: string, apiKey: string }>} */
  const providers = [
    { id: "p1", apiKey: "sk-openrouter-plain" },
    { id: "p2", apiKey: "yttenc:v1:already:encrypted:value" },
  ];
  /** @type {{ key: string, value: string } | null} */
  let setting = { key: "groq_api_key", value: "gsk_plain_legacy" };

  const fakePrisma = {
    providerConfig: {
      findMany: async () => providers.map((p) => ({ ...p })),
      update: async ({ where, data }) => {
        const row = providers.find((p) => p.id === where.id);
        assert.ok(row);
        row.apiKey = data.apiKey;
      },
    },
    setting: {
      findUnique: async () => (setting ? { ...setting } : null),
      update: async ({ data }) => {
        assert.ok(setting);
        setting.value = data.value;
      },
    },
  };

  const prev = process.env[ENV];
  process.env[ENV] = keyHex;
  try {
    const result = await store.migratePlaintextSecrets(fakePrisma);
    assert.equal(result.skipped, false);
    assert.equal(result.migratedProviders, 1);
    assert.equal(result.migratedSettings, 1);
    assert.ok(cryptoMod.isEncryptedSecret(providers[0].apiKey));
    assert.equal(cryptoMod.decryptSecret(providers[0].apiKey), "sk-openrouter-plain");
    assert.equal(providers[1].apiKey, "yttenc:v1:already:encrypted:value");
    assert.ok(setting && cryptoMod.isEncryptedSecret(setting.value));
    assert.equal(cryptoMod.decryptSecret(setting.value), "gsk_plain_legacy");
  } finally {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  }
});

test("settings/providers routes encrypt on write and mask on GET", () => {
  for (const rel of [
    "app/api/settings/route.ts",
    "app/api/settings/providers/route.ts",
  ]) {
    const src = readFileSync(path.join(repoRoot, rel), "utf8");
    assert.match(src, /encryptApiKeyForStorage/);
    assert.match(src, /maskApiKeyForResponse/);
    assert.doesNotMatch(src, /apiKey: maskApiKey\(p\.apiKey\)/);
  }
  for (const rel of [
    "lib/providers.ts",
    "lib/whisper-cloud.ts",
    "lib/local-summary.ts",
    "app/api/settings/providers/[id]/test/route.ts",
    "app/api/settings/test-groq/route.ts",
  ]) {
    const src = readFileSync(path.join(repoRoot, rel), "utf8");
    assert.match(src, /decryptApiKeyForUse/);
  }
  const instr = readFileSync(path.join(repoRoot, "instrumentation.ts"), "utf8");
  assert.match(instr, /ensureSecretsMigrated/);
});
