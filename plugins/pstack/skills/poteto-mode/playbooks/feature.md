### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. `how` over the affected subsystem. If the purpose itself is still ambiguous, run **shape-an-idea** first and let the user correct the restated goal (`../references/thinking.md`).
2. `architect` for parallel design exploration.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **principle-separate-before-serializing-shared-state** skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing to a subagent using the `feature, refactoring` model from `~/.agents/pstack/models.md` (see `../references/harness.md`) with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). In non-frontend TypeScript that shape is Effect v4. Name the data shape as a `Schema` decoded at the boundary, the failures as `Schema.TaggedError` variants, and the dependencies as `Context.Service` interfaces. Load the **effect** skill and run its SKILL §1 version gate rather than briefing from memory. Take the shape from its `references/schema.md` §1 and §8, the failures from `references/errors.md` §2 and §3, and the services from SKILL §4 and §5, per the routing table in `../references/effect.md`. A delegate that writes Effect code gets the two brief lines from `../references/effect.md` (Delegating Effect work) verbatim. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation. No "standing by" reply that waits on a nested agent. Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally. Inside bb, pick between a native subagent and a child thread by the job table in `../references/harness.md` (Inside bb).
5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it. For a change that touches Effect code, also run the effect skill's SKILL §8 checklist on the diff and name every box that fails.
6. Rebase into small, ordered commits. Stack follow-ups.
   Use the **principle-sequence-verifiable-units** skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR**.

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
