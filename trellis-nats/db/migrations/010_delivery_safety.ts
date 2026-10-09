import type { Migration } from "./index.ts";

export const deliverySafetyMigration: Migration = {
  version: 0,
  name: "delivery_safety",
  sql: `
    CREATE TABLE IF NOT EXISTS source_approval_revocations (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      source_system text NOT NULL CHECK (btrim(source_system) <> ''),
      source_id text NOT NULL CHECK (btrim(source_id) <> ''),
      source_version text NOT NULL CHECK (btrim(source_version) <> ''),
      event_id text NOT NULL CHECK (btrim(event_id) <> ''),
      reason text NOT NULL CHECK (btrim(reason) <> ''),
      provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
      revoked_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      UNIQUE (source_system, source_id, source_version)
    );

    ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS upload_completed_at timestamptz,
      ADD COLUMN IF NOT EXISTS submission_claim_owner text,
      ADD COLUMN IF NOT EXISTS submission_claimed_until timestamptz;

    CREATE INDEX IF NOT EXISTS deliveries_submission_claim_idx
      ON deliveries (submission_claimed_until, id)
      WHERE status = 'active';

    WITH expected AS (
      SELECT delivery.sync_request_id,
             jsonb_agg(
               DISTINCT attachment.vdoc_key ORDER BY attachment.vdoc_key
             ) AS requested_vdoc_keys
      FROM deliveries AS delivery
      JOIN source_attachments AS attachment
        ON attachment.id = delivery.source_attachment_id
      GROUP BY delivery.sync_request_id
    )
    UPDATE sync_requests AS request
    SET requested_vdoc_keys = expected.requested_vdoc_keys,
        updated_at = now()
    FROM expected
    WHERE request.id = expected.sync_request_id
      AND request.requested_vdoc_keys = '[]'::jsonb;

    UPDATE sync_requests AS request
    SET status = 'failed',
        result = COALESCE(request.result, '{}'::jsonb) || jsonb_build_object(
          'reason', 'No attachment deliveries were retained before migration 010'
        ),
        finished_at = COALESCE(request.finished_at, now()),
        updated_at = now()
    WHERE request.status IN ('pending', 'active')
      AND NOT EXISTS (
        SELECT 1 FROM deliveries AS delivery
        WHERE delivery.sync_request_id = request.id
      );

    UPDATE failure_records
    SET reason = 'CWS submission failed',
        context = '{}'::jsonb,
        provenance = '{}'::jsonb,
        updated_at = now()
    WHERE stage = 'submit-cws';

    UPDATE delivery_attempts
    SET request_context = '{}'::jsonb,
        response_context = '{}'::jsonb,
        updated_at = now()
    WHERE stage = 'submit-cws';

    UPDATE deliveries
    SET last_retry_reason = 'CWS submission failed',
        result = CASE WHEN status = 'failed'
          THEN '{"reason":"CWS submission failed"}'::jsonb
          ELSE result
        END,
        updated_at = now()
    WHERE EXISTS (
        SELECT 1 FROM failure_records AS failure
        WHERE failure.delivery_id = deliveries.id
          AND failure.stage = 'submit-cws'
      )
      OR (last_retry_reason IS NOT NULL AND (
        last_retry_reason ILIKE '%CWS%'
        OR last_retry_reason ILIKE '%response%'
        OR last_retry_reason ILIKE '%UploadDocument%'
        OR last_retry_reason ILIKE '%CreateDocument%'
      ));

    UPDATE migration_items
    SET last_error = 'CWS migration operation failed', updated_at = now()
    WHERE last_error ILIKE '%CWS%' OR last_error ILIKE '%response body%';

    UPDATE report_runs
    SET error = 'Report generation failed', updated_at = now()
    WHERE error ILIKE '%CWS%' OR error ILIKE '%response body%';
  `,
};
