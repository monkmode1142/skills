---
name: principle-make-operations-idempotent
description: "Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries. Converge to the same end state regardless of partial prior runs."
disable-model-invocation: true
---

# Make Operations Idempotent

Design operations so they converge to the correct state regardless of how many times they run or where they start from. Every state-mutating operation should answer: "What happens if this runs twice? What happens if the previous run crashed halfway?"

**Why:** Commands, lifecycle operations, and processing loops run where crashes, restarts, and retries are normal. If partial state changes the next run's outcome, every restart becomes a debugging session.

**The pattern:**
- Convergent startup: scan for existing state, clean stale artifacts, adopt live sessions
- Content-based cleanup: compare by content equivalence, not creation order
- Self-healing locks: use PID-based stale lock detection
- Idempotent scheduling: failed work respawns cleanly, fresh input regenerated after each cycle

**Retries assume idempotence.** A retry reruns the whole operation from the top. In Effect, `Effect.retry` with a `Schedule` makes retrying one line, which is why the check matters. Put a retry only around an operation that passes the test below, or make it idempotent first with an idempotency key, an upsert, or a compare-and-set. Retrying a non-idempotent write turns a transient failure into a duplicate. `HttpClient.retryTransient` does not look at the method, so give writes their own client without it. Bound every retry by attempts and time. `Schedule.recurs(n)` and `{ times: n }` mean n retries, so n + 1 runs. Tie cleanup to `Effect.acquireRelease` so a crash or interruption mid-run still releases what it took. Open the **effect** skill's `references/concurrency.md` §7 for `Schedule` and retry forms, and §8 for timeouts.

**The test:**
1. What happens if this runs twice in a row?
2. What happens if the previous run crashed at every possible point?
3. Does re-execution converge to the same end state?

If any answer is "it depends on what state was left behind," the operation needs a reconciliation step.
