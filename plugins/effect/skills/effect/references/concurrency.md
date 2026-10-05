# Concurrency, resources, streams, scheduling

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

Fibers, scopes, coordination primitives, state, queues, streams, schedules, timeouts, caching, request batching, execution plans, and durable queues. Error-channel mechanics are in `references/errors.md`. Layer lifetimes are in `references/architecture.md`. TestClock driving is in `references/testing.md`.

## Contents

0. [Picking a primitive](#0-picking-a-primitive)
1. [Fibers and lifetimes](#1-fibers-and-lifetimes)
2. [Scope and resources](#2-scope-and-resources)
3. [Concurrency combinators and coordination](#3-concurrency-combinators-and-coordination)
4. [State](#4-state)
5. [Queue and PubSub](#5-queue-and-pubsub)
6. [Streams](#6-streams)
7. [Scheduling and retry](#7-scheduling-and-retry)
8. [Timeouts](#8-timeouts)
9. [Caching](#9-caching)
10. [Request batching](#10-request-batching)
11. [ExecutionPlan: fallback across providers](#11-executionplan-fallback-across-providers)
12. [Durable queues: PersistedQueue](#12-durable-queues-persistedqueue)
13. [Trap checklist](#13-trap-checklist)

## 0. Picking a primitive

| Need | Use | Not |
|---|---|---|
| Run N independent effects in parallel | `Effect.forEach` / `Effect.all` with `{ concurrency }` | hand-forked fibers plus `joinAll` |
| Background loop owned by a service | `Effect.forkScoped` inside `Layer.effect` | `forkChild` (it dies with the constructor fiber), `setInterval` |
| Dynamic set of background jobs | `FiberSet` / `FiberMap` / `FiberHandle` | an array of fibers in a `Ref` |
| A one-shot signal or value handoff | `Deferred` | `Ref` polling |
| A gate that opens and closes | `Latch` | `Deferred` recreated in a loop |
| Bound concurrency across call sites | `Semaphore` (per tenant: `PartitionedSemaphore`) | counting in a `Ref` |
| Shared mutable value | `Ref`; effectful update: `SynchronizedRef`; observable: `SubscriptionRef` | `let` captured in closures |
| Multi-ref atomic update | `TxRef` + `Effect.tx` | two `Ref.update`s |
| Work queue for one consumer | `Queue` | `PubSub` |
| Fan-out to every subscriber | `PubSub` | multiple Queues |
| Pull-based sequence with backpressure | `Stream` | `AsyncIterable` loops |
| Pooled or ref-counted resources | `Pool`, `RcRef`, `RcMap`, `LayerMap` | a module-level `Map` |
| Memoize one effect | `Effect.cached*` | a `Promise \| undefined` field |
| Memoize a keyed lookup | `Cache` / `ScopedCache` | `Effect.cachedFunction` (gone in v4) |
| N lookups against a multi-key endpoint | `Request` + `RequestResolver` | manual dedup |
| Jobs that survive restarts | `PersistedQueue` (`effect/persistence`) | an in-memory Queue |

## 1. Fibers and lifetimes

### Fork variants

| v4 | v3 name | Lifetime |
|---|---|---|
| `Effect.forkChild` | `fork` | Child of the current fiber. **Interrupted when the parent finishes.** |
| `Effect.forkScoped` | same | Tied to the ambient `Scope` (adds `Scope` to R). |
| `Effect.forkIn(scope)` | same | Tied to an explicit scope. |
| `Effect.forkDetach` | `forkDaemon` | Global; nobody interrupts it. |

`Effect.forkAll` and `Effect.forkWithErrorHandler` are removed. All four variants take `{ startImmediately?: boolean, uninterruptible?: boolean | "inherit" }`, either data-first or curried (`eff.pipe(Effect.forkChild({ startImmediately: true }))`).

- Forks start **lazily** by default: the child is scheduled, not run. A parent that forks and then returns interrupts the child before it executes even one step. Probe: `Effect.forkChild(Effect.sync(() => ran = true))` as the last step of a program leaves `ran === false`. With `startImmediately: true` it runs.
- Fire-and-forget `forkChild` is almost always a bug. You probably want `forkScoped` (service lifetime), `forkIn(scope)`, `FiberSet.run`, or `forkDetach` (true daemon). `Effect.awaitAllChildren(eff)` waits for an effect's children before completing.
- Fiber ops: `Fiber.join` (fails with the fiber's error), `Fiber.await` (never fails; gives back an `Exit`), `Fiber.interrupt` (waits until the fiber has settled), `Fiber.joinAll` (fails fast but does not interrupt the rest), `Fiber.awaitAll`, `Fiber.interruptAll`, `Fiber.interruptAs(id)`, `Fiber.runIn(fiber, scope)`, `Fiber.getCurrent()`. Instance methods: `fiber.pollUnsafe()` (there is no `Fiber.poll`), `fiber.interruptUnsafe()` (fire-and-forget), `fiber.addObserver(cb)`. Fiber ids are plain numbers. A `Fiber` is not yieldable, so use `Fiber.join`.

### Unjoined failures go nowhere

The v4 runtime does not log a failed fiber that nobody joins. A failing `forkScoped` or `forkChild` fiber vanishes: no log, no stderr, no failed test. For every fork, decide who observes the `Exit`:

```ts
import { Effect, FiberSet, Schedule } from "effect"

declare const pollUpstream: Effect.Effect<void, Error>

// Option A: handle inside the fork, and give the loop a restart policy
export const supervised = pollUpstream.pipe(
  Effect.tapCause((cause) => Effect.logError("poller failed", cause)),
  Effect.retry(Schedule.spaced("5 seconds")),
  Effect.forkScoped
)

// Option B: FiberSet.join is a failure watchdog. It fails with the first child
// failure and never completes on success.
export const watchdog = Effect.scoped(Effect.gen(function*() {
  const set = yield* FiberSet.make<void, Error>()
  yield* FiberSet.run(set, pollUpstream)
  yield* FiberSet.run(set, pollUpstream)
  yield* FiberSet.join(set) // propagates the first failure to the parent
}))
```

Option C is to route the result into a `Deferred` with `Effect.exit` → `Deferred.done(d, exit)` and let some other fiber await it.

### FiberHandle / FiberMap / FiberSet

Scoped fiber collections (`make<A, E>()` requires `Scope`; pass the type parameters). The collection owns its fibers and interrupts all of them when its scope closes. Finished fibers remove themselves.

| | Holds | Key behavior |
|---|---|---|
| `FiberHandle` | 0 or 1 fiber | `run` interrupts the previous fiber (latest wins). `onlyIfMissing: true` keeps the existing one instead. |
| `FiberMap<K>` | one fiber per key | `run(map, key, eff)` replaces the fiber for that key. Also `remove`, `has`, `get`, `size`. |
| `FiberSet` | any number | `run`, `add`, `size`, `clear`. |

- `run` **starts immediately by default** (unlike `forkChild`). Pass `startImmediately: false` to defer it.
- `join` resolves only on the first failure (or fails with it). Use it as a watchdog, not as "wait for completion". `awaitEmpty` waits until all fibers are done (drain).
- `propagateInterruption: true` makes an interrupted child count as a failure for `join`.
- `FiberSet.runtime(set)<R>()` / `makeRuntime<R>()` returns a synchronous runner for callbacks from outside Effect (event handlers, framework hooks); `runtimePromise` / `makeRuntimePromise` return Promise runners. With `FiberHandle` this gives latest-wins semantics for UI events.
- Bounded admission belongs to `Effect.forEach({ concurrency })` or a `Semaphore` *inside* the forked effect. Don't `Semaphore.take` and then `FiberSet.run`, because an interruption in between leaks a permit.

```ts
import { Effect, FiberMap } from "effect"

declare const syncTenant: (tenant: string) => Effect.Effect<void>

export const program = Effect.scoped(Effect.gen(function*() {
  const jobs = yield* FiberMap.make<string>()
  yield* FiberMap.run(jobs, "acme", syncTenant("acme"))
  yield* FiberMap.run(jobs, "acme", syncTenant("acme")) // interrupts the first
  yield* FiberMap.run(jobs, "globex", syncTenant("globex"), { onlyIfMissing: true })
  yield* FiberMap.awaitEmpty(jobs) // drain
}))
```

### Interruption model

- Interruption is cooperative and asynchronous. It is delivered at the next effect boundary, and finalizers always run.
- `Effect.uninterruptible(eff)` / `Effect.uninterruptibleMask((restore) => …)` protect a region; `Effect.interruptible` re-enables interruption inside it. Use mask for "acquire uninterruptibly, use interruptibly".
- `Effect.onInterrupt((interruptors) => …)` runs only on interruption. `onExit` / `ensuring` run on every outcome.
- `race*` interrupts the losers and waits for them to finish. That includes losers still starting: their `onInterrupt` never ran because they never got to the point of installing it.
- Make two-step state transitions atomic: `Ref.set(current, none)` followed by `Scope.close(scope, Exit.void)` must be one `Effect.uninterruptible` step, otherwise an interrupt between them leaves state and resources out of sync.

### Keep-alive: use runMain

Probe at 4.0.0: a fiber suspended on `Deferred.await` under bare `Effect.runFork` **or** `Effect.runPromise` does not keep Node alive. The process exits about 2 ms later. (`migration/fiber-keep-alive.md` claims core keep-alive; the shipped `Runtime.ts` only installs the keep-alive `setInterval` inside `makeRunMain`.) Run entrypoints with `NodeRuntime.runMain` / `BunRuntime.runMain`. These also give SIGINT/SIGTERM → interrupt, exit codes, and error reporting. See `references/platform.md`.

## 2. Scope and resources

A `Scope` collects finalizers. Closing it runs them **LIFO and uninterruptibly**. If any finalizer fails, the rest still run and the failures combine into one Cause. In R, `Scope` means "this effect registers finalizers somebody must close".

| API | Use |
|---|---|
| `Effect.acquireRelease(acquire, (a, exit) => release, { interruptible? })` | Resource whose lifetime is the ambient scope (`interruptible: true` replaces v3 `acquireReleaseInterruptible`). |
| `Effect.acquireUseRelease(acquire, use, release)` | Bracket with no Scope in R. `release` gets the use `Exit` and may fail. |
| `Effect.acquireDisposable(eff)` | Wraps `Disposable` / `AsyncDisposable` values. |
| `Effect.addFinalizer((exit) => …)` | Register on the ambient scope. |
| `Effect.ensuring(fin)` / `Effect.onExit(f)` / `onExitIf` / `onExitFilter` / `onError` / `onErrorIf` / `onErrorFilter` / `onInterrupt` | Local finalization, no Scope involved. |
| `Effect.scoped(eff)` | Creates a scope, runs `eff`, closes it. Removes `Scope` from R. |
| `Effect.scopedWith((scope) => …)` | Hands you the scope without putting it in context. |
| `Effect.scope` | Reads the ambient scope (for example to hand it to something that outlives an inner `Effect.scoped`). |
| `Scope.make(strategy?)` / `Scope.fork(parent, strategy?)` | Return a `Scope.Closeable`. `"parallel"` runs finalizers concurrently. |
| `Scope.close(closeable, exit)` | Only a `Closeable` can be closed. An ambient `Scope.Scope` gives registration rights, not close rights. |
| `Scope.provide(scope)(eff)` | Provides a scope without closing it (v3 `Scope.extend`). `Scope.use(closeable)(eff)` provides and then closes. |
| `Scope.addFinalizer(scope, eff)` / `Scope.addFinalizerExit(scope, f)` | Register on an explicit scope. On an already-closed scope the finalizer **runs immediately** (probe-verified). `Scope.fork` of a closed parent gives a closed child. |

Rules:

- **Release must be an Effect that completes when cleanup does.** For async cleanup use `Effect.promise(() => client.close())` (or `tryPromise` + `orDie`). `Effect.sync(() => void client.close())` returns before cleanup finishes.
- **Placement of `Effect.scoped` is the lifetime.** Wrap acquire *and* use. Wrapping only the acquire closes the resource before you use it.
- Never split acquisition from finalizer registration across two yields (`const h = yield* open; yield* Effect.addFinalizer(...)`). An interrupt between the two leaks the handle. `acquireRelease` makes the pair atomic.
- Inside a long-lived loop, wrap each item in its own `Effect.scoped(handle(item))`. Otherwise per-item resources pile up on the daemon's scope until shutdown.
- Don't acquire per-request resources in a `Layer.effect` constructor. They release only when the layer's scope closes at shutdown.

```ts nocheck
// BUG: the connection is released before query runs
const conn = yield* Effect.scoped(openConnection)
yield* conn.query("select 1")
```

```ts
import { Effect } from "effect"

interface Conn { readonly query: (sql: string) => Effect.Effect<number>; readonly close: () => Promise<void> }
declare const connect: () => Promise<Conn>

const openConnection = Effect.acquireRelease(
  Effect.promise(() => connect()),
  (conn) => Effect.promise(() => conn.close()) // waits for real cleanup
)

export const program = Effect.scoped(Effect.gen(function*() {
  const conn = yield* openConnection
  return yield* conn.query("select 1")
})) // acquire + use + release in one scope
```

### Handing a resource to a background fiber

A detached fiber (`forkDetach`) has no scope of its own, so `Effect.scoped` inside it is fine for local work. Don't give a detached fiber resources that need to outlive the request that started it. Fork a child scope from a long-lived owner instead, and close it when the fiber exits:

```ts
import { Effect, Scope } from "effect"

declare const spawnProcess: Effect.Effect<{ readonly pid: number }, never, Scope.Scope>
declare const supervise: (proc: { readonly pid: number }) => Effect.Effect<void>

export const startManaged = (owner: Scope.Scope) =>
  Effect.gen(function*() {
    const child = yield* Scope.fork(owner)
    const proc = yield* spawnProcess.pipe(Scope.provide(child))
    yield* supervise(proc).pipe(
      Effect.onExit((exit) => Scope.close(child, exit)),
      Effect.forkIn(owner)
    )
    return proc
  })
```

This is the manual registry pattern for process handles and sockets: an owner scope (the service's layer scope) plus one child scope per handle. Closing the owner kills every handle; closing one child kills one.

### Pooled and ref-counted resources

| Module | Shape | Notes |
|---|---|---|
| `Pool.make({ acquire, size, concurrency?, targetUtilization? })` | fixed size | Needs `Scope`. `Pool.makeWithTTL({ acquire, min, max, timeToLive, timeToLiveStrategy? })` resizes. |
| `Pool.get(pool)` | `Effect<A, E, Scope>` | The item returns to the pool when *that* scope closes. |
| `Pool.use(pool, f)` | no Scope in R | The safe default. |
| `Pool.invalidate(pool, item)` | | Retire a broken item. |
| `RcRef.make({ acquire, idleTimeToLive? })` | one shared resource | `RcRef.get` needs `Scope`. Acquired on first get, released after the last user's scope closes (plus idle TTL). `invalidate` forces re-acquire. |
| `RcMap.make({ lookup, idleTimeToLive?, capacity? })` | one resource per key | `get` / `getOption` need `Scope`. `touch` resets the idle timer, `invalidate`, `has`, `keys`. With `capacity`, a new key past the limit fails with `Cause.ExceededCapacityError` (it appears in E). `idleTimeToLive` may be `(key) => Duration`. |
| `ScopedRef.make(() => a)` / `ScopedRef.fromAcquire(acq)` | swappable resource | `set(ref, acquire)` acquires the replacement first, keeps the old one if that fails, then releases the old one. Serialized. Use for rotating credentials or clients. |
| `Resource.manual(acq)` / `Resource.auto(acq, schedule)` | refreshable value | `Resource.get`, `Resource.refresh`. `auto` refreshes on the schedule. |
| `LayerMap.Service` / `LayerRef` | keyed or swappable *layers* | Per-tenant layer graphs with idle TTL. See `references/architecture.md`. |

`Effect.scoped(Pool.get(pool))` followed by using the item is the placement bug again. The item goes back to the pool (probe order: acquire, use, use2, release) and another fiber can take it while you still hold it. Use `Pool.use`.

```ts
import { Cause, Context, Effect, Layer, RcMap, Scope } from "effect"

class Checkouts extends Context.Service<Checkouts, {
  readonly checkout: (repo: string) => Effect.Effect<string, Cause.ExceededCapacityError, Scope.Scope>
}>()("@app/git/Checkouts") {
  static readonly layer = Layer.effect(this, Effect.gen(function*() {
    const map = yield* RcMap.make({
      lookup: (repo: string) =>
        Effect.acquireRelease(
          Effect.succeed(`/tmp/checkouts/${repo}`),
          (dir) => Effect.logInfo(`removing ${dir}`)
        ),
      idleTimeToLive: "5 seconds",
      capacity: 10
    })
    return { checkout: (repo: string) => RcMap.get(map, repo) }
  }))
}

// Two concurrent reviews share one checkout. Effect.scoped sits *after* the
// use, so the reference is held for the whole review.
export const program = Effect.gen(function*() {
  const git = yield* Checkouts
  const review = (label: string) =>
    git.checkout("acme/api").pipe(
      Effect.flatMap((dir) => Effect.logInfo(`${label} in ${dir}`)),
      Effect.scoped
    )
  yield* Effect.all([review("deps"), review("code")], { concurrency: "unbounded" })
}).pipe(Effect.provide(Checkouts.layer))
```

## 3. Concurrency combinators and coordination

### Collections

- `Effect.all(iterable | record, { concurrency?, discard?, mode? })` and `Effect.forEach(items, f, { concurrency?, discard? })` are **sequential by default**. Code that reads as parallel isn't. `concurrency: number | "unbounded"`. There is no `"inherit"` and no `Effect.withConcurrency` at 4.0.0, so pass the bound explicitly. Comment the load-bearing `{ concurrency }` so nobody deletes it as tuning.
- Results keep input order regardless of concurrency. `discard: true` returns `void`.
- `Effect.all` `mode: "default" | "result"`. `"result"` collects a `Result` per element instead of failing fast. The v3 `"either"` / `"validate"` modes are gone. Use `Effect.validate` (accumulates, fails with a non-empty array) or `Effect.partition` (`[passes, fails]`, never fails).
- `Effect.zip(a, b, { concurrent: true })` / `zipWith`: the option is `concurrent`, not `concurrency`. `zipLeft` / `zipRight` are gone; use `tap` / `andThen`.
- Also `Effect.replicateEffect`, `Effect.findFirst`, `Effect.filter` / `filterMapEffect` (take `concurrency`).
- Request batching only happens across fibers that run concurrently, so a sequential `forEach` never batches.

### Races

| API | Winner | Losers |
|---|---|---|
| `Effect.race(a, b)` / `Effect.raceAll(effs)` | first **success**. Fails only if all fail. | interrupted and awaited |
| `Effect.raceFirst(a, b)` / `Effect.raceAllFirst(effs)` | first **completion** (success or failure) | interrupted and awaited |
| `Effect.firstSuccessOf(effs)` | **sequential** fallback, not a race. Fails with the *last* error. | never started |

All `race*` take `{ onWinner: ({ fiber, index, parentFiber }) => void }`. Hedged request: `Effect.race(primary, Effect.delay(backup, "200 millis"))`.

### Coordination primitives

| Module | Construct | Ops | Notes |
|---|---|---|---|
| `Deferred<A, E>` | `Deferred.make<A, E>()` | `await`, `succeed`, `fail`, `failCause`, `die`, `interrupt`, `done(d, exit)`, `complete(d, eff)`, `completeWith`, `poll`, `isDone`, `into` | Write-once. Completing again returns `false`. Not yieldable: use `Deferred.await`. |
| `Latch` | `Latch.make(open?)` (starts closed) | `latch.await`, `open`, `close`, `release`, `whenOpen(latch, eff)`, `isOpen` | `release` wakes current waiters but leaves the latch closed. Use for pause/resume and startup barriers. |
| `Semaphore` | `Semaphore.make(n)` / `makeUnsafe(n)` | `sem.withPermits(k)(eff)`, `Semaphore.withPermit(sem, eff)`, `withPermitsIfAvailable` (returns `Option`), `take`, `takeIfAvailable`, `release`, `releaseAll`, `resize` | A smaller `take` can overtake a blocked larger one. |
| `PartitionedSemaphore<K>` | `PartitionedSemaphore.make<K>({ permits })` | `sem.withPermit(key)(eff)`, `withPermits(key, n)` | Round-robin fairness across keys (tenants). A request for more than `capacity` permits never completes. |

```ts
import { Effect, PartitionedSemaphore, Semaphore } from "effect"

declare const callApi: (tenant: string) => Effect.Effect<string>

export const program = Effect.gen(function*() {
  const global = yield* Semaphore.make(8)
  const fair = yield* PartitionedSemaphore.make<string>({ permits: 8 })

  const a = yield* global.withPermits(1)(callApi("acme"))
  const b = yield* fair.withPermit("globex")(callApi("globex"))
  return [a, b] as const
})
```

### Scheduler knobs

Fibers yield to the scheduler every `Scheduler.MaxOpsBeforeYield` ops (default 2048), so a race window two steps wide is almost never hit in tests. Sweep it with `Effect.provideService(Scheduler.MaxOpsBeforeYield, n)` for small n. `Scheduler.PreventSchedulerYield` disables yielding. These live in `Scheduler`, not `References`.

## 4. State

| Module | Use | Notes |
|---|---|---|
| `Ref<A>` | Atomic synchronous updates | `make`, `get`, `set`, `update`, `updateAndGet`, `getAndUpdate`, `modify(f: a => [b, a])`, `updateSome`/`modifySome` (`Option`), `getUnsafe`. Not yieldable: use `Ref.get`. |
| `SynchronizedRef<A>` | Updates that run an effect | Same API plus `*Effect` variants (`updateEffect`, `modifyEffect`, `getAndUpdateEffect`, …). Updates are serialized. **No longer a subtype of `Ref`**, so `Ref.get(syncRef)` doesn't typecheck. Use `SynchronizedRef.get`. |
| `SubscriptionRef<A>` | Current value plus a change stream | `SubscriptionRef.changes(ref)` is a **function** returning `Stream<A>`. It **replays the current value first**. Every `set` publishes, **even when the value is equal** (probe: set 0 on 0 emits `[0, 0, 1]`). Dedupe with `Stream.changes`. |
| `MutableRef<A>` | Plain synchronous cell, no Effect | `MutableRef.make`, `get`, `set`, `update`, `incrementAndGet`, `compareAndSet`, `toggle`. For internals and hot paths only. |
| `TxRef` + `Effect.tx` | Atomic multi-ref transactions | See below. |

`Context.Reference` + `Effect.provideService` replaces `FiberRef` for fiber-local configuration. See `references/primitives.md`.

### Transactions (STM replacement)

There is no `STM` monad. Tx data structures return ordinary `Effect`s. Wrap a block in `Effect.tx` and every Tx read and write inside commits atomically, or retries if a value it read changed underneath. Nested `Effect.tx` calls join the outer transaction. `Effect.txRetry` (requires the `Transaction` service, so only inside `tx`) blocks until a value it read changes. A Tx op outside `tx` is its own one-op transaction.

Modules: `TxRef`, `TxQueue`, `TxPubSub`, `TxDeferred`, `TxSemaphore`, `TxReentrantLock`, `TxHashMap`, `TxHashSet`, `TxChunk`, `TxPriorityQueue`, `TxSubscriptionRef`.

```ts
import { Effect, TxRef } from "effect"

export const transfer = (from: TxRef.TxRef<number>, to: TxRef.TxRef<number>, amount: number) =>
  Effect.tx(Effect.gen(function*() {
    const balance = yield* TxRef.get(from)
    if (balance < amount) return yield* Effect.txRetry // wait until `from` changes
    yield* TxRef.set(from, balance - amount)
    yield* TxRef.update(to, (n) => n + amount)
  }))
```

## 5. Queue and PubSub

`Mailbox` is gone. `Queue<A, E>` carries an error channel and can end.

### Queue

- Construct: `Queue.bounded<A, E>(n)` (backpressure: `offer` suspends), `dropping(n)` (drops new items), `sliding(n)` (drops old items), `unbounded()`, or `Queue.make({ capacity?, strategy? })`.
- Produce: `offer` (returns `boolean`), `offerAll`, `offerUnsafe` / `offerAllUnsafe` (synchronous, for callbacks).
- Terminate:
  - `Queue.end(q)` is graceful. Consumers drain the buffer, then `take` fails with `Cause.Done`. The queue must be typed `Queue<A, E | Cause.Done>`.
  - `Queue.fail(q, e)` / `failCause` end it with an error.
  - `Queue.interrupt(q)` stops new offers. Buffered items can still be taken, then the queue completes with interruption.
  - `Queue.shutdown(q)` discards the buffer immediately and resumes pending offers and takes. It returns `false` if the queue was already shut down or completed. `shutdownUnsafe` is the synchronous form.
  - `Queue.into(q)(eff)` completes the queue with an effect's result.
- Consume: `take`, `takeN(n)` (suspends until it has n items; can return fewer once ending), `takeBetween(min, max)`, `poll` (`Option`, never waits), `peek`, `collect` (drain to Done), `clear` (take everything currently buffered, possibly `[]`, never waits).
- **`Queue.takeAll` suspends on an empty queue** (it returns a `NonEmptyArray`). For "whatever is there now" use `clear` or `poll`. Queue has no `takeUpTo`; that is PubSub.
- `Queue.flush(q)` / `flushUnsafe` run the taker-release pass immediately after synchronous `offerUnsafe` calls instead of waiting for the scheduled pass. It does not end the queue.
- `Queue.await(q)` waits for the queue to finish. `size`, `isFull`, `asDequeue` / `asEnqueue` (narrow capabilities for APIs).
- `Pull.catchDone(f)` / `Pull.filterDone` / `Cause.isDone` handle the Done signal when you write pull loops by hand.

```ts
import { Cause, Effect, Queue } from "effect"

export const program = Effect.gen(function*() {
  const q = yield* Queue.bounded<number, Cause.Done>(16)
  yield* Queue.offerAll(q, [1, 2, 3])
  yield* Queue.end(q)
  return yield* Queue.collect(q) // [1, 2, 3]
})
```

### PubSub

- Construct: `PubSub.bounded<A>(n | { capacity, replay? })`, `dropping`, `sliding`, `unbounded({ replay? })`. `replay: n` lets late subscribers get the last n messages.
- `PubSub.publish` / `publishAll` / `publishUnsafe`.
- `PubSub.subscribe(p)` returns a `Subscription<A>` and **requires `Scope`**. It unsubscribes when the scope closes. Only messages published *after* the subscribe call returns are delivered (plus replay), so signal "ready" only after `subscribe` returns.
- Subscription reads: `PubSub.take`, `takeUpTo(sub, max)` (returns immediately, possibly `[]`), `takeBetween`, and `takeAll` (**suspends when empty**, the same trap as Queue).
- `PubSub.end(p, finalValue)` is graceful: a sticky terminal value that reaches current and late subscribers. Consumers stop with `Stream.takeUntil`. `PubSub.shutdown(p)` interrupts subscribers and drops the untaken tail; it is final cleanup, not the graceful signal.
- `Stream.fromPubSub(p)` (subscribes per stream run), `Stream.fromSubscription(sub)` (an existing subscription; it re-emits the sticky end value forever unless you `takeUntil`), `Stream.toPubSub`, `Stream.runIntoPubSub`. `Stream.fromQueue` does not accept a Subscription.

```ts
import { Context, Effect, Layer, PubSub, Stream } from "effect"

type OrderEvent = { readonly _tag: "Placed" | "Shipped"; readonly orderId: string }

export class OrderEvents extends Context.Service<OrderEvents, {
  readonly publish: (e: OrderEvent) => Effect.Effect<void>
  readonly subscribe: Stream.Stream<OrderEvent>
}>()("@app/orders/OrderEvents") {
  static readonly layer = Layer.effect(this, Effect.gen(function*() {
    const bus = yield* PubSub.bounded<OrderEvent>({ capacity: 256, replay: 50 })
    yield* Effect.addFinalizer(() => PubSub.shutdown(bus))
    return {
      publish: (e: OrderEvent) => PubSub.publish(bus, e).pipe(Effect.asVoid),
      subscribe: Stream.fromPubSub(bus)
    }
  }))
}
```

## 6. Streams

### Model

`Stream<A, E, R>` is a **pull-based** producer of **chunks** (non-empty arrays internally). Nothing runs until a `run*` pulls. Downstream demand drives upstream work, so backpressure is automatic, and finalizers of a source run when the consumer stops pulling (including after `take`). Concurrency operators (`mapEffect({ concurrency })`, `merge`, `flatMap({ concurrency })`) introduce internal buffers.

### Constructors

| Constructor | Notes |
|---|---|
| `Stream.make(...as)`, `fromIterable`, `fromArray`, `range(min, max)`, `iterate`, `succeed`, `empty`, `never`, `fail`, `die` | pure |
| `Stream.fromEffect(eff)`, `fromEffectDrain`, `fromEffectRepeat`, `fromEffectSchedule(eff, schedule)` | polling: `fromEffectSchedule` |
| `Stream.fromSchedule(schedule)`, `Stream.tick(duration)` | timers |
| `Stream.unfold(s, s => Effect<[a, s] \| undefined>)` | state machine |
| `Stream.paginate(s, s => Effect<[ReadonlyArray<A>, Option<S>]>)` | cursor APIs |
| `Stream.fromQueue(q)` (ends on `Cause.Done`), `fromPubSub`, `fromSubscription`, `fromPubSubTake` | |
| `Stream.callback<A, E>((queue) => Effect<unknown, E, R \| Scope>, { bufferSize?, strategy? })` | any callback API |
| `Stream.fromEventListener(target, type)` | DOM-style emitters |
| `Stream.fromAsyncIterable(it, onError)`, `fromReadableStream({ evaluate, onError })` | interop; Node streams via `NodeStream.fromReadable` (`references/platform.md`) |
| `Stream.unwrap(effect)`, `Stream.scoped`, `Stream.suspend` | build after acquiring services or resources |

`Stream.callback`: the buffer is **unbounded by default** (pass `bufferSize` + `strategy` for bounded). The function's returned effect is the *registration* step and runs once. Register the listener with `acquireRelease` so the stream's scope removes it. Emit with `Queue.offerUnsafe(queue, a)` and finish with `Queue.endUnsafe(queue)` or `Queue.failCauseUnsafe`.

```ts
import { Effect, Queue, Stream } from "effect"
import { EventEmitter } from "node:events"

export const ticks = (emitter: EventEmitter) =>
  Stream.callback<number>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const onTick = (n: number) => Queue.offerUnsafe(queue, n)
        const onEnd = () => Queue.endUnsafe(queue)
        emitter.on("tick", onTick).once("end", onEnd)
        return { onTick, onEnd }
      }),
      ({ onTick, onEnd }) => Effect.sync(() => emitter.off("tick", onTick).off("end", onEnd))
    ), { bufferSize: 1024, strategy: "sliding" })
```

### Operators worth knowing

- Transform: `map`, `mapEffect(f, { concurrency?, unordered? })`, `mapArray`, `flatMap(f, { concurrency? })`, `switchMap`, `filter`, `filterMap`, `filterEffect`, `tap`, `scan(() => s0, f)` / `scanEffect` (**lazy initial**), `mapAccum`, `changes` (dedupe consecutive), `zipWithIndex`, `zipWithPrevious`, `zipWithPreviousAndNext`, `intersperse`, `splitLines`, `decodeText` / `encodeText`, `as`.
- Slice: `take`, `takeWhile`, `takeUntil`, `drop`, `dropWhile`, `takeRight`, `haltWhen`, `interruptWhen`.
- Batch and time: `grouped(n)`, `groupedWithin(n, duration)`, `rechunk`, `debounce(d)`, `throttle({ cost, units, duration, burst?, strategy? })`, `aggregateWithin`, `buffer`, `sliding`, `timeout`, `schedule`.
- Combine: `merge(that, { haltStrategy? })`, `mergeAll`, `mergeResult`, `concat`, `zip` / `zipWith` / `zipLatest`, `interleave`, `cross`, `race`, `groupBy` / `groupByKey`.
- Errors: `catch`, `catchCause`, `catchTag(s)`, `catchIf`, `catchFilter`, `catchDefect`, `catchReason(s)`, `unwrapReason`, `tapError`, `tapErrorTag`, `tapDefect`, `tapCause`, `orElseSucceed`, `orDie`, `result`, `mapError`, `mapBoth({ onElement, onError })`, `retry(schedule)` (re-runs the stream from the start), `withExecutionPlan`.
- Lifecycle: `onStart`, `onFirst`, `onEnd`, `onExit`, `onError`, `ensuring`.
- `Stream.partition(filter, { capacity? })` takes a `Filter` (returns `Result`), gives `[passes, fails]` in an Effect that needs `Scope`, and has a default capacity of 16. Consume both sides concurrently or the slower side deadlocks the faster one.

### Fan-out: broadcast vs broadcastN vs share

All three need `Scope`, take a **required** `capacity` (`"unbounded"`, or a number plus `strategy`), and propagate the source's end or failure to every subscriber.

| | Returns | Producer starts | Use |
|---|---|---|---|
| `Stream.broadcast({ capacity, replay? })` | one `Stream` you can run many times | immediately. Late subscribers miss values unless `replay`. | hot multicast |
| `Stream.broadcastN({ n, capacity })` | a tuple of n streams | after all n subscribe | fixed consumer set |
| `Stream.share({ capacity, replay?, idleTimeToLive? })` | one `Stream` | lazily on first subscriber, ref-counted, stops after the last leaves (or after the idle TTL) | expensive shared upstream |

```ts
import { Effect, Stream } from "effect"

export const program = Effect.scoped(Effect.gen(function*() {
  const [audit, metrics] = yield* Stream.range(1, 100).pipe(Stream.broadcastN({ n: 2, capacity: 16 }))
  return yield* Effect.all([
    Stream.runCount(audit),
    Stream.runFold(metrics, () => 0, (acc, n) => acc + n)
  ], { concurrency: "unbounded" })
}))
```

### Running

- `runCollect` (finite streams and tests only), `runDrain`, `runForEach(f)`, `runForEachWhile`, `runForEachArray`, `runFold(() => z, f)` (lazy initial), `runFoldEffect`, `runCount`, `runSum`, `runHead` / `runLast` (`Option`), `run(sink)`, `runIntoQueue`, `runIntoPubSub`.
- Interop out: `toAsyncIterableEffect` (keeps R), `toAsyncIterable` (R = never), `toReadableStream` / `toReadableStreamEffect`, `toQueue`, `toPubSub`, `toPull`.
- A background consumer: `stream.pipe(Stream.runForEach(handle), Effect.forkScoped)` inside the owning layer.

### Sink, Channel, Pull

- `Sink<A, In, L, E, R>`: result first, then input, leftover, error, requirements. Constructors include `Sink.collect`, `count`, `sum`, `fold`, `forEach`, `head`, `last`, `take`, `reduce`, `fromQueue`, `fromPubSub`, `drain`, `timed`.
- `Channel` and `Pull` are for library authors writing new operators. Application code stays at `Stream`. `Pull.catchDone`, `Pull.filterDone`, and `Pull.isDoneCause` handle end-of-stream when working at that level. `Take` is the chunk/exit envelope for `toPubSubTake` / `fromPubSubTake`.

## 7. Scheduling and retry

### Schedule surface (complete at 4.0.0)

`Schedule<Output, Input, Error, Env>`. Predicates and callbacks receive `Metadata`: `{ input, output, attempt, start, now, elapsed, duration }`, where `duration` is the next delay.

| Group | Members |
|---|---|
| Constructors | `spaced(d)` (wait d after each run), `fixed(d)` (fixed wall-clock cadence), `exponential(base, factor = 2)`, `fibonacci(one)`, `recurs(n)`, `forever`, `once` (a value: one recurrence), `during(d)`, `duration(d)`, `windowed(d)`, `cron(expr \| Cron, tz?)`, `identity<A>()`, `fromStep`, `fromStepWithMetadata` |
| Combine | `max([a, b, …])` = AND: continue while **all** continue and wait the **slowest** delay. `min([a, b, …])` = OR: continue while **any** continues and wait the **fastest** delay. Both take a non-empty array and output a `Duration`. `concat(a, b)` / `concatResult` run a, then b. |
| Limit | `upTo({ times?, duration? })` (stops at whichever comes first), `while(meta => boolean \| Effect<boolean>)` (a refinement narrows input) |
| Shape | `jittered` (each delay × uniform 0.8–1.2), `addDelay(meta => Effect<Duration.Input>)`, `modifyDelay(meta => Effect<Duration.Input>)`, `map`, `tap(meta => Effect)`, `passthrough` (output = input), `setInputType<T>()` |
| Introspect | `toStep`, `toStepWithMetadata`, `toStepWithSleep`, `isSchedule`, `CurrentMetadata` (a Reference readable inside the retried effect) |

Not in 4.0.0: `both`, `either`, `andThen`, `take`, `union`, `intersect`, `compose`, `zipWith`, `tapInput`. (v3 `union` → `min`, `intersect` → `max`, `andThen` → `concat`, `take(n)` → `upTo({ times: n })`.)

```ts
import { Data, Duration, Effect, Schedule } from "effect"

class HttpError extends Data.TaggedError("HttpError")<{
  readonly status: number
  readonly retryAfterMs?: number
}> {}

declare const fetchProfile: Effect.Effect<string, HttpError>

// 250ms, 500ms, 1s … capped at 10s, jittered, at most 6 retries, only for 5xx/429
export const retryPolicy = Schedule.max([
  Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("10 seconds")]),
  Schedule.recurs(6)
]).pipe(
  Schedule.jittered,
  Schedule.setInputType<HttpError>(),
  Schedule.while(({ input }) => input.status >= 500 || input.status === 429),
  // honour Retry-After when the server sends one
  Schedule.modifyDelay(({ input, duration }) =>
    Effect.succeed(Duration.max(duration, Duration.millis(input.retryAfterMs ?? 0)))
  )
)

export const profile = fetchProfile.pipe(Effect.retry(retryPolicy))
```

### Effect.retry / Effect.repeat

- Forms: `Effect.retry(schedule)`, `Effect.retry({ schedule?, times?, while?, until? })` (predicates receive the error and may return an Effect), and a builder `Effect.retry(($) => $(Schedule.spaced("1 second")).pipe(Schedule.while(({ input }) => input.retryable)))`. The builder infers the schedule's `Input` from the effect's error, so you don't need `setInputType`. `Effect.repeat` has the same three forms over successes. Also `retryOrElse`, `repeatOrElse`, `Effect.schedule`, `Effect.scheduleFrom`, `Effect.eventually`, `Effect.forever`.
- **The effect runs once before the schedule is consulted.** `recurs(2)` and `{ times: 2 }` mean 3 runs (probe-verified). `repeat(eff, Schedule.once)` runs twice.
- `retry` retries typed failures only. Defects and interrupts pass through.
- `{ until }` / `{ while }` with no `schedule` or `times` re-runs with **no delay**, a busy loop. Always add a schedule.
- `Effect.repeat(eff, schedule)` returns the **schedule's output** (for `spaced` that is a count). The options form returns the effect's value.
- A refinement in `repeat({ until })` narrows the result type only when the options object has no `schedule` or `times` key (rc.118 change), since a bound can stop the repeat first. In `retry({ while: refinement })` the narrowing excludes the matched error type.
- Retry only idempotent, narrow operations, and classify errors first. Never retry auth, validation, quota, or not-found. Bound every retry and repeat (attempts and total time).
- HTTP: `HttpClient.retryTransient({ schedule, times?, … })` from `effect/http` already classifies transient errors and statuses. See `references/platform.md`.

```ts
import { Effect, Schedule } from "effect"

declare const jobStatus: Effect.Effect<{ readonly done: boolean }>

// poll every 2s, give up after ~1 min of polls
export const awaitJob = jobStatus.pipe(
  Effect.repeat({
    schedule: Schedule.spaced("2 seconds"),
    until: (s) => s.done,
    times: 30
  })
)
```

### Cron

`Cron.parse(expr, tz?)` → `Result<Cron, CronParseError>`, `Cron.parseUnsafe`, `Cron.make({ minutes, hours, days, months, weekdays, seconds?, tz? })`, `Cron.next(cron, now?)`, `Cron.prev`, `Cron.sequence` (iterator of dates), `Cron.match(cron, date)`, `Cron.format`. `Schedule.cron("0 */6 * * *", "Europe/Paris")` puts `CronParseError` in the schedule's error channel.

```ts
import { Effect, Schedule } from "effect"

declare const nightlyReport: Effect.Effect<void>

export const scheduled = nightlyReport.pipe(
  Effect.schedule(Schedule.cron("0 3 * * *", "UTC")), // error: CronParseError
  Effect.forkScoped
)
```

### Time

`Clock.currentTimeMillis`, `currentTimeNanos`, `monotonicTimeNanos`, `Clock.clockWith`. Read time through `Clock` (or `DateTime.now`) rather than `Date.now()` so TestClock controls it. Under `it.effect`, every sleep, timeout, and schedule is virtual and waits for `TestClock.adjust` (`references/testing.md`). `Duration.Input` accepts `"5 seconds"`, `"250 millis"`, numbers (millis), and `Duration` values.

## 8. Timeouts

| API | On timeout |
|---|---|
| `Effect.timeout(d)` | fails with `Cause.TimeoutError` (added to E). Check with `Cause.isTimeoutError`. |
| `Effect.timeoutOption(d)` | succeeds with `Option.none()` |
| `Effect.timeoutOrElse({ duration, orElse })` | runs `orElse` after interrupting the source |
| `Stream.timeout(d)` / `Stream.timeoutOrElse({ duration, orElse })` | ends the stream (or switches to `orElse`) when no element arrives within d |

There is no `timeoutFail` / `timeoutTo` in v4. The timed-out source is interrupted and its finalizers run.

Compose timeouts at the caller (`svc.call(x).pipe(Effect.timeout("2 seconds"))`) instead of threading `timeoutMs` parameters through service methods. The exception is when the ceiling is part of the method's contract and appears in its error type. Under TestClock a `timeout` guard is inert until the clock advances (`references/testing.md`).

## 9. Caching

| API | Shape | Caches failures? |
|---|---|---|
| `Effect.cached(eff)` | `Effect<Effect<A, E, R>>`: one memoized run | **Yes**, the first `Exit` including failures and interrupts. A timeout or race loss poisons it forever (probe: a failing lookup ran once for two reads). |
| `Effect.cachedWithTTL(eff, ttl)` | memo for ttl. `ttl` may be `(exit) => Duration.Input`. | Yes. Use the exit-based TTL to expire failures immediately. |
| `Effect.cachedInvalidateWithTTL(eff, ttl)` | `[cached, invalidate]` | Yes, but you can invalidate on failure. |
| `Cache.make({ lookup, capacity, timeToLive?, requireServicesAt? })` | keyed and LRU | **Yes**. The default TTL is `Duration.infinity`, so a transient failure is cached forever. |
| `Cache.makeWith(lookup, { capacity, timeToLive?: (exit, key) => Duration.Input })` | keyed, per-exit TTL | Configurable |
| `ScopedCache.make({ lookup, capacity, … })` / `ScopedCache.makeWith({ lookup, capacity, timeToLive?: (exit, key) => … })` | keyed values that hold resources (lookup may use `Scope`). Released on eviction or when the cache's scope closes. | Configurable |
| `PersistedCache.make(lookup, { storeId, timeToLive, inMemoryCapacity?, inMemoryTTL? })` (`effect/persistence`) | backed by `Persistence` (KeyValueStore, Redis, SQL). Keys are `Persistable` classes. | Configurable |

`Effect.cachedFunction` does not exist in v4. Use `Cache`.

Cache ops: `Cache.get`, `getOption` (waits for a pending lookup and replays a cached error), **`getSuccess` (never fails; `Option.none` for missing, pending, expired, or failed entries)**, `set`, `has` (does not affect LRU order), `invalidate`, `invalidateWhen(cache, key, pred)`, `invalidateAll`, `refresh` (serves the stale value while revalidating, not deduplicated), `size` (counts expired entries), and `keys` / `values` / `entries`. Concurrent misses on the same key share one lookup. That lookup survives one caller's interruption and is interrupted when the last waiter leaves.

`requireServicesAt: "lookup"` keeps the lookup's R on each `Cache.get` instead of capturing services at construction. Never `acquireRelease` inside a plain `Cache` lookup: the resource attaches to the caller's scope. Use `ScopedCache` for that.

```ts
import { Cache, Data, Effect, Exit } from "effect"

class FetchError extends Data.TaggedError("FetchError")<{ readonly id: string }> {}
declare const fetchUser: (id: string) => Effect.Effect<{ readonly name: string }, FetchError>

export const program = Effect.gen(function*() {
  const users = yield* Cache.makeWith(fetchUser, {
    capacity: 1_000,
    // success: 5 minutes; failure: expire immediately so the next get retries
    timeToLive: (exit) => Exit.isSuccess(exit) ? "5 minutes" : 0
  })
  return yield* Cache.get(users, "u_1")
})
```

A success-only memo of a single effect:

```ts
import { Duration, Effect, Exit } from "effect"

declare const loadConfig: Effect.Effect<{ readonly region: string }, Error>

export const makeLoader = Effect.gen(function*() {
  const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(loadConfig, Duration.infinity)
  // invalidate on failure so the next caller retries instead of replaying the error
  return cached.pipe(Effect.onExit((exit) => Exit.isSuccess(exit) ? Effect.void : invalidate))
})
```

Composite keys compare structurally (plain objects have structural equality in v4), but `Equal` / `Hash` results are cached per object, so never mutate a key.

## 10. Request batching

Use `Request` + `RequestResolver` only when the backend has a **real multi-key endpoint** (`WHERE id IN (…)`, a batch API). With per-item endpoints only, a bounded `forEach` plus a `Cache` is simpler. Batching needs no flag in v4. It happens whenever concurrent fibers issue requests to the same resolver within the resolver's delay window. Duplicate requests (structurally equal) are deduplicated.

- Requests: `class GetUser extends Request.Class<{ readonly id: number }, User, UserNotFound, never> {}`. Tagged variants: `Request.TaggedClass("GetUser")<…>`, or an interface plus `Request.tagged<GetUser>("GetUser")` / `Request.of<R>()`.
- Resolvers:
  - `RequestResolver.make<Req>((entries, key) => Effect<void, Request.Error<Req>>)`. **Complete every entry** with `entry.completeUnsafe(Exit.succeed(...) | Exit.fail(...))` (or `Request.complete` / `succeed` / `fail`). An entry left incomplete fails its waiting request.
  - `fromFunction` (sync, per entry), `fromFunctionBatched` (sync; returns results in entry order), `fromEffect` (per entry, effectful), and `fromEffectTagged<U>()({ Tag: (entries) => Effect<Iterable<A>> })` for a union of request types.
  - `makeGrouped({ key, resolver })` or `grouped(resolver, f)` split a batch by key, for example per tenant or per transaction. `makeWith({ batchKey, delay, collectWhile, runAll, preCheck? })` gives full control.
- Tuning: `setDelay(d)` / `setDelayEffect` (latency vs batch size), `batchN(n)` (max batch size), `withSpan(name)` (batch span plus links to each request span), `around(before, after)`, `race(that)`.
- Caching: `RequestResolver.withCache({ capacity, strategy?: "lru" | "fifo" })` **returns an Effect** (`yield*` it). `asCache({ capacity, timeToLive? })` turns a resolver into a `Cache`. `persisted({ storeId, timeToLive?, staleWhileRevalidate? })` needs `Persistence` + `Scope`.
- Issue requests with `Effect.request(new GetUser({ id }), resolver)`. The resolver may also be an `Effect<RequestResolver>`. Request services are available on `entry.context`.
- SQL: `SqlResolver.ordered` / `grouped` / `findById` / `void` in `effect/sql` build resolvers from queries (`references/platform.md`).

```ts
import { Effect, Exit, Request, RequestResolver, Schema } from "effect"

class User extends Schema.Class<User>("User")({ id: Schema.Int, name: Schema.String }) {}
class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", { id: Schema.Int }) {}

class GetUser extends Request.Class<{ readonly id: number }, User, UserNotFound> {}

declare const selectUsers: (ids: ReadonlyArray<number>) => Effect.Effect<ReadonlyArray<User>>

export const makeUsers = Effect.gen(function*() {
  const resolver = yield* RequestResolver.make<GetUser>((entries) =>
    Effect.gen(function*() {
      const rows = yield* selectUsers(entries.map((e) => e.request.id))
      const byId = new Map(rows.map((u) => [u.id, u]))
      for (const entry of entries) {
        const user = byId.get(entry.request.id)
        entry.completeUnsafe(user ? Exit.succeed(user) : Exit.fail(new UserNotFound({ id: entry.request.id })))
      }
    })
  ).pipe(
    RequestResolver.setDelay("5 millis"),
    RequestResolver.batchN(100),
    RequestResolver.withCache({ capacity: 1024 })
  )

  const getUser = (id: number) => Effect.request(new GetUser({ id }), resolver)
  // one selectUsers call with ids [1, 2, 3]
  return yield* Effect.forEach([1, 2, 1, 3], getUser, { concurrency: "unbounded" })
})
```

## 11. ExecutionPlan: fallback across providers

`ExecutionPlan.make(...steps)` describes "try this layer (n attempts, on this schedule, while this predicate holds), then the next". `Effect.withExecutionPlan(plan, { onEvent? })` runs an effect that requires the plan's services against each step in order. `Stream.withExecutionPlan` does the same for streams. Each step is `{ provide: Layer | Context, attempts?, schedule?, while? }`. `ExecutionPlan.merge(a, b)` concatenates plans. `plan.captureRequirements` moves the plan's requirements into construction. `ExecutionPlan.CurrentMetadata` exposes `{ attempt, stepIndex }`, and `onEvent` receives `AttemptStart` / `AttemptSuccess` / `AttemptFailure`. The canonical use is falling back between AI providers (`references/platform.md`), but the pattern fits any interchangeable infrastructure.

```ts
import { Context, Data, Effect, ExecutionPlan, Layer, Schedule } from "effect"

class ModelError extends Data.TaggedError("ModelError")<{ readonly retryable: boolean }> {}

class Model extends Context.Service<Model, {
  readonly complete: (prompt: string) => Effect.Effect<string, ModelError>
}>()("@app/ai/Model") {}

const primary = Layer.succeed(Model, { complete: () => Effect.fail(new ModelError({ retryable: true })) })
const fallback = Layer.succeed(Model, { complete: (p: string) => Effect.succeed(`fallback: ${p}`) })

const plan = ExecutionPlan.make(
  { provide: primary, attempts: 3, schedule: Schedule.exponential("200 millis"), while: (e: ModelError) => e.retryable },
  { provide: fallback }
)

export const answer = Effect.gen(function*() {
  const model = yield* Model
  return yield* model.complete("hello")
}).pipe(Effect.withExecutionPlan(plan)) // Effect<string, ModelError, never>
```

## 12. Durable queues: PersistedQueue

`PersistedQueue` from **`effect/persistence`** (RC-era posts import `effect/unstable/persistence`, which no longer exists) is a schema-typed job queue whose elements survive restarts. It has at-least-once delivery with per-element locks. Stores: `layerStoreMemory` (tests), `layerStoreRedis({ prefix?, pollInterval?, lockRefreshInterval?, lockExpiration? })` (needs `Redis.Redis`, for example `NodeRedis.layer`), `layerStoreSql({ tableName?, … })` (needs `SqlClient`). `PersistedQueue.layer` provides the `PersistedQueueFactory`. `layerCleanup({ interval?, timeToLive?, failedTimeToLive? })` prunes finished entries. The module is `@stability unstable`.

- `PersistedQueue.make({ name, schema, maxAttempts?, retrySchedule? })` → `PersistedQueue<A>`.
- `queue.offer(value, { id })` returns the id. Offering an existing id is a no-op, and dedup survives completion until cleanup removes the id. This is idempotent enqueue.
- `queue.take((value, { id, attempts }) => handler)`: success marks the element processed; failure re-queues it per `retrySchedule` until `maxAttempts`, then marks it failed. `attempts` is 1-based and counted when the element is claimed, so a crash still uses up an attempt. Elements that fail to decode are marked failed and skipped. `take` handles one element, so loop it with `Effect.forever` in a forked worker.
- Keep `lockRefreshInterval` well below `lockExpiration` (defaults are 30s and 90s). Otherwise a slow handler loses its lock and another worker runs the same job.
- Handlers must be idempotent (at-least-once delivery). For durable *orchestration* (steps, sleeps, signals) use `effect/workflow` instead.

```ts
import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { PersistedQueue } from "effect/persistence"

const PostJob = Schema.Struct({ postId: Schema.NonEmptyString, text: Schema.String })

export class PostsQueue extends Context.Service<PostsQueue, PersistedQueue.PersistedQueue<typeof PostJob.Type>>()(
  "@app/posts/PostsQueue"
) {
  static readonly layerNoDeps = Layer.effect(this, PersistedQueue.make({
    name: "posts",
    schema: PostJob,
    maxAttempts: 3,
    retrySchedule: Schedule.spaced("5 seconds")
  })).pipe(Layer.provide(PersistedQueue.layer))
  static readonly layerTest = this.layerNoDeps.pipe(Layer.provide(PersistedQueue.layerStoreMemory))
}

declare const process: (job: typeof PostJob.Type) => Effect.Effect<void, Error>

export const enqueue = Effect.gen(function*() {
  const queue = yield* PostsQueue
  yield* queue.offer({ postId: "041", text: "hello" }, { id: "post:041" }) // idempotent
})

export const worker = Effect.gen(function*() {
  const queue = yield* PostsQueue
  yield* queue.take((job) => process(job)).pipe(
    Effect.catchCause((cause) => Effect.logError("job failed", cause)), // keep the loop alive
    Effect.forever
  )
}).pipe(Effect.forkScoped)
```

## 13. Trap checklist

- `forkChild` as fire-and-forget: the child is interrupted when the parent ends, often before it starts.
- A fork whose `Exit` nobody observes: its failures are invisible.
- `FiberSet.join` used as "wait until done": it waits for the first *failure*. Use `awaitEmpty`.
- `Effect.runFork` / `runPromise` as the process entrypoint: Node exits under suspended fibers. Use `runMain`.
- `Effect.all` / `forEach` without `concurrency`: sequential.
- `Effect.scoped` wrapped around only the acquire (`Pool.get`, `RcMap.get`, `acquireRelease`).
- Async cleanup inside `Effect.sync`: the release returns before cleanup finishes.
- `Queue.takeAll` / `PubSub.takeAll` on an empty source: they suspend. Use `clear`, `poll`, or `takeUpTo`.
- `PubSub.shutdown` used as the graceful stop: it drops the tail. Use `end` (PubSub) or `Queue.end`.
- `SubscriptionRef.changes` assumed to emit only changes: it replays the current value and repeats equal sets.
- `Stream.partition` sides consumed sequentially past capacity: deadlock.
- `Schedule.recurs(n)` read as "n attempts": it means n + 1 runs.
- `repeat` / `retry` with `until` and no schedule: busy loop.
- `Effect.cached` / `Cache` with default TTL around a flaky lookup: the failure is cached.
- `RequestResolver.make` that skips an entry: that request fails. `withCache` returns an Effect.
- Retrying non-idempotent writes, or retrying auth, validation, or not-found errors.
- `Schedule.both` / `either` / `andThen` / `take`, `Effect.cachedFunction`, `Effect.timeoutFail`, `Effect.fork`, `forkDaemon`, `forkAll`, `Mailbox`, `STM`: none exist in 4.0.0.
