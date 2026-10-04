---
name: principle-boundary-discipline
description: "Apply when wiring validation, error handling, or framework adapters. Concentrate guards at system boundaries (CLI, config, network, external APIs); trust internal types and keep business logic in pure functions."
disable-model-invocation: true
---

# Boundary Discipline

Place validation, type narrowing, and error handling at system boundaries. Trust internal code unconditionally. Business logic lives in pure functions. The shell is thin and mechanical.

**Why:** Scattered validation is noisy, redundant, and gives a false sense of safety. Keep logic out of framework wiring so it can be tested without the framework.

**The pattern:**
- **At boundaries** (CLI args, config files, external APIs, network protocols): validate, return errors, handle defensively.
- **Inside the system:** typed data, error propagation, no re-validation. Trust the types.
- **Across the boundary.** Expose domain concepts, not the boundary's private representation. Keep general-purpose mechanism inside and special-purpose policy at the edge.

**Applications:**

Validation and error handling:
- Validate config at parse time (the boundary), not inside business logic
- Parse raw data into domain types at the boundary
- Do not re-export transport, storage, framework, or wire types through the public surface
- No redundant nil checks deep in call chains if the boundary already validated

Code organization:
- Business logic in pure functions with no framework dependencies
- Parse functions: pure transforms from raw bytes to typed state
- Prompt construction: structured state in, string out
- Scoring and assessment: pure transforms from state to results

**In Effect (TypeScript).** The boundary is a service at a port. Decode input there with `Schema.decodeUnknownEffect`, hoisted to module scope. Wrap foreign Promise APIs once with `Effect.tryPromise({ try, catch })`, and collapse vendor failures (`HttpClientError`, `SqlError`, `SchemaError`) into the service's own `Schema.TaggedError` family with `Effect.mapError` or `Effect.catchReason`, so none leak inward. Decode external arrays element by element, logging and dropping the bad rows, so one malformed item degrades to a logged partial instead of a blank result. Inside, code runs on decoded types and never re-checks. Business logic stays in plain functions beside the types. The service's `Effect.fn` methods are the thin shell that reads `Clock`, repositories, and clients from the environment and calls those functions. Open the **effect** skill's `references/schema.md` §7 for the decode runners, `references/errors.md` §7 for mapping at the port, SKILL §6 for element-by-element decoding, and SKILL §4 with `references/architecture.md` §2 for the service and layer forms.

**The tests:**
- "Is this data crossing a system boundary right now?" If not, validation is redundant.
- "Can this be a pure function that the shell just calls?" If yes, extract it.
