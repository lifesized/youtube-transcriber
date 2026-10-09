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

  _decryptField(stored, encKey, label) {
    if (!stored[encKey]) return "";
    try {
      return this._decrypt(stored[encKey]);
    } catch (error) {
      console.error(`Failed to decrypt ${label}:`, error.message);
      return "";
    }
  }

  getSlackPlain() {
    const stored = readFile();
    return {
      botToken: this._decryptField(stored, "slackBotTokenEnc", "Slack bot token"),
      appToken: this._decryptField(stored, "slackAppTokenEnc", "Slack app token"),
      enabled: stored.slackEnabled === true,
      teamId: typeof stored.slackTeamId === "string" ? stored.slackTeamId : "",
      teamName: typeof stored.slackTeamName === "string" ? stored.slackTeamName : "",
      botUserId: typeof stored.slackBotUserId === "string" ? stored.slackBotUserId : "",
      botName: typeof stored.slackBotName === "string" ? stored.slackBotName : "",
      channelAllowlist: Array.isArray(stored.slackChannelAllowlist)
        ? stored.slackChannelAllowlist.filter((id) => typeof id === "string")
        : [],
      watchFeeds: Array.isArray(stored.slackWatchFeeds)
        ? stored.slackWatchFeeds.filter((feed) => feed && typeof feed === "object" && typeof feed.url === "string")
        : [],
      digestChannel: typeof stored.slackDigestChannel === "string" ? stored.slackDigestChannel : "",
    };
  }

  getSlackPublic() {
    const plain = this.getSlackPlain();
    return {
      hasBotToken: Boolean(plain.botToken),
      botTokenMasked: plain.botToken ? maskSlackToken(plain.botToken) : "",
      hasAppToken: Boolean(plain.appToken),
      appTokenMasked: plain.appToken ? maskSlackToken(plain.appToken) : "",
      enabled: plain.enabled,
      teamId: plain.teamId,
      teamName: plain.teamName,
      botName: plain.botName,
      channelAllowlist: plain.channelAllowlist,
      watchFeeds: plain.watchFeeds,
      digestChannel: plain.digestChannel,
    };
  }

  setSlack(patch) {
    const stored = readFile();
    const current = this.getSlackPlain();
    if (patch.botToken !== undefined && !isMasked(patch.botToken, maskKey(current.botToken))) {
      stored.slackBotTokenEnc = patch.botToken ? this._encrypt(patch.botToken) : "";
    }
    if (patch.appToken !== undefined && !isMasked(patch.appToken, maskKey(current.appToken))) {
      stored.slackAppTokenEnc = patch.appToken ? this._encrypt(patch.appToken) : "";
    }
    if (patch.enabled !== undefined) stored.slackEnabled = Boolean(patch.enabled);
    if (patch.teamId !== undefined) stored.slackTeamId = String(patch.teamId || "");
    if (patch.teamName !== undefined) stored.slackTeamName = String(patch.teamName || "");
    if (patch.botUserId !== undefined) stored.slackBotUserId = String(patch.botUserId || "");
    if (patch.botName !== undefined) stored.slackBotName = String(patch.botName || "");
    if (patch.channelAllowlist !== undefined) {
      stored.slackChannelAllowlist = Array.isArray(patch.channelAllowlist)
        ? patch.channelAllowlist.map(String)
        : [];
    }
    if (patch.watchFeeds !== undefined) {
      stored.slackWatchFeeds = Array.isArray(patch.watchFeeds)
        ? patch.watchFeeds
            .filter((feed) => feed && typeof feed.url === "string")
            .map((feed) => ({
              kind: String(feed.kind || ""),
              id: String(feed.id || ""),
              url: String(feed.url),
            }))
            .slice(0, 10)
        : [];
    }
    if (patch.digestChannel !== undefined) {
      stored.slackDigestChannel = String(patch.digestChannel || "");
    }
    writeFile(stored);
    return this.getSlackPublic();
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

function maskSlackToken(value) {
  const s = String(value);
  if (s.length <= 4) return "saved ••••";
  return `saved ••••${s.slice(-4)}`;
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
  maskSlackToken,
  isMasked,
  VALID_LLM,
};
