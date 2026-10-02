import { loadConfig } from "../config.ts";
import { connectPostgres, runMigrations } from "../db/mod.ts";

const config = loadConfig();
const database = connectPostgres(config.databaseUrl);

try {
  const result = await runMigrations(database);
  console.log(JSON.stringify({
    level: "info",
    message: "LF Sync database migrations completed",
    applied: result.applied,
    currentVersion: result.currentVersion,
  }));
} finally {
  await database.close();
}
