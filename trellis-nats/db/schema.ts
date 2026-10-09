import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

type Json = Record<string, unknown> | string[];
const json = <T extends Json = Record<string, unknown>>(name = "") =>
  jsonb(name).$type<T>();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true, precision: 3 }).notNull()
    .defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const sourceDocumentStatus = pgEnum("source_document_status", [
  "received",
  "ready",
  "superseded",
]);
export const workflowStatus = pgEnum("workflow_status", [
  "pending",
  "active",
  "review-required",
  "approval-revoked",
  "completed",
  "partial",
  "failed",
]);
export const deliveryAction = pgEnum("delivery_action", ["create", "update"]);
export const attemptOutcome = pgEnum("attempt_outcome", [
  "started",
  "succeeded",
  "failed",
]);
export const failureClass = pgEnum("failure_class", [
  "validation",
  "not-found",
  "timeout",
  "transient",
  "code-bug",
  "unknown",
]);
export const failureStatus = pgEnum("failure_status", [
  "open",
  "resolved",
  "dismissed",
]);
export const migrationStatus = pgEnum("migration_status", [
  "pending",
  "running",
  "completed",
  "partial",
  "failed",
  "skipped",
]);
export const reportStatus = pgEnum("report_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const sourceDocuments = pgTable("source_documents", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  sourceSystem: text("source_system").notNull(),
  sourceId: text("source_id").notNull(),
  sourceVersion: text("source_version").notNull(),
  readinessHash: text("readiness_hash").notNull(),
  documentType: text("document_type"),
  supplierId: text("supplier_id"),
  supplierName: text("supplier_name"),
  status: sourceDocumentStatus().notNull().default("received"),
  payload: json().notNull(),
  provenance: json().notNull().default({}),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("source_documents_version_uq").on(
    table.sourceSystem,
    table.sourceId,
    table.sourceVersion,
  ),
  index("source_documents_readiness_hash_idx").on(table.readinessHash),
  index("source_documents_approved_idx").on(table.approvedAt, table.id),
]);

export const sourceAttachments = pgTable("source_attachments", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  sourceDocumentId: bigint("source_document_id", { mode: "number" }).notNull()
    .references(() => sourceDocuments.id),
  sourceSystem: text("source_system").notNull(),
  sourceId: text("source_id").notNull(),
  sourceVersion: text("source_version").notNull(),
  vdocKey: text("vdoc_key").notNull(),
  byteReference: text("byte_reference").notNull(),
  contentType: text("content_type").notNull(),
  fileName: text("file_name"),
  attachmentId: text("attachment_id"),
  objectKey: text("object_key"),
  originalFilename: text("original_filename"),
  declaredContentType: text("declared_content_type"),
  detectedContentType: text("detected_content_type"),
  declaredFormat: text("declared_format"),
  detectedFormat: text("detected_format"),
  uploadExtension: text("upload_extension"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  checksum: text("checksum"),
  payload: json().notNull().default({}),
  provenance: json().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("source_attachments_version_uq").on(
    table.sourceSystem,
    table.sourceId,
    table.sourceVersion,
    table.vdocKey,
  ),
  index("source_attachments_document_idx").on(
    table.sourceDocumentId,
    table.vdocKey,
  ),
]);

export const sourceApprovalRevocations = pgTable(
  "source_approval_revocations",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sourceSystem: text("source_system").notNull(),
    sourceId: text("source_id").notNull(),
    sourceVersion: text("source_version").notNull(),
    eventId: text("event_id").notNull(),
    reason: text().notNull(),
    provenance: json().notNull().default({}),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("source_approval_revocations_version_uq").on(
      table.sourceSystem,
      table.sourceId,
      table.sourceVersion,
    ),
  ],
);

export const laserficheDirectories = pgTable("laserfiche_directories", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  repository: text().notNull(),
  canonicalPath: text("canonical_path").notNull(),
  parentDirectoryId: bigint("parent_directory_id", { mode: "number" }),
  cwsEntryId: bigint("cws_entry_id", { mode: "number" }),
  name: text().notNull(),
  status: text().notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  metadata: json().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("laserfiche_directories_path_uq").on(
    table.repository,
    table.canonicalPath,
  ),
  uniqueIndex("laserfiche_directories_entry_uq").on(
    table.repository,
    table.cwsEntryId,
  ),
]);

export const syncRequests = pgTable(
  "sync_requests",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sourceDocumentId: bigint("source_document_id", { mode: "number" }).notNull()
      .references(() => sourceDocuments.id),
    requestKey: text("request_key").notNull(),
    operationId: text("operation_id"),
    requestedBy: text("requested_by"),
    reason: text().notNull(),
    status: workflowStatus().notNull().default("pending"),
    requestedVdocKeys: json<string[]>("requested_vdoc_keys").notNull().default(
      [],
    ),
    result: json(),
    provenance: json().notNull().default({}),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("sync_requests_request_key_uq").on(table.requestKey)],
);

export const deliveries = pgTable("deliveries", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  syncRequestId: bigint("sync_request_id", { mode: "number" }).notNull()
    .references(() => syncRequests.id),
  sourceDocumentId: bigint("source_document_id", { mode: "number" }).notNull()
    .references(() => sourceDocuments.id),
  sourceAttachmentId: bigint("source_attachment_id", { mode: "number" })
    .notNull().references(() => sourceAttachments.id),
  directoryId: bigint("directory_id", { mode: "number" }).references(() =>
    laserficheDirectories.id
  ),
  idempotencyKey: text("idempotency_key").notNull(),
  sourceSyncId: text("source_sync_id"),
  payloadHash: text("payload_hash").notNull(),
  contentSha256: text("content_sha256"),
  bytes: bigint({ mode: "number" }),
  contentType: text("content_type"),
  uploadExtension: text("upload_extension"),
  action: deliveryAction().notNull(),
  status: workflowStatus().notNull().default("pending"),
  repository: text().notNull(),
  targetPath: text("target_path").notNull(),
  targetName: text("target_name").notNull(),
  cwsEntryId: bigint("cws_entry_id", { mode: "number" }),
  payload: json().notNull(),
  result: json(),
  provenance: json().notNull().default({}),
  retryCount: integer("retry_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastRetryReason: text("last_retry_reason"),
  uploadCompletedAt: timestamp("upload_completed_at", { withTimezone: true }),
  submissionClaimOwner: text("submission_claim_owner"),
  submissionClaimedUntil: timestamp("submission_claimed_until", {
    withTimezone: true,
  }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("deliveries_idempotency_uq").on(table.idempotencyKey),
  index("deliveries_status_created_idx").on(
    table.status,
    table.createdAt,
    table.id,
  ),
]);

export const laserficheEntryMappings = pgTable("entry_mappings", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  deliveryId: bigint("delivery_id", { mode: "number" }).notNull().references(
    () => deliveries.id,
  ),
  repository: text().notNull(),
  entryId: bigint("entry_id", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  sourceSyncId: text("source_sync_id"),
  contentSha256: text("content_sha256"),
  provenance: json().notNull().default({}),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("entry_mappings_delivery_uq").on(table.deliveryId),
  uniqueIndex("entry_mappings_idempotency_uq").on(table.idempotencyKey),
  uniqueIndex("entry_mappings_entry_uq").on(table.repository, table.entryId),
]);

export const deliveryAttempts = pgTable(
  "delivery_attempts",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    deliveryId: bigint("delivery_id", { mode: "number" }).notNull().references(
      () => deliveries.id,
    ),
    stage: text().notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: attemptOutcome().notNull().default("started"),
    retryable: boolean(),
    durationMs: integer("duration_ms"),
    sanitizedError: json("sanitized_error"),
    requestContext: json("request_context").notNull().default({}),
    responseContext: json("response_context").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (
    table,
  ) => [
    uniqueIndex("delivery_attempts_stage_uq").on(
      table.deliveryId,
      table.stage,
      table.attemptNumber,
    ),
  ],
);

export const failureRecords = pgTable("failure_records", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  syncRequestId: bigint("sync_request_id", { mode: "number" }).references(() =>
    syncRequests.id
  ),
  deliveryId: bigint("delivery_id", { mode: "number" }).references(() =>
    deliveries.id
  ),
  sourceDocumentId: bigint("source_document_id", { mode: "number" }).references(
    () => sourceDocuments.id,
  ),
  stage: text().notNull(),
  failureClass: failureClass("failure_class").notNull(),
  status: failureStatus().notNull().default("open"),
  reason: text().notNull(),
  retryable: boolean().notNull(),
  statusCode: integer("status_code"),
  attemptNumber: integer("attempt_number"),
  context: json().notNull().default({}),
  provenance: json().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const duplicateCandidates = pgTable(
  "duplicate_candidates",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    repository: text().notNull(),
    directoryId: bigint("directory_id", { mode: "number" }).notNull()
      .references(() => laserficheDirectories.id),
    contentSha256: text("content_sha256").notNull(),
    canonicalEntryId: bigint("canonical_entry_id", { mode: "number" }),
    duplicateEntryId: bigint("duplicate_entry_id", { mode: "number" }),
    evidence: json().notNull().default({}),
    status: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (
    table,
  ) => [
    uniqueIndex("duplicate_candidates_hash_scope_uq").on(
      table.repository,
      table.directoryId,
      table.contentSha256,
    ),
  ],
);

export const migrationBatches = pgTable("migration_batches", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  batchKey: text("batch_key").notNull(),
  source: text().notNull(),
  status: migrationStatus().notNull().default("pending"),
  manifestDigest: text("manifest_digest"),
  checkpoint: json().notNull().default({}),
  totals: json().notNull().default({}),
  provenance: json().notNull().default({}),
  lastError: text("last_error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("migration_batches_key_uq").on(table.batchKey)]);

export const migrationItems = pgTable(
  "migration_items",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    migrationBatchId: bigint("migration_batch_id", { mode: "number" }).notNull()
      .references(() => migrationBatches.id),
    itemKey: text("item_key").notNull(),
    sourceVersion: text("source_version"),
    status: migrationStatus().notNull().default("pending"),
    classification: text(),
    checkpoint: json().notNull().default({}),
    payload: json().notNull().default({}),
    result: json(),
    lastError: text("last_error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (
    table,
  ) => [
    uniqueIndex("migration_items_key_uq").on(
      table.migrationBatchId,
      table.itemKey,
    ),
  ],
);

export const reportRuns = pgTable("report_runs", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  reportType: text("report_type").notNull(),
  requestedBy: text("requested_by"),
  status: reportStatus().notNull().default("pending"),
  parameters: json().notNull().default({}),
  rowCount: integer("row_count"),
  objectKey: text("object_key"),
  sha256: text("sha256"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  result: json(),
  error: text(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
