# Migrating to Effect 4.0.0

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

Two migrations: **(a) v3 → 4.0.0** (structural; services, runtime, errors, Schema all change) and
**(b) 4.0.0-beta/rc → 4.0.0** (mostly mechanical path rewrites plus a short list of renames).

## Contents

- [When not to migrate](#when-not-to-migrate)
- [Install facts](#install-facts)
- [Sources: the official migration docs](#sources-the-official-migration-docs)
- [Procedure (v3 → v4)](#procedure-v3--v4)
- [Structural changes, before and after](#structural-changes-before-and-after)
- [RC/beta → 4.0.0](#rcbeta--400)
- [Vendoring the source for agents](#vendoring-the-source-for-agents)

---

## When not to migrate

- Working v3 code stays v3 unless the user asked for the migration. `npm i effect` now installs 4.0.0, so a
  v3 repo that adds a package can be bumped by accident: pin `effect@^3` (latest 3.22.x; there is no v3
  dist-tag) and keep `@effect/*` on their v3-compatible versions.
- Do not mix majors. A v4 import in a v3 repo (or the reverse) gives two `effect` copies and errors that make
  no sense ("service not provided" for a service that is provided).
- Review of v3 code is review against v3 idioms (`references/review.md`, version gate).

## Install facts

```sh
npm i effect                                   # 4.0.0 (npm latest since 2026-10-01; LTS)
npm i @effect/platform-node                    # or platform-bun / platform-browser / platform-deno, same version
npm i -D vitest@^5 @effect/vitest              # @effect/vitest@4 needs Vitest 5
```

- Every `@effect/*` package is versioned in lockstep with `effect`: all on `4.0.0`, exact. Check with
  `npm ls effect` (one copy only).
- **Remove** packages merged into `effect`: `@effect/platform`, `@effect/rpc`, `@effect/sql`, `@effect/cli`,
  `@effect/ai`, `@effect/cluster`, `@effect/workflow`, `@effect/experimental`, `@effect/schema`,
  `@effect/typeclass` (mostly removed; `Semigroup` → `effect/Combiner`, `Monoid` → `effect/Reducer`) and
  `@effect/printer*` (removed, no replacement). Their modules now live at
  `effect/http`, `effect/http-api`, `effect/rpc`, `effect/sql`, `effect/cli`, `effect/ai`, `effect/cluster`,
  `effect/workflow`, `effect/persistence`, `effect/Schema`, …
- **Keep** (bumped to 4.0.0): `@effect/platform-*`, `@effect/sql-*` drivers, `@effect/ai-*` providers,
  `@effect/opentelemetry`, `@effect/atom-*`, `@effect/vitest`.
- TypeScript **5.9+** (7 recommended), `strict: true`. `moduleResolution` `NodeNext` or `Bundler`.
  `effect` has zero runtime dependencies (no `fast-check`; property tests use `effect/Arbitrary`).
- 4.0.0 ships its agent guide and source in the package: `node_modules/effect/AGENTS.md`, `ai-docs/`, `src/`.

## Sources: the official migration docs

In the `Effect-TS/effect` repo at tag `effect@4.0.0`:

| File | Purpose |
|---|---|
| `MIGRATION.md` | Background (versioning, consolidation, unstable modules) and the guide index. Read once. |
| `migration/v3-to-v4.md` | Generated rename map, ~16.8k lines. **Grep it, never read it whole.** Sections: `## Import Map`, `## No Counterpart Imports`, `## Removed Modules`, `## API Reference` (one `` ### `<v3 module>` `` heading per module). |
| `migration/services.md` | `Context.Tag`/`GenericTag`/`Effect.Tag`/`Effect.Service` → `Context.Service`; accessors → `use`/`yield*`; `Context.Reference` |
| `migration/cause.md` | Cause flattened to `reasons` array; guards, extractors, renamed error classes |
| `migration/error-handling.md` | `catchAll*` → `catch*`, `catchSome` → `catchFilter`; new `catchReason(s)`, `catchEager` |
| `migration/forking.md` | `fork` → `forkChild`, `forkDaemon` → `forkDetach`; fork options; `forkAll` removed |
| `migration/yieldable.md` | Effect subtyping → `Yieldable` (Ref/Deferred/Fiber no longer *are* Effects; `Config` still is in 4.0.0) |
| `migration/fiber-keep-alive.md` | Process lifetime and suspended fibers |
| `migration/layer-memoization.md` | Layers memoized across `Effect.provide` calls; `{ local: true }`, `Layer.fresh` |
| `migration/fiberref.md` | `FiberRef` → `Context.Reference` / `References.*`; `Effect.locally` → `provideService` |
| `migration/runtime.md` | `Runtime<R>` removed; `Effect.context` + `run*With` |
| `migration/scope.md` | `Scope.extend` → `Scope.provide`; finalizer APIs |
| `migration/equality.md` | `Equal.equals` structural by default; `Equal.byReference` |
| `migration/generators.md` | `Effect.gen(self, …)` → `Effect.gen({ self }, …)` |
| `migration/schema.md` | Schema v3 → v4 summary table (auto / semi-auto / manual / removed) plus detailed recipes |

**Errata at 4.0.0** (the docs are wrong here; trust these):

- `yieldable.md` says `Option`/`Result` are yieldable. They are not: `yield* Option.some(1)` fails to
  typecheck and dies at runtime. Use `Effect.fromOption`, `Effect.fromResult`, `Effect.fromNullishOr`.
- `fiber-keep-alive.md` says the core runtime keeps Node alive. Under bare `Effect.runPromise`/`runFork` a
  fiber waiting on `Deferred.await` or `Queue.take` lets the process exit. Run programs with
  `NodeRuntime.runMain` / `BunRuntime.runMain`.
- `layer-memoization.md`: `{ local: true }` on the *outer* provide still builds once; use `Layer.fresh`
  for a second instance.
- `runtime.md`: `Runtime` also exports `errorExitCode`, `getErrorExitCode`, `errorReported`, `getErrorReported`.
- `MIGRATION.md` lists `jsonschema` as an unstable folder (it is `effect/JsonSchema` in the root barrel) and
  omits `encoding` and `net`.
- `v3-to-v4.md` targets that do not exist: `Option.fromNullable` (use `Effect.fromNullishOr` /
  `Option.fromNullishOr`), `Effect.orElse` (use `Effect.catch`), `Scope.ExecutionStrategy`.
  `Effect.ignoreLogged` → use `Effect.ignoreCause({ log: "Debug" })` (v4 `Effect.ignore` handles failures only).
  `Effect.optionFromOptional` → `Effect.catchNoSuchElement`. `Layer.fail(e)` → `Layer.effectDiscard(Effect.fail(e))`
  (keeps the error type). v3 `Effect.catch(discriminator, {...})` has no v4 overload → `catchTag`/`catchIf`.
  194 `effect/FastCheck` entries say "TODO": import `fast-check` directly or use `effect/Arbitrary`.
- The official `effect-v3-to-v4` skill (Effect-TS/skills) says `effect/unstable/http`, `effect/unstable/rpc`
  are correct v4 imports. **Wrong at 4.0.0**: those paths were removed with no compatibility exports. It also
  clones `main`, which has moved past 4.0.0; pin the tag.
- `Effect.runSync`'s doc comment says it throws `FiberFailure`; it throws `Cause.squash(cause)`, the failure
  value itself.

## Procedure (v3 → v4)

1. **Get the sources** pinned to the installed version (see [Vendoring](#vendoring-the-source-for-agents)),
   including a v3 checkout for escalation: `git clone --depth 1 --branch v3 https://github.com/Effect-TS/effect .repos/effect-v3`.
2. **Migrate `package.json` first**: drop merged packages, bump the rest to the same exact `4.0.0`. Doing this
   before typechecking avoids an inventory drowned in unresolved imports.
3. **Inventory** imports and v3-only APIs:

   ```sh
   rg -n -t ts "from ['\"](@effect/[a-z-]+|effect)(/[A-Za-z]+)?['\"]" src | sort | uniq -c | sort -rn
   rg -n -t ts 'Context\.Tag|GenericTag|Effect\.Tag|Effect\.Service|Either\.|FiberRef|Runtime\.run|Effect\.fork\(|catchAll|Layer\.scoped' src
   npx tsc --noEmit 2>&1 | tee /tmp/v4-errors.txt | rg -c 'error TS'
   ```

4. **Migrate leaf modules first** (schemas and errors, then services, then layers, then entry points, then
   tests), so each file compiles against already-migrated dependencies.
5. **Look up every symbol** you change, one search at a time:

   ```sh
   rg -n '^@effect/platform/FileSystem ' .repos/effect/migration/v3-to-v4.md          # import path
   rg -n '`Effect\.catchSome`' .repos/effect/migration/v3-to-v4.md                    # one symbol
   rg -n -A 40 '^### `effect/Schedule`' .repos/effect/migration/v3-to-v4.md          # one module section
   rg -n '^export (declare )?(const|function|class|interface|type) catchFilter\b' node_modules/effect/dist/Effect.d.ts
   ```

   A miss in the Import Map is not a dead end: check `No Counterpart Imports` and `Removed Modules`.
   Escalate: rename map → topic guide (for rewrites, not renames) → v4 `src/` or `dist/*.d.ts` (confirm the real
   signature) → v3 source (only when unsure what the old code did).
6. **Large repos: one sub-agent per file or module.** Give it the file, the symbols to resolve, and these rules.
   It returns the edit plus the mappings it used; the coordinator keeps the error inventory and runs `tsc` at
   wave boundaries (sub-agents racing `tsc` waste time).
7. **Hard rules.**
   - Never reintroduce a v3-shaped compatibility layer (`v3-compat.ts` re-exporting old names, homemade
     accessors on services). It freezes the codebase between versions.
   - No `any`, no `as` to silence a post-migration error. The error usually means the replacement has a
     different shape.
   - No invented APIs: every replacement traces to the rename map, a topic guide, or the v4 source.
   - Check runtime-only changes that typecheck silently: `partition` order, structural `Equal`,
     `forEach`/`all` still sequential by default, layer sharing across `provide` calls, keep-alive, defects in
     `Effect.ignore`.
8. **Done** = `tsc --noEmit` clean, tests run (report results honestly; do not weaken tests), and
   language-service diagnostics clean (`outdatedApi` catches leftover v3 names; see `references/review.md`).
   The summary lists every constructed (non-mechanical) replacement and every gap reported instead of bridged.

## Structural changes, before and after

Before blocks are v3 (not compiled). After blocks typecheck against 4.0.0.

### Services: `Context.Tag` / `Effect.Service` → `Context.Service` + explicit Layer

v3 `Effect.Service` generated `.Default` and wired `dependencies`; `Effect.Tag` added static accessors. v4 has
neither: define the layer yourself and access the service with `yield*` (or `X.use` for a one-liner).
Accessors were removed because they erased generic method signatures.

```ts nocheck
class Users extends Effect.Service<Users>()("Users", {
  effect: Effect.gen(function*() {
    const db = yield* Database
    return { find: (id: string) => db.query(id) }
  }),
  dependencies: [Database.Default],
  accessors: true
}) {}
const program = Users.find("1").pipe(Effect.provide(Users.Default))
```

```ts
import { Context, Effect, Layer } from "effect"

class Database extends Context.Service<Database, {
  readonly query: (id: string) => Effect.Effect<string>
}>()("@app/Database") {
  static readonly layer = Layer.succeed(Database, Database.of({ query: (id) => Effect.succeed(`row ${id}`) }))
}

class Users extends Context.Service<Users, {
  readonly find: (id: string) => Effect.Effect<string>
}>()("@app/users/Users") {
  static readonly layerNoDeps = Layer.effect(
    Users,
    Effect.gen(function*() {
      const db = yield* Database
      return Users.of({ find: Effect.fn("Users.find")((id: string) => db.query(id)) })
    })
  )
  static readonly layer = Users.layerNoDeps.pipe(Layer.provide(Database.layer))
}

const program = Effect.gen(function*() {
  const users = yield* Users
  return yield* users.find("1")
}).pipe(Effect.provide(Users.layer))
```

Also: `Context.GenericTag<T>(id)` → `Context.Service<T>(id)`; `Context.Reference` is now a function
(`Context.Reference<T>(id, { defaultValue })`); `Layer.scoped` → `Layer.effect` (it excludes `Scope`);
`Layer.scopedDiscard` → `Layer.effectDiscard`. Layer naming: `layer` (default) instead of `Default`/`Live`.

### FiberRef → Context.Reference / References

```ts nocheck
Effect.locally(program, FiberRef.currentMinimumLogLevel, LogLevel.Debug)
const level = yield* FiberRef.get(FiberRef.currentLogLevel)
```

```ts
import { Effect, References } from "effect"

const program = Effect.gen(function*() {
  const level = yield* References.CurrentLogLevel
  yield* Effect.logDebug("level", level)
})

export const debug = program.pipe(Effect.provideService(References.MinimumLogLevel, "Debug"))
```

### Runtime: `Runtime<R>` removed

```ts nocheck
const runtime = yield* Effect.runtime<Logger>()
Runtime.runFork(runtime)(program)
const rt = ManagedRuntime.make(AppLive); await rt.runPromise(program)   // unchanged in v4
NodeRuntime.runMain(program)                                            // from @effect/platform-node
```

```ts
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Context, Effect, Layer } from "effect"

class Greeter extends Context.Service<Greeter, { readonly greet: (n: string) => Effect.Effect<void> }>()("@app/Greeter") {
  static readonly layer = Layer.succeed(Greeter, Greeter.of({ greet: (n) => Effect.log(`hi ${n}`) }))
}

// A framework callback that must run an effect: capture the context, run with it.
export const makeHandler = Effect.gen(function*() {
  const ctx = yield* Effect.context<Greeter>()
  return (name: string) => Effect.runPromiseWith(ctx)(Greeter.use((g) => g.greet(name)))
})

// Entry point: one runMain, layers provided once.
const main = Greeter.use((g) => g.greet("world"))
main.pipe(Effect.provide([Greeter.layer, NodeServices.layer]), NodeRuntime.runMain)
```

For a long-running service graph prefer `Layer.launch(AppLayer).pipe(NodeRuntime.runMain)`.
`ManagedRuntime.make(layer)` is unchanged and is the bridge for frameworks (one per process; dispose on
shutdown). `NodeContext.layer` → `NodeServices.layer` (FileSystem, Path, Crypto, Stdio, Terminal,
ChildProcessSpawner).

### Errors and Cause

| v3 | v4 |
|---|---|
| `Effect.catchAll` / `catchAllCause` / `catchAllDefect` | `Effect.catch` / `catchCause` / `catchDefect` |
| `Effect.catchSome` / `catchSomeCause` | `Effect.catchFilter` / `catchCauseFilter` |
| `Effect.tapErrorCause`, `Effect.orElse`, `Effect.zipRight`, `Effect.dieMessage`, `Effect.async` | `tapCause`, `catch`, `andThen`, `die`, `callback` |
| `Effect.either` | `Effect.result` |
| `Cause` tree (`Sequential`/`Parallel`) | flat `cause.reasons` with `Cause.isFailReason` / `isDieReason` / `isInterruptReason` |
| `Cause.isFailure` / `isDie` / `isInterrupted` | `Cause.hasFails` / `hasDies` / `hasInterrupts` |
| `Cause.failureOption` / `failureOrCause` / `dieOption` | `Cause.findErrorOption` / `findError` (a `Result`) / `findDefect` |
| `Cause.NoSuchElementException`, `TimeoutException`, `UnknownException` | `Cause.NoSuchElementError`, `TimeoutError`, `UnknownError` |
| `Schema.TaggedError<E>()("Tag", fields)` | same; non-tagged: `Schema.Error<E>("Id")(fields)` |

```ts nocheck
program.pipe(
  Effect.catchAll((e) => Effect.succeed(String(e))),
  Effect.catchAllCause((c) => Cause.isDie(c) ? Effect.succeed("defect") : Effect.failCause(c))
)
```

```ts
import { Cause, Data, Effect } from "effect"

class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}

const find = (id: string): Effect.Effect<string, NotFound> =>
  id === "1" ? Effect.succeed("alice") : Effect.fail(new NotFound({ id }))

export const program = find("2").pipe(
  Effect.catchTag("NotFound", (e) => Effect.succeed(`missing ${e.id}`)),
  Effect.catchCause((cause) =>
    Cause.hasDies(cause) ? Effect.succeed("defect") : Effect.failCause(cause)
  )
)
```

### Either → Result; Option and Result no longer yieldable

`Either<R, L>` (right-first) → `Result<A, E>` (success-first): `Either.right/left` → `Result.succeed/fail`,
`.right/.left` → `.success/.failure`, `Either.isRight` → `Result.isSuccess`. `partition`-style helpers now
return `[successes, failures]`.

```ts nocheck
const n = yield* Option.some(1)          // worked in v3 (Option was an Effect)
const r = yield* Either.right(2)
```

```ts
import { Effect, Option, Result } from "effect"

export const program = Effect.gen(function*() {
  const n = yield* Effect.fromOption(Option.some(1))       // fails with Cause.NoSuchElementError on None
  const r = yield* Effect.fromResult(Result.succeed(2))
  const e = yield* Effect.result(Effect.fail("boom"))      // Result<never, string>
  return Result.isSuccess(e) ? n + r : n
})
```

The same "no longer an Effect" rule covers `Ref`, `Deferred` and `Fiber`: use `Ref.get(ref)`,
`Deferred.await(d)`, `Fiber.join(f)`. Services are still `yield*`-able. `Config` is still an `Effect` in 4.0.0
(`interface Config<T> extends Effect<T, ConfigError>`), so `yield* config` keeps working.

### Forking

```ts nocheck
const f = yield* Effect.fork(work)
const d = yield* Effect.forkDaemon(background)
```

```ts
import { Effect, Fiber } from "effect"

export const program = Effect.gen(function*() {
  const f = yield* Effect.forkChild(Effect.succeed(1))
  yield* Effect.forkScoped(Effect.never)                           // tied to the enclosing Scope
  const d = yield* Effect.forkDetach(Effect.log("background"), { startImmediately: true })
  yield* Fiber.interrupt(d)
  return yield* Fiber.join(f)
}).pipe(Effect.scoped)
```

`Effect.forkAll` and `forkWithErrorHandler` are gone: fork individually, or use `FiberSet`/`Effect.forEach`
with concurrency.

### Schema

The v4 Schema is a rewrite; `migration/schema.md` has the full table. The high-frequency changes:

```ts nocheck
const Status = Schema.Literal("a", "b")
const U = Schema.Union(A, B)
const R = Schema.Record({ key: Schema.String, value: Schema.Number })
const Email = Schema.String.pipe(Schema.pattern(/@/), Schema.minLength(3))
const Id = Schema.UUID
const Opt = Schema.optionalWith(Schema.Number, { default: () => 0 })
Schema.decodeUnknown(User)(input); Schema.decodeUnknownEither(User)(input)
```

```ts
import { Effect, Schema } from "effect"

const Status = Schema.Literals(["a", "b"])
const R = Schema.Record(Schema.String, Schema.Number)
const Email = Schema.String.check(Schema.isPattern(/@/), Schema.isMinLength(3))
const Id = Schema.String.check(Schema.isUUID())
const User = Schema.Struct({ id: Id, email: Email, status: Status, tags: R })

export const decode = (input: unknown) => Schema.decodeUnknownEffect(User)(input)
export const decodeExit = Schema.decodeUnknownExit(User)
export const fromJson = Schema.fromJsonString(User)
export const program = decode({}).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(null)))
```

Other renames: `Schema.Date` is now the `Date` instance schema (v3 `DateFromSelf`); v3 `Date` →
`DateFromString`. `Schema.Redacted` is the instance schema; v3 `Redacted` → `RedactedFromValue`.
`compose` → `decodeTo`; `transform` → `decodeTo(to, SchemaTransformation.transform({ decode, encode }))`;
`filter(pred)` → `check(Schema.makeFilter(pred))`; `pick/omit/partial/extend` → `mapFields(Struct.pick/omit/…)`
or spread `.fields`; `Schema.brand` takes one identifier and is type-only. Optional fields with defaults are a
manual case; read the `optionalWith` section of `schema.md`.

### Config

```ts nocheck
const port = Config.integer("PORT").pipe(Config.withDefault(3000))
const key = Config.redacted("API_KEY")
Layer.setConfigProvider(ConfigProvider.fromMap(new Map([["PORT", "8080"]])))
```

```ts
import { Config, ConfigProvider, Effect } from "effect"

const AppConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(3000)),
  apiKey: Config.Redacted("API_KEY")
})

export const program = Effect.gen(function*() {
  const { port } = yield* AppConfig
  return port
}).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ PORT: "8080", API_KEY: "k" }))))
```

Constructors are PascalCase (`String`, `Number`, `Int`, `Boolean`, `Port`, `Duration`, `Redacted`, `URL`,
`Literal(s)`, `Array(schema)`, `Record(key, value)`), `Config.mapOrFail` → `Config.mapEffect`,
`Config.validate` → `Config.schema`/checks.

### Platform package moves

| v3 | v4 |
|---|---|
| `@effect/platform/HttpClient` (+ Request/Response/Error) | `effect/http` |
| `@effect/platform/HttpApi*`, `OpenApi` | `effect/http-api` |
| `@effect/platform/HttpRouter`, `HttpLayerRouter`, `HttpServer` | `effect/http` |
| `@effect/platform/FileSystem`, `Path`, `Terminal`, `Error` | `effect/FileSystem`, `effect/Path`, `effect/Terminal`, `effect/PlatformError` |
| `@effect/platform/Command`, `CommandExecutor` | `effect/process` (`ChildProcess`, `ChildProcessSpawner`) |
| `@effect/platform/KeyValueStore`, `@effect/experimental/Persistence`, `RateLimiter` | `effect/persistence` |
| `@effect/rpc/*`, `@effect/sql/*`, `@effect/cli/*`, `@effect/ai/*`, `@effect/cluster/*`, `@effect/workflow/*` | `effect/rpc`, `effect/sql`, `effect/cli`, `effect/ai`, `effect/cluster`, `effect/workflow` |
| `effect/STM`, `TRef`, `TMap`, `TQueue` | `Effect.tx` + `TxRef`, `TxHashMap`, `TxQueue` |
| `effect/Micro` | removed; use `Effect` |
| `@effect/platform-node/NodeContext` | `@effect/platform-node/NodeServices` |

Resolve every other path with `rg -n '^<v3 path> ' migration/v3-to-v4.md`.

### Testing

```ts nocheck
import { it } from "@effect/vitest"
import { TestClock } from "effect"
it.scoped("x", () => Effect.gen(function*() { /* ... */ }))     // it.scoped no longer exists
```

```ts
import { assert, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"

it.effect("sleeps on the test clock", () =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Effect.sleep("1 minute").pipe(Effect.as("done")))
    yield* TestClock.adjust("1 minute")
    assert.strictEqual(yield* Fiber.join(fiber), "done")
  }))
```

`it.effect` already provides a `Scope`, `TestClock` and `TestConsole`, so `it.scoped`/`it.scopedLive` are
gone (and silently never register if you call them). Property tests: `it.effect.prop` with Schemas or
`effect/Arbitrary`, options `{ arbitrary: { runs, seed } }`. More in `references/testing.md`.

---

## RC/beta → 4.0.0

**Mechanical (sed-able).** Run on imports only; review the diff.

```sh
rg -l "effect/unstable/" src | xargs sed -i '' \
  -e 's#effect/unstable/httpapi#effect/http-api#g' \
  -e 's#effect/unstable/arbitrary/Arbitrary#effect/Arbitrary#g' \
  -e 's#effect/unstable/arbitrary#effect/Arbitrary#g' \
  -e 's#effect/unstable/#effect/#g'
# GNU sed: drop the '' after -i
```

| RC/beta | 4.0.0 | Since |
|---|---|---|
| `effect/unstable/<area>[/Module]` | `effect/<area>[/Module]` (no shims; still `@stability unstable`) | rc.118 |
| `effect/unstable/httpapi` | `effect/http-api` | rc.118 |
| `effect/unstable/arbitrary` | `import { Arbitrary } from "effect"` / `effect/Arbitrary` | rc.118 |
| `import { Encoding } from "effect"` | `effect/encoding/Base64`, `Base64Url`, `Hex`, `EncodingError`; `Encoding.randomHex` → `Hex.random` | rc.118 |
| `effect/unstable/encoding/Msgpack` | removed | rc.113 |
| `@effect/platform-node/Mime` | `effect/http/Mime` | rc.113 |

New barrel: `effect/net` (`NetAddress`, `IpNetwork`, `IpInterface`).

**Non-mechanical** (each needs reading the call site):

| Change | What to do | Since |
|---|---|---|
| `Array`/`Chunk`/`Effect`/`Record.partition`, `separate`, `Option.partitionMap` return `[successes, failures]`; `Array.partition` takes a `Result`-returning filter | swap destructuring order; rewrite boolean predicates | 4.0.0 |
| `Schema.brand` takes exactly one identifier and is type-only | chain `brand` per identifier; add checks for runtime enforcement; `Schema.fromBrand` for constructor checks | 4.0.0 |
| `TestSchema` unstable; `verifyLosslessTransformation` | → `verifyRoundTrip` | 4.0.0 |
| Schema check renames | `isLengthBetween` → `isBetweenLength`, `isSizeBetween` → `isBetweenSize`, `isPropertiesLengthBetween` → `isBetweenProperties`, `isStartsWith` → `isStartingWith`, `isEndsWith` → `isEndingWith`, `isIncludes` → `isIncluding` | rc.118 |
| `Scope.close` / `closeUnsafe` require `Scope.Closeable` | close only scopes from `Scope.make` / `Scope.fork` | rc.118 |
| `HttpRouter` entrypoints build fresh routers | routes no longer leak between servers; register routes in the layer you serve | rc.118 |
| `Effect.repeat` with a `while`/`until` refinement narrows the result only when the options have no `schedule`/`times` | re-narrow explicitly when you pass a bound | rc.118 |
| `Queue.State.takers` entries are `Queue.Taker` | call `.resume` | 4.0.0 |
| `Effect.orElseSucceed` passes the error to the fallback | update the callback arity if it relied on none | rc.116 |
| `SchemaTransformation.make` → `makeTransformation`; `Transformation#compose` → `composeTransformation`; `Stream.partition` → `[passes, fails]`; `Stream.mapBoth({ onElement, onError })` | rename | rc.116 |
| Config constructors PascalCase (`Config.string` → `Config.String`, `redacted` → `Redacted`), `mapOrFail` → `mapEffect`; CLI constructors PascalCase | rename | rc.113 |
| `SchemaGetter.transformOrFail` → `transformEffect`; `Effect.try`/`tryPromise` single-arg form fails with `UnknownError`; `SynchronizedRef` no longer a `Ref`; `Channel.runDone` removed; `Socket` pull-based redesign | per call site | rc.113 |
| `Schedule.both/either/andThen/take` (never existed in v4) | `Schedule.max([..])` / `min([..])` / `concat` / `upTo({ times })` | — |
| `Schema.TaggedErrorClass` → `Schema.TaggedError`; `Schema.ErrorClass` → `Schema.Error` | rename | beta.104 |
| `ServiceMap` module → `Context` (`ServiceMap.Service` → `Context.Service`) | rename | beta.44 |

Then typecheck, run tests, and run the language-service diagnostics. Read
`packages/effect/CHANGELOG.md` in the repo at the target tag (the npm package does not ship it) from your RC version up
for anything specific to the modules you use.

---

## Vendoring the source for agents

Agents write better Effect from source than from docs. Two options:

1. **Rely on the package.** 4.0.0 ships `node_modules/effect/AGENTS.md`, `ai-docs/` (checked examples) and
   `src/`. Point the repo's `AGENTS.md` at them: "Before writing Effect code, read
   `node_modules/effect/AGENTS.md`; confirm APIs in `node_modules/effect/dist/*.d.ts`."
2. **Vendor the repo** (official recommendation, effect.website blog), pinned to the installed tag:

   ```sh
   git subtree add --prefix=repos/effect https://github.com/Effect-TS/effect.git effect@4.0.0 --squash
   git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git effect@<new> --squash   # on upgrade
   ```

   Exclude it from tooling (`.vscode/settings.json`):

   ```json
   {
     "typescript.preferences.autoImportFileExcludePatterns": ["repos/**"],
     "files.watcherExclude": { "repos/**": true },
     "search.exclude": { "repos/**": true }
   }
   ```

   Also exclude `repos/**` from `tsconfig` `include`, lint and test globs. Add to `AGENTS.md`:

   ```md
   ## Vendored repositories
   - `repos/effect` is read-only reference for Effect v4 (tag matches package.json). Read `repos/effect/LLMS.md`
     before writing Effect code; prefer its patterns, tests and `ai-docs/` over guesses.
   - Never edit or import from `repos/`.
   ```

   A plain shallow clone works for one-off migrations:
   `git clone --depth 1 --branch effect@4.0.0 https://github.com/Effect-TS/effect .repos/effect`.

**Stale-clone gotcha.** An existing `.repos/effect` may come from `Effect-TS/effect-smol`, which is stale
(last push July 2026, pre-4.0.0 paths, no `migration/v3-to-v4.md`). Verify before trusting any checkout:

```sh
git -C .repos/effect remote get-url origin              # must be github.com/Effect-TS/effect
git -C .repos/effect describe --tags                    # must match the installed version, e.g. effect@4.0.0
node -p "require('./.repos/effect/packages/effect/package.json').version"
test -f .repos/effect/migration/v3-to-v4.md && echo ok
```

If the origin is `effect-smol` or the tag differs from `node_modules/effect/package.json`, delete and
re-clone. Citations (`file:line`) into a vendored tree go stale on every bump; re-check them after upgrading.
