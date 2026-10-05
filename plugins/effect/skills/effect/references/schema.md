# Effect Schema v4 — the complete agent reference

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

`Schema` lives in core (`import { Schema } from "effect"`), with companions `SchemaGetter`,
`SchemaTransformation`, `SchemaIssue`, `SchemaParser`, `SchemaAST`, `SchemaRepresentation`,
`JsonSchema` and `Arbitrary` on the root barrel. `effect/schema` (lowercase, `@stability unstable`)
holds `Model`, `VariantSchema` and the JIT/AOT compilers. The official long-form guide is `packages/effect/SCHEMA.md` in the
repo at tag `effect@4.0.0` (not in the npm package; `AGENTS.md` links it; 7k lines, read it by heading). The v3 names in a model's
memory are mostly wrong here. Section 9 maps them.

## Contents

1. [Mental model](#1-mental-model)
2. [Constructors](#2-constructors)
3. [Classes and opaque types](#3-classes-and-opaque-types)
4. [Errors as schemas](#4-errors-as-schemas)
5. [Checks, refinements, brands](#5-checks-refinements-brands)
6. [Transformations and derived codecs](#6-transformations-and-derived-codecs)
7. [Running schemas: decode, encode, errors](#7-running-schemas-decode-encode-errors)
8. [Modeling guidance](#8-modeling-guidance)
9. [v3 → v4 rename table](#9-v3--v4-rename-table)

---

## 1. Mental model

A schema is a **codec** between two types plus the services each direction needs:

```
Codec<Type, Encoded = Type, DecodingServices = never, EncodingServices = never>
```

- **Type** is the in-memory, decoded value. **Encoded** is the wire or storage form. `decode` goes
  Encoded → Type and `encode` goes Type → Encoded. Every schema has both, and they are equal for
  plain schemas like `Schema.String`.
- Read the types with `typeof X.Type` / `typeof X.Encoded` (or `X["Type"]`). `Schema.Schema.Type<typeof X>`
  and `Schema.Codec.Encoded<typeof X>` also work.
- `Schema.Schema<T>` tracks **only** the decoded type. Its services are `unknown`, so you cannot
  decode with it. Annotate with `Schema.Codec<T, E>` when you need a decodable type, for example in
  recursive definitions or exported codecs. The three-parameter `Schema<A, I, R>` is v3.
- Generic helpers constrain on the lightweight structural types: `Schema.Constraint` (any schema),
  `Schema.ConstraintDecoder<T, RD>` (decode-only), `Schema.ConstraintEncoder<E, RE>`, and
  `Schema.Top` when the helper calls schema methods (`annotate`, `check`, `make`).
- Schemas are **functions at runtime** (`typeof Schema.String === "function"`). Test with
  `Schema.isSchema(x)`, never with `typeof`.
- Every schema has `.make(input)` (validating constructor), `.annotate(...)`, `.check(...)` and `.pipe(...)`.
  A `.check(...)` leaves the static schema type unchanged, so `.fields` and `.make` survive.

```ts
import { Effect, Schema } from "effect"

const User = Schema.Struct({
  id: Schema.Int,
  createdAt: Schema.DateTimeUtcFromString
})
type User = typeof User.Type // { readonly id: number; readonly createdAt: DateTime.Utc }
type UserJson = typeof User.Encoded // { readonly id: number; readonly createdAt: string }

// Generic boundary helper: decode-only constraint, so codecs with any Encoded type fit.
export const decodeOrNull = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const decode = Schema.decodeUnknownOption(schema)
  return (input: unknown): S["Type"] | null => {
    const o = decode(input)
    return o._tag === "Some" ? o.value : null
  }
}

export const parseUser = decodeOrNull(User)
export const program = Schema.decodeUnknownEffect(User)({ id: 1, createdAt: "2026-01-01T00:00:00Z" }).pipe(
  Effect.map((u: User) => u.id)
)
export type { UserJson }
```

Recursive schemas need an explicit `Schema.Codec` annotation on the self-reference. Use
`Schema.Codec<T, E>` when Type and Encoded differ:

```ts
import { Schema } from "effect"

interface Category {
  readonly name: string
  readonly children: ReadonlyArray<Category>
}

export const Category: Schema.Codec<Category> = Schema.Struct({
  name: Schema.String,
  children: Schema.Array(Schema.suspend((): Schema.Codec<Category> => Category))
})
```

---

## 2. Constructors

### Primitives and built-ins

| Schema | Type | Notes |
|---|---|---|
| `String`, `Boolean`, `Null`, `Undefined`, `Void`, `Unknown`, `Any`, `Never`, `ObjectKeyword`, `PropertyKey` | as named | |
| `Number` | `number` | **accepts `NaN` and ±Infinity**. Prefer `Finite` or `Int` for domain numbers. |
| `Finite`, `Int`, `Natural` | `number` | `Natural` = non-negative safe int (v3 `NonNegativeInt`) |
| `NonEmptyString`, `Trimmed`, `Char` | `string` | `Trim` is the trimming *codec* |
| `BigInt`, `Symbol`, `UniqueSymbol(sym)` | instance | v3 `*FromSelf` |
| `Date`, `URL`, `RegExp`, `Uint8Array`, `File`, `FormData`, `URLSearchParams` | **instance** | `Schema.Date` expects a `Date` object. For ISO strings use `DateFromString`. |
| `Duration`, `DateTimeUtc`, `DateTimeZoned`, `TimeZone`, `BigDecimal`, `Redacted(S)`, `Option(S)`, `Result(A, E)`, `Exit(...)`, `Cause(...)`, `Chunk(S)`, `HashMap(K, V)`, `HashSet(S)`, `ReadonlyMap(K, V)`, `ReadonlySet(S)` | Effect/JS **instances** | Type = Encoded = the instance. They are not JSON (see §8.6). |
| `NumberFromString` | string → number | lenient: `"a"` decodes to `NaN`. Use `FiniteFromString` for strict parsing. |
| `FiniteFromString`, `BigIntFromString`, `BigDecimalFromString`, `BooleanFromBit`, `URLFromString`, `TimeZoneFromString` | string → value | |
| `DateFromString`, `DateFromMillis` | string / number → `Date` | |
| `DateTimeUtcFromString`, `DateTimeUtcFromMillis`, `DateTimeUtcFromDate`, `DateTimeZonedFromString` | → `DateTime` | |
| `DurationFromMillis`, `DurationFromNanos`, `DurationFromString` | → `Duration` | |
| `RedactedFromValue(S)` | `S.Encoded` → `Redacted<S.Type>` | v3 `Schema.Redacted` |
| `StringFromBase64`, `StringFromBase64Url`, `StringFromHex`, `StringFromUriComponent`, `Uint8ArrayFromBase64`, `Uint8ArrayFromBase64Url`, `Uint8ArrayFromHex` | string codecs | |
| `fromJsonString(S)`, `fromJsonString(Schema.Unknown)`, `Json`, `JsonObject`, `JsonArray`, `MutableJson` | JSON | `UnknownFromJsonString` is `@internal` in 4.0.0 (absent from the `.d.ts`) despite the migration guide |
| `Enum(enumObject)` | TS enum | v3 `Enums` |
| `ErrorInstance()`, `Defect()` | **functions** | `Defect()` is the field schema for `cause: unknown` |
| `Headers`, `Cookie`, `Cookies`, `UrlParams`, `ByteSize*`, `Ipv4Address`, `MacAddress`, `SocketAddress`, … | | moved into `Schema` from http/net; unstable |

`Schema.Defect` and `Schema.ErrorInstance` without the call parentheses compile in some positions but
crash at construction (`Cannot read properties of undefined (reading 'encoding')`). Always call them:
`cause: Schema.Defect()`.

### Literals, unions, tuples, records

All variadic constructors from v3 now take **one array**:

```ts
import { Schema } from "effect"

export const One = Schema.Literal("admin") // exactly ONE literal
export const Role = Schema.Literals(["admin", "member", "guest"]) // several → Literals([...])
export const Admin = Role.pick(["admin"]) // v3 pickLiteral
export const IdOrName = Schema.Union([Schema.Int, Schema.NonEmptyString])
export const Exclusive = Schema.Union([Schema.Struct({ a: Schema.String }), Schema.Struct({ b: Schema.Int })], {
  mode: "oneOf" // exactly one member must match
})
export const Pair = Schema.Tuple([Schema.String, Schema.Int])
export const Scores = Schema.Record(Schema.String, Schema.Finite) // positional, not { key, value }
export const Version = Schema.TemplateLiteral(["v", Schema.Int, ".", Schema.Int])
export const VersionParts = Schema.TemplateLiteralParser(Version.parts) // decodes to ["v", n, ".", m]
export const Tags = Schema.NonEmptyArray(Schema.String)
export const ZeroToA = Schema.Literal(0).transform("a") // v3 transformLiteral
```

`Schema.Literal("a", "b")` is a TS2554 error, and the untyped call silently keeps only `"a"`. Union
members are tried in order and the first match wins (§6.5 shows why this can lose data on encode).

### Structs, optionality, derivation

| Field form | Type | Encoded | Accepts `{ k: undefined }`? |
|---|---|---|---|
| `S` | `k: T` | `k: E` | only if `S` does |
| `Schema.optionalKey(S)` | `k?: T` | `k?: E` | **no** (exact optional) |
| `Schema.optional(S)` | `k?: T \| undefined` | `k?: E \| undefined` | yes. It is `optionalKey(UndefinedOr(S))`. |
| `Schema.mutableKey(S)` | `k: T` (writable) | | |
| `Schema.NullOr(S)` / `UndefinedOr(S)` / `NullishOr(S)` | `T \| null` / … | | value-level, key stays required |

There is no `exactOptional`: `optionalKey` *is* the exact form. Under `exactOptionalPropertyTypes`
prefer `optionalKey`. Never pass an explicit `undefined` to an `optionalKey` field (both `make` and
decode reject it). Build objects with a conditional spread instead.

Option-valued fields:

| Helper | Encoded field | Type field |
|---|---|---|
| `OptionFromOptionalKey(S)` | `k?: E` | `k: Option<T>` |
| `OptionFromOptional(S)` | `k?: E \| undefined` | `k: Option<T>` |
| `OptionFromOptionalNullOr(S)` | `k?: E \| null \| undefined` | `k: Option<T>` |
| `OptionFromNullOr(S)` | `k: E \| null` | `k: Option<T>` (encodes `None` → `null`) |
| `OptionFromUndefinedOr(S)` / `OptionFromNullishOr(S)` | `k: E \| undefined` / `\| null \| undefined` | `k: Option<T>` |

Defaults. Every default is an **`Effect`**, not a thunk:

| API | Applies when | Default is a |
|---|---|---|
| `withConstructorDefault(Effect)` | `make`/`new` omits the key (or passes `undefined`) | `Type` value; the effect fails with `SchemaIssue.Issue` |
| `withDecodingDefault(Effect)` | decoding, key absent **or** `undefined` | **`Encoded`** value (`"1"` for `FiniteFromString`) |
| `withDecodingDefaultKey(Effect)` | decoding, key absent | `Encoded` value |
| `withDecodingDefaultType(Effect)` / `…TypeKey` | as above | `Type` value (v3 `optionalWith({ default })`) |

```ts
import { Effect, Schema, Struct } from "effect"

const Base = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  nickname: Schema.optionalKey(Schema.String),
  retries: Schema.Int.pipe(Schema.withDecodingDefaultType(Effect.succeed(3))),
  createdAt: Schema.Date.pipe(Schema.withConstructorDefault(Effect.sync(() => new Date())))
})

export const Created = Base.make({ id: 1, name: "a", retries: 0 }) // createdAt filled in
export const Public = Base.mapFields(Struct.pick(["id", "name"])) // v3 pick
export const NoId = Base.mapFields(Struct.omit(["id"])) // v3 omit
export const Patch = Base.mapFields(Struct.map(Schema.optionalKey)) // v3 partialWith({ exact: true })
export const WithEmail = Base.pipe(Schema.fieldsAssign({ email: Schema.String })) // v3 extend
export const WithEmail2 = Schema.Struct({ ...Base.fields, email: Schema.String }) // spread also works
export const Wire = Schema.Struct({ userId: Schema.Int, displayName: Schema.String }).pipe(
  Schema.encodeKeys({ userId: "user_id", displayName: "display_name" }) // snake_case on the wire only
)
export const Open = Schema.StructWithRest(Schema.Struct({ id: Schema.Int }), [
  Schema.Record(Schema.String, Schema.Unknown) // index signature; keeps extra keys
])
export const Evolved = Base.mapFields(Struct.evolve({ name: (f) => Schema.optionalKey(f) }))
```

`mapFields` drops the original struct's checks unless you pass `{ unsafePreserveChecks: true }`.
Other `Struct.*` field mappers: `mapPick`, `mapOmit`, `renameKeys`, `evolveKeys`, `evolveEntries`.
`Schema.extendTo(fields, derive)` adds decoded-only derived fields. `Schema.tagDefaultOmit("v")`
replaces v3 `attachPropertySignature`.

### Tagged structs and unions

```ts
import { Schema } from "effect"

// `_tag` discriminator
export const Shape = Schema.TaggedUnion({
  Circle: { radius: Schema.Finite },
  Square: { side: Schema.Finite }
})
export type Shape = typeof Shape.Type

export const c = Shape.cases.Circle.make({ radius: 1 }) // `_tag` filled by make
export const area = Shape.match({
  Circle: (s) => Math.PI * s.radius ** 2,
  Square: (s) => s.side ** 2
})
export const isRound = Shape.guards.Circle
export const isAny = Shape.isAnyOf(["Circle", "Square"])

// Foreign discriminator (`type`, `kind`, …): Schema.tag + toTaggedUnion
export const Block = Schema.Union([
  Schema.Struct({ type: Schema.tag("paragraph"), text: Schema.String }),
  Schema.Struct({ type: Schema.tag("image"), src: Schema.String })
]).pipe(Schema.toTaggedUnion("type"))
export const label = Block.matchOrElse({ paragraph: (p) => p.text }, () => "other")
export const BlockType = Schema.Literals(Block.discriminants) // toTaggedUnion only

export const One = Schema.TaggedStruct("Ping", { at: Schema.Int })
```

`Schema.tag("x")` supplies a **constructor** default only. Decoding still requires the tag on the
wire. Use `Schema.tagDefaultOmit` when the wire omits it. `toTaggedUnion` also works on unions of
classes and on schemas you do not own.

### Custom types

- `Schema.instanceOf(Ctor, annotations?)` wraps an `instanceof` guard.
- `Schema.declare((u): u is T => …, { expected: "T", toCodecJson: () => Schema.link<T>()(JsonSide, transformation) })`
  creates a non-parametric type. `Schema.declareConstructor` is the parametric form.
- `Schema.suspend(() => S)` defers a recursive reference.
- `Schema.Opaque<Self>()(Schema.Struct({...}))` gives a nominal type over a plain struct (see §3).

---

## 3. Classes and opaque types

```ts
import { Effect, Equal, Schema } from "effect"

export class User extends Schema.Class<User>("app/User")({
  id: Schema.Int,
  name: Schema.NonEmptyString,
  role: Schema.Literals(["admin", "member"]).pipe(Schema.withConstructorDefault(Effect.succeed("member" as const)))
}) {
  get isAdmin() {
    return this.role === "admin"
  }
}

export class Admin extends User.extend<Admin>("app/Admin")({ scopes: Schema.Array(Schema.String) }) {}

export class Tick extends Schema.TaggedClass<Tick>()("Tick", { at: Schema.Int }) {}

const u = User.make({ id: 1, name: "ada" }) // same as `new User({...})`; throws on invalid input
export const same = User.make(u) === u // true: make/makeOption/makeEffect return an existing instance unchanged
export const eq = Equal.equals(u, new User({ id: 1, name: "ada" })) // true: structural
export const maybe = User.makeOption({ id: 1.5, name: "x" }) // Option.none()
export const checked = User.makeEffect({ id: 1, name: "" }) // Effect<User, SchemaIssue.Issue>
```

- Shape: `Class<Self>("identifier")(fields | Struct, annotations?)` and
  `TaggedClass<Self>(identifier?)("Tag", fields, annotations?)`. For `TaggedClass` the tag doubles as
  the identifier. Forgetting `<Self>` produces a "Missing `Self` generic" type.
- Whole-object checks: pass a checked struct,
  `Schema.Class<X>("X")(Schema.Struct({...}).check(Schema.makeFilter(...)))`.
- Derive: `Base.extend<Sub>("Sub")({ newFields })` (pass `typeof Base` as the second generic to keep
  statics), `X.fields` to spread, and `X.mapFields(Struct.pick([...]))`, which returns a **Struct**,
  not a class.
- Reserved statics are `identifier`, `fields`, `ast`, `pipe`, `rebuild`, `make`, `makeOption`,
  `makeEffect`, `annotate`, `annotateKey`, `check`, `extend` and `mapFields`. Redefining one gives
  TS2417. Do not override the constructor. For a validating string parser, add a differently named
  static (`static fromString = …`).
- `make`, `new` and `makeEffect` share one validation path. `make`/`new` throw a plain `Error`
  ("Schema validation failed") with the `SchemaIssue.Issue` on `.cause`, not a `SchemaError`.
  `makeEffect` fails with the `Issue` itself. `MakeOptions { disableChecks }` skips `.check` filters
  only, and defaults still apply.
- Instances: `Equal.equals` compares them structurally. The class does not implement `Equal`/`Hash`
  itself; override **both** `Equal.symbol` and `Hash.symbol` for custom equality. Instances are not
  frozen. Plain literals passed to a class-typed field in `make` are promoted to instances, and
  `Schema.is(User)` is `false` for plain objects (`Schema.is` checks fields as well as the prototype).
- Branded classes: `Schema.Class<A, Brand.Brand<"A">>("A")({...})` makes structurally identical
  classes non-assignable.
- Foreign discriminator on a class: `Schema.Class<P>("P")({ type: Schema.tag("paragraph"), … })`.
  `TaggedClass` hardwires `_tag`.
- `Schema.Opaque<Self>()(struct)` produces a distinct TypeScript type whose runtime values stay plain
  objects. No methods and no `instanceof`, but `.fields`/`.make` remain and statics are allowed. Use
  it when you want Class-like hovers without a prototype.

---

## 4. Errors as schemas

```ts
import { Effect, Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"

export class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  { id: Schema.Int },
  { httpApiStatus: 404 } // annotation typed by effect/http-api's augmentation
) {
  override get message() {
    return `user ${this.id} not found`
  }
}

export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
  op: Schema.Literals(["read", "write"]),
  cause: Schema.Defect() // a call
}) {}

// No `_tag`: Schema.Error. For a custom discriminator, add a `kind: Schema.tag(...)` field.
export class SmtpError extends Schema.Error<SmtpError>("SmtpError")({ cause: Schema.Defect() }) {}

export const Conflict = Schema.Struct({ reason: Schema.String }).pipe(HttpApiSchema.status(409))

export const find = Effect.fn("find")(function* (id: number) {
  if (id < 0) return yield* new UserNotFound({ id })
  return { id }
})
```

- Signature: `TaggedError<Self>(identifier?)(tag, fields | Struct, annotations?)` and
  `Error<Self>(identifier)(fields | Struct, annotations?)`. Instances are yieldable,
  `instanceof Error`, and encodable (`{"_tag":"UserNotFound","id":1}`).
- `TaggedErrorClass`, `ErrorClass` and `TaggedRequest` do not exist in 4.0.0 (beta-era names; RPC
  requests are `Rpc.make`). The old instance schema `Schema.Error` is now `Schema.ErrorInstance()`.
- Without a `message` field or getter, `error.message` is `""`. Derive it with a getter.
- Nested reasons: `reason: Schema.Union([A, B])` inside a parent `TaggedError`. Choosing between
  `Schema.TaggedError` and `Data.TaggedError` is covered in `references/errors.md`.

---

## 5. Checks, refinements, brands

Filters are standalone values passed to `.check(...)` (or `Schema.check(...)` in a pipe). They do
**not** change the static type. Every factory takes optional `Annotations.Filter` as its last argument
(`{ expected, message, title, description, … }`).

| Domain | Filters |
|---|---|
| length (strings, arrays, anything with `.length`) | `isMinLength(n)`, `isMaxLength(n)`, `isBetweenLength(min, max)`, `isNonEmpty()` (UTF-16 code units) |
| code points | `isMinCodePoints`, `isMaxCodePoints`, `isBetweenCodePoints` (an emoji is 2 units but 1 code point) |
| string content | `isPattern(re)`, `isStartingWith(s)`, `isEndingWith(s)`, `isIncluding(s)`, `isTrimmed()`, `isLowercased()`, `isUppercased()`, `isCapitalized()`, `isUncapitalized()` |
| string formats | `isUUID(version?)`, `isGUID()`, `isULID()`, `isBase64()`, `isBase64Url()`, `isStringFinite()`, `isStringBigInt()`, `isStringSymbol()` |
| number | `isGreaterThan`, `isGreaterThanOrEqualTo`, `isLessThan`, `isLessThanOrEqualTo`, `isBetween({ minimum, maximum, exclusiveMinimum?, exclusiveMaximum? })`, `isMultipleOf`, `isInt()`, `isInt32()`, `isUint32()`, `isFinite()` |
| bigint / BigDecimal / Date | `isGreaterThanBigInt` … `isBetweenBigInt`, `…BigDecimal`, `…Date` variants |
| size / properties | `isMinSize`, `isMaxSize`, `isBetweenSize` (Map/Set), `isMinProperties`, `isMaxProperties`, `isBetweenProperties`, `isPropertyNames(S)` |
| arrays | `isUnique()`, `isUniqueKey(f)` |
| custom | `makeFilter(pred, annotations?, abort?)`, `makeFilterGroup([...], annotations)`, `refine(guard)`, factories `makeIsGreaterThan(order)` etc. |

rc.118 renames: `isLengthBetween` → `isBetweenLength`, `isSizeBetween` → `isBetweenSize`,
`isPropertiesLengthBetween` → `isBetweenProperties`, `isStartsWith` → `isStartingWith`,
`isEndsWith` → `isEndingWith`, `isIncludes` → `isIncluding`. `positive`, `negative`, `nonNegative`
and `nonPositive` are removed. Use `isGreaterThan(0)` etc., or `Schema.Natural`.

```ts
import { Schema } from "effect"

export const Slug = Schema.String.check(
  Schema.isBetweenLength(1, 64),
  Schema.isPattern(/^[a-z0-9-]+$/u, { expected: "a lowercase slug" })
)
export const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))
export const Even = Schema.Int.check(Schema.makeFilter((n) => n % 2 === 0, { expected: "an even integer" }))

// Cross-field check: return { path, issue } to point at the failing key.
export const Signup = Schema.Struct({ password: Schema.String, confirm: Schema.String }).check(
  Schema.makeFilter((o) => (o.password === o.confirm ? undefined : { path: ["confirm"], issue: "passwords differ" }))
)

// Refinement narrows the type.
export const AtLeastTwo = Schema.Array(Schema.String).pipe(
  Schema.refine((a): a is readonly [string, string, ...Array<string>] => a.length >= 2)
)
```

`makeFilter` predicate return protocol (`Schema.FilterOutput`): `true`/`undefined` pass. `false` fails
generically. A `string` fails with that message. A `SchemaIssue.Issue` is passed through. `{ path, issue }`
attaches the failure to a nested path. An array of those reports several failures (empty = pass).

Messages: when the base type matches but a filter fails, the default formatter uses the filter's
`message`, then `expected` ("Expected …"), then `<filter>`. **`title` is not used**, and an
`identifier` annotation only labels type-level failures.

`isPattern` is only exported to JSON Schema when the regex flags match `/^[dg]*uy?$/`, so always add `u`
and avoid `i`/`m`/`v`. Without it, the `pattern` keyword silently disappears from generated JSON Schema
and OpenAPI. Avoid lookarounds and backreferences if you generate Arbitraries.

Order: structural filters (lengths, sizes) run only after nested values parse. `.abort()` on a filter
stops later filters even with `errors: "all"`. Filters must be synchronous. Effectful validation
belongs in a transformation via `SchemaGetter.checkEffect`.

### Brands

```ts
import { Brand, Schema } from "effect"

// A brand is TYPE-ONLY. It enforces nothing at runtime, so pair it with real checks.
export const UserId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type // string & Brand<"UserId">

export const id: UserId = UserId.make("0f8fad5b-d9cb-469f-a165-70867728950e") // validates, then brands

// Reuse a Brand.Constructor's checks (one concrete key per call):
type PosInt = number & Brand.Brand<"PosInt">
const PosInt = Brand.check<PosInt>(Schema.isInt(), Schema.isGreaterThan(0))
export const Qty = Schema.Number.pipe(Schema.fromBrand("PosInt", PosInt))
```

- `brand` takes exactly **one** literal identifier. Apply it twice for two brands. Brands are not
  stored in the AST and do not survive `SchemaRepresentation` / code generation.
- `Schema.String.pipe(Schema.brand("UserId"))` happily decodes `""`. A bare brand is a label, not
  validation.
- `make` on a branded schema accepts the unbranded input. Inside a struct, the field expects an
  already branded value.

---

## 6. Transformations and derived codecs

### 6.1 decodeTo / decode and SchemaTransformation

v3 `transform(from, to, {...})` becomes `from.pipe(Schema.decodeTo(to, transformation))`. The
transformation decodes `from.Type` into `to.Encoded`, and then `to` decodes the rest (its checks run).

```ts
import { Effect, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect"

// Infallible: SchemaTransformation.transform
export const Cents = Schema.Finite.pipe(
  Schema.decodeTo(
    Schema.Int,
    SchemaTransformation.transform({ decode: (dollars) => Math.round(dollars * 100), encode: (c) => c / 100 })
  )
)

// Fallible / async / service-using: transformEffect, failing with a SchemaIssue
export const UrlFromString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.instanceOf(URL),
    SchemaTransformation.transformEffect({
      decode: (s, options) =>
        Effect.try({
          try: () => new URL(s),
          catch: () => new SchemaIssue.InvalidValue({ message: "invalid URL" }, s, options)
        }),
      encode: (url) => Effect.succeed(url.href)
    })
  )
)

// Getter-pair spelling: each direction is a SchemaGetter
export const CsvList = Schema.String.pipe(
  Schema.decodeTo(Schema.Array(Schema.String), {
    decode: SchemaGetter.transform((s: string) => (s === "" ? [] : s.split(","))),
    encode: SchemaGetter.transform((xs: ReadonlyArray<string>) => xs.join(","))
  })
)

// Same-type transformation: Schema.decode (or Schema.encode)
export const Normalized = Schema.String.pipe(
  Schema.decode(
    SchemaTransformation.composeTransformation(SchemaTransformation.trim(), SchemaTransformation.toLowerCase())
  )
)

// Composition without a transformation chains codecs (v3 compose)
export const KmFromString = Schema.FiniteFromString.pipe(Schema.decodeTo(Schema.Finite.check(Schema.isGreaterThan(0))))
```

- `SchemaTransformation`: `transform`, `transformEffect` (v3 `transformOrFail`; renamed in rc.113),
  `transformOptional` (full `Option` control over missing keys), `makeTransformation(decode, encode)`
  (v3 `make`), `composeTransformation`, `passthrough`, `passthroughSubtype`, `passthroughSupertype`,
  and built-ins (`trim`, `toLowerCase`, `numberFromString`, `dateFromString`, `durationFromMillis`,
  `optionFromNullOr`, `snakeToCamel`, `fromJsonString`, …).
- `SchemaGetter` is one direction: `transform`, `transformEffect`, `transformOptional`,
  `transformOptionalEffect`, `passthrough`, `required`, `withDefault`, `omit`, `forbidden`,
  `checkEffect` (async validation), `parseJson`, `stringifyJson`, `String()`, `Number()`, `map`,
  `compose`, `run`. `onSome`/`onNone` and `new Getter` are gone (rc.116 made `Getter` a tagged union).
- Fail with `SchemaIssue.InvalidValue(annotations?, input?, options?)`. Annotations come first. Pass
  the callback's `input` and `options` so `reportInput` works.
- `Schema.encodeTo(from, transformation)` is the mirror. `Schema.flip(S)` swaps the sides.
  `Schema.catchDecoding(...)` replaces v3's `decodingFallback`.
- Bare `Schema.decode` / `Schema.encode` are **transformation combinators**, not runners. The
  runners are `decodeEffect`/`encodeEffect` (§7).

### 6.2 Class targets revalidate

`decodeTo(SomeClass, t)` runs the class's field checks on the transformed value and produces a fresh
instance. `decodeTo(Schema.instanceOf(SomeClass), t)` keeps whatever instance `t` returns but skips
the field validation.

### 6.3 JSON: fromJsonString and toCodecJson

```ts
import { Schema } from "effect"

export class Event extends Schema.Class<Event>("Event")({
  at: Schema.DateTimeUtc, // domain type, not JSON
  timeout: Schema.Duration,
  tags: Schema.ReadonlySet(Schema.String)
}) {
  static readonly Json = Schema.toCodecJson(this) // derived Event <-> JSON-safe value
  static readonly FromJsonString = Schema.fromJsonString(Schema.toCodecJson(this)) // Event <-> string
}

export const parse = Schema.decodeUnknownEffect(Event.FromJsonString)
export const anyJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))('{"a":1}')
```

- `fromJsonString(S)` = `JSON.parse` + decode with `S` (v3 `parseJson(S)`). v3 `parseJson()` is
  `fromJsonString(Schema.Unknown)`. The migration guide names `UnknownFromJsonString`, but it is
  `@internal` and missing from the 4.0.0 typings. Use them instead of `JSON.parse` inside `Effect.try`.
- `toCodecJson(S)` walks the AST and swaps every non-JSON node for its canonical JSON form: `Date`
  and `DateTimeUtc` become ISO strings, `Duration` becomes a tagged object, `Option` becomes
  `{_tag, value}`, Maps and Sets become arrays, and bigint becomes a string. You keep domain types in
  the model and derive the wire codec. Custom `declare`/`instanceOf` types need a `toCodecJson`
  annotation (`Schema.link<T>()(jsonSide, transformation)`), or encoding fails with
  "Expected JSON value".
- `toCodecJson` encodes `Schema.Redacted` as the **plaintext** value. Keep secrets out of
  JSON-derived codecs, or give them an explicit encoding.
- Siblings: `toCodecStringTree` (all leaves as strings, for form and query data), `toCodecIso`,
  `toEncoderXml`, `fromFormData(S)`, `fromURLSearchParams(S)`, `toCodecArrayFromSingle`.

### 6.4 Other derivations

| Need | API |
|---|---|
| Standard Schema v1 adapter (tRPC/oRPC/forms) | `Schema.toStandardSchemaV1(S, { leafHook?, checkHook?, parseOptions? })` |
| Standard JSON Schema v1 | `Schema.toStandardJSONSchemaV1(S)` |
| JSON Schema document | `Schema.toJsonSchemaDocument(S, options?)` → `{ dialect: "draft-2020-12", schema, definitions }`. Best effort: a valid JSON Schema result does not guarantee decode succeeds. |
| Equivalence | `Schema.toEquivalence(S)` (`overrideToEquivalence` annotation) |
| Type guard / assertion | `Schema.is(S)(u)`, `Schema.asserts(S, u)` (two arguments in v4) |
| Encoded / Type side as a schema | `Schema.toEncoded(S)`, `Schema.toType(S)` (v3 `encodedSchema`/`typeSchema`). Validate without transforming: `decodeSync(toType(S))`. |
| Pretty printer | `Schema.toFormatter(S)` (v3 `pretty`) |
| Property-test generator | `Arbitrary.schema(S)`, then `Arbitrary.sampleEffect(arb, { count, seed })` (native, no fast-check) |
| Optics / JSON patch | `Schema.toIso*`, `Schema.toDifferJsonPatch(S)` |
| Representation / codegen | `SchemaRepresentation.toRepresentation(ast)` → `toMultiDocument` → `toCodeDocument` (v3 `format`) |

### 6.5 Lossy unions

On encode, a union picks the first member whose **Type** matches. In
`Schema.Union([Schema.Number, Schema.FiniteFromString])` both members have Type `number`, so `"1"`
decodes to `1` and re-encodes as `1`, not `"1"`. Keep member Types distinguishable (tag them), or
track the wire form separately.

---

## 7. Running schemas: decode, encode, errors

Hoist runners to module scope. Each runner call compiles a parser.

| Family | Input | Result | Use |
|---|---|---|---|
| `decodeUnknownEffect(S)` | `unknown` | `Effect<T, SchemaError, RD>` | default at boundaries; handles async transforms and services |
| `decodeEffect(S)` | `S.Encoded` | same | typed input |
| `decodeUnknownExit` / `decodeExit` | | `Exit<T, SchemaError>` | sync, inspectable (v3 `decodeUnknownEither`) |
| `decodeUnknownResult` / `decodeResult` | | `Result<T, SchemaError>` | sync, pure branching |
| `decodeUnknownOption` / `decodeOption` | | `Option<T>` | sync, details discarded |
| `decodeUnknownSync` / `decodeSync` | | `T`, throws `SchemaError` | scripts, tests, startup only |
| `decodeUnknownPromise` / `decodePromise` | | `Promise<T>` | non-Effect callers |
| `encode*` | same matrix | `Encoded` | `encodeUnknownEffect`, `encodeEffect`, `encodeExit`, `encodeSync`, … |

- Sync, Exit, Result and Option runners cannot run async transformations or services. Use the Effect
  runner for those.
- `SchemaParser.*` has the same functions but fails with the raw `SchemaIssue.Issue` instead of
  `SchemaError`, plus `make`/`makeOption`/`makeEffect`.

Parse options (second argument of the runner factory or of the returned function):

| Option | Values | Default |
|---|---|---|
| `errors` | `"first"` \| `"all"` | `"first"` |
| `onExcessProperty` | `"ignore"` (strip) \| `"error"` | `"ignore"`. There is no `"preserve"`. To keep extras, model them with `Record`/`StructWithRest`, which also disables excess checking for that struct. |
| `disableChecks` | boolean | skips `.check` filters only; defaults and transforms still run |
| `concurrency` | `Effect.forEach` semantics | sequential; applies to product children, not union members |
| `reportInput` | boolean | `false`. Retains rejected inputs in issues and messages, which can leak secrets and PII. |

`parseOptions` **annotations** no longer affect parsing, so pass options at the call site. Decode
human-authored config strictly: `{ onExcessProperty: "error", errors: "all" }`.

### Errors and formatting

```ts
import { Data, Effect, Schema, SchemaIssue } from "effect"

const Config = Schema.Struct({ port: Schema.Int, host: Schema.NonEmptyString })
const decodeConfig = Schema.decodeUnknownEffect(Config)
const toIssues = SchemaIssue.makeFormatterStandardSchemaV1()

export class InvalidConfig extends Data.TaggedError("InvalidConfig")<{
  readonly issues: ReturnType<typeof toIssues>["issues"] // ReadonlyArray<{ path?, message }>
}> {}

// Map SchemaError to a domain error at the boundary; don't leak SchemaError into service signatures.
export const loadConfig = (raw: unknown) =>
  decodeConfig(raw, { errors: "all", onExcessProperty: "error" }).pipe(
    Effect.catchTag("SchemaError", (e) => Effect.fail(new InvalidConfig({ issues: toIssues(e.issue).issues })))
  )

export const pretty = (e: Schema.SchemaError) => SchemaIssue.makeFormatterDefault()(e.issue) // same text as e.message
```

- `Schema.SchemaError` is a yieldable error (`_tag: "SchemaError"`) wrapping `.issue: SchemaIssue.Issue`.
  Narrow unknowns with `Schema.isSchemaError`, and issues with `SchemaIssue.isIssue`.
- Issue tree: `InvalidType`, `InvalidValue`, `MissingKey`, `UnexpectedKey`, `Forbidden`, `OneOf`
  (leaves), and `Filter`, `Encoding`, `Pointer`, `Composite`, `AnyOf` (composites).
- Formatters: `makeFormatterDefault()` returns a string. `makeFormatterStandardSchemaV1({ leafHook?, checkHook? })`
  returns `{ issues: [{ path, message }] }` (the v3 `ArrayFormatter` equivalent). Customize per schema
  with the `message`, `messageMissingKey` and `messageUnexpectedKey` annotations (`Schema.annotateKey`
  for keys).
- `X.make` failures are a plain `Error` with the issue on `.cause`. `makeEffect` fails with an
  `Issue`. Only parser runners produce `SchemaError`.

### Compilers (opt-in, unstable)

`import "effect/schema/SchemaJITCompiler/enable"` once at startup turns on JIT parsers globally (the
interpreter remains the fallback). `SchemaJITCompiler.enable(ast)` scopes it to one AST.
`SchemaAOTCompiler.compile([...])` and `effect/schema/SchemaAOTCompiler/Build` generate modules that
work where `new Function` is forbidden. Regenerate them whenever schemas or the Effect version
change.

---

## 8. Modeling guidance

### 8.1 Struct or Class

| Value | Use |
|---|---|
| Plain data: DTOs, config, rows, events, payloads | `Schema.Struct` + `type X = typeof X.Type` |
| Needs methods or getters, `instanceof`, a nominal identity, or is an `Equal`/`Hash` key you customize | `Schema.Class` / `TaggedClass` |
| Nominal type, but plain runtime objects | `Schema.Opaque` |
| Error crossing a wire or journal, or needing encode | `Schema.TaggedError` (see `references/errors.md`) |
| Internal state machine or control-flow algebra, never decoded | `Data.TaggedEnum` + `Data.taggedEnum<T>()` (`$is` and `$match` check `_tag` only, so they are not validators) |
| Persisted/wire sum type | `Schema.TaggedUnion`, or `Union([...]).pipe(toTaggedUnion("kind"))` |

The schema is the single source of truth, so don't hand-write a parallel `interface` that can drift.
One accepted variant (Kit Langton's convention) adds a same-name interface **derived** from the
schema purely for nicer hovers and error messages:

```ts
import { Schema } from "effect"

export const Order = Schema.Struct({ id: Schema.String, total: Schema.Int })
export interface Order extends Schema.Schema.Type<typeof Order> {}
```

### 8.2 Branded IDs with real checks

Brand every scalar ID, but attach the check that makes the brand true (`isUUID()`, `isULID()`,
`isPattern(/^usr_[a-z0-9]{12}$/u)`, `isGreaterThan(0)`). Export `type XId = typeof XId.Type`. Mint
IDs with `XId.make(...)` and accept them through decode. Never cast with `as XId`.

### 8.3 Sum types instead of `status` + optionals

A `status` literal with fields that "only apply when status is X" is a hidden sum type:

```ts nocheck
// smell: every consumer re-checks status before touching `shippedAt`/`reason`
const Order = Schema.Struct({
  status: Schema.Literals(["pending", "shipped", "cancelled"]),
  shippedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  reason: Schema.optionalKey(Schema.String)
})
```

```ts
import { Schema } from "effect"

export const Order = Schema.TaggedUnion({
  Pending: { id: Schema.String },
  Shipped: { id: Schema.String, shippedAt: Schema.DateTimeUtcFromString },
  Cancelled: { id: Schema.String, reason: Schema.NonEmptyString }
})
export type Order = typeof Order.Type
export const describe = Order.match({
  Pending: (o) => `${o.id} pending`,
  Shipped: (o) => `${o.id} shipped`,
  Cancelled: (o) => `${o.id}: ${o.reason}`
})
```

Use `TaggedClass` variants instead of `TaggedUnion` when the variants need methods. Union them
with `Schema.Union([A, B])` and the `toTaggedUnion("_tag")` helpers still apply.

### 8.4 COLD / WARM / view

For an entity, split what never changes from what moves and from what you compute:

- **COLD**: identity and creation parameters (id, owner, createdAt). Immutable and safe as cache keys.
- **WARM**: the mutable state (status variant, counters, updatedAt). The only part a write touches.
- **View**: the resolved read model (`COLD & WARM & derived`), built by a function, not stored.

```ts
import { Schema } from "effect"

export const TaskId = Schema.String.check(Schema.isULID()).pipe(Schema.brand("TaskId"))
export const TaskCold = Schema.Struct({ id: TaskId, title: Schema.NonEmptyString, createdAt: Schema.DateTimeUtcFromString })
export const TaskWarm = Schema.TaggedUnion({
  Open: {},
  Done: { doneAt: Schema.DateTimeUtcFromString }
})
export const TaskView = Schema.Struct({ ...TaskCold.fields, state: TaskWarm, isDone: Schema.Boolean })
export type TaskView = typeof TaskView.Type
```

### 8.5 SQL and API models: `Model.Class`

`import { Model } from "effect/schema"` (unstable). One field declaration derives the variants
`select` (the class itself), `insert`, `update`, `json`, `jsonCreate` and `jsonUpdate`, with
`Model.FieldExcept([...])`, `Model.FieldOnly([...])`, `Model.Field({ select, json, … })`,
`Model.Generated*`, `Model.DateTimeInsert`/`DateTimeUpdate`, `Model.UuidV4Insert(Id)`,
`Model.Sensitive` and `Model.JsonFromString`. Pair it with `SqlModel.makeRepository` and `SqlSchema.*`
(`references/platform.md`). `VariantSchema` is the general machinery behind it.

```ts
import { Schema } from "effect"
import { Model } from "effect/schema"

export const GroupId = Schema.String.pipe(Schema.brand("GroupId"))
export class Group extends Model.Class<Group>("Group")({
  id: Model.UuidV4Insert(GroupId),
  name: Schema.NonEmptyString,
  notes: Schema.NullOr(Schema.String).pipe(Model.FieldOnly(["select", "insert"])),
  createdAt: Model.DateTimeInsert,
  updatedAt: Model.DateTimeUpdate
}) {}
export const CreateBody = Group.jsonCreate
```

### 8.6 Boundary rules

- **JSON boundary.** `Duration`, `DateTimeUtc`, `Date`, `Option`, `Redacted`, Maps, Sets and bigint are
  instance schemas. A plain `encode` returns the instance, and `JSON.stringify` of it will not decode
  back. At the boundary, either use the `From*` codecs in the wire schema (`DurationFromMillis`,
  `DateTimeUtcFromString`, `OptionFromNullOr`, `BigIntFromString`) or keep domain types and encode
  through `Schema.toCodecJson(S)`.
- **Standard Schema output trap.** `toStandardSchemaV1(S)["~standard"].validate` runs **decode**. If a
  framework validates a handler's *return value* (oRPC `.output`, some form libraries), it decodes a
  value you already decoded, so `BigIntFromString` rejects a bigint (`Expected string`). Output
  schemas must accept the Type side: use `Schema.toType(S)` or instance schemas (`Schema.BigInt`).
  zod-only consumers (`zodResolver`) don't accept Standard Schema at all.
- **Decoded records are prototype-backed objects.** `rec["constructor"]` on a decoded
  `Record(String, X)` returns `Object.prototype.constructor`, typed as `X`. Read untrusted keys with
  `Object.hasOwn(rec, k)`.
- **Strictness.** Struct decode strips unknown keys by default. Opt into
  `onExcessProperty: "error"` for human-authored input.
- **Numbers.** `Schema.Number` admits `NaN`/`Infinity` and `NumberFromString` turns `"abc"` into
  `NaN`. Use `Finite`, `Int` or `FiniteFromString`.
- **No `Schema` suffix** on schema constants (`User`, not `UserSchema`). The const and its type share
  the name.
- **Decode at the edge, once.** Inside the domain, values are already `Type`. Don't re-validate with
  predicates or `JSON.parse` + casts. Hoist `Schema.decodeUnknown*` calls to module scope.

---

## 9. v3 → v4 rename table

| v3 | v4 |
|---|---|
| `Schema.Schema<A, I, R>` | `Schema.Codec<A, I, RD, RE>`. `Schema.Schema<A>` is decoded-only. |
| `Schema.Date` (ISO string → Date) | `Schema.DateFromString`. v4 `Schema.Date` is the instance (v3 `DateFromSelf`): **it still type-checks but stops accepting strings.** |
| `DateFromSelf`, `DurationFromSelf`, `OptionFromSelf`, `BigIntFromSelf`, `SymbolFromSelf`, `URLFromSelf`, `ChunkFromSelf`, `ReadonlyMapFromSelf`, `ReadonlySetFromSelf`, `HashMapFromSelf`, `HashSetFromSelf`, `BigDecimalFromSelf`, `CauseFromSelf`, `ExitFromSelf`, `RegExpFromSelf`, `Uint8ArrayFromSelf`, `DateTimeUtcFromSelf` | drop `FromSelf` (`Date`, `Duration`, `Option`, …) |
| `Schema.Duration` (encoded form) | `DurationFromString` / `DurationFromMillis` / `toCodecJson(Duration)` |
| `Schema.DateTimeUtc` (string) | `DateTimeUtcFromString` |
| `Schema.Option(S)` (tagged JSON) | `toCodecJson(Schema.Option(S))`, or `OptionFromNullOr` etc. |
| `Schema.Redacted(S)` / `RedactedFromSelf` | `RedactedFromValue(S)` / `Redacted(S)` |
| `Either`, `EitherFromSelf`, `EitherFromUnion` | `Result(success, failure)` |
| `DateFromNumber` | `DateFromMillis` |
| `Literal("a", "b")` / `Literal(null)` / `pickLiteral` | `Literals(["a", "b"])` / `Null` / `Literals([...]).pick([...])` |
| `Union(A, B)`, `Tuple(A, B)`, `TemplateLiteral(A, B)` | array argument: `Union([A, B])` … |
| `Record({ key, value })` | `Record(key, value)` |
| `Enums(E)` | `Enum(E)` |
| `parseJson()` / `parseJson(S)` | `fromJsonString(Schema.Unknown)` / `fromJsonString(S)` (`UnknownFromJsonString` is internal in 4.0.0) |
| `filter(pred)` / `filter(refinement)` | `.check(Schema.makeFilter(pred))` / `Schema.refine(guard)` |
| `filterEffect` | `decode({ decode: SchemaGetter.checkEffect(...), encode: passthrough() })` |
| `pattern`, `minLength`, `maxLength`, `length`, `between`, `greaterThan`, `int`, `multipleOf`, `nonEmptyString`, `startsWith`, `endsWith`, `includes` | `isPattern`, `isMinLength`, `isMaxLength`, `isBetweenLength`, `isBetween({minimum, maximum})`, `isGreaterThan`, `isInt`, `isMultipleOf`, `isNonEmpty`, `isStartingWith`, `isEndingWith`, `isIncluding` |
| `positive`/`Positive`, `nonNegative`/`NonNegative`, `NonNegativeInt`, `Negative`, `NonPositive` | `isGreaterThan(0)`, `isGreaterThanOrEqualTo(0)`, `Schema.Natural`, `isLessThan(0)`, `isLessThanOrEqualTo(0)` |
| `UUID`, `ULID` | `String.check(isUUID())`, `String.check(isULID())` |
| `Lowercased`, `NonEmptyTrimmedString`, `Uint8` | `String.check(isLowercased())`, `Trimmed.check(isNonEmpty())`, `Int.check(isBetween({ minimum: 0, maximum: 255 }))` |
| `transform(from, to, { decode, encode })` | `from.pipe(decodeTo(to, SchemaTransformation.transform({ decode, encode })))` |
| `transformOrFail(...)` | `decodeTo(to, SchemaTransformation.transformEffect({...}))`, failing with `SchemaIssue.InvalidValue` |
| `transformLiteral(a, b)` / `transformLiterals(...)` | `Literal(a).transform(b)` / `Literals([...]).transform([...])` |
| `compose(B)` | `decodeTo(B)` |
| `split(",")` | `decodeTo(Array(String), transform(...))` |
| `extend(A, B)` | `A.pipe(fieldsAssign(B.fields))`, `A.mapFields(Struct.assign(B.fields))`, or a `{ ...A.fields, ...B.fields }` spread |
| `pick` / `omit` / `partial` / `partialWith({ exact })` / `required` | `mapFields(Struct.pick([...]))` / `Struct.omit` / `Struct.map(optional)` / `Struct.map(optionalKey)` / `Struct.map(requiredKey)` |
| `optionalWith(S, { exact })` / `{ default }` / `{ exact, default }` / `{ nullable }` | `optionalKey(S)` / `S.pipe(withDecodingDefaultType(Effect.succeed(v)))` / `withDecodingDefaultTypeKey` / `optional(NullOr(S))` + `decodeTo` + `Option.filter(Predicate.isNotNull)` |
| `optionalToOptional`, `optionalToRequired`, `requiredToOptional` | `decodeTo` with `SchemaGetter.transformOptional` |
| `attachPropertySignature("k", "v")` | `mapFields((f) => ({ ...f, k: tagDefaultOmit("v") }))` |
| `rename({ a: "b" })`, `fromKey` | `encodeKeys({ a: "b" })` |
| `annotations({...})` | `annotate({...})` (`annotateKey` for keys) |
| `asSchema`, `typeSchema`, `encodedSchema` | `revealCodec`, `toType`, `toEncoded` |
| `validate*` | `decode*(Schema.toType(S))` |
| `decodingFallback` annotation | `catchDecoding(...)` |
| `Data(S)` | removed. `Equal.equals` is structural on plain objects by default. |
| `TaggedRequest` | `Rpc.make` (`effect/rpc`) |
| `TaggedErrorClass`, `ErrorClass` (beta) | `TaggedError<Self>()(tag, fields)`, `Error<Self>(id)(fields)` |
| `Schema.Error` instance schema | `ErrorInstance()` |
| `NonEmptyArrayEnsure`, `keyof`, `withDefaults`, `ReadonlyMapFromRecord` | removed (rebuild with `decodeTo`) |
| `decodeUnknown`, `decode`, `encodeUnknown`, `encode` (runners) | `decodeUnknownEffect`, `decodeEffect`, `encodeUnknownEffect`, `encodeEffect` |
| `decodeUnknownEither`, `decodeEither`, `encodeEither` | `decodeUnknownExit` / `decodeExit` / `encodeExit` (or `…Result`) |
| `asserts(S)(u)` | `asserts(S, u)` |
| `ParseError`, `ParseResult.*` | `Schema.SchemaError` (`.issue`), `SchemaIssue.*`, `SchemaParser.*` |
| `ParseResult.ArrayFormatter.formatError(e)` / `TreeFormatter` | `SchemaIssue.makeFormatterStandardSchemaV1()(e.issue).issues` / `makeFormatterDefault()(e.issue)` |
| `onExcessProperty: "preserve"`, `propertyOrder`, `parseOptions` annotation | removed. Use `Record`/`StructWithRest` for extras and pass options at the call. |
| `disableValidation` (make option) | `disableChecks` |
| `equivalence`, `pretty`, `format`, `standardSchemaV1` | `toEquivalence`, `toFormatter`, `SchemaRepresentation.toCodeDocument`, `toStandardSchemaV1` |
| `JSONSchema.make(S)` | `Schema.toJsonSchemaDocument(S)` |
| `Arbitrary.make(S)` + fast-check, `Schema.toArbitrary` (beta) | `Arbitrary.schema(S)` from `effect/Arbitrary` (native, no fast-check) |
| `SchemaTransformation.make`, `.compose`, `SchemaGetter.transformOrFail` (beta/rc) | `makeTransformation`, `composeTransformation`, `transformEffect` |
| `isLengthBetween`, `isStartsWith`, `isEndsWith`, `isIncludes`, `isSizeBetween` (rc ≤ 117) | `isBetweenLength`, `isStartingWith`, `isEndingWith`, `isIncluding`, `isBetweenSize` |
| `brand("A", "B")` / brand stored in AST | one id per call, type-only. `fromBrand(id, ctor)` keeps runtime checks. |

For non-Schema renames see `references/migration.md`. For the API inventory see `references/v4-catalog.md`.
