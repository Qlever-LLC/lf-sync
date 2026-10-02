export const sourceSupplierColumnsMigration = {
  name: "source_supplier_columns",
  sql: `
ALTER TABLE source_documents
  ADD COLUMN IF NOT EXISTS supplier_id text,
  ADD COLUMN IF NOT EXISTS supplier_name text;
`,
} as const;
