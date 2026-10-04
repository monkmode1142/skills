---
name: typescript-best-practices
description: TypeScript best practices, Effect v4 first for non-frontend code. Use when reading or editing any .ts or .tsx file.
disable-model-invocation: true
---

# TypeScript best practices

Apply the **principle-type-system-discipline** skill first.

## Which TypeScript

Non-frontend TypeScript (services, CLIs, scripts, workers, infra, and the tests for those) is Effect v4. Frontend UI code (React components, hooks, styling) is plain TypeScript unless the project already uses Effect there. Project rules beat both defaults. See the stack defaults in [harness.md](../poteto-mode/references/harness.md).

Before you write or review Effect code:

1. **Run the version gate.** The **effect** skill's SKILL §1 resolves the installed `effect`. The skill targets 4.0.0. A `4.0.0-rc.*` or `-beta.*` install spells names differently, most visibly the old `effect/unstable/*` import paths. Follow the installed source there and offer the upgrade (`references/migration.md`, `references/v4-catalog.md` §4). A `3.x` install gets no v4 shapes at all.
2. **Load the effect skill.** Read SKILL §1 through §8 once per session. It is the API catalog and the source of truth for signatures. This skill does not re-teach the API. The routing table in [effect.md](../poteto-mode/references/effect.md) names the section for each step.
3. **Copy a same-version call site** from the codebase before inventing a shape.
4. **Run SKILL §8 before calling it done.** Its checklist is part of done for any Effect change.

In the table below, "SKILL §N" and `references/<file>.md` §N point into the effect skill (`~/.agents/skills/effect/`). This skill's own examples are in `references/patterns.md`.

## Rules

| Rule | Summary |
|------|---------|
| Discriminated unions | Model variants with a literal discriminant so impossible states can't be represented. No optional-field bags. Effect code uses `_tag`, because `Schema.TaggedUnion`, `Schema.TaggedStruct`, `Schema.TaggedClass`, `Match`, and `Effect.catchTag` all key on it (`references/schema.md` §8.3). |
| Branded types | Brand primitives so they can't be mixed up. Validate once at the boundary. In Effect code, use `Schema.String.check(...).pipe(Schema.brand("X"))`. The checks on the base schema are the validation, since `brand` adds none (`references/schema.md` §5, §8.2). In plain TS, use `& { readonly __brand: "X" }`. |
| Constructive modeling | Build the shape so the illegal value can't be constructed. `readonly [T, ...T[]]` (Effect spells it `Array.NonEmptyReadonlyArray<T>`) for non-empty, `[T, T][]` for even length, `start` plus `duration` for a range. Not a runtime guard, not a wish for refinement types. |
| Simplest total type | Keep `T[]` while every operation on it stays total. Strengthen to non-empty only where the loose type forces `!`, a cast, or a "should never happen" throw. |
| `unknown` over `any` | External data is `unknown`. |
| Schemas before guards | Before hand-writing a property-by-property type guard, use the repository's schema library and derive the type from the schema. In Effect code that library is `Schema` and the type is `typeof X.Type`. Do not add zod or valibot beside it. |
| No `as` casts | Every `as` is a runtime crash waiting. Cast only after validation. |
| Narrowing hierarchy | Discriminant switch > `in` operator > `typeof`/`instanceof` > user-defined type guard > `as`. |
| Type guards | Must verify the claim. A lying guard is worse than `as` because the bug hides behind a name that says it's safe. Name them `isX` or `hasX`. In Effect code, derive the guard with `Schema.is(X)` so it cannot drift from the schema. |
| Exhaustiveness | Inline `const _exhaustive: never = x;` in default arms so the compiler errors when a new variant is added. In Effect code, `Match.valueTags` and `Match.exhaustive` give the same guarantee. |
| `satisfies` over `as` | Validates the value without widening literal types. |
| Boundary validation | Parse where data crosses in, into a named domain type. `Record<string, unknown>` (however spelled) stops at that parse. Trust types inside. In Effect code the parse is `Schema.decodeUnknownEffect` (or a sibling runner), and its `SchemaError` maps into the boundary's tagged error (`references/schema.md` §7). See the **principle-boundary-discipline** skill. |
| Errors as values | In Effect code, failures ride the typed `E` channel as `Schema.TaggedError` classes. No `throw`, no `try/catch`, no hand-rolled `Result` type. A bug or misconfiguration is a defect, so promote it with `Effect.orDie` instead of widening `E`. Raise with `return yield* new X({...})` (`references/errors.md` §2, §4). |
| Foreign code at the edge | Wrap a Promise or callback API once, where it enters, with `Effect.tryPromise({ try, catch })` and collapse its failures into one tagged error. No `async`/`await` plumbing inside Effect code. Call `Effect.run*` only at the process edge. Prefer the Effect-native client (`HttpClient` from `effect/http`, `SqlClient` from `effect/sql`) over wrapping `fetch` or a driver yourself (SKILL §2, `references/platform.md`). |
| Services and layers | Dependencies are `Context.Service` tags with package-qualified ids (`"@app/billing/Billing"`). Each service builds its own layer as a static (`layer` self-wired, `layerNoDeps` with requirements open for tests), from `Layer.effect(this, make)` returning `X.of({...})`. Access with `yield* X`. No module singletons, no hand-rolled DI containers, no business logic that imports a concrete client. If a dependency can't be swapped for a fake without editing the service, it isn't injected. Forms and naming are in SKILL §4 and `references/architecture.md` §2, §3. |
| Traced functions | Write service methods as `Effect.fn("Service.method")` so every call opens a named span. Don't wrap `Effect.gen` in a bare arrow function, and don't `.pipe` an `Effect.fn`. Pass whole-call combinators as its trailing arguments (SKILL §3). |
| Time and randomness | Read `Clock`, `Random`, and `DateTime` from the environment. No `Date.now()`, `new Date()`, or `Math.random()` in Effect code. Keep the pure logic that uses the value in a plain function that takes it as an argument (SKILL §6). |
| Concurrency | `Effect.forEach(items, f, { concurrency })` over `Promise.all`. Shared limits go through `Semaphore` or `RateLimiter`. `Effect.all` and `forEach` are sequential until you pass `{ concurrency }`. Background work forks into a scope (`Effect.forkScoped`), never detached by default (`references/concurrency.md` §1, §3). |
| Schema-derived types | Reach for `Pick`/`Omit`/`Parameters`/`ReturnType`/`Awaited`/`typeof` before declaring a new interface. In Effect code, derive from the schema (`typeof X.Type`, spread `X.fields` to extend a struct). |
| Object args | Pass objects, not positional, so argument order is self-documenting. Skip on hot paths (per-frame render, tokenizers, parsers). |
| Real tests | Don't mock what you can run. In Effect code, test with `@effect/vitest` `it.effect` (never `Effect.runPromise` inside a plain `it`), run the real service over test layers (`Layer.succeed` for a port, an in-memory layer for storage), and drive time with `TestClock` instead of sleeping (SKILL §7, `references/testing.md`). Prefer the framework's real test primitives with leak/disposable checks, and verify UI in a running build. Mock only what you can't run locally. See the **pstack-tdd** skill. |
| Structured telemetry | Prefer structured logger diagnostics with enough context to debug from an id. In Effect code, use `Effect.log*` with `Effect.annotateLogs` inside traced functions. No `console.log` in shipped code. |

**Frontend exception.** React components, hooks, and styling stay plain TypeScript. They use `async`/`await`, the framework's error boundaries, and the repository's existing schema library. The type rules above still apply. When frontend code calls an Effect backend, decode the response with the same `Schema` the backend encodes with if the schema is shared, so the wire contract has one definition.

Examples: this skill's `references/patterns.md`.
