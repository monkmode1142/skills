---
name: principle-separate-before-serializing-shared-state
description: "Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant."
disable-model-invocation: true
---

# Separate Before Serializing Shared State

When concurrent actors might share mutable state, first ask whether they need the same mutable object. If not, eliminate the sharing. When sharing is real, enforce serialization structurally: lockfiles, sequential phases, exclusive ownership. Instructions and conventions are not concurrency control.

**Why:** Concurrent writes to shared state create race conditions that are intermittent, hard to reproduce, and expensive to debug.

**Pattern:**
1. **Identify shared mutable state** (files both read and write, branches both push to, APIs both define and consume).
2. **Default: eliminate the shared write target.** Ask: do these actors need one canonical object, or are they publishing independent facts? Give each actor its own owned file, key, branch, or state directory, and merge only at the read/reporting boundary. Two workers writing their own `lastX` field into one `state.json` is still shared mutation. `indexer-state.json` + `metrics-state.json` is not.
3. **Only when one shared write target is a real invariant, serialize access structurally** (lockfiles, sequential phases, single-writer actor, or atomic compare-and-swap). Treat "we need a lock" as a design smell to check, not as the default answer.

**In Effect.** Step 2 still comes first. A `Ref` per actor, or one per key, needs no lock. When step 3 applies, the structural tools are a `Semaphore` around the one writer (`yield* Semaphore.make(1)` in the owner's layer is a mutex), a single fiber that owns the state and drains a `Queue`, a `SynchronizedRef` when computing the update is itself effectful, or `TxRef` inside `Effect.tx` when several refs must change together. Fork that owner with `Effect.forkScoped` so it dies with its scope. Open the **effect** skill's `references/concurrency.md` §0 to pick the primitive, §3 for coordination, and §4 for state.
