# Effect in pstack

Non-frontend TypeScript is Effect v4. The **effect** skill is the API truth and the house dialect. pstack never re-teaches Effect. It tells you which part of the effect skill to open at each step. This file is that map. When a pstack step touches Effect code, open the row's section before acting, not after.

Every reference below is relative to the effect skill's directory (`~/.agents/skills/effect/`). "SKILL §N" is a numbered section of its `SKILL.md`.

## The three gates

1. **Version gate, every task.** Run SKILL §1 before reading or writing Effect code. A `4.0.0-rc.*` or `-beta.*` install means the project's names differ from the skill's (most visibly the `effect/unstable/*` paths). Follow the installed source and offer the upgrade from `references/migration.md`. A `3.x` install means don't apply v4 shapes at all.
2. **Read the body once per session.** SKILL §1 through §8 is self-sufficient for everyday work. Load a reference only when the row below names it.
3. **Done gate.** SKILL §8 "Before you call it done" is part of **principle-prove-it-works** for any change that touches Effect code. Run its checklist before the reply, and name failures instead of skipping boxes. The Toolbox, Tests and Diagnostics boxes take evidence (the exports checked, the test runner used, the diagnostics output), and matching repo style waives none of them. Your own §8 pass is a self-check. Landing an Effect unit also needs the Effect-expert seat's verdict (`references/review.md`, The Effect-expert seat).

## Where each pstack step opens the effect skill

| pstack step | Open | For |
|---|---|---|
| Any code: name the data shape (poteto-mode Non-negotiables, Feature) | `references/schema.md` §1, §8 | The shape as a Schema, classes vs structs, brands |
| Failures in the shape (**principle-type-system-discipline**, Feature) | `references/errors.md` §2, §3 | Tagged errors and the `reason` pattern |
| Code crossing a function boundary (**architect**, **principle-boundary-discipline**) | SKILL §4, §5, `references/architecture.md` §2, §8 | Service and Layer forms, naming, app structure. Also **effect-service-design** for a new service |
| Parsing at the edge (**principle-boundary-discipline**) | `references/schema.md` §7, `references/errors.md` §7 | Decode runners, mapping foreign errors at the port |
| Before hand-rolling anything (**principle-laziness-protocol**, **principle-subtract-before-you-add**) | SKILL §2, `references/primitives.md`, `references/modules.md` | Effect probably ships it |
| HTTP, SQL, CLI, RPC, AI/MCP, processes, persistence | `references/platform.md` (the matching section) | Canonical shapes and traps |
| Concurrent actors, shared state (**principle-separate-before-serializing-shared-state**) | `references/concurrency.md` §0, §3, §4 | Picking the primitive, coordination, state |
| Retries, idempotency (**principle-make-operations-idempotent**) | `references/concurrency.md` §7, §8 | Bounded retry and timeouts over idempotent operations |
| Resources and lifetimes (**principle-foundational-thinking**) | `references/concurrency.md` §1, §2, `references/architecture.md` §6 | Fibers, Scope, long-lived work in layers |
| Tests (**pstack-tdd**, **principle-test-behavior-not-implementation**) | SKILL §7, `references/testing.md` §1 to §5, §11 | `@effect/vitest`, asserting failures, Layer fakes, TestClock, false greens |
| Bug fix, root cause (**principle-fix-root-causes**) | `references/errors.md` §6, §8, `references/v4-catalog.md` §5 | Reading Cause and Exit, error anti-patterns, behavior traps |
| Perf issue, runtime and trace forensics | `references/platform.md` §14, `references/concurrency.md` §6, §9, §10, `references/errors.md` §6 | Spans and metrics, streams, caching, batching, the Cause on a failed span |
| Refactoring across versions or APIs | `references/migration.md`, `references/v4-catalog.md` §3, §4 | v3 to v4 and RC to 4.0.0 deltas |
| Exact API form or "which of two primitives?" | `references/v4-catalog.md` §1, §2 | Idioms and near-twins |
| Review of any Effect diff (**interrogate**, Opening a PR self-review, **blast-radius**, **reflect**) | `references/review.md` | Its review procedure, smell catalogs A (hand-rolled platform) and B (against the grain), grep recipes, language-service diagnostics, and false greens in tests |
| Done (**principle-prove-it-works**) | SKILL §8 | The self-review checklist |

## Delegating Effect work

A subagent or child thread that will write Effect code gets these lines in its brief, verbatim:

- "Load the **effect** skill and run its §1 version gate before writing code. Follow the installed version where it differs."
- "Before reporting done, run the effect skill's §8 checklist and include its result."
- "Before writing a helper for time, retry, polling, cache, queue, lock, parsing, ordering, grouping, decimal, graph or LLM I/O, search the installed effect (`references/primitives.md`, `modules.md`, review.md catalog A). Report each hand-rolled capability with the export checked (`dist/…:line`) and why it does not fit, or `none`."

Its CONTEXT also carries an `EFFECT MAP` block: the design's Effect inventory (**architect**, The design unit), one line per capability, as `<capability>: <export> (dist/<file>:<line>)` or `none: <reason>`. Name the repo with a `Repo <dir>` line, or pass `--repo`. `orch brief check` refuses an Effect brief that lacks any of the three lines or the block, or cites a `dist` path:line that doesn't resolve under the repo's installed `effect`.

Reviewers of an Effect diff get "Use the effect skill's `references/review.md` procedure" in their brief. A cross-family seat that cannot load skills gets the paths, because the files are plain Markdown it can read. The Effect-expert seat (`references/review.md`, The Effect-expert seat) records its verdict with `orch ledger record <pr> <sha> <idiomatic|fixes-required|inconclusive> --lens effect`. `orch ledger check <pr> <sha> --unit <id>` refuses to land an Effect unit without a passing default verdict and an `idiomatic` effect verdict for that exact head SHA.
