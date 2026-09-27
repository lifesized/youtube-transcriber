#!/usr/bin/env node
// Usage: node scripts/analyze-extension-startup.js report.json
const fs = require("node:fs");
const {
  buildLaunchRows,
} = require("../extension/startup-report.js");

function printReport(report) {
  console.log("\nToolbar launch attempts (all durations from click, ms):");
  console.table(buildLaunchRows(report));
  for (const trace of report.traces) {
    console.log(`\nDocument ${new Date(trace.startedAt).toISOString()}`);
    console.table(trace.events);
    console.log("Slowest document resources (ms):");
    console.table(
      [...trace.resources]
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 10),
    );
    const count = {};
    for (const event of trace.events)
      count[event.name] = (count[event.name] || 0) + 1;
    console.log(
      "Repeated work:",
      Object.fromEntries(Object.entries(count).filter(([, n]) => n > 1)),
    );
  }
}

if (require.main === module) {
  const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (!Array.isArray(report.traces))
    throw new Error("Expected diagnostic report.traces");
  printReport(report);
}

module.exports = { buildLaunchRows, printReport };
