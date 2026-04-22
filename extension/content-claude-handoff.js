// Claude prompt handoff — content script loaded on claude.ai.
//
// Flow: popup stashes the built prompt in background, opens
// claude.ai/new?yttx=<token>. This script spots the token in the URL, pulls
// the prompt from background, and drops it into the ProseMirror editor so the
// user doesn't have to paste manually. Without the token this script is a
// no-op, so normal claude.ai browsing is unaffected.

(() => {
  const HANDOFF_QUERY_PARAM = "yttx";
  const EDITOR_WAIT_MS = 12000;
  const POLL_INTERVAL_MS = 250;
  const POST_INJECT_DELAY_MS = 450;

  function readToken() {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get(HANDOFF_QUERY_PARAM);
    } catch {
      return null;
    }
  }

  function stripTokenFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has(HANDOFF_QUERY_PARAM)) return;
      url.searchParams.delete(HANDOFF_QUERY_PARAM);
      const clean = url.pathname + (url.search ? url.search : "") + url.hash;
      window.history.replaceState({}, "", clean);
    } catch {
      // ignore — leaving the param in the URL is harmless
    }
  }

  function escapeForHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function findEditor() {
    // Claude's composer is a ProseMirror contenteditable. The exact wrapper
    // class has churned across redesigns, so fall back to any contenteditable
    // inside the chat form.
    return (
      document.querySelector("div.ProseMirror[contenteditable='true']") ||
      document.querySelector("fieldset div[contenteditable='true']") ||
      document.querySelector("form div[contenteditable='true']")
    );
  }

  function findSendButton() {
    return (
      document.querySelector("button[aria-label='Send message']") ||
      document.querySelector("button[aria-label='Send Message']") ||
      document.querySelector("fieldset button[type='submit']")
    );
  }

  function waitForEditor(timeoutMs) {
    return new Promise((resolve) => {
      const existing = findEditor();
      if (existing) {
        resolve(existing);
        return;
      }
      const deadline = Date.now() + timeoutMs;
      const observer = new MutationObserver(() => {
        const el = findEditor();
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      const tick = setInterval(() => {
        if (Date.now() > deadline) {
          clearInterval(tick);
          observer.disconnect();
          resolve(null);
          return;
        }
        const el = findEditor();
        if (el) {
          clearInterval(tick);
          observer.disconnect();
          resolve(el);
        }
      }, POLL_INTERVAL_MS);
    });
  }

  function injectPrompt(editor, prompt) {
    // ProseMirror rebuilds its internal doc from the DOM on focus/input, so
    // setting innerHTML + dispatching an input event is enough to seed the
    // editor with text. Wrap in <p> to match Claude's own paragraph schema.
    editor.innerHTML = `<p>${escapeForHtml(prompt)}</p>`;
    editor.focus();
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function run() {
    const token = readToken();
    if (!token) return;
    stripTokenFromUrl();

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "CLAIM_CLAUDE_PROMPT",
        token,
      });
    } catch {
      return;
    }
    const prompt = response?.success ? response.data?.prompt : null;
    if (!prompt) return;

    const editor = await waitForEditor(EDITOR_WAIT_MS);
    if (!editor) return;

    injectPrompt(editor, prompt);

    // Give Claude's send button a moment to re-enable after input fires,
    // then submit so the user's click-to-summarize feels end-to-end.
    await new Promise((r) => setTimeout(r, POST_INJECT_DELAY_MS));
    const send = findSendButton();
    if (send) {
      try {
        send.disabled = false;
      } catch {
        // some builds wrap the attribute in getters — ignore
      }
      send.click();
    }
  }

  run().catch(() => {});
})();
