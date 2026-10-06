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
 * Requires ciphertext plus the master key. Plaintext rows are refused.
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
 * @param {Array<{ id: string, apiKey: string }>} providers
 * @param {{ key: string, value: string } | null} setting
 * @returns {{ plaintextProviders: number, plaintextSettings: number }}
 */
function countPlaintextSecrets(providers, setting) {
  let plaintextProviders = 0;
  for (const row of providers) {
    if (row.apiKey && !isEncryptedSecret(row.apiKey)) plaintextProviders += 1;
  }
  const plaintextSettings =
    setting?.value && !isEncryptedSecret(setting.value) ? 1 : 0;
  return { plaintextProviders, plaintextSettings };
}

/**
 * Warn when plaintext provider/setting secrets remain and cannot be migrated.
 * Does not log secret values.
 * @param {number} plaintextProviders
 * @param {number} plaintextSettings
 * @returns {boolean}
 */
function warnIfPlaintextSecretsRemain(plaintextProviders, plaintextSettings) {
  if (plaintextProviders === 0 && plaintextSettings === 0) return false;
  console.warn(
    `[secrets] ${ENV_NAME} is not set. ${plaintextProviders} provider key(s) and ${plaintextSettings} setting key(s) are still plaintext in the database and will not be used. ` +
      `Set ${ENV_NAME} (openssl rand -hex 32) and restart, or run npm run migrate:secrets.`
  );
  return true;
}

/**
 * Migrate plaintext ProviderConfig.apiKey and groq_api_key Setting rows to ciphertext.
 * When TRANSCRIBER_SECRETS_KEY is unset, plaintext rows are left in place, warned about,
 * and refused by decrypt (they are not used).
 * Env-only keys (OPENROUTER_API_KEY, WHISPER_CLOUD_API_KEY) are not read or written here.
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
 * @returns {Promise<{
 *   migratedProviders: number,
 *   migratedSettings: number,
 *   skipped: boolean,
 *   reason?: string,
 *   plaintextProviders: number,
 *   plaintextSettings: number,
 *   warned: boolean,
 * }>}
 */
async function migratePlaintextSecrets(prisma) {
  let key = null;
  /** @type {string | null} */
  let keyError = null;
  try {
    key = getSecretsKeyOrNull();
  } catch (err) {
    keyError = err instanceof Error ? err.message : String(err);
    console.error(`[secrets] ${keyError}`);
  }

  const providers = await prisma.providerConfig.findMany();
  const setting = await prisma.setting.findUnique({
    where: { key: "groq_api_key" },
  });
  const { plaintextProviders, plaintextSettings } = countPlaintextSecrets(
    providers,
    setting
  );

  if (!key) {
    const warned = warnIfPlaintextSecretsRemain(
      plaintextProviders,
      plaintextSettings
    );
    return {
      migratedProviders: 0,
      migratedSettings: 0,
      skipped: true,
      plaintextProviders,
      plaintextSettings,
      warned,
      reason:
        keyError ||
        `${ENV_NAME} not set — plaintext database secrets are not used`,
    };
  }

  let migratedProviders = 0;
  let migratedSettings = 0;

  for (const row of providers) {
    if (!row.apiKey || isEncryptedSecret(row.apiKey)) continue;
    const encrypted = encryptSecret(row.apiKey, key);
    await prisma.providerConfig.update({
      where: { id: row.id },
      data: { apiKey: encrypted },
    });
    migratedProviders += 1;
  }

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

  return {
    migratedProviders,
    migratedSettings,
    skipped: false,
    plaintextProviders: 0,
    plaintextSettings: 0,
    warned: false,
  };
}

/**
 * Boot hook: migrate plaintext → ciphertext when the master key is present.
 * Warns when plaintext rows remain and no master key is configured.
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
      plaintextProviders: 0,
      plaintextSettings: 0,
      warned: false,
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
