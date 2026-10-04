# Set up pstack

In this page you install the skills, pick which models pstack uses, and run your first task. Setup is two commands plus a short conversation.

## Install the skills

Run:

```bash
claude plugin marketplace add aulneau/skills
claude plugin install pstack@aulneau-skills
```

That installs every skill plus the `poteto-agent` and `comment-sicko` subagents. Plugin skills carry the plugin's name, so the commands in this guide run as `/pstack:<name>`, for example `/pstack:setup-pstack`. For an agent other than Claude Code, `bunx skills add aulneau/skills -g` installs the skills, and the two subagent files in [`agents/`](../../agents/) go into its agents directory. Start a new session so the harness picks up the new skills.

## Pick your models

Run:

```text
/setup-pstack
```

In a harness without slash commands, ask the agent to use the setup-pstack skill. [`/setup-pstack`](../../skills/setup-pstack/SKILL.md) detects the models you have access to, asks for a budget (unlimited, large, medium, small) that maps roles onto your strongest, mid, and fast tiers, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes `~/.agents/pstack/models.md`, a small file every pstack skill reads.

You only override what you care about. A role with no line in the file keeps the default from the [pstack configuration table](../../skills/poteto-mode/references/harness.md#pstack-configuration). To restore a default, delete that role's line. A rerun of `/setup-pstack` keeps any role whose model differs from the default.

You might be wondering what happens if you don't want to pick. Set a role to `inherit` and pstack omits the subagent model, so the subagent runs on your parent chat model. `inherit` is not a model name. For a panel role the value is a list, and one subagent runs per entry, so the list length sets the panel size. A `codex` entry runs through `codex exec` from a shell, and a cross-family entry that isn't reachable is dropped. Setup also configures `swarm workers`, the default model for every `/swarm` worker unless a race names a model for each arm.

## Accept the verification offer, or don't

At the end of setup, `/setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.agents/skills/verify-<app>/` (or `.claude/skills/verify-<app>/` in a Claude Code project), a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers when it earns its place.

After setup, start a new chat. The model file applies to new sessions.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. `/poteto-mode` is sticky. It stays on for the conversation until you opt out by saying so.

Next: [Route work through `/poteto-mode`](./02-poteto-mode.md).
