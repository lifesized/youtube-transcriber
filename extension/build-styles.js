const { buildSync } = require("esbuild");
const path = require("node:path");

// Keep CSS sources canonical. Ship their bundled contents in the document so
// even the static loading shell has no render-blocking stylesheet requests.
function inlinePanelStyles(html, sourceDirectory) {
  return html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, file) => {
    const result = buildSync({
      entryPoints: [path.join(sourceDirectory, file)],
      bundle: true,
      write: false,
      charset: "utf8",
      logLevel: "silent",
    });
    const css = result.outputFiles[0].text;
    if (/@import\s|<\/style/i.test(css)) {
      throw new Error(`Panel stylesheet must be self-contained: ${file}`);
    }
    return `<style>\n${css}</style>`;
  });
}

module.exports = { inlinePanelStyles };
