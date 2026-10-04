### Perf issue

**You own the measurement story. Plan, review, verify the numbers.** Tie every fix to a measurement, don't read source instead of measuring.

1. Capture a baseline trace via the matching control skill. Vet the baseline, and each later number, with the **benchmark-checklist** skill. Inside bb, when the trace needs a dev server or a long-running process, run it in a bb terminal and read its logs with `bb terminal output <tid>` (`../references/harness.md`, Inside bb).
   In Effect code, read the instrumentation the runtime already gives you before adding ad hoc timers. Every `Effect.fn("Service.method")` call is a span, so a `Tracer` exporter turns the program into a span tree that shows where the time goes. A `Metric` timer or histogram gives the number the fix is gated on. Load the **effect** skill, run its SKILL §1 version gate, and take the exporter and metric wiring from its `references/platform.md` §14.
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
   In Effect code, several mantras already ship as built-ins, so check the effect skill before hand-rolling one. "Don't do it again" is caching (`references/concurrency.md` §9). "Do it less" is request batching (§10). "Later" and "when they're not looking" are scoped background fibers and schedules (§1, §7). "Concurrently" is the concurrency options on the combinators (§3), because Effect runs sequentially by default.
3. Plan the fix from the trace. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent on the `perf-issue` model (`../references/harness.md`). A delegate that writes Effect code gets the two brief lines from `../references/effect.md` (Delegating Effect work) verbatim. Review the diff, and for Effect code review it with the effect skill's `references/review.md` and SKILL §8 checklist. Capture a post-fix trace.
   Apply the **principle-sequence-verifiable-units** skill, verifying each attempt before trying the next.
4. Parse and compare the artifacts (JSON to sqlite, diff). "Inconclusive" or wrong-surface is not a pass. Flag it.
5. Cite the measurement in the PR.
6. Run **Opening a PR**.

For sustained improvement against a metric rather than a one-off fix, use the Hillclimb playbook (`playbooks/hillclimb.md`).

**Reply:** baseline number, post-fix number, delta, artifact path.
