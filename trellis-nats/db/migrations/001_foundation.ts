export const foundationMigration = {
  version: 1,
  name: "persistence_foundation",
  sql: `
DO $$ BEGIN
  CREATE TYPE source_document_status AS ENUM ('received', 'ready', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_status AS ENUM (
    'pending', 'active', 'completed', 'partial', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE delivery_action AS ENUM ('create', 'update');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE attempt_outcome AS ENUM ('started', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE failure_class AS ENUM ('validation', 'not-found', 'timeout', 'transient', 'code-bug', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE failure_status AS ENUM ('open', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE inbox_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE migration_status AS ENUM ('pending', 'running', 'completed', 'partial', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('pending', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS source_documents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_system text NOT NULL CHECK (btrim(source_system) <> ''),
  source_id text NOT NULL CHECK (btrim(source_id) <> ''),
  source_version text NOT NULL CHECK (btrim(source_version) <> ''),
  readiness_hash text NOT NULL CHECK (btrim(readiness_hash) <> ''),
  document_type text,
  status source_document_status NOT NULL DEFAULT 'received',
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  approved_at timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_id, source_version),
  UNIQUE (id, source_system, source_id, source_version),
  UNIQUE (readiness_hash)
);

CREATE TABLE IF NOT EXISTS source_attachments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_document_id bigint NOT NULL,
  source_system text NOT NULL CHECK (btrim(source_system) <> ''),
  source_id text NOT NULL CHECK (btrim(source_id) <> ''),
  source_version text NOT NULL CHECK (btrim(source_version) <> ''),
  vdoc_key text NOT NULL CHECK (btrim(vdoc_key) <> ''),
  byte_reference text NOT NULL CHECK (btrim(byte_reference) <> ''),
  content_type text NOT NULL CHECK (btrim(content_type) <> ''),
  file_name text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  checksum text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (source_document_id, source_system, source_id, source_version)
    REFERENCES source_documents (id, source_system, source_id, source_version)
    ON DELETE CASCADE,
  UNIQUE (id, source_document_id),
  UNIQUE (source_system, source_id, source_version, vdoc_key)
);

CREATE TABLE IF NOT EXISTS sync_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_document_id bigint NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
  request_key text NOT NULL UNIQUE CHECK (btrim(request_key) <> ''),
  operation_id text,
  requested_by text,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  status workflow_status NOT NULL DEFAULT 'pending',
  requested_vdoc_keys jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(requested_vdoc_keys) = 'array'
    AND NOT jsonb_path_exists(requested_vdoc_keys, '$[*] ? (@.type() != "string")')
  ),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, source_document_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_requests_operation_id_uq
  ON sync_requests (operation_id) WHERE operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sync_request_id bigint NOT NULL,
  source_document_id bigint NOT NULL,
  source_attachment_id bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  payload_hash text NOT NULL CHECK (btrim(payload_hash) <> ''),
  action delivery_action NOT NULL,
  status workflow_status NOT NULL DEFAULT 'pending',
  repository text NOT NULL CHECK (btrim(repository) <> ''),
  target_path text NOT NULL CHECK (btrim(target_path) <> ''),
  target_name text NOT NULL CHECK (btrim(target_name) <> ''),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (sync_request_id, source_document_id)
    REFERENCES sync_requests (id, source_document_id) ON DELETE CASCADE,
  FOREIGN KEY (source_attachment_id, source_document_id)
    REFERENCES source_attachments (id, source_document_id) ON DELETE RESTRICT,
  UNIQUE (sync_request_id, source_attachment_id)
);

CREATE TABLE IF NOT EXISTS entry_mappings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id bigint NOT NULL UNIQUE REFERENCES deliveries(id) ON DELETE CASCADE,
  repository text NOT NULL CHECK (btrim(repository) <> ''),
  entry_id bigint NOT NULL CHECK (entry_id > 0),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  payload_hash text NOT NULL CHECK (btrim(payload_hash) <> ''),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository, entry_id)
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id bigint NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (btrim(stage) <> ''),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  outcome attempt_outcome NOT NULL DEFAULT 'started',
  retryable boolean,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  request_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_context) = 'object'),
  response_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_context) = 'object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, stage, attempt_number)
);

CREATE TABLE IF NOT EXISTS failure_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sync_request_id bigint REFERENCES sync_requests(id) ON DELETE CASCADE,
  delivery_id bigint REFERENCES deliveries(id) ON DELETE CASCADE,
  source_document_id bigint REFERENCES source_documents(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (btrim(stage) <> ''),
  failure_class failure_class NOT NULL,
  status failure_status NOT NULL DEFAULT 'open',
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  retryable boolean NOT NULL,
  status_code integer CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  attempt_number integer CHECK (attempt_number IS NULL OR attempt_number > 0),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sync_request_id IS NOT NULL OR delivery_id IS NOT NULL OR source_document_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS entity_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sync_request_id bigint NOT NULL REFERENCES sync_requests(id) ON DELETE CASCADE,
  entity_id text NOT NULL CHECK (btrim(entity_id) <> ''),
  entity_version text NOT NULL CHECK (btrim(entity_version) <> ''),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sync_request_id, entity_id, entity_version)
);

CREATE TABLE IF NOT EXISTS event_inbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consumer text NOT NULL CHECK (btrim(consumer) <> ''),
  event_id text NOT NULL CHECK (btrim(event_id) <> ''),
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  status inbox_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  claim_owner text,
  claimed_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer, event_id)
);

CREATE TABLE IF NOT EXISTS migration_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_key text NOT NULL UNIQUE CHECK (btrim(batch_key) <> ''),
  source text NOT NULL CHECK (btrim(source) <> ''),
  status migration_status NOT NULL DEFAULT 'pending',
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
  totals jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(totals) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migration_batch_id bigint NOT NULL REFERENCES migration_batches(id) ON DELETE CASCADE,
  item_key text NOT NULL CHECK (btrim(item_key) <> ''),
  source_version text,
  status migration_status NOT NULL DEFAULT 'pending',
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  last_error text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (migration_batch_id, item_key)
);

CREATE TABLE IF NOT EXISTS report_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_type text NOT NULL CHECK (btrim(report_type) <> ''),
  requested_by text,
  status report_status NOT NULL DEFAULT 'pending',
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) IN ('object', 'array')),
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_documents_source_id_idx
  ON source_documents (source_system, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS source_documents_approved_idx
  ON source_documents (approved_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS source_documents_document_type_idx
  ON source_documents (document_type, id);
CREATE INDEX IF NOT EXISTS source_documents_payload_gin_idx
  ON source_documents USING gin (payload);
CREATE INDEX IF NOT EXISTS source_documents_provenance_gin_idx
  ON source_documents USING gin (provenance);
CREATE INDEX IF NOT EXISTS source_attachments_document_vdoc_idx
  ON source_attachments (source_document_id, vdoc_key);
CREATE INDEX IF NOT EXISTS sync_requests_status_idx
  ON sync_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS deliveries_status_created_idx
  ON deliveries (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS deliveries_repository_created_idx
  ON deliveries (repository, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS deliveries_document_updated_idx
  ON deliveries (source_document_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS delivery_attempts_delivery_idx
  ON delivery_attempts (delivery_id, created_at DESC);
CREATE INDEX IF NOT EXISTS failure_records_open_idx
  ON failure_records (failure_class, occurred_at DESC, id DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS failure_records_delivery_idx
  ON failure_records (delivery_id, occurred_at DESC) WHERE delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS failure_records_source_idx
  ON failure_records (source_document_id, occurred_at DESC, id DESC)
  WHERE source_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS failure_records_status_created_idx
  ON failure_records (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS event_inbox_claim_idx
  ON event_inbox (consumer, next_attempt_at, received_at)
  WHERE status IN ('pending', 'failed', 'processing');
CREATE INDEX IF NOT EXISTS migration_items_batch_status_idx
  ON migration_items (migration_batch_id, status, item_key);
CREATE INDEX IF NOT EXISTS migration_batches_created_idx
  ON migration_batches (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS migration_items_created_idx
  ON migration_items (migration_batch_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS report_runs_type_created_idx
  ON report_runs (report_type, created_at DESC);
`,
} as const;
