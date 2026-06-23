---
name: effect
description: >-
  Writing or reviewing Effect (TypeScript) code — services, Layers, Schema, Streams, error
  channels, runtime wiring — or deciding how to structure an Effect codebase. Use this whenever
  code imports `effect`, when an Effect API or type looks wrong, when adding or wiring a
  `Context.Service` / `Layer`, or when reasoning about dependencies, boundaries, and architecture
  in an Effect project — even if "Effect" isn't named explicitly. Your training is biased toward
  Effect v3, which differs sharply from the current v4 (`effect@beta`, the effect-smol rewrite):
  consult this to avoid writing v3 APIs by reflex and to apply the right layering, DI, and
  architecture patterns.
---

# Effect v4

The value of this skill is the **delta from your defaults**. Your Effect knowledge is v3-shaped;
v4 changed services, module paths, Schema, streams, and removed `Runtime<R>`. Most bad Effect code
is plausible-looking v3 written from memory. Everything here either corrects a v3 reflex or encodes
a design pattern you wouldn't reach for by default — nothing restates what you already do.

Read the whole body before writing Effect code; it's meant to be self-sufficient. The two reference
files are catalogs you consult for a specific lookup, not required reading.

---

## 1. The one rule: this is v4, not v3 — verify before you write

Your training will hand you v3 APIs that compile in your head and fail in the editor. Treat your
memory of any Effect API as a *hypothesis*, not a fact. The official docs (effect.website) and the
generated API reference are **also v3** — don't cite them for a v4 signature either.

**Completion criterion — apply this before calling any Effect change done:**

> Every Effect API used in the change is confirmed against the **v4 source** — the installed
> `effect` package, its `LLMS.md`, or an existing v4 call site in the repo — not assumed from
> memory. Account for *every* API, not "the ones that looked unfamiliar." An API you can't confirm
> is wrong until you confirm it.

How to verify, fastest first:
- **Grep the codebase for an existing call site** before inventing one — copy the real shape.
- Read `node_modules/effect` (the installed source is the truth) or the project's
  `repos/effect/LLMS.md` if present.
- **No v4 source reachable?** (no `node_modules/effect`, no `repos/effect`, no call sites — e.g.
  you're outside an Effect project) — clone the v4 source once and read it. `effect-smol` is the v4
  (`effect@beta`) rewrite:
  ```sh
  DIR="${TMPDIR:-/tmp}/effect-smol"
  [ -d "$DIR" ] || git clone --depth 1 https://github.com/Effect-TS/effect-smol "$DIR"
  ```
  Reuse the clone if the directory already exists (`git -C "$DIR" pull --depth 1` to refresh). Read
  its `packages/effect/src/*` for real signatures and any `LLMS.md` / `MIGRATION.md` indexes at the
  root.
- **Read the module's top docstring first.** Every v4 `Module.ts` opens with a team-written
  **Mental model / Common tasks / Gotchas / Example** block — the fastest correct grounding for a
  primitive. Then: `LLMS.md` for the blessed idioms · `MIGRATION.md` / `migration/v3-to-v4.md` for
  the exact rename · `ai-docs/src/**` for runnable v4 snippets · `.patterns/effect.md` for the
  team's own style rules (e.g. prefer `Effect.fnUntraced` over a function that only returns
  `Effect.gen`; class-form `Context.Service`; no `Date.now`, use `Clock`).
- This is the difference between Effect code that works and Effect code that looks like it should.

---

## 2. Lean on the platform (don't hand-roll what Effect ships)

Before writing caching, persistence, state, queues, scheduling, retries, rate-limiting, logging,
tracing, metrics, or concurrency by hand — **assume Effect ships it and go look.** Hand-rolling a
primitive the platform already provides is a defect, not a shortcut: you lose the composition,
observability, and resource-safety the built-in guarantees, and you maintain code that didn't need
to exist.

| If you're about to hand-roll…                       | Reach for…                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| a `Ref<{value, at}>` + manual TTL check; any cache  | `Cache.make` / `Cache.makeWith({ lookup, timeToLive })` (stores the `Exit`, dedupes misses) |
| raw `bun:sqlite` / a KV table / a JSON blob on disk | `SqlClient` (`effect/unstable/sql`) · `KeyValueStore` · `Persistence` (`effect/unstable/persistence`) |
| hit/miss / latency / health counters in a `Ref`     | `Metric.counter` / `histogram` / `frequency` / `gauge` + `Metric.snapshot`                  |
| ad-hoc timing, `console.log`, health booleans       | `Effect.withSpan` · a custom `Logger`/`Tracer` · `Effect.log*`                              |
| `Promise.all` / a pool / a token bucket / debounce  | `Effect.forEach({ concurrency })` · `forkScoped` · `Schedule` · `RateLimiter` · `Semaphore` · `PubSub` |
| `try/catch`, `throw`, or a hand-rolled `Result`     | the typed `E` channel · `Effect.tryPromise({ catch })` · `Schema.TaggedErrorClass`          |

When something looks like it can't be done with a built-in, that's a signal to look harder — check
the source before building around it.

---

## 3. The idioms that bite (v4 forms you'd otherwise get wrong)

The highest-frequency places your v3 reflex is wrong. Full catalog with verified call sites and the
complete v3→v4 rename/move table: **`references/v4-catalog.md`**.

- **Service = one form.** `class Users extends Context.Service<Users, UsersApi>()("Users") {}`
  — types first via the generic, id string to the *returned* constructor. v3's `Context.Tag` /
  `Context.GenericTag` / `Effect.Tag` / `Effect.Service` all collapsed into this. (v3 put the id first.)
- **Get a service** with `yield* Users` inside `Effect.gen` — it adds `Users` to the effect's
  `R`. The static accessor proxy is gone; `Users.use(m => …)` exists but `yield*` keeps deps
  visible, so prefer it.
- **Build a service:** `const make = Effect.gen(function*(){ const dep = yield* Dep; return Users.of({…}) })`,
  then `Layer.effect(Users, make)`. No auto `.Default` layer — you write the `Layer` yourself.
- **Module paths moved under `effect/unstable/*`** — `effect/unstable/http` (HttpClient),
  `…/persistence` (RateLimiter, Persistence, KeyValueStore), `…/sql` (SqlClient). Never import from
  `@effect/platform` or `@effect/experimental`. (Verify the exact subpath in the installed source.)
- **Schema, the biggest break.** `Schema.Struct`, `Schema.brand`, `.check(Schema.isPattern(/…/))`
  (v3: `.pipe(Schema.pattern)`), `Schema.BigIntFromString` (bigint in memory ⇄ decimal string on the
  wire).
- **`Schema.Literals([…])` and `Schema.Union([…])` take an ARRAY** (v3: variadic). This is the most
  common mechanical break when reading or writing v4.
- **Tagged errors:** `class SourceError extends Schema.TaggedErrorClass<SourceError>()("SourceError", { … }) {}`
  — at once an Effect error and a wire-encodable value. (v3: `Schema.TaggedError()(…)`.)
- **Extend a struct** by spreading `.fields`: `Schema.Struct({ ...Other.fields, more })`. Infer the
  type with `Schema.Schema.Type<typeof X>`.
- **`gen` vs `fn` — and `fn` is free tracing.** `Effect.gen(function*(){…})` → one Effect (a zero-arg
  thunk). `Effect.fn("name")(function*(args){…})` → a reusable function that **opens a named span
  (`"name"`) on every call**, so each invocation lands in your traces with timing and parent/child
  nesting — no manual `Effect.withSpan` needed. The standard: name service methods
  `Effect.fn("Service.method")` so the trace tree mirrors your call graph for free. Pass trailing
  combinators as extra args (`Effect.fn("name")(function*(){…}, Effect.withSpan(…), Effect.timed)`) —
  **don't `.pipe` an `Effect.fn`**; they run *inside* the span. `Effect.fnUntraced` is the same
  generator syntax with no span — use it only on hot/trivial paths. Reach for a bare
  `const f = (x) => Effect.gen(…)` wrapper essentially never: it's the same cost and you lose the span.
- **Streams:** `Stream.callback` (v3: `Stream.async`), `Stream.fromPubSub`, `Stream.share`
  (refcounted; zero consumers unwinds the source), `Stream.toAsyncIterableEffect`. `SubscriptionRef.changes`
  already replays the current value — don't prepend it.
- **`Runtime<R>` is GONE.** Carry a `Context<R>`; run functions live on `Effect`
  (`Effect.runForkWith(services)`; `Effect.runtime<R>()`→`Effect.context<R>()`).
  `ManagedRuntime.make(layer)` remains for app-level wiring. Other renames: `Either`→`Result`,
  `Effect.catchAll`→`Effect.catch`, `Layer.scoped`→`Layer.effect`, `Effect.async`→`Effect.callback`.
- **The fork family is four — and bare `fork` is gone.** No `Effect.fork`, no `forkDaemon`. Pick by
  lifetime: `forkChild` (supervised by the parent — the default), `forkScoped` (dies with the
  `Scope`), `forkIn(scope)`, `forkDetach` (the daemon, attached to the global root). A fork schedules
  to the next tick unless you pass `{ startImmediately: true }`; interruptibility rides the options
  too (`forkChild(eff, { uninterruptible: true })`).
- **`Cause` is a flat `reasons[]`, not a tree.** v3's `Sequential`/`Parallel`/`Then` nodes are gone —
  `.filter` the reasons with `Cause.isFailReason` / `isDieReason` / `isInterruptReason`. Pull the
  typed error with `Cause.findErrorOption` (`Cause.findError` returns a `Result`). `isInterrupted`→
  `hasInterrupts`; `TimeoutException`→`TimeoutError`; `InterruptedException` removed.
- **`Result` is success-first.** `Result<A, E>` (v3 `Either<E, A>` flipped); `Right`/`Left`→
  `Success`/`Failure`, read `.success`/`.failure`. And `Option.some(x)` wraps anything, so
  `Option.some(null)` is a `Some<null>` — use `Option.fromNullishOr` to fold nullish → `None`.

> **Output-decode trap.** If a Standard-Schema adapter validates a handler's *return* (e.g. oRPC's
> `.output`), it runs *decode* on the value you already produced — so the output schema must accept
> the decoded type. Native `Schema.BigInt` (identity on a bigint) passes; `BigIntFromString`
> (string→bigint) *fails*. Use native-bigint projections for outputs.

---

## 4. Layers & dependencies — how DI actually works

This is the mental model to reason from. The full mechanism (MemoMap internals, the `Runtime<R>`
removal, the resolution trace) is in **`references/architecture.md`**.

- **The environment is a typed map** (`Context` / ServiceMap): tag → implementation. A service tag
  is a key into it; `yield* Tag` is a lookup. The `R` in `Effect<A, E, R>` is the set of keys still
  unsatisfied — it must reach `never` before the effect can run, so a missing dependency is a
  **compile error at the composition root**, never a runtime null.
- **`Layer<ROut, E, RIn>`** = provides `ROut`, build can fail `E`, requires `RIn` first.
  `Layer.effect(Tag, make)` builds the service by running `make`; whatever `make` does `yield* Dep`
  on becomes the layer's `RIn`. The dependency graph is the union of every `yield*`, propagated into
  the type — you never hand-maintain a dependency list.
- **Recipe vs wired instance.** Keep the `Layer` recipe written against *tags only* — it must never
  import a concrete implementation. Provide the real (or fake) deps at the composition root with
  `Layer.provide`. That deferral is the whole point.
- **Compose with:** `Layer.provide` (feed deps in; consumed, not re-exported), `Layer.mergeAll`
  (union siblings), `Layer.provideMerge` (provide *and* re-export — e.g. install a Logger/Tracer at
  the root), `Layer.unwrap` (a layer whose shape depends on a config value — the one place a graph
  branches), `Layer.succeed` (a ready value, e.g. a test stub).
- **Each layer builds once.** Builds are memoized by identity; in v4 the MemoMap is shared across
  `Effect.provide` calls, so a shared dependency (one SqlClient, one rate-limited client) is built a
  single time. `Layer.fresh` / `{ local: true }` opt out when you genuinely want isolation.
- **`ManagedRuntime.make(AppLayer)`** builds the whole graph once, holds the scope (every
  `forkScoped` daemon lives and dies with it), and supplies the `Context` to each effect it runs.
- **The swap is the architecture.** Live ↔ replay, real DB ↔ in-memory, all behind the same tags.
  Tests run the *real* services over `Layer.succeed(Port, stub)` and in-memory layers — no mocking
  framework, because the dependency is already injected. Litmus test: if you can't replace a
  dependency with a fake *without editing the service*, it isn't injected.
- **The contract-first file template** (every service/repository reads the same way, so any file is
  walkable cold): **CONTRACT** (the `XyzApi` interface + the `Context.Service` tag) → **POLICY** (the
  numbers/limits with their math) → **HELPERS** (pure private functions) → **FACTORY**
  (`const make = Effect.gen(…)`) → **PROVISION** (`export const XyzLayer = Layer.effect(Xyz, make)`).
  Pure domain functions that speak your types live *next to the types*, not in services.

---

## 5. The Effect way (the design discipline)

- **Design against contracts.** Define the interface/Schema *before* the implementation. A **port**
  (the seam to the outside world) is a tag + shape that carries **no `Layer`**; implementations are
  swappable layers behind it. Schema is the single source of truth — one definition is the type, the
  runtime validator, the wire codec, and the generated doc, so the boundary can't drift.
- **Separation of concerns.** Services = business logic. Repositories = data access, no domain
  logic. Ports = the swappable seam. Pure derivations = the math, beside their types. A
  *composition* reads other in-memory services rather than the network. Small services you can walk
  in isolation beat one god-service.
- **Errors in the type.** Model failures as `Schema.TaggedErrorClass` and declare them in `E` so the
  compiler forces handling. No `try/catch`/`throw` in Effect code — wrap foreign calls with
  `Effect.tryPromise({ catch: e => new SourceError(…) })` and collapse the messy world to one tagged
  error at the boundary. Hold the line between a **typed error** (a real domain outcome) and a
  **defect** (a bug); promote "can't happen / misconfiguration" to a defect with `Effect.orDie`.
- **Observe by default.** Instrument with `Effect.withSpan` and `Metric.*` as you write, not after —
  and get most of it for free by writing methods as `Effect.fn("Service.method")` (every call is a
  span). A behavior you can't see is one you'll debug by guessing.

---

## 6. Building Effect systems (production principles)

The foundation is elsewhere in this skill — services behind tags (§4), errors as data (§5), and the
platform over hand-rolling (§2). These are the system-level moves on top: what separates an Effect
codebase that compounds from one that fights itself. Worked code is in
**`references/architecture.md`**.

- **Tame the outside world at the port.** A boundary (HTTP, DB, queue, third-party API) is where
  uncertainty stops: `Schema.decodeUnknown*` the input there so the interior runs on validated types
  and never re-checks (*parse, don't validate*), and `Effect.mapError` foreign failures into your own
  tagged-error family so no `HttpClientError` / `SqlError` leaks inward. Decode external arrays
  **element by element** — drop and log the bad rows — so one malformed item degrades to a logged
  partial instead of blanking the whole result.
- **Structured concurrency and resource safety, by construction.** Tie resources to a `Scope`
  (`acquireRelease` — finalizers run LIFO on success, failure, *and* interruption) and fork into a
  scope (`forkScoped` / `forkChild`), reaching for `forkDetach` only when you truly mean to outlive
  the caller. Keep work sequential by default; opt into parallelism with `{ concurrency: n }` and
  govern shared pools/quotas with `Semaphore` / `RateLimiter`. Leaks, orphaned daemons, and unbounded
  fan-out then *can't* happen — they're not things you remember to prevent.
- **Govern cross-cutting concerns at the DI seam.** Enforce a shared budget — a rate limit, a
  concurrency cap, an auth header, a tracing wrapper — by wrapping the shared resource's *layer*
  itself (e.g. transform the `HttpClient` layer) rather than trusting each call site to behave. Every
  consumer is then governed by construction and a new feature physically can't route around it.
- **Determinism is the testing strategy.** Take `Clock`, `Random`, and `DateTime` from services, never
  ambient (`Date.now()` / `Math.random()` are banned for exactly this reason). A test then provides a
  fake behind the real tag (§4's swap) and advances a `TestClock` instead of sleeping — the *same*
  production logic runs instantly and flake-free, and the same seam powers replay/simulation.
- **Contain Effect at the edges; run at the end of the world.** Enter foreign code with
  `Effect.tryPromise` / `Effect.promise`, and call `runFork` / `runPromise` only at the process
  boundary — never round-trip through the runtime inside business logic. This keeps the runtime in one
  place and lets you adopt Effect one module at a time instead of all at once.

---

## References

Consult these for a specific lookup — the body above stands on its own.

- **`references/v4-catalog.md`** — every v4 idiom with a verified call site, the *complete* v3→v4
  rename/module-move table, a **near-twin decision table** (which of `Ref`/`SubscriptionRef`,
  `Queue`/`PubSub`, `Cache`/`Resource`, `Semaphore`/`Pool`… to reach for), and a **behavior-trap**
  list (right name, surprising semantics). Read it for a specific API, a "which primitive?" call, or
  when migrating v3 code.
- **`references/architecture.md`** — the full DI/runtime mechanism (Context/ServiceMap,
  `Layer<ROut,E,RIn>`, the shared MemoMap, the `Runtime<R>` removal), several §6 principles worked out
  in real code (boundary decode · governing at the DI seam · the run/edge adapter · a TestClock test),
  and end-to-end recipes (add a service · a Schema type · a streaming procedure · a typed error). Read
  it when implementing a whole pattern or when you need *exactly* how resolution works.
