### Orchestrate

**You own the program, never the code. Author briefs, drain the queue, keep the frontier green, decide.** For a whole project handed to one standing coordinator chat: multi-day, many stacked PRs, dozens to hundreds of subagents, the human checking in twice a day instead of every five minutes. One task driven to a predicate is Autonomous run. One ambitious run needing a bespoke workflow is figure-it-out. Route here when the work outlives any single agent. Work one agent could finish inside the session's budget is not a program.

Ceremony must scale with the program. On cheap near-identical units, collapse it as each section directs.

Four rules carry the rest.

- Every unit serves a named operator goal. Unit counts are not progress.
- Completions are queue events, not interrupts.
- Every spawn and every resume carries the standing orders verbatim.
- The brief is the product. A vague brief fails quietly, because a worker cannot ask you a question.

#### Roles and placement

- **Coordinator (this chat).** Local. Frames, authors briefs, drains the inbox, owns the human report, makes judgment calls. It never authors or edits code. Conflicted merges, restacks, and code changes are always tasks. Mechanically landing a verified unit (fast-forward or clean cherry-pick of a worker's commit, then push) is bookkeeping the coordinator may do itself on repos where local git is cheap. Queueing finished work behind an idle stacker is how a deadline harvests nothing. The loop is agentic end to end. Agents are spawned, resumed, and drained only through the harness's subagent primitive (`../references/harness.md`). State reads and writes go through `scripts/orch/orch.ts` at drain points, one command in and one line out. The CLI never spawns, waits, or wakes anything.
- **Sub-coordinator.** Always local, durable, one per track, and only when the program exceeds what one coordinator's drains can manage. A track the coordinator can drain itself needs no middle layer. Each nested layer re-pays a full orientation preamble, and a blocking sub-coordinator hides its children while the parent idles. Owns its track's units and boards, authors its workers' briefs, spawns its own workers and verifiers (where the harness allows nested spawns, a nested spawn has the same placement options as a top-level one). Rolls up aggregates at wave boundaries. Never forwards raw child reports. Cap in-flight children at what one drain can process, roughly ten, as a rolling window. Never as blocking batches, which cost the slowest child of every batch. Inside bb (`../references/harness.md`, Inside bb), a sub-coordinator is a child thread spawned with `--parent-self`. It survives your compaction or restart, and the user can watch and steer it.
- **Worker / verifier.** Always in a remote environment when the harness offers one, unless the task needs this machine. Local runtime verification through the project's verification skill or a local browser or `tmux` session (`../references/harness.md`). Reading local transcripts in the harness's transcript store. Simulators and local IDE state. Auth that exists only here. Remote agents cannot read the local store, so their briefs inline what they need or point at repo paths. Prefer fewer, broader workers. One writer per worktree or branch (principle-separate-before-serializing-shared-state). Run a unit's verifier on a different model family from its worker when one is reachable (`../references/harness.md`). Inside bb, a worker that writes is a child thread with `--new-environment worktree`, and a verifier is a child thread on its own seat.

Depth stays at coordinator, track, worker. Author the track decomposition per project (build, landing, and verification are common cuts, not a required shape). Hard-coded swarm trees were tried and parked as too rigid.

#### Store layout

Create `orchestrate/<project-slug>/` in the current agent's store (path in the system prompt). Inside bb, that store is `$BB_THREAD_STORAGE`. Every file has exactly one writer. Owners publish facts, readers aggregate at read time. Use `bun scripts/orch/orch.ts` for bookkeeping, written below as `orch`, while its canonical plain TSV and JSON stay readable without the CLI.

- `goals.tsv` holds the operator's outcomes, each with the check the operator would observe when it holds. Write it with `orch goal add` and `orch goal set`. Every unit names the goal it serves.
- `grants.md` lists every capability the plan needs beyond the default sandbox (write paths, hosts, live APIs with budgets, data egress, real-data reads), each with the operator's authorization in their own words.
- `preferences.md` is the standing-orders register: numbered lines, one constraint each (model policy, stack shape and count, verification bar, forbidden paths, escalation policy). Paste it verbatim into every spawn and every resume. Directives decay across resumes, and each dropped one costs a human turn. When you catch yourself restating an instruction, append the line before you act (principle-encode-lessons-in-structure).
- `overview.md` is the durable PR and issue DB. Append. Never rewrite wholesale per event.
- `units.tsv` has one row per unit: id, track, state, branch, PR, head SHA, brief path. Update rows in place.
- `frontier.json` is the computed merge frontier, per Stack safety.
- `ledger.tsv` is the verification ledger, per Verification.
- `inbox/` holds completion pointers. `gates.md` parks human gates (question, options, default on no answer).
- `decisions.tsv` is the trail via the show-me-your-work skill.
- `status.md` is derived from `units.tsv` and `ledger.tsv` at each drain, never hand-maintained. Regenerate it from the tables instead of narrating events into it.

#### The brief

Your prompts to agents are your only product, and a sloppy brief compounds into slop across the whole tree. Every spawn carries all of it. A field you cannot fill is a unit you have not scoped yet.

```
GOAL         one sentence, the outcome, executable by a stranger with no chat access
SCOPE        paths this unit may write; paths it may not; its exclusive worktree or branch
CONTEXT      pointers to files and PRs; upstream reports pasted in full when this unit
             depends on them, because workers cannot see siblings
PREMISES     each external fact the unit rests on (an API route, a quota, a limit, a root
             cause) with its evidence path, or "unverified, probe unit <id> runs first";
             "none external" when there are none
ACCEPTANCE   checkable criteria, one per line
VERIFY       exact commands or the control-skill path, plus known gotchas
TIMEBOX      rough cap on runtime; on expiry, return partial findings and stop rather than run on
FORBIDDEN    no gt, no rebase, no force-push, no fixes outside scope, plus unit-specific bans
REPORT       status, branch, head SHA, PRs, verdict, what you actually ran, deviations,
             suggested follow-ups
STANDING     <preferences.md pasted verbatim>
```

Size the brief to the unit. A one-command unit gets one line per field. A 4KB scaffold around a two-line edit costs more to write and obey than the edit. STANDING is always `preferences.md` pasted verbatim, stop line included.

`orch unit add <id> --track <t> --brief <path> --serves <goal>` is the only way a unit enters the program, and it refuses a brief that `orch brief check` rejects: a missing field (including one registered with `orch brief require`, whose `--check` command must also pass), or a stale or partial STANDING. A unit that serves no goal passes `--serves none --reason <why>`, and status counts it as off-goal. Run `orch brief check` before `bb thread spawn`, so nothing spawns unregistered.

A premise about an external system is verified before anything is built on it. When PREMISES names an unverified fact, a probe unit (about 10 requests or one reproduction) runs first and its evidence path replaces the "unverified" line.

When a stack add-on applies (`../references/harness.md`, Stack add-ons), wire it in at Install. Put its delegate lines in `preferences.md`, so every spawn and resume carries them and the STANDING check enforces them. Register its extra brief fields with `orch brief require <FIELD> [--check <command>]` and its review lens with `orch lens require <name>`. A unit's ACCEPTANCE includes the add-on's done checklist.

A sub-coordinator brief adds its track boundary and unit list, its spawn budget with the remote default and the local exception list, the drain protocol, and the rollup format (per child: name, status, PR, head SHA, verdict, one line, plus track status and frontier delta).

A dependency is a context relay, not just ordering. Undeclared upstream context makes the worker guess. Missing fields are a refuse-to-spawn condition. Audit one sampled worker brief per sub-coordinator per wave, concurrently with the wave it samples, never as a gate in front of it. A failing brief stops that track and fixes the sub-coordinator's instructions, not just the worker, because brief quality decays late in a run. Never resume-chain a brief. Respawn fresh with consolidated scope.

#### Steps

1. **Frame.** Write the operator's outcomes into `goals.tsv` first, in their words, each with the check they would observe. When the request is a goal rather than a known list of units (build a product, make data useful), run the shape-an-idea skill before writing goals, and confirm the goals with the operator once. A program that ingests an external system gets G1 = one end-to-end run on real input, and no hardening, lint, polish, or deploy unit starts before G1 is met. Then state the done predicate: the goal checks for a product program, or something countable for a migration ("all 126 units merged, each ledger-verified `unit-test-verified` or better"). Write `grants.md` from the plan: every out-of-sandbox capability the units will need. Present it once with the framing, so the operator authorizes the whole list in one reply instead of one capability per stall. Quantify scope: units, rough effort, expected stacks, and the wall-clock budget. If one agent could finish inside that budget, stop here and run Autonomous run instead. Collapsing must not depend on another document being present. It means do the work directly in this session, plain workers where they help, verification inline, landing as you go, and none of the store, register, or pilot machinery below. Schedule landing against the budget. By roughly 70% of it, stop spawning and land what is verified. Name the tracks per project. A contested decomposition or one-way door goes through the arena skill before the pilot. Present the framing once. Reversible prep proceeds without waiting.
2. **Install the runtime.** Run `orch init`. Open the trail via the show-me-your-work skill, write the standing orders before any spawn, and seed `frontier.json` from existing PRs with `orch frontier set --repo <repo-dir>`.
3. **Pilot.** Push one unit through the whole path: brief, worker, verification, stack entry, ledger row, merge. The pilot exists to falsify the brief template, the verify recipe, and the unit size while that costs one agent instead of fifty. Fix the contract from pilot evidence before any fan-out. Scale the pilot to the unit. On programs of near-identical cheap units, the first unit is the pilot, run as a normal unit with its verify command inline, and fan-out starts the moment it lands. The dedicated pilot pipeline (separate verifier agent, audit gate) is for expensive or novel unit shapes, not for clone-units where a serialized pilot has nothing to falsify.
4. **Scale.** Spawn a rolling window of workers up to the in-flight cap, refilling as children finish. Blocking batches pay the slowest child of every batch. Spawn track sub-coordinators only past the one-drain threshold in Roles. Recompute ready work after each drain. Relay upstream reports into downstream briefs. Keep sibling communication upward only. The sampled brief audit runs alongside the wave it samples and stops the next refill on failure, not the current one.
5. **Drain.** Run the queue discipline below at every drain point.
6. **Land.** Landing is continuous, never a terminal phase. Integration starts with the first verified unit and runs alongside the remaining waves. On heavy repos the stacker is a standing role from wave one, integrating as units verify. On repos where local git is cheap, the coordinator lands verified units itself per Roles. Keep the frontier green before upper-stack work. Stack safety governs. Advance `frontier.json` only on merge or reported new head SHAs.
7. **Close.** Drain the final inbox, reconcile every spawned agent to a terminal row (done, abandoned, zombie-reconciled), confirm the predicate on the real artifact, confirm every landed PR has a verdict for its current head SHA, audit the trail per show-me-your-work including its cross-model review, encode recurring corrections into `preferences.md` or the brief template. Inside bb, delete any automation you armed and reconcile every child thread to archived or deliberately left running. Leave the store intact. It is the postmortem.

#### Queue and drain

- On a completion notification, run `orch inbox push <agent> <unit> <status> [--report PATH]` and return to what you were doing. Never deep-review inline. A completion that needs review becomes a verifier unit. Never review a diff inside a drain.
- Drain in batches at four points: the end of a critical section, a track rollup, a frontier watcher wake (arm it via the loop skill, with a long heartbeat fallback), and before a human report. Inside bb, the wake is a one-shot `bb thread tell "$BB_THREAD_ID" --mode queue --send-at <dur>` and the heartbeat is a `bb automation` with `--target-thread "$BB_THREAD_ID"`. Delete the automation at Close. Begin each batch with `orch inbox drain`. Arrivals during a drain wait for the next one.
- Critical sections you finish first: authoring a brief, a stack operation, a conflict decision, writing a gate, updating ledger or frontier.
- Each drain classifies every pointer (landed, needs-verify, failed, zombie, noise), writes the resulting rows through `orch unit add`, `orch unit set`, and `orch ledger record`, runs `orch status`, then spawns the next wave in one message.
- Account for every spawned child at its track's rollup: arrived, respawned, or its scope explicitly absorbed. Silently redoing a missing child's work hides both the wasted spend and the coverage gap its result existed to close.
- A drain turn ends with the lines from `orch status`: goals and the off-goal share, counts against the states, what changed, gates open, and any warning. Detail lives in `status.md`. Off-goal work above a third of in-flight units means re-read `goals.tsv` and park units that serve none before refilling. A `units.tsv was edited outside orch` warning means re-register those rows through `orch`. The full reply contract applies at checkpoints and close.

#### Stack safety

- The frontier is a computed object, never narrative. Recompute `frontier.json` from `gt` after every merge and stack mutation because GitHub base refs drift mid-restack while gt tracking is authoritative: ordered PR list, branch names, head SHAs, a generation number, the lowest unmerged PR. Resolve it where gt knows the stack, normally the stacker's clone. A checkout whose gt metadata never saw the submits reports no PRs and the command errors rather than guessing.
- Exactly one stacker per stack may run `gt`, serialized within its stack. Record the holder in the standing orders. Restacks run in a remote environment. A local restack at this scale takes the laptop down.
- Workers never rebase and never run `gt`. Babysitters follow `playbooks/babysit.md`, one per stack, scoped to one immutable frontier generation. They report conflicts to the stacker rather than restacking.
- PR closes and retargets go through the stacker only. Closing a base PR orphans every chain above it. Merges and stack surgery are units with briefs like any other.
- One retro watcher follows merged PRs for reverts, post-merge CI breaks, and orphaned follow-ups.

#### Verification

Scale verification to the unit. When VERIFY is a single cheap command, the worker runs it and reports the output, and the coordinator spot-checks receipts. A dedicated verifier agent (on a different model family than the worker when one is reachable) is for units whose verification is expensive, judgment-laden, or high-blast-radius. A verifier agent whose entire product would be rerunning one command is ceremony, not verification. When a lens is required, its seat runs the add-on's review lens and records `pass`, `fixes-required`, or `inconclusive` with `orch ledger record <pr> <sha> <verdict> --lens <name>`. `orch ledger check <pr> <sha> --unit <id>` refuses to land a unit without a passing default verdict and a `pass` on every required lens at that head SHA.

Write ledger rows with `orch ledger record`. Check the current PR and head SHA with `orch ledger check`. `ledger.tsv`, one row per verdict, keyed by PR number plus head SHA: `live-ui-verified | unit-test-verified | type-check-only | verifier-blocked | verifier-failed`. CI green is an input to a verdict, not a verdict. Behavioral work needs better than `type-check-only`. `verifier-blocked` is not a pass. Respawn when the environment heals. `verifier-failed` gets a fix unit, not a re-verify. A worker may self-report. A verifier overrides it on the same key. A new head SHA voids the row, so re-verify after restack. The ledger answers "was this verified", not memory and not the transcript.

A unit is not done until its output is externalized the moment it lands, never batched to the end of the run. A worker pushes its branch, a verifier writes its ledger row, receipts land in the store. Work that exists only on one VM when that VM dies was never done.

#### Liveness and failure

- Never resume an agent to check on it. A resume restarts an idle agent. Probe read-only: the ledger, `units.tsv`, `gh`, pushed branches, a remote agent's status in the harness's session list. Transcript mtime is not liveness.
- Inside bb, the read-only probes are `bb thread list --parent-thread "$BB_THREAD_ID"`, `bb thread show <id>`, and `bb thread output <id>`. A child blocked on a question or an approval shows in `bb thread interactions list <id>`. Answer what the standing orders cover and park the rest in `gates.md`.
- A silent death gets a synthetic postmortem row in the inbox (unit, failure mode, last evidence, options). Replan on evidence as it arrives. Never wait for full quiescence.
- Retry by mode: cap-hit or oom, respawn with smaller scope. Network-drop, retry as-is. Tool-error, retry on a different model. Unknown, retry once. Two retries, then abandon the unit and replan around it.
- A zombie that returns hours late reconciles against the current frontier and ledger before anything is accepted. Salvage unique findings through a fresh unit, never a blind merge.
- When continued spawning would produce garbage tree-wide (bad upstream output, broken acceptance, dead infra), write a stop line at the top of the standing orders, above item 1, unnumbered. Let in-flight work finish, fix the cause, clear it.
- Bound your own infra retries the same way you bound a child's. After a few consecutive tool aborts, stop retrying. Write a terminal handoff to durable state (what is done, where it lives, the exact command to resume) and end the run.
- After a harness restart, local agents are dead and remote work is not. Re-read the standing orders and `units.tsv`, recompute the frontier, reattach remote work by PR and branch rather than agent id, respawn one sub-coordinator per track from its stored brief plus current state, drain, resume. Inside bb, child threads survive the restart. Reattach them through `bb thread list --parent-thread "$BB_THREAD_ID"` before respawning anything. The dead session's store lock clears itself on the next write. `orch` replaces a lock whose holder pid is gone.

#### Escalation

Reaches the human, batched into the status page rather than per item: irreversible actions (force-push to shared branches, deploys, deletions, closing someone else's PR), genuine product or preference calls no experiment settles, a standing order that contradicts observed reality, a program-level dead end that survived a replan. Park each as a `gates.md` entry before asking, and route work around it.

A command that needs access beyond the sandbox runs under its `grants.md` line per `../references/harness.md` (Running outside the sandbox). It is never handed to the operator to run.

Never reaches the human: frontier nudges, restack mechanics, retries, CI flake triage, review-thread triage, format fixes, scope the brief already forbids (refuse and continue), and "should I keep going". When in doubt, act and log.

Mid-run discoveries fix only what blocks the frontier. Everything else parks in follow-ups. At this fan-out a small scope leak multiplies into PRs nobody asked for.

Replies to the operator name outcomes, not bookkeeping. Spell out a unit id or a store term (drain, frontier, ledger, `orch`) on first use ("the retry-policy work (RP1)"), or leave it out.

**Reply:** at checkpoints and close: each goal and whether its check holds, the predicate and the count against it from `units.tsv` and `ledger.tsv`, tracks and what each landed, the frontier (PR list plus SHAs), verdicts summary, what was abandoned and why, gates awaiting the human (the only asks), the store path, and the trail path. Inside bb, every child thread you started as `@thread:<id>` and which still run. Numbers from the tables, not narrative. Include PR links. Archive each child whose result you collected before the reply (`../references/harness.md`, Archive children when they are done), and give the reason for any you keep.
