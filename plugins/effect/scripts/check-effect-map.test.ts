import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectMapProblems } from "./check-effect-map.ts";

const SCRIPT = join(import.meta.dir, "check-effect-map.ts");
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fakeEffect(packageDir: string, version: string): Promise<void> {
  const root = join(packageDir, "node_modules", "effect");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "effect", version }));
  await writeFile(
    join(root, "dist", "Schedule.d.ts"),
    "export {}\nexport declare const exponential: unknown\nexport declare const spaced: unknown\n"
  );
}

async function monorepo(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "effect-map-"));
  directories.push(directory);
  await fakeEffect(join(directory, "packages", "app"), "4.0.0");
  await fakeEffect(join(directory, "packages", "legacy"), "4.0.0-beta.102");
  return directory;
}

function brief(map: string | null, repo?: string): string {
  return [
    "GOAL         Bound the export retries.",
    `CONTEXT      docs/export.md${repo === undefined ? "" : `; Repo ${repo}.`}`,
    ...(map === null ? [] : [`             ${map}`]),
    "",
    "VERIFY       bun test src/export",
  ].join("\n");
}

describe("check-effect-map", () => {
  it("passes a map that names no dist path, and refuses a missing or empty one", async () => {
    expect(await effectMapProblems(brief("EFFECT MAP: none, string formatting only"))).toEqual([]);
    expect(await effectMapProblems(brief(null))).toEqual(["no EFFECT MAP block"]);
    expect(await effectMapProblems(brief("EFFECT MAP"))).toEqual([
      "EFFECT MAP is empty; name each capability with the export checked (dist/<file>:<line>), or none with the reason",
    ]);
  });

  it("resolves citations under the stable installed effect and reports each bad one", async () => {
    const repo = await monorepo();
    const root = realpathSync(join(repo, "packages", "app", "node_modules", "effect"));
    expect(
      await effectMapProblems(brief("EFFECT MAP: retry: Schedule.exponential (dist/Schedule.d.ts:2)", repo))
    ).toEqual([]);
    expect(
      await effectMapProblems(
        brief("EFFECT MAP: retry: dist/Schedule.d.ts:9; cache: dist/Cachez.d.ts:1; poll: dist/../package.json:1", repo)
      )
    ).toEqual([
      `EFFECT MAP cites dist/Schedule.d.ts:9, which does not resolve under ${root} (file has 3 lines)`,
      `EFFECT MAP cites dist/Cachez.d.ts:1, which does not resolve under ${root} (no such file)`,
      `EFFECT MAP cites dist/../package.json:1, which does not resolve under ${root} (path leaves dist)`,
    ]);
  });

  it("needs a repo for citations, and refuses an ambiguous one", async () => {
    const repo = await monorepo();
    const cited = brief("EFFECT MAP: retry: dist/Schedule.d.ts:2");
    expect(await effectMapProblems(cited)).toEqual([
      'EFFECT MAP cites dist paths but no repo is known; pass --repo <dir> or name "Repo <dir>" in the brief',
    ]);
    expect(await effectMapProblems(cited, { repo: join(repo, "packages", "app") })).toEqual([]);

    await fakeEffect(join(repo, "packages", "other"), "4.0.1");
    const problems = await effectMapProblems(brief("EFFECT MAP: retry: dist/Schedule.d.ts:2", repo));
    expect(problems.length).toBe(1);
    expect(problems[0]).toStartWith(`ambiguous installed effect under ${repo}:`);
  });

  it("exits nonzero with the problems on stdout, as an orch field check", async () => {
    const repo = await monorepo();
    const file = join(repo, "brief.md");
    await writeFile(file, brief("EFFECT MAP: retry: dist/Nope.d.ts:1", repo));
    const bad = Bun.spawnSync([process.execPath, SCRIPT, file]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stdout.toString()).toContain("EFFECT MAP cites dist/Nope.d.ts:1");
    await writeFile(file, brief("EFFECT MAP: retry: dist/Schedule.d.ts:2", repo));
    expect(Bun.spawnSync([process.execPath, SCRIPT, file]).exitCode).toBe(0);
  });
});
