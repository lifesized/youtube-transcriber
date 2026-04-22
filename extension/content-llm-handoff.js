// LLM prompt handoff — content script loaded on claude.ai and chatgpt.com.
//
// Flow: popup stashes the built prompt in background, opens
// https://<provider>/?yttx=<token>. This script spots the token in the URL,
// pulls the prompt from background, drops it into the provider's composer,
// and auto-submits so the user's click-to-summarize feels end-to-end.
// Without the token this script is a no-op, so normal browsing is unaffected.

(() => {
  const HANDOFF_QUERY_PARAM = "yttx";
  const EDITOR_WAIT_MS = 12000;
  const POLL_INTERVAL_MS = 250;
  const POST_INJECT_DELAY_MS = 500;

  // Per-provider DOM config. Selectors are Claude/ChatGPT's own published
  // markup — the only thing that crosses over between providers is the
  // ProseMirror editor primitive both happen to use.
  const PROVIDERS = {
    "claude.ai": {
      editorSelectors: [
        "div.ProseMirror[contenteditable='true']",
        "fieldset div[contenteditable='true']",
        "form div[contenteditable='true']",
      ],
      sendSelectors: [
        "button[aria-label='Send message']",
        "button[aria-label='Send Message']",
        "fieldset button[type='submit']",
      ],
    },
    "chatgpt.com": {
      editorSelectors: [
        "main form div.ProseMirror",
        "#prompt-textarea",
        "main form textarea",
      ],
      sendSelectors: [
        "main form button[aria-label='Send prompt']",
        "button[aria-label='Send prompt']",
        "button[data-testid='send-button']",
        "main form button[type='submit']",
      ],
    },
  };

  function currentProviderConfig() {
    const host = window.location.hostname.replace(/^www\./, "");
    return PROVIDERS[host] || null;
  }

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

  function findBy(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function waitForEditor(config, timeoutMs) {
    return new Promise((resolve) => {
      const existing = findBy(config.editorSelectors);
      if (existing) {
        resolve(existing);
        return;
      }
      const deadline = Date.now() + timeoutMs;
      const observer = new MutationObserver(() => {
        const el = findBy(config.editorSelectors);
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
        const el = findBy(config.editorSelectors);
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
    // editor with text. Plain textarea fallback uses .value.
    if (editor.tagName.toLowerCase() === "textarea") {
      editor.value = prompt;
    } else {
      editor.innerHTML = `<p>${escapeForHtml(prompt)}</p>`;
    }
    editor.focus();
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function run() {
    const config = currentProviderConfig();
    if (!config) return;

    const token = readToken();
    if (!token) return;
    stripTokenFromUrl();

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "CLAIM_LLM_PROMPT",
        token,
      });
    } catch {
      return;
    }
    const prompt = response?.success ? response.data?.prompt : null;
    if (!prompt) return;

    const editor = await waitForEditor(config, EDITOR_WAIT_MS);
    if (!editor) return;

    injectPrompt(editor, prompt);

    // Give the send button a moment to re-enable after input fires,
    // then submit so the user's click-to-summarize feels end-to-end.
    await new Promise((r) => setTimeout(r, POST_INJECT_DELAY_MS));
    const send = findBy(config.sendSelectors);
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
