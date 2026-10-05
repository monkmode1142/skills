# Effect v4 root primitive catalog

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

The complete inventory of the root `effect` barrel: 138 namespace modules, the six functions
re-exported from `Function`, and the three `effect/testing` modules. "Primitive" here means a public
module, not every function inside it. Every entry is eligible whenever its semantics fit; words like
"low-level" describe the job, not an expertise tier. The other half of the public surface (the 19
sub-barrels such as `effect/http`, `effect/sql`, `effect/ai`) is in `references/modules.md`; treat the
two files as one capability surface.

Stability: everything here follows semver **except** modules or exports tagged `@stability unstable`,
which may change in a minor release (pin, review on upgrade, still use them when they fit). In the
root barrel that is `Arbitrary`, the network-address / HTTP-shaped schemas inside `Schema` (listed
under Schema below), and `effect/testing/TestSchema`. They are marked **(unstable)** inline.

Deltas vs the RC line (rc.112 → 4.0.0): **+`Arbitrary`** (moved from `effect/unstable/arbitrary`),
**+`ByteSize`**, **−`Encoding`** (split into `effect/encoding/{Base64,Base64Url,Hex,EncodingError}`;
`randomHex` → `Hex.random`). `FastCheck` is gone: `Arbitrary` is a native implementation with no
fast-check dependency, and `effect` 4.0.0 has zero runtime dependencies.

```ts
// Root barrel for everyday code; effect/testing and sub-barrels by area.
import { ByteSize, Effect, pipe } from "effect"
import { Base64 } from "effect/encoding"
import { TestClock } from "effect/testing"

const limit = pipe(ByteSize.mebibytes(5), ByteSize.format)
const header = Base64.encode("user:secret")

const waitsOneMinute = Effect.gen(function* () {
  yield* TestClock.adjust("1 minute")
  return { limit, header }
})
```

Deep module imports (`import * as Effect from "effect/Effect"`) resolve through the `./*` export and
are only worth it as a cold-start optimization for CLIs; the barrel is the house default.

## Contents

- [Root function building blocks](#root-function-building-blocks)
- [Effect, runtime, requirements, and execution](#effect-runtime-requirements-and-execution)
- [Concurrency, coordination, state, and resources](#concurrency-coordination-state-and-resources)
- [Transactions](#transactions)
- [Streams and incremental processing](#streams-and-incremental-processing)
- [Schema, codecs, generation, and contracts](#schema-codecs-generation-and-contracts)
- [Configuration and platform services](#configuration-and-platform-services)
- [Observability](#observability)
- [Domain values, control flow, and representation](#domain-values-control-flow-and-representation)
- [Collections and data structures](#collections-and-data-structures)
- [Functions, protocols, comparison, and formatting](#functions-protocols-comparison-and-formatting)
- [JavaScript primitive helpers](#javascript-primitive-helpers)
- [Type and protocol machinery](#type-and-protocol-machinery)
- [`effect/testing`](#effecttesting)
- [Alphabetical index](#alphabetical-index)

## Root function building blocks

Re-exported from `Function` so `import { pipe } from "effect"` works.

- `pipe` — sends a value through unary functions left to right. Use for data-last APIs and readable pipelines; prefer `value.pipe(...)` when the value is `Pipeable`.
- `flow` — composes functions left to right into a reusable function. Use when the pipeline itself, not a starting value, is the result.
- `identity` — returns its input. Use as a neutral callback or inference aid.
- `hole` — a typed placeholder that throws when evaluated. Use only while sketching to mark an unimplemented branch; never ship it.
- `absurd` — eliminates a `never`. Use in exhaustive-switch defaults to prove a branch is unreachable.
- `cast` — changes only the static type, no runtime check. Use sparingly where assignability is known but unprovable; decode with `Schema` when the value is untrusted.

`dual`, `constant`, `constVoid`, `tupled`, `memoize`, etc. live in the `Function` module (not root-exported).

## Effect, runtime, requirements, and execution

- `Effect` — lazy workflow `Effect<A, E, R>`: success, typed error, required services. The main API for composing, recovering, resource safety, concurrency, transactions (`Effect.tx`), and running.
- `Cause` — the full failure record (flat `reasons`: fail, die, interrupt) plus annotations and built-in errors (`NoSuchElementError`, `TimeoutError`, `UnknownError`, `Done`, …). Use when `E` alone loses information (defects, interruption, parallel failures).
- `Exit` — a finished result as data: `Success<A>` or `Failure<Cause<E>>`. Use to inspect, store, or pass an outcome across a boundary without throwing.
- `Fiber` — handle to a running/finished lightweight execution. Use to join, await, or interrupt forked work; prefer `FiberHandle`/`FiberMap`/`FiberSet` or `forkScoped` over hand-managed fibers.
- `FiberHandle` — scoped owner of at most one fiber; starting a new one can interrupt the old. Use for a restartable single background task.
- `FiberMap` — scoped map of fibers by key, auto-removed on completion, interrupted with the scope. Use for per-key background work (per connection, per job id).
- `FiberSet` — scoped set of fibers interrupted together. Use for a dynamic group of anonymous workers; `FiberMap` when you need keyed replace/cancel.
- `Context` — typed map of service implementations. `Context.Service` declares a required capability; `Context.Reference` a capability with a default value (replaces v3 `FiberRef`).
- `References` — the runtime's built-in `Context.Reference` keys (log level, log annotations/spans, loggers, tracer settings, …; scheduler knobs live in `Scheduler`). Use to read or locally override fiber behaviour.
- `Layer` — recipe `Layer<ROut, E, RIn>` that acquires and wires services, memoized by default. Use at dependency/resource-lifecycle boundaries; `Layer.launch` for layer-only apps.
- `LayerMap` — keyed cache of layer-built contexts with idle release and invalidation. Use for tenant/region/connection-keyed service graphs; `RcMap` when the per-key thing is one value rather than a `Context`.
- `LayerRef` — one refreshable, cached layer-built context that can be invalidated and rebuilt. Use for a single shared service graph that must be swappable (credential rotation, reconnect).
- `ManagedRuntime` — builds a layer once, runs many effects against it, disposes resources. Use to bridge Effect into foreign frameworks (React, Express handlers, callbacks); use `runMain` for an Effect-owned process.
- `Runtime` — `Teardown`, `defaultTeardown`, `makeRunMain`, `errorExitCode`/`getErrorExitCode`, `errorReported`/`getErrorReported` only (v3 `Runtime<R>` is gone; use `Effect.runForkWith(context)` / `Effect.context<R>()`). Use when writing a platform `runMain`; otherwise use `NodeRuntime.runMain` etc.
- `Scope` — a lifetime that owns finalizers; `Scope.close` needs a `Scope.Closeable` from `Scope.make`/`fork`. Use when lifetimes must be created or passed explicitly; `Effect.scoped`, `acquireRelease`, and `Layer` cover most cases.
- `Effectable` — prototype builder, base class, and mixin for values that are yieldable as Effects. Use when authoring a custom Effect-aware type (service keys, config descriptors).
- `ExecutionPlan` — ordered fallback steps, each providing a `Context`/`Layer` with attempts, schedules, and predicates. Use for primary→fallback provider chains (e.g. model A then model B) via `Effect.withExecutionPlan` / `Stream.withExecutionPlan`; `Effect.retry` when the environment does not change between attempts.
- `Request` — typed description of one logical data request (success, error, requirements). Use with `Effect.request` to get batching, dedup, and caching via a resolver.
- `RequestResolver` — collects pending `Request`s, batches/groups them, runs backend work, completes entries. Use at a data-source boundary to solve N+1; `SqlResolver` in `effect/sql` for SQL.
- `Schedule` — composable recurrence policy (output + delay per step). Use with `retry`, `repeat`, streams. Combinators are `max` (both), `min` (either), `concat`, `upTo`, `while`; there is no `both/either/andThen/take`.
- `Cron` — parsed cron expressions with seconds and time zones; `match`, `next`. Use for wall-clock calendars (`Schedule.cron`); `Schedule.spaced/fixed` for workflow-relative timing; `ClusterCron` for cluster-wide single-owner jobs.
- `Clock` — service for wall-clock time, monotonic time, and sleep. Use instead of `Date.now()`/`setTimeout` so `TestClock` can control it.
- `Scheduler` — how runnable fiber tasks are dispatched and when fibers yield (`MixedScheduler`, yield tuning references). Use for runtime tuning or hosts that own dispatch; rarely touched by apps.
- `Random` — replaceable, seedable pseudo-random service. Use for testable randomness; `Crypto` for security-sensitive values.

## Concurrency, coordination, state, and resources

- `Deferred` — one-shot result many fibers can await. Use for a single handoff, ready signal, or result fan-out; `Latch` for a reusable gate.
- `Latch` — reusable open/closed gate (`await`, `whenOpen`, `open`, `close`, `release`). Use to pause/resume groups of fibers repeatedly.
- `Semaphore` — async permit counter with `withPermits`, non-waiting `withPermitsIfAvailable`, and `resize`. Use to cap concurrent access or as a mutex (1 permit).
- `PartitionedSemaphore` — one permit pool shared fairly across partition keys. Use when tenants/keys share a global limit and one hot key must not starve others; plain `Semaphore` when there is a single class of work.
- `Queue` — async point-to-point channel; each item goes to one consumer; bounded/dropping/sliding/unbounded; completes or fails. Use for work distribution and backpressure; `PubSub` for broadcast.
- `PubSub` — fan-out: every active subscriber gets each message, optional replay. Use for events/broadcast; `Queue` when consumers compete.
- `Pool` — scoped pool of distinct reusable resources (fixed or TTL-sized). Use for connections/clients borrowed and returned.
- `RcMap` — reference-counted scoped resources per key, released after the last borrower (optional idle TTL, capacity). Use for one shared client/session per key; not a value cache (use `Cache`).
- `RcRef` — one lazily acquired, reference-counted scoped resource with `invalidate`. Use to share a single expensive resource while anyone holds it.
- `Cache` — keyed memoization of Effect results with in-flight dedup, capacity, TTL (failures cached too unless TTL says otherwise). Use for computed values; `ScopedCache` when entries own resources; `PersistedCache` (`effect/persistence`) across restarts.
- `ScopedCache` — cache whose entries own scopes, finalized on expiry/eviction/invalidation. Use for keyed cached handles/connections.
- `Resource` — a scoped value kept in memory and refreshed manually or on a schedule. Use for push/background refresh of one value (config, token); `Cache` for on-demand keyed lookup.
- `Ref` — fiber-safe mutable cell with atomic pure updates. Use for shared state whose transitions are synchronous.
- `SynchronizedRef` — `Ref` whose updates are serialized and may run Effects. Use when computing the next state performs effects.
- `SubscriptionRef` — synchronized state plus a `changes` stream of current value and every update. Use when other fibers must observe changes; `TxSubscriptionRef` for transactional observers.
- `ScopedRef` — holds a value together with the scope that owns it; replacing it acquires the new one and releases the old. Use for hot-swapping clients/handles.
- `MutableRef` — synchronous mutable cell outside Effect. Use for local hot paths or internals owned by one fiber; `Ref` when shared across fibers.

## Transactions

All `Tx*` values are read and written inside `Effect.tx(...)`; a blocked operation retries the whole
transaction (`Effect.txRetry`). Reach for them when several pieces of state must change atomically or
wait on each other; use `Ref`/`Queue`/etc. when a single cell suffices.

- `TxRef` — the basic transactional cell. Use when several reads/writes must become visible together.
- `TxChunk` — transactional `Chunk`. Use for an ordered collection updated atomically with other Tx state.
- `TxDeferred` — write-once transactional `Result`; awaiting retries until completed. Use when waiting and completion compose with other Tx changes.
- `TxHashMap` — transactional `HashMap`. Use for atomic registries, indexes, counters.
- `TxHashSet` — transactional `HashSet`. Use for atomic membership checks plus related updates.
- `TxPriorityQueue` — transactional queue ordered by an `Order`; `peek`/`take` retry when empty. Use for priority scheduling coordinated with other state.
- `TxPubSub` — transactional broadcast. Use when publishing must be atomic with other Tx updates.
- `TxQueue` — transactional queue with `TxEnqueue`/`TxDequeue` views, completion, failure. Use when offer/take and related state commit or retry together.
- `TxReentrantLock` — transactional read/write lock with per-fiber reentrancy. Use for shared/exclusive access coordinated with transactions.
- `TxSemaphore` — transactional permits. Use when permit acquire/release must commit with other Tx changes.
- `TxSubscriptionRef` — transactional state plus subscriptions that see only committed values. Use for observable Tx state.

## Streams and incremental processing

- `Stream` — lazy pull-based `Stream<A, E, R>` with backpressure, resources, errors, concurrency. Use for many values over time; `Effect` for one.
- `Channel` — the engine under streams and sinks (typed input, output, error, done). Use to write custom stream operators or protocols; `Stream`/`Sink` otherwise.
- `ChannelSchema` — Schema encode/decode at channel boundaries, including duplex wrapping. Use when a channel's wire chunks differ from app values (e.g. `Ndjson` + schema).
- `Sink` — consumer producing one result, possibly with leftovers. Use for folds, collection, parsing, staged consumption; also platform byte sinks (stdout).
- `Pull` — one low-level pull: emit, fail with `E`, or finish with `Cause.Done`. Use in stream implementations where completion must not look like failure.
- `Take` — stored pull result: non-empty batch, failure `Exit`, or done `Exit`. Use when pull results travel through queues.

## Schema, codecs, generation, and contracts

Full Schema usage is in `references/schema.md`; this is the module map.

- `Schema` — validated types, decoding/encoding, transformations, classes (`Class`, `TaggedClass`, `TaggedError`, `Error`), checks, defaults, JSON Schema, Standard Schema, equivalence, optics, differs. The source of truth at every untrusted or serialized boundary.
  - **(unstable) parts of `Schema`:** HTTP-shaped schemas `Cookie`, `Cookies`, `Headers`, `UrlParams`, `RecordFromCookies`, `RecordFromUrlParams`, `JsonFromUrlParamsField` (moved here from `effect/http`); network-address schemas `Ipv4Address`, `Ipv6Address`, `IpAddress`, `MacAddress`, `SocketAddress`, `UnixPathAddress`, `Ipv4Network`, `IpNetwork`, `IpInterface`, the `Ipv4Private`/`Loopback`/`Multicast`/`LinkLocal`/`Unicast`/`Unspecified`/`Broadcast`/`Ipv6UniqueLocal`/`Mac*` variants, and their `…FromString` codecs (values live in `effect/net`).
- `SchemaAST` — the runtime tree behind every schema (declarations, unions, checks, encodings, `toType`, `flip`). Use for compilers, introspection, and tooling; `Schema` for defining/applying.
- `SchemaGetter` — one-direction (optional, effectful) conversions used by `decodeTo`/`encodeTo`, incl. `transformEffect`. Use to implement a custom decode or encode direction.
- `SchemaIssue` — structured parse/validation failures with paths, guards, formatters. Use to inspect or render why decoding failed.
- `SchemaParser` — runners returning Effect, Promise, Exit, Option, Result, or sync, plus effectful makers. Use when you need a runner shape beyond `Schema.decode*`/`encode*`.
- `SchemaRepresentation` — open representation protocol powering JSON Schema import/export (Draft-04/07/2020-12, OpenAPI 3.0/3.1), TypeScript code generation, and AI structured output. Use when extending Schema with a custom compiler/representation.
- `SchemaTransformation` — reusable two-way conversions and middleware (`transform`, `transformEffect`, `makeTransformation`). Use to build custom codecs between encoded and decoded forms.
- `StandardSchema` — vendored `@standard-schema/spec` 1.1.0 types. Use to type adapters; expose an Effect schema with `Schema.toStandardSchemaV1`.
- `JsonSchema` — dialect-neutral JSON Schema documents: `fromSchemaDraft07/2020_12/OpenApi3_0/3_1`, `toDocumentDraft04/07`, `toMultiDocumentOpenApi3_1`. Use when consuming/emitting schema documents; `Schema.toJsonSchemaDocument` to derive one from a schema.
- `JsonPatch` — RFC 6902 subset: `get(old, new)` computes a patch, `apply` replays it. Use to ship or replay structural JSON changes; `Schema.toDifferJsonPatch` gives a typed `Differ`.
- `JsonPointer` — RFC 6901 token escaping and URI-fragment conversion. Use when building JSON Pointer / JSON Patch paths from data.
- `Arbitrary` **(unstable)** — native property-based testing: `Arbitrary.schema(S)` derives a shrinking generator from a Schema, `checkEffect`/`sampleEffect` run or sample, `map`/`flatMap`/`filter`/`all`/`array`/`Constant` compose. Use for property tests (with `@effect/vitest` `it.prop`/`it.effect.prop`); depend on `fast-check` directly only for APIs it lacks. `Schema.toArbitrary` and `FastCheck` no longer exist.

## Configuration and platform services

Platform services are interfaces here; implementations come from `@effect/platform-*` layers (see
`references/platform.md`), e.g. `NodeServices.layer` provides `ChildProcessSpawner | Crypto |
FileSystem | Path | Stdio | Terminal`.

- `Config` — typed descriptions of settings (keys, decoding, defaults, nesting); a `Config` is yieldable. Constructors are PascalCase (`Config.String`, `Config.Port`, `Config.Redacted`, …). Use to declare configuration; read secrets with `Config.Redacted`.
- `ConfigProvider` — raw sources: env, objects, `.env` (`fromDotEnv`), directories; composition and path mapping; installed via layer. Use to choose/compose where `Config` reads from (and to fake config in tests).
- `Console` — Effect wrappers for console methods with scoped group/timer helpers. Use for user-facing CLI output that tests can capture (`TestConsole`); `Effect.log*`/`Logger` for observability.
- `FileSystem` — cross-platform file/dir I/O, streams, sinks, metadata, watching, temp files; `layerNoop` for fakes. Use instead of `node:fs`; provided by `NodeFileSystem.layer`/`BunFileSystem.layer`.
- `Path` — injected path manipulation (join, resolve, file URLs); ships a built-in POSIX `Path.layer`. Use instead of `node:path` in portable code.
- `Stdio` — arguments as an Effect, stdin as a byte `Stream`, stdout/stderr as `Sink`s; `layerTest`. Use for portable CLI I/O instead of `process.*` handles.
- `Terminal` — interactive terminal: dimensions, `readLine`, key events, display, `QuitError`. Use for prompts/TUIs (what `effect/cli` `Prompt` runs on); `Stdio` for plain stream I/O.
- `Crypto` — platform-neutral secure random bytes/numbers, `randomUUIDv4`, `randomUUIDv7`, `randomULID`, shuffling, SHA digests. Use for security-sensitive randomness and ids; `Random` for testable non-secure randomness.
- `PlatformError` — normalized host failures (`BadArgument` vs `SystemError` with module/method/path/cause). Use when handling filesystem, terminal, socket, process, crypto failures.

## Observability

- `Logger` — turns runtime log events into output; formatting, batching, routing; `Logger.layer([...])` installs loggers. Use to change where/how `Effect.log*` goes; `OtlpLogger` (`effect/observability`) to export.
- `LogLevel` — level literals, ordering, thresholds, `isEnabled`. Use to configure or filter logging (`References.MinimumLogLevel`).
- `Metric` — counters, gauges, frequencies, histograms, summaries, timers, snapshots, runtime metrics. Use for process measurements; export with `OtlpMetrics` or `PrometheusMetrics`.
- `Tracer` — span/parent/link/tracer service model and propagation settings. Use for custom tracing integrations; create spans with `Effect.fn("Name")` / `Effect.withSpan`.
- `ErrorReporter` — forwards non-interruption `Cause`s to callbacks (Sentry, logs) via `Effect.withErrorReporting`, `report`, built-in boundaries; `ErrorReporter.layer([...])`; ignore/severity/attribute markers on errors. Use for application-wide error tracking instead of ad-hoc `tapCause` logging.

## Domain values, control flow, and representation

- `Data` — `Class`, `TaggedClass`, `TaggedEnum`/`taggedEnum`, `Error`, `TaggedError` with structural equality. Use for in-process domain values and errors that never need encoding; `Schema.Class`/`Schema.TaggedError` when they cross a wire.
- `Match` — typed pattern matching on values, tags, predicates, shapes with exhaustiveness. Use when `switch` on `_tag` gets brittle or you want reusable matchers.
- `Option` — `Some`/`None`, `Option.gen`, nullable conversions (`fromNullishOr`). Use when absence is a normal answer; not yieldable in `Effect.gen` (bridge with `Effect.fromOption`).
- `Result` — plain `Success`/`Failure` data (v3 `Either`). Use for pure computations with error details; not yieldable in `Effect.gen` (bridge with `Effect.fromResult`); Effect's `E` channel when work is effectful.
- `Brand` — compile-time nominal labels, optionally with validating constructors (`Brand.check`). Use to keep structurally identical ids/scalars apart; `Schema.brand` at decode boundaries.
- `Newtype` — zero-cost compile-time wrappers with `value`, `makeIso`, and instance helpers (`makeEquivalence`, `makeOrder`, `makeCombiner`, `makeReducer`). Use when you want a nominal type plus reusable carrier instances and optics; `Brand` for a simple refinement label.
- `Redacted` — wraps secrets so string/JSON/inspect output shows a placeholder; `value`, `wipeUnsafe`. Use for every secret held in memory (`Config.Redacted`, `Schema.Redacted`).
- `Redactable` — protocol for context-dependent safe rendering. Use when a domain type must mask itself differently in logs/traces vs trusted output.
- `DateTime` — instants, UTC/zoned values, time zones, arithmetic, formatting, `DateTime.now`. Use instead of `Date` for explicit, testable time.
- `Duration` — finite/infinite spans; accepts inputs like `"5 seconds"`. Use for delays, timeouts, TTLs.
- `ByteSize` — exact non-negative byte counts with SI and IEC units (`kilobytes`, `mebibytes`, …), parsing (`fromString`), arithmetic, `format`. Use for sizes/limits (upload caps, buffers) instead of bare numbers with ambiguous units; `Schema.ByteSize*` to decode them.
- `BigDecimal` — arbitrary-precision decimals (bigint digits + scale). Use for money/quantities where float rounding is unacceptable.

## Collections and data structures

- `Array` — pure helpers for arrays and non-empty arrays (`partition` takes a `Result`-returning filter and returns `[passes, fails]`). Use for ordinary in-memory lists.
- `Chunk` — immutable sequence with efficient append/prepend/concat. Use in streaming code or for persistent updates; `Array` otherwise.
- `HashMap` — immutable map keyed by `Equal`/`Hash`. Use for structurally keyed persistent maps; `Map` when keys are primitives and mutation is local.
- `HashSet` — immutable set using `Equal`/`Hash`. Use for persistent set algebra with structural membership.
- `MutableHashMap` — in-place map mixing reference keys and `Equal`-hashed keys. Use for owned internal state where mutation is intentional.
- `MutableHashSet` — in-place set with Effect equality. Use for owned mutable membership.
- `MutableList` — mutable linked list with fast append/prepend/drain. Use for internal queues/buffers that need no fiber coordination.
- `Record` — immutable helpers for string/symbol-keyed objects. Use for dictionary transforms preserving key types.
- `Struct` — immutable helpers for typed objects (pick, omit, assign, rename, evolve, derived instances). Use for plain object reshaping outside Schema.
- `Tuple` — position-preserving helpers for fixed-length arrays. Use when position matters and `Array` helpers would widen types.
- `Trie` — immutable string prefix tree (prefix and longest-prefix lookup). Use for autocomplete, route/command tables.
- `Graph` — immutable and scoped-mutable directed/undirected graphs with traversal, analysis, shortest paths, Mermaid/GraphViz export. Use for explicit node/edge problems (dependency graphs, routing).
- `HashRing` — weighted consistent hashing over `PrimaryKey` nodes. Use to route keys/shards to nodes with minimal remapping.
- `Iterable` — lazy helpers over any iterable. Use when you should not materialize an array first.
- `NonEmptyIterable` — type-level non-empty iterable. Use in APIs that need a safe first element.

## Functions, protocols, comparison, and formatting

- `Function` — `pipe`, `flow`, `dual`, `identity`, constants, `memoize`, type-level helpers. Use `dual` to build APIs callable data-first and data-last.
- `Pipeable` — the `.pipe(...)` protocol and helpers. Use when your custom type should chain like Effect types.
- `Predicate` — boolean checks and `Refinement`s with combinators. Use for synchronous guards; `Filter` when the check must carry a failure branch or transform.
- `Filter` — `Filter<In, Pass, Fail>` returning a `Result`; can narrow/transform; built from predicates, options, effects. Use with `Effect.catchFilter`, `Array.partition`, and other APIs that take filters.
- `Equal` — structural equality protocol and `equals`. Use for value equality and custom equality-aware types.
- `Equivalence` — a reusable equality function for one type. Use when an API needs a comparison strategy independent of `Equal`.
- `Hash` — non-cryptographic hashing and the hash protocol symbol. Use when implementing `Equal` types for hashed collections; `Crypto` for cryptographic digests.
- `Order` — total orderings with combinators, `min`/`max`/`clamp`/`isBetween`. Use wherever values sort or compare.
- `Ordering` — the `-1 | 0 | 1` result with helpers. Use when implementing or combining `Order`s.
- `Combiner` — merge two values of one type (no empty value). Use for peer merges (min, max, first, last).
- `Reducer` — `Combiner` + `initialValue` + `combineAll`. Use when zero-or-more values fold to one (sums, concatenation).
- `Differ` — interface for diff/combine/apply of typed patches (`Schema.toDifferJsonPatch` produces one). Use for incremental state sync or change propagation.
- `Optic` — immutable lenses/prisms/traversals over fields, variants, optional values, collections. Use for composable nested reads/updates (also derivable from schemas).
- `PrimaryKey` — protocol exposing a stable string identity. Use for values consumed by persistence, caching, cluster routing, `HashRing`.
- `Inspectable` — stable `toJSON`/`toString`/Node `inspect` protocols. Use so custom values print well in logs.
- `Formatter` — `format`/`formatJson` for arbitrary values with redaction and cycle handling, plus a `Formatter` callable type. Use for diagnostics and error messages instead of `JSON.stringify`.

## JavaScript primitive helpers

- `BigInt` — guards, arithmetic, Option-returning parsing/conversion, instances. Use when integers exceed safe `number` range.
- `Boolean` — guards, lazy branching, logical combinators, `every`/`some`, instances. Use for pipe-friendly boolean logic.
- `Number` — guards, parsing, safe division, ranges, clamp, rounding, instances. Use for pipe-friendly numeric work.
- `String` — immutable string ops with Option-returning search/access. Use for typed text transforms.
- `RegExp` — native constructor, guard, `escape`. Use when building patterns from data.
- `Symbol` — `isSymbol` guard. Use to narrow `unknown` to a symbol.
- `UndefinedOr` — helpers for `A | undefined` without allocating an `Option`. Use at plain-JS boundaries where `undefined` already means absent.

## Type and protocol machinery

- `HKT` — `TypeLambda`/`Kind` higher-kinded encoding. Use when writing generic code over container shapes.
- `Types` — utility types (exactness, tagged unions, variance, concurrency option types). Use for type-level contracts in public APIs.
- `Unify` — protocol that collapses unions of Effect-aware types (`Unify.unify`). Use when a public API returns unions that should infer as one Effect-like type.
- `Utils` — generator (`Gen`, `SingleShotGen`) and variance protocol helpers. Use only when implementing Effect-aware abstractions; it is not a general utility bag.

## `effect/testing`

`import { TestClock, TestConsole, TestSchema } from "effect/testing"`. `@effect/vitest` `it.effect`
already provides `TestClock`, `TestConsole`, and a `Scope` (see `references/testing.md`).

- `TestClock` — virtual time: `adjust`, `setTime`, `withLive`. Use to test sleeps, retries, schedules, and timeouts instantly; fork the effect under test, then adjust.
- `TestConsole` — capturing `Console` with `logLines`/`errorLines` and a `layer`. Use to assert CLI output.
- `TestSchema` **(unstable)** — `Asserts`, `Decoding`, `Encoding` helpers incl. `succeedEffect`, `failEffect`, `verifyRoundTrip` (renamed from `verifyLosslessTransformation`), `verifyRoundTripEffect`. Use when unit-testing schemas and codecs.

## Alphabetical index

All 138 root modules, for "does X exist?" lookups:

`Arbitrary` `Array` `BigDecimal` `BigInt` `Boolean` `Brand` `ByteSize` `Cache` `Cause` `Channel`
`ChannelSchema` `Chunk` `Clock` `Combiner` `Config` `ConfigProvider` `Console` `Context` `Cron`
`Crypto` `Data` `DateTime` `Deferred` `Differ` `Duration` `Effect` `Effectable` `Equal` `Equivalence`
`ErrorReporter` `ExecutionPlan` `Exit` `Fiber` `FiberHandle` `FiberMap` `FiberSet` `FileSystem`
`Filter` `Formatter` `Function` `Graph` `Hash` `HashMap` `HashRing` `HashSet` `HKT` `Inspectable`
`Iterable` `JsonPatch` `JsonPointer` `JsonSchema` `Latch` `Layer` `LayerMap` `LayerRef` `Logger`
`LogLevel` `ManagedRuntime` `Match` `Metric` `MutableHashMap` `MutableHashSet` `MutableList`
`MutableRef` `Newtype` `NonEmptyIterable` `Number` `Optic` `Option` `Order` `Ordering`
`PartitionedSemaphore` `Path` `Pipeable` `PlatformError` `Pool` `Predicate` `PrimaryKey` `PubSub`
`Pull` `Queue` `Random` `RcMap` `RcRef` `Record` `Redactable` `Redacted` `Reducer` `Ref` `References`
`RegExp` `Request` `RequestResolver` `Resource` `Result` `Runtime` `Schedule` `Scheduler` `Schema`
`SchemaAST` `SchemaGetter` `SchemaIssue` `SchemaParser` `SchemaRepresentation` `SchemaTransformation`
`Scope` `ScopedCache` `ScopedRef` `Semaphore` `Sink` `StandardSchema` `Stdio` `Stream` `String`
`Struct` `SubscriptionRef` `Symbol` `SynchronizedRef` `Take` `Terminal` `Tracer` `Trie` `Tuple`
`TxChunk` `TxDeferred` `TxHashMap` `TxHashSet` `TxPriorityQueue` `TxPubSub` `TxQueue`
`TxReentrantLock` `TxRef` `TxSemaphore` `TxSubscriptionRef` `Types` `UndefinedOr` `Unify` `Utils`

Not in the root barrel (common v3/RC guesses): `Either` (→ `Result`), `FiberRef` (→ `Context.Reference`),
`Encoding` (→ `effect/encoding`), `FastCheck` (→ `Arbitrary`), `STM`/`TRef` (→ `Effect.tx` + `Tx*`),
`Runtime<R>` values, `HttpClient` & co. (→ `effect/http`, see `references/modules.md`).
