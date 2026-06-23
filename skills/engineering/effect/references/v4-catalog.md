# Effect v4 — idiom catalog & v3→v4 migration table

Lookup reference. The SKILL.md body has the rules; this is the full enumeration. Always verify an
exact symbol/path against the **installed `effect` source** (`node_modules/effect`) or
`repos/effect/LLMS.md` — versions drift, and this list is a map, not the territory.

## Contents
- [Idioms by area](#idioms-by-area) — the API forms you'll write
- [Choosing between near-twins](#choosing-between-near-twins) — which primitive, and when its neighbour instead
- [The v3 → v4 table](#the-v3--v4-table) — renames, module moves, and the Schema rewrite
- [Behavior traps](#behavior-traps-right-name-surprising-semantics) — right name, surprising semantics

---

## Idioms by area

### The Effect type & executors
- `Effect<A, E, R>` — **A** success · **E** typed error channel · **R** required services (DI). A
  *description*, not a running computation; nothing runs until an executor is called.
- `Effect.gen(function*(){ const x = yield* eff; … })` — do-notation; `yield*` sequences an effect or
  pulls a service (adding it to `R`).
- `Effect.fn("span.name")(function*(args){…}, ...pipeline)` — a reusable *function* (args → Effect)
  that opens a named span per call + optional post-processing. `Effect.fnUntraced(function*(args){…})`
  — same, no span. Prefer these over a `const f = (x) => Effect.gen(…)` wrapper.
- Executors: `Effect.runPromiseExit` (→ an `Exit` you branch on), `Effect.runPromise`, `Effect.runFork`
  (fire-and-forget → a fiber), `Effect.runForkWith(services)` (run with a provided `Context`).
- `Exit.isSuccess(exit)` + `Cause.findErrorOption(exit.cause)` — pull the typed `E` out (ignoring
  defects/interrupts). `Effect.orDie` / `Effect.die` — promote a failure to a defect.

### Services, layers, runtime (DI)
- `class X extends Context.Service<X, Shape>()("id") {}` — the tag AND the interface. `X.of({…})`
  constructs an implementation value; `X.use(s => …)` / `X.useSync(s => …)` access it (but prefer
  `yield* X`).
- `Layer.effect(X, make)` — recipe from a `make: Effect<Shape, E, Deps>`. `Layer.succeed(X, value)` —
  recipe from a ready value (test stubs). `Layer.scopedDiscard` etc. exist; check source.
- Compose: `Layer.provide(deps)`, `Layer.mergeAll(...)`, `Layer.provideMerge(deps)`,
  `Layer.unwrap(effectOfLayer)`, `Layer.fresh(layer)`.
- `ManagedRuntime.make(layer)` — build once, hold the scope, expose `runPromise*`/`runFork*`.
- `Effect.forkScoped` — a daemon fiber tied to the surrounding scope (dies with the runtime).
- `Context.make(tag, impl)`, `Context.add(map, tag, impl)`, `Context.get(map, tag)`,
  `Context.mergeAll(...)` — build/read the service map directly.

### Schema (the contract API)
- `Schema.Struct({ … })`; extend by spreading: `Schema.Struct({ ...Other.fields, more })`.
- `Schema.brand("Name")` — nominal scalars: `Schema.Number.pipe(Schema.brand("UserId"))`.
- `.check(Schema.isPattern(/…/, { message }))`, `.check(Schema.isMinLength(n))`, etc. — filters are
  `is*`-prefixed and applied with `.check(...)` (v3: `.pipe(Schema.pattern(...))`).
- `Schema.Literals(["a","b"])` / `Schema.Union([A, B])` — **array** arguments (v3: variadic).
- `Schema.BigIntFromString` — bigint ⇄ decimal string (JSON-safe). Native `Schema.BigInt` is identity
  on a bigint (use for outputs validated by decode).
- `class E extends Schema.TaggedErrorClass<E>()("E", { fields }) {}` — Effect error + encodable value.
- `Schema.NullOr`, `Schema.optional`, `Schema.Array`, `Schema.Defect()` (opaque cause field).
- `Schema.fromJsonString(S)` — codec to/from a JSON string (v3: `Schema.parseJson`).
- `Schema.toStandardSchemaV1(S)` — Standard-Schema adapter (validate = **decode**, both input and
  output).
- Type extraction: `Schema.Schema.Type<typeof X>` (also `typeof X.Type`).
- `Schema.encodeOption` / `Schema.decodeUnknownOption` / `Schema.encode` / `Schema.decodeUnknown`.

### Streams, concurrency, scope, scheduling
- `Stream<A, E, R>` — an effectful sequence (a description). Drain to an iterator with
  `Stream.toAsyncIterableEffect`.
- `Stream.callback((queue) => Effect…)` (v3: `Stream.async`; also subsumes `asyncPush`/`asyncScoped`/
  `asyncEffect`). Inside it: `Queue.offerUnsafe`, `Queue.failCauseUnsafe`.
- `Stream.fromPubSub(pubsub)`, `Stream.share(...)` (refcount, `replay`, `idleTimeToLive`),
  `Stream.fromSchedule(schedule)`, `Stream.retry(schedule)`.
- `PubSub.unbounded()` + `PubSub.publishUnsafe`. `SubscriptionRef` + `SubscriptionRef.changes`
  (replays the current value first — no manual prepend).
- `Effect.forEach(items, f, { concurrency })` — `"unbounded"` | a number | `1`; add `{ discard: true }`
  to drop results. `Semaphore.makeUnsafe(n)` + `.withPermits(k)(eff)`.
- `Schedule.spaced("5 seconds")`, `Schedule.exponential("500 millis").pipe(Schedule.jittered, Schedule.andThen(Schedule.spaced(...)))`,
  `Schedule.take(n)`.
- `Effect.addFinalizer`, `Effect.uninterruptible`, `Effect.scoped`.

### Platform built-ins (never hand-roll)
- `Cache.makeWith(lookup, { capacity, timeToLive })` — keyed cache, stores the `Exit`, dedupes
  concurrent misses. `Effect.cachedInvalidateWithTTL` for single values.
- `Metric.counter` / `histogram` / `frequency` / `gauge`; `Metric.withAttributes(m, {...})`;
  `Metric.update(m, v)`; `Metric.snapshot`.
- `SqlClient` (`effect/unstable/sql`); `KeyValueStore.toSchemaStore(kvs, S)`; `Persistence.layerSql` /
  `Persistence.layerMemory` (`effect/unstable/persistence`).
- `RateLimiter.makeWithRateLimiter({ key, window, limit, algorithm, onExceeded })`
  (`effect/unstable/persistence`).
- `HttpClient` (`effect/unstable/http`); `HttpClient.transform(base, eff => …)` wraps the whole client.
- `Logger.layer([...], { mergeWithExisting })`; `Effect.withSpan("name", { attributes })`; custom
  `Tracer`.

---

## Choosing between near-twins

The expert move is picking the right primitive over its neighbour. Reach for the **first** by default;
switch to the named alternative when the condition holds.

**State**
- `Ref` for a pure update; `SynchronizedRef` when computing the next value needs an Effect (its
  effectful methods are the `*Effect` suffix — `updateEffect`, `modifyEffect`); `SubscriptionRef`
  when other fibers must *observe* every change (consume `.changes`, don't poll).
- `Ref` for one cell; `TxRef` (inside `Effect.tx`) when atomicity must span multiple cells.
- a `Ref` variant inside Effect; `MutableRef` only as a synchronous escape hatch (no `yield*`).

**Coordination & concurrency**
- `Deferred` to hand one result to many awaiters once; `Latch` to open/close a gate for workers repeatedly.
- `Queue` when each item is handled once by one of N workers; `PubSub` when each message must reach
  *all* subscribers. (`Mailbox` is gone — a v4 `Queue<A, E>` already carries the error channel.)
- `Semaphore` to cap calls to one shared resource (abstract permits); `Pool` for N distinct stateful
  instances (DB connections) handed out and returned. `Semaphore.makeUnsafe(1)` is the mutex.
- `Effect.forEach({ concurrency })` for a homogeneous list + one function; `Effect.all` for a fixed
  heterogeneous set whose results combine as a tuple/struct; `Stream` when items arrive over time and
  you need backpressure/windowing/an unbounded source.

**Resources**
- `RcRef` for one shared instance kept alive by refcount; `RcMap` for one resource *per key*; `Pool`
  for N interchangeable instances. All of `.get` require `Scope` — borrow inside `Effect.scoped`.
- `acquireRelease` when cleanup must survive interruption (the default); `addFinalizer` when there's
  no acquire half (a log line, a flag flip); `ensuring` for a blind finalizer on one effect.

**Caching & scheduling**
- `Cache` for many keyed values computed on demand; `Effect.cachedWithTTL` to memoize *one* keyless
  Effect for a duration; `Resource` to *push* a value re-acquired on a `Schedule` in the background.
- `Cache.makeWith` when success and failure need *different* TTLs (short failure TTL); `Cache.make` otherwise.
- `Effect.retry` to recur while it *fails*; `Effect.repeat` to recur while it *succeeds*.
- `Schedule.both` (AND — recur while both want to, e.g. cap a backoff with `recurs(5)`); `Schedule.either`
  (OR — recur while either wants to); `Schedule.spaced` (gap between attempts) vs `Schedule.fixed` (steady cadence).

**Errors & DI**
- `Option` when only presence matters; `Result` for a pure failure-with-a-reason; the typed `E` channel
  when the failure rides on something effectful.
- `Layer` to build a service once and share it; `Effect` for ordinary work. `Layer.provide` to feed a
  dep and hide it; `Layer.merge` to union peers; `Layer.provideMerge` when the dep is public (Logger/Tracer/SqlClient at the root).
- `Effect.gen` for a one-off effect; `Effect.fn("name")` for a reusable, **traced** function (service
  methods); `Effect.fnUntraced` for the same generator syntax with no span (hot/trivial paths).

---

## The v3 → v4 table

The deltas your v3 memory gets wrong. (Source: `repos/effect/migration/*` — verify against the
installed version.)

### Services & runtime
| v3 | v4 |
| --- | --- |
| `Context.Tag(id)<Self,Shape>()` / `Context.GenericTag<T>(id)` | `Context.Service<Self,Shape>()(id)` / `Context.Service<T>(id)` |
| `Effect.Tag(id)<Self,Shape>()` (static accessor proxy) | `Context.Service<Self,Shape>()(id)` + `yield*` or `.use` |
| `Effect.Service<Self>()(id, { effect, dependencies })` + auto `.Default` | `Context.Service<Self>()(id, { make })`; write `Layer.effect` yourself; no `dependencies` option |
| `Runtime<R>` = `{ context, runtimeFlags, fiberRefs }` | **removed** — carry a `Context<R>`; run via `Effect.runForkWith(services)`; `Runtime` module = lifecycle helpers; `ManagedRuntime` remains |
| layer naming `.Default` / `Live` | convention is `.layer` (+ descriptive suffixes) |
| memoization per `Effect.provide` call | shared `MemoMap` across `provide` calls; opt out with `Layer.fresh` / `{ local: true }` |
| `Effect.runtime<R>()` / `Runtime.runFork(rt)(eff)` | `Effect.context<R>()` / `Effect.runForkWith(services)(eff)` (same for `runPromiseWith`/`runSyncWith`) |
| `FiberRef` | `Context.Reference` (a service tag carrying a built-in default → keeps `R = never`) |

### Module moves (import from `effect/unstable/*`, not a sibling package)
| v3 package | v4 path |
| --- | --- |
| `@effect/platform/HttpClient` | `effect/unstable/http` |
| `@effect/platform/KeyValueStore` | `effect/unstable/persistence` |
| `@effect/experimental/RateLimiter` | `effect/unstable/persistence` |
| `@effect/experimental/Persistence` | `effect/unstable/persistence` |
| `@effect/sql/SqlClient` | `effect/unstable/sql` |
| `effect/Either` | `effect/Result` |
| `effect/ParseResult` | `effect/SchemaIssue` / `effect/SchemaParser` |

(The full move list is ~290 entries in `migration/v3-to-v4.md`; the above are the ones you hit most.)

### Renamed verbs (same behavior)
| v3 | v4 |
| --- | --- |
| `Stream.async` / `asyncPush` / `asyncScoped` / `asyncEffect` | `Stream.callback` (all four) |
| `Effect.async` | `Effect.callback` |
| `Effect.catchAll` | `Effect.catch` |
| `Effect.catchAllCause` | `Effect.catchCause` |
| `Effect.catchAllDefect` | `Effect.catchDefect` |
| `Effect.either` | `Effect.result` |
| `Layer.scoped` | `Layer.effect` |
| `Layer.scopedDiscard` | `Layer.effectDiscard` |
| `Either` / `Either.right` / `Either.left` | `Result` / `Result.succeed` / `Result.fail` (and `Result<A, E>` is **success-first**; accessors `.success` / `.failure`) |
| `Stream.either` / `Stream.catchAll` / `Stream.catchAllCause` | `Stream.result` / `Stream.catch` / `Stream.catchCause` |
| `Effect.fork` / `Effect.forkDaemon` | `forkChild` (default) / `forkDetach`; also `forkScoped`, `forkIn(scope)` — **no bare `fork`** |
| `Effect.validateAll` | `Effect.validate` (no `validateAll` export) |
| `Effect.makeSemaphore(n)` / `…Unsafe` | `Semaphore.make(n)` / `Semaphore.makeUnsafe(n)` (own top-level module) |
| `Ref.Synchronized` / `Ref.Synchronized.make` | `SynchronizedRef` / `SynchronizedRef.make` (own module) |
| `Schedule.union` / `Schedule.intersect` | `Schedule.either` (OR) / `Schedule.both` (AND) — output becomes `[Out1, Out2]` |
| `Scope.extend(scope)(eff)` | `Scope.provide(scope)(eff)`; `Scope.addFinalizer(scope, fin)` takes the scope **first** |
| `Order.reverse` | `Order.flip` |

> `Effect.catchTag` survived unchanged — don't "correct" it. It's the catch-*all* that became `catch`.

### Schema rewrite
| v3 | v4 |
| --- | --- |
| variadic `Schema.literal(a, b)` | array `Schema.Literals([a, b])` |
| variadic `Schema.union(A, B)` | array `Schema.Union([A, B])` |
| `.pipe(Schema.pattern(/…/))` / `Schema.filter(...)` | `.check(Schema.isPattern(/…/))` / `.check(Schema.is…(...))` |
| `Schema.TaggedError()(...)` | `Schema.TaggedErrorClass<E>()("Tag", { … })` |
| `Schema.extend(A, B)` | spread fields: `Schema.Struct({ ...A.fields, ...B.fields })` |
| `Schema.parseJson(S)` | `Schema.fromJsonString(S)` |
| `S.pipe(Schema.brand("X"))` | unchanged, but pair with `Schema.Schema.Type<typeof S>` for the type |
| `import … from "@effect/schema"` | `import { Schema } from "effect"` (folded into core — **not** under `unstable`) |
| `Schema.decodeUnknown(S)` / the `*Either` variants | `Schema.decodeUnknownEffect(S)` / the `*Exit` variants (`decodeUnknownOption` etc. remain) |

### Errors, Cause & interruption
| v3 | v4 |
| --- | --- |
| `Cause` recursive tree (`Sequential` / `Parallel` / `Then`) | flat `reasons: ReadonlyArray<Reason>` — `.filter` with `Cause.isFailReason` / `isDieReason` / `isInterruptReason` |
| `Cause.findError` → `Option` | `Cause.findError` → **`Result`**; use `Cause.findErrorOption` for an `Option` |
| `Cause.isInterrupted` / `Cause.isInterruptType` | `Cause.hasInterrupts` / `Cause.isInterruptReason` |
| `Cause.TimeoutException` / `Cause.InterruptedException` | `Cause.TimeoutError` (`_tag: "TimeoutError"`) / **removed** |
| `Data.TaggedError` / `Data.Error` (for raised errors) | still exist, but for wire-encodable domain errors prefer `Schema.TaggedErrorClass` |

### Fibers, state & transactions
| v3 | v4 |
| --- | --- |
| `STM<A, E, R>` monad + `STM.atomically` | **no STM monad** — `Tx*` ops are ordinary Effects; wrap a group in `Effect.tx` |
| `TRef` / `TQueue` / `TMap` / `TSet` / `TSemaphore` | `TxRef` / `TxQueue` / `TxHashMap` / `TxHashSet` / `TxSemaphore` |
| `Mailbox` / `Mailbox.make` | `Queue` / `Queue.make` — `Queue<A, E>` carries the error channel (`Queue.end`, `Queue.fail`, observe `Cause.Done`) |
| `zip` / `zipWith` taking `{ concurrent }` is the same | …but `forEach` / `all` / `partition` / `validate` take `{ concurrency }` — **two different option names** |

### Config, Data, Match, Metric
| v3 | v4 |
| --- | --- |
| `ConfigSecret` / `Config.secret` | `Redacted` module + `Config.redacted(name)` (both re-exported from `effect`) |
| `ConfigProvider` you must provide | a `Context.Reference` with default `fromEnv()` — read env without providing one |
| `Data.struct` / `Data.tuple` / `Data.case` / `Data.tagged` | class-based: `Data.Class` / `Data.TaggedClass` / `Data.TaggedEnum` (+ `taggedEnum()`) |
| `Match.tag(t1, fn1, t2, fn2)` | `Match.tag("t1", "t2", handler)` — tags first, **handler last**; non-`_tag` field → `Match.discriminator("kind")` |
| `Metric.counter("n")` then `eff.pipe(metric)` (pipe-able) | metric is **data**: `Metric.update(m, v)` / `Metric.modify`; read `Metric.value(m)` / `Metric.snapshot` |
| `Logger.add` / `Logger.replace` | `Logger.layer([...])` (replaces by default; `{ mergeWithExisting: true }` to add) |

---

## Behavior traps (right name, surprising semantics)

The API didn't rename — the behavior is just not what you'd assume. Each is verified in the v4 source.

- **`Option.some(null)` is a real `Some<null>`** (`isSome` → `true`). Fold nullish input to `None` with
  `Option.fromNullishOr` (`fromNullOr` / `fromUndefinedOr` for the one-sided versions).
- **`Cache.getSuccess` returns `none` for a *cached failure*** — the failed entry is in the cache, it
  just isn't a success. A `timeToLive` that resolves to **0** removes the entry immediately
  (compute-but-don't-store). Lookup requirements default to `R` unless you pass `requireServicesAt: "lookup"`.
- **`SubscriptionRef.changes` replays the current value first** (don't prepend it) and **publishes even
  when the new value equals the old** — a non-empty update notifies regardless of equality.
- **A fork schedules to the next tick** unless you pass `{ startImmediately: true }` — don't assume the
  child has run when the parent continues.
- **Completion travels in the error channel as `Cause.Done`.** `Queue.end` and a `Pull`'s end-of-input
  both *fail* with `Cause.Done`, so generic `E` handling will catch the "done" signal — filter it
  (`Pull.catchDone` / `filterDone`) before treating a failure as a real error. Include `Cause.Done` in `E`.
- **`Sink`'s type params are `<A, In, L, E, R>`** — result first, input second. Read v3-shaped types backwards here.
- **`RcMap.make` with a `capacity` widens the error** to include `Cause.ExceededCapacityError` (unbounded without it).
  Durations: `idleTimeToLive` on `RcRef`/`RcMap`, `timeToLive` on `Pool` and the caches.
- **`Pool.get` / `RcRef.get` / `RcMap.get` require `Scope`** in their own `R` — borrow inside `Effect.scoped` (a type error if you forget, not a leak).
- **`Match.type<T>()` is a double call** — the generic returns a builder, so the `()` after the type argument is required.
