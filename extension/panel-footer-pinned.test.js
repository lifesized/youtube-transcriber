/**
 * Side-panel footer stays in the viewport in every primary state,
 * including a long expanded Recent transcript.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (!String(error && error.message).includes("Executable doesn't exist")) throw error;
    execFileSync("npx", ["playwright", "install", "chromium"], {
      stdio: "inherit",
      cwd: path.join(ROOT, ".."),
    });
    return chromium.launch();
  }
}

const ROOT = __dirname;
const POPUP = path.join(ROOT, "popup.html");
const CSS = fs.readFileSync(path.join(ROOT, "popup.css"), "utf8");
const HTML = fs.readFileSync(POPUP, "utf8");
const VIEWPORT = { width: 360, height: 600 };
const SHOT_DIR =
  process.env.PANEL_FOOTER_SHOTS || "/cursor/stores/self/panel-footer";

const LONG_TRANSCRIPT = Array.from({ length: 40 }, (_, i) => {
  return `<div class="transcript-block"><div class="transcript-line"><p>Paragraph ${i + 1}. ${"Word ".repeat(24)}</p></div></div>`;
}).join("");

test("panel root is a 100vh flex column and the footer does not shrink", () => {
  assert.match(HTML, /class="panel-content"/);
  assert.match(HTML, /class="panel-footer"/);
  assert.ok(HTML.indexOf("panel-content") < HTML.indexOf("panel-footer"));
  const popupBlock = CSS.slice(CSS.indexOf(".popup {"), CSS.indexOf(".panel-content {"));
  assert.match(popupBlock, /display:\s*flex/);
  assert.match(popupBlock, /flex-direction:\s*column/);
  assert.match(popupBlock, /height:\s*100vh/);
  const contentBlock = CSS.slice(CSS.indexOf(".panel-content {"), CSS.indexOf(".panel-content::-webkit-scrollbar"));
  assert.match(contentBlock, /flex:\s*1/);
  assert.match(contentBlock, /min-height:\s*0/);
  assert.match(contentBlock, /overflow-y:\s*auto/);
  const footerBlock = CSS.slice(CSS.indexOf(".panel-footer {"), CSS.indexOf(".popup-toast {"));
  assert.match(footerBlock, /flex-shrink:\s*0/);
});

test("footer stays in the viewport in Ready, Transcribing, expanded transcript, Settings, and NoService", async () => {
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.addInitScript(() => {
    const port = {
      onMessage: { addListener() {} },
      onDisconnect: { addListener() {} },
      postMessage() {},
      disconnect() {},
    };
    window.chrome = {
      runtime: {
        connect: () => port,
        sendMessage() {},
        onMessage: { addListener() {} },
        onConnect: { addListener() {} },
        lastError: null,
        id: "testextensionidaaaaaaaaaaaaaaaaaa",
        getManifest: () => ({ version: "1.6.41" }),
        getURL: (p) => p,
      },
      tabs: {
        query: async () => [],
        onActivated: { addListener() {} },
        onUpdated: { addListener() {} },
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        },
        onChanged: { addListener() {} },
      },
    };
  });
  await page.goto(pathToFileURL(POPUP).href);
  await page.waitForSelector(".panel-footer");

  async function footerInViewport(label) {
    const box = await page.locator(".panel-footer").boundingBox();
    assert.ok(box, `${label}: footer has a box`);
    assert.ok(box.y >= 0, `${label}: footer top ${box.y} is above the viewport`);
    assert.ok(
      box.y + box.height <= VIEWPORT.height + 1,
      `${label}: footer bottom ${box.y + box.height} is below the ${VIEWPORT.height}px viewport`
    );
    const icons = page.locator("#btnNavLibrary, #btnNavSettings");
    assert.equal(await icons.count(), 2, `${label}: both nav icons present`);
    for (const name of ["#btnNavLibrary", "#btnNavSettings"]) {
      const iconBox = await page.locator(name).boundingBox();
      assert.ok(iconBox, `${label}: ${name} has a box`);
      assert.ok(iconBox.y + iconBox.height <= VIEWPORT.height + 1, `${label}: ${name} in viewport`);
    }
  }

  async function showOnly(visibleIds) {
    await page.evaluate((ids) => {
      const startup = document.getElementById("startupShell");
      if (startup) startup.hidden = true;
      for (const node of document.querySelectorAll(".state, .recent-section, .settings-panel")) {
        node.hidden = !ids.includes(node.id);
      }
    }, visibleIds);
  }

  await showOnly(["stateReady"]);
  await page.locator("#videoTitle").evaluate((el) => {
    el.textContent = "A ready video title";
  });
  await footerInViewport("Ready");

  await showOnly(["stateTranscribing"]);
  await page.locator("#transcribingTitle").evaluate((el) => {
    el.textContent = "Transcribing a long talk";
  });
  await footerInViewport("Transcribing");

  await showOnly(["stateReady", "recentSection"]);
  await page.evaluate((html) => {
    const list = document.getElementById("recentList");
    list.innerHTML = `
      <div class="recent-item-wrap expanded">
        <div class="recent-item">
          <div class="recent-item-content">
            <div class="recent-title">Expanded long transcript</div>
            <div class="recent-meta">Oct 11</div>
          </div>
        </div>
        <div class="recent-transcript">
          <div class="recent-transcript-inner">${html}</div>
        </div>
      </div>`;
  }, LONG_TRANSCRIPT);
  await footerInViewport("expanded transcript");
  const innerHeight = await page.locator(".recent-transcript-inner").evaluate((el) => el.scrollHeight);
  assert.ok(innerHeight > VIEWPORT.height, `expanded transcript (${innerHeight}px) must be taller than the panel`);
  const listOverflows = await page.locator(".recent-list").evaluate((el) => el.scrollHeight > el.clientHeight);
  const contentOverflows = await page.locator(".panel-content").evaluate((el) => el.scrollHeight > el.clientHeight);
  assert.ok(
    listOverflows || contentOverflows,
    "a long expanded transcript must scroll in the content area, not the page"
  );

  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SHOT_DIR, "expanded-transcript.png"),
      fullPage: false,
    });
  } catch {
    /* store may be unavailable */
  }

  await showOnly(["settingsPanel"]);
  await footerInViewport("Settings");
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SHOT_DIR, "settings.png"),
      fullPage: false,
    });
  } catch {
    /* store may be unavailable */
  }

  await showOnly(["stateNoService"]);
  await page.evaluate(() => {
    const wrap = document.getElementById("offlineCopyWrap");
    if (wrap) wrap.hidden = false;
    const start = document.getElementById("offlineStartWrap");
    if (start) start.hidden = false;
  });
  await footerInViewport("NoService");

  await browser.close();
});
