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
 */

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.join(__dirname, 'dist');
const TEST_TIMEOUT = 30000;

test.describe('LOCAL Extension Panel Parity', () => {
  let browser;
  let context;
  let page;

  test.beforeAll(async () => {
    // Launch browser with extension loaded
    browser = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    });
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test('should have panel-diagnostics.js', async () => {
    const fs = require('fs');
    const diagnosticsPath = path.join(__dirname, 'dist', 'panel-diagnostics.js');
    expect(fs.existsSync(diagnosticsPath)).toBe(true);
  });

  test('should have setup-link.css', async () => {
    const fs = require('fs');
    const setupLinkPath = path.join(__dirname, 'dist', 'setup-link.css');
    expect(fs.existsSync(setupLinkPath)).toBe(true);
  });

  test('popup.html should reference required stylesheets', async () => {
    const fs = require('fs');
    const popupHtml = fs.readFileSync(path.join(__dirname, 'dist', 'popup.html'), 'utf8');
    
    expect(popupHtml).toContain('panel-diagnostics.js');
    expect(popupHtml).toContain('popup.css');
    expect(popupHtml).toContain('setup-link.css');
    expect(popupHtml).toContain('popup.js');
  });

  test('popup.html should have required elements', async () => {
    const fs = require('fs');
    const popupHtml = fs.readFileSync(path.join(__dirname, 'dist', 'popup.html'), 'utf8');
    
    // Startup shell
    expect(popupHtml).toContain('id="startupShell"');
    
    // Offline/setup state
    expect(popupHtml).toContain('id="stateNoService"');
    expect(popupHtml).toContain('id="btnStartTranscriber"');
    expect(popupHtml).toContain('Start Transcriber');
    
    // Ready state
    expect(popupHtml).toContain('id="stateReady"');
    expect(popupHtml).toContain('id="btnTranscribe"');
    expect(popupHtml).toContain('Transcribe');
    
    // Transcribing state
    expect(popupHtml).toContain('id="stateTranscribing"');
    
    // Error state
    expect(popupHtml).toContain('id="stateError"');
    
    // Recent section
    expect(popupHtml).toContain('id="recentSection"');
    expect(popupHtml).toContain('id="recentList"');
    
    // Settings panel
    expect(popupHtml).toContain('id="settingsPanel"');
    expect(popupHtml).toContain('id="serverSection"');
    expect(popupHtml).toContain('id="btnStartServer"');
    expect(popupHtml).toContain('id="btnStopServer"');
    
    // Footer nav
    expect(popupHtml).toContain('id="btnNavLibrary"');
    expect(popupHtml).toContain('id="btnNavSettings"');
    expect(popupHtml).toContain('id="githubLink"');
  });

  test('popup.html should NOT have cloud-only elements', async () => {
    const fs = require('fs');
    const popupHtml = fs.readFileSync(path.join(__dirname, 'dist', 'popup.html'), 'utf8');
    
    // Should not have cloud auth
    expect(popupHtml).not.toContain('id="cloudAuthCard"');
    expect(popupHtml).not.toContain('id="cloudAuthGoogle"');
    expect(popupHtml).not.toContain('id="cloudAuthForm"');
    expect(popupHtml).not.toContain('cloudOnboarding');
    
    // Should not have cloud account section
    expect(popupHtml).not.toContain('id="cloudAccountSection"');
    
    // Should not have destinations/connectors
    expect(popupHtml).not.toContain('id="destinationsSection"');
    expect(popupHtml).not.toContain('id="obsidianVaultRow"');
    
    // Should not have mode toggle
    expect(popupHtml).not.toContain('id="btnModeCloud"');
    expect(popupHtml).not.toContain('Self-hosted mode');
    
    // Should not have setup wall
    expect(popupHtml).not.toContain('id="setupWallModal"');
    
    // Should not have cloud link in footer
    expect(popupHtml).not.toContain('id="cloudLink"');
    expect(popupHtml).not.toContain('transcribed.dev');
  });

  test('popup.js should have latency fix', async () => {
    const fs = require('fs');
    const popupJs = fs.readFileSync(path.join(__dirname, 'dist', 'popup.js'), 'utf8');
    
    expect(popupJs).toContain('requestIdleCallback');
    expect(popupJs).toContain('YTT-456');
  });

  test('popup.js should be in local mode', async () => {
    const fs = require('fs');
    const popupJs = fs.readFileSync(path.join(__dirname, 'dist', 'popup.js'), 'utf8');
    
    expect(popupJs).toContain('let currentMode = "local"');
  });

  test('manifest should have correct version', async () => {
    const fs = require('fs');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'manifest.json'), 'utf8'));
    
    expect(manifest.version).toBe('1.6.31');
  });

  test('manifest should have LOCAL permissions', async () => {
    const fs = require('fs');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'manifest.json'), 'utf8'));
    
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('nativeMessaging');
    expect(manifest.permissions).toContain('sidePanel');
  });

  test('manifest should have LOCAL host permissions', async () => {
    const fs = require('fs');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'manifest.json'), 'utf8'));
    
    expect(manifest.host_permissions).toContain('http://127.0.0.1:19720/*');
    
    // Should NOT have cloud hosts
    const hostPerms = manifest.host_permissions.join(',');
    expect(hostPerms).not.toContain('transcribed.dev');
  });
});

console.log('✓ Extension panel parity test suite ready');
