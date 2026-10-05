#!/usr/bin/env bun
// Checks a delegate brief's EFFECT MAP block: every `dist/<file>:<line>` it cites must
// resolve under the repo's installed effect. pstack's orchestrator runs it as a field check:
//   orch brief require "EFFECT MAP" --check "bun <effect plugin>/scripts/check-effect-map.ts"
// Usage: bun check-effect-map.ts [--repo <dir>] <brief.md>
// The repo comes from --repo or the brief's `Repo <dir>` line.
import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const EFFECT_MAP = /^\s*EFFECT MAP\b[ \t:]*/;
const DIST_CITATION = /\bdist\/([^\s:;,()`'"]+):(\d+)/g;
const REPO_LINE = /\bRepo\s+(\/[^\s;,`]+)/;

function effectMap(text: string): string | null {
  const lines = text.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((line) => EFFECT_MAP.test(line));
  if (start < 0) {
    return null;
  }
  const body = [(lines[start] ?? "").replace(EFFECT_MAP, "")];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0 || /^[A-Z]{2,}\b/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join("\n").trim();
}

async function effectRootFrom(directory: string): Promise<string | null> {
  try {
    return await realpath(dirname(Bun.resolveSync("effect/package.json", directory)));
  } catch {
    return null;
  }
}

async function effectVersion(root: string): Promise<string> {
  const manifest: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  return typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
    ? manifest.version
    : "unknown";
}

// A monorepo can hold several effect copies; prefer the single stable release.
async function installedEffect(
  repo: string
): Promise<{ readonly root: string } | { readonly problem: string }> {
  const direct = await effectRootFrom(repo);
  if (direct !== null) {
    return { root: direct };
  }
  let packages: readonly string[] = [];
  try {
    packages = (await readdir(join(repo, "packages"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repo, "packages", entry.name));
  } catch {
    packages = [];
  }
  const roots = new Set<string>();
  for (const directory of packages) {
    const root = await effectRootFrom(directory);
    if (root !== null) {
      roots.add(root);
    }
  }
  const found = await Promise.all(
    [...roots].sort().map(async (root) => ({ root, version: await effectVersion(root) }))
  );
  const stable = found.filter((install) => !install.version.includes("-"));
  const only = found.length === 1 ? found[0] : stable.length === 1 ? stable[0] : undefined;
  if (only !== undefined) {
    return { root: only.root };
  }
  return found.length === 0
    ? { problem: `no installed effect under ${repo}; pass --repo <package dir>` }
    : {
        problem: `ambiguous installed effect under ${repo}: ${found
          .map((install) => `${install.root} (${install.version})`)
          .join(", ")}; pass --repo <package dir>`,
      };
}

async function citationProblem(root: string, path: string, line: number): Promise<string | null> {
  const dist = join(root, "dist");
  const file = resolve(dist, path);
  const where = `EFFECT MAP cites dist/${path}:${line}, which does not resolve under ${root}`;
  if (!file.startsWith(`${dist}${sep}`)) {
    return `${where} (path leaves dist)`;
  }
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return `${where} (no such file)`;
  }
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return line >= 1 && line <= lines ? null : `${where} (file has ${lines} lines)`;
}

export async function effectMapProblems(
  text: string,
  options: { readonly repo?: string } = {}
): Promise<readonly string[]> {
  const map = effectMap(text);
  if (map === null) {
    return ["no EFFECT MAP block"];
  }
  if (map.length === 0) {
    return [
      "EFFECT MAP is empty; name each capability with the export checked (dist/<file>:<line>), or none with the reason",
    ];
  }
  const citations = [...map.matchAll(DIST_CITATION)];
  if (citations.length === 0) {
    return [];
  }
  const repo = options.repo ?? REPO_LINE.exec(text)?.[1]?.replace(/[.)]+$/, "");
  if (repo === undefined) {
    return [
      'EFFECT MAP cites dist paths but no repo is known; pass --repo <dir> or name "Repo <dir>" in the brief',
    ];
  }
  const install = await installedEffect(repo);
  if ("problem" in install) {
    return [install.problem];
  }
  const problems = await Promise.all(
    citations.map((citation) =>
      citationProblem(install.root, citation[1] ?? "", Number(citation[2]))
    )
  );
  return problems.filter((problem) => problem !== null);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const repoAt = args.indexOf("--repo");
  const repo = repoAt >= 0 ? args[repoAt + 1] : undefined;
  const brief = (repoAt < 0 ? args : args.filter((_, index) => index !== repoAt && index !== repoAt + 1))[0];
  if (brief === undefined || (repoAt >= 0 && repo === undefined)) {
    console.error("usage: bun check-effect-map.ts [--repo <dir>] <brief.md>");
    process.exit(2);
  }
  const problems = await effectMapProblems(await readFile(brief, "utf8"), { repo });
  if (problems.length > 0) {
    console.log(problems.join("\n"));
    process.exit(1);
  }
}
