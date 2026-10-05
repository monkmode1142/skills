# Errors — typed failures, defects, Cause, recovery

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

How v4 models failure, how to define error types, how to raise and recover, and where error
translation belongs. Retry/timeout schedules live in `references/concurrency.md`; Schema details in
`references/schema.md`; HTTP/SQL/AI modules in `references/platform.md`.

## Contents
- [1. Mental model](#1-mental-model) — E vs defects vs interrupts · flat Cause · typed-fail or die
- [2. Defining errors](#2-defining-errors) — `Schema.TaggedError` · `Schema.Error` · `Data.*` · naming · families
- [3. The reason pattern](#3-the-reason-pattern) — wrapper tag + `reason` union · platform errors · your own
- [4. Raising](#4-raising) — `yield*` · `fail`/`die` · `try`/`tryPromise`/`promise` · Option/Result bridges
- [5. Recovering](#5-recovering) — the full catch/tap/map family with what each sees
- [6. Inspecting Cause and Exit](#6-inspecting-cause-and-exit) — reasons · finders · squash · built-in errors · running at the edge
- [7. Boundaries](#7-boundaries) — collapse at the port · HTTP status · exit codes · reporting
- [8. Anti-patterns](#8-anti-patterns)

---

## 1. Mental model

`Effect<A, E, R>` can end three ways besides success, and they are different things:

| Outcome | What it means | Where it lives | Recovered by |
|---|---|---|---|
| **Fail** (`E`) | an expected domain outcome the caller may act on | the typed `E` channel | `catch`, `catchTag`, `catchReason`, `mapError`, … |
| **Die** (defect) | a bug or broken invariant; nobody upstream has a truthful response | untyped (`unknown`) | `catchDefect`, `catchCause` (boundaries only) |
| **Interrupt** | cancellation (timeout, race loser, scope close, Ctrl-C) | untyped, carries `fiberId` | `catchCause`/`sandbox` see it; normally you let it propagate |

**Cause is flat in v4.** `Cause<E>` is `{ reasons: ReadonlyArray<Reason<E>> }` where
`Reason<E> = Fail<E> | Die | Interrupt` (`.error`, `.defect`, `.fiberId`). No `Sequential`/`Parallel`
tree and no `Empty` variant — an empty cause is `reasons.length === 0`; `Cause.combine` concatenates.
Concurrent failures and finalizer failures all land as sibling reasons.

**`Cause.Done`** is not an error: it is the graceful end-of-stream signal for `Queue`/`Pull`/
`Stream.callback` (`Queue<A, E | Cause.Done>`, `Cause.done()`, `Cause.isDone`). Completion handlers
strip `Done` but must keep any real reasons combined with it.

**Typed-fail or die?** Ask "does some caller have a truthful, different response to this?"

- Malformed **untrusted input** (wire bodies, files, user args, env) → typed error. Parsers must never
  die on hostile input — cap recursion, check `JSON.parse` results, fail with a diagnostic error.
- Bad **wiring** (invalid layer options, impossible config combination, violated internal
  invariant) → die deliberately (`Effect.die`, `orDie`); write a test that asserts it dies.
- A **caller-supplied callback** whose result participates in the outcome throws → leave it a defect.
  Converting it to your typed error lets the caller's own `catchTag` swallow their bug.
- **Fire-and-forget hooks** (observers, emit callbacks whose result you discard) → absorb with
  `Effect.catchDefect` + `Effect.logDebug`; one bad listener must not kill the operation.
- Invoke user callbacks inside `Effect.suspend(() => cb(x))` so a throw while *constructing* the
  effect joins the same defect channel instead of escaping synchronously.
- Errors from **operations outside the caller's contract** (e.g. a DB connection loss inside a
  read model the UI cannot act on) → `orDie` at the port, or collapse to one opaque typed error.

---

## 2. Defining errors

### The constructors

| Constructor | Shape | Use when |
|---|---|---|
| `Schema.TaggedError<Self>()("Tag", fields, annotations?)` | yieldable, `_tag`, schema-validated, encodable | the default for app/domain errors; anything crossing a wire (HttpApi, Rpc, workflow journal, cluster) or needing `httpApiStatus` |
| `Schema.Error<Self>("Id")(fields, annotations?)` | yieldable, schema-backed, **no `_tag`** | a single-purpose error matched with `catch`/`instanceof`, or when you supply your own discriminator via `_tag: Schema.tag("X")` |
| `Data.TaggedError("Tag")<{ … }>` | yieldable, `_tag`, structural equality, no schema | purely in-process errors (module-internal, hot paths) that never encode |
| `Data.Error<{ … }>` | yieldable, no `_tag` | rare; in-process, untagged |

All four instances are `YieldableError`s: `yield* new E(...)` fails the effect with them, they
extend `Error` (stack, `cause`), and they work with `instanceof`. `Schema.TaggedError` fields are
validated on construction — pass trusted values or decode first. Note the asymmetric call shapes:
`TaggedError<Self>()(tag, …)` takes an optional identifier first; `Error<Self>(identifier)(fields)`
requires it. `Schema.TaggedErrorClass` / `Schema.ErrorClass` do not exist in 4.0.0.

```ts
import { Effect, Schema } from "effect"

// Default: schema-backed tagged error. Third arg = annotations (status for HttpApi).
export class UserNotFoundError extends Schema.TaggedError<UserNotFoundError>()(
  "UserNotFoundError",
  { userId: Schema.String },
  { httpApiStatus: 404 }
) {
  // message is a getter derived from fields, never a free-form constructor arg
  override get message() {
    return `user ${this.userId} not found`
  }
}

// Wraps a foreign throwable: `cause: Schema.Defect()` (a function call) encodes any unknown.
export class SmtpError extends Schema.Error<SmtpError>("SmtpError")({
  cause: Schema.Defect()
}) {}

// Retryability is data on the error, so policies can read it.
export class PaymentGatewayError extends Schema.TaggedError<PaymentGatewayError>()(
  "PaymentGatewayError",
  { status: Schema.Int, retryable: Schema.Boolean }
) {}

export const findUser = Effect.fn("Users.find")(function*(userId: string) {
  if (userId === "") return yield* new UserNotFoundError({ userId })
  return { userId }
})
```

```ts
import { Data, Effect } from "effect"

// In-process only: no schema, no encoding cost.
class CacheMissError extends Data.TaggedError("CacheMissError")<{ readonly key: string }> {}

export const lookup = (key: string) => Effect.fail(new CacheMissError({ key }))
```

`cause` field conventions: `Schema.Defect()` for unknown throwables (round-trips as an
error-shaped JSON object); `Schema.Unknown` to keep upstream structure verbatim; omit it when tag +
fields say everything. Never `String(e)` a cause — you lose the stack and the type. Schema issues ride
as `issue: Schema.Defect()` (or the `SchemaError` itself).

### Naming and granularity

- Class names: `<Concept><FailureNoun>Error` — `UserNotFoundError`, `InvoiceAlreadyPaidError`,
  `ConfigParseError`. Tag string = class name.
- **One class per failure reason the caller can act on.** Never a generic `NotFoundError` with
  `entity: string`, never `reason: string` free text — `catchTag` and UIs recover by tag. A closed
  `Schema.Literals([...])` field is fine for sub-kinds nobody branches on separately.
- **Per-operation unions** as type-only aliases: `type ChargeError = CardDeclinedError |
  PaymentGatewayError`. Decorators widen (`E | NewError`), never flatten unrelated errors into one.
- Derive the error set from actual raise sites; delete exported errors nothing raises.
- For each error, know its **audience**: end user (message), caller code (tag + fields), operator
  (logged cause). That decides which fields exist.
- Put errors next to the operation's module (or an `errors.ts` beside it), exported with it.

### Error families

When many tags form one family (one package's errors), give them a shared TypeId and a guard so
boundary code can recognise "any billing error" without enumerating tags:

```ts
import { Effect, Predicate, Schema } from "effect"

const TypeId = "~@app/billing/BillingError" as const

export class CardDeclinedError extends Schema.TaggedError<CardDeclinedError>()(
  "CardDeclinedError",
  { code: Schema.String }
) {
  readonly [TypeId] = TypeId
}

export class InvoiceAlreadyPaidError extends Schema.TaggedError<InvoiceAlreadyPaidError>()(
  "InvoiceAlreadyPaidError",
  { invoiceId: Schema.String }
) {
  readonly [TypeId] = TypeId
}

export type BillingError = CardDeclinedError | InvoiceAlreadyPaidError
export const BillingError = {
  TypeId,
  is: (u: unknown): u is BillingError => Predicate.hasProperty(u, TypeId)
}

declare const charge: Effect.Effect<void, BillingError | Error>
export const onlyBilling = charge.pipe(
  Effect.catchIf(BillingError.is, (e) => Effect.logWarning("billing", e._tag))
)
```

Platform modules use the same idea (`HttpClientError.isHttpClientError`, `SqlError.isSqlError`,
`AiError.isAiError`, `Cause.isTimeoutError`, …).

---

## 3. The reason pattern

v4 platform errors use **one wrapper tag whose `reason` field is a tagged union**. The wrapper keeps
`E` small and stable at a service boundary; the reason carries the precise case. Callers either
handle the wrapper wholesale or reach into specific reasons.

| Wrapper (`_tag`) | Module | `reason` tags | Extras |
|---|---|---|---|
| `HttpClientError` | `effect/http` `HttpClientError` | `TransportError`, `EncodeError`, `InvalidUrlError` (request side); `StatusCodeError`, `DecodeError`, `EmptyBodyError` (response side) | `.request`, `.response` getters; type aliases `RequestError`, `ResponseError`, `HttpClientErrorReason` |
| `SqlError` | `effect/sql` `SqlError` | `ConnectionError`, `AuthenticationError`, `AuthorizationError`, `SqlSyntaxError`, `UniqueViolation` (`constraint`), `ConstraintError`, `DeadlockError`, `SerializationError`, `LockTimeoutError`, `StatementTimeoutError`, `UnknownError` | `.isRetryable` getter; `classifySqliteError` |
| `PlatformError` | `effect` `PlatformError` | `BadArgument`, or a `SystemError` whose `_tag` is one of `AlreadyExists`, `BadResource`, `Busy`, `InvalidData`, `NotFound`, `PermissionDenied`, `TimedOut`, `UnexpectedEof`, `Unknown`, `WouldBlock`, `WriteZero` | construct via `PlatformError.systemError(…)` / `badArgument(…)` |
| `SocketError` | `effect/socket` `Socket` | `SocketReadError`, `SocketWriteError`, `SocketOpenError`, `SocketUpgradeError`, `SocketCloseError` | |
| `RpcClientError` | `effect/rpc` `RpcClientError` | worker errors (`WorkerSpawnError`, …), socket reasons, `HttpClientError` (schema form), `RpcClientDefect` | |
| `AiError` | `effect/ai` `AiError` | `RateLimitError`, `QuotaExhaustedError`, `AuthenticationError`, `ContentPolicyError`, `InvalidRequestError`, `InternalProviderError`, `NetworkError`, `InvalidOutputError`, `StructuredOutputError`, `UnsupportedSchemaError`, `UnknownError`, `ToolNotFoundError`, `ToolParameterValidationError`, `InvalidToolResultError`, `ToolResultEncodingError`, `ToolConfigurationError`, `ToolkitRequiredError`, `InvalidUserInputError` | `.isRetryable`, `.retryAfter` |
| `HttpServerError` | `effect/http` `HttpServerError` | `RequestParseError`, `RouteNotFound`, `InternalError`, `ResponseError` | |

Reason names repeat across modules (`UnknownError`, `AuthenticationError`) — always qualify by
wrapper, which is exactly what the combinators below do.

### Combinators

| Combinator | Effect on `E` |
|---|---|
| `Effect.catchReason(errorTag, reasonTag, f, orElse?)` | handles one reason; `f(reason, error)`. Without `orElse`, the wrapper stays in `E` (other reasons still possible); with `orElse(otherReasons, error)` the wrapper is fully handled |
| `Effect.catchReasons(errorTag, { ReasonTag: f, … }, orElse?)` | same, several reasons at once |
| `Effect.unwrapReason(errorTag)` | replaces the wrapper in `E` with its reason union, so `catchTag`/`catchTags` work on reasons |
| `Stream.catchReason` / `catchReasons` / `unwrapReason` | the same on streams |
| `Filter.reason(...)` | a `Filter` for use with `catchFilter`/`catchCauseFilter` |

```ts
import { Effect } from "effect"
import { HttpClientError } from "effect/http"
import { SqlError } from "effect/sql"

declare const fetchProfile: Effect.Effect<string, HttpClientError.HttpClientError>
declare const insertUser: Effect.Effect<void, SqlError.SqlError>

export const profile = fetchProfile.pipe(
  Effect.catchReason(
    "HttpClientError",
    "StatusCodeError",
    (reason) =>
      reason.response.status === 404 ? Effect.succeed("anonymous") : Effect.fail(reason),
    // every other reason: rethrow the wrapper unchanged
    (_reasons, error) => Effect.fail(error)
  )
)

export const insertOnce = insertUser.pipe(
  Effect.catchReason("SqlError", "UniqueViolation", (v) =>
    Effect.logInfo("duplicate", v.constraint))
)

export const byReason = fetchProfile.pipe(
  Effect.unwrapReason("HttpClientError"),
  Effect.catchTags({
    TransportError: () => Effect.succeed("offline"),
    StatusCodeError: (e) => Effect.succeed(`status ${e.response.status}`)
  })
  // remaining E: EncodeError | InvalidUrlError | DecodeError | EmptyBodyError
)
```

### Designing your own

Use a wrapper when a service has many failure cases but callers mostly treat them as one ("the
users API failed") and occasionally care about one case. Use flat per-tag errors when callers
routinely branch on each.

```ts
import { Effect, Schema } from "effect"

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  userId: Schema.String
}, { httpApiStatus: 404 }) {}

export class SearchQueryTooShort extends Schema.TaggedError<SearchQueryTooShort>()(
  "SearchQueryTooShort",
  { minimum: Schema.Int },
  { httpApiStatus: 422 }
) {}

// One tag at the service boundary; precise case in `reason`.
export class UsersError extends Schema.TaggedError<UsersError>()("UsersError", {
  reason: Schema.Union([UserNotFound, SearchQueryTooShort])
}) {}

declare const search: (q: string) => Effect.Effect<ReadonlyArray<string>, UsersError>

export const searchOrEmpty = (q: string) =>
  search(q).pipe(
    Effect.catchReasons("UsersError", {
      SearchQueryTooShort: () => Effect.succeed([] as ReadonlyArray<string>)
    })
  )
```

Reasons are themselves tagged errors (so `unwrapReason` yields real errors); keep shared metadata
(request, operation, retryability) on the wrapper or as a getter computed from the reason.

---

## 4. Raising

| Form | Result |
|---|---|
| `return yield* new MyError({...})` | typed failure; `return` tells TS the branch ends (narrowing) |
| `Effect.fail(e)` / `Effect.failSync(() => e)` | typed failure — use in `pipe`/`flatMap`/`map` bodies |
| `Effect.failCause(cause)` | re-raise a whole `Cause` (preserves defects/interrupts) |
| `Effect.die(defect)` | defect. v3 `dieMessage` is gone: `Effect.die(new Error("…"))` |
| `Effect.orDie(self)` | turns every `E` into a defect (the error value becomes the defect) |
| `throw` inside `Effect.gen` / `Effect.fn` / `Effect.sync` / `Effect.suspend` | defect |
| `Effect.try(() => x)` | `Effect<A, Cause.UnknownError>` |
| `Effect.try({ try, catch: (u) => E })` | `Effect<A, E>`; if `catch` itself throws → defect |
| `Effect.tryPromise(() => p)` / `({ try: (signal) => p, catch })` | same split; the `AbortSignal` fires on interruption |
| `Effect.promise((signal) => p)` | rejection is a **defect** — only for promises that cannot reject meaningfully |
| `Effect.fromResult(r)` | `Result.fail(e)` → typed failure |
| `Effect.fromOption(o)` / `Effect.fromOption(o, () => e)` | `None` → `Cause.NoSuchElementError` or your error |
| `Effect.fromNullishOr(v)` | `null`/`undefined` → `NoSuchElementError` |
| `Effect.filterOrFail(pred, (a) => e)` / `filterOrFail(pred)` | fails with your error / `NoSuchElementError` |
| `Effect.timeout(d)` | adds `Cause.TimeoutError` to `E` |

`yield* option` / `yield* result` do not work in v4 (a type error; forced through a cast they die
"Not a valid effect"); bridge with
`fromOption`/`fromResult`. Explicit two-generic calls like `Effect.try<A, E>(…)` no longer compile —
let `catch` infer `E`.

```ts
import { Effect, Option, Schema } from "effect"

class ConfigParseError extends Schema.TaggedError<ConfigParseError>()("ConfigParseError", {
  path: Schema.String,
  cause: Schema.Defect()
}) {}

class ConfigMissingError extends Schema.TaggedError<ConfigMissingError>()("ConfigMissingError", {
  key: Schema.String
}) {}

declare const readText: (path: string) => Promise<string>

export const loadConfig = Effect.fn("Config.load")(function*(path: string) {
  const text = yield* Effect.tryPromise({
    try: () => readText(path),
    catch: (cause) => new ConfigParseError({ path, cause })
  })
  const json = yield* Effect.try({
    try: () => JSON.parse(text) as Record<string, unknown>,
    catch: (cause) => new ConfigParseError({ path, cause })
  })
  const port = yield* Effect.fromOption(
    Option.fromNullishOr(json["port"]),
    () => new ConfigMissingError({ key: "port" })
  )
  return { port }
})
// Effect<{ port: unknown }, ConfigParseError | ConfigMissingError>
```

`Effect.try`/`tryPromise` are for **host** functions (`JSON.parse`, `fetch`, SDK calls). Prefer a
Schema decode (`Schema.decodeUnknownEffect`) over `JSON.parse` + casts for wire data — it fails with
`Schema.SchemaError` carrying the full issue tree.

---

## 5. Recovering

"Sees" = which reasons reach the handler. Unless noted, defects and interrupts pass through
untouched. Every `orElse?` slot is the handler for whatever the first handler did not match; with it,
the matched-away errors leave `E` entirely.

### Typed-error handlers

| Combinator | Signature (data-last) | Sees | Notes |
|---|---|---|---|
| `Effect.catch` | `(f: (e: E) => Effect<A2, E2, R2>)` | Fail | v3 `catchAll`/`orElse`. Removes all of `E` |
| `Effect.catchEager` | same | Fail | evaluates synchronous recovery effects immediately; an optimization |
| `Effect.catchTag` | `(tag \| [tag, …], f, orElse?)` | Fail with `_tag` | array of tags → handler gets the union. Fails to typecheck if the tag isn't in `E` |
| `Effect.catchTags` | `({ Tag: f, … }, orElse?)` | Fail | prefer over chained `catchTag` |
| `Effect.catchIf` | `(refinement \| predicate, f, orElse?)` | Fail | refinement narrows the remainder to `Exclude<E, EB>` |
| `Effect.catchFilter` | `(filter: Filter<E, EB, X>, f, orElse?)` | Fail | v3 `catchSome`; build with `Filter.fromPredicate`, `Filter.tagged`, `Filter.reason` |
| `Effect.catchReason` / `catchReasons` | see §3 | Fail (wrapper's `reason`) | |
| `Effect.catchNoSuchElement` | `(self) => Effect<Option<A>, Exclude<E, NoSuchElementError>>` | Fail | turns "absent" back into `Option` |
| `Effect.mapError` | `(f: (e: E) => E2)` | Fail | translation, not recovery |
| `Effect.mapBoth` | `({ onFailure, onSuccess })` | Fail | |
| `Effect.orElseSucceed` | `(f: (e: E) => A2)` | Fail | v4 passes the error to `f` |
| `Effect.orDie` | `(self) => Effect<A, never, R>` | Fail | promotes to defect |
| `Effect.firstSuccessOf` | `(effects: Iterable<Effect>)` | Fail | tries in order; fallback chains (model A → model B) |
| `Effect.retry` / `retryOrElse` | see `references/concurrency.md` | Fail | `while`/`until` predicates read the error |
| `Effect.eventually` | `(self) => Effect<A, never, R>` | Fail | retry forever — rarely right |
| `Effect.ignore` | `(self)` or `({ log?, message? })` | Fail | discards success and typed failure. **Defects and interrupts still propagate**, logged or not |

`Effect.orElseFail`, `catchSome`, `catchSomeCause`, `catchSomeDefect`, `catchAll*`, `either`,
`tapErrorCause` do not exist in 4.0.0.

### Cause-level handlers (see defects and interrupts)

| Combinator | Signature | Sees |
|---|---|---|
| `Effect.catchCause` | `(f: (cause: Cause<E>) => Effect)` | everything, **including interrupts** — `Effect.interrupt.pipe(Effect.catchCause(...))` recovers |
| `Effect.catchCauseIf` | `(predicate: Predicate<Cause<E>>, f)` | everything matching |
| `Effect.catchCauseFilter` | `(filter: Filter<Cause<E>, EB, X>, f: (eb, cause) => …)` | everything; `E` becomes `Cause.Error<X>` |
| `Effect.catchDefect` | `(f: (defect: unknown) => Effect)` | Die only |
| `Effect.ignoreCause` | `(self)` or `({ log?, message? })` | everything, including defects and interrupts |
| `Effect.sandbox` | `(self) => Effect<A, Cause<E>, R>` | moves the whole Cause into `E` so typed combinators apply |
| `Effect.exit` | `(self) => Effect<Exit<A, E>, never, R>` | everything, as a value |
| `Effect.result` | `(self) => Effect<Result<A, E>, never, R>` | Fail only (v3 `either`); defects still propagate |
| `Effect.option` | `(self) => Effect<Option<A>, never, R>` | Fail only |
| `Effect.flip` | `(self) => Effect<E, A, R>` | swaps channels — handy in tests |

Cause-level recovery belongs at supervision/runtime boundaries. In ordinary service code,
`catchCause`/`ignoreCause`/`sandbox` turn cancellation into "success" and break timeouts and
structured shutdown.

### Observing without recovering

| Combinator | Runs on | Notes |
|---|---|---|
| `Effect.tapError(f)` | Fail | `f`'s own errors are added to `E` |
| `Effect.tapErrorTag(tag \| [tags], f)` | Fail with tag | |
| `Effect.tapCause(f)` / `tapCauseIf(pred, f)` / `tapCauseFilter(filter, f)` | any cause | v3 `tapErrorCause` |
| `Effect.tapDefect(f)` | Die | |
| `Effect.withErrorReporting` / `({ defectsOnly })` | any non-interrupt cause | forwards to `ErrorReporter`s (§7) |

```ts
import { Cause, Effect, Schema } from "effect"

class RateLimitedError extends Schema.TaggedError<RateLimitedError>()("RateLimitedError", {
  retryAfterMs: Schema.Int
}) {}
class UpstreamError extends Schema.TaggedError<UpstreamError>()("UpstreamError", {
  status: Schema.Int
}) {}

declare const callUpstream: Effect.Effect<string, RateLimitedError | UpstreamError>
declare const fromCache: Effect.Effect<string>

export const resilient = callUpstream.pipe(
  Effect.tapError((e) => Effect.logWarning("upstream failed", e)),
  Effect.catchTag(
    "RateLimitedError",
    () => fromCache,
    (other) => Effect.fail(other) // UpstreamError stays visible
  )
)

// Boundary-only: log every defect with its cause, then fail typed.
export const supervised = callUpstream.pipe(
  Effect.catchCauseFilter(Cause.findDefect, (defect, cause) =>
    Effect.logError("defect", Cause.pretty(cause)).pipe(
      Effect.andThen(Effect.fail(new UpstreamError({ status: 500 }))),
      Effect.tap(() => Effect.annotateCurrentSpan("defect", String(defect)))
    ))
)
```

Stream has the same family (`Stream.catch`, `catchTag`, `catchTags`, `catchIf`, `catchFilter`,
`catchCause*`, `catchDefect`, `tapDefect`, `tapErrorTag`, `catchReason(s)`, `unwrapReason`, `orDie`,
`ignore`, `ignoreCause`, `retry`, `mapError`, `result`).

---

## 6. Inspecting Cause and Exit

| Need | API |
|---|---|
| iterate | `cause.reasons` + `Cause.isFailReason` / `isDieReason` / `isInterruptReason` |
| any of a kind? | `Cause.hasFails`, `hasDies`, `hasInterrupts`, `hasInterruptsOnly` |
| first typed error | `Cause.findError(c): Result<E, Cause<never>>`; `Cause.findErrorOption(c): Option<E>` |
| first Fail reason (with annotations) | `Cause.findFail(c): Result<Fail<E>, Cause<never>>` |
| first defect | `Cause.findDefect(c): Result<unknown, Cause<E>>`; `Cause.findDie` (the reason) |
| interrupts | `Cause.findInterrupt`, `Cause.interruptors(c): ReadonlySet<number>`, `filterInterruptors` |
| one representative value | `Cause.squash(c)` — first Fail error, else first defect, else a generic Error. Lossy; it's what `runPromise`/`runSync` throw |
| all as Errors | `Cause.prettyErrors(c): Array<Error>` (non-lossy) |
| log string | `Cause.pretty(c)` |
| build | `Cause.fail`, `die`, `interrupt`, `empty`, `combine`, `fromReasons`, `makeFailReason`/`makeDieReason`/`makeInterruptReason`, `map`, `annotate` |
| guards | `Cause.isCause`, `isReason` |

v3 → v4: `failureOption` → `findErrorOption`, `failureOrCause` → `findError`, `dieOption` →
`findDefect`, `isFailure`/`isDie`/`isInterrupted` → `hasFails`/`hasDies`/`hasInterrupts`,
`sequential`/`parallel` → `combine`, `failures(c)` → `c.reasons.filter(Cause.isFailReason)`. The
finders return `Result` — read `.success`/`.failure`, not `.value`.

**Built-in error classes** (all `YieldableError`, `new X(message?)`, guard `Cause.isX`):
`NoSuchElementError` (`fromOption`, `fromNullishOr`, `filterOrFail`), `TimeoutError`
(`Effect.timeout`), `IllegalArgumentError`, `ExceededCapacityError` (`RcMap` `capacity`), `UnknownError(cause, message?)` (`Effect.try`/`tryPromise` thunk form),
`AsyncFiberError(fiber)` (a sync runner hit async work). `*Exception` names, `RuntimeException`,
`InterruptedException` are gone.

**Exit** = `Success | Failure` with `.cause`: `Exit.isSuccess`, `isFailure`, `hasFails`, `hasDies`,
`hasInterrupts`, `match`, `getSuccess`, `getCause` (Option), `findError`, `findErrorOption`,
`findDefect`, `filterSuccess`/`filterFailure`/`filterCause`/`filterValue` (Results).

**Running at the edge.** `runPromise` rejects with `Cause.squash(cause)` — your error instance
itself for a typed failure (no `FiberFailure` wrapper), the defect for a die — losing other reasons.
At adapters (route handlers, queue consumers, tests) prefer `runPromiseExit` / `runSyncExit` and
branch on the `Exit`:

```ts
import { Cause, Effect, Exit, Schema } from "effect"

class OrderRejectedError extends Schema.TaggedError<OrderRejectedError>()("OrderRejectedError", {
  orderId: Schema.String
}) {}

declare const placeOrder: (id: string) => Effect.Effect<string, OrderRejectedError>

export async function handler(id: string): Promise<{ status: number; body: string }> {
  const exit = await Effect.runPromiseExit(placeOrder(id))
  if (Exit.isSuccess(exit)) return { status: 200, body: exit.value }
  const error = Cause.findErrorOption(exit.cause)
  if (error._tag === "Some") return { status: 409, body: error.value.message }
  if (Cause.hasInterruptsOnly(exit.cause)) return { status: 499, body: "cancelled" }
  console.error(Cause.pretty(exit.cause))
  return { status: 500, body: "internal error" }
}
```

---

## 7. Boundaries

**Collapse foreign errors to your family at the port.** The adapter that calls HTTP/SQL/an SDK maps
`HttpClientError`, `SqlError`, `SchemaError`, `PlatformError` into the errors your domain names; the
domain and the layers above never see vendor tags. Decide per operation which errors are part of the
caller's contract; everything else `orDie`s (or folds into one opaque `XUnavailableError`).

```ts
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClientError } from "effect/http"

export class Profile extends Schema.Class<Profile>("Profile")({ name: Schema.String }) {}

export class ProfileNotFoundError extends Schema.TaggedError<ProfileNotFoundError>()(
  "ProfileNotFoundError",
  { userId: Schema.String }
) {}
export class ProfileUnavailableError extends Schema.TaggedError<ProfileUnavailableError>()(
  "ProfileUnavailableError",
  { cause: Schema.Defect() }
) {}

export class Profiles extends Context.Service<Profiles, {
  get(userId: string): Effect.Effect<Profile, ProfileNotFoundError | ProfileUnavailableError>
}>()("@app/profiles/Profiles") {
  static readonly layerNoDeps = (
    fetchJson: (path: string) => Effect.Effect<unknown, HttpClientError.HttpClientError>
  ) =>
    Layer.succeed(Profiles)({
      get: Effect.fn("Profiles.get")(function*(userId: string) {
        const raw = yield* fetchJson(`/profiles/${userId}`).pipe(
          Effect.catchReason(
            "HttpClientError",
            "StatusCodeError",
            (r, error) =>
              Effect.fail(
                r.response.status === 404
                  ? new ProfileNotFoundError({ userId })
                  : new ProfileUnavailableError({ cause: error })
              ),
            (_reasons, error) => Effect.fail(new ProfileUnavailableError({ cause: error }))
          )
        )
        // Wire data is untrusted: a bad body is the upstream's fault → typed, not a defect.
        return yield* Schema.decodeUnknownEffect(Profile)(raw).pipe(
          Effect.mapError((cause) => new ProfileUnavailableError({ cause }))
        )
      })
    })
}
```

**Domain errors → transport.**

- HttpApi: annotate the error schema `{ httpApiStatus: 404 }` (or `HttpApiSchema.status(404)`) and
  list it in the endpoint's errors; the framework encodes it with that status. Map or `orDie`
  anything the endpoint doesn't declare (defects become 500s). `HttpApiError` has ready-made `NotFound`, `BadRequest`, `Unauthorized`, … classes.
- Plain `HttpRouter`/`HttpServer`: give the error a `[HttpServerRespondable.symbol]()` method
  returning `Effect<HttpServerResponse>` (the `Respondable` protocol), or map at the handler.
- CLI / `runMain`: put `readonly [Runtime.errorExitCode] = 2` on the error class; the default teardown
  exits `0` success, `130` interrupt-only, the squashed error's code, else `1`. Set
  `[Runtime.errorReported] = false` when you already reported it.
- Translate exhaustively with `Match` so a new error is a compile error at the boundary:

```ts
import { Match, Runtime, Schema } from "effect"

class UsageError extends Schema.TaggedError<UsageError>()("UsageError", { hint: Schema.String }) {
  readonly [Runtime.errorExitCode] = 2
}
class RemoteError extends Schema.TaggedError<RemoteError>()("RemoteError", { status: Schema.Int }) {}
type CliError = UsageError | RemoteError

export const describe = Match.type<CliError>().pipe(
  Match.tag("UsageError", (e) => `usage: ${e.hint}`),
  Match.tag("RemoteError", (e) => `server said ${e.status}`),
  Match.exhaustive
)
```

**Reporting.** `ErrorReporter` (`effect` root) forwards non-interrupt causes to Sentry/logging:
`ErrorReporter.make(({ cause, error, severity, attributes, fiber, timestamp }) => …)`, install with
`ErrorReporter.layer([reporter], { mergeWithExisting? })`, trigger with `Effect.withErrorReporting`
(`{ defectsOnly: true }` to skip typed failures) or `ErrorReporter.report(cause)`. HTTP and RPC
servers report automatically. Per-error knobs as class fields: `[ErrorReporter.ignore] = true`
(expected 404s), `[ErrorReporter.severity]`, `[ErrorReporter.attributes]`.

```ts
import { Effect, ErrorReporter, Schema } from "effect"

class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {}) {
  readonly [ErrorReporter.ignore] = true
}

const sentry = ErrorReporter.make(({ error, severity }) => {
  console.error(`[${severity}]`, error.message)
})

declare const job: Effect.Effect<void, NotFoundError>

export const reported = job.pipe(
  Effect.withErrorReporting,
  Effect.provide(ErrorReporter.layer([sentry]))
)
```

**Boundary rules.**

- Read the inferred `E` (hover) before writing `catchTag`; if `catchTag("X", …)` doesn't typecheck,
  `X` is not in `E` — don't cast around it.
- Never widen `E` to `unknown`, `Error`, or `string`; it erases every tag downstream.
- Catch only where the boundary has a truthful response; otherwise let it propagate.
- No silent catch-all: `tapError`/log before a fallback, or keep the failure visible.
- Retry only operations proven idempotent; let exhausted retries surface the last error.
- Normalize `Schema.SchemaError` at the decode site (`mapError` to your parse error) — don't let it
  leak as a "domain" error.
- Keep provider/network calls out of DB transactions so their failures don't poison the transaction.

---

## 8. Anti-patterns

| Smell | Why it's wrong | Fix |
|---|---|---|
| `try { yield* eff } catch {}` in a generator | never catches Effect failures (they aren't thrown) | `Effect.exit`, `Effect.result`, or a `catch*` combinator |
| `yield* Effect.fail(new E())` | redundant; yieldable errors yield directly | `return yield* new E()` |
| `throw new E()` inside `Effect.gen` | becomes a defect, not a typed failure | `return yield* new E()` |
| `Effect.catch((e) => e._tag === "A" ? … : Effect.fail(e))` | manual tag dispatch, loses narrowing | `catchTag("A", …)` / `catchTags` |
| chained `catchTag(...).pipe(catchTag(...))` | noisy | one `catchTags({ … })` |
| `Effect.catch(() => Effect.succeed(default))` with no log | hides outages | `tapError` + log first, or narrow with `catchTag` |
| `Effect.catchCause`/`ignoreCause` in service code | swallows interrupts; breaks timeouts/shutdown | `catch`/`catchTag`; `catchDefect` if you mean defects |
| relying on `Effect.ignore` to hide a bug | v4 `ignore` lets defects through | fix the bug, or `catchDefect` explicitly at a boundary |
| `orDie` over a recoverable case (missing optional file) | turns a decision into a crash | `catchReason("PlatformError", "NotFound", …)` or `Effect.option` |
| `Effect.promise(() => sdk.call())` | rejection becomes a defect | `tryPromise({ try, catch })` |
| `Effect.sync(() => JSON.parse(s))` | throw becomes a defect | `Effect.try({ try, catch })` or a Schema decode |
| `new NotFoundError({ entity: "user" })` / `reason: string` | callers can't recover by tag | one class per reason; literal unions at most |
| `E` typed as `Error` / `unknown` / `string` | erases tags | precise union |
| `new MyError({ message: \`…${id}\` })` | message duplicates fields, drifts | `get message()` derived from fields |
| `cause: String(e)` | drops stack/type | `cause: Schema.Defect()` |
| converting a caller callback's throw into your typed error | lets the caller's `catchTag` swallow its own bug | leave it a defect; run callbacks in `Effect.suspend` |
| re-wrapping an already-wrapped error at each layer | `AError(BError(AError…))` chains | guard: `e instanceof Target ? e : new Target({ cause: e })` |
| `Cause.squash` to inspect what went wrong | lossy (first failure only) | iterate `cause.reasons` or `Cause.prettyErrors` |
| `runPromise` at an adapter with `try/catch` | squashed; can't tell fail/die/interrupt | `runPromiseExit` and branch |
| `yield* someOption` / `yield* someResult` | type error; dies "Not a valid effect" if forced | `Effect.fromOption` / `Effect.fromResult` |
| `Effect.catchAll`, `catchSome`, `either`, `Cause.failureOption`, `*Exception` | v3 names | `catch`, `catchFilter`, `result`, `findErrorOption`, `*Error` |
| swapping `Effect.promise(() => facade())` for a typed `yield* svc.method()` but keeping `catchDefect` | the failure moved to `E`; the defect handler silently stops matching | switch to `catch`/`catchTag` |
