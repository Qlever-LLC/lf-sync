import { loadConfig } from "../config.ts";
import { connectPostgres } from "../db/mod.ts";

const format = Deno.args.includes("--json") ? "json" : "text";
const limit = numberArg("--limit", 10);

const config = loadConfig();
const database = connectPostgres(config.databaseUrl);

try {
  const [counts, active, completed, failures, throughput] = await Promise.all([
    database.query<Record<string, unknown>>(
      `SELECT status, count(*)::integer AS count
       FROM deliveries
       GROUP BY status
       ORDER BY status`,
      [],
    ),
    database.query<Record<string, unknown>>(
      `SELECT id::text AS id, target_name, target_path,
              extract(epoch FROM now() - updated_at)::integer AS age_seconds,
              retry_count, cws_entry_id::text AS cws_entry_id, updated_at
       FROM deliveries
       WHERE status = 'active'
       ORDER BY updated_at, id
       LIMIT $1`,
      [limit],
    ),
    database.query<Record<string, unknown>>(
      `SELECT id::text AS id, target_name, target_path,
              cws_entry_id::text AS cws_entry_id,
              finished_at
       FROM deliveries
       WHERE status = 'completed'
       ORDER BY finished_at DESC NULLS LAST, updated_at DESC, id DESC
       LIMIT $1`,
      [limit],
    ),
    database.query<Record<string, unknown>>(
      `SELECT
          CASE
            WHEN d.status = 'failed' AND COALESCE(f.retryable, false) = true AND d.retry_count >= d.max_attempts THEN 'retry-exhausted'
            WHEN d.status = 'failed' AND COALESCE(f.retryable, false) = true AND d.next_attempt_at <= now() THEN 'retry-ready'
            WHEN d.status = 'failed' AND COALESCE(f.retryable, false) = true THEN 'retry-pending'
            WHEN d.status IN ('failed', 'review-required') THEN 'non-retryable'
            ELSE 'open'
          END AS category,
          count(*)::integer AS count
       FROM deliveries AS d
       LEFT JOIN LATERAL (
         SELECT retryable
         FROM failure_records
         WHERE delivery_id = d.id AND status = 'open'
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) AS f ON true
       WHERE d.status IN ('failed', 'review-required')
       GROUP BY category
       ORDER BY category`,
      [],
    ),
    database.query<Record<string, unknown>>(
      `SELECT
          count(*) FILTER (WHERE finished_at >= now() - interval '5 minutes')::integer AS completed_5m,
          count(*) FILTER (WHERE finished_at >= now() - interval '15 minutes')::integer AS completed_15m,
          count(*) FILTER (WHERE finished_at >= now() - interval '60 minutes')::integer AS completed_60m
       FROM deliveries
       WHERE status = 'completed'`,
      [],
    ),
  ]);

  const payload = {
    capturedAt: new Date().toISOString(),
    counts,
    throughput: throughput[0] ?? {},
    failureCategories: failures,
    oldestActive: active,
    recentCompleted: completed,
  };

  if (format === "json") {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printText(payload);
  }
} finally {
  await database.close();
}

function printText(payload: {
  capturedAt: string;
  counts: Record<string, unknown>[];
  throughput: Record<string, unknown>;
  failureCategories: Record<string, unknown>[];
  oldestActive: Record<string, unknown>[];
  recentCompleted: Record<string, unknown>[];
}): void {
  console.log(`capturedAt: ${payload.capturedAt}`);
  console.log("deliveries:");
  for (const row of payload.counts) {
    console.log(`  ${row.status}: ${row.count}`);
  }
  console.log("throughput:");
  console.log(`  completed_5m: ${payload.throughput.completed_5m ?? 0}`);
  console.log(`  completed_15m: ${payload.throughput.completed_15m ?? 0}`);
  console.log(`  completed_60m: ${payload.throughput.completed_60m ?? 0}`);
  console.log("failures:");
  if (payload.failureCategories.length === 0) {
    console.log("  none");
  } else {
    for (const row of payload.failureCategories) {
      console.log(`  ${row.category}: ${row.count}`);
    }
  }
  console.log("oldest active:");
  if (payload.oldestActive.length === 0) {
    console.log("  none");
  } else {
    for (const row of payload.oldestActive) {
      console.log(
        `  #${row.id} age=${row.age_seconds}s retry=${row.retry_count} ${row.target_name}`,
      );
    }
  }
  console.log("recent completed:");
  if (payload.recentCompleted.length === 0) {
    console.log("  none");
  } else {
    for (const row of payload.recentCompleted) {
      console.log(
        `  #${row.id} cws=${row.cws_entry_id ?? ""} ${row.target_path}/${row.target_name}`,
      );
    }
  }
}

function numberArg(name: string, fallback: number): number {
  const index = Deno.args.indexOf(name);
  if (index < 0) return fallback;
  const parsed = Number(Deno.args[index + 1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
