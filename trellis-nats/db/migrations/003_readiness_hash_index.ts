export const readinessHashIndexMigration = {
  name: "readiness_hash_index",
  sql: `
ALTER TABLE source_documents
  DROP CONSTRAINT IF EXISTS source_documents_readiness_hash_key;
CREATE INDEX IF NOT EXISTS source_documents_readiness_hash_idx
  ON source_documents (readiness_hash);
`,
} as const;
