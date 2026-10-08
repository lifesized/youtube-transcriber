/**
 * Main-process side of extension pairing.
 * Shows one native confirm dialog and, on Allow, writes the extension ID
 * then rewrites native messaging manifests.
 */

const {
  PAIR_TYPE,
  PAIR_RESULT_TYPE,
  PAIR_EXPIRED_TYPE,
  PAIR_MESSAGE,
  pairingDetailText,
} = require("../lib/native-host-pair.js");

class PairingBridge {
  constructor(options = {}) {
    this.installer = options.installer;
    this.dialog = options.dialog;
    this.app = options.app;
    this.expiredIds = new Set();
  }

  attach(child) {
    if (!child || typeof child.on !== "function") return;
    child.on("message", (msg) => {
      void this._onMessage(child, msg);
    });
  }

  _electron() {
    return require("electron");
  }

  _dialogApi() {
    return this.dialog || this._electron().dialog;
  }

  _appApi() {
    return this.app || this._electron().app;
  }

  async _onMessage(child, msg) {
    if (!msg) return;
    if (msg.type === PAIR_EXPIRED_TYPE && msg.requestId) {
      this.expiredIds.add(msg.requestId);
      return;
    }
    if (msg.type !== PAIR_TYPE) return;
    let allowed = false;
    try {
      const app = this._appApi();
      if (app && typeof app.focus === "function") {
        app.focus({ steal: true });
      }
      const result = await this._dialogApi().showMessageBox({
        type: "question",
        buttons: ["Allow", "Don't allow"],
        defaultId: 1,
        cancelId: 1,
        message: PAIR_MESSAGE,
        detail: pairingDetailText(msg.extensionId),
      });
      if (this.expiredIds.has(msg.requestId)) {
        // Timed out in the server. A late Allow must not write the ID.
        return;
      }
      allowed = result.response === 0;
      if (allowed && this.installer) {
        this.installer.appendExtensionId(msg.extensionId);
        await this.installer.install();
      }
    } catch (error) {
      console.error("Pairing dialog failed:", error);
      allowed = false;
    }
    if (this.expiredIds.has(msg.requestId)) {
      return;
    }
    if (typeof child.send === "function") {
      child.send({
        type: PAIR_RESULT_TYPE,
        requestId: msg.requestId,
        allowed,
      });
    }
  }
}

module.exports = PairingBridge;
module.exports.PAIR_MESSAGE = PAIR_MESSAGE;
