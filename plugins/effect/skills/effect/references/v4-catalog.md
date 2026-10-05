# Effect v4 — idiom catalog, near-twins, migration tables, behavior traps

The high-frequency lookup file. SKILL.md has the rules; this file holds the forms you type, the choice
between neighbouring primitives, the v3 → v4 and rc → 4.0.0 renames, and the semantics that surprise.
It is a map: when a name matters, confirm it in `node_modules/effect/dist/<Module>.d.ts` (each export
carries a "When to use" JSDoc section).

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

## Contents
- [1. Idioms by area](#1-idioms-by-area)
  - [The Effect type and executors](#the-effect-type-and-executors)
  - [gen / fn / fnUntraced](#gen--fn--fnuntraced)
  - [Services, layers, runtime](#services-layers-runtime)
  - [Schema quick forms](#schema-quick-forms)
  - [Errors quick forms](#errors-quick-forms)
  - [Streams, concurrency, scheduling](#streams-concurrency-scheduling)
  - [Platform built-ins and import paths](#platform-built-ins-and-import-paths)
  - [Config and ConfigProvider](#config-and-configprovider)
  - [Logger, Tracer, Metric](#logger-tracer-metric)
  - [Duration, DateTime, Redacted, Clock, Random](#duration-datetime-redacted-clock-random)
- [2. Choosing between near-twins](#2-choosing-between-near-twins)
- [3. The v3 → v4 table](#3-the-v3--v4-table)
- [4. rc/beta → 4.0.0 breaking deltas](#4-rcbeta--400-breaking-deltas)
- [5. Behavior traps (right name, surprising semantics)](#5-behavior-traps-right-name-surprising-semantics)

---

## 1. Idioms by area

### The Effect type and executors
- `Effect<A, E, R>`: **A** success, **E** typed failure, **R** required services. A description; nothing
  runs until an executor runs it. Type extractors: `Effect.Success<T>`, `Effect.Error<T>`,
  `Effect.Services<T>` (v3 `Effect.Effect.Context` is now `Services`).
- Executors: `Effect.runPromise`, `runPromiseExit`, `runSync`, `runSyncExit`, `runFork`, `runCallback`.
  With a captured `Context`: `runForkWith(ctx)(eff)`, `runPromiseWith(ctx)`, `runSyncWith(ctx)` (no
  `Runtime<R>` value any more).
- Programs: `NodeRuntime.runMain(program)` / `BunRuntime.runMain` (signals, exit code, error report,
  keep-alive). Long-running services: `Layer.launch(AppLayer).pipe(NodeRuntime.runMain)`.
- Framework edges (Hono, Next, Express): one `ManagedRuntime.make(layer, { memoMap? })` per process,
  `runtime.runPromise(eff, { signal })`, `runtime.dispose()` on shutdown.
- Inspect an `Exit`: `Exit.isSuccess(exit)`, `Exit.match`, `Cause.findErrorOption(exit.cause)` (typed `E`
  as `Option`), `Cause.hasInterrupts`, `Cause.pretty`.
- Constructors: `Effect.succeed` (eager value), `sync(() => …)` (lazy), `suspend(() => eff)`,
  `fail`, `die`, `try({ try, catch })`, `tryPromise({ try: (signal) => …, catch })`, `promise`,
  `callback((resume, signal) => …)` (v3 `async`), `fromOption`, `fromResult`, `fromNullishOr`.

### gen / fn / fnUntraced

```ts
import { Effect, Schema } from "effect"

class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  input: Schema.String
}) {}

// Reusable function: one span per call, trailing combinators apply to the produced Effect.
export const parsePort = Effect.fn("Config.parsePort")(
  function*(raw: string): Effect.fn.Return<number, ParseError> {
    const n = Number(raw)
    if (!Number.isInteger(n)) return yield* new ParseError({ input: raw })
    yield* Effect.annotateCurrentSpan("port", n)
    return n
  },
  Effect.withLogSpan("parsePort")
)

// Library/hot path: same syntax, no span.
export const double = Effect.fnUntraced(function*(n: number) {
  return n * 2
})

// One-off program.
export const program = Effect.gen(function*() {
  const port = yield* parsePort("8080")
  return yield* double(port)
})
```

- `Effect.fn.Return<A, E, R>` annotates the generator's return; the produced function's type stays inferred.
- `Effect.fn(function*(…){})` without a name is fine for handlers; name public, fallible boundaries
  `"Domain.op"`. Official guidance accepts `fnUntraced` for library internals and hot paths.
- Methods on a class: `Effect.gen({ self: this }, function*() { … })` (v3 `Effect.gen(this, …)`).
- `return yield* new MyError(...)` — the `return` makes TS narrow the branch.
- `Effect.fnUntracedEager` exists for sync-heavy hot paths (evaluates the generator eagerly while every yielded effect is synchronous).

### Services, layers, runtime

```ts
import { Context, Effect, Layer, Schema } from "effect"

class UsersError extends Schema.TaggedError<UsersError>()("UsersError", { cause: Schema.Defect() }) {}

export class Store extends Context.Service<Store, {
  readonly get: (key: string) => Effect.Effect<string | undefined>
}>()("@app/store/Store") {
  static readonly layer = Layer.sync(Store, () => {
    const map = new Map<string, string>()
    return Store.of({ get: (key) => Effect.sync(() => map.get(key)) })
  })
}

export class Users extends Context.Service<Users, {
  readonly name: (id: string) => Effect.Effect<string, UsersError>
}>()("@app/users/Users") {
  // recipe: requirements still open (tests wire this over fakes)
  static readonly layerNoDeps = Layer.effect(
    Users,
    Effect.gen(function*() {
      const store = yield* Store
      const name = Effect.fn("Users.name")(function*(id: string) {
        return (yield* store.get(id)) ?? "anonymous"
      })
      return Users.of({ name })
    })
  )
  // default: self-wired, R = never
  static readonly layer = this.layerNoDeps.pipe(Layer.provide(Store.layer))
}

export type UsersShape = Users["Service"] // or Context.Service.Shape<typeof Users>

export const FeatureFlag = Context.Reference<boolean>("@app/FeatureFlag", { defaultValue: () => false })

export const main = Effect.gen(function*() {
  const users = yield* Users
  const on = yield* FeatureFlag
  return on ? yield* users.name("1") : "off"
}).pipe(
  Effect.provideService(FeatureFlag, true),
  Effect.provide(Users.layer)
)
```

- Tag forms: `class X extends Context.Service<X, Shape>()("pkg/path/X") {}`; function form
  `Context.Service<Shape>("key")`; with constructor `Context.Service<X>()("id", { make })` (gives
  `X.make`; you still write `static layer = Layer.effect(this, this.make)`).
- Implementation value: `X.of({...})`; one-service context: `X.context(impl)`; access: `yield* X`
  (preferred) or `X.use(s => …)` / `X.useSync`.
- Layer constructors: `Layer.succeed(X, impl)`, `Layer.sync(X, () => impl)`, `Layer.effect(X, eff)`
  (scoped — `Scope` is excluded from `R`), `Layer.effectDiscard(eff)` (background work, no service),
  `Layer.effectContext` / `succeedContext` (several tags from one acquisition), `Layer.unwrap(effOfLayer)`
  (choose a layer from config), `Layer.mock(X, partial)` (tests), `Layer.empty`.
- Composition: `Layer.provide(deps)` (feed and hide; accepts an array), `Layer.provideMerge(deps)` (feed
  and re-export), `Layer.merge(a, b)` / `Layer.mergeAll(...)` (peers, built concurrently),
  `Layer.fresh(l)` (bypass memo), `Layer.updateService(l, X, f)` (decorate).
- Captured context: `Effect.context<R>()` then `Effect.runForkWith(ctx)` (v3 `Effect.runtime`).
- Background work tied to the layer: `Layer.effectDiscard(work.pipe(Effect.forkScoped))`.
- Depth: `references/architecture.md` (layer naming, composition root), `references/primitives.md`.

### Schema quick forms
Depth lives in `references/schema.md`; these are the forms you reach for most.

```ts
import { Effect, Schema } from "effect"

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const User = Schema.Struct({
  id: UserId,
  name: Schema.String.check(Schema.isMinLength(1)),
  role: Schema.Literals(["admin", "member"]),
  nick: Schema.optional(Schema.String),
  manager: Schema.NullOr(UserId)
})
export type User = typeof User.Type

export class Account extends Schema.Class<Account>("@app/Account")({
  owner: User,
  balance: Schema.Number
}) {
  get overdrawn() { return this.balance < 0 }
}

export const Shape = Schema.TaggedUnion({
  Circle: { radius: Schema.Number },
  Square: { side: Schema.Number }
})

export const decodeUser = Schema.decodeUnknownEffect(User)
export const parseUserJson = Schema.decodeUnknownEffect(Schema.fromJsonString(User))
export const program = Effect.gen(function*() {
  const user = yield* decodeUser({ id: "u1", name: "Ada", role: "admin", manager: null })
  return user.name
})
```

- Arrays not variadics: `Literals([..])`, `Union([..])`, `Tuple([..])`, `TemplateLiteral([..])`;
  `Record(key, value)`. Single literal: `Schema.Literal("a")` (one argument).
- Filters are `is*` and go through `.check(...)`: `isMinLength`, `isPattern`, `isBetweenLength`,
  `isStartingWith`, `isInt`, `isUUID()`. Custom: `.check(Schema.makeFilter(pred))`.
- Runners: `decodeUnknownEffect / Sync / Exit / Option / Result / Promise`, `encodeEffect / Sync /
  Exit`. Bare `Schema.decode` / `Schema.encode` are transformation constructors, not runners.
- Transform: `From.pipe(Schema.decodeTo(To, SchemaTransformation.transform({ decode, encode })))`.
- Extend: `Schema.Struct({ ...A.fields, more })`; Standard Schema: `Schema.toStandardSchemaV1(S)`.

### Errors quick forms
Depth in `references/errors.md`.
- Define: `class E extends Schema.TaggedError<E>()("E", { fields }, { httpApiStatus: 404 }?) {}`
  (wire/journal errors); `class E extends Schema.Error<E>("E")({ cause: Schema.Defect() }) {}` (no
  `_tag`); `class E extends Data.TaggedError("E")<{ readonly id: string }> {}` (in-process only).
- Raise: `return yield* new E({...})`, or `Effect.fail(new E({...}))`.
- Recover: `Effect.catchTag("A", h)`, `catchTag(["A", "B"], h)`, `catchTags({ A: h, B: h })`,
  `catch(h)` (all typed errors; v3 `catchAll`), `catchFilter(filter, h)` (v3 `catchSome`),
  `catchCause(h)` (includes defects and interrupts), `catchDefect(h)`.
- Reason pattern: `catchReason("Parent", "Reason", h, orElse?)`, `catchReasons("Parent", {...})`,
  `unwrapReason("Parent")` lifts `error.reason` into `E`.
- Observe: `tap*` family — `tapError`, `tapErrorTag`, `tapCause` (v3 `tapErrorCause`), `tapDefect`.
- Convert: `Effect.result` (→ `Result<A, E>`; v3 `either`), `Effect.exit`, `Effect.option`,
  `Effect.orDie`, `Effect.mapError`, `Effect.orElseSucceed((e) => fallback)`.

### Streams, concurrency, scheduling
Depth in `references/concurrency.md`.

```ts
import { Effect, Schedule, Stream } from "effect"

declare const fetchPage: (n: number) => Effect.Effect<ReadonlyArray<string>, Error>

// Bounded parallel map, results in input order.
export const pages = Effect.forEach([1, 2, 3], fetchPage, { concurrency: 4 })

// Exponential backoff whose delay is capped at 10s (min = fastest), jittered, at most 6 retries (max = AND).
export const retryPolicy = Schedule.max([
  Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("10 seconds")]).pipe(Schedule.jittered),
  Schedule.recurs(6)
])

export const robust = fetchPage(1).pipe(
  Effect.retry(retryPolicy),
  Effect.timeout("30 seconds")
)

export const ticks = Stream.fromSchedule(Schedule.spaced("1 second")).pipe(
  Stream.mapEffect((n) => Effect.succeed(n * 2), { concurrency: 2 }),
  Stream.take(5),
  Stream.runCollect
)
```

- Concurrency options: `forEach` / `all` / `validate` / `partition` / `Stream.mapEffect` take
  `{ concurrency: n | "unbounded" }`; `zip` / `zipWith` take `{ concurrent: true }`. `forEach` adds
  `{ discard: true }`.
- Schedules: `spaced`, `fixed`, `exponential(base, factor?)`, `fibonacci`, `recurs(n)`, `once`, `cron`,
  `windowed`, `during`, `forever`; combine with `max([..])` (AND, slowest delay), `min([..])` (OR,
  fastest delay), `concat` (sequence), `upTo({ times, duration })` (limit), `while(meta => …)`,
  `jittered`, `modifyDelay`, `addDelay`, `tap`, `setInputType<E>()`.
- Retry/repeat: `Effect.retry(schedule)` or `retry({ times, schedule, while, until })`; builder form
  `retry(($) => $(Schedule.spaced("1 second")).pipe(Schedule.while(({ input }) => input.retryable)))`
  infers the error type. `Effect.repeat` mirrors it for successes.
- Fibers: `forkChild` (dies with parent), `forkScoped` (dies with the scope), `forkIn(scope)`,
  `forkDetach` (global). Options `{ startImmediately, uninterruptible }`. Supervise groups with
  `FiberSet` / `FiberMap` / `FiberHandle`.
- Streams: `Stream.callback((queue) => …, { bufferSize })` (v3 `async*`), `fromQueue`, `fromPubSub`,
  `fromIterable`, `fromAsyncIterable`, `paginate`, `fromEffectRepeat` (v3 `repeatEffect`),
  `Stream.share({ capacity })`, `Stream.toAsyncIterableEffect`, `runCollect`, `runForEach`, `runDrain`.
- State/coordination: `Ref`, `SynchronizedRef`, `SubscriptionRef`, `Deferred`, `Latch`, `Semaphore`,
  `Queue<A, E>`, `PubSub`, `Effect.tx` + `Tx*`.
- Resources: `Effect.acquireRelease(acq, rel)`, `acquireUseRelease`, `addFinalizer`, `ensuring`,
  `Effect.scoped`, `scopedWith`, `Pool.use`, `RcRef`, `RcMap`, `ScopedRef`.

### Platform built-ins and import paths
Never hand-roll these. Everything below ships inside `effect@4.0.0`; there is no `effect/unstable/*`
path any more. Modules outside the root barrel are `@stability unstable` (may break in minors).

| Need | Import | Entry points |
|---|---|---|
| Files, paths | `import { FileSystem, Path } from "effect"` | `FileSystem.FileSystem`, `Path.Path`; provide `NodeServices.layer` |
| Child processes | `effect/process` | `ChildProcess.make(...)`, `ChildProcessSpawner` (v3 `Command`/`CommandExecutor`) |
| HTTP client | `effect/http` | `HttpClient`, `HttpClientRequest`, `HttpClientResponse`, `FetchHttpClient.layer`; Node `NodeHttpClient.layerUndici` |
| HTTP server/router | `effect/http` | `HttpRouter`, `HttpServerResponse`; `NodeHttpServer.layer(createServer, { port })` |
| Declarative API | `effect/http-api` (hyphen) | `HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, `HttpApiClient` |
| RPC | `effect/rpc` | `Rpc`, `RpcGroup`, `RpcServer`, `RpcClient` |
| SQL | `effect/sql` + `@effect/sql-pg` / `@effect/sql-sqlite-node` | `SqlClient.SqlClient`, `SqlSchema`, `SqlResolver` |
| KV, persistence, rate limit | `effect/persistence` | `KeyValueStore`, `Persistence`, `PersistedCache`, `PersistedQueue`, `RateLimiter` (+ `layerStoreMemory`) |
| Encodings | `effect/encoding` | `Base64`, `Base64Url`, `Hex`, `Ndjson`, `Sse`, `Yaml`, `Toml`, `SchemaBinary` |
| CLI | `effect/cli` | `Command`, `Flag`, `Argument`, `Prompt` (PascalCase constructors) |
| AI / MCP | `effect/ai` + `@effect/ai-anthropic` / `-openai` | `LanguageModel`, `Tool`, `Toolkit`, `Chat`, `McpServer` |
| OTLP / Prometheus | `effect/observability` | `Otlp`, `OtlpTracer`, `OtlpMetrics`, `PrometheusMetrics` |
| Cluster / workflow | `effect/cluster`, `effect/workflow` | `Entity`, `Sharding`, `Workflow`, `Activity` |
| Workers, sockets, net | `effect/workers`, `effect/socket`, `effect/net` | `Worker`, `Socket`, `NetAddress` |
| Reactivity / atoms | `effect/reactivity` | `Atom`, `AtomRegistry`, `AsyncResult` |
| Test services | `effect/testing` | `TestClock`, `TestConsole`, `TestSchema` |
| Property testing | `import { Arbitrary } from "effect"` | `Arbitrary.schema(S)` (native; no fast-check) |

Node/Bun services: `NodeServices.layer` / `BunServices.layer` provide `FileSystem`, `Path`,
`ChildProcessSpawner`, `Crypto`, `Stdio`, `Terminal` (v3 `NodeContext.layer`). Full catalog:
`references/platform.md` and `references/modules.md`.

### Config and ConfigProvider

```ts
import { Config, ConfigProvider, Effect, Redacted } from "effect"

export const AppConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(3000)),
  apiKey: Config.Redacted("API_KEY"),
  debug: Config.Boolean("DEBUG").pipe(Config.withDefault(false))
})

export const program = Effect.gen(function*() {
  const cfg = yield* AppConfig
  return `${cfg.port}:${Redacted.value(cfg.apiKey).length}`
})

// Tests / scripts: replace the provider (v3 Layer.setConfigProvider).
export const TestConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ PORT: "8080", API_KEY: "secret" })
)
export const tested = program.pipe(Effect.provide(TestConfig))
```

- Constructors are PascalCase: `String`, `NonEmptyString`, `Number`, `Finite`, `Int`, `Boolean`, `Port`,
  `URL`, `Date`, `Duration`, `ByteSize`, `LogLevel`, `Redacted`, `Literal`, `Literals`, `Array(schema)`,
  `Record(key, value)`, `schema(S, path)`. Combinators stay lowercase: `map`, `flatMap`, `mapEffect`
  (v3 `mapOrFail`), `orElse`, `withDefault`, `option`, `all`, `nested`, `unwrap`.
- The default provider reads `process.env` with no setup (`ConfigProvider.ConfigProvider` is a
  `Context.Reference`). Others: `fromEnv({ env })`, `fromUnknown(obj)`, `fromDotEnv(path)`,
  `fromDir(path)`; add a provider with `ConfigProvider.layerAdd(p)`; per-effect override with
  `Effect.provideService(ConfigProvider.ConfigProvider, p)`.
- Read config in layer constructors so failures name the key at startup.

### Logger, Tracer, Metric

```ts
import { Effect, Layer, Logger, Metric, References } from "effect"

const requests = Metric.counter("http_requests_total", { description: "Requests served" })
const latency = Metric.timer("http_request_duration")

export const handle = Effect.fn("Http.handle")(function*(path: string) {
  yield* Effect.annotateCurrentSpan("path", path)
  yield* Metric.update(Metric.withAttributes(requests, { path }), 1)
  yield* Effect.logInfo("served").pipe(Effect.annotateLogs({ path }))
}, Effect.trackDuration(latency))

// Replace all loggers with JSON + span-event logger; raise the floor to Warn.
export const ObservabilityLive = Layer.mergeAll(
  Logger.layer([Logger.consoleJson, Logger.tracerLogger]),
  Layer.succeed(References.MinimumLogLevel, "Warn")
)
```

- Log: `Effect.log`, `logInfo`, `logWarning`, `logError`, `logDebug`; context via `annotateLogs`,
  `withLogSpan`. Loggers: `consolePretty()`, `consolePrettyTty`, `consoleJson`, `consoleLogFmt`,
  `consoleStructured`, `tracerLogger`, `Logger.make(options => …)`, `Logger.batched`, `toFile`.
- Spans: `Effect.fn("name")`, `Effect.withSpan("name", { attributes })`, `annotateCurrentSpan`,
  `Effect.linkSpans`; exporters via `effect/observability` (`OtlpTracer.layer`). Tracer-related knobs
  are references: `References.TracerEnabled`, `TracerTimingEnabled`.
- Metrics are data: `Metric.counter / gauge / histogram(name, { boundaries }) / summary / frequency /
  timer`; write with `Metric.update(m, v)` / `Metric.modify`; read with `Metric.value(m)` /
  `Metric.snapshot`; label with `Metric.withAttributes`; derive from effects with `Effect.track`,
  `trackSuccesses`, `trackErrors`, `trackDefects`, `trackDuration`.

### Duration, DateTime, Redacted, Clock, Random

```ts
import { Clock, DateTime, Duration, Effect, Random, Redacted } from "effect"

export const program = Effect.gen(function*() {
  const started = yield* Clock.currentTimeMillis       // test-controllable, unlike Date.now()
  const now = yield* DateTime.now                       // DateTime.Utc
  const later = DateTime.add(now, { minutes: 5 })
  const roll = yield* Random.nextIntBetween(1, 7)       // seeded in tests
  const timeout = Duration.seconds(30)
  const token = Redacted.make("s3cr3t")                 // prints <redacted>
  return {
    iso: DateTime.formatIso(later),
    ms: Duration.toMillis(timeout),
    roll,
    started,
    tokenLength: Redacted.value(token).length
  }
})
```

- `Duration.Input` accepts `"5 seconds"`, `"250 millis"`, a number (ms), or a `Duration`;
  `Duration.fromInput` (safe) / `fromInputUnsafe`. Comparisons are `isGreaterThan` / `isLessThan…`.
- `DateTime.now` (effect) vs `DateTime.nowUnsafe()` (sync); `make` (Option) vs `makeUnsafe` (throws);
  zones via `makeZoned`, `setZoneNamed`. Comparisons: `isGreaterThan`, `isPast`, `isFuture`.
- `Redacted.make / value / isRedacted`; keep `Redacted` until the vendor call
  (`HttpClientRequest.bearerToken` accepts it).
- `Clock`, `Random`, `Console` are services with defaults; override with
  `Effect.provideService(Clock.Clock, impl)` (v3 `withClock` / `withRandom` / `withConsole`).

---

## 2. Choosing between near-twins

Default to the first; switch when the condition holds.

**Data and errors**

| Pair | Use the first when | Switch when |
|---|---|---|
| `Schema.Struct` / `Schema.Class` | plain data, `typeof X.Type` is the type | the value needs methods, getters, identity or `instanceof` |
| `Schema.TaggedStruct("A", f)` / `Schema.TaggedClass<X>()("A", f)` | tagged plain data | tagged data with methods |
| `Schema.TaggedUnion({ A: f, B: f })` / `Schema.Union([TaggedStruct…])` | all members are tagged structs declared together (gives `.cases`, matching helpers) | members are existing schemas or not all tagged |
| `Schema.TaggedError` / `Schema.Error` / `Data.TaggedError` | error crosses a wire, journal or HTTP boundary (`{ httpApiStatus }`) | `Schema.Error`: encodable but no `_tag`; `Data.TaggedError`: purely in-process |
| `Option` / typed `XNotFound` error | absence is a normal answer (`findByEmail`) | absence fails the operation the caller asked for (`getById`) |
| `Option` / `Result` / `E` channel | only presence matters | `Result`: pure failure with a reason, no effects; `E`: the failure rides on effectful work |
| `Data.Class` / `Schema.Class` | in-memory value with structural equality, no decoding | it is decoded/encoded anywhere |

**Services and layers**

| Pair | First | Switch when |
|---|---|---|
| `layer` / `layerNoDeps` | `static layer`: self-wired default, `R = never` | `layerNoDeps`: the recipe with open requirements, for tests and alternative wiring |
| `Layer.provide` / `Layer.provideMerge` | dependency is private to the consumer | the dependency must also be visible downstream (SqlClient, Tracer at the root) |
| `Layer.merge(All)` / `Layer.provide` | siblings that do not depend on each other | one needs the other — `mergeAll` builds concurrently and siblings cannot feed each other |
| `Layer.succeed` / `Layer.mock` / `layerTest` | complete in-memory value | `mock`: partial fake, calling a missing method dies with `UnimplementedError`; `layerTest`: a maintained fake with real behavior, exported from the service |
| `Layer.effect` / `Layer.effectDiscard` | layer yields a service | layer only runs background work (fork with `forkScoped`) |
| `Effect.provide(layer)` / `Effect.provideService(tag, value)` | building a service graph | supplying one ready value or a `Context.Reference` override |
| `Context.Service` / `Context.Reference` | a required capability (no default) | an ambient setting with a sensible default (`R` stays `never`) |
| `ManagedRuntime` / `NodeRuntime.runMain` | framework owns the entrypoint (Express, Next, Hono) | Effect owns the process |

**Effects and fibers**

| Pair | First | Switch when |
|---|---|---|
| `Effect.gen` / `Effect.fn` / `Effect.fnUntraced` | one-off effect | `fn`: reusable traced function (service methods, boundaries); `fnUntraced`: same, no span (library internals, hot paths) |
| `Effect.forEach` / `Effect.all` / `Stream` | homogeneous list + one function | `all`: fixed heterogeneous tuple/struct; `Stream`: items arrive over time, need backpressure or are unbounded |
| `forkChild` / `forkScoped` / `forkIn` / `forkDetach` | child bounded by the parent fiber | `forkScoped`: lifetime of the enclosing scope (layer); `forkIn(scope)`: a scope captured earlier; `forkDetach`: truly global, rare |
| `FiberSet` / `FiberMap` / `FiberHandle` / `forkScoped` | many anonymous background fibers, interrupted with the scope | `FiberMap`: one fiber per key (replace or `onlyIfMissing`); `FiberHandle`: at most one fiber; bare `forkScoped`: one fire-and-forget fiber |
| `Effect.retry` / `Effect.repeat` | recur while it fails | recur while it succeeds |
| `Effect.timeout` / `timeoutOption` / `timeoutOrElse` | timeout is a failure (`Cause.TimeoutError` in `E`) | `Option`: timeout is a normal result; `orElse({ duration, orElse })`: fallback effect |
| `race` / `raceFirst` / `raceAll` / `firstSuccessOf` | first *success* of two, loser interrupted | `raceFirst`: first *completion* (failure wins too); `raceAll`: first success of many; `firstSuccessOf`: sequential fallbacks, one at a time |
| `Effect.forEach` / `Request` + `RequestResolver` | per-item calls with no batch endpoint | the backend has a multi-key endpoint (dedupe + batch; complete every entry) |

**Schedules**

| Pair | First | Switch when |
|---|---|---|
| `Schedule.max([..])` / `Schedule.min([..])` | AND: continue while all continue, wait the slowest — caps a backoff with `recurs(n)` | OR: continue while any continues, wait the fastest — caps delay growth with `spaced(max)` |
| `Schedule.spaced` / `Schedule.fixed` | constant gap after each run | steady cadence regardless of run time |
| `Schedule.upTo({ times })` / `Schedule.recurs(n)` in `max` | limit an existing schedule | build the limit as its own schedule |
| `Schedule.concat` / `Schedule.min` | phases in sequence (fast retries, then slow) | concurrent alternatives |

**State and coordination**

| Pair | First | Switch when |
|---|---|---|
| `Ref` / `SynchronizedRef` / `SubscriptionRef` | pure update | `Synchronized`: next value needs an effect (`updateEffect`, `modifyEffect`); `Subscription`: others must observe every change (`changes`) |
| `Ref` / `TxRef` in `Effect.tx` | one cell | atomicity spans several cells |
| `Ref` / `MutableRef` | inside Effect | synchronous escape hatch only |
| `Deferred` / `Latch` | hand one result to many waiters once | open/close a gate repeatedly |
| `Queue` / `PubSub` | each item handled once by one worker | each message reaches all subscribers |
| `Semaphore` / `Pool` / `PartitionedSemaphore` | cap concurrent use of one resource | `Pool`: N stateful instances (connections); `PartitionedSemaphore`: per-tenant fairness |
| `RcRef` / `RcMap` / `Pool` / `LayerMap` | one shared refcounted instance | `RcMap`: one per key; `Pool`: N interchangeable; `LayerMap`: a whole layer per key (tenant) |

**Caching**

| Pair | First | Switch when |
|---|---|---|
| `Effect.cached` | memoize one keyless effect forever (first `Exit` — failures included) | — |
| `Effect.cachedWithTTL(eff, ttl)` | memoize one effect for a duration; TTL may be `(exit) => Duration` | — |
| `Effect.cachedInvalidateWithTTL` | you also need a manual `invalidate` effect (returns `[get, invalidate]`) | — |
| `Cache.make({ lookup, capacity, timeToLive })` | many keys, one TTL | — |
| `Cache.makeWith(lookup, { capacity, timeToLive: (exit, key) => … })` | success and failure need different TTLs | — |
| `ScopedCache.make({ lookup, capacity })` | the cached value is a resource (lookup needs `Scope`); note `makeWith` takes one options object | — |
| `PersistedCache.make(lookup, { storeId, timeToLive })` | entries must survive restarts / be shared via `Persistence` | — |
| `Resource.auto(acquire, schedule)` | push: re-acquire a value on a schedule in the background (`Resource.manual` + `refresh` for on-demand) | — |
| `RequestResolver.withCache` | dedupe batched requests | it keeps failures forever; prefer a TTL'd cache |

---

## 3. The v3 → v4 table

Generated full map: `migration/v3-to-v4.md` in the Effect repo at tag `effect@4.0.0` (~16.8k lines, grep it). These are the
names v3-trained memory gets wrong. Deeper walk-through: `references/migration.md`.

### Packages and module paths
Everything merged into `effect`; there is **no `unstable` path segment** in 4.0.0.

| v3 | v4 |
|---|---|
| `@effect/platform/HttpClient`, `HttpRouter`, `HttpServer`, `FetchHttpClient`, `Url` | `effect/http` |
| `@effect/platform/HttpApi*` | `effect/http-api` |
| `@effect/platform/FileSystem`, `Path`, `Terminal`, `Error` | root `effect` (`FileSystem`, `Path`, `Terminal`, `PlatformError`) |
| `@effect/platform/Command`, `CommandExecutor` | `effect/process` (`ChildProcess`, `ChildProcessSpawner`) |
| `@effect/platform/KeyValueStore`, `@effect/experimental/Persistence`, `RateLimiter` | `effect/persistence` |
| `@effect/platform/Socket`, `Worker`, `Ndjson` | `effect/socket`, `effect/workers`, `effect/encoding` |
| `@effect/sql`, `@effect/rpc`, `@effect/cluster`, `@effect/workflow`, `@effect/cli`, `@effect/ai` | `effect/sql`, `effect/rpc`, `effect/cluster`, `effect/workflow`, `effect/cli`, `effect/ai` |
| `@effect/experimental/VariantSchema`, `@effect/sql/Model` | `effect/schema` |
| `@effect/schema` | `import { Schema } from "effect"` |
| `effect/Either` | `effect/Result` |
| `effect/ParseResult` | `effect/SchemaIssue` / `effect/SchemaParser` |
| `effect/JSONSchema` | `effect/JsonSchema` |
| `effect/FiberRef` | `effect/References` + `Context.Reference` |
| `effect/Encoding` | `effect/encoding/{Base64,Base64Url,Hex,EncodingError}` |
| `effect/TestClock` | `effect/testing` |
| `effect/FastCheck`, `Schema.Arbitrary` | native `Arbitrary` (root, unstable); depend on `fast-check` directly if you need it |
| `effect/STM`, `TRef`, `TMap`, `TSet`, `TQueue`, `TSemaphore` | `Effect.tx` + `TxRef`, `TxHashMap`, `TxHashSet`, `TxQueue`, `TxSemaphore` |
| `effect/Mailbox` | `Queue<A, E>` (+ `Cause.Done`) |
| `effect/Secret` | `Redacted` |
| `effect/Micro`, `Supervisor`, `RuntimeFlags`, `FiberRefs`, `SortedMap`, `List`, `GroupBy` | removed |
| `NodeContext.layer` / `BunContext.layer` | `NodeServices.layer` / `BunServices.layer` |
| `NodeCommandExecutor` | `NodeChildProcessSpawner` |
| `@effect/platform-node/Mime` | `effect/http/Mime` |

Do not install `@effect/platform`, `@effect/sql`, `@effect/rpc`, `@effect/cli`, `@effect/ai`,
`@effect/experimental`, `@effect/cluster`, `@effect/workflow` next to `effect@4`: their npm `latest`
is the v3-era 0.x line. All `@effect/*` v4 packages share `effect`'s exact version.

### Services and runtime

| v3 | v4 |
|---|---|
| `Context.Tag(id)<Self, Shape>()`, `Context.GenericTag<T>(id)` | `Context.Service<Self, Shape>()(id)`, `Context.Service<T>(id)` |
| `Effect.Tag` (accessor proxy) | `Context.Service` + `yield*` or `X.use` |
| `Effect.Service<Self>()(id, { effect, dependencies })` + `.Default` | `Context.Service<Self>()(id, { make })`; write `static layer = Layer.effect(this, this.make)`; no `dependencies`, no `.Default` |
| `Context.unsafeGet`, `unsafeMake`, `isTag` | `Context.getUnsafe`, `makeUnsafe`, `isKey` |
| `Effect.serviceOption(X)` | `Effect.serviceOption(X)` (unchanged) |
| `Layer.scoped`, `scopedDiscard`, `scopedContext` | `Layer.effect`, `effectDiscard`, `effectContext` |
| `Layer.discard(l)` | `Layer.flatMap(l, () => Layer.empty)` |
| `Layer.fail(e)` | `Layer.effectDiscard(Effect.fail(e))` |
| `Layer.catchAll`, `catchAllCause`, `tapErrorCause` | `Layer.catch`, `catchCause`, `tapCause` |
| `Layer.setConfigProvider(p)` | `ConfigProvider.layer(p)` |
| `Layer.setTracer(t)` | `Layer.succeed(Tracer.Tracer, t)` |
| `Layer.toRuntime(l)` | `Layer.build(l)` + `Effect.run*With` |
| `Runtime<R>`, `Runtime.runFork(rt)(eff)` | removed; `Effect.runForkWith(ctx)(eff)` (also `runPromiseWith`, `runSyncWith`, `runCallbackWith`) |
| `Effect.runtime<R>()` | `Effect.context<R>()` |
| `FiberRef.make(init)` | `Context.Reference<T>("key", { defaultValue: () => init })` |
| `Effect.locally(ref, v)`, `FiberRef.set` | `Effect.provideService(ref, v)` |
| `Effect.locallyWith(ref, f)` | `Effect.updateService(ref, f)` |
| `FiberRef.currentLogLevel`, `currentMinimumLogLevel`, `currentLogAnnotations` | `References.CurrentLogLevel`, `MinimumLogLevel`, `CurrentLogAnnotations` |
| `Effect.withConfigProvider`, `withClock`, `withRandom`, `withConsole` | `Effect.provideService(ConfigProvider.ConfigProvider / Clock.Clock / Random.Random / Console.Console, impl)` |
| `Effect.clock`, `Effect.random`, `Effect.console` | `yield* Clock.Clock`, `Random.Random`, `Console.Console` |
| `Effect.withConcurrency(n)` | removed — pass `concurrency` to each combinator |
| per-`provide` memoization | one shared `MemoMap` across `provide` calls; opt out with `Layer.fresh` / `{ local: true }` |

### Renamed verbs (same idea, new name)

| v3 | v4 |
|---|---|
| `Effect.catchAll` / `orElse` | `Effect.catch` |
| `Effect.catchAllCause`, `catchAllDefect` | `Effect.catchCause`, `catchDefect` |
| `Effect.catchSome`, `catchSomeCause` | `Effect.catchFilter`, `catchCauseFilter` |
| `Effect.tapErrorCause` | `Effect.tapCause` |
| `Effect.either` | `Effect.result` |
| `Effect.zipRight` / `zipLeft` | `Effect.andThen` / `Effect.tap` |
| `Effect.dieMessage(msg)` | `Effect.die(new Error(msg))` |
| `Effect.async`, `asyncEffect` | `Effect.callback` |
| `Effect.fork`, `forkDaemon` | `Effect.forkChild`, `forkDetach` (no bare `fork`) |
| `Effect.forkAll`, `forkWithErrorHandler` | `forEach` + `forkChild`; `forkChild` + `Fiber.await` |
| `Effect.timeoutFail`, `timeoutTo` | `Effect.timeoutOrElse({ duration, orElse })` |
| `Effect.validateAll`, `validateFirst` | `Effect.validate`, `firstSuccessOf` |
| `Effect.repeatN(n)` | `Effect.repeat({ times: n })` |
| `Effect.once` | `Effect.cached` |
| `Effect.cachedFunction` | removed — use `Cache` |
| `Effect.ignoreLogged` | `Effect.ignoreCause({ log: "Debug" })` (v3 swallowed defects too); `Effect.ignore({ log: true })` if defects should still fail |
| `Effect.makeSemaphore`, `makeLatch`, `unsafeMakeSemaphore` | `Semaphore.make`, `Latch.make`, `Semaphore.makeUnsafe` |
| `Effect.scopeWith` | `Effect.scopedWith` |
| `Effect.tagMetrics`, `labelMetrics` | `Metric.withAttributes` |
| `Effect.if`, `unless` | plain `if` inside `Effect.suspend` / `Effect.gen` |
| `Effect.whenEffect` | `Effect.when` (accepts an effect condition) |
| `Effect.ensureErrorType` | `Effect.satisfiesErrorType` |
| `Effect.fn.Gen` | `Effect.fn.Return` |
| `Ref.unsafeMake`, `Deferred.unsafeMake`, `Queue.unsafeOffer` | `Ref.makeUnsafe`, `Deferred.makeUnsafe`, `Queue.offerUnsafe` |
| `DateTime.unsafeNow`, `unsafeMake`, `unsafeFromDate` | `DateTime.nowUnsafe`, `makeUnsafe`, `fromDateUnsafe` |
| general rule `unsafeX` | `xUnsafe` (suffix) |
| `DateTime.greaterThan`, `Duration.lessThan` | `DateTime.isGreaterThan`, `Duration.isLessThan` |
| `Duration.decode` / `decodeUnknown` | `Duration.fromInputUnsafe` / `fromInput` |
| `Option.fromNullable`, `getEquivalence`, `getOrder` | `Option.fromNullishOr`, `makeEquivalence`, `makeOrder` |
| `Either.right` / `left` / `isRight` / `mapLeft` | `Result.succeed` / `fail` / `isSuccess` / `mapError` (success-first `Result<A, E>`) |
| `Equal.equivalence` | `Equal.asEquivalence` |
| `Order.reverse` | `Order.flip` |
| `Scope.extend(scope)` | `Scope.provide(scope)` |
| `Ref.Synchronized` | `SynchronizedRef` (own module) |
| `Stream.async`, `asyncPush`, `asyncScoped`, `asyncEffect` | `Stream.callback` |
| `Stream.either`, `catchAll`, `catchAllCause`, `catchSome` | `Stream.result`, `catch`, `catchCause`, `catchFilter` |
| `Stream.repeatEffect`, `unwrapScoped` | `Stream.fromEffectRepeat`, `Stream.unwrap` |
| `Schedule.union`, `either` | `Schedule.min([..])` |
| `Schedule.intersect`, `both` | `Schedule.max([..])` |
| `Schedule.andThen` | `Schedule.concat` |
| `Schedule.whileInput`, `untilOutput`, `check`, `recurWhile` | `Schedule.while(({ input, output, attempt }) => …)` |
| `Schedule.delayed`, `jitteredWith` | `Schedule.modifyDelay` |
| `Schedule.onDecision`, `tapInput`, `tapOutput` | `Schedule.tap` |
| `take(n)` on a schedule (none in v3 either) | `Schedule.upTo({ times: n })` |
| `Logger.add(l)` / `replace` | `Logger.layer([l], { mergeWithExisting: true })` / `Logger.layer([...])` |
| `Logger.minimumLogLevel(lvl)`, `withMinimumLogLevel` | `Layer.succeed(References.MinimumLogLevel, lvl)`, `Effect.provideService(References.MinimumLogLevel, lvl)` |
| `Logger.pretty`, `json`, `logFmt` | `Logger.layer([Logger.consolePretty(), …])`, `consoleJson`, `consoleLogFmt` |
| `Metric.tagged`, `taggedWithLabels` | `Metric.withAttributes` |
| `Metric.increment(c)`, `set(g, v)` | `Metric.update(c, 1)`, `Metric.update(g, v)` |
| `Metric.trackDuration` etc. | `Effect.trackDuration`, `trackErrors`, `trackSuccesses`, `trackDefects` |
| `Match.either` | `Match.result` |
| `Config.string`, `number`, `integer`, `boolean`, `redacted`, `secret`, `url`, `port`, `literal` | `Config.String`, `Number`, `Int`, `Boolean`, `Redacted`, `Redacted`, `URL`, `Port`, `Literals` |
| `Config.mapOrFail`, `mapAttempt` | `Config.mapEffect` |
| `Config.array`, `repeat`, `hashMap` | `Config.Array(schema)`, `Config.schema(Schema.HashMap(...))` |
| `ConfigProvider.fromJson`, `fromMap` | `ConfigProvider.fromUnknown` |
| `Fiber.poll`, `status` | `fiber.pollUnsafe()` |
| `Fiber.getCurrentFiber` | `Fiber.getCurrent` |

### Schema rewrite (summary — depth in `references/schema.md`)

| v3 | v4 |
|---|---|
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])` (`Literal` takes one value) |
| `Schema.Union(A, B)`, `Tuple(A, B)` | `Schema.Union([A, B])`, `Tuple([A, B])` |
| `Schema.Record({ key, value })` | `Schema.Record(key, value)` |
| `.pipe(Schema.pattern(r))`, `Schema.filter(p)` | `.check(Schema.isPattern(r))`, `.check(Schema.makeFilter(p))` |
| `Schema.extend(A, B)` | `Schema.Struct({ ...A.fields, ...B.fields })` |
| `Schema.parseJson(S)` | `Schema.fromJsonString(S)` |
| `Schema.transform(from, to, {...})`, `transformOrFail` | `from.pipe(Schema.decodeTo(to, SchemaTransformation.transform({...})))`, `SchemaTransformation.transformEffect` |
| `Schema.decodeUnknown(S)`, `decodeUnknownEither` | `Schema.decodeUnknownEffect(S)`, `decodeUnknownExit` |
| `Schema.optionalWith(S, { default })` | `Schema.optional` / `optionalKey` / `withDecodingDefault*` |
| `Schema.Date` / `DateFromSelf` | `Schema.DateFromString` / `Schema.Date` (names flipped) |
| `Schema.Redacted` / `RedactedFromSelf` | `Schema.RedactedFromValue` / `Schema.Redacted` |
| `Schema.Either`, `BigIntFromSelf`, `DateFromNumber`, `UUID` | `Schema.Result`, `BigInt`, `DateFromMillis`, `String.check(Schema.isUUID())` |
| `Schema.TaggedError<E>()("E", {...})` | unchanged shape (also `Schema.Error<E>("E")({...})`) |
| `Schema.brand("A", "B")` | one id per call; type-only (`Schema.fromBrand` for runtime checks) |

### Errors, Cause, interruption

| v3 | v4 |
|---|---|
| recursive `Cause` (`Sequential`/`Parallel`/`Then`) | flat `cause.reasons`; filter with `Cause.isFailReason` / `isDieReason` / `isInterruptReason` |
| `Cause.failureOption` | `Cause.findErrorOption` |
| `Cause.failureOrCause` | `Cause.findError` (returns `Result`) |
| `Cause.dieOption` | `Cause.findDefect` |
| `Cause.isInterrupted`, `Exit.isInterrupted` | `Cause.hasInterrupts`, `Exit.hasInterrupts` |
| `Cause.failures(c)`, `defects(c)` | `c.reasons.filter(Cause.isFailReason)`, `…isDieReason` |
| `Cause.sequential` / `parallel` | `Cause.combine` |
| `Cause.TimeoutException`, `NoSuchElementException`, `UnknownException` | `Cause.TimeoutError`, `NoSuchElementError`, `UnknownError` |
| `Cause.InterruptedException` | removed |
| `Exit.causeOption` | `Exit.getCause` |
| `Data.TaggedError` / `Data.Error` | unchanged; prefer `Schema.TaggedError` when the error is encoded |

### Fibers, state, transactions

| v3 | v4 |
|---|---|
| `Ref`, `Deferred`, `Fiber`, `FiberRef` are `Effect` subtypes | plain values: `Ref.get(ref)`, `Deferred.await(d)`, `Fiber.join(f)` |
| `STM<A, E, R>` + `STM.commit` | ordinary effects over `Tx*` inside `Effect.tx(...)`; `STM.retry` → `Effect.txRetry` |
| `Mailbox` | `Queue<A, E>`; `Queue.end`, `Queue.fail`; end of input is `Cause.Done` |
| `Queue.isShutdown`, `takeUpTo`, `awaitShutdown` | `queue.state._tag === "Done"`, `Queue.poll` / `clear` / `takeBetween`, `Queue.await` |
| `Fiber.all`, `Fiber.zip`, synthetic fibers | `Fiber.joinAll`; compose `Fiber.join` effects |
| `Effect.supervised` | `FiberSet` |
| `Effect.daemonChildren` | `Effect.awaitAllChildren` or explicit `forkDetach` |

### Config, Data, Match, Metric, Logger
- `Config` constructors are PascalCase (table above); `ConfigError` lives at `Config.ConfigError`.
- `Data.struct`, `tuple`, `case`, `tagged`, `array` removed — use `Data.Class`, `Data.TaggedClass`,
  `Data.TaggedEnum` + `Data.taggedEnum<T>()`, or plain objects (structural `Equal` is the default now).
- `Match.tag("a", "b", handler)` — tags first, handler last; non-`_tag` discriminators via
  `Match.discriminator("kind")("a", handler)`.
- Metrics are data you `update`; no pipe-able `metric(eff)`.

### Testing (`@effect/vitest@4`, Vitest 5 only)

| v3 | v4 |
|---|---|
| `it.scoped`, `it.scopedLive` | `it.effect`, `it.live` (scope + test services included) |
| `it.prop(..., fastCheck options)` | `it.prop` / `it.effect.prop` with Schemas or native `Arbitrary`; options `{ arbitrary: { runs, seed } }` |
| `effect/TestClock` | `import { TestClock } from "effect/testing"` |
| `it.sequential` (Vitest 4) | `describe(..., { concurrent: false })` |

---

## 4. rc/beta → 4.0.0 breaking deltas

For code written against `4.0.0-beta.*` or `rc.*` (including the old rc.112 snapshot of this skill).

| RC/beta form | 4.0.0 | When |
|---|---|---|
| `effect/unstable/http`, `…/sql`, `…/persistence`, `…/rpc`, … | `effect/http`, `effect/sql`, `effect/persistence`, `effect/rpc` — no shims | rc.118 |
| `effect/unstable/httpapi` | `effect/http-api` (hyphen; TypeIds and SSE event name renamed too) | rc.118 |
| `effect/unstable/arbitrary` | root `Arbitrary` (`import { Arbitrary } from "effect"`) | rc.118 |
| `effect/Encoding` (`Encoding.encodeBase64`, `randomHex`) | `effect/encoding/Base64`, `Base64Url`, `Hex`, `EncodingError`; `Hex.random` | rc.118 |
| `Schema.brand("A", "B")`, brand id read from AST | one id per call; type-only; `Schema.fromBrand(id, ctor)` keeps runtime checks | 4.0.0 |
| `Array.partition(xs, pred)` → `[fails, passes]` | filter returns `Result`; result is `[passes, fails]` (also `Effect`/`Chunk`/`Record.partition`, `separate`, `Option.partitionMap`) | 4.0.0 |
| `Stream.partition` → `[fails, passes]` | `[passes, fails]`, with a `capacity` option | rc.116 |
| `Schema.isLengthBetween`, `isSizeBetween`, `isStartsWith`, `isEndsWith`, `isIncludes` | `isBetweenLength`, `isBetweenSize`, `isStartingWith`, `isEndingWith`, `isIncluding` | rc.118 |
| `Scope.close(anyScope)` | requires `Scope.Closeable` (from `Scope.make` / `Scope.fork`) | rc.118 |
| routes registered on a router provided by the app | each `HttpRouter` entrypoint builds a fresh router in a forked memo map | rc.118 |
| `Schema.TaggedErrorClass`, `Schema.ErrorClass` | `Schema.TaggedError`, `Schema.Error`; JS `Error` schema is `Schema.ErrorInstance` | beta.104 |
| `ServiceMap.Service`, `ServiceMap.Reference` | `Context.Service`, `Context.Reference` | early beta |
| `Config.string`, `Config.mapOrFail` | `Config.String`, `Config.mapEffect` | rc.113 |
| `Flag.integer`, `Flag.float`, `Flag.choice`, `Prompt.text` | `Flag.Int`, `Flag.Finite`, `Flag.Literals`, `Prompt.String` | rc.113 |
| MessagePack (`RpcSerialization.msgPack`, `effect/unstable/encoding/Msgpack`) | removed; use `SchemaBinary` or JSON/NDJSON | rc.113 |
| sockets with `run`, `runString`, send queues | pull-based: scoped `socket.reader` / `socket.writer` | rc.113 |
| `SchemaGetter.transformOrFail`, `SchemaTransformation.make`, `Transformation#compose` | `SchemaGetter.transformEffect`, `makeTransformation`, `composeTransformation` | rc.113 / rc.116 |
| `Effect.try<A, E>(...)` explicit generics; callback form typed `unknown` | callback form fails with `Cause.UnknownError`; custom error needs `{ try, catch }` | rc.113 |
| `Effect.orElseSucceed(() => v)` | callback receives the error: `orElseSucceed((e) => v)` | rc.116 |
| `Effect.repeat({ while/until: refinement })` always narrowed the result | narrows only when the options have no `schedule` / `times` key | rc.118 |
| `Stream.mapBoth({ onSuccess, onFailure })` | `Stream.mapBoth({ onElement, onError })` | rc.116 |
| `TestSchema.verifyLosslessTransformation` | `new TestSchema.Asserts(S).verifyRoundTrip()` (module now unstable) | 4.0.0 |
| `Queue.State.takers` entries are fibers/latches | `Queue.Taker` with `.resume`; `Queue.takeN` waits for the full batch | 4.0.0 |
| `SynchronizedRef` usable as a `Ref` | no longer a subtype | rc.113 |
| `@effect/sql-pg` over `pg` (`fromPool`, `int8` as string) | built-in client; `int8` → `bigint`; prepared statements on | rc.113 |
| `npm i effect@rc` / `@beta` | `npm i effect` (4.0.0 is `latest`, LTS) | 4.0.0 |

---

## 5. Behavior traps (right name, surprising semantics)

Each is checked against the 4.0.0 d.ts/source or a probe run on 4.0.0.

**Yielding and types**
- **`Option` and `Result` are not yieldable.** `yield* Option.some(1)` is a type error and, if forced
  past the checker, dies at runtime with "Not a valid effect". Bridge with `Effect.fromOption`
  (fails with `NoSuchElementError`) / `Effect.fromResult`. `migration/yieldable.md` still claims
  otherwise — it is stale.
- **`Ref`, `Deferred`, `Fiber`, `Queue` are plain values.** Use `Ref.get`, `Deferred.await`,
  `Fiber.join`, `Queue.take`.
- **`Config` is an `Effect`** (`interface Config<T> extends Effect<T, ConfigError>`): `yield*` it or
  pass it to `Effect.map` directly. `Context.Service` classes are yieldable too.
- **A service class's instance type is not its shape.** `const x: Users = {...}` fails; the shape is
  `Users["Service"]` or `Context.Service.Shape<typeof Users>`, and values are built with `Users.of`.
- **`Match.type<T>()` is a double call** — the generic returns a builder.
- **`Sink<A, In, L, E, R>`** — result first, input second.
- **`Schema.Literal` takes one value**; `Literal("a", "b")` is a type error (extra args are ignored at
  runtime). Use `Literals([...])`.
- **`Schema.Defect()` is a function.** `cause: Schema.Defect` (no call) is a type error.
- **`TestClock.layer()` is a function; `TestConsole.layer` is a value.** `it.effect` already provides both.
- **`ConfigError` is `Config.ConfigError`** — there is no root `ConfigError` module.

**Collections and data**
- **`partition` order is `[passes, fails]`** and the `Array` filter returns a `Result`, not a boolean:
  `Array.partition(xs, (x) => x > 0 ? Result.succeed(x) : Result.fail(x))`.
- **`Option.some(null)` is `Some<null>`.** Fold nullish input with `Option.fromNullishOr`.
- **`Equal.equals` is structural by default** for plain objects, arrays, `Map`, `Set`, `Date`; opt out
  with `Equal.byReference(obj)`.
- **`Effect.succeed(Date.now())` captures the value once** at construction; use `Effect.sync` or
  `Clock.currentTimeMillis`.

**Concurrency and fibers**
- **`Effect.all` / `forEach` are sequential by default** — pass `{ concurrency }`.
- **`zip` / `zipWith` use `{ concurrent: true }`**, not `concurrency`.
- **A fork starts on the next tick** unless `{ startImmediately: true }`; the parent continues first.
- **`forkChild` dies with its parent fiber.** Fire-and-forget from a short-lived fiber never runs;
  use `forkScoped` (layer lifetime) or a `FiberSet`.
- **An unjoined fork's failure is reported nowhere.** The parent succeeds and nothing is logged
  (`forkWithErrorHandler` is gone); join it, supervise it, or route its `Exit` somewhere.
- **`catchCause` sees interrupts; `catch` does not.** A `catchCause` that always recovers can swallow
  interruption — check `Cause.hasInterrupts` and re-fail.
- **`Effect.ignore` drops typed failures only.** Defects still fail; `ignore({ log: true })` logs the
  dropped typed failure (defects propagate unlogged). `ignoreCause` swallows everything.
- **`Effect.promise` rejection is a defect**, not a typed error. Use `tryPromise({ try, catch })`.
- **`tryPromise` passes an `AbortSignal` only if your thunk declares a parameter** (`(signal) => …`);
  `(...args) =>` receives `undefined`. Timeouts interrupt the fiber but cannot stop a promise you did not
  wire to the signal.
- **Release with a promise must be `Effect.promise(() => client.close())`.** `Effect.sync(() =>
  client.close())` returns before the close finishes.
- **`race` returns the first success; `raceFirst` the first completion**; `firstSuccessOf` is sequential.
- **Timeouts are exactly three:** `timeout`, `timeoutOption`, `timeoutOrElse`. No `timeoutFail` /
  `timeoutTo`. `timeout` adds `Cause.TimeoutError` (tag `"TimeoutError"`).

**Queues, streams, refs**
- **End of input is a failure: `Cause.Done` in `E`.** `Queue.end` and `Pull` completion fail with it;
  generic error handling catches "done" unless you filter (`Pull.catchDone`, `filterDone`).
- **`Queue.takeAll` / `PubSub.takeAll` suspend on empty** (return a non-empty array). Non-blocking drain:
  `Queue.clear` / `Queue.poll`; for PubSub `PubSub.takeUpTo`.
- **`Stream.share` requires `capacity`** (`"unbounded"` or a number + `strategy`) and returns
  `Effect<Stream, never, Scope | R>`.
- **`Stream.callback`'s buffer is unbounded by default** — pass `{ bufferSize, strategy }` for a hot source.
- **`SubscriptionRef.changes(ref)` replays the current value first** and publishes on every `set`,
  even when the new value equals the old one.

**Schedules**
- **`Schedule.recurs(n)` means n + 1 runs** (the first run is not a recurrence); `retry({ times: n })`
  and `repeat({ times: n })` are also n + 1 runs. `repeat(Schedule.once)` runs twice.
- **`Effect.repeat(schedule)` returns the schedule's output**; the options form keeps the effect's value.
- **`Schedule.max` / `min` take a non-empty array and output a `Duration`**, not a tuple.

**Caching and resources**
- **`Effect.cached` caches the first `Exit` — failures and interrupts included.** One caller's timeout
  poisons every later caller. For success-only memoization use `cachedInvalidateWithTTL` and invalidate
  on failure.
- **`Cache` requires `capacity`, defaults to an infinite TTL, and caches failures.** Use
  `Cache.makeWith(lookup, { capacity, timeToLive: (exit) => Exit.isSuccess(exit) ? "1 hour" : 0 })`
  (a TTL of 0 stores nothing). `Cache.getSuccess` returns `None` for a cached failure.
- **`ScopedCache.makeWith` takes one options object**, unlike `Cache.makeWith(lookup, options)`.
- **`RcMap.make({ capacity })` widens `E` with `Cause.ExceededCapacityError`.**
- **`Pool.get`, `RcRef.get`, `RcMap.get` require `Scope`.** `Effect.scoped(Pool.get(pool))` releases
  before you use it — use `Pool.use(pool, f)` or scope the whole usage.

**Layers and runtime**
- **Layer memoization is by object reference.** A layer built by a function call or inside a static
  getter is a new layer each time and builds a second resource (two pools). Bind layers to module
  constants. Sequential `Effect.provide`s rebuild because the first scope closes.
- **`Layer.mergeAll` is last-wins** for the same tag, and builds members concurrently.
- **`Logger.layer([...])` replaces every logger** (including the default console logger); pass
  `{ mergeWithExisting: true }` to add. Keep `Logger.tracerLogger` in the list if you want span events.
- **Bare `Effect.runFork` / `runPromise` do not keep Node alive** on a fiber suspended on
  `Deferred.await`; the process exits. `NodeRuntime.runMain` installs the keep-alive (and signals, exit
  codes). `migration/fiber-keep-alive.md` claims core keep-alive — not true in 4.0.0.
- **`runPromise` rejects with the raw failure value** (your tagged error object), not a `FiberFailure`
  wrapper. Use `runPromiseExit` when you need the `Cause`.
- **`Config.withDefault` / `option` recover only missing keys**, never invalid values
  (`PORT=abc` still fails); `Config.Boolean` accepts only lowercase `true/false/yes/no/on/off/1/0/y/n`.

**HTTP**
- **`HttpClient` treats non-2xx as success.** Add `HttpClient.filterStatusOk` (or
  `HttpClientResponse.filterStatusOk`) before decoding, else a 500 body flows into your schema.
- **`HttpApiEndpoint.get(name, path, { params, query, payload, success, error })`** — one options
  object; v3's chained `.setPath` / `.addSuccess` are gone (see `references/platform.md`).

**Docs**
- **The website is versioned.** Use `effect.website/docs/v4` and `/docs/v4/api`; `/docs/v3` still
  exists and search results land there.
