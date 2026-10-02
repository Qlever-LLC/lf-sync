# FoodLogiQ And Dashboard Handoff

This document hands off the two remaining repositories needed to complete the
new LF Sync product. The LF Sync implementation is in
`/home/sanoel/lf-sync/trellis-nats`; it remains uncommitted, scaled to zero,

## Guardrails

- Do not deploy or test against production until explicitly authorized.
- The development environment is unavailable. Any later production validation
  must be a single controlled canary with CWS concurrency `1`.
- No runtime Legacy OADA adapter is permitted. Legacy OADA is only a finite
  migration input to LF Sync's guarded CLI.
- Do not grant browser clients database, CWS, or Legacy OADA access.
- FoodLogiQ must be the canonical future source. LF Sync consumes Trellis
  events plus FoodLogiQ RPCs and transfers.

## Existing LF Sync Boundary

LF Sync requires `foodlogiq.sync@v1` actions with these exact published
subjects:

| Surface | Subject |
| --- | --- |
| `Documents.Get` | `rpc.v1.foodlogiq.documents.get` |
| `Documents.Files.List` | `rpc.v1.foodlogiq.documents.files.list` |
| `Documents.Files.Head` | `rpc.v1.foodlogiq.documents.files.head` |
| `Documents.Files.Download` | `rpc.v1.foodlogiq.documents.files.download` |
| `Documents.ReadyForLaserfiche` | `events.v1.foodlogiq.documents.ready_for_laserfiche` |
| `Documents.ApprovalRevoked` | `events.v1.foodlogiq.documents.approval_revoked` |

The deployed FoodLogiQ contract currently has these surfaces, but its polling,
normalization, attachment sync, and approval workflow are COI-specific. Keep
the surface names and response shapes backward compatible while generalizing
their implementation.

LF Sync consumes `Documents.ReadyForLaserfiche` in a durable strict-order
consumer group. It rejects a source event if `Documents.Get` reports a current
version different from the event's `sourceVersionId`; do not weaken that check.

### Readiness Event

Every eligible document emits:

```ts
{
  sourceDocumentId: string;
  sourceVersionId: string;
  documentTypeKey: string;
  approval: { state: "approved"; changedAt: string };
  archiveReadiness: {
    state: "ready";
    readinessHash: string;
    reviewDecisionId: string;
    writebackConfirmedAt: string;
  };
  tradingPartnerSource: {
    origin: "foodlogiq";
    sourceType: "business";
    sourceId: string;
  };
  attachments: Array<{
    attachmentId: string;
    sha256: string;
    contentType?: string;
  }>;
  occurredAt: string;
}
```

`readinessHash` must change whenever the approved source version, attachments,
on replay. LF Sync deduplicates the event ID and persists the hash.

Approval reversal emits:

```ts
{
  sourceDocumentId: string;
  sourceVersionId: string;
  priorReviewDecisionId: string;
  revisionDecisionId: string;
  status: "Rejected" | "Awaiting Approval";
  occurredAt: string;
}
```

It must never delete a Laserfiche entry. LF Sync marks corresponding deliveries
`approval-revoked` for operator review.

## FoodLogiQ Sync Work

Repository: `/home/sanoel/foodlogiq/foodlogiq-sync`

### Goal

Generalize the Trellis service from COI-only ingestion to all approved FoodLogiQ

### Implement

1. Replace the COI-only polling boundary with a document-type-aware source
   pipeline. Keep a COI adapter for the existing endpoints and add adapters for
   each approved FoodLogiQ document family.
2. Persist canonical document records with immutable source/version identity,
   source hash, supplier/business identity, approval state, source timestamps,
   and normalized metadata.
3. Persist every versioned attachment, including attachment ID, source version,
   filename, content type, byte length, SHA-256, and object-store key.
4. Keep `Documents.Get`, `Documents.Files.List`, `Documents.Files.Head`, and
   `Documents.Files.Download` version-addressable. `Documents.Get` may remain
   current-version only only if it returns the approved event version unchanged;
   otherwise add a version-specific RPC before enabling LF Sync.
5. Publish `Documents.ReadyForLaserfiche` only after all attachment bytes are
   durable and the FoodLogiQ approval/writeback state is confirmed.
6. Publish `Documents.ApprovalRevoked` for revisions from approved to rejected
   or awaiting approval.
7. Move COI extraction and review into explicit COI-only branches after common
   document/attachment ingestion. Non-COI documents must not require COI
   fields, OCR, or human COI review.
8. Add a durable reconciliation/backfill operation that emits only canonical
   readiness events. It must not call CWS.

### Required Tests

- One non-COI approved document with two versioned attachments reaches durable
  storage and emits exactly one readiness event per `readinessHash`.
- Replayed poll/event does not duplicate attachment records or readiness events.
- A new unapproved version does not replace the previously approved version.
- Approval revocation emits once and does not delete stored source bytes.
- Existing COI document, review decision, attachment download, and extraction
  tests remain green.

### Definition Of Done

- Contract remains `foodlogiq.sync@v1` and the six subjects above are unchanged.
- All approved document types are represented in the common document model.
- FoodLogiQ bytes are available through the existing Trellis receive transfer.
- LF Sync can connect and process a readiness event in no-write mode after the
  authority update is reconciled.

## COI Review App Work

Repository: `/home/sanoel/foodlogiq/coi-review-app`

### Product Surface

Add a **Laserfiche Sync** tab to the existing authenticated app. It is not
limited to COIs. It is a client-facing operational view across every supported
document type.

Use the app's existing visual system, session, routing, and Trellis client.
Do not introduce direct Postgres, CWS, or Legacy OADA calls.

### Capability Model

Request optional LF Sync capabilities through the browser's existing Trellis
session:

| Group | Required LF Sync capabilities |
| --- | --- |
| Viewer | `deliveries.read`, `failures.read`, `reports.read` |
| Exporter | Viewer capabilities plus `reports.export` |

Users without the Viewer group must retain normal COI Review access but not see
the Laserfiche Sync tab. The server enforces every capability independently;
the UI is not the authorization boundary.

### Initial Screens

1. **Overview**: date range, document type, and supplier filters; counts for
   pending, active, completed, partial, failed, review-required,
   approval-revoked, and open failures; throughput/completion-latency trend.
2. **Deliveries**: cursor-paginated table with source document ID, source
   version, document type, supplier, vdoc, status, Laserfiche entry ID/path,
   attempts, and updated time. Link to a detail route, not a modal.
3. **Delivery detail**: source identity, target identity, timeline, current
   status, sanitized failures, and Laserfiche mapping. Never expose CWS request
   headers, tokens, credentials, or raw payloads.
4. **Failures**: filtered, paginated sanitized failure list with stage,
   retryability, occurrence time, and detail link.
5. **Reports**: server-side CSV generation from active filters and session-bound
   Trellis transfer download. Do not construct report files in the browser.

### LF Sync APIs

Use only the LF Sync contract:

- `Dashboard.Summary`
- `Deliveries.List`, `Deliveries.Get`
- `Documents.Status`
- `Failures.List`, `Failures.Get`
- `Reports.List`, `Reports.Get`, `Reports.Download`
- `Reports.Generate` only for Exporters

The present LF Sync implementation exposes the read contract but has reports
and writes deliberately disabled. Build loading, empty, unavailable-capability,
and report-not-yet-generated states now; do not fake data or enable replay,
backfill, or manual sync controls in the first UI release.

### UI Quality Gates

- Follow existing app typography, responsive layout, and component conventions.
- The page must work at desktop and mobile widths.
- Provide accessible table labels, filter labels, focus order, and non-color
  status cues.
- Avoid a generic metric-card grid. Favor a compact operational header, a
  meaningful trend, and the delivery table as the primary working surface.
- Load the app's PRODUCT/DESIGN context and get the required UI design brief
  approval before editing visual code.

### Definition Of Done

- Tab visibility follows optional capability acquisition.
- All data comes through the authenticated Trellis client.
- Paginated lists, unavailable states, sanitized error states, and report
  transfer download work against mocked LF Sync RPCs.
- Existing COI routes and tests remain unchanged.

## Cross-Repository Activation Order

1. Commit LF Sync foundation separately with
   `LF_SYNC_WRITE_MODE=disabled`.
2. Merge and deploy FoodLogiQ source generalization without enabling LF Sync.
3. Reconcile the LF Sync contract authority and provision Postgres plus both
   object-store bindings (`migrationObjects`, `reportObjects`).
4. Deploy LF Sync in no-write projection mode and verify only service health,
   event intake, source projection, and dashboard reads.
5. Run Legacy OADA inventory and import only independently verified completed
   mappings. Stage unresolved failures without submitting them.
6. Deploy the dashboard tab with Viewer access first.
7. Obtain an explicit production canary authorization before any CWS write.
