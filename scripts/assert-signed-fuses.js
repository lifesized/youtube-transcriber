#!/usr/bin/env node
/**
 * Read Electron fuses on a signed .app without npm ci.
 * FUSES_MODULE must point at an extracted @electron/fuses package root.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const app = process.argv[2];
const fusesRoot = process.env.FUSES_MODULE;
if (!app || !fusesRoot) {
  console.error("usage: FUSES_MODULE=<@electron/fuses root> assert-signed-fuses.js <app>");
  process.exit(2);
}

const mod = await import(pathToFileURL(path.join(fusesRoot, "dist/index.js")).href);
const { getCurrentFuseWire, FuseV1Options, FuseState } = mod;
const wire = await getCurrentFuseWire(app);

function isOn(value) {
  return value === true || value === FuseState.ENABLE || value === 1;
}
function isOff(value) {
  return value === false || value === FuseState.DISABLE || value === 0;
}

const runAsNode = wire[FuseV1Options.RunAsNode];
const nodeOptions = wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable];
const inspect = wire[FuseV1Options.EnableNodeCliInspectArguments];

console.log(
  JSON.stringify(
    {
      app,
      RunAsNode: runAsNode,
      EnableNodeOptionsEnvironmentVariable: nodeOptions,
      EnableNodeCliInspectArguments: inspect,
    },
    null,
    2
  )
);

if (!isOn(runAsNode)) {
  console.error("fuses: RunAsNode must be enabled (ELECTRON_RUN_AS_NODE)");
  process.exit(1);
}
if (!isOff(nodeOptions)) {
  console.error("fuses: EnableNodeOptionsEnvironmentVariable must be off");
  process.exit(1);
}
if (!isOff(inspect)) {
  console.error("fuses: EnableNodeCliInspectArguments must be off");
  process.exit(1);
}
console.log("fuses: RunAsNode ON, NODE_OPTIONS OFF, inspect args OFF");
