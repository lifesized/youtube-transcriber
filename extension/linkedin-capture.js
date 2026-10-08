"use strict";

/**
 * Background side of LinkedIn capture (LOCAL build). Asks the LinkedIn tab's
 * content script for the post/event media, then builds the loopback request:
 * the page URL (the server derives the linkedin: ID from it) plus the signed
 * LinkedIn CDN URL the local server downloads. No LinkedIn request is made
 * from here, and errors are fixed strings (YTT-448).
 */

const LINKEDIN_TAB_TIMEOUT_MS = 2500;
const LINKEDIN_CONTENT_FILES = ["linkedin-url.js", "content-linkedin.js"];

const LINKEDIN_ERRORS = {
  no_video: "No LinkedIn video found. Play the video for a moment, then press Transcribe again.",
  open_post: "Open the post on its own page (click its date), then press Transcribe.",
  reload: "Reload the LinkedIn page, then press Transcribe again.",
  event_upcoming: "This LinkedIn event hasn't started yet. Transcribe it once the recording is up.",
  event_live: "This LinkedIn event is still live. Reload the page after it ends, then press Transcribe.",
  event_no_recording: "This LinkedIn event has no video recording to transcribe.",
  server: "LinkedIn didn't hand over this video. Reload the page and press Transcribe again.",
};

function linkedInUrlApi() {
  return typeof LinkedInUrl !== "undefined" ? LinkedInUrl : require("./linkedin-url.js");
}

function isLinkedInPageUrl(url) {
  return !!linkedInUrlApi().pageKind(url);
}

function linkedInError(reason) {
  return LINKEDIN_ERRORS[reason] || LINKEDIN_ERRORS.reload;
}

/** Validate the content script's reply; anything unexpected becomes a fixed reason. */
function parseLinkedInMedia(response) {
  const Url = linkedInUrlApi();
  if (!response || typeof response !== "object") return { ok: false, reason: "reload" };
  if (response.ok !== true) {
    return { ok: false, reason: LINKEDIN_ERRORS[response.reason] ? response.reason : "reload" };
  }
  if (typeof response.pageUrl !== "string" || !Url.contentId(response.pageUrl)) {
    return { ok: false, reason: "reload" };
  }
  if (typeof response.mediaUrl !== "string" || response.mediaUrl.length > 4096 || !Url.isMediaCdnUrl(response.mediaUrl)) {
    return { ok: false, reason: "reload" };
  }
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  return {
    ok: true,
    pageUrl: response.pageUrl,
    mediaUrl: response.mediaUrl,
    title: text(response.title, 512),
    author: text(response.author, 256),
  };
}

/**
 * The getLocalToken token when there is one. Without it, only the dev server
 * (a no-auth one) can take the request, so any other target is refused.
 * Cookies are never sent: background.js posts through targetClient.send.
 */
function buildPageSendRequest(pageUrl, token, apiBase) {
  if (token) return buildLocalSendRequest(pageUrl, token, null, apiBase);
  const request = buildTokenlessDevSendRequest(pageUrl, null);
  if (!request.ok || new URL(request.url).origin !== apiBase) return { ok: false };
  return request;
}

/**
 * Loopback request for a LinkedIn page, reusing send-url.js's URL/token/endpoint
 * checks and adding the LinkedIn fields to its body.
 */
function buildLinkedInSendRequest(media, token, apiBase) {
  if (!linkedInUrlApi().isMediaCdnUrl(media.mediaUrl)) return { ok: false };
  const base = buildPageSendRequest(media.pageUrl, token, apiBase);
  if (!base.ok) return { ok: false };
  const payload = { ...JSON.parse(base.body), mediaUrl: new URL(media.mediaUrl).href };
  if (media.title) payload.title = media.title;
  if (media.author) payload.author = media.author;
  const body = JSON.stringify(payload);
  if (token && body.includes(token)) return { ok: false };
  return { ...base, body };
}

async function findLinkedInTab(pageUrl) {
  try {
    const tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
    const matches = tabs.filter((tab) => tab.url === pageUrl);
    return matches.find((tab) => tab.active) || matches[0] || null;
  } catch {
    return null;
  }
}

/** Ask the tab; inject the content script once if it isn't there (tab predates install/reload). */
async function requestLinkedInMedia(tabId) {
  let response = await sendMessageWithTimeout(tabId, { type: "LINKEDIN_GET_MEDIA" }, LINKEDIN_TAB_TIMEOUT_MS);
  if (response === null) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: LINKEDIN_CONTENT_FILES });
    } catch {
      return null;
    }
    response = await sendMessageWithTimeout(tabId, { type: "LINKEDIN_GET_MEDIA" }, LINKEDIN_TAB_TIMEOUT_MS);
  }
  return response;
}

/**
 * @returns {Promise<{ok: true, url: string, headers: object, body: string} | {ok: false, error?: string}>}
 */
async function prepareLinkedInSend(pageUrl, token, apiBase) {
  const tab = await findLinkedInTab(pageUrl);
  if (!tab?.id) {
    // Queued or pasted post without its tab: the server tries the public post page.
    if (linkedInUrlApi().pageKind(pageUrl) !== "post") return { ok: false, error: linkedInError("reload") };
    return buildPageSendRequest(pageUrl, token, apiBase);
  }
  const media = parseLinkedInMedia(await requestLinkedInMedia(tab.id));
  if (!media.ok) return { ok: false, error: linkedInError(media.reason) };
  return buildLinkedInSendRequest(media, token, apiBase);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LINKEDIN_ERRORS,
    isLinkedInPageUrl,
    parseLinkedInMedia,
    buildLinkedInSendRequest,
    prepareLinkedInSend,
  };
}
