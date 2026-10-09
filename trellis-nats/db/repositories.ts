import { and, desc, eq, sql } from "drizzle-orm";
import type { QueryExecutor } from "./database.ts";
import { sourceAttachments, sourceDocuments } from "./schema.ts";
import type {
  AttemptOutcome,
  DashboardSummary,
  DashboardTrendPoint,
  DateRange,
  DbId,
  DeliveryAction,
  DeliveryAttemptRecord,
  DeliveryContentInput,
  DeliveryDetails,
  DeliveryQueueSnapshot,
  DeliveryRecord,
  DocumentStatusRecord,
  EntitySnapshotRecord,
  EntryMappingRecord,
  ExistingDeliveryContentRecord,
  FailureClass,
  FailureRecord,
  FailureStatus,
  FailureSummaryMetrics,
  FailureTypeSummary,
  InboxRecord,
  JsonObject,
  LaserficheDirectoryRecord,
  MigrationBatchRecord,
  MigrationItemRecord,
  MigrationStatus,
  Page,
  PageCursor,
  ReportRunRecord,
  ReportStatus,
  SourceAttachmentRecord,
  SourceDocumentRecord,
  SourceDocumentStatus,
  SyncRequestRecord,
  TerminalWorkflowStatus,
  WorkflowStatus,
} from "./types.ts";

const SOURCE_DOCUMENT_COLUMNS = `
  id::text AS id,
  source_system AS "sourceSystem",
  source_id AS "sourceId",
  source_version AS "sourceVersion",
  readiness_hash AS "readinessHash",
  document_type AS "documentType",
  supplier_id AS "supplierId",
  supplier_name AS "supplierName",
  status,
  payload,
  provenance,
  approved_at AS "approvedAt",
  source_created_at AS "sourceCreatedAt",
  source_updated_at AS "sourceUpdatedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const SOURCE_ATTACHMENT_COLUMNS = `
  id::text AS id,
  source_document_id::text AS "sourceDocumentId",
  source_system AS "sourceSystem",
  source_id AS "sourceId",
  source_version AS "sourceVersion",
  vdoc_key AS "vdocKey",
  byte_reference AS "byteReference",
  content_type AS "contentType",
  file_name AS "fileName",
  size_bytes::text AS "sizeBytes",
  checksum,
  payload,
  provenance,
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const LASERFICHE_DIRECTORY_COLUMNS = `
  id::text AS id,
  repository,
  canonical_path AS "canonicalPath",
  parent_directory_id::text AS "parentDirectoryId",
  cws_entry_id::text AS "cwsEntryId",
  name,
  status,
  verified_at AS "verifiedAt",
  metadata,
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const SYNC_REQUEST_COLUMNS = `
  id::text AS id,
  source_document_id::text AS "sourceDocumentId",
  request_key AS "requestKey",
  operation_id AS "operationId",
  requested_by AS "requestedBy",
  reason,
  status,
  requested_vdoc_keys AS "requestedVdocKeys",
  result,
  provenance,
  requested_at AS "requestedAt",
  started_at AS "startedAt",
  finished_at AS "finishedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const DELIVERY_COLUMNS = `
  d.id::text AS id,
  d.sync_request_id::text AS "syncRequestId",
  d.source_document_id::text AS "sourceDocumentId",
  d.source_attachment_id::text AS "sourceAttachmentId",
  sa.attachment_id AS "foodlogiqAttachmentId",
  sd.source_id AS "externalSourceDocumentId",
  sd.source_version AS "sourceVersion",
  sa.vdoc_key AS "vdocKey",
  COALESCE(
    NULLIF(sd.payload #>> '{source,documentTypeName}', ''),
    NULLIF(sd.payload #>> '{documentTypeName}', ''),
    NULLIF(sd.payload #>> '{metadata,Document Type}', ''),
    NULLIF(sd.provenance #>> '{source,documentTypeName}', ''),
    NULLIF(sd.provenance #>> '{documentTypeName}', ''),
    sd.document_type
  ) AS "documentType",
  COALESCE(
    NULLIF(sd.supplier_name, ''),
    NULLIF(sd.supplier_id, ''),
    NULLIF(sd.payload #>> '{supplier,name}', ''),
    NULLIF(sd.provenance #>> '{supplier,name}', ''),
    NULLIF(sd.payload->>'supplier', ''),
    NULLIF(sd.provenance->>'supplier', ''),
    NULLIF(sd.payload->>'supplierId', ''),
    NULLIF(sd.provenance->>'supplierId', '')
  ) AS supplier,
  d.idempotency_key AS "idempotencyKey",
  d.payload_hash AS "payloadHash",
  d.action,
  d.status,
  d.repository,
  COALESCE(NULLIF(d.result #>> '{laserfichePath}', ''), d.target_path) AS "targetPath",
  COALESCE(NULLIF(d.result #>> '{laserficheName}', ''), d.target_name) AS "targetName",
  d.payload,
  d.provenance,
  sd.payload #> '{syncProvenance}' AS "syncProvenance",
  d.result,
  COALESCE(d.bytes, sa.size_bytes)::text AS "byteLength",
  COALESCE(em.entry_id, d.cws_entry_id)::text AS "entryId",
  d.upload_completed_at AS "uploadCompletedAt",
  d.retry_count AS "retryCount",
  d.max_attempts AS "maxAttempts",
  d.next_attempt_at AS "nextAttemptAt",
  d.last_retry_reason AS "lastRetryReason",
  sd.approved_at AS "approvedAt",
  sr.requested_at AS "requestedAt",
  (SELECT count(*)::integer FROM delivery_attempts AS da
    WHERE da.delivery_id = d.id) AS "attemptCount",
  (SELECT count(*)::integer FROM failure_records AS fc
    WHERE fc.delivery_id = d.id) AS "failureCount",
  d.started_at AS "startedAt",
  d.finished_at AS "finishedAt",
  d.created_at AS "createdAt",
  d.updated_at AS "updatedAt"`;

const ENTRY_MAPPING_COLUMNS = `
  id::text AS id,
  delivery_id::text AS "deliveryId",
  repository,
  entry_id::text AS "entryId",
  idempotency_key AS "idempotencyKey",
  payload_hash AS "payloadHash",
  provenance,
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const ATTEMPT_COLUMNS = `
  id::text AS id,
  delivery_id::text AS "deliveryId",
  stage,
  attempt_number AS "attemptNumber",
  outcome,
  retryable,
  duration_ms AS "durationMs",
  request_context AS "requestContext",
  response_context AS "responseContext",
  started_at AS "startedAt",
  finished_at AS "finishedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const FAILURE_COLUMNS = `
  f.id::text AS id,
  f.sync_request_id::text AS "syncRequestId",
  f.delivery_id::text AS "deliveryId",
  COALESCE(f.source_document_id, d.source_document_id, fsr.source_document_id)::text
    AS "sourceDocumentId",
  sd.source_id AS "externalSourceDocumentId",
  sa.vdoc_key AS "vdocKey",
  sd.document_type AS "documentType",
  COALESCE(
    NULLIF(sd.supplier_name, ''),
    NULLIF(sd.supplier_id, ''),
    NULLIF(sd.payload #>> '{supplier,name}', ''),
    NULLIF(sd.provenance #>> '{supplier,name}', ''),
    NULLIF(sd.payload->>'supplier', ''),
    NULLIF(sd.provenance->>'supplier', ''),
    NULLIF(sd.payload->>'supplierId', ''),
    NULLIF(sd.provenance->>'supplierId', '')
  ) AS supplier,
  d.target_path AS "targetPath",
  f.stage,
  f.failure_class AS "failureClass",
  f.status,
  f.reason,
  f.retryable,
  f.status_code AS "statusCode",
  f.attempt_number AS "attemptNumber",
  f.context,
  f.provenance,
  f.occurred_at AS "occurredAt",
  f.resolved_at AS "resolvedAt",
  f.created_at AS "createdAt",
  f.updated_at AS "updatedAt"`;

const DELIVERY_JOINS = `
  JOIN source_documents AS sd ON sd.id = d.source_document_id
  JOIN source_attachments AS sa ON sa.id = d.source_attachment_id
  JOIN sync_requests AS sr ON sr.id = d.sync_request_id
  LEFT JOIN entry_mappings AS em ON em.delivery_id = d.id`;

const FAILURE_JOINS = `
  LEFT JOIN deliveries AS d ON d.id = f.delivery_id
  LEFT JOIN sync_requests AS fsr ON fsr.id = f.sync_request_id
  LEFT JOIN source_documents AS sd
    ON sd.id = COALESCE(f.source_document_id, d.source_document_id, fsr.source_document_id)
  LEFT JOIN source_attachments AS sa ON sa.id = d.source_attachment_id`;

const INBOX_COLUMNS = `
  id::text AS id,
  consumer,
  event_id AS "eventId",
  event_type AS "eventType",
  status,
  payload,
  provenance,
  claim_owner AS "claimOwner",
  claimed_until AS "claimedUntil",
  attempt_count AS "attemptCount",
  last_error AS "lastError",
  next_attempt_at AS "nextAttemptAt",
  received_at AS "receivedAt",
  processed_at AS "processedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const ENTITY_SNAPSHOT_COLUMNS = `
  id::text AS id,
  sync_request_id::text AS "syncRequestId",
  entity_id AS "entityId",
  entity_version AS "entityVersion",
  snapshot,
  provenance,
  source_updated_at AS "sourceUpdatedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const MIGRATION_BATCH_COLUMNS = `
  id::text AS id,
  batch_key AS "batchKey",
  source,
  status,
  checkpoint,
  totals,
  provenance,
  last_error AS "lastError",
  started_at AS "startedAt",
  finished_at AS "finishedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const MIGRATION_ITEM_COLUMNS = `
  id::text AS id,
  migration_batch_id::text AS "migrationBatchId",
  item_key AS "itemKey",
  source_version AS "sourceVersion",
  status,
  checkpoint,
  payload,
  result,
  last_error AS "lastError",
  attempt_count AS "attemptCount",
  started_at AS "startedAt",
  finished_at AS "finishedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const REPORT_RUN_COLUMNS = `
  id::text AS id,
  report_type AS "reportType",
  requested_by AS "requestedBy",
  status,
  parameters,
  result,
  error,
  started_at AS "startedAt",
  finished_at AS "finishedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

export interface CanonicalSourceInput {
  sourceSystem: string;
  sourceId: string;
  sourceVersion: string;
  readinessHash: string;
  documentType?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  status?: SourceDocumentStatus;
  payload: JsonObject;
  provenance?: JsonObject;
  approvedAt?: Date | null;
  sourceCreatedAt?: Date | null;
  sourceUpdatedAt?: Date | null;
}

export interface SourceAttachmentInput {
  sourceSystem: string;
  sourceId: string;
  sourceVersion: string;
  vdocKey: string;
  byteReference: string;
  contentType: string;
  fileName?: string | null;
  sizeBytes?: DbId | null;
  checksum?: string | null;
  payload?: JsonObject;
  provenance?: JsonObject;
}

export interface SyncRequestInput {
  sourceDocumentId: DbId;
  requestKey: string;
  operationId?: string | null;
  requestedBy?: string | null;
  reason: string;
  requestedVdocKeys?: readonly string[];
  provenance?: JsonObject;
}

export interface EntitySnapshotInput {
  syncRequestId: DbId;
  entityId: string;
  entityVersion: string;
  snapshot: JsonObject;
  provenance?: JsonObject;
  sourceUpdatedAt?: Date | null;
}

export interface DeliveryInput {
  syncRequestId: DbId;
  sourceAttachmentId: DbId;
  idempotencyKey: string;
  payloadHash: string;
  action: DeliveryAction;
  repository: string;
  targetPath: string;
  targetName: string;
  payload: JsonObject;
  provenance?: JsonObject;
}

export interface DeliveryAttemptInput {
  deliveryId: DbId;
  claimOwner?: string;
  stage: string;
  attemptNumber: number;
  outcome: AttemptOutcome;
  retryable?: boolean | null;
  durationMs?: number | null;
  requestContext?: JsonObject;
  responseContext?: JsonObject;
  startedAt?: Date;
  finishedAt?: Date | null;
}

export interface FailureInput {
  syncRequestId?: DbId | null;
  deliveryId?: DbId | null;
  claimOwner?: string;
  sourceDocumentId?: DbId | null;
  stage: string;
  failureClass: FailureClass;
  reason: string;
  retryable: boolean;
  statusCode?: number | null;
  attemptNumber?: number | null;
  context?: JsonObject;
  provenance?: JsonObject;
  occurredAt?: Date;
}

export interface EntryMappingInput {
  deliveryId: DbId;
  claimOwner?: string;
  entryId: DbId;
  provenance?: JsonObject;
}

export interface DeliveryListOptions {
  statuses?: readonly WorkflowStatus[];
  sourceDocumentId?: string;
  vdocKey?: string;
  documentTypes?: readonly string[];
  suppliers?: readonly string[];
  approvedAt?: DateRange;
  updatedAt?: DateRange;
  repository?: string;
  cursor?: PageCursor;
  limit?: number;
}

export interface FailureListOptions {
  statuses?: readonly FailureStatus[];
  failureClasses?: readonly FailureClass[];
  stages?: readonly string[];
  retryable?: boolean;
  sourceDocumentId?: string;
  vdocKey?: string;
  documentTypes?: readonly string[];
  suppliers?: readonly string[];
  approvedAt?: DateRange;
  updatedAt?: DateRange;
  occurredAt?: DateRange;
  cursor?: PageCursor;
  limit?: number;
}

export interface DocumentStatusLookup {
  sourceSystem: string;
  sourceId: string;
  vdocKey?: string;
}

export interface DashboardFilterOptions {
  approvedAt?: DateRange;
  updatedAt?: DateRange;
  documentTypes?: readonly string[];
  suppliers?: readonly string[];
}

export interface ApprovalRevokedInput {
  sourceSystem: string;
  sourceId: string;
  sourceVersion: string;
  result?: JsonObject;
}

export interface ApprovalRevocationInput extends ApprovalRevokedInput {
  eventId: string;
  reason: string;
  revokedAt?: Date;
  provenance?: JsonObject;
}

export interface InboxEventInput {
  consumer: string;
  eventId: string;
  eventType: string;
  payload: JsonObject;
  provenance?: JsonObject;
  receivedAt?: Date;
}

export interface InboxReceipt {
  record: InboxRecord;
  inserted: boolean;
}

export interface HealthResult {
  ok: true;
  migrationReady: true;
  databaseName: string;
  serverVersion: string;
  databaseTime: Date;
  latencyMs: number;
}

export class HealthRepository {
  constructor(private readonly database: QueryExecutor) {}

  async health(): Promise<HealthResult> {
    const startedAt = performance.now();
    const row = one(
      await this.database.query<
        {
          databaseName: string;
          serverVersion: string;
          databaseTime: Date;
          migrationReady: boolean;
        } & Record<string, unknown>
      >(`
      SELECT
        current_database() AS "databaseName",
        current_setting('server_version') AS "serverVersion",
        now() AS "databaseTime",
        (
          to_regclass('source_approval_revocations') IS NOT NULL
          AND (
            SELECT count(*) = 10
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND (
                (
                  table_name = 'deliveries'
                  AND column_name = ANY (ARRAY[
                    'upload_completed_at',
                    'submission_claim_owner',
                    'submission_claimed_until'
                  ])
                ) OR (
                  table_name = 'source_approval_revocations'
                  AND column_name = ANY (ARRAY[
                    'source_system', 'source_id', 'source_version', 'event_id',
                    'reason', 'provenance', 'revoked_at'
                  ])
                )
              )
          )
        ) AS "migrationReady"
    `),
      "Database health query returned no row",
    );
    if (!row.migrationReady) {
      throw new Error("Database migration 010 is not ready");
    }
    return {
      ok: true,
      ...row,
      migrationReady: true,
      latencyMs: performance.now() - startedAt,
    };
  }
}

export class InboxRepository {
  constructor(private readonly database: QueryExecutor) {}

  async receive(input: InboxEventInput): Promise<InboxReceipt> {
    const inserted = await this.database.query<InboxRecord>(
      `
      INSERT INTO event_inbox (
        consumer, event_id, event_type, payload, provenance, received_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, COALESCE($6, now()))
      ON CONFLICT (consumer, event_id) DO NOTHING
      RETURNING ${INBOX_COLUMNS}
    `,
      [
        input.consumer,
        input.eventId,
        input.eventType,
        json(input.payload),
        json(input.provenance ?? {}),
        input.receivedAt ?? null,
      ],
    );
    if (inserted[0]) return { inserted: true, record: inserted[0] };

    const existing = one(
      await this.database.query<InboxRecord>(
        `
      SELECT ${INBOX_COLUMNS}
      FROM event_inbox
      WHERE consumer = $1 AND event_id = $2
    `,
        [input.consumer, input.eventId],
      ),
      "Inbox event was neither inserted nor found",
    );
    return { inserted: false, record: existing };
  }

  async claimNext(
    consumer: string,
    claimOwner: string,
    leaseMs: number,
  ): Promise<InboxRecord | null> {
    positiveInteger(leaseMs, "leaseMs", 2_147_483_647);
    const rows = await this.database.query<InboxRecord>(
      `
      WITH candidate AS (
        SELECT id AS candidate_id
        FROM event_inbox
        WHERE consumer = $1
          AND next_attempt_at <= now()
          AND (
            status IN ('pending', 'failed')
            OR (status = 'processing' AND claimed_until < now())
          )
        ORDER BY received_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE event_inbox AS inbox
      SET status = 'processing',
          claim_owner = $2,
          claimed_until = now() + ($3::integer * interval '1 millisecond'),
          attempt_count = attempt_count + 1,
          last_error = NULL,
          updated_at = now()
      FROM candidate
      WHERE inbox.id = candidate.candidate_id
      RETURNING ${INBOX_COLUMNS}
    `,
      [consumer, claimOwner, leaseMs],
    );
    return rows[0] ?? null;
  }

  async complete(
    id: DbId,
    claimOwner: string,
    attemptCount: number,
  ): Promise<boolean> {
    const rows = await this.database.query<
      { id: string } & Record<string, unknown>
    >(
      `
      UPDATE event_inbox
      SET status = 'completed', processed_at = now(), claim_owner = NULL,
          claimed_until = NULL, updated_at = now()
      WHERE id = $1 AND status = 'processing' AND claim_owner = $2
        AND attempt_count = $3
      RETURNING id::text AS id
    `,
      [id, claimOwner, attemptCount],
    );
    return rows.length === 1;
  }

  /** Completes an event that was atomically persisted with its follow-on work. */
  async completeRecorded(id: DbId): Promise<void> {
    await this.database.execute(
      `
      UPDATE event_inbox
      SET status = 'completed', processed_at = now(), claim_owner = NULL,
          claimed_until = NULL, updated_at = now()
      WHERE id = $1 AND status = 'pending'
    `,
      [id],
    );
  }

  async fail(
    id: DbId,
    claimOwner: string,
    attemptCount: number,
    error: string,
    retryAt: Date,
  ): Promise<boolean> {
    const rows = await this.database.query<
      { id: string } & Record<string, unknown>
    >(
      `
      UPDATE event_inbox
      SET status = 'failed', last_error = $4, next_attempt_at = $5,
          claim_owner = NULL, claimed_until = NULL, updated_at = now()
      WHERE id = $1 AND status = 'processing' AND claim_owner = $2
        AND attempt_count = $3
      RETURNING id::text AS id
    `,
      [id, claimOwner, attemptCount, error, retryAt],
    );
    return rows.length === 1;
  }
}

export class SourceRepository {
  constructor(private readonly database: QueryExecutor) {}

  async lockApprovalVersion(
    sourceSystem: string,
    sourceId: string,
    sourceVersion: string,
  ): Promise<void> {
    await this.database.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`lf-sync:approval:${
        JSON.stringify([sourceSystem, sourceId, sourceVersion])
      }`],
    );
  }

  async upsertCanonicalSource(
    input: CanonicalSourceInput,
  ): Promise<SourceDocumentRecord> {
    return one(
      await this.database.query<SourceDocumentRecord>(
        `
      INSERT INTO source_documents (
        source_system, source_id, source_version, readiness_hash, document_type,
        supplier_id, supplier_name, status, payload, provenance, approved_at, source_created_at,
        source_updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13
      )
      ON CONFLICT (source_system, source_id, source_version) DO UPDATE
      SET readiness_hash = EXCLUDED.readiness_hash,
          document_type = EXCLUDED.document_type,
          supplier_id = EXCLUDED.supplier_id,
          supplier_name = EXCLUDED.supplier_name,
          status = EXCLUDED.status,
          payload = EXCLUDED.payload,
          provenance = EXCLUDED.provenance,
          approved_at = EXCLUDED.approved_at,
          source_created_at = EXCLUDED.source_created_at,
          source_updated_at = EXCLUDED.source_updated_at,
          updated_at = now()
      RETURNING ${SOURCE_DOCUMENT_COLUMNS}
    `,
        [
          input.sourceSystem,
          input.sourceId,
          input.sourceVersion,
          input.readinessHash,
          input.documentType ?? null,
          input.supplierId ?? null,
          input.supplierName ?? null,
          input.status ?? "ready",
          json(input.payload),
          json(input.provenance ?? {}),
          input.approvedAt ?? null,
          input.sourceCreatedAt ?? null,
          input.sourceUpdatedAt ?? null,
        ],
      ),
      "Canonical source upsert returned no row",
    );
  }

  async recordApprovalRevocation(
    input: ApprovalRevocationInput,
  ): Promise<void> {
    await this.database.execute(
      `INSERT INTO source_approval_revocations (
         source_system, source_id, source_version, event_id, reason,
         provenance, revoked_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7, now()))
       ON CONFLICT (source_system, source_id, source_version) DO UPDATE
       SET event_id = EXCLUDED.event_id,
           reason = EXCLUDED.reason,
           provenance = source_approval_revocations.provenance || EXCLUDED.provenance,
           revoked_at = LEAST(source_approval_revocations.revoked_at, EXCLUDED.revoked_at)`,
      [
        input.sourceSystem,
        input.sourceId,
        input.sourceVersion,
        input.eventId,
        input.reason,
        json(input.provenance ?? {}),
        input.revokedAt ?? null,
      ],
    );
  }

  async isApprovalRevoked(
    sourceSystem: string,
    sourceId: string,
    sourceVersion: string,
  ): Promise<boolean> {
    const rows = await this.database.query<
      { revoked: boolean } & Record<string, unknown>
    >(
      `SELECT EXISTS (
         SELECT 1 FROM source_approval_revocations
         WHERE source_system = $1 AND source_id = $2 AND source_version = $3
       ) AS revoked`,
      [sourceSystem, sourceId, sourceVersion],
    );
    return rows[0]?.revoked === true;
  }

  async upsertAttachment(
    input: SourceAttachmentInput,
  ): Promise<SourceAttachmentRecord> {
    return one(
      await this.database.query<SourceAttachmentRecord>(
        `
      INSERT INTO source_attachments (
        source_document_id, source_system, source_id, source_version, vdoc_key,
        byte_reference, content_type, file_name, size_bytes, checksum, payload,
        provenance
      )
      SELECT id, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb
      FROM source_documents
      WHERE source_system = $1 AND source_id = $2 AND source_version = $3
      ON CONFLICT (source_system, source_id, source_version, vdoc_key) DO UPDATE
      SET byte_reference = EXCLUDED.byte_reference,
          content_type = EXCLUDED.content_type,
          file_name = EXCLUDED.file_name,
          size_bytes = EXCLUDED.size_bytes,
          checksum = EXCLUDED.checksum,
          payload = EXCLUDED.payload,
          provenance = EXCLUDED.provenance,
          updated_at = now()
      RETURNING ${SOURCE_ATTACHMENT_COLUMNS}
    `,
        [
          input.sourceSystem,
          input.sourceId,
          input.sourceVersion,
          input.vdocKey,
          input.byteReference,
          input.contentType,
          input.fileName ?? null,
          input.sizeBytes ?? null,
          input.checksum ?? null,
          json(input.payload ?? {}),
          json(input.provenance ?? {}),
        ],
      ),
      "Source attachment upsert returned no row",
    );
  }

  async getById(id: DbId): Promise<SourceDocumentRecord | null> {
    const row = await this.database.drizzle.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, Number(id)),
    });
    return row ? sourceDocumentRecord(row) : null;
  }

  async getBySource(
    sourceSystem: string,
    sourceId: string,
    sourceVersion?: string,
  ): Promise<SourceDocumentRecord | null> {
    const row = await this.database.drizzle.query.sourceDocuments.findFirst({
      where: sourceVersion
        ? and(
          eq(sourceDocuments.sourceSystem, sourceSystem),
          eq(sourceDocuments.sourceId, sourceId),
          eq(sourceDocuments.sourceVersion, sourceVersion),
        )
        : and(
          eq(sourceDocuments.sourceSystem, sourceSystem),
          eq(sourceDocuments.sourceId, sourceId),
        ),
      orderBy: [
        sql`${sourceDocuments.sourceUpdatedAt} DESC NULLS LAST`,
        desc(sourceDocuments.createdAt),
        desc(sourceDocuments.id),
      ],
    });
    return row ? sourceDocumentRecord(row) : null;
  }

  async listAttachments(
    sourceDocumentId: DbId,
  ): Promise<SourceAttachmentRecord[]> {
    const rows = await this.database.drizzle.query.sourceAttachments.findMany({
      where: eq(sourceAttachments.sourceDocumentId, Number(sourceDocumentId)),
      orderBy: [sourceAttachments.vdocKey, sourceAttachments.id],
    });
    return rows.map(sourceAttachmentRecord);
  }

  async getAttachment(
    sourceDocumentId: DbId,
    vdocKey: string,
  ): Promise<SourceAttachmentRecord | null> {
    const row = await this.database.drizzle.query.sourceAttachments.findFirst({
      where: and(
        eq(sourceAttachments.sourceDocumentId, Number(sourceDocumentId)),
        eq(sourceAttachments.vdocKey, vdocKey),
      ),
    });
    return row ? sourceAttachmentRecord(row) : null;
  }

  async getAttachmentById(id: DbId): Promise<SourceAttachmentRecord | null> {
    const row = await this.database.drizzle.query.sourceAttachments.findFirst({
      where: eq(sourceAttachments.id, Number(id)),
    });
    return row ? sourceAttachmentRecord(row) : null;
  }
}

export class DirectoryRepository {
  constructor(private readonly database: QueryExecutor) {}

  async get(
    repository: string,
    canonicalPath: string,
  ): Promise<LaserficheDirectoryRecord | null> {
    const rows = await this.database.query<LaserficheDirectoryRecord>(
      `SELECT ${LASERFICHE_DIRECTORY_COLUMNS}
       FROM laserfiche_directories
       WHERE repository = $1 AND canonical_path = $2`,
      [repository, canonicalPath],
    );
    return rows[0] ?? null;
  }

  async upsertVerified(input: {
    repository: string;
    canonicalPath: string;
    parentDirectoryId?: DbId | null;
    cwsEntryId: DbId;
    name: string;
    metadata?: JsonObject;
    verifiedAt?: Date;
  }): Promise<LaserficheDirectoryRecord> {
    return one(
      await this.database.query<LaserficheDirectoryRecord>(
        `INSERT INTO laserfiche_directories (
         repository, canonical_path, parent_directory_id, cws_entry_id, name,
         status, verified_at, metadata
       ) VALUES ($1, $2, $3, $4, $5, 'verified', COALESCE($6, now()), $7::jsonb)
       ON CONFLICT (repository, canonical_path) DO UPDATE
       SET parent_directory_id = EXCLUDED.parent_directory_id,
           cws_entry_id = EXCLUDED.cws_entry_id,
           name = EXCLUDED.name,
           status = 'verified',
           verified_at = EXCLUDED.verified_at,
           metadata = EXCLUDED.metadata,
           updated_at = now()
       RETURNING ${LASERFICHE_DIRECTORY_COLUMNS}`,
        [
          input.repository,
          input.canonicalPath,
          input.parentDirectoryId ?? null,
          input.cwsEntryId,
          input.name,
          input.verifiedAt ?? null,
          json(input.metadata ?? {}),
        ],
      ),
      "Laserfiche directory upsert returned no row",
    );
  }
}

export class SyncRepository {
  constructor(private readonly database: QueryExecutor) {}

  async createRequest(input: SyncRequestInput): Promise<SyncRequestRecord> {
    const requestedVdocKeys = [...new Set(input.requestedVdocKeys ?? [])]
      .sort();
    return one(
      await this.database.query<SyncRequestRecord>(
        `
      INSERT INTO sync_requests (
        source_document_id, request_key, operation_id, requested_by, reason,
        requested_vdoc_keys, provenance
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      ON CONFLICT (request_key) DO UPDATE
      SET requested_vdoc_keys = CASE
            WHEN sync_requests.requested_vdoc_keys = '[]'::jsonb
              THEN EXCLUDED.requested_vdoc_keys
            ELSE sync_requests.requested_vdoc_keys
          END,
          updated_at = sync_requests.updated_at
      WHERE sync_requests.source_document_id = EXCLUDED.source_document_id
        AND sync_requests.operation_id IS NOT DISTINCT FROM EXCLUDED.operation_id
        AND sync_requests.requested_by IS NOT DISTINCT FROM EXCLUDED.requested_by
        AND sync_requests.reason = EXCLUDED.reason
        AND (
          sync_requests.requested_vdoc_keys = EXCLUDED.requested_vdoc_keys
          OR sync_requests.requested_vdoc_keys = '[]'::jsonb
        )
      RETURNING ${SYNC_REQUEST_COLUMNS}
    `,
        [
          input.sourceDocumentId,
          input.requestKey,
          input.operationId ?? null,
          input.requestedBy ?? null,
          input.reason,
          json(requestedVdocKeys),
          json(input.provenance ?? {}),
        ],
      ),
      "Sync request create returned no row",
    );
  }

  async markActive(id: DbId): Promise<SyncRequestRecord> {
    return one(
      await this.database.query<SyncRequestRecord>(
        `
      UPDATE sync_requests
      SET status = 'active', started_at = COALESCE(started_at, now()),
          updated_at = now()
      WHERE id = $1 AND status IN ('pending', 'active')
      RETURNING ${SYNC_REQUEST_COLUMNS}
    `,
        [id],
      ),
      `Sync request ${id} was not found`,
    );
  }

  async finalize(
    id: DbId,
    status: TerminalWorkflowStatus,
    result: JsonObject,
  ): Promise<SyncRequestRecord> {
    return one(
      await this.database.query<SyncRequestRecord>(
        `
      UPDATE sync_requests
      SET status = $2, result = $3::jsonb,
          finished_at = COALESCE(finished_at, now()), updated_at = now()
      WHERE id = $1 AND (status IN ('pending', 'active') OR status = $2)
      RETURNING ${SYNC_REQUEST_COLUMNS}
    `,
        [id, status, json(result)],
      ),
      `Sync request ${id} was not found`,
    );
  }

  /** Finalizes only after every attachment delivery has reached a terminal state. */
  async finalizeFromDeliveries(id: DbId): Promise<SyncRequestRecord | null> {
    const rows = await this.database.query<SyncRequestRecord>(
      `WITH expected AS (
         SELECT request.id, expected.vdoc_key
         FROM sync_requests AS request
         CROSS JOIN LATERAL jsonb_array_elements_text(
           request.requested_vdoc_keys
         ) AS expected(vdoc_key)
         WHERE request.id = $1
       ), states AS (
         SELECT count(expected.vdoc_key)::integer AS expected_count,
                count(delivery.id)::integer AS delivery_count,
                bool_or(delivery.status IN ('pending', 'active')) AS has_active,
                bool_or(delivery.status = 'completed') AS has_completed,
                bool_or(delivery.status = 'review-required') AS has_review,
                bool_or(delivery.status = 'approval-revoked') AS has_revoked,
                bool_or(delivery.status = 'failed') AS has_failed
         FROM expected
         LEFT JOIN source_attachments AS attachment
           ON attachment.vdoc_key = expected.vdoc_key
          AND attachment.source_document_id = (
            SELECT source_document_id FROM sync_requests WHERE id = $1
          )
         LEFT JOIN deliveries AS delivery
           ON delivery.sync_request_id = $1
          AND delivery.source_attachment_id = attachment.id
       ), updated AS (
         UPDATE sync_requests AS request
          SET status = CASE
                 WHEN states.has_revoked THEN 'approval-revoked'
                 WHEN states.has_completed AND (states.has_review OR states.has_failed) THEN 'partial'
                WHEN states.has_review THEN 'review-required'
                WHEN states.has_failed THEN 'failed'
                ELSE 'completed'
              END::workflow_status,
             finished_at = COALESCE(request.finished_at, now()), updated_at = now()
         FROM states
         WHERE request.id = $1
           AND states.expected_count > 0
           AND states.delivery_count = states.expected_count
           AND NOT COALESCE(states.has_active, false)
           AND request.status IN ('pending', 'active')
         RETURNING request.*
       ) SELECT ${SYNC_REQUEST_COLUMNS} FROM updated`,
      [id],
    );
    return rows[0] ?? null;
  }

  async saveEntitySnapshot(
    input: EntitySnapshotInput,
  ): Promise<EntitySnapshotRecord> {
    return one(
      await this.database.query<EntitySnapshotRecord>(
        `
      INSERT INTO entity_snapshots (
        sync_request_id, entity_id, entity_version, snapshot, provenance,
        source_updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
      ON CONFLICT (sync_request_id, entity_id, entity_version) DO UPDATE
      SET snapshot = EXCLUDED.snapshot,
          provenance = EXCLUDED.provenance,
          source_updated_at = EXCLUDED.source_updated_at,
          updated_at = now()
      RETURNING ${ENTITY_SNAPSHOT_COLUMNS}
    `,
        [
          input.syncRequestId,
          input.entityId,
          input.entityVersion,
          json(input.snapshot),
          json(input.provenance ?? {}),
          input.sourceUpdatedAt ?? null,
        ],
      ),
      "Entity snapshot upsert returned no row",
    );
  }
}

export class DeliveryRepository {
  constructor(private readonly database: QueryExecutor) {}

  async createIdempotently(input: DeliveryInput): Promise<DeliveryRecord> {
    const rows = await this.database.query<DeliveryRecord>(
      `
      WITH delivery AS (
        INSERT INTO deliveries (
          sync_request_id, source_document_id, source_attachment_id,
          idempotency_key, payload_hash, action, repository, target_path,
          target_name, payload, provenance
        )
        SELECT $1, request.source_document_id, $2, $3, $4, $5, $6, $7, $8,
               $9::jsonb, $10::jsonb
        FROM sync_requests AS request
        JOIN source_attachments AS attachment
          ON attachment.id = $2
         AND attachment.source_document_id = request.source_document_id
        WHERE request.id = $1
        ON CONFLICT (idempotency_key) DO UPDATE
        SET updated_at = deliveries.updated_at
        WHERE deliveries.sync_request_id = EXCLUDED.sync_request_id
          AND deliveries.source_document_id = EXCLUDED.source_document_id
          AND deliveries.source_attachment_id = EXCLUDED.source_attachment_id
          AND deliveries.payload_hash = EXCLUDED.payload_hash
          AND deliveries.action = EXCLUDED.action
          AND deliveries.repository = EXCLUDED.repository
          AND deliveries.target_path = EXCLUDED.target_path
          AND deliveries.target_name = EXCLUDED.target_name
          AND deliveries.payload = EXCLUDED.payload
        RETURNING *
      )
      SELECT ${DELIVERY_COLUMNS}
      FROM delivery AS d
      ${DELIVERY_JOINS}
    `,
      [
        input.syncRequestId,
        input.sourceAttachmentId,
        input.idempotencyKey,
        input.payloadHash,
        input.action,
        input.repository,
        input.targetPath,
        input.targetName,
        json(input.payload),
        json(input.provenance ?? {}),
      ],
    );
    const delivery = one(rows, "Delivery create returned no row");
    if (
      delivery.syncRequestId !== input.syncRequestId ||
      delivery.sourceAttachmentId !== input.sourceAttachmentId ||
      delivery.payloadHash !== input.payloadHash ||
      delivery.action !== input.action ||
      delivery.repository !== input.repository ||
      delivery.targetPath !== input.targetPath ||
      delivery.targetName !== input.targetName
    ) {
      throw new Error(
        `Idempotency key ${input.idempotencyKey} belongs to a different delivery`,
      );
    }
    return delivery;
  }

  async markActive(id: DbId): Promise<DeliveryRecord> {
    return this.updateStatus(id, "active", null);
  }

  async finalize(
    id: DbId,
    status: TerminalWorkflowStatus,
    result: JsonObject,
    claimOwner?: string,
  ): Promise<DeliveryRecord> {
    return await this.updateStatus(id, status, result, claimOwner);
  }

  async getDelivery(id: DbId): Promise<DeliveryDetails | null> {
    const deliveries = await this.database.query<DeliveryRecord>(
      `
      SELECT ${DELIVERY_COLUMNS}
      FROM deliveries AS d
      ${DELIVERY_JOINS}
      WHERE d.id = $1
    `,
      [id],
    );
    if (!deliveries[0]) return null;

    const failures = await this.database.query<FailureRecord>(
      `
      SELECT ${FAILURE_COLUMNS}
      FROM failure_records AS f
      ${FAILURE_JOINS}
      WHERE f.delivery_id = $1
      ORDER BY f.occurred_at DESC, f.id DESC
    `,
      [id],
    );
    return { delivery: deliveries[0], failures };
  }

  async getDocumentStatus(
    lookup: DocumentStatusLookup,
  ): Promise<DocumentStatusRecord>;
  async getDocumentStatus(
    sourceDocumentId: string,
    vdocKey?: string,
  ): Promise<DocumentStatusRecord>;
  async getDocumentStatus(
    lookup: DocumentStatusLookup | string,
    legacyVdocKey?: string,
  ): Promise<DocumentStatusRecord> {
    const sourceSystem = typeof lookup === "string"
      ? null
      : lookup.sourceSystem;
    const sourceDocumentId = typeof lookup === "string"
      ? lookup
      : lookup.sourceId;
    const vdocKey = typeof lookup === "string" ? legacyVdocKey : lookup.vdocKey;
    interface DocumentHead extends Record<string, unknown> {
      id: DbId;
      sourceVersion: string;
      updatedAt: Date;
    }
    const documents = await this.database.query<DocumentHead>(
      `
      SELECT source.id::text AS id,
             source.source_version AS "sourceVersion",
             source.updated_at AS "updatedAt"
      FROM source_documents AS source
       WHERE source.source_id = $1
         AND ($2::text IS NULL OR source.source_system = $2)
      ORDER BY source.source_updated_at DESC NULLS LAST,
               source.created_at DESC, source.id DESC
      LIMIT 1
    `,
      [sourceDocumentId, sourceSystem],
    );
    const document = documents[0];
    if (!document) {
      return {
        sourceDocumentId,
        sourceVersion: null,
        status: "unknown",
        updatedAt: null,
        deliveries: [],
        failures: [],
      };
    }

    interface RequestHead extends Record<string, unknown> {
      id: DbId;
      status: WorkflowStatus;
      updatedAt: Date;
    }
    const requests = await this.database.query<RequestHead>(
      `
      SELECT id::text AS id, status, updated_at AS "updatedAt"
      FROM sync_requests
      WHERE source_document_id = $1
      ORDER BY requested_at DESC, id DESC
      LIMIT 1
    `,
      [document.id],
    );
    const request = requests[0];

    const deliveries = request
      ? await this.database.query<DeliveryRecord>(
        `
      SELECT ${DELIVERY_COLUMNS}
      FROM deliveries AS d
      ${DELIVERY_JOINS}
      WHERE d.sync_request_id = $1
        AND ($2::text IS NULL OR sa.vdoc_key = $2)
      ORDER BY d.created_at DESC, d.id DESC
    `,
        [request.id, vdocKey ?? null],
      )
      : [];
    const failures = await this.database.query<FailureRecord>(
      `
      SELECT ${FAILURE_COLUMNS}
      FROM failure_records AS f
      ${FAILURE_JOINS}
      WHERE COALESCE(f.source_document_id, d.source_document_id, fsr.source_document_id) = $1
        AND ($2::text IS NULL OR sa.vdoc_key = $2)
        AND (
          $3::bigint IS NULL
          OR f.sync_request_id = $3
          OR d.sync_request_id = $3
        )
      ORDER BY f.occurred_at DESC, f.id DESC
    `,
      [document.id, vdocKey ?? null, request?.id ?? null],
    );

    return {
      sourceDocumentId,
      sourceVersion: document.sourceVersion,
      status: vdocKey !== undefined && deliveries.length > 0
        ? aggregateDeliveryStatus(deliveries)
        : request?.status ?? "unknown",
      updatedAt: latestDate([
        document.updatedAt,
        request?.updatedAt,
        ...deliveries.map((delivery) => delivery.updatedAt),
        ...failures.map((failure) => failure.updatedAt),
      ]),
      deliveries,
      failures,
    };
  }

  async markApprovalRevoked(
    input: ApprovalRevokedInput,
  ): Promise<DeliveryRecord[]> {
    return await this.markApprovalRevokedBySourceVersion(input);
  }

  async markApprovalRevokedBySourceVersion(
    input: ApprovalRevokedInput,
  ): Promise<DeliveryRecord[]> {
    return await this.database.query<DeliveryRecord>(
      `
       WITH source AS (
         SELECT id FROM source_documents
         WHERE source_system = $1 AND source_id = $2 AND source_version = $3
       ), requests AS (
         UPDATE sync_requests AS request
         SET status = 'approval-revoked',
             result = COALESCE(result, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb),
             finished_at = COALESCE(finished_at, now()), updated_at = now()
         FROM source
         WHERE request.source_document_id = source.id
         RETURNING request.id
       ), updated AS (
         UPDATE deliveries AS target
        SET status = 'approval-revoked',
             result = COALESCE(result, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb),
            finished_at = COALESCE(finished_at, now()),
            updated_at = now()
         FROM source
         WHERE target.source_document_id = source.id
        RETURNING target.*
      )
      SELECT ${DELIVERY_COLUMNS}
      FROM updated AS d
      ${DELIVERY_JOINS}
      ORDER BY d.created_at DESC, d.id DESC
    `,
      [
        input.sourceSystem,
        input.sourceId,
        input.sourceVersion,
        input.result === undefined ? null : json(input.result),
      ],
    );
  }

  async recordAttempt(
    input: DeliveryAttemptInput,
  ): Promise<DeliveryAttemptRecord> {
    return one(
      await this.database.query<DeliveryAttemptRecord>(
        `
      INSERT INTO delivery_attempts (
        delivery_id, stage, attempt_number, outcome, retryable, duration_ms,
        request_context, response_context, started_at, finished_at
      )
      SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb,
             COALESCE($9, now()), $10
      WHERE $11::text IS NULL OR EXISTS (
        SELECT 1
        FROM deliveries AS delivery
        WHERE delivery.id = $1
          AND delivery.status = 'active'
          AND delivery.submission_claim_owner = $11
          AND delivery.submission_claimed_until > now()
          AND NOT EXISTS (
            SELECT 1
            FROM source_documents AS source
            JOIN source_approval_revocations AS revocation
              ON revocation.source_system = source.source_system
             AND revocation.source_id = source.source_id
             AND revocation.source_version = source.source_version
            WHERE source.id = delivery.source_document_id
          )
      )
      ON CONFLICT (delivery_id, stage, attempt_number) DO UPDATE
      SET outcome = EXCLUDED.outcome,
          retryable = EXCLUDED.retryable,
          duration_ms = EXCLUDED.duration_ms,
          request_context = EXCLUDED.request_context,
          response_context = EXCLUDED.response_context,
          finished_at = EXCLUDED.finished_at,
          updated_at = now()
      RETURNING ${ATTEMPT_COLUMNS}
    `,
        [
          input.deliveryId,
          input.stage,
          input.attemptNumber,
          input.outcome,
          input.retryable ?? null,
          input.durationMs ?? null,
          json(input.requestContext ?? {}),
          json(input.responseContext ?? {}),
          input.startedAt ?? null,
          input.finishedAt ?? null,
          input.claimOwner ?? null,
        ],
      ),
      "Delivery attempt upsert returned no row",
    );
  }

  async recordFailure(input: FailureInput): Promise<FailureRecord> {
    return one(
      await this.database.query<FailureRecord>(
        `
      WITH inserted AS (
        INSERT INTO failure_records (
          sync_request_id, delivery_id, source_document_id, stage, failure_class,
          reason, retryable, status_code, attempt_number, context, provenance,
          occurred_at
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
               $11::jsonb, COALESCE($12, now())
        WHERE $13::text IS NULL OR EXISTS (
          SELECT 1
          FROM deliveries AS delivery
          WHERE delivery.id = $2
            AND delivery.status = 'active'
            AND delivery.submission_claim_owner = $13
            AND delivery.submission_claimed_until > now()
            AND NOT EXISTS (
              SELECT 1
              FROM source_documents AS source
              JOIN source_approval_revocations AS revocation
                ON revocation.source_system = source.source_system
               AND revocation.source_id = source.source_id
               AND revocation.source_version = source.source_version
              WHERE source.id = delivery.source_document_id
            )
        )
        RETURNING *
      )
      SELECT ${FAILURE_COLUMNS}
      FROM inserted AS f
      ${FAILURE_JOINS}
    `,
        [
          input.syncRequestId ?? null,
          input.deliveryId ?? null,
          input.sourceDocumentId ?? null,
          input.stage,
          input.failureClass,
          input.reason,
          input.retryable,
          input.statusCode ?? null,
          input.attemptNumber ?? null,
          json(input.context ?? {}),
          json(input.provenance ?? {}),
          input.occurredAt ?? null,
          input.claimOwner ?? null,
        ],
      ),
      "Failure insert returned no row",
    );
  }

  async queueSnapshot(): Promise<DeliveryQueueSnapshot> {
    return one(
      await this.database.query<DeliveryQueueSnapshot>(
        `
        WITH delivery_counts AS (
          SELECT status, count(*)::integer AS count
          FROM deliveries
          GROUP BY status
        ), active_age AS (
          SELECT floor(extract(epoch FROM now() - min(updated_at)))::integer AS seconds
          FROM deliveries
          WHERE status = 'active'
        ), open_failure_count AS (
          SELECT count(*)::integer AS count
          FROM failure_records
          WHERE status = 'open'
        )
        SELECT now()::text AS "capturedAt",
               COALESCE(jsonb_object_agg(dc.status, dc.count), '{}'::jsonb) AS "deliveriesByStatus",
               COALESCE((SELECT count FROM delivery_counts WHERE status = 'active'), 0)::integer AS "activeDeliveries",
               (SELECT count FROM open_failure_count)::integer AS "openFailures",
               (SELECT seconds FROM active_age) AS "oldestActiveDeliveryAgeSeconds"
        FROM delivery_counts AS dc
      `,
      ),
      "Delivery queue snapshot returned no row",
    );
  }

  async scheduleRetry(
    deliveryId: DbId,
    retryAt: Date,
    reason: string,
    claimOwner?: string,
  ): Promise<void> {
    const rows = await this.database.query<
      { id: string } & Record<string, unknown>
    >(
      `UPDATE deliveries
       SET next_attempt_at = $2,
           last_retry_reason = $3,
           updated_at = now()
       WHERE id = $1
         AND ($4::text IS NULL OR (
           status = 'active'
           AND submission_claim_owner = $4
           AND submission_claimed_until > now()
           AND NOT EXISTS (
             SELECT 1
             FROM source_documents AS source
             JOIN source_approval_revocations AS revocation
               ON revocation.source_system = source.source_system
              AND revocation.source_id = source.source_id
              AND revocation.source_version = source.source_version
             WHERE source.id = deliveries.source_document_id
           )
         ))
       RETURNING id::text AS id`,
      [deliveryId, retryAt, reason, claimOwner ?? null],
    );
    one(rows, `Delivery ${deliveryId} submission claim was lost`);
  }

  async listDueRetries(limit: number): Promise<DeliveryRecord[]> {
    positiveInteger(limit, "limit", 500);
    return await this.database.query<DeliveryRecord>(
      `
      SELECT ${DELIVERY_COLUMNS}
      FROM deliveries AS d
      ${DELIVERY_JOINS}
      WHERE d.status = 'failed'
        AND d.next_attempt_at IS NOT NULL
        AND d.next_attempt_at <= now()
        AND d.retry_count < d.max_attempts
        AND NOT EXISTS (
          SELECT 1 FROM source_approval_revocations AS revocation
          WHERE revocation.source_system = sd.source_system
            AND revocation.source_id = sd.source_id
            AND revocation.source_version = sd.source_version
        )
        AND EXISTS (
          SELECT 1
          FROM failure_records AS f
          WHERE f.delivery_id = d.id
            AND f.status = 'open'
            AND f.retryable = true
        )
      ORDER BY d.next_attempt_at, d.id
      LIMIT $1
    `,
      [limit],
    );
  }

  async listStaleActiveForRetry(
    staleBefore: Date,
    limit: number,
  ): Promise<DeliveryRecord[]> {
    positiveInteger(limit, "limit", 500);
    return await this.database.query<DeliveryRecord>(
      `
      SELECT ${DELIVERY_COLUMNS}
      FROM deliveries AS d
      ${DELIVERY_JOINS}
      WHERE d.status = 'active'
        AND d.updated_at < $1
        AND d.retry_count < d.max_attempts
        AND NOT EXISTS (
          SELECT 1 FROM source_approval_revocations AS revocation
          WHERE revocation.source_system = sd.source_system
            AND revocation.source_id = sd.source_id
            AND revocation.source_version = sd.source_version
        )
        AND (d.submission_claimed_until IS NULL OR d.submission_claimed_until < now())
      ORDER BY d.updated_at, d.id
      LIMIT $2
    `,
      [staleBefore, limit],
    );
  }

  async markRetrying(id: DbId): Promise<DeliveryRecord> {
    const rows = await this.database.query<DeliveryRecord>(
      `
      WITH updated AS (
        UPDATE deliveries AS d
        SET status = 'active',
            result = '{}'::jsonb,
            retry_count = retry_count + 1,
            next_attempt_at = NULL,
            started_at = COALESCE(started_at, now()),
            finished_at = NULL,
            updated_at = now()
        WHERE d.id = $1
          AND d.status = 'failed'
          AND d.next_attempt_at IS NOT NULL
          AND d.next_attempt_at <= now()
          AND d.retry_count < d.max_attempts
          AND NOT EXISTS (
            SELECT 1
            FROM source_documents AS source
            JOIN source_approval_revocations AS revocation
              ON revocation.source_system = source.source_system
             AND revocation.source_id = source.source_id
             AND revocation.source_version = source.source_version
            WHERE source.id = d.source_document_id
          )
        RETURNING *
      )
      SELECT ${DELIVERY_COLUMNS}
      FROM updated AS d
      ${DELIVERY_JOINS}
    `,
      [id],
    );
    const delivery = one(rows, `Delivery ${id} was not ready for retry`);
    await this.database.execute(
      `UPDATE sync_requests
       SET status = 'active', result = NULL, finished_at = NULL,
           started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'active', 'failed', 'partial')`,
      [delivery.syncRequestId],
    );
    return delivery;
  }

  async markStaleActiveRetrying(
    id: DbId,
    staleBefore: Date,
  ): Promise<DeliveryRecord> {
    const rows = await this.database.query<DeliveryRecord>(
      `
      WITH updated AS (
        UPDATE deliveries AS d
        SET retry_count = retry_count + 1,
            last_retry_reason = 'stale active delivery resubmitted',
            next_attempt_at = NULL,
            started_at = COALESCE(started_at, now()),
            finished_at = NULL,
            updated_at = now()
        WHERE d.id = $1
          AND d.status = 'active'
          AND d.updated_at < $2
          AND d.retry_count < d.max_attempts
          AND (d.submission_claimed_until IS NULL OR d.submission_claimed_until < now())
          AND NOT EXISTS (
            SELECT 1
            FROM source_documents AS source
            JOIN source_approval_revocations AS revocation
              ON revocation.source_system = source.source_system
             AND revocation.source_id = source.source_id
             AND revocation.source_version = source.source_version
            WHERE source.id = d.source_document_id
          )
        RETURNING d.*
      )
      SELECT ${DELIVERY_COLUMNS}
      FROM updated AS d
      ${DELIVERY_JOINS}
    `,
      [id, staleBefore],
    );
    const delivery = one(rows, `Delivery ${id} was not stale-active retryable`);
    await this.database.execute(
      `UPDATE sync_requests
       SET status = 'active', result = NULL, finished_at = NULL,
           started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'active', 'failed', 'partial')`,
      [delivery.syncRequestId],
    );
    return delivery;
  }

  async resolveOpenFailuresForRetry(
    deliveryId: DbId,
    context: JsonObject,
  ): Promise<number> {
    const rows = await this.database.query<
      { id: string } & Record<string, unknown>
    >(
      `
      UPDATE failure_records
      SET status = 'resolved',
          resolved_at = now(),
          context = context || $2::jsonb,
          updated_at = now()
      WHERE delivery_id = $1
        AND status = 'open'
        AND retryable = true
      RETURNING id::text AS id
    `,
      [deliveryId, json(context)],
    );
    return rows.length;
  }

  async resolveFailure(
    id: DbId,
    status: Extract<FailureStatus, "resolved" | "dismissed">,
  ): Promise<FailureRecord> {
    return one(
      await this.database.query<FailureRecord>(
        `
      WITH updated AS (
        UPDATE failure_records
        SET status = $2, resolved_at = COALESCE(resolved_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      )
      SELECT ${FAILURE_COLUMNS}
      FROM updated AS f
      ${FAILURE_JOINS}
    `,
        [id, status],
      ),
      `Failure ${id} was not found`,
    );
  }

  async persistEntryId(
    input: EntryMappingInput,
  ): Promise<EntryMappingRecord> {
    const rows = await this.database.query<EntryMappingRecord>(
      `
      INSERT INTO entry_mappings (
        delivery_id, repository, entry_id, idempotency_key, payload_hash,
        provenance
      )
       SELECT id, repository, $2, idempotency_key, payload_hash, $3::jsonb
       FROM deliveries
       WHERE id = $1
         AND ($4::text IS NULL OR (
           submission_claim_owner = $4
           AND submission_claimed_until > now()
         ))
      ON CONFLICT (delivery_id) DO UPDATE
      SET provenance = EXCLUDED.provenance,
          updated_at = now()
      WHERE entry_mappings.repository = EXCLUDED.repository
        AND entry_mappings.entry_id = EXCLUDED.entry_id
        AND entry_mappings.idempotency_key = EXCLUDED.idempotency_key
        AND entry_mappings.payload_hash = EXCLUDED.payload_hash
      RETURNING ${ENTRY_MAPPING_COLUMNS}
    `,
      [
        input.deliveryId,
        input.entryId,
        json(input.provenance ?? {}),
        input.claimOwner ?? null,
      ],
    );
    if (rows[0]) {
      await this.database.execute(
        `UPDATE deliveries
         SET cws_entry_id = $2, updated_at = now()
         WHERE id = $1
           AND ($3::text IS NULL OR (
             submission_claim_owner = $3
             AND submission_claimed_until > now()
           ))`,
        [input.deliveryId, input.entryId, input.claimOwner ?? null],
      );
      return rows[0];
    }

    const existing = await this.database.query<EntryMappingRecord>(
      `
      SELECT ${ENTRY_MAPPING_COLUMNS}
      FROM entry_mappings
      WHERE delivery_id = $1
    `,
      [input.deliveryId],
    );
    if (existing[0]) {
      throw new Error(
        `Delivery ${input.deliveryId} is already mapped to ` +
          `${existing[0].repository}/${existing[0].entryId}`,
      );
    }
    throw new Error("Entry mapping could not be persisted");
  }

  async markUploadCompleted(
    deliveryId: DbId,
    claimOwner?: string,
  ): Promise<void> {
    const rows = await this.database.query<
      { id: string } & Record<string, unknown>
    >(
      `UPDATE deliveries
       SET upload_completed_at = COALESCE(upload_completed_at, now()), updated_at = now()
       WHERE id = $1
         AND ($2::text IS NULL OR (
           submission_claim_owner = $2
           AND submission_claimed_until > now()
         ))
       RETURNING id::text AS id`,
      [deliveryId, claimOwner ?? null],
    );
    one(rows, `Delivery ${deliveryId} submission claim was lost`);
  }

  async claimForSubmission(
    id: DbId,
    owner: string,
    leaseUntil: Date,
  ): Promise<DeliveryRecord | null> {
    const rows = await this.database.query<DeliveryRecord>(
      `WITH updated AS (
         UPDATE deliveries AS delivery
         SET submission_claim_owner = $2, submission_claimed_until = $3,
             status = 'active', started_at = COALESCE(started_at, now()),
             updated_at = now()
         FROM source_documents AS source
         WHERE delivery.id = $1
           AND delivery.source_document_id = source.id
           AND delivery.status IN ('pending', 'active')
           AND (delivery.submission_claimed_until IS NULL OR delivery.submission_claimed_until < now())
           AND NOT EXISTS (
             SELECT 1 FROM source_approval_revocations AS revocation
             WHERE revocation.source_system = source.source_system
               AND revocation.source_id = source.source_id
               AND revocation.source_version = source.source_version
           )
         RETURNING delivery.*
       )
       SELECT ${DELIVERY_COLUMNS}
       FROM updated AS d
       ${DELIVERY_JOINS}`,
      [id, owner, leaseUntil],
    );
    return rows[0] ?? null;
  }

  async renewSubmissionClaim(
    id: DbId,
    owner: string,
    leaseUntil: Date,
  ): Promise<boolean> {
    const rows = await this.database.query<
      { id: string } & Record<string, unknown>
    >(
      `UPDATE deliveries AS delivery
       SET submission_claimed_until = $3, updated_at = now()
       FROM source_documents AS source
       WHERE delivery.id = $1
         AND delivery.source_document_id = source.id
         AND delivery.status = 'active'
         AND delivery.submission_claim_owner = $2
         AND delivery.submission_claimed_until > now()
         AND NOT EXISTS (
           SELECT 1 FROM source_approval_revocations AS revocation
           WHERE revocation.source_system = source.source_system
             AND revocation.source_id = source.source_id
             AND revocation.source_version = source.source_version
         )
       RETURNING delivery.id::text AS id`,
      [id, owner, leaseUntil],
    );
    return rows.length === 1;
  }

  async releaseSubmissionClaim(id: DbId, owner: string): Promise<void> {
    await this.database.execute(
      `UPDATE deliveries
       SET submission_claim_owner = NULL, submission_claimed_until = NULL,
           updated_at = now()
       WHERE id = $1 AND submission_claim_owner = $2`,
      [id, owner],
    );
  }

  async deferSubmission(id: DbId): Promise<void> {
    await this.database.execute(
      `UPDATE deliveries
       SET status = 'pending', submission_claim_owner = NULL,
           submission_claimed_until = NULL, updated_at = now()
       WHERE id = $1
         AND (
           status = 'pending'
           OR (
             status = 'active'
             AND (
               submission_claimed_until IS NULL
               OR submission_claimed_until < now()
             )
           )
         )`,
      [id],
    );
  }

  async listPendingForActivation(limit: number): Promise<DeliveryRecord[]> {
    positiveInteger(limit, "limit", 500);
    return await this.database.query<DeliveryRecord>(
      `SELECT ${DELIVERY_COLUMNS}
       FROM deliveries AS d
       ${DELIVERY_JOINS}
       WHERE d.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM source_approval_revocations AS revocation
           WHERE revocation.source_system = sd.source_system
             AND revocation.source_id = sd.source_id
             AND revocation.source_version = sd.source_version
         )
       ORDER BY d.created_at, d.id
       LIMIT $1`,
      [limit],
    );
  }

  async persistContent(input: DeliveryContentInput): Promise<void> {
    const rows = await this.database.query<
      { id: string } & Record<string, unknown>
    >(
      `UPDATE deliveries
       SET directory_id = $2, content_sha256 = $3, bytes = $4,
            content_type = $5, upload_extension = $6, updated_at = now()
       WHERE id = $1
         AND ($7::text IS NULL OR (
           status = 'active'
           AND submission_claim_owner = $7
           AND submission_claimed_until > now()
           AND NOT EXISTS (
             SELECT 1
             FROM source_documents AS source
             JOIN source_approval_revocations AS revocation
               ON revocation.source_system = source.source_system
              AND revocation.source_id = source.source_id
              AND revocation.source_version = source.source_version
             WHERE source.id = deliveries.source_document_id
           )
         ))
       RETURNING id::text AS id`,
      [
        input.deliveryId,
        input.directoryId,
        input.sha256,
        input.byteLength,
        input.contentType,
        input.uploadExtension,
        input.claimOwner ?? null,
      ],
    );
    one(rows, `Delivery ${input.deliveryId} submission claim was lost`);
  }

  async findExistingContent(
    input: Omit<DeliveryContentInput, "deliveryId">,
  ): Promise<ExistingDeliveryContentRecord | null> {
    const rows = await this.database.query<ExistingDeliveryContentRecord>(
      `
      SELECT id AS "deliveryId", cws_entry_id AS "entryId",
             content_sha256 AS "sha256", bytes AS "byteLength",
             content_type AS "contentType", upload_extension AS "uploadExtension"
      FROM deliveries
      WHERE directory_id = $1
        AND content_sha256 = $2
        AND cws_entry_id IS NOT NULL
        AND status = 'completed'
      ORDER BY id
      LIMIT 1
    `,
      [input.directoryId, input.sha256],
    );
    return rows[0] ?? null;
  }

  async persistDuplicateContent(input: DeliveryContentInput): Promise<void> {
    const rows = await this.database.query<
      { id: string } & Record<string, unknown>
    >(
      `UPDATE deliveries
       SET directory_id = $2, bytes = $3,
            content_type = $4, upload_extension = $5,
            updated_at = now()
       WHERE id = $1
         AND ($6::text IS NULL OR (
           status = 'active'
           AND submission_claim_owner = $6
           AND submission_claimed_until > now()
           AND NOT EXISTS (
             SELECT 1
             FROM source_documents AS source
             JOIN source_approval_revocations AS revocation
               ON revocation.source_system = source.source_system
              AND revocation.source_id = source.source_id
              AND revocation.source_version = source.source_version
             WHERE source.id = deliveries.source_document_id
           )
         ))
       RETURNING id::text AS id`,
      [
        input.deliveryId,
        input.directoryId,
        input.byteLength,
        input.contentType,
        input.uploadExtension,
        input.claimOwner ?? null,
      ],
    );
    one(rows, `Delivery ${input.deliveryId} submission claim was lost`);
  }

  async persistReusedEntryId(input: EntryMappingInput): Promise<void> {
    const rows = await this.database.query<
      { id: string } & Record<string, unknown>
    >(
      `UPDATE deliveries
       SET cws_entry_id = $2, updated_at = now()
       WHERE id = $1
         AND ($3::text IS NULL OR (
           status = 'active'
           AND submission_claim_owner = $3
           AND submission_claimed_until > now()
           AND NOT EXISTS (
             SELECT 1
             FROM source_documents AS source
             JOIN source_approval_revocations AS revocation
               ON revocation.source_system = source.source_system
              AND revocation.source_id = source.source_id
              AND revocation.source_version = source.source_version
             WHERE source.id = deliveries.source_document_id
           )
         ))
       RETURNING id::text AS id`,
      [input.deliveryId, input.entryId, input.claimOwner ?? null],
    );
    one(rows, `Delivery ${input.deliveryId} submission claim was lost`);
  }

  async dashboardSummary(
    options: DashboardFilterOptions = {},
  ): Promise<DashboardSummary> {
    return one(
      await this.database.query<DashboardSummary>(
        `
      WITH filtered_documents AS (
        SELECT sd.id
        FROM source_documents AS sd
        WHERE (
            $1::jsonb IS NULL
            OR sd.document_type IN (SELECT jsonb_array_elements_text($1::jsonb))
          )
          AND (
            $2::jsonb IS NULL
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text($2::jsonb) AS wanted(value)
              WHERE wanted.value = ANY (ARRAY[
                sd.supplier_id, sd.supplier_name,
                sd.payload->>'supplier', sd.payload->>'supplierId',
                sd.payload #>> '{supplier,id}', sd.payload #>> '{supplier,key}',
                sd.payload #>> '{supplier,name}',
                sd.provenance->>'supplier', sd.provenance->>'supplierId',
                sd.provenance #>> '{supplier,id}',
                sd.provenance #>> '{supplier,key}',
                sd.provenance #>> '{supplier,name}'
              ])
            )
           )
          AND ($3::timestamptz IS NULL OR sd.approved_at >= $3)
          AND ($4::timestamptz IS NULL OR sd.approved_at < $4)
      ), filtered_deliveries AS (
        SELECT d.id, d.status, d.finished_at, sr.requested_at,
               sa.size_bytes
        FROM deliveries AS d
        JOIN filtered_documents AS fd ON fd.id = d.source_document_id
        JOIN sync_requests AS sr ON sr.id = d.sync_request_id
        JOIN source_attachments AS sa ON sa.id = d.source_attachment_id
        WHERE ($5::timestamptz IS NULL OR d.updated_at >= $5)
          AND ($6::timestamptz IS NULL OR d.updated_at < $6)
      ), completed_deliveries AS (
        SELECT *
        FROM filtered_deliveries
        WHERE status = 'completed' AND finished_at IS NOT NULL
      ), completion_trend AS (
        SELECT
          date_trunc('day', finished_at) AS bucket_start,
          count(*)::integer AS documents_delivered,
          CASE WHEN count(*) FILTER (WHERE size_bytes IS NULL) = 0
            THEN COALESCE(sum(size_bytes), 0)::bigint
          END AS document_bytes_delivered,
          round(avg(EXTRACT(EPOCH FROM (finished_at - requested_at)) * 1000)
            FILTER (WHERE finished_at >= requested_at))::integer
            AS average_completion_latency_ms
        FROM completed_deliveries
        GROUP BY date_trunc('day', finished_at)
      )
      SELECT
        (SELECT count(*)::integer FROM filtered_documents) AS "sourceDocuments",
        (SELECT count(*)::integer FROM completed_deliveries) AS "documentsDelivered",
        (
          SELECT CASE WHEN count(*) FILTER (WHERE size_bytes IS NULL) = 0
            THEN COALESCE(sum(size_bytes), 0)::bigint
          END
          FROM completed_deliveries
        ) AS "documentBytesDelivered",
        COALESCE((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'bucketStart', bucket_start,
            'documentsDelivered', documents_delivered,
            'documentBytesDelivered', document_bytes_delivered::text,
            'averageCompletionLatencyMs', average_completion_latency_ms
          )) ORDER BY bucket_start)
          FROM completion_trend
        ), '[]'::jsonb) AS "completionTrend",
        count(*) FILTER (WHERE filtered_deliveries.status = 'pending')::integer AS "deliveriesPending",
        count(*) FILTER (WHERE filtered_deliveries.status = 'active')::integer AS "deliveriesActive",
        count(*) FILTER (WHERE filtered_deliveries.status = 'review-required')::integer AS "deliveriesReviewRequired",
        count(*) FILTER (WHERE filtered_deliveries.status = 'approval-revoked')::integer AS "deliveriesApprovalRevoked",
        count(*) FILTER (WHERE filtered_deliveries.status = 'completed')::integer AS "deliveriesCompleted",
        count(*) FILTER (WHERE filtered_deliveries.status = 'partial')::integer AS "deliveriesPartial",
        count(*) FILTER (WHERE filtered_deliveries.status = 'failed')::integer AS "deliveriesFailed",
        (
          SELECT count(*)::integer
          FROM failure_records AS f
          ${FAILURE_JOINS}
          JOIN filtered_documents AS fd
            ON fd.id = COALESCE(f.source_document_id, d.source_document_id, fsr.source_document_id)
          WHERE f.status = 'open'
        ) AS "openFailures",
        (SELECT count(*)::integer FROM event_inbox WHERE status IN ('pending', 'failed')) AS "inboxBacklog",
        (SELECT count(*)::integer FROM trellis_outbox WHERE state IN ('pending', 'failed')) AS "outboxBacklog"
      FROM filtered_deliveries
    `,
        [
          jsonArrayOrNull(options.documentTypes),
          jsonArrayOrNull(options.suppliers),
          options.approvedAt?.from ?? null,
          options.approvedAt?.to ?? null,
          options.updatedAt?.from ?? null,
          options.updatedAt?.to ?? null,
        ],
      ),
      "Dashboard summary returned no row",
    );
  }

  async listDeliveries(
    options: DeliveryListOptions = {},
  ): Promise<Page<DeliveryRecord>> {
    const limit = pageLimit(options.limit);
    const rows = await this.database.query<DeliveryRecord>(
      `
      SELECT ${DELIVERY_COLUMNS}
      FROM deliveries AS d
      ${DELIVERY_JOINS}
      WHERE (
          $1::jsonb IS NULL
          OR d.status::text IN (SELECT jsonb_array_elements_text($1::jsonb))
        )
        AND ($2::text IS NULL OR sd.source_id = $2)
        AND ($3::text IS NULL OR sa.vdoc_key = $3)
        AND (
          $4::jsonb IS NULL
          OR sd.document_type IN (SELECT jsonb_array_elements_text($4::jsonb))
        )
        AND (
          $5::jsonb IS NULL
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text($5::jsonb) AS wanted(value)
            WHERE wanted.value = ANY (ARRAY[
              sd.supplier_id, sd.supplier_name,
              sd.payload->>'supplier', sd.payload->>'supplierId',
              sd.payload #>> '{supplier,id}', sd.payload #>> '{supplier,key}',
              sd.payload #>> '{supplier,name}',
              sd.provenance->>'supplier', sd.provenance->>'supplierId',
              sd.provenance #>> '{supplier,id}',
              sd.provenance #>> '{supplier,key}',
              sd.provenance #>> '{supplier,name}'
            ])
          )
        )
        AND ($6::timestamptz IS NULL OR sd.approved_at >= $6)
        AND ($7::timestamptz IS NULL OR sd.approved_at < $7)
        AND ($8::timestamptz IS NULL OR d.updated_at >= $8)
        AND ($9::timestamptz IS NULL OR d.updated_at < $9)
        AND ($10::text IS NULL OR d.repository = $10)
        AND (
          $11::timestamptz IS NULL
          OR (d.created_at, d.id) < ($11::timestamptz, $12::bigint)
        )
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $13
    `,
      [
        jsonArrayOrNull(options.statuses),
        options.sourceDocumentId ?? null,
        options.vdocKey ?? null,
        jsonArrayOrNull(options.documentTypes),
        jsonArrayOrNull(options.suppliers),
        options.approvedAt?.from ?? null,
        options.approvedAt?.to ?? null,
        options.updatedAt?.from ?? null,
        options.updatedAt?.to ?? null,
        options.repository ?? null,
        options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        limit + 1,
      ],
    );
    return page(rows, limit);
  }

  async getFailure(id: DbId): Promise<FailureRecord | null> {
    const rows = await this.database.query<FailureRecord>(
      `
      SELECT ${FAILURE_COLUMNS}
      FROM failure_records AS f
      ${FAILURE_JOINS}
      WHERE f.id = $1
    `,
      [id],
    );
    return rows[0] ?? null;
  }

  async failureSummary(): Promise<FailureSummaryMetrics> {
    const rows = await this.database.query<FailureSummaryMetrics>(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE f.status = 'open' AND d.status = 'failed'
        )::int AS "activeOpen",
        COUNT(*) FILTER (
          WHERE f.status = 'open' AND d.status = 'review-required'
        )::int AS "reviewOpen",
        COUNT(*) FILTER (
          WHERE f.status = 'open'
            AND (d.id IS NULL OR d.status NOT IN ('failed', 'review-required'))
        )::int AS "staleOpen",
        COUNT(*) FILTER (WHERE f.status = 'resolved')::int AS resolved,
        COUNT(*) FILTER (WHERE f.status = 'dismissed')::int AS dismissed
      FROM failure_records AS f
      LEFT JOIN deliveries AS d ON d.id = f.delivery_id
    `,
    );
    return rows[0] ?? {
      activeOpen: 0,
      reviewOpen: 0,
      staleOpen: 0,
      resolved: 0,
      dismissed: 0,
      total: 0,
    };
  }

  async failureTypeSummary(limit = 100): Promise<FailureTypeSummary[]> {
    const rows = await this.database.query<FailureTypeSummary>(
      `
      WITH normalized AS (
        SELECT
          f.stage,
          f.failure_class AS "failureClass",
          trim(
            regexp_replace(
              regexp_replace(f.reason, '\\b[0-9a-f]{24}\\b', '<id>', 'gi'),
              '\\b[0-9]{6,}\\b', '<number>', 'g'
            )
          ) AS reason,
          f.status,
          f.occurred_at
        FROM failure_records AS f
      )
      SELECT
        md5(stage || '|' || "failureClass" || '|' || reason) AS key,
        stage,
        "failureClass",
        reason,
        COUNT(*) FILTER (WHERE status = 'open')::int AS open,
        COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed,
        COUNT(*)::int AS total,
        MAX(occurred_at) AS "latestOccurredAt"
      FROM normalized
      GROUP BY stage, "failureClass", reason
      ORDER BY total DESC, "latestOccurredAt" DESC
      LIMIT $1
    `,
      [Math.max(1, Math.min(500, Math.trunc(limit)))],
    );
    return rows;
  }

  async listFailures(
    options: FailureListOptions = {},
  ): Promise<Page<FailureRecord>> {
    const limit = pageLimit(options.limit);
    const rows = await this.database.query<FailureRecord>(
      `
      SELECT ${FAILURE_COLUMNS}
      FROM failure_records AS f
      ${FAILURE_JOINS}
      WHERE (
          $1::jsonb IS NULL
          OR f.status::text IN (SELECT jsonb_array_elements_text($1::jsonb))
        )
        AND (
          $2::jsonb IS NULL
          OR f.failure_class::text IN (SELECT jsonb_array_elements_text($2::jsonb))
        )
        AND (
          $3::jsonb IS NULL
          OR f.stage IN (SELECT jsonb_array_elements_text($3::jsonb))
        )
        AND ($4::boolean IS NULL OR f.retryable = $4)
        AND ($5::text IS NULL OR sd.source_id = $5)
        AND ($6::text IS NULL OR sa.vdoc_key = $6)
        AND (
          $7::jsonb IS NULL
          OR sd.document_type IN (SELECT jsonb_array_elements_text($7::jsonb))
        )
        AND (
          $8::jsonb IS NULL
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text($8::jsonb) AS wanted(value)
            WHERE wanted.value = ANY (ARRAY[
              sd.supplier_id, sd.supplier_name,
              sd.payload->>'supplier', sd.payload->>'supplierId',
              sd.payload #>> '{supplier,id}', sd.payload #>> '{supplier,key}',
              sd.payload #>> '{supplier,name}',
              sd.provenance->>'supplier', sd.provenance->>'supplierId',
              sd.provenance #>> '{supplier,id}',
              sd.provenance #>> '{supplier,key}',
              sd.provenance #>> '{supplier,name}'
            ])
          )
        )
        AND ($9::timestamptz IS NULL OR sd.approved_at >= $9)
        AND ($10::timestamptz IS NULL OR sd.approved_at < $10)
        AND ($11::timestamptz IS NULL OR f.updated_at >= $11)
        AND ($12::timestamptz IS NULL OR f.updated_at < $12)
        AND ($13::timestamptz IS NULL OR f.occurred_at >= $13)
        AND ($14::timestamptz IS NULL OR f.occurred_at < $14)
        AND (
          $15::timestamptz IS NULL
          OR (f.created_at, f.id) < ($15::timestamptz, $16::bigint)
        )
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT $17
    `,
      [
        jsonArrayOrNull(options.statuses),
        jsonArrayOrNull(options.failureClasses),
        jsonArrayOrNull(options.stages),
        options.retryable ?? null,
        options.sourceDocumentId ?? null,
        options.vdocKey ?? null,
        jsonArrayOrNull(options.documentTypes),
        jsonArrayOrNull(options.suppliers),
        options.approvedAt?.from ?? null,
        options.approvedAt?.to ?? null,
        options.updatedAt?.from ?? null,
        options.updatedAt?.to ?? null,
        options.occurredAt?.from ?? null,
        options.occurredAt?.to ?? null,
        options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        limit + 1,
      ],
    );
    return page(rows, limit);
  }

  private async updateStatus(
    id: DbId,
    status: WorkflowStatus,
    result: JsonObject | null,
    claimOwner?: string,
  ): Promise<DeliveryRecord> {
    const rows = await this.database.query<DeliveryRecord>(
      `
      WITH updated AS (
        UPDATE deliveries
         SET status = $2,
            result = COALESCE($3::jsonb, result),
            started_at = CASE
              WHEN $2 = 'active' THEN COALESCE(started_at, now())
              ELSE started_at
            END,
            finished_at = CASE
              WHEN $2 IN (
                'review-required', 'approval-revoked',
                'completed', 'partial', 'failed'
              )
                THEN COALESCE(finished_at, now())
              ELSE finished_at
            END,
             submission_claim_owner = CASE WHEN $2 = 'active' THEN submission_claim_owner ELSE NULL END,
             submission_claimed_until = CASE WHEN $2 = 'active' THEN submission_claimed_until ELSE NULL END,
             updated_at = now()
         WHERE id = $1
           AND (status IN ('pending', 'active') OR status = $2)
           AND ($4::text IS NULL OR (
             status = 'active'
             AND submission_claim_owner = $4
             AND submission_claimed_until > now()
             AND NOT EXISTS (
               SELECT 1
               FROM source_documents AS claimed_source
               JOIN source_approval_revocations AS claimed_revocation
                 ON claimed_revocation.source_system = claimed_source.source_system
                AND claimed_revocation.source_id = claimed_source.source_id
                AND claimed_revocation.source_version = claimed_source.source_version
               WHERE claimed_source.id = deliveries.source_document_id
             )
           ))
          AND ($2 <> 'active' OR NOT EXISTS (
            SELECT 1
            FROM source_documents AS source
            JOIN source_approval_revocations AS revocation
              ON revocation.source_system = source.source_system
             AND revocation.source_id = source.source_id
             AND revocation.source_version = source.source_version
            WHERE source.id = deliveries.source_document_id
          ))
        RETURNING *
      )
      SELECT ${DELIVERY_COLUMNS}
      FROM updated AS d
      ${DELIVERY_JOINS}
    `,
      [id, status, result === null ? null : json(result), claimOwner ?? null],
    );
    return one(rows, `Delivery ${id} was not found`);
  }
}

export interface MigrationBatchInput {
  batchKey: string;
  source: string;
  provenance?: JsonObject;
}

export interface MigrationItemInput {
  migrationBatchId: DbId;
  itemKey: string;
  sourceVersion?: string | null;
  payload?: JsonObject;
}

export interface MigrationBatchListOptions {
  statuses?: readonly MigrationStatus[];
  source?: string;
  cursor?: PageCursor;
  limit?: number;
}

export interface MigrationItemListOptions {
  statuses?: readonly MigrationStatus[];
  cursor?: PageCursor;
  limit?: number;
}

export class MigrationRepository {
  constructor(private readonly database: QueryExecutor) {}

  async upsertBatch(
    input: MigrationBatchInput,
  ): Promise<MigrationBatchRecord> {
    return one(
      await this.database.query<MigrationBatchRecord>(
        `
      INSERT INTO migration_batches (batch_key, source, provenance)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (batch_key) DO UPDATE
      SET source = EXCLUDED.source,
          provenance = EXCLUDED.provenance,
          updated_at = now()
      RETURNING ${MIGRATION_BATCH_COLUMNS}
    `,
        [input.batchKey, input.source, json(input.provenance ?? {})],
      ),
      "Migration batch upsert returned no row",
    );
  }

  async checkpointBatch(
    id: DbId,
    status: MigrationStatus,
    checkpoint: JsonObject,
    totals: JsonObject,
    lastError: string | null = null,
  ): Promise<MigrationBatchRecord> {
    return one(
      await this.database.query<MigrationBatchRecord>(
        `
      UPDATE migration_batches
      SET status = $2, checkpoint = $3::jsonb, totals = $4::jsonb,
          last_error = $5,
          started_at = CASE
            WHEN $2 = 'running' THEN COALESCE(started_at, now())
            ELSE started_at
          END,
          finished_at = CASE
            WHEN $2 IN ('completed', 'partial', 'failed', 'skipped')
              THEN COALESCE(finished_at, now())
            ELSE finished_at
          END,
          updated_at = now()
      WHERE id = $1
      RETURNING ${MIGRATION_BATCH_COLUMNS}
    `,
        [id, status, json(checkpoint), json(totals), lastError],
      ),
      `Migration batch ${id} was not found`,
    );
  }

  async upsertItem(input: MigrationItemInput): Promise<MigrationItemRecord> {
    return one(
      await this.database.query<MigrationItemRecord>(
        `
      INSERT INTO migration_items (
        migration_batch_id, item_key, source_version, payload
      ) VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (migration_batch_id, item_key) DO UPDATE
      SET updated_at = migration_items.updated_at
      WHERE migration_items.source_version IS NOT DISTINCT FROM EXCLUDED.source_version
        AND migration_items.payload = EXCLUDED.payload
      RETURNING ${MIGRATION_ITEM_COLUMNS}
    `,
        [
          input.migrationBatchId,
          input.itemKey,
          input.sourceVersion ?? null,
          json(input.payload ?? {}),
        ],
      ),
      "Migration item upsert returned no row",
    );
  }

  async listBatches(
    options: MigrationBatchListOptions = {},
  ): Promise<Page<MigrationBatchRecord>> {
    const limit = pageLimit(options.limit);
    const rows = await this.database.query<MigrationBatchRecord>(
      `
      SELECT ${MIGRATION_BATCH_COLUMNS}
      FROM migration_batches
      WHERE (
          $1::jsonb IS NULL
          OR status::text IN (SELECT jsonb_array_elements_text($1::jsonb))
        )
        AND ($2::text IS NULL OR source = $2)
        AND (
          $3::timestamptz IS NULL
          OR (migration_batches.created_at, migration_batches.id) <
             ($3::timestamptz, $4::bigint)
        )
      ORDER BY migration_batches.created_at DESC, migration_batches.id DESC
      LIMIT $5
    `,
      [
        jsonArrayOrNull(options.statuses),
        options.source ?? null,
        options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        limit + 1,
      ],
    );
    return page(rows, limit);
  }

  async listItems(
    migrationBatchId: DbId,
    options: MigrationItemListOptions = {},
  ): Promise<Page<MigrationItemRecord>> {
    const limit = pageLimit(options.limit);
    const rows = await this.database.query<MigrationItemRecord>(
      `
      SELECT ${MIGRATION_ITEM_COLUMNS}
      FROM migration_items
      WHERE migration_batch_id = $1
        AND (
          $2::jsonb IS NULL
          OR status::text IN (SELECT jsonb_array_elements_text($2::jsonb))
        )
        AND (
          $3::timestamptz IS NULL
          OR (migration_items.created_at, migration_items.id) <
             ($3::timestamptz, $4::bigint)
        )
      ORDER BY migration_items.created_at DESC, migration_items.id DESC
      LIMIT $5
    `,
      [
        migrationBatchId,
        jsonArrayOrNull(options.statuses),
        options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        limit + 1,
      ],
    );
    return page(rows, limit);
  }

  async claimPendingItemsPage(
    migrationBatchId: DbId,
    limit = 100,
  ): Promise<MigrationItemRecord[]> {
    const checkedLimit = pageLimit(limit, 1_000);
    return await this.database.query<MigrationItemRecord>(
      `
      WITH candidates AS (
        SELECT id
        FROM migration_items
        WHERE migration_batch_id = $1 AND status = 'pending'
        ORDER BY item_key, id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      ), claimed AS (
        UPDATE migration_items AS item
        SET status = 'running',
            attempt_count = attempt_count + 1,
            started_at = COALESCE(started_at, now()),
            updated_at = now()
        FROM candidates
        WHERE item.id = candidates.id
        RETURNING item.*
      )
      SELECT ${MIGRATION_ITEM_COLUMNS}
      FROM claimed
      ORDER BY claimed.item_key, claimed.id
    `,
      [migrationBatchId, checkedLimit],
    );
  }

  async checkpointItem(
    id: DbId,
    status: MigrationStatus,
    checkpoint: JsonObject,
    result: JsonObject | null = null,
    lastError: string | null = null,
    incrementAttempt = false,
  ): Promise<MigrationItemRecord> {
    return one(
      await this.database.query<MigrationItemRecord>(
        `
      UPDATE migration_items
      SET status = $2, checkpoint = $3::jsonb, result = $4::jsonb,
          last_error = $5,
          attempt_count = attempt_count + CASE WHEN $6 THEN 1 ELSE 0 END,
          started_at = CASE
            WHEN $2 = 'running' THEN COALESCE(started_at, now())
            ELSE started_at
          END,
          finished_at = CASE
            WHEN $2 IN ('completed', 'partial', 'failed', 'skipped')
              THEN COALESCE(finished_at, now())
            ELSE finished_at
          END,
          updated_at = now()
      WHERE id = $1
      RETURNING ${MIGRATION_ITEM_COLUMNS}
    `,
        [
          id,
          status,
          json(checkpoint),
          result === null ? null : json(result),
          lastError,
          incrementAttempt,
        ],
      ),
      `Migration item ${id} was not found`,
    );
  }
}

export interface ReportRunInput {
  reportType: string;
  requestedBy?: string | null;
  parameters?: JsonObject;
}

export interface ReportListOptions {
  statuses?: readonly ReportStatus[];
  reportTypes?: readonly string[];
  requestedBy?: string;
  requestedAt?: DateRange;
  cursor?: PageCursor;
  limit?: number;
}

export class ReportRepository {
  constructor(private readonly database: QueryExecutor) {}

  async create(input: ReportRunInput): Promise<ReportRunRecord> {
    return one(
      await this.database.query<ReportRunRecord>(
        `
      INSERT INTO report_runs (report_type, requested_by, parameters)
      VALUES ($1, $2, $3::jsonb)
      RETURNING ${REPORT_RUN_COLUMNS}
    `,
        [
          input.reportType,
          input.requestedBy ?? null,
          json(input.parameters ?? {}),
        ],
      ),
      "Report run create returned no row",
    );
  }

  async get(id: DbId): Promise<ReportRunRecord | null> {
    const rows = await this.database.query<ReportRunRecord>(
      `
      SELECT ${REPORT_RUN_COLUMNS}
      FROM report_runs
      WHERE id = $1
    `,
      [id],
    );
    return rows[0] ?? null;
  }

  async list(
    options: ReportListOptions = {},
  ): Promise<Page<ReportRunRecord>> {
    const limit = pageLimit(options.limit);
    const rows = await this.database.query<ReportRunRecord>(
      `
      SELECT ${REPORT_RUN_COLUMNS}
      FROM report_runs
      WHERE (
          $1::jsonb IS NULL
          OR status::text IN (SELECT jsonb_array_elements_text($1::jsonb))
        )
        AND (
          $2::jsonb IS NULL
          OR report_type IN (SELECT jsonb_array_elements_text($2::jsonb))
        )
        AND ($3::text IS NULL OR requested_by = $3)
        AND ($4::timestamptz IS NULL OR created_at >= $4)
        AND ($5::timestamptz IS NULL OR created_at < $5)
        AND (
          $6::timestamptz IS NULL
          OR (report_runs.created_at, report_runs.id) <
             ($6::timestamptz, $7::bigint)
        )
      ORDER BY report_runs.created_at DESC, report_runs.id DESC
      LIMIT $8
    `,
      [
        jsonArrayOrNull(options.statuses),
        jsonArrayOrNull(options.reportTypes),
        options.requestedBy ?? null,
        options.requestedAt?.from ?? null,
        options.requestedAt?.to ?? null,
        options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        limit + 1,
      ],
    );
    return page(rows, limit);
  }

  async finish(
    id: DbId,
    status: Extract<ReportStatus, "completed" | "failed">,
    result: JsonObject | readonly unknown[] | null,
    error: string | null = null,
  ): Promise<ReportRunRecord> {
    return one(
      await this.database.query<ReportRunRecord>(
        `
      UPDATE report_runs
      SET status = $2, result = $3::jsonb, error = $4,
          started_at = COALESCE(started_at, created_at),
          finished_at = COALESCE(finished_at, now()), updated_at = now()
      WHERE id = $1
      RETURNING ${REPORT_RUN_COLUMNS}
    `,
        [id, status, result === null ? null : json(result), error],
      ),
      `Report run ${id} was not found`,
    );
  }
}

export interface Repositories {
  health: HealthRepository;
  inbox: InboxRepository;
  sources: SourceRepository;
  directories: DirectoryRepository;
  syncRequests: SyncRepository;
  deliveries: DeliveryRepository;
  migrations: MigrationRepository;
  reports: ReportRepository;
}

export function createRepositories(database: QueryExecutor): Repositories {
  return {
    health: new HealthRepository(database),
    inbox: new InboxRepository(database),
    sources: new SourceRepository(database),
    directories: new DirectoryRepository(database),
    syncRequests: new SyncRepository(database),
    deliveries: new DeliveryRepository(database),
    migrations: new MigrationRepository(database),
    reports: new ReportRepository(database),
  };
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Value is not JSON serializable");
  }
  return serialized;
}

function sourceDocumentRecord(
  row: typeof sourceDocuments.$inferSelect,
): SourceDocumentRecord {
  return {
    id: String(row.id),
    sourceSystem: row.sourceSystem,
    sourceId: row.sourceId,
    sourceVersion: row.sourceVersion,
    readinessHash: row.readinessHash,
    documentType: row.documentType,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    status: row.status,
    payload: row.payload as JsonObject,
    provenance: row.provenance as JsonObject,
    approvedAt: row.approvedAt,
    sourceCreatedAt: row.sourceCreatedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sourceAttachmentRecord(
  row: typeof sourceAttachments.$inferSelect,
): SourceAttachmentRecord {
  return {
    id: String(row.id),
    sourceDocumentId: String(row.sourceDocumentId),
    sourceSystem: row.sourceSystem,
    sourceId: row.sourceId,
    sourceVersion: row.sourceVersion,
    vdocKey: row.vdocKey,
    byteReference: row.byteReference,
    contentType: row.contentType,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes === null ? null : String(row.sizeBytes),
    checksum: row.checksum,
    payload: row.payload as JsonObject,
    provenance: row.provenance as JsonObject,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mutableJson(value: JsonObject): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

function jsonArrayOrNull(
  values: readonly unknown[] | undefined,
): string | null {
  return values && values.length > 0 ? json(values) : null;
}

function aggregateDeliveryStatus(
  deliveries: readonly DeliveryRecord[],
): WorkflowStatus {
  const first = deliveries[0];
  if (!first) throw new Error("Cannot aggregate an empty delivery list");
  const statuses = new Set(deliveries.map((delivery) => delivery.status));
  if (statuses.size === 1) return first.status;
  if (statuses.has("approval-revoked")) return "approval-revoked";
  if (statuses.has("review-required")) return "review-required";
  if (statuses.has("active")) return "active";
  if (statuses.has("pending")) return "pending";
  if (statuses.has("partial")) return "partial";
  if (statuses.has("completed") && statuses.has("failed")) return "partial";
  if (statuses.has("failed")) return "failed";
  return "completed";
}

function latestDate(
  values: readonly (Date | string | null | undefined)[],
): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    const date = value instanceof Date
      ? value
      : typeof value === "string"
      ? new Date(value)
      : null;
    if (
      date && !Number.isNaN(date.getTime()) &&
      (!latest || date.getTime() > latest.getTime())
    ) {
      latest = date;
    }
  }
  return latest;
}

function one<T>(rows: readonly T[], message: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(message);
  return row;
}

function positiveInteger(
  value: number,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(
      `${name} must be a positive integer not exceeding ${maximum}`,
    );
  }
}

function pageLimit(value = 100, maximum = 250): number {
  positiveInteger(value, "limit");
  if (value > maximum) throw new RangeError(`limit must not exceed ${maximum}`);
  return value;
}

function page<T extends { id: DbId; createdAt: Date }>(
  rows: readonly T[],
  limit: number,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = rows.length > limit ? items.at(-1) : undefined;
  return {
    items,
    nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}
