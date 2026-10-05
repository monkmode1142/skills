---
name: effect
description: >-
  Writing, reviewing, testing, or migrating Effect (TypeScript) code — services, Layers, Schema,
  typed errors, Streams, fibers, scheduling, runtime wiring, and the platform modules (HTTP client
  and server, HttpApi, RPC, SQL, CLI, AI/MCP, cluster, workflow, persistence, observability) — and
  deciding how to structure an Effect codebase. Use this whenever code imports `effect` or
  `@effect/*`, when an Effect API or type looks wrong, when adding or wiring a `Context.Service` /
  `Layer`, when writing `@effect/vitest` tests, when upgrading v3 or a v4 RC/beta to 4.0.0, or when
  reasoning about dependencies, boundaries, and architecture in an Effect project — even if
  "Effect" isn't named explicitly. Targets Effect 4.0.0 stable (npm `latest`); your memory is
  v3-shaped and RC-shaped, so check this before writing Effect code from recall.
---

# Effect v4

The value of this skill is the **delta from your defaults**. Your Effect knowledge is v3-shaped, and
whatever v4 you remember is probably an RC or beta. v4.0.0 (stable, LTS, npm `latest` since
2026-10-01) changed services, module paths, Schema, Cause, scheduling and the runtime. Most bad
Effect code is plausible-looking v3, or an older v4 API, written from memory. Everything here
either corrects one of those reflexes or encodes a design move you wouldn't make by default.

Read the whole body before writing Effect code. It is self-sufficient for everyday work. The
references are deep catalogs: load the one that answers the current question (see the table at the
end).

Snapshot: `effect` 4.0.0 (tag `effect@4.0.0`, commit `67ba4e4`), 2026-10-03. Every ```ts example
in this skill is typechecked against that release in CI.

---

## 1. Version first, source second: verify before you write

Before applying any rule below, resolve the installed version, because v3 and v4 have incompatible
API shapes and a v3 project also ships `node_modules/effect/src`:

```sh
node -p 'require("effect/package.json").version'   # run from the package that imports effect
```

- **`4.x`**: apply this skill.
- **`3.x`**: don't. Use the installed source and the website's `/docs/v3` pages. Don't rewrite
  working v3 code into v4 shapes unless a migration was requested (`references/migration.md`).
- **`4.0.0-rc.*` / `4.0.0-beta.*`**: the project is on a prerelease. Several names differ from
  4.0.0, most visibly the `effect/unstable/*` import paths. Use the installed source, and offer the
  upgrade (`references/migration.md` has the RC→4.0.0 delta list).
- **Mixed versions** (`effect@4` next to `@effect/platform@0.x`, or two `effect` copies): stop and
  fix that first. Every `@effect/*` package in a v4 project must be the same `4.0.0` version as
  `effect`. `@effect/platform`, `/rpc`, `/sql`, `/cli`, `/ai`, `/cluster`, `/workflow`,
  `/experimental` and `/schema` were merged into `effect` and must not be installed. Their npm
  `latest` is still the v3-era 0.x line.
- **No pin**: don't guess. `npm install effect` now gives 4.0.0. v3 has no dist-tag (`effect@^3`).
  v4 needs TypeScript 5.9+ with `strict: true`, and `@effect/vitest@4` needs Vitest 5.

**The installed package is the documentation.** `effect@4.0.0` ships its own agent material inside
`node_modules/effect/`, written by the Effect team and versioned with the code:

| Path | What it is | Use it for |
| --- | --- | --- |
| `AGENTS.md` | the official agent guide (the repo's `LLMS.md`) | blessed idioms per area; read the section for the task at hand |
| `ai-docs/src/**` | compiled, runnable examples by topic (`01_effect/03_services`, `51_http-server`, `09_testing`, …) | the canonical shape of a whole pattern |
| `dist/**/*.d.ts` | signatures, plus JSDoc with "When to use", examples, and `@stability` tags | whether an API exists and exactly how to call it |
| `src/**` | the implementation; each module opens with a mental-model docstring | semantics: what it actually does |

Treat your memory as a *hypothesis*. The evidence ladder, weakest to strongest:
1. Migration notes, blog posts, and this skill settle renames, but can be stale or silent on
   removals.
2. `AGENTS.md` and `ai-docs` settle idioms.
3. The installed `.d.ts` and `src` settle existence and signature.
4. A probe settles semantics: a tiny file run at the package root that prints the resolved
   version, plus a control that must fail first.

Two lookup traps:
- Grep misses names that collide with built-ins. `Schema.Array` is `export { ArraySchema as Array }`,
  and `Order` and `Equivalence` use the same trick, so grep the export block.
- `typeof X.member` at runtime is not an existence test for type-only symbols. Typecheck a probe.

If no installed source is reachable, clone the tag that matches the version you target. Not
`main`, which has moved on, and not `effect-smol`, which is stale:

```sh
DIR="${TMPDIR:-/tmp}/effect-4.0.0"
[ -d "$DIR" ] || git clone --depth 1 --branch effect@4.0.0 https://github.com/Effect-TS/effect.git "$DIR"
# packages/effect/src · LLMS.md · MIGRATION.md · migration/*.md (grep v3-to-v4.md, never read it whole) · ai-docs/src
```

The website is versioned: use `/docs/v4` and `/docs/v4/api`. An unversioned search result can land
in `/docs/v3`. `effect.website/llms.txt` is gone.

> **Completion criterion.** Before calling any Effect change done, confirm three things:
> - Every Effect API in the change has been checked against the project's installed major. That
>   means the installed source, its `.d.ts`, or an existing same-version call site, never memory.
>   Check every API, not only the unfamiliar-looking ones.
> - The project typechecks.
> - The tests run and can fail (`references/testing.md`).
>
> If the project uses the Effect language service (`@effect/tsgo` / `@effect/language-service`),
> its diagnostics must be clean too.

---

## 2. Lean on the platform: don't hand-roll what Effect ships

Before writing caching, persistence, queues, scheduling, retries, rate-limiting, state, logging,
tracing, metrics, config, HTTP, SQL, CLI parsing, subprocesses, or concurrency by hand, **assume
Effect ships it and go look**. Hand-rolling a primitive the platform provides is a defect, not a
shortcut. You lose the composition, observability, interruption and resource safety the built-in
guarantees, and you maintain code that didn't need to exist.

Treat the whole public surface as one toolbox: the 138 modules of the root `effect` barrel
(`references/primitives.md`) plus the 19 subsystem barrels at `effect/<area>`
(`references/modules.md`).

- **Stability is a JSDoc tag, not a path.** In 4.0.0 the subsystems live at `effect/http`,
  `effect/http-api`, `effect/sql`, `effect/rpc`, `effect/ai`, `effect/cli`, `effect/persistence`,
  `effect/process`, `effect/cluster`, `effect/workflow`, `effect/reactivity`, `effect/observability`,
  `effect/encoding`, `effect/socket`, `effect/workers`, `effect/net`, `effect/schema`,
  `effect/eventlog`, `effect/devtools`. There is **no `effect/unstable/*`** any more. Those paths were
  removed with no compatibility exports, and `httpapi` became `http-api`. Their modules carry
  `@stability unstable`.
- **`@stability unstable` means the API may change in a minor release. It does not mean "not
  production-ready"** (Effect team: "unstable means the api might change, not that it's not ready for
  prod"). Use these modules when they fit; pin the version and review on upgrade. Never pick a worse
  fit, or hand-roll an Effect-owned capability, to avoid the tag. Models tend to shy away from
  "unstable" APIs, so correct for that.
- When something looks impossible with a built-in, that's a signal to look harder. Grep `effect` for
  an existing contract before designing a service (e.g. subprocesses are `effect/process`
  `ChildProcessSpawner`; a hand-built "commands" service duplicates it).

| If you're about to hand-roll… | Reach for… |
| --- | --- |
| a `Map` memo, a `Ref<{value, at}>` + TTL check, any cache | `Effect.cached` / `cachedWithTTL` / `cachedInvalidateWithTTL` (one value) · `Cache.make({ capacity, lookup })` (keyed) · `PersistedCache` (`effect/persistence`) |
| retry/backoff loops, polling, `setTimeout`/`setInterval` | `Effect.retry` / `Effect.repeat` + `Schedule` (`exponential`, `spaced`, `max`/`min`, `upTo`, `jittered`) · `HttpClient.retryTransient` |
| `Promise.all`, a worker pool, a mutex, a token bucket | `Effect.forEach(xs, f, { concurrency })` · `Semaphore` · `Pool` · `HttpClient.withRateLimiter` / `RateLimiter` (`effect/persistence`) |
| an event emitter, a job queue, background workers | `PubSub` · `Queue` · `Stream` · `FiberSet` / `FiberMap` · `PersistedQueue` (durable) |
| raw `fetch`, Express handlers, OpenAPI by hand | `HttpClient` (`effect/http`) · `HttpApi` (`effect/http-api`) · `HttpRouter` |
| `process.env`, a bare secret string | `Config.String("X")` / `Config.Redacted("X")` · `ConfigProvider` · `Redacted` |
| `child_process`, `fs`, `path`, `crypto`, `console` | `ChildProcessSpawner` (`effect/process`) · `FileSystem` · `Path` · `Crypto` · `Console` / `Effect.log*` |
| `Date.now()`, `Math.random()`, `new Date()` | `Clock` · `Random` · `DateTime` (services, so tests control them) |
| `console.log` timing, health booleans, ad-hoc counters | `Effect.fn("X.op")` spans · `Effect.withSpan` · `Metric.counter`/`histogram`/`gauge` · `Logger` |
| `try/catch`, `throw`, a hand-rolled `Result` | the typed `E` channel · `Effect.try`/`tryPromise({ try, catch })` · `Schema.TaggedError` · `Result` |
| manual `_tag` `switch`/`if` chains | `Match.valueTags` / `Match.tags` / `Effect.catchTags` / `Predicate.isTagged` |
| `JSON.parse` + casts, hand-written validators | `Schema.decodeUnknownEffect(S)` · `Schema.fromJsonString(S)` · `Schema.toCodecJson` |
| N+1 calls to a backend with a batch endpoint | `Request` + `RequestResolver` + `Effect.request` |
| primary/fallback provider switching | `ExecutionPlan` + `Effect.withExecutionPlan` |

---

## 3. The idioms that bite: v4.0.0 forms you'd otherwise get wrong

The highest-frequency places your reflex is wrong. The full lookup (idioms, near-twins, the v3→v4
and RC→4.0.0 tables, behavior traps) is **`references/v4-catalog.md`**.

**Services and running**
- **A service is one class form.** `class Users extends Context.Service<Users, UsersShape>()("@app/Users") {}`.
  Types go first via the generic; the id string goes to the *returned* constructor and should be
  package-qualified. v3's `Context.Tag`, `Context.GenericTag`, `Effect.Tag` and `Effect.Service`
  all collapsed into this, and so did the beta's `ServiceMap.Service`. Static accessors are gone,
  so `Users.list()` doesn't exist.
- **Get a service with `yield* Users`**, which adds `Users` to `R`. `Users.use(f)` exists, but
  `yield*` keeps dependencies visible, so prefer it. The class itself is an `Effect`. Name the
  shape with `Users["Service"]` (the class instance type is not the shape).
- **Build the layer yourself.** Write `static readonly layer = Layer.effect(this, make)` and return
  `Users.of({...})` from `make`. There is no auto `.Default` and no `dependencies` option. The
  official convention is `layer` for the self-wired default, `layerNoDeps` for the recipe with
  requirements still open (tests wire it over fakes), and `layerTest` / `layerConfig`.
  `Layer.scoped` is gone because `Layer.effect` already excludes `Scope`.
- **`Runtime<R>` is gone.** Carry a `Context<R>`: `const ctx = yield* Effect.context<R>()`, then
  `Effect.runForkWith(ctx)` or `runPromiseWith(ctx)`. `ManagedRuntime.make(layer)` remains for
  bridging into foreign frameworks. The entrypoint is `Layer.launch(App).pipe(NodeRuntime.runMain)`
  or `NodeRuntime.runMain(program)`. A bare `Effect.runFork` of a suspended fiber does **not** keep
  Node alive, and bare `runPromise` in library code drops the caller's tracing and config.
- **`FiberRef` is gone.** Use `Context.Reference<T>("id", { defaultValue: () => … })` (a service
  with a default, so `R` stays `never`) and override it with `Effect.provideService`.

**Writing effects**
- **`gen` vs `fn`.** `Effect.gen(function*(){…})` is one inline Effect.
  `Effect.fn("Users.find")(function*(id: UserId){…})` is a reusable function that opens a span
  named `"Users.find"` on every call. Annotate its return as `Effect.fn.Return<A, E, R>`. Pass
  whole-call combinators as trailing arguments; **don't `.pipe` an `Effect.fn`**, because trailing
  arguments run *inside* the span:
  `Effect.fn("x")(function*(){…}, Effect.mapError(…), Effect.timeout("5 seconds"))`.
  `Effect.fnUntraced` is the same thing without a span: use it for library internals and hot paths.
  Don't write `const f = (x) => Effect.gen(…)` wrappers.
- **Not everything is yieldable.** `yield* Option.some(1)` and `yield* Result.succeed(1)` are type
  errors, and forced through a cast they **die** at runtime with "Not a valid effect". The upstream
  `migration/yieldable.md` says otherwise and is stale. Bridge with `Effect.fromOption(o)` /
  `Effect.fromResult(r)`.
  For a `Ref`, `Deferred`, `Fiber` or `Queue`, call the module: `Ref.get`, `Deferred.await`,
  `Fiber.join`, `Queue.take`. `Config` values *are* yieldable.
- **Raise with `return yield* new MyError({...})`.** The `return` lets TypeScript narrow. A
  `try/catch` around `yield*` never catches an Effect failure.

**Errors and data types**
- **Typed errors:**
  `class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}`.
  It is both a yieldable error and a wire-encodable value. `TaggedErrorClass` and `ErrorClass` were
  beta names and don't exist. `Schema.Error<Self>("Id")({...})` is the non-tagged form. For
  foreign failures, use `cause: Schema.Defect()`: it is a **function**, and `String(e)` loses the
  cause.
- **The catch family was renamed.** `catchAll` became `Effect.catch`, `catchAllCause` became
  `catchCause`, `catchSome` became `catchFilter`, `either` became `Effect.result`, `async` became
  `Effect.callback`, and `zipRight` became `andThen`. `catchTag` survived and now also takes an
  array of tags.
- **Platform errors are one tag with a `reason` union.** `HttpClientError.reason._tag` is one of
  `TransportError`, `StatusCodeError`, `DecodeError`, …. The same shape applies to `SqlError`,
  `PlatformError`, `AiError` and others. Handle them with
  `Effect.catchReason("HttpClientError", "StatusCodeError", f)`, `catchReasons` or `unwrapReason`.
  Depth is in `references/errors.md`.
- **`Cause` is a flat `reasons[]`, not a tree.** Filter it with `Cause.isFailReason`,
  `isDieReason` and `isInterruptReason`. Get the typed error with `Cause.findErrorOption` (or
  `findError`, which returns a `Result`).
- **`Either` became `Result<A, E>`, which is success-first.** Read `.success` / `.failure`;
  `.value` is silently `undefined`. `Option.some(null)` is a real `Some` (fold nullish values with
  `Option.fromNullishOr`).
- **Results are success-first too.** `Array.partition` / `Effect.partition` return
  `[passes, fails]`, and `Array.partition` takes a `Result`-returning filter, not a boolean
  predicate.

**Concurrency and scheduling**
- **There are four fork variants and no bare `fork`.** `forkChild` is supervised and **dies when
  its parent finishes**. `forkScoped` lives as long as the `Scope`, `forkIn(scope)` forks into a
  given scope, and `forkDetach` replaces the old `forkDaemon`. Nobody reports the failure of a fork
  you never join: join it, or supervise it with a `FiberSet`.
- **Schedules have new combinators.** `Schedule.max([a, b])` continues while *all* continue and
  waits for the slower one; `Schedule.min([a, b])` continues while *any* continues. `concat`
  sequences schedules and `upTo({ times })` caps them. There is no `both`, `either`, `andThen`,
  `take`, `union` or `intersect`. `Schedule.recurs(n)` means n retries, so n + 1 runs.

**Schema and Config**
- **Schema is a rewrite** (`references/schema.md`).
  - `Schema.Literals([...])`, `Union([...])` and `Tuple([...])` take arrays; `Schema.Literal`
    takes exactly one argument, and extra arguments are silently dropped at runtime.
  - Refinements are `.check(Schema.isPattern(/…/u))`, `.check(Schema.isBetweenLength(1, 64))` and
    so on.
  - Decode with `Schema.decodeUnknownEffect(S)` (or `…Exit`, `…Option`, `…Result`, `…Sync`).
  - `Schema.fromJsonString(S)` replaces `parseJson(S)`.
  - `Schema.brand("X")` takes one identifier and is type-only, so a bare brand enforces nothing:
    add checks.
  - `Schema.Date` *is* the `Date` instance, and the v3 `Date` is now `DateFromString`. `Duration`
    and `DateTimeUtc` have no JSON encoding: use the `…From*` codecs or `Schema.toCodecJson`.
- **Config:** constructors are PascalCase (`Config.String`, `Number`, `Boolean`, `Redacted`, `Port`,
  `Duration`, `URL`), and `mapOrFail` became `mapEffect`. Use `Config.schema(S, "NAME")` for
  structured input. `ConfigProvider` is a `Context.Reference` that defaults to `fromEnv()`; replace
  it with `ConfigProvider.layer(...)`, which also replaces `Layer.setConfigProvider`.

**Behavior traps**
- **`Effect.cached` caches failures and interruptions, and `Cache` caches failures forever by
  default.** Pass `capacity` (required) and an exit-dependent `timeToLive`. `Effect.cachedFunction`
  doesn't exist.
- **`Effect.all` / `forEach` are sequential by default.** Opt in with `{ concurrency: n }`; `zip`
  spells the option `concurrent`.
- **Recovery is narrower than it looks.** `Effect.catch` never sees interrupts, while
  `catchCause` does (and swallows them), so keep `catchCause` at boundaries. `Effect.ignore` no
  longer hides defects. `Effect.promise` turns a rejection into a defect, and `runPromise` /
  `runSync` reject with the raw failure value (no `FiberFailure` wrapper). `Config.withDefault`
  only covers *missing* values, not invalid ones.
- **`Equal.equals` is structural by default** for plain objects, arrays, `Map`, `Set` and `Date`.
- **`Schema.toCodecJson(Schema.Redacted(S))` encodes the plaintext secret.** Redaction protects
  logs, not the wire.
- **`Logger.layer([...])` replaces all loggers** unless you pass `{ mergeWithExisting: true }`.
- **Platform traps worth memorizing.** Depth is in `references/platform.md`.
  - `HttpClient` treats a 404 or 500 as a success until you add `HttpClient.filterStatusOk`, and it
    must come *before* `retryTransient`. `withRateLimiter` silently retries 429s, so give write
    clients `times: 0`.
  - `HttpRouter.serve` builds routes in a fresh router with a forked memo map, so provide shared
    services *outside* it.
  - A bare `Flag.Boolean` CLI flag is required: add `Flag.withDefault(false)`.
  - `ChildProcess` `env` replaces the inherited environment unless `extendEnv: true`, and
    `spawner.string` succeeds on a nonzero exit code.
  - Every workflow side effect (HTTP, time, UUIDs) goes inside an `Activity`, because everything
    else re-runs on replay.
  - A stdio MCP server must log to stderr.

A whole service file in the 4.0.0 shape (the canonical template; worked variants are in
`references/architecture.md`):

```ts
import { Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

// CONTRACT: data and errors are schemas, so the same definition validates, encodes, and types.
export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export class User extends Schema.Class<User>("@app/users/User")({
  id: UserId,
  name: Schema.NonEmptyString
}) {}

export class UsersError extends Schema.TaggedError<UsersError>()("UsersError", {
  cause: Schema.Defect()
}) {}

export interface UsersShape {
  readonly find: (id: UserId) => Effect.Effect<Option.Option<User>, UsersError>
}

export class Users extends Context.Service<Users, UsersShape>()("@app/users/Users") {
  // PROVISION: the recipe, written against tags only. Requirements (HttpClient) stay open.
  static readonly layerNoDeps = Layer.effect(
    this,
    Effect.gen(function*() {
      // FACTORY: dependencies are resolved once, at layer build.
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.example.com")),
        HttpClient.filterStatusOk
      )

      const find = Effect.fn("Users.find")(
        function*(id: UserId) {
          const response = yield* client.get(`/users/${id}`)
          return Option.some(yield* HttpClientResponse.schemaBodyJson(User)(response))
        },
        // Absence is a normal answer here, so 404 becomes None; everything else is UsersError.
        Effect.catchReason("HttpClientError", "StatusCodeError", (reason) =>
          reason.response.status === 404 ? Effect.succeed(Option.none()) : Effect.fail(new UsersError({ cause: reason }))),
        Effect.mapError((cause) => cause instanceof UsersError ? cause : new UsersError({ cause }))
      )

      return Users.of({ find })
    })
  )
}

// A consumer names the tag, never the implementation; the composition root provides the layers.
export const greet = Effect.fn("greet")(function*(id: UserId) {
  const users = yield* Users
  const user = yield* users.find(id)
  return Option.match(user, { onNone: () => "who?", onSome: (u) => `hello ${u.name}` })
})
```

---

## 4. Layers and dependencies: how DI actually works

This is the mental model to reason from. The full mechanism, the layer-constructor table, and worked
wiring are in **`references/architecture.md`**.

- **The environment is a typed map** (`Context`) from service key to implementation; `yield* Tag` is
  a lookup. The `R` in `Effect<A, E, R>` is the set of keys still unsatisfied. It must reach `never`
  before the effect runs, so a missing dependency is a **compile error at the composition root**, not
  a runtime null.
- **`Layer<ROut, E, RIn>`** provides `ROut`, its build can fail with `E`, and it requires `RIn`
  first. Whatever `make` `yield*`s becomes `RIn`. The dependency graph is the union of every
  `yield*`, inferred, never hand-maintained.
- **Recipe vs wired instance.** Write recipes against tags only (`layerNoDeps`), and choose real or
  fake implementations with `Layer.provide` at the composition root. Use `Layer.provide` (consume,
  don't re-export), `Layer.provideMerge` (provide *and* expose: Logger, Tracer or SqlClient at the
  root), `Layer.mergeAll` (siblings; last one wins on conflict), `Layer.unwrap` (a layer chosen by
  config) and `Layer.succeed` (a ready value). `Layer.provide([A, B])` takes arrays. Don't use
  `mergeAll` or `provideMerge` as blind make-it-compile tools.
- **Each layer builds once, memoized by reference.** The MemoMap is shared across `Effect.provide`
  calls, so one `SqlClient` serves everyone. A layer constructed *inside a function*, getter, or
  parameterized `static layer = (opts) => …` is a new reference per call. That builds twice: two
  pools, split counters, a PubSub that delivers half the events. Bind layers to consts. Provide at
  the entry point, not inside request handlers. Opt out deliberately with `Layer.fresh(layer)` or
  `Effect.provide(layer, { local: true })` on the *inner* provide; `local` on an outer provide
  doesn't force inner rebuilds.
- **Construction-time vs per-call dependencies.** A dependency `yield*`ed in `make` is captured at
  build, so a caller's `Effect.provideService` later changes nothing. Infrastructure (clients,
  pools) belongs in `make`. Leave a dependency in a method's `R` only when the *caller* should vary
  it per call (e.g. `CurrentUser`, request context). Otherwise an infra dependency in a method's `R`
  is a leak.
- **Layer acquisition must finish.** A layer that runs a loop, listener or subscriber forks it into
  the layer's scope (`Layer.effectDiscard` + `Effect.forkScoped` / `FiberSet`). Don't expose public
  `start()` methods.
- **The swap is the architecture.** Live ↔ in-memory, real ↔ replay: all behind the same tags.
  Tests run the *real* service over `Layer.succeed(Port, fake)`, `Layer.mock(Port, partial)` or
  in-memory layers, with no mocking framework. If you can't swap a dependency without editing the
  service, it isn't injected.
- **Service shapes should be effectful.** Every member returns an `Effect` or `Stream`, so
  `Layer.mock` partials and fakes stay one-liners. Pure helpers live beside the types, not on the
  service. Export the shape interface, because it is the contract.

---

## 5. The Effect way: design discipline

- **Design against contracts.** Write the Schema and the service shape *before* the implementation.
  A **port**, the seam to the outside world, is a tag plus a shape with no `Layer`; implementations
  are swappable layers behind it. Schema is the single source of truth. One definition is the type,
  the runtime validator, the wire codec, and the JSON Schema or OpenAPI document, so the boundary
  can't drift.
- **Pure core, effectful edge.** Domain math is plain functions beside its types; services orchestrate
  effects; repositories access data without domain logic. Don't seal an algorithm inside a
  `Layer.effect` closure, because a test that needs a temp dir to check arithmetic is a design smell.
  Small services you can walk in isolation beat one god-service. Organize by concept (one module per
  capability), not by kind (`errors/`, `services/`, `layers/` folders).
- **Errors in the type, defects for bugs.** Model expected failures as `Schema.TaggedError`, with
  one class per failure reason so callers recover by tag, and let the compiler force handling.
  - **Malformed untrusted input is a typed failure, never a defect.**
  - **Bad wiring and broken invariants are defects.** Promote them deliberately with
    `Effect.orDie`.
  - **A throw from a caller-supplied callback whose result matters stays a defect.** Don't convert
    the consumer's bug into a typed error their `catchTag` swallows.
  - **Collapse foreign errors into your own family at the port** with `mapError` or `catchReason`,
    so no `HttpClientError` or `SqlError` leaks inward.
  - **Read the inferred `E` before writing `catchTag` chains.** A `catchTag` that won't typecheck
    means that error isn't there.
- **Observe by default.** Write public, fallible service methods as `Effect.fn("Service.method")`,
  which gives you a span on every call and a trace tree that mirrors the call graph. Be uniform: if
  one method of a service is spanned, span them all. Annotate spans with entity IDs and business
  values, never PII, secrets or per-item noise. Libraries stay telemetry-agnostic (spans only, no
  metrics or log spam). Apps install OTLP once at the edge (`effect/observability`).

### Designing contracts the Effect way

Each rule below is a contract decision made before the implementation. The Scala/ZIO column gives
the conceptual correspondence, so the rule lands on familiar ground. Installed Effect 4.0.0 stays
the authority on the API. The last column names the mechanism that catches a violation. A rule
whose only check is the review seat (`references/review.md`, The Effect-expert seat) gets a lint
once the same miss is corrected twice.

| Rule | Do | Scala/ZIO | Read | Caught by |
| --- | --- | --- | --- | --- |
| Schema-first data | Write the Schema before the code. One definition is type, validator and codec. DB rows decode through `SqlSchema`. Brands carry checks | case classes with derived codecs; parse, don't validate; refined types | `references/schema.md` §1, §7, §8 | `preferSchemaOverJson` diagnostic |
| Tagged errors in E | One `Schema.TaggedError` per reason. Map foreign errors at the port. Defects only for broken invariants | `ZIO[R, E, A]` typed error channel; `fail` vs `die`; sealed error ADTs | `references/errors.md` §2, §3, §7 | `anyUnknownInErrorContext`, `globalErrorInEffectFailure`; type tests on exported E |
| Services and Layers | Ports are `Context.Service` with Effect-returning methods, plus `layerNoDeps` / `layer` / `layerTest`. R reaches `never` only at the root | `ZLayer` compile-time wiring; tagless final (algebra is the shape, interpreter is the layer) | §4; `references/architecture.md` §2, §8 | `leakingRequirements`, `strictEffectProvide`, `multipleEffectProvide`; type tests on method R |
| Scope for resources | Every resource names its acquire, owner and release. `acquireRelease`, never try/finally | cats-effect `Resource`; ZIO `Scope` and bracket | `references/concurrency.md` §1, §2; `references/architecture.md` §6 | `tryCatchInEffectGen`; review seat |
| Structured concurrency | Fork into scopes. Write `{ concurrency }` explicitly. Shared quotas go through `Semaphore` or `RateLimiter` at the layer | ZIO fiber supervision; no fiber outlives its scope | `references/concurrency.md` §0, §3, §4 | `floatingEffect`; review seat |
| Effects as values | Retry and polling are `Schedule` values, fallbacks are `ExecutionPlan`. Run once, at the edge | referential transparency; describe, then run at the end of the world | §6; `references/concurrency.md` §7, §11 | `runEffectInsideEffect`; lints for `Effect.run*` in tests and sleep in a loop |
| Testability | Time, randomness and ids come from services. Tests swap layers, drive `TestClock`, and check properties from `Arbitrary` / `TestSchema` | ZIO Test environment (`TestClock`, `TestRandom`); ScalaCheck generators from types | §7; `references/testing.md` §1, §5, §10 | `globalTimers`, `globalFetch`, `processEnv` diagnostics; the shared test helper |
| Functional core | Matching, grouping and money policy stay pure functions beside their types. Not every computation is an Effect | functional core, imperative shell | "Pure core, effectful edge" above | review seat |

---

## 6. Building Effect systems: production principles

The foundation is above: services behind tags (§4), errors as data (§5), and the platform over
hand-rolling (§2). These are the system-level moves on top. Worked code is in
**`references/architecture.md`**, the concurrency depth is in **`references/concurrency.md`**, and
the subsystems are in **`references/platform.md`**.

- **Tame the outside world at the port.** Decode input at the boundary
  (`Schema.decodeUnknownEffect`, `HttpClientResponse.schemaBodyJson`, `HttpApi` endpoint schemas)
  so the interior runs on validated types and never re-checks: parse, don't validate. Decode
  external arrays **element by element**, logging and dropping bad rows, so one malformed item
  degrades to a partial result instead of blanking everything. For human-written config, decode
  with `{ onExcessProperty: "error", errors: "all" }`.
- **Structured concurrency and resource safety by construction.**
  - Tie resources to a `Scope` with `acquireRelease`. Finalizers run in LIFO order on success,
    failure *and* interruption. An async release must be `Effect.promise`, never `Effect.sync`.
  - Fork into scopes (`forkScoped`, `FiberSet`); reach for `forkDetach` only when you truly mean to
    outlive the caller.
  - Stay sequential by default and opt into parallelism with `{ concurrency: n }`. When you do,
    comment that it is load-bearing.
  - Govern shared pools and quotas with a `Semaphore` or `RateLimiter`.
- **Govern cross-cutting concerns at the DI seam.** Enforce a shared budget (rate limit,
  concurrency cap, auth header, base URL, retry policy) by transforming the shared resource's
  *layer*, e.g. one configured `HttpClient`, rather than trusting each call site. Every consumer is
  then governed by construction. Retry only idempotent operations, and keep a separate client for
  writes. Never hold a database transaction open across a network call.
- **Determinism is the testing strategy.** Take time, randomness and IDs from `Clock`, `Random`,
  `DateTime` and `Crypto`, never from ambient globals. Tests then provide a fake behind the real tag
  and advance `TestClock` instead of sleeping, so the *same* production logic runs instantly and
  without flakiness.
- **Contain Effect at the edges; run at the end of the world.** Enter foreign code with
  `Effect.tryPromise` / `Effect.promise` / `Effect.callback`. Execute in exactly one place:
  `NodeRuntime.runMain`, `Layer.launch`, a `ManagedRuntime` bridge, or `HttpRouter.toWebHandler`.
  Map `Exit` to the host's error model once, there. Never round-trip through the runtime inside
  business logic. This also lets you adopt Effect one module at a time.
- **Fallbacks are data.** Use `Effect.firstSuccessOf` for ordered alternatives, and an
  `ExecutionPlan` for "try provider A with this retry policy, then B". Let exhausted failures stay
  visible unless the boundary has a real fallback.

---

## 7. Testing Effect code (summary)

Depth, recipes and the full false-greens list are in **`references/testing.md`**.

- Use `@effect/vitest` at the same version as `effect` (Vitest 5). Write `it.effect("…", () =>
  Effect.gen(…))`. That already provides a `Scope`, `TestClock` and `TestConsole`.
  - Use `it.live` only when you need real time.
  - There is **no `it.scoped`**. It resolves to a Vitest API and the test silently never runs.
  - A plain `it("…", () => Effect.gen(…))` also never runs.
  - Don't `Effect.runPromise` inside a plain `it`, because it bypasses the test services.
- Assert typed failures with `Effect.flip` (then `_tag`) or `Effect.result`, and defects with
  `Effect.exit` plus `Cause` reasons. Don't compare whole failed `Exit`s, because spans add
  annotations.
- Per-test `Effect.provide(layer)` is the safe default. A shared `layer(L)("suite", (it) => …)`
  carries state, clock time and console lines across tests.
- `TestClock` starts at epoch 0. Fork the sleeping effect, `TestClock.adjust`, then join. Any
  *real* delay under `it.effect` hangs until the Vitest timeout.
- Prove each new test can fail: break the code, watch *that* test go red for the right reason,
  restore. Read the test count as well as the exit code: a run that finds no tests exits 1, but a
  `-t` filter that matches nothing skips everything and exits 0.

---

## 8. Before you call it done

A self-review pass; the full audit procedure, smell catalog, and language-service diagnostics are
in **`references/review.md`**.

- [ ] Version gate passed, and no `effect/unstable/*`, `@effect/platform`, `Context.Tag`,
      `Effect.Service`, `Schema.TaggedErrorClass`, `Effect.fork(`, `Layer.scoped`, `catchAll` or
      `Either` sneaked in.
- [ ] Every API was checked against the installed `.d.ts` or `src`.
- [ ] No floating effects (an `Effect.log…` or effect value created and discarded). No `run*`
      inside Effect code or libraries. No `try/catch` around `yield*`.
- [ ] Every `yield*` target is actually an Effect (not an `Option`, `Result`, `Ref` or `Deferred`).
- [ ] Errors: the `E` channel names real domain failures (not `unknown` or `Error`). Foreign errors
      are mapped at the port. No silent catch-all. `orDie` is used only for genuine defects.
- [ ] Layers: bound to consts, provided at the entry point, no infra dependencies leaking into
      method `R`, long-lived work forked into the layer scope.
- [ ] Ambient globals (`Date.now`, `Math.random`, `process.env`, `fetch`, `console`, `node:*`) are
      replaced by services in Effect code.
- [ ] Concurrency is explicit where intended, forks are supervised, resources are scoped, retries
      are bounded and idempotent.
- [ ] Typecheck and tests (which can fail) are clean.

Repo style can't waive these three. Report each with its evidence, not a tick:

- [ ] **Toolbox.** Each capability the diff built by hand (time, retry, polling, cache, queue, lock,
      parsing, ordering, grouping, decimal, graph, LLM I/O) is listed with the export checked
      (`dist/<file>:<line>`) and why it doesn't fit, or the report says `none`.
- [ ] **Tests.** Every new or changed test runs under `TestClock`, `TestConsole` and a `Scope`
      through `it.effect` or the project's equivalent (`references/testing.md` §1). No `run*` in
      test bodies, and no real sleeps.
- [ ] **Diagnostics.** The language service ran with its severities configured and reported clean.
      "Not configured" fails this box. It doesn't count as N/A.

---

## References

Each is a self-contained deep dive; load the one the task needs.

| File | Read it when… |
| --- | --- |
| `references/v4-catalog.md` | you need an exact API form, a v3→v4 or RC→4.0.0 rename, a "which of these two primitives?" call, or the list of behavior traps |
| `references/primitives.md` | selecting a primitive, or checking whether the root `effect` barrel (138 modules + `effect/testing`) already ships a capability |
| `references/modules.md` | the capability may live in a subsystem (`effect/http`, `sql`, `rpc`, `ai`, `cli`, `cluster`, …), or you need a companion package (`@effect/platform-node`, `sql-*`, `ai-*`, `vitest`, atom) and what *not* to install |
| `references/architecture.md` | defining services and layers (every form, the constructor table, naming, memoization, construction vs per-call dependencies), wiring an app and its entrypoint, or the worked production patterns and recipes |
| `references/schema.md` | modeling data, branded types, classes, checks, transformations, JSON codecs, decode/encode runners, or the Schema v3→v4 renames |
| `references/errors.md` | designing error types, the `reason` pattern, the full catch family, `Cause`/`Exit` inspection, defect-vs-failure rules, mapping errors at boundaries |
| `references/concurrency.md` | fibers and lifetimes, `Scope` and resources, `Ref`/`Queue`/`PubSub`/`Deferred`/`Latch`/`Semaphore`, `Stream`, `Schedule`/retry/repeat, timeouts, caching, request batching |
| `references/platform.md` | using HTTP client/server, HttpApi, RPC, SQL, CLI, child processes, AI and MCP, persistence, cluster and workflow, Atom, observability, encoding, sockets, workers |
| `references/testing.md` | writing or fixing tests: `@effect/vitest` surface, asserting failures and defects, layers and fakes, `TestClock`, concurrency tests, property tests, false greens |
| `references/review.md` | reviewing or auditing Effect code, sweeping for smells, configuring the Effect language service, or self-reviewing a large change |
| `references/migration.md` | upgrading v3 → v4.0.0 or an RC/beta → 4.0.0, or vendoring Effect's source for agents |
| `references/pstack.md` | you work under pstack (poteto-mode) with the effect stack add-on: the version gate, done checklist, delegate lines, test rules, review lens, and reflection counts at each pstack step |
