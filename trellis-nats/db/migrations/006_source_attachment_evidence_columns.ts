export const sourceAttachmentEvidenceColumnsMigration = {
  name: "source_attachment_evidence_columns",
  sql: `
ALTER TABLE source_attachments
  ADD COLUMN IF NOT EXISTS attachment_id text,
  ADD COLUMN IF NOT EXISTS object_key text,
  ADD COLUMN IF NOT EXISTS original_filename text,
  ADD COLUMN IF NOT EXISTS declared_content_type text,
  ADD COLUMN IF NOT EXISTS detected_content_type text,
  ADD COLUMN IF NOT EXISTS declared_format text,
  ADD COLUMN IF NOT EXISTS detected_format text,
  ADD COLUMN IF NOT EXISTS upload_extension text;
`,
} as const;
