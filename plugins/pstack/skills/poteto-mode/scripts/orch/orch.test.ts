import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NotFoundError,
  UserError,
  goalLine,
  openStore,
  parseVerdict,
  type OpenStoreOptions,
  type Store,
} from "./store.ts";

const SCRIPT = join(import.meta.dir, "orch.ts");

function briefText(standing: readonly string[] = []): string {
  return [
    "GOAL         Parse the export into typed rows.",
    "SCOPE        src/export/**; not src/store/**; branch u1",
    "CONTEXT      docs/export.md",
    "PREMISES     export format: evidence/export-sample.md",
    "ACCEPTANCE   rows parse; bad rows fail typed",
    "VERIFY       bun test src/export",
    "TIMEBOX      45m",
    "FORBIDDEN    no rebase, no force-push",
    "REPORT       status, branch, head SHA, commands run",
    "STANDING",
    ...standing.map((line, index) => `${index + 1}. ${line}`),
    "",
  ].join("\n");
}

async function writeBrief(
  directory: string,
  name = "briefs/u1.md",
  text = briefText()
): Promise<string> {
  await mkdir(join(directory, "briefs"), { recursive: true });
  await writeFile(join(directory, name), text);
  return name;
}

async function storeWithGoal(): Promise<{
  readonly directory: string;
  readonly store: Store;
}> {
  const { directory, store } = await initializedStore();
  await writeBrief(directory);
  await store.goals.add({
    id: "G1",
    outcome: "Operator sees last week from real data",
    check: "weekly review renders from a live sync",
  });
  return { directory, store };
}
const directories: string[] = [];
const handles: Store[] = [];

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "orch-test-"));
  directories.push(directory);
  return directory;
}

function useStore(
  directory: string,
  options?: OpenStoreOptions
): Store {
  const store = openStore(directory, options);
  handles.push(store);
  return store;
}

async function initializedStore(): Promise<{
  readonly directory: string;
  readonly store: Store;
}> {
  const directory = await makeDirectory();
  const store = useStore(directory);
  await store.init();
  return { directory, store };
}

function git({
  args,
  repo,
}: {
  args: readonly string[];
  repo: string;
}): string {
  const result = Bun.spawnSync(["git", "-C", repo, ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString()}`
    );
  }
  return result.stdout.toString().trim();
}

async function makeGitStack(directory: string): Promise<{
  readonly repo: string;
  readonly mergedSha: string;
  readonly closedSha: string;
  readonly openSha: string;
}> {
  const repo = join(directory, "repo");
  await mkdir(repo);
  git({ repo, args: ["init", "--initial-branch=main"] });
  git({ repo, args: ["config", "user.name", "Orch Test"] });
  git({ repo, args: ["config", "user.email", "orch@example.com"] });
  await writeFile(join(repo, "main.txt"), "main\n");
  git({ repo, args: ["add", "."] });
  git({ repo, args: ["commit", "-m", "main"] });

  const branches = ["stack/merged", "stack/closed", "stack/open"];
  for (const [index, branch] of branches.entries()) {
    git({ repo, args: ["checkout", "-b", branch] });
    await writeFile(join(repo, `stack-${index}.txt`), `${branch}\n`);
    git({ repo, args: ["add", "."] });
    git({ repo, args: ["commit", "-m", branch] });
  }

  return {
    repo,
    mergedSha: git({ repo, args: ["rev-parse", "stack/merged"] }),
    closedSha: git({ repo, args: ["rev-parse", "stack/closed"] }),
    openSha: git({ repo, args: ["rev-parse", "stack/open"] }),
  };
}

async function withFakeGt<T>({
  directory,
  operation,
  output,
}: {
  directory: string;
  operation: (outputPath: string) => Promise<T>;
  output: string;
}): Promise<T> {
  const bin = join(directory, "bin");
  const outputPath = join(directory, "gt-output.txt");
  await mkdir(bin);
  await writeFile(outputPath, output);
  const gt = join(bin, "gt");
  await writeFile(
    gt,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$(pwd -P)" != "${realpathSync(join(directory, "repo"))}" ]; then
  printf 'gt ran outside the fixture repo: %s\\n' "$(pwd -P)" >&2
  exit 2
fi
case "$*" in
  "--no-interactive log short --stack --reverse")
    cat "${outputPath}"
    ;;
  "--no-interactive info stack/merged")
    printf 'stack/merged\\nPR #10 (Merged) merged change\\n'
    ;;
  "--no-interactive info stack/closed")
    printf 'stack/closed\\nPR #13 (Closed) closed change\\n'
    ;;
  "--no-interactive info stack/open")
    printf 'stack/open\\nPR #11 (Needs approvals) open change\\n'
    ;;
  *)
    printf 'unexpected gt arguments: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`
  );
  await chmod(gt, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  try {
    return await operation(outputPath);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
}

function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env
): RunResult {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...args], { env });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

afterEach(async () => {
  for (const store of handles.splice(0).reverse()) {
    await store.close();
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Store", () => {
  it("initializes an idempotent plain-file store and releases its lock", async () => {
    const directory = await makeDirectory();
    const store = useStore(directory);

    expect(await store.init()).toEqual({ store: directory });
    const firstUnits = await readFile(join(directory, "units.tsv"), "utf8");
    const firstLedger = await readFile(
      join(directory, "ledger.tsv"),
      "utf8"
    );

    expect(await store.init()).toEqual({ store: directory });
    expect(await readFile(join(directory, "units.tsv"), "utf8")).toBe(
      firstUnits
    );
    expect(await readFile(join(directory, "ledger.tsv"), "utf8")).toBe(
      firstLedger
    );
    expect((await readdir(directory)).sort()).toEqual([
      ".orch.lock",
      "frontier.json",
      "gates.md",
      "goals.tsv",
      "inbox",
      "ledger.tsv",
      "preferences.md",
      "units.tsv",
    ]);

    await store.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("composes unit add, set, get, list, and counts", async () => {
    const { store } = await storeWithGoal();

    expect(
      await store.units.add({
        id: "u1",
        track: "build",
        brief: "briefs/u1.md",
        serves: "G1",
      })
    ).toMatchObject({ id: "u1", state: "pending", serves: "G1" });
    expect(
      await store.units.add({
        id: "=SUM(A1)",
        track: "+build",
        brief: "briefs/u1.md",
        serves: "G1",
      })
    ).toMatchObject({ id: "'=SUM(A1)", track: "'+build" });

    const updated = await store.units.set({
      id: "u1",
      state: "done",
      branch: "poteto/u1",
      pr: 184530,
      sha: "abc123",
    });
    expect(updated).toEqual({
      id: "u1",
      track: "build",
      state: "done",
      branch: "poteto/u1",
      pr: "184530",
      sha: "abc123",
      brief: "briefs/u1.md",
      serves: "G1",
    });
    expect(await store.units.get("u1")).toEqual(updated);
    expect(
      await store.units.list({ state: "done", track: "build" })
    ).toEqual([updated]);
    expect(await store.units.counts()).toEqual({ done: 1, pending: 1 });
    await expect(
      store.units.add({
        id: "u1",
        track: "build",
        brief: "briefs/u1.md",
        serves: "G1",
      })
    ).rejects.toThrow("unit u1 already exists");
    await expect(
      store.units.set({ id: "missing", state: "done" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records, replaces, checks, and summarizes typed ledger verdicts", async () => {
    const { store } = await initializedStore();

    try {
      await store.ledger.check({ pr: 184530, sha: "abc123" });
      throw new Error("expected ledger check to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      if (error instanceof NotFoundError) {
        expect(error.output).toEqual({
          compact: "NOT-VERIFIED",
          json: {
            pr: "184530",
            sha: "abc123",
            verdict: "NOT-VERIFIED",
          },
        });
      }
    }
    expect(() => parseVerdict("looks-good")).toThrow("verdict must be");

    const recorded = await store.ledger.record({
      pr: 184530,
      sha: "abc123",
      verdict: "unit-test-verified",
      evidence: "reports/verify.md",
      verifier: "sol",
    });
    expect(await store.ledger.check({ pr: 184530, sha: "abc123" })).toEqual(
      recorded
    );
    expect(await store.ledger.summary()).toEqual({
      "unit-test-verified": 1,
    });

    await store.ledger.record({
      pr: 184530,
      sha: "abc123",
      verdict: "live-ui-verified",
      evidence: "reports/live.md",
    });
    expect(await store.ledger.summary()).toEqual({
      "live-ui-verified": 1,
    });
  });

  it("pushes, peeks, and atomically drains inbox pointers", async () => {
    const { directory, store } = await initializedStore();

    const first = await store.inbox.push({
      agent: "worker-1",
      unit: "u1",
      status: "done",
      report: "reports/u1.md",
    });
    expect(first.pointer).toMatchObject({ unit: "u1", status: "done" });
    expect(first.filename).toEndWith(".tsv");
    await store.inbox.push({
      agent: "worker-2",
      unit: "u2",
      status: "failed",
    });

    expect(await store.inbox.count()).toBe(2);
    expect(await store.inbox.peek()).toHaveLength(2);
    expect(await store.inbox.count()).toBe(2);
    expect(await store.inbox.drain()).toHaveLength(2);
    expect(await store.inbox.count()).toBe(0);
    expect(await readdir(join(directory, "inbox"))).toEqual([]);
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith(".inbox-drain-")
      )
    ).toEqual([]);
  });

  it("replaces a stale lock whose holder pid is dead", async () => {
    const { directory } = await initializedStore();
    const exited = Bun.spawn(["true"]);
    await exited.exited;
    await writeFile(join(directory, ".orch.lock"), `${exited.pid}\n`);

    const stale: string[] = [];
    const recovered = useStore(directory, {
      onStaleLock: (holder) => stale.push(holder),
    });
    expect(
      await recovered.goals.add({ id: "u1", outcome: "o", check: "c" })
    ).toMatchObject({ id: "u1" });
    expect(stale).toEqual([String(exited.pid)]);
    await recovered.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("blocks a writer and steals the pid lock only with force", async () => {
    const { directory, store } = await initializedStore();
    await store.close();
    await writeFile(join(directory, ".orch.lock"), `${process.pid}\n`);

    const blocked = useStore(directory);
    await expect(
      blocked.goals.add({ id: "u1", outcome: "o", check: "c" })
    ).rejects.toThrow(`store lock held by pid ${process.pid}`);

    const stolen: string[] = [];
    const forced = useStore(directory, {
      force: true,
      onLockStolen: (holder) => stolen.push(holder),
    });
    expect(
      await forced.goals.add({ id: "u1", outcome: "o", check: "c" })
    ).toMatchObject({ id: "u1" });
    expect(stolen).toEqual([String(process.pid)]);
    await forced.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("parks gates, stores standing orders, and renders status", async () => {
    const { directory, store } = await storeWithGoal();
    await store.units.add({
      id: "u1",
      track: "build",
      brief: "briefs/u1.md",
      serves: "G1",
    });
    expect(
      await store.gates.park({
        id: "release",
        question: "Ship now?",
        options: "ship,wait",
        defaultAnswer: "wait",
      })
    ).toMatchObject({ kind: "open", id: "release" });
    expect(
      await store.standing.add({ line: "Never force push." })
    ).toEqual({ number: 1, line: "Never force push." });

    const first = await store.status.render();
    expect(first.changed).toBe("first render");
    expect(first.summary.openGateIds).toEqual(["release"]);
    expect(await readFile(join(directory, "status.md"), "utf8")).toContain(
      "| release | open | Ship now? |"
    );
    expect((await store.status.render()).changed).toBe("no derived changes");

    expect(
      await store.gates.resolve({ id: "release", answer: "ship" })
    ).toMatchObject({ kind: "resolved", answer: "ship" });
    expect((await store.status.render()).changed).toBe("open gates 1->0");
    expect(await store.gates.list()).toEqual([]);
    expect(await store.standing.show()).toEqual([
      { number: 1, line: "Never force push." },
    ]);
    await writeFile(
      join(directory, "preferences.md"),
      "STOP: no new spawns until the target is agreed.\n1. Never force push.\n"
    );
    expect(await store.standing.show()).toEqual([
      { number: 1, line: "Never force push." },
    ]);
    expect(await store.briefs.check("briefs/u1.md")).toEqual([
      "STANDING lacks 2 of 2 current standing orders; paste preferences.md verbatim (orch standing show)",
    ]);
    await store.standing.add({ line: "Land only verified units." });
    expect(await readFile(join(directory, "preferences.md"), "utf8")).toBe(
      "STOP: no new spawns until the target is agreed.\n1. Never force push.\n2. Land only verified units.\n"
    );
  });

  it("resolves the ordered Graphite frontier and validates an optional pin", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const output = `◯ main
◯ stack/merged
◯ stack/closed
◉ stack/open (current)
`;

    await withFakeGt({
      directory,
      output,
      operation: async () => {
        expect(await store.frontier.set({ repo: stack.repo })).toEqual({
          generation: 1,
          prs: [
            {
              pr: 10,
              branches: "stack/merged",
              sha: stack.mergedSha,
              state: "MERGED",
            },
            {
              pr: 13,
              branches: "stack/closed",
              sha: stack.closedSha,
              state: "CLOSED",
            },
            {
              pr: 11,
              branches: "stack/open",
              sha: stack.openSha,
              state: "OPEN",
            },
          ],
          lowestUnmerged: 11,
        });
        expect(
          (
            await store.frontier.set({
              repo: stack.repo,
              prs: [10, 13, 11],
            })
          ).generation
        ).toBe(2);
        expect((await store.frontier.show()).generation).toBe(2);
        await expect(
          store.frontier.set({
            repo: stack.repo,
            prs: [10, 11, 12],
          })
        ).rejects.toThrow(
          "frontier pin mismatch: missing from gt: 12; extra in gt: 13"
        );
        await expect(
          store.frontier.set({
            repo: stack.repo,
            prs: [13, 10, 11],
          })
        ).rejects.toThrow(
          "frontier pin mismatch: order differs: expected 13,10,11; gt 10,13,11"
        );
        await expect(
          store.frontier.set({
            repo: stack.repo,
            prs: [10, 10],
          })
        ).rejects.toThrow("--prs must not contain duplicates");
      },
    });
  });

  it("rejects unparseable Graphite output loudly", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGt({
      directory,
      output: "◯ main\nthis line is not Graphite output\n",
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo })
        ).rejects.toThrow(
          'gt log short output has an unparseable line 2: "this line is not Graphite output"'
        );
      },
    });
  });

  it("rejects malformed TSV, verdict, frontier, and inbox data", async () => {
    const { directory, store } = await initializedStore();

    await writeFile(join(directory, "units.tsv"), "wrong\n");
    await expect(store.units.list()).rejects.toThrow(
      "units.tsv has an invalid header"
    );
    await writeFile(
      join(directory, "units.tsv"),
      "id\ttrack\tstate\tbranch\tpr\tsha\tbrief\nshort\trow\n"
    );
    await expect(store.units.list()).rejects.toThrow(
      "units.tsv has a malformed row"
    );

    await writeFile(
      join(directory, "ledger.tsv"),
      "pr\tsha\tverdict\tevidence\tverifier\tts\n1\tsha\tinvalid\treport\tme\tnow\n2\tsha2\tunit-test-verified\treport\tme\tnow\n"
    );
    expect(await store.ledger.summary()).toEqual({ "unit-test-verified": 1 });
    await expect(store.ledger.check({ pr: 1, sha: "sha" })).rejects.toThrow(
      "NOT-VERIFIED"
    );
    await expect(
      store.ledger.record({ pr: 3, sha: "sha3", verdict: "unit-test-verified", evidence: "report" })
    ).rejects.toThrow("has invalid verdict invalid. Fix or remove that row");
    expect(await readFile(join(directory, "ledger.tsv"), "utf8")).toContain(
      "1\tsha\tinvalid"
    );

    await writeFile(join(directory, "frontier.json"), '{"generation":"1"}\n');
    await expect(store.frontier.show()).rejects.toThrow(
      "frontier.json has an invalid shape"
    );

    await writeFile(join(directory, "inbox", "bad.tsv"), "too\tshort\n");
    await expect(store.inbox.peek()).rejects.toThrow(
      "inbox pointer bad.tsv is malformed"
    );
  });

  it("refuses briefs missing template fields, standing orders, or Effect delegate lines", async () => {
    const { directory, store } = await storeWithGoal();
    await store.standing.add({ line: "Never force push." });

    const adHoc = await writeBrief(
      directory,
      "briefs/ad-hoc.md",
      [
        "# K1: cache parsed exports",
        "Read the poteto-mode skill. Effect 4.0.0 version gate first; finish with the effect skill's §8 checklist.",
        "## Why",
        "Parsing runs twice per request.",
        "## Contract",
        "1. A cache keyed by export hash.",
        "## Report",
        "End with branch and head sha.",
      ].join("\n")
    );
    expect(await store.briefs.check(adHoc)).toEqual([
      "missing GOAL",
      "missing SCOPE",
      "missing CONTEXT",
      "missing PREMISES",
      "missing ACCEPTANCE",
      "missing VERIFY",
      "missing TIMEBOX",
      "missing FORBIDDEN",
      "missing REPORT",
      "missing STANDING",
      "STANDING lacks 1 of 1 current standing orders; paste preferences.md verbatim (orch standing show)",
      'Effect brief lacks the delegate line from references/effect.md: "Load the **effect** skill and run its §1 version gate before writing code. Follow the installed version where it differs."',
      'Effect brief lacks the delegate line from references/effect.md: "Before reporting done, run the effect skill\'s §8 checklist and include its result."',
      `Effect brief lacks the delegate line from references/effect.md: "${THIRD_LINE}"`,
      "Effect brief lacks an EFFECT MAP block in CONTEXT (references/effect.md, Delegating Effect work)",
    ]);
    await expect(
      store.units.add({ id: "k1", track: "build", brief: adHoc, serves: "G1" })
    ).rejects.toThrow("brief briefs/ad-hoc.md is not spawnable: missing GOAL;");

    expect(await store.briefs.check("briefs/u1.md")).toEqual([
      "STANDING lacks 1 of 1 current standing orders; paste preferences.md verbatim (orch standing show)",
    ]);
    await writeBrief(directory, "briefs/u1.md", briefText(["Never force push."]));
    expect(await store.briefs.check("briefs/u1.md")).toEqual([]);
    expect(await store.briefs.check("briefs/missing.md")).toEqual([
      "brief briefs/missing.md not found (relative paths resolve from the store)",
    ]);
  });

  it("links every unit to a goal and reports progress and off-goal share per goal", async () => {
    const { directory, store } = await storeWithGoal();

    await expect(
      store.units.add({ id: "l1", track: "build", brief: "briefs/u1.md", serves: "G9" })
    ).rejects.toThrow("goal G9 is not in goals.tsv (have: G1)");
    await expect(
      store.units.add({ id: "l1", track: "build", brief: "briefs/u1.md", serves: "none" })
    ).rejects.toThrow("--reason for an off-goal unit must not be empty");

    await store.units.add({ id: "s1", track: "build", brief: "briefs/u1.md", serves: "G1" });
    await store.units.add({ id: "s2", track: "build", brief: "briefs/u1.md", serves: "G1" });
    expect(
      await store.units.add({
        id: "l1",
        track: "build",
        brief: "briefs/u1.md",
        serves: "none",
        reason: "lint hardening",
      })
    ).toMatchObject({ serves: "none: lint hardening" });
    await store.units.set({ id: "s1", state: "landed" });

    const first = await store.status.render();
    expect(first.summary.goals).toEqual([
      { id: "G1", state: "open", inFlight: 1, total: 2 },
    ]);
    expect(first.summary.offGoal).toEqual({ inFlight: 1, total: 1 });
    expect(goalLine(first.summary)).toBe(
      "goals: G1 open 1 in flight/2 units; off-goal 1/2 in flight"
    );
    expect(await readFile(join(directory, "status.md"), "utf8")).toContain(
      "| G1 | Operator sees last week from real data | weekly review renders from a live sync | open |"
    );

    expect(await store.goals.set({ id: "G1", state: "met" })).toMatchObject({
      state: "met",
    });
    expect((await store.status.render()).changed).toBe("goal G1 open->met");
    await expect(store.goals.set({ id: "G2", state: "met" })).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("reads legacy seven-column units as off-goal and flags hand edits", async () => {
    const { directory, store } = await initializedStore();
    await writeFile(
      join(directory, "units.tsv"),
      "id\ttrack\tstate\tbranch\tpr\tsha\tbrief\nold\tbuild\trunning\t\t\t\t\n"
    );
    expect(await store.units.get("old")).toMatchObject({ serves: "" });
    const legacy = await store.status.render();
    expect(legacy.summary.offGoal).toEqual({ inFlight: 1, total: 1 });
    expect(legacy.warnings).toEqual([]);

    await store.units.set({ id: "old", state: "landed" });
    expect((await store.status.render()).warnings).toEqual([]);
    await writeFile(
      join(directory, "units.tsv"),
      `${await readFile(join(directory, "units.tsv"), "utf8")}hand\tbuild\tpending\t\t\t\t\t\n`
    );
    expect((await store.status.render()).warnings).toEqual([
      "units.tsv was edited outside orch; re-register those rows with orch unit add/set",
    ]);
  });

  it("rejects operations after close", async () => {
    const { store } = await initializedStore();
    await store.close();
    await expect(store.units.list()).rejects.toThrow("store is closed");
    await expect(store.status.render()).rejects.toBeInstanceOf(UserError);
  });
});

describe("orch CLI", () => {
  it("prints commander help and rejects invalid parsing with exit 1", async () => {
    const help = runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Commands:");
    expect(help.stdout).toContain("unit");
    expect(help.stdout).toContain("ledger");

    const frontierHelp = runCli(["frontier", "set", "--help"]);
    expect(frontierHelp.code).toBe(0);
    expect(frontierHelp.stdout).toContain("--repo <dir>");
    expect(frontierHelp.stdout).toContain("--prs <n,...>");

    const directory = await makeDirectory();
    const invalid = runCli(["--store", directory, "unit", "add", "u1"]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("required option '--track <track>'");
  });

  it("accepts ORCH_STORE and emits complete JSON", async () => {
    const directory = await makeDirectory();
    const env = { ...process.env, ORCH_STORE: directory };
    expect(runCli(["init"], env).code).toBe(0);

    await writeBrief(directory);
    expect(
      runCli(
        ["goal", "add", "G1", "--outcome", "real data", "--check", "a live sync"],
        env
      ).stdout
    ).toBe("G1\topen\treal data\ta live sync\n");
    expect(runCli(["brief", "check", "briefs/u1.md"], env).stdout).toBe("ok\n");

    const added = runCli(
      [
        "unit",
        "add",
        "u1",
        "--track",
        "build",
        "--brief",
        "briefs/u1.md",
        "--serves",
        "G1",
        "--json",
      ],
      env
    );
    expect(added.code).toBe(0);
    expect(JSON.parse(added.stdout)).toEqual({
      id: "u1",
      track: "build",
      state: "pending",
      branch: "",
      pr: "",
      sha: "",
      brief: "briefs/u1.md",
      serves: "G1",
    });
    expect(runCli(["status"], env).stdout.split("\n")[0]).toBe(
      "goals: G1 open 1 in flight/1 units; off-goal 0/1 in flight"
    );

    await writeFile(join(directory, "briefs", "bad.md"), "GOAL do it\n");
    const bad = runCli(["brief", "check", "briefs/bad.md"], env);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("brief briefs/bad.md is not spawnable:\n- missing SCOPE");
  });

  it("maps user and not-found outcomes to the preserved exit codes", async () => {
    const directory = await makeDirectory();
    expect(runCli(["--store", directory, "init"]).code).toBe(0);

    const missingRepo = runCli([
      "--store",
      directory,
      "frontier",
      "set",
    ]);
    expect(missingRepo.code).toBe(1);
    expect(missingRepo.stderr).toContain(
      "set --repo <dir> or ORCH_REPO"
    );

    const userError = runCli([
      "--store",
      directory,
      "unit",
      "add",
      "u1",
      "--track",
      "build",
      "--brief",
      "briefs/missing.md",
      "--serves",
      "G1",
    ]);
    expect(userError.code).toBe(1);
    expect(userError.stderr).toContain(
      "brief briefs/missing.md not found (relative paths resolve from the store)"
    );

    const missingUnit = runCli([
      "--store",
      directory,
      "unit",
      "get",
      "missing",
    ]);
    expect(missingUnit.code).toBe(2);
    expect(missingUnit.stderr).toContain("unit missing not found");

    const missingLedger = runCli([
      "--store",
      directory,
      "--json",
      "ledger",
      "check",
      "184530",
      "abc123",
    ]);
    expect(missingLedger.code).toBe(2);
    expect(JSON.parse(missingLedger.stdout)).toEqual({
      pr: "184530",
      sha: "abc123",
      verdict: "NOT-VERIFIED",
    });
    expect(missingLedger.stderr).toBe("");
  });
});

const THIRD_LINE =
  "Before writing a helper for time, retry, polling, cache, queue, lock, parsing, ordering, grouping, decimal, graph or LLM I/O, search the installed effect (`references/primitives.md`, `modules.md`, review.md catalog A). Report each hand-rolled capability with the export checked (`dist/…:line`) and why it does not fit, or `none`.";
const DELEGATE_LINES = [
  "Load the **effect** skill and run its §1 version gate before writing code. Follow the installed version where it differs.",
  "Before reporting done, run the effect skill's §8 checklist and include its result.",
  THIRD_LINE,
];

function effectBrief({
  map = "EFFECT MAP   none: string formatting only",
  lines = DELEGATE_LINES,
  repo,
}: {
  map?: string | null;
  lines?: readonly string[];
  repo?: string;
} = {}): string {
  return [
    "GOAL         Retry the Effect export fetch.",
    "SCOPE        src/export/**",
    `CONTEXT      docs/export.md${repo === undefined ? "" : `; Repo ${repo}.`}`,
    ...(map === null ? [] : [map]),
    "PREMISES     export format: evidence/export-sample.md",
    "ACCEPTANCE   retries are bounded",
    "VERIFY       bun test src/export",
    "TIMEBOX      45m",
    "FORBIDDEN    no rebase",
    "REPORT       status, head SHA",
    ...lines,
    "STANDING",
    "",
  ].join("\n");
}

async function fakeEffect(packageDir: string, version: string): Promise<void> {
  const root = join(packageDir, "node_modules", "effect");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "effect", version })
  );
  await writeFile(
    join(root, "dist", "Schedule.d.ts"),
    "export {}\nexport declare const exponential: unknown\nexport declare const spaced: unknown\n"
  );
}

describe("Effect briefs", () => {
  it("refuses an Effect brief without the toolbox line or an EFFECT MAP, and passes a complete one", async () => {
    const { directory, store } = await initializedStore();

    await writeBrief(
      directory,
      "briefs/two-lines.md",
      effectBrief({ lines: DELEGATE_LINES.slice(0, 2) })
    );
    expect(await store.briefs.check("briefs/two-lines.md")).toEqual([
      `Effect brief lacks the delegate line from references/effect.md: "${THIRD_LINE}"`,
    ]);

    await writeBrief(directory, "briefs/no-map.md", effectBrief({ map: null }));
    expect(await store.briefs.check("briefs/no-map.md")).toEqual([
      "Effect brief lacks an EFFECT MAP block in CONTEXT (references/effect.md, Delegating Effect work)",
    ]);

    await writeBrief(
      directory,
      "briefs/empty-map.md",
      effectBrief({ map: "EFFECT MAP" })
    );
    expect(await store.briefs.check("briefs/empty-map.md")).toEqual([
      "EFFECT MAP is empty; name each capability with the export checked (dist/<file>:<line>), or none with the reason",
    ]);

    await writeBrief(directory, "briefs/ok.md", effectBrief());
    expect(await store.briefs.check("briefs/ok.md")).toEqual([]);
  });

  it("refuses EFFECT MAP citations that do not resolve under the repo's installed effect", async () => {
    const { directory, store } = await initializedStore();
    const repo = join(directory, "repo");
    await fakeEffect(join(repo, "packages", "app"), "4.0.0");
    await fakeEffect(join(repo, "packages", "legacy"), "4.0.0-beta.102");

    const cited = (map: string, repoPath?: string) =>
      effectBrief({ map: `EFFECT MAP   ${map}`, repo: repoPath });

    await writeBrief(
      directory,
      "briefs/good.md",
      cited("retry: Schedule.exponential (node_modules/effect/dist/Schedule.d.ts:2)", repo)
    );
    expect(await store.briefs.check("briefs/good.md")).toEqual([]);

    await writeBrief(
      directory,
      "briefs/bad.md",
      cited(
        "retry: dist/Schedule.d.ts:9; cache: dist/Cachez.d.ts:1; poll: dist/../package.json:1",
        repo
      )
    );
    const root = realpathSync(join(repo, "packages", "app", "node_modules", "effect"));
    expect(await store.briefs.check("briefs/bad.md")).toEqual([
      `EFFECT MAP cites dist/Schedule.d.ts:9, which does not resolve under ${root} (file has 3 lines)`,
      `EFFECT MAP cites dist/Cachez.d.ts:1, which does not resolve under ${root} (no such file)`,
      `EFFECT MAP cites dist/../package.json:1, which does not resolve under ${root} (path leaves dist)`,
    ]);

    await writeBrief(directory, "briefs/no-repo.md", cited("retry: dist/Schedule.d.ts:2"));
    expect(await store.briefs.check("briefs/no-repo.md")).toEqual([
      'EFFECT MAP cites dist paths but no repo is known; pass --repo <dir> or name "Repo <dir>" in the brief',
    ]);
    expect(
      await store.briefs.check("briefs/no-repo.md", {
        repo: join(repo, "packages", "app"),
      })
    ).toEqual([]);

    await fakeEffect(join(repo, "packages", "other"), "4.0.1");
    const problems = await store.briefs.check("briefs/good.md");
    expect(problems.length).toBe(1);
    expect(problems[0]).toStartWith(`ambiguous installed effect under ${repo}:`);
  });
});

describe("Effect lens on the ledger", () => {
  async function effectUnitStore(): Promise<{
    readonly directory: string;
    readonly store: Store;
  }> {
    const { directory, store } = await storeWithGoal();
    await writeBrief(directory, "briefs/fx.md", effectBrief());
    await store.units.add({ id: "fx", track: "build", brief: "briefs/fx.md", serves: "G1" });
    await store.units.add({ id: "plain", track: "build", brief: "briefs/u1.md", serves: "G1" });
    return { directory, store };
  }

  const pass = { evidence: "reports/v.md", verifier: "sol" } as const;

  it("records effect verdicts in their own vocabulary, keyed by lens", async () => {
    const { store } = await initializedStore();
    await expect(
      store.ledger.record({ pr: 7, sha: "h1", verdict: "unit-test-verified", lens: "effect", ...pass })
    ).rejects.toThrow("effect verdict must be idiomatic, fixes-required, or inconclusive");
    await expect(
      store.ledger.record({ pr: 7, sha: "h1", verdict: "idiomatic", ...pass })
    ).rejects.toThrow("verdict must be live-ui-verified");

    await store.ledger.record({ pr: 7, sha: "h1", verdict: "unit-test-verified", ...pass });
    await store.ledger.record({ pr: 7, sha: "h1", verdict: "idiomatic", lens: "effect", ...pass });
    expect((await store.ledger.check({ pr: 7, sha: "h1" })).verdict).toBe("unit-test-verified");
    expect((await store.ledger.check({ pr: 7, sha: "h1", lens: "effect" })).verdict).toBe("idiomatic");
    expect(await store.ledger.summary()).toEqual({ "unit-test-verified": 1, idiomatic: 1 });
  });

  it("refuses to land an Effect unit with a missing, stale-head, or not-passing effect verdict", async () => {
    const { store } = await effectUnitStore();
    await store.ledger.record({ pr: 7, sha: "new", verdict: "unit-test-verified", ...pass });

    await expect(store.ledger.gate({ pr: 7, sha: "new", unit: "fx" })).rejects.toThrow(
      "unit fx at new is not landable: default unit-test-verified; effect missing"
    );

    await store.ledger.record({ pr: 7, sha: "old", verdict: "idiomatic", lens: "effect", ...pass });
    await expect(store.ledger.gate({ pr: 7, sha: "new", unit: "fx" })).rejects.toThrow(
      "unit fx at new is not landable: default unit-test-verified; effect missing"
    );

    await store.ledger.record({ pr: 7, sha: "new", verdict: "fixes-required", lens: "effect", ...pass });
    await expect(store.ledger.gate({ pr: 7, sha: "new", unit: "fx" })).rejects.toThrow(
      "unit fx at new is not landable: default unit-test-verified; effect fixes-required (not a pass)"
    );

    await store.ledger.record({ pr: 7, sha: "new", verdict: "idiomatic", lens: "effect", ...pass });
    expect(await store.ledger.gate({ pr: 7, sha: "new", unit: "fx" })).toEqual({
      unit: "fx",
      sha: "new",
      lenses: [
        { lens: "default", verdict: "unit-test-verified" },
        { lens: "effect", verdict: "idiomatic" },
      ],
    });
  });

  it("matches abbreviated ledger SHAs of seven or more characters against the full head", async () => {
    const { store } = await effectUnitStore();
    const head = "31d81ee0c1a2b3c4d5e6f708192a3b4c5d6e7f80";
    await store.ledger.record({ pr: 9, sha: "31d81ee", verdict: "unit-test-verified", ...pass });
    await store.ledger.record({ pr: 9, sha: "31d81ef", verdict: "idiomatic", lens: "effect", ...pass });
    await expect(store.ledger.gate({ pr: 9, sha: head, unit: "fx" })).rejects.toThrow(
      `unit fx at ${head} is not landable: default unit-test-verified; effect missing`
    );
    await store.ledger.record({ pr: 9, sha: "31d81", verdict: "idiomatic", lens: "effect", ...pass });
    await expect(store.ledger.gate({ pr: 9, sha: head, unit: "fx" })).rejects.toThrow("effect missing");
    await store.ledger.record({ pr: 9, sha: "31d81ee0", verdict: "idiomatic", lens: "effect", ...pass });
    expect((await store.ledger.gate({ pr: 9, sha: head, unit: "fx" })).lenses).toEqual([
      { lens: "default", verdict: "unit-test-verified" },
      { lens: "effect", verdict: "idiomatic" },
    ]);
  });

  it("lands a non-Effect unit on a passing default verdict alone", async () => {
    const { store } = await effectUnitStore();
    await store.ledger.record({ pr: 8, sha: "s", verdict: "type-check-only", ...pass });
    await expect(store.ledger.gate({ pr: 8, sha: "s", unit: "plain" })).rejects.toThrow(
      "unit plain at s is not landable: default type-check-only (not a pass)"
    );
    await store.ledger.record({ pr: 8, sha: "s", verdict: "live-ui-verified", ...pass });
    expect(await store.ledger.gate({ pr: 8, sha: "s", unit: "plain" })).toEqual({
      unit: "plain",
      sha: "s",
      lenses: [{ lens: "default", verdict: "live-ui-verified" }],
    });
  });

  it("reads a six-column ledger as the default lens and upgrades it on write", async () => {
    const { directory, store } = await initializedStore();
    await writeFile(
      join(directory, "ledger.tsv"),
      "pr\tsha\tverdict\tevidence\tverifier\tts\n2\tsha2\tunit-test-verified\treport\tme\tnow\n"
    );
    expect((await store.ledger.check({ pr: 2, sha: "sha2" })).lens).toBe("default");
    await store.ledger.record({ pr: 2, sha: "sha2", verdict: "idiomatic", lens: "effect", ...pass });
    const lines = (await readFile(join(directory, "ledger.tsv"), "utf8")).split("\n");
    expect(lines[0]).toBe("pr\tsha\tverdict\tevidence\tverifier\tts\tlens");
    expect(lines[1]).toBe("2\tsha2\tunit-test-verified\treport\tme\tnow\tdefault");
    expect(lines[2]?.split("\t").slice(0, 3)).toEqual(["2", "sha2", "idiomatic"]);
    expect(lines[2]?.endsWith("\teffect")).toBe(true);
  });

  it("gates landing from the CLI with --lens and --unit", async () => {
    const { directory, store } = await effectUnitStore();
    await store.close();
    const cli = (...args: string[]) => runCli(["--store", directory, ...args]);

    expect(cli("ledger", "record", "7", "h", "unit-test-verified", "--evidence", "r").code).toBe(0);
    const missing = cli("ledger", "check", "7", "h", "--unit", "fx");
    expect(missing.code).toBe(1);
    expect(missing.stderr).toBe(
      "error: unit fx at h is not landable: default unit-test-verified; effect missing\n"
    );

    expect(
      cli("ledger", "record", "7", "h", "idiomatic", "--lens", "effect", "--evidence", "r").stdout
    ).toBe("7\th\tidiomatic\teffect\n");
    const landable = cli("ledger", "check", "7", "h", "--unit", "fx");
    expect(landable.code).toBe(0);
    expect(landable.stdout).toBe("default\tunit-test-verified\neffect\tidiomatic\n");
    expect(cli("ledger", "check", "7", "h", "--lens", "effect").stdout).toBe("idiomatic\n");
    expect(cli("ledger", "check", "7", "h", "--lens", "style").code).toBe(1);
  });
});
