# Effect v4 — architecture & DI mechanism

Worked detail behind SKILL.md §4–6. Read a section when you're implementing that pattern or need
exactly how resolution works. Code is illustrative and v4-shaped — verify exact symbols against the
installed `effect` source.

## Contents
- [How DI actually resolves](#how-di-actually-resolves) — Context, Layer, MemoMap, the runtime
- [Production practices, worked](#production-practices-worked) — boundary decode · DI-seam governance · the run/edge adapter · a TestClock test
- [Recipes](#recipes) — add a service · a Schema type · a streaming procedure · a typed error

---

## How DI actually resolves

**The environment is a typed map.** A `Context` (ServiceMap) maps a tag → its implementation.
`yield* Tag` is a lookup against the current fiber's Context. The `R` of `Effect<A, E, R>` is the
set of tags still unsatisfied; the compiler tracks it and won't let you run until `R` is `never`.

**A Layer builds part of the map.** `Layer<ROut, E, RIn>` provides `ROut`, may fail `E` while
building, and requires `RIn` first.

```ts
// the recipe: how to build EventLog, given a SqlClient
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient      // ← yielding a dep puts it in RIn
  return EventLog.of({ append: /* … */, recent: /* … */ })
})
export const EventLogLayer: Layer.Layer<EventLog, SqlError, SqlClient.SqlClient> =
  Layer.effect(EventLog, make)
```

`RIn` is the union of everything `make` does `yield*` on — you never hand-maintain a dependency
list. Compose up the graph and `RIn` shrinks at each `Layer.provide`; when the top layer needs
nothing, `RIn = never` and the graph is complete.

**Build once (memoization).** Layer builds are memoized by identity; in v4 the `MemoMap` is shared
across `Effect.provide` calls, so a shared dependency (one `SqlClient`, one budget-walled
`HttpClient`) is constructed a single time and shared. `Layer.fresh(layer)` /
`Effect.provide(layer, { local: true })` force an isolated rebuild (test isolation, independent
pools).

**The runtime supplies the map.** `Runtime<R>` was removed in v4 — you carry a `Context<R>` and run
functions live on `Effect`. For an app-level host, `ManagedRuntime.make(AppLayer)`:
1. builds the whole graph once (every `make`, in dependency order, memoized) → one `Context`;
2. holds a `Scope`, so every `forkScoped` daemon starts here and stops when the runtime is disposed;
3. supplies that `Context` to each effect it runs (`runtime.runPromiseExit(effect)`), satisfying the
   effect's `R`.

So at request time, `yield* Users` resolves by looking up the implementation built at boot. Nothing
imports a concrete service — the handler names a tag, the runtime supplies a map.

**The swap is the architecture.** Because `make` is written against tags, swapping live↔replay or
real-DB↔in-memory is one provided-layer change with zero edits to the service. The test runs the real
service over fakes:

```ts
const UsersTest = UsersLayer.pipe(
  Layer.provide(Layer.succeed(UserSource, UserSource.of({ list: () => Effect.succeed([]) /* … */ }))),
  Layer.provide(Persistence.layerMemory),
)
const users = await Effect.runPromise(
  Effect.gen(function* () { return yield* (yield* Users).list() }).pipe(Effect.provide(UsersTest), Effect.scoped),
)
```

If you can't replace a dependency with a fake without editing the service, it isn't injected.

---

## Production practices, worked

Worked code for several of SKILL.md §6's principles. Illustrative and v4-shaped — verify exact
symbols against the installed `effect` source.

### Tame the outside world at the port
Decode external input at the edge, and an external array *element by element* so one bad row drops +
logs instead of blanking the whole result:

```ts
const decodeRow = Schema.decodeUnknownEffect(Row)
const decoded = yield* Effect.forEach(rawRows, raw => Effect.result(decodeRow(raw)))   // Result<Row, …>[]
const rows = decoded.filter(Result.isSuccess).map((r) => r.success)
yield* Effect.forEach(
  decoded.filter(Result.isFailure),
  (r) => Effect.logWarning(`dropped malformed row: ${r.failure}`),
  { discard: true },
)
```

At the same edge, `Effect.mapError(e => new SourceError({ cause: e }))` collapses the adapter's
foreign errors into your domain family, so nothing below the port ever sees an `HttpClientError`.

### Govern cross-cutting concerns at the DI seam
Wrap the shared resource's own layer, so every consumer is rate-limited and concurrency-capped by
construction — a new feature that pulls `HttpClient` from DI *cannot* route around it:

```ts
const GovernedHttp = Layer.effect(HttpClient.HttpClient, Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient
  const limit = yield* RateLimiter.makeWithRateLimiter
  const budget = limit({ key: "api", window: "1 minute", limit: 100, onExceeded: "delay", algorithm: "token-bucket" })
  const inflight = Semaphore.makeUnsafe(4)
  return HttpClient.transform(base, eff => inflight.withPermits(1)(budget(eff)))
})).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RateLimiter.layer))
```

A limiter that `delay`s rather than fails means degrade-don't-die. Where the upstream allows, collapse
N per-key calls into one batched query and slice the result, so the budget mostly isn't spent.

### Contain Effect at the edge
Run the runtime in exactly one place, and map a domain error to the host once. Everything else stays a
description until this seam:

```ts
// the only place the app executes the runtime
export const run = async <A, E>(effect: Effect.Effect<A, E, AppEnv>): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  throw toHostError(Option.getOrUndefined(Cause.findErrorOption(exit.cause)) ?? exit.cause)
}
```

`toHostError` maps a `_tag` → a host code and keeps the tag + fields as structured data, so the caller
still gets a *typed* error. Enter foreign code the other way with `Effect.tryPromise` / `Effect.promise`.

### Determinism → testable
The same production logic runs over swapped layers; a `TestClock` advances virtual time instead of
sleeping, so retries/timeouts/schedules resolve instantly and without flake:

```ts
const TestLive = ServiceLayer.pipe(Layer.provide(Layer.succeed(Source, fakeSource)))

it.effect("retries then succeeds, with no real waiting", () =>
  Effect.gen(function* () {
    const svc = yield* Service
    const fiber = yield* Effect.forkChild(svc.run())   // run() retries on a Schedule
    yield* TestClock.adjust("1 minute")                // jump the backoff window — instant
    yield* Fiber.join(fiber)
  }).pipe(Effect.provide(TestLive)))                   // @effect/vitest injects the TestClock
```

---

## Recipes

### Add a service (or repository)
1. **CONTRACT** — write the `XyzApi` interface (methods return `Effect<…, E>`), then the tag:
   `class Xyz extends Context.Service<Xyz, XyzApi>()("Xyz") {}`.
2. **POLICY** — module-level constants (TTLs, limits) with their math in a comment.
3. **HELPERS** — pure private functions (speak domain types; live in the domain package if shared).
4. **FACTORY** — `const make = Effect.gen(function*(){ const dep = yield* Dep; … return Xyz.of({…}) })`.
   Use `Effect.fn("Xyz.method")` for methods you want traced; `Effect.gen` for the factory itself.
5. **PROVISION** — `export const XyzLayer = Layer.effect(Xyz, make)` (the recipe, deps still open).
6. **Wire** at the composition root: `const XyzLive = XyzLayer.pipe(Layer.provide(Deps))`, merge into
   `AppLayer`. Add a test that provides stub layers for `Xyz`'s deps and asserts behavior.

### Add a Schema type
Define COLD params (identity) vs WARM state (what moves) vs the resolved view separately if it's an
entity. Use `Schema.Struct` + branded scalars; `Schema.Literals([...])` for enums; native
`Schema.BigInt` for any field validated by output-decode. Export the type with
`Schema.Schema.Type<typeof X>`. The schema is the single source of truth — don't write a parallel
TS interface.

### Add a streaming procedure
Service method returns `Effect<Stream<A, E, R>, never, R>` (an effect that *produces* a stream,
built from a `PubSub`/`SubscriptionRef`). At the boundary, hand it to `drain(make, signal)` so a
client disconnect finalizes the scope. Output schema uses native-bigint projections (decode-on-
output). Seed first paint from a normal query and merge with the accumulating stream at the edge —
don't put `initialData` on the stream (it would mark it fresh and never start).

### Add a typed error
`class XError extends Schema.TaggedErrorClass<XError>()("XError", { entity: Schema.String, /* … */ }) {}`.
Add it to the `E` channel of the methods that can raise it. Raise with `yield* new XError({…})` or
`Effect.fail(new XError({…}))`. At the boundary, map its `_tag` to a host error and keep the fields as
data. Adapters that wrap foreign calls use `Effect.tryPromise({ catch: e => new SourceError({…}) })`
to collapse everything to one tagged error — never `try/catch`.
