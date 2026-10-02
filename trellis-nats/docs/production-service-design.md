# Laserfiche Sync Production Service Design

## Purpose

This document describes the production LF Sync implementation under
`~/foodlogiq`. No deployment, CWS write, or historical resync is authorized by
this document alone.

The service owns Laserfiche integration for Trellis-native FoodLogiQ source
documents. It supports the legacy worker's CWS surface internally, but it is
not a general client-facing CWS proxy.

## Filing Workflow

The existing workflow is in legacy `src/utils.ts`:

```text
/trellis/trading-partners/{Entity}/{Share Mode}/{Document Type}
```

Zendesk tickets add `/{YYYY-MM}/Ticket{Zendesk Ticket ID}`. FoodLogiQ documents
must normalize their source fields as:

| Laserfiche field | Source of truth |
| --- | --- |
| `Entity` | canonical resolved supplier name |
| `Document Type` | FoodLogiQ document type display value |
| `Share Mode` | exactly `Shared To Smithfield` |
| `Document Date` | normalized source document date |
| `Expiration Date` | optional normalized expiration date |
| `Products`, `Locations` | optional multi-value source metadata |
| `Original Filename` | source attachment name |

All FoodLogiQ documents therefore go into each supplier's `Shared To Smithfield`
directory. The legacy test has `Shared to Smithfield`, but production logic
uses upper-case `To`; the new service canonicalizes to `Shared To Smithfield`.

`filingWorkflow(metadata)` is a pure domain function returning:

```ts
{
  canonicalPath: string;
  directorySegments: string[];
  targetName: string;
  requiredMetadata: Record<string, string | string[]>;
}
```

It rejects missing `Entity`, `Document Type`, or `Share Mode`, unsafe path
segments, invalid required dates, and an empty target name. It never picks a
fallback folder.

`ensureDirectory(canonicalPath)` starts at `/trellis`, resolves each segment,
creates only missing folders, re-reads after an already-exists race, and stores
every directory entry ID. No document create or move occurs before the target
directory is verified.

## CWS Adapter

Implement a typed adapter with lazy authentication and sanitized errors. Never
log tokens, credentials, authorization headers, multipart payloads, or bytes.

| Area | Required methods |
| --- | --- |
| Entry read | retrieve by ID/path, browse, retrieve folder, folder contents, search entries/documents |
| Content read | retrieve document information, metadata/template, document bytes |
| Entry mutation | move, rename, set metadata/template, index, migrate volume |
| Directory mutation | create and delete folder |
| Document mutation | create/generic create, replace or upload bytes, delete document |
| Content transfer | direct buffer, stream, and chunked init/chunk/complete upload |

Deletion, indexing, migration, and arbitrary entry mutation are internal admin
workflows. Every mutation requires a correlation ID and creates an append-only
delivery attempt. Normal automatic sync only creates or reconciles directories,
creates or updates a document, uploads bytes, sets metadata, moves/renames,
and verifies the final entry.

Persist the CWS entry ID immediately after `CreateDocument`, before upload, so
a crash cannot create duplicates on retry. Continue using native
`globalThis.FormData` for multipart document creation.

## File Format And Integrity

The legacy upload resolver falls back to `pdf` for an unknown type. That can
label non-PDF bytes as PDF and creates unreadable Laserfiche documents. The new
service must not guess.

For every attachment, record its declared filename extension and MIME type,
detected magic-byte MIME/extension, selected upload extension, SHA-256, and
byte length. A recognized declared type must agree with detected bytes. Unknown
or conflicting types become `review-required` before CWS create/upload.

Completion records the CWS upload acknowledgement. Where safe verification is
available, retrieve and hash stored bytes. Otherwise mark content verification
pending, never assumed successful.

## Drizzle And Postgres

Use Drizzle ORM and `drizzle-kit` generated versioned PostgreSQL migrations.
Replace the current hand-authored persistence layer during the move, before any
production database is created. Run migrations from the dedicated `deno task
migrate` command or a deployment init job, never implicitly in a service pod
startup.

Trellis SQL outbox/inbox tables remain framework-owned but are represented in
an explicit Drizzle migration artifact. Domain tables are service-owned.

| Table | Elevated columns |
| --- | --- |
| `source_documents` | source system/document/version IDs, document type/key, supplier ID/name, approval time, readiness hash, source metadata JSONB |
| `source_attachments` | vdoc/attachment IDs, original filename, declared/detected content type, source/detected format, upload extension, size, SHA-256, object key, metadata JSONB |
| `laserfiche_directories` | repository, canonical path, parent ID, CWS entry ID, name, status, verification time, metadata JSONB |
| `sync_requests` | request key, reason, requester, source document, workflow status, operation ID, timestamps, result JSONB |
| `deliveries` | source attachment, directory, repository, CWS entry ID, target path/name, document type, supplier ID/name, content SHA-256, bytes, content type, upload extension, status, attempts, timestamps, metadata/result JSONB |
| `laserfiche_entry_mappings` | delivery, repository/entry ID, immutable source sync ID, content SHA-256, provenance, verification time |
| `delivery_attempts` | delivery, stage, attempt, outcome, retryability, duration, sanitized error, timestamps |
| `failure_records` | source/delivery IDs, stage, class, reason, CWS status, retryability, sanitized context, timestamps |
| `duplicate_candidates` | repository, directory, content SHA-256, canonical/duplicate entry IDs, evidence, status, timestamps |
| `migration_batches`, `migration_items` | six-month scope/cursor, immutable manifest digest, counters, classification, checkpoint/result JSONB |
| `report_runs` | report type/filters/requester/status, row count, object key, SHA-256, expiry, sanitized error |

Metadata is stored losslessly in JSONB. The elevated columns are the stable
operational and reporting dimensions, so reporting is not JSON-only.

Use the CWS default volume and do not assign a Laserfiche template. Submit all
available LF Sync metadata fields, including `Expiration Date`, and treat a CWS
metadata validation failure as review-required rather than dropping a field.

Required uniqueness includes source version, source attachment, repository path,
repository entry mapping, deterministic delivery idempotency key, and
`(repository, directory_id, content_sha256)`. The last constraint prevents the
same bytes from creating duplicates in one directory but permits the same bytes
in different directories.

## Duplicate Prevention And Cleanup

Before create, reconcile in this order:

1. Existing mapping for the source attachment/version.
2. Existing CWS entry carrying immutable LF Sync source ID metadata.
3. Existing `(repository, directory, content_sha256)` mapping.
4. CWS exact directory/name plus stable-sync-metadata search.

An ambiguous result is `review-required`, never an automatic create.

After sync is stable, a separate read-only inventory walks only LF Sync-managed
directories, retrieves content or verified hashes, and writes
`duplicate_candidates`. Any deletion/move requires a separate approved action.
Never deduplicate across different directories merely because bytes match.

## Metrics, Activity, And Reports

Default metric window is the previous seven complete days; allow 30, 60, 180,
and 365 days.

Required metrics:

- Documents completed, failed, partial, review-required, and approval-revoked.
- Distinct suppliers with completed documents.
- Files processed/completed, total bytes processed, and bytes moved.
- Success, retry, and duplicate-prevention rates.
- Queue depth and oldest pending age.
- End-to-end, create, upload, and finalize latency with p50/p95.
- Failure rate by stage, CWS status/error code, document type, and supplier.
- CWS authentication/root-read health and last successful delivery time.
- Format rejects/type mismatches, orphan mappings, and duplicate candidates.

Each delivery attempt and terminal delivery has a paginated activity row:
source document/version/attachment and vdoc IDs; supplier/document type; target

Server-side CSV uses the same filters, stores output only in `reportObjects`,

## Trellis And Dashboard Boundaries

Keep client read/report capabilities separate from write and admin actions.
Add internal CWS/admin jobs for directory creation, mutation, deletion, and
reconciliation. Client read models include directory, format, integrity,
duplicate status, metric window, and activity rows. Do not expose manual sync,
replay, or backfill controls until policies and canary safeguards exist.

The `Laserfiche Sync` tab in `coi-review-app` uses only authenticated Trellis
RPCs for overview, deliveries, details, failures, activity, and reports.

## Historical Resync

Do not repost the 3,853 jobs to legacy OADA Jobs. Build a Trellis-native
manifest from canonical FoodLogiQ versions and imported verified mappings. Run
chronological six-month batches:

1. Inventory and dry-run classification.
2. Import verified mappings without CWS writes.
3. Stage/reconcile, including duplicate checks.
4. Obtain explicit approval for one canary.
5. Run one six-month window at CWS concurrency `1`, with a global write kill
   switch and live traffic prioritized over backfill.
6. Reconcile and report before starting the next window.

Every batch is resumable and emits immutable manifest, result, and CSV
artifacts.

## Build Order

1. Move LF Sync to `~/foodlogiq/lf-sync` and preserve the current contract as
   a starting point.
2. Establish Drizzle schema/migrations before provisioning production DB.
3. Implement and test metadata normalization, filing workflow, safe paths, and
   file-format validation.
4. Implement CWS adapter and directory reconciliation with mocked CWS tests.
5. Implement idempotent create/update/upload and post-create persistence.
6. Implement activity projections, metrics, reports, and CSV transfer.
7. Update FoodLogiQ all-document source support and the dashboard tab.
8. Deploy no-write projection mode; request explicit canary approval for CWS.
