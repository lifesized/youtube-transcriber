importScripts("send-url.js");

/**
 * ENTERPRISE background — no native messaging, org SSO via cookies (YTT-447/YTT-454).
 */

async function sendPageUrl(pageUrl) {
  const request = buildEnterpriseSendRequest(pageUrl);
  if (!request.ok) {
    return { ok: false, reason: "other" };
  }

  let res;
  try {
    res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      credentials: "include", // SSO cookies placeholder
      body: request.body,
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "unauthorized" };
  }
  
  if (!res.ok) {
    return { ok: false, reason: "other" };
  }
  
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: "other" };
  }

  if (typeof data?.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) {
    return { ok: false, reason: "other" };
  }

  return { ok: true, transcriptId: data.id };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "SEND_PAGE_URL") return;
  if (sender?.id !== chrome.runtime.id) {
    sendResponse({ ok: false });
    return;
  }
  sendPageUrl(message.url)
    .then((result) => sendResponse(result))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.sidePanel.setOptions({ path: "popup.html", enabled: true }).catch(() => {});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => {});

chrome.action.onClicked.addListener((tab) => {
  if (!Number.isInteger(tab.windowId)) return;
  chrome.sidePanel.open({ windowId: tab.windowId });
});
