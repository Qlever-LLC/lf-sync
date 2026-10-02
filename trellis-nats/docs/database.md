# Database Integration

The persistence API is exported from `db/mod.ts`. The PostgreSQL driver is a
self-contained `npm:postgres@3.4.7` import because the persistence foundation
does not modify `deno.json`.

```ts
import {
  connectPostgres,
  createRepositories,
  createTrellisSqlOutboxAdapter,
  runMigrations,
} from "../db/mod.ts";

const database = connectPostgres(Deno.env.get("DATABASE_URL")!);
await runMigrations(database);

const repositories = createRepositories(database);
const health = await repositories.health.health();
```

Use `Database.transaction` to bind both the domain repositories and Trellis's
official SQL adapter to one transaction. The adapter comes from
`createSqlOutboxAdapter` in `@qlever-llc/trellis/service`; the local factory
only adapts `QueryExecutor` parameter and row types.

```ts
await database.transaction(async (transaction) => {
  const repositories = createRepositories(transaction);
  const trellisSql = createTrellisSqlOutboxAdapter(transaction);
  const delivery = await repositories.deliveries.createIdempotently(input);
  await trellisSql.outbox.enqueue(preparedOutboxRecord);
});
```

`preparedOutboxRecord` is Trellis's `PreparedOutboxRecord`. Convert a prepared
event with `preparedTrellisEventToOutboxRecord(...)`; prepared job-create and
job-submit records can be enqueued directly. After the transaction commits,
notify or run the Trellis outbox dispatcher. Do not dispatch before commit.

The official adapter owns `trellis_outbox` and `trellis_inbox`. The separate
domain `event_inbox` remains the atomic source-event payload and
processing-state record; it is not a replacement for Trellis's message-id inbox.

## Repository API

- `health.health()` checks the database and returns server/database metadata.
- `inbox.receive(input)` deduplicates by `(consumer, eventId)`.
- `inbox.claimNext(consumer, owner, leaseMs)`, `complete(...)`, and `fail(...)`
  manage leased inbox work. Pass the claimed row's `attemptCount` to completion
  and failure calls to fence expired leases.
- `sources.upsertCanonicalSource(input)` and `upsertAttachment(input)` persist
  versioned upstream snapshots and attachment references. Persist canonical
  `approvedAt` for dashboard range filtering.
- `sources.getById(id)`, `getBySource(system, sourceId, sourceVersion?)`,
  `listAttachments(sourceDocumentId)`, and
  `getAttachment(sourceDocumentId, vdocKey)` provide runtime lookups.
- `syncRequests.createRequest(input)`, `markActive(...)`, `finalize(...)`, and
  `saveEntitySnapshot(input)` maintain workflow and identity state.
- `deliveries.createIdempotently(input)`, `markActive(...)`,
  `recordAttempt(...)`, `recordFailure(...)`, `persistEntryId(...)`, and
  `finalize(...)` maintain the Laserfiche delivery projection. Call
  `persistEntryId` immediately after a successful create and before attachment
  upload.
- `deliveries.getDelivery(id)` returns a delivery and its failures.
- `deliveries.getDocumentStatus({ sourceSystem, sourceId, vdocKey? })` returns
  that external source's latest version aggregate status, deliveries, and
  failures. The legacy `getDocumentStatus(sourceId, vdocKey?)` remains available
  when source-system disambiguation is not needed.
- `deliveries.markApprovalRevoked({ sourceSystem, sourceId, sourceVersion,
  result? })`
  marks matching deliveries `approval-revoked` without changing or deleting
  entry mappings.
- `deliveries.dashboardSummary(filter)`, `listDeliveries(options)`,
  `getFailure(id)`, and `listFailures(options)` provide operator projections.
  Delivery filters support `statuses`, external `sourceDocumentId`, `vdocKey`,
  `documentTypes`, payload/provenance `suppliers`, `approvedAt`, `updatedAt`,
  and cursor/limit. Failure filters support contract `statuses`,
  `failureClasses`, `stages`, `retryable`, external `sourceDocumentId`,
  `vdocKey`, `documentTypes`, `suppliers`, `approvedAt`, `updatedAt`,
  `occurredAt`, and cursor/limit.
- `migrations.upsertBatch(input)`, `checkpointBatch(...)`, `upsertItem(input)`,
  `checkpointItem(...)`, `listBatches(options)`, `listItems(batchId, options)`,
  and `claimPendingItemsPage(batchId, limit)` maintain one-off data migration
  progress. Claims atomically transition pending rows to `running` with
  `FOR UPDATE SKIP LOCKED`.
- `reports.create(input)`, `get(id)`, `list(options)`, and `finish(...)`
  maintain report runs. Report list filters match contract statuses, report
  types, requester, requested range, and cursor/limit.
- `createTrellisSqlOutboxAdapter(executor)` returns the official
  `{ outbox, inbox, ddl }` adapter bound to a database or transaction executor.

`runMigrations(database)` creates the `schema_migrations` ledger, takes a
transaction-scoped advisory lock, verifies domain SHA-256 and Trellis-provided
migration checksums, and applies pending versions atomically. Its normal
migration list includes the artifacts returned by `getSqlOutboxMigrations` from
`@qlever-llc/trellis/service` for tables named exactly `trellis_outbox` and
`trellis_inbox`.

List range `from` values are inclusive and `to` values are exclusive. Empty
array filters are treated as no filter. Page cursors are the returned
`{ createdAt, id }` pair, and database bigint identifiers are returned as text.

Persistence workflow statuses are `pending`, `active`, `review-required`,
`approval-revoked`, `completed`, `partial`, and `failed`. Dashboard summaries
also return `deliveriesReviewRequired` and `deliveriesApprovalRevoked`. The
current public schemas outside `db/` still enumerate the original status and
summary shapes; update those contract schemas before returning the new values
directly from runtime handlers.
