# ADR-0003 — A read-only source probe, before any collector or Actor code

- **Status:** Proposed
- **Date:** 2026-11-04

## Context

[Gate 1](../validation.md) requires real facts about the official sources: column names, date format, file size, encoding, update metadata, and whether one notice ID can appear on several rows. The design documents mark these as unverified. They must be measured, not assumed, before the contract is frozen. The development environment of the author's agent cannot reach the official hosts, so the measurement runs on a GitHub-hosted runner.

[ADR-0001](0001-scope-and-evidence.md) forbids republishing personal contact fields; [ADR-0002](0002-cross-run-state.md) keeps the product free of customer state.

## Decision

1. Add one script, `scripts/probe-source.mjs` (Node ≥ 20, no dependencies), and one manually triggered workflow, `.github/workflows/probe-source.yml`.
2. The probe only issues `HEAD`/`GET` requests to the three official URLs and reports structural facts: headers, sizes, SHA-256, delimiter, BOM, column names, fill and distinct counts, ID multiplicity, date-shape patterns, and which open-feed IDs are absent from the complete feed.
3. A source counts as fully parsed only if every byte arrived, decoded as UTF-8, closed every quoted field and yielded a header. Otherwise it is marked INCOMPLETE in the report, the workflow fails, and no cross-feed comparison is computed from it. A truncated dictionary is not written out.
4. Values and shapes of contact-like columns are never written to the report. Raw CSV files are not uploaded; only the report and the public dictionary XML are.
5. The workflow has `contents: read`, no schedule, and no repository write. Report artifacts expire after 14 days.
6. Findings are interpreted by a human or agent in `docs/source-verification.md`, citing the report's date and hashes. The probe is not product code and is not reused by an Actor unless a later ADR says so.

## Out of scope (needs its own ADR)

Scheduled snapshot archiving, any stored copy of the CSVs, any watchlist, and any Actor code. Archiving is needed to obtain real before/after pairs for Gate 0, but its storage location, retention and licence handling are separate decisions.

## Consequences

The repository is no longer documentation-only; its README says so. A probe run proves the sources' structure at one instant, not their stability.
