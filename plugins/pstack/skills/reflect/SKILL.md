---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent finds its own transcript file before fanning out. Use the harness's transcript store for the current project, as mapped in [harness.md](../poteto-mode/references/harness.md). Do not glob across other projects' transcript directories. That crosses workspace boundaries and reads private chats from unrelated projects.

```bash
ls -t <transcript-dir>/*.jsonl <transcript-dir>/*/*.jsonl <transcript-dir>/*/subagents/*.jsonl 2>/dev/null | head -10
```

Layouts vary by harness. Some keep one flat file per session, some nest sessions in per-session directories, and some keep subagent transcripts under a `subagents/` directory. For Codex, filter the session files by their `cwd` field.

For each candidate, find the first user message and check that it contains the conversation's opening user prompt. Take the matching path. If no path resolves, write a tight digest of the session and pass that instead.

Inside bb ([harness.md](../poteto-mode/references/harness.md), Inside bb), the active transcript is this thread. Write `bb thread log "$BB_THREAD_ID" --all` to a file in `$BB_THREAD_STORAGE` and pass that path. It covers every provider the thread ran on. The provider's own transcript file covers only that provider.

### 2. Spawn three reviewers in parallel

Spawn all three at once as general-purpose subagents, with the model set as below. Reviewers need MCP access for context lookups (tickets, chat threads, observability traces referenced in the transcript), so give them the session's MCP tools rather than a read-only tool set.

Each reviewer and the synthesizer name a role from the pstack configuration table in [harness.md](../poteto-mode/references/harness.md). Read that role's value from `~/.agents/pstack/models.md`, or use the table default if the file or the role is missing. Leave the model unset when the value is `inherit`. If the harness rejects a model, use the role's default and say so.

| Lens | Role | Default | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | strongest available | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | strongest available, different family if reachable | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | strongest available | `references/divergent-reviewer.md` |

The tooling lens is the cross-family seat. Run it through its seat runner (harness.md, Running a seat), which covers native models, the other family's CLI (`codex`, `claude`), and `bb:<provider>/<model>` child threads. Give it the filled template, and take its output as the findings (stdout for a CLI seat, `bb thread output <id>` for a bb seat). A cross-family seat may not see this session's MCPs, so it works from the transcript and the repo. A bb seat is throwaway (`--lifecycle-owner-thread "$BB_THREAD_ID"`). Archive it once its findings are read (`../poteto-mode/references/harness.md`, Archive children when they are done), and name it as `@thread:<id>` in the summary. When no cross-family seat is reachable, run the tooling reviewer as a normal subagent on the strongest available model and say the panel ran single-family.

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in their final response.

### 3. Synthesize

Spawn one general-purpose subagent on the `reflect judgment, divergent, synthesizer` role, with the session's MCP tools. The synthesizer's quality check includes spot-verifying citations, which can require MCP access. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. See the **principle-encode-lessons-in-structure** skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

Backlog items file automatically to whatever devex / backlog tracker the session has an MCP or CLI for. With no tracker, list them for the user. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the **writing-great-skills** skill if installed, otherwise follow the harness's own skill-authoring guidance, and run a draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to the same skill-authoring path and run its description-optimization loop.
- `new skill: <kebab-name>`: hand creation to the same skill-authoring path. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
