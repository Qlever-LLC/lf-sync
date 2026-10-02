export const cwsDeliveryStateMigration = {
  name: "cws_delivery_state",
  sql: `
CREATE TABLE IF NOT EXISTS laserfiche_directories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repository text NOT NULL CHECK (btrim(repository) <> ''),
  canonical_path text NOT NULL CHECK (btrim(canonical_path) <> ''),
  parent_directory_id bigint REFERENCES laserfiche_directories(id) ON DELETE RESTRICT,
  cws_entry_id bigint CHECK (cws_entry_id IS NULL OR cws_entry_id > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  status text NOT NULL CHECK (status IN ('pending', 'verified', 'failed')),
  verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository, canonical_path),
  UNIQUE (repository, cws_entry_id)
);

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS directory_id bigint REFERENCES laserfiche_directories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cws_entry_id bigint CHECK (cws_entry_id IS NULL OR cws_entry_id > 0),
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS upload_extension text,
  ADD COLUMN IF NOT EXISTS bytes bigint CHECK (bytes IS NULL OR bytes >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS deliveries_directory_content_hash_uq
  ON deliveries (repository, directory_id, content_sha256)
  WHERE directory_id IS NOT NULL AND content_sha256 IS NOT NULL;
`,
} as const;
