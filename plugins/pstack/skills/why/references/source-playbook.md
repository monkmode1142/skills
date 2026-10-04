# Source playbooks

The why skill spawns one investigator per available evidence category. Source control has a concrete playbook. The other categories have no vendor-specific playbook. Give their investigators the category guidance below and let them adapt it to whatever MCP or CLI the session has for that category.

| Category | Playbook | Typical sources |
|---|---|---|
| Source control history | [`code-archaeology.md`](./sources/code-archaeology.md) | git, `gh` |
| Issue / ticket tracker | Generic guidance below | GitHub Issues, Plane, Shortcut, or whatever MCP or CLI the session has for it |
| Long-form documents | Generic guidance below | Confluence, Google Docs, Coda, an in-repo docs folder, or whatever MCP or CLI the session has for it |
| Real-time team chat | Generic guidance below | Discord, Microsoft Teams, Mattermost, or whatever MCP or CLI the session has for it |
| Infrastructure observability | Generic guidance below | New Relic, Honeycomb, Grafana, Splunk, or whatever MCP or CLI the session has for it |
| Error / exception tracking | Generic guidance below | Rollbar, Bugsnag, Airbrake, or whatever MCP or CLI the session has for it |
| Product analytics warehouse | Generic guidance below | Snowflake, BigQuery, ClickHouse, dbt, or whatever MCP or CLI the session has for it |

Cross-cutting:

- [`incident-postmortem.md`](./sources/incident-postmortem.md). Add this if the target code looks defensive (null checks, retry, timeout, rate limit, feature flag, egress guard, OOM handler).

## Generic guidance per category

Every investigator starts from the code anchor. Search by the ticket IDs, PR numbers, file paths, symbols, and error strings it contains, then widen to the feature name and the date window around the target's commits. Read the tool's server instructions or `--help` before the first query. Record every query verbatim.

- **Issue / ticket tracker.** Fetch every ticket ID from the anchor in full, including comments, sub-issues, and linked parents. Then search by feature name and labels such as `incident`, `bug`, or `customer`. Best evidence is a problem statement written before the code shipped.
- **Long-form documents.** Search for design docs, RFCs, specs, and postmortems naming the feature, the subsystem, or the PR. Read the alternatives and rejected-options sections in full. Note the doc's last-edited date against the code's ship date.
- **Real-time team chat.** Search for PR links, ticket IDs, and error strings in the window around the target commits. Read whole threads, not single messages. Cite permalinks.
- **Infrastructure observability.** Look for incidents, monitors, and dashboards tied to the target service around the ship date. Check whether the signal the code reacts to (latency, error rate, saturation) moved before and after the change.
- **Error / exception tracking.** Search for issues whose stack traces pass through the target or whose message matches an error string in it. Compare first-seen and last-seen against the PR's merge date.
- **Product analytics warehouse.** Query only read-only. Find the events, flags, or experiments that gate or measure the target. Look for a metric shift around the ship date and for where any hard-coded threshold came from. Report the query text with every number.
