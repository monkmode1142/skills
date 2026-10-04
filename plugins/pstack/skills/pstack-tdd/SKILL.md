---
name: pstack-tdd
description: "Use only when the user explicitly asks for TDD, a failing test, or a regression test, OR when the bug has an obvious cheap local test target. Skip when the test path is unclear, expensive, integration-heavy, or not requested."
disable-model-invocation: true
---

# TDD Bug Fix

When fixing a bug with a clear, cheap test path, make the broken behavior executable before changing production code. The goal is a focused regression test that fails before the fix and passes after it.

Do not force a test when it would be impractical. If the available test would require broad harness setup, brittle mocks, slow end-to-end infrastructure, production-only state, vague reproduction steps, or large unrelated fixture churn, skip adding a new test and use the closest useful verification instead.

## Workflow

1. **Understand the bug.** Identify the intended behavior, current behavior, affected path, and smallest observable reproduction.
2. **Choose the narrowest executable check.** Prefer the closest unit, component, integration, or regression test already used for that codepath. If no practical test path is obvious, do not create one from scratch just to satisfy the workflow.
3. **Write the failing test first.** Add the smallest focused test that would have caught the bug. The test should encode intended behavior, not mirror the current implementation.
4. **Run the new test before fixing.** Confirm it fails for the intended reason. If it passes or fails for an unrelated reason, correct the test or reproduction before editing the implementation.
5. **Fix the bug.** Make the smallest production change that satisfies the intended behavior while preserving nearby contracts.
6. **Rerun the regression test.** Confirm the test now passes.

## Effect Code

Tests for Effect code follow the same workflow. Load the **effect** skill, run its SKILL §1 version gate, and read SKILL §7 before writing the test. Depth is in its `references/testing.md`.

- **Use `@effect/vitest`.** Read `package.json` and one existing test first. Effect tests run on `@effect/vitest` at the same version as `effect`, on Vitest 5. Write `it.effect("name", () => Effect.gen(...))`. It provides a `Scope`, `TestClock`, and `TestConsole`. `it.live` runs on the real clock. There is no `it.scoped`. A plain `it` that returns an Effect never runs it, and `Effect.runPromise` inside a plain `it` bypasses the test services. If the project lacks it, add it at the `effect` version instead of hand-running Effects with `Effect.runPromise` in another runner (`references/testing.md` §1, §2).
- **Run the real service over test layers.** Build the service under test from its real recipe layer (`layerNoDeps`). Replace only its ports (vendor clients, network, storage) with `Layer.succeed(Port, fake)`, `Layer.mock(Port, partial)`, or an in-memory layer. Do not reach for a mocking framework. The dependency is already injected, so the swap is the test seam. Provide per test with `Effect.provide(layer)`. A shared `layer(L)` block carries state, clock time, and console lines across tests (`references/testing.md` §4).
- **Drive time with `TestClock`.** Advance it with `TestClock.adjust` instead of sleeping. It starts at epoch 0. Fork the sleeping effect, adjust, then join. A real delay under `it.effect` hangs until the Vitest timeout. A timing bug then reproduces deterministically on every run (`references/testing.md` §5).
- **Assert the typed failure.** For a failure path, flip the effect (`Effect.flip`) or read `Effect.result`, then assert the error's `_tag` and fields. Assert a defect through `Effect.exit` and the `Cause` reasons. Don't compare whole failed `Exit`s, because `Effect.fn` spans annotate the cause. "It failed" is not the behavior. `InvoiceNotFound` for `inv_missing` is (`references/testing.md` §3).
- **Prove the test can fail.** Step 4 is not optional here. Break the code the test pins with an editor, watch that test go red for the right reason, and restore. Never use `git checkout` or `git stash` for the mutation (`references/testing.md` §11).
- **Read the count, not only the exit code.** A run that finds no tests exits 1, but a `-t` filter that matches nothing skips every test and exits 0. The run is evidence only when the summary shows your test as passed. Typecheck the test files too, because `it.scoped` and dropped error cases only fail in `tsc`.

```ts
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { Leases } from "./leases.js";

it.effect("a lease is released after its 30 second ttl", () =>
  Effect.gen(function* () {
    const leases = yield* Leases;
    const lease = yield* leases.acquire("job-1");
    yield* TestClock.adjust("31 seconds");
    expect(yield* leases.isHeld(lease)).toBe(false);
  }).pipe(Effect.provide(Leases.layer)),
);
```

## If a Failing Test Is Impractical

Use the closest executable regression check instead: a targeted script, manual reproduction command, browser automation, snapshot comparison, log assertion, or focused integration check.

Prefer no new test over a bad test. A bad test is one that mostly tests mocks, encodes current implementation details, depends on timing or unrelated global state, needs expensive infrastructure for a small fix, or would be deleted immediately after proving the fix.

## Guardrails

- Do not change tests merely to match a wrong implementation.
- Do not weaken existing assertions unless the expected behavior has genuinely changed and the reason is clear.
- Keep the regression test focused on the bug. Avoid broad fixture churn or unrelated coverage expansion.
- If the bug is flaky, make the test deterministic where possible and document the signal being locked down.
- If the bug exposes a broader class of failures, first land the focused regression path, then consider additional sibling coverage.

## Final Response

Report the evidence, not just the outcome:

- Name the failing-before test or executable check and the failure it produced.
- Name the passing-after test run and any nearby validation performed.
- If failing-before evidence could not be demonstrated, state why and describe the closest regression check used instead.
