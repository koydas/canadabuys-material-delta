# Agent-facing data contract (proposed)

**Status: design proposal, not an implemented or published Apify Actor.**

The first product returns **one record per requested official notice ID**, including explicit unsuccessful states. The caller persists successful `nextSnapshot` objects to compare during a subsequent run.

## Input (illustrative)

```json
{
  "watchlist": [
    {
      "noticeId": "OFFICIAL-NOTICE-ID",
      "previousSnapshot": {
        "schemaVersion": 1,
        "noticeId": "OFFICIAL-NOTICE-ID",
        "values": {
          "closingDate": "2026-11-10T15:00:00-05:00",
          "status": "OPEN",
          "title": "Example tender"
        },
        "sourceObservedAt": "2026-11-02T15:00:00Z"
      }
    }
  ],
  "fields": ["closingDate", "status", "title"],
  "maxItems": 50
}
```

All identifiers and values above are illustrative, not observed tender data. Closing date parsing and timezone conventions must be established from the official data dictionary.

### Input rules

- At most 50 unique IDs per call; no wildcard discovery or unbounded search.
- Unknown fields, duplicate IDs, invalid snapshots and unsupported schema versions are rejected or returned as explicit incomplete outcomes.
- An absent `previousSnapshot` is a first observation, **not** a change.
- This initial contract does not accept tenant credentials, bidder documents, or external arbitrary URLs.

## Output (illustrative)

```json
{
  "schemaVersion": 1,
  "noticeId": "OFFICIAL-NOTICE-ID",
  "status": "CHANGED",
  "verification": "VERIFIED_FIELD_COMPARISON",
  "priority": "REVIEW_RECOMMENDED",
  "changes": [
    {
      "field": "closingDate",
      "before": "2026-11-10T15:00:00-05:00",
      "after": "2026-11-12T15:00:00-05:00"
    }
  ],
  "observedAt": "2026-11-03T15:00:00Z",
  "source": {
    "datasetUrl": "https://canadabuys.canada.ca/opendata/pub/tenderNoticeComplete-avisAppelOffresComplet.csv",
    "noticeUrl": null,
    "lastModifiedAt": null,
    "coverage": "FEDERAL_ONLY",
    "attribution": "Contains information licensed under the Open Government Licence – Canada."
  },
  "nextSnapshot": {
    "schemaVersion": 1,
    "noticeId": "OFFICIAL-NOTICE-ID",
    "values": {
      "closingDate": "2026-11-12T15:00:00-05:00",
      "status": "OPEN",
      "title": "Example tender"
    },
    "sourceObservedAt": "2026-11-03T15:00:00Z"
  }
}
```

An executable draft of the output format lives at [`schemas/event.schema.json`](../schemas/event.schema.json). The Apify platform's Actor input/output schemas are different configuration artifacts and will only be generated when the implementation phase begins.

## Meaning of states

| Status | Meaning | Snapshot update |
| --- | --- | --- |
| `FIRST_OBSERVATION` | Current record observed, no compatible prior snapshot | Return current |
| `NO_CHANGE` | Both current and prior values verified and equal | Return current |
| `CHANGED` | Both sides verified, at least one compared field differs | Return current |
| `SOURCE_INCOMPLETE` | Data absent, stale, malformed, ambiguous, unavailable, or incompatible | Return null; retain caller's prior |

`NO_CHANGE` is a positive verified comparison, not a fallback for errors. A record disappearing from the open-only file must **not** become a cancellation. Query the complete dataset or return `SOURCE_INCOMPLETE`.

### Verification

- `VERIFIED_FIELD_COMPARISON`: comparable source snapshots and fields establish a diff or equality.
- `VERIFIED_CURRENT_SNAPSHOT`: a valid first observation, but no change conclusion.
- `UNVERIFIABLE`: cannot make a comparison; explain why in structured error metadata in a future contract revision.

### Priority

- `REVIEW_RECOMMENDED`: closing date or status changed.
- `INFO`: only a title changed.
- `NONE`: observed and unchanged or initial observation.
- `UNKNOWN`: unavailable or incomplete evidence.

A priority hint does not assert legal materiality, an obligation to respond, or completeness of the published amendment.

## Contract evolution

Use an explicit integer `schemaVersion`. Breaking field or meaning changes require a new version, schema conformance tests and an upgrade path. A future production contract must also include a structured reason code for `SOURCE_INCOMPLETE` before public release.
