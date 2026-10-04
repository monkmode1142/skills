import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const scriptsDirectory = import.meta.dir;
const STALE_LOCK_MS = 10 * 60 * 1000;
const LOCK_WAIT_MS = 3 * 60 * 1000;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

export function missingDependencies(directory: string): string[] {
  const manifest = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  return Object.entries(manifest.dependencies ?? {})
    .filter(([name, spec]) => {
      const installed = join(directory, "node_modules", name, "package.json");
      if (!existsSync(installed)) return true;
      if (!EXACT_VERSION.test(spec)) return false;
      try {
        const { version } = JSON.parse(readFileSync(installed, "utf8")) as {
          version?: string;
        };
        return version !== spec;
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
}

function isWritable(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(lockPath: string): () => void {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lockPath, "wx"));
      return () => rmSync(lockPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for another install to finish (${lockPath}). Remove it if no install is running.`
        );
      }
      Bun.sleepSync(250);
    }
  }
}

export function ensureDependenciesInstalled(): void {
  const missing = missingDependencies(scriptsDirectory);
  if (missing.length === 0) return;

  if (!isWritable(scriptsDirectory)) {
    throw new Error(
      `poteto-mode tools are missing ${missing.join(", ")} and ${scriptsDirectory} is not writable from here, likely a sandbox. Run \`bun install --frozen-lockfile\` in ${scriptsDirectory} outside the sandbox, then retry.`
    );
  }

  const release = acquireLock(join(scriptsDirectory, ".install.lock"));
  try {
    if (missingDependencies(scriptsDirectory).length > 0) {
      const result = Bun.spawnSync(
        [process.execPath, "install", "--frozen-lockfile"],
        { cwd: scriptsDirectory }
      );
      if (result.exitCode !== 0) {
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
        throw new Error(
          `bun install --frozen-lockfile exited with status ${result.exitCode} in ${scriptsDirectory}`
        );
      }
      const stillMissing = missingDependencies(scriptsDirectory);
      if (stillMissing.length > 0) {
        throw new Error(
          `bun install --frozen-lockfile completed without installing ${stillMissing.join(", ")}`
        );
      }
    }
  } finally {
    release();
  }

  const restarted = Bun.spawnSync([process.execPath, ...process.argv.slice(1)], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(restarted.exitCode ?? 1);
}
