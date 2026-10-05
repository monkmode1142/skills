### Perf issue

**You own the measurement story. Plan, review, verify the numbers.** Tie every fix to a measurement, don't read source instead of measuring.

1. Capture a baseline trace via the matching control skill. Vet the baseline, and each later number, with the **benchmark-checklist** skill. Inside bb, when the trace needs a dev server or a long-running process, run it in a bb terminal and read its logs with `bb terminal output <tid>` (`../references/harness.md`, Inside bb).
   When a stack add-on applies (`../references/harness.md`, Stack add-ons), load its skill and run its version gate, and read the instrumentation it names before adding ad hoc timers.
2. `how` to ground hypotheses. Don't claim a perf ceiling without running it first.
   Try the performance mantras in order, cheapest first:
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
   2. Do it, but don't do it again.
   3. Do it less.
   4. Do it later.
   5. Do it when they're not looking.
   6. Do it concurrently.
   7. Do it cheaper.

   When an earlier mantra meets the target, stop.
   When a stack add-on maps a mantra to a built-in, use the built-in instead of hand-rolling one.
3. Plan the fix from the trace. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent on the `perf-issue` model (`../references/harness.md`). When a stack add-on applies, the delegate gets its delegate lines verbatim. Review the diff, with the add-on's review lens and done checklist when one applies. Capture a post-fix trace.
   Apply the **principle-sequence-verifiable-units** skill, verifying each attempt before trying the next.
4. Parse and compare the artifacts (JSON to sqlite, diff). "Inconclusive" or wrong-surface is not a pass. Flag it.
5. Cite the measurement in the PR.
6. Run **Opening a PR**.

For sustained improvement against a metric rather than a one-off fix, use the Hillclimb playbook (`playbooks/hillclimb.md`).

**Reply:** baseline number, post-fix number, delta, artifact path.
