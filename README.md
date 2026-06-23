# aulneau-skills

Agent skills for [Claude Code](https://claude.com/claude-code). Each skill is a `SKILL.md` (plus
optional reference files) that Claude loads on demand when the task matches its description.

## Skills

### Engineering

**Model-invoked** (Claude triggers these automatically when relevant):

- [effect](./skills/engineering/effect/SKILL.md) — writing or reviewing **Effect v4** (`effect@beta`,
  the effect-smol rewrite) TypeScript: services, Layers, Schema, Streams, error channels, runtime
  wiring, and how to structure an Effect codebase. Corrects the v3-shaped reflexes most models write
  by default.

## Install

These install with [`skills`](https://github.com/vercel-labs/skills), the open agent-skills CLI — no
clone or setup:

```sh
# add to whichever coding agents you have installed (prompts if none are detected)
bunx skills add aulneau/skills

# install globally, into ~/.claude/skills
bunx skills add aulneau/skills -g

# preview a skill without installing — pipe it straight into an agent
bunx skills use aulneau/skills --skill effect --agent claude-code
```

The CLI auto-discovers every `SKILL.md` under `skills/` (and reads `.claude-plugin/plugin.json`, which
lists them explicitly), then installs into your agent's skills directory (e.g. `~/.claude/skills`).

## Layout

```
skills/<bucket>/<skill-name>/SKILL.md   # the skill; reference files live beside it (e.g. references/)
.claude-plugin/plugin.json              # plugin manifest listing the skills
```

See [CLAUDE.md](./CLAUDE.md) for the bucket conventions.

## License

[MIT](./LICENSE)
