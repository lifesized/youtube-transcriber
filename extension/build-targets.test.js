const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = __dirname;

test("LOCAL manifest has loopback-only host_permissions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifests", "local.json"), "utf8"));
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1:19720/*"]);
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.equal(manifest.name, "Transcriber for YouTube");
  assert.match(manifest.content_security_policy.extension_pages, /connect-src[^;]*http:\/\/127\.0\.0\.1:19720/);
});

test("ENTERPRISE manifest template has no nativeMessaging and requires base URL", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifests", "enterprise.json"), "utf8"));
  assert.ok(!manifest.permissions.includes("nativeMessaging"));
  assert.equal(manifest.name, "Transcriber (Enterprise)");
  assert.equal(manifest.host_permissions[0], "{{ENTERPRISE_BASE_URL}}/*");
  assert.match(manifest.content_security_policy.extension_pages, /\{\{ENTERPRISE_ORIGIN\}\}/);
});

test("ENTERPRISE build fails without base URL", () => {
  const buildScript = path.join(ROOT, "build-enterprise.js");
  assert.throws(() => {
    execSync(`node ${buildScript}`, { 
      stdio: "pipe", 
      env: { ...process.env, ENTERPRISE_BASE_URL: "" } 
    });
  }, /ENTERPRISE build requires/);
});

test("ENTERPRISE build succeeds with valid HTTPS base URL", () => {
  const buildScript = path.join(ROOT, "build-enterprise.js");
  const distPath = path.join(ROOT, "dist-enterprise");
  
  // Clean dist-enterprise first
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true });
  }

  execSync(`node ${buildScript} --base-url https://transcriber.example.com`, { stdio: "pipe" });
  
  assert.ok(fs.existsSync(distPath));
  
  const manifest = JSON.parse(fs.readFileSync(path.join(distPath, "manifest.json"), "utf8"));
  assert.equal(manifest.name, "Transcriber (Enterprise)");
  assert.deepEqual(manifest.host_permissions, ["https://transcriber.example.com/*"]);
  assert.ok(!manifest.permissions.includes("nativeMessaging"));
  assert.match(manifest.content_security_policy.extension_pages, /connect-src[^;]*https:\/\/transcriber\.example\.com/);
  
  const sendUrl = fs.readFileSync(path.join(distPath, "send-url.js"), "utf8");
  assert.match(sendUrl, /https:\/\/transcriber\.example\.com\/api\/transcripts/);
  assert.ok(!fs.existsSync(path.join(distPath, "local-auth-headers.js")));
  
  // Clean up
  fs.rmSync(distPath, { recursive: true });
});

test("ENTERPRISE build rejects non-HTTPS base URL", () => {
  const buildScript = path.join(ROOT, "build-enterprise.js");
  assert.throws(() => {
    execSync(`node ${buildScript} --base-url http://transcriber.example.com`, { stdio: "pipe" });
  }, /must use HTTPS/);
});

test("LOCAL build still works and produces loopback-only artifact", () => {
  const buildScript = path.join(ROOT, "build.js");
  const distPath = path.join(ROOT, "dist");
  
  execSync(`node ${buildScript}`, { stdio: "pipe" });
  
  assert.ok(fs.existsSync(distPath));
  
  const manifest = JSON.parse(fs.readFileSync(path.join(distPath, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1:19720/*"]);
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  
  const sendUrl = fs.readFileSync(path.join(distPath, "send-url.js"), "utf8");
  assert.match(sendUrl, /http:\/\/127\.0\.0\.1:19720\/api\/transcripts/);
  assert.ok(fs.existsSync(path.join(distPath, "local-auth-headers.js")));
});

test("send-url-enterprise.js does not reference native messaging or loopback", () => {
  const enterpriseSendUrl = fs.readFileSync(path.join(ROOT, "send-url-enterprise.js"), "utf8");
  assert.doesNotMatch(enterpriseSendUrl, /127\.0\.0\.1|localhost|nativeMessaging|localAuthHeadersFromToken/);
  assert.match(enterpriseSendUrl, /buildEnterpriseSendRequest/);
  assert.match(enterpriseSendUrl, /ENTERPRISE_SEND_ENDPOINT/);
});
