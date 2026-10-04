---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

Fan out N parallel workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Open a todo list ([harness.md](../poteto-mode/references/harness.md)) with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers, not the harness's concurrency limit.
4. Pick the worker model from the `swarm workers` role in `~/.agents/pstack/models.md` (see the pstack configuration table in harness.md). If the file or that role is missing, use the fast tier. For `inherit`, leave the model unset so the workers run on the parent model. If the harness rejects a model, use the default and say so. For a model race, name each arm's model up front. Each arm runs through its seat runner (harness.md, Running a seat). That covers native models, the other family's CLI (`codex`, `claude`), and `bb:<provider>/<model>` child threads. If an arm's seat is not reachable, drop the arm and say so.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers at once as general-purpose subagents, run in the background, on the step 4 model, left unset for `inherit`. A worker that writes gets its own git worktree (the harness's worktree isolation when it has one, otherwise `git worktree add`). If the harness can run workers as remote agent sessions and the brief needs nothing on the user's computer, that is fine too.

Inside bb ([harness.md](../poteto-mode/references/harness.md), Inside bb), a worker that writes is a child thread with `--new-environment worktree`. A short read-only worker stays a native subagent. Add `--lifecycle-owner-thread "$BB_THREAD_ID"` to throwaway workers, and leave it off a worker whose branch must outlive the swarm. A bulk swarm may spawn with `--visibility hidden`. Keep a handful the user might watch visible. Collect child workers from their lifecycle notifications or `bb thread wait`, and read each result with `bb thread output <id>`.

When a worker must start from a non-default branch, create its worktree from that branch.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first. A worker that writes Effect code gets the two brief lines from [effect.md](../poteto-mode/references/effect.md) (Delegating Effect work) verbatim, and a worker that reviews an Effect diff gets "Use the effect skill's `references/review.md` procedure".

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used. Inside bb, name every child thread you started as `@thread:<id>` and say which are still running. Archive each child whose result you collected before the reply (`../poteto-mode/references/harness.md`, Archive children when they are done), and give the reason for any you keep.
