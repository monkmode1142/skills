# Thinking and writing in pstack

pstack is strong at building and proving code. Four companion skills cover the work before and after it: settling what the work is for, deriving a choice instead of borrowing one, finding the one idea a unit carries, and writing it so a reader can reconstruct the reasoning. They are installed globally and are not part of pstack, so pstack routes to them and never copies their text. This file is the route.

| Skill | Owns |
|---|---|
| **shape-an-idea** | A coherent, correctable model of an ambiguous goal before a form or method is chosen |
| **reason-from-first-principles** | The chain facts + goals → scoped principles → model → decision, with costs and what would reopen it |
| **find-the-kernel** | The central idea and distinct job of a whole work or one unit |
| **distill-writing** | Selecting and connecting the ideas a reader needs, then writing the smallest complete explanation. Its `references/decision-writing.md` covers any document that argues for a choice, and `references/read-back.md` is the fresh-reader review |

## Where each one enters

| pstack moment | Use |
|---|---|
| The request is a brain dump, the goal keeps shifting, or the work has drifted into a method before its purpose is settled | **shape-an-idea** before picking a playbook. Restate the goal so the user can correct it, then route |
| Feature, figure-it-out, or multi-phase-plan with an ambiguous purpose | **shape-an-idea** as step 0. Its model feeds the data shape, never replaces it |
| "Should we do X or Y", "why does this follow", a recommendation resting on convention | **reason-from-first-principles**. In Investigation it shapes the recommendation. Use **why** first when the question is why something already exists, and feed its findings in as premises |
| Two or more fixes failed on one premise (**principle-attack-the-premise**), or a new requirement forces a redesign (**principle-redesign-from-first-principles**) | Those principles say when. **reason-from-first-principles** is how |
| **architect** rationale, **interrogate** lead judgment on a contested design | **reason-from-first-principles** for the derivation, `distill-writing/references/decision-writing.md` for writing the choice |
| A module, section, PR, or explanation whose job you cannot state in a sentence | **find-the-kernel**. A unit with no distinct job merges or goes |
| Any prose a person will read: replies, PR descriptions, briefs, READMEs, RFCs, plans | **distill-writing** chooses what to say. **technical-writing** sets document form and sentences. **unslop** strips AI tells last. Run them in that order |
| A plan, ADR, proposal, or PR whose job is to argue for a choice | **distill-writing** plus its `references/decision-writing.md`. Keep "why change" apart from "why this" |
| A substantial document before you hand it over | `distill-writing/references/read-back.md`, run by a fresh `judgment and prose` subagent that gets the audience persona and the draft, never your notes |
| **pstack-teach**, **how** explanations | **find-the-kernel** on the subject, then **distill-writing** for the explanation |

## Conflicts

- **Interviews.** Neither skill set makes an interview a stage. Infer from context, then ask only the questions that would change the work, per poteto-mode's ask-the-user rule.
- **Style.** **distill-writing** governs substance. **unslop** governs surface. When they seem to disagree, keep the meaning distill-writing protects and fix the surface another way.
- **Stack add-ons.** Writing about code a stack add-on covers still runs its version gate for technical claims (`references/harness.md`, Stack add-ons). A sentence about an API is only as true as the version gate behind it.
