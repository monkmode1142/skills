# Effect v4 sub-barrel modules and companion packages

Snapshot: effect 4.0.0 (tag effect@4.0.0, 67ba4e4), 2026-10-03.

Every module of the 19 `effect/<area>` sub-barrels (210 modules), then the `@effect/*` companion
packages and the packages you must not install. One line each: what it is, when to reach for it.
Root-barrel modules (`Effect`, `Layer`, `Schema`, `FileSystem`, …) are in `references/primitives.md`;
treat both files as one capability surface.

## Contents

- [Stability model](#stability-model)
- [Import shape](#import-shape)
- Sub-barrels: [ai](#effectai) · [cli](#effectcli) · [cluster](#effectcluster) · [devtools](#effectdevtools) · [encoding](#effectencoding) · [eventlog](#effecteventlog) · [http](#effecthttp) · [http-api](#effecthttp-api) · [net](#effectnet) · [observability](#effectobservability) · [persistence](#effectpersistence) · [process](#effectprocess) · [reactivity](#effectreactivity) · [rpc](#effectrpc) · [schema](#effectschema) · [socket](#effectsocket) · [sql](#effectsql) · [workflow](#effectworkflow) · [workers](#effectworkers)
- [Companion packages](#companion-packages)
- [Do-not-install list](#do-not-install-list)

## Stability model

- Every module below is tagged `@stability unstable`. That means **the API may change in a minor
  release** — not "not production ready". Arnaldi: "unstable means the api might change, not that
  it's not ready for prod." APIs without the tag follow semver.
- Consequences: pin `effect` and all `@effect/*` to the same exact version, read the CHANGELOG and
  re-typecheck on every upgrade, keep usage behind your own service boundary where churn would hurt.
- Never pick a worse abstraction, or hand-roll something Effect ships (HTTP client, SQL, RPC,
  retries-with-persistence, MCP), just to avoid the tag. If a root module and a sub-barrel module are
  genuinely equivalent, prefer the root one for lower upgrade cost.
- APIs that expose a third-party dependency are also unstable for that reason (`NodeRedis`,
  `@effect/platform-node/Undici`, `ws` options, driver-specific SQL options, `@effect/ai-*` generated
  provider schemas, `@effect/opentelemetry`, the `vitest` re-export in `@effect/vitest`).
- Path history: through rc.117 these lived at `effect/unstable/<area>`. rc.118 moved them to
  `effect/<area>` with **no compatibility exports**, and renamed `httpapi` → **`http-api`** (TypeIds and
  service keys moved too). Any `effect/unstable/...` import is a v4-RC leftover; fix the path.
- Deltas vs rc.112: `ai` +`Decision`, +`DecisionModel`; `encoding` +`Base64`, +`Base64Url`, +`Hex`,
  +`EncodingError` (from root `Encoding`), −`Msgpack` (MessagePack removed; use `SchemaBinary`);
  `http` +`Mime` as a barrel export; `schema` +`SchemaAOTCompiler`, +`SchemaCompiler`,
  +`SchemaJITCompiler`; new barrel `net`; `arbitrary` barrel gone (now root `Arbitrary`).

## Import shape

Import namespaces from the barrel: `import { HttpClient } from "effect/http"`. Deep paths
(`effect/http/HttpClient`) also resolve and only matter for CLI cold-start trimming. Platform
implementations come from `@effect/platform-*`.

```ts
import { Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"

const Todo = Schema.Struct({ id: Schema.Number, title: Schema.String })

const getTodo = Effect.fn("Todos.get")(function* (id: number) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const response = yield* client.get(`https://jsonplaceholder.typicode.com/todos/${id}`)
  return yield* HttpClientResponse.schemaBodyJson(Todo)(response)
})

export const program = getTodo(1).pipe(Effect.provide(FetchHttpClient.layer))
```

## `effect/ai`

`import { LanguageModel, Tool, Toolkit, Prompt } from "effect/ai"` — provider-neutral AI; providers
are `@effect/ai-*` layers.

- `AiError` — one AI failure type with a `reason` (transport, provider response, rate limit, auth, content policy, invalid output, tool errors). Handle with `catchReason`/`catchTag` at the AI boundary.
- `AnthropicStructuredOutput` — Schema → Anthropic's JSON Schema subset plus a response codec. Use for Anthropic-native structured output; normally invoked by the provider layer.
- `Chat` — stateful conversation service keeping prompt history across `generateText`/`streamText`/`generateObject`. Use when turns share context; `LanguageModel` for single calls.
- `Decision` — declares named classification / rating / probability decisions over one schema input (`make`). Use with `DecisionModel.decide` for batched judgments.
- `DecisionModel` — provider-neutral structured-decision service: one call answers all decisions, validated. Use for classifiers/graders instead of hand-built structured prompts (providers: OpenRouter, TypeSafe).
- `EmbeddingModel` — single and ordered-batch text embeddings. Use behind retrieval, similarity, clustering.
- `IdGenerator` — replaceable id generation for tool calls and response parts. Use to make AI ids deterministic in tests.
- `LanguageModel` — the main service: `generateText`, `streamText`, `generateObject`, tool resolution. Code against it to stay vendor-neutral.
- `McpProtocol` — protocol implementations an `McpServer` can speak. Use when picking/supplying an MCP transport.
- `McpSchema` — schemas for MCP JSON-RPC messages (versions 2024-11-05 … 2026-07-28). Use for custom MCP clients/adapters.
- `McpServer` — registers tools, resources, templates, prompts, completions, notifications and runs an MCP server (stdio/HTTP). Use to expose an Effect app as an MCP server.
- `Model` — a provider layer plus provider/model name in context. Use to package a configured model so telemetry and `ExecutionPlan` fallbacks know what is active.
- `OpenAiStructuredOutput` — Schema → OpenAI structured-output JSON Schema subset plus codec. Use for OpenAI-compatible structured generation.
- `Prompt` — provider-neutral messages and content parts (system/user/assistant/tool, files, reasoning, approvals). Use to build inputs portably.
- `Response` — typed output parts (text, reasoning, tool calls/results, files, sources, finish) for complete and streamed responses. Use to consume output uniformly.
- `ResponseIdTracker` — remembers provider response ids and the prompt prefix already sent. Use with APIs that continue from `previousResponseId`.
- `Telemetry` — OpenTelemetry `gen_ai.*` span attributes and span transformers. Use when instrumenting providers or enriching AI spans.
- `Tokenizer` — token counting and prompt truncation service. Use to fit prompts to model limits.
- `Tool` — schema-backed tool declarations (params, success, failure, approval; dynamic tools). Use to define what a model may call.
- `Toolkit` — a set of `Tool`s plus typed handlers (`toLayer`). Use to expose and execute an app's tool surface.

## `effect/cli`

`import { Argument, Command, Flag } from "effect/cli"` — typed CLIs; run with a platform `runMain`
and `NodeServices.layer`.

- `Argument` — typed positional parameters (optional, repeated, schema-validated, prompted). Use for ordered inputs after the command name.
- `CliConfig` — parser/help behaviour configuration for a command tree. Use to tune parsing application-wide.
- `CliError` — structured parse, usage, and handler failures. Use to inspect or render invocation errors.
- `CliOutput` — formatters for help, errors, version text (no I/O). Use to customize rendering.
- `Command` — builder/runner for flags, arguments, subcommands, aliases, examples, wizard mode, handlers. The entry point of an Effect CLI.
- `Completions` — Bash/Zsh/Fish completion scripts from a `Command`. Use to ship shell completion.
- `Flag` — named typed options (aliases, defaults, choices, secrets, files, key=value, repetition). Use for `--port`, switches, paths.
- `GlobalFlag` — action or setting flags inherited across the tree. Use for `--help`/`--version` actions or shared settings like `--log-level`.
- `HelpDoc` — structured help-document model. Use to inspect or generate custom docs.
- `Param` — shared model behind `Argument`/`Flag`. Use when extending parameter behaviour; declare with `Argument`/`Flag`.
- `Primitive` — string → value parsers for params. Use to add a new atomic input type.
- `Prompt` — interactive terminal prompts (text, password, select, multi-select, file, list, confirm, custom). Use for interactive input; runs on `Terminal`.

## `effect/cluster`

`import { Entity, Sharding, Singleton } from "effect/cluster"` — distributed, durable entities over
sharded runners. Single-node durable workflows: `SingleRunner`.

- `ClusterCron` — `Cron` schedule as a Layer with exactly one cluster-wide owner per occurrence. Use for distributed scheduled jobs.
- `ClusterError` — routing, runner, serialization, persistence, mailbox-full, duplicate-envelope errors. Handle at cluster client/infra boundaries.
- `ClusterMetrics` — gauges for entities, singletons, runners, healthy runners, shards. Use to observe cluster capacity.
- `ClusterSchema` — annotations adding persistence, transactions, interruption, tracing, shard-group routing to RPC/entity schemas. Use when defining clustered contracts.
- `ClusterWorkflowEngine` — durable `WorkflowEngine` backed by sharding + message storage. Use for workflows that must survive runner moves/restarts.
- `DeliverAt` — protocol for payloads that carry their own delivery time. Use for delayed messages.
- `Entity` — addressable sharded RPC entity (`make`, `toLayer`, sharded `client`). Use for stateful/durable work keyed by id across nodes.
- `EntityAddress` — entity type + id + shard. Use where storage, messages, and ownership need one identity.
- `EntityId` — branded string id of one entity instance. Use as the routing key.
- `EntityProxy` — derives RPC and HttpApi groups that proxy to entities. Use to expose entities through normal clients/routes.
- `EntityProxyServer` — handlers/layers for `EntityProxy` groups. Use to mount them.
- `EntityResource` — resources that survive routine entity restarts and shard movement (processes, pods, clients). Use for long-lived per-entity handles.
- `EntityType` — branded entity family name. Use to namespace entity routing.
- `Envelope` — request/ack/interrupt envelopes. Use when implementing storage or transport adapters.
- `HttpRunner` — runner-to-runner RPC over HTTP/WebSocket. Use to connect runners via HTTP infra (platform wrappers: `NodeClusterHttp`, `BunClusterHttp`).
- `K8sHttpClient` — in-cluster Kubernetes API client using the service-account token. Use for pod/health management from k8s workloads.
- `K8sTypes` — vendored Kubernetes Pod types. Use with `K8sHttpClient`.
- `MachineId` — branded runner number. Use in Snowflake generation.
- `Message` — incoming/outgoing request and control message shapes. Use in storage/transport code.
- `MessageStorage` — pluggable durable mailbox + reply storage. Use to make entity requests recoverable and deduplicated.
- `Reply` — final `WithExit` or streaming `Chunk` replies. Use at execution/storage/transport boundaries.
- `Runner` — runner metadata (address, shard groups, weight). Use in registration and allocation.
- `RunnerAddress` — host/port with Schema, hash, primary key. Use wherever runners are stored or dialled.
- `RunnerHealth` — health-check service (no-op, ping, k8s). Use so sharding moves shards off dead runners.
- `RunnerServer` — layer serving the runner protocol by forwarding to `Sharding`/`MessageStorage`. Use on shard-hosting processes.
- `RunnerStorage` — runner registration, health, machine ids, shard locks. The coordination store for membership.
- `Runners` — client side of runner communication (ping, send, notify, unavailable tracking). Used by `Sharding`.
- `ShardId` — shard group + number with stable serialization. Use as the ownership/routing address.
- `Sharding` — central service: entity/singleton registration, shard ownership, routing, clients, registration events. Use to run a cluster node.
- `ShardingConfig` — runner address, shard groups/counts, lock timing, mailbox/memory limits, polling, serialization. Use to configure a participant (`layerFromEnv` style).
- `ShardingRegistrationEvent` — live events for locally registered entities/singletons. Use for startup coordination and tests.
- `SingleRunner` — one-process cluster: no-op transport/health, SQL message storage, SQL or in-memory runner storage. Use for embedded or single-node durable entities/workflows.
- `Singleton` — Layer running an effect with exactly one active owner cluster-wide. Use for leaders and singleton background jobs.
- `SingletonAddress` — singleton name + shard. Use in registration events/ownership tracking.
- `Snowflake` — sortable bigint ids (time, machine, sequence). Use for distributed ids.
- `SocketRunner` — runner over the socket RPC protocol via a `SocketServer`. Use for TCP/Unix-socket clusters (`NodeClusterSocket`).
- `SqlMessageStorage` — SQL `MessageStorage`. Use when mailboxes belong in your relational DB.
- `SqlRunnerStorage` — SQL `RunnerStorage` with advisory locks where supported. Use for multi-process coordination through SQL.
- `TestRunner` — in-memory sharding + storage + always-healthy runners. Use to test entities without servers.

## `effect/devtools`

`import { DevTools } from "effect/devtools"`

- `DevTools` — layers that mirror the current tracer and stream spans, events, and metric snapshots to Effect devtools (`DevTools.layer()`). Use in development to attach a runtime to the VS Code/devtools UI.
- `DevToolsClient` — client service sending telemetry over a socket. Use to customize transport.
- `DevToolsSchema` — wire schemas for spans, events, metrics, heartbeats. Use for custom protocol adapters.
- `DevToolsServer` — server side of the devtools socket protocol. Use to accept devtools clients in a custom host.

## `effect/encoding`

`import { Base64, Hex, Ndjson, Sse } from "effect/encoding"` — textual/binary codecs (replaces root
`Encoding`).

- `Base64` — `encode`/`decode` (decode returns `Result<Uint8Array, EncodingError>`). Use for standard Base64.
- `Base64Url` — URL-safe Base64. Use for tokens, JWT segments, URL-embedded bytes.
- `EncodingError` — shared decode error and `isEncodingError`. Use to name/narrow failures from any encoding module.
- `Hex` — hex encode/decode and `Hex.random` (was `randomHex`). Use for digests and ids as hex.
- `Ini` — INI parser. Use for INI config files (used by `effect/cli`).
- `Ndjson` — newline-delimited JSON channel codecs, optionally schema-checked. Use for record-at-a-time streaming over bytes/strings.
- `SchemaBinary` — compact, evolution-aware binary codec derived from a schema's encoded side; default cluster wire format. Use for schema-aware storage/transport framing (replaces MessagePack).
- `Sse` — Server-Sent Events parse/render plus schema helpers. Use for one-way HTTP event streams.
- `Toml` — TOML parser. Use for TOML config.
- `Yaml` — YAML 1.2 parser (anchors, aliases, block scalars). Use for YAML config without a parser dependency.

## `effect/eventlog`

`import { Event, EventGroup, EventLog } from "effect/eventlog"` — event-sourced local-first logs with
optional (encrypted) replication.

- `Event` — durable typed event contract (tag, payload/success/error schemas, primary key). The unit of the model.
- `EventGroup` — related events; derives clients and handler layers. Use per event domain.
- `EventJournal` — committed entries, replay, change stream, remote replication state (in-memory, IndexedDB via browser pkg). The storage seam.
- `EventLog` — runtime: groups + handlers + journal + identity + remotes + reactivity. Use to write events and drive projections.
- `EventLogEncryption` — encrypt/decrypt/hash entries and create identities. Use when remotes must not see plaintext.
- `EventLogMessage` — hello/auth/write/changes/error protocol. Use in replication transports.
- `EventLogRemote` — a remote replica: push local entries, stream remote changes. Use to sync a journal.
- `EventLogServer` — transport-independent server handlers and identity auth middleware. Use to host a replication endpoint.
- `EventLogServerEncrypted` — encrypted replication server + `Storage` contract. Use for zero-plaintext sync servers.
- `EventLogServerUnencrypted` — plaintext server that runs registered handlers. Use in trusted deployments, dev, tests.
- `EventLogSessionAuth` — challenge-response signing for replication sessions. Use to prove key ownership.
- `SqlEventJournal` — SQL-backed `EventJournal`. Use for durable local history.
- `SqlEventLogServerEncrypted` — SQL storage for the encrypted server. Use when ciphertext lives in a relational DB.
- `SqlEventLogServerUnencrypted` — SQL storage for the plaintext server. Use for trusted server-side storage and replay.

## `effect/http`

`import { HttpClient, HttpRouter, HttpServerResponse } from "effect/http"` — client and server. Server
implementations: `NodeHttpServer`, `BunHttpServer`, `DenoHttpServer`; clients: `FetchHttpClient`,
`NodeHttpClient`, `BrowserHttpClient`.

- `Cookies` — immutable cookie collections, Cookie/Set-Cookie parse/render. Use for cookie handling (cookie *schemas* live in `Schema`).
- `Etag` — entity tags and generator layers. Use for conditional requests/revalidation.
- `FetchHttpClient` — `HttpClient` over Web `fetch` (`FetchHttpClient.layer`). Use in browsers, edge, Bun/Deno/Node ≥18 when fetch suffices.
- `FindMyWay` — radix-tree router config. Use when tuning route matching.
- `Headers` — immutable lowercase header maps with redaction. Use across client/server boundaries.
- `HttpBody` — body variants (empty, raw, bytes, text/JSON, form, stream, file). Use to build requests/responses portably.
- `HttpClient` — outgoing request service plus combinators (`filterStatusOk`, retries, rate limiting, `mapRequest`, tracing). Inject it; never call `fetch` directly.
- `HttpClientError` — request/transport/status/decode failures. Map to domain errors at the adapter edge.
- `HttpClientRequest` — immutable request builder and body encoders (`bodyJson`, `setHeaders`, …). Use before executing.
- `HttpClientResponse` — status/headers/cookies/body plus decoders (`schemaBodyJson`, `matchStatus`). Use to consume responses.
- `HttpEffect` — runs a response effect at a Web/host boundary (`Request => Response`). Use to adapt an Effect HTTP app to another server API.
- `HttpIncomingMessage` — shared headers/address/body access. Use when writing body decoders or adapters.
- `HttpMethod` — method literals (incl. `QUERY`) and guards. Use for typed method logic.
- `HttpMiddleware` — app-to-app wrappers (logger, tracing, CORS, x-forwarded, compression hooks). Use for cross-cutting server concerns.
- `HttpPlatform` — platform file responses (ranges, Web `File`). Use to serve files without host code.
- `HttpRouter` — route + middleware registration (`HttpRouter.add`, `serve`, prefixes, layers). Use to build a server directly from routes; `effect/http-api` when you want a typed contract.
- `HttpServer` — concrete server service, `serve`, address, test-client helpers (`layerTestClient`). Use with a platform layer.
- `HttpServerError` — accept/route/handler/response failures. Use at raw server boundaries.
- `HttpServerRequest` — current-request service (method, URL, headers, body, multipart, upgrade, schema decoders). Use inside handlers/middleware.
- `HttpServerRespondable` — protocol for values/errors that render as responses. Use when a domain error owns its HTTP form.
- `HttpServerResponse` — immutable responses (`json`, `text`, `stream`, `file`, cookies). Return from handlers.
- `HttpStaticServer` — static files with caching, ranges, index, SPA fallback. Use to mount assets/frontends.
- `HttpStatus` — named status code mapping (`fromLiteral`). Use instead of magic numbers.
- `HttpTraceContext` — trace propagation to/from headers. Use in custom client/server middleware.
- `Mime` — built-in MIME lookup (replaces the `mime` dependency and `@effect/platform-node/Mime`). Use for content types.
- `Multipart` — multipart parsing, streaming uploads, scoped file persistence, schema decoding. Use for form-data handlers.
- `MultipartParser` — low-level multipart byte parser. Use when implementing a platform parser.
- `Template` — template literals interpolating values, Options, Effects, Streams. Use to build dynamic text/HTML responses.
- `Url` — safe `URL` parsing and immutable edits. Use for URL manipulation.
- `UrlParams` — ordered query/form pairs with schema decoding. Use for query strings and urlencoded bodies.

## `effect/http-api`

`import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"` — one
schema contract → server, client, OpenAPI. Was `effect/unstable/httpapi`.

- `HttpApi` — top-level API value: groups of endpoints plus annotations. The contract root.
- `HttpApiBuilder` — registers an `HttpApi` on an `HttpRouter`; `group(...)` handler layers. Use to implement the contract.
- `HttpApiClient` — derived typed client (`HttpApiClient.make(Api, { baseUrl })`). Use so callers share server schemas.
- `HttpApiEndpoint` — one method/path/params/payload/success/error/headers declaration. The contract unit.
- `HttpApiError` — built-in status errors (`BadRequest`, `NotFound`, `Unauthorized`, …). Use for standard failure responses.
- `HttpApiGroup` — named collection of endpoints. Organize by resource/feature.
- `HttpApiMiddleware` — typed server/client middleware, incl. security middleware providing services. Use for auth, tenancy, logging at contract level.
- `HttpApiScalar` — mounts Scalar API reference UI. Use for browsable docs.
- `HttpApiSchema` — schema annotations for status, encoding, multipart, streaming/SSE, empty bodies. Use to shape HTTP representation.
- `HttpApiSecurity` — bearer, basic, API-key declarations. Describes credential transport; middleware authenticates.
- `HttpApiSwagger` — mounts Swagger UI (default `/docs`). Use for interactive OpenAPI docs.
- `HttpApiTest` — in-memory client for selected groups with real encoding/routing/middleware. Use to test APIs without a port.
- `OpenApi` — OpenAPI 3.1 generation and annotations (`fromApi`, identifiers, summaries). Use to emit/customize the spec.

## `effect/net`

`import { NetAddress, IpNetwork } from "effect/net"` — pure, platform-neutral network values (new in
4.0.0). Matching codecs are the unstable `Schema.Ipv4Address`, `Schema.IpNetwork`, … schemas.

- `IpInterface` — IPv4/IPv6 interface address that keeps host bits plus prefix length. Use for configured interface addresses (`10.0.0.5/24`).
- `IpNetwork` — canonical CIDR network prefixes with containment checks. Use for allow-lists, subnet math.
- `NetAddress` — MAC, IP, internet socket, and Unix path addresses with guards, constructors, equality, canonical strings, URL formatting. Use instead of raw strings for addresses.

## `effect/observability`

`import { Otlp } from "effect/observability"` — dependency-free OTLP/Prometheus export. Prefer this
over `@effect/opentelemetry` for new work unless you need the OTel SDK itself.

- `Otlp` — one layer wiring OTLP logs, metrics, traces from shared config (honours standard `OTEL_*` env). The default for exporting to a collector/vendor.
- `OtlpExporter` — shared batching, retry, disable, final flush. Use when building a custom signal exporter.
- `OtlpLogger` — `Logger` exporting log records with trace correlation. Use for logs only.
- `OtlpMetrics` — periodic metric export (cumulative/delta temporality). Use for metrics only.
- `OtlpResource` — service/resource attributes on exported telemetry. Use to identify app, env, host.
- `OtlpSerialization` — JSON or protobuf payload serialization. Use when choosing/implementing the wire format.
- `OtlpTracer` — `Tracer` exporting sampled spans over OTLP/HTTP. Use for traces only.
- `PrometheusMetrics` — Prometheus text rendering and optional scrape route. Use for pull-based metrics.

## `effect/persistence`

`import { KeyValueStore, PersistedCache, PersistedQueue, RateLimiter } from "effect/persistence"`

- `KeyValueStore` — string/binary KV service with schema-typed views; memory, filesystem, and platform layers (browser storage, Deno KV). Use for lightweight durable state.
- `Persistable` — request classes with primary key + success/error schemas. Use to make results storable.
- `PersistedCache` — in-memory `Cache` backed by a `Persistence` store. Use to reuse expensive/idempotent results across restarts.
- `PersistedQueue` — durable queue of schema-encoded work processed one item at a time in a scope (retries, multi-worker; memory/SQL/Redis backends). Use for jobs, outboxes, durable handoffs.
- `Persistence` — named stores of encoded `Exit`s with TTL (memory, KV, Redis, SQL). Use for backend-neutral durable memoization.
- `RateLimiter` — fixed-window and token-bucket limits on shared storage (memory/Redis). Use for quotas across fibers or processes; `Semaphore` for local concurrency caps.
- `Redis` — Redis service contract, pub/sub, Lua helpers; implement with `NodeRedis`/`BunRedis`/`DenoRedis`. Use to back persistence modules with Redis.

## `effect/process`

`import { ChildProcess, ChildProcessSpawner } from "effect/process"`

- `ChildProcess` — immutable command descriptions (`make`, `pipeTo`, `setCwd`, `setEnv`, stdio config). Use to describe subprocesses instead of calling `node:child_process`.
- `ChildProcessSpawner` — the service that starts and controls processes: `spawn(command)` returns a scoped handle (`exitCode`, `stdout`, `stderr`, `all` streams) plus string/line helpers. Provided by `NodeChildProcessSpawner.layer` (included in `NodeServices.layer`); fake it in tests.

## `effect/reactivity`

`import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity"` — framework-agnostic reactive
state; UI bindings are `@effect/atom-*`.

- `AsyncResult` — Initial/Success/Failure plus `waiting` flag, retaining prior values during refresh. Use to model query state in UIs.
- `Atom` — reactive values from pure functions, Effects, Streams, writables, families, `Atom.fn` actions, SWR. The building block of reactive state.
- `AtomHttpApi` — `HttpApi` client exposed as query/mutation atoms with invalidation. Use to bind typed HTTP endpoints to UI.
- `AtomRef` — standalone observable refs without a registry. Use for simple local reactive state.
- `AtomRegistry` — evaluates, caches, tracks deps, subscribes, disposes atoms. One per independent reactive runtime.
- `AtomRpc` — RPC client exposed as query/mutation atoms incl. streams. Use to bind RPC to UI.
- `Hydration` — dehydrate/hydrate serializable atom state. Use for SSR and state transfer.
- `Reactivity` — process-local invalidation keys and rerun hooks (`mutation`, `query`, `invalidate`). Use to connect writes to dependent reads (SQL client integrates it); not a value cache.

## `effect/rpc`

`import { Rpc, RpcGroup, RpcClient, RpcServer } from "effect/rpc"` — schema-first RPC over HTTP,
WebSocket, sockets, workers, stdio.

- `Rpc` — one procedure: tag, payload, success, error, defect schemas, streaming flag, middleware. The transport-independent unit.
- `RpcClient` — typed client from a group over a `Protocol` (HTTP, socket, worker). Use to call remote handlers.
- `RpcClientError` — protocol/transport failures outside declared errors. Use to distinguish "call failed" from remote business errors.
- `RpcGroup` — collection of Rpcs with `toLayer`/handler helpers and group annotations. Define and implement one protocol.
- `RpcMessage` — request/response/chunk/ack/interrupt envelopes, encoded and decoded. Use in transport/serializer code.
- `RpcMiddleware` — server (and optional client) middleware with declared errors and provided services. Use for auth, tenancy, headers.
- `RpcSchema` — stream and interruption schema markers. Use when extending RPC metadata.
- `RpcSerialization` — JSON, NDJSON, JSON-RPC 2.0, SchemaBinary framings. Pick a wire format (MessagePack was removed).
- `RpcServer` — decodes requests, runs handlers, streams, acks, interrupts; supports server-originated requests/notifications. Serve a group over a `Protocol`.
- `RpcTest` — in-memory client↔server without serialization. Use to test handlers and middleware.
- `RpcWorker` — initial-message schema and transferables for worker-backed protocols. Use when a worker needs setup data.
- `Utils` — buffered receive-loop helper for protocol services. Use when writing a custom `Protocol`.

## `effect/schema`

`import { Model, VariantSchema } from "effect/schema"` — note lowercase barrel; the core `Schema` is root.

- `Model` — one field declaration → `select`/`insert`/`update`/`json`/`jsonCreate`/`jsonUpdate` variants (`Model.Class`, `GeneratedByDb`, `GeneratedByApp`, `Sensitive`, `DateTimeInsert`, `UuidV7Insert`, …). Use for entities that span DB rows and API shapes; pairs with `SqlModel`.
- `SchemaAOTCompiler` — generates a module of ahead-of-time compiled decoders (`compile(targets)`, plus a `Build` entrypoint) that installs without `new Function`. Use for CSP-restricted or startup-critical environments.
- `SchemaCompiler` — the shared decoder registry consumed transparently by `SchemaParser`. Use when installing decoders manually.
- `SchemaJITCompiler` — lazy JIT compilation per AST (`enable(ast)`) or globally via side-effect import `effect/schema/SchemaJITCompiler/enable`; falls back to the interpreter if `new Function` is blocked. Use for hot decode paths.
- `VariantSchema` — related named variants from shared and conditional fields. Use when several closely related schemas must stay in sync (what `Model` is built on).

## `effect/socket`

`import { Socket, SocketServer } from "effect/socket"`

- `Socket` — bidirectional connection with a pull-based `reader` (backpressure) and scoped `writer`; TLS `upgrade` (STARTTLS) where the transport supports it; WebSocket/TCP adapters. Use for raw socket protocols; v3 `run*` APIs are gone.
- `SocketServer` — accept loop handing each connection to a handler (`NodeSocketServer`, `BunSocketServer`). Use to serve TCP/Unix/WebSocket connections.

## `effect/sql`

`import { SqlClient, SqlSchema, Migrator } from "effect/sql"` — drivers are `@effect/sql-*`.

- `Migrator` — ordered, recorded, transactional migrations with loaders and optional schema dumps (driver `*Migrator` modules wrap it). Use to apply schema changes at startup.
- `SqlClient` — tagged-template queries, `withTransaction`, connection reservation, dialect compilation, tracing, reactive queries. The injected DB boundary.
- `SqlConnection` — driver-facing compiled-statement execution contract. Use only when authoring a driver.
- `SqlError` — structured reasons (`UniqueViolation`, connection, auth, syntax, …) with retryability. Map to domain errors at the repository edge.
- `SqlModel` — CRUD repositories and resolvers from a `Model` (`makeRepository`, `makeResolvers`). Use for conventional table access.
- `SqlResolver` — schema-aware batched `RequestResolver`s (`findById`, `grouped`, `ordered`, `void`). Use for high-volume typed loading.
- `SqlSchema` — wraps queries with request encoding and row decoding (`findAll`, `findNonEmpty`, `findOne`, `findOneOption`, `void`). Use around hand-written SQL.
- `SqlStream` — push-producer → pull `Stream` with backpressure callbacks. Use when implementing driver streaming.
- `Statement` — parameterized fragments, identifiers, `in`/`and`/`or`/`insert`/`update` helpers, compilation. Use to build reusable dialect-safe SQL.

## `effect/workflow`

`import { Activity, Workflow, WorkflowEngine } from "effect/workflow"` — durable long-running processes
(engine: in-memory, or `ClusterWorkflowEngine` for durable).

- `Activity` — named effect with result schemas, persisted and replayed. Use for side-effecting steps (idempotency keys, external calls).
- `DurableClock` — persisted timers/sleeps. Use for waits that must survive restarts.
- `DurableDeferred` — named external completion point. Use when a workflow waits for a human/webhook/other actor.
- `DurableQueue` — delegates work to persisted background workers and resumes the workflow with the result. Use to offload steps to worker pools.
- `Workflow` — typed definition (`Workflow.make` with payload, success, error, idempotency key), execute, poll, interrupt, resume, compensation. The process definition.
- `WorkflowEngine` — registers handlers, runs/resumes executions, in-memory `layerMemory`. Use to host or test workflows.
- `WorkflowProxy` — derives RpcGroup / HttpApiGroup for workflows (execute, discard, resume). Use to expose workflows remotely.
- `WorkflowProxyServer` — `layerHttpApi` / `layerRpcHandlers` implementing those proxies. Use to mount them.

## `effect/workers`

`import { Worker, WorkerRunner } from "effect/workers"` — platform workers: `NodeWorker`, `BunWorker`,
`DenoWorker`, `BrowserWorker` (+ `*WorkerRunner`). For typed request/response, put `effect/rpc` on top
(`RpcWorker`).

- `Transferable` — schema markers that move ArrayBuffers/MessagePorts via the transfer list. Use to avoid copying large payloads.
- `Worker` — platform-neutral worker client, `WorkerPlatform`, spawner. Use to send work to browser/Node/Bun/Deno workers.
- `WorkerError` — spawn/send/receive/unknown failures. The typed boundary error for workers.
- `WorkerRunner` — worker-side receive/reply/disconnect. Use for the code running inside the worker.

## Companion packages

All companion packages are versioned in lockstep: **every `@effect/*` package must be exactly the
same version as `effect`** (4.0.0 here) — mixed versions mean duplicated runtimes and type mismatch.
Exceptions: tooling (`@effect/language-service`, `@effect/tsgo`) versions independently. Requirements:
TypeScript 5.9+ (TS 7 recommended), `strict: true`.

### Platforms

Import as `import { NodeRuntime, NodeServices } from "@effect/platform-node"`. Each provides
`*Runtime.runMain` (signal handling, exit codes, keeps the process alive — bare `Effect.runFork` does
not) and `*Services.layer` (= `ChildProcessSpawner | Crypto | FileSystem | Path | Stdio | Terminal`).

- `@effect/platform-node` — `NodeChildProcessSpawner`, `NodeClusterHttp`, `NodeClusterSocket`, `NodeCrypto`, `NodeFileSystem`, `NodeHttpClient` (`layerUndici`, `layerNodeHttp`, dispatcher/agent layers), `NodeHttpIncomingMessage`, `NodeHttpPlatform`, `NodeHttpServer` (`layer`, `layerConfig`, `layerTest`), `NodeHttpServerRequest`, `NodeMultipart`, `NodeMultipartParser`, `NodePath` (`layer`, `layerPosix`, `layerWin32`), `NodeRedis` (unstable; peer `redis`), `NodeRuntime`, `NodeServices`, `NodeSink`, `NodeSocket`, `NodeSocketServer`, `NodeStdio`, `NodeStream`, `NodeTerminal`, `NodeWorker`, `NodeWorkerRunner`; deep-import only: `@effect/platform-node/Undici` (unstable undici re-export). Use for Node apps.
- `@effect/platform-node-shared` — the Node-API implementations shared by Node and Bun: `NodeChildProcessSpawner`, `NodeClusterSocket`, `NodeCrypto`, `NodeFileSystem`, `NodeHttpCompression`, `NodePath`, `NodeRuntime`, `NodeSink`, `NodeSocket`, `NodeSocketServer`, `NodeStdio`, `NodeStream`, `NodeTerminal`. Normally a transitive dependency; import from `platform-node`/`platform-bun` instead.
- `@effect/platform-bun` — `BunChildProcessSpawner`, `BunClusterHttp`, `BunClusterSocket`, `BunCrypto`, `BunFileSystem`, `BunHttpClient`, `BunHttpPlatform`, `BunHttpServer`, `BunHttpServerRequest`, `BunMultipart`, `BunPath`, `BunRedis`, `BunRuntime`, `BunServices`, `BunSink`, `BunSocket`, `BunSocketServer`, `BunStdio`, `BunStream`, `BunTerminal`, `BunWorker`, `BunWorkerRunner`. Use for Bun apps (`Bun.serve`-backed server).
- `@effect/platform-deno` (new in v4; Deno ≥ 2.8.3) — `DenoChildProcessSpawner`, `DenoClusterHttp`, `DenoClusterSocket`, `DenoCrypto`, `DenoFileSystem`, `DenoHttpClient`, `DenoHttpPlatform`, `DenoHttpServer`, `DenoHttpServerRequest`, `DenoKeyValueStore`, `DenoMultipart`, `DenoPath`, `DenoRedis`, `DenoRuntime`, `DenoServices`, `DenoSocket`, `DenoSocketServer`, `DenoStdio`, `DenoTerminal`, `DenoWorker`, `DenoWorkerRunner`.
- `@effect/platform-browser` — `BrowserCrypto`, `BrowserHttpClient` (XHR), `BrowserKeyValueStore` (localStorage/sessionStorage/IndexedDB), `BrowserPersistence`, `BrowserRuntime`, `BrowserSocket`, `BrowserStream`, `BrowserWorker`, `BrowserWorkerRunner`, `Clipboard`, `Geolocation`, `IndexedDb`, `IndexedDbDatabase`, `IndexedDbQueryBuilder`, `IndexedDbTable`, `IndexedDbVersion`, `Permissions`. Use for browser apps; `FetchHttpClient` from `effect/http` is often enough for HTTP.

### Testing

- `@effect/vitest` (requires Vitest 5) — `it.effect` (Scope + TestClock + TestConsole), `it.live`, `it.layer`/`layer(...)`, `it.prop`/`it.effect.prop` (native `Arbitrary`), `it.flakyTest`, `describeWrapped`, `addEqualityTesters`; re-exports `vitest` (so `assert`, `expect`, `describe` come from here). `@effect/vitest/utils`: `assertEquals`, `assertTrue`, `assertSome`, `assertNone`, `assertSuccess`, `assertFailure`, `assertExitSuccess`, `assertExitFailure`, `deepStrictEqual`, `strictEqual`, `throws`, …. See `references/testing.md`.

### Observability

- `@effect/opentelemetry` (unstable; OTel SDK peers) — `NodeSdk`, `WebSdk`, `OtelTracer`, `OtelMetrics`, `OtelLogger`, `Resource`. Use only when you need the OpenTelemetry SDK (existing OTel instrumentation, SDK processors/exporters); for new work prefer `effect/observability` `Otlp*` (no dependencies).

### AI providers

Each provides a `*Client` layer (built on `HttpClient`) and model layers that satisfy `effect/ai`
services; generated provider schemas are unstable.

- `@effect/ai-anthropic` — `AnthropicClient`, `AnthropicConfig`, `AnthropicError`, `AnthropicLanguageModel`, `AnthropicTelemetry`, `AnthropicTool` (provider-defined tools), `Generated`.
- `@effect/ai-openai` — `OpenAiClient`, `OpenAiClientGenerated`, `OpenAiConfig`, `OpenAiEmbeddingModel`, `OpenAiError`, `OpenAiLanguageModel`, `OpenAiSchema`, `OpenAiTelemetry`, `OpenAiTool`, `Generated`.
- `@effect/ai-openai-compat` (new) — `OpenAiClient`, `OpenAiConfig`, `OpenAiEmbeddingModel`, `OpenAiError`, `OpenAiLanguageModel`, `OpenAiTelemetry`. Use for any OpenAI-compatible endpoint (chat completions + embeddings: vLLM, Ollama, Groq, …).
- `@effect/ai-openrouter` — `OpenRouterClient`, `OpenRouterConfig`, `OpenRouterDecisionModel`, `OpenRouterError`, `OpenRouterLanguageModel`, `OpenRouterSchema`, `Generated`.
- `@effect/ai-typesafe` (new) — `TypeSafeClient`, `TypeSafeConfig`, `TypeSafeDecisionModel`, `TypeSafeSchema`. A `DecisionModel` provider (TypeSafe System One) for classification/rating/probability.

### SQL drivers

Each exports a `*Client` (layer providing `SqlClient`) and a `*Migrator` unless noted.

- `@effect/sql-pg` — `PgClient`, `PgMigrator`, `PgPool`, `PgConnection`, `PgAuth`, `PgProtocol`, `PgTypes`. Built-in PostgreSQL wire client (pipelining, prepared statements, binary codecs); no `pg` dependency.
- `@effect/sql-sqlite-node` — `SqliteClient`, `SqliteMigrator`. Uses `node:sqlite`; Node ≥ 22.16.
- `@effect/sql-sqlite-bun` — `SqliteClient`, `SqliteMigrator` (`bun:sqlite`).
- `@effect/sql-libsql` — `LibsqlClient`, `LibsqlMigrator` (libSQL / Turso).
- `@effect/sql-mysql2` — `MysqlClient`, `MysqlMigrator`.
- `@effect/sql-mssql` — `MssqlClient`, `MssqlMigrator`, `Parameter`, `Procedure` (stored procedures).
- `@effect/sql-d1` — `D1Client` (Cloudflare D1; no migrator module).
- `@effect/sql-clickhouse` — `ClickhouseClient`, `ClickhouseMigrator` (peer `@effect/platform-node`).
- `@effect/sql-pglite` (new) — `PgliteClient`, `PgliteMigrator` (in-process Postgres; good for tests).
- `@effect/sql-sqlite-wasm` — `SqliteClient`, `SqliteMigrator`, `OpfsWorker` (browser OPFS; peer `@effect/wa-sqlite`).
- `@effect/sql-sqlite-do` — `SqliteClient`, `SqliteMigrator` (Cloudflare Durable Objects storage).
- `@effect/sql-sqlite-react-native` — `SqliteClient`, `SqliteMigrator` (peer `@op-engineering/op-sqlite`).

### UI bindings (Atom)

- `@effect/atom-react` (React 19) — hooks `useAtom`, `useAtomValue`, `useAtomSet`, `useAtomMount`, `useAtomRefresh`, `useAtomSuspense`, `useAtomSubscribe`, `useAtomInitialValues`, `useAtomRef`, `useAtomRefProp`, `useAtomRefPropValue`; `RegistryProvider`/`RegistryContext`, `HydrationBoundary`, `ScopedAtom`.
- `@effect/atom-solid` — same hook family (`useAtom`, `useAtomValue`, `useAtomSet`, `useAtomResource`, …) plus `RegistryContext`.
- `@effect/atom-vue` — re-exports `AtomRegistry`, `AsyncResult`, `Atom`, `AtomRef`, `AtomHttpApi`, `AtomRpc` plus `registryKey`/`injectRegistry` and composables.

### Code generation and tooling

- `@effect/openapi-generator` — `openapigen` CLI generating Effect `Schema` types, HTTP clients, and `HttpApi` modules from OpenAPI specs (peer `@effect/platform-node`). Use to consume third-party OpenAPI APIs.
- `@effect/language-service` (independent versioning, 0.87.x) — TS plugin + CLI diagnostics (`effect-language-service diagnostics --project tsconfig.json`), quick fixes, layer info. Use on TypeScript 5.x.
- `@effect/tsgo` (independent versioning, 0.48.x) — the language service on TypeScript-Go (TS 7): `npx @effect/tsgo setup`, use instead of plain `tsgo`; makes Effect diagnostics fail type-checking and can emit Oxlint rules.
- `@effect/doctest`, `@effect/docgen` — doc-example testing and API-doc generation used by the Effect repo; only for library authors.

## Do-not-install list

These names resolve on npm to the **v3-era 0.x** line (e.g. `@effect/platform@0.97.x`); in v4 their
contents are merged into `effect`. Installing any of them next to `effect@4` is a version-mixing bug
(duplicate, incompatible type identities). Remove them and switch imports.

| Do not install | Use instead |
|---|---|
| `@effect/platform` | root `FileSystem`/`Path`/`Stdio`/`Terminal`/`Crypto`, `effect/http`, `effect/socket`, `effect/process`, `effect/workers`, `effect/persistence` (KeyValueStore), `effect/encoding`; implementations from `@effect/platform-*` |
| `@effect/rpc` | `effect/rpc` |
| `@effect/sql` | `effect/sql` (+ an `@effect/sql-*` driver at the same version) |
| `@effect/cli` | `effect/cli` |
| `@effect/ai` | `effect/ai` (+ `@effect/ai-*` provider) |
| `@effect/cluster` | `effect/cluster` |
| `@effect/workflow` | `effect/workflow` |
| `@effect/experimental` | `effect/persistence`, `effect/reactivity`, `effect/eventlog`, `effect/devtools`, `effect/encoding` |
| `@effect/schema` | root `Schema` (+ `Schema*` modules, `effect/schema` for `Model`/compilers) |
| `@effect/ai-google`, `@effect/ai-amazon-bedrock` | removed in v4, no replacement; `@effect/ai-openai-compat` or `@effect/ai-openrouter` if the vendor exposes a compatible API |

Quick audit: `npm ls effect` must show one version, and every `@effect/*` in `package.json` must be in
the companion list above at that same version.
