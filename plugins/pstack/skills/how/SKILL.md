---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Each spawn below names a role from the pstack configuration table in [harness.md](../poteto-mode/references/harness.md). Read that role's value from `~/.agents/pstack/models.md`, or use the table default if the file or the role is missing. Leave the model unset when the value is `inherit`. If the harness rejects a model, use the role's default and say so.

## Step 1. Assess Complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. One explainer explores and explains in a single pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): spawn parallel explorers first, then hand off to the explainer. Go to Step 2a.

When in doubt, take the simple path.

## Step 2a. Explore (complex questions only)

Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem. Spawn all explorers in a single message:

- a general-purpose subagent, read-only
- model: the `how explorer` role

Each explorer gets the prompt in `references/explorer-prompt.md` with its angle filled in. Then go to Step 3.

## Step 2b. Direct Explain (simple questions)

Spawn one subagent that explores and explains in one pass:

- a general-purpose subagent, read-only
- model: the `how explainer` role

Build its prompt from `references/explainer-prompt.md` without the explorer-findings section. Go to Step 4.

## Step 3. Synthesize (complex questions only)

Once all explorers have returned, spawn one subagent to synthesize their findings into one explanation:

- a general-purpose subagent, read-only
- model: the `how explainer` role

Build its prompt from `references/explainer-prompt.md` with every explorer's findings filled in.

## Step 4. Present

Present the explainer's output to the user. Light edits for clarity or context from the conversation are fine, made per **distill-writing** so the explanation stays organized around its core idea. Do not substantially rewrite it.

Inside bb ([harness.md](../poteto-mode/references/harness.md), Inside bb), an explanation longer than a screen goes to `$BB_THREAD_STORAGE/how-<slug>.md` unless the user wants it committed. Open it with `bb thread open <path>` and reply with the Overview and the path.

## Output Format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
