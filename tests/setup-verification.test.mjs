import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const verificationScript = path.join(repoRoot, "scripts", "test-setup.sh");

async function createFixture(t, { nodeVersion, nativeBindingLoads }) {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "ytt-setup-test-"));
  const binDir = path.join(fixtureDir, "bin");
  const venvBinDir = path.join(fixtureDir, ".venv", "bin");
  await mkdir(binDir, { recursive: true });
  await mkdir(venvBinDir, { recursive: true });
  await mkdir(path.join(fixtureDir, "node_modules", ".prisma", "client"), {
    recursive: true,
  });

  const writeExecutable = async (filePath, contents) => {
    await writeFile(filePath, contents);
    await chmod(filePath, 0o755);
  };

  await writeExecutable(
    path.join(binDir, "node"),
    `#!/bin/sh
if [ "$1" = "-v" ]; then
  echo "v${nodeVersion}"
  exit 0
fi
if [ "$1" = "-e" ]; then
  exit ${nativeBindingLoads ? 0 : 1}
fi
exit 0
`,
  );
  await writeExecutable(
    path.join(binDir, "python3"),
    "#!/bin/sh\necho 'Python 3.12.0'\n",
  );
  await writeExecutable(
    path.join(venvBinDir, "python3"),
    "#!/bin/sh\nexit 0\n",
  );
  await writeExecutable(
    path.join(venvBinDir, "whisper"),
    "#!/bin/sh\nexit 0\n",
  );
  await writeExecutable(path.join(binDir, "ffmpeg"), "#!/bin/sh\nexit 0\n");
  await writeExecutable(path.join(binDir, "yt-dlp"), "#!/bin/sh\nexit 0\n");
  await writeExecutable(
    path.join(binDir, "sqlite3"),
    `#!/bin/sh
case "$2" in
  *"SELECT name"*) echo "Video" ;;
  *"SELECT COUNT"*) echo "0" ;;
esac
`,
  );

  await writeFile(
    path.join(fixtureDir, ".env"),
    `DATABASE_URL="file:./dev.db"
WHISPER_CLI="${path.join(venvBinDir, "whisper")}"
WHISPER_PYTHON_BIN="${path.join(venvBinDir, "python3")}"
`,
  );
  await writeFile(path.join(fixtureDir, "dev.db"), "");
  await writeFile(
    path.join(fixtureDir, "node_modules", ".prisma", "client", "index.js"),
    "",
  );

  t.after(() => rm(fixtureDir, { recursive: true, force: true }));
  return { fixtureDir, binDir };
}

async function runVerification(fixture) {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [verificationScript],
      {
        cwd: fixture.fixtureDir,
        env: {
          ...process.env,
          PATH: `${fixture.binDir}:/usr/bin:/bin`,
        },
      },
      (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout, stderr });
      },
    );
  });
}

test("setup verification fails when the better-sqlite3 native binding cannot load", async (t) => {
  const fixture = await createFixture(t, {
    nodeVersion: "24.18.0",
    nativeBindingLoads: false,
  });

  const result = await runVerification(fixture);

  assert.notEqual(result.code, 0, result.stdout);
  assert.match(result.stdout, /better-sqlite3 native binding/i);
});

test("setup verification rejects Node.js 18", async (t) => {
  const fixture = await createFixture(t, {
    nodeVersion: "18.20.0",
    nativeBindingLoads: true,
  });

  const result = await runVerification(fixture);

  assert.notEqual(result.code, 0, result.stdout);
  assert.match(result.stdout, /Node\.js 18\.20\.0 found but/i);
});

test("setup verification accepts Node.js 26 with a working native binding", async (t) => {
  const fixture = await createFixture(t, {
    nodeVersion: "26.5.0",
    nativeBindingLoads: true,
  });

  const result = await runVerification(fixture);

  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /better-sqlite3 native binding loads/i);
});

test("setup does not ignore verification failures", async () => {
  const setupSource = await readFile(
    path.join(repoRoot, "scripts", "setup.sh"),
    "utf8",
  );

  assert.doesNotMatch(setupSource, /test-setup\.sh\s*\|\|\s*true/);
});
