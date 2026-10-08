"use strict";

/**
 * Parse `codesign -dv --verbose=4` stderr. No network. Used by the
 * updater gate so ad-hoc and unsigned builds never look "signed".
 */

function parseCodesignVerbose(stderr) {
  const text = String(stderr || "");
  const teamRaw = (text.match(/^TeamIdentifier=(.+)$/m) || [])[1] || "";
  const identifier = ((text.match(/^Identifier=(.+)$/m) || [])[1] || "").trim();
  const authorities = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^Authority=(.+)$/);
    if (match) authorities.push(match[1].trim());
  }
  const teamId = teamRaw.trim() === "not set" ? "" : teamRaw.trim();
  const adhoc =
    /^Signature=adhoc$/m.test(text) ||
    /flags=0x[0-9a-f]*\(adhoc\)/i.test(text);
  const developerId = authorities.some((line) =>
    line.startsWith("Developer ID Application")
  );
  const notSigned = /code object is not signed/i.test(text);
  return {
    identifier,
    teamId,
    authorities,
    adhoc,
    developerId,
    notSigned,
  };
}

function appBundleFromExecPath(execPath) {
  const normalized = String(execPath || "").replace(/\\/g, "/");
  const marker = ".app/Contents/MacOS/";
  const at = normalized.lastIndexOf(marker);
  if (at === -1) return "";
  return normalized.slice(0, at + 4);
}

function isDeveloperIdForTeam(info, teamId) {
  if (!info || !teamId) return false;
  if (info.notSigned || info.adhoc) return false;
  if (!info.developerId) return false;
  return info.teamId === teamId;
}

module.exports = {
  parseCodesignVerbose,
  appBundleFromExecPath,
  isDeveloperIdForTeam,
};
