import { loadConfig } from "../config.ts";
import { connectPostgres } from "../db/mod.ts";
import { sourceFilingWorkflow } from "../domain/source_metadata.ts";

type Row = {
  cwsEntryId: string;
  deliveryId: string;
  sourceId: string;
  sourcePayload: Record<string, unknown>;
  attachmentPayload: Record<string, unknown> | null;
  vdocKey: string;
  checksum: string | null;
  fileName: string;
  targetName: string;
  hash: string;
  result: Record<string, unknown> | null;
  mappingProvenance: Record<string, unknown> | null;
};

const apply = Deno.args.includes("--apply");
const db = connectPostgres(loadConfig().databaseUrl, { max: 1 });
try {
  const rows = await db.query<Row>(
    `
    WITH bad_groups AS (
      SELECT d.cws_entry_id
      FROM deliveries AS d
      JOIN source_attachments AS sa ON sa.id = d.source_attachment_id
      WHERE d.status = 'completed'
        AND d.cws_entry_id IS NOT NULL
      GROUP BY d.cws_entry_id
      HAVING count(DISTINCT COALESCE(d.content_sha256, sa.checksum, 'missing')) > 1
    )
    SELECT d.cws_entry_id::text AS "cwsEntryId",
           d.id::text AS "deliveryId",
           sd.source_id AS "sourceId",
           sd.payload AS "sourcePayload",
           sa.payload AS "attachmentPayload",
           sa.vdoc_key AS "vdocKey",
           sa.checksum,
           sa.file_name AS "fileName",
           d.target_name AS "targetName",
           COALESCE(d.content_sha256, sa.checksum, 'missing') AS hash,
           d.result,
           em.provenance AS "mappingProvenance"
    FROM deliveries AS d
    JOIN bad_groups AS bg ON bg.cws_entry_id = d.cws_entry_id
    JOIN source_documents AS sd ON sd.id = d.source_document_id
    JOIN source_attachments AS sa ON sa.id = d.source_attachment_id
    LEFT JOIN entry_mappings AS em ON em.delivery_id = d.id
    WHERE d.status = 'completed'
    ORDER BY d.cws_entry_id, d.id
  `,
  );
  const grouped = Map.groupBy(rows, (row) => row.cwsEntryId);
  let groups = 0;
  let reopened = 0;
  let kept = 0;
  for (const [cwsEntryId, group] of grouped) {
    groups += 1;
    const authoritative = group.find((row) => Boolean(row.result?.reconciledFromExistingLaserfiche))
      ?? group.find((row) => Boolean(row.mappingProvenance?.reconciledFromExistingLaserfiche));
    if (!authoritative) {
      console.log(JSON.stringify({ event: "skip", category: "no-authoritative-reconciled-row", cwsEntryId }));
      continue;
    }
    for (const row of group) {
      if (row.hash === authoritative.hash) {
        kept += 1;
        console.log(JSON.stringify({ event: "keep", cwsEntryId, deliveryId: row.deliveryId, hash: row.hash }));
        continue;
      }
      const filing = sourceFilingWorkflow(row.sourcePayload, {
        ...(row.attachmentPayload ?? {}),
        fileName: row.fileName,
      }, { sourceDocumentId: row.sourceId, sourceAttachmentKey: attachmentKey(row.checksum, row.vdocKey) });
      reopened += 1;
      console.log(JSON.stringify({
        event: apply ? "reopened" : "would-reopen",
        cwsEntryId,
        deliveryId: row.deliveryId,
        oldTargetName: row.targetName,
        newTargetName: filing.targetName,
        authoritativeDeliveryId: authoritative.deliveryId,
        authoritativeHash: authoritative.hash,
        rowHash: row.hash,
      }));
      if (!apply) continue;
      await db.transaction(async (tx) => {
        await tx.execute(`DELETE FROM entry_mappings WHERE delivery_id = $1`, [row.deliveryId]);
        await tx.execute(
          `
          UPDATE deliveries
          SET status = 'active',
              target_name = $2,
              cws_entry_id = NULL,
              result = $3::jsonb,
              finished_at = NULL,
              next_attempt_at = NULL,
              last_retry_reason = NULL,
              provenance = provenance || $4::jsonb,
              updated_at = now()
          WHERE id = $1
        `,
          [
            row.deliveryId,
            filing.targetName,
            JSON.stringify({ reopenedFromAmbiguousReconciliation: true, previousCwsEntryId: cwsEntryId }),
            JSON.stringify({
              ambiguousReconciliationReopenedAt: new Date().toISOString(),
              previousCwsEntryId: cwsEntryId,
              authoritativeDeliveryId: authoritative.deliveryId,
              authoritativeHash: authoritative.hash,
              rowHash: row.hash,
            }),
          ],
        );
      });
    }
  }
  console.log(JSON.stringify({ event: "complete", apply, groups, kept, reopened }));
} finally {
  await db.close();
}

function attachmentKey(checksum: string | null, fallback: string): string {
  return checksum && checksum.length >= 12 ? checksum.slice(0, 12) : fallback.slice(0, 24);
}
