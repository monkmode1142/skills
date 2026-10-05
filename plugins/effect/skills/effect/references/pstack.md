# Effect add-on for pstack

Paste this line into an always-applied rule (`~/.claude/CLAUDE.md`, a project `AGENTS.md`, a Devin rule):

> Stack add-on: effect, for non-frontend TypeScript (frontend UI code only when the project already uses Effect there). Follow the effect skill's `references/pstack.md`.

pstack is language-neutral. Its poteto-mode `references/harness.md` (Stack add-ons) names the steps an add-on can define, and each section below defines one of them for Effect. This file maps pstack steps to the effect skill. It does not re-teach Effect. Paths are relative to the effect skill's directory, and "SKILL §N" is a numbered section of its `SKILL.md`. Project rules beat this file.

## Code

**Covered code.** Non-frontend TypeScript is Effect v4: services, CLIs, scripts, infra, workers, and the tests for those. Frontend UI code (React components, hooks, styling) is plain TypeScript unless the project already uses Effect there. Load the **effect** skill before writing covered code. For a new service module, also load **effect-service-design** when it is installed.

**Version gate, every task.** Run SKILL §1 before reading, explaining, reviewing, or writing Effect code, because v3, the 4.0.0 prereleases, and 4.0.0 read alike and behave differently. A `4.0.0-rc.*` or `-beta.*` install spells names differently, most visibly the `effect/unstable/*` paths. Follow the installed source and offer the upgrade from `references/migration.md` (`references/v4-catalog.md` §4 lists the renames). A `3.x` install gets no v4 shapes at all. Writing about Effect follows the same gate. A sentence about an API is only as true as the gate behind it.

**Read the body once per session.** SKILL §1 through §8 is self-sufficient for everyday work. Load a reference only when the table below names it. Copy a same-version call site from the codebase before inventing a shape.

**Done checklist.** SKILL §8 "Before you call it done" is part of **principle-prove-it-works** for any change that touches Effect code. Run every box before the reply, and name each box that fails instead of skipping it. It covers the version gate, every API checked against the installed `.d.ts` or source, the typecheck, tests that can fail, and language-service diagnostics where the project has them. The Toolbox, Tests and Diagnostics boxes take evidence (the exports checked, the test runner used, the diagnostics output), and matching repo style waives none of them. `references/review.md` holds the full audit for a large change. Your own §8 pass is a self-check. Landing also needs the Effect-expert seat's verdict (Review below). Run §8 on the diff at each verify step: Feature step 5, Bug fix step 4, Refactoring step 6, a hillclimb or perf-issue delegate's diff, an autopilot owner's self-proof, an arena graft, and over the whole change at the end of a figure-it-out run.

**Data shape.** Name the data shape as a `Schema` decoded at the boundary, the failures as `Schema.TaggedError` variants in `E`, and the dependencies as `Context.Service` interfaces provided by `Layer`. Take the shape from `references/schema.md` §1 and §8, the failures from `references/errors.md` §2 and §3, and the services from SKILL §4 and §5. Load the skill and run the gate rather than briefing from memory.

### Where each pstack step opens the effect skill

Open the row's section before acting, not after.

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
| Perf issue, runtime and trace forensics, benchmarks | `references/platform.md` §14, `references/concurrency.md` §6, §9, §10, `references/errors.md` §6 | Spans and metrics, streams, caching, batching, the Cause on a failed span |
| Refactoring across versions or APIs, figure-it-out migrations | `references/migration.md`, `references/v4-catalog.md` §3, §4 | v3 to v4 and RC to 4.0.0 deltas |
| Exact API form or "which of two primitives?" | `references/v4-catalog.md` §1, §2 | Idioms and near-twins |
| Review of any Effect diff (**interrogate**, Opening a PR self-review, **blast-radius**, **reflect**) | `references/review.md` | Its review procedure, smell catalogs A (hand-rolled platform) and B (against the grain), grep recipes, language-service diagnostics, and false greens in tests |
| Done (**principle-prove-it-works**) | SKILL §8 | The self-review checklist |

### Playbooks and skills in Effect code

- **Investigation and how.** Run the version gate before explaining any Effect API. The key abstractions of an Effect codebase are the `Context.Service` tags, the Layers that provide them, and the Schema types. `references/architecture.md` §1 explains how each `yield*` resolves to a Layer.
- **why.** An Effect API that looks odd (`Context.Tag`, `Either`, an `effect/unstable/*` import) often only reflects the version installed when it was written. Date it against the lockfile history and `references/migration.md` before reading it as a design choice.
- **Bug fix.** While binary-searching the cause, read the failure's `Cause` per `references/errors.md` §6, and take the `references/v4-catalog.md` §5 behavior traps as candidate hypotheses. A swallowed or untyped failure gets a `Schema.TaggedError` in the signature's error channel (`references/errors.md` §2). An unvalidated input gets a `Schema` decode at the boundary (`references/schema.md` §7). The repro test follows SKILL §7 and `references/testing.md` §3 and §11, so it goes red for the right reason.
- **Refactoring.** The behavior pin runs the real service over Layer fakes per SKILL §7 and `references/testing.md` §4, and dodges the false greens in its §11. The target shape is the service and Layer graph from SKILL §4 and `references/architecture.md` §8. A move across Effect versions or APIs follows `references/migration.md` and `references/v4-catalog.md` §3 and §4.
- **Perf issue.** Read the instrumentation the runtime already gives you before adding ad hoc timers. Every `Effect.fn("Service.method")` call is a span, so a `Tracer` exporter turns the program into a span tree that shows where the time goes. A `Metric` timer or histogram gives the number the fix is gated on. Take the exporter and metric wiring from `references/platform.md` §14. Several mantras already ship as built-ins, so check before hand-rolling one. "Don't do it again" is caching (`references/concurrency.md` §9). "Do it less" is request batching (§10). "Later" and "when they're not looking" are scoped background fibers and schedules (§1, §7). "Concurrently" is the concurrency options on the combinators (§3), because Effect runs sequentially by default. Review the fix with `references/review.md` and SKILL §8.
- **Runtime forensics.** Export the program's spans through a `Tracer` layer. The `Effect.fn` span that holds the time, or never closes, names the suspect. Take the exporter wiring from `references/platform.md` §14, after the version gate. A fiber that never ends or a resource that never closes usually traces to an unjoined fork or an unscoped resource (`references/concurrency.md` §1, §2).
- **Trace forensics.** An Effect program's span export already names its frames, because each `Effect.fn("Service.method")` span carries the service and method. Load the skill before reading its tracing output. `references/platform.md` §14 explains the span and metric export, and `references/errors.md` §6 reads a failed span's `Cause`.
- **benchmark-checklist.** For "Why not double?", the `Effect.fn` span tree exported per `references/platform.md` §14 often names the limiter before a CPU profile does. For "Was it tuned?", decide whether the timed region includes building the `Layer` (connections, clients, config) or runs against an already-built runtime, and match what production pays per request. Check that `Effect.forEach` and `Effect.all` run with the concurrency production uses, because both default to sequential (SKILL §3). For "Did it even happen?", a discarded Effect is the common case, so check the timed code against catalog B1 and B22 in `references/review.md`.
- **blast-radius.** The probe script runs the real program against the real `Layer`, not a test stub, after the version gate. Where grep stops, the misses in Effect code are lifetimes and wiring. Read `references/concurrency.md` §1 and §2 for forks and scopes and `references/architecture.md` §4 and §5 for a dependency captured at build or a layer that builds twice. Then run the `references/review.md` grep recipes over the touched paths and their callers, treating each hit as a candidate.
- **create-verification-skill.** An Effect service also exports spans and structured logs as observable evidence, wired per `references/platform.md` §14.
- **figure-it-out.** The first phase runs the version gate, and a version migration follows the procedure in `references/migration.md`. The table above maps the remaining phases.
- **correct.** The type level is a Schema, a brand, or a tagged error in `E`. The lint level is the Effect language-service diagnostics, then oxlint or ast-grep rules, per `references/review.md` ("Language-service diagnostics" and "Other enforcement").
- **no-comments and comment-sicko.** Effect language-service suppressions (`@effect-diagnostics`, `@effect-diagnostics-next-line`) count as suppressions, judged against the rule tables in `references/review.md` (Language-service diagnostics). A Correctness rule such as `floatingEffect`, `missingEffectError`, or `missingStarInYieldEffectGen` guards a real bug, so the suppression dies and its symbol gets `MUST KILL`.

### Principles in Effect code

- **Laziness protocol.** The smallest change is often no new code. Before hand-rolling a cache, retry loop, queue, rate limiter, or client, assume Effect ships it and look. Open SKILL §2, then `references/primitives.md` or `references/modules.md`.
- **Subtract before you add.** A hand-rolled cache, retry loop, mutex, or validator that duplicates a platform primitive is the first thing to subtract. Check the SKILL §2 table before keeping it.
- **Foundational thinking.** The core types are the `Schema` definitions and the service contracts (the exported shape interface of each `Context.Service`), written before any `make` (SKILL §5). For concurrency, isolate with a `Ref` per actor or per key. When sharing is real, give one fiber ownership or guard the writer with a `Semaphore`, and fork background fibers with `Effect.forkScoped` so their lifetime is tied to an owner. A layer that runs long-lived work forks it into the layer's scope. Open `references/concurrency.md` §1 and §2 for fibers and `Scope`, and `references/architecture.md` §6 for long-lived work in layers.
- **Model the domain.** The states of a machine are a `Schema.TaggedUnion`, or `Schema.TaggedClass` members of a `Schema.Union` when the states need methods. The transitions are pure functions beside the types, and `Match.valueTags` turns a new state into a compile error at every site that does not handle it yet. Failures are domain too. A `Schema.TaggedError` per outcome replaces an error string that callers parse. Open `references/schema.md` §8 for modeling and `references/errors.md` §2 for error granularity.
- **Boundary discipline.** The boundary is a service at a port. Decode input there with `Schema.decodeUnknownEffect`, hoisted to module scope. Wrap foreign Promise APIs once with `Effect.tryPromise({ try, catch })`, and collapse vendor failures (`HttpClientError`, `SqlError`, `SchemaError`) into the service's own `Schema.TaggedError` family with `Effect.mapError` or `Effect.catchReason`, so none leak inward. Decode external arrays element by element, logging and dropping the bad rows, so one malformed item degrades to a logged partial instead of a blank result. Inside, code runs on decoded types and never re-checks. Business logic stays in plain functions beside the types. The service's `Effect.fn` methods are the thin shell that reads `Clock`, repositories, and clients from the environment and calls those functions. Open `references/schema.md` §7 for the decode runners, `references/errors.md` §7 for mapping at the port, SKILL §6 for element-by-element decoding, and SKILL §4 with `references/architecture.md` §2 for the service and layer forms.
- **Type system discipline.** Run the version gate first. Then the patterns map directly. One `Schema` is the type, the parser, and the wire codec, so the boundary and the type cannot drift. A `Schema.TaggedUnion`, or `Schema.TaggedStruct` and `Schema.TaggedClass` members in a `Schema.Union`, models the variants. `Schema.brand` brands a primitive, and the validation lives in the base schema's checks because `brand` itself checks nothing. `Schema.decodeUnknownEffect` (or a sibling runner) is the parse function at each boundary. `Match.valueTags` exhausts a `_tag` union. Failures are variants too. Declare them as `Schema.TaggedError` classes in the `E` channel instead of throwing, so the compiler tracks which ones each caller still has to handle. Open `references/schema.md` §1 and §8 for the shape, §5 for checks and brands, and `references/errors.md` §2 and §3 for errors and the `reason` pattern.
- **Make operations idempotent.** `Effect.retry` with a `Schedule` makes retrying one line, which is why the idempotence check matters. `HttpClient.retryTransient` does not look at the method, so give writes their own client without it. `Schedule.recurs(n)` and `{ times: n }` mean n retries, so n + 1 runs. Tie cleanup to `Effect.acquireRelease` so a crash or interruption mid-run still releases what it took. Open `references/concurrency.md` §7 for `Schedule` and retry forms, and §8 for timeouts.
- **Separate before serializing shared state.** Separation still comes first. A `Ref` per actor, or one per key, needs no lock. When serializing is unavoidable, the structural tools are a `Semaphore` around the one writer (`yield* Semaphore.make(1)` in the owner's layer is a mutex), a single fiber that owns the state and drains a `Queue`, a `SynchronizedRef` when computing the update is itself effectful, or `TxRef` inside `Effect.tx` when several refs must change together. Fork that owner with `Effect.forkScoped` so it dies with its scope. Open `references/concurrency.md` §0 to pick the primitive, §3 for coordination, and §4 for state.
- **Fix root causes.** The symptom guard has its own spellings. `Effect.ignore`, `Effect.orElseSucceed` with a default, and an `Effect.catch` that swallows every failure all silence the symptom. `Effect.catchCause` in service code also swallows interrupts. Handle a specific tag with `Effect.catchTag` only when the outcome is a real domain branch. To instrument, read the full `Cause` (`Cause.pretty`, or iterate `cause.reasons`) and the spans that `Effect.fn` methods already emit before adding logs. `Cause.squash` keeps only the first failure. Open `references/errors.md` §6 for reading `Cause` and `Exit`, §8 for the swallowing anti-patterns, and `references/v4-catalog.md` §5 when the API name is right but the behavior surprises you.
- **Prove it works.** Tests over `Layer.succeed` stubs and `TestClock` prove the logic, not the running system. They are a proxy for it. After they pass, run the real composition root (the `NodeRuntime.runMain` entry, `Layer.launch`, or the `ManagedRuntime` bridge) against the real services, then read the actual output, the row it wrote, or the `Effect.fn` span in the trace.
- **Test behavior, not implementation.** See Tests below.

### TypeScript rules in Effect code

The **typescript-best-practices** rules hold. In Effect code they take these forms.

| Rule | In Effect code |
|------|----------------|
| Discriminated unions | The discriminant is `_tag`, because `Schema.TaggedUnion`, `Schema.TaggedStruct`, `Schema.TaggedClass`, `Match`, and `Effect.catchTag` all key on it (`references/schema.md` §8.3). When a union crosses a boundary, define it as a schema so the type, the validator, and the wire codec are one definition. `Schema.Union` and `Schema.Literals` take an array in v4, and `Schema.TaggedUnion({ ... })` is the shorthand when every variant is a tagged struct. |
| Branded types | `Schema.String.check(...).pipe(Schema.brand("X"))`. The checks on the base schema are the validation, since `brand` adds none (`references/schema.md` §5, §8.2). A brand with no check is a cast with a nicer name. |
| Constructive modeling | Non-empty is `Array.NonEmptyReadonlyArray<T>`, not a hand-declared tuple. `Schema.NonEmptyArray(S)` decodes straight into it, and `Array.isReadonlyArrayNonEmpty` narrows a plain array once. |
| Simplest total type | The weakened total result is `Option<T>`. |
| Schemas before guards | The schema library is `Schema` and the type is `typeof X.Type`. Do not add zod or valibot beside it. `decodeUnknownEffect` fails with a `SchemaError` in `E`. Use `decodeUnknownResult` or `decodeUnknownOption` when failure is an expected branch in pure code. `decodeUnknownSync` throws, so keep it to non-Effect edges and tests. |
| No `as` casts | When the type comes first (a generated type, a shared interface), annotate the schema with it, as in `const User: Schema.Codec<User> = Schema.Struct({ ... })`. The compiler then rejects a schema that proves less than the type. |
| Type guards | Derive the guard with `Schema.is(X)` so it cannot drift from the schema. |
| Exhaustiveness | `Match.valueTags` and `Match.exhaustive` require a handler per tag and fail to compile when one is missing. |
| Boundary validation | The parse is `Schema.decodeUnknownEffect` (or a sibling runner), and its `SchemaError` maps into the boundary's tagged error (`references/schema.md` §7). Persisted JSON decodes through `Schema.fromJsonString` over a versioned schema. |
| Errors as values | Failures ride the typed `E` channel as `Schema.TaggedError` classes. One tagged error per domain outcome the caller branches on, and one that collapses every foreign failure at the boundary. No `throw`, no `try/catch`, no hand-rolled `Result` type. A bug or misconfiguration is a defect, so promote it with `Effect.orDie` instead of widening `E`. Raise with `return yield* new X({...})` (`references/errors.md` §2, §4, §7). |
| Foreign code at the edge | Wrap a Promise or callback API once, where it enters, with `Effect.tryPromise({ try, catch })` and collapse its failures into one tagged error. No `async`/`await` plumbing inside Effect code. Call `Effect.run*` only at the process edge. Prefer the Effect-native client (`HttpClient` from `effect/http`, `SqlClient` from `effect/sql`) over wrapping `fetch` or a driver yourself (SKILL §2, `references/platform.md`). |
| Services and layers | Dependencies are `Context.Service` tags with package-qualified ids (`"@app/billing/Billing"`), because the string is the runtime identity. Each service builds its own layer as a static (`layer` self-wired, `layerNoDeps` with requirements open for tests), from `Layer.effect(this, make)` returning `X.of({...})`. Access with `yield* X`. No module singletons, no hand-rolled DI containers, no business logic that imports a concrete client. If a dependency can't be swapped for a fake without editing the service, it isn't injected. Forms, naming, and the TDZ trap of `static` layers are in SKILL §4 and `references/architecture.md` §2, §3. |
| Traced functions | Write service methods as `Effect.fn("Service.method")` so every call opens a named span. Don't wrap `Effect.gen` in a bare arrow function, and don't `.pipe` an `Effect.fn`. Pass whole-call combinators as its trailing arguments (SKILL §3). |
| Time and randomness | Read `Clock`, `Random`, and `DateTime` from the environment. No `Date.now()`, `new Date()`, or `Math.random()` in Effect code. Under `it.effect` the clock is a `TestClock`, so the same code runs in virtual time (SKILL §6, `references/testing.md` §5). |
| Concurrency | `Effect.forEach(items, f, { concurrency })` over `Promise.all`. `Effect.all` and `forEach` are sequential until you pass `{ concurrency }`. Shared limits go through `Semaphore` or `RateLimiter` on the shared resource, not at each call site. Background work forks into a scope (`Effect.forkScoped`), never detached by default (SKILL §6, `references/concurrency.md` §1, §3). |
| Schema-derived types | The type is `typeof X.Type`, the wire shape is `typeof X.Encoded`, and a wider struct spreads the fields (`Schema.Struct({ ...User.fields, lastSeenAt: Schema.Number })`). |
| Real tests | See Tests below. |
| Structured telemetry | `Effect.log*` with `Effect.annotateLogs` inside traced functions. |
| Frontend calling an Effect backend | Decode the response with the same `Schema` the backend encodes with when the schema is shared, so the wire contract has one definition. |

## Design

**The design unit.** For non-frontend TypeScript, architect's sketch is an Effect service, not a class or a loose set of functions. Each sketched capability has:

- a `Context.Service` contract. The tag plus a narrow, domain-shaped interface whose methods return `Effect`s.
- `Layer` provision. How the implementation is built and which services it requires, so the dependency graph is visible in the sketch.
- Schema data. Domain types and external inputs as Schemas, decoded once at the boundary.
- tagged errors. Each expected failure is a tagged error in the error channel, not a thrown exception.
- an Effect inventory. For each capability the sketch would build (time, retry, polling, cache, queue, lock, parsing, ordering, grouping, decimal, graph, LLM I/O), name what you searched in the installed `effect` and what you chose, as `searched X, chose Z (dist/<file>:<line>)` or `none fits because …`. It becomes the brief's `EFFECT MAP` block (Delegation below).

Apply the service test from **effect-service-design** before minting a service. A pure calculation or a per-call option stays a value. Run the version gate against the project's installed version and don't write signatures from memory. SKILL §4 and §5 and `references/architecture.md` §2 and §8 give the service and Layer shape, `references/schema.md` §8 the data, and `references/errors.md` §2 and §3 the failures. The Code table maps the rest.

**Module map.** For an Effect design, the module map is the service and Layer graph. The rationale names each service, what its Layer requires, and its tagged errors, and leaves API detail to this skill.

**Red flags.**

- A service method whose requirements name the implementation's dependencies leaks them to every caller. Yield stable dependencies while building the Layer and close over them, per **effect-service-design** and `references/architecture.md` §4.
- An error channel that collapses to `unknown` or one catch-all error (catalog B5 and B9 in `references/review.md`) is a scrap signal, like a leaking requirement.
- A service whose methods only rename or forward another service is a pass-through method at service scale. Use the existing service or keep it a value.
- Split ownership. The owner of a piece of state is one service that holds the state inside its layer and exposes methods to change it. No other module gets the raw reference.
- Information leakage. Export the service and its layers, not the `make` effect or the helpers behind it.
- Two lists of one thing. The one list is usually a Schema, and the types, decoders, and exhaustive matches derive from it.

## Delegation

Every brief for a subagent, child thread, architect runner, arena candidate, autopilot owner, or orchestrate unit that will write or edit Effect code carries these lines verbatim:

- "Load the **effect** skill and run its §1 version gate before writing code. Follow the installed version where it differs."
- "Before reporting done, run the effect skill's §8 checklist and include its result."
- "Before writing a helper for time, retry, polling, cache, queue, lock, parsing, ordering, grouping, decimal, graph or LLM I/O, search the installed effect (`references/primitives.md`, `modules.md`, review.md catalog A). Report each hand-rolled capability with the export checked (`dist/…:line`) and why it does not fit, or `none`."

A cross-family runner that cannot load skills gets the effect skill's path instead, because the files are plain Markdown it can read.

**EFFECT MAP.** The brief's CONTEXT also carries an `EFFECT MAP` block: the design's Effect inventory (Design above), one line per capability, as `<capability>: <export> (dist/<file>:<line>)` or `none: <reason>`. Name the repo with a `Repo <dir>` line.

**Under Orchestrate.** Put the three lines in `preferences.md`, so every spawn and resume carries them and the STANDING check enforces them. Register the map once per program:

```sh
orch brief require "EFFECT MAP" --check "bun <effect plugin root>/scripts/check-effect-map.ts"
```

The plugin root is two directories above the effect skill's own directory. The script validates each `dist/<file>:<line>` citation against the installed `effect` in the repo the brief's `Repo <dir>` line names. A skills-CLI install has no `scripts/` directory, so register the field without `--check` and the map is checked by review only. A unit's ACCEPTANCE includes the SKILL §8 checklist.

## Tests

pstack-tdd's workflow holds for Effect code. Load the skill, run the version gate, and read SKILL §7 before writing the test. Depth is in `references/testing.md`.

- **Use `@effect/vitest`.** Read `package.json` and one existing test first. Effect tests run on `@effect/vitest` at the same version as `effect`, on Vitest 5. Write `it.effect("name", () => Effect.gen(...))`. It provides a `Scope`, `TestClock`, and `TestConsole`. `it.live` runs on the real clock. There is no `it.scoped`. A plain `it` that returns an Effect never runs it, so every assertion in it is a silent pass, and `Effect.runPromise` inside a plain `it` bypasses the test services. If the project lacks it, add it at the `effect` version instead of hand-running Effects with `Effect.runPromise` in another runner (`references/testing.md` §1, §2).
- **On Bun, when Vitest can't load the code** (`bun:sqlite`, Bun-only APIs), use the project's `it.effect` equivalent, usually `test/support/effect.ts`, or create it from `references/testing.md` §1 "Running on bun:test". Matching repo style never justifies `Effect.runPromise` in a test body or a per-file `run` helper. Those escape `TestClock`, and the next agent copies them.
- **Run the real service over test layers.** Build the service under test from its real recipe layer (`layerNoDeps`). Replace only its ports (vendor clients, network, storage) with `Layer.succeed(Port, fake)`, `Layer.mock(Port, partial)`, or an in-memory layer. Do not reach for a mocking framework or replace a whole service with a spy. The dependency is already injected, so the swap is the test seam. Provide per test with `Effect.provide(layer)`. A shared `layer(L)` block carries state, clock time, and console lines across tests (`references/testing.md` §4).
- **Drive time with `TestClock`.** Advance it with `TestClock.adjust` instead of sleeping, and assert the state afterwards instead of asserting that a timer was scheduled. It starts at epoch 0. Fork the sleeping effect, adjust, then join. A real delay under `it.effect` hangs until the Vitest timeout. A timing bug then reproduces deterministically on every run (`references/testing.md` §5).
- **Assert the typed failure.** For a failure path, flip the effect (`Effect.flip`) or read `Effect.result`, then assert the error's `_tag` and fields. Assert a defect through `Effect.exit` and the `Cause` reasons. Don't compare whole failed `Exit`s, because `Effect.fn` spans annotate the cause. `Exit.isSuccess(exit)` alone is a weak assertion, and so is `if (Exit.isFailure(exit)) { ... }` with no else, which asserts nothing when the effect succeeds. "It failed" is not the behavior. `InvoiceNotFound` for `inv_missing` is (`references/testing.md` §3).
- **Prove the test can fail.** pstack-tdd step 4 is not optional here. Break the code the test pins with an editor, watch that test go red for the right reason, and restore. Never use `git checkout` or `git stash` for the mutation (`references/testing.md` §11).
- **Read the count, not only the exit code.** A run that finds no tests exits 1, but a `-t` filter that matches nothing skips every test and exits 0. The run is evidence only when the summary shows your test as passed. Typecheck the test files too, because `it.scoped` and dropped error cases only fail in `tsc`.

```ts nocheck
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

## Review

The review lens is `references/review.md`. Every reviewer of an Effect diff gets "Use the effect skill's `references/review.md` procedure" in its brief: interrogate reviewers, swarm and autopilot audit lanes, arena's cross-judge, orchestrate verifiers. A cross-family seat that cannot load skills gets the path (`~/.agents/skills/effect/references/review.md`), because the file is plain Markdown it can read.

- **Procedure.** Run its version gate and evidence gate first, because a finding written from v3-shaped memory is noise. Sweep the diff with its grep recipes against smell catalog A (a hand-rolled capability Effect already ships, the Effect form of reusing canonical helpers) and catalog B (against the grain, where B14 is the Effect form of needless sequential orchestration). Check test files against its false-greens list, such as a plain `it` returning an Effect, `it.scoped`, or `Effect.runPromise` inside a test, which pass without running anything. Read the language-service diagnostics when the project has them. Cite each Effect API from the installed `.d.ts` or `src`, never from memory, and tag the finding with its tier and rule id (for example `BUG`, catalog B1).
- **Contracts.** Expected failures belong in the typed error channel as tagged errors, and untrusted input is decoded with Schema once at the boundary.
- **interrogate.** Package the installed `effect` version from the SKILL §1 gate with the diff, so every reviewer judges against the same version. Reviewers map the review tiers onto interrogate's severities, `BUG` to `critical`, `PERF`, `SCHEMA` and `ARCH` to `warning`, and `IDIOM` to `nit`, and keep the rule id in the title. The lead dismisses a proposed Effect API the installed version does not have, checked against the evidence gate, and keeps the underlying smell if it is real.
- **Opening a PR.** The self-review runs SKILL §8 plus the grep recipes and language-service diagnostics in `references/review.md`.
- **Review bots.** Check a bot comment on Effect code with `references/review.md` before you classify it. Run its version and evidence gates, match the claim to catalog A or B or the false-greens list, and cite the installed `.d.ts` or `src` in the reply. Bots review Effect from v3-shaped memory, so the finding can be real while the suggested fix is a removed API. Skip a suggestion whose API does not exist at the installed version when the underlying concern is already handled. Typical shapes in a 4.0.0 repo are `Effect.catchAll`, `Either`, `Context.Tag`, `Effect.Service`, `Layer.scoped`, `Effect.fork`, or an `effect/unstable/*` import. Do not skip a comment that names a real smell from the catalogs, such as a floating effect, a runner inside library code, a `try/catch` around `yield*`, an unjoined fork, or a test false green. Fix it with the 4.0.0 form instead of the bot's form.

**The Effect-expert seat** (`references/review.md`, The Effect-expert seat) is the lens's landing verdict. Your own §8 pass does not count as this review. Under Orchestrate, register the lens once per program:

```sh
orch lens require effect
```

The seat records its verdict at the unit's head SHA with `orch ledger record <pr> <sha> <verdict> --lens effect`, where the verdict is `pass` (idiomatic), `fixes-required`, or `inconclusive`. `orch ledger check <pr> <sha> --unit <id>` then refuses to land a unit without a passing default verdict and a `pass` effect verdict for that exact head SHA.

## Reflection

**Tooling reviewer.** For each unit in the transcript that wrote Effect code, report three counts before any finding:

- Count deltas. The diagnostics and lint count lines (per-rule counts, `Effect.run*`-in-tests debt) at the unit's start and end, as printed by the project's check. A count that rose is a finding.
- Toolbox loads. How many times the agent opened `references/primitives.md`, `modules.md` and `testing.md`. Zero loads on a unit that hand-rolled time, retry, polling, caching, parsing or test runners is a missed load. Route it to the pstack step that should have opened the file, per the Code table above.
- Effect lens. Whether the unit landed with an `effect` ledger verdict from the other family for its head SHA.

Check an Effect quirk against this skill first (`references/v4-catalog.md` §5 and the `references/review.md` catalogs). A quirk it documents is a missed load, so route it to the pstack step that should have opened that section per the Code table. A quirk it lacks routes to this skill's matching reference.

**Divergent reviewer.** Effect code written or reviewed without the version gate, the SKILL §8 checklist, or `references/review.md` is a skill invoked too late or not at all.

**Synthesizer.** Effect API facts live in this skill, and pstack only points at its sections. Reroute a pstack edit that re-teaches an Effect API to this skill's matching reference, or reject it as `already-covered` when that reference states it.
