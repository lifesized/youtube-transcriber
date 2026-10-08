/**
 * Rebuild better-sqlite3 for Electron, then tell electron-builder not to
 * copy production node_modules. The Next server tree lives in extraResources
 * standalone; asar only needs electron/*, lib/*, tools/*, and sqlite.
 */

const path = require("path");

module.exports = async function beforeBuild(context) {
  const { rebuild } = require("@electron/rebuild");
  const arch = context.arch || process.arch;
  const appDir = context.appDir || process.cwd();
  console.log(
    `beforeBuild: rebuilding better-sqlite3 for electron ${context.electronVersion} ${arch}`
  );
  await rebuild({
    buildPath: appDir,
    projectRootPath: path.resolve(__dirname, ".."),
    electronVersion: context.electronVersion,
    arch,
    onlyModules: ["better-sqlite3"],
    force: true,
  });
  return false;
};
