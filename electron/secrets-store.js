/**
 * Electron safeStorage-backed secrets (macOS Keychain).
 * Ciphertext may live on disk; plaintext keys never do.
 */

const fs = require("fs");
const path = require("path");
const { getStateDir } = require("../lib/local-api-token.js");
const { writeFileAtomic } = require("./utils.js");

const FILE_NAME = "electron-secrets.json";
const VALID_LLM = new Set(["anthropic", "openai"]);

function secretsPath() {
  return path.join(getStateDir(), FILE_NAME);
}

function readFile() {
  const filePath = secretsPath();
  if (!fs.existsSync(filePath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error("electron-secrets.json is corrupt; refusing to parse:", error.message);
    const err = new Error("electron-secrets.json is corrupt");
    err.code = "CORRUPT_SECRETS";
    throw err;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("electron-secrets.json is corrupt; refusing to parse");
    const err = new Error("electron-secrets.json is corrupt");
    err.code = "CORRUPT_SECRETS";
    throw err;
  }
  return parsed;
}

function writeFile(data) {
  writeFileAtomic(secretsPath(), JSON.stringify(data, null, 2) + "\n", 0o600);
}

class SecretsStore {
  constructor(options = {}) {
    this.safeStorage = options.safeStorage || null;
  }

  _encrypt(plain) {
    if (!plain) return "";
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage is not available");
    }
    return this.safeStorage.encryptString(plain).toString("base64");
  }

  _decrypt(enc) {
    if (!enc) return "";
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage is not available");
    }
    return this.safeStorage.decryptString(Buffer.from(enc, "base64"));
  }

  getPlain() {
    const stored = readFile();
    const llmProvider = VALID_LLM.has(stored.llmProvider)
      ? stored.llmProvider
      : "";
    let llmApiKey = "";
    let notionToken = "";
    try {
      llmApiKey = stored.llmApiKeyEnc ? this._decrypt(stored.llmApiKeyEnc) : "";
    } catch (error) {
      console.error("Failed to decrypt LLM API key:", error.message);
    }
    try {
      notionToken = stored.notionTokenEnc
        ? this._decrypt(stored.notionTokenEnc)
        : "";
    } catch (error) {
      console.error("Failed to decrypt Notion token:", error.message);
    }
    return {
      llmProvider,
      llmApiKey,
      notionToken,
      notionDatabaseId:
        typeof stored.notionDatabaseId === "string"
          ? stored.notionDatabaseId
          : "",
    };
  }

  getPublic() {
    const plain = this.getPlain();
    return {
      llmProvider: plain.llmProvider,
      hasLlmKey: Boolean(plain.llmApiKey),
      llmKeyMasked: plain.llmApiKey ? maskKey(plain.llmApiKey) : "",
      hasNotionToken: Boolean(plain.notionToken),
      notionTokenMasked: plain.notionToken ? maskKey(plain.notionToken) : "",
      notionDatabaseId: plain.notionDatabaseId,
    };
  }

  setPlain(patch) {
    const stored = readFile();
    const current = this.getPlain();
    if (patch.llmProvider !== undefined) {
      if (patch.llmProvider && !VALID_LLM.has(patch.llmProvider)) {
        throw new Error("Invalid LLM provider");
      }
      stored.llmProvider = patch.llmProvider || "";
    }
    if (
      patch.llmApiKey !== undefined &&
      !isMasked(patch.llmApiKey, maskKey(current.llmApiKey))
    ) {
      stored.llmApiKeyEnc = patch.llmApiKey
        ? this._encrypt(patch.llmApiKey)
        : "";
    } else if (!stored.llmApiKeyEnc && current.llmApiKey) {
      stored.llmApiKeyEnc = this._encrypt(current.llmApiKey);
    }
    if (
      patch.notionToken !== undefined &&
      !isMasked(patch.notionToken, maskKey(current.notionToken))
    ) {
      stored.notionTokenEnc = patch.notionToken
        ? this._encrypt(patch.notionToken)
        : "";
    }
    if (patch.notionDatabaseId !== undefined) {
      stored.notionDatabaseId = String(patch.notionDatabaseId || "");
    }
    writeFile(stored);
    return this.getPublic();
  }
}

function maskKey(value) {
  const s = String(value);
  if (s.length <= 4) return "••••";
  return `••••${s.slice(-4)}`;
}

function isMasked(value, maskedPlaceholder) {
  return (
    typeof value === "string" &&
    typeof maskedPlaceholder === "string" &&
    maskedPlaceholder.length > 0 &&
    value === maskedPlaceholder
  );
}

function attachSecretsIpc(child, store) {
  if (!child || typeof child.on !== "function") return;
  child.on("message", (msg) => {
    if (!msg || !msg.requestId) return;
    try {
      if (msg.type === "secrets-get") {
        child.send({
          type: "secrets-get-result",
          requestId: msg.requestId,
          payload: store.getPlain(),
        });
      } else if (msg.type === "secrets-set") {
        const publicView = store.setPlain(msg.payload || {});
        child.send({
          type: "secrets-set-result",
          requestId: msg.requestId,
          payload: publicView,
        });
      }
    } catch (error) {
      child.send({
        type: `${msg.type}-result`,
        requestId: msg.requestId,
        error: error.message,
      });
    }
  });
}

module.exports = {
  SecretsStore,
  attachSecretsIpc,
  maskKey,
  isMasked,
  VALID_LLM,
};
