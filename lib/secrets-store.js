"use strict";

/**
 * Encrypt/decrypt helpers for ProviderConfig.apiKey and Setting groq_api_key (YTT-437).
 */

const {
  ENV_NAME,
  SecretsKeyError,
  isEncryptedSecret,
  getSecretsKeyOrNull,
  requireSecretsKey,
  encryptSecret,
  decryptSecret,
  maskStoredSecret,
  isMaskedPlaceholder,
} = require("./secrets-crypto.js");

/**
 * Prepare a user-supplied API key for SQLite write (always encrypt).
 * @param {string} plaintext
 * @returns {string}
 */
function encryptApiKeyForStorage(plaintext) {
  const trimmed = typeof plaintext === "string" ? plaintext.trim() : "";
  if (!trimmed) {
    throw new SecretsKeyError("API key is required");
  }
  if (isMaskedPlaceholder(trimmed)) {
    throw new SecretsKeyError("Refusing to store a masked API key placeholder");
  }
  requireSecretsKey();
  return encryptSecret(trimmed);
}

/**
 * Decrypt a DB-stored API key for server-side provider calls.
 * Plaintext rows still work until migration; ciphertext fails closed without the master key.
 * @param {string} stored
 * @returns {string}
 */
function decryptApiKeyForUse(stored) {
  const value = typeof stored === "string" ? stored.trim() : "";
  if (!value) {
    throw new SecretsKeyError("No API key stored");
  }
  return decryptSecret(value).trim();
}

/**
 * @param {string} stored
 * @returns {string}
 */
function maskApiKeyForResponse(stored) {
  return maskStoredSecret(stored);
}

/**
 * Migrate plaintext ProviderConfig.apiKey and groq_api_key Setting rows to ciphertext.
 * No-op when TRANSCRIBER_SECRETS_KEY is unset.
 *
 * @param {{
 *   providerConfig: {
 *     findMany: (args?: object) => Promise<Array<{ id: string, apiKey: string }>>,
 *     update: (args: object) => Promise<unknown>,
 *   },
 *   setting: {
 *     findUnique: (args: object) => Promise<{ key: string, value: string } | null>,
 *     update: (args: object) => Promise<unknown>,
 *   },
 * }} prisma
 * @returns {Promise<{ migratedProviders: number, migratedSettings: number, skipped: boolean, reason?: string }>}
 */
async function migratePlaintextSecrets(prisma) {
  let key;
  try {
    key = getSecretsKeyOrNull();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[secrets] ${message}`);
    return { migratedProviders: 0, migratedSettings: 0, skipped: true, reason: message };
  }
  if (!key) {
    return {
      migratedProviders: 0,
      migratedSettings: 0,
      skipped: true,
      reason: `${ENV_NAME} not set — plaintext secrets left unchanged`,
    };
  }

  let migratedProviders = 0;
  let migratedSettings = 0;

  const providers = await prisma.providerConfig.findMany();
  for (const row of providers) {
    if (!row.apiKey || isEncryptedSecret(row.apiKey)) continue;
    const encrypted = encryptSecret(row.apiKey, key);
    await prisma.providerConfig.update({
      where: { id: row.id },
      data: { apiKey: encrypted },
    });
    migratedProviders += 1;
  }

  const setting = await prisma.setting.findUnique({
    where: { key: "groq_api_key" },
  });
  if (setting?.value && !isEncryptedSecret(setting.value)) {
    const encrypted = encryptSecret(setting.value, key);
    await prisma.setting.update({
      where: { key: "groq_api_key" },
      data: { value: encrypted },
    });
    migratedSettings += 1;
  }

  if (migratedProviders > 0 || migratedSettings > 0) {
    console.log(
      `[secrets] Migrated ${migratedProviders} provider key(s) and ${migratedSettings} setting key(s) to ciphertext`
    );
  }

  return { migratedProviders, migratedSettings, skipped: false };
}

/**
 * Boot hook: migrate plaintext → ciphertext when the master key is present.
 * @param {() => Promise<{ providerConfig: object, setting: object }>} getPrisma
 */
async function ensureSecretsMigrated(getPrisma) {
  try {
    const prisma = await getPrisma();
    return await migratePlaintextSecrets(prisma);
  } catch (err) {
    console.error(
      "[secrets] Migration failed:",
      err instanceof Error ? err.message : err
    );
    return {
      migratedProviders: 0,
      migratedSettings: 0,
      skipped: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

module.exports = {
  encryptApiKeyForStorage,
  decryptApiKeyForUse,
  maskApiKeyForResponse,
  migratePlaintextSecrets,
  ensureSecretsMigrated,
  isMaskedPlaceholder,
  SecretsKeyError,
  ENV_NAME,
};
