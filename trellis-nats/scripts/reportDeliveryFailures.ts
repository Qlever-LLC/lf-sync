import { loadConfig } from "../config.ts";
import { connectPostgres } from "../db/mod.ts";

type ReportRow = Record<string, unknown>;

const format = Deno.args.includes("--csv") ? "csv" : "json";
const staleMinutes = numberArg("--stale-minutes", 30);

const config = loadConfig();
const database = connectPostgres(config.databaseUrl);

try {
  const rows = await database.query<ReportRow>(
    `
    WITH latest_open_failure AS (
      SELECT DISTINCT ON (delivery_id)
        delivery_id,
        stage,
        reason,
        retryable,
        context,
        created_at
      FROM failure_records
      WHERE status = 'open'
      ORDER BY delivery_id, created_at DESC, id DESC
    )
    SELECT
      CASE
        WHEN d.status = 'active' AND d.updated_at < now() - ($1::integer * interval '1 minute') THEN 'active-stale'
        WHEN d.status = 'failed' AND COALESCE(f.retryable, false) = true AND d.retry_count >= d.max_attempts THEN 'retry-exhausted'
        WHEN d.status = 'failed' AND COALESCE(f.retryable, false) = true AND d.next_attempt_at <= now() THEN 'retry-ready'
        WHEN d.status = 'failed' AND COALESCE(f.retryable, false) = true THEN 'retry-pending'
        WHEN d.status IN ('failed', 'review-required') THEN 'non-retryable'
        ELSE 'other'
      END AS category,
      d.id::text AS delivery_id,
      d.status,
      d.retry_count,
      d.max_attempts,
      d.next_attempt_at,
      d.last_retry_reason,
      d.repository,
      d.target_path,
      d.target_name,
      d.cws_entry_id::text AS cws_entry_id,
      sd.source_id AS source_document_id,
      sd.source_version,
      sd.document_type,
      COALESCE(
        NULLIF(sd.payload #>> '{supplier,name}', ''),
        NULLIF(sd.provenance #>> '{supplier,name}', ''),
        NULLIF(sd.payload->>'supplier', ''),
        NULLIF(sd.provenance->>'supplier', '')
      ) AS supplier,
      f.stage AS failure_stage,
      f.reason AS failure_reason,
      f.retryable AS failure_retryable,
      f.context->'queue' AS queue_snapshot,
      f.created_at AS failure_created_at,
      d.created_at AS delivery_created_at,
      d.updated_at AS delivery_updated_at
    FROM deliveries AS d
    JOIN source_documents AS sd ON sd.id = d.source_document_id
    LEFT JOIN latest_open_failure AS f ON f.delivery_id = d.id
    WHERE d.status IN ('active', 'failed', 'review-required')
    ORDER BY category, d.next_attempt_at NULLS LAST, d.id
  `,
    [staleMinutes],
  );

  if (format === "csv") {
    printCsv(rows);
  } else {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), staleMinutes, rows }, null, 2));
  }
} finally {
  await database.close();
}

function numberArg(name: string, fallback: number): number {
  const index = Deno.args.indexOf(name);
  if (index < 0) return fallback;
  const value = Deno.args[index + 1];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printCsv(rows: ReportRow[]): void {
  const headers = [
    "category",
    "delivery_id",
    "status",
    "retry_count",
    "max_attempts",
    "next_attempt_at",
    "last_retry_reason",
    "repository",
    "target_path",
    "target_name",
    "cws_entry_id",
    "source_document_id",
    "source_version",
    "document_type",
    "supplier",
    "failure_stage",
    "failure_reason",
    "failure_retryable",
    "failure_created_at",
    "delivery_created_at",
    "delivery_updated_at",
  ];
  console.log(headers.join(","));
  for (const row of rows) {
    console.log(headers.map((header) => csv(row[header])).join(","));
  }
}

function csv(value: unknown): string {
  const text = value instanceof Date
    ? value.toISOString()
    : value == null
    ? ""
    : typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
