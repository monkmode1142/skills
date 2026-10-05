# Testing Effect v4 with @effect/vitest

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

How to test Effect code with `@effect/vitest` 4.0.0 on Vitest 5: the runner surface, asserting on
each channel, wiring layers and fakes, virtual time, staged concurrency, console capture, config,
platform fakes (HTTP, FileSystem, HttpApi, RPC, SQL, AI, Atom, CLI), property tests, and the ways a
test can pass without testing anything. Errors as a design topic live in `references/errors.md`;
service and layer design in `references/architecture.md`; scheduling primitives in
`references/concurrency.md`.

## Contents

1. [Setup](#1-setup) (incl. [Running on bun:test](#running-on-buntest))
2. [Runner surface](#2-runner-surface)
3. [Asserting outcomes](#3-asserting-outcomes)
4. [Layers and fakes](#4-layers-and-fakes)
5. [Time: TestClock](#5-time-testclock)
6. [Concurrency tests](#6-concurrency-tests)
7. [Console and logging](#7-console-and-logging)
8. [Config and environment](#8-config-and-environment)
9. [Platform fakes](#9-platform-fakes)
10. [Property testing](#10-property-testing)
11. [False greens, mutation discipline, running vitest](#11-false-greens-mutation-discipline-running-vitest)

## 1. Setup

| Package | Requirement | Why |
|---|---|---|
| `effect` | `4.0.0` | every `effect` / `@effect/*` package releases at one shared version |
| `@effect/vitest` | same version as `effect` (peer `effect ^4.0.0`) | it imports `effect/testing`, `effect/Arbitrary`, … from your copy |
| `vitest` | `>=5.0.0 <6.0.0` (peer) | 4.0.0 is built against Vitest 5; no Vitest 3/4 shims |
| Node | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | Vitest 5's engine range |

```sh
npm install -D vitest@^5 @effect/vitest@4.0.0
```

Mismatch symptoms (they look like a broken install, not a version problem):

- A v3 `@effect/vitest` next to v4 `effect`: `Cannot find module '…/effect/dist/Arbitrary.js'` or
  missing `effect/testing`. Check `npm ls effect` / `pnpm why effect`: there must be exactly one copy.
- Two `effect` copies: services provided from one copy are "not found" by the other, and
  `Equal`/`instanceof` checks fail between them.
- Vitest 4 with `@effect/vitest` 4.0.0: peer warnings, then API errors around `test.extend`/fixtures.

Vitest 5 changes that bite through the re-export (`@effect/vitest` re-exports `vitest` unchanged):
`it.sequential`/`describe.sequential` are gone (use `{ concurrent: false }`), mock call history is
cleared before each test, async assertions must be awaited, and in concurrent tests use the
callback's `ctx.expect` so snapshots and assertion counts belong to the right test.

`vi.mock` must come from `"vitest"` directly. Vitest hoists `vi.mock(...)` above all imports and
only recognizes the mocks API imported from `vitest`; with `vi` from the `@effect/vitest`
re-export the file fails to load with "There are some problems in resolving the mocks API … import
the mocks API directly from 'vitest'" (probe, Vitest 5.0.3; older Vitest reported a TDZ
`Cannot access '__vi_import_1__'`). `vi.fn` / `vi.spyOn` through the re-export are fine. In
Effect code you should rarely need `vi.mock` at all (§4: swap layers, not modules).

```ts nocheck
import { vi } from "vitest"            // hoisting-safe
import { it } from "@effect/vitest"
vi.mock("./clock-source.js", () => ({ now: () => 0 }))
```

Typecheck test files (`tsc --noEmit` over `test/**`). Several traps below (`it.scoped`, returning
an Effect from plain `it`) are only caught by the type checker, never by a run.

### Running on bun:test

Use `@effect/vitest` whenever Vitest can load the code. When it can't (Bun-only modules such as
`bun:sqlite`), use the project's `it.effect` equivalent, or create one. Put it in one shared file
(`test/support/effect.ts`), which is the only place in `test/**` that calls `Effect.run*`. A
per-file `run = (e) => Effect.runPromise(...)` escapes `TestClock` and `Scope`, and gets copied
into every file after it.

```ts nocheck
import { afterAll, test } from "bun:test"
import { Effect, Layer, ManagedRuntime, type Scope } from "effect"
import { TestClock, TestConsole } from "effect/testing"

export type TestServices = TestClock.TestClock | TestConsole.TestConsole
const testServices = Layer.mergeAll(TestClock.layer(), TestConsole.layer)
const notAnEffect = (value: unknown) => new Error(`test body returned ${typeof value}, not an Effect`)

// it.effect: fresh TestClock, TestConsole and Scope per test. A body that isn't an Effect fails.
export const effect = <A, E>(name: string, body: () => Effect.Effect<A, E, Scope.Scope | TestServices>) =>
  test(name, async () => {
    const value: unknown = body()
    if (!Effect.isEffect(value)) throw notAnEffect(value)
    await Effect.runPromise(
      (value as Effect.Effect<A, E, Scope.Scope | TestServices>).pipe(Effect.scoped, Effect.provide(testServices))
    )
  })

// layer(L): built once for the file, like @effect/vitest's layer. Clock time and console lines are shared too.
export const layer = <R, E>(built: Layer.Layer<R, E>) => {
  const runtime = ManagedRuntime.make(Layer.provideMerge(built, testServices))
  afterAll(() => runtime.dispose())
  return {
    effect: <A, E2>(name: string, body: () => Effect.Effect<A, E2, Scope.Scope | R | TestServices>) =>
      test(name, async () => {
        const value: unknown = body()
        if (!Effect.isEffect(value)) throw notAnEffect(value)
        await runtime.runPromise(Effect.scoped(value as Effect.Effect<A, E2, Scope.Scope | R | TestServices>))
      })
  }
}
```

Everything else in this file applies unchanged: `Effect.flip` for failures, `TestClock.adjust`
after a fork, layer fakes. Lint `Effect.run*` in `test/**` outside the helper so new per-file
runners fail the check.

## 2. Runner surface

```ts nocheck
import { assert, describe, expect, it, layer, flakyTest, makeMethods, describeWrapped, prop } from "@effect/vitest"
import { assertSome, assertSuccess, assertExitFailure } from "@effect/vitest/utils"
import { TestClock, TestConsole, TestSchema } from "effect/testing"
```

| API | What it runs | Environment |
|---|---|---|
| `it.effect(name, (ctx) => eff, timeout?)` | the Effect, inside a fresh `Scope` closed after the test | fresh `TestClock` (starts at 0) + `TestConsole` per test |
| `it.live(name, (ctx) => eff, timeout?)` | same, scoped | live `Clock`, live `Console`, real logger output |
| `it.effect.skip / .only / .fails / .skipIf(c) / .runIf(c)` | Vitest modifiers, Effect-aware | as `it.effect` (also on `it.live`) |
| `it.effect.each(cases)(name, (case, ctx) => eff)` | one test per case (Vitest `it.for`) | as `it.effect` |
| `it.effect.prop(name, arbs, (values, ctx) => eff, opts?)` | property test, body is an Effect | as `it.effect` (§10) |
| `it.prop(name, arbs, (values, ctx) => boolean \| void, opts?)` | synchronous property test | no Effect environment |
| `layer(L, opts?)(name?, (it) => …)` / `it.layer(L)` | shares one built layer across the block | `L` + one shared TestClock/TestConsole for the block |
| `it.flakyTest(eff, timeout = "30 seconds")` | retries `eff` up to 10 times within `timeout` (sandboxed, `orDie`) | returns an Effect: wrap it in `it.effect` |
| `makeMethods(test.extend(...))` | the same helpers over a fixture-extended Vitest API | fixtures destructured from `ctx` |
| `describeWrapped(name, (it) => …)` | `describe(name, () => f(it))` with the Effect `it` | — |
| `addEqualityTesters()` | **no-op** in 4.0.0 (`expect.addEqualityTesters([])`) | don't rely on it for `toEqual` on Effect data |

`timeout` is a number (ms) or Vitest `TestOptions` (`{ timeout, retry, repeats, concurrent, … }`).
Default Vitest timeout is 5 s. On timeout the Effect fiber is interrupted and finalizers run.

`layer(L, options)` options: `concurrent?: boolean` (named blocks only; anonymous blocks inherit),
`timeout?: Duration.Input` (build/teardown hooks), `memoMap?: Layer.MemoMap` (share builds across
blocks), `excludeTestServices?: boolean` (no TestClock/TestConsole: real time inside the block).
Nested `it.layer(L2, { concurrent, timeout })` sees the parent's services and builds `L2` on a fork
of the parent's MemoMap. The `it` passed to a layer block is `MethodsNonLive`: there is no
`it.live` inside `layer()` — use `excludeTestServices: true` or a top-level `it.live` with
`Effect.provide(L)`.

```ts
import { assert, describe, it, layer } from "@effect/vitest"
import { Context, Effect, Fiber, Layer, Random, Schema } from "effect"
import { TestClock } from "effect/testing"

class Greeter extends Context.Service<Greeter, {
  greet(name: string): Effect.Effect<string>
}>()("@app/test/Greeter") {
  static readonly layer = Layer.succeed(Greeter, Greeter.of({
    greet: (name) => Effect.succeed(`hello ${name}`)
  }))
}

describe("runner surface", () => {
  it.effect("scoped by default, virtual time", () =>
    Effect.gen(function*() {
      yield* Effect.addFinalizer(() => Effect.void) // a Scope is already provided
      const fiber = yield* Effect.forkChild(Effect.sleep("1 hour").pipe(Effect.as("done")))
      yield* TestClock.adjust("1 hour")
      assert.strictEqual(yield* Fiber.join(fiber), "done")
    }))

  it.live("real clock", () =>
    Effect.gen(function*() {
      const start = Date.now()
      yield* Effect.sleep("5 millis")
      assert.isTrue(Date.now() - start >= 4)
    }))

  it.effect.each([
    { input: " Ada ", expected: "ada" },
    { input: "LIN", expected: "lin" }
  ])("normalizes %#", ({ input, expected }) =>
    Effect.sync(() => assert.strictEqual(input.trim().toLowerCase(), expected)))

  it.effect.prop("trim is idempotent", [Schema.String], ([s]) =>
    Effect.sync(() => assert.strictEqual(s.trim().trim(), s.trim())))

  // Expected-to-fail: goes red the day the bug is fixed, so you remember to flip it.
  it.effect.fails("known bug #123", () => Effect.fail("still broken"))

  it.effect("retries flaky work", () =>
    it.flakyTest(
      Effect.gen(function*() {
        if (yield* Random.nextBoolean) return yield* Effect.fail("unlucky")
      }),
      "5 seconds"
    ))

  // Per-test provide: the layer is rebuilt for this test only.
  it.effect("per-test provide", () =>
    Effect.gen(function*() {
      const greeter = yield* Greeter
      assert.strictEqual(yield* greeter.greet("ada"), "hello ada")
    }).pipe(Effect.provide(Greeter.layer)))
})

// Shared layer: built once in beforeAll, torn down in afterAll.
layer(Greeter.layer)("Greeter (shared)", (it) => {
  it.effect("uses the shared instance", () =>
    Effect.gen(function*() {
      assert.strictEqual(yield* (yield* Greeter).greet("lin"), "hello lin")
    }))

  it.layer(Layer.succeed(Random.Random, Random.Random.defaultValue()))("nested", (it) => {
    it.effect("sees parent and nested services", () =>
      Effect.gen(function*() {
        yield* Greeter
        yield* Random.next
      }))
  })
})
```

Fixtures: build helpers over `test.extend(...)` and destructure the fixtures you use — Vitest parses
the parameter list, and `(ctx) =>` fails with `FixtureParseError` once any fixture exists. Property
tests cannot request fixtures (auto fixtures still run). Build `makeMethods` from the top-level
`test`, not from the API a `describe` callback hands you.

```ts
import { assert, makeMethods, test } from "@effect/vitest"
import { Effect } from "effect"

const it = makeMethods(test.extend("config", { scope: "file" }, () => ({ port: 3000 })))

it.effect("reads the fixture", ({ config }) =>
  Effect.sync(() => assert.strictEqual(config.port, 3000)))
```

Runner traps:

- **`it.scoped` / `it.scopedLive` don't exist** (v3). `it.scoped` resolves to Vitest's deprecated
  `test.scoped(fixtures)` override API: it returns a new test API and registers nothing, so the body
  never runs and the suite stays green (probe: a file with one `it.effect` and one `it.scoped`
  reports 1 test, passed; only a file with *nothing but* `it.scoped` fails, as "No test suite
  found"). `tsc` reports an argument-count error. `it.effect` is already scoped.
- **`it("x", () => Effect.gen(...))` never runs the Effect.** Vitest awaits only promises; an Effect
  object is a plain return value, so the test passes with zero assertions executed (probe-confirmed).
- **Don't `Effect.runPromise` inside plain `it`.** It runs, but without TestClock/TestConsole/Scope,
  typed failures become rejections with worse output, and `TestClock.adjust` dies
  (`testClock.adjust is not a function`). Same for `Effect.runSync` in fixtures or `beforeAll` —
  an async layer later throws `AsyncFiberError`.
- Don't wrap an `it.effect` body in `Effect.scoped` — the runner already provides and closes the
  test's scope. Use an inner `Effect.scoped` only to assert release *during* the test.
- `yield* import("./x.js")` fails ("is not iterable"); use `yield* Effect.promise(() => import("./x.js"))`.
- `assert` vs `expect`: both work inside Effect bodies (they throw; the runner turns the throw into
  a defect and fails the test). Effect-repo convention is `assert` (chai `assert` re-exported, plus
  Node-style `deepStrictEqual`); follow the host repo and don't sweep one into the other.
  `assert.isTrue(guard(x))` does not narrow — chai helpers are not type predicates; use a real `if`.
- `Effect.fn`-wrapped code under test is fine; `it.effect` bodies themselves don't need `Effect.fn`.

## 3. Asserting outcomes

One shape per question:

| Question | Tool | Notes |
|---|---|---|
| success value | `const a = yield* eff` | a failure fails the test with the pretty cause |
| which typed error | `const e = yield* Effect.flip(eff)` then `e._tag` | flip turns `E` into the success; defects still escape (test fails) |
| either channel | `const r = yield* Effect.result(eff)` + `Result.isSuccess/isFailure` | `r.success` / `r.failure` |
| defect / interrupt / mixed | `const exit = yield* Effect.exit(eff)` + `exit.cause.reasons` | `Cause.isFailReason`, `isDieReason`, `isInterruptReason`; `Cause.hasFails/hasDies/hasInterrupts` |
| timeout | `Cause.isTimeoutError(e)` on the flipped error | §5 |

```ts
import { assert, it } from "@effect/vitest"
import { Cause, Effect, Exit, Result, Schema } from "effect"

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", { id: Schema.String }) {}

const findUser = Effect.fn("findUser")(function*(id: string) {
  if (id === "bug") return yield* Effect.die(new Error("invariant broken"))
  if (id !== "ada") return yield* new UserNotFound({ id })
  return { id, name: "Ada" }
})

it.effect("typed failure via flip", () =>
  Effect.gen(function*() {
    const error = yield* Effect.flip(findUser("nobody"))
    assert.strictEqual(error._tag, "UserNotFound")
    assert.strictEqual(error.id, "nobody")
  }))

it.effect("both channels via result", () =>
  Effect.gen(function*() {
    const ok = yield* Effect.result(findUser("ada"))
    const ko = yield* Effect.result(findUser("x"))
    if (!Result.isSuccess(ok)) return assert.fail("expected success")
    assert.strictEqual(ok.success.name, "Ada")
    if (!Result.isFailure(ko)) return assert.fail("expected failure")
    assert.strictEqual(ko.failure._tag, "UserNotFound")
  }))

it.effect("a defect stays a defect (not laundered into E)", () =>
  Effect.gen(function*() {
    const exit = yield* Effect.exit(findUser("bug"))
    if (!Exit.isFailure(exit)) return assert.fail("expected failure")
    // The discriminating line: no Fail reason at all.
    assert.isFalse(exit.cause.reasons.some(Cause.isFailReason))
    const die = exit.cause.reasons.find(Cause.isDieReason)
    assert.instanceOf(die?.defect, Error)
    assert.strictEqual((die?.defect as Error).message, "invariant broken")
  }))
```

Rules:

- **Never compare a whole failed `Exit` built by `Effect.fn`.** `Effect.fn` annotates the cause
  (span/stack), so `deepStrictEqual(exit, Exit.fail(new UserNotFound(...)))` is false even though
  the error is identical (probe-confirmed; a plain `Effect.fail` compares equal). Extract the
  error/defect and compare that.
- **A narrowing `if` without an `else` is a silent pass.** `if (Exit.isFailure(exit)) { assert… }`
  asserts nothing when the effect succeeded. Invert it: `if (!Exit.isFailure(exit)) return assert.fail(...)`.
- `Effect.flip` on an effect that dies does not give you the defect — the test fails with the
  defect. That is correct when the defect is a bug; use `Effect.exit` when the defect is the subject.
- Interrupts without a clock: `Effect.exit(Effect.all([subject, Effect.fail("x")], { concurrency: 2 }))`.
  The cause shows the sibling's `Fail` (`hasInterrupts` may be false), so assert on the observable
  consequence (finalizer ran, state rolled back) rather than the cause shape.
- A thrown callback that has its own Effect channel should stay a defect; test that your code
  doesn't `catch` it into a typed error (`references/errors.md`).

`@effect/vitest/utils` — Node-`assert`-based helpers that compare with `Equal`-aware
`deepStrictEqual` and narrow by `asserts`:

| Helper | Asserts |
|---|---|
| `deepStrictEqual`, `notDeepStrictEqual`, `strictEqual`, `assertEquals` (uses `Equal.equals`) | equality |
| `assertTrue`, `assertFalse`, `assertDefined`, `assertUndefined`, `assertInstanceOf` | truthiness / type |
| `assertInclude(str, sub)`, `assertMatch(str, re)`, `throws`, `throwsAsync`, `doesNotThrow`, `fail` | strings / throws |
| `assertNone(opt)`, `assertSome(opt, a)` | `Option` |
| `assertSuccess(result, a)`, `assertFailure(result, e)` | `Result` |
| `assertExitSuccess(exit, a)`, `assertExitFailure(exit, cause)` | `Exit` (whole-value compare: same `Effect.fn` caveat) |

```ts
import { it } from "@effect/vitest"
import { assertFailure, assertSome, assertSuccess } from "@effect/vitest/utils"
import { Effect, Option, Result } from "effect"

it.effect("utils narrow and compare", () =>
  Effect.gen(function*() {
    assertSome(Option.some(1), 1)
    assertSuccess(yield* Effect.result(Effect.succeed(2)), 2)
    assertFailure(yield* Effect.result(Effect.fail("nope")), "nope")
  }))
```

**Pin public error unions with type tests.** A dropped error case still typechecks at call sites
(a narrower `E` fits a wider one), so pin it. Let `Effect.fn` infer, import the real function (a
`declare const` tests nothing), and use `toEqualTypeOf` (exact), not `toMatchTypeOf`. Name the
file `*.test-d.ts` and run `vitest --typecheck` (or `vitest typecheck`).

```ts
// users.test-d.ts
import { expectTypeOf, test } from "vitest"
import { Effect, Schema } from "effect"

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", { id: Schema.String }) {}
class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {}) {}

const findUser = Effect.fn("findUser")(function*(id: string) {
  if (id === "") return yield* new StoreError()
  if (id !== "ada") return yield* new UserNotFound({ id })
  return { id }
})

test("findUser error union is exactly UserNotFound | StoreError", () => {
  expectTypeOf(findUser).returns.toEqualTypeOf<
    Effect.Effect<{ id: string }, UserNotFound | StoreError>
  >()
})
```

## 4. Layers and fakes

**Default: per-test `Effect.provide(layer)`** — each test builds its own graph, so no state leaks.
Use `layer(L)` only for expensive or immutable resources (a container, a compiled schema, a
read-only fixture DB). In a `layer()` block everything built is shared by every test in it:

- in-memory stores, `Ref`s, caches, recorders (a call-count test reads 4, 5, 6 instead of 1),
- the **TestClock** (one test's `adjust("1 hour")` is the next test's starting time) and
  **TestConsole** lines (probe-confirmed: both are built once per block),
- TTLs, rate limiters, connection pools in a degraded state.

Checklist before collapsing a suite onto `layer()`: Is there in-memory state? Is the layer
constant? Is the lifetime of a stateful service what's under test? Does any test drive the clock?
Is test order relied on? `Layer.fresh(L)` gives separate instances inside one composition; it does
**not** reset state between tests in a `layer()` group.

Shape fakes as layers swapped at the boundary, never as module mocks. The official naming: `layer`
is the self-wired default, `layerNoDeps` keeps requirements open so tests wire it over fakes,
`layerTest` is a ready-made fake (`references/architecture.md`).

```ts
import { assert, it } from "@effect/vitest"
import { Context, Effect, Layer, Option, Ref } from "effect"

interface Todo { readonly id: number; readonly title: string }

class TodoRepo extends Context.Service<TodoRepo, {
  create(title: string): Effect.Effect<Todo>
  find(id: number): Effect.Effect<Option.Option<Todo>>
}>()("@app/todos/TodoRepo") {
  // State is created INSIDE the layer build, so every provide gets a fresh store.
  static readonly layerTest = Layer.effect(
    TodoRepo,
    Effect.gen(function*() {
      const store = yield* Ref.make<ReadonlyArray<Todo>>([])
      return TodoRepo.of({
        create: (title) =>
          Ref.modify(store, (todos) => {
            const todo = { id: todos.length + 1, title }
            return [todo, [...todos, todo]]
          }),
        find: (id) => Effect.map(Ref.get(store), (todos) => Option.fromNullishOr(todos.find((t) => t.id === id)))
      })
    })
  )
}

class Todos extends Context.Service<Todos, {
  add(title: string): Effect.Effect<Todo>
}>()("@app/todos/Todos") {
  static readonly layerNoDeps = Layer.effect(
    Todos,
    Effect.gen(function*() {
      const repo = yield* TodoRepo
      return Todos.of({ add: (title) => repo.create(title.trim()) })
    })
  )
  static readonly layerTest = Todos.layerNoDeps.pipe(Layer.provideMerge(TodoRepo.layerTest))
}

it.effect("adds a trimmed todo", () =>
  Effect.gen(function*() {
    const todo = yield* (yield* Todos).add("  write tests ")
    assert.strictEqual(todo.title, "write tests")
    // provideMerge also exposes the fake repo for state assertions
    const stored = yield* (yield* TodoRepo).find(todo.id)
    assert.isTrue(Option.isSome(stored))
  }).pipe(Effect.provide(Todos.layerTest)))
```

`Layer.succeed(Tag, impl)` is fine for stateless stubs. `Layer.succeed` over a module-level
variable (`let calls = []`) leaks between tests — create state in the build instead.

**`Layer.mock(Tag, partial)`** — implement only what the test touches. Omitted members that are
Effects, Streams, Channels, or functions returning them die with an `UnimplementedError` naming the
service key and method; non-Effect members are still required by the type (`PartialEffectful<S>`).
Better than an `as` cast, and a test that needs many mocked members is telling you the interface is
too broad.

**`Layer.effectContext`** — one stateful fake behind two tags (a fake and its inspector, or two
interfaces of one store):

```ts
import { assert, it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"

class Mailer extends Context.Service<Mailer, {
  send(to: string, body: string): Effect.Effect<void>
}>()("@app/mail/Mailer") {}

class MailerInspector extends Context.Service<MailerInspector, {
  readonly sent: Effect.Effect<ReadonlyArray<string>>
}>()("@app/mail/MailerInspector") {}

class Billing extends Context.Service<Billing, {
  charge(user: string): Effect.Effect<void>
}>()("@app/billing/Billing") {}

const MailerFake = Layer.effectContext(
  Effect.sync(() => {
    const sent: Array<string> = []
    return Context.make(Mailer, Mailer.of({
      // Effect.sync: the push happens when the effect runs, not when it is described.
      send: (to) => Effect.sync(() => void sent.push(to))
    })).pipe(Context.add(MailerInspector, MailerInspector.of({ sent: Effect.sync(() => [...sent]) })))
  })
)

const ArmedFailure = Layer.mock(Billing, {}) // charge() dies with UnimplementedError if reached

it.effect("sends one receipt", () =>
  Effect.gen(function*() {
    yield* (yield* Mailer).send("ada@example.com", "receipt")
    assert.deepStrictEqual(yield* (yield* MailerInspector).sent, ["ada@example.com"])
  }).pipe(Effect.provide(Layer.merge(MailerFake, ArmedFailure))))
```

**Fault injection: decorate one method of a real (or fake) layer.** Spread the base and override a
single member; route every override through `Effect.suspend` so counters and flags are read when
the call *runs*, not when the layer is built.

```ts
import { assert, it } from "@effect/vitest"
import { Context, Data, Effect, Layer } from "effect"

class StoreError extends Data.TaggedError("StoreError")<{}> {}

class Store extends Context.Service<Store, {
  save(key: string, value: string): Effect.Effect<void, StoreError>
  load(key: string): Effect.Effect<string | undefined, StoreError>
}>()("@app/store/Store") {
  static readonly layerMemory = Layer.effect(
    Store,
    Effect.sync(() => {
      const data = new Map<string, string>()
      return Store.of({
        save: (k, v) => Effect.sync(() => void data.set(k, v)),
        load: (k) => Effect.sync(() => data.get(k))
      })
    })
  )
}

// Fail the first N saves, then delegate.
const failingSaves = (n: number) =>
  Layer.effect(
    Store,
    Effect.gen(function*() {
      const base = yield* Store
      let remaining = n
      return Store.of({
        ...base,
        save: (k, v) => Effect.suspend(() => remaining-- > 0 ? Effect.fail(new StoreError()) : base.save(k, v))
      })
    })
  ).pipe(Layer.provide(Store.layerMemory))

it.effect("retries a failed save", () =>
  Effect.gen(function*() {
    const store = yield* Store
    yield* store.save("k", "v").pipe(Effect.retry({ times: 2 }))
    assert.strictEqual(yield* store.load("k"), "v")
  }).pipe(Effect.provide(failingSaves(2))))
```

Three ways to get the decorator wrong: forgetting `Effect.suspend` (the counter decrements at
construction or on the first describe), dropping an argument when forwarding, misspelling the
member name in the spread (adds a new member instead of overriding).

`Layer.updateService(layer, Tag, f)` is the short form for decorating a **dependency as seen by
`layer`** — it is `Layer.provide(layer, Layer.effect(Tag, Effect.map(Tag, f)))`, so the result
still requires `Tag`. Use it on a `layerNoDeps` before providing the fake:
`Svc.layerNoDeps.pipe(Layer.updateService(Store, (s) => ({ ...s, save: … })), Layer.provide(Store.layerMemory))`.
There is no `Layer.mapService`.

Compose the faulty variant **before** anything builds the real one. Layers are memoized by
reference: an inner `Effect.provide(faultyLayer)` under an outer provide that already built the
real service can silently get the real one (probe-verified for a re-provided recipe; see
`references/architecture.md` §5). The tell is a green test with the
wrong duration or call count.

Spies on non-Effect collaborators: restore them with `Effect.acquireRelease(Effect.sync(() =>
vi.spyOn(obj, "m")), (spy) => Effect.sync(() => spy.mockRestore()))` — a `try/finally` around
`yield*` misses failures that leave through the error channel.

## 5. Time: TestClock

Under `it.effect` the clock is always virtual: it starts at epoch `0` (1970-01-01) and moves only
when you move it. `Effect.sleep`, `Effect.timeout`, `Effect.delay`, `Schedule`-driven
`retry`/`repeat`, `Stream` schedules, cache TTLs — all wait on it.

| Call | Effect |
|---|---|
| `TestClock.adjust(duration)` | advance by `duration`; runs every sleep due on or before the new time, in order |
| `TestClock.setTime(ms)` | jump to an absolute timestamp; same draining |
| `TestClock.setTime(Infinity)` | runs **every** pending sleep, including ones scheduled during the drain; the clock then reads `Infinity` (probe-confirmed) |
| `TestClock.withLive(eff)` | run `eff` with the real clock |
| `TestClock.testClockWith(f)` | access the `TestClock` service |
| `TestClock.layer({ warningDelay })` | build one yourself (only outside `it.effect`) |

The pattern is **fork, adjust, join** — a sleep in the test's own fiber blocks the fiber that
would call `adjust`:

```ts
import { assert, it } from "@effect/vitest"
import { Cause, Clock, Effect, Fiber, Schedule } from "effect"
import { TestClock } from "effect/testing"

it.effect("timeout fires at the deadline, not before", () =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Effect.sleep("5 minutes").pipe(Effect.timeout("1 minute")))
    yield* TestClock.adjust("59 seconds")
    assert.isUndefined(fiber.pollUnsafe()) // both sides of the deadline
    yield* TestClock.adjust("1 second")
    const error = yield* Effect.flip(Fiber.join(fiber))
    assert.isTrue(Cause.isTimeoutError(error))
  }))

it.effect("retry schedule: only the outcome matters", () =>
  Effect.gen(function*() {
    let attempts = 0
    const flaky = Effect.suspend(() => ++attempts < 4 ? Effect.fail("busy") : Effect.succeed(attempts))
    const fiber = yield* Effect.forkChild(Effect.retry(flaky, Schedule.exponential("1 second")))
    yield* TestClock.setTime(Infinity)
    assert.strictEqual(yield* Fiber.join(fiber), 4)
  }))

it.effect("TTL logic needs a realistic now", () =>
  Effect.gen(function*() {
    yield* TestClock.setTime(Date.parse("2026-10-03T00:00:00Z"))
    assert.strictEqual(new Date(yield* Clock.currentTimeMillis).getUTCFullYear(), 2026)
  }))
```

Rules:

- **Real delays hang until the 5 s Vitest timeout**, with no Effect-level message. The TestClock
  logs "A test is using time, but is not advancing the test clock" after `warningDelay` (1 s), but
  through the logger — i.e. into the TestConsole — so you don't see it. When a test times out, grep
  the code under test:
  `Effect\.sleep|Effect\.timeout|Effect\.delay|Schedule\.|Effect\.retry|Effect\.repeat|baseDelay|interval|setTimeout\(`.
- **Epoch start inverts date logic** ("newer than 7 days", TTL expiry, JWT `exp`): `setTime` to a
  realistic instant first.
- An `Effect.timeout` guard is inert under `it.effect` until adjusted; under a real clock a guard
  ≥ 5 s loses to the Vitest default. Both surface as "Test timed out in 5000ms", never as
  `TimeoutError`. Raise the Vitest timeout (third argument) for real-time assertions above 5 s.
- **Don't provide `TestClock.layer()` under `it.effect`** — the nested clock's "live" clock is the
  outer virtual one, and `TestClock.adjust` addresses whichever is innermost.
- **Never call `TestClock.adjust` under `it.live`** — there is no TestClock there; it dies.
- **Real async I/O interleaved with sleeps → `it.live`.** One `adjust` drains sleeps registered
  synchronously during the drain, not ones registered after a real macrotask (socket read,
  `setTimeout`, child process). Make fakes settle synchronously, or use `it.live` with short real
  durations.
- In a `layer()` block the clock is shared — later tests start where earlier ones left the clock.
- `Date.now()` / `new Date()` in code under test ignore the TestClock. Read time through
  `Clock.currentTimeMillis` / `DateTime.now` so tests can control it.
- Outside Effect (plain async edges), `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(ms)`
  drives Effect's default live clock, which schedules with `setTimeout` (probe-confirmed: a
  10-second `Effect.sleep` under `Effect.runPromise` resolves after advancing 10 000 ms).

## 6. Concurrency tests

Stage interleavings with `Latch` / `Deferred` / `Queue`, never with sleeps: a sleep either slows the
suite (live) or does nothing (virtual), and in both cases the interleaving isn't guaranteed.

```ts
import { assert, it } from "@effect/vitest"
import { Context, Deferred, Effect, Fiber, Latch, PubSub, Scheduler } from "effect"

const RequestId = Context.Reference<string>("@app/test/RequestId", { defaultValue: () => "none" })

// Two latches: release the fibers in the order that would expose a save/restore-a-global leak.
// With one latch both fibers resume in LIFO order and a leaky implementation still passes.
it.effect("fiber-local value does not leak across fibers", () =>
  Effect.gen(function*() {
    const gateA = yield* Latch.make()
    const gateB = yield* Latch.make()
    const read = (gate: Latch.Latch) => Effect.andThen(gate.await, RequestId)
    const a = yield* Effect.forkChild(read(gateA).pipe(Effect.provideService(RequestId, "a")))
    const b = yield* Effect.forkChild(read(gateB).pipe(Effect.provideService(RequestId, "b")))
    yield* gateA.open
    assert.strictEqual(yield* Fiber.join(a), "a")
    yield* gateB.open
    assert.strictEqual(yield* Fiber.join(b), "b")
  }))

it.effect("handler starts before the cancel arrives", () =>
  Effect.gen(function*() {
    const started = yield* Deferred.make<void>()
    let finalized = false
    const fiber = yield* Effect.forkChild(
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Effect.sync(() => { finalized = true }))
      )
    )
    yield* Deferred.await(started) // a staged point, not a guessed delay
    yield* Fiber.interrupt(fiber)
    assert.isTrue(finalized)
  }))

// Fibers yield only every MaxOpsBeforeYield (2048) ops, so a two-step race is almost never hit.
// Sweep the budget to force interleavings at many points. Probe: this read-then-write counter
// returns 1 at budget 3 and 20 at the default, so only the sweep catches the lost updates.
const racyIncrement = (state: { n: number }) =>
  Effect.sync(() => state.n).pipe(Effect.flatMap((v) => Effect.sync(() => { state.n = v + 1 })))

it.effect("the sweep exposes a lost update", () =>
  Effect.gen(function*() {
    const results = yield* Effect.forEach([3, 4, 5, 8, 13, 32], (budget) =>
      Effect.gen(function*() {
        const state = { n: 0 }
        yield* Effect.all(Array.from({ length: 20 }, () => racyIncrement(state)), { concurrency: "unbounded" })
        return state.n
      }).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, budget)))
    // Against real code assert the invariant (=== 20) at every budget; here we show the sweep bites.
    assert.isTrue(results.some((n) => n < 20))
  }))

it.effect("drain what is queued without hanging", () =>
  Effect.gen(function*() {
    const pubsub = yield* PubSub.unbounded<number>()
    const sub = yield* PubSub.subscribe(pubsub) // needs Scope; it.effect provides it
    yield* PubSub.publish(pubsub, 1)
    yield* PubSub.publish(pubsub, 2)
    assert.deepStrictEqual(yield* PubSub.takeUpTo(sub, 100), [1, 2])
    assert.deepStrictEqual(yield* PubSub.takeUpTo(sub, 100), []) // takeAll would suspend forever here
  }))
```

- `PubSub.takeAll` returns a `NonEmptyArray`, so on an empty subscription it suspends — the test
  hangs to the timeout. Use `PubSub.takeUpTo(sub, n)`.
- A waiting subscriber takes inside `publish`, so "drain what's queued" tests can pass vacuously;
  publish before anyone is waiting, or assert counts.
- Sweep budgets from 3 up: budgets of 1 and 2 livelocked the runtime in a probe (the test hung to
  its timeout and blocked teardown).
- `Scheduler.PreventSchedulerYield` (a `Context.Reference`) removes cooperative yields — the
  opposite lever, for proving a test doesn't depend on yields.
- **Unjoined forks fail silently.** A `forkScoped`/`forkChild` fiber that dies is reported nowhere —
  not in a log, not in the result (probe-confirmed: the test stays green). Join every fiber whose
  outcome matters, or route its `Exit` into a `Deferred` the test awaits.
- `Effect.all` / `Effect.forEach` without `{ concurrency }` are **sequential**; a "concurrency test"
  over them tests nothing concurrent.

## 7. Console and logging

`it.effect` provides `TestConsole`, and the default logger writes through the `Console` service, so
`Effect.log*` lands in `TestConsole` too. A `vi.spyOn(console, "log")` captures nothing; only raw
`console.*`, `process.stdout.write`, or a replaced logger escape it. Under `it.live` output goes to
the real console.

Observed shape (probe-confirmed): the default logger emits two entries per log call — a header like
`"[00:00:00.000] INFO (#4):"` and then the message arguments — and **all levels, including
`Effect.logError`, go to `logLines`**. `errorLines` captures `Console.error` only. Assert with
`includes`, not on whole arrays.

```ts
import { assert, it } from "@effect/vitest"
import { Console, Effect } from "effect"
import { TestConsole } from "effect/testing"

const greet = (name: string) => Effect.log(`hello ${name}`)

it.effect("captures logs; lines are cumulative", () =>
  Effect.gen(function*() {
    yield* greet("ada")
    const before = (yield* TestConsole.logLines).length
    assert.isTrue((yield* TestConsole.logLines).includes("hello ada")) // positive control
    yield* greet("lin")
    const after = (yield* TestConsole.logLines).slice(before)
    assert.isTrue(after.includes("hello lin"))
    assert.isFalse(after.includes("hello ada"))
    yield* Console.error("boom")
    assert.deepStrictEqual(yield* TestConsole.errorLines, ["boom"])
  }))
```

- `logLines` / `errorLines` are cumulative and never drained — snapshot the length before the call
  under test. In a `layer()` block they accumulate across tests.
- A test with only negative assertions ("did not log X") passes when nothing logs at all. Add a
  positive control that proves capture works in the same test.
- To capture structured log records instead of console text, provide a custom logger:
  `Logger.layer([Logger.make((options) => { records.push(options) })])`. Metrics: give each test a
  fresh registry with `Effect.provideService(Metric.MetricRegistry, new Map())`.

## 8. Config and environment

`ConfigProvider.ConfigProvider` is a `Context.Reference` that defaults to `fromEnv()`, so config
reads in tests silently hit the developer's shell. Provide a provider per test; never mutate
`process.env` (it leaks across tests and concurrent workers).

```ts
import { assert, it } from "@effect/vitest"
import { Config, ConfigProvider, Effect } from "effect"

const AppConfig = Config.all({
  port: Config.Int("PORT"),
  debug: Config.Boolean("DEBUG").pipe(Config.withDefault(false))
})

it.effect("reads env-shaped config", () =>
  Effect.gen(function*() {
    const config = yield* AppConfig
    assert.deepStrictEqual(config, { port: 8080, debug: false })
  }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { PORT: "8080" } })))))

it.effect("missing key is a typed failure", () =>
  Effect.gen(function*() {
    const error = yield* Effect.flip(Effect.gen(function*() { return yield* AppConfig }))
    assert.strictEqual(error._tag, "ConfigError")
  }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))))

it.effect("structured config from an object", () =>
  Effect.gen(function*() {
    assert.strictEqual(yield* Config.String("host"), "localhost")
  }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ host: "localhost" })))))
```

`fromEnv({ env: {} })` means "everything unset". `ConfigProvider.fromEnvRecord(record)` accepts
`undefined` values; `ConfigProvider.layerAdd(p)` adds a fallback provider instead of replacing.
Library/engine code should read env only through `Config`, never `process.env`, so this seam works.

## 9. Platform fakes

### HTTP client contract tests

Stub the transport, not your service: provide the real `FetchHttpClient.layer` and replace the
`FetchHttpClient.Fetch` reference with a stub `fetch`. Your request building, status mapping, and
decoding all run for real. One test per status class you map (2xx decode, 4xx domain error, 5xx
upstream error, malformed body, transport failure).

```ts
import { assert, describe, it } from "@effect/vitest"
import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"

const Repo = Schema.Struct({ name: Schema.String, stars: Schema.Number })
class RepoNotFound extends Schema.TaggedError<RepoNotFound>()("RepoNotFound", { name: Schema.String }) {}
class UpstreamError extends Schema.TaggedError<UpstreamError>()("UpstreamError", { status: Schema.Number }) {}

class Repos extends Context.Service<Repos, {
  get(name: string): Effect.Effect<typeof Repo.Type, RepoNotFound | UpstreamError>
}>()("@app/github/Repos") {
  static readonly layerNoDeps = Layer.effect(
    Repos,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient
      return Repos.of({
        get: (name) =>
          client.get(`https://api.example.com/repos/${name}`).pipe(
            Effect.flatMap(HttpClientResponse.matchStatus({
              "2xx": (res) => Effect.flatMap(res.json, Schema.decodeUnknownEffect(Repo)),
              404: () => Effect.fail(new RepoNotFound({ name })),
              orElse: (res) => Effect.fail(new UpstreamError({ status: res.status }))
            })),
            Effect.catchTags({
              HttpClientError: (e) => Effect.fail(new UpstreamError({ status: e.response?.status ?? 0 })),
              SchemaError: () => Effect.fail(new UpstreamError({ status: 200 }))
            })
          )
      })
    })
  )
}

const withFetch = (stub: typeof globalThis.fetch) =>
  Effect.provide(Repos.layerNoDeps.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, stub))
  ))

describe("Repos contract", () => {
  it.effect("2xx decodes", () =>
    Effect.gen(function*() {
      const repo = yield* (yield* Repos).get("effect")
      assert.deepStrictEqual(repo, { name: "effect", stars: 1 })
    }).pipe(withFetch(async () => Response.json({ name: "effect", stars: 1 }))))

  it.effect("404 is RepoNotFound", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip((yield* Repos).get("nope"))
      assert.strictEqual(error._tag, "RepoNotFound")
    }).pipe(withFetch(async () => new Response(null, { status: 404 }))))

  it.effect("5xx is UpstreamError", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip((yield* Repos).get("effect"))
      if (error._tag !== "UpstreamError") return assert.fail(`expected UpstreamError, got ${error._tag}`)
      assert.strictEqual(error.status, 503)
    }).pipe(withFetch(async () => new Response("down", { status: 503 }))))
  // Same shape for transport failure: withFetch(async () => { throw new TypeError("fetch failed") })
})
```

Record what the stub receives (`(input, init) => { calls.push([String(input), init]); … }`) to
assert method, URL, headers, and body. Without `fetch`, build a client directly:
`HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response(...))))`
and provide it with `Layer.succeed(HttpClient.HttpClient, client)`. To test abort propagation,
record `init.signal` in the stub and assert `.aborted` after interrupting.

### FileSystem

`FileSystem.layerNoop(partial)` / `makeNoop(partial)` is **not** an in-memory filesystem. Unstubbed
members answer three different ways: reads/writes/stat/open fail with a typed `NotFound`;
`exists` succeeds with `false` and `remove` succeeds silently; `makeDirectory` and `makeTemp*`
**die** (`Effect.catch` can't absorb them). Use it to stub the one or two calls a unit touches, or
to satisfy a requirement nobody calls. For real filesystem behavior use the platform layer and a
scoped temp directory (deleted when the test's scope closes):

```ts
import { assert, it } from "@effect/vitest"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Path } from "effect"

it.effect("writes and reads in a temp dir", () =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const file = path.join(dir, "note.txt")
    yield* fs.writeFileString(file, "hi")
    assert.strictEqual(yield* fs.readFileString(file), "hi")
  }).pipe(Effect.provide([NodeFileSystem.layer, Path.layer])))
```

For a pure in-memory double, write a `layerMemory` over a `Map` (as in §4) exposing only the
methods your code uses; mind case sensitivity if production runs on APFS/NTFS.

### HttpApi: in-memory client

`HttpApiTest.groups(api, ["users"])` builds a typed client wired straight to the selected groups'
handlers — same request encoding, routing, middleware, and response decoding as a real server, no
socket. Unselected groups get placeholder handlers that fail if called. Provide the handler layers
plus `HttpServer.layerServices` (Path, HttpPlatform, FileSystem, Etag) and any client middleware.

```ts
import { assert, layer } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiTest } from "effect/http-api"

const Api = HttpApi.make("Api").add(
  HttpApiGroup.make("health").add(HttpApiEndpoint.get("ping", "/ping", { success: Schema.String }))
)
const HealthLive = HttpApiBuilder.group(Api, "health", (handlers) => handlers.handle("ping", () => Effect.succeed("pong")))

layer(Layer.mergeAll(HealthLive, HttpServer.layerServices))("HealthApi", (it) => {
  it.effect("ping", () =>
    Effect.gen(function*() {
      const client = yield* HttpApiTest.groups(Api, ["health"])
      assert.strictEqual(yield* client.health.ping(), "pong")
    }))
})
```

### RPC

Three levels: unit (call a handler directly via `Group.toLayer` + `Group.accessHandler`), in-memory
integration (`RpcTest.makeClient(Group)` — real client and server, no serialization, middleware
and streams still run), and end-to-end over a protocol layer per transport you ship.

```ts
import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { Rpc, RpcGroup, RpcTest } from "effect/rpc"

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", { id: Schema.String }) {}
const Users = RpcGroup.make(
  Rpc.make("GetUser", { payload: { id: Schema.String }, success: Schema.String, error: UserNotFound })
)
const UsersHandlers = Users.toLayer({
  GetUser: ({ id }) => id === "1" ? Effect.succeed("Ada") : Effect.fail(new UserNotFound({ id }))
})

it.effect("in-memory RPC round trip", () =>
  Effect.gen(function*() {
    const client = yield* RpcTest.makeClient(Users)
    assert.strictEqual(yield* client.GetUser({ id: "1" }), "Ada")
    const error = yield* Effect.flip(client.GetUser({ id: "2" }))
    assert.strictEqual(error._tag, "UserNotFound")
  }).pipe(Effect.provide(UsersHandlers)))
```

Middleware marked `requiredForClient: true` must be provided on the client side in tests too.

### SQL

Prefer a real engine over mocking `SqlClient`: SQLite in memory for SQL-dialect-agnostic code
(`@effect/sql-sqlite-node`, backed by `node:sqlite`), a Postgres testcontainer for PG-specific SQL
(acquire it in a scoped service or once per run via Vitest `globalSetup` + `inject`). Share the
container with `layer(..., { timeout: "60 seconds" })`; give each test its own schema/table or wrap
it in a rolled-back transaction.

```ts
import { assert, it } from "@effect/vitest"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

const Db = SqliteClient.layer({ filename: ":memory:" })

it.effect("a failed transaction rolls back", () =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE users (name TEXT NOT NULL)`
    yield* sql`INSERT INTO users (name) VALUES ('ada')`.pipe(
      Effect.andThen(Effect.fail("boom")),
      sql.withTransaction,
      Effect.ignore
    )
    const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM users`
    assert.strictEqual(rows[0]?.n, 0)
  }).pipe(Effect.provide(Db)))
```

Nested `withTransaction` uses savepoints — test inner-rollback/outer-commit explicitly if you rely
on it. Run migrations in a layer (`Layer.effectDiscard(Migrator.run(...))`) merged under the client.
For batching resolvers, run requests with `Effect.all(..., { concurrency: "unbounded" })` and assert
the recorded batches, not just results.

### AI: fake LanguageModel through the real constructor

Build the fake with `LanguageModel.make` instead of casting an object to the service: prompt
normalization, tool resolution, structured-output decoding, and tool handlers all run for real. The
hooks return **encoded** response parts; invalid parts fail as `AiError.InvalidOutputError`.

```ts
import { assert, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { LanguageModel } from "effect/ai"

const FakeModel = (text: string) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () =>
        Effect.succeed([
          { type: "text", text },
          { type: "finish", reason: "stop", usage: { inputTokens: { total: 3 }, outputTokens: { total: 5 } } }
        ]),
      streamText: () => Stream.empty
    })
  )

it.effect("summarizes through the model", () =>
  Effect.gen(function*() {
    const response = yield* LanguageModel.generateText({ prompt: "summarize" })
    assert.strictEqual(response.text, "short")
    assert.strictEqual(response.usage.inputTokens.total, 3)
  }).pipe(Effect.provide(FakeModel("short"))))
```

Capture the `ProviderOptions` argument in the hook to assert the prompt, tools, `toolChoice`, and
response format. Return a `{ type: "tool-call", id, name, params }` part to drive real toolkit
handlers; with the default failure mode a handler failure lands in `E`, and bad params surface as a
`ToolParameterValidationError` reason. For streaming, fork the consumer, stage with a `Latch` on the
first part, and use `TestClock.adjust` for slow handlers.

### Atom (effect/reactivity)

Use a fresh `AtomRegistry.make()` per test. Swap a runtime's services by seeding its layer atom:
`AtomRegistry.make({ initialValues: [Atom.initialValue(runtime.layer, TestLayer)] })`; seed data
atoms with `Atom.initialValue(atom, value)`. Read effectful atoms with
`AtomRegistry.getResult(registry, atom)` (waits for the `AsyncResult` to leave `Initial`); use
`registry.mount(atom)` for atoms whose behavior depends on being mounted, and `dispose()` at the end.

```ts
import { assert, it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { Atom, AtomRegistry } from "effect/reactivity"

class Greeting extends Context.Service<Greeting, { readonly text: string }>()("@app/ui/Greeting") {}
const runtime = Atom.runtime(Layer.succeed(Greeting, Greeting.of({ text: "live" })))
const greetingAtom = runtime.atom(Effect.map(Greeting, (g) => g.text))

it.effect("atom reads the swapped service", () =>
  Effect.gen(function*() {
    const registry = AtomRegistry.make({
      initialValues: [Atom.initialValue(runtime.layer, Layer.succeed(Greeting, Greeting.of({ text: "test" })))]
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
    assert.strictEqual(yield* AtomRegistry.getResult(registry, greetingAtom), "test")
  }))
```

### CLI

`Command.runWith(command, { version })(argv)` runs a command against explicit arguments. It
requires the CLI `Environment` (`FileSystem | Path | Terminal | ChildProcessSpawner | Stdio`); in
tests provide `FileSystem.layerNoop({})`, `Path.layer`, `Stdio.layerTest({})`, a
`Terminal.make({...})` stub, and `ChildProcessSpawner.make(() => Effect.die("unused"))`. Observe
effects through a fake service or a recorded array; parse failures arrive as `CliError` in `E`
(rendered unless `renderErrors: false`).

## 10. Property testing

The engine is core `Arbitrary` (`import { Arbitrary } from "effect"`) — no fast-check, no
`Schema.toArbitrary`, no `fastCheck: { numRuns }`. Inputs are Schemas or Arbitraries, as an array
(tuple of values) or a record (object of values).

```ts
import { assert, it } from "@effect/vitest"
import { Arbitrary, Effect, Schema } from "effect"

class Money extends Schema.Class<Money>("Money")({
  currency: Schema.Literals(["EUR", "USD"]),
  // With plain Schema.Int this property fails: the generator emits -0, JSON turns it into 0,
  // and deepStrictEqual distinguishes them (shrunk input: { cents: -0 }).
  cents: Schema.Int.check(Schema.makeFilter((n: number) => !Object.is(n, -0)))
}) {}

const MoneyJson = Schema.fromJsonString(Money)

// Round-trip property per Schema.Class: decode(encode(x)) == x.
it.effect.prop("Money survives JSON", { money: Money }, ({ money }) =>
  Effect.gen(function*() {
    const json = yield* Schema.encodeEffect(MoneyJson)(money)
    const back = yield* Schema.decodeUnknownEffect(MoneyJson)(json)
    assert.deepStrictEqual(back, money)
  }), { arbitrary: { runs: 200, seed: 42 } })

// Algebraic property with explicit sizes: default size 10 clamps lengths and |Int| to ~100.
it.prop(
  "reverse is an involution",
  [Arbitrary.array(Arbitrary.schema(Schema.Int), { maxLength: 500 })],
  ([xs]) => assert.deepStrictEqual([...xs].reverse().reverse(), xs),
  { arbitrary: { size: 200 } }
)

// Sample to see what the generator actually produces before trusting a green run.
it.effect("inspect the generator", () =>
  Effect.gen(function*() {
    const samples = yield* Arbitrary.sampleEffect(Arbitrary.schema(Schema.Number), { count: 500, seed: 1 })
    assert.isTrue(samples.some((n) => Object.is(n, -0))) // -0, NaN, ±Infinity are all generated
  }))
```

Options (`{ arbitrary: CheckOptions }` as the fourth argument, alongside Vitest options):

| Option | Default | Meaning |
|---|---|---|
| `runs` | 100 | successful runs required |
| `size` | 10 | max local complexity; each unconstrained string/array/property grows to it independently |
| `maxDiscards` | `max(100, runs * 10)` | filtered-out attempts before `Exhausted` |
| `maxShrinks` | 100 | shrink candidates inspected after the first failure |
| `seed` | from `Random` | reproduce a run |
| `replay` | — | replay token from a failure report; overrides all of the above |

Behavior: a property falsifies when it returns `false`, throws, or fails (typed failure or defect);
returning anything else (including `void`) passes. Interruption interrupts the test. The failure
report includes the shrunk input and a replay token. Replay tokens are not stable across releases
— pin a shrunk counterexample as an ordinary regression test.

Lower-level: `Arbitrary.schema(S, { shrink })`, `Arbitrary.array/map/filter/filterMap/flatMap/all/Constant`,
`Arbitrary.sampleEffect(arb, { count, size, seed })`, `Arbitrary.checkEffect(arb, property, options)`
returning a `CheckResult` (`Passed | Falsified | Exhausted | ReplayMismatch`), and
`Arbitrary.formatCheckFailure(result)`. `Arbitrary.configureGlobal({ check, sample })` sets
defaults (configure before concurrent tests start).

Generator traps:

- `size` defaults to 10: strings and arrays top out at length 10 and unbounded `Int` around ±100
  (probe-confirmed). Pass `size` (or explicit `maxLength`/bounds) for long-input or overflow bugs.
- `Schema.Number` emits `-0`, `NaN`, and `±Infinity`. JSON loses `-0` and can't carry `NaN`/`Infinity`
  — constrain (`Schema.Finite`, a check excluding `-0`) or compare with `Object.is` deliberately.
- A brand or refinement that is a bare predicate filter can exhaust (`SampleError` with
  ~101 discards). Give it a generation-friendly base (bounded Int, Literals) or a custom arbitrary.
- `Schema.isPattern` regexes generate only without lookarounds/backrefs and without `i`/`m`/`v`
  flags (and need `u` for JSON Schema export); otherwise the pattern is dropped from generation
  and the check exhausts.
- A partial dictionary should be a `Struct` of `optionalKey` fields, not a `Record` (which emits
  every key). A `Union` of `Schema.Class` members generates real instances.

`TestSchema.Asserts` (from `effect/testing`) bundles schema checks:
`new TestSchema.Asserts(S).verifyRoundTrip({ runs, seed })` (Promise) or
`.verifyRoundTripEffect(opts)` (uses the fiber's services and TestClock), `.decoding().succeed(input, expected?)`
/ `.fail(input, message)`, `.encoding()…`, `.decoding().provide(Key, impl)` for schemas with
services, and `.arbitrary().verifyGeneration(opts)` to check the generator respects the schema.

```ts
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { TestSchema } from "effect/testing"

const Port = Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65535 }))

it.effect("Port codec", () =>
  Effect.gen(function*() {
    const asserts = new TestSchema.Asserts(Port)
    yield* asserts.decoding().succeedEffect("8080", 8080)
    yield* asserts.verifyRoundTripEffect({ runs: 100, seed: 7 })
  }))
```

Three tiers, in order of value:

1. **Reference model** — the same random operation sequence against the real implementation and a
   simple model (a `Map`, an array); assert equal observable results. This is also how you prove a
   fake is faithful: run one property suite against `layerMemory` and the real layer.
2. **Algebraic** — round-trips (`decode ∘ encode = id` per `Schema.Class`), idempotence,
   commutativity, monotonicity, invariants preserved by every operation.
3. **Crash** — any input never dies: assert `Exit` has no `Die` reason for hostile/random input
   (malformed input must fail typed, never as a defect).

## 11. False greens, mutation discipline, running vitest

Shapes that pass without testing anything:

| Shape | Why it's green | Fix |
|---|---|---|
| `it("x", () => Effect.gen(...))` | the Effect is never run | `it.effect` |
| `it.scoped(...)` / `it.scopedLive(...)` | Vitest fixture API; registers nothing | `it.effect` / `it.live`; typecheck tests |
| `if (Exit.isFailure(exit)) { assert… }` | success path asserts nothing | `if (!…) return assert.fail(…)` |
| eager recorder `calls.push(x)` outside `Effect.sync`/`suspend` | records described, not executed, calls | `Effect.sync(() => calls.push(x))` |
| only negative assertions on `logLines` | nothing logged at all also passes | positive control in the same test |
| unjoined forked fiber fails | failure reported nowhere | join, or `Deferred` the `Exit` |
| `Effect.timeout` guard under TestClock | never fires; shows up as Vitest timeout | fork/adjust/join; assert `Cause.isTimeoutError` |
| one latch in an isolation test | LIFO resumption hides the leak | two latches, release in the exposing order |
| two-step race without a yield sweep | default 2048-op budget never interleaves | sweep `Scheduler.MaxOpsBeforeYield` |
| "drain queue" with a waiting subscriber | subscriber took inside `publish` | publish first; `takeUpTo` |
| `layer()` sharing a stateful fake | test passes only in file order | per-test `Effect.provide` |
| `Effect.all` without `concurrency` in a concurrency test | it's sequential | `{ concurrency: "unbounded" }` |
| property with default `size` | inputs never large enough to hit the bug | set `size`/bounds; sample first |
| helper used on both sides of a comparison | it agrees with itself | assert its literal output once |
| `Exit` deep-equal after `Effect.fn` | never equal — so the test was rewritten to something weaker | extract the error and compare it |
| `-t` filter matching nothing | all tests skipped, exit 0 | confirm your test appears as passed |

**Prove the test can fail.** Before calling a test done, break the code it pins, watch *that* test
go red for the *right* reason (quote the failure message), then restore:

1. Baseline: `git status --porcelain`.
2. Mutate with an editor (never `git checkout`/`stash`, which can eat unrelated work): flip a
   condition, drop a branch, change a constant, remove an `Effect.retry`.
3. Run only the target test; confirm it fails with the expected assertion, not a type error or
   timeout.
4. Revert; diff against the baseline.

One mutation per rule and per code path — two code paths for one rule are two pins. Choose inputs
wrong in exactly one way ("what input makes this rule fire alone?"). Cover first/last/middle,
empty/one/many, the failure paths, and the public seam rather than internals. A surviving mutant
means a missing test — or code that can be deleted. A semantics-preserving change (a perf fix) is
"fixed but unpinned"; say so instead of writing a test that can't fail.

Running vitest:

- Read the exit code **and** the counts. Observed on Vitest 5.0.3: no matching test files →
  "No test files found", exit 1; a file that registers nothing → "No test suite found", exit 1;
  but a `-t` name filter that matches nothing → every test *skipped*, **exit 0**. A run you meant
  to target is only evidence if the summary shows your test as passed. Never add
  `--passWithNoTests` to make an empty run green. Also read the `Errors` / unhandled-errors
  section — an unhandled rejection fails a run whose tests all pass.
- Run from the repo root so the root config applies; a positional filter is a path substring, and
  `-t` filters by test name.
- `vitest --typecheck` runs `*.test-d.ts`. Run `tsc --noEmit` on test files too: it catches
  `it.scoped` (argument count) and dropped error cases (via type tests). It does **not** catch an
  Effect returned from plain `it` (any return type is accepted) — grep for
  `\bit(\.only|\.skip)?\("[^"]*",\s*(async\s*)?\(\)\s*=>\s*Effect\.` instead.
- Timeouts that only appear under coverage or CI load mean a real delay leaked into an `it.effect`
  test (§5) or a live test is too tight — fix the delay, don't raise the timeout blindly.
