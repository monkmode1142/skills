# effect

A Claude Code plugin with one model-invoked skill, [`effect`](./skills/effect/SKILL.md), for writing, reviewing, testing, and migrating **Effect v4** (`effect@4.0.0`) TypeScript.

It covers services and Layers, Schema, typed errors and `Cause`, fibers, streams, scheduling, runtime wiring, and the platform modules: HTTP, HttpApi, RPC, SQL, CLI, AI/MCP, cluster, workflow, persistence, and observability. It corrects the v3- and RC-shaped reflexes most models write by default, and points the agent at the docs Effect ships inside `node_modules/effect`.

## Install

```sh
claude plugin marketplace add aulneau/skills
claude plugin install effect@aulneau-skills
```

For other agents, `bunx skills add aulneau/skills --skill effect` installs the skill alone.

## References

The skill routes to these by task:

| File | Covers |
|---|---|
| [primitives.md](./skills/effect/references/primitives.md) | The root primitive catalog, so agents use Effect's built-ins instead of hand-rolling retries, caches, and queues |
| [modules.md](./skills/effect/references/modules.md) | Sub-barrel modules and companion packages |
| [architecture.md](./skills/effect/references/architecture.md) | Services, Layers, dependency injection, and application architecture |
| [schema.md](./skills/effect/references/schema.md) | Schema v4 |
| [errors.md](./skills/effect/references/errors.md) | Typed failures, defects, `Cause`, and recovery |
| [concurrency.md](./skills/effect/references/concurrency.md) | Concurrency, resources, streams, and scheduling |
| [platform.md](./skills/effect/references/platform.md) | Platform subsystems (HTTP, SQL, CLI, AI, cluster, and the rest) |
| [testing.md](./skills/effect/references/testing.md) | `@effect/vitest`, `TestClock`, and running on `bun:test` |
| [review.md](./skills/effect/references/review.md) | Reviewing Effect code: the procedure, the hand-roll catalog, and the Effect-expert seat |
| [migration.md](./skills/effect/references/migration.md) | Migrating to 4.0.0 from v3 or an RC |
| [v4-catalog.md](./skills/effect/references/v4-catalog.md) | Idioms, near-twins, migration tables, and behavior traps |

## Checking the examples

Every ```` ```ts ```` block in the skill compiles against a pinned `effect@4.0.0` toolchain, so the skill can't drift from the real API. CI runs it on every change under `plugins/effect/`.

```sh
(cd plugins/effect/scripts/effect-examples && npm ci)   # once
node plugins/effect/scripts/check-effect-examples.mjs   # or pass specific .md files
```

Blocks fenced as ```` ```ts nocheck ```` (anti-patterns, v3 "before" code) are skipped.
