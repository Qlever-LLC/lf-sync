# LF Sync Contract

The authoritative source is `contracts/lf_sync.ts`. Payloads are authored as
TypeBox schemas in `schemas/schemas.ts` and referenced with the Trellis
`ref.schema(...)` builder. The contract targets `@qlever-llc/trellis`
`0.11.0-rc.11`.

## Capability Names

The source declares local names without a namespace prefix. Trellis emits them
under `lf-sync::`.

| Local capability    | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `deliveries.read`   | Read dashboard delivery totals, delivery records, and document status.  |
| `reports.read`      | Read report metadata and status.                                        |
| `reports.export`    | Generate reports and receive report file transfers.                     |
| `sync.request`      | Request sync for an approved FoodLogiQ document.                        |
| `failures.read`     | Read sanitized failures.                                                |
| `failures.manage`   | Replay corrected failures.                                              |
| `backfills.control` | Run, observe, cancel, and control backfills.                            |
| `admin`             | Additional grant required for high-impact replay and backfill controls. |

## RPCs

| RPC                 | Input schema                          | Output schema                          | Call capability                                    |
| ------------------- | ------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| `Dashboard.Summary` | `LfSyncDashboardSummaryRequestSchema` | `LfSyncDashboardSummaryResponseSchema` | `deliveries.read`, `failures.read`, `reports.read` |
| `Deliveries.List`   | `LfSyncDeliveriesListRequestSchema`   | `LfSyncDeliveriesListResponseSchema`   | `deliveries.read`                                  |
| `Deliveries.Get`    | `LfSyncDeliveriesGetRequestSchema`    | `LfSyncDeliveriesGetResponseSchema`    | `deliveries.read`                                  |
| `Documents.Status`  | `LfSyncDocumentsStatusRequestSchema`  | `LfSyncDocumentsStatusResponseSchema`  | `deliveries.read`                                  |
| `Failures.List`     | `LfSyncFailuresListRequestSchema`     | `LfSyncFailuresListResponseSchema`     | `failures.read`                                    |
| `Failures.Get`      | `LfSyncFailuresGetRequestSchema`      | `LfSyncFailuresGetResponseSchema`      | `failures.read`                                    |
| `Reports.List`      | `LfSyncReportsListRequestSchema`      | `LfSyncReportsListResponseSchema`      | `reports.read`                                     |
| `Reports.Get`       | `LfSyncReportsGetRequestSchema`       | `LfSyncReportsGetResponseSchema`       | `reports.read`                                     |
| `Reports.Download`  | `LfSyncReportsDownloadRequestSchema`  | `LfSyncReportsDownloadResponseSchema`  | `reports.export`                                   |

List requests use a typed `filter` object and `LfSyncPaginationRequestSchema`.
Responses use cursor-based `LfSyncPageInfoSchema`; no RPC accepts an untyped
query language.

`Reports.Download` is a Trellis receive-transfer RPC. Its response contains a
typed `TransferGrant` and `FileInfo`; callers receive bytes over the negotiated
transfer subject rather than in the RPC response or through an external URL.

## Operations

All operations use `LfSyncOperationProgressSchema` and support cancellation.

| Operation          | Input schema                         | Output schema                       | Authorization                                                                      |
| ------------------ | ------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------- |
| `Reports.Generate` | `LfSyncReportsGenerateRequestSchema` | `LfSyncReportsGenerateResultSchema` | call/control/cancel: `reports.export`; observe: `reports.read`                     |
| `Documents.Sync`   | `LfSyncDocumentsSyncRequestSchema`   | `LfSyncDocumentsSyncResultSchema`   | call/control/cancel: `sync.request`; observe: `deliveries.read`                    |
| `Failures.Replay`  | `LfSyncFailuresReplayRequestSchema`  | `LfSyncFailuresReplayResultSchema`  | call/control/cancel: `failures.manage` and `admin`; observe: `failures.read`       |
| `Backfills.Run`    | `LfSyncBackfillsRunRequestSchema`    | `LfSyncBackfillsRunResultSchema`    | call/control/cancel: `backfills.control` and `admin`; observe: `backfills.control` |

The only backfill scope is `all-approved-foodlogiq-documents`. Date bounds and
resume cursors partition that complete scope; they do not create an alternate
document eligibility policy.

## Events

The service publishes lifecycle events using the Trellis `service` capability.
Subscribers require the listed local read capabilities.

| Event                             | Event schema                               | Subscribe capability               |
| --------------------------------- | ------------------------------------------ | ---------------------------------- |
| `LfSync.Document.Requested`       | `LfSyncDocumentRequestedEventSchema`       | `deliveries.read`                  |
| `LfSync.Document.Completed`       | `LfSyncDocumentCompletedEventSchema`       | `deliveries.read`                  |
| `LfSync.Document.Partial`         | `LfSyncDocumentPartialEventSchema`         | `deliveries.read`, `failures.read` |
| `LfSync.Document.Failed`          | `LfSyncDocumentFailedEventSchema`          | `failures.read`                    |
| `LfSync.Document.ReviewRequired`  | `LfSyncDocumentReviewRequiredEventSchema`  | `failures.read`                    |
| `LfSync.Document.ApprovalRevoked` | `LfSyncDocumentApprovalRevokedEventSchema` | `deliveries.read`                  |

Every event contains stable event, correlation, and source-document ids plus an
ISO 8601 occurrence timestamp. Failure-bearing events use the same sanitized
failure shape as public RPCs.

## Sanitized Failures

`LfSyncFailureSchema` exposes operator-safe context and an optional
`clientFailure` described by `LfSyncSanitizedClientFailureSchema`. That client
object is closed with `additionalProperties: false` and contains only:

- `sanitized: true`
- `client`
- optional `operation`
- optional sanitized `endpoint`
- optional HTTP `statusCode`
- optional bounded `errorCode`
- bounded `reason`
- optional bounded `responseSummary`
- optional `requestId`

Raw requests, response bodies, credentials, headers, stack traces, and database
diagnostics are not contract fields and must be removed before persistence or
publication.

## Private Jobs

| Queue                 | Boundary                                                        |
| --------------------- | --------------------------------------------------------------- |
| `processSourceEvent`  | Normalize and idempotently accept one subscribed source event.  |
| `loadSourceDocument`  | Call the FoodLogiQ document and file read surfaces.             |
| `prepareDelivery`     | Validate and persist one target delivery before a CWS mutation. |
| `submitLaserfiche`    | Perform the write-mode-guarded idempotent CWS submission.       |
| `finalizeDelivery`    | Commit terminal projection state and lifecycle outbox records.  |
| `processBackfillPage` | Enqueue one deterministic page of approved FoodLogiQ documents. |
| `generateReport`      | Build a report object for later Trellis transfer.               |

Every private job payload includes an `idempotencyKey`. Queue descriptors use
that field as a keyed-concurrency token with one active job, heartbeat expiry,
and `fail-stale` recovery. These queues are implementation details, not public
workflow entry points. Public callers use operations; source intake and the
transactional outbox create private work.

Job retry limits in the descriptor are safe queue defaults. Runtime policy must
also enforce `LF_SYNC_MAX_ATTEMPTS`, write mode, idempotency, and current
approval state before a CWS mutation.

## FoodLogiQ Dependency

`contracts/foodlogiq_sync.ts` locally authors typed action descriptors for the
required `foodlogiq.sync@v1` production vocabulary. `documentTypeKey` is a
non-empty string, not a closed enum, so new approved FoodLogiQ document types do
not require an LF Sync contract release.

| Direction | Action                         | Exact subject                            |
| --------- | ------------------------------ | ---------------------------------------- |
| subscribe | `Documents.ReadyForLaserfiche` | `events.v1.Documents.ReadyForLaserfiche` |
| subscribe | `Documents.ApprovalRevoked`    | `events.v1.Documents.ApprovalRevoked`    |
| call      | `Documents.Get`                | `rpc.v1.Documents.Get`                   |
| call      | `Documents.Files.List`         | `rpc.v1.Documents.Files.List`            |
| call      | `Documents.Files.Head`         | `rpc.v1.Documents.Files.Head`            |
| call      | `Documents.Files.Download`     | `rpc.v1.Documents.Files.Download`        |

`Documents.Files.Download` is itself a typed receive-transfer RPC. LF Sync does
not place attachment bytes in job payloads, event payloads, or database rows.

Both upstream events belong to the durable LF Sync event-consumer group
`sourceDocuments`. The group replays all retained source events, preserves
strict ordering, and uses finite acknowledgement, delivery, and backoff limits.
Both event subscribe descriptors also appear in top-level `uses`, as rc.11
requires.

## Object Store

The required `migrationObjects` Trellis object store is durable staging for the
finite Legacy OADA migration only. It has no requested TTL. Normal FoodLogiQ
intake and report downloads must not turn it into a general runtime file store.

## Consumer Notes

- Timestamps use JSON Schema `date-time` strings.
- Identifiers are opaque non-empty strings; clients must not parse them.
- Cursor values are opaque and cannot be synthesized by clients.
- Missing optional values are omitted rather than represented as `null`.
- Objects reject undeclared fields, including failure detail fields.
- `ValidationError` indicates invalid caller input. `UnexpectedError` is a
  sanitized service boundary error and must not expose internal causes.
