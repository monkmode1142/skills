# Approved example

A post the author approved, after applying the selection tests. That week's corpus had no cards for non-work bookmarks, so the post has none; a normal week should include at least one.

---

brain dump for the week

62 of my 281 bookmarks mention jev. it's typesafe's model that answers a question you define with a probability instead of writing text, so it's fast and cheap enough to drop into ordinary code.
- [a PR check](https://x.com/isaac_ts_way/status/2100640617923555754) that asks 14 yes/no questions about a diff (secrets exposed? auth changed? tests deleted?) and sends the unsure ones to a human
- someone [found](https://x.com/parcadei/status/2101801605121094138) that just reordering the answer options can flip the result. asking "is there enough info to decide?" as a separate question was steadier

testing:
- steipete [deleted ~400k lines of tests](https://x.com/steipete/status/2103147927313199260) and coverage barely changed. the [skill they used](https://t.co/a1jSBpfpns) is basically a checklist for "what bug would this test actually catch"
- anthropic's [migration kit](https://t.co/3cdk89J3Tw) sets up the test harness before translating any code, and first makes sure it catches intentionally broken code. the harness still had bugs

shipping:
- swizec's team [auto-merges about 15% of PRs](https://t.co/WLUoy0GFpg) (22 of 143). the rules are the interesting part: human-written only, no migrations, no public API changes, no financial code, every check green, zero review comments
- linear [reworked their CI](https://t.co/gkEIqwrwjn). the suite got ~4x bigger and PR wait times still went down. sharing state between tests was one of the bigger wins, and it also caused bugs until they added cleanup rules

design:
- jakub krehel's [interface cheat sheet](https://t.co/sivx8o29nD): alignment, type, animation and color-naming rules, each with an example
- emil kowalski on [`text-wrap: pretty`](https://x.com/emilkowalski/status/2103124466352210045), one line of css so paragraphs stop ending on a lonely word

reading:
- [how claude.ai got 3x faster](https://t.co/mgvK8mJRuD). they turned down ~900 lines of code that would have saved 2ms
- hamel & shreya on [finding hidden failures with evals](https://t.co/fxOI7PMgWF). a leasing bot politely ends the chat when someone says it's too expensive. a generic eval calls that fine, but the team wanted it to offer cheaper units
- drew breunig on [prompt advice going stale](https://x.com/dbreunig/status/2102449351322947900): instructions tuned for an older model can work against a newer one
- sunil pai, [the senior engineer death spiral](https://t.co/3f6YFDZ3fB), on disappearing into a big solo project to prove yourself, and getting out with small, visible work

and ryo lu [asking](https://x.com/ryolu_/status/2102933485795369213) whether more PRs and more agents make anything better
