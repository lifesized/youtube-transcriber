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

test("isMaskedPlaceholder is exact equality with the GET placeholder", async () => {
  const keyHex = cryptoMod.generateSecretsKeyHex();
  const plain = "sk-or-v1-abcdefghijklmnop";
  const enc = await withKey(keyHex, () => cryptoMod.encryptSecret(plain));
  const masked = await withKey(keyHex, () => cryptoMod.maskStoredSecret(enc));
  assert.equal(cryptoMod.isMaskedPlaceholder(masked, masked), true);
  assert.equal(cryptoMod.isMaskedPlaceholder(plain, masked), false);
  assert.equal(cryptoMod.isMaskedPlaceholder("********", masked), false);
  assert.equal(cryptoMod.isMaskedPlaceholder("••••abcd", masked), false);
  assert.equal(cryptoMod.isMaskedPlaceholder(masked), false);
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

test("plaintext rows are rejected when the master key is set", async () => {
  const keyHex = cryptoMod.generateSecretsKeyHex();
  await withKey(keyHex, () => {
    assert.throws(
      () => cryptoMod.decryptSecret("plain-gsk-key"),
      (err) =>
        err instanceof cryptoMod.SecretsKeyError &&
        /plaintext/i.test(err.message) &&
        !err.message.includes("plain-gsk-key")
    );
    assert.throws(
      () => store.decryptApiKeyForUse("plain-gsk-key"),
      (err) => err instanceof cryptoMod.SecretsKeyError && /plaintext/i.test(err.message)
    );
    const enc = cryptoMod.encryptSecret("plain-gsk-key");
    assert.equal(cryptoMod.decryptSecret(enc), "plain-gsk-key");
  });
});

test("plaintext rows are rejected when the master key is unset", () => {
  const prev = process.env[ENV];
  delete process.env[ENV];
  try {
    assert.throws(
      () => cryptoMod.decryptSecret("plain-gsk-key"),
      (err) =>
        err instanceof cryptoMod.SecretsKeyError && /plaintext/i.test(err.message)
    );
    assert.throws(
      () => store.decryptApiKeyForUse("plain-gsk-key"),
      (err) => err instanceof cryptoMod.SecretsKeyError
    );
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
    assert.equal(result.warned, false);
    assert.equal(result.plaintextProviders, 0);
    assert.equal(result.plaintextSettings, 0);
  } finally {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  }
});

test("boot warns when plaintext remains and no master key is configured", async () => {
  const prev = process.env[ENV];
  delete process.env[ENV];
  /** @type {string[]} */
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
  };
  /** @type {Array<{ id: string, apiKey: string }>} */
  const providers = [{ id: "p1", apiKey: "sk-openrouter-plain" }];
  const setting = { key: "groq_api_key", value: "gsk_plain_legacy" };
  let providerUpdates = 0;
  let settingUpdates = 0;
  const fakePrisma = {
    providerConfig: {
      findMany: async () => providers.map((p) => ({ ...p })),
      update: async () => {
        providerUpdates += 1;
      },
    },
    setting: {
      findUnique: async () => ({ ...setting }),
      update: async () => {
        settingUpdates += 1;
      },
    },
  };
  try {
    const result = await store.ensureSecretsMigrated(async () => fakePrisma);
    assert.equal(result.skipped, true);
    assert.equal(result.warned, true);
    assert.equal(result.plaintextProviders, 1);
    assert.equal(result.plaintextSettings, 1);
    assert.equal(providerUpdates, 0);
    assert.equal(settingUpdates, 0);
    assert.equal(providers[0].apiKey, "sk-openrouter-plain");
    assert.equal(setting.value, "gsk_plain_legacy");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /TRANSCRIBER_SECRETS_KEY is not set/);
    assert.match(warnings[0], /1 provider key\(s\) and 1 setting key\(s\)/);
    assert.match(warnings[0], /will not be used/);
    assert.equal(warnings[0].includes("sk-openrouter-plain"), false);
    assert.equal(warnings[0].includes("gsk_plain_legacy"), false);
  } finally {
    console.warn = originalWarn;
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  }
});

test("boot stays quiet when no plaintext secrets remain and no master key is set", async () => {
  const prev = process.env[ENV];
  delete process.env[ENV];
  /** @type {string[]} */
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
  };
  const fakePrisma = {
    providerConfig: {
      findMany: async () => [
        { id: "p2", apiKey: "yttenc:v1:already:encrypted:value" },
      ],
      update: async () => {
        throw new Error("should not write");
      },
    },
    setting: {
      findUnique: async () => null,
      update: async () => {
        throw new Error("should not write");
      },
    },
  };
  try {
    const result = await store.ensureSecretsMigrated(async () => fakePrisma);
    assert.equal(result.skipped, true);
    assert.equal(result.warned, false);
    assert.equal(result.plaintextProviders, 0);
    assert.equal(result.plaintextSettings, 0);
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = originalWarn;
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  }
});

test("env-only keys are not written to the database", async () => {
  const prevKey = process.env[ENV];
  const prevOpenRouter = process.env.OPENROUTER_API_KEY;
  const prevWhisper = process.env.WHISPER_CLOUD_API_KEY;
  delete process.env[ENV];
  process.env.OPENROUTER_API_KEY = "sk-or-env-only-not-for-db";
  process.env.WHISPER_CLOUD_API_KEY = "gsk-env-only-not-for-db";

  /** @type {unknown[]} */
  const writes = [];
  const fakePrisma = {
    providerConfig: {
      findMany: async () => [],
      update: async (args) => {
        writes.push(args);
      },
    },
    setting: {
      findUnique: async ({ where }) => {
        assert.equal(where.key, "groq_api_key");
        return null;
      },
      update: async (args) => {
        writes.push(args);
      },
    },
  };

  try {
    const result = await store.migratePlaintextSecrets(fakePrisma);
    assert.equal(result.skipped, true);
    assert.equal(result.warned, false);
    assert.equal(writes.length, 0);
    assert.equal(process.env.OPENROUTER_API_KEY, "sk-or-env-only-not-for-db");
    assert.equal(process.env.WHISPER_CLOUD_API_KEY, "gsk-env-only-not-for-db");

    const storeSrc = readFileSync(path.join(repoRoot, "lib/secrets-store.js"), "utf8");
    assert.doesNotMatch(storeSrc, /process\.env\.OPENROUTER_API_KEY/);
    assert.doesNotMatch(storeSrc, /process\.env\.WHISPER_CLOUD_API_KEY/);

    const summary = readFileSync(path.join(repoRoot, "lib/local-summary.ts"), "utf8");
    assert.match(summary, /process\.env\.OPENROUTER_API_KEY/);
    assert.doesNotMatch(summary, /prisma\.(setting|providerConfig)\.(create|update|upsert)/);
    assert.doesNotMatch(
      summary,
      /OPENROUTER_API_KEY[\s\S]{0,400}prisma\.(setting|providerConfig)\.(create|update|upsert)/
    );

    const whisper = readFileSync(path.join(repoRoot, "lib/whisper-cloud.ts"), "utf8");
    assert.match(whisper, /process\.env\.WHISPER_CLOUD_API_KEY/);
    assert.doesNotMatch(
      whisper,
      /WHISPER_CLOUD_API_KEY[\s\S]{0,500}prisma\.(setting|providerConfig)\.(create|update|upsert)/
    );
    assert.doesNotMatch(
      whisper,
      /prisma\.(setting|providerConfig)\.(create|update|upsert)[\s\S]{0,500}WHISPER_CLOUD_API_KEY/
    );
  } finally {
    if (prevKey === undefined) delete process.env[ENV];
    else process.env[ENV] = prevKey;
    if (prevOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevOpenRouter;
    if (prevWhisper === undefined) delete process.env.WHISPER_CLOUD_API_KEY;
    else process.env.WHISPER_CLOUD_API_KEY = prevWhisper;
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
