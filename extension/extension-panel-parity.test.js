/**
 * YTT-457: Verify LOCAL extension panel surfaces match pre-thin requirements
 * 
 * Required surfaces:
 * 1. Transcribe + Summarize primary labels
 * 2. Summarize as peer to Transcribe (primary CTA when already transcribed)
 * 3. Recent/Library list
 * 4. Settings view
 * 5. GitHub repo link
 * 6. Start Transcriber offline button (YTT-456)
 * 7. Stop Transcriber in Settings when server up
 * 8. States: offline → ready → transcribing → error + Recent when online
 * 
 * Static checks only (no browser required) — verify dist/ matches Security requirements.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const EXTENSION_PATH = path.join(__dirname, 'dist');

test('should have panel-diagnostics.js', () => {
  const diagnosticsPath = path.join(__dirname, 'dist', 'panel-diagnostics.js');
  assert.ok(fs.existsSync(diagnosticsPath), 'panel-diagnostics.js must exist');
});

test('should have setup-link.css', () => {
  const setupLinkPath = path.join(__dirname, 'dist', 'setup-link.css');
  assert.ok(fs.existsSync(setupLinkPath), 'setup-link.css must exist');
});

test('popup.html should reference required stylesheets', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, 'dist', 'popup.html'), 'utf8');
  
  assert.ok(popupHtml.includes('panel-diagnostics.js'), 'popup.html must include panel-diagnostics.js');
  assert.ok(popupHtml.includes('popup.css'), 'popup.html must include popup.css');
  assert.ok(popupHtml.includes('setup-link.css'), 'popup.html must include setup-link.css');
  assert.ok(popupHtml.includes('popup.js'), 'popup.html must include popup.js');
});

test('popup.html should have required elements', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, 'dist', 'popup.html'), 'utf8');
  
  assert.ok(popupHtml.includes('id="startupShell"'), 'must have startupShell');
  assert.ok(popupHtml.includes('id="stateNoService"'), 'must have stateNoService');
  assert.ok(popupHtml.includes('id="btnStartTranscriber"'), 'must have btnStartTranscriber');
  assert.ok(popupHtml.includes('Start Transcriber'), 'must have "Start Transcriber" text');
  assert.ok(popupHtml.includes('id="stateReady"'), 'must have stateReady');
  assert.ok(popupHtml.includes('id="btnTranscribe"'), 'must have btnTranscribe');
  assert.ok(popupHtml.includes('Transcribe'), 'must have "Transcribe" text');
  assert.ok(popupHtml.includes('id="stateTranscribing"'), 'must have stateTranscribing');
  assert.ok(popupHtml.includes('id="stateError"'), 'must have stateError');
  assert.ok(popupHtml.includes('id="recentSection"'), 'must have recentSection');
  assert.ok(popupHtml.includes('id="recentList"'), 'must have recentList');
  assert.ok(popupHtml.includes('id="settingsPanel"'), 'must have settingsPanel');
  assert.ok(popupHtml.includes('id="serverSection"'), 'must have serverSection');
  assert.ok(popupHtml.includes('id="btnStartServer"'), 'must have btnStartServer');
  assert.ok(popupHtml.includes('id="btnStopServer"'), 'must have btnStopServer');
  assert.ok(popupHtml.includes('id="btnNavLibrary"'), 'must have btnNavLibrary');
  assert.ok(popupHtml.includes('id="btnNavSettings"'), 'must have btnNavSettings');
  assert.ok(popupHtml.includes('id="githubLink"'), 'must have githubLink');
});

test('popup.html should NOT have cloud-only elements', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, 'dist', 'popup.html'), 'utf8');
  
  assert.ok(!popupHtml.includes('id="cloudAuthCard"'), 'must not have cloudAuthCard');
  assert.ok(!popupHtml.includes('id="cloudAuthGoogle"'), 'must not have cloudAuthGoogle');
  assert.ok(!popupHtml.includes('id="cloudAuthForm"'), 'must not have cloudAuthForm');
  assert.ok(!popupHtml.includes('cloudOnboarding'), 'must not have cloudOnboarding');
  assert.ok(!popupHtml.includes('id="cloudAccountSection"'), 'must not have cloudAccountSection');
  assert.ok(!popupHtml.includes('id="destinationsSection"'), 'must not have destinationsSection');
  assert.ok(!popupHtml.includes('id="obsidianVaultRow"'), 'must not have obsidianVaultRow');
  assert.ok(!popupHtml.includes('id="btnModeCloud"'), 'must not have btnModeCloud');
  assert.ok(!popupHtml.includes('Self-hosted mode'), 'must not have "Self-hosted mode" text');
  assert.ok(!popupHtml.includes('id="setupWallModal"'), 'must not have setupWallModal');
  assert.ok(!popupHtml.includes('id="cloudLink"'), 'must not have cloudLink');
  assert.ok(!popupHtml.includes('transcribed.dev'), 'must not have transcribed.dev');
});

test('popup.js should have latency fix', () => {
  const popupJs = fs.readFileSync(path.join(__dirname, 'dist', 'popup.js'), 'utf8');
  
  assert.ok(popupJs.includes('requestIdleCallback'), 'must have requestIdleCallback');
  assert.ok(popupJs.includes('YTT-456'), 'must reference YTT-456');
});

test('popup.js should be in local mode', () => {
  const popupJs = fs.readFileSync(path.join(__dirname, 'dist', 'popup.js'), 'utf8');
  
  assert.ok(popupJs.includes('let currentMode = "local"'), 'currentMode must default to "local"');
  assert.ok(popupJs.includes('const mode = "local"'), 'init() must always use local mode');
});

test('popup.js should null-guard cloud element listeners', () => {
  const popupJs = fs.readFileSync(path.join(__dirname, 'dist', 'popup.js'), 'utf8');
  
  assert.ok(popupJs.includes('if (el.cloudAuthForm)'), 'cloudAuthForm listener must be null-guarded');
  assert.ok(popupJs.includes('if (el.btnModeLocal)'), 'btnModeLocal listener must be null-guarded');
  assert.ok(popupJs.includes('if (el.setupWallStay)'), 'setupWallStay listener must be null-guarded');
});

test('popup.js should not have tryLlmHandoff', () => {
  const popupJs = fs.readFileSync(path.join(__dirname, 'dist', 'popup.js'), 'utf8');
  
  assert.ok(!popupJs.includes('async function tryLlmHandoff'), 'must not have tryLlmHandoff function');
  assert.ok(!popupJs.includes('chrome.permissions.request'), 'must not request optional host permissions');
});

test('background.js should handle LOCAL messages', () => {
  const backgroundJs = fs.readFileSync(path.join(__dirname, 'dist', 'background.js'), 'utf8');
  
  assert.ok(backgroundJs.includes('case "CHECK_SERVICE"'), 'must handle CHECK_SERVICE');
  assert.ok(backgroundJs.includes('case "TRANSCRIBE"'), 'must handle TRANSCRIBE');
  assert.ok(backgroundJs.includes('case "GET_RECENT"'), 'must handle GET_RECENT');
  assert.ok(backgroundJs.includes('case "OPEN_TRANSCRIPT"'), 'must handle OPEN_TRANSCRIPT');
});

test('manifest should have correct version', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'manifest.json'), 'utf8'));
  
  assert.strictEqual(manifest.version, '1.6.33', 'version must be 1.6.33');
});

test('manifest should have LOCAL permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'manifest.json'), 'utf8'));
  
  assert.ok(manifest.permissions.includes('storage'), 'must have storage permission');
  assert.ok(manifest.permissions.includes('nativeMessaging'), 'must have nativeMessaging permission');
  assert.ok(manifest.permissions.includes('sidePanel'), 'must have sidePanel permission');
});

test('manifest should have LOCAL host permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'manifest.json'), 'utf8'));
  
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1:19720/*'), 'must have localhost:19720 host permission');
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1:19721/*'), 'must have localhost:19721 host permission');
  
  const hostPerms = manifest.host_permissions.join(',');
  assert.ok(!hostPerms.includes('transcribed.dev'), 'must not have transcribed.dev host permission');
  assert.ok(!hostPerms.includes('chatgpt.com'), 'must not have chatgpt.com host permission');
  assert.ok(!hostPerms.includes('claude.ai'), 'must not have claude.ai host permission');
});
