# ADR-0001 — Tender deltas are field evidence, not legal materiality

- **Status:** Proposed
- **Date:** 2026-11-03

## Context

CanadaBuys publishes structured federal tender notices, including amendments. Other tools can already detect new or modified notices. A useful, narrower service would explain the observable change rather than repeat the entire feed.

An agent may use this output to decide whether a human should revisit a bid, but the provider cannot determine the legal consequences of changes in tender documents from CSV fields alone.

## Decision

1. Compare only **explicitly selected, officially published structured fields** for known notice IDs. Initial fields: closing date, status, title.
2. Emit the exact before and after values, an official source link, observed timestamp and an explicit verification state.
3. Mark closing-date or status changes as `REVIEW_RECOMMENDED`, never as legally `ACTION_REQUIRED`.
4. Distinguish `FIRST_OBSERVATION`, `NO_CHANGE`, `CHANGED`, and `SOURCE_INCOMPLETE`. A missing record or failed fetch is not proof of unchanged status.
5. Attribute the Government of Canada open dataset and never imply affiliation or endorsement.

## Alternatives rejected for MVP

- **AI summary of attachment changes:** the published CSV does not establish complete attachment semantics.
- **Generic Canadian procurement aggregator:** provincial and municipal notices are outside the federal dataset.
- **LLM-based materiality classifier:** expensive and difficult to substantiate without a labeled dataset and legal/business context.

## Consequences

The product is narrower and more trustworthy. Some user-important amendments will not be detected. An agent must be told about this coverage limitation; no claim of comprehensive amendment monitoring is permitted.

## References

- https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2
- https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html
- https://open.canada.ca/en/open-government-licence-canada
