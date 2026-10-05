---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Fan out N parallel attempts at the same task. Read every candidate end to end. Pick the strongest as the base. Graft the best ideas from the others into it. Verify the synthesized result.

## Start

Open a todo list ([harness.md](../poteto-mode/references/harness.md)) with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Cross-judge
4. Pick
5. Graft
6. Verify

## Phase A: Frame

The N candidates will receive the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric. State what success looks like for *this* task, then turn it into 3-6 concrete gradeable criteria. The rubric is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Use the `arena runners` role in `~/.agents/pstack/models.md` (see the pstack configuration table in harness.md). If the file or that role is missing, default to one each on `inherit`, `opus`, and `codex`. Run each entry through its seat runner (harness.md, Running a seat). That covers native models, the other family's CLI (`codex`, `claude`), and `bb:<provider>/<model>` child threads. An `inherit` entry in this role or the cross-judge role means the parent model, so leave the model unset for it. If a cross-family seat is not reachable, drop it and say the arena ran single-family. If the harness rejects a configured model, run that seat on the parent model and say so. Spawn more when the arena covers multiple design directions. Same model N times when the work is generation-bound rather than judgment-sensitive.
4. Assign output paths. Each candidate writes to its own location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **principle-separate-before-serializing-shared-state** skill. Inside bb, a runner on a child thread writes in its own worktree (`--new-environment worktree`), and that worktree is its output path.

## Phase B: Fan out

Spawn all N runners at once, run in the background, each with the task, the path to the shared grounding, its own output path, and instructions to produce both the artifact and a short rationale.

A cross-family runner gets the same brief through its seat runner. A CLI runner starts from its output path. A bb runner is a child thread with `--new-environment worktree`, plus `--lifecycle-owner-thread "$BB_THREAD_ID"` because candidates are throwaway once grafted. It writes to its own output path like any other candidate.

Inside bb, collect child runners from their lifecycle notifications or `bb thread wait`. Read the candidate from its worktree (`bb thread show <id> --git-diff`) and the rationale from `bb thread output <id>`. Once the winner is grafted, archive every runner and judge thread (`../poteto-mode/references/harness.md`, Archive children when they are done). Name each one as `@thread:<id>` in the reply.

Each rationale names the alternatives the candidate considered and what it rejected.

When a [stack add-on](../poteto-mode/references/harness.md#stack-add-ons) applies, each brief carries its delegate lines verbatim. A cross-family runner that cannot load skills gets the add-on skill's path instead.

If a candidate fails to produce output, proceed with N-1 and note the dropout in the synthesis record.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one model from the `arena cross-judge pool` role in `~/.agents/pstack/models.md`. If the file or that role is missing, choose from `opus` and `codex`. Prefer a different model family from the parent's when one is reachable (see harness.md). Run one read-only judge on that model through its seat runner (harness.md, Running a seat). Its brief says it is read-only, and its output (stdout, or `bb thread output <id>` for a bb seat) is the verdict. If no other family is reachable, judge on the same family with a fresh context and say so. Treat its agreement as weaker evidence. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. When a stack add-on applies, its brief adds the add-on's review lens. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves. Don't spawn the judge while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking.

Score each candidate against the rubric criterion by criterion, not on holistic feel. Compare against the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base on which candidate a future maintainer can extend most easily without breaking invariants. Prefer the cleaner boundary or smaller API when two feel tied, per the Laziness Protocol.

Record the pick and the reason in a short synthesis note alongside the base artifact, including the cross-judge's verdict.

## Phase E: Graft

Walk each losing candidate once more and identify what is worth porting into the base. The signal is usually one or two things per candidate, not most of it.

Fold each graft in by hand, per the **principle-redesign-from-first-principles** skill. Don't paste mechanically. The result has to remain coherent under one mental model.

Record what was grafted, from which candidate, and what was rejected and why.

When N candidates converge on the same shape, that is a strong agreement signal. Note the convergence in the record and ship the consensus shape. No graft is needed. When N candidates wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

The synthesized artifact has to hold up under the same scrutiny as any other output, per the **principle-prove-it-works** skill. Grafting can mix library versions or idioms across candidates, so when a stack add-on applies, the synthesized artifact also passes its done checklist.

If verification surfaces a problem the arena did not catch, either Phase A was wrong (re-frame and re-run) or one candidate caught it and you missed the graft (go back to Phase E). Don't paper over.

## Outputs

One synthesized artifact. One short synthesis note alongside, naming the base, the grafts (with source candidate), the rejections, the dropouts if any, and the verification result.
