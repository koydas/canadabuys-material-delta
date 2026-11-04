# CanadaBuys Material Delta

**Detect decision-relevant changes in Canadian federal tender notices, with reproducible field-level evidence.**

> **Status: design only.** No Actor implementation, hosted service, scheduled monitoring, or paying customers exist yet. The product hypothesis is unvalidated. The only code is a manually triggered, read-only [source probe](docs/adr/0003-read-only-source-probe.md) used to verify the official data.

## The narrowly scoped problem

Existing feeds can tell an automation that a federal tender notice was updated. This project aims to answer a smaller question: **which monitored fields changed, what were the old and new values, and should an agent review its bid plan?**

It is **not** a tender discovery product, a recommendation engine, or an authoritative source of bid instructions. Its primary consumer is an automation or AI agent already tracking official notice IDs.

## MVP contract (proposed)

- **Input:** a bounded watchlist of federal notice IDs and each notice's last observed field snapshot.
- **Output:** deterministic `FIRST_OBSERVATION`, `NO_CHANGE`, `CHANGED`, or `SOURCE_INCOMPLETE` result per notice.
- **Evidence:** old/new field values, official dataset and notice links where available, observation time, and source freshness metadata *only when supported by evidence*.
- **Priority:** closing date or status changes prompt review; they never assert that a bidder is legally obliged to act.
- **Safe failure:** missing, stale, truncated, ambiguous or malformed source data must not become `NO_CHANGE`.

A first MVP will compare the closing date, status and title only. Attachment contents, unofficial procurement sites, inferred legal materiality, personalized tender matching and LLM interpretation are explicitly out of scope.

## Verified source boundaries

[CanadaBuys tender notices](https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2) cover **federal organizations only**, even though the CanadaBuys website can display notices from other levels of government.

- The **new-notices** feed is refreshed every two hours during its published daily window; it is not the authoritative amendment stream.
- The **open-notices** and **complete-notices** CSV files are refreshed daily, and include amendments represented in their published structured fields.
- Publication delay can exceed the source refresh schedule. There is no real-time guarantee.
- The [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada) permits commercial reuse subject to attribution and other terms.

Always verify critical dates and tender attachments on the official CanadaBuys notice before submitting a bid. This project is unaffiliated with the Government of Canada.

## Documents

- [Architecture and state boundary](docs/architecture.md)
- [Proposed event contract](docs/contracts.md) and [draft JSON schema](schemas/event.schema.json)
- [ADR 0001: scope and evidence](docs/adr/0001-scope-and-evidence.md)
- [ADR 0002: cross-run state](docs/adr/0002-cross-run-state.md)
- [ADR 0003: read-only source probe](docs/adr/0003-read-only-source-probe.md)
- [Validation gates and test plan](docs/validation.md)
- [Apify publication plan](docs/apify.md)

## Business hypothesis, not a demand claim

Buyers may pay for **verified, field-level deltas** rather than full tender feeds. That willingness to pay is **not established** by the existence of competing Actors or paid procurement services. The first milestone is a paid validation pilot, not a production deployment.

The project will not add a dashboard, generic scraping engine, a dedicated MCP server, LLM inference, or cross-project shared framework unless demand warrants it.

## Attribution

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). Any commercial output must preserve appropriate source attribution and links.
