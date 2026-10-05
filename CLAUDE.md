Skills are organized into bucket folders under `skills/`:

- `engineering/` — daily code work
- `productivity/` — daily non-code workflow tools
- `misc/` — kept around but rarely used
- `in-progress/` — drafts not yet ready to ship
- `deprecated/` — no longer used

Every skill in `engineering/`, `productivity/`, or `misc/` must have a reference in the top-level
`README.md` and an entry in `.claude-plugin/plugin.json`. Skills in `in-progress/` and `deprecated/`
must not appear in either.

Each skill lives in its own folder as `skills/<bucket>/<name>/SKILL.md`, with reference files beside
it (typically under a `references/` subfolder). The folder name, the `SKILL.md` frontmatter `name`,
and the plugin manifest entry must agree.

Each `SKILL.md` is either **user-invoked** (`disable-model-invocation: true`, reachable only by the
human via `/<name>`) or **model-invoked** (Claude triggers it automatically from its description).
Group entries in the READMEs under those two headings.

## Plugins

`.claude-plugin/marketplace.json` lists every installable plugin. The root plugin (`source: "./"`) is the
bucketed skills above, declared in `.claude-plugin/plugin.json`. A self-contained plugin lives in
`plugins/<name>/` with its own `.claude-plugin/plugin.json`, `skills/<skill>/SKILL.md`, `agents/`, README,
and LICENSE, and gets one entry in `marketplace.json` and one in the README's Plugins section. Its skills
stay out of the bucket READMEs and the root `plugin.json`. Run `claude plugin validate .` and
`claude plugin validate plugins/<name>` after any manifest change.

The effect plugin's code examples are typechecked in CI (`.github/workflows/effect-examples.yml`). Run
`node plugins/effect/scripts/check-effect-examples.mjs` after editing them, once
`npm ci` has run in `plugins/effect/scripts/effect-examples`. Fence a block that is meant to be wrong or
partial as ```` ```ts nocheck ````. CI also runs `bun test plugins/effect/scripts/check-effect-map.test.ts`.

pstack stays language-neutral: Effect guidance belongs in `plugins/effect/skills/effect/references/pstack.md`, never in `plugins/pstack/`.
