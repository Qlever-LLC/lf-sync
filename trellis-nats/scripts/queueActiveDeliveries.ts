import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { loadConfig } from "../config.ts";
import contract from "../contracts/lf_sync.ts";
import { connectPostgres } from "../db/mod.ts";

const apply = Deno.args.includes("--apply");
const limitArg = Deno.args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 25;
const documentTypeIds = Deno.args
  .filter((arg) => arg.startsWith("--document-type-id="))
  .map((arg) => arg.slice("--document-type-id=".length).trim())
  .filter(Boolean);
if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
  throw new Error("--limit must be an integer from 1 to 500");
}

const config = loadConfig();
if (apply && !config.sessionKeySeed) {
  throw new Error("TRELLIS_SESSION_KEY_SEED is required to queue jobs");
}

const db = connectPostgres(config.databaseUrl, { max: 1 });
let service: any | undefined;
try {
  const rows = await db.query<{
    id: string;
    sourceDocumentId: string;
    vdocKey: string;
  }>(
    `
    SELECT d.id::text AS id,
           d.source_document_id::text AS "sourceDocumentId",
           sa.vdoc_key AS "vdocKey"
    FROM deliveries AS d
    JOIN source_attachments AS sa ON sa.id = d.source_attachment_id
    JOIN source_documents AS sd ON sd.id = d.source_document_id
    WHERE d.status = 'active'
      AND d.cws_entry_id IS NULL
      ${documentTypeIds.length > 0 ? `AND sd.document_type IN (${documentTypeIds.map((id) => `'${id.replaceAll("'", "''")}'`).join(",")})` : ""}
    ORDER BY d.id
    LIMIT $1
  `,
    [limit],
  );

  if (apply) {
    service = await TrellisService.connect({
      trellisUrl: config.trellisUrl,
      contract,
      name: config.serviceName,
      sessionKeySeed: config.sessionKeySeed!,
    }).orThrow();
  }

  for (const row of rows) {
    console.log(JSON.stringify({ event: apply ? "queued" : "would-queue", deliveryId: row.id }));
    if (!apply) continue;
    await service!.jobs.submitLaserfiche.create({
      correlationId: `operator-active:${row.id}:${Date.now()}`,
      sourceDocumentId: Number(row.sourceDocumentId),
      deliveryId: Number(row.id),
      vdocKey: row.vdocKey,
      idempotencyKey: `submit:operator-active:${row.id}:${Date.now()}`,
    }).orThrow();
  }
  console.log(JSON.stringify({ event: "complete", apply, queued: rows.length }));
} finally {
  await db.close();
  setTimeout(() => Deno.exit(0), 100);
}
