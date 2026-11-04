# Validation gates and test plan

**No implementation or live data runs have been performed.** This document defines the minimum evidence required before building and publishing a paid Actor.

## Gate 0 — Prove demand before implementation

- Identify ten **qualified** prospective consumers (bid-management tool builders, integrators, or firms automating federal tenders), not random Store visitors.
- Produce three **real** before/after examples from two legitimately observed official publications of the **same notice**. Cite both source retrieval dates; do not manufacture old values from the latest record.
- Present a paid pilot offer (for example USD 5 to evaluate the output in an existing workflow).
- **Pass:** at least two independently paying pilots or one paid integration with evidence of repeated usage in 14 days.
- **Stop / pivot:** zero willingness to pay, or changes in officially available structured fields are too infrequent to matter.
- Maximum external expense: CAD 25. Keep human hours recorded separately.

## Gate 1 — Verify source suitability

- Resolve official identifier and field names using the XML dictionary.
- Download and parse both open and complete snapshots; measure compressed/uncompressed file size and execution time.
- Verify the file's update schedule against actual response metadata; no unsupported freshness claims.
- Show a real notice transitioning to closed/cancelled/expired and establish how it appears in the complete feed.
- Verify licensing, attribution wording and treatment of personal information.

## Gate 2 — Offline correctness

Fixture-driven tests must cover:

| Scenario | Expected |
| --- | --- |
| No previous snapshot | `FIRST_OBSERVATION`, not a fabricated change |
| Identical canonical fields | `NO_CHANGE` |
| Closing date changes | `CHANGED` + before/after + `REVIEW_RECOMMENDED` |
| Status changes | `CHANGED` + before/after + `REVIEW_RECOMMENDED` |
| Title changes only | `CHANGED` + `INFO` |
| Record absent from open notices | Check complete feed; never infer cancellation from absence |
| Source download fails or CSV is truncated | `SOURCE_INCOMPLETE`; old snapshot retained |
| Incomplete result carries a new snapshot | Reject against output schema |
| Successful result omits its next snapshot | Reject against output schema |
| Duplicate notice IDs or duplicate official records | Explicit reject/incomplete; no silent arbitrary winner |
| No known source freshness | Null metadata, not a guessed timestamp |
| Snapshot schema incompatible | Explicit non-success; no comparison |
| Two independent customer watchlists | No shared user-specific state |
| Non-federal or out-of-scope attachments | Coverage limitation documented, not falsely verified |

Add property tests for comparison idempotence, deterministic sorting and snapshot round-trip. Ensure a changed status never gets flattened into a successful `NO_CHANGE` because of a parser exception.

## Gate 3 — Apify technical validation

- Local Actor input parsing and dataset output schemas accepted by the actual Apify CLI/runtime.
- Cap at 50 IDs, timeouts, retry budgets, data size and CPU/memory measured against official sources.
- No secret leakage or retention of customer watchlist data.
- Per-run accounting includes **zero-change** runs and incomplete outcomes, not just changes.
- A consumer can take an output snapshot, persist it, and safely pass it into the next run.

## Gate 4 — Economics and recurring usage

Track per paying consumer: calls/week, useful changed notices, cost per check, Apify commission, gross receipts, contribution margin, repeat usage and support time. Do not label free users, views or one-off calls as recurring revenue.

Initial pricing is an **experiment**, not a published promise. Re-evaluate after empirical source-fetch costs and buyer feedback.
