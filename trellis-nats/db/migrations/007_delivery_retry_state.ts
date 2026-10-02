import type { Migration } from "./index.ts";

export const deliveryRetryStateMigration: Migration = {
  version: 0,
  name: "delivery_retry_state",
  sql: `
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0);
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0);
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
    ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS last_retry_reason text;

    CREATE INDEX IF NOT EXISTS deliveries_retry_due_idx
      ON deliveries (next_attempt_at, id)
      WHERE status = 'failed' AND next_attempt_at IS NOT NULL;
  `,
};
