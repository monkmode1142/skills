### Runtime forensics

**You own the diagnosis. Instrument the live process, don't theorize from source.** The deliverable is a cited diagnosis, not a fix.

1. Capture the live signal on the matching surface via the control skill: a CPU profile for a spinning process, a heap snapshot for a leak, a CDP trace for a visual glitch. A real artifact, not a guess. For an Effect program, export its spans through a `Tracer` layer. The `Effect.fn` span that holds the time, or never closes, names the suspect. Take the exporter wiring from the effect skill's `references/platform.md` §14, after its SKILL §1 version gate. Inside bb, when you start the process yourself, run it in a bb terminal and read its logs with `bb terminal output <tid>` (`../references/harness.md`, Inside bb).
2. Reduce the artifact to the smoking gun: the function on the hot path, the retainer chain from the leaked object to a GC root, the loop firing without input. Parse large artifacts in a subagent (the **principle-guard-the-context-window** skill), keep the reduced finding in the main thread. In an Effect program, a fiber that never ends or a resource that never closes usually traces to an unjoined fork or an unscoped resource, per the effect skill's `references/concurrency.md` §1 and §2.
3. Prove the mechanism before believing it. Inject instrumentation via CDP eval on the running process, or hotfix the live code without reloading, to confirm the hypothesis cheaply.
4. Map the finding back to source: file, symbol, the line that allocates or schedules.
5. Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only forensics`.

**Reply:** the signal captured, the reduced finding, how you proved the mechanism, the source location, artifact paths. No fix unless asked. Hand back to Bug fix or Perf once the cause is known.
