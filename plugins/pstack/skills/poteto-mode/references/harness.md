# Harness primitives

pstack is written against a small set of capabilities, not against one agent product. Every skill names the capability in plain words ("spawn a subagent", "ask the user", "open a todo list"). This file maps each capability to the harness you are running in. If your harness is not listed, use the fallback column. If `BB_THREAD_ID` is set you are inside bb, and the **Inside bb** section below adds to (and where it says so, replaces) the Claude Code and Codex columns. Never stall because a named tool is missing. Pick the closest primitive and say which one you used.

## Capability map

| Capability | Claude Code | Codex | Fallback (any harness) |
|---|---|---|---|
| Spawn a subagent | `Agent` tool. `subagent_type`, `model`, `run_in_background`, `isolation: "worktree"` | Built-in subagents if your build has them, else `codex exec --cd <dir> "<brief>"` in a background shell | Do the work inline, sequentially, and say the fan-out was serialized |
| The pstack subagent | `subagent_type: "poteto-agent"` (installed at `~/.claude/agents/poteto-agent.md`), or `"pstack:poteto-agent"` when pstack is installed as a Claude Code plugin | A subagent whose brief opens with "Read the `poteto-mode` skill's SKILL.md in full before any work" | Same brief prefix |
| Ask the user a structured question | `AskUserQuestion` | Plain message with numbered options | Plain message with numbered options |
| Todo list | `TodoWrite` / task tools | `update_plan` | A Markdown checklist kept in the reply |
| Pick a model per subagent | `Agent` `model` param (`opus`, `sonnet`, `haiku`, `fable`). An alias can resolve to an older model than the parent, so prefer `inherit` (see setup-pstack) | `codex exec -m <model>` | Omit, run on the parent model |
| A different model family (diversity) | `codex exec` from a shell, if `codex` is on PATH | `claude -p` from a shell, if `claude` is on PATH | Same model, different lens per reviewer. Treat agreement as weaker evidence and say so |
| Always-applied rules | `~/.claude/CLAUDE.md`, project `CLAUDE.md` | `~/.codex/AGENTS.md`, project `AGENTS.md` | Project `AGENTS.md` |
| Skills directory | `~/.claude/skills/`, project `.claude/skills/` | `~/.agents/skills/`, project `.agents/skills/` | `~/.agents/skills/` |
| Chat transcripts (for recall, automate-me). Inside bb, see **Inside bb** first | `~/.claude/projects/<slug>/<session>.jsonl`. `<slug>` is the absolute cwd with every `/` and `.` replaced by `-` | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (filter by the `cwd` field) | Ask the user where history lives. Never glob across other projects |
| Long wait or poll | `Monitor`, `/loop`, `ScheduleWakeup`, background `Bash` | Background shell with an `until` loop | Shell `until` loop with a sleep and a timeout |
| Drive a browser UI | Any browser MCP in the session (Playwright, Chrome, built-in browser) | Same | Headless Playwright script you write and run |
| Drive a CLI or TUI | Bash, or `tmux` for interactive programs | Same | `tmux send-keys` + `capture-pane` |
| Code host | `gh` | `gh` | `gh`, or the host's CLI |

## Running outside the sandbox

Claude Code may run Bash inside a sandbox that blocks some paths, hosts, or keychain reads. When a command fails on a sandbox restriction and the operator's grant covers it (a `grants.md` line in Orchestrate, or their words in this session), rerun it with the sandbox disabled and cite the grant in the command's description. If the permission check still denies it, write the exact sentence the operator could send to authorize it into a gate, then continue other work. Never hand the operator the command to run, and never end a turn on "please run this". A capability no grant covers is a gate, parked once, with work routed around it.

## pstack configuration

Per-role model choices live in `~/.agents/pstack/models.md`, written by the **setup-pstack** skill. Read it once per session when a skill asks for a role's model. A role missing from the file uses the default below. A value of `inherit` runs the role on the parent model (omit `model`).

| Role | Default |
|---|---|
| `feature, refactoring` | `inherit` |
| `bug-fix` | `inherit` |
| `perf-issue` | `inherit` |
| `hillclimb` | `inherit` |
| `judgment and prose` | strongest available (Claude Code `opus`) |
| `hardest tasks` | strongest available (Claude Code `opus`) |
| `how explorer` | fast tier (Claude Code `sonnet`) |
| `how explainer` | strongest available |
| `why investigators` | fast tier |
| `why synthesizer` | strongest available |
| `reflect tooling` | strongest available, different family if reachable |
| `reflect judgment, divergent, synthesizer` | strongest available |
| `arena runners` | `inherit, opus, codex` (drop `codex` if not on PATH) |
| `arena cross-judge pool` | `opus, codex` |
| `swarm workers` | fast tier |
| `architect runners` | `inherit, opus, codex` |
| `interrogate reviewers` | `opus, sonnet, codex` |

## Running a seat

A role value names how to run one seat. Resolve each entry in a role list on its own.

- `inherit`. A native subagent on the parent model (omit `model`).
- A native model (`opus`, `sonnet`, `haiku`, `fable` in Claude Code). A native subagent with that model.
- `codex` / `claude`. The other family's CLI from a background shell: `codex exec --cd <dir> "<brief>"` from a non-Codex parent, `claude -p "<brief>"` from Codex. Its stdout is the seat's output. It may not see this session's MCPs, so brief it from files and the repo.
- `bb:<provider>/<model>[@<reasoning>]`, for example `bb:codex/gpt-6.1-sol@high`. A bb child thread on that provider and model (see **Inside bb**). Reachable only inside bb.

An entry that is not reachable (CLI not on PATH, `bb:` outside bb, a model the harness rejects) is dropped. A panel that loses its last cross-family seat says it ran single-family and treats agreement as weaker evidence.

## Stack defaults

Non-frontend TypeScript (services, CLIs, scripts, infra, workers, tests for those) is written in Effect v4. `references/effect.md` maps every pstack step to the part of the **effect** skill it opens, and holds the version gate, the done gate, and the brief lines for delegates. For a new service module, also load **effect-service-design** when it is installed. Frontend UI code (React components, styling) is plain TypeScript unless the project already uses Effect there.

Project rules beat these defaults. Read the project's `AGENTS.md` or `CLAUDE.md` before acting.

## Inside bb

bb is an agent IDE. Every agent conversation is a *thread*, threads run in *environments* (the project checkout, a managed git worktree, or a personal workspace), and a thread can parent child threads on any provider bb has (`bb provider list`, `bb provider models <id>`). `BB_THREAD_ID`, `BB_PROJECT_ID`, and `BB_ENVIRONMENT_ID` are set inside a bb thread. `bb guide <chapter>` is the reference. Every command takes `--json`.

**Pick the subagent primitive by the job, not by habit.**

| Job | Use |
|---|---|
| Short read-only helper (explorer, investigator, reviewer on a Claude model) | Native subagent. Cheapest, no UI noise |
| Seat on another provider (`bb:` role values) | bb child thread |
| Long-lived role that outlives one turn (PR owner, orchestrate lane, autopilot worker, babysit watcher) | bb child thread. It survives the parent's compaction or restart and the user can watch and steer it |
| Writer that needs its own checkout (swarm writer, arena runner, stack builder) | bb child thread with `--new-environment worktree`, whatever the role value. A native value maps to `--provider claude-code --model <id>` (map `opus`, `sonnet`, `haiku`, `fable` to the newest matching id that `bb provider models claude-code` lists). `inherit` omits `--provider` and `--model`, and the child takes the parent's live execution. Native `isolation: "worktree"` is only for a single small edit |

**Spawn a child thread.** Write the brief to a file in thread storage (`$BB_THREAD_STORAGE`), then spawn. bb reads `--prompt-file` and each `--file` on the CLI side, so the child gets their contents even on another machine. Attach shared grounding (a transcript dump, a design brief) with `--file <path>` rather than pointing the child at your thread storage. Everything else the child needs must be in the repo at a ref it can check out.

```
bb thread spawn --project "$BB_PROJECT_ID" --parent-self \
  --provider <id> --model <model> [--reasoning-level <level>] \
  [--new-environment worktree [--base-branch <ref>] | --environment "$BB_ENVIRONMENT_ID"] \
  --title "<role>: <unit>" --prompt-file <brief> --json
```

- `--parent-self` makes it a child. The parent gets lifecycle notifications when it finishes, fails, or is interrupted, so there is no need to poll for completion.
- Omit `--environment` and `--new-environment` and the child shares nothing you didn't choose. Use `--environment "$BB_ENVIRONMENT_ID"` only for a read-only seat that must see uncommitted work in your checkout. Writers get `--new-environment worktree`.
- `--lifecycle-owner-thread "$BB_THREAD_ID"` archives the child (and retires its worktree) with the parent. Use it for throwaway seats. Leave it off for roles whose branch must outlive the parent.
- Children inherit the parent's permission mode. A cross-family reviewer that must stay read-only says so in its brief, and the parent rejects any diff it produced.
- `--visibility hidden` keeps bulk workers (a 20-way swarm) out of the sidebar. They still report to the parent. Default to visible for anything the user might want to watch.

**Collect, steer, and answer.**

- `bb thread wait <id> [--timeout 30m]` blocks until the child is idle. `bb thread output <id>` is its final reply. `bb thread show <id> --git-diff` is its diff. You still own the result. Review it like any delegate's.
- `bb thread tell <id> --message-file <f> --mode queue` adds a directive for its next turn. `--mode steer` (default) redirects the live turn. Prefer a fresh child with consolidated scope over chained follow-ups, per poteto-mode's Subagents section.
- A child that asks a question or needs an approval blocks. `bb thread interactions list <id>` shows it. Answer what the operator's grant covers with `bb thread interactions answer|approve|deny`, `grant --scope turn|session` for a permission request, or `respond --value '<json>'` for a plugin form, and escalate the rest to the user. Never approve an Always-pause action on the user's behalf.
- Probe a child read-only. Use `bb thread list --parent-thread "$BB_THREAD_ID"`, `bb thread show <id>`, and `bb thread output <id>`. Never `tell` a child just to check on it, because that starts a turn.
- `bb thread stop <id>` ends a runaway. `bb thread fork <id>` branches a thread with its full context, for a second attempt from the same point.

**Archive children when they are done.** A finished child left in the sidebar is noise for the user and keeps its worktree alive. The parent archives each child with `bb thread archive <id>` as soon as its result is collected. A child never archives itself, because the parent still has to read its output.

- *Collected* means you read `bb thread output <id>`, reviewed its diff, and everything worth keeping is committed and pushed, merged into your branch, or copied into your notes. Check with `bb thread show <id> --work-status` first. Archiving the last thread in a worktree tears that worktree down about five minutes later (`bb guide environments`). The branch survives, but uncommitted work does not.
- Archive throwaway seats (reviewers, judges, investigators, swarm workers, losing arena runners) right after their output is read. Archive a failed or stopped child once its failure is in your notes.
- Archive a long-lived role (PR owner, orchestrate lane, babysit watcher) when the role ends: the PR merged or closed, the lane drained, the watch's predicate held. Each round of a role runs as a fresh child per poteto-mode's Subagents section, so archive the finished round's thread when its successor starts.
- Keep a child unarchived only while it is running, while it holds state the next step needs (an uncommitted checkout, a dev server or terminal the user is using), or when the user asked to keep it. Pause safely keeps the children it names as kept.
- `--lifecycle-owner-thread` children archive with the parent anyway. Archive them early when done, so their worktrees free up sooner.
- Before your final reply, sweep `bb thread list --parent-thread "$BB_THREAD_ID"`. Every child is either archived or listed in the reply with the reason it stays.

**Waits and wake-ups.** Don't sleep in a turn waiting on CI or a review bot.

- Wake yourself later: `bb thread tell "$BB_THREAD_ID" --mode queue --send-at 1h --message-file <tick>`. The tick prompt restates the loop's predicate and its next step.
- Recurring program ticks (hourly babysit, overnight autopilot): `bb automation create --project "$BB_PROJECT_ID" --name <n> --cron "<expr>" --timezone <tz> --prompt "<tick>" --provider <id> --model <model> --target-thread "$BB_THREAD_ID"` (see `bb guide automations`). One-shot runs take `--in <dur>` or `--at <time>` instead of `--cron`. `bb automation pause|resume|delete <id> --project "$BB_PROJECT_ID"` manage it. Delete the automation when the predicate holds. A forgotten automation is a leak.
- Bounded waits on one thing: `bb thread wait`, `bb terminal wait --contains <text>`, or `scripts/watch-pr`.

**Long-running processes.** Dev servers, watchers, and REPLs go in a bb terminal, not a background shell: `bb terminal create --thread "$BB_THREAD_ID" --title "<cmd>" --command "<cmd>"`, then `bb terminal wait <tid> --contains "<ready line>" --timeout 120`. Read logs with `bb terminal output <tid> --tail-bytes 20000`. Close it with `bb terminal close <tid>` when the drive is done. To show a running server to the user away from the box, `bb connect expose <port>` returns an owner-only URL. Unexpose it from the same thread when done.

**Browser.** The bb browser (`bb guide browser`, experimental) drives desktop tabs with the user's signed-in cookies. Prefer a browser MCP when the session has one. Use the bb browser when the check needs the user's real session, and release the lease when done.

**History and handoff.**

- `bb thread search <query>` searches every thread's messages. `bb thread log <id> --all` reads a thread's full timeline. `bb thread list --parent-thread <id>` lists a coordinator's children. These are the transcript store inside bb for **recall**, the Session pickup playbook, **reflect**, **automate-me**, **why**, and the **show-me-your-work** audit. The provider's own transcript files cover only that provider.
- A thread reference from the user (`@thread:thr_...`) resolves with `bb thread show <id>` and `bb thread log <id>`.
- In replies, reference threads as `@thread:<id>` and never build thread URLs. Open Markdown or HTML artifacts for the user with `bb thread open <path>`. Scratch artifacts (briefs, decision logs, reports) live in `$BB_THREAD_STORAGE`, not the repo, unless the stakes call for committing them. Thread storage belongs to one thread and lives at `~/.bb/thread-storage/<thread-id>/` on the thread's machine, so a pickup on the same machine can read another thread's pause note there. An artifact another thread must pick up later (a pause note, a decision log for a run that may be resumed elsewhere) goes in the repo or is attached to that thread with `--file`.

**Environments and PRs.** `bb environment diff|status <id>` inspects a child's worktree without entering it. `bb thread show <id>` includes PR status for its branch. bb has no PR-create command, so it is not the "built-in PR tool" that Opening a PR mentions. `bb environment pull-request show|ready|draft <id>` are fine conveniences. Merging goes through the Shipping playbook and `gh`, never `bb environment pull-request merge`, because Shipping's per-PR verdict gate lives there. A worktree retires after its last thread is archived, and its branch is kept. `bb environment archive-threads <id>` archives every thread in one. `bb environment delete <id>` is refused while threads are live. `bb environment cleanup <id>` is an override, not a routine step. A repo whose fresh worktrees need setup should commit `.bb-env-setup.sh` and `.worktreeinclude` (`bb guide environments`). Suggest that to the user when swarm or arena writers keep failing on setup, rather than repeating setup in every brief.

**Guardrail.** Child threads are visible to the user and cost real budget. Spawn them only inside a pstack workflow the user invoked (or work the user asked to delegate), archive them when done (above), and say in the reply which threads you started (`@thread:<id>` each), which you archived, and which still run and why.
