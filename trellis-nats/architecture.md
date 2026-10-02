# LF Sync Target Architecture

The deployment-ready CWS, filing workflow, Drizzle/Postgres, format-integrity,
duplicate-reconciliation, reporting, and resync design is in
`docs/production-service-design.md`.

The deferred Qlever-admin exception report, including format-decision audit
requirements and its activation prerequisites, is in
`docs/admin-exception-report.md`.

## Scope

LF Sync is a contract-first Trellis service that delivers every approved
FoodLogiQ document to Laserfiche. It also owns the delivery, failure, report,
and backfill projections used by the client dashboard.

The service boundary is `lf-sync@v1`, authored for Trellis `0.11.0-rc.11`.
Trellis RPCs, operations, and events are NATS surfaces; the service does not
create a parallel REST API. HTTP is limited to health endpoints and external
adapters such as Laserfiche CWS and the approved FoodLogiQ integration.

This directory contains the contract, schemas, persistence, runtime handlers,
and deployment safety controls. The deployment runs in no-write projection
mode until a separately approved CWS canary enables Laserfiche mutations.

## System Boundary

```text
foodlogiq.sync@v1
  -> strict durable approved-document/revocation intake
  -> durable LF Sync work
  -> Postgres transaction and outbox
  -> guarded Laserfiche CWS adapter
  -> delivery/failure/report projections
  -> Trellis RPCs, operations, and lifecycle events
  -> authorized client dashboard
```

LF Sync owns:

- Delivery state for every approved FoodLogiQ document and vdoc.
- Idempotency records that prevent duplicate Laserfiche documents.
- Sanitized failure records and replay state.
- Report metadata and transfer-served object references.
- Backfill checkpoints.
- A transactional outbox for state-derived work and lifecycle publication.

LF Sync does not own:

- FoodLogiQ approval policy or source document truth.
- Trading-partner identity policy.
- Laserfiche authentication or folder administration.
- Trellis identity, grants, NATS permissions, or durable job infrastructure.
- A long-running Legacy OADA compatibility adapter.

## Approved Document Intake

The target intake covers all approved FoodLogiQ documents. Document type,
supplier, attachment count, or whether a transformer was historically present
must not silently narrow intake. Unsupported or invalid approved documents are
recorded as visible failures or review-required deliveries instead of being
dropped.

The service subscribes to `Documents.ReadyForLaserfiche` and
`Documents.ApprovalRevoked` from `foodlogiq.sync@v1`. Both subscriptions share
the durable `sourceDocuments` consumer group, which replays all retained events
in strict order with bounded acknowledgement, delivery, and backoff policy.

Source workers call `Documents.Get`, `Documents.Files.List`,
`Documents.Files.Head`, and the receive-transfer RPC `Documents.Files.Download`.
The descriptors pin the production subjects and use a broad string for
`documentTypeKey`; a new approved document type cannot be silently excluded by
an LF Sync enum. Binary bytes do not belong in NATS event or job payloads or in
database rows.

Approval revocation is a first-class lifecycle change. It updates the service
projection and emits `LfSync.Document.ApprovalRevoked`; destructive changes in
Laserfiche require a separately approved policy and are not implied by the
event.

## Contract

`contracts/lf_sync.ts` is the source of truth. It uses the rc.11
`defineServiceContract({ schemas }, (ref) => ...)` form. Its `uses` include the
locally authored FoodLogiQ action descriptors, a required `migrationObjects`
store, and private Jobs. Contract payloads are authored TypeBox schemas exported
from `schemas/index.ts`; hand-written payload types are not a second source of
truth.

Public RPCs:

- `Dashboard.Summary`
- `Deliveries.List`
- `Deliveries.Get`
- `Documents.Status`
- `Failures.List`
- `Failures.Get`
- `Reports.List`
- `Reports.Get`
- `Reports.Download`

Public operations:

- `Reports.Generate`
- `Documents.Sync`
- `Failures.Replay`
- `Backfills.Run`

Lifecycle events:

- `LfSync.Document.Requested`
- `LfSync.Document.Completed`
- `LfSync.Document.Partial`
- `LfSync.Document.Failed`
- `LfSync.Document.ReviewRequired`
- `LfSync.Document.ApprovalRevoked`

The detailed schema and authorization map is in `docs/contract.md`.

## Authorization

The contract declares local capability names. Trellis qualifies them under the
contract namespace when the manifest is emitted, for example `deliveries.read`
becomes `lf-sync::deliveries.read`. Local declarations must never include the
`lf-sync` namespace prefix.

Capabilities are intentionally split by client task:

| Capability          | Access                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| `deliveries.read`   | Dashboard delivery state, delivery detail, and document status.        |
| `reports.read`      | Report metadata and generation status.                                 |
| `reports.export`    | Report generation and download.                                        |
| `sync.request`      | Explicit sync requests for approved documents.                         |
| `failures.read`     | Sanitized failure summaries and detail.                                |
| `failures.manage`   | Failure replay control.                                                |
| `backfills.control` | Backfill observation and control.                                      |
| `admin`             | Additional authorization for high-impact failure and backfill actions. |

Client applications receive only the capabilities required for their views and
actions. The dashboard must not infer authorization from hidden controls; its
server-side Trellis identity and grants remain authoritative. A user without
`reports.export`, for example, cannot generate or download a report even if a
client invokes the action directly.

## Durable Workflow

Normal production work begins with an approved FoodLogiQ document. Manual sync,
failure replay, and backfill operations enter the same idempotent workflow.

1. Validate source identity and approval state.
2. Begin a database transaction and create or load the idempotent sync record.
3. Record the requested delivery rows and corresponding outbox work.
4. Commit before acknowledging source intake or operation progress.
5. Dispatch private Trellis jobs from the outbox.
6. Build and validate each outbound Laserfiche payload.
7. Enforce write mode immediately before every mutating CWS request.
8. Persist the returned Laserfiche entry id before continuing after create.
9. Complete, partially complete, fail, or require review in the projection.
10. Publish the matching lifecycle event through the transactional outbox.

Trellis Jobs and JetStream provide durable work execution. The private queues
are `processSourceEvent`, `loadSourceDocument`, `prepareDelivery`,
`submitLaserfiche`, `finalizeDelivery`, `processBackfillPage`, and
`generateReport`. Their payloads carry stable idempotency keys and their queue
descriptors allow only one active job for each key. Postgres remains the query,
idempotency, checkpoint, and outbox store; it is not replaced by an in-memory
queue.

## Write Safety

`LF_SYNC_WRITE_MODE` is mandatory policy with three states:

- `disabled`: no mutating CWS call is allowed. Intake and validation may still
  populate shadow projections.
- `canary`: writes are allowed only when the request matches the separately
  configured and audited canary policy.
- `enabled`: writes are allowed for the complete approved-document workflow.

The default and every committed deployment value are `disabled`. The check
belongs at the CWS mutation boundary, not only at startup, so a replay,
backfill, or delayed outbox record cannot bypass it. Moving to `canary` or
`enabled` requires an explicit deployment change and operational approval.

`CWS_CONCURRENCY` defaults to one. Concurrency must be raised only after CWS
capacity and per-document idempotency behavior are verified.

## Idempotency And Ordering

Stable identity is derived from the FoodLogiQ document id, approved source
version or approval id, and vdoc key. Before creating in Laserfiche, the worker
checks the persisted mapping. Once CWS returns an entry id, that id is persisted
before upload/finalization continues. A retry resumes or updates the known entry
instead of creating a duplicate.

Approval events for one source document are processed in source-version order.
Old approvals cannot overwrite a newer completed projection. Approval revocation
is similarly version-aware.

## Failures And Review

Failures are classified as `validation`, `not-found`, `timeout`, `transient`,
`code-bug`, or `unknown`. Deterministic validation and unsupported-document
failures do not retry indefinitely. Timeout and transient failures retry only up
to `LF_SYNC_MAX_ATTEMPTS`, which defaults to five.

Public failure detail is deliberately sanitized. The contract permits only a
closed set of client failure fields: client, operation, sanitized endpoint, HTTP
status, bounded error code, reason, bounded response summary, and request id.
The object must state `sanitized: true`; additional fields are rejected.
Credentials, authorization headers, full URLs with secrets, raw payloads, raw
response bodies, stack traces, and database errors are never returned by RPCs or
published in lifecycle events.

`Failures.Replay` is for corrected terminal failures. It does not erase audit
history, and replay remains subject to current approval state, write mode,
idempotency checks, and attempt policy.

## Backfills

`Backfills.Run` has the explicit scope `all-approved-foodlogiq-documents`. It
pages deterministically through source approvals, checkpoints progress, and
enters each document through the normal idempotent path.
`LF_SYNC_BACKFILL_PAGE_SIZE` defaults to 100. Backfills must not call CWS
directly or invent a second processing path.

Date ranges and resume cursors support bounded recovery runs, but the overall
target remains complete coverage of all approved FoodLogiQ documents.

## Reports And Dashboard

The dashboard reads projections through contract RPCs; it does not query
Postgres directly. `Dashboard.Summary` returns bounded aggregate counts.
Delivery, failure, and report lists use typed cursor pagination and typed
filters so clients do not send ad hoc query expressions.

Reports are generated asynchronously. Report rows and status are projected in
Postgres, while generated files belong in approved object storage.
`Reports.Download` is a Trellis receive-transfer RPC: the response carries a
typed transfer grant and bytes flow over its negotiated transfer subject, not
inside the RPC payload or through an external download URL. The grant expires
and is issued only after `reports.export` authorization.

## Transactional Outbox

State transitions and their outgoing work/event records are committed in one
database transaction. A dispatcher polls at `LF_SYNC_OUTBOX_INTERVAL_MS`, which
defaults to 1000 ms, and marks records delivered only after Trellis accepts
them. Dispatch is at-least-once, so consumers and handlers remain idempotent.

Dispatcher claiming must support multiple replicas even though initial CWS
concurrency is one. Poison records retain a bounded attempt count and visible
failure state rather than blocking later outbox entries.

## Legacy Migration

Legacy OADA data may be read exactly once by a finite migration process. The
migration can seed source references, historical delivery state, failure audit
data, and Laserfiche entry-id mappings from objects staged under
`LF_SYNC_MIGRATION_OBJECT_DIRECTORY` and uploaded to the required Trellis
`migrationObjects` store. The store is migration staging, not an alternate
runtime source or report store.

The running service must never depend on Legacy OADA for document intake,
attachment bytes, sync metadata, retries, or dashboard reads. There is no dual
write, fallback read, polling bridge, or permanent compatibility mode. After
validation and cutover, migration access is removed and the imported records are
ordinary service-owned history.

## Deployment Gate

All committed Deployments remain at `replicas: 0` and all ConfigMaps set write
mode to `disabled`. `DATABASE_URL` comes from the `lf-sync-database` Secret;
credentials are not stored in a ConfigMap or committed workload manifest.

Before scaling above zero:

1. Provision the database and apply the independently reviewed migrations.
2. Integrate every declared RPC, operation, event, job, and outbox handler.
3. Confirm the deployed FoodLogiQ contract matches the locally pinned subjects
   and schemas, including both receive-transfer surfaces.
4. Configure Trellis identities and grants for service and dashboard clients.
5. Validate failure sanitization and report transfer authorization.
6. Exercise shadow mode while writes remain disabled.
7. Approve a bounded canary policy before selecting `canary`.

## Integration Dependencies

- The deployed `foodlogiq.sync@v1` owner must match the local descriptor
  schemas, subjects, and transfer direction before LF Sync is bound.
- The database Secret and schema lifecycle are deployment dependencies.
- Generated Trellis manifest/SDK artifacts must be regenerated from this
  contract and reviewed by deployment authority.
- Runtime handlers in `main.ts` are not part of this foundation change and must
  be added before activation.
- Report object storage and receive-transfer serving require an approved storage
  integration.
- Canary eligibility policy requires explicit configuration and audit design;
  selecting `canary` alone must not authorize every document.
