import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { HyperClient } from "hyperttp";

const projectRoot = path.resolve(import.meta.dirname, ".");
const isVerbose = process.argv.includes("--verbose");
const isBun = !!process.versions.bun;
const timeoutArg = process.argv.find((arg) => arg.startsWith("--timeout="));
const testTimeoutMs = timeoutArg ? Number(timeoutArg.slice("--timeout=".length)) : 30_000;

type TestEntry = { label: string; file: string };
type TestResult = { label: string; ok: boolean; ms: number };

// ----------------------------
// SCAN FILES
// ----------------------------
function scanDir(dir: string): TestEntry[] {
  const absDir = path.resolve(projectRoot, dir);
  if (!fs.existsSync(absDir)) return [];

  const entries: TestEntry[] = [];
  const items = fs
    .readdirSync(absDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const item of items) {
    const absPath = path.join(absDir, item.name);

    if (item.isDirectory()) {
      entries.push(...scanDir(path.relative(projectRoot, absPath)));
    } else if (item.isFile() && item.name.endsWith(".ts")) {
      entries.push({
        label: path.relative(projectRoot, absPath),
        file: absPath,
      });
    }
  }

  return entries;
}

const includeSpotifyApi = process.argv.includes("--include-spotify-api");

const SPOTIFY_API_EXAMPLES = new Set([
  "example/album.ts",
  "example/playlist.ts",
  "example/search.ts",
]);

const allTests = scanDir("example");

const tests = allTests.filter(
  ({ label }) =>
    includeSpotifyApi || !SPOTIFY_API_EXAMPLES.has(label),
);

const skipped = allTests.length - tests.length;

if (skipped > 0) {
  console.log(
    chalk.yellow(`Skipping ${skipped} Spotify Web API integration examples.`),
  );
}

// ----------------------------
// RUN SINGLE TEST
// ----------------------------
async function runOne(test: TestEntry): Promise<TestResult> {
  if (!fs.existsSync(test.file)) {
    console.log(`${chalk.dim("→")} ${chalk.bold(test.label)} ${chalk.yellow("⚠ missing")}`);
    return { label: test.label, ok: false, ms: 0 };
  }

  console.log(`${chalk.dim("→")} ${chalk.bold(test.label)} ${chalk.gray("running...")}`);

  const start = performance.now();

  const cmd = process.execPath;
  const args = isBun ? [test.file] : ["--import", "tsx", test.file];

  const child = spawn(cmd, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
    },
    stdio: isVerbose ? "inherit" : ["ignore", "pipe", "pipe"],
  });

  let output = "";

  if (!isVerbose) {
    child.stdout?.on("data", (d) => {
      output += d.toString();
    });

    child.stderr?.on("data", (d) => {
      output += d.toString();
    });
  }

  return new Promise<TestResult>((resolve) => {
    let settled = false;
    let timedOut = false;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const ms = Math.round(performance.now() - start);
      const ok = !timedOut && code === 0;

      console.log(
        `${chalk.dim("←")} ${chalk.bold(test.label)} ${
          ok ? chalk.green("✔") : chalk.red(timedOut ? "✖ timeout" : "✖")
        } ${chalk.gray(`[${ms}ms]`)}`,
      );

      if (!ok && output.trim() && !isVerbose) {
        console.log(chalk.gray(output.trim().split("\n").slice(-10).join("\n")));
      }

      resolve({ label: test.label, ok, ms });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1_000).unref();
    }, testTimeoutMs);

    child.once("error", (error) => {
      console.error(`Failed to start ${test.label}: ${error.message}`);
      finish(1);
    });
    child.once("close", (code) => finish(code));
  });
}

// ----------------------------
// MAIN
// ----------------------------
(async () => {
  if (!Number.isSafeInteger(testTimeoutMs) || testTimeoutMs <= 0 || testTimeoutMs > 2_147_483_647) {
    throw new Error("--timeout must be a positive integer in milliseconds (maximum 2147483647)");
  }
  const runtime = isBun ? chalk.yellow("Bun") : chalk.green("Node/tsx");
  const core = new HyperClient();

  console.log(chalk.cyan(`\n🚀 Smoke tests (${runtime})\n`));
  console.log(chalk.cyan(`Transport: ${await core.getTransportName()}`));
  console.log(chalk.gray(`Timeout: ${testTimeoutMs}ms per example. Unit tests: bun run vitest\n`));

  const results = [];

  for (const test of tests) {
    results.push(await runOne(test));
  }

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;

  console.log(chalk.cyan("\n═ Summary ═══════════════════════════"));

  for (const r of results) {
    console.log(
      `${r.ok ? chalk.green("✔") : chalk.red("✖")} ${r.label} ${chalk.gray(`[${r.ms}ms]`)}`,
    );
  }

  console.log(`\nTotal: ${results.length} | ${chalk.green(ok)} ok | ${chalk.red(fail)} failed\n`);

  process.exit(fail > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
