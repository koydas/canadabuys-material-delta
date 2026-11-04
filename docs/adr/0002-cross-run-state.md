# ADR-0002 — Caller-owned snapshots before hosted persistent watchlists

- **Status:** Proposed
- **Date:** 2026-11-03

## Context

A delta requires a prior observation. Apify run-local storage alone is not evidence of durable state across independent runs. A globally named shared store could mix different customers' watchlists or leak confidential monitoring preferences.

Building tenant-aware persistent watchlists before demand validation adds unnecessary authentication, lifecycle, and support complexity.

## Decision

For the first design, an Actor call supplies the **previous observed snapshot** for each monitored notice (or omits it for a first observation). The output contains a replacement snapshot for successful observations, which the caller persists for the next invocation.

The Actor is stateless with respect to customer watchlists. Fetch caching may be shared only for **public source data**, never a user's watchlist or identifiers. Limits are enforced for notice count and input size.

## Contract consequences

- Missing previous snapshot => `FIRST_OBSERVATION`, never `CHANGED`.
- Official source unavailable, malformed, truncated or record not found => `SOURCE_INCOMPLETE`; **do not replace** caller's last good snapshot.
- Same canonical field values => `NO_CHANGE`; changed canonical values => `CHANGED`.
- Each returned snapshot identifies source dataset, observation time and schema version.
- Only compare snapshots produced by compatible versions of this contract; incompatible versions produce an explicit non-success status.
- Inputs and outputs must not contain bidder-private documents or credentials.

## Trade-offs

The consumer must store snapshots and schedule calls, which may reduce adoption. A future per-customer persistent watchlist service can be added only after a paying workflow demonstrates a need for it, with explicit isolation, authorization, expiration and deletion policies.

## Alternatives deferred

- Actor-wide named key-value store for customer-specific histories.
- Database or SaaS control plane.
- Cross-customer alert subscriptions and push notifications.

## Validation

Test independent caller A/B state, incomplete sources, first observation, repeat observation, deletion/absence ambiguity and schema version mismatch before any release.
