import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missingDependencies } from "./bootstrap.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function fixture(installed: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bootstrap-test-"));
  directories.push(directory);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ dependencies: { commander: "14.0.0", loose: "^1.0.0" } })
  );
  for (const [name, version] of Object.entries(installed)) {
    await mkdir(join(directory, "node_modules", name), { recursive: true });
    await writeFile(join(directory, "node_modules", name, "package.json"), JSON.stringify({ version }));
  }
  return directory;
}

describe("missingDependencies", () => {
  it("passes when every dependency resolves at its pinned version, with no marker file", async () => {
    expect(missingDependencies(await fixture({ commander: "14.0.0", loose: "1.9.0" }))).toEqual([]);
  });

  it("reports a dependency that is absent", async () => {
    expect(missingDependencies(await fixture({ loose: "1.0.0" }))).toEqual(["commander"]);
  });

  it("reports an exact pin whose installed version drifted", async () => {
    expect(missingDependencies(await fixture({ commander: "13.1.0", loose: "1.0.0" }))).toEqual(["commander"]);
  });
});
