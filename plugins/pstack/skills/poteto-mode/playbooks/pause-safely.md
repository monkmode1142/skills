### Pause safely

**You own a clean stop. Leave a checkpoint a cold-start agent can resume from.** This is explicit only. On "keep going", "going to bed, keep going", or "don't stop", do not pause.

1. Stop at a safe boundary. Finish the current atomic step or back out of it. Start nothing new, and cancel any nested subagents. Inside bb (`../references/harness.md`, Inside bb), list child threads with `bb thread list --parent-thread "$BB_THREAD_ID"` and decide each one deliberately. Archive it if it is finished and its result is collected (`../references/harness.md`, Archive children when they are done). Otherwise stop it with `bb thread stop <id>`, or leave it running because its work stays valid without you. Never archive a stopped child with uncommitted work the resume needs. Pause any `bb automation` that targets this thread with `bb automation pause`, or record in the note why it keeps running.
2. Take no irreversible action to pause. No PR and no push unless you already had one out.
3. Make the work durable. Commit uncommitted edits as one clear `wip:` commit on the current branch so nothing is lost. If the tree is broken, say so in the commit body in one line.
4. Write the resume note off-context. Capture intent, what you were doing, progress and what's verified, current state, next steps, key files, and gotchas. For the compaction trigger write it to a file like `/tmp/<slug>-resume.md`. Inside bb, the note always lives at `$BB_THREAD_STORAGE/<slug>-resume.md`, whatever the trigger. It records every child thread's ID, its state, and whether you stopped it or left it running. If a show-me-your-work trail exists, point at it instead of duplicating it.

**Reply:** where you are in the loop, what's on disk versus still in your head (paths, no diff dumps), the commits you made and whether the tree is clean, and the first action on resume. Inside bb, each child thread as `@thread:<id>` and which still run. This is a pause, not a final report.
