---
name: typescript-best-practices
description: TypeScript best practices for types, narrowing, boundary validation, and tests. Use when reading or editing any .ts or .tsx file.
disable-model-invocation: true
---

# TypeScript best practices

Apply the **principle-type-system-discipline** skill first. Project rules beat these. When a [stack add-on](../poteto-mode/references/harness.md#stack-add-ons) covers the code, apply these rules in the forms it names.

## Rules

| Rule | Summary |
|------|---------|
| Discriminated unions | Model variants with a literal discriminant so impossible states can't be represented. No optional-field bags. Pick one discriminant name per codebase. |
| Branded types | Brand primitives so they can't be mixed up. Validate once at the boundary. Use `& { readonly __brand: "X" }`. |
| Constructive modeling | Build the shape so the illegal value can't be constructed. `readonly [T, ...T[]]` for non-empty, `[T, T][]` for even length, `start` plus `duration` for a range. Not a runtime guard, not a wish for refinement types. |
| Simplest total type | Keep `T[]` while every operation on it stays total. Strengthen to non-empty only where the loose type forces `!`, a cast, or a "should never happen" throw. |
| `unknown` over `any` | External data is `unknown`. |
| Schemas before guards | Before hand-writing a property-by-property type guard, use the repository's schema library and derive the type from the schema. Do not add a second schema library beside it. |
| No `as` casts | Every `as` is a runtime crash waiting. Cast only after validation. |
| Narrowing hierarchy | Discriminant switch > `in` operator > `typeof`/`instanceof` > user-defined type guard > `as`. |
| Type guards | Must verify the claim. A lying guard is worse than `as` because the bug hides behind a name that says it's safe. Name them `isX` or `hasX`. |
| Exhaustiveness | Inline `const _exhaustive: never = x;` in default arms so the compiler errors when a new variant is added. |
| `satisfies` over `as` | Validates the value without widening literal types. |
| Boundary validation | Parse where data crosses in, into a named domain type. `Record<string, unknown>` (however spelled) stops at that parse. Trust types inside. See the **principle-boundary-discipline** skill. |
| Time and randomness | Keep the logic that uses the current time or a random value in a plain function that takes it as an argument, so tests can control it. |
| Schema-derived types | Reach for `Pick`/`Omit`/`Parameters`/`ReturnType`/`Awaited`/`typeof` before declaring a new interface. |
| Object args | Pass objects, not positional, so argument order is self-documenting. Skip on hot paths (per-frame render, tokenizers, parsers). |
| Real tests | Don't mock what you can run. Prefer the framework's real test primitives with leak/disposable checks, and verify UI in a running build. Mock only what you can't run locally. See the **pstack-tdd** skill. |
| Structured telemetry | Prefer structured logger diagnostics with enough context to debug from an id. No `console.log` in shipped code. |

Examples: this skill's `references/patterns.md`.
