import { loadConfig } from "../config.ts";
import { connectPostgres } from "../db/mod.ts";

type Row = { keepId: string; duplicateIds: string[] };

const apply = Deno.args.includes("--apply");
const db = connectPostgres(loadConfig().databaseUrl, { max: 1 });
try {
  const rows = await db.query<Row>(
    `
    WITH grouped AS (
      SELECT min(d.id)::text AS "keepId",
             (array_agg(d.id::text ORDER BY d.id))[2:] AS "duplicateIds"
      FROM deliveries AS d
      JOIN source_attachments AS sa ON sa.id = d.source_attachment_id
      LEFT JOIN entry_mappings AS em ON em.delivery_id = d.id
      LEFT JOIN delivery_attempts AS da ON da.delivery_id = d.id
      WHERE d.status = 'active'
        AND d.cws_entry_id IS NULL
        AND em.id IS NULL
      GROUP BY d.source_attachment_id, d.target_path, d.target_name, COALESCE(d.content_sha256, sa.checksum, 'missing')
      HAVING count(*) > 1 AND count(da.id) = 0
    )
    SELECT "keepId", "duplicateIds"
    FROM grouped
    ORDER BY "keepId"::bigint
  `,
  );
  let groups = 0;
  let deleted = 0;
  for (const row of rows) {
    groups += 1;
    deleted += row.duplicateIds.length;
    console.log(JSON.stringify({
      event: apply ? "deleted-duplicate-active-deliveries" : "would-delete-duplicate-active-deliveries",
      keepId: row.keepId,
      duplicateIds: row.duplicateIds,
    }));
    if (!apply) continue;
    await db.execute(`DELETE FROM deliveries WHERE id IN (${row.duplicateIds.map((id) => BigInt(id).toString()).join(",")})`);
  }
  console.log(JSON.stringify({ event: "complete", apply, groups, deleted }));
} finally {
  await db.close();
}
