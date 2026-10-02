import { loadConfig } from "../config.ts";
import { connectPostgres } from "../db/mod.ts";
import { sourceFilingWorkflow } from "../domain/source_metadata.ts";

type Row = {
  id: string;
  sourceId: string;
  sourcePayload: Record<string, unknown>;
  attachmentPayload: Record<string, unknown> | null;
  vdocKey: string;
  checksum: string | null;
  fileName: string;
  targetName: string;
};

const apply = Deno.args.includes("--apply");
const status = stringArg("--status", "active");
const limit = limitArg("--limit", 100);

const db = connectPostgres(loadConfig().databaseUrl, { max: 1 });
try {
  const rows = await db.query<Row>(
    `
    SELECT d.id::text AS id,
           sd.source_id AS "sourceId",
           sd.payload AS "sourcePayload",
           sa.payload AS "attachmentPayload",
           sa.vdoc_key AS "vdocKey",
           sa.checksum,
           sa.file_name AS "fileName",
           d.target_name AS "targetName"
    FROM deliveries AS d
    JOIN source_documents AS sd ON sd.id = d.source_document_id
    JOIN source_attachments AS sa ON sa.id = d.source_attachment_id
    WHERE d.status::text = $1
    ORDER BY d.id
    LIMIT $2
  `,
    [status, Number.isFinite(limit) ? limit : 2147483647],
  );
  let changed = 0;
  for (const row of rows) {
    const filing = sourceFilingWorkflow(row.sourcePayload, {
      ...(row.attachmentPayload ?? {}),
      fileName: row.fileName,
    }, { sourceDocumentId: row.sourceId, sourceAttachmentKey: attachmentKey(row.checksum, row.vdocKey) });
    if (filing.targetName === row.targetName) continue;
    changed += 1;
    console.log(JSON.stringify({
      event: apply ? "retargeted" : "would-retarget",
      deliveryId: row.id,
      oldTargetName: row.targetName,
      newTargetName: filing.targetName,
    }));
    if (!apply) continue;
    await db.execute(
      `
      UPDATE deliveries
      SET target_name = $2,
          provenance = provenance || $3::jsonb,
          updated_at = now()
      WHERE id = $1
    `,
      [row.id, filing.targetName, JSON.stringify({ targetNameRepairedAt: new Date().toISOString() })],
    );
  }
  console.log(JSON.stringify({ event: "complete", apply, inspected: rows.length, changed }));
} finally {
  await db.close();
}

function attachmentKey(checksum: string | null, fallback: string): string {
  return checksum && checksum.length >= 12 ? checksum.slice(0, 12) : fallback.slice(0, 24);
}

function stringArg(name: string, fallback: string): string {
  const index = Deno.args.indexOf(name);
  const value = index >= 0 ? Deno.args[index + 1] : undefined;
  return value ? value : fallback;
}

function limitArg(name: string, fallback: number): number {
  const value = stringArg(name, String(fallback));
  if (value === "all" || value === "unlimited") return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer or 'all'`);
  return parsed;
}
