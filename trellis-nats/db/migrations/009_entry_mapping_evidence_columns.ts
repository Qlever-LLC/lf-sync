export const entryMappingEvidenceColumnsMigration = {
  version: 0,
  name: "entry_mapping_evidence_columns",
  sql: `
ALTER TABLE entry_mappings
  ADD COLUMN IF NOT EXISTS source_sync_id text,
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
`,
} as const;
