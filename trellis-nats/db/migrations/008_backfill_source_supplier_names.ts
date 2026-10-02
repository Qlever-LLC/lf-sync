export const sourceSupplierNameBackfillMigration = {
  name: "backfill_source_supplier_names",
  sql: `
WITH extracted AS (
  SELECT
    d.source_document_id,
    (regexp_match(d.target_path, '^/FSQA/trellis/trading-partners/([^/]+)/'))[1]
      AS supplier_name
  FROM deliveries AS d
  WHERE d.target_path LIKE '/FSQA/trellis/trading-partners/%'
), chosen AS (
  SELECT source_document_id, min(supplier_name) AS supplier_name
  FROM extracted
  WHERE supplier_name IS NOT NULL AND supplier_name <> ''
  GROUP BY source_document_id
)
UPDATE source_documents AS sd
SET supplier_name = chosen.supplier_name,
    updated_at = now()
FROM chosen
WHERE sd.id = chosen.source_document_id
  AND NULLIF(sd.supplier_name, '') IS NULL;
`,
} as const;
