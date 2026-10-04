---
name: principle-model-the-domain
description: "Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files. Encode the domain in a structure instead of scattered conditionals."
disable-model-invocation: true
---

# Model the Domain

Encode the real domain in a data structure instead of scattering it across conditionals.

**Why:** Scattered booleans, repeated shape assumptions, and branching spread across files are accidental complexity. A structure that matches the domain makes invalid states unrepresentable and deletes branches. Choosing it at write time is cheap. Recovering it later reads as a refactor and gets deferred.

**Reach for structures like these:**

- A state machine instead of scattered booleans, phases, or lifecycle checks.
- A typed object/model instead of loose parameters or repeated shape assumptions.
- A map, registry, lookup table, or discriminated union instead of branching spread across files.
- A reducer or command/event model instead of ad hoc state mutations.
- A module organized around one body of domain knowledge instead of a sequence such as load, validate, transform, and save. Execution order is not ownership.
- A small module boundary that gathers repeated behavior, ownership, or invariants.
- A queue, cache, index, graph/tree, or normalized collection where the data access pattern calls for it.
- Any other structure that fits. When none fits, work out what the code must never allow and how the data gets read, then find the structure that encodes exactly that.

In Effect code, the states of a machine are a `Schema.TaggedUnion`, or `Schema.TaggedClass` members of a `Schema.Union` when the states need methods. The transitions are pure functions beside the types, and `Match.valueTags` turns a new state into a compile error at every site that does not handle it yet. Failures are domain too. A `Schema.TaggedError` per outcome replaces an error string that callers parse. Open the **effect** skill's `references/schema.md` §8 for modeling guidance and `references/errors.md` §2 for error granularity.

Do not force an abstraction. Prefer boring code if the current shape is already clear, local, and unlikely to grow. Be skeptical of an abstraction that adds indirection without removing branches, duplicated rules, invalid states, or lifecycle risk.

The sign that you skipped this is a new feature that grows an existing if/else chain by one more branch, or a second boolean that must stay in sync with the first. Temporal decomposition is another sign. Phase-named modules repeat the same domain rules across steps.
