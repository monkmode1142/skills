---
name: principle-fix-root-causes
description: "Apply when debugging. Trace each symptom to its root cause and fix it there; reproduce first, ask why until you reach it, resist nil-check guards that silence crashes."
disable-model-invocation: true
---

# Fix Root Causes

When debugging, do not fix symptoms. Trace every problem to its root cause and fix it there.

**Why:** Symptom fixes accumulate. Each workaround makes the system harder to reason about, and the real bug remains. Root-cause fixes are slower upfront but reduce total debugging time.

**Pattern:**
- Reproduce first
- Ask "why" until you hit the root cause
- Do not add guards (adding a nil check to silence a crash is a symptom fix)
- If a workaround needs a paragraph-long comment to justify it, the code is wrong (fix the code, not the comment)
- Check for the pattern, not just the instance (grep for the same pattern, fix all instances)
- When stuck, instrument. Don't guess (add logging, read the actual error)

**In Effect code** the guard has its own spellings. `Effect.ignore`, `Effect.orElseSucceed` with a default, and an `Effect.catch` that swallows every failure all silence the symptom. `Effect.catchCause` in service code also swallows interrupts. Handle a specific tag with `Effect.catchTag` only when the outcome is a real domain branch. To instrument, read the full `Cause` (`Cause.pretty`, or iterate `cause.reasons`) and the spans that `Effect.fn` methods already emit before adding logs. `Cause.squash` keeps only the first failure. Open the **effect** skill's `references/errors.md` §6 for reading `Cause` and `Exit`, §8 for the swallowing anti-patterns, and `references/v4-catalog.md` §5 when the API name is right but the behavior surprises you.

**Restart bugs: suspect state before code**

When something "fails after restart," suspect stale persistent state first: config files, caches, lock files, serialized state. If clearing a state file restores behavior, prioritize state validation as the fix.
