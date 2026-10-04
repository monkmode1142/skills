---
name: why
description: "Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers available MCPs and CLIs and queries each evidence category (source control, issue tracker, long-form docs, real-time chat, infrastructure observability, error tracking, product analytics warehouse) in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior."
disable-model-invocation: true
---

# Why

Investigate the motivation and intent behind code.

Companion to the `how` skill. `how` answers what the code does and how it works. `why` answers what forces led to its shape.

Each spawn below names a role from the pstack configuration table in [harness.md](../poteto-mode/references/harness.md). Read that role's value from `~/.agents/pstack/models.md`, or use the table default if the file or the role is missing. Leave the model unset when the value is `inherit`. If the harness rejects a model, use the role's default and say so.

## Operating Posture

Operate as a **careful, cautious, and precise investigator**. Be honest about what you know vs what you're inferring. Read `references/epistemics.md` for the full confidence framework and phrasing guide. The synthesizer must follow it.

## Step 1. Understand the Target and the Question

Parse what the user is asking. The **target** is usually a chunk of code, a pattern, a feature, or a named design decision. The **question** is usually a design rationale, a tradeoff, a motivating edge case, an external constraint, dead code, or a broad history sweep.

If the target is vague ("why do we do it this way?" with no clear referent), make your best guess from conversation context (open files, recent edits, the current selection, what was just discussed). State your interpretation briefly so the user can redirect if you're off, then proceed.

## Step 2. Establish the Code Anchor

Before spawning investigators, anchor the investigation in concrete code. You need:

- The relevant file path(s) and line range(s)
- The key symbols (function names, class names, constants)
- An initial commit list. The last few commits touching the target.
- PR numbers from merge commits (pattern `(#1234)` in the subject line)

Build this inline.

```bash
# Blame target lines for last-touch commits
git blame -L <start>,<end> <file>

# Full file history, with patches, through renames
git log --follow -p -- <file>

# Last N commits touching the file, PR numbers visible
git log --oneline -20 -- <file>

# Extract PR numbers from a commit message
git log -1 --format=%B <commit>
```

Pull PR bodies and discussion via `gh` for any substantive commits:

```bash
gh pr view <number> --json title,body,author,createdAt,mergedAt,labels,closingIssuesReferences,comments,reviews
```

Capture this as seed context (file paths, symbols, commits, PR numbers, linked ticket IDs). Pass it to the investigators.

## Step 3. Spawn Parallel Investigators (default posture)

**Default to the full parallel investigation.**

### Discovery

Before spawning investigators, list the MCP servers and CLIs available in this session. Use the harness's tool list and server instructions, and check `PATH` for relevant CLIs.

Map each available MCP or CLI to one evidence category:

1. Source control history
2. Issue / ticket tracker
3. Long-form documents
4. Real-time team chat
5. Infrastructure observability
6. Error / exception tracking
7. Product analytics warehouse

Source control is always available through git and `gh`. Inside bb ([harness.md](../poteto-mode/references/harness.md), Inside bb), past agent threads are a real-time chat source. `bb thread search` and `bb thread log` search them across providers, scoped to this project with `bb thread list --project "$BB_PROJECT_ID"`. For the other six, classify using the MCP or CLI name, server instructions, tool names, and resource descriptors. If a source could fit more than one category, choose the one matching its primary evidence. Record ambiguous cases in the coverage map.

Aim for a complete **coverage map**, not a minimal one. Document the null, don't skip the search.

Launch all matching investigators in a single message so they run concurrently. Don't ask one agent to cover multiple sources.

Subagent config (each):
- a general-purpose subagent
- model: the `why investigators` role
- tools: give it the MCP and shell access its source needs. Investigators still shouldn't write anything.

Each investigator gets:
1. The base prompt from `references/investigator-prompt.md`
2. The category guidance from `references/source-playbook.md`, plus the concrete playbook in `references/sources/` when one exists for its category
3. The cross-cutting `references/sources/incident-postmortem.md` **if the target code looks defensive** (null checks, retry logic, timeout handling, rate limiting, feature flags, egress guards, OOM handlers)
4. The code anchor from Step 2 (file paths, symbols, commit hashes, PR numbers, ticket IDs)
5. The user's original question

### Investigator roster. One per available evidence category

Spawn one investigator per category that has a matching MCP or CLI. Each owns exactly one source.

Each entry names the category and the kind of "why" it uniquely surfaces. Use it to know what to expect back, how to name a gap when a category returns empty, and (only in the rare provably-irrelevant case) to justify a skip.

1. **Source control investigator**. Git history, `gh` for PRs, code comments, tests. Always spawn. The only guaranteed source. Best at surfacing *implementation-time rationale captured during review*.

2. **Issue / ticket tracker investigator** (e.g. GitHub Issues, Plane, Shortcut, or whatever MCP or CLI the session has for it). Best at surfacing *the product or business forcing function*. Strongest when the why is external to engineering.

3. **Long-form documents investigator** (e.g. Confluence, Google Docs, Coda, a docs folder in the repo, or whatever MCP or CLI the session has for it). Best at surfacing *long-form design rationale*. Where the why is written out before it becomes code.

4. **Real-time team chat investigator** (e.g. Discord, Microsoft Teams, Mattermost, or whatever MCP or CLI the session has for it). Best at surfacing *real-time deliberation that never reached a doc*. Especially important when the source control, ticket, and doc paper trail is thin.

5. **Infrastructure observability investigator** (e.g. New Relic, Honeycomb, Grafana, Splunk, or whatever MCP or CLI the session has for it). Infra/runtime view. Best at surfacing *infrastructure and runtime reality that motivated the code*. Strongest when the target reacts to an infra signal (timeouts, retries, rate limits, circuit breakers).

6. **Error / exception tracking investigator** (e.g. Rollbar, Bugsnag, Airbrake, or whatever MCP or CLI the session has for it). Best at surfacing *the specific exceptions and error trajectories that motivated defensive or corrective code*. Strongest for catch blocks, null guards, type checks, retries, and other defenses.

7. **Product analytics warehouse investigator** (e.g. Snowflake, BigQuery, ClickHouse, dbt, Redshift, or whatever MCP or CLI the session has for it). Product/data view. Best at surfacing *product and data reality that shaped the code*. Strongest for flag-gated code, experiment-driven ships, data migrations, and "where did this number come from" questions.

### When to skip an investigator

Only skip with an **explicit, written justification** that goes in the final "Sources Consulted" section. Two valid reasons:

- **No MCP or CLI is available for that category** in this environment. Flag this as a gap, not a choice. Example: "Real-time team chat skipped. No matching MCP or CLI available, so the conversational record was not searchable."
- **The source is provably irrelevant**, not just "probably irrelevant." A high bar. Example: "Error / exception tracking skipped. Target is a build-time script with no runtime code path."

If your scope assessment suggests a single-commit trivial target where the PR description already contains the complete answer, you may answer inline **only after** confirming all seven available category searches would be redundant. Say so explicitly. This should be rare.

## Step 4. Synthesize

When the user's real question is whether to keep or change what you found, the synthesis is evidence, not the verdict. Hand it to **reason-from-first-principles** as premises (poteto-mode's `references/thinking.md`).

Spawn one synthesizer subagent:

- a general-purpose subagent
- model: the `why synthesizer` role
- tools: give it the same MCP and shell access the investigators had. Its quality check spot-verifies citations, which can require that access.

The synthesizer gets:
1. The investigator findings, including any null results and any categories skipped with justification
2. The code anchor from Step 2 (file paths, symbols, commit hashes, PR numbers, ticket IDs)
3. The user's original question
4. The epistemics framework from `references/epistemics.md`
5. The synthesizer prompt template from `references/synthesizer-prompt.md`

## Step 5. Present

Take the synthesizer's output and present it to the user. You may lightly edit for clarity or add context from the conversation, but **do not rewrite the confidence language**.

## Output Format

The output structure is the one in `references/synthesizer-prompt.md`: The Question, The Code in Question, What We Found, What We Can Reasonably Infer, Competing Hypotheses, What We Don't Know, Sources Consulted, Confidence Summary. Adapt as needed, but keep the confidence separation intact, and keep Sources Consulted as one line per investigator, including the ones that returned nothing or were skipped, with the reason.

After the Sources Consulted block, if the user's `why` question is a precursor to actually changing this code, convert the lineage findings into a Preserve / Change / Avoid / Risk constraint set suitable for planning the change.

## Common Failure Modes to Avoid

- **Recency bias**. Assuming the most recent commit is authoritative. The current shape is often the accretion of many earlier decisions. Trace back.

## Reference Files

- `references/epistemics.md`. Confidence tiers and phrasing guide. The synthesizer must follow it.
- `references/investigator-prompt.md`. Base prompt template for investigator subagents.
- `references/source-playbook.md`. Per-category guidance and an index of the concrete playbooks below.
- `references/sources/*.md`. Concrete playbooks: `code-archaeology.md` for source control, and cross-cutting `incident-postmortem.md`. Other categories use the generic guidance in `source-playbook.md`, adapted to the available MCP or CLI.
- `references/synthesizer-prompt.md`. Prompt template for the synthesizer subagent, including the output format.
