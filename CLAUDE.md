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
