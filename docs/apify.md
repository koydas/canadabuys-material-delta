# Apify packaging and publication plan (deferred until Gate 0)

**Nothing is currently deployed to Apify.** This file is a release checklist, not a configuration that pretends the Actor exists.

## Minimum deployable package after business validation

- A small Python Actor with official CSV fetch, strict parsing, deterministic diff and result serialization.
- `.actor/actor.json` for Actor metadata, with paths to actual input/output schemas.
- `.actor/input_schema.json` describing the bounded watchlist and previous snapshots.
- `.actor/output_schema.json` pointing to the results Dataset; dataset schema if helpful.
- A reproducible local run, offline source fixtures and unit tests.
- Store README including an example agent invocation, known limits, source attribution and explicit non-endorsement.

Apify uses the `.actor` directory to configure the Actor and schemas. Do not assume that a conventional JSON Schema for event payloads is identical to the Apify input or output configuration format.

## Delivery and discovery

Initially expose one Actor through Apify's standard Actor API and existing MCP access. **No custom MCP server** unless concrete buyers require a bespoke interface. Keep the input/output tool description short and semantically unambiguous: compare previously observed federal tender notice fields; it cannot read or judge tender attachments.

A user/agent schedules calls and stores last good snapshots. The Actor returns explicit results for all requested IDs so `NO_CHANGE` and `SOURCE_INCOMPLETE` can be distinguished.

## Charging hypothesis (to verify before listing)

Start with a low fixed price **per bounded check/batch**, not only per emitted change: customers consume computation on runs with no changes. Validate current Apify pay-per-event mechanics, fee schedule and billing semantics in the platform UI before selecting real event prices. Calculate margin including CSV transfer, retries and storage, not only CPU.

Do **not** assert automatic subscriptions or recurring customers. Recurrent income requires actual repeated paid calls.

## Release gates

1. Gate 0 commercial interest passed.
2. Official data dictionary and real file characteristics verified.
3. Offline fixture suite passes and captures failure/uncertainty states.
4. Apify build and schema validation pass.
5. Privacy/licensing/attribution and run-cost checks pass.
6. Publish unlisted or a controlled test first; publish to Store only after real consumption evidence.

## Documentation references

- https://docs.apify.com/actors/development/quick-start/locally
- https://docs.apify.com/actors/development/actor-definition/output-schema
- https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2
- https://open.canada.ca/en/open-government-licence-canada
