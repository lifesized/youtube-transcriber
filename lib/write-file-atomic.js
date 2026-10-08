"use strict";

const fs = require("fs");
const path = require("path");

function writeFileAtomic(filePath, contents, mode = 0o600) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, contents, { encoding: "utf8", mode });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Windows may ignore chmod
  }
  return filePath;
}

module.exports = { writeFileAtomic };
