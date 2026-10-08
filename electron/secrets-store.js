/**
 * Electron safeStorage-backed secrets (macOS Keychain).
 * Ciphertext may live on disk; plaintext keys never do.
 */

const fs = require("fs");
const path = require("path");
const { getStateDir } = require("../lib/local-api-token.js");

const FILE_NAME = "electron-secrets.json";
const VALID_LLM = new Set(["anthropic", "openai"]);

function secretsPath() {
  return path.join(getStateDir(), FILE_NAME);
}

function readFile() {
  try {
    const raw = fs.readFileSync(secretsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeFile(data) {
  const dir = getStateDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(secretsPath(), JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

class SecretsStore {
  constructor(options = {}) {
    this.safeStorage = options.safeStorage || null;
    this.onChange = options.onChange || null;
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
    if (patch.llmApiKey !== undefined && !isMasked(patch.llmApiKey)) {
      stored.llmApiKeyEnc = patch.llmApiKey
        ? this._encrypt(patch.llmApiKey)
        : "";
    } else if (!stored.llmApiKeyEnc && current.llmApiKey) {
      stored.llmApiKeyEnc = this._encrypt(current.llmApiKey);
    }
    if (patch.notionToken !== undefined && !isMasked(patch.notionToken)) {
      stored.notionTokenEnc = patch.notionToken
        ? this._encrypt(patch.notionToken)
        : "";
    }
    if (patch.notionDatabaseId !== undefined) {
      stored.notionDatabaseId = String(patch.notionDatabaseId || "");
    }
    writeFile(stored);
    if (typeof this.onChange === "function") {
      this.onChange(this.envForSpawn());
    }
    return this.getPublic();
  }

  envForSpawn() {
    const plain = this.getPlain();
    const env = {};
    if (plain.llmProvider) env.LLM_PROVIDER = plain.llmProvider;
    if (plain.llmProvider === "anthropic" && plain.llmApiKey) {
      env.ANTHROPIC_API_KEY = plain.llmApiKey;
    }
    if (plain.llmProvider === "openai" && plain.llmApiKey) {
      env.OPENAI_API_KEY = plain.llmApiKey;
    }
    if (plain.notionToken) env.NOTION_TOKEN = plain.notionToken;
    if (plain.notionDatabaseId) env.NOTION_DATABASE_ID = plain.notionDatabaseId;
    return env;
  }
}

function maskKey(value) {
  const s = String(value);
  if (s.length <= 4) return "••••";
  return `••••${s.slice(-4)}`;
}

function isMasked(value) {
  return typeof value === "string" && (value.includes("•") || value.includes("*"));
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
  VALID_LLM,
};
