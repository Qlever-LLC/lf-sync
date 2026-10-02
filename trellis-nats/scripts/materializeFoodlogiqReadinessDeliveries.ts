import postgres from "npm:postgres@3.4.7";
import { loadConfig } from "../config.ts";
import { connectPostgres } from "../db/mod.ts";
import { createRepositories } from "../db/repositories.ts";
import { prepareDelivery } from "../runtime/delivery_workflow.ts";
import type { DatabaseRow } from "../db/database.ts";
import type { JsonObject } from "../db/types.ts";

const SOURCE_SYSTEM = "foodlogiq";
const config = loadConfig();
const repository = stringArg("--repository", config.cwsRepo ?? "");
if (!repository) throw new Error("CWS_REPO or --repository is required");
const documentType = stringArg("--document-type", "");
const limit = limitArg("--limit", 100);
const apply = Deno.args.includes("--apply");
const skipExistingSource = Deno.args.includes("--skip-existing-source");
const foodlogiqDatabaseUrl = Deno.env.get("FOODLOGIQ_DATABASE_URL");
if (!foodlogiqDatabaseUrl) throw new Error("FOODLOGIQ_DATABASE_URL is required");

const lf = connectPostgres(config.databaseUrl, { max: 2 });
const fl = postgres(foodlogiqDatabaseUrl, { max: 2, idle_timeout: 20, connect_timeout: 10 });

try {
  const rows = await readinessRows(fl, { documentType, limit });
  let inspected = 0;
  let materialized = 0;
  let skipped = 0;
  for (const row of rows) {
    inspected += 1;
    if (inspected === 1 || inspected % 100 === 0) {
      console.log(JSON.stringify({ event: "progress", inspected, total: rows.length, apply }));
    }
    const event = readinessEvent(row);
    if (!event) {
      skipped += 1;
      console.log(JSON.stringify({ event: "skip", reason: "not-ready", sourceDocumentId: row.sourceDocumentId }));
      continue;
    }
    if (!apply) {
      materialized += 1;
      console.log(JSON.stringify({
        event: "would-materialize",
        sourceDocumentId: event.sourceDocumentId,
        sourceVersionId: event.sourceVersionId,
        attachmentCount: event.attachments.length,
      }));
      continue;
    }
    if (skipExistingSource) {
      const existing = await lf.query(
        `SELECT id FROM source_documents WHERE source_system = $1 AND source_id = $2 AND source_version = $3 LIMIT 1`,
        [SOURCE_SYSTEM, event.sourceDocumentId, event.sourceVersionId],
      );
      if (existing.length > 0) {
        skipped += 1;
        continue;
      }
    }
    try {
      await lf.transaction(async (tx) => {
        const repositories = createRepositories(tx);
        const source = await repositories.sources.upsertCanonicalSource({
          sourceSystem: SOURCE_SYSTEM,
          sourceId: event.sourceDocumentId,
          sourceVersion: event.sourceVersionId,
          readinessHash: event.archiveReadiness.readinessHash,
          documentType: event.documentTypeKey,
          supplierId: event.filing.supplier.id,
          supplierName: event.filing.supplier.name,
          status: "ready",
          payload: event as unknown as JsonObject,
          provenance: { materializedFrom: "foodlogiq_readiness_publications" },
          approvedAt: new Date(event.approval.changedAt),
          sourceUpdatedAt: new Date(event.occurredAt),
        });
        const retainedAttachments = [];
        for (const attachment of event.attachments) {
          retainedAttachments.push(await repositories.sources.upsertAttachment({
            sourceSystem: SOURCE_SYSTEM,
            sourceId: event.sourceDocumentId,
            sourceVersion: event.sourceVersionId,
            vdocKey: attachment.attachmentId,
            byteReference: attachment.attachmentId,
            contentType: attachment.contentType ?? "application/octet-stream",
            fileName: attachment.fileName,
            sizeBytes: attachment.byteLength === undefined ? null : String(attachment.byteLength),
            checksum: attachment.sha256,
            payload: attachment as unknown as JsonObject,
            provenance: { materializedFrom: "foodlogiq_document_attachments" },
          }));
        }
        const request = await repositories.syncRequests.createRequest({
          sourceDocumentId: source.id,
          requestKey: `materialized-readiness:${event.sourceDocumentId}:${event.sourceVersionId}:${event.archiveReadiness.readinessHash}`,
          requestedBy: "foodlogiq-materializer",
          reason: "reconcile-existing-laserfiche",
          provenance: { materializedFrom: "foodlogiq_readiness_publications" },
        });
        let preparedDeliveries = 0;
        for (const attachment of retainedAttachments) {
          await prepareDelivery({
            repositories,
            source,
            attachment,
            syncRequestId: request.id,
            repository,
            idempotencyKey: `materialized:${event.sourceDocumentId}:${event.sourceVersionId}:${attachment.vdocKey}`,
          });
          preparedDeliveries += 1;
        }
        if (preparedDeliveries === 0) throw new Error(`No deliveries prepared for ${event.sourceDocumentId}`);
        await repositories.syncRequests.markActive(request.id);
      });
      materialized += 1;
    } catch (error) {
      skipped += 1;
      console.log(JSON.stringify({
        event: "materialize-failed",
        sourceDocumentId: event.sourceDocumentId,
        sourceVersionId: event.sourceVersionId,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  console.log(JSON.stringify({ event: "complete", apply, inspected, materialized, skipped }));
} finally {
  await fl.end({ timeout: 5 });
  await lf.close();
}

type ReadinessRow = DatabaseRow & {
  sourceDocumentId: string;
  sourceVersionId: string;
  readinessHash: string;
  approvalConfirmationId: string;
  publishedAt: string;
  foodlogiqDocumentId: string;
  documentTypeKey: string;
  foodlogiqTypeName: string;
  foodlogiqBusinessId: string | null;
  supplierName: string | null;
  supplierAddressText: string | null;
  documentName: string | null;
  approvalStatus: string | null;
  submittedAt: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  updatedAt: string;
  rawSource: JsonObject | null;
  versionChangedAt: string | null;
  versionStatusSetAt: string | null;
  versionStatusSetById: string | null;
  attachments: Array<{
    id: string;
    fileName: string | null;
    contentType: string | null;
    byteLength: number | null;
    sha256: string | null;
    storeKey: string | null;
  }>;
};

async function readinessRows(sql: postgres.Sql, options: { documentType: string; limit: number }): Promise<ReadinessRow[]> {
  const limitClause = Number.isFinite(options.limit) ? sql`limit ${options.limit}` : sql``;
  const typeClause = options.documentType ? sql`and d.foodlogiq_type_name = ${options.documentType}` : sql``;
  const rows = await sql<ReadinessRow[]>`
    select rp.source_document_id as "sourceDocumentId",
           rp.source_version_id as "sourceVersionId",
           rp.readiness_hash as "readinessHash",
           rp.approval_confirmation_id as "approvalConfirmationId",
           rp.published_at::text as "publishedAt",
           d.foodlogiq_document_id as "foodlogiqDocumentId",
           d.document_type_key as "documentTypeKey",
           d.foodlogiq_type_name as "foodlogiqTypeName",
           d.foodlogiq_business_id as "foodlogiqBusinessId",
           d.supplier_name as "supplierName",
           d.supplier_address_text as "supplierAddressText",
           d.document_name as "documentName",
           d.approval_status as "approvalStatus",
           d.submitted_at::text as "submittedAt",
           d.effective_date::text as "effectiveDate",
           d.expiration_date::text as "expirationDate",
           d.updated_at::text as "updatedAt",
           d.raw_source as "rawSource",
           v.changed_at::text as "versionChangedAt",
           v.status_set_at::text as "versionStatusSetAt",
           v.status_set_by_id as "versionStatusSetById",
           coalesce(json_agg(json_build_object(
             'id', a.id,
             'fileName', a.file_name,
             'contentType', a.content_type,
             'byteLength', a.byte_length,
             'sha256', a.sha256,
             'storeKey', a.store_key
           ) order by a.file_name nulls last, a.attachment_key) filter (where a.id is not null), '[]'::json) as attachments
    from foodlogiq_readiness_publications rp
    join foodlogiq_documents d on d.foodlogiq_document_id = rp.source_document_id or d.id = rp.source_document_id
    left join foodlogiq_document_versions v
      on v.document_id = d.id
     and (v.foodlogiq_version_id = rp.source_version_id or v.foodlogiq_document_id = rp.source_version_id)
    left join foodlogiq_document_attachments a on a.document_id = d.id and a.document_version_id = v.id
    where d.archived = false
      and d.share_source_deleted = false
      ${typeClause}
    group by rp.source_document_id, rp.source_version_id, rp.readiness_hash, rp.approval_confirmation_id, rp.published_at,
             d.foodlogiq_document_id, d.document_type_key, d.foodlogiq_type_name, d.foodlogiq_business_id, d.supplier_name,
             d.supplier_address_text, d.document_name, d.approval_status, d.submitted_at, d.effective_date,
             d.expiration_date, d.updated_at, d.raw_source, v.changed_at, v.status_set_at, v.status_set_by_id
    order by rp.published_at desc, rp.source_document_id
    ${limitClause}
  `;
  return rows;
}

function readinessEvent(row: ReadinessRow) {
  if (row.approvalStatus !== "Approved") return null;
  if (!row.foodlogiqBusinessId || !row.supplierName || !row.foodlogiqTypeName) return null;
  const attachments = row.attachments.filter((attachment: ReadinessRow["attachments"][number]) =>
    attachment.id && attachment.fileName && attachment.sha256 && attachment.storeKey
  ).map((attachment: ReadinessRow["attachments"][number]) => ({
    attachmentId: attachment.id,
    fileName: attachment.fileName!,
    sha256: attachment.sha256!,
    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
    ...(attachment.byteLength === null ? {} : { byteLength: attachment.byteLength }),
  }));
  if (attachments.length === 0) return null;
  const approvalChangedAt = isoDateTime(row.versionStatusSetAt ?? row.versionChangedAt ?? row.submittedAt ?? row.updatedAt);
  const rawSource = row.rawSource as Record<string, unknown> | null;
  return {
    sourceDocumentId: row.sourceDocumentId,
    sourceVersionId: row.sourceVersionId,
    documentTypeKey: row.documentTypeKey,
    approval: { state: "approved", changedAt: approvalChangedAt },
    archiveReadiness: {
      state: "ready",
      readinessHash: row.readinessHash,
      approvalConfirmationId: row.approvalConfirmationId,
      writebackConfirmedAt: approvalChangedAt,
    },
    tradingPartnerSource: {
      origin: "foodlogiq",
      sourceType: "business",
      sourceId: row.foodlogiqBusinessId,
    },
    filing: {
      supplier: {
        id: row.foodlogiqBusinessId,
        name: row.supplierName,
        ...(row.supplierAddressText ? { addressText: row.supplierAddressText } : {}),
      },
      document: {
        ...(row.documentName ? { documentName: row.documentName } : {}),
        documentTypeName: row.foodlogiqTypeName,
        documentDate: isoDate(row.effectiveDate) ?? isoDateTime(row.submittedAt) ?? approvalChangedAt,
        ...(row.expirationDate ? { expirationDate: isoDate(row.expirationDate) ?? row.expirationDate } : {}),
        ...optionalArray("products", namesFromValue(rawSource?.products)),
        ...optionalArray("locations", namesFromValue(rawSource?.locations)),
        ...optionalString("ticketSystem", stringValue(rawSource?.ticketSystem)),
        ...optionalString("ticketId", stringValue(rawSource?.ticketId)),
      },
    },
    attachments,
    occurredAt: new Date().toISOString(),
  };
}

function namesFromValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [entry];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const name = (entry as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim()) return [name];
    }
    return [];
  });
  return values.length === 0 ? undefined : values;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalArray(name: "products" | "locations", value: string[] | undefined): Record<string, string[]> {
  return value && value.length > 0 ? { [name]: value } : {};
}

function optionalString(name: "ticketSystem" | "ticketId", value: string | undefined): Record<string, string> {
  return value ? { [name]: value } : {};
}

function isoDateTime(value: string | null | undefined): string {
  if (!value) throw new Error("A FoodLogiQ readiness timestamp is required");
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid FoodLogiQ timestamp: ${value}`);
  return parsed.toISOString();
}

function isoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (match) return match[1];
  return isoDateTime(value).slice(0, 10);
}

function stringArg(name: string, fallback: string): string {
  const index = Deno.args.indexOf(name);
  return index === -1 ? fallback : Deno.args[index + 1] ?? fallback;
}

function limitArg(name: string, fallback: number): number {
  const value = stringArg(name, String(fallback));
  if (value === "all" || value === "unlimited") return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer or 'all'`);
  return parsed;
}
