import { z } from "zod";

const BooleanEnvSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return value;
}, z.boolean());

const WriteModeSchema = z.enum(["disabled", "canary", "enabled"]);

const ConfigSchema = z.object({
  serviceName: z.string().min(1).default("lf-sync"),
  port: z.coerce.number().int().min(1).max(65_535).default(8080),
  trellisConnect: BooleanEnvSchema.default(false),
  trellisUrl: z.string().url().default("http://trellis-runtime:3000"),
  sessionKeySeed: z.string().min(1).optional(),
  databaseUrl: z.string().min(1),
  writeMode: WriteModeSchema.default("disabled"),
  backfillPageSize: z.coerce.number().int().min(1).max(1_000).default(100),
  migrationObjectDirectory: z.string().min(1).default(
    "/var/lib/lf-sync/migration-objects",
  ),
  outboxIntervalMs: z.coerce.number().int().min(100).default(1_000),
  maxAttempts: z.coerce.number().int().min(1).max(100).default(5),
  cwsApi: z.string().url().optional(),
  cwsRepo: z.string().min(1).optional(),
  cwsServer: z.string().min(1).optional(),
  cwsUser: z.string().min(1).optional(),
  cwsPassword: z.string().min(1).optional(),
  cwsTimeoutMs: z.coerce.number().int().min(1).default(20_000),
  cwsConcurrency: z.coerce.number().int().min(1).max(32).default(1),
  cwsSmokeOnStartup: BooleanEnvSchema.default(true),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env = Deno.env.toObject()): Config {
  return ConfigSchema.parse({
    serviceName: env.LF_SYNC_SERVICE_NAME,
    port: env.PORT,
    trellisConnect: env.LF_SYNC_TRELLIS_CONNECT,
    trellisUrl: env.TRELLIS_URL,
    sessionKeySeed: env.TRELLIS_SESSION_KEY_SEED,
    databaseUrl: env.DATABASE_URL,
    writeMode: env.LF_SYNC_WRITE_MODE,
    backfillPageSize: env.LF_SYNC_BACKFILL_PAGE_SIZE,
    migrationObjectDirectory: env.LF_SYNC_MIGRATION_OBJECT_DIRECTORY,
    outboxIntervalMs: env.LF_SYNC_OUTBOX_INTERVAL_MS,
    maxAttempts: env.LF_SYNC_MAX_ATTEMPTS,
    cwsApi: env.CWS_API,
    cwsRepo: env.CWS_REPO,
    cwsServer: env.CWS_SERVER,
    cwsUser: env.CWS_USER,
    cwsPassword: env.CWS_PASSWORD,
    cwsTimeoutMs: env.CWS_TIMEOUT,
    cwsConcurrency: env.CWS_CONCURRENCY,
    cwsSmokeOnStartup: env.LF_SYNC_CWS_SMOKE_ON_STARTUP,
  });
}

export function hasCwsConfig(config: Config): boolean {
  return Boolean(
    config.cwsApi && config.cwsRepo && config.cwsUser && config.cwsPassword,
  );
}
