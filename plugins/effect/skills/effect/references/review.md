# Reviewing Effect code

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

Use this file to audit an Effect codebase, review a diff, or self-review before calling work done.
Most review failures come from reviewing from memory. Your defaults are v3-shaped, so every finding
needs evidence from the installed package.

## Contents

- [Review procedure](#review-procedure)
  - [1. Version gate](#1-version-gate)
  - [2. Evidence gate](#2-evidence-gate)
  - [3. Severity tiers](#3-severity-tiers)
  - [4. Findings format](#4-findings-format)
  - [5. Fix order (bottom-up DAG)](#5-fix-order-bottom-up-dag)
- [Smell catalog A: hand-rolled platform capability](#smell-catalog-a-hand-rolled-platform-capability)
- [Smell catalog B: against the grain](#smell-catalog-b-against-the-grain)
- [Language-service diagnostics](#language-service-diagnostics)
- [Other enforcement: oxlint, ast-grep](#other-enforcement-oxlint-ast-grep)
- [False greens in tests](#false-greens-in-tests)
- [Grep recipes](#grep-recipes)
- [The Effect-expert seat](#the-effect-expert-seat)

---

## Review procedure

### 1. Version gate

Resolve the installed major before judging anything:

```sh
node -p "require('effect/package.json').version"     # from the package that imports effect
npm ls effect                                         # or: pnpm why effect — more than one copy is itself a BUG
```

- **v3 installed:** review against v3 idioms. Do not "fix" `Context.Tag`, `Effect.Service`, `catchAll` or
  `Either` into v4 shapes. That is a migration, a separate task the user has to ask for (see
  `references/migration.md`).
- **v4 installed:** every `@effect/*` package must be on the same exact version as `effect`. A mismatch shows
  up as confusing errors, such as "service not provided" when it plainly is (two tag identities) or
  `Cannot find module '.../effect/dist/Arbitrary.js'`. Any `effect/unstable/...` import is a stale-RC
  BUG at 4.0.0, because those paths were removed with no shims.
- Read the repo's `AGENTS.md`/`CLAUDE.md` first. Deliberate hand-rolls (a custom retry kept for a documented
  compatibility reason, a sync hot path that avoids fiber overhead) are policy, not smells.

### 2. Evidence gate

A finding is admissible only if it passes all of these:

| Check | What to show |
|---|---|
| API exists | The replacement API's signature from `node_modules/effect/dist/<Module>.d.ts` or `src/<Module>.ts`, cited as `file:line`. Never cite from memory or an external skill. |
| Behavior is equivalent | Argue it explicitly. The usual traps: `Effect.cached` and `Cache` **cache failures** too (a hand-rolled memo that retries on failure is not equivalent); `Effect.retry({ while })` versus the original retried error set; `Effect.forEach` without `concurrency` is **sequential**, and adding concurrency changes ordering of side effects; `Effect.timeout` interrupts, so finalizers now run; `Equal.equals` is structural in v4 but respects custom `Equal` implementations. |
| Not deliberate | Nothing in the repo docs or nearby comments explains the hand-roll. |
| No new dependency | Effect-only rewrites. A fix that needs a new runtime package is a ticket, not a change. |
| Reachable, and not a hot path | Dead code is FINE to leave. On a measured hot path, `Effect.gen` overhead may be the reason for plain code. Perf claims need a measurement. |

Landing nothing is a valid outcome. A review that files three well-evidenced tickets beats a diff of twenty
plausible rewrites. Disqualified changes: anything uncitable, behavior changes dressed as cleanup, bulk
codemods (ticket them), loosened test assertions, snapshots regenerated without reading them.

### 3. Severity tiers

| Tier | Meaning | Examples |
|---|---|---|
| **BUG** | Wrong behavior now, or under a reachable input | floating effect (never runs); `runPromise` inside a handler drops services/spans/interruption; `yield* someOption` (dies at runtime: "Not a valid effect"); `try/catch` around `yield*` that never catches; `Scope` leaked by forking without a scope; duplicate `effect` copies |
| **PERF** | Measurably slow or wasteful | sequential `forEach` over independent IO; layer built per request; `Schema.decodeUnknownSync` rebuilt in a loop; repeated work a `Cache` would absorb |
| **SCHEMA** | Boundary data not modeled | `JSON.parse` + `as`; bare `Schema.brand` without checks; `interface` duplicating a nearby Schema; `Record<string, unknown>` crossing a boundary |
| **ARCH** | Wrong seam or dependency direction | `Effect.provide` deep inside library code; service methods leaking infra deps in `R`; services as plain objects or functions with dependency params; layers built in functions |
| **IDIOM** | Works, but against the grain; costs readers | Do-notation; `Effect.fail(new E())` inside gen instead of `yield* new E()`; `catch` + manual `_tag` checks instead of `catchTag`; `Effect.fn` IIFE |
| **FINE** | Looked suspicious, confirmed correct | record **why** in the review, so the next agent does not "fix" it |

### 4. Findings format

Rank by tier, then by blast radius. One finding per root cause, not per occurrence (list the occurrences
under it).

```md
### BUG-1 · src/orders/OrderService.ts:42 · floating effect
Rule: floatingEffect (language service) / catalog B1
Input that fails: any call to `place()` — the `Effect.logError(...)` statement is built and discarded, so
  the failure audit log is never written.
Evidence: Effect.logError returns Effect<void> (node_modules/effect/dist/Effect.d.ts:<line>).
Fix: `yield* Effect.logError("order failed", { orderId })`.
Equivalence: adds one log line; no other behavior change.
Test: OrderService.test.ts "logs failed orders" (fails before the fix, passes after).
```

Give a **concrete failing input** for every BUG. "Could be a problem" is not a BUG; it is either IDIOM or
a question to the user.

### 5. Fix order (bottom-up DAG)

Fix in dependency order, so each layer compiles against the corrected one below it:

1. **Schemas and errors** (data shapes, `Schema.TaggedError`/`Data.TaggedError` classes)
2. **Service interfaces** (`Context.Service` shapes; `R = never` on methods)
3. **Implementations** (layers: `layer`, `layerNoDeps`, `layerTest`)
4. **Handlers and entry points** (HTTP/RPC/CLI, `Layer.launch`, `runMain`, `ManagedRuntime`)
5. **Tests**
6. **Idioms** (only after the above are green)

Gate every step on `tsc --noEmit` (with Effect diagnostics, see below) plus the tests for the touched
package. Within a step, discarded effects go first, because they hide every other bug. Root-cause first:
group violations (local fix / restructure / documented exception) and count before and after. No
suppressions or casts to make a step green; an exception needs a comment and a test.

---

## Smell catalog A: hand-rolled platform capability

Each row: what you see → the Effect primitive → the equivalence trap to check before rewriting.

| # | Smell | Replace with | Check before rewriting |
|---|---|---|---|
| A1 | `for (attempt…)` + `setTimeout` retry, manual backoff math | `Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.jittered, Schedule.upTo({ times: 5 })))`; `Effect.retry({ times, while })` | Which errors were retried? Translate the filter into `while`. Combine schedules with `Schedule.max([..])` (AND) / `Schedule.min([..])` (OR). `both`/`either`/`take`/`andThen` do not exist. |
| A2 | module-level `Map` memo, `let cached` promise | `Effect.cached` / `Effect.cachedWithTTL` (one value); `Cache.make({ lookup, capacity })` (keyed) | Both cache **failures**. Use `Cache.makeWith(lookup, { capacity, timeToLive: (exit) => … })` to expire failures quickly. `capacity` is required. |
| A3 | `JSON.stringify(a) === JSON.stringify(b)` | `Equal.equals(a, b)` (structural by default in v4) | Key order, `undefined`, `Date` handling differ. Equal results are hash-cached on the object: do not mutate after comparing. |
| A4 | `process.env.X` (with `?? default`, `Number(...)`) | `Config.String("X")`, `Config.Port`, `Config.withDefault`, `Config.schema`; tests use `ConfigProvider.layer(ConfigProvider.fromUnknown({...}))` | Missing-value behavior: `Config` fails with a typed error instead of `undefined`. |
| A5 | secret in a plain `string` field | `Config.Redacted("API_KEY")` → `Redacted.Redacted<string>`; `Redacted.value` only at the call that needs it | Logging and `toString` now print `<redacted>`; check nothing parsed the logged value. |
| A6 | `import fs from "node:fs"`, `node:path`, `node:child_process` | `FileSystem`, `Path`, `ChildProcessSpawner` (from `effect/process`) services, provided by `NodeServices.layer` | Genuine escapes (perf-critical streams, APIs Effect lacks) get a comment, not a rewrite. |
| A7 | `fetch(...)` | `HttpClient` (`effect/http`) + `FetchHttpClient.layer` / `NodeHttpClient.layerUndici` | `HttpClient` does not fail on 4xx/5xx by default; add `HttpClient.filterStatusOk` to keep the old `if (!res.ok) throw` behavior. |
| A8 | `Date.now()`, `new Date()` | `Clock.currentTimeMillis`, `DateTime.now` | Under `TestClock` time starts at epoch 0; tests that assumed wall time need `TestClock.setTime`. |
| A9 | `Math.random()`, `crypto.randomUUID()` | `Random.next`, `Random.nextIntBetween`; the `Crypto` service's `randomUUIDv4`/`randomUUIDv7`/`randomULID` | `Crypto` methods can fail with `PlatformError`; `Crypto` must be provided (`NodeServices.layer`). |
| A10 | `console.log/error` | `Effect.log`, `Effect.logError`, `Effect.annotateLogs`, `Logger.layer([...])` | `Logger.layer` replaces the logger set unless `{ mergeWithExisting: true }`. |
| A11 | `setTimeout`/`setInterval` | `Effect.sleep`, `Effect.repeat(Schedule.spaced(...))`, `Effect.timeout` | Interruption now cancels the wait; old timers kept running. |
| A12 | `Promise.all(items.map(f))` | `Effect.forEach(items, f, { concurrency: n })`; `Effect.all(effects, { concurrency })` | Default is **sequential**. `Promise.all` was unbounded; pick a bound. First failure interrupts siblings (Promise.all left them running). |
| A13 | `try { … } catch (e) { … }` around side effects | `Effect.try({ try, catch: (e) => new MyError({ cause: e }) })`, `Effect.tryPromise({ try, catch })` | The single-function form fails with `Cause.UnknownError`; give `catch` for a typed error. |
| A14 | `if (err._tag === "X")` / `instanceof` ladders | `Effect.catchTag("X", …)`, `catchTags({...})`, `Match.tagsExhaustive`, `Predicate.isTagged` | `catchTag` that fails to typecheck means the tag is not in `E`; read the inferred channel. |
| A15 | hand-rolled `{ ok, value, error }` | the `E` channel; `Result` for pure code (`Result.succeed/fail`) | Bridge into gen with `Effect.fromResult`, never `yield* result`. |
| A16 | custom queue, pubsub, latch, semaphore, pool, rate limiter, debounce cache | `Queue`, `PubSub`, `Latch`, `Semaphore`, `Pool`, `RcMap`, `RateLimiter` (`effect/persistence`, needs `RateLimiter.layerStoreMemory`), `FiberSet`/`FiberMap` for background tasks | Capacity and back-pressure semantics; `RcMap`/`Pool.get` need a `Scope`. |
| A17 | `typeof x === "string"` guards on unknown input | decode with Schema at the boundary; `Predicate.isString` for internal guards | — |
| A18 | ms arithmetic (`5 * 60 * 1000`) | `Duration.minutes(5)` or `"5 minutes"` (`Duration.Input`) | — |
| A19 | calendar math by hand: adding months or days in ms, start-of-day, computing the next run | `DateTime.add(dt, { months: 1 })`, `DateTime.startOf`, `Cron.parse` + `Cron.next` | Month-end clamping and time zones differ. A domain rule with its own clamp stays hand-written, with the reason recorded. |
| A20 | hand-written matching or graph search (pairing, cycles, reachability) | `Graph` (`Graph.maximumBipartiteMatching`, traversals) | A greedy domain rule (nearest date first) is not a maximum matching. Keep it when the rule is the contract. |
| A21 | decimal rounding by string or float math | `BigDecimal.round(x, { scale, mode: "half-from-zero" })`, `BigDecimal.scale` | Pin the mode with literal tie fixtures (`x.5`, `-x.5`). A money codec with its own wire format is not a rounding site. |
| A22 | a per-file test runner (`const run = (e) => Effect.runPromise(e.pipe(Effect.provide(L)))`) | `it.effect` / `layer(L)` from `@effect/vitest`, or the project's bun:test equivalent (`references/testing.md` §1) | Each copy escapes `TestClock` and `Scope`. Fix the shared harness once. |
| A23 | polling an in-process store on an interval to notice writes | `SqlClient.reactive(keys, query)` + `Reactivity.mutation(keys, write)` | Invalidate after COMMIT. Keep a slow fallback poll when writers live in another process. |
| A24 | re-parsing or re-counting what `effect/ai` already returns (JSON text, token counts, retry hints) | `LanguageModel.generateObject({ schema })` `.value`, `response.usage`, `AiError` `RateLimitError.retryAfter` | Usage on a failed attempt and provider-specific fields may still need the raw response. |

A short paired example (A1 + A12 + A13):

```ts nocheck
// before
async function syncAll(ids: string[]) {
  return Promise.all(ids.map(async (id) => {
    for (let i = 0; i < 3; i++) {
      try { return await fetch(`/api/${id}`).then((r) => r.json()) }
      catch (e) { await new Promise((r) => setTimeout(r, 2 ** i * 100)) }
    }
    throw new Error("gave up")
  }))
}
```

```ts
import { Effect, Schedule, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

const Item = Schema.Struct({ id: Schema.String, name: Schema.String })

const fetchItem = Effect.fn("fetchItem")(function*(id: string) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const res = yield* client.get(`/api/${id}`)
  return yield* HttpClientResponse.schemaBodyJson(Item)(res)
})

export const syncAll = (ids: ReadonlyArray<string>) =>
  Effect.forEach(
    ids,
    (id) =>
      fetchItem(id).pipe(
        Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 3 })))
      ),
    { concurrency: 8 }
  )
```

---

## Smell catalog B: against the grain

| # | Smell | Why it is wrong | Fix |
|---|---|---|---|
| B1 | **Floating effect**: `Effect.log(...)` / `ref.set(x)` as a bare statement in a gen or callback | Effects are values; a discarded one never runs | `yield*` it (or return it). Make `floatingEffect` an error. |
| B2 | `Effect.runPromise`/`runSync`/`runFork` inside an Effect, a service, or library code | Escapes the current fiber: services, spans, log annotations, interruption and `TestClock` are lost | `yield*` the effect. At framework bridges capture `const ctx = yield* Effect.context<R>()` and use `Effect.runPromiseWith(ctx)`, or one `ManagedRuntime` per process. |
| B3 | `Effect.provide` outside entry points; chained `.pipe(Effect.provide(A), Effect.provide(B))` | Hides dependencies from the type; chained provides create separate lifecycles | Compose once: `Layer.provide([A, B])` / `Layer.mergeAll`, provide at the edge (`Layer.launch`, `runMain`, test). |
| B4 | Layer built inside a function or getter (`const live = () => Layer.effect(...)`) | Layers memoize **by reference**; each call is a new layer, so resources get built twice (two pools) | Module-level `const` or `static readonly layer`. Parameterized? Build once at the root. |
| B5 | Service method typed `Effect<A, E, Database>` | Infra dependency leaks to every caller and test | Resolve deps in the layer constructor; methods have `R = never`. Keep caller-supplied context (request, tenant) in `R` only deliberately. |
| B6 | Service as a plain object literal or function taking deps as params | No identity in the context; cannot be swapped in tests | `class X extends Context.Service<X, Shape>()("pkg/X") {}` + `Layer.effect(X, make)` returning `X.of({...})`. Pure helpers with no deps stay plain functions. |
| B7 | `Effect.orDie` over a recoverable failure | Turns a typed error the caller could handle into a defect | Keep it in `E`, or map to a domain error. `orDie` is for "impossible" failures and layer build errors you choose not to handle. |
| B8 | `catch` that widens or erases `E` (`Effect.catch(() => Effect.fail("failed"))`, `mapError(String)`) | Callers can no longer `catchTag` | Map to a tagged domain error that keeps the original as `cause`. |
| B9 | `E` typed `unknown`, `Error`, `string` | Uncatchable by tag; `anyUnknownInErrorContext`, `globalErrorInEffectFailure` | `Schema.TaggedError` (crosses a wire/journal) or `Data.TaggedError` (in-process). |
| B10 | `try/catch` around `yield*` in a gen | Effect failures are not thrown; the catch never runs (and `finally` does not see failures) | `Effect.catchTag`, `Effect.result`, `Effect.exit`, `Effect.ensuring`, `Effect.acquireRelease`. |
| B11 | Silent catch-all: `Effect.catch(() => Effect.void)`, `Effect.ignore` on business logic | Swallows bugs; v4 `ignore` handles failures only, defects still fail | `Effect.tapError(Effect.logError)` before the fallback; recover only named tags. |
| B12 | `Effect.Do` / `bind` / `let`, `Effect.gen(function*($) { yield* $(x) })` | Removed adapter; Do-notation is the long way | `Effect.gen` / `Effect.fn`. |
| B13 | `Effect.fn("x")(function*() {...})()` (IIFE), or `(id) => Effect.fn("x")(function*() { … id … })()` | Builds a reusable traced function to call it once; params on the wrong function | `Effect.gen(...).pipe(Effect.withSpan("x"))`, or put the params on the generator. |
| B14 | `Effect.forEach`/`Effect.all` over independent IO without `concurrency` | Sequential by default | `{ concurrency: n }` (or `"unbounded"` when the input is small and bounded). |
| B15 | `Effect.fn` on every tiny helper, or on none | Spans everywhere are noise; nowhere means no traces | `Effect.fn("Service.method")` on service methods and boundary functions; `Effect.fnUntraced` for internal helpers. |
| B16 | `Effect.log(\`user ${JSON.stringify(user)}\`)` | Unstructured, leaks PII, defeats log search | `Effect.log("user loaded").pipe(Effect.annotateLogs({ userId }))`; bounded, safe attributes only. |
| B17 | `yield* option` / `yield* result` in `Effect.gen` | Type error, and dies at runtime ("Not a valid effect") | `yield* Effect.fromOption(o)` (fails `NoSuchElementError`), `Effect.fromResult(r)`, `Effect.fromNullishOr(x)`. |
| B18 | `Effect.forkChild`/`forkDetach` with the fiber never joined, awaited or scoped | Failures are reported nowhere; detached fibers outlive their owner | `Effect.forkScoped`, `FiberSet.run`, or `Fiber.join`. |
| B19 | `as` casts at boundaries (`JSON.parse(body) as User`, `as unknown as Effect<…>`) | Lies to the compiler; `unsafeEffectTypeAssertion` | `Schema.decodeUnknownEffect(User)(input)`. Every remaining `as` (except `as const`) needs a justification comment. |
| B20 | Bare `Schema.brand("UserId")` on `Schema.String` | Brands are type-only in 4.0.0: they enforce nothing at runtime | Add checks: `Schema.String.check(Schema.isUUID()).pipe(Schema.brand("UserId"))`. |
| B21 | `Record<string, unknown>` / `unknown` parameters crossing a module boundary | Pushes parsing to every consumer | A Schema at the boundary; typed shapes inside. |
| B22 | `return someEffect` inside `Effect.gen` | Produces `Effect<Effect<A>>`; the inner one never runs | `return yield* someEffect`. |
| B23 | `yield* Effect.fail(new MyError())` | Verbose; tagged errors are yieldable | `return yield* new MyError({...})`. |
| B24 | `Effect.sync(() => fetch(...))`, `Effect.succeed(Date.now())` | Eagerness: a Promise in a sync effect is never awaited; `succeed` evaluates once at definition | `Effect.tryPromise`, `Effect.sync(() => Date.now())` (better: `Clock`). |
| B25 | `Layer.succeed(X, statefulImpl)` over module-level state in tests | State shared across tests | Build state inside `Layer.effect` so each provide gets fresh state. |
| B26 | `Match.orElse` as a convenience fallback over a tagged union | New union members silently fall through | `Match.tagsExhaustive` / `Match.exhaustive`. |
| B27 | `switch (x._tag)` with a manual `default: throw` | Not exhaustive at the type level | `Match.valueTags(x, {...})` or `Match.tagsExhaustive`. |

Paired example (B1, B2, B5, B10, B23):

```ts nocheck
class Orders extends Context.Service<Orders, {
  place: (o: Order) => Effect.Effect<void, unknown, Database>   // B5, B9
}>()("Orders") {}

const place = (o: Order) => Effect.gen(function*() {
  try {
    yield* save(o)                                                 // B10: never catches
  } catch (e) {
    Effect.logError("failed", e)                                   // B1: floating
    yield* Effect.fail(new Error("place failed"))                  // B9, B23
  }
  Effect.runPromise(notify(o))                                     // B2
})
```

```ts
import { Context, Effect, Layer, Schema } from "effect"

class OrderSaveError extends Schema.TaggedError<OrderSaveError>()("OrderSaveError", {
  orderId: Schema.String,
  cause: Schema.Defect()
}) {}

class Database extends Context.Service<Database, {
  readonly insert: (id: string) => Effect.Effect<void, OrderSaveError>
}>()("@app/Database") {}

class Notifier extends Context.Service<Notifier, {
  readonly notify: (id: string) => Effect.Effect<void>
}>()("@app/Notifier") {}

export class Orders extends Context.Service<Orders, {
  readonly place: (orderId: string) => Effect.Effect<void, OrderSaveError>
}>()("@app/orders/Orders") {
  static readonly layerNoDeps = Layer.effect(
    Orders,
    Effect.gen(function*() {
      const db = yield* Database
      const notifier = yield* Notifier
      const place = Effect.fn("Orders.place")(function*(orderId: string) {
        yield* db.insert(orderId).pipe(
          Effect.tapError((e) => Effect.logError("order save failed").pipe(Effect.annotateLogs({ orderId: e.orderId })))
        )
        yield* notifier.notify(orderId)
      })
      return Orders.of({ place })
    })
  )
}
```

---

## Language-service diagnostics

The Effect Language Service turns most of catalog B into compiler output. Run it before calling work done:
agents walk past style advice but not past a failing `tsc`.

**Setup (TypeScript 7 / tsgo):**

```sh
npx @effect/tsgo setup                                  # wizard; replaces plain tsgo, not alongside it
npx @effect/tsgo diagnostics --project tsconfig.json    # one-shot report
```

**Setup (TypeScript 5.9/6, legacy plugin `@effect/language-service`):** add
`{ "name": "@effect/language-service" }` to `compilerOptions.plugins`, then
`npx effect-language-service patch` (add it to `"prepare"`) so `tsc` reports Effect diagnostics, or run
`npx effect-language-service diagnostics --project tsconfig.json` / `--file <path>` and
`quickfixes --file <path>` without patching. Editors show them only when using the workspace TypeScript.

Recommended plugin options (both packages share the option names):

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@effect/language-service",
        "ignoreEffectWarningsInTscExitCode": false,
        "ignoreEffectErrorsInTscExitCode": false,
        "ignoreEffectSuggestionsInTscExitCode": true,
        "includeSuggestionsInTsc": true,
        "diagnosticSeverity": {
          "floatingEffect": "error",
          "strictEffectProvide": "warning",
          "anyUnknownInErrorContext": "warning",
          "processEnvInEffect": "warning",
          "globalFetchInEffect": "warning"
        }
      }
    ]
  }
}
```

Many rules ship **off** (➖ below); listing them in a checklist enforces nothing until `diagnosticSeverity`
pins them. Suppress per site with `// @effect-diagnostics-next-line floatingEffect:off` plus a reason;
file-level with `// @effect-diagnostics floatingEffect:off`.

Default severity: ❌ error, ⚠️ warning, 💡 suggestion, ➖ off. "v3-only"/"v4-only" marks rules that apply to
one major. Names are from the language-service source (`src/diagnostics.ts`, 77 rules).

**Correctness**

| Rule | Sev | Flags | Fix |
|---|---|---|---|
| `anyUnknownInErrorContext` | ➖ | `any`/`unknown` in `E` or `R` | type the error / requirement |
| `classSelfMismatch` | ❌ | `Self` type param ≠ class name in Service/Schema classes | match the class name |
| `duplicatePackage` | ⚠️ | two versions of an Effect package loaded | dedupe; one version everywhere |
| `effectFnImplicitAny` | ❌ | unannotated `Effect.fn` params with no contextual type | annotate params |
| `floatingEffect` | ❌ | Effect neither yielded, returned nor assigned | `yield*` / return it |
| `genericEffectServices` | ⚠️ | service with type parameters (not discriminable at runtime) | make the method generic, not the service |
| `missingEffectContext` | ❌ | requirement missing from `R` | provide it or declare it |
| `missingEffectError` | ❌ | error missing from the declared `E` | widen the signature or handle it |
| `missingLayerContext` | ❌ | requirement missing from a Layer's `RIn` | `Layer.provide` it |
| `missingReturnYieldStar` | ❌ | `yield*` of a never-succeeding effect without `return` | `return yield*` |
| `missingStarInYieldEffectGen` | ❌ | `yield` instead of `yield*` | `yield*` |
| `nonObjectEffectServiceType` | ❌ | v3-only: `Effect.Service` with a primitive shape | object shape |
| `outdatedApi` | ⚠️ | v4-only: API removed or renamed in v4 | see `references/migration.md` |
| `outdatedEffectCodegen` | ⚠️ | generated code stale | regenerate |
| `overriddenSchemaConstructor` | ❌ | constructor override in a Schema class (breaks decoding) | static factory instead |
| `unsupportedServiceAccessors` | ⚠️ | accessors that need codegen (generic/overloaded methods) | `yield*` the service |

**Anti-pattern**

| Rule | Sev | Flags | Fix |
|---|---|---|---|
| `catchUnfailableEffect` | 💡 | error handling on `E = never` | remove the handler |
| `effectFnIife` | ⚠️ | `Effect.fn(...)(...)()` | `Effect.gen` + `withSpan` |
| `effectGenUsesAdapter` | ⚠️ | `function*($)` adapter | plain `yield*` |
| `effectInFailure` | ⚠️ | an Effect inside the error channel | flatten; fail with a value |
| `effectInVoidSuccess` | ⚠️ | nested Effect in a `void` success (never runs) | `yield*` / `flatMap` it |
| `globalErrorInEffectCatch` | ⚠️ | catch callback returns global `Error` | tagged error |
| `globalErrorInEffectFailure` | ⚠️ | global `Error` in `E` | tagged error |
| `layerMergeAllWithDependencies` | ⚠️ | `Layer.mergeAll` member requires another member | `Layer.provide` / `provideMerge` |
| `lazyPromiseInEffectSync` | ⚠️ | `Effect.sync` returning a Promise | `Effect.promise` / `tryPromise` |
| `leakingRequirements` | 💡 | infra services leaked into method `R` | resolve in the layer |
| `multipleEffectProvide` | ⚠️ | chained `Effect.provide` | one composed layer |
| `returnEffectInGen` | 💡 | `return effect` in gen → nested Effect | `return yield*` |
| `runEffectInsideEffect` | 💡 | `Effect.run*` inside an Effect | `yield*`, or `run*With(context)` |
| `schemaSyncInEffect` | 💡 | v3-only: sync Schema decode inside gen | Effect-returning decode |
| `scopeInLayerEffect` | ⚠️ | v3-only: `Layer.effect` with `Scope` in R | v3 `Layer.scoped` (v4's `Layer.effect` already excludes `Scope`) |
| `strictEffectProvide` | ➖ | `Effect.provide` with layers outside entry points | provide at the edge |
| `tryCatchInEffectGen` | 💡 | `try/catch` in gen | typed recovery |
| `unknownInEffectCatch` | ⚠️ | catch callback returns `unknown` | typed error |

**Effect-native** (all ➖ by default; enable the `*InEffect` variants at least)

| Rule | Flags | Use instead |
|---|---|---|
| `asyncFunction` | `async` functions | `Effect.gen` / `Effect.fn` |
| `cryptoRandomUUID`, `cryptoRandomUUIDInEffect` | v4-only: `crypto.randomUUID()` | `Crypto` / `Random` |
| `extendsNativeError` | `class X extends Error` | `Data.TaggedError` / `Schema.TaggedError` |
| `globalConsole`, `globalConsoleInEffect` | `console.*` | `Effect.log*` |
| `globalDate`, `globalDateInEffect` | `Date.now()`, `new Date()` | `Clock`, `DateTime` |
| `globalFetch`, `globalFetchInEffect` | `fetch` | `HttpClient` |
| `globalRandom`, `globalRandomInEffect` | `Math.random()` | `Random` |
| `globalTimers`, `globalTimersInEffect` | `setTimeout`/`setInterval` | `Effect.sleep`, `Schedule` |
| `instanceOfSchema` | `instanceof` on Schema types | `Schema.is` |
| `newPromise` | `new Promise` | `Effect.callback`, `Deferred` |
| `nodeBuiltinImport` | `node:fs`, `node:path`, … | `FileSystem`, `Path`, … |
| `preferSchemaOverJson` | `JSON.parse`/`stringify` | `Schema.fromJsonString(S)`, `Schema.fromJsonString(Schema.Unknown)` (`UnknownFromJsonString` is untyped `@internal`) |
| `processEnv`, `processEnvInEffect` | `process.env` | `Config` |
| `unsafeEffectTypeAssertion` | `as` narrowing `E`/`R` of Effect/Stream/Layer | fix the types |

**Style**

| Rule | Sev | Flags → fix |
|---|---|---|
| `catchAllToMapError` | 💡 | catch that only re-fails → `Effect.mapError` |
| `deterministicKeys` | ➖ | service/error identifiers not derived from class/path → follow the key pattern |
| `effectDoNotation` | ➖ | `Effect.Do` → `Effect.gen` |
| `effectFnOpportunity` | 💡 | function returning `Effect.gen` → `Effect.fn` |
| `effectMapFlatten` | 💡 | `map` + `flatten` → `flatMap` |
| `effectMapVoid` | 💡 | `map(() => undefined)` → `Effect.asVoid` |
| `effectSucceedWithVoid` | 💡 | `succeed(undefined)` → `Effect.void` |
| `flatMapToMap` | 💡 | `flatMap(x => succeed(f(x)))` → `map` |
| `importFromBarrel` | ➖ | barrel import → module path (cold-start-sensitive CLIs only) |
| `missedPipeableOpportunity` | ➖ | nested calls → `pipe` (do not apply blindly) |
| `missingEffectServiceDependency` | ➖ | v3-only: `Effect.Service` `dependencies` incomplete |
| `nestedEffectGenYield` | ➖ | `yield* Effect.gen(...)` inside gen → inline it |
| `redundantSchemaTagIdentifier` | 💡 | identifier equal to tag in `TaggedClass`/`TaggedError` → drop it |
| `schemaStructWithTag` | 💡 | `Struct` with `_tag` literal → `Schema.TaggedStruct` |
| `schemaUnionOfLiterals` | ➖ | v3-only: `Union(Literal, Literal)` → `Literal(a, b)` |
| `serviceNotAsClass` | ➖ | v4-only: `Context.Service` assigned to a variable → class declaration |
| `strictBooleanExpressions` | ➖ | non-boolean conditions |
| `unnecessaryArrowBlock` | ➖ | `{ return x }` → concise body |
| `unnecessaryEffectGen` | 💡 | gen with a single return → the effect itself |
| `unnecessaryFailYieldableError` | 💡 | `Effect.fail(new E())` in gen → `yield* new E()` |
| `unnecessaryPipe` | 💡 | `pipe()` with no args |
| `unnecessaryPipeChain` | 💡 | `.pipe(a).pipe(b)` → one pipe |

**Additional `@effect/tsgo` rule names** (from the tsgo docs; not in the legacy plugin source, so check
`npx @effect/tsgo diagnostics` output for exact behavior): `floatingEffectInVitest`, `lazyEffect`,
`abortControllerInEffect`, `catchToIgnore`, `catchToOrElseSucceed`, `multipleCatchTag` (→ `catchTags`),
`redundantOrDie`, `redundantMapError`, `schemaNumber` (→ `Schema.Finite`), `newSchemaClass` (use `make`).

Refactors worth knowing: async function → `Effect.fn` (optionally with generated tagged errors), "Layer
Magic" (auto-compose layers from requirements), type → Schema, `Effect.Service` → `Context.Tag` with static
layer (v3). The CLI also has `layerinfo` (provides/requires for a named layer) and `overview`.

---

## Other enforcement: oxlint, ast-grep

Use these when the language service is not enough, or to encode a repo-specific rule after an agent breaks
convention twice.

- **oxlint**: `@effect/tsgo` can emit type-aware oxlint rules (`effect-tsgo patch --oxlint`, extend its
  recommended preset; unverified at 4.0.0). Community plugin `@mpsuesser/oxlint-plugin-effect` (54 rules:
  `avoid-try-catch`, `avoid-native-fetch`, `avoid-process-env`, `throw-in-effect-gen`, `prefer-effect-fn`,
  `prefer-match-over-switch`, `use-clock-service`, `use-random-service`, `avoid-direct-tag-checks`, …).
  Its `avoid-data-tagged-error` pushes the beta name `TaggedErrorClass`; ignore that rule. The
  `effect-oxlint` SDK builds custom bans (`banCallOf("fetch")`, `banCallOfMember("Effect", ["runSync","runPromise"])`,
  `banNewExpr("Date")`). Useful ban list from production repos: no manual `_tag` comparison, no
  `Match.orElse`, no `switch`, no `throw`/`try` in effect code, no `Promise`-returning methods on Effect
  service interfaces, no `vitest` import in Effect tests (use `@effect/vitest`), no double cast.
- **ast-grep** (otter rule set; phrasing is partly v3, translate `catchAll`→`catch`, `@effect/platform`→`effect`):
  `no-bare-new-error`, `no-console-log`, `no-direct-fs-import`, `no-fetch-in-effect`, `no-interface-in-models`,
  `no-interpolated-logging`, `no-json-parse-without-schema`, `no-manual-tag-check`, `no-runpromise-in-effect`,
  `no-silent-catch`, `no-throw-in-effect-generator`, `no-try-catch-in-effect`, `no-unsafe-typecast-at-boundary`,
  `use-tagged-error`.
- **Generic anti-slop rules** that reinforce boundaries: `no-unsafe-dictionary-type` (`Record<string, unknown>`),
  `no-unknown-parameters`, `require-safety-comment-for-type-assertion`, `no-module-mocking` (use Layers).

---

## False greens in tests

Check these on every test file you review or write. Depth, recipes and the `@effect/vitest` surface are in
`references/testing.md`.

- `it("x", () => Effect.gen(...))` with plain vitest `it`: returns an unrun Effect, always passes. Use
  `it.effect`.
- `it.scoped` / `it.scopedLive` do not exist in `@effect/vitest@4`; they resolve to Vitest's fixture API and
  the test is silently never registered. Only `tsc` on test files catches it, so typecheck tests.
- `Effect.runPromise`/`runSync` inside a test: escapes `TestClock` and test services.
- `if (Exit.isFailure(exit)) assert…` with no `else assert.fail()`: asserts nothing on success.
- Comparing whole failed `Exit`s: `Effect.fn` adds stack annotations to the Cause. Assert the error with
  `Effect.flip` or `Effect.result`.
- Stubs that record calls eagerly (outside `Effect.suspend`/`Effect.sync`) log calls that were only described.
- Unjoined forked fibers: their failures are reported nowhere.
- Code under test with real delays (`Effect.sleep`, `timeout`, `retry` with a schedule) under `it.effect`:
  hangs until the vitest timeout unless the test forks and calls `TestClock.adjust`.
- `layer(L)("suite", ...)` shares one layer build across tests; stateful fakes leak counts between tests.
- `Tests: 0 passed` with a non-zero exit is a failed run, not a green one. A test with only negative
  assertions needs a positive control.
- A slow test means a suspected real clock. A test that takes seconds is sleeping, timing out or polling on
  host time somewhere, often inside a shared harness or a clock that delegates to the host. Find it and move
  it under `TestClock`.
- Prove a new test bites: mutate the code under test, watch it fail, revert.

---

## Grep recipes

Run from the repo root. `rg` flags: `-n` line numbers, `-t ts` TypeScript only. Each hit is a candidate,
not a finding: confirm it against the evidence gate.

```sh
# B1 floating logs/effects: Effect call as a bare statement (not yielded, returned or assigned)
rg -n -t ts '^\s*Effect\.(log\w*|fail|die|sleep|annotate\w*)\(' src
rg -n -t ts '^\s*\w+\.(set|update|offer|publish|succeed)\(' src        # Ref/Queue/Deferred ops as statements

# B2 runners outside entry points
rg -n -t ts 'Effect\.run(Promise|Sync|Fork|Callback)(Exit|With)?\(' src | rg -v '(main|index|bin|entry)\.ts'

# A4 env, A8 time, A9 randomness, A10 console, A7 fetch, A11 timers
rg -n -t ts 'process\.env' src
rg -n -t ts 'Date\.now\(\)|new Date\(\)|DateTime\.nowUnsafe' src
rg -n -t ts 'Math\.random|crypto\.randomUUID' src
rg -n -t ts 'console\.(log|error|warn|info|debug)' src
rg -n -t ts '\bfetch\(' src
rg -n -t ts 'setTimeout|setInterval' src

# A13/B10 promises and try/catch inside effect code
rg -n -t ts 'new Promise\(' src
rg -n -t ts '\btry \{' src

# B8/B11 broad recovery (then read each: does it widen E or swallow?)
rg -n -t ts 'Effect\.(catch|catchCause|ignore|orElseSucceed|orDie)\(' src

# B14 sequential-by-default fan-out
rg -n -t ts 'Effect\.(forEach|all)\(' src | rg -v concurrency

# B19 casts
rg -n -t ts ' as (any|unknown|never)\b|as unknown as' src

# Stale APIs (v3 or pre-4.0.0 names in a v4 repo)
rg -n -t ts "from ['\"]effect/unstable/" .           # removed at 4.0.0: drop the segment (httpapi -> http-api)
rg -n -t ts 'Effect\.Service\b|Context\.Tag\b|Context\.GenericTag|Effect\.Tag\b' src
rg -n -t ts 'Schema\.TaggedErrorClass|ServiceMap\.' src
rg -n -t ts 'Effect\.(fork|forkDaemon|catchAll\w*|either|zipRight|async)\(' src
rg -n -t ts 'Layer\.(scoped|scopedDiscard|discard)\b' src
rg -n -t ts "from ['\"]@effect/(platform|rpc|sql|cli|ai|cluster|workflow|experimental|schema)['\"/]" src
rg -n -t ts "from ['\"]effect/Encoding['\"]|Schedule\.(both|either|andThen|take|union|intersect)\b" src
```

The last block doubles as a migration-leftover detector; for the replacements see
`references/migration.md`.

---

## The Effect-expert seat

An independent reviewer whose only question is "does Effect ship this?". The author's own §8 pass doesn't
count as this review. In Orchestrate it is a required lens inside the cross-family verifier on every unit
whose brief mentions Effect. It runs as its own seat, still from the other model family, when the diff
touches the shared test helper, a harness, a composition root, lint or diagnostics config, or the Effect
pin. Outside Orchestrate it runs at Feature step 5 and at Opening a PR. Landing checks its verdict for the
exact head SHA (`orch ledger check <pr> <sha> --unit <id>`).

Brief:

```
GOAL      Decide whether BASE..HEAD uses Effect 4.0.0 as the platform intends; list every hand-roll with a citable replacement.
SCOPE     Read-only. Read effect SKILL §2, §8 and references/review.md in full; open primitives.md, modules.md, testing.md per candidate.
STEP 1    Run the project's check; paste its diagnostics and lint count lines unedited. Any count that rose is a finding.
STEP 2    Run the grep recipes above on changed files and the harnesses they call. Classify each hit against catalog A1-A24.
STEP 3    Evidence gate per hit: the export exists (dist path:line), the behavior is equivalent (name the trap), the hand-roll is not deliberate (SKILL §5 exceptions).
STEP 4    Catalog B and False greens over changed code and tests. Every changed test runs on TestClock through it.effect or the project's equivalent.
STEP 5    Contracts: boundary data is Schema; failures are Schema.TaggedError in E; ports are Context.Service + layer; resources are scoped; forks are owned.
REPORT    VERDICT idiomatic | fixes-required | inconclusive, keyed to HEAD; findings in §4 format; a checked-and-fine list.
          Orchestrate: orch ledger record <pr> <HEAD> <verdict> --lens effect --evidence <report>.
FORBIDDEN Edits, commits, live calls. A finding without a dist path:line is inadmissible, and so is "no replacements" without the inventory.
```

Checklist:

- **Toolbox.** Every retry, sleep, poll, cache, queue, lock, limiter, parse, order, group, decimal, graph and
  LLM call is a named Effect export or has a recorded domain reason.
- **Equivalence.** The replacement keeps the contract. Reject per-file runners and clocks that delegate to the
  host. Keep a greedy domain pairing rule and a money codec. Accept `BigDecimal.round` only with literal tie
  fixtures.
- **Tests.** `TestClock` instead of sleeps, `Latch`/`Deferred` for staging, `Effect.flip` plus tag
  assertions, a positive control beside each negative-only assertion, and each new test shown failing.
- **Contracts.** A, E and R are named. No infrastructure in a method's R. `orDie` only for defects. Foreign
  errors are mapped at the port.
- **Lifetimes.** `acquireRelease` and `makeTempDirectoryScoped` instead of try/finally. Forks are joined or
  held in a `FiberSet`. Retries are bounded and only wrap idempotent operations.
