#!/usr/bin/env node
/**
 * Print a per-directory size table and fail if the .app or DMG exceeds
 * electron/size-budget.json. Budgets are a bit above the achieved size.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { formatBytes } = require("./prune-electron-payload.js");

function duBytes(target) {
  if (!target || !fs.existsSync(target)) return 0;
  const out = execSync(`du -sk "${target}"`, { encoding: "utf8" }).trim();
  const kb = parseInt(out.split(/\s+/)[0], 10);
  return (Number.isFinite(kb) ? kb : 0) * 1024;
}

function fileBytes(target) {
  if (!target || !fs.existsSync(target)) return 0;
  return fs.statSync(target).size;
}

function main() {
  const app = process.argv[2];
  const dmg = process.argv[3];
  const budgetPath =
    process.argv[4] ||
    path.join(__dirname, "..", "electron", "size-budget.json");
  if (!app || !dmg) {
    console.error("usage: assert-packaged-size.js <Transcriber.app> <dmg> [budget.json]");
    process.exit(2);
  }
  const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  const rows = [
    ["Transcriber.app", duBytes(app)],
    ["Contents/Frameworks", duBytes(path.join(app, "Contents", "Frameworks"))],
    [
      "Contents/Resources/standalone",
      duBytes(path.join(app, "Contents", "Resources", "standalone")),
    ],
    [
      "Contents/Resources/app.asar",
      duBytes(path.join(app, "Contents", "Resources", "app.asar")),
    ],
    [
      "Contents/Resources/app.asar.unpacked",
      duBytes(path.join(app, "Contents", "Resources", "app.asar.unpacked")),
    ],
    ["Contents/Resources/bin", duBytes(path.join(app, "Contents", "Resources", "bin"))],
    ["DMG", fileBytes(dmg)],
  ];

  const pad = Math.max(...rows.map(([name]) => name.length));
  console.log("===== packaged size budget =====");
  const md = ["## Size", "", "| Path | Size |", "| --- | ---: |"];
  for (const [name, bytes] of rows) {
    const line = `${name.padEnd(pad)}  ${formatBytes(bytes)}  (${bytes} bytes)`;
    console.log(line);
    md.push(`| \`${name}\` | ${formatBytes(bytes)} |`);
  }
  md.push("");
  md.push(
    `- Budget: app \`${formatBytes(budget.appBytes)}\`, DMG \`${formatBytes(budget.dmgBytes)}\``
  );

  const appBytes = rows[0][1];
  const dmgBytes = rows[rows.length - 1][1];
  let failed = false;
  if (appBytes > budget.appBytes) {
    console.error(
      `ERROR: Transcriber.app ${appBytes} bytes exceeds budget ${budget.appBytes}`
    );
    failed = true;
  } else {
    console.log(`✓ app under budget (${formatBytes(budget.appBytes)})`);
  }
  if (dmgBytes > budget.dmgBytes) {
    console.error(
      `ERROR: DMG ${dmgBytes} bytes exceeds budget ${budget.dmgBytes}`
    );
    failed = true;
  } else {
    console.log(`✓ DMG under budget (${formatBytes(budget.dmgBytes)})`);
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(summary, `${md.join("\n")}\n`);
  }

  process.exit(failed ? 1 : 0);
}

main();
