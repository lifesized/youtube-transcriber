/**
 * Main-process side of extension pairing.
 * Shows one native confirm dialog and, on Allow, writes the extension ID
 * then rewrites native messaging manifests.
 */

const {
  PAIR_TYPE,
  PAIR_RESULT_TYPE,
  PAIR_EXPIRED_TYPE,
  PAIR_WINDOW_TYPE,
  PAIR_MESSAGE,
  pairingDetailText,
} = require("../lib/native-host-pair.js");

const HOUR_MS = 60 * 60 * 1000;

class PairingBridge {
  constructor(options = {}) {
    this.installer = options.installer;
    this.dialog = options.dialog;
    this.app = options.app;
    this.now = options.now || (() => Date.now());
    this.maxDialogsPerHour = options.maxDialogsPerHour ?? 3;
    this.denyTtlMs = options.denyTtlMs ?? 60_000;
    this.expiredIds = new Set();
    this.openUntil = 0;
    this.dialogOpen = false;
    this.globalDenyUntil = 0;
    this.dialogShownAt = [];
  }

  attach(child) {
    if (!child || typeof child.on !== "function") return;
    this.child = child;
    child.on("message", (msg) => {
      void this._onMessage(child, msg);
    });
    if (this.openUntil > this.now() && typeof child.send === "function") {
      child.send({ type: PAIR_WINDOW_TYPE, openUntil: this.openUntil });
    }
  }

  openWindow(openUntil, child = this.child) {
    this.openUntil = openUntil;
    const target = child || this.child;
    if (target && typeof target.send === "function") {
      target.send({ type: PAIR_WINDOW_TYPE, openUntil });
    }
    return openUntil;
  }

  closeWindow(child = this.child) {
    this.openUntil = 0;
    const target = child || this.child;
    if (target && typeof target.send === "function") {
      target.send({ type: PAIR_WINDOW_TYPE, openUntil: 0 });
    }
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

  _underHourCap(t) {
    this.dialogShownAt = this.dialogShownAt.filter((shown) => t - shown < HOUR_MS);
    return this.dialogShownAt.length < this.maxDialogsPerHour;
  }

  _refuse(child, msg, reason) {
    if (typeof child.send === "function") {
      child.send({
        type: PAIR_RESULT_TYPE,
        requestId: msg.requestId,
        allowed: false,
        reason,
      });
    }
  }

  async _onMessage(child, msg) {
    if (!msg) return;
    if (msg.type === PAIR_EXPIRED_TYPE && msg.requestId) {
      this.expiredIds.add(msg.requestId);
      return;
    }
    if (msg.type !== PAIR_TYPE) return;
    if (this.expiredIds.has(msg.requestId)) {
      return;
    }

    const t = this.now();
    if (t >= this.openUntil) {
      this._refuse(child, msg, "closed");
      return;
    }
    if (this.dialogOpen) {
      this._refuse(child, msg, "busy");
      return;
    }
    if (this.globalDenyUntil && t < this.globalDenyUntil) {
      this._refuse(child, msg, "cooldown");
      return;
    }
    if (!this._underHourCap(t)) {
      this._refuse(child, msg, "rate_limit");
      return;
    }

    this.dialogOpen = true;
    this.dialogShownAt.push(t);
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
        return;
      }
      allowed = result.response === 0;
      if (!allowed) {
        this.globalDenyUntil = this.now() + this.denyTtlMs;
      }
      if (allowed) {
        this.closeWindow(child);
        if (this.installer) {
          this.installer.appendExtensionId(msg.extensionId);
          await this.installer.install();
        }
      }
    } catch (error) {
      console.error("Pairing dialog failed:", error);
      allowed = false;
    } finally {
      this.dialogOpen = false;
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
