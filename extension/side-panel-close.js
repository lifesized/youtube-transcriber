"use strict";

/**
 * Close the Chrome side panel on fullscreen. window.close() does not hide a
 * side panel; use sidePanel.close when present, else disable-and-reenable.
 */

(function (root, factory) {
  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
  }
  root.SidePanelClose = exported;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function portMatchesWindow(port, windowId) {
    return Number.isInteger(windowId) && Number.isInteger(port && port.windowId) && port.windowId === windowId;
  }

  function postClose(ports, windowId) {
    const list = ports && typeof ports[Symbol.iterator] === "function" ? [...ports] : [];
    for (const port of list) {
      if (!portMatchesWindow(port, windowId)) continue;
      try {
        port.postMessage({ type: "CLOSE" });
      } catch {
        /* disconnected */
      }
    }
  }

  function isFullscreenWindow(win) {
    return Boolean(win && win.state === "fullscreen");
  }

  async function closeSidePanel(chromeApi, ports, windowId) {
    postClose(ports, windowId);
    const id = Number.isInteger(windowId) ? windowId : undefined;
    const sidePanel = chromeApi && chromeApi.sidePanel;
    if (sidePanel && typeof sidePanel.close === "function" && id !== undefined) {
      try {
        await sidePanel.close({ windowId: id });
        return { ok: true, method: "close" };
      } catch {
        /* fall through to disable-reenable */
      }
    }
    if (sidePanel && typeof sidePanel.setOptions === "function" && id !== undefined) {
      try {
        await sidePanel.setOptions({ windowId: id, enabled: false });
        await sidePanel.setOptions({
          windowId: id,
          path: "popup.html",
          enabled: true,
        });
        return { ok: true, method: "disable-reenable" };
      } catch {
        return { ok: true, method: "port" };
      }
    }
    return { ok: true, method: "port" };
  }

  return { closeSidePanel, isFullscreenWindow, postClose };
});
