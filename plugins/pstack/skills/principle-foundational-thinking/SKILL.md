---
name: principle-foundational-thinking
description: "Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious."
disable-model-invocation: true
---

# Foundational Thinking

**Structural decisions** protect option value. **Code-level decisions** protect simplicity.

**Data structures first.** Get the data shape right before writing logic. Define core types early, trace every access pattern, and choose structures that match the dominant paths.

At code level, DRY the structure, not every line. Types and data models should converge. Three similar statements still beat a premature abstraction. Prefer explicit over clever. Test behavior and edge cases, not line counts.

**Concurrency corollary.** Before sharing state between actors, ask "what happens if another actor modifies this concurrently?" If not "nothing", isolate.

In Effect code, the core types are the `Schema` definitions and the service contracts (the exported shape interface of each `Context.Service`), written before any `make` (the **effect** skill's SKILL §5). For concurrency, isolate with a `Ref` per actor or per key. When sharing is real, give one fiber ownership or guard the writer with a `Semaphore`, and fork background fibers with `Effect.forkScoped` so their lifetime is tied to an owner. A layer that runs long-lived work forks it into the layer's scope. Open `references/concurrency.md` §1 and §2 for fibers and `Scope`, and `references/architecture.md` §6 for long-lived work in layers.

**Scaffold first.** If something helps every later phase, do it first. Ask "does every subsequent phase benefit from this existing?" CI, linting, test infrastructure, and shared types are scaffold. Sequence for option value: setup before features, tests before fixes. Keep commits small and single-purpose.

Each increment should land a coherent abstraction or deepen one that exists. Do not spread a new capability across callers as special-case coordination.

Subtraction comes before scaffolding. Remove dead code first, then lay foundations.
