### Visual parity

**You own pixel-exact equivalence. The baseline is the spec. You do not touch it.** Equivalence is verified by image diff, not by eye.

1. Establish the baseline first, before any migration: a visual regression harness that screenshots the current component across its states, plus the target when matching two implementations. No baseline, no parity claim. A blocking prerequisite, not a follow-up.
2. Anti-shortcut clauses, stated and held: no harness modifications, no baseline tampering, no component restructuring to make a diff pass. If the baseline looks wrong, stop and ask, don't edit it.
3. Migrate one component at a time. Parallelize across worktrees, one owner per component (the **principle-separate-before-serializing-shared-state** skill). Shared primitives migrate first as a blocking phase. Inside bb (`../references/harness.md`, Inside bb), each component owner is a child thread with `--new-environment worktree`.
4. Verify each component against its baseline via image diff on the matching surface via the control skill. Inside bb, the dev server runs in a bb terminal and its logs come from `bb terminal output <tid>`. Use `bb connect expose <port>` only when the user needs to see it remotely. A nonzero diff is a fail. Investigate the pixel delta. Loop per component until the diff is zero (`/loop` or the harness's long-wait primitive, `../references/harness.md`). Inside bb, report every owner thread as `@thread:<id>` and which still run. Archive each child whose result you collected before the reply (`../references/harness.md`, Archive children when they are done), and give the reason for any you keep.
5. Run **Opening a PR** per component or per safe batch.

**Reply:** components migrated, the diff result for each, the baseline harness location, what's left.
