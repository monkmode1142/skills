---
name: principle-prove-it-works
description: "Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'"
disable-model-invocation: true
---

# Prove It Works

Verify every task output by checking the real thing directly. Do not infer from proxies, self-reports, or "it compiles."

**Why:** Unverified work has unknown correctness. Indirect verification (file mtimes, output freshness, agent self-reports, cached screenshots) feels cheaper than direct observation. Acting on a wrong inference costs far more than checking the source.

Check the real thing, not a proxy:
- Check process liveness directly, not indirectly through derived state
- Read the actual value, not a cached or derived representation
- When verification fails, suspect the observation method before suspecting the system

In Effect code, tests over `Layer.succeed` stubs and `TestClock` prove the logic, not the running system. They are a proxy for it. After they pass, run the real composition root (the `NodeRuntime.runMain` entry, `Layer.launch`, or the `ManagedRuntime` bridge) against the real services, then read the actual output, the row it wrote, or the `Effect.fn` span in the trace.

For any change that touches Effect code, the **effect** skill's SKILL §8 "Before you call it done" checklist is part of done. Run every box before the reply. That covers the version gate, every API checked against the installed `.d.ts` or source, the typecheck, tests that can fail, and language-service diagnostics where the project has them. Name each box that fails instead of skipping it. `references/review.md` holds the full audit for a large change.

## Script the check when you can

The strongest proof is a deterministic script that re-runs the same comparison, not a one-time eyeball. Write the script, run it, and keep its output as an artifact a reviewer can re-run instead of trusting your word.

Keep the artifact visible for the human. Commit it only for large or complex work where the trail has to be auditable later, like a big port or migration (the **show-me-your-work** skill).
