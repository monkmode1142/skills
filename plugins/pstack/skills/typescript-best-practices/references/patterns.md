# TypeScript patterns

Code examples for each rule in `SKILL.md`. The underlying principles are language-agnostic. See the **principle-type-system-discipline** and **principle-boundary-discipline** skills.

Backend examples are Effect v4, typechecked against `effect` 4.0.0. A project on a 4.0.0 RC or beta spells some names differently, so run the **effect** skill's SKILL §1 version gate and confirm each symbol against the installed version before copying it (`references/v4-catalog.md` §4 lists the RC to 4.0.0 renames). Frontend examples are plain TypeScript.

## Branded types

Brand primitives so they can't be mixed up. Validate once at the boundary. Downstream code trusts the type.

```ts
import { Effect, Schema } from "effect";

const AgentId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("AgentId"));
type AgentId = typeof AgentId.Type;

const decodeAgentId = Schema.decodeUnknownEffect(AgentId);

const focusAgent = Effect.fn("Agents.focus")(function* (id: AgentId) {
  yield* Effect.logInfo("focus").pipe(Effect.annotateLogs({ agentId: id }));
});
```

`Schema.brand` adds the nominal tag and no runtime check. The validation comes from the checks on the base schema (`isUUID` here). A brand with no check is a cast with a nicer name.

In plain TypeScript, match the `readonly __brand: "X"` shape. Don't invent a new convention.

```ts
type AgentId = string & { readonly __brand: "AgentId" };
```

## Discriminated unions

Model variants with a literal discriminant. Every variant shares the field name and each variant's value is unique, so impossible combos can't be represented.

```ts
// Don't. Boolean + optionals lets contradictory states exist.
type DiffState = { loading: boolean; diff?: GitDiff; error?: string };

// Do. Only valid states exist.
type DiffState =
  | { kind: "loading" }
  | { kind: "ready"; diff: GitDiff }
  | { kind: "error"; error: string };
```

When the union crosses a boundary or lives in Effect code, define it as a schema so the type, the validator, and the wire codec are one definition. Effect's discriminant is `_tag`.

```ts
import { Schema } from "effect";

const DiffState = Schema.Union([
  Schema.TaggedStruct("Loading", {}),
  Schema.TaggedStruct("Ready", { patch: Schema.String }),
  Schema.TaggedStruct("Failed", { reason: Schema.String }),
]);
type DiffState = typeof DiffState.Type;
```

`Schema.Union` and `Schema.Literals` take an array in v4. `Schema.TaggedUnion({ Loading: {}, Ready: { patch: Schema.String } })` is the shorthand when every variant is a tagged struct (the **effect** skill's `references/schema.md` §8.3). Pick one discriminant name per codebase and stick to it.

## Constructive modeling

Build the type from parts that are all legal instead of restricting a loose type with runtime checks.

Non-empty, via a variadic tuple:

```ts
type NonEmpty<T> = readonly [T, ...T[]];

// Don't: T[] plus a length check every caller must repeat
function leader(entries: string[]): string {
  if (entries.length === 0) throw new Error("no entries");
  return entries[0];
}

// Do: an empty value of the type can't exist
function leader(entries: NonEmpty<string>): string {
  return entries[0];
}
```

Effect ships the same shape as `Array.NonEmptyReadonlyArray<T>`. Use it in Effect code instead of declaring your own. At a boundary, `Schema.NonEmptyArray(S)` decodes straight into it.

Where a plain `T[]` arrives, narrow once with a guard. The fact then travels in the type:

```ts
import { Array } from "effect";

if (Array.isReadonlyArrayNonEmpty(entries)) {
  leader(entries);
}
```

Even length, as pairs:

```ts
type Pairs<T> = [T, T][];
```

A time range, as start plus duration:

```ts
// Don't: a comment holds the invariant
type TimeRange = { start: Date; end: Date }; // start <= end

// Do: a negative range can't be written; derive end when needed
type TimeRange = { start: Date; durationMs: number };
```

Keep `durationMs` a plain number. Brand it (per Branded types) only if a raw number could be passed where a duration is expected, not by reflex. Pick the representation that makes the bad state unconstructable, then expose the reading you need on top (`pairs.flat()`, a `rangeEnd()` helper).

## Simplest total type

Don't strengthen everything. Keep `T[]` when every operation on it is total:

```ts
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0); // [] is 0, fine
```

Strengthen when the loose type forces a lie at a use site. The tells are `!`, `arr[0] as T`, and a "should never happen" throw:

```ts
// Don't: partiality smuggled past the compiler
function newestSession(sessions: Session[]): Session {
  return sessions.at(0)!;
}

// Do: strengthen the input; the assertion disappears
function newestSession(sessions: NonEmpty<Session>): Session {
  return sessions[0];
}
```

Weakening the result to `Session | undefined` (or `Option<Session>` in Effect code) is the other total signature.

## `unknown` over `any`

External data is always `unknown`. Narrow before use.

```ts
// Don't
function handle(input: any) {
  return input.foo.bar;
}

// Do
function handle(input: unknown) {
  if (typeof input === "object" && input !== null && "foo" in input) {
    // narrowed; compiler verifies access
  }
}
```

External sources include RPC payloads, `JSON.parse`, `postMessage`, IPC, file contents, environment variables, database results. In Effect code the narrowing step is a schema decode, below.

## Schemas before hand-rolled guards

Before writing a property-by-property type guard for external data, look for the repository's runtime schema library and existing schemas. Let one schema own validation and derive the TypeScript type from it. Do not maintain a schema, a duplicate interface, and a guard that can drift apart.

```ts
import { Schema } from "effect";

const User = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  role: Schema.Literals(["admin", "member"]),
});
type User = typeof User.Type;

const decodeUser = Schema.decodeUnknownEffect(User);
```

`decodeUnknownEffect` fails with a `SchemaError` in the `E` channel. Use `decodeUnknownResult` or `decodeUnknownOption` when failure is an expected branch in pure code. `decodeUnknownSync` throws, so keep it to non-Effect edges and tests. In Effect code, `Schema` is the schema library. Do not add zod or valibot beside it. A non-Effect codebase uses the library it already has with that library's inference helper. Do not add a new schema dependency for one guard. This rule prefers the schema system the codebase already trusts.

## No `as` casts

Every `as` is a potential runtime crash. Cast only after the type system has verified the claim.

```ts
// Don't
const user = data as User;

// Don't
function isUser(data: unknown): data is User {
  return typeof data === "object" && data !== null && "id" in data;
}

// Do
import { Schema } from "effect";

const User = Schema.Struct({ id: Schema.String, name: Schema.String });
type User = typeof User.Type;

const parseUser = Schema.decodeUnknownEffect(User);
```

When you need a guard, derive it with `Schema.is(User)`. It checks exactly what the schema checks.

When the type comes first (a generated type, a shared interface), annotate the schema with the type it proves. The compiler then rejects a schema that proves less than the type. Remove `name` from the struct below and the assignment fails to compile.

```ts
import { Schema } from "effect";

type User = { id: string; name: string };

const User: Schema.Codec<User> = Schema.Struct({ id: Schema.String, name: Schema.String });
```

When refactoring an `as` out of existing code, identify why TypeScript can't infer:

- Missing discriminant: add one, switch to a discriminated union.
- Overly wide source type (e.g. `Record<string, unknown>`): narrow it.
- Untyped boundary: parse with the schema that owns the shape. Add a schema only where none exists.
- Genuinely inexpressible: use a branded type or `satisfies`.

## Narrowing hierarchy

From best to last-resort:

1. **Discriminated union switch / if.** Compiler narrows automatically.
2. **`in` operator.** `"key" in obj` narrows to variants containing that key.
3. **`typeof` / `instanceof`.** For primitives and class instances.
4. **User-defined type guard.** When the above aren't enough.
5. **`as` cast.** Only after validation.

```ts
function area(s: Shape): number {
  if ("radius" in s) return Math.PI * s.radius ** 2; // narrowed to circle
  return s.width * s.height; // narrowed to rect
}
```

## Type guards

A guard must actually verify the claim. A lying guard is worse than `as`.

```ts
function isCircle(s: Shape): s is Shape & { kind: "circle" } {
  return s.kind === "circle";
}
```

Prefer discriminant narrowing when possible. When the shape has a schema, `Schema.is(Circle)` is the guard.

## Exhaustiveness

In default arms, assign the discriminant to a `never`-typed local.

```ts
// Value-returning switch
function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.radius ** 2;
    case "rect":
      return s.width * s.height;
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

// Void switch
function handle(s: Shape): void {
  switch (s.kind) {
    case "circle":
      drawCircle(s);
      break;
    case "rect":
      drawRect(s);
      break;
    default: {
      const _exhaustive: never = s;
      void _exhaustive;
    }
  }
}
```

Return-style in value-returning switches, void-style in statement switches.

For `_tag` unions in Effect code, `Match.valueTags` requires a handler per tag and fails to compile when a tag is missing:

```ts
import { Match } from "effect";

const label = (state: DiffState) =>
  Match.valueTags(state, {
    Loading: () => "loading",
    Ready: (s) => `${s.patch.length} bytes`,
    Failed: (s) => s.reason,
  });
```

## `satisfies` over `as`

`satisfies` validates without widening literal types.

```ts
// Don't. Widens, loses literal types.
const config = { theme: "dark", cols: 3 } as Config;

// Do. Validates AND preserves literal types.
const config = { theme: "dark", cols: 3 } satisfies Config;
// config.theme is "dark" (literal), not string
```

## Boundary validation

Validate once where data crosses in. Trust types inside. See the **principle-boundary-discipline** skill.

- **Wire formats** (proto, JSON-RPC): parse with `ignoreUnknownFields` so forward-compatible changes don't break old clients.
- **Persisted JSON:** a versioned schema decoded through `Schema.fromJsonString`, with the failure mapped to a tagged error the caller can handle.
- **Don't re-validate** deep in call chains.

```ts
import { Effect, Schema } from "effect";

class StateCorrupt extends Schema.TaggedError<StateCorrupt>()("StateCorrupt", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

const PersistedState = Schema.Struct({
  version: Schema.Literal(2),
  lastRunAt: Schema.Number,
});

const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedState));

const loadState = Effect.fn("StateStore.load")(function* (path: string, raw: string) {
  return yield* decodeState(raw).pipe(
    Effect.mapError((cause) => new StateCorrupt({ path, cause })),
  );
});
```

## Errors as values

Failures are data in the `E` channel. The signature then tells the caller every way the call can fail, and the compiler checks the handling.

```ts
// Don't. The signature hides both failure modes.
async function getInvoice(id: InvoiceId): Promise<Invoice> {
  const raw = await sdk.invoices.retrieve(id);
  if (!raw) throw new Error(`invoice ${id} not found`);
  return raw as Invoice;
}
```

```ts
// Do. billing.ts
import { Context, Effect, Layer, Schema } from "effect";

export const InvoiceId = Schema.String.check(Schema.isPattern(/^inv_[a-z0-9_]+$/u)).pipe(
  Schema.brand("InvoiceId"),
);
export type InvoiceId = typeof InvoiceId.Type;

export const Invoice = Schema.Struct({ id: InvoiceId, amountCents: Schema.Int });
export type Invoice = typeof Invoice.Type;

export class InvoiceNotFound extends Schema.TaggedError<InvoiceNotFound>()("InvoiceNotFound", {
  id: InvoiceId,
}) {}

export class BillingError extends Schema.TaggedError<BillingError>()("BillingError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface VendorSdk {
  readonly invoices: { readonly retrieve: (id: string) => Promise<unknown> };
}
export const VendorSdk = Context.Service<VendorSdk>("@app/billing/VendorSdk");

export interface BillingShape {
  readonly invoice: (id: InvoiceId) => Effect.Effect<Invoice, InvoiceNotFound | BillingError>;
}

const decodeInvoice = Schema.decodeUnknownEffect(Invoice);

export class Billing extends Context.Service<Billing, BillingShape>()("@app/billing/Billing") {
  static readonly layerNoDeps = Layer.effect(
    this,
    Effect.gen(function* () {
      const sdk = yield* VendorSdk;

      const invoice = Effect.fn("Billing.invoice")(function* (id: InvoiceId) {
        const raw = yield* Effect.tryPromise({
          try: () => sdk.invoices.retrieve(id),
          catch: (cause) => new BillingError({ operation: "invoices.retrieve", cause }),
        });
        if (raw === null) return yield* new InvoiceNotFound({ id });
        return yield* decodeInvoice(raw).pipe(
          Effect.mapError((cause) => new BillingError({ operation: "decode", cause })),
        );
      });

      return Billing.of({ invoice });
    }),
  );
}
```

What the Do version shows:

- **One tagged error per domain outcome.** `InvoiceNotFound` is a result the caller branches on with `Effect.catchTag`. `BillingError` collapses every foreign failure into one type at the boundary.
- **`Effect.tryPromise` at the edge, once.** The SDK's Promise never leaks past this function.
- **The dependency is a tag.** `VendorSdk` is a function-style `Context.Service` key that carries the raw SDK handle. `Billing.layerNoDeps` requires it, so a missing provider is a compile error at the composition root. The composition root provides the real SDK. Tests provide a fake.
- **The id is package-qualified.** The string is the runtime identity, so two services both named `"Billing"` would share one slot.
- **`Effect.fn("Billing.invoice")`** names the span. Every call shows up in traces with no extra code.

A failure that means the program is wrong (a missing config key, an invariant the boundary already proved) is a defect. Promote it with `Effect.orDie` instead of adding it to `E`. Service forms, layer naming, and the TDZ trap of `static` layers are in the **effect** skill's `references/architecture.md` §2, §3. Error design is in its `references/errors.md` §2 and §7.

## Time and randomness

Read time and randomness from the environment so tests can control them. Keep the logic that uses the value pure.

```ts
// Don't
const isExpired = (token: Token) => Date.now() >= token.expiresAt;
```

```ts
// Do
import { Clock, Effect, Schema } from "effect";

interface Token {
  readonly expiresAt: number;
}

class TokenExpired extends Schema.TaggedError<TokenExpired>()("TokenExpired", {
  expiresAt: Schema.Number,
}) {}

const isExpired = (token: Token, now: number) => now >= token.expiresAt;

const ensureFresh = Effect.fn("Auth.ensureFresh")(function* (token: Token) {
  const now = yield* Clock.currentTimeMillis;
  if (isExpired(token, now)) return yield* new TokenExpired({ expiresAt: token.expiresAt });
  return token;
});
```

`DateTime.now` and the `Random` module follow the same rule. Under `it.effect` the clock is a `TestClock`, so the same code runs in virtual time (the **effect** skill's `references/testing.md` §5).

## Concurrency

```ts
// Don't. Unbounded, and one rejection abandons the rest unobserved.
await Promise.all(accountIds.map((id) => syncAccount(id)));
```

```ts
// Do. Bounded, interruptible, typed failures.
import { Effect } from "effect";

declare const syncAccount: (id: string) => Effect.Effect<void>;

const syncAll = Effect.fn("Accounts.syncAll")(function* (accountIds: ReadonlyArray<string>) {
  yield* Effect.forEach(accountIds, syncAccount, { concurrency: 4, discard: true });
});
```

`Effect.forEach` and `Effect.all` are sequential until you pass `{ concurrency }`, so code that reads as parallel may not be.
A limit shared by many callers belongs on the shared resource (a `Semaphore` around the client, or a wrapped client layer), not at each call site. See the **effect** skill's SKILL §6 and `references/concurrency.md` §3.

## Real tests

Run the real service. Swap only its ports with test layers.

```ts
// billing.test.ts
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Billing, InvoiceId, VendorSdk } from "./billing.js";

const TestBilling = Billing.layerNoDeps.pipe(
  Layer.provide(
    Layer.succeed(VendorSdk, {
      invoices: { retrieve: () => Promise.resolve(null) },
    }),
  ),
);

it.effect("an unknown invoice fails with InvoiceNotFound", () =>
  Effect.gen(function* () {
    const billing = yield* Billing;
    const error = yield* Effect.flip(billing.invoice(InvoiceId.make("inv_missing")));
    expect(error).toMatchObject({ _tag: "InvoiceNotFound", id: "inv_missing" });
  }).pipe(Effect.provide(TestBilling)),
);
```

`it.effect` runs the Effect with a `Scope`, `TestClock`, and `TestConsole`. A plain `it` that returns an Effect never runs it, and `Effect.runPromise` inside a plain `it` skips the test services. See the **pstack-tdd** skill and the **effect** skill's SKILL §7 and `references/testing.md` §2 to §4.

## Schema-derived types

When a `.proto`, OpenAPI spec, GraphQL schema, database migration, or Effect `Schema` already defines a shape, derive from it instead of duplicating it.

```ts
// Don't. Duplicate shape, drifts when the schema changes.
type CheckSummary = {
  totalCount: number;
  checks: { name: string; status: string }[];
};
function renderChecks(s: CheckSummary) {
  /* ... */
}

// Do. Derive from the generated schema type.
import type { ChecksMessage } from "<generated module>";
function renderChecks(s: Pick<ChecksMessage, "totalCount" | "checks">) {
  /* ... */
}
```

Reach for `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, `typeof` before writing a new interface. For an Effect schema, the type is `typeof X.Type`, the wire shape is `typeof X.Encoded`, and a wider struct spreads the fields: `Schema.Struct({ ...User.fields, lastSeenAt: Schema.Number })`.

## Object args

```ts
// Don't. Swap two args, still compiles.
openFile(uri, {
  startLineNumber: 10,
  startColumn: 1,
  endLineNumber: 10,
  endColumn: 1,
});

// Do. Order-independent, self-documenting.
openFile({
  uri,
  selection: {
    startLineNumber: 10,
    startColumn: 1,
    endLineNumber: 10,
    endColumn: 1,
  },
});
```

Skip on hot paths: per-frame render, tokenizers, parsers, anything in a tight loop where the allocation cost matters.
