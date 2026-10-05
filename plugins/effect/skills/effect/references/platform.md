# Platform subsystems (effect 4.0.0)

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

How to use the platform half of Effect correctly: canonical shapes that typecheck, then the traps.
Every sub-barrel here (`effect/http`, `effect/http-api`, `effect/rpc`, `effect/sql`, `effect/cli`,
`effect/process`, `effect/ai`, `effect/cluster`, `effect/workflow`, `effect/persistence`,
`effect/reactivity`, `effect/observability`, `effect/socket`, `effect/encoding`, `effect/workers`) is
`@stability unstable`: it can break in a minor release. There is no `effect/unstable/*` path any more,
and `@effect/platform`, `@effect/rpc`, `@effect/sql`, `@effect/cli`, `@effect/ai` are v3-era packages —
never install them next to `effect@4`. Runtime packages (`@effect/platform-node|bun|browser|deno`,
`@effect/sql-*`, `@effect/ai-*`) must be the same `4.0.0` as `effect`.

Module lists live in `references/modules.md` (import table in `references/v4-catalog.md`); service/layer design in `references/architecture.md`;
error-model background (reason unions, `catchReason`) in `references/errors.md`; test harnesses in
`references/testing.md`.

## Contents

1. [Platform services and runtimes](#1-platform-services-and-runtimes)
2. [HTTP client](#2-http-client-effecthttp)
3. [HTTP server](#3-http-server-effecthttp)
4. [HttpApi](#4-httpapi-effecthttp-api)
5. [RPC](#5-rpc-effectrpc)
6. [SQL](#6-sql-effectsql--drivers)
7. [CLI](#7-cli-effectcli)
8. [Child processes](#8-child-processes-effectprocess)
9. [AI](#9-ai-effectai--providers)
10. [MCP server](#10-mcp-server-effectai-mcpserver)
11. [Persistence](#11-persistence-effectpersistence)
12. [Cluster and Workflow](#12-cluster-and-workflow)
13. [Reactivity / Atom](#13-reactivity-effectreactivity)
14. [Observability](#14-observability)
15. [Encoding, sockets, workers](#15-encoding-sockets-workers)

The platform error house style, everywhere below: one wrapper error with a `reason` union
(`HttpClientError`, `HttpServerError`, `SqlError`, `PlatformError`, `SocketError`, `AiError`,
`RpcClientError`, `MultipartError`, `RateLimiterError`). Match on `error.reason._tag`, recover with
`Effect.catchReason(tag, reasonTag, f)` / `Effect.catchReasons(tag, { … })` / `Effect.unwrapReason(tag)`.

---

## 1. Platform services and runtimes

**Imports:** `import { Crypto, FileSystem, Path, Stdio, Terminal } from "effect"` (contracts live in core); `import { NodeRuntime, NodeServices } from "@effect/platform-node"` (or `BunRuntime`, `BunServices` from `@effect/platform-bun`)

The contracts (`FileSystem`, `Path`, `Stdio`, `Terminal`, `Crypto`, `ChildProcessSpawner`) are in
core; the platform package only implements them. `NodeServices.layer` / `BunServices.layer` provide
exactly `ChildProcessSpawner | Crypto | FileSystem | Path | Stdio | Terminal` (no HTTP, no Redis, no
workers). Libraries require the contracts in `R`; only the app entry point provides `NodeServices.layer`.

```ts
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Context, Crypto, Effect, FileSystem, Layer, Path, Schema } from "effect"

class BlobStoreError extends Schema.TaggedError<BlobStoreError>()("BlobStoreError", {
  cause: Schema.Defect()
}) {}

class BlobStore extends Context.Service<BlobStore, {
  put(data: Uint8Array): Effect.Effect<string, BlobStoreError>
}>()("app/BlobStore") {
  // Requirements stay open: the app (or a test) decides which platform provides them.
  static readonly layerNoDeps = Layer.effect(
    BlobStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const crypto = yield* Crypto.Crypto
      const root = path.join(".data", "blobs")
      yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.orDie)

      const put = Effect.fn("BlobStore.put")(function*(data: Uint8Array) {
        const id = yield* crypto.randomUUIDv7
        yield* fs.writeFile(path.join(root, id), data)
        return id
      }, Effect.mapError((cause) => new BlobStoreError({ cause })))

      return BlobStore.of({ put })
    })
  )
  static readonly layer = this.layerNoDeps.pipe(Layer.provide(NodeServices.layer))
}

const main = Effect.gen(function*() {
  const store = yield* BlobStore
  const id = yield* store.put(new TextEncoder().encode("hello"))
  yield* Effect.log("stored", id)
})

main.pipe(Effect.provide(BlobStore.layer), NodeRuntime.runMain)
```

- **Runtime entry.** `NodeRuntime.runMain(effect, { disableErrorReporting?, teardown? })` (or data-last
  `runMain(options)(effect)`) installs SIGINT/SIGTERM interruption, exit codes and the error report. For
  long-running apps use `Layer.launch(AppLayer).pipe(NodeRuntime.runMain)`. Bare `Effect.runFork` does
  not keep Node alive while suspended on a `Deferred`; use `runMain`. Bun: `BunRuntime.runMain`.
- **FileSystem.** All ops fail with `PlatformError` whose `reason._tag` is `BadArgument` or a
  `SystemError` kind (`NotFound`, `AlreadyExists`, `PermissionDenied`, …). Construct with
  `PlatformError.systemError({...})` / `badArgument({...})`, not `new`. `fs.exists` maps only
  `NotFound` to `false`. Sizes are `ByteSize` (`stat().size`), `file.seek` takes/returns `bigint`.
  Prefer `makeTempDirectoryScoped()` / `makeTempFileScoped()` — cleanup tied to the Scope. `fs.watch`
  is non-recursive unless `{ recursive: true }`. `fs.stream(path)` / `fs.sink(path)` for large files.
  Don't let `PlatformError` leak through a domain service; `mapError` to your own tagged error.
- **Path** is a service, not `node:path`: `path.join/resolve/relative/basename/extname`,
  `path.fromFileUrl(url)` (takes a `URL`, not a string). `Path.layer` is a pure POSIX implementation —
  deterministic in tests.
- **Crypto** (core `Crypto.Crypto`): `randomBytes(n)`, `digest("SHA-256", bytes)` (SHA-1/256/384/512,
  one-shot), `random`, `randomInt`, `randomIntBetween`, `randomShuffle`, `randomUUIDv4`,
  `randomUUIDv7`, `randomULID`. There is no HMAC, no streaming hash, no cipher — use `node:crypto`
  behind your own service for those. Prefer it over `crypto.randomUUID()` so tests can swap it.
- **Stdio**: `args`, `stdin: Stream<Uint8Array>`, `stdout()` / `stderr()` sinks,
  `stdinIsTerminal`/`stdoutIsTerminal`. `Stdio.layerTest({ ... })` fakes it. Program output from a
  library goes through `Stdio` or `Console`, never `process.stdout`.
- **Terminal**: `readLine` (fails with `QuitError` on Ctrl-C/D), `readInput` (scoped key queue),
  `display`, `columns`/`rows`. `Terminal.make({...})` builds a fake.
- **Override one platform service** by providing the replacement *inside* the bundle:
  `program.pipe(Effect.provide(FileSystem.layerNoop({ ... })), Effect.provide(NodeServices.layer))` —
  the inner provide wins. `FileSystem.layerNoop` makes most un-overridden ops fail with `NotFound` (`exists` → `false`;
  `makeDirectory` / `makeTemp*` die — `references/testing.md` §9).
- **KeyValueStore** (in `effect/persistence`, see §11): `layerMemory`,
  `layerFileSystem(dir)` (needs `FileSystem | Path`), `layerSql()`, browser `layerStorage(() =>
  localStorage)`; `KeyValueStore.toSchemaStore(kvs, Schema)` for typed values; `KeyValueStore.prefix`.

---

## 2. HTTP client (`effect/http`)

**Imports:** `import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http"`; `import { NodeHttpClient } from "@effect/platform-node"` (`layerUndici`, `layerNodeHttp`)

One named service per upstream owns base URL, auth, status classification, decoding and error
mapping. The service layer requires `HttpClient.HttpClient`; the transport is picked at the edge.

```ts
import { Config, Context, Effect, flow, Layer, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http"

class Repo extends Schema.Class<Repo>("github/Repo")({
  id: Schema.Int,
  full_name: Schema.String,
  stargazers_count: Schema.Int
}) {}

class GitHubError extends Schema.TaggedError<GitHubError>()("GitHubError", {
  cause: Schema.Defect()
}) {}

class GitHub extends Context.Service<GitHub, {
  getRepo(owner: string, name: string): Effect.Effect<Repo, GitHubError>
  star(owner: string, name: string): Effect.Effect<void, GitHubError>
}>()("app/GitHub") {
  static readonly layerNoDeps = Layer.effect(
    GitHub,
    Effect.gen(function*() {
      const token = yield* Config.Redacted("GITHUB_TOKEN")
      const base = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(flow(
          HttpClientRequest.prependUrl("https://api.github.com"),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(token) // accepts Redacted directly
        )),
        HttpClient.filterStatusOk // 4xx/5xx are *successes* until you do this
      )
      // Reads are idempotent: retry. filterStatusOk comes first so retry sees StatusCodeError.
      const reads = base.pipe(
        HttpClient.retryTransient({ schedule: Schedule.exponential("200 millis"), times: 3 })
      )
      // Writes get a separate client with no retry.
      const writes = base

      const getRepo = Effect.fn("GitHub.getRepo")(function*(owner: string, name: string) {
        yield* Effect.annotateCurrentSpan({ owner, name })
        return yield* reads.get(`/repos/${owner}/${name}`).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Repo)),
          Effect.timeout("10 seconds") // no client timeout option exists
        )
      }, Effect.mapError((cause) => new GitHubError({ cause })))

      const star = Effect.fn("GitHub.star")(function*(owner: string, name: string) {
        yield* writes.put(`/user/starred/${owner}/${name}`)
      }, Effect.mapError((cause) => new GitHubError({ cause })))

      return GitHub.of({ getRepo, star })
    })
  )
  static readonly layer = this.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer))
}

// Inspecting a client failure: one wrapper tag, six reason tags.
export const isRetryable = (e: HttpClientError.HttpClientError) =>
  e.reason._tag === "TransportError" || (e.reason._tag === "StatusCodeError" && e.reason.response.status >= 500)
```

- **Status is not an error by default.** A 404/500 succeeds. Add `HttpClient.filterStatusOk` (or
  `filterStatus(pred)`, or `HttpClientResponse.matchStatus({ 200: …, "4xx": …, orElse })`) before
  decoding. Decide which statuses are contract errors per operation; the rest become defects.
- **Order matters**: `filterStatusOk` *before* `retryTransient`, otherwise the retry never sees a 5xx.
- **`retryTransient({ retryOn, schedule, times, while })`** — `retryOn: "errors-only" |
  "response-only" | "errors-and-responses"` (default both). Transient = 408/429/500/502/503/504,
  `TransportError`, `TimeoutError`. Retry only idempotent requests; build a separate write client.
- **`HttpClient.withRateLimiter({ limiter, key, limit, window, algorithm, times })`** (limiter from
  `effect/persistence` `RateLimiter`, §11) auto-retries 429s *unlimited* unless `times` is set — use
  `times: 0` on any client that sends non-idempotent requests.
- **Error reasons**: `HttpClientError.reason._tag` is one of `TransportError`, `EncodeError`,
  `InvalidUrlError`, `StatusCodeError`, `DecodeError`, `EmptyBodyError`. `RequestError` /
  `ResponseError` are type unions, never tags — a `catchTag("ResponseError")` branch is dead.
  `error.response` is present for status/decode reasons.
- **Timeouts**: `Effect.timeout(d)` on the call or `HttpClient.transformResponse(Effect.timeout(d))`;
  interruption aborts the in-flight request. Undici's own timeouts are neutralized.
- **Body**: `response.json` / `.text` are cached Effects (getters); `.stream` is single-use;
  `HttpClientResponse.schemaBodyJson(S)` decodes. Request bodies: `HttpClientRequest.bodyJson(x)` is
  effectful (`HttpBodyError`); `bodyJsonUnsafe` throws. `HttpClientRequest.delete` (client method is
  `.del`). Query params via `{ urlParams }` or `setUrlParams`.
- **Transports**: `FetchHttpClient.layer` (no deps; swap the `fetch` via `FetchHttpClient.Fetch`
  reference in tests), `NodeHttpClient.layerUndici`, `NodeHttpClient.layerNodeHttp`.
  `HttpClient.followRedirects(n)`, `HttpClient.withCookiesRef(ref)` for cookie jars.
- **Tracing knobs are `Context.Reference`s**: `HttpClient.TracerPropagationEnabled` (turn off for
  third parties), `TracerDisabledWhen`, `SpanNameGenerator`, `TracerHeaderFilter`.
- **Mocks**: derive from `HttpClient.make((req) => Effect.succeed(HttpClientResponse.fromWeb(req, new
  Response(...))))` and `Layer.succeed(HttpClient.HttpClient, client)`; or keep `FetchHttpClient.layer`
  and `Effect.provideService(FetchHttpClient.Fetch, async () => new Response(...))`.

---

## 3. HTTP server (`effect/http`)

**Imports:** `import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"`; `import { NodeHttpServer } from "@effect/platform-node"`; `import { createServer } from "node:http"`

Routes are layers that register on the `HttpRouter` service; `HttpRouter.serve` turns the merged
route layer into a server layer; `Layer.launch` runs it.

```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { createServer } from "node:http"

class Greeter extends Context.Service<Greeter, {
  greet(name: string): Effect.Effect<string>
}>()("app/Greeter") {
  static readonly layer = Layer.succeed(Greeter, Greeter.of({
    greet: (name) => Effect.succeed(`hello ${name}`)
  }))
}

const Body = Schema.Struct({ name: Schema.String })

const HelloRoutes = HttpRouter.use(Effect.fn(function*(router) {
  const greeter = yield* Greeter
  yield* router.add("GET", "/health", HttpServerResponse.text("ok"))
  yield* router.add("POST", "/hello", Effect.gen(function*() {
    const { name } = yield* HttpServerRequest.schemaBodyJson(Body)
    return HttpServerResponse.text(yield* greeter.greet(name))
  }))
}))

const Logging = HttpRouter.middleware((httpEffect) =>
  Effect.map(httpEffect, HttpServerResponse.setHeader("x-served-by", "app"))
).layer

const App = HelloRoutes.pipe(Layer.provide(Logging))

const Server = HttpRouter.serve(App).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
  Layer.provide(Greeter.layer) // shared services: provide *outside* serve
)

Layer.launch(Server).pipe(NodeRuntime.runMain)
```

- **`HttpRouter.add(method, path, handler)`** is a single-route layer; `HttpRouter.use(router =>
  …)` registers several with access to services; `router.prefixed("/v1")`; methods include `"*"` and
  `QUERY`. Path params: `HttpRouter.params`, `HttpRouter.schemaPathParams(S)`,
  `HttpRouter.schemaParams(S)` (path + query). Body: `HttpServerRequest.schemaBodyJson(S)`.
- **Fresh router / forked memo map.** `serve`, `toHttpEffect` and `toWebHandler` build the app with a
  fresh router in a *forked* `MemoMap`. Layers first built inside are private to that entrypoint;
  calling `serve` twice builds them twice. Provide shared stateful services (DB pools, caches)
  outside `serve`. Never pre-provide `HttpRouter.layer` to route layers — they register on a different
  router and the served one is empty. `toWebHandler` builds separately unless you pass `{ memoMap }`.
- **Middleware placement.** `HttpRouter.middleware(f).layer` affects only the routes you provide it to;
  `HttpRouter.middleware(f, { global: true })` affects every route. The `middleware` *option* of
  `serve` wraps the whole chain including sending, so response edits there are silently dropped.
  `HttpMiddleware.tracer` is always applied and `serve` adds the logger unless `disableLogger` —
  don't add them yourself. `HttpRouter.cors({...})` is a layer. `HttpRouter.provideRequest(layer)`
  provides per-request services without writing middleware.
- **Default failure → status** (`HttpServerError.causeResponse`):

  | Cause | Response |
  |---|---|
  | failure/defect implementing `HttpServerRespondable` | its own response |
  | `Schema.SchemaError` | empty 400 |
  | `Cause.NoSuchElementError` | empty 404 |
  | `RequestParseError` / `RouteNotFound` reasons | 400 / 404 |
  | defect that *is* an `HttpServerResponse` | that response |
  | interrupt from client abort / server shutdown | 499 / 503 |
  | anything else | empty 500 |

  Implement `[HttpServerRespondable.symbol]()` on a domain error to own its response instead of
  hand-mapping at every route.
- **Limits are `Context.Reference`s**, not options: `HttpIncomingMessage.MaxBodySize`,
  `Multipart.MaxFileSize`, `Multipart.MaxFieldSize` (default 10 MiB), `Multipart.MaxParts`. Set with
  `Layer.succeed(Ref, value)` or `Effect.provideService`.
- **Lifetimes.** Each request runs in its own Scope, closed after the response is sent (streaming
  bodies extend it); multipart temp files go away with it. Handlers are interrupted on client
  disconnect unless added with `{ uninterruptible: true }`. A prefixed router strips the prefix from
  `request.url` (use `originalUrl`). `HttpServerResponse.empty()` is 204.
- **Static files**: `HttpStaticServer.layer({ root, index?, spa?, cacheControl?, prefix? })` — needs
  `FileSystem | Path | HttpPlatform`, which `NodeHttpServer.layer` provides.
- **Web handlers** (Cloudflare, Next.js route handlers, Deno): `HttpRouter.toWebHandler(appLayer)`
  returns `{ handler: (Request) => Promise<Response>, dispose }`. If routes need platform services,
  provide `HttpServer.layerServices`. Call `dispose` on shutdown.
- **Tests**: `NodeHttpServer.layerTest` serves on port 0 and provides an `HttpClient` pre-pointed at it;
  `HttpServer.layerServices` has a no-op FileSystem for port-less tests.

---

## 4. HttpApi (`effect/http-api`)

**Imports:** `import { HttpApi, HttpApiBuilder, HttpApiClient, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiMiddleware, HttpApiScalar, HttpApiSchema, HttpApiSecurity, HttpApiSwagger, HttpApiTest, OpenApi } from "effect/http-api"`

Schema-first: the API value is shared by server, client, OpenAPI and tests. Keep the definition in
its own module (ideally its own package) so clients never import server code.

```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import {
  HttpApi, HttpApiBuilder, HttpApiClient, HttpApiEndpoint, HttpApiGroup,
  HttpApiMiddleware, HttpApiScalar, HttpApiSchema, HttpApiSecurity
} from "effect/http-api"
import { createServer } from "node:http"

// ---- shared definition (api package) ----
const TodoId = Schema.Int.pipe(Schema.brand("TodoId"))
class Todo extends Schema.Class<Todo>("Todo")({ id: TodoId, title: Schema.String, done: Schema.Boolean }) {}

class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", { id: TodoId }, {
  httpApiStatus: 404
}) {}
class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}, { httpApiStatus: 401 }) {}

class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()("app/CurrentUser") {}

class Auth extends HttpApiMiddleware.Service<Auth, { provides: CurrentUser; requires: never }>()("app/Auth", {
  requiredForClient: true, // clients must supply a layerClient implementation
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized
}) {}

class TodosGroup extends HttpApiGroup.make("todos")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: { done: Schema.optional(Schema.Boolean) }, // "true" -> true via toCodecStringTree
      success: Schema.Array(Todo)
    }),
    HttpApiEndpoint.get("byId", "/:id", {
      params: { id: TodoId }, // decoded from the path string via toCodecStringTree
      success: Todo,
      error: TodoNotFound
    }),
    HttpApiEndpoint.post("create", "/", {
      payload: Schema.Struct({ title: Schema.String }),
      success: Todo.pipe(HttpApiSchema.status(201))
    })
  )
  .middleware(Auth) // covers only endpoints added above this call
  .prefix("/todos") {}

class Api extends HttpApi.make("todo-api").add(TodosGroup) {}

// ---- server ----
const AuthLive = Layer.succeed(Auth, Auth.of({
  bearer: Effect.fn(function*(httpEffect, { credential }) {
    if (Redacted.value(credential) !== "dev-token") return yield* new Unauthorized()
    return yield* Effect.provideService(httpEffect, CurrentUser, { id: "u1" })
  })
}))

const TodosLive = HttpApiBuilder.group(Api, "todos", Effect.fn(function*(handlers) {
  const store = new Map<number, Todo>()
  return handlers.handleAll({
    list: ({ query }) =>
      Effect.succeed([...store.values()].filter((t) => query.done === undefined || t.done === query.done)),
    byId: ({ params }) => {
      const todo = store.get(params.id)
      return todo ? Effect.succeed(todo) : Effect.fail(new TodoNotFound({ id: params.id }))
    },
    create: Effect.fn(function*({ payload }) {
      const user = yield* CurrentUser // provided by the Auth middleware
      yield* Effect.annotateCurrentSpan({ userId: user.id })
      const todo = new Todo({ id: TodoId.make(store.size + 1), title: payload.title, done: false })
      store.set(todo.id, todo)
      return todo
    })
  })
}))

const ApiRoutes = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(TodosLive),
  Layer.provide(AuthLive)
)
const Server = HttpRouter.serve(Layer.mergeAll(ApiRoutes, HttpApiScalar.layer(Api, { path: "/docs" }))).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 }))
)

// ---- client ----
const AuthClient = HttpApiMiddleware.layerClient(Auth, ({ next, request }) =>
  next(HttpClientRequest.bearerToken(request, "dev-token"))
)

class TodoClient extends Context.Service<TodoClient, HttpApiClient.ForApi<typeof Api>>()("app/TodoClient") {
  static readonly layer = Layer.effect(TodoClient, HttpApiClient.make(Api, { baseUrl: "http://localhost:3000" })).pipe(
    Layer.provide(AuthClient),
    Layer.provide(FetchHttpClient.layer)
  )
}

export const useClient = Effect.gen(function*() {
  const client = yield* TodoClient
  const created = yield* client.todos.create({ payload: { title: "ship" } })
  return yield* client.todos.byId({ params: { id: created.id } }) // fails with TodoNotFound | Unauthorized | …
})

if (process.env.RUN_SERVER) Layer.launch(Server).pipe(NodeRuntime.runMain)
```

- **Endpoint options object**: `HttpApiEndpoint.get|post|put|patch|delete|head|options|query(name,
  path, { params, query, headers, payload, success, error })`. No v3 chaining (`.setPayload`,
  `.addSuccess` are gone). `success` / `error` may be arrays (several statuses / encodings). For GET,
  `payload` is read from the query string. Header keys must be lowercase.
- **Status mapping**: annotate the error class `{ httpApiStatus: 404 }` (third arg of
  `Schema.TaggedError`) or pipe `HttpApiSchema.status(404)`. Defaults: success 200, error 500, omitted
  success 204, `Schema.Void` empty 200. `HttpApiSchema.NoContent` / `Created` / `Accepted` /
  `Empty(code)`; `HttpApiSchema.asNoContent({ decode: () => new E() })` for bodiless errors;
  `asText({ contentType })`, `asMultipart()`, `asFormUrlEncoded()`, `asUint8Array()` change encoding.
  Built-ins: `HttpApiError.NotFound`, `BadRequest`, `Unauthorized`, `Conflict`, … and their
  `*NoContent` variants.
- **Slots auto-wrap codecs**: params/query/headers go through `Schema.toCodecStringTree`, JSON
  bodies through `Schema.toCodecJson`, so plain domain schemas work (`Schema.Int` in a path param).
- **Group middleware covers only endpoints already added** — call `.add(...)` first, then
  `.middleware(M)`. Same for `.annotateEndpoints`. Middleware is LIFO. `HttpApiGroup.make(id, {
  topLevel: true })` puts endpoints at the client root (`client.health()`).
- **Handlers**: `HttpApiBuilder.group(Api, "name", Effect.fn(function*(handlers) { …;
  return handlers.handleAll({...}) }))` or chained `handlers.handle("name", fn, { uninterruptible
  })` / `handleRaw`. A missing handler is a runtime defect at build time. A handler may return an
  `HttpServerResponse` directly. Services yielded in the outer generator become layer requirements;
  services yielded inside a handler become request requirements (must be provided by middleware or
  the layer).
- **Empty-400 trap**: request decode failures are an empty 400 with no body. Surface them with
  `HttpApiMiddleware.layerSchemaErrorTransform(Service, (schemaError, { endpoint }) => Effect.fail(new
  ValidationError(...)))` and attach the service via `.middleware(...)` at endpoint/group/API level.
- **Security**: `HttpApiSecurity.bearer | basic | apiKey({ key, in })`; the middleware impl receives
  `(httpEffect, { credential })` with a `Redacted` credential. Cookies: `HttpApiBuilder.securitySetCookie`.
- **Serving**: `HttpApiBuilder.layer(Api, { openapiPath })` is a route layer — serve it with
  `HttpRouter.serve` (§3) or `HttpRouter.toWebHandler`. There is no `HttpApiBuilder.toWebHandler`.
  Docs: `HttpApiScalar.layer(Api, { path })`, `HttpApiSwagger.layer(Api, { path })`.
- **OpenAPI**: `.annotateMerge(OpenApi.annotations({ title, description, version, … }))` on API,
  group or endpoint; `OpenApi.Exclude` hides an endpoint.
- **Client**: `HttpApiClient.make(Api, { baseUrl, transformClient, transformResponse })` →
  `Effect<Client, never, HttpClient | client middleware>`. Wrap it in a service typed
  `HttpApiClient.ForApi<typeof Api>`. Every middleware with `requiredForClient: true` needs a
  `HttpApiMiddleware.layerClient(M, ({ next, request }) => …)`. Retry / base-URL policy goes in
  `transformClient`. Narrow clients: `HttpApiClient.group`, `HttpApiClient.endpoint`;
  `HttpApiClient.urlBuilder` takes decoded values; `responseMode: "decoded-only" |
  "decoded-and-response" | "response-only"` per call.
- **Streaming**: `success: HttpApiSchema.StreamUint8Array()` or `HttpApiSchema.StreamSse({ data:
  Schema, error? })`; the handler returns `Effect<Stream>` and the client gets a typed `Stream`. Typed
  SSE failures travel as a reserved `effect/http-api/stream/failure` event. At most one streaming
  success per endpoint; not allowed on HEAD or in errors.
- **Typed response headers**: `HttpApiSchema.WithHeaders(schema, { "x-total": Schema.NumberFromString
  })`; handler returns `HttpApiSchema.withHeaders({ body, headers })`.
- **Tests**: `HttpApiTest.groups(Api, ["todos"])` yields an in-memory typed client over the real
  handler layers — provide the handler layers, their middleware (`Layer.provideMerge`), the client
  middleware, and `HttpServer.layerServices`. See `references/testing.md`.

---

## 5. RPC (`effect/rpc`)

**Imports:** `import { Rpc, RpcClient, RpcGroup, RpcMiddleware, RpcSerialization, RpcServer, RpcTest } from "effect/rpc"`; `import { RpcClientError } from "effect/rpc/RpcClientError"` (the barrel export is a namespace)

A contract (`RpcGroup` of `Rpc.make`), a handler layer (`group.toLayer`), a server protocol, a client
protocol. There is no `Rpc.query` / `Rpc.mutation` — every procedure is `Rpc.make`.

```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { Rpc, RpcClient, RpcGroup, RpcMiddleware, RpcSerialization, RpcServer } from "effect/rpc"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import { createServer } from "node:http"

// ---- contract (shared package) ----
class User extends Schema.Class<User>("User")({ id: Schema.String, name: Schema.String }) {}
class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", { id: Schema.String }) {}

class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()("app/rpc/CurrentUser") {}
class AuthMiddleware extends RpcMiddleware.Service<AuthMiddleware, { provides: CurrentUser }>()("app/rpc/Auth") {}

class UserRpcs extends RpcGroup.make(
  Rpc.make("GetUser", {
    payload: { id: Schema.String },
    success: User,
    error: UserNotFound,
    primaryKey: ({ id }) => id // only allowed with inline struct-field payloads
  }),
  Rpc.make("WatchUsers", {
    success: User, // with stream: true this is the *element* schema
    stream: true
  })
).middleware(AuthMiddleware) {}

// ---- server ----
const AuthLive = Layer.succeed(AuthMiddleware, AuthMiddleware.of((effect, { headers }) =>
  Effect.provideService(effect, CurrentUser, { id: headers["x-user"] ?? "anonymous" })
))

const UsersLive = UserRpcs.toLayer(Effect.gen(function*() {
  const users = new Map([["1", new User({ id: "1", name: "Ada" })]])
  return UserRpcs.of({
    GetUser: Effect.fn("GetUser")(function*({ id }) {
      const user = users.get(id)
      if (!user) return yield* new UserNotFound({ id })
      return user
    }),
    WatchUsers: () => Stream.fromIterable(users.values())
  })
}))

const RpcRoute = RpcServer.layerHttp({
  group: UserRpcs,
  path: "/rpc",
  protocol: "http", // default is "websocket"
  disableFatalDefects: true // otherwise one handler defect fails every in-flight request on the connection
}).pipe(Layer.provide([UsersLive, AuthLive]))

const Server = HttpRouter.serve(RpcRoute).pipe(
  Layer.provide(RpcSerialization.layerNdjson), // streams over HTTP need a framed codec
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3001 }))
)

// ---- client ----
class UserClient extends Context.Service<
  UserClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof UserRpcs>, RpcClientError>
>()(
  "app/rpc/UserClient"
) {
  static readonly layer = Layer.effect(UserClient, RpcClient.make(UserRpcs)).pipe( // make needs Scope -> Layer.effect
    Layer.provide(RpcClient.layerProtocolHttp({ url: "http://localhost:3001/rpc" })),
    Layer.provide([RpcSerialization.layerNdjson, FetchHttpClient.layer])
  )
}

export const callIt = Effect.gen(function*() {
  const client = yield* UserClient
  const ada = yield* client.GetUser({ id: "1" }, { headers: { "x-user": "1" } })
  const all = yield* client.WatchUsers().pipe(Stream.runCollect)
  return [ada, all] as const
})

if (process.env.RUN_SERVER) Layer.launch(Server).pipe(NodeRuntime.runMain)
```

- **`Rpc.make(tag, { payload, success, error, defect, stream, primaryKey })`**. `payload` takes a
  schema or struct fields. `stream: true` turns `success` into the element schema and `error` into the
  stream's error; the rpc's own error becomes `Never`. The tag is the wire identity — renaming it is a
  breaking change.
- **`RpcGroup.make(...rpcs)`**, `.middleware(M)`, `.prefix("users.")`, `.merge(other)` (silent
  last-wins on duplicate tags: prefix before merging), `.annotateRpcs`. `group.toLayer(handlers |
  Effect<handlers>)`, `toLayerHandler(tag, h)`, `toHandlers`, `accessHandler(tag)` (unit-test one
  handler).
- **Handler wrappers** wrap the *return value*: `eff.pipe(Rpc.fork)` (exempt from the server-wide
  concurrency semaphore), `Rpc.uninterruptible`, `Rpc.wrap({ fork, uninterruptible })`. Server
  `concurrency` is one semaphore per server instance, not per client.
- **Server protocols**: `RpcServer.layerHttp({ group, path, protocol })` (route layer, needs
  `HttpRouter` + `RpcSerialization`), or `RpcServer.layer(group)` + `RpcServer.layerProtocolHttp({
  path })` / `layerProtocolWebsocket` / `layerProtocolSocketServer` / `layerProtocolStdio` (plugin
  hosts) / `layerProtocolWorkerRunner`. `RpcServer.toHttpEffect(group)` for embedding.
- **Serialization must match on both sides**: `layerJson`, `layerNdjson`, `layerJsonRpc`,
  `layerNdJsonRpc`, `layerSchemaBinary` (no MessagePack in v4). Raw TCP needs a framed codec
  (ndjson / SchemaBinary); HTTP + unframed JSON buffers the whole response, so streams arrive at once;
  WebSocket frames itself; workers need none.
- **Middleware**: `RpcMiddleware.Service<Self, { provides, requires, clientError }>()(id, { error,
  requiredForClient })` — config goes in the type parameter, options take only those two keys. The impl
  is `(effect, { client, requestId, rpc, payload, headers }) => Effect`. Don't repeat a middleware's
  error in each rpc's `error`; it is unioned in. Client side: `RpcMiddleware.layerClient(M, ...)`.
- **Client**: `RpcClient.make(group, { flatten? })` requires `Scope` (build it in `Layer.effect`).
  Protocols `layerProtocolHttp({ url, transformClient })`, `layerProtocolSocket(...)`,
  `layerProtocolWorker(...)`. Headers are lowercased. Socket reconnects do not replay in-flight calls;
  use `RpcClient.ConnectionHooks.onConnect` to re-auth/resubscribe. Import errors from
  `effect/rpc/RpcClientError`.
- **Tests**: `RpcTest.makeClient(group)` runs client and server in-process (needs the handler layers,
  server middleware and any `requiredForClient` client middleware, plus `Scope`). `Rpc.exitSchema(rpc)`
  for round-trip serialization tests.

---

## 6. SQL (`effect/sql` + drivers)

**Imports:** `import { Migrator, SqlClient, SqlError, SqlModel, SqlResolver, SqlSchema } from "effect/sql"`; `import { Model } from "effect/schema"` (`Model.Class` variants); `import { PgClient, PgMigrator } from "@effect/sql-pg"`; `import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"`

The driver layer provides both the driver tag and the generic `SqlClient.SqlClient`; services depend
on `SqlClient` only, so swapping drivers is a one-layer change.

```ts
import { PgClient } from "@effect/sql-pg"
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Config, Context, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

class Account extends Schema.Class<Account>("Account")({
  id: Schema.Int,
  email: Schema.String,
  balance: Schema.Int
}) {}

class EmailTaken extends Schema.TaggedError<EmailTaken>()("EmailTaken", { email: Schema.String }) {}
class AccountNotFound extends Schema.TaggedError<AccountNotFound>()("AccountNotFound", { id: Schema.Int }) {}

class Accounts extends Context.Service<Accounts, {
  create(email: string): Effect.Effect<Account, EmailTaken>
  transfer(from: number, to: number, amount: number): Effect.Effect<void, AccountNotFound>
}>()("app/Accounts") {
  static readonly layerNoDeps = Layer.effect(
    Accounts,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const findById = SqlSchema.findOne({ // fails NoSuchElementError when no row
        Request: Schema.Int,
        Result: Account,
        execute: (id) => sql`SELECT * FROM accounts WHERE id = ${id}`
      })

      const create = Effect.fn("Accounts.create")(function*(email: string) {
        const rows = yield* sql`INSERT INTO accounts ${sql.insert({ email, balance: 0 })} RETURNING *`
        return yield* Schema.decodeUnknownEffect(Account)(rows[0])
      }, (effect, email) =>
        effect.pipe(
          Effect.catchReason("SqlError", "UniqueViolation", () => Effect.fail(new EmailTaken({ email }))),
          Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die })
        ))

      const transfer = Effect.fn("Accounts.transfer")(function*(from: number, to: number, amount: number) {
        yield* Effect.annotateCurrentSpan({ from, to })
        yield* findById(from).pipe(
          Effect.catchTag("NoSuchElementError", () => Effect.fail(new AccountNotFound({ id: from })))
        )
        yield* sql`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${from}`
        yield* sql`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${to}`
      }, (effect) =>
        effect.pipe(
          sql.withTransaction, // nested withTransaction = savepoint
          Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die })
        ))

      return Accounts.of({ create, transfer })
    })
  )
}

// Local / tests: SQLite (node:sqlite, Node >= 22.16) + inline migrations.
const SqliteLive = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord({
    "0001_accounts": Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE accounts (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, balance INTEGER NOT NULL)`
    })
  })
}).pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })))

// Production: Postgres, URL as a Redacted config value.
export const PgLive = PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })

export const AccountsTest = Accounts.layerNoDeps.pipe(Layer.provide(SqliteLive), Layer.orDie)
```

- **Tagged template**: interpolations are parameters, never string-spliced. Helpers on the client:
  `sql.insert(obj | arr)`, `sql.update(obj, omitKeys)`, `sql.in(values)`, `sql.and([...])`,
  `sql.csv`, `sql.join`, `sql("identifier")` (quoted identifier), `sql.literal(raw)` (unsafe, raw),
  `sql.onDialectOrElse({ pg: …, sqlite: …, orElse })`. A statement is an Effect yielding rows;
  `.raw`, `.values`, `.stream`, `.unprepared`, `.withoutTransform` for other shapes.
- **SqlSchema** — `findAll`, `findNonEmpty`, `findOne` (fails `Cause.NoSuchElementError`),
  `findOneOption`, `void` — each `{ Request, Result?, execute }` → a function `(req) => Effect`. There is
  no `single`.
- **Transactions**: `sql.withTransaction(effect)`; nesting creates a savepoint. On Postgres, catching a
  statement error inside a transaction does not un-abort it — wrap the recoverable step in its own
  nested `withTransaction`. Transaction context is per client instance; don't mix clients in one unit.
  Never hold a transaction across a network call or a retry loop.
- **SqlError** is a wrapper with `reason._tag` in `ConnectionError | AuthenticationError |
  AuthorizationError | SqlSyntaxError | UniqueViolation (has constraint) | ConstraintError |
  DeadlockError | SerializationError | LockTimeoutError | StatementTimeoutError | UnknownError`; reasons
  expose `isRetryable`. Map `UniqueViolation` to a domain error with `Effect.catchReason`; everything
  else is usually a defect at the service boundary.
- **SqlResolver** (`findById`, `ordered`, `grouped`, `void`) builds a `RequestResolver` that batches
  `Effect.request` calls automatically; tune with `RequestResolver.setDelay` / `batchN` only if needed.
- **Models**: `Model.Class` (in `effect/schema`) derives select/insert/update/json/jsonCreate/jsonUpdate
  variants from one field list: `Model.FieldExcept([...])`, `FieldOnly`, `Field({...})`,
  `GeneratedByDb` (select/json only — not in update, so not for ids you update by), `GeneratedByApp`,
  `Sensitive`, `DateTimeInsert`, `DateTimeUpdate`, `UuidV4Insert(Id)`. `SqlModel.makeRepository(Model,
  { tableName, spanPrefix, idColumn })` → `insert` / `update` / `findById` (fails `NoSuchElementError`)
  / `delete`; `SqlModel.makeResolvers` for batched variants.
- **Migrations**: `PgMigrator.layer({ loader })` / `SqliteMigrator.layer({ loader })` with
  `Migrator.fromRecord({...})`, `Migrator.fromFileSystem(dir)` (needs `FileSystem | Path`) or
  `fromGlob(import.meta.glob(...))`. Keys/files are `<id>_<name>`, run once in id order.
- **`@effect/sql-pg` is a native client** — no `pg` dependency. `int8` decodes to `bigint`, prepared
  statements are on by default, `listen(channel)` returns a scoped dequeue. `PgClient.layer({...})`
  for static config, `layerConfig` with `Config.Redacted` for env. `@effect/sql-sqlite-node` uses
  built-in `node:sqlite`.

---

## 7. CLI (`effect/cli`)

**Imports:** `import { Argument, CliConfig, CliError, Command, Flag, GlobalFlag, Prompt } from "effect/cli"`

Constructors are PascalCase (`Flag.String`, `Flag.Int`, `Flag.Finite`, `Flag.Literals`,
`Argument.String`, `Prompt.Select`); combinators are lowercase and pipeable. Never `@effect/cli`.

```ts
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Context, Effect, Layer, Option, Schema } from "effect"
import { Argument, Command, Flag, Prompt } from "effect/cli"

class Links extends Context.Service<Links, {
  create(slug: string, target: string): Effect.Effect<void>
  remove(slug: string): Effect.Effect<void>
}>()("mlink/Links") {
  static readonly layer = Layer.succeed(Links, Links.of({
    create: (slug, target) => Console.log(`created ${slug} -> ${target}`),
    remove: (slug) => Console.log(`removed ${slug}`)
  }))
}

const root = Command.make("mlink").pipe(
  Command.withSharedFlags({
    json: Flag.Boolean("json").pipe(Flag.withDefault(false)), // bare Flag.Boolean is *required*
    profile: Flag.String("profile").pipe(Flag.withAlias("p"), Flag.withDefault("default"))
  }),
  Command.withDescription("Manage short links")
)

const create = Command.make("create", {
  slug: Argument.String("slug").pipe(Argument.withSchema(Schema.NonEmptyString)),
  target: Argument.String("target"),
  ttl: Flag.Int("ttl").pipe(Flag.withDescription("Days to live"), Flag.optional)
}, Effect.fn(function*({ slug, target, ttl }) {
  const { json } = yield* root // subcommands read shared parent flags by yielding the parent
  const links = yield* Links
  yield* links.create(slug, target)
  if (json) yield* Console.log(JSON.stringify({ slug, target, ttl: Option.getOrNull(ttl) }))
})).pipe(Command.withDescription("Create a link"))

const remove = Command.make("remove", {
  slug: Argument.String("slug"),
  yes: Flag.Boolean("yes").pipe(Flag.withAlias("y"), Flag.withDefault(false))
}, Effect.fn(function*({ slug, yes }) {
  const confirmed = yes || (yield* Prompt.Confirm({ message: `Delete ${slug}?`, initial: false }))
  if (!confirmed) return
  const links = yield* Links
  yield* links.remove(slug)
})).pipe(Command.withAlias("rm"))

const cli = root.pipe(
  Command.withSubcommands([create, remove]),
  Command.provide(Links.layer) // command-scoped services
)

// Production entry: argv comes from Stdio; Command.Environment comes from NodeServices.
cli.pipe(
  Command.run({ version: "0.1.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)

// Tests: drive with explicit argv.
export const runArgs = Command.runWith(cli, { version: "0.1.0" })
// runArgs(["create", "docs", "https://effect.website", "--json"])
```

- **`Command.make(name, config?, handler?)`** — config is a record of `Flag` / `Argument` (nested
  records allowed); the handler receives the parsed record. `Command.withSubcommands([...])`,
  `withSharedFlags` (parent flags visible to children via `yield* parent`), `withGlobalFlags`,
  `withAlias`, `withExamples`, `unlisted` (was `withHidden`), `wizard`.
- **Booleans have no implicit `false`.** `Flag.Boolean("x")` omitted is a `MissingOption` error; add
  `Flag.withDefault(false)` or `Flag.optional` (→ `Option`). Test the no-flags path.
- **Validation**: `Flag.withSchema(S)` / `Argument.withSchema(S)` validate at parse time;
  `Flag.Literals("level", ["a", "b"])`, `Flag.ChoiceWithValue`, `Flag.Redacted`, `Flag.File({ mustExist
  })`, `Flag.FileSchema`, `Flag.KeyValuePair`, `Argument.variadic({ min, max })`.
  `withFallbackConfig(Config.X)` / `withFallbackPrompt(Prompt.X)` fill missing values from env or a
  prompt. A `Schema.decodeUnknownSync` inside the handler throws a defect — validate in the flag.
- **Services**: `Command.provide(layer | (input) => layer)`, `provideSync`, `provideEffect`,
  `provideEffectDiscard`. The layer is built before the handler runs.
- **Running**: `Command.run({ version })` (pipeable, reads argv from `Stdio`) or
  `Command.runWith(cmd, { version })(argv)`. Both require `Command.Environment` = `FileSystem | Path |
  Terminal | ChildProcessSpawner | Stdio` → provide `NodeServices.layer` / `BunServices.layer`. Keep
  CLIs out of pure library packages.
- **Prompts are Effects** (`Prompt<A> extends Effect<A, QuitError, FileSystem | Path | Terminal>`):
  `Prompt.String`, `Int`, `Number`, `Password`, `Hidden`, `Confirm`, `Toggle`, `Select({ message,
  choices: [{ title, value }] })`, `MultiSelect`, `AutoComplete`, `List`, `Date`, `File`; combine with
  `Prompt.all`.
- **Output**: program output via `Console.log` (stdout); diagnostics via `Effect.log*`. The default
  logger and the `runMain` failure report also go to stdout — redirect logs to stderr for
  machine-readable output (`Logger.LogToStderr`, §14). Built-in global flags (`--help`, `--version`,
  `--completions`, `--log-level`, wizard) are configurable with `CliConfig.layer({ builtIns: [...] })`.
- **Cold start**: CLIs pay for import graph size. Deep module imports (`effect/Effect`,
  `effect/cli/Command`) instead of barrels are the one place they are worth it.
- `effect/cli` `Command` is not process spawning — that's `effect/process` (§8).

---

## 8. Child processes (`effect/process`)

**Imports:** `import { ChildProcess, ChildProcessSpawner } from "effect/process"`

`ChildProcess.make` builds an inert command value; the `ChildProcessSpawner` service (from
`NodeServices.layer` / `BunServices.layer`) runs it.

```ts
import { NodeServices } from "@effect/platform-node"
import { Console, Context, Effect, Layer, Schema, Stream, String } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

class GitError extends Schema.TaggedError<GitError>()("GitError", {
  exitCode: Schema.Number,
  cause: Schema.optional(Schema.Defect())
}) {}

class Git extends Context.Service<Git, {
  readonly head: Effect.Effect<string, GitError>
  readonly changedFiles: (base: string) => Effect.Effect<ReadonlyArray<string>, GitError>
  readonly test: Effect.Effect<void, GitError>
}>()("app/Git") {
  static readonly layerNoDeps = Layer.effect(
    Git,
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const wrap = Effect.mapError((cause: unknown) => new GitError({ exitCode: -1, cause }))

      // string / lines collect output — they do NOT fail on a nonzero exit code.
      const head = spawner.string(ChildProcess.make`git rev-parse HEAD`).pipe(Effect.map(String.trim), wrap)

      const changedFiles = (base: string) =>
        spawner.lines(ChildProcess.make("git", ["diff", "--name-only", `${base}...HEAD`])).pipe(wrap)

      // When the status matters: spawn a scoped handle, drain output, then check exitCode.
      const test = Effect.scoped(Effect.gen(function*() {
        const handle = yield* spawner.spawn(
          ChildProcess.make("npm", ["test"], { env: { CI: "1" }, extendEnv: true, forceKillAfter: "5 seconds" })
        ).pipe(wrap)
        yield* handle.all.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) => Console.log(`[test] ${line}`)),
          wrap
        )
        const exitCode = yield* handle.exitCode.pipe(wrap)
        if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* new GitError({ exitCode })
      }))

      return Git.of({ head, changedFiles, test })
    })
  )
  static readonly layer = this.layerNoDeps.pipe(Layer.provide(NodeServices.layer))
}

export const pipeline = ChildProcess.make("git", ["log", "--oneline"]).pipe(
  ChildProcess.pipeTo(ChildProcess.make("head", ["-n", "5"]))
)
```

- **Nonzero exit is not an error** for `spawner.string` / `lines` / `streamString` / `streamLines`.
  Check `handle.exitCode` against `ChildProcessSpawner.ExitCode(0)` when status matters.
- **`env` replaces the environment** (PATH included) unless `extendEnv: true`.
- **Drain or ignore pipes.** Waiting on `exitCode` without consuming `stdout`/`stderr` can deadlock on a
  full pipe buffer — consume `handle.all` / `stdout`, or set `stdout: "ignore" | "inherit"`.
- **Lifetime**: `spawner.spawn` requires `Scope`; closing it kills the process (`killSignal`, escalating
  to SIGKILL after `forceKillAfter`). Never `Effect.scoped` inside a detached fork that should outlive
  the caller — hold a `Scope` in a registry instead.
- **Forms**: `make("cmd", args, options)`; tagged template ``make`git diff ${ref}` `` (each
  interpolation is one argv entry, never shell-split); `make({ cwd })` followed by a template for
  options. `ChildProcess.pipeTo` chains commands; `setCwd` / `setEnv` / `prefix` modify a command;
  `shell: true` opts in to a shell. `stdin` takes `"pipe" | "inherit" | "ignore"` or a
  `Stream<Uint8Array>`; `handle.stdin` is a Sink.
- Don't leak `PlatformError` from a service; map to a domain error carrying the exit code.

---

## 9. AI (`effect/ai` + providers)

**Imports:** `import { AiError, Chat, EmbeddingModel, LanguageModel, Model, Prompt, Tool, Toolkit } from "effect/ai"`; `import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"`; `import { OpenAiClient, OpenAiEmbeddingModel, OpenAiLanguageModel } from "@effect/ai-openai"`

Provider-agnostic services (`LanguageModel`, `EmbeddingModel`, `DecisionModel`) are satisfied by
provider *model layers* (`AnthropicLanguageModel.model("…")`), which in turn require a provider
*client* (`AnthropicClient.layerConfig(...)`), which requires an `HttpClient`.

```ts
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { Config, Context, Effect, ExecutionPlan, Layer, Schema } from "effect"
import { AiError, LanguageModel, Tool, Toolkit } from "effect/ai"
import { FetchHttpClient } from "effect/http"

class Inventory extends Context.Service<Inventory, {
  stock(sku: string): Effect.Effect<number>
}>()("shop/Inventory") {
  static readonly layer = Layer.succeed(Inventory, Inventory.of({ stock: () => Effect.succeed(7) }))
}

const GetStock = Tool.make("GetStock", {
  description: "Current stock level for a SKU",
  parameters: Schema.Struct({ sku: Schema.String.annotate({ description: "e.g. 'sku-123'" }) }),
  success: Schema.Struct({ sku: Schema.String, available: Schema.Int }),
  dependencies: [Inventory] // handler may yield Inventory; it becomes a requirement of the *call*
})
const ListCategories = Tool.make("ListCategories", { // no-arg tool: parameters default to Tool.EmptyParams
  success: Schema.Array(Schema.String)
})

const ShopTools = Toolkit.make(GetStock, ListCategories)
const ShopToolsLive = ShopTools.toLayer({
  GetStock: Effect.fn(function*({ sku }) {
    const inventory = yield* Inventory
    return { sku, available: yield* inventory.stock(sku) }
  }),
  ListCategories: () => Effect.succeed(["audio", "video"])
})

const Summary = Schema.Struct({ headline: Schema.String, risks: Schema.Array(Schema.String) })

class AssistantError extends Schema.TaggedError<AssistantError>()("AssistantError", {
  reason: AiError.AiErrorReason // reasons are schemas: embed them in your own error
}) {}

const Anthropic = AnthropicClient.layerConfig({ apiKey: Config.Redacted("ANTHROPIC_API_KEY") }).pipe(
  Layer.provide(FetchHttpClient.layer)
)
const OpenAi = OpenAiClient.layerConfig({ apiKey: Config.Redacted("OPENAI_API_KEY") }).pipe(
  Layer.provide(FetchHttpClient.layer)
)

// Try the cheap model (with retries), then fall back to another provider.
const Plan = ExecutionPlan.make(
  { provide: OpenAiLanguageModel.model("gpt-5.2"), attempts: 2 },
  { provide: AnthropicLanguageModel.model("claude-opus-4-6"), attempts: 1 }
)

class Assistant extends Context.Service<Assistant, {
  answer(question: string): Effect.Effect<string, AssistantError>
  summarize(notes: string): Effect.Effect<typeof Summary.Type, AssistantError>
}>()("shop/Assistant") {
  static readonly layer = Layer.effect(
    Assistant,
    Effect.gen(function*() {
      const plan = yield* Plan.captureRequirements // moves client requirements to the layer
      const tools = yield* ShopTools // the toolkit with handlers bound
      const inventory = yield* Inventory // a tool `dependency`: required by each generateText call

      const answer = Effect.fn("Assistant.answer")(function*(question: string) {
        const response = yield* LanguageModel.generateText({ prompt: question, toolkit: tools })
        // generateText runs one model turn (+ tool calls); loop with Chat for multi-step agents.
        return response.text
      }, Effect.provideService(Inventory, inventory), Effect.withExecutionPlan(plan), Effect.mapError((e) => new AssistantError({ reason: e.reason })))

      const summarize = Effect.fn("Assistant.summarize")(function*(notes: string) {
        const response = yield* LanguageModel.generateObject({ objectName: "summary", prompt: notes, schema: Summary })
        return response.value
      }, Effect.withExecutionPlan(plan), Effect.mapError((e) => new AssistantError({ reason: e.reason })))

      return Assistant.of({ answer, summarize })
    })
  ).pipe(Layer.provide([ShopToolsLive, Inventory.layer, Anthropic, OpenAi]))
}

export { Assistant }
```

- **Calls**: `LanguageModel.generateText({ prompt, toolkit?, toolChoice? })` → `.text`, `.toolCalls`,
  `.toolResults`, `.finishReason`, `.usage`; `generateObject({ objectName, prompt, schema })` →
  `.value` (decoded); `streamText({ prompt })` → `Stream` of response parts (filter `part.type ===
  "text-delta"`). `prompt` is a string, a message array, or a `Prompt` value.
- **Model selection**: `AnthropicLanguageModel.model("…", config?)` returns an `AiModel` that is a
  `Layer` — `Effect.provide(model)` per call, or `yield* model.captureRequirements` inside a layer so
  the client becomes a layer requirement. `Model.ProviderName` / `Model.ModelName` tell you which ran.
- **Fallback**: `ExecutionPlan.make({ provide, attempts, schedule?, while? }, …)` +
  `Effect.withExecutionPlan(plan)` (also `Stream.withExecutionPlan`).
- **Tools**: `Tool.make(name, { description, parameters, success, failure, failureMode:
  "error" | "return", dependencies })`. Parameters must encode to an object-root JSON Schema — a
  `Schema.Struct`/`Class` or `Tool.EmptyParams` (the default; providers reject `Schema.Struct({})`).
  `Tool.Strict` rejects unknown keys. `Tool.providerDefined` / provider packages (`OpenAiTool.WebSearch`,
  `AnthropicTool.*`) for server-side tools; `Tool.dynamic` for runtime-defined tools.
- **Toolkits**: `Toolkit.make(...tools)`, `Toolkit.merge`, `toolkit.toLayer(handlers |
  Effect<handlers>)`; `yield* Toolkit` gives the handled toolkit to pass as `toolkit`. Handler services
  must be on the outer Effect of `toLayer`, or declared in the tool's `dependencies` — then they are
  requirements of every `generateText` call that passes the toolkit, not of the toolkit layer.
- **Chat** keeps history: `Chat.empty`, `Chat.fromPrompt(prompt)`, `chat.generateText({ prompt })`,
  `chat.history` (a `Ref`), `exportJson` / `Chat.fromJson`, `Chat.layerPersisted` for storage-backed
  chats. Agentic loop: call `chat.generateText({ prompt: [], toolkit })` until `toolCalls` is empty.
- **Embeddings**: `EmbeddingModel.EmbeddingModel` service — `embed(text)`, `embedMany(texts)` (batched
  via its resolver); provide `OpenAiEmbeddingModel.model("text-embedding-3-small", { dimensions })`.
- **Decisions**: `Decision.classify({ instructions, criteria })`, `Decision.rate`,
  `Decision.probability`, run by `DecisionModel.decide(definition, options)` against a `DecisionModel`
  provider (`@effect/ai-openrouter`, `@effect/ai-typesafe`). (Shape verified; semantics unverified.)
- **AiError** is one wrapper with `reason._tag` among `RateLimitError`, `QuotaExhaustedError`,
  `AuthenticationError`, `ContentPolicyError`, `InvalidRequestError`, `InternalProviderError`,
  `NetworkError`, `InvalidOutputError`, `StructuredOutputError`, `UnsupportedSchemaError`,
  `ToolNotFoundError`, `ToolParameterValidationError`, `InvalidToolResultError`, … Recover with
  `Effect.catchReason("AiError", "RateLimitError", …)`; embed `AiError.AiErrorReason` in your own
  error schema.
- **Service types are branded interfaces**: refer to `LanguageModel.LanguageModel`,
  `EmbeddingModel.EmbeddingModel`, `Chat.Chat` directly — not `.Service`.
- Removed in v4: `@effect/ai-google`, `@effect/ai-amazon-bedrock` (the npm `latest` of those is v3-era;
  don't mix). v3 `AiLanguageModel` / `AiTool` / `AiToolkit` / `AiChat` names are gone.

---

## 10. MCP server (`effect/ai` McpServer)

**Imports:** `import { McpProtocol, McpSchema, McpServer, Tool, Toolkit } from "effect/ai"`; `import { NodeStdio } from "@effect/platform-node"`

Tools, resources and prompts are each a layer that registers with the `McpServer` service; a
transport layer (`layerStdio` / `layerHttp`) provides that service. Run with `Layer.launch`.

```ts
import { NodeRuntime, NodeStdio } from "@effect/platform-node"
import { Context, Effect, Layer, Logger, Schema } from "effect"
import { McpProtocol, McpSchema, McpServer, Tool, Toolkit } from "effect/ai"

class Notes extends Context.Service<Notes, {
  search(query: string): Effect.Effect<ReadonlyArray<string>>
  read(id: number): Effect.Effect<string>
}>()("mcp/Notes") {
  static readonly layer = Layer.succeed(Notes, Notes.of({
    search: (q) => Effect.succeed([`note about ${q}`]),
    read: (id) => Effect.succeed(`# Note ${id}`)
  }))
}

const SearchNotes = Tool.make("search_notes", {
  description: "Full-text search over notes. Returns matching titles.",
  parameters: Schema.Struct({ query: Schema.String }),
  success: Schema.Array(Schema.String),
  failure: Schema.String
}).annotate(Tool.Readonly, true)

const NotesToolkit = Toolkit.make(SearchNotes)

const ToolsLayer = McpServer.toolkit(NotesToolkit).pipe(
  Layer.provideMerge(NotesToolkit.toLayer(Effect.gen(function*() {
    const notes = yield* Notes // services on the outer Effect: resolved once at build time
    return NotesToolkit.of({
      search_notes: ({ query }) =>
        query.length < 2
          ? Effect.fail("Query too short: pass at least 2 characters.") // the agent sees only this message
          : notes.search(query)
    })
  })))
)

const NoteResource = McpServer.resource`notes://${McpSchema.param("id", Schema.NumberFromString)}`({
  name: "Note",
  mimeType: "text/markdown",
  content: Effect.fn(function*(_uri, id) {
    const notes = yield* Notes
    return yield* notes.read(id)
  })
})

const ReviewPrompt = McpServer.prompt({
  name: "review_note",
  parameters: { id: Schema.String },
  content: ({ id }) => Effect.succeed(`Read notes://${id} and suggest edits.`)
})

const Server = Layer.mergeAll(ToolsLayer, NoteResource, ReviewPrompt).pipe(
  Layer.provide(McpServer.layerStdio({
    name: "notes",
    version: "1.0.0",
    protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18] // required, non-empty; first is the fallback
  })),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Notes.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)) // stdout belongs to the JSON-RPC protocol
)

if (process.env.RUN_MCP) Layer.launch(Server).pipe(NodeRuntime.runMain)
```

- **Transports**: `McpServer.layerStdio({ name, version, protocols })` (needs `Stdio`) or
  `McpServer.layerHttp({ name, version, path, protocols, allowedOrigins? })` (a route layer — serve with
  `HttpRouter.serve`, §3). Adapters: `McpProtocol.v2024_11_05`, `v2025_03_26`, `v2025_06_18`,
  `v2025_11_25`, `v2026_07_28`. (The upstream `MCP.md` lists only the first three; the d.ts has five.)
- **Stdio discipline**: anything on stdout corrupts the protocol. Set `Logger.LogToStderr` to `true`
  (or `Logger.consolePretty({ stderr: true })`). The `runMain` failure report also lands on stdout.
  Stdin EOF interrupts the main fiber.
- **Parameters** must be an object-root schema (`Schema.Struct` / `Class`) or `Tool.EmptyParams`;
  `Schema.Struct({})` or a top-level `Union` dies at registration. `Tool.Strict` adds
  `additionalProperties: false`.
- **Failures reach the agent as text only** (`isError: true`, no `structuredContent`) — put
  remediation in the message. Success is returned as both text and `structuredContent`.
- **Hints are not authorization**: `Tool.Readonly`, `Destructive`, `Idempotent`, `OpenWorld` default
  to least-trusting; set them with `.annotate(Tool.Readonly, true)`. Enforce permissions in the handler.
- **Services**: yield them on the outer `toLayer` Effect (resolved once); a handler that yields a
  service per call must declare it in the tool's `dependencies` and the server must provide it.
- **Resources**: `McpServer.resource({ uri, name, mimeType, content })` or the template form
  `` McpServer.resource`file://x/${McpSchema.param("id", Schema)}`({ ... }) `` with `completion`.
  Bare string / `Uint8Array` content is wrapped as `{ contents: [{ uri, text | blob }] }` *without*
  `mimeType` — return a full `{ contents: [{ uri, mimeType, text }] }` when the type matters.
- **Elicitation**: `McpServer.elicit({ message, schema })` asks the user mid-call; handle
  `ElicitationDeclined`. Two stdio servers in one process need `Layer.fresh` around each bundle.

---

## 11. Persistence (`effect/persistence`)

**Imports:** `import { KeyValueStore, Persistable, PersistedCache, PersistedQueue, Persistence, RateLimiter, Redis } from "effect/persistence"`; `import { NodeRedis } from "@effect/platform-node"` (provides `Redis.Redis`)

Every module here is "service + pluggable store": pick the store layer (memory for tests, Redis or
SQL in production) at the edge.

```ts
import { NodeRedis } from "@effect/platform-node"
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { KeyValueStore, Persistable, PersistedCache, PersistedQueue, Persistence, RateLimiter } from "effect/persistence"

// ---- PersistedQueue: durable, schema-typed work queue ----
const EmailJob = Schema.Struct({ to: Schema.String, subject: Schema.String })

class EmailQueue extends Context.Service<EmailQueue>()("app/EmailQueue", {
  make: PersistedQueue.make({ name: "emails", schema: EmailJob, maxAttempts: 3, retrySchedule: Schedule.spaced("5 seconds") })
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make).pipe(Layer.provide(PersistedQueue.layer))
  static readonly layerRedis = this.layerNoDeps.pipe(
    Layer.provide(PersistedQueue.layerStoreRedis({ lockRefreshInterval: "10 seconds", lockExpiration: "30 seconds" })),
    Layer.provide(NodeRedis.layer({ url: "redis://localhost:6379" }))
  )
  static readonly layerTest = this.layerNoDeps.pipe(Layer.provide(PersistedQueue.layerStoreMemory))
}

export const enqueue = Effect.gen(function*() {
  const queue = yield* EmailQueue
  yield* queue.offer({ to: "a@b.c", subject: "hi" }, { id: "welcome:a@b.c" }) // id dedupes
})

export const worker = Effect.gen(function*() {
  const queue = yield* EmailQueue
  yield* queue.take((job, { attempts }) => Effect.log("sending", job.to, attempts)).pipe(Effect.forever)
})

// ---- PersistedCache: cache whose entries survive restarts ----
class Rate extends Persistable.Class<{ payload: { readonly pair: string } }>()("Rate", {
  primaryKey: ({ pair }) => pair,
  success: Schema.Number
}) {}

export const rates = Effect.gen(function*() {
  const cache = yield* PersistedCache.make((req: Rate) => Effect.succeed(req.pair.length * 1.1), {
    storeId: "fx-rates",
    timeToLive: (exit) => (exit._tag === "Success" ? "1 hour" : "0 millis"), // don't persist failures
    inMemoryCapacity: 1000
  })
  return yield* cache.get(new Rate({ pair: "EURUSD" }))
}).pipe(Effect.scoped, Effect.provide(Persistence.layerMemory))

// ---- KeyValueStore + schema store ----
const Prefs = Schema.Struct({ theme: Schema.Literals(["light", "dark"]) })
export const prefs = Effect.gen(function*() {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Prefs)
  yield* store.set("user:1", { theme: "dark" })
  return Option.getOrUndefined(yield* store.get("user:1"))
}).pipe(Effect.provide(KeyValueStore.layerMemory))

// ---- RateLimiter on an HttpClient ----
export const limitedClient = Effect.gen(function*() {
  const limiter = yield* RateLimiter.RateLimiter
  return (yield* HttpClient.HttpClient).pipe(
    HttpClient.withRateLimiter({ limiter, key: "github", limit: 60, window: "1 minute", algorithm: "token-bucket", times: 0 })
  )
}).pipe(Effect.provide([RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory)), FetchHttpClient.layer]))
```

- **PersistedQueue**: `PersistedQueue.make({ name, schema, maxAttempts?, retrySchedule? })` needs
  `PersistedQueue.layer` (the factory) over a store: `layerStoreMemory`, `layerStoreRedis({ prefix,
  pollInterval, lockRefreshInterval, lockExpiration })` (needs `Redis.Redis`), `layerStoreSql({
  tableName, … })` (needs `SqlClient`). `offer(value, { id })` dedupes by id; `take(handler)` processes
  one job (with `{ id, attempts }`) under a refreshed lock — loop it with `Effect.forever`. Keep
  `lockRefreshInterval` well below `lockExpiration`. Delivery is at-least-once: handlers must be
  idempotent.
- **PersistedCache**: keys are `Persistable.Class` requests (`primaryKey`, `success`, `error` schemas
  — values are serialized). `PersistedCache.make(lookup, { storeId, timeToLive: (exit, key) => …,
  inMemoryCapacity, inMemoryTTL })` needs `Persistence` + `Scope`. Give failures a zero TTL unless you
  mean to cache them.
- **Persistence** stores: `layerMemory`, `layerKvs` (over a `KeyValueStore`), `layerRedis`, `layerSql`,
  `layerSqlMultiTable`.
- **RateLimiter**: `RateLimiter.layer` *requires* a `RateLimiterStore` — provide `layerStoreMemory`
  or `layerStoreRedis(...)`. Direct use: `limiter.consume({ key, limit, window, algorithm:
  "fixed-window" | "token-bucket", onExceeded: "delay" | "fail", tokens? })`, or
  `RateLimiter.makeWithRateLimiter` for an `(options) => (effect) => effect` wrapper. Failures are
  `RateLimiterError` with reason `RateLimitExceeded { retryAfter, limit, remaining }` or
  `RateLimitStoreError`.
- **Redis**: `Redis.Redis` service (`send`, scoped `subscribe` → dequeue) from `NodeRedis.layer(opts)`
  / `NodeRedis.layerConfig` / `BunRedis`.
- **KeyValueStore**: `layerMemory`, `layerFileSystem(dir)`, `layerSql()`, `layerStorage(() =>
  localStorage)`; `KeyValueStore.prefix(store, "ns:")`; `toSchemaStore(store, S)` (`get` →
  `Option`).

---

## 12. Cluster and Workflow

**Imports:** `import { ClusterCron, ClusterSchema, Entity, Sharding, ShardingConfig, SingleRunner, Singleton, TestRunner } from "effect/cluster"`; `import { Activity, DurableClock, DurableDeferred, DurableQueue, Workflow, WorkflowEngine } from "effect/workflow"`; `import { NodeClusterSocket } from "@effect/platform-node"`

### Workflow: durable, replayed execution

A workflow body re-runs from the top on every resume; completed `Activity` results are read back from
the journal instead of re-executed. So: every side effect and every source of non-determinism (HTTP,
DB writes, `Crypto`, `Clock`, randomness) goes inside an `Activity`.

```ts
import { Effect, Layer, Schema } from "effect"
import { Activity, DurableClock, Workflow, WorkflowEngine } from "effect/workflow"

class ChargeFailed extends Schema.TaggedError<ChargeFailed>()("ChargeFailed", { orderId: Schema.String }) {}

const Checkout = Workflow.make("Checkout", {
  payload: { orderId: Schema.String, amount: Schema.Int },
  idempotencyKey: ({ orderId }) => orderId, // business id -> one execution per order
  success: Schema.Struct({ receipt: Schema.String }),
  error: ChargeFailed
})

const CheckoutLive = Checkout.toLayer(Effect.fn(function*({ orderId, amount }, executionId) {
  const receipt = yield* Activity.make({
    name: "charge-card", // stable name: it is the journal key
    success: Schema.String,
    error: ChargeFailed,
    execute: Effect.gen(function*() {
      const attempt = yield* Activity.CurrentAttempt
      yield* Effect.log("charging", orderId, amount, attempt)
      return `rcpt-${orderId}`
    })
  }).pipe(Activity.retry({ times: 3 }))

  yield* DurableClock.sleep({ name: "cooldown", duration: "1 hour" }) // survives restarts
  yield* Activity.make({ name: "send-receipt", execute: Effect.log("emailing", receipt, executionId) })
  return { receipt }
}))

export const run = Checkout.execute({ orderId: "o-1", amount: 4200 }).pipe(
  Effect.provide(CheckoutLive.pipe(Layer.provideMerge(WorkflowEngine.layerMemory))) // tests only
)
```

- **`Workflow.make(tag, { payload, idempotencyKey, success?, error?, suspendedRetrySchedule? })`**;
  implement with `wf.toLayer((payload, executionId) => Effect)`. Call with `wf.execute(payload, {
  discard? })`, inspect with `wf.poll(executionId)`, `wf.interrupt`, `wf.resume`. The execution id is
  derived from the tag and idempotency key — get it with `wf.executionId(payload)`; its hashing changed
  in 4.0.0-rc.116, so ids persisted by earlier RCs don't match.
- **`Activity.make({ name, success?, error?, execute })`** — `execute` is an Effect (not a function).
  Results are journaled through the schemas, so success/error must be serializable schemas.
  `Activity.retry({ times })` is attempt-based; `Activity.CurrentAttempt`; `Activity.idempotencyKey(name,
  { includeAttempt })` for keys sent to external APIs; `Activity.raceAll`.
- **Durable time and signals**: `DurableClock.sleep({ name, duration, inMemoryThreshold? })`;
  `DurableDeferred.make(name, { success, error })` + `DurableDeferred.token(deferred)` handed to a
  webhook, completed later with `DurableDeferred.succeed / fail` (or `tokenFromPayload` /
  `tokenFromExecutionId`). `DurableQueue.make` + `process` / `worker` for at-least-once fan-out.
- **Compensation**: `wf.withCompensation(effect, (value, cause) => undo)` (or `Workflow.withCompensation`) for top-level steps
  only; `Workflow.addFinalizer` to observe interrupts. Annotations `Workflow.CaptureDefects`,
  `Workflow.SuspendOnFailure`.
- **Engines**: `WorkflowEngine.layerMemory` is not durable — tests only. Production uses
  `ClusterWorkflowEngine` (backed by cluster `MessageStorage`, e.g. SQL). Expose workflows over
  RPC/HTTP with `WorkflowProxy.toRpcGroup` / `toHttpApiGroup` + `WorkflowProxyServer`.

### Cluster: sharded entities, singletons, cron

```ts
import { Effect, Layer, Ref, Schema } from "effect"
import { ClusterCron, ClusterSchema, Entity, TestRunner } from "effect/cluster"
import { Cron } from "effect"
import { Rpc } from "effect/rpc"

const Increment = Rpc.make("Increment", { payload: { amount: Schema.Int }, success: Schema.Int })
const GetCount = Rpc.make("GetCount", { success: Schema.Int }).annotate(ClusterSchema.Persisted, true)

const Counter = Entity.make("Counter", [Increment, GetCount])

const CounterLive = Counter.toLayer(Effect.gen(function*() {
  const count = yield* Ref.make(0) // per-entity in-memory state while active
  return Counter.of({
    Increment: ({ payload }) => Ref.updateAndGet(count, (n) => n + payload.amount), // handlers get an envelope
    GetCount: () => Ref.get(count).pipe(Rpc.fork) // opt out of per-entity sequential processing
  })
}), { maxIdleTime: "5 minutes" })

const Nightly = ClusterCron.make({
  name: "nightly-report",
  cron: Cron.parseUnsafe("0 3 * * *"),
  execute: Effect.log("running nightly report") // runs once cluster-wide per tick
})

export const useCounter = Effect.gen(function*() {
  const clientFor = yield* Counter.client
  const counter = clientFor("counter-123")
  yield* counter.Increment({ amount: 1 })
  return yield* counter.GetCount()
}).pipe(Effect.provide(Layer.mergeAll(CounterLive, Nightly).pipe(Layer.provideMerge(TestRunner.layer))))
```

- **Entities**: `Entity.make(type, [rpcs])`; `entity.toLayer(Effect<handlers>, { maxIdleTime,
  concurrency (default 1), mailboxCapacity, defectRetryPolicy })`; `toLayerQueue` for manual ordering.
  Handlers receive one envelope (`{ payload, address, requestId, … }`), not `(payload, opts)`. Use
  `Entity.CurrentAddress` instead of threading the id through payloads; `Entity.keepAlive(true)` pins an
  entity during long work.
- **Delivery annotations** (`ClusterSchema`): `Persisted` (message survives restarts; give the rpc a
  `primaryKey` for dedup), `WithTransaction` (handler SQL commits with the ack), `Uninterruptible`,
  `ShardGroup`, `ClientTracingEnabled`, `Dynamic`. Default messages are volatile.
- **Runtime levels**: `TestRunner.layer` (in-memory, single process, inspectable
  `MessageStorage.MemoryDriver`) → `SingleRunner.layer({ runnerStorage: "sql" })` (durable single node;
  needs `SqlClient | Crypto`) → `NodeClusterSocket.layer({ serialization: "binary" | "ndjson", storage:
  "local" | "sql" | "byo", runnerHealth: "ping" | "k8s", shardingConfig })` (also `NodeClusterHttp`,
  `BunClusterSocket`). SchemaBinary is the default cluster wire format.
- **Config**: `ShardingConfig.layerFromEnv` (assigned groups via `SHARD_GROUPS`);
  `availableShardGroups` must be identical cluster-wide; `maxResidentEntities` (default 10 000) is
  runner-wide.
- **Singletons and cron**: `Singleton.make(name, effect)` keeps one active owner;
  `ClusterCron.make({ name, cron, execute, shardGroup?, skipIfOlderThan?,
  calculateNextRunFromPrevious? })` is durable cron.
- **Exposure**: `EntityProxy.toRpcGroup(entity)` / `toHttpApiGroup` + `EntityProxyServer` instead of
  hand-written dispatch. Testing a single entity: `Entity.makeTestClient(entity, layer)` (provide
  `ShardingConfig` yourself).

---

## 13. Reactivity (`effect/reactivity`)

**Imports:** `import { AsyncResult, Atom, AtomRegistry, AtomRef, Reactivity } from "effect/reactivity"`; React bindings from `@effect/atom-react` (`useAtomValue`, `useAtomSet`, `useAtom`, `useAtomMount`, `RegistryProvider`)

Atoms are lazily evaluated, reference-counted reactive cells held in an `AtomRegistry`. Effectful
atoms produce `AsyncResult` (`Initial | Success | Failure`, each with a `waiting` flag). Services reach
atoms through `Atom.runtime(layer)`.

```ts
import { Context, Effect, Layer, Schema } from "effect"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"

class Todo extends Schema.Class<Todo>("Todo")({ id: Schema.Int, title: Schema.String }) {}
class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", { id: Schema.Int }) {}

class TodoApi extends Context.Service<TodoApi, {
  readonly list: Effect.Effect<ReadonlyArray<Todo>>
  get(id: number): Effect.Effect<Todo, TodoNotFound>
  add(title: string): Effect.Effect<Todo>
}>()("app/TodoApi") {
  static readonly layer = Layer.sync(TodoApi, () => {
    const todos: Array<Todo> = [new Todo({ id: 1, title: "ship" })]
    return TodoApi.of({
      list: Effect.sync(() => [...todos]),
      get: (id) => {
        const t = todos.find((x) => x.id === id)
        return t ? Effect.succeed(t) : Effect.fail(new TodoNotFound({ id }))
      },
      add: (title) => Effect.sync(() => { const t = new Todo({ id: todos.length + 1, title }); todos.push(t); return t })
    })
  })
}

// Module scope, always: atoms are identities. Creating them in a component re-creates state every render.
const runtime = Atom.runtime(TodoApi.layer)

export const filterAtom = Atom.make("") // writable local state
export const todosAtom = runtime.atom(Effect.gen(function*() {
  const api = yield* TodoApi
  return yield* api.list
}))
export const visibleAtom = Atom.make((get) => // derived; recomputes when deps change
  AsyncResult.map(get(todosAtom), (todos) => todos.filter((t) => t.title.includes(get(filterAtom))))
)
export const todoAtom = Atom.family((id: number) => // one atom per key, memoized
  runtime.atom(Effect.gen(function*() {
    const api = yield* TodoApi
    return yield* api.get(id)
  }))
)
export const addTodo = runtime.fn(Effect.fn(function*(title: string, get) {
  const api = yield* TodoApi
  const todo = yield* api.add(title)
  get.refresh(todosAtom) // or reactivityKeys for key-based invalidation
  return todo
}))
export const tickAtom = Atom.make((get) => { // side-effect atom: own your cleanup
  const handle = setInterval(() => get.setSelf(Date.now()), 1000)
  get.addFinalizer(() => clearInterval(handle))
  return Date.now()
}).pipe(Atom.keepAlive)

export const render = (result: AsyncResult.AsyncResult<Todo, TodoNotFound>) =>
  AsyncResult.builder(result)
    .onInitial(() => "loading")
    .onErrorTag("TodoNotFound", (e) => `no todo ${e.id}`)
    .onSuccess((todo) => todo.title)
    .orNull()

// Outside React (tests, CLIs): const registry = AtomRegistry.make(); registry.mount(atom);
// registry.set(filterAtom, "x"); registry.get(visibleAtom)
export const registry = AtomRegistry.make()
```

- **Constructors**: `Atom.make(value | (get) => A | Effect | Stream)`, `Atom.readable` / `writable`
  (custom read/write), `Atom.family(key => atom)`, `Atom.map` / `mapResult` / `transform`,
  `Atom.fn` / `fnSync` (callable atoms; `runtime.fn` when they need services), `Atom.pull(stream)`
  (paged streams), `Atom.subscriptionRef(ref)`, `Atom.kvs({ runtime, key, schema, defaultValue })`
  (persisted via a `KeyValueStore` runtime), `Atom.searchParam(name)`, `Atom.optimistic` /
  `optimisticFn`, `Atom.debounce`, `Atom.swr`, `Atom.refreshOnWindowFocus`, `Atom.withReactivity(keys)`.
- **Lifetimes**: atoms are disposed when unmounted (with `setIdleTTL` grace); `Atom.keepAlive` for
  global state that must survive. Runtimes: `Atom.runtime(layer)`; add app-wide layers once with
  `Atom.runtime.addGlobalLayer(layer)`.
- **Context `get`**: `get(atom)` subscribes, `get.once` doesn't, `get.result(atom)` yields an Effect of
  an `AsyncResult` atom's success, `get.setSelf`, `get.addFinalizer`, `get.refresh`, `get.set`.
- **Rules**: define atoms at module scope; never set atoms during render (use event handlers or
  `useAtomMount`); register cleanup with `get.addFinalizer` for any timer/subscription you start; keep
  derivations narrow (`Atom.map`) so re-renders stay local.
- **AsyncResult**: `isInitial` / `isSuccess` / `isFailure` / `isWaiting`, `AsyncResult.map`,
  `getOrElse`, `match` / `matchWithError`, and the `builder(...)` chain (`onInitial`,
  `onInitialOrWaiting`, `onWaiting`, `onErrorTag`, `onError`, `onDefect`, `onSuccess`, `render`,
  `orNull`, `orElse`).
- **Reactivity** (the service under `reactivityKeys`): `Reactivity.mutation(keys, effect)` invalidates,
  `Reactivity.query(keys, effect)` re-runs on invalidation. `AtomHttpApi.Service` / `AtomRpc.Service`
  derive query/mutation atoms straight from an `HttpApi` / `RpcGroup`.

---

## 14. Observability

**Imports:** `import { Logger, Metric, References, Tracer } from "effect"`; `import { Otlp, OtlpLogger, OtlpMetrics, OtlpSerialization, OtlpTracer, PrometheusMetrics } from "effect/observability"`

Native OTLP export lives in core (`effect/observability`) and needs only an `HttpClient`. Prefer it
over `@effect/opentelemetry` (`NodeSdk.layer`) unless you need the OpenTelemetry SDK's
instrumentations / processors. Libraries stay telemetry-agnostic: spans and logs, no exporter imports,
no metrics registries; the app composes exporters once at the edge.

```ts
import { NodeFileSystem, NodeRuntime } from "@effect/platform-node"
import { Context, Effect, FileSystem, Layer, Logger, Metric, References } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"
import { Otlp } from "effect/observability"

// Metrics at module scope; attributes for low-cardinality dimensions only.
const ordersPlaced = Metric.counter("orders_placed_total", { description: "Orders accepted" })
const checkoutLatency = Metric.timer("checkout_duration")

class Checkout extends Context.Service<Checkout, {
  place(orderId: string, cents: number): Effect.Effect<void>
}>()("shop/Checkout") {
  static readonly layer = Layer.succeed(Checkout, Checkout.of({
    // Effect.fn("Name") = a span per call + stack frames. Annotate IDs and business values only.
    place: Effect.fn("Checkout.place")(function*(orderId: string, cents: number) {
      yield* Effect.annotateCurrentSpan({ "order.id": orderId, "order.cents": cents })
      yield* Effect.sleep("20 millis").pipe(Effect.withSpan("Checkout.chargeCard"))
      yield* Effect.logInfo("order placed").pipe(Effect.annotateLogs({ orderId }))
      yield* Metric.update(Metric.withAttributes(ordersPlaced, { channel: "web" }), 1)
    }, Effect.trackDuration(checkoutLatency))
  }))
}

// Production: one layer exports traces, logs and metrics over OTLP/HTTP JSON.
export const Telemetry = Otlp.layerJson({
  baseUrl: "http://localhost:4318",
  resource: { serviceName: "shop", serviceVersion: "1.0.0" }
}).pipe(Layer.provide(FetchHttpClient.layer))

// Local agent feedback loop: same OTLP pipeline, but every export is appended to a JSONL file the
// agent can read — no collector needed.
export const TelemetryToFile = (file: string) =>
  Otlp.layerJson({ baseUrl: "http://otlp.local", resource: { serviceName: "shop" } }).pipe(
    Layer.provide(Layer.effect(HttpClient.HttpClient, Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      return HttpClient.make((request) => {
        const body = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array()
        return fs.writeFile(file, Uint8Array.from([...body, 10]), { flag: "a" }).pipe(
          Effect.orDie,
          Effect.as(HttpClientResponse.fromWeb(request, new Response(null, { status: 200 })))
        )
      })
    }))),
    Layer.provide(NodeFileSystem.layer)
  )

// Logger.layer *replaces* the installed loggers. Provide it outside the OTLP layer (whose logger merges
// onto whatever is installed); provided inside, it would silently drop the OTLP log exporter.
const Logging = Layer.mergeAll(
  Logger.layer([Logger.consoleJson]),
  Layer.succeed(References.MinimumLogLevel, "Info")
)

const main = Effect.gen(function*() {
  const checkout = yield* Checkout
  yield* checkout.place("o-1", 4200)
}).pipe(Effect.withSpan("main"))

main.pipe(
  Effect.provide(Checkout.layer),
  Effect.provide(process.env.OTLP_FILE ? TelemetryToFile(process.env.OTLP_FILE) : Telemetry),
  Effect.provide(Logging),
  NodeRuntime.runMain
)
```

- **Exporters**: `Otlp.layerJson({ baseUrl, resource, headers? })` / `Otlp.layerProtobuf` (all three
  signals; `Otlp.layer` takes the serializer from `OtlpSerialization.layerJson | layerProtobuf`),
  `Otlp.layerFromConfig()` reads standard OTEL env config. Per-signal: `OtlpTracer.layer({ url,
  resource })`, `OtlpLogger.layer`, `OtlpMetrics.layer` (need `OtlpSerialization` + `HttpClient`).
  `PrometheusMetrics.layerHttp` serves a scrape endpoint; `PrometheusMetrics.format` renders text.
  Provide the exporter outside the app layers so spans from their construction are exported (only the
  console-logger layer goes further out — see Logging below).
- **Spans**: `Effect.fn("Service.method")` on every public fallible boundary (uniform coverage beats
  spot coverage); `Effect.withSpan(name, { attributes })` for sub-steps; `Effect.annotateCurrentSpan`,
  `Effect.annotateSpans`, `Effect.withSpanScoped`, `Effect.withParentSpan`, `Layer.withSpan`;
  `Tracer.externalSpan` to adopt a foreign parent. `References.TracerEnabled` turns tracing off.
- **Annotation policy**: entity IDs and business values (order id, amount, tenant). Not step
  progress, per-item detail in loops, internal state, PII, or secrets (`Redacted` values print as
  `<redacted>`; don't unwrap them into attributes). Avoid high-cardinality metric attributes (user id,
  request id).
- **Metrics**: `Metric.counter(name, { description?, attributes?, incremental? })`,
  `gauge`, `histogram(name, { boundaries: Metric.linearBoundaries(...) | exponentialBoundaries(...) })`,
  `summary`, `frequency`, `timer`; update with `Metric.update(m, v)` / `Metric.modify`; dimensions with
  `Metric.withAttributes(m, attrs)` (no v3 `Metric.tagged`). As combinators: `Effect.track(metric,
  mapper?)`, `trackSuccesses`, `trackErrors`, `trackDefects`, `trackDuration` (work as `Effect.fn`
  post-arguments). Read back with `Metric.value(m)` / `Metric.snapshot`.
- **Logging**: `Effect.log/logDebug/logInfo/logWarning/logError` with `Effect.annotateLogs` and
  `Effect.withLogSpan`. Loggers: `Logger.consolePretty()`, `consoleJson`, `consoleLogFmt`,
  `consoleStructured`, `toFile(format, path)` (needs `FileSystem`), `batched(format, { window, flush })`,
  `Logger.make` + `withConsoleLog` for custom formats. **`Logger.layer([...])` replaces** the loggers
  installed by outer layers (probe-verified: provided inside `Otlp.layerJson` it drops the OTLP log
  exporter). Either provide it outside the exporter layer, or pass `{ mergeWithExisting: true }` (which
  also keeps the default pretty logger → duplicate console lines). Include `Logger.tracerLogger` if you
  want logs as span events. No `Logger.add/replace/json/minimumLogLevel` in v4.
- **Levels** are `Context.Reference`s: `Layer.succeed(References.MinimumLogLevel, "Warn")` or
  `Effect.provideService(effect, References.MinimumLogLevel, "Debug")`. `Logger.LogToStderr` routes
  console loggers to stderr (CLIs, stdio MCP).
- `@effect/vitest` `it.effect` installs `TestClock` — spans/timers using sleep need `TestClock.adjust`
  or `it.live`.

---

## 15. Encoding, sockets, workers

**Imports:** `import { Base64, Base64Url, EncodingError, Hex, Ini, Ndjson, SchemaBinary, Sse, Toml, Yaml } from "effect/encoding"`; `import { Socket, SocketServer } from "effect/socket"`; `import { Worker, WorkerRunner } from "effect/workers"`

```ts
import { Effect, Result, Schema, Stream } from "effect"
import { Base64, Hex, Ndjson, Yaml } from "effect/encoding"

const Event = Schema.Struct({ type: Schema.String, at: Schema.Number })

// Base64/Hex decoders return Result (no throw); bridge into Effect explicitly.
export const token = Effect.fromResult(Base64.decode(Base64.encode("hello")))
export const nonce = Hex.random(16)
export const isValidHex = (s: string) => Result.isSuccess(Hex.decode(s))

// NDJSON over a byte stream: decode/encode are Channels, used with pipeThroughChannel.
export const events = (bytes: Stream.Stream<Uint8Array>) =>
  bytes.pipe(Stream.pipeThroughChannel(Ndjson.decodeSchema(Event)()))

// Yaml / Toml / Ini.parse return `unknown` synchronously: always decode the result with a Schema.
const Config = Schema.Struct({ port: Schema.Int, hosts: Schema.Array(Schema.String) })
export const loadConfig = (text: string) =>
  Effect.try(() => Yaml.parse(text)).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Config)))
```

- **Encoding**: `Base64` / `Base64Url` / `Hex` — `encode(bytes | string)`, `decode` / `decodeString`
  → `Result<_, EncodingError>`; `Hex.random(n)`. The v3 `effect/Encoding` module is gone. `Ndjson` and
  `SchemaBinary` (`encode` / `decode` / `duplex`) are Channels for framed streams; `Sse.decode` /
  `decodeSchema` / `encoder` for Server-Sent Events. `Yaml.parse`, `Toml.parse`, `Ini.parse` return
  `unknown` and may throw — wrap in `Effect.try`, then decode with a Schema. There is no MessagePack.
- **Sockets are pull-based.** A `Socket` is a recipe: `socket.reader` (scoped) opens the connection
  and yields a reader; `socket.writer` is a scoped writer. `Socket.readerBytes` / `readerString` /
  `toStream` / `toChannel` adapt it. Every termination, even a clean close, surfaces as a `SocketError`
  (`reason`: Open/Read/Write/Close/Upgrade). Reconnect by retrying the whole scoped acquire-and-consume,
  never an already-acquired reader. `Socket.makeWebSocket(url)` needs a `WebSocketConstructor`
  (`Socket.layerWebSocketConstructorGlobal`, or `NodeSocket`); TCP via `NodeSocket.makeNet`; servers via
  `SocketServer` + `NodeSocketServer`. TCP UTF-8 text: byte stream + `Stream.decodeText`, since
  `readerString` decodes per frame. (Socket names checked in d.ts; behaviour not probed.)
- **Workers**: `Worker.WorkerPlatform` / `Worker.Spawner` (`NodeWorker.layer`, `BunWorker`,
  `BrowserWorker`) on the host side, `WorkerRunner.WorkerRunnerPlatform` (`NodeWorkerRunner.layer`) in
  the worker. In practice pair them with RPC: `RpcClient.layerProtocolWorker` +
  `RpcServer.layerProtocolWorkerRunner`, which needs no serialization layer. (Wiring unverified; check
  `effect/rpc/RpcWorker` before writing it.)
