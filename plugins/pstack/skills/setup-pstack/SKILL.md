---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects the harness and the models it can reach, then writes ~/.agents/pstack/models.md, which overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write `~/.agents/pstack/models.md`, the per-role model file every pstack skill reads. The capability map and the default role table live in the `poteto-mode` skill's `references/harness.md`. Read it first.

## Steps

### 1. Detect the harness and its models

Name the harness you are running in (Claude Code, Codex, or other). Enumerate the model values you can pass when spawning a subagent in this session. That is the dependable source. In Claude Code these are the `Agent` tool's `model` values (`opus`, `sonnet`, `haiku`, `fable`). In Codex, the models `codex exec -m` accepts. Then check for cross-family runners on PATH (`command -v codex`, `command -v claude`). A reachable runner adds `codex` or `claude` as a valid value. Inside bb (`BB_THREAD_ID` is set), also run `bb provider list` and `bb provider models <id>` for each provider. Every listed model becomes a valid `bb:<provider>/<model>` value (see `harness.md`), which is the preferred cross-family seat because the child is a real, visible thread. If you cannot detect any model, ask the user to paste the values they have. Never write a value you have not confirmed. `inherit` is always valid.

### 2. Load current state

If `~/.agents/pstack/models.md` exists, read it and treat its `# budget` line and role values as the current choices. Otherwise start from the default table in `harness.md`. A line whose role is not in that table is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Ask the user (structured question tool if the harness has one). Offer these four options with these exact labels, and name the current budget when the file records one.

- `unlimited (strongest everywhere)`
- `large (strongest for judgment, mid tier for code)`
- `medium (mid tier everywhere, strongest for hardest tasks)`
- `small (fast tier everywhere, inherit for hardest tasks)`

**(b) Apply it.** Map tiers onto the detected models. Strongest, mid, and fast are the harness's top, middle, and cheapest model (Claude Code: `opus`, `sonnet`, `haiku`). If the harness exposes reasoning effort per model, set it from the budget too (`unlimited` max, `large` high, `medium` medium, `small` low). Keep any role the user set by hand on a re-run. `inherit` never changes. Cross-family entries (`codex`, `claude`, and `bb:` seats on another family) stay in panel lists under every budget except `small`, where they drop.

**(c) Show the roles and confirm.** Show every role with its value, marking anything not in the detected set as needing a choice. List each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected values plus `inherit`. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, so the list length sets the count. `arena cross-judge pool` is also a list, and Arena picks the entry whose family differs from the parent's when possible. `swarm workers` is the default for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every value written must be detected, `inherit`, or a reachable cross-family runner. If a chosen value is not available, stop and ask again.

A Claude Code alias (`opus`, `sonnet`, `fable`, `haiku`) can resolve to an older model than the parent runs. An Opus 5.5 parent once spawned Opus 4.8 subagents through `opus`. Pin the aliases instead of avoiding them. Claude Code reads `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_FABLE_MODEL`, and `ANTHROPIC_DEFAULT_HAIKU_MODEL` from the `env` block of `~/.claude/settings.json`.

1. Take the newest id per tier from `bb provider models claude-code`, or from the harness's model list outside bb.
2. Show the user the four pins and the settings file you will change, and write them only on their yes. Back up the file first.
3. Verify each pin in a fresh process. `claude -p --model <alias> --output-format json "ok"` reports the serving model under `modelUsage`. A pin takes effect for sessions started after the write.

With the pins in place, write the aliases in `models.md`. Don't write `inherit` as a workaround for alias drift. Offer it only when the user wants a role to follow whatever the parent runs.

### 5. Write the file

Create `~/.agents/pstack/` if needed and overwrite `~/.agents/pstack/models.md` whole, so re-runs stay idempotent. Shape:

```
# pstack model configuration. One line per role. Delete a line to fall back to the default in poteto-mode/references/harness.md.
# `inherit`: the role runs on the parent model. `codex` / `claude`: run that entry through the other family's CLI. `bb:<provider>/<model>`: a bb child thread, reachable only inside bb.
# harness: claude-code
# budget: unlimited
feature, refactoring: inherit
bug-fix: inherit
perf-issue: inherit
hillclimb: inherit
judgment and prose: opus
hardest tasks: opus
how explorer: sonnet
how explainer: opus
why investigators: sonnet
why synthesizer: opus
reflect tooling: codex
reflect judgment, divergent, synthesizer: opus
arena runners: inherit, opus, codex
arena cross-judge pool: opus, codex
swarm workers: sonnet
architect runners: inherit, opus, codex
interrogate reviewers: opus, sonnet, codex
```

### 6. Confirm

Tell the user the file was written and that skills read it at the start of each session. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke **create-verification-skill**. On no, move on without pushing.
