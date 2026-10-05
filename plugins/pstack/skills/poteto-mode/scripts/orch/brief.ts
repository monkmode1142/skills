import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export const BRIEF_FIELDS = [
  "GOAL",
  "SCOPE",
  "CONTEXT",
  "PREMISES",
  "ACCEPTANCE",
  "VERIFY",
  "TIMEBOX",
  "FORBIDDEN",
  "REPORT",
  "STANDING",
] as const;

export const EFFECT_DELEGATE_LINES = [
  "Load the **effect** skill and run its §1 version gate before writing code. Follow the installed version where it differs.",
  "Before reporting done, run the effect skill's §8 checklist and include its result.",
  "Before writing a helper for time, retry, polling, cache, queue, lock, parsing, ordering, grouping, decimal, graph or LLM I/O, search the installed effect (`references/primitives.md`, `modules.md`, review.md catalog A). Report each hand-rolled capability with the export checked (`dist/…:line`) and why it does not fit, or `none`.",
] as const;

export interface BriefCheckOptions {
  readonly repo?: string;
}

const EFFECT_MENTION = /\bEffect\b|\beffect skill\b|@effect\/|\beffect@/;
const EFFECT_MAP = /^\s*EFFECT MAP\b[ \t:]*/;
const DIST_CITATION = /\bdist\/([^\s:;,()`'"]+):(\d+)/g;
const REPO_LINE = /\bRepo\s+(\/[^\s;,`]+)/;

export function isEffectBrief(text: string): boolean {
  return EFFECT_MENTION.test(text);
}

function fieldBodies(text: string): ReadonlyMap<string, string> {
  const bodies = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const match = /^([A-Z]+)\b[ \t:]*(.*)$/.exec(line);
    const name = match?.[1];
    if (name !== undefined && (BRIEF_FIELDS as readonly string[]).includes(name)) {
      current = [match?.[2] ?? ""];
      bodies.set(name, current);
    } else if (current !== null) {
      current.push(line);
    }
  }
  return new Map(
    [...bodies].map(([name, lines]) => [name, lines.join("\n").trim()])
  );
}

function effectMap(context: string): string | null {
  const lines = context.split("\n");
  const start = lines.findIndex((line) => EFFECT_MAP.test(line));
  if (start < 0) {
    return null;
  }
  return [
    (lines[start] ?? "").replace(EFFECT_MAP, ""),
    ...lines.slice(start + 1),
  ]
    .join("\n")
    .trim();
}

async function effectRootFrom(directory: string): Promise<string | null> {
  try {
    return await realpath(
      dirname(Bun.resolveSync("effect/package.json", directory))
    );
  } catch {
    return null;
  }
}

async function effectVersion(root: string): Promise<string> {
  const manifest: unknown = JSON.parse(
    await readFile(join(root, "package.json"), "utf8")
  );
  return typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
    ? manifest.version
    : "unknown";
}

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

async function citationProblem(
  root: string,
  path: string,
  line: number
): Promise<string | null> {
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

async function effectMapProblems(
  text: string,
  context: string,
  options: BriefCheckOptions
): Promise<readonly string[]> {
  const map = effectMap(context);
  if (map === null) {
    return [
      "Effect brief lacks an EFFECT MAP block in CONTEXT (references/effect.md, Delegating Effect work)",
    ];
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

export async function briefProblems(
  text: string,
  standing: readonly string[],
  options: BriefCheckOptions = {}
): Promise<readonly string[]> {
  const bodies = fieldBodies(text);
  const problems: string[] = [];
  for (const field of BRIEF_FIELDS) {
    const body = bodies.get(field);
    if (body === undefined) {
      problems.push(`missing ${field}`);
    } else if (body.length === 0 && field !== "STANDING") {
      problems.push(`empty ${field}`);
    }
  }
  const standingBody = bodies.get("STANDING") ?? "";
  const missingOrders = standing.filter((line) => !standingBody.includes(line));
  if (missingOrders.length > 0) {
    problems.push(
      `STANDING lacks ${missingOrders.length} of ${standing.length} current standing orders; paste preferences.md verbatim (orch standing show)`
    );
  }
  if (isEffectBrief(text)) {
    for (const line of EFFECT_DELEGATE_LINES) {
      if (!text.includes(line)) {
        problems.push(
          `Effect brief lacks the delegate line from references/effect.md: "${line}"`
        );
      }
    }
    problems.push(
      ...(await effectMapProblems(text, bodies.get("CONTEXT") ?? "", options))
    );
  }
  return problems;
}
