# Effect v4 — services, layers, DI, application architecture

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

How dependency injection actually resolves, every way to define a service, every Layer
constructor, the memoization rules that decide whether you get one pool or two, how to run at the
edge, and how to lay out an Effect application. Error modeling lives in `references/errors.md`,
test harnesses in `references/testing.md`, platform services in `references/platform.md`.

## Contents
1. [How DI resolves](#1-how-di-resolves) — Context, `R`, `Layer<ROut, E, RIn>`, MemoMap, no `Runtime<R>`
2. [Defining services](#2-defining-services) — every 4.0.0 form, naming the shape, traps
3. [Layer constructors & composition](#3-layer-constructors--composition) — table, naming, recipe vs wired
4. [Construction-time vs per-call dependencies](#4-construction-time-vs-per-call-dependencies)
5. [Memoization traps](#5-memoization-traps) — two pools, split counters, per-request rebuilds
6. [Long-lived work in layers](#6-long-lived-work-in-layers)
7. [Entry points: running at the edge](#7-entry-points-running-at-the-edge) — `runMain`, `ManagedRuntime`, bridges
8. [Application structure](#8-application-structure) — file template, modules, ports/adapters, libraries
9. [Production practices, worked](#9-production-practices-worked) — boundary decode, DI-seam governance, upstream adapter, edge adapter, config, determinism
10. [Recipes](#10-recipes) — add a service · Schema type · typed error · streaming procedure · wire an app · swap live/test

---

## 1. How DI resolves

**The environment is a typed map.** A `Context<R>` maps service keys to implementations. A key's
runtime identity is its **string id**; `yield* Users` is a lookup in the current fiber's Context.
The `R` of `Effect<A, E, R>` is the union of keys still unsatisfied. The compiler tracks it and
`Effect.run*` only accepts `R = never`, so a missing dependency is a compile error at the
composition root, never a runtime `undefined`.

**A Layer builds part of the map.** `Layer<ROut, E, RIn>` provides `ROut`, may fail with `E` while
building, and needs `RIn` first. `RIn` is inferred from whatever the constructor `yield*`s — you
never hand-maintain a dependency list.

```ts
import { Context, Effect, Layer } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

export interface EventLogShape {
  append(event: string): Effect.Effect<void, SqlError.SqlError>
}
export class EventLog extends Context.Service<EventLog, EventLogShape>()("@app/events/EventLog") {
  // RIn = SqlClient, inferred from the yield* below. Scope is excluded automatically.
  static readonly layerNoDeps: Layer.Layer<EventLog, never, SqlClient.SqlClient> = Layer.effect(
    this,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      return EventLog.of({
        append: (event) => sql`INSERT INTO events (body) VALUES (${event})`.pipe(Effect.asVoid)
      })
    })
  )
}
```

Compose up the graph and `RIn` shrinks at each `Layer.provide`; when the top layer's `RIn` is
`never`, the graph is complete.

**Build once: the MemoMap.** Layer builds are memoized **by object reference** in a `MemoMap`.
Within one build every occurrence of the same layer value is constructed once and shared. In v4 the
built Context carries its MemoMap (`Layer.CurrentMemoMap`), so a nested `Effect.provide` reuses
layers an enclosing provide (or `ManagedRuntime`) already built. Probe results at 4.0.0:

| Setup | Builds |
|---|---|
| `p.pipe(Effect.provide(L), Effect.provide(L))` (nested) | 1 |
| inner `Effect.provide(Layer.fresh(L))` or inner `{ local: true }` | 2 — opts that layer out |
| outer `Effect.provide(L, { local: true })` with plain inner `provide(L)` | **1** — `local` gives the outer build its own map, which the inner provide still inherits |
| two sequential `Effect.provide(p, L)` (not nested) | 2 — first scope closed, resource released |
| `Layer.mergeAll(A.pipe(Layer.provide(L)), B.pipe(Layer.provide(L)))` | 1 |
| same, but each side calls a factory `makeL()` | 2 — different references |
| two `ManagedRuntime.make(L)` | 2, unless both get the same `{ memoMap }` |

`Layer.fresh(layer)` and `Effect.provide(layer, { local: true })` exist for test isolation and
deliberately independent pools; put them on the layer you want rebuilt, not around the program.

**`Runtime<R>` is gone.** A runtime is now just a `Context<R>`, and the run functions live on
`Effect`: `Effect.context<R>()` captures the current services; `Effect.runForkWith(ctx)`,
`runPromiseWith`, `runPromiseExitWith`, `runSyncWith`, `runCallbackWith` run against them. The
`Runtime` module is reduced to process plumbing (`makeRunMain`, `Teardown`, `defaultTeardown`,
`errorExitCode`, `errorReported`).

```ts
import { Context, Effect } from "effect"

class Logger extends Context.Service<Logger, { log(message: string): void }>()("@app/Logger") {}

// Hand a callback-based library a function that runs effects with *our* services
// (and our tracer, logger, config provider) instead of a bare runFork.
export const main = Effect.gen(function*() {
  const services = yield* Effect.context<Logger>()
  const run = Effect.runForkWith(services)
  setTimeout(() => run(Effect.gen(function*() { (yield* Logger).log("tick") })), 10)
}).pipe(Effect.provideService(Logger, Logger.of({ log: (m) => console.log(m) })))
```

**`ManagedRuntime` is a long-lived Context.** `ManagedRuntime.make(AppLayer, { memoMap? })` builds
the graph lazily on first run (probe-verified), holds the root `Scope` (every `forkScoped` daemon
in a layer lives until `dispose()`), and runs effects against the built Context. Several runtimes in
one process share layers only when they share a MemoMap: `const memoMap =
Layer.makeMemoMapUnsafe()` once, then `ManagedRuntime.make(L, { memoMap })` for each.

**The swap is the architecture.** Because constructors are written against keys, live ↔ fake is
one provided-layer change with zero edits to the service. Litmus test: if you can't replace a
dependency with a fake without editing the service, it isn't injected.

---

## 2. Defining services

| Form | Use for |
|---|---|
| `class X extends Context.Service<X, Shape>()("pkg/path/X") {}` | the default: a nominal key whose instance type carries the shape |
| `class X extends Context.Service<X>()("pkg/path/X", { make }) {}` | shape inferred from `make`; class gets a static `make` (an `Effect`, or `(...args) => Effect`) |
| `const X = Context.Service<Shape>("pkg/path/X")` / `Context.Service<Id, Shape>(…)` | function-style key; witness values, quick local keys |
| `const X = Context.Reference<T>("pkg/path/X", { defaultValue: () => T })` | a key with a default — never appears in `R`; override with `Effect.provideService` |

The class form with explicit shape and a static layer — the official template:

```ts
import { Context, Effect, Layer, Schema } from "effect"

export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
  cause: Schema.Defect()
}) {}

// Export the shape: consumers, fakes, and adapters type against it.
export interface DatabaseShape {
  query(sql: string): Effect.Effect<ReadonlyArray<unknown>, DatabaseError>
}

export class Database extends Context.Service<Database, DatabaseShape>()("@app/db/Database") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function*() {
      const query = Effect.fn("Database.query")(function*(sql: string) {
        yield* Effect.logDebug("query", sql)
        return [] as ReadonlyArray<unknown>
      })
      return Database.of({ query })
    })
  )
}

// Two ways to name the shape from the key:
export type Shape1 = Database["Service"]
export type Shape2 = Context.Service.Shape<typeof Database>
```

The `make` form — shape inferred, layer built from `this.make`:

```ts
import { Config, Context, Effect, Layer } from "effect"

export class Greeter extends Context.Service<Greeter>()("@app/Greeter", {
  make: Effect.gen(function*() {
    const prefix = yield* Config.String("GREETING").pipe(Config.withDefault("hello"))
    return { greet: (name: string) => Effect.succeed(`${prefix}, ${name}`) }
  })
}) {
  static readonly layer = Layer.effect(this, this.make)
}
```

Function form and `Context.Reference`:

```ts
import { Context, Effect } from "effect"

// Witness key: a value, not behavior.
export const RequestId = Context.Service<string>("@app/http/RequestId")

// Reference: has a default, so it is never a requirement.
export const FeatureFlag = Context.Reference<boolean>("@app/FeatureFlag", { defaultValue: () => false })

export const program = Effect.gen(function*() {
  const id = yield* RequestId // R = string-keyed RequestId
  const on = yield* FeatureFlag // R unaffected
  return `${id}:${on}`
}).pipe(Effect.provideService(RequestId, "req-1"), Effect.provideService(FeatureFlag, true))
```

Helpers on every key:

- `X.of(impl)` — identity with a type check; use it to build the impl inside `make`.
- `yield* X` — preferred access. `X.use((x) => …)` / `X.useSync((x) => …)` exist for one-liners at
  edges; inside generators they only add nesting.
- `X.context(impl)` — a one-service `Context` (for `Effect.provideContext`, `Layer.succeedContext`).
- The key **is an Effect** (`Context.Key<I, S> extends Effect<S, never, I>`), so it pipes:
  `Database.pipe(Effect.flatMap((db) => db.query("…")))`.
- `new X()` doesn't type-check (`new (_: never)`) — the class is a key, not an implementation.

Rules:

- **Package-qualified ids** (`"@app/users/Users"`, `"myapp/db/Database"`). The string is the
  runtime identity: two unrelated services with id `"Database"` silently occupy the same slot. The
  flip side: if a bundle ends up with two copies of your package, both copies' keys resolve to the
  same slot (good), but two copies of `effect` itself is a version-mixing bug — dedupe to one.
- **No non-effectful members on shapes** unless they're genuinely static data. Every operation
  returns `Effect`/`Stream`; `Layer.mock` treats non-effectful members as *required* (its
  `PartialEffectful` type), and plain functions can't be traced, retried, or swapped for a failing
  fake.
- **No dual (data-first/data-last) members** on service shapes — methods take arguments, period.
  Prefer an options object once there are two or more parameters.
- **No type parameters on the service** (`Context.Service<Repo<T>, …>` can't be a single key). Make
  the methods generic, or define one key per entity.
- **TDZ in static initializers.** `static readonly layer = …` runs when the class is defined.
  Reference the class as `this` (or by name — the inner binding exists), but anything else it
  touches — a module-level `make`, another service's `layer` — must be declared *above* the class.

```ts nocheck
export class Users extends Context.Service<Users, UsersShape>()("@app/Users") {
  static readonly layer = Layer.effect(this, make) // ReferenceError: make is in its TDZ
}
const make = Effect.gen(function*() { /* … */ })

// Fixes: declare `make` above the class, use the `{ make }` form, or defer:
//   static readonly layer = Layer.suspend(() => Layer.effect(Users, make))
//   static readonly layer = (deps: Deps) => …   // only if it's bound to a const once (§5)
```

---

## 3. Layer constructors & composition

| Constructor | Signature sketch | Use for |
|---|---|---|
| `Layer.succeed(X, impl)` / `Layer.succeed(X)(impl)` | `Layer<X>` | ready values, stubs |
| `Layer.sync(X, () => impl)` | `Layer<X>` | cheap synchronous construction (fresh mutable state per build) |
| `Layer.effect(X, eff)` | `Layer<X, E, Exclude<R, Scope>>` | the workhorse. **It is the scoped form**: `acquireRelease` inside releases when the layer's scope closes. No `Layer.scoped` in v4 |
| `Layer.effectDiscard(eff)` | `Layer<never, E, Exclude<R, Scope>>` | run something for its effect at build: start a daemon, migrate, register routes. Replaces `scopedDiscard` |
| `Layer.effectContext(eff)` / `Layer.succeedContext(ctx)` / `Layer.syncContext` | `Layer<A, …>` | one acquisition that provides several keys |
| `Layer.unwrap(eff)` | `Effect<Layer<…>> → Layer<…>` | choose a layer from config / a probe at build time — the one place the graph branches |
| `Layer.suspend(() => layer)` | lazy | break a TDZ or recursive reference |
| `Layer.fresh(layer)` | same type | opt this layer out of memoization |
| `Layer.mock(X, partial)` / `Layer.mock(X)(partial)` | `Layer<X>` | tests: missing effectful members die with "unimplemented" when called |
| `Layer.updateService(X, f)` | adds `X` to `RIn` | rewrite a service *the layer consumes* (decorate a dependency for this subtree) |
| `Layer.provide(deps)` | `Layer<ROut, E \| E2, RIn2 \| Exclude<RIn, ROut2>>` | feed deps in; deps' outputs are **hidden**. Accepts a non-empty array |
| `Layer.provideMerge(deps)` | outputs `ROut \| ROut2` | feed deps in **and** re-export them. Accepts an array |
| `Layer.merge(a, b)` / `Layer.mergeAll(...layers)` | union | independent siblings, built **concurrently** — siblings can't feed each other. Duplicate keys: **last wins** |
| `Layer.flatMap(layer, (ctx) => layer2)` | | a layer that depends on another's built Context. `Layer.discard` → `Layer.flatMap(l, () => Layer.empty)` |
| `Layer.launch(layer)` | `Effect<never, E, RIn>` | build and hold forever — the app entrypoint |
| `Layer.empty` | `Layer<never>` | identity for folds |
| `Layer.orDie`, `catch`, `catchTag`, `catchCause`, `tap`, `tapError`, `tapCause`, `withSpan`, `withParentSpan` | | build-error policy and observability on a layer |
| `Layer.build`, `buildWithScope`, `buildWithMemoMap`, `makeMemoMap(Unsafe)`, `forkMemoMap` | | manual builds (runtimes, framework adapters) |
| `Layer.Success<typeof L>`, `Layer.Error<typeof L>`, `Layer.Services<typeof L>` | types | read a layer's `ROut` / `E` / `RIn` |

`Layer.scoped`, `scopedDiscard`, `scopedContext`, `discard`, `Layer.fail` and `Layer.setConfigProvider`
do not exist in v4. Fail a build with `Layer.effectDiscard(Effect.fail(e))`; set config with
`ConfigProvider.layer(provider)`.

**Naming convention (official).**

| Static | Meaning |
|---|---|
| `layer` | the default, self-wired layer. Usually `R = never`; that's what apps use |
| `layerNoDeps` | the recipe with requirements still open — what tests wire over fakes |
| `layerTest` | in-memory/fake implementation that honors the contract |
| `layerConfig` | reads its options from `Config` (`PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })`) |
| `layer<Variant>` | other variants (`layerMemory`, `layerRemote`, `layerUndici`) |

**Recipe vs wired.** The recipe (`layerNoDeps`) is written against keys only. The wired `layer`
provides concrete deps right next to it — safe because deps are module-level constants and the
MemoMap shares them across every service that provides the same `SqlLive`. Tests provide
fakes to the recipe; the app provides nothing and takes `layer`.

```ts
import { Context, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"
import { SqliteClient } from "@effect/sql-sqlite-node"

export const SqlLive = SqliteClient.layer({ filename: "app.db" })

export interface User { readonly id: string; readonly name: string }

export class UserRepo extends Context.Service<UserRepo, {
  findById(id: string): Effect.Effect<Option.Option<User>>
}>()("@app/users/UserRepo") {
  static readonly layerNoDeps = Layer.effect(
    this,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      return UserRepo.of({
        findById: (id) =>
          sql<User>`SELECT id, name FROM users WHERE id = ${id}`.pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0])),
            Effect.orDie
          )
      })
    })
  )
  static readonly layer = this.layerNoDeps.pipe(Layer.provide(SqlLive))

  static readonly layerTest = Layer.sync(this, () => {
    const rows = new Map<string, User>([["u1", { id: "u1", name: "Ada" }]])
    return UserRepo.of({ findById: (id) => Effect.sync(() => Option.fromNullishOr(rows.get(id))) })
  })
}
```

**The composition root** is the one file per app that merges the top-level layers and hands the
result to `Layer.launch` or `ManagedRuntime.make`. Read its type: `Layer.Services<typeof App>` must
be `never`, and `Layer.Error<typeof App>` is every way boot can fail.

**When `provideMerge` is right:** the consumer *and* something above it both need the dependency —
e.g. `layerWithSqlClient` that exports both the repo and the `SqlClient` so a migrator above can use
it; installing a Logger/Tracer that both a layer and the program use. Not as a "make it compile"
tool: if `RIn` won't reach `never`, find the missing provider; reaching for `provideMerge`/`mergeAll`
until the error disappears leaks infrastructure into the app's output type and hides which layer
actually needed what. Likewise `mergeAll` is for *independent* siblings — two layers where one needs
the other must be `provide`d, not merged.

---

## 4. Construction-time vs per-call dependencies

A `yield*` in the layer's constructor resolves **once, at build**, and the method closes over that
value. A `yield*` inside a method resolves **per call**, from the caller's Context, and shows up in
the method's `R`.

| Dependency | Resolve | Method `R` |
|---|---|---|
| Process singletons: config, `HttpClient`, `SqlClient`, other services | in the constructor | `never` |
| Caller-varying context: `CurrentUser`, tenant, request id, a tx-scoped client | inside the method, deliberately | keeps the key |
| A value a caller should override with `Effect.provideService` | inside the method | keeps the key |
| Infra deps (`SqlClient`, `HttpClient`) leaking into every method's `R` | — smell: move to constructor | — |

Consequences to remember:

- A caller's `Effect.provideService(Clock-or-anything, …)` **does not affect** a dependency the
  service captured at build. Per-call provides around a construction-time dep are decorative.
- Capturing a per-request value at build is a correctness bug: every caller shares whatever the
  first build saw.

```ts
import { Context, Effect, Layer } from "effect"

export class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()("@app/auth/CurrentUser") {}
export class Clock2 extends Context.Service<Clock2, { readonly now: Effect.Effect<number> }>()("@app/Clock2") {}

export class Audit extends Context.Service<Audit, {
  // CurrentUser in R on purpose: the caller (an auth middleware) decides who.
  record(action: string): Effect.Effect<string, never, CurrentUser>
}>()("@app/Audit") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function*() {
      const clock = yield* Clock2 // construction-time: captured once
      return Audit.of({
        record: Effect.fn("Audit.record")(function*(action: string) {
          const user = yield* CurrentUser // per-call
          return `${yield* clock.now} ${user.id} ${action}`
        })
      })
    })
  ).pipe(Layer.provide(Layer.succeed(Clock2, { now: Effect.succeed(0) })))
}
```

Make a missing per-request provider a compile error by providing it from `HttpApiMiddleware` /
`RpcMiddleware` with `provides: CurrentUser` (see `references/platform.md`).

---

## 5. Memoization traps

Memoization is by reference, so anything that *creates* a layer value per call creates a new
resource per call.

```ts nocheck
// Two pools: each call returns a new Layer object.
const Postgres = { layer: (url: string) => PgClient.layer({ url }) }
const A = ServiceA.layerNoDeps.pipe(Layer.provide(Postgres.layer(url)))
const B = ServiceB.layerNoDeps.pipe(Layer.provide(Postgres.layer(url)))   // second pool

// Same bug, hidden: a static getter or a parameterized static.
class Metrics extends Context.Service<Metrics, MetricsShape>()("@app/Metrics") {
  static get layer() { return Layer.effect(this, make) }                  // new layer per access
  static readonly layerWith = (opts: Opts) => Layer.effect(this, make(opts))
}
// → PubSub subscribers see half the events, counters split in two, rate limits doubled.

// Per-request rebuild: no enclosing build holds this layer, so it is built and
// released on every request.
app.get("/x", () => runtime.runPromise(handler.pipe(Effect.provide(ExpensiveClient.layer))))
```

Fixes:

- Bind every layer — including a parameterized one — to a module `const` once, and reuse that value.
- Provide at entry points only: one `Effect.provide(AppLayer)` / one `ManagedRuntime` per process.
  `@effect/language-service` / tsgo flag this as `multipleEffectProvide` (chained provides) and
  `strictEffectProvide` (provide with layers outside entry points). Deliberate exceptions: a small
  scoped layer chosen per call (`LayerMap` lookups, a per-request AI model layer).
- Several `ManagedRuntime`s in one process share `{ memoMap: Layer.makeMemoMapUnsafe() }` (§1).
- Want per-run isolation (tests, a fresh in-memory store)? Say so: `Layer.fresh(layer)`.
- The recipe is memoized regardless of what it was provided with. Under an outer
  `provide(Svc.layerNoDeps.pipe(Layer.provide(RealDb)))`, an inner
  `provide(Svc.layerNoDeps.pipe(Layer.provide(FaultyDb)))` gets the **real** one (probe-verified).
  Swap variants at the root, or `Layer.fresh` the inner one.
- Never mutate `process.env` / module flags after layers build — the MemoMap already captured the
  values. Make runtime-varying flags a service or a `Context.Reference`.

---

## 6. Long-lived work in layers

Layer acquisition must **complete** — a constructor that loops forever blocks the whole app boot.
Fork long-lived work into the layer's scope; it is interrupted when the scope closes
(`Layer.launch` interrupted, `runtime.dispose()`).

```ts
import { Context, Effect, FiberSet, Layer, Schedule } from "effect"

// A background loop with no service surface.
export const Heartbeat = Layer.effectDiscard(
  Effect.logInfo("beat").pipe(Effect.repeat(Schedule.spaced("30 seconds")), Effect.forkScoped)
)

// A service whose methods start background work that must live as long as the layer.
export class Jobs extends Context.Service<Jobs, {
  submit(name: string): Effect.Effect<void>
}>()("@app/Jobs") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function*() {
      const fibers = yield* FiberSet.make() // closed with the layer → all jobs interrupted
      return Jobs.of({
        submit: (name) => FiberSet.run(fibers, Effect.logInfo(`running ${name}`)).pipe(Effect.asVoid)
      })
    })
  )
}
```

- No public `start()` / `stop()` methods: starting is building the layer, stopping is closing its
  scope. A `start` method means a caller can forget it, call it twice, or call it outside the scope.
- `forkScoped` failures are not surfaced to anyone: log, retry, or supervise inside the loop
  (`Effect.retry(Schedule…)`, `Effect.catchCause(Effect.logError)`).
- Never acquire per-request resources in a layer constructor; they're released only at shutdown.
- Methods that must fork into the layer lifetime capture `yield* Scope.Scope` in the constructor and
  use `Effect.forkIn(scope)`, or use a `FiberSet`/`FiberMap` as above (`FiberMap` for keyed,
  replace-on-rerun jobs).

---

## 7. Entry points: running at the edge

Run in exactly one place per process. Everything else stays a description.

**Apps.** The whole program is a layer; launch it under the platform runner (signals, exit codes,
error reporting, keep-alive): `Layer.launch(App).pipe(NodeRuntime.runMain)` — full example in
[Wire an app](#wire-an-app-http-server--sql--config). A one-shot script is
`program.pipe(Effect.provide(AppLayer), NodeRuntime.runMain)`.

- `NodeRuntime.runMain(effect, { disableErrorReporting?, teardown? })` (also data-last
  `runMain(options)(effect)`); `BunRuntime.runMain` from `@effect/platform-bun` is identical. On
  SIGINT/SIGTERM it interrupts the main fiber, which closes every layer scope (finalizers run), then
  exits.
- Exit codes: `Runtime.defaultTeardown` exits 0 on success, 130 when only interrupted, 1 on other
  failures; attach
  `readonly [Runtime.errorExitCode] = 2` to an error class to choose a code, and
  `readonly [Runtime.errorReported] = false` to suppress the default log for errors you already
  reported.
- Use `runMain`, not a bare `Effect.runFork`, for processes: a fiber suspended on `Deferred.await`
  under bare `runFork` does not keep Node alive (probe-verified).

**Foreign frameworks (Hono, Express, Next, Fastify).** One `ManagedRuntime` per process; warm it
before listening (it builds lazily, so the first request would pay boot and boot errors would surface
as a 500); pass the request's `AbortSignal` so client disconnects interrupt; dispose on shutdown.

```ts
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { createServer } from "node:http"

class Todos extends Context.Service<Todos, { readonly count: Effect.Effect<number> }>()("@app/Todos") {
  static readonly layer = Layer.succeed(this, Todos.of({ count: Effect.succeed(3) }))
}

const runtime = ManagedRuntime.make(Todos.layer)

const server = createServer((req, res) => {
  const ac = new AbortController()
  req.on("close", () => ac.abort())
  runtime
    .runPromise(Effect.flatMap(Todos, (t) => t.count), { signal: ac.signal })
    .then((n) => res.end(String(n)), () => { res.statusCode = 500; res.end() })
})

await runtime.runPromise(Effect.void) // warm-up: build the graph, fail fast
server.listen(3000)

const shutdown = () => server.close(() => void runtime.dispose())
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
```

- `runtime.runPromise`, `runPromiseExit`, `runFork`, `runSync`, `runSyncExit`, `runCallback` all
  exist; `dispose()` / `disposeEffect` / `await using` (`Symbol.asyncDispose`). Disposal interrupts
  running fibers, then releases layers.
- Next.js / Vite HMR: keep the runtime on `globalThis` so reloads don't build a second graph.
- A save that must survive client disconnect runs **without** the signal.
- Inside Effect code that has to hand a callback to a foreign API, use `Effect.context<R>()` +
  `Effect.runPromiseWith(ctx)` / `runForkWith(ctx)` (§1): it keeps the tracer, logger, config
  provider, and services. A bare `Effect.runPromise` there silently drops all of them — every
  `Effect.fn` span vanishes.
- `Effect.runFork(eff, { signal, scheduler, uninterruptible, onFiberStart })` — the `RunOptions`
  accepted by every runner.
- **Bare `run*` in library code is a smell.** Libraries return Effects; the app decides when to run.
  Grep for `run(Promise|Fork|Sync)` outside entry files during review.
- CLIs that care about cold start can import deep modules (`effect/Effect`) instead of the barrel.

---

## 8. Application structure

**Contract-first file template.** Every service module reads the same way, so any file is
walkable cold:

```ts
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

// ── CONTRACT ── the shape, its data, its errors, the key
export class Quote extends Schema.Class<Quote>("@app/quotes/Quote")({
  symbol: Schema.String,
  price: Schema.Number
}) {}
export class QuoteUnavailable extends Schema.TaggedError<QuoteUnavailable>()("QuoteUnavailable", {
  symbol: Schema.String
}) {}
export interface QuotesShape {
  latest(symbol: string): Effect.Effect<Quote, QuoteUnavailable>
}
export class Quotes extends Context.Service<Quotes, QuotesShape>()("@app/quotes/Quotes") {
  // ── PROVISION ── Effect.suspend defers `make` (declared below) past the TDZ — §2
  static readonly layerNoDeps = Layer.effect(this, Effect.suspend(() => make))
}

// ── POLICY ── numbers with their math
const TIMEOUT = "2 seconds" // upstream p99 is 400ms; 5x headroom before we call it down

// ── HELPERS ── pure, speak domain types, testable without a runtime
const quoteUrl = (symbol: string) => `https://quotes.example/${encodeURIComponent(symbol)}`

// ── FACTORY ── construction-time deps yielded once
const make = Effect.gen(function*() {
  const http = yield* HttpClient.HttpClient
  const latest = Effect.fn("Quotes.latest")(
    function*(symbol: string) {
      const res = yield* http.get(quoteUrl(symbol))
      return yield* HttpClientResponse.schemaBodyJson(Quote)(res)
    },
    // trailing combinators receive (effect, ...args)
    (effect, symbol) => effect.pipe(Effect.timeout(TIMEOUT), Effect.mapError(() => new QuoteUnavailable({ symbol })))
  )
  return Quotes.of({ latest })
})
```

**Module-per-concept over kind-based folders.** `users/` holds the Users schema, errors, service,
layer, and HTTP group; not `services/`, `models/`, `errors/` spread across the tree. Barrels only
re-export (`export * as Users from "./users/Users.js"` is fine); never `export namespace`.

**Pure core, effectful edge.** Domain rules are plain functions next to their types and are
unit-testable without a runtime. A service's job is authority — I/O, credentials, time, randomness,
lifecycle, shared policy. No algorithm sealed in a Layer closure where only the service can reach it.
Deletion test: a service whose methods only call pure functions is ceremony — make it a module.

**Ports vs adapters.** A port is a key + shape that ships *without* a layer in the domain package
(`PaymentGateway`). Adapters are layers in the infra/app package (`PaymentGateway.layerStripe`,
`layerTest`). The domain never imports an adapter.

**Libraries require platform contracts; apps provide them.** Library code takes `FileSystem`,
`Path`, `ChildProcessSpawner`, `HttpClient`, `Terminal` from `R` and never imports
`@effect/platform-*` or `node:*`. The app provides `NodeServices.layer` (or `BunServices.layer`)
once at the root:

```ts
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, FileSystem, Path } from "effect"

// library: portable, testable against an in-memory FileSystem
export const writeReport = Effect.fn("writeReport")(function*(dir: string, body: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(dir, { recursive: true })
  yield* fs.writeFileString(path.join(dir, "report.txt"), body)
})

// app: the only place that knows it runs on Node
writeReport("out", "ok").pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
```

**Options-object methods.** `search({ query, limit, cursor })` beats `search(query, limit, cursor)`:
adding a field doesn't break callers, names document intent, and `Schema.Struct` can decode it.

**Contract-inventory gate.** Before designing a service, grep `effect` for an existing contract:
`KeyValueStore`, `Persistence`, `RateLimiter`, `PersistedCache`, `PersistedQueue`, `Cache`, `Pool`,
`RcMap`, `LayerMap`, `HttpClient`, `SqlClient`, `FileSystem`, `ChildProcessSpawner`, `Clock`,
`Random`, `Crypto` (`references/primitives.md`, `references/modules.md`). A home-grown `Storage`
service duplicating `KeyValueStore` loses every adapter Effect already ships.

---

## 9. Production practices, worked

### Decode at the boundary, element by element
One malformed row should drop and log, not blank the whole result:

```ts
import { Array, Effect, Schema } from "effect"

const Row = Schema.Struct({ id: Schema.String, amount: Schema.Number })

export const decodeRows = Effect.fn("decodeRows")(function*(raw: ReadonlyArray<unknown>) {
  const decoded = yield* Effect.forEach(raw, (r) => Effect.result(Schema.decodeUnknownEffect(Row)(r)))
  const [rows, bad] = Array.partition(decoded, (r) => r)
  if (bad.length > 0) yield* Effect.logWarning(`dropped ${bad.length} malformed rows`, bad[0])
  return rows
})
```

`Array.partition` takes a `Result`-returning function and returns `[successes, failures]`.
At the same edge, map foreign errors into your domain family so nothing inside sees `HttpClientError`
or `SqlError`.

### Govern cross-cutting concerns at the DI seam
Wrap the shared resource's layer, so every consumer is rate-limited, retried, and status-checked by
construction — a new feature that pulls `HttpClient` from DI cannot route around it.
`HttpClient.withRateLimiter` takes a `RateLimiter`, which needs a `RateLimiterStore`:

```ts
import { Effect, Layer, Schedule } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { RateLimiter } from "effect/persistence"

export const GovernedHttp = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function*() {
    const base = yield* HttpClient.HttpClient
    const limiter = yield* RateLimiter.RateLimiter
    return base.pipe(
      HttpClient.withRateLimiter({ limiter, key: "upstream", limit: 100, window: "1 minute", times: 3 }),
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ schedule: Schedule.exponential("200 millis"), times: 3 }),
      // the HttpClient key's E is HttpClientError: a limiter-store failure is a defect here
      HttpClient.catchTag("RateLimiterError", Effect.die)
    )
  })
).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(RateLimiter.layer),
  Layer.provide(RateLimiter.layerStoreMemory) // or layerStoreRedis for a cross-process budget
)
```

Order matters: later transforms wrap earlier ones. Retry outermost, so every attempt re-enters the
limiter; `filterStatusOk` below it so 5xx/429 become errors the retry can see. `withRateLimiter`
reads `Retry-After`/rate-limit headers and retries 429s itself (unbounded unless `times`). For a
concurrency cap rather than a rate, wrap with `HttpClient.transform(base, (eff) =>
sem.withPermits(1)(eff))`.

### Upstream adapter recipe
A service over an external API: the layer requires `HttpClient`; a `layer` picks the transport;
reads retry, writes don't; every call has a timeout; transport errors become domain errors by
inspecting `HttpClientError.reason`.

```ts
import { Context, Effect, flow, Layer, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http"

class Repo extends Schema.Class<Repo>("@app/gh/Repo")({ full_name: Schema.String, stargazers_count: Schema.Number }) {}

export class GitHubError extends Schema.TaggedError<GitHubError>()("GitHubError", {
  kind: Schema.Literals(["NotFound", "RateLimited", "Unavailable", "BadResponse"]),
  cause: Schema.Defect()
}) {}

const toGitHubError = (cause: unknown): GitHubError => {
  if (HttpClientError.isHttpClientError(cause)) {
    const r = cause.reason
    if (r._tag === "StatusCodeError") {
      const kind = r.response.status === 404 ? "NotFound" : r.response.status === 429 ? "RateLimited" : "Unavailable"
      return new GitHubError({ kind, cause })
    }
    if (r._tag === "DecodeError" || r._tag === "EmptyBodyError") return new GitHubError({ kind: "BadResponse", cause })
  }
  return new GitHubError({ kind: "Unavailable", cause })
}

export class GitHub extends Context.Service<GitHub, {
  repo(name: string): Effect.Effect<Repo, GitHubError>
  openIssue(options: { readonly repo: string; readonly title: string }): Effect.Effect<void, GitHubError>
}>()("@app/gh/GitHub") {
  static readonly layerNoDeps = Layer.effect(
    this,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(flow(HttpClientRequest.prependUrl("https://api.github.com"), HttpClientRequest.acceptJson)),
        HttpClient.filterStatusOk
      )
      const reads = client.pipe(HttpClient.retryTransient({ schedule: Schedule.exponential("100 millis"), times: 3 }))

      return GitHub.of({
        repo: (name) =>
          reads.get(`/repos/${name}`).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Repo)),
            Effect.timeout("5 seconds"),
            Effect.mapError(toGitHubError),
            Effect.withSpan("GitHub.repo")
          ),
        // POST is not idempotent: a blind retry could open two issues, so use `client`, not `reads`
        openIssue: ({ repo, title }) =>
          HttpClientRequest.post(`/repos/${repo}/issues`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ title }),
            client.execute,
            Effect.timeout("5 seconds"),
            Effect.asVoid,
            Effect.mapError(toGitHubError),
            Effect.withSpan("GitHub.openIssue")
          )
      })
    })
  )
  static readonly layer = this.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer))
}
```

`retryTransient` retries `TransportError`, timeouts, and 408/429/500/502/503/504 — it does not look
at the method, so idempotency is your call: build a separate retrying client for reads. On Node,
swap the transport with `NodeHttpClient.layerUndici` in `layer`; the recipe doesn't change. Prefer
`HttpClientError.reason._tag` over string matching — `HttpClientError` is a single tag whose
`reason` is `TransportError | EncodeError | InvalidUrlError | StatusCodeError | DecodeError |
EmptyBodyError`.

### The run/edge adapter
Where a host expects promises or its own error type, run once and map `Exit` to the host's error,
keeping the tag and fields as data:

```ts
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from "effect"

class HostError extends Error {
  constructor(readonly code: string, readonly data: unknown) { super(code) }
}

const toHostError = (cause: Cause.Cause<unknown>): HostError =>
  Option.match(Cause.findErrorOption(cause), {
    onSome: (e) => new HostError((e as { readonly _tag?: string })._tag ?? "Failure", e),
    onNone: () => new HostError(Cause.hasInterrupts(cause) ? "Interrupted" : "Defect", Cause.pretty(cause))
  })

const runtime = ManagedRuntime.make(Layer.empty)

export const run = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  throw toHostError(exit.cause)
}
```

Enter foreign code the other way with `Effect.tryPromise({ try, catch })` / `Effect.promise`.

### ConfigProvider-driven layers
Pick the implementation from config at build time with `Layer.unwrap`; swap the provider for tests
with `ConfigProvider.layer`:

```ts
import { Config, ConfigProvider, Context, Effect, Layer } from "effect"

export class Store extends Context.Service<Store, { readonly kind: string }>()("@app/Store") {
  static readonly layerMemory = Layer.succeed(this, { kind: "memory" })
  static readonly layerRemote = (url: URL) => Layer.succeed(Store, { kind: `remote:${url.host}` })
  static readonly layer = Layer.unwrap(
    Effect.gen(function*() {
      if (yield* Config.Boolean("STORE_IN_MEMORY").pipe(Config.withDefault(false))) return Store.layerMemory
      return Store.layerRemote(yield* Config.URL("STORE_URL"))
    })
  )
}

export const StoreForTests = Store.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ STORE_IN_MEMORY: "true" })))
)
```

`Layer.unwrap` here is safe from §5's trap: the factory runs once, inside one memoized build.

### Determinism
Take time and randomness from services — `Clock.currentTimeMillis`, `DateTime.now`, `Random.next`,
`Random.nextIntBetween` — never `Date.now()` / `Math.random()` / `new Date()`. They're
`Context.Reference`s, so production needs no wiring, and `it.effect` swaps in `TestClock`: a retry
schedule, a `timeout`, or a cron loop runs in virtual time with `TestClock.adjust`, instantly and
without flake. Same seam powers replay/simulation. Details in `references/testing.md`.

---

## 10. Recipes

### Add a service (or repository)
1. Inventory first: grep `effect` for an existing contract (§8).
2. Follow the §8 template: exported shape (Effect/Stream methods, options objects, typed `E`) →
   package-qualified key → policy/helpers → factory yielding construction-time deps once, methods via
   `Effect.fn("X.method")` (`Effect.fnUntraced` for hot library internals) → `layerNoDeps`, wired
   `layer` over module-const deps, `layerTest` if a fake honors the contract.
3. Wire into the composition root; test over `layerNoDeps` + fakes.

### Add a Schema type
`Schema.Struct` + `typeof X.Type` for plain data; `Schema.Class` when it needs methods/identity;
`Schema.Literals([...])` for enums; brands via `Schema.brand("UserId")` (one id per call). The schema
is the single source of truth — no parallel TS interface. Separate identity (cold params) from
moving state (warm) if it's an entity. See `references/schema.md`.

### Add a typed error
`class XError extends Schema.TaggedError<XError>()("XError", { … }) {}` (crosses a wire/journal) or
`Data.TaggedError` (in-process only). Add it to `E` of the methods that raise it; raise with
`return yield* new XError({…})`. Several failure modes of one operation → one error with a `reason`
union, handled with `Effect.catchReason`. At the edge, map `_tag` → host code. See
`references/errors.md`.

### Add a streaming procedure
Return `Stream` directly from the method; the subscription starts when the consumer runs it, and the
stream's scope ends with the consumer:

```ts
import { Context, Effect, Layer, PubSub, Stream } from "effect"

export class Ticks extends Context.Service<Ticks, {
  publish(n: number): Effect.Effect<void>
  readonly changes: Stream.Stream<number>
}>()("@app/Ticks") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function*() {
      const hub = yield* PubSub.unbounded<number>()
      return Ticks.of({
        publish: (n) => PubSub.publish(hub, n).pipe(Effect.asVoid),
        changes: Stream.fromPubSub(hub)
      })
    })
  )
}
```

At the edge: `HttpServerResponse.stream(…)`, an RPC with `stream: true`, or
`Stream.toReadableStream` — a client disconnect interrupts the consumer and finalizes the
subscription. For "current value + updates", back it with `SubscriptionRef` and expose
`SubscriptionRef.changes(ref)` (replays the current value first).

### Wire an app (HTTP server + SQL + config)

```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { PgClient } from "@effect/sql-pg"
import { Config, Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { createServer } from "node:http"

// infra: module-level consts (memoized by reference)
const SqlLive = PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })
const ServerLive = NodeHttpServer.layerConfig(createServer, { port: Config.Port("PORT").pipe(Config.withDefault(3000)) })

// domain service: recipe + wired
class Stats extends Context.Service<Stats, { readonly userCount: Effect.Effect<number> }>()("@app/Stats") {
  static readonly layerNoDeps = Layer.effect(
    this,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      return Stats.of({
        userCount: sql<{ n: number }>`SELECT count(*)::int AS n FROM users`.pipe(
          Effect.map((rows) => rows[0]?.n ?? 0),
          Effect.orDie
        )
      })
    })
  )
  static readonly layer = this.layerNoDeps.pipe(Layer.provide(SqlLive))
}

// routes: services yielded at build, closed over by handlers
const Routes = HttpRouter.use(Effect.fn(function*(router) {
  const stats = yield* Stats
  yield* router.add("GET", "/stats", stats.userCount.pipe(Effect.map((n) => HttpServerResponse.jsonUnsafe({ n }))))
}))

// composition root
const App = HttpRouter.serve(Routes).pipe(Layer.provide([Stats.layer, ServerLive]))

Layer.launch(App).pipe(NodeRuntime.runMain)
```

For a typed API surface use `HttpApi` + `HttpApiBuilder.layer` instead of raw routes
(`references/platform.md`).

### Swap live / test
Run the real service over fakes; never mock the service under test.

```ts
import { assert, it } from "@effect/vitest"
import { Context, Effect, Layer, Option } from "effect"

interface User { readonly id: string; readonly name: string }
class UserRepo extends Context.Service<UserRepo, {
  findById(id: string): Effect.Effect<Option.Option<User>>
}>()("@app/UserRepo") {}

class Greetings extends Context.Service<Greetings, { greet(id: string): Effect.Effect<string> }>()("@app/Greetings") {
  static readonly layerNoDeps = Layer.effect(
    this,
    Effect.gen(function*() {
      const repo = yield* UserRepo
      return Greetings.of({
        greet: (id) => repo.findById(id).pipe(Effect.map(Option.match({ onNone: () => "who?", onSome: (u) => `hi ${u.name}` })))
      })
    })
  )
}

const RepoFake = Layer.mock(UserRepo, { findById: (id) => Effect.succeed(Option.some({ id, name: "Ada" })) })
const GreetingsTest = Greetings.layerNoDeps.pipe(Layer.provide(RepoFake))

it.effect("greets a known user", () =>
  Effect.gen(function*() {
    const g = yield* Greetings
    assert.strictEqual(yield* g.greet("u1"), "hi Ada")
  }).pipe(Effect.provide(GreetingsTest)))
```

`Layer.mock` fails loudly (an "unimplemented" defect) if the service touches a member you didn't
stub; `Layer.succeed(X, X.of({...}))` when you want the compiler to demand every member. Share an
expensive layer across a suite with `layer(L)("suite", (it) => …)` from `@effect/vitest`
(`references/testing.md`).
