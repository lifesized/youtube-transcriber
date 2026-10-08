/**
 * Main-process side of extension pairing.
 * Shows one native confirm dialog and, on Allow, writes the extension ID
 * then rewrites native messaging manifests.
 */

const { dialog } = require("electron");
const { PAIR_TYPE, PAIR_RESULT_TYPE } = require("../lib/native-host-pair.js");

const PAIR_MESSAGE =
  "Allow the Transcriber browser extension to connect to this app?";

class PairingBridge {
  constructor(options = {}) {
    this.installer = options.installer;
    this.dialog = options.dialog || dialog;
  }

  attach(child) {
    if (!child || typeof child.on !== "function") return;
    child.on("message", (msg) => {
      void this._onMessage(child, msg);
    });
  }

  async _onMessage(child, msg) {
    if (!msg || msg.type !== PAIR_TYPE) return;
    let allowed = false;
    try {
      const result = await this.dialog.showMessageBox({
        type: "question",
        buttons: ["Allow", "Don't allow"],
        defaultId: 1,
        cancelId: 1,
        message: PAIR_MESSAGE,
      });
      allowed = result.response === 0;
      if (allowed && this.installer) {
        this.installer.appendExtensionId(msg.extensionId);
        await this.installer.install();
      }
    } catch (error) {
      console.error("Pairing dialog failed:", error);
      allowed = false;
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
