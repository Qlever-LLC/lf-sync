import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { checkCws, type CwsHealth } from "./cws.ts";
import { hasCwsConfig, loadConfig } from "./config.ts";
import contract from "./contracts/lf_sync.ts";
import {
  connectPostgres,
  createRepositories,
  type QueryExecutor,
} from "./db/mod.ts";
import deno from "./deno.json" with { type: "json" };
import { registerRuntime } from "./runtime/register.ts";

const config = loadConfig();
let databaseStatus = "connecting";
let databaseError: string | undefined;
let trellisConnected = false;
let trellisStatus = config.trellisConnect ? "connecting" : "disabled";
let lastCwsHealth: CwsHealth | undefined;

console.log(JSON.stringify({
  level: "info",
  message: "lf-sync no-write runtime starting",
  version: deno.version,
  serviceName: config.serviceName,
  trellisConnect: config.trellisConnect,
  cwsConfigured: hasCwsConfig(config),
}));

startHealthServer();
void runCwsSmoke();

const database = connectPostgres(config.databaseUrl);
try {
  await createRepositories(database).health.health();
  databaseStatus = "connected";
} catch (error) {
  databaseStatus = "failed";
  databaseError = sanitizedError(error);
  console.error(
    JSON.stringify({
      level: "error",
      message: "Database initialization failed",
    }),
  );
  throw error;
}

if (!config.trellisConnect) {
  await new Promise(() => {});
}
if (!config.sessionKeySeed) {
  throw new Error(
    "TRELLIS_SESSION_KEY_SEED is required when LF_SYNC_TRELLIS_CONNECT=true",
  );
}

try {
  const service = await TrellisService.connect({
    trellisUrl: config.trellisUrl,
    contract,
    name: config.serviceName,
    sessionKeySeed: config.sessionKeySeed,
  }).orThrow();
  const outbox = service.createSqlOutbox<QueryExecutor>({
    dialect: "postgres",
    tables: { outbox: "trellis_outbox", inbox: "trellis_inbox" },
    executor: sqlExecutor(database),
    transaction: (work) =>
      database.transaction(async (tx) =>
        await work({ tx, executor: sqlExecutor(tx) })
      ),
  });
  await registerRuntime({ service, outbox, database, config });
  trellisConnected = true;
  trellisStatus = "connected";
  console.log(
    JSON.stringify({ level: "info", message: "Connected to Trellis runtime" }),
  );
  await service.wait();
} catch (error) {
  trellisStatus = "failed";
  console.error(
    JSON.stringify({
      level: "error",
      message: "Trellis initialization failed",
    }),
  );
  throw error;
} finally {
  await database.close();
}

function startHealthServer(): void {
  Deno.serve({ port: config.port }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return json(statusPayload(true));
    if (url.pathname === "/readyz") {
      let databaseReady = false;
      try {
        await createRepositories(database).health.health();
        databaseStatus = "connected";
        databaseError = undefined;
        databaseReady = true;
      } catch (error) {
        databaseStatus = "failed";
        databaseError = sanitizedError(error);
      }
      const ready = databaseReady &&
        (!config.trellisConnect || trellisConnected);
      return json(statusPayload(ready), ready ? 200 : 503);
    }
    if (url.pathname === "/smoke/cws" && request.method === "POST") {
      await runCwsSmoke();
      return json(
        { cws: redactCwsHealth(lastCwsHealth) },
        lastCwsHealth?.ok ? 200 : 502,
      );
    }
    return json({ service: config.serviceName, version: deno.version });
  });
}

async function runCwsSmoke(): Promise<void> {
  if (!config.cwsSmokeOnStartup) return;
  try {
    lastCwsHealth = await checkCws(config);
    console.log(JSON.stringify({
      level: lastCwsHealth.ok ? "info" : "warn",
      message: "CWS smoke check completed",
      cws: redactCwsHealth(lastCwsHealth),
    }));
  } catch {
    lastCwsHealth = {
      ok: false,
      checkedAt: new Date().toISOString(),
      apiRoot: "configured",
      repository: "configured",
      error: "CWS smoke check failed",
    };
  }
}

function statusPayload(ok: boolean) {
  return {
    ok,
    database: { status: databaseStatus, error: databaseError },
    trellisConnected,
    trellisStatus,
    cws: redactCwsHealth(lastCwsHealth),
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function redactCwsHealth(health: CwsHealth | undefined) {
  if (!health) return undefined;
  return {
    ok: health.ok,
    checkedAt: health.checkedAt,
    apiRoot: health.apiRoot,
    repository: health.repository,
    root: health.root,
    error: health.error ? "CWS request failed" : undefined,
  };
}

function sanitizedError(error: unknown): string {
  return error instanceof Error && error.name === "Error"
    ? "Database initialization failed"
    : "Database unavailable";
}

function sqlExecutor(database: {
  query: (
    sql: string,
    parameters: readonly unknown[],
  ) => Promise<Record<string, unknown>[]>;
  execute: (sql: string, parameters: readonly unknown[]) => Promise<void>;
}) {
  return database;
}
